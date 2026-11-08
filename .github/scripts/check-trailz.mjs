// ===================================================================
// check-trailz.mjs — the light cycle rules, the bots, and that it repeats
//
// Three things are held here, in node, on the same files the browser runs:
//
//   the rules     walls, the border, head on crashes, two cycles at one
//                 crossing in one step, your own wall, the turn gap, the
//                 grind, the brake, walls going after a death, points,
//                 and a guest's late turn put back where it was pressed
//   the bots      every level against the others, many rounds of them:
//                 better bots win more, nobody drives into a wall at the
//                 start, and every round ends
//   repeating     the same seed gives the same match, step for step, and
//                 which seat a cycle is in changes nothing about what
//                 happens to it
//
//   node .github/scripts/check-trailz.mjs            the check
//   node .github/scripts/check-trailz.mjs --report   and every number behind it
// ===================================================================
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const REPORT = process.argv.includes('--report');

const load = () => {
    const c = vm.createContext({ console });
    vm.runInContext(read('games/trailz/trailz-data.js'), c);
    vm.runInContext(read('games/trailz/trailz-sim.js'), c);
    return { TZ: c.TZ, S: c.TZ_SIM };
};
const { TZ, S } = load();

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
const near = (a, b, e) => Math.abs(a - b) <= (e === undefined ? 0.05 : e);

// a match with nobody in it yet, and a way to put a cycle where a test wants it
function arena(n, o) {
    const seats = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'p' + i }));
    // a fixed 180 units, whatever the number of seats, so the places below mean the same
    const s = S.newMatch(Object.assign({ seed: 7, seats, size: 180, rounds: 3, quiet: true }, o || {}));
    s.phase = 'race'; s.phaseT = 0;
    return s;
}
function put(s, i, x, z, dir, o) {
    const c = s.cycles[i];
    c.x = x; c.z = z; c.dir = dir; c.pts = [x, z]; c.alive = true; c.speed = TZ.BASE_SPEED; c.q = []; c.lastTurn = -999;
    Object.assign(c, o || {});
    S.rebuildGrid(s);
    return c;
}
// a cycle that is already dead, with a wall through the given points, that does not fade
function wall(s, i, pts) {
    const c = s.cycles[i];
    c.pts = pts.slice(0, -2); c.x = pts[pts.length - 2]; c.z = pts[pts.length - 1];
    c.alive = false; c.deadT = -1e6; c.fade = 1; c.gone = false; c.speed = 0;
    S.rebuildGrid(s);
    return c;
}
const run = (s, n, each) => { for (let k = 0; k < n; k++) { if (each) each(k); S.step(s); } };
const until = (s, cond, cap) => { let k = 0; while (!cond() && k++ < (cap || 2000)) S.step(s); return k; };

// =====================================================================
section('the rules');
// =====================================================================
{
    // the border
    const s = arena(2);
    put(s, 0, s.S - 1, 50, 0);
    put(s, 1, 50, 120, 0);
    const k = until(s, () => !s.cycles[0].alive, 30);
    const c = s.cycles[0];
    expect(!c.alive && c.x < s.S && c.x > s.S - 0.1 && c.cause.by === -1, 'driving into the border is the end, at the border', 'x ' + c.x.toFixed(3) + ' after ' + k + ' steps');
    expect(s.phase === 'end' && s.lastWinner === 1 && s.scores[1] === TZ.POINT_OUTLIVE + TZ.POINT_WIN && s.wins[1] === 1, 'and the other one takes the round: a point for outliving, and the bonus', s.scores.join(','));
}
{
    // somebody else's wall, across your way
    const s = arena(2);
    put(s, 0, 40, 50, 0);
    put(s, 1, 60, 30, 1);
    run(s, 4);
    const k = until(s, () => !s.cycles[0].alive || !s.cycles[1].alive, 200);
    const [a, b] = s.cycles;
    expect(!a.alive && b.alive && a.cause.by === 1 && near(a.x, 60, 0.05) && a.z === 50, 'a cycle that meets a wall stops at it and is out', 'x ' + a.x.toFixed(3) + ', ' + k + ' steps');
    expect(b.alive && s.lastWinner === 1, 'and the one who laid it goes on');
}
{
    // head on
    const s = arena(2);
    put(s, 0, 40, 50, 0);
    put(s, 1, 80, 50, 2);
    until(s, () => !s.cycles[0].alive || !s.cycles[1].alive, 200);
    const [a, b] = s.cycles;
    expect(!a.alive && !b.alive && a.deadAt === b.deadAt && near(a.x, 60, 0.1) && near(b.x, 60, 0.1), 'head on, both go, in the same step, in the middle', a.x.toFixed(2) + ' / ' + b.x.toFixed(2));
    expect(s.phase === 'end' && s.lastWinner === -1 && s.scores.every(v => v === 0), 'and nobody wins that round');
}
// two cycles at one crossing, a fraction of a step apart, in both seat orders
function crossing(lead, swap) {
    // `lead` units: how much nearer the crossing the east-going one starts
    const s = arena(2);
    const east = swap ? 1 : 0, north = swap ? 0 : 1;
    put(s, east, 50 - 10 + lead, 50, 0);
    put(s, north, 50, 60, 3);
    until(s, () => s.phase === 'end', 200);
    return { east: s.cycles[east], north: s.cycles[north] };
}
{
    for (const swap of [false, true]) {
        const tag = swap ? ' (seats swapped)' : '';
        const a = crossing(0.1, swap);
        expect(a.east.alive && !a.north.alive && a.north.cause.by === a.east.i, 'whoever reaches a crossing a third of a step sooner lays the wall there' + tag);
        const b = crossing(-0.1, swap);
        expect(!b.east.alive && b.north.alive, 'and a third of a step later is the one who hits it' + tag);
        const c = crossing(0, swap);
        expect(!c.east.alive && !c.north.alive, 'at the very same instant, both go' + tag);
    }
}
{
    // your own wall
    const s = arena(2);
    put(s, 1, 150, 150, 3);
    const c = put(s, 0, 50, 50, 0);
    run(s, 10); S.turn(s, 0, 1); run(s, 12); S.turn(s, 0, 1); run(s, 6); S.turn(s, 0, 1);
    until(s, () => !c.alive, 300);
    expect(!c.alive && c.cause.by === 0, 'three turns the same way and you meet your own wall', 'out at ' + c.x.toFixed(1) + ',' + c.z.toFixed(1));
}
{
    // the gap between two turns
    const s = arena(2);
    put(s, 1, 150, 150, 3);
    const c = put(s, 0, 50, 50, 0);
    S.turn(s, 0, 1); S.turn(s, 0, 1);
    S.step(s);
    const one = S.turnsOf(c);
    run(s, TZ.TURN_GAP - 2);
    const still = S.turnsOf(c);
    run(s, 2);
    expect(one === 1 && still === 1 && S.turnsOf(c) === 2 && c.dir === 2, 'two turns at once: the second waits for the gap, so a u-turn has width', 'turns ' + one + ', ' + still + ', ' + S.turnsOf(c));
    const width = Math.abs(c.pts[3] - c.pts[5]);
    expect(width >= TZ.TURN_GAP * TZ.BASE_SPEED / TZ.TICK - 0.01, 'and is never thinner than the gap', width.toFixed(2) + ' units');
}
{
    // the grind
    const s = arena(3);
    wall(s, 1, [10, 51, 100, 51]);
    put(s, 2, 30, 150, 0);
    const c = put(s, 0, 20, 50, 0);
    run(s, 100);
    const fast = c.speed;
    expect(fast > TZ.BASE_SPEED * 1.4 && c.alive, 'driving a unit from a wall speeds you up', fast.toFixed(1) + ' units a second after two seconds');
    until(s, () => c.x > 105, 600);
    const at = c.speed;
    run(s, 30);
    expect(c.speed < at && c.speed >= TZ.BASE_SPEED, 'and it wears off once the wall ends', at.toFixed(1) + ' -> ' + c.speed.toFixed(1));
    const s2 = arena(3);
    wall(s2, 1, [10, 56, 160, 56]);
    put(s2, 2, 30, 150, 0);
    const c2 = put(s2, 0, 20, 50, 0);
    run(s2, 120);
    expect(c2.speed === TZ.BASE_SPEED, 'six units away is too far to count', c2.speed.toFixed(2));
    const s3 = arena(3);
    wall(s3, 1, [10, 50.3, 175, 50.3]);
    put(s3, 2, 30, 150, 0);
    const c3 = put(s3, 0, 5, 50, 0);
    let top = 0;
    run(s3, 400, () => { top = Math.max(top, c3.speed); });
    expect(top <= TZ.MAX_SPEED + 1e-9 && top > TZ.MAX_SPEED * 0.9, 'and never past the top speed', top.toFixed(1));
}
{
    // the brake
    const s = arena(2);
    put(s, 1, 150, 150, 3);
    const c = put(s, 0, 20, 50, 0);
    S.brake(s, 0, true);
    run(s, 60);
    const slow = c.speed, fuel = c.fuel;
    expect(near(slow, TZ.BASE_SPEED * TZ.BRAKE_SPEED, 0.01) && fuel < 0.5, 'the brake holds you at half speed and uses itself up', slow.toFixed(1) + ' units a second, ' + Math.round(fuel * 100) + '% left');
    run(s, 120);
    expect(c.fuel === 0 && c.speed > slow, 'until it is empty', c.speed.toFixed(1));
    S.brake(s, 0, false);
    run(s, 120);
    expect(c.fuel > 0.3 && c.speed === TZ.BASE_SPEED, 'and it fills again once you let go', Math.round(c.fuel * 100) + '%, ' + c.speed.toFixed(2) + ' at ' + c.x.toFixed(0) + ', ' + c.alive);
}
{
    // walls going after a death
    const s = arena(3);
    put(s, 2, 150, 20, 1);
    const b = put(s, 1, 60, 30, 1);
    run(s, 60);
    put(s, 0, 30, 40, 0);
    // cycle 1 drives into the border: its wall is still up for a while, then gone
    b.dir = 1; b.z = s.S - 0.1; b.pts = [60, 30];
    S.rebuildGrid(s);
    S.step(s);
    expect(!b.alive, 'a cycle goes out');
    const across = () => S.rayHit(s, 30, 40, 0, 100, null);
    run(s, Math.floor(TZ.WALL_LINGER * TZ.TICK) - 5);
    expect(across().by === 1 && b.fade === 1, 'its wall stays up for a moment', 'blocked at ' + across().d.toFixed(1));
    run(s, Math.ceil(TZ.WALL_FADE * TZ.TICK) + 10);
    expect(b.gone && across().by !== 1, 'then it is gone, and the way is open', 'by ' + across().by);
}
{
    // a match of rounds
    const s = S.newMatch({ seed: 3, seats: [0, 1, 2, 3].map(i => ({ id: 'b' + i, name: 'b' + i, bot: 'normal' })), rounds: 3, quiet: true });
    const bots = s.seats.map((p, i) => S.newBot('normal', 11 + i));
    let deaths = 0, steps = 0;
    const seen = new Set();
    while (s.phase !== 'over' && steps++ < 60 * 60 * 15) {
        for (let i = 0; i < s.n; i++) S.think(s, i, bots[i]);
        const before = s.cycles.filter(c => c.alive).length;
        S.step(s);
        if (s.phase === 'race' || s.phase === 'end') deaths += Math.max(0, before - s.cycles.filter(c => c.alive).length);
        seen.add(s.round);
    }
    expect(s.phase === 'over' && s.round === 3 && seen.size === 3, 'a match is the rounds it was set to, then over', 'round ' + s.round);
    const sum = s.scores.reduce((a, b) => a + b, 0), wins = s.wins.reduce((a, b) => a + b, 0);
    expect(wins <= 3 && sum >= wins * TZ.POINT_WIN && sum <= 3 * (6 + TZ.POINT_WIN), 'and the points add up', 'points ' + s.scores.join(',') + ', wins ' + s.wins.join(','));
}

// =====================================================================
section('a late turn from a guest');
// =====================================================================
{
    const fresh = () => { const s = arena(2); put(s, 1, 150, 150, 3); const c = put(s, 0, 50, 50, 0); run(s, 20); return { s, c }; };
    {
        const { s, c } = fresh();
        const was = c.x;
        const r = S.turnAt(s, 0, 1, 54, 0);
        expect(r === 'rewound' && near(c.pts[2], 54, 1e-6) && c.pts[3] === 50 && c.dir === 1 && near(c.x, 54, 1e-6) && near(c.z, 50 + (was - 54), 1e-6),
            'put back where the guest pressed it, and on the new way as far as it went', r + ' at ' + c.pts[2].toFixed(2) + ', now ' + c.x.toFixed(2) + ',' + c.z.toFixed(2));
    }
    {
        const { s, c } = fresh();
        const r = S.turnAt(s, 0, 1, 40, 0);
        expect(r === 'clamped' && c.pts[2] > 50 && c.pts[2] < 50.01, 'never further back than its last turn', r + ' at ' + c.pts[2].toFixed(3));
    }
    {
        const { s, c } = fresh();
        run(s, 40);
        const was = c.x;
        S.turnAt(s, 0, 1, was - 20, 0);
        const back = was - c.pts[2];
        expect(near(back, TZ.REWIND * c.speed, 0.01), 'and no more than half a second of driving', back.toFixed(2) + ' units');
    }
    {
        const { s, c } = fresh();
        // somebody died against the line at x = 55: the turn can not go back past that
        put(s, 1, 55, 60, 3, { speed: TZ.BASE_SPEED });
        until(s, () => !s.cycles[1].alive, 60);
        expect(!s.cycles[1].alive && s.cycles[1].cause.by === 0 && near(c.killMark, 55, 0.01), 'a wall that killed somebody is pinned there', 'killMark ' + c.killMark);
        // and a third seat keeps the round going
    }
    {
        const s = arena(3); put(s, 2, 150, 20, 1); put(s, 1, 150, 150, 3); const c = put(s, 0, 50, 50, 0); run(s, 20);
        put(s, 1, 55, 60, 3);
        until(s, () => !s.cycles[1].alive, 60);
        run(s, 3);
        const r = S.turnAt(s, 0, 1, 53, 0);
        expect(c.pts[2] >= 55.04 && r === 'clamped', 'so a late turn lands after it, not before', r + ' at ' + c.pts[2].toFixed(2));
    }
    {
        const { s, c } = fresh();
        const r = S.turnAt(s, 0, -1, c.x + 1.2, 0);
        expect(r === 'ahead', 'a guest a little ahead of the host gets its turn where it pressed');
        until(s, () => S.turnsOf(c) === 1, 30);
        expect(near(c.pts[2], 57.2 - (57.2 - c.pts[2]), 1e-9) && near(c.pts[2], 50 + 20 * TZ.BASE_SPEED / TZ.TICK + 1.2, 1e-6) && c.dir === 3, 'right on the spot', c.pts[2].toFixed(3));
    }
    {
        const { s, c } = fresh();
        // a wall just round the corner: the late turn is checked against what is up now
        wall(s, 1, [40, 51.5, 70, 51.5]);
        const r = S.turnAt(s, 0, 1, 54, 0);
        expect(r === 'crashed' && !c.alive && c.z < 52, 'a late turn into a wall is still a crash', r);
    }
    {
        const { s, c } = fresh();
        S.turnAt(s, 0, 1, 54, 3);
        S.step(s);
        expect(S.turnsOf(c) === 1 && c.pts[2] > 55, 'a turn that names the wrong line just happens now');
    }
}

// =====================================================================
section('which seat changes nothing');
// =====================================================================
{
    // random little scenes, each played with the seats in a different order: every cycle
    // has to end up the same, whatever number it is
    const rnd = S.rng(99);
    let same = 0, total = 0, deaths = 0;
    for (let scene = 0; scene < 300; scene++) {
        const n = 2 + Math.floor(rnd() * 3);
        const roles = [];
        for (let j = 0; j < n; j++) {
            // all on the coarse lattice of a 10 unit grid, so lines line up and crossings tie
            roles.push({ x: 40 + Math.floor(rnd() * 10) * 10, z: 40 + Math.floor(rnd() * 10) * 10, dir: Math.floor(rnd() * 4),
                turns: Array.from({ length: 4 }, () => [Math.floor(rnd() * 120), rnd() < 0.5 ? 1 : -1]) });
        }
        const play = perm => {
            const s = arena(n);
            roles.forEach((r, j) => put(s, perm[j], r.x, r.z, r.dir));
            for (let t = 0; t < 240 && s.phase === 'race'; t++) {
                roles.forEach((r, j) => r.turns.forEach(([at, d]) => { if (at === t) S.turn(s, perm[j], d); }));
                S.step(s);
            }
            return roles.map((r, j) => { const c = s.cycles[perm[j]]; return [c.alive, c.deadAt, c.x.toFixed(5), c.z.toFixed(5), c.pts.length].join(); });
        };
        const id = roles.map((_, j) => j), rev = id.slice().reverse();
        const a = play(id), b = play(rev);
        total++;
        if (a.join('|') === b.join('|')) same++;
        else if (REPORT) console.log('        differs: ' + JSON.stringify(roles) + '\n          ' + a.join(' / ') + '\n          ' + b.join(' / '));
        deaths += a.filter(x => x.startsWith('false')).length;
    }
    expect(same === total && deaths > total, 'three hundred little crashes come out the same with the seats reversed', same + ' of ' + total + ' scenes, ' + deaths + ' cycles out');
}

// =====================================================================
section('the same seed, the same match');
// =====================================================================
function botMatch(R, o) {
    const seats = o.levels.map((lv, i) => ({ id: 'b' + i, name: lv + i, bot: lv }));
    const s = R.S.newMatch({ seed: o.seed, seats, arena: o.arena || 'medium', rounds: o.rounds || 1, quiet: true });
    const bots = seats.map((p, i) => R.S.newBot(p.bot, o.seed * 7 + i));
    const marks = [];
    const rounds = [];
    let steps = 0, roundStart = 0, curRound = s.round, early = 0;
    while (s.phase !== 'over' && steps++ < 60 * 60 * 30) {
        for (let i = 0; i < s.n; i++) R.S.think(s, i, bots[i]);
        const was = s.cycles.map(c => c.alive);
        R.S.step(s);
        if (s.phase === 'race' || s.phase === 'end') s.cycles.forEach((c, i) => { if (was[i] && !c.alive && s.raceT < 3 * R.TZ.TICK) early++; });
        if (o.marks && steps % 600 === 0) marks.push(R.S.hash(s));
        if (s.phase === 'end' && s.phaseT === 1) rounds.push({ len: s.raceT / R.TZ.TICK, winner: s.lastWinner, places: s.cycles.map(c => c.place) });
        if (s.round !== curRound) { curRound = s.round; roundStart = steps; }
    }
    return { s, marks, hash: R.S.hash(s), rounds, early, steps };
}
{
    const A = botMatch(load(), { seed: 1234, levels: ['hard', 'normal', 'easy', 'hard', 'normal', 'easy'], rounds: 3, marks: true });
    const B = botMatch(load(), { seed: 1234, levels: ['hard', 'normal', 'easy', 'hard', 'normal', 'easy'], rounds: 3, marks: true });
    const C = botMatch(load(), { seed: 1235, levels: ['hard', 'normal', 'easy', 'hard', 'normal', 'easy'], rounds: 3, marks: true });
    expect(A.hash === B.hash && A.marks.join() === B.marks.join() && A.marks.length > 5, 'two runs of one seed, in two fresh copies of the sim, match every ten seconds and at the end', A.marks.length + ' marks, ' + A.hash);
    expect(A.hash !== C.hash, 'and another seed is another match');
    expect(A.s.scores.join() === B.s.scores.join(), 'down to the points', A.s.scores.join(','));
}

// =====================================================================
section('the bots');
// =====================================================================
{
    const t0 = Date.now();
    const duel = (a, b, n, arena) => {
        let wa = 0, wb = 0, len = 0, rounds = 0, early = 0;
        for (let k = 0; k < n; k++) {
            // both sides of the arena, so neither start is the better one
            const flip = k % 2 === 1;
            const r = botMatch({ TZ, S }, { seed: 500 + k, levels: flip ? [b, a] : [a, b], rounds: 3, arena });
            for (const x of r.rounds) {
                rounds++; len += x.len;
                if (x.winner === (flip ? 1 : 0)) wa++; else if (x.winner === (flip ? 0 : 1)) wb++;
            }
            early += r.early;
        }
        return { wa, wb, rounds, len: len / Math.max(1, rounds), early };
    };
    const N = 24;
    const he = duel('hard', 'easy', N), hn = duel('hard', 'normal', N), ne = duel('normal', 'easy', N);
    const rate = d => d.wa / Math.max(1, d.wa + d.wb);
    expect(rate(he) >= 0.62, 'hard beats easy, mostly', he.wa + '-' + he.wb + ' over ' + he.rounds + ', rounds of ' + he.len.toFixed(1) + 's');
    expect(rate(ne) >= 0.55, 'normal beats easy, more often than not', ne.wa + '-' + ne.wb + ', rounds of ' + ne.len.toFixed(1) + 's');
    expect(rate(hn) >= 0.7, 'hard beats normal, most of the time', hn.wa + '-' + hn.wb + ', rounds of ' + hn.len.toFixed(1) + 's');
    const hh = duel('hard', 'hard', 8, 'large');
    expect(hh.len > 15 && hh.len < 200, 'two hard bots make a round of it, and it still ends', hh.len.toFixed(1) + 's a round on the large arena');

    // eight of them, every level, points over many rounds
    const pts = { easy: 0, normal: 0, hard: 0 }, n8 = 16;
    let len8 = 0, rounds8 = 0, early8 = 0, longest = 0;
    for (let k = 0; k < n8; k++) {
        const order = ['easy', 'normal', 'hard', 'easy', 'normal', 'hard', 'normal', 'hard'];
        // turned round each time, so every level gets every start
        const levels = order.map((_, i) => order[(i + k) % order.length]);
        const r = botMatch({ TZ, S }, { seed: 900 + k, levels, rounds: 3, arena: 'large' });
        levels.forEach((lv, i) => { pts[lv] += r.s.scores[i] / levels.filter(x => x === lv).length; });
        for (const x of r.rounds) { len8 += x.len; rounds8++; longest = Math.max(longest, x.len); }
        early8 += r.early;
    }
    const per = v => (v / n8).toFixed(2);
    expect(pts.hard > pts.easy * 1.25 && pts.normal > pts.easy * 1.25 && pts.hard > pts.normal * 0.9, 'eight at once: easy scores least by far; hard and normal close, eight is a crowd', 'points a round: hard ' + per(pts.hard) + ', normal ' + per(pts.normal) + ', easy ' + per(pts.easy));
    expect(longest < 180, 'and every round of eight ends', 'longest ' + longest.toFixed(1) + 's, average ' + (len8 / rounds8).toFixed(1) + 's');
    const allEarly = he.early + hn.early + ne.early + hh.early + early8;
    expect(allEarly <= 4, 'almost nobody crashes in the first three seconds of a round', allEarly + ' times in ' + (he.rounds + hn.rounds + ne.rounds + hh.rounds + rounds8) + ' rounds');
    if (REPORT) console.log('        the bots took ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
}

// =====================================================================
section('the wire');
// =====================================================================
{
    const seats = Array.from({ length: 8 }, (_, i) => ({ id: 'b' + i, name: 'bot' + i, bot: ['hard', 'normal', 'easy'][i % 3] }));
    const host = S.newMatch({ seed: 77, seats, arena: 'large', rounds: 3 });
    const bots = seats.map((p, i) => S.newBot(p.bot, 70 + i));
    const guest = S.newMatch({ seed: 77, seats, arena: 'large', rounds: 3, puppet: true });
    let biggest = 0, total = 0, count = 0, holes = 0, full = 0;
    let drift = 0, wallDrift = 0;
    for (let t = 0; t < 60 * 40 && host.phase !== 'over'; t++) {
        for (let i = 0; i < host.n; i++) S.think(host, i, bots[i]);
        S.step(host);
        if (t % 10 === 0) {
            const d = S.snapshot(host);
            const bytes = JSON.stringify(d).length;
            biggest = Math.max(biggest, bytes); total += bytes; count++;
            // the guest misses one in four, the way a relay might
            if ((t / 10) % 4 === 3) continue;
            if (S.applySnapshot(guest, JSON.parse(JSON.stringify(d)))) {
                holes++;
                const f = S.snapshot(host, { full: true });
                full = Math.max(full, JSON.stringify(f).length);
                S.applySnapshot(guest, JSON.parse(JSON.stringify(f)));
            }
            host.cycles.forEach((c, i) => {
                const g = guest.cycles[i];
                drift = Math.max(drift, Math.abs(g.x - c.x) + Math.abs(g.z - c.z));
                if (g.pts.length !== c.pts.length) wallDrift = Math.max(wallDrift, 99);
                else for (let k = 0; k < c.pts.length; k++) wallDrift = Math.max(wallDrift, Math.abs(g.pts[k] - c.pts[k]));
            });
        }
    }
    expect(biggest < 900 && total / count < 600, 'eight cycles fit in a small snapshot', 'average ' + Math.round(total / count) + ' bytes, at most ' + biggest);
    expect(drift < 0.011 && wallDrift < 0.011, 'and a guest that misses a quarter of them still has every wall where the host has it', 'off by ' + wallDrift.toFixed(3) + ', ' + holes + ' times it asked for the lot (' + full + ' bytes)');
    // a seat list, both ways
    const g2 = S.newMatch({ seed: 1, seats: seats.map(p => ({ id: p.id, name: p.name })), arena: 'large' });
    host.seats[2].on = true; host.seats[2].bot = null; host.seats[2].name = 'ana';
    S.applySeats(g2, JSON.parse(JSON.stringify(S.seatList(host))));
    expect(g2.seats[2].name === 'ana' && !g2.seats[2].bot && g2.seats[1].bot === 'normal', 'and the seats go across too');
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' trailz checks FAILED' : checks + ' trailz checks passed'));
process.exit(failures ? 1 : 0);
