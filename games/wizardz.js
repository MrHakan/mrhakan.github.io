// ===================================================================
// WIZARDZ 98 — engine
//
// A 1v1 duel where the only way to cast anything is to draw its sigil
// on the arena with the mouse. Fifty sigils, fifty spells, one wizard
// each, and whoever runs out of health first has to explain it in the
// guestbook.
//
// Three moving parts:
//   1. the recogniser — $P point-cloud matching plus a coarse ink grid,
//      because $P alone thinks every round shape is every other one.
//   2. the duel — a plain fixed-step simulation. the host runs it and
//      ships snapshots; the guest sends the two things it knows (which
//      way it is moving, and what it just drew).
//   3. the wizard — every hat, beard and familiar is drawn in code, so
//      an avatar is 14 short strings and travels with the lobby.
//
// Content lives in wizardz-data.js. Lobbies live in netplay.js.
// ===================================================================
(function () {
    'use strict';

    const D = window.WZ;
    if (!D) { console.warn('[wizardz] data file missing'); return; }
    const A = D.ARENA;

    // ===============================================================
    // 1. THE RECOGNISER
    // ===============================================================
    const RES = 32;   // points every gesture is resampled to
    const GRID = 10;  // ink grid is GRID x GRID

    function flattenStrokes(strokes) {
        const pts = [];
        strokes.forEach((s, i) => s.forEach(p => pts.push({ x: p.x, y: p.y, id: i })));
        return pts;
    }
    function pathLength(pts) {
        let d = 0;
        for (let i = 1; i < pts.length; i++) {
            if (pts[i].id === pts[i - 1].id) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        }
        return d;
    }
    // walk the whole gesture and drop a point every 1/n of its length
    function resample(pts, n) {
        const I = pathLength(pts) / (n - 1);
        let D_ = 0;
        const out = [{ x: pts[0].x, y: pts[0].y, id: pts[0].id }];
        const src = pts.slice();
        for (let i = 1; i < src.length; i++) {
            if (src[i].id !== src[i - 1].id) continue;
            const d = Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y);
            if (D_ + d >= I) {
                const t = Math.min(Math.max((I - D_) / (d || 1), 0), 1);
                const q = {
                    x: src[i - 1].x + t * (src[i].x - src[i - 1].x),
                    y: src[i - 1].y + t * (src[i].y - src[i - 1].y),
                    id: src[i].id
                };
                out.push(q);
                src.splice(i, 0, q);
                D_ = 0;
            } else D_ += d;
        }
        while (out.length < n) out.push(Object.assign({}, out[out.length - 1]));
        return out.slice(0, n);
    }
    // uniform scale on purpose — a wide rectangle must not become a square
    function scaleToBox(pts) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        pts.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
        const size = Math.max(maxX - minX, maxY - minY) || 1;
        return pts.map(p => ({ x: (p.x - minX) / size, y: (p.y - minY) / size, id: p.id }));
    }
    function toCentroid(pts) {
        let cx = 0, cy = 0;
        pts.forEach(p => { cx += p.x; cy += p.y; });
        cx /= pts.length; cy /= pts.length;
        return pts.map(p => ({ x: p.x - cx, y: p.y - cy, id: p.id }));
    }
    function normalize(strokes) { return toCentroid(scaleToBox(resample(flattenStrokes(strokes), RES))); }

    // where the ink sits, blurred, as a unit vector
    function inkGrid(pts) {
        const g = new Float64Array(GRID * GRID);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        pts.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
        const size = Math.max(maxX - minX, maxY - minY) || 1;
        const ox = (size - (maxX - minX)) / 2, oy = (size - (maxY - minY)) / 2;
        pts.forEach(p => {
            const gx = ((p.x - minX + ox) / size) * (GRID - 1), gy = ((p.y - minY + oy) / size) * (GRID - 1);
            const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
            const add = (x, y, w) => { if (x >= 0 && x < GRID && y >= 0 && y < GRID) g[y * GRID + x] += w; };
            add(x0, y0, (1 - fx) * (1 - fy)); add(x0 + 1, y0, fx * (1 - fy));
            add(x0, y0 + 1, (1 - fx) * fy); add(x0 + 1, y0 + 1, fx * fy);
        });
        const b = new Float64Array(GRID * GRID);
        for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
            let sum = 0, wsum = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) continue;
                const w = dx || dy ? 0.5 : 1;
                sum += g[ny * GRID + nx] * w; wsum += w;
            }
            b[y * GRID + x] = sum / wsum;
        }
        let norm = 0;
        for (let i = 0; i < b.length; i++) norm += b[i] * b[i];
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < b.length; i++) b[i] /= norm;
        return b;
    }
    function cloudDistance(p1, p2, start) {
        const n = p1.length;
        const matched = new Array(n).fill(false);
        let sum = 0, i = start;
        do {
            let best = Infinity, index = -1;
            for (let j = 0; j < n; j++) {
                if (matched[j]) continue;
                const d = Math.hypot(p1[i].x - p2[j].x, p1[i].y - p2[j].y);
                if (d < best) { best = d; index = j; }
            }
            matched[index] = true;
            sum += (1 - ((i - start + n) % n) / n) * best;
            i = (i + 1) % n;
        } while (i !== start);
        return sum;
    }
    function greedyMatch(p1, p2) {
        const n = p1.length;
        const step = Math.max(1, Math.floor(n / 8));
        let min = Infinity;
        for (let i = 0; i < n; i += step) min = Math.min(min, cloudDistance(p1, p2, i), cloudDistance(p2, p1, i));
        return min;
    }
    const cloudScore = d => Math.max((2.0 - d) / 2.0, 0);
    function inkLength(pts) {
        let d = 0;
        for (let i = 1; i < pts.length; i++) {
            if (pts[i].id === pts[i - 1].id) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        }
        return d;
    }
    function featuresOf(strokes) {
        const c = normalize(strokes);
        return { cloud: c, grid: inkGrid(c), len: inkLength(c) };
    }
    function similarity(a, b) {
        const p = cloudScore(greedyMatch(a.cloud, b.cloud));
        const q = gridSim(a.grid, b.grid);
        // the point cloud and the ink grid both only care where the ink
        // is, not how much of it there is, so a scribble that happens to
        // cover the right area scores well. this notices that it used
        // three times the line to get there.
        const ratio = Math.abs(Math.log((a.len || 0.001) / (b.len || 0.001)));
        const overdrawn = Math.min(0.3, Math.max(0, ratio - 0.22) * 0.5);
        return 0.5 * p + 0.5 * q * q - overdrawn;
    }

    let TEMPLATES = null;
    function templates() {
        if (!TEMPLATES) TEMPLATES = D.SPELLS.map(s => ({ id: s.id, spell: s, f: featuresOf(s.glyph) }));
        return TEMPLATES;
    }

    // ---------------------------------------------------------------
    // making sense of a real hand
    //
    // Nobody draws upright. A triangle sketched at a twenty degree lean
    // is still a triangle to a person, and used to be a coin flip to the
    // recogniser, so the input is matched at a few small rotations and
    // the best one wins. The tilt is capped on purpose: at ninety
    // degrees an arrow up is an arrow right, and at a hundred and eighty
    // fireball is frostbolt.
    // ---------------------------------------------------------------
    const TILTS = [-18, -9, 0, 9, 18];   // degrees searched
    const SHORTLIST = 12;                 // templates that get the expensive match
    const TILT_COST = 0.022;              // per 9°, so upright still wins ties

    // a trackpad emits a shaky line and a touchscreen emits a shakier
    // one; three-point smoothing costs nothing and removes both
    function smoothStrokes(strokes) {
        return strokes.map(st => {
            if (st.length < 5) return st;
            const out = new Array(st.length);
            for (let i = 0; i < st.length; i++) {
                const a = st[Math.max(0, i - 1)], b = st[i], c = st[Math.min(st.length - 1, i + 1)];
                out[i] = { x: (a.x + b.x * 2 + c.x) / 4, y: (a.y + b.y * 2 + c.y) / 4 };
            }
            return out;
        });
    }
    function rotateStrokes(strokes, deg) {
        if (!deg) return strokes;
        const a = deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
        let cx = 0, cy = 0, n = 0;
        strokes.forEach(s => s.forEach(p => { cx += p.x; cy += p.y; n++; }));
        cx /= n || 1; cy /= n || 1;
        return strokes.map(s => s.map(p => {
            const x = p.x - cx, y = p.y - cy;
            return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
        }));
    }
    function gridSim(a, b) {
        let q = 0;
        for (let i = 0; i < a.length; i++) q += a[i] * b[i];
        return Math.max(0, q);
    }

    // A sigil has to beat this to go off, and beat the runner up by the
    // margin, or you get a fizzle and a note about what it looked like.
    // Both numbers come from sweeping them against six hundred drawn
    // sigils and three hundred scribbles: this pair casts 97% of real
    // drawings, never once cast the *wrong* spell, and turns away all
    // but a few percent of panic scribbling.
    const CAST_FLOOR = 0.66;
    const CAST_MARGIN = 0.05;
    function recognize(strokes, pool) {
        if (!strokes.length || flattenStrokes(strokes).length < 4) return [];
        const clean = smoothStrokes(strokes);
        const list = (pool || templates());
        // the same gesture, leaning a few different ways
        const variants = TILTS.map(deg => ({
            f: featuresOf(rotateStrokes(clean, deg)),
            penalty: Math.abs(deg) / 9 * TILT_COST
        }));
        // stage one: the ink grid is a hundred multiplications, so it is
        // cheap enough to ask all fifty templates which are worth a
        // proper look
        const shortlist = list.map(t => {
            let g = 0;
            for (const v of variants) g = Math.max(g, gridSim(v.f.grid, t.f.grid));
            return { t, g };
        }).sort((a, b) => b.g - a.g).slice(0, SHORTLIST);
        // stage two: full point-cloud matching, but only on the few that
        // could plausibly win
        return shortlist.map(({ t }) => {
            let best = 0;
            for (const v of variants) best = Math.max(best, similarity(v.f, t.f) - v.penalty);
            return { id: t.id, spell: t.spell, score: best };
        }).sort((a, b) => b.score - a.score).slice(0, 4);
    }
    // how well you drew it, 0..1, feeds straight into spell power
    const qualityOf = score => Math.max(0, Math.min(1, (score - CAST_FLOOR) / 0.22));

    // ===============================================================
    // 2. THE WIZARD — everything drawn in code
    // ===============================================================
    // the plain wizard everything else is measured against. it has to be
    // fixed rather than random: both machines draw both wizards, so a
    // missing hat must come out the same colour on either screen.
    const BASE_AVATAR = {
        skin: D.AVATAR.skin[0], hat: 'pointy', hatColor: D.AVATAR.palette[0],
        hair: 'none', hairColor: D.AVATAR.palette[9], beard: 'long',
        robe: 'plain', robeColor: D.AVATAR.palette[0], trimColor: D.AVATAR.palette[4],
        staff: 'gnarled', familiar: 'none', aura: 'none', eyes: 'normal', title: 'apprentice'
    };
    // an opponent who never opened the dressing room still needs a face,
    // and it has to be the same face on both screens — so it comes from
    // their player id rather than from Math.random.
    function seededAvatar(seed) {
        let h = 2166136261;
        const s = String(seed || 'wizard');
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        const rnd = () => {
            h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13;
            return ((h >>> 0) % 100003) / 100003;
        };
        const pick = a => a[Math.floor(rnd() * a.length) % a.length];
        return {
            skin: pick(D.AVATAR.skin), hat: pick(D.AVATAR.hat), hatColor: pick(D.AVATAR.palette),
            hair: pick(D.AVATAR.hair), hairColor: pick(D.AVATAR.palette), beard: pick(D.AVATAR.beard),
            robe: pick(D.AVATAR.robe), robeColor: pick(D.AVATAR.palette), trimColor: pick(D.AVATAR.palette),
            staff: pick(D.AVATAR.staff), familiar: pick(D.AVATAR.familiar), aura: pick(D.AVATAR.aura),
            eyes: pick(D.AVATAR.eyes), title: pick(D.AVATAR.titles)
        };
    }
    function normAvatar(av) {
        const a = Object.assign({}, BASE_AVATAR, av || {});
        // keep unknown values out of the renderer
        const clamp = (v, list, def) => list.indexOf(v) >= 0 ? v : def;
        a.hat = clamp(a.hat, D.AVATAR.hat, 'pointy');
        a.hair = clamp(a.hair, D.AVATAR.hair, 'none');
        a.beard = clamp(a.beard, D.AVATAR.beard, 'none');
        a.robe = clamp(a.robe, D.AVATAR.robe, 'plain');
        a.staff = clamp(a.staff, D.AVATAR.staff, 'gnarled');
        a.familiar = clamp(a.familiar, D.AVATAR.familiar, 'none');
        a.aura = clamp(a.aura, D.AVATAR.aura, 'none');
        a.eyes = clamp(a.eyes, D.AVATAR.eyes, 'normal');
        return a;
    }
    const shade = (hex, amt) => {
        const h = String(hex || '#888').replace('#', '');
        const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
        const cl = v => Math.max(0, Math.min(255, v));
        const r = cl((n >> 16) + amt), g = cl(((n >> 8) & 255) + amt), b = cl((n & 255) + amt);
        return `rgb(${r},${g},${b})`;
    };

    // draws a wizard whose feet are at (x, y), roughly 76 units tall at scale 1
    function drawWizard(ctx, avatar, x, y, scale, opts) {
        const a = normAvatar(avatar);
        opts = opts || {};
        const t = opts.time || 0;
        const face = opts.face || 1;           // 1 = looking right
        const bob = Math.sin(t * 2.2) * 1.6 * scale;
        ctx.save();
        ctx.translate(x, y + bob);
        ctx.scale(scale * face, scale);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        if (a.aura !== 'none') drawAura(ctx, a.aura, t, opts.casting);
        if (opts.shielded) {
            ctx.save();
            ctx.strokeStyle = 'rgba(160,220,255,' + (0.5 + Math.sin(t * 6) * 0.15) + ')';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.ellipse(0, -34, 34, 44, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
        }

        // ---- robe ----
        const robe = a.robeColor, trim = a.trimColor;
        ctx.fillStyle = robe;
        ctx.beginPath();
        ctx.moveTo(-9, -52); ctx.lineTo(9, -52);
        if (a.robe === 'ragged') {
            ctx.lineTo(20, 0); ctx.lineTo(14, -6); ctx.lineTo(8, 2); ctx.lineTo(0, -6);
            ctx.lineTo(-8, 2); ctx.lineTo(-14, -6); ctx.lineTo(-20, 0);
        } else {
            ctx.lineTo(a.robe === 'layered' ? 22 : 18, 0); ctx.lineTo(a.robe === 'layered' ? -22 : -18, 0);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = shade(robe, -60); ctx.lineWidth = 1.5; ctx.stroke();

        if (a.robe === 'trim' || a.robe === 'cloak') {
            ctx.strokeStyle = trim; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(-16, -4); ctx.lineTo(16, -4); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(0, -8); ctx.stroke();
        }
        if (a.robe === 'patched') {
            ctx.fillStyle = trim;
            ctx.fillRect(-12, -34, 8, 8); ctx.fillRect(4, -20, 7, 7);
        }
        if (a.robe === 'layered') {
            ctx.strokeStyle = shade(robe, 40); ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-19, -14); ctx.lineTo(19, -14); ctx.stroke();
        }
        if (a.robe === 'cloak') {
            ctx.fillStyle = shade(robe, -50);
            ctx.beginPath();
            ctx.moveTo(-10, -54); ctx.quadraticCurveTo(-26, -30, -20, -2);
            ctx.lineTo(-12, -4); ctx.quadraticCurveTo(-16, -30, -6, -50);
            ctx.closePath(); ctx.fill();
        }

        // ---- arms: the casting one swings up ----
        ctx.strokeStyle = a.skin; ctx.lineWidth = 5;
        const cast = Math.max(0, Math.min(1, opts.casting || 0));
        ctx.beginPath(); ctx.moveTo(6, -44); ctx.lineTo(14 + cast * 6, -30 - cast * 22); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-6, -44); ctx.lineTo(-13, -26); ctx.stroke();

        // ---- head ----
        ctx.fillStyle = a.skin;
        ctx.beginPath(); ctx.arc(0, -62, 12, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = shade(a.skin, -70); ctx.lineWidth = 1; ctx.stroke();

        drawEyes(ctx, a);
        drawHair(ctx, a);
        drawBeard(ctx, a);
        drawHat(ctx, a);
        drawStaff(ctx, a, t, cast);
        ctx.restore();
        // the familiar keeps its own upright orientation, and floats wide
        // enough not to sit on top of the staff's business end
        if (a.familiar !== 'none') {
            ctx.save();
            ctx.translate(x + face * 46 * scale, y + bob - 80 * scale + Math.sin(t * 3) * 3 * scale);
            ctx.scale(scale * face, scale);
            drawFamiliar(ctx, a, t);
            ctx.restore();
        }
    }
    function drawEyes(ctx, a) {
        ctx.fillStyle = '#101018';
        if (a.eyes === 'cyclops') {
            ctx.beginPath(); ctx.arc(2, -64, 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(3, -65, 1.4, 0, Math.PI * 2); ctx.fill();
            return;
        }
        if (a.eyes === 'glowing') {
            ctx.fillStyle = '#8ef2ff';
            ctx.shadowColor = '#8ef2ff'; ctx.shadowBlur = 8;
        }
        const ey = a.eyes === 'tired' ? -63 : -64;
        ctx.fillRect(-6, ey, 3, a.eyes === 'tired' ? 1.5 : 3);
        ctx.fillRect(3, ey, 3, a.eyes === 'tired' ? 1.5 : 3);
        ctx.shadowBlur = 0;
        if (a.eyes === 'angry') {
            ctx.strokeStyle = '#101018'; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(-8, -68); ctx.lineTo(-2, -66); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(8, -68); ctx.lineTo(2, -66); ctx.stroke();
        }
    }
    function drawHair(ctx, a) {
        if (a.hair === 'none') return;
        ctx.fillStyle = a.hairColor;
        if (a.hair === 'short') { ctx.beginPath(); ctx.arc(0, -66, 12, Math.PI, Math.PI * 2); ctx.fill(); }
        if (a.hair === 'long') {
            ctx.beginPath(); ctx.arc(0, -66, 12, Math.PI, Math.PI * 2); ctx.fill();
            ctx.fillRect(-13, -66, 4, 22); ctx.fillRect(9, -66, 4, 22);
        }
        if (a.hair === 'mohawk') { ctx.fillRect(-2, -82, 5, 16); }
    }
    function drawBeard(ctx, a) {
        if (a.beard === 'none') return;
        ctx.fillStyle = a.hairColor || '#ddd';
        switch (a.beard) {
            case 'stubble':
                ctx.globalAlpha = 0.45;
                ctx.beginPath(); ctx.arc(0, -56, 10, 0, Math.PI); ctx.fill();
                ctx.globalAlpha = 1; break;
            case 'goatee':
                ctx.beginPath(); ctx.moveTo(-4, -55); ctx.lineTo(4, -55); ctx.lineTo(0, -44); ctx.closePath(); ctx.fill(); break;
            case 'long':
                ctx.beginPath(); ctx.moveTo(-9, -58); ctx.lineTo(9, -58); ctx.lineTo(4, -30); ctx.lineTo(-4, -30); ctx.closePath(); ctx.fill(); break;
            case 'braided':
                ctx.beginPath(); ctx.moveTo(-9, -58); ctx.lineTo(9, -58); ctx.lineTo(3, -34); ctx.lineTo(-3, -34); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = shade(a.hairColor, -50); ctx.lineWidth = 1.4;
                for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-7 + i, -50 + i * 6); ctx.lineTo(7 - i, -50 + i * 6); ctx.stroke(); }
                break;
            case 'huge':
                ctx.beginPath(); ctx.moveTo(-13, -60); ctx.quadraticCurveTo(-16, -22, 0, -20);
                ctx.quadraticCurveTo(16, -22, 13, -60); ctx.closePath(); ctx.fill(); break;
        }
    }
    function drawHat(ctx, a) {
        if (a.hat === 'bald') return;
        ctx.fillStyle = a.hatColor;
        ctx.strokeStyle = shade(a.hatColor, -70);
        ctx.lineWidth = 1.4;
        switch (a.hat) {
            case 'pointy':
                ctx.beginPath(); ctx.moveTo(-14, -70); ctx.lineTo(14, -70); ctx.lineTo(3, -102); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillRect(-17, -73, 34, 5); break;
            case 'wide':
                ctx.beginPath(); ctx.ellipse(0, -71, 24, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-11, -71); ctx.lineTo(11, -71); ctx.lineTo(8, -88); ctx.lineTo(-8, -88); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
            case 'hood':
                ctx.beginPath(); ctx.moveTo(-15, -52); ctx.quadraticCurveTo(-18, -84, 0, -84);
                ctx.quadraticCurveTo(18, -84, 15, -52); ctx.lineTo(11, -54);
                ctx.quadraticCurveTo(13, -76, 0, -76); ctx.quadraticCurveTo(-13, -76, -11, -54);
                ctx.closePath(); ctx.fill(); ctx.stroke(); break;
            case 'crown':
                ctx.beginPath();
                ctx.moveTo(-13, -70); ctx.lineTo(-13, -82); ctx.lineTo(-7, -76); ctx.lineTo(0, -84);
                ctx.lineTo(7, -76); ctx.lineTo(13, -82); ctx.lineTo(13, -70);
                ctx.closePath(); ctx.fill(); ctx.stroke(); break;
            case 'horned':
                ctx.beginPath(); ctx.moveTo(-12, -70); ctx.lineTo(12, -70); ctx.lineTo(0, -84); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-11, -74); ctx.quadraticCurveTo(-22, -84, -16, -94); ctx.lineTo(-11, -84); ctx.closePath(); ctx.fill();
                ctx.beginPath(); ctx.moveTo(11, -74); ctx.quadraticCurveTo(22, -84, 16, -94); ctx.lineTo(11, -84); ctx.closePath(); ctx.fill(); break;
        }
    }
    function drawStaff(ctx, a, t, cast) {
        if (a.staff === 'none') return;
        const sway = Math.sin(t * 2) * 2 + cast * 10;
        ctx.save();
        ctx.translate(18, -30);
        ctx.rotate((-6 - sway) * Math.PI / 180);
        ctx.strokeStyle = '#7a4a24'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(0, -34); ctx.stroke();
        const top = -34;
        switch (a.staff) {
            case 'gnarled':
                ctx.strokeStyle = '#7a4a24'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(0, top); ctx.quadraticCurveTo(8, top - 6, 2, top - 12); ctx.stroke(); break;
            case 'crystal':
                ctx.fillStyle = a.hatColor;
                ctx.beginPath(); ctx.moveTo(0, top - 14); ctx.lineTo(6, top - 4); ctx.lineTo(0, top + 4); ctx.lineTo(-6, top - 4);
                ctx.closePath(); ctx.fill(); break;
            case 'skull':
                ctx.fillStyle = '#e8e6df';
                ctx.beginPath(); ctx.arc(0, top - 5, 6, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#222'; ctx.fillRect(-3.5, top - 7, 2.5, 3); ctx.fillRect(1, top - 7, 2.5, 3); break;
            case 'orb':
                ctx.fillStyle = a.trimColor; ctx.globalAlpha = 0.9;
                ctx.beginPath(); ctx.arc(0, top - 6, 7, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.beginPath(); ctx.arc(-2, top - 8, 2, 0, Math.PI * 2); ctx.fill(); break;
            case 'broom':
                ctx.strokeStyle = '#c8a06a'; ctx.lineWidth = 1.4;
                for (let i = -4; i <= 4; i += 2) {
                    ctx.beginPath(); ctx.moveTo(0, top + 2); ctx.lineTo(i, top - 12); ctx.stroke();
                }
                break;
        }
        ctx.restore();
    }
    function drawFamiliar(ctx, a, t) {
        const c = a.trimColor;
        ctx.fillStyle = '#2a2a34';
        switch (a.familiar) {
            case 'cat':
                ctx.beginPath(); ctx.ellipse(0, 0, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(7, -4, 5, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.moveTo(4, -8); ctx.lineTo(6, -13); ctx.lineTo(8, -8); ctx.closePath(); ctx.fill();
                ctx.beginPath(); ctx.moveTo(9, -8); ctx.lineTo(11, -13); ctx.lineTo(12, -8); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = '#2a2a34'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(-8, -1); ctx.quadraticCurveTo(-16, -4, -13, -10); ctx.stroke();
                ctx.fillStyle = '#ffe14d'; ctx.fillRect(7, -5, 2, 2); break;
            case 'owl':
                ctx.fillStyle = '#8a6f4a';
                ctx.beginPath(); ctx.ellipse(0, 0, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(-3, -4, 3, 0, Math.PI * 2); ctx.arc(3, -4, 3, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#101018';
                ctx.beginPath(); ctx.arc(-3, -4, 1.4, 0, Math.PI * 2); ctx.arc(3, -4, 1.4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#ffb400';
                ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(2, 1); ctx.lineTo(-2, 1); ctx.closePath(); ctx.fill(); break;
            case 'bat':
                ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
                const flap = Math.sin(t * 12) * 4;
                ctx.beginPath(); ctx.moveTo(-4, 0); ctx.quadraticCurveTo(-14, -6 + flap, -18, 2); ctx.quadraticCurveTo(-12, 0, -4, 4); ctx.fill();
                ctx.beginPath(); ctx.moveTo(4, 0); ctx.quadraticCurveTo(14, -6 + flap, 18, 2); ctx.quadraticCurveTo(12, 0, 4, 4); ctx.fill(); break;
            case 'frog':
                ctx.fillStyle = '#4fae4a';
                ctx.beginPath(); ctx.ellipse(0, 2, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(-4, -4, 3.4, 0, Math.PI * 2); ctx.arc(4, -4, 3.4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#101018';
                ctx.beginPath(); ctx.arc(-4, -4, 1.5, 0, Math.PI * 2); ctx.arc(4, -4, 1.5, 0, Math.PI * 2); ctx.fill(); break;
            case 'imp':
                ctx.fillStyle = c;
                ctx.beginPath(); ctx.ellipse(0, 0, 7, 8, 0, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(-9, -13); ctx.lineTo(-2, -8); ctx.closePath(); ctx.fill();
                ctx.beginPath(); ctx.moveTo(6, -6); ctx.lineTo(9, -13); ctx.lineTo(2, -8); ctx.closePath(); ctx.fill();
                ctx.fillStyle = '#101018'; ctx.fillRect(-4, -3, 2, 2); ctx.fillRect(2, -3, 2, 2); break;
        }
    }
    function drawAura(ctx, kind, t, casting) {
        const colors = { sparks: '#ffe14d', flames: '#ff6b2b', frost: '#6fd6ff', shadow: '#a074d8', holy: '#fffbe8' };
        const c = colors[kind] || '#fff';
        ctx.save();
        ctx.globalAlpha = 0.55 + (casting || 0) * 0.35;
        for (let i = 0; i < 7; i++) {
            const a = t * 1.5 + i * (Math.PI * 2 / 7);
            const r = 26 + Math.sin(t * 3 + i) * 5;
            const x = Math.cos(a) * r, y = -34 + Math.sin(a) * r * 0.8;
            ctx.fillStyle = c;
            ctx.beginPath(); ctx.arc(x, y, kind === 'flames' ? 3.5 : 2.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    // used by the lobby to draw everybody's wizard on a small canvas
    function paintAvatar(canvas, avatar, opts) {
        if (!canvas || !canvas.getContext) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const scale = (h / 110) * ((opts && opts.scale) || 1);
        drawWizard(ctx, avatar, w / 2, h - 6, scale, { time: performance.now() / 1000, face: 1 });
    }

    // ===============================================================
    // 3. LOCAL PREFERENCES
    // ===============================================================
    const LS = {
        avatar: 'mrhakan98-wizardz-avatar',
        loadout: 'mrhakan98-wizardz-loadout',
        diff: 'mrhakan98-wizardz-difficulty'
    };
    function myAvatar() {
        const prof = window.Netplay ? Netplay.profile() : null;
        if (prof && prof.avatar) return normAvatar(prof.avatar);
        let a = null;
        try { a = JSON.parse(localStorage.getItem(LS.avatar) || 'null'); } catch (e) { }
        if (!a) a = D.randomAvatar();
        // push it into the netplay profile too, so the lobby and the
        // other player see the same wizard you do
        saveAvatar(a);
        return normAvatar(a);
    }
    function saveAvatar(a) {
        try { localStorage.setItem(LS.avatar, JSON.stringify(a)); } catch (e) { }
        if (window.Netplay) Netplay.setAvatar(a);
    }
    function myLoadout() {
        let l = null;
        try { l = JSON.parse(localStorage.getItem(LS.loadout) || 'null'); } catch (e) { }
        if (!Array.isArray(l) || l.length !== 8 || l.some(id => !D.byId(id))) l = D.DEFAULT_LOADOUT.slice();
        return l;
    }
    function saveLoadout(l) { try { localStorage.setItem(LS.loadout, JSON.stringify(l)); } catch (e) { } }
    const difficulty = () => localStorage.getItem(LS.diff) || 'normal';

    // ===============================================================
    // 4. SOUND — synthesised, follows the site's mute button
    // ===============================================================
    let actx = null;
    function audio() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!actx) actx = new AC();
        if (actx.state === 'suspended') actx.resume().catch(() => { });
        return actx;
    }
    const soundOn = () => typeof soundEnabled === 'undefined' ? true : soundEnabled;
    function tone(freq, dur, o) {
        if (!soundOn()) return;
        const ctx = audio();
        if (!ctx) return;
        o = o || {};
        try {
            const t0 = ctx.currentTime + (o.delay || 0);
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.type = o.type || 'square';
            osc.frequency.setValueAtTime(Math.max(1, freq), t0);
            if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t0 + dur);
            const peak = o.gain !== undefined ? o.gain : 0.05;
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur / 3));
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(t0); osc.stop(t0 + dur + 0.02);
        } catch (e) { }
    }
    function noise(dur, o) {
        if (!soundOn()) return;
        const ctx = audio();
        if (!ctx) return;
        o = o || {};
        try {
            const t0 = ctx.currentTime + (o.delay || 0);
            const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
            const buf = ctx.createBuffer(1, n, ctx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
            const src = ctx.createBufferSource(); src.buffer = buf;
            const f = ctx.createBiquadFilter(); f.type = o.filter || 'lowpass';
            f.frequency.value = o.freq || 900;
            const g = ctx.createGain(); g.gain.value = o.gain === undefined ? 0.06 : o.gain;
            src.connect(f); f.connect(g); g.connect(ctx.destination);
            src.start(t0); src.stop(t0 + dur);
        } catch (e) { }
    }
    const SFX = {
        cast: el => tone(el === 'ice' ? 900 : 520, 0.14, { type: 'triangle', slideTo: 1200, gain: 0.045 }),
        fizzle: () => tone(220, 0.16, { type: 'sawtooth', slideTo: 90, gain: 0.035 }),
        hit: () => { noise(0.14, { freq: 1400, gain: 0.05 }); tone(180, 0.1, { type: 'square', slideTo: 70, gain: 0.04 }); },
        ward: () => tone(700, 0.2, { type: 'sine', slideTo: 980, gain: 0.04 }),
        heal: () => { tone(660, 0.12, { type: 'sine' }); tone(880, 0.14, { type: 'sine', delay: 0.1 }); },
        die: () => { tone(300, 0.5, { type: 'sawtooth', slideTo: 60, gain: 0.06 }); noise(0.4, { freq: 500 }); },
        win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, { type: 'square', delay: i * 0.11, gain: 0.05 })),
        tick: () => tone(880, 0.06, { type: 'square', gain: 0.03 })
    };

    // ===============================================================
    // 5. THE DUEL
    // ===============================================================
    let G = null;          // active duel
    let raf = null, lastT = 0;
    let root = null;       // window body
    let cv = null, ctx = null;

    function newWizard(idx, player) {
        return {
            idx,
            id: player.id,
            name: player.name || 'wizard',
            avatar: normAvatar(player.avatar || seededAvatar(player.id)),
            home: idx === 0 ? A.leftX : A.rightX,
            x: idx === 0 ? A.leftX : A.rightX,
            y: (A.ceil + A.floor) / 2,
            vy: 0,
            hp: A.maxHp, mana: A.maxMana, ward: 0, wardT: 0,
            st: {},                 // statuses -> {t, ...}
            cd: {},                 // spell id -> seconds remaining
            castT: 0,               // casting animation
            hitT: 0,
            face: idx === 0 ? 1 : -1,
            bot: !!player.bot,
            dead: false
        };
    }

    function makeDuel(session, opts) {
        const solo = !!(opts && opts.solo) || (session && session.solo);
        const bot = solo ? (D.botById(opts && opts.botId) || randomBot()) : null;
        const players = solo
            ? [{ id: 'me', name: (window.Netplay ? Netplay.profile().name : 'you'), avatar: myAvatar() },
            { id: 'bot', name: bot.name, avatar: bot.avatar, bot: true }]
            : orderPlayers(session, opts);
        const g = {
            session, solo, bot,
            isHost: solo ? true : !!session.isHost,
            me: 0,
            wiz: [newWizard(0, players[0]), newWizard(1, players[1])],
            ents: [], fx: [], floats: [],
            input: [{ up: 0, down: 0 }, { up: 0, down: 0 }],
            round: 1, wins: [0, 0],
            phase: 'countdown', phaseT: 3,
            t: 0, over: null,
            strokes: [], stroke: null, lastInk: 0,
            hint: null, hintT: 0,
            snapAcc: 0,
            botAcc: 0, botPlan: 0,
            netDown: 0,
            paused: false
        };
        if (!solo) g.me = players[0].id === session.id ? 0 : 1;
        return g;
    }
    const randomBot = () => D.BOTS[Math.floor(Math.random() * D.BOTS.length)];
    // both sides must agree on who is on the left: the host is
    function orderPlayers(session, opts) {
        const list = (opts && opts.slots ? opts.slots.map(id => session.player(id)).filter(Boolean) : session.players.slice());
        const host = list.find(p => p.host) || list[0];
        const other = list.find(p => p !== host) || { id: 'ghost', name: 'nobody' };
        return [host, other];
    }

    // ---------------------------------------------------------------
    // statuses and damage
    // ---------------------------------------------------------------
    const has = (w, k) => !!w.st[k] && w.st[k].t > 0;
    function addStatus(w, key, dur, extra) {
        const cur = w.st[key];
        w.st[key] = Object.assign({ t: Math.max(dur, cur ? cur.t : 0) }, extra || {});
    }
    function clearBad(w) {
        Object.keys(w.st).forEach(k => { if ((D.STATUS[k] || {}).bad) delete w.st[k]; });
    }
    function canCast(w) { return !has(w, 'freeze') && !has(w, 'stun'); }
    function canMove(w) { return !has(w, 'root') && !has(w, 'stun'); }

    function dealDamage(g, target, amount, src) {
        src = src || {};
        const w = g.wiz[target];
        if (!w || w.dead || amount <= 0) return 0;
        if (has(w, 'phase') && src.dodgeable !== false) return 0;
        let dmg = amount;
        const attacker = src.from !== undefined ? g.wiz[src.from] : null;
        if (attacker) {
            if (has(attacker, 'weak')) dmg *= 0.7;
            if (has(attacker, 'focus')) dmg *= 1.25;
            if (has(attacker, 'pact')) dmg *= 1.2;
            if (src.punish && (has(w, 'weak') || has(w, 'bleed') || has(w, 'burn'))) dmg *= src.punish;
        }
        if (has(w, 'stoneskin')) dmg *= 0.75;
        // wards eat damage first
        if (w.ward > 0) {
            const eaten = Math.min(w.ward, dmg);
            w.ward -= eaten; dmg -= eaten;
            if (w.ward <= 0) { w.ward = 0; w.wardT = 0; }
        }
        if (dmg > 0) {
            w.hp = Math.max(0, w.hp - dmg);
            w.hitT = 0.25;
            float(g, w.x, w.y - 70, '-' + Math.round(dmg), '#ff6b6b');
        }
        // whatever hit them gets bitten back
        if (attacker && src.contact !== false) {
            const thorns = (w.st.thorns && w.st.thorns.thorns) || (w.wardThorns || 0);
            if (thorns) {
                attacker.hp = Math.max(0, attacker.hp - thorns);
                float(g, attacker.x, attacker.y - 70, '-' + thorns, '#7ee06a');
            }
        }
        if (attacker && src.lifesteal) heal(g, attacker.idx, src.lifesteal);
        if (w.hp <= 0 && !w.dead) { w.dead = true; SFX.die(); }
        return dmg;
    }
    function heal(g, idx, amount) {
        const w = g.wiz[idx];
        w.hp = Math.min(A.maxHp, w.hp + amount);
        float(g, w.x, w.y - 70, '+' + Math.round(amount), '#7ee06a');
    }
    function float(g, x, y, text, color) {
        g.floats.push({ x, y, text, color, t: 1.1 });
    }

    // ---------------------------------------------------------------
    // casting
    // ---------------------------------------------------------------
    function spellReady(g, idx, spell) {
        const w = g.wiz[idx];
        if (!canCast(w)) return 'frozen';
        if ((w.cd[spell.id] || 0) > 0) return 'cooling';
        const usingHp = has(w, 'pact');
        const manaCost = usingHp ? 0 : (spell.cost || 0);
        const hpCost = (spell.hp || 0) + (usingHp ? (spell.cost || 0) * 0.6 : 0);
        if (w.mana < manaCost) return 'mana';
        if (w.hp <= hpCost) return 'health';
        return null;
    }

    function castSpell(g, idx, spell, quality) {
        const w = g.wiz[idx], foe = g.wiz[1 - idx];
        const why = spellReady(g, idx, spell);
        if (why) return why;
        const usingHp = has(w, 'pact');
        w.mana -= usingHp ? 0 : (spell.cost || 0);
        w.hp -= (spell.hp || 0) + (usingHp ? (spell.cost || 0) * 0.6 : 0);
        w.cd[spell.id] = spell.cd || 0;
        w.castT = 0.35;
        const power = 0.8 + quality * 0.4;                 // sloppy sigils hit softer
        const dir = idx === 0 ? 1 : -1;
        const p = spell.p || {};
        const el = spell.el;
        SFX.cast(el);
        g.fx.push({ kind: 'castring', x: w.x, y: w.y - 40, t: 0.4, el });

        switch (spell.kind) {
            case 'bolt': {
                const count = p.count || 1;
                for (let i = 0; i < count; i++) {
                    const spread = count > 1 ? (i - (count - 1) / 2) * (p.spread || 20) : 0;
                    g.ents.push({
                        kind: 'bolt', owner: idx, spell: spell.id, el,
                        x: w.x + dir * 26, y: w.y - 40 + spread * 0.6,
                        vx: dir * (p.speed || 300), vy: (p.gravity ? -180 : 0) + spread * 1.2,
                        r: p.r || 8, dmg: (spell.dmg || 0) * power,
                        gravity: p.gravity || 0, homing: p.homing || 0,
                        pierce: !!p.pierce, aoe: p.aoe || 0,
                        ground: !!p.ground, lowOnly: !!p.lowOnly,
                        knock: p.knock || 0, punish: p.punish || 0,
                        burn: p.burn, chill: p.chill, status: p.status, statusDur: p.statusDur,
                        life: 6
                    });
                }
                if (p.ground) g.ents[g.ents.length - 1].y = A.floor - 12;
                break;
            }
            case 'beam': {
                const blocked = p.throughWalls ? null : wallBetween(g, w, foe);
                g.ents.push({ kind: 'beam', owner: idx, el, x1: w.x + dir * 24, y1: w.y - 40, x2: blocked ? blocked.x : foe.x, y2: blocked ? blocked.y : foe.y - 40, t: 0.22 });
                if (blocked) { blocked.hp -= (spell.dmg || 0) * power; }
                else {
                    dealDamage(g, 1 - idx, (spell.dmg || 0) * power, { from: idx, lifesteal: p.lifesteal, dodgeable: false });
                    if (p.manaBurn) { foe.mana = Math.max(0, foe.mana - p.manaBurn); float(g, foe.x, foe.y - 86, '-' + p.manaBurn + ' mana', '#c08cff'); }
                    if (p.shock) addStatus(foe, 'shock', p.shock.dur);
                }
                SFX.hit();
                break;
            }
            case 'wall': {
                g.ents.push({
                    kind: 'wall', owner: idx, el, x: w.x + dir * 92, y: A.floor - (p.h || 120) / 2 - 10,
                    w: 16, h: p.h || 120, hp: (p.hp || 40) * power, maxHp: (p.hp || 40) * power, life: p.dur || 9
                });
                SFX.ward();
                break;
            }
            case 'ward': {
                w.ward = Math.max(w.ward, (p.shield || 20) * power);
                w.wardT = p.dur || 8;
                w.wardThorns = p.thorns || 0;
                w.wardZap = !!p.zap;
                if (p.status) addStatus(w, p.status, p.statusDur || p.dur || 8);
                SFX.ward();
                break;
            }
            case 'heal': {
                if (p.over) addStatus(w, 'regen', p.over, { hps: (p.heal || 10) * power / p.over });
                else heal(g, idx, (p.heal || 10) * power);
                SFX.heal();
                break;
            }
            case 'buff': {
                if (p.status) addStatus(w, p.status, p.dur || 6, {
                    dps: p.selfDps, manaPerSec: p.manaPerSec, thorns: p.thorns
                });
                if (p.heal) heal(g, idx, p.heal * power);
                SFX.ward();
                break;
            }
            case 'hex': {
                g.ents.push({ kind: 'hexfx', el, x: w.x + dir * 24, y: w.y - 40, tx: foe.x, ty: foe.y - 40, t: 0.3 });
                if (spell.dmg) dealDamage(g, 1 - idx, spell.dmg * power, { from: idx, dodgeable: false });
                if (p.status) addStatus(foe, p.status, (p.dur || 3) * (0.8 + quality * 0.4), { dps: p.dps, moveDps: p.moveDps, feed: p.feed, from: idx });
                if (p.manaBurn) {
                    const taken = Math.min(foe.mana, p.manaBurn);
                    foe.mana -= taken;
                    if (p.manaGain) w.mana = Math.min(A.maxMana, w.mana + Math.min(taken, p.manaGain));
                    float(g, foe.x, foe.y - 86, '-' + Math.round(taken) + ' mana', '#c08cff');
                }
                SFX.hit();
                break;
            }
            case 'zone': {
                const cx = p.mid ? (A.leftX + A.rightX) / 2 : foe.x;
                g.ents.push({
                    kind: 'zone', owner: idx, el, x: cx, y: (A.ceil + A.floor) / 2,
                    w: p.w || 150, h: A.floor - A.ceil, dps: (p.dps || 4) * power, life: p.dur || 4,
                    burn: p.burn, chill: p.chill, eats: !!p.eats
                });
                break;
            }
            case 'special': return special(g, idx, spell, power, quality);
        }
        return null;
    }

    function special(g, idx, spell, power) {
        const w = g.wiz[idx], foe = g.wiz[1 - idx], p = spell.p || {};
        switch (spell.id) {
            case 'blink':
                addStatus(w, 'phase', p.status ? p.dur || 0.75 : 0.75);
                w.y += (w.y > (A.ceil + A.floor) / 2 ? -1 : 1) * (p.jump || 90);
                w.y = Math.max(A.ceil, Math.min(A.floor - 10, w.y));
                g.fx.push({ kind: 'castring', x: w.x, y: w.y - 40, t: 0.4, el: spell.el });
                break;
            case 'nightfall':
                g.ents.push({ kind: 'decoy', owner: idx, el: spell.el, x: w.x, y: w.y, life: p.dur || 8, avatar: w.avatar });
                break;
            case 'banish':
                g.ents = g.ents.filter(e => e.owner !== 1 - idx || e.kind === 'bolt');
                Object.keys(foe.st).forEach(k => { if (!(D.STATUS[k] || {}).bad) delete foe.st[k]; });
                foe.ward = 0; foe.wardT = 0;
                float(g, foe.x, foe.y - 86, 'banished', '#a074d8');
                break;
            case 'radiance': {
                clearBad(w);
                const d = Math.abs(foe.x - w.x);
                if (d < (p.aoe || 130)) dealDamage(g, 1 - idx, (spell.dmg || 0) * power, { from: idx });
                g.fx.push({ kind: 'burst', x: w.x, y: w.y - 40, t: 0.5, el: spell.el, r: p.aoe || 130 });
                break;
            }
            case 'judgment':
                g.ents.push({
                    kind: 'telegraph', owner: idx, el: spell.el, x: foe.x, y: foe.y,
                    r: p.r || 34, t: p.telegraph || 0.85, dmg: (spell.dmg || 0) * power
                });
                break;
            case 'sacrifice':
                w.mana = Math.min(A.maxMana, w.mana + (p.mana || 40));
                float(g, w.x, w.y - 86, '+' + (p.mana || 40) + ' mana', '#c08cff');
                break;
        }
        return null;
    }

    function wallBetween(g, from, to) {
        const lo = Math.min(from.x, to.x), hi = Math.max(from.x, to.x);
        return g.ents.find(e => e.kind === 'wall' && e.x > lo && e.x < hi) || null;
    }

    // ---------------------------------------------------------------
    // the simulation — host only
    // ---------------------------------------------------------------
    function step(g, dt) {
        g.t += dt;

        if (g.phase === 'countdown') {
            g.phaseT -= dt;
            const was = Math.ceil(g.phaseT + dt), now = Math.ceil(g.phaseT);
            if (now !== was && now > 0) SFX.tick();
            if (g.phaseT <= 0) { g.phase = 'live'; SFX.tick(); botSay(g, 'start'); }
            return;
        }
        if (g.phase === 'roundover') {
            g.phaseT -= dt;
            if (g.phaseT <= 0) nextRound(g);
            return;
        }
        if (g.phase !== 'live') return;

        for (let i = 0; i < 2; i++) stepWizard(g, i, dt);
        stepEntities(g, dt);

        // round decided?
        const dead = [g.wiz[0].dead, g.wiz[1].dead];
        if (dead[0] || dead[1]) {
            const winner = dead[0] && dead[1] ? -1 : (dead[0] ? 1 : 0);
            endRound(g, winner);
        }
    }

    function stepWizard(g, i, dt) {
        const w = g.wiz[i], foe = g.wiz[1 - i], inp = g.input[i];
        // ---- statuses ----
        let manaMul = 1, moved = false;
        Object.keys(w.st).forEach(k => {
            const s = w.st[k];
            s.t -= dt;
            if (s.t <= 0) { delete w.st[k]; return; }
            switch (k) {
                case 'burn': dealDamage(g, i, (s.dps || 3) * dt, { contact: false, dodgeable: false }); break;
                case 'bleed': dealDamage(g, i, (s.dps || 2) * dt, { contact: false, dodgeable: false }); break;
                case 'leech': {
                    const taken = (s.dps || 2) * dt;
                    dealDamage(g, i, taken, { contact: false, dodgeable: false });
                    if (s.feed && s.from !== undefined) heal(g, s.from, taken * 0.8);
                    break;
                }
                case 'chill': manaMul *= 0.55; break;
                case 'overload': manaMul *= 2; dealDamage(g, i, (s.dps || 1.2) * dt, { contact: false, dodgeable: false }); break;
                case 'well': w.mana = Math.min(A.maxMana, w.mana + (s.manaPerSec || 8) * dt); break;
                case 'regen': heal(g, i, (s.hps || 4) * dt); break;
            }
        });
        w.mana = Math.min(A.maxMana, w.mana + A.manaRegen * manaMul * dt);
        w.castT = Math.max(0, w.castT - dt);
        w.hitT = Math.max(0, w.hitT - dt);
        Object.keys(w.cd).forEach(k => { w.cd[k] = Math.max(0, w.cd[k] - dt); });
        if (w.wardT > 0) { w.wardT -= dt; if (w.wardT <= 0) { w.ward = 0; w.wardThorns = 0; w.wardZap = false; } }

        // ---- movement ----
        if (canMove(w)) {
            const dir = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
            if (dir) {
                w.y += dir * A.moveSpeed * dt;
                moved = true;
            }
        }
        w.y = Math.max(A.ceil, Math.min(A.floor - 8, w.y));
        // knockback drifts back home
        if (Math.abs(w.x - w.home) > 0.5) w.x += (w.home - w.x) * Math.min(1, dt * 1.6);
        // bleeding gets worse if you keep dancing about
        if (moved && has(w, 'bleed') && w.st.bleed.moveDps) {
            dealDamage(g, i, w.st.bleed.moveDps * dt, { contact: false, dodgeable: false });
        }
        w.face = foe.x >= w.x ? 1 : -1;
    }

    function stepEntities(g, dt) {
        const keep = [];
        for (const e of g.ents) {
            switch (e.kind) {
                case 'bolt': {
                    const foe = g.wiz[1 - e.owner];
                    if (e.homing) {
                        const tx = foe.x - e.x, ty = (foe.y - 40) - e.y;
                        const len = Math.hypot(tx, ty) || 1;
                        e.vx += (tx / len) * e.homing * 190 * dt;
                        e.vy += (ty / len) * e.homing * 190 * dt;
                    }
                    if (e.gravity) e.vy += e.gravity * dt;
                    e.x += e.vx * dt;
                    e.y += e.vy * dt;
                    e.life -= dt;
                    if (e.ground) e.y = A.floor - 12;
                    if (e.life <= 0 || e.x < -40 || e.x > A.W + 40 || e.y > A.floor + 30 || e.y < -40) {
                        if (e.aoe && e.y >= A.floor - 20) boom(g, e);
                        continue;
                    }
                    // walls, decoys, hungry zones
                    const wall = g.ents.find(o => o.kind === 'wall' && o.owner !== e.owner &&
                        Math.abs(o.x - e.x) < o.w / 2 + e.r && Math.abs(o.y - e.y) < o.h / 2 + e.r);
                    // a piercing bolt keeps flying, but it only gets to hurt
                    // each thing once — otherwise it bills them every frame
                    if (wall && e.hitWall !== wall) {
                        wall.hp -= e.dmg;
                        e.hitWall = wall;
                        g.fx.push({ kind: 'spark', x: e.x, y: e.y, t: 0.3, el: e.el });
                        SFX.hit();
                        if (!e.pierce) continue;
                    }
                    const decoy = g.ents.find(o => o.kind === 'decoy' && o.owner !== e.owner && Math.hypot(o.x - e.x, (o.y - 40) - e.y) < 30);
                    if (decoy) {
                        decoy.life = 0;
                        g.fx.push({ kind: 'burst', x: decoy.x, y: decoy.y - 40, t: 0.4, el: 'shadow', r: 40 });
                        continue;
                    }
                    const hungry = g.ents.find(o => o.kind === 'zone' && o.eats && Math.abs(o.x - e.x) < o.w / 2);
                    if (hungry && hungry.owner !== e.owner) {
                        g.fx.push({ kind: 'spark', x: e.x, y: e.y, t: 0.25, el: 'void' });
                        continue;
                    }
                    // the wizard
                    const hitR = e.r + 24;
                    if (!e.hitFoe && Math.hypot(foe.x - e.x, (foe.y - 40) - e.y) < hitR) {
                        if (e.lowOnly && foe.y < A.floor - 90) { keep.push(e); break; }
                        if (has(foe, 'mirror')) {
                            delete foe.st.mirror;
                            e.owner = 1 - e.owner;
                            e.vx *= -1;
                            e.hitFoe = false;      // it gets one hit on its new target
                            e.hitWall = null;
                            e.x += e.vx * dt * 2;
                            float(g, foe.x, foe.y - 86, 'mirrored', '#b04dff');
                            keep.push(e);
                            break;
                        }
                        if (foe.wardZap && e.r <= 8 && foe.ward > 0) {
                            foe.ward = Math.max(0, foe.ward - e.dmg * 0.4);
                            g.fx.push({ kind: 'spark', x: e.x, y: e.y, t: 0.25, el: 'storm' });
                            continue;
                        }
                        applyBoltHit(g, e, foe);
                        e.hitFoe = true;
                        // the splash is for everyone else — whoever ate the
                        // bolt itself does not also get billed for the blast
                        if (e.aoe) boom(g, e, foe.idx);
                        if (!e.pierce) continue;
                    }
                    keep.push(e);
                    break;
                }
                case 'wall':
                    e.life -= dt;
                    if (e.life > 0 && e.hp > 0) keep.push(e);
                    break;
                case 'zone': {
                    e.life -= dt;
                    for (let i = 0; i < 2; i++) {
                        const w = g.wiz[i];
                        if (i === e.owner) continue;
                        if (Math.abs(w.x - e.x) < e.w / 2 + 20) {
                            dealDamage(g, i, e.dps * dt, { from: e.owner, contact: false, dodgeable: false });
                            if (e.burn && Math.random() < dt * 2) addStatus(w, 'burn', e.burn.dur, { dps: e.burn.dps });
                            if (e.chill) addStatus(w, 'chill', e.chill.dur);
                        }
                    }
                    if (e.life > 0) keep.push(e);
                    break;
                }
                case 'telegraph':
                    e.t -= dt;
                    if (e.t <= 0) {
                        const foe = g.wiz[1 - e.owner];
                        if (Math.abs(foe.x - e.x) < e.r && Math.abs(foe.y - e.y) < e.r + 40) {
                            dealDamage(g, 1 - e.owner, e.dmg, { from: e.owner });
                        }
                        g.fx.push({ kind: 'pillar', x: e.x, y: e.y, t: 0.45, el: e.el });
                        SFX.hit();
                    } else keep.push(e);
                    break;
                case 'decoy':
                    e.life -= dt;
                    if (e.life > 0) keep.push(e);
                    break;
                case 'beam':
                case 'hexfx':
                    e.t -= dt;
                    if (e.t > 0) keep.push(e);
                    break;
                default: keep.push(e);
            }
        }
        g.ents = keep;
    }

    function applyBoltHit(g, e, foe) {
        dealDamage(g, foe.idx, e.dmg, { from: e.owner, punish: e.punish });
        if (e.burn) addStatus(foe, 'burn', e.burn.dur, { dps: e.burn.dps });
        if (e.chill) addStatus(foe, 'chill', e.chill.dur);
        if (e.status) addStatus(foe, e.status, e.statusDur || 2);
        if (e.knock) {
            foe.x += (e.vx > 0 ? 1 : -1) * Math.min(50, e.knock * 0.5);
            foe.x = Math.max(40, Math.min(A.W - 40, foe.x));
            addStatus(foe, 'stun', 0.25);
        }
        g.fx.push({ kind: 'spark', x: e.x, y: e.y, t: 0.3, el: e.el });
        SFX.hit();
    }
    function boom(g, e, skip) {
        g.fx.push({ kind: 'burst', x: e.x, y: e.y, t: 0.5, el: e.el, r: e.aoe });
        for (let i = 0; i < 2; i++) {
            if (i === e.owner || i === skip) continue;
            const w = g.wiz[i];
            if (Math.hypot(w.x - e.x, (w.y - 40) - e.y) < e.aoe) {
                dealDamage(g, i, e.dmg * 0.6, { from: e.owner, contact: false });
            }
        }
    }

    // ---------------------------------------------------------------
    // rounds
    // ---------------------------------------------------------------
    function endRound(g, winner) {
        g.phase = 'roundover';
        g.phaseT = 2.6;
        g.lastWinner = winner;
        if (winner >= 0) g.wins[winner]++;
        if (winner === g.me) SFX.win();
        if (winner >= 0) botSay(g, winner === 1 ? 'win' : 'lose');
        if (g.isHost) sendNet(g, 'wz:round', { wins: g.wins, winner, round: g.round });
    }
    function nextRound(g) {
        if (g.wins[0] >= A.rounds || g.wins[1] >= A.rounds) {
            g.phase = 'matchover';
            g.over = g.wins[0] > g.wins[1] ? 0 : 1;
            if (g.isHost) sendNet(g, 'wz:end', { wins: g.wins, winner: g.over });
            if (g.over === g.me && typeof unlockAchievement === 'function') unlockAchievement('wizardz_win');
            renderChrome();
            return;
        }
        g.round++;
        g.ents = []; g.fx = []; g.floats = [];
        g.wiz.forEach((w, i) => {
            w.hp = A.maxHp; w.mana = A.maxMana; w.ward = 0; w.wardT = 0;
            w.st = {}; w.cd = {}; w.dead = false; w.y = (A.ceil + A.floor) / 2; w.x = w.home;
        });
        g.phase = 'countdown';
        g.phaseT = 3;
        g.strokes = []; g.stroke = null;
    }

    // ---------------------------------------------------------------
    // the machine opponent
    // ---------------------------------------------------------------
    // A machine can draw a perfect sigil in zero seconds, so the only
    // fair handicap is making it wait between casts like you have to.
    // Each bot brings its own hands; the difficulty dropdown bends them.
    function botSkill(bot) {
        const d = D.BOT_DIFFICULTY[difficulty()] || D.BOT_DIFFICULTY.normal;
        const s = bot.skill;
        return {
            react: s.react * d.react,
            dodge: Math.min(0.95, s.dodge * d.dodge),
            quality: Math.min(1, s.quality * d.quality)
        };
    }
    // the bots have opinions, and they say them out loud
    function botSay(g, kind) {
        if (!g.solo || !g.bot) return;
        const lines = (g.bot.lines || {})[kind];
        if (!lines || !lines.length) return;
        g.hint = { text: g.bot.name + ': ' + lines[Math.floor(Math.random() * lines.length)], bot: true };
        g.hintT = 2.6;
    }
    function botStep(g, dt) {
        const bot = g.bot || D.BOTS[0];
        const cfg = botSkill(bot);
        const style = bot.style || {};
        const me = g.wiz[1], foe = g.wiz[0];
        // dodging: look for the nearest thing coming at us
        const inc = g.ents.filter(e => e.kind === 'bolt' && e.owner === 0 && (e.x - me.x) * (e.vx) > 0 === false)
            .sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x))[0];
        g.input[1] = { up: 0, down: 0 };
        if (inc && Math.random() < cfg.dodge) {
            const dy = (inc.y + 40) - me.y;
            if (Math.abs(dy) < 70) { if (dy > 0) g.input[1].up = 1; else g.input[1].down = 1; }
        } else if (Math.random() < 0.02) {
            g.input[1][Math.random() < 0.5 ? 'up' : 'down'] = 1;
        }
        // telegraphed strikes have to be walked out of
        const tel = g.ents.find(e => e.kind === 'telegraph' && e.owner === 0);
        if (tel && Math.abs(tel.y - me.y) < 60) g.input[1][me.y > tel.y ? 'down' : 'up'] = 1;

        g.botAcc -= dt;
        if (g.botAcc > 0 || g.phase !== 'live') return;
        g.botAcc = cfg.react * (0.85 + Math.random() * 0.3);

        const pool = (style.pool ? style.pool.map(id => D.byId(id)) : D.SPELLS).filter(Boolean);
        const usable = pool.filter(s => !spellReady(g, 1, s));
        if (!usable.length) return;
        const aggression = style.aggression === undefined ? 1 : style.aggression;
        const defence = style.defence === undefined ? 1 : style.defence;
        const hexLove = style.hexes === undefined ? 1 : style.hexes;
        // everybody smells blood at the end
        const closing = foe.hp < 35 ? 1.6 : 1;
        const score = (s) => {
            let v = ((s.dmg || 0) + (s.p && s.p.dps ? s.p.dps * 3 : 0)) * aggression * closing;
            // everyone has a favourite shelf of the spellbook
            if ((style.els || []).includes(s.el)) v += 16;
            else if (style.els) v -= 6;
            if (s.kind === 'heal') v += (me.hp < 45 ? 45 : me.hp > 80 ? -40 : 8) * defence;
            if (s.kind === 'ward') v += (me.ward > 0 ? -30 : (me.hp < 60 ? 26 : 10) * defence);
            if (s.kind === 'wall') v = (g.ents.some(e => e.kind === 'wall' && e.owner === 1) ? v - 40 : v + 14 * defence);
            if (s.kind === 'hex') v = v * hexLove + (Object.keys(foe.st).length > 2 ? -12 : 8 * hexLove);
            if (s.id === 'sacrifice') v = me.mana < 25 && me.hp > 55 ? 35 : -50;
            if (s.p && s.p.lowOnly && foe.y < A.floor - 90) v -= 40;
            // do not blow the whole mana bar on the opening move, and keep
            // enough back to answer with something. a bot that spends its
            // last drop on a wall then stands there is not playing, it is
            // waiting.
            v -= Math.max(0, (s.cost || 0) - me.mana * 0.55) * 1.2;
            if ((s.cost || 0) > me.mana - 14 && (s.dmg || 0) < 20) v -= 22;
            if (s.hp) v -= s.hp * (me.hp < 55 ? 2.5 : 0.8);
            // the big nukes stay occasional. a person needs a second and a
            // half to draw anything, and a machine chaining meteor into
            // oblivion is not a duel, it is a mugging.
            v -= Math.max(0, (s.dmg || 0) - 18) * 1.6;
            return v + Math.random() * 12;
        };
        const pick = usable.sort((a, b) => score(b) - score(a))[0];
        if (!pick) return;
        castSpell(g, 1, pick, cfg.quality * (0.85 + Math.random() * 0.15));
        // heavy spells cost the machine time as well as mana
        if ((pick.cost || 0) >= 25 || (pick.dmg || 0) >= 20) g.botAcc += cfg.react * 0.8;
    }

    // ===============================================================
    // 6. NETWORKING
    // ===============================================================
    function sendNet(g, type, data) {
        if (g.session && !g.solo) g.session.send(type, data);
    }
    function snapshot(g) {
        return {
            t: +g.t.toFixed(2), ph: g.phase, pt: +g.phaseT.toFixed(2), rd: g.round, wn: g.wins,
            w: g.wiz.map(w => ({
                x: Math.round(w.x), y: Math.round(w.y),
                h: +w.hp.toFixed(1), m: +w.mana.toFixed(1), wd: +w.ward.toFixed(1),
                c: +w.castT.toFixed(2), ht: +w.hitT.toFixed(2), f: w.face, d: w.dead ? 1 : 0,
                st: Object.keys(w.st).map(k => [k, +w.st[k].t.toFixed(1)]),
                cd: Object.keys(w.cd).filter(k => w.cd[k] > 0).map(k => [k, +w.cd[k].toFixed(1)])
            })),
            e: g.ents.map(e => {
                const o = { k: e.kind, x: Math.round(e.x || 0), y: Math.round(e.y || 0), el: e.el, o: e.owner };
                if (e.r) o.r = e.r;
                if (e.vx !== undefined) { o.vx = Math.round(e.vx); o.vy = Math.round(e.vy); }
                if (e.w) o.w = e.w;
                if (e.h) o.h = e.h;
                if (e.t) o.t = +e.t.toFixed(2);
                if (e.hp) o.hp = +e.hp.toFixed(1);
                if (e.maxHp) o.mh = e.maxHp;
                if (e.x1 !== undefined) { o.x1 = Math.round(e.x1); o.y1 = Math.round(e.y1); o.x2 = Math.round(e.x2); o.y2 = Math.round(e.y2); }
                if (e.tx !== undefined) { o.tx = Math.round(e.tx); o.ty = Math.round(e.ty); }
                return o;
            }),
            fl: g.floats.slice(-4).map(f => ({ x: Math.round(f.x), y: Math.round(f.y), s: f.text, c: f.color, t: +f.t.toFixed(2) }))
        };
    }
    function applySnapshot(g, s) {
        if (!s || !s.w) return;
        g.phase = s.ph; g.phaseT = s.pt; g.round = s.rd; g.wins = s.wn || g.wins;
        s.w.forEach((sw, i) => {
            const w = g.wiz[i];
            if (!w) return;
            // remember where it was so rendering can smooth the gap
            w.px = w.x; w.py = w.y;
            w.x = sw.x; w.y = sw.y;
            w.hp = sw.h; w.mana = sw.m; w.ward = sw.wd;
            w.castT = sw.c; w.hitT = sw.ht; w.face = sw.f; w.dead = !!sw.d;
            w.st = {};
            (sw.st || []).forEach(([k, t]) => { w.st[k] = { t }; });
            w.cd = {};
            (sw.cd || []).forEach(([k, t]) => { w.cd[k] = t; });
        });
        g.ents = (s.e || []).map(e => ({
            kind: e.k, x: e.x, y: e.y, el: e.el, owner: e.o, r: e.r, w: e.w, h: e.h, vx: e.vx, vy: e.vy,
            t: e.t, hp: e.hp, maxHp: e.mh, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, tx: e.tx, ty: e.ty,
            avatar: e.k === 'decoy' ? g.wiz[e.o].avatar : null
        }));
        // floats are cosmetic; only take the new ones
        (s.fl || []).forEach(f => {
            if (!g.floats.some(x => x.text === f.s && Math.abs(x.x - f.x) < 4 && Math.abs(x.t - f.t) < 0.3)) {
                g.floats.push({ x: f.x, y: f.y, text: f.s, color: f.c, t: f.t });
            }
        });
    }

    function bindNet(g) {
        if (!g.session || g.solo) return;
        const s = g.session, offs = [];
        if (g.isHost) {
            offs.push(s.on('wz:input', (d, from) => {
                const i = g.wiz.findIndex(w => w.id === (from && from.id));
                if (i >= 0) g.input[i] = { up: d && d.u ? 1 : 0, down: d && d.d ? 1 : 0 };
            }));
            offs.push(s.on('wz:cast', (d, from) => {
                const i = g.wiz.findIndex(w => w.id === (from && from.id));
                const spell = D.byId(d && d.s);
                if (i >= 0 && spell) {
                    const q = Math.max(0, Math.min(1, +d.q || 0));
                    const why = castSpell(g, i, spell, q);
                    if (why) sendNet(g, 'wz:deny', { s: spell.id, why });
                }
            }));
            offs.push(s.on('wz:rematch', () => { if (g.phase === 'matchover') restartMatch(g); }));
        } else {
            offs.push(s.on('wz:snap', d => applySnapshot(g, d)));
            offs.push(s.on('wz:round', d => { g.wins = d.wins || g.wins; }));
            offs.push(s.on('wz:end', d => { g.wins = d.wins || g.wins; g.phase = 'matchover'; g.over = d.winner; renderChrome(); }));
            offs.push(s.on('wz:deny', d => { g.hint = { text: nameOf(d.s) + ': ' + denyText(d.why), bad: true }; g.hintT = 1.4; }));
            offs.push(s.on('wz:restart', () => { g.wins = [0, 0]; g.round = 1; g.over = null; g.phase = 'countdown'; g.phaseT = 3; renderChrome(); }));
        }
        // an opponent who walked out cannot lose the round, so the duel
        // freezes where it stands and the banner explains why
        const vanished = () => { g.netDown = 1; g.paused = true; };
        offs.push(s.on('player-leave', vanished));
        offs.push(s.on('net:down', vanished));
        offs.push(s.on('closed', vanished));
        g._netOffs = offs;
    }
    const nameOf = id => (D.byId(id) || {}).name || id;
    function denyText(why) {
        return ({ mana: 'not enough mana', health: 'not enough health', cooling: 'still cooling down', frozen: 'you cannot cast right now' })[why] || 'no';
    }

    function restartMatch(g) {
        g.wins = [0, 0]; g.round = 1; g.over = null;
        g.ents = []; g.fx = []; g.floats = [];
        g.wiz.forEach(w => {
            w.hp = A.maxHp; w.mana = A.maxMana; w.ward = 0; w.wardT = 0;
            w.st = {}; w.cd = {}; w.dead = false; w.y = (A.ceil + A.floor) / 2; w.x = w.home;
        });
        g.phase = 'countdown'; g.phaseT = 3;
        if (g.isHost) sendNet(g, 'wz:restart', {});
        renderChrome();
    }

    // ===============================================================
    // 7. INPUT — drawing and moving
    // ===============================================================
    const INK_PAUSE = 420;     // ms of stillness that ends a sigil

    function canvasPoint(ev) {
        const r = cv.getBoundingClientRect();
        const p = ev.touches ? ev.touches[0] : ev;
        return {
            x: (p.clientX - r.left) * (cv.width / r.width),
            y: (p.clientY - r.top) * (cv.height / r.height)
        };
    }
    function bindInput(g) {
        const down = (ev) => {
            if (g.phase === 'matchover') return;
            ev.preventDefault();
            g.stroke = [canvasPoint(ev)];
            g.strokes.push(g.stroke);
            g.lastInk = performance.now();
        };
        const move = (ev) => {
            if (!g.stroke) return;
            ev.preventDefault();
            const p = canvasPoint(ev);
            const last = g.stroke[g.stroke.length - 1];
            if (Math.hypot(p.x - last.x, p.y - last.y) > 2.5) g.stroke.push(p);
            g.lastInk = performance.now();
        };
        const up = () => {
            if (!g.stroke) return;
            if (g.stroke.length < 2) g.strokes.pop();
            g.stroke = null;
            g.lastInk = performance.now();
        };
        cv.addEventListener('mousedown', down);
        cv.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        cv.addEventListener('touchstart', down, { passive: false });
        cv.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('touchend', up);

        const keys = {};
        const typing = (e) => {
            const tag = ((e.target || {}).tagName || '').toLowerCase();
            return tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
        };
        const keyDown = (e) => {
            if (typing(e)) return;
            const k = e.key.toLowerCase();
            if (['w', 'arrowup', 's', 'arrowdown', ' '].includes(k)) e.preventDefault();
            if (k === ' ') { g.strokes = []; g.stroke = null; return; }
            keys[k] = true;
            pushInput(g, keys);
        };
        const keyUp = (e) => { if (typing(e)) return; keys[e.key.toLowerCase()] = false; pushInput(g, keys); };
        window.addEventListener('keydown', keyDown);
        window.addEventListener('keyup', keyUp);

        g._unbind = () => {
            cv.removeEventListener('mousedown', down);
            cv.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            cv.removeEventListener('touchstart', down);
            cv.removeEventListener('touchmove', move);
            window.removeEventListener('touchend', up);
            window.removeEventListener('keydown', keyDown);
            window.removeEventListener('keyup', keyUp);
        };
        g._keys = keys;
    }
    function pushInput(g, keys) {
        const inp = {
            up: keys['w'] || keys['arrowup'] ? 1 : 0,
            down: keys['s'] || keys['arrowdown'] ? 1 : 0
        };
        const mine = g.input[g.me];
        if (mine.up === inp.up && mine.down === inp.down) return;
        g.input[g.me] = inp;
        if (!g.isHost) sendNet(g, 'wz:input', { u: inp.up, d: inp.down });
    }
    // touch players get buttons, since they have no keyboard to hover over
    function touchMove(g, dir, on) {
        const inp = Object.assign({}, g.input[g.me]);
        inp[dir] = on ? 1 : 0;
        g.input[g.me] = inp;
        if (!g.isHost) sendNet(g, 'wz:input', { u: inp.up, d: inp.down });
    }

    function tryRecognize(g) {
        // ink drawn between rounds is doodling, not casting
        if (g.phase !== 'live' || g.wiz[g.me].dead) {
            if (g.strokes.length && !g.stroke && performance.now() - g.lastInk > INK_PAUSE) g.strokes = [];
            return;
        }
        if (!g.strokes.length || g.stroke) return;
        if (performance.now() - g.lastInk < INK_PAUSE) return;
        const strokes = g.strokes;
        g.strokes = [];
        const results = recognize(strokes);
        if (!results.length) return;
        const best = results[0];
        if (best.score < CAST_FLOOR || (results[1] && best.score - results[1].score < CAST_MARGIN)) {
            g.hint = { text: 'fizzled — that looked like ' + best.spell.name, bad: true };
            g.hintT = 1.6;
            SFX.fizzle();
            return;
        }
        const q = qualityOf(best.score);
        if (g.isHost) {
            const why = castSpell(g, g.me, best.spell, q);
            if (why) {
                g.hint = { text: best.spell.name + ': ' + denyText(why), bad: true };
                g.hintT = 1.4;
                SFX.fizzle();
                return;
            }
        } else {
            sendNet(g, 'wz:cast', { s: best.spell.id, q: +q.toFixed(2) });
            SFX.cast(best.spell.el);
        }
        g.hint = { text: best.spell.name + (q > 0.8 ? ' — clean!' : ''), el: best.spell.el };
        g.hintT = 1.2;
    }

    // ===============================================================
    // 8. RENDERING
    // ===============================================================
    const elColor = el => (D.EL[el] || {}).color || '#fff';
    const elGlow = el => (D.EL[el] || {}).glow || '#fff';

    function render(g, dt) {
        const w = cv.width, h = cv.height;
        ctx.clearRect(0, 0, w, h);
        drawArena(g, w, h);
        g.ents.forEach(e => drawEntity(g, e));
        for (let i = 0; i < 2; i++) {
            const wz = g.wiz[i];
            ctx.save();
            if (wz.hitT > 0) { ctx.globalAlpha = 0.55 + Math.sin(wz.hitT * 60) * 0.3; }
            if (has(wz, 'phase')) ctx.globalAlpha = 0.45;
            drawWizard(ctx, wz.avatar, wz.x, wz.y, 1, {
                time: g.t, face: wz.face, casting: wz.castT / 0.35,
                shielded: wz.ward > 0
            });
            ctx.restore();
            if (wz.dead) {
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.beginPath(); ctx.ellipse(wz.x, wz.y, 30, 8, 0, 0, Math.PI * 2); ctx.fill();
            }
        }
        drawFx(g, dt);
        drawInk(g);
        drawHud(g, w, h);
        if (has(g.wiz[g.me], 'blind')) drawBlind(g, w, h);
        drawBanners(g, w, h);
    }

    function drawArena(g, w, h) {
        const grd = ctx.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, '#160a2b');
        grd.addColorStop(0.7, '#221046');
        grd.addColorStop(1, '#0d0620');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
        // stars
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let i = 0; i < 40; i++) {
            const x = (i * 97 % w), y = (i * 53 % (A.floor - 40));
            const tw = 0.5 + Math.abs(Math.sin(g.t * 1.2 + i)) * 1.4;
            ctx.fillRect(x, y, tw, tw);
        }
        // floor
        ctx.fillStyle = '#1b1030';
        ctx.fillRect(0, A.floor, w, h - A.floor);
        ctx.strokeStyle = '#4b2d7a';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, A.floor); ctx.lineTo(w, A.floor); ctx.stroke();
        ctx.strokeStyle = 'rgba(120,80,200,0.25)';
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 38) {
            ctx.beginPath(); ctx.moveTo(x, A.floor); ctx.lineTo(x - 20, h); ctx.stroke();
        }
        // the two plinths
        [A.leftX, A.rightX].forEach(x => {
            ctx.fillStyle = '#2a1a48';
            ctx.fillRect(x - 34, A.floor - 6, 68, 10);
        });
    }

    function drawEntity(g, e) {
        const c = elColor(e.el), gl = elGlow(e.el);
        switch (e.kind) {
            case 'bolt': {
                ctx.save();
                ctx.shadowColor = gl; ctx.shadowBlur = 14;
                ctx.fillStyle = c;
                ctx.beginPath(); ctx.arc(e.x, e.y, e.r || 8, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.75)';
                ctx.beginPath(); ctx.arc(e.x - (e.vx > 0 ? 2 : -2), e.y - 2, (e.r || 8) * 0.4, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
                break;
            }
            case 'wall': {
                const frac = e.maxHp ? Math.max(0.15, e.hp / e.maxHp) : 1;
                ctx.save();
                ctx.globalAlpha = 0.45 + frac * 0.45;
                ctx.fillStyle = c;
                ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
                ctx.strokeStyle = gl; ctx.lineWidth = 2;
                ctx.strokeRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
                ctx.restore();
                break;
            }
            case 'zone': {
                ctx.save();
                ctx.globalAlpha = 0.16 + Math.sin(g.t * 5) * 0.05;
                ctx.fillStyle = c;
                ctx.fillRect(e.x - e.w / 2, A.ceil - 20, e.w, A.floor - A.ceil + 30);
                ctx.globalAlpha = 0.8;
                ctx.strokeStyle = gl; ctx.lineWidth = 1.5;
                for (let i = 0; i < 6; i++) {
                    const px = e.x - e.w / 2 + ((g.t * 40 + i * e.w / 6) % e.w);
                    ctx.beginPath();
                    ctx.moveTo(px, A.floor);
                    ctx.lineTo(px + 6, A.floor - 20 - (i % 3) * 12);
                    ctx.stroke();
                }
                ctx.restore();
                break;
            }
            case 'telegraph': {
                ctx.save();
                ctx.globalAlpha = 0.35 + Math.sin(g.t * 18) * 0.2;
                ctx.strokeStyle = gl; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.ellipse(e.x, A.floor - 4, e.r, 10, 0, 0, Math.PI * 2); ctx.stroke();
                ctx.fillStyle = c;
                ctx.globalAlpha = 0.18;
                ctx.fillRect(e.x - e.r, A.ceil - 30, e.r * 2, A.floor - A.ceil + 26);
                ctx.restore();
                break;
            }
            case 'decoy': {
                ctx.save();
                ctx.globalAlpha = 0.45;
                drawWizard(ctx, e.avatar || g.wiz[e.owner].avatar, e.x, e.y, 1, { time: g.t, face: e.owner === 0 ? 1 : -1 });
                ctx.restore();
                break;
            }
            case 'beam': {
                ctx.save();
                ctx.strokeStyle = c;
                ctx.shadowColor = gl; ctx.shadowBlur = 16;
                ctx.lineWidth = 3 + Math.max(0, e.t) * 16;
                ctx.globalAlpha = Math.max(0, Math.min(1, e.t * 4));
                ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
                ctx.restore();
                break;
            }
            case 'hexfx': {
                const k = 1 - Math.max(0, e.t) / 0.3;
                ctx.save();
                ctx.globalAlpha = 0.85;
                ctx.fillStyle = c;
                ctx.shadowColor = gl; ctx.shadowBlur = 12;
                ctx.beginPath();
                ctx.arc(e.x + (e.tx - e.x) * k, e.y + (e.ty - e.y) * k, 7, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                break;
            }
        }
    }

    function drawFx(g, dt) {
        const keep = [];
        for (const f of g.fx) {
            f.t -= dt;
            if (f.t <= 0) continue;
            const c = elColor(f.el), gl = elGlow(f.el);
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, f.t * 2.4));
            if (f.kind === 'castring') {
                ctx.strokeStyle = gl; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(f.x, f.y, (0.4 - f.t) * 90 + 8, 0, Math.PI * 2); ctx.stroke();
            } else if (f.kind === 'spark') {
                ctx.fillStyle = c;
                for (let i = 0; i < 7; i++) {
                    const a = i * 0.9 + f.t * 8;
                    const r = (0.3 - f.t) * 90;
                    ctx.fillRect(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 3, 3);
                }
            } else if (f.kind === 'burst') {
                ctx.strokeStyle = gl; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(f.x, f.y, (0.5 - f.t) * (f.r || 60) * 2.2, 0, Math.PI * 2); ctx.stroke();
            } else if (f.kind === 'pillar') {
                const grd = ctx.createLinearGradient(f.x, 0, f.x, A.floor);
                grd.addColorStop(0, 'rgba(255,255,255,0)');
                grd.addColorStop(1, gl);
                ctx.fillStyle = grd;
                ctx.fillRect(f.x - 26, 0, 52, A.floor);
            }
            ctx.restore();
            keep.push(f);
        }
        g.fx = keep;

        const fkeep = [];
        for (const f of g.floats) {
            f.t -= dt;
            if (f.t <= 0) continue;
            ctx.save();
            ctx.globalAlpha = Math.min(1, f.t);
            ctx.fillStyle = f.color || '#fff';
            ctx.font = 'bold 14px "Courier New", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(f.text, f.x, f.y - (1.1 - f.t) * 26);
            ctx.restore();
            fkeep.push(f);
        }
        g.floats = fkeep;
    }

    function drawInk(g) {
        if (!g.strokes.length) return;
        ctx.save();
        ctx.strokeStyle = '#0df259';
        ctx.shadowColor = '#0df259';
        ctx.shadowBlur = 12;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const fade = Math.max(0.35, 1 - (performance.now() - g.lastInk) / (INK_PAUSE * 2));
        ctx.globalAlpha = fade;
        g.strokes.forEach(s => {
            if (s.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(s[0].x, s[0].y);
            for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
            ctx.stroke();
        });
        ctx.restore();
    }

    function drawHud(g, w, h) {
        ctx.save();
        ctx.font = 'bold 12px "Courier New", monospace';
        for (let i = 0; i < 2; i++) {
            const wz = g.wiz[i];
            const left = i === 0;
            const x = left ? 12 : w - 12 - 250;
            const y = 12;
            // name + round pips
            ctx.fillStyle = i === g.me ? '#0df259' : '#ff9aa8';
            ctx.textAlign = left ? 'left' : 'right';
            ctx.fillText(wz.name + (i === g.me ? ' (you)' : ''), left ? x : w - 12, y + 10);
            // bars
            const bw = 250, bh = 12;
            const bar = (yy, frac, col, bg) => {
                ctx.fillStyle = bg;
                ctx.fillRect(x, yy, bw, bh);
                ctx.fillStyle = col;
                const fw = Math.max(0, Math.min(1, frac)) * bw;
                ctx.fillRect(left ? x : x + bw - fw, yy, fw, bh);
                ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
                ctx.strokeRect(x + 0.5, yy + 0.5, bw - 1, bh - 1);
            };
            bar(y + 16, wz.hp / A.maxHp, '#e4485f', '#3a0f18');
            bar(y + 32, wz.mana / A.maxMana, '#5b8cff', '#101a3a');
            if (wz.ward > 0) {
                ctx.fillStyle = 'rgba(180,230,255,0.85)';
                const fw = Math.min(1, wz.ward / 40) * bw;
                ctx.fillRect(left ? x : x + bw - fw, y + 16, fw, 4);
            }
            ctx.fillStyle = '#fff';
            ctx.textAlign = left ? 'left' : 'right';
            ctx.fillText(Math.ceil(wz.hp) + ' hp', left ? x + 4 : x + bw - 4, y + 26);
            // statuses
            const keys = Object.keys(wz.st).filter(k => D.STATUS[k]);
            keys.slice(0, 7).forEach((k, n) => {
                const sx = left ? x + n * 24 : x + bw - 20 - n * 24;
                ctx.fillStyle = D.STATUS[k].color;
                ctx.fillRect(sx, y + 48, 20, 6);
                ctx.fillStyle = '#fff';
                ctx.font = '9px "Courier New", monospace';
                ctx.textAlign = 'left';
                ctx.fillText(k.slice(0, 5), sx, y + 64);
                ctx.font = 'bold 12px "Courier New", monospace';
            });
        }
        // round score
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffe14d';
        ctx.fillText('round ' + g.round + '   ' + g.wins[0] + ' - ' + g.wins[1], w / 2, 22);
        // what the last sigil did
        if (g.hintT > 0 && g.hint) {
            ctx.globalAlpha = Math.min(1, g.hintT * 2);
            ctx.fillStyle = g.hint.bad ? '#ff9aa8' : (g.hint.bot ? '#ffe14d' : elGlow(g.hint.el));
            ctx.font = 'bold 15px "Courier New", monospace';
            ctx.fillText(g.hint.text, w / 2, A.floor + 34);
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    }

    function drawBlind(g, w, h) {
        ctx.save();
        ctx.fillStyle = 'rgba(126,224,106,0.22)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(126,224,106,0.5)';
        for (let i = 0; i < 60; i++) {
            const x = (i * 137 + Math.sin(g.t + i) * 30) % w;
            const y = (i * 71 + Math.cos(g.t * 0.7 + i) * 20) % h;
            ctx.beginPath(); ctx.arc(x, y, 3 + (i % 3), 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    function drawBanners(g, w, h) {
        ctx.save();
        ctx.textAlign = 'center';
        if (g.phase === 'countdown') {
            const n = Math.ceil(g.phaseT);
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(0, h / 2 - 46, w, 92);
            ctx.fillStyle = '#ffe14d';
            ctx.font = 'bold 54px "Courier New", monospace';
            ctx.fillText(n > 0 ? String(n) : 'DUEL!', w / 2, h / 2 + 16);
            ctx.fillStyle = '#fff';
            ctx.font = '13px "Courier New", monospace';
            ctx.fillText('draw sigils to cast · W/S or arrows to dodge · space clears ink', w / 2, h / 2 + 40);
        } else if (g.phase === 'roundover') {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(0, h / 2 - 40, w, 80);
            ctx.fillStyle = g.lastWinner === g.me ? '#0df259' : '#ff6b6b';
            ctx.font = 'bold 34px "Courier New", monospace';
            const who = g.lastWinner < 0 ? 'both of you died' : (g.lastWinner === g.me ? 'round won' : 'round lost');
            ctx.fillText(who, w / 2, h / 2 + 12);
        } else if (g.phase === 'matchover') {
            ctx.fillStyle = 'rgba(0,0,0,0.72)';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = g.over === g.me ? '#0df259' : '#ff6b6b';
            ctx.font = 'bold 44px "Courier New", monospace';
            ctx.fillText(g.over === g.me ? 'YOU WIN' : 'YOU LOSE', w / 2, h / 2);
            ctx.fillStyle = '#fff';
            ctx.font = '16px "Courier New", monospace';
            ctx.fillText(g.wins[0] + ' - ' + g.wins[1] + '  ·  ' + g.wiz[0].name + ' vs ' + g.wiz[1].name, w / 2, h / 2 + 30);
        }
        if (g.netDown) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, h / 2 - 24, w, 48);
            ctx.fillStyle = '#ff9aa8';
            ctx.font = 'bold 18px "Courier New", monospace';
            ctx.fillText('your opponent vanished', w / 2, h / 2 + 6);
        }
        ctx.restore();
    }

    // ===============================================================
    // 9. LOOP + WINDOW CHROME
    // ===============================================================
    function loop(now) {
        raf = requestAnimationFrame(loop);
        if (!G || !ctx) return;
        const dt = Math.min(0.05, (now - lastT) / 1000 || 0);
        lastT = now;
        if (!G.paused) {
            if (G.isHost) {
                if (G.solo) botStep(G, dt);
                step(G, dt);
                G.snapAcc += dt;
                if (!G.solo && G.snapAcc >= 1 / A.snapshotHz) {
                    G.snapAcc = 0;
                    sendNet(G, 'wz:snap', snapshot(G));
                }
            } else {
                // guests still animate everything locally between snapshots
                G.t += dt;
                G.ents.forEach(e => {
                    if (e.kind === 'bolt' && e.vx) { e.x += e.vx * dt; e.y += e.vy * dt; }
                });
            }
            tryRecognize(G);
            G.hintT = Math.max(0, G.hintT - dt);
        }
        render(G, dt);
    }

    function stopLoop() {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
    }

    let winRef = null;
    function ensureWindow(title) {
        if (winRef && document.getElementById(winRef.id)) return winRef;
        winRef = createAppWindow(title || 'wizardz 98', { icon: 'auto_fix_high', width: 800 });
        winRef.body.classList.add('wz-body');
        winRef.win._cleanup = () => {
            stopLoop();
            if (G) {
                if (G._unbind) G._unbind();
                if (G._netOffs) G._netOffs.forEach(off => off());
                if (G.session && !G.solo && G.session.alive) G.session.leave();
            }
            G = null; cv = null; ctx = null; root = null; winRef = null;
        };
        root = winRef.body;
        return winRef;
    }

    // the strip of quick-reference sigils under the arena
    function renderChrome() {
        if (!root || !G) return;
        const loadout = myLoadout();
        const strip = root.querySelector('#wz-strip');
        if (strip) {
            strip.innerHTML = loadout.map(id => {
                const s = D.byId(id);
                if (!s) return '';
                const cd = (G.wiz[G.me].cd[id] || 0);
                const cheap = G.wiz[G.me].mana >= s.cost;
                return `<div class="wz-card ${cd > 0 ? 'wz-cool' : ''} ${cheap ? '' : 'wz-poor'}" title="${escapeHtml(s.name)} — ${escapeHtml(s.blurb)}">
                    <canvas width="46" height="46" data-sigil="${s.id}"></canvas>
                    <div class="wz-card-name" style="color:${elColor(s.el)}">${escapeHtml(s.name)}</div>
                    <div class="wz-card-cost">${s.cost || 0}${s.hp ? ' +' + s.hp + 'hp' : ''}${cd > 0 ? ' · ' + cd.toFixed(1) + 's' : ''}</div>
                </div>`;
            }).join('');
            strip.querySelectorAll('canvas[data-sigil]').forEach(c => paintSigil(c, D.byId(c.dataset.sigil)));
        }
        const foot = root.querySelector('#wz-foot');
        if (foot) {
            const showRematch = G.phase === 'matchover' && (G.isHost || G.solo);
            const rb = foot.querySelector('#wz-rematch');
            if (rb) rb.style.display = showRematch ? '' : 'none';
            const wait = foot.querySelector('#wz-wait');
            if (wait) wait.style.display = (G.phase === 'matchover' && !G.isHost && !G.solo) ? '' : 'none';
        }
    }

    function paintSigil(canvas, spell, opts) {
        if (!canvas || !spell) return;
        const c = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const pad = (opts && opts.pad) || 5;
        c.clearRect(0, 0, w, h);
        const s = Math.min(w, h) - pad * 2;
        c.save();
        c.translate(pad + (w - pad * 2 - s) / 2, pad + (h - pad * 2 - s) / 2);
        c.scale(s / 100, s / 100);
        c.strokeStyle = (opts && opts.color) || elColor(spell.el);
        c.lineWidth = (opts && opts.width) || 6;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        const upTo = opts && opts.progress !== undefined ? opts.progress : 1;
        const total = spell.glyph.reduce((a, st) => a + st.length, 0);
        let drawn = 0;
        spell.glyph.forEach(st => {
            c.beginPath();
            for (let i = 0; i < st.length; i++) {
                if (drawn / total > upTo) break;
                drawn++;
                if (i === 0) c.moveTo(st[i].x, st[i].y); else c.lineTo(st[i].x, st[i].y);
            }
            c.stroke();
        });
        c.restore();
    }

    // ===============================================================
    // 10. SCREENS
    // ===============================================================
    function startDuel(session, opts) {
        ensureWindow('wizardz 98');
        stopLoop();
        if (G && G._unbind) G._unbind();
        if (G && G._netOffs) G._netOffs.forEach(off => off());
        if (G && G._chromeTimer) clearInterval(G._chromeTimer);
        G = makeDuel(session, opts || {});
        root.innerHTML = `
            <div class="wz-arena-wrap">
                <canvas id="wz-canvas" width="${A.W}" height="${A.H}" class="wz-canvas"></canvas>
            </div>
            <div id="wz-strip" class="wz-strip"></div>
            <div id="wz-foot" class="wz-foot">
                <button class="wz-btn" id="wz-up">▲ up</button>
                <button class="wz-btn" id="wz-down">▼ down</button>
                <button class="wz-btn" id="wz-book">grimoire</button>
                <button class="wz-btn" id="wz-load">loadout</button>
                <button class="wz-btn wz-go" id="wz-rematch" style="display:none">rematch</button>
                <span id="wz-wait" class="wz-wait" style="display:none">waiting for the host...</span>
                <button class="wz-btn" id="wz-quit">leave duel</button>
            </div>`;
        cv = root.querySelector('#wz-canvas');
        ctx = cv.getContext('2d');
        bindInput(G);
        bindNet(G);
        renderChrome();

        const hold = (btn, dir) => {
            const on = e => { e.preventDefault(); touchMove(G, dir, true); };
            const off = e => { e.preventDefault(); touchMove(G, dir, false); };
            btn.addEventListener('mousedown', on); btn.addEventListener('touchstart', on, { passive: false });
            btn.addEventListener('mouseup', off); btn.addEventListener('mouseleave', off);
            btn.addEventListener('touchend', off);
        };
        hold(root.querySelector('#wz-up'), 'up');
        hold(root.querySelector('#wz-down'), 'down');
        root.querySelector('#wz-book').onclick = () => openGrimoire();
        root.querySelector('#wz-load').onclick = () => openLoadout();
        root.querySelector('#wz-rematch').onclick = () => restartMatch(G);
        root.querySelector('#wz-quit').onclick = () => {
            if (G.session && !G.solo && G.session.alive) G.session.leave();
            openMenu();
        };
        // keep the cooldown numbers honest without redrawing the dom every frame
        clearInterval(G._chromeTimer);
        G._chromeTimer = setInterval(() => { if (G) renderChrome(); }, 400);
        lastT = performance.now();
        stopLoop();
        raf = requestAnimationFrame(loop);
        if (typeof unlockAchievement === 'function') unlockAchievement('wizardz');
    }

    function openMenu() {
        ensureWindow('wizardz 98');
        stopLoop();
        if (G && G._unbind) G._unbind();
        if (G && G._chromeTimer) clearInterval(G._chromeTimer);
        G = null; cv = null; ctx = null;
        const av = myAvatar();
        root.innerHTML = `
            <div class="wz-menu">
                <div class="wz-title">wizardz 98</div>
                <div class="wz-sub">two wizards. fifty sigils. no buttons — you draw the spells.</div>
                <div class="wz-menu-grid">
                    <div class="wz-menu-side">
                        <canvas id="wz-me" width="150" height="170"></canvas>
                        <div class="wz-me-name" id="wz-me-name"></div>
                        <button class="wz-btn wz-wide" id="wz-edit">customise wizard</button>
                    </div>
                    <div class="wz-menu-main">
                        <button class="wz-btn wz-go wz-wide" id="wz-mp">1 v 1 — play someone (invite code)</button>
                        <button class="wz-btn wz-go wz-wide" id="wz-solo">1 v bot — pick an opponent</button>
                        <button class="wz-btn wz-wide" id="wz-quick">quick duel vs a random bot</button>
                        <div class="wz-row">
                            <label>difficulty</label>
                            <select id="wz-diff" class="wz-input">
                                <option value="easy">easy</option>
                                <option value="normal">normal</option>
                                <option value="hard">hard</option>
                            </select>
                        </div>
                        <button class="wz-btn wz-wide" id="wz-book2">grimoire — all 50 sigils</button>
                        <button class="wz-btn wz-wide" id="wz-load2">quick reference loadout</button>
                        <div class="wz-hint">
                            draw a sigil anywhere on the arena to cast it. W/S or the arrow keys
                            dodge up and down. mana refills on its own; the big spells do not.
                        </div>
                    </div>
                </div>
            </div>`;
        const meCv = root.querySelector('#wz-me');
        const nameEl = root.querySelector('#wz-me-name');
        const prof = window.Netplay ? Netplay.profile() : { name: 'you' };
        nameEl.textContent = prof.name + ' — ' + (av.title || 'apprentice');
        let t0 = performance.now();
        const spin = () => {
            if (!document.body.contains(meCv)) return;
            const c = meCv.getContext('2d');
            c.clearRect(0, 0, meCv.width, meCv.height);
            drawWizard(c, av, meCv.width / 2, meCv.height - 12, 1.25, { time: (performance.now() - t0) / 1000, face: 1 });
            requestAnimationFrame(spin);
        };
        spin();
        const diff = root.querySelector('#wz-diff');
        diff.value = difficulty();
        diff.onchange = () => localStorage.setItem(LS.diff, diff.value);
        root.querySelector('#wz-edit').onclick = () => openAvatarEditor();
        root.querySelector('#wz-book2').onclick = () => openGrimoire();
        root.querySelector('#wz-load2').onclick = () => openLoadout();
        root.querySelector('#wz-solo').onclick = () => openBotPicker();
        root.querySelector('#wz-quick').onclick = () => startBotDuel();
        root.querySelector('#wz-mp').onclick = () => {
            if (window.Netplay) Netplay.openLobby({ gameId: 'wizardz' });
            else showToast('wizardz', 'netplay is not loaded');
        };
    }

    // ---------------------------------------------------------------
    // 1 v bot — the roster
    //
    // Six opponents, each with its own hands and its own taste in
    // spells. They run through exactly the same simulation a human
    // opponent does; the only thing they skip is the drawing.
    // ---------------------------------------------------------------
    function startBotDuel(botId) {
        const s = window.Netplay ? Netplay.soloSession('wizardz') : null;
        ensureWindow('wizardz 98');
        startDuel(s, { solo: true, botId: botId });
    }

    function openBotPicker() {
        ensureWindow('wizardz 98');
        stopLoop();
        if (G && G._unbind) G._unbind();
        if (G && G._chromeTimer) clearInterval(G._chromeTimer);
        G = null; cv = null; ctx = null;
        const tierColor = { easy: '#7ee06a', normal: '#ffe14d', hard: '#e4485f' };
        root.innerHTML = `
            <div class="wz-menu">
                <div class="wz-title">1 v bot</div>
                <div class="wz-sub">pick something to duel. they all cheat in different directions.</div>
                <div class="wz-row">
                    <label>difficulty</label>
                    <select id="wz-diff3" class="wz-input">
                        <option value="easy">easy — slower hands</option>
                        <option value="normal">normal — as written</option>
                        <option value="hard">hard — faster, dodgier, tidier sigils</option>
                    </select>
                </div>
                <div class="wz-bots">
                    ${D.BOTS.map(b => `
                        <button class="wz-bot" data-bot="${escapeHtml(b.id)}">
                            <canvas width="86" height="104" data-botav="${escapeHtml(b.id)}"></canvas>
                            <div class="wz-bot-name">${escapeHtml(b.name)}</div>
                            <div class="wz-bot-title">${escapeHtml(b.title)}</div>
                            <div class="wz-bot-tier" style="color:${tierColor[b.tier] || '#fff'}">${escapeHtml(b.tier)}</div>
                            <div class="wz-bot-blurb">${escapeHtml(b.blurb)}</div>
                            <div class="wz-bot-els">${(b.style.els || []).map(e =>
                                `<span style="color:${elColor(e)}">${escapeHtml(e)}</span>`).join(' · ')}</div>
                        </button>`).join('')}
                </div>
                <div class="wz-foot">
                    <button class="wz-btn" id="wz-bot-random">surprise me</button>
                    <button class="wz-btn" id="wz-bot-back">back</button>
                </div>
            </div>`;
        const diff = root.querySelector('#wz-diff3');
        diff.value = difficulty();
        diff.onchange = () => localStorage.setItem(LS.diff, diff.value);
        const t0 = performance.now();
        const cvs = [...root.querySelectorAll('canvas[data-botav]')];
        const spin = () => {
            if (!cvs.length || !document.body.contains(cvs[0])) return;
            cvs.forEach(cv2 => {
                const b = D.botById(cv2.dataset.botav);
                const c = cv2.getContext('2d');
                c.clearRect(0, 0, cv2.width, cv2.height);
                drawWizard(c, b.avatar, cv2.width / 2, cv2.height - 6, 0.78, { time: (performance.now() - t0) / 1000, face: 1 });
            });
            requestAnimationFrame(spin);
        };
        spin();
        root.querySelectorAll('.wz-bot').forEach(b => b.onclick = () => startBotDuel(b.dataset.bot));
        root.querySelector('#wz-bot-random').onclick = () => startBotDuel();
        root.querySelector('#wz-bot-back').onclick = () => openMenu();
    }

    // ---------------------------------------------------------------
    // grimoire — every sigil, drawn out, with a place to practise
    // ---------------------------------------------------------------
    function openGrimoire() {
        const { body } = createAppWindow('grimoire — 50 sigils', { icon: 'auto_stories', width: 560 });
        body.classList.add('wz-book');
        let filter = 'all';
        let picked = D.SPELLS[0];
        function draw() {
            const list = filter === 'all' ? D.SPELLS : D.SPELLS.filter(s => s.el === filter);
            body.innerHTML = `
                <div class="wz-book-tabs">
                    <button class="wz-tab ${filter === 'all' ? 'on' : ''}" data-el="all">all 50</button>
                    ${Object.keys(D.EL).map(k => `<button class="wz-tab ${filter === k ? 'on' : ''}" data-el="${k}" style="color:${D.EL[k].color}">${k}</button>`).join('')}
                </div>
                <div class="wz-book-body">
                    <div class="wz-book-list">
                        ${list.map(s => `<button class="wz-book-item ${s.id === picked.id ? 'on' : ''}" data-id="${s.id}">
                            <canvas width="34" height="34" data-sigil="${s.id}"></canvas>
                            <span style="color:${elColor(s.el)}">${escapeHtml(s.name)}</span>
                        </button>`).join('')}
                    </div>
                    <div class="wz-book-detail">
                        <canvas id="wz-big" width="180" height="180"></canvas>
                        <div class="wz-book-name" style="color:${elColor(picked.el)}">${escapeHtml(picked.name)}</div>
                        <div class="wz-book-meta">${picked.el} · ${picked.kind} · ${picked.cost || 0} mana${picked.hp ? ' + ' + picked.hp + ' hp' : ''} · ${picked.cd}s</div>
                        <div class="wz-book-blurb">${escapeHtml(picked.blurb)}</div>
                        ${picked.dmg ? `<div class="wz-book-meta">damage ${picked.dmg}</div>` : ''}
                        <button class="wz-btn wz-wide" id="wz-practise">practise this sigil</button>
                    </div>
                </div>`;
            body.querySelectorAll('canvas[data-sigil]').forEach(c => paintSigil(c, D.byId(c.dataset.sigil), { width: 8 }));
            body.querySelectorAll('.wz-tab').forEach(b => b.onclick = () => { filter = b.dataset.el; draw(); });
            body.querySelectorAll('.wz-book-item').forEach(b => b.onclick = () => { picked = D.byId(b.dataset.id); draw(); });
            body.querySelector('#wz-practise').onclick = () => openTrainer(picked);
            // animate the big one being drawn, once
            const big = body.querySelector('#wz-big');
            let p = 0, t0 = performance.now();
            const anim = () => {
                if (!document.body.contains(big)) return;
                p = Math.min(1.4, (performance.now() - t0) / 900);
                paintSigil(big, picked, { width: 9, progress: Math.min(1, p) });
                if (p < 1.4) requestAnimationFrame(anim);
            };
            anim();
        }
        draw();
    }

    // draw the sigil, get scored on it. also the honest way to find out
    // whether your circle is a circle.
    function openTrainer(spell) {
        const { body } = createAppWindow('practise: ' + spell.name, { icon: 'draw', width: 380 });
        body.classList.add('wz-train');
        body.innerHTML = `
            <div class="wz-train-row">
                <canvas id="wz-ref" width="150" height="150"></canvas>
                <canvas id="wz-pad" width="180" height="180" class="wz-pad"></canvas>
            </div>
            <div id="wz-score" class="wz-score">draw it on the right</div>
            <button class="wz-btn wz-wide" id="wz-clear">clear</button>`;
        paintSigil(body.querySelector('#wz-ref'), spell, { width: 8 });
        const pad = body.querySelector('#wz-pad'), pctx = pad.getContext('2d');
        let strokes = [], cur = null, timer = null;
        const redraw = () => {
            pctx.clearRect(0, 0, pad.width, pad.height);
            pctx.strokeStyle = '#0df259'; pctx.lineWidth = 3; pctx.lineCap = 'round'; pctx.lineJoin = 'round';
            strokes.forEach(s => {
                if (s.length < 2) return;
                pctx.beginPath(); pctx.moveTo(s[0].x, s[0].y);
                for (let i = 1; i < s.length; i++) pctx.lineTo(s[i].x, s[i].y);
                pctx.stroke();
            });
        };
        const at = ev => {
            const r = pad.getBoundingClientRect();
            const p = ev.touches ? ev.touches[0] : ev;
            return { x: (p.clientX - r.left) * (pad.width / r.width), y: (p.clientY - r.top) * (pad.height / r.height) };
        };
        const score = () => {
            const res = recognize(strokes);
            const el = body.querySelector('#wz-score');
            if (!res.length) return;
            const mine = res.find(r => r.id === spell.id);
            const best = res[0];
            const pct = Math.round((mine ? mine.score : 0) * 100);
            if (best.id === spell.id && best.score >= CAST_FLOOR) {
                el.innerHTML = `<b style="color:#0df259">${pct}% — that would cast</b>`;
            } else if (best.id === spell.id) {
                el.innerHTML = `<b style="color:#ffe14d">${pct}% — closest match, but too rough to fire</b>`;
            } else {
                el.innerHTML = `<b style="color:#ff9aa8">${pct}% — the game read that as ${escapeHtml(best.spell.name)}</b>`;
            }
        };
        const down = e => { e.preventDefault(); cur = [at(e)]; strokes.push(cur); clearTimeout(timer); };
        const move = e => { if (!cur) return; e.preventDefault(); cur.push(at(e)); redraw(); };
        const up = () => { if (!cur) return; cur = null; redraw(); clearTimeout(timer); timer = setTimeout(score, 400); };
        pad.addEventListener('mousedown', down); pad.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        pad.addEventListener('touchstart', down, { passive: false });
        pad.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('touchend', up);
        body.querySelector('#wz-clear').onclick = () => { strokes = []; redraw(); body.querySelector('#wz-score').textContent = 'draw it on the right'; };
    }

    // ---------------------------------------------------------------
    // loadout — which eight sigils sit under the arena
    // ---------------------------------------------------------------
    function openLoadout() {
        const { body } = createAppWindow('quick reference loadout', { icon: 'bookmark', width: 520 });
        body.classList.add('wz-book');
        let loadout = myLoadout();
        function draw() {
            body.innerHTML = `
                <div class="wz-load-top">pick eight sigils to keep on the strip under the arena. you can still
                cast any of the fifty — this is only your cheat sheet.</div>
                <div class="wz-load-row" id="wz-chosen"></div>
                <div class="wz-book-list wz-load-all" id="wz-all"></div>`;
            const chosen = body.querySelector('#wz-chosen');
            chosen.innerHTML = loadout.map((id, i) => {
                const s = D.byId(id);
                return `<button class="wz-card" data-slot="${i}"><canvas width="40" height="40" data-sigil="${id}"></canvas>
                    <div class="wz-card-name" style="color:${elColor(s.el)}">${escapeHtml(s.name)}</div></button>`;
            }).join('');
            const all = body.querySelector('#wz-all');
            all.innerHTML = D.SPELLS.map(s => `<button class="wz-book-item ${loadout.includes(s.id) ? 'on' : ''}" data-id="${s.id}">
                <canvas width="30" height="30" data-sigil="${s.id}"></canvas>
                <span style="color:${elColor(s.el)}">${escapeHtml(s.name)}</span></button>`).join('');
            body.querySelectorAll('canvas[data-sigil]').forEach(c => paintSigil(c, D.byId(c.dataset.sigil), { width: 8 }));
            let slot = 0;
            body.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => {
                slot = +b.dataset.slot;
                body.querySelectorAll('[data-slot]').forEach(x => x.classList.remove('on'));
                b.classList.add('on');
            });
            all.querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
                loadout[slot] = b.dataset.id;
                slot = (slot + 1) % 8;
                saveLoadout(loadout);
                draw();
                renderChrome();
            });
        }
        draw();
    }

    // ---------------------------------------------------------------
    // the dressing room
    // ---------------------------------------------------------------
    function openAvatarEditor() {
        const { body } = createAppWindow('customise wizard', { icon: 'face', width: 480 });
        body.classList.add('wz-dress');
        let av = myAvatar();
        const parts = [
            ['hat', 'hat', D.AVATAR.hat], ['hatColor', 'hat colour', D.AVATAR.palette],
            ['hair', 'hair', D.AVATAR.hair], ['hairColor', 'hair colour', D.AVATAR.palette],
            ['beard', 'beard', D.AVATAR.beard], ['skin', 'skin', D.AVATAR.skin],
            ['eyes', 'eyes', D.AVATAR.eyes], ['robe', 'robe', D.AVATAR.robe],
            ['robeColor', 'robe colour', D.AVATAR.palette], ['trimColor', 'trim colour', D.AVATAR.palette],
            ['staff', 'staff', D.AVATAR.staff], ['familiar', 'familiar', D.AVATAR.familiar],
            ['aura', 'aura', D.AVATAR.aura], ['title', 'title', D.AVATAR.titles]
        ];
        body.innerHTML = `
            <div class="wz-dress-wrap">
                <div class="wz-dress-view">
                    <canvas id="wz-dress-cv" width="180" height="200"></canvas>
                    <div class="wz-row">
                        <input id="wz-dress-name" class="wz-input" maxlength="16" value="${escapeHtml(window.Netplay ? Netplay.profile().name : 'wizard')}">
                    </div>
                    <button class="wz-btn wz-wide" id="wz-random">randomise everything</button>
                    <button class="wz-btn wz-go wz-wide" id="wz-save">save</button>
                </div>
                <div class="wz-dress-parts">
                    ${parts.map(([key, label, list]) => `
                        <div class="wz-part" data-key="${key}">
                            <button class="wz-btn wz-tiny" data-dir="-1">◄</button>
                            <div class="wz-part-label"><span>${label}</span><b id="wz-v-${key}"></b></div>
                            <button class="wz-btn wz-tiny" data-dir="1">►</button>
                        </div>`).join('')}
                </div>
            </div>`;
        const cvd = body.querySelector('#wz-dress-cv');
        const cd = cvd.getContext('2d');
        const t0 = performance.now();
        const paintVals = () => parts.forEach(([key]) => {
            const el = body.querySelector('#wz-v-' + key);
            if (!el) return;
            const v = av[key];
            if (String(v).startsWith('#')) { el.textContent = '■'; el.style.color = v; }
            else { el.textContent = v; el.style.color = '#ffe14d'; }
        });
        const spin = () => {
            if (!document.body.contains(cvd)) return;
            cd.clearRect(0, 0, cvd.width, cvd.height);
            drawWizard(cd, av, cvd.width / 2, cvd.height - 14, 1.5, { time: (performance.now() - t0) / 1000, face: 1 });
            requestAnimationFrame(spin);
        };
        spin();
        paintVals();
        body.querySelectorAll('.wz-part').forEach(row => {
            const key = row.dataset.key;
            const list = (parts.find(p => p[0] === key) || [])[2] || [];
            row.querySelectorAll('button[data-dir]').forEach(b => b.onclick = () => {
                const i = Math.max(0, list.indexOf(av[key]));
                av[key] = list[(i + list.length + (+b.dataset.dir)) % list.length];
                paintVals();
                if (typeof playSound === 'function') playSound('click');
            });
        });
        body.querySelector('#wz-random').onclick = () => { av = D.randomAvatar(); paintVals(); };
        body.querySelector('#wz-save').onclick = () => {
            saveAvatar(av);
            const n = body.querySelector('#wz-dress-name').value.trim();
            if (n && window.Netplay) Netplay.setName(n);
            if (G) G.wiz[G.me].avatar = normAvatar(av);
            showToast && showToast('wizardz', 'your wizard is saved');
            if (typeof playSound === 'function') playSound('ding');
        };
    }

    // ===============================================================
    // 11. WIRING
    // ===============================================================
    if (window.Netplay) {
        window.Netplay.registerGame({
            id: 'wizardz',
            name: 'wizardz 98',
            start: (session, opts) => startDuel(session, opts),
            startSolo: () => openBotPicker(),
            soloLabel: '1 v bot — pick an opponent',
            paintAvatar,
            editAvatar: openAvatarEditor
        });
    }

    window.startWizardz = function (mode, botId) {
        if (mode === 'solo') { startBotDuel(botId); return; }
        if (mode === 'bot' || mode === 'bots') { openBotPicker(); return; }
        openMenu();
    };
    window.wizardzGrimoire = openGrimoire;
    window.wizardzAvatar = openAvatarEditor;
    window.wizardzBots = openBotPicker;
    // handy for the console, and for the check script. state() hands out
    // the live duel so a test can ask whether that fireball landed.
    window.WZ_ENGINE = {
        recognize, featuresOf, similarity, templates, paintSigil, drawWizard,
        CAST_FLOOR, CAST_MARGIN, state: () => G
    };
})();
