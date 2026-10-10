// Original, code-drawn concert sets. Coordinates are a 1440 × 900 artboard;
// the stage engine frames the artwork around the title on desktop and phones.
(function () {
    'use strict';
    const TAU = Math.PI * 2;
    let g, t, bass, air, a, b, c;
    const rgba = (hex, alpha) => {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${alpha})`;
    };
    const noise = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    function rect(x, y, w, h, color) { g.fillStyle = color; g.fillRect(x, y, w, h); }
    function path(points, color, stroke, thickness = 2, close = true) {
        g.beginPath(); points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
        if (close) g.closePath();
        if (color) { g.fillStyle = color; g.fill(); }
        if (stroke) { g.strokeStyle = stroke; g.lineWidth = thickness; g.stroke(); }
    }
    function line(points, color, thickness = 2) { path(points, null, color, thickness, false); }
    function ellipse(x, y, rx, ry, color, stroke, thickness = 2) {
        g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU);
        if (color) { g.fillStyle = color; g.fill(); }
        if (stroke) { g.strokeStyle = stroke; g.lineWidth = thickness; g.stroke(); }
    }
    function text(value, x, y, size, color, font = 'monospace', align = 'left') {
        g.font = `700 ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.fillText(value, x, y);
    }
    function gradient(x, y, w, h, from, to, horizontal = false) {
        const fill = g.createLinearGradient(x, y, horizontal ? x + w : x, horizontal ? y : y + h);
        fill.addColorStop(0, from); fill.addColorStop(1, to); rect(x, y, w, h, fill);
    }
    function glow(x, y, radius, color, opacity) {
        const fill = g.createRadialGradient(x, y, 0, x, y, radius);
        fill.addColorStop(0, rgba(color, opacity)); fill.addColorStop(1, rgba(color, 0));
        rect(x - radius, y - radius, radius * 2, radius * 2, fill);
    }
    function star(x, y, r, color, rotation = 0, points = 5) {
        path(Array.from({ length: points * 2 }, (_, i) => {
            const angle = rotation + i * Math.PI / points - Math.PI / 2, size = i % 2 ? r * 0.4 : r;
            return [x + Math.cos(angle) * size, y + Math.sin(angle) * size];
        }), color);
    }
    function transformed(x, y, rotation, scale, render) {
        g.save(); g.translate(x, y); g.rotate(rotation); g.scale(scale, scale); render(); g.restore();
    }
    function beams(color, count = 4, strength = 1) {
        for (let i = 0; i < count; i++) {
            const x = 620 + i * 205, aim = x + Math.sin(t * 0.3 + i * 2) * 230;
            const fill = g.createLinearGradient(x, 20, aim, 850);
            fill.addColorStop(0, rgba(color, (0.16 + bass * 0.12) * strength)); fill.addColorStop(1, rgba(color, 0));
            path([[x - 3, 20], [x + 3, 20], [aim + 115, 850], [aim - 115, 850]], fill);
        }
    }
    function perspective(color, horizon = 610, tiles = false) {
        for (let row = 0; row < 8; row++) {
            const y0 = horizon + Math.pow(row / 8, 2) * (900 - horizon);
            const y1 = horizon + Math.pow((row + 1) / 8, 2) * (900 - horizon);
            if (tiles) {
                for (let col = -5; col < 11; col++) {
                    const x = 990 + (col - 3) * 230 * (y0 - horizon + 30) / 290;
                    path([[x, y0], [x + 230 * (y0 - horizon + 30) / 290, y0],
                        [990 + (col - 2) * 230 * (y1 - horizon + 30) / 290, y1],
                        [990 + (col - 3) * 230 * (y1 - horizon + 30) / 290, y1]],
                    rgba((row + col) % 2 ? color : c, 0.08 + bass * 0.04));
                }
            } else line([[0, y0], [1440, y0]], rgba(color, 0.16));
        }
        if (!tiles) for (let i = -5; i < 11; i++) line([[990, horizon], [i * 220, 900]], rgba(color, 0.14));
    }
    function mountain(y, color, roughness, seed, drift = 0) {
        const points = [[-200, 1100]];
        for (let i = 0; i < 20; i++) points.push([i * 100 - 200 + drift, y - noise(i + seed) * roughness]);
        points.push([1800, 1100]); path(points, color);
    }
    function hills(y, color, amplitude, seed, drift = 0) {
        g.beginPath(); g.moveTo(-300, 1100); g.lineTo(-300, y);
        for (let i = 0; i < 8; i++) {
            const x = i * 270 - 300 + drift, crest = y - noise(i + seed) * amplitude;
            g.bezierCurveTo(x + 90, crest - 40, x + 180, crest - 40, x + 270, y - noise(i + seed + 1) * amplitude);
        }
        g.lineTo(1900, 1100); g.closePath(); g.fillStyle = color; g.fill();
    }
    function windowFrame(x, y, w, h, caption, accent = a) {
        rect(x + 12, y + 12, w, h, '#0008'); rect(x, y, w, h, '#101d32');
        gradient(x, y, w, 35, accent, '#142d67', true); text(caption, x + 12, y + 24, 13, '#fff');
        ['_', '□', '×'].forEach((v, i) => { rect(x + w - 77 + i * 23, y + 7, 20, 21, '#d4dbec'); text(v, x + w - 74 + i * 23, y + 22, 16, '#183465'); });
        g.strokeStyle = '#b7c7e1'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
    }
    function dancer(x, y, scale, color, pose, bunny = false) {
        transformed(x, y, 0, scale, () => {
            const bounce = Math.abs(Math.sin(pose)) * 15;
            ellipse(0, -90 - bounce, 20, 23, color);
            if (bunny) {
                ellipse(-12, -126 - bounce, 7, 25, color); ellipse(12, -126 - bounce, 7, 25, color);
                ellipse(-12, -126 - bounce, 3, 17, a); ellipse(12, -126 - bounce, 3, 17, a);
            }
            path([[-18, -65 - bounce], [18, -65 - bounce], [29, -12], [-29, -12]], color);
            const sway = Math.sin(pose) * 22;
            line([[-12, -56 - bounce], [-36 - sway, -90], [-28 - sway, -120]], color, 11);
            line([[12, -56 - bounce], [36 - sway, -90], [28 - sway, -120]], color, 11);
            line([[-12, -14], [-22 + sway, 20], [-35 + sway, 35]], color, 13);
            line([[12, -14], [22 + sway, 20], [35 + sway, 35]], color, 13);
        });
    }
    const scenes = {
        space() {
            gradient(0, 0, 1440, 900, '#102d75', '#0b172e');
            for (let i = 0; i < 7; i++) {
                const x = 500 + ((i * 173 + t * (8 + i)) % 1050);
                glow(x, 130 + i % 3 * 100, 110, '#dcecff', 0.08);
            }
            hills(660, '#1c5e59', 100, 12, Math.sin(t * 0.1) * 8);
            hills(770, '#113839', 80, 8);
            transformed(965, 330 + Math.sin(t * 0.5) * 9, -0.06, 1, () => {
                windowFrame(-225, -170, 450, 325, 'Untitled - Notepad');
                rect(-221, -132, 442, 281, '#f4f8ff');
                text('File  Edit  Format  View  Help', -207, -113, 13, '#324666');
                const content = ['how to fly in 2009:', '', '> turn the volume up', '> believe the upload', '> with a spirit...'];
                content.forEach((v, i) => text(v.slice(0, Math.max(0, Math.floor(t * 11) % 140 - i * 18)), -199, -70 + i * 35, 17, '#2252a4'));
                rect(-199 + Math.min(23, Math.floor(t * 11) % 25) * 10, 73, 8, 19, rgba(a, 0.4 + bass * 0.4));
            });
            path([[1235, 570], [1235, 614], [1246, 602], [1258, 626], [1266, 622], [1254, 598], [1272, 599]], '#fff', '#0a1530', 3);
            text('CONNECTED • 56 Kbps', 780, 730, 15, rgba(c, 0.5));
        },
        rain() {
            gradient(0, 0, 1440, 900, '#101023', '#060c1b');
            for (let i = 0; i < 5; i++) {
                const x = 560 + i * 175;
                rect(x - 28, 180, 25, 525, '#15172b');
                g.beginPath(); g.moveTo(x, 690); g.lineTo(x, 280); g.bezierCurveTo(x, 100, x + 130, 100, x + 130, 280); g.lineTo(x + 130, 690); g.closePath();
                const glass = g.createLinearGradient(x, 160, x, 690); glass.addColorStop(0, rgba(b, 0.23 + bass * 0.08)); glass.addColorStop(1, '#171b37'); g.fillStyle = glass; g.fill();
                line([[x + 65, 190], [x + 65, 690]], '#292c47', 6);
                for (let j = 0; j < 5; j++) line([[x + 8, 305 + j * 72], [x + 120, 305 + j * 72]], '#292c47', 4);
            }
            glow(1000, 240, 320, b, 0.1); beams(b, 3, 0.4);
            gradient(0, 685, 1440, 215, '#111629', '#060b13');
            for (let i = 0; i < 28; i++) {
                const x = 580 + noise(i) * 880, y = 710 + noise(i + 60) * 160;
                line([[x, y], [x + 22 + Math.sin(t + i) * 8, y]], rgba(b, 0.12 + bass * 0.05));
            }
            for (let i = 0; i < 65; i++) {
                const x = 540 + noise(i) * 930, y = (noise(i + 1) * 900 + t * (110 + noise(i) * 90)) % 900;
                line([[x, y], [x - 7, y + 38]], rgba(c, 0.13 + noise(i) * 0.14));
            }
        },
        candy() {
            gradient(0, 0, 1440, 900, '#2b1740', '#10172b');
            for (let i = 0; i < 14; i++) {
                const x = 600 + noise(i) * 850, y = 100 + noise(i + 40) * 450 + Math.sin(t + i) * 15;
                star(x, y, 9 + noise(i + 20) * 21, rgba(i % 2 ? b : a, 0.28), 0, 4);
            }
            path([[620, 140], [1360, 140], [1300, 570], [680, 570]], '#ed52b414', rgba(a, 0.5), 4);
            text('DANCE DANCE DANCE', 992, 190, 25, c, 'Arial', 'center');
            perspective(a, 570, true);
            [800, 1000, 1200].forEach((x, i) => {
                glow(x, 585, 90, i % 2 ? b : a, 0.23 + bass * 0.14);
                dancer(x, 505, 1.4 + bass * 0.04, i % 2 ? b : c, t * 4.8 + i * 0.4, true);
            });
            for (let i = 0; i < 16; i++) {
                const x = 630 + noise(i + 9) * 740, y = (noise(i + 3) * 500 + t * 30) % 550;
                transformed(x, y, t * 0.7 + i, 1, () => rect(-3, -7, 6, 14, i % 2 ? a : b));
            }
        },
        matrix() {
            gradient(0, 0, 1440, 900, '#03170f', '#020907');
            for (let col = 0; col < 38; col++) {
                const x = 470 + col * 27, head = (t * (36 + noise(col) * 75) + noise(col) * 1200) % 1200;
                for (let row = 0; row < 14; row++) {
                    const y = head - row * 25;
                    text('01カミハネツ'[Math.floor(noise(col * 17 + row) * 7)], x, y, 17, rgba(row ? a : c, (1 - row / 14) * 0.48));
                }
            }
            for (let i = 0; i < 13; i++) {
                const x = 520 + i * 73, top = 480 - noise(i + 6) * 280;
                path([[x, 640], [x, top], [x + 28, top - 18], [x + 64, top], [x + 64, 640]], '#041d13', rgba(a, 0.28));
                line([[x + 28, top - 18], [x + 28, 640]], rgba(a, 0.2));
                for (let j = 0; j < 5; j++) rect(x + 8, top + 25 + j * 36, 9, 14, rgba(b, 0.12 + bass * 0.2));
            }
            perspective(a, 640);
            rect(790, 290, 350, 112, '#02110bd9'); line([[790, 290], [1140, 290]], b);
            text('> THE CONSTRUCT_', 810, 330, 23, b); text('SYSTEM: AWAKE', 810, 374, 16, a);
        },
        disco() {
            gradient(0, 0, 1440, 900, '#0b2633', '#160b24');
            beams(b, 5); perspective(a, 605, true);
            line([[1040, 0], [1040, 210]], '#aec3ce', 2);
            transformed(1040, 322, 0, 1 + bass * 0.04, () => {
                ellipse(0, 0, 115, 115, '#375e70');
                g.save(); g.beginPath(); g.arc(0, 0, 113, 0, TAU); g.clip();
                for (let row = -5; row < 6; row++) for (let col = -6; col < 7; col++) {
                    const intensity = 0.18 + Math.max(0, Math.sin(col * 0.6 + t * 0.5)) * 0.65;
                    rect(col * 24 + Math.sin(t * 0.45) * 13, row * 22, 20, 18, rgba((row + col) % 3 ? c : b, intensity));
                }
                g.restore();
            });
            for (let i = 0; i < 15; i++) {
                const x = 700 + noise(i) * 690, y = 130 + noise(i + 1) * 590;
                star(x + Math.sin(t * 0.4 + i) * 45, y, 3 + Math.max(0, Math.sin(t + i)) * 7, rgba(c, 0.3), 0, 4);
            }
            transformed(900, 652, -0.22, 1, () => {
                rect(-190, -92, 380, 184, '#193445');
                transformed(-42, 0, t * 0.45, 1, () => {
                    ellipse(0, 0, 83, 83, '#040b12');
                    for (let i = 0; i < 8; i++) ellipse(0, 0, 25 + i * 7, 25 + i * 7, null, '#284047', 1);
                    ellipse(0, 0, 23, 23, a); text('DP', 0, 5, 13, '#042331', 'Arial', 'center');
                });
                line([[122, -60], [116, 8], [29, 32]], c, 6); rect(24, 22, 25, 17, b);
                rect(137, 43, 28, 28, '#ff579d');
            });
        },
        circuit() {
            gradient(0, 0, 1440, 900, '#102536', '#080e17');
            for (let i = 0; i < 6; i++) {
                const x = 700 + i * 110;
                line([[x, 0], [x, 160 + i % 2 * 100], [x - 60, 220 + i % 2 * 100]], rgba(b, 0.17), 2);
                rect(x - 66, 214 + i % 2 * 100, 12, 12, rgba(b, 0.45));
            }
            const words = ['HARDER', 'BETTER', 'FASTER', 'STRONGER'];
            words.forEach((v, i) => {
                const active = Math.floor(t * 1.5) % 4 === i;
                transformed(1020 + Math.sin(t * 0.6 + i) * 5, 190 + i * 95, -0.025, active ? 1 + bass * 0.025 : 1, () => {
                    rect(-215, -43, 430, 73, active ? rgba(a, 0.8) : '#152838');
                    text(v, 0, 13, 51, active ? '#06131e' : rgba(b, 0.42), 'Impact', 'center');
                    rect(196, -30, 5, 49, c);
                });
            });
            rect(640, 640, 750, 76, '#243b47');
            for (let i = 0; i < 15; i++) ellipse(660 + i * 50, 686, 18, 18, '#0a161f', rgba(b, 0.3));
            for (let i = 0; i < 5; i++) {
                const x = 660 + ((i * 170 + t * 46) % 690);
                rect(x, 587, 60, 51, '#243f51'); rect(x + 6, 596, 48, 4, a);
            }
            const arm = Math.sin(t * 1.5) * 36 + bass * 12;
            line([[1315, 575], [1245, 540 - arm], [1265, 480 - arm]], '#58757e', 18);
            line([[1248, 460 - arm], [1265, 480 - arm], [1282, 460 - arm]], c, 6);
        },
        comic() {
            gradient(0, 0, 1440, 900, '#290e22', '#170e17');
            for (let i = 0; i < 24; i++) {
                const angle = i / 24 * TAU;
                path([[1030, 370], [1030 + Math.cos(angle) * 850, 370 + Math.sin(angle) * 850],
                    [1030 + Math.cos(angle + 0.055) * 850, 370 + Math.sin(angle + 0.055) * 850]], rgba(a, 0.10));
            }
            transformed(1030, 352, -0.09 + Math.sin(t * 0.6) * 0.015, 1 + bass * 0.025, () => {
                path([[-270, -190], [270, -170], [230, 190], [-250, 220]], '#bd2445', '#fce3c5', 8);
                for (let row = -7; row < 8; row++) for (let col = -10; col < 10; col++) ellipse(col * 24, row * 23, 3, 3, '#61102e');
                path([[-170, -45], [-88, -105], [-63, -41], [55, -123], [80, -35], [180, -51], [119, 24], [174, 103], [64, 95], [17, 163], [-49, 85], [-150, 113], [-130, 34], [-208, 8]], b, '#110b14', 7);
                text('POW!', 0, 47, 85, '#2c1022', 'Impact', 'center');
                rect(-225, -166, 200, 33, '#fff0d3'); text('ISSUE #004', -213, -143, 18, '#251023');
            });
            transformed(1270, 580 + Math.sin(t * 1.2) * 5, 0.1, 1, () => {
                ellipse(0, 0, 77, 77, a, '#160d19', 7);
                path([[-51, -42], [-4, -17], [-12, 52], [-54, 29]], '#231320'); path([[51, -42], [4, -17], [12, 52], [54, 29]], '#231320');
                line([[-46, -12], [-17, -2]], c, 9); line([[46, -12], [17, -2]], c, 9);
            });
        },
        smiley() {
            gradient(0, 0, 1440, 900, '#231c39', '#101123'); beams(b, 3, 0.7);
            for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
                const x = 690 + col * 145, bounce = Math.abs(Math.sin(t * 2.8 + col * 0.45 + row * 0.7));
                const y = 240 + row * 165 - bounce * (25 + bass * 30), radius = 45 + (row === 1 ? 8 : 0);
                transformed(x, y, Math.sin(t * 1.4 + col) * 0.12, 1, () => {
                    ellipse(0, 0, radius, radius * (0.95 + bounce * 0.06), a, '#463321', 3);
                    ellipse(-16, -10, 5, 9, '#322738'); ellipse(16, -10, 5, 9, '#322738');
                    g.beginPath(); g.arc(0, 0, 25, 0.15, Math.PI - 0.15); g.strokeStyle = '#322738'; g.lineWidth = 5; g.stroke();
                });
            }
            perspective(b, 690, true); text('JUMP / REPEAT', 1030, 750, 33, rgba(c, 0.7), 'Impact', 'center');
        },
        evolution() {
            gradient(0, 0, 1440, 900, '#123c33', '#071920');
            for (let i = 0; i < 22; i++) {
                const x = 680 + i * 31, y = 320 + Math.sin(i * 0.3 - t * 0.55) * (75 + bass * 24);
                const mirror = 640 - y;
                line([[x, y], [x, mirror]], rgba(b, 0.17), 2);
                rect(x - 5, y - 5, 10, 10, b); rect(x - 5, mirror - 5, 10, 10, a);
            }
            line([[590, 615], [1390, 615]], rgba(c, 0.45), 3);
            for (let i = 0; i < 5; i++) {
                const x = 650 + i * 170, scale = 0.8 + i * 0.15;
                const stride = Math.sin(t * 2.8 + i * 0.5) * 19, lean = (4 - i) * 9;
                transformed(x, 605, 0, scale, () => {
                    ellipse(lean, -115, 16, 18, i === 4 ? c : a);
                    line([[lean, -98], [0, -58], [-14, -26]], i === 4 ? c : a, 16);
                    line([[0, -62], [38 + lean, -55 + stride], [50 + lean, -26 + stride]], b, 11);
                    line([[-12, -27], [-31 - stride, 0]], b, 13); line([[-12, -27], [23 + stride, 0]], b, 13);
                });
                text(['01', '02', '03', '04', 'NOW'][i], x, 675, 17, rgba(c, 0.6), 'monospace', 'center');
            }
            text('RIGHT HERE.', 1000, 180, 65, rgba(c, 0.22), 'Impact', 'center');
            text('RIGHT NOW.', 1000, 765, 65, rgba(c, 0.22), 'Impact', 'center');
        },
        line() {
            gradient(0, 0, 1440, 900, '#143584', '#111d45');
            g.beginPath(); g.moveTo(450, 540); g.bezierCurveTo(700, 540, 700, 650, 870, 650); g.bezierCurveTo(1120, 650, 1190, 510, 1500, 510);
            g.strokeStyle = b; g.lineWidth = 4; g.stroke();
            transformed(1010, 605 + Math.sin(t * 1.6) * 5, 0, 1.5, () => {
                const step = Math.sin(t * 4) * (24 + bass * 12);
                g.beginPath(); g.moveTo(-70, 0); g.lineTo(-step, 0); g.lineTo(-7, -38); g.lineTo(-4, -66);
                g.bezierCurveTo(-28, -78, -22, -104, -5, -102); g.bezierCurveTo(16, -105, 10, -84, 30, -81);
                g.lineTo(14, -77); g.lineTo(10, -65); g.lineTo(6, -38); g.lineTo(27, -54); g.lineTo(45, -45);
                g.moveTo(6, -38); g.lineTo(step, 0); g.lineTo(70, 0); g.strokeStyle = b; g.lineWidth = 3; g.stroke();
            });
            for (let i = 0; i < 3; i++) {
                transformed(810 + i * 190, 250 + i % 2 * 60 + Math.sin(t + i) * 7, -0.06, 1, () => {
                    g.strokeStyle = rgba(b, 0.42); g.lineWidth = 2; g.strokeRect(-65, -38, 130, 70);
                    line([[10, 32], [21, 47], [35, 32]], rgba(b, 0.42)); text('BLA', 0, 13, 30, b, 'Arial', 'center');
                });
            }
            text('a little line. a lot of attitude.', 1040, 738, 15, rgba(c, 0.65), 'monospace', 'center');
        },
        dust() {
            gradient(0, 0, 1440, 900, '#34414a', '#101e2b');
            glow(1120, 230, 260, c, 0.19 + bass * 0.06); mountain(590, '#384344', 210, 24); mountain(700, '#252d31', 95, 67);
            for (let i = 0; i < 3; i++) {
                const x = 810 + i * 180, h = 160 + i % 2 * 155;
                path([[x - 28, 655], [x - 18, 655 - h], [x + 28, 634 - h], [x + 49, 655]], '#15232c', '#57605b', 2);
                line([[x - 17, 657 - h], [x + 24, 639 - h], [x + 29, 648]], '#697067', 3);
            }
            transformed(1000, 330 + Math.sin(t * 0.3) * 4, 0, 1, () => {
                const lift = Math.sin(t * 0.6) * 12 + bass * 9;
                path([[0, 55], [-30, 12], [-64, -14], [-186, -78 - lift], [-145, -8], [-91, 2], [-114, 42], [-46, 25], [-19, 58]], '#11212d');
                path([[0, 55], [30, 12], [64, -14], [186, -78 - lift], [145, -8], [91, 2], [114, 42], [46, 25], [19, 58]], '#11212d');
                ellipse(0, 8, 13, 16, '#11212d'); path([[-16, 31], [16, 31], [25, 92], [-24, 92]], '#11212d');
            });
            for (let i = 0; i < 40; i++) {
                const x = (noise(i) * 1500 + t * (18 + noise(i) * 18)) % 1500, y = 180 + noise(i + 5) * 600;
                line([[x, y], [x + 9, y - 1]], rgba(b, 0.12 + air * 0.12));
            }
        },
        memory() {
            gradient(0, 0, 1440, 900, '#362e27', '#14191c');
            for (let i = 0; i < 5; i++) {
                const x = 610 + i * 173;
                rect(x, 120, 105, 375, '#23262a'); g.strokeStyle = '#8b7150'; g.lineWidth = 7; g.strokeRect(x, 120, 105, 375);
                rect(x + 14, 135, 77, 344, '#475044'); line([[x, 290], [x + 105, 290]], '#8b7150', 5);
            }
            perspective(a, 585, true);
            line([[1020, 0], [1020, 140]], '#8d7755', 3);
            transformed(1020, 150, Math.sin(t * 0.18) * 0.025, 1, () => {
                line([[-100, 66], [0, 17], [100, 66]], '#b2945e', 5); line([[0, 0], [0, 102]], '#b2945e', 5);
                [-100, -50, 0, 50, 100].forEach((x, i) => { line([[x, 58 + i % 2 * 22], [x, 96 + i % 2 * 22]], '#b2945e', 3); glow(x, 90 + i % 2 * 22, 38, c, 0.22 + bass * 0.05); });
            });
            transformed(1100, 560, -0.025, 1, () => {
                rect(-120, -55, 240, 86, '#151918'); path([[-120, -55], [91, -138], [120, -55]], '#1d2220');
                rect(-114, 5, 228, 14, '#b2ac99'); for (let i = 0; i < 24; i++) rect(-110 + i * 9, 5, 4, 8, '#29302b');
                line([[-104, 26], [-105, 90]], '#151918', 12); line([[99, 26], [101, 90]], '#151918', 12);
            });
            gradient(550, 460, 850, 320, '#d4c39500', '#d4c39516');
            for (let i = 0; i < 30; i++) rect(560 + noise(i) * 880, (noise(i + 4) * 900 + t * 4) % 900, 2, 2, '#d8c49b30');
            text('a room that almost remembers you', 1000, 730, 18, rgba(c, 0.34), 'Georgia', 'center');
        },
        metal() {
            gradient(0, 0, 1440, 900, '#271116', '#090d13');
            for (let i = 0; i < 9; i++) {
                const x = 590 + i * 105;
                line([[x, 0], [x + 75, 790]], '#461c24', 13); line([[x + 28, 0], [x + 103, 790]], '#201e22', 2);
            }
            [730, 1250].forEach(x => {
                rect(x - 86, 175, 172, 450, '#14191e'); g.strokeStyle = '#515158'; g.lineWidth = 3; g.strokeRect(x - 86, 175, 172, 450);
                [270, 465].forEach(y => { ellipse(x, y, 64, 64, '#070c11', '#343b40', 4); ellipse(x, y, 38 + bass * 6, 38 + bass * 6, '#252c30', rgba(a, 0.55), 2); ellipse(x, y, 13, 13, '#070c11'); });
            });
            text('LET THE', 1000, 275, 48, '#baaaa2', 'Impact', 'center'); text('BODIES', 1000, 365, 79, a, 'Impact', 'center'); text('HIT THE FLOOR', 1000, 421, 35, '#baaaa2', 'Impact', 'center');
            for (let i = 0; i < 60; i++) {
                const x = 680 + i * 11, amp = (0.12 + bass * 0.55) * 75;
                line([[x, 538 - Math.sin(i * 0.8 + t * 3) * amp], [x, 538 + Math.sin(i * 0.8 + t * 3) * amp]], i % 3 ? a : b, 4);
            }
            path([[580, 670], [1380, 670], [1380, 725], [580, 725]], '#c98f30');
            for (let i = 0; i < 14; i++) path([[590 + i * 60, 670], [613 + i * 60, 670], [573 + i * 60, 725], [550 + i * 60, 725]], '#18191c');
        },
        flare() {
            gradient(0, 0, 1440, 900, '#6a3848', '#121d33');
            ellipse(1040, 352, 92, 92, '#ffc480'); glow(1040, 352, 270, a, 0.2);
            mountain(516, '#243240', 180, 1); mountain(615, '#182735', 130, 19);
            path([[920, 510], [1150, 510], [1560, 980], [500, 980]], '#11191f');
            line([[920, 510], [500, 980]], '#947a63', 3); line([[1150, 510], [1560, 980]], '#947a63', 3);
            for (let i = 0; i < 9; i++) {
                const p = (i / 9 + t * 0.11) % 1, y = 520 + p * p * 430, w = 4 + p * 14;
                rect(1035 - w / 2, y, w, 5 + p * 36, '#dfcc99');
            }
            for (let i = 0; i < 9; i++) {
                const p = (i / 9 + t * 0.13) % 1, y = 525 + p * p * 370;
                line([[1135 + p * 250, y], [1135 + p * 250, y - 18 - p * 42]], '#1d2731', 4);
                line([[1135 + p * 250, y - 18 - p * 42], [1100 + p * 250, y - 18 - p * 42]], '#344451', 3);
                glow(1100 + p * 250, y - 18 - p * 42, 12 + p * 10, b, 0.22);
            }
            line([[760, 382], [1320, 382]], rgba(c, 0.25 + bass * 0.18), 2);
            path([[1280, 590], [1290, 578], [1328, 578], [1340, 590], [1344, 614], [1278, 614]], '#0c171e');
            rect(1287, 602, 15, 4, '#ff695e'); rect(1320, 602, 15, 4, '#ff695e');
        },
        hypercam() {
            gradient(0, 0, 1440, 900, '#1e2254', '#111325');
            for (let i = 0; i < 4; i++) transformed(1080 + i * 22, 390 + i * 18, 0.05, 1, () => {
                windowFrame(-260, -180, 520, 365, 'dreamscape_final_FINAL.avi', '#595af0');
            });
            transformed(1010, 350, -0.06, 1, () => {
                windowFrame(-280, -190, 560, 370, 'Windows Movie Maker — untitled');
                rect(-274, -149, 548, 291, '#080d25');
                for (let i = 0; i < 14; i++) {
                    const y = -120 + i * 19;
                    line([[-260, y], [260, y]], rgba(i % 2 ? a : b, 0.16));
                    rect(-250 + ((i * 53 + t * 28) % 465), y - 5, 35 + bass * 22, 8, rgba(c, 0.3 + air * 0.18));
                }
                text('UNREGISTERED HYPERCAM 2', -258, -121, 16, '#fff');
                text('DREAMSCAPE', 0, 35, 59, b, 'Impact', 'center');
                rect(-248, 100, 495, 12, '#1e2242'); rect(-248, 100, (t * 30) % 495, 12, b);
                text('Rendering nostalgia... 99%', -256, 166, 14, '#bdc2df');
            });
            text('★ ★ ★ ★ ★', 920, 665, 31, b); text('Broadcast Yourself™', 880, 725, 18, rgba(c, 0.6));
        },
        phantom() {
            rect(0, 0, 1440, 900, '#130c19');
            path([[650, 0], [1440, 0], [1440, 650], [440, 900]], '#d01d3a');
            for (let i = 0; i < 13; i++) path([[760 + i * 63, 0], [782 + i * 63, 0], [1250 + i * 63, 900], [1228 + i * 63, 900]], '#130c192b');
            transformed(1070 + Math.sin(t * 0.7) * 8, 330, -0.16, 1 + bass * 0.035, () => {
                star(0, 0, 225, '#100b15', 0.25); star(0, 0, 205, b, 0.25); star(0, 0, 145, '#100b15', 0.25);
                path([[-147, -33], [-62, -72], [-6, -13], [20, -18], [76, -80], [147, -51], [103, 45], [29, 48], [0, 25], [-30, 53], [-116, 58]], '#fff', '#130b15', 5);
                path([[-120, -13], [-55, -23], [-16, 4], [-59, 25], [-105, 27]], '#171021'); path([[34, 3], [87, -28], [123, -23], [100, 17], [59, 24]], '#171021');
            });
            transformed(1030, 610, -0.12, 1, () => {
                rect(-237, -57, 474, 101, '#fff'); rect(-250, -70, 470, 98, '#130b15');
                text('TAKE YOUR TIME', -227, -1, 47, '#fff', 'Impact');
            });
            [0, 1, 2].forEach(i => star(760 + i * 250, 140 + i * 60 + Math.sin(t + i) * 8, 19 + i * 8, i % 2 ? '#111' : b, 0.2));
        },
        portal() {
            gradient(0, 0, 1440, 900, '#243c49', '#0a1823');
            for (let row = 0; row < 6; row++) for (let col = 0; col < 8; col++) {
                const x = 570 + col * 119, y = 75 + row * 109;
                rect(x, y, 112, 102, (row + col) % 3 ? '#324853' : '#29414e');
                rect(x + 7, y + 7, 98, 2, '#ffffff10');
            }
            text('00', 1230, 220, 111, '#c6dfe326', 'Arial');
            perspective(c, 685);
            [a, b].forEach((color, i) => {
                const x = i ? 1240 : 780, y = i ? 376 : 330;
                glow(x, y, 150, color, 0.32 + bass * 0.08);
                ellipse(x, y, 69, 144, '#061727', color, 7);
                g.save(); g.beginPath(); g.ellipse(x, y, 65, 140, 0, 0, TAU); g.clip();
                gradient(x - 70, y - 142, 140, 284, '#2a4356', '#071322');
                for (let j = 0; j < 8; j++) line([[x - 70, y - 110 + j * 35 + Math.sin(t) * 3], [x + 70, y - 110 + j * 35 + Math.sin(t) * 3]], rgba(i ? a : b, 0.35));
                path([[x - 70, y + 80], [x + 70, y + 10], [x + 70, y + 140], [x - 70, y + 140]], '#030c16'); g.restore();
                for (let j = 0; j < 14; j++) {
                    const angle = j / 14 * TAU, pulse = 1 + Math.sin(t * 2 + j) * 0.03;
                    line([[x + Math.cos(angle) * 73 * pulse, y + Math.sin(angle) * 148 * pulse], [x + Math.cos(angle + 0.055) * 77, y + Math.sin(angle + 0.055) * 151]], color, 2);
                }
            });
            transformed(1000, 568 + Math.sin(t * 0.8) * 5, -0.05, 1, () => {
                path([[-66, -30], [0, -70], [66, -30], [0, 11]], '#b5c6c9', '#6b8895', 3);
                path([[-66, -30], [0, 11], [0, 83], [-66, 41]], '#738e9e', '#c4d9df', 3);
                path([[0, 11], [66, -30], [66, 41], [0, 83]], '#5e7f91', '#c4d9df', 3);
                ellipse(-32, 25, 15, 21, '#cc7899'); ellipse(32, 25, 15, 21, '#cc7899');
                text('♥', -33, 32, 20, '#ecd2df', 'Arial', 'center'); text('♥', 32, 32, 20, '#ecd2df', 'Arial', 'center');
            });
            text('APERTURE / RADIO ACTIVE', 997, 763, 16, rgba(c, 0.55), 'monospace', 'center');
        },
        winter() {
            gradient(0, 0, 1440, 900, '#1f4053', '#0b1d2a');
            glow(1080, 230, 200, c, 0.1); ellipse(1080, 230, 65, 65, '#c7dbca70');
            mountain(620, '#345260', 110, 6); mountain(750, '#1b3545', 50, 31);
            for (let i = 0; i < 10; i++) {
                const x = 530 + i * 100, h = 130 + noise(i) * 135;
                for (let j = 0; j < 4; j++) path([[x, 700 - h + j * 38], [x - 27 - j * 12, 740 - h + j * 38], [x + 27 + j * 12, 740 - h + j * 38]], j % 2 ? '#193744' : '#9bbabc65');
            }
            line([[1240, 720], [1240, 270], [1200, 250], [1160, 270]], '#0a1b26', 11);
            path([[1128, 270], [1190, 270], [1175, 323], [1143, 323]], '#f4c66b'); glow(1158, 300, 170, c, 0.2 + bass * 0.03);
            transformed(880, 423, -0.055, 1, () => {
                rect(-110, -72, 220, 115, '#b6bda8'); rect(-102, -64, 204, 99, '#31535a');
                text('WELCOME TO', 0, -32, 16, '#cfddd0', 'Arial', 'center'); text('PARADISE', 0, 3, 35, '#f1d693', 'Impact', 'center');
                text('POPULATION:  ?_', 0, 24, 12, '#cfddd0', 'monospace', 'center');
                line([[-80, 43], [-80, 275]], '#243e46', 9); line([[80, 43], [80, 275]], '#243e46', 9);
            });
            line([[600, 180], [790, 216], [1050, 190], [1370, 240]], '#122c36', 3);
            for (let i = 0; i < 17; i++) ellipse(625 + i * 43, 196 + Math.sin(i * 0.55) * 22, 4, 7, i % 3 ? b : c);
            for (let i = 0; i < 70; i++) {
                const x = 400 + (noise(i) * 1150 + Math.sin(t * 0.2 + i) * 23), y = (noise(i + 13) * 930 + t * (13 + noise(i) * 18)) % 930;
                ellipse(x, y, 1 + noise(i) * 2.3, 1 + noise(i) * 2.3, '#e9f3ea70');
            }
        },
        sun() {
            rect(0, 0, 1440, 900, '#4c1820');
            const x = 1050, y = 335, rise = Math.sin(t * 0.15) * 8;
            for (let i = 0; i < 22; i++) {
                const angle = i / 22 * TAU;
                path([[x, y], [x + Math.cos(angle) * 1150, y + Math.sin(angle) * 1150], [x + Math.cos(angle + 0.085) * 1150, y + Math.sin(angle + 0.085) * 1150]], i % 2 ? '#b53031' : '#f4b34b33');
            }
            ellipse(x, y + rise, 121 + bass * 4, 121 + bass * 4, '#ffcf76');
            ellipse(x, y + rise, 102, 102, '#f4774b');
            mountain(650, '#75252a', 110, 16); mountain(760, '#391922', 80, 23);
            transformed(1050, 635, -0.04, 1, () => {
                path([[-280, -52], [280, -52], [245, 52], [-260, 52]], '#f7c879');
                text('RED SUN', 0, 16, 67, '#74262b', 'Impact', 'center');
            });
            for (let i = 0; i < 5; i++) {
                const x0 = 630 + i * 164; line([[x0, 750], [x0, 485]], '#461d24', 4);
                path([[x0, 488], [x0 + 84, 500 + Math.sin(t * 0.8 + i) * 8], [x0 + 79, 555], [x0, 545]], '#ce3b36');
            }
        },
        eastern() {
            gradient(0, 0, 1440, 900, '#24434c', '#0c252e');
            ellipse(1170, 205, 73, 73, '#e5d6ae65'); glow(1170, 205, 200, c, 0.06);
            mountain(590, '#47646a', 265, 3, Math.sin(t * 0.12) * 12); mountain(740, '#284950', 220, 40); mountain(910, '#17343c', 200, 7);
            for (let i = 0; i < 4; i++) {
                const y = 400 + i * 90, x = 900 + Math.sin(t * 0.18 + i) * 65;
                glow(x, y, 260, '#c7dad4', 0.045);
            }
            transformed(990, 575, 0, 1, () => {
                rect(-70, -210, 140, 212, '#132e36');
                for (let i = 0; i < 3; i++) {
                    const y = -225 + i * 83, w = 86 + i * 24;
                    path([[-w - 30, y + 18], [-w + 8, y + 2], [0, y - 25], [w - 8, y + 2], [w + 30, y + 18], [w, y + 34], [-w, y + 34]], '#10262f', '#698d88', 2);
                    rect(-w + 20, y + 34, (w - 20) * 2, 41, '#1d4147');
                    for (let j = -1; j <= 1; j++) {
                        rect(j * 35 - 6, y + 42, 12, 20, rgba(c, 0.33 + bass * 0.2));
                        glow(j * 35, y + 52, 20, c, 0.09 + bass * 0.07);
                    }
                }
                line([[0, -272], [0, -250]], '#c1b88b', 3);
            });
            line([[1280, 170], [1260, 400], [1220, 520], [1180, 575]], '#142c32', 8);
            line([[1267, 305], [1160, 270], [1100, 225]], '#142c32', 4);
            for (let i = 0; i < 25; i++) {
                const x = 1120 + noise(i) * 195, y = 180 + noise(i + 6) * 290;
                ellipse(x, y, 5 + noise(i) * 6, 4, rgba(b, 0.45));
            }
            for (let i = 0; i < 18; i++) transformed(600 + (noise(i) * 880 - t * 11 + 1500) % 880, (noise(i + 4) * 880 + t * 10) % 880, t * 0.3 + i, 1, () => ellipse(0, 0, 5, 2, rgba(b, 0.5)));
            line([[770, 602], [1310, 602]], '#adcabf24', 2);
        },
        retro() {
            gradient(0, 0, 1440, 900, '#402d28', '#171a22');
            transformed(1010, 395, -0.025, 1, () => {
                rect(-340, -263, 680, 493, '#6c4d33'); g.strokeStyle = '#c8ab6b'; g.lineWidth = 3; g.strokeRect(-327, -250, 654, 467);
                rect(-302, -226, 500, 411, '#211b29');
                for (let i = 0; i < 20; i++) gradient(-299 + i * 25, -222, 25, 398, i % 2 ? '#67372e' : '#3f2730', '#271d29');
                for (let i = 0; i < 3; i++) {
                    const x = -230 + i * 160;
                    path([[x, -213], [x + 4, -213], [-40 + i * 50, 115], [-150 + i * 50, 115]], rgba(c, 0.09 + bass * 0.02));
                }
                ellipse(-52, 111, 196, 32, '#9e855b66');
                dancer(-52, 105, 1.3, '#d6d0bb', t * 0.75, false);
                line([[-30, 91], [-30, -45]], '#171a20', 4); ellipse(-30, -47, 7, 13, '#1d2429');
                text('LIVE • 1976', -273, -185, 16, c);
                for (let i = 0; i < 2; i++) { ellipse(267, -116 + i * 98, 30, 30, '#332d26', '#beaa79', 3); line([[267, -136 + i * 98], [279, -116 + i * 98]], '#c6b88e', 4); }
                for (let i = 0; i < 12; i++) line([[235, 82 + i * 6], [301, 82 + i * 6]], '#3e3429', 2);
                for (let i = 0; i < 80; i++) line([[-298, -221 + i * 5], [196, -221 + i * 5]], '#0c12231f');
                rect(-270, 235, 50, 24, '#292627'); rect(212, 235, 50, 24, '#292627');
                text('COLOR BROADCAST', -52, 168, 13, b, 'Arial', 'center');
            });
            text('ЭДУАРД ХИЛЬ', 1000, 742, 24, rgba(c, 0.6), 'Georgia', 'center');
        }
    };
    window.MusicScenes = {
        modes: Object.freeze(Object.keys(scenes)),
        render(context, state) {
            g = context; t = state.time; bass = state.low; air = state.high; [a, b, c] = state.colors;
            g.save(); (scenes[state.mode] || scenes.space)(); g.restore();
        }
    };
})();
