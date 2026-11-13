# blastz 98

A 2D platform shooter for two to four. Nobody has health: every bullet shoves whoever it
hits and every shot kicks the shooter back a little. Fall off the map and you lose a life;
the last one (or the last team) with lives left wins. It is the game the user asked for
after playing Gun Mayhem 2. The genre and its mechanics are borrowed; the name, the guns,
the maps, the look and the fighters are the site's own. The fighters are Brawlz 98's
twelve, drawn with the same cutout rigs (`games/rift-rumble/rift-art.js`) and the same
skeleton (`rift-animation.js`), holding a gun instead of their own weapon.

Open it with `?app=blastz`, the start menu, or `blastz` / `guns` in the run box.

| file | what is in it |
| --- | --- |
| `blastz-data.js` | every number: physics, the ten guns, the bomb, three crate items, six perks, four maps |
| `blastz-sim.js` | the rules, the bots and the snapshot. No page in it, so node runs it |
| `blastz-room.js` | the online room: seats, picks, perks, ready, the host's rules. No page either |
| `blastz-render.js` | the picture: one 2D canvas, the maps, the rigs with a gun in hand, bullets, effects |
| `blastz.js` | the window, the menu, keys / mouse / gamepads / thumbs, the room screen, the hud, the wire |
| `blastz.css` | its styles. They come with the game, not with the desktop |

## The rules

- Thin platforms only: you jump up through any of them and hold down to drop through.
  Two jumps (three with spring boots); walking off a ledge leaves you the air jump.
- Guns are held to fire, sideways only. A hit adds its `knock` to the target's speed and
  stuns them for a quarter second, during which friction, not walking, takes the push
  away. A shot adds `recoil` the other way to the shooter.
- Everybody starts with the pea shooter, which never runs out. Crates fall from the top
  every few seconds (at most three): `?` is a gun with full magazines, `★` is an item
  (firewall: no pushes for 6 s; three more bombs; turbo button). A gun whose last
  magazine is empty turns back into the pea shooter.
- Two bombs per life (four with the bomb bag). They bounce, roll to a stop and blow up
  after a second and a half, pushing everybody near, the thrower too. Rockets and the zip
  launcher blow up the same way.
- A fall within six seconds of being hit is a KO for whoever hit last. You come back
  from the spawn point farthest from danger, with a two and a half second shield that
  firing cancels.
- After three minutes it is overtime: every push gets stronger by its whole size each
  minute, and crates come twice as often. That is what ends a match between two careful
  players.
- Free for all, or two teams (teammates are never pushed by each other's bullets or
  bombs, only by their own). Three, five or ten lives.

| gun | |
| --- | --- |
| pea shooter | the one you always have |
| hand cannon | six big shoves |
| buzz box | a lot of small shoves |
| spread sheet | six pellets, short reach, big recoil |
| long distance call | one slow, very long, very hard shot, with a sight line |
| spin cycle | winds up for half a second, then never stops, and slows you down |
| auto save | steady and dependable |
| triple click | bursts of three |
| delete key | a slow rocket that blows up |
| zip launcher | lobs bombs that pop on contact |

Perks: spring boots (third jump), heavy boots (pushed 30% less, a little slower),
steady hands (no recoil, half the spread), big mag (half again the ammo, faster
reloads), bomb bag (four bombs, bigger blasts), turbo (15% faster).

## Bots

Staying on the map comes first: with nothing under its feet a bot heads for the nearest
platform and jumps near the top of its fall. On a platform it goes for a close crate
while it has only the pea shooter, climbs or drops to the floor its target stands on,
and when a target is in line it turns, waits a few ticks and holds the trigger. Being
shoved toward an edge it leans against the push. `check-blastz.mjs` plays four bots on
every map and fails if more than 12% of falls had nobody behind them, or if a five-life
match does not end.

## Playing together

- **One computer:** one to four players. One player uses any of the keys
  (A/D or arrows, W/Space jump, S drop, F/J/Z or left click fire, G/K/X or right click
  bomb). Two share the keyboard: P1 on WASD + F/G, P2 on the arrows + K/L (or numpad
  1/2). Gamepad n plays for player n, which is how players three and four play. Bots
  fill the match up to the size picked. Phones get thumb buttons.
- **Online:** the same room as Brawlz 98 since PR #62. Create a room, share the code or
  the invite (`join/blastz/?lobby=CODE`, which also gives Discord a preview), and
  everyone picks a fighter and a perk on one screen. The host sets the mode, the size,
  the lives and the map. The match starts three seconds after everyone is ready and
  everybody comes back to the same room after it, with the wins counted. Bots fill the
  empty seats; the host can roll a different one. The desktop's multiplayer lobby and
  its public list work too: its start button brings everyone to the room.
- The host runs the rules at 60 Hz. A guest sends its whole input (held keys, plus
  counters for jump and bomb that only go up) at most every 45 ms, and gets snapshots at
  20 Hz (about 8 Hz on the public relay path). Guests draw between snapshots and move
  bullets forward by their speed. A guest who drops becomes a bot; losing the host ends
  the match with a message. There is no host migration.

## Tests

```sh
node .github/scripts/check-blastz.mjs         # rules, bots, the wire, the room (~3 s)
node .github/scripts/browser-blastz.mjs       # BZ_ONLY=solo|duo|phone|tabs|relay|desk
node .github/scripts/blastz-preview.mjs       # rewrites join/blastz/preview.jpg
```

`mrhakan98-blastz-meta` keeps matches, wins, knockouts and falls (the trophy room and
the documents folder read it); `mrhakan98-blastz-prefs` keeps the picks and the setup.
