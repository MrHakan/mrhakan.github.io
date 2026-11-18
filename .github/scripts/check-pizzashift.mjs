// check-pizzashift.mjs: pizza shift 98 rules without a browser. Scoring,
// seeded order generation, the shop and save sanitising, then whole shifts
// played by a flawless cook (every pizza scores 100), a sloppy cook and an
// absent one (everybody walks out) across many seeds. Every run must end.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = { window: {} };
vm.runInNewContext(readFileSync('games/pizza-shift/pizza-shift-sim.js', 'utf8'), context);
const S = context.window.PIZZA_SIM;
assert.ok(S, 'the sim exports window.PIZZA_SIM without a dom');
const json = v => JSON.stringify(v);
const deq = (a, b, m) => assert.equal(json(a), json(b), m);
const run = (ds, sec) => { for (let i = 0; i < Math.round(sec / 0.05); i++) S.step(ds, 0.05); };
let passed = 0;
function test(name, run) { run(); passed++; console.log('ok - ' + name); }

test('quarters follow the screen: top-right, top-left, bottom-left, bottom-right', () => {
    assert.equal(S.quarterOf(0.5, -0.5), 0);
    assert.equal(S.quarterOf(-0.5, -0.5), 1);
    assert.equal(S.quarterOf(-0.5, 0.5), 2);
    assert.equal(S.quarterOf(0.5, 0.5), 3);
});
test('expected counts: whole covers four quarters, halves two, quarters one', () => {
    const order = { items: [{ topping: 'pepperoni', region: 'whole' }, { topping: 'olive', region: 'left' }, { topping: 'onion', region: 'q3' }], bake: 'regular', slices: 8 };
    const e = S.expectedCounts(order), pi = S.TOPPING_INDEX.pepperoni, oi = S.TOPPING_INDEX.olive, ni = S.TOPPING_INDEX.onion;
    deq(e.map(q => q[pi]), [2, 2, 2, 2]);
    deq(e.map(q => q[oi]), [0, 2, 2, 0]);
    deq(e.map(q => q[ni]), [0, 0, 0, 2]);
});
test('topping score: perfect placement is 100, mistakes cost per quarter', () => {
    const order = { items: [{ topping: 'pepperoni', region: 'whole' }, { topping: 'mushroom', region: 'right' }], bake: 'regular', slices: 8 };
    const perfect = S.perfectPieces(order);
    assert.equal(perfect.length, 12);
    assert.equal(S.scoreToppings(order, perfect).score, 100);
    const missing = perfect.slice(1);
    const r = S.scoreToppings(order, missing);
    assert.equal(r.quarters.filter(q => q === 80).length, 1, 'one missing piece costs its quarter 20');
    assert.equal(r.score, 95);
    const wrong = perfect.concat([{ t: 'olive', x: -0.5, y: 0.5 }]);
    assert.equal(S.scoreToppings(order, wrong).quarters[2], 80, 'an unordered topping costs its quarter');
    const floor = perfect.concat([{ t: 'pepperoni', x: 0.99, y: 0 }]);
    assert.equal(S.scoreToppings(order, floor).off, 1);
    assert.equal(S.scoreToppings(order, floor).score, 90, 'a piece on the crust costs 10');
    const pile = perfect.concat([{ ...perfect[0] }]);
    assert.ok(S.scoreToppings(order, pile).score < 95, 'stacking one topping costs extra');
    assert.equal(S.scoreToppings(order, []).score, 40, 'a bare pizza still has two empty quarters right');
    assert.equal(S.scoreToppings(order, [{ t: 'pepperoni', x: NaN, y: 0 }]).score, 40, 'junk pieces are ignored');
});
test('bake score: within 0.1 of the target is perfect, burnt is zero', () => {
    assert.equal(S.scoreBake(2, 2), 100);
    assert.equal(S.scoreBake(2, 2.1), 100);
    assert.equal(S.scoreBake(2, 1.9), 100);
    assert.equal(S.scoreBake(2, 2.6), 45);
    assert.equal(S.scoreBake(1, 0), 1);
    assert.equal(S.scoreBake(3, S.BURN_AT), 0);
    assert.equal(S.scoreBake(3, NaN), 0);
});
test('cut score: right count, even angles, through the centre', () => {
    const even = n => Array.from({ length: n }, (_, i) => ({ angle: i * Math.PI / n, offset: 0 }));
    assert.equal(S.scoreCut(8, even(4)), 100);
    assert.equal(S.scoreCut(6, even(3)), 100);
    assert.equal(S.scoreCut(4, even(2)), 100);
    assert.equal(S.scoreCut(8, even(3)), 70, 'one cut short costs 30');
    assert.equal(S.scoreCut(8, []), 0);
    assert.ok(S.scoreCut(4, [{ angle: 0, offset: 0 }, { angle: 0.01, offset: 0 }]) < 10, 'two cuts on one line are useless');
    assert.equal(S.scoreCut(4, [{ angle: 0, offset: 0 }, { angle: Math.PI / 2 + 0.02, offset: 0 }]), 100, 'a degree or two is fine');
    assert.equal(S.scoreCut(4, [{ angle: 0, offset: 0.23 }, { angle: Math.PI / 2, offset: 0 }]), 70, 'off-centre costs');
    assert.equal(S.scoreCut(4, [{ angle: Math.PI, offset: 0 }, { angle: -Math.PI / 2, offset: 0 }]), 100, 'angles are folded into [0, pi)');
});
test('wait score: full marks inside patience, zero at twice of it', () => {
    assert.equal(S.scoreWait(10, 60), 100);
    assert.equal(S.scoreWait(60, 60), 100);
    assert.equal(S.scoreWait(90, 60), 50);
    assert.equal(S.scoreWait(130, 60), 0);
});
test('tips grow with the score and the day; VIPs pay double', () => {
    assert.equal(S.tipFor(29, 1, false), 0);
    assert.equal(S.tipFor(100, 1, false), 350);
    assert.equal(S.tipFor(100, 1, true), 700);
    assert.ok(S.tipFor(80, 5, false) < S.tipFor(100, 5, false));
    assert.ok(S.tipFor(100, 9, false) > S.tipFor(100, 2, false));
    deq([95, 80, 60, 40].map(S.stars), [3, 2, 1, 0]);
});
test('orders come from the seed, valid, and get harder by the day', () => {
    for (let seed = 1; seed <= 60; seed++) for (let day = 1; day <= S.DAYS; day++) {
        const a = S.dayPlan(seed, day), b = S.dayPlan(seed, day);
        assert.equal(json(a), json(b), 'same seed and day, same customers');
        assert.equal(a.customers.length, Math.min(12, 2 + day));
        let last = -1;
        for (const c of a.customers) {
            assert.ok(S.validOrder(c.order), json(c.order));
            assert.ok(c.arrive > last); last = c.arrive;
            assert.ok(c.patience >= 30, 'patience ' + c.patience);
            assert.ok(c.face >= 0 && c.face < S.FACES.length);
            if (day === 1) {
                assert.equal(json(c.order.items.map(i => i.region)), '["whole"]');
                assert.equal(c.order.bake, 'regular'); assert.equal(c.order.slices, 8);
            }
            if (day < 3) { assert.equal(c.vip, false); assert.ok(!c.order.items.some(i => /^q/.test(i.region))); }
        }
    }
    assert.notEqual(json(S.dayPlan(1, 5)), json(S.dayPlan(2, 5)), 'other seeds, other customers');
    assert.notEqual(json(S.dayPlan(1, 5)), json(S.dayPlan(1, 6)));
    const items = d => { let n = 0; for (let s = 1; s <= 80; s++) for (const c of S.dayPlan(s, d).customers) n += c.order.items.length; return n / 80; };
    assert.ok(items(9) > items(4) && items(4) > items(1), 'later days ask for more toppings');
    const vips = Array.from({ length: 80 }, (_, s) => S.dayPlan(s, 9).customers.filter(c => c.vip).length).reduce((a, b) => a + b);
    assert.ok(vips > 40, 'impatient VIPs show up late in the week: ' + vips);
    const pat = (d, decor) => S.dayPlan(7, d, { decor }).customers[0].patience;
    assert.ok(pat(5, 3) > pat(5, 0), 'decor raises patience');
});
test('shop: prices, levels, money and caps', () => {
    const g = S.newGame(5);
    assert.equal(S.buy(g, 'ovens'), false, 'no money, no oven');
    g.money = 100000;
    assert.equal(S.priceOf(g, 'ovens'), 2500);
    assert.equal(S.buy(g, 'ovens'), true); assert.equal(g.upgrades.ovens, 3);
    assert.equal(S.buy(g, 'ovens'), true); assert.equal(g.upgrades.ovens, 4);
    assert.equal(S.priceOf(g, 'ovens'), null); assert.equal(S.buy(g, 'ovens'), false);
    assert.equal(g.money, 100000 - 8500);
    for (let i = 0; i < 5; i++) S.buy(g, 'decor');
    assert.equal(g.upgrades.decor, 3);
    assert.equal(S.buy(g, 'nonsense'), false);
    assert.equal(S.createDay(g).ovens.length, 4);
});
test('saves are sanitised: junk resets, ranges are clamped', () => {
    assert.equal(S.sanitizeSave(null), null);
    assert.equal(S.sanitizeSave('x'), null);
    assert.equal(S.sanitizeSave({ v: 99 }), null);
    const g = S.sanitizeSave({ v: 1, seed: 7, day: 99, money: -5, upgrades: { ovens: 9, heat: 1, scoop: 'yes' }, stars: [3, 9, 'x'], best: { money: 12 } });
    assert.equal(g.day, 1); assert.equal(g.money, 0); assert.equal(g.upgrades.ovens, 2); assert.equal(g.upgrades.heat, 1);
    assert.equal(g.upgrades.scoop, 0); deq(Array.from(g.stars), [3, 0, 0]); assert.equal(g.best.money, 12);
    const round = S.sanitizeSave(JSON.parse(JSON.stringify(Object.assign(S.newGame(3), { day: 4, money: 900 }))));
    assert.equal(round.day, 4); assert.equal(round.money, 900);
});
test('the line refuses nonsense: wrong station, bad numbers, full ovens', () => {
    const g = S.newGame(11), ds = S.createDay(g);
    assert.equal(S.takeOrder(ds), 0, 'nobody to serve before the first arrival');
    run(ds, 2.5);
    const id = S.takeOrder(ds);
    assert.equal(id, 1);
    assert.equal(S.addPiece(ds, id, 'anchovy', 0, 0), 0);
    assert.equal(S.addPiece(ds, id, 'olive', NaN, 0), 0);
    assert.equal(S.addPiece(ds, id, 'olive', 5, 0), 0);
    assert.equal(S.addPiece(ds, 99, 'olive', 0, 0), 0);
    assert.equal(S.addPiece(ds, id, 'olive', 0.3, 0.3), 1);
    assert.equal(S.undoPiece(ds, id), true); assert.equal(S.ticket(ds, id).pieces.length, 0);
    assert.equal(S.addCut(ds, id, -1, 0, 1, 0).ok, false, 'no cutting raw dough');
    assert.equal(S.serve(ds, id), null, 'no serving raw dough');
    assert.equal(S.toOven(ds, id), 0);
    assert.equal(S.toOven(ds, id), -1, 'one pizza, one oven');
    assert.equal(S.addPiece(ds, id, 'olive', 0, 0), 0, 'no topping in the oven');
    run(ds, 10);
    assert.equal(S.takeOut(ds, 0), id);
    assert.ok(Math.abs(S.ticket(ds, id).heat - 2) < 1e-9);
    assert.equal(S.takeOut(ds, 0), 0);
    assert.equal(S.addCut(ds, id, -0.2, 0, 0.2, 0).ok, false, 'too short');
    assert.equal(S.addCut(ds, id, -1, 0.6, 1, 0.6).ok, false, 'misses the centre');
    assert.equal(S.addCut(ds, id, -1, 0.1, 1, 0.1).ok, true);
    assert.ok(Math.abs(S.ticket(ds, id).cuts[0].offset - 0.1) < 1e-9);
    assert.ok(Math.abs(S.ticket(ds, id).cuts[0].d - 0.1) < 1e-9, 'a horizontal cut below the centre sits at +0.1 along (0, 1)');
    S.undoCut(ds, id); S.addCut(ds, id, 1, -0.2, -1, -0.2);
    assert.ok(Math.abs(S.ticket(ds, id).cuts[0].d + 0.2) < 1e-9, 'stroke direction does not flip the side');
    assert.equal(S.undoCut(ds, id), true);
    const r = S.serve(ds, id);
    assert.equal(r.parts.cut, 0); assert.equal(r.parts.bake, 100); assert.equal(r.parts.wait, 100);
    assert.equal(S.serve(ds, id), null, 'served once');
});
test('scoop drops pairs; steady cutter snaps through the centre', () => {
    const g = S.newGame(3); g.upgrades.scoop = 1; g.upgrades.cutter = 1;
    const ds = S.createDay(g); run(ds, 3); const id = S.takeOrder(ds);
    assert.equal(S.addPiece(ds, id, 'pepperoni', 0.5, -0.5), 2);
    const [a, b] = S.ticket(ds, id).pieces;
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 2 * S.SCOOP_GAP) < 1e-9);
    assert.equal(S.undoPiece(ds, id), true); assert.equal(S.ticket(ds, id).pieces.length, 0, 'undo lifts the whole scoop');
    S.toOven(ds, id); run(ds, 10); S.takeOut(ds, 0);
    S.addCut(ds, id, -1, 0.3, 1, 0.3);
    assert.equal(S.ticket(ds, id).cuts[0].offset, 0);
});
test('ovens announce ready and burnt once each, and a burnt pizza scores 0 for bake', () => {
    const ds = S.createDay(S.newGame(4)); run(ds, 3); const id = S.takeOrder(ds); S.toOven(ds, id);
    for (let i = 0; i < 300; i++) S.step(ds, 0.1);
    const kinds = ds.events.map(e => e.kind);
    assert.equal(kinds.filter(k => k === 'ready').length, 1);
    assert.equal(kinds.filter(k => k === 'burnt').length, 1);
    assert.equal(ds.ovens[0].heat, S.HEAT_CAP);
    S.takeOut(ds, 0);
    S.addCutAngle(ds, id, 0);
    assert.equal(S.serve(ds, id).parts.bake, 0);
});

// ---------------------------------------------------------------- whole shifts
function playDay(game, cook, dt = 0.1) {
    const ds = S.createDay(game);
    let guard = 0;
    while (!ds.over) {
        S.step(ds, dt); cook(ds);
        if (++guard > 200000) throw new Error('a shift never ended');
    }
    return { ds, res: S.dayResult(ds) };
}
function perfectCook(ds) {
    while (S.takeOrder(ds)) { /* take everyone in the line */ }
    for (const tk of ds.tickets) {
        if (tk.status === 'ordered' && S.freeOven(ds) >= 0) {
            for (const p of S.perfectPieces(tk.order)) {
                if (ds.scoop) throw new Error('perfect cook places single pieces');
                assert.equal(S.addPiece(ds, tk.id, p.t, p.x, p.y), 1);
            }
            S.toOven(ds, tk.id);
        }
    }
    ds.ovens.forEach((o, i) => {
        if (o.ticket && o.heat >= S.bakeTarget(S.ticket(ds, o.ticket).order) - 0.02) S.takeOut(ds, i);
    });
    for (const tk of ds.tickets) if (tk.status === 'baked') {
        const n = tk.order.slices / 2;
        for (let k = 0; k < n; k++) assert.equal(S.addCutAngle(ds, tk.id, k * Math.PI / n).ok, true);
        const r = S.serve(ds, tk.id);
        assert.equal(r.total, 100, 'perfect play scores 100: ' + json(r.parts));
    }
}
test('a perfect cook scores 100 on every pizza of every day for 40 seeds', () => {
    let pizzas = 0;
    for (let seed = 1; seed <= 40; seed++) {
        const game = S.newGame(seed);
        while (!game.won) {
            const { res } = playDay(game, perfectCook);
            assert.equal(res.walkouts, 0); assert.equal(res.avg, 100); assert.equal(res.stars, 3); assert.equal(res.passed, true);
            pizzas += res.served;
            S.finishDay(game, res);
        }
        assert.equal(game.day, S.DAYS); assert.equal(S.totalStars(game), 30);
        assert.ok(game.money > 30000, 'a perfect week earns ' + game.money);
    }
    assert.ok(pizzas > 2000);
});
test('a sloppy cook with upgrades always finishes with sane scores', () => {
    for (let seed = 1; seed <= 120; seed++) {
        const r = S.rng(seed * 7919);
        const game = S.newGame(seed); game.day = 1 + (seed % S.DAYS);
        game.upgrades = { ovens: 2 + r.int(3), heat: r.int(3), scoop: r.int(2), cutter: r.int(2), decor: r.int(4) };
        const sloppy = ds => {
            if (r() < 0.05) S.takeOrder(ds);
            for (const tk of ds.tickets) {
                if (tk.status === 'ordered') {
                    if (r() < 0.2) S.addPiece(ds, tk.id, S.TOPPINGS[r.int(6)].id, r() * 2.2 - 1.1, r() * 2.2 - 1.1);
                    if (r() < 0.02) S.undoPiece(ds, tk.id);
                    if (r() < 0.03) S.toOven(ds, tk.id);
                } else if (tk.status === 'baked') {
                    if (r() < 0.1) S.addCut(ds, tk.id, r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
                    if (r() < 0.03) S.serve(ds, tk.id);
                }
            }
            ds.ovens.forEach((o, i) => { if (o.ticket && r() < 0.01) S.takeOut(ds, i); });
        };
        const { ds, res } = playDay(game, sloppy, 0.05 + r() * 0.4);
        assert.equal(res.served + res.walkouts, ds.customers.length);
        for (const x of res.results) {
            assert.ok(x.total >= 0 && x.total <= 100 && Number.isInteger(x.total));
            for (const v of Object.values(x.parts)) assert.ok(v >= 0 && v <= 100);
            assert.ok(x.tip >= 0 && Number.isInteger(x.tip));
        }
        assert.ok(ds.ovens.every(o => o.ticket === 0 || S.ticket(ds, o.ticket).status === 'baking'));
        const before = json(game);
        S.finishDay(game, res);
        if (!res.passed) assert.equal(game.money, JSON.parse(before).money, 'a failed day keeps no tips');
        assert.ok(S.sanitizeSave(JSON.parse(json(game))), 'every save round-trips');
    }
});
test('nobody at the counter: everyone walks out, the day fails and is retried', () => {
    for (let seed = 1; seed <= 30; seed++) {
        const game = S.newGame(seed); game.day = 1 + (seed % S.DAYS);
        const day = game.day;
        const { ds, res } = playDay(game, () => {}, 0.5);
        assert.equal(res.walkouts, ds.customers.length); assert.equal(res.avg, 0); assert.equal(res.passed, false);
        S.finishDay(game, res);
        assert.equal(game.day, day, 'the same day again');
    }
});
test('a walkout frees the oven their pizza was in', () => {
    const ds = S.createDay(S.newGame(8)); run(ds, 3); const id = S.takeOrder(ds); S.toOven(ds, id);
    for (let i = 0; i < 4000 && S.customer(ds, id).status !== 'left'; i++) S.step(ds, 0.1);
    assert.equal(S.customer(ds, id).status, 'left');
    assert.equal(ds.ovens[0].ticket, 0); assert.equal(S.ticket(ds, id).status, 'void');
});

console.log(passed + ' pizzashift checks passed');
