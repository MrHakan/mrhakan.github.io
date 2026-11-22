// block roll 98 — the page: isometric canvas, input, dialogs and saves.
// The rules live in block-roll-sim.js (window.BLOCKROLL_SIM); this file only
// draws them and turns keys, swipes and clicks into moves.
(function () {
'use strict';
const S = window.BLOCKROLL_SIM, T = S.T;
const $ = id => document.getElementById(id);
const canvas = $('board'), ctx = canvas.getContext('2d'), stage = $('stage');
const SAVE_KEY = 'mrhakan98-blockroll-save';
const COUNT = S.LEVELS.length;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// ------------------------------------------------------------------ saves
function blankSave() { return { unlocked: 0, best: {}, level: 0 }; }
function cleanSave(raw) {
    const out = blankSave();
    if (!raw || typeof raw !== 'object') return out;
    if (Number.isInteger(raw.unlocked)) out.unlocked = Math.max(0, Math.min(COUNT - 1, raw.unlocked));
    if (Number.isInteger(raw.level)) out.level = Math.max(0, Math.min(out.unlocked, raw.level));
    if (raw.best && typeof raw.best === 'object') {
        for (const k of Object.keys(raw.best)) {
            const i = +k, v = raw.best[k];
            if (Number.isInteger(i) && i >= 0 && i < COUNT && Number.isInteger(v) && v > 0) out.best[i] = v;
        }
    }
    return out;
}
function readSave() {
    try { return cleanSave(JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')); } catch (_) { return blankSave(); }
}
let save = readSave();
// another tab may have cleared more levels meanwhile: keep the best of both
function writeSave() {
    const disk = readSave();
    save.unlocked = Math.max(save.unlocked, disk.unlocked);
    for (const k of Object.keys(disk.best)) if (!save.best[k] || disk.best[k] < save.best[k]) save.best[k] = disk.best[k];
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) { /* storage is optional */ }
}
function starsFor(i, moves) {
    const par = S.LEVELS[i].par;
    if (!moves) return 0;
    if (moves <= par) return 3;
    if (moves <= Math.ceil(par * 1.4)) return 2;
    return 1;
}
function totalStars() { let n = 0; for (const k of Object.keys(save.best)) n += starsFor(+k, save.best[k]); return n; }

// ------------------------------------------------------------------ sound
let actx = null;
function soundOn() { try { return localStorage.getItem('sound-enabled') !== 'false'; } catch (_) { return true; } }
function beep(freq, dur, type, vol, slideTo) {
    if (!soundOn()) return;
    try {
        if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; actx = new AC(); }
        if (actx.state === 'suspended') actx.resume();
        const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
        o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        g.gain.setValueAtTime(vol || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (_) { /* no audio, no problem */ }
}
const sfx = {
    roll: () => beep(150, 0.07, 'triangle', 0.06, 90),
    bump: () => beep(80, 0.08, 'square', 0.03),
    swap: () => beep(520, 0.05, 'square', 0.03),
    click: () => beep(880, 0.05, 'square', 0.035),
    bridge: () => beep(330, 0.18, 'sawtooth', 0.025, 660),
    fall: () => beep(400, 0.6, 'sawtooth', 0.04, 60),
    win: () => { beep(523, 0.12, 'square', 0.04); setTimeout(() => beep(659, 0.12, 'square', 0.04), 110); setTimeout(() => beep(784, 0.25, 'square', 0.04), 220); },
    split: () => beep(700, 0.15, 'triangle', 0.05, 300)
};

// ------------------------------------------------------------------ state
let idx = 0, L = null, state = null, anim = null, overlay = null, attempts = 0;
const queue = [];
let bridgeAmt = new Float32Array(0), order = [];
let status = '';
function say(msg) { status = msg; $('status').textContent = msg; }

function loadLevel(i) {
    idx = Math.max(0, Math.min(COUNT - 1, i | 0));
    L = S.level(idx);
    state = S.initial(L); anim = null; queue.length = 0; attempts = 0;
    bridgeAmt = new Float32Array(L.w * L.h);
    for (let c = 0; c < L.w * L.h; c++) if (L.tile[c] === T.BRIDGE) bridgeAmt[c] = (state.mask >> L.group[c] & 1);
    order = [];
    for (let c = 0; c < L.w * L.h; c++) if (L.tile[c] !== T.VOID) order.push(c);
    order.sort((a, b) => depthOf(a % L.w, (a / L.w) | 0) - depthOf(b % L.w, (b / L.w) | 0));
    save.level = idx; writeSave();
    fitCamera(); buildBackground(); hud();
    say('level ' + (idx + 1) + ' - ' + L.name + '. par ' + L.par + ' moves. code ' + L.passcode + '.');
    draw();
}
function restart(msg) {
    state = S.initial(L); anim = null; queue.length = 0;
    for (let c = 0; c < L.w * L.h; c++) if (L.tile[c] === T.BRIDGE) bridgeAmt[c] = (state.mask >> L.group[c] & 1);
    hud(); if (msg) say(msg); draw();
}
function hud() {
    $('h-level').textContent = (idx + 1) + '/' + COUNT;
    $('h-moves').textContent = state.moves;
    $('h-par').textContent = L.par;
    $('h-best').textContent = save.best[idx] || '-';
    $('h-stars').textContent = totalStars() + '/' + COUNT * 3;
    $('h-code').textContent = L.passcode;
    $('b-pause').textContent = overlay === 'pause' ? 'resume' : 'pause';
    $('b-pause').disabled = overlay !== null && overlay !== 'pause';
    $('pad').querySelector('.sw').disabled = !state.cubes;
}

// ------------------------------------------------------------------ moves
function input(dir) {
    if (overlay || !state || state.status !== 'play') return;
    if (anim) { if (queue.length < 2) queue.push(dir); return; }
    act(dir);
}
function act(dir) {
    if (dir === 'swap') {
        if (!state.cubes) return;
        state = S.swap(state); sfx.swap(); say('swapped to the other cube.'); hud(); draw(); return;
    }
    const r = S.move(L, state, dir);
    if (!r.moved) { sfx.bump(); return; }
    const from = state;
    state = r.state;
    anim = { kind: 'roll', from, to: state, dir, t: 0, dur: reduced.matches ? 0.06 : 0.17, events: r.events };
    sfx.roll();
    for (const e of r.events) {
        if (e.kind === 'switch') sfx.click();
        if (e.kind === 'bridge-open') { sfx.bridge(); say('click. a bridge slides into place.'); }
        if (e.kind === 'bridge-close') { sfx.bridge(); say('clunk. a bridge folds away.'); }
        if (e.kind === 'split') { sfx.split(); say('split in two. space or the swap button picks a cube.'); }
        if (e.kind === 'merge') say('back together. one block again.');
    }
    hud(); kick();
}
function finishAnim() {
    const a = anim; anim = null;
    if (!a) return;
    if (a.kind === 'roll') {
        if (state.status === 'fell') {
            const fall = a.events.find(e => e.kind === 'fall');
            const fc = fall ? fall.cells[0] : null;
            const cube = state.cubes ? (fc && state.cubes[1][0] === fc[0] && state.cubes[1][1] === fc[1] ? 1 : 0) : -1;
            anim = { kind: 'fall', t: 0, dur: reduced.matches ? 0.3 : 0.9, cells: fall ? fall.cells : [], fragile: fall && fall.fragile, cube };
            queue.length = 0; sfx.fall();
            say(fall && fall.fragile ? 'crack. orange floor cannot hold you standing up.' : 'whoops. over the edge.');
        } else if (state.status === 'won') {
            anim = { kind: 'sink', t: 0, dur: reduced.matches ? 0.2 : 0.75 }; queue.length = 0; sfx.win();
        } else if (state.cubes && !a.from.cubes) anim = { kind: 'split', t: 0, dur: reduced.matches ? 0.05 : 0.3 };
    } else if (a.kind === 'fall') {
        attempts++;
        restart('try ' + (attempts + 1) + '. level ' + (idx + 1) + ' from the top.');
        return;
    } else if (a.kind === 'sink') { complete(); return; }
    if (!anim && queue.length && state.status === 'play') act(queue.shift());
}
// achievements live on the desktop around this frame; alone, there are none
function achieve(id) { try { const u = window.parent !== window && window.parent.unlockAchievement; if (typeof u === 'function') u(id); } catch (_) { /* no desktop */ } }
function complete() {
    const moves = state.moves, old = save.best[idx];
    if (!old || moves < old) save.best[idx] = moves;
    if (idx + 1 < COUNT) save.unlocked = Math.max(save.unlocked, idx + 1);
    writeSave();
    const stars = starsFor(idx, moves), last = idx === COUNT - 1;
    if (idx >= 9) achieve('blockroll_10');
    if (last) achieve('blockroll_win');
    $('w-head').textContent = last ? 'every hole filled.' : moves <= L.par ? 'perfect roll.' : 'in the hole.';
    $('w-stars').textContent = '\u2605'.repeat(stars) + '\u2606'.repeat(3 - stars);
    $('w-stars').setAttribute('aria-label', stars + ' of 3 stars');
    $('w-text').textContent = moves + ' moves, par ' + L.par + (old ? ', your best was ' + old : '') + '.' +
        (last ? ' that was the last level: ' + totalStars() + ' of ' + COUNT * 3 + ' stars.' : '');
    $('w-code').textContent = last ? '' : 'level ' + (idx + 2) + ' passcode: ' + S.passcode(idx + 1);
    $('w-next').textContent = last ? 'level select' : 'next level';
    say('level ' + (idx + 1) + ' cleared in ' + moves + ' moves.');
    show('win');
}

// ------------------------------------------------------------------ dialogs
const DIALOGS = { title: 'd-title', levels: 'd-levels', pause: 'd-pause', win: 'd-win' };
function show(name) {
    overlay = name;
    for (const k of Object.keys(DIALOGS)) $(DIALOGS[k]).hidden = k !== name;
    if (name === 'levels') buildLevels();
    hud(); draw();
    const focus = { title: 't-play', levels: null, pause: 'p-resume', win: 'w-next' }[name];
    const el = focus ? $(focus) : $('l-grid').querySelector('[aria-current]') || $('l-close');
    if (el) el.focus({ preventScroll: true });
}
function hide() {
    overlay = null;
    for (const k of Object.keys(DIALOGS)) $(DIALOGS[k]).hidden = true;
    hud(); canvas.focus({ preventScroll: true }); kick(); draw();
}
function pause() {
    if (overlay) return;
    show('pause'); say('paused.');
}
function buildLevels() {
    const grid = $('l-grid'), frag = document.createDocumentFragment();
    for (let i = 0; i < COUNT; i++) {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.level = i;
        const best = save.best[i], st = starsFor(i, best);
        b.disabled = i > save.unlocked;
        b.innerHTML = (i + 1) + '<small>' + (b.disabled ? 'locked' : best ? '\u2605'.repeat(st) + '\u2606'.repeat(3 - st) : 'new') + '</small>';
        b.title = (i + 1) + ' - ' + S.LEVELS[i].name + (best ? ' (best ' + best + ')' : '');
        b.setAttribute('aria-label', 'level ' + (i + 1) + ' ' + S.LEVELS[i].name + (b.disabled ? ' locked' : ''));
        if (i === idx) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', () => { loadLevel(i); hide(); });
        frag.appendChild(b);
    }
    grid.replaceChildren(frag);
    $('l-msg').textContent = '';
}
$('l-code').addEventListener('submit', e => {
    e.preventDefault();
    const i = S.levelForCode($('l-input').value);
    if (i < 0) { $('l-msg').textContent = 'no level with that code.'; sfx.bump(); return; }
    save.unlocked = Math.max(save.unlocked, i); writeSave();
    $('l-input').value = '';
    loadLevel(i); hide();
    say('passcode accepted. level ' + (i + 1) + ' - ' + L.name + '.');
});
$('t-play').addEventListener('click', () => { hide(); });
$('t-levels').addEventListener('click', () => show('levels'));
$('l-close').addEventListener('click', () => hide());
$('p-resume').addEventListener('click', () => { hide(); say('back to it.'); });
$('p-levels').addEventListener('click', () => show('levels'));
$('w-retry').addEventListener('click', () => { hide(); restart('again, level ' + (idx + 1) + '. par ' + L.par + '.'); });
$('w-levels').addEventListener('click', () => show('levels'));
$('w-next').addEventListener('click', () => {
    if (idx === COUNT - 1) { show('levels'); return; }
    loadLevel(idx + 1); hide();
});
$('b-levels').addEventListener('click', () => show('levels'));
$('b-help').addEventListener('click', () => show('title'));
$('b-restart').addEventListener('click', () => { if (overlay === 'win' || overlay === 'pause') hide(); restart('restarted level ' + (idx + 1) + '.'); });
$('b-pause').addEventListener('click', () => { if (overlay === 'pause') { hide(); say('back to it.'); } else pause(); });
$('pad').addEventListener('click', e => {
    const b = e.target.closest('button[data-dir]');
    if (b) input(b.dataset.dir);
});

// ------------------------------------------------------------------ keyboard
const KEYS = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R' };
window.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (overlay) {
        if (e.key === 'Escape' || ((e.key === 'p' || e.key === 'P') && overlay === 'pause')) {
            e.preventDefault();
            if (overlay === 'pause' || overlay === 'levels' || overlay === 'title') { hide(); }
        }
        return;
    }
    if (KEYS[e.key]) { e.preventDefault(); input(KEYS[e.key]); }
    else if (e.key === ' ' || e.key === 'Tab' && state && state.cubes) { e.preventDefault(); input('swap'); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); restart('restarted level ' + (idx + 1) + '.'); }
    else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { e.preventDefault(); pause(); }
});

// ------------------------------------------------------------------ pointer
let down = null;
canvas.addEventListener('pointerdown', e => {
    down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    canvas.focus({ preventScroll: true });
});
canvas.addEventListener('pointerup', e => {
    if (!down || down.id !== e.pointerId) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (Math.hypot(dx, dy) > 22) { input(dirFromScreen(dx, dy)); return; }
    // a tap beside the block rolls it that way
    const box = canvas.getBoundingClientRect(), c = blockCentre();
    const tx = e.clientX - box.left - c[0], ty = e.clientY - box.top - c[1];
    if (Math.hypot(tx, ty) > TS * 0.35) input(dirFromScreen(tx, ty));
});
canvas.addEventListener('pointercancel', () => { down = null; });
const EX = [0.92, 0.30], EY = [-0.40, 0.56], EZ = -0.80;
const SCREEN_DIRS = [['R', EX[0], EX[1]], ['L', -EX[0], -EX[1]], ['D', EY[0], EY[1]], ['U', -EY[0], -EY[1]]];
function dirFromScreen(dx, dy) {
    let best = 'R', bestDot = -Infinity;
    const n = Math.hypot(dx, dy) || 1;
    for (const d of SCREEN_DIRS) {
        const dot = (d[1] * dx + d[2] * dy) / (n * Math.hypot(d[1], d[2]));
        if (dot > bestDot) { bestDot = dot; best = d[0]; }
    }
    return best;
}
function blockCentre() {
    let cx, cy;
    if (state.cubes) { const c = state.cubes[state.active]; cx = c[0] + 0.5; cy = c[1] + 0.5; }
    else if (state.o === 0) { cx = state.x + 0.5; cy = state.y + 0.5; }
    else if (state.o === 1) { cx = state.x + 1; cy = state.y + 0.5; }
    else { cx = state.x + 0.5; cy = state.y + 1; }
    return [px(cx, cy, 0), py(cx, cy, state.cubes ? 0.5 : state.o === 0 ? 1 : 0.5)];
}

// ------------------------------------------------------------------ pausing
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('message', e => {
    if (e.origin === location.origin && e.data && e.data.type === 'game-pause') pause();
});

// ------------------------------------------------------------------ camera
let TS = 40, OX = 0, OY = 0, CW = 300, CH = 200, DPR = 1;
const V = [1, 2.3, 1.985]; // the direction the camera looks from
function depthOf(x, y) { return x + 2.3 * y; }
function px(x, y) { return OX + (x * EX[0] + y * EY[0]) * TS; }
function py(x, y, z) { return OY + (x * EX[1] + y * EY[1] + z * EZ) * TS; }
function fitCamera() {
    if (!L) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let c = 0; c < L.w * L.h; c++) {
        if (L.tile[c] === T.VOID) continue;
        const x = c % L.w, y = (c / L.w) | 0;
        for (const [ax, ay] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
            const sx = ax * EX[0] + ay * EY[0], top = ax * EX[1] + ay * EY[1] + 2 * EZ, bot = ax * EX[1] + ay * EY[1] - 0.3 * EZ;
            x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, top); y1 = Math.max(y1, bot);
        }
    }
    const pad = Math.min(CW, CH) < 400 ? 10 : 26;
    TS = Math.min((CW - pad * 2) / (x1 - x0), (CH - pad * 2 - 18) / (y1 - y0), 70);
    OX = CW / 2 - TS * (x0 + x1) / 2;
    OY = CH / 2 + 9 - TS * (y0 + y1) / 2;
}
const bg = document.createElement('canvas'), bgx = bg.getContext('2d');
function buildBackground() {
    bg.width = Math.max(1, Math.round(CW * DPR)); bg.height = Math.max(1, Math.round(CH * DPR));
    bgx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const hue = [[11, 29, 74, 26, 106, 122], [40, 16, 70, 160, 70, 110], [10, 40, 60, 30, 120, 90], [30, 20, 60, 120, 90, 150]][idx % 4];
    const g = bgx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, 'rgb(' + hue[0] + ',' + hue[1] + ',' + hue[2] + ')');
    g.addColorStop(1, 'rgb(' + hue[3] + ',' + hue[4] + ',' + hue[5] + ')');
    bgx.fillStyle = g; bgx.fillRect(0, 0, CW, CH);
    // seeded per level so the sky does not flicker between restarts
    let seed = (idx + 1) * 2654435761 >>> 0;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < 70; i++) {
        bgx.fillStyle = 'rgba(255,255,255,' + (0.15 + rnd() * 0.5).toFixed(2) + ')';
        const s = rnd() < 0.85 ? 1 : 2;
        bgx.fillRect(rnd() * CW | 0, rnd() * CH * 0.7 | 0, s, s);
    }
    for (let i = 0; i < 5; i++) {
        const cx = rnd() * CW, cy = CH * (0.55 + rnd() * 0.4), r = 30 + rnd() * 60;
        bgx.fillStyle = 'rgba(255,255,255,0.05)';
        for (let k = 0; k < 4; k++) { bgx.beginPath(); bgx.ellipse(cx + (k - 1.5) * r * 0.6, cy + (k % 2) * r * 0.12, r * 0.7, r * 0.28, 0, 0, Math.PI * 2); bgx.fill(); }
    }
}
function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    CW = w; CH = h;
    canvas.width = Math.round(w * DPR); canvas.height = Math.round(h * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    fitCamera(); buildBackground(); draw();
}
if (window.ResizeObserver) new ResizeObserver(resize).observe(stage); else window.addEventListener('resize', resize);

// ------------------------------------------------------------------ drawing
const TH = 0.28; // tile thickness
function path4(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4) {
    ctx.beginPath();
    ctx.moveTo(px(x1, y1), py(x1, y1, z1)); ctx.lineTo(px(x2, y2), py(x2, y2, z2));
    ctx.lineTo(px(x3, y3), py(x3, y3, z3)); ctx.lineTo(px(x4, y4), py(x4, y4, z4)); ctx.closePath();
}
const TILE_COL = {
    [T.FLOOR]: ['#c8c8c8', '#bcbcbc', '#8a8a8a', '#6c6c6c'],
    [T.FRAGILE]: ['#f39b2f', '#ec9026', '#b5651a', '#8f4e12'],
    [T.BRIDGE]: ['#b8875a', '#b07f52', '#7d5a39', '#5f432a'],
    [T.SOFT]: ['#c8c8c8', '#bcbcbc', '#8a8a8a', '#6c6c6c'],
    [T.HEAVY]: ['#c8c8c8', '#bcbcbc', '#8a8a8a', '#6c6c6c'],
    [T.SPLIT]: ['#c8c8c8', '#bcbcbc', '#8a8a8a', '#6c6c6c'],
    [T.GOAL]: ['#c8c8c8', '#bcbcbc', '#8a8a8a', '#6c6c6c']
};
function drawTile(c, dz, alpha) {
    const x = c % L.w, y = (c / L.w) | 0, t = L.tile[c], col = TILE_COL[t];
    const i = 0.03, X0 = x + i, X1 = x + 1 - i, Y0 = y + i, Y1 = y + 1 - i, z = dz, zb = dz - TH;
    ctx.globalAlpha = alpha;
    // sides first, then the top with a win98 bevel
    ctx.fillStyle = col[2]; path4(X0, Y1, z, X1, Y1, z, X1, Y1, zb, X0, Y1, zb); ctx.fill();
    ctx.fillStyle = col[3]; path4(X1, Y0, z, X1, Y1, z, X1, Y1, zb, X1, Y0, zb); ctx.fill();
    ctx.fillStyle = (x + y) & 1 ? col[1] : col[0]; path4(X0, Y0, z, X1, Y0, z, X1, Y1, z, X0, Y1, z); ctx.fill();
    ctx.lineWidth = Math.max(1, TS / 30);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.moveTo(px(X0, Y1), py(X0, Y1, z)); ctx.lineTo(px(X0, Y0), py(X0, Y0, z)); ctx.lineTo(px(X1, Y0), py(X1, Y0, z)); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.moveTo(px(X1, Y0), py(X1, Y0, z)); ctx.lineTo(px(X1, Y1), py(X1, Y1, z)); ctx.lineTo(px(X0, Y1), py(X0, Y1, z)); ctx.stroke();
    const cx = x + 0.5, cy = y + 0.5;
    if (t === T.GOAL) {
        ctx.fillStyle = '#05060c'; path4(x + 0.14, y + 0.14, z, x + 0.86, y + 0.14, z, x + 0.86, y + 0.86, z, x + 0.14, y + 0.86, z); ctx.fill();
        ctx.strokeStyle = 'rgba(255,216,74,0.55)'; ctx.stroke();
    } else if (t === T.SOFT) {
        ctx.fillStyle = '#3c9b49'; ctx.strokeStyle = '#174d1f';
        ctx.beginPath();
        for (let k = 0; k <= 16; k++) { const a = k / 16 * Math.PI * 2, ex = cx + Math.cos(a) * 0.27, ey = cy + Math.sin(a) * 0.27; k ? ctx.lineTo(px(ex, ey), py(ex, ey, z)) : ctx.moveTo(px(ex, ey), py(ex, ey, z)); }
        ctx.fill(); ctx.stroke();
    } else if (t === T.HEAVY) {
        ctx.strokeStyle = '#c43b3b'; ctx.lineWidth = Math.max(2, TS / 9); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(px(x + 0.25, y + 0.25), py(x + 0.25, y + 0.25, z)); ctx.lineTo(px(x + 0.75, y + 0.75), py(x + 0.75, y + 0.75, z));
        ctx.moveTo(px(x + 0.75, y + 0.25), py(x + 0.75, y + 0.25, z)); ctx.lineTo(px(x + 0.25, y + 0.75), py(x + 0.25, y + 0.75, z)); ctx.stroke();
        ctx.lineCap = 'butt';
    } else if (t === T.SPLIT) {
        ctx.fillStyle = '#3b5bc4';
        path4(x + 0.18, y + 0.3, z, x + 0.44, y + 0.3, z, x + 0.44, y + 0.7, z, x + 0.18, y + 0.7, z); ctx.fill();
        path4(x + 0.56, y + 0.3, z, x + 0.82, y + 0.3, z, x + 0.82, y + 0.7, z, x + 0.56, y + 0.7, z); ctx.fill();
    } else if (t === T.FRAGILE) {
        ctx.strokeStyle = 'rgba(110,50,0,0.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px(x + 0.2, y + 0.3), py(x + 0.2, y + 0.3, z)); ctx.lineTo(px(x + 0.5, y + 0.45), py(x + 0.5, y + 0.45, z)); ctx.lineTo(px(x + 0.62, y + 0.8), py(x + 0.62, y + 0.8, z)); ctx.stroke();
    } else if (t === T.BRIDGE) {
        ctx.strokeStyle = 'rgba(60,35,15,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const k of [0.35, 0.65]) { ctx.moveTo(px(x + k, y + 0.05), py(x + k, y + 0.05, z)); ctx.lineTo(px(x + k, y + 0.95), py(x + k, y + 0.95, z)); }
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}
function drawGhost(c) {
    const x = c % L.w, y = (c / L.w) | 0;
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
    path4(x + 0.1, y + 0.1, 0, x + 0.9, y + 0.1, 0, x + 0.9, y + 0.9, 0, x + 0.1, y + 0.9, 0); ctx.stroke();
    ctx.setLineDash([]);
}

// a box, optionally turned about a floor edge (the roll), lifted or dropped
const BX = new Float64Array(8), BY = new Float64Array(8), BZ = new Float64Array(8), SX = new Float64Array(8), SY = new Float64Array(8);
const FACES = [[4, 5, 7, 6, 0, 0, 1], [0, 1, 3, 2, 0, 0, -1], [1, 3, 7, 5, 1, 0, 0], [0, 2, 6, 4, -1, 0, 0], [2, 3, 7, 6, 0, 1, 0], [0, 1, 5, 4, 0, -1, 0]];
const LIGHT = [0.35, 0.55, 0.76];
function drawBox(x0, y0, w, d, h, rot, dz, base, alpha, active) {
    for (let i = 0; i < 8; i++) { BX[i] = x0 + (i & 1 ? w : 0); BY[i] = y0 + (i & 2 ? d : 0); BZ[i] = i & 4 ? h : 0; }
    const ca = rot ? Math.cos(rot.a) : 1, sa = rot ? Math.sin(rot.a) : 0;
    if (rot) for (let i = 0; i < 8; i++) turn(i, rot, ca, sa);
    for (let i = 0; i < 8; i++) { SX[i] = px(BX[i], BY[i]); SY[i] = py(BX[i], BY[i], BZ[i] + dz); }
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, TS / 28);
    for (const f of FACES) {
        let nx = f[4], ny = f[5], nz = f[6];
        if (rot) {
            if (rot.axis === 'x') { const ox = nx; nx = ox * ca + rot.s * nz * sa; nz = -rot.s * ox * sa + nz * ca; }
            else { const oy = ny; ny = oy * ca + rot.s * nz * sa; nz = -rot.s * oy * sa + nz * ca; }
        }
        if (nx * V[0] + ny * V[1] + nz * V[2] <= 0) continue;
        const shade = 0.42 + 0.58 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        ctx.fillStyle = 'rgb(' + (base[0] * shade | 0) + ',' + (base[1] * shade | 0) + ',' + (base[2] * shade | 0) + ')';
        ctx.beginPath(); ctx.moveTo(SX[f[0]], SY[f[0]]); ctx.lineTo(SX[f[1]], SY[f[1]]); ctx.lineTo(SX[f[2]], SY[f[2]]); ctx.lineTo(SX[f[3]], SY[f[3]]); ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = active ? '#ffe680' : 'rgba(30,10,5,0.85)'; ctx.stroke();
    }
    ctx.globalAlpha = 1;
}
function turn(i, rot, c, s) {
    if (rot.axis === 'x') {
        const dx = BX[i] - rot.p, z = BZ[i];
        BX[i] = rot.p + dx * c + rot.s * z * s; BZ[i] = -rot.s * dx * s + z * c;
    } else {
        const dy = BY[i] - rot.p, z = BZ[i];
        BY[i] = rot.p + dy * c + rot.s * z * s; BZ[i] = -rot.s * dy * s + z * c;
    }
}
function boxOf(s) {
    if (s.o === 0) return [s.x, s.y, 1, 1, 2];
    if (s.o === 1) return [s.x, s.y, 2, 1, 1];
    return [s.x, s.y, 1, 2, 1];
}
function rollRot(b, dir, a) {
    if (dir === 'R') return { axis: 'x', p: b[0] + b[2], s: 1, a };
    if (dir === 'L') return { axis: 'x', p: b[0], s: -1, a };
    if (dir === 'D') return { axis: 'y', p: b[1] + b[3], s: 1, a };
    return { axis: 'y', p: b[1], s: -1, a };
}
const BLOCK = [214, 116, 64], CUBE_ON = [226, 136, 70], CUBE_OFF = [150, 110, 96];
function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// what goes where this frame: the block is slotted between tiles by depth
function blockDepth() {
    const cs = S.cells(anim && anim.kind === 'roll' ? anim.from : state);
    let d = -Infinity;
    for (const c of cs) d = Math.max(d, depthOf(c[0], c[1]));
    if (anim && anim.kind === 'roll') for (const c of S.cells(anim.to)) d = Math.max(d, depthOf(c[0], c[1]));
    if (state.cubes) for (const c of state.cubes) d = Math.max(d, depthOf(c[0], c[1]));
    return d + 0.01;
}
function drawBlock() {
    const a = anim, t = a ? Math.min(1, a.t / a.dur) : 1;
    if (a && a.kind === 'roll') {
        const f = a.from, k = ease(t) * Math.PI / 2;
        if (f.cubes) {
            const other = f.cubes[1 - f.active], me = f.cubes[f.active];
            drawBox(other[0], other[1], 1, 1, 1, null, 0, CUBE_OFF, 1, false);
            drawBox(me[0], me[1], 1, 1, 1, rollRot([me[0], me[1], 1, 1], a.dir, k), 0, CUBE_ON, 1, true);
        } else {
            const b = boxOf(f);
            drawBox(b[0], b[1], b[2], b[3], b[4], rollRot(b, a.dir, k), 0, BLOCK, 1, false);
        }
        return;
    }
    if (a && a.kind === 'fall') {
        const drop = Math.max(0, a.t - 0.12), dz = -9 * drop * drop, alpha = Math.max(0, 1 - Math.max(0, t - 0.5) * 2);
        if (state.cubes) {
            const me = state.cubes[a.cube], other = state.cubes[1 - a.cube];
            drawBox(other[0], other[1], 1, 1, 1, null, 0, CUBE_OFF, 1, false);
            drawBox(me[0], me[1], 1, 1, 1, null, dz, CUBE_ON, alpha, false);
            return;
        }
        const b = boxOf(state);
        let rot = null;
        // half over the edge: tip over that side before dropping
        if (state.o !== 0 && a.cells.length === 1) {
            const c = a.cells[0], far = state.o === 1 ? c[0] > state.x : c[1] > state.y;
            const tip = Math.min(Math.PI / 2, a.t * 7);
            if (state.o === 1) rot = { axis: 'x', p: state.x + 1, s: far ? 1 : -1, a: tip };
            else rot = { axis: 'y', p: state.y + 1, s: far ? 1 : -1, a: tip };
        }
        drawBox(b[0], b[1], b[2], b[3], b[4], rot, dz, BLOCK, alpha, false);
        return;
    }
    if (a && a.kind === 'sink') {
        const x = L.goal[0], y = L.goal[1];
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(px(x + 0.14, y + 0.86), py(x + 0.14, y + 0.86, 0)); ctx.lineTo(px(x + 0.86, y + 0.86), py(x + 0.86, y + 0.86, 0));
        ctx.lineTo(px(x + 0.86, y + 0.14), py(x + 0.86, y + 0.14, 0)); ctx.lineTo(px(x + 0.86, y + 0.14), -10); ctx.lineTo(px(x + 0.14, y + 0.86), -10); ctx.closePath();
        ctx.clip();
        drawBox(x, y, 1, 1, 2, null, -2.4 * ease(t), BLOCK, 1 - t * 0.6, false);
        ctx.restore();
        return;
    }
    if (state.cubes) {
        const lift = a && a.kind === 'split' ? (1 - ease(t)) * 3 : 0;
        for (let i = 0; i < 2; i++) {
            const c = state.cubes[i];
            drawBox(c[0], c[1], 1, 1, 1, null, lift, i === state.active ? CUBE_ON : CUBE_OFF, 1, i === state.active);
        }
        return;
    }
    const b = boxOf(state);
    drawBox(b[0], b[1], b[2], b[3], b[4], null, 0, BLOCK, 1, false);
}
function draw() {
    if (!L || !state) return;
    ctx.drawImage(bg, 0, 0, CW, CH);
    const bd = blockDepth(), fragile = anim && anim.kind === 'fall' && anim.fragile;
    const fallT = fragile ? Math.max(0, anim.t - 0.12) : 0;
    let placed = false;
    for (let n = 0; n < order.length; n++) {
        const c = order[n], x = c % L.w, y = (c / L.w) | 0;
        if (!placed && depthOf(x, y) > bd) { drawBlock(); placed = true; }
        if (L.tile[c] === T.BRIDGE) {
            const a = bridgeAmt[c];
            if (a < 0.02) { drawGhost(c); continue; }
            drawTile(c, -(1 - a) * 0.8, a);
        } else if (fragile && fragile[0] === x && fragile[1] === y) {
            drawTile(c, -9 * fallT * fallT, Math.max(0, 1 - fallT * 1.5));
        } else drawTile(c, 0, 1);
    }
    if (!placed) drawBlock();
    // the level name, small, top left
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 12px Tahoma, sans-serif'; ctx.textBaseline = 'top';
    ctx.fillText((idx + 1) + '. ' + L.name, 8, 7);
    if (state.cubes) { ctx.font = '11px Tahoma, sans-serif'; ctx.fillStyle = 'rgba(255,230,128,0.9)'; ctx.fillText('cube ' + (state.active + 1) + ' of 2 - space swaps', 8, 23); }
}

// ------------------------------------------------------------------ loop
let raf = 0, last = 0;
function bridgesMoving() {
    for (let c = 0; c < bridgeAmt.length; c++) {
        if (L.tile[c] !== T.BRIDGE) continue;
        const target = state.mask >> L.group[c] & 1;
        if (Math.abs(bridgeAmt[c] - target) > 0.001) return true;
    }
    return false;
}
function stepBridges(dt) {
    const speed = reduced.matches ? 100 : 5;
    for (let c = 0; c < bridgeAmt.length; c++) {
        if (L.tile[c] !== T.BRIDGE) continue;
        const target = state.mask >> L.group[c] & 1, cur = bridgeAmt[c];
        bridgeAmt[c] = target > cur ? Math.min(target, cur + dt * speed) : Math.max(target, cur - dt * speed);
    }
}
function frame(now) {
    raf = 0;
    if (overlay || document.hidden) { last = 0; draw(); return; }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    if (anim) { anim.t += dt; if (anim.t >= anim.dur) finishAnim(); }
    stepBridges(dt);
    draw();
    if (anim || bridgesMoving()) raf = requestAnimationFrame(frame);
    else last = 0;
}
function kick() { if (!raf && !overlay) raf = requestAnimationFrame(frame); }
window.addEventListener('pagehide', () => { if (raf) cancelAnimationFrame(raf); raf = 0; });
reduced.addEventListener && reduced.addEventListener('change', draw);

// ------------------------------------------------------------------ test hook
window.BLOCKROLL_ENGINE = {
    sim: S,
    state: () => state,
    level: () => idx,
    levelData: () => L,
    overlay: () => overlay,
    busy: () => !!anim || queue.length > 0 || raf !== 0,
    save: () => readSave(),
    load: i => { loadLevel(i); if (overlay) hide(); },
    // where on the canvas a tap would roll the block a given way
    tapPoint: dir => { const c = blockCentre(), d = SCREEN_DIRS.find(v => v[0] === dir), n = Math.hypot(d[1], d[2]); return [c[0] + d[1] / n * TS * 1.2, c[1] + d[2] / n * TS * 1.2]; },
    solution: i => { const r = S.solve(S.level(i === undefined ? idx : i)); return r && r.path; },
    // apply moves with no animation, for setting up a position quickly
    fastForward(path) {
        for (const ch of path) {
            if (state.status !== 'play') break;
            if (ch === 'x') state = S.swap(state);
            else state = S.move(L, state, ch).state;
        }
        for (let c = 0; c < bridgeAmt.length; c++) if (L.tile[c] === T.BRIDGE) bridgeAmt[c] = state.mask >> L.group[c] & 1;
        anim = null; queue.length = 0; hud(); draw();
        if (state.status === 'won') complete();
        else if (state.status === 'fell') restart('whoops.');
        return state;
    }
};

// ------------------------------------------------------------------ boot
resize();
loadLevel(Math.min(save.level, save.unlocked));
show('title');
if (save.unlocked > 0 || save.best[0]) $('t-play').textContent = 'continue level ' + (idx + 1);
say('level ' + (idx + 1) + ' - ' + L.name + '. par ' + L.par + ' moves.');
})();
