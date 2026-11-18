// deep drill 98 - the page: canvas drawing, keys/touch, shops, saves, sound.
// The rules live in deep-drill-sim.js (window.DEEP_DRILL) and never touch the DOM.
(function () {
'use strict';
const DD = window.DEEP_DRILL;
const { W, H, SURF, T, CHUNK, CHUNK_COLS } = DD;
const $ = id => document.getElementById(id);
const canvas = $('view'), ctx = canvas.getContext('2d'), stage = $('stage');
const KEY = { save: 'mrhakan98-deepdrill-save', best: 'mrhakan98-deepdrill-best' };

// ---------- storage (may be blocked) ----------
const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* fine */ } }
};
let best = { depth: 0, earned: 0, wins: 0, fastest: 0 };
try { const b = JSON.parse(store.get(KEY.best) || 'null'); if (b && typeof b === 'object') for (const k in best) if (Number.isFinite(b[k]) && b[k] >= 0) best[k] = b[k]; } catch (_) { /* corrupt record */ }
function saveBest() {
    if (!state) return;
    best.depth = Math.max(best.depth, state.maxDepth);
    best.earned = Math.max(best.earned, state.earned);
    store.set(KEY.best, JSON.stringify(best));
    $('best').textContent = 'best: ' + best.depth + ' m' + (best.wins ? ' · core x' + best.wins : '');
}
function saveRun() { if (state && !state.over) { store.set(KEY.save, DD.serialize(state)); saveBest(); } }
function loadRun() { const t = store.get(KEY.save); return t ? DD.deserialize(t) : null; }

// ---------- sound: short beeps, silent when the site sound is off ----------
let audio = null;
function beep(freq, dur, type, vol, slide) {
    try {
        if (localStorage.getItem('sound-enabled') === 'false') return;
    } catch (_) { return; }
    try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === 'suspended') audio.resume();
        const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
        o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
        g.gain.setValueAtTime(vol || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (_) { /* no audio */ }
}

// ---------- state ----------
let state = null, phase = 'title', shop = null, lastBuilding = null;
const held = { left: false, right: false, up: false, down: false };
const qs = new URLSearchParams(location.search);
const randomSeed = () => (qs.has('seed') && /^\d+$/.test(qs.get('seed')) ? Number(qs.get('seed')) >>> 0 : (Date.now() ^ (Math.random() * 1e9)) >>> 0);

// ---------- view ----------
let dpr = 1, TS = 32, vw = 0, vh = 0, camX = 0, camY = 0, shake = 0;
const chunks = new Map();
let buildingLayer = null, skyGrad = null, lightMask = null;
function resize() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssTile = Math.max(24, Math.min(44, Math.round(r.width / 14)));
    TS = Math.round(cssTile * dpr);
    vw = Math.max(1, Math.round(r.width * dpr)); vh = Math.max(1, Math.round(r.height * dpr));
    canvas.width = vw; canvas.height = vh;
    chunks.clear(); buildingLayer = null; lightMask = null;
    skyGrad = ctx.createLinearGradient(0, 0, 0, SURF * TS);
    skyGrad.addColorStop(0, '#d9774f'); skyGrad.addColorStop(0.65, '#f0b27d'); skyGrad.addColorStop(1, '#f7d6a8');
    if (state) { snapCamera(); draw(); }
}

// small deterministic hash for tile decoration
function hash(x, y, k) {
    let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 3266489917, 374761393) ^ Math.imul(k || 1, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const DIRT = ['#c9733d', '#b55a33', '#99472d', '#7d3d33', '#63323a', '#4d2a3d', '#3b2338'];
const DIRT_DARK = ['#a85a2c', '#944526', '#7a3722', '#622f28', '#4d262e', '#3b2030', '#2b1a2a'];
const TUNNEL = ['#3a1f14', '#341b14', '#2e1815', '#291617', '#241419', '#1f121a', '#1a1018'];
const band = y => Math.max(0, Math.min(DIRT.length - 1, Math.floor((y - SURF) / 45)));

function drawTile(c, t, x, y, px, py, s) {
    const b = band(y);
    if (t === T.EMPTY) {
        if (y < SURF) return;
        c.fillStyle = TUNNEL[b]; c.fillRect(px, py, s, s);
        return;
    }
    if (t === T.BEDROCK) {
        c.fillStyle = '#26232b'; c.fillRect(px, py, s, s);
        c.strokeStyle = '#38343f'; c.lineWidth = Math.max(1, s / 16);
        c.beginPath(); c.moveTo(px, py + s * 0.7); c.lineTo(px + s * 0.7, py); c.moveTo(px + s * 0.3, py + s); c.lineTo(px + s, py + s * 0.3); c.stroke();
        return;
    }
    if (t === T.PAD) {
        c.fillStyle = '#8d8d8d'; c.fillRect(px, py, s, s);
        c.fillStyle = '#b5b5b5'; c.fillRect(px, py, s, s * 0.18);
        c.fillStyle = '#e0b000';
        for (let i = 0; i < 3; i++) c.fillRect(px + i * s / 3, py + s * 0.18, s / 6, s * 0.1);
        return;
    }
    if (t === T.LAVA) {
        c.fillStyle = '#c62a0c'; c.fillRect(px, py, s, s);
        c.fillStyle = '#ff7a12';
        for (let i = 0; i < 3; i++) { const r = hash(x, y, i); c.beginPath(); c.arc(px + s * (0.2 + 0.6 * r), py + s * (0.2 + 0.6 * hash(y, x, i)), s * (0.12 + r * 0.1), 0, 7); c.fill(); }
        c.fillStyle = '#ffd34a'; c.fillRect(px + s * 0.45, py + s * 0.3, s * 0.12, s * 0.12);
        return;
    }
    // dirt underlay for everything else
    c.fillStyle = DIRT[b]; c.fillRect(px, py, s, s);
    c.fillStyle = DIRT_DARK[b];
    for (let i = 0; i < 4; i++) c.fillRect(px + Math.floor(hash(x, y, i) * s * 0.85), py + Math.floor(hash(x, y, i + 9) * s * 0.85), Math.ceil(s / 10), Math.ceil(s / 10));
    if (y === SURF) { c.fillStyle = '#d98a52'; c.fillRect(px, py, s, Math.ceil(s / 8)); }
    if (t === T.ROCK) {
        c.fillStyle = '#5d5a60'; c.beginPath(); c.ellipse(px + s / 2, py + s * 0.55, s * 0.46, s * 0.42, 0, 0, 7); c.fill();
        c.fillStyle = '#8a868c'; c.beginPath(); c.ellipse(px + s * 0.42, py + s * 0.44, s * 0.28, s * 0.2, -0.4, 0, 7); c.fill();
        c.fillStyle = '#3c3a40'; c.fillRect(px + s * 0.55, py + s * 0.62, s * 0.18, s * 0.08);
    } else if (t === T.GAS) {
        c.fillStyle = '#8fae5a';
        for (let i = 0; i < 3; i++) c.fillRect(px + Math.floor(hash(x, y, i + 20) * s * 0.8), py + Math.floor(hash(x, y, i + 30) * s * 0.8), Math.ceil(s / 12), Math.ceil(s / 12));
    } else if (t === T.FOSSIL) {
        c.strokeStyle = '#efe6cf'; c.lineWidth = Math.max(2, s / 9); c.lineCap = 'round';
        c.beginPath(); c.moveTo(px + s * 0.22, py + s * 0.7); c.lineTo(px + s * 0.78, py + s * 0.32); c.stroke();
        c.fillStyle = '#efe6cf';
        for (const [a, bb] of [[0.2, 0.72], [0.8, 0.3]]) { c.beginPath(); c.arc(px + s * a, py + s * bb, s * 0.1, 0, 7); c.fill(); }
        c.beginPath(); c.arc(px + s * 0.5, py + s * 0.5, s * 0.16, 0, 7); c.fill();
        c.fillStyle = '#5a3a2a'; c.fillRect(px + s * 0.44, py + s * 0.45, s * 0.04, s * 0.04); c.fillRect(px + s * 0.54, py + s * 0.45, s * 0.04, s * 0.04);
    } else if (t === T.TREASURE) {
        // a lost floppy disk
        c.fillStyle = '#1b2a7a'; c.fillRect(px + s * 0.2, py + s * 0.2, s * 0.6, s * 0.6);
        c.fillStyle = '#c0c0c0'; c.fillRect(px + s * 0.34, py + s * 0.2, s * 0.32, s * 0.2);
        c.fillStyle = '#fff'; c.fillRect(px + s * 0.3, py + s * 0.52, s * 0.4, s * 0.24);
        c.fillStyle = '#ffd23f'; c.fillRect(px + s * 0.18, py + s * 0.16, s * 0.1, s * 0.1);
    } else if (t === T.CORE) {
        c.fillStyle = '#2a0d33'; c.fillRect(px, py, s, s);
        c.fillStyle = '#c45cff'; c.beginPath(); c.moveTo(px + s / 2, py + s * 0.08); c.lineTo(px + s * 0.9, py + s / 2); c.lineTo(px + s / 2, py + s * 0.92); c.lineTo(px + s * 0.1, py + s / 2); c.closePath(); c.fill();
        c.fillStyle = '#f2c9ff'; c.fillRect(px + s * 0.4, py + s * 0.3, s * 0.12, s * 0.2);
    } else if (DD.isOre(t)) {
        const ore = DD.ORES[t - DD.ORE0], n = 3 + (t - DD.ORE0 > 4 ? 1 : 0);
        for (let i = 0; i < n; i++) {
            const gx = px + s * (0.18 + hash(x, y, i + 40) * 0.64), gy = py + s * (0.18 + hash(x, y, i + 50) * 0.64), r = s * (0.1 + hash(x, y, i + 60) * 0.07);
            c.fillStyle = '#00000055'; c.beginPath(); c.moveTo(gx, gy - r + 2); c.lineTo(gx + r + 1, gy + 2); c.lineTo(gx, gy + r + 2); c.lineTo(gx - r + 1, gy + 2); c.fill();
            c.fillStyle = ore.color; c.beginPath(); c.moveTo(gx, gy - r); c.lineTo(gx + r, gy); c.lineTo(gx, gy + r); c.lineTo(gx - r, gy); c.fill();
            c.fillStyle = '#ffffffaa'; c.fillRect(gx - r * 0.35, gy - r * 0.45, r * 0.35, r * 0.35);
        }
    }
    // rim where the tile meets a tunnel, so passages read clearly
    const wall = Math.max(1, Math.round(s / 14));
    c.fillStyle = '#0000004d';
    if (y > SURF && DD.tileAt(state.world, x, y - 1) === T.EMPTY) c.fillRect(px, py, s, wall);
    if (DD.tileAt(state.world, x, y + 1) === T.EMPTY) c.fillRect(px, py + s - wall, s, wall);
    if (y >= SURF && DD.tileAt(state.world, x - 1, y) === T.EMPTY) c.fillRect(px, py, wall, s);
    if (y >= SURF && DD.tileAt(state.world, x + 1, y) === T.EMPTY) c.fillRect(px + s - wall, py, wall, s);
}

function chunkCanvas(id) {
    const ver = state.world.ver[id];
    let ch = chunks.get(id);
    if (ch && ch.ver === ver) { chunks.delete(id); chunks.set(id, ch); return ch.cv; } // keep recently used last
    if (!ch) {
        if (chunks.size > 48) { const old = chunks.keys().next().value; const o = chunks.get(old); chunks.delete(old); ch = o; }
        else ch = { cv: document.createElement('canvas') };
        ch.cv.width = CHUNK * TS; ch.cv.height = CHUNK * TS;
    }
    ch.ver = ver;
    const c = ch.cv.getContext('2d'), cx0 = (id % CHUNK_COLS) * CHUNK, cy0 = Math.floor(id / CHUNK_COLS) * CHUNK;
    c.clearRect(0, 0, ch.cv.width, ch.cv.height);
    for (let y = cy0; y < Math.min(H, cy0 + CHUNK); y++) for (let x = cx0; x < cx0 + CHUNK; x++)
        drawTile(c, state.world.tiles[y * W + x], x, y, (x - cx0) * TS, (y - cy0) * TS, TS);
    chunks.set(id, ch);
    return ch.cv;
}

const BCOL = { fuel: '#d23b2a', sell: '#2f9e44', upgrade: '#2457c5', repair: '#e07b00', items: '#8a3fc4' };
const BSIGN = { fuel: 'FUEL', sell: 'ORE BUYER', upgrade: 'UPGRADES', repair: 'REPAIR', items: 'ITEMS' };
function makeBuildings() {
    const cv = document.createElement('canvas'); cv.width = W * TS; cv.height = SURF * TS;
    const c = cv.getContext('2d'), s = TS;
    // far hills
    c.fillStyle = '#c56a45';
    c.beginPath(); c.moveTo(0, SURF * s);
    for (let x = 0; x <= W; x++) c.lineTo(x * s, SURF * s - s * (1.1 + Math.sin(x * 0.7) * 0.5 + Math.sin(x * 0.23 + 1) * 0.7));
    c.lineTo(W * s, SURF * s); c.fill();
    c.fillStyle = '#fff2d6'; c.beginPath(); c.arc(W * s * 0.8, s * 1.3, s * 0.6, 0, 7); c.fill();
    for (const b of DD.BUILDINGS) {
        const x = b.x0 * s, w = (b.x1 - b.x0 + 1) * s, h = s * 2.6, y = SURF * s - h;
        c.fillStyle = '#c0c0c0'; c.fillRect(x + s * 0.1, y, w - s * 0.2, h);
        c.fillStyle = '#ffffff'; c.fillRect(x + s * 0.1, y, w - s * 0.2, 2 * dpr); c.fillRect(x + s * 0.1, y, 2 * dpr, h);
        c.fillStyle = '#404040'; c.fillRect(x + w - s * 0.1 - 2 * dpr, y, 2 * dpr, h);
        c.fillStyle = BCOL[b.id]; c.fillRect(x + s * 0.1, y, w - s * 0.2, s * 0.55);
        c.fillStyle = '#fff'; c.font = 'bold ' + Math.round(s * 0.32) + 'px Tahoma, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(BSIGN[b.id], x + w / 2, y + s * 0.29, w - s * 0.3);
        // door
        c.fillStyle = '#202020'; c.fillRect(x + w / 2 - s * 0.45, SURF * s - s * 1.2, s * 0.9, s * 1.2);
        c.fillStyle = BCOL[b.id]; c.fillRect(x + w / 2 - s * 0.45, SURF * s - s * 1.2, s * 0.9, s * 0.12);
        // windows
        c.fillStyle = '#7fd7ff';
        c.fillRect(x + s * 0.35, y + s * 0.8, s * 0.4, s * 0.35); c.fillRect(x + w - s * 0.75, y + s * 0.8, s * 0.4, s * 0.35);
    }
    return cv;
}
function makeLight() {
    const cv = document.createElement('canvas'); cv.width = vw * 2; cv.height = vh * 2;
    const c = cv.getContext('2d'), g = c.createRadialGradient(vw, vh, TS * 1.6, vw, vh, TS * 6.5);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
    return cv;
}

// particles and floating text from fixed pools
const parts = Array.from({ length: 96 }, () => ({ life: 0, x: 0, y: 0, vx: 0, vy: 0, c: '#fff', s: 1 }));
const floats = Array.from({ length: 8 }, () => ({ life: 0, x: 0, y: 0, text: '', c: '#fff' }));
let partI = 0, floatI = 0, flareAnim = 0, flashAnim = 0;
function puff(x, y, n, color, speed) {
    for (let i = 0; i < n; i++) {
        const p = parts[partI = (partI + 1) % parts.length], a = Math.random() * 6.283, v = (0.5 + Math.random()) * (speed || 2);
        p.life = 0.4 + Math.random() * 0.5; p.x = x; p.y = y; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v - 1; p.c = color; p.s = 0.06 + Math.random() * 0.08;
    }
}
function floatText(text, x, y, c) { const f = floats[floatI = (floatI + 1) % floats.length]; f.life = 1.4; f.x = x; f.y = y; f.text = text; f.c = c; }

function snapCamera() {
    const p = state.pod;
    camX = targetCamX(p); camY = targetCamY(p);
}
const targetCamX = p => (W * TS <= vw ? (W * TS - vw) / 2 : Math.max(0, Math.min(W * TS - vw, p.x * TS - vw / 2)));
const targetCamY = p => Math.max(0, Math.min(H * TS - vh, p.y * TS - vh * 0.45));

function drawPod(p, sx, sy, now) {
    const s = TS, w = s * 0.8, h = s * 0.8, x = sx - w / 2, y = sy - h / 2;
    const d = p.drill, side = d && d.dx ? d.dx : 0;
    ctx.save();
    if (p.thrust) {
        ctx.fillStyle = (now / 60 | 0) % 2 ? '#ffd34a' : '#ff7a12';
        ctx.beginPath(); ctx.moveTo(x + w * 0.2, y + h * 0.78); ctx.lineTo(x + w * 0.8, y + h * 0.78); ctx.lineTo(x + w / 2, y + h * (1.25 + Math.random() * 0.25)); ctx.fill();
    }
    // drill bit
    ctx.fillStyle = '#9aa0a6';
    const spin = (now / 40 | 0) % 2;
    if (side) {
        const bx = side > 0 ? x + w : x;
        ctx.beginPath(); ctx.moveTo(bx, y + h * 0.3); ctx.lineTo(bx + side * w * 0.42, y + h * 0.55); ctx.lineTo(bx, y + h * 0.8); ctx.fill();
        if (spin) { ctx.fillStyle = '#5d6166'; ctx.fillRect(bx + side * w * 0.08 - (side < 0 ? w * 0.06 : 0), y + h * 0.42, w * 0.06, h * 0.26); }
    } else {
        ctx.beginPath(); ctx.moveTo(x + w * 0.22, y + h * 0.88); ctx.lineTo(x + w / 2, y + h * (d ? 1.35 : 1.22)); ctx.lineTo(x + w * 0.78, y + h * 0.88); ctx.fill();
        if (d && spin) { ctx.fillStyle = '#5d6166'; ctx.fillRect(x + w * 0.36, y + h * 0.98, w * 0.28, h * 0.06); }
    }
    // body
    ctx.fillStyle = '#2b2b2b'; ctx.fillRect(x, y + h * 0.66, w, h * 0.24);
    ctx.fillStyle = '#ffc83a'; ctx.fillRect(x + w * 0.04, y + h * 0.12, w * 0.92, h * 0.58);
    ctx.fillStyle = '#fff1b0'; ctx.fillRect(x + w * 0.04, y + h * 0.12, w * 0.92, h * 0.07);
    ctx.fillStyle = '#b07d10'; ctx.fillRect(x + w * 0.04, y + h * 0.62, w * 0.92, h * 0.08);
    // cab window faces the way we drive
    const wx = p.face > 0 ? x + w * 0.52 : x + w * 0.12;
    ctx.fillStyle = '#103050'; ctx.fillRect(wx, y + h * 0.2, w * 0.36, h * 0.26);
    ctx.fillStyle = '#7fd7ff'; ctx.fillRect(wx + w * 0.03, y + h * 0.23, w * 0.3, h * 0.2);
    ctx.fillStyle = '#e8fbff'; ctx.fillRect(wx + w * 0.05, y + h * 0.24, w * 0.08, h * 0.06);
    // antenna + light
    ctx.fillStyle = '#2b2b2b'; ctx.fillRect(x + w * 0.2, y - h * 0.1, s * 0.04, h * 0.24);
    ctx.fillStyle = (now / 400 | 0) % 2 ? '#ff3b3b' : '#7a1010'; ctx.fillRect(x + w * 0.17, y - h * 0.16, s * 0.1, s * 0.08);
    // track wheels
    ctx.fillStyle = '#6b6b6b';
    for (let i = 0; i < 4; i++) ctx.fillRect(x + w * (0.08 + i * 0.23), y + h * 0.72, w * 0.14, h * 0.12);
    ctx.restore();
}

let lastFrame = 0;
function draw(now) {
    now = now || performance.now();
    const p = state.pod;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sx = shake > 0 ? (Math.random() - 0.5) * shake * TS * 0.3 : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake * TS * 0.3 : 0;
    const cx = Math.round(camX + sx), cy = Math.round(camY + sy);
    ctx.fillStyle = '#120a10'; ctx.fillRect(0, 0, vw, vh);
    if (cy < SURF * TS) {
        ctx.save(); ctx.translate(-cx, -cy); ctx.fillStyle = skyGrad; ctx.fillRect(Math.min(0, cx), 0, Math.max(vw, W * TS), SURF * TS); ctx.restore();
        if (!buildingLayer) buildingLayer = makeBuildings();
        ctx.drawImage(buildingLayer, -cx, -cy);
    }
    const span = CHUNK * TS;
    const r0 = Math.max(0, Math.floor(cy / span)), r1 = Math.min(Math.ceil(H / CHUNK) - 1, Math.floor((cy + vh) / span));
    const c0 = Math.max(0, Math.floor(cx / span)), c1 = Math.min(CHUNK_COLS - 1, Math.floor((cx + vw) / span));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) ctx.drawImage(chunkCanvas(r * CHUNK_COLS + c), c * span - cx, r * span - cy);
    // the core breathes
    if (state.coreLeft > 0 && (DD.CAVE_FLOOR - 3) * TS < cy + vh && DD.CAVE_TOP * TS > cy - vh) {
        const gx = 15.5 * TS - cx, gy = (DD.CAVE_FLOOR - 1.5) * TS - cy, pulse = 0.5 + 0.5 * Math.sin(now / 300);
        ctx.fillStyle = 'rgba(196,92,255,' + (0.12 + pulse * 0.12) + ')';
        ctx.beginPath(); ctx.arc(gx, gy, TS * (2 + pulse * 0.4), 0, 7); ctx.fill();
        if (flareAnim > 0) {
            ctx.strokeStyle = 'rgba(255,120,255,' + flareAnim + ')'; ctx.lineWidth = TS * 0.25;
            ctx.beginPath(); ctx.arc(gx, gy, TS * 6.5 * (1 - flareAnim * 0.6), 0, 7); ctx.stroke();
        }
    }
    drawPod(p, p.x * TS - cx, p.y * TS - cy, now);
    for (const q of parts) if (q.life > 0) { ctx.fillStyle = q.c; ctx.fillRect(q.x * TS - cx, q.y * TS - cy, q.s * TS, q.s * TS); }
    // darkness grows with depth; the pod's lamp cuts through it
    const dark = Math.max(0, Math.min(0.93, (DD.depthM(state) - 20) / 350));
    if (dark > 0) {
        if (!lightMask) lightMask = makeLight();
        ctx.globalAlpha = dark; ctx.drawImage(lightMask, p.x * TS - cx - vw, p.y * TS - cy - vh); ctx.globalAlpha = 1;
    }
    if (state.heat > 0) { ctx.fillStyle = 'rgba(255,60,0,' + Math.min(0.25, state.heat * 0.08) + ')'; ctx.fillRect(0, 0, vw, vh); }
    if (flashAnim > 0) { ctx.fillStyle = 'rgba(255,0,0,' + flashAnim * 0.35 + ')'; ctx.fillRect(0, 0, vw, vh); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold ' + Math.round(TS * 0.34) + 'px Tahoma, sans-serif';
    for (const f of floats) if (f.life > 0) {
        ctx.globalAlpha = Math.min(1, f.life); ctx.fillStyle = '#000'; ctx.fillText(f.text, f.x * TS - cx + 1, f.y * TS - cy + 1);
        ctx.fillStyle = f.c; ctx.fillText(f.text, f.x * TS - cx, f.y * TS - cy); ctx.globalAlpha = 1;
    }
    if (phase === 'paused') {
        ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, vw, vh);
    }
}

// ---------- hud ----------
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function setBar(id, frac) {
    const v = Math.round(Math.max(0, Math.min(1, frac)) * 100);
    if (hudCache[id] === v) return;
    hudCache[id] = v; const el = $(id); el.style.width = v + '%'; el.parentNode.classList.toggle('low', v < 25);
}
function hud() {
    const s = state, tank = DD.stat(s, 'tank'), hull = DD.stat(s, 'hull');
    setText('fuel', s.fuel.toFixed(1)); setBar('fuel-bar', s.fuel / tank);
    setText('hull', Math.ceil(s.hull) + ''); setBar('hull-bar', s.hull / hull);
    setText('depth', DD.depthM(s) + ' m'); setText('cash', '$' + Math.floor(s.cash));
    setText('cargo', s.cargoCount + '/' + DD.stat(s, 'cargo'));
    setText('heat', s.heat > 0 ? 'too hot! radiator' : DD.depthM(s) > 500 ? 'warm' : '');
    if (hudCache.heatHot !== s.heat > 0) { hudCache.heatHot = s.heat > 0; $('heat').className = s.heat > 0 ? 'hot' : ''; }
    const itemKey = DD.ITEMS.map(it => s.items[it.id]).join() + phase;
    if (hudCache.items !== itemKey) {
        hudCache.items = itemKey;
        DD.ITEMS.forEach((it, i) => {
            const b = $('item-' + it.id);
            b.textContent = (i + 1) + ' ' + SHORT[it.id] + ' x' + s.items[it.id];
            b.disabled = !s.items[it.id] || phase !== 'play';
        });
    }
    const b = phase === 'play' ? DD.building(s) : null;
    const label = b ? 'enter ' + b.name + ' (E)' : '';
    if (hudCache.prompt !== label) { hudCache.prompt = label; $('prompt').textContent = label; $('prompt').style.display = label ? 'block' : 'none'; }
    setText('pause', phase === 'paused' ? 'resume' : 'pause');
    $('pause').disabled = !(phase === 'play' || phase === 'paused');
}
const SHORT = { dynamite: 'dynamite', c4: 'c4', teleport: 'teleport', repairkit: 'repair kit', reserve: 'fuel can' };

let toastT = 0;
function say(msg, toast) {
    $('status').textContent = msg;
    if (toast) { $('toast-text').textContent = msg; toastT = 2.2; }
}

// ---------- events from the sim ----------
function handleEvents() {
    const evs = state.events;
    for (let i = 0; i < evs.length; i++) {
        const e = evs[i], p = state.pod;
        switch (e.type) {
            case 'ore': floatText('+' + e.name, e.x + 0.5, e.y, '#fff'); puff(e.x + 0.5, e.y + 0.5, 6, DD.ORES[e.tile - DD.ORE0] ? DD.ORES[e.tile - DD.ORE0].color : '#efe6cf', 2); beep(660 + (e.tile - 10) * 60, 0.08, 'square', 0.04); break;
            case 'full': say('cargo bay full - the ' + e.name + ' falls away. go sell!', true); beep(180, 0.15, 'sawtooth', 0.04); break;
            case 'treasure': floatText('+$' + e.value, e.x + 0.5, e.y, '#ffd23f'); say('a lost floppy full of bitcoin keys! +$' + e.value, true); beep(880, 0.1); beep(1320, 0.2, 'square', 0.04); break;
            case 'gas': puff(e.x + 0.5, e.y + 0.5, 18, '#a8d36a', 3); say('gas pocket! that stung.', true); shake = 1; break;
            case 'lava': puff(e.x + 0.5, e.y + 0.5, 18, '#ff7a12', 3); say('lava! the radiator helps with that.', true); shake = 1; break;
            case 'damage': flashAnim = Math.min(1, 0.3 + e.amount / 10); if (e.why !== 'heat' && e.why !== 'lava') beep(110, 0.15, 'sawtooth', 0.06); break;
            case 'thud': shake = Math.min(1.5, (e.speed - 9) / 4); puff(p.x, p.y + 0.4, 8, '#c9733d', 2); say('ouch. thrust to slow a fall.', true); break;
            case 'blocked': say(e.tile === T.ROCK ? 'a boulder. the drill cannot bite it - go round or use dynamite.' : 'bedrock. nothing goes through that.', true); break;
            case 'boom': puff(e.x + 0.5, e.y + 0.5, 40, '#ffb347', 5); shake = 2; beep(70, 0.4, 'sawtooth', 0.09, 30); break;
            case 'teleport': puff(p.x, p.y, 24, '#7fd7ff', 3); snapCamera(); say('zap. back on the surface.', true); beep(300, 0.3, 'sine', 0.06, 1200); break;
            case 'flare': flareAnim = 1; if (e.hit) say('the core flares! back off or hurry up.', true); beep(220, 0.25, 'triangle', 0.05, 90); break;
            case 'core': puff(e.x + 0.5, e.y + 0.5, 20, '#c45cff', 4); shake = 1.2; say(e.left ? 'core shard cracked - ' + e.left + ' to go' : 'the core is cracked!', true); beep(440, 0.15, 'square', 0.05, 880); break;
            case 'milestone': say(e.depth + ' m. it is getting warm down here.', true); break;
            case 'win': case 'lose': finish(); break;
            default: break;
        }
    }
    evs.length = 0;
}

// ---------- dialogs ----------
const modal = $('modal');
let onClose = null;
function openDialog(title, html, close) {
    $('dlg-title').textContent = title;
    $('dlg-body').innerHTML = html;
    modal.classList.add('open');
    onClose = close || null;
    $('dlg-x').style.display = close ? '' : 'none';
    const first = $('dlg-body').querySelector('button:not([disabled])');
    (first || $('dlg-x')).focus({ preventScroll: true });
}
function closeDialog() { modal.classList.remove('open'); const f = onClose; onClose = null; canvas.focus({ preventScroll: true }); if (f) f(); }
$('dlg-x').addEventListener('click', () => { if (onClose) closeDialog(); });
$('dlg-body').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (b && !b.disabled) act(b.dataset.act, b.dataset.arg);
});

const HELP = `<img class="face" src="../../src/emoj/heh.png" alt="">
<p>you run a drilling pod on a rusty red planet. dig for ore, haul it back up, sell it and upgrade the pod. somewhere around <b>1500 m</b> down sits the planet's core. crack it and you win.</p>
<ul>
<li><kbd>&larr;</kbd> <kbd>&rarr;</kbd> / <kbd>A</kbd> <kbd>D</kbd> drive, and drill sideways when you push into dirt</li>
<li><kbd>&darr;</kbd> / <kbd>S</kbd> drill down &middot; <kbd>&uarr;</kbd> / <kbd>W</kbd> thrust up (you cannot drill up)</li>
<li><kbd>E</kbd> / <kbd>Enter</kbd> enter a building &middot; <kbd>1</kbd>-<kbd>5</kbd> items &middot; <kbd>P</kbd> pause</li>
<li>on a phone: the arrow pad under the mine, and tap the item buttons</li>
</ul>
<p>fuel burns underground; running dry down there ends the run. falls, gas, lava and deep heat dent the hull. grey boulders cannot be drilled: go round them or blow them up. the cargo bay only holds so much.</p>
<p>the run saves itself every time you visit a building on the surface.</p>`;

function titleScreen() {
    phase = 'title';
    const saved = loadRun();
    openDialog('deep drill 98', HELP + `<div class="row"><button type="button" data-act="new">new run</button>` +
        (saved ? `<button type="button" data-act="continue">continue (${saved.maxDepth} m best, $${Math.floor(saved.cash)})</button>` : '') + `</div>`);
    hud();
}
function helpScreen() {
    if (phase === 'shop' || phase === 'over' || phase === 'title') return;
    const was = phase; phase = 'paused';
    openDialog('how to play', HELP + `<div class="row"><button type="button" data-act="close">back to the pod</button></div>`, () => { phase = 'play'; resume(); });
}

function shopHtml(id) {
    const s = state, b = DD.BUILDINGS.find(x => x.id === id);
    const cash = '<p>cash: <b>$' + Math.floor(s.cash) + '</b></p>';
    let h = '';
    if (id === 'fuel') {
        const tank = DD.stat(s, 'tank'), room = tank - s.fuel, cost = Math.ceil(room * DD.FUEL_PRICE);
        h = `<p>tank: <b>${s.fuel.toFixed(1)} / ${tank} L</b> &middot; $${DD.FUEL_PRICE} a litre</p>${cash}<div class="row">
<button type="button" data-act="fuel" ${room < 0.05 || s.cash < 1 ? 'disabled' : ''}>fill up ($${cost})</button>
<button type="button" data-act="fuel" data-arg="5" ${room < 0.05 || s.cash < 1 ? 'disabled' : ''}>+5 L ($${Math.ceil(Math.min(5, room) * DD.FUEL_PRICE)})</button></div>`;
    } else if (id === 'sell') {
        const rows = DD.CARGO_KINDS.map((k, i) => s.cargo[i] ? `<tr><td>${k.name}</td><td class="n">${s.cargo[i]}</td><td class="n">$${k.price}</td><td class="n">$${k.price * s.cargo[i]}</td></tr>` : '').join('');
        h = `<img class="face" src="../../src/emoj/hasiktir.png" alt=""><p>the buyer squints at your rocks.</p>
${rows ? `<table><tr><th>ore</th><th class="n">qty</th><th class="n">each</th><th class="n">total</th></tr>${rows}</table>` : '<p>your cargo bay is empty. go dig.</p>'}
${cash}<div class="row"><button type="button" data-act="sell" ${s.cargoCount ? '' : 'disabled'}>sell all ($${DD.cargoValue(s)})</button></div>`;
    } else if (id === 'repair') {
        const hull = DD.stat(s, 'hull'), room = hull - s.hull;
        h = `<p>hull: <b>${Math.ceil(s.hull)} / ${hull}</b> &middot; $${DD.REPAIR_PRICE} per point</p>${cash}<div class="row">
<button type="button" data-act="repair" ${room < 0.05 || s.cash < 1 ? 'disabled' : ''}>repair all ($${Math.ceil(room * DD.REPAIR_PRICE)})</button>
<button type="button" data-act="repair" data-arg="5" ${room < 0.05 || s.cash < 1 ? 'disabled' : ''}>patch 5 ($${Math.ceil(Math.min(5, room) * DD.REPAIR_PRICE)})</button></div>`;
    } else if (id === 'upgrade') {
        h = cash + '<table><tr><th>part</th><th>now</th><th>next</th><th></th></tr>' + DD.UPGRADES.map(u => {
            const l = s.up[u.id], max = l >= 5, cost = DD.COST[l + 1];
            return `<tr><td>${u.name} <small>mk ${l + 1}</small></td><td>${u.vals[l]} ${u.unit}</td><td>${max ? '-' : u.vals[l + 1] + ' ' + u.unit}</td>
<td class="n"><button type="button" data-act="upgrade" data-arg="${u.id}" ${max || s.cash < cost ? 'disabled' : ''}>${max ? 'maxed' : '$' + cost}</button></td></tr>`;
        }).join('') + '</table><p><small>radiator: every mark cancels heat for another ~225 m below 600 m and softens lava.</small></p>';
    } else if (id === 'items') {
        h = cash + '<table>' + DD.ITEMS.map((it, i) => `<tr><td><b>${i + 1}</b> ${it.name}<br><small>${it.desc}</small></td><td class="n">x${s.items[it.id]}</td>
<td class="n"><button type="button" data-act="buy" data-arg="${it.id}" ${s.cash < it.price || s.items[it.id] >= DD.ITEM_MAX ? 'disabled' : ''}>$${it.price}</button></td></tr>`).join('') + '</table>';
    }
    return { title: b.name, html: h + '<div class="row"><button type="button" data-act="close">leave</button></div>' };
}
function openShop(id) {
    if (phase !== 'play') return;
    phase = 'shop'; shop = id; lastBuilding = id;
    for (const k in held) held[k] = false;
    const v = shopHtml(id);
    openDialog(v.title, v.html, () => { shop = null; phase = 'play'; saveRun(); resume(); });
    saveRun();
    beep(520, 0.06, 'square', 0.03);
}
function refreshShop(msg) {
    if (!shop) return;
    const v = shopHtml(shop);
    const focusAct = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.act + ':' + (document.activeElement.dataset.arg || '') : '';
    $('dlg-body').innerHTML = v.html;
    const again = [...$('dlg-body').querySelectorAll('button[data-act]')].find(b => b.dataset.act + ':' + (b.dataset.arg || '') === focusAct && !b.disabled);
    (again || $('dlg-body').querySelector('button[data-act=close]')).focus({ preventScroll: true });
    if (msg) say(msg);
    hud();
}

function act(a, arg) {
    const s = state;
    let r = null;
    if (a === 'new') { closeDialog(); newRun(randomSeed()); return; }
    if (a === 'continue') { const l = loadRun(); closeDialog(); if (l) start(l, 'welcome back. the pod is where you parked it.'); else newRun(randomSeed()); return; }
    if (a === 'reload') { const l = loadRun(); closeDialog(); if (l) { l.wrecks++; start(l, 'towed back to your last surface save.'); } else newRun(randomSeed()); return; }
    if (a === 'close') { closeDialog(); return; }
    if (a === 'fuel') r = DD.buyFuel(s, arg ? Number(arg) : null);
    else if (a === 'sell') r = DD.sell(s);
    else if (a === 'repair') r = DD.repair(s, arg ? Number(arg) : null);
    else if (a === 'upgrade') r = DD.upgrade(s, arg);
    else if (a === 'buy') r = DD.buyItem(s, arg);
    if (r) {
        if (r.ok) { if (a === 'sell') { beep(988, 0.08); beep(1318, 0.16, 'square', 0.04); } else beep(740, 0.06, 'square', 0.03); }
        else beep(160, 0.12, 'sawtooth', 0.03);
        state.events.length = 0;
        refreshShop(r.msg);
        saveRun();
    }
}

function finish() {
    phase = 'over';
    for (const k in held) held[k] = false;
    const s = state, mins = Math.floor(s.time / 60), secs = Math.floor(s.time % 60);
    if (s.won) {
        best.wins++; best.fastest = best.fastest ? Math.min(best.fastest, Math.round(s.time)) : Math.round(s.time);
        store.del(KEY.save);
    }
    saveBest();
    const saved = !s.won && loadRun();
    const stats = `<table><tr><td>deepest</td><td class="n">${s.maxDepth} m</td></tr><tr><td>earned</td><td class="n">$${Math.floor(s.earned)}</td></tr>
<tr><td>trips sold</td><td class="n">${s.trips}</td></tr><tr><td>time</td><td class="n">${mins}:${String(secs).padStart(2, '0')}</td></tr></table>`;
    if (s.won) {
        openDialog('core cracked!', `<img class="face" src="../../src/emoj/LESFUCKINGO.png" alt=""><p><b>you cracked the planet's core.</b> the mining company sends a fruit basket and a $25000 bonus.</p>${stats}
<div class="row"><button type="button" data-act="new">new run</button></div>`);
        say('you win! the core is cracked.');
        beep(523, 0.15); setTimeout(() => beep(659, 0.15), 150); setTimeout(() => beep(784, 0.3), 300);
    } else {
        openDialog('pod lost', `<img class="face" src="../../src/emoj/dusung.png" alt=""><p><b>${s.reason}.</b></p>${stats}
<div class="row">${saved ? '<button type="button" data-act="reload">reload last surface save</button>' : ''}<button type="button" data-act="new">new run</button></div>`);
        say('game over: ' + s.reason + '.');
    }
    hud();
}

// ---------- run control ----------
// the building whose pad the pod is over, grounded or not
function padUnder(s) {
    const bx = Math.floor(s.pod.x), b = s.pod.y < SURF && DD.BUILDINGS.find(q => bx >= q.x0 && bx <= q.x1);
    return b ? b.id : null;
}
function start(s, msg) {
    state = s; phase = 'play'; shop = null;
    // do not pop the shop you were parked at when the run comes back
    lastBuilding = padUnder(s);
    chunks.clear(); for (const k in hudCache) delete hudCache[k];
    for (const k in held) held[k] = false;
    for (const q of parts) q.life = 0;
    for (const f of floats) f.life = 0;
    snapCamera(); saveBest(); hud(); draw();
    say(msg || 'drive to the fuel station if you need it, then dig down with the down arrow.');
    canvas.focus({ preventScroll: true });
    resume();
}
function newRun(seed) {
    const s = DD.newGame(seed);
    start(s, 'new pod, new planet (seed ' + s.seed + '). dig down with the down arrow.');
    saveRun();
}
function pause() {
    if (phase !== 'play') return;
    phase = 'paused'; for (const k in held) held[k] = false;
    openDialog('paused', '<p>the pod waits. fuel does not burn while paused.</p><div class="row"><button type="button" data-act="close">resume</button></div>', () => { phase = 'play'; resume(); });
    say('paused.'); hud(); draw();
}
function resume() {
    if (phase !== 'play') return;
    last = 0; acc = 0;
    if (!raf) raf = requestAnimationFrame(frame);
    hud();
}

// ---------- main loop ----------
let raf = 0, last = 0, acc = 0;
function frame(now) {
    raf = 0;
    if (!state) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    if (phase === 'play') {
        acc += dt;
        let n = 0;
        while (acc >= DD.DT && n < 8 && phase === 'play') {
            DD.step(state, held); acc -= DD.DT; n++;
            if (state.events.length) handleEvents();
        }
        if (n >= 8) acc = 0;
        if (phase === 'play') {
            const b = DD.building(state);
            if (padUnder(state) !== lastBuilding) lastBuilding = null;
            if (b && b.id !== lastBuilding && !held.left && !held.right && Math.abs(state.pod.vx) < 0.6) openShop(b.id);
        }
    }
    const k = Math.min(1, dt * 8);
    camX += (targetCamX(state.pod) - camX) * k; camY += (targetCamY(state.pod) - camY) * Math.min(1, dt * 10);
    if (shake > 0) shake = Math.max(0, shake - dt * 3);
    if (flareAnim > 0) flareAnim = Math.max(0, flareAnim - dt * 1.5);
    if (flashAnim > 0) flashAnim = Math.max(0, flashAnim - dt * 3);
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast-text').textContent = ''; }
    for (const q of parts) if (q.life > 0) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 6 * dt; }
    for (const f of floats) if (f.life > 0) { f.life -= dt; f.y -= dt * 0.8; }
    if (phase === 'play' && state.pod.drill && Math.random() < 0.5) {
        const d = state.pod.drill; puff(d.tx + 0.5 - d.dx * 0.4, d.ty + (d.dy ? 0.1 : 0.5), 1, DIRT[band(d.ty)], 1.5);
    }
    hud(); draw(now);
    const busy = phase === 'play' || shake > 0 || toastT > 0 || flareAnim > 0 || parts.some(q => q.life > 0);
    if (busy && !document.hidden) raf = requestAnimationFrame(frame);
}

// ---------- input ----------
const KEYMAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };
function enterBuilding() { const b = phase === 'play' && DD.building(state); if (b) openShop(b.id); }
function useItem(id) {
    if (phase !== 'play') return;
    const r = DD.useItem(state, id);
    say(r.msg, true); handleEvents(); hud();
}
window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (modal.classList.contains('open')) {
        if (e.key === 'Escape' && onClose) { e.preventDefault(); closeDialog(); }
        else if ((e.key === 'p' || e.key === 'P') && phase === 'paused' && onClose) { e.preventDefault(); closeDialog(); }
        return;
    }
    const k = KEYMAP[e.key];
    if (k) { e.preventDefault(); held[k] = true; return; }
    if (e.key === ' ') { e.preventDefault(); return; }
    if (e.key === 'e' || e.key === 'E' || e.key === 'Enter') { e.preventDefault(); enterBuilding(); }
    else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { e.preventDefault(); pause(); }
    else if (e.key === 'h' || e.key === 'H' || e.key === 'F1') { e.preventDefault(); helpScreen(); }
    else if (/^[1-5]$/.test(e.key)) { e.preventDefault(); useItem(DD.ITEMS[Number(e.key) - 1].id); }
});
window.addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) held[k] = false; });
window.addEventListener('blur', () => { for (const k in held) held[k] = false; });
document.querySelectorAll('[data-hold]').forEach(b => {
    const k = b.dataset.hold;
    const on = e => { e.preventDefault(); if (phase !== 'play') return; held[k] = true; b.setAttribute('aria-pressed', 'true'); try { b.setPointerCapture(e.pointerId); } catch (_) { /* ok */ } };
    const off = () => { held[k] = false; b.removeAttribute('aria-pressed'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
    b.addEventListener('contextmenu', e => e.preventDefault());
});
$('pad-use').addEventListener('click', enterBuilding);
$('prompt').addEventListener('click', enterBuilding);
DD.ITEMS.forEach((it, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.id = 'item-' + it.id; b.title = it.name + ': ' + it.desc + ' (key ' + (i + 1) + ')';
    b.addEventListener('click', () => { useItem(it.id); canvas.focus({ preventScroll: true }); });
    $('items').appendChild(b);
});
$('new').addEventListener('click', () => {
    if (phase === 'shop' || phase === 'paused') { onClose = null; shop = null; modal.classList.remove('open'); }
    if (phase === 'play' || phase === 'paused' || phase === 'shop') {
        phase = 'paused';
        openDialog('new run?', '<p>start over on a fresh planet? the current run and its save are dropped.</p><div class="row"><button type="button" data-act="new">yes, new planet</button><button type="button" data-act="close">keep digging</button></div>', () => { phase = 'play'; resume(); });
    } else { if (modal.classList.contains('open')) { onClose = null; modal.classList.remove('open'); } newRun(randomSeed()); }
});
$('pause').addEventListener('click', () => { if (phase === 'paused' && onClose) closeDialog(); else pause(); });
$('help').addEventListener('click', helpScreen);
canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));

// pause on minimise (the desktop window posts this) and on hidden tabs
window.addEventListener('message', e => {
    if (e.origin === location.origin && e.data && (e.data.type === 'game-pause' || e.data.type === 'deepdrill-pause')) pause();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('pagehide', () => { if (phase === 'shop') saveRun(); });
if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(stage); else window.addEventListener('resize', resize);

// test hook: deterministic setup for the browser test, real input still drives play
window.DEEPDRILL_ENGINE = {
    sim: DD, keys: KEY,
    state: () => state, phase: () => phase, shop: () => shop, held,
    newRun: seed => { if (modal.classList.contains('open')) { onClose = null; modal.classList.remove('open'); } newRun(seed >>> 0); },
    fastForward(seconds, input) { const n = Math.round(seconds / DD.DT); for (let i = 0; i < n && !state.over; i++) DD.step(state, input || null); handleEvents(); hud(); },
    autopilot(seconds, mem) { mem = mem || {}; const n = Math.round(seconds / DD.DT); for (let i = 0; i < n && !state.over; i++) { DD.step(state, DD.bot(state, mem)); state.events.length = 0; } hud(); return mem; },
    save: saveRun
};

state = DD.newGame(randomSeed());
resize();
titleScreen();
draw();
})();
