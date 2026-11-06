// ===================================================================
// PS1 GL — the renderer every 1995 looking game on this site shares
//
// Hand written WebGL1 and no library, because what makes a PlayStation look like a
// PlayStation is what it could not do, and a modern engine goes to some lengths to
// do all of it properly. So:
//
//   a low resolution       the canvas really is 240 lines tall and css scales it
//                          up without smoothing
//   wobbling vertices      every corner snaps to a whole pixel, so things shimmer
//                          as they move. The vertex shader does this
//   warping textures       no perspective correction. uv * w and w go down as
//                          varyings and get divided back, which cancels the
//                          correction the hardware does
//   no filtering           nearest neighbour, off one 512x512 page
//   vertex lighting only   light is baked into the colours of the corners, and
//                          the darkness round a wall is too
//   dithering              a 4x4 bayer matrix, then down to 5 bits a channel
//   a short draw distance  and fog, because that is how you hid it
//   rigid body parts       a wizard is boxes on hinges, with no skinning
//
// It came out of wizardz-gl.js. What is here is what any game needs: the shaders,
// the matrices, the mesh builder, the texture page, a wizard, a height map mesher,
// a sky, and core() which owns the webgl context. What goes in a frame and in which
// order is up to the game: games/wizardz/wizardz-gl.js and games/dungeonz/dungeonz-gl.js
// both build theirs out of core(). Nothing in here knows about either game.
// ===================================================================
(function () {
    'use strict';

    const { sin, cos, hypot, atan2, max, min, abs, floor, PI, tan, sqrt } = Math;

    const VS = `
attribute vec3 aPos; attribute vec2 aUv; attribute vec3 aCol;
uniform mat4 uVP; uniform mat4 uM; uniform vec2 uRes; uniform vec3 uCam; uniform vec2 uFog;
uniform vec2 uUvShift;
varying vec3 vT; varying vec3 vC; varying float vF;
void main() {
    vec4 world = uM * vec4(aPos, 1.0);
    vec4 clip = uVP * world;
    if (clip.w > 0.05) {
        vec2 ndc = clip.xy / clip.w;
        ndc = floor(ndc * uRes * 0.5 + 0.5) / (uRes * 0.5);
        clip.xy = ndc * clip.w;
    }
    gl_Position = clip;
    float w = max(clip.w, 0.001);
    vT = vec3((aUv + uUvShift) * w, w);
    vC = aCol;
    vF = clamp((distance(world.xyz, uCam) - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
}`;
    const FS = `
precision mediump float;
uniform sampler2D uTex; uniform vec3 uFogCol; uniform vec3 uTint; uniform vec3 uAdd; uniform float uAlpha; uniform float uTest; uniform float uFogOn;
varying vec3 vT; varying vec3 vC; varying float vF;
float bayer(vec2 p) {
    vec2 a = mod(floor(p), 4.0);
    float x = a.x, y = a.y;
    float v = mod(x, 2.0) * 2.0 + mod(y, 2.0) * 3.0 - 2.0 * mod(x, 2.0) * mod(y, 2.0);
    float b = floor(x / 2.0), c = floor(y / 2.0);
    float w = mod(b, 2.0) * 2.0 + mod(c, 2.0) * 3.0 - 2.0 * mod(b, 2.0) * mod(c, 2.0);
    return (v * 4.0 + w + 0.5) / 16.0;
}
void main() {
    vec4 t = texture2D(uTex, vT.xy / vT.z);
    if (t.a < uTest) discard;
    vec3 c = t.rgb * vC * uTint + uAdd;
    c = mix(c, uFogCol, vF * uFogOn);
    float d = bayer(gl_FragCoord.xy);
    c = floor(c * 31.0 + d) / 31.0;
    gl_FragColor = vec4(c, t.a * uAlpha);
}`;

    // ---------------------------------------------------------------
    // little matrices
    // ---------------------------------------------------------------
    const M4 = {
        id: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        mul(a, b, o) {
            o = o || new Float32Array(16);
            for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
                o[c * 4 + r] = a[r] * b[c * 4] + a[r + 4] * b[c * 4 + 1] + a[r + 8] * b[c * 4 + 2] + a[r + 12] * b[c * 4 + 3];
            }
            return o;
        },
        persp(fovY, aspect, near, far) {
            const f = 1 / tan(fovY / 2), nf = 1 / (near - far);
            return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
        },
        look(ex, ey, ez, fx, fy, fz) {
            let l = hypot(fx, fy, fz) || 1;
            fx /= l; fy /= l; fz /= l;
            let rx = -fz, rz = fx;      // forward x up
            l = hypot(rx, rz) || 1;
            rx /= l; rz /= l;
            const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
            return new Float32Array([
                rx, ux, -fx, 0,
                0, uy, -fy, 0,
                rz, uz, -fz, 0,
                -(rx * ex + rz * ez), -(ux * ex + uy * ey + uz * ez), fx * ex + fy * ey + fz * ez, 1
            ]);
        },
        trs(x, y, z, yaw, pitch, roll, sx, sy, sz) {
            const cy = cos(yaw || 0), sy2 = sin(yaw || 0), cp = cos(pitch || 0), sp = sin(pitch || 0), cr = cos(roll || 0), sr = sin(roll || 0);
            sx = sx === undefined ? 1 : sx; sy = sy === undefined ? sx : sy; sz = sz === undefined ? sx : sz;
            // yaw (about y, clockwise from above to match the sim) * pitch (x) * roll (z)
            return new Float32Array([
                (cy * cr + sy2 * sp * sr) * sx, (cp * sr) * sx, (-sy2 * cr + cy * sp * sr) * sx, 0,
                (-cy * sr + sy2 * sp * cr) * sy, (cp * cr) * sy, (sy2 * sr + cy * sp * cr) * sy, 0,
                (sy2 * cp) * sz, (-sp) * sz, (cy * cp) * sz, 0,
                x, y, z, 1
            ]);
        }
    };

    // the sim's yaw 0 faces -z and turns towards +x, and a model faces +z
    const modelYaw = yaw => PI - yaw;
    // where a model's nose points once it has been turned, for the check that says so
    function modelFacing(yaw) {
        const m = M4.trs(0, 0, 0, modelYaw(yaw));
        return { x: m[8], y: m[9], z: m[10] };
    }

    // ---------------------------------------------------------------
    // the texture page: one 512x512 canvas with sixty four 64x64 tiles
    // ---------------------------------------------------------------
    const TILE = {
        floor: 0, floor2: 1, brick: 2, slab: 3, crate: 4, low: 5, rune: 6, ramp: 7,
        dialog: 8, dialog2: 9, ice: 10, rock: 11, cloud: 12, cloth: 13, white: 14, moss: 15,
        face: 16, faceAngry: 17, faceTired: 18, faceGlow: 19, faceCyclops: 20, beard: 21, hair: 22, ring: 23,
        glow: 24, star: 25, halo: 26, smoke: 27, flare: 28, beam: 29, shard: 30, sigil: 31,
        troll: 32, troll2: 34, labelInk: 36, labelHp: 37, turbo: 38, cpu: 39,
        disk: 48, chip: 49
    };
    const PAGE = 512, CELL = 64, PAD = 0.5 / PAGE;
    function tileUv(t) {
        const c = t % 8, r = floor(t / 8);
        return [c * CELL / PAGE + PAD, r * CELL / PAGE + PAD, (c + 1) * CELL / PAGE - PAD, (r + 1) * CELL / PAGE - PAD];
    }
    function hex(h) {
        h = String(h || '#888').replace('#', '');
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        const n = parseInt(h, 16) || 0;
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    // extra: a painter for tiles a game wants beyond these. It gets the same helpers:
    //   extra({ c, at, fill, speckle, clip, sprite, rnd, CELL })
    function paintPage(extra) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = PAGE;
        const c = cv.getContext('2d');
        let seed = 12345;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const at = t => [(t % 8) * CELL, floor(t / 8) * CELL];
        const fill = (t, col) => { const [x, y] = at(t); c.fillStyle = col; c.fillRect(x, y, CELL, CELL); };
        const speckle = (t, n, cols) => {
            const [x, y] = at(t);
            for (let i = 0; i < n; i++) {
                c.fillStyle = cols[floor(rnd() * cols.length)];
                c.fillRect(x + floor(rnd() * CELL), y + floor(rnd() * CELL), 1 + floor(rnd() * 2), 1 + floor(rnd() * 2));
            }
        };
        const clip = (t, fn) => { const [x, y] = at(t); c.save(); c.beginPath(); c.rect(x, y, CELL, CELL); c.clip(); c.translate(x, y); fn(c); c.restore(); };

        // the floor: tiles that have seen some things
        const stoneTile = (t, a, b) => {
            fill(t, a);
            speckle(t, 500, [b, '#00000033', '#ffffff14']);
            clip(t, g => {
                g.fillStyle = '#00000055';
                g.fillRect(0, 0, CELL, 2); g.fillRect(0, 0, 2, CELL);
                g.fillStyle = '#ffffff18';
                g.fillRect(2, 2, CELL - 2, 1); g.fillRect(2, 2, 1, CELL - 2);
            });
        };
        stoneTile(TILE.floor, '#5d6275', '#4e5364');
        stoneTile(TILE.floor2, '#4a5468', '#3e475a');
        // bricks
        fill(TILE.brick, '#3a3648');
        clip(TILE.brick, g => {
            for (let r = 0; r < 5; r++) for (let k = -1; k < 3; k++) {
                const x = k * 32 + (r % 2 ? 16 : 0), y = r * 13;
                g.fillStyle = ['#6a5f7e', '#5e5470', '#73688a'][floor(rnd() * 3)];
                g.fillRect(x + 1, y + 1, 30, 11);
                g.fillStyle = '#ffffff16'; g.fillRect(x + 1, y + 1, 30, 1);
                g.fillStyle = '#00000033'; g.fillRect(x + 1, y + 11, 30, 1);
            }
        });
        speckle(TILE.brick, 200, ['#00000022', '#ffffff10']);
        // a pillar: big blocks, with a band of teal because it is that sort of a temple
        fill(TILE.slab, '#77748c');
        clip(TILE.slab, g => {
            g.fillStyle = '#00000044'; g.fillRect(0, 30, CELL, 2); g.fillRect(0, 62, CELL, 2);
            g.fillStyle = '#008080'; g.fillRect(0, 12, CELL, 6);
            g.fillStyle = '#ffffff22'; g.fillRect(0, 12, CELL, 1);
            g.fillStyle = '#00000022'; g.fillRect(30, 0, 2, 30); g.fillRect(12, 32, 2, 30); g.fillRect(48, 32, 2, 30);
        });
        speckle(TILE.slab, 260, ['#00000022', '#ffffff14']);
        // a crate
        fill(TILE.crate, '#8a6b3f');
        clip(TILE.crate, g => {
            g.fillStyle = '#6d5230';
            for (let i = 0; i < 5; i++) g.fillRect(0, i * 13, CELL, 2);
            g.fillStyle = '#5a4326';
            g.fillRect(0, 0, 5, CELL); g.fillRect(CELL - 5, 0, 5, CELL); g.fillRect(0, 0, CELL, 5); g.fillRect(0, CELL - 5, CELL, 5);
            g.strokeStyle = '#5a4326'; g.lineWidth = 4;
            g.beginPath(); g.moveTo(4, 4); g.lineTo(60, 60); g.stroke();
        });
        speckle(TILE.crate, 120, ['#00000022', '#ffffff10']);
        // a low wall is win98 grey, with the bevel
        fill(TILE.low, '#a9a9a9');
        clip(TILE.low, g => {
            g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, CELL, 3); g.fillRect(0, 0, 3, CELL);
            g.fillStyle = '#5e5e5e'; g.fillRect(0, CELL - 3, CELL, 3); g.fillRect(CELL - 3, 0, 3, CELL);
        });
        speckle(TILE.low, 160, ['#00000014', '#ffffff14']);
        // the altar floor: a rune, purple, a bit too pleased with itself
        fill(TILE.rune, '#2a1a48');
        clip(TILE.rune, g => {
            g.strokeStyle = '#c08cff'; g.lineWidth = 3;
            g.beginPath(); g.arc(32, 32, 24, 0, 7); g.stroke();
            g.lineWidth = 2;
            g.beginPath(); for (let i = 0; i <= 5; i++) { const a = -PI / 2 + i * 4 * PI / 5; const x = 32 + cos(a) * 22, y = 32 + sin(a) * 22; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
            g.fillStyle = '#0df259'; g.fillRect(30, 30, 4, 4);
        });
        fill(TILE.ramp, '#6a6680');
        clip(TILE.ramp, g => {
            g.fillStyle = '#4c4860';
            for (let i = 0; i < 4; i++) g.fillRect(0, i * 16 + 13, CELL, 3);
        });
        speckle(TILE.ramp, 180, ['#00000022', '#ffffff10']);
        // a windows error dialog the size of a bus. two tiles side by side
        const dlg = (g, W) => {
            g.fillStyle = '#c0c0c0'; g.fillRect(0, 0, W, CELL);
            g.fillStyle = '#fff'; g.fillRect(0, 0, W, 2); g.fillRect(0, 0, 2, CELL);
            g.fillStyle = '#404040'; g.fillRect(0, CELL - 2, W, 2); g.fillRect(W - 2, 0, 2, CELL);
            g.fillStyle = '#000080'; g.fillRect(3, 3, W - 6, 11);
            g.fillStyle = '#fff'; g.font = 'bold 9px sans-serif'; g.textBaseline = 'top'; g.fillText('error', 6, 4);
            g.fillStyle = '#c0c0c0'; g.fillRect(W - 14, 5, 9, 8);
            g.fillStyle = '#000'; g.fillText('x', W - 12, 3);
            // the red circle of doom
            g.fillStyle = '#c00000'; g.beginPath(); g.arc(18, 32, 10, 0, 7); g.fill();
            g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(13, 27); g.lineTo(23, 37); g.moveTo(23, 27); g.lineTo(13, 37); g.stroke();
            g.fillStyle = '#000'; g.font = '9px sans-serif';
            g.fillText('this wizard has performed', 34, 19);
            g.fillText('an illegal operation and', 34, 29);
            g.fillText('will be shut down bradar', 34, 39);
            // the button
            g.fillStyle = '#c0c0c0'; g.fillRect(W / 2 - 18, 49, 36, 11);
            g.fillStyle = '#fff'; g.fillRect(W / 2 - 18, 49, 36, 1); g.fillRect(W / 2 - 18, 49, 1, 11);
            g.fillStyle = '#404040'; g.fillRect(W / 2 - 18, 59, 36, 1); g.fillRect(W / 2 + 17, 49, 1, 11);
            g.fillStyle = '#000'; g.fillText('ok', W / 2 - 5, 50);
        };
        { const [x, y] = at(TILE.dialog); c.save(); c.beginPath(); c.rect(x, y, CELL * 2, CELL); c.clip(); c.translate(x, y); dlg(c, CELL * 2); c.restore(); }
        // ice and rock, for the walls people draw
        fill(TILE.ice, '#a6e0f5');
        clip(TILE.ice, g => {
            g.strokeStyle = '#ffffff99'; g.lineWidth = 1;
            for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(rnd() * 64, rnd() * 64); g.lineTo(rnd() * 64, rnd() * 64); g.stroke(); }
            g.fillStyle = '#5cb7dd55'; for (let i = 0; i < 6; i++) g.fillRect(rnd() * 56, rnd() * 56, 12, 8);
        });
        fill(TILE.rock, '#8b7a5f');
        speckle(TILE.rock, 700, ['#6e5f47', '#a5927190', '#00000030']);
        // the clouds.bmp you were thinking of
        fill(TILE.cloud, '#7fc3d6');
        clip(TILE.cloud, g => {
            const puff = (x, y, r, col) => {
                g.fillStyle = col;
                [-64, 0, 64].forEach(ox => [-64, 0, 64].forEach(oy => {
                    g.beginPath(); g.ellipse(x + ox, y + oy, r * 1.7, r * 0.8, 0, 0, 7); g.fill();
                }));
            };
            for (let i = 0; i < 7; i++) {
                const x = rnd() * 64, y = rnd() * 64;
                puff(x, y + 1.5, 7 + rnd() * 3, '#a9d8e4');
                puff(x + 3, y, 6 + rnd() * 3, '#d9f0f4');
                puff(x + 6, y - 1, 4 + rnd() * 2, '#ffffff');
            }
        });
        // cloth: nearly white, the corner colours do the work
        fill(TILE.cloth, '#e8e8e8');
        speckle(TILE.cloth, 500, ['#cccccc', '#f8f8f8']);
        clip(TILE.cloth, g => { g.fillStyle = '#00000018'; for (let i = 0; i < 8; i++) g.fillRect(i * 8, 0, 2, CELL); });
        fill(TILE.white, '#ffffff');
        fill(TILE.moss, '#4a7a45');
        speckle(TILE.moss, 700, ['#35622f', '#5f9457', '#29502a']);
        // faces. nearly white, so skin colour comes through, with the eyes on top
        const face = (t, draw) => {
            fill(t, '#ffffff');
            clip(t, g => { g.fillStyle = '#10101a'; draw(g); });
        };
        const mouth = g => { g.fillStyle = '#7a2a2a'; g.fillRect(24, 44, 16, 3); };
        face(TILE.face, g => { g.fillRect(18, 24, 8, 8); g.fillRect(38, 24, 8, 8); mouth(g); });
        face(TILE.faceAngry, g => {
            g.fillRect(18, 26, 8, 6); g.fillRect(38, 26, 8, 6);
            g.save(); g.lineWidth = 3; g.strokeStyle = '#10101a';
            g.beginPath(); g.moveTo(14, 18); g.lineTo(28, 25); g.moveTo(50, 18); g.lineTo(36, 25); g.stroke(); g.restore();
            mouth(g);
        });
        face(TILE.faceTired, g => { g.fillRect(17, 28, 10, 3); g.fillRect(37, 28, 10, 3); mouth(g); });
        face(TILE.faceGlow, g => { g.fillStyle = '#6fe8ff'; g.fillRect(17, 23, 10, 9); g.fillRect(37, 23, 10, 9); g.fillStyle = '#fff'; g.fillRect(20, 26, 3, 3); g.fillRect(40, 26, 3, 3); mouth(g); });
        face(TILE.faceCyclops, g => { g.fillStyle = '#fff'; g.fillRect(22, 18, 20, 16); g.fillStyle = '#10101a'; g.fillRect(28, 22, 9, 9); mouth(g); });
        fill(TILE.beard, '#e8e8e8');
        clip(TILE.beard, g => { g.fillStyle = '#00000022'; for (let i = 0; i < 12; i++) g.fillRect(i * 6, 0, 2, CELL); });
        fill(TILE.hair, '#d8d8d8');
        clip(TILE.hair, g => { g.fillStyle = '#00000030'; for (let i = 0; i < 12; i++) g.fillRect(0, i * 6, CELL, 2); });
        // sprites: hard edged and transparent, since that is all there was
        const sprite = (t, draw) => clip(t, g => { g.clearRect(0, 0, CELL, CELL); draw(g); });
        [TILE.ring, TILE.glow, TILE.star, TILE.halo, TILE.smoke, TILE.flare, TILE.beam, TILE.shard, TILE.sigil].forEach(t => { const [x, y] = at(t); c.clearRect(x, y, CELL, CELL); });
        sprite(TILE.glow, g => {
            const r = g.createRadialGradient(32, 32, 0, 32, 32, 30);
            r.addColorStop(0, '#fff'); r.addColorStop(0.35, '#ffffffaa'); r.addColorStop(1, '#ffffff00');
            g.fillStyle = r; g.fillRect(0, 0, CELL, CELL);
        });
        sprite(TILE.star, g => {
            g.fillStyle = '#fff';
            g.beginPath(); g.moveTo(32, 2); g.lineTo(38, 26); g.lineTo(62, 32); g.lineTo(38, 38); g.lineTo(32, 62); g.lineTo(26, 38); g.lineTo(2, 32); g.lineTo(26, 26); g.closePath(); g.fill();
        });
        sprite(TILE.halo, g => { g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.arc(32, 32, 27, 0, 7); g.stroke(); });
        sprite(TILE.ring, g => {
            g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 29, 0, 7); g.stroke();
            g.lineWidth = 2; g.beginPath(); g.arc(32, 32, 21, 0, 7); g.stroke();
            for (let i = 0; i < 8; i++) { const a = i * PI / 4; g.fillStyle = '#fff'; g.fillRect(32 + cos(a) * 25 - 2, 32 + sin(a) * 25 - 2, 4, 4); }
        });
        sprite(TILE.smoke, g => {
            for (let i = 0; i < 14; i++) {
                const a = rnd() * 6.28, r = rnd() * 22;
                g.fillStyle = '#ffffffaa';
                g.fillRect(32 + cos(a) * r - 5, 32 + sin(a) * r - 5, 10, 10);
            }
        });
        sprite(TILE.flare, g => {
            g.fillStyle = '#fff';
            g.beginPath(); g.moveTo(32, 6); g.lineTo(50, 32); g.lineTo(32, 58); g.lineTo(14, 32); g.closePath(); g.fill();
        });
        sprite(TILE.beam, g => {
            const l = g.createLinearGradient(0, 0, 0, CELL);
            l.addColorStop(0, '#ffffff00'); l.addColorStop(0.5, '#ffffff'); l.addColorStop(1, '#ffffff00');
            g.fillStyle = l; g.fillRect(0, 0, CELL, CELL);
        });
        sprite(TILE.shard, g => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(32, 2); g.lineTo(44, 32); g.lineTo(32, 62); g.lineTo(20, 32); g.closePath(); g.fill(); });
        sprite(TILE.sigil, g => {
            g.strokeStyle = '#fff'; g.lineWidth = 2;
            g.beginPath(); g.arc(32, 32, 28, 0, 7); g.stroke();
            g.beginPath(); for (let i = 0; i <= 6; i++) { const a = -PI / 2 + i * 2 * PI / 3; const x = 32 + cos(a) * 26, y = 32 + sin(a) * 26; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
            g.beginPath(); for (let i = 0; i <= 6; i++) { const a = PI / 2 + i * 2 * PI / 3; const x = 32 + cos(a) * 26, y = 32 + sin(a) * 26; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
        });
        // labels on the things you pick up
        fill(TILE.labelInk, '#2b48d8');
        clip(TILE.labelInk, g => { g.fillStyle = '#7fa0ff'; g.fillRect(0, 0, CELL, 10); g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.fillText('ink', 14, 42); });
        fill(TILE.labelHp, '#d8344a');
        clip(TILE.labelHp, g => { g.fillStyle = '#ff9aa8'; g.fillRect(0, 0, CELL, 10); g.fillStyle = '#fff'; g.fillRect(26, 20, 12, 34); g.fillRect(15, 31, 34, 12); });
        fill(TILE.turbo, '#d8d4c8');
        clip(TILE.turbo, g => { g.fillStyle = '#fff'; g.fillRect(0, 0, CELL, 4); g.fillStyle = '#8a8a80'; g.fillRect(0, CELL - 4, CELL, 4); g.fillStyle = '#0df259'; g.fillRect(8, 8, 10, 6); g.fillStyle = '#000'; g.font = 'bold 12px sans-serif'; g.fillText('turbo', 12, 44); });
        fill(TILE.cpu, '#1a4a30');
        clip(TILE.cpu, g => {
            g.fillStyle = '#c8b460'; for (let i = 0; i < 7; i++) { g.fillRect(4 + i * 8, 0, 3, 8); g.fillRect(4 + i * 8, 56, 3, 8); g.fillRect(0, 4 + i * 8, 8, 3); g.fillRect(56, 4 + i * 8, 8, 3); }
            g.fillStyle = '#222'; g.fillRect(14, 14, 36, 36);
            g.fillStyle = '#ff67d3'; g.font = 'bold 11px sans-serif'; g.fillText('98', 24, 36);
        });
        // a disk cluster, the colours a defragmenter uses
        fill(TILE.disk, '#d8d8e8');
        clip(TILE.disk, g => {
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
                g.fillStyle = ['#2e6be8', '#2e6be8', '#d8d8e8', '#20c0e0', '#e04848', '#1a3a9a'][floor(rnd() * 6)];
                g.fillRect(x * 8 + 1, y * 8 + 1, 6, 6);
            }
        });
        // a circuit board, for walking about on
        fill(TILE.chip, '#16264a');
        clip(TILE.chip, g => {
            g.strokeStyle = '#2a4a86'; g.lineWidth = 2;
            for (let i = 0; i < 7; i++) {
                const x = rnd() * 64, y = rnd() * 64;
                g.beginPath(); g.moveTo(x, y); g.lineTo(x + 18, y); g.lineTo(x + 18, y + 18); g.stroke();
            }
            g.fillStyle = '#00000055'; g.fillRect(0, 0, CELL, 2); g.fillRect(0, 0, 2, CELL);
            g.fillStyle = '#6fd6ff'; for (let i = 0; i < 5; i++) g.fillRect(rnd() * 60, rnd() * 60, 2, 2);
        });
        // a stand-in troll until the real one has loaded
        const stand = (t, col) => { const [x, y] = at(t); c.clearRect(x, y, CELL * 2, CELL * 2); c.fillStyle = col; c.beginPath(); c.arc(x + CELL, y + CELL, CELL - 8, 0, 7); c.fill(); c.fillStyle = '#000'; c.fillRect(x + 40, y + 42, 14, 14); c.fillRect(x + 74, y + 42, 14, 14); c.fillRect(x + 36, y + 80, 56, 8); };
        stand(TILE.troll, '#f0f0f0');
        stand(TILE.troll2, '#ffd34d');
        if (extra) extra({ c, at, fill, speckle, clip, sprite, rnd, CELL });
        return cv;
    }
    // the site's own trolls: they go on the page when they arrive, and nothing waits
    function loadTrolls(onDone) {
        const put = (t, src) => {
            const img = new Image();
            img.onload = () => onDone(t, img);
            img.src = src;
        };
        put(TILE.troll, 'src/emoj/xdtroll.png');
        put(TILE.troll2, 'src/emoj/patronedasiyla.png');
    }

    // ---------------------------------------------------------------
    // building meshes
    // ---------------------------------------------------------------
    class Builder {
        constructor() { this.v = []; }
        // a quad from four corners, in order round the edge
        quad(a, b, c, d, tile, ca, cb, cc, cd, uv) {
            const u = uv || tileUv(tile);
            const push = (p, x, y, col) => this.v.push(p[0], p[1], p[2], x, y, col[0], col[1], col[2]);
            cb = cb || ca; cc = cc || ca; cd = cd || ca;
            push(a, u[0], u[3], ca); push(b, u[2], u[3], cb); push(c, u[2], u[1], cc);
            push(a, u[0], u[3], ca); push(c, u[2], u[1], cc); push(d, u[0], u[1], cd);
        }
        tri(a, b, c, tile, ca, cb, cc) {
            const u = tileUv(tile);
            cb = cb || ca; cc = cc || ca;
            this.v.push(a[0], a[1], a[2], u[0], u[3], ca[0], ca[1], ca[2]);
            this.v.push(b[0], b[1], b[2], u[2], u[3], cb[0], cb[1], cb[2]);
            this.v.push(c[0], c[1], c[2], (u[0] + u[2]) / 2, u[1], cc[0], cc[1], cc[2]);
        }
        // an axis aligned box, lit from above and one side
        box(x0, y0, z0, x1, y1, z1, tile, col, opt) {
            opt = opt || {};
            const shade = (k) => [col[0] * k, col[1] * k, col[2] * k];
            const top = shade(1), lit = shade(0.82), dim = shade(0.6);
            const low = opt.foot ? shade(opt.foot) : null;
            const sTile = opt.side === undefined ? tile : opt.side;
            this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], sTile, low ? low : lit, low ? low : lit, lit, lit);
            this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], sTile, low ? low : dim, low ? low : dim, dim, dim);
            this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], sTile, low ? low : lit, low ? low : lit, lit, lit);
            this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], sTile, low ? low : dim, low ? low : dim, dim, dim);
            this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], tile, top);
            if (opt.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], tile, shade(0.4));
        }
        // a ring of n sides, wide at one height and narrow at another. robes, hats, heads
        frustum(y0, r0, y1, r1, n, tile, col0, col1, opt) {
            opt = opt || {};
            const sx = opt.sx || 1, sz = opt.sz || 1, ox = opt.ox || 0, oz = opt.oz || 0;
            for (let i = 0; i < n; i++) {
                const a = i / n * PI * 2 + PI / n, b = (i + 1) / n * PI * 2 + PI / n;
                const lit = k => 0.72 + 0.28 * cos(k - 0.9);
                const la = lit(a), lb = lit(b);
                const sh = (c, l) => [c[0] * l, c[1] * l, c[2] * l];
                const u = tileUv(tile), du = u[2] - u[0];
                const uva = [u[0] + du * i / n, u[1], u[0] + du * (i + 1) / n, u[3]];
                this.quad(
                    [sin(a) * r0 * sx + ox, y0, cos(a) * r0 * sz + oz], [sin(b) * r0 * sx + ox, y0, cos(b) * r0 * sz + oz],
                    [sin(b) * r1 * sx + ox, y1, cos(b) * r1 * sz + oz], [sin(a) * r1 * sx + ox, y1, cos(a) * r1 * sz + oz],
                    tile, sh(col0, la), sh(col0, lb), sh(col1, lb), sh(col1, la), uva
                );
            }
            if (opt.cap && r1 > 0.001) {
                const top = [col1[0], col1[1], col1[2]];
                for (let i = 0; i < n; i++) {
                    const a = i / n * PI * 2 + PI / n, b = (i + 1) / n * PI * 2 + PI / n;
                    this.tri([sin(a) * r1 * sx + ox, y1, cos(a) * r1 * sz + oz], [sin(b) * r1 * sx + ox, y1, cos(b) * r1 * sz + oz], [ox, y1, oz], TILE.white, top);
                }
            }
        }
    }
    const FOG_COLOR = [0.2, 0.4, 0.46];

    // ---------------------------------------------------------------
    // a wizard, from fourteen short strings
    //
    // One mesh per rigid part, hinged in drawWizard() below. All of it is white-ish
    // texture times corner colour, so a new robe costs no new texture.
    // ---------------------------------------------------------------
    function wizardParts(av) {
        av = av || {};
        const skin = hex(av.skin || '#f0c9a0'), robe = hex(av.robeColor || '#7b2ff7'), trim = hex(av.trimColor || '#ffb400');
        const hatC = hex(av.hatColor || '#7b2ff7'), hairC = hex(av.hairColor || '#e8e8e8');
        const dark = c => [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55];
        const parts = {};

        // ---- the robe ----
        const body = new Builder();
        const hem = av.robe === 'layered' ? 0.52 : av.robe === 'ragged' ? 0.46 : 0.44;
        body.frustum(0, hem, 0.92, 0.24, 7, TILE.cloth, dark(robe), robe, { sz: 0.82 });
        if (av.robe === 'trim' || av.robe === 'cloak') {
            body.frustum(0, hem + 0.015, 0.1, hem * 0.9 + 0.015, 7, TILE.white, trim, trim, { sz: 0.82 });
            body.box(-0.05, 0.05, 0.31, 0.05, 0.9, 0.38, TILE.white, trim);
        }
        if (av.robe === 'patched') {
            body.box(-0.26, 0.36, 0.28, -0.06, 0.56, 0.38, TILE.cloth, trim);
            body.box(0.08, 0.14, 0.3, 0.3, 0.34, 0.42, TILE.cloth, trim);
        }
        if (av.robe === 'layered') body.frustum(0.3, hem * 0.86, 0.5, hem * 0.72, 7, TILE.cloth, trim, trim, { sz: 0.82 });
        if (av.robe === 'ragged') {
            for (let i = 0; i < 6; i++) {
                const a = i / 6 * PI * 2;
                body.tri([sin(a) * hem, 0.12, cos(a) * hem * 0.82], [sin(a + 0.8) * hem, 0.12, cos(a + 0.8) * hem * 0.82], [sin(a + 0.4) * hem * 1.05, -0.08, cos(a + 0.4) * hem * 0.9], TILE.cloth, dark(robe));
            }
        }
        if (av.robe === 'cloak') {
            const cl = dark(robe);
            body.quad([-0.34, 0.02, -0.46], [0.34, 0.02, -0.46], [0.22, 0.98, -0.2], [-0.22, 0.98, -0.2], TILE.cloth, dark(cl), dark(cl), cl, cl);
            body.quad([0.34, 0.02, -0.46], [-0.34, 0.02, -0.46], [-0.22, 0.98, -0.2], [0.22, 0.98, -0.2], TILE.cloth, dark(cl), dark(cl), cl, cl);
        }
        parts.body = body;

        // ---- legs: a boot, because the robe hides the rest ----
        const leg = new Builder();
        leg.box(-0.09, -0.34, -0.1, 0.09, 0, 0.14, TILE.cloth, [0.25, 0.2, 0.18]);
        parts.leg = leg;

        // ---- arms ----
        const arm = new Builder();
        arm.box(-0.07, -0.46, -0.07, 0.07, 0, 0.07, TILE.cloth, robe);
        arm.box(-0.055, -0.56, -0.055, 0.055, -0.46, 0.055, TILE.white, skin);
        parts.arm = arm;

        // ---- head ----
        const head = new Builder();
        const faceTile = { angry: TILE.faceAngry, tired: TILE.faceTired, glowing: TILE.faceGlow, cyclops: TILE.faceCyclops }[av.eyes] || TILE.face;
        // a box, big head, on purpose: it reads at 240 lines, and it is funnier
        const hs = 0.2, hh = 0.42;
        const col = skin;
        head.box(-hs, 0, -hs, hs, hh, hs, TILE.white, col);
        head.quad([-hs, 0, hs + 0.005], [hs, 0, hs + 0.005], [hs, hh, hs + 0.005], [-hs, hh, hs + 0.005], faceTile, col);
        // ---- hair and beards ----
        const hairT = TILE.hair, bT = TILE.beard;
        if (av.hair === 'short') head.box(-hs - 0.02, hh - 0.12, -hs - 0.02, hs + 0.02, hh + 0.05, hs + 0.02, hairT, hairC);
        if (av.hair === 'long') {
            head.box(-hs - 0.02, hh - 0.12, -hs - 0.02, hs + 0.02, hh + 0.05, hs + 0.02, hairT, hairC);
            head.box(-hs - 0.03, -0.3, -hs - 0.03, hs + 0.03, hh - 0.1, -hs + 0.08, hairT, dark(hairC));
            head.box(-hs - 0.03, -0.22, -hs, -hs + 0.03, hh - 0.1, hs - 0.1, hairT, hairC);
            head.box(hs - 0.03, -0.22, -hs, hs + 0.03, hh - 0.1, hs - 0.1, hairT, hairC);
        }
        if (av.hair === 'mohawk') head.box(-0.04, hh, -hs, 0.04, hh + 0.2, hs, hairT, hairC);
        if (av.beard === 'stubble') head.box(-hs - 0.005, 0, hs - 0.04, hs + 0.005, 0.1, hs + 0.012, bT, dark(hairC));
        if (av.beard === 'goatee') head.box(-0.06, -0.14, hs - 0.04, 0.06, 0.08, hs + 0.04, bT, hairC);
        if (av.beard === 'long') head.box(-0.15, -0.34, hs - 0.06, 0.15, 0.12, hs + 0.05, bT, hairC);
        if (av.beard === 'braided') {
            head.box(-0.14, -0.1, hs - 0.06, 0.14, 0.12, hs + 0.05, bT, hairC);
            head.box(-0.05, -0.44, hs - 0.04, 0.05, -0.1, hs + 0.04, bT, dark(hairC));
        }
        if (av.beard === 'huge') head.box(-hs - 0.06, -0.48, hs - 0.1, hs + 0.06, 0.16, hs + 0.09, bT, hairC);
        // ---- hats ----
        const hat = av.hat || 'pointy', hdark = dark(hatC);
        if (hat === 'pointy') {
            head.frustum(hh - 0.04, 0.4, hh + 0.02, 0.28, 8, TILE.cloth, hdark, hatC);
            head.frustum(hh + 0.02, 0.28, hh + 0.72, 0.001, 8, TILE.cloth, hatC, hdark);
        } else if (hat === 'wide') {
            head.frustum(hh - 0.03, 0.56, hh + 0.02, 0.27, 8, TILE.cloth, hdark, hatC);
            head.frustum(hh + 0.02, 0.26, hh + 0.36, 0.2, 8, TILE.cloth, hatC, hdark, { cap: true });
        } else if (hat === 'hood') {
            head.box(-hs - 0.05, -0.06, -hs - 0.06, hs + 0.05, hh + 0.09, hs - 0.1, TILE.cloth, hdark);
            head.box(-hs - 0.05, hh - 0.04, -hs - 0.06, hs + 0.05, hh + 0.09, hs + 0.05, TILE.cloth, hatC);
            head.box(-hs - 0.05, -0.06, hs - 0.12, -hs + 0.02, hh, hs + 0.05, TILE.cloth, hatC);
            head.box(hs - 0.02, -0.06, hs - 0.12, hs + 0.05, hh, hs + 0.05, TILE.cloth, hatC);
        } else if (hat === 'crown') {
            head.frustum(hh - 0.02, 0.24, hh + 0.1, 0.25, 8, TILE.white, hdark, hatC);
            for (let i = 0; i < 4; i++) {
                const a = i * PI / 2 + PI / 4;
                head.tri([sin(a - 0.5) * 0.25, hh + 0.1, cos(a - 0.5) * 0.25], [sin(a + 0.5) * 0.25, hh + 0.1, cos(a + 0.5) * 0.25], [sin(a) * 0.27, hh + 0.28, cos(a) * 0.27], TILE.white, hatC);
                head.tri([sin(a + 0.5) * 0.25, hh + 0.1, cos(a + 0.5) * 0.25], [sin(a - 0.5) * 0.25, hh + 0.1, cos(a - 0.5) * 0.25], [sin(a) * 0.27, hh + 0.28, cos(a) * 0.27], TILE.white, hdark);
            }
        } else if (hat === 'horned') {
            head.frustum(hh - 0.04, 0.27, hh + 0.14, 0.2, 8, TILE.cloth, hdark, hatC, { cap: true });
            for (const sg of [-1, 1]) {
                const bone = [0.92, 0.88, 0.76];
                head.quad([sg * 0.22, hh + 0.02, 0.06], [sg * 0.22, hh + 0.02, -0.06], [sg * 0.45, hh + 0.3, -0.03], [sg * 0.45, hh + 0.3, 0.03], TILE.white, bone);
                head.quad([sg * 0.22, hh + 0.02, -0.06], [sg * 0.22, hh + 0.02, 0.06], [sg * 0.45, hh + 0.3, 0.03], [sg * 0.45, hh + 0.3, -0.03], TILE.white, bone);
            }
        }
        parts.head = head;

        // ---- the staff, held at the hand ----
        const staff = new Builder();
        const kind = av.staff || 'gnarled';
        const wood = [0.48, 0.3, 0.17];
        if (kind !== 'none') {
            staff.box(-0.035, -0.75, -0.035, 0.035, 0.95, 0.035, TILE.white, wood);
            if (kind === 'gnarled') { staff.box(-0.05, 0.9, -0.05, 0.14, 1.0, 0.05, TILE.white, wood); staff.box(0.09, 1, -0.04, 0.16, 1.12, 0.04, TILE.white, wood); }
            if (kind === 'crystal') {
                const gem = hatC, P = [[0, 1.3, 0], [0.13, 1.08, 0], [0, 1.08, 0.13], [-0.13, 1.08, 0], [0, 1.08, -0.13], [0, 0.9, 0]];
                [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4]].forEach((f, i) => staff.tri(P[f[0]], P[f[1]], P[f[2]], TILE.white, i % 2 ? gem : dark(gem)));
            }
            if (kind === 'skull') {
                staff.box(-0.11, 0.94, -0.11, 0.11, 1.16, 0.11, TILE.white, [0.92, 0.9, 0.84]);
                staff.box(-0.08, 1.02, 0.112, -0.02, 1.08, 0.116, TILE.white, [0.08, 0.08, 0.08]);
                staff.box(0.02, 1.02, 0.112, 0.08, 1.08, 0.116, TILE.white, [0.08, 0.08, 0.08]);
            }
            if (kind === 'orb') {
                staff.frustum(0.93, 0.08, 1.04, 0.14, 6, TILE.white, trim, trim);
                staff.frustum(1.04, 0.14, 1.15, 0.08, 6, TILE.white, trim, dark(trim), { cap: true });
            }
            if (kind === 'broom') {
                const st = [0.78, 0.62, 0.38];
                staff.frustum(0.85, 0.05, 1.3, 0.2, 6, TILE.hair, st, dark(st), { cap: true });
            }
        }
        parts.staff = staff;

        // ---- a familiar, which floats about and does nothing ----
        const fam = new Builder();
        const f = av.familiar;
        if (f && f !== 'none') {
            const C = { cat: [0.16, 0.16, 0.2], owl: [0.54, 0.43, 0.29], bat: [0.16, 0.14, 0.22], frog: [0.3, 0.68, 0.3], imp: trim }[f] || [0.5, 0.5, 0.5];
            fam.box(-0.14, -0.12, -0.14, 0.14, 0.14, 0.14, TILE.cloth, C);
            fam.box(-0.1, 0.04, 0.14, -0.03, 0.1, 0.15, TILE.white, [1, 0.9, 0.2]);
            fam.box(0.03, 0.04, 0.14, 0.1, 0.1, 0.15, TILE.white, [1, 0.9, 0.2]);
            if (f === 'cat' || f === 'imp') {
                fam.tri([-0.14, 0.14, 0], [-0.04, 0.14, 0], [-0.1, 0.28, 0], TILE.white, C);
                fam.tri([0.04, 0.14, 0], [0.14, 0.14, 0], [0.1, 0.28, 0], TILE.white, C);
            }
            if (f === 'bat' || f === 'owl') {
                fam.quad([-0.14, -0.02, 0], [-0.14, 0.1, 0], [-0.4, 0.14, 0], [-0.4, -0.08, 0], TILE.white, C);
                fam.quad([-0.14, 0.1, 0], [-0.14, -0.02, 0], [-0.4, -0.08, 0], [-0.4, 0.14, 0], TILE.white, C);
                fam.quad([0.14, 0.1, 0], [0.14, -0.02, 0], [0.4, -0.08, 0], [0.4, 0.14, 0], TILE.white, C);
                fam.quad([0.14, -0.02, 0], [0.14, 0.1, 0], [0.4, 0.14, 0], [0.4, -0.08, 0], TILE.white, C);
            }
        }
        parts.fam = fam;
        return parts;
    }

    // ---------------------------------------------------------------
    // the ground, from a height function
    //
    // Flat two metre squares where it can, one metre ones round any edge, and a skirt
    // wherever one bit of ground stops higher than the next. Any game whose world is a
    // height map with nothing overhanging gets its floor and its cliffs from here.
    //   o.x0, o.z0, o.x1, o.z1   the rectangle, in metres, on even numbers
    //   o.ground(x, z)           the height
    //   o.tileFor(x, z, w, c)    which tile a square gets (c: its four corner heights)
    //   o.lightAt(x, z, y)       the colour baked into a corner
    //   o.big(x, z, c)           may this square be one 2m piece (default: always)
    //   o.cliff, o.light         the skirt tile, and a tint for the skirts
    //   o.skip(x, z, h)          leave this square out (inside a solid wall nobody sees)
    //   o.uv0                    [x, z] where the two metre texture grid starts
    // ---------------------------------------------------------------
    function terrain(B, o) {
        const g = o.ground, inset = 0.02;
        const lt = o.light || [1, 1, 1];
        const corners = (x, z, w) => [g(x + inset, z + w - inset), g(x + w - inset, z + w - inset), g(x + w - inset, z + inset), g(x + inset, z + inset)];
        const flat = c => abs(c[0] - c[1]) < 0.001 && abs(c[1] - c[2]) < 0.001 && abs(c[2] - c[3]) < 0.001;
        // where the texture grid starts, so a map can keep its tiles where they were
        const ox = o.uv0 ? o.uv0[0] : o.x0, oz = o.uv0 ? o.uv0[1] : o.z0;
        const cell = (x, z, w) => {
            const c = corners(x, z, w);
            if (o.skip && o.skip(x + w / 2, z + w / 2, c[0])) return;
            const t = o.tileFor(x, z, w, c);
            const u = tileUv(t), du = u[2] - u[0], dv = u[3] - u[1];
            // one tile every two metres, however the cell was cut
            const sx = (((x - ox) % 2) + 2) % 2 / 2, sz = (((z - oz) % 2) + 2) % 2 / 2, sw = w / 2;
            const uv = [u[0] + du * sx, u[1] + dv * sz, u[0] + du * (sx + sw), u[1] + dv * (sz + sw)];
            B.quad([x, c[0], z + w], [x + w, c[1], z + w], [x + w, c[2], z], [x, c[3], z], t,
                o.lightAt(x, z + w, c[0]), o.lightAt(x + w, z + w, c[1]), o.lightAt(x + w, z, c[2]), o.lightAt(x, z, c[3]), uv);
        };
        for (let z = o.z0; z < o.z1; z += 2) for (let x = o.x0; x < o.x1; x += 2) {
            const c = corners(x, z, 2);
            const uniform = flat(c) && abs(g(x + 1, z + 1) - c[0]) < 0.001 && abs(g(x + 1, z + inset) - c[0]) < 0.001 && abs(g(x + inset, z + 1) - c[0]) < 0.001 && abs(g(x + 2 - inset, z + 1) - c[0]) < 0.001 && abs(g(x + 1, z + 2 - inset) - c[0]) < 0.001;
            if (uniform && (!o.big || o.big(x, z, c))) cell(x, z, 2);
            else for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) cell(x + i, z + j, 1);
        }
        // the skirts
        const dim = (y0, y1, k) => [(0.4 + 0.1 * min(y1, 3)) * k * lt[0], (0.38 + 0.1 * min(y1, 3)) * k * lt[1], (0.52 + 0.1 * min(y1, 3)) * k * lt[2]];
        const cliff = o.cliff;
        for (let z = o.z0; z < o.z1; z += 1) for (let x = o.x0; x < o.x1; x += 1) {
            const a0 = g(x + 1 - inset, z + inset), a1 = g(x + 1 - inset, z + 1 - inset);
            const b0 = g(x + 1 + inset, z + inset), b1 = g(x + 1 + inset, z + 1 - inset);
            if (x + 1 < o.x1 && (abs(a0 - b0) > 0.05 || abs(a1 - b1) > 0.05)) {
                const lo0 = min(a0, b0), hi0 = max(a0, b0), lo1 = min(a1, b1), hi1 = max(a1, b1);
                const f = a0 + a1 > b0 + b1;   // the high side is on the left, so it faces +x
                const P = (zz, y) => [x + 1, y, zz];
                if (f) B.quad(P(z + 1, lo1), P(z, lo0), P(z, hi0), P(z + 1, hi1), cliff, dim(lo1, lo1, 0.8), dim(lo0, lo0, 0.8), dim(hi0, hi0, 1.5), dim(hi1, hi1, 1.5));
                else B.quad(P(z, lo0), P(z + 1, lo1), P(z + 1, hi1), P(z, hi0), cliff, dim(lo0, lo0, 0.65), dim(lo1, lo1, 0.65), dim(hi1, hi1, 1.25), dim(hi0, hi0, 1.25));
            }
            const c0 = g(x + inset, z + 1 - inset), c1 = g(x + 1 - inset, z + 1 - inset);
            const d0 = g(x + inset, z + 1 + inset), d1 = g(x + 1 - inset, z + 1 + inset);
            if (z + 1 < o.z1 && (abs(c0 - d0) > 0.05 || abs(c1 - d1) > 0.05)) {
                const lo0 = min(c0, d0), hi0 = max(c0, d0), lo1 = min(c1, d1), hi1 = max(c1, d1);
                const f = c0 + c1 > d0 + d1;   // the high side is behind, so it faces +z
                const P = (xx, y) => [xx, y, z + 1];
                if (f) B.quad(P(x, lo0), P(x + 1, lo1), P(x + 1, hi1), P(x, hi0), cliff, dim(lo0, lo0, 0.9), dim(lo1, lo1, 0.9), dim(hi1, hi1, 1.6), dim(hi0, hi0, 1.6));
                else B.quad(P(x + 1, lo1), P(x, lo0), P(x, hi0), P(x + 1, hi1), cliff, dim(lo1, lo1, 0.6), dim(lo0, lo0, 0.6), dim(hi0, hi0, 1.15), dim(hi1, hi1, 1.15));
            }
        }
        return B;
    }
    // a tall can around everything: clouds up top, fog at the bottom.
    // theme: { fog, skyMid, skyTop, skyHigh } as [r, g, b], and tiles for the two bands
    function skyCan(B, theme, opt) {
        opt = opt || {};
        const n = 28, R = opt.r || 90;
        const band = opt.tile === undefined ? TILE.cloud : opt.tile;
        for (let i = 0; i < n; i++) {
            const a = i / n * PI * 2, b = (i + 1) / n * PI * 2;
            const P = (an, y, r) => [sin(an) * r, y, cos(an) * r];
            const lo = theme.fog, mid = theme.skyMid, top = theme.skyTop, high = theme.skyHigh;
            B.quad(P(b, -2, R), P(a, -2, R), P(a, 16, R), P(b, 16, R), TILE.white, lo, lo, mid, mid);
            B.quad(P(b, 16, R), P(a, 16, R), P(a, 42, R * 0.84), P(b, 42, R * 0.84), band, mid, mid, top, top);
            B.quad(P(b, 42, R * 0.84), P(a, 42, R * 0.84), P(a, 62, R * 0.5), P(b, 62, R * 0.5), band, top, top, high, high);
            B.quad(P(b, 62, R * 0.5), P(a, 62, R * 0.5), P(a, 70, 0), P(b, 70, 0), TILE.white, high, high, high, high);
        }
        return B;
    }

    // ===============================================================
    // the core: one program, one texture page, the batch, and a wizard
    //
    // Everything a PS1 looking game on this site has in common. What goes in a frame,
    // and in which order, is the game's: wizardz-gl.js and the dungeon renderer both
    // compose a frame out of these.
    //   opts.keep    keep the drawing buffer, for tests that read pixels back
    //   opts.paint   a painter for extra tiles: paint(kit), see paintPage
    //   opts.tag     what to call it in a warning
    // ===============================================================
    function core(canvas, opts) {
        opts = opts || {};
        const attrs = { antialias: false, alpha: false, depth: true, stencil: false, preserveDrawingBuffer: !!opts.keep, powerPreference: 'high-performance' };
        const gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
        if (!gl) return null;
        const tag = '[' + (opts.tag || 'ps1') + ']';

        function shader(type, src) {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.warn(tag, gl.getShaderInfoLog(sh));
            return sh;
        }
        const prog = gl.createProgram();
        gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
        gl.useProgram(prog);
        const U = {};
        ['uVP', 'uM', 'uRes', 'uCam', 'uFog', 'uTex', 'uFogCol', 'uTint', 'uAdd', 'uAlpha', 'uTest', 'uFogOn', 'uUvShift'].forEach(n => { U[n] = gl.getUniformLocation(prog, n); });
        const aPos = gl.getAttribLocation(prog, 'aPos'), aUv = gl.getAttribLocation(prog, 'aUv'), aCol = gl.getAttribLocation(prog, 'aCol');
        gl.enableVertexAttribArray(aPos); gl.enableVertexAttribArray(aUv); gl.enableVertexAttribArray(aCol);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        gl.frontFace(gl.CCW);
        gl.uniform1i(U.uTex, 0);

        const page = paintPage(opts.paint);
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, page);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        loadTrolls((t, img) => {
            const c = page.getContext('2d');
            const x = (t % 8) * CELL, y = floor(t / 8) * CELL;
            c.clearRect(x, y, CELL * 2, CELL * 2);
            c.imageSmoothingEnabled = false;
            c.drawImage(img, x, y, CELL * 2, CELL * 2);
            if (gl.isContextLost()) return;
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, page);
        });

        function upload(builder) {
            const data = new Float32Array(builder.v);
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            return { buf, count: data.length / 8 };
        }
        function bind(m) {
            gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
            gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 32, 0);
            gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 32, 12);
            gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 32, 20);
        }
        let drawCalls = 0, triangles = 0;
        function draw(m, matrix) {
            if (!m || !m.count) return;
            bind(m);
            gl.uniformMatrix4fv(U.uM, false, matrix);
            gl.drawArrays(gl.TRIANGLES, 0, m.count);
            drawCalls++;
            triangles += m.count / 3;
        }
        const IDENT = M4.id();

        const wizardCache = new Map();
        function wizardMeshes(av) {
            const key = JSON.stringify(av || {});
            let w = wizardCache.get(key);
            if (w) return w;
            const p = wizardParts(av || {});
            w = {};
            for (const k of Object.keys(p)) w[k] = upload(p[k]);
            if (wizardCache.size > 12) {
                const first = wizardCache.keys().next().value;
                const old = wizardCache.get(first);
                for (const k of Object.keys(old)) gl.deleteBuffer(old[k].buf);
                wizardCache.delete(first);
            }
            wizardCache.set(key, w);
            return w;
        }

        // ---- the batch: everything that glows, rebuilt every frame ----
        const BATCH_MAX = 12000;
        const batch = new Float32Array(BATCH_MAX * 8);
        let batchN = 0, batchBuf = null;
        let camX = 0, camY = 0, camZ = 0, rightX = 1, rightY = 0, rightZ = 0, upX = 0, upY = 1, upZ = 0;
        function pushV(x, y, z, u, v, r, g, b) {
            const o = batchN * 8;
            batch[o] = x; batch[o + 1] = y; batch[o + 2] = z; batch[o + 3] = u; batch[o + 4] = v; batch[o + 5] = r; batch[o + 6] = g; batch[o + 7] = b;
            batchN++;
        }
        function sprite(x, y, z, size, tile, col, rot) {
            if (batchN + 6 > BATCH_MAX) return;
            const u = tileUv(tile);
            const c = cos(rot || 0) * size, s = sin(rot || 0) * size;
            const ax = rightX * c + upX * s, ay = rightY * c + upY * s, az = rightZ * c + upZ * s;
            const bx = -rightX * s + upX * c, by = -rightY * s + upY * c, bz = -rightZ * s + upZ * c;
            const r = col[0], g = col[1], b = col[2];
            const P = (i, j) => [x + ax * i + bx * j, y + ay * i + by * j, z + az * i + bz * j];
            const p0 = P(-1, -1), p1 = P(1, -1), p2 = P(1, 1), p3 = P(-1, 1);
            pushV(p0[0], p0[1], p0[2], u[0], u[3], r, g, b); pushV(p1[0], p1[1], p1[2], u[2], u[3], r, g, b); pushV(p2[0], p2[1], p2[2], u[2], u[1], r, g, b);
            pushV(p0[0], p0[1], p0[2], u[0], u[3], r, g, b); pushV(p2[0], p2[1], p2[2], u[2], u[1], r, g, b); pushV(p3[0], p3[1], p3[2], u[0], u[1], r, g, b);
        }
        // flat on the ground
        function disc(x, y, z, size, tile, col, rot) {
            if (batchN + 6 > BATCH_MAX) return;
            const u = tileUv(tile);
            const c = cos(rot || 0) * size, s = sin(rot || 0) * size;
            const r = col[0], g = col[1], b = col[2];
            const P = (i, j) => [x + c * i - s * j, y, z + s * i + c * j];
            const p0 = P(-1, 1), p1 = P(1, 1), p2 = P(1, -1), p3 = P(-1, -1);
            pushV(p0[0], p0[1], p0[2], u[0], u[3], r, g, b); pushV(p1[0], p1[1], p1[2], u[2], u[3], r, g, b); pushV(p2[0], p2[1], p2[2], u[2], u[1], r, g, b);
            pushV(p0[0], p0[1], p0[2], u[0], u[3], r, g, b); pushV(p2[0], p2[1], p2[2], u[2], u[1], r, g, b); pushV(p3[0], p3[1], p3[2], u[0], u[1], r, g, b);
        }
        // a stretched quad between two points, turned to face the camera
        function streak(x1, y1, z1, x2, y2, z2, w, tile, col) {
            if (batchN + 6 > BATCH_MAX) return;
            const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
            const vx = (x1 + x2) / 2 - camX, vy = (y1 + y2) / 2 - camY, vz = (z1 + z2) / 2 - camZ;
            let px = dy * vz - dz * vy, py = dz * vx - dx * vz, pz = dx * vy - dy * vx;
            const l = hypot(px, py, pz) || 1;
            px = px / l * w; py = py / l * w; pz = pz / l * w;
            const u = tileUv(tile), r = col[0], g = col[1], b = col[2];
            pushV(x1 - px, y1 - py, z1 - pz, u[0], u[3], r, g, b); pushV(x2 - px, y2 - py, z2 - pz, u[2], u[3], r, g, b); pushV(x2 + px, y2 + py, z2 + pz, u[2], u[1], r, g, b);
            pushV(x1 - px, y1 - py, z1 - pz, u[0], u[3], r, g, b); pushV(x2 + px, y2 + py, z2 + pz, u[2], u[1], r, g, b); pushV(x1 + px, y1 + py, z1 + pz, u[0], u[1], r, g, b);
        }
        // a strip lying on the ground between two points, for a line you should not stand on
        function lane(x1, y1, z1, x2, y2, z2, w, tile, col) {
            if (batchN + 6 > BATCH_MAX) return;
            const dx = x2 - x1, dz = z2 - z1, l = hypot(dx, dz) || 1;
            const px = -dz / l * w, pz = dx / l * w;
            const u = tileUv(tile), r = col[0], g = col[1], b = col[2];
            pushV(x1 - px, y1, z1 - pz, u[0], u[3], r, g, b); pushV(x2 - px, y2, z2 - pz, u[2], u[3], r, g, b); pushV(x2 + px, y2, z2 + pz, u[2], u[1], r, g, b);
            pushV(x1 - px, y1, z1 - pz, u[0], u[3], r, g, b); pushV(x2 + px, y2, z2 + pz, u[2], u[1], r, g, b); pushV(x1 + px, y1, z1 + pz, u[0], u[1], r, g, b);
        }
        function flushBatch() {
            if (!batchN) return;
            if (!batchBuf) { batchBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, batchBuf); gl.bufferData(gl.ARRAY_BUFFER, batch.byteLength, gl.DYNAMIC_DRAW); }
            gl.bindBuffer(gl.ARRAY_BUFFER, batchBuf);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.subarray(0, batchN * 8));
            gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 32, 0);
            gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 32, 12);
            gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 32, 20);
            gl.uniformMatrix4fv(U.uM, false, IDENT);
            gl.drawArrays(gl.TRIANGLES, 0, batchN);
            drawCalls++;
            triangles += batchN / 3;
            batchN = 0;
        }

        // a wizard: boxes on hinges
        const tmpA = new Float32Array(16);
        function drawWizard(w, t) {
            const m = wizardMeshes(w.avatar);
            const bob = w.walk ? abs(sin(w.walk * 2)) * 0.05 : sin(t * 2.2) * 0.012;
            const kneel = w.kneel || 0;
            const fall = w.fall || 0;
            const yaw = modelYaw(w.yaw);
            const sc = w.scale || 1;
            const root = M4.trs(w.x, w.y + (bob + 0.3 - kneel * 0.16) * sc, w.z, yaw, 0, fall * PI * 0.5, sc);
            const part = (mesh, x, y, z, ya, pi, ro) => {
                const local = M4.trs(x, y, z, ya, pi, ro);
                M4.mul(root, local, tmpA);
                draw(mesh, tmpA);
            };
            const swing = w.walk ? sin(w.walk) * 0.65 : 0;
            part(m.leg, -0.14, 0.02, swing * 0.26, 0, 0, 0);
            part(m.leg, 0.14, 0.02, -swing * 0.26, 0, 0, 0);
            draw(m.body, root);
            const headPitch = -(w.pitch || 0) * 0.5;
            part(m.head, 0, 0.9, 0, 0, headPitch, 0);
            // the casting arm comes up with the aim, and the free one swings
            const raise = w.raise === undefined ? 0 : w.raise;
            const aimP = -PI * 0.5 * raise - (w.pitch || 0) * raise;
            part(m.arm, -0.32, 0.84, 0, 0, -swing * 0.5 + (kneel ? -0.9 : 0), 0.1);
            part(m.arm, 0.32, 0.84, 0, 0, aimP + swing * 0.5 * (1 - raise) + (kneel ? -1 : 0), -0.1);
            // the staff stays in that hand
            const hx = 0.34, hy = 0.84 - cos(aimP) * 0.5, hz = -sin(aimP) * 0.5;
            const hold = raise > 0.3 ? aimP + PI * 0.5 * 1.0 + 0.2 : 0.15;
            part(m.staff, hx, hy, hz, 0, hold, -0.05);
            if (m.fam && m.fam.count) {
                const fx = w.x + cos(w.yaw + 0.7) * -0.9, fz = w.z + sin(w.yaw + 0.7) * -0.9;
                const f = M4.trs(fx, w.y + 1.9 + sin(t * 3) * 0.14, fz, yaw + sin(t) * 0.5);
                draw(m.fam, f);
            }
        }

        const R = {
            gl, canvas, U, IDENT, TILE,
            stats: () => ({ drawCalls, triangles }),
            page: () => page,
            upload, draw, wizardMeshes, drawWizard,
            sprite, disc, streak, lane, flushBatch,
            resize(w, h) {
                if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
                gl.viewport(0, 0, w, h);
                gl.uniform2f(U.uRes, w, h);
            },
            // turn a point in the world into a place on the canvas, 0..1, or null if behind
            lastVP: null,
            project(x, y, z) {
                const m = R.lastVP;
                if (!m) return null;
                const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
                const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
                if (cw <= 0.1) return null;
                return { x: (cx / cw + 1) / 2, y: (1 - cy / cw) / 2, d: cw };
            },
            // the start of every frame: the camera, the fog, the tint, a clean screen.
            // view: { cam: {x, y, z, fx, fy, fz}, fov, near, far, fog: [near, far], fogColor, tint }
            begin(view) {
                drawCalls = 0; triangles = 0;
                const cam = view.cam;
                camX = cam.x; camY = cam.y; camZ = cam.z;
                const aspect = canvas.width / canvas.height;
                const proj = M4.persp(view.fov || 1.1, aspect, view.near || 0.2, view.far || 180);
                const look = M4.look(cam.x, cam.y, cam.z, cam.fx, cam.fy, cam.fz);
                const vp = M4.mul(proj, look);
                R.lastVP = vp;
                rightX = look[0]; rightY = look[4]; rightZ = look[8];
                upX = look[1]; upY = look[5]; upZ = look[9];
                gl.uniformMatrix4fv(U.uVP, false, vp);
                gl.uniform3f(U.uCam, cam.x, cam.y, cam.z);
                const fog = view.fog || [12, 40];
                gl.uniform2f(U.uFog, fog[0], fog[1]);
                const fc = view.fogColor || FOG_COLOR;
                gl.uniform3f(U.uFogCol, fc[0], fc[1], fc[2]);
                const tint = R.tintNow = view.tint || [1, 1, 1];
                gl.uniform3f(U.uTint, tint[0], tint[1], tint[2]);
                gl.uniform3f(U.uAdd, 0, 0, 0);
                gl.uniform1f(U.uAlpha, 1);
                gl.uniform1f(U.uTest, 0.5);
                gl.uniform1f(U.uFogOn, 1);
                gl.uniform2f(U.uUvShift, 0, 0);
                gl.disable(gl.BLEND);
                gl.depthMask(true);
                gl.clearColor(fc[0], fc[1], fc[2], 1);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                return vp;
            },
            // the sky goes on first and does not touch the depth buffer
            skyOn() {
                gl.depthMask(false);
                gl.disable(gl.DEPTH_TEST);
                gl.disable(gl.CULL_FACE);
                gl.uniform1f(U.uFogOn, 0);
            },
            skyOff() {
                gl.enable(gl.DEPTH_TEST);
                gl.depthMask(true);
                gl.uniform1f(U.uFogOn, 1);
                gl.enable(gl.CULL_FACE);
            },
            add(r, g, b) { gl.uniform3f(U.uAdd, r, g === undefined ? r : g, b === undefined ? r : b); },
            tint(c) { const t = R.tintNow || [1, 1, 1]; c = c || [1, 1, 1]; gl.uniform3f(U.uTint, c[0] * t[0], c[1] * t[1], c[2] * t[2]); },
            alpha(a) {
                if (a < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
                else gl.disable(gl.BLEND);
                gl.uniform1f(U.uAlpha, a);
            },
            cull(on) { if (on) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE); },
            // blob shadows, the universal 1996 answer. list: [{x, y, z, r}]
            shadows(list) {
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                gl.depthMask(false);
                gl.uniform1f(U.uTest, 0.01);
                gl.uniform3f(U.uTint, 0, 0, 0);
                gl.uniform1f(U.uAlpha, 0.55);
                gl.enable(gl.POLYGON_OFFSET_FILL);
                gl.polygonOffset(-1, -1);
                for (const s of list) disc(s.x, s.y, s.z, s.r || 0.75, TILE.glow, [1, 1, 1], 0);
                flushBatch();
                gl.disable(gl.POLYGON_OFFSET_FILL);
                gl.uniform1f(U.uAlpha, 1);
                const t = R.tintNow || [1, 1, 1];
                gl.uniform3f(U.uTint, t[0], t[1], t[2]);
                gl.disable(gl.BLEND);
                gl.depthMask(true);
                gl.uniform1f(U.uTest, 0.5);
            },
            // wizards, with what can happen to one: flashing, fading, seen through walls
            wizards(list, t) {
                gl.disable(gl.CULL_FACE);
                for (const w of list) {
                    if (w.hidden) continue;
                    const flash = w.flash || 0;
                    gl.uniform3f(U.uAdd, flash, flash * 0.5, flash * 0.5);
                    if (w.alpha !== undefined && w.alpha < 1) {
                        gl.enable(gl.BLEND);
                        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                        gl.uniform1f(U.uAlpha, w.alpha);
                    }
                    if (w.xray) {
                        // through the fog, and through walls, because somebody cursed them
                        gl.disable(gl.DEPTH_TEST);
                        gl.uniform1f(U.uFogOn, 0);
                        gl.uniform3f(U.uAdd, 0.45, 0.15, 0.7);
                    }
                    drawWizard(w, t);
                    if (w.xray) { gl.enable(gl.DEPTH_TEST); gl.uniform1f(U.uFogOn, 1); }
                    if (w.alpha !== undefined && w.alpha < 1) { gl.disable(gl.BLEND); gl.uniform1f(U.uAlpha, 1); }
                }
                gl.uniform3f(U.uAdd, 0, 0, 0);
            },
            // glowing things: added on top, not written to depth. fn({sprite, disc, streak, lane, TILE})
            glow(fn) {
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
                gl.depthMask(false);
                gl.uniform1f(U.uTest, 0.02);
                gl.uniform1f(U.uFogOn, 0.35);
                gl.uniform3f(U.uTint, 1, 1, 1);
                fn({ sprite, disc, streak, lane, TILE });
                flushBatch();
                gl.depthMask(true);
                gl.disable(gl.BLEND);
                gl.uniform1f(U.uFogOn, 1);
                gl.uniform1f(U.uTest, 0.5);
            },
            // one wizard, on a little stage, for menus. Returns the canvas to copy from
            portrait(av, t, opt) {
                opt = opt || {};
                drawCalls = 0; triangles = 0;
                const aspect = canvas.width / canvas.height;
                const dist = opt.dist || 3.6;
                const ang = opt.angle === undefined ? 0.5 : opt.angle;
                const ex = sin(ang) * dist, ez = cos(ang) * dist, ey = 1.25;
                const proj = M4.persp(0.62, aspect, 0.1, 20);
                const look = M4.look(ex, ey, ez, -ex, 0.2 - 0.12, -ez);
                const vp = M4.mul(proj, look);
                gl.uniformMatrix4fv(U.uVP, false, vp);
                gl.uniform3f(U.uCam, ex, ey, ez);
                gl.uniform2f(U.uFog, 100, 200);
                gl.uniform3f(U.uFogCol, 0, 0, 0);
                gl.uniform3f(U.uTint, 1, 1, 1);
                gl.uniform3f(U.uAdd, 0, 0, 0);
                gl.uniform1f(U.uAlpha, 1);
                gl.uniform1f(U.uTest, 0.5);
                gl.uniform1f(U.uFogOn, 0);
                gl.uniform2f(U.uUvShift, 0, 0);
                const bg = opt.bg || [0, 0.5, 0.5];
                gl.clearColor(bg[0], bg[1], bg[2], 1);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                gl.disable(gl.BLEND);
                gl.depthMask(true);
                gl.disable(gl.CULL_FACE);
                drawWizard({ x: 0, y: 0, z: 0, yaw: PI, pitch: 0, avatar: av, walk: 0, raise: 0.0 }, t);
                gl.enable(gl.CULL_FACE);
                return canvas;
            },
            lost: () => gl.isContextLost(),
            // give the gpu its memory back, now rather than whenever
            dispose() {
                const lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
                if (lose) lose.loseContext();
            }
        };
        return R;
    }

    // one renderer for every little portrait on every menu
    let thumbs = null, thumbCanvas = null;
    function paintPortrait(target, avatar, t, opt) {
        if (!target || !target.getContext) return false;
        if (!thumbs) {
            thumbCanvas = document.createElement('canvas');
            thumbs = core(thumbCanvas, { tag: 'portrait' });
            if (!thumbs) return false;
        }
        const w = Math.max(40, Math.round(target.width / 2)), h = Math.max(40, Math.round(target.height / 2));
        thumbs.resize(w, h);
        thumbs.portrait(avatar, t || 0, opt);
        const c = target.getContext('2d');
        c.imageSmoothingEnabled = false;
        c.clearRect(0, 0, target.width, target.height);
        c.drawImage(thumbCanvas, 0, 0, target.width, target.height);
        return true;
    }

    window.PS1_GL = {
        core, terrain, skyCan, paintPortrait, Builder, wizardParts,
        M4, TILE, tileUv, hex, modelYaw, modelFacing, FOG_COLOR, PAGE, CELL
    };
})();
