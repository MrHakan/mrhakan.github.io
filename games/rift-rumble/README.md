# Brawlz 98

An original 2D platform fighter inside the main Windows 98 desktop, like Jokerz,
Wizardz and Dungeonz. Open `?app=brawlz` or its Start menu entry. The legacy
`/games/rift-rumble/` URL redirects into the same app window. No standalone game
page, build, account or install.

Twelve fighters have different speed, weight, reach, power and special moves.
Four locally served, generated sprite atlases contain 48 idle/run/jump/attack poses,
based on the site's local cursed emoji references. [Art and prompts](art/README.md).
The Taskbar, Recycle Rift and Blue Screen are the three desktop arenas. There are
1v1 and 2v2, three stocks per fighter, a three-minute limit, double jumps, directional
light/heavy attacks, projectiles, an upward recovery special and invulnerable dodges.
Teammates cannot damage each other. Ties rank total team stocks, then total damage;
an exact tie starts one-stock sudden death at 200%.

| Input | Action |
| --- | --- |
| A/D or left/right | Move |
| Space, W or up | Jump, twice before landing |
| J / K / L | Light / heavy / special |
| Hold W/up + L | Recovery special, once per landing |
| Hold up/down + J/K | Aim a melee attack |
| S/down | Fast fall; drop through a small platform |
| Shift | Dodge (brief immunity, then cooldown) |
| Escape | Pause practice; open menu online |
| Gamepad | Stick/d-pad, A jump, X light, Y heavy, B special, shoulder dodge |

Phones have touch controls. Sound starts muted and can be enabled. Menus support
keyboard navigation and reduced motion stops ambient movement. Practice pauses
when its tab is hidden. Online matches continue with the host tab open.

## Multiplayer

Create a room, share its invite or code, and join from the same game page. The host
chooses 1v1/2v2 and arena before opening the room. Everyone can switch teams in the
lobby; starting requires at most one/two humans per side. Bots fill vacant seats.
Each player picks a fighter before joining. The shared desktop Netplay lobby also
supports Brawlz 98, including its public lobby list. Its stable internal ID remains
`riftrumble` to keep the transport and invite route consistent.

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
rules without browser dependencies. `rift-art.js` loads the generated atlases;
`rift-fighters.js` supplies projectile art and a locally drawn loading fallback.
`rift-stages.js` draws the desktop arenas. `rift-render.js` handles animation and
combat effects. `rift-menu.js` and `rift-ui.css` define the responsive selection
screen. `rift.js` owns the app window, input, persistence, audio and networking.

```sh
node .github/scripts/check-rift-rumble.mjs
node .github/scripts/browser-rift-rumble.mjs
```

The browser suite uses real local and WebSocket transports, four isolated browser
contexts, delayed input, rematches, disconnects, desktop loading and phone input.
It does not verify availability of third-party internet relays. Set `PW_CHROMIUM`
to an existing Chromium/Edge executable if Playwright's browser is not installed.
