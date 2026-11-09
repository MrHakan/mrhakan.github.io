// Sixteen separate rigid bitmap attachments per fighter. Canvas transforms
// follow the bone hierarchy; there are no full-body frames or mesh warps.
(function (root) {
    'use strict';
    const A = root.RIFT_ANIM, CELL = 128, fighters = [];
    const names = ['joe-cool', 'dusung', 'hothead', 'bebetrol', 'zirlak', 'hehe', 'nasiya', 'patron', 'sahur', 'oleey', 'yeter', 'pffft'];
    const weaponW = [24, 35, 0, 29, 16, 22, 32, 24, 27, 36, 35, 0], weaponH = [9, 12, 0, 27, 16, 9, 18, 27, 24, 9, 25, 0];
    let resolveReady, rejectReady;
    const loaded = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    loaded.catch(() => {});
    const ready = () => names.every((_, i) => !!fighters[i]);
    function regions(image) {
        const cv = document.createElement('canvas'); cv.width = cv.height = 512;
        const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(image, 0, 0);
        const d = c.getImageData(0, 0, 512, 512).data, boxes = [];
        for (let part = 0; part < 16; part++) {
            const ox = part % 4 * CELL, oy = Math.floor(part / 4) * CELL;
            let l = CELL, t = CELL, r = 0, b = 0;
            for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (d[((oy + y) * 512 + ox + x) * 4 + 3] > 100) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); }
            if (l > r || t > b) throw new Error('Empty fighter attachment: ' + part);
            boxes.push({ x: ox + l, y: oy + t, w: r - l + 1, h: b - t + 1 });
        }
        return boxes;
    }
    names.forEach((name, character) => {
        const image = new Image(); image.decoding = 'async';
        image.onload = () => {
            try {
                if (image.naturalWidth !== 512 || image.naturalHeight !== 512) throw new Error('Invalid cutout atlas.');
                fighters[character] = { image, boxes: regions(image) }; if (ready()) resolveReady();
            } catch (error) { rejectReady(error); }
        };
        image.onerror = () => rejectReady(new Error('Fighter rig could not load. Reload the game to try again.'));
        image.src = 'games/rift-rumble/art/rig-' + name + '.png';
    });
    function paint(c, x, y, character, opts = {}) {
        const f = fighters[character]; if (!f) return false;
        const animation = opts.animation, pose = animation?.pose || A.rest(character), bones = animation?.bones || A.solve(pose);
        const scale = (opts.scale || 1.25) * A.SCALE;
        c.save(); c.translate(x, y); c.scale((opts.facing || 1) * scale, scale);
        c.globalAlpha *= opts.alpha === undefined ? 1 : opts.alpha;
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        function part(index, boneName, height, px = 0.5, py = 0, rotation = -Math.PI / 2, maxW = Infinity) {
            const b = bones[boneName], box = f.boxes[index], k = Math.min(height / box.h, maxW / box.w), w = box.w * k, h = box.h * k;
            c.save(); c.translate(b.x, b.y); c.rotate(b.a + rotation);
            c.drawImage(f.image, box.x, box.y, box.w, box.h, -w * px, -h * py, w, h); c.restore();
        }
        const weapon = () => {
            if (!weaponW[character]) return;
            const b = bones.weapon, box = f.boxes[3], k = Math.min(weaponW[character] / box.w, weaponH[character] / box.h);
            c.save(); c.translate(b.x, b.y); c.rotate(b.a);
            c.drawImage(f.image, box.x, box.y, box.w, box.h, -box.w * k * 0.1, -box.h * k * 0.5, box.w * k, box.h * k); c.restore();
        };
        // The far upper arm stays behind the torso; its forearm and hand come
        // in front when they swing across the chest, rather than disappearing.
        const rearInFront = bones.bHand.x > bones.bUpper.x + 1;
        const rearForearm = () => {
            part(7, 'bLower', 16, 0.5, 2 / 16);
            part(13, 'bHand', character === 2 || character === 11 ? 11 : 9, 0.5, 0.12);
        };
        part(6, 'bUpper', 16, 0.5, 3 / 16);
        if (!rearInFront) rearForearm();
        part(10, 'bThigh', 23, 0.5, 3 / 23); part(11, 'bShin', 21, 0.5, 3 / 21); part(15, 'bFoot', 10, 0.34, 0.4, 0);
        part(8, 'fThigh', 23, 0.5, 3 / 23); part(9, 'fShin', 21, 0.5, 3 / 21); part(14, 'fFoot', 10, 0.34, 0.4, 0);
        if (pose.weaponLayer < 0.5) weapon();
        part(2, 'pelvis', 13, 0.5, 0.4, 0);
        part(1, 'torso', 27, 0.5, 0.88, 0);
        if (rearInFront) rearForearm();
        part(0, 'head', 32, 0.5, 0.96, 0, 42);
        part(4, 'fUpper', 16, 0.5, 3 / 16); part(5, 'fLower', 16, 0.5, 2 / 16);
        part(12, 'fHand', character === 2 || character === 11 ? 11 : 9, 0.5, 0.12);
        if (pose.weaponLayer >= 0.5) weapon();
        if (opts.debug) {
            c.strokeStyle = '#62f6d8'; c.fillStyle = '#fff1a8'; c.lineWidth = 0.65;
            for (const b of Object.values(bones)) {
                const parent = bones[b.parent];
                if (parent) { c.beginPath(); c.moveTo(parent.x, parent.y); c.lineTo(b.x, b.y); c.stroke(); }
                c.beginPath(); c.arc(b.x, b.y, 1.4, 0, Math.PI * 2); c.fill();
            }
        }
        c.restore(); return true;
    }
    root.RIFT_ART = { paint, ready, whenReady: () => loaded, metrics: () => fighters.map((f, character) => ({ character, parts: f.boxes.length, width: 512, height: 512 })) };
})(window);
