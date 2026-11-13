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
// ---- how the fighters look: checks for the kinds of oddities a review found ----
const bonesOf = (extra, clock = 0, reduced = true) => { const pose = A.sample(fighter(extra), clock, reduced).pose; return { pose, bones: A.solve(pose) }; };
// how far a knee sits off the straight line from hip to foot, as a share of the leg
function kneeBend(b, side, r) {
    const hip = b[side + 'Thigh'], knee = b[side + 'Shin'], foot = b[side + 'Foot'];
    const dx = foot.x - hip.x, dy = foot.y - hip.y;
    return Math.abs((knee.x - hip.x) * dy - (knee.y - hip.y) * dx) / Math.hypot(dx, dy) / (r.thigh + r.shin);
}
test('every fighter stands on straight enough legs, with both soles on the floor and the knees apart', () => {
    for (let character = 0; character < 12; character++) {
        const r = A.profile(character), { bones: b } = bonesOf({ character }), name = D.FIGHTERS[character].name;
        for (const side of ['f', 'b']) {
            near(b[side + 'Foot'].y, -r.footH * .6, name + ': ' + side + ' sole on the floor');
            near(b[side + 'Foot'].a, 0, name + ': ' + side + ' foot flat');
            // only the nervous one (Hothead) is allowed a real crouch
            assert.ok(kneeBend(b, side, r) < (character === 2 ? .2 : .135), name + ': ' + side + ' knee is not buckled: ' + kneeBend(b, side, r).toFixed(3));
        }
        assert.ok(b.fShin.x - b.bShin.x > 5.5, name + ': knees do not pinch together: ' + (b.fShin.x - b.bShin.x).toFixed(1));
        assert.ok(b.fFoot.x - b.bFoot.x >= 14, name + ': a stance wide enough to stand on');
        assert.ok(Math.abs((b.fFoot.x + b.bFoot.x) / 2 - b.pelvis.x) < 4.5, name + ': weight is over the feet, not falling over');
    }
});
test('standing still is still: breathing never slides a foot or shakes the body', () => {
    for (let character = 0; character < 12; character++) {
        const first = bonesOf({ character }, 0, false).bones; let hip = 0, head = 0, step = 0, previous = first;
        for (let clock = 1; clock <= 600; clock++) {
            const b = bonesOf({ character }, clock, false).bones;
            for (const side of ['f', 'b']) { near(b[side + 'Foot'].x, first[side + 'Foot'].x, 'planted foot'); near(b[side + 'Foot'].y, first[side + 'Foot'].y, 'planted foot'); }
            hip = Math.max(hip, Math.abs(b.pelvis.y - first.pelvis.y)); head = Math.max(head, Math.hypot(b.head.x - first.head.x, b.head.y - first.head.y));
            step = Math.max(step, Math.hypot(b.head.x - previous.head.x, b.head.y - previous.head.y)); previous = b;
        }
        assert.ok(hip <= 1 && head <= 1.6, D.FIGHTERS[character].name + ': breathing stays subtle (' + hip.toFixed(2) + ', ' + head.toFixed(2) + ')');
        assert.ok(step < .08, D.FIGHTERS[character].name + ': no jitter between two ticks (' + step.toFixed(3) + ')');
    }
});
test('jumping, dodging and being hit never throw the weapon arm across the face', () => {
    const cases = [['rise', { grounded: false, vy: -10 }], ['fall', { grounded: false, vy: 8 }], ['dodge', { dodge: 6 }], ['hurt', { stun: 10 }], ['hurt in the air', { stun: 10, grounded: false, vy: 3 }]];
    for (let character = 0; character < 12; character++) for (const [label, extra] of cases) {
        const r = A.profile(character), { bones: b } = bonesOf({ character, ...extra }), chin = b.head.y, name = D.FIGHTERS[character].name + ' / ' + label;
        // head.y is the neck joint: the face is everything above it
        assert.ok(b.fHand.y > chin - r.headH * .2, name + ': front hand stays below the face');
        assert.ok(b.fHand.x > b.torso.x, name + ': front hand stays in front of the body');
    }
});
test('a prop tucked against the chest is never left hidden behind the head', () => {
    const cases = [{}, { vx: 5, travel: 30 }, { grounded: false, vy: -10 }, { grounded: false, vy: 8 }, { dodge: 6 }, { stun: 10 }, { attack: { kind: 'light', dir: 'side', age: 5 } }, { attack: { kind: 'heavy', dir: 'up', age: 14 } }];
    for (let character = 0; character < 12; character++) for (const extra of cases) {
        const { pose, bones: b } = bonesOf({ character, ...extra });
        // under 0.75 the prop is painted before the head, so it has to sit below the neck to be seen
        if (pose.weaponLayer < .75) assert.ok(b.weapon.y > b.head.y + 2, D.FIGHTERS[character].name + ': the prop is visible in ' + JSON.stringify(extra));
    }
});
test('the prop stays in the gripping hand and a mirrored fighter is an exact mirror', () => {
    for (let character = 0; character < 12; character++) for (const extra of [{}, { vx: 5, travel: 40 }, { grounded: false, vy: -6 }, { stun: 8 }, { dodge: 4 }]) {
        const r = A.profile(character), { bones: b } = bonesOf({ character, ...extra });
        near(Math.hypot(b.weapon.x - b.fHand.x, b.weapon.y - b.fHand.y), r.handH * .45, D.FIGHTERS[character].name + ': prop at the palm');
    }
    // facing is one horizontal flip of the whole figure in rift-art.js; the pose itself has no notion of side
    assert.equal(Object.keys(A.rest(0)).some(k => /facing|mirror|flip/i.test(k)), false);
});
console.log('Brawlz cutout animation: ' + n + ' kinematics and timing checks passed.');
