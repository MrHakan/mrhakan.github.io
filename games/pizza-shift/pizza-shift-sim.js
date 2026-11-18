// pizza shift 98: rules and simulation. No DOM, no clock, no Math.random:
// everything comes from the seed, so node can replay a whole shift.
// Pizza coordinates are "unit" coordinates: the sauce is a circle of radius 1
// around (0, 0), y grows downwards like the screen.
(function (root) {
'use strict';

const VERSION = 1;
const DAYS = 10;
const PASS_SCORE = 55;
const BAKE_UNIT = 5;          // seconds per bake level with stock ovens
const BURN_AT = 4.2;          // heat where any pizza is charcoal
const HEAT_CAP = 5;
const PER_QUARTER = 2;        // pieces of a topping wanted in each quarter it covers
const ON_PIZZA = 0.93;        // a piece further out than this fell on the crust/floor
const OVERLAP = 0.12;         // two pieces of one topping closer than this are a pile
const SCOOP_GAP = 0.07;       // the scoop drops two pieces this far either side of the tap
const MAX_PIECES = 96;
const MAX_CUTS = 8;

const TOPPINGS = [
    { id: 'pepperoni', name: 'pepperoni' },
    { id: 'mushroom', name: 'mushrooms' },
    { id: 'olive', name: 'olives' },
    { id: 'pepper', name: 'peppers' },
    { id: 'onion', name: 'onions' },
    { id: 'sausage', name: 'sausage' }
];
const TOPPING_INDEX = Object.fromEntries(TOPPINGS.map((t, i) => [t.id, i]));

// quarters: 0 top-right, 1 top-left, 2 bottom-left, 3 bottom-right
const REGIONS = {
    whole: [0, 1, 2, 3], left: [1, 2], right: [0, 3], top: [0, 1], bottom: [2, 3],
    q0: [0], q1: [1], q2: [2], q3: [3]
};
const REGION_NAMES = {
    whole: 'whole', left: 'left half', right: 'right half', top: 'top half', bottom: 'bottom half',
    q0: 'top-right quarter', q1: 'top-left quarter', q2: 'bottom-left quarter', q3: 'bottom-right quarter'
};
const BAKES = [
    { id: 'light', name: 'light', target: 1 },
    { id: 'regular', name: 'regular', target: 2 },
    { id: 'well', name: 'well done', target: 3 }
];
const BAKE_INDEX = Object.fromEntries(BAKES.map((b, i) => [b.id, i]));

// faces of the regulars; the page maps the index to a picture in src/emoj
const FACES = ['patron', 'joe cool', 'sahur', 'nasiya', 'dusung', 'xd troll', 'oleyy', 'thehehe',
    'gunaydin', 'pffft', 'heh', 'ingaaa', 'yeter', 'bebe troll', 'toplum', 'hot dude'];

const UPGRADES = [
    { id: 'ovens', name: 'extra oven', desc: 'one more oven on the line (max 4)', prices: [2500, 6000] },
    { id: 'heat', name: 'hotter ovens', desc: 'pizzas bake 30% faster per level', prices: [2000, 5000] },
    { id: 'scoop', name: 'topping scoop', desc: 'every tap drops a pair of pieces', prices: [1500] },
    { id: 'cutter', name: 'steady cutter', desc: 'every cut snaps through the centre', prices: [3000] },
    { id: 'decor', name: 'cosy decor', desc: 'plants, neon, jukebox: +12% patience per level', prices: [1500, 3500, 7000] }
];
const HEAT_MULT = [1, 1.3, 1.6];

// ---------------------------------------------------------------- random
function hash(a, b) {
    let h = (Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b >>> 0) + 0x632be5ab, 0xc2b2ae35)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
    return h >>> 0;
}
function rng(seed) {
    let s = seed >>> 0;
    const next = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = n => Math.floor(next() * n);
    next.pick = list => list[Math.floor(next() * list.length)];
    return next;
}
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const clamp100 = v => Math.round(clamp(v, 0, 100));

// ---------------------------------------------------------------- orders
function genOrder(rand, day) {
    const count = day <= 1 ? 1 : day <= 2 ? 1 + rand.int(2) : day <= 4 ? 1 + rand.int(3) : Math.min(4, 2 + rand.int(3));
    const pool = TOPPINGS.map(t => t.id);
    for (let i = pool.length - 1; i > 0; i--) { const j = rand.int(i + 1); const x = pool[i]; pool[i] = pool[j]; pool[j] = x; }
    const regions = day <= 1 ? ['whole'] : day <= 2 ? ['whole', 'whole', 'left', 'right', 'top', 'bottom']
        : ['whole', 'whole', 'left', 'right', 'top', 'bottom', 'q0', 'q1', 'q2', 'q3'];
    const items = [];
    for (let i = 0; i < count; i++) items.push({ topping: pool[i], region: i === 0 && day <= 2 ? 'whole' : rand.pick(regions) });
    const bake = day <= 1 ? 'regular' : day <= 2 ? rand.pick(['light', 'regular']) : rand.pick(['light', 'regular', 'well']);
    const slices = day <= 1 ? 8 : day <= 2 ? rand.pick([6, 8]) : rand.pick([4, 6, 8]);
    return { items, bake, slices };
}
function validOrder(order) {
    if (!order || !Array.isArray(order.items) || !order.items.length || order.items.length > 4) return false;
    const seen = new Set();
    for (const it of order.items) {
        if (!(it.topping in TOPPING_INDEX) || !(it.region in REGIONS) || seen.has(it.topping)) return false;
        seen.add(it.topping);
    }
    return order.bake in BAKE_INDEX && [4, 6, 8].includes(order.slices);
}
function bakeTarget(order) { return BAKES[BAKE_INDEX[order.bake]].target; }

function patienceFor(order, day, vip, decor) {
    const base = 40 + BAKE_UNIT * bakeTarget(order) + 6 * order.items.length + order.slices;
    const mult = (vip ? 0.75 : 1) * Math.max(0.7, 1 - (day - 1) * 0.03) * (1 + 0.12 * (decor | 0));
    return Math.round(base * mult);
}

function dayPlan(seed, day, upgrades) {
    const rand = rng(hash(seed, day));
    const count = Math.min(12, 2 + day);
    const gap = Math.max(14, 42 - day * 3);
    const decor = upgrades ? upgrades.decor | 0 : 0;
    const customers = [];
    let t = 2;
    for (let i = 0; i < count; i++) {
        const face = rand.int(FACES.length);
        const vip = day >= 3 && rand() < 0.12 + 0.02 * day;
        const order = genOrder(rand, day);
        customers.push({ id: i + 1, face, name: FACES[face], vip, arrive: Math.round(t * 10) / 10,
            patience: patienceFor(order, day, vip, decor), order });
        t += gap * (0.7 + rand() * 0.6);
    }
    return { day, customers };
}

// ---------------------------------------------------------------- scoring
function quarterOf(x, y) {
    if (y < 0) return x >= 0 ? 0 : 1;
    return x < 0 ? 2 : 3;
}
function expectedCounts(order) {
    const exp = [0, 1, 2, 3].map(() => TOPPINGS.map(() => 0));
    for (const it of order.items) for (const q of REGIONS[it.region]) exp[q][TOPPING_INDEX[it.topping]] += PER_QUARTER;
    return exp;
}
function scoreToppings(order, pieces) {
    const exp = expectedCounts(order);
    const act = [0, 1, 2, 3].map(() => TOPPINGS.map(() => 0));
    const pen = [0, 0, 0, 0];
    let off = 0;
    const on = [];
    for (const p of pieces) {
        const ti = TOPPING_INDEX[p.t];
        if (ti === undefined || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        if (Math.hypot(p.x, p.y) > ON_PIZZA) { off++; continue; }
        const q = quarterOf(p.x, p.y);
        act[q][ti]++;
        on.push({ ti, q, x: p.x, y: p.y });
    }
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
        const a = on[i], b = on[j];
        if (a.ti === b.ti && Math.hypot(a.x - b.x, a.y - b.y) < OVERLAP) pen[a.q] += 10;
    }
    const quarters = [];
    let sum = 0;
    for (let q = 0; q < 4; q++) {
        for (let t = 0; t < TOPPINGS.length; t++) pen[q] += Math.abs(act[q][t] - exp[q][t]) * 20;
        const s = clamp100(100 - pen[q]);
        quarters.push(s); sum += s;
    }
    return { score: clamp100(sum / 4 - off * 10), quarters, off, counts: act, expected: exp };
}
function scoreBake(target, heat) {
    if (!Number.isFinite(heat) || heat >= BURN_AT) return 0;
    const d = Math.abs(heat - target);
    return d <= 0.1 ? 100 : clamp100(100 - (d - 0.1) * 110);
}
function normAngle(a) {
    a %= Math.PI; if (a < 0) a += Math.PI;
    return a >= Math.PI - 1e-9 ? 0 : a;
}
function scoreCut(slices, cuts) {
    if (!cuts || !cuts.length) return 0;
    const want = slices / 2;
    let pen = 30 * Math.abs(cuts.length - want);
    if (cuts.length >= 2) {
        const angles = cuts.map(c => normAngle(c.angle)).sort((a, b) => a - b);
        const ideal = Math.PI / angles.length;
        for (let i = 0; i < angles.length; i++) {
            const gap = i + 1 < angles.length ? angles[i + 1] - angles[i] : Math.PI - angles[i] + angles[0];
            const err = Math.abs(gap - ideal) * 180 / Math.PI;
            pen += Math.max(0, err - 2) * 1.5;
        }
    }
    for (const c of cuts) pen += Math.max(0, c.offset - 0.03) * 150;
    return clamp100(100 - pen);
}
function scoreWait(waited, patience) {
    if (waited <= patience) return 100;
    return clamp100(100 - (waited - patience) / patience * 100);
}
function tipFor(total, day, vip) {
    if (total < 30) return 0;
    const base = 300 + 50 * day;
    return Math.round(base * (total - 30) / 70 / 5) * 5 * (vip ? 2 : 1);
}
function stars(avg) { return avg >= 90 ? 3 : avg >= 75 ? 2 : avg >= PASS_SCORE ? 1 : 0; }
function reaction(total, walkout) {
    if (walkout) return 'i waited forever. bye.';
    if (total >= 95) return 'perfecto! chef\'s kiss';
    if (total >= 85) return 'now that is a pizza';
    if (total >= 70) return 'pretty good, thanks';
    if (total >= 55) return 'eh. it is food.';
    if (total >= 30) return 'did you even read my ticket?';
    return 'i want to speak to the manager';
}

// the placement a flawless cook would make: used by tests and the demo
function perfectPieces(order) {
    const pieces = [];
    for (let q = 0; q < 4; q++) {
        const here = order.items.filter(it => REGIONS[it.region].includes(q));
        const n = here.length * PER_QUARTER;
        // quarter q spans screen angles [-(q+1)*90°, -q*90°] with y down
        const start = -(q + 1) * Math.PI / 2;
        let k = 0;
        for (const it of here) for (let c = 0; c < PER_QUARTER; c++, k++) {
            const a = start + (k + 0.5) / n * Math.PI / 2;
            const r = k % 2 ? 0.75 : 0.45;
            pieces.push({ t: it.topping, x: Math.cos(a) * r, y: Math.sin(a) * r });
        }
    }
    return pieces;
}

// ---------------------------------------------------------------- game save
function newGame(seed) {
    return { v: VERSION, seed: seed >>> 0, day: 1, money: 0, attempts: 0,
        upgrades: { ovens: 2, heat: 0, scoop: 0, cutter: 0, decor: 0 },
        stars: [], won: false, best: { day: 0, money: 0, stars: 0 } };
}
function sanitizeSave(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return null;
    const int = (v, lo, hi, d) => Number.isSafeInteger(v) && v >= lo && v <= hi ? v : d;
    const g = newGame(int(raw.seed, 0, 4294967295, 98));
    g.day = int(raw.day, 1, DAYS, 1);
    g.money = int(raw.money, 0, 1e9, 0);
    g.attempts = int(raw.attempts, 0, 1e6, 0);
    const u = raw.upgrades || {};
    g.upgrades = { ovens: int(u.ovens, 2, 4, 2), heat: int(u.heat, 0, 2, 0), scoop: int(u.scoop, 0, 1, 0),
        cutter: int(u.cutter, 0, 1, 0), decor: int(u.decor, 0, 3, 0) };
    g.stars = Array.isArray(raw.stars) ? raw.stars.slice(0, DAYS).map(s => int(s, 0, 3, 0)) : [];
    g.won = raw.won === true;
    const b = raw.best || {};
    g.best = { day: int(b.day, 0, DAYS, 0), money: int(b.money, 0, 1e9, 0), stars: int(b.stars, 0, DAYS * 3, 0) };
    return g;
}
function upgradeLevel(game, id) { return id === 'ovens' ? game.upgrades.ovens - 2 : game.upgrades[id] | 0; }
function priceOf(game, id) {
    const up = UPGRADES.find(u => u.id === id);
    if (!up) return null;
    const p = up.prices[upgradeLevel(game, id)];
    return p === undefined ? null : p;
}
function buy(game, id) {
    const price = priceOf(game, id);
    if (price === null || game.money < price) return false;
    game.money -= price;
    game.upgrades[id] = (game.upgrades[id] | 0) + 1;
    return true;
}
function totalStars(game) { return game.stars.reduce((a, b) => a + (b | 0), 0); }
// fold a finished day into the save. A failed day costs nothing but the tips.
function finishDay(game, result) {
    game.attempts++;
    if (result.passed) {
        game.money += result.earned;
        game.stars[game.day - 1] = Math.max(game.stars[game.day - 1] | 0, result.stars);
        game.best.day = Math.max(game.best.day, game.day);
        if (game.day >= DAYS) game.won = true; else game.day++;
    }
    game.best.money = Math.max(game.best.money, game.money);
    game.best.stars = Math.max(game.best.stars, totalStars(game));
    return game;
}

// ---------------------------------------------------------------- a day on the line
function createDay(game) {
    const plan = dayPlan(game.seed, game.day, game.upgrades);
    return {
        day: game.day, t: 0, over: false,
        heatRate: HEAT_MULT[game.upgrades.heat | 0] / BAKE_UNIT,
        scoop: !!game.upgrades.scoop, cutter: !!game.upgrades.cutter,
        customers: plan.customers.map(c => ({ ...c, status: 'coming', left: 0 })),
        tickets: [],
        ovens: Array.from({ length: game.upgrades.ovens }, () => ({ ticket: 0, heat: 0 })),
        results: [], earned: 0, events: []
    };
}
const customer = (ds, id) => ds.customers.find(c => c.id === id);
const ticket = (ds, id) => ds.tickets.find(t => t.id === id);
function queue(ds) { return ds.customers.filter(c => c.status === 'queue'); }

function step(ds, dt) {
    if (ds.over || !(dt > 0) || !Number.isFinite(dt)) return false;
    dt = Math.min(dt, 1);
    ds.t += dt;
    for (const c of ds.customers) {
        if (c.status === 'coming' && ds.t >= c.arrive) { c.status = 'queue'; ds.events.push({ kind: 'arrive', id: c.id }); }
    }
    for (let i = 0; i < ds.ovens.length; i++) {
        const o = ds.ovens[i];
        if (!o.ticket) continue;
        const before = o.heat, tk = ticket(ds, o.ticket), target = bakeTarget(tk.order);
        o.heat = Math.min(HEAT_CAP, o.heat + dt * ds.heatRate);
        if (before < target - 0.1 && o.heat >= target - 0.1) ds.events.push({ kind: 'ready', oven: i, id: o.ticket });
        if (before < BURN_AT && o.heat >= BURN_AT) ds.events.push({ kind: 'burnt', oven: i, id: o.ticket });
    }
    for (const c of ds.customers) {
        if ((c.status === 'queue' || c.status === 'waiting') && ds.t - c.arrive > 2 * c.patience) walkOut(ds, c);
    }
    checkOver(ds);
    return true;
}
function walkOut(ds, c) {
    c.status = 'left'; c.left = ds.t;
    const tk = ticket(ds, c.id);
    if (tk) {
        if (tk.status === 'baking') { ds.ovens[tk.oven].ticket = 0; ds.ovens[tk.oven].heat = 0; }
        tk.status = 'void';
    }
    const r = { id: c.id, name: c.name, vip: c.vip, walkout: true, parts: { topping: 0, bake: 0, cut: 0, wait: 0 },
        total: 0, tip: 0, reaction: reaction(0, true) };
    ds.results.push(r);
    ds.events.push({ kind: 'walkout', id: c.id });
}
function checkOver(ds) {
    if (!ds.over && ds.customers.every(c => c.status === 'served' || c.status === 'left')) {
        ds.over = true; ds.events.push({ kind: 'over' });
    }
}

function takeOrder(ds) {
    if (ds.over) return 0;
    const c = queue(ds).sort((a, b) => a.arrive - b.arrive || a.id - b.id)[0];
    if (!c) return 0;
    c.status = 'waiting';
    ds.tickets.push({ id: c.id, order: c.order, status: 'ordered', pieces: [], taps: 0, heat: 0, oven: -1, cuts: [], result: null });
    ds.events.push({ kind: 'order', id: c.id });
    return c.id;
}
function addPiece(ds, id, topping, x, y) {
    const tk = ticket(ds, id);
    if (ds.over || !tk || tk.status !== 'ordered' || !(topping in TOPPING_INDEX) ||
        !Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) > 1.3) return 0;
    const drop = [];
    if (ds.scoop) {
        const r = Math.hypot(x, y);
        const tx = r > 0.01 ? -y / r : 0, ty = r > 0.01 ? x / r : 1;
        drop.push([x + tx * SCOOP_GAP, y + ty * SCOOP_GAP], [x - tx * SCOOP_GAP, y - ty * SCOOP_GAP]);
    } else drop.push([x, y]);
    if (tk.pieces.length + drop.length > MAX_PIECES) return 0;
    tk.taps++;
    for (const [px, py] of drop) tk.pieces.push({ t: topping, x: px, y: py, g: tk.taps });
    return drop.length;
}
function undoPiece(ds, id) {
    const tk = ticket(ds, id);
    if (!tk || tk.status !== 'ordered' || !tk.pieces.length) return false;
    const g = tk.pieces[tk.pieces.length - 1].g;
    while (tk.pieces.length && tk.pieces[tk.pieces.length - 1].g === g) tk.pieces.pop();
    return true;
}
function clearPieces(ds, id) {
    const tk = ticket(ds, id);
    if (!tk || tk.status !== 'ordered') return false;
    tk.pieces.length = 0; return true;
}
function freeOven(ds) { return ds.ovens.findIndex(o => !o.ticket); }
function toOven(ds, id) {
    const tk = ticket(ds, id), i = freeOven(ds);
    if (ds.over || !tk || tk.status !== 'ordered' || i < 0) return -1;
    ds.ovens[i].ticket = id; ds.ovens[i].heat = 0;
    tk.status = 'baking'; tk.oven = i;
    return i;
}
function takeOut(ds, i) {
    const o = ds.ovens[i];
    if (ds.over || !o || !o.ticket) return 0;
    const tk = ticket(ds, o.ticket);
    tk.heat = o.heat; tk.status = 'baked'; tk.oven = -1;
    o.ticket = 0; o.heat = 0;
    return tk.id;
}
// a knife stroke from (x1,y1) to (x2,y2) in unit coordinates
function addCut(ds, id, x1, y1, x2, y2) {
    const tk = ticket(ds, id);
    if (ds.over || !tk || tk.status !== 'baked') return { ok: false, reason: 'nothing to cut' };
    if (![x1, y1, x2, y2].every(Number.isFinite)) return { ok: false, reason: 'bad stroke' };
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 0.8) return { ok: false, reason: 'drag right across the pizza' };
    const offset = Math.abs(x1 * dy - y1 * dx) / len;
    if (offset > 0.4) return { ok: false, reason: 'cut through the centre' };
    if (tk.cuts.length >= MAX_CUTS) return { ok: false, reason: 'that is enough cuts' };
    // d: signed distance of the line from the centre along the normal (-sin, cos) of its angle
    const angle = normAngle(Math.atan2(dy, dx)), ux = dx / len, uy = dy / len, along = x1 * ux + y1 * uy;
    const d = ds.cutter ? 0 : (x1 - along * ux) * -Math.sin(angle) + (y1 - along * uy) * Math.cos(angle);
    tk.cuts.push({ angle, offset: ds.cutter ? 0 : offset, d });
    return { ok: true };
}
function addCutAngle(ds, id, angle) {
    const a = Number(angle);
    return addCut(ds, id, -Math.cos(a), -Math.sin(a), Math.cos(a), Math.sin(a));
}
function undoCut(ds, id) {
    const tk = ticket(ds, id);
    if (!tk || tk.status !== 'baked' || !tk.cuts.length) return false;
    tk.cuts.pop(); return true;
}
function serve(ds, id) {
    const tk = ticket(ds, id), c = customer(ds, id);
    if (ds.over || !tk || tk.status !== 'baked' || !c || c.status !== 'waiting') return null;
    const parts = {
        topping: scoreToppings(tk.order, tk.pieces).score,
        bake: scoreBake(bakeTarget(tk.order), tk.heat),
        cut: scoreCut(tk.order.slices, tk.cuts),
        wait: scoreWait(ds.t - c.arrive, c.patience)
    };
    const total = Math.round((parts.topping + parts.bake + parts.cut + parts.wait) / 4);
    const tip = tipFor(total, ds.day, c.vip);
    const r = { id: c.id, name: c.name, vip: c.vip, walkout: false, parts, total, tip, reaction: reaction(total, false) };
    tk.status = 'served'; tk.result = r;
    c.status = 'served';
    ds.earned += tip;
    ds.results.push(r);
    ds.events.push({ kind: 'served', id: c.id, total, tip });
    checkOver(ds);
    return r;
}
function dayResult(ds) {
    const n = ds.customers.length;
    const sum = ds.results.reduce((a, r) => a + r.total, 0);
    const avg = n ? Math.round(sum / n) : 0;
    const s = stars(avg);
    return { day: ds.day, customers: n, served: ds.results.filter(r => !r.walkout).length,
        walkouts: ds.results.filter(r => r.walkout).length, avg, stars: s, passed: ds.over && s > 0,
        earned: ds.earned, results: ds.results.slice() };
}

const api = {
    VERSION, DAYS, PASS_SCORE, BAKE_UNIT, BURN_AT, HEAT_CAP, PER_QUARTER, ON_PIZZA, OVERLAP, SCOOP_GAP,
    TOPPINGS, TOPPING_INDEX, REGIONS, REGION_NAMES, BAKES, BAKE_INDEX, FACES, UPGRADES, HEAT_MULT,
    hash, rng, genOrder, validOrder, bakeTarget, patienceFor, dayPlan,
    quarterOf, expectedCounts, scoreToppings, scoreBake, scoreCut, scoreWait, tipFor, stars, reaction, perfectPieces,
    newGame, sanitizeSave, priceOf, buy, upgradeLevel, totalStars, finishDay,
    createDay, step, takeOrder, addPiece, undoPiece, clearPieces, freeOven, toOven, takeOut,
    addCut, addCutAngle, undoCut, serve, dayResult, queue, ticket, customer
};
if (typeof module === 'object' && module.exports) module.exports = api;
root.PIZZA_SIM = api;
})(typeof window !== 'undefined' ? window : globalThis);
