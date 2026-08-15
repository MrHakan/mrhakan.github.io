// ===================================================================
// charts.js — the performance tab, drawn the way perfmon drew it
//
// The idea is lifted from bklit-ui: charts as small composable pieces
// (a grid, an axis, a series, a legend) that you assemble rather than a
// monolithic widget with forty options. bklit itself is React on top of
// shadcn, which is three dependencies this site does not have, so what
// is borrowed is the shape — every chart here takes a canvas and a
// description of what to draw, and nothing else.
//
// Everything renders on a 2d canvas at device resolution, in the
// palette of a 1998 system monitor: black panel, green grid, one bright
// line per series.
// ===================================================================

(function () {
    'use strict';

    const PALETTE = {
        panel: '#000000',
        grid: '#0a3d20',
        ink: '#0df259',
        warn: '#ffe14d',
        hot: '#ff5c5c',
        text: '#7bdca0'
    };

    // canvas pixels are not css pixels — without this every line is a
    // grey smear on a retina screen
    function surface(canvas) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = canvas.clientWidth || canvas.width || 200;
        const h = canvas.clientHeight || canvas.height || 80;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        return { ctx, w, h };
    }

    // ---------- the pieces ----------
    function panel(ctx, w, h) {
        ctx.fillStyle = PALETTE.panel;
        ctx.fillRect(0, 0, w, h);
    }
    // a fixed grid rather than one that follows the data: the point of
    // this chart is that the *shape* moves and the ruler does not
    function grid(ctx, w, h, cols, rows, offset) {
        ctx.strokeStyle = PALETTE.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const stepX = w / (cols || 10), stepY = h / (rows || 4);
        for (let i = 0; i <= (rows || 4); i++) {
            const y = Math.round(i * stepY) + 0.5;
            ctx.moveTo(0, y); ctx.lineTo(w, y);
        }
        for (let i = 0; i <= (cols || 10); i++) {
            const x = Math.round(i * stepX - (offset || 0) % stepX) + 0.5;
            ctx.moveTo(x, 0); ctx.lineTo(x, h);
        }
        ctx.stroke();
    }
    function series(ctx, w, h, points, opts) {
        if (!points || points.length < 2) return;
        const o = opts || {};
        const max = o.max === undefined ? 100 : o.max;
        const min = o.min || 0;
        const at = i => ({
            x: (i / (points.length - 1)) * w,
            y: h - ((Math.max(min, Math.min(max, points[i])) - min) / (max - min || 1)) * h
        });
        if (o.fill) {
            const g = ctx.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, o.fill);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(0, h);
            for (let i = 0; i < points.length; i++) { const p = at(i); ctx.lineTo(p.x, p.y); }
            ctx.lineTo(w, h);
            ctx.closePath();
            ctx.fill();
        }
        ctx.strokeStyle = o.color || PALETTE.ink;
        ctx.lineWidth = o.width || 1.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const p = at(i);
            i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        }
        ctx.stroke();
    }
    function label(ctx, w, h, text, opts) {
        const o = opts || {};
        ctx.fillStyle = o.color || PALETTE.text;
        ctx.font = (o.size || 9) + "px 'Courier New', monospace";
        ctx.textBaseline = 'top';
        ctx.fillText(text, o.x === undefined ? 4 : o.x, o.y === undefined ? 3 : o.y);
    }

    // ---------- assembled charts ----------
    // a scrolling history line, the shape every task manager has had
    // since nt 4
    function history(canvas, opts) {
        const o = opts || {};
        const { ctx, w, h } = surface(canvas);
        panel(ctx, w, h);
        grid(ctx, w, h, o.cols || 12, o.rows || 4, o.scroll || 0);
        (o.series || []).forEach(s => series(ctx, w, h, s.points, {
            max: o.max, min: o.min, color: s.color, fill: s.fill, width: s.width
        }));
        if (o.label) label(ctx, w, h, o.label, { color: o.labelColor });
        return { ctx, w, h };
    }
    // horizontal bars — one row per thing, sorted by whoever passes them
    function bars(canvas, opts) {
        const o = opts || {};
        const { ctx, w, h } = surface(canvas);
        panel(ctx, w, h);
        const items = o.items || [];
        if (!items.length) return { ctx, w, h };
        const max = o.max || Math.max.apply(null, items.map(i => i.value)) || 1;
        const rowH = h / items.length;
        items.forEach((it, i) => {
            const y = i * rowH, barH = Math.max(3, rowH - 3);
            const width = Math.max(1, (it.value / max) * (w - 60));
            ctx.fillStyle = it.color || PALETTE.ink;
            ctx.fillRect(56, y + (rowH - barH) / 2, width, barH);
            ctx.fillStyle = PALETTE.text;
            ctx.font = "9px 'Courier New', monospace";
            ctx.textBaseline = 'middle';
            ctx.fillText(String(it.label).slice(0, 9), 2, y + rowH / 2);
        });
        return { ctx, w, h };
    }
    // one number, drawn as a ring, for "how much of the thing is done"
    function ring(canvas, opts) {
        const o = opts || {};
        const { ctx, w, h } = surface(canvas);
        panel(ctx, w, h);
        const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 6;
        const frac = Math.max(0, Math.min(1, (o.value || 0) / (o.max || 100)));
        ctx.lineWidth = o.thickness || 7;
        ctx.strokeStyle = PALETTE.grid;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = o.color || PALETTE.ink;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = o.color || PALETTE.ink;
        ctx.font = "bold 13px 'Courier New', monospace";
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(o.text || Math.round(frac * 100) + '%', cx, cy);
        ctx.textAlign = 'start';
        return { ctx, w, h };
    }

    // a fixed-length history you push into — the chart reads it, nobody
    // has to remember to trim it
    function track(length, initial) {
        const arr = new Array(length).fill(initial === undefined ? 0 : initial);
        return {
            points: arr,
            push(v) { arr.push(v); if (arr.length > length) arr.shift(); return arr; },
            peak() { return Math.max.apply(null, arr); },
            mean() { return arr.reduce((a, b) => a + b, 0) / arr.length; }
        };
    }

    window.Charts = { PALETTE, surface, panel, grid, series, label, history, bars, ring, track };
})();
