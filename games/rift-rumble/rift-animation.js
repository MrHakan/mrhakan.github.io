// Continuous cutout animation: rigid bone hierarchy, two-bone leg IK,
// distance-driven foot plants and simulation-clock pose transitions.
(function (root) {
    'use strict';
    const D = root.RIFT, PI = Math.PI, TAU = PI * 2, SCALE = 0.88, STRIDE = 112, STANCE = 0.42;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), mix = (a, b, t) => a + (b - a) * t;
    const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    const HOLD = [0.8, -1.15, -0.9, -2, 0.1, -0.25, -1.2, 1.5, 0, -2.1, -2, -0.9];
    const UNARMED = new Set([2, 11]);
    function rest(character = 0) {
        return { hipX: 0, hipY: -34, body: 0.04, head: 0, fUpper: 1.15, fElbow: -2.15, bUpper: 2.05, bElbow: -2.05,
            fHand: UNARMED.has(character) ? -1 : HOLD[character], bHand: 0,
            fFootX: 11, fFootY: -6, fFootA: 0, bFootX: -11, bFootY: -6, bFootA: 0,
            weapon: 0, weaponLayer: [3, 9, 10].includes(character) ? 0 : 1 };
    }
    const ANGLES = new Set(['body', 'head', 'fUpper', 'fElbow', 'bUpper', 'bElbow', 'fHand', 'bHand', 'fFootA', 'bFootA', 'weapon']);
    function blend(a, b, t) {
        const o = {};
        for (const k of Object.keys(b)) {
            const from = a[k] ?? b[k], delta = b[k] - from;
            o[k] = ANGLES.has(k) ? from + Math.atan2(Math.sin(delta), Math.cos(delta)) * t : mix(from, b[k], t);
        }
        return o;
    }
    function foot(phase) {
        const u = ((phase % 1) + 1) % 1, span = STRIDE * STANCE / (2 * 1.5 * SCALE);
        if (u < STANCE) return { x: span * (1 - 2 * u / STANCE), y: -6, a: 0, planted: true };
        const t = (u - STANCE) / (1 - STANCE);
        return { x: -span * Math.cos(t * PI), y: -6 - 18 * Math.sin(t * PI), a: -0.35 * Math.sin(t * PI), planted: false };
    }
    function airborne(pose, vy) {
        const rise = smooth((-vy + 2) / 12);
        pose.fFootX = mix(12, 8, rise); pose.fFootY = mix(-9, -22, rise); pose.fFootA = -0.12;
        pose.bFootX = mix(-12, -13, rise); pose.bFootY = mix(-9, -16, rise); pose.bFootA = 0.2;
        pose.hipY = -32; pose.body = mix(-0.04, 0.14, rise);
        return pose;
    }
    function attackSpec(a, character) { return a.kind === 'special' && D.FIGHTERS[character].specialMelee || D.ATTACKS[a.kind]; }
    function attackPose(p, time) {
        const base = rest(p.character), a = p.attack, s = attackSpec(a, p.character), heavy = a.kind === 'heavy';
        if (!p.grounded) airborne(base, p.vy);
        const wind = { ...base, hipX: -3, hipY: base.hipY - 1, body: heavy ? -0.3 : -0.18, head: 0.06,
            fUpper: 3.5, fElbow: -1.65, fHand: -2.1, bUpper: 1.1, bElbow: -1.7, weaponLayer: 0 };
        const aim = a.dir === 'up' ? -1.42 : a.dir === 'down' ? 1.35 : -0.04;
        const impact = { ...base, hipX: heavy ? 4 : 2.5, body: heavy ? 0.3 : 0.2, head: -0.05,
            fUpper: aim - (heavy ? 0.3 : 0.2), fElbow: 0.12, fHand: aim, bUpper: 2.4, bElbow: -1.3,
            fFootX: p.grounded ? 17 : base.fFootX, bFootX: p.grounded ? -17 : base.bFootX, weaponLayer: 1 };
        const follow = { ...impact, body: impact.body + 0.08, fUpper: impact.fUpper + 0.16, fHand: aim + (heavy ? 0.3 : 0.08) };
        let pose, phase;
        if (a.age < s.startup) {
            const u = a.age / s.startup;
            pose = u < 0.72 ? blend(base, wind, smooth(u / 0.72)) : blend(wind, impact, Math.pow((u - 0.72) / 0.28, 2));
            phase = 'windup';
        } else if (a.age <= s.startup + s.active) {
            pose = blend(impact, follow, smooth((a.age - s.startup) / (s.active + 1))); phase = 'contact';
        } else {
            pose = blend(follow, base, smooth((a.age - s.startup - s.active - 1) / Math.max(1, s.duration - s.startup - s.active - 2))); phase = 'recovery';
        }
        return { pose, action: 'attack', phase, contact: phase === 'contact' };
    }
    function sample(p, clock, reduced = false) {
        const time = clock / 60, pose = rest(p.character), cycle = (Math.max(0, p.travel || 0) / STRIDE) % 1;
        if (p.stun > 0) {
            pose.body = -0.3; pose.hipX = -3; pose.fUpper = -0.9; pose.fElbow = -1; pose.fHand = -1.3;
            pose.bUpper = 2.5; pose.bElbow = -1.7; pose.head = 0.15;
            if (!p.grounded) airborne(pose, p.vy);
            return { pose, action: 'hurt', phase: 'hurt' };
        }
        if (p.dodge > 0) {
            const u = smooth((12 - p.dodge) / 12), crouch = Math.sin(u * PI);
            pose.hipY += crouch * 7; pose.body = 0.25 * crouch; pose.fUpper = -0.2; pose.fElbow = -1.8;
            pose.fFootX = 16; pose.bFootX = -16;
            return { pose, action: 'dodge', phase: u };
        }
        if (p.attack) return attackPose(p, time);
        if (!p.grounded) {
            airborne(pose, p.vy); pose.fUpper = -0.2; pose.fElbow = -1.1;
            pose.bUpper = 2.8; pose.bElbow = -1.2; pose.head = -0.05;
            return { pose, action: 'air', phase: p.vy < 0 ? 'rise' : 'fall' };
        }
        if (Math.abs(p.vx || 0) > 0.3) {
            const f = foot(cycle), b = foot(cycle + 0.5), swing = Math.cos(cycle * TAU);
            pose.hipY = -30 + 0.9 * Math.cos((cycle - 0.1) * TAU * 2); pose.hipX = 1.5; pose.body = 0.15;
            pose.fFootX = f.x; pose.fFootY = f.y; pose.fFootA = f.a; pose.bFootX = b.x; pose.bFootY = b.y; pose.bFootA = b.a;
            const weight = D.FIGHTERS[p.character]?.weight || 1, amplitude = 0.85 / Math.sqrt(weight);
            pose.fUpper = PI / 2 + swing * amplitude; pose.bUpper = PI / 2 - swing * amplitude;
            pose.fElbow = -1.1 - 0.2 * Math.sin(cycle * TAU); pose.bElbow = -1.1 + 0.2 * Math.sin(cycle * TAU);
            if (p.character === 7) { pose.fUpper = 1.2 + swing * 0.35; pose.fElbow = -1.8; }
            if (UNARMED.has(p.character)) pose.fHand = pose.body + pose.fUpper + pose.fElbow;
            pose.bHand = pose.body + pose.bUpper + pose.bElbow;
            return { pose, action: 'run', phase: cycle, feet: { front: f.planted, back: b.planted } };
        }
        if (!reduced) { pose.hipY -= Math.sin(time * 2.4) * 0.45; pose.head = Math.sin(time * 1.2) * 0.015; }
        return { pose, action: 'idle', phase: time };
    }
    function ik(x, y, tx, ty, upper, lower, bend = 1) {
        const dx = tx - x, dy = ty - y, distance = Math.hypot(dx, dy);
        const d = clamp(distance, Math.abs(upper - lower) + 0.0001, upper + lower - 0.0001);
        const direction = Math.atan2(dy, dx), a = direction - bend * Math.acos(clamp((upper * upper + d * d - lower * lower) / (2 * upper * d), -1, 1));
        const knee = { x: x + Math.cos(a) * upper, y: y + Math.sin(a) * upper };
        const end = { x: x + Math.cos(direction) * d, y: y + Math.sin(direction) * d };
        return { a, b: Math.atan2(end.y - knee.y, end.x - knee.x), knee, end, error: Math.max(0, distance - d) };
    }
    function solve(p) {
        const nodes = {};
        function bone(name, parent, x, y, angle, length = 0) {
            const n = parent && nodes[parent], c = Math.cos(n?.a || 0), s = Math.sin(n?.a || 0);
            return nodes[name] = { name, parent, x: (n?.x || 0) + x * c - y * s, y: (n?.y || 0) + x * s + y * c, a: (n?.a || 0) + angle, length };
        }
        bone('root', null, 0, 0, 0);
        const pelvis = bone('pelvis', 'root', p.hipX, p.hipY, -p.body * 0.15);
        const torso = bone('torso', 'pelvis', 0, -2, p.body - pelvis.a);
        bone('head', 'torso', 0, -21, p.body * 0.2 + p.head - torso.a);
        for (const side of ['f', 'b']) {
            const upper = bone(side + 'Upper', 'torso', side === 'f' ? 9 : -8, -18, p[side + 'Upper'], 11);
            const lower = bone(side + 'Lower', side + 'Upper', 11, 0, p[side + 'Elbow'], 12);
            bone(side + 'Hand', side + 'Lower', 12, 0, p[side + 'Hand'] - lower.a, 6);
            const hx = (side === 'f' ? 5 : -5) * Math.cos(pelvis.a) - 2 * Math.sin(pelvis.a) + pelvis.x;
            const hy = (side === 'f' ? 5 : -5) * Math.sin(pelvis.a) + 2 * Math.cos(pelvis.a) + pelvis.y;
            const leg = ik(hx, hy, p[side + 'FootX'], p[side + 'FootY'], 17, 16);
            bone(side + 'Thigh', 'pelvis', side === 'f' ? 5 : -5, 2, leg.a - pelvis.a, 17);
            const shin = bone(side + 'Shin', side + 'Thigh', 17, 0, leg.b - leg.a, 16);
            bone(side + 'Foot', side + 'Shin', 16, 0, p[side + 'FootA'] - shin.a);
        }
        bone('weapon', 'fHand', 6, 0, p.weapon);
        return nodes;
    }
    function create() { return { pose: null, bones: null, from: null, action: '', phase: '', changedAt: 0, clock: null, blendTime: 0.09 }; }
    function update(t, p, clock, options = {}) {
        if (options.paused && t.pose) return t;
        const next = sample(p, clock, options.reduced), time = clock / 60;
        if (next.action !== t.action) {
            t.from = t.pose && { ...t.pose }; t.changedAt = time;
            t.blendTime = next.action === 'attack' || next.action === 'hurt' ? 0.035 : 0.09;
            if (next.action === 'attack') t.blendTime = Math.min(t.blendTime, Math.max(0, (attackSpec(p.attack, p.character).startup - p.attack.age) / 120));
            if (!t.blendTime) t.from = null;
        }
        t.pose = t.from ? blend(t.from, next.pose, smooth((time - t.changedAt) / t.blendTime)) : next.pose;
        if (time - t.changedAt >= t.blendTime) t.from = null;
        t.action = next.action; t.phase = next.phase; t.contact = !!next.contact; t.feet = next.feet || null; t.clock = clock;
        t.bones = solve(t.pose);
        return t;
    }
    root.RIFT_ANIM = { PARTS: 16, SCALE, STRIDE, STANCE, rest, sample, blend, foot, ik, solve, create, update, attackSpec };
})(typeof window === 'undefined' ? globalThis : window);
