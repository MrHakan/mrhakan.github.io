// ===================================================================
// trailz 98 — the picture: a grid floor that goes off to a dark skyline,
// walls of light, and the cycles, through a camera that sits behind and
// above yours.
//
// Hand written WebGL1, like the PS1 engine in games/ps1/, but not on it.
// That engine is built to look like 1995 on purpose: a 240 line canvas,
// corners snapping to whole pixels, textures that swim and a dither over
// everything. A light cycle game is the opposite picture: thin bright lines
// that have to stay thin and bright all the way to the horizon. Its shader
// would have to be switched off piece by piece until nothing of it was left,
// and its 1100 lines would still come down the wire. So this file is its own,
// and small:
//
//   the floor    one big square, and the grid is worked out per pixel in the
//                fragment shader, with the lines kept one pixel wide however
//                far off they are (standard derivatives) and faded into an
//                even glow where they get too close together to draw
//   the walls    additive: light adds up and never needs sorting. Each
//                cycle's finished walls sit in a buffer of their own that is
//                built again only when it turns, and are drawn in its colour
//                times how far they have faded; only the stretch from the
//                last turn to the cycle is new every frame
//   the rest     a sky that goes from a glow at the horizon to black, a
//                skyline of dark blocks far away, stars, the cycles as a few
//                boxes and two wheels, and sparks
//
// Nothing here knows the rules. trailz.js hands over the state and a camera.
// ===================================================================
(function () {
    'use strict';

    const { sin, cos, min, max, floor, PI, tan, hypot } = Math;

    const VS = `
attribute vec3 aPos; attribute vec4 aCol;
uniform mat4 uVP; uniform mat4 uM; uniform vec3 uCam; uniform vec2 uFog; uniform float uPoint;
varying vec4 vC; varying float vF;
void main() {
    vec4 w = uM * vec4(aPos, 1.0);
    gl_Position = uVP * w;
    gl_PointSize = max(1.0, uPoint / max(gl_Position.w, 0.1));
    vC = aCol;
    vF = clamp((distance(w.xyz, uCam) - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
}`;
    // the alpha of a vertex colour says how much of the cycle's colour goes in
    const FS = `
precision mediump float;
uniform vec3 uTint; uniform vec3 uFogCol; uniform float uAlpha; uniform float uAdd;
varying vec4 vC; varying float vF;
void main() {
    vec3 c = mix(vC.rgb, vC.rgb * uTint, vC.a);
    // additive light fades to nothing with distance, solid things into the haze
    c = mix(c, uFogCol * (1.0 - uAdd), vF * vF);
    gl_FragColor = vec4(c * uAlpha, uAlpha);
}`;
    const FLOOR_VS = `
attribute vec2 aPos;
uniform mat4 uVP;
varying vec2 vW;
void main() {
    vW = aPos;
    gl_Position = uVP * vec4(aPos.x, 0.0, aPos.y, 1.0);
}`;
    const FLOOR_FS = (deriv) => `
${deriv ? '#extension GL_OES_standard_derivatives : enable' : ''}
precision highp float;
uniform float uS; uniform vec3 uLine; uniform vec3 uBase; uniform vec3 uFogCol; uniform vec2 uFog; uniform float uPx; uniform vec3 uCamF;
varying vec2 vW;
// how far a pixel is, worked out per pixel: the floor is one square over a kilometre
// across, and a distance taken at its corners and spread over it says nothing is near
float vD;
float lines(vec2 p, float cell, float px) {
    vec2 q = p / cell;
    ${deriv ? 'vec2 fw = max(fwidth(q), vec2(1e-5));' : 'vec2 fw = vec2(uPx * vD / cell);'}
    vec2 g = abs(fract(q - 0.5) - 0.5) / fw;
    float l = 1.0 - clamp(min(g.x, g.y) / px, 0.0, 1.0);
    // too close together to draw one by one: the glow they would add up to instead
    float far = smoothstep(0.15, 0.6, max(fw.x, fw.y));
    return mix(l, min(1.0, px * (fw.x + fw.y)), far);
}
void main() {
    vD = distance(vec3(vW.x, 0.0, vW.y), uCamF);
    float inside = step(0.0, vW.x) * step(0.0, vW.y) * step(vW.x, uS) * step(vW.y, uS);
    float minor = lines(vW, 5.0, 1.1), major = lines(vW, 25.0, 1.8);
    vec3 c = uBase * (0.35 + 0.65 * inside);
    c += uLine * (minor * 0.28 + major * 0.75) * (0.18 + 0.82 * inside);
    // the floor is lit a little brighter towards the edge of the arena
    float e = min(min(vW.x, vW.y), min(uS - vW.x, uS - vW.y));
    c += uLine * 0.22 * inside * exp(-max(e, 0.0) * 0.12);
    float f = clamp((vD - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
    gl_FragColor = vec4(mix(c, uFogCol, f), 1.0);
}`;

    // ---------------------------------------------------------------
    // matrices
    // ---------------------------------------------------------------
    function persp(fovY, aspect, near, far) {
        const f = 1 / tan(fovY / 2), nf = 1 / (near - far);
        return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    }
    function look(e, t) {
        let fx = t[0] - e[0], fy = t[1] - e[1], fz = t[2] - e[2];
        let l = hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
        // right = forward x up(0,1,0)
        let rx = -fz, ry = 0, rz = fx;
        l = hypot(rx, rz) || 1; rx /= l; rz /= l;
        const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
        return new Float32Array([
            rx, ux, -fx, 0, ry, uy, -fy, 0, rz, uz, -fz, 0,
            -(rx * e[0] + ry * e[1] + rz * e[2]), -(ux * e[0] + uy * e[1] + uz * e[2]), fx * e[0] + fy * e[1] + fz * e[2], 1
        ]);
    }
    function mul(a, b) {
        const o = new Float32Array(16);
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[r + 4] * b[c * 4 + 1] + a[r + 8] * b[c * 4 + 2] + a[r + 12] * b[c * 4 + 3];
        return o;
    }
    // a cycle's place: yaw about y (0 faces +x, a quarter turn faces +z), then a lean
    function place(x, y, z, yaw, roll, k) {
        const cy = cos(yaw) * k, sy = sin(yaw) * k, cr = cos(roll), sr = sin(roll);
        // columns: where the model's forward (x), up (y) and right (z) end up
        return new Float32Array([
            cy, 0, sy, 0,
            -sr * sy, cr * k, sr * cy, 0,
            -cr * sy, -sr * k, cr * cy, 0,
            x, y, z, 1
        ]);
    }
    const ID = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    // ---------------------------------------------------------------
    // building geometry: x, y, z, r, g, b, a (a: how much tint)
    // ---------------------------------------------------------------
    function Geo() { this.a = []; }
    Geo.prototype.v = function (x, y, z, c, t) { this.a.push(x, y, z, c[0], c[1], c[2], t || 0); };
    Geo.prototype.tri = function (p, q, r, c, t, c2, c3) {
        this.v(p[0], p[1], p[2], c, t); this.v(q[0], q[1], q[2], c2 || c, t); this.v(r[0], r[1], r[2], c3 || c, t);
    };
    Geo.prototype.quad = function (p, q, r, s, c, t, cq, cr, cs) {
        this.tri(p, q, r, c, t, cq, cr); this.tri(p, r, s, c, t, cr, cs);
    };
    // a box between two corners, shaded by face
    Geo.prototype.box = function (x0, y0, z0, x1, y1, z1, c, t, top) {
        const sh = k => [c[0] * k, c[1] * k, c[2] * k];
        const P = (x, y, z) => [x, y, z];
        const a = P(x0, y0, z0), b = P(x1, y0, z0), cc = P(x1, y0, z1), d = P(x0, y0, z1);
        const e = P(x0, y1, z0), f = P(x1, y1, z0), g = P(x1, y1, z1), h = P(x0, y1, z1);
        this.quad(e, f, g, h, top || sh(1), t);          // top
        this.quad(a, d, cc, b, sh(0.35), t);             // bottom
        this.quad(b, cc, g, f, sh(0.85), t);             // front (+x)
        this.quad(a, e, h, d, sh(0.55), t);              // back
        this.quad(a, b, f, e, sh(0.7), t);               // left (-z)
        this.quad(d, h, g, cc, sh(0.7), t);              // right (+z)
    };
    // a wheel: a short drum along z, centred on (x, y)
    Geo.prototype.wheel = function (x, y, r, w, rim, hub) {
        const n = 12;
        for (let k = 0; k < n; k++) {
            const a0 = k / n * PI * 2, a1 = (k + 1) / n * PI * 2;
            const p0 = [x + cos(a0) * r, y + sin(a0) * r], p1 = [x + cos(a1) * r, y + sin(a1) * r];
            const i0 = [x + cos(a0) * r * 0.55, y + sin(a0) * r * 0.55], i1 = [x + cos(a1) * r * 0.55, y + sin(a1) * r * 0.55];
            for (const z of [-w, w]) {
                // the glowing ring, and the dark hub inside it
                this.quad([p0[0], p0[1], z], [p1[0], p1[1], z], [i1[0], i1[1], z], [i0[0], i0[1], z], rim, 1);
                this.tri([x, y, z], [i0[0], i0[1], z], [i1[0], i1[1], z], hub, 0);
            }
            this.quad([p0[0], p0[1], -w], [p1[0], p1[1], -w], [p1[0], p1[1], w], [p0[0], p0[1], w], [rim[0] * 0.6, rim[1] * 0.6, rim[2] * 0.6], 1);
        }
    };

    // the cycle: two drums and a long low body over them, nose to +x
    function cycleGeo() {
        const g = new Geo();
        const dark = [0.08, 0.09, 0.12], glass = [0.05, 0.06, 0.1], white = [1, 1, 1];
        g.wheel(0.95, 0.5, 0.5, 0.2, white, dark);
        g.wheel(-0.95, 0.5, 0.5, 0.2, white, dark);
        g.box(-1.25, 0.32, -0.26, 1.15, 0.78, 0.26, dark, 0, [0.12, 0.13, 0.17]);
        // the stripe down each side, in the cycle's colour
        g.box(-1.2, 0.5, -0.28, 1.1, 0.58, 0.28, white, 1);
        // the canopy, set back, and its edge
        g.box(-0.55, 0.78, -0.2, 0.55, 1.02, 0.2, glass, 0, [0.1, 0.12, 0.2]);
        g.box(-0.5, 1.0, -0.16, 0.5, 1.05, 0.16, white, 1);
        // the nose light
        g.box(1.12, 0.52, -0.12, 1.24, 0.66, 0.12, white, 1);
        return new Float32Array(g.a);
    }

    // a ring of dark blocks far out, a skyline for the floor to run into
    function skylineGeo(S, seed) {
        const g = new Geo();
        let a = seed >>> 0 || 7;
        const r = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
        const cx = S / 2, R = S * 1.7 + 120;
        const n = 72;
        for (let k = 0; k < n; k++) {
            const a0 = k / n * PI * 2, a1 = a0 + PI * 2 / n * (0.55 + r() * 0.4);
            const h = 14 + r() * r() * 70 + (r() < 0.08 ? 60 : 0), rr = R + r() * 60;
            const p0 = [cx + cos(a0) * rr, cx + sin(a0) * rr], p1 = [cx + cos(a1) * rr, cx + sin(a1) * rr];
            const body = [0.03, 0.02, 0.07], top = [0.06, 0.04, 0.12];
            g.quad([p0[0], -2, p0[1]], [p1[0], -2, p1[1]], [p1[0], h, p1[1]], [p0[0], h, p0[1]], body, 0, body, top, top);
        }
        return new Float32Array(g.a);
    }
    // the sky: a tall drum, a glow at the bottom and black at the top
    function skyGeo(S) {
        const g = new Geo();
        const cx = S / 2, R = S * 3 + 400, n = 32;
        const glow = [0.16, 0.05, 0.28], mid = [0.03, 0.02, 0.09], top = [0, 0, 0.01];
        for (let k = 0; k < n; k++) {
            const a0 = k / n * PI * 2, a1 = (k + 1) / n * PI * 2;
            const p0 = [cx + cos(a0) * R, cx + sin(a0) * R], p1 = [cx + cos(a1) * R, cx + sin(a1) * R];
            g.quad([p0[0], -30, p0[1]], [p1[0], -30, p1[1]], [p1[0], R * 0.18, p1[1]], [p0[0], R * 0.18, p0[1]], glow, 0, glow, mid, mid);
            g.quad([p0[0], R * 0.18, p0[1]], [p1[0], R * 0.18, p1[1]], [p1[0], R * 1.2, p1[1]], [p0[0], R * 1.2, p0[1]], mid, 0, mid, top, top);
        }
        return new Float32Array(g.a);
    }
    function starGeo(S, seed) {
        const g = new Geo();
        let a = seed >>> 0 || 3;
        const r = () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; };
        const cx = S / 2, R = S * 2.6 + 300;
        for (let k = 0; k < 260; k++) {
            const th = r() * PI * 2, el = 0.08 + r() * 1.3;
            const b = 0.25 + r() * 0.6;
            g.v(cx + cos(th) * cos(el) * R, sin(el) * R, cx + sin(th) * cos(el) * R, [b, b, b * 1.1], 0);
        }
        return new Float32Array(g.a);
    }
    // the arena's own edge: a low wall of pale light all the way round
    function rimGeo(S) {
        const g = new Geo();
        const H = 4, lo = [0.18, 0.45, 0.6], hi = [0, 0, 0];
        const P = [[0, 0], [S, 0], [S, S], [0, S], [0, 0]];
        for (let k = 0; k < 4; k++) {
            const a = P[k], b = P[k + 1];
            g.quad([a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], H, b[1]], [a[0], H, a[1]], lo, 0, lo, hi, hi);
            // a bright line along its foot
            g.quad([a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], 0.25, b[1]], [a[0], 0.25, a[1]], [0.5, 0.9, 1], 0, [0.5, 0.9, 1], [0.2, 0.4, 0.5], [0.2, 0.4, 0.5]);
        }
        return new Float32Array(g.a);
    }

    // ---------------------------------------------------------------
    // walls of light: a sheet, a bright top edge, and a glow on the floor
    // ---------------------------------------------------------------
    const WALL_H = 1.8;
    function wallInto(out, n, ax, az, bx, bz) {
        // a wall with no length is nothing; a very short one still gets drawn
        if (ax === bx && az === bz) return n;
        const H = WALL_H;
        const nx = az === bz ? 0 : 1, nz = az === bz ? 1 : 0;      // across the wall, on the floor
        const G = 1.4;
        const put = (x, y, z, b) => { out[n++] = x; out[n++] = y; out[n++] = z; out[n++] = b; out[n++] = b; out[n++] = b; out[n++] = 1; };
        const q = (p0, p1, p2, p3) => { put(...p0); put(...p1); put(...p2); put(...p0); put(...p2); put(...p3); };
        // the sheet, dim at the foot and bright at the top
        q([ax, 0, az, 0.22], [bx, 0, bz, 0.22], [bx, H, bz, 0.7], [ax, H, az, 0.7]);
        // the top edge
        q([ax, H - 0.1, az, 1.3], [bx, H - 0.1, bz, 1.3], [bx, H + 0.03, bz, 1.6], [ax, H + 0.03, az, 1.6]);
        // the glow either side of the foot
        q([ax, 0.02, az, 0.32], [bx, 0.02, bz, 0.32], [bx + nx * G, 0.02, bz + nz * G, 0], [ax + nx * G, 0.02, az + nz * G, 0]);
        q([ax, 0.02, az, 0.32], [bx, 0.02, bz, 0.32], [bx - nx * G, 0.02, bz - nz * G, 0], [ax - nx * G, 0.02, az - nz * G, 0]);
        return n;
    }
    const WALL_FLOATS = 4 * 6 * 7;

    // ---------------------------------------------------------------
    // the renderer
    // ---------------------------------------------------------------
    function create(canvas) {
        const attrs = { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
        const gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
        if (!gl) return null;
        const deriv = !!gl.getExtension('OES_standard_derivatives');
        function shader(type, src) {
            const s = gl.createShader(type);
            gl.shaderSource(s, src); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
            return s;
        }
        function program(vs, fs, attribs) {
            const p = gl.createProgram();
            gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
            attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
            const u = {};
            const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
            for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
            return { p, u };
        }
        let P, F;
        try {
            P = program(VS, FS, ['aPos', 'aCol']);
            F = program(FLOOR_VS, FLOOR_FS(deriv), ['aPos']);
        } catch (e) {
            if (typeof console !== 'undefined') console.warn('[trailz] no shaders: ' + e.message);
            return null;
        }
        const buf = data => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return { b, n: data.length / 7 }; };
        const R = { gl, canvas, deriv, w: 1, h: 1, lost: false, S: 0, frames: 0 };
        const statics = {};
        let cycleBuf = null, dyn = null, dynCap = 0, pts = null, ptsCap = 0;
        const wallCache = [];
        canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); R.lost = true; }, false);

        function arena(S, seed) {
            if (R.S === S && statics.seed === seed) return;
            R.S = S; statics.seed = seed;
            for (const k of ['sky', 'skyline', 'stars', 'rim']) if (statics[k]) gl.deleteBuffer(statics[k].b);
            statics.sky = buf(skyGeo(S));
            statics.skyline = buf(skylineGeo(S, seed));
            statics.stars = buf(starGeo(S, seed));
            statics.rim = buf(rimGeo(S));
            if (statics.floor) gl.deleteBuffer(statics.floor);
            const M = S * 4 + 400;
            statics.floor = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, statics.floor);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-M, -M, S + M, -M, S + M, S + M, -M, -M, S + M, S + M, -M, S + M]), gl.STATIC_DRAW);
        }

        function useP(vp, cam, fog) {
            gl.useProgram(P.p);
            gl.uniformMatrix4fv(P.u.uVP, false, vp);
            gl.uniform3fv(P.u.uCam, cam);
            gl.uniform2f(P.u.uFog, fog[0], fog[1]);
            gl.uniform3f(P.u.uFogCol, 0.04, 0.02, 0.1);
            gl.uniform1f(P.u.uPoint, 0);
        }
        function draw(b, mode, n, o) {
            o = o || {};
            gl.uniformMatrix4fv(P.u.uM, false, o.m || ID);
            gl.uniform3fv(P.u.uTint, o.tint || [1, 1, 1]);
            gl.uniform1f(P.u.uAlpha, o.alpha === undefined ? 1 : o.alpha);
            gl.uniform1f(P.u.uAdd, o.add ? 1 : 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, b);
            gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
            gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
            gl.drawArrays(mode, 0, n);
        }

        // a cycle's finished walls, kept until it turns again
        function wallsOf(c) {
            const p = c.pts, segs = (p.length >> 1) - 1;
            const key = p.length + ':' + (segs > 0 ? p[p.length - 2] + ',' + p[p.length - 1] + ',' + p[2] + ',' + p[3] : '');
            let w = wallCache[c.i];
            if (w && w.key === key) return w;
            if (!w) w = wallCache[c.i] = { b: gl.createBuffer(), n: 0, key: '' };
            const out = new Float32Array(max(1, segs) * WALL_FLOATS);
            let n = 0;
            for (let k = 0; k + 3 < p.length; k += 2) n = wallInto(out, n, p[k], p[k + 1], p[k + 2], p[k + 3]);
            gl.bindBuffer(gl.ARRAY_BUFFER, w.b);
            gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, max(7, n)), gl.STATIC_DRAW);
            w.n = n / 7; w.key = key;
            return w;
        }

        R.resize = function (w, h) {
            w = max(1, w | 0); h = max(1, h | 0);
            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== h) canvas.height = h;
            R.w = w; R.h = h;
        };

        // v: { s, cycles: [{ i, x, z, yaw, roll, alive, col, fade, pts, open }], cam: { eye, at, fov },
        //      sparks: [{ x, y, z, col, a }], seed, me }
        R.frame = function (v) {
            if (R.lost || gl.isContextLost()) { R.lost = true; return false; }
            const s = v.s;
            arena(s.S, v.seed || 1);
            gl.viewport(0, 0, R.w, R.h);
            gl.clearColor(0, 0, 0.01, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            const aspect = R.w / R.h;
            const far = s.S * 6 + 1200;
            const proj = persp(v.cam.fov, aspect, 0.3, far);
            const view = look(v.cam.eye, v.cam.at);
            const vp = mul(proj, view);
            const cam = v.cam.eye;
            const fogFar = s.S * 2.2 + 260;
            const fog = [s.S * 0.35, fogFar];

            // the sky and the skyline, behind everything, no depth
            gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
            useP(vp, cam, [far * 2, far * 3]);
            draw(statics.sky.b, gl.TRIANGLES, statics.sky.n);
            gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
            gl.uniform1f(P.u.uPoint, 2.2 * R.h / 720 * far);
            draw(statics.stars.b, gl.POINTS, statics.stars.n, { add: 1 });
            gl.uniform1f(P.u.uPoint, 0);
            gl.disable(gl.BLEND);
            useP(vp, cam, [s.S * 1.4, s.S * 4 + 600]);
            draw(statics.skyline.b, gl.TRIANGLES, statics.skyline.n);

            // the floor
            gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
            gl.useProgram(F.p);
            gl.uniformMatrix4fv(F.u.uVP, false, vp);
            gl.uniform3fv(F.u.uCamF, cam);
            gl.uniform1f(F.u.uS, s.S);
            gl.uniform3f(F.u.uLine, 0.12, 0.62, 0.78);
            gl.uniform3f(F.u.uBase, 0.012, 0.02, 0.05);
            gl.uniform3f(F.u.uFogCol, 0.04, 0.02, 0.1);
            gl.uniform2f(F.u.uFog, fog[0], fogFar);
            gl.uniform1f(F.u.uPx, 2 * tan(v.cam.fov / 2) / R.h);
            gl.bindBuffer(gl.ARRAY_BUFFER, statics.floor);
            gl.enableVertexAttribArray(0); gl.disableVertexAttribArray(1);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // the cycles, solid
            useP(vp, cam, fog);
            if (!cycleBuf) cycleBuf = buf(cycleGeo());
            for (const c of v.cycles) {
                if (!c.alive && !c.show) continue;
                draw(cycleBuf.b, gl.TRIANGLES, cycleBuf.n, { m: place(c.x, 0, c.z, c.yaw, c.roll || 0, 1.3), tint: c.col, alpha: 1 });
            }

            // light: walls, the rim, sparks. Added up, depth tested, never written
            gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
            draw(statics.rim.b, gl.TRIANGLES, statics.rim.n, { add: 1, alpha: 0.85 });
            let need = 0;
            for (const c of v.cycles) if (!c.gone) need += WALL_FLOATS;
            if (dynCap < need) { dynCap = need * 2; dyn = new Float32Array(dynCap); }
            for (const c of v.cycles) {
                if (c.gone || c.fade <= 0) continue;
                const w = wallsOf(c);
                // a dying wall flickers on its way out
                const fl = c.fade < 1 ? c.fade * (0.75 + 0.25 * sin(v.t * 40 + c.i)) : 1;
                if (w.n) draw(w.b, gl.TRIANGLES, w.n, { add: 1, tint: c.col, alpha: fl });
                // and the stretch it is laying right now
                const p = c.pts, L = p.length;
                const n = wallInto(dyn, 0, p[L - 2], p[L - 1], c.x, c.z);
                if (n) {
                    if (!R.dynBuf) R.dynBuf = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, R.dynBuf);
                    gl.bufferData(gl.ARRAY_BUFFER, dyn.subarray(0, n), gl.DYNAMIC_DRAW);
                    draw(R.dynBuf, gl.TRIANGLES, n / 7, { add: 1, tint: c.col, alpha: fl });
                }
            }
            // sparks and the light under each cycle
            const sp = v.sparks || [];
            const npts = sp.length;
            if (npts) {
                if (ptsCap < npts * 7) { ptsCap = npts * 14; pts = new Float32Array(ptsCap); }
                let k = 0;
                for (const q of sp) { pts[k++] = q.x; pts[k++] = q.y; pts[k++] = q.z; pts[k++] = q.col[0] * q.a; pts[k++] = q.col[1] * q.a; pts[k++] = q.col[2] * q.a; pts[k++] = 0; }
                if (!R.ptsBuf) R.ptsBuf = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, R.ptsBuf);
                gl.bufferData(gl.ARRAY_BUFFER, pts.subarray(0, k), gl.DYNAMIC_DRAW);
                gl.uniform1f(P.u.uPoint, 0.35 * R.h / tan(v.cam.fov / 2));
                draw(R.ptsBuf, gl.POINTS, npts, { add: 1 });
                gl.uniform1f(P.u.uPoint, 0);
            }
            gl.depthMask(true); gl.disable(gl.BLEND);
            R.frames++;
            return true;
        };

        // for the browser test: what a frame looks like, in a few numbers
        R.sample = function (v) {
            const keep = gl.getContextAttributes().preserveDrawingBuffer;
            R.frame(v);
            const w = R.w, h = R.h, px = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
            // rows from the top of the picture: how bright each band is, and how much of it is colour
            const bands = [];
            for (let b = 0; b < 8; b++) {
                let sum = 0, lit = 0, n = 0;
                for (let y = floor(h * (7 - b) / 8); y < floor(h * (8 - b) / 8); y += 2) for (let x = 0; x < w; x += 3) {
                    const i = (y * w + x) * 4, l = px[i] + px[i + 1] + px[i + 2];
                    sum += l; if (l > 120) lit++; n++;
                }
                bands.push({ mean: sum / n / 3, lit: lit / n });
            }
            return { w, h, bands, keep };
        };
        return R;
    }

    window.TZ_GL = { create, WALL_H };
})();
