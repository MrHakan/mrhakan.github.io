// ===================================================================
// check-troll-problem.mjs — the rules, and a few hundred games of bots
//
// A tower defense is balanced or it is not, and looking at it does not say
// which: the first numbers for this one had a spam folder doing most of the
// damage in every game and a troll king that no amount of towers could stop,
// and both looked fine on screen. So the targets are written down here and the
// simulation is held to them. Seeds are fixed, so a number only moves when
// the rules do.
//
//   node .github/scripts/check-troll-problem.mjs            the check
//   node .github/scripts/check-troll-problem.mjs --report   and every number behind it
// ===================================================================
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));
const REPORT = process.argv.includes('--report');

const loadRules = () => {
    const c = vm.createContext({ console });
    vm.runInContext(read('games/troll-problem/troll-problem-data.js'), c);
    vm.runInContext(read('games/troll-problem/troll-problem-sim.js'), c);
    return { TP: c.TP, S: c.TP_SIM };
};

// ---------------------------------------------------------------
// one game, start to end, with a bot in every seat
// ---------------------------------------------------------------
function playRun(R, job) {
    const { TP, S } = R;
    const seats = Array.from({ length: job.seats || 1 }, (_, i) => ({ id: 'bot' + i, name: 'bot ' + i, bot: true }));
    const s = S.newGame({ map: job.map, seed: job.seed, seats, meta: job.meta || null, quiet: true });
    const bots = seats.map((_, i) => S.newBot(job.strat, job.seed * 31 + i * 7 + 1));
    let guard = 0;
    while (s.phase !== 'won' && s.phase !== 'lost' && guard++ < 200000) {
        for (let i = 0; i < bots.length; i++) if (bots[i]) S.think(s, i, bots[i]);
        // a seat walking out partway, when the job says so: its towers stay and nobody runs them
        if (job.dropAt && s.wave === job.dropAt && s.seats[1] && s.seats[1].on) { S.seatOn(s, 1, false); bots[1] = null; }
        S.step(s);
    }
    const dmgBy = {}, spentBy = {}, pathDmg = {}, pathSpent = {};
    for (const t of s.towers) {
        const id = t.def.id;
        dmgBy[id] = (dmgBy[id] || 0) + t.dmg;
        spentBy[id] = (spentBy[id] || 0) + t.spent;
        const p = t.a > t.b ? id + ':a' : t.b > t.a ? id + ':b' : id + ':-';
        pathDmg[p] = (pathDmg[p] || 0) + t.dmg;
        pathSpent[p] = (pathSpent[p] || 0) + t.spent;
    }
    const cleared = s.phase === 'won' ? TP.TOTAL_WAVES : s.wave - 1;
    return {
        label: job.label, map: job.map, seed: job.seed, won: s.phase === 'won', wave: s.wave, cleared,
        score: cleared + (s.phase === 'won' ? s.lives / TP.START_LIVES : 0),
        lives: Math.round(s.lives), minutes: s.t / 60, towers: s.towers.length,
        dmgBy, spentBy, pathDmg, pathSpent, leaks: s.leakByWave.slice(), gold: s.seats.map(p => Math.floor(p.gold)),
        maxTier: Math.max(0, ...s.towers.map(t => Math.max(t.a, t.b)))
    };
}

if (!isMainThread) {
    const R = loadRules();
    parentPort.postMessage(workerData.jobs.map(j => playRun(R, j)));
} else {
    await main();
}

async function main() {
    const STARTED = Date.now();
    const { TP, S } = loadRules();
    let checks = 0, failures = 0;
    const expect = (cond, msg, detail) => {
        checks++;
        if (cond) console.log('  ok    ' + msg + (detail ? '  (' + detail + ')' : ''));
        else { failures++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail : '')); }
    };
    const section = n => console.log('\n== ' + n + ' ==');
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : 0; };
    const f1 = n => (Math.round(n * 10) / 10).toFixed(1);

    // ===============================================================
    // the bots
    // ===============================================================
    const SMART = S.STRATS.smart;
    // the smart bot, with one tower favoured and one of its paths forced
    const favour = (id, p) => {
        const st = JSON.parse(JSON.stringify(SMART));
        st.weights[id] = (st.weights[id] || 1) * 4 + 2;
        if (p !== undefined) st.paths[id] = p;
        return st;
    };
    // a random plan, the kind a person who has not read anything makes
    const randomStrat = seed => {
        const r = S.rng(seed * 7919 + 13);
        const st = { weights: {}, paths: {}, n0: 2 + Math.floor(r() * 3), slope: 0.3 + r() * 0.3, maxT: 10 + Math.floor(r() * 10), focus: r(), noise: 0.3 };
        const ids = TP.TOWERS.map(t => t.id);
        for (const id of ids) { st.weights[id] = r() < 0.55 ? 0.5 + r() * 2 : 0; st.paths[id] = r() < 0.5 ? 0 : 1; }
        if (!ids.some(id => st.weights[id] > 0 && id !== 'clip')) st.weights.pointer = 1;
        return st;
    };
    const FULL_META = {};
    TP.META.forEach(m => { FULL_META[m.id] = m.max; });
    const HALF_META = {};
    TP.META.forEach(m => { HALF_META[m.id] = Math.ceil(m.max / 2); });

    // ===============================================================
    section('the pieces');
    // ===============================================================
    {
        expect(TP.TOWERS.length === 10, 'ten towers', TP.TOWERS.map(t => t.id).join(', '));
        expect(TP.TOWERS.every(t => t.paths.length === 2 && t.paths.every(p => p.tiers.length === TP.TIERS && p.tiers.every(x => x.name && x.text && x.cost > 0 && x.mod))),
            'each with two paths of ' + TP.TIERS + ' tiers, every tier named, priced and described');
        const missing = [];
        for (const t of TP.TOWERS) {
            for (const look of ['base', 'a', 'b']) { const f = TP.ART_DIR + t.art + '-' + look + '.webp'; if (!exists(f) || !TP.ART[t.art] || !TP.ART[t.art][look]) missing.push(f); }
            const shot = TP.ART_DIR + t.art + '-projectile.webp';
            if (t.kind !== 'support' && (!exists(shot) || !TP.ART[t.art].shot)) missing.push(shot);
        }
        expect(!missing.length, 'every tower has its three pictures and everything that throws has its projectile', missing.join(', '));
        const files = fs.readdirSync(path.join(ROOT, TP.ART_DIR));
        const big = files.filter(f => fs.statSync(path.join(ROOT, TP.ART_DIR, f)).size > 24 * 1024);
        expect(!big.length && files.every(f => f.endsWith('.webp')), 'and they are small webps, not the 1.5mb pngs they came from', big.join(', ') || Math.round(files.reduce((a, f) => a + fs.statSync(path.join(ROOT, TP.ART_DIR, f)).size, 0) / 1024) + 'kb for all ' + files.length);
        const anim = TP.ENEMIES.flatMap(e => ['walk', 'death'].map(m => TP.ANIM_DIR + e.anim + '-' + m + '.webp')).filter(f => !exists(f));
        expect(!anim.length, 'every troll walks and dies with an age of troll animation', anim.join(', '));
        expect(TP.WAVES.length === 30 && TP.WAVES.every(w => w.every(g => TP.ENEMY_BY_ID[g[0]] && g[1] > 0 && g[2] >= 0 && g[3] >= 0)), 'thirty waves, each of trolls that exist');
        expect([10, 20, 25, 30].every(TP.isBossWave) && TP.WAVES.filter((_, i) => TP.isBossWave(i + 1)).length === 4, 'with bosses on 10, 20, 25 and the king on 30');
        const most = Math.max(...TP.WAVES.map(w => w.reduce((a, g) => a + g[1], 0)));
        expect(most <= 140, 'and never more trolls in one wave than a phone can draw', most + ' at most');
        for (const m of TP.MAPS) {
            const r = S.roadOf(m).road, a = r.pts[0], b = r.pts[r.pts.length - 1];
            const off = p => p.x < 0 || p.x > TP.W || p.y < 0 || p.y > TP.H;
            const s = S.newGame({ map: m.id, seed: 1 });
            let free = 0;
            for (let y = 20; y < TP.H; y += 20) for (let x = 20; x < TP.W; x += 20) if (!S.placeProblem(s, x, y)) free++;
            expect(off(a) && off(b) && free >= 450, m.name + ': the road comes in and goes out off the board, and leaves room to build', free + ' free spots on a 20 unit grid, ' + Math.round(r.total) + ' of road');
        }
    }

    // ===============================================================
    section('putting a tower down, the way bloons does it');
    // ===============================================================
    // somewhere free next to a troll, for a tower to stand
    const near = (s, e) => { for (let r = 60; r < 110; r += 10) for (let k = 0; k < 16; k++) { const x = e.x + Math.cos(k / 16 * 6.283) * r, y = e.y + Math.sin(k / 16 * 6.283) * r; if (!S.placeProblem(s, x, y)) return { x, y }; } return null; };
    const rich = (map, seats) => { const s = S.newGame({ map: map || 'outskirts', seed: 5, seats }); s.seats.forEach(p => { p.gold = 1e6; }); return s; };
    const lastTower = s => s.towers[s.towers.length - 1];
    {
        const s = rich();
        const road = S.roadOf(s.map).road.pts[20];
        expect(S.command(s, 0, { c: 'place', t: 'pointer', x: road.x, y: road.y }) === 'road', 'not on the road');
        expect(S.command(s, 0, { c: 'place', t: 'pointer', x: 5, y: 500 }) === 'edge', 'not half off the board');
        const g0 = s.seats[0].gold;
        expect(S.command(s, 0, { c: 'place', t: 'pointer', x: 320, y: 220 }) === null && s.towers.length === 1, 'anywhere else, at any point, not on a grid');
        expect(s.seats[0].gold === g0 - S.towerCost(s, TP.TOWERS_BY_ID.pointer), 'for what it costs');
        expect(S.command(s, 0, { c: 'place', t: 'fax', x: 320 + TP.TOWER_R, y: 220 }) === 'tower', 'and nothing goes on top of it');
        expect(S.command(s, 0, { c: 'place', t: 'fax', x: 320 + TP.TOWER_R * 2 + 1, y: 220 }) === null, 'but right next to it is fine');
        const poor = S.newGame({ map: 'outskirts', seed: 5 }); poor.seats[0].gold = 10;
        expect(S.command(poor, 0, { c: 'place', t: 'pointer', x: 320, y: 220 }) === 'gold' && !poor.towers.length, 'no money, no tower');
        const lockedS = S.newGame({ map: 'outskirts', seed: 5, unlocked: ['pointer'] }); lockedS.seats[0].gold = 1e6;
        expect(S.command(lockedS, 0, { c: 'place', t: 'hammer', x: 320, y: 220 }) === 'locked', 'and a tower you have not unlocked yet stays in the shop');
    }

    // ===============================================================
    section('two paths, and only one of them all the way');
    // ===============================================================
    {
        const s = rich();
        S.command(s, 0, { c: 'place', t: 'fax', x: 320, y: 220 });
        const t = lastTower(s), up = p => S.command(s, 0, { c: 'up', i: t.id, p });
        const dmg0 = t.e.dmg;
        expect(up(0) === null && up(0) === null && t.a === 2, 'a path goes up a tier at a time');
        expect(up(1) === null && up(1) === null && t.b === 2, 'both paths to ' + TP.CROSS_CAP + ' is allowed');
        expect(up(0) === null && t.a === 3, 'one of them past it');
        expect(up(1) === 'locked' && t.b === 2, 'and then the other is locked');
        expect(S.lookOf(t) === 'base' && up(0) === null && t.a === 4 && S.lookOf(t) === 'a', 'the last tier changes the picture');
        expect(up(0) === 'max', 'and that is the end of it');
        expect(t.e.dmg > dmg0 && t.st.shots === 3, 'and the tiers do what they say', 'fax at 4-2: ' + Math.round(t.e.dmg) + ' damage, ' + t.st.shots + ' sheets');
        const u = rich();
        S.command(u, 0, { c: 'place', t: 'pointer', x: 320, y: 220 });
        const v = lastTower(u);
        for (let i = 0; i < 4; i++) S.command(u, 0, { c: 'up', i: v.id, p: 1 });
        expect(S.lookOf(v) === 'b' && S.command(u, 0, { c: 'up', i: v.id, p: 0 }) === null && S.command(u, 0, { c: 'up', i: v.id, p: 0 }) === null && S.command(u, 0, { c: 'up', i: v.id, p: 0 }) === 'locked',
            'the other way round too: 2-4, never 3-4');
        const total = v.spent;
        const before = u.seats[0].gold;
        expect(S.command(u, 0, { c: 'sell', i: v.id }) === null && u.seats[0].gold - before === Math.floor(total * TP.SELL_REFUND) && !u.towers.length,
            'selling gives back ' + Math.round(TP.SELL_REFUND * 100) + '% of everything spent on it');
        expect(S.command(u, 0, { c: 'place', t: 'pointer', x: 320, y: 220 }) === null, 'and frees the spot');
        const w = lastTower(u);
        expect(TP.TARGET_MODES.every(m => S.command(u, 0, { c: 'mode', i: w.id, m: m.id }) === null && w.mode === m.id) && S.command(u, 0, { c: 'mode', i: w.id, m: 'nope' }) === 'what',
            'first, last, strong, weak and close, and nothing else');

        // what a stranger on the other end of a wire could send
        const junk = [null, undefined, 3, 'x', [], {}, { c: 'nope' }, { c: 'place' }, { c: 'place', t: 'nope', x: 300, y: 300 }, { c: 'place', t: 'pointer', x: NaN, y: 300 },
            { c: 'place', t: 'pointer', x: '300', y: 300 }, { c: 'place', t: '__proto__', x: 300, y: 300 }, { c: 'place', t: 'constructor', x: 300, y: 300 }, { c: 'up', i: 99999, p: 0 },
            { c: 'up', i: w.id, p: 2 }, { c: 'up', i: w.id, p: '0' }, { c: 'sell', i: 'x' }, { c: 'mode', i: w.id, m: '__proto__' }, { c: 'place', t: 'pointer', x: 1e9, y: 1e9 }];
        let bad = null;
        const snap = JSON.stringify([u.seats, S.towerList(u)]);
        for (const j of junk) { try { if (S.command(u, 0, j) === null) bad = 'accepted ' + JSON.stringify(j); } catch (e) { bad = e.message; } }
        for (const seat of [-1, 1, 0.5, '0', null]) { try { if (S.command(u, seat, { c: 'place', t: 'pointer', x: 600, y: 60 }) === null) bad = 'seat ' + seat; } catch (e) { bad = e.message; } }
        expect(!bad, 'nonsense is refused rather than thrown', bad || '');
        expect(JSON.stringify([u.seats, S.towerList(u)]) === snap, 'and changes nothing');
    }

    // ===============================================================
    section('what a tower picks, and what it can hurt');
    // ===============================================================
    {
        const s = rich();
        s.phase = 'wave';
        S.command(s, 0, { c: 'place', t: 'pointer', x: 400, y: 300 });
        const t = lastTower(s);
        const at = (id, dist, hp) => { const e = S.spawn(s, id, dist); if (hp) e.hp = hp; return e; };
        const road = S.roadOf(s.map).road;
        const dists = [];
        for (let d = 0; d < road.total; d += 4) { const p = S.along(road, d, 0); if (Math.hypot(p.x - t.x, p.y - t.y) < t.e.range - 20) dists.push(d); }
        const a = at('grunt', dists[2], 5), b = at('grunt', dists[Math.floor(dists.length / 2)], 50), c = at('grunt', dists[dists.length - 3], 20);
        const pickBy = m => { t.mode = m; return S.pick(s, t)[0]; };
        expect(pickBy('first') === c && pickBy('last') === a && pickBy('strong') === b && pickBy('weak') === a, 'first, last, strong and weak pick the troll they say');
        const close = [a, b, c].sort((x, y) => Math.hypot(x.x - t.x, x.y - t.y) - Math.hypot(y.x - t.x, y.y - t.y))[0];
        expect(pickBy('close') === close, 'and close the closest');
        s.enemies.length = 0;
        const fl = at('flier', 400);
        fl.x = t.x + 30; fl.y = t.y;
        S.command(s, 0, { c: 'place', t: 'floppy', x: t.x, y: t.y + 60 });
        const fp = lastTower(s);
        t.mode = 'first';
        expect(S.pick(s, t)[0] === fl && !S.pick(s, fp).length, 'a pointer post hits a flier and a floppy launcher cannot');
        expect(TP.TOWERS.filter(x => x.base.air).map(x => x.id).join() === 'pointer,fan,modem,fax,hammer', 'five towers can aim up');
        // armour
        const arm = S.spawn(s, 'armored', 300); arm.hp = arm.max = 1000;
        s.towers.length = 0; s.enemies.length = 0; s.shots.length = 0; s.enemies.push(arm);
        S.command(s, 0, Object.assign({ c: 'place', t: 'pointer' }, near(s, arm)));
        arm.speed = 0;
        for (let i = 0; i < 40; i++) S.step(s);
        const chip = 1000 - arm.hp;
        const per = Math.max(1, TP.TOWERS_BY_ID.pointer.base.dmg - TP.ENEMY_BY_ID.armored.armor);
        expect(chip > 0 && Math.abs(chip / per - Math.round(chip / per)) < 1e-9 && chip <= per * 6, 'armour takes its share off every hit', 'a pointer post did ' + Math.round(chip) + ' in two seconds to a troll in armour');
        const hs = rich(); hs.phase = 'wave';
        const arm2 = S.spawn(hs, 'armored', 300); arm2.hp = arm2.max = 5000; arm2.speed = 0;
        S.command(hs, 0, Object.assign({ c: 'place', t: 'hammer' }, near(hs, arm2)));
        for (let i = 0; i < 30 && arm2.hp === 5000; i++) S.step(hs);
        expect(Math.round(5000 - arm2.hp) === TP.TOWERS_BY_ID.hammer.base.dmg, 'the ban hammer ignores it', Math.round(5000 - arm2.hp) + ' damage');
    }

    // ===============================================================
    section('four seats, one road');
    // ===============================================================
    {
        const seats = [0, 1, 2, 3].map(i => ({ id: 'p' + i, name: 'p' + i }));
        const s = S.newGame({ map: 'outskirts', seed: 3, seats });
        expect(s.seats.every(p => p.gold === TP.coopStart(4)) && TP.coopStart(4) * 4 >= TP.START_CASH, 'four players share a little more than one gets', TP.coopStart(4) + ' each');
        s.seats.forEach(p => { p.gold = 5000; });
        S.command(s, 0, { c: 'place', t: 'pointer', x: 320, y: 220 });
        const t = lastTower(s);
        expect(S.command(s, 1, { c: 'up', i: t.id, p: 0 }) === 'mine' && S.command(s, 1, { c: 'sell', i: t.id }) === 'mine' && S.command(s, 1, { c: 'mode', i: t.id, m: 'last' }) === 'mine' && t.owner === 0,
            'nobody touches somebody else\'s tower');
        const g = s.seats.map(p => p.gold);
        S.pay(s, 100);
        const got = s.seats.map((p, i) => p.gold - g[i]);
        expect(got.every(x => Math.abs(x - 100 * TP.coopIncome(4) / 4) < 1e-6), 'money from trolls and waves is split evenly', got.map(x => x.toFixed(1)).join(' / '));
        S.seatOn(s, 3, false);
        const g2 = s.seats.map(p => p.gold);
        S.pay(s, 90);
        expect(s.seats[3].gold === g2[3] && Math.abs(s.seats[0].gold - g2[0] - 90 * TP.coopIncome(4) / 3) < 1e-6, 'between the players still here');
        S.command(s, 0, { c: 'go' }); S.command(s, 1, { c: 'go' });
        expect(s.phase === 'prep', 'the wave waits until everybody still here says go');
        S.command(s, 2, { c: 'go' });
        expect(s.phase === 'wave', 'and goes when they have');
        const c = S.newGame({ map: 'outskirts', seed: 3, seats });
        c.seats.forEach(p => { p.gold = 5000; });
        S.command(c, 1, { c: 'place', t: 'clip', x: 320, y: 220 });
        const clip = lastTower(c);
        for (let i = 0; i < 2; i++) S.command(c, 1, { c: 'up', i: clip.id, p: 1 });
        c.phase = 'wave'; c.queue = []; c.qi = 0;
        const before = c.seats.map(p => p.gold);
        S.step(c);
        const diff = c.seats.map((p, i) => p.gold - before[i]);
        expect(Math.abs(diff[1] - diff[0] - clip.st.income) < 1e-6, 'a paperclip\'s pay goes to whoever owns it', diff.map(x => Math.round(x)).join(' / '));
        S.command(c, 0, { c: 'go' }); S.command(c, 1, { c: 'go' }); S.command(c, 2, { c: 'go' });
        expect(c.phase === 'prep', 'a player still thinking holds the wave');
        S.seatOn(c, 3, false);
        expect(c.phase === 'wave', 'until they leave, and then it goes');
        // a tower whose owner has gone keeps working
        const d = rich('outskirts', seats);
        S.command(d, 2, { c: 'place', t: 'pointer', x: 220, y: 240 });
        S.seatOn(d, 2, false);
        S.startWave(d);
        for (let i = 0; i < 20 * 25; i++) S.step(d);
        expect(lastTower(d).kills > 0, 'a player who leaves leaves their towers, and they keep shooting', lastTower(d).kills + ' kills since');
        S.seatOn(d, 2, true, 'newcomer', 'newcomer');
        expect(d.seats[2].id === 'newcomer' && S.command(d, 2, { c: 'up', i: lastTower(d).id, p: 0 }) === null, 'and whoever takes the seat takes them over');
    }

    // ===============================================================
    section('the wire');
    // ===============================================================
    {
        const s = S.newGame({ map: 'woods', seed: 11 });
        const bot = S.newBot(S.STRATS.smart, 3);
        let biggest = null, most = 0;
        while (s.phase !== 'won' && s.phase !== 'lost' && s.wave <= 26) {
            S.think(s, 0, bot); S.step(s); s.ev.length = 0;
            if (s.enemies.length > most) { most = s.enemies.length; biggest = JSON.stringify(S.snapshot(s)); }
        }
        const snap = JSON.parse(biggest);
        expect(biggest.length / most <= 24, 'a troll costs a snapshot about twenty bytes', (biggest.length / most).toFixed(1) + ' bytes each, ' + most + ' on the road');
        const towers = JSON.stringify(S.towerList(s)).length;
        // four snapshots a second over the relays, the tower list now and then
        const perSec = biggest.length * 4 + towers * 1.4;
        expect(perSec <= 16 * 1024, 'the worst moment over the relays is well under 16kb a second, for all four of you at once', Math.round(perSec / 1024 * 10) / 10 + 'kb a second');
        // a guest's copy, from the host's snapshot
        const g = S.newGame({ map: 'woods', seed: 11, puppet: true });
        g.wave = s.wave;
        S.applyTowers(g, S.towerList(s));
        S.applySnapshot(g, snap);
        expect(g.enemies.length === snap.e.length / 5 && g.towers.length === s.towers.length, 'a guest builds the same road from it', g.enemies.length + ' trolls and ' + g.towers.length + ' towers');
        const gold0 = g.seats[0].gold, lives0 = g.lives, hp0 = g.enemies.reduce((a, e) => a + e.hp, 0);
        for (let i = 0; i < 40; i++) S.step(g);
        expect(g.seats[0].gold === gold0 && g.lives === lives0 && Math.abs(g.enemies.reduce((a, e) => a + e.hp, 0) - hp0) < 1e-6, 'and on a guest nothing is decided: the towers fire for show and the host says who is hurt');
        // the same seed is the same game
        const play = () => { const t = S.newGame({ map: 'bridge', seed: 77, quiet: true }); const b = S.newBot(S.STRATS.smart, 9); while (t.phase !== 'won' && t.phase !== 'lost') { S.think(t, 0, b); S.step(t); } return t.wave + ':' + t.kills + ':' + Math.round(t.lives); };
        const once = play();
        expect(once === play(), 'a seed is a game: the same one twice ends the same way', once);
    }

    // ===============================================================
    section('what is kept');
    // ===============================================================
    {
        const s = rich();
        S.command(s, 0, { c: 'place', t: 'fax', x: 320, y: 220 });
        S.command(s, 0, { c: 'up', i: lastTower(s).id, p: 1 });
        s.wave = 7; s.lives = 63;
        const save = JSON.parse(JSON.stringify(S.saveOf(s)));
        const r = S.restore(save, {});
        expect(r && r.wave === 7 && r.lives === 63 && r.towers.length === 1 && r.towers[0].b === 1 && r.phase === 'prep', 'a run comes back at the start of the wave it was on, towers and all');
        save.towers.push(['fax', 320, 220, 0, 0, 'first', 1], ['pointer', 600, 60, 3, 3, 'first', 1], ['nope', 500, 500], ['pointer', 'x', 1]);
        const r2 = S.restore(save, {});
        expect(r2 && r2.towers.length === 1, 'and a save somebody has edited cannot stack towers or break the path rule');
        expect(S.restore({ v: 2, map: 'outskirts' }, {}) === null && S.restore('junk', {}) === null && S.restore(null, {}) === null, 'an old grid game\'s run does not come back as this one');
        const old = { crystals: 5, spent: { dmg: 2, gold: 1 }, bestWave: { outskirts: 12, bridge: 3, nowhere: 9 }, unlockedMaps: ['outskirts', 'bridge', 'nowhere'], unlockedTowers: ['archer'], runs: 4, totalKills: 300, cleared: false };
        const m = S.migrateMeta(old);
        expect(m.v === 3 && m.crystals === 5 + (2 + 4) + 3 && m.refunded === 9 && !Object.keys(m.spent).length, 'the old upgrade tree is refunded, every crystal of it', m.crystals + ' crystals');
        expect(m.bestWave.outskirts === 12 && !m.bestWave.nowhere && m.unlockedMaps.join() === 'outskirts,bridge' && m.runs === 4 && m.totalKills === 300, 'and the records and the maps you had are kept');
        expect(JSON.stringify(S.migrateMeta(JSON.parse(JSON.stringify(m)))) === JSON.stringify(m), 'a new save reads back as itself');
        const weird = [null, 'x', 7, [], { crystals: -5, spent: 'x', bestWave: [] }, JSON.parse('{"v":3,"spent":{"dmg":99,"__proto__":3},"crystals":1000}')];
        let broke = null;
        for (const w of weird) { try { const x = S.migrateMeta(w); if (x.crystals < 0 || (x.spent.dmg || 0) > TP.META_BY_ID.dmg.max) broke = JSON.stringify(w); } catch (e) { broke = e.message; } }
        expect(!broke, 'and nothing broken in localStorage breaks the game', broke || '');
        const u = S.unlockedTowers({ bestWave: { outskirts: 9 } });
        expect(u.join() === 'pointer,floppy,fan,cpu,fax', 'towers unlock by the furthest wave reached', u.join());
    }

    const jobs = [];
    const SEEDS = n => Array.from({ length: n }, (_, i) => 101 + i * 17);
    for (const map of TP.MAPS) for (const seed of SEEDS(8)) jobs.push({ label: 'smart', map: map.id, seed, strat: SMART });
    for (const map of TP.MAPS) for (const seed of SEEDS(4)) jobs.push({ label: 'half-meta', map: map.id, seed, strat: SMART, meta: HALF_META });
    for (const map of TP.MAPS) for (const seed of SEEDS(4)) jobs.push({ label: 'full-meta', map: map.id, seed, strat: SMART, meta: FULL_META });
    const REF = 'woods';
    for (const t of TP.TOWERS) for (const p of [0, 1]) for (const seed of SEEDS(6)) jobs.push({ label: 'favour:' + t.id + ':' + p, map: REF, seed, strat: favour(t.id, p), tower: t.id, path: p });
    for (const seed of SEEDS(60)) jobs.push({ label: 'random', map: REF, seed, strat: randomStrat(seed) });
    for (const n of [2, 4]) for (const seed of SEEDS(8)) jobs.push({ label: 'coop' + n, map: REF, seed, strat: SMART, seats: n });
    for (const seed of SEEDS(8)) jobs.push({ label: 'coop4-drop', map: REF, seed, strat: SMART, seats: 4, dropAt: 8 });

    const nWorkers = Math.max(1, Math.min(+process.env.TP_THREADS || Math.max(1, os.cpus().length - 2), 8, jobs.length));
    const results = (await Promise.all(Array.from({ length: nWorkers }, (_, w) => new Promise((res, rej) => {
        const mine = jobs.filter((_, k) => k % nWorkers === w);
        const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: mine } });
        wk.on('message', res); wk.on('error', rej);
    })))).flat();
    const by = label => results.filter(r => r.label === label);
    const jobOf = r => jobs.find(j => j.label === r.label && j.seed === r.seed && j.map === r.map);
    console.log('\n        ' + results.length + ' games of bots on ' + nWorkers + ' threads in ' + Math.round((Date.now() - STARTED) / 1000) + 's');

    // ===============================================================
    section('the difficulty, map by map');
    // ===============================================================
    const rows = {};
    for (const label of ['smart', 'half-meta', 'full-meta']) {
        rows[label] = TP.MAPS.map(m => {
            const rs = by(label).filter(r => r.map === m.id);
            return { map: m.id, win: rs.filter(r => r.won).length / rs.length, wave: mean(rs.map(r => r.cleared)), min: mean(rs.filter(r => r.won).map(r => r.minutes)) };
        });
        if (REPORT) console.log('        ' + label.padEnd(10) + rows[label].map(x => x.map + ' ' + Math.round(x.win * 100) + '% w' + f1(x.wave)).join(' | '));
    }
    const sm = rows.smart, fm = rows['full-meta'], hm = rows['half-meta'];
    expect(sm[0].win >= 0.6, 'a good player wins the first map without a single upgrade', Math.round(sm[0].win * 100) + '% of the smart bot\'s games');
    expect(sm[0].win < 1 || sm[0].wave >= 30, 'and it is still a game', 'mean wave ' + f1(sm[0].wave));
    expect(sm[4].win <= 0.25, 'the last map is out of reach without the upgrades', Math.round(sm[4].win * 100) + '%');
    expect(fm[4].win >= 0.5, 'and within reach with all of them', Math.round(fm[4].win * 100) + '%');
    expect(hm[4].win <= 0.8 || hm[4].wave < 30, 'half of them is not enough to make it easy', Math.round(hm[4].win * 100) + '% with half the tree');
    expect(sm.every((x, i) => !i || x.wave <= sm[i - 1].wave + 1.5), 'each map is harder than the one before it', sm.map(x => f1(x.wave)).join(' > '));
    expect(TP.MAPS.every((m, i) => hm[i].wave >= sm[i].wave - 0.5 && fm[i].wave >= hm[i].wave - 0.5), 'and the crystal upgrades help on every map',
        TP.MAPS.map((m, i) => f1(sm[i].wave) + '/' + f1(hm[i].wave) + '/' + f1(fm[i].wave)).join(' '));
    const winMin = by('smart').filter(r => r.won && r.map === TP.MAPS[0].id).map(r => r.minutes);
    expect(!winMin.length || (mean(winMin) >= 14 && mean(winMin) <= 32), 'a whole run is a sitting, not an evening', f1(mean(winMin)) + ' minutes at 1x');

    // ===============================================================
    section('the difficulty, wave by wave');
    // ===============================================================
    {
        const all = results.filter(r => !r.won && !/coop/.test(r.label));
        const deaths = {};
        all.forEach(r => { deaths[r.wave] = (deaths[r.wave] || 0) + 1; });
        const worst = Object.entries(deaths).sort((a, b) => b[1] - a[1])[0] || ['-', 0];
        if (REPORT) console.log('        where runs end: ' + Object.entries(deaths).map(([w, n]) => w + ':' + n).join(' '));
        expect(worst[1] <= all.length * 0.3, 'no single wave ends most of the runs that end', 'wave ' + worst[0] + ' ended ' + worst[1] + ' of ' + all.length);
        const firstFive = all.filter(r => r.wave <= 5).length;
        expect(firstFive <= all.length * 0.05, 'nobody is thrown out in the first five waves', firstFive + ' runs');
        const leaks = Array.from({ length: TP.TOTAL_WAVES }, (_, w) => mean(by('smart').filter(r => r.map === TP.MAPS[0].id && r.leaks[w] !== undefined).map(r => r.leaks[w])));
        if (REPORT) console.log('        lives lost a wave on the first map: ' + leaks.map(x => Math.round(x)).join(' '));
        expect(leaks.every(x => x <= 40), 'and on the first map no wave takes the lives in one go', 'worst ' + Math.round(Math.max(...leaks)));
    }

    // ===============================================================
    section('every tower and every path earns its place');
    // ===============================================================
    {
        const fav = {};
        for (const t of TP.TOWERS) for (const p of [0, 1]) fav[t.id + ':' + p] = mean(by('favour:' + t.id + ':' + p).map(r => r.score));
        const smartRef = mean(by('smart').filter(r => r.map === REF).map(r => r.score));
        const perTower = TP.TOWERS.map(t => ({ id: t.id, best: Math.max(fav[t.id + ':0'], fav[t.id + ':1']), a: fav[t.id + ':0'], b: fav[t.id + ':1'] }));
        const med = median(perTower.map(x => x.best));
        if (REPORT) {
            console.log('        on ' + REF + ', the smart bot scores ' + f1(smartRef) + '; favouring one tower:');
            perTower.forEach(x => console.log('          ' + x.id.padEnd(9) + ' path a ' + f1(x.a).padStart(5) + '   path b ' + f1(x.b).padStart(5)));
        }
        const strong = perTower.filter(x => x.best > med + 4);
        expect(!strong.length, 'no tower carries a game on its own', strong.map(x => x.id + ' ' + f1(x.best)).join(', ') || 'median ' + f1(med));
        const weak = perTower.filter(x => x.best < med - 4);
        expect(!weak.length, 'and none is dead weight', weak.map(x => x.id + ' ' + f1(x.best)).join(', '));
        const lopsided = perTower.filter(x => Math.abs(x.a - x.b) > 4);
        expect(!lopsided.length, 'both paths of every tower are worth taking', lopsided.map(x => x.id + ' ' + f1(x.a) + ' v ' + f1(x.b)).join(', '));

        // a random plan with the tower in it against one without
        const rnd = by('random');
        const base = mean(rnd.map(r => r.score));
        const delta = TP.TOWERS.map(t => {
            const withIt = rnd.filter(r => jobOf(r).strat.weights[t.id] > 0).map(r => r.score);
            const without = rnd.filter(r => !(jobOf(r).strat.weights[t.id] > 0)).map(r => r.score);
            return { id: t.id, d: mean(withIt) - mean(without), n: withIt.length };
        });
        if (REPORT) console.log('        random plans score ' + f1(base) + '; with each tower minus without: ' + delta.map(x => x.id + ' ' + (x.d >= 0 ? '+' : '') + f1(x.d)).join(', '));
        const bad = delta.filter(x => Math.abs(x.d) > 4.5);
        expect(!bad.length, 'and having one in a random plan neither makes nor breaks it', bad.map(x => x.id + ' ' + f1(x.d)).join(', '));

        // what each tower does for its money, in the smart bot's games. The fan and the
        // paperclip are there for what they do to the others, so they are not on this list
        const dmg = {}, spent = {};
        for (const r of by('smart')) for (const id in r.dmgBy) { dmg[id] = (dmg[id] || 0) + r.dmgBy[id]; spent[id] = (spent[id] || 0) + r.spentBy[id]; }
        const eff = TP.TOWERS.filter(t => t.kind !== 'support' && t.id !== 'fan' && spent[t.id]).map(t => ({ id: t.id, e: dmg[t.id] / spent[t.id] }));
        const me = median(eff.map(x => x.e));
        if (REPORT) console.log('        damage for every dollar: ' + eff.map(x => x.id + ' ' + f1(x.e)).join(', '));
        const off = eff.filter(x => x.e > me * 3 || x.e < me / 3);
        expect(!off.length, 'no tower does three times the damage for its money of another, or a third', off.map(x => x.id + ' ' + f1(x.e) + ' v ' + f1(me)).join(', '));
        const total = Object.values(dmg).reduce((a, b) => a + b, 0);
        const share = TP.TOWERS.map(t => ({ id: t.id, s: (dmg[t.id] || 0) / total })).sort((a, b) => b.s - a.s);
        expect(share[0].s <= 0.35, 'and no tower does most of the work', share.slice(0, 3).map(x => x.id + ' ' + Math.round(x.s * 100) + '%').join(', '));
    }

    // ===============================================================
    section('up to four of you');
    // ===============================================================
    {
        const solo = mean(by('smart').filter(r => r.map === REF).map(r => r.score));
        const c2 = mean(by('coop2').map(r => r.score)), c4 = mean(by('coop4').map(r => r.score)), drop = mean(by('coop4-drop').map(r => r.score));
        if (REPORT) console.log('        on ' + REF + ': one ' + f1(solo) + ', two ' + f1(c2) + ', four ' + f1(c4) + ', four with one walking out at wave 8 ' + f1(drop));
        expect(Math.abs(c2 - solo) <= 3.5, 'two bots together get about as far as one', f1(c2) + ' v ' + f1(solo));
        expect(Math.abs(c4 - solo) <= 3.5, 'and four', f1(c4) + ' v ' + f1(solo));
        expect(drop >= c4 - 4, 'and three, when the fourth leaves halfway, are not stranded by it', f1(drop) + ' v ' + f1(c4));
    }

    console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed') + ' in ' + Math.round((Date.now() - STARTED) / 1000) + 's');
    process.exit(failures ? 1 : 0);
}
