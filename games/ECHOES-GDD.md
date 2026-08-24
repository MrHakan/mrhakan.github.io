# ECHOES OF THE TIDE: LEVIATHAN'S WAKE
### Game Design Document · v2.0 · implementation spec

A grimdark RPG for the mrhakan 98 desktop. Vanilla JS, Canvas 2D, no
build step, runs in a retro window, saves to LocalStorage.

Three files implement this document:

| file | holds |
| --- | --- |
| `games/echoes-core.js` | the save engine (checksum, backup, export/import, migration) and the event bus |
| `games/echoes-data.js` | every realm, guild, creature, catch, recipe, rune, line of dialogue and scrap of lore |
| `games/echoes.js` | the rules: formulas, the nemesis engine, the dungeon graph, the forge, the line, the UI |

The engine knows no content and the content knows no rules.

**On the numbers.** Where this document states a constant, that constant
is in the source under the same name and `.github/scripts/check-echoes.mjs`
fails the build if it drifts. Where a number was **measured** rather than
specified — the bestiary, the nemesis scaling, the boss statistics — it
says so, and the measurement is a few thousand simulated fights against a
reference build. Two places where the original specification and a
playable game could not both be had are marked **deviation** and explain
themselves.

---

## Module 1 — Lore, world and narrative architecture

### 1.1 The Sunken Firmament

```
                 [ SKY (dark, and full of fog) ]
                                |
             ===== [ SURFACE IRON PLATFORMS ] =====
              The Rust Shallows          0 – 100 m
                                |
             ~~~~~ [ SUNKEN MIST & REEF ] ~~~~~
              The Whispering Reefs     100 – 500 m
                                |
             ▼▼▼▼▼ [ LEVIATHAN DEEP ] ▼▼▼▼▼
              The Leviathan Trench     500 – 2000 m
                                |
             ░░░░░ [ THE ANCIENT SUNKEN BEACON ] ░░░░░
              The Drowned Spire            2000 m +
```

Three hundred years ago the **Celestial Sun** broke out of the sky and
fell into the deepest trench in the ocean. The seas rose to meet the hole
it left and the continents went under entire. What is left of humanity
floats: iron rigs lashed together with chain, towns built on dead
Leviathan skeletons, and a few sheer rock towers that used to be
mountains.

**The Abyssal Rot.** The deep is not only water. It is poisoned with the
radiation the Sun gave off on the way down and with the essence of things
that were already living at that depth.

**Marrow** is rendered out of Leviathan bone and deep flesh. It is an
energy source, an alchemical fuel and a curse that mutates the human mind
by degrees. It is also the game's third resource pool, alongside stamina
and sanity.

**Sanity** is a second health bar that only the deep attacks. Below 25 the
interface stops being a reliable narrator — enemy health bars and
weaknesses are shown wrong. At zero, the Tide picks 30% of your turns.

### 1.2 The three guilds of the rigs

| guild | leader & seat | creed | mechanical identity |
| --- | --- | --- | --- |
| **The Ironclad Syndicate** | Chief Engineer Vaelen Voss · The Grand Anvil | "Flesh is weak. Steel does not sink." | +8 forge quality, half-price repairs, +8% armour |
| **The Veil Dredgers** | Matriark Nahesia · The Drowned Hollow | "The deep is not our enemy. It is our womb." | −30% sanity loss, +10% abyssal damage, +2 angling luck |
| **The Ash Inquisitors** | High Priest Ignis Malakor · The Pyre-Spire | "The dark must be cleansed. The Sun must rise again." | +20% burn, +15% against monsters, immune to fear |

The Dredgers and the Inquisitors will not have each other. The Syndicate
deals with everybody and is trusted by nobody.

### 1.3 The campaign — three acts

```
                     [ ACT I: The Rust Shallows ]
              (a murder on the landing & the shattered map)
                                  |
                     [ ACT II: The Whispering Reefs ]
           (three guilds, one beacon core, and a decision)
                                  |
             +--------------------+--------------------+
             |                    |                    |
        Syndicate            Dredgers            Inquisitors
             |                    |                    |
             +--------------------+--------------------+
                                  |
              [ ACT III: The Trench and the Sunken Beacon ]
                        (Morvath · the Drowned Archon)
                                  |
             +--------------------+--------------------+
             |                    |                    |
      [ The Iron Age ]  [ Leviathan's Awakening ] [ Cleansing Pyre ]
```

**Act I.** You dredge scrap out of wrecks for a living. A harpoon line
comes up with a piece of Leviathan bone cut with sun-runes, and one of
the runes is warm. It is the first fragment of the shattered map of the
Heart of the Sun, and all three guilds know your name by morning.

**Act II.** The rest of the map is in the Reefs. The **Choir of the Reef**
is holding the beacon core; killing it puts `item_marrow_core_t3` in your
hands, and the turning point of the campaign is which guild you hand it
to. The two you refuse release Nemesis captains at you **by name** —
implemented as the `trigger_nemesis_alert` dialogue action, which mints
new Lords with a standing grudge and sets them hunting.

**Act III.** Down to the floor of the world, through Morvath and up the
inverted Spire to the Drowned Archon, and the choice behind it.

**The three endings** are in §6.4.

### 1.4 Dialogue and skill checks

Node-based JSON. A node carries `entry_text` and, optionally, a
`sanity_threshold` with `sanity_altered_text` — below the threshold the
speaker has not changed, the listener has.

```json
{
  "dialogue_id": "dlg_vaelen_act2_01",
  "npc_id": "npc_vaelen_voss",
  "speaker_name": "Chief Engineer Vaelen Voss",
  "entry_text": "Get inside before the brine eats through your seals. Did you bring the Marrow Core, or are you here to waste my steam?",
  "sanity_threshold": 30,
  "sanity_altered_text": "The pipes... they are singing your name, diver.",
  "options": [
    { "option_id": "opt_hand_over",
      "condition": { "required_item": "item_marrow_core_t3",
                     "min_reputation": { "faction": "syndicate", "value": 10 } },
      "actions": [ { "type": "remove_item", "item_id": "item_marrow_core_t3", "count": 1 },
                   { "type": "add_reputation", "faction": "syndicate", "value": 25 },
                   { "type": "link_dialogue", "target": "dlg_vaelen_reward" } ] },
    { "option_id": "opt_skill_intimidate",
      "skill_check": { "attribute": "might", "difficulty": 16,
                       "success_target": "dlg_vaelen_intimidate_success",
                       "failure_target": "dlg_vaelen_intimidate_fail" } }
  ]
}
```

**Check resolution:** `d20 + floor(attribute / 2) ≥ difficulty`. A natural
20 always passes and pays 250 experience on the way past; a natural 1
always fails and costs sanity.

**Action types the engine understands:** `remove_item`, `give_item`,
`add_reputation`, `modify_sanity`, `add_coin`, `add_xp`, `set_flag`,
`unlock_codex`, `unlock_realm`, `advance_act`, `join_faction`,
`trigger_nemesis_alert`, `trigger_ending`, `link_dialogue`,
`exit_dialogue`. Anything else fails the build.

---

## Module 2 — Combat, attributes and statistical balancing

### 2.1 The attribute matrix

```
[ PRIMARY ]                       [ DERIVED ]
  ├── Might        ──────►  physical damage, carry weight, block
  ├── Finesse      ──────►  critical strike, dodge, action speed
  ├── Attunement   ──────►  abyssal damage, Marrow pool, madness resistance
  ├── Fortitude    ──────►  maximum health, armour multiplier, rot resistance
  └── Perception   ──────►  hit rate, angling and salvage luck, weak points
```

| attribute | per point |
| --- | --- |
| Might | +1.5% physical damage, +0.8 block, +2 carry |
| Finesse | +0.25% critical chance, +0.35% dodge, +0.5% action speed |
| Attunement | +1.8% abyssal damage, +5 Marrow, +0.5 sanity resistance |
| Fortitude | +12 health, +0.4% natural armour, +1% rot resistance |
| Perception | +0.4% hit chance, +0.75% critical damage, +1 treasure find |

```
MaxHealth  = 100 + Fortitude × 12 + (Level − 1) × 30
MaxStamina =  90 + (Level − 1) × 2 + Fortitude × 1.5
MaxMarrow  = Attunement × 5 + gear
MaxSanity  = 100
```

Start: 8 / 8 / 8 / 8 / 8 and five free points. Per level: **+3 attribute
points and +1 skill point**.

### 2.2 Armour mitigation — a curve, not a subtraction

```
Mitigation = Armour / (Armour + K)          K = 350
NetDamage  = RawDamage × (1 − Mitigation)
```

350 armour is exactly 50% mitigation and 1050 is exactly 75%. Stacking
armour approaches 100% and never arrives, so nothing in the game — player
or boss — is ever untouchable. Piercing attacks halve the armour before
the curve sees it.

### 2.3 Damage output

```
Raw = WeaponDamage × (1 + StatBonus) × AbilityMultiplier × Variance
      Variance ∈ [0.95, 1.05] uniform
Net = Raw × ElementMultiplier × (1 − Mitigation)
      ElementMultiplier: ×1.5 weakness, ×0.5 resistance, ×0 immunity
If critical:  Net × CritMultiplier
CritChance     = Finesse × 0.25% + gear + Perception × WeakpointSeeker
CritMultiplier = 1.5 + Perception × 0.75% + Killing Tide + curses
```

### 2.4 Hit, dodge and the glancing blow

```
Threshold = clamp(0.85 + (attackerHit − targetDodge), 0.05, 0.99)
roll ≤ Threshold                      → hit
roll ≤ Threshold + 0.10               → glancing blow: 50% damage, cannot crit
otherwise                             → miss
```

### 2.5 Sanity

```
SanityLoss = base × (1 − min(0.75, SanityResist / 100)) × (1 − SanityWard)
SanityResist = Attunement × 0.5 + gear
```

| sanity | effect |
| --- | --- |
| < 75 | uneasy |
| < 50 | fraying |
| **< 25** | illusions: enemy health and weaknesses are displayed wrong |
| **0** | panic: a 30% chance each turn to lose the turn entirely |

### 2.6 Levels 1 → 50

The document publishes a **table**, not a formula, so the table is the
authority: these seven levels come out to the digit and the levels between
them are interpolated in log space, which keeps the curve monotone.

| level | to next | base health (Fortitude 10) | unlocks |
| --- | --- | --- | --- |
| 1 | 150 | 220 | basic attack, tier 1 skills |
| 5 | 2,214 | 340 | **tier 2 skills** |
| 10 | 7,532 | 490 | **the off-hand slot** |
| 20 | 26,890 | 790 | Nemesis hunt contracts, advanced sockets |
| 30 | 56,710 | 1,090 | **tier 4 ultimates** |
| 40 | 96,540 | 1,390 | Abyssal Trench licence, legendary patterns |
| 50 | 145,980 | 1,690 | the Archon stat cap, Masterwork crafting |

> **Note.** The original table's cumulative column contradicts its
> per-level column — at level 5 it gives 5,640 cumulative, which levels 1
> to 4 cannot reach when level 1 costs 150 and level 5 costs 2,214. The
> per-level column is the one that drives play and is the one implemented.

### 2.7 The three skill trees

Four tiers, gated at levels **1 / 5 / 15 / 30**. Five ranks a node (three
on an ultimate), one skill point a level.

**Marrow-Smith** (Syndicate — tank and heavy crusher)

- **Steam Vent Slam** · 20 stamina, 2 cooldown · weapon damage ×1.40, and
  **Shattered Armour**: −25% of the target's armour for two turns.
- **Heavy Plating** · passive · +6% total armour per heavy piece worn.
- **Marrow Shield Overload** · 35 stamina, 4 cooldown · a barrier worth
  150% of your armour; when it breaks it detonates for what it absorbed.
- plus Tempering, Anvil Stance, Reinforce, Marrow Furnace, The Grand Anvil.

**Tide-Weaver** (Dredgers — occult, high risk and high reward)

- **Abyssal Grasp** · 25 Marrow + 5 sanity, 1 cooldown · ×1.80 abyssal and
  a one-turn stun.
- **Blood Brine Transfusion** · 15 sanity, 3 cooldown · restore 30% of
  maximum health, then 15 Marrow a turn for three turns.
- **Madness Resonance** · passive · below 50% sanity, abyssal damage +35%.
- plus Sanity Ward, Deep Sight, Pressure Skin, Chum the Water, Drowned Communion.

**Harpooner** (Inquisitors — range, bleed and execution)

- **Barbed Impale** · 18 stamina, 1 cooldown · ×1.20 piercing, then **Deep
  Hemorrhage**: 40% of Might a turn for three turns.
- **Leviathan Execution** · 40 stamina, 5 cooldown, tier 4 · a guaranteed
  critical for ×2.20, **doubled** below 30% of the target's health.
- **Weakpoint Seeker** · passive · 20% of Perception converts directly
  into critical strike chance.
- plus Sure Footing, Burn Oil, Reel In, Trophy, Killing Tide.

---

## Module 3 — The "Drowned Lords" nemesis system

### 3.1 The Drowned Admiralty

```
                      ┌───────────────────────────┐
                      │    ABYSSAL OVERLORD       │  1 seat
                      └─────────────┬─────────────┘
            ┌───────────────────────┴───────────────────────┐
    ┌───────────────────┐                           ┌───────────────────┐
    │  TRENCH WARLORD   │  4 seats                  │  TRENCH WARLORD   │
    └─────────┬─────────┘                           └─────────┬─────────┘
       ┌──────┴──────┐                                 ┌──────┴──────┐
   [CAPTAIN]     [CAPTAIN]     12 seats            [CAPTAIN]   [CAPTAIN]
```

| tier | rank | seats | health × | damage × | guards |
| --- | --- | --- | --- | --- | --- |
| 0 | Brine Scum | unlimited | 1.0 | 1.0 | — |
| 1 | Deck Captain | **12** | 1.8 | 1.3 | 2–3 |
| 2 | Trench Warlord | **4** | **1.3** *(deviation)* | **1.35** *(deviation)* | 4–6 |
| 3 | Abyssal Overlord | **1** | **5.2** *(deviation)* | **1.9** *(deviation)* | endless |

```
PowerIndex = level + tier × 3, and +1 every time it kills you
MaxHealth  = (120 + PowerIndex × 34)  × creature × rankHealth
BaseDamage = (6   + PowerIndex × 3.6) × creature × rankDamage
Armour     = (25  + PowerIndex × 4)   × creature
```

> **Deviation — the Warlord and Overlord multipliers.** The original spec
> gives 3.2× and 6.0× health with 1.7× and 2.4× damage, and pairs them
> with a worked example: a Deck Captain of 1850 health, 85 damage and 180
> armour against a level-12 diver of 532 health. Simulated, that captain
> kills the example character in seven rounds and takes twenty-eight to
> die — the two halves of the example do not describe a fight. The
> *formula shape*, the seat counts, the hierarchy, the memory rules and
> the JSON schema are all the specification's; the multipliers are
> measured, and the measurement is in §6.5.

### 3.2 Memory and mutation

```
                        [ ENCOUNTER RESULT ]
         ┌────────────────────────┼────────────────────────┐
  [ PLAYER DIED ]         [ PLAYER FLED ]        [ IT WAS WOUNDED ]
         │                        │                        │
  * a nameless one          * gains Coward-Scent     * permanent scar
    takes a seat            * +25% to ambush           or immunity
  * +1 power index          * goes hunting           * fear, or a counter
  * a title, from
    how you killed
```

**A nameless thing that kills a diver has a name by morning.** Brine Scum
that lands the killing blow is promoted straight into a Deck Captain seat
— and if all twelve are taken, the weakest incumbent is shouldered out.

| how it beat you | title granted |
| --- | --- |
| bleed | the Carver |
| burn | the Kindled |
| abyssal | the Hollow |
| physical | the Harpoon-Breaker |
| crushing | the Anvil |
| you ran | the Patient |
| sanity reached zero | the Chorus |
| it survived your fire | the Pyre-Scarred |
| it lost an eye to you | the One-Eyed |

Two kills and it starts looking at the seat above it. Promotion takes a
seat off the weakest incumbent, who is **demoted rather than removed** and
who remembers it — `+2 grudge` and a `demoted` memory.

### 3.3 Strengths, weaknesses, enrages and phobias

| kind | name | effect |
| --- | --- | --- |
| immunity | Brine-Plated | bleed and rot do nothing |
| immunity | Abyssal Attuned | absorbs 75% of abyssal damage **as health** |
| immunity | Pyre-Scarred *(earned)* | immune to burn, and may develop a fear of it |
| enrage | Blood Frenzy | below 30% health: +50% damage, defence to nothing |
| enrage | Hate of Steam | enrages the instant a steam ability lands |
| weakness | Brittle Shell | crushing strips its armour 50% faster |
| weakness | One-Eyed *(earned)* | attacks from behind land 50% harder |
| weakness | Coward-Scent *(earned)* | +25% to ambush you, and it can be hunted |
| phobia | Terrified of Flares | a flare or Sun relic makes it cower two turns |
| phobia | Phobia: Ash Fire | it has burned once and will not stand for it again |

### 3.4 Ambush

```
P(ambush) = clamp(0.05 + 0.04 × grudge + CowardScent(0.25) + hunting(0.08), 0, 0.65)
```

Grudge runs 0–5 and rises every time it survives you, every time you run,
and every time it kills you.

---

## Module 4 — Crafting and life skills

### 4.1 The Deep-Forge

```
[ STOCK ] ─► [ HEAT ] ─► [ THREE HAMMER STRIKES ] ─► [ QUENCH ]
             (a window)   (a moving sweet spot)      (locks the roll)
```

| tier | material | forge window | stat scale | sockets |
| --- | --- | --- | --- | --- |
| 1 | Scrap Iron | 300–450 °C | 1.00 | 0 |
| 2 | Abyssal Bronze | 500–700 °C | 1.25 | 1 |
| 3 | Chitin Plate | 750–950 °C | 1.55 | 1 |
| 4 | Leviathan Bone | 1000–1250 °C | 1.90 | 2 |
| 5 | Celestial Core | 1400 °C + (Marrow-fed) | 2.40 | 3 |

```
Quality = HeatScore(0..60) + StrikeScore(0..40)          → 0..100
HeatScore   = 60 × max(0, 1 − |temp − optimum| / (tolerance × 2.2))
StrikeScore = Σ 13.3 × max(0, 1 − |marker − sweet| / (half × 2.4))
```

`tolerance` is half the material's window, widened by **Marrow Furnace**.
The Syndicate adds a flat +8, **The Grand Anvil** up to +20.

| quality | band | stats | durability | extra affixes |
| --- | --- | --- | --- | --- |
| 0–39 | **Defective** | ×0.80 | halved | — |
| 40–74 | **Standard** | ×1.00 | — | — |
| 75–94 | **Masterwork** | ×1.15 | — | +1 |
| 95–100 | **Abyssal-Forged** | ×1.30 | — | +2, and it glows |

A forged piece cannot come off the anvil below the floor its band sets:
Standard → Sturdy, Masterwork → Abyssal Rare, Abyssal-Forged → Dread Epic.

### 4.2 Rarity, prefixes and suffixes

| rarity | colour | prefixes | suffixes | sockets | budget |
| --- | --- | --- | --- | --- | --- |
| Common | `#FFFFFF` | 0 | 0 | 0 | ×1.0 |
| Sturdy | `#2ECC71` | 1 | 0 | 0–1 | ×1.2 |
| Abyssal Rare | `#3498DB` | 1 | 1 | 1–2 | ×1.5 |
| Dread Epic | `#9B59B6` | 2 | 1 | 2–3 | ×1.9 |
| Relic Mythic | `#E67E22` | 2 | 2 | 3 | ×2.5 |
| Cursed | `#E74C3C` | 3 | 1 | 1 | ×3.2 |

An item's name is assembled from them: *Brine-Hardened Leviathan Cleaver
of the Abyssal Nightmare*. Cursed pieces are deliberately strong and carry
a real cost — **Leaking Seals** is +50% physical damage for −4 sanity every
turn of every fight.

### 4.3 Marrow infusion

Runes are found, never crafted. **Crimson Marrow** (+8 bleed on every
hit), **Abyssal Pearl** (+12 sanity resistance, +5% magic defence) and
**Sun Shard** (10% chance of Sun Blindness — which is exactly what a
Nemesis phobia is waiting for), plus five more.

### 4.4 Angling and dredging

Fishing is how you reach alchemical stock, sunken strongboxes, blueprints
and, occasionally, a boss.

```
force   = pull × (bursting ? 1.7 : 1)
rise    = force × 60 / (rod + 20) + reel × 0.22
tension = tension + (holding ? rise : −42) × dt        dt = 1/60
```

- The **green band is 40–80**. Only inside it does the fish's stamina fall,
  at `14 + reel × 0.5` a second. Below 40 it recovers.
- Above **100** the line snaps and the rod loses durability.
- A surge arrives as a **jerk**, not a ramp: when a burst starts while you
  are holding, tension jumps by `pull × 1.7 × 20 / (rod + 20)` at once.
  Without that, a player reacting every tick could hold any fish on any
  rod for ever and rod strength would mean nothing.

| catch | where | what it is for |
| --- | --- | --- |
| Ironscale Cod | Shallows | food: +150 health cooked |
| Bioluminescent Eel | Reefs | alchemy: Glow Elixir |
| Void Gazer | Trench | +50 Marrow, −10 sanity, and one random skill gains a rank |
| Sunken Syndicate Safe | wrecks | ore, coin and blueprints |
| Lesser Kraken Spawn | Black Tide | an immediate boss fight |

**Black Tide** (the night current) costs sanity per cast and carries a
15–26% chance that what comes up is a fight.

---

## Module 5 — Realms, the dungeon engine and bosses

### 5.1 Environmental hazards

| realm | depth | hazard | the answer |
| --- | --- | --- | --- |
| The Rust Shallows | 0–100 m | **Tetanus Rust** — armour sheds 1% a turn | Purified Oil |
| The Whispering Reefs | 100–500 m | **Spore Hallucination** — −5 sanity every third turn, and phantom enemies | Dredger Respirator |
| The Leviathan Trench | 500–2000 m | **Abyssal Pressure** — 3% of maximum health a turn, −30% speed | Pressure-Braced Titanium Suit |
| The Drowned Spire | 2000 m + | **Solar Void Radiation** — healing −60%, a burn that accumulates | Sun-Insulated Ash Plate |

The hazard, not the monsters, is what actually stops an under-equipped
diver going deep. See the note in §6.5.

### 5.2 The dungeon is a graph

Directed, acyclic, one entrance, one boss at the bottom. Every connection
points forward exactly one floor, so a cycle is not representable; every
node is reachable from the entrance, and the build fails if forty
generated dungeons do not all satisfy both.

```
   [FLOOR 1]        [FLOOR 2]         [FLOOR 3]        [FLOOR 4]
                   ┌──► [⚔ combat] ──┐
   [ENTRANCE] ─────┤                 ├──► [⛺ rest] ──┐
                   └──► [❓ event] ──┘                 ├──► [👑 BOSS]
                   ┌──► [📦 salvage] ┐                 │
                   └──► [💀 elite] ──┴──► [⚔ combat] ─┘
```

Node weights: **combat 40 · elite 15 · salvage 15 · mystery 15 · rest 10**,
with elite rising and rest falling as you descend, and combat rising on
the Black Tide.

```
StatMultiplier = 1 + (Depth × 0.25) + (Room × 0.08)
```

**Which creature turns up** is drawn from the realm's roster weighted by
distance from your own level, decaying steeply upward:

```
target = level + floor × 0.6
weight = creature.level > target ? 0.45 ^ (creature.level − target)
                                 : 0.78 ^ (target − creature.level)
```

Without it a level-1 diver meets a Brine Wight on their first walk out of
the harbour, which is not a difficulty spike but the end of the run before
it starts.

### 5.3 Bosses — Morvath, the Trench Behemoth

Three phases, each with its own mechanics, exactly as specified:

| phase | health | armour | mechanics |
| --- | --- | --- | --- |
| 1 — The Armoured Hull | 100–60% | **70%** passive | telegraphed tail sweep (marked one turn ahead, lands the next); **interactable harpoons** — pull the corner levers and its armour is gone for two turns |
| 2 — Ruptured Flesh | 60–20% | 20% | the floor collapses and the arena floods (dodge halved, all fire out); **abyssal bile** across the whole floor; sheds a **Parasitic Leech** every three turns that puts health back into it |
| 3 — The Black Dawn | 20–0% | none | **hard enrage** (+15% damage a turn, compounding), −8 sanity an action, and a **void singularity** opens with a countdown |

The other four — the Anchor-Saint, the Choir of the Reef (which takes you
with it if you finish it below 20 sanity), the Lesser Kraken Spawn and the
**Drowned Archon** — follow the same phase grammar.

---

## Module 6 — Technical architecture and state

### 6.1 The state machine

```
[BOOT] ─► [CREATE] ─► [WORLD] ─┬─► [DUNGEON] ─► [COMBAT] ─► back
              (tile overworld) ├─► [ANGLING]  (canvas)
                               ├─► [FORGE]    (canvas)
                               ├─► [DIALOGUE] ─► [ENDING]
                               └─► sheet · skills · gear · chart · codex · guilds
```

`WORLD` is the only place the player stands. There is no menu screen
behind it: everything the old hub offered is a tile you walk up to.

Modules never call each other directly. `games/echoes-core.js` publishes a
`GameEventBus`; the combat engine announces `PLAYER_DIED` and the nemesis
engine is what cares about it. A listener that throws does not stop the
others hearing the event.

### 6.2 `PlayerProfile`

```json
{
  "save_version": "1.0.4", "save_timestamp": 0, "checksum": "a8f3b4c1e92d0",
  "player": {
    "profile_id": "string", "name": "string(1..18)", "seed": "uint32",
    "level": "int(1..50)", "experience": { "current": "int", "next_level": "int" },
    "attributes": { "might": "int", "finesse": "int", "attunement": "int",
                    "fortitude": "int", "perception": "int", "unallocated_points": "int" },
    "vitals": { "hp": "int", "max_hp": "int", "stamina": "int", "max_stamina": "int",
                "marrow_mana": "int", "max_marrow_mana": "int",
                "sanity": "int", "max_sanity": "int" },
    "equipment": { "main_hand": "ItemSchema|null", "off_hand": "ItemSchema|null",
                   "head": "ItemSchema|null", "body": "ItemSchema|null",
                   "lantern": "ItemSchema|null" },
    "inventory": [ "ItemSchema" ], "materials": { "<id>": "int" },
    "runes": [ "string" ], "quest_items": { "<id>": "int" },
    "skills": { "<skillId>": "int(0..5)" }, "skill_points": "int",
    "known_recipes": [ "string" ],
    "life_skills": { "smithing": { "level": "int", "xp": "int" },
                     "fishing":  { "level": "int", "xp": "int" } },
    "faction_reputation": { "syndicate": "int(-100..100)", "dredgers": "int", "inquisitors": "int" },
    "faction": "syndicate|dredgers|inquisitors|null", "coin": "int",
    "realm": "string", "realms_unlocked": [ "string" ], "act": "int(1..3)",
    "codex": [ "string" ],
    "stats": { "kills": "int", "deaths": "int", "fled": "int", "landed": "int", "lords_ended": "int" }
  },
  "world_state": { "current_day": "int", "time_of_day": "calm_day|black_tide",
                   "current_realm": "string", "story_flags": { "<flag>": "boolean" } },
  "nemesis_roster": [ "NemesisNode" ],
  "engine": { "rng_state": "uint32", "lord_seq": "int", "item_seq": "int",
              "dungeon_seq": "int", "dungeon": "DungeonGraph|null", "ended": "string|null" }
}
```

### 6.3 `NemesisNode` and `ItemSchema`

```json
{
  "nemesis_id": "nem_1", "name": "Karn", "title": "the Harpoon-Breaker",
  "rank": "Deck Captain", "tier": 1, "power_index": 14,
  "faction_origin": "syndicate_mutant", "current_zone": "the_whispering_reefs",
  "status": "active|hunting|retired|dead", "base_creature": "cr_drowned_reaver",
  "level": 11, "grudge": "int(0..5)",
  "visual_traits": { "scar": "blind_left_eye", "mutation": "chitin_armored_shoulder",
                     "weapon": "serrated_steam_cleaver" },
  "combat_profile": { "max_hp": 1850, "current_hp": 1850, "base_damage": 85,
                      "armor": 184, "speed": 12 },
  "traits": { "immunities": [], "enrage_triggers": [], "vulnerabilities": [], "phobias": [] },
  "memories": [ { "event_type": "killed_player", "timestamp_game_day": 4,
                  "location": "the_rust_shallows", "detail": "killed you by burn" } ],
  "dialogue_set": { "intro_encounter": "…", "on_kill_player": "…", "on_flee": "…" }
}
```

```json
{
  "item_id": "itm_1", "recipe_id": "rcp_chitin_harpoon",
  "name": "Serrated Chitin Harpoon of the Trench",
  "rarity": "abyssal_rare", "rarity_name": "Abyssal Rare", "rarity_colour": "#3498DB",
  "quality_band": "masterwork", "quality_score": 88,
  "tier": 3, "slot": "main_hand", "heavy": false,
  "base_stats": { "damage": "int", "armour": "int", "critChancePct": "float" },
  "damage_type": "physical|abyssal|burn", "piercing": "boolean", "permanent_kill": "boolean",
  "affixes": { "prefix": [ { "id": "serrated", "stat": "bleedOnHit", "value": 16 } ],
               "suffix": [ { "id": "of_the_trench", "stat": "maxHp", "value": 60 } ] },
  "sockets": [ { "slot": 1, "gem_id": "gem_crimson_marrow", "bonus": "bleedOnHit +8" } ],
  "durability": { "current": 85, "max": 100 }, "weight": "float", "value": "int",
  "curse": "string|null"
}
```

### 6.4 Persistence

- One LocalStorage key, `ECHOES_OF_THE_TIDE_SAVE`, plus a `_BACKUP` slot.
- **DJB2 checksum** over the document. Not a security measure — nobody is
  being kept out of their own save — a corruption check, so a half-written
  write or a hand-edit that breaks an invariant is caught before the
  engine tries to load a profile with no attributes in it. On failure the
  backup is promoted.
- The backup is written from the *previous* good save, not the current
  one. A backup that is always identical to the primary is not a backup.
- **Base64 export/import** of a whole run, verified and migrated on the
  way in.
- **Migration** runs forward one version at a time, so a save from any
  released version arrives by the same path — and a save from the future
  is refused rather than half-read.
- **Deterministic**: the run stores its seed and the RNG state, so the
  admiralty, the dungeon graphs and the loot rolls replay identically.

### 6.5 Balance, as measured

`.github/scripts/check-echoes.mjs` runs a few thousand fights against a
reference build (spread 32/20/24/14/10, quality-70 gear of the realm's
tier, one skill point a level down the Harpooner line) and fails the build
if any of these drift.

| metric | target | measured |
| --- | --- | --- |
| level-appropriate encounter | 80–90% | **88 / 85 / 90 / 87%** |
| the first fight of a run | — | **88%** |
| one realm ahead | 35–55% | **59 / 5 / 3%** *(deviation)* |
| a Deck Captain at level | — | **79%** |
| a Trench Warlord | 45–60% | **54%** |
| the Abyssal Overlord, geared | 30–40% | **37%** |
| the five realm guardians | 45–60% | **50 / 51 / 55 / 35 / 32%** |

> **Deviation — one realm ahead.** From the Reefs down this measures 3–5%
> against a 35% target, and that is a deliberate stop rather than a miss.
> Six levels plus a tier of gear is worth roughly 2.3× in combined damage
> and effective health; no assignment of monster health, damage and armour
> gives 35% to the under-levelled diver without turning the same realm
> into a formality for a properly equipped one. This was re-derived from
> scratch under a subtractive mitigation model *and* under the curve above,
> with the same result, so it is a property of the progression rather than
> of the formula.
>
> The realms are gated instead by the thing §5.1 already specifies: walk
> into the Trench without the pressure suit and it takes 3% of your
> maximum health every turn. The water does the arithmetic before the
> monsters get a turn.

### 6.6 Presentation — the overworld and the battle screen

The game is played on two canvases, in the shape a handheld RPG uses.

**The sprite atlas** (`games/echoes-sprites.js`). Every sprite is written
as an array of equal-length strings, one character per pixel, indexed
into a shared palette. `decode()` paints one into an offscreen canvas
once; `sprite(name, opts)` caches by `name|scale|palette`, so a tile that
appears four hundred times on a map is decoded once and blitted four
hundred times. `draw()` takes an optional palette override, which is how
a Drowned Lord gets a coat colour derived from its `nemesis_id` — the
same Lord is the same colour every time you meet it.

The atlas holds the diver in four facings with a two-frame walk cycle
plus a back view for battle, nine enemy archetypes, fifteen tiles and
three townsfolk.

**The overworld** (`games/echoes-world.js`). A map is an array of rows of
single characters and a legend that says, for each character, which
sprite it uses, whether it is solid, whether it rolls for an encounter,
and what pressing a key while facing it *means*:

| char | tile | facing it does |
|---|---|---|
| `.` `,` `s` | decking, rig plate, wet stone | nothing |
| `k` `"` | kelp, marrow slick | *(walkable; rolls for encounters)* |
| `~` | open water | opens the fishing spots |
| `B` | the moored boat | starts a voyage |
| `A` `F` | anvil, furnace | opens the deep-forge |
| `D` `S` | door, stairs | warps to another map |
| `R` | a rest bunk | rests until the tide turns |
| `c` | crates | reads them |
| `#` `r` `L` | plating, the rail, a lamp post | nothing (solid) |

Movement is grid-locked: a held key starts a step, the step takes eight
frames, and the tile is not committed until it lands. The camera follows
the diver and clamps at the map edges. Encounters roll on arrival, on
encounter tiles only, with a three-step grace period so nothing jumps you
twice in a row, and the Act I opening waits fourteen steps so the landing
gets to be a place before the story interrupts it.

Every realm has its own hub map, and the invariants are tested rather
than trusted: every map rectangular, every character in the legend, every
warp landing on a tile you can stand on, every walkable tile reachable
from the spawn, and every realm with a boat, an anvil and open water
within reach of where you arrive.

**The battle screen.** Your own back on the near platform, the enemy
facing you on the far one, both on shadow ellipses, with health boxes in
the corners. The enemy's silhouette is chosen from its id (or, for a
Lord, from its `base_creature`); the water behind is tinted by the
realm's layer and again by the arena's flags. Damage flashes the sprite
that took it. Names are measured and cut to fit rather than truncated at
a fixed length.

### 6.7 Implementation target

Vanilla JS, no dependencies, no build step. Canvas 2D for the overworld,
the battle screen, the forge and the line; the panels around them are DOM
in a `createAppWindow` retro window, and it obeys the site's
reduced-motion setting through `fx.js`.
