// The desktop is the arena. Original pixel backgrounds and solid Win98 fragments.
(function (root) {
    'use strict';
    function background(c, arena, t) {
        const r = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };
        const gradient = c.createLinearGradient(0, 0, 0, 720);
        arena.sky.forEach((color, i) => gradient.addColorStop(i / 2, color)); c.fillStyle = gradient; c.fillRect(0, 0, 1280, 720);
        // Sparse Bayer-like pixels, familiar from low-color desktop wallpapers.
        c.globalAlpha = 0.12;
        for (let y = 0; y < 720; y += 16) for (let x = (y % 32 ? 8 : 0); x < 1280; x += 16) r(x, y, 2, 2, '#e0f5db');
        c.globalAlpha = 1;
        if (arena.id === 'sunset') {
            c.font = 'bold 25px Courier New, monospace'; c.fillStyle = '#d8e6ff'; c.textAlign = 'left';
            r(426, 80, 428, 38, '#c0c0c0'); c.fillStyle = '#000080'; c.fillText(' BRAWLZ 98 ', 544, 108);
            c.fillStyle = '#e2e4fc'; c.font = '17px Courier New, monospace';
            ['A fatal exception has occurred at FRIENDSHIP:98', 'The current argument will be terminated.', '', '* Press J to make things worse.', '* Press Shift to avoid responsibility.', '', '        Press any key to continue the argument _'].forEach((line, i) => c.fillText(line, 200, 175 + i * 28));
            c.globalAlpha = 0.24; r(0, 460, 1280, 260, '#7692c0'); c.globalAlpha = 1;
        } else {
            function ghostWindow(x, y, w, h, title) {
                c.globalAlpha = 0.24; r(x + 8, y + 8, w, h, '#183b4d'); r(x, y, w, h, '#bac3bd'); r(x + 3, y + 3, w - 6, 23, '#183571');
                c.font = 'bold 12px Tahoma,sans-serif'; c.textAlign = 'left'; c.fillStyle = '#e4e8df'; c.fillText(title, x + 10, y + 19);
                for (let i = 0; i < 3; i++) { r(x + 20 + i * 53, y + 50, 28, 22, '#e4d49b'); r(x + 20 + i * 53, y + 48, 13, 5, '#e4d49b'); r(x + 18 + i * 53, y + 80, 33, 3, '#809a9c'); }
                c.globalAlpha = 1;
            }
            ghostWindow(90, 120 + Math.sin(t * 0.15) * 3, 245, 165, 'C:\\bad_ideas'); ghostWindow(990, 70, 230, 175, 'My Computer'); ghostWindow(1050, 500, 250, 150, 'Untitled - Notepad');
            if (arena.id === 'moon') {
                // A wire-frame trash can with the site's discarded documents around it.
                c.globalAlpha = 0.28; r(525, 82, 230, 18, '#d6eee2'); r(545, 104, 190, 141, '#b0c2c9');
                for (let k = 0; k < 9; k++) r(552 + k * 21, 112, 5, 123, '#3b5f79');
                r(545, 145, 190, 5, '#3b5f79'); r(545, 190, 190, 5, '#3b5f79');
                r(590, 68, 30, 45, '#e2e7d2'); r(650, 58, 40, 52, '#e2e7d2'); c.globalAlpha = 1;
            } else {
                c.globalAlpha = 0.2; r(570, 80, 140, 102, '#d3e8df'); r(578, 88, 124, 78, '#1a626e'); r(623, 182, 37, 14, '#c5dbd3'); r(600, 196, 84, 8, '#c5dbd3'); c.globalAlpha = 1;
            }
        }
        // Floating deleted pixels keep the world alive without burying the fight.
        for (let i = 0; i < 18; i++) { const y = (i * 87 + t * 8) % 720, x = (i * 193 + 33) % 1280; r(x, y, 3, 3, i % 2 ? '#b9d5bb' : '#b5c8c6'); }
        c.globalAlpha = 0.12; r(0, 695, 1280, 25, '#1c3f55'); c.globalAlpha = 1;
    }
    function platform(c, p, i, t, arena) {
        const r = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
        const border = (x, y, w, h, col) => { r(x, y, w, h, col); r(x, y, w, 3, '#f4f1df'); r(x, y, 3, h, '#f4f1df'); r(x, y + h - 3, w, 3, '#424950'); r(x + w - 3, y, 3, h, '#424950'); };
        // Collision is at the top of each tangible window fragment.
        border(p.x - 3, p.y, p.w + 6, p.main ? 38 : 25, '#bdbfb7');
        r(p.x, p.y + 3, p.w, 3, '#e7e7d8');
        if (p.main) {
            border(p.x + 7, p.y + 8, 79, 22, '#c4c5ba');
            // Four-color Start flag, pixel-drawn without an external font glyph.
            r(p.x + 15, p.y + 12, 6, 5, '#a8413d'); r(p.x + 23, p.y + 12, 6, 5, '#5a8659'); r(p.x + 15, p.y + 19, 6, 5, '#4c69a0'); r(p.x + 23, p.y + 19, 6, 5, '#d7b25d');
            c.font = 'bold 12px Tahoma,sans-serif'; c.textAlign = 'left'; c.fillStyle = '#202b33'; c.fillText('Start', p.x + 35, p.y + 24);
            const names = arena.id === 'moon' ? ['Recycle Bin', 'bad_decisions.zip', 'friendship.txt'] : arena.id === 'sunset' ? ['Not Responding', 'End Task', 'Abort, Retry, Fight'] : ['brawlz.exe', 'My Documents', 'Winamp'];
            for (let k = 0; k < 3; k++) { const x = p.x + 97 + k * (p.w - 200) / 3, width = (p.w - 220) / 3; border(x, p.y + 9, width, 21, k ? '#c0c3ba' : '#d8dbcf'); c.fillStyle = '#2d3c46'; c.font = '11px Tahoma,sans-serif'; c.fillText(names[k], x + 8, p.y + 24); }
            border(p.x + p.w - 78, p.y + 9, 68, 21, '#b2b7ac'); c.fillStyle = '#3c444a'; c.fillText('19:98', p.x + p.w - 61, p.y + 24);
            // The underside is a broken motherboard, not earth or a fantasy island.
            r(p.x + 23, p.y + 38, p.w - 46, 15, '#3d6760'); r(p.x + 67, p.y + 53, p.w - 134, 17, '#34534f');
            for (let k = 0; k < 11; k++) { const x = p.x + 45 + k * (p.w - 95) / 10; r(x, p.y + 42, 11, 5, '#a9b992'); r(x + 2, p.y + 55, 4, 10 + k % 3 * 5, '#c0a974'); }
            r(p.x + p.w * 0.5, p.y + 53, 38, 18, '#223b42'); r(p.x + p.w * 0.5 + 3, p.y + 55, 32, 2, '#607f76');
        } else {
            r(p.x + 5, p.y + 7, p.w - 10, 14, arena.id === 'sunset' ? '#425eab' : '#143f7d');
            c.fillStyle = '#eaf0e4'; c.font = '10px Tahoma,sans-serif'; c.textAlign = 'left'; c.fillText(['', 'My Documents', 'Recycle Bin', 'new_folder (12)'][i] || 'Untitled', p.x + 11, p.y + 18);
            border(p.x + p.w - 22, p.y + 8, 12, 11, '#b9beb6'); c.fillStyle = '#243b4b'; c.fillText('×', p.x + p.w - 19, p.y + 17);
            r(p.x + 12, p.y + 25, p.w - 24, 10, '#405a62'); for (let k = 0; k < 5; k++) r(p.x + 22 + k * 27, p.y + 29, 4, 13, '#b5a66e');
        }
    }
    root.RIFT_STAGES = { background, platform };
})(typeof window === 'undefined' ? globalThis : window);
