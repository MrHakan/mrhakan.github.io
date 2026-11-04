# games

Every game here is at least two files — `<name>-data.js` (content) and
`<name>.js` (engine) — loaded on demand by `extras.js` and rendered into
a window from `createAppWindow()`. No build step, no framework, no
bundler.

Two of the files are not a game:

- **`netplay.js`** — lobbies, invite codes and transports, shared by
  every multiplayer game on the site.
- **`wizardz/`** — the first game that uses it. `age-of-troll/` is the
  better worked example for a new one, because it is simpler.

## wizardz 98

A third person shooter that looks like 1996, in which a sigil is how you load your
staff. Five files, split the way age of troll is:

| file | what it is |
| --- | --- |
| `wizardz-data.js` | every number, the fifty symbols, the arena layout, the bots |
| `wizardz-sigil.js` | reads a drawing. no page in it |
| `wizardz-sim.js` | the rules and the bots' brains. no page in it |
| `wizardz-gl.js` | the renderer: hand written WebGL1, no library |
| `wizardz.js` | the window, the mouse, the wire, the hud |

### the loop

- **E** (the ink button on a phone) is the ink stance. The camera stops, you can
  only shuffle, you cannot shoot, and you take a fifth more damage. In exchange,
  anything of theirs flying within 6.5m of you slows to a third of its speed. That is
  a rule of the world rather than a screen effect, so it works online, where time
  cannot slow down for just one player.
- Finish the sigil. It costs **ink**. How clean it was sets its power, and a clean
  many-shot spell loads a bonus charge.
- Shots, beams, strikes, walls, zones, traps and decoys go in the **chamber**, and the
  left button fires them at the crosshair. Novas, wards, heals and blink go off at once.
  Drawing another replaces what is loaded.
- An empty staff still fires a weak free **zap**, and every hit earns ink back. So you
  are never helpless, and shooting pays for drawing.
- You carry **eight** sigils into a match and only those can be cast. Nobody remembers
  fifty symbols in a firefight, and eight makes a misread much rarer. The old
  `mrhakan98-wizardz-loadout` save is what picks them.

### winning

Three knockouts, or the ritual: 42 seconds in total alone on the altar in the middle,
and being knocked out costs you a quarter of your progress. At 2:30 the fog starts
closing in on the altar and hurts anyone outside it, so nothing stalls. At 5:00 the
clock decides, on knockouts, then ritual, then health.

### controls

| Control | Action |
| --- | --- |
| WASD or arrows | Walk |
| Mouse (locked) | Look |
| Left click | Fire, or draw while in the stance |
| Right click | Aim over the shoulder, or leave the stance |
| Space | Jump, or clear the ink while drawing |
| Shift | Dash |
| E, Q or R | Start drawing, or stop |
| 1–8 | Show a tracing guide for that spell |
| Enter | Read the ink now (manual cast waits for this) |
| P or Esc | Menu, and let go of the mouse |

A browser with no pointer lock gets drag to look instead. On a phone the left thumb is
a stick, the right looks, and in the stance the right thumb is the pen while the left
one keeps walking. Bot matches pause when the mouse is let go, or the tab loses focus.
Online matches never pause; they freeze only when the other side goes quiet.

### the look

All of it comes from what the renderer leaves out, and `wizardz-gl.js` says how: 240
lines scaled up with no smoothing, corners snapped to whole pixels in the vertex
shader, affine textures, nearest filtering off one 512x512 page, light baked into the
corners, a 4x4 bayer dither down to 5 bits a channel, and fog. The whole arena is a
couple of thousand triangles and a frame is about forty draw calls. Measured on a
GeForce RTX 4060 it holds 144fps at 1920x1080 at the display's refresh rate with 0.8ms of
javascript a frame, and on a software renderer with no GPU at all about 40fps.

### the arena is a height map

Every solid thing is a box standing on the floor with nothing overhanging, so "is that a
wall" and "can they see me" are array lookups, and bots can have a flow field per goal.
That is why `check-wizardz.mjs` can play a match in about 40ms. Half of it is written
in `wizardz-data.js` and the other half is that turned round by 180 degrees, so neither
spawn is the good one.

### balance

Tune in `wizardz-data.js` and run `WZ_TABLE=1 node .github/scripts/check-wizardz.mjs`.
Two average bots with random books play a thousand matches, and a spell's number is how
often the side carrying it won, counting only matches where the other side did not carry
it too. The bots are the instrument, so a spell they use badly reads as weak. That is the
measurement's limit: nothing here has been played by a crowd of people.

## age of troll

A lane game in the style of Age of War: two walls, five ages, units that march
on their own. `age-of-troll-data.js` has the numbers, `age-of-troll-sim.js` has
the rules and the bot, and neither touches the page, which is how
`check-age-of-troll.mjs` plays a few hundred games in a minute. Tune in the data
file and run that.

Online it is host authoritative like wizardz, with one difference: a guest runs
the same `step()` from the last snapshot rather than only moving things along.
So over the relays it needs 3 snapshots a second rather than 8. Guests send
numbered commands, resend whatever the next snapshots have not acknowledged, and
the host ignores a number it has seen, because relays drop and reorder things.

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
        blurb: 'a low poly shooter: draw sigils to load your staff',
        scripts: ['games/wizardz/wizardz-data.js', 'games/wizardz/wizardz.js']
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

session.send('wz:s', snapshot);                       // to everybody
session.sendToHost('wz:i', { x: 100, z: 0 });         // just the host
const off = session.on('wz:s', (data, from) => {});   // returns an unsubscribe
```

Message names are yours; prefix them so two games in one lobby never
collide. Anything starting `np:` belongs to netplay itself.

Session events worth listening to: `roster`, `chat`, `player-join`,
`player-leave`, `start`, `net:down`, `net:error`, `closed`.

### 4. pick a netcode shape

`wizardz` is **host authoritative**, which is the least painful option
and the one to copy:

- the host runs the simulation and sends a snapshot 20 times a second, as
  arrays of short numbers
- guests send only intents — what they are holding, and "I cast fireball",
  numbered — and the host validates them (ink, cooldowns, whether you are
  frozen). Every input message carries everything not yet acknowledged, so a
  dropped message needs no extra machinery
- guests run the same `step()` between snapshots with `guessing` set, which
  moves things and decides nothing. Their own wizard moves at once, and each
  snapshot replays the inputs the host has not seen yet

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

## making a game feel responsive

`jokerz 98` is the worked example, and its lesson is not about easing
curves. The table was rebuilt with `innerHTML` on every click, so the
card you selected was **destroyed and recreated already sitting in its
raised position** — the CSS transition it had all along never got a
frame to play in. No amount of animation code fixes that; the element
has to survive the click.

So `balatro-fx.js` comes with the surgical updates that make it
possible:

| instead of | do |
| --- | --- |
| `balRender()` on every state change | touch only what changed (`balUpdateReadout`) |
| removing a card then redrawing | animate it out, *then* change the state |
| drawing new cards into a redraw | record them and deal them in after |

The animations themselves all route through `fx.js`, which means the
reduced-motion setting turns every one of them off for free — including
the CSS transitions, via the `no-motion` class it puts on `<html>`. A
game that only works when it is animating is a game that breaks for
somebody who gets motion sick, so every animated path has a plain one:
`BJFX.flyOut` resolves immediately, `balDiscardUI` falls through to
`balDiscard`, and the hand ends up in the same place.

## how a drawing is read

`wizardz-sigil.js` is its own file, and it promises that stroke order, stroke direction,
size and angle do not count. That promise costs something: no two symbols may be
rotations of each other. There is no up arrow next to a right arrow.

1. **tidy** — clean out junk points, smooth, and resample to 64 points spaced evenly
   along the ink. Each one remembers which way the line was going, with no arrowhead,
   as a doubled angle: a line and the same line backwards are one tangent.
2. **shortlist** — how far from the middle the ink sits (a radial histogram, which
   rotation cannot change) and the opinions in step 4 pick twelve templates. Your eight
   always get looked at as well.
3. **match** — an oriented chamfer distance: how far is every point from the nearest
   point of the other drawing, both ways, counting a point going the wrong way as further
   off. Every angle gets a cheap sweep against 24 pre-rotated copies of the template,
   then a fine search round the best two. This replaced $P's one to one matching, which
   depends on where it starts, and made a perfect drawing score differently at different
   angles.
4. **opinions** — the things a cloud cannot have. How many enclosed loops, counted by
   rasterising the ink, so a C and an O are different animals. How many corners, so a
   circle is not a square. How many separate pieces, how much line, how much the hand
   turned, how much of the ink closes on itself.

A drawing has to score 0.50 and beat the runner up by 0.05, or it fizzles and says what
it looked like. Power is measured from there up to 0.80. A real symbol you did not pack
is not cast as something else: the game tells you it is not in your book.

`check-sigils.mjs` is what holds all of that. A pretend hand draws each symbol at any
angle and size, in any stroke order, with a wobble, a tremor, a circle that stops short
of itself and strokes that land a bit off from each other. The numbers go in a confusion
matrix, with seeds fixed, and the full matrix lands in `.ci-shots/sigil-confusion.json`.
Today an ordinary hand gets the right spell 93% of the time, the first guess is right 99%
of the time, and 0.4% cast the wrong spell. Those are the pretend hand's numbers. Change a
symbol in `wizardz-data.js` and run it.

## transports

Picked in the lobby, identical interface, no game code is aware of which
one is in use:

| mode    | what it is                                    | needs                 |
| ------- | --------------------------------------------- | --------------------- |
| `auto`  | `peer` if there is a route, otherwise `bus`   | nothing (the default) |
| `peer`  | WebRTC data channel via the PeerJS broker     | nothing (`auto` only) |
| `bus`   | posted through public nostr relays, no p2p    | nothing               |
| `relay` | WebSocket relay you host                      | `server/relay.js`     |
| `local` | BroadcastChannel between two tabs             | nothing, offline      |

`auto` exists because a static site cannot promise a direct connection.
Two browsers can only reach each other if their routers allow it, and
behind strict or carrier-grade NATs they do not. That used to be what TURN
servers were for, but the free ones are gone: the servers built into PeerJS
no longer exist in DNS, and Open Relay resolves to a reserved test address.
So the host listens on both roads at once, and a guest tries direct for
seven seconds, then the relays. Nobody picks anything, and the two players
cannot pick differently. A direct link that dies mid-duel moves to the
relays by itself, inside the six seconds before anyone is called gone.

`bus` is the other road. It posts every message to four public nostr relays
on port 443 — no signup, no account, nothing deployed — and reads the room
back off them. The room is a hash of the invite code and the payload is
AES-GCM encrypted with a key derived from the same code, so the relays carry
opaque blobs. Relays only take signed events, so `netplay.js` carries a
small BIP-340 schnorr signer (about 2ms a signature, checked against the
official test vectors in CI); messages are batched every 90ms so that is
one signature per batch rather than per message.

Relays are other people's servers and they change their minds. A relay that
says to slow down gets a minute's peace and one that refuses outright gets
left alone, because carrying on regardless is how an address gets banned.
The list rots too: `npm run relays` runs each one at game rate for long
enough to get past the limits and says who is still delivering. Trust that
over a quick check, because several accept everything and then quietly stop
delivering after a few hundred events. A wizardz match over relays costs the host
about a megabyte a minute and the guest less, measured in `browser-wizardz.mjs` against
the stand-in relay and multiplied by the four in the list.

It is slower than `peer` — a relay hop is roughly 150ms each way instead
of a direct connection — so a game should ease off when it sees it:

```js
const slow = session.transport.kind === 'bus';
const snapshotHz = slow ? 5 : 20;
```

Read it each time rather than once: under `auto` it can change mid-match, and
it says `auto` until somebody has actually connected.

Override the relay list with `Netplay.setNostrRelays([...])`, or in
`data/site.json` under `multiplayer.nostrRelays`. `server/nostr-test-relay.mjs`
is a stand-in for tests. If you ever pay for a TURN server, it goes in
`multiplayer.iceServers`, in the format `RTCPeerConnection` takes, and more
pairs of players will get a direct connection.

Testing any of this from one machine proves less than it looks like. Two
browsers on the same computer never need a relay of any kind, so a dead TURN
server or a relay that stops delivering after 300 events looks exactly like
a working one. `browser-netplay.mjs` fakes the broker with hole punching as a
setting, and `check-netplay.mjs` fakes the relays misbehaving in the ways real
ones have been measured doing.

`local` is how you test a multiplayer game at 3am with nobody awake to
play against: open the site twice, host in one tab, join in the other.

## tests

`.github/scripts/check-games.mjs` loads these files without a browser
and checks the content and the desktop wiring;
`check-wizardz.mjs` and `check-sigils.mjs` hold wizardz's rules, balance and
recogniser to their targets;
`.github/scripts/browser-check.mjs` opens the real site in chromium,
draws a sigil with the mouse and runs a two-tab lobby;
`browser-wizardz.mjs` plays a match to the end with a real mouse, a phone with
real touches, and two browsers direct and over the relays;
`.github/scripts/check-netplay.mjs` and `browser-netplay.mjs` hold the ways
online to what happens when the network misbehaves. They all run in CI on
every push, and the Pages deploy waits for them. `npm run relays` is the one
that talks to the real relays, so it is not part of that.
