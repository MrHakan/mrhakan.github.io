// deep drill 98 - rules and simulation. No DOM: deep-drill.js draws it and
// .github/scripts/check-deepdrill.mjs tests it in node. Units are tiles and
// seconds; one tile is 5 m of depth. Everything is driven by a fixed 60 Hz
// step and a seeded world, so the same seed and the same keys replay exactly.
(function (root) {
'use strict';

const W = 32, SURF = 6, METERS = 5, GOAL_M = 1500;
const CAVE_FLOOR = SURF + GOAL_M / METERS;          // first bedrock row of the core cavern
const CAVE_TOP = CAVE_FLOOR - 12;                   // the cavern is 12 rows tall
const H = CAVE_FLOOR + 4;
const HALF = 0.4, DT = 1 / 60;
const G = 20, MAX_FALL = 16, FALL_SAFE = 10, FALL_DMG = 1.6;
const SPAWN_X = 11.5, SPAWN_Y = SURF - HALF;

const T = { EMPTY: 0, DIRT: 1, ROCK: 2, GAS: 3, LAVA: 4, BEDROCK: 5, PAD: 6, CORE: 7, FOSSIL: 20, TREASURE: 21 };
const ORE0 = 10;
// name, price, colour, first depth (m), richest depth (m), spread (m)
const ORES = [
    ['rustite', 25, '#c0643a', 0, 60, 220],
    ['copperite', 55, '#f09440', 25, 200, 220],
    ['silverine', 120, '#dfe5ee', 100, 380, 260],
    ['gold nugget', 250, '#ffd23f', 220, 560, 280],
    ['platinum', 500, '#a8eeff', 380, 780, 300],
    ['jade', 900, '#3ddc84', 560, 980, 300],
    ['ruby', 1500, '#ff3355', 760, 1180, 300],
    ['diamond', 2600, '#f4fdff', 960, 1380, 300],
    ['quasarite', 5000, '#c45cff', 1180, 1500, 260]
].map(([name, price, color, min, peak, sd], i) => ({ id: ORE0 + i, name, price, color, min, peak, sd }));
const FOSSIL = { id: T.FOSSIL, name: 'emoji fossil', price: 700, color: '#efe6cf' };
const CARGO_KINDS = ORES.concat([FOSSIL]);

const BUILDINGS = [
    { id: 'fuel', name: 'fuel station', x0: 1, x1: 3 },
    { id: 'sell', name: 'ore buyer', x0: 6, x1: 8 },
    { id: 'upgrade', name: 'upgrade shop', x0: 14, x1: 17 },
    { id: 'repair', name: 'repair bay', x0: 21, x1: 23 },
    { id: 'items', name: 'item shop', x0: 26, x1: 29 }
];
const COST = [0, 400, 1500, 4000, 9000, 20000];
const UPGRADES = [
    { id: 'drill', name: 'drill bit', unit: 'x speed', vals: [1, 1.35, 1.8, 2.4, 3.2, 4.2] },
    { id: 'hull', name: 'hull', unit: 'hp', vals: [10, 18, 30, 48, 75, 110] },
    { id: 'engine', name: 'engine', unit: 'thrust', vals: [30, 34, 39, 45, 52, 60] },
    { id: 'tank', name: 'fuel tank', unit: 'L', vals: [10, 16, 25, 38, 56, 80] },
    { id: 'rad', name: 'radiator', unit: 'cool', vals: [0, 1, 2, 3, 4, 5] },
    { id: 'cargo', name: 'cargo bay', unit: 'slots', vals: [7, 13, 22, 35, 55, 80] }
];
const ITEMS = [
    { id: 'dynamite', name: 'dynamite', price: 250, desc: 'blasts the 3x3 around you, boulders too' },
    { id: 'c4', name: 'plastic explosive', price: 700, desc: 'a bigger 5x5 blast' },
    { id: 'teleport', name: 'quantum teleporter', price: 500, desc: 'back to the surface, now' },
    { id: 'repairkit', name: 'repair kit', price: 600, desc: '+25 hull anywhere' },
    { id: 'reserve', name: 'reserve fuel', price: 450, desc: '+20 L anywhere' }
];
const FUEL_PRICE = 2, REPAIR_PRICE = 12, ITEM_MAX = 9;
const BURN = { idle: 0.04, move: 0.1, thrust: 0.28, drill: 0.22 };

// mulberry32: tiny, fast, good enough for a world
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const depthOfRow = y => (y - SURF) * METERS;
const padAt = x => BUILDINGS.some(b => x >= b.x0 && x <= b.x1);
const CHUNK = 8, CHUNK_COLS = W / CHUNK;

function pickOre(r, d) {
    let total = 0;
    const w = ORES.map(o => { const v = d >= o.min ? Math.exp(-(((d - o.peak) / o.sd) ** 2)) : 0; total += v; return v; });
    let u = r() * total;
    for (let i = 0; i < w.length; i++) { u -= w[i]; if (u <= 0 && w[i] > 0) return ORES[i].id; }
    return ORES[0].id;
}

function genWorld(seed) {
    seed = seed >>> 0;
    const r = rng(seed ^ 0x9e3779b9), tiles = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let t = T.EMPTY;
        if (y >= SURF) {
            if (x === 0 || x === W - 1 || y >= CAVE_FLOOR) t = T.BEDROCK;
            else if (y === SURF && padAt(x)) t = T.PAD;
            else {
                const d = depthOfRow(y), u = r(), f = d / GOAL_M;
                const rockP = y < SURF + 3 ? 0 : 0.03 + f * 0.12;
                const gasP = d < 200 ? 0 : 0.008 + f * 0.02;
                const lavaP = d < 450 ? 0 : 0.01 + (d - 450) / 1050 * 0.05;
                const oreP = 0.16 + f * 0.06;
                const fosP = d < 100 ? 0 : 0.004, treP = d < 200 ? 0 : 0.0025;
                let c = rockP;
                t = T.DIRT;
                if (u < c) t = T.ROCK;
                else if (u < (c += gasP)) t = T.GAS;
                else if (u < (c += lavaP)) t = T.LAVA;
                else if (u < (c += fosP)) t = T.FOSSIL;
                else if (u < (c += treP)) t = T.TREASURE;
                else if (u < (c += oreP)) t = pickOre(r, d);
            }
        }
        tiles[y * W + x] = t;
    }
    // small air pockets to fall into
    for (let y = SURF + 10; y < CAVE_TOP - 3; y++) {
        if (r() >= 0.06) continue;
        const w = 2 + Math.floor(r() * 4), h = 1 + Math.floor(r() * 2), x0 = 1 + Math.floor(r() * (W - 2 - w));
        for (let yy = y; yy < y + h; yy++) for (let xx = x0; xx < x0 + w; xx++) tiles[yy * W + xx] = T.EMPTY;
    }
    // the core cavern: open hall, lava pools at the walls, a few ledges, the core on the floor
    for (let y = CAVE_TOP; y < CAVE_FLOOR; y++) for (let x = 3; x <= W - 4; x++) tiles[y * W + x] = T.EMPTY;
    for (const x of [3, 4, 5, W - 6, W - 5, W - 4]) tiles[(CAVE_FLOOR - 1) * W + x] = T.LAVA;
    for (let i = 0; i < 3; i++) {
        const x0 = [4, 8, 19][i] + Math.floor(r() * 3), y = CAVE_TOP + 4 + Math.floor(r() * 3);
        for (let x = x0; x < x0 + 3; x++) tiles[y * W + x] = T.ROCK;
    }
    for (let y = CAVE_FLOOR - 3; y < CAVE_FLOOR; y++) for (let x = 14; x <= 16; x++) tiles[y * W + x] = T.CORE;
    return { seed, w: W, h: H, tiles, ver: new Uint32Array(Math.ceil(H / CHUNK) * CHUNK_COLS) };
}

function tileAt(world, x, y) {
    if (x < 0 || x >= W || y >= H) return T.BEDROCK;
    if (y < 0) return T.EMPTY;
    return world.tiles[y * W + x];
}
function bump(world, x, y) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    world.ver[(y >> 3) * CHUNK_COLS + (x >> 3)]++;
}
function setTile(world, x, y, t) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    world.tiles[y * W + x] = t;
    bump(world, x, y); bump(world, x - 1, y); bump(world, x + 1, y); bump(world, x, y - 1); bump(world, x, y + 1);
}
const solid = t => t !== T.EMPTY;
const drillable = t => t !== T.EMPTY && t !== T.ROCK && t !== T.BEDROCK && t !== T.PAD;
const isOre = t => t >= ORE0 && t < ORE0 + ORES.length;
const cargoInfo = t => (t === T.FOSSIL ? FOSSIL : isOre(t) ? ORES[t - ORE0] : null);

function hardness(t, y) {
    let h = 0.5;
    if (isOre(t)) h = 0.6 + (t - ORE0) * 0.07;
    else if (t === T.FOSSIL || t === T.TREASURE || t === T.LAVA) h = 0.65;
    else if (t === T.CORE) h = 3.2;
    return h * (1 + Math.max(0, depthOfRow(y)) / GOAL_M * 0.8);
}

function stat(s, id) { const u = UPGRADES.find(x => x.id === id); return u.vals[s.up[id]]; }

function newGame(seed) {
    const world = genWorld(seed);
    const s = {
        v: 1, seed: world.seed, world, time: 0, tick: 0,
        pod: { x: SPAWN_X, y: SPAWN_Y, vx: 0, vy: 0, grounded: true, face: 1, thrust: false, drill: null, air: 0 },
        up: { drill: 0, hull: 0, engine: 0, tank: 0, rad: 0, cargo: 0 },
        items: { dynamite: 0, c4: 0, teleport: 0, repairkit: 0, reserve: 0 },
        cash: 0, earned: 0, hull: 0, fuel: 0,
        cargo: CARGO_KINDS.map(() => 0), cargoCount: 0,
        maxDepth: 0, wrecks: 0, trips: 0, flareT: 0, heat: 0, coreLeft: 9,
        over: false, won: false, reason: '', events: [], lastWarn: -9
    };
    s.hull = stat(s, 'hull'); s.fuel = stat(s, 'tank');
    return s;
}

function emit(s, e) {
    s.events.push(e);
    if (s.events.length > 64) s.events.splice(0, 32);
}
function damage(s, amount, why) {
    if (amount <= 0 || s.over) return;
    s.hull = Math.max(0, s.hull - amount);
    emit(s, { type: 'damage', amount, why });
    if (s.hull <= 0) end(s, false, why === 'fall' ? 'the fall cracked the hull' : why === 'gas' ? 'a gas pocket blew the hull' :
        why === 'lava' ? 'the pod melted in lava' : why === 'heat' ? 'the pod cooked in the deep heat' : why === 'flare' ? 'the core flare fried the pod' : 'hull breach');
}
function end(s, won, reason) {
    if (s.over) return;
    s.over = true; s.won = won; s.reason = reason;
    s.pod.drill = null; s.pod.thrust = false;
    emit(s, { type: won ? 'win' : 'lose', reason });
}

const depthM = s => Math.max(0, Math.round((s.pod.y - (SURF - HALF)) * METERS));
const onSurface = s => s.pod.y < SURF;

function burn(s, litres) {
    if (s.over) return;
    s.fuel = Math.max(0, s.fuel - litres);
    if (s.fuel <= 0 && depthM(s) > METERS) end(s, false, 'out of fuel underground');
}

function tryDrill(s, dx, dy) {
    const p = s.pod, cx = Math.floor(p.x), cy = Math.floor(p.y), tx = cx + dx, ty = cy + dy;
    const t = tileAt(s.world, tx, ty);
    if (!drillable(t)) {
        if ((t === T.ROCK || t === T.BEDROCK) && s.time - s.lastWarn > 1.5) {
            s.lastWarn = s.time;
            emit(s, { type: 'blocked', tile: t });
        }
        return false;
    }
    const dur = hardness(t, ty) / stat(s, 'drill');
    p.drill = { tx, ty, dx, dy, t: 0, dur, x0: p.x, y0: p.y, x1: tx + 0.5, y1: dy ? ty + 1 - HALF : p.y };
    p.vx = 0; p.vy = 0; p.face = dx || p.face;
    return true;
}

function collect(s, t, x, y) {
    const info = cargoInfo(t);
    if (info) {
        if (s.cargoCount >= stat(s, 'cargo')) { emit(s, { type: 'full', name: info.name }); return; }
        s.cargo[CARGO_KINDS.indexOf(info)]++; s.cargoCount++;
        emit(s, { type: 'ore', tile: t, name: info.name, price: info.price, x, y });
    } else if (t === T.TREASURE) {
        const value = Math.round((1000 + depthOfRow(y) * 3) / 50) * 50;
        s.cash += value; s.earned += value;
        emit(s, { type: 'treasure', value, x, y });
    } else if (t === T.GAS) {
        damage(s, 3 + depthOfRow(y) / 80, 'gas');
        emit(s, { type: 'gas', x, y });
    } else if (t === T.LAVA) {
        damage(s, (8 + depthOfRow(y) / 50) * (1 - 0.15 * stat(s, 'rad')), 'lava');
        emit(s, { type: 'lava', x, y });
    } else if (t === T.CORE) {
        s.coreLeft--;
        emit(s, { type: 'core', left: s.coreLeft, x, y });
        if (s.coreLeft <= 0) {
            s.cash += 25000; s.earned += 25000;
            end(s, true, 'you cracked the core');
        }
    }
}

function finishDrill(s) {
    const p = s.pod, d = p.drill;
    const t = tileAt(s.world, d.tx, d.ty);
    p.x = d.x1; p.y = d.y1; p.drill = null; p.vx = 0; p.vy = 0;
    setTile(s.world, d.tx, d.ty, T.EMPTY);
    collect(s, t, d.tx, d.ty);
}

// pod box vs tile grid, one axis at a time. A blocked move that only clips a
// corner (under 0.3 of a tile) slides the pod into line instead, so flying
// into a one-tile shaft or side passage does not need pixel-perfect aim.
const NUDGE = 0.3;
function moveX(s, dist) {
    const p = s.pod, world = s.world;
    let nx = p.x + dist, hit = 0;
    const y0 = Math.floor(p.y - HALF + 1e-4), y1 = Math.floor(p.y + HALF - 1e-4);
    if (dist !== 0) {
        const c = dist > 0 ? Math.floor(nx + HALF) : Math.floor(nx - HALF);
        const a = solid(tileAt(world, c, y0)), b = y1 !== y0 && solid(tileAt(world, c, y1));
        if (a && b || a && y0 === y1) hit = dist > 0 ? 1 : -1;
        else if (a) {
            if (y0 + 1 - (p.y - HALF) < NUDGE) p.y = y0 + 1 + HALF; else hit = dist > 0 ? 1 : -1;
        } else if (b) {
            if (p.y + HALF - y1 < NUDGE && !p.grounded) p.y = y1 - HALF; else hit = dist > 0 ? 1 : -1;
        }
        if (hit) nx = dist > 0 ? c - HALF : c + 1 + HALF;
    }
    p.x = nx;
    if (hit) p.vx = 0;
    return hit;
}
function moveY(s, dist) {
    const p = s.pod, world = s.world;
    let ny = p.y + dist, hit = 0;
    const x0 = Math.floor(p.x - HALF + 1e-4), x1 = Math.floor(p.x + HALF - 1e-4);
    if (dist !== 0) {
        const r = dist > 0 ? Math.floor(ny + HALF) : Math.floor(ny - HALF);
        const a = solid(tileAt(world, x0, r)), b = x1 !== x0 && solid(tileAt(world, x1, r));
        if (a && b || a && x0 === x1) hit = dist > 0 ? 1 : -1;
        else if (a) {
            if (dist < 0 && x0 + 1 - (p.x - HALF) < NUDGE) p.x = x0 + 1 + HALF; else hit = dist > 0 ? 1 : -1;
        } else if (b) {
            if (dist < 0 && p.x + HALF - x1 < NUDGE) p.x = x1 - HALF; else hit = dist > 0 ? 1 : -1;
        }
        if (hit) ny = dist > 0 ? r - HALF : r + 1 + HALF;
    }
    p.y = ny;
    return hit;
}

const NO_INPUT = { left: false, right: false, up: false, down: false };

function step(s, input) {
    if (s.over) return false;
    const inp = input || NO_INPUT, p = s.pod;
    s.time += DT; s.tick++;
    p.thrust = false;
    if (p.drill) {
        const d = p.drill;
        d.t += DT;
        const k = Math.min(1, d.t / d.dur);
        p.x = d.x0 + (d.x1 - d.x0) * k; p.y = d.y0 + (d.y1 - d.y0) * k;
        burn(s, BURN.drill * DT);
        if (k >= 1 && !s.over) finishDrill(s);
    } else {
        const eng = s.up.engine, dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        const maxVx = 3.6 + eng * 0.35, maxUp = 4 + eng * 0.9;
        if (dir) {
            p.vx += dir * (p.grounded ? 22 : 14) * DT;
            if (p.vx > maxVx) p.vx = maxVx; else if (p.vx < -maxVx) p.vx = -maxVx;
            p.face = dir;
        } else {
            const f = (p.grounded ? 24 : 8) * DT;
            p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
        }
        p.vy += G * DT;
        if (inp.up && s.fuel > 0) {
            p.vy -= stat(s, 'engine') * DT;
            if (p.vy < -maxUp) p.vy = -maxUp;
            p.thrust = true;
        }
        if (p.vy > MAX_FALL) p.vy = MAX_FALL;
        const wasGrounded = p.grounded, fallSpeed = p.vy;
        const hitX = moveX(s, p.vx * DT);
        const hitY = moveY(s, p.vy * DT);
        p.grounded = hitY === 1;
        if (hitY) {
            if (hitY === 1 && !wasGrounded && fallSpeed > FALL_SAFE) {
                damage(s, (fallSpeed - FALL_SAFE) * FALL_DMG, 'fall');
                emit(s, { type: 'thud', speed: fallSpeed });
            }
            p.vy = 0;
        }
        if (p.x < HALF) { p.x = HALF; p.vx = 0; } else if (p.x > W - HALF) { p.x = W - HALF; p.vx = 0; }
        if (p.y < HALF) { p.y = HALF; p.vy = Math.max(0, p.vy); }
        p.air = p.grounded ? 0 : p.air + DT;
        if (!s.over && p.grounded) {
            if (inp.down) tryDrill(s, 0, 1);
            else if (dir && hitX === dir) tryDrill(s, dir, 0);
        }
        // the surface is a free parking lot; underground the engine always runs
        const parked = onSurface(s) && p.grounded && !p.thrust;
        if (!parked) burn(s, (p.thrust ? BURN.thrust : dir ? BURN.move : BURN.idle) * DT);
    }
    hazards(s);
    const d = depthM(s);
    if (d > s.maxDepth) {
        if (s.maxDepth < 1000 && d >= 1000) emit(s, { type: 'milestone', depth: 1000 });
        s.maxDepth = d;
    }
    return true;
}

function hazards(s) {
    if (s.over) return;
    const p = s.pod, d = depthM(s), rad = stat(s, 'rad');
    // ambient heat below 600 m, beaten by the radiator
    s.heat = Math.max(0, (d - 600) / 225 - rad);
    if (s.heat > 0) damage(s, s.heat * 0.6 * DT, 'heat');
    // sitting on lava
    if (p.grounded && !p.drill) {
        const below = tileAt(s.world, Math.floor(p.x), Math.floor(p.y + HALF + 0.05));
        if (below === T.LAVA) damage(s, 4 * (1 - 0.15 * rad) * DT, 'lava');
    }
    // the core flares every few seconds while it stands
    if (s.coreLeft > 0 && p.y >= CAVE_TOP) {
        s.flareT += DT;
        if (s.flareT >= 2.4) {
            s.flareT = 0;
            const near = Math.hypot(p.x - 15.5, p.y - (CAVE_FLOOR - 1.5)) < 6.5;
            emit(s, { type: 'flare', hit: near });
            if (near) damage(s, 2.5 * (1 - 0.12 * rad), 'flare');
        }
    } else s.flareT = 0;
}

// ---- surface buildings ----
function building(s) {
    const p = s.pod;
    if (s.over || !p.grounded || p.y >= SURF || p.drill) return null;
    const x = Math.floor(p.x);
    return BUILDINGS.find(b => x >= b.x0 && x <= b.x1) || null;
}
const fail = msg => ({ ok: false, msg });
function at(s, id) { const b = building(s); return b && b.id === id; }

function cargoValue(s) { return s.cargo.reduce((sum, n, i) => sum + n * CARGO_KINDS[i].price, 0); }
function sell(s) {
    if (!at(s, 'sell')) return fail('drive up to the ore buyer first');
    if (!s.cargoCount) return fail('the cargo bay is empty');
    const value = cargoValue(s), count = s.cargoCount;
    s.cash += value; s.earned += value; s.trips++;
    s.cargo.fill(0); s.cargoCount = 0;
    emit(s, { type: 'sold', value, count });
    return { ok: true, value, count, msg: 'sold ' + count + ' for $' + value };
}
function buyFuel(s, litres) {
    if (!at(s, 'fuel')) return fail('drive up to the fuel station first');
    const room = stat(s, 'tank') - s.fuel;
    let want = Math.min(room, litres == null ? room : litres, s.cash / FUEL_PRICE);
    want = Math.floor(want * 10) / 10;
    if (room <= 0.05) return fail('the tank is already full');
    if (want <= 0) return fail('no cash for fuel');
    const cost = Math.ceil(want * FUEL_PRICE);
    s.cash -= cost; s.fuel = Math.min(stat(s, 'tank'), s.fuel + want);
    if (stat(s, 'tank') - s.fuel < 0.1) s.fuel = stat(s, 'tank');
    return { ok: true, cost, msg: 'pumped ' + want.toFixed(1) + ' L for $' + cost };
}
function repair(s, hp) {
    if (!at(s, 'repair')) return fail('drive up to the repair bay first');
    const room = stat(s, 'hull') - s.hull;
    if (room <= 0.05) return fail('the hull is already fine');
    const want = Math.min(room, hp == null ? room : hp, s.cash / REPAIR_PRICE);
    if (want <= 0.05) return fail('no cash for repairs');
    const cost = Math.ceil(want * REPAIR_PRICE);
    s.cash -= cost; s.hull = Math.min(stat(s, 'hull'), s.hull + want);
    if (stat(s, 'hull') - s.hull < 0.1) s.hull = stat(s, 'hull');
    return { ok: true, cost, msg: 'patched ' + Math.round(want) + ' hp for $' + cost };
}
function upgrade(s, id) {
    if (!at(s, 'upgrade')) return fail('drive up to the upgrade shop first');
    const u = UPGRADES.find(x => x.id === id);
    if (!u) return fail('no such part');
    const lvl = s.up[id];
    if (lvl >= 5) return fail(u.name + ' is maxed out');
    const cost = COST[lvl + 1];
    if (s.cash < cost) return fail('need $' + cost);
    const before = u.vals[lvl];
    s.cash -= cost; s.up[id] = lvl + 1;
    if (id === 'hull') s.hull += u.vals[lvl + 1] - before;
    if (id === 'tank') s.fuel += u.vals[lvl + 1] - before;
    emit(s, { type: 'upgrade', id, level: lvl + 1 });
    return { ok: true, cost, msg: u.name + ' mk ' + (lvl + 2) + ' fitted' };
}
function buyItem(s, id) {
    if (!at(s, 'items')) return fail('drive up to the item shop first');
    const it = ITEMS.find(x => x.id === id);
    if (!it) return fail('no such item');
    if (s.items[id] >= ITEM_MAX) return fail('your pockets are full of ' + it.name);
    if (s.cash < it.price) return fail('need $' + it.price);
    s.cash -= it.price; s.items[id]++;
    return { ok: true, cost: it.price, msg: 'bought ' + it.name };
}
function explode(s, radius) {
    const p = s.pod, cx = Math.floor(p.x), cy = Math.floor(p.y);
    let cleared = 0;
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
        if (radius > 1 && Math.abs(x - cx) === radius && Math.abs(y - cy) === radius) continue;
        const t = tileAt(s.world, x, y);
        if (y < SURF || t === T.EMPTY || t === T.BEDROCK || t === T.PAD || t === T.CORE) continue;
        setTile(s.world, x, y, T.EMPTY); cleared++;
    }
    p.grounded = false;
    emit(s, { type: 'boom', x: cx, y: cy, radius, cleared });
    return cleared;
}
function useItem(s, id) {
    if (s.over) return fail('the run is over');
    if (s.pod.drill) return fail('wait for the drill to stop');
    if (!(s.items[id] > 0)) return fail('you have no ' + (ITEMS.find(x => x.id === id) || { name: id }).name);
    const p = s.pod;
    if ((id === 'dynamite' || id === 'c4') && onSurface(s)) return fail('not near the buildings, please');
    if (id === 'repairkit' && s.hull >= stat(s, 'hull')) return fail('the hull is already fine');
    if (id === 'reserve' && s.fuel >= stat(s, 'tank')) return fail('the tank is already full');
    s.items[id]--;
    if (id === 'dynamite') explode(s, 1);
    else if (id === 'c4') explode(s, 2);
    else if (id === 'teleport') {
        p.x = SPAWN_X; p.y = SPAWN_Y; p.vx = 0; p.vy = 0; p.grounded = true; p.air = 0;
        emit(s, { type: 'teleport' });
    } else if (id === 'repairkit') s.hull = Math.min(stat(s, 'hull'), s.hull + 25);
    else if (id === 'reserve') s.fuel = Math.min(stat(s, 'tank'), s.fuel + 20);
    emit(s, { type: 'item', id });
    return { ok: true, msg: (ITEMS.find(x => x.id === id)).name + ' used' };
}

// ---- saves: plain json, the world as one character per tile ----
const CODES = [0, 1, 2, 3, 4, 5, 6, 7, 20, 21].concat(ORES.map(o => o.id));
function serialize(s) {
    let tiles = '';
    const t = s.world.tiles;
    for (let i = 0; i < t.length; i += 512) tiles += String.fromCharCode.apply(null, Array.from(t.subarray(i, i + 512), v => 48 + v));
    const p = s.pod;
    return JSON.stringify({
        v: 1, seed: s.seed, time: s.time, tick: s.tick, tiles,
        pod: { x: p.x, y: p.y, face: p.face },
        up: s.up, items: s.items, cash: s.cash, earned: s.earned, hull: s.hull, fuel: s.fuel,
        cargo: s.cargo, maxDepth: s.maxDepth, wrecks: s.wrecks, trips: s.trips, coreLeft: s.coreLeft
    });
}
function deserialize(text) {
    try {
        const o = JSON.parse(text);
        const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
        if (!o || o.v !== 1 || !Number.isInteger(o.seed) || typeof o.tiles !== 'string' || o.tiles.length !== W * H) return null;
        const s = newGame(o.seed);
        for (let i = 0; i < o.tiles.length; i++) {
            const c = o.tiles.charCodeAt(i) - 48;
            if (!CODES.includes(c)) return null;
            s.world.tiles[i] = c;
        }
        for (const u of UPGRADES) { if (!Number.isInteger(o.up?.[u.id]) || o.up[u.id] < 0 || o.up[u.id] > 5) return null; s.up[u.id] = o.up[u.id]; }
        for (const it of ITEMS) { if (!Number.isInteger(o.items?.[it.id]) || o.items[it.id] < 0 || o.items[it.id] > ITEM_MAX) return null; s.items[it.id] = o.items[it.id]; }
        if (!Array.isArray(o.cargo) || o.cargo.length !== CARGO_KINDS.length || !o.cargo.every(n => Number.isInteger(n) && n >= 0)) return null;
        if (!num(o.cash, 0, 1e9) || !num(o.earned, 0, 1e9) || !num(o.hull, 0.01, stat(s, 'hull')) || !num(o.fuel, 0, stat(s, 'tank'))) return null;
        if (!o.pod || !num(o.pod.x, HALF, W - HALF) || !num(o.pod.y, HALF, H)) return null;
        s.cargo = o.cargo.slice(); s.cargoCount = s.cargo.reduce((a, b) => a + b, 0);
        Object.assign(s, { cash: o.cash, earned: o.earned, hull: o.hull, fuel: o.fuel, time: num(o.time, 0, 1e8) ? o.time : 0,
            tick: Number.isInteger(o.tick) ? o.tick : 0, maxDepth: num(o.maxDepth, 0, 2000) ? o.maxDepth : 0,
            wrecks: Number.isInteger(o.wrecks) ? o.wrecks : 0, trips: Number.isInteger(o.trips) ? o.trips : 0,
            coreLeft: Number.isInteger(o.coreLeft) && o.coreLeft >= 1 && o.coreLeft <= 9 ? o.coreLeft : 9 });
        s.pod.x = o.pod.x; s.pod.y = o.pod.y; s.pod.face = o.pod.face === -1 ? -1 : 1; s.pod.grounded = false;
        return s;
    } catch (_) { return null; }
}

// first step of the shortest open-tile path from (x, y) up into the sky, or -1
function route(s, x, y) {
    const t = s.world.tiles, prev = new Int32Array(W * H).fill(-2), start = y * W + x, queue = [start];
    prev[start] = -1;
    for (let qi = 0; qi < queue.length; qi++) {
        const c = queue[qi], cx = c % W, cy = (c - cx) / W;
        if (cy < SURF) {
            let k = c;
            while (prev[k] !== start && prev[k] !== -1) k = prev[k];
            return k === start ? -1 : k;
        }
        for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const n = ny * W + nx;
            if (prev[n] !== -2 || t[n] !== T.EMPTY) continue;
            prev[n] = c; queue.push(n);
        }
    }
    return -1;
}

// ---- a scripted miner: drills straight down around boulders and hazards,
// flies back up its own shaft, sells, refuels, repairs and upgrades. The
// node check uses it to prove the economy works; the page uses it for the
// demo hook. mem is the bot's notebook between calls.
function bot(s, mem) {
    const p = s.pod, inp = mem.input || (mem.input = { left: false, right: false, up: false, down: false });
    inp.left = inp.right = inp.up = inp.down = false;
    if (s.over || p.drill) return inp;
    mem.mode = mem.mode || 'down';
    mem.target = mem.target || 320;
    const cx = Math.floor(p.x), cy = Math.floor(p.y), d = depthM(s);
    const steer = (tx, tol) => {
        const dx = tx - p.x;
        if (dx > tol && p.vx < Math.min(3, dx * 4)) inp.right = true;
        else if (dx < -tol && p.vx > Math.max(-3, dx * 4)) inp.left = true;
    };
    if (mem.mode === 'down') {
        const back = s.cargoCount >= stat(s, 'cargo') || s.fuel < 1.5 + d / METERS * 0.1 ||
            s.hull < Math.min(6, stat(s, 'hull') * 0.5) || d >= mem.target;
        if (back && !onSurface(s)) { mem.mode = 'up'; mem.stop = 0; return inp; }
        if (onSurface(s)) {
            // every trip goes down the same shaft, braking on the way
            const col = 11;
            if (Math.abs(p.x - (col + 0.5)) > 0.2 || !p.grounded) { steer(col + 0.5, 0.1); return inp; }
        }
        if (!p.grounded) { steer(cx + 0.5, 0.08); inp.up = p.vy > 6; return inp; }
        const below = tileAt(s.world, cx, cy + 1);
        const bad = t => t === T.ROCK || t === T.BEDROCK || t === T.PAD || t === T.GAS || t === T.LAVA;
        const loot = t => cargoInfo(t) || t === T.TREASURE;
        if (s.cargoCount < stat(s, 'cargo') && !onSurface(s)) {
            for (const dir of [1, -1]) if (loot(tileAt(s.world, cx + dir, cy))) {
                if (dir > 0) inp.right = true; else inp.left = true;
                return inp;
            }
        }
        if (below === T.EMPTY) { steer(cx + 0.5, 0.02); return inp; }
        if (!bad(below) && Math.abs(p.x - (cx + 0.5)) < 0.25) { inp.down = true; mem.side = 0; return inp; }
        if (!bad(below)) { steer(cx + 0.5, 0.05); return inp; }
        // sidestep: keep the same direction while it works
        let dir = mem.side || (cx < W / 2 ? 1 : -1);
        const ok = x => x >= 1 && x <= W - 2 && !bad(tileAt(s.world, x, cy)) && !padAt(x);
        if (!ok(cx + dir)) dir = -dir;
        if (!ok(cx + dir)) { mem.mode = 'up'; return inp; }
        mem.side = dir;
        if (dir > 0) inp.right = true; else inp.left = true;
        return inp;
    }
    if (mem.mode === 'up') {
        if (onSurface(s) && p.grounded) { mem.mode = 'shop'; return inp; }
        if (p.y < SURF - 0.3) {
            // out of the shaft: hover over to the ore buyer and land on its pad
            const b = BUILDINGS.find(x => x.id === (['sell', 'fuel', 'repair', 'upgrade'][mem.stop || 0] || 'sell'));
            const tx = (b.x0 + b.x1 + 1) / 2;
            steer(tx, 0.2);
            inp.up = Math.abs(p.x - tx) > 0.6 ? (p.y > SURF - 1.6 || p.vy > 0.5) && p.vy > -2 : false;
            return inp;
        }
        // breadth-first search through open tiles to the sky, redone per tile
        if (cy < SURF) { inp.up = true; return inp; }
        const key = cy * W + cx;
        if (mem.from !== key) { mem.from = key; mem.next = route(s, cx, cy); }
        const next = mem.next;
        if (next < 0) {
            if (s.items.teleport > 0) useItem(s, 'teleport');
            inp.up = true; return inp;
        }
        const nx = next % W, ny = (next - nx) / W;
        if (ny < cy) {
            steer(nx + 0.5, 0.04);
            inp.up = Math.abs(p.x - (nx + 0.5)) < 0.12 || p.vy > 0.5;
        } else if (ny > cy) {
            steer(nx + 0.5, 0.04);
            inp.up = p.vy > 4;
        } else {
            steer(nx + 0.5, 0.04);
            inp.up = !p.grounded || tileAt(s.world, cx, cy - 1) !== T.EMPTY; // hug the ceiling in side passages
        }
        return inp;
    }
    // shop: visit buyer, fuel, repair, upgrades, then go down again
    const plan = ['sell', 'fuel', 'repair', 'upgrade'];
    const stop = plan[mem.stop || 0];
    if (!stop) {
        mem.mode = 'down'; mem.stop = 0; mem.side = 0;
        mem.trip = (mem.trip || 0) + 1;
        return inp;
    }
    if (!onSurface(s)) { mem.mode = 'up'; return inp; }
    if (!p.grounded) { inp.up = p.vy > 3; return inp; }
    const b = BUILDINGS.find(x => x.id === stop), tx = (b.x0 + b.x1 + 1) / 2;
    if (Math.abs(p.x - tx) > 0.6 || Math.abs(p.vx) > 0.3) { steer(tx, 0.3); return inp; }
    if (stop === 'sell') sell(s);
    else if (stop === 'fuel') buyFuel(s);
    else if (stop === 'repair') repair(s);
    else if (stop === 'upgrade') {
        const reserve = 150;
        for (const id of ['tank', 'cargo', 'drill', 'hull', 'engine', 'rad', 'tank', 'cargo', 'drill', 'hull']) {
            const lvl = s.up[id];
            if (lvl < 5 && s.cash - COST[lvl + 1] >= reserve) upgrade(s, id);
        }
        mem.stop = 4;
        // dig the next shaft just east of the shop row
        return inp;
    }
    mem.stop = (mem.stop || 0) + 1;
    return inp;
}

const DD = {
    W, H, SURF, METERS, GOAL_M, CAVE_TOP, CAVE_FLOOR, HALF, DT, SPAWN_X, SPAWN_Y, CHUNK, CHUNK_COLS,
    T, ORES, ORE0, FOSSIL, CARGO_KINDS, BUILDINGS, UPGRADES, ITEMS, COST, FUEL_PRICE, REPAIR_PRICE, ITEM_MAX,
    rng, genWorld, tileAt, setTile, drillable, isOre, cargoInfo, hardness, stat, newGame, step, depthM, depthOfRow,
    building, sell, buyFuel, repair, upgrade, buyItem, useItem, explode, cargoValue, serialize, deserialize, bot
};
root.DEEP_DRILL = DD;
if (typeof module !== 'undefined' && module.exports) module.exports = DD;
})(typeof window !== 'undefined' ? window : globalThis);
