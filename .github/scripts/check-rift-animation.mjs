import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const world = vm.createContext({});
for (const name of ['rift-data.js', 'rift-animation.js']) vm.runInContext(fs.readFileSync('games/rift-rumble/' + name, 'utf8'), world);
const A = world.RIFT_ANIM, D = world.RIFT;
const fighter = (extra = {}) => ({ x: 0, vx: 0, vy: 0, travel: 0, grounded: true, character: 0, attack: null, stun: 0, dodge: 0, ...extra });
let n = 0;
function test(name, fn) { fn(); n++; console.log('  ok    ' + name); }
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-5, message + ': ' + a + ' / ' + b);
test('all limb lengths and weapon attachments stay rigid through every action', () => {
    for (let character = 0; character < 12; character++) for (let tick = 0; tick < 180; tick++) {
        const variants = [
            fighter({ character, vx: 5, travel: tick * 5 }),
            fighter({ character, grounded: false, vy: Math.sin(tick / 20) * 12 }),
            fighter({ character, attack: { kind: 'heavy', dir: tick % 3 === 0 ? 'up' : tick % 3 === 1 ? 'side' : 'down', age: tick % 47 } })
        ];
        for (const p of variants) {
            const b = A.solve(A.sample(p, tick).pose), rig = A.profile(character);
            for (const side of ['f', 'b']) for (const [parent, child, length] of [['Upper', 'Lower', rig.arm], ['Lower', 'Hand', rig.forearm], ['Thigh', 'Shin', rig.thigh], ['Shin', 'Foot', rig.shin]]) near(Math.hypot(b[side + parent].x - b[side + child].x, b[side + parent].y - b[side + child].y), length, side + parent);
            near(Math.hypot(b.weapon.x - b.fHand.x, b.weapon.y - b.fHand.y), rig.handH * .45, 'weapon wrist attachment');
            assert.ok(Object.values(b).every(b => Number.isFinite(b.x + b.y + b.a)));
        }
    }
});
test('planted feet remain fixed in world space while the body advances', () => {
    for (let character = 0; character < 12; character++) for (const side of ['f', 'b']) {
        let anchor;
        const rig = A.profile(character), start = side === 'f' ? 0 : rig.stride / 2;
        for (let i = 0; i <= 40; i++) {
            const travel = start + i / 100 * rig.stride, pose = A.sample(fighter({ character, vx: 5, travel }), travel / 5).pose, foot = A.solve(pose)[side + 'Foot'];
            near(foot.y, -rig.footH * .6, 'flat sole'); near(foot.a, 0, 'level foot');
            const x = travel + foot.x * A.SCALE * 1.5; anchor ??= x; near(x, anchor, 'world-space plant');
        }
    }
});
test('stance-to-swing boundaries have continuous ankle positions', () => {
    for (let character = 0; character < 12; character++) for (const phase of [0, A.STANCE, 1]) {
        const before = A.foot(phase - 1e-7, character), after = A.foot(phase + 1e-7, character);
        assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 0.001);
    }
});
test('the running gait includes brief flight between alternating contacts', () => {
    for (let character = 0; character < 12; character++) for (const phase of [.46, .96]) assert.ok(A.foot(phase, character).y < -A.profile(character).footH * .6 && A.foot(phase + .5, character).y < -A.profile(character).footH * .6);
    assert.ok(A.foot(0).planted && A.foot(0.5).planted === false);
});
test('standing poses express distinct gestures and the baby has child proportions', () => {
    const poses = Array.from({ length: 12 }, (_, character) => A.sample(fighter({ character }), 0, true).pose), bones = poses.map(A.solve);
    assert.equal(new Set(poses.map(p => [p.fX, p.fY, p.bX, p.bY, p.body, p.head].join(','))).size, 12);
    assert.ok(A.height(3) < A.height(7) * .85, 'the baby is visibly shorter than Patron');
    assert.ok(A.profile(3).arm < A.profile(0).arm * .8 && A.profile(3).thigh < A.profile(0).thigh * .75);
    for (const i of [1, 4, 9]) assert.ok(bones[i].bHand.y < bones[i].bUpper.y - 4, 'thinking, crying and headphone hands reach the face');
    assert.ok(bones[7].fHand.y > bones[7].fUpper.y + 15, 'Patron carries his case below his shoulder');
    for (const i of [3, 9, 10]) assert.ok(bones[i].weapon.x > bones[i].head.x + 16 && poses[i].weaponLayer === 1, 'large weapons remain beside the body');
    for (let i = 0; i < 12; i++) {
        const p = poses[i], r = A.profile(i), b = bones[i];
        for (const side of ['f', 'b']) {
            const tx = b.torso.x + Math.cos(b.torso.a) * p[side + 'X'] - Math.sin(b.torso.a) * p[side + 'Y'];
            const ty = b.torso.y + Math.sin(b.torso.a) * p[side + 'X'] + Math.cos(b.torso.a) * p[side + 'Y'];
            assert.ok(Math.hypot(b[side + 'Hand'].x - tx, b[side + 'Hand'].y - ty) < .01, r.stance + ': reachable hand target');
        }
    }
});
test('the two-bone solver reaches targets without stretching and bounds unreachable targets', () => {
    const reach = A.ik(0, 0, 13, 14, 17, 16); near(reach.end.x, 13, 'target x'); near(reach.end.y, 14, 'target y');
    const far = A.ik(0, 0, 1000, 1000, 17, 16); assert.ok(Math.hypot(far.end.x, far.end.y) < 33); assert.ok(far.error > 1000);
    assert.ok(Number.isFinite(A.ik(0, 0, 0, 0, 17, 16).a));
});
test('stable run poses agree at 30, 60 and 144 fps and for a late observer', () => {
    const sample = fps => { const t = A.create(); for (let i = 0; i <= fps; i++) A.update(t, fighter({ vx: 5, travel: 300 * i / fps }), 60 * i / fps); return t; };
    const states = [30, 60, 144].map(sample), late = A.create(); A.update(late, fighter({ vx: 5, travel: 300 }), 60);
    for (const s of [...states, late]) for (const k of Object.keys(s.pose)) near(s.pose[k], states[0].pose[k], k);
});
test('pose blending takes the short rotational path and preserves continuity when stopping', () => {
    const mixed = A.blend({ fHand: 3 }, { fHand: -3 }, 0.5); near(mixed.fHand, Math.PI, 'angle wrap');
    const t = A.create(); A.update(t, fighter({ vx: 5, travel: 100 }), 20); const before = { ...t.pose };
    A.update(t, fighter({ travel: 100 }), 21); assert.deepEqual({ ...t.pose }, before);
    A.update(t, fighter({ travel: 100 }), 30); assert.equal(t.action, 'idle');
});
test('pause freezes all bone transforms even when the caller advances time', () => {
    const t = A.create(); A.update(t, fighter({ vx: 5, travel: 50 }), 10); const before = JSON.stringify(t);
    for (let tick = 11; tick < 100; tick++) A.update(t, fighter({ vx: 5, travel: tick * 5 }), tick, { paused: true });
    assert.equal(JSON.stringify(t), before);
});
test('contact phase matches every actual damage window and respects upward/downward aiming', () => {
    for (let character = 0; character < 12; character++) for (const kind of ['light', 'heavy', 'special']) {
        const spec = D.attackFor(character, kind);
        for (let age = 0; age < spec.duration; age++) {
            const sample = A.sample(fighter({ character, attack: { kind, dir: 'side', age } }), age);
            assert.equal(!!sample.contact, age >= spec.startup && age <= spec.startup + spec.active);
        }
    }
    for (const dir of ['up', 'down']) {
        const pose = A.sample(fighter({ attack: { kind: 'heavy', dir, age: 13 } }), 13).pose, b = A.solve(pose);
        assert.ok(dir === 'up' ? b.fHand.y < b.fUpper.y : b.fHand.y > b.fUpper.y);
    }
});
test('reduced motion keeps breathing still while retaining essential running', () => {
    const a = A.sample(fighter(), 0, true), b = A.sample(fighter(), 60, true); assert.deepEqual({ ...a.pose }, { ...b.pose });
    assert.equal(A.sample(fighter({ vx: 5, travel: 100 }), 60, true).action, 'run');
});
console.log('Brawlz cutout animation: ' + n + ' kinematics and timing checks passed.');
