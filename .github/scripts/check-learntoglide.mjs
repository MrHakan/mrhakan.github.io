// ===================================================================
// check-learntoglide.mjs - learn to glide 98's rules, under node
//
//   the shop      tiers get better and dearer, buying spends exactly the
//                 price, nothing past the top tier, nothing after the season
//   the save      whatever is in storage comes back as a sane game or nothing
//   the physics   ramps launch faster with every tier, a run is the same run
//                 twice, nothing goes NaN under random hands, stalls slow you
//   progression   more upgrades fly farther, the wall needs flying and money,
//                 the maxed pilot breaks it on every seed
//   seasons       hundreds of seeded seasons with the planned shopper and the
//                 pilot, and with random hands, all end inside 30 days with a
//                 valid result
//
//   node .github/scripts/check-learntoglide.mjs   (--report for numbers)
// ===================================================================
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
require(path.join(ROOT, 'games/learn-to-glide/learn-to-glide-sim.js'));
const S = globalThis.LTG_SIM;
const REPORT = process.argv.includes('--report');

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
const levelsAt = t => ({ ramp: t, sled: t, glider: t, rocket: t, payload: t });
const finite = r => [r.x, r.y, r.vx, r.vy, r.pitch, r.fuel, r.maxAlt, r.topSpeed].every(Number.isFinite);

// ------------------------------------------------------------------
section('the shop');
for (const u of S.UPGRADES) {
    expect(u.tiers.length === S.TOP + 1 && u.cost.length === S.TOP + 1 && u.cost[0] === 0, u.key + ': five tiers, the first free');
    expect(u.cost.every((c, i) => i === 0 || c > u.cost[i - 1]), u.key + ': each tier costs more than the last', u.cost.join(' '));
}
{
    let better = true;
    for (let t = 0; t < S.TOP; t++) {
        const a = S.stats(levelsAt(t)), b = S.stats(levelsAt(t + 1));
        if (!(b.rampH > a.rampH && b.mu < a.mu && b.lift > a.lift && b.cd0 < a.cd0 && b.thrust > a.thrust && b.fuel > a.fuel && b.payload > a.payload)) better = false;
    }
    expect(better, 'every stat improves with every tier');
    expect(S.stats(S.freshLevels()).thrust === 0, 'a new penguin has no rockets');
    const junk = S.stats({ ramp: 99, sled: -3, glider: 'x', rocket: 2.5 });
    expect(junk.rampH === S.stats(levelsAt(4)).rampH && junk.mu === S.stats(levelsAt(0)).mu && junk.thrust === 0, 'stats clamp nonsense levels');
}
{
    const g = S.newGame(5);
    expect(!S.buy(g, 'glider'), 'no cash, no glider');
    g.money = 1000;
    const p = S.price(g, 'glider');
    expect(S.buy(g, 'glider') && g.money === 1000 - p && g.levels.glider === 1, 'buying spends exactly the price', p);
    expect(!S.buy(g, 'unicorn') && g.money === 1000 - p, 'an unknown upgrade buys nothing');
    g.money = 1e7;
    let n = 0; while (S.buy(g, 'rocket')) n++;
    expect(g.levels.rocket === S.TOP && n === S.TOP && S.price(g, 'rocket') === Infinity, 'nothing past the top tier');
    g.over = true;
    expect(!S.buy(g, 'ramp'), 'nothing for sale after the season');
}

// ------------------------------------------------------------------
section('the save');
{
    expect(S.restore(null) === null && S.restore('x') === null && S.restore(42) === null, 'non-objects are not a save');
    const g = S.restore({ seed: 7, day: 999, money: -5, levels: { ramp: 9, sled: -1, glider: 2.5, rocket: '3', payload: 2 }, won: 'yes', best: { distance: NaN, speed: 12 } });
    expect(g.day === S.MAX_DAYS && g.over && !g.won, 'too many days ends the season, a string is not a win');
    expect(g.money === 0 && g.levels.ramp === S.TOP && g.levels.sled === 0 && g.levels.glider === 0 && g.levels.rocket === 0 && g.levels.payload === 2, 'cash and levels are clamped and typed', JSON.stringify(g.levels));
    expect(g.best.distance === 0 && g.best.speed === 12, 'records are numbers or zero');
    const w = S.restore({ seed: 1, day: 9, won: true, wonDay: 9, money: 50 });
    expect(w.won && w.wonDay === 9 && w.over, 'a won season stays won');
    const real = S.newGame(77); real.money = 333; real.levels.glider = 2; real.day = 4;
    const back = S.restore(JSON.parse(JSON.stringify(real)));
    expect(JSON.stringify(back) === JSON.stringify(real), 'a real save round-trips exactly');
}

// ------------------------------------------------------------------
section('the physics');
{
    const launchSpeed = lv => { const g = S.newGame(1); const r = S.startRun(g, lv); let v = 0; while (r.phase === 'ramp') { S.step(r, null); if (r.events.length) v = r.events[0].speed; } return v; };
    let up = true, prev = 0;
    for (let t = 0; t <= S.TOP; t++) { const v = launchSpeed({ ...S.freshLevels(), ramp: t }); if (!(v > prev)) up = false; prev = v; }
    expect(up, 'every ramp tier launches faster', prev.toFixed(1) + ' m/s at the top');
    up = true; prev = 0;
    for (let t = 0; t <= S.TOP; t++) { const v = launchSpeed({ ...S.freshLevels(), ramp: 2, sled: t }); if (!(v > prev)) up = false; prev = v; }
    expect(up, 'every sled tier launches faster');

    const g = S.newGame(1234);
    const a = S.simulate(g, S.autopilot, levelsAt(3)), b = S.simulate(g, S.autopilot, levelsAt(3));
    expect(a.ticks === b.ticks && a.x === b.x && a.y === b.y && a.popped === b.popped, 'the same day flown the same way is the same run, to the bit', a.x.toFixed(3));
    const c1 = S.course(9, 3), c2 = S.course(9, 3), c3 = S.course(9, 4);
    expect(JSON.stringify(c1) === JSON.stringify(c2) && JSON.stringify(c1) !== JSON.stringify(c3), 'each day has its own sky, the same for the same seed');
    expect(c1.balloons.every(b => b.x > 0 && b.x < S.WALL_X && b.y > 0) && c1.clouds.every(c => c.x > 0 && c.x + c.w < S.WALL_X), 'balloons and clouds sit between the cliff and the wall');

    // random hands never break the numbers and always end
    let okRuns = 0, ended = 0, worst = 0;
    for (let i = 0; i < 300; i++) {
        const rnd = S.rng(i * 31 + 7);
        const gg = S.newGame(i + 1); gg.day = i % 25;
        const lv = { ramp: Math.floor(rnd() * 5), sled: Math.floor(rnd() * 5), glider: Math.floor(rnd() * 5), rocket: Math.floor(rnd() * 5), payload: Math.floor(rnd() * 5) };
        const r = S.startRun(gg, lv);
        let fine = true, hold = { pitch: 0, boost: false };
        while (!r.done) {
            if (r.ticks % 20 === 0) hold = { pitch: Math.floor(rnd() * 3) - 1, boost: rnd() < 0.5 };
            S.step(r, hold); r.events.length = 0;
            if (!finite(r) || r.fuel < 0 || r.ticks > S.RUN_LIMIT * S.HZ + 1) { fine = false; break; }
        }
        if (fine) okRuns++;
        if (r.done && ['stopped', 'splat', 'cliff', 'bonk', 'wall', 'timeout'].includes(r.result)) ended++;
        worst = Math.max(worst, r.t);
        if (S.earnings(r) < 0 || !Number.isInteger(S.earnings(r))) fine = false;
    }
    expect(okRuns === 300, '300 runs with random hands stay finite, fuel never negative', okRuns);
    expect(ended === 300, 'and every one ends with a known result', 'longest ' + worst.toFixed(1) + ' s');

    // nose straight up with no rockets: the wing stalls and the penguin slows
    const st = S.newGame(3); const r = S.startRun(st, levelsAt(2));
    while (r.phase === 'ramp') S.step(r, null);
    const v0 = Math.hypot(r.vx, r.vy);
    for (let i = 0; i < 60; i++) S.step(r, { pitch: 1, boost: false });
    expect(Math.hypot(r.vx, r.vy) < v0, 'pulling up hard bleeds speed', v0.toFixed(1) + ' -> ' + Math.hypot(r.vx, r.vy).toFixed(1));
    expect(Math.abs(S.liftCurve(0.5)) < Math.abs(S.liftCurve(0.3)), 'past the stall angle there is less lift');
    // rockets only while fuel lasts
    const rk = S.startRun(st, levelsAt(4));
    while (rk.phase === 'ramp') S.step(rk, null);
    let burnt = 0; while (!rk.done && rk.fuel > 0 && burnt < 2000) { S.step(rk, { pitch: 0, boost: true }); burnt++; }
    expect(Math.abs(burnt / S.HZ - S.stats(levelsAt(4)).fuel) < 0.05, 'a full tank burns for its rated seconds', (burnt / S.HZ).toFixed(2));
    S.step(rk, { pitch: 0, boost: true });
    expect(!rk.boosting, 'an empty tank gives no thrust');
}

// ------------------------------------------------------------------
section('progression');
{
    const dist = [], seeds = 20;
    for (let t = 0; t <= S.TOP; t++) {
        let sum = 0;
        for (let s = 1; s <= seeds; s++) sum += Math.max(0, S.simulate(S.newGame(s), S.autopilot, levelsAt(t)).x);
        dist.push(sum / seeds);
    }
    expect(dist.every((d, i) => i === 0 || d > dist[i - 1] || d >= S.WALL_X), 'every tier of everything flies farther (mean of ' + seeds + ' seeds)', dist.map(d => d.toFixed(0)).join(' < '));
    // each upgrade alone helps the pilot (payload pays, it does not fly)
    for (const k of ['ramp', 'sled', 'glider', 'rocket']) {
        const base = { ramp: 1, sled: 1, glider: 1, rocket: 1, payload: 0 };
        const out = [];
        for (let t = 1; t <= S.TOP; t++) {
            let sum = 0;
            for (let s = 1; s <= seeds; s++) sum += Math.max(0, S.simulate(S.newGame(s), S.autopilot, { ...base, [k]: t }).x);
            out.push(sum / seeds);
        }
        expect(out.every((d, i) => i === 0 || d > out[i - 1] * 0.98), k + ': each tier flies at least as far', out.map(d => d.toFixed(0)).join(' '));
    }
    {
        const g = S.newGame(3);
        const lo = S.simulate(g, S.autopilot, { ...levelsAt(2), payload: 0 }), hi = S.simulate(g, S.autopilot, { ...levelsAt(2), payload: 4 });
        expect(lo.x === hi.x && S.earnings(hi) > S.earnings(lo) * 2.5, 'payload pays more for the same flight', S.earnings(lo) + ' -> ' + S.earnings(hi));
    }
    let broke = 0, idle = 0, bare = 0, impacts = [];
    for (let s = 1; s <= 60; s++) {
        const g = S.newGame(s * 7919); g.day = s % S.MAX_DAYS;
        const r = S.simulate(g, S.autopilot, levelsAt(4));
        if (r.broke) { broke++; impacts.push(r.impact); }
        if (S.simulate(g, null, levelsAt(4)).broke) idle++;
        if (S.simulate(g, S.autopilot, levelsAt(0)).x > 200) bare++;
    }
    expect(broke === 60, 'a maxed hangar and the scripted pilot break the wall on every seed', broke + '/60, slowest ' + Math.min(...impacts).toFixed(1) + ' m/s');
    expect(idle === 0, 'a maxed hangar with nobody steering never does: the wall needs flying');
    expect(bare === 0, 'day one with nothing goes nowhere near it');
}

// ------------------------------------------------------------------
section('seasons');
{
    const days = [], N = 200;
    let valid = 0, won = 0;
    for (let s = 1; s <= N; s++) {
        const g = S.newGame(s * 2654435761 >>> 0);
        let guard = 0, okSeason = true, prevMoney = 0;
        while (!g.over && guard++ < 100) {
            S.shopper(g);
            if (g.money < 0) okSeason = false;
            const r = S.simulate(g, S.autopilot);
            prevMoney = g.money;
            const rep = S.finishRun(g, r);
            if (!rep || rep.earned <= 0 || g.money !== prevMoney + rep.earned || rep.day !== g.day) okSeason = false;
        }
        if (okSeason && g.over && g.day <= S.MAX_DAYS && S.finishRun(g, S.simulate(g, S.autopilot)) === null) valid++;
        if (g.won) { won++; days.push(g.wonDay); }
    }
    days.sort((a, b) => a - b);
    const med = days[days.length >> 1];
    expect(valid === N, N + ' planned seasons end inside ' + S.MAX_DAYS + ' days with consistent books', valid);
    expect(won === N, 'the planned shopper with the scripted pilot wins every one', won + '/' + N);
    expect(med >= 9 && med <= S.RANKS[0].days, 'and needs about a gold medal of days, not fewer', 'median ' + med + ', range ' + days[0] + '-' + days[days.length - 1]);

    // careless seasons: random buys, random hands
    let ends = 0, careless = 0;
    for (let s = 1; s <= 150; s++) {
        const rnd = S.rng(s * 977);
        const g = S.newGame(s);
        let guard = 0;
        while (!g.over && guard++ < 100) {
            for (let k = 0; k < 3; k++) S.buy(g, S.UPGRADES[Math.floor(rnd() * 5)].key);
            const r = S.startRun(g); let hold = { pitch: 0, boost: false };
            while (!r.done) { if (r.ticks % 30 === 0) hold = { pitch: Math.floor(rnd() * 3) - 1, boost: rnd() < 0.3 }; S.step(r, hold); r.events.length = 0; }
            S.finishRun(g, r);
        }
        if (g.over && g.day <= S.MAX_DAYS && g.money >= 0 && (g.won ? g.wonDay >= 1 : g.day === S.MAX_DAYS)) ends++;
        if (g.won) careless++;
    }
    expect(ends === 150, '150 careless seasons all end with a valid result', careless + ' of them won anyway');
    expect(S.rank(5) === 'gold' && S.rank(S.RANKS[0].days + 1) === 'silver' && S.rank(S.MAX_DAYS) === 'bronze' && S.rank(S.MAX_DAYS + 1) === 'none', 'medals by days used');
    if (REPORT) console.log('  days to win:', days.join(','));
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' learntoglide checks FAILED' : checks + ' learntoglide checks passed'));
process.exit(failures ? 1 : 0);
