/* echoes of the tide: leviathan's wake — content.
 *
 * Every realm, faction, creature, fish, recipe, rune, rune-word, line of
 * dialogue and scrap of lore lives here. No rules, no formulas, no state:
 * this file is a library the engine reads and never writes.
 *
 * The rules live in games/echoes.js. The contract between the two is
 * games/ECHOES-GDD.md, and where the two disagree the GDD is right.
 */

window.ECHOES_DATA = (function () {
    'use strict';

    // ---------- realms ----------
    // tier drives enemy scaling, loot tier and the level gate; pressure is the
    // hard gate — walk into the Trench without a rating of 3 and the water
    // does the arithmetic for you.
    const REALMS = [
        {
            id: 'rust_shallows',
            name: 'The Rust Shallows',
            tier: 1,
            pressure: 0,
            act: 1,
            blurb: 'Forty square miles of lashed-together rig, floating on the drowned roofs of a city nobody can name any more. Safe, if you keep your hands inside the rail.',
            long: 'The Shallows are what happens when eleven thousand people agree not to sink. Walkways of container steel, a chapel made from a crane cab, and at low tide the wrecks come up out of the water like teeth.',
            weather: ['flat grey water', 'rust-coloured rain', 'a fog that smells of hot metal', 'dead calm, which nobody likes'],
            harbour: 'Vell\'s Landing',
            sanityDrain: 0
        },
        {
            id: 'whispering_reefs',
            name: 'The Whispering Reefs',
            tier: 2,
            pressure: 1,
            act: 2,
            blurb: 'Coral grown through a sunken telecoms array. The mist repeats conversations. Some of them have not happened yet.',
            long: 'Sound does not behave here. The reef holds it, folds it, and gives it back a week later in the wrong voice. Dredgers come to listen. Inquisitors come to burn what listens back.',
            weather: ['corrosive mist', 'a mist that is talking', 'green phosphor tide', 'silence, total and wrong'],
            harbour: 'The Listening Post',
            sanityDrain: 1
        },
        {
            id: 'leviathan_trench',
            name: 'The Leviathan Trench',
            tier: 3,
            pressure: 3,
            act: 3,
            blurb: 'Eleven miles down, and the walls are ribs. Bring pressure gear or bring a shorter plan.',
            long: 'The carcass of a Leviathan lies across the trench mouth like a fallen bridge. It has been dead for two hundred years. It is still warm, and its heart still moves once a day, and the Ironclad have built a rendering plant inside its jaw.',
            weather: ['crushing dark', 'marrow-lit gloom', 'the current running the wrong way', 'a slow tolling, from below'],
            harbour: 'Jawbone Station',
            sanityDrain: 3
        },
        {
            id: 'drowned_spire',
            name: 'The Drowned Spire',
            tier: 4,
            pressure: 5,
            act: 4,
            blurb: 'A mountain, upside down, with the Heart of the Sunken Beacon at the bottom — which, from where you are standing, is up.',
            long: 'The Spire is collapsing at the rate of one floor a day and has been for three hundred years, which means either the arithmetic is wrong or something is rebuilding it at night.',
            weather: ['falling stone', 'the light from below', 'held breath', 'the Leviathan turning over'],
            harbour: 'The Last Cleat',
            sanityDrain: 5
        }
    ];

    // ---------- factions ----------
    const FACTIONS = {
        ironclad: {
            id: 'ironclad',
            name: 'The Ironclad Syndicate',
            short: 'Ironclad',
            creed: 'Keep it floating. Ask later.',
            blurb: 'Metallurgists, rig-engineers and marrow-renderers. They burn Leviathan fat for steam and consider that a moral position.',
            tree: 'marrow_smith',
            perk: 'Forge quality +1 band, repairs cost half, +8% armour.',
            hates: null,
            bonus: { armourPct: 0.08, forge: 1 }
        },
        dredgers: {
            id: 'dredgers',
            name: 'The Veil Dredgers',
            short: 'Dredgers',
            creed: 'It is talking. Someone should answer.',
            blurb: 'Mystic anglers and deep-sea occultists. Their liturgy is a knot diagram. Their saints are all still down there.',
            tree: 'tide_weaver',
            perk: 'Sanity loss −30%, abyssal damage +10%, rare dredging odds up a band.',
            hates: 'inquisitors',
            bonus: { sanityPct: 0.30, abyssalPct: 0.10 }
        },
        inquisitors: {
            id: 'inquisitors',
            name: 'The Ash Inquisitors',
            short: 'Inquisitors',
            creed: 'The Sun is not lost. It is buried. Dig with fire.',
            blurb: 'Zealots with doctrine and naphtha. They are the only people on the water who are not afraid, which is not the same as being right.',
            tree: 'harpooner',
            perk: 'Burn damage +20%, immune to fear, kills by pyre are permanent.',
            hates: 'dredgers',
            bonus: { burnPct: 0.20, fearImmune: true }
        }
    };

    // ---------- attributes ----------
    const ATTRIBUTES = [
        { id: 'might', name: 'Might', short: 'MGT', governs: 'physical damage, carry weight, [Strength] checks' },
        { id: 'finesse', name: 'Finesse', short: 'FIN', governs: 'crit chance, dodge, hit chance' },
        { id: 'attunement', name: 'Attunement', short: 'ATT', governs: 'abyssal damage, sanity resistance, [Abyssal Lore]' },
        { id: 'fortitude', name: 'Fortitude', short: 'FOR', governs: 'max HP, armour scaling' },
        { id: 'perception', name: 'Perception', short: 'PER', governs: 'dredging luck, trap detection, [Bribe]' }
    ];

    // ---------- skill trees ----------
    // effect ids are read by the engine; per-rank values are the ladder.
    const SKILL_TREES = [
        {
            id: 'marrow_smith',
            name: 'Marrow-Smith',
            faction: 'ironclad',
            blurb: 'Everything the Syndicate knows, which is metal and how to make it stop being metal.',
            nodes: [
                { id: 'tempering', name: 'Tempering', effect: 'armourPct', ranks: [0.06, 0.12, 0.18, 0.24, 0.30], text: 'Armour +{v}%.' },
                { id: 'marrow_furnace', name: 'Marrow Furnace', effect: 'forgeBand', ranks: [1, 2, 3, 4, 5], text: 'Heat band widened; forge quality more forgiving (rank {r}).' },
                { id: 'socketing', name: 'Socketing', effect: 'sockets', ranks: [1, 1, 2, 2, 3], text: 'Add up to {v} sockets to gear you forge.' },
                { id: 'salvage', name: 'Salvage', effect: 'salvagePct', ranks: [0.20, 0.35, 0.50, 0.65, 0.80], text: 'Breaking gear returns {v}% of its materials.' },
                { id: 'reinforce', name: 'Reinforce', effect: 'durability', ranks: [10, 20, 30, 40, 50], text: 'Gear durability +{v}.' },
                { id: 'steam_vent', name: 'Steam Vent', effect: 'staminaMax', ranks: [1, 2, 3, 4, 5], text: 'Max stamina +{v}.' },
                { id: 'anvil_stance', name: 'Anvil Stance', effect: 'blockPct', ranks: [0.08, 0.14, 0.20, 0.26, 0.32], text: 'Guard reduces incoming damage by a further {v}%.' },
                { id: 'masterwork', name: 'Masterwork', effect: 'rarityBias', ranks: [0.05, 0.10, 0.16, 0.22, 0.30], text: 'Masterwork odds +{v}%.' }
            ]
        },
        {
            id: 'tide_weaver',
            name: 'Tide-Weaver',
            faction: 'dredgers',
            blurb: 'The Dredger curriculum: listen, answer, and do not let it finish the sentence.',
            nodes: [
                { id: 'abyssal_bolt', name: 'Abyssal Bolt', effect: 'ability', ability: 'abyssal_bolt', ranks: [10, 16, 23, 31, 40], text: 'A bolt of the deep: {v} abyssal damage, 2 stamina.' },
                { id: 'deep_sight', name: 'Deep Sight', effect: 'revealTraits', ranks: [1, 2, 3, 4, 5], text: 'Reveal {v} hidden traits on any foe without a reading.' },
                { id: 'sanity_ward', name: 'Sanity Ward', effect: 'sanityWard', ranks: [0.10, 0.18, 0.26, 0.34, 0.45], text: 'Sanity loss −{v}%.' },
                { id: 'leech_tide', name: 'Leech Tide', effect: 'leechPct', ranks: [0.10, 0.16, 0.22, 0.28, 0.35], text: 'Heal {v}% of abyssal damage dealt.' },
                { id: 'pressure_skin', name: 'Pressure Skin', effect: 'pressure', ranks: [1, 1, 2, 2, 3], text: 'Pressure rating +{v} without gear.' },
                { id: 'whisper', name: 'Whisper', effect: 'ability', ability: 'whisper', ranks: [0.18, 0.26, 0.34, 0.42, 0.50], text: '{v}% chance the foe loses its turn. 3 stamina.' },
                { id: 'chum', name: 'Chum the Water', effect: 'dredgeLuck', ranks: [1, 2, 3, 4, 5], text: 'Dredging rarity roll +{v}.' },
                { id: 'drowned_sight', name: 'Drowned Sight', effect: 'nemesisRead', ranks: [1, 2, 3, 4, 5], text: 'Read a Drowned Lord\'s weaknesses from {v} realms away.' }
            ]
        },
        {
            id: 'harpooner',
            name: 'Harpooner',
            faction: 'inquisitors',
            blurb: 'Neutral trade, Inquisitor doctrine. A line, a barb, and the conviction that everything can be pulled up.',
            nodes: [
                { id: 'harpoon_throw', name: 'Harpoon Throw', effect: 'ability', ability: 'harpoon', ranks: [12, 19, 27, 36, 46], text: '{v} piercing damage, ignores 50% armour. 2 stamina.' },
                { id: 'barbed', name: 'Barbed', effect: 'bleed', ranks: [3, 5, 8, 11, 15], text: 'Attacks bleed for {v} over 3 rounds.' },
                { id: 'sure_footing', name: 'Sure Footing', effect: 'dodgeFlat', ranks: [0.02, 0.04, 0.06, 0.08, 0.10], text: 'Dodge +{v}.' },
                { id: 'burn_oil', name: 'Burn Oil', effect: 'ability', ability: 'burn_oil', ranks: [9, 15, 22, 30, 39], text: '{v} burn damage over 3 rounds. 2 stamina.' },
                { id: 'reel_in', name: 'Reel In', effect: 'ability', ability: 'reel_in', ranks: [0.25, 0.35, 0.45, 0.55, 0.65], text: 'Pull the foe in: {v} chance to stun. 3 stamina.' },
                { id: 'second_line', name: 'Second Line', effect: 'secondLine', ranks: [0.15, 0.22, 0.30, 0.38, 0.50], text: 'Below 35% HP, {v} chance of a second attack each round.' },
                { id: 'trophy', name: 'Trophy', effect: 'lootPct', ranks: [0.10, 0.18, 0.26, 0.34, 0.45], text: 'Loot and coin +{v}%.' },
                { id: 'killing_tide', name: 'Killing Tide', effect: 'critDmg', ranks: [0.10, 0.18, 0.26, 0.34, 0.45], text: 'Critical damage +{v}%.' }
            ]
        }
    ];

    // ---------- materials, five tiers ----------
    const MATERIALS = [
        { id: 'scrap_iron', name: 'Scrap Iron', tier: 1, value: 3, text: 'Rig plate, hull skin, the lids of things. Everywhere, and it shows.' },
        { id: 'abyssal_bronze', name: 'Abyssal Bronze', tier: 2, value: 11, text: 'Alloyed under pressure by people who are dead now. Takes an edge and keeps a grudge.' },
        { id: 'chitin_plate', name: 'Chitin Plate', tier: 3, value: 34, text: 'Cut from something that grew it. Lighter than steel, and it flexes when the water does.' },
        { id: 'leviathan_bone', name: 'Leviathan Bone', tier: 4, value: 96, text: 'Not calcium. Nobody is sure what it is. A blade of it severs things that do not stay severed otherwise.' },
        { id: 'celestial_core', name: 'Celestial Core', tier: 5, value: 340, text: 'A fragment of the thing that fell. Warm. Slightly heavier every time it is weighed.' },
        { id: 'marrow_oil', name: 'Marrow Oil', tier: 2, value: 8, reagent: true, text: 'Rendered Leviathan fat. Burns for a week. Smells like a memory of the sun.' },
        { id: 'brine_salt', name: 'Brine Salt', tier: 1, value: 4, reagent: true, text: 'Cures meat, cures wounds, cures the small kinds of haunting.' },
        { id: 'glass_ash', name: 'Glass Ash', tier: 3, value: 26, reagent: true, text: 'What the reef leaves when it is burned. Inquisitors call it proof.' }
    ];

    // ---------- recipes ----------
    // base stats before quality, affixes and runes. slot drives what it can do.
    const RECIPES = [
        // tier 1 — Scrap Iron
        { id: 'rig_hook', name: 'Rig Hook', slot: 'mainHand', tier: 1, damageType: 'physical', base: { damage: 9, critRating: 2 }, cost: { scrap_iron: 4 }, weight: 3, value: 34, text: 'A cargo hook with the safety ground off.' },
        { id: 'plate_vest', name: 'Plate Vest', slot: 'body', tier: 1, base: { armour: 6 }, cost: { scrap_iron: 6 }, weight: 8, value: 40, text: 'Container steel and webbing. Heavy, honest.' },
        { id: 'welders_hood', name: 'Welder\'s Hood', slot: 'head', tier: 1, base: { armour: 3, pressureRating: 1 }, cost: { scrap_iron: 3 }, weight: 2, value: 26, text: 'Smoked glass. Keeps the sparks and some of the looking out.' },
        { id: 'tarred_line', name: 'Tarred Line', slot: 'line', tier: 1, base: { lineStrength: 1 }, cost: { scrap_iron: 2, brine_salt: 2 }, weight: 1, value: 22, text: 'Hemp and tar. Snaps politely.' },
        // tier 2 — Abyssal Bronze
        { id: 'bronze_gaff', name: 'Bronze Gaff', slot: 'mainHand', tier: 2, damageType: 'physical', base: { damage: 13, critRating: 4 }, cost: { abyssal_bronze: 5, scrap_iron: 4 }, weight: 4, value: 110, text: 'The bronze remembers the pressure it was made under and passes it on.' },
        { id: 'diving_carapace', name: 'Diving Carapace', slot: 'body', tier: 2, base: { armour: 9, pressureRating: 1 }, cost: { abyssal_bronze: 7, scrap_iron: 5 }, weight: 12, value: 148, text: 'A pre-Tide suit with a century of patches, each one a story with a bad ending.' },
        { id: 'dredger_censer', name: 'Dredger Censer', slot: 'offHand', tier: 2, damageType: 'abyssal', base: { damage: 10, critRating: 2 }, cost: { abyssal_bronze: 4, marrow_oil: 3 }, weight: 2, value: 126, faction: 'dredgers', text: 'Swung on a chain, it makes a sound that things below answer.' },
        { id: 'braided_line', name: 'Braided Steel Line', slot: 'line', tier: 2, base: { lineStrength: 2 }, cost: { abyssal_bronze: 3 }, weight: 2, value: 96, text: 'Will hold a glasshead. Will not hold what eats a glasshead.' },
        // tier 3 — Chitin Plate
        { id: 'chitin_spear', name: 'Chitin Spear', slot: 'mainHand', tier: 3, damageType: 'physical', base: { damage: 18, critRating: 7, penetration: 0.25 }, cost: { chitin_plate: 6, abyssal_bronze: 4 }, weight: 5, value: 320, text: 'Grown, not forged. Still faintly warm at the base.' },
        { id: 'reef_mail', name: 'Reef Mail', slot: 'body', tier: 3, base: { armour: 13, pressureRating: 2 }, cost: { chitin_plate: 8, abyssal_bronze: 5 }, weight: 11, value: 380, text: 'Overlapping plate that closes when struck, like something deciding.' },
        { id: 'pressure_helm', name: 'Pressure Helm', slot: 'head', tier: 3, base: { armour: 5, pressureRating: 3 }, cost: { chitin_plate: 5, abyssal_bronze: 4 }, weight: 5, value: 300, text: 'Rated to eleven miles. The rating is a hope with a stamp on it.' },
        { id: 'sinew_line', name: 'Sinew Line', slot: 'line', tier: 3, base: { lineStrength: 3 }, cost: { chitin_plate: 4, marrow_oil: 3 }, weight: 2, value: 260, text: 'Tendon from something with too many of them.' },
        // tier 4 — Leviathan Bone
        { id: 'bone_cleaver', name: 'Leviathan-Bone Cleaver', slot: 'mainHand', tier: 4, damageType: 'physical', base: { damage: 25, critRating: 10, penetration: 0.35 }, cost: { leviathan_bone: 6, chitin_plate: 5 }, weight: 7, value: 900, permanent: true, text: 'Takes a head off, and the head stays off. This is the only weapon on the water that kills a Drowned Lord for good by main force.' },
        { id: 'bone_harness', name: 'Bone Harness', slot: 'body', tier: 4, base: { armour: 17, pressureRating: 4 }, cost: { leviathan_bone: 7, chitin_plate: 6 }, weight: 13, value: 980, text: 'Ribs, worn as ribs. Cold in the morning.' },
        { id: 'marrow_crown', name: 'Marrow Crown', slot: 'head', tier: 4, base: { armour: 7, pressureRating: 4, critRating: 6 }, cost: { leviathan_bone: 5, marrow_oil: 6 }, weight: 4, value: 860, text: 'It hums at the pitch of your own name.' },
        { id: 'deep_line', name: 'Deep Line', slot: 'line', tier: 4, base: { lineStrength: 4 }, cost: { leviathan_bone: 4, chitin_plate: 4 }, weight: 3, value: 720, text: 'Rated for eldritch. Rated is a strong word.' },
        // tier 5 — Celestial Core
        { id: 'core_lance', name: 'Celestial Lance', slot: 'mainHand', tier: 5, damageType: 'burn', base: { damage: 33, critRating: 14, penetration: 0.40 }, cost: { celestial_core: 3, leviathan_bone: 6 }, weight: 8, value: 2600, permanent: true, text: 'A splinter of the fallen Sun on a shaft of bone. It lights the water for a mile and everything in that mile looks up.' },
        { id: 'core_aegis', name: 'Celestial Aegis', slot: 'offHand', tier: 5, base: { armour: 12, pressureRating: 5 }, cost: { celestial_core: 2, leviathan_bone: 5 }, weight: 9, value: 2400, text: 'Holds back water, pressure, and — twice, so far — a decision.' },
        { id: 'sun_lantern', name: 'Drowned Sun Lantern', slot: 'trinket', tier: 5, base: { critRating: 10, pressureRating: 3 }, cost: { celestial_core: 2, glass_ash: 8 }, weight: 2, value: 2200, text: 'Sanity +20 while carried. It is a small piece of daylight and you are very tired.', grants: { sanityMax: 20 } }
    ];

    // ---------- affixes and curses ----------
    const AFFIXES = [
        { id: 'keen', name: 'Keen', stat: 'critRating', min: 2, max: 9, slots: ['mainHand', 'offHand', 'head', 'trinket'] },
        { id: 'heavy', name: 'Heavy', stat: 'damage', min: 3, max: 10, slots: ['mainHand', 'offHand'] },
        { id: 'plated', name: 'Plated', stat: 'armour', min: 2, max: 8, slots: ['body', 'head', 'offHand'] },
        { id: 'sealed', name: 'Sealed', stat: 'pressureRating', min: 1, max: 2, slots: ['body', 'head', 'trinket'] },
        { id: 'taut', name: 'Taut', stat: 'lineStrength', min: 1, max: 2, slots: ['line'] },
        { id: 'saltproof', name: 'Salt-Proof', stat: 'durability', min: 15, max: 45, slots: ['mainHand', 'body', 'head', 'offHand', 'line'] },
        { id: 'quiet', name: 'Quiet', stat: 'sanityMax', min: 4, max: 14, slots: ['head', 'trinket', 'body'] }
    ];

    const CURSES = [
        { id: 'hollowing', name: 'Hollowing', stat: 'sanityMaxPct', value: -0.15, text: 'Max sanity −15%.' },
        { id: 'oil_soaked', name: 'Oil-Soaked', stat: 'burnTaken', value: 0.10, text: 'Takes 10% more burn damage.' },
        { id: 'leaden', name: 'Leaden', stat: 'staminaRegen', value: -1, text: 'Stamina regen −1.' }
    ];

    // runes are found, never crafted
    const RUNES = [
        { id: 'rune_marrow', name: 'Marrow Rune', stat: 'damage', base: 6, text: 'Cut from a rib that was still deciding.' },
        { id: 'rune_barnacle', name: 'Barnacle Rune', stat: 'armour', base: 5, text: 'It grows back if you scrape it off. Slowly.' },
        { id: 'rune_glass', name: 'Glass Rune', stat: 'critRating', base: 7, text: 'Reef-glass, cut once, correctly.' },
        { id: 'rune_deep', name: 'Deep Rune', stat: 'pressureRating', base: 1, text: 'A knot the Dredgers tie in metal.' },
        { id: 'rune_lantern', name: 'Lantern Rune', stat: 'sanityMax', base: 10, text: 'Warm to hold. Warmer at night.' },
        { id: 'rune_hook', name: 'Hook Rune', stat: 'lineStrength', base: 1, text: 'Every line that carries it comes back.' },
        { id: 'rune_ash', name: 'Ash Rune', stat: 'burnDamage', base: 8, text: 'Inquisitor issue. Consecrated, which here means annealed.' },
        { id: 'rune_hollow', name: 'Hollow Rune', stat: 'abyssalDamage', base: 8, text: 'Do not read it aloud. It is a name.' },
        { id: 'rune_iron', name: 'Iron Rune', stat: 'durability', base: 40, text: 'Syndicate standard. Boring, and it works.' },
        { id: 'rune_tide', name: 'Tide Rune', stat: 'staminaMax', base: 2, text: 'It fills at high water. So do you.' }
    ];

    // ---------- bestiary ----------
    // fodder and elites. Drowned Lords are generated from LORD_CREATURES.
    const BESTIARY = [
        // Rust Shallows
        { id: 'rust_ghoul', name: 'Rust Ghoul', realm: 'rust_shallows', level: 2, hp: 60, damage: 14, damageType: 'physical', armour: 1, finesse: 7, weak: ['burn'], resist: [], xp: 26, coin: 8, sanity: 0, drops: { scrap_iron: [1, 3] }, text: 'A rigger who drowned in the suit and kept the shift going.' },
        { id: 'gull_swarm', name: 'Gull Swarm', realm: 'rust_shallows', level: 2, hp: 44, damage: 10, damageType: 'physical', armour: 0, finesse: 16, weak: ['burn'], resist: ['abyssal'], xp: 22, coin: 5, sanity: 0, drops: { brine_salt: [1, 2] }, text: 'Nine birds with one opinion.' },
        { id: 'hull_crab', name: 'Hull Crab', realm: 'rust_shallows', level: 3, hp: 89, damage: 19, damageType: 'physical', armour: 4, finesse: 4, weak: ['physical'], resist: ['bleed'], xp: 34, coin: 11, sanity: 0, drops: { scrap_iron: [2, 4], chitin_plate: [0, 1] }, text: 'Grew inside a ballast tank. Shaped, therefore, like a ballast tank.' },
        { id: 'salvage_thief', name: 'Salvage Thief', realm: 'rust_shallows', level: 4, hp: 76, damage: 23, damageType: 'physical', armour: 2, finesse: 14, weak: [], resist: [], xp: 40, coin: 24, sanity: 0, drops: { scrap_iron: [1, 3] }, text: 'Not a monster. Worse: a person with rent to make.' },
        { id: 'brine_wight', name: 'Brine Wight', realm: 'rust_shallows', level: 5, hp: 117, damage: 28, damageType: 'abyssal', armour: 2, finesse: 9, weak: ['burn'], resist: ['abyssal'], xp: 56, coin: 18, sanity: 4, drops: { brine_salt: [2, 4], abyssal_bronze: [0, 1] }, text: 'Salt in the shape of a man, holding the shape out of spite.' },
        // Whispering Reefs
        { id: 'reef_choirling', name: 'Reef Choirling', realm: 'whispering_reefs', level: 7, hp: 60, damage: 22, damageType: 'abyssal', armour: 5, finesse: 12, weak: ['burn'], resist: ['abyssal'], xp: 88, coin: 26, sanity: 6, drops: { glass_ash: [1, 3], abyssal_bronze: [1, 2] }, text: 'It sings in your voice, a week early, and gets a word wrong.' },
        { id: 'glass_hound', name: 'Glass Hound', realm: 'whispering_reefs', level: 8, hp: 67, damage: 27, damageType: 'physical', armour: 6, finesse: 19, weak: ['physical'], resist: ['bleed'], xp: 100, coin: 30, sanity: 2, drops: { glass_ash: [2, 4], chitin_plate: [0, 2] }, text: 'Coral grown around a dog that came out here to die and did not finish.' },
        { id: 'mist_surgeon', name: 'Mist Surgeon', realm: 'whispering_reefs', level: 9, hp: 75, damage: 30, damageType: 'bleed', armour: 7, finesse: 16, weak: ['abyssal'], resist: ['physical'], xp: 118, coin: 38, sanity: 8, drops: { chitin_plate: [1, 3] }, text: 'It takes something small and leaves the wound open so it can come back.' },
        { id: 'corroded_saint', name: 'Corroded Saint', realm: 'whispering_reefs', level: 11, hp: 97, damage: 34, damageType: 'burn', armour: 12, finesse: 11, weak: ['abyssal'], resist: ['burn'], xp: 150, coin: 52, sanity: 10, drops: { glass_ash: [2, 5], abyssal_bronze: [2, 4] }, text: 'An Inquisitor who reached the reef, got the doctrine right, and burned anyway.' },
        // Leviathan Trench
        { id: 'marrow_render', name: 'Marrow Render', realm: 'leviathan_trench', level: 14, hp: 68, damage: 75, damageType: 'physical', armour: 5, finesse: 12, weak: ['abyssal'], resist: ['physical'], xp: 260, coin: 78, sanity: 6, drops: { leviathan_bone: [1, 2], marrow_oil: [2, 5] }, text: 'A rendering-plant machine that kept working after the crew stopped being crew.' },
        { id: 'pressure_wraith', name: 'Pressure Wraith', realm: 'leviathan_trench', level: 15, hp: 60, damage: 84, damageType: 'abyssal', armour: 3, finesse: 21, weak: ['burn'], resist: ['abyssal'], xp: 290, coin: 84, sanity: 14, drops: { leviathan_bone: [0, 2], glass_ash: [2, 4] }, text: 'What eleven miles of water does to a diver who took the helmet off on purpose.' },
        { id: 'rib_walker', name: 'Rib Walker', realm: 'leviathan_trench', level: 17, hp: 89, damage: 90, damageType: 'physical', armour: 8, finesse: 9, weak: ['bleed', 'physical'], resist: ['abyssal'], xp: 340, coin: 96, sanity: 8, drops: { leviathan_bone: [2, 4], chitin_plate: [2, 4] }, text: 'The carcass moves a little. This is one of the pieces that moves the most.' },
        { id: 'trench_choir', name: 'Trench Choir', realm: 'leviathan_trench', level: 19, hp: 79, damage: 101, damageType: 'abyssal', armour: 4, finesse: 17, weak: ['burn'], resist: ['abyssal'], xp: 400, coin: 120, sanity: 22, drops: { leviathan_bone: [1, 3], marrow_oil: [3, 6] }, text: 'Forty voices, one throat, and they are all reading from your file.' },
        // Drowned Spire
        { id: 'spire_sentinel', name: 'Spire Sentinel', realm: 'drowned_spire', level: 24, hp: 135, damage: 72, damageType: 'burn', armour: 10, finesse: 15, weak: ['abyssal'], resist: ['burn'], xp: 700, coin: 190, sanity: 10, drops: { celestial_core: [0, 1], leviathan_bone: [2, 4] }, text: 'Built to guard a door that is no longer at that end of the building.' },
        { id: 'ash_apostle', name: 'Ash Apostle', realm: 'drowned_spire', level: 26, hp: 120, damage: 82, damageType: 'burn', armour: 8, finesse: 22, weak: ['abyssal'], resist: ['burn'], xp: 780, coin: 220, sanity: 16, drops: { glass_ash: [4, 8], celestial_core: [0, 1] }, text: 'Reached the Heart. Understood it. Chose fire. Is still choosing fire.' },
        { id: 'hollow_tide', name: 'The Hollow Tide', realm: 'drowned_spire', level: 28, hp: 153, damage: 88, damageType: 'abyssal', armour: 7, finesse: 20, weak: ['burn'], resist: ['abyssal', 'bleed'], xp: 880, coin: 250, sanity: 30, drops: { celestial_core: [1, 2] }, text: 'Not an animal. A shape the water is currently holding, and it has your posture.' }
    ];

    // base creatures a Drowned Lord is grown from
    const LORD_CREATURES = [
        { id: 'drowned_reaver', name: 'Drowned Reaver', hp: 1.00, damage: 1.00, damageType: 'physical', finesse: 12, armour: 1.0, text: 'Was a boarding officer. Kept the coat.' },
        { id: 'sump_prophet', name: 'Sump Prophet', hp: 0.85, damage: 1.15, damageType: 'abyssal', finesse: 14, armour: 0.8, text: 'Preaches at a pitch below hearing. You feel it in the teeth.' },
        { id: 'chain_baron', name: 'Chain Baron', hp: 1.25, damage: 0.90, damageType: 'physical', finesse: 8, armour: 1.4, text: 'Wears its own mooring. Has never let go of anything.' },
        { id: 'ash_widow', name: 'Ash Widow', hp: 0.90, damage: 1.20, damageType: 'burn', finesse: 16, armour: 0.9, text: 'Inquisitor, once. The fire took, and then kept going.' },
        { id: 'reef_dowager', name: 'Reef Dowager', hp: 1.10, damage: 1.05, damageType: 'abyssal', finesse: 13, armour: 1.1, text: 'Coral through the ribcage in a pattern that is almost lace.' },
        { id: 'harpoon_martyr', name: 'Harpoon Martyr', hp: 0.95, damage: 1.25, damageType: 'bleed', finesse: 18, armour: 0.85, text: 'Full of harpoons, none of them its own, none of them removed.' },
        { id: 'boiler_saint', name: 'Boiler Saint', hp: 1.30, damage: 0.95, damageType: 'burn', finesse: 7, armour: 1.5, text: 'A Syndicate engineer welded into the plant to keep the pressure up. It worked.' },
        { id: 'lantern_eater', name: 'Lantern-Eater', hp: 1.05, damage: 1.10, damageType: 'abyssal', finesse: 15, armour: 1.0, text: 'Goes for the light first. Then the hand holding it.' }
    ];

    // ---------- procedural naming ----------
    const LORD_NAMES = {
        given: ['Ossian', 'Marek', 'Halvard', 'Coilin', 'Brann', 'Idris', 'Sable', 'Vaughn', 'Rook', 'Tallis', 'Nessa', 'Oren', 'Kessel', 'Ferrow', 'Alder', 'Wren', 'Dray', 'Solen', 'Kirr', 'Maud', 'Beckett', 'Ilva', 'Hark', 'Cassian'],
        epithet: ['of the Long Line', 'Saltmouth', 'Nine-Fingers', 'of Rig Twelve', 'Blackwake', 'the Unquenched', 'Coldhold', 'of the Second Descent', 'Ironjaw', 'Lowwater', 'the Unlanded', 'Ashcoat', 'of the Broken Cleat', 'Deepdraught', 'Greylung', 'the Twice-Drowned']
    };

    // titles are earned, keyed by how the Lord killed you
    const TITLES = {
        bleed: 'The Carver',
        burn: 'The Kindled',
        abyssal: 'The Hollow',
        physical: 'The Anvil',
        fled: 'The Patient',
        sanity: 'The Chorus'
    };

    // war-cries assemble as {opener} {claim} {threat}, seeded per Lord
    const WAR_CRY = {
        opener: ['The water knows your name.', 'You came back.', 'Hold still.', 'I heard you coming for three days.', 'Ah.', 'Down here we count differently.', 'You are late.', 'Nobody sent you. I checked.'],
        claim: ['I have been drowned longer than you have been alive,', 'I am the last thing the Syndicate signed for,', 'The reef gave me your voice,', 'I was owed a death and I took several,', 'The Tide made me a promise,', 'I was a person on a Tuesday,', 'I hold the line here,', 'They put me down twice,'],
        threat: ['and the sea is patient.', 'and I do not need the light.', 'and you will float face-up.', 'and I will keep the hands.', 'so let us get it over with.', 'and it did not take.', 'and the water is rising.', 'and I have your line.']
    };

    // taunts keyed to how you died to that Lord
    const TAUNTS = {
        bleed: ['You leaked for a long while.', 'I opened you and you kept walking. That was the interesting part.', 'The salt found it before I did.'],
        burn: ['You went up like an oil drum.', 'There is a light down here now. It is you.', 'I told you the fire remembers.'],
        abyssal: ['You are hollow and you have been for some time.', 'The deep took the middle of you first.', 'I did not kill you. I finished you.'],
        physical: ['You broke where people break.', 'I have hit rig plate that gave more.', 'Face-down, and the tide turned you over.'],
        fled: ['You ran. I walk. Ask the water which is faster.', 'I know your line by its knot now.', 'Run again. I want to see how far it is.'],
        sanity: ['You joined the singing. Badly.', 'We kept the voice. The rest went in the water.', 'Welcome to the choir. Nobody asked me either.']
    };

    const SCARS = [
        { id: 'fire_blistered', name: 'Fire-Blistered', immuneTo: 'burn', text: 'Burned to the bone and the bone said no.' },
        { id: 'salt_cured', name: 'Salt-Cured', immuneTo: 'bleed', text: 'It does not bleed. It weeps brine, briefly, and closes.' },
        { id: 'deaf_deep', name: 'Deaf to the Deep', immuneTo: 'abyssal', text: 'Stopped listening. That is the whole trick.' },
        { id: 'barnacled', name: 'Barnacled', immuneTo: null, physicalReduction: 0.30, text: 'Three inches of shell, grown in anger.' }
    ];

    const TRAITS = [
        { id: 'tracker', name: 'Tracker', text: 'Has your scent, your knot and your habits. May ambush you in its realm.', weakness: 'Its realm is marked on your chart. It can be hunted.' },
        { id: 'bloated', name: 'Bloated', text: 'Grown heavy on what it has taken.', weakness: 'Slow. Loses initiative.' },
        { id: 'plated', name: 'Plated', text: 'Wearing an upgrade it took off someone.', weakness: 'Piercing attacks land 25% harder.' },
        { id: 'poorly_drowned', name: 'Poorly Drowned', text: 'You killed it and it did not take. It is thinner now, and much angrier.', weakness: 'Came back a rank lower.' },
        { id: 'grudge', name: 'Grudge', text: 'Deals +15% damage to you specifically.', weakness: 'Will not disengage, even when it should.' },
        { id: 'ascendant', name: 'Ascendant', text: 'Promoted over a corpse it used to answer to.', weakness: 'The demoted one has not forgotten.' }
    ];

    // ---------- dredging ----------
    // tide/time of null means "any". strength feeds the drag term, depth is
    // where the fight starts. eldritch entries are not catches — they are
    // encounters that were fishing back.
    const FISH = [
        // Rust Shallows
        { id: 'rig_cod', name: 'Rig Cod', realm: 'rust_shallows', band: 'common', strength: 0.55, depth: 24, value: 6, sanity: 2, tide: null, time: null, text: 'Grey, patient, faintly oily. Dinner.' },
        { id: 'brine_eel', name: 'Brine Eel', realm: 'rust_shallows', band: 'common', strength: 0.63, depth: 28, value: 9, sanity: 2, tide: null, time: null, drop: { brine_salt: 1 }, text: 'Bites after it is landed. Bites after it is cooked.' },
        { id: 'glasshead', name: 'Glasshead', realm: 'rust_shallows', band: 'uncommon', strength: 0.8, depth: 37, value: 26, sanity: 3, tide: ['rising', 'high'], time: null, drop: { glass_ash: 1 }, text: 'You can see the thoughts. There are two.' },
        { id: 'wreck_carp', name: 'Wreck Carp', realm: 'rust_shallows', band: 'uncommon', strength: 0.88, depth: 43, value: 32, sanity: 1, tide: ['low'], time: null, drop: { scrap_iron: 2 }, text: 'Lives in a filing cabinet. Has for generations.' },
        { id: 'marrow_lamprey', name: 'Marrow Lamprey', realm: 'rust_shallows', band: 'rare', strength: 1.13, depth: 54, value: 84, sanity: -3, tide: ['high'], time: ['night', 'deep night'], drop: { marrow_oil: 2 }, text: 'A mouth with a commute.' },
        { id: 'sunken_sextant', name: 'Sunken Sextant', realm: 'rust_shallows', band: 'relic', strength: 1.0, depth: 59, value: 210, sanity: 0, tide: ['low'], time: ['dawn', 'dusk'], codex: 'sextant', text: 'Brass, warm, and set to a star that is not there.' },
        // Whispering Reefs
        { id: 'ash_minnow', name: 'Ash Minnow', realm: 'whispering_reefs', band: 'common', strength: 0.67, depth: 29, value: 14, sanity: 2, tide: null, time: null, drop: { glass_ash: 1 }, text: 'Schools in the shape of a word.' },
        { id: 'coral_tongue', name: 'Coral Tongue', realm: 'whispering_reefs', band: 'common', strength: 0.76, depth: 35, value: 18, sanity: 1, tide: null, time: null, text: 'It repeats what you said while landing it. Correctly.' },
        { id: 'mist_ray', name: 'Mist Ray', realm: 'whispering_reefs', band: 'uncommon', strength: 1.0, depth: 48, value: 46, sanity: 3, tide: ['rising', 'falling'], time: null, drop: { chitin_plate: 1 }, text: 'Flat, silent, and warm on the underside.' },
        { id: 'corpse_light_squid', name: 'Corpse-Light Squid', realm: 'whispering_reefs', band: 'rare', strength: 1.33, depth: 64, value: 130, sanity: -4, tide: ['high'], time: ['night', 'deep night', 'witching'], drop: { marrow_oil: 3 }, rune: 0.25, text: 'The light is not for seeing by. It is for being seen by.' },
        { id: 'drowned_reliquary', name: 'Drowned Reliquary', realm: 'whispering_reefs', band: 'relic', strength: 1.17, depth: 70, value: 340, sanity: 0, tide: ['low'], time: null, codex: 'reliquary', text: 'A saint\'s knucklebone in a box that has been opened, recently, from inside.' },
        { id: 'the_answering', name: 'The Answering', realm: 'whispering_reefs', band: 'eldritch', strength: 1.3, depth: 78, value: 0, sanity: -10, tide: ['high'], time: ['witching'], enemy: 'reef_choirling', text: 'The line goes slack. Then it goes taut in the other direction.' },
        // Leviathan Trench
        { id: 'gutter_hake', name: 'Gutter Hake', realm: 'leviathan_trench', band: 'common', strength: 0.92, depth: 46, value: 30, sanity: 1, tide: null, time: null, text: 'Eleven miles down and still ugly out of principle.' },
        { id: 'bone_shrimp', name: 'Bone Shrimp', realm: 'leviathan_trench', band: 'common', strength: 0.84, depth: 40, value: 26, sanity: 2, tide: null, time: null, drop: { leviathan_bone: 1 }, text: 'Eats the carcass. The carcass does not appear to mind.' },
        { id: 'pressure_pike', name: 'Pressure Pike', realm: 'leviathan_trench', band: 'uncommon', strength: 1.25, depth: 67, value: 78, sanity: 1, tide: ['rising', 'high'], time: null, drop: { chitin_plate: 2 }, text: 'Built at eleven miles. Explodes politely at three.' },
        { id: 'marrow_angler', name: 'Marrow Angler', realm: 'leviathan_trench', band: 'rare', strength: 1.58, depth: 83, value: 200, sanity: -5, tide: null, time: ['night', 'deep night', 'witching'], drop: { marrow_oil: 4, leviathan_bone: 1 }, rune: 0.35, text: 'The lure is a small warm room with a chair in it.' },
        { id: 'leviathan_tooth', name: 'Leviathan Tooth', realm: 'leviathan_trench', band: 'relic', strength: 1.45, depth: 89, value: 520, sanity: 0, tide: ['low', 'falling'], time: null, codex: 'tooth', drop: { leviathan_bone: 3 }, text: 'Shed, not broken. Which implies a replacement.' },
        { id: 'the_turning_over', name: 'Something Turning Over', realm: 'leviathan_trench', band: 'eldritch', strength: 1.65, depth: 99, value: 0, sanity: -16, tide: ['high'], time: ['witching'], enemy: 'trench_choir', text: 'The whole trench tilts by a degree. Your line is what tilted it.' },
        // Drowned Spire
        { id: 'spire_silverling', name: 'Spire Silverling', realm: 'drowned_spire', band: 'common', strength: 1.17, depth: 51, value: 60, sanity: 2, tide: null, time: null, text: 'Swims upward through stone. Nobody asks.' },
        { id: 'ember_carp', name: 'Ember Carp', realm: 'drowned_spire', band: 'uncommon', strength: 1.49, depth: 72, value: 140, sanity: 3, tide: null, time: null, drop: { glass_ash: 3 }, text: 'Warm all the way through. The Inquisitors consider it a sacrament and eat it anyway.' },
        { id: 'core_polyp', name: 'Core Polyp', realm: 'drowned_spire', band: 'rare', strength: 1.82, depth: 91, value: 380, sanity: -6, tide: ['high'], time: null, drop: { celestial_core: 1 }, rune: 0.45, text: 'Grown on the Heart. Slightly heavier every time it is weighed.' },
        { id: 'first_lantern', name: 'The First Lantern', realm: 'drowned_spire', band: 'relic', strength: 1.74, depth: 94, value: 900, sanity: 8, tide: ['low'], time: ['dawn'], codex: 'first_lantern', text: 'Somebody carried this down. Somebody carried this down on purpose.' },
        { id: 'fishing_back', name: 'It Is Fishing Back', realm: 'drowned_spire', band: 'eldritch', strength: 1.95, depth: 110, value: 0, sanity: -22, tide: ['high'], time: ['witching', 'deep night'], enemy: 'hollow_tide', text: 'Your line was already in the water when you arrived. You have not cast yet.' }
    ];

    const BANDS = ['common', 'uncommon', 'rare', 'relic', 'eldritch'];

    // ---------- dungeon flavour ----------
    const NODE_TEXT = {
        combat: ['Something is already in the corridor.', 'It was waiting where the light stops.', 'The water moves before anything in it does.', 'You are not the first thing down here tonight.'],
        elite: ['A Drowned Lord holds this door, and has for some time.', 'It knew you were coming. It said so, out loud, to nobody.', 'The chart marks this room empty. The chart is old.'],
        treasure: ['A strongbox, cracked, still owed to somebody.', 'The dead left a kit bag packed for a trip they nearly took.', 'A cache, sealed with Syndicate wax and opened once already.'],
        rest: ['A dry cleat, a lamp with oil in it, and nothing in the doorway.', 'Somebody built a bunk here and did not come back for it.', 'A Rest Rig: four hours, a hot tin, and the water kept outside.'],
        hazard: ['The floor is a grate and the grate is a suggestion.', 'Pressure differential. You hear it before you feel it.', 'Loose plate, live cable, black water.'],
        lore: ['A logbook, waterlogged to the last third.', 'Somebody wrote on the wall in grease pencil, at length.', 'A tin of photographs, and the sea has edited them.'],
        descent: ['Down. The word does more work down here.', 'A shaft, a ladder, and eleven rungs missing at the bottom.', 'The stair keeps going after the building stops.'],
        boss: ['The room opens out, and the room is not empty.', 'It has been down here the whole time and it has been listening.', 'This is what the chart was warning about.']
    };

    // ---------- bosses ----------
    const BOSSES = [
        {
            id: 'rust_mother', name: 'The Rust Mother', realm: 'rust_shallows', level: 8,
            hp: 135, damage: 18, damageType: 'physical', armour: 9, finesse: 10,
            weak: ['burn'], resist: ['bleed'], xp: 900, coin: 260, sanity: 6,
            drops: { abyssal_bronze: [4, 8], scrap_iron: [6, 12] },
            intro: 'She is the rig. Eleven thousand tons of lashed container steel with a face welded into the ballast door, and she has been the harbour since before the harbour had a name.',
            phases: [
                { at: 1.00, name: 'Ballast', text: 'The plates draw in. She is mostly door.' },
                { at: 0.50, name: 'The Flood', trigger: 'flood', text: 'She opens the sea valves. The deck goes under: dodge halved, every fire on you goes out.', effect: { dodgeMult: 0.5, extinguish: true, damageMult: 1.15 } }
            ],
            codex: 'rust_mother'
        },
        {
            id: 'reef_choir', name: 'The Choir of the Reef', realm: 'whispering_reefs', level: 14,
            hp: 182, damage: 20, damageType: 'abyssal', armour: 7, finesse: 18,
            weak: ['burn'], resist: ['abyssal', 'physical'], xp: 2400, coin: 520, sanity: 12,
            drops: { chitin_plate: [5, 9], glass_ash: [5, 10] },
            intro: 'Forty-one voices in a coral throat two hundred feet across, and every one of them is somebody who came out here and stayed. Two of them are people you have met.',
            phases: [
                { at: 1.00, name: 'Descant', text: 'It sings the part you were about to say.' },
                { at: 0.66, name: 'Antiphon', trigger: 'sanity', text: 'It answers itself. −12 sanity.', effect: { sanityHit: 12 } },
                { at: 0.33, name: 'Full Chorus', trigger: 'sanity', text: 'All forty-one at once. −12 sanity. Kill it below 20 sanity and it takes you with it.', effect: { sanityHit: 12, deadmans: 20 } }
            ],
            codex: 'reef_choir'
        },
        {
            id: 'the_turning', name: 'The Turning', realm: 'leviathan_trench', level: 22,
            hp: 385, damage: 26, damageType: 'physical', armour: 6, finesse: 12,
            weak: ['bleed'], resist: ['abyssal'], xp: 7000, coin: 1400, sanity: 14,
            drops: { leviathan_bone: [6, 11], marrow_oil: [6, 12], celestial_core: [0, 1] },
            intro: 'The Leviathan has been dead for two hundred years. Twice during this fight it will disagree.',
            phases: [
                { at: 1.00, name: 'Still', text: 'The carcass holds. Ribs, gantries, the rendering plant humming in the jaw.' },
                { at: 0.66, name: 'First Roll', trigger: 'invert', text: 'It rolls. Up is a wall now — your off-hand and head gear tear free.', effect: { unequip: ['offHand', 'head'], dodgeMult: 0.7 } },
                { at: 0.33, name: 'Second Roll', trigger: 'invert', text: 'It rolls the other way, and the arena inverts again. Body armour goes.', effect: { unequip: ['body'], damageMult: 1.3 } }
            ],
            codex: 'the_turning'
        },
        {
            id: 'beacons_heart', name: 'The Beacon\'s Heart', realm: 'drowned_spire', level: 30,
            hp: 500, damage: 25, damageType: 'burn', armour: 20, finesse: 20,
            weak: [], resist: ['burn', 'abyssal', 'physical', 'bleed'], xp: 20000, coin: 4000, sanity: 20,
            drops: { celestial_core: [3, 6], leviathan_bone: [6, 12] },
            intro: 'It is the size of a cathedral and the shape of a lit window, and it has been under thirty thousand feet of black water for three hundred years, waiting, with the patience of something that used to be a sun.',
            phases: [
                { at: 1.00, name: 'Ember', text: 'Warm. Only warm. It is being careful with you.' },
                { at: 0.75, name: 'Rising Water', trigger: 'flood', text: 'The chamber takes on water. Stamina costs double.', effect: { staminaMult: 2 } },
                { at: 0.45, name: 'Corona', trigger: 'burn', text: 'It stops being careful. Burn damage each round.', effect: { burnPerRound: 22 } },
                { at: 0.15, name: 'The Question', trigger: 'onehp', text: 'The water reaches your mouth. You finish this at 1 HP, by design, and it knows that, and it is sorry, and it stops. Four rounds of air.', effect: { setHp: 1, noAttack: true, drownIn: 4 } }
            ],
            codex: 'beacons_heart'
        }
    ];

    // ---------- dialogue ----------
    // node-based, JSON, resolved by d20 + derived skill vs dc (see GDD §1.4).
    // effect keys the engine understands: flag, rep, coin, codex, act,
    // unlock, join, item, sanity, end.
    const DIALOGUE = {
        vell: {
            id: 'vell', title: 'Harbourmaster Vell', start: 'vell_1', act: 1,
            nodes: {
                vell_1: {
                    id: 'vell_1', speaker: 'Harbourmaster Vell',
                    text: 'You brought up a piece of brass and it was warm. I have run this landing for nineteen years and warm brass is the one thing I have never had reported. So. What do you want from me.',
                    choices: [
                        { text: 'The trench chart.', goto: 'vell_2' },
                        { text: '[Abyssal Lore] It is not brass. It is a fragment of the Beacon casing.', check: { skill: 'abyssal_lore', dc: 12 }, pass: 'vell_lore', fail: 'vell_confused' },
                        { text: 'Nothing. I wanted somebody to know.', goto: 'vell_end', effect: { rep: { ironclad: 2 } } }
                    ]
                },
                vell_2: {
                    id: 'vell_2', speaker: 'Harbourmaster Vell',
                    text: 'You want the trench chart. Nobody wants the trench chart. People want the reef chart, and then they want a drink, and then they want the trench chart, and then I bury them.',
                    choices: [
                        { text: 'I have coin.', check: { skill: 'bribe', dc: 12 }, cost: { coin: 40 }, pass: 'vell_sold', fail: 'vell_insulted' },
                        { text: '[Abyssal Lore] The chart is already wrong. The trench mouth moved.', check: { skill: 'abyssal_lore', dc: 14 }, pass: 'vell_impressed', fail: 'vell_confused' },
                        { text: '[Intimidate] Nobody has to know you gave it to me.', check: { skill: 'intimidate', dc: 13 }, pass: 'vell_afraid', fail: 'vell_guards' },
                        { text: '[Strength] I could take it off the wall myself.', check: { skill: 'strength', dc: 15 }, pass: 'vell_afraid', fail: 'vell_guards' },
                        { text: 'Then I will find it myself.', goto: 'vell_end' }
                    ]
                },
                vell_lore: {
                    id: 'vell_lore', speaker: 'Harbourmaster Vell',
                    text: 'Beacon casing. Right. And I suppose you know what is under the casing, and I suppose that is why you are standing in my office with your hands like that.',
                    choices: [
                        { text: 'The Heart. And it is still lit.', goto: 'vell_2', effect: { codex: 'beacon', rep: { dredgers: 4 } } },
                        { text: 'I know it was warm. That is all I know.', goto: 'vell_2' }
                    ]
                },
                vell_sold: {
                    id: 'vell_sold', speaker: 'Harbourmaster Vell',
                    text: 'Forty. Fine. It is worth eleven and a funeral. Take it, and when the reef starts talking do not write to me about it.',
                    choices: [{ text: 'Take the chart.', goto: 'vell_end', effect: { flag: 'trench_chart', act: 2, unlock: 'whispering_reefs', codex: 'chart' } }]
                },
                vell_impressed: {
                    id: 'vell_impressed', speaker: 'Harbourmaster Vell',
                    text: 'The trench mouth moved. Nobody has said that out loud in this room. I have three soundings that say it and one dredger who will not come in off her boat any more.\n\nTake the chart. Mark the correction yourself. And come back and tell me if I have to move eleven thousand people.',
                    choices: [{ text: 'Take the chart.', goto: 'vell_end', effect: { flag: 'trench_chart', act: 2, unlock: 'whispering_reefs', codex: 'chart', rep: { ironclad: 8, dredgers: 4 } } }]
                },
                vell_afraid: {
                    id: 'vell_afraid', speaker: 'Harbourmaster Vell',
                    text: 'You are standing between me and the door and you know it, and you have made that the whole conversation. Fine. It is on the wall. It has been on the wall since before you could swim.',
                    choices: [{ text: 'Take it off the wall.', goto: 'vell_end', effect: { flag: 'trench_chart', act: 2, unlock: 'whispering_reefs', codex: 'chart', rep: { ironclad: -12 }, notorietyLine: true } }]
                },
                vell_insulted: {
                    id: 'vell_insulted', speaker: 'Harbourmaster Vell',
                    text: 'Forty. You are offering me forty to sign for your death. Put it away before somebody sees you do it.',
                    choices: [{ text: 'Put it away.', goto: 'vell_2', effect: { rep: { ironclad: -4 } } }]
                },
                vell_confused: {
                    id: 'vell_confused', speaker: 'Harbourmaster Vell',
                    text: 'I have no idea what you just said, and I have been listening to dredgers for nineteen years, so that is a real achievement.',
                    choices: [{ text: 'Try something else.', goto: 'vell_2' }]
                },
                vell_guards: {
                    id: 'vell_guards', speaker: 'Harbourmaster Vell',
                    text: 'Sten. Marguerite. Our friend is leaving.\n\nThey are not gentle and they are not sorry, and you are on the walkway before you have finished the sentence.',
                    choices: [{ text: 'Leave.', goto: 'vell_end', effect: { rep: { ironclad: -10 } } }]
                },
                vell_end: { id: 'vell_end', speaker: 'Harbourmaster Vell', text: 'Keep your hands inside the rail.', choices: [] }
            }
        },

        recruit: {
            id: 'recruit', title: 'The Hiring Floor', start: 'rec_1',
            nodes: {
                rec_1: {
                    id: 'rec_1', speaker: 'The Hiring Floor',
                    text: 'Three tables, one room, and nobody sits at two of them. The Syndicate has a ledger. The Dredgers have a knot board. The Inquisitors have a brazier going, indoors, in a building made of rope.',
                    choices: [
                        { text: 'The Ironclad Syndicate. Keep it floating.', goto: 'rec_iron' },
                        { text: 'The Veil Dredgers. Somebody should answer.', goto: 'rec_dredge' },
                        { text: 'The Ash Inquisitors. Dig with fire.', goto: 'rec_ash' },
                        { text: 'Nobody. I work the water alone.', goto: 'rec_none' }
                    ]
                },
                rec_iron: {
                    id: 'rec_iron', speaker: 'Foreman Adeyemi',
                    text: 'We do not ask what is in the water. We ask what it weighs and whether it will burn. Sign, and you get the forge, the discount and the benefit of a doubt.',
                    choices: [{ text: 'Sign.', goto: 'rec_end', effect: { join: 'ironclad', rep: { ironclad: 25, dredgers: -5, inquisitors: -5 } } }, { text: 'Not yet.', goto: 'rec_1' }]
                },
                rec_dredge: {
                    id: 'rec_dredge', speaker: 'Matron Sooley',
                    text: 'It talks. It has talked for three hundred years and the whole world has agreed to call it current. We answer. You will lose things — sleep first, then the middle of you.',
                    choices: [
                        { text: 'I will answer it.', goto: 'rec_end', effect: { join: 'dredgers', rep: { dredgers: 25, inquisitors: -30, ironclad: -5 }, codex: 'dredger_rite' } },
                        { text: '[Abyssal Lore] What does it say?', check: { skill: 'abyssal_lore', dc: 13 }, pass: 'rec_dredge_lore', fail: 'rec_dredge' }
                    ]
                },
                rec_dredge_lore: {
                    id: 'rec_dredge_lore', speaker: 'Matron Sooley',
                    text: 'It says a name. The same one, every night, in whatever voice is nearest. We have three hundred years of logs and the name changes once a generation, and the last time it changed was eleven days ago.',
                    choices: [{ text: 'Whose name is it now?', goto: 'rec_dredge_name' }]
                },
                rec_dredge_name: {
                    id: 'rec_dredge_name', speaker: 'Matron Sooley',
                    text: 'She does not say it. She writes it on the knot board, turns the board to the wall, and asks whether you are signing.',
                    choices: [
                        { text: 'Sign.', goto: 'rec_end', effect: { join: 'dredgers', rep: { dredgers: 30, inquisitors: -30, ironclad: -5 }, codex: 'the_name', flag: 'knows_name' } },
                        { text: 'Turn the board around.', goto: 'rec_end', effect: { codex: 'the_name', flag: 'knows_name', sanity: -8 } }
                    ]
                },
                rec_ash: {
                    id: 'rec_ash', speaker: 'Confessor Brant',
                    text: 'The Sun is not lost. It is buried, and everything that has grown in the dark since is a symptom. We are not cruel. We are early.',
                    choices: [
                        { text: 'Give me the oil.', goto: 'rec_end', effect: { join: 'inquisitors', rep: { inquisitors: 25, dredgers: -30, ironclad: -5 } } },
                        { text: '[Intimidate] A third of the rigs are already mutated. You would burn them.', check: { skill: 'intimidate', dc: 14 }, pass: 'rec_ash_hard', fail: 'rec_ash' }
                    ]
                },
                rec_ash_hard: {
                    id: 'rec_ash_hard', speaker: 'Confessor Brant',
                    text: 'Yes.\n\nHe does not flinch and he does not soften it, and that is the most honest thing anyone says to you on the hiring floor.',
                    choices: [
                        { text: 'Give me the oil.', goto: 'rec_end', effect: { join: 'inquisitors', rep: { inquisitors: 30, dredgers: -30 }, codex: 'ash_doctrine' } },
                        { text: 'No.', goto: 'rec_1', effect: { rep: { inquisitors: -10 } } }
                    ]
                },
                rec_none: {
                    id: 'rec_none', speaker: 'The Hiring Floor',
                    text: 'Nobody argues. Three tables go back to their ledgers, and you buy your own oil at the Syndicate price, which is the unaffiliated price, which is double.',
                    choices: [{ text: 'Leave.', goto: 'rec_end' }]
                },
                rec_end: { id: 'rec_end', speaker: 'The Hiring Floor', text: 'The brazier pops. Somebody at the knot board starts a new knot.', choices: [] }
            }
        },

        reef_echo: {
            id: 'reef_echo', title: 'What the Reefs Repeat', start: 'echo_1', act: 2,
            nodes: {
                echo_1: {
                    id: 'echo_1', speaker: 'The Mist',
                    text: 'The mist plays back a conversation. Two people, one of them out of breath. It is a week old, or a week early — the reef does not distinguish, and neither, after a while, do you.\n\nOne of the voices is yours.',
                    choices: [
                        { text: 'Listen to the whole thing.', goto: 'echo_listen', effect: { sanity: -12 } },
                        { text: '[Abyssal Lore] Make it repeat the last four seconds.', check: { skill: 'abyssal_lore', dc: 15 }, pass: 'echo_loop', fail: 'echo_static' },
                        { text: 'Walk out of the mist.', goto: 'echo_end' }
                    ]
                },
                echo_listen: {
                    id: 'echo_listen', speaker: 'The Mist',
                    text: 'You are telling somebody that the Heart can be relit, and that you have decided, and that you are sorry. The other voice asks how many. Your voice gives a number.\n\nYou do not recognise the number and you will not stop knowing it.',
                    choices: [{ text: 'Go to the trench.', goto: 'echo_end', effect: { flag: 'heard_echo', act: 3, unlock: 'leviathan_trench', codex: 'the_echo' } }]
                },
                echo_loop: {
                    id: 'echo_loop', speaker: 'The Mist',
                    text: 'You hold the reef at four seconds and make it say the number again, and again, and on the eleventh pass the other voice — the one that is not yours — stops answering the recording and answers you.\n\nIt says: "That is fewer than last time."',
                    choices: [{ text: 'Ask what last time was.', goto: 'echo_end', effect: { flag: 'heard_echo', flag2: 'looped_reef', act: 3, unlock: 'leviathan_trench', codex: 'the_echo', codex2: 'last_time', sanity: -6, rep: { dredgers: 10 } } }]
                },
                echo_static: {
                    id: 'echo_static', speaker: 'The Mist',
                    text: 'The reef gives you static and one clear word, which is your own name, mispronounced the way your mother did it.',
                    choices: [{ text: 'Listen to the whole thing instead.', goto: 'echo_listen' }, { text: 'Walk out.', goto: 'echo_end' }]
                },
                echo_end: { id: 'echo_end', speaker: 'The Mist', text: 'The mist closes behind you at exactly walking pace.', choices: [] }
            }
        },

        pressure_line: {
            id: 'pressure_line', title: 'The Pressure Line', start: 'pl_1', act: 3,
            nodes: {
                pl_1: {
                    id: 'pl_1', speaker: 'Chief Renderer Ostrow',
                    text: 'You want to go under the carcass. The carcass is eleven miles of dead Leviathan and I have four hundred people working inside its jaw, and if you wake it up I lose the plant, the crew and the only steam in the trench.',
                    choices: [
                        { text: '[Strength] Then come with me and hold the line.', check: { skill: 'strength', dc: 16 }, pass: 'pl_ally', fail: 'pl_no' },
                        { text: '[Bribe] Your crew gets a week\'s wages either way.', check: { skill: 'bribe', dc: 15 }, cost: { coin: 300 }, pass: 'pl_ally', fail: 'pl_no' },
                        { text: '[Abyssal Lore] It is not dead. It has never been dead. You have been rendering a sleeper.', check: { skill: 'abyssal_lore', dc: 17 }, pass: 'pl_truth', fail: 'pl_no' },
                        { text: 'I am going under it regardless.', goto: 'pl_alone' }
                    ]
                },
                pl_ally: {
                    id: 'pl_ally', speaker: 'Chief Renderer Ostrow',
                    text: 'One shift. I give you one shift on the winch and then I cut the line whether you are on it or not, and I will not feel a thing about it.',
                    choices: [{ text: 'One shift is enough.', goto: 'pl_end', effect: { flag: 'ostrow_winch', act: 4, unlock: 'drowned_spire', codex: 'the_render', rep: { ironclad: 15 } } }]
                },
                pl_truth: {
                    id: 'pl_truth', speaker: 'Chief Renderer Ostrow',
                    text: 'He is quiet for a long time. Behind him the plant makes the noise it always makes, which is a heartbeat, which everyone has agreed for two hundred years is a pump.\n\n"I know," he says. "I have known for six years. What would you like me to do about four hundred jobs?"',
                    choices: [
                        { text: 'Sound the evacuation.', goto: 'pl_end', effect: { flag: 'ostrow_evac', act: 4, unlock: 'drowned_spire', codex: 'the_render', codex2: 'sleeper', rep: { ironclad: -10, dredgers: 15 } } },
                        { text: 'Nothing. Just give me the winch.', goto: 'pl_end', effect: { flag: 'ostrow_winch', act: 4, unlock: 'drowned_spire', codex: 'sleeper', rep: { ironclad: 10 } } }
                    ]
                },
                pl_no: {
                    id: 'pl_no', speaker: 'Chief Renderer Ostrow',
                    text: 'No. Get off my gantry.',
                    choices: [{ text: 'Try again.', goto: 'pl_1' }, { text: 'Go under it alone.', goto: 'pl_alone' }]
                },
                pl_alone: {
                    id: 'pl_alone', speaker: 'Chief Renderer Ostrow',
                    text: 'Then you go under it with no winch, no crew and no one to cut you loose, and Ostrow watches you do it with his hands on the rail, and does not sound the alarm, which is the closest thing to help he has.',
                    choices: [{ text: 'Descend.', goto: 'pl_end', effect: { flag: 'went_alone', act: 4, unlock: 'drowned_spire', sanity: -10 } }]
                },
                pl_end: { id: 'pl_end', speaker: 'Chief Renderer Ostrow', text: 'The plant keeps beating. It has always been beating.', choices: [] }
            }
        },

        heart: {
            id: 'heart', title: 'The Heart of the Sunken Beacon', start: 'h_1', act: 4,
            nodes: {
                h_1: {
                    id: 'h_1', speaker: 'The Heart',
                    text: 'It is the size of a cathedral and the shape of a lit window, and the water around it is the temperature of a room. There is a way to relight it. There is a way to sink it. There is a way to cut it up.\n\nThere is, apparently, a way to talk to it.',
                    choices: [
                        { text: 'Relight it. Burn the Abyss out of the water.', goto: 'h_relight' },
                        { text: 'Drown it. Put the Heart back down.', goto: 'h_drown' },
                        { text: 'Render it. It is a power source and the rigs are cold.', goto: 'h_render' },
                        { text: '[Abyssal Lore] Ask it why it came down here.', check: { skill: 'abyssal_lore', dc: 18 }, pass: 'h_answer', fail: 'h_silent', require: { attunement: 40, codexComplete: true } }
                    ]
                },
                h_relight: { id: 'h_relight', speaker: 'The Heart', text: 'The fire takes in the water itself. It takes in everything the water has got into, which is the reef, the trench, the choir, and about a third of the people on the rigs, and — you check, and you are still checking — possibly you.', choices: [{ text: 'Do it.', goto: 'h_done', effect: { end: 'relight' } }, { text: 'Wait.', goto: 'h_1' }] },
                h_drown: { id: 'h_drown', speaker: 'The Heart', text: 'You can cut it loose and let it go back down, and the world stays dark and wet and full of exactly what is currently in it, including everyone the Abyss has got into, including the choir, including you.', choices: [{ text: 'Let it go.', goto: 'h_done', effect: { end: 'drown' } }, { text: 'Wait.', goto: 'h_1' }] },
                h_render: { id: 'h_render', speaker: 'The Heart', text: 'Enough steam for every rig for a thousand years. The Syndicate has already drawn the cuts. The deep gets colder, and colder things live deeper than the deep, and they will climb toward the only warm thing left, which will be the rigs.', choices: [{ text: 'Cut.', goto: 'h_done', effect: { end: 'render' } }, { text: 'Wait.', goto: 'h_1' }] },
                h_answer: {
                    id: 'h_answer', speaker: 'The Sun',
                    text: 'It answers immediately, which means it has had the answer ready for three hundred years.\n\nIt says it was not falling. It says there was something above the sky and it came down here to be under thirty thousand feet of water where that thing could not reach, and it has been holding its breath, and it is so tired, and it would like to know whether anyone up there is still alive to be worth it.',
                    choices: [{ text: '"We are. Forty thousand of us."', goto: 'h_done', effect: { end: 'answer' } }]
                },
                h_silent: { id: 'h_silent', speaker: 'The Heart', text: 'You ask. It is quiet. Whatever is in there is either not listening or not finished deciding whether you are worth the trouble of an answer.', choices: [{ text: 'Choose something else.', goto: 'h_1' }] },
                h_done: { id: 'h_done', speaker: '', text: '', choices: [] }
            }
        }
    };

    // ---------- codex ----------
    const CODEX = [
        { id: 'the_tide', title: 'The Tide', text: 'Three hundred years ago the Celestial Sun left the sky and went into the trench, and the sea came up to meet the hole. It has not gone back down. Roughly forty thousand people did not drown, which is a number small enough to keep a register of, and the Syndicate keeps one.' },
        { id: 'beacon', title: 'The Sunken Beacon', text: 'What the Dredgers call the Beacon, the Inquisitors call the buried Sun and the Syndicate calls Asset 1. All three descriptions are of the same object and all three are, in the end, accurate.' },
        { id: 'chart', title: 'The Trench Chart', text: 'Nineteen soundings, four of them taken by people who came back. The trench mouth has moved eleven hundred metres north-east since the chart was drawn, and nothing on the water moves eleven hundred metres.' },
        { id: 'sextant', title: 'Sunken Sextant', text: 'Brass, warm, set to a star at a declination that does not exist. Unless you accept that it was set from below, looking up, through water, at the thing in the trench.' },
        { id: 'reliquary', title: 'Drowned Reliquary', text: 'A saint\'s knuckle in a lead box. The box was sealed in the year of the Tide. The seal is broken from the inside and the knuckle is warm.' },
        { id: 'tooth', title: 'Leviathan Tooth', text: 'Shed, not broken. Teeth are shed by things that are growing replacements, and the Ironclad rendering plant has been built in a jaw for two hundred years on the assumption that it would not need them.' },
        { id: 'first_lantern', title: 'The First Lantern', text: 'Somebody carried a lamp to the bottom of the Spire, on purpose, in the first year. There is no record of anyone going. There is a lamp.' },
        { id: 'dredger_rite', title: 'The Knot Rite', text: 'A Dredger liturgy is a knot diagram. Tie it right and the deep answers in the voice of the last person who tied it wrong.' },
        { id: 'ash_doctrine', title: 'Ash Doctrine', text: '"We are not cruel. We are early." — Confessor Brant, on the burning of Rig Nine, which had forty-one people on it and a confirmed abyssal bloom.' },
        { id: 'the_name', title: 'The Name', text: 'The deep says one name every night, in whatever voice is nearest. It changes once a generation. It changed eleven days ago and Matron Sooley turned the board to the wall.' },
        { id: 'the_echo', title: 'The Echo', text: 'The reef played back a conversation you have not had, in which you had already decided, and were sorry, and gave a number.' },
        { id: 'last_time', title: '"Fewer Than Last Time"', text: 'The other voice in the reef answered you live, and compared the number to a previous one. Which means there was a previous one. Which means this has run before.' },
        { id: 'the_render', title: 'The Rendering Plant', text: 'Four hundred jobs inside the jaw of something that has been dead for two hundred years and warm the whole time.' },
        { id: 'sleeper', title: 'The Sleeper', text: 'It has never been dead. The heartbeat everyone calls a pump is a heartbeat. Ostrow has known for six years and did the arithmetic on four hundred jobs.' },
        { id: 'rust_mother', title: 'The Rust Mother', text: 'Eleven thousand tons of harbour with a face welded into the ballast door. She was the first rig lashed after the Tide and she has been holding the others up since, and at some point in two hundred years she started meaning it.' },
        { id: 'reef_choir', title: 'The Choir of the Reef', text: 'Forty-one voices in a coral throat, all of them people who came out and stayed. The count does not go up when it kills. It goes up when someone listens all the way to the end.' },
        { id: 'the_turning', title: 'The Turning', text: 'Twice, during the descent, the carcass rolls. Twice is what has been recorded. Nobody has stayed long enough to record a third.' },
        { id: 'beacons_heart', title: 'The Heart', text: 'It is conscious, it went into the trench on purpose, and it has been waiting three hundred years for one person to ask it why rather than deciding what to do with it.' }
    ];

    // ---------- acts ----------
    const ACTS = [
        { n: 1, title: 'Rust and Rumour', realm: 'rust_shallows', dialogue: 'vell', goal: 'A dredger\'s line came up with a piece of worked brass, and it was warm. Take it to Harbourmaster Vell and get the trench chart.' },
        { n: 2, title: 'What the Reefs Repeat', realm: 'whispering_reefs', dialogue: 'reef_echo', goal: 'The mist plays back conversations that have not happened yet. Find the one that is yours.' },
        { n: 3, title: 'The Pressure Line', realm: 'leviathan_trench', dialogue: 'pressure_line', goal: 'The Beacon is under a dead Leviathan the size of a county, and the Leviathan objects to being called dead. Get under it.' },
        { n: 4, title: 'The Drowned Spire', realm: 'drowned_spire', dialogue: 'heart', goal: 'Vertical, collapsing, and the Heart is at the bottom — which, from here, is up.' }
    ];

    // ---------- endings ----------
    const ENDINGS = [
        {
            id: 'relight', name: 'Relight the Beacon', faction: 'inquisitors',
            text: 'The fire takes in the water itself.\n\nIt burns the Abyss out of the Firmament in nine days, and on the tenth the sky comes back — grey first, then blue, then the specific unbearable gold of an afternoon, which nobody alive has a word for.\n\nIt also burns everything the Abyss had got into. The reef goes quiet. The trench goes quiet. Rig Nine, Rig Twelve and the whole eastern lash go quiet, and the Syndicate register, which was forty thousand names in a book, is now twenty-six thousand names and a great deal of blank paper.\n\nThe survivors get the sun back. There are fewer of them than there were people.'
        },
        {
            id: 'drown', name: 'Drown the Beacon', faction: 'dredgers',
            text: 'You cut it loose and it goes down without complaint, the way something goes when it has been holding on out of politeness.\n\nThe world stays dark. It stays wet. It stays inhabited by every single thing currently in it, which includes the choir, which includes the third of the register that the Inquisitors have a list of, which includes — you have stopped checking — you.\n\nThe rigs get another three hundred years of exactly this. It is not a victory. It is a decision not to reduce the number, and out here that is the rarest thing there is.'
        },
        {
            id: 'render', name: 'Render the Beacon', faction: 'ironclad',
            text: 'The Syndicate had the cuts drawn before you got back.\n\nIt takes eleven months. There is enough steam for every rig for a thousand years, and light in the walkways, and hot water, and in the second winter a child is born on Rig Four who has never been cold, which the Syndicate puts on a poster.\n\nAnd the deep gets colder. And colder things live deeper than the deep. And in the fourth year the soundings start showing something large and slow coming up toward the only warm object left in the Firmament, which is now, unambiguously, us.'
        },
        {
            id: 'answer', name: 'Answer It', faction: null, requires: 'Attunement 40 and a complete codex',
            text: 'You tell it that there are forty thousand of us and that we are still here.\n\nIt does not relight and it does not sink. It surfaces — slowly, over four days, so as not to make a wave that would take the rigs — and it holds one mile above the water where everyone can see it, and it stays exactly as warm as a room.\n\nIt was never falling. It came down here to be under thirty thousand feet of water because there was something above the sky, and it has been holding its breath for three hundred years, and it would like it noted that it is very tired.\n\nThe water does not go down. The Abyss does not burn. Nothing is fixed.\n\nBut there is a light now, and it is looking the same way we are.'
        }
    ];

    return {
        version: 1,
        realms: REALMS,
        factions: FACTIONS,
        attributes: ATTRIBUTES,
        skillTrees: SKILL_TREES,
        materials: MATERIALS,
        recipes: RECIPES,
        affixes: AFFIXES,
        curses: CURSES,
        runes: RUNES,
        bestiary: BESTIARY,
        lordCreatures: LORD_CREATURES,
        lordNames: LORD_NAMES,
        titles: TITLES,
        warCry: WAR_CRY,
        taunts: TAUNTS,
        scars: SCARS,
        traits: TRAITS,
        fish: FISH,
        bands: BANDS,
        nodeText: NODE_TEXT,
        bosses: BOSSES,
        dialogue: DIALOGUE,
        codex: CODEX,
        acts: ACTS,
        endings: ENDINGS
    };
})();
