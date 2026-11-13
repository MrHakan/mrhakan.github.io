// Individual rigid cutout skeletons, hand IK and distance-driven foot plants.
(function (root) {
    'use strict';
    const D = root.RIFT, PI = Math.PI, TAU = PI * 2, SCALE = .88, STRIDE = 112, STANCE = .42;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), mix = (a, b, t) => a + (b - a) * t;
    const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    const UNARMED = new Set([2, 11]);
    // Targets are in torso space. Wrists rotate independently of held props.
    const profiles = [
        { stance: 'easy confidence', hip: -2, lean: -.07, tilt: -.06, feet: [9, -10], hands: [19, -7, -14, -3], wrists: [.25, .1], prop: .5 },
        { stance: 'thinking', bodyH: 26, headH: 31, thigh: 17, bodyW: 25, lean: -.05, tilt: .09, feet: [8, -10], hands: [20, -10, 2, -23], wrists: [-.5, -1.1], prop: -1.25, backLayer: 2, stride: 108 },
        { stance: 'nervous guard', slack: 3.4, lean: .11, feet: [13, -13], hands: [19, -25, -4, -23], wrists: [-1.2, -1.1], handH: 10, stride: 104, breath: 3.8 },
        { stance: 'tiny troublemaker', arm: 8, forearm: 8, thigh: 11, shin: 10, shoulder: 6, hips: 3.5, bodyH: 19, bodyW: 25, pelvisH: 10, headH: 35, footH: 7, handH: 7, slack: 1, lean: -.09, tilt: -.11, feet: [8, -8], hands: [18, -3, -5, -9], wrists: [.2, -.5], prop: .45, stride: 76, breath: 3.4 },
        { stance: 'wiping tears', lean: .16, tilt: -.09, feet: [8, -10], hands: [15, -13, -8, -28], wrists: [-.2, -1.4], prop: 0, backLayer: 2, stride: 100, slack: 1.4 },
        { stance: 'scheming', headH: 30, bodyH: 24, hip: -2, lean: .13, tilt: -.08, feet: [10, -12], hands: [20, -5, -14, -3], wrists: [.3, .1], prop: .25 },
        { stance: 'confused shrug', lean: -.05, tilt: .16, feet: [10, -10], hands: [21, -10, -16, -15], wrists: [-.5, -1.5], prop: -1.2, backLayer: 1, stride: 100 },
        { stance: 'all business', arm: 11, forearm: 12, thigh: 17, shin: 17, bodyH: 26, bodyW: 32, shoulder: 9, lean: -.025, tilt: -.04, feet: [8, -8], hands: [18, 2, -15, -3], wrists: [1.45, .1], prop: 0, stride: 104, slack: .6, breath: 1.8 },
        { stance: 'hugging a pillow', bodyH: 23, bodyW: 24, shoulder: 7, lean: .12, tilt: -.16, feet: [7, -10], hands: [13, -7, -10, -8], wrists: [2.6, -.3], prop: 0, backLayer: 1, stride: 96, slack: 1, breath: 1.7 },
        { stance: 'feeling the beat', lean: -.04, tilt: -.08, feet: [12, -10], hands: [22, -7, -12, -27], wrists: [-.5, -1.5], prop: -1.05, backLayer: 2, stride: 116, slack: 1.6, breath: 4 },
        { stance: 'barely contained anger', lean: .05, tilt: .03, feet: [12, -12], hands: [20, -3, -5, -8], wrists: [.4, .2], prop: .45, backLayer: 1, stride: 108, breath: 3 },
        { stance: 'folded arms', bodyH: 28, bodyW: 34, pelvisH: 14, thigh: 15, shin: 14, shoulder: 10, hips: 6, hip: -1, lean: -.045, tilt: -.07, feet: [14, -14], hands: [6, -9, -5, -9], wrists: [2.8, -.2], backLayer: 1, handH: 10, stride: 100, slack: 1.4, breath: 1.9 }
    ].map(p => Object.freeze({ arm: 10.5, forearm: 11, thigh: 16, shin: 15, shoulder: 8, hips: 4.5, bodyH: 25, bodyW: 29, pelvisH: 12, headH: 32, footH: 9, handH: 8.5, slack: .8, hip: 0, lean: 0, tilt: 0, backLayer: 1, stride: STRIDE, breath: 2.4, prop: 0, ...p }));
    const profile = character => profiles[character] || profiles[0];
    function rest(character = 0) {
        const r = profile(character), drop = r.footH * .6;
        return { character, hipX: r.hip, hipY: -drop - 2 - r.thigh - r.shin + r.slack, body: r.lean, head: r.tilt,
            fUpper: 1.15, fElbow: -2.15, bUpper: 2.05, bElbow: -2.05,
            armIK: 1, fX: r.hands[0], fY: r.hands[1], bX: r.hands[2], bY: r.hands[3],
            fHand: r.wrists[0], bHand: r.wrists[1], backLayer: r.backLayer,
            fFootX: r.feet[0], fFootY: -drop, fFootA: 0, bFootX: r.feet[1], bFootY: -drop, bFootA: 0,
            weapon: r.prop - r.wrists[0], weaponLayer: character === 8 ? .5 : 1 };
    }
    const ANGLES = new Set(['body', 'head', 'fUpper', 'fElbow', 'bUpper', 'bElbow', 'fHand', 'bHand', 'fFootA', 'bFootA', 'weapon']);
    const angleMix = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
    function blend(a, b, t) {
        const o = {};
        for (const k of Object.keys(b)) {
            const from = a[k] ?? b[k];
            o[k] = k === 'character' ? b[k] : ANGLES.has(k) ? angleMix(from, b[k], t) : mix(from, b[k], t);
        }
        return o;
    }
    function foot(phase, character = 0) {
        const r = profile(character), drop = r.footH * .6, u = ((phase % 1) + 1) % 1, span = r.stride * STANCE / (2 * 1.5 * SCALE);
        if (u < STANCE) return { x: span * (1 - 2 * u / STANCE), y: -drop, a: 0, planted: true };
        const t = (u - STANCE) / (1 - STANCE), lift = Math.min(16, (r.thigh + r.shin) * .48);
        return { x: -span * Math.cos(t * PI), y: -drop - lift * Math.sin(t * PI), a: -.3 * Math.sin(t * PI), planted: false };
    }
    // The pelvis yields to keep both feet reachable without stretching legs.
    function ground(pose) {
        const r = profile(pose.character), a = -pose.body * .15;
        for (const side of ['f', 'b']) {
            const x = side === 'f' ? r.hips : -r.hips, ox = x * Math.cos(a) - 2 * Math.sin(a), oy = x * Math.sin(a) + 2 * Math.cos(a);
            const dx = pose[side + 'FootX'] - pose.hipX - ox, length = r.thigh + r.shin - .2;
            pose.hipY = Math.max(pose.hipY, pose[side + 'FootY'] - Math.sqrt(Math.max(1, length * length - dx * dx)) - oy);
        }
        return pose;
    }
    function airborne(pose, vy) {
        const r = profile(pose.character), rise = smooth((-vy + 2) / 12), size = (r.thigh + r.shin) / 31;
        pose.fFootX = mix(12, 8, rise) * size; pose.fFootY = mix(-9, -22, rise) * size; pose.fFootA = -.12;
        pose.bFootX = mix(-12, -13, rise) * size; pose.bFootY = mix(-9, -16, rise) * size; pose.bFootA = .2;
        pose.hipY = -32 * size; pose.body = mix(-.04, .14, rise); pose.armIK = 0; pose.backLayer = 0; pose.weaponLayer = 1;
        return pose;
    }
    const attackStyles = {
        thrust: { wind: { fUpper: 1.2, fElbow: -2, body: -.13 }, impact: { fUpper: -.23, fElbow: .05, fHand: -.08, body: .22 } },
        jab: { wind: { fUpper: 1.25, fElbow: -2.4, bUpper: .65, bElbow: -1.9 }, impact: { fUpper: -.26, fElbow: .16, fHand: -.15, bUpper: .68, bElbow: -1.95 } },
        hook: { wind: { fUpper: 2.85, fElbow: -1.8, body: -.42 }, impact: { fUpper: -.47, fElbow: .63, fHand: .39, body: .4 } },
        sweep: { wind: { fUpper: 1.95, fElbow: -1.25, body: -.3 }, impact: { fUpper: .26, fElbow: .25, fHand: .37, body: .36 } },
        uppercut: { wind: { fUpper: 1.8, fElbow: -1.35, body: -.15 }, impact: { fUpper: -.95, fElbow: -.5, fHand: -1.12, body: .15, head: -.16 } },
        overhead: { wind: { fUpper: -1.9, fElbow: -.6, fHand: -1.85, body: -.24 }, impact: { fUpper: -.32, fElbow: .18, fHand: .58, body: .39 } },
        shove: { wind: { fUpper: 1.45, fElbow: -2.15, bUpper: 1.3, bElbow: -2.1 }, impact: { fUpper: -.28, fElbow: .26, bUpper: -.31, bElbow: .28, fHand: .06, body: .31 } },
        rush: { wind: { fUpper: 2.1, fElbow: -1.55, body: .34 }, impact: { fUpper: -.58, fElbow: .25, fHand: .12, body: .46 } },
        pounce: { wind: { fUpper: -1.4, fElbow: -.95, fHand: -1.26, bUpper: 2.55, bElbow: -1.1, body: .31 }, impact: { fUpper: .6, fElbow: .18, fHand: .9, bUpper: 2.7, bElbow: -.8, body: .42, head: .12 } }
    };
    function attackSpec(a, character) { return D.attackFor(character, a.kind, a.dir); }
    function attackPose(p) {
        const base = rest(p.character), a = p.attack, s = attackSpec(a, p.character), heavy = a.kind === 'heavy', r = profile(p.character);
        if (!p.grounded) airborne(base, p.vy);
        const wind = { ...base, armIK: 0, backLayer: 1, hipX: -3, hipY: base.hipY + 2, body: heavy ? -.3 : -.18, head: .06,
            fUpper: 2.3, fElbow: -2.6, fHand: .4, bUpper: 1.1, bElbow: -1.7, weapon: 0, weaponLayer: 1 };
        const aim = a.dir === 'up' ? -1.42 : a.dir === 'down' ? 1.35 : -.04, spread = Math.min(17, (r.thigh + r.shin) * .5);
        const impact = { ...base, armIK: 0, backLayer: 1, hipX: heavy ? 4 : 2.5, body: heavy ? .3 : .2, head: -.05,
            fUpper: aim - (heavy ? .3 : .2), fElbow: .12, fHand: aim, bUpper: 2.4, bElbow: -1.3,
            fFootX: p.grounded ? spread : base.fFootX, bFootX: p.grounded ? -spread : base.bFootX, weapon: 0, weaponLayer: 1 };
        const style = a.dir === 'side' && attackStyles[s.pose];
        if (style) {
            Object.assign(wind, style.wind);
            Object.assign(impact, style.impact);
        }
        if (s.pose === 'pounce') {
            wind.hipY += p.grounded ? 5 : 0;
            wind.fFootY -= p.grounded ? 0 : 6;
            impact.fFootX = p.grounded ? spread : 15;
            impact.bFootX = p.grounded ? -spread : -20;
        }
        const follow = { ...impact, body: impact.body + .08, fUpper: impact.fUpper + .16, fHand: impact.fHand + (heavy ? .3 : .08) };
        let pose, phase;
        if (a.age < s.startup) {
            const u = a.age / s.startup;
            pose = u < .72 ? blend(base, wind, smooth(u / .72)) : blend(wind, impact, Math.pow((u - .72) / .28, 2)); phase = 'windup';
        } else if (a.age <= s.startup + s.active) {
            pose = blend(impact, follow, smooth((a.age - s.startup) / (s.active + 1))); phase = 'contact';
        } else {
            pose = blend(follow, base, smooth((a.age - s.startup - s.active - 1) / Math.max(1, s.duration - s.startup - s.active - 2))); phase = 'recovery';
        }
        if (p.grounded) ground(pose);
        return { pose, action: 'attack', phase, contact: phase === 'contact' };
    }
    function sample(p, clock, reduced = false) {
        const time = clock / 60, r = profile(p.character), pose = rest(p.character), cycle = (Math.max(0, p.travel || 0) / r.stride) % 1;
        if (p.stun > 0) {
            pose.armIK = 0; pose.backLayer = 1; pose.weaponLayer = 1; pose.body = -.3; pose.hipX = -3; pose.fUpper = .85; pose.fElbow = -.65; pose.fHand = -.1; pose.weapon = r.prop - .2 - pose.fHand;
            pose.bUpper = 2.5; pose.bElbow = -1.7; pose.head = .15;
            if (!p.grounded) airborne(pose, p.vy); else ground(pose);
            return { pose, action: 'hurt', phase: 'hurt' };
        }
        if (p.dodge > 0) {
            const u = smooth((12 - p.dodge) / 12), crouch = Math.sin(u * PI), spread = Math.min(16, (r.thigh + r.shin) * .48);
            pose.armIK = 0; pose.backLayer = 0; pose.weaponLayer = 1; pose.hipY += crouch * 7; pose.body = .25 * crouch; pose.fUpper = .5; pose.fElbow = -1.55;
            pose.fFootX = spread; pose.bFootX = -spread; ground(pose);
            return { pose, action: 'dodge', phase: u };
        }
        if (p.attack) return attackPose(p);
        if (!p.grounded) {
            airborne(pose, p.vy); pose.fUpper = .55; pose.fElbow = -1.25; pose.bUpper = 2.8; pose.bElbow = -1.2; pose.head = -.05;
            return { pose, action: 'air', phase: p.vy < 0 ? 'rise' : 'fall' };
        }
        if (Math.abs(p.vx || 0) > .3) {
            const f = foot(cycle, p.character), b = foot(cycle + .5, p.character), swing = Math.cos(cycle * TAU);
            pose.armIK = 0; pose.backLayer = 0; pose.hipY += 4 + .7 * Math.cos((cycle - .1) * TAU * 2); pose.hipX = 1.5; pose.body = .12;
            pose.fFootX = f.x; pose.fFootY = f.y; pose.fFootA = f.a; pose.bFootX = b.x; pose.bFootY = b.y; pose.bFootA = b.a;
            const weight = D.FIGHTERS[p.character]?.weight || 1, amplitude = .8 / Math.sqrt(weight);
            pose.fUpper = PI / 2 + swing * amplitude; pose.bUpper = PI / 2 - swing * amplitude;
            pose.fElbow = -1.1 - .2 * Math.sin(cycle * TAU); pose.bElbow = -1.1 + .2 * Math.sin(cycle * TAU);
            if (!UNARMED.has(p.character)) { pose.fUpper = 1.3 + swing * .28; pose.fElbow = -1.15; }
            pose.fHand = pose.body + pose.fUpper + pose.fElbow; pose.bHand = pose.body + pose.bUpper + pose.bElbow;
            pose.weapon = r.prop - pose.fHand; pose.weaponLayer = p.character === 8 ? .5 : 1;
            ground(pose);
            return { pose, action: 'run', phase: cycle, feet: { front: f.planted, back: b.planted } };
        }
        if (!reduced) {
            const breath = Math.sin(time * r.breath);
            pose.hipY -= breath * (p.character === 9 ? .8 : .3); pose.head += Math.sin(time * r.breath * .5) * .012;
            if (p.character === 2) { pose.fY -= breath * .6; pose.bY += breath * .5; }
            if (p.character === 3) pose.head += Math.sin(time * 1.7) * .025;
            if (p.character === 4) pose.bY += breath * .5;
            if (p.character === 9) pose.body += breath * .025;
        }
        ground(pose);
        return { pose, action: 'idle', phase: time };
    }
    function ik(x, y, tx, ty, upper, lower, bend = 1) {
        const dx = tx - x, dy = ty - y, distance = Math.hypot(dx, dy), d = clamp(distance, Math.abs(upper - lower) + .0001, upper + lower - .0001);
        const direction = Math.atan2(dy, dx), a = direction - bend * Math.acos(clamp((upper * upper + d * d - lower * lower) / (2 * upper * d), -1, 1));
        const knee = { x: x + Math.cos(a) * upper, y: y + Math.sin(a) * upper }, end = { x: x + Math.cos(direction) * d, y: y + Math.sin(direction) * d };
        return { a, b: Math.atan2(end.y - knee.y, end.x - knee.x), knee, end, error: Math.max(0, distance - d) };
    }
    function solve(p) {
        const nodes = {}, r = profile(p.character);
        function bone(name, parent, x, y, angle, length = 0) {
            const n = parent && nodes[parent], c = Math.cos(n?.a || 0), s = Math.sin(n?.a || 0);
            return nodes[name] = { name, parent, x: (n?.x || 0) + x * c - y * s, y: (n?.y || 0) + x * s + y * c, a: (n?.a || 0) + angle, length };
        }
        bone('root', null, 0, 0, 0);
        const pelvis = bone('pelvis', 'root', p.hipX, p.hipY, -p.body * .15), torso = bone('torso', 'pelvis', 0, -2, p.body - pelvis.a);
        bone('head', 'torso', 0, -r.bodyH * .78, p.body * .2 + p.head - torso.a);
        for (const side of ['f', 'b']) {
            const sx = side === 'f' ? r.shoulder : -r.shoulder, sy = -r.bodyH * .68;
            let upperAngle = torso.a + p[side + 'Upper'], lowerAngle = upperAngle + p[side + 'Elbow'];
            if (p.armIK > 0) {
                const tx = torso.x + Math.cos(torso.a) * p[side + 'X'] - Math.sin(torso.a) * p[side + 'Y'];
                const ty = torso.y + Math.sin(torso.a) * p[side + 'X'] + Math.cos(torso.a) * p[side + 'Y'];
                const x = torso.x + Math.cos(torso.a) * sx - Math.sin(torso.a) * sy, y = torso.y + Math.sin(torso.a) * sx + Math.cos(torso.a) * sy;
                const arm = ik(x, y, tx, ty, r.arm, r.forearm, -1);
                upperAngle = angleMix(upperAngle, arm.a, p.armIK); lowerAngle = angleMix(lowerAngle, arm.b, p.armIK);
            }
            bone(side + 'Upper', 'torso', sx, sy, upperAngle - torso.a, r.arm);
            const lower = bone(side + 'Lower', side + 'Upper', r.arm, 0, lowerAngle - upperAngle, r.forearm);
            bone(side + 'Hand', side + 'Lower', r.forearm, 0, p[side + 'Hand'] - lower.a, r.handH * .45);
            const hx = (side === 'f' ? r.hips : -r.hips) * Math.cos(pelvis.a) - 2 * Math.sin(pelvis.a) + pelvis.x;
            const hy = (side === 'f' ? r.hips : -r.hips) * Math.sin(pelvis.a) + 2 * Math.cos(pelvis.a) + pelvis.y;
            const leg = ik(hx, hy, p[side + 'FootX'], p[side + 'FootY'], r.thigh, r.shin);
            bone(side + 'Thigh', 'pelvis', side === 'f' ? r.hips : -r.hips, 2, leg.a - pelvis.a, r.thigh);
            const shin = bone(side + 'Shin', side + 'Thigh', r.thigh, 0, leg.b - leg.a, r.shin);
            bone(side + 'Foot', side + 'Shin', r.shin, 0, p[side + 'FootA'] - shin.a);
        }
        bone('weapon', 'fHand', r.handH * .45, 0, p.weapon);
        return nodes;
    }
    const heights = [];
    function height(character) {
        if (heights[character] !== undefined) return heights[character];
        const r = profile(character), b = solve(ground(rest(character)));
        return heights[character] = (-b.head.y + r.headH * .96) * SCALE;
    }
    function create() { return { pose: null, bones: null, from: null, action: '', phase: '', changedAt: 0, clock: null, blendTime: .09 }; }
    function update(t, p, clock, options = {}) {
        if (options.paused && t.pose) return t;
        const next = sample(p, clock, options.reduced), time = clock / 60;
        if (next.action !== t.action) {
            t.from = t.pose && { ...t.pose }; t.changedAt = time;
            t.blendTime = next.action === 'attack' || next.action === 'hurt' ? .035 : .09;
            if (next.action === 'attack') t.blendTime = Math.min(t.blendTime, Math.max(0, (attackSpec(p.attack, p.character).startup - p.attack.age) / 120));
            if (!t.blendTime) t.from = null;
        }
        t.pose = t.from ? blend(t.from, next.pose, smooth((time - t.changedAt) / t.blendTime)) : next.pose;
        if (time - t.changedAt >= t.blendTime) t.from = null;
        t.action = next.action; t.phase = next.phase; t.contact = !!next.contact; t.feet = next.feet || null; t.clock = clock;
        t.bones = solve(t.pose);
        return t;
    }
    root.RIFT_ANIM = { PARTS: 16, SCALE, STRIDE, STANCE, profile, height, rest, sample, blend, foot, ik, solve, create, update, attackSpec };
})(typeof window === 'undefined' ? globalThis : window);
