# games

## harbor master 98

`harbor-master/index.html` is a local-only arcade game. On the site it opens
as a desktop popup window (`harbor-window.js` frames `?embed=1`) from the games
tab, the start menu and search; the page also works on its own. Route ships into the lettered berth matching their
captain: Patron (cargo A), Joe Cool (ferry B), Sahur (night shift C). Each
docking earns 100; a collision, wrong berth or grounding ends the two-minute
watch. Choose a ship, tap waypoints and its berth, or use the manifest and
matching-berth button. On the focused chart, arrows move the crosshair,
Enter adds a waypoint, Backspace undoes it and Escape clears the route.

The inline `harbor-sim` script exports a DOM-free fixed-20-Hz simulation.
Arrivals use a seeded integer PRNG, admission waits for a clear entrance,
and relative-motion collision checks prevent ships tunnelling between ticks.
`check-harbor-master.mjs` covers rules; `browser-harbor-master.mjs` plays the
real keyboard and touch controls. Hidden tabs pause explicitly, with no
catch-up on return. `harbor-master-98-best` stores only the local record.
Its catalog entry uses `daily:false` and `app: "harbormaster"`, so the games tab
launches the popup instead of a new tab. Minimising the window pauses the watch.

The sections below describe the larger desktop games.

Every game here is at least two files — `<name>-data.js` (content) and
`<name>.js` (engine) — loaded on demand by `extras.js` and rendered into
a window from `createAppWindow()`. No build step, no framework, no
bundler.

Three of the files are not a game:

- **`netplay.js`** — lobbies, invite codes and transports, shared by
  every multiplayer game on the site.
- **`lobbies.js`** — the open lobby list and quick match, which netplay.js
  loads the first time the lobby window shows them.
- **`ps1/`** — what makes wizardz and dungeonz look like 1996 (`ps1-gl.js`:
  the shaders, the texture page, the wizards, a height map mesher, `core()`,
  which owns the webgl context) and the world they stand in (`ps1-world.js`:
  a height map, and the flow fields bots find their way with). A game builds
  its own frame out of `core()`, so a third one (a kart race, say) needs no
  copy of either.
- **`wizardz/`** — the first game that uses it. `age-of-troll/` is the
  better worked example for a new one, because it is simpler.

## wizardz 98

A third person shooter that looks like 1996, in which a sigil is how you load your
staff. Five files, split the way age of troll is:

| file | what it is |
| --- | --- |
| `wizardz-data.js` | every number, the fifty symbols, the four maps, the bots |
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

Three knockouts per seat on a side (3, 6, 9 or 12), or the ritual: 42 seconds in total
with your side alone on the altar in the middle. Anyone on the other side standing on
it stops the clock. Being knocked out costs your side a quarter of its progress in a
1 v 1, and a quarter of that divided by the team size in a bigger match. At 2:30 the fog
starts closing in on the altar and hurts anyone outside it, so nothing stalls. At 5:00
the clock decides, on knockouts, then ritual, then health.

### loadouts

There is no server to look an id up on, so the id is the loadout: twelve characters, like
`8044-1NS8-WKEY`, and the order of the slots is part of it. In the box it loads the moment it
is whole, with nothing to press, and case, dashes, O for 0 and I or l for 1 do not matter.

| part | size |
| --- | --- |
| version | 2 bits, and it is 1 |
| eight sigil numbers | 6 bits each |
| check | 2 characters |

A sigil's number is its place in `SIGIL_NUMBERS` in `wizardz-data.js`, and that is a promise
to everyone who has posted an id: new sigils go on the end, nothing moves, and a sigil that gets
removed stays in the list so nothing else inherits its number. An id naming it is then refused
rather than turning into something else. `check-wizardz.mjs` holds its own copy of the list and
some real ids, so moving one fails the build. Past 64 sigils it is time for version 2, and
version 1 keeps reading. The check always catches one wrong character or two the wrong way round.

There are ten ready made in `PRESETS`. Eighty slots do not go into fifty sigils, so they cannot
all be different from each other, but between them they carry every sigil and no two share more
than three. Bots that fill a seat bring one half the time, or their own taste the rest.

Online, a guest's eight used to stay on the guest, and the host would cast anything a guest
asked for. Now a guest puts its id in its input until the host answers, and:

- `loadoutFromId` takes anything, never throws, and says why not. It is the one place that
  decides what is legal, along with `loadoutProblem`. **Nothing is locked in this game**, so
  legal means eight, all real, none twice.
- The first thing a seat says in a match is what it gets, so nobody swaps after seeing what the
  other side has. Rubbish gets the standard eight and a message saying why.
- A cast outside your eight is refused by the host, whatever your own screen thinks.

**The host is not checked by anyone**, because it runs the match. The same goes for everything
else a host does.

### teams

1 v 1, 2 v 2, 3 v 3 or 4 v 4, against bots or with people. Seats go a, b, a, b, so
`team = seat % 2` and a 1 v 1 is the same thing it always was. Every seat nobody is in
gets a bot, which comes from the match seed, so all the screens agree who it is without
sending it. Bots run on the host only, and they play with the skill of whichever bot you
picked. Online the host picks the size and the map, and anyone can press "switch sides".
If one side has more people than the size allows the rest spill over to the other side,
and if there are more people than seats the size goes up to fit them.

There is no friendly fire at all. Shots go through your own side, splash and zones ignore
it, and your own side's walls let your side's shots through.

If a guest drops out of a team match a bot sits down at once and the match carries on.
If they come back they get their seat back. In a 1 v 1 it freezes first, because the
other side may only have gone through a tunnel, and a bot sits down after 10 seconds.
**The host leaving ends the match.** There is no host migration, and the guests are told.

### maps

They are not skins. They are different height maps, and that changes what is good:

| map | what it is | what it does |
| --- | --- | --- |
| the temple | altar on a plinth, open middle, pillars | the even one |
| the recycle bin | a bowl with the altar at the bottom | whoever holds the altar can be seen from every rim |
| defrag | a dense grid of tall disks | no long sight lines, so beams and strikes suffer |
| the long wire | one raised causeway through the middle, lanes either side | long sight lines, and the high ground is the altar |

A map is an entry in `MAPS` in `wizardz-data.js`: `ground(x, z)`, `boxes`, four spawns a
side, pickups and a theme. The renderer builds its mesh from that, so a new map needs
no code. `check-wizardz.mjs` checks that every spawn and pickup on every map can be
reached on foot by both sides, that the two halves are mirror images, and then plays
matches on every map at every size.

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
That is why `check-wizardz.mjs` can play a match in about 40ms. Half of each map is written
in `wizardz-data.js` and the other half is that turned round by 180 degrees, so neither
side has the good spawn.

### balance

Tune in `wizardz-data.js` and run `WZ_TABLE=1 node .github/scripts/check-wizardz.mjs`.
Two average bots with random books play a thousand matches, and a spell's number is how
often the side carrying it won, counting only matches where the other side did not carry
it too. The bots are the instrument, so a spell they use badly reads as weak. That is the
measurement's limit: nothing here has been played by a crowd of people. The same run plays
every map at every team size and holds side a's win rate, the length of a match and how
often the clock decides to their targets. `WZ_TEAM_MATCHES` is how many of each. The ten ready
made loadouts play each other and pairs of them play random books on every map, and
`WZ_PRESET_MATCHES` is how many of those. The bots hardly cast novas, because they do not like
getting that close, so a loadout with one reads a little worse than it plays.

### what goes over the wire

Eight seats in the old format would have been eight times the bytes, which the relays
would not take. So a snapshot is now:

- `w`, every seat's position and look, always. That is nine short numbers a seat.
- `v`, health, ward, statuses, and for seats a person is in their ink and chamber, only
  when one of them changed, three times over in case one gets lost, and one seat at a
  time on a loop so that nothing stays wrong for long.
- `ev`, what happened. On relays the purely cosmetic events are left out, and no more than ten
  go in one snapshot.

Measured with real sockets against the stand-in relay and multiplied by the four relays
in the list:

| | host, MB a minute up | guest, MB a minute up | events a second |
| --- | --- | --- | --- |
| 1 v 1 | 0.99 | 0.75 | 4.8 |
| 4 v 4, two people and six bots | 1.51 | 0.70 | 5.0 |

| 4 v 4, eight people | 1.56 | 0.72 | 4.5 and 4.8 |

Over a relay everybody in the room receives everybody's messages, whoever they are for, and
each of the four relays sends its own copy. So with eight people a guest downloads about 1.5MB a
minute per relay, about 6MB a minute over four. That is under a megabit a second, which a
phone can do, but it is **the limit, and it has only been measured on the stand-in relay**, from
eight tabs on one machine (\`WZ_EIGHT=1\`). Whether a public relay puts up with eight clients
for a whole match has not been tried. Two people and six bots is far lighter.

## dungeonz 98

A co-op raid for four on the wizardz engine. Same 240 lines, same wizards, same sigils.
You and up to three friends go through a dungeon a room at a time, and bots sit in
whatever seats nobody is in.

| file | what it is |
| --- | --- |
| `dungeonz-data.js` | every number: the three dungeons, seven minions, three bosses and their attacks, twelve skills, seven passives |
| `dungeonz-sim.js` | the rules, the dungeon built from a seed, the minions, the bosses, the bots, the wire. no page in it |
| `dungeonz-gl.js` | the dungeon, the minions and the bosses, on `games/ps1/ps1-gl.js` |
| `dungeonz.js` | the window, the mouse, the thumbs, the hud, the cards, the wire |
| `dungeonz.css` | what the wizardz styles do not cover. It comes with the game, not with the desktop |

It also loads `wizardz-data.js` and `wizardz-sigil.js` for the sigils, and the two shared
files in `games/ps1/`.

### a run

- Pick a dungeon: **the recycle bin** (easy), **the registry** (normal) or **the blue
  screen** (hard). Each has its own minions, its own boss and its own colours.
- A dungeon is three sections of three or four rooms, a checkpoint shrine after each, and
  the boss's room at the end. It is built from the run's seed: rooms in a line with
  corridors between them, pillars and low walls, and the packs of minions asleep in them.
  Every screen builds the same one from the same seed, so none of that goes over the wire.
- The gate out of a room opens when everything in it is dead.
- Every kill gives **everyone** the xp, whoever landed it. A level is a card.
- Cards are spent at the shrines, where the party is healed and the dead come back: three
  to choose from each time, rolled for you alone. A new skill (up to four), a rank on one
  you have (up to three), or a passive. There is one card at the entrance, which is how you
  choose your first skill, and a chest in each section gives everyone one more.
- **Nothing that makes you stronger carries over** to the next run. What is kept is a trophy
  and a best time per dungeon. That is what keeps the balance check honest.
- **How long:** with bots, a clear takes about 4 minutes on easy, 7 on normal and 10 on hard,
  and the boss 1.5 to 3 of those. People take longer, mostly at the shrines.

### skills are sigils

Twelve wizardz sigils, rebuilt for a crowd: fireball, frostbolt, chain lightning, meteor,
thunderclap, rune ward, regrowth, blink, ice wall, magic missile, nightfall (a decoy) and
blizzard. Press 1 to 4, or press **E** and draw it. A drawing goes through the wizardz
recogniser with your four skills as the book, and how clean it was sets its power: a key
is 100%, a clean drawing up to 150%. While you draw you walk slowly and take a quarter
more damage, so it is a choice and not a tax.

### dying

At no health you are **down**, not dead. A friend standing next to you for 2.5 seconds gets
you up at 40%. Nobody comes for 25 seconds and you are **out** until the room is clear.
Everybody down at once is a **wipe**: the party starts again at the last shrine, the rooms
after it are built again from the seed with fresh minions worth half the xp, and it costs
one of two **continues**. Out of continues, the run is over.

### bosses say it first

Clippy, the troll king and the blue screen, three phases each, at two thirds and one third
of their health, with a few words and a moment where nothing hurts them. Every attack shows
where it will land before it does: a red circle that fills (slams, rain), a lane on the floor
(beams), a ring going out along the floor that you can jump, or bolts you can see coming.
At least 0.9 seconds of warning, which `check-dungeonz.mjs` holds the data to.

They are tuned against the whole party, because the party is always four: three of them bots
that level with you. The troll king used to die at the first go every time with hardly anybody
going down, so a dungeon's `bossDmg` and each boss's `gap` were turned up, most on normal and
hard, and the balance check below now holds how hard each boss is, not only how long.

### the camera

A spring arm from a point just over your head, which swings round that point with your pitch:
looking up brings it down behind you, looking down lifts it over you. Where it looks comes from
the mouse and nothing else, wherever the camera has had to go. The lens is a ball 0.42m across
rather than a point, because the near plane is wide and a point kept out of a wall still drew the
inside of it, and it stays 0.7m below the tops of the walls, which are the edge of the world.

When something is in the way the arm gets shorter, and that is all it does. It eases in and out at
no more than a camera's pace, and where its end has gone into a wall the ball is pushed out of it
sideways, so with your back to a wall it slides along it as you turn rather than cutting. Close to
your head your own wizard fades out. An earlier version lifted the arm over your head and looked
at a point that moved with it, and against a wall that turned the picture by itself.
`browser-ps1-feel.mjs` measures it and keeps a picture of every end of its pitch, in a room, back
to a wall and in a corridor, and turns the mouse two thousand small steps with your back to a wall,
holding where it looks to the mouse and the camera to no cuts between frames. Wizardz's picture
camera eases its arm the same way, and the camera its rules aim with is left as it was.

### one to four people: bots, not scaling

A party is always four seats and bots fill the empty ones, rather than the dungeon getting
easier for fewer people. The fights are built round a party: picking each other up, the boss
splitting its attention, wards and heals that cover whoever stands near. A lone wizard with
smaller numbers loses all of that. And the bots are already the balance instrument, so the
solo game is exactly what CI measures. A guest who drops is replaced by the same bot.

### online

Host authoritative through `auto`, like wizardz: the host runs the sim and the bots, a guest
sends what it is holding and numbered commands (a cast, a card) until a snapshot says they
landed, moves itself at once, and draws everything else from the snapshots. A snapshot is:

- the four heroes every time, and what they carry (health, skills and cooldowns, cards on
  offer) only when it changed, three times over, and one seat at a time on a loop
- the minions that are **awake**, as id, place, facing, health and what they are doing.
  The sleeping ones come from the seed. One a guest has seen awake that is no longer listed
  is dead
- the enemy's bolts, the red bits on the floor, zones, ice walls, decoys, the boss
- what happened, without the purely cosmetic on the relays, no more than fourteen at a time

Friendly bolts are not sent at all: a guest draws its own at once, and everybody else's
from the firing flag in their snapshot. That is the difference between a crowd fitting the
relays and not.

Measured in `browser-dungeonz.mjs` with real sockets against the stand-in relay, two people
and two bots in the blue screen with 28 minions awake, multiplied by the four relays in the
list: the host sends **1.9MB a minute**, a guest 0.7MB, at 4.6 events a second each.
`check-dungeonz.mjs` holds the average snapshot of a whole hard run under the 3MB a minute
too, and the biggest single one under 6kB. **The limit is four people**, which is what the
game is, and it has only been measured on the stand-in relay.

When a guest drops, a bot takes their seat at once with their level and their cards, and
they get it back the moment they speak again. When the host's line goes quiet the run goes
on with bots in every guest's seat until they come back: co-op has nobody to be unfair to,
so it never waits. A guest whose line goes quiet freezes until the host is heard again.
**The host leaving ends the run.** There is no host migration, and the guests are told.

### the look, and what it costs

The dungeon is one height map, so its floor and walls come out of the same mesher as the
wizardz arenas, about ten thousand triangles in one draw call, with the rock nobody can see
the top of left out. Minions and bosses are boxes on hinges. A frame with four wizards and 45
minions awake is about 75 draw calls and 1 to 3.5ms of javascript a frame. On this machine's gpu
(headless chromium, `DZ_GPU=1`) it holds 60fps, which is all headless gives, and on a software
renderer with no gpu at all, as CI has, 37 to 60fps depending on what else the machine is doing.

### balance

Tune in `dungeonz-data.js` and run `DZ_TABLE=1 node .github/scripts/check-dungeonz.mjs`.
Parties of four bots play 72 runs of every dungeon on as many threads as the machine has,
picking their cards at random so that every card gets measured. Held to:

| | cleared | a clear, in bot minutes | level at the boss | boss beaten at the first go | downs while it is up |
| --- | --- | --- | --- | --- | --- |
| the recycle bin | 85% to 100% | 2.5 to 8 | 4 to 9 | 85% to 100% | 0 to 3 |
| the registry | 55% to 97% | 3.5 to 11 | 5.5 to 11 | 50% to 92% | 3 to 14 |
| the blue screen | 30% to 85% | 4.5 to 14 | 6.5 to 13 | 30% to 85% | 6 to 22 |

and easy above normal above hard, for the dungeons and for their bosses (fewer beaten at the
first go, more people going down), the boss between 40
seconds and 4 minutes, and failures
rarely in the first two rooms. For the cards it measures two things. What a skill does per
second somebody owns it, counting damage done and health saved (by a ward, a heal, an ice
wall or a decoy): none may be more than three times the median or less than a third of it.
And how often a party carrying it clears normal and hard against one that is not: no skill
and no passive may move that by more than 30 points. `DZ_RUNS` is how many runs. The bots
are the instrument, so a skill they use badly reads as weak, and nothing here has been played
by a crowd of people.

The rates are a sample, and not the same sample on every machine: the runs are seeded, but
another V8 or another CPU rounds a few sums differently and a run can go another way from
there (the blue screen measured 33% on CI, 31% on an arm64 Mac on the same Node, 25% on
Node 26). So a rate fails when the whole of its 95% interval is outside its target, and a
card's swing when it is more than 30 points beyond its own noise. `DZ_SEED` moves the seeds.
The blue screen sits near the bottom of its band (about 31% over 300 runs), which is a design
choice to make in the data, not in the check.

## age of troll

A lane game in the style of Age of War: two walls, five ages, units that march
on their own. `age-of-troll-data.js` has the numbers, `age-of-troll-sim.js` has
the rules and the bot, and neither touches the page, which is how
`check-age-of-troll.mjs` plays a few hundred games in a minute. Tune in the data
file and run that.

The trolls are animated: a walk, an attack and a death each, and a shot for the
five that throw things, as 4 x 4 webp sheets in `anim/`. They are cut from the
approved gifs by `.github/scripts/aot-anim-sheets.py`, which also writes the
frame boxes into the `<aot-anim>` block of the data file; run it again after
changing a gif. Only the drawing uses them. A sheet loads the first time its
troll turns up, and until then the troll is its still picture.

Online it is host authoritative like wizardz, with one difference: a guest runs
the same `step()` from the last snapshot rather than only moving things along.
So over the relays it needs 3 snapshots a second rather than 8. Guests send
numbered commands, resend whatever the next snapshots have not acknowledged, and
the host ignores a number it has seen, because relays drop and reorder things.

### the server is worth holding

A decoded 28 minute online game showed the other way to win: stay home behind
turrets, buy all six modems, train only when something comes close, and let
the wall hand back 90% of every attacker as bounty and kill xp. The side that
pushed held the server almost all game and still lost. Now the server doubles
the age's xp trickle (`SERVER.xp` 0.4 to 1.0) and its holder's kills pay a
tenth more (`SERVER.kill`), kill xp is 0.4 of a unit's cost (was 0.5), and the
last three modems cost 1600, 3200 and 6000 (were 1150, 2100 and 3700).
`check-age-of-troll.mjs` plays that turtle against a side that keeps an army
out: it has to win at least 65% (2 of 24 before, 20 of 24 now), while every
bot plan stays between 20% and 80% against the field.

### replays

The rules read no clock, no `Math.random` and no frame time, and the only
arithmetic in them is `+ - * /` and `Math.round`, which every JavaScript engine
does the same. So a match is its seed, the two handicaps and the commands with the
tick each one landed on: `command()` writes a successful one down whenever
`s.log` exists, and whoever runs the rules (the host, or the one player against a
bot) starts that log in `makeMatch`. The bot's orders go through `command()` like
anybody's, so a replay never needs the bot, and tuning the bot breaks nobody's
replays. The end of `age-of-troll-sim.js` has the rest:

- **the format.** A version byte, a fingerprint of the rules, the seed, the
  handicaps, the last tick, the winner, a hash of the state it ended in, whose side
  it opens on, the names, then each command as a varint of ticks since the last one
  and one byte of what and whose. Deflated with `CompressionStream('deflate-raw')`
  when the browser has it and that is smaller, then base64url.
- **the link.** `?app=ageoftroll&replay=<code>`. js/extras.js reads it when the
  route opens, before the game's scripts load or anything tidies the address.
  Measured: a 22 minute game between two hard bots is 1,302 characters, 34 minutes
  of two people, one of them pressing a button six times a second, is 6,055. GitHub Pages answers
  414 past about 8,180 characters of address, so a code that would push the link
  past 8,000 goes after `#replay=` instead, which never reaches the server. Discord
  cuts a message at 2,000, so the end screen says when a link is longer than that,
  and "save it as a file" writes the same link into a .txt that the menu opens.
- **the version.** The fingerprint is a hash of every number the rules read (the
  names, sprites and descriptions are left out, so renaming a troll breaks nothing)
  plus `RULES_REV`. A replay with another fingerprint says it is from an older
  version before it plays a tick. Changing `step()` or `command()` without changing
  a number is what the fingerprint cannot see: bump `RULES_REV`. If that is
  forgotten, the end state hash still catches it, because the viewer plays the whole
  match once (a few hundred milliseconds) before showing any of it, and
  `check-age-of-troll.mjs` keeps a replay in `.github/scripts/age-of-troll-replay.txt`
  that has to come out to the same last bit while the fingerprint matches. After a
  balance change, `node .github/scripts/check-age-of-troll.mjs --replay-fixture`
  writes a new one.
- **the limits.** 160,000 characters of text, 256kb once unpacked (checked while it
  inflates, so a small link full of zeros stops early), 60,000 commands, two hours of
  ticks, 24 bytes a name, and a command count the bytes cannot hold is refused before
  anything is allocated. Whatever is pasted in, `decode()` returns a reason rather
  than throwing.
- **watching.** The check pass keeps a copy of the state every twenty seconds, so
  scrubbing back is one copy and at most 400 ticks. The command buttons are `inert`
  and `issue()` refuses while watching; the watch bar has play and pause, 1x to 8x
  (keys 1 to 4), the time bar, and C for the other side's camera.
- **online.** Only the host has the log, so it sends the finished code to the guest
  as `aot:replay`, and a guest that has not had it asks with `aot:replay?`. The
  guest turns it round to open on its own side before sharing it.

## sir, we have a troll problem

A tower defense in the style of Bloons, for one to four players. Trolls walk a road
across the desktop and the desktop's own furniture stops them: a pointer post, a
floppy launcher, a cooling fan, an overclocked cpu, a dial-up modem, a fax machine,
a recycle bin catapult, a spam folder, a paperclip helper and a ban hammer. They took
over the jobs of the old grid game's towers one for one (archer, cannon, frost,
flame, tesla, ballista, mortar, gas, banner, spire).

| file | what is in it |
| --- | --- |
| `troll-problem-data.js` | every number: five maps, ten towers with two paths of four tiers each, twelve trolls, thirty waves, the money, the crystal tree, and the `<tp-art>` block |
| `troll-problem-sim.js` | the rules, the bots, the wire and the saves. No page in it, so node runs it |
| `troll-problem.js` | the window, the canvas, the shop, the upgrade panel, the mouse and the thumbs, the wire |
| `troll-problem.css` | its styles. They come with the game, not with the desktop |
| `art/` | the towers (`NN-name-base/a/b.webp`, 160px) and what they throw (`-projectile.webp`, 64px) |

**The pictures.** The user drew them as 1254px pngs (the prompts are in
`troll-problem-towers/PROMPTS.md`, a folder that stays out of git).
`.github/scripts/tp-tower-art.py <folder>` clears the near invisible haze round their
edges, crops, scales and writes the webps, and finds the middle and the radius of
each tower's round base, which it writes into the `<tp-art>` block: the game stands
the base on the spot that was clicked and sizes it to the footprint. Towers never
turn; only what they throw flies at the target, drawn flying right and rotated. The
trolls are age of troll's walk and death sheets, flipped to face where they walk.

**Placing and upgrading.** A tower goes anywhere its round footprint
(`TP.TOWER_R`) touches neither the road nor another tower; while one is in your
hand the road and the other towers are tinted red and its range is drawn white or
red. Each tower has two paths of four tiers. Both can go to two; once one passes
two the other is locked at two (`TP.CROSS_CAP`), so 4-2 and 2-4 are the tops. The
fourth tier of a path swaps the picture for that path's. Targeting is first, last,
strong, weak or close. Selling gives back 70% of everything spent on it. On a
phone the first tap puts the tower down to look at and the build button pays.

**Up to four.** One road, one set of lives, everybody's own money and own towers,
and nobody can touch somebody else's. Every bounty, wave reward and early bonus is
split evenly between the players still connected, as Bloons co-op does it: paying
whoever lands the kill would pay whoever stands at the front of the road, and the
fans and paperclips that make those kills possible would earn nothing. The team
gets a little more than one player in all (`TP.coopStart`, `TP.coopIncome`),
because four wallets cannot pool into one big upgrade. A wave goes when everybody
still here has pressed go, or when the timer runs out. The crystal tree counts in
solo only; online everybody plays the stock towers.

Somebody leaving leaves their towers on the road, still shooting, and their seat
empty. Anybody who joins with the code takes the first empty seat, with its money
and its towers: the host sends them the game's start message itself, since their
lobby never saw one. With no empty seat, a newcomer watches. The host leaving ends
it, as in dungeonz.

**The wire.** Host authoritative. A guest runs the same simulation as a puppet:
trolls walk and towers fire for show, and nothing is decided, no damage, no money,
no deaths. The host's snapshot says where every troll is (five numbers each, about
eighteen bytes), how hurt, whether slowed, burning or frozen, and everybody's money;
the tower list and the seats ride along when they change and every three seconds in
case a frame was lost. 10 a second direct, 4 over the relays, where one post reaches
every guest. A guest sends nothing but numbered commands, resent until a snapshot
acknowledges them. `browser-troll-problem.mjs` counts the bytes with four browsers
over the stand-in relay.

**Balance.** `check-troll-problem.mjs` plays about three hundred games of bots: the
smart bot on every map with none, half and all of the crystal tree; the smart bot
favouring each tower and each of its paths on a middle map; sixty random plans; and
two and four bots together, one of them walking out at wave 8. The targets: the
first map is won without upgrades and the last one is not, each map is harder than
the one before it, no wave ends most of the runs that end, no tower and no path is
four waves better or worse than the median, no tower does three times another's
damage for its money or most of the work, and two or four players get about as far
as one. `--report` prints every number behind it. The waves were fitted to a curve:
each wave's troll health is about a fifth of everything the team has earned by then,
bosses at about half. Tune in `troll-problem-data.js` and run the check.

**Saves.** `trollproblem-meta-v2` (the name the trophy room reads) now holds a v3
tree. The old grid game's tree is refunded crystal for crystal and its records kept;
its run (`trollproblem-run-v2`) is deleted, since its towers no longer exist. A solo
run is kept in `trollproblem-run-v3` and comes back at the start of the wave it was on.

## trailz 98

Light cycles for one to eight. Every cycle drives forward on a grid, turns only at right
angles, and leaves a wall of light behind it. Touch a wall, anybody's or your own, or the
edge of the arena, and you are out. The last one riding takes the round. It is the game
the user asked for as "retrocycles", the browser port of Armagetron Advanced. The name is
the site's own instead (in the line of wizardz and dungeonz): Retrocycles is somebody
else's game, and this is a new one in the same old genre, written from nothing.

| file | what is in it |
| --- | --- |
| `trailz-data.js` | every number: speeds, the grind, the brake, the turn gap, how long walls stay, the arenas, the points, the bot levels |
| `trailz-sim.js` | the rules, the bots and the wire. No page in it, so node runs it |
| `trailz-gl.js` | the picture, in hand written WebGL1 |
| `trailz.js` | the window, the keys and thumbs, the camera, the hud, the menu and the wire |
| `trailz.css` | its styles. They come with the game, not with the desktop |

### playing

`← →` or `a d` turn, `↓`, `s` or space brake, `c` goes round the cameras. On a phone either
half of the picture turns that way and a button in the middle brakes; held sideways it goes
fullscreen.

- **The grind.** A wall within 4.5 units to your side pulls you along: the closer, the faster,
  up to 42 units a second from 18. It wears off when the wall ends. It is the reason to ride
  close to things, and the way to get in front of somebody.
- **The brake** holds you at half speed for about two seconds and fills again in five.
- **The turn gap.** Six steps (a tenth of a second) between two turns, so a u-turn always has
  room in it and nobody folds back onto their own wall in one press.
- **Walls go.** A dead cycle's wall stays up 1.4 seconds, flickers, and is gone a second later.
- **Rounds and points.** A point for every cycle you outlive, two more for the last one riding.
  A match is 3, 5 or 9 rounds. After 35 seconds a round gets 3.5% faster every second, so none
  goes on forever. The floor is sized for the number of cycles on it (a duel gets 62% of the
  eight cycle arena), because a duel on a floor made for eight is two people never meeting.

### the camera and the picture

Three cameras: **behind the cycle** (the default: low, wide, looking ahead, swinging round after
a turn in about a sixth of a second while the cycle leans into it), **the panorama** (twenty units
back and thirteen up: more floor, more of the field), and **the whole arena**, tipped towards you
from above, the classic view in perspective. Out of a round, the camera rides with whoever leads,
and the arrow keys pick somebody else.

**Why not the PS1 engine.** `games/ps1/` is built to look like 1995 on purpose: a 240 line canvas,
corners snapping to whole pixels, textures that swim, a dither over everything. A light cycle game
wants the opposite picture, thin bright lines that stay thin and bright all the way to the horizon,
and its shader would have had to be switched off piece by piece until nothing of it was left, with
its 1100 lines still coming down the wire. So `trailz-gl.js` is its own and small (about 450 lines):

- the floor is one square a kilometre across, and the grid is worked out per pixel in the fragment
  shader, lines kept one pixel wide however far off they are (`OES_standard_derivatives`) and faded
  into an even glow where they get too close to draw one by one. The distance for the haze is worked
  out per pixel too: taken at the corners of a square that size and spread over it, it says nothing
  is near, which is what the first version did (a floor of pure fog)
- the walls add light (`ONE, ONE`), so they never need sorting. A cycle's finished walls sit in a
  buffer of their own that is rebuilt only when it turns, drawn in its colour times how far they have
  faded; only the stretch from the last turn to the cycle is new each frame. Each wall is a sheet dim
  at the foot and bright at the top, a hot top edge, and a glow on the floor either side
- a sky that goes from a purple glow at the horizon to black, a ring of dark blocks far out for a
  skyline, stars, and the cycles as a few boxes and two wheels, 1.3 times life size so you can see yours
- the canvas is drawn at the screen's own pixels (`devicePixelRatio`, which already carries the site's
  zoom at 2560x1440) up to about two million of them

Measured in headless chromium on software GL: 58 to 60 frames a second at 1088 x 612. Without WebGL
the same game is drawn flat from above on a 2d canvas.

### fairness inside one step

Every cycle moves at once, from where it was to where it will be, and two cycles can reach one
crossing in the same sixtieth of a second. So each crossing is timed along the step: whoever got
there first laid the wall, whoever got there later hits it, two that meet head on or arrive at the
same instant both go, and a cycle that dies early in a step never lays the rest of its wall, so kills
nobody with it. Nothing depends on which seat is checked first, and `check-trailz.mjs` holds the sim
to that by playing three hundred little crashes again with the seats in reverse order.

### bots

Three levels. A bot drives straight on until the way ahead gets short, then takes the turn that
leaves it the most room. **easy** looks every twelfth step, sees twelve units ahead, waits until late,
and one look in ten does nothing at all. **normal** counts the floor each way by flooding a coarse
grid from just round the corner, and turns off a way that is running into a pocket before it has to.
**hard** looks every other step, counts further, cuts in front of somebody running alongside, likes a
wall to grind on, and when it has to turn also counts the floor it would reach before anybody else
(Voronoi). Doing that all the time measured worse: it turned too often. Measured in the check, best of
three round matches from both sides of the arena: hard beats normal about 87% of rounds, hard and
normal beat easy about 60 to 75%. With eight on the floor, easy scores least by far and hard and
normal are close: eight is a crowd. Empty seats are bots; in the menu you pick how many and how good.

### online

2 to 8 people through `games/netplay.js`, host authoritative. The host picks the cycles (2, 4, 6 or
8; quick match matches on this), how good the bots are, the arena and the rounds. Bots take every
seat nobody is in.

- **The host** runs the sim, the bots and its own cycle, and sends snapshots: 20 a second straight
  across, 6 over the relays. A snapshot is every cycle's place to a hundredth, its way, speed, fuel and
  grind as whole numbers, and the last few corners of anybody who turned lately. A guest that finds a
  hole in somebody's corners asks for the lot.
- **A guest** runs no rules. Everybody else's cycle is drawn where the last snapshot put it, carried
  on along its line for as long as the snapshot is old plus half a round trip, never through a wall.
  Its own cycle is its own: a turn happens on its screen the moment the key goes down, and goes to the
  host as the spot where it happened (the one coordinate that changes along its line, and how many
  turns it had made, so the host knows which line).
- **Lag, and why a turn in time is a turn in time.** The host takes the guest's spot and puts the turn
  there (`TZ_SIM.turnAt`): the cycle goes back to that spot, turns, and goes on the new way for the same
  distance, as if the host had heard it on time. That is the Armagetron way of doing it, and what makes
  a 300ms relay playable. It has limits so it cannot be abused: never more than half a second of
  driving back, never across the turn gap, and never back past a place where somebody has already died
  against that line, because a wall that killed somebody stays. The new stretch is checked against
  every wall there is now, so a lagging cycle gets no wall-free shortcut. A guest whose screen ran a
  little ahead gets its turn when its cycle reaches the spot. The guest measures its own round trip
  with a small ping to the host every two seconds and leads its own cycle by half of it, so the spot
  it sends is where the host's cycle really was. In the browser test, with 250ms added each way, the
  corner lands 0.001 units from where the key went down.
- **Every input message carries all the turns not yet acknowledged**, so a lost one costs nothing,
  and the host acknowledges in each snapshot.
- **Traffic, measured** in `browser-trailz.mjs` with eight cycles riding over the relays (three people
  and five bots, and again with eight separate browsers and no bots): the host sends 0.41 to 0.45MB a
  minute in under six frames a second, each guest 0.03MB and hears about 0.6MB. A snapshot of eight is
  about 550 bytes. A ninth person is turned away by the lobby.
- **People coming and going.** A guest who drops is replaced by a normal bot at once and the round goes
  on; somebody joining with the code takes a bot's seat (their own, if they had one) and is handed the
  match. The host leaving ends it: there is no host migration. A guest whose line goes quiet freezes
  and says so, and carries on when the host is heard again; a direct link dying moves both to the relays.

### saves

`mrhakan98-trailz-meta` keeps matches, wins, rounds, rounds won and the longest ride; the trophy room
shelves it with two achievements (`trailz`, `trailz_win`). `mrhakan98-trailz-prefs` keeps the menu's
choices and the camera.

### the invite picture

`join/trailz/preview.jpg` is a real frame of a real match, drawn by the game at 1200 x 630:
`node .github/scripts/trailz-preview.mjs` makes it again.

## tankz 98

Tanks in a maze, seen from above, for one to eight. A shell comes off a wall the way light
comes off a mirror and keeps going until its time runs out, and it does not care whose it is:
yours can get you. The last tank standing takes the round, a new maze is dug for every round,
and the first to the match's points takes the match. Files dropped on the floor are weapons,
one use each. It is the genre of Tank Trouble, asked for by name; the name, the look (the teal
desktop for a floor, raised grey walls, Win98 dialogs), the weapons and their names are the
site's own.

| file | what is in it |
| --- | --- |
| `tankz-data.js` | every number: the tank, the shell, a round, the maze sizes, the six files, the colours, the bot levels |
| `tankz-sim.js` | the maze, the rules, the bots and the wire. No page in it, so node runs it |
| `tankz-room.js` | the online room: who is in, who is ready, the host's settings, the last match's table |
| `tankz.js` | the window, the keys (three people at one keyboard), the thumbs and pads, the picture in a 2d canvas, the room and the wire |
| `tankz.css` | its styles. They come with the game, not with the desktop |

### cannon pacing and the arenas

The normal cannon recovers for 0.36 seconds between shots, with three shell
slots per tank; missed shells expire after seven seconds. The HUD shows free
slots and reload progress on desktop and touch, including authoritative guest
cooldowns. A rapid input stream cannot bypass the host's limits, and even a
huge press counter takes bounded work to process. `burst.bat` remains the
rapid-fire pickup; the six special weapons and ricochet physics are unchanged.

Seeded maps combine corridors with marked combat yards: control yard, freight
depot or relay station. Every cell has at least two immediate exits, while
walls remain for cover and bank shots. The layout and markings are derived
from the seed, so host and guest still build identical maps.

Tankz rules/room revision 2 is intentionally incompatible with the old maze
generator. Everybody must refresh before joining an updated room; mismatched
room/start messages are rejected instead of playing different maps together.

### the files on the floor

| file | what it does |
| --- | --- |
| `beam.exe` | a line of light that comes off walls; a dotted line shows where it goes before you fire |
| `shrapnel.zip` | a fat shell; fire again and it bursts into shrapnel |
| `seeker.dll` | flies straight for a second, then goes for the nearest tank by the maze's own paths, the one who fired it included |
| `landmine.sys` | left behind you, armed after a moment, seen by nobody but you |
| `burst.bat` | a stream of small shells |
| `scatter.ini` | a cone of pellets |

### online

The desktop lobby (or an invite link, `join/tankz/`) brings everybody to the game's own room.
The host owns the room (`TK_ROOM`), guests send their wish (`tk:want`, ready or not) and get the
room back (`tk:room`). Everybody ready starts a three second countdown and then the match
(`tk:start`). When it ends, the table goes into the room and everybody is back there, same
code, same people. Somebody arriving during a match waits in the room for the next one.

In a match the host runs the rules and the bots and sends snapshots (`tk:s`, 20 a second
straight across, 6 over the relays). A guest drives its own tank on its own screen and sends
where it is (`tk:i`); the host keeps that to what a tank could have driven (`TK_SIM.pose`) and
decides every hit. A shot is a press count, so a lost packet loses no shot. Shells fly the same
way everywhere, so a guest flies them on itself between snapshots. A guest who leaves gets a bot.

### saves

`mrhakan98-tankz-meta` keeps matches, wins, rounds, rounds won, hits and own goals; the trophy
room shelves it with two achievements (`tankz`, `tankz_win`). `mrhakan98-tankz-prefs` keeps the
menu's choices. `node .github/scripts/tankz-preview.mjs` makes `join/tankz/preview.jpg` again.
## blastz 98

A 2D shooter for two to four where nobody has health: bullets shove, shots kick back, and
falling off the map costs a life. It is the game the user asked for after playing Gun
Mayhem 2: that genre and its mechanics, with the site's own name, guns, maps and look,
and Brawlz 98's twelve fighters (their cutout rigs and skeleton, holding a gun). One to
four players on one computer (two share the keyboard, gamepads for more) or online in
the same kind of room as Brawlz 98, bots in the empty seats. Everything about it is in
[blastz/README.md](blastz/README.md).

## multiplayer identity and compatibility

Protocol 2 gives each auto session one ephemeral signing key. Its public key
is the player ID on both direct and relay routes, so a fallback keeps the same
seat. Nostr events are checked locally before their sender, decrypted payload
or sequence can affect a session. Direct connections prove that same key once,
bound to the room and broker ID; ordinary game frames reuse the authenticated
connection. Plain peer mode signs the same way: a broker ID is reusable once
its owner leaves, so it is never a player identity on its own. Relay
signature checks are bounded only for keys that have not yet proved the room
key, so a flood of throwaway keys, or forgeries claiming a player's public
key, cannot crowd out players already in the room.

Only that authenticated speaker may claim its player ID. The pinned host may
forward guest traffic between routes, but only the host may send roster, game,
options and start controls. Pending relay batches, including goodbye, drain
before the transport closes. Cached protocol-1 clients need to refresh; there
is no unsigned fallback to the old auto identities.

This is not account authentication or a private-membership system. A code-only
relay join trusts the first signed host roster that seats it: the invite does
not pin a host key in advance. Keep the room code private, and keep validating
game intents on the authoritative host. Signing alone does not prevent cheating
by a participant or a dishonest host.

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
        min: 2, max: 8,
        teams: true,            // the lobby offers "switch sides"
        seats: o => 2 * Number(o.mode),   // when the open lobby list calls it full (default: max)
        options: [              // the lobby offers these to the host, and shows the guests
            { key: 'mode', label: 'teams', values: [['1', '1 v 1'], ['2', '2 v 2']] }
        ],
        blurb: 'a low poly shooter: draw sigils to load your staff',
        scripts: ['games/wizardz/wizardz-data.js', 'games/wizardz/wizardz.js']
    }
];
```

`teams`, `seats` and `options` are optional and a game that has no use for them leaves them out.
That entry is also all it takes to be on the open lobby list and in quick match: the first
option is the mode quick match matches on, and the rest are shown on the list.

An online game also needs a join page, `join/<id>/index.html` with a 1200 x 630 `preview.jpg`.
The lobby's copy button hands out `join/<id>/?lobby=CODE`, so a link pasted in a chat previews
as that game, and the page sends the code on to the desktop. `check-netplay.mjs` fails
for a catalog entry without one. Copy an existing page and change its words and picture.

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
the same `opts` — `{ gameId, seed, slots, at, options, teams }`. `slots` is the player
order, so both sides agree on who is on the left without asking. `options` is what the
host picked, and `teams` says which side each player chose.

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

- the host runs the simulation and sends a snapshot 20 times a second (5 over
  relays), as arrays of short numbers, and sends what rarely changes only when it
  changes
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

## open lobbies and quick match

An invite code only helps if you have a friend to send it to. `lobbies.js` is for
everyone else: a host can put its lobby on a public list, the lobby window shows that
list to anybody who has it open, and one click joins. Quick match takes the game and the
mode, joins the fullest open lobby that fits, and otherwise opens one, lists it and waits.

There is no server, so the list lives on the same public nostr relays the bus transport
uses (`NOSTR_DEFAULTS`), on the same sockets code (`RelayPool` in netplay.js), which
leaves alone a relay that asks for less exactly the way a duel does.

| | |
| --- | --- |
| listing | an ephemeral signed event, tag `mrh98-lobbies-1`: game, options, code, host name, seats taken, when it opened, a region from the time zone's continent |
| refresh | the host says it again every 14 seconds and whenever something on it changes, never more than once in 2.5 |
| question | a browser opening the list asks once (`mrh98-lobbies-1-ask`), so it does not wait 14 seconds. Only hosts listen for questions, and the answer carries the question's nonce, which is where the ping on the list comes from: a round trip through the relays |
| goodbye | when the match starts, the lobby fills, the host leaves, unticks the box or leaves the site. Signed in advance, so a closing page does not wait on maths |
| time limit | anything not heard from for 40 seconds is gone, which is what catches a tab killed outright |

**Private by default.** "create lobby" stays what it was, a code for a friend, unless the
host ticks "put it in open lobbies". Somebody making a code for a friend has not agreed to
their name going out on public relays, and a stranger taking the friend's seat is a worse
first impression than an empty list. Quick match is public, since that is what it is for,
and a host can tick or untick the box in the lobby at any time.

**Everything on the list is a stranger's writing.** In order, cheapest first:

- a frame over 2kb is dropped before it is parsed, and a listing over 512 characters after
- the game has to be in the catalogue and the site version has to match; options have to be ones
  the game offers, and the seat count is the game's own, never the listing's
- the code has to be five invite code characters; the head count a whole number that fits
- names lose control characters, invisible and direction-flipping ones and stacked accents, are
  cut to 16 characters, and are escaped when drawn
- a listing more than two minutes off the clock is stale, so an old one cannot be replayed
- one event a second per key gets a hearing at all, and no more than 80 keys are remembered
- then the signature, checked here as well as at the relay, at most 40 a ten seconds
- one line per key (the newest), one per code (whoever claimed it first), and only the key that
  listed a lobby can take it down

A flood of fresh keys can fill the list for as long as it keeps posting. It cannot break it,
push out what is already there, or run anything. Proof of work would make that flood cost
something; it is not done yet.

**Two quick matches at once** would both find nothing, both open a lobby and wait for each
other forever. So a quick match lobby with nobody in it moves into a matching one that opened
before it, and the older of two never moves: exactly one of them does.

**Nothing connects at boot.** The list listens only while the lobby window shows it, or while a
quick match lobby waits alone, and a listed host listens only for questions.

`check-lobbies.mjs` holds all of the above to account with fake relays, `browser-lobbies.mjs`
does it in separate browsers against the stand-in relay, and `npm run relays -- --lobbies`
asks the real relays whether they pass listings, questions and goodbyes on.

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
the stand-in relay and multiplied by the four in the list, and a 4 v 4 with six bots about
one and a half.

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
recogniser to their targets, `check-dungeonz.mjs` the raid's,
`check-troll-problem.mjs` the tower defense's and `check-trailz.mjs` the light cycles';
`.github/scripts/browser-check.mjs` opens the real site in chromium,
draws a sigil with the mouse and runs a two-tab lobby;
`browser-wizardz.mjs` plays a match to the end with a real mouse, a phone with
real touches, every map, a 4 v 4 with bots to the end, a 2 v 2 with two browsers and bots
including somebody walking out, loadout ids typed in and refused, a guest trying to cast what
it does not carry, and two browsers direct and over the relays;
`browser-dungeonz.mjs` takes a raid from the address bar to a cleared dungeon, draws a
fireball, measures the frame rate in a crowd, and plays it on a phone and in two browsers;
`browser-trailz.mjs` rides a match against a bot to the end with real keys, checks the picture
from every camera, taps on a phone, and plays two and three browsers direct and over the relays
with lag on the line, the link dying, the bytes counted and somebody new taking a seat;
`browser-troll-problem.mjs` plays a map to the troll king with the clock turned up, puts
towers where they can and cannot go, locks a path, sells, plays on a phone, and in two and
four browsers direct and over the relays, with somebody new taking an empty seat;
`browser-ps1-feel.mjs` holds both 3d games to what players ran into: fullscreen on a 2560x1440
screen at the site's zoom of 1.5, the camera at the ends of its pitch, a shrine's cards with the
mouse locked, and firing with the right button held;
`.github/scripts/check-netplay.mjs` and `browser-netplay.mjs` hold the ways
online to what happens when the network misbehaves. They all run in CI on
every push, and the Pages deploy waits for them. `npm run relays` is the one
that talks to the real relays, so it is not part of that.

## popz 98

Bubble popping in the Pang / Bubble Trouble genre, for one, two at one keyboard, one with a bot
buddy, or two online. You stand on the floor and fire a rope straight up; a bubble it touches
splits into two smaller ones (four sizes, the smallest just pops), and bigger bubbles bounce
higher. Clear the room before the clock runs out: seconds left are bonus points, a bubble on your
head or the clock hitting zero costs a life and restarts the level. 24 original levels with steel
blocks (ropes stop under them, bubbles bounce off them) and glass ones (a rope breaks them). Popped
bubbles sometimes drop double rope, sticky rope, a shield, freeze, dynamite or an extra life. The
levels, names and look are the site's own.

| file | what is in it |
| --- | --- |
| `popz-sim.js` | the rules at a fixed 60 steps a second, the 24 levels, the items, a seeded random number generator inside the state, the bot, and the snapshot a guest gets. No page in it, so node runs it |
| `popz.js` | the window, the keys (arrows + up/enter, a d + w/space), the thumb buttons and tap-to-walk, the picture in a 2d canvas, the menu, pause, saves and the wire |
| `popz.css` | its styles, loaded by `popz.js` |

Online the host runs the rules and the bots; a guest sends its walk bits and a press counter
(`popz:i`), the host sends the game back twenty times a second (six over the relays, `popz:s`) and
a new game to everybody with `popz:go`. Between snapshots the guest moves everything on with the
same rules in puppet mode, which never splits, kills or picks anything up. A guest who leaves is
replaced by a bot. Saves: `mrhakan98-popz-best` (best score, furthest level, games, wins) and
`mrhakan98-popz-prefs`. Tests: `check-popz.mjs` (the rules, the wire, a bot clearing levels 1 to 5
on every seed and every level on some seed) and `browser-popz.mjs`; `popz-preview.mjs` draws
`join/popz/preview.jpg`.
## okey 98

Turkish tile rummy for four: 106 tiles (red, yellow, blue and black 1-13 twice, and two
false jokers), an indicator turned up in the middle, and the okey, the next number in its
colour (13 is followed by 1), as the wild tile. The false jokers play as the okey's own
face. Draw from the pile or take the tile the player on your left threw, throw one to your
right. Runs are one colour in a row (12-13-1 yes, 13-1-2 no), groups one number in three or
four colours. It is the coffee house game, asked for by name; the look (a green felt table
on a canvas, a wooden rack, Win98 dialogs), the bots and their names are the site's own.

Two rule sets, picked in the menu or the lobby (`mode`):

| rules | how it goes |
| --- | --- |
| classic okey | 14 tiles each, 15 for the dealer. Finish with 14 tiles all in runs and groups, or seven pairs, by dropping the 15th on the indicator. Everybody starts on 10 or 20 points; a finish costs each of the others 2, doubled for throwing the okey to finish and doubled for pairs. Showing the indicator's twin on your first turn costs them 1. The match ends when somebody hits 0; most points wins |
| okey 101 | 21 tiles each, 22 for the dealer. Open by laying down 101 points of runs and groups (or five pairs), then add your tiles to any run or group on the table (pair openers too), or swap an okey in a meld on the table for the real tile it stands for and take the okey; finish by playing out every tile. Penalties: 202 for never opening, otherwise what is left in the rack (an okey is 101), doubled for a pairs opener; the finisher gets -101. Finishing on the okey, in one go or on pairs doubles the hand. Throwing the okey or a tile that fits the table costs 101 on the spot; a discard you take has to go on the table that turn, or back. 1, 3 or 5 hands; lowest total wins |

| file | what is in it |
| --- | --- |
| `okey-sim.js` | the tiles, the meld search, the rules (`apply`: a move in, yes and what happened or no and why), what one seat may see (`view`), the scoring and the bots. No page in it, so node runs it |
| `okey.js` | the window, the canvas table and rack, the mouse, fingers and keys, the dialogs, the save and the wire |
| `okey.css` | its styles; okey.js loads them, the desktop does not |

The rack is yours alone: drag tiles anywhere in it (two rows of fifteen, three of ten on a
phone), or sort by runs or by groups. Drag a tile to your corner to throw it, onto the
indicator to finish, onto a meld to add it (or to take back the okey it holds, when the tile
is the one the okey stands for); drag or click the pile to draw. Keys: arrows
move, shift+arrows carry a tile, space selects, d draw, t take, x/enter throw, f finish,
l lay down, b put back, i show twin, s/g sort, p pause, h help.

The meld search takes the faces in order and tries every meld the first one left can be in
(groups with the colours after it, runs upwards, okeys in the holes, a 1 after the 13),
memoised on the counts. The bots score a hand by it, plus a little for tiles nearly in a
meld and a lot for an okey kept. They take the discard only when it beats a blind draw,
keep away from what the next seat has been picking up, and never throw the okey or a tile
that fits the table while they have anything else.

In 101 a bot opens the moment it can (with the most tiles that still make 101, or with
the discard when that is what gets it there; pairs only with six, or five once the pile is
nearly gone, since a pairs opener rarely goes out). Before that it picks its throw by
looking ahead: a dozen futures of its remaining draws, taken from the tiles it has not
seen, scored by how often the rack would reach 101 and how few tiles would be stuck after
opening. After opening it swaps okeys off the table, lays down every meld and adds every
tile that fits, keeps an okey in the rack unless it makes a meld (it fits somewhere any
time), takes the discard whenever it goes straight down (a take leaves the pile alone),
and goes out as soon as one tile is left to throw, the okey last when that also works.
Nothing it looks at is hidden: shuffle the other racks and the pile and it plays the same
(check-okey checks that). easy adds noise and skips the defence and the look ahead, hard
defends harder and looks further.

With 20 tiles in the pile (106, less 85 dealt, less the indicator) every seat draws about
five times, so plenty of 101 hands still run dry. Four normal bots on seeds 5001-5400:
59% of hands end with somebody going out (24% before this bot), 17.9 turns a hand, each
seat opening in about two hands of three. Classic: 97.8% finished, 31.3 turns, as before.

### online

The desktop lobby (or an invite link, `join/okey/`) starts everybody with the same seed and
list of players: the first four sit, bots take the rest. The host runs the match and the
bots. A guest sends `okey:act` (what it wants to do) and gets back `okey:st`: a numbered view
of the table as that seat may see it (its own tiles, how many the others hold, never which,
and nobody else's pile draws). The host checks every move with the same `apply` as its own,
and says no with `okey:no`. `okey:hi` asks for the table again. A guest that leaves gets a
bot; one that sits on its turn for a minute has a move made for it; the next hand deals
itself fifteen seconds after the last.

### saves and tests

`mrhakan98-okey-save` keeps a solo match in progress (the match and the rack's order), so
the menu offers to continue after a reload. `mrhakan98-okey-stats` keeps matches, wins,
hands, hands won and okey and pairs finishes; `mrhakan98-okey-prefs` the menu's choices.
`check-okey.mjs` holds the rules and runs 120 seeded bot matches with every tile accounted
for after every move, then 400 seeded four-bot hands of each rule set on worker threads
(the numbers above; `OKEY_LEVELS=1` adds easy and hard, `OKEY_SEED` moves the seeds);
`browser-okey.mjs` plays it with a real mouse, keys and taps, solo, 101 (an okey swapped
off the table, a match against the bots until one goes out), on a phone and in two pages
over the lobby. `node .github/scripts/okey-preview.mjs`
makes `join/okey/preview.jpg` again.
## tavla 98

Backgammon the way the coffee house plays it: no doubling cube, a mars (and a
backgammon too) is worth 2, a plain win 1. The first game opens with one die
each, after that the last game's winner rolls first. Matches are first to 5, 3
or one game. Solo is you against a bot (easy, normal or hard); online is one on
one through the desktop lobby, or an invite link (`join/tavla/`).

| file | what is in it |
| --- | --- |
| `tavla-sim.js` | the rules, the turn (both dice if you can, the larger if only one, doubles four times), the match, the bots and the move notation. No page in it, so node runs it |
| `tavla.js` | the window, the wooden board on a canvas, click/drag/touch/keys, undo, the move log, auto bear-off, the bots' pacing and the wire |
| `tavla.css` | its styles. They come with the game, not with the desktop |

The board is 24 points; white (seat 0) runs 24 → 1 and red mirrors it. The rules
think in each seat's own numbering (`rel`, 24 is the bar, -1 off), and the board
is drawn from the viewer's side, so a guest playing red still has its home at
the bottom right. `legalSteps` only offers moves that start a turn using as many
dice as possible; `check-tavla.mjs` holds it to a brute force on 1200 positions
out of real games. The bots score a position on pips, blots in range, made
points, primes, anchors and checkers on the bar; easy is sloppy on purpose,
normal takes the best position, hard looks one roll ahead at every reply.

### online

Host authoritative. The host is white, owns the match and rolls every die. A
guest sends what it wants to do (`tavla:act`, with a running number) and shows
its own moves at once; the host checks every action against the rules, applies
it and sends the whole state back (`tavla:state`, with the last number it took).
The guest takes the host's state once its own actions are acknowledged, so a
refused move snaps back. The host resends every 4 seconds and answers
`tavla:hi`. A guest who leaves gets a normal bot; if the host leaves, the guest
finishes the match against a bot on its own screen.

### saves

`mrhakan98-tavla-prefs` keeps the bot level, the match length and auto bear-off;
`mrhakan98-tavla-stats` keeps games, wins, mars wins, matches and online games;
`mrhakan98-tavla-save` keeps a solo match in progress, offered as "continue" in
the menu. Achievements it calls if the desktop has them: `tavla`, `tavla_mars`.
`node .github/scripts/tavla-preview.mjs` makes `join/tavla/preview.jpg` again.
## gold claw 98

`gold-claw/index.html` is a framed single-player game: `games/classics.js`
opens it through `frame-window.js` as `?embed=1` from `startMenuAction('goldclaw')`
or `/?app=goldclaw`, and the page also works on its own. A claw swings from the
winch; shoot it (down, space, a click or a tap on the mine), reel in gold,
diamonds, rocks, mystery bags and moles (some carry a diamond), and bank the
level's money goal before the 60 second clock runs out. Heavy things reel
slowly, tnt barrels blow up their neighbours (and other barrels), up lights a
dynamite stick to drop what is on the hook, and `n` or the done button ends a
level early once the goal is met. Between levels the shop offers a random few
of dynamite, strength drink, lucky clover, rock collector's book and diamond
polish; perks last one level. Missing a goal ends the run.

`gold-claw-sim.js` is the DOM-free rules: a fixed 60 Hz tick, a seeded
generator kept in the state, seven hand-tuned layout templates filled per
level from `hash(seed, level)` and topped up until the field is worth 1.9x the
goal step, and a greedy bot. `gold-claw.js` draws it (sprites pre-rendered once,
pooled particles, the repo's cursed emoji as the miner), handles input and
saves. It pauses on `{type: 'game-pause'}` and on a hidden tab, and stays silent
when `sound-enabled` is `false`. `window.GOLDCLAW_ENGINE` (state, newGame(seed),
setTimeScale, fastForward) is for the tests. Records: `mrhakan98-goldclaw-best-level`
and `mrhakan98-goldclaw-best-money`.

`check-goldclaw.mjs` covers the swing, grabbing, reel speeds, values and perks,
moles, chained tnt, dynamite, bags, the shop, 2400 layouts (every item inside
the swing, apart, and hookable) and 250 seeded bot runs that all end in a valid
game over. `browser-goldclaw.mjs` opens it from the start menu, wins level 1
with real key presses, minimises the window to pause it, shops with the mouse,
uses dynamite, loses a level, reloads to find the record, and plays on a phone.
## kartz 98

The Turkish card table, for two to four, with bots in the empty seats. One
standard 52 card deck and three games, picked in the menu or by the lobby's
`game` option:

- **batak**: four players, thirteen cards each. Bid 5 to 13 tricks or pass,
  starting left of the dealer; if everybody else passes the dealer has to bid.
  The highest bidder names trumps and leads. Follow suit and beat the best card
  of that suit on the table if you can; void, you must trump, and over-trump if
  you can. Trumps are not led until broken. Bidder made it: + tricks; went down:
  minus the bid; everybody else + tricks. First to 31 (or 51).
- **king**: twenty hands, the chooser going round the table. Six penalty
  contracts, each called twice per table (no tricks -50, no hearts -30, no
  jacks/kings -60, no queens -100, king of hearts -320, last two -180 a trick)
  and two trump hands per player (+50 a trick). A penalty hand stops as soon as
  there is nothing left to lose. The whole game always sums to zero.
- **pisti**: two players, or four as partners across. Match the top card or
  throw a jack to take the pile; a lone card taken by its twin is a pisti (10,
  20 for jacks). Aces and jacks 1, two of clubs 2, ten of diamonds 3, most
  cards 3. First to 51 (or 151).

| file | what is in it |
| --- | --- |
| `kartz-sim.js` | the rules of all three, the bots, a seat's view and the action reader. No page in it, so node runs it |
| `kartz.js` | the window, the DOM cards, clicks, keys and taps, the bots' pace, the score sheet window, the save, and the wire |
| `kartz.css` | its styles, loaded with the game |

A match is one JSON object with its seeded rng inside; the only ways to change
it are `act(st, seat, action)` for the seat to move and `advance(st)` for the
table (sweep a trick, deal the next hand). Online the host runs it: guests send
`kartz:act` intents, the host reads and checks them against the rules and sends
each seat its own `kartz:state` view (other hands are backs, the deck a number,
pisti's face down cards stay face down). A guest that walks out becomes a bot,
and the host can deal again at the end.

Keys: left/right and enter choose and play, `s` the score sheet, `p` pause
(alone only), `h` the rules. A solo table saves as it goes
(`mrhakan98-kartz-save`) and the menu offers to resume it; the records are in
`mrhakan98-kartz-stats`, the menu choices in `mrhakan98-kartz-prefs`.

`check-kartz.mjs` holds the rules and runs about a thousand seeded bot tables
(and the bots against random play); `browser-kartz.mjs` plays each game with
real clicks and keys, a phone, and two browsers at one table in `local` mode;
`kartz-preview.mjs` draws `join/kartz/preview.jpg` from the game itself.
## learn to glide 98

`games/learn-to-glide/` is a framed single player game in the spirit of the
old flash launch games: a penguin slides down a ramp on a cliff, launches and
glides (lift against drag, a wing that stalls if you pull too hard), burns
rockets, pops balloons for a kick and gets slowed by soggy clouds. Every
launch is a day; distance, height, top speed and balloons pay cash for five
upgrade lines (ramp, sled, glider, rockets, payload). Smash the ice wall
3200 m out at 50 m/s inside 30 days; fewer days, better medal.

- `learn-to-glide-sim.js` (`LTG_SIM`) is the whole game with no DOM: a fixed
  60 Hz step, a seeded sky per day, the shop, the season books, a scripted
  pilot and a planned shopper used by the tests.
- `learn-to-glide.js` draws on one 800x450 canvas, reads keys (arrows/W/S,
  space for rockets, enter, p), the pad buttons and the sky itself, and pauses
  on `{type:'game-pause'}` and hidden tabs. `LTG_ENGINE` is the test hook.
- saves: `mrhakan98-learntoglide-save` (the season), `-records` (best days,
  best distance, wins), `-howto` (manual seen).
- `check-learntoglide.mjs` holds the rules: tiers, saves, determinism, every
  upgrade flying farther, the wall needing a pilot, and hundreds of seasons.
  `browser-learntoglide.mjs` plays it from the start menu with real keys,
  clicks and touches, on a desktop and a 390px phone.
## pizza shift 98

`pizza-shift/index.html` is a framed single player game in the spirit of the
2000s pizzeria time-management games. On the site it opens as a desktop popup
(`frame-window.js` frames `?embed=1`) from the start menu, search and
`/?app=pizzashift`; the page also works on its own.

Five stations as tabs: **order** (take the order of whoever is at the counter),
**topping** (pick a topping, tap the pizza: two pieces in every quarter a
topping covers), **bake** (2 to 4 ovens tick in real time, even while you are
elsewhere; pull the pizza out in the green zone), **cut** (drag lines through
the centre, or turn the knife with the arrows and press enter) and **serve**.
Each pizza is scored 0-100 on toppings, bake, cut and wait; the average sets
the tip. Ten days, each busier, with halves, quarters, more toppings and
crowned impatient VIPs. Average 55 to pass a day; a failed day loses its tips
and is played again. Between days the shop sells an extra oven, hotter ovens,
a topping scoop (pairs per tap), a steady cutter (cuts snap to the centre) and
decor that raises patience. Customers are the cursed emoji from `src/emoj/`.

`pizza-shift-sim.js` (`window.PIZZA_SIM`) holds every rule with no DOM and a
seeded RNG: order generation, scoring, the oven clock, walkouts, the shop and
save sanitising. `pizza-shift.js` draws it on one canvas plus Win98 buttons and
dialogs, and exposes `window.PIZZASHIFT_ENGINE` (state, seed, `fastForward`,
canvas points) for tests. It pauses on the window's `game-pause` message and on
hidden tabs. Progress (day, money, upgrades, stars, best) is saved in
`mrhakan98-pizzashift-save`; blocked or corrupt storage starts fresh.

`check-pizzashift.mjs` tests the scoring and seeded orders and plays 40 seeds
of ten days with a perfect cook (every pizza 100), a sloppy one and an absent
one. `browser-pizzashift.mjs` plays a whole first day with the mouse, a pizza
with only the keyboard, taps on a phone, reloads the save, minimises the
window, fails a day and runs with blocked storage.
## block roll 98

`block-roll/index.html` is a single player puzzle in the spirit of the old
roll-the-block flash games, opened from the start menu (`/?app=blockroll`) in a
desktop popup by `frame-window.js` (`?embed=1` hides the page's own titlebar).
Roll a 1 x 1 x 2 block across floating tiles and drop it upright into the hole.
Orange floor cracks under a standing block, round switches react to any touch,
x switches only to a standing block, and they open, close or flip bridges. The
blue splitter turns the block into two cubes: space swaps, and two cubes that
end up side by side merge back. Arrows/WASD, swipes, a tap beside the block or
the on-screen pad roll it; R restarts, P/Escape pauses, and minimising the
window or hiding the tab pauses too.

`block-roll-sim.js` holds the DOM-free rules, the 26 original levels (made with
a solver-driven designer, then frozen as plain maps) and a 0-1 BFS solver over
(block or both cubes, active cube, bridge mask). `block-roll.js` draws it as a
2.5D canvas with roll, fall, sink and bridge animations. Each level has a fixed
six digit passcode and a `par`, the solver's optimal move count;
`check-blockroll.mjs` proves every level solvable, that par is optimal and that
each level's switch, splitter or orange floor actually matters.
`browser-blockroll.mjs` plays levels with real keys, swipes and pad taps, in
the desktop popup, at phone width and with storage blocked.
`mrhakan98-blockroll-save` keeps progress, best moves per level and the last
level played.
## deep drill 98

`deep-drill/` is a single-player dig-for-ore game in the Motherload mould, framed in a
desktop popup like the other 2000s classics (`startMenuAction('deepdrill')`, `/?app=deepdrill`;
the page also runs on its own and reads `?seed=`). A pod on a rusty red planet drills left,
right and down (never up; it flies up on its thruster), hauls ore back to the surface, sells
it at the ore buyer and spends the cash at the fuel station, the repair bay, the upgrade shop
(drill bit, hull, engine, fuel tank, radiator, cargo bay, five marks each) and the item shop
(dynamite, plastic explosive, quantum teleporter, repair kit, reserve fuel; keys 1-5). Fuel
burns underground and running dry there ends the run; falls, gas pockets, lava and the heat
below 600 m dent the hull; grey boulders only yield to explosives. Nine ores get rarer and
richer with depth, with emoji fossils and lost floppies (instant cash) on the side. At 1500 m
a cavern holds the planet's core: crack its nine shards while it flares to win.

| file | what is in it |
| --- | --- |
| `deep-drill-sim.js` | `window.DEEP_DRILL`: the seeded world (mulberry32), ore tables, fixed 60 Hz physics, drilling, hazards, shops, items, saves and the scripted miner `bot()`. No DOM. |
| `deep-drill.js` | canvas drawing (8x8 tile chunks cached per chunk version, a light mask for the dark), keys, the touch pad, dialogs, autosave, beeps, the `DEEPDRILL_ENGINE` test hook |
| `index.html` | the page and its Win98 styles; `?embed=1` hides its own title and menu bars |

The run saves to `mrhakan98-deepdrill-save` every time the pod visits a building, so a wreck
offers "reload last surface save"; a win clears it. Records live in `mrhakan98-deepdrill-best`.
It pauses on `{type: 'game-pause'}` from the desktop window and on a hidden tab.
`check-deepdrill.mjs` tests world generation by seed, physics, shops, items, the core and
saves, and sends forty seeded bots to 300 m and back to sell; `browser-deepdrill.mjs` plays it
from the start menu with real keys and a phone's touch pad, through a sale, a reload, a win
and a wreck.
## lava & tide 98

A two player co-op puzzle platformer in the spirit of the old flash temple
games, with its own two: **lava** walks through lava, **tide** walks through
water, and green goo gets anybody. Twelve hand-made temples, from a walk
through the pools to a three-storey climb with every gadget at once: plates
that hold gates and bridges while something stands on them, levers that stay
where they are pushed (two on one channel work like staircase switches),
platforms, lifts that do not wait, and stone boxes to push onto plates or use
as steps. Red gems are lava's, blue gems are tide's; both of you in your own
doors ends the level, and the time and the gems give a rank: A is every gem
inside par, B is every gem or par with half of them, C is getting out. Best
ranks are kept per level, and finishing one opens the next.

- `games/lava-tide/lavatide-sim.js` is the rules and the levels: tiles, bodies,
  pools, channels, platforms, boxes and doors, stepped at a fixed 60 a second
  with no DOM and no clock. The same keys from the same state give the same
  next state, so node replays every level's scripted solution (`sol`, run by
  the pilot in the same file) and a guest can replay its own keys on top of a
  snapshot. `snapshot`/`applySnapshot` is the whole state in about 500 bytes,
  and `applySnapshot` refuses anything malformed.
- `games/lava-tide/lavatide.js` is the window, the keys and thumbs, the canvas
  and the wire; `lavatide.css` is loaded by it.

Two at one keyboard: lava on `w a d`, tide on the arrows. Alone: either set
moves one of them and `tab` or `q` swaps. `r` restarts, `esc`/`p` pauses,
and minimising the window or hiding the tab pauses too. On a touch screen
there are ◀ ▶ ▲ buttons under the temple and a swap button.

Online (`NP.CATALOG` id `lavatide`, two seats, the host picks the level to
start at): the host is lava and runs the world; the guest is tide and sends
only its keys, every step's keys since the host last acknowledged them, as
`lavatide:i`. The host plays them back one per step, in order, so tide moves
on the host exactly as it did on the guest, a few steps later, and sends the
state back (`lavatide:s`, 20 a second, 6 over the relays) with the last key it
used. The guest puts that state down and replays its newer keys on top,
moving only tide (lava comes from the snapshots and glides between them), so
its own character answers at once and a guess about lava can never end the
level. When the host has no key for tide yet it holds tide still for the step
rather than guess, so every key is played exactly once and tide goes exactly
where it went for the guest: `check-lavatide.mjs` runs that protocol over a
late, lumpy wire and expects zero corrections. Either player can ask for a restart or the next
level (`lavatide:ask`); the host checks that it makes sense. A guest who walks
out leaves the host driving both, the way alone works; a host who walks out
offers the guest the same level alone.

Saves: `mrhakan98-lavatide-best` (best rank, time and gems per level) and
`mrhakan98-lavatide-prefs` (keyboard or alone).

Tests: `check-lavatide.mjs` holds the rules, replays every solution twice
(both doors, every gem, inside par, the same frame both times), checks the
wire and runs a few thousand seeded random-key runs on every level;
`browser-lavatide.mjs` plays level 1 with real keys, checks the save across a
reload, pausing and minimising, finishes every level alone, plays on a phone
with the thumb buttons, and plays two browsers through the lobby in
`same browser` mode to the end of a level. `lavatide-preview.mjs` draws
`join/lavatide/preview.jpg`.
