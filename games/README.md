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
