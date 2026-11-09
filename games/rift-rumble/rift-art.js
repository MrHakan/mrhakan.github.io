// Runtime rigging of the generated characters. Every action reuses one texture.
// The other generated poses remain in the source sheets as concept references.
(function (root) {
    'use strict';
    const A = root.RIFT_ANIM, CELL = 144, ROOT_X = 72, ROOT_Y = 108, rigs = [], jobs = [];
    let pumping = false;
    let resolveReady, rejectReady;
    const loaded = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    loaded.catch(() => {});
    const ready = () => Array.from({ length: 12 }, (_, i) => rigs[i]?.frames === A.COUNT).every(Boolean);
    const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
    function components(w, h, accept) {
        const labels = new Int32Array(w * h), queue = new Int32Array(w * h), list = [];
        for (let start = 0; start < labels.length; start++) {
            if (labels[start] || !accept(start)) continue;
            const id = list.length + 1, box = { id, size: 0, left: w, top: h, right: 0, bottom: 0 };
            let head = 0, tail = 1; queue[0] = start; labels[start] = id;
            while (head < tail) {
                const p = queue[head++], x = p % w, y = Math.floor(p / w);
                box.size++; box.left = Math.min(box.left, x); box.right = Math.max(box.right, x); box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y);
                for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
                    const q = yy * w + xx;
                    if (!labels[q] && accept(q)) { labels[q] = id; queue[tail++] = q; }
                }
            }
            list.push(box);
        }
        return { labels, list: list.sort((a, b) => b.size - a.size) };
    }
    function prepare(image, character, row) {
        const w = Math.floor(image.naturalWidth / 4), y = Math.round(row * image.naturalHeight / 3), h = Math.round((row + 1) * image.naturalHeight / 3) - y;
        const texture = canvas(w, h), c = texture.getContext('2d', { willReadFrequently: true });
        c.drawImage(image, 0, y, w, h, 0, 0, w, h);
        const pixels = c.getImageData(0, 0, w, h), data = pixels.data;
        const all = components(w, h, p => data[p * 4 + 3] >= 96), main = all.list[0];
        if (!main) throw new Error('Empty fighter texture: ' + character);
        const keep = new Set(all.list.filter(b => b.size >= Math.max(90, main.size * 0.004) && b.left < main.right + 25 && b.right > main.left - 25 && b.top < main.bottom + 25 && b.bottom > main.top - 25).map(b => b.id));
        const box = { left: w, right: 0, top: h, bottom: 0 };
        for (let p = 0; p < w * h; p++) {
            if (!keep.has(all.labels[p])) { data[p * 4 + 3] = 0; continue; }
            const x = p % w, y = Math.floor(p / w);
            box.left = Math.min(box.left, x); box.right = Math.max(box.right, x); box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y);
        }
        c.putImageData(pixels, 0, 0);
        const ivory = [1, 3, 5, 6, 7, 8, 10].includes(character);
        const faces = components(w, h, p => {
            const y = Math.floor(p / w), r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
            return data[p * 4 + 3] > 150 && y < box.top + (box.bottom - box.top) * 0.62 && (ivory ? r > 155 && g > 145 && b > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 95 : r > 160 && g > 95 && b < g * 0.88);
        });
        const face = faces.list[0], rootX = face ? (face.left + face.right) / 2 : (box.left + box.right) / 2;
        const k = 76 / (box.bottom - box.top + 1);
        const rig = { character, texture, box, k, rootX, rootY: box.bottom, split: 0, armSide: [7, 8, 9, 10].includes(character) ? -1 : 1, headLeft: face ? (face.left - rootX) * k - 2 : -18, headRight: face ? (face.right - rootX) * k + 2 : 18, forehead: face ? (face.top - box.bottom) * k : -65, neck: -32, frames: 0, atlas: canvas(CELL * 10, CELL * 5) };
        for (let p = 0; p < w * h; p++) if (data[p * 4 + 3] > 96) {
            const x = (p % w - rootX) * k, y = (Math.floor(p / w) - box.bottom) * k;
            if (!A.isWeapon(x, y, rig)) continue;
            if (!rig.weaponBox) rig.weaponBox = { left: x, right: x, top: y, bottom: y };
            const b = rig.weaponBox; b.left = Math.min(b.left, x); b.right = Math.max(b.right, x); b.top = Math.min(b.top, y); b.bottom = Math.max(b.bottom, y);
        }
        const neutral = canvas(CELL, CELL), nc = neutral.getContext('2d'); nc.imageSmoothingEnabled = false;
        nc.drawImage(texture, 0, 0, w, h, ROOT_X - rootX * k, ROOT_Y - box.bottom * k, w * k, h * k);
        rig.head = canvas(CELL, CELL);
        const left = Math.floor(ROOT_X + rig.headLeft), top = Math.floor(ROOT_Y + (box.top - box.bottom) * k), right = Math.ceil(ROOT_X + rig.headRight), bottom = ROOT_Y + rig.neck + 1;
        rig.headBox = { left, top, width: right - left, height: bottom - top };
        rig.head.getContext('2d').drawImage(neutral, left, top, right - left, bottom - top, left, top, right - left, bottom - top);
        rig.xs = [...new Set([box.left, rootX - 30 / k, rootX - 20 / k, rootX - 12 / k, rootX - 6 / k, rootX, rootX + 6 / k, rootX + 12 / k, rootX + 20 / k, rootX + 30 / k, box.right + 1].filter(x => x >= box.left && x <= box.right + 1))].sort((a, b) => a - b);
        rig.ys = [...new Set([box.top, box.bottom + rig.neck / k, box.bottom - 26 / k, box.bottom - 20 / k, box.bottom - 14 / k, box.bottom - 8 / k, box.bottom - 2 / k, box.bottom + 1].filter(y => y >= box.top && y <= box.bottom + 1))].sort((a, b) => a - b);
        rigs[character] = rig;
        bake(rig, 0);
        for (let frame = 1; frame < A.COUNT; frame++) jobs.push(() => bake(rig, frame));
        pump();
    }
    function triangle(c, texture, s, d) {
        const den = s[0].x * (s[1].y - s[2].y) + s[1].x * (s[2].y - s[0].y) + s[2].x * (s[0].y - s[1].y);
        if (Math.abs(den) < 0.0001) return;
        const coeff = key => [
            (d[0][key] * (s[1].y - s[2].y) + d[1][key] * (s[2].y - s[0].y) + d[2][key] * (s[0].y - s[1].y)) / den,
            (d[0][key] * (s[2].x - s[1].x) + d[1][key] * (s[0].x - s[2].x) + d[2][key] * (s[1].x - s[0].x)) / den,
            (d[0][key] * (s[1].x * s[2].y - s[2].x * s[1].y) + d[1][key] * (s[2].x * s[0].y - s[0].x * s[2].y) + d[2][key] * (s[0].x * s[1].y - s[1].x * s[0].y)) / den
        ];
        const x = coeff('x'), y = coeff('y'), cx = (d[0].x + d[1].x + d[2].x) / 3, cy = (d[0].y + d[1].y + d[2].y) / 3;
        c.save(); c.beginPath();
        d.forEach((p, i) => { const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1; const xx = p.x + dx / len * 0.22, yy = p.y + dy / len * 0.22; if (i) c.lineTo(xx, yy); else c.moveTo(xx, yy); });
        c.closePath(); c.clip(); c.transform(x[0], y[0], x[1], y[1], x[2], y[2]); c.drawImage(texture, 0, 0); c.restore();
    }
    function bake(rig, frame) {
        const c = rig.atlas.getContext('2d'), p = A.pose(frame);
        p.weaponLift = A.weaponLift(p, rig);
        c.setTransform(1, 0, 0, 1, frame % 10 * CELL + ROOT_X, Math.floor(frame / 10) * CELL + ROOT_Y); c.imageSmoothingEnabled = false;
        c.save(); c.beginPath(); c.rect(-ROOT_X, -ROOT_Y, CELL, CELL); c.clip();
        for (let y = 0; y < rig.ys.length - 1; y++) for (let x = 0; x < rig.xs.length - 1; x++) {
            const s = [{ x: rig.xs[x], y: rig.ys[y] }, { x: rig.xs[x + 1], y: rig.ys[y] }, { x: rig.xs[x + 1], y: rig.ys[y + 1] }, { x: rig.xs[x], y: rig.ys[y + 1] }];
            const d = s.map(q => A.vertex((q.x - rig.rootX) * rig.k, (q.y - rig.rootY) * rig.k, p, rig));
            triangle(c, rig.texture, [s[0], s[1], s[2]], [d[0], d[1], d[2]]);
            triangle(c, rig.texture, [s[0], s[2], s[3]], [d[0], d[2], d[3]]);
        }
        // Render the face as one rigid patch. This avoids triangle seam/rounding
        // changes in eyes and mouths, even when the body is leaning or attacking.
        const hx = Math.round(p.lean), hy = Math.round(p.lift + p.crouch), b = rig.headBox;
        c.save(); c.globalCompositeOperation = 'destination-out'; c.fillRect(b.left - ROOT_X + hx, b.top - ROOT_Y + hy, b.width, b.height); c.restore();
        c.drawImage(rig.head, -ROOT_X + hx, -ROOT_Y + hy);
        c.restore();
        rig.frames++;
    }
    function pump() {
        if (pumping) return; pumping = true;
        const work = () => {
            const end = performance.now() + 7;
            do { jobs.shift()?.(); } while (jobs.length && performance.now() < end);
            if (jobs.length) requestAnimationFrame(work); else { pumping = false; if (ready()) resolveReady(); }
        };
        requestAnimationFrame(work);
    }
    for (let sheet = 0; sheet < 4; sheet++) {
        const image = new Image(); image.decoding = 'async';
        image.onload = () => { for (let row = 0; row < 3; row++) jobs.push(() => prepare(image, sheet * 3 + row, row)); pump(); };
        image.onerror = () => rejectReady(new Error('Fighter art could not load. Reload the game to try again.'));
        image.src = 'games/rift-rumble/art/fighters-' + (sheet + 1) + '.png';
    }
    function paint(c, x, y, character, opts = {}) {
        const rig = rigs[character]; if (!rig) return false;
        let frame = opts.animation?.frame || (opts.attack ? A.attackFrame(opts.attack, character) : opts.airborne ? 14 : 0);
        if (rig.frames < A.COUNT) frame = 0;
        const scale = opts.scale || 1.25;
        c.save(); c.translate(Math.round(x), Math.round(y)); c.scale((opts.facing || 1) * scale, scale);
        c.globalAlpha *= opts.alpha === undefined ? 1 : opts.alpha; c.imageSmoothingEnabled = false;
        c.drawImage(rig.atlas, frame % 10 * CELL, Math.floor(frame / 10) * CELL, CELL, CELL, -ROOT_X, -ROOT_Y, CELL, CELL);
        c.restore(); return true;
    }
    root.RIFT_ART = { paint, ready, whenReady: () => loaded, metrics: () => rigs.map((r, character) => ({ character, frames: r.frames, height: 76, neck: r.neck, anchorX: r.rootX, anchorY: r.rootY, headLeft: r.headLeft, headRight: r.headRight })) };
})(window);
