import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('games/harbor-master/index.html', 'utf8');
const source = html.match(/<script id="harbor-sim">([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, 'standalone page exports its DOM-free simulation');
const context = { window: {} };
vm.runInNewContext(source, context);
const sim = context.window.HARBOR_MASTER;
const json = value => JSON.stringify(value);
let passed = 0;
function test(name, run) { run(); passed++; console.log('ok - ' + name); }

test('same seed produces the same initial traffic', () => {
  assert.equal(json(sim.create(98)), json(sim.create(98)));
  assert.notEqual(json(sim.create(98)), json(sim.create(99)));
  assert.equal(sim.create(98).ships.length, 1);
});
test('routes are atomic, copied, bounded and clearable', () => {
  const state = sim.create(98), ship = state.ships[0];
  const points = [{ x: 200, y: 100 }, { x: 740, y: 100 }];
  assert.equal(sim.route(state, ship.id, points), true);
  points[0].x = 333;
  assert.equal(ship.waypoints[0].x, 200, 'caller cannot mutate accepted route');
  const before = json(ship.waypoints);
  for (const bad of [null, [{ x: NaN, y: 100 }], [{ x: Infinity, y: 100 }], [{ x: -1, y: 100 }], [{ x: 801, y: 100 }], [{ x: 100, y: 521 }], Array(33).fill({ x: 100, y: 100 })]) {
    assert.equal(sim.route(state, ship.id, bad), false);
    assert.equal(json(ship.waypoints), before, 'invalid route must not erase valid orders');
  }
  assert.equal(sim.route(state, 999, []), false);
  assert.equal(sim.route(state, ship.id, []), true);
  assert.equal(ship.waypoints.length, 0);
});
test('ships follow waypoints and dock once at their matching berth', () => {
  const state = sim.create(98), ship = state.ships[0];
  ship.x = 730; ship.y = 100; ship.type = 0;
  assert.equal(sim.route(state, ship.id, [{ x: 740, y: 100 }]), true);
  for (let i = 0; i < 20; i++) sim.step(state, 0.05);
  assert.equal(state.score, 100);
  assert.equal(state.docked, 1);
  assert.equal(state.ships.some(s => s.id === ship.id), false);
  for (let i = 0; i < 20; i++) sim.step(state, 0.05);
  assert.equal(state.score, 100, 'a removed ship never scores twice');
});
test('swept collision catches ships that cross between ticks, before awarding dock points', () => {
  const state = sim.create(98), a = state.ships[0];
  Object.assign(a, { x: 100, y: 100, vx: 1, vy: 0, speed: 2000 });
  state.ships.push({ ...a, id: 2, x: 180, vx: -1, waypoints: [] });
  sim.step(state, 0.05);
  assert.equal(state.over, true, 'crossing ships cannot tunnel through each other');
  assert.equal(state.reason, 'collision');
  assert.equal(state.score, 0);
  const atDock = sim.create(98);
  Object.assign(atDock.ships[0], { x: 735, y: 100 });
  atDock.ships.push({ ...atDock.ships[0], id: 2, waypoints: [] });
  sim.step(atDock, 0.05);
  assert.equal(atDock.reason, 'collision');
  assert.equal(atDock.score, 0, 'collision is resolved before docking');
});
test('the wrong berth and grounding end a shift without scoring', () => {
  const wrong = sim.create(98);
  Object.assign(wrong.ships[0], { x: 735, y: 260 });
  sim.step(wrong, 0.05);
  assert.equal(wrong.reason, 'wrong berth');
  assert.equal(wrong.score, 0);
  const shore = sim.create(98);
  Object.assign(shore.ships[0], { x: 25, y: 200, vx: -1, speed: 50 });
  for (let i = 0; i < 10; i++) sim.step(shore, 0.05);
  assert.equal(shore.reason, 'grounding');
});
test('traffic admission is deterministic, capped and separated from existing ships', () => {
  const a = sim.create(98), b = sim.create(98);
  a.ships = []; b.ships = [];
  for (let i = 0; i < 6; i++) {
    const admitted = sim.admit(a);
    assert.equal(admitted, sim.admit(b));
    assert.equal(json(a), json(b));
    for (let j = 0; j < a.ships.length; j++) for (let k = j + 1; k < a.ships.length; k++) {
      assert.ok(Math.hypot(a.ships[j].x - a.ships[k].x, a.ships[j].y - a.ships[k].y) >= 80);
    }
  }
  assert.ok(a.ships.length > 1);
  const full = sim.create(1); full.ships = Array.from({ length: 6 }, (_, i) => ({ ...full.ships[0], id: i + 1 }));
  assert.equal(sim.admit(full), false);
  assert.equal(full.ships.length, 6);
});
test('pause, invalid time and a finished shift do not mutate the simulation', () => {
  const state = sim.create(98); state.paused = true;
  let before = json(state);
  assert.equal(sim.step(state, 0.5), false);
  assert.equal(json(state), before);
  state.paused = false; before = json(state);
  for (const bad of [NaN, Infinity, -1, 100]) { assert.equal(sim.step(state, bad), false); assert.equal(json(state), before); }
  state.ships = []; state.ticks = 2399; state.nextSpawn = Infinity;
  sim.step(state, 0.05);
  assert.equal(state.over, true);
  assert.equal(state.reason, 'shift complete');
  before = json(state); sim.step(state, 1);
  assert.equal(json(state), before);
  assert.equal(sim.route(state, 1, []), false);
});
test('fixed ticks produce the same state for different render-frame grouping', () => {
  const a = sim.create(42), b = sim.create(42);
  for (let i = 0; i < 260; i++) sim.step(a, 0.05);
  for (let i = 0; i < 130; i++) sim.step(b, 0.1);
  assert.equal(json(a), json(b));
  assert.ok(a.ships.length > 1, 'traffic arrives as the shift proceeds');
});
test('the local record survives a My Documents export/restore', () => {
  const store = new Map([['harbor-master-98-best', '700']]);
  const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const window = {};
  vm.runInNewContext(readFileSync('js/documents.js', 'utf8'), { window, localStorage,
    btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary') });
  const docs = window.DOCUMENTS, doc = docs.DOCS.find(d => d.keys.includes('harbor-master-98-best'));
  assert.ok(doc, 'the requested game record is registered for backup');
  const backup = docs.unpack(docs.pack(null));
  assert.equal(backup.ok, true);
  assert.equal(backup.files['harbor-master-98-best'], '700');
  docs.wipe(doc); docs.restore(backup.files);
  assert.equal(store.get('harbor-master-98-best'), '700');
});
console.log(`Harbor Master OK: ${passed} behavior checks.`);
