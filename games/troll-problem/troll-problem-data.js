// ===================================================================
// SIR, WE HAVE A TROLL PROBLEM — content data
//
// A proper tower defense: trolls stream along a fixed path from the
// spawn to your gate, you build towers on the buildable ground beside
// the path, and anything that reaches the gate costs you lives. Between
// runs a persistent crystal upgrade tree makes the next attempt easier
// — the "incremental tower defense" loop.
//
// Engine lives in troll-problem.js; this file is pure content:
// maps + paths, towers, enemies, the wave table and the meta tree.
// ===================================================================

const TP = {};

// ---------- grid ----------
TP.CELL = 32;
TP.COLS = 20;
TP.ROWS = 13;
TP.W = TP.COLS * TP.CELL;   // 640
TP.H = TP.ROWS * TP.CELL;   // 416

// ---------- maps ----------
// `waypoints` are grid coords the trolls walk between, in order. The engine
// expands them into the full list of blocked cells, so paths must only ever
// turn at right angles.
TP.MAPS = [
    {
        id: 'outskirts', name: 'The Outskirts', difficulty: 1.0,
        bg: '#16250f', accent: '#7aa63a', ground: '#1d3315', road: '#4a3b28',
        blurb: 'a lazy road through the fields. good place to learn.',
        waypoints: [[-1, 6], [5, 6], [5, 2], [11, 2], [11, 10], [16, 10], [16, 6], [20, 6]]
    },
    {
        id: 'bridge', name: 'The Bridge Crossing', difficulty: 1.15,
        bg: '#0f1f2b', accent: '#3f8fa6', ground: '#162c3a', road: '#3d4a52',
        blurb: 'one long crossing. build where they bunch up.',
        waypoints: [[-1, 2], [4, 2], [4, 10], [9, 10], [9, 2], [14, 2], [14, 10], [20, 10]]
    },
    {
        id: 'woods', name: 'The Dark Woods', difficulty: 1.3,
        bg: '#1c0f26', accent: '#9b56b8', ground: '#26163010', road: '#3a2b44',
        blurb: 'a switchback through the trees. tight corners, tight spaces.',
        waypoints: [[-1, 1], [17, 1], [17, 4], [2, 4], [2, 7], [17, 7], [17, 10], [2, 10], [2, 12], [20, 12]]
    },
    {
        id: 'gates', name: 'The Keep Gates', difficulty: 1.5,
        bg: '#2b120f', accent: '#c25a3a', ground: '#331a15', road: '#4a3228',
        blurb: 'a spiral right up to the gate. every ring is a kill zone.',
        waypoints: [[-1, 0], [18, 0], [18, 11], [1, 11], [1, 3], [15, 3], [15, 8], [5, 8], [5, 6], [20, 6]]
    },
    {
        id: 'throne', name: "The Troll King's Approach", difficulty: 1.75,
        bg: '#241f0d', accent: '#c9a83a', ground: '#2e2812', road: '#463c22',
        blurb: 'the last road. he is at the end of it, and he is not alone.',
        waypoints: [[-1, 6], [3, 6], [3, 1], [8, 1], [8, 11], [12, 11], [12, 1], [16, 1], [16, 9], [20, 9]]
    }
];

// ---------- towers ----------
// kind:
//   'single'  — one target per shot
//   'splash'  — projectile that damages everything within `splash` px of impact
//   'chain'   — hits target then arcs to nearby trolls
//   'pierce'  — a bolt that passes through up to `pierce` trolls in a line
//   'ground'  — drops a lingering hazard patch on the path (no direct hit)
//   'support' — deals no damage, buffs towers in range instead
// `air: true` means it can shoot flying trolls. Ground-only towers cannot,
// which is what makes the flier waves a real decision.
TP.TOWERS = [
    {
        id: 'archer', name: 'Archer Post', icon: '🏹', kind: 'single', air: true,
        cost: 20, dmg: 7, range: 96, cd: 700, projSpeed: 420, starter: true,
        text: 'cheap, quick, hits fliers. the backbone of any wall.',
        levels: [{ cost: 25, dmg: 13, range: 108, cd: 620 }, { cost: 45, dmg: 22, range: 120, cd: 550 }]
    },
    {
        id: 'cannon', name: 'Cannon', icon: '💣', kind: 'splash', air: false,
        cost: 45, dmg: 16, range: 108, cd: 1250, projSpeed: 300, splash: 40,
        text: 'lobs into the crowd. cannot angle up at fliers.',
        levels: [{ cost: 55, dmg: 28, splash: 48, cd: 1150 }, { cost: 95, dmg: 46, splash: 58, range: 124, cd: 1050 }]
    },
    {
        id: 'frost', name: 'Frost Spire', icon: '❄️', kind: 'single', air: true,
        cost: 35, dmg: 4, range: 100, cd: 850, projSpeed: 380, slow: { mult: 0.55, dur: 1600 },
        text: 'barely scratches them, but a slowed troll is a dead troll.',
        levels: [{ cost: 40, slow: { mult: 0.45, dur: 2000 }, range: 112 }, { cost: 70, dmg: 9, slow: { mult: 0.35, dur: 2400 }, range: 124 }]
    },
    {
        id: 'flame', name: 'Flame Sconce', icon: '🔥', kind: 'single', air: false,
        cost: 50, dmg: 3, range: 84, cd: 320, projSpeed: 999, burn: { dps: 9, dur: 2600 },
        text: 'sets them alight and lets the fire do the work.',
        levels: [{ cost: 60, burn: { dps: 16, dur: 3000 }, range: 92 }, { cost: 105, dmg: 6, burn: { dps: 28, dur: 3400 }, range: 100 }]
    },
    {
        id: 'tesla', name: 'Tesla Coil', icon: '⚡', kind: 'chain', air: true,
        cost: 70, dmg: 12, range: 104, cd: 1100, projSpeed: 999, chain: 3, chainFalloff: 0.7,
        text: 'arcs between packed trolls. loves a tight corner.',
        levels: [{ cost: 85, dmg: 20, chain: 4 }, { cost: 145, dmg: 33, chain: 6, range: 120 }]
    },
    {
        id: 'ballista', name: 'Ballista', icon: '🎯', kind: 'pierce', air: true,
        cost: 60, dmg: 26, range: 148, cd: 1500, projSpeed: 520, pierce: 3, armorPierce: 4,
        text: 'one bolt, straight down the road, through everything on it.',
        levels: [{ cost: 75, dmg: 44, pierce: 4 }, { cost: 130, dmg: 72, pierce: 6, range: 168, armorPierce: 10 }]
    },
    {
        id: 'mortar', name: 'Mortar', icon: '🎆', kind: 'splash', air: false,
        cost: 90, dmg: 40, range: 210, minRange: 70, cd: 2400, projSpeed: 200, splash: 56,
        text: 'reaches the far side of the map. useless up close.',
        levels: [{ cost: 110, dmg: 68, splash: 66 }, { cost: 190, dmg: 112, splash: 78, range: 240 }]
    },
    {
        id: 'gas', name: 'Gas Vat', icon: '☠️', kind: 'ground', air: false,
        cost: 55, range: 132, cd: 2600, projSpeed: 260,
        patch: { radius: 44, dps: 12, dur: 4500, slow: 0.75 },
        text: 'drops a cloud on the road. everything that walks through rots.',
        levels: [{ cost: 65, patch: { radius: 52, dps: 20, dur: 5000, slow: 0.7 } }, { cost: 115, patch: { radius: 60, dps: 34, dur: 5500, slow: 0.6 } }]
    },
    {
        id: 'banner', name: 'War Banner', icon: '🚩', kind: 'support', air: false,
        cost: 80, range: 108, buff: { dmg: 0.25, rate: 0.15 },
        text: 'no weapon of its own. makes every tower near it hit harder.',
        levels: [{ cost: 100, range: 124, buff: { dmg: 0.4, rate: 0.25 } }, { cost: 170, range: 140, buff: { dmg: 0.6, rate: 0.4 } }]
    },
    {
        id: 'spire', name: 'Arcane Spire', icon: '🔮', kind: 'single', air: true,
        cost: 120, dmg: 55, range: 132, cd: 1300, projSpeed: 600, armorPierce: 99, trueDamage: true,
        text: 'ignores armour entirely. expensive, and worth it.',
        levels: [{ cost: 150, dmg: 92, cd: 1200 }, { cost: 260, dmg: 155, cd: 1050, range: 148 }]
    }
];
TP.TOWERS_BY_ID = {};
TP.TOWERS.forEach(t => { TP.TOWERS_BY_ID[t.id] = t; });

// how much of a tower's total spend you get back when you sell it
TP.SELL_REFUND = 0.6;

// ---------- targeting modes ----------
TP.TARGET_MODES = [
    { id: 'first', name: 'First' },     // furthest along the path
    { id: 'last', name: 'Last' },
    { id: 'strong', name: 'Strongest' },
    { id: 'weak', name: 'Weakest' },
    { id: 'close', name: 'Closest' }
];

// ---------- enemies ----------
// `armor` is flat damage reduction per hit — that is what makes the fast
// low-damage towers fall off and the ballista/spire matter.
TP.ENEMIES = {
    grunt: { token: '#cfe3b8', name: 'Grunt Troll', sprite: 'src/emoj/xdtroll.png', hp: 34, speed: 46, armor: 0, bounty: 4, size: 24, leak: 1 },
    runner: { token: '#cfe3b8', name: 'Runner Troll', sprite: 'src/emoj/trollcinaye.gif', hp: 20, speed: 92, armor: 0, bounty: 4, size: 20, leak: 1 },
    imp: { token: '#e0e8b0', name: 'Troll Imp', sprite: 'src/emoj/hehe.gif', hp: 12, speed: 62, armor: 0, bounty: 2, size: 16, leak: 1 },
    brute: { token: '#d8c39a', name: 'Brute Troll', sprite: 'src/troll/troll1.gif', hp: 130, speed: 32, armor: 2, bounty: 10, size: 32, leak: 2 },
    armored: { token: '#b9c4cc', name: 'Ironhide Troll', sprite: 'src/emoj/Cursed Pack 1-emojigg-pack/9637-joe-fight.png', hp: 90, speed: 40, armor: 8, bounty: 12, size: 28, leak: 2 },
    flier: { token: '#a8dcf0', name: 'Winged Troll', sprite: 'src/emoj/he.gif', hp: 46, speed: 70, armor: 0, bounty: 9, size: 22, leak: 1, flying: true },
    shaman: { token: '#d9b8e8', name: 'Troll Shaman', sprite: 'src/troll/troll3.gif', hp: 70, speed: 38, armor: 1, bounty: 14, size: 26, leak: 1, heal: { amount: 14, radius: 70, cd: 1800 } },
    chief: { token: '#f0a05a', name: 'Troll Chief', sprite: 'src/troll/troll2.gif', hp: 900, speed: 28, armor: 6, bounty: 90, size: 46, leak: 6, boss: true, shield: 0.25 },
    king: { token: '#f0c05a', name: 'The Troll King', sprite: 'src/troll/troll5.png', hp: 4200, speed: 24, armor: 12, bounty: 400, size: 60, leak: 20, boss: true, shield: 0.35, summon: { id: 'grunt', count: 2, cd: 4000 } }
};

// ---------- wave table ----------
// One shared, hand-authored 30-wave script; each map scales it by its own
// difficulty multiplier. `[id, count, gapMs]` — gap is the spacing between
// individual trolls in that group, which is what makes a "flood" wave feel
// different from a "few big ones" wave.
TP.WAVES = [
    [['grunt', 8, 700]],
    [['grunt', 12, 600]],
    [['grunt', 8, 600], ['runner', 6, 400]],
    [['runner', 14, 320]],
    [['grunt', 10, 500], ['brute', 2, 1200]],                 // 5
    [['imp', 24, 180]],
    [['grunt', 12, 450], ['flier', 4, 800]],
    [['brute', 5, 900], ['runner', 10, 350]],
    [['armored', 6, 700], ['grunt', 10, 400]],
    [['chief', 1, 0], ['grunt', 12, 500]],                    // 10 — boss
    [['flier', 10, 400], ['runner', 12, 300]],
    [['imp', 34, 140], ['brute', 4, 1000]],
    [['armored', 10, 500], ['shaman', 2, 1400]],
    [['runner', 20, 250], ['flier', 8, 500]],
    [['brute', 8, 700], ['armored', 8, 500], ['shaman', 2, 1200]],  // 15
    [['imp', 44, 110], ['flier', 10, 400]],
    [['armored', 14, 400], ['runner', 16, 260]],
    [['brute', 12, 600], ['shaman', 4, 1000]],
    [['flier', 18, 300], ['armored', 10, 450]],
    [['chief', 2, 2600], ['brute', 8, 700]],                  // 20 — boss
    [['imp', 60, 90], ['armored', 12, 400]],
    [['runner', 30, 180], ['flier', 14, 320]],
    [['armored', 20, 320], ['shaman', 5, 900]],
    [['brute', 18, 480], ['flier', 16, 300]],
    [['chief', 3, 2200], ['armored', 16, 380]],               // 25 — boss
    [['imp', 80, 70], ['runner', 30, 160]],
    [['armored', 26, 280], ['brute', 20, 420]],
    [['flier', 26, 220], ['shaman', 6, 800]],
    [['brute', 26, 360], ['armored', 26, 280], ['runner', 26, 200]],
    [['king', 1, 0], ['chief', 2, 3000], ['armored', 20, 320]] // 30 — final
];
TP.TOTAL_WAVES = TP.WAVES.length;
TP.isBossWave = w => [10, 20, 25, 30].includes(w);

// per-wave scaling on top of the map multiplier
TP.waveHpMult = (wave, mapDiff) => (1 + (wave - 1) * 0.18) * mapDiff;
TP.waveSpeedMult = wave => 1 + (wave - 1) * 0.012;

// ---------- run rules ----------
TP.START_LIVES = 20;
TP.START_GOLD = 110;
TP.PREP_TIME = 12000;         // ms of build time before a wave auto-starts
TP.EARLY_BONUS_PER_SEC = 2;   // gold for each second left when you call it early
TP.SPEEDS = [1, 2, 3];

// ---------- persistent meta upgrade tree ----------
// bought with crystals, which you keep whether you win or lose — this is the
// "every run makes the next one better" half of the game.
TP.META = [
    { id: 'dmg', name: 'Sharper Iron', icon: '⚔️', text: '+6% tower damage', max: 8, cost: 2, step: 2 },
    { id: 'rate', name: 'Drill Sergeant', icon: '🥁', text: '+4% fire rate', max: 8, cost: 2, step: 2 },
    { id: 'range', name: 'Spyglasses', icon: '🔭', text: '+4% tower range', max: 6, cost: 3, step: 2 },
    { id: 'gold', name: 'Coin Purse', icon: '💰', text: '+8% bounty from kills', max: 6, cost: 3, step: 3 },
    { id: 'start', name: 'War Chest', icon: '🏦', text: '+25 starting gold', max: 8, cost: 2, step: 2 },
    { id: 'lives', name: 'Thicker Gate', icon: '🚪', text: '+3 starting lives', max: 6, cost: 4, step: 3 },
    { id: 'discount', name: 'Bulk Order', icon: '🏷️', text: '-4% tower cost', max: 5, cost: 4, step: 3 },
    { id: 'crystal', name: 'Crystal Vein', icon: '💎', text: '+15% crystals earned', max: 5, cost: 5, step: 4 }
];
TP.META_BY_ID = {};
TP.META.forEach(m => { TP.META_BY_ID[m.id] = m; });

// towers past the starter set are unlocked permanently by clearing waves
TP.TOWER_UNLOCKS = [
    { wave: 3, tower: 'cannon' },
    { wave: 5, tower: 'frost' },
    { wave: 8, tower: 'ballista' },
    { wave: 11, tower: 'flame' },
    { wave: 14, tower: 'tesla' },
    { wave: 17, tower: 'gas' },
    { wave: 20, tower: 'mortar' },
    { wave: 24, tower: 'banner' },
    { wave: 28, tower: 'spire' }
];

// maps unlock as you beat the one before it
TP.MAP_UNLOCK_WAVE = 15;   // clear this wave on a map to unlock the next

TP.ACHIEVEMENT_WAVES = [5, 10, 15, 20, 25];
