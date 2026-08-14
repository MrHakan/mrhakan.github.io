# games

Every game here is two files — `<name>-data.js` (content) and
`<name>.js` (engine) — loaded on demand by `extras.js` and rendered into
a window from `createAppWindow()`. No build step, no framework, no
bundler.

Two of the files are not a game:

- **`netplay.js`** — lobbies, invite codes and transports, shared by
  every multiplayer game on the site.
- **`wizardz.js` / `wizardz-data.js`** — the first game that uses it,
  and the worked example for the next one.

## adding multiplayer to a game

### 1. put it in the catalogue

`netplay.js` keeps a static list so the lobby can offer a game before
its code has been downloaded:

```js
NP.CATALOG = [
    {
        id: 'wizardz',
        name: 'wizardz 98',
        icon: 'auto_fix_high',
        min: 2, max: 2,
        blurb: 'draw sigils to sling 50 spells at another wizard',
        scripts: ['games/wizardz-data.js', 'games/wizardz.js']
    }
];
```

### 2. register when your script loads

```js
window.Netplay.registerGame({
    id: 'wizardz',
    name: 'wizardz 98',
    start(session, opts) { startDuel(session, opts); },
    startSolo() { openBotPicker(); },   // optional: your own 1 v bot front door
    paintAvatar,        // optional: draws a player onto a lobby canvas
    editAvatar          // optional: opens your dress-up window
});
```

`start()` is called on **every** player once the host presses start, with
the same `opts` — `{ gameId, seed, slots, at }`. `slots` is the player
order, so both sides agree on who is on the left without asking.

### 3. talk over the session

```js
session.isHost              // exactly one player has this
session.id                  // my player id
session.players             // [{id, name, avatar, ready, host, ping, me}]
session.opponent()          // the other one, in a two player game

session.send('wz:cast', { s: 'fireball', q: 0.9 });   // to everybody
session.sendToHost('wz:input', { u: 1, d: 0 });       // just the host
const off = session.on('wz:snap', (data, from) => {}); // returns an unsubscribe
```

Message names are yours; prefix them so two games in one lobby never
collide. Anything starting `np:` belongs to netplay itself.

Session events worth listening to: `roster`, `chat`, `player-join`,
`player-leave`, `start`, `net:down`, `net:error`, `closed`.

### 4. pick a netcode shape

`wizardz` is **host authoritative**, which is the least painful option
and the one to copy:

- the host runs the simulation and sends a snapshot 15 times a second
- guests send only intents — "I am holding up", "I cast fireball" — and
  the host validates them (mana, cooldowns, whether you are frozen)
- guests render the last snapshot and keep projectiles moving locally
  between them, so 15 Hz does not look like 15 fps

A turn-based game can skip all of that and just send moves.

### 5. free practice mode

```js
const solo = Netplay.soloSession('yourgame');
yourGame.start(solo, { solo: true });
```

`soloSession()` hands back the same object shape with no transport
behind it, so single player runs down the same code path as a duel and
cannot rot separately. If you register a `startSolo()` the lobby's
"play a bot" buttons call that instead — wizardz uses it to show its
roster of opponents (`WZ.BOTS`) rather than picking one at random.

## how a drawing is read

`wizardz.js` carries its own recogniser — a $P-style point cloud match
with two extra opinions. It runs on every sigil you draw, in about ten
milliseconds, and its whole job is to be generous to a shaky hand
without ever casting a spell you did not ask for.

1. **normalise** — the strokes are smoothed, resampled to 32 points,
   scaled into a box (uniformly, so a wide rectangle stays wide) and
   centred.
2. **lean** — nobody draws upright, so the gesture is re-cut at eleven
   angles from -30° to +30°. The cap is on purpose: at ninety degrees an
   arrow up is an arrow right, and at a hundred and eighty fireball is
   frostbolt.
3. **shortlist** — the ink grid (a 10x10 blurred picture of where the
   ink sits) is a hundred multiplications, cheap enough to ask all fifty
   templates at all eleven leans. It answers two questions at once: the
   ten templates worth a proper look, and which way each of them thinks
   your hand was leaning.
4. **match** — the expensive point-cloud match runs on those ten, at
   their three best leans each. Thirty matches instead of five hundred
   and fifty.
5. **charge for wandering** — the cloud and the grid only care *where*
   the ink is, never how it got there, so a doodle that crosses the
   right area used to score like a spell. Two comparisons against the
   template fix that: how much line it took, and how much the hand
   turned getting there (measured every third point, so a wobble is not
   a corner). Both are relative, so a lance may be perfectly straight
   and a spiral may still spin.

A sigil casts if it scores **0.60** and beats the runner-up by 0.05 —
a deliberately generous door, because power is measured from there up:
scraping in casts a weak spell, and a clean drawing casts at full
strength. Miss by the margin instead of the floor and the game says so:
"half fireball, half frostbolt" is a different problem from "too rough".

The numbers all come from sweeping them against thousands of generated
drawings — tidy, sloppy, and leaning up to forty degrees — plus
scribbles and idle doodles that must *not* fire. That sweep is
`check-games.mjs`, so the thresholds cannot be tuned by feel without CI
noticing.

## transports

Picked in the lobby, identical interface, no game code is aware of which
one is in use:

| mode    | what it is                                    | needs                 |
| ------- | --------------------------------------------- | --------------------- |
| `peer`  | WebRTC data channel via the PeerJS broker     | nothing (the default) |
| `bus`   | posted through public nostr relays, no p2p    | nothing               |
| `relay` | WebSocket relay you host                      | `server/relay.js`     |
| `local` | BroadcastChannel between two tabs             | nothing, offline      |

`bus` exists because WebRTC is the first thing a school or office network
blocks. It posts every message to four public nostr relays on port 443 —
no signup, no account, nothing deployed — and reads the room back off
them. The room is a hash of the invite code and the payload is AES-GCM
encrypted with a key derived from the same code, so the relays carry
opaque blobs. Relays only take signed events, so `netplay.js` carries a
small BIP-340 schnorr signer (about 7ms a signature, checked against the
official test vectors in CI); messages are batched every 90ms so that is
one signature per batch rather than per message.

It is slower than `peer` — a relay hop is roughly 150ms each way instead
of a direct connection — so a game should ease off when it sees it:

```js
const slow = session.transport.kind === 'bus';
const snapshotHz = slow ? 8 : 15;
```

Override the relay list with `Netplay.setNostrRelays([...])`, or in
`data/site.json` under `multiplayer.nostrRelays`. `server/nostr-test-relay.mjs`
is a stand-in for tests.

`local` is how you test a multiplayer game at 3am with nobody awake to
play against: open the site twice, host in one tab, join in the other.

## tests

`.github/scripts/check-games.mjs` loads these files without a browser
and checks the content, the sigil recogniser and the desktop wiring;
`.github/scripts/browser-check.mjs` opens the real site in chromium,
draws a sigil with the mouse and runs a two-tab lobby. Both run in CI on
every push, and the Pages deploy waits for them.
