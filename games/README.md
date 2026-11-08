# games

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
Parties of four bots play 36 runs of every dungeon on as many threads as the machine has,
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
