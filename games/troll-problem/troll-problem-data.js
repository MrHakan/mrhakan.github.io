// ===================================================================
// SIR, WE HAVE A TROLL PROBLEM — the numbers
//
// A tower defense in the style of bloons: trolls walk a road across the
// desktop, you put the desktop's own furniture down anywhere off the road,
// and each piece has two upgrade paths. Up to four of you can hold the same
// road together (games/netplay.js).
//
//   troll-problem-data.js   this file: maps, towers, trolls, waves, the meta tree
//   troll-problem-sim.js    the rules and the bots. no page in it, so node runs it
//   troll-problem.js        the window, the canvas, the mouse and the wire
//
// .github/scripts/check-troll-problem.mjs holds these numbers to balance targets
// by playing a few hundred games of bots. Change a number, run it.
// ===================================================================

const TP = {};

// ---------- the board ----------
// world units; the canvas scales them to whatever the window is
TP.W = 960;
TP.H = 600;
TP.PATH_R = 22;          // half the road's width
TP.TOWER_R = 21;         // a tower's round footprint
TP.CORNER = 46;          // roads turn on an arc of this radius
TP.DT = 0.05;            // the simulation steps 20 times a game second
TP.HZ = 20;

// ---------- maps ----------
// The road is the waypoints, entering and leaving off the board. Corners are
// rounded by the sim. `hp` multiplies every troll's health on the map; the
// harder maps have shorter roads as well.
TP.MAPS = [
    {
        id: 'outskirts', name: 'the desktop', hp: 0.85,
        ground: '#2f8f83', ground2: '#2a8176', road: '#e8dcc0', edge: '#8a7a58', accent: '#9fe8da',
        blurb: 'a lazy road across the wallpaper. good place to learn.',
        points: [[-40, 300], [170, 300], [170, 130], [460, 130], [460, 470], [760, 470], [760, 300], [1000, 300]]
    },
    {
        id: 'bridge', name: 'the taskbar', hp: 1.25,
        ground: '#3a6ea5', ground2: '#34639a', road: '#d4d0c8', edge: '#5a5a5a', accent: '#a9cbf2',
        blurb: 'up and down the start bar. long, but it never lets up.',
        points: [[-40, 110], [230, 110], [230, 490], [480, 490], [480, 110], [730, 110], [730, 490], [1000, 490]]
    },
    {
        id: 'woods', name: 'my documents', hp: 1.3,
        ground: '#6b5b8a', ground2: '#615280', road: '#f2e6b8', edge: '#8a7340', accent: '#d2c2f2',
        blurb: 'a switchback through the folders. tight corners, tight spaces.',
        points: [[-40, 100], [700, 100], [700, 300], [260, 300], [260, 500], [1000, 500]]
    },
    {
        id: 'gates', name: 'the registry', hp: 1.95,
        ground: '#5a6b3a', ground2: '#526233', road: '#e0d6b0', edge: '#6a5a30', accent: '#d8e8a0',
        blurb: 'a loop that crosses itself. everything there is a kill zone.',
        points: [[-40, 250], [650, 250], [650, 500], [400, 500], [400, 100], [860, 100], [860, 400], [1000, 400]]
    },
    {
        id: 'throne', name: 'the comment section', hp: 1.6,
        ground: '#7a3b3b', ground2: '#6e3535', road: '#ead2b8', edge: '#7a4a30', accent: '#f2b8a0',
        blurb: 'the last road, and the shortest. the troll king lives at the end of it.',
        points: [[-40, 520], [220, 520], [340, 120], [560, 120], [620, 480], [820, 480], [880, 80], [1000, 80]]
    }
];
TP.MAP_BY_ID = {};
TP.MAPS.forEach((m, i) => { m.i = i; TP.MAP_BY_ID[m.id] = m; });

// ---------- towers ----------
// kind:
//   'shot'    a projectile: homing when it hits one troll, a straight line
//             through `pierce` of them when it hits more
//   'lob'     arcs to where the troll will be and bursts there (min range)
//   'chain'   an instant arc that jumps between trolls
//   'cloud'   lobs a cloud onto the road that hurts and slows what walks in it
//   'support' no weapon: towers in range hit harder and faster
// Stats: range, minRange, cd (seconds between attacks), dmg, pierce, splash,
// ap (armour it ignores), true (ignores all armour), air (can hit fliers),
// shots (targets per attack), speed (projectile), stun, slow + slowDur,
// burn + burnDur, spread (a burning troll's fire jumps on when it dies),
// chain + chainFall, cloudR/cloudDps/cloudDur/cloudSlow/clouds/curse,
// brittle (a stunned troll takes this much more damage), boss (multiplier on
// bosses), aura (slows everything in range all the time), buff* (support),
// income (money for its owner at the end of every wave).
//
// Upgrades: two paths, four tiers each, bought in order. One path can go all
// the way, the other stops at TP.CROSS_CAP once the first passes it, the way
// bloons does it. Tier 4 of a path swaps the tower's picture for that path's.
// A tier's `mod` is { add, mul, set } applied on top of what came before.
TP.CROSS_CAP = 2;
TP.TIERS = 4;
TP.TOWERS = [
    {
        id: 'pointer', name: 'pointer post', art: '01-pointer-post', kind: 'shot', key: '1',
        cost: 170, text: 'cheap, quick, one troll at a time. hits fliers.',
        base: { range: 120, cd: 0.6, dmg: 6, pierce: 1, air: true, speed: 620 },
        paths: [
            {
                name: 'double click', tiers: [
                    { name: 'faster clicking', cost: 110, text: 'clicks 25% faster', mod: { mul: { cd: 0.8 } } },
                    { name: 'drag select', cost: 200, text: 'each click goes through 2 trolls', mod: { add: { pierce: 1 } } },
                    { name: 'auto clicker', cost: 520, text: 'clicks a lot faster', mod: { mul: { cd: 0.6 } } },
                    { name: 'double click', cost: 1500, text: 'two cursors: two targets at once, even faster', mod: { set: { shots: 2 }, mul: { cd: 0.75 }, add: { dmg: 2 } } }
                ]
            },
            {
                name: 'precision select', tiers: [
                    { name: 'long reach', cost: 100, text: 'more range', mod: { add: { range: 30 } } },
                    { name: 'bold cursor', cost: 260, text: 'harder clicks that get through armour', mod: { add: { dmg: 5, ap: 2 } } },
                    { name: 'crosshair', cost: 650, text: 'much harder clicks, much more range', mod: { mul: { dmg: 1.8 }, add: { range: 40 } } },
                    { name: 'precision select', cost: 1900, text: 'a red dot on one troll at a time. huge damage, and bosses hate it', mod: { mul: { dmg: 2.6 }, add: { ap: 8 }, set: { boss: 1.5 } } }
                ]
            }
        ]
    },
    {
        id: 'floppy', name: 'floppy launcher', art: '02-floppy-launcher', kind: 'shot', key: '2',
        cost: 380, text: 'lobs disks into the crowd. cannot aim up at fliers.',
        base: { range: 125, cd: 1.15, dmg: 12, pierce: 1, splash: 48, air: false, speed: 380 },
        paths: [
            {
                name: 'disk magazine', tiers: [
                    { name: 'faster eject', cost: 220, text: 'fires 25% faster', mod: { mul: { cd: 0.8 } } },
                    { name: 'high density', cost: 300, text: 'a wider burst', mod: { add: { splash: 14 } } },
                    { name: 'disk changer', cost: 800, text: 'a lot faster', mod: { mul: { cd: 0.62 } } },
                    { name: 'disk magazine', cost: 2400, text: 'a stack of disks: fires twice as often, hits harder', mod: { mul: { cd: 0.55 }, add: { dmg: 6, splash: 6 } } }
                ]
            },
            {
                name: 'zip drive', tiers: [
                    { name: 'heavier disks', cost: 300, text: 'more damage', mod: { add: { dmg: 7 } } },
                    { name: 'longer throw', cost: 220, text: 'more range', mod: { add: { range: 30 } } },
                    { name: 'zip disk', cost: 1000, text: 'much more damage, and it knocks them flat for a moment', mod: { mul: { dmg: 1.8 }, add: { splash: 10 }, set: { stun: 0.35 } } },
                    { name: 'zip drive', cost: 3200, text: 'a 100 megabyte brick. armour does not like it', mod: { mul: { dmg: 2.2 }, add: { splash: 16, ap: 6 }, set: { stun: 0.6 } } }
                ]
            }
        ]
    },
    {
        id: 'fan', name: 'cooling fan', art: '03-cooling-fan', kind: 'shot', key: '3',
        cost: 240, text: 'barely scratches them, but a chilled troll is a slow troll. hits fliers.',
        base: { range: 115, cd: 0.9, dmg: 3, pierce: 1, splash: 34, air: true, speed: 420, slow: 0.5, slowDur: 1.6 },
        paths: [
            {
                name: 'triple fan', tiers: [
                    { name: 'wider blades', cost: 180, text: 'chills a wider patch', mod: { add: { splash: 14 } } },
                    { name: 'colder air', cost: 260, text: 'slows them more', mod: { set: { slow: 0.48 } } },
                    { name: 'twin fans', cost: 650, text: 'blows twice as often', mod: { mul: { cd: 0.55 }, add: { dmg: 2 } } },
                    { name: 'triple fan', cost: 2000, text: 'a cold wind over everything in range, all the time', mod: { set: { aura: true, slow: 0.42 }, add: { dmg: 4, range: 20 } } }
                ]
            },
            {
                name: 'liquid nitrogen', tiers: [
                    { name: 'frost', cost: 200, text: 'more damage', mod: { add: { dmg: 4 } } },
                    { name: 'longer chill', cost: 200, text: 'the slow lasts longer', mod: { add: { slowDur: 1.2 } } },
                    { name: 'flash freeze', cost: 850, text: 'freezes them solid for a moment', mod: { set: { stun: 0.55 }, add: { dmg: 4 } } },
                    { name: 'liquid nitrogen', cost: 2600, text: 'frozen trolls are brittle: everything hits them 40% harder', mod: { set: { brittle: 1.4, stun: 0.9 }, mul: { dmg: 2 } } }
                ]
            }
        ]
    },
    {
        id: 'cpu', name: 'overclocked cpu', art: '04-overclocked-cpu', kind: 'shot', key: '4',
        cost: 340, text: 'sets them on fire. fire ignores armour and stops healing.',
        base: { range: 100, cd: 0.4, dmg: 1, pierce: 1, air: false, speed: 520, burn: 10, burnDur: 2.5 },
        paths: [
            {
                name: 'dual core', tiers: [
                    { name: 'turbo boost', cost: 200, text: 'fires 25% faster', mod: { mul: { cd: 0.8 } } },
                    { name: 'hyperthreading', cost: 340, text: 'each fireball goes through 3 trolls', mod: { add: { pierce: 2 } } },
                    { name: 'liquid metal', cost: 850, text: 'fire spreads to the next troll when one burns out', mod: { set: { spread: 2 }, mul: { cd: 0.8 } } },
                    { name: 'dual core', cost: 2600, text: 'two chips: two targets, and the fire spreads further', mod: { set: { shots: 2, spread: 4 }, add: { burn: 6 } } }
                ]
            },
            {
                name: 'meltdown', tiers: [
                    { name: 'thermal paste', cost: 240, text: 'hotter fire', mod: { add: { burn: 6 } } },
                    { name: 'no heatsink', cost: 220, text: 'it burns longer', mod: { add: { burnDur: 1.5, range: 10 } } },
                    { name: 'thermal runaway', cost: 1000, text: 'twice as hot', mod: { mul: { burn: 2 } } },
                    { name: 'meltdown', cost: 3000, text: 'white hot fireballs that burst on impact', mod: { mul: { burn: 2.4 }, set: { splash: 34 }, add: { range: 15 } } }
                ]
            }
        ]
    },
    {
        id: 'modem', name: 'dial-up modem', art: '05-dial-up-modem', kind: 'chain', key: '5',
        cost: 460, text: 'an arc that jumps between trolls. loves a crowd. hits fliers.',
        base: { range: 115, cd: 1.0, dmg: 12, chain: 5, chainFall: 0.85, air: true },
        paths: [
            {
                name: 'broadband', tiers: [
                    { name: '56k', cost: 240, text: 'fires 25% faster', mod: { mul: { cd: 0.8 } } },
                    { name: 'party line', cost: 340, text: 'jumps to 2 more trolls', mod: { add: { chain: 2 } } },
                    { name: 'isdn', cost: 900, text: 'faster, and further down the line', mod: { mul: { cd: 0.7 }, add: { chain: 2 } } },
                    { name: 'broadband', cost: 2800, text: 'always on: jumps through a whole crowd, fast', mod: { mul: { cd: 0.6 }, add: { chain: 5, dmg: 4 } } }
                ]
            },
            {
                name: 'router tower', tiers: [
                    { name: 'loud dial tone', cost: 300, text: 'more damage', mod: { add: { dmg: 7 } } },
                    { name: 'longer cable', cost: 220, text: 'more range', mod: { add: { range: 25 } } },
                    { name: 'power surge', cost: 1100, text: 'much more damage, and a jolt that stops them', mod: { mul: { dmg: 1.7 }, set: { stun: 0.2 } } },
                    { name: 'router tower', cost: 3200, text: 'the arc loses nothing as it jumps, and burns through armour', mod: { mul: { dmg: 2.2 }, set: { chainFall: 1 }, add: { ap: 5 } } }
                ]
            }
        ]
    },
    {
        id: 'fax', name: 'fax machine', art: '06-fax-machine', kind: 'shot', key: '6',
        cost: 430, text: 'a sheet of paper straight down the road, through everything. cuts armour. hits fliers.',
        base: { range: 190, cd: 1.5, dmg: 14, pierce: 3, ap: 4, air: true, speed: 760 },
        paths: [
            {
                name: 'speed dial', tiers: [
                    { name: 'paper feed', cost: 240, text: 'fires 25% faster', mod: { mul: { cd: 0.8 } } },
                    { name: 'duplex', cost: 300, text: 'goes through 2 more trolls', mod: { add: { pierce: 2 } } },
                    { name: 'auto feed', cost: 880, text: 'a lot faster', mod: { mul: { cd: 0.6 } } },
                    { name: 'speed dial', cost: 2600, text: 'three slots: three sheets at once', mod: { set: { shots: 3 }, add: { pierce: 2 } } }
                ]
            },
            {
                name: 'laser printer', tiers: [
                    { name: 'heavier stock', cost: 300, text: 'more damage', mod: { add: { dmg: 12 } } },
                    { name: 'toner', cost: 340, text: 'cuts through more armour', mod: { add: { ap: 6 } } },
                    { name: 'laser', cost: 1100, text: 'much more damage, and further through', mod: { mul: { dmg: 1.8 }, add: { pierce: 3 } } },
                    { name: 'laser printer', cost: 3400, text: 'red hot sheets. bosses take double', mod: { mul: { dmg: 2.2 }, set: { boss: 2 }, add: { range: 40 } } }
                ]
            }
        ]
    },
    {
        id: 'catapult', name: 'recycle bin catapult', art: '07-recycle-bin-catapult', kind: 'lob', key: '7',
        cost: 600, text: 'throws the trash a very long way. cannot reach what is close. no fliers.',
        base: { range: 280, minRange: 85, cd: 2.6, dmg: 30, splash: 55, air: false, flight: 0.9 },
        paths: [
            {
                name: 'auto empty', tiers: [
                    { name: 'faster winch', cost: 300, text: 'throws 25% faster', mod: { mul: { cd: 0.8 } } },
                    { name: 'bigger bin', cost: 340, text: 'a wider splat', mod: { add: { splash: 16 } } },
                    { name: 'conveyor belt', cost: 1000, text: 'a lot faster', mod: { mul: { cd: 0.62 } } },
                    { name: 'auto empty', cost: 2800, text: 'two bins: two throws at once', mod: { set: { shots: 2 }, mul: { cd: 0.85 } } }
                ]
            },
            {
                name: 'full bin', tiers: [
                    { name: 'heavier trash', cost: 380, text: 'more damage', mod: { add: { dmg: 22 } } },
                    { name: 'long arm', cost: 300, text: 'more range, and it can throw closer in', mod: { add: { range: 60, minRange: -35 } } },
                    { name: 'compactor', cost: 1200, text: 'much more damage, and it knocks them flat', mod: { mul: { dmg: 1.8 }, set: { stun: 0.45 } } },
                    { name: 'full bin', cost: 3600, text: 'a trebuchet of crumpled paper. bosses feel it', mod: { mul: { dmg: 2.5 }, add: { splash: 26 }, set: { boss: 1.5 } } }
                ]
            }
        ]
    },
    {
        id: 'spam', name: 'spam folder', art: '08-spam-folder', kind: 'cloud', key: '8',
        cost: 340, text: 'drops a cloud of spam on the road. everything that walks through it rots. no fliers.',
        base: { range: 130, cd: 2.4, cloudR: 42, cloudDps: 9, cloudDur: 4, cloudSlow: 0.8, clouds: 1, air: false, flight: 0.6 },
        paths: [
            {
                name: 'mailing list', tiers: [
                    { name: 'bulk mail', cost: 200, text: 'drops 25% faster', mod: { mul: { cd: 0.8 } } },
                    { name: 'reply all', cost: 260, text: 'bigger clouds', mod: { add: { cloudR: 12 } } },
                    { name: 'newsletter', cost: 880, text: 'two clouds at once', mod: { set: { clouds: 2 } } },
                    { name: 'mailing list', cost: 2400, text: 'the road is never clear: faster, and the clouds last', mod: { mul: { cd: 0.6 }, add: { cloudDur: 2, cloudDps: 6 } } }
                ]
            },
            {
                name: 'chain letter', tiers: [
                    { name: 'stronger smell', cost: 250, text: 'the cloud hurts more', mod: { add: { cloudDps: 8 } } },
                    { name: 'lingering', cost: 220, text: 'the cloud lasts longer', mod: { add: { cloudDur: 2 } } },
                    { name: 'forward to 10 friends', cost: 1000, text: 'much worse, and slower going', mod: { mul: { cloudDps: 1.8 }, set: { cloudSlow: 0.62 } } },
                    { name: 'chain letter', cost: 3000, text: 'cursed: trolls in the cloud take 30% more from everything', mod: { mul: { cloudDps: 2.2 }, set: { curse: 1.3 } } }
                ]
            }
        ]
    },
    {
        id: 'clip', name: 'paperclip helper', art: '09-paperclip-helper', kind: 'support', key: '9',
        cost: 450, text: 'no weapon. "it looks like you are defending a desktop": towers near it fire faster and hit harder.',
        base: { range: 115, buffDmg: 0.12, buffRate: 0.1, buffRange: 0, buffAp: 0, income: 0 },
        paths: [
            {
                name: 'motivational poster', tiers: [
                    { name: 'pep talk', cost: 240, text: 'towers nearby fire faster', mod: { add: { buffRate: 0.08 } } },
                    { name: 'open plan office', cost: 240, text: 'helps towers further away', mod: { add: { range: 35 } } },
                    { name: 'team spirit', cost: 950, text: 'towers nearby hit harder and see further', mod: { add: { buffDmg: 0.15, buffRange: 0.08 } } },
                    { name: 'motivational poster', cost: 2600, text: 'hang in there: everything nearby is a lot faster and stronger', mod: { add: { buffRate: 0.2, buffDmg: 0.15, range: 30, buffRange: 0.06 } } }
                ]
            },
            {
                name: 'office manager', tiers: [
                    { name: 'helpful tips', cost: 300, text: 'towers nearby cut through 2 armour', mod: { add: { buffAp: 2 } } },
                    { name: 'petty cash', cost: 450, text: '$70 for you at the end of every wave', mod: { add: { income: 70 } } },
                    { name: 'expense account', cost: 1100, text: '$180 a wave, and towers nearby hit harder', mod: { add: { income: 110, buffDmg: 0.1 } } },
                    { name: 'office manager', cost: 3000, text: 'a gold star for everyone: big damage boost, armour cut, $400 a wave', mod: { add: { income: 220, buffDmg: 0.2, buffAp: 4 } } }
                ]
            }
        ]
    },
    {
        id: 'hammer', name: 'ban hammer', art: '10-ban-hammer', kind: 'shot', key: '0',
        cost: 1100, text: 'expensive. one huge hit that no armour stops. hits fliers.',
        base: { range: 140, cd: 2.2, dmg: 90, pierce: 1, true: true, air: true, speed: 900 },
        paths: [
            {
                name: 'quick ban', tiers: [
                    { name: 'lighter gavel', cost: 500, text: 'swings 25% faster', mod: { mul: { cd: 0.8 } } },
                    { name: 'warning', cost: 600, text: 'every ban stuns them for a moment', mod: { set: { stun: 0.3 } } },
                    { name: 'temp ban', cost: 1600, text: 'a lot faster', mod: { mul: { cd: 0.62 } } },
                    { name: 'quick ban', cost: 4400, text: 'two gavels: two bans at once, even faster', mod: { set: { shots: 2 }, mul: { cd: 0.78 } } }
                ]
            },
            {
                name: 'permaban', tiers: [
                    { name: 'heavier head', cost: 700, text: 'more damage', mod: { add: { dmg: 60 } } },
                    { name: 'jury', cost: 500, text: 'more range', mod: { add: { range: 30 } } },
                    { name: 'ip ban', cost: 2000, text: 'the shockwave bans everything around the target', mod: { mul: { dmg: 1.5 }, set: { splash: 44 } } },
                    { name: 'permaban', cost: 6000, text: 'gone for good. bosses take double', mod: { mul: { dmg: 2.5 }, add: { splash: 20 }, set: { boss: 2 } } }
                ]
            }
        ]
    }
];
TP.TOWERS_BY_ID = {};
TP.TOWERS.forEach((t, i) => { t.i = i; TP.TOWERS_BY_ID[t.id] = t; });

// how much of what a tower cost you get back when you sell it
TP.SELL_REFUND = 0.7;

// ---------- targeting ----------
TP.TARGET_MODES = [
    { id: 'first', name: 'first' },     // furthest along the road
    { id: 'last', name: 'last' },
    { id: 'strong', name: 'strong' },   // most health
    { id: 'weak', name: 'weak' },
    { id: 'close', name: 'close' }
];

// ---------- the trolls ----------
// Drawn with age of troll's animations (games/age-of-troll/anim), walking.
// hp is at wave 1 on the first map; TP.waveHp scales it. armor is taken off
// every hit (at least 1 always gets through). leak is the lives it costs at
// the end of the road, bounty the money its death pays the team.
TP.ANIM_DIR = 'games/age-of-troll/anim/';
TP.ENEMIES = [
    { id: 'imp', name: 'emi', anim: '01-he', hp: 9, speed: 72, armor: 0, bounty: 5, leak: 1, size: 30 },
    { id: 'grunt', name: 'xd troll', anim: '13-xd-troll', hp: 26, speed: 52, armor: 0, bounty: 8, leak: 1, size: 36 },
    { id: 'runner', name: 'hello', anim: '02-hello', hp: 18, speed: 104, armor: 0, bounty: 8, leak: 1, size: 32 },
    { id: 'brute', name: 'joe angry', anim: '06-joe-angry', hp: 110, speed: 38, armor: 2, bounty: 22, leak: 3, size: 46 },
    { id: 'armored', name: 'joe fight', anim: '04-joe-fight', hp: 70, speed: 46, armor: 7, bounty: 24, leak: 3, size: 42 },
    { id: 'flier', name: 'hot', anim: '03-hot', hp: 40, speed: 74, armor: 0, bounty: 16, leak: 2, size: 36, flying: true },
    { id: 'shaman', name: 'trollface', anim: '14-trollface', hp: 65, speed: 42, armor: 1, bounty: 26, leak: 2, size: 40, heal: { pct: 0.08, radius: 80, every: 2 } },
    { id: 'regen', name: 'nasiya', anim: '11-nasiya', hp: 90, speed: 48, armor: 0, bounty: 22, leak: 2, size: 40, regen: 0.03 },
    { id: 'zoomer', name: 'lesgooo', anim: '09-lesgooo', hp: 55, speed: 120, armor: 2, bounty: 18, leak: 2, size: 38 },
    { id: 'splitter', name: 'ingaaa', anim: '12-ingaaa', hp: 120, speed: 40, armor: 0, bounty: 14, leak: 4, size: 46, split: { id: 'imp', n: 4 } },
    { id: 'chief', name: 'patron edasiyla', anim: '15-patron-edasiyla', hp: 450, speed: 30, armor: 3, bounty: 300, leak: 20, size: 66, boss: true },
    { id: 'king', name: 'the troll king', anim: '16-the-troll-king', hp: 1700, speed: 24, armor: 6, bounty: 1500, leak: 999, size: 100, boss: true, summon: { id: 'grunt', n: 2, every: 4 } }
];
TP.ENEMY_BY_ID = {};
TP.ENEMIES.forEach((e, i) => { e.i = i; TP.ENEMY_BY_ID[e.id] = e; });
// the animations that were drawn walking left; everything else walks right
TP.ANIM_LOOKS_LEFT = { '09-lesgooo': true };
TP.ANIM_CELL = { '16-the-troll-king': 192 };

// ---------- the waves ----------
// one script for every map: [troll, how many, seconds between them, seconds
// into the wave the group starts]. The map's hp and TP.waveHp do the rest.
TP.WAVES = [
    [['grunt', 4, 2.5, 0]],
    [['grunt', 5, 2.2, 0]],
    [['grunt', 4, 2.25, 0], ['imp', 7, 0.86, 3]],
    [['runner', 4, 2.5, 0], ['grunt', 4, 2, 2]],
    [['grunt', 5, 2.2, 0], ['brute', 2, 3.5, 4]],
    [['imp', 30, 0.2, 0]],
    [['grunt', 7, 1.43, 0], ['flier', 3, 2.33, 3]],
    [['brute', 2, 5, 0], ['runner', 9, 0.89, 2]],
    [['armored', 3, 3.33, 0], ['grunt', 7, 1.29, 1]],
    [['chief', 1, 0, 0], ['grunt', 9, 1, 3], ['brute', 2, 3, 6]],
    [['flier', 6, 1.67, 0], ['runner', 13, 0.62, 2]],
    [['imp', 29, 0.31, 0], ['regen', 3, 2, 3]],
    [['armored', 6, 1.83, 0], ['shaman', 3, 3, 2]],
    [['splitter', 2, 5.5, 0], ['runner', 13, 0.77, 1]],
    [['brute', 2, 6, 0], ['armored', 4, 2.25, 3], ['shaman', 2, 4, 4]],
    [['zoomer', 6, 1.67, 0], ['flier', 9, 0.67, 4]],
    [['regen', 4, 2.75, 0], ['armored', 5, 1.8, 2]],
    [['splitter', 3, 4, 0], ['shaman', 4, 2.25, 3]],
    [['flier', 10, 1.1, 0], ['armored', 6, 1.5, 2]],
    [['chief', 2, 6, 0], ['brute', 6, 1.83, 2], ['shaman', 5, 1.8, 4]],
    [['imp', 53, 0.17, 0], ['zoomer', 9, 0.67, 3]],
    [['regen', 6, 1.83, 0], ['flier', 13, 0.69, 2]],
    [['armored', 11, 1.09, 0], ['shaman', 4, 2.25, 3]],
    [['splitter', 4, 3, 0], ['zoomer', 8, 1.25, 2]],
    [['chief', 3, 4, 0], ['armored', 9, 1.11, 3], ['flier', 10, 0.7, 6]],
    [['imp', 60, 0.15, 0], ['runner', 28, 0.25, 2]],
    [['armored', 10, 1.4, 0], ['brute', 5, 2.4, 2]],
    [['flier', 15, 0.93, 0], ['regen', 6, 2, 2], ['shaman', 3, 3.33, 4]],
    [['splitter', 4, 3.75, 0], ['zoomer', 8, 1.63, 2], ['armored', 6, 1.67, 5]],
    [['king', 1, 0, 0], ['chief', 2, 8, 4], ['armored', 11, 1.27, 2], ['flier', 13, 0.77, 6]]
];
TP.TOTAL_WAVES = TP.WAVES.length;
TP.isBossWave = w => TP.WAVES[w - 1] ? TP.WAVES[w - 1].some(g => TP.ENEMY_BY_ID[g[0]].boss) : false;

// a troll's health on a wave, before the map
TP.waveHp = w => 1 + (w - 1) * 0.08;
TP.waveSpeed = w => 1 + (w - 1) * 0.006;

// ---------- a run ----------
TP.START_LIVES = 100;
TP.START_CASH = 650;
TP.FIRST_PREP = 25;          // seconds before wave 1 sends itself
TP.PREP = 12;                // and between the rest
TP.EARLY_BONUS = 3;          // money for every second left when you send a wave early
TP.waveReward = w => 100 + w * 20;
TP.SPEEDS = [1, 2, 3];

// ---------- up to four of you ----------
// One road, one set of lives, everybody's own money and own towers. Every
// troll's bounty, every wave's reward and the early bonus are split evenly
// between the players still connected, as bloons co-op does: kills would
// pay whoever stands at the front of the road, and the fans and paperclips
// that make those kills possible would never earn a thing.
// The team gets a little more in all than one player does, because four
// wallets cannot pool into one big upgrade the way one can.
TP.MAX_SEATS = 4;
TP.coopStart = n => Math.round(TP.START_CASH * (1 + 0.1 * (n - 1)) / n);
TP.coopIncome = n => 1 + 0.02 * (n - 1);
TP.SEAT_COLORS = ['#ffd84a', '#5ad8ff', '#ff7ac8', '#7cff6a'];

// ---------- persistent meta upgrade tree ----------
// Crystals, earned by every run win or lose, buy permanent upgrades. They
// count in solo runs only: online everybody plays the stock towers, so
// nobody carries anybody. `per` is what one level gives.
TP.META = [
    { id: 'dmg', name: 'sharper pixels', icon: '⚔️', text: '+2.5% tower damage', per: 0.025, max: 8, cost: 4, step: 4 },
    { id: 'rate', name: 'more ram', icon: '🧠', text: '+2% attack speed', per: 0.02, max: 8, cost: 4, step: 4 },
    { id: 'range', name: 'bigger monitor', icon: '🖥️', text: '+3% tower range', per: 0.03, max: 5, cost: 5, step: 4 },
    { id: 'start', name: 'savings account', icon: '🏦', text: '+$50 starting cash', per: 50, max: 6, cost: 3, step: 3 },
    { id: 'lives', name: 'thicker firewall', icon: '🧱', text: '+10 lives', per: 10, max: 5, cost: 4, step: 4 },
    { id: 'discount', name: 'bulk licence', icon: '🏷️', text: '-2% tower and upgrade cost', per: 0.02, max: 5, cost: 6, step: 5 },
    { id: 'bounty', name: 'ad revenue', icon: '💰', text: '+4% money from trolls', per: 0.04, max: 6, cost: 5, step: 4 },
    { id: 'resale', name: 'refurbished', icon: '♻️', text: '+4% back when you sell', per: 0.04, max: 5, cost: 3, step: 2 },
    { id: 'crystal', name: 'crystal vein', icon: '💎', text: '+12% crystals earned', per: 0.12, max: 5, cost: 5, step: 4 }
];
TP.META_BY_ID = {};
TP.META.forEach(m => { TP.META_BY_ID[m.id] = m; });
TP.metaCost = (id, level) => TP.META_BY_ID[id].cost + TP.META_BY_ID[id].step * level;
// crystals at the end of a run
TP.crystalsFor = (wave, won, mapIndex) => Math.floor(wave * 1.2) + (won ? 20 + mapIndex * 10 : 0);

// towers past the pointer post are unlocked for good by reaching a wave on any map
TP.TOWER_UNLOCKS = { floppy: 3, fan: 5, fax: 7, cpu: 9, modem: 11, spam: 13, catapult: 16, clip: 19, hammer: 22 };
// maps unlock as you get far enough on the one before
TP.MAP_UNLOCK_WAVE = 15;
TP.ACHIEVEMENT_WAVES = [5, 10, 15, 20, 25];

// ---------- the pictures ----------
// .github/scripts/tp-tower-art.py writes this block: each tower's three looks and
// its projectile, with where the round base is in each picture and how wide.
TP.ART_DIR = 'games/troll-problem/art/';
// <tp-art>
TP.ART = {"01-pointer-post":{"base":{"w":111,"h":160,"ax":55.5,"ay":122.3,"r":54.5},"a":{"w":137,"h":160,"ax":69.4,"ay":121.7,"r":66.3},"b":{"w":107,"h":160,"ax":53.6,"ay":123.2,"r":52.7},"shot":{"w":64,"h":32}},"02-floppy-launcher":{"base":{"w":141,"h":160,"ax":70.5,"ay":120.4,"r":69.7},"a":{"w":144,"h":160,"ax":62.7,"ay":122.0,"r":61.8},"b":{"w":143,"h":160,"ax":71.4,"ay":120.2,"r":70.6},"shot":{"w":64,"h":35}},"03-cooling-fan":{"base":{"w":126,"h":160,"ax":56.0,"ay":130.0,"r":55.0},"a":{"w":101,"h":160,"ax":50.6,"ay":135.9,"r":49.7},"b":{"w":127,"h":160,"ax":60.1,"ay":130.7,"r":53.6},"shot":{"w":64,"h":38}},"04-overclocked-cpu":{"base":{"w":127,"h":160,"ax":63.6,"ay":122.4,"r":62.7},"a":{"w":153,"h":160,"ax":77.1,"ay":120.2,"r":74.9},"b":{"w":129,"h":160,"ax":64.8,"ay":122.4,"r":62.8},"shot":{"w":64,"h":32}},"05-dial-up-modem":{"base":{"w":139,"h":160,"ax":69.6,"ay":118.4,"r":68.7},"a":{"w":137,"h":160,"ax":68.4,"ay":119.2,"r":67.5},"b":{"w":115,"h":160,"ax":57.5,"ay":124.8,"r":56.6},"shot":{"w":64,"h":21}},"06-fax-machine":{"base":{"w":140,"h":160,"ax":70.5,"ay":113.2,"r":64.1},"a":{"w":147,"h":160,"ax":73.5,"ay":118.5,"r":72.5},"b":{"w":155,"h":160,"ax":77.4,"ay":115.5,"r":75.7},"shot":{"w":64,"h":23}},"07-recycle-bin-catapult":{"base":{"w":117,"h":160,"ax":58.4,"ay":120.4,"r":57.6},"a":{"w":138,"h":160,"ax":58.2,"ay":117.2,"r":58.5},"b":{"w":149,"h":160,"ax":73.2,"ay":125.5,"r":55.0},"shot":{"w":64,"h":45}},"08-spam-folder":{"base":{"w":126,"h":160,"ax":63.1,"ay":122.7,"r":62.3},"a":{"w":128,"h":160,"ax":58.9,"ay":126.1,"r":57.9},"b":{"w":121,"h":160,"ax":60.4,"ay":124.4,"r":59.5},"shot":{"w":64,"h":30}},"09-paperclip-helper":{"base":{"w":155,"h":160,"ax":67.4,"ay":123.8,"r":51.8},"a":{"w":142,"h":160,"ax":58.9,"ay":124.2,"r":52.3},"b":{"w":136,"h":160,"ax":62.9,"ay":124.0,"r":53.2}},"10-ban-hammer":{"base":{"w":134,"h":160,"ax":66.8,"ay":122.1,"r":65.8},"a":{"w":160,"h":148,"ax":79.9,"ay":108.9,"r":78.9},"b":{"w":132,"h":160,"ax":65.9,"ay":122.2,"r":65.0},"shot":{"w":64,"h":50}}};
// </tp-art>

(typeof window !== 'undefined' ? window : globalThis).TP = TP;
