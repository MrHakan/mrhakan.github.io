/* echoes of the tide: leviathan's wake — content.
 *
 * Every realm, faction, creature, catch, recipe, rune, line of dialogue
 * and scrap of lore. No rules, no formulas, no state: this file is a
 * library the engine reads and never writes.
 *
 * The rules live in games/echoes.js, the save and event layer in
 * games/echoes-core.js, and the contract between all three is
 * games/ECHOES-GDD.md.
 */

window.ECHOES_DATA = (function () {
    'use strict';

    // ---------- the four realms ----------
    // depth is in metres and it is the whole difficulty curve: every layer
    // has a hazard that runs on a timer and a piece of gear that answers it.
    const REALMS = [
        {
            id: 'rust_shallows',
            name: 'The Rust Shallows',
            layer: 1,
            depth: [0, 100],
            act: 1,
            blurb: 'Forty square miles of lashed-together rig floating on the drowned roofs of a city nobody can name any more. Human territory, for a given value of human.',
            long: 'The Shallows are what happens when eleven thousand people agree not to sink. Container-steel walkways, a chapel made from a crane cab, and at low tide the wrecks come up out of the water like teeth.',
            hazard: {
                id: 'tetanus_rust',
                name: 'Tetanus Rust',
                text: 'The brine eats plate. Armour sheds 1% of its value every turn you spend down here.',
                armourDecayPerTurn: 0.01,
                counter: 'purified_oil',
                counterName: 'Purified Oil'
            },
            resources: ['scrap_iron', 'fish_oil', 'steam_fittings'],
            harbour: 'The Grand Anvil docks',
            weather: ['flat grey water', 'rust-coloured rain', 'a fog that smells of hot metal', 'dead calm, which nobody likes']
        },
        {
            id: 'whispering_reefs',
            name: 'The Whispering Reefs',
            layer: 2,
            depth: [100, 500],
            act: 2,
            blurb: 'Coral grown through a sunken telecoms array. The mist repeats conversations. Some of them have not happened yet.',
            long: 'Sound does not behave here. The reef holds it, folds it, and gives it back a week later in the wrong voice. Dredgers come to listen. Inquisitors come to burn what listens back.',
            hazard: {
                id: 'spore_hallucination',
                name: 'Spore Hallucination',
                text: 'Every third turn costs 5 sanity, and the reef puts copies of your enemies in the room with you.',
                sanityPerInterval: 5,
                intervalTurns: 3,
                phantomChance: 0.25,
                counter: 'dredger_mask',
                counterName: 'Dredger Respirator'
            },
            resources: ['abyssal_bronze', 'chitin_plate', 'hallucinogenic_kelp'],
            harbour: 'The Drowned Hollow',
            weather: ['corrosive mist', 'a mist that is talking', 'green phosphor tide', 'silence, total and wrong']
        },
        {
            id: 'leviathan_trench',
            name: 'The Leviathan Trench',
            layer: 3,
            depth: [500, 2000],
            act: 3,
            blurb: 'Two thousand metres down and the walls are ribs. Bring pressure gear or bring a shorter plan.',
            long: 'The carcass of a Leviathan lies across the trench mouth like a fallen bridge. It has been dead for two hundred years. It is still warm, its heart still moves once a day, and the Ironclad have built a rendering plant inside its jaw.',
            hazard: {
                id: 'abyssal_pressure',
                name: 'Abyssal Pressure',
                text: 'Three percent of your maximum health every turn, and everything you do is 30% slower.',
                hpPctPerTurn: 0.03,
                speedPenalty: 0.30,
                counter: 'pressure_titanium',
                counterName: 'Pressure-Braced Titanium Suit'
            },
            resources: ['leviathan_bone', 'pure_marrow_core', 'black_pearl'],
            harbour: 'Jawbone Station',
            weather: ['crushing dark', 'marrow-lit gloom', 'the current running the wrong way', 'a slow tolling, from below']
        },
        {
            id: 'drowned_spire',
            name: 'The Drowned Spire',
            layer: 4,
            depth: [2000, 30000],
            act: 3,
            blurb: 'A mountain, upside down, with the Sunken Beacon at the bottom — which, from where you are standing, is up.',
            long: 'The Spire is collapsing at the rate of one floor a day and has been for three hundred years, which means either the arithmetic is wrong or something is rebuilding it at night. The Drowned Archon keeps the last door.',
            hazard: {
                id: 'solar_void_radiation',
                name: 'Solar Void Radiation',
                text: 'Healing is 60% less effective and a cosmic burn accumulates every turn you stand in the light.',
                healingPenalty: 0.60,
                burnPerTurn: 4,
                counter: 'ash_insulation',
                counterName: 'Sun-Insulated Ash Plate'
            },
            resources: ['celestial_core', 'sun_shard_raw', 'ancient_vellum'],
            harbour: 'The Last Cleat',
            weather: ['falling stone', 'the light from below', 'held breath', 'the Archon turning over']
        }
    ];

    // ---------- the three guilds of the rigs ----------
    const FACTIONS = {
        syndicate: {
            id: 'syndicate',
            name: 'The Ironclad Syndicate',
            short: 'Syndicate',
            leader: 'Chief Engineer Vaelen Voss',
            leaderId: 'npc_vaelen_voss',
            seat: 'The Grand Anvil',
            creed: 'Flesh is weak. Steel does not sink.',
            blurb: 'They work Leviathan bone with steam pressure and turn it into mechanical armour and harpoon batteries. They consider that a moral position.',
            tree: 'marrow_smith',
            perk: 'Smithing and armour discounts, superior upgrades, turret and mechanical support.',
            hates: null,
            bonus: { forgeQuality: 8, repairCostPct: -0.50, armourPct: 0.08 }
        },
        dredgers: {
            id: 'dredgers',
            name: 'The Veil Dredgers',
            short: 'Dredgers',
            leader: 'Matriark Nahesia',
            leaderId: 'npc_nahesia',
            seat: 'The Drowned Hollow',
            creed: 'The deep is not our enemy. It is our womb.',
            blurb: 'Mystic anglers who worship the old ocean things and listen to what the water says. Their liturgy is a knot diagram. Their saints are all still down there.',
            tree: 'tide_weaver',
            perk: 'Occult angling, rare deep catches, water breathing and madness manipulation.',
            hates: 'inquisitors',
            bonus: { sanityLossPct: -0.30, abyssalDamagePct: 0.10, dredgeLuck: 2 }
        },
        inquisitors: {
            id: 'inquisitors',
            name: 'The Ash Inquisitors',
            short: 'Inquisitors',
            leader: 'High Priest Ignis Malakor',
            leaderId: 'npc_malakor',
            seat: 'The Pyre-Spire',
            creed: 'The dark must be cleansed. The Sun must rise again.',
            blurb: 'Fanatics who burn everything mutated and have sworn to reignite the drowned sun. They are the only people on the water who are not afraid, which is not the same as being right.',
            tree: 'harpooner',
            perk: 'Holy fire, bonus damage against monsters, execution finishers and purging rites.',
            hates: 'dredgers',
            bonus: { burnDamagePct: 0.20, monsterDamagePct: 0.15, fearImmune: true }
        }
    };

    // ---------- primary attributes and their per-point conversion ----------
    const ATTRIBUTES = [
        {
            id: 'might', name: 'Might', short: 'MGT',
            governs: 'physical damage, carry weight, block strength',
            perPoint: { physicalDamagePct: 0.015, blockValue: 0.8, carryCapacity: 2 }
        },
        {
            id: 'finesse', name: 'Finesse', short: 'FIN',
            governs: 'critical strike, dodge, action speed',
            perPoint: { critChancePct: 0.0025, dodgePct: 0.0035, attackSpeedPct: 0.005 }
        },
        {
            id: 'attunement', name: 'Attunement', short: 'ATT',
            governs: 'abyssal damage, maximum Marrow, resistance to madness',
            perPoint: { spellDamagePct: 0.018, marrowMana: 5, sanityResist: 0.5 }
        },
        {
            id: 'fortitude', name: 'Fortitude', short: 'FOR',
            governs: 'maximum health, armour multiplier, bleed resistance',
            perPoint: { maxHp: 12, naturalArmourPct: 0.004, rotResistPct: 0.01 }
        },
        {
            id: 'perception', name: 'Perception', short: 'PER',
            governs: 'hit rate, angling and salvage luck, weak-point detection',
            perPoint: { hitChancePct: 0.004, critDamagePct: 0.0075, treasureFind: 1 }
        }
    ];

    // ---------- skill trees ----------
    // tier gates: 1 at level 1, 2 at level 5, 3 at level 15, 4 (ultimate) at 30
    const TIER_LEVEL = { 1: 1, 2: 5, 3: 15, 4: 30 };

    const SKILL_TREES = [
        {
            id: 'marrow_smith',
            name: 'Marrow-Smith',
            faction: 'syndicate',
            role: 'Tank & heavy crusher',
            blurb: 'Everything the Syndicate knows, which is metal and how to make it stop being metal.',
            nodes: [
                {
                    id: 'steam_vent_slam', name: 'Steam Vent Slam', tier: 1, type: 'active', maxRank: 5,
                    cost: { stamina: 20 }, cooldown: 2, target: 'single_enemy',
                    scaling: { stat: 'might', baseMultiplier: 1.40, perRank: 0.12 },
                    debuff: { id: 'shattered_armor', name: 'Shattered Armour', armourReductionPct: 0.25, durationTurns: 2 },
                    text: 'Weapon damage ×{v}. Shatters 25% of the target\'s armour for two turns.'
                },
                {
                    id: 'heavy_plating', name: 'Heavy Plating', tier: 1, type: 'passive', maxRank: 5,
                    effect: 'armourPerHeavyPiece', ranks: [0.06, 0.12, 0.18, 0.24, 0.30],
                    text: 'Every heavy piece you wear adds {p}% to total armour.'
                },
                {
                    id: 'marrow_shield_overload', name: 'Marrow Shield Overload', tier: 2, type: 'active', maxRank: 5,
                    cost: { stamina: 35 }, cooldown: 4, target: 'self',
                    barrier: { armourMultiplier: 1.50, perRank: 0.15, detonates: true },
                    text: 'A barrier worth {p}% of your armour. When it breaks it detonates for what it absorbed.'
                },
                {
                    id: 'tempering', name: 'Tempering', tier: 1, type: 'passive', maxRank: 5,
                    effect: 'armourPct', ranks: [0.04, 0.08, 0.12, 0.16, 0.20],
                    text: 'Armour +{p}%.'
                },
                {
                    id: 'anvil_stance', name: 'Anvil Stance', tier: 2, type: 'passive', maxRank: 5,
                    effect: 'blockPct', ranks: [0.08, 0.14, 0.20, 0.26, 0.32],
                    text: 'Guarding reduces incoming damage by a further {p}%.'
                },
                {
                    id: 'reinforce', name: 'Reinforce', tier: 2, type: 'passive', maxRank: 5,
                    effect: 'durability', ranks: [10, 20, 30, 40, 50],
                    text: 'Gear durability +{v}.'
                },
                {
                    id: 'marrow_furnace', name: 'Marrow Furnace', tier: 3, type: 'passive', maxRank: 5,
                    effect: 'forgeTolerance', ranks: [8, 16, 24, 32, 40],
                    text: 'The forge\'s heat window widens by {v} degrees.'
                },
                {
                    id: 'grand_anvil', name: 'The Grand Anvil', tier: 4, type: 'passive', maxRank: 3,
                    effect: 'qualityBonus', ranks: [6, 12, 20],
                    text: 'Every piece you forge scores {v} points higher.'
                }
            ]
        },
        {
            id: 'tide_weaver',
            name: 'Tide-Weaver',
            faction: 'dredgers',
            role: 'Occult caster, high risk and high reward',
            blurb: 'The Dredger curriculum: listen, answer, and do not let it finish the sentence.',
            nodes: [
                {
                    id: 'abyssal_grasp', name: 'Abyssal Grasp', tier: 1, type: 'active', maxRank: 5,
                    cost: { marrow: 25, sanity: 5 }, cooldown: 1, target: 'single_enemy',
                    scaling: { stat: 'attunement', baseMultiplier: 1.80, perRank: 0.15, damageType: 'abyssal' },
                    stun: 1,
                    text: 'Abyssal damage ×{v}. Stuns for one turn.'
                },
                {
                    id: 'madness_resonance', name: 'Madness Resonance', tier: 1, type: 'passive', maxRank: 5,
                    effect: 'lowSanityAbyssalPct', ranks: [0.35, 0.44, 0.53, 0.62, 0.72], threshold: 0.50,
                    text: 'Below 50% sanity, all abyssal damage is +{p}%.'
                },
                {
                    id: 'blood_brine_transfusion', name: 'Blood Brine Transfusion', tier: 2, type: 'active', maxRank: 5,
                    cost: { sanity: 15 }, cooldown: 3, target: 'self',
                    heal: { maxHpPct: 0.30, perRank: 0.03 }, regen: { marrowPerTurn: 15, turns: 3 },
                    text: 'Restore {p}% of maximum health, then 15 Marrow a turn for three turns.'
                },
                {
                    id: 'sanity_ward', name: 'Sanity Ward', tier: 1, type: 'passive', maxRank: 5,
                    effect: 'sanityWard', ranks: [0.10, 0.18, 0.26, 0.34, 0.45],
                    text: 'Sanity loss −{p}%.'
                },
                {
                    id: 'deep_sight', name: 'Deep Sight', tier: 2, type: 'passive', maxRank: 5,
                    effect: 'revealTraits', ranks: [1, 2, 3, 4, 5],
                    text: 'Read {v} hidden traits off any foe without a reading.'
                },
                {
                    id: 'pressure_skin', name: 'Pressure Skin', tier: 3, type: 'passive', maxRank: 5,
                    effect: 'hazardResist', ranks: [0.15, 0.28, 0.40, 0.52, 0.65],
                    text: 'Environmental hazards do {p}% less to you.'
                },
                {
                    id: 'chum_the_water', name: 'Chum the Water', tier: 2, type: 'passive', maxRank: 5,
                    effect: 'dredgeLuck', ranks: [1, 2, 3, 4, 5],
                    text: 'Angling rarity roll +{v}.'
                },
                {
                    id: 'drowned_communion', name: 'Drowned Communion', tier: 4, type: 'active', maxRank: 3,
                    cost: { marrow: 60, sanity: 25 }, cooldown: 6, target: 'all_enemies',
                    scaling: { stat: 'attunement', baseMultiplier: 2.60, perRank: 0.40, damageType: 'abyssal' },
                    text: 'Every enemy in the room takes abyssal damage ×{v}, and hears its own name.'
                }
            ]
        },
        {
            id: 'harpooner',
            name: 'Harpooner',
            faction: 'inquisitors',
            role: 'Range, bleed and execution',
            blurb: 'Neutral trade, Inquisitor doctrine. A line, a barb, and the conviction that everything can be pulled up.',
            nodes: [
                {
                    id: 'barbed_impale', name: 'Barbed Impale', tier: 1, type: 'active', maxRank: 5,
                    cost: { stamina: 18 }, cooldown: 1, target: 'single_enemy',
                    scaling: { stat: 'might', baseMultiplier: 1.20, perRank: 0.10, piercing: true },
                    dot: { id: 'deep_hemorrhage', name: 'Deep Hemorrhage', statPct: 0.40, stat: 'might', durationTurns: 3, type: 'bleed' },
                    text: 'Piercing damage ×{v}, then Deep Hemorrhage: 40% of Might a turn for three turns.'
                },
                {
                    id: 'weakpoint_seeker', name: 'Weakpoint Seeker', tier: 1, type: 'passive', maxRank: 5,
                    effect: 'perceptionToCrit', ranks: [0.20, 0.24, 0.28, 0.34, 0.40],
                    text: '{p}% of Perception is converted directly into critical strike chance.'
                },
                {
                    id: 'leviathan_execution', name: 'Leviathan Execution', tier: 4, type: 'active', maxRank: 3,
                    cost: { stamina: 40 }, cooldown: 5, target: 'single_enemy',
                    scaling: { stat: 'might', baseMultiplier: 2.20, perRank: 0.30, piercing: true, alwaysCrit: true },
                    execute: { belowHpPct: 0.30, multiplier: 2.0 },
                    text: 'A guaranteed critical for ×{v}. Doubles below 30% of the target\'s health.'
                },
                {
                    id: 'sure_footing', name: 'Sure Footing', tier: 1, type: 'passive', maxRank: 5,
                    effect: 'dodgeFlat', ranks: [0.02, 0.04, 0.06, 0.08, 0.10],
                    text: 'Dodge +{p}%.'
                },
                {
                    id: 'burn_oil', name: 'Burn Oil', tier: 2, type: 'active', maxRank: 5,
                    cost: { stamina: 22 }, cooldown: 3, target: 'single_enemy',
                    dot: { id: 'naphtha_burn', name: 'Naphtha Burn', flat: [10, 17, 25, 34, 45], durationTurns: 3, type: 'burn' },
                    text: '{v} burn damage a turn for three turns.'
                },
                {
                    id: 'reel_in', name: 'Reel In', tier: 2, type: 'active', maxRank: 5,
                    cost: { stamina: 25 }, cooldown: 3, target: 'single_enemy',
                    stunChance: [0.25, 0.35, 0.45, 0.55, 0.65],
                    text: 'Drag it off its feet: {p}% chance to stun.'
                },
                {
                    id: 'trophy', name: 'Trophy', tier: 3, type: 'passive', maxRank: 5,
                    effect: 'lootPct', ranks: [0.10, 0.18, 0.26, 0.34, 0.45],
                    text: 'Loot and coin +{p}%.'
                },
                {
                    id: 'killing_tide', name: 'Killing Tide', tier: 3, type: 'passive', maxRank: 5,
                    effect: 'critDamagePct', ranks: [0.10, 0.18, 0.26, 0.34, 0.45],
                    text: 'Critical damage +{p}%.'
                }
            ]
        }
    ];

    // ---------- materials, five tiers, each with its forge window ----------
    const MATERIALS = [
        { id: 'scrap_iron', name: 'Scrap Iron', tier: 1, heat: [300, 450], realm: 'rust_shallows', statScale: 1.00, sockets: 0, value: 4, text: 'Rig plate, hull skin, the lids of things. Everywhere, and it shows.' },
        { id: 'abyssal_bronze', name: 'Abyssal Bronze', tier: 2, heat: [500, 700], realm: 'whispering_reefs', statScale: 1.25, sockets: 1, value: 14, text: 'Alloyed under pressure by people who are dead now. Takes an edge and keeps a grudge.' },
        { id: 'chitin_plate', name: 'Chitin Plate', tier: 3, heat: [750, 950], realm: 'whispering_reefs', statScale: 1.55, sockets: 1, value: 40, lightArmour: true, text: 'Cut from a Reef Behemoth. Lighter than steel, and it flexes when the water does.' },
        { id: 'leviathan_bone', name: 'Leviathan Bone', tier: 4, heat: [1000, 1250], realm: 'leviathan_trench', statScale: 1.90, sockets: 2, value: 110, text: 'Not calcium. Nobody is sure what it is. A blade of it severs things that do not stay severed otherwise.' },
        { id: 'celestial_core', name: 'Celestial Core', tier: 5, heat: [1400, 1650], realm: 'drowned_spire', statScale: 2.40, sockets: 3, value: 390, marrowFed: true, aura: true, text: 'A fragment of the thing that fell. Warm. Slightly heavier every time it is weighed.' },
        // reagents and secondary stock
        { id: 'fish_oil', name: 'Fish Oil', tier: 1, reagent: true, value: 5, text: 'Renders down out of anything with a spine. Lamps, wounds, and one recipe nobody discusses.' },
        { id: 'steam_fittings', name: 'Steam Fittings', tier: 1, reagent: true, value: 9, text: 'Valves, couplings and a gauge that has never been right.' },
        { id: 'hallucinogenic_kelp', name: 'Hallucinogenic Kelp', tier: 2, reagent: true, value: 22, text: 'Chew it and the reef stops whispering. It starts talking instead.' },
        { id: 'pure_marrow_core', name: 'Pure Marrow Core', tier: 4, reagent: true, value: 90, text: 'Marrow rendered until only the glow is left. Feeds a forge past 1400 degrees.' },
        { id: 'black_pearl', name: 'Black Pearl', tier: 4, reagent: true, value: 130, text: 'Grown around a grain of something that was not sand.' },
        { id: 'sun_shard_raw', name: 'Raw Sun Shard', tier: 5, reagent: true, value: 300, text: 'It has been three hundred years and it is still too bright to look at directly.' },
        { id: 'ancient_vellum', name: 'Ancient Vellum', tier: 5, reagent: true, value: 240, text: 'Somebody wrote the truth down before the water came, on something that does not rot.' },
        { id: 'purified_oil', name: 'Purified Oil', tier: 1, reagent: true, consumable: true, value: 18, counters: 'tetanus_rust', text: 'Keeps the rust off plate for a day. Smells like a workshop, which is to say like safety.' }
    ];

    // ---------- rarity ladder ----------
    const RARITIES = [
        { id: 'common', name: 'Common', colour: '#FFFFFF', prefixes: 0, suffixes: 0, sockets: [0, 0], budget: 1.00, weight: 46 },
        { id: 'sturdy', name: 'Sturdy', colour: '#2ECC71', prefixes: 1, suffixes: 0, sockets: [0, 1], budget: 1.20, weight: 27 },
        { id: 'abyssal_rare', name: 'Abyssal Rare', colour: '#3498DB', prefixes: 1, suffixes: 1, sockets: [1, 2], budget: 1.50, weight: 15 },
        { id: 'dread_epic', name: 'Dread Epic', colour: '#9B59B6', prefixes: 2, suffixes: 1, sockets: [2, 3], budget: 1.90, weight: 7 },
        { id: 'relic_mythic', name: 'Relic Mythic', colour: '#E67E22', prefixes: 2, suffixes: 2, sockets: [3, 3], budget: 2.50, weight: 3 },
        { id: 'cursed', name: 'Cursed', colour: '#E74C3C', prefixes: 3, suffixes: 1, sockets: [1, 1], budget: 3.20, weight: 2, cursed: true }
    ];

    // ---------- procedural affixes ----------
    // an item's name is <prefix> <base> <suffix>, so the pools have to read
    // like adjectives and like titles respectively
    const PREFIXES = [
        { id: 'brine_hardened', name: 'Brine-Hardened', stat: 'armour', min: 15, max: 45, slots: ['body', 'head', 'off_hand'] },
        { id: 'serrated', name: 'Serrated', stat: 'bleedOnHit', min: 8, max: 24, slots: ['main_hand'] },
        { id: 'steam_charged', name: 'Steam-Charged', stat: 'mightAbilityPct', min: 0.10, max: 0.25, pct: true, slots: ['main_hand', 'off_hand', 'lantern'] },
        { id: 'chitin_laced', name: 'Chitin-Laced', stat: 'dodgePct', min: 0.02, max: 0.06, pct: true, slots: ['body', 'head'] },
        { id: 'harpoon_balanced', name: 'Harpoon-Balanced', stat: 'critChancePct', min: 0.02, max: 0.07, pct: true, slots: ['main_hand', 'lantern'] },
        { id: 'marrow_veined', name: 'Marrow-Veined', stat: 'maxMarrow', min: 10, max: 35, slots: ['lantern', 'body', 'off_hand'] },
        { id: 'rust_proofed', name: 'Rust-Proofed', stat: 'durability', min: 20, max: 60, slots: ['main_hand', 'body', 'head', 'off_hand'] },
        { id: 'heavy_gauge', name: 'Heavy-Gauge', stat: 'flatDamage', min: 6, max: 22, slots: ['main_hand'] }
    ];

    const SUFFIXES = [
        { id: 'of_the_trench', name: 'of the Trench', stat: 'maxHp', min: 40, max: 150, slots: ['body', 'head', 'off_hand', 'lantern'] },
        { id: 'of_the_mind_eater', name: 'of the Mind-Eater', stat: 'marrowLeechPct', min: 0.05, max: 0.05, pct: true, slots: ['main_hand', 'lantern'] },
        { id: 'of_the_deep_watch', name: 'of the Deep Watch', stat: 'sanityResist', min: 8, max: 30, slots: ['head', 'lantern'] },
        { id: 'of_the_pyre', name: 'of the Pyre', stat: 'burnDamagePct', min: 0.08, max: 0.22, pct: true, slots: ['main_hand', 'off_hand'] },
        { id: 'of_the_anvil', name: 'of the Anvil', stat: 'blockValue', min: 6, max: 24, slots: ['off_hand', 'body'] },
        { id: 'of_the_drowned', name: 'of the Drowned', stat: 'hazardResistPct', min: 0.10, max: 0.30, pct: true, slots: ['body', 'head'] },
        { id: 'of_the_long_line', name: 'of the Long Line', stat: 'rodStrength', min: 2, max: 8, slots: ['lantern', 'off_hand'] }
    ];

    const CURSES = [
        { id: 'leaking_seals', name: 'Cursed: Leaking Seals', text: '+50% physical damage, and −4 sanity every turn.', grants: { physicalDamagePct: 0.50 }, costs: { sanityPerTurn: 4 } },
        { id: 'hollow_ribs', name: 'Cursed: Hollow Ribs', text: '+70% critical damage, and maximum health is halved.', grants: { critDamagePct: 0.70 }, costs: { maxHpPct: -0.50 } },
        { id: 'the_listening_helm', name: 'Cursed: The Listening Helm', text: '+45% abyssal damage, and every enemy in the realm knows where you are.', grants: { abyssalDamagePct: 0.45 }, costs: { ambushChancePct: 0.25 } },
        { id: 'brittle_glory', name: 'Cursed: Brittle Glory', text: '+60% damage while above 90% health, and armour is zero below it.', grants: { highHpDamagePct: 0.60 }, costs: { armourBelowThreshold: 0.90 } }
    ];

    // ---------- runes (Marrow Infusion) ----------
    const RUNES = [
        { id: 'gem_crimson_marrow', name: 'Crimson Marrow', stat: 'bleedOnHit', value: 8, text: 'Adds 8 bleed damage to every strike. Still warm when you socket it.' },
        { id: 'gem_abyssal_pearl', name: 'Abyssal Pearl', stat: 'sanityResist', value: 12, extra: { magicDefencePct: 0.05 }, text: '+12 sanity resistance and 5% magic defence. Grown around a grain of something that was not sand.' },
        { id: 'gem_sun_shard', name: 'Sun Shard', stat: 'sunBlindChance', value: 0.10, text: '10% chance on hit to inflict Sun Blindness — which is what a Nemesis phobia is waiting for.' },
        { id: 'gem_iron_knot', name: 'Iron Knot', stat: 'armour', value: 22, text: 'Syndicate standard issue. Boring, and it works.' },
        { id: 'gem_leviathan_tooth', name: 'Leviathan Tooth', stat: 'flatDamage', value: 14, text: 'Shed, not broken — which implies a replacement.' },
        { id: 'gem_hollow_eye', name: 'Hollow Eye', stat: 'critChancePct', value: 0.05, text: 'It is looking at the same thing you are, half a second earlier.' },
        { id: 'gem_tide_knot', name: 'Tide Knot', stat: 'maxMarrow', value: 25, text: 'It fills at high water. So do you.' },
        { id: 'gem_ash_cinder', name: 'Ash Cinder', stat: 'burnDamagePct', value: 0.12, text: 'Consecrated, which here means annealed.' }
    ];

    // ---------- forge quality bands ----------
    const QUALITY_BANDS = [
        { id: 'defective', name: 'Defective', min: 0, max: 39, statMultiplier: 0.80, durabilityMultiplier: 0.50, extraAffixes: 0, text: 'It will hold. Probably. Not for long.' },
        { id: 'standard', name: 'Standard', min: 40, max: 74, statMultiplier: 1.00, durabilityMultiplier: 1.00, extraAffixes: 0, text: 'Honest work. Nobody writes songs about it.' },
        { id: 'masterwork', name: 'Masterwork', min: 75, max: 94, statMultiplier: 1.15, durabilityMultiplier: 1.00, extraAffixes: 1, text: 'The kind of piece a smith signs.' },
        { id: 'abyssal_forged', name: 'Abyssal-Forged', min: 95, max: 100, statMultiplier: 1.30, durabilityMultiplier: 1.00, extraAffixes: 2, glow: true, text: 'It came off the anvil humming, and it has not stopped.' }
    ];

    // ---------- recipes ----------
    const RECIPES = [
        // Tier 1 — Scrap Iron
        { id: 'rcp_rig_hook', name: 'Rig Hook', slot: 'main_hand', tier: 1, heavy: false, damageType: 'physical', base: { damage: 30, critChancePct: 0.02 }, cost: { scrap_iron: 4 }, weight: 3, value: 40, skill: 1, text: 'A cargo hook with the safety ground off.' },
        { id: 'rcp_plate_vest', name: 'Plate Vest', slot: 'body', tier: 1, heavy: true, base: { armour: 48 }, cost: { scrap_iron: 6 }, weight: 8, value: 46, skill: 1, text: 'Container steel and webbing. Heavy, honest.' },
        { id: 'rcp_welders_hood', name: 'Welder\'s Hood', slot: 'head', tier: 1, heavy: true, base: { armour: 24, sanityResist: 4 }, cost: { scrap_iron: 3 }, weight: 2, value: 30, skill: 1, text: 'Smoked glass. Keeps the sparks out, and some of the looking.' },
        { id: 'rcp_tar_lantern', name: 'Tar Lantern', slot: 'lantern', tier: 1, base: { rodStrength: 3, sanityResist: 4 }, cost: { scrap_iron: 2, fish_oil: 3 }, weight: 1, value: 28, skill: 1, text: 'Burns for six hours and smells like the inside of a drum.' },
        { id: 'rcp_hemp_rod', name: 'Hemp Dredging Rod', slot: 'off_hand', tier: 1, base: { rodStrength: 12, blockValue: 4 }, cost: { scrap_iron: 2, fish_oil: 2 }, weight: 2, value: 26, skill: 1, text: 'Hemp and tar. Snaps politely.' },
        // Tier 2 — Abyssal Bronze
        { id: 'rcp_bronze_gaff', name: 'Bronze Gaff', slot: 'main_hand', tier: 2, damageType: 'physical', base: { damage: 42, critChancePct: 0.03 }, cost: { abyssal_bronze: 5, scrap_iron: 4 }, weight: 4, value: 130, skill: 8, text: 'The bronze remembers the pressure it was made under and passes it on.' },
        { id: 'rcp_diving_carapace', name: 'Diving Carapace', slot: 'body', tier: 2, heavy: true, base: { armour: 53, hazardResistPct: 0.10 }, cost: { abyssal_bronze: 7, scrap_iron: 5 }, weight: 12, value: 165, skill: 10, text: 'A pre-Tide suit with a century of patches, each one a story with a bad ending.' },
        { id: 'rcp_dredger_censer', name: 'Dredger Censer', slot: 'off_hand', tier: 2, faction: 'dredgers', damageType: 'abyssal', base: { damage: 30, maxMarrow: 20 }, cost: { abyssal_bronze: 4, hallucinogenic_kelp: 3 }, weight: 2, value: 150, skill: 12, text: 'Swung on a chain, it makes a sound that things below answer.' },
        { id: 'rcp_dredger_mask', name: 'Dredger Respirator', slot: 'head', tier: 2, base: { armour: 22, sanityResist: 14 }, counters: 'spore_hallucination', cost: { abyssal_bronze: 3, hallucinogenic_kelp: 2 }, weight: 3, value: 140, skill: 10, text: 'Filters the spores. Does not filter what they were saying.' },
        // Tier 3 — Chitin Plate
        { id: 'rcp_chitin_harpoon', name: 'Chitin Harpoon', slot: 'main_hand', tier: 3, damageType: 'physical', base: { damage: 50, critChancePct: 0.05, piercing: true }, cost: { chitin_plate: 4, abyssal_bronze: 2, pure_marrow_core: 1 }, weight: 5, value: 370, skill: 15, text: 'Grown, not forged. Still faintly warm at the base.' },
        { id: 'rcp_reef_mail', name: 'Reef Mail', slot: 'body', tier: 3, base: { armour: 58, dodgePct: 0.03 }, cost: { chitin_plate: 8, abyssal_bronze: 5 }, weight: 9, value: 420, skill: 18, text: 'Overlapping plate that closes when struck, like something deciding.' },
        { id: 'rcp_pressure_titanium', name: 'Pressure-Braced Titanium Suit', slot: 'body', tier: 3, heavy: true, base: { armour: 66, hazardResistPct: 0.55 }, counters: 'abyssal_pressure', cost: { chitin_plate: 6, abyssal_bronze: 8, steam_fittings: 4 }, weight: 16, value: 520, skill: 22, text: 'Rated to two thousand metres. The rating is a hope with a stamp on it.' },
        // Tier 4 — Leviathan Bone
        { id: 'rcp_bone_cleaver', name: 'Leviathan-Bone Cleaver', slot: 'main_hand', tier: 4, damageType: 'physical', base: { damage: 62, critChancePct: 0.06, piercing: true }, permanentKill: true, cost: { leviathan_bone: 6, chitin_plate: 5 }, weight: 7, value: 980, skill: 28, text: 'Takes a head off, and the head stays off. The only weapon on the water that ends a Drowned Lord by main force.' },
        { id: 'rcp_bone_harness', name: 'Bone Harness', slot: 'body', tier: 4, heavy: true, base: { armour: 65, hazardResistPct: 0.30 }, cost: { leviathan_bone: 7, chitin_plate: 6 }, weight: 13, value: 1040, skill: 30, text: 'Ribs, worn as ribs. Cold in the morning.' },
        { id: 'rcp_marrow_crown', name: 'Marrow Crown', slot: 'head', tier: 4, base: { armour: 26, maxMarrow: 60, sanityResist: 22 }, cost: { leviathan_bone: 5, pure_marrow_core: 3 }, weight: 4, value: 960, skill: 32, text: 'It hums at the pitch of your own name.' },
        { id: 'rcp_deep_rod', name: 'Deep Dredging Rod', slot: 'off_hand', tier: 4, base: { rodStrength: 29, blockValue: 18 }, cost: { leviathan_bone: 4, chitin_plate: 4 }, weight: 3, value: 800, skill: 26, text: 'Rated for eldritch. Rated is a strong word.' },
        // Tier 5 — Celestial Core
        { id: 'rcp_core_lance', name: 'Celestial Lance', slot: 'main_hand', tier: 5, damageType: 'burn', base: { damage: 73, critChancePct: 0.08, piercing: true }, permanentKill: true, cost: { celestial_core: 3, leviathan_bone: 6, sun_shard_raw: 2 }, weight: 8, value: 2800, skill: 40, text: 'A splinter of the fallen Sun on a shaft of bone. It lights the water for a mile and everything in that mile looks up.' },
        { id: 'rcp_ash_insulation', name: 'Sun-Insulated Ash Plate', slot: 'body', tier: 5, heavy: true, base: { armour: 71, hazardResistPct: 0.60 }, counters: 'solar_void_radiation', cost: { celestial_core: 2, leviathan_bone: 6, sun_shard_raw: 3 }, weight: 15, value: 2700, skill: 44, text: 'Inquisitor pattern. It is the only thing anyone has built that the Spire does not cook.' },
        { id: 'rcp_beacon_charm', name: 'Ash Beacon Charm', slot: 'lantern', tier: 5, base: { sanityResist: 45, maxMarrow: 70, critChancePct: 0.04 }, cost: { celestial_core: 2, ancient_vellum: 4 }, weight: 2, value: 2500, skill: 46, text: 'A small piece of daylight, and you are very tired.' }
    ];

    // ---------- bestiary ----------
    const BESTIARY = [
        // Rust Shallows
        { id: 'mob_dock_rat', name: 'Dock Rats', realm: 'rust_shallows', level: 1, hp: 120, damage: 17, damageType: 'physical', armour: 12, hit: 0.04, dodge: 0.10, weak: ['burn'], resist: [], xp: 70, coin: 6, sanity: 0, drops: { fish_oil: [1, 2] }, text: 'Four of them, and they have worked out which end of you is the bag.' },
        { id: 'mob_rust_ghoul', name: 'Rust Ghoul', realm: 'rust_shallows', level: 2, hp: 251, damage: 36, damageType: 'physical', armour: 40, hit: 0.06, dodge: 0.04, weak: ['burn'], resist: [], xp: 120, coin: 14, sanity: 0, drops: { scrap_iron: [1, 3] }, text: 'A rigger who drowned in the suit and kept the shift going.' },
        { id: 'mob_gull_swarm', name: 'Gull Swarm', realm: 'rust_shallows', level: 2, hp: 185, damage: 28, damageType: 'physical', armour: 0, hit: 0.02, dodge: 0.14, weak: ['burn'], resist: ['abyssal'], xp: 100, coin: 9, sanity: 0, drops: { fish_oil: [1, 2] }, text: 'Nine birds with one opinion.' },
        { id: 'mob_hull_crab', name: 'Hull Crab', realm: 'rust_shallows', level: 3, hp: 370, damage: 48, damageType: 'physical', armour: 120, hit: 0.02, dodge: 0.00, weak: ['crush'], resist: ['bleed'], xp: 170, coin: 20, sanity: 0, drops: { scrap_iron: [2, 4], chitin_plate: [0, 1] }, text: 'Grew inside a ballast tank, and is shaped, therefore, like a ballast tank.' },
        { id: 'mob_salvage_thief', name: 'Salvage Thief', realm: 'rust_shallows', level: 4, hp: 317, damage: 56, damageType: 'physical', armour: 55, hit: 0.10, dodge: 0.12, weak: [], resist: [], xp: 200, coin: 48, sanity: 0, drops: { scrap_iron: [1, 3], steam_fittings: [0, 2] }, text: 'Not a monster. Worse: a person with rent to make.' },
        { id: 'mob_brine_wight', name: 'Brine Wight', realm: 'rust_shallows', level: 5, hp: 475, damage: 70, damageType: 'abyssal', armour: 70, hit: 0.08, dodge: 0.05, weak: ['burn'], resist: ['abyssal'], xp: 290, coin: 34, sanity: 5, drops: { fish_oil: [2, 4], abyssal_bronze: [0, 1] }, text: 'Salt in the shape of a man, holding the shape out of spite.' },
        // Whispering Reefs
        { id: 'mob_reef_choirling', name: 'Reef Choirling', realm: 'whispering_reefs', level: 7, hp: 395, damage: 61, damageType: 'abyssal', armour: 106, hit: 0.10, dodge: 0.08, weak: ['burn'], resist: ['abyssal'], xp: 520, coin: 52, sanity: 7, drops: { hallucinogenic_kelp: [1, 3], abyssal_bronze: [1, 2] }, text: 'It sings in your voice, a week early, and gets one word wrong.' },
        { id: 'mob_glass_hound', name: 'Glass Hound', realm: 'whispering_reefs', level: 8, hp: 437, damage: 72, damageType: 'physical', armour: 123, hit: 0.14, dodge: 0.16, weak: ['crush'], resist: ['bleed'], xp: 600, coin: 60, sanity: 2, drops: { chitin_plate: [1, 3] }, text: 'Coral grown around a dog that came out here to die and did not finish.' },
        { id: 'mob_mist_surgeon', name: 'Mist Surgeon', realm: 'whispering_reefs', level: 9, hp: 470, damage: 77, damageType: 'bleed', armour: 146, hit: 0.12, dodge: 0.12, weak: ['abyssal'], resist: ['physical'], xp: 690, coin: 74, sanity: 9, drops: { chitin_plate: [1, 3], hallucinogenic_kelp: [1, 2] }, text: 'It takes something small and leaves the wound open so it can come back.' },
        { id: 'mob_chitin_crawler', name: 'Chitin Crawler', realm: 'whispering_reefs', level: 10, hp: 538, damage: 81, damageType: 'physical', armour: 213, hit: 0.08, dodge: 0.04, weak: ['crush'], resist: ['bleed', 'physical'], xp: 780, coin: 82, sanity: 3, drops: { chitin_plate: [3, 6] }, text: 'A Reef Behemoth in its second year. There are older ones.' },
        { id: 'mob_corroded_saint', name: 'Corroded Saint', realm: 'whispering_reefs', level: 11, hp: 638, damage: 91, damageType: 'burn', armour: 246, hit: 0.10, dodge: 0.06, weak: ['abyssal'], resist: ['burn'], xp: 900, coin: 108, sanity: 12, drops: { abyssal_bronze: [2, 4], sun_shard_raw: [0, 1] }, text: 'An Inquisitor who reached the reef, got the doctrine right, and burned anyway.' },
        // Leviathan Trench
        { id: 'mob_brine_diver_mutant', name: 'Brine Diver Mutant', realm: 'leviathan_trench', level: 14, hp: 945, damage: 142, damageType: 'physical', armour: 90, hit: 0.12, dodge: 0.08, weak: ['abyssal'], resist: ['physical'], xp: 1700, coin: 160, sanity: 6, drops: { leviathan_bone: [1, 2], pure_marrow_core: [0, 1] }, text: 'The suit kept the pressure out. Something else got in.' },
        { id: 'mob_pressure_wraith', name: 'Pressure Wraith', realm: 'leviathan_trench', level: 15, hp: 837, damage: 160, damageType: 'abyssal', armour: 54, hit: 0.16, dodge: 0.18, weak: ['burn'], resist: ['abyssal'], xp: 1900, coin: 175, sanity: 16, drops: { black_pearl: [0, 1], leviathan_bone: [0, 2] }, text: 'What two thousand metres does to a diver who took the helmet off on purpose.' },
        { id: 'mob_rib_walker', name: 'Rib Walker', realm: 'leviathan_trench', level: 17, hp: 1278, damage: 173, damageType: 'physical', armour: 129, hit: 0.08, dodge: 0.02, weak: ['bleed', 'crush'], resist: ['abyssal'], xp: 2300, coin: 200, sanity: 8, drops: { leviathan_bone: [2, 4], chitin_plate: [2, 4] }, text: 'The carcass moves a little. This is one of the pieces that moves the most.' },
        { id: 'mob_trench_choir', name: 'Trench Choir', realm: 'leviathan_trench', level: 19, hp: 1134, damage: 192, damageType: 'abyssal', armour: 78, hit: 0.14, dodge: 0.12, weak: ['burn'], resist: ['abyssal'], xp: 2700, coin: 240, sanity: 24, drops: { pure_marrow_core: [1, 3], leviathan_bone: [1, 3] }, text: 'Forty voices, one throat, and they are all reading from your file.' },
        // Drowned Spire
        { id: 'mob_spire_sentinel', name: 'Spire Sentinel', realm: 'drowned_spire', level: 24, hp: 1470, damage: 290, damageType: 'burn', armour: 310, hit: 0.14, dodge: 0.06, weak: ['abyssal'], resist: ['burn'], xp: 5200, coin: 400, sanity: 10, drops: { celestial_core: [0, 1], leviathan_bone: [2, 4] }, text: 'Built to guard a door that is no longer at that end of the building.' },
        { id: 'mob_ash_apostle', name: 'Ash Apostle', realm: 'drowned_spire', level: 26, hp: 1316, damage: 323, damageType: 'burn', armour: 240, hit: 0.18, dodge: 0.14, weak: ['abyssal'], resist: ['burn'], xp: 5800, coin: 450, sanity: 18, drops: { sun_shard_raw: [1, 3], celestial_core: [0, 1] }, text: 'Reached the Beacon. Understood it. Chose fire. Is still choosing fire.' },
        { id: 'mob_hollow_tide', name: 'The Hollow Tide', realm: 'drowned_spire', level: 28, hp: 1680, damage: 353, damageType: 'abyssal', armour: 210, hit: 0.16, dodge: 0.12, weak: ['burn'], resist: ['abyssal', 'bleed'], xp: 6600, coin: 520, sanity: 32, drops: { celestial_core: [1, 2], ancient_vellum: [0, 2] }, text: 'Not an animal. A shape the water is currently holding, and it has your posture.' }
    ];

    // ---------- the Drowned Admiralty ----------
    const NEMESIS_RANKS = [
        { tier: 0, id: 'brine_scum', name: 'Brine Scum', slots: Infinity, hpMultiplier: 1.0, damageMultiplier: 1.0, guards: [0, 0], strengths: 0, weaknesses: 0, named: false, text: 'Nameless. Kill the player and it earns a name.' },
        { tier: 1, id: 'deck_captain', name: 'Deck Captain', slots: 12, hpMultiplier: 1.8, damageMultiplier: 1.3, guards: [2, 3], strengths: 1, weaknesses: 1, named: true, text: 'One strength, one weakness, a title and a war cry.' },
        { tier: 2, id: 'trench_warlord', name: 'Trench Warlord', slots: 4, hpMultiplier: 1.3, damageMultiplier: 1.35, guards: [4, 6], strengths: 2, weaknesses: 1, enrages: 1, named: true, text: 'Two strengths, an enrage trigger, one weakness, and a claim on a whole sector.' },
        { tier: 3, id: 'abyssal_overlord', name: 'Abyssal Overlord', slots: 1, hpMultiplier: 5.2, damageMultiplier: 1.9, guards: [0, 0], waves: true, strengths: 3, weaknesses: 1, phases: 2, named: true, text: 'Three strengths, a two-phase fight, and a curse on the sector it holds.' }
    ];

    const LORD_CREATURES = [
        { id: 'cr_drowned_reaver', name: 'Drowned Reaver', hp: 1.00, damage: 1.00, damageType: 'physical', dodge: 0.08, armour: 1.0, weapon: 'serrated_steam_cleaver', text: 'Was a boarding officer. Kept the coat.' },
        { id: 'cr_sump_prophet', name: 'Sump Prophet', hp: 0.85, damage: 1.15, damageType: 'abyssal', dodge: 0.12, armour: 0.8, weapon: 'knot_censer', text: 'Preaches at a pitch below hearing. You feel it in the teeth.' },
        { id: 'cr_chain_baron', name: 'Chain Baron', hp: 1.25, damage: 0.90, damageType: 'physical', dodge: 0.02, armour: 1.4, weapon: 'anchor_chain', text: 'Wears its own mooring. Has never let go of anything.' },
        { id: 'cr_ash_widow', name: 'Ash Widow', hp: 0.90, damage: 1.20, damageType: 'burn', dodge: 0.14, armour: 0.9, weapon: 'naphtha_censer', text: 'Inquisitor, once. The fire took, and then kept going.' },
        { id: 'cr_reef_dowager', name: 'Reef Dowager', hp: 1.10, damage: 1.05, damageType: 'abyssal', dodge: 0.10, armour: 1.1, weapon: 'coral_scepter', text: 'Coral through the ribcage in a pattern that is almost lace.' },
        { id: 'cr_harpoon_martyr', name: 'Harpoon Martyr', hp: 0.95, damage: 1.25, damageType: 'bleed', dodge: 0.16, armour: 0.85, weapon: 'barbed_forest', text: 'Full of harpoons, none of them its own, none of them removed.' },
        { id: 'cr_boiler_saint', name: 'Boiler Saint', hp: 1.30, damage: 0.95, damageType: 'burn', dodge: 0.00, armour: 1.5, weapon: 'pressure_maul', text: 'A Syndicate engineer welded into the plant to keep the pressure up. It worked.' },
        { id: 'cr_lantern_eater', name: 'Lantern-Eater', hp: 1.05, damage: 1.10, damageType: 'abyssal', dodge: 0.12, armour: 1.0, weapon: 'lamprey_maw', text: 'Goes for the light first. Then the hand holding it.' }
    ];

    const LORD_NAMES = {
        given: ['Karn', 'Malgor', 'Vorn', 'Kaelen', 'Ossian', 'Marek', 'Halvard', 'Brann', 'Idris', 'Sable', 'Vaughn', 'Rook', 'Tallis', 'Nessa', 'Oren', 'Kessel', 'Ferrow', 'Alder', 'Wren', 'Dray', 'Solen', 'Kirr', 'Maud', 'Beckett', 'Ilva', 'Hark', 'Cassian', 'Thessa'],
        // untitled lords get one of these until they earn a real one
        epithet: ['the Rust-Eater', 'the Abyssal Leech', 'the Hook-Eyed', 'the Unquenched', 'the Twice-Drowned', 'the Long Line', 'the Saltmouth', 'the Coldhold', 'the Greylung', 'the Unlanded', 'the Ashcoat', 'the Deepdraught']
    };

    // titles are earned, keyed to how the Lord beat you
    const EARNED_TITLES = {
        killed_by_bleed: 'the Carver',
        killed_by_burn: 'the Kindled',
        killed_by_abyssal: 'the Hollow',
        killed_by_physical: 'the Harpoon-Breaker',
        killed_by_crush: 'the Anvil',
        player_fled: 'the Patient',
        sanity_broken: 'the Chorus',
        survived_fire: 'the Pyre-Scarred',
        lost_an_eye: 'the One-Eyed'
    };

    // ---------- nemesis traits ----------
    const NEMESIS_TRAITS = {
        immunities: [
            { id: 'brine_plated', name: 'Brine-Plated', text: 'Bleed and rot do nothing at all.', immuneTo: ['bleed', 'rot'], from: 'natural armour or a crab-shell mutation' },
            { id: 'abyssal_attuned', name: 'Abyssal Attuned', text: 'Absorbs 75% of magic and sanity damage and turns it into health.', absorb: { abyssal: 0.75, sanity: 0.75 }, heals: true, from: 'Dredger-descended occult lords' },
            { id: 'pyre_scarred', name: 'Pyre-Scarred', text: 'Burned to the bone and the bone said no. Immune to burn.', immuneTo: ['burn'], earned: 'survived_fire', mayDevelop: 'fear_of_ash_fire' }
        ],
        enrages: [
            { id: 'blood_frenzy', name: 'Blood Frenzy', text: 'Below 30% health: +50% damage and speed, and defence drops to nothing.', threshold: 0.30, damagePct: 0.50, speedPct: 0.50, armourPct: -1.0 },
            { id: 'hate_of_steam', name: 'Hate of Steam', text: 'Enrages the instant a steam-powered ability lands on it.', trigger: 'steam_ability', damagePct: 0.40 }
        ],
        vulnerabilities: [
            { id: 'brittle_shell', name: 'Brittle Shell', text: 'Crushing damage strips its armour 50% faster.', armourBreakPct: 0.50, element: 'crush' },
            { id: 'one_eyed', name: 'One-Eyed', text: 'A blind side: attacks from behind land 50% harder. It has bolted a plate over the gap against ranged fire.', flankBonus: 0.50, rangedResist: 0.20, earned: 'lost_an_eye' },
            { id: 'coward_scent', name: 'Coward-Scent', text: 'It has your scent now. +25% to ambush you.', ambushBonus: 0.25, earned: 'player_fled' }
        ],
        phobias: [
            { id: 'fear_of_sun_flares', name: 'Terrified of Flares', text: 'A flare or a Sun relic makes it cower for two turns.', trigger: 'flare', cowerTurns: 2 },
            { id: 'fear_of_ash_fire', name: 'Phobia: Ash Fire', text: 'It has burned once and will not stand for it again.', trigger: 'burn', cowerTurns: 1 }
        ]
    };

    const LORD_DIALOGUE = {
        intro: [
            'You crawl back from the depths, diver? My cleaver remembers the sound of your ribs cracking!',
            'The water knows your name. I taught it.',
            'You are late. I have been standing in this cold for nine days.',
            'Nobody sent you. I checked. Nobody is coming either.',
            'Ah. The one who runs. Let us see how far it is this time.'
        ],
        onKill: [
            'Down to the seabed you go. Stay there this time!',
            'That is twice. There will not be a third.',
            'I will keep the hands. The rest can float.',
            'The tide asked for you by name. I only passed it along.'
        ],
        onFlee: [
            'Run, rat! The tide will wash you back into my hands!',
            'I know your knot now. I will be at the boat.',
            'Go on. I want to see how far it is.'
        ]
    };

    // ---------- angling and dredging ----------
    // stamina is the fight in it; pull_strength_base feeds the tension sim
    const CATCHES = [
        { id: 'fish_ironscale_cod', name: 'Ironscale Cod', tier: 1, stamina: 100, pull: 15, value: 18, text: 'Grey, patient, faintly oily.', onEat: { hp: 150 } },
        { id: 'fish_brine_eel', name: 'Brine Eel', tier: 1, stamina: 130, pull: 19, value: 26, text: 'Bites after it is landed. Bites after it is cooked.', onEat: { hp: 90, stamina: 20 } },
        { id: 'fish_biolum_eel', name: 'Bioluminescent Eel', tier: 2, stamina: 180, pull: 26, value: 70, text: 'A living lamp with an opinion about being one.', material: { hallucinogenic_kelp: 1 }, alchemy: 'Glow Elixir — light in a dark room, for a night.' },
        { id: 'fish_glasshead', name: 'Glasshead', tier: 2, stamina: 165, pull: 24, value: 62, text: 'You can see the thoughts. There are two.', material: { abyssal_bronze: 1 } },
        { id: 'fish_void_gazer', name: 'Void Gazer', tier: 3, stamina: 220, pull: 38, value: 190, text: 'It has been watching the hook since before you baited it.', onEat: { marrow: 50, sanity: -10, empowerRandomSkill: true } },
        { id: 'fish_marrow_lamprey', name: 'Marrow Lamprey', tier: 3, stamina: 240, pull: 41, value: 210, text: 'A mouth with a commute.', material: { pure_marrow_core: 1 } },
        { id: 'salvage_ancient_relic_chest', name: 'Sunken Syndicate Safe', tier: 4, stamina: 350, pull: 55, value: 520, salvage: true, text: 'Brass, sealed, and somebody scratched a countdown into the lid.', rolls: { rareMaterial: 2, coin: [200, 600], blueprintChance: 0.35 } },
        { id: 'salvage_drowned_reliquary', name: 'Drowned Reliquary', tier: 4, stamina: 320, pull: 50, value: 470, salvage: true, codex: 'cdx_reliquary', text: 'A saint\'s knuckle in a lead box, and the seal is broken from the inside.', rolls: { rareMaterial: 1, coin: [150, 400], runeChance: 0.40 } },
        { id: 'encounter_kraken_spawn', name: 'Lesser Kraken Spawn', tier: 5, stamina: 600, pull: 80, value: 0, encounter: 'boss_kraken_spawn', text: 'The line goes slack. Then it goes taut in the other direction, and keeps going.' },
        { id: 'encounter_the_answering', name: 'The Answering', tier: 5, stamina: 520, pull: 72, value: 0, encounter: 'mob_trench_choir', text: 'Your line was already in the water when you arrived. You have not cast yet.' }
    ];

    const FISHING_SPOTS = [
        {
            id: 'spot_shallows_wreckline', realm: 'rust_shallows', name: 'The Wreck Line', depth_meters: 40, requires_bait_tier: 1,
            conditions: { tide_phase: 'calm_day', sanity_drain_per_cast: 0, monster_encounter_chance_pct: 0 },
            loot_pool: [
                { catch_id: 'fish_ironscale_cod', weight: 60 },
                { catch_id: 'fish_brine_eel', weight: 30 },
                { catch_id: 'fish_glasshead', weight: 10 }
            ]
        },
        {
            id: 'spot_shallows_blacktide', realm: 'rust_shallows', name: 'The Wreck Line, after dark', depth_meters: 60, requires_bait_tier: 1,
            conditions: { tide_phase: 'black_tide', sanity_drain_per_cast: 3, monster_encounter_chance_pct: 8 },
            loot_pool: [
                { catch_id: 'fish_brine_eel', weight: 40 },
                { catch_id: 'fish_glasshead', weight: 30 },
                { catch_id: 'salvage_drowned_reliquary', weight: 22 },
                { catch_id: 'encounter_the_answering', weight: 8 }
            ]
        },
        {
            id: 'spot_reef_trench_edge_02', realm: 'whispering_reefs', name: 'The Trench Edge', depth_meters: 180, requires_bait_tier: 2,
            conditions: { tide_phase: 'black_tide', sanity_drain_per_cast: 3, monster_encounter_chance_pct: 15 },
            loot_pool: [
                { catch_id: 'fish_ironscale_cod', weight: 50 },
                { catch_id: 'fish_biolum_eel', weight: 35 },
                { catch_id: 'salvage_ancient_relic_chest', weight: 10 },
                { catch_id: 'encounter_kraken_spawn', weight: 5 }
            ]
        },
        {
            id: 'spot_reef_shoals', realm: 'whispering_reefs', name: 'The Singing Shoals', depth_meters: 120, requires_bait_tier: 2,
            conditions: { tide_phase: 'calm_day', sanity_drain_per_cast: 1, monster_encounter_chance_pct: 4 },
            loot_pool: [
                { catch_id: 'fish_biolum_eel', weight: 48 },
                { catch_id: 'fish_glasshead', weight: 34 },
                { catch_id: 'salvage_drowned_reliquary', weight: 18 }
            ]
        },
        {
            id: 'spot_trench_jawbone', realm: 'leviathan_trench', name: 'Under the Jaw', depth_meters: 900, requires_bait_tier: 3,
            conditions: { tide_phase: 'black_tide', sanity_drain_per_cast: 5, monster_encounter_chance_pct: 20 },
            loot_pool: [
                { catch_id: 'fish_marrow_lamprey', weight: 38 },
                { catch_id: 'fish_void_gazer', weight: 32 },
                { catch_id: 'salvage_ancient_relic_chest', weight: 20 },
                { catch_id: 'encounter_kraken_spawn', weight: 10 }
            ]
        },
        {
            id: 'spire_lightfall', realm: 'drowned_spire', name: 'Where the Light Falls Up', depth_meters: 2400, requires_bait_tier: 4,
            conditions: { tide_phase: 'black_tide', sanity_drain_per_cast: 8, monster_encounter_chance_pct: 26 },
            loot_pool: [
                { catch_id: 'fish_void_gazer', weight: 40 },
                { catch_id: 'salvage_ancient_relic_chest', weight: 28 },
                { catch_id: 'encounter_kraken_spawn', weight: 20 },
                { catch_id: 'encounter_the_answering', weight: 12 }
            ]
        }
    ];

    // ---------- dungeon node flavour ----------
    const NODE_TEXT = {
        combat: ['Something is already in the corridor.', 'It was waiting where the light stops.', 'The water moves before anything in it does.', 'You are not the first thing down here tonight.'],
        elite: ['A Drowned Lord holds this door, and has for some time.', 'It knew you were coming. It said so, out loud, to nobody.', 'The chart marks this room empty. The chart is old.'],
        salvage: ['A strongbox, cracked, still owed to somebody.', 'The dead left a kit bag packed for a trip they nearly took.', 'A cache, sealed with Syndicate wax and opened once already.'],
        mystery: ['A shrine, and something on it that is still warm.', 'Two Dredgers arguing, and they stop when they see you.', 'A door with a choice written on it in grease pencil.'],
        rest: ['A dry cleat, a lamp with oil in it, and nothing in the doorway.', 'Somebody built a bunk here and did not come back for it.', 'A Rest Rig: four hours, a hot tin, and the water kept outside.'],
        boss: ['The room opens out, and the room is not empty.', 'It has been down here the whole time and it has been listening.', 'This is what the chart was warning about.']
    };

    const MYSTERY_EVENTS = [
        { id: 'evt_sunken_shrine_sacrifice', name: 'The Sunken Shrine', text: 'A shrine to nothing anybody names out loud. The bowl wants blood or it wants coin, and it is not fussy about which.', options: [
            { text: 'Bleed into the bowl.', cost: { hpPct: 0.15 }, gain: { sanity: 12, xpMult: 0.4 } },
            { text: 'Pay it.', cost: { coin: 120 }, gain: { rune: true } },
            { text: 'Take the bowl.', gain: { coin: 300 }, risk: { nemesisAlert: 1, sanity: -10 } }
        ] },
        { id: 'evt_drifting_dredger', name: 'A Drifting Dredger', text: 'A woman on a raft, four days out, still holding the line. She will trade, or she will talk, and both cost something.', options: [
            { text: 'Trade for what she has.', cost: { coin: 80 }, gain: { material: true } },
            { text: 'Let her talk.', gain: { codex: true, sanity: -6 } },
            { text: 'Tow her back.', gain: { reputation: { dredgers: 12 } }, cost: { time: 2 } }
        ] },
        { id: 'evt_inquisitor_pyre', name: 'A Pyre on the Water', text: 'Ash Inquisitors have a rig surrounded and a family on it. The Confessor asks whether you are staying to watch.', options: [
            { text: 'Stand aside.', gain: { reputation: { inquisitors: 15 } }, cost: { sanity: -14 } },
            { text: 'Cut the family loose.', gain: { reputation: { dredgers: 15 }, xpMult: 0.5 }, risk: { nemesisAlert: 2 }, cost: { reputation: { inquisitors: -25 } } },
            { text: 'Ask what the rig did.', gain: { codex: true } }
        ] }
    ];

    // ---------- realm guardians ----------
    // phases are read top-down: a phase begins when health falls to its
    // threshold. Mechanics are ids the engine knows how to run.
    const BOSSES = [
        {
            id: 'boss_anchor_saint', name: 'The Anchor-Saint', realm: 'rust_shallows', level: 6,
            total_hp: 1015, damage: 37, damageType: 'physical', armour: 210, hit: 0.10, dodge: 0.04,
            weak: ['burn'], resist: ['bleed'], xp: 2400, coin: 480, sanity: 6,
            drops: { scrap_iron: [8, 16], abyssal_bronze: [3, 6], steam_fittings: [2, 5] },
            intro: 'Eleven thousand tons of harbour with a face welded into the ballast door. She was the first rig lashed after the Tide and she has been holding the others up ever since — and at some point in two hundred years she started meaning it.',
            phases: [
                { phase_index: 1, hp_threshold_pct: 100, passive_armor_pct: 30, mechanics: ['telegraphed_tail_sweep'], text: 'The plates draw in. She is mostly door.' },
                { phase_index: 2, hp_threshold_pct: 50, passive_armor_pct: 10, mechanics: ['flood_the_deck'], on_enter: 'flood', text: 'She opens the sea valves. The deck goes under: dodge is halved and every fire on you goes out.' }
            ],
            codex: 'cdx_anchor_saint'
        },
        {
            id: 'boss_reef_choir', name: 'The Choir of the Reef', realm: 'whispering_reefs', level: 12,
            total_hp: 540, damage: 118, damageType: 'abyssal', armour: 112, hit: 0.14, dodge: 0.14,
            weak: ['burn'], resist: ['abyssal', 'physical'], xp: 7200, coin: 1100, sanity: 12,
            drops: { chitin_plate: [6, 12], hallucinogenic_kelp: [5, 10], abyssal_bronze: [4, 8] },
            intro: 'Forty-one voices in a coral throat two hundred feet across, and every one of them is somebody who came out here and stayed. Two of them are people you have met.',
            phases: [
                { phase_index: 1, hp_threshold_pct: 100, passive_armor_pct: 25, mechanics: ['descant'], text: 'It sings the part you were about to say.' },
                { phase_index: 2, hp_threshold_pct: 66, passive_armor_pct: 25, mechanics: ['sanity_toll'], sanity_hit: 12, text: 'It answers itself. −12 sanity.' },
                { phase_index: 3, hp_threshold_pct: 33, passive_armor_pct: 15, mechanics: ['sanity_toll', 'deadmans_chorus'], sanity_hit: 12, deadmans_below_sanity: 20, text: 'All forty-one at once. Kill it below 20 sanity and it takes you with it.' }
            ],
            codex: 'cdx_reef_choir'
        },
        {
            id: 'boss_morvath_behemoth', name: 'Morvath, the Trench Behemoth', realm: 'leviathan_trench', level: 20,
            total_hp: 1275, damage: 186, damageType: 'physical', armour: 104, hit: 0.14, dodge: 0.02,
            weak: ['crush'], resist: ['abyssal'], xp: 26000, coin: 3400, sanity: 14,
            drops: { leviathan_bone: [10, 18], pure_marrow_core: [4, 9], black_pearl: [1, 3], celestial_core: [0, 1] },
            intro: 'The carcass has been dead for two hundred years. Twice during this fight it will disagree.',
            phases: [
                {
                    phase_index: 1, hp_threshold_pct: 100, passive_armor_pct: 70,
                    mechanics: ['telegraphed_tail_sweep', 'interactable_harpoons'],
                    tail_sweep_damage: 250,
                    on_phase_end_event: 'collapse_floor_fill_water',
                    text: 'The armoured hull. Seventy percent of everything you do bounces — unless you pull the harpoon levers in the corners and pin it.'
                },
                {
                    phase_index: 2, hp_threshold_pct: 60, passive_armor_pct: 20,
                    mechanics: ['abyssal_bile_aoe', 'spawn_leeches'],
                    bile_damage_per_turn: 30, bile_turns: 3,
                    adds_spawn_rate_turns: 3, add_id: 'mob_parasitic_leech',
                    on_enter: 'flood',
                    text: 'The floor goes and the arena fills. Ruptured flesh: it bleeds acid, and the leeches it sheds put health back into it.'
                },
                {
                    phase_index: 3, hp_threshold_pct: 20, passive_armor_pct: 0,
                    mechanics: ['hard_enrage', 'void_singularity'],
                    enrage_timer_active: true, damage_scaling_per_turn_pct: 0.15,
                    sanity_drain_per_action: 8, singularity_turns: 6,
                    text: 'The Black Dawn. It stops defending and starts spending itself, and a hole opens in the middle of the floor that you are being pulled toward.'
                }
            ],
            codex: 'cdx_morvath'
        },
        {
            id: 'boss_drowned_archon', name: 'The Drowned Archon', realm: 'drowned_spire', level: 30,
            total_hp: 2100, damage: 99, damageType: 'abyssal', armour: 140, hit: 0.18, dodge: 0.10,
            weak: [], resist: ['abyssal', 'physical', 'bleed'], xp: 90000, coin: 12000, sanity: 20,
            drops: { celestial_core: [6, 12], sun_shard_raw: [4, 9], ancient_vellum: [2, 5] },
            intro: 'It has kept the last door for three hundred years, and it was a person for the first of them. Behind it the Sunken Beacon is still lit, and still warm, and still waiting for somebody to decide.',
            phases: [
                { phase_index: 1, hp_threshold_pct: 100, passive_armor_pct: 45, mechanics: ['telegraphed_tail_sweep', 'sanity_toll'], sanity_hit: 8, text: 'The Keeper. It fights like a man who was taught properly, a very long time ago.' },
                { phase_index: 2, hp_threshold_pct: 60, passive_armor_pct: 25, mechanics: ['abyssal_bile_aoe', 'spawn_leeches'], bile_damage_per_turn: 55, bile_turns: 3, adds_spawn_rate_turns: 3, add_id: 'mob_hollow_fragment', on_enter: 'radiation', text: 'It opens, and what is inside it is the light. The Spire starts cooking you.' },
                { phase_index: 3, hp_threshold_pct: 25, passive_armor_pct: 0, mechanics: ['hard_enrage', 'void_singularity'], enrage_timer_active: true, damage_scaling_per_turn_pct: 0.18, sanity_drain_per_action: 10, singularity_turns: 10, text: 'It gives up on the door and reaches for the Beacon itself. Whatever happens next, it happens in the next few turns.' }
            ],
            codex: 'cdx_archon'
        },
        {
            id: 'boss_kraken_spawn', name: 'Lesser Kraken Spawn', realm: 'whispering_reefs', level: 16,
            total_hp: 1470, damage: 47, damageType: 'physical', armour: 238, hit: 0.12, dodge: 0.10,
            weak: ['burn'], resist: ['bleed'], xp: 11000, coin: 1600, sanity: 15,
            drops: { chitin_plate: [8, 16], black_pearl: [1, 4], leviathan_bone: [2, 5] },
            intro: 'You hooked it. That was the mistake. It has been letting you reel for four minutes because it wanted to see the boat.',
            phases: [
                { phase_index: 1, hp_threshold_pct: 100, passive_armor_pct: 35, mechanics: ['telegraphed_tail_sweep'], text: 'Eight arms and a patience problem.' },
                { phase_index: 2, hp_threshold_pct: 45, passive_armor_pct: 10, mechanics: ['abyssal_bile_aoe'], bile_damage_per_turn: 34, bile_turns: 3, text: 'It inks, and the ink burns.' }
            ]
        },
        {
            id: 'mob_hollow_fragment', name: 'Hollow Fragment', realm: 'drowned_spire', level: 24, add: true,
            hp: 420, damage: 64, damageType: 'abyssal', armour: 90, hit: 0.12, dodge: 0.12,
            weak: ['burn'], resist: [], xp: 300, coin: 0, sanity: 4,
            text: 'A piece the Archon has stopped holding on to. It has the same posture.'
        },
        {
            id: 'mob_parasitic_leech', name: 'Parasitic Leech', realm: 'leviathan_trench', level: 14, add: true,
            hp: 260, damage: 40, damageType: 'bleed', armour: 60, hit: 0.10, dodge: 0.10,
            weak: ['burn'], resist: [], xp: 200, coin: 0, sanity: 2, heals_owner_pct: 0.02,
            text: 'It is not fighting you. It is feeding its host, and you are in the way.'
        }
    ];

    // ---------- dialogue ----------
    // Node-based, with conditions, typed actions and attribute skill checks.
    // sanity_altered_text replaces entry_text once the diver is below
    // sanity_threshold — the speaker has not changed, the listener has.
    const DIALOGUE = {
        dlg_act1_discovery: {
            dialogue_id: 'dlg_act1_discovery', npc_id: 'npc_narrator', speaker_name: 'The Harpoon Line',
            entry_text: 'The line comes up heavy and wrong. What is on the end of it is a piece of Leviathan bone the size of a door, and there are runes cut into it, and the runes are the old sun-script, and one of them is still warm.',
            sanity_threshold: 30,
            sanity_altered_text: 'The line comes up and the thing on the end of it says your name in your mother\'s voice, and the runes are warm, and you have been holding it for some time now.',
            options: [
                { option_id: 'opt_take_it', text: 'Cut it free and take it aboard.', actions: [
                    { type: 'set_flag', flag: 'act1_relic_found' },
                    { type: 'unlock_codex', codex_id: 'cdx_sun_script' },
                    { type: 'link_dialogue', target: 'dlg_act1_reading' }
                ] },
                { option_id: 'opt_lore_read', text: '[ABYSSAL LORE] Read the script before you touch it.', skill_check: { attribute: 'attunement', difficulty: 12, success_target: 'dlg_act1_lore_success', failure_target: 'dlg_act1_lore_fail' } },
                { option_id: 'opt_cut_loose', text: 'Cut the line. Nothing warm should come out of that water.', actions: [
                    { type: 'modify_sanity', value: 6 },
                    { type: 'link_dialogue', target: 'dlg_act1_reading' }
                ] }
            ]
        },
        dlg_act1_lore_success: {
            dialogue_id: 'dlg_act1_lore_success', npc_id: 'npc_narrator', speaker_name: 'The Sun-Script',
            entry_text: 'It is a bearing. Not a prayer, not a name — a bearing, cut by somebody who wanted to be found, pointing down and east into the Reefs. And under it, smaller: THE HEART IS STILL LIT.',
            options: [
                { option_id: 'opt_lore_take', text: 'Take it aboard.', actions: [
                    { type: 'set_flag', flag: 'act1_relic_found' },
                    { type: 'set_flag', flag: 'act1_read_the_bearing' },
                    { type: 'unlock_codex', codex_id: 'cdx_sun_script' },
                    { type: 'unlock_codex', codex_id: 'cdx_the_heart' },
                    { type: 'add_xp', value: 400 },
                    { type: 'link_dialogue', target: 'dlg_act1_reading' }
                ] }
            ]
        },
        dlg_act1_lore_fail: {
            dialogue_id: 'dlg_act1_lore_fail', npc_id: 'npc_narrator', speaker_name: 'The Sun-Script',
            entry_text: 'The marks will not sit still long enough to be read, and looking at them for as long as you just did was a mistake.',
            options: [
                { option_id: 'opt_fail_take', text: 'Take it anyway.', actions: [
                    { type: 'modify_sanity', value: -8 },
                    { type: 'set_flag', flag: 'act1_relic_found' },
                    { type: 'unlock_codex', codex_id: 'cdx_sun_script' },
                    { type: 'link_dialogue', target: 'dlg_act1_reading' }
                ] }
            ]
        },
        dlg_act1_reading: {
            dialogue_id: 'dlg_act1_reading', npc_id: 'npc_narrator', speaker_name: 'Vell\'s Landing',
            entry_text: 'By evening three people have offered to buy it and two of them were not people. The Reefs are open to you now, and all three guilds know your name by morning, which is not the same as being safe.',
            options: [
                { option_id: 'opt_act2', text: 'Go to the Reefs.', actions: [
                    { type: 'advance_act', act: 2 },
                    { type: 'unlock_realm', realm: 'whispering_reefs' },
                    { type: 'exit_dialogue' }
                ] }
            ]
        },

        // the document's own example, kept to the letter
        dlg_vaelen_act2_01: {
            dialogue_id: 'dlg_vaelen_act2_01', npc_id: 'npc_vaelen_voss', speaker_name: 'Chief Engineer Vaelen Voss',
            portrait: 'vaelen_grim.png',
            entry_text: 'Get inside before the brine eats through your seals. Did you bring the Marrow Core, or are you here to waste my steam?',
            sanity_threshold: 30,
            sanity_altered_text: 'The pipes... they are singing your name, diver. Hand over the pulsing heart before the rust crawls into my eyes.',
            options: [
                {
                    option_id: 'opt_hand_over',
                    text: 'Here is the Marrow Core. Keep your end of the bargain.',
                    condition: { required_item: 'item_marrow_core_t3', min_reputation: { faction: 'syndicate', value: 10 } },
                    actions: [
                        { type: 'remove_item', item_id: 'item_marrow_core_t3', count: 1 },
                        { type: 'add_reputation', faction: 'syndicate', value: 25 },
                        { type: 'modify_sanity', value: 5 },
                        { type: 'link_dialogue', target: 'dlg_vaelen_reward' }
                    ]
                },
                {
                    option_id: 'opt_skill_intimidate',
                    text: '[MIGHT] I fought an Abyssal Horror for this. Double the payment, or I\'ll crush this valve.',
                    skill_check: { attribute: 'might', difficulty: 16, success_target: 'dlg_vaelen_intimidate_success', failure_target: 'dlg_vaelen_intimidate_fail' }
                },
                {
                    option_id: 'opt_skill_abyssal_lore',
                    text: '[ABYSSAL LORE] You don\'t know what this is. If you pump this into the engine, the steam will whisper madness.',
                    skill_check: { attribute: 'attunement', difficulty: 14, success_target: 'dlg_vaelen_lore_success', failure_target: 'dlg_vaelen_lore_fail' }
                },
                {
                    option_id: 'opt_refuse_and_leave',
                    text: 'I changed my mind. The Core stays with me.',
                    actions: [
                        { type: 'add_reputation', faction: 'syndicate', value: -15 },
                        { type: 'trigger_nemesis_alert', faction: 'syndicate', threat_level: 1 },
                        { type: 'exit_dialogue' }
                    ]
                }
            ]
        },
        dlg_vaelen_reward: {
            dialogue_id: 'dlg_vaelen_reward', npc_id: 'npc_vaelen_voss', speaker_name: 'Chief Engineer Vaelen Voss',
            entry_text: 'Good. It goes in the number four manifold and the whole rig stops shaking for the first time in nine years.\n\nThe trench is yours when you want it, diver. Take the pressure suit off the rack — it is rated to two thousand metres, and the man who wore it last was not.',
            options: [
                { option_id: 'opt_take_suit', text: 'Take the suit.', actions: [
                    { type: 'set_flag', flag: 'core_delivered_syndicate' },
                    { type: 'give_item', item_id: 'rcp_pressure_titanium' },
                    { type: 'join_faction', faction: 'syndicate' },
                    { type: 'add_reputation', faction: 'dredgers', value: -20 },
                    { type: 'add_reputation', faction: 'inquisitors', value: -20 },
                    { type: 'trigger_nemesis_alert', faction: 'dredgers', threat_level: 2 },
                    { type: 'advance_act', act: 3 },
                    { type: 'unlock_realm', realm: 'leviathan_trench' },
                    { type: 'exit_dialogue' }
                ] }
            ]
        },
        dlg_vaelen_intimidate_success: {
            dialogue_id: 'dlg_vaelen_intimidate_success', npc_id: 'npc_vaelen_voss', speaker_name: 'Chief Engineer Vaelen Voss',
            entry_text: 'Take your hand off the valve.\n\nHe says it quietly, and he pays, and he does not stop looking at your hand for the rest of the conversation.',
            options: [
                { option_id: 'opt_intim_take', text: 'Take the money and the Core deal.', actions: [
                    { type: 'add_coin', value: 900 },
                    { type: 'add_reputation', faction: 'syndicate', value: 5 },
                    { type: 'link_dialogue', target: 'dlg_vaelen_reward' }
                ] }
            ]
        },
        dlg_vaelen_intimidate_fail: {
            dialogue_id: 'dlg_vaelen_intimidate_fail', npc_id: 'npc_vaelen_voss', speaker_name: 'Chief Engineer Vaelen Voss',
            entry_text: 'That valve is a decompression bleed for four hundred people, and you have just told a room full of my engineers that you would open it.\n\nNobody shouts. Somebody sends for the foundry crew.',
            options: [
                { option_id: 'opt_intim_back', text: 'Step away from the valve.', actions: [
                    { type: 'add_reputation', faction: 'syndicate', value: -25 },
                    { type: 'trigger_nemesis_alert', faction: 'syndicate', threat_level: 2 },
                    { type: 'link_dialogue', target: 'dlg_vaelen_act2_01' }
                ] }
            ]
        },
        dlg_vaelen_lore_success: {
            dialogue_id: 'dlg_vaelen_lore_success', npc_id: 'npc_vaelen_voss', speaker_name: 'Chief Engineer Vaelen Voss',
            entry_text: 'He is quiet for a long time. Behind him the plant makes the noise it always makes, which is a heartbeat, which everyone has agreed for two hundred years is a pump.\n\n"I know," he says. "I have known for six years. What would you like me to do about four hundred jobs?"',
            options: [
                { option_id: 'opt_lore_press', text: 'Sound the evacuation. I will take the Core down myself.', actions: [
                    { type: 'set_flag', flag: 'vaelen_knows' },
                    { type: 'unlock_codex', codex_id: 'cdx_the_sleeper' },
                    { type: 'add_reputation', faction: 'syndicate', value: 10 },
                    { type: 'modify_sanity', value: -6 },
                    { type: 'link_dialogue', target: 'dlg_vaelen_reward' }
                ] },
                { option_id: 'opt_lore_shrug', text: 'Nothing. Just pay me.', actions: [
                    { type: 'unlock_codex', codex_id: 'cdx_the_sleeper' },
                    { type: 'add_coin', value: 600 },
                    { type: 'link_dialogue', target: 'dlg_vaelen_reward' }
                ] }
            ]
        },
        dlg_vaelen_lore_fail: {
            dialogue_id: 'dlg_vaelen_lore_fail', npc_id: 'npc_vaelen_voss', speaker_name: 'Chief Engineer Vaelen Voss',
            entry_text: 'Diver, I have run this foundry for nineteen years on coal, marrow and arithmetic, and not one of those three has ever whispered anything at me. Try the Hollow. They like that sort of talk down there.',
            options: [
                { option_id: 'opt_lore_fail_back', text: 'Try something else.', actions: [{ type: 'link_dialogue', target: 'dlg_vaelen_act2_01' }] }
            ]
        },

        dlg_nahesia_act2_01: {
            dialogue_id: 'dlg_nahesia_act2_01', npc_id: 'npc_nahesia', speaker_name: 'Matriark Nahesia',
            portrait: 'nahesia_veiled.png',
            entry_text: 'Sit. You are dripping on a floor that has been listening to this room for two hundred years, and it will remember you now whether you stay or not.\n\nYou have the Core. Good. Do you know what it is a piece of?',
            sanity_threshold: 35,
            sanity_altered_text: 'Sit, sit — you are already sitting, you have been sitting here for hours, we have had this conversation twice and the second time you said yes.',
            options: [
                { option_id: 'opt_nah_lore', text: '[ABYSSAL LORE] It is a fragment of the Beacon casing, and it is still lit.', skill_check: { attribute: 'attunement', difficulty: 15, success_target: 'dlg_nahesia_lore_success', failure_target: 'dlg_nahesia_lore_fail' } },
                { option_id: 'opt_nah_give', text: 'It is yours. Drown it, if that is what the Hollow wants.', condition: { required_item: 'item_marrow_core_t3' }, actions: [
                    { type: 'remove_item', item_id: 'item_marrow_core_t3', count: 1 },
                    { type: 'add_reputation', faction: 'dredgers', value: 25 },
                    { type: 'link_dialogue', target: 'dlg_nahesia_reward' }
                ] },
                { option_id: 'opt_nah_perception', text: '[PERCEPTION] There are eleven people behind that curtain.', skill_check: { attribute: 'perception', difficulty: 13, success_target: 'dlg_nahesia_seen', failure_target: 'dlg_nahesia_lore_fail' } },
                { option_id: 'opt_nah_leave', text: 'I have not decided. I will come back.', actions: [{ type: 'exit_dialogue' }] }
            ]
        },
        dlg_nahesia_lore_success: {
            dialogue_id: 'dlg_nahesia_lore_success', npc_id: 'npc_nahesia', speaker_name: 'Matriark Nahesia',
            entry_text: 'Still lit. Say it again, louder — no, do not, half of them are asleep.\n\nThree hundred years the Syndicate has called it an asset and the Inquisition has called it a corpse to be burned, and you walk in wet and say the word "lit" as though it were obvious.',
            options: [
                { option_id: 'opt_nah_ls_give', text: 'Then take it, and teach me what to do with the rest.', condition: { required_item: 'item_marrow_core_t3' }, actions: [
                    { type: 'remove_item', item_id: 'item_marrow_core_t3', count: 1 },
                    { type: 'add_reputation', faction: 'dredgers', value: 35 },
                    { type: 'unlock_codex', codex_id: 'cdx_the_heart' },
                    { type: 'add_xp', value: 1200 },
                    { type: 'link_dialogue', target: 'dlg_nahesia_reward' }
                ] }
            ]
        },
        dlg_nahesia_seen: {
            dialogue_id: 'dlg_nahesia_seen', npc_id: 'npc_nahesia', speaker_name: 'Matriark Nahesia',
            entry_text: 'Twelve. You missed the one in the rafters, and she is the one who would have done it.\n\nShe does not apologise. She does look pleased, which is worse and somehow better.',
            options: [
                { option_id: 'opt_seen_on', text: 'Get on with it.', actions: [{ type: 'add_reputation', faction: 'dredgers', value: 10 }, { type: 'link_dialogue', target: 'dlg_nahesia_act2_01' }] }
            ]
        },
        dlg_nahesia_lore_fail: {
            dialogue_id: 'dlg_nahesia_lore_fail', npc_id: 'npc_nahesia', speaker_name: 'Matriark Nahesia',
            entry_text: 'No. Close, and confidently wrong, which down here gets people drowned in a particular way.',
            options: [
                { option_id: 'opt_nah_lf_back', text: 'Try something else.', actions: [{ type: 'link_dialogue', target: 'dlg_nahesia_act2_01' }] }
            ]
        },
        dlg_nahesia_reward: {
            dialogue_id: 'dlg_nahesia_reward', npc_id: 'npc_nahesia', speaker_name: 'Matriark Nahesia',
            entry_text: 'The Hollow will hold it, and the Hollow will hold you, and you will find you can go deeper than you could last week and mind it less.\n\nThe trench is open. Take the censer. Do not answer anything that uses your own voice.',
            options: [
                { option_id: 'opt_nah_take', text: 'Take the censer.', actions: [
                    { type: 'set_flag', flag: 'core_delivered_dredgers' },
                    { type: 'give_item', item_id: 'rcp_dredger_censer' },
                    { type: 'join_faction', faction: 'dredgers' },
                    { type: 'add_reputation', faction: 'syndicate', value: -20 },
                    { type: 'add_reputation', faction: 'inquisitors', value: -35 },
                    { type: 'trigger_nemesis_alert', faction: 'inquisitors', threat_level: 2 },
                    { type: 'advance_act', act: 3 },
                    { type: 'unlock_realm', realm: 'leviathan_trench' },
                    { type: 'exit_dialogue' }
                ] }
            ]
        },

        dlg_malakor_act2_01: {
            dialogue_id: 'dlg_malakor_act2_01', npc_id: 'npc_malakor', speaker_name: 'High Priest Ignis Malakor',
            portrait: 'malakor_ash.png',
            entry_text: 'You have carried a lit piece of the Sun through two hundred miles of dark water and arrived with all your fingers. That is either providence or it is a symptom, and I have burned people for the second one.\n\nPut it on the plate, diver.',
            sanity_threshold: 30,
            sanity_altered_text: 'Put it on the plate. Put it on the plate. The fire is already saying your name and it has been getting the syllables right for three days now.',
            options: [
                { option_id: 'opt_mal_give', text: 'Take it. Light the thing and be done.', condition: { required_item: 'item_marrow_core_t3' }, actions: [
                    { type: 'remove_item', item_id: 'item_marrow_core_t3', count: 1 },
                    { type: 'add_reputation', faction: 'inquisitors', value: 25 },
                    { type: 'link_dialogue', target: 'dlg_malakor_reward' }
                ] },
                { option_id: 'opt_mal_challenge', text: '[MIGHT] A third of the rigs are already mutated. You would burn them with it.', skill_check: { attribute: 'might', difficulty: 15, success_target: 'dlg_malakor_hard', failure_target: 'dlg_malakor_fail' } },
                { option_id: 'opt_mal_lore', text: '[ABYSSAL LORE] It is not a corpse. It is holding its breath.', skill_check: { attribute: 'attunement', difficulty: 17, success_target: 'dlg_malakor_lore', failure_target: 'dlg_malakor_fail' } },
                { option_id: 'opt_mal_leave', text: 'Not yet.', actions: [{ type: 'exit_dialogue' }] }
            ]
        },
        dlg_malakor_hard: {
            dialogue_id: 'dlg_malakor_hard', npc_id: 'npc_malakor', speaker_name: 'High Priest Ignis Malakor',
            entry_text: 'Yes.\n\nHe does not flinch and he does not soften it, and it is the most honest thing anybody says to you in the whole of the Reefs.',
            options: [
                { option_id: 'opt_mal_hard_give', text: 'Then take it, and put my name on the list with theirs.', condition: { required_item: 'item_marrow_core_t3' }, actions: [
                    { type: 'remove_item', item_id: 'item_marrow_core_t3', count: 1 },
                    { type: 'add_reputation', faction: 'inquisitors', value: 35 },
                    { type: 'unlock_codex', codex_id: 'cdx_ash_doctrine' },
                    { type: 'link_dialogue', target: 'dlg_malakor_reward' }
                ] },
                { option_id: 'opt_mal_hard_no', text: 'No.', actions: [{ type: 'add_reputation', faction: 'inquisitors', value: -20 }, { type: 'trigger_nemesis_alert', faction: 'inquisitors', threat_level: 1 }, { type: 'exit_dialogue' }] }
            ]
        },
        dlg_malakor_lore: {
            dialogue_id: 'dlg_malakor_lore', npc_id: 'npc_malakor', speaker_name: 'High Priest Ignis Malakor',
            entry_text: 'Holding its breath.\n\nHe turns the Core over twice. The brazier behind him gutters, which it has not done in the eleven years he has kept it.\n\n"Then it can let it out," he says, "and we will all find out together what it has been holding in."',
            options: [
                { option_id: 'opt_mal_lore_give', text: 'Give him the Core.', condition: { required_item: 'item_marrow_core_t3' }, actions: [
                    { type: 'remove_item', item_id: 'item_marrow_core_t3', count: 1 },
                    { type: 'add_reputation', faction: 'inquisitors', value: 30 },
                    { type: 'unlock_codex', codex_id: 'cdx_the_sleeper' },
                    { type: 'add_xp', value: 1200 },
                    { type: 'link_dialogue', target: 'dlg_malakor_reward' }
                ] }
            ]
        },
        dlg_malakor_fail: {
            dialogue_id: 'dlg_malakor_fail', npc_id: 'npc_malakor', speaker_name: 'High Priest Ignis Malakor',
            entry_text: 'The Pyre-Spire has heard better argument from things it was in the middle of burning. Try again, or put it on the plate.',
            options: [
                { option_id: 'opt_mal_fail_back', text: 'Try something else.', actions: [{ type: 'link_dialogue', target: 'dlg_malakor_act2_01' }] }
            ]
        },
        dlg_malakor_reward: {
            dialogue_id: 'dlg_malakor_reward', npc_id: 'npc_malakor', speaker_name: 'High Priest Ignis Malakor',
            entry_text: 'It goes in the reliquary and the reliquary goes to the Spire, and in four days we will know whether three hundred years of doctrine was faith or arithmetic.\n\nTake the ash plate. Where you are going, the light itself is the weather.',
            options: [
                { option_id: 'opt_mal_take', text: 'Take the plate.', actions: [
                    { type: 'set_flag', flag: 'core_delivered_inquisitors' },
                    { type: 'give_item', item_id: 'rcp_ash_insulation' },
                    { type: 'join_faction', faction: 'inquisitors' },
                    { type: 'add_reputation', faction: 'dredgers', value: -35 },
                    { type: 'add_reputation', faction: 'syndicate', value: -20 },
                    { type: 'trigger_nemesis_alert', faction: 'dredgers', threat_level: 2 },
                    { type: 'advance_act', act: 3 },
                    { type: 'unlock_realm', realm: 'leviathan_trench' },
                    { type: 'exit_dialogue' }
                ] }
            ]
        },

        dlg_archon_final: {
            dialogue_id: 'dlg_archon_final', npc_id: 'npc_beacon', speaker_name: 'The Sunken Beacon',
            entry_text: 'The Archon is down and the last door is open and behind it the Beacon is the size of a cathedral and the shape of a lit window, and the water around it is the temperature of a room.\n\nThere is a way to bind it to an engine. There is a way to put it out. There is a way to make it burn everything at once. All three are within reach and none of them can be taken back.',
            sanity_threshold: 25,
            sanity_altered_text: 'You have been here before. You have made this choice before. The water is the temperature of a room and the room is one you grew up in, and the thing in the middle of it is waiting for you to say the number again.',
            options: [
                { option_id: 'opt_end_iron', text: 'Bind it. Steam for every rig for a thousand years.', condition: { min_reputation: { faction: 'syndicate', value: 20 } }, actions: [{ type: 'trigger_ending', ending_id: 'ending_iron_age' }] },
                { option_id: 'opt_end_abyss', text: 'Put it out. Let the world finish becoming what it is becoming.', condition: { min_reputation: { faction: 'dredgers', value: 20 } }, actions: [{ type: 'trigger_ending', ending_id: 'ending_leviathan_awakening' }] },
                { option_id: 'opt_end_pyre', text: 'Light it. Burn the ocean off and start again on dry ground.', condition: { min_reputation: { faction: 'inquisitors', value: 20 } }, actions: [{ type: 'trigger_ending', ending_id: 'ending_cleansing_pyre' }] },
                { option_id: 'opt_end_wait', text: 'Stand there a while longer.', actions: [{ type: 'exit_dialogue' }] }
            ]
        }
    };

    // ---------- codex ----------
    const CODEX = [
        { id: 'cdx_great_submersion', title: 'The Great Submersion', text: 'Three hundred years ago the Celestial Sun broke out of the sky and fell into the deepest trench in the ocean. The seas rose to meet the hole it left and the continents went under entire. What is left of humanity floats: iron rigs lashed together with chain, towns built on dead Leviathan skeletons, and a few sheer rock towers that used to be mountains.' },
        { id: 'cdx_abyssal_rot', title: 'The Abyssal Rot', text: 'The deep is not only water. It is poisoned with the cosmic radiation the Sun gave off on the way down and with the essence of things that were already living at that depth. Long exposure does not kill you. It changes what you are, slowly, starting with what you are willing to listen to.' },
        { id: 'cdx_marrow', title: 'Marrow', text: 'Rendered out of dead Leviathan bone and deep-sea flesh. It is an energy source, an alchemical fuel and a curse that mutates the human mind by degrees, and the Syndicate burns eleven tons of it a day to keep the Grand Anvil turning.' },
        { id: 'cdx_sun_script', title: 'The Sun-Script', text: 'The rune alphabet cut into pre-Tide sun instruments. Nobody has spoken it in three centuries. It is still legible, which is the part that should worry people, because it means it was cut to be read later.' },
        { id: 'cdx_the_heart', title: 'The Heart of the Sun', text: 'What the Dredgers call the Beacon, the Inquisitors call the buried Sun and the Syndicate calls Asset 1. All three descriptions are of the same object, and all three are accurate.' },
        { id: 'cdx_the_sleeper', title: 'The Sleeper', text: 'The Leviathan across the trench mouth has been dead for two hundred years and warm the whole time. The heartbeat everyone calls a pump is a heartbeat. Vaelen Voss has known for six years and did the arithmetic on four hundred jobs.' },
        { id: 'cdx_ash_doctrine', title: 'Ash Doctrine', text: '"We are not cruel. We are early." — High Priest Ignis Malakor, on the burning of Rig Nine, which had forty-one people on it and a confirmed abyssal bloom.' },
        { id: 'cdx_knot_rite', title: 'The Knot Rite', text: 'A Dredger liturgy is a knot diagram. Tie it right and the deep answers in the voice of the last person who tied it wrong.' },
        { id: 'cdx_reliquary', title: 'Drowned Reliquary', text: 'A saint\'s knuckle in a lead box, sealed in the year of the Tide. The seal is broken from the inside and the knuckle is warm.' },
        { id: 'cdx_anchor_saint', title: 'The Anchor-Saint', text: 'Eleven thousand tons of harbour with a face welded into the ballast door. She was the first rig lashed after the Tide and she has been holding the others up ever since.' },
        { id: 'cdx_reef_choir', title: 'The Choir of the Reef', text: 'Forty-one voices in a coral throat, all of them people who came out and stayed. The count does not go up when it kills. It goes up when somebody listens all the way to the end.' },
        { id: 'cdx_morvath', title: 'Morvath', text: 'Twice during the descent the carcass rolls. Twice is what has been recorded. Nobody has stayed long enough to record a third.' },
        { id: 'cdx_archon', title: 'The Drowned Archon', text: 'It has kept the last door for three hundred years and it was a person for the first of them. It does not stop you out of malice. It stops you because everyone who has come this far so far has wanted to do something to the Beacon rather than ask it anything.' },
        { id: 'cdx_nemesis_admiralty', title: 'The Drowned Admiralty', text: 'Twelve Deck Captains, four Trench Warlords and one Abyssal Overlord. The seats are alive: they fight each other, they fill each other\'s vacancies, and a nameless thing that kills a diver can be sitting in one by morning.' },
        { id: 'cdx_black_tide', title: 'The Black Tide', text: 'The night current. Legendary catches and cursed hauls come up in it, and every cast costs a little of whatever it is that lets you tell your own thoughts from the ones arriving.' },
        { id: 'cdx_pressure', title: 'On Pressure', text: 'Two thousand metres is not a depth, it is a verdict. The Syndicate suit is rated for it. The rating is a hope with a stamp on it.' },
        { id: 'cdx_glow_elixir', title: 'Glow Elixir', text: 'Bioluminescent eel, rendered with kelp. Gives you a night\'s worth of light and a fortnight\'s worth of dreams about being one.' },
        { id: 'cdx_shattered_map', title: 'The Shattered Map', text: 'Nobody drew it in one piece. It was cut into three before the water came, by three people who did not trust each other, which is why all three guilds hold a corner and none of them holds the middle.' }
    ];

    // ---------- campaign ----------
    const ACTS = [
        {
            n: 1, id: 'act1', title: 'The Rust Shallows', realm: 'rust_shallows', dialogue: 'dlg_act1_discovery',
            goal: 'You dredge scrap out of wrecks for a living. This morning the harpoon line came up with a piece of Leviathan bone on it, cut with sun-runes, and one of the runes was warm.',
            beats: ['A murder on the landing that nobody will name.', 'The first fragment of the shattered map of the Heart of the Sun.', 'All three guilds learn your name by morning.']
        },
        {
            n: 2, id: 'act2', title: 'The Whispering Reefs', realm: 'whispering_reefs', dialogue: null,
            goal: 'The other fragments are in the Reefs, and so are all three guilds. Somebody is going to get the ancient beacon core, and whoever does not will send their captains after you.',
            beats: ['Diplomatic and armed contact with the Syndicate, the Dredgers and the Inquisition.', 'The turning point: which guild receives the beacon core.', 'The refused guilds release their Nemesis captains onto you by name.'],
            choice: { prompt: 'Who gets the Marrow Core?', dialogues: { syndicate: 'dlg_vaelen_act2_01', dredgers: 'dlg_nahesia_act2_01', inquisitors: 'dlg_malakor_act2_01' } }
        },
        {
            n: 3, id: 'act3', title: 'The Deep Trench and the Sunken Beacon', realm: 'leviathan_trench', dialogue: 'dlg_archon_final',
            goal: 'Down to the floor of the world, through the carcass and up the inverted Spire, to the thing that has been lit under thirty thousand feet of black water for three hundred years — and the Archon that keeps the door.',
            beats: ['Morvath, the Trench Behemoth, across the trench mouth.', 'The Drowned Spire, collapsing at one floor a day.', 'The Drowned Archon, and the choice behind it.']
        }
    ];

    const ENDINGS = [
        {
            id: 'ending_iron_age', name: 'The Iron Age', faction: 'syndicate',
            summary: 'The Heart is bound to an engine.',
            text: 'It takes the Syndicate eleven months to cut the housings and another four to bring the manifolds up to pressure, and on a Tuesday in the second winter the Heart of the Sun is plumbed into a steam plant the size of a district and turned on.\n\nIt works. It works beyond anything anybody costed for. There is light in every walkway from the Shallows to the Hollow, there is hot water, there is a child born on Rig Four who has never once been cold, and the Syndicate puts her on a poster.\n\nAnd the ocean becomes a factory. The rigs are welded into a single continuous machine, because a machine is more efficient than a town. The shifts go to sixteen hours because the plant does not stop. Vaelen Voss dies at his desk in the ninth year and is replaced by a committee, and the committee is replaced by a schedule, and by the twentieth year nobody on the water can tell you what the Heart was before it was Asset 1.\n\nHumanity survives. It survives as gear teeth, turning, in the warm.'
        },
        {
            id: 'ending_leviathan_awakening', name: 'The Leviathan\'s Awakening', faction: 'dredgers',
            summary: 'The Heart goes out, and we finish becoming what we were becoming.',
            text: 'Nahesia does not put it out so much as let it stop, which she says is a different thing and is right.\n\nThe last light goes out of the trench over nine days. Nothing burns, nothing explodes; the water simply closes the way water does, and the Abyssal Rot — which has been in the register, in the reef, in the marrow, in a third of everyone reading this — stops being an infection and becomes the baseline.\n\nThe first generation is hard. People drown learning not to. The second generation does not drown. By the fourth there are children on the Hollow who have never been dry and never been afraid of the dark, whose lungs are a formality and whose eyes are enormous, and who find the old photographs of a yellow sky funny in a way they cannot explain to their grandparents.\n\nThe old world ends. It was ending anyway. Something goes on living in the water, and it remembers being us, and it is not sorry.'
        },
        {
            id: 'ending_cleansing_pyre', name: 'The Cleansing Pyre', faction: 'inquisitors',
            summary: 'The Sun is relit, and the ocean is not there afterwards.',
            text: 'Malakor lights it himself and is the first thing the light touches, and there is no record of what his face was doing.\n\nThe ocean does not boil the way water boils. It goes in eleven days, in a column of steam that can be seen from the Spire and then from everywhere and then from nowhere because there is no more everywhere left to see it from. When it stops there is a sky — an actual sky, blue, with weather in it — over a landscape of salt flats, drowned cities lying on their sides, and Leviathan skeletons the size of mountain ranges going brown in the new air.\n\nThe Rot burns out of the water because there is no water. It also burns out of the people it had got into, which is roughly a third of the register, and the Inquisition had the list ready.\n\nAbout nine thousand people walk down off the rigs onto dry ground. It is hot, and it is barren, and there is nothing growing anywhere, and the sun comes up in the morning and they all stand and watch it because not one of them has ever seen that happen.'
        }
    ];

    return {
        version: 2,
        realms: REALMS,
        factions: FACTIONS,
        attributes: ATTRIBUTES,
        skillTrees: SKILL_TREES,
        tierLevel: TIER_LEVEL,
        materials: MATERIALS,
        rarities: RARITIES,
        prefixes: PREFIXES,
        suffixes: SUFFIXES,
        curses: CURSES,
        runes: RUNES,
        qualityBands: QUALITY_BANDS,
        recipes: RECIPES,
        bestiary: BESTIARY,
        nemesisRanks: NEMESIS_RANKS,
        lordCreatures: LORD_CREATURES,
        lordNames: LORD_NAMES,
        earnedTitles: EARNED_TITLES,
        nemesisTraits: NEMESIS_TRAITS,
        lordDialogue: LORD_DIALOGUE,
        catches: CATCHES,
        fishingSpots: FISHING_SPOTS,
        nodeText: NODE_TEXT,
        mysteryEvents: MYSTERY_EVENTS,
        bosses: BOSSES,
        dialogue: DIALOGUE,
        codex: CODEX,
        acts: ACTS,
        endings: ENDINGS
    };
})();
