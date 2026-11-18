// ===================================================================
// check-blockroll.mjs — block roll 98's rules and levels, under node
//
//   the rolls     standing, lying along x and along y land where they should
//   the floors    fragile orange, soft and heavy switches, bridge modes
//   the split     two cubes, swapping, blocking and merging back together
//   the levels    every level parses, a BFS over (block, cubes, bridges) solves
//                 it, the optimal move count equals the stored par, and the
//                 level's gimmick is actually needed
//   the codes     six digit passcodes, unique, and they map back to levels
//   random play   seeded random runs always end in a valid state
//
//   node .github/scripts/check-blockroll.mjs
// ===================================================================
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = require(path.join(ROOT, 'games/block-roll/block-roll-sim.js'));

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
// test boards without a hole get one parked far away, off to the side
const lvl = (map, extra = {}) => S.parseLevel({ name: 't', map: map.some(r => r.includes('*')) ? map : map.concat(['.'.repeat(map[0].length + 3) + '*']), ...extra }, 0);
const run = (L, s, path) => { for (const c of path) { if (c === 'x') s = S.swap(s); else s = S.move(L, s, c).state; } return s; };
const pos = s => s.cubes ? 'c' + s.cubes.join('|') : s.x + ',' + s.y + ',' + s.o;

section('the rolls');
{
    const L = lvl(['#######', '#######', '#######', '###@###', '#######', '#######', '#######', '######*']);
    const s0 = S.initial(L);
    expect(pos(S.move(L, s0, 'R').state) === '4,3,1', 'standing rolled right lies along x beside it');
    expect(pos(S.move(L, s0, 'L').state) === '1,3,1', 'standing rolled left lies along x two cells over');
    expect(pos(S.move(L, s0, 'D').state) === '3,4,2', 'standing rolled down lies along y');
    expect(pos(S.move(L, s0, 'U').state) === '3,1,2', 'standing rolled up lies along y two cells up');
    const lx = S.move(L, s0, 'R').state;
    expect(pos(S.move(L, lx, 'R').state) === '6,3,0', 'lying along x rolled right stands up past its end');
    expect(pos(S.move(L, lx, 'L').state) === '3,3,0', 'and rolled back stands where it started');
    expect(pos(S.move(L, lx, 'D').state) === '4,4,1', 'lying along x rolled sideways stays lying');
    const ly = S.move(L, s0, 'D').state;
    expect(pos(S.move(L, ly, 'D').state) === '3,6,0', 'lying along y rolled down stands up');
    expect(pos(S.move(L, ly, 'R').state) === '4,4,2', 'lying along y rolled sideways stays lying');
    expect(S.move(L, s0, 'R').state.moves === 1 && s0.moves === 0, 'a move counts and never mutates the old state');
    const edge = run(L, s0, 'UUU');
    expect(edge.status === 'fell', 'rolling off the top edge falls');
    const lyingGoal = lvl(['@#*#']);
    expect(S.move(lyingGoal, S.initial(lyingGoal), 'R').state.status === 'play', 'lying across the hole is not a win');
    const win = lvl(['@##*']);
    expect(run(win, S.initial(win), 'RR').status === 'won', 'standing upright on the hole wins');
    const half = lvl(['@##']);
    const hs = S.move(half, S.initial(half), 'R').state;
    expect(hs.status === 'play' && S.move(half, hs, 'R').state.status === 'fell', 'standing up over the void falls');
}

section('the floors');
{
    const F = lvl(['@~~#~~#']);
    const s1 = S.move(F, S.initial(F), 'R');
    expect(s1.state.status === 'play', 'lying on orange floor holds');
    const s2 = S.move(F, s1.state, 'R');
    expect(s2.state.status === 'play' && pos(s2.state) === '3,0,0', 'standing on plain floor beyond is fine');
    const F2 = lvl(['@##~']);
    const f = S.move(F2, S.move(F2, S.initial(F2), 'R').state, 'R');
    expect(f.state.status === 'fell' && f.events.some(e => e.kind === 'fall' && e.fragile), 'standing upright on orange floor cracks it');

    const soft = lvl(['@a#11#*'], { sw: { a: { g: [1], m: 'on' } } });
    const a = S.move(soft, S.initial(soft), 'R');
    expect((a.state.mask >> 1 & 1) === 1 && a.events.some(e => e.kind === 'bridge-open'), 'lying across a soft switch opens its bridge');
    expect(run(soft, S.initial(soft), 'RRR').status === 'play', 'and the bridge carries the block');
    const closed = lvl(['@##11#*']);
    expect(run(closed, S.initial(closed), 'RRR').status === 'fell', 'a closed bridge is a hole');

    const heavy = lvl(['@##A#1#'], { sw: { A: { g: [1], m: 'on' } } });
    const lying = S.move(heavy, S.move(heavy, S.initial(heavy), 'R').state, 'D');
    expect(lying.state.status === 'fell', 'sanity: off the edge');
    const h1 = S.move(heavy, S.initial(heavy), 'R').state;           // lying on 1,2
    const h2 = S.move(heavy, h1, 'R').state;                          // standing on 3 (A)
    expect((h2.mask >> 1 & 1) === 1, 'standing on a heavy switch works it');
    const heavyLie = lvl(['@#A##1'], { sw: { A: { g: [1], m: 'on' } } });
    const hl = run(heavyLie, S.initial(heavyLie), 'RR'); // standing on 3, never touched A lying? check lying over A
    const lyingOver = S.move(heavyLie, S.initial(heavyLie), 'R').state; // lying 1,2 -> covers A
    expect((lyingOver.mask >> 1 & 1) === 0, 'lying on a heavy switch does nothing');
    void hl;

    const tog = lvl(['@a#'], { sw: { a: { g: [1, 2], m: 't' } }, open: [2] });
    // adding a lone bridge tile per group so the groups exist
    const t1 = S.move(tog, S.initial(tog), 'R').state;
    expect((t1.mask >> 1 & 1) === 1 && (t1.mask >> 2 & 1) === 0, 'a toggle switch flips every group it drives');
    const off = lvl(['@a#1'], { sw: { a: { g: [1], m: 'off' } }, open: [1] });
    expect((S.initial(off).mask >> 1 & 1) === 1 && (S.move(off, S.initial(off), 'R').state.mask >> 1 & 1) === 0, 'an off switch closes an open bridge');
    const pull = lvl(['#a1', '@##'], { sw: { a: { g: [1], m: 't' } }, open: [1] });
    // lying along x over a(1,0) and bridge(2,0): the switch pulls the bridge out from under it
    const pu = S.move(pull, S.move(pull, S.initial(pull), 'R').state, 'U');
    expect(pu.state.status === 'fell', 'a switch that folds the bridge you lie on drops you');
}

section('the split');
{
    const L = lvl(['@##%#.', '######', '######'], { split: [[[0, 2], [4, 2]]] });
    const sp = S.move(L, S.move(L, S.initial(L), 'R').state, 'R');
    expect(sp.state.cubes && sp.events.some(e => e.kind === 'split'), 'standing on a splitter makes two cubes');
    expect(sp.state.cubes[0].join() === '0,2' && sp.state.cubes[1].join() === '4,2' && sp.state.active === 0, 'at the splitter\'s targets, first cube active');
    const c1 = S.move(L, sp.state, 'R').state;
    expect(c1.cubes[0].join() === '1,2' && c1.cubes[1].join() === '4,2', 'a cube rolls one cell');
    const sw = S.swap(c1);
    expect(sw.active === 1 && sw.moves === c1.moves, 'space swaps cubes and is not a move');
    const c2 = S.move(L, sw, 'L').state;
    expect(c2.cubes && c2.cubes[1].join() === '3,2', 'the other cube rolls');
    const merged = S.move(L, c2, 'L');
    expect(!merged.state.cubes && pos(merged.state) === '1,2,1' && merged.events.some(e => e.kind === 'merge'), 'side by side cubes merge into a lying block');
    const cubeFall = S.move(L, sp.state, 'U');
    expect(cubeFall.state.status === 'play', 'a cube can roll onto the floor above');
    expect(S.move(L, S.move(L, sp.state, 'L').state, 'L').state.status === 'fell', 'a cube off the edge falls');
    const bump = lvl(['@##%##', '......', '.#.##.'], { split: [[[1, 2], [3, 2]]] });
    const bs = run(bump, S.initial(bump), 'RR');
    const into = S.move(bump, S.swap(bs), 'R');
    expect(bs.cubes && into.state.status === 'play' && into.state.cubes, 'gapped cubes stay split', pos(into.state));
    const wall = lvl(['@##%', '....', '###.'], { split: [[[0, 2], [2, 2]]] });
    const ws = run(wall, S.initial(wall), 'RRR');
    expect(!ws.cubes && pos(ws) === '1,2,1', 'cubes rolling next to each other merge');

}

section('the levels');
const pars = [];
let totalStates = 0;
expect(S.LEVELS.length >= 25, 'at least 25 levels', S.LEVELS.length);
for (let i = 0; i < S.LEVELS.length; i++) {
    const def = S.LEVELS[i];
    let L;
    try { L = S.level(i); } catch (e) { expect(false, 'level ' + (i + 1) + ' parses', e.message); continue; }
    const r = S.solve(L, 2000000);
    if (!r) { expect(false, 'level ' + (i + 1) + ' ' + def.name + ' is solvable'); continue; }
    totalStates += r.explored;
    pars.push(r.moves);
    const end = run(L, S.initial(L), r.path);
    expect(end.status === 'won' && end.moves === r.moves && r.moves === def.par,
        'level ' + String(i + 1).padStart(2) + ' ' + def.name.padEnd(20) + ' optimal ' + r.moves + ' = par ' + def.par,
        r.explored + ' states, code ' + L.passcode);
    const strip = (re, to, extra = {}) => { const d = { ...def, map: def.map.map(row => row.replace(re, to)), ...extra }; return S.solve(S.parseLevel(d, i), 2000000); };
    if (L.groups.length) expect(!strip(/[a-zA-Z]/g, '#', { open: [] }), '    its bridges are needed');
    if (L.switches.some(s => s.heavy)) expect(!strip(/[A-Z]/g, '#'), '    its heavy switch is needed');
    if (L.splits.length) { expect(!strip(/%/g, '#', { split: [] }), '    its splitter is needed'); expect(r.path.includes('x'), '    and both cubes have to move'); }
    if (def.map.some(row => row.includes('~'))) { const easy = strip(/~/g, '#'); expect(easy && easy.moves < r.moves, '    its orange floor makes it longer', easy && easy.moves); }
}
const firstHalf = pars.slice(0, 13).reduce((a, b) => a + b, 0) / 13, secondHalf = pars.slice(13).reduce((a, b) => a + b, 0) / Math.max(1, pars.length - 13);
expect(secondHalf > firstHalf, 'difficulty rises: later levels take more moves', firstHalf.toFixed(1) + ' -> ' + secondHalf.toFixed(1));
expect(pars[0] <= 12, 'level 1 is gentle', pars[0]);

section('the codes');
{
    const codes = S.LEVELS.map((_, i) => S.passcode(i));
    expect(codes.every(c => /^\d{6}$/.test(c)), 'every passcode is six digits');
    expect(new Set(codes).size === codes.length, 'passcodes are unique');
    expect(codes.every((c, i) => S.levelForCode(c) === i), 'each passcode opens its own level');
    expect(S.levelForCode('000000') === -1 && S.levelForCode('') === -1 && S.levelForCode('abc') === -1, 'nonsense codes open nothing');
    expect(S.passcode(3) === S.passcode(3), 'codes are stable');
}

section('random play');
{
    let seed = 98;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let runs = 0, falls = 0, wins = 0, bad = 0;
    for (let i = 0; i < S.LEVELS.length; i++) {
        const L = S.level(i);
        for (let k = 0; k < 40; k++) {
            let s = S.initial(L), steps = 0;
            while (s.status === 'play' && steps < 400) {
                if (s.cubes && rnd() < 0.2) s = S.swap(s);
                else s = S.move(L, s, 'UDLR'[(rnd() * 4) | 0]).state;
                steps++;
                if (s.status === 'play') {
                    const ok = S.cells(s).every(c => S.solid(L, c[0], c[1], s.mask)) && (s.mask & 1) === 0 && s.mask < 1024 &&
                        (!s.cubes || s.cubes[0].join() !== s.cubes[1].join());
                    if (!ok) bad++;
                }
            }
            runs++; if (s.status === 'fell') falls++; if (s.status === 'won') wins++;
        }
    }
    expect(bad === 0, 'a resting block is always on solid floor, cubes never overlap', runs + ' runs');
    expect(falls + wins > runs * 0.9, 'random play ends (fall or win) almost always', falls + ' falls, ' + wins + ' wins');
    const L = S.level(5), p = S.solve(L).path;
    expect(S.key(run(L, S.initial(L), p)) === S.key(run(L, S.initial(L), p)), 'the same moves give the same state');
}

console.log('\nlevels: ' + pars.length + ', pars ' + pars.join(' ') + ', ' + totalStates + ' solver states');
if (failures) { console.log('\n' + failures + ' of ' + checks + ' blockroll checks FAILED'); process.exit(1); }
console.log('\n' + checks + ' blockroll checks passed');
