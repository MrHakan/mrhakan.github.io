# Messenger98 and persistent parties

Open `/?app=messenger` or Messenger98 in the Start menu. Default connection mode
is Auto (Internet); Local tabs is an offline, same-origin BroadcastChannel mode.
Creating a party does not publish it in the public game lobby directory.

## Lifecycle and games

The party owns a separate `partyOnly` Netplay Session. It never passes that
Session to a game. Background connections never publish `Netplay.current`; only
an actual match launch activates its game Session.
Closing/minimizing Messenger98 or closing a game does not leave the party.
Only Leave party clears the saved invitation and cancels recovery. A closed tab
cannot chat or simulate a game; reopening the site attempts to restore its saved
invitation, not an always-online account.

The host selects a Netplay catalog game and validated catalog options. Party
start chooses online, auto-follow members, host first, up to the game's actual
seat limit. AFK/non-follow members stay in chat. Overflow waits for another
match; this is not spectator support. At least the catalog minimum must opt in.
The host must also opt in and remain online because game simulation hosts cannot
migrate. Change games only after Return to party.

Each start creates a fresh match ID and separate random-code match Session.
Clients must finish `Netplay.loadGame`, join the match, and acknowledge their
actual seated Session ID. Admission requires an AES-GCM proof bound to the party
epoch, match ID, member ID and match transport ID. A 20-second readiness timeout
fails visibly rather than launching a half-ready group. Retry creates a new
match. Return/Cancel ends the match Session, signals its existing `net:down`
handler and leaves party chat alive. Game windows may display their normal
connection-lost/post-match screen; Return does not rewrite engine-specific end
screens. Existing games can also have their own rematch/character-select rooms.
Messenger tracks the outer party launch, not every engine-specific round.

## Presence and recovery

Presence comes from authenticated member traffic, not a global directory.
Members missing party heartbeats for 12 seconds show Reconnecting. Stale roster
entries are removed after two minutes. Offline saved friends are shown as
Offline / unknown, never as online accounts. Background tab throttling can delay
heartbeats and cause a conservative reconnecting indication.

Guests recover with one connection attempt at a time and at most six delayed
attempts (1, 2, 4, 8, 15, 15 seconds, plus connection/handshake time). A manual
Retry connection restarts this bounded budget. Leave cancels timers and rejects
late connection results. Host loss stops an unsafe running match rather than
electing a new simulation host. There is no automatic host election, split-brain
quorum, guaranteed message delivery, durable server, or running-match migration.
A host reload can reopen its saved code with a new party epoch. Guests pin the
host's persistent public key; losing storage/keys requires a fresh invitation
verified out of band. A failed initial restore retains metadata for a later
attempt; automatic recovery of an unavailable initial invitation is not infinite.

Idle leadership transfer is acknowledged: the chosen member opens a new control
room and reports readiness to the old authenticated host before it redirects
the party. The party invitation code and transport member IDs change. A failed
redirect retains the new invitation and uses the bounded reconnect scheduler to
join the new leader rather than retrying the retired room. Friends
use key fingerprints rather than those transient IDs. Members disconnected
during a handoff may need the new invitation. Transport failures during the
redirect are not an atomic, server-backed transaction. No leadership transfer
is allowed while a match is preparing or playing.

## Privacy and identity

Netplay protocol 2 signature/source checks remain in force. Room encryption
alone is NOT private messaging: all invite holders can read the shared room.
Private messages use a separate persistent P-256 WebCrypto ECDH identity and
recipient-specific AES-256-GCM with random IVs and authenticated context
(epoch, sender, recipient, message ID). Wrong recipients cannot decrypt them.
Private message plaintext is never sent as a room-key-addressed message and is
not saved in history or included in backups.

A member proves possession of its ECDH private key with an encrypted challenge
bound to its authenticated Netplay member ID. The party host distributes this
binding. Contacts store public keys/fingerprints using first-contact TOFU
(trust on first use), NOT verified real-world/account identities. The host is
trusted to introduce members honestly. Verify fingerprints/invitations through
another channel when identity matters. A compromised first contact, host, origin
script, browser storage, or device remains outside this protection. There is no
forward secrecy, password recovery, cross-device login or global DM routing.

Private key material is stored only under `mrhakan98-party-private-key` in the
browser, never exposed through controller getters, logged or backed up.
`mrhakan98-party-resume` stores an invitation and is also excluded from backup.
My Documents exports only party preferences, public contacts and non-DM recent
history. Keep backups private: party chat can still contain personal text.
Blocked storage falls back to in-memory operation and the UI explicitly says
refresh cannot restore the party. HTTPS/localhost WebCrypto is required.

History is limited to 100 entries, each chat/DM to 500 characters, contacts to
100, party members to 32. Send/receive paths have bounded per-member rate windows
and typing throttles; DM replay IDs are bounded. UI text is rendered with
`textContent`. The host is authoritative over catalog selection, snapshots,
match start and redirects. Epochs, monotonic snapshot revisions and match IDs
isolate stale control traffic; disposable rooms isolate old game packets.

## Public API

After `await openMessenger98()` (lazy loader), `Netplay.Party` is available.
`startMessenger98()` opens/restores the view after its files are loaded.

- `await Netplay.Party.create({mode:'local'|'auto'|'bus'})`
- `await Netplay.Party.join(code, {mode})` (uppercase 4–5 alphanumeric code)
- `Netplay.Party.current`: controller or null
- Controller read-only snapshots: `id`, `hostId`, `isHost`, `code`, `alive`,
  `epoch`, `members`, `messages`, `match`, `gameId`, `gameOptions`,
  `storageAvailable`, `status`
- `sendChat(text)`, `setPresence('online'|'afk')`, `setAutoFollow(boolean)`
- `selectGame(gameId, options)`, `await startGame()`, `returnToParty()`
- `await transferLeadership(memberId)`, `leave()`
- `addFriend(memberId)`, `await sendDirect(memberId, text)`
- Additional helpers: `setProfile({name,avatar})`, `typing()`, `retryReconnect()`
- `on(event, fn)` returns an unsubscribe function; `off(event, fn)` is supported.
  Events: `change`, `message`, `typing`, `error`, `closed`.
- Manager helpers: `restore()`, `contacts`, `preferences`, `setPreferences()`.

`startGame()` resolves when the host preload has finished/failed, not when all
clients have launched; observe `match.state` (`preparing`, `playing`, `error`,
`ended`). Members expose `ready` and `autoFollow`; presence is `online`, `afk`
or `reconnecting`. The UI derives Ready/In game from readiness and match state.

Netplay's backward-compatible optional fifth host/join argument carries
`partyOnly`, `background`, `expectedHostId`, `matchId`, `admit` and `admission` internally.
No game receives the control Session. No production secret-bearing test seam is
exported.

## Focused tests

Run `node .github/scripts/check-party.mjs`. It loads the real core with in-memory
Session fixtures and also exercises real Netplay Sessions over an in-memory
BroadcastChannel: lifecycle isolation, catalog/host authorization, opt-in/AFK,
capacity, preload failure/retry, stale IDs, bounded chat/rates, encrypted DM,
wrong-recipient rejection, handoff, reconnect and storage failure.

Run existing `check-netplay.mjs`, `check-startup.mjs`, and `check-web.mjs` for
regressions. The parent integration owns `browser-party.mjs` and CI/package
wiring; this implementation does not install dependencies or run full/browser
suites. Internet relay availability and engine-specific full match completion
must be verified separately.
