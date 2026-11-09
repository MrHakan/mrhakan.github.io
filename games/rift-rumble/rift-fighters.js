// Character drawing uses the fixed local rigs. Special projectiles share their palette.
(function (root) {
    'use strict';
    const INK = '#182126';
    function draw(c, x, y, n, opts = {}) { return root.RIFT_ART?.paint(c, x, y, n, opts); }
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
