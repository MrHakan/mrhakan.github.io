// ===================================================================
// WIZARDZ 98 — reading a drawing
//
// Nothing here touches the page, so check-sigils.mjs runs the real thing.
//
// The promise: stroke order, stroke direction, size and angle do not count. A
// triangle drawn upside down, backwards, in three pieces, in the corner of a
// phone, is a triangle. A point cloud gets most of that for free. What it
// cannot do on its own is tell shapes apart that put ink in the same places,
// so four opinions sit on top:
//
//   1. the tangent. every point remembers which way the line was going at that
//      point, with no arrowhead. a grid of crosses and a hash then stop matching.
//   2. loops. the ink is rasterised and the enclosed holes counted. a C and an
//      O are one gap apart as clouds and they are different animals to a person.
//   3. corners. a hexagon and a circle sit almost on top of each other, and
//      counting where the hand turned sharply is what separates them.
//   4. how much line, and how much turning. a spiral and a filled-in scribble
//      can have the same cloud.
//
// All four are rotation invariant by construction. The cloud is not, so that
// one gets a search: a coarse sweep of every angle against pre-rotated copies of
// each template, then a fine one round the best two.
//
// There is no maximum lean and no upright. That is why the symbols in
// wizardz-data.js are all different under rotation.
// ===================================================================
(function () {
    'use strict';

    const N = 64;             // points in a cloud
    const ANGLES = 24;        // pre-rotated copies of each template
    const COARSE = 2;         // the sweep looks at every second point
    const SHORTLIST = 12;     // templates that get the expensive match
    const GRID = 56;          // raster the holes are counted on

    // ---------------------------------------------------------------
    // tidying up what the hand did
    // ---------------------------------------------------------------
    function clean(strokes) {
        if (!Array.isArray(strokes)) return [];
        const out = [];
        for (const st of strokes) {
            if (!Array.isArray(st)) continue;
            const pts = [];
            for (const p of st) {
                if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
                const last = pts[pts.length - 1];
                if (last && last.x === p.x && last.y === p.y) continue;
                pts.push({ x: p.x, y: p.y });
            }
            if (pts.length > 1) out.push(pts);
        }
        return out;
    }
    function strokeLength(st) {
        let d = 0;
        for (let i = 1; i < st.length; i++) d += Math.hypot(st[i].x - st[i - 1].x, st[i].y - st[i - 1].y);
        return d;
    }
    function smooth(st) {
        if (st.length < 5) return st;
        const out = new Array(st.length);
        for (let i = 0; i < st.length; i++) {
            const a = st[Math.max(0, i - 1)], b = st[i], c = st[Math.min(st.length - 1, i + 1)];
            out[i] = { x: (a.x + b.x * 2 + c.x) / 4, y: (a.y + b.y * 2 + c.y) / 4 };
        }
        return out;
    }
    // Drop a point every so often along the ink, stroke by stroke. A tap in the
    // middle of a drawing gets a point rather than vanishing.
    function resampleStroke(st, step) {
        const out = [{ x: st[0].x, y: st[0].y }];
        let left = step, prev = st[0];
        for (let i = 1; i < st.length; i++) {
            const cur = st[i];
            let d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
            while (d >= left && d > 1e-9) {
                const t = left / d;
                const q = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
                out.push(q);
                prev = q;
                d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
                left = step;
            }
            left -= d;
            prev = cur;
        }
        return out;
    }

    // ---------------------------------------------------------------
    // the cloud: N points, centred, unit spread, each with an arrowless tangent
    // ---------------------------------------------------------------
    function makeCloud(strokes) {
        const lens = strokes.map(strokeLength);
        const total = lens.reduce((a, b) => a + b, 0);
        if (total < 1e-6) return null;
        const pts = [];
        const step = total / N;
        strokes.forEach(st => {
            const r = resampleStroke(st, step);
            for (let i = 0; i < r.length; i++) {
                const a = r[Math.max(0, i - 1)], b = r[Math.min(r.length - 1, i + 1)];
                const t = Math.atan2(b.y - a.y, b.x - a.x);
                // doubled, so that a line and the same line backwards are one tangent
                pts.push({ x: r[i].x, y: r[i].y, c: Math.cos(2 * t), s: Math.sin(2 * t) });
            }
        });
        // rounding leaves a point or two either side of N
        while (pts.length > N) pts.splice(Math.floor(pts.length * (pts.length - N) / (pts.length + 1)), 1);
        while (pts.length < N) pts.push(Object.assign({}, pts[pts.length - 1]));
        let cx = 0, cy = 0;
        pts.forEach(p => { cx += p.x; cy += p.y; });
        cx /= N; cy /= N;
        let rms = 0;
        pts.forEach(p => { p.x -= cx; p.y -= cy; rms += p.x * p.x + p.y * p.y; });
        rms = Math.sqrt(rms / N) || 1;
        pts.forEach(p => { p.x /= rms; p.y /= rms; });
        return { pts, rms, total };
    }
    function rotated(pts, rad) {
        const c = Math.cos(rad), s = Math.sin(rad), c2 = Math.cos(2 * rad), s2 = Math.sin(2 * rad);
        const out = new Array(pts.length);
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            out[i] = { x: p.x * c - p.y * s, y: p.x * s + p.y * c, c: p.c * c2 - p.s * s2, s: p.s * c2 + p.c * s2 };
        }
        return out;
    }

    // ---------------------------------------------------------------
    // the opinions a cloud cannot have
    // ---------------------------------------------------------------
    // Where the hand turned sharply. Measured over a window a fifth of the way
    // round the shape on each side, so a wobble is not a corner and a rounded
    // corner still is one. Also adds up how much it turned, signed within a
    // stroke, so a spiral and a zigzag are different things.
    function shapeOf(strokes, spread) {
        let corners = 0, winding = 0, wiggle = 0;
        let closedInk = 0, totalInk = 0;
        const span = spread * 0.42;
        for (const raw of strokes) {
            const len = strokeLength(raw);
            totalInk += len;
            if (len < spread * 0.2) continue;
            const pts = resampleStroke(raw, span / 3);
            if (pts.length < 3) continue;
            const closed = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < spread * 0.42;
            if (closed) closedInk += len;
            const n = pts.length, w = 3;
            const angles = [];
            for (let i = 0; i < n; i++) {
                const a = closed ? pts[(i - w + n) % n] : pts[Math.max(0, i - w)];
                const b = closed ? pts[(i + w) % n] : pts[Math.min(n - 1, i + w)];
                const p = pts[i];
                if (!closed && (i < w || i >= n - w)) { angles.push(0); continue; }
                let d = Math.atan2(b.y - p.y, b.x - p.x) - Math.atan2(p.y - a.y, p.x - a.x);
                while (d > Math.PI) d -= 2 * Math.PI;
                while (d < -Math.PI) d += 2 * Math.PI;
                angles.push(d);
            }
            let turning = 0, abs = 0;
            for (let i = 1; i < n; i++) {
                let d = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x) - Math.atan2(pts[i - 1].y - pts[Math.max(0, i - 2)].y, pts[i - 1].x - pts[Math.max(0, i - 2)].x);
                while (d > Math.PI) d -= 2 * Math.PI;
                while (d < -Math.PI) d += 2 * Math.PI;
                if (i > 1) { turning += d; abs += Math.abs(d); }
            }
            winding += Math.abs(turning);
            wiggle += abs;
            // A corner is a peak of turning, over the threshold, with the line going
            // straighter either side of it. A small circle turns hard all the way round
            // and has no corners at all.
            const T = 0.72, DROP = 0.4;
            for (let i = 0; i < n; i++) {
                const v = Math.abs(angles[i]);
                if (v < T) continue;
                let peak = true, low = v;
                for (let k = 1; k <= w * 2; k++) {
                    const l = Math.abs(closed ? angles[(i - k + n) % n] : angles[Math.max(0, i - k)]);
                    const r = Math.abs(closed ? angles[(i + k) % n] : angles[Math.min(n - 1, i + k)]);
                    if (k <= w && (l > v || r > v + 1e-9)) { peak = false; break; }
                    if (l < low) low = l;
                    if (r < low) low = r;
                }
                if (peak && low <= v - DROP) corners++;
            }
        }
        return { corners, winding, wiggle, closed: totalInk ? closedInk / totalInk : 0 };
    }
    // Rasterise and count the holes and the separate pieces. Dilated by a cell so
    // that a circle which stopped a little short of itself still has an inside.
    function topology(strokes, cx, cy, spread) {
        const g = new Uint8Array(GRID * GRID);
        const k = (GRID - 2) / (spread * 4.4);
        const put = (x, y) => {
            const gx = Math.round((x - cx) * k + GRID / 2), gy = Math.round((y - cy) * k + GRID / 2);
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const a = gx + dx, b = gy + dy;
                if (a >= 0 && a < GRID && b >= 0 && b < GRID) g[b * GRID + a] = 1;
            }
        };
        const stepLen = 1 / k / 2;
        for (const st of strokes) {
            for (let i = 1; i < st.length; i++) {
                const a = st[i - 1], b = st[i], d = Math.hypot(b.x - a.x, b.y - a.y);
                const n = Math.max(1, Math.ceil(d / stepLen));
                for (let j = 0; j <= n; j++) put(a.x + (b.x - a.x) * j / n, a.y + (b.y - a.y) * j / n);
            }
        }
        const seen = new Uint8Array(GRID * GRID);
        const stack = [];
        let holes = 0, pieces = 0;
        for (let i = 0; i < g.length; i++) {
            if (seen[i]) continue;
            const ink = g[i];
            let size = 0, border = false;
            stack.length = 0; stack.push(i); seen[i] = 1;
            while (stack.length) {
                const c = stack.pop(); size++;
                const x = c % GRID, y = (c - x) / GRID;
                if (x === 0 || y === 0 || x === GRID - 1 || y === GRID - 1) border = true;
                if (x > 0 && !seen[c - 1] && g[c - 1] === ink) { seen[c - 1] = 1; stack.push(c - 1); }
                if (x < GRID - 1 && !seen[c + 1] && g[c + 1] === ink) { seen[c + 1] = 1; stack.push(c + 1); }
                if (y > 0 && !seen[c - GRID] && g[c - GRID] === ink) { seen[c - GRID] = 1; stack.push(c - GRID); }
                if (y < GRID - 1 && !seen[c + GRID] && g[c + GRID] === ink) { seen[c + GRID] = 1; stack.push(c + GRID); }
            }
            if (ink) { if (size >= 4) pieces++; }
            else if (!border && size >= 12) holes++;
        }
        return { holes, pieces };
    }
    // how far from the middle the ink sits: rotation cannot change this one
    function radialOf(pts) {
        const h = new Float64Array(8);
        for (const p of pts) {
            const r = Math.hypot(p.x, p.y);
            const f = Math.min(7.999, r / 2.4 * 8), i = Math.floor(f), t = f - i;
            h[i] += 1 - t;
            if (i < 7) h[i + 1] += t;
        }
        for (let i = 0; i < 8; i++) h[i] /= pts.length;
        return h;
    }

    function featuresOf(rawStrokes) {
        const tidy = clean(rawStrokes);
        // a tap, or a mouse that twitched
        if (!tidy.length || tidy.reduce((n, st) => n + st.length, 0) < 4) return null;
        const strokes = tidy.map(smooth);
        const cloud = makeCloud(strokes);
        if (!cloud) return null;
        // the unrotated centre, in the drawing's own numbers
        let cx = 0, cy = 0, n = 0;
        strokes.forEach(st => st.forEach(p => { cx += p.x; cy += p.y; n++; }));
        cx /= n; cy /= n;
        const shape = shapeOf(strokes, cloud.rms);
        const topo = topology(strokes, cx, cy, cloud.rms);
        return {
            pts: cloud.pts,
            len: cloud.total / cloud.rms,
            corners: shape.corners,
            winding: shape.winding,
            wiggle: shape.wiggle,
            closed: shape.closed,
            holes: topo.holes,
            pieces: topo.pieces,
            radial: radialOf(cloud.pts)
        };
    }

    // ---------------------------------------------------------------
    // matching
    // ---------------------------------------------------------------
    // Oriented chamfer: how far is every point of one drawing from the nearest
    // point of the other, in both directions, counting a point going the wrong way
    // as further off. $P's one-to-one matching depends on where it starts, which made
    // a perfect drawing score differently at different angles, and it does not earn
    // that here because the ink is evenly spaced already. These run a few hundred
    // thousand times a drawing, so they are flat arrays and no objects.
    const sqrt = Math.sqrt;
    function flat(pts, stride) {
        const n = Math.ceil(pts.length / stride);
        const a = new Float64Array(n * 4);
        for (let i = 0; i < n; i++) {
            const p = pts[i * stride];
            a[i * 4] = p.x; a[i * 4 + 1] = p.y; a[i * 4 + 2] = p.c; a[i * 4 + 3] = p.s;
        }
        return a;
    }
    function oneWay(a, b) {
        let sum = 0;
        const la = a.length, lb = b.length;
        for (let i = 0; i < la; i += 4) {
            const px = a[i], py = a[i + 1], pc = a[i + 2], ps = a[i + 3];
            let best = 1e30;
            for (let o = 0; o < lb; o += 4) {
                const dx = px - b[o], dy = py - b[o + 1];
                const d = dx * dx + dy * dy + COST.tangent * (1 - pc * b[o + 2] - ps * b[o + 3]);
                if (d < best) best = d;
            }
            // 1 - c*c - s*s can round to a hair below zero when a point lands exactly on
            // its match, and the square root of that is NaN, which quietly threw away the
            // best angle of all: a perfect drawing, exactly upright, scored worst
            if (best > 0) sum += sqrt(best);
        }
        return sum * 4 / la;
    }
    // the worse direction counts for more: ink with nothing under it, or a template
    // with a piece missing, is the difference between most pairs of symbols
    function chamfer(a, b) {
        const x = oneWay(a, b), y = oneWay(b, a);
        return x > y ? 0.65 * x + 0.35 * y : 0.35 * x + 0.65 * y;
    }

    // How much each opinion costs, in score. Hand tuned against the confusion
    // matrix in check-sigils.mjs, so change them there and watch what moves.
    const COST = {
        cloud: 1.8, tangent: 0.25,
        hole: 0.11, holeCap: 0.24,
        corner: 0.024, cornerCap: 0.17,
        piece: 0.025, pieceCap: 0.07,
        len: 0.42, lenSlack: 0.1, lenCap: 0.3,
        wind: 0.038, windSlack: 2.0, windCap: 0.2,
        wiggle: 0.016, wiggleSlack: 7, wiggleCap: 0.22,
        closed: 0.11
    };
    function opinion(f, t) {
        let cost = 0;
        cost += Math.min(COST.holeCap, Math.abs(Math.min(3, f.holes) - Math.min(3, t.holes)) * COST.hole);
        cost += Math.min(COST.cornerCap, Math.abs(f.corners - t.corners) * COST.corner);
        cost += Math.min(COST.pieceCap, Math.abs(f.pieces - t.pieces) * COST.piece);
        const lenOff = Math.abs(Math.log(f.len / t.len));
        cost += Math.min(COST.lenCap, Math.max(0, lenOff - COST.lenSlack) * COST.len);
        cost += Math.min(COST.windCap, Math.max(0, Math.abs(f.winding - t.winding) - COST.windSlack) * COST.wind);
        cost += Math.min(COST.wiggleCap, Math.max(0, f.wiggle - t.wiggle - COST.wiggleSlack) * COST.wiggle);
        cost += Math.abs(f.closed - t.closed) * COST.closed;
        return cost;
    }
    function quickDistance(f, t) {
        let d = 0;
        for (let i = 0; i < 8; i++) d += Math.abs(f.radial[i] - t.radial[i]);
        return d * 0.75 + opinion(f, t);
    }

    let TEMPLATES = null;
    function buildTemplates(spells) {
        return spells.map(s => {
            const f = featuresOf(s.glyph);
            const turned = [], coarse = [];
            for (let i = 0; i < ANGLES; i++) {
                const r = rotated(f.pts, i / ANGLES * Math.PI * 2);
                turned.push(r);
                coarse.push(flat(r, COARSE));
            }
            return { id: s.id, spell: s, f, turned, coarse };
        });
    }
    function templates() {
        if (!TEMPLATES) TEMPLATES = buildTemplates(window.WZ.SPELLS);
        return TEMPLATES;
    }

    function scoreAgainst(f, t) {
        // a sweep of every angle, cheaply, on every other point...
        if (!f.coarse) { f.coarse = flat(f.pts, COARSE); f.fine = flat(f.pts, 1); }
        let first = Infinity, second = Infinity, fi = 0, si = 0;
        for (let i = 0; i < ANGLES; i++) {
            const d = chamfer(f.coarse, t.coarse[i]);
            if (d < first) { second = first; si = fi; first = d; fi = i; }
            else if (d < second) { second = d; si = i; }
        }
        // ...then properly, round the two best
        let best = Infinity, at = null;
        const fine = Math.PI * 2 / ANGLES / 3;
        for (const base of [fi, si]) {
            for (const off of [-1, 0, 1]) {
                const pts = off === 0 ? t.turned[base] : rotated(t.turned[base], off * fine);
                const d = chamfer(f.fine, flat(pts, 1));
                if (d < best) { best = d; at = pts; }
            }
        }
        // and once more either side of the winner, so that no angle falls between two looks
        for (const off of [-0.5, 0.5]) {
            const d = chamfer(f.fine, flat(rotated(at, off * fine), 1));
            if (d < best) best = d;
        }
        return Math.max(0, 1 - best * COST.cloud) - opinion(f, t.f);
    }

    function recognize(strokes, pool) {
        const f = featuresOf(strokes);
        if (!f || f.len < 1) return [];
        const list = templates();
        const inPool = pool ? new Set(pool) : null;
        const ranked = list.map(t => ({ t, q: quickDistance(f, t.f) })).sort((a, b) => a.q - b.q);
        const picked = ranked.slice(0, SHORTLIST);
        if (inPool) ranked.slice(SHORTLIST).forEach(r => { if (inPool.has(r.t.id)) picked.push(r); });
        return picked.map(r => ({ id: r.t.id, spell: r.t.spell, score: scoreAgainst(f, r.t) }))
            .sort((a, b) => b.score - a.score);
    }

    // A drawing has to clear the floor and beat the runner up, or it is a fizzle
    // and you are told what it looked like. How clean it was sets its power.
    const CAST_FLOOR = 0.5;
    const CAST_MARGIN = 0.05;
    const CLEAN = 0.8;
    const qualityOf = score => Math.max(0, Math.min(1, (score - CAST_FLOOR) / (CLEAN - CAST_FLOOR)));

    // what the game does with a drawing, given what you brought to the match:
    //   { ok, id, spell, q }                 cast it
    //   { ok: false, why: 'rough', id }      too far from anything
    //   { ok: false, why: 'split', id, id2 } between two
    //   { ok: false, why: 'book', id }       a real sigil, but not one you packed
    //   { ok: false, why: 'nothing' }        a dot, a tap
    function decide(strokes, pool) {
        const res = recognize(strokes, pool);
        if (!res.length) return { ok: false, why: 'nothing' };
        const top = res[0];
        const verdict = judge(res, pool);
        verdict.top = top.id;
        return verdict;
    }
    function judge(res, pool) {
        const top = res[0];
        const set = pool ? new Set(pool) : null;
        const mine = set ? res.filter(r => set.has(r.id)) : res;
        if (set && !set.has(top.id) && top.score >= CAST_FLOOR && (!mine[0] || top.score - mine[0].score > 0.05)) {
            return { ok: false, why: 'book', id: top.id, spell: top.spell, score: top.score };
        }
        const best = mine[0];
        if (!best || best.score < CAST_FLOOR) return { ok: false, why: 'rough', id: top.id, spell: top.spell, score: top.score };
        const next = mine[1];
        if (next && best.score - next.score < CAST_MARGIN) {
            return { ok: false, why: 'split', id: best.id, spell: best.spell, id2: next.id, spell2: next.spell, score: best.score };
        }
        return { ok: true, id: best.id, spell: best.spell, score: best.score, q: qualityOf(best.score) };
    }

    window.WZ_SIGIL = {
        recognize, decide, featuresOf, templates, scoreAgainst, qualityOf,
        CAST_FLOOR, CAST_MARGIN, CLEAN, COST, N
    };
})();
