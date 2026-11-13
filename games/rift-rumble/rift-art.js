// Sixteen separate rigid bitmap attachments per fighter. Canvas transforms
// follow the bone hierarchy; there are no full-body frames or mesh warps.
(function (root) {
    'use strict';
    const A = root.RIFT_ANIM, CELL = 128, fighters = [];
    const names = ['joe-cool', 'dusung', 'hothead', 'bebetrol', 'zirlak', 'hehe', 'nasiya', 'patron', 'sahur', 'oleey', 'yeter', 'pffft'];
    const weaponW = [24, 35, 0, 24, 15, 22, 32, 23, 26, 36, 31, 0], weaponH = [9, 12, 0, 23, 15, 9, 18, 20, 20, 9, 23, 0];
    const grips = { 4: [.25, .15], 7: [.5, .1], 8: [.85, .55] };
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
        image.src = 'games/rift-rumble/art/rig-' + name + '.webp';
    });
    function paint(c, x, y, character, opts = {}) {
        const f = fighters[character]; if (!f) return false;
        const animation = opts.animation, pose = animation?.pose || A.sample({ character, grounded: true }, 0, true).pose, bones = animation?.bones || A.solve(pose), rig = A.profile(character);
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
            // another game (blastz 98) hands its own prop to the fighter's hand
            if (opts.prop) { const b = bones.weapon; c.save(); c.translate(b.x, b.y); c.rotate(b.a); opts.prop(c); c.restore(); return; }
            if (!weaponW[character]) return;
            const b = bones.weapon, box = f.boxes[3], k = Math.min(weaponW[character] / box.w, weaponH[character] / box.h), grip = grips[character] || [.1, .5];
            c.save(); c.translate(b.x, b.y); c.rotate(b.a);
            c.drawImage(f.image, box.x, box.y, box.w, box.h, -box.w * k * grip[0], -box.h * k * grip[1], box.w * k, box.h * k); c.restore();
        };
        // The far upper arm stays behind the torso; its forearm and hand come
        // in front when they swing across the chest, rather than disappearing.
        const rearInFront = pose.backLayer > .5 || bones.bHand.x > bones.bUpper.x + 1, rearOverHead = pose.backLayer > 1.5;
        const limb = (index, name, length) => part(index, name, length + 3, .5, 1.5 / (length + 3));
        const hand = (index, name) => part(index, name, rig.handH, .5, .2);
        const rearForearm = () => {
            limb(7, 'bLower', rig.forearm); hand(13, 'bHand');
        };
        limb(6, 'bUpper', rig.arm);
        if (!rearInFront) rearForearm();
        limb(10, 'bThigh', rig.thigh); limb(11, 'bShin', rig.shin); part(15, 'bFoot', rig.footH, .34, .4, 0);
        limb(8, 'fThigh', rig.thigh); limb(9, 'fShin', rig.shin); part(14, 'fFoot', rig.footH, .34, .4, 0);
        if (pose.weaponLayer < .25) weapon();
        part(2, 'pelvis', rig.pelvisH, .5, .4, 0);
        part(1, 'torso', rig.bodyH, .5, .88, 0, rig.bodyW);
        if (pose.weaponLayer >= .25 && pose.weaponLayer < .75) weapon();
        if (rearInFront && !rearOverHead) rearForearm();
        part(0, 'head', rig.headH, .5, .96, 0, 44);
        if (rearOverHead) rearForearm();
        limb(4, 'fUpper', rig.arm); limb(5, 'fLower', rig.forearm);
        if (pose.weaponLayer >= .75) weapon();
        hand(12, 'fHand');
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
    function portrait(c, character) {
        const f = fighters[character]; if (!f) return;
        const box = f.boxes[0], k = Math.min(c.canvas.width / box.w, c.canvas.height / box.h);
        c.clearRect(0, 0, c.canvas.width, c.canvas.height); c.imageSmoothingEnabled = true;
        c.drawImage(f.image, box.x, box.y, box.w, box.h, (c.canvas.width - box.w * k) / 2, (c.canvas.height - box.h * k) / 2, box.w * k, box.h * k);
    }
    root.RIFT_ART = { paint, portrait, ready, whenReady: () => loaded, metrics: () => fighters.map((f, character) => ({ character, parts: f.boxes.length, width: 512, height: 512 })) };
})(window);
