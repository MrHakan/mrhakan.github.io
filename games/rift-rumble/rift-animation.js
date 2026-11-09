// One animation clock and one fixed skeleton per fighter. No wall-clock phases.
// Frames are baked from a single canonical texture, so a pose cannot change a face.
(function (root) {
    'use strict';
    const D = root.RIFT, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const STRIDE = 84;
    const RUN = [[8, 0], [4, 0], [0, 0], [-4, 0], [-8, -1], [-4, -3], [0, -5], [4, -3]];
    const ATTACK = [[0.08, -0.3], [0.32, -1.2], [0.56, -2.1], [-1.3, 3.4], [-1.02, 4], [-0.65, 2.5], [-0.25, 1], [0, 0]];
    function pose(frame) {
        const p = { frame, leftX: 0, leftY: 0, rightX: 0, rightY: 0, arm: 0, lean: 0, lift: 0, crouch: 0 };
        if (frame >= 1 && frame <= 4) p.lift = [0, -0.6, -0.9, -0.3][frame - 1];
        if (frame >= 5 && frame <= 12) {
            const k = frame - 5, l = RUN[k], r = RUN[(k + 4) % 8];
            p.leftX = l[0]; p.leftY = l[1]; p.rightX = r[0]; p.rightY = r[1];
            p.lift = -Math.abs(Math.sin(k * Math.PI / 4)) * 1.3;
            p.lean = 1.9; p.arm = Math.sin(k * Math.PI / 4) * 0.27;
        }
        if (frame >= 13 && frame <= 16) {
            const k = frame - 13;
            p.leftX = [-3, -5, -6, -2][k]; p.rightX = [3, 5, 6, 3][k];
            p.leftY = [-3, -8, -11, -3][k]; p.rightY = [-2, -6, -9, -2][k];
            p.arm = [-0.2, -0.35, -0.25, 0.08][k]; p.lean = [1, 2, 1, -1][k];
        }
        if (frame >= 17 && frame <= 40) {
            const group = Math.floor((frame - 17) / 8), k = (frame - 17) % 8, a = ATTACK[k];
            p.arm = a[0] * (group === 1 ? 1.12 : group === 2 ? 0.75 : 1);
            p.lean = a[1]; p.crouch = k < 3 ? k * 0.6 : 0;
            p.rightX = k >= 3 && k < 6 ? 3 : 0;
        }
        if (frame === 41 || frame === 42) { p.lean = frame === 41 ? -4 : -2; p.arm = 0.35; p.crouch = 1; }
        if (frame >= 43 && frame <= 46) { const k = frame - 43; p.crouch = [2, 5, 5, 2][k]; p.lean = [1, 3, -2, 0][k]; p.arm = 0.5; }
        if (frame >= 47 && frame <= 49) p.crouch = [3, 1.5, 0][frame - 47];
        return p;
    }
    function create() { return { frame: 0, action: 'idle', cycle: 0, time: 0, clock: null, x: null, grounded: true, landAt: -99 }; }
    function spec(a, character) { return a.kind === 'special' && D.FIGHTERS[character].specialMelee || D.ATTACKS[a.kind]; }
    function attackFrame(a, character) {
        const s = spec(a, character), age = clamp(a.age, 0, s.duration);
        let k;
        if (age < s.startup) k = Math.min(2, Math.floor(age / Math.max(1, s.startup) * 3));
        else if (age <= s.startup + s.active) k = 3 + Math.min(1, Math.floor((age - s.startup) / Math.max(1, s.active + 1) * 2));
        else k = 5 + Math.min(2, Math.floor((age - s.startup - s.active - 1) / Math.max(1, s.duration - s.startup - s.active - 1) * 3));
        return 17 + (a.kind === 'heavy' ? 8 : a.kind === 'special' ? 16 : 0) + k;
    }
    function update(t, p, clock, options = {}) {
        const dt = t.clock === null ? 0 : clamp((clock - t.clock) / 60, 0, 0.1);
        const dx = t.x === null ? 0 : Math.abs(p.x - t.x);
        t.clock = clock; t.x = p.x;
        if (options.paused) return t;
        t.time = Math.max(0, clock / 60);
        const grounded = !!p.grounded;
        if (!t.grounded && grounded) t.landAt = t.time;
        t.grounded = grounded;
        if (Number.isFinite(p.travel) && p.travel >= 0) t.cycle = (p.travel / STRIDE) % 1;
        else if (grounded && dx < 50 && dt > 0) t.cycle = (t.cycle + dx / STRIDE) % 1;
        if (p.stun > 0) { t.action = 'hurt'; t.frame = 41 + Math.floor(t.time * 12) % 2; }
        else if (p.dodge > 0) { t.action = 'dodge'; t.frame = 43 + Math.min(3, Math.floor((12 - p.dodge) / 3)); }
        else if (p.attack) { t.action = 'attack'; t.frame = attackFrame(p.attack, p.character); }
        else if (!grounded) { t.action = 'air'; t.frame = p.vy < -7 ? 13 : p.vy < -1.5 ? 14 : p.vy <= 3 ? 15 : 16; }
        else if (Math.abs(p.vx) > 0.3) { t.action = 'run'; t.frame = 5 + Math.floor(t.cycle * 8) % 8; }
        else if (t.time - t.landAt < 0.12) { t.action = 'land'; t.frame = 47 + Math.min(2, Math.floor((t.time - t.landAt) / 0.04)); }
        else { t.action = 'idle'; t.frame = options.reduced ? 0 : 1 + Math.floor(t.time * 3) % 4; }
        return t;
    }
    function isHead(x, y, rig) { return y < rig.neck && x > rig.headLeft - 2 && x < rig.headRight + 2 || y < (rig.forehead || -65) && Math.abs(x) < 27; }
    function isWeapon(x, y, rig) {
        if (isHead(x, y, rig)) return false;
        const outside = rig.armSide * x;
        if (rig.character === 7) return outside > 10 && y > -31 && y < -2;
        if (rig.character === 8) return outside > 10 && y > -49 && y < -14;
        if (rig.character === 9) return outside > 12 && y < -25;
        if (rig.character === 10) return outside > 13 && y < -16;
        if ([2, 3, 4, 5, 6, 11].includes(rig.character)) return outside > 14 && y < -16;
        return outside > 18 && y > -81 && y < 1 || outside > 13 && y > -55 && y < -16;
    }
    function weaponLift(p, rig) {
        if (!rig.weaponBox) return 0;
        const side = rig.armSide, ax = side * 10, ay = -31, angle = p.arm * (side === -1 ? 1.5 : 1), cos = Math.cos(angle), sin = Math.sin(angle), b = rig.weaponBox;
        let bottom = -Infinity;
        for (const x of [b.left, b.right]) for (const y of [b.top, b.bottom]) bottom = Math.max(bottom, ay + (x - ax) * sin + (y - ay) * cos + Math.round(p.lift + p.crouch));
        return Math.max(0, bottom);
    }
    // Deform only the limbs and torso. Faces and held props stay rigid.
    function vertex(x, y, p, rig) {
        const prop = isWeapon(x, y, rig), lift = p.weaponLift || 0;
        if (prop) {
            const ax = rig.armSide * 10, ay = -31, angle = p.arm * (rig.armSide === -1 ? 1.5 : 1), cos = Math.cos(angle), sin = Math.sin(angle);
            return { x: ax + (x - ax) * cos - (y - ay) * sin + Math.round(p.lean), y: Math.min(0, ay + (x - ax) * sin + (y - ay) * cos + Math.round(p.lift + p.crouch) - lift) };
        }
        const hip = -20, leg = clamp((y - hip) / -hip, 0, 1), left = x < rig.split;
        const footX = left ? p.leftX : p.rightX, footY = left ? p.leftY : p.rightY;
        let dx = footX * leg * leg, dy = footY * leg * leg;
        const shoulder = clamp((hip - y) / (hip - rig.neck), 0, 1);
        dx += Math.round(p.lean) * shoulder;
        dy += Math.round(p.lift + p.crouch) * shoulder;
        const side = rig.armSide, outside = side * x;
        const head = isHead(x, y, rig);
        if (!head && p.arm) {
            const horizontal = clamp((outside - 7) / 10, 0, 1);
            const vertical = y > rig.neck && y < -16 ? 1 : clamp((outside - 19) / 9, 0, 1);
            const weight = horizontal * vertical;
            const ax = side * 10, ay = -31, angle = p.arm * (side === -1 ? 1.5 : 1);
            const vx = x - ax, vy = y - ay, cos = Math.cos(angle), sin = Math.sin(angle);
            dx += (vx * cos - vy * sin - vx) * weight;
            dy += (vx * sin + vy * cos - vy) * weight;
            dy -= lift * weight;
        }
        // Grounded textures never penetrate the floor, including a swinging weapon.
        return { x: x + dx, y: Math.min(0, y + dy) };
    }
    root.RIFT_ANIM = { COUNT: 50, STRIDE, pose, create, update, attackFrame, vertex, isWeapon, weaponLift };
})(typeof window === 'undefined' ? globalThis : window);
