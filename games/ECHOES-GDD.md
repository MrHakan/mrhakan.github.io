# ECHOES OF THE TIDE: LEVIATHAN'S WAKE
### Game Design Document · v1.0 · implementation spec

A grimdark 2D RPG for the mrhakan 98 desktop. Vanilla JS, Canvas 2D, no
build step, runs in a retro window, saves to LocalStorage.

Two files implement this document:

| file | holds |
| --- | --- |
| `games/echoes-data.js` | every realm, faction, creature, fish, recipe, rune, dialogue tree and line of prose |
| `games/echoes.js` | the rules: formulas, nemesis engine, tide clock, dredging, forge, dungeon dealer, UI |

The engine knows no content and the content knows no rules. Everything
in §2, §3 and §4 below is implemented literally — the constants named
here are the constants in the source.

---

## 1. LORE & NARRATIVE ARCHITECTURE

### 1.1 The Sunken Firmament

Three hundred years ago the Celestial Sun came out of the sky and went
into the Mariana Trench, and the sea rose to meet the hole it left. The
water has never gone back down. What is left of the world floats: iron
rigs lashed together, spires that were mountains, and the carcasses of
Leviathans — which do not rot, and which are large enough to build a
city on, and which are not reliably dead.

There is no daylight. There is **tide**, and there is the deep glow of
the Sun still burning somewhere under thirty thousand feet of black
water, which is the only reason anything grows.

Humanity did not survive the Tide. Roughly forty thousand people did.

### 1.2 The Three Factions

| faction | who they are | what they want | mechanical identity |
| --- | --- | --- | --- |
| **The Ironclad Syndicate** | metallurgists, rig-engineers, marrow-renderers | keep the rigs floating; burn Leviathan marrow for steam | Fortitude/armour, superior smithing, cheaper repairs |
| **The Veil Dredgers** | mystic anglers, deep-sea occultists | speak to what is down there; it speaks back | Attunement/abyssal damage, sanity resistance, rare dredging |
| **The Ash Inquisitors** | zealots with fire and doctrine | burn the mutated, reignite the Sun | Might/burn damage, immunity to fear, no dealings with the deep |

Joining one closes another: **Dredgers and Inquisitors will not have
each other**. The Syndicate deals with everybody and is trusted by
nobody.

### 1.3 The Storyline — "The Heart of the Sunken Beacon"

Four acts, gated by realm access, resolved by faction and by what the
player did rather than what they said.

- **Act I — Rust and Rumour** (Rust Shallows). A dredger's line comes up
  with a piece of worked brass that is warm. It should not be warm.
- **Act II — What the Reefs Repeat** (Whispering Reefs). The mist plays
  back conversations that have not happened yet. One of them is yours.
- **Act III — The Pressure Line** (Leviathan Trench). The Beacon is
  under a dead Leviathan the size of a county, and the Leviathan objects
  to being called dead.
- **Act IV — The Drowned Spire**. Vertical, collapsing, and the Heart is
  at the bottom, which is up.

**The moral spine:** the Beacon can be relit. Relighting it burns the
Abyss out of the water — and everything living in the water is now made
of Abyss, including roughly a third of the people on the rigs, including
possibly the player. There is no option in which nobody is lost.

**Four endings** (§7.4), none of them clean.

### 1.4 Dialogue System

Node-based, JSON, with skill checks. A node:

```json
{
  "id": "harbourmaster_2",
  "speaker": "Harbourmaster Vell",
  "text": "You want the trench chart. Nobody wants the trench chart.",
  "choices": [
    { "text": "I have coin.", "check": { "skill": "bribe", "dc": 12 },
      "pass": "vell_sold", "fail": "vell_insulted", "cost": { "coin": 40 } },
    { "text": "[Abyssal Lore] The chart is already wrong.",
      "check": { "skill": "abyssal_lore", "dc": 14 }, "pass": "vell_impressed", "fail": "vell_confused" },
    { "text": "[Intimidate] Nobody has to know.",
      "check": { "skill": "intimidate", "dc": 13 }, "pass": "vell_afraid", "fail": "vell_guards" },
    { "text": "Then I will find it myself.", "goto": "vell_end" }
  ]
}
```

**Check resolution** (§2.5): `d20 + skillMod ≥ dc`. Skills are derived
from attributes, not bought:

| dialogue skill | derived from |
| --- | --- |
| `abyssal_lore` | Attunement / 4 + codex entries read / 6 |
| `strength` | Might / 4 |
| `bribe` | Perception / 6 + floor(log10(coin)) |
| `intimidate` | max(Might, Attunement) / 5 + notoriety |

**Notoriety** = number of Drowned Lords the player has permanently
killed. Intimidating a harbourmaster works better when the last thing
you did was put a Warlord's head on the dock.

---

## 2. CORE COMBAT & STATISTICAL BALANCING

### 2.1 Attributes

| attribute | governs |
| --- | --- |
| **Might** | physical damage, carry weight, `strength` checks |
| **Finesse** | crit chance, dodge, hit chance |
| **Attunement** | abyssal damage, sanity resistance, `abyssal_lore` |
| **Fortitude** | max HP, armour scaling |
| **Perception** | dredging luck, trap detection, `bribe` |

Start: **8 / 8 / 8 / 8 / 8**, plus **+3 free points**.
Per level: **+3 points**, and **+2 extra** on every 5th level.
Soft cap 60 per attribute; the curves below flatten hard past 50.

### 2.2 Derived values

```
MaxHP      = 40 + Fortitude * 6 + Level * 8
MaxStamina = 8  + floor(Finesse / 4) + floor(Fortitude / 6)
MaxSanity  = 50 + Attunement * 2                       (cap 120)
CarryWeight= 20 + Might * 2
Armour     = Σ(gear.armour) * (1 + Fortitude / 120)
```

### 2.3 Damage — the required form

```
Damage = RawDamage * (1 + Stat / 100) - (Armour * MitigationFactor)
```

with, in the implementation:

| term | value |
| --- | --- |
| `RawDamage` | `weapon.base * swing`, `swing ∈ [0.85, 1.15]` uniform |
| `Stat` | Might for physical, Attunement for abyssal, whichever the weapon declares |
| `MitigationFactor` | **0.55** baseline; `0.55 * (1 - penetration)` if the attack pierces |
| floor | damage never drops below **10% of RawDamage** — armour reduces, never deletes |

Elemental multipliers apply after mitigation: `× 1.5` on a weakness,
`× 0.5` on a resistance, `× 0` on an immunity (see scar immunities, §3.4).

### 2.4 Critical strike — curve with diminishing returns

A hyperbola, so the first points of Finesse are worth a great deal and
the fiftieth is worth almost nothing:

```
CritChance = CRIT_CAP * (F / (F + CRIT_K))      CRIT_CAP = 0.60, CRIT_K = 120
             where F = Finesse + gear.critRating

CritMultiplier = 1.5 + 0.005 * Finesse           (cap 2.5)
```

| Finesse | crit chance |
| --- | --- |
| 8 | 3.8% |
| 20 | 8.6% |
| 40 | 15.0% |
| 60 | 20.0% |
| 120 | 30.0% |
| 240 | 40.0% |

### 2.5 Hit and dodge

```
Dodge = DODGE_CAP * (Ft / (Ft + Fa + DODGE_K))   DODGE_CAP = 0.35, DODGE_K = 60
        Fa = attacker Finesse, Ft = target Finesse
HitChance = clamp(1 - Dodge, 0.30, 0.98)
```

Equal Finesse of 20 → dodge 7%. A target with double the attacker's
Finesse → dodge ~12%. Nothing in the game is untouchable.

**d20 checks** (dialogue, traps, dredging events):
`roll(1..20) + mod ≥ dc`, natural 20 always passes, natural 1 always fails.

### 2.6 Sanity

Sanity is a second health bar that only the deep attacks.

```
SanityLoss = base * (1 - Attunement / 150)
```

| effect | at |
| --- | --- |
| whispers (log noise, false enemy names) | < 70% |
| −15% hit chance, hallucinated enemies in dungeon nodes | < 40% |
| the Tide speaks directly; every action costs 1 extra stamina | < 15% |
| **0** | you are not lost. You are *recruited* — the run ends as a Drowned Lord (§3.6) |

Restored by: rest at a Rest Rig, Inquisitor fire-rites, alcohol (with a
Fortitude cost), or killing the thing that took it.

### 2.7 Level progression, 1 → 50

```
XPToNext(L) = round(50 * L^1.9)
```

| level | to next | cumulative |
| --- | --- | --- |
| 1 | 50 | 50 |
| 5 | 1,064 | 2,400 |
| 10 | 3,972 | 15,744 |
| 20 | 14,823 | 109,755 |
| 35 | 42,924 | 539,705 |
| 49 | 81,347 | 1,415,426 |

Per level: +3 attribute points (+2 more on multiples of 5), **+1 skill
point**, full HP/stamina restore, +5 sanity.

### 2.8 Skill trees

Three trees, 8 nodes each, max 5 ranks on a node, one skill point per
level (50 points, 120 possible ranks — you cannot have it all).

**Marrow-Smith** (Ironclad): Tempering (+armour), Marrow Furnace (forge
quality), Socketing, Salvage, Reinforce, Steam Vent (stamina), Anvil
Stance (block), Masterwork (rarity odds).

**Tide-Weaver** (Dredger): Abyssal Bolt, Deep Sight (see traits without
a reading), Sanity Ward, Leech Tide (heal on abyssal damage), Pressure
Skin, Whisper (enemy skips a turn), Chum the Water (dredging), Drowned
Sight (reveal nemesis weakness).

**Harpooner** (Inquisitor/neutral): Harpoon Throw, Barbed (bleed),
Sure Footing (dodge), Burn Oil (fire), Reel In (pull + stun), Second
Line (extra attack at low HP), Trophy (extra loot), Killing Tide (crit
damage).

---

## 3. THE "DROWNED LORDS" NEMESIS SYSTEM

### 3.1 Hierarchy

| rank | count | where |
| --- | --- | --- |
| **Captain** | 12 | 3 per realm |
| **Warlord** | 4 | 1 per realm, commands that realm's captains |
| **Abyssal Overlord** | 1 | the Drowned Spire |

The roster is **generated at new-game from the seed** and persists. A
captain who kills the player enough times is promoted into a Warlord
slot, replacing the incumbent — who is *not* removed but demoted, and
remembers it.

### 3.2 Memory & mutation engine

Every event appends to `memories[]` and mutates the node.

| trigger | effect |
| --- | --- |
| **kills the player** | gains a title (§3.3) if untitled, **+20% max HP**, one armour upgrade tier, a new taunt line keyed to how you died |
| **player flees** | gains **`Tracker`** — may ambush at the start of any voyage or dredge in its realm |
| **survives an attack type** | scar immunity roll (§3.4) |
| **player kills it** | if the killing blow was a permanent method (Inquisitor pyre, Dredger unmaking, or decapitation with a Leviathan-bone weapon) it is **dead**; otherwise it returns at −1 rank with `Poorly Drowned` and a grudge |
| **survives 5 in-game days untouched** | +1 rank progress toward promotion |

### 3.3 Procedural naming

```
Name   = <given> <epithet>            e.g. "Ossian the Carver"
Title  = <the> <deed-noun>            earned, not rolled: derived from how it beat you
```

| how it killed you | title granted |
| --- | --- |
| bleed damage | The Carver |
| burn damage | The Kindled |
| abyssal damage | The Hollow |
| crushing/physical | The Anvil |
| you fled and it caught you | The Patient |
| sanity reached 0 | The Chorus |

**War-cries** are assembled procedurally from `{opener} {claim} {threat}`
fragments and seeded per node, so each Lord's voice is consistent.

### 3.4 Scar immunities

When a Lord survives a fight in which ≥ 30% of the damage it took was of
one element, it rolls `min(0.65, 0.25 + 0.1 * rank)` for a scar:

| scar | grants |
| --- | --- |
| Fire-Blistered | immune to Burn |
| Salt-Cured | immune to Bleed |
| Deaf to the Deep | immune to Abyssal |
| Barnacled | physical damage −30% |

A Lord can hold at most **two** scars: the third overwrites the first,
because the flesh runs out.

### 3.5 Weaknesses — the counterweight

Every mutation writes a matching weakness into the node, so a heavily
mutated Lord is *more* answerable, not just harder:

| mutation | weakness written |
| --- | --- |
| +HP (bloat) | −1 speed, loses initiative more often |
| armour upgrade | +25% damage from armour-piercing (Harpoon, Pin) |
| Tracker | reveals its realm on the map; can be hunted deliberately |
| any scar | −20% resistance to the *other* three elements |

### 3.6 Player death and recruitment

Death does not end a run: the player wakes on the nearest Rest Rig,
−25% coin, and the killer is promoted. **Sanity reaching zero does end
it** — the character is added to the roster as a Drowned Lord in the
next run from the same seed, with their gear.

---

## 4. CRAFTING & LIFE SKILLS ENGINE

### 4.1 Deep-Forge Smithing — five tiers

| tier | material | source |
| --- | --- | --- |
| 1 | Scrap Iron | anything, anywhere |
| 2 | Abyssal Bronze | Rust Shallows wrecks, Reef captains |
| 3 | Chitin Plate | reef and trench fauna |
| 4 | Leviathan Bone | carcass dungeons only |
| 5 | Celestial Core | the Beacon, and four other places |

### 4.2 Heat & quench mini-game

Two-phase precision loop, both on Canvas:

**Phase 1 — Heat.** A bar fills at `dHeat/dt = 1.4 - 0.02 * tier`. A
target band sits at `[0.62, 0.78]` of the bar, narrowed by tier and
widened by Marrow-Smith rank:

```
bandWidth = clamp(0.16 - 0.018 * tier + 0.012 * marrowSmithRank, 0.05, 0.22)
```

Pull at the right moment or the metal is over/under-worked.

**Phase 2 — Quench.** Three hammer strikes; a marker sweeps, a sweet
spot moves each strike. `heatScore + strikeScore` → quality 0..6.

| quality | rarity | affixes | sockets |
| --- | --- | --- | --- |
| 0–1 | **Cursed** | 1 strong + 1 curse | 0 |
| 2–4 | **Standard** | quality − 1 | 1 at q≥3 |
| 5–6 | **Masterwork** | 3 | 2 |

**Cursed** gear is deliberately good: a Cursed piece rolls one affix at
Masterwork strength plus one curse (`−15% sanity max`, `takes 10% more
burn`, `−1 stamina regen`). The Dredgers consider Cursed to be correct.

### 4.3 Socketing & runes

Sockets take runes; runes are found, never crafted.

```
Rune power = base * (1 + 0.15 * socketsFilledOnSameItem)
```

so two runes in one item are worth more than one each in two — the
Syndicate calls this resonance and charges for it. Removing a rune
destroys the rune, never the item.

### 4.4 Tide & day/night

A clock of **8 ticks per day**, advanced by every meaningful action
(voyage, dredge, forge, dungeon node, rest):

```
timeOfDay = ['dawn','morning','noon','afternoon','dusk','night','deep night','witching']
tidePhase = ['low','rising','high','falling'][floor(tick / 2) % 4]
```

| condition | effect |
| --- | --- |
| night ∪ witching | +40% nightmare encounter chance, +25% rare fish |
| high tide | trench and spire nodes flooded: +1 danger, +1 loot tier |
| low tide | wreck nodes open that are otherwise underwater |
| witching + high | **the Leviathan turns over**: every Lord in the realm is awake |

### 4.5 Dredging — line tension physics

Real simulation, integrated at 60 Hz:

```
drag        = fish.strength * (1 + depth / 400) * tidePull * (thrashing ? 1.6 : 1)
reel        = held ? REEL_FORCE * lineFactor : 0       REEL_FORCE = 1.15
              lineFactor = 1 + 0.28 * line.tier + Might / 150
dTension/dt = (drag - reel) * 0.9 + slackPenalty       slackPenalty = 0.25 while thrashing
depth      -= (reel - drag * 0.5) * 0.06               // you are winning if depth falls
snap        when tension > line.threshold  (threshold = 1.0 + line.tier * 0.25 + lineStrength * 0.10)
escape      when depth >= startDepth * 1.4
landed      when depth <= 0
```

Tension integrates **per second** (`dTension/dt`); depth steps **per
tick** at 60 Hz. `lineFactor` is the calibration pass: with a flat
`REEL_FORCE` the depth term's `- drag * 0.5` makes anything stronger
than 2.3 drag asymptotically unlandable regardless of gear, so the line
you are holding and the arm holding it scale the pull. Fish strengths
run 0.55 (rig-cod) to 1.95 (the thing that is fishing back) and start
depths 24–110 fathoms, which puts a matched line at a 10–30 second
fight and a tier-1 line on a trench fish at a snapped line in under two
seconds.

The player holds to reel and releases to give slack. Tension decays at
`0.94/tick` when slack. Deep fish + high tide + a tier-1 line is a
snapped line; that is the lesson.

**Rarity table** (per realm, per tide, per time):

| band | examples | use |
| --- | --- | --- |
| common | rig-cod, brine eel | food, sanity restore |
| uncommon | glasshead, ash minnow | alchemical reagents |
| rare | marrow lamprey, corpse-light squid | rune fodder, faction contracts |
| relic | sunken sextant, drowned reliquary | quest, lore, currency |
| eldritch | *things that are fishing back* | combat encounter, not a catch |

---

## 5. REALMS & DUNGEON ENGINE

| # | realm | tier | character |
| --- | --- | --- | --- |
| 1 | **The Rust Shallows** | 1 | tutorial rig, safe harbour, wrecks at low tide |
| 2 | **The Whispering Reefs** | 2 | corrosive mist, stealth nodes, dialogue-heavy |
| 3 | **The Leviathan Trench** | 3 | pressure gear required, sanity drain per node |
| 4 | **The Drowned Spire** | 4 | vertical, collapsing, endgame |

**Pressure gating:** the Trench needs `pressureRating ≥ 3`, the Spire
`≥ 5`; without it, HP drains per node and the run is short.

**Dungeon loop** — node-based, dealt from a weighted deck that gets
meaner with depth: `Combat · Elite Nemesis · Sunken Treasure · Rest Rig
· Hazard · Lore · Descent · Boss`.

**Which creature turns up** is drawn from the realm's roster weighted by
distance from the player's own level, decaying steeply upward:

```
target = level + 1 + depth * 0.5
weight = creature.level > target ? 0.42 ^ (creature.level - target)
                                 : 0.75 ^ (target - creature.level)
```

A realm's roster spans five or six levels, and drawing from it uniformly
means a level-1 dredger meets a Brine Wight on their first walk out of
the harbour — which is not a difficulty spike, it is the end of the run
before the run has started. With the weighting the first fight of a new
character sits at **90%**, the Wight turns up about one time in forty as
a genuine scare, and depth pushes the whole window up so the bottom of a
dungeon is still the bottom.

**The starting kit** is a Rig Hook, a Tarred Line, a Plate Vest and a
Welder's Hood, at quality 3/3/3/2 — enough armour that the first fight
is a fight rather than a coin flip.

**Boss design** — multi-phase with environmental triggers:

| boss | phases | trigger |
| --- | --- | --- |
| The Rust Mother | 2 | at 50% floods the deck: dodge halved, all fire extinguished |
| Choir of the Reef | 3 | each phase drains 12 sanity; killing it at low sanity kills you too |
| The Turning | 3 | the Leviathan rolls at 66% and 33%: the arena inverts, gear unequips |
| The Beacon's Heart | 4 | rising water each phase; phase 4 is fought at 1 HP by design |

---

## 6. TECHNICAL ARCHITECTURE

### 6.1 `PlayerProfile`

```json
{
  "$schema": "echoes/player/1",
  "id": "string (uuid-ish)",
  "name": "string(1..18)",
  "seed": "uint32",
  "level": "int(1..50)",
  "xp": "int(>=0)",
  "attributes": { "might": "int", "finesse": "int", "attunement": "int",
                  "fortitude": "int", "perception": "int" },
  "unspentAttributePoints": "int(>=0)",
  "skillPoints": "int(>=0)",
  "skills": { "<skillId>": "int(0..5)" },
  "vitals": { "hp": "int", "stamina": "int", "sanity": "int" },
  "equipment": { "mainHand": "ItemSchema|null", "offHand": "ItemSchema|null",
                 "head": "ItemSchema|null", "body": "ItemSchema|null",
                 "line": "ItemSchema|null", "trinket": "ItemSchema|null" },
  "inventory": [ "ItemSchema" ],
  "materials": { "<materialId>": "int" },
  "knownRecipes": [ "string" ],
  "factionReputation": { "ironclad": "int(-100..100)",
                         "dredgers": "int(-100..100)",
                         "inquisitors": "int(-100..100)" },
  "faction": "ironclad|dredgers|inquisitors|null",
  "clock": { "day": "int", "tick": "int(0..7)" },
  "realm": "string", "realmsUnlocked": [ "string" ],
  "act": "int(1..4)", "storyFlags": { "<flag>": "boolean" },
  "codex": [ "string" ],
  "notoriety": "int",
  "stats": { "kills": "int", "deaths": "int", "fled": "int", "landed": "int" }
}
```

### 6.2 `NemesisNode`

```json
{
  "$schema": "echoes/nemesis/1",
  "id": "string",
  "name": "string", "epithet": "string", "title": "string|null",
  "rank": "captain|warlord|overlord",
  "rankProgress": "int(0..3)",
  "realm": "string",
  "baseCreature": "string",
  "level": "int",
  "vitals": { "maxHp": "int", "hpMultiplier": "float", "armourTier": "int(0..5)" },
  "memories": [ { "type": "killed_player|player_fled|survived|wounded|promoted|demoted",
                  "day": "int", "realm": "string", "detail": "string" } ],
  "strengths": [ "string" ],
  "weaknesses": [ "string" ],
  "scars": [ { "id": "string", "immuneTo": "burn|bleed|abyssal|physical" } ],
  "traits": [ "string" ],
  "warCry": "string",
  "taunts": [ "string" ],
  "status": "alive|dead|demoted|hunting"
}
```

### 6.3 `ItemSchema`

```json
{
  "$schema": "echoes/item/1",
  "id": "string",
  "recipeId": "string",
  "name": "string",
  "slot": "mainHand|offHand|head|body|line|trinket",
  "tier": "int(1..5)",
  "rarity": "cursed|standard|masterwork",
  "baseStats": { "damage": "int", "armour": "int", "critRating": "int",
                 "pressureRating": "int", "lineStrength": "int" },
  "damageType": "physical|abyssal|burn",
  "sockets": [ { "runeId": "string|null" } ],
  "affixes": [ { "id": "string", "stat": "string", "value": "int", "curse": "boolean" } ],
  "durability": { "current": "int", "max": "int" },
  "weight": "float",
  "value": "int"
}
```

### 6.4 State persistence

- Single LocalStorage key `mrhakan98-echoes`, one JSON document.
- **Deterministic**: every run stores its `seed`; the nemesis roster, the
  dungeon decks and the loot rolls are all drawn from a seeded xorshift,
  so the same seed replays identically.
- **Compression**: the save is written through a key-shortening pass
  (`attributes` → `a`, `memories` → `m`, …) and integer-packed vitals;
  a full late-game profile stays under the 5 MB LocalStorage budget by
  roughly three orders of magnitude.
- Saves carry `$schema`; a loader that meets an unknown version keeps
  the raw JSON and starts a new run rather than half-reading it.

### 6.5 Implementation target

Vanilla JS, no dependencies, no build step. Canvas 2D for the dredging
and forge minigames only; everything else is DOM in a `createAppWindow`
retro window. Obeys the site's reduced-motion setting through `fx.js`.

---

## 7. BALANCE TARGETS

Measured by `.github/scripts/check-echoes.mjs`, which runs a few thousand
fights against a reference build (attribute spread 34/24/22/12/8, quality-4
gear of the realm's tier, one skill point a level down the Harpooner tree)
and fails CI if any of these drift.

| metric | target | measured |
| --- | --- | --- |
| level-appropriate encounter | 80–90% player win | 86 / 86 / 88 / 92% |
| one realm ahead | 35–55% | 50 / 22 / 34% |
| a Warlord at level | 45–60% | 46% |
| the Overlord, geared | 30–40% first attempt | 35% |
| a realm boss, two levels over it | 45–60% | 61 / 52 / 53 / 55% |
| deaths per full run | 4–10 (the nemesis system needs them) | — |
| run length | 4–8 hours | — |

**On "one realm ahead".** The Reefs → Trench step measures 22%, not the
35% this table asks for, and that is a deliberate stop rather than a miss.
`Damage = Raw * (1 + Stat/100) - Armour * MitigationFactor` is subtractive
on the armour term, so a tier of gear is worth far more than a tier of
anything else: pushing the Trench down to 35% for an under-geared player
made it a 95%+ formality for a geared one, at every combination of hit
points, damage and armour the search tried. The Trench keeps its teeth,
and the pressure gate (§5) is the honest wall — the water does the
arithmetic before the monsters get a turn.

**Reference player levels** used by the balance run — the realms are
entered at roughly 5, 9, 14 and 20, and level 50 is a long post-game:

| realm | entered at | its captains | its warlord |
| --- | --- | --- | --- |
| Rust Shallows | 5 | 3–5 | 5 |
| Whispering Reefs | 9 | 7–9 | 9 |
| Leviathan Trench | 14 | 11–13 | 13 |
| Drowned Spire | 20 | 15–17 | 17 |
| — the Abyssal Overlord | 26 | | 26 |

### 7.4 The four endings

1. **Relight the Beacon** (Inquisitor) — the Abyss burns out of the
   water. So does everyone it had got into. The sun comes back for the
   survivors, and there are fewer of them than there were people.
2. **Drown the Beacon** (Dredger) — the Heart goes back down. The world
   stays dark, stays wet, stays inhabited by everything currently in it,
   and the rigs get another three hundred years of exactly this.
3. **Render the Beacon** (Ironclad) — it is a power source. Cut it up.
   Enough steam for every rig for a thousand years, and the deep gets
   colder, and something down there starts climbing.
4. **Answer it** (no faction; requires Attunement ≥ 40 and every codex
   entry) — the Beacon is not a beacon. It is the Sun, and it is
   conscious, and it went into the trench on purpose, and it has been
   waiting three hundred years for one person to ask it why.
