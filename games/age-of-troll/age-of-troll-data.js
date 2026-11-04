// ===================================================================
// age of troll — the numbers
//
// Everything a balance change touches is in this file. check-age-of-troll.mjs
// plays a few hundred bot games against these tables and fails if a unit, a
// strategy or the length of a game drifts, so tune here and run it.
//
//   node .github/scripts/check-age-of-troll.mjs
// ===================================================================
(function (root) {
    'use strict';

    const AOT = root.AOT = root.AOT || {};

    AOT.HZ = 20;                    // simulation ticks a second, on every screen
    AOT.LANE = 1600;                // world units, base to base
    AOT.BASE_FRONT = [150, 1450];   // where each base's wall is, and where units leave it
    AOT.MID = 800;
    AOT.POP_CAP = 22;               // units per side. keeps fights readable and snapshots small
    AOT.QUEUE_MAX = 6;

    AOT.ROLES = ['grunt', 'shooter', 'tank', 'boss'];

    // the triangle: a grunt runs down a shooter, a shooter picks a tank apart
    // from behind the line, and a tank's swing goes through a crowd of grunts.
    // [attacker][target]
    AOT.ROLE_VS = [
        [1.00, 1.45, 0.60, 0.60],
        [0.70, 1.00, 1.55, 1.25],
        [1.45, 0.85, 1.00, 1.00],
        [1.20, 1.20, 1.10, 1.00]
    ];
    // how much each role hurts a wall. a base is not a person
    AOT.ROLE_SIEGE = [0.55, 0.30, 0.70, 0.80];

    // what the first age's version of each role is. every later age is this
    // times the age's power and cost, so the triangle is the same in all five
    AOT.ROLE_BASE = [
        { cost: 20, hp: 74, dmg: 9, cd: 0.8, range: 40, speed: 46, train: 1.3, r: 15, size: 36, cleave: 0 },
        { cost: 34, hp: 44, dmg: 8, cd: 1.0, range: 165, speed: 40, train: 1.9, r: 14, size: 36, cleave: 0 },
        { cost: 100, hp: 340, dmg: 20, cd: 1.5, range: 28, speed: 31, train: 3.8, r: 23, size: 54, cleave: 1 }
    ];

    // Power goes on hit points and damage both, so one age ahead is worth
    // power^2 in a straight fight and costs less than cost^2: a new age is
    // always the better deal per gold, but never so much better that the side
    // one age behind cannot hold a wall with turrets for a minute.
    AOT.AGES = [
        { name: 'dial-up', xp: 0, gold: 0, power: 1, cost: 1, hp: 1900, income: 4.6, trickle: 0.7, slots: 1 },
        { name: 'msn', xp: 800, gold: 190, power: 2.1, cost: 1.9, hp: 3900, income: 7.8, trickle: 1.3, slots: 2 },
        { name: 'forum', xp: 2900, gold: 620, power: 4.3, cost: 3.6, hp: 6200, income: 13.5, trickle: 2.4, slots: 2 },
        { name: 'rage comic', xp: 8200, gold: 1700, power: 8.8, cost: 6.8, hp: 9800, income: 23, trickle: 4.4, slots: 3 },
        { name: 'trollface', xp: 21000, gold: 4500, power: 18, cost: 12.8, hp: 15500, income: 38, trickle: 8, slots: 4 }
    ];

    // sixteen trolls off the site's own emoji shelf: three per age and a king
    // at the end. Only the transparent ones: a white square marching across a
    // teal desktop is not a troll. browser-age-of-troll.mjs looks at the corners.
    const J = 'src/emoj/Cursed Pack 1-emojigg-pack/';
    const E = 'src/emoj/';
    const T = 'src/troll/';
    const CAST = [
        ['he', E + 'he.gif', 'hello', J + '5065-hello.gif', 'hot', J + '3666-hot.png'],
        ['joe fight', J + '9637-joe-fight.png', 'joe cool', J + '7161-joe-cool.png', 'joe angry', J + '3353-joe-angry.png'],
        ['joe murder', J + '9270-joe-murder.png', 'joe chef', J + '4631-joe-chef.png', 'lesgooo', E + 'LESFUCKINGO.png'],
        ['pffft', E + 'pffft.png', 'nasiya', E + 'nasiya.png', 'ingaaa', E + 'ingaaa.png'],
        ['xd troll', E + 'xdtroll.png', 'trollface', T + 'troll3.gif', 'patron edasiyla', E + 'patronedasiyla.png']
    ];

    // unit types: id = age * 3 + role, and 15 is the king
    AOT.UNITS = [];
    AOT.AGES.forEach((age, a) => {
        AOT.ROLE_BASE.forEach((b, r) => {
            AOT.UNITS.push({
                id: a * 3 + r, age: a, role: r,
                name: CAST[a][r * 2], sprite: CAST[a][r * 2 + 1],
                cost: Math.round(b.cost * age.cost),
                hp: Math.round(b.hp * age.power),
                dmg: b.dmg * age.power,
                cd: b.cd,
                range: b.range + (r === 1 ? a * 10 : 0),
                speed: b.speed + a,
                train: b.train,
                r: b.r, size: b.size + a * 2,
                cleave: b.cleave
            });
        });
    });
    AOT.BOSS = 15;
    AOT.UNITS.push({
        id: 15, age: 4, role: 3, name: 'the troll king', sprite: T + 'troll5.png',
        cost: 3400, hp: 26000, dmg: 900, cd: 1.5, range: 38, speed: 26, train: 11, r: 34, size: 92, cleave: 3
    });
    // Which way each emoji was drawn looking. Your side marches right and theirs
    // marches left, so the enemy is always the mirror image of the same troll,
    // and the few drawn looking left get turned round on your side instead.
    const LOOKS_LEFT = [3, 8, 15];   // joe fight, lesgooo, the king
    AOT.UNITS.forEach(u => { u.looksLeft = LOOKS_LEFT.includes(u.id); });
    // true when this troll has to be drawn flipped, for the side it is on
    AOT.flipped = (u, mine) => (mine ? u.looksLeft : !u.looksLeft);

    AOT.unitFor = (age, role) => role === 3 ? AOT.UNITS[AOT.BOSS] : AOT.UNITS[age * 3 + role];

    AOT.BOUNTY = 0.4;               // of a dead unit's cost, to whoever killed it
    AOT.KILL_XP = 0.5;              // of a dead unit's cost
    AOT.BASE_HIT_XP = 0.012;        // per point of wall damage
    AOT.BASE_HIT_GOLD = 0.016;      // so pushing a wall pays for the push

    // the modem: greed, as a button. each level adds this much to the age's income
    AOT.MODEM_STEP = 0.24;
    AOT.MODEM_COST = [160, 320, 620, 1150, 2100, 3700];

    // two turrets, and an age's version of each. a slot opens with the age
    AOT.TURRETS = [
        { key: 'gun', name: 'ping gun', cost: 125, dmg: 12, cd: 0.8, range: 390, radius: 0, sprite: null },
        { key: 'splash', name: 'spam cannon', cost: 170, dmg: 14, cd: 1.7, range: 270, radius: 64, sprite: null }
    ];
    AOT.turretCost = (kind, age) => Math.round(AOT.TURRETS[kind].cost * AOT.AGES[age].cost);
    AOT.turretDmg = (kind, age) => AOT.TURRETS[kind].dmg * AOT.AGES[age].power;
    AOT.TURRET_SELL = 0.5;

    // what keeps a lead from being the whole game: a wall that shoots back for
    // free, overtime when it is in trouble, and xp for whoever is an age behind
    AOT.FIREWALL = { dmg: 9, cd: 1.0, range: 240 };
    AOT.OVERTIME_BELOW = 0.5;
    AOT.OVERTIME = 0.3;
    AOT.CATCH_UP_XP = 0.8;

    // the stance button: hold the army here instead of marching it in piecemeal
    AOT.RALLY = 230;
    AOT.MARCH_GAP = 0.85;           // of the two units' radii, marching
    AOT.HOLD_GAP = 0.3;             // and bunched up at the rally line

    // the server in the middle of the lane. Whoever holds it gets paid more, so
    // two sides that only guard their walls are both giving up the same prize.
    AOT.SERVER = {
        radius: 150,                // units this close count as being on it
        capture: 12,                // seconds to swing it from neutral to yours
        income: 0.2,                // on top of the age's income
        xp: 0.4                     // on top of the age's trickle
    };

    // one special per age, on a long cooldown, aimed at the enemy's front
    AOT.SPECIALS = [
        { key: 'popups', name: 'popup storm', cd: 75, desc: 'error dialogs rain on their front line', hits: 6, dmg: 24, radius: 90 },
        { key: 'ban', name: 'ban hammer', cd: 80, desc: 'flattens their front unit and stuns what is near it', dmg: 240, radius: 80, stun: 2.5 },
        { key: 'caps', name: 'CAPS LOCK', cd: 85, desc: 'your whole side hits and walks harder for a while', dur: 11, dmgMul: 1.35, speedMul: 1.3 },
        { key: 'flame', name: 'flame war', cd: 90, desc: 'sets the lane on fire around their front', dps: 240, dur: 6, width: 420 },
        { key: 'bsod', name: 'blue screen', cd: 110, desc: 'every unit they own crashes for a moment', frac: 0.38, stun: 2.5 }
    ];

    // the age button becomes this once there are no more ages. It is what stops
    // two maxed-out sides trading forever: there is always one more thing to buy
    AOT.OVERCLOCK = { max: 8, dmg: 0.1, armor: 0.1, xp: 9000, gold: 4000, grow: 1.25 };
    AOT.overclockXp = n => Math.round(AOT.AGES[4].xp + AOT.OVERCLOCK.xp * ((Math.pow(AOT.OVERCLOCK.grow, n + 1) - 1) / (AOT.OVERCLOCK.grow - 1)));
    AOT.overclockGold = n => Math.round(AOT.OVERCLOCK.gold * Math.pow(AOT.OVERCLOCK.grow, n));

    // nobody gets to sit on a wall forever. after this the disks fill up and
    // both bases lose health, faster as it goes on, so the game always ends
    AOT.DISK_FULL_AT = 30 * 60;
    AOT.DISK_FULL_RATE = 0.0016;    // of max hp a second, and it grows by that each minute

    AOT.DIFFICULTIES = {
        easy: { label: 'easy', think: 3.2, spend: 0.55, counter: 0, specials: 0.35, frontCare: 0, income: 0.8, ageDelay: 40, saves: 0, note: 'clicks like somebody on the phone, and earns less for it' },
        normal: { label: 'normal', think: 2, spend: 0.75, counter: 0.15, specials: 0.8, frontCare: 0.6, income: 1, ageDelay: 8, saves: 1, note: 'knows what the buttons do' },
        hard: { label: 'hard', think: 0.6, spend: 1, counter: 0.8, specials: 1, frontCare: 1, income: 1, ageDelay: 0, saves: 1, note: 'reads your army and answers it. no cheating' },
        troll: { label: 'troll', think: 0.5, spend: 1, counter: 1, specials: 1, frontCare: 1, income: 1.25, ageDelay: 0, saves: 1, note: 'hard, plus a quarter more income. it cheats and says so' }
    };

    // what a bot wants, on top of how well it plays. check-age-of-troll.mjs
    // runs these against each other: none of them is allowed to be the answer
    AOT.PLANS = {
        balanced: { label: 'balanced', mix: [0.44, 0.34, 0.22], modems: 5, modemSafety: 1.0, turretEvery: 1, turretEarly: 0 },
        rush: { label: 'rush', mix: [0.55, 0.37, 0.08], modems: 1, modemSafety: 2, turretEvery: 0.5, turretEarly: 0 },
        greed: { label: 'greed', mix: [0.40, 0.32, 0.28], modems: 6, modemSafety: 0.5, turretEvery: 1, turretEarly: 0, reserve: 0.15 },
        turtle: { label: 'turtle', mix: [0.34, 0.44, 0.22], modems: 4, modemSafety: 0.8, turretEvery: 1, turretEarly: 1 },
        waves: { label: 'waves', wave: 7, mix: [0.42, 0.36, 0.22], modems: 5, modemSafety: 1.0, turretEvery: 1, turretEarly: 0 },
        // the ones that test whether one button is the whole game
        monoGrunt: { label: 'only grunts', mono: 0, mix: [1, 0, 0], modems: 4, modemSafety: 1, turretEvery: 1, turretEarly: 0, test: true },
        monoShooter: { label: 'only shooters', mono: 1, mix: [0, 1, 0], modems: 4, modemSafety: 1, turretEvery: 1, turretEarly: 0, test: true },
        monoTank: { label: 'only tanks', mono: 2, mix: [0, 0, 1], modems: 4, modemSafety: 1, turretEvery: 1, turretEarly: 0, test: true },
        turrets: { label: 'only turrets', noUnits: true, mix: [1, 0, 0], modems: 6, modemSafety: 0, turretEvery: 1, turretEarly: 1, test: true }
    };
    AOT.BOT_NAMES = ['clippy', 'bonzi buddy', 'nigerian prince', 'dr. sbaitso', 'ms-dos prompt', 'solitaire.exe', 'the admin', 'autoexec.bat'];
})(typeof window !== 'undefined' ? window : globalThis);
