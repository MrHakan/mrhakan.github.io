// Generated production atlases. Four columns: idle, run, jump, attack.
// Each atlas has three fighters, in the stable RIFT.FIGHTERS order.
(function (root) {
    'use strict';
    const sheets = [], frames = [];
    for (let sheet = 0; sheet < 4; sheet++) {
        const image = new Image(); image.decoding = 'async'; sheets.push(image);
        image.onload = () => {
            const cv = document.createElement('canvas'); cv.width = image.naturalWidth; cv.height = image.naturalHeight;
            const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(image, 0, 0);
            const pixels = c.getImageData(0, 0, cv.width, cv.height).data;
            for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) {
                const x = Math.round(column * cv.width / 4), y = Math.round(row * cv.height / 3), w = Math.round(cv.width / 4), h = Math.round(cv.height / 3);
                let bottom = h - 1;
                // Ignore isolated soft pixels when finding the foot baseline.
                for (; bottom > h * 0.5; bottom--) {
                    let solid = 0;
                    for (let xx = 0; xx < w; xx++) if (pixels[((y + bottom) * cv.width + x + xx) * 4 + 3] > 150) solid++;
                    if (solid > w * 0.06) break;
                }
                frames[(sheet * 3 + row) * 4 + column] = { x, y, w, h, bottom };
            }
        };
        image.src = 'games/rift-rumble/art/fighters-' + (sheet + 1) + '.png';
    }
    function paint(c, x, y, character, opts = {}) {
        const image = sheets[Math.floor(character / 3)];
        if (!image?.complete || !image.naturalWidth) return false;
        const startup = opts.attack && (opts.attack.kind === 'special' && root.RIFT.FIGHTERS[character].specialMelee ? root.RIFT.FIGHTERS[character].specialMelee.startup : root.RIFT.ATTACKS[opts.attack.kind].startup);
        const column = opts.attack ? opts.attack.age >= startup ? 3 : 0 : opts.airborne ? 2 : opts.walk ? 1 : 0;
        const f = frames[character * 4 + column]; if (!f) return false;
        const scale = opts.scale || 1.25, size = 76 * scale, k = size / f.h, t = opts.time || 0;
        const step = opts.walk ? Math.sin(t * 17) : 0, bob = opts.walk ? Math.abs(step) * 2 : Math.sin(t * 2.7 + character) * 0.7;
        c.save(); c.translate(Math.round(x), Math.round(y - bob)); c.scale(opts.facing || 1, 1);
        if (opts.walk) c.rotate(step * 0.025);
        c.globalAlpha *= opts.alpha === undefined ? 1 : opts.alpha;
        if (opts.hurt) { c.translate(Math.sin(t * 50) * 2, 0); c.globalAlpha *= 0.8; }
        c.imageSmoothingEnabled = false;
        c.drawImage(image, f.x, f.y, f.w, f.h, -f.w * k / 2, -f.bottom * k, f.w * k, f.h * k);
        c.restore(); return true;
    }
    root.RIFT_ART = { paint, ready: () => sheets.every(image => image.complete && image.naturalWidth > 0) };
})(window);
