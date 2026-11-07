// ===================================================================
// check-age-of-troll.mjs — the rules, and a few hundred games of bots
//
// A lane game cannot be balanced by looking at it. The first version of this
// one had tanks that won every game, a hard bot that lost to the easy one, and
// armies that piled up in their own doorway, and all three looked fine on
// screen. So the targets are written down here and the simulation is held to
// them: seeds are fixed, so a number only moves when the rules do.
//
//   node .github/scripts/check-age-of-troll.mjs
// ===================================================================
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));

let checks = 0, failures = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

// what a browser has and a bare vm context does not, for the replays
const WEB_BITS = { CompressionStream, DecompressionStream, TextEncoder, TextDecoder, structuredClone };
const loadRules = (tweak) => {
    const c = vm.createContext({ console, ...WEB_BITS });
    vm.runInContext(read('games/age-of-troll/age-of-troll-data.js'), c);
    if (tweak) tweak(c.AOT);
    vm.runInContext(read('games/age-of-troll/age-of-troll-sim.js'), c);
    return c.AOT;
};
const A = loadRules();
const FIXTURE = '.github/scripts/age-of-troll-replay.txt';
if (process.argv.includes('--replay-fixture')) {
    // node .github/scripts/check-age-of-troll.mjs --replay-fixture: after a change
    // to the rules, the replay the check below holds the simulation to
    const s = A.replay.record(A.newGame(2024), 2024);
    const l = A.newBrain('hard', 'balanced', 5), r = A.newBrain('troll', 'greed', 6);
    s.p[1].handicap = A.DIFFICULTIES.troll.income;
    while (!s.over) { A.think(s, 0, l); A.think(s, 1, r); A.step(s); }
    const code = await A.replay.encode(A.replay.replayOf(s, { names: ['fixture', 'troll bot'], label: 'troll' }));
    fs.writeFileSync(path.join(ROOT, FIXTURE), code + '\n');
    console.log('wrote ' + FIXTURE + ': ' + code.length + ' characters, ' + (s.tick / A.HZ / 60).toFixed(1) + ' minutes');
    process.exit(0);
}
const HZ = A.HZ;
const stepFor = (s, sec) => { for (let i = 0; i < sec * HZ && !s.over; i++) A.step(s); };
const fresh = (seed = 7, gold = 1e6) => { const s = A.newGame(seed); s.p[0].gold = s.p[1].gold = gold; return s; };
const pct = n => Math.round(n * 100) + '%';
const mins = sec => (sec / 60).toFixed(1) + 'm';

// ===================================================================
section('the roster');
// ===================================================================
{
    expect(A.UNITS.length === 16, 'three trolls an age and a king', String(A.UNITS.length));
    const missing = A.UNITS.filter(u => !exists(u.sprite));
    expect(!missing.length, 'every one of them is a file on the shelf', missing.map(u => u.sprite).join(', '));
    expect(A.UNITS.every(u => /^src\/(emoj|troll)\//.test(u.sprite)), 'and off the site\'s own emoji, as asked');
    expect(new Set(A.UNITS.map(u => u.sprite)).size === 16, 'no troll plays two parts');
    // a photo of somebody's actual face is not a troll
    const photos = ['gunaydinbbg', 'toplum'];
    expect(!A.UNITS.some(u => photos.some(p => u.sprite.includes(p))), 'and no photographs of real people');
    // these have a white square round them, and browser-age-of-troll.mjs checks the pixels of the rest
    const white = ['troll1.gif', 'troll2.gif', 'trollcinaye.gif'];
    expect(!A.UNITS.some(u => white.some(p => u.sprite.includes(p))), 'none of the ones with a white box round them');
    expect(A.UNITS.every(u => A.flipped(u, true) !== A.flipped(u, false)), 'the enemy is the mirror image of the same troll');
    expect(A.UNITS.every(u => A.flipped(u, true) === u.looksLeft), 'and a troll drawn looking left is turned round to face them on your side');
    expect(A.AGES.length === 5 && A.SPECIALS.length === 5, 'five ages, each with its special');
    expect(A.AGES.every((a, i) => !i || (a.xp > A.AGES[i - 1].xp && a.hp > A.AGES[i - 1].hp && a.income > A.AGES[i - 1].income && a.power > A.AGES[i - 1].power)),
        'and each is more of everything than the last');
    for (let r = 0; r < 3; r++) {
        const line = A.AGES.map((_, a) => A.unitFor(a, r));
        expect(line.every((u, i) => !i || (u.hp > line[i - 1].hp && u.cost > line[i - 1].cost)), A.ROLES[r] + ' gets tougher and dearer through the ages');
    }
}

// ===================================================================
section('commands: the one way anything changes');
// ===================================================================
{
    let s = A.newGame(1);
    const start = s.p[0].gold;
    expect(A.command(s, 0, { c: 'train', r: 0 }) === null && s.p[0].gold === start - A.unitFor(0, 0).cost, 'training costs what it says');
    expect(s.p[1].gold === start && s.p[1].q.length === 0, 'and only the side that asked');
    s = A.newGame(1); s.p[0].gold = 1;
    expect(A.command(s, 0, { c: 'train', r: 0 }) === 'gold' && s.p[0].gold === 1 && !s.p[0].q.length, 'no gold, no unit, and nothing is taken');
    s = fresh();
    for (let i = 0; i < A.QUEUE_MAX; i++) A.command(s, 0, { c: 'train', r: 0 });
    expect(A.command(s, 0, { c: 'train', r: 0 }) === 'queue' && s.p[0].q.length === A.QUEUE_MAX, 'the factory queue has an end');
    s = fresh();
    expect(A.command(s, 0, { c: 'train', r: 3 }) === 'age', 'the king waits for the last age');

    // what a stranger on the other end of a wire could send
    s = fresh();
    const junk = [null, undefined, 3, 'x', {}, { c: 'nope' }, { c: 'train' }, { c: 'train', r: 9 }, { c: 'train', r: '0' }, { c: 'train', r: -1 },
        { c: 'turret', k: 5 }, { c: 'stance', h: 'x' }, { c: '__proto__' }, { c: 'constructor' }, { c: 'train', r: { valueOf: () => 0 } }];
    let threw = null;
    const before = JSON.stringify(s);
    for (const j of junk) { try { if (A.command(s, 0, j) === null) threw = 'accepted ' + JSON.stringify(j); } catch (e) { threw = e.message; } }
    expect(!threw, 'nonsense is refused rather than thrown', threw || '');
    expect(JSON.stringify(s) === before, 'and changes nothing');

    s = fresh();
    expect(A.command(s, 0, { c: 'age' }) === 'xp', 'an age needs the xp');
    s.p[0].xp = A.AGES[1].xp; s.p[0].gold = 0;
    expect(A.command(s, 0, { c: 'age' }) === 'gold', 'and the gold');
    s.p[0].gold = A.AGES[1].gold; s.p[0].hp = A.AGES[0].hp / 2;
    expect(A.command(s, 0, { c: 'age' }) === null && s.p[0].age === 1, 'and then it happens');
    expect(s.p[0].hp > A.AGES[0].hp / 2 && s.p[0].hp <= A.AGES[1].hp, 'a new age mends the wall a little, and not all the way', String(s.p[0].hp));
    expect(s.p[0].q.length === 0, 'and nothing else moved');

    s = fresh();
    expect(A.command(s, 0, { c: 'turret', k: 0 }) === null && s.p[0].tur.length === 1, 'a turret goes in the slot');
    const g0 = s.p[0].gold;
    expect(A.command(s, 0, { c: 'turret', k: 0 }) === 'slots', 'a second one of the same at the same age has nowhere to go');
    expect(s.p[0].gold === g0, 'and costs nothing for trying');
    expect(A.command(s, 0, { c: 'sell' }) === null && s.p[0].gold === g0 + Math.round(A.turretCost(0, 0) * A.TURRET_SELL), 'selling gives half back');
    expect(A.command(s, 0, { c: 'sell' }) === 'none', 'and you cannot sell what you do not have');

    s = fresh();
    s.p[0].age = 4;
    for (let i = 0; i < A.AGES[4].slots; i++) A.command(s, 0, { c: 'turret', k: 0 });
    expect(s.p[0].tur.length === 4, 'the last age has four slots');
    s.p[0].tur[0].a = 0;
    const had = s.p[0].tur.length;
    expect(A.command(s, 0, { c: 'turret', k: 1 }) === null && s.p[0].tur.length === had && !s.p[0].tur.some(t => t.a === 0), 'a full wall swaps its oldest for the new one');

    s = fresh();
    const inc = A.incomeOf(s, 0);
    A.command(s, 0, { c: 'modem' });
    expect(A.incomeOf(s, 0) > inc, 'a modem raises income');
    s.p[0].modem = A.MODEM_COST.length;
    expect(A.command(s, 0, { c: 'modem' }) === 'max', 'and they run out');

    s = fresh();
    s.p[0].age = 4; s.p[0].xp = 1e9;
    expect(A.command(s, 0, { c: 'age' }) === 'max', 'no age past the last');
    expect(A.command(s, 0, { c: 'overclock' }) === null && s.p[0].oc === 1, 'overclock is what is left');
    const s2 = fresh();
    expect(A.command(s2, 0, { c: 'overclock' }) === 'age', 'and it waits for the last age');

    s = fresh();
    s.p[0].spCd = 10;
    expect(A.command(s, 0, { c: 'special' }) === 'cooling', 'a special has a cooldown');
    s.p[0].spCd = 0;
    expect(A.command(s, 0, { c: 'special' }) === null && s.p[0].spCd > 0, 'and starts it when used');

    s = fresh();
    expect(A.command(s, 1, { c: 'resign' }) === null && s.over && s.winner === 0, 'giving up gives it to the other side');
    expect(A.command(s, 0, { c: 'train', r: 0 }) === 'over', 'and a finished game takes no more orders');
}

// ===================================================================
section('the lane');
// ===================================================================
{
    let s = fresh();
    for (let i = 0; i < 6; i++) { A.command(s, 0, { c: 'train', r: i % 3 }); A.command(s, 1, { c: 'train', r: (i + 1) % 3 }); }
    let order = true, crossed = false;
    for (let i = 0; i < 90 * HZ && !s.over; i++) {
        A.step(s);
        if (s.tick % 40 === 0) for (let k = 0; k < 6; k++) { A.command(s, 0, { c: 'train', r: k % 3 }); A.command(s, 1, { c: 'train', r: k % 3 }); }
        for (let side = 0; side < 2; side++) {
            const dir = side ? -1 : 1, list = s.u[side];
            for (let j = 1; j < list.length; j++) if ((list[j - 1].x - list[j].x) * dir < 0) order = false;
        }
        if (s.u[0][0] && s.u[1][0] && s.u[0][0].x > s.u[1][0].x + 1) crossed = true;
    }
    expect(order, 'nobody walks through anybody on their own side');
    expect(!crossed, 'and the two front lines never pass through each other');

    s = fresh();
    for (let i = 0; i < 5000 && s.u[0].length < A.POP_CAP; i++) { A.command(s, 0, { c: 'train', r: 0 }); A.command(s, 0, { c: 'stance', h: 1 }); A.step(s); }
    expect(s.u[0].length === A.POP_CAP, 'a held army still fills up: it does not back up into its own door', s.u[0].length + ' units');
    expect(s.u[0].every(u => u.x <= A.BASE_FRONT[0] + A.RALLY + 0.01), 'and it stays behind the rally line');
    for (let i = 0; i < 100; i++) { A.command(s, 0, { c: 'train', r: 0 }); A.step(s); }
    expect(s.u[0].length === A.POP_CAP, 'the cap is the cap');
    A.command(s, 0, { c: 'stance', h: 0 });
    stepFor(s, 8);
    expect(s.u[0][0].x > A.BASE_FRONT[0] + A.RALLY + 100, 'and it marches when told');

    // melee gets to bring a second rank; nobody just queues politely behind one
    s = fresh(3);
    s.p[1].hp = 1e7;
    const tank = A.unitFor(0, 2);
    s.u[1].push({ id: 900, t: tank.id, x: 500, hp: 1e6, cd: 0 });
    s.nextId = 1000;
    s.u[0].push({ id: 901, t: 0, x: 400, hp: 1e6, cd: 0 }, { id: 902, t: 0, x: 370, hp: 1e6, cd: 0 }, { id: 903, t: 0, x: 340, hp: 1e6, cd: 0 });
    stepFor(s, 8);
    const start = 1e6 - s.u[1][0].hp;
    expect(start > A.unitFor(0, 0).dmg * 0.6 * 1.5, 'the rank behind the front one gets a swing too', Math.round(start) + ' damage');

    // the firewall: the only thing that shoots for free
    s = fresh(4);
    s.u[1].push({ id: 900, t: 0, x: A.BASE_FRONT[0] + 120, hp: 1e6, cd: 0, stun: 1000 });
    s.nextId = 1000;
    stepFor(s, 5);
    expect(s.u[1][0].hp < 1e6, 'a wall with no turrets still shoots back');

    // the server pays whoever stands on it
    s = fresh(5);
    s.u[0].push({ id: 900, t: 0, x: A.MID, hp: 1e6, cd: 0, stun: 1e6 });
    s.nextId = 1000;
    const base = A.incomeOf(s, 0);
    stepFor(s, A.SERVER.capture + 1);
    expect(A.serverOwner(s) === 0, 'standing on the server takes it');
    expect(A.incomeOf(s, 0) > base && A.xpRateOf(s, 0) > A.AGES[0].trickle, 'and it pays in gold and xp');

    s = fresh();
    s.p[0].age = 3; s.p[1].age = 1;
    expect(A.xpRateOf(s, 1) > A.AGES[1].trickle, 'whoever is an age behind gets xp faster');
    s = fresh();
    const calm = A.incomeOf(s, 0);
    s.p[0].hp = 10;
    expect(A.incomeOf(s, 0) > calm, 'and a wall in trouble pays overtime');

    // nothing goes on for ever
    s = fresh();
    while (!s.over && s.tick < 3 * 3600 * HZ) A.step(s);
    expect(s.over && A.seconds(s) <= A.DISK_FULL_AT + 300, 'two sides that do nothing at all still finish', mins(A.seconds(s)));

    // both specials that matter, at their worst
    s = fresh();
    s.p[0].age = 4; s.p[0].spCd = 0;
    for (let i = 0; i < 6; i++) s.u[1].push({ id: 900 + i, t: 3, x: 900 + i * 30, hp: A.UNITS[3].hp, cd: 0 });
    s.nextId = 1000;
    A.command(s, 0, { c: 'special' });
    expect(s.u[1].every(u => u.hp < A.UNITS[3].hp && u.stun > 0), 'the blue screen hits everybody they own');
    expect(s.p[1].hp === A.AGES[0].hp, 'and leaves the wall alone');
}

// ===================================================================
section('one state, every machine');
// ===================================================================
{
    const run = (seed, ticks) => {
        const s = A.newGame(seed);
        const l = A.newBrain('normal', 'balanced', 11), r = A.newBrain('hard', 'greed', 22);
        for (let i = 0; i < ticks && !s.over; i++) { A.think(s, 0, l); A.think(s, 1, r); A.step(s); }
        return { s, l, r };
    };
    const a = run(99, 6000), b = run(99, 6000);
    expect(JSON.stringify(a.s) === JSON.stringify(b.s), 'the same seed plays the same game');
    const c = run(100, 6000);
    expect(JSON.stringify(a.s) !== JSON.stringify(c.s), 'and a different one does not');

    // a saved game is the game: reload it mid-match and it plays out identically
    const midway = run(321, 5000);
    const saved = JSON.parse(JSON.stringify({ s: midway.s, l: midway.l, r: midway.r }));
    const go = g => { for (let i = 0; i < 6000 && !g.s.over; i++) { A.think(g.s, 0, g.l); A.think(g.s, 1, g.r); A.step(g.s); } return JSON.stringify(g.s); };
    expect(go(midway) === go(saved), 'a save and reload changes nothing about what happens next');
}

// ===================================================================
section('the wire');
// ===================================================================
{
    // the biggest thing the host ever sends: both sides at the cap, turrets full, a fire going
    const s = A.newGame(5);
    for (let side = 0; side < 2; side++) {
        const p = s.p[side];
        p.age = 4; p.gold = 123456; p.xp = 234567; p.hp = 15500; p.modem = 6; p.q = [12, 13, 14, 12, 13, 14];
        p.tur = [{ k: 0, a: 4, cd: 0 }, { k: 1, a: 4, cd: 0 }, { k: 0, a: 4, cd: 0 }, { k: 1, a: 4, cd: 0 }];
        for (let i = 0; i < A.POP_CAP; i++) s.u[side].push({ id: 20000 + side * 100 + i, t: 12 + i % 3, x: side ? 1400 - i * 20 : 200 + i * 20, hp: 12345, cd: 3, stun: 0 });
    }
    s.fire.push({ s: 0, x: 800, w: 420, dps: 2000, t: 5 });
    const worst = JSON.stringify(A.snapshot(s, { a: 12345 })).length;
    expect(worst <= 1500, 'the largest snapshot stays small', worst + ' bytes');
    // what the guide says is 3MB a minute for a game at 8Hz over the relays
    const perMin = worst * 3 * 60 / 1024;
    expect(perMin <= 300, 'and three of those a second is not much, before the relay\'s own overhead', Math.round(perMin) + 'kb a minute');

    // a guest applying snapshots and stepping between them stays with the host
    const host = A.newGame(4242);
    const guest = A.newGame(1);
    guest.guessing = true;
    const l = A.newBrain('normal', 'balanced', 3), r = A.newBrain('normal', 'rush', 4);
    let worstGap = 0, wrongGold = 0, guestEnded = false, compared = 0, drift = 0, each = Math.round(HZ / 3);
    for (let i = 0; i < 8 * 60 * HZ && !host.over; i++) {
        A.think(host, 0, l); A.think(host, 1, r);
        A.step(host);
        A.step(guest);
        if (guest.over) guestEnded = true;
        if (i % each === 0) {
            // just before a correction is where a guess is furthest out
            const seen = new Map();
            guest.u[0].concat(guest.u[1]).forEach(u => seen.set(u.id, u));
            for (const u of host.u[0].concat(host.u[1])) {
                const g = seen.get(u.id);
                if (g) { worstGap = Math.max(worstGap, Math.abs(g.x - u.x)); compared++; drift += Math.abs(g.x - u.x); }
            }
            wrongGold = Math.max(wrongGold, Math.abs(guest.p[0].gold - host.p[0].gold) / Math.max(50, host.p[0].gold));
            A.applySnapshot(guest, JSON.parse(JSON.stringify(A.snapshot(host))));
            guest.guessing = true;
        }
    }
    expect(compared > 1000, 'following a real game', compared + ' units compared');
    expect(worstGap <= 25, 'a guest\'s guess at three snapshots a second is never far off', 'worst ' + worstGap.toFixed(1) + ' world units, average ' + (drift / compared).toFixed(2));
    expect(!guestEnded, 'and a guest\'s guess never ends the game by itself');

    // the end of a match reaches a guest, with the numbers for the end screen
    const fin = A.newGame(8);
    fin.p[0].baseDmg = 321; fin.p[0].earned = 654;
    A.command(fin, 0, { c: 'resign' });
    const g2 = A.newGame(9);
    A.applySnapshot(g2, JSON.parse(JSON.stringify(A.snapshot(fin))));
    expect(g2.over && g2.winner === 1 && g2.endWhy === 'resign', 'how a match ended crosses the wire');
    expect(g2.p[0].baseDmg === 321 && g2.p[0].earned === 654, 'and so do the end screen\'s numbers');
    expect(A.snapshot(A.newGame(1)).p[0].length < A.snapshot(fin).p[0].length, 'which only travel at the end');

    // a snapshot keeps the guest's cooldowns, since it does not carry them
    const g3 = A.newGame(9);
    g3.u[0].push({ id: 5, t: 0, x: 300, hp: 50, cd: 9 });
    const h3 = A.newGame(9);
    h3.u[0].push({ id: 5, t: 0, x: 310, hp: 40, cd: 2 });
    A.applySnapshot(g3, JSON.parse(JSON.stringify(A.snapshot(h3))));
    expect(g3.u[0][0].x === 310 && g3.u[0][0].hp === 40 && g3.u[0][0].cd === 9, 'a correction moves a unit without making it swing twice');
}

// ===================================================================
section('the triangle, in the open, at equal gold');
// ===================================================================
function fight(mixA, mixB, age, gold, seed, opts = {}) {
    const s = A.newGame(seed);
    s.p[0].age = s.p[1].age = age;
    s.p[0].hp = s.p[1].hp = 1e8;
    if (opts.ageB !== undefined) s.p[1].age = opts.ageB;
    const fill = (p, mix, a) => {
        let g = gold, i = 0;
        const list = [];
        for (; ;) {
            const u = A.unitFor(a, mix[i % mix.length]);
            if (g < u.cost) break;
            g -= u.cost; list.push(u.id); i++;
        }
        p.q = list; p.trainT = 0.01;
    };
    fill(s.p[0], mixA, age);
    fill(s.p[1], mixB, opts.ageB !== undefined ? opts.ageB : age);
    if (opts.holdA) s.p[0].hold = 1;
    const fw = A.FIREWALL.dmg;
    if (!opts.firewall) A.FIREWALL.dmg = 0;
    const left = k => s.u[k].reduce((n, u) => n + A.UNITS[u.t].cost * (u.hp / A.UNITS[u.t].hp), 0) + s.p[k].q.reduce((n, t) => n + A.UNITS[t].cost, 0);
    for (let t = 0; t < 400 * HZ; t++) {
        s.p[0].gold = s.p[1].gold = 0;
        if (opts.holdA && s.p[0].hold && !s.p[0].q.length) s.p[0].hold = 0;
        A.step(s);
        if (left(0) <= 0 || left(1) <= 0) break;
    }
    A.FIREWALL.dmg = fw;
    return (left(0) - left(1)) / gold;
}
const surplus = (a, b, age, opts) => {
    const r = [];
    for (let i = 0; i < 9; i++) r.push(fight(a, b, age, 400 * A.AGES[age].cost, 100 + i * 17, opts));
    return r.sort((x, y) => x - y)[4];
};
{
    for (const age of [0, 2, 4]) {
        const gs = surplus([0], [1], age), st = surplus([1], [2], age), tg = surplus([2], [0], age);
        expect(gs > 0.15, 'age ' + (age + 1) + ': grunts beat shooters', pct(gs) + ' of the army left');
        expect(st > 0.15, 'age ' + (age + 1) + ': shooters beat tanks', pct(st) + ' of the army left');
        expect(tg > 0.15, 'age ' + (age + 1) + ': tanks beat grunts', pct(tg) + ' of the army left');
    }
    // so a mix has no worst case: it should at least hold its own against each pure army
    for (const [name, pure] of [['grunts', [0]], ['shooters', [1]], ['tanks', [2]]]) {
        const mix = surplus([0, 1, 2], pure, 2);
        expect(mix > -0.65, 'one of each is not simply crushed by all ' + name, pct(mix));
    }
    // a new age has to be worth the climb, without making the last one worthless
    const newer = [];
    for (let a = 1; a < 5; a++) {
        const old = 400 * A.AGES[a].cost;
        const r = [];
        for (let i = 0; i < 5; i++) r.push(fight([0, 1], [0, 1], a, old, 300 + i * 13, { ageB: a - 1 }));
        newer.push(r.sort((x, y) => x - y)[2]);
    }
    expect(newer.every(v => v > 0.2), 'gold for gold, a newer age beats the age before it', newer.map(pct).join(' '));

    // the hold button has to be worth having: a wave beats the same army sent as a trickle
    const trickle = [], wave = [];
    for (let i = 0; i < 9; i++) {
        trickle.push(fight([0, 1], [0, 1], 2, 400 * 3.6, 500 + i * 7));
        wave.push(fight([0, 1], [0, 1], 2, 400 * 3.6, 500 + i * 7, { holdA: true }));
    }
    trickle.sort((x, y) => x - y); wave.sort((x, y) => x - y);
    expect(wave[4] > trickle[4] + 0.1, 'holding an army back and sending it as a wave beats trickling it', pct(trickle[4]) + ' trickled, ' + pct(wave[4]) + ' held');
}

// ===================================================================
section('a few hundred games of bots');
// ===================================================================
function pair(a, b, n, seedBase) {
    const out = { a: 0, b: 0, draw: 0, t: [], maxAge: [], over: true };
    for (let i = 0; i < n; i++) {
        const flip = i % 2 === 1;
        const s = A.playOut(seedBase + i * 31, flip ? b : a, flip ? a : b);
        if (!s.over) out.over = false;
        if (s.winner === -1 || s.winner === null) out.draw++;
        else if ((s.winner === 0) !== flip) out.a++;
        else out.b++;
        out.t.push(A.seconds(s));
        out.maxAge.push(Math.max(s.p[0].age, s.p[1].age));
    }
    out.t.sort((x, y) => x - y);
    out.rate = out.a / n;
    return out;
}
const STARTED = Date.now();
const allGames = [];
const REAL = ['balanced', 'rush', 'greed', 'turtle'];

for (const diff of ['normal', 'hard']) {
    const field = {};
    REAL.forEach(p => { field[p] = { w: 0, n: 0 }; });
    let widest = 0, widestName = '';
    const table = [];
    for (let i = 0; i < REAL.length; i++) {
        for (let j = i + 1; j < REAL.length; j++) {
            const r = pair({ diff, plan: REAL[i] }, { diff, plan: REAL[j] }, 16, 1000 + i * 100 + j * 10);
            allGames.push(r);
            field[REAL[i]].w += r.a; field[REAL[i]].n += 16;
            field[REAL[j]].w += r.b; field[REAL[j]].n += 16;
            table.push(REAL[i] + ' ' + pct(r.rate) + ' ' + REAL[j]);
            const lop = Math.max(r.rate, r.b / 16);
            if (lop > widest) { widest = lop; widestName = REAL[i] + ' v ' + REAL[j]; }
        }
    }
    console.log('        ' + table.join(', '));
    const rates = REAL.map(p => field[p].w / field[p].n);
    expect(rates.every(v => v >= 0.2 && v <= 0.8), diff + ': no plan is the answer, or hopeless, against the field',
        REAL.map((p, i) => p + ' ' + pct(rates[i])).join(', '));
    expect(widest <= 1, diff + ': the most lopsided matchup', widestName + ' ' + pct(widest));
}
{
    // seats: the left wall is not an advantage
    const l = { w: 0, n: 0 };
    for (let i = 0; i < 40; i++) {
        const s = A.playOut(7000 + i * 13, { diff: 'normal', plan: 'balanced' }, { diff: 'normal', plan: 'balanced' });
        if (s.winner === 0) l.w++;
        l.n++;
    }
    expect(l.w / l.n >= 0.35 && l.w / l.n <= 0.65, 'neither seat has the better of it', pct(l.w / l.n) + ' for the left wall over ' + l.n + ' mirror games');

    // no one button is the whole game
    for (const m of ['monoGrunt', 'monoShooter', 'monoTank']) {
        const r = pair({ diff: 'normal', plan: m }, { diff: 'normal', plan: 'balanced' }, 12, 8000);
        expect(r.rate <= 0.5, A.PLANS[m].label + ' does not beat somebody who mixes', pct(r.rate));
    }
    const walls = pair({ diff: 'normal', plan: 'turrets' }, { diff: 'normal', plan: 'turtle' }, 6, 8100);
    expect(walls.rate === 0, 'turrets alone cannot win a game', pct(walls.rate));
    const waves = pair({ diff: 'normal', plan: 'waves' }, { diff: 'normal', plan: 'balanced' }, 16, 8200);
    expect(waves.rate >= 0.1, 'playing in waves is not simply throwing the game away', pct(waves.rate));

    // the difficulty is really a difficulty
    const ladder = [['hard', 'normal', 0.6], ['normal', 'easy', 0.7], ['hard', 'easy', 0.8], ['troll', 'hard', 0.7]];
    for (const [hi, lo, floor] of ladder) {
        const r = pair({ diff: hi, plan: 'balanced' }, { diff: lo, plan: 'balanced' }, 20, 9000);
        allGames.push(r);
        expect(r.rate >= floor, hi + ' beats ' + lo, pct(r.rate) + ', and has to be at least ' + pct(floor));
    }
    // and whichever plan it drew, easy is not out of reach
    const easyRush = pair({ diff: 'hard', plan: 'balanced' }, { diff: 'easy', plan: 'rush' }, 12, 9500);
    expect(easyRush.rate >= 0.6, 'easy with a rush plan is still easy', pct(easyRush.rate));
}

// ===================================================================
section('somebody who is not a bot');
// ===================================================================
// no counter-picking, no holding, looking up every couple of seconds. The first
// one saves for an age when the button says so. The second never stops spending,
// which is what a first game looks like, and it still has a chance against easy.
{
    const person = (s, side, saves) => {
        const p = s.p[side];
        const can = c => !A.canCommand(s, side, c);
        const top = p.age < 4 ? 'age' : 'overclock';
        if (can({ c: top })) { A.command(s, side, { c: top }); return; }
        const next = A.AGES[p.age + 1];
        const foe = s.u[1 - side][0];
        const close = foe && Math.abs(foe.x - A.BASE_FRONT[side]) < 450;
        if (saves && next && p.xp >= next.xp && !close && s.u[side].length >= 3) return;
        if (saves && p.modem < 3 && s.u[side].length >= 4 && !close && p.gold < A.MODEM_COST[p.modem]) return;
        if (p.spCd <= 0 && s.u[1 - side].length >= 2) A.command(s, side, { c: 'special' });
        if (p.tur.length < A.slotsOf(p) && p.gold > A.turretCost(0, p.age) * 2) { A.command(s, side, { c: 'turret', k: 0 }); return; }
        if (p.modem < 3 && p.gold >= A.MODEM_COST[p.modem]) { A.command(s, side, { c: 'modem' }); return; }
        const have = [0, 0, 0];
        s.u[side].forEach(u => { const r = A.UNITS[u.t].role; if (r < 3) have[r]++; });
        p.q.forEach(t => { const r = A.UNITS[t].role; if (r < 3) have[r]++; });
        if (s.u[side].length + p.q.length < A.POP_CAP && p.q.length < 3) A.command(s, side, { c: 'train', r: have[0] <= have[1] ? 0 : have[1] <= have[2] * 2 ? 1 : 2 });
    };
    const versus = (diff, saves, n = 24) => {
        let w = 0;
        for (let i = 0; i < n; i++) {
            const s = A.newGame(50 + i * 7), b = A.newBrain(diff, REAL[i % 4], i + 3);
            s.p[1].handicap = A.DIFFICULTIES[diff].income;
            let next = 0;
            while (!s.over && s.tick < 3600 * HZ) {
                if (A.seconds(s) >= next) { person(s, 0, saves); next += 2; }
                A.think(s, 1, b);
                A.step(s);
            }
            if (s.winner === 0) w++;
        }
        return w / n;
    };
    const easy = versus('easy', true), normal = versus('normal', true), hard = versus('hard', true), troll = versus('troll', true);
    expect(easy >= 0.7, 'somebody playing sensibly beats easy, most of the time', pct(easy));
    expect(normal >= 0.3 && normal <= 0.8, 'normal is a real game for them', pct(normal));
    expect(hard <= normal, 'hard is harder than that', pct(hard));
    expect(troll <= hard && troll <= 0.25, 'and troll is what the warning says it is', pct(troll));
    const first = versus('easy', false);
    expect(first >= 0.3, 'and a first game that never stops spending can still beat easy', pct(first));
}

// ===================================================================
section('how long a game is');
// ===================================================================
{
    const every = allGames.flatMap(r => r.t).sort((a, b) => a - b);
    const at = p => every[Math.min(every.length - 1, Math.floor(every.length * p))];
    const end = A.DISK_FULL_AT + 300;
    expect(every.length >= 200, 'measured', every.length + ' games in ' + Math.round((Date.now() - STARTED) / 1000) + 's');
    expect(allGames.every(r => r.over), 'every one of them ended');
    expect(at(0.5) >= 15 * 60 && at(0.5) <= 32 * 60, 'the typical game is a long one', 'median ' + mins(at(0.5)));
    expect(at(0.1) >= 8 * 60, 'and hardly any are over quickly', 'one in ten under ' + mins(at(0.1)) + ', shortest ' + mins(every[0]));
    expect(every[every.length - 1] <= end, 'and none goes on for ever', 'longest ' + mins(every[every.length - 1]) + ', the clock is at ' + mins(A.DISK_FULL_AT));
    const draws = allGames.reduce((n, r) => n + r.draw, 0);
    expect(draws / every.length <= 0.05, 'and they end with a winner', draws + ' draws');
    const ages = allGames.flatMap(r => r.maxAge);
    const top = ages.filter(a => a === 4).length / ages.length;
    expect(top >= 0.2, 'a fair share of games get as far as the last age', pct(top));
    expect(ages.filter(a => a >= 2).length / ages.length >= 0.75, 'and most see at least three of the five', pct(ages.filter(a => a >= 2).length / ages.length));

    // the time an age takes in a normal game
    const tally = [[], [], [], []];
    for (let i = 0; i < 12; i++) {
        const s = A.newGame(30 + i);
        const l = A.newBrain('normal', 'balanced', i + 1), r = A.newBrain('normal', 'balanced', i + 90);
        let seen = 0;
        while (!s.over && s.tick < 3600 * HZ) {
            A.think(s, 0, l); A.think(s, 1, r); A.step(s);
            const a = Math.max(s.p[0].age, s.p[1].age);
            while (seen < a) { tally[seen].push(A.seconds(s)); seen++; }
        }
    }
    const med = l => { const x = l.slice().sort((a, b) => a - b); return x[x.length >> 1] || 0; };
    const steps = tally.map(med);
    expect(steps[0] >= 2 * 60 && steps[0] <= 8 * 60, 'the second age comes after a few minutes', mins(steps[0]));
    expect(steps.every((v, i) => !i || v === 0 || v > steps[i - 1] + 60), 'and each one after that takes a while longer', steps.map(mins).join(' '));
}

// ===================================================================
section('replays: the same match, from a link');
// ===================================================================
{
    const R = A.replay;
    const LINK_MAX = 8000;      // GitHub Pages answers 414 past about 8,180 characters of address
    const BASE = 'https://mrhakan.github.io/?app=ageoftroll&replay=';
    const rules = s => JSON.stringify(s, (k, v) => (['ev', 'log', 'endWhy', 'match', 'guessing'].includes(k) ? undefined : v));

    // somebody at the keyboard: whatever buttons, whenever, including the
    // pointless ones, with a guest's orders landing on odd ticks
    function person(seed, perSecond) {
        let x = seed | 0 || 1;
        const roll = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
        const all = [{ c: 'train', r: 0 }, { c: 'train', r: 1 }, { c: 'train', r: 2 }, { c: 'train', r: 3 }, { c: 'turret', k: 0 }, { c: 'turret', k: 1 },
            { c: 'sell' }, { c: 'modem' }, { c: 'age' }, { c: 'special' }, { c: 'stance', h: 0 }, { c: 'stance', h: 1 }, { c: 'overclock' }];
        return (s, side) => { while (roll() < perSecond / A.HZ) A.command(s, side, all[Math.floor(roll() * all.length)]); };
    }
    // a match the way the window plays one: orders between ticks, the bot's
    // inside the loop, and the whole thing written down
    function match(seed, left, right, opts = {}) {
        const s = R.record(A.newGame(seed), seed);
        if (opts.h) { s.p[0].handicap = opts.h[0]; s.p[1].handicap = opts.h[1]; }
        let st = s;
        const limit = (opts.limit || 3600) * A.HZ;
        for (let i = 0; !st.over && st.tick < limit; i++) {
            left(st, 0); right(st, 1);
            // a solo save and a reload, halfway: the log goes into the save with the rest
            if (opts.saveAt && st.tick === opts.saveAt) st = JSON.parse(JSON.stringify(st));
            if (opts.resignAt && st.tick === opts.resignAt) A.command(st, 1, { c: 'resign' });
            if (!st.over) A.step(st);
        }
        return st;
    }
    const bot = (diff, plan, seed) => { const b = A.newBrain(diff, plan, seed); return (s, side) => A.think(s, side, b); };

    const games = [
        ['hard balanced v hard greed', 11, bot('hard', 'balanced', 1), bot('hard', 'greed', 2), {}],
        ['troll turtle v normal waves', 12, bot('troll', 'turtle', 3), bot('normal', 'waves', 4), { h: [1.25, 1] }],
        ['easy rush v hard balanced', 13, bot('easy', 'rush', 5), bot('hard', 'balanced', 6), { h: [0.8, 1] }],
        ['a person v a hard bot, saved and reloaded halfway', 14, person(77, 1.2), bot('hard', 'balanced', 7), { saveAt: 9000 }],
        ['two people online, one of them a button masher', 15, person(78, 0.9), person(79, 6), {}],
        ['a hard bot v a person who gives up', 16, bot('hard', 'rush', 8), person(80, 1), { resignAt: 4321 }]
    ];
    const links = [];
    for (const [name, seed, left, right, opts] of games) {
        const s = match(seed, left, right, opts);
        const rp = R.replayOf(s, { names: ['left', 'right'], label: 'hard' });
        const code = await R.encode(rp);
        const back = await R.decode(code);
        const v = back.rp ? R.verify(back.rp) : { ok: false, end: null };
        links.push([name, code.length, s.tick, rp.c.length / 2]);
        expect(v.ok && rules(v.end) === rules(s), name + ': the replay ends in the very same state',
            (s.tick / A.HZ / 60).toFixed(1) + 'm, ' + rp.c.length / 2 + ' commands, ' + code.length + ' characters' + (v.ok ? '' : ', ' + (back.why || 'did not verify')));
    }
    const resigned = links[links.length - 1];
    expect(resigned[2] === 4321, 'a surrender is in the replay, on its tick');

    // the link, measured. A half-hour match is what the game is for
    const long = links.filter(l => l[2] >= 20 * 60 * A.HZ);
    expect(long.length >= 1, 'some of those went on for more than twenty minutes', long.map(l => (l[2] / A.HZ / 60).toFixed(0) + 'm').join(', '));
    const worst = Math.max(...links.slice(0, 4).map(l => BASE.length + l[1]));
    expect(worst <= LINK_MAX, 'and the whole link stays inside what GitHub Pages will take', worst + ' characters at most, the limit is ' + LINK_MAX);
    const masher = links[4];
    expect(masher[1] < R.LIMIT.chars, 'even six orders a second for the whole match fits in a replay', masher[3] + ' commands, ' + masher[1] + ' characters');
    console.log('        links: ' + links.map(l => l[1] + ' (' + (l[2] / A.HZ / 60).toFixed(0) + 'm, ' + l[3] + ' orders)').join(', '));

    // several seeds, start to finish, nobody special
    let same = 0;
    for (const seed of [101, 202, 303, 404, 505]) {
        const s = match(seed, bot('normal', 'balanced', seed), bot('hard', 'turtle', seed + 1), {});
        const v = R.verify(R.unpack(R.pack(R.replayOf(s, {}))));
        if (v.ok && rules(v.end) === rules(s)) same++;
    }
    expect(same === 5, 'five more seeds, five identical endings', same + ' of 5');

    // scrubbing: any tick, from the nearest saved state, is the same as playing up to it
    {
        const s = match(31, bot('hard', 'greed', 9), person(81, 1.5), {});
        const rp = R.replayOf(s, {});
        const v = R.verify(rp);
        const straight = R.start(rp), cur = { i: 0 };
        const marks = [0, 1, 399, 400, 401, 3333, Math.floor(rp.end / 2), rp.end - 1];
        let fine = 0;
        for (const t of marks) {
            while (straight.tick < t) R.tick(straight, rp, cur);
            if (rules(R.seek(rp, v.keys, t).s) === rules(straight)) fine++;
        }
        expect(fine === marks.length, 'jumping anywhere in a replay lands on the same state as playing there', fine + ' of ' + marks.length);
        const end = R.seek(rp, v.keys, rp.end).s;
        expect(end.over && end.winner === s.winner && rules(end) === rules(s), 'and jumping to the end is the result');
        expect(v.keys.length === Math.floor(rp.end / R.KEY_EVERY) + 1, 'a saved state every ' + R.KEY_EVERY / A.HZ + ' seconds', v.keys.length + ' of them');
    }

    // online: the guest gets the host's copy and turns it round to its own side
    {
        const s = match(41, person(82, 1), person(83, 1), { limit: 400 });
        A.command(s, 0, { c: 'resign' });
        const host = await R.encode(R.replayOf(s, { me: 0, names: ['host', 'guest'], label: 'online' }));
        const got = (await R.decode(host)).rp;
        got.me = 1;
        const mine = (await R.decode(await R.encode(got))).rp;
        expect(mine.me === 1 && mine.names[1] === 'guest' && R.verify(mine).ok, 'a guest\'s copy opens on the guest\'s side and still plays true');
    }

    // ---- what a link can be made to say ----
    const good = await R.encode(R.replayOf(match(51, bot('hard', 'balanced', 10), bot('normal', 'rush', 11), {}), { names: ['a', 'b'] }));
    const goodRp = (await R.decode(good)).rp;
    const junk = ['', ' ', '!!!!', 'A', 'AAAA', 'not a replay at all', good.slice(0, 10), good.slice(0, -3), good + 'AAAA', good.replace(/[a-m]/g, 'Z'), '%00%00', 'AQ'.repeat(40)];
    let calm = 0;
    const let_in = [];
    for (const [i, t] of junk.entries()) {
        try { const r = await R.decode(t); if (!r.rp || !R.verify(r.rp).ok) calm++; else let_in.push(i); } catch (e) { let_in.push(i + ' threw ' + e.message); }
    }
    expect(calm === junk.length, 'nonsense, cut-off and padded links are turned away, and nothing throws', calm + ' of ' + junk.length + (let_in.length ? ', let in: ' + let_in.join(', ') : ''));

    // one byte changed anywhere, a few hundred times: refused, or only a name changed
    const bytes = await (async () => { const z = await R.decode(good); return R.pack(z.rp); })();
    const toCode = async b => { const c = new Uint8Array(b.length + 1); c.set(b, 1); return Buffer.from(c).toString('base64url'); };
    let threw = 0, wrong = 0, tries = 0;
    const sameRules = r => r.seed === goodRp.seed && r.end === goodRp.end && r.w === goodRp.w && r.hash === goodRp.hash &&
        r.h.join() === goodRp.h.join() && r.c.join() === goodRp.c.join();
    let x = 12345;
    for (let n = 0; n < 400; n++) {
        x = (x * 1103515245 + 12345) >>> 0;
        const b = bytes.slice();
        const at = x % b.length;
        b[at] = (b[at] + 1 + (x >>> 16) % 255) & 255;
        tries++;
        try {
            const r = await R.decode(await toCode(b));
            if (r.rp && R.verify(r.rp).ok && !sameRules(r.rp)) wrong++;
        } catch (e) { threw++; }
    }
    expect(!threw && !wrong, 'a byte changed anywhere: refused, or it was only somebody\'s name', tries + ' edits, ' + threw + ' crashes, ' + wrong + ' played wrong');

    // sizes
    expect((await R.decode('A'.repeat(R.LIMIT.chars + 1))).why === 'big', 'a link longer than ' + R.LIMIT.chars + ' characters is not even read');
    {
        const bomb = new Uint8Array(4 << 20);
        const z = zlib.deflateRawSync(bomb, { level: 9 });
        const len = [];
        for (let n = z.length; ; n = Math.floor(n / 128)) { if (n < 128) { len.push(n); break; } len.push((n % 128) | 128); }
        const c = Uint8Array.from([1, ...len, ...z]);
        const code = Buffer.from(c).toString('base64url');
        expect(code.length < R.LIMIT.chars && (await R.decode(code)).why === 'big', 'a small link that unpacks into megabytes stops at ' + (R.LIMIT.bytes >> 10) + 'kb', code.length + ' characters of zeros');
    }
    {
        // the count says a million commands and the bytes say otherwise
        const rp = Object.assign({}, goodRp, { c: [] });
        const b = R.pack(rp);
        // 50000 as a varint, where the count of none was
        const lie = Uint8Array.from([...b.slice(0, -1), 0xd0, 0x86, 0x03]);
        expect((await R.decode(await toCode(lie))).rp === undefined, 'a command count the bytes cannot hold is a lie, not an allocation');
    }
    {
        const rp = Object.assign({}, goodRp, { end: R.LIMIT.ticks + 1 });
        expect((await R.decode(await toCode(R.pack(rp)))).why === 'big', 'and a match that claims to last for ever is not played out');
    }

    // ---- versions ----
    const older = loadRules(T => { T.AGES[0].income = 4.7; });
    const renamed = loadRules(T => { T.BOT_NAMES = ['somebody']; T.SPECIALS[0].name = 'a different name'; });
    expect(older.replay.rulesPrint() !== R.rulesPrint(), 'one number in the rules changes the fingerprint');
    expect(renamed.replay.rulesPrint() === R.rulesPrint(), 'a renamed troll or special does not');
    expect((await older.replay.decode(good)).why === 'old', 'a replay from other rules says it is from an older version, before playing a tick of it');
    {
        const b = R.pack(goodRp); b[0] = R.FORMAT + 1;
        expect((await R.decode(await toCode(b))).why === 'old', 'and so does one in another format');
        // the rules changed in the code and nobody bumped RULES_REV: the replay
        // is let in, plays out differently, and the end state gives it away
        const tampered = Object.assign({}, goodRp, { c: goodRp.c.slice() });
        tampered.c[tampered.c.length - 1] ^= 2;
        expect(!R.verify(tampered).ok, 'a replay that plays out differently from how it was recorded is caught before anybody watches it');
    }

    // the replay that is checked in: as long as the fingerprint matches, the
    // simulation has to play it to the same last bit. If this fails and the
    // fingerprint did not change, step() or command() changed: bump RULES_REV
    {
        const kept = exists(FIXTURE) ? read(FIXTURE).trim() : '';
        const d = await R.decode(kept);
        if (d.why === 'old') {
            console.log('  note  ' + FIXTURE + ' is from older rules, and is refused as it should be. Run with --replay-fixture to write a new one');
            expect(true, 'the kept replay is from older rules and says so');
        } else {
            const v = d.rp ? R.verify(d.rp) : { ok: false };
            expect(v.ok, 'the kept replay still plays out to the same last bit',
                v.ok ? (d.rp.end / A.HZ / 60).toFixed(1) + 'm, ' + kept.length + ' characters' : 'the rules changed without RULES_REV changing: bump it in age-of-troll-sim.js, then run with --replay-fixture');
        }
    }

    // the window: no order is given while watching
    const ui = read('games/age-of-troll/age-of-troll.js');
    expect(/if \(!g \|\| g\.watch \|\| g\.s\.over\) return false/.test(ui), 'watching cannot issue a command');
    expect(/class="aot-cmds" id="aot-cmds"\$\{g\.watch \? ' inert' : ''\}/.test(ui), 'and the buttons are inert while watching');
    expect(/A\.replay\.record\(s, seed\)/.test(ui) && /A\.replay\.record\(A\.newGame\(seed\), seed\)/.test(ui), 'a match and a rematch are both written down');
    const extras = read('js/extras.js');
    expect(/function aotReplayInUrl/.test(extras) && /openAgeOfTroll\(mode\) \{\s*if \(!mode\) \{ const replay = aotReplayInUrl\(\)/.test(extras), 'the link is read off the address before the game\'s scripts load');
}

// ===================================================================
section('the animations');
{
    // each sheet is a webp of 4 x 4 frames, read off its header: VP8 (lossy), VP8L or VP8X
    const webpSize = buf => {
        if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
        const kind = buf.toString('ascii', 12, 16);
        if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
        if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
        if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
        return null;
    };
    const bad = [];
    let sheets = 0, bytes = 0;
    for (const u of A.UNITS) {
        const meta = A.ANIM && A.ANIM[u.anim];
        if (!meta) { bad.push(u.name + ' has no animation'); continue; }
        const moves = ['walk', 'attack', 'death'].concat(meta.shot ? ['projectile'] : []);
        for (const m of moves) {
            const file = 'games/age-of-troll/anim/' + u.anim + '-' + m + '.webp';
            if (!fs.existsSync(path.join(ROOT, file))) { bad.push(file + ' is missing'); continue; }
            const buf = fs.readFileSync(path.join(ROOT, file));
            const cell = m === 'projectile' ? meta.shot.cell : meta.cell;
            const size = webpSize(buf);
            if (!size || size[0] !== cell * 4 || size[1] !== cell * 4) bad.push(file + ' is ' + size + ', not ' + cell * 4 + ' square');
            sheets++; bytes += buf.length;
        }
        if (u.role === 1 && !meta.shot) bad.push(u.name + ' shoots, and has nothing to shoot');
    }
    expect(!bad.length, 'every troll walks, swings and dies, and every one that shoots has a shot', bad.join('; '));
    expect(sheets === 53, 'which is 53 sheets', sheets);
    expect(bytes < 3 * 1024 * 1024, 'that all come to a few megabytes, and load one kind of troll at a time', Math.round(bytes / 1024) + 'kb');
    const odd = Object.keys(A.ANIM_LOOKS_LEFT || {}).filter(f => !fs.existsSync(path.join(ROOT, 'games/age-of-troll/anim/' + f + '.webp')));
    expect(!odd.length, 'the moves drawn looking left are moves that exist', odd.join(', '));
}

section('wired into the site');
// ===================================================================
{
    const index = read('index.html');
    const scripts = ['games/age-of-troll/age-of-troll-data.js', 'games/age-of-troll/age-of-troll-sim.js', 'games/age-of-troll/age-of-troll.js'];
    const sw = read('sw.js');
    const later = (sw.match(/PRECACHE_LATER = \[([\s\S]*?)\]/) || [])[1] || '';
    const first = (sw.match(/PRECACHE = \[([\s\S]*?)\]/) || [])[1] || '';
    for (const f of scripts) {
        expect(exists(f), f + ' exists');
        expect(!index.includes(f), 'and is not in the first load');
        expect(later.includes("'/" + f + "'") && !first.includes(f), 'and the service worker keeps it for later');
    }
    const np = read('games/netplay.js');
    expect(/id: 'ageoftroll'/.test(np), 'the lobby can offer it');
    expect(scripts.every(f => np.includes("'" + f + "'")), 'and knows which files it takes');
    expect(/startMenuAction\('ageoftroll'\)/.test(index), 'it is in the start menu');
    expect(/ageoftroll: \(\) => openAgeOfTroll\(\)/.test(read('js/index.js')), 'and the action table');
    expect(/\['age of troll', 'game'/.test(read('js/extras.js')) && /function openAgeOfTroll/.test(read('js/extras.js')), 'and find:, with a loader');
    const ui = read('games/age-of-troll/age-of-troll.js');
    expect(/transport\.kind === 'bus'/.test(ui), 'it eases off over the relays');
    expect(/const onRelays = g =>/.test(ui) && !/const slow\s*=/.test(ui), 'and asks each time rather than once');
    expect(/registerGame\(\{[\s\S]*?paintAvatar/.test(ui), 'it hands the lobby a painter, or the lobby keeps asking for one');

    // every class the game invents has a style
    const css = read('css/style.css');
    const used = [...new Set([...ui.matchAll(/\baot-[a-z0-9-]+/g)].map(m => m[0]))]
        .filter(c => !['aot-win', 'aot-hard', 'aot-canvas', 'aot-gold', 'aot-rate', 'aot-xp', 'aot-xpfill', 'aot-age', 'aot-army', 'aot-clock', 'aot-link', 'aot-end', 'aot-net', 'aot-queue', 'aot-trainfill', 'aot-say', 'aot-cmds', 'aot-pause', 'aot-help', 'aot-resign', 'aot-quit', 'aot-again', 'aot-menu', 'aot-subbot', 'aot-claim', 'aot-giveup', 'aot-continue', 'aot-diff', 'aot-plan', 'aot-solo', 'aot-online', 'aot-help2', 'aot-share', 'aot-savefile', 'aot-replay-link', 'aot-replay-note', 'aot-loading', 'aot-problem', 'aot-play', 'aot-seek', 'aot-wclock', 'aot-side', 'aot-replay-result', 'aot-look', 'aot-paste', 'aot-watch', 'aot-file', 'aot-fileinput'].includes(c));
    const unstyled = used.filter(c => !new RegExp('\\.' + c + '[\\s,:{.\\[>]').test(css));
    expect(!unstyled.length, 'every class it invents has a style', unstyled.join(', '));
    const funJs = read('js/fun.js');
    expect(["'aot-win'", "'aot-hard'"].every(a => funJs.includes(a + ':')), 'and the achievements it hands out exist');
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
