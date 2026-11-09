import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const world = vm.createContext({});
for (const name of ['rift-data.js', 'rift-animation.js']) vm.runInContext(fs.readFileSync('games/rift-rumble/' + name, 'utf8'), world);
const A = world.RIFT_ANIM, D = world.RIFT;
const fighter = (extra = {}) => ({ x: 0, vx: 0, vy: 0, grounded: true, character: 0, attack: null, stun: 0, dodge: 0, ...extra });
const rig = { split: 0, armSide: 1, headLeft: -28, headRight: 28, neck: -34 };
let n = 0;
function test(name, fn) { fn(); n++; console.log('  ok    ' + name); }
test('all 50 keyframes keep the face rigid, including left-hand weapons', () => {
    for (const side of [-1, 1]) for (let frame = 0; frame < A.COUNT; frame++) {
        const p = A.pose(frame), r = { ...rig, armSide: side };
        const a = A.vertex(-8, -55, p, r), b = A.vertex(8, -55, p, r), c = A.vertex(-8, -45, p, r);
        assert.equal(b.x - a.x, 16); assert.equal(b.y - a.y, 0); assert.equal(c.y - a.y, 10); assert.equal(c.x - a.x, 0);
    }
});
test('the eight-step run alternates legs and always has a planted foot', () => {
    const signatures = new Set();
    for (let i = 5; i <= 12; i++) {
        const p = A.pose(i); assert.ok(p.leftY <= 0 && p.rightY <= 0); assert.ok(p.leftY === 0 || p.rightY === 0);
        signatures.add([p.leftX, p.leftY, p.rightX, p.rightY].join());
    }
    assert.equal(signatures.size, 8); assert.equal(A.pose(5).leftX, A.pose(9).rightX);
});
test('briefcases and pillows keep their shape throughout every attack', () => {
    for (const character of [7, 8]) for (let frame = 17; frame <= 40; frame++) {
        const r = { ...rig, character, armSide: -1, weaponBox: { left: -30, right: -14, top: -28, bottom: -5 } }, p = A.pose(frame);
        p.weaponLift = A.weaponLift(p, r);
        const a = A.vertex(-24, -23, p, r), b = A.vertex(-16, -18, p, r);
        assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - Math.hypot(8, 5)) < 1e-9);
    }
});
test('no pose pushes a foot or weapon through the ground', () => {
    for (let i = 0; i < A.COUNT; i++) for (let y = -76; y <= 0; y += 4) for (let x = -35; x <= 35; x += 5) assert.ok(A.vertex(x, y, A.pose(i), rig).y <= 0);
});
test('run phase follows distance and agrees at 30, 60 and 144 fps', () => {
    const sample = fps => {
        const t = A.create(); A.update(t, fighter({ vx: 5 }), 0);
        for (let i = 1; i <= fps; i++) A.update(t, fighter({ x: 300 * i / fps, vx: 5 }), 60 * i / fps);
        return t;
    };
    const states = [30, 60, 144].map(sample);
    assert.ok(states.every(t => t.frame === states[0].frame && Math.abs(t.cycle - states[0].cycle) < 1e-9));
});
test('paused simulation freezes every animation clock', () => {
    const t = A.create(); A.update(t, fighter({ vx: 5 }), 0); A.update(t, fighter({ x: 10, vx: 5 }), 2);
    const before = [t.frame, t.cycle, t.time];
    for (let i = 3; i < 100; i++) A.update(t, fighter({ x: 10, vx: 5 }), 2, { paused: true });
    assert.deepEqual([t.frame, t.cycle, t.time], before);
});
test('late observers use the same host-owned stride and simulation phase', () => {
    const host = A.create(), guest = A.create();
    for (let tick = 0; tick <= 120; tick++) A.update(host, fighter({ x: tick * 5, vx: 5, travel: tick * 5 }), tick);
    A.update(guest, fighter({ x: 600, vx: 5, travel: 600 }), 120);
    assert.equal(guest.frame, host.frame); assert.equal(guest.cycle, host.cycle); assert.equal(guest.time, host.time);
});
test('attack contact frames coincide exactly with the damage window on every fighter', () => {
    for (let character = 0; character < 12; character++) for (const kind of ['light', 'heavy', 'special']) {
        const s = kind === 'special' && D.FIGHTERS[character].specialMelee || D.ATTACKS[kind];
        for (let age = 0; age < s.duration; age++) {
            const k = (A.attackFrame({ kind, age }, character) - 17) % 8;
            assert.equal(k === 3 || k === 4, age >= s.startup && age <= s.startup + s.active, `${character}/${kind}/${age}`);
        }
        assert.equal((A.attackFrame({ kind, age: s.duration - 1 }, character) - 17) % 8, 7);
    }
});
test('jump has separate takeoff, rising, apex and falling poses', () => {
    const t = A.create(), out = [];
    for (const [i, vy] of [-10, -4, 0, 8].entries()) { A.update(t, fighter({ grounded: false, vy }), i + 1); out.push(t.frame); }
    assert.deepEqual(out, [13, 14, 15, 16]);
    A.update(t, fighter(), 5); assert.equal(t.action, 'land'); assert.equal(t.frame, 47);
    for (let tick = 6; tick <= 15; tick++) A.update(t, fighter(), tick); assert.equal(t.action, 'idle');
});
test('reduced motion removes idle breathing without removing combat poses', () => {
    const t = A.create(); A.update(t, fighter(), 0, { reduced: true }); A.update(t, fighter(), 30, { reduced: true }); assert.equal(t.frame, 0);
    A.update(t, fighter({ attack: { kind: 'heavy', age: 13 } }), 31, { reduced: true }); assert.equal(t.action, 'attack');
});
console.log(`Brawlz animation: ${n} consistency checks passed.`);
