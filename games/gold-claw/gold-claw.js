// gold claw 98 - the page: drawing, input, overlays, sound and saves.
// The rules live in gold-claw-sim.js; this file only reads the state, feeds
// it the player's presses and draws the result.
(function () {
'use strict';
const S = window.GoldClawSim;
const W = S.W, H = S.H, PX = S.PX, PY = S.PY;
const $ = id => document.getElementById(id);
const canvas = $('field'), ctx = canvas.getContext('2d');
const stage = $('stage'), overlay = $('overlay');
const KEY = 'mrhakan98-goldclaw-';

// ---------- saves (storage may be blocked) ----------
function load(name) { try { const n = Number(localStorage.getItem(KEY + name)); return Number.isSafeInteger(n) && n > 0 ? n : 0; } catch (_) { return 0; } }
function save(name, n) { try { localStorage.setItem(KEY + name, String(n)); } catch (_) { /* records are optional */ } }
const best = { level: load('best-level'), money: load('best-money') };
function record(s) {
    // a level counts once it is cleared
    const cleared = s.phase === 'over' ? s.level - 1 : s.level;
    let changed = false;
    if (cleared > best.level) { best.level = cleared; save('best-level', cleared); changed = true; }
    if (s.stats.best > best.money) { best.money = s.stats.best; save('best-money', best.money); changed = true; }
    if (changed) showBest();
    return changed;
}
function showBest() { $('best').textContent = 'best: level ' + best.level + ' · $' + best.money; }

// ---------- sound: tiny beeps, silent when the desktop says so ----------
let audio = null;
function soundOn() { try { return localStorage.getItem('sound-enabled') !== 'false'; } catch (_) { return true; } }
function beep(freq, dur, type, vol, slide) {
    if (!soundOn()) return;
    try {
        if (!audio) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; audio = new AC(); }
        if (audio.state === 'suspended') audio.resume();
        const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
        o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
        g.gain.setValueAtTime(vol || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (_) { /* no audio, no problem */ }
}

// ---------- faces: the repo's cursed emoji as the miner ----------
const FACES = {};
for (const [k, f] of [['idle', 'heh.png'], ['happy', 'oleyy.png'], ['meh', 'pffft.png'], ['boom', 'hasiktir.png'], ['sad', 'yeterartik.png']]) {
    const img = new Image(); img.src = '../../src/emoj/' + f; FACES[k] = img;
}
const faceSrc = k => FACES[k].src;
let face = 'idle', faceUntil = 0;
function setFace(k, ms) { face = k; faceUntil = now + ms; }

// ---------- sprites, drawn once ----------
const SPR = {};
function sprite(key, size, draw) {
    const c = document.createElement('canvas'); c.width = c.height = size * 2;
    const g = c.getContext('2d'); g.scale(2, 2); g.translate(size / 2, size / 2); draw(g);
    SPR[key] = { c, size };
}
function blob(g, r, seed, lumps) {
    g.beginPath();
    for (let i = 0; i <= lumps; i++) {
        const a = i / lumps * Math.PI * 2, k = 0.82 + 0.18 * Math.abs(Math.sin(seed * 7.3 + i * 2.1));
        const x = Math.cos(a) * r * k, y = Math.sin(a) * r * k * 0.9;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
}
function nugget(g, r, seed, light, mid, dark) {
    const grad = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    grad.addColorStop(0, light); grad.addColorStop(0.55, mid); grad.addColorStop(1, dark);
    blob(g, r, seed, 11); g.fillStyle = grad; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(60,30,0,.55)'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.beginPath(); g.ellipse(-r * 0.35, -r * 0.4, r * 0.18, r * 0.1, -0.6, 0, Math.PI * 2); g.fill();
}
function buildSprites() {
    for (const v of [0, 1, 2]) {
        for (const t of ['gold_s', 'gold_m', 'gold_l']) {
            const r = S.TYPES[t].r;
            sprite(t + v, r * 2 + 6, g => nugget(g, r, v + r, '#fff6a8', '#f2c200', '#9c6b00'));
        }
        for (const t of ['rock_s', 'rock_l']) {
            const r = S.TYPES[t].r;
            sprite(t + v, r * 2 + 6, g => {
                nugget(g, r, v * 3 + r, '#c9c4bd', '#8d8780', '#4a4642');
                g.strokeStyle = 'rgba(40,40,40,.35)'; g.beginPath(); g.moveTo(-r * 0.3, r * 0.1); g.lineTo(r * 0.2, r * 0.35); g.stroke();
            });
        }
    }
    sprite('diamond', 26, g => {
        g.beginPath(); g.moveTo(0, -10); g.lineTo(9, -3); g.lineTo(0, 11); g.lineTo(-9, -3); g.closePath();
        const grad = g.createLinearGradient(-9, -10, 9, 11);
        grad.addColorStop(0, '#f2ffff'); grad.addColorStop(0.5, '#5ee0ff'); grad.addColorStop(1, '#1d6fd1');
        g.fillStyle = grad; g.fill(); g.strokeStyle = '#0b3b80'; g.lineWidth = 1; g.stroke();
        g.beginPath(); g.moveTo(-9, -3); g.lineTo(9, -3); g.moveTo(-4, -3); g.lineTo(0, 11); g.lineTo(4, -3); g.stroke();
    });
    sprite('bag', 36, g => {
        g.fillStyle = '#b98b4e'; g.strokeStyle = '#5b3d16'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(-6, -11); g.quadraticCurveTo(-15, 2, -12, 10); g.quadraticCurveTo(0, 16, 12, 10); g.quadraticCurveTo(15, 2, 6, -11); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#8a6430'; g.fillRect(-7, -14, 14, 4); g.strokeRect(-7, -14, 14, 4);
        g.fillStyle = '#fff3b0'; g.font = 'bold 13px Tahoma, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 0, 3);
    });
    sprite('tnt', 38, g => {
        g.fillStyle = '#c2271d'; g.strokeStyle = '#4a0e08'; g.lineWidth = 1.5;
        g.beginPath(); g.ellipse(0, 0, 13, 15, 0, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#e8d3a0'; g.fillRect(-13, -3, 26, 7);
        g.fillStyle = '#4a0e08'; g.font = 'bold 7px Tahoma, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TNT', 0, 1);
        g.strokeStyle = '#333'; g.beginPath(); g.moveTo(0, -15); g.quadraticCurveTo(4, -19, 2, -18); g.stroke();
    });
}

// ---------- the mine itself: sky, dirt and strata, redrawn per level ----------
const bg = document.createElement('canvas'); bg.width = W * 2; bg.height = H * 2;
function paintBackground(seed) {
    const g = bg.getContext('2d');
    g.setTransform(2, 0, 0, 2, 0, 0);
    let r = seed >>> 0 || 1;
    const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
    let grad = g.createLinearGradient(0, 0, 0, S.GROUND);
    grad.addColorStop(0, '#4aa3ff'); grad.addColorStop(1, '#bfe6ff');
    g.fillStyle = grad; g.fillRect(0, 0, W, S.GROUND);
    g.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < 4; i++) { const x = rnd() * W, y = 14 + rnd() * 30; g.beginPath(); g.ellipse(x, y, 26, 8, 0, 0, Math.PI * 2); g.ellipse(x + 16, y - 5, 16, 7, 0, 0, Math.PI * 2); g.fill(); }
    grad = g.createLinearGradient(0, S.GROUND, 0, H);
    grad.addColorStop(0, '#b0743a'); grad.addColorStop(0.4, '#8a5428'); grad.addColorStop(1, '#4a2a12');
    g.fillStyle = grad; g.fillRect(0, S.GROUND, W, H - S.GROUND);
    g.fillStyle = '#5fae3a'; g.fillRect(0, S.GROUND - 4, W, 6);
    g.fillStyle = '#3c8a22'; for (let x = 0; x < W; x += 6) g.fillRect(x, S.GROUND - 6 - (rnd() * 3 | 0), 2, 4);
    for (let i = 0; i < 4; i++) {
        const y = 170 + i * 75 + rnd() * 20;
        g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 6; g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= W; x += 40) g.lineTo(x, y + Math.sin(x / 70 + i) * 7);
        g.stroke();
    }
    for (let i = 0; i < 260; i++) {
        const x = rnd() * W, y = S.GROUND + 8 + rnd() * (H - S.GROUND);
        g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.18)' : 'rgba(255,220,170,.14)';
        g.fillRect(x, y, 1 + rnd() * 3, 1 + rnd() * 2);
    }
    // the winch platform
    g.fillStyle = '#6b4a2a'; g.fillRect(PX - 70, S.GROUND - 10, 140, 8);
    g.fillStyle = '#4b2f17'; g.fillRect(PX - 64, S.GROUND - 34, 6, 26); g.fillRect(PX + 58, S.GROUND - 34, 6, 26);
}

// ---------- effects pools (no per-frame allocation) ----------
const floats = Array.from({ length: 10 }, () => ({ life: 0, x: 0, y: 0, text: '', color: '' }));
const parts = Array.from({ length: 80 }, () => ({ life: 0, x: 0, y: 0, vx: 0, vy: 0, c: '' }));
function addFloat(x, y, text, color) {
    const f = floats.find(f => f.life <= 0) || floats[0];
    f.life = 1.4; f.x = x; f.y = y; f.text = text; f.color = color;
}
function burst(x, y, n, colors) {
    for (let i = 0, k = 0; i < parts.length && k < n; i++) {
        const p = parts[i]; if (p.life > 0) continue;
        const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 160;
        p.life = 0.5 + Math.random() * 0.5; p.x = x; p.y = y; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v - 40; p.c = colors[k % colors.length]; k++;
    }
}
let shake = 0;

// ---------- game state ----------
let state = null, mode = 'title', paused = false, timeScale = 1, lastTick = -1;
let now = 0, last = 0, acc = 0;
function newGame(seed) {
    state = S.create(seed == null ? (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0 : seed);
    for (const f of floats) f.life = 0;
    for (const p of parts) p.life = 0;
    paused = false; acc = 0; lastTick = -1;
    paintBackground(state.seed + state.level);
    state.events.length = 0;
    showIntro();
}

// ---------- overlays ----------
const SHOP_ICON = { dynamite: '🧨', strength: '💪', clover: '🍀', book: '📖', polish: '💎' };
const BUFF_NAME = { strength: 'strength drink', clover: 'lucky clover', book: "rock collector's book", polish: 'diamond polish' };
function panel(title, html) {
    overlay.innerHTML = '<div class="panel" role="dialog" aria-label="' + title + '"><div class="bar">' + title + '</div><div class="body">' + html + '</div></div>';
    overlay.hidden = false;
    const primary = overlay.querySelector('.primary');
    if (primary) primary.focus({ preventScroll: true });
}
function hideOverlay() { overlay.hidden = true; overlay.innerHTML = ''; canvas.focus?.({ preventScroll: true }); }
function money(n) { return '$' + n; }
function showTitle() {
    mode = 'title';
    panel('gold claw 98 - how to play',
        '<h2><img src="' + faceSrc('idle') + '" alt="">gold claw 98</h2>' +
        '<p>the claw swings by itself. shoot it at gold and diamonds, reel them in, and make the money goal before the 60 seconds run out.</p>' +
        '<ul><li><kbd>&darr;</kbd> <kbd>space</kbd>, click or tap the mine: shoot the claw</li>' +
        '<li><kbd>&uarr;</kbd>: light a dynamite stick and drop what you are reeling</li>' +
        '<li><kbd>p</kbd> / <kbd>esc</kbd>: pause &middot; <kbd>n</kbd>: done, once the goal is met</li>' +
        '<li>heavy stuff reels slowly. rocks are cheap. tnt blows up its neighbours. moles sometimes carry a diamond.</li>' +
        '<li>between levels the shop sells dynamite, strength drinks, lucky clovers, rock books and diamond polish.</li></ul>' +
        '<p>miss the goal and the run is over. best: level ' + best.level + ', ' + money(best.money) + '.</p>' +
        '<div class="row"><button type="button" class="primary" data-act="start">start digging</button></div>');
}
function showIntro() {
    mode = 'intro';
    const s = state;
    const buffs = Object.keys(s.buffs).filter(k => s.buffs[k]).map(k => SHOP_ICON[k] + ' ' + BUFF_NAME[k]).join(', ');
    panel('level ' + s.level,
        '<h2>level ' + s.level + ': ' + s.template + '</h2>' +
        '<p>your goal is <b>' + money(s.goal) + '</b>. you have ' + money(s.money) + '.</p>' +
        (buffs ? '<p>this level: ' + buffs + '</p>' : '') +
        (s.dynamite ? '<p>dynamite in the pocket: ' + s.dynamite + '</p>' : '') +
        '<div class="row"><button type="button" class="primary" data-act="go">go!</button></div>');
    setStatus('level ' + s.level + ' · goal ' + money(s.goal));
}
function showCleared() {
    mode = 'cleared';
    const s = state;
    record(s);
    panel('goal reached',
        '<h2><img src="' + faceSrc('happy') + '" alt="">nice haul!</h2>' +
        '<p>level ' + s.level + ' done with ' + money(s.money) + ' (goal ' + money(s.goal) + ').</p>' +
        '<p>next goal: ' + money(S.goalFor(s.level + 1)) + '.</p>' +
        '<div class="row"><button type="button" class="primary" data-act="shop">to the shop</button></div>');
    beep(523, 0.12, 'square', 0.05); setTimeout(() => beep(784, 0.2, 'square', 0.05), 120);
}
function showShop() {
    mode = 'shop';
    const s = state;
    const rows = s.offers.map((o, i) => '<button type="button" class="offer" data-buy="' + i + '" aria-pressed="' + o.sold + '"' + (o.sold || o.price > s.money ? ' disabled' : '') + '>' +
        '<i aria-hidden="true">' + SHOP_ICON[o.kind] + '</i><span><b>' + (i + 1) + '. ' + S.SHOP[o.kind].name + '</b><small>' + S.SHOP[o.kind].desc + '</small></span>' +
        '<em>' + (o.sold ? 'sold' : money(o.price)) + '</em></button>').join('');
    panel('the shop',
        '<h2>the shop</h2><p>you have <b>' + money(s.money) + '</b>. next goal ' + money(S.goalFor(s.level + 1)) + '. press 1-' + s.offers.length + ' to buy.</p>' +
        '<div class="offers">' + rows + '</div>' +
        '<div class="row"><button type="button" class="primary" data-act="next">next level</button></div>');
}
function showOver() {
    mode = 'over';
    const s = state;
    const fresh = record(s);
    panel('game over',
        '<h2><img src="' + faceSrc('sad') + '" alt="">the boss is not impressed</h2>' +
        '<p>you needed ' + money(s.goal) + ' and brought ' + money(s.money) + ' on level ' + s.level + '.</p>' +
        '<p>' + s.stats.grabs + ' grabs, ' + s.stats.diamonds + ' diamonds, ' + s.stats.booms + ' explosions.' + (fresh ? ' <b>new record!</b>' : '') + '</p>' +
        '<p>best: level ' + best.level + ', ' + money(best.money) + '.</p>' +
        '<div class="row"><button type="button" data-act="title">how to play</button><button type="button" class="primary" data-act="again">try again</button></div>');
    beep(220, 0.3, 'sawtooth', 0.05, 90);
}
function showPause() {
    panel('paused', '<h2>paused</h2><p>the claw will wait. level ' + state.level + ', ' + Math.ceil(state.time) + 's left.</p>' +
        '<div class="row"><button type="button" data-act="quit">quit run</button><button type="button" class="primary" data-act="resume">resume</button></div>');
}
function pause() {
    if (mode !== 'play' || paused) return;
    paused = true; showPause(); $('btn-pause').textContent = 'resume';
}
function resume() {
    if (!paused) return;
    paused = false; hideOverlay(); $('btn-pause').textContent = 'pause'; last = performance.now(); acc = 0;
}
function act(what) {
    if (what === 'start' || what === 'again') { beep(440, 0.06); newGame(); }
    else if (what === 'go') { mode = 'play'; hideOverlay(); last = performance.now(); acc = 0; }
    else if (what === 'shop') { S.openShop(state); state.events.length = 0; showShop(); }
    else if (what === 'next') { S.nextLevel(state); paintBackground(state.seed + state.level); state.events.length = 0; showIntro(); }
    else if (what === 'resume') resume();
    else if (what === 'quit') { paused = false; $('btn-pause').textContent = 'pause'; showTitle(); }
    else if (what === 'title') showTitle();
}
overlay.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.buy != null) buyOffer(+b.dataset.buy);
    else act(b.dataset.act);
});
function buyOffer(i) {
    if (mode !== 'shop') return;
    if (S.buy(state, i)) { beep(988, 0.08, 'square', 0.05); setStatus('bought ' + S.SHOP[state.offers[i].kind].name); }
    else beep(140, 0.1, 'square', 0.04);
    state.events.length = 0;
    showShop();
}

// ---------- input ----------
function shoot() { if (mode === 'play' && !paused && S.fire(state)) beep(300, 0.05, 'square', 0.03); }
function useDynamite() { if (mode === 'play' && !paused) S.blast(state); }
function done() { if (mode === 'play' && !paused) S.finish(state); }
addEventListener('keydown', e => {
    const k = e.key;
    if (mode === 'play' && !paused) {
        if (k === 'ArrowDown' || k === ' ' || k === 's' || k === 'S') { shoot(); e.preventDefault(); return; }
        if (k === 'ArrowUp' || k === 'w' || k === 'W') { useDynamite(); e.preventDefault(); return; }
        if (k === 'n' || k === 'N') { done(); return; }
        if (k === 'p' || k === 'P' || k === 'Escape') { pause(); e.preventDefault(); return; }
        return;
    }
    if (paused && (k === 'p' || k === 'P' || k === 'Escape')) { resume(); e.preventDefault(); return; }
    if (mode === 'shop' && k >= '1' && k <= '9') { buyOffer(+k - 1); return; }
    if ((k === 'Enter' || k === ' ') && !overlay.hidden) {
        const focused = document.activeElement;
        if (focused && focused.tagName === 'BUTTON' && overlay.contains(focused)) return; // the button handles it
        overlay.querySelector('.primary')?.click(); e.preventDefault();
    }
});
canvas.addEventListener('pointerdown', e => { if (mode === 'play' && !paused) { e.preventDefault(); shoot(); } });
$('btn-shoot').addEventListener('click', shoot);
$('btn-blast').addEventListener('click', useDynamite);
$('btn-pause').addEventListener('click', () => (paused ? resume() : pause()));
$('btn-done').addEventListener('click', done);
// the desktop minimises the window: hold still
addEventListener('message', e => { if (e.origin === location.origin && e.data && e.data.type === 'game-pause') pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- events from the rules ----------
const LABEL = { gold_s: '#ffe066', gold_m: '#ffe066', gold_l: '#ffe066', diamond: '#9ef0ff', rock_s: '#ddd', rock_l: '#ddd', bag: '#ffd28a', mole: '#ffc0d0' };
let status = '';
function setStatus(t) { if (t !== status) { status = t; $('status').textContent = t; } }
function drain() {
    const ev = state.events;
    for (let i = 0; i < ev.length; i++) {
        const e = ev[i];
        if (e.k === 'grab') beep(e.type.startsWith('rock') ? 160 : 660, 0.06, 'triangle', 0.05);
        else if (e.k === 'bank') {
            const t = e.text || ('+' + money(e.value));
            addFloat(PX + 40, PY - 20, t, LABEL[e.type] || '#fff');
            setStatus(t + ' · ' + S.TYPES[e.type].name);
            if (e.value >= 300 || e.text) { setFace('happy', 1200); beep(880, 0.08, 'square', 0.05); beep(1320, 0.15, 'square', 0.04); }
            else if (e.type.startsWith('rock')) { setFace('meh', 1000); beep(200, 0.12, 'triangle', 0.05); }
            else beep(700, 0.08, 'square', 0.04);
        } else if (e.k === 'boom' || e.k === 'blast') {
            burst(e.x, e.y, e.k === 'boom' ? 26 : 16, ['#ffef80', '#ff9a2e', '#d4321c', '#555']);
            shake = Math.max(shake, e.k === 'boom' ? 8 : 5); setFace('boom', 1000);
            beep(90, 0.35, 'sawtooth', 0.07, 40);
            if (e.k === 'blast') setStatus('kaboom. hook is free');
        } else if (e.k === 'cleared') { mode = 'cleared'; }
        else if (e.k === 'over') { mode = 'over'; }
    }
    ev.length = 0;
    if (mode === 'cleared' && overlay.hidden) showCleared();
    if (mode === 'over' && overlay.hidden) showOver();
}

// ---------- HUD (only touch the DOM when a number changes) ----------
const hudCache = {};
function hud(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function cls(el, c, on) { if (el.classList.contains(c) !== on) el.classList.toggle(c, on); }
function updateHud() {
    const s = state;
    hud('money', money(s ? s.money : 0));
    hud('goal', money(s ? s.goal : S.goalFor(1)));
    hud('level', String(s ? s.level : 1));
    const t = s ? Math.ceil(s.time) : 60;
    if (s && mode === 'play' && !paused && t <= 5 && t !== lastTick && t > 0) beep(1000, 0.04, 'square', 0.03);
    lastTick = t;
    hud('time', String(t));
    hud('tnt', String(s ? s.dynamite : 0));
    cls($('goal-field'), 'met', !!s && s.money >= s.goal);
    cls($('time-field'), 'low', !!s && t <= 10);
    const playing = mode === 'play' && !paused;
    const shootOff = !playing || s.claw.mode !== 'swing', blastOff = !playing || !s.dynamite || !s.claw.item, doneOff = !playing || s.money < s.goal;
    if ($('btn-shoot').disabled !== shootOff) $('btn-shoot').disabled = shootOff;
    if ($('btn-blast').disabled !== blastOff) $('btn-blast').disabled = blastOff;
    if ($('btn-done').disabled !== doneOff) $('btn-done').disabled = doneOff;
    const pauseOff = mode !== 'play';
    if ($('btn-pause').disabled !== pauseOff) $('btn-pause').disabled = pauseOff;
}

// ---------- drawing ----------
let scale = 1;
function fit() {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    if (!sw) return;
    const w = Math.max(160, Math.floor(Math.min(sw, sh ? sh * W / H : sw)));
    const h = Math.floor(w * H / W);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.min(1280, Math.round(w * dpr));
    if (canvas.width !== bw) { canvas.width = bw; canvas.height = Math.round(bw * H / W); }
    scale = canvas.width / W;
}
function drawItem(it, x, y) {
    if (it.type === 'mole') return drawMole(it, x, y);
    const key = it.type === 'diamond' || it.type === 'bag' || it.type === 'tnt' ? it.type : it.type + (it.id % 3);
    const sp = SPR[key];
    ctx.drawImage(sp.c, x - sp.size / 2, y - sp.size / 2, sp.size, sp.size);
    if (it.type === 'diamond' && ((now / 300 + it.id) % 4) < 0.6) {
        ctx.fillStyle = '#fff'; ctx.fillRect(x + 3, y - 9, 2, 6); ctx.fillRect(x + 1, y - 7, 6, 2);
    }
}
function drawMole(it, x, y) {
    const dir = it.vx < 0 ? -1 : 1, step = Math.sin(now / 90 + it.id) * 2;
    ctx.fillStyle = '#6d5a4b';
    ctx.beginPath(); ctx.ellipse(x, y, 14, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4b3b2f'; ctx.fillRect(x - 9, y + 7 + step, 4, 4); ctx.fillRect(x + 5, y + 7 - step, 4, 4);
    ctx.fillStyle = '#f2a0b0'; ctx.beginPath(); ctx.arc(x + dir * 14, y - 1, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000'; ctx.fillRect(x + dir * 7 - 1, y - 5, 2, 2);
    if (it.diamond) { const sp = SPR.diamond; ctx.drawImage(sp.c, x + dir * 10 - 8, y + 1, 16, 16); }
}
function drawMiner(s) {
    const c = s ? s.claw : null, reeling = c && c.mode === 'reel';
    // winch drum turning while the rope comes back in
    const spin = c ? c.len / 8 : 0;
    ctx.save(); ctx.translate(PX, PY - 14);
    ctx.fillStyle = '#7b5530'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a2410'; ctx.lineWidth = 2; ctx.rotate(spin);
    ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(11, 0); ctx.moveTo(0, -11); ctx.lineTo(0, 11); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#4b2f17'; ctx.fillRect(PX - 64, PY - 18, 128, 5);
    // the miner: a cursed emoji in a hard hat, straining when the load is heavy
    const k = now < faceUntil ? face : (reeling && c.item && c.item.pull < 120 ? 'meh' : 'idle');
    const img = FACES[k], fx = PX + 46, bob = reeling ? Math.sin(now / 70) * 1.5 : 0, fy = PY - 58 + bob;
    ctx.fillStyle = '#2f5aa8'; ctx.fillRect(fx - 10, fy + 28, 20, 18);
    if (img.complete && img.naturalWidth) ctx.drawImage(img, fx - 17, fy, 34, 34);
    else { ctx.fillStyle = '#ffcf3a'; ctx.beginPath(); ctx.arc(fx, fy + 17, 16, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.ellipse(fx, fy + 3, 17, 7, 0, Math.PI, 0); ctx.fill();
    ctx.fillRect(fx - 20, fy + 2, 40, 3);
}
function drawClaw(s) {
    const c = s.claw, a = c.angle;
    const tx = PX + Math.sin(a) * c.len, ty = PY + Math.cos(a) * c.len;
    ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(PX, PY - 14); ctx.lineTo(tx, ty); ctx.stroke();
    if (c.item) {
        const r = c.item.r * 0.85;
        drawItem(c.item, tx + Math.sin(a) * r, ty + Math.cos(a) * r);
    }
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(-a);
    const open = c.item ? 0.25 : c.mode === 'shoot' ? 0.9 : 0.6;
    ctx.strokeStyle = '#5a5f66'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.fillStyle = '#8a9099'; ctx.fillRect(-6, -4, 12, 6);
    for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(side * 5, 1);
        ctx.quadraticCurveTo(side * (6 + 9 * open), 9, side * (2 + 4 * open), 15);
        ctx.stroke();
    }
    ctx.restore();
}
function draw(dt) {
    const s = state;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake = Math.max(0, shake - dt * 30); }
    ctx.drawImage(bg, 0, 0, W, H);
    if (s) {
        // aim hint: a faint guide line while swinging
        if (s.claw.mode === 'swing' && mode === 'play') {
            ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(PX, PY); ctx.lineTo(PX + Math.sin(s.claw.angle) * 600, PY + Math.cos(s.claw.angle) * 600); ctx.stroke();
            ctx.setLineDash([]);
        }
        for (const it of s.items) drawItem(it, it.x, it.y);
        drawMiner(s);
        drawClaw(s);
    } else drawMiner(null);
    for (const p of parts) {
        if (p.life <= 0) continue;
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt;
        ctx.fillStyle = p.c; ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.font = 'bold 18px Tahoma, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const f of floats) {
        if (f.life <= 0) continue;
        f.life -= dt; f.y -= 22 * dt;
        ctx.globalAlpha = Math.min(1, f.life * 1.5);
        ctx.fillStyle = '#000'; ctx.fillText(f.text, f.x + 1, f.y + 1);
        ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
        ctx.globalAlpha = 1;
    }
    if (s && mode === 'play' && s.time <= 10 && s.time > 0 && (now / 250 | 0) % 2) {
        ctx.fillStyle = 'rgba(200,0,0,.12)'; ctx.fillRect(0, 0, W, H);
    }
}

function frame(t) {
    requestAnimationFrame(frame);
    now = t;
    const dt = Math.min(0.1, Math.max(0, (t - last) / 1000)); last = t;
    if (state && mode === 'play' && !paused) {
        acc += dt * timeScale;
        let guard = 0;
        while (acc >= S.DT && guard++ < 2400) {
            acc -= S.DT; S.tick(state);
            if (state.phase !== 'play') { acc = 0; break; }
        }
        drain();
    }
    updateHud();
    draw(dt);
}

buildSprites();
paintBackground(98);
showBest();
if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(stage); else addEventListener('resize', fit);
fit();
showTitle();
requestAnimationFrame(t => { last = t; frame(t); });

// a small hook for the tests: deterministic setup, the clock turned up
window.GOLDCLAW_ENGINE = {
    sim: S,
    get state() { return state; },
    ui: () => ({ mode, paused, overlay: !overlay.hidden, timeScale, best: { ...best } }),
    newGame(seed) { newGame(seed); },
    setTimeScale(x) { timeScale = Math.max(0, Math.min(50, Number(x) || 1)); },
    fastForward(seconds) {
        if (!state || mode !== 'play') return false;
        for (let i = Math.round(seconds / S.DT); i > 0 && state.phase === 'play'; i--) S.tick(state);
        drain();
        return true;
    }
};
})();
