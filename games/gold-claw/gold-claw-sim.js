// gold claw 98 - the rules. No DOM, no clock, no Math.random: a fixed 60 Hz
// tick and a seeded generator, so Node can play thousands of runs and the
// browser can replay a layout from a seed. The page draws whatever is in here.
(function (root) {
'use strict';

const W = 640, H = 480;            // the playfield, in logical pixels
const PX = 320, PY = 84;           // where the rope hangs from the winch
const GROUND = 112;                // the top of the dirt
const DT = 1 / 60, LEVEL_TIME = 60;
const MAX_ANGLE = 70 * Math.PI / 180, SWING_SPEED = 1.9;
const BASE_LEN = 24, SHOOT_SPEED = 330, EMPTY_REEL = 430, HOOK_R = 9;
const STRENGTH = 1.55, BLAST_RADIUS = 95;

// pull is the reel speed in px/s with that item on the hook: heavier, slower
const TYPES = {
    gold_s: { r: 11, value: 50, pull: 290, name: 'small nugget' },
    gold_m: { r: 20, value: 150, pull: 170, name: 'gold nugget' },
    gold_l: { r: 36, value: 500, pull: 70, name: 'big gold' },
    rock_s: { r: 13, value: 20, pull: 190, name: 'pebble' },
    rock_l: { r: 25, value: 60, pull: 58, name: 'boulder' },
    diamond: { r: 9, value: 600, pull: 400, name: 'diamond' },
    bag: { r: 14, value: 0, pull: 240, name: 'mystery bag' },
    mole: { r: 13, value: 2, pull: 330, name: 'mole' },
    tnt: { r: 15, value: 0, pull: EMPTY_REEL, name: 'tnt barrel' }
};

const SHOP = {
    dynamite: { name: 'dynamite', base: 20, spread: 45, per: 8, desc: 'press up while reeling to blow up whatever is on the hook' },
    strength: { name: 'strength drink', base: 90, spread: 160, per: 20, desc: 'reel heavy things back much faster next level' },
    clover: { name: 'lucky clover', base: 40, spread: 120, per: 12, desc: 'mystery bags hold better stuff next level' },
    book: { name: "rock collector's book", base: 15, spread: 60, per: 5, desc: 'rocks are worth three times as much next level' },
    polish: { name: 'diamond polish', base: 140, spread: 220, per: 25, desc: 'diamonds are worth half again as much next level' }
};
const SHOP_ORDER = ['dynamite', 'strength', 'clover', 'book', 'polish'];

const ZONES = { shallow: [150, 215], mid: [215, 320], deep: [320, 455], any: [150, 455] };

// Hand-tuned layouts: [type, count, zone, layout]. Layout 'row' lines things
// up along one depth, 'lanes' gives moles a burrow each, default scatters.
const TEMPLATES = [
    { name: 'open pit', min: 1, spots: [['gold_s', 4, 'shallow'], ['gold_m', 3, 'mid'], ['gold_l', 2, 'deep'], ['rock_s', 2, 'shallow'], ['rock_l', 2, 'mid'], ['bag', 1, 'mid'], ['diamond', 1, 'deep']] },
    { name: 'rock shelf', min: 2, spots: [['rock_l', 5, 'mid', 'row'], ['rock_s', 3, 'shallow'], ['diamond', 3, 'deep'], ['gold_l', 2, 'deep'], ['gold_s', 3, 'shallow'], ['bag', 1, 'deep']] },
    { name: 'mole burrows', min: 2, spots: [['mole', 4, 'deep', 'lanes'], ['gold_m', 3, 'mid'], ['gold_s', 3, 'shallow'], ['rock_s', 3, 'mid'], ['bag', 2, 'deep'], ['gold_l', 1, 'deep']] },
    { name: 'powder keg', min: 3, spots: [['tnt', 3, 'mid'], ['gold_l', 3, 'deep'], ['rock_l', 2, 'shallow'], ['diamond', 2, 'deep'], ['gold_m', 2, 'mid'], ['bag', 1, 'shallow']] },
    { name: 'junk yard', min: 3, spots: [['rock_s', 6, 'any'], ['rock_l', 3, 'any'], ['gold_m', 4, 'any'], ['bag', 3, 'any'], ['diamond', 1, 'deep']] },
    { name: 'mother lode', min: 4, spots: [['gold_l', 4, 'deep', 'row'], ['rock_l', 3, 'mid'], ['rock_s', 3, 'shallow'], ['gold_s', 3, 'shallow'], ['bag', 1, 'mid']] },
    { name: 'glitter vein', min: 5, spots: [['diamond', 5, 'deep', 'row'], ['tnt', 2, 'deep'], ['rock_l', 4, 'mid', 'row'], ['mole', 2, 'mid', 'lanes'], ['gold_m', 2, 'shallow'], ['bag', 2, 'any']] }
];

function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), a | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// the run's own generator lives in the state so a run can be saved or cloned
function rand(s) {
    s.rng = (s.rng + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s.rng ^ (s.rng >>> 15), s.rng | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function hash(a, b) {
    let h = Math.imul((a >>> 0) ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul((b >>> 0) + 0x632BE59B, 0xC2B2AE35);
    h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D); h ^= h >>> 15;
    return h >>> 0;
}

// how much more money each level asks for than the one before
function goalStep(level) { return level <= 1 ? 650 : 545 + 300 * (level - 2); }
function goalFor(level) { let g = 0; for (let k = 1; k <= level; k++) g += goalStep(k); return g; }

// can a straight rope from the winch reach this circle inside the swing?
function inCone(x, y, r) {
    const dy = y - PY;
    if (y < GROUND + r + 14 || y > H - r - 6 || x < r + 6 || x > W - r - 6) return false;
    return Math.abs(x - PX) <= dy * Math.tan(MAX_ANGLE - 0.05) - r;
}
// moles walk a horizontal segment; a still item is a segment of length zero
function gap(a, b) {
    const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
    return Math.hypot(dx, a.y - b.y) - a.r - b.r;
}

function makeItem(s, type, x, y) {
    const t = TYPES[type];
    return { id: s.nextId++, type, x, y, r: t.r, pull: t.pull, x0: x, x1: x, vx: 0, diamond: false };
}

function layout(s, level) {
    const rng = mulberry(hash(s.seed, level));
    const pick = (lo, hi) => lo + rng() * (hi - lo);
    const items = [];
    const fits = it => inCone(it.x0, it.y, it.r) && inCone(it.x1, it.y, it.r) && items.every(o => gap(o, it) > 5);
    const pool = TEMPLATES.filter(t => t.min <= level);
    const template = level === 1 ? TEMPLATES[0] : pool[Math.floor(rng() * pool.length)];

    function scatter(type, zone) {
        const [lo, hi] = ZONES[zone];
        for (let tries = 0; tries < 80; tries++) {
            const it = makeItem(s, type, Math.round(pick(20, W - 20)), Math.round(pick(lo, hi)));
            if (type === 'bag') it.pull = Math.round(pick(120, 360));
            if (fits(it)) { items.push(it); return it; }
            s.nextId--;
        }
        return null;
    }
    function row(type, count, zone) {
        const [lo, hi] = ZONES[zone], r = TYPES[type].r;
        for (let tries = 0; tries < 12; tries++) {
            const y = Math.round(pick(lo + r, hi - r));
            const half = Math.min((y - PY) * Math.tan(MAX_ANGLE - 0.05) - r - 4, W / 2 - r - 8);
            const placed = [];
            for (let i = 0; i < count; i++) {
                const x = Math.round(PX - half + (2 * half) * (i + 0.5) / count + pick(-10, 10));
                const it = makeItem(s, type, x, Math.round(y + pick(-8, 8)));
                if (fits(it)) { items.push(it); placed.push(it); }
            }
            if (placed.length >= Math.ceil(count / 2)) return;
            for (const it of placed) items.splice(items.indexOf(it), 1);
        }
        for (let i = 0; i < count; i++) scatter(type, zone);
    }
    function lane(zone) {
        const [lo, hi] = ZONES[zone];
        for (let tries = 0; tries < 80; tries++) {
            const y = Math.round(pick(lo, hi)), span = pick(110, 260), x0 = Math.round(pick(30, W - 30 - span));
            const it = makeItem(s, 'mole', x0, y);
            it.x1 = Math.round(x0 + span);
            it.x = Math.round(pick(it.x0, it.x1));
            it.vx = (rng() < 0.5 ? -1 : 1) * Math.round(pick(28, 46) + Math.min(level, 12) * 2);
            it.diamond = rng() < 0.4;
            if (fits(it)) { items.push(it); return it; }
            s.nextId--;
        }
        return null;
    }

    for (const [type, count, zone, how] of template.spots) {
        if (how === 'row') row(type, count, zone);
        else for (let i = 0; i < count; i++) how === 'lanes' ? lane(zone) : scatter(type, zone);
    }
    // more clutter and more prizes the deeper the run goes
    const extra = Math.floor((level - 1) / 2);
    for (let i = 0; i < extra; i++) scatter(i % 2 ? 'rock_s' : 'rock_l', 'any');
    const budget = goalStep(level) * 1.9 + 150;
    for (let guard = 0; levelValue(items) < budget && guard < 40; guard++) {
        const r = rng();
        const type = level < 4 ? (r < 0.5 ? 'gold_m' : r < 0.85 ? 'gold_l' : 'diamond')
            : (r < 0.45 ? 'diamond' : r < 0.85 ? 'gold_l' : 'gold_m');
        scatter(type, type === 'gold_m' ? 'mid' : 'deep') || scatter(type, 'any');
    }
    return { name: template.name, items };
}

// what the field is worth at face value, the way the solver counts it
function levelValue(items) {
    let v = 0;
    for (const it of items) v += it.type === 'bag' ? 150 : it.type === 'mole' && it.diamond ? 602 : TYPES[it.type].value;
    return v;
}

function create(seed) {
    seed = (Number(seed) >>> 0) || 98;
    const s = {
        version: 1, seed, rng: hash(seed, 0xC1A3), level: 1, goal: goalFor(1), money: 0,
        time: LEVEL_TIME, ticks: 0, phase: 'play', nextId: 1, dynamite: 0,
        buffs: {}, bought: {}, offers: [], items: [], template: '',
        claw: { mode: 'swing', phase: 0, angle: 0, len: BASE_LEN, item: null },
        events: [], stats: { grabs: 0, diamonds: 0, blasts: 0, booms: 0, best: 0, bags: 0 }
    };
    startLevel(s);
    return s;
}
function startLevel(s) {
    const made = layout(s, s.level);
    s.items = made.items; s.template = made.name;
    s.time = LEVEL_TIME; s.goal = goalFor(s.level); s.phase = 'play';
    s.claw.mode = 'swing'; s.claw.len = BASE_LEN; s.claw.item = null; s.claw.phase = 0; s.claw.angle = 0;
    emit(s, { k: 'level', level: s.level, goal: s.goal, name: s.template });
}
function emit(s, e) { if (s.events.length < 64) s.events.push(e); }

function tip(s) {
    const c = s.claw;
    return { x: PX + Math.sin(c.angle) * c.len, y: PY + Math.cos(c.angle) * c.len };
}
function valueOf(s, it) {
    const b = s.buffs;
    if (it.type === 'rock_s' || it.type === 'rock_l') return TYPES[it.type].value * (b.book ? 3 : 1);
    if (it.type === 'diamond') return Math.round(TYPES.diamond.value * (b.polish ? 1.5 : 1));
    if (it.type === 'mole') return TYPES.mole.value + (it.diamond ? Math.round(TYPES.diamond.value * (b.polish ? 1.5 : 1)) : 0);
    return TYPES[it.type].value;
}

function fire(s) {
    if (s.phase !== 'play' || s.claw.mode !== 'swing') return false;
    s.claw.mode = 'shoot';
    emit(s, { k: 'shoot' });
    return true;
}
function blast(s) {
    const c = s.claw;
    if (s.phase !== 'play' || c.mode !== 'reel' || !c.item || s.dynamite <= 0) return false;
    s.dynamite--; s.stats.blasts++;
    const p = tip(s);
    emit(s, { k: 'blast', x: p.x, y: p.y, type: c.item.type });
    c.item = null;
    return true;
}
// the end of the level, early when the goal is already in the bank
function finish(s) {
    if (s.phase !== 'play' || s.money < s.goal) return false;
    endLevel(s);
    return true;
}
function endLevel(s) {
    const c = s.claw;
    c.item = null; c.mode = 'swing'; c.len = BASE_LEN;
    s.phase = s.money >= s.goal ? 'cleared' : 'over';
    s.stats.best = Math.max(s.stats.best, s.money);
    emit(s, { k: s.phase, level: s.level, money: s.money, goal: s.goal });
}

function explode(s, bomb) {
    const queue = [bomb];
    bomb.dead = true;
    while (queue.length) {
        const b = queue.pop();
        s.stats.booms++;
        emit(s, { k: 'boom', x: b.x, y: b.y });
        for (const it of s.items) {
            if (it.dead || Math.hypot(it.x - b.x, it.y - b.y) > BLAST_RADIUS + it.r) continue;
            it.dead = true;
            if (it.type === 'tnt') queue.push(it);
        }
    }
    s.items = s.items.filter(it => !it.dead);
}

function grab(s, it) {
    const c = s.claw;
    c.mode = 'reel';
    if (it.type === 'tnt') { explode(s, it); c.item = null; return; }
    s.items.splice(s.items.indexOf(it), 1);
    c.item = it;
    s.stats.grabs++;
    emit(s, { k: 'grab', type: it.type });
}

function bank(s, it) {
    let value = valueOf(s, it), text = '';
    if (it.type === 'bag') {
        s.stats.bags++;
        const luck = s.buffs.clover ? 1 : 0, r = rand(s);
        if (r < 0.14 + 0.06 * luck) { s.dynamite++; text = 'dynamite!'; }
        else if (r < 0.28 + 0.07 * luck && !s.buffs.strength) { s.buffs.strength = true; text = 'strength!'; }
        else value = 5 * Math.round((25 + rand(s) * (luck ? 775 : 380)) / 5);
    }
    if (it.type === 'diamond' || it.diamond) s.stats.diamonds++;
    s.money += value;
    emit(s, { k: 'bank', type: it.type, value, text });
}

function tick(s) {
    if (s.phase !== 'play') return;
    s.ticks++;
    s.time -= DT;
    for (const it of s.items) {
        if (it.vx === 0) continue;
        it.x += it.vx * DT;
        if (it.x < it.x0) { it.x = it.x0; it.vx = -it.vx; } else if (it.x > it.x1) { it.x = it.x1; it.vx = -it.vx; }
    }
    const c = s.claw;
    if (c.mode === 'swing') {
        c.phase += SWING_SPEED * DT;
        if (c.phase > Math.PI * 2) c.phase -= Math.PI * 2;
        c.angle = MAX_ANGLE * Math.sin(c.phase);
    } else if (c.mode === 'shoot') {
        c.len += SHOOT_SPEED * DT;
        const p = tip(s);
        if (p.x < 0 || p.x > W || p.y > H) c.mode = 'reel';
        else for (const it of s.items) {
            const dx = it.x - p.x, dy = it.y - p.y, rr = it.r + HOOK_R;
            if (dx * dx + dy * dy <= rr * rr) { grab(s, it); break; }
        }
    } else {
        const speed = c.item ? Math.min(450, c.item.pull * (s.buffs.strength ? STRENGTH : 1)) : EMPTY_REEL;
        c.len -= speed * DT;
        if (c.len <= BASE_LEN) {
            c.len = BASE_LEN; c.mode = 'swing';
            if (c.item) { bank(s, c.item); c.item = null; }
        }
    }
    if (s.time <= 1e-9) { s.time = 0; endLevel(s); return; }
    if (!s.items.length && c.mode === 'swing') endLevel(s);
}

function openShop(s) {
    if (s.phase !== 'cleared') return false;
    s.phase = 'shop';
    s.offers = [];
    for (const kind of SHOP_ORDER) {
        if (rand(s) > 0.65) continue;
        const d = SHOP[kind];
        s.offers.push({ kind, price: Math.round(d.base + rand(s) * d.spread + d.per * s.level), sold: false });
    }
    if (!s.offers.length) s.offers.push({ kind: 'dynamite', price: Math.round(SHOP.dynamite.base + SHOP.dynamite.per * s.level), sold: false });
    emit(s, { k: 'shop' });
    return true;
}
function buy(s, i) {
    const o = s.offers[i];
    if (s.phase !== 'shop' || !o || o.sold || s.money < o.price) return false;
    s.money -= o.price; o.sold = true;
    if (o.kind === 'dynamite') s.dynamite++;
    else s.bought[o.kind] = true;
    emit(s, { k: 'buy', kind: o.kind, price: o.price });
    return true;
}
function nextLevel(s) {
    if (s.phase === 'cleared') openShop(s);
    if (s.phase !== 'shop') return false;
    s.level++;
    s.buffs = s.bought; s.bought = {}; s.offers = [];
    startLevel(s);
    return true;
}

// which item would a shot fired right now hit first? (bot and aim hint)
function rayFirst(s, angle) {
    const sx = Math.sin(angle), cy = Math.cos(angle);
    let best = null, bestT = Infinity;
    for (const it of s.items) {
        const dx = it.x - PX, dy = it.y - PY;
        const t = dx * sx + dy * cy;
        if (t <= 0) continue;
        const px = dx - sx * t, py = dy - cy * t, rr = it.r + HOOK_R;
        if (px * px + py * py > rr * rr) continue;
        if (t < bestT) { bestT = t; best = it; }
    }
    return best;
}

// A plain greedy player for the checks: it knows the rules, not the future.
function estimate(s, it) {
    const d = Math.hypot(it.x - PX, it.y - PY);
    const pull = it.pull * (s.buffs.strength ? STRENGTH : 1);
    const worth = it.type === 'bag' ? (s.buffs.clover ? 330 : 160) : it.type === 'tnt' ? 0 : valueOf(s, it);
    return { time: d / SHOOT_SPEED + d / pull + 1, worth };
}
function botStep(s, mem) {
    const c = s.claw;
    if (s.phase === 'cleared') { openShop(s); return; }
    if (s.phase === 'shop') {
        const rules = { dynamite: 0.08, strength: 0.18, polish: 0.2, clover: 0.08, book: 0.04 };
        s.offers.forEach((o, i) => { if (!o.sold && o.price <= s.money * rules[o.kind] && (o.kind !== 'dynamite' || s.dynamite < 3)) buy(s, i); });
        nextLevel(s);
        mem.waited = 0;
        return;
    }
    if (s.phase !== 'play') return;
    if (c.mode === 'swing') {
        if (s.money >= s.goal && s.items.every(it => estimate(s, it).time > s.time)) { finish(s); return; }
        if (mem.waited === 0) {
            mem.best = 0;
            for (const it of s.items) { const e = estimate(s, it); if (e.time < s.time) mem.best = Math.max(mem.best, e.worth / e.time); }
        }
        mem.waited++;
        const hit = rayFirst(s, c.angle);
        if (!hit) return;
        const e = estimate(s, hit), rate = e.worth / e.time;
        const patience = mem.waited > 400 ? 0.05 : mem.waited > 200 ? 0.3 : 0.6;
        if (e.time < s.time && rate >= mem.best * patience && (hit.type !== 'tnt' || mem.waited > 500)) { fire(s); mem.waited = 0; }
    } else if (c.mode === 'reel' && c.item && s.dynamite > 0) {
        const e = estimate(s, c.item);
        if (e.worth < 100 && c.item.pull < 100) blast(s);
    }
}

const api = {
    W, H, PX, PY, GROUND, DT, LEVEL_TIME, MAX_ANGLE, BASE_LEN, HOOK_R, BLAST_RADIUS, STRENGTH,
    TYPES, SHOP, SHOP_ORDER, TEMPLATES,
    create, tick, fire, blast, finish, openShop, buy, nextLevel,
    goalFor, goalStep, inCone, levelValue, valueOf, tip, rayFirst, layout, botStep, estimate
};
root.GoldClawSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
