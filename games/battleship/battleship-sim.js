// ===================================================================
// battleship 98: the rules, the bot and the fair-play receipt
//
// No page in here, so node runs it (.github/scripts/check-battleship.mjs).
// The window and the picture belong to battleship.js.
//
// A 10x10 sea, a fleet of 5-4-3-3-2 (17 cells). Ships lie straight and
// never touch, not even at a corner, so the cells around a sunk ship are
// known water and a run of hits through the sinking shot is exactly the ship.
// A sinking answer says how long the ship was.
//
// A ship is { x, y, len, dir } with dir 'h' (grows in x) or 'v' (grows in y).
// Side 0 is the player, side 1 the bot (or the other player online).
// Turns alternate after every legal shot, hit or miss.
//
// Online, nobody is trusted with the other's fleet: each side keeps its own
// ships, answers shots itself and sends only commitFleet()'s hash up front.
// At the end both reveal ships + salt and verifyReveal() replays every answer
// they gave. A side that leaves before revealing loses (verdict()).
//
// The match is one plain object with the rng state on it, so it saves as JSON
// and the same seed and the same shots give the same match.
// ===================================================================
(function (root) {
    'use strict';

    const SIZE = 10;
    const FLEET = [5, 4, 3, 3, 2];
    const LEVELS = ['easy', 'normal', 'hard'];
    const MAX_TRIES = 200;

    // mulberry32. `o.rs` carries the state so a saved match carries it too.
    function nextRand(o) {
        o.rs = (o.rs + 0x6D2B79F5) >>> 0;
        let t = o.rs;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    // makeRng(seed) -> () => [0, 1); a function passes straight through
    function makeRng(seed) {
        if (typeof seed === 'function') return seed;
        const o = { rs: (seed >>> 0) || 1 };
        return () => nextRand(o);
    }
    const pick = (rand, list) => list[Math.floor(rand() * list.length)];

    const key = (x, y) => x + ',' + y;
    const inSea = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < SIZE && y < SIZE;

    function cellsOf(s) {
        const out = [];
        for (let i = 0; i < s.len; i++) out.push(s.dir === 'h' ? [s.x + i, s.y] : [s.x, s.y + i]);
        return out;
    }

    // the fleet is exactly 5-4-3-3-2, in the sea, and no two ships touch
    function fleetProblem(ships) {
        if (!Array.isArray(ships) || ships.length !== FLEET.length) return 'the fleet needs ' + FLEET.length + ' ships';
        const lens = ships.map(s => s && s.len).sort((a, b) => b - a);
        if (lens.join() !== FLEET.join()) return 'the fleet must be ' + FLEET.join('-');
        const owner = new Map();
        for (let i = 0; i < ships.length; i++) {
            const s = ships[i];
            if (s.dir !== 'h' && s.dir !== 'v') return 'a ship lies h or v';
            for (const [x, y] of cellsOf(s)) {
                if (!inSea(x, y)) return 'a ship is off the board';
                if (owner.has(key(x, y))) return 'two ships overlap';
                owner.set(key(x, y), i);
            }
        }
        for (const [k, i] of owner) {
            const [x, y] = k.split(',').map(Number);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                const j = owner.get(key(x + dx, y + dy));
                if (j !== undefined && j !== i) return 'two ships touch';
            }
        }
        return null;
    }
    const validFleet = ships => fleetProblem(ships) === null;

    // Every legal spot for each ship in turn, biggest first, so a dead end is
    // rare; on one, start the whole fleet again. Bounded: throws past MAX_TRIES.
    function placeFleet(rand) {
        for (let tries = 1; tries <= MAX_TRIES; tries++) {
            const blocked = new Set();
            const ships = [];
            for (const len of FLEET) {
                const spots = [];
                for (const dir of ['h', 'v']) for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) {
                    const s = { x, y, len, dir };
                    if (cellsOf(s).every(([cx, cy]) => inSea(cx, cy) && !blocked.has(key(cx, cy)))) spots.push(s);
                }
                if (!spots.length) break;
                const s = pick(rand, spots);
                ships.push(s);
                for (const [cx, cy] of cellsOf(s)) {
                    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) blocked.add(key(cx + dx, cy + dy));
                }
            }
            if (ships.length === FLEET.length) return { ships, tries };
        }
        throw new Error('could not place a fleet in ' + MAX_TRIES + ' tries');
    }
    const randomFleet = rand => placeFleet(typeof rand === 'function' ? rand : makeRng(rand)).ships;

    // What the owner of `ships` must say to a shot at (x, y), given the cells
    // already hit before it. Pure: the same call online and against the bot.
    function answer(ships, hitBefore, x, y) {
        for (const s of ships) {
            const cells = cellsOf(s);
            if (!cells.some(([cx, cy]) => cx === x && cy === y)) continue;
            const sunk = cells.every(([cx, cy]) => (cx === x && cy === y) || hitBefore.has(key(cx, cy)));
            return sunk ? { result: 'sunk', len: s.len } : { result: 'hit' };
        }
        return { result: 'miss' };
    }

    // ---------------------------------------------------------------
    // a match against the bot
    // ---------------------------------------------------------------
    function newGame(opts) {
        opts = opts || {};
        const g = {
            size: SIZE,
            level: LEVELS.indexOf(opts.level) >= 0 ? opts.level : 'easy',
            rs: (opts.seed >>> 0) || ((Math.random() * 4294967296) >>> 0) || 1,
            fleets: [null, null],
            shots: [[], []],     // shots[side] = what side fired, with the answer
            turn: 0,
            winner: null
        };
        const rand = () => nextRand(g);
        if (opts.fleet) {
            const why = fleetProblem(opts.fleet);
            if (why) throw new Error(why);
            g.fleets[0] = opts.fleet.map(s => ({ x: s.x, y: s.y, len: s.len, dir: s.dir }));
        } else g.fleets[0] = placeFleet(rand).ships;
        g.fleets[1] = placeFleet(rand).ships;
        return g;
    }
    const hitSet = list => new Set(list.filter(s => s.result !== 'miss').map(s => key(s.x, s.y)));
    const shotAt = (list, x, y) => list.some(s => s.x === x && s.y === y);

    // the side whose turn it is fires at (x, y)
    function fire(g, x, y) {
        const side = g.turn;
        if (g.winner !== null || !inSea(x, y) || shotAt(g.shots[side], x, y)) return { side, x, y, result: 'invalid' };
        const a = answer(g.fleets[1 - side], hitSet(g.shots[side]), x, y);
        const shot = Object.assign({ x, y }, a);
        g.shots[side].push(shot);
        const hits = g.shots[side].filter(s => s.result !== 'miss').length;
        if (hits === FLEET.reduce((n, l) => n + l, 0)) g.winner = side;
        else g.turn = 1 - side;
        return Object.assign({ side }, shot);
    }
    const over = g => (g.winner === null ? null : g.winner === 0 ? 'you' : 'bot');

    // What a shooter knows from its own shots alone: the sunk ships (the run of
    // hits through each sinking shot), the open hits, and the water, which is
    // every miss plus every cell around a sunk ship plus the diagonals of a hit.
    function knowledge(shots) {
        const hit = new Set(), water = new Set(), sunkCell = new Set(), sunkLens = [];
        const mark = (x, y) => { if (inSea(x, y) && !hit.has(key(x, y))) water.add(key(x, y)); };
        for (const s of shots) {
            if (s.result === 'miss') { water.add(key(s.x, s.y)); continue; }
            hit.add(key(s.x, s.y));
            if (s.result !== 'sunk') continue;
            sunkLens.push(s.len);
            let run = [[s.x, s.y]];
            for (const [dx, dy] of [[1, 0], [0, 1]]) {
                const line = [[s.x, s.y]];
                for (let k = 1; hit.has(key(s.x + dx * k, s.y + dy * k)); k++) line.push([s.x + dx * k, s.y + dy * k]);
                for (let k = 1; hit.has(key(s.x - dx * k, s.y - dy * k)); k++) line.push([s.x - dx * k, s.y - dy * k]);
                if (line.length > run.length) run = line;
            }
            for (const [x, y] of run) sunkCell.add(key(x, y));
        }
        for (const k of hit) {
            const [x, y] = k.split(',').map(Number);
            mark(x - 1, y - 1); mark(x + 1, y - 1); mark(x - 1, y + 1); mark(x + 1, y + 1);
            if (sunkCell.has(k)) { mark(x - 1, y); mark(x + 1, y); mark(x, y - 1); mark(x, y + 1); }
        }
        const open = [...hit].filter(k => !sunkCell.has(k)).map(k => k.split(',').map(Number));
        const left = FLEET.slice();
        for (const l of sunkLens) { const i = left.indexOf(l); if (i >= 0) left.splice(i, 1); }
        return { hit, water, open, left };
    }

    // easy: anywhere not fired at. normal: anywhere not known to be water, and
    // finish a ship it has hit. hard: the cell the most remaining placements
    // of the remaining ships cover, open hits weighing heavily.
    function botMove(g) {
        const side = g.turn;
        const rand = () => nextRand(g);
        const shots = g.shots[side];
        const fresh = [];
        for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) if (!shotAt(shots, x, y)) fresh.push([x, y]);
        if (!fresh.length) return null;
        const asMove = c => ({ x: c[0], y: c[1] });
        if (g.level === 'easy') return asMove(pick(rand, fresh));

        const K = knowledge(shots);
        const unknown = fresh.filter(([x, y]) => !K.water.has(key(x, y)));
        const pool = unknown.length ? unknown : fresh;
        if (g.level === 'normal') {
            if (K.open.length) {
                const want = [];
                const openSet = new Set(K.open.map(([x, y]) => key(x, y)));
                for (const [x, y] of K.open) {
                    const lineH = openSet.has(key(x - 1, y)) || openSet.has(key(x + 1, y));
                    const lineV = openSet.has(key(x, y - 1)) || openSet.has(key(x, y + 1));
                    const dirs = lineH ? [[1, 0], [-1, 0]] : lineV ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
                    for (const [dx, dy] of dirs) want.push([x + dx, y + dy]);
                }
                const ok = want.filter(([x, y]) => pool.some(([px, py]) => px === x && py === y));
                if (ok.length) return asMove(pick(rand, ok));
            }
            return asMove(pick(rand, pool));
        }
        // hard
        const score = new Map();
        const blocked = (x, y) => !inSea(x, y) || K.water.has(key(x, y)) || (K.hit.has(key(x, y)) && !K.open.some(([ox, oy]) => ox === x && oy === y));
        for (const len of K.left) {
            for (const dir of ['h', 'v']) for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) {
                const cells = cellsOf({ x, y, len, dir });
                if (cells.some(([cx, cy]) => blocked(cx, cy))) continue;
                const covers = cells.filter(([cx, cy]) => K.hit.has(key(cx, cy))).length;
                if (K.open.length && !covers) continue;     // hunting a hit ship: only placements through it
                const w = 1 + covers * 20;
                for (const [cx, cy] of cells) if (!K.hit.has(key(cx, cy))) score.set(key(cx, cy), (score.get(key(cx, cy)) || 0) + w);
            }
        }
        let best = -1, top = [];
        for (const [x, y] of pool) {
            const v = score.get(key(x, y)) || 0;
            if (v > best) { best = v; top = [[x, y]]; } else if (v === best) top.push([x, y]);
        }
        return asMove(pick(rand, top));
    }

    // ---------------------------------------------------------------
    // online: commit at the start, reveal and replay at the end
    // ---------------------------------------------------------------
    const encodeFleet = ships => ships.map(s => [s.x, s.y, s.len, s.dir].join(',')).sort().join(';');
    function subtle() {
        const c = (typeof root.crypto !== 'undefined' && root.crypto) || (typeof require === 'function' ? require('crypto').webcrypto : null);
        if (!c || !c.subtle) throw new Error('no web crypto here');
        return c;
    }
    function newSalt() {
        const b = new Uint8Array(16);
        subtle().getRandomValues(b);
        return [...b].map(n => n.toString(16).padStart(2, '0')).join('');
    }
    async function commitFleet(ships, salt) {
        const data = new TextEncoder().encode(String(salt) + '|' + encodeFleet(ships));
        const h = await subtle().subtle.digest('SHA-256', data);
        return [...new Uint8Array(h)].map(n => n.toString(16).padStart(2, '0')).join('');
    }
    // log: every answer this side gave, in order: [{ x, y, result, len? }]
    async function verifyReveal(r) {
        if (!r || !r.ships || r.salt === undefined) return { ok: false, reason: 'nothing revealed' };
        if ((await commitFleet(r.ships, r.salt)) !== r.commitment) return { ok: false, reason: 'the fleet is not the one committed to' };
        const why = fleetProblem(r.ships);
        if (why) return { ok: false, reason: 'illegal fleet: ' + why };
        const hit = new Set(), seen = new Set();
        for (let i = 0; i < (r.log || []).length; i++) {
            const s = r.log[i];
            if (!inSea(s.x, s.y) || seen.has(key(s.x, s.y))) return { ok: false, reason: 'shot ' + (i + 1) + ' is not a fresh cell' };
            seen.add(key(s.x, s.y));
            const a = answer(r.ships, hit, s.x, s.y);
            if (a.result !== s.result || (a.result === 'sunk' && a.len !== s.len)) {
                return { ok: false, reason: 'shot ' + (i + 1) + ' at ' + key(s.x, s.y) + ' was answered ' + s.result + (s.len ? ' ' + s.len : '') + ', the fleet says ' + a.result + (a.len ? ' ' + a.len : '') };
            }
            if (a.result !== 'miss') hit.add(key(s.x, s.y));
        }
        return { ok: true };
    }
    // the end screen: no reveal is a forfeit, a failed check voids the match
    const verdict = (revealed, check) => (!revealed ? 'forfeit' : check && check.ok ? 'verified' : 'void');

    const BATTLESHIP_SIM = {
        SIZE, FLEET, LEVELS, MAX_TRIES,
        makeRng, cellsOf, fleetProblem, validFleet, placeFleet, randomFleet, answer,
        newGame, fire, botMove, over, knowledge,
        encodeFleet, newSalt, commitFleet, verifyReveal, verdict
    };
    root.BATTLESHIP_SIM = BATTLESHIP_SIM;
    if (typeof module === 'object' && module.exports) module.exports = BATTLESHIP_SIM;
})(typeof window !== 'undefined' ? window : globalThis);
