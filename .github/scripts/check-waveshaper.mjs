import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const rules = fs.readFileSync('games/waveshaper/waveshaper-sim.js', 'utf8');
const ui = fs.readFileSync('games/waveshaper/waveshaper.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(rules, context);
const W = context.WaveShaper;
let checks = 0;
function test(name, run) { run(); checks++; console.log('  ok    ' + name); }
function wait(game, duration) { for (let t = 0; t < duration; t += 1 / 120) W.step(game, 1 / 120); }
function hit(game) {
    while (game.obstacles[0].x > W.WIDTH - 28) W.step(game, 1 / 120);
    return W.act(game, game.obstacles[0].action);
}

test('the seeded wave covers all four actions and is reproducible', () => {
    const a = W.create('normal', 42), b = W.create('normal', 42), actions = new Set();
    for (let i = 0; i < 100; i++) {
        assert.equal(a.obstacles[0].action, b.obstacles[0].action);
        actions.add(a.obstacles[0].action); hit(a); hit(b);
    }
    assert.equal(actions.size, 4); assert.equal(a.score, 100); assert.equal(a.lives, 4);
});
test('wrong inputs cost a life, preserve the target and cannot be mashed in the same frame', () => {
    const game = W.create('normal', 42), first = game.obstacles[0];
    const wrong = (first.action + 1) % 4;
    assert.equal(W.act(game, wrong).type, 'wrong');
    assert.equal(game.lives, 3); assert.equal(game.obstacles[0], first);
    for (let i = 0; i < 20; i++) assert.equal(W.act(game, first.action), null);
    assert.equal(game.score, 0); wait(game, 0.25);
    assert.equal(W.act(game, first.action).type, 'hit'); assert.equal(game.score, 1);
});
test('unreadable offscreen targets and invalid actions cannot score or damage', () => {
    const game = W.create();
    game.obstacles[0].x = 1200;
    for (const input of [-1, 4, NaN, '0', 0, undefined]) assert.equal(W.act(game, input), null);
    assert.equal(game.lives, 4); assert.equal(game.score, 0);
});
test('misses end a normal run at four and a hard run at one; game over freezes the rules', () => {
    for (const [mode, misses] of [['normal', 4], ['hard', 1]]) {
        const game = W.create(mode, 23);
        for (let i = 0; i < misses; i++) {
            game.obstacles[0].x = W.PLAYER; W.step(game, 0.01);
        }
        assert.ok(game.over); assert.equal(game.mistakes, misses); assert.equal(game.lives, 0);
        const state = JSON.stringify(game); W.step(game, 1); W.act(game, 0);
        assert.equal(JSON.stringify(game), state);
    }
});
test('twenty consecutive matches heal one life, and damage resets the recovery streak', () => {
    const game = W.create('normal', 12);
    W.act(game, (game.obstacles[0].action + 1) % 4); wait(game, 0.25);
    for (let i = 0; i < 19; i++) assert.equal(hit(game).healed, false);
    assert.equal(game.lives, 3); assert.equal(hit(game).healed, true); assert.equal(game.lives, 4);
    while (game.obstacles[0].x > W.WIDTH - 28) W.step(game, 1 / 120);
    W.act(game, (game.obstacles[0].action + 1) % 4); assert.equal(game.streak, 0);
    assert.equal(game.longest, 20);
});
test('practice survives indefinite misses without changing its speed', () => {
    const game = W.create('practice', 1);
    for (let i = 0; i < 300; i++) { game.obstacles[0].x = W.PLAYER; W.step(game, 0.01); }
    assert.equal(game.mistakes, 300); assert.ok(!game.over); assert.equal(game.lives, 4);
    for (let i = 0; i < 100; i++) hit(game);
    assert.equal(game.speed, W.modes.practice.speed);
});
test('long runs stay readable, bounded and winnable at 30, 60 and 144 frames per second', () => {
    for (const fps of [30, 60, 144]) for (const mode of ['normal', 'hard']) {
        const game = W.create(mode, 865);
        for (let frame = 0; game.score < 500 && frame < fps * 600; frame++) {
            W.step(game, 1 / fps);
            const next = game.obstacles[0];
            if (next.x <= 700) W.act(game, next.action);
            assert.ok(!game.over); assert.ok(game.obstacles.length < 10);
            for (let i = 1; i < game.obstacles.length; i++) assert.ok(game.obstacles[i].x - game.obstacles[i - 1].x >= 259);
        }
        assert.equal(game.score, 500); assert.ok(game.speed <= W.modes[mode].cap);
    }
});
test('a suspended frame cannot fast-forward the run or introduce non-finite positions', () => {
    const game = W.create(), x = game.obstacles[0].x;
    W.step(game, 3600); assert.ok(x - game.obstacles[0].x <= game.speed * 0.051);
    for (const dt of [Infinity, NaN, -1]) W.step(game, dt);
    assert.ok(game.obstacles.every(o => Number.isFinite(o.x)));
});
test('standard shoulder, trigger and face buttons map to exactly four actions', () => {
    const pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    for (const [button, action] of [[4, 0], [6, 1], [5, 2], [7, 3], [3, 0], [0, 1], [2, 2], [1, 3]]) {
        pad.buttons[button].value = 1;
        assert.deepEqual([...W.padActions(pad)], [0, 1, 2, 3].map(i => i === action));
        pad.buttons[button].value = 0;
    }
});

// Exercise the real input adapter as well as the rules, without a browser-only debug API.
function setup(storage = '{}') {
    const frames = new Map(), elements = new Map(), docEvents = {}, winEvents = {}, writes = [];
    const drawing = new Proxy({}, { get: () => () => {}, set: () => true });
    let frameId = 0, currentGame, pads = [], now = 0;
    const element = () => ({
        textContent: '', hidden: false, disabled: false, value: 'normal', dataset: {}, tagName: 'BUTTON',
        classList: { toggle() {} }, setAttribute() {}, focus() {}, getContext: () => drawing,
        addEventListener(type, fn) { this[type] = fn; }
    });
    const buttons = Array.from({ length: 4 }, (_, i) => ({ ...element(), dataset: { action: String(i) } }));
    const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
    $('wave').tagName = 'CANVAS';
    const win = { addEventListener: (type, fn) => winEvents[type] = fn };
    const doc = {
        hidden: false, getElementById: $, querySelectorAll: () => buttons,
        addEventListener: (type, fn) => docEvents[type] = fn
    };
    const env = vm.createContext({
        window: win, document: doc, navigator: { getGamepads: () => pads },
        localStorage: { getItem: () => storage, setItem: (_, value) => writes.push(value) },
        matchMedia: () => ({ matches: true, addEventListener() {} }),
        requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id)
    });
    vm.runInContext(rules, env);
    const create = win.WaveShaper.create;
    win.WaveShaper.create = mode => currentGame = create(mode, 42);
    vm.runInContext(ui, env);
    return {
        $, buttons, doc, winEvents, writes, get game() { return currentGame; },
        key(code, repeat = false) { docEvents.keydown({ code, repeat, target: $('wave'), preventDefault() {} }); },
        tick() { const fn = [...frames.values()][0]; frames.clear(); fn(now += 16.667); },
        pads(value) { pads = value; }, visibility() { docEvents.visibilitychange(); }
    };
}
test('keyboard repeat never clears extra shapes, and all four touch buttons work', () => {
    const env = setup(); env.$('start').onclick();
    const code = ['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'][env.game.obstacles[0].action];
    env.key(code, true); assert.equal(env.game.score, 0);
    env.key(code); assert.equal(env.game.score, 1);
    for (let i = 0; i < 30; i++) env.key(code, true);
    assert.equal(env.game.score, 1);
    for (let i = 0; i < 4; i++) { env.game.obstacles[0].x = 600; env.game.obstacles[0].action = i; env.buttons[i].click(); }
    assert.equal(env.game.score, 5);
});
test('blur and hidden tabs pause without silently resuming or taking damage', () => {
    const env = setup(); env.$('start').onclick(); env.tick();
    env.winEvents.blur(); const x = env.game.obstacles[0].x;
    for (let i = 0; i < 20; i++) env.tick();
    assert.equal(env.game.obstacles[0].x, x); assert.equal(env.$('overlay').hidden, false);
    env.key('KeyP'); env.tick(); env.tick(); assert.ok(env.game.obstacles[0].x < x);
    env.doc.hidden = true; env.visibility(); env.doc.hidden = false; env.visibility();
    const paused = env.game.obstacles[0].x; env.tick(); env.tick(); assert.equal(env.game.obstacles[0].x, paused);
});
test('gamepad Start and shoulders detect edges, holding cannot repeat, disconnect pauses', () => {
    const env = setup(), pad = { index: 0, connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
    env.pads([pad]); env.tick(); pad.buttons[9].pressed = true; env.tick();
    assert.equal(env.$('overlay').hidden, true);
    pad.buttons[9].pressed = false; env.tick();
    const button = [4, 6, 5, 7][env.game.obstacles[0].action]; pad.buttons[button].pressed = true; env.tick();
    assert.equal(env.game.score, 1);
    for (let i = 0; i < 10; i++) env.tick(); assert.equal(env.game.score, 1);
    env.pads([]); env.tick(); assert.equal(env.$('overlay').hidden, false);
    assert.match(env.$('status').textContent, /disconnected/);
});
test('malformed or blocked storage cannot stop a run and records remain separate by mode', () => {
    for (const storage of ['broken', 'null', '42', '"text"', '[]']) {
        const env = setup(storage); env.$('start').onclick(); env.buttons[env.game.obstacles[0].action].click();
        env.winEvents.blur(); assert.equal(env.game.score, 1);
        const save = JSON.parse(env.writes.at(-1)); assert.equal(save.normal, 1); assert.equal(save.hard, undefined);
    }
});

console.log(`\n${checks} WAVESHAPER regression checks passed.`);
