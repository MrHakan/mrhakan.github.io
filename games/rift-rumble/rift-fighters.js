// Twelve original animated pixel models, inspired by the site's local cursed emoji.
// These are constructed sprites, not pasted emoji heads: faces, costumes, silhouettes,
// equipment and every pose share the same pixel grid. No external assets are fetched.
(function (root) {
    'use strict';
    const D = root.RIFT, INK = '#182126';
    function draw(c, x, y, n, opts = {}) {
        if (root.RIFT_ART?.paint(c, x, y, n, opts)) return;
        const f = D.FIGHTERS[n] || D.FIGHTERS[0], t = opts.time || 0;
        const walk = opts.walk ? Math.sin(t * 15) : 0, air = opts.airborne;
        const swing = opts.attack ? Math.min(1, opts.attack.age / (opts.attack.kind === 'heavy' ? 23 : 12)) : 0;
        const bob = opts.walk ? Math.abs(walk) * 1.5 : Math.sin(t * 2.5 + n) * 0.6;
        c.save(); c.translate(Math.round(x), Math.round(y)); c.scale((opts.facing || 1) * (opts.scale || 1.25), opts.scale || 1.25);
        c.globalAlpha *= opts.alpha === undefined ? 1 : opts.alpha;
        const r = (x, y, w, h, color) => { c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), w, h); };
        const box = (x, y, w, h, color, border = INK) => { r(x - 1, y - 1, w + 2, h + 2, border); r(x, y, w, h, color); };
        function line(x0, y0, x1, y1, color = INK, thickness = 1) {
            const count = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
            for (let i = 0; i <= count; i++) r(x0 + (x1 - x0) * i / (count || 1), y0 + (y1 - y0) * i / (count || 1), thickness, thickness, color);
        }
        function grin(y, wide = 1) {
            box(-10, y, 23, 7, '#fffbe6'); line(-10, y - 1, -14, y - 4); line(13, y, 16, y - 4);
            for (let k = -6; k < 13; k += 5) r(k, y + 1, 1, 5, '#8b8981'); r(-8, y + 6, 19, 1, INK);
            if (wide > 1) { r(-6, y + 8, 14, 1, f.dark); r(-2, y + 10, 8, 1, f.dark); }
        }
        function eye(x, y, w = 7, h = 6, pupilX = 3) { box(x, y, w, h, '#fffdf2'); r(x + pupilX, y + 1, 2, Math.max(2, h - 2), INK); }
        function brow(x, y, dir = 1, w = 8) { line(x, y, x + w, y + dir * 2, INK, 2); }
        // Feet and trouser legs: different silhouettes for the baby, suit and gown.
        const leg = n === 3 ? 3 : n === 7 ? 8 : 6;
        box(-11, -11, 7, leg + Math.max(0, walk * 3), f.dark);
        box(5, -11, 7, leg + Math.max(0, -walk * 3), f.dark);
        box(-13 + walk * 3, -3, 11, 4, n === 7 ? '#302e38' : '#d3d6ce');
        box(4 - walk * 3, -3, 12, 4, n === 9 ? '#b64940' : '#293647');
        c.translate(0, -bob);
        const wide = [2, 7, 11].includes(n) ? 15 : n === 3 ? 9 : 12;
        box(-wide, -26, wide * 2, 18, f.outfit);
        r(-wide + 2, -24, 4, 13, '#ffffff28'); r(wide - 4, -23, 3, 13, '#00000028');
        // Waist and team armband are readable in all twelve costumes.
        r(-wide, -11, wide * 2, 3, '#222b39'); r(-3, -11, 5, 3, '#d8bd71');
        const team = opts.team === 1 ? '#f57b68' : '#6ae0c7';
        box(-wide - 6, -25 + (air ? -6 : walk * 3), 7, 11, f.outfit); r(-wide - 6, -23 + (air ? -6 : walk * 3), 7, 3, team);
        box(-wide - 6, -14 + (air ? -6 : walk * 3), 7, 5, f.color);
        if (n === 0) { // Joe's biker jacket, gold zip, dangling chain.
            r(-2, -26, 3, 15, '#ddc273'); line(-11, -25, -3, -18, '#a4b6c5', 2); line(9, -25, 3, -18, '#a4b6c5', 2);
            for (let k = 0; k < 5; k++) box(-15 - k * 2, -13 + k % 2 * 2, 2, 2, '#e4c66a');
        } else if (n === 1) { // Dusung's long thinking coat and pocket notebook.
            box(-13, -10, 26, 7, f.outfit); r(-2, -25, 2, 20, '#a69ac4'); box(-11, -19, 6, 7, '#d4c7a4');
        } else if (n === 2) { r(-10, -25, 20, 3, '#f8c45e'); r(-3, -21, 7, 9, '#f9d66b'); line(-2, -20, 3, -15, '#cc4f3b', 2); }
        else if (n === 3) { box(-8, -18, 17, 10, '#e8e7cf'); r(-7, -17, 5, 8, '#a0d0d3'); r(4, -17, 4, 8, '#a0d0d3'); }
        else if (n === 4) { box(-6, -22, 12, 10, '#e8edf1'); r(-3, -19, 8, 2, '#b0c7dc'); }
        else if (n === 5) { r(-12, -25, 24, 4, '#a5b985'); box(-3, -20, 7, 5, '#d3dcab'); r(-1, -19, 3, 2, INK); }
        else if (n === 6) { r(-10, -26, 20, 3, '#d7b2c4'); box(-5, -21, 10, 7, '#dac5c9'); r(-1, -18, 2, 3, '#9c607e'); }
        else if (n === 7) { r(-5, -26, 12, 13, '#f2efe2'); line(-7, -26, 1, -18, '#58637b', 3); line(11, -26, 4, -18, '#58637b', 3); r(1, -22, 3, 12, '#b54e52'); }
        else if (n === 8) { box(-13, -10, 26, 7, f.outfit); for (let i = -8; i < 12; i += 8) r(i, -21, 2, 13, '#a2a3c6'); r(-1, -24, 2, 2, '#e2ddbf'); }
        else if (n === 9) { box(-8, -23, 17, 13, '#e6b069'); r(-3, -22, 7, 10, '#b6503c'); }
        else if (n === 10) { r(-7, -26, 16, 3, '#b4cbc0'); box(-5, -21, 11, 7, '#cad3c4'); r(-2, -19, 5, 3, '#527871'); }
        else { box(-11, -25, 22, 5, '#b5bb88'); r(-3, -20, 7, 9, '#515c3e'); }

        // A stepped, shaded head with deliberately asymmetric facial anatomy.
        const headY = n === 3 ? -49 : n === 7 ? -59 : -57;
        const rows = [[-10, 0, 20], [-14, 2, 28], [-17, 5, 34], [-19, 9, 38], [-19, 17, 38], [-16, 23, 32], [-12, 27, 24], [-7, 30, 14]];
        for (const [left, yy, width] of rows) r(left, headY + yy, width, yy === 9 || yy === 17 ? 8 : 5, INK);
        for (const [left, yy, width] of rows) r(left + 2, headY + yy + 1, width - 4, yy === 9 || yy === 17 ? 7 : 4, f.color);
        r(-12, headY + 5, 5, 12, f.light); r(-7, headY + 3, 14, 3, f.light); r(12, headY + 11, 5, 12, f.dark); r(-10, headY + 27, 22, 3, f.dark);
        const hy = headY;
        if (opts.hurt) {
            line(-10, hy + 10, -4, hy + 16, INK, 2); line(-4, hy + 10, -10, hy + 16, INK, 2);
            line(5, hy + 10, 11, hy + 16, INK, 2); line(11, hy + 10, 5, hy + 16, INK, 2);
            box(-2, hy + 23, 6, 5, '#7a4c43');
        } else if (n === 0) {
            box(-15, hy + 10, 13, 9, '#263342'); box(2, hy + 10, 13, 9, '#263342'); r(-3, hy + 11, 6, 2, INK);
            line(-12, hy + 12, -8, hy + 15, '#6e9caa', 2); line(5, hy + 12, 9, hy + 15, '#6e9caa', 2);
            line(-1, hy + 23, 9, hy + 22, INK, 2); line(9, hy + 23, 19, hy + 26, '#e6be6a'); r(18, hy + 25, 3, 2, '#ec7752');
            // Sunglasses pushed down under a very relaxed brow.
            brow(-13, hy + 6, -1, 10); brow(4, hy + 5, 1, 9);
        } else if (n === 1) {
            eye(-13, hy + 11, 12, 7, 7); eye(3, hy + 6, 12, 10, 6);
            line(-14, hy + 9, -7, hy + 5, INK, 2); line(4, hy + 4, 11, hy + 2, INK, 2);
            line(-4, hy + 24, 7, hy + 21, INK, 2); box(8, hy + 21, 5, 4, f.light);
            // Chin-resting hand is part of the model, not a face texture.
            box(7, hy + 27, 8, 5, f.color); line(6, hy + 29, 2, hy + 24, f.dark, 2);
        } else if (n === 2) {
            eye(-12, hy + 9, 10, 11, 5); eye(4, hy + 7, 10, 13, 4); brow(-13, hy + 5, -1); brow(5, hy + 4, 1);
            box(-8, hy + 23, 19, 7, '#743e35'); r(-6, hy + 23, 14, 2, '#fff2ca'); r(-4, hy + 27, 11, 3, '#f08070');
            r(-18, hy + 18, 5, 5, '#e7714b'); r(13, hy + 20, 4, 5, '#e7714b');
            box(13, hy + 1 + Math.sin(t * 4) * 2, 3, 7, '#9ee8e1');
        } else if (n === 3) {
            eye(-13, hy + 8, 10, 5, 6); eye(3, hy + 8, 11, 5, 6); brow(-14, hy + 4, -1, 10); brow(4, hy + 3, 1, 10);
            r(0, hy + 15, 5, 3, INK); grin(hy + 21, 2); line(-16, hy + 16, -11, hy + 18); line(13, hy + 16, 16, hy + 14);
            // Propeller cap and a deliberately tiny body.
            box(-9, hy - 2, 20, 4, '#73a9ad'); r(0, hy - 7, 2, 5, INK); r(-8, hy - 8, 19, 2, '#e5bb6e');
        } else if (n === 4) {
            eye(-13, hy + 9, 11, 9, 7); eye(4, hy + 9, 11, 9, 6); brow(-14, hy + 5, -1, 11); brow(3, hy + 3, 1, 11);
            box(-6, hy + 24, 15, 5, '#765345'); r(-3, hy + 23, 7, 2, f.color);
            r(-11, hy + 18, 6, 9, '#73c4ed'); r(7, hy + 18, 6, 9, '#73c4ed');
            r(-10, hy + 29 + t * 13 % 10, 4, 5, '#98e3f3'); r(9, hy + 27 + t * 10 % 13, 4, 5, '#98e3f3');
        } else if (n === 5) {
            eye(-13, hy + 11, 11, 4, 7); eye(4, hy + 10, 11, 4, 6); brow(-14, hy + 7, -1, 11); brow(3, hy + 5, 1, 11);
            grin(hy + 21, 2); r(-15, hy + 17, 4, 3, '#d1b9a3'); r(12, hy + 17, 4, 3, '#d1b9a3');
        } else if (n === 6) {
            eye(-13, hy + 7, 10, 11, 6); eye(4, hy + 12, 10, 6, 3); brow(-14, hy + 3, -1, 10); brow(3, hy + 8, 1, 11);
            line(-8, hy + 25, -2, hy + 22, INK, 2); line(-2, hy + 22, 5, hy + 27, INK, 2); line(5, hy + 27, 12, hy + 24, INK, 2);
            box(-18, hy + 22, 3, 6, '#7de5db');
        } else if (n === 7) {
            // Boss's swept hair, glasses, moustache and impeccable tie.
            r(-13, hy + 2, 27, 4, '#40404a'); r(-16, hy + 5, 8, 5, '#40404a'); r(-11, hy, 20, 3, '#40404a');
            box(-14, hy + 11, 12, 7, '#d6e0db'); box(3, hy + 11, 12, 7, '#d6e0db'); r(-3, hy + 12, 6, 2, INK); r(-7, hy + 13, 2, 3, INK); r(8, hy + 13, 2, 3, INK);
            r(-7, hy + 23, 10, 3, '#484144'); r(4, hy + 23, 9, 3, '#484144'); line(-4, hy + 28, 9, hy + 28, INK);
        } else if (n === 8) {
            // Heavy lids and a crooked nightcap match the reference's sleep-deprived stare.
            eye(-13, hy + 13, 11, 4, 6); eye(4, hy + 12, 11, 4, 5); r(-13, hy + 10, 11, 3, '#817577'); r(4, hy + 9, 11, 3, '#817577');
            r(-12, hy + 18, 9, 2, '#b29e9c'); r(5, hy + 17, 9, 2, '#b29e9c'); line(-6, hy + 25, 10, hy + 24, INK, 2);
            box(-13, hy, 24, 4, '#a7a3c8'); box(-9, hy - 5, 20, 5, f.outfit); box(4, hy - 10, 10, 6, f.outfit); box(12, hy - 5, 7, 5, '#f0e8c3');
        } else if (n === 9) {
            eye(-12, hy + 8, 10, 12, 6); eye(3, hy + 8, 10, 12, 6); r(-15, hy + 18, 4, 5, '#e58e6c'); r(12, hy + 18, 4, 5, '#e58e6c');
            box(-7, hy + 22, 17, 10, '#654238'); r(-4, hy + 22, 11, 3, '#fff2cc'); r(-3, hy + 28, 10, 4, '#ed8c71');
            box(-20, hy + 7, 4, 14, '#ca6f47'); box(16, hy + 7, 4, 14, '#ca6f47'); r(-17, hy + 1, 35, 3, '#cc704b');
        } else if (n === 10) {
            eye(-14, hy + 12, 11, 5, 7); eye(4, hy + 11, 11, 5, 6); brow(-15, hy + 7, 1, 11); brow(3, hy + 9, -1, 11);
            line(-8, hy + 25, 11, hy + 23, INK, 2); r(-11, hy + 19, 7, 2, '#afb6a7'); r(5, hy + 18, 7, 2, '#afb6a7');
            box(-20, hy + 23, 5, 9, f.color); line(-18, hy + 22, -17, hy + 16, f.dark, 2);
        } else {
            eye(-11, hy + 11, 8, 5, 5); eye(4, hy + 11, 8, 5, 5); brow(-13, hy + 7, 1, 9); brow(4, hy + 9, -1, 9);
            box(-19, hy + 18, 8, 9, '#e7ba59'); box(13, hy + 18, 8, 9, '#e7ba59');
            line(-2, hy + 21, -1, hy + 27, INK, 2); line(3, hy + 21, 2, hy + 27, INK, 2);
        }
        // A separate front arm follows the weapon's wind-up, strike and recovery.
        c.save(); c.translate(wide + 1, -22); c.rotate(opts.attack ? -1.3 + swing * 2.4 : air ? -0.5 : walk * 0.13);
        box(0, 0, 7, 12, f.outfit); box(0, 10, 8, 6, f.color);
        if (f.weapon === 'chain') {
            for (let i = 0; i < 6; i++) box(6 + i * 3, 12 + Math.sin(i + t * 5) * 2, 3, 3, '#dfc36c'); box(23, 10, 7, 7, '#acb1b8');
        } else if (f.weapon === 'cane') { box(6, -11, 3, 41, '#bda47e'); box(3, -14, 10, 4, '#e5c991'); }
        else if (f.weapon === 'fist' || f.weapon === 'gauntlet') { box(2, 8, 15, 11, n === 2 ? '#e27847' : '#c6ad63'); r(5, 9, 9, 2, '#ffe29a'); r(6, 14, 8, 1, f.dark); }
        else if (f.weapon === 'mallet') { box(7, -11, 4, 31, '#b29872'); box(-1, -17, 24, 13, '#bb6b6e'); r(1, -15, 18, 3, '#e9a5a3'); }
        else if (f.weapon === 'tissue') { box(5, 5, 15, 11, '#a1bcde'); r(9, -3, 7, 10, '#eff7ed'); r(12, -6, 6, 5, '#fffdf3'); }
        else if (f.weapon === 'knife') { box(7, 5, 4, 17, '#7e725c'); r(5, 2, 9, 3, '#b8c3b9'); box(8, -12, 4, 14, '#e3ece2'); r(12, -8, 2, 10, '#93ada8'); }
        else if (f.weapon === 'plunger') { box(8, -13, 3, 34, '#bba778'); box(2, -19, 16, 7, '#b36464'); box(-1, -14, 22, 4, '#d68f83'); }
        else if (f.weapon === 'case') { box(8, 14, 21, 17, '#6e5960'); box(13, 10, 10, 5, '#b7a394'); r(9, 16, 19, 3, '#8e7771'); r(17, 20, 4, 4, '#dbc484'); }
        else if (f.weapon === 'pillow') { box(2, 2, 27, 18, '#c6bfdc'); r(5, 4, 21, 12, '#ece6e7'); r(8, 5, 14, 2, '#fff7e8'); }
        else if (f.weapon === 'bat') { box(7, -18, 5, 38, '#cda36e'); box(5, -22, 9, 19, '#e9c68d'); r(7, -20, 2, 15, '#fff0bb'); }
        else if (f.weapon === 'hammer') { box(8, -13, 4, 35, '#847062'); box(-2, -20, 26, 13, '#748993'); r(0, -18, 22, 3, '#c4d3d4'); r(7, -14, 6, 3, '#bf5b51'); }
        c.restore(); c.restore();
    }
    function shot(c, shot, t) {
        c.save(); c.translate(Math.round(shot.x), Math.round(shot.y));
        const r = (x, y, w, h, color) => { c.fillStyle = color; c.fillRect(x, y, w, h); }, n = shot.character;
        c.globalAlpha = 0.3; r(-Math.sign(shot.vx) * 24, -3, 24, 6, shot.color); c.globalAlpha = 1;
        if (n === 0) {
            c.rotate(t * 8); r(-14, -6, 12, 11, INK); r(2, -6, 12, 11, INK); r(-3, -5, 6, 3, '#d7bd77'); r(-11, -4, 4, 2, '#7aabb4'); r(5, -4, 4, 2, '#7aabb4');
        } else if (n === 1 || n === 6) {
            r(-13, -15, 27, 25, '#f3eed7'); r(-10, -18, 21, 31, '#f3eed7'); r(0, 10, 5, 7, '#f3eed7'); c.fillStyle = n === 1 ? '#645585' : '#8a4e6f'; c.font = 'bold 24px Tahoma,sans-serif'; c.textAlign = 'center'; c.fillText(n === 1 ? '?' : '?!', 1, 6);
        } else if (n === 2) {
            r(-10, -9, 22, 19, '#d35539'); r(-7, -12, 15, 25, '#f6a349'); r(-2, -7, 11, 14, '#ffe58b'); r(-16, -5, 9, 7, '#ef843e'); r(-4, -17, 5, 8, '#f5c05a');
        } else if (n === 3 || n === 5) {
            r(-14, -8, 28, 15, '#c8cfb7'); r(-10, -12, 20, 24, '#f1f0dc'); r(-8, -4, 5, 2, INK); r(3, -5, 6, 2, INK); r(-9, 4, 19, 4, INK); r(-7, 4, 15, 2, '#fff8e7');
        } else if (n === 4) { r(-5, -13, 9, 6, '#81c6ee'); r(-8, -7, 16, 15, '#81c6ee'); r(-5, 8, 9, 4, '#81c6ee'); r(-4, -4, 4, 8, '#c9f7f7'); }
        else if (n === 7) { c.rotate(t * 5); r(-14, -9, 28, 19, '#644e59'); r(-6, -14, 12, 5, '#ac9176'); r(-12, -7, 24, 3, '#ab8b7c'); r(-3, -1, 6, 5, '#e2c57c'); }
        else if (n === 8) { r(-17, -9, 34, 18, '#a6a1c9'); r(-13, -6, 26, 12, '#e2dce3'); c.fillStyle = '#8c82ae'; c.font = 'bold 12px Tahoma'; c.fillText('z', -3, 4); }
        else if (n === 10) { r(-22, -14, 44, 28, '#c1c3b7'); r(-20, -12, 40, 7, '#153e88'); r(-14, -1, 12, 12, '#b55c51'); c.fillStyle = '#fff4d5'; c.font = 'bold 12px Tahoma'; c.fillText('×', -12, 9); r(2, 0, 15, 2, '#717871'); r(2, 5, 10, 2, '#717871'); }
        else { r(-17, -13, 34, 26, '#d3d6ab'); r(-13, -17, 26, 34, '#d3d6ab'); r(-8, -8, 6, 4, '#8da477'); r(5, -1, 8, 5, '#8da477'); r(-9, 7, 8, 4, '#8da477'); }
        c.restore();
    }
    root.RIFT_FIGHTERS = { draw, shot };
})(typeof window === 'undefined' ? globalThis : window);
