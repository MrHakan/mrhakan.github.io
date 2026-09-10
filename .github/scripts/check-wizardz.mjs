// Deterministic regressions for combat, drawing input and duel lifecycle.
// No browser/dependencies: run the real engine with a small event surface.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Surface {
    constructor() { this.listeners = new Map(); this.captured = new Set(); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    emit(type, detail = {}) { const e = { preventDefault() {}, ...detail }; for (const fn of this.listeners.get(type) || []) fn(e); }
    setPointerCapture(id) { this.captured.add(id); }
    contains(node) { return node === this || node === canvas; }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 380, height: 200 }; }
    querySelector() { return null; }
    count() { return [...this.listeners.values()].reduce((n, fns) => n + fns.size, 0); }
}
const canvas = new Surface(); canvas.width = 760; canvas.height = 400;
const document = new Surface(); document.hidden = false; document.activeElement = canvas;
const root = new Surface();
const window = new Surface();
let now = 1000;
const storage = new Map();
const context = vm.createContext({ window, document, console, soundEnabled: false,
    performance: { now: () => now }, requestAnimationFrame: () => 1,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }
});
vm.runInContext(fs.readFileSync('games/wizardz/wizardz-data.js', 'utf8'), context);
// Test seams stay out of the shipped API.
const source = fs.readFileSync('games/wizardz/wizardz.js', 'utf8').replace('    window.WZ_ENGINE = {', `
    window.test = { makeDuel, castSpell, dealDamage, heal, step, nextRound, restartMatch,
        snapshot, applySnapshot, pauseDuel, bindInput, touchMove, tryRecognize,
        setSurface(canvas, body) { cv = canvas; root = body; },
        simulateFrames(g, hz) {
            const originalRender = render;
            G = g; ctx = {}; root = null; winRef = null; lastT = 0; render = () => {};
            try { for (let frame = 1; frame <= hz * 2; frame++) loop(frame * 1000 / hz); }
            finally { render = originalRender; G = null; ctx = null; }
        } };
    window.WZ_ENGINE = {`);
vm.runInContext(source, context);
const T = window.test, D = window.WZ, E = window.WZ_ENGINE;
const duel = () => { const g = T.makeDuel(null, { solo: true, botId: 'cinder' }); g.phase = 'live'; return g; };
let checks = 0;
function test(name, run) { run(); checks++; console.log('  ok    ' + name); }

test('repeated identical points and taps cannot hang the recognizer', () => {
    assert.equal(E.recognize([[{x: 4, y: 4}, {x: 4, y: 4}, {x: 4, y: 4}, {x: 4, y: 4}]]).length, 0);
    assert.equal(E.recognize([null, [], [{x: NaN, y: 4}]]).length, 0);
});
test('casts cannot spend resources or hit during countdown, pause or death', () => {
    for (const state of ['countdown', 'roundover', 'matchover', 'paused', 'dead']) {
        const g = duel();
        if (state === 'paused') g.paused = true;
        else if (state === 'dead') g.wiz[0].dead = true;
        else g.phase = state;
        assert.equal(T.castSpell(g, 0, D.byId('fireball'), 1), 'inactive');
        assert.equal(g.wiz[0].mana, D.ARENA.maxMana);
        assert.equal(g.ents.length, 0);
    }
});
test('live spells cost mana and obey cooldowns', () => {
    const g = duel(), spell = D.byId('fireball');
    T.castSpell(g, 0, spell, 1);
    assert.equal(g.wiz[0].mana, D.ARENA.maxMana - spell.cost);
    assert.ok(g.ents.length > 0);
    assert.equal(T.castSpell(g, 0, spell, 1), 'cooling');
});
test('lethal retaliation ends the round and cannot be healed back to life', () => {
    const g = duel();
    g.wiz[0].hp = 2;
    g.wiz[1].st.thorns = { t: 5, thorns: 5 };
    T.dealDamage(g, 1, 10, { from: 0 });
    assert.equal(g.wiz[0].dead, true);
    T.heal(g, 0, 50);
    assert.equal(g.wiz[0].hp, 0);
    T.step(g, 1 / 60);
    assert.equal(g.phase, 'roundover');
    assert.equal(g.lastWinner, 1);
});
test('expired thorn wards stop retaliating', () => {
    const g = duel(); g.wiz[1].wardThorns = 7; g.wiz[1].ward = 0;
    T.dealDamage(g, 1, 10, { from: 0 });
    assert.equal(g.wiz[0].hp, 100);
});
test('continuous damage merges readouts; full health healing emits nothing', () => {
    const g = duel(); T.heal(g, 0, 1); assert.equal(g.floats.length, 0);
    for (let i = 0; i < 60; i++) { g.t = i / 60; T.dealDamage(g, 0, 3 / 60, { contact: false }); }
    assert.ok(g.floats.length <= 4);
    assert.ok(g.floats.every(f => f.text !== '-0'));
    assert.ok(Math.abs(g.wiz[0].hp - 97) < 1e-8);
});
test('pause freezes health, time and entities and clears held input', () => {
    const g = duel(); g.input[0].up = 1;
    T.pauseDuel(g); const t = g.t, y = g.wiz[0].y;
    T.step(g, 10);
    assert.equal(g.t, t); assert.equal(g.wiz[0].y, y); assert.equal(g.input[0].up, 0);
    T.pauseDuel(g, false); T.step(g, 1 / 60); assert.ok(g.t > t);
    const online = duel(); online.solo = false; T.pauseDuel(online); assert.equal(online.paused, false);
});
test('rematches remove old ink, ward effects and movement', () => {
    const g = duel(); g.wiz[0].wardZap = true; g.wiz[0].wardThorns = 12;
    g.strokes = [[{x: 1, y: 1}]]; g.input[0].down = 1; g.phase = 'matchover';
    T.restartMatch(g);
    assert.equal(g.wiz[0].wardZap, false); assert.equal(g.wiz[0].wardThorns, 0);
    assert.equal(g.strokes.length, 0); assert.equal(g.input[0].down, 0); assert.equal(g.phase, 'countdown');
});
test('snapshots carry the round and match winner, even if an event was missed', () => {
    const host = duel(), guest = duel(); host.lastWinner = 1; host.over = 1; host.phase = 'matchover';
    T.applySnapshot(guest, T.snapshot(host));
    assert.equal(guest.lastWinner, 1); assert.equal(guest.over, 1);
});
test('manual multi-stroke casting waits for explicit submission', () => {
    const g = duel(); g.manualCast = true;
    g.strokes = D.byId('fireball').glyph; g.lastInk = now - 2000;
    T.tryRecognize(g); assert.equal(g.ents.length, 0); assert.ok(g.strokes.length);
    T.tryRecognize(g, true); assert.ok(g.ents.length); assert.equal(g.strokes.length, 0);
});
test('pointer ownership allows drawing while a second finger moves', () => {
    const g = duel(); T.setSurface(canvas, root); T.bindInput(g);
    canvas.emit('pointerdown', { pointerId: 4, button: 0, clientX: 10, clientY: 10 });
    canvas.emit('pointermove', { pointerId: 4, clientX: 30, clientY: 30 });
    T.touchMove(g, 'up', true);
    canvas.emit('pointerup', { pointerId: 9 });
    assert.ok(g.stroke); assert.equal(g.input[0].up, 1);
    canvas.emit('pointermove', { pointerId: 9, clientX: 80, clientY: 80 });
    assert.equal(g.stroke.length, 2);
    canvas.emit('pointerup', { pointerId: 4 }); assert.equal(g.stroke, null);
    // Losing only the keyboard key does not cancel a held touch control.
    window.emit('keyup', { key: 'w' }); assert.equal(g.input[0].up, 1);
    window.emit('blur'); assert.equal(g.input[0].up, 0); assert.equal(g.paused, true);
    g._unbind(); assert.equal(canvas.count() + window.count() + document.count() + root.count(), 0);
});
test('pointer cancellation discards incomplete ink and keys ignore other windows', () => {
    const g = duel(); T.bindInput(g);
    canvas.emit('pointerdown', { pointerId: 5, button: 0, clientX: 10, clientY: 10 });
    canvas.emit('pointercancel', { pointerId: 5 }); assert.equal(g.strokes.length, 0);
    document.activeElement = {}; window.emit('keydown', { key: 'w', target: { tagName: 'DIV' } }); assert.equal(g.input[0].up, 0);
    document.activeElement = canvas; window.emit('keydown', { key: 'w', target: canvas }); assert.equal(g.input[0].up, 1);
    document.hidden = true; document.emit('visibilitychange'); assert.equal(g.paused, true); assert.equal(g.input[0].up, 0);
    g._unbind();
});
test('30, 60 and 144 Hz frames produce the same combat simulation', () => {
    const results = [30, 60, 144].map(hz => {
        const g = duel(); g.solo = false; g.wiz[0].mana = 20;
        g.input[0].down = 1; T.castSpell(g, 0, D.byId('fireball'), 1);
        T.simulateFrames(g, hz);
        return [g.t, g.wiz[0].y, g.wiz[0].mana, g.wiz[1].hp, g.ents.length];
    });
    assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]);
    assert.ok(Math.abs(results[0][0] - 2) < 1e-8);
});
test('blocked local storage still permits a bot duel', () => {
    vm.runInContext('localStorage.getItem = () => { throw new Error("blocked"); }', context);
    assert.equal(T.makeDuel(null, {solo: true}).manualCast, false);
});
console.log(`\n${checks} Wizardz regression checks passed.`);
