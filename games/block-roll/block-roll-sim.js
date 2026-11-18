// block roll 98 — rules, levels and solver. No DOM: the page draws it and
// .github/scripts/check-blockroll.mjs proves every level under node.
//
// The board is a grid of floating tiles. The block is 1 x 1 x 2 and is either
// standing (o=0), lying along x (o=1, covers x and x+1) or lying along y
// (o=2, covers y and y+1). Map characters:
//   .  void          #  floor          @  start (floor)     *  goal hole
//   ~  fragile floor (the block cannot stand on it)
//   1-9 bridge tile of that group (closed unless the group is in `open`)
//   a-z soft switch (any touch)        A-Z heavy switch (standing only)
//       each switch letter is described in `sw`: { g: [groups], m: 't'|'on'|'off' }
//   %  splitter: standing on it splits the block into two cubes at `split[i]`
(function () {
'use strict';
const root = typeof globalThis !== 'undefined' ? globalThis : window;

const T = { VOID: 0, FLOOR: 1, GOAL: 2, FRAGILE: 3, BRIDGE: 4, SOFT: 5, HEAVY: 6, SPLIT: 7 };
const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };

// ---------------------------------------------------------------- levels
// All original layouts. `par` is filled in from the solver run in
// check-blockroll.mjs and kept here so the page does not have to solve.
const LEVELS = [
{ name: 'first roll', par: 9, map: [
    '@......',
    '##..###',
    '##..###',
    '.####.*',
    '..##...'] },
{ name: 'stepping stones', par: 13, map: [
    '#####.....',
    '#@###.....',
    '.########.',
    '..#.....##',
    '..##....##',
    '..##....#*'] },
{ name: 'parity check', par: 17, map: [
    '###........',
    '#@##.......',
    '######.....',
    '....###....',
    '.....###...',
    '......####*',
    '.......###.'] },
{ name: 'the long way round', par: 22, map: [
    '.###........',
    '#@##.####...',
    '######..#...',
    '##..###.#...',
    '......####..',
    '......######',
    '........####',
    '.........*#.'] },
{ name: 'thin ice', par: 15, map: [
    '.###.....',
    '@#~~.....',
    '...#.##..',
    '...####..',
    '...#####.',
    '....#.#~#',
    '....####*'] },
{ name: 'orange carpet', par: 21, map: [
    '###.........',
    '#@~#..#~##..',
    '#~#~###~####',
    '###.....##.#',
    '........####',
    '........~#~#',
    '.........##*'] },
{ name: 'press here', par: 15, map: [
    '.####......',
    '#@###......',
    '######.....',
    '...a###....',
    '.....###11#',
    '.....##.##*',
    '.....##....'], sw: {a: {g: [1], m: 'on'}} },
{ name: 'two buttons', par: 22, map: [
    '##.###b.....',
    '#@#####.....',
    '####.##.....',
    '.....##.....',
    '.....#####1.',
    '.....a####12',
    '....##....*2',
    '....##......'], sw: {a: {g: [1], m: 'on'}, b: {g: [2], m: 'on'}} },
{ name: 'flip flop', par: 26, map: [
    '1@..........',
    '1##.........',
    '1#####.##...',
    '#########...',
    '####a####...',
    '..##..#.222*',
    '......#b#...'], sw: {a: {g: [1], m: 't'}, b: {g: [2, 1], m: 't'}} },
{ name: 'heavy duty', par: 18, map: [
    '##.####..',
    '@######..',
    '.#####...',
    '..####...',
    '...##..##',
    '...#E111*'], sw: {E: {g: [1], m: 'on'}} },
{ name: 'do not lean', par: 24, map: [
    '###........',
    'E@####.....',
    '####.#.....',
    '..####.....',
    '..#####~1..',
    '.......#1##',
    '.....#####*',
    '.....#####.'], sw: {E: {g: [1], m: 'on'}} },
{ name: 'double x', par: 28, map: [
    '####.#F##...',
    'E@########..',
    '####22#.##..',
    '...##.####1.',
    '...##....#1.',
    '.........###',
    '.........##*'], sw: {E: {g: [1], m: 't'}, F: {g: [2], m: 't'}} },
{ name: 'split decision', par: 16, map: [
    '...####...',
    '@######...',
    '######....',
    '####%#####',
    '.#####.###',
    '..####.#*.',
    '....##....'], split: [[[5,1],[4,3]]] },
{ name: 'cube errand', par: 24, map: [
    '.##.........',
    '#@##........',
    'a####.......',
    '....####..##',
    '....##.#####',
    '...##%...11#',
    '..####....*#',
    '..####......'], sw: {a: {g: [1], m: 'on'}}, split: [[[10,4],[3,1]]] },
{ name: 'ice and wire', par: 28, map: [
    '##...........',
    '#@#..........',
    '###..........',
    '###.~~.......',
    '###~##1##....',
    'a###..1###...',
    '......1~.####',
    '.........##~*',
    '..........###'], sw: {a: {g: [1], m: 'on'}} },
{ name: 'the wanderer', par: 32, map: [
    '.##...........',
    '#@#...........',
    '###...........',
    '####.#####....',
    '...#.#####....',
    '...######.....',
    '...###..#.####',
    '........#####*',
    '...........###'] },
{ name: 'round trip', par: 32, map: [
    '##E...........',
    '#@####........',
    '####.a........',
    '...####....##.',
    '...####....##.',
    '......####.##.',
    '.......###2###',
    '......##1#2##*',
    '......######..'], sw: {a: {g: [1], m: 'on'}, E: {g: [2], m: 'on'}} },
{ name: 'cube shuffle', par: 30, map: [
    '###..........',
    'b@#..........',
    '###....####..',
    '.####..#.##..',
    '.#########a..',
    '..###.####%1.',
    '......#....1#',
    '......#....*#',
    '.....22....##'], sw: {a: {g: [1], m: 'on'}, b: {g: [2], m: 'on'}}, split: [[[2,2],[5,4]]] },
{ name: 'cracked glass', par: 34, map: [
    '####~#.....##~',
    '#@####.....#~#',
    '##..####.~##..',
    '.....#######..',
    '......###~##..',
    '..........###.',
    '.........####.',
    '.........~#.##',
    '............##',
    '............*#'] },
{ name: 'switchback', par: 36, map: [
    '##........#11.',
    '#@........###.',
    '.#....####a##.',
    '##....#....2##',
    '##....#....###',
    '.###E##...33#.',
    '.####.....#...',
    '..###.....#...',
    '..#b#.....###*',
    '..##..........'], sw: {a: {g: [1], m: 't'}, b: {g: [2, 1], m: 't'}, E: {g: [3, 1], m: 't'}} },
{ name: 'two halves on ice', par: 34, map: [
    '~~~##~~#......',
    '#@##~~~#......',
    '~#~##~##......',
    '......#~#.....',
    '......##%..##.',
    '...~#~####~#~.',
    '...~~.##.~##~~',
    '............*~'], split: [[[4,0],[4,2]]] },
{ name: 'heavy traffic', par: 40, map: [
    'a#..###...##...',
    '#@###..#..##...',
    '.####..E..##...',
    '..##~.##222#...',
    '...#####..~#...',
    '...#####..##...',
    '...#...#..###1.',
    '...#####.....1#',
    '.............##',
    '.............#*'], sw: {a: {g: [1], m: 'on'}, E: {g: [2], m: 'on'}} },
{ name: 'split the difference', par: 40, map: [
    '##.#~~#.~##..',
    '#@##~~~#~~#..',
    '#%~#~........',
    '#~#####......',
    '~a#..##~#~...',
    '.....~~###...',
    '.....#~..~.1.',
    '.........~~1#',
    '.........~~1*',
    '.........##..'], sw: {a: {g: [1], m: 'on'}}, split: [[[3,0],[8,1]]] },
{ name: 'the toggler', par: 44, map: [
    '##...##.......',
    '#@#..##.......',
    'F####.#.......',
    '#######.......',
    '.########.....',
    '....33###..##*',
    '.......####11#',
    '.......##.#2a#',
    '.......####E..'], sw: {a: {g: [1, 3], m: 't'}, E: {g: [2], m: 't'}, F: {g: [3], m: 't'}} },
{ name: 'grand central', par: 46, map: [
    '.~#~~E#........',
    '.@~##.1........',
    '##~.##1........',
    '###...12..~~...',
    '###....2.~~#...',
    '..~....2#~~#~..',
    'a#%........#~#.',
    '#####~.....###.',
    '....##.......##',
    '.............*#'], sw: {a: {g: [1], m: 'on'}, E: {g: [2], m: 'on'}}, split: [[[12,5],[4,8]]] },
{ name: 'last orbit', par: 50, map: [
    '~#....~~.....',
    '~@.#222#.....',
    '.####........',
    '####.........',
    '###~....3....',
    '#.......3....',
    '##E....#3#...',
    '.#b###~####1*',
    '#a###..###...',
    '#~~#...##....'], sw: {a: {g: [1, 2], m: 't'}, b: {g: [2], m: 't'}, E: {g: [3, 2], m: 't'}} }
];

// ---------------------------------------------------------------- parsing
function parseLevel(def, index) {
    const map = def.map, h = map.length, w = Math.max(...map.map(r => r.length));
    const tile = new Uint8Array(w * h), group = new Uint8Array(w * h), swOf = new Int16Array(w * h).fill(-1);
    const switches = [], bridges = [], splits = [];
    let start = null, goal = null, splitIdx = -1;
    const splitAt = new Int16Array(w * h).fill(-1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = map[y][x] || '.', i = y * w + x;
        if (c === '.' || c === ' ') continue;
        if (c === '#') tile[i] = T.FLOOR;
        else if (c === '@') { tile[i] = T.FLOOR; start = [x, y]; }
        else if (c === '*') { tile[i] = T.GOAL; goal = [x, y]; }
        else if (c === '~') tile[i] = T.FRAGILE;
        else if (c >= '1' && c <= '9') {
            const g = +c; tile[i] = T.BRIDGE; group[i] = g;
            (bridges[g] = bridges[g] || []).push([x, y]);
        } else if (/[a-z]/i.test(c)) {
            const heavy = c === c.toUpperCase(), spec = def.sw && def.sw[c];
            if (!spec) throw new Error('level ' + (index + 1) + ': switch ' + c + ' has no description');
            tile[i] = heavy ? T.HEAVY : T.SOFT;
            swOf[i] = switches.length;
            switches.push({ x, y, ch: c, heavy, groups: spec.g.slice(), mode: spec.m || 't' });
        } else if (c === '%') {
            tile[i] = T.SPLIT; splitIdx++;
            const s = def.split && def.split[splitIdx];
            if (!s) throw new Error('level ' + (index + 1) + ': splitter without targets');
            splitAt[i] = splits.length; splits.push({ x, y, a: s[0].slice(), b: s[1].slice() });
        } else throw new Error('level ' + (index + 1) + ': unknown tile ' + JSON.stringify(c));
    }
    if (!start || !goal) throw new Error('level ' + (index + 1) + ': needs a start and a goal');
    let mask = 0;
    for (const g of def.open || []) mask |= 1 << g;
    const groups = [];
    for (let g = 1; g < bridges.length; g++) if (bridges[g]) groups.push(g);
    return { index, name: def.name, par: def.par || 0, w, h, tile, group, swOf, splitAt, switches, bridges, groups,
        splits, start, goal, mask, passcode: passcode(index) };
}

// a fixed six digit code per level, the same on every machine
function passcode(index) {
    let h = (Math.imul(index + 1, 2654435761) ^ 0x5bd1e995) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return String(100000 + (h % 900000));
}
function levelForCode(code) {
    const s = String(code || '').trim();
    for (let i = 0; i < LEVELS.length; i++) if (passcode(i) === s) return i;
    return -1;
}

// ---------------------------------------------------------------- rules
function solid(L, x, y, mask) {
    if (x < 0 || y < 0 || x >= L.w || y >= L.h) return false;
    const i = y * L.w + x, t = L.tile[i];
    if (t === T.VOID) return false;
    if (t === T.BRIDGE) return (mask >> L.group[i] & 1) === 1;
    return true;
}
function tileAt(L, x, y) {
    return x < 0 || y < 0 || x >= L.w || y >= L.h ? T.VOID : L.tile[y * L.w + x];
}
function initial(L) {
    return { x: L.start[0], y: L.start[1], o: 0, cubes: null, active: 0, mask: L.mask, moves: 0, status: 'play' };
}
function cells(s) {
    if (s.cubes) return [s.cubes[0], s.cubes[1]];
    if (s.o === 0) return [[s.x, s.y]];
    if (s.o === 1) return [[s.x, s.y], [s.x + 1, s.y]];
    return [[s.x, s.y], [s.x, s.y + 1]];
}
// where a whole block lands after one roll
function rollBlock(x, y, o, dx, dy) {
    if (o === 0) {
        if (dx === 1) return [x + 1, y, 1];
        if (dx === -1) return [x - 2, y, 1];
        if (dy === 1) return [x, y + 1, 2];
        return [x, y - 2, 2];
    }
    if (o === 1) {
        if (dx === 1) return [x + 2, y, 0];
        if (dx === -1) return [x - 1, y, 0];
        return [x, y + dy, 1];
    }
    if (dy === 1) return [x, y + 2, 0];
    if (dy === -1) return [x, y - 1, 0];
    return [x + dx, y, 2];
}
function applySwitch(L, sw, mask, events) {
    for (const g of sw.groups) {
        const bit = 1 << g, was = mask & bit;
        if (sw.mode === 'on') mask |= bit;
        else if (sw.mode === 'off') mask &= ~bit;
        else mask ^= bit;
        if ((mask & bit) !== was && events) events.push({ kind: (mask & bit) ? 'bridge-open' : 'bridge-close', group: g });
    }
    if (events) events.push({ kind: 'switch', x: sw.x, y: sw.y, heavy: sw.heavy });
    return mask;
}
// One move. Returns a new state (never mutates) plus what happened, for the
// renderer and the sounds. dir is 'U' 'D' 'L' 'R'.
function move(L, s, dir) {
    const d = DIRS[dir];
    if (!d || s.status !== 'play') return { state: s, events: [], moved: false };
    const events = [];
    const n = { x: s.x, y: s.y, o: s.o, cubes: null, active: s.active, mask: s.mask, moves: s.moves + 1, status: 'play' };
    if (s.cubes) {
        const me = s.cubes[s.active], other = s.cubes[1 - s.active];
        const nx = me[0] + d[0], ny = me[1] + d[1];
        if (nx === other[0] && ny === other[1]) return { state: s, events: [], moved: false };
        const cubes = [s.cubes[0].slice(), s.cubes[1].slice()];
        cubes[s.active] = [nx, ny];
        n.cubes = cubes;
        events.push({ kind: 'roll', cube: s.active });
        if (!solid(L, nx, ny, n.mask)) { n.status = 'fell'; events.push({ kind: 'fall', cells: [[nx, ny]] }); return { state: n, events, moved: true }; }
        const t = tileAt(L, nx, ny);
        if (t === T.SOFT) n.mask = applySwitch(L, L.switches[L.swOf[ny * L.w + nx]], n.mask, events);
        if (!solid(L, other[0], other[1], n.mask) || !solid(L, nx, ny, n.mask)) {
            n.status = 'fell'; events.push({ kind: 'fall', cells: [[nx, ny]] }); return { state: n, events, moved: true };
        }
        const ax = Math.abs(nx - other[0]), ay = Math.abs(ny - other[1]);
        if (ax + ay === 1) {
            n.cubes = null; n.active = 0;
            n.x = Math.min(nx, other[0]); n.y = Math.min(ny, other[1]); n.o = ax ? 1 : 2;
            events.push({ kind: 'merge' });
        }
        return { state: n, events, moved: true };
    }
    const r = rollBlock(s.x, s.y, s.o, d[0], d[1]);
    n.x = r[0]; n.y = r[1]; n.o = r[2];
    events.push({ kind: 'roll' });
    const cs = cells(n);
    const unsupported = cs.filter(c => !solid(L, c[0], c[1], n.mask));
    if (unsupported.length) { n.status = 'fell'; events.push({ kind: 'fall', cells: unsupported }); return { state: n, events, moved: true }; }
    if (n.o === 0 && tileAt(L, n.x, n.y) === T.FRAGILE) {
        n.status = 'fell'; events.push({ kind: 'fall', cells: cs, fragile: [n.x, n.y] }); return { state: n, events, moved: true };
    }
    for (const c of cs) {
        const t = tileAt(L, c[0], c[1]);
        if (t === T.SOFT || (t === T.HEAVY && n.o === 0)) n.mask = applySwitch(L, L.switches[L.swOf[c[1] * L.w + c[0]]], n.mask, events);
    }
    const after = cs.filter(c => !solid(L, c[0], c[1], n.mask));
    if (after.length) { n.status = 'fell'; events.push({ kind: 'fall', cells: after }); return { state: n, events, moved: true }; }
    if (n.o === 0 && L.goal[0] === n.x && L.goal[1] === n.y) { n.status = 'won'; events.push({ kind: 'win' }); return { state: n, events, moved: true }; }
    if (n.o === 0 && tileAt(L, n.x, n.y) === T.SPLIT) {
        const sp = L.splits[L.splitAt[n.y * L.w + n.x]];
        n.cubes = [sp.a.slice(), sp.b.slice()]; n.active = 0;
        events.push({ kind: 'split', from: [n.x, n.y] });
        const gone = n.cubes.filter(c => !solid(L, c[0], c[1], n.mask));
        if (gone.length) { n.status = 'fell'; events.push({ kind: 'fall', cells: gone }); return { state: n, events, moved: true }; }
        const ax = Math.abs(sp.a[0] - sp.b[0]), ay = Math.abs(sp.a[1] - sp.b[1]);
        if (ax + ay === 1) {
            n.cubes = null; n.x = Math.min(sp.a[0], sp.b[0]); n.y = Math.min(sp.a[1], sp.b[1]); n.o = ax ? 1 : 2;
            events.push({ kind: 'merge' });
        }
    }
    return { state: n, events, moved: true };
}
function swap(s) {
    if (!s.cubes || s.status !== 'play') return s;
    return Object.assign({}, s, { active: 1 - s.active });
}
function key(s) {
    return s.cubes
        ? 'c' + s.cubes[0][0] + ',' + s.cubes[0][1] + ',' + s.cubes[1][0] + ',' + s.cubes[1][1] + ',' + s.active + ',' + s.mask
        : 'b' + s.x + ',' + s.y + ',' + s.o + ',' + s.mask;
}

// ---------------------------------------------------------------- solver
// Breadth first over (block or both cubes, active cube, bridge mask). Swapping
// cubes is free, so it is a 0-1 BFS. Returns the fewest rolls and one path:
// U D L R for rolls, x for a swap.
function solve(L, limit) {
    const max = limit || 400000;
    const start = initial(L);
    const seen = new Map([[key(start), { prev: null, step: '', moves: 0 }]]);
    let explored = 0;
    const deque = [{ s: start, d: 0 }];
    let head = 0;
    // a simple deque: zero-cost swaps go to a side list processed first
    const zero = [];
    while (head < deque.length || zero.length) {
        const cur = zero.length ? zero.pop() : deque[head++];
        const s = cur.s, k = key(s), rec = seen.get(k);
        if (rec.done) continue;
        rec.done = true;
        if (++explored > max) return null;
        if (s.status === 'won') {
            let path = '', at = k;
            while (seen.get(at).prev) { path = seen.get(at).step + path; at = seen.get(at).prev; }
            return { moves: rec.moves, path, explored };
        }
        if (s.cubes) {
            const t = swap(s), tk = key(t), old = seen.get(tk);
            if (!old || (!old.done && old.moves > rec.moves)) { seen.set(tk, { prev: k, step: 'x', moves: rec.moves }); zero.push({ s: t, d: rec.moves }); }
        }
        for (const dir of 'UDLR') {
            const r = move(L, s, dir);
            if (!r.moved || r.state.status === 'fell') continue;
            const t = r.state;
            const tk = key(t), old = seen.get(tk);
            if (old && (old.done || old.moves <= rec.moves + 1)) continue;
            seen.set(tk, { prev: k, step: dir, moves: rec.moves + 1 });
            deque.push({ s: t, d: rec.moves + 1 });
        }
    }
    return null;
}

const api = { T, DIRS, LEVELS, parseLevel, passcode, levelForCode, initial, move, swap, solve, cells, solid, tileAt, key,
    level: i => parseLevel(LEVELS[i], i) };
root.BLOCKROLL_SIM = api;
if (typeof module === 'object' && module.exports) module.exports = api;
})();
