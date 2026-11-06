// ===================================================================
// WIZARDZ 98 — the renderer, pretending to be 1995
//
// What makes it look like a PlayStation lives in games/ps1/ps1-gl.js, which this
// game shares with dungeonz 98: the shaders and why they are like that, the texture
// page, the wizards, the batch of glowing things, the height map mesher. What is here
// is the arena, the things on its floor, and the order a frame goes in.
// ===================================================================
(function () {
    'use strict';

    const D = window.WZ;
    const S = window.WZ_SIM;
    const P = window.PS1_GL;
    const { M4, TILE, tileUv, Builder } = P;
    const { sin, cos, hypot, max, min, abs, floor, PI } = Math;
    const FOG_COLOR = P.FOG_COLOR;

    // ---------------------------------------------------------------
    // the arena, baked
    // ---------------------------------------------------------------
    // Whichever map is in use, from its own height function, so a new map costs no new
    // drawing code. The floor and its cliffs come out of P.terrain.
    function buildArena() {
        const B = new Builder();
        const A = D.ARENA, H = A.size / 2, h = S.heightAt;
        const L = S.LAYOUT, T = L.theme, altar = L.altar;
        const tileOf = name => TILE[name] === undefined ? TILE.floor : TILE[name];
        const floorA = tileOf(T.floor[0]), floorB = tileOf(T.floor[1]), raised = tileOf(T.raised), cliff = tileOf(T.cliff), wallTile = tileOf(T.wall);
        const lt = T.light;
        // how dark a corner of floor is: walls near it shut out the sky, and the altar glows
        const lightAt = (x, z, y) => {
            let occl = 0;
            for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]]) {
                if (h(x + dx, z + dz) > y + 0.6) occl++;
            }
            const d = hypot(x, z);
            const glow = max(0, 1 - d / 16);
            const k = (1 - occl * 0.085) * (0.8 + 0.08 * sin(x * 0.7) * cos(z * 0.53)) * (0.92 + min(y, 3) * 0.05);
            return [(0.92 + glow * 0.14) * k * lt[0], (0.92 - glow * 0.14) * k * lt[1], (1 + glow * 0.3) * k * lt[2]];
        };
        const g = (x, z) => L.ground(x, z);
        const flat = c => abs(c[0] - c[1]) < 0.001 && abs(c[1] - c[2]) < 0.001 && abs(c[2] - c[3]) < 0.001;
        const tileFor = (x, z, w, c) => {
            const mx = x + w / 2, mz = z + w / 2;
            if (D.octagon(mx, mz) <= altar.r && abs(c[0] - altar.h) < 0.01 && flat(c)) return TILE.rune;
            if (!flat(c)) return TILE.ramp;
            if (c[0] > 0.01) return raised;
            return (floor((mx + H) / 2) + floor((mz + H) / 2)) % 2 ? floorA : floorB;
        };
        const edge = H - 1;
        P.terrain(B, {
            x0: -edge, z0: -edge, x1: edge, z1: edge, uv0: [-H, -H],
            ground: g, tileFor, lightAt, light: lt, cliff,
            big: (x, z, c) => c[0] < 0.01 || D.octagon(x + 1, z + 1) > altar.r + 2
        });
        // the wall round the outside
        const wallH = 9;
        for (let t = -edge; t < edge; t += 4) {
            const n = min(t + 4, edge);
            const dark = [0.5 * lt[0], 0.48 * lt[1], 0.62 * lt[2]], lit2 = [0.82 * lt[0], 0.8 * lt[1], 0.95 * lt[2]];
            B.quad([t, 0, -edge], [n, 0, -edge], [n, wallH, -edge], [t, wallH, -edge], wallTile, dark, dark, lit2, lit2);
            B.quad([n, 0, edge], [t, 0, edge], [t, wallH, edge], [n, wallH, edge], wallTile, dark, dark, lit2, lit2);
            B.quad([edge, 0, t], [edge, 0, n], [edge, wallH, n], [edge, wallH, t], wallTile, dark, dark, lit2, lit2);
            B.quad([-edge, 0, n], [-edge, 0, t], [-edge, wallH, t], [-edge, wallH, n], wallTile, dark, dark, lit2, lit2);
            // battlements, because silhouettes are cheap
            const cr = [0.7 * lt[0], 0.68 * lt[1], 0.84 * lt[2]];
            B.box(t + 0.6, wallH, -edge - 0.4, t + 2.4, wallH + 1.2, -edge + 0.4, wallTile, cr);
            B.box(t + 0.6, wallH, edge - 0.4, t + 2.4, wallH + 1.2, edge + 0.4, wallTile, cr);
            B.box(edge - 0.4, wallH, t + 0.6, edge + 0.4, wallH + 1.2, t + 2.4, wallTile, cr);
            B.box(-edge - 0.4, wallH, t + 0.6, -edge + 0.4, wallH + 1.2, t + 2.4, wallTile, cr);
        }
        // everything solid
        const LOOK = {
            pillar: { tile: TILE.slab, col: [0.95, 0.95, 1.05] },
            low: { tile: TILE.low, col: [1, 1, 1] },
            crate: { tile: TILE.crate, col: [1, 0.98, 0.9] },
            window: { tile: TILE.low, col: [1, 1, 1] },
            disk: { tile: TILE.disk, col: [1, 1, 1.05] }
        };
        for (const b of L.boxes) {
            const l = LOOK[b[5]] || LOOK.pillar;
            const x0 = b[0] - b[2], x1 = b[0] + b[2], z0 = b[1] - b[3], z1 = b[1] + b[3], y1 = b[4];
            const y0 = L.ground(b[0], b[1]);
            if (b[5] === 'window') {
                // the two big sides are the dialog, stretched across two tiles
                const dlg = tileUv(TILE.dialog), dlg2 = tileUv(TILE.dialog2);
                const uv = [dlg[0], dlg[1], dlg2[2], dlg[3]];
                const tall = [0.9, 0.9, 0.95], dm = [0.55, 0.55, 0.6];
                if (b[2] > b[3]) {
                    B.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], TILE.dialog, dm, dm, tall, tall, uv);
                    B.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], TILE.dialog, dm, dm, tall, tall, uv);
                    B.box(x0 - 0.02, y0, z0 + 0.01, x0, y1, z1 - 0.01, TILE.low, [0.7, 0.7, 0.72]);
                    B.box(x1, y0, z0 + 0.01, x1 + 0.02, y1, z1 - 0.01, TILE.low, [0.7, 0.7, 0.72]);
                } else {
                    B.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], TILE.dialog, dm, dm, tall, tall, uv);
                    B.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], TILE.dialog, dm, dm, tall, tall, uv);
                    B.box(x0 + 0.01, y0, z0 - 0.02, x1 - 0.01, y1, z0, TILE.low, [0.7, 0.7, 0.72]);
                    B.box(x0 + 0.01, y0, z1, x1 - 0.01, y1, z1 + 0.02, TILE.low, [0.7, 0.7, 0.72]);
                }
                B.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], TILE.low, [1, 1, 1]);
                continue;
            }
            // tall things get cut into storeys, so the texture repeats rather than stretching
            const seg = max(1, Math.round((y1 - y0) / 2.4));
            for (let i = 0; i < seg; i++) {
                const ya = y0 + (y1 - y0) * i / seg, yb = y0 + (y1 - y0) * (i + 1) / seg;
                const top = i === seg - 1;
                const k = 0.55 + 0.45 * (i + 1) / seg;
                const col = [l.col[0] * k, l.col[1] * k, l.col[2] * k];
                B.box(x0, ya, z0, x1, yb, z1, l.tile, col, { foot: i === 0 ? 0.42 : undefined });
                if (top) B.quad([x0, yb, z1], [x1, yb, z1], [x1, yb, z0], [x0, yb, z0], l.tile, l.col);
            }
        }
        return B;
    }
    function buildSky() {
        return P.skyCan(new Builder(), S.LAYOUT.theme);
    }

    // a spiky thing, for bolts: an octahedron
    function buildGem() {
        const B = new Builder();
        const P = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, -1, 0]];
        const faces = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4]];
        faces.forEach((f, i) => {
            const k = 0.72 + (i % 4) * 0.1;
            B.tri(P[f[0]], P[f[1]], P[f[2]], TILE.white, [k, k, k]);
        });
        return B;
    }
    function buildBottle(label) {
        const B = new Builder();
        const c = [1, 1, 1];
        B.frustum(0, 0.26, 0.5, 0.26, 6, label, c, c);
        B.frustum(0.5, 0.26, 0.62, 0.1, 6, TILE.white, [0.7, 0.8, 0.9], [0.7, 0.8, 0.9]);
        B.frustum(0.62, 0.1, 0.8, 0.1, 6, TILE.crate, c, c, { cap: true });
        return B;
    }
    function buildCube(tile) {
        const B = new Builder();
        B.box(-0.34, 0, -0.34, 0.34, 0.68, 0.34, tile, [1, 1, 1], { bottom: true });
        return B;
    }


    // ===============================================================
    // the renderer: the shared core, and this game's frame
    // ===============================================================
    function create(canvas, opts) {
        const R = P.core(canvas, Object.assign({ tag: 'wizardz' }, opts || {}));
        if (!R) return null;
        const IDENT = R.IDENT;
        let meshes = null;
        function ensureMeshes() {
            if (meshes) return meshes;
            const upload = R.upload;
            const square = new Builder();
            square.quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5], TILE.white, [1, 1, 1]);
            const mk = (t) => { const b = new Builder(); b.box(-0.5, 0, -0.5, 0.5, 1, 0.5, t, [1, 1, 1]); return upload(b); };
            const totem = new Builder();
            const tu = tileUv(TILE.troll), tu2 = tileUv(TILE.troll + 9);
            const uv = [tu[0], tu[1], tu2[2], tu2[3]];
            totem.quad([-1.6, 0, 0], [1.6, 0, 0], [1.6, 3.2, 0], [-1.6, 3.2, 0], TILE.troll, [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], uv);
            totem.quad([1.6, 0, 0], [-1.6, 0, 0], [-1.6, 3.2, 0], [1.6, 3.2, 0], TILE.troll, [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], uv);
            const moon = new Builder();
            const mu = tileUv(TILE.troll2), mu2 = tileUv(TILE.troll2 + 9);
            const uv2 = [mu[0], mu[1], mu2[2], mu2[3]];
            moon.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], TILE.troll2, [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], uv2);
            moon.quad([1, -1, 0], [-1, -1, 0], [-1, 1, 0], [1, 1, 0], TILE.troll2, [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], uv2);
            const plinth = new Builder();
            plinth.frustum(0, 0.34, 1.8, 0.12, 6, TILE.slab, [0.5, 0.42, 0.7], [0.95, 0.9, 1.1], { cap: true });
            meshes = {
                arena: upload(buildArena()), sky: upload(buildSky()), gem: upload(buildGem()),
                bottleInk: upload(buildBottle(TILE.labelInk)), bottleHp: upload(buildBottle(TILE.labelHp)),
                cubeTurbo: upload(buildCube(TILE.turbo)), cubeCpu: upload(buildCube(TILE.cpu)),
                wallIce: mk(TILE.ice), wallRock: mk(TILE.rock), square: upload(square),
                totem: upload(totem), moon: upload(moon), plinth: upload(plinth)
            };
            return meshes;
        }
        // the whole frame. view: {cam, fov, fog:[near, far], fogColor, tint, wizards, walls, gems, pickups, t, glow}
        R.frame = function (view) {
            const M = ensureMeshes();
            const cam = view.cam;
            R.begin({ cam, fov: view.fov || 1.1, fog: view.fog || [12, 40], fogColor: view.fogColor || S.LAYOUT.theme.fog, tint: view.tint });

            R.skyOn();
            R.draw(M.sky, M4.trs(cam.x, 0, cam.z));
            // a very large troll has been watching the whole time
            if (S.LAYOUT.theme.moon) R.draw(M.moon, M4.trs(cam.x - 60, 44, cam.z - 40, 0.9, 0, 0, 13));
            R.skyOff();

            if (view.arena !== false) {
                R.draw(M.arena, IDENT);
                // the idol over the altar, turning slowly
                R.cull(false);
                R.draw(M.plinth, M4.trs(0, S.LAYOUT.altar.h, 0, view.t * 0.4));
                R.add(0.1, 0.05, 0.15);
                // up out of the way, and gone altogether when you are stood under it
                if (hypot(cam.x, cam.z) > 6) R.draw(M.totem, M4.trs(0, S.LAYOUT.altar.h + 4 + sin(view.t * 1.3) * 0.12, 0, view.t * 0.6));
                R.add(0);
                R.cull(true);
            }

            // ---- solid things ----
            for (const p of view.pickups || []) {
                const mesh = p.kind === 'ink' ? M.bottleInk : p.kind === 'hp' ? M.bottleHp : p.kind === 'turbo' ? M.cubeTurbo : M.cubeCpu;
                R.draw(mesh, M4.trs(p.x, p.y + 0.35 + sin(view.t * 2 + p.x) * 0.1, p.z, view.t * 1.4));
            }
            for (const b of view.walls || []) {
                R.add(b.flash || 0);
                R.draw(b.ice ? M.wallIce : M.wallRock, M4.trs(b.x, b.y, b.z, b.yaw, 0, 0, b.sx, b.sy, b.sz));
            }
            R.add(0);
            for (const g of view.gems || []) {
                const c = g.col;
                R.tint(c);
                R.add(c[0] * 0.3, c[1] * 0.3, c[2] * 0.3);
                R.draw(M.gem, M4.trs(g.x, g.y, g.z, g.spin || 0, (g.spin || 0) * 0.7, 0, g.r));
            }
            R.tint();
            R.add(0);

            const wizards = view.wizards || [];
            R.shadows(wizards.filter(w => !w.hidden).map(w => ({ x: w.x, y: w.groundY === undefined ? w.y : w.groundY + 0.02, z: w.z, r: 0.75 })));
            R.wizards(wizards, view.t);
            if (view.glow) R.glow(view.glow);
            R.cull(true);
        };
        return R;
    }

    window.WZ_GL = { create, paintPortrait: P.paintPortrait, modelFacing: P.modelFacing, TILE, hex: P.hex, FOG_COLOR };
})();
