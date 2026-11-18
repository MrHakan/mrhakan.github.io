// ===================================================================
// check-lavatide.mjs — lava & tide 98's rules, under node
//
//   the levels     well formed, twelve or more, each one solved by replaying
//                  its scripted solution: both in their doors, every gem,
//                  inside par, and the same frame count every time
//   the bodies     run, jump as high and as far as the levels assume, never
//                  end up inside a wall, step out of a pool
//   the hazards    lava dies in water, tide in lava, both in goo
//   the things     plates hold, levers flip like light switches, gates move
//                  and stop for what is under them, boxes push and press
//   the wire       a snapshot puts the same world on a guest's screen, and
//                  junk is refused
//   the fuzz       thousands of seeded random key runs on every level always
//                  end with a sane world
//
//   node .github/scripts/check-lavatide.mjs
// ===================================================================
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
require(path.join(ROOT, 'games/lava-tide/lavatide-sim.js'));
const S = globalThis.LT_SIM;
const { T, COLS, ROWS, LEFT, RIGHT, UP } = S;

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
// a tiny level built from a map, for the rules tests
let custom = 0;
function lab(rows, objs) {
    const lv = S.LEVELS.length;
    rows = rows.slice();
    // somewhere for the doors, out of the way, when the test is not about them
    if (!rows.join('').includes('F')) rows[1] = rows[1].slice(0, 24) + 'F' + rows[1].slice(25);
    if (!rows.join('').includes('T')) rows[1] = rows[1].slice(0, 25) + 'T' + rows[1].slice(26);
    S.LEVELS.push({ name: 'lab ' + (++custom), par: 99, map: rows, objs: objs || [], sol: { f: [], t: [] } });
    return lv;
}
const run = (s, n, a, b) => { for (let i = 0; i < n; i++) S.step(s, typeof a === 'function' ? a(s, i) : a || 0, typeof b === 'function' ? b(s, i) : b || 0); return s; };
const inWall = (s, c) => {
    const x0 = Math.floor(c.x / T), x1 = Math.floor((c.x + c.w - 1e-6) / T), y0 = Math.floor(c.y / T), y1 = Math.floor((c.y + c.h - 1e-6) / T);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (y < 0 || x < 0 || y >= ROWS || x >= COLS) return true; if (s.B.grid[y][x] === 1) return true; }
    return false;
};
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const REAL = S.LEVELS.length;
const A = '#' + '.'.repeat(26) + '#', WALLS = '#'.repeat(28);
const open = (feet, floor, extra) => {
    const rows = [WALLS]; for (let i = 1; i < 17; i++) rows.push(A);
    rows.push(feet); rows.push(floor || WALLS); rows.push(WALLS);
    if (extra) extra(rows);
    return rows;
};

// ===================================================================
section('the levels');
// ===================================================================
expect(REAL >= 12, 'twelve hand-made levels or more', REAL);
for (let lv = 0; lv < REAL; lv++) {
    const L = S.LEVELS[lv];
    const shape = L.map.length === ROWS && L.map.every(r => r.length === COLS && /^[#.LWGrbFTft]+$/.test(r));
    const s = S.newLevel(lv, 1);
    const border = L.map[0] === WALLS && L.map[ROWS - 1] === WALLS && L.map.every(r => r[0] === '#' && r[COLS - 1] === '#');
    const one = ch => L.map.join('').split(ch).length - 1 === 1;
    expect(shape && border && ['F', 'T', 'f', 't'].every(one) && L.name && L.hint && L.par > 0, `level ${lv + 1} "${L.name}" is well formed: walled in, two starts, two doors, a par`);
    expect(s.gems.some(g => g.k === 0) && s.gems.some(g => g.k === 1), `  and has gems for both`, s.gems.length);
}

// ===================================================================
section('every level, solved by replaying its script');
// ===================================================================
const solves = [];
for (let lv = 0; lv < REAL; lv++) {
    const go = () => {
        const s = S.newLevel(lv, 7), ap = S.autopilot(lv);
        let clean = true;
        while (s.ph === 'play' && s.t < 60 * 180) {
            const k = ap.keys(s); S.step(s, k[0], k[1]);
            if (s.chars.some(c => !c.dead && inWall(s, c))) clean = false;
        }
        return { s, clean, done: ap.a.i >= ap.a.steps.length && ap.b.i >= ap.b.steps.length };
    };
    const r1 = go(), r2 = go();
    const s = r1.s;
    solves.push(s.endT);
    expect(s.ph === 'won' && r1.done, `level ${lv + 1}: both reach their doors`, `${(s.endT / 60).toFixed(1)}s, par ${S.LEVELS[lv].par}s`);
    expect(S.gemCount(s) === s.gems.length && S.rank(s) === 'A', `  with every gem, inside par: an A is possible`, `${S.gemCount(s)}/${s.gems.length} ${S.rank(s)}`);
    expect(r1.clean, '  and nobody is ever inside a wall on the way');
    expect(r2.s.endT === s.endT && JSON.stringify(S.snapshot(r2.s)) === JSON.stringify(S.snapshot(s)), '  the same replay gives the same frame, every time');
}
expect(solves[REAL - 1] > solves[0], 'the last level takes longer than the first', solves.map(t => (t / 60).toFixed(0)).join(' '));

// ===================================================================
section('running and jumping');
// ===================================================================
{
    const lv = lab(open('#.f.t......................#'));
    const s = S.newLevel(lv);
    const x0 = s.chars[0].x;
    run(s, 30, RIGHT);
    expect(Math.abs(s.chars[0].x - x0 - 30 * S.RUN) < 1e-9, 'right runs at RUN a step', (s.chars[0].x - x0).toFixed(2));
    run(s, 10, LEFT);
    expect(s.chars[0].face === -1, 'and left turns you round');
    const y0 = s.chars[0].y;
    let top = y0, air = 0;
    S.step(s, UP, 0);
    while (!s.chars[0].g) { S.step(s, 0, 0); top = Math.min(top, s.chars[0].y); air++; }
    expect(y0 - top > 2 * T && y0 - top < 3 * T, 'a jump clears two tiles and not three', (y0 - top).toFixed(1) + 'px');
    expect(s.chars[0].y === y0, 'and lands where it took off', air + ' steps in the air');
    run(s, 200, LEFT);
    expect(s.chars[0].x === T, 'the wall stops you', s.chars[0].x);
    run(s, 50, 0, RIGHT | UP);
    expect(!inWall(s, s.chars[1]) && s.chars[1].x <= (COLS - 1) * T - s.chars[1].w, 'jumping into the far wall keeps you out of it');
}
{
    // a pool's far lip is walked over
    const lv = lab(open('#.f.t......................#', '##########LL################'));
    const s = S.newLevel(lv);
    run(s, 140, RIGHT);
    expect(!s.chars[0].dead && s.chars[0].x > 14 * T && s.chars[0].g, 'lava wades through lava and steps out the other side', (s.chars[0].x / T).toFixed(1));
}

// ===================================================================
section('what kills');
// ===================================================================
for (const [floor, who, dies, what] of [['W', 0, true, 'lava in water'], ['L', 1, true, 'tide in lava'], ['G', 0, true, 'lava in goo'], ['G', 1, true, 'tide in goo'], ['W', 1, false, 'tide in water'], ['L', 0, false, 'lava in lava']]) {
    const lv = lab(open('#..f.t.....................#', '#######' + floor.repeat(4) + '#'.repeat(17)));
    const s = S.newLevel(lv);
    run(s, 80, who ? 0 : RIGHT, who ? RIGHT : 0);
    expect(s.chars[who].dead === dies && (dies ? s.ph === 'dead' : s.ph === 'play'), (dies ? 'kills: ' : 'safe: ') + what);
}
{
    const lv = lab(open('#..f.t.....................#', '#######WW#################'.padEnd(28, '#')));
    const s = S.newLevel(lv);
    run(s, 30, RIGHT); S.step(s, RIGHT | UP, 0); run(s, 40, RIGHT);
    expect(!s.chars[0].dead && s.chars[0].x > 9 * T, 'and a two-tile pool can be jumped');
    run(s, 300, 0, 0);
    expect(s.ph === 'play', 'standing still is safe');
}

// ===================================================================
section('plates, levers, gates and boxes');
// ===================================================================
{
    const lv = lab(open('#.f.t......................#'), [['btn', 6, 17, 0], ['plat', 12, 14, 1, 4, 0, -4, 0, 1], ['lever', 20, 17, 1, 0], ['lever', 22, 17, 1, 0]]);
    const s = S.newLevel(lv);
    run(s, 40, RIGHT);
    expect(s.btns[0].down && S.active(s, 0), 'standing on a plate presses it');
    run(s, 70, 0);
    expect(s.plats[0].p === 1 && s.plats[0].y === 10 * T, 'and the gate goes all the way up while it is held', s.plats[0].y);
    run(s, 20, RIGHT);
    expect(!s.btns[0].down, 'stepping off lets it go');
    run(s, 70, 0);
    expect(s.plats[0].p === 0, 'and the gate comes back down');
    const before = s.chars[0].x;
    run(s, 40, RIGHT);
    expect(s.chars[0].x < 12 * T && s.chars[0].x > before, 'a closed gate is a wall', (s.chars[0].x / T).toFixed(2));
    // levers
    const s2 = S.newLevel(lv);
    s2.chars[0].x = 19 * T; run(s2, 20, RIGHT);
    expect(s2.levers[0].on && S.active(s2, 1), 'walking right through a lever pushes it on');
    run(s2, 30, RIGHT);
    expect(s2.levers[1].on && !S.active(s2, 1), 'two levers on one channel: the second flips it back off');
    run(s2, 30, LEFT);
    expect(!s2.levers[1].on && S.active(s2, 1), 'walking left through one pushes it off again');
    run(s2, 200, 0);
    expect(!s2.levers[1].on && S.active(s2, 1), 'and a lever stays where it was pushed');
}
{
    // a gate coming down onto somebody stops
    const lv = lab(open('#.f.t......................#'), [['lever', 20, 17, 0, 1], ['plat', 8, 13, 2, 1, 0, 3, 0, 1]]);
    const s = S.newLevel(lv);
    expect(s.plats[0].p === 1 && s.plats[0].y === 16 * T, 'a platform starts where its channel puts it');
    s.chars[1].x = 8 * T + 3; s.chars[1].y = 16 * T - 30; s.chars[1].g = false;
    run(s, 20, 0, 0);
    expect(s.chars[1].g && s.chars[1].onP === 0, 'something dropped on it lands on it');
    s.levers[0].on = false;
    run(s, 80, 0, 0);
    expect(s.plats[0].p === 0 && Math.abs(s.chars[1].y + s.chars[1].h - s.plats[0].y) < 1e-6 && !inWall(s, s.chars[1]), 'and a platform going up takes whoever stands on it along', `plat ${s.plats[0].y.toFixed(1)} tide ${s.chars[1].y.toFixed(1)}`);
    // coming down onto somebody, it stops
    s.chars[0].x = 8 * T + 3;
    s.levers[0].on = true;
    run(s, 80, 0, 0);
    expect(s.plats[0].y + s.plats[0].h <= s.chars[0].y + 1e-6 && !inWall(s, s.chars[0]) && !s.chars[0].dead, 'a platform coming down onto somebody stops short', `plat ${s.plats[0].y.toFixed(1)} lava ${s.chars[0].y.toFixed(1)}`);
}
{
    const lv = lab(open('#.f.t........x.............#'.replace('x', '.')), [['box', 7, 17], ['btn', 12, 17, 0]]);
    const s = S.newLevel(lv);
    const b0 = s.boxes[0].x;
    run(s, 70, RIGHT);
    expect(s.boxes[0].x > b0 + 10, 'walking into a box pushes it', (s.boxes[0].x - b0).toFixed(1));
    run(s, 200, RIGHT);
    expect(!inWall(s, s.boxes[0]) && s.boxes[0].x + s.boxes[0].w <= (COLS - 1) * T + 1e-6, 'and the wall stops it');
    const s2 = S.newLevel(lv);
    while (s2.boxes[0].x < 12 * T - 2 && s2.t < 400) S.step(s2, RIGHT, 0);
    run(s2, 2, 0);
    expect(s2.btns[0].down, 'a box on a plate holds it down');
    // standing on a box
    const s3 = S.newLevel(lv);
    run(s3, 6, 0, LEFT);
    s3.chars[1].x = s3.boxes[0].x + 2; s3.chars[1].y = s3.boxes[0].y - 40; run(s3, 30, 0, 0);
    expect(s3.chars[1].g && Math.abs(s3.chars[1].y + s3.chars[1].h - s3.boxes[0].y) < 1e-6, 'a box is something to stand on');
}
{
    // the doors
    const lv = lab(open('#.fFtT.....................#'));
    const s = S.newLevel(lv);
    run(s, 12, RIGHT, RIGHT);
    expect(s.chars[0].inDoor && s.chars[1].inDoor && s.ph === 'play', 'both in their doors: the doors begin to open');
    run(s, S.DOOR_HOLD, 0, 0);
    expect(s.ph === 'won' && s.endT > 0, 'and after a moment the level is done');
    const lv2 = lab(open('#.fTtF.....................#'));
    const s2 = S.newLevel(lv2);
    run(s2, 12, RIGHT, RIGHT); run(s2, 60, 0, 0);
    expect(s2.ph === 'play', 'each door only counts for its own character');
}

// ===================================================================
section('ranks');
// ===================================================================
{
    const s = S.newLevel(0);
    const par = S.LEVELS[0].par * 60;
    const set = (n, t) => { s.gems.forEach((g, i) => { g.got = i < n; }); s.endT = t; return S.rank(s); };
    const N = s.gems.length;
    expect(set(N, par) === 'A' && set(N, par + 60) === 'B' && set(Math.ceil(N / 2), par - 1) === 'B' && set(0, par) === 'C' && set(N - 1, par * 3) === 'C', 'a: all gems in par, b: all gems or par with half, c: out');
    expect(S.better('A', 'B') && S.better('B', 'C') && !S.better('C', 'A') && S.better('C', undefined), 'and a better rank beats a worse one');
}

// ===================================================================
section('the wire');
// ===================================================================
{
    const lv = 11, ap = S.autopilot(lv), s = S.newLevel(lv, 3);
    for (let i = 0; i < 700; i++) { const k = ap.keys(s); S.step(s, k[0], k[1]); }
    const wire = JSON.parse(JSON.stringify(S.snapshot(s)));
    const g = S.newLevel(lv, 3);
    expect(S.applySnapshot(g, wire), 'a snapshot is taken');
    expect(JSON.stringify(S.snapshot(g)) === JSON.stringify(S.snapshot(s)), 'and puts the same world on the guest');
    for (let i = 0; i < 400; i++) { const k = ap.keys(s); S.step(s, k[0], k[1]); S.step(g, k[0], k[1]); }
    expect(JSON.stringify(S.snapshot(g)) === JSON.stringify(S.snapshot(s)), 'which then runs on in step with the host');
    expect(JSON.stringify(wire).length < 1200, 'and it is small', JSON.stringify(wire).length + ' bytes');
    const bad = [null, 7, {}, { ...wire, v: 9 }, { ...wire, l: 2 }, { ...wire, ph: 'hacked' }, { ...wire, c: [[1, 2]] }, { ...wire, c: [wire.c[0], wire.c[1].map(() => NaN)] },
        { ...wire, x: [] }, { ...wire, p: wire.p.slice(1) }, { ...wire, gm: -1 }, { ...wire, t: 1.5 }];
    const keep = JSON.stringify(S.snapshot(g));
    expect(bad.every(d => !S.applySnapshot(g, d)) && JSON.stringify(S.snapshot(g)) === keep, 'junk is refused and changes nothing', bad.length + ' kinds');
    const cl = S.clone(s);
    expect(JSON.stringify(S.snapshot(cl)) === JSON.stringify(S.snapshot(s)) && cl !== s, 'a clone is the same world, apart');
    S.step(s, 7, 99);
    expect(s.inputs[0] === 7 && s.inputs[1] === (99 & 7), 'keys are only ever three bits');
}

// ===================================================================
section('the fuzz: random keys on every level');
// ===================================================================
{
    let runs = 0, sane = true, why = '', ended = { play: 0, dead: 0, won: 0 };
    for (let lv = 0; lv < REAL; lv++) {
        for (let k = 0; k < 120; k++) {
            const r = rng(lv * 1000 + k + 1), s = S.newLevel(lv, k);
            let a = 0, b = 0;
            for (let i = 0; i < 1500 && s.ph === 'play'; i++) {
                if (i % 12 === 0) { a = floor(r() * 8); b = floor(r() * 8); }
                S.step(s, a, b);
                s.events.length = 0;
            }
            runs++;
            ended[s.ph]++;
            const all = s.chars.concat(s.boxes);
            for (const x of all) if (![x.x, x.y, x.vy].every(Number.isFinite) || (!x.dead && inWall(s, x))) { sane = false; why = `level ${lv + 1} run ${k}: ${JSON.stringify([x.x, x.y, x.box ? 'box' : 'char'])}`; }
            if (s.plats.some(p => !(p.p >= 0 && p.p <= 1))) { sane = false; why = 'platform out of its track on level ' + (lv + 1); }
        }
    }
    expect(sane, 'every run ends with a sane world: nothing inside a wall, nothing NaN', why || runs + ' runs');
    expect(ended.play + ended.dead + ended.won === runs && ended.dead > 0, 'and with a valid result', JSON.stringify(ended));
}
function floor(v) { return Math.floor(v); }

// ===================================================================
section('the pilot');
// ===================================================================
{
    const lv = lab(open('#.f.t......................#'));
    const s = S.newLevel(lv), P = S.pilot([['go', 10], ['wait', 5], ['sig', 'x'], ['go', 3]]), Q = S.pilot([['await', 'x'], ['go', 12]]), flags = {};
    for (let i = 0; i < 400; i++) S.step(s, S.drive(s, 0, P, flags), S.drive(s, 1, Q, flags));
    expect(Math.abs(s.chars[0].x + 5 - 3.5 * T) < 1 && Math.abs(s.chars[1].x + 5 - 12.5 * T) < 1, 'the pilot walks where it is told and waits for the other one');
    let threw = false;
    try { S.drive(s, 0, S.pilot([['dance']]), {}); } catch (e) { threw = true; }
    expect(threw, 'and refuses a step it does not know');
}
// ===================================================================
section('the netcode: host plays the guest\'s keys in order, the guest predicts');
// ===================================================================
{
    // the same protocol as lavatide.js, with a wire that is late, lumpy and
    // in order, and frames that stutter on both ends
    let corrections = 0, wins = 0;
    const RUNS = 12;
    for (let r = 1; r <= RUNS; r++) {
        const rnd = rng(r * 77);
        const hs = S.newLevel(0), gs = S.newLevel(0), hp = S.autopilot(0), gp = S.autopilot(0);
        let q = [], qTop = 0, buffering = true, remote = 0, ack = 0, seq = 0, hist = [];
        const toHost = [], toGuest = [];
        for (let f = 0; f < 4000 && hs.ph === 'play'; f++) {
            for (let n = rnd() < 0.1 ? 2 : rnd() < 0.1 ? 0 : 1; n > 0; n--) {
                let hold = 0;
                const k = hp.keys(hs);
                if (!q.length) buffering = true; else if (buffering && q.length >= 6) buffering = false;
                if (!buffering) { ack = q.shift(); remote = q.shift(); } else hold = 2;
                S.step(hs, k[0], remote, hold);
            }
            if (f % 3 === 0) toGuest.push({ at: f + 1 + Math.floor(rnd() * 5), d: JSON.parse(JSON.stringify(Object.assign(S.snapshot(hs), { ack }))) });
            for (let n = rnd() < 0.1 ? 2 : rnd() < 0.1 ? 0 : 1; n > 0; n--) {
                if (gs.ph !== 'play') break;
                const k = gp.keys(gs);
                seq++; hist.push(seq, k[1]);
                S.step(gs, 0, k[1], 1);
            }
            if (f % 2 === 0 && hist.length) toHost.push({ at: f + 1 + Math.floor(rnd() * 5), q: hist[hist.length - 2], b: hist.filter((_, i) => i % 2) });
            while (toHost.length && toHost[0].at <= f) { const d = toHost.shift(), first = d.q - d.b.length + 1; d.b.forEach((b, i) => { if (first + i > qTop) { q.push(first + i, b); qTop = first + i; } }); }
            while (toGuest.length && toGuest[0].at <= f) {
                const d = toGuest.shift().d, bx = gs.chars[1].x, by = gs.chars[1].y;
                S.applySnapshot(gs, d);
                let k = 0; while (k < hist.length && hist[k] <= d.ack) k += 2; hist.splice(0, k);
                if (gs.ph === 'play') for (let i = 0; i < hist.length; i += 2) S.step(gs, 0, hist[i + 1], 1);
                if (gs.chars[1].x !== bx || gs.chars[1].y !== by) corrections++;
            }
        }
        if (hs.ph === 'won') wins++;
    }
    expect(wins === RUNS, 'level 1 finished online on every run, through a lagging, stuttering wire', wins + ' of ' + RUNS);
    expect(corrections === 0, 'and the guest never once had to correct its own character', corrections + ' corrections');
}

S.LEVELS.length = REAL;

// ===================================================================
section('the window');
// ===================================================================
{
    const fs = await import('node:fs');
    const ui = fs.readFileSync(path.join(ROOT, 'games/lava-tide/lavatide.js'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'games/lava-tide/lavatide.css'), 'utf8');
    const used = [...new Set([...ui.matchAll(/\blt-[a-z0-9-]+/g)].map(m => m[0]))].filter(c => c !== 'lt-css');   // the stylesheet's own id
    const dynamic = ['lt-lava', 'lt-tide', 'lt-rank-a', 'lt-rank-b', 'lt-rank-c'];
    const unstyled = used.concat(dynamic).filter(c => !c.endsWith('-') && !new RegExp('\\.' + c + '[\\s,:{.\\[>]').test(css));
    expect(!unstyled.length, 'every class the window uses has a style', unstyled.join(', '));
    expect(/registerGame\(\{[\s\S]*?id: 'lavatide'[\s\S]*?startSolo[\s\S]*?paintAvatar/.test(ui) && /window\.startLavaTide = /.test(ui), 'it registers with the lobby and defines startLavaTide');
    expect(/'lavatide:i'/.test(ui) && /'lavatide:s'/.test(ui) && /'lavatide:ask'/.test(ui) && !/session\.send\('(?!lavatide:)/.test(ui), 'every message it sends is prefixed lavatide:');
    expect(!/https?:\/\//.test(ui + css), 'and it asks nothing of the network');
    expect(/mrhakan98-lavatide-best/.test(ui) && /try \{ localStorage/.test(ui), 'saves go under mrhakan98-lavatide-, guarded');
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' lavatide checks FAILED' : checks + ' lavatide checks passed'));
process.exit(failures ? 1 : 0);
