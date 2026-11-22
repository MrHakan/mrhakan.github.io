// pizza shift 98: the page. Rendering, input, dialogs and saves; every rule
// lives in pizza-shift-sim.js (window.PIZZA_SIM) so node can test it.
(function () {
'use strict';
const S = window.PIZZA_SIM;
const $ = id => document.getElementById(id);
const canvas = $('view'), ctx = canvas.getContext('2d');
const SAVE_KEY = 'mrhakan98-pizzashift-save';
const STATIONS = ['order', 'topping', 'bake', 'cut', 'serve'];
const FACE_FILES = ['patronedasiyla.png', 'joe-cool-114.webp', 'sahurdudimi.png', 'nasiya.png', 'dusung-288.webp',
    'xdtroll.png', 'oleyy.png', 'thehehe.png', 'gunaydinbbg.png', 'pffft.png', 'heh.png', 'ingaaa.png',
    'yeterartik.png', 'bebetrol.png', 'toplum.png', 'hot-40.webp'];
const TOP_COLOR = { pepperoni: '#b8322a', mushroom: '#e3cfa8', olive: '#222', pepper: '#2f9e44', onion: '#b483c9', sausage: '#7b4a2b' };
const SHORT_REGION = { whole: 'whole', left: 'left half', right: 'right half', top: 'top half', bottom: 'bottom half',
    q0: 'top-right ¼', q1: 'top-left ¼', q2: 'bottom-left ¼', q3: 'bottom-right ¼' };
const PIECE = 0.085;
const KNIFE_STEP = Math.PI / 12;
// a few fixed cheese blobs so the pizza looks like food, not a disc
const SPOTS = [[0.3, -0.5, 0.12], [-0.45, -0.2, 0.1], [0.05, 0.1, 0.14], [0.55, 0.35, 0.1], [-0.3, 0.55, 0.12],
    [-0.62, 0.22, 0.08], [0.2, 0.68, 0.08], [0.68, -0.18, 0.09], [-0.12, -0.72, 0.09]];
const embedded = document.documentElement.hasAttribute('data-embedded');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// ------------------------------------------------------------ storage + sound
function loadGame() {
    try { const raw = localStorage.getItem(SAVE_KEY); return raw ? S.sanitizeSave(JSON.parse(raw)) : null; }
    catch (_) { return null; } // blocked or corrupt storage plays from scratch
}
function saveGame() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(game)); } catch (_) { /* saves are optional */ }
}
function soundOn() {
    try { return localStorage.getItem('sound-enabled') !== 'false'; } catch (_) { return true; }
}
let audio = null;
function tone(freq, dur = 0.07, type = 'square', vol = 0.03, delay = 0) {
    if (!soundOn()) return;
    try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === 'suspended') audio.resume();
        const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + delay;
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (_) { /* no audio, no problem */ }
}
const sfx = {
    tap: () => tone(660, 0.03, 'square', 0.015),
    bell: () => { tone(988, 0.12, 'triangle', 0.04); tone(1319, 0.18, 'triangle', 0.03, 0.08); },
    ready: () => { tone(784, 0.1, 'square', 0.03); tone(1047, 0.12, 'square', 0.03, 0.12); },
    bad: () => tone(140, 0.2, 'sawtooth', 0.03),
    cash: () => { tone(1568, 0.06, 'square', 0.025); tone(2093, 0.12, 'square', 0.025, 0.07); },
    chop: () => tone(220, 0.05, 'triangle', 0.04)
};

// ------------------------------------------------------------ state
let game = loadGame() || S.newGame(freshSeed());
let ds = null, phase = 'title', paused = false;
let station = 'order', sel = 0, topping = 'pepperoni';
const cursor = { x: 0, y: 0 };
let knife = 0, drag = null, lastResult = null, overAt = 0, raf = 0, last = 0;
let W = 720, H = 420, scale = 1;
const G = { narrow: false, ticket: { x: 0, y: 0, w: 0, h: 0 }, cx: 0, cy: 0, r: 100, front: { x: 0, y: 0, s: 80 }, ovens: [] };
function freshSeed() { return (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0; }

const faces = FACE_FILES.map(f => { const img = new Image(); img.src = '../../src/emoj/' + f; return img; });

// ------------------------------------------------------------ layout
function resize() {
    const cw = Math.max(240, Math.floor(canvas.parentElement.clientWidth));
    const narrow = cw < 520;
    const chrome = document.getElementById('app').offsetHeight - canvas.offsetHeight;
    const avail = window.innerHeight - chrome - (embedded ? 4 : 50);
    const want = narrow ? cw * 1.0 : cw * 0.56;
    const h = Math.round(Math.max(narrow ? 300 : 260, Math.min(want, avail, 520)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cw; H = h; scale = dpr;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = H + 'px';
    G.narrow = narrow;
    if (narrow) {
        const th = 106;
        G.ticket.x = 6; G.ticket.y = 6; G.ticket.w = W - 12; G.ticket.h = th;
        G.cx = W / 2; G.cy = th + 10 + (H - th - 10) / 2; G.r = Math.min(W / 2 - 16, (H - th - 10) / 2 - 22) / 1.1;
    } else {
        const tw = Math.min(210, Math.round(W * 0.3));
        G.ticket.x = 8; G.ticket.y = 8; G.ticket.w = tw; G.ticket.h = H - 16;
        G.cx = tw + 16 + (W - tw - 16) / 2; G.cy = H / 2 + 8; G.r = Math.min((W - tw - 16) / 2 - 16, H / 2 - 30) / 1.1;
    }
    const s = Math.min(H * 0.34, W * 0.2, 120);
    G.front.s = s; G.front.x = W * (narrow ? 0.3 : 0.26); G.front.y = H * 0.66 - s * 0.5;
    layoutOvens(); draw();
}
function layoutOvens() {
    const n = ds ? ds.ovens.length : game.upgrades.ovens;
    const cols = G.narrow ? Math.min(n, 2) : n, rows = Math.ceil(n / cols);
    const cw = (W - 12) / cols, ch = (H - 12) / rows;
    G.ovens.length = 0;
    for (let i = 0; i < n; i++) G.ovens.push({ x: 6 + (i % cols) * cw + 4, y: 6 + Math.floor(i / cols) * ch + 4, w: cw - 8, h: ch - 8 });
}
function toUnit(e) {
    const b = canvas.getBoundingClientRect();
    const px = (e.clientX - b.left) * W / b.width, py = (e.clientY - b.top) * H / b.height;
    return { px, py, x: (px - G.cx) / G.r, y: (py - G.cy) / G.r };
}

// ------------------------------------------------------------ drawing helpers
function rr(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2); }
function text(str, x, y, size, color, align = 'left', bold = false) {
    ctx.font = (bold ? 'bold ' : '') + size + 'px Tahoma, Verdana, sans-serif';
    ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(str, x, y);
}
function bevel(x, y, w, h, fill) {
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
    ctx.fillStyle = '#404040'; ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);
}
const BAKE_CRUST = [[241, 217, 166], [234, 190, 110], [214, 150, 66], [160, 95, 40], [80, 48, 24], [30, 22, 18]];
const BAKE_CHEESE = [[255, 246, 196], [252, 228, 130], [244, 196, 80], [214, 146, 48], [110, 74, 40], [40, 30, 24]];
function mix(stops, heat) {
    const v = Math.max(0, Math.min(stops.length - 1.001, heat));
    const i = Math.floor(v), f = v - i, a = stops[i], b = stops[i + 1];
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
}
function drawTopping(t, x, y, s, spin) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(spin || 0);
    switch (t) {
        case 'pepperoni':
            ctx.fillStyle = '#b8322a'; circle(0, 0, s); ctx.fill();
            ctx.fillStyle = '#8c1f1a'; circle(-s * 0.35, -s * 0.2, s * 0.18); ctx.fill(); circle(s * 0.3, s * 0.3, s * 0.15); ctx.fill(); circle(s * 0.25, -s * 0.4, s * 0.12); ctx.fill();
            break;
        case 'mushroom':
            ctx.fillStyle = '#c9b48d'; ctx.fillRect(-s * 0.25, -s * 0.05, s * 0.5, s * 0.8);
            ctx.fillStyle = '#e8d6b5'; ctx.strokeStyle = '#8a6e4b'; ctx.lineWidth = Math.max(1, s * 0.12);
            ctx.beginPath(); ctx.arc(0, s * 0.1, s * 0.9, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
            break;
        case 'olive':
            ctx.strokeStyle = '#1d1d1d'; ctx.lineWidth = s * 0.5; circle(0, 0, s * 0.62); ctx.stroke();
            break;
        case 'pepper':
            ctx.strokeStyle = '#2f9e44'; ctx.lineWidth = s * 0.42; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.arc(0, s * 0.3, s * 0.85, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); ctx.lineCap = 'butt';
            break;
        case 'onion':
            ctx.strokeStyle = '#b483c9'; ctx.lineWidth = s * 0.28; circle(0, 0, s * 0.8); ctx.stroke();
            ctx.strokeStyle = '#f3e6f7'; ctx.lineWidth = s * 0.16; ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0.3, Math.PI * 1.6); ctx.stroke();
            break;
        default: // sausage
            ctx.fillStyle = '#7b4a2b';
            circle(-s * 0.25, 0, s * 0.62); ctx.fill(); circle(s * 0.3, -s * 0.15, s * 0.55); ctx.fill(); circle(s * 0.1, s * 0.35, s * 0.5); ctx.fill();
            ctx.fillStyle = '#a5714a'; circle(-s * 0.2, -s * 0.15, s * 0.14); ctx.fill(); circle(s * 0.3, s * 0.2, s * 0.12); ctx.fill();
    }
    ctx.restore();
}
function heatOf(tk) {
    if (tk.status === 'baking') return ds.ovens[tk.oven].heat;
    return tk.status === 'ordered' ? 0 : tk.heat;
}
function drawPizza(cx, cy, R, tk, opt) {
    const heat = tk ? heatOf(tk) : 0;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; circle(cx + R * 0.05, cy + R * 0.08, R * 1.12); ctx.fill();
    ctx.fillStyle = mix(BAKE_CRUST, heat); circle(cx, cy, R * 1.1); ctx.fill();
    ctx.strokeStyle = 'rgba(80,40,10,.5)'; ctx.lineWidth = Math.max(1, R * 0.02); ctx.stroke();
    ctx.fillStyle = heat > 3.5 ? '#5a2014' : '#c8442c'; circle(cx, cy, R); ctx.fill();
    ctx.fillStyle = mix(BAKE_CHEESE, heat); circle(cx, cy, R * 0.93); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,230,.35)';
    for (const s of SPOTS) { circle(cx + s[0] * R, cy + s[1] * R, s[2] * R); ctx.fill(); }
    if (opt && opt.guides) {
        ctx.strokeStyle = 'rgba(90,40,0,.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
        ctx.setLineDash([]);
    }
    if (!tk) return;
    const s = PIECE * R;
    for (const p of tk.pieces) drawTopping(p.t, cx + p.x * R, cy + p.y * R, s, (p.x * 7.3 + p.y * 13.1) % 6.283);
    if (heat > 0.2) { // a light glaze so baked toppings look baked
        ctx.fillStyle = 'rgba(120,60,10,' + Math.min(0.45, (heat - 0.2) * 0.1) + ')'; circle(cx, cy, R); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(40,20,10,.85)'; ctx.lineWidth = Math.max(1.5, R * 0.025);
    for (const c of tk.cuts) {
        const ux = Math.cos(c.angle), uy = Math.sin(c.angle), d = c.d || 0;
        const px = -uy * d, py = ux * d, half = Math.sqrt(Math.max(0, 1.21 - d * d));
        ctx.beginPath(); ctx.moveTo(cx + (px - ux * half) * R, cy + (py - uy * half) * R);
        ctx.lineTo(cx + (px + ux * half) * R, cy + (py + uy * half) * R); ctx.stroke();
    }
}
function drawFace(idx, x, y, size, vip) {
    const img = faces[idx];
    if (img && img.complete && img.naturalWidth) {
        const k = Math.min(size / img.naturalWidth, size / img.naturalHeight);
        const w = img.naturalWidth * k, h = img.naturalHeight * k;
        ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
    } else {
        ctx.fillStyle = '#ffd34d'; circle(x, y, size * 0.45); ctx.fill();
        ctx.fillStyle = '#222'; circle(x - size * 0.15, y - size * 0.08, size * 0.05); ctx.fill(); circle(x + size * 0.15, y - size * 0.08, size * 0.05); ctx.fill();
        ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y + size * 0.05, size * 0.2, 0.2, Math.PI - 0.2); ctx.stroke();
    }
    if (vip) {
        const c = size * 0.22, top = y - size * 0.5;
        ctx.fillStyle = '#ffcc00'; ctx.strokeStyle = '#8a6d00'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x - c, top); ctx.lineTo(x - c, top - c * 0.9); ctx.lineTo(x - c * 0.5, top - c * 0.45);
        ctx.lineTo(x, top - c * 1.1); ctx.lineTo(x + c * 0.5, top - c * 0.45); ctx.lineTo(x + c, top - c * 0.9); ctx.lineTo(x + c, top);
        ctx.closePath(); ctx.fill(); ctx.stroke();
    }
}
function patienceFrac(c) { return Math.max(0, 1 - (ds.t - c.arrive) / (2 * c.patience)); }
function patienceColor(c) { const w = ds.t - c.arrive; return w < c.patience * 0.7 ? '#2fae3a' : w < c.patience ? '#e6a400' : '#d42020'; }
function drawPatience(c, x, y, w) {
    ctx.fillStyle = '#333'; ctx.fillRect(x, y, w, 6);
    ctx.fillStyle = patienceColor(c); ctx.fillRect(x + 1, y + 1, (w - 2) * patienceFrac(c), 4);
}
function bubble(x, y, str, size) {
    ctx.font = size + 'px Tahoma, Verdana, sans-serif';
    const w = Math.min(ctx.measureText(str).width + 14, W - 8), h = size + 12;
    const bx = Math.max(4, Math.min(W - w - 4, x)), by = Math.max(4, y - h);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; rr(bx, by, w, h, 6); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + 12, by + h - 1); ctx.lineTo(bx + 6, by + h + 8); ctx.lineTo(bx + 22, by + h - 1); ctx.fill();
    text(str, bx + 7, by + size + 3, size, '#111');
}
function itemCenters(q, k) {
    // up to four item slots per quarter on the mini diagram
    const a = -(q + 0.5) * Math.PI / 2 + (k % 2 ? 0.32 : -0.32), r = k < 2 ? 0.42 : 0.74;
    return [Math.cos(a) * r, Math.sin(a) * r];
}
function drawTicket(tk, c, rect) {
    const { x, y, w, h } = rect;
    const order = tk ? tk.order : c.order;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + 3, y + 3, w, h);
    ctx.fillStyle = c.vip ? '#fff3c2' : '#fffdf0'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#c0392b'; ctx.fillRect(x, y, w, 4);
    ctx.strokeStyle = '#a99'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    text('#' + c.id + ' ' + c.name + (c.vip ? '  ★ vip' : ''), x + 6, y + 17, 12, '#000', 'left', true);
    const compact = h < 150;
    const d = compact ? h - 30 : Math.min(w - 30, h * 0.36, 130);
    const dx = compact ? x + 6 + d / 2 : x + w / 2, dy = compact ? y + 23 + d / 2 : y + 26 + d / 2;
    const R = d / 2;
    ctx.fillStyle = '#f0d39c'; circle(dx, dy, R); ctx.fill();
    ctx.fillStyle = '#f8e6a8'; circle(dx, dy, R * 0.88); ctx.fill();
    ctx.strokeStyle = '#a07040'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(dx - R, dy); ctx.lineTo(dx + R, dy); ctx.moveTo(dx, dy - R); ctx.lineTo(dx, dy + R); ctx.stroke();
    order.items.forEach((it, k) => {
        for (const q of S.REGIONS[it.region]) { const p = itemCenters(q, k); drawTopping(it.topping, dx + p[0] * R * 0.88, dy + p[1] * R * 0.88, Math.max(3, R * 0.11), 0); }
    });
    const lines = order.items.map(it => S.TOPPINGS[S.TOPPING_INDEX[it.topping]].name + ' · ' + SHORT_REGION[it.region]);
    lines.push('bake: ' + S.BAKES[S.BAKE_INDEX[order.bake]].name, 'slices: ' + order.slices);
    const fs = compact ? 10 : 12, lx = compact ? x + d + 14 : x + 8;
    let ly = compact ? y + 32 : dy + R + 18;
    const step = compact ? Math.min(13, (h - 32) / lines.length) : 16;
    lines.forEach((ln, i) => { text(ln, lx, ly, fs, i >= order.items.length ? '#7a1010' : '#222', 'left', i >= order.items.length); ly += step; });
    if (c.status === 'waiting' || c.status === 'queue') drawPatience(c, x + 6, y + h - 10, w - 12);
}

// ------------------------------------------------------------ stations
function drawOrder() {
    const counter = H * 0.66;
    ctx.fillStyle = '#f2d6a2'; ctx.fillRect(0, 0, W, counter);
    ctx.fillStyle = '#e8c88e'; for (let x = 0; x < W; x += 28) ctx.fillRect(x, 0, 14, counter);
    // menu board
    const bw = Math.min(W * 0.44, 260);
    bevel(8, 8, bw, Math.min(56, H * 0.16), '#2b2b2b');
    text('PIZZA SHIFT 98', 18, 30, 14, '#ffcf3a', 'left', true);
    text('day ' + (ds ? ds.day : game.day) + ' · open til the last slice', 18, Math.min(50, 8 + H * 0.16 - 8), 10, '#ddd');
    const decor = game.upgrades.decor;
    if (decor >= 1) { // a pot plant
        const px = W - 26, py = counter - 6;
        ctx.fillStyle = '#a0522d'; ctx.fillRect(px - 10, py - 18, 20, 18);
        ctx.fillStyle = '#2e8b3e'; circle(px - 6, py - 26, 9); ctx.fill(); circle(px + 6, py - 28, 9); ctx.fill(); circle(px, py - 38, 9); ctx.fill();
    }
    if (decor >= 2) text('OPEN', W - 70, 26, 16, '#ff3caa', 'left', true);
    if (decor >= 3) { bevel(W - 66, counter - 70, 30, 64, '#7b3fa0'); ctx.fillStyle = '#ffd34d'; circle(W - 51, counter - 48, 8); ctx.fill(); }
    ctx.fillStyle = '#8b5a2b'; ctx.fillRect(0, counter, W, H - counter);
    ctx.fillStyle = '#a86f3a'; ctx.fillRect(0, counter, W, 8);
    if (!ds) return;
    const line = S.queue(ds).sort((a, b) => a.arrive - b.arrive);
    const f = G.front;
    for (let i = Math.min(line.length, 5) - 1; i >= 0; i--) {
        const c = line[i], s = i ? f.s * 0.78 : f.s, x = f.x - i * f.s * 0.72, y = f.y + (i ? f.s * 0.08 : 0);
        if (x < -s / 2) continue;
        drawFace(c.face, x, y, s, c.vip);
        drawPatience(c, x - s * 0.4, y + s * 0.55, s * 0.8);
    }
    if (line.length > 5) text('+' + (line.length - 5) + ' more', 6, counter - 8, 11, '#552');
    if (line.length) bubble(f.x + f.s * 0.35, f.y - f.s * 0.45, line[0].vip ? 'i am a VIP. hurry.' : 'one pizza please!', 12);
    // pickup bench
    const waiting = ds.customers.filter(c => c.status === 'waiting');
    const ax = W * (G.narrow ? 0.56 : 0.55), aw = W - ax - (decor >= 1 ? 40 : 8), s2 = Math.min(50, H * 0.14);
    const cols = Math.max(1, Math.floor(aw / (s2 + 10)));
    text('pickup bench', ax, H * 0.66 - 4 - Math.ceil(Math.max(1, waiting.length) / cols) * (s2 + 24) - 4, 11, '#6b4a20', 'left', true);
    waiting.forEach((c, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = ax + col * (s2 + 10) + s2 / 2, y = counter - 18 - row * (s2 + 24) - s2 / 2;
        if (y < s2 / 2) return;
        drawFace(c.face, x, y, s2, c.vip);
        drawPatience(c, x - s2 / 2, y + s2 / 2 + 2, s2);
        text('#' + c.id, x, y + s2 / 2 + 16, 10, '#333', 'center', true);
    });
    // what the counter says
    const next = ds.customers.find(c => c.status === 'coming');
    const msg = line.length ? 'tap the customer or press enter to take the order' :
        next ? 'next customer in ' + Math.max(1, Math.ceil(next.arrive - ds.t)) + 's' : 'nobody else is coming today';
    text(msg, W / 2, counter + 30, G.narrow ? 11 : 13, '#fff6dc', 'center');
    const done = ds.customers.filter(c => c.status === 'served' || c.status === 'left').length;
    text(done + ' of ' + ds.customers.length + ' customers done', W / 2, counter + 50, 11, '#f1d9b0', 'center');
}
function current(status) { const tk = ds && S.ticket(ds, sel); return tk && status.includes(tk.status) ? tk : null; }
function emptyNote(msg) { text(msg, G.cx, G.cy, 13, '#fff', 'center', true); }
function drawTopping_() {
    ctx.fillStyle = '#b5835a'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,.06)'; for (let y = 0; y < H; y += 18) ctx.fillRect(0, y, W, 2);
    const tk = current(['ordered']);
    if (!tk) { drawPizza(G.cx, G.cy, G.r, null, { guides: true }); emptyNote('no dough here: take an order first'); return; }
    drawTicket(tk, S.customer(ds, tk.id), G.ticket);
    drawPizza(G.cx, G.cy, G.r, tk, { guides: true });
    text('placing: ' + S.TOPPINGS[S.TOPPING_INDEX[topping]].name + (ds.scoop ? ' (scoop ×2)' : ''), G.cx, G.cy - G.r * 1.1 - 8, 12, '#fff', 'center', true);
    if (document.activeElement === canvas) {
        const x = G.cx + cursor.x * G.r, y = G.cy + cursor.y * G.r;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); ctx.stroke();
    }
}
function drawBake() {
    ctx.fillStyle = '#7a3324'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#8d3f2d';
    for (let y = 0, r = 0; y < H; y += 16, r++) for (let x = (r % 2) * 18; x < W; x += 36) ctx.fillRect(x, y, 34, 14);
    if (!ds) return;
    const blink = !reduced.matches && Math.floor(performance.now() / 350) % 2;
    ds.ovens.forEach((o, i) => {
        const r = G.ovens[i]; if (!r) return;
        bevel(r.x, r.y, r.w, r.h, '#6b6b6b');
        text('oven ' + (i + 1), r.x + 8, r.y + 17, 12, '#fff', 'left', true);
        const barH = 14, win = { x: r.x + 8, y: r.y + 24, w: r.w - 16, h: r.h - 24 - barH - 40 };
        ctx.fillStyle = o.ticket ? '#2a0f05' : '#1a1a1a'; ctx.fillRect(win.x, win.y, win.w, win.h);
        if (o.ticket) {
            const glow = ctx.createLinearGradient(0, win.y, 0, win.y + win.h);
            glow.addColorStop(0, 'rgba(255,120,20,.15)'); glow.addColorStop(1, 'rgba(255,90,0,.55)');
            ctx.fillStyle = glow; ctx.fillRect(win.x, win.y, win.w, win.h);
            const tk = S.ticket(ds, o.ticket), R = Math.min(win.w, win.h) / 2.5;
            drawPizza(win.x + win.w / 2, win.y + win.h / 2, R, tk, null);
            const target = S.bakeTarget(tk.order), by = win.y + win.h + 8, bw = win.w, k = bw / 4.6;
            ctx.fillStyle = '#222'; ctx.fillRect(win.x, by, bw, barH);
            ctx.fillStyle = '#b8e0a0'; ctx.fillRect(win.x + (target - 0.5) * k, by, k, barH);
            ctx.fillStyle = '#2fae3a'; ctx.fillRect(win.x + (target - 0.1) * k, by, 0.2 * k, barH);
            ctx.fillStyle = '#d42020'; ctx.fillRect(win.x + S.BURN_AT * k, by, bw - S.BURN_AT * k, barH);
            const hx = win.x + Math.min(4.6, o.heat) * k;
            ctx.fillStyle = '#fff'; ctx.fillRect(hx - 2, by - 3, 4, barH + 6);
            const want = S.BAKES[S.BAKE_INDEX[tk.order.bake]].name;
            const word = o.heat >= S.BURN_AT ? 'BURNT!' : Math.abs(o.heat - target) <= 0.1 ? 'READY!' : o.heat > target ? 'overdone' : 'baking...';
            const hot = word === 'READY!' || word === 'BURNT!';
            text('#' + tk.id + ' wants ' + want, r.x + 8, by + barH + 16, 11, '#fff');
            if (!hot || blink) text(word, r.x + r.w - 8, r.y + 17, 12, word === 'BURNT!' ? '#ff6b6b' : hot ? '#8f8' : '#ffd', 'right', true);
        } else {
            text('empty', win.x + win.w / 2, win.y + win.h / 2 + 4, 12, '#888', 'center');
            text('free', r.x + r.w - 8, r.y + 17, 11, '#ccc', 'right');
        }
    });
}
function drawCut() {
    ctx.fillStyle = '#d8d4cc'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,120,120,.18)'; ctx.lineWidth = 3;
    for (let i = -H; i < W; i += 60) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H * 0.6, H); ctx.stroke(); }
    const tk = current(['baked']);
    ctx.fillStyle = '#7a5530'; circle(G.cx, G.cy, G.r * 1.2); ctx.fill();
    if (!tk) { emptyNote('nothing out of the oven yet'); return; }
    drawTicket(tk, S.customer(ds, tk.id), G.ticket);
    drawPizza(G.cx, G.cy, G.r, tk, null);
    text(tk.cuts.length + ' cuts · wants ' + tk.order.slices + ' slices (' + tk.order.slices / 2 + ' cuts)', G.cx, G.cy - G.r * 1.1 - 8, 12, '#222', 'center', true);
    ctx.setLineDash([7, 6]); ctx.lineWidth = 2;
    if (drag) {
        ctx.strokeStyle = '#0040c0';
        ctx.beginPath(); ctx.moveTo(G.cx + drag.x1 * G.r, G.cy + drag.y1 * G.r); ctx.lineTo(G.cx + drag.x2 * G.r, G.cy + drag.y2 * G.r); ctx.stroke();
    } else {
        const ux = Math.cos(knife) * G.r * 1.18, uy = Math.sin(knife) * G.r * 1.18;
        ctx.strokeStyle = 'rgba(0,40,160,.45)';
        ctx.beginPath(); ctx.moveTo(G.cx - ux, G.cy - uy); ctx.lineTo(G.cx + ux, G.cy + uy); ctx.stroke();
    }
    ctx.setLineDash([]);
}
function drawBars(x, y, w, r) {
    const rows = [['toppings', r.parts.topping], ['bake', r.parts.bake], ['cut', r.parts.cut], ['wait', r.parts.wait]];
    rows.forEach(([name, v], i) => {
        const yy = y + i * 22;
        text(name, x, yy + 11, 11, '#222');
        ctx.fillStyle = '#444'; ctx.fillRect(x + 62, yy, w - 100, 14);
        ctx.fillStyle = v >= 85 ? '#2fae3a' : v >= 55 ? '#e6a400' : '#d42020'; ctx.fillRect(x + 63, yy + 1, (w - 102) * v / 100, 12);
        text(String(v), x + w - 4, yy + 12, 12, '#000', 'right', true);
    });
}
function drawServe() {
    ctx.fillStyle = '#f0e0c0'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#8b5a2b'; ctx.fillRect(0, H * 0.72, W, H * 0.28);
    if (!ds) return;
    const showResult = lastResult && ds.t - lastResult.at < 6;
    const tk = current(['baked']);
    if (showResult || !tk) {
        if (!lastResult) { text('nothing to serve yet', W / 2, H / 2, 14, '#5a3b10', 'center', true); return; }
        const r = lastResult.r, c = S.customer(ds, r.id);
        const fs = Math.min(H * 0.32, 110), fx = G.narrow ? W / 2 : W * 0.25, fy = G.narrow ? fs / 2 + 34 : H * 0.42;
        drawFace(c.face, fx, fy, fs, c.vip);
        bubble(G.narrow ? 8 : fx - fs * 0.6, fy - fs * 0.55, r.reaction, 12);
        const cw = G.narrow ? W - 24 : Math.min(320, W * 0.48), cx = G.narrow ? 12 : W * 0.5, cy = G.narrow ? fy + fs / 2 + 14 : H * 0.18;
        bevel(cx, cy, cw, 150, '#d4d0c8');
        text('#' + r.id + ' ' + r.name + (r.vip ? ' (vip)' : ''), cx + 10, cy + 20, 12, '#000', 'left', true);
        drawBars(cx + 10, cy + 30, cw - 20, r);
        text('score ' + r.total, cx + 10, cy + 136, 15, '#000080', 'left', true);
        text('tip $' + (r.tip / 100).toFixed(2), cx + cw - 10, cy + 136, 15, '#106b10', 'right', true);
        if (!showResult) text('nothing else to serve right now', W / 2, H - 14, 11, '#fff', 'center');
        return;
    }
    const c = S.customer(ds, tk.id);
    const fs = Math.min(H * 0.34, 110), fx = G.narrow ? 56 : W * 0.25, fy = G.narrow ? fs / 2 + 30 : H * 0.42;
    drawFace(c.face, fx, fy, fs, c.vip);
    drawPatience(c, fx - fs / 2, fy + fs / 2 + 4, fs);
    bubble(fx + fs * 0.3, fy - fs * 0.5, tk.cuts.length ? 'is that mine?' : 'uh, it is not even cut', 12);
    const R = G.narrow ? Math.min(W * 0.34, (H - fs - 60) / 2.3) : Math.min(W * 0.18, H * 0.3);
    drawPizza(G.narrow ? W / 2 : W * 0.66, G.narrow ? H - R * 1.25 - 6 : H * 0.5, R, tk, null);
}
function drawSplash() {
    ctx.fillStyle = '#c0392b'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; const sq = 28;
    for (let y = 0; y < H; y += sq) for (let x = ((y / sq) % 2) * sq; x < W; x += sq * 2) ctx.fillRect(x, y, sq, sq);
    const R = Math.min(W, H) * 0.3;
    drawPizza(W / 2, H / 2, R, { status: 'baked', heat: 2, pieces: SPLASH, cuts: SPLASH_CUTS, order: null }, null);
}
const SPLASH = S.perfectPieces({ items: [{ topping: 'pepperoni', region: 'whole' }, { topping: 'olive', region: 'left' }, { topping: 'mushroom', region: 'right' }, { topping: 'pepper', region: 'q3' }] });
const SPLASH_CUTS = [0, 1, 2, 3].map(i => ({ angle: i * Math.PI / 4, d: 0 }));
function draw() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.textAlign = 'left';
    if (!ds) { drawSplash(); return; }
    if (station === 'order') drawOrder();
    else if (station === 'topping') drawTopping_();
    else if (station === 'bake') drawBake();
    else if (station === 'cut') drawCut();
    else drawServe();
}

// ------------------------------------------------------------ dom ui
const tabs = [...document.querySelectorAll('.tabs [data-station]')];
const groups = [...document.querySelectorAll('.controls [data-for]')];
const say = msg => { $('status').textContent = msg; };
function setText(el, v) { if (el.textContent !== v) el.textContent = v; }
function setDisabled(el, v) { if (el.disabled !== v) el.disabled = v; }
const money = c => '$' + (c / 100).toFixed(2);
const bins = S.TOPPINGS.map((t, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'bin'; b.dataset.topping = t.id; b.setAttribute('aria-pressed', String(t.id === topping));
    b.innerHTML = '<i style="background:' + TOP_COLOR[t.id] + '"></i>' + t.name + ' <kbd>' + (i + 1) + '</kbd>';
    b.setAttribute('aria-label', t.name);
    b.addEventListener('click', () => pickTopping(t.id));
    return b;
});
$('bins').replaceChildren(...bins);
let ovenButtons = [];
function buildOvenButtons() {
    ovenButtons = ds.ovens.map((_, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.oven = i;
        b.addEventListener('click', () => takeOut(i));
        return b;
    });
    $('oven-btns').replaceChildren(...ovenButtons);
}
function pickTopping(id) {
    topping = id;
    bins.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.topping === id)));
    draw();
}
function setStation(s) {
    if (!STATIONS.includes(s)) return;
    station = s; drag = null;
    tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.station === s)));
    groups.forEach(g => { g.hidden = g.dataset.for !== s; });
    pickFor(s); sync(); draw();
}
function pickFor(s) {
    if (!ds) return;
    const want = s === 'topping' ? 'ordered' : s === 'cut' || s === 'serve' ? 'baked' : null;
    if (!want) return;
    const cur = S.ticket(ds, sel);
    if (cur && cur.status === want) return;
    const pref = s === 'cut' ? t => !t.cuts.length : s === 'serve' ? t => t.cuts.length > 0 : () => true;
    const next = ds.tickets.find(t => t.status === want && pref(t)) || ds.tickets.find(t => t.status === want);
    sel = next ? next.id : 0;
}
let railKey = '';
function syncRail() {
    const live = ds ? ds.tickets.filter(t => t.status !== 'served' && t.status !== 'void') : [];
    const key = live.map(t => t.id + t.status + t.cuts.length + (t.id === sel) + patienceColor(S.customer(ds, t.id))).join('|');
    if (key === railKey) return;
    railKey = key;
    $('rail').replaceChildren(...live.map(t => {
        const c = S.customer(ds, t.id), b = document.createElement('button');
        b.type = 'button'; b.dataset.ticket = t.id;
        b.className = (c.vip ? 'vip ' : '') + (ds.t - c.arrive > c.patience ? 'late' : '');
        b.setAttribute('aria-pressed', String(t.id === sel));
        const what = t.status === 'ordered' ? 'needs toppings' : t.status === 'baking' ? 'in oven ' + (t.oven + 1) : t.cuts.length ? 'ready to serve' : 'needs cutting';
        b.innerHTML = '#' + t.id + ' ' + c.name + '<small>' + what + '</small>';
        b.addEventListener('click', () => openTicket(t.id));
        return b;
    }));
}
function openTicket(id) {
    const t = S.ticket(ds, id); if (!t || phase !== 'playing') return;
    sel = id;
    const s = t.status === 'ordered' ? 'topping' : t.status === 'baking' ? 'bake' : station === 'serve' || t.cuts.length ? (station === 'cut' ? 'cut' : 'serve') : 'cut';
    setStation(s);
}
function sync() {
    const live = phase === 'playing' && !paused && ds && !ds.over;
    setText($('hud-day'), (ds ? ds.day : game.day) + '/' + S.DAYS);
    setText($('hud-money'), money(game.money));
    setText($('hud-today'), money(ds ? ds.earned : 0));
    setText($('hud-served'), ds ? ds.results.filter(r => !r.walkout).length + '/' + ds.customers.length : '0/0');
    setText($('btn-pause'), paused ? 'resume' : 'pause');
    setDisabled($('btn-pause'), phase !== 'playing');
    const badges = { order: 0, topping: 0, bake: 0, cut: 0, serve: 0 };
    let hotBake = false;
    if (ds) {
        badges.order = S.queue(ds).length;
        for (const t of ds.tickets) {
            if (t.status === 'ordered') badges.topping++;
            else if (t.status === 'baked') badges[t.cuts.length ? 'serve' : 'cut']++;
        }
        ds.ovens.forEach(o => { if (o.ticket && o.heat >= S.bakeTarget(S.ticket(ds, o.ticket).order) - 0.1) { badges.bake++; hotBake = true; } });
    }
    tabs.forEach(t => {
        const b = t.querySelector('.badge'), n = badges[t.dataset.station];
        setText(b, n ? String(n) : '');
        b.classList.toggle('hot', t.dataset.station === 'bake' && hotBake);
        setDisabled(t, phase !== 'playing');
    });
    const tk = ds && S.ticket(ds, sel);
    setDisabled($('btn-take'), !live || !S.queue(ds).length);
    const top = live && tk && tk.status === 'ordered';
    setDisabled($('btn-undo'), !top || !tk.pieces.length);
    setDisabled($('btn-clear'), !top || !tk.pieces.length);
    setDisabled($('btn-oven'), !top || S.freeOven(ds) < 0);
    setText($('btn-oven'), top && S.freeOven(ds) < 0 ? 'ovens full' : 'to oven →');
    bins.forEach(b => setDisabled(b, !live));
    if (ds) ovenButtons.forEach((b, i) => {
        const o = ds.ovens[i];
        setText(b, o.ticket ? (i + 1) + ': take out #' + o.ticket : (i + 1) + ': empty');
        setDisabled(b, !live || !o.ticket);
    });
    const baked = live && tk && tk.status === 'baked';
    setDisabled($('btn-uncut'), !baked || !tk.cuts.length);
    setDisabled($('btn-to-serve'), !baked);
    setDisabled($('btn-serve'), !baked || station !== 'serve');
    setText($('btn-serve'), baked ? 'serve #' + tk.id + (tk.cuts.length ? '' : ' (uncut!)') : 'serve');
    syncRail();
}

// ------------------------------------------------------------ actions
function playing() { return phase === 'playing' && !paused && ds && !ds.over; }
function takeOrder() {
    if (!playing()) return;
    const id = S.takeOrder(ds);
    if (!id) { say('nobody is at the counter.'); return; }
    sel = id; sfx.bell();
    const c = S.customer(ds, id), o = c.order;
    say('ticket #' + id + ' for ' + c.name + ': ' + o.items.map(it => it.topping + ' ' + SHORT_REGION[it.region]).join(', ') +
        ', ' + S.BAKES[S.BAKE_INDEX[o.bake]].name + ', ' + o.slices + ' slices. press t for topping.');
    sync(); draw();
}
function place(x, y) {
    if (!playing()) return;
    const tk = current(['ordered']);
    if (!tk) { say('no dough on the board: take an order first.'); return; }
    if (S.addPiece(ds, tk.id, topping, x, y)) sfx.tap();
    sync(); draw();
}
function undoPiece() { const tk = current(['ordered']); if (playing() && tk && S.undoPiece(ds, tk.id)) { sync(); draw(); } }
function toOven() {
    if (!playing()) return;
    const tk = current(['ordered']); if (!tk) return;
    const i = S.toOven(ds, tk.id);
    if (i < 0) { say('every oven is busy. pull something out first.'); sfx.bad(); return; }
    say('#' + tk.id + ' is in oven ' + (i + 1) + '. it bakes while you work elsewhere: watch the bake tab.');
    sfx.tap(); pickFor('topping'); sync(); draw();
}
function bakeWord(heat, target) {
    if (heat >= S.BURN_AT) return 'burnt to a crisp';
    const d = heat - target;
    return Math.abs(d) <= 0.1 ? 'perfect bake' : d < -0.5 ? 'basically raw' : d < 0 ? 'a bit pale' : d > 0.5 ? 'overdone' : 'a bit dark';
}
function takeOut(i) {
    if (!playing()) return;
    const id = S.takeOut(ds, i);
    if (!id) return;
    const tk = S.ticket(ds, id);
    say('#' + id + ' out of oven ' + (i + 1) + ': ' + bakeWord(tk.heat, S.bakeTarget(tk.order)) + '. cut it next (c).');
    sfx.tap(); if (!sel || !S.ticket(ds, sel) || S.ticket(ds, sel).status !== 'ordered') sel = id;
    sync(); draw();
}
function cut(x1, y1, x2, y2) {
    if (!playing()) return;
    const tk = current(['baked']); if (!tk) return;
    const r = S.addCut(ds, tk.id, x1, y1, x2, y2);
    if (!r.ok) { say(r.reason + '.'); sfx.bad(); }
    else {
        sfx.chop();
        const want = tk.order.slices / 2;
        say(tk.cuts.length + ' of ' + want + ' cuts.' + (tk.cuts.length === want ? ' done: serve it (s).' : tk.cuts.length > want ? ' that is too many. undo?' : ''));
    }
    sync(); draw();
}
function knifeCut() { cut(-Math.cos(knife), -Math.sin(knife), Math.cos(knife), Math.sin(knife)); }
function undoCut() { const tk = current(['baked']); if (playing() && tk && S.undoCut(ds, tk.id)) { sync(); draw(); } }
function serve() {
    if (!playing() || station !== 'serve') return;
    const tk = current(['baked']); if (!tk) return;
    const r = S.serve(ds, tk.id);
    if (!r) return;
    lastResult = { r, at: ds.t };
    r.tip ? sfx.cash() : sfx.bad();
    say('#' + r.id + ' ' + r.name + ' scored ' + r.total + ' (toppings ' + r.parts.topping + ', bake ' + r.parts.bake + ', cut ' + r.parts.cut +
        ', wait ' + r.parts.wait + '). tip ' + money(r.tip) + '. "' + r.reaction + '"');
    sel = 0; pickFor('serve'); sync(); draw();
}

// ------------------------------------------------------------ dialogs and the day
function dialog(title, html, actions) {
    $('dlg-title').textContent = title;
    $('dlg-body').innerHTML = html;
    $('dlg-actions').replaceChildren(...actions.map(([label, fn]) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
        b.addEventListener('click', fn); return b;
    }));
    $('overlay').hidden = false;
    const first = $('dlg-actions').querySelector('button');
    if (first) first.focus({ preventScroll: true });
}
function closeDialog() { $('overlay').hidden = true; }
const dialogOpen = () => !$('overlay').hidden;
const HOWTO = '<p><b>you run the line at pizza shift 98.</b> ten days, one counter, increasingly cursed customers.</p><ul>' +
    '<li><b>order</b>: take the order of whoever is at the counter. the ticket shows what goes where.</li>' +
    '<li><b>topping</b>: pick a topping, tap the pizza. every topping wants <b>2 pieces in each quarter</b> it covers. dashed lines mark the quarters; keep pieces off the crust.</li>' +
    '<li><b>bake</b>: ovens run in real time, even while you are at other stations. pull the pizza out in the green zone.</li>' +
    '<li><b>cut</b>: drag straight lines through the centre. 8 slices = 4 even cuts.</li>' +
    '<li><b>serve</b>: each pizza is scored on toppings, bake, cut and wait. better pizza, bigger tips.</li></ul>' +
    '<p>average 55 or more to pass a day. spend tips in the shop between days. the tabs show what needs you; a red bake tab means a pizza is ready.</p>' +
    '<p>keys: <kbd>o</kbd> <kbd>t</kbd> <kbd>b</kbd> <kbd>c</kbd> <kbd>s</kbd> stations · <kbd>1</kbd>-<kbd>6</kbd> toppings / ovens · arrows + <kbd>enter</kbd> on the pizza · <kbd>backspace</kbd> undo · <kbd>p</kbd> pause</p>';
function showTitle() {
    phase = 'title'; paused = false; ds = null; stop();
    const started = game.day > 1 || game.money > 0 || game.won;
    const best = game.best.day ? '<p>best: day ' + game.best.day + ' · ' + money(game.best.money) + ' · ' + game.best.stars + ' ★</p>' : '';
    const acts = game.won ? [['new game', () => newGame()]]
        : started ? [['continue: day ' + game.day, showIntro], ['new game', confirmNew]] : [['start day 1', showIntro]];
    dialog(game.won ? 'pizza shift 98 · employee of the month' : 'pizza shift 98', (game.won ? '<p><b>you finished all ten days.</b> ' +
        S.totalStars(game) + ' of 30 stars, ' + money(game.money) + ' in tips.</p>' : '') + HOWTO + best, acts);
    sync(); draw();
}
function confirmNew() {
    dialog('start over?', '<p>day ' + game.day + ' and ' + money(game.money) + ' of upgrades money will be gone. your best stays.</p>',
        [['yes, new game', () => newGame()], ['cancel', showTitle]]);
}
function newGame(seed) {
    const best = game.best;
    game = S.newGame(seed === undefined ? freshSeed() : seed);
    game.best = best; saveGame(); showIntro();
}
const DAY_TIPS = ['', 'easy start: whole-pizza toppings, regular bake, 8 slices.', 'halves show up, and some want a light bake or 6 slices.',
    'quarters, well-done bakes, 4-slice orders and the first VIPs (crowned, impatient, double tips).', 'more toppings per pizza from here on.',
    'two to four toppings each. use every oven.', 'the lunch rush gets closer together.', 'VIPs are getting common.', 'almost there. keep the line moving.',
    'it is busy. like, really busy.', 'the last day. the whole town is hungry.'];
function showIntro() {
    phase = 'intro'; ds = null; stop();
    const n = Math.min(12, 2 + game.day);
    dialog('day ' + game.day + ' of ' + S.DAYS, '<p class="big">day ' + game.day + '</p><p>' + n + ' customers today. ' + DAY_TIPS[game.day] + '</p>' +
        '<p>ovens: ' + game.upgrades.ovens + ' · tips in the jar: ' + money(game.money) + '</p>', [['open up', startDay], ['how to play', showHelpFromIntro]]);
    sync(); draw();
}
function showHelpFromIntro() { dialog('how to play', HOWTO, [['back', showIntro]]); }
function startDay() {
    ds = S.createDay(game); lastResult = null; sel = 0; drag = null; knife = 0; overAt = 0;
    phase = 'playing'; paused = false; closeDialog();
    buildOvenButtons(); layoutOvens(); setStation('order');
    say('day ' + ds.day + ': the doors are open. the first customer is on the way.');
    canvas.focus({ preventScroll: true });
    run();
}
// achievements live on the desktop around this frame; alone, there are none
function achieve(id) { try { const u = window.parent !== window && window.parent.unlockAchievement; if (typeof u === 'function') u(id); } catch (_) { /* no desktop */ } }
function endDay() {
    phase = 'dayend'; stop();
    const res = S.dayResult(ds), wasDay = game.day;
    S.finishDay(game, res); saveGame();
    if (game.won) achieve('pizzashift_win');
    const stars = '★'.repeat(res.stars) + '☆'.repeat(3 - res.stars);
    const rows = res.results.slice().sort((a, b) => a.id - b.id).map(r => '<tr><td>#' + r.id + ' ' + r.name + (r.vip ? ' ★' : '') + '</td>' +
        (r.walkout ? '<td colspan="4">walked out</td>' : '<td>' + r.parts.topping + '</td><td>' + r.parts.bake + '</td><td>' + r.parts.cut + '</td><td>' + r.parts.wait + '</td>') +
        '<td><b>' + r.total + '</b></td><td>' + money(r.tip) + '</td></tr>').join('');
    const verdict = res.passed ? (game.won ? '<p><b>that was day 10. you are employee of the month.</b></p>' : '<p>day ' + wasDay + ' done. the tips go in the jar.</p>')
        : '<p><b>the boss is not happy.</b> you need an average of ' + S.PASS_SCORE + '. this day\'s tips are gone; try it again.</p>';
    dialog(res.passed ? 'day ' + wasDay + ' closed' : 'day ' + wasDay + ' failed',
        '<p class="big">' + stars + ' ' + res.avg + '</p>' + verdict +
        '<table><tr><th>customer</th><th>top</th><th>bake</th><th>cut</th><th>wait</th><th>score</th><th>tip</th></tr>' + rows + '</table>' +
        '<p>served ' + res.served + ' of ' + res.customers + ' · earned ' + money(res.passed ? res.earned : 0) + ' · jar ' + money(game.money) + '</p>',
        game.won ? [['take a bow', showTitle]] : [['to the shop', showShop]]);
    if (res.passed) sfx.cash(); else sfx.bad();
    sync(); draw();
}
function showShop() {
    phase = 'shop'; ds = null; stop();
    const items = S.UPGRADES.map(u => {
        const lvl = S.upgradeLevel(game, u.id), price = S.priceOf(game, u.id);
        return '<div class="shop-item"><div><b>' + u.name + '</b> <small>' + u.desc + ' · level ' + lvl + '/' + u.prices.length + '</small></div>' +
            '<button type="button" data-buy="' + u.id + '"' + (price === null || price > game.money ? ' disabled' : '') + '>' +
            (price === null ? 'maxed' : 'buy ' + money(price)) + '</button></div>';
    }).join('');
    dialog('shop · jar ' + money(game.money), '<p>spend your tips before day ' + game.day + '.</p>' + items, [['start day ' + game.day, showIntro]]);
    $('dlg-body').querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
        if (S.buy(game, b.dataset.buy)) { saveGame(); sfx.cash(); say('bought: ' + S.UPGRADES.find(u => u.id === b.dataset.buy).name + '.'); showShop(); }
    }));
    sync(); draw();
}
function pause(on) {
    if (phase !== 'playing' || on === paused) return;
    paused = on; drag = null;
    if (paused) { stop(); dialog('paused', '<p>the ovens are off and the customers are frozen in time. take a breath.</p>', [['resume', () => pause(false)], ['how to play', () => dialog('how to play', HOWTO, [['back', () => pause(false)]])]]); say('paused.'); }
    else { closeDialog(); say('back on the line.'); canvas.focus({ preventScroll: true }); run(); }
    sync(); draw();
}

// ------------------------------------------------------------ loop
function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }
function run() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
function handleEvents() {
    for (const e of ds.events.splice(0)) {
        const c = e.id && S.customer(ds, e.id);
        if (e.kind === 'arrive') { say(c.name + (c.vip ? ' (vip!)' : '') + ' walks in. take the order at the counter.'); sfx.bell(); }
        else if (e.kind === 'ready') { say('oven ' + (e.oven + 1) + ': #' + e.id + ' is ready. pull it out now!'); sfx.ready(); }
        else if (e.kind === 'burnt') { say('oven ' + (e.oven + 1) + ': #' + e.id + ' is burning!'); sfx.bad(); }
        else if (e.kind === 'walkout') { say(c.name + ' got tired of waiting and walked out.'); sfx.bad(); if (sel === e.id) sel = 0; }
        else if (e.kind === 'over') overAt = performance.now();
    }
}
function frame(now) {
    raf = 0;
    if (phase !== 'playing' || paused) return;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0; last = now;
    if (!ds.over && dt > 0) S.step(ds, dt);
    handleEvents();
    if (ds.over && overAt && now - overAt > 1200) { sync(); draw(); endDay(); return; }
    sync(); draw();
    raf = requestAnimationFrame(frame);
}

// ------------------------------------------------------------ input
tabs.forEach(t => t.addEventListener('click', () => { if (phase === 'playing' && !paused) setStation(t.dataset.station); }));
$('btn-take').addEventListener('click', takeOrder);
$('btn-undo').addEventListener('click', undoPiece);
$('btn-clear').addEventListener('click', () => { const tk = current(['ordered']); if (playing() && tk && S.clearPieces(ds, tk.id)) { sync(); draw(); } });
$('btn-oven').addEventListener('click', toOven);
$('btn-uncut').addEventListener('click', undoCut);
$('btn-to-serve').addEventListener('click', () => setStation('serve'));
$('btn-serve').addEventListener('click', serve);
$('btn-pause').addEventListener('click', () => pause(!paused));
$('btn-help').addEventListener('click', () => {
    if (phase === 'playing') { pause(true); dialog('how to play', HOWTO, [['back to the line', () => pause(false)]]); }
    else if (!dialogOpen() || phase === 'title') dialog('how to play', HOWTO, [['back', showTitle]]);
});
canvas.addEventListener('pointerdown', e => {
    if (!playing()) return;
    canvas.focus({ preventScroll: true });
    const p = toUnit(e);
    if (station === 'order') {
        const f = G.front;
        if (Math.abs(p.px - f.x) < f.s * 0.7 && Math.abs(p.py - f.y) < f.s * 0.8) takeOrder();
    } else if (station === 'topping') {
        if (Math.hypot(p.x, p.y) < 1.2) place(p.x, p.y);
    } else if (station === 'bake') {
        const i = G.ovens.findIndex(r => p.px >= r.x && p.px <= r.x + r.w && p.py >= r.y && p.py <= r.y + r.h);
        if (i >= 0 && i < ds.ovens.length) takeOut(i);
    } else if (station === 'cut') {
        if (current(['baked']) && Math.hypot(p.x, p.y) < 1.5) {
            drag = { x1: p.x, y1: p.y, x2: p.x, y2: p.y, id: e.pointerId };
            try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
            draw();
        }
    } else if (station === 'serve') serve();
    e.preventDefault();
});
canvas.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const p = toUnit(e); drag.x2 = p.x; drag.y2 = p.y;
    if (!raf) draw();
});
function endDrag(e, commit) {
    if (!drag || drag.id !== e.pointerId) return;
    const p = toUnit(e), d = drag; drag = null;
    if (commit) {
        d.x2 = p.x; d.y2 = p.y;
        if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.15) cut(d.x1, d.y1, d.x2, d.y2);
        else { say('drag a line across the pizza to cut.'); draw(); }
    } else draw();
}
canvas.addEventListener('pointerup', e => endDrag(e, true));
canvas.addEventListener('pointercancel', e => endDrag(e, false));
canvas.addEventListener('focus', () => draw());
canvas.addEventListener('blur', () => draw());
document.addEventListener('keydown', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (dialogOpen()) {
        if ((k === 'Escape' || k === 'p') && phase === 'playing' && paused) { e.preventDefault(); pause(false); }
        return;
    }
    if (phase !== 'playing' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'p' || k === 'Escape') { e.preventDefault(); pause(true); return; }
    if (paused) return;
    const onButton = e.target instanceof HTMLButtonElement;
    if (onButton && (k === 'Enter' || k === ' ')) return; // the button handles it
    const map = { o: 'order', t: 'topping', b: 'bake', c: 'cut', s: 'serve' };
    if (map[k]) { e.preventDefault(); setStation(map[k]); return; }
    const go = k === 'Enter' || k === ' ';
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    if (station === 'order' && go) { e.preventDefault(); takeOrder(); }
    else if (station === 'topping') {
        if (/^[1-6]$/.test(k)) { e.preventDefault(); pickTopping(S.TOPPINGS[+k - 1].id); }
        else if (arrow) {
            e.preventDefault();
            const nx = cursor.x + arrow[0] * 0.1, ny = cursor.y + arrow[1] * 0.1;
            if (Math.hypot(nx, ny) <= 0.95) { cursor.x = Math.round(nx * 10) / 10; cursor.y = Math.round(ny * 10) / 10; }
            canvas.focus({ preventScroll: true }); draw();
        } else if (go) { e.preventDefault(); place(cursor.x, cursor.y); }
        else if (k === 'Backspace') { e.preventDefault(); undoPiece(); }
    } else if (station === 'bake' && /^[1-4]$/.test(k)) { e.preventDefault(); takeOut(+k - 1); }
    else if (station === 'cut') {
        if (arrow) { e.preventDefault(); knife = (knife + (arrow[0] || arrow[1]) * KNIFE_STEP + Math.PI) % Math.PI; draw(); }
        else if (go) { e.preventDefault(); knifeCut(); }
        else if (k === 'Backspace') { e.preventDefault(); undoCut(); }
    } else if (station === 'serve' && go) { e.preventDefault(); serve(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
// the desktop window asks for a pause when it is minimised
window.addEventListener('message', e => {
    if (e.origin === location.origin && e.data && e.data.type === 'game-pause') pause(true);
});
window.addEventListener('pagehide', stop);
let lastWidth = 0;
new ResizeObserver(() => { const w = canvas.parentElement.clientWidth; if (w !== lastWidth) { lastWidth = w; resize(); } }).observe(canvas.parentElement);
window.addEventListener('resize', resize);
faces.forEach(img => img.addEventListener('load', () => { if (!raf) draw(); }));
reduced.addEventListener('change', draw);

// ------------------------------------------------------------ test hook
window.PIZZASHIFT_ENGINE = {
    sim: S,
    state: () => ({ game, day: ds, phase, paused, station, sel, topping, knife }),
    seed: () => game.seed,
    newGame(seed) { newGame(seed >>> 0); },
    // run the shift clock forward without waiting for real time
    fastForward(seconds) {
        if (!ds) return;
        for (let n = Math.round(seconds / 0.05); n > 0 && !ds.over; n--) S.step(ds, 0.05);
        handleEvents(); sync(); draw();
    },
    // where a pizza point (unit coordinates) is on the canvas, in css pixels from its top-left
    pizzaPoint(x, y) { const b = canvas.getBoundingClientRect(); return { x: (G.cx + x * G.r) * b.width / W, y: (G.cy + y * G.r) * b.height / H }; },
    ovenPoint(i) { const r = G.ovens[i], b = canvas.getBoundingClientRect(); return { x: (r.x + r.w / 2) * b.width / W, y: (r.y + r.h / 2) * b.height / H }; },
    frontPoint() { const b = canvas.getBoundingClientRect(); return { x: G.front.x * b.width / W, y: G.front.y * b.height / H }; }
};

resize();
showTitle();
say('welcome to pizza shift 98. read the ticket, make the pizza, keep the tips.');
})();
