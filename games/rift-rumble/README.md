# Brawlz 98

An original 2D platform fighter inside the main Windows 98 desktop, like Jokerz,
Wizardz and Dungeonz. Open `?app=brawlz` or its Start menu entry. The legacy
`/games/rift-rumble/` URL redirects into the same app window. No standalone game
page, build, account or install.

Twelve fighters have different speed, weight, reach, power and special moves.
Four locally served source atlases are based on the site's cursed emoji references.
Each fighter now uses one fixed texture and skeleton, with an eight-step run,
four airborne poses and attack preparation/contact/recovery synchronized to the
simulation. Fifty procedural frames per fighter are cached during loading.
[Art, animation pipeline and generation prompts](art/README.md).
The Taskbar, Recycle Rift and Blue Screen are the three desktop arenas. There are
1v1 and 2v2, three stocks per fighter, a three-minute limit, double jumps, directional
light/heavy attacks, projectiles, an upward recovery special and invulnerable dodges.
Teammates cannot damage each other. Ties rank total team stocks, then total damage;
an exact tie starts one-stock sudden death at 200%.

| Input | Action |
| --- | --- |
| A/D or left/right | Move |
| Space, W or up | Jump, twice before landing |
| E / F / R, or left / right click | Light / heavy / special |
| Hold W/up + R | Recovery special, once per landing |
| Hold up/down + E/F | Aim a melee attack |
| S/down | Fast fall; drop through a small platform |
| Shift | Dodge (brief immunity, then cooldown) |
| Escape | Pause practice; open menu online |
| Gamepad | Stick/d-pad, A jump, X light, Y heavy, B special, shoulder dodge |

Phones have touch controls. Sound starts muted and can be enabled. Menus support
keyboard navigation (in the room: arrows pick, Enter readies; on a gamepad the
stick picks, A readies, B takes it back, Y switches side) and reduced motion stops ambient movement. Practice pauses
when its tab is hidden. Online matches continue with the host tab open.

## Multiplayer

Create a room, share its invite or code, and join from the same game page. The
room is one screen, lobby and character select together, and everyone stays in
it between matches with the same code:

- Each player has a card: name, side, the fighter they are on right now, wins
  this session and whether they are ready. The fighter grid shows a P1/P2 tag
  on whatever each player is standing on, so every change is seen live.
- **Ready** locks your fighter and side until you take it back. When every
  seated player is ready a three second countdown runs and the match starts by
  itself; anyone un-readying, joining or leaving stops it. There is no start
  button: the host has to be ready too, so nothing starts without them, and
  nobody waits on a host who looked away.
- The host switches 1v1/2v2 and the arena on that screen, while not ready.
  Everyone sees it. Changing the mode asks everyone to ready up again.
- Two players may pick the same fighter, as in Smash; the side colour and the
  P number tell them apart.
- Bots fill the empty seats and their fighters are on cards too. The host can
  ask for a different bot.
- Everyone can switch side in 2v2 while the other side has room. In a 1v1 with
  a third player in the room, that player is next in line and takes the first
  seat that opens.
- A match ends with a short result, then everybody is back in the room. Someone
  who joins while a match is on waits there and can already pick.
- The shared desktop Netplay lobby also supports Brawlz 98, including its
  public lobby list and `join/riftrumble/` invites: its start button brings
  everyone to this room, and a player who joins it later is sent there too.
  The stable internal ID remains `riftrumble`.

The host owns the room (`rift-room.js`). Guests send their whole wish (fighter,
ready, side) with a sequence number, at most about eight times a second, and
the host answers with the room, at most ten times a second plus a heartbeat
(under a kilobyte with four players). The host takes the sender from the
transport envelope, never from the message, refuses unknown fighters, changes
while ready and stale or repeated packets, and a guest validates every room and
match description it receives. A player who drops is removed from the room, so
the ready count never waits on them; mid-match their fighter becomes a bot.

`games/netplay.js` supplies automatic WebRTC, encrypted public relay fallback,
an optional self-hosted WebSocket relay (`node server/relay.js`), and same-browser
BroadcastChannel mode. Internet play needs access to the public signaling/relay
services or a configured relay; the game has no hosted matchmaking backend.
Same-browser mode is explicitly a two-tab test mode, not internet multiplayer.

The host runs a fixed 60 Hz simulation; guests send bounded directional states and
monotonic action counters. Retransmission cannot replay attacks. Snapshots run at
20 Hz (about 8 Hz on the public relay path), and guests interpolate remote players
and briefly extrapolate their own movement. Match identities reject old-round
packets. Guest silence releases held movement; a disconnected guest becomes a bot.
Host loss ends the match with a reconnect message; there is no host migration or
competitive anti-cheat. Newcomers join the next match rather than an ongoing one.

## Files and verification

`rift-data.js` holds tuning, fighters and arenas. `rift-sim.js` is deterministic
rules without browser dependencies. `rift-animation.js` owns action timing and
skeletal keyframes. `rift-art.js` prepares the fixed rigs and cached frames;
`rift-fighters.js` supplies projectile art and the shared character draw entry point.
`rift-stages.js` draws the desktop arenas. `rift-render.js` handles animation and
combat effects. `rift-room.js` is the online room's state machine, also free of
browser dependencies. `rift-menu.js` and `rift-ui.css` define the responsive
fighter menu and room screens. `rift.js` owns the app window, input, persistence,
audio and networking.

```sh
node .github/scripts/check-rift-rumble.mjs
node .github/scripts/check-rift-animation.mjs
node .github/scripts/browser-rift-animation.mjs
node .github/scripts/browser-rift-rumble.mjs
```

The browser suite uses real local and WebSocket transports, four isolated browser
contexts, live picks, ready locks, two matches in one room, a late joiner from the
desktop lobby, a drop at character select, delayed input, disconnects, desktop
loading and phone input.
It does not verify availability of third-party internet relays. Set `PW_CHROMIUM`
to an existing Chromium/Edge executable if Playwright's browser is not installed.
