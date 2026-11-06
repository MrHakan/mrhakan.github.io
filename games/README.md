# games

Every game here is at least two files — `<name>-data.js` (content) and
`<name>.js` (engine) — loaded on demand by `extras.js` and rendered into
a window from `createAppWindow()`. No build step, no framework, no
bundler.

Three of the files are not a game:

- **`netplay.js`** — lobbies, invite codes and transports, shared by
  every multiplayer game on the site.
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

| | cleared | a clear, in bot minutes | level at the boss |
| --- | --- | --- | --- |
| the recycle bin | 85% to 100% | 2.5 to 8 | 4 to 9 |
| the registry | 55% to 97% | 3.5 to 11 | 5.5 to 11 |
| the blue screen | 30% to 85% | 4.5 to 14 | 6.5 to 13 |

and easy above normal above hard, the boss between 40 seconds and 4 minutes, and failures
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
        options: [              // the lobby offers these to the host, and shows the guests
            { key: 'mode', label: 'teams', values: [['1', '1 v 1'], ['2', '2 v 2']] }
        ],
        blurb: 'a low poly shooter: draw sigils to load your staff',
        scripts: ['games/wizardz/wizardz-data.js', 'games/wizardz/wizardz.js']
    }
];
```

`teams` and `options` are optional and a game that has no use for them leaves them out.

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
recogniser to their targets, and `check-dungeonz.mjs` the raid's;
`.github/scripts/browser-check.mjs` opens the real site in chromium,
draws a sigil with the mouse and runs a two-tab lobby;
`browser-wizardz.mjs` plays a match to the end with a real mouse, a phone with
real touches, every map, a 4 v 4 with bots to the end, a 2 v 2 with two browsers and bots
including somebody walking out, loadout ids typed in and refused, a guest trying to cast what
it does not carry, and two browsers direct and over the relays;
`browser-dungeonz.mjs` takes a raid from the address bar to a cleared dungeon, draws a
fireball, measures the frame rate in a crowd, and plays it on a phone and in two browsers;
`.github/scripts/check-netplay.mjs` and `browser-netplay.mjs` hold the ways
online to what happens when the network misbehaves. They all run in CI on
every push, and the Pages deploy waits for them. `npm run relays` is the one
that talks to the real relays, so it is not part of that.
