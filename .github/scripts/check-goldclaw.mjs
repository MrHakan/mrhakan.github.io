// check-goldclaw.mjs - gold claw 98's rules without a browser: the claw,
// grabbing and reeling, tnt, dynamite, bags, the shop and its perks, level
// layouts that are reachable and worth the goal, and a few hundred seeded
// bot runs that always end with a valid result.
import fs from 'node:fs';
import path from 'node:path';
import { loadGameScript, createTestScope } from './game-test-context.mjs';

const ROOT = process.cwd();
const scope = createTestScope();
loadGameScript(fs.readFileSync(path.join(ROOT, 'games/gold-claw/gold-claw-sim.js'), 'utf8'), scope, 'gold-claw-sim.js');
const S = scope.GoldClawSim;

let checks = 0, failures = 0;
function ok(cond, what, detail) {
    checks++;
    if (!cond) { failures++; console.log('  FAIL  ' + what + (detail !== undefined ? '\n        ' + JSON.stringify(detail) : '')); }
}
function section(name) { console.log('== ' + name); }
const run = (s, ticks) => { for (let i = 0; i < ticks && s.phase === 'play'; i++) S.tick(s); };
// aim the claw straight at an item and fire, the way a player would time it
function aimAt(s, it) {
    s.claw.angle = Math.atan2(it.x - S.PX, it.y - S.PY);
    s.claw.mode = 'swing';
    s.claw.phase = 0; // irrelevant once fired: the angle holds while the rope is out
    return S.fire(s);
}
function untilSwing(s, max = 3000) { let n = 0; while (s.claw.mode !== 'swing' && n++ < max && s.phase === 'play') S.tick(s); return n; }
function only(s, ...items) { s.items = items; return items; }
function put(s, type, x, y, extra = {}) {
    const t = S.TYPES[type];
    return { id: s.nextId++, type, x, y, r: t.r, pull: t.pull, x0: x, x1: x, vx: 0, diamond: false, ...extra };
}

section('determinism and goals');
{
    const a = S.create(1234), b = S.create(1234), c = S.create(1235);
    ok(JSON.stringify(a.items) === JSON.stringify(b.items), 'same seed, same level');
    ok(JSON.stringify(a.items) !== JSON.stringify(c.items), 'another seed, another level');
    ok(S.goalFor(1) === 650 && S.goalFor(2) > 650, 'the first goal is 650 and the goal rises', [S.goalFor(1), S.goalFor(2)]);
    let rising = true;
    for (let l = 2; l < 40; l++) if (S.goalStep(l + 1) <= S.goalStep(l)) rising = false;
    ok(rising, 'each level asks for more than the last');
    ok(a.time === S.LEVEL_TIME && S.LEVEL_TIME === 60, 'a level has 60 seconds');
    ok(S.create(0).seed === 98 && S.create('x').seed === 98, 'a bad seed falls back to 98');
}

section('the swing');
{
    const s = S.create(5);
    let lo = 0, hi = 0;
    for (let i = 0; i < 600; i++) { S.tick(s); lo = Math.min(lo, s.claw.angle); hi = Math.max(hi, s.claw.angle); }
    ok(hi > S.MAX_ANGLE * 0.99 && lo < -S.MAX_ANGLE * 0.99, 'the claw swings to both sides', [lo, hi]);
    ok(Math.abs(hi) <= S.MAX_ANGLE + 1e-9 && Math.abs(lo) <= S.MAX_ANGLE + 1e-9, 'and never past the limit');
    const t0 = s.time;
    ok(Math.abs(t0 - (60 - 600 / 60)) < 1e-6, 'the clock runs at 60 ticks a second', t0);
}

section('shooting, grabbing and reeling');
{
    const s = S.create(9);
    const [gold] = only(s, put(s, 'gold_m', 320, 300));
    ok(aimAt(s, gold), 'fire works while swinging');
    ok(!S.fire(s), 'fire does nothing while the rope is out');
    const angle = s.claw.angle;
    run(s, 5);
    ok(s.claw.angle === angle, 'the angle holds while shooting');
    untilSwing(s);
    ok(s.money === 150, 'a gold nugget banks 150', s.money);
    ok(s.items.length === 0 && s.claw.item === null, 'the item left the field');
    ok(s.phase === 'cleared' || s.phase === 'over', 'an empty field ends the level', s.phase);

    // heavy reels slower than light at the same spot
    const timeFor = (type, strength) => {
        const t = S.create(9); if (strength) t.buffs.strength = true;
        const [it] = only(t, put(t, type, 320, 380), put(t, 'rock_s', 40, 460));
        aimAt(t, it); return untilSwing(t);
    };
    const light = timeFor('gold_s'), heavy = timeFor('gold_l'), boulder = timeFor('rock_l'), strong = timeFor('gold_l', true);
    ok(heavy > light * 2, 'big gold reels much slower than a small nugget', [light, heavy]);
    ok(boulder > heavy, 'a boulder is the slowest of all', [boulder, heavy]);
    ok(strong < heavy * 0.75, 'the strength drink speeds up the heavy reel', [strong, heavy]);

    // a miss comes back empty, quickly
    const m = S.create(9);
    only(m, put(m, 'gold_s', 40, 460));
    m.claw.angle = 0.3; m.claw.mode = 'swing'; S.fire(m);
    const n = untilSwing(m);
    ok(m.money === 0 && m.claw.item === null && n < 200, 'a miss reels back empty', n);

    // the first thing on the line is what gets hooked
    const f = S.create(9);
    const [near, far] = only(f, put(f, 'rock_l', 320, 200), put(f, 'diamond', 320, 400));
    aimAt(f, far);
    while (f.claw.mode === 'shoot') S.tick(f);
    ok(f.claw.item === near, 'the boulder in front gets hooked before the diamond behind it');
    ok(S.rayFirst(f, 0) === far, 'and the aim ray now sees the diamond');
}

section('item values and perks');
{
    const s = S.create(3);
    const rock = put(s, 'rock_l', 0, 0), dia = put(s, 'diamond', 0, 0), mole = put(s, 'mole', 0, 0), moleD = put(s, 'mole', 0, 0, { diamond: true });
    ok(S.valueOf(s, rock) === 60 && S.valueOf(s, dia) === 600, 'base values', [S.valueOf(s, rock), S.valueOf(s, dia)]);
    ok(S.valueOf(s, mole) === 2 && S.valueOf(s, moleD) === 602, 'a mole is worth 2, or 602 with a diamond');
    s.buffs = { book: true, polish: true };
    ok(S.valueOf(s, rock) === 180, "the rock collector's book triples rocks");
    ok(S.valueOf(s, dia) === 900 && S.valueOf(s, moleD) === 902, 'diamond polish adds half again, carried ones too');
}

section('moles');
{
    const s = S.create(3);
    const [m] = only(s, put(s, 'mole', 300, 300, { x0: 250, x1: 350, vx: 40 }), put(s, 'rock_s', 40, 460));
    let lo = 999, hi = -999;
    for (let i = 0; i < 600; i++) { S.tick(s); lo = Math.min(lo, m.x); hi = Math.max(hi, m.x); }
    ok(lo >= 250 && hi <= 350 && hi - lo > 90, 'a mole walks its burrow and turns at the ends', [lo, hi]);
}

section('tnt');
{
    const s = S.create(4);
    const [tnt, near, tnt2, chained, far] = only(s,
        put(s, 'tnt', 320, 300), put(s, 'gold_l', 380, 300), put(s, 'tnt', 250, 330), put(s, 'diamond', 170, 340), put(s, 'gold_s', 560, 440));
    aimAt(s, tnt);
    while (s.claw.mode === 'shoot') S.tick(s);
    ok(s.claw.item === null && s.claw.mode === 'reel', 'hooking tnt leaves nothing on the hook');
    ok(!s.items.includes(near) && !s.items.includes(tnt2) && !s.items.includes(chained), 'the blast takes the neighbours and sets off the next barrel');
    ok(s.items.includes(far), 'far things survive', s.items.map(i => i.type));
    ok(s.stats.booms === 2, 'two explosions', s.stats.booms);
    untilSwing(s);
    ok(s.money === 0, 'nothing banked from a blast');
}

section('dynamite');
{
    const s = S.create(6);
    const [rock] = only(s, put(s, 'rock_l', 320, 420), put(s, 'gold_s', 560, 440));
    aimAt(s, rock);
    while (s.claw.mode === 'shoot') S.tick(s);
    ok(!S.blast(s), 'no dynamite, no blast');
    s.dynamite = 2;
    ok(S.blast(s) && s.dynamite === 1 && s.claw.item === null, 'dynamite drops the held item and costs one stick');
    ok(!S.blast(s), 'an empty hook cannot be blasted');
    const n = untilSwing(s);
    ok(s.money === 0 && n < 120, 'the empty rope comes back fast', n);
    ok(!S.blast(s), 'no blasting while swinging');
}

section('mystery bags');
{
    let money = 0, lucky = 0, dyn = 0, str = 0, cash = [], cashL = [];
    for (let seed = 1; seed <= 400; seed++) {
        for (const clover of [false, true]) {
            const s = S.create(seed); s.buffs = clover ? { clover: true } : {};
            const [bag] = only(s, put(s, 'bag', 320, 250), put(s, 'gold_s', 560, 440));
            aimAt(s, bag); untilSwing(s);
            if (s.dynamite) dyn++; else if (s.buffs.strength) str++;
            else (clover ? cashL : cash).push(s.money);
            if (clover) lucky += s.money; else money += s.money;
        }
    }
    ok(dyn > 40 && str > 40, 'bags sometimes hold dynamite or a strength drink', [dyn, str]);
    ok(cash.every(v => v >= 25 && v <= 405 && v % 5 === 0), 'plain bag money stays in range', [Math.min(...cash), Math.max(...cash)]);
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    ok(avg(cashL) > avg(cash) * 1.6, 'the lucky clover makes bags richer', [avg(cash), avg(cashL)]);
}

section('the clock, the goal and the shop');
{
    const s = S.create(11);
    s.money = 100;
    run(s, 60 * 61);
    ok(s.phase === 'over', 'missing the goal at 0:00 ends the run', s.phase);
    ok(!S.fire(s) && !S.openShop(s) && !S.nextLevel(s), 'nothing moves once it is over');

    const w = S.create(11);
    ok(!S.finish(w), 'cannot end early below the goal');
    w.money = 700;
    ok(S.finish(w) && w.phase === 'cleared', 'can end early once the goal is met');
    ok(S.openShop(w) && w.phase === 'shop' && w.offers.length >= 1, 'the shop opens with offers', w.offers);
    ok(w.offers.every(o => S.SHOP[o.kind] && o.price > 0 && Number.isInteger(o.price)), 'offers are real items with prices');
    w.offers = [{ kind: 'dynamite', price: 30, sold: false }, { kind: 'strength', price: 200, sold: false }, { kind: 'polish', price: 9999, sold: false }];
    ok(S.buy(w, 0) && w.dynamite === 1 && w.money === 670, 'buying dynamite');
    ok(!S.buy(w, 0), 'each offer sells once');
    ok(!S.buy(w, 2) && w.money === 670, 'cannot buy what you cannot afford');
    ok(!S.buy(w, 7), 'no such offer');
    ok(S.buy(w, 1) && w.bought.strength && !w.buffs.strength, 'a perk waits for the next level');
    ok(S.nextLevel(w) && w.level === 2 && w.buffs.strength && !Object.keys(w.bought).length, 'and is active there');
    ok(w.goal === S.goalFor(2) && w.time === 60 && w.phase === 'play' && w.dynamite === 1, 'level 2 starts clean, dynamite kept');
    w.money = w.goal; S.finish(w); S.openShop(w); S.nextLevel(w);
    ok(!w.buffs.strength, 'a perk lasts one level only');

    // offers over many shops: every kind turns up, prices rise with level
    const seen = {}, early = [], late = [];
    for (let seed = 1; seed < 300; seed++) {
        const t = S.create(seed); t.money = 1e6; S.finish(t); S.openShop(t);
        for (const o of t.offers) { seen[o.kind] = (seen[o.kind] || 0) + 1; if (o.kind === 'dynamite') early.push(o.price); }
        t.level = 12; t.phase = 'cleared'; S.openShop(t);
        for (const o of t.offers) if (o.kind === 'dynamite') late.push(o.price);
    }
    ok(S.SHOP_ORDER.every(k => seen[k] > 50), 'every shop item gets offered', seen);
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    ok(avg(late) > avg(early), 'prices rise deeper in', [avg(early), avg(late)]);
}

section('layouts: reachable, apart and worth the goal');
{
    let bad = 0, poor = 0, total = 0, sample = null;
    const templates = {};
    for (let seed = 1; seed <= 120; seed++) {
        for (let level = 1; level <= 20; level++) {
            const s = S.create(seed);
            const { name, items } = S.layout(s, level);
            templates[name] = (templates[name] || 0) + 1;
            total++;
            for (const it of items) {
                if (!S.inCone(it.x0, it.y, it.r) || !S.inCone(it.x1, it.y, it.r) || it.x < it.x0 || it.x > it.x1) { bad++; sample = sample || { seed, level, it }; }
                // every item can be hooked: a straight shot at its centre (static items)
                if (it.vx === 0) {
                    const s2 = S.create(seed); s2.items = items.map(o => ({ ...o }));
                    const target = s2.items.find(o => o.id === it.id);
                    // the first thing on that line is what the shot gets; follow the line until we reach the target
                    let guard = 0;
                    while (s2.items.includes(target) && guard++ < 40) {
                        s2.time = 60; s2.phase = 'play';
                        aimAt(s2, target);
                        while (s2.claw.mode === 'shoot') S.tick(s2);
                        s2.claw.item = null; s2.claw.mode = 'swing'; s2.claw.len = S.BASE_LEN;
                    }
                    if (s2.items.includes(target)) { bad++; sample = sample || { seed, level, unreachable: it }; }
                }
            }
            for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
                const a = items[i], b = items[j];
                const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
                if (Math.hypot(dx, a.y - b.y) < a.r + b.r) { bad++; sample = sample || { seed, level, overlap: [a, b] }; }
            }
            if (S.levelValue(items) < S.goalStep(level) * 1.3) { poor++; sample = sample || { seed, level, value: S.levelValue(items) }; }
            if (level === 1 && name !== 'open pit') bad++;
        }
    }
    ok(bad === 0, 'every item sits inside the swing, apart from the rest, and can be hooked', sample);
    ok(poor === 0, 'every level holds at least 1.3x what its goal asks for', sample);
    ok(Object.keys(templates).length === S.TEMPLATES.length, 'every hand-made template gets used', templates);
    ok(total === 2400, 'layouts checked', total);
}

section('seeded bot runs');
{
    const levels = [], t0 = Date.now();
    let invalid = 0, sample = null;
    for (let seed = 1; seed <= 250; seed++) {
        const s = S.create(seed), mem = { waited: 0 };
        let steps = 0;
        while (s.phase !== 'over' && s.level < 60 && steps++ < 60 * 60 * 70) {
            S.botStep(s, mem); S.tick(s); s.events.length = 0;
            if (!(s.money >= 0) || !Number.isFinite(s.time) || s.dynamite < 0 || s.time < 0) { invalid++; sample = sample || { seed, s }; break; }
        }
        if (s.phase !== 'over' || s.money >= s.goal) { invalid++; sample = sample || { seed, phase: s.phase, level: s.level }; }
        levels.push(s.level);
    }
    levels.sort((a, b) => a - b);
    const median = levels[levels.length >> 1];
    ok(invalid === 0, '250 bot runs all end in a valid game over', sample);
    ok(levels.filter(l => l >= 2).length >= 240, 'nearly every bot clears level 1', levels.slice(0, 12));
    ok(median >= 6 && median <= 25, 'a perfect-aim bot reaches a sensible depth', median);
    ok(levels[levels.length - 1] < 60, 'the goals eventually win', levels[levels.length - 1]);
    console.log('   bot median level ' + median + ', range ' + levels[0] + '-' + levels[levels.length - 1] + ', ' + (Date.now() - t0) + ' ms');

    // the same seed and the same decisions give the same run
    const play = seed => { const s = S.create(seed), mem = { waited: 0 }; while (s.phase !== 'over' && s.level < 60) { S.botStep(s, mem); S.tick(s); s.events.length = 0; } return s.level + ':' + s.money + ':' + s.ticks; };
    ok(play(77) === play(77), 'a replayed run ends the same', play(77));
}

console.log(failures ? failures + ' of ' + checks + ' goldclaw checks FAILED' : checks + ' goldclaw checks passed');
process.exit(failures ? 1 : 0);
