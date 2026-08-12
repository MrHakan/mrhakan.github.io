// ===================================================================
// SIR, WE HAVE A TROLL PROBLEM — content data
//
// An original horde-defense game: you play as Sir mrhakan, and the
// trolls will not stop coming. Inspired by the "defend against
// endless waves with increasingly silly weapons" genre — nothing here
// is copied from any specific game. Weapons, enemies, waves, chapters
// and perks are all designed for this site, using the site's own
// existing troll/emoji art as monster sprites instead of new art.
//
// Engine lives in troll-problem.js; this file is pure content.
// ===================================================================

const TP = {};

// ---------- weapon slots ----------
// slots 1 and 2 are free; further slots are granted by TP.MILESTONES below,
// which is the single source of truth for every permanent unlock
TP.BASE_SLOTS = 2;

// ---------- weapons ----------
// type: 'melee' (arc swing, hits everything in range+arc at once)
//       'ranged' (spawns a projectile that flies to the target)
//       'aoe' (instant pulse/cone around the player)
// dmg/range/cd are level-1 values. Each level multiplies dmg by 1.22^lvl-ish
// via the engine's own formula, so only base numbers live here.
TP.WEAPONS = [
    {
        id: 'shortsword', name: 'Rusty Shortsword', icon: '🗡️', type: 'melee',
        dmg: 8, range: 46, arc: 100, cd: 550, cost: 0, starter: true, maxLevel: 5,
        text: 'a starter blade, at least it is pointy'
    },
    {
        id: 'daggers', name: 'Twin Daggers', icon: '🔪', type: 'melee',
        dmg: 4, hits: 2, range: 38, arc: 130, cd: 340, cost: 40, unlockWave: 5, maxLevel: 5,
        text: 'two quick stabs beat one slow one'
    },
    {
        id: 'longsword', name: 'Longsword', icon: '⚔️', type: 'melee',
        dmg: 13, range: 58, arc: 120, cd: 700, cost: 60, unlockWave: 3, maxLevel: 5,
        text: 'a proper knight carries a proper sword'
    },
    {
        id: 'warhammer', name: 'War Hammer', icon: '🔨', type: 'melee',
        dmg: 26, range: 50, arc: 90, cd: 1100, cost: 90, unlockWave: 10, maxLevel: 5,
        knockback: 90, text: 'subtlety was never the point'
    },
    {
        id: 'halberd', name: 'Halberd', icon: '🪓', type: 'melee',
        dmg: 15, range: 78, arc: 46, cd: 800, cost: 130, unlockWave: 15, maxLevel: 5,
        pierceLine: true, text: 'reach further than the trolls can'
    },
    {
        id: 'holymace', name: 'Holy Mace', icon: '🛠️', type: 'melee',
        dmg: 14, range: 50, arc: 100, cd: 650, cost: 180, unlockWave: 15, maxLevel: 5,
        bossBonus: 1.5, heal: 2, text: 'blessed, mostly against boss trolls'
    },
    {
        id: 'bow', name: 'Hunting Bow', icon: '🏹', type: 'ranged',
        dmg: 9, range: 230, cd: 750, projSpeed: 380, cost: 50, unlockWave: 3, maxLevel: 5,
        text: 'quiver of surprisingly troll-shaped arrows'
    },
    {
        id: 'crossbow', name: 'Crossbow', icon: '🎯', type: 'ranged',
        dmg: 20, range: 270, cd: 1300, projSpeed: 460, pierce: 2, cost: 120, unlockWave: 10, maxLevel: 5,
        text: 'bolts that do not stop at the first troll'
    },
    {
        id: 'axes', name: 'Throwing Axes', icon: '🪃', type: 'ranged',
        dmg: 12, range: 190, cd: 900, projSpeed: 300, splash: 34, cost: 100, unlockWave: 7, maxLevel: 5,
        text: 'they come back. eventually. probably'
    },
    {
        id: 'sling', name: 'Battle Sling', icon: '⚪', type: 'ranged',
        dmg: 6, range: 210, cd: 500, projSpeed: 420, chain: 2, cost: 110, unlockWave: 12, maxLevel: 5,
        text: 'one stone, several increasingly annoyed trolls'
    },
    {
        id: 'torch', name: 'Fire Torch', icon: '🔥', type: 'aoe',
        dmg: 5, range: 95, arc: 70, cd: 1000, cost: 140, unlockWave: 12, maxLevel: 5,
        burn: { dmg: 3, dur: 3000 }, text: 'trolls are, it turns out, flammable'
    },
    {
        id: 'frost', name: 'Frost Wand', icon: '❄️', type: 'ranged',
        dmg: 7, range: 210, cd: 850, projSpeed: 400, slow: { mult: 0.6, dur: 2200 }, cost: 140, unlockWave: 12, maxLevel: 5,
        text: 'a troll popsicle moves noticeably slower'
    },
    {
        id: 'handbell', name: 'Holy Handbell', icon: '🔔', type: 'aoe',
        dmg: 10, range: 95, arc: 360, cd: 1400, cost: 200, unlockWave: 18, maxLevel: 5,
        stagger: true, text: 'rings out, trolls take offense'
    },
    {
        id: 'ballista', name: 'Ballista Turret', icon: '🏗️', type: 'ranged',
        dmg: 35, range: 320, cd: 1600, projSpeed: 600, pierce: 3, cost: 220, unlockWave: 20, maxLevel: 5,
        text: 'siege engineering, personal size'
    },
    {
        id: 'excalibur', name: 'Excalibur', icon: '⚡', type: 'melee',
        dmg: 60, range: 100, arc: 220, cd: 1200, cost: 400, unlockWave: 25, maxLevel: 5, legendary: true,
        knockback: 60, text: 'the sword the trolls warn each other about'
    }
];
TP.WEAPONS_BY_ID = {};
TP.WEAPONS.forEach(w => { TP.WEAPONS_BY_ID[w.id] = w; });

// ---------- passive perks ----------
TP.PERKS = [
    { id: 'vitality', name: 'Vitality', icon: '❤️', cost: 40, priceStep: 20, text: '+20 max HP', maxStack: 8 },
    { id: 'swiftness', name: 'Swiftness', icon: '👢', cost: 50, priceStep: 22, text: '+8% move speed', maxStack: 5 },
    { id: 'armor', name: 'Armor', icon: '🛡️', cost: 60, priceStep: 26, text: '+5% damage reduction', maxStack: 10 },
    { id: 'greed', name: 'Greed', icon: '💰', cost: 45, priceStep: 20, text: '+15% gold gained', maxStack: 6 },
    { id: 'haste', name: 'Haste', icon: '⏱️', cost: 70, priceStep: 30, text: '-6% weapon cooldowns', maxStack: 6 },
    { id: 'vampirism', name: 'Vampirism', icon: '🩸', cost: 80, priceStep: 35, text: '+2% lifesteal on hit', maxStack: 5 },
    { id: 'thorns', name: 'Thorns', icon: '🌵', cost: 55, priceStep: 24, text: 'reflect 15% contact dmg', maxStack: 4 },
    { id: 'regen', name: 'Regeneration', icon: '💗', cost: 65, priceStep: 28, text: '+1 HP per second', maxStack: 6 },
    { id: 'fortune', name: 'Fortune', icon: '🍀', cost: 90, priceStep: 40, text: '3% instakill on non-boss hits', maxStack: 4 },
    { id: 'second_wind', name: 'Second Wind', icon: '✨', cost: 150, priceStep: 0, text: 'revive once per run at 30% HP', maxStack: 1 }
];
TP.PERKS_BY_ID = {};
TP.PERKS.forEach(p => { TP.PERKS_BY_ID[p.id] = p; });

// ---------- enemies ----------
// sprite paths are the site's own existing images. hp/dmg/speed are wave-1
// base values; the engine scales them up per wave.
TP.ENEMIES = {
    grunt: { name: 'Grunt Troll', sprite: 'src/emoj/xdtroll.png', hp: 20, speed: 55, dmg: 8, gold: 3, size: 34 },
    sneaky: { name: 'Sneaky Troll', sprite: 'src/emoj/trollcinaye.gif', hp: 10, speed: 95, dmg: 4, gold: 2, size: 28, swarm: true },
    brute: { name: 'Brute Troll', sprite: 'src/troll/troll1.gif', hp: 55, speed: 35, dmg: 16, gold: 6, size: 42, knockback: true },
    spitter: { name: 'Spitter Troll', sprite: 'src/troll/troll3.gif', hp: 18, speed: 42, dmg: 6, gold: 5, size: 32, ranged: { range: 150, cd: 1800, projSpeed: 220 } },
    berserk: { name: 'Berserk Troll', sprite: 'src/emoj/Cursed Pack 1-emojigg-pack/9637-joe-fight.png', hp: 26, speed: 50, enrageSpeed: 88, dmg: 10, gold: 5, size: 32 },
    giggler: { name: 'Giggling Troll', sprite: 'src/emoj/hehe.gif', hp: 16, speed: 60, dmg: 5, gold: 4, size: 30, jitter: true },
    chief: { name: 'Chief Troll', sprite: 'src/troll/troll2.gif', hp: 220, speed: 40, dmg: 20, gold: 45, size: 60, boss: true, pulse: { radius: 90, dmg: 14, cd: 2600 } },
    troll_king: { name: 'The Troll King', sprite: 'src/troll/troll5.png', hp: 950, speed: 34, dmg: 26, gold: 320, size: 84, boss: true, pulse: { radius: 110, dmg: 18, cd: 2200 }, summon: 'grunt' }
};

// ---------- chapters ----------
// each chapter is 5 waves; the 5th is always that chapter's boss wave.
// wave composition = list of [enemyId, count], staggered in as the wave runs.
TP.CHAPTERS = [
    {
        id: 1, name: 'The Outskirts', bg: '#12240f', accent: '#6b8f3a',
        boss: 'chief',
        waves: [
            [['grunt', 5]],
            [['grunt', 6], ['sneaky', 3]],
            [['grunt', 5], ['sneaky', 6]],
            [['grunt', 8], ['sneaky', 6]],
            [['grunt', 4]] // + boss, appended by engine
        ]
    },
    {
        id: 2, name: 'The Bridge Crossing', bg: '#0f1f2b', accent: '#3a7f8f',
        boss: 'chief',
        waves: [
            [['grunt', 6], ['brute', 2]],
            [['sneaky', 8], ['spitter', 3]],
            [['grunt', 6], ['brute', 3], ['spitter', 3]],
            [['sneaky', 10], ['brute', 3], ['spitter', 4]],
            [['grunt', 6], ['brute', 2]]
        ]
    },
    {
        id: 3, name: 'The Dark Woods', bg: '#1f0f2b', accent: '#7f3a8f',
        boss: 'chief',
        waves: [
            [['grunt', 6], ['berserk', 3]],
            [['giggler', 8], ['spitter', 4]],
            [['brute', 4], ['berserk', 4], ['giggler', 5]],
            [['sneaky', 10], ['berserk', 5], ['spitter', 4]],
            [['grunt', 6], ['giggler', 6]]
        ]
    },
    {
        id: 4, name: 'The Keep Gates', bg: '#2b0f0f', accent: '#8f3a3a',
        boss: 'chief',
        waves: [
            [['grunt', 8], ['brute', 4], ['spitter', 4]],
            [['sneaky', 12], ['berserk', 5], ['giggler', 5]],
            [['brute', 6], ['spitter', 6], ['berserk', 4]],
            [['grunt', 10], ['sneaky', 10], ['brute', 4], ['giggler', 5]],
            [['brute', 5], ['spitter', 5]]
        ]
    },
    {
        id: 5, name: "The Troll King's Throne", bg: '#2b230f', accent: '#8f7a3a',
        boss: 'troll_king',
        waves: [
            [['grunt', 10], ['brute', 5], ['spitter', 5]],
            [['sneaky', 14], ['berserk', 6], ['giggler', 6]],
            [['brute', 7], ['berserk', 6], ['spitter', 6]],
            [['grunt', 10], ['sneaky', 10], ['brute', 6], ['giggler', 6]],
            [['brute', 4], ['berserk', 4]]
        ]
    }
];
TP.WAVES_PER_CHAPTER = 5;
TP.TOTAL_CHAPTERS = TP.CHAPTERS.length;
TP.FINAL_WAVE = TP.TOTAL_CHAPTERS * TP.WAVES_PER_CHAPTER;

TP.chapterForWave = function (wave) {
    const idx = Math.min(TP.CHAPTERS.length - 1, Math.floor((wave - 1) / TP.WAVES_PER_CHAPTER));
    return TP.CHAPTERS[idx];
};
TP.isBossWave = function (wave) {
    return wave % TP.WAVES_PER_CHAPTER === 0;
};

// ---------- meta unlock milestones ----------
// reaching (clearing) this wave once, ever, permanently unlocks these
// weapons/perks into the shop pool for every future run.
TP.MILESTONES = [
    { wave: 3, weapons: ['longsword', 'bow'] },
    { wave: 5, weapons: ['daggers'] },
    { wave: 7, weapons: ['axes'] },
    { wave: 10, weapons: ['warhammer', 'crossbow'], slot: 3 },
    { wave: 12, weapons: ['sling', 'torch', 'frost'] },
    { wave: 15, weapons: ['halberd', 'holymace'] },
    { wave: 18, weapons: ['handbell'] },
    { wave: 20, weapons: ['ballista'], slot: 4 },
    { wave: 25, weapons: ['excalibur'] }
];

// achievements' wording used by fun.js — not required at runtime, kept
// here so the milestone list and the achievement copy never drift apart
TP.ACHIEVEMENT_WAVES = [5, 10, 15, 20, 25];
