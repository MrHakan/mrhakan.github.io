// ===================================================================
// DUNGEONZ 98 — the renderer
//
// The PlayStation half is games/ps1/ps1-gl.js, the same one wizardz draws with:
// 240 lines, wobbling corners, warped textures, dithering, fog. What is here is the
// dungeon (out of the same height map mesher as the wizardz arenas), the minions and
// the bosses, which are boxes on hinges like the wizards, and the order of a frame.
// ===================================================================
(function () {
    'use strict';

    const D = window.DZ;
    const S = window.DZ_SIM;
    const P = window.PS1_GL;
    const { M4, Builder, tileUv } = P;
    const { sin, cos, hypot, max, min, abs, floor, PI } = Math;
    const T = Object.assign({}, P.TILE, { bsod: 50, zip: 51, gold: 52, bug: 53, metal: 54, gate: 55, shrine: 56, eye: 57, fire: 58 });

    // ---------------------------------------------------------------
    // a few tiles of our own, on the shared page's empty squares
    // ---------------------------------------------------------------
    function paintTiles(k) {
        const { c, at, fill, speckle, clip, sprite, CELL } = k;
        // the blue screen itself
        fill(T.bsod, '#0000aa');
        clip(T.bsod, g => {
            g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.fillText(':(', 6, 26);
            g.font = '7px sans-serif';
            ['your pc ran into a', 'problem and needs', 'to restart bradar', '', '12% complete'].forEach((t, i) => g.fillText(t, 6, 38 + i * 6));
        });
        // a zip file: a zipper down the middle
        fill(T.zip, '#e6c35a');
        clip(T.zip, g => {
            g.fillStyle = '#7a6420'; g.fillRect(28, 0, 8, CELL);
            g.fillStyle = '#c0c0c0'; for (let y = 0; y < CELL; y += 6) { g.fillRect(24, y, 6, 3); g.fillRect(34, y + 3, 6, 3); }
        });
        fill(T.gold, '#ffcf3a');
        speckle(T.gold, 300, ['#fff3a0', '#c79a12', '#ffe680']);
        fill(T.bug, '#3a2a4a');
        speckle(T.bug, 400, ['#6a4a8a', '#1a1022', '#8fdc5a']);
        fill(T.metal, '#b8bcc8');
        clip(T.metal, g => { g.fillStyle = '#ffffff44'; g.fillRect(0, 10, CELL, 6); g.fillStyle = '#00000022'; g.fillRect(0, 40, CELL, 10); });
        // a portcullis
        fill(T.gate, '#2a2a30');
        clip(T.gate, g => {
            g.fillStyle = '#8a8a96';
            for (let x = 4; x < CELL; x += 12) g.fillRect(x, 0, 4, CELL);
            g.fillRect(0, 10, CELL, 4); g.fillRect(0, 44, CELL, 4);
            g.fillStyle = '#ffffff30'; for (let x = 4; x < CELL; x += 12) g.fillRect(x, 0, 1, CELL);
        });
        // the shrine floor
        fill(T.shrine, '#103040');
        clip(T.shrine, g => {
            g.strokeStyle = '#6fe8ff'; g.lineWidth = 2;
            g.beginPath(); g.arc(32, 32, 26, 0, 7); g.stroke();
            g.beginPath(); for (let i = 0; i <= 6; i++) { const a = -PI / 2 + i * 2 * PI / 6; const x = 32 + cos(a) * 22, y = 32 + sin(a) * 22; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
            g.fillStyle = '#0df259'; g.fillRect(30, 30, 4, 4);
        });
        // an eye, for things that should not have eyes
        sprite(T.eye, g => { g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 26, 0, 7); g.fill(); g.fillStyle = '#10101a'; g.beginPath(); g.arc(36, 34, 11, 0, 7); g.fill(); });
        sprite(T.fire, g => {
            g.fillStyle = '#fff';
            g.beginPath(); g.moveTo(32, 2); g.quadraticCurveTo(54, 30, 46, 50); g.quadraticCurveTo(32, 64, 18, 50); g.quadraticCurveTo(10, 30, 32, 2); g.fill();
        });
    }

    // ---------------------------------------------------------------
    // the dungeon, baked
    // ---------------------------------------------------------------
    function buildDungeon(dun) {
        const B = new Builder();
        const th = dun.def.theme;
        const tileOf = n => T[n] === undefined ? T.floor : T[n];
        const floorA = tileOf(th.floor[0]), floorB = tileOf(th.floor[1]), wallTile = tileOf(th.wall), cliff = tileOf(th.cliff);
        const g = dun.ground, lt = th.light, WH = S.WALL_H;
        const shrineAt = (x, z) => { const r = dun.roomAt(x, z); return r >= 0 && dun.rooms[r].kind === 'shrine' ? dun.rooms[r] : null; };
        const lightAt = (x, z, y) => {
            let occl = 0;
            for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]]) if (g(x + dx, z + dz) > y + 0.6) occl++;
            const r = dun.roomAt(x, z), rm = r >= 0 ? dun.rooms[r] : null;
            // a torch in the middle of every room, near enough
            const d = rm ? hypot(x - rm.cx, z - rm.cz) : 20;
            const warm = max(0, 1 - d / 14);
            const k = (1 - occl * 0.09) * (0.66 + 0.1 * sin(x * 0.7) * cos(z * 0.53)) * (y > WH - 0.1 ? 0.55 : 1);
            const sh = rm && rm.kind === 'shrine', boss = rm && rm.kind === 'boss';
            return [(k + warm * 0.3 + (boss ? 0.12 : 0)) * lt[0], (k + warm * 0.18 + (sh ? 0.12 : 0)) * lt[1], (k + warm * 0.05 + (sh ? 0.2 : 0)) * lt[2]];
        };
        const tileFor = (x, z, w, c) => {
            const mx = x + w / 2, mz = z + w / 2;
            if (c[0] > WH - 0.1) return wallTile;
            if (c[0] > 0.3) return wallTile;
            if (shrineAt(mx, mz)) return T.shrine;
            return (floor(mx / 2) + floor(mz / 2)) % 2 ? floorA : floorB;
        };
        // solid rock nobody will ever see the top of is left out
        const skip = (x, z, h) => {
            if (h < WH - 0.1) return false;
            for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, 2], [2, -2], [-2, -2]]) if (g(x + dx, z + dz) < WH - 0.1) return false;
            return true;
        };
        const z1 = Math.ceil(dun.zEnd / 2) * 2 + 2;
        P.terrain(B, { x0: dun.x0, z0: 0, x1: dun.x1, z1, ground: g, tileFor, lightAt, light: lt, cliff, skip, uv0: [0, 0] });
        return B;
    }
    function gateMesh() {
        const B = new Builder();
        B.box(-0.5, 0, -0.5, 0.5, 1, 0.5, T.gate, [1, 1, 1]);
        return B;
    }
    function chestMesh(open) {
        const B = new Builder();
        B.box(-0.5, 0, -0.35, 0.5, 0.5, 0.35, T.crate, [1, 0.9, 0.75], { bottom: true });
        B.box(-0.52, 0.2, -0.37, 0.52, 0.28, 0.37, T.gold, [1, 1, 1]);
        if (open) B.box(-0.5, 0.5, -0.35, 0.5, 0.95, -0.25, T.crate, [0.9, 0.8, 0.65]);
        else B.box(-0.5, 0.5, -0.35, 0.5, 0.68, 0.35, T.crate, [1, 0.9, 0.75]);
        return B;
    }
    function shrineMesh() {
        const B = new Builder();
        B.frustum(0, 0.7, 0.4, 0.6, 6, T.slab, [0.5, 0.6, 0.7], [0.7, 0.8, 0.95], { cap: true });
        B.frustum(0.4, 0.3, 1.4, 0.2, 6, T.slab, [0.6, 0.7, 0.8], [0.8, 0.9, 1], { cap: true });
        return B;
    }

    // ---------------------------------------------------------------
    // minions: boxes on hinges, and a texture or two
    // ---------------------------------------------------------------
    function minionMesh(kind) {
        const B = new Builder();
        const box = (x0, y0, z0, x1, y1, z1, t, col, o) => B.box(x0, y0, z0, x1, y1, z1, t, col, o);
        switch (kind) {
            case 'gremlin': {
                const g = [0.45, 0.8, 0.35];
                box(-0.28, 0.25, -0.22, 0.28, 0.75, 0.22, T.moss, g);
                box(-0.26, 0.75, -0.24, 0.26, 1.15, 0.24, T.white, g);
                B.quad([-0.22, 0.78, 0.245], [0.22, 0.78, 0.245], [0.22, 1.12, 0.245], [-0.22, 1.12, 0.245], T.faceAngry, g);
                B.tri([-0.26, 1.0, 0], [-0.26, 1.1, 0], [-0.55, 1.3, 0], T.white, g);
                B.tri([0.26, 1.1, 0], [0.26, 1.0, 0], [0.55, 1.3, 0], T.white, g);
                box(-0.22, 0, -0.1, -0.06, 0.28, 0.1, T.moss, [0.3, 0.55, 0.25]);
                box(0.06, 0, -0.1, 0.22, 0.28, 0.1, T.moss, [0.3, 0.55, 0.25]);
                break;
            }
            case 'swarm': {
                box(-0.22, 0.05, -0.3, 0.22, 0.32, 0.3, T.bug, [1, 1, 1]);
                box(-0.1, 0.18, 0.3, 0.1, 0.3, 0.4, T.white, [0.6, 1, 0.4]);
                for (const sx of [-1, 1]) for (let k = -1; k <= 1; k++) box(sx * 0.22, 0, k * 0.15 - 0.02, sx * 0.34, 0.12, k * 0.15 + 0.02, T.white, [0.2, 0.1, 0.25]);
                break;
            }
            case 'popup': {
                // a dialog box that has had enough
                const u0 = tileUv(T.dialog), u1 = tileUv(T.dialog2);
                const uv = [u0[0], u0[1], u1[2], u0[3]];
                box(-0.65, 0.5, -0.08, 0.65, 1.3, 0.08, T.low, [0.8, 0.8, 0.82]);
                B.quad([-0.65, 0.5, 0.085], [0.65, 0.5, 0.085], [0.65, 1.3, 0.085], [-0.65, 1.3, 0.085], T.dialog, [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], uv);
                B.quad([0.65, 0.5, -0.085], [-0.65, 0.5, -0.085], [-0.65, 1.3, -0.085], [0.65, 1.3, -0.085], T.dialog, [0.7, 0.7, 0.7], [0.7, 0.7, 0.7], [0.7, 0.7, 0.7], [0.7, 0.7, 0.7], uv);
                break;
            }
            case 'brute': {
                const c = [0.62, 0.6, 0.66];
                box(-0.7, 0.9, -0.5, 0.7, 2.0, 0.5, T.rock, c);
                box(-0.42, 2.0, -0.36, 0.42, 2.5, 0.36, T.rock, c);
                B.quad([-0.3, 2.05, 0.365], [0.3, 2.05, 0.365], [0.3, 2.45, 0.365], [-0.3, 2.45, 0.365], T.faceAngry, [0.9, 0.5, 0.4]);
                box(-0.55, 0, -0.3, -0.15, 0.9, 0.3, T.rock, [0.5, 0.48, 0.54]);
                box(0.15, 0, -0.3, 0.55, 0.9, 0.3, T.rock, [0.5, 0.48, 0.54]);
                box(-1.15, 0.6, -0.35, -0.7, 1.6, 0.35, T.rock, [0.55, 0.53, 0.6]);
                box(0.7, 0.6, -0.35, 1.15, 1.6, 0.35, T.rock, [0.55, 0.53, 0.6]);
                break;
            }
            case 'bomber': {
                box(-0.35, 0.05, -0.3, 0.35, 0.8, 0.3, T.zip, [1, 1, 1]);
                box(-0.04, 0.8, -0.04, 0.04, 1.1, 0.04, T.white, [0.3, 0.25, 0.2]);
                B.quad([-0.25, 0.45, 0.305], [-0.05, 0.45, 0.305], [-0.05, 0.65, 0.305], [-0.25, 0.65, 0.305], T.white, [0.1, 0.1, 0.1]);
                B.quad([0.05, 0.45, 0.305], [0.25, 0.45, 0.305], [0.25, 0.65, 0.305], [0.05, 0.65, 0.305], T.white, [0.1, 0.1, 0.1]);
                break;
            }
            case 'shield': {
                const c = [0.7, 0.35, 0.3];
                box(-0.35, 0, -0.25, 0.35, 1.5, 0.25, T.cloth, [0.35, 0.3, 0.4]);
                box(-0.25, 1.5, -0.22, 0.25, 1.9, 0.22, T.white, [0.85, 0.75, 0.6]);
                B.quad([-0.2, 1.52, 0.225], [0.2, 1.52, 0.225], [0.2, 1.88, 0.225], [-0.2, 1.88, 0.225], T.face, [0.85, 0.75, 0.6]);
                // the wall it carries, out in front
                box(-0.75, 0.1, 0.4, 0.75, 1.75, 0.6, T.brick, c);
                break;
            }
            case 'healer': {
                B.frustum(0.6, 0.45, 0.7, 0.45, 10, T.disk, [1, 1, 1], [1, 1, 1], { cap: true });
                B.frustum(0.7, 0.45, 0.6, 0.45, 10, T.disk, [0.8, 0.8, 0.9], [0.8, 0.8, 0.9]);
                B.frustum(0.66, 0.12, 0.74, 0.12, 6, T.metal, [1, 1, 1], [1, 1, 1], { cap: true });
                break;
            }
        }
        return B;
    }
    function bossMesh(kind) {
        const B = new Builder();
        if (kind === 'clippy') {
            // a paperclip, more or less
            const m = [0.85, 0.87, 0.95];
            const seg = (x0, y0, x1, y1) => {
                const n = 6, r = 0.18;
                const dx = x1 - x0, dy = y1 - y0, l = hypot(dx, dy) || 1;
                const ax = -dy / l * r, ay = dx / l * r;
                B.quad([x0 - ax, y0 - ay, -r], [x1 - ax, y1 - ay, -r], [x1 + ax, y1 + ay, -r], [x0 + ax, y0 + ay, -r], T.metal, m);
                B.quad([x0 + ax, y0 + ay, r], [x1 + ax, y1 + ay, r], [x1 - ax, y1 - ay, r], [x0 - ax, y0 - ay, r], T.metal, m);
                B.quad([x0 + ax, y0 + ay, -r], [x1 + ax, y1 + ay, -r], [x1 + ax, y1 + ay, r], [x0 + ax, y0 + ay, r], T.metal, [m[0] * 0.8, m[1] * 0.8, m[2] * 0.8]);
                B.quad([x0 - ax, y0 - ay, r], [x1 - ax, y1 - ay, r], [x1 - ax, y1 - ay, -r], [x0 - ax, y0 - ay, -r], T.metal, [m[0] * 0.7, m[1] * 0.7, m[2] * 0.7]);
                return n;
            };
            const loop = (cx, cy, w, h0, h1) => { seg(cx - w, h0, cx - w, h1); seg(cx + w, h0, cx + w, h1); };
            loop(0, 0, 0.9, 0.6, 3.6);
            seg(-0.9, 3.6, -0.4, 4.1); seg(-0.4, 4.1, 0.4, 4.1); seg(0.4, 4.1, 0.9, 3.6);
            seg(-0.9, 0.6, -0.4, 0.2); seg(-0.4, 0.2, 0.4, 0.2); seg(0.4, 0.2, 0.9, 0.6);
            loop(0, 0, 0.45, 1.2, 3.3);
            seg(-0.45, 1.2, 0, 0.85); seg(0, 0.85, 0.45, 1.2);
            // eyes
            for (const sx of [-1, 1]) {
                B.quad([sx * 0.5 - 0.3, 2.9, 0.25], [sx * 0.5 + 0.3, 2.9, 0.25], [sx * 0.5 + 0.3, 3.5, 0.25], [sx * 0.5 - 0.3, 3.5, 0.25], T.eye, [1, 1, 1]);
            }
            B.box(-0.9, 3.6, -0.1, 0.9, 3.7, 0.1, T.white, [0.3, 0.25, 0.2]);
        } else if (kind === 'troll') {
            const g = [0.85, 0.85, 0.8];
            B.box(-1.4, 0.9, -0.9, 1.4, 3.1, 0.9, T.cloth, [0.5, 0.2, 0.55]);
            B.box(-0.6, 0, -0.5, -0.1, 0.9, 0.5, T.cloth, [0.3, 0.15, 0.3]);
            B.box(0.1, 0, -0.5, 0.6, 0.9, 0.5, T.cloth, [0.3, 0.15, 0.3]);
            B.box(-2, 1.6, -0.4, -1.4, 3, 0.4, T.white, g);
            B.box(1.4, 1.6, -0.4, 2, 3, 0.4, T.white, g);
            // the face: the site's own troll, on a board
            const u0 = tileUv(T.troll), u1 = tileUv(T.troll + 9);
            const uv = [u0[0], u0[1], u1[2], u1[3]];
            B.quad([-1.3, 3.0, 0.3], [1.3, 3.0, 0.3], [1.3, 5.4, 0.3], [-1.3, 5.4, 0.3], T.troll, [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], uv);
            B.quad([1.3, 3.0, 0.28], [-1.3, 3.0, 0.28], [-1.3, 5.4, 0.28], [1.3, 5.4, 0.28], T.troll, [0.6, 0.6, 0.6], [0.6, 0.6, 0.6], [0.6, 0.6, 0.6], [0.6, 0.6, 0.6], uv);
            // a crown
            const gold = [1, 0.85, 0.3];
            B.frustum(5.3, 0.8, 5.6, 0.85, 8, T.gold, gold, gold);
            for (let i = 0; i < 5; i++) {
                const a = i / 5 * PI * 2;
                B.tri([sin(a - 0.3) * 0.85, 5.6, cos(a - 0.3) * 0.85], [sin(a + 0.3) * 0.85, 5.6, cos(a + 0.3) * 0.85], [sin(a) * 0.9, 6.2, cos(a) * 0.9], T.gold, gold);
                B.tri([sin(a + 0.3) * 0.85, 5.6, cos(a + 0.3) * 0.85], [sin(a - 0.3) * 0.85, 5.6, cos(a - 0.3) * 0.85], [sin(a) * 0.9, 6.2, cos(a) * 0.9], T.gold, gold);
            }
        } else {
            // the blue screen: a monolith that apologises
            B.box(-2.2, 0.6, -0.4, 2.2, 5.6, 0.4, T.white, [0, 0, 0.55]);
            B.quad([-2.1, 0.7, 0.405], [2.1, 0.7, 0.405], [2.1, 5.5, 0.405], [-2.1, 5.5, 0.405], T.bsod, [1, 1, 1]);
            B.quad([2.1, 0.7, -0.405], [-2.1, 0.7, -0.405], [-2.1, 5.5, -0.405], [2.1, 5.5, -0.405], T.bsod, [0.7, 0.7, 0.7]);
            B.box(-1.4, 0, -0.6, 1.4, 0.6, 0.6, T.low, [0.6, 0.6, 0.62]);
        }
        return B;
    }

    // ===============================================================
    // the renderer
    // ===============================================================
    function create(canvas, opts) {
        const R = P.core(canvas, Object.assign({ tag: 'dungeonz', paint: paintTiles }, opts || {}));
        if (!R) return null;
        const IDENT = R.IDENT;
        const meshes = {};
        let dungeonFor = null;
        function ensure(dun) {
            if (dungeonFor !== dun) {
                if (meshes.dungeon) R.gl.deleteBuffer(meshes.dungeon.buf);
                meshes.dungeon = R.upload(buildDungeon(dun));
                const th = dun.def.theme;
                if (meshes.sky) R.gl.deleteBuffer(meshes.sky.buf);
                meshes.sky = R.upload(P.skyCan(new Builder(), th, { tile: T.white }));
                dungeonFor = dun;
            }
            if (!meshes.gate) {
                meshes.gate = R.upload(gateMesh());
                meshes.chest = R.upload(chestMesh(false));
                meshes.chestOpen = R.upload(chestMesh(true));
                meshes.shrine = R.upload(shrineMesh());
                meshes.minion = {};
                D.MINION_KINDS.forEach(k => { meshes.minion[k] = R.upload(minionMesh(k)); });
                meshes.boss = { clippy: R.upload(bossMesh('clippy')), troll: R.upload(bossMesh('troll')), bsod: R.upload(bossMesh('bsod')) };
                const ice = new Builder(); ice.box(-0.5, 0, -0.5, 0.5, 1, 0.5, T.ice, [1, 1, 1]);
                meshes.ice = R.upload(ice);
            }
            return meshes;
        }
        // view: { dun, s, cam, fov, fog, tint, heroes (wizard views), minions, boss, t, glow, near }
        R.frame = function (view) {
            const dun = view.dun, s = view.s, M = ensure(dun), th = dun.def.theme;
            const cam = view.cam;
            R.begin({ cam, fov: view.fov || 1.12, fog: view.fog || [th.near, th.far], fogColor: view.fogColor || th.fog, tint: view.tint, far: 120 });
            R.skyOn();
            R.draw(M.sky, M4.trs(cam.x, 0, cam.z));
            R.skyOff();
            R.draw(M.dungeon, IDENT);
            const far = (x, z) => abs(z - cam.z) > 46 || abs(x - cam.x) > 46;
            // gates that are shut
            dun.gates.forEach((q, k) => {
                if (s.gateOpen[k] || far(q.x0, q.z0)) return;
                R.draw(M.gate, M4.trs((q.x0 + q.x1) / 2, 0, (q.z0 + q.z1) / 2, 0, 0, 0, q.x1 - q.x0, S.WALL_H, q.z1 - q.z0 + 0.2));
            });
            dun.chests.forEach((c, k) => { if (!far(c.x, c.z)) R.draw(s.chestOpen[k] ? M.chestOpen : M.chest, M4.trs(c.x, 0, c.z, view.t * 0.2)); });
            R.cull(false);
            dun.rooms.forEach(rm => { if (rm.kind === 'shrine' && !far(rm.cx, rm.cz)) R.draw(M.shrine, M4.trs(rm.cx, 0, rm.cz, view.t * 0.3)); });
            // ice walls
            for (const w of s.walls) R.draw(M.ice, M4.trs(w.x, 0, w.z, -w.ang + PI, 0, 0, w.hw * 2, 1.8, 1));
            // minions
            for (const m of view.minions) {
                const mesh = M.minion[m.kind];
                if (!mesh) continue;
                R.add(m.flash, m.flash * 0.4, m.flash * 0.3);
                if (m.elite) R.tint([1.25, 1.05, 0.55]);
                R.draw(mesh, M4.trs(m.x, m.y, m.z, P.modelYaw(m.yaw), m.lean || 0, m.roll || 0, m.scale));
                if (m.elite) R.tint();
            }
            R.add(0);
            const b = view.boss;
            if (b) {
                R.add(b.flash, b.flash * 0.5, b.flash * 0.5);
                if (b.safe) R.add(0.25, 0.25, 0.6);
                R.draw(M.boss[b.look] || M.boss.clippy, M4.trs(b.x, b.y, b.z, P.modelYaw(b.yaw), b.lean || 0, 0, b.scale || 1));
                R.add(0);
            }
            R.cull(true);
            const shadows = [];
            for (const w of view.heroes) if (!w.hidden) shadows.push({ x: w.x, y: 0.02, z: w.z, r: 0.75 });
            for (const m of view.minions) shadows.push({ x: m.x, y: 0.02, z: m.z, r: m.r * 1.6 });
            if (b) shadows.push({ x: b.x, y: 0.02, z: b.z, r: b.r * 1.5 });
            R.shadows(shadows);
            R.wizards(view.heroes, view.t);
            if (view.glow) R.glow(view.glow);
            R.cull(true);
        };
        return R;
    }

    window.DZ_GL = { create, TILE: T, minionMesh, bossMesh };
})();
