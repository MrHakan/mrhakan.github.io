// ===================================================================
// popz 98 — the window, the keys and thumbs, the picture and the wire
//
// popz-sim.js is the rules; this is what sits between them and a person.
// The sim steps at a fixed 60 a second whatever the screen does; the picture
// is drawn as often as the screen wants.
//
// Alone, two at one keyboard, or one with a bot buddy. Online (two people,
// brought together by games/netplay.js) the host runs the rules: a guest
// sends what it presses, the host decides every hit and sends the game back
// twenty times a second (six over the relays). Between those the guest
// carries the bubbles on itself, so they fly smoothly; it never splits or
// kills anything on its own. Somebody who walks out is replaced by a bot.
// ===================================================================
(function () {
    'use strict';

    const S = window.POPZ_SIM;
    if (!S) { console.warn('[popz] popz-sim.js is missing'); return; }
    const { min, max, floor, round, abs, sin, cos, PI, sqrt } = Math;
    const FW = S.W, FH = S.H, HUD = 40, VH = FH + HUD;
    const DT = S.DT;
    const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
    const BEST_KEY = 'mrhakan98-popz-best', PREFS_KEY = 'mrhakan98-popz-prefs';
    const COLORS = ['#1848c8', '#d02828'];
    const STARTS = [1, 5, 10, 15, 20];

    function ensureCss() {
        if (document.getElementById('pz-css')) return;
        const l = document.createElement('link');
        l.id = 'pz-css'; l.rel = 'stylesheet'; l.href = 'games/popz/popz.css';
        document.head.appendChild(l);
    }
    const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
    function prefs() {
        const p = readJson(PREFS_KEY) || {};
        return { mode: ['solo', 'two', 'buddy'].includes(p.mode) ? p.mode : 'solo', start: STARTS.includes(p.start) ? p.start : 1 };
    }
    function loadBest() {
        const b = readJson(BEST_KEY) || {};
        const n = v => (Number.isFinite(+v) && +v >= 0 ? floor(+v) : 0);
        return { score: n(b.score), level: max(1, min(S.LEVELS.length, n(b.level) || 1)), games: n(b.games), wins: n(b.wins) };
    }

    // ===============================================================
    // sound: synthesized, and quiet when the site is
    // ===============================================================
    let actx = null;
    function soundOn() {
        try { if (localStorage.getItem('sound-enabled') === 'false') return false; } catch (e) { }
        return typeof soundEnabled === 'undefined' ? true : !!soundEnabled;
    }
    function tone(freq, dur, o) {
        if (!soundOn()) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
            if (!actx) actx = new AC();
            if (actx.state === 'suspended') actx.resume().catch(() => { });
            o = o || {};
            const t0 = actx.currentTime + (o.delay || 0);
            const osc = actx.createOscillator(), g = actx.createGain();
            osc.type = o.type || 'square';
            osc.frequency.setValueAtTime(max(1, freq), t0);
            if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(max(1, o.slideTo), t0 + dur);
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(o.gain || 0.035, t0 + min(0.01, dur / 3));
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(g); g.connect(actx.destination);
            osc.start(t0); osc.stop(t0 + dur + 0.02);
        } catch (e) { }
    }
    const sfx = {
        fire: () => tone(900, 0.08, { slideTo: 1600, type: 'triangle', gain: 0.02 }),
        pop: size => tone(500 + (3 - size) * 220, 0.09, { slideTo: 140, gain: 0.04 }),
        glass: () => { tone(2200, 0.06, { type: 'triangle' }); tone(1700, 0.08, { type: 'triangle', delay: 0.04 }); },
        item: () => { tone(660, 0.07, { type: 'triangle' }); tone(990, 0.1, { type: 'triangle', delay: 0.07 }); },
        boom: () => tone(160, 0.4, { slideTo: 40, type: 'sawtooth', gain: 0.05 }),
        die: () => tone(440, 0.5, { slideTo: 80, type: 'sawtooth', gain: 0.04 }),
        shield: () => tone(300, 0.15, { slideTo: 600, type: 'triangle' }),
        go: () => tone(880, 0.1),
        clear: () => { tone(660, 0.1); tone(880, 0.1, { delay: 0.1 }); tone(1320, 0.25, { delay: 0.2 }); },
        over: () => tone(330, 0.6, { slideTo: 90, type: 'sawtooth', gain: 0.04 })
    };

    // ===============================================================
    // the window
    // ===============================================================
    let winRef = null, root = null, stage = null, cv = null, ctx = null, over = null, pad = null, note = null;
    let G = null, screen = 'menu', raf = 0, testClock = 1, attract = null, panel = '';
    const IS_TOUCH = () => { try { return !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } };
    function ensureWindow() {
        ensureCss();
        if (winRef && winRef.win && document.getElementById(winRef.win.id)) return winRef;
        const vw = typeof viewportWidth === 'function' ? viewportWidth() : 1000;
        winRef = createAppWindow('popz 98', { icon: 'celebration', width: min(720, vw - 20) });
        winRef.body.classList.add('pz-body');
        winRef.win.classList.add('pz-window');
        if (document.documentElement.clientHeight < 760) winRef.win.style.top = '0px';
        winRef.win._cleanup = () => {
            leaveOnline();
            stopLoop();
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', clearKeys);
            window.removeEventListener('resize', onResize);
            document.removeEventListener('visibilitychange', onVisibility);
            G = null; attract = null; root = null; stage = null; cv = null; ctx = null; over = null; pad = null; note = null; winRef = null; bgCache = null; sprites = null;
        };
        root = winRef.body;
        root.innerHTML = `
            <div class="pz-stage" id="pz-stage">
                <canvas class="pz-canvas" id="pz-canvas" aria-label="the popz playfield"></canvas>
                <div class="pz-note" id="pz-note" hidden></div>
                <div class="pz-over" id="pz-over"></div>
            </div>
            <div class="pz-pad" id="pz-pad" hidden>
                <button data-pad="l" aria-label="walk left">&#9664;</button>
                <button class="pz-fire" data-pad="f" aria-label="fire">fire</button>
                <button data-pad="r" aria-label="walk right">&#9654;</button>
            </div>`;
        stage = root.querySelector('#pz-stage');
        cv = root.querySelector('#pz-canvas');
        ctx = cv.getContext('2d');
        over = root.querySelector('#pz-over');
        pad = root.querySelector('#pz-pad');
        note = root.querySelector('#pz-note');
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', clearKeys);
        window.addEventListener('resize', onResize);
        document.addEventListener('visibilitychange', onVisibility);
        over.addEventListener('click', onOverClick);
        over.addEventListener('change', onOverChange);
        bindPad();
        bindCanvas();
        startLoop();
        return winRef;
    }
    function onResize() { fitAt = 0; }
    function onVisibility() { if (document.hidden && G && !G.online && !G.paused && screen === 'play') pause(true); }
    function onTop() {
        if (!winRef || !winRef.win || winRef.win.style.display === 'none') return false;
        const z = +winRef.win.style.zIndex || 0;
        return ![...document.querySelectorAll('.app-window, .ie-window')].some(w => w !== winRef.win && w.style.display !== 'none' && (+w.style.zIndex || 0) > z);
    }

    // the canvas fills the window's width at the field's shape, in the screen's own pixels
    let fitAt = 0, scale = 1, dpr = 1;
    function fit(force) {
        if (!stage || !root) return;
        const now = performance.now();
        if (!force && fitAt && now - fitAt < 250) return;
        fitAt = now;
        const w = max(240, floor(root.clientWidth || 640));
        const h = round(w * VH / FW);
        const panelOn = over.classList.contains('on');
        const minH = panelOn ? min(460, max(h, 400)) : h;
        if (stage.style.height !== max(h, minH) + 'px') stage.style.height = max(h, minH) + 'px';
        dpr = min(2, window.devicePixelRatio || 1);
        const bw = round(w * dpr), bh = round(h * dpr);
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; bgCache = null; sprites = null; }
        cv.style.height = h + 'px';
        scale = bw / FW;
        const touch = IS_TOUCH() || w < 560;
        pad.hidden = !(touch && screen === 'play');
    }

    // ===============================================================
    // a game
    // ===============================================================
    // seats: [{ name, kind: 'local' | 'remote' | 'bot', id?, keys? }]
    function makeGame(o) {
        const s = S.newGame({ seed: o.seed, level: o.level, players: o.seats.length, puppet: !!o.puppet });
        const g = {
            s, seats: o.seats, online: !!o.session, session: o.session || null, isHost: !o.session || !!o.isHost, me: o.me || 0,
            bots: o.seats.map((p, i) => (p.kind === 'bot' ? S.newBot((o.seed + i * 977) >>> 0) : null)),
            acc: 0, last: performance.now(), t: 0, paused: false, ended: false, recorded: false, match: o.match || '', level: o.level || 0,
            presses: o.seats.map(() => 0), target: -1, targetFire: false,
            sentAt: 0, inputAt: 0, sentB: -1, sentF: -1, netEv: [], lastSnap: performance.now(), quiet: false,
            fx: [], shake: 0, flash: 0, lastPh: s.ph, endAt: 0
        };
        return g;
    }
    function startLocal(o) {
        ensureWindow();
        leaveOnline();
        const p = Object.assign(prefs(), o || {});
        writeJson(PREFS_KEY, { mode: p.mode, start: p.start });
        const name = (window.Netplay && Netplay.profile && Netplay.profile().name) || 'you';
        const seats = p.mode === 'two' ? [{ name: 'player 1', kind: 'local', keys: 1 }, { name: 'player 2', kind: 'local', keys: 2 }]
            : p.mode === 'buddy' ? [{ name, kind: 'local', keys: 0 }, { name: 'bot buddy', kind: 'bot' }]
                : [{ name, kind: 'local', keys: 0 }];
        const seed = (o && o.seed) || ((Math.random() * 1e9) >>> 0);
        G = makeGame({ seed, level: p.start - 1, seats });
        G.mode = p.mode;
        attract = null;
        screen = 'play';
        render();
    }

    // ---------------------------------------------------------------
    // the loop
    // ---------------------------------------------------------------
    function startLoop() { if (!raf) { const tick = () => { raf = requestAnimationFrame(tick); frame(); }; raf = requestAnimationFrame(tick); } }
    function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    function frame() {
        if (!root || !document.getElementById('pz-stage')) { stopLoop(); return; }
        fit();
        const now = performance.now();
        const g = screen === 'play' ? G : attract;
        if (!g) { if (screen !== 'play') startAttract(); return; }
        // a minimised window pauses a game nobody else is in
        if (g === G && !g.online && !g.paused && winRef.win.style.display === 'none') pause(true);
        const dt = min(0.1, (now - g.last) / 1000);
        g.last = now;
        g.t += dt;
        if (g === G) refreshLocals(g);
        if (!g.paused) {
            if (g.isHost) hostSteps(g, dt);
            else guestSteps(g, dt);
        }
        readEvents(g);
        tickFx(g, dt);
        draw(g);
        if (g === G) {
            if (g.online) net(g, now);
            noteLevel(g);
            if (S.over(g.s) && !g.ended) gameOver(g);
            if (g.ended && !g.overShown && now > g.endAt) { g.overShown = true; render(); }
        } else if (S.over(g.s) || g.t > 90) { attract = null; }
    }
    function hostSteps(g, dt) {
        const s = g.s;
        g.acc += dt * testClock;
        let n = 0;
        const cap = 8 * testClock;
        while (g.acc >= DT && n++ < cap) {
            g.acc -= DT;
            applyLocals(g);
            for (let i = 0; i < s.players.length; i++) { const b = g.bots[i] || (g.auto && g.auto[i]); if (b) S.think(s, i, b); }
            S.step(s);
            if (g.online && s.ev.length) for (const e of s.ev) if (g.netEv.length < 40) g.netEv.push(e);
            readEvents(g);
            if (S.over(s)) { g.acc = 0; break; }
        }
        if (g.acc > DT * 4) g.acc = DT * 4;
    }
    function guestSteps(g, dt) {
        const s = g.s;
        if (g.quiet) return;
        g.acc += dt;
        let n = 0;
        while (g.acc >= DT && n++ < 8) {
            g.acc -= DT;
            const p = s.players[g.me];
            if (p) p.in.b = g.localB || 0;
            S.step(s);
        }
        s.ev.length = 0;
        if (g.acc > DT * 4) g.acc = DT * 4;
    }
    function applyLocals(g) {
        g.seats.forEach((p, i) => { if (p.kind === 'local') S.input(g.s, i, p.b || 0, g.presses[i]); });
    }
    function pause(on) {
        const g = G;
        if (!g || g.online || g.ended) return;
        g.paused = on === undefined ? !g.paused : !!on;
        g.last = performance.now();
        clearKeys();
        render();
    }

    // ===============================================================
    // input: keys, thumbs, and a click on the floor
    // ===============================================================
    // keys 0: one person, every key; 1: arrows + up/enter; 2: a d + w/space
    const KEYS = {
        1: { l: ['ArrowLeft'], r: ['ArrowRight'], f: ['ArrowUp', 'Enter', 'NumpadEnter', 'Slash'] },
        2: { l: ['KeyA'], r: ['KeyD'], f: ['KeyW', 'Space'] }
    };
    KEYS[0] = { l: KEYS[1].l.concat(KEYS[2].l), r: KEYS[1].r.concat(KEYS[2].r), f: KEYS[1].f.concat(KEYS[2].f, ['KeyZ', 'KeyX']) };
    const held = new Set();
    const padHeld = { l: false, r: false };
    function localSeats(g) { return g.online ? [g.me] : g.seats.map((p, i) => (p.kind === 'local' ? i : -1)).filter(i => i >= 0); }
    function keysOf(g, i) { return g.online ? KEYS[0] : KEYS[g.seats[i].keys] || KEYS[0]; }
    function refreshLocals(g) {
        const mine = localSeats(g);
        mine.forEach((i, k) => {
            const map = keysOf(g, i);
            let l = map.l.some(c => held.has(c)), r = map.r.some(c => held.has(c));
            if (k === 0) {
                l = l || padHeld.l; r = r || padHeld.r;
                if (l || r) g.target = -1;
                else if (g.target >= 0) {
                    const p = g.s.players[i];
                    const d = g.target - (p ? p.x : g.target);
                    if (abs(d) < 3) { g.target = -1; if (g.targetFire) { g.targetFire = false; fire(i); } }
                    else { l = d < 0; r = d > 0; }
                }
            }
            const b = (l && !r ? 1 : 0) | (r && !l ? 2 : 0);
            g.seats[i].b = b;
            if (g.online) g.localB = b;
        });
    }
    function fire(i) {
        const g = G;
        if (!g || screen !== 'play' || g.paused || g.ended) return;
        if (g.online && !g.isHost) {
            g.presses[g.me]++;
            const p = g.s.players[g.me];
            sendInput(g);
            if (p && p.on && g.s.ph === 'play') sfx.fire();
        } else g.presses[g.online ? g.me : i]++;
    }
    function clearKeys() { held.clear(); padHeld.l = padHeld.r = false; if (pad) pad.querySelectorAll('.on').forEach(b => b.classList.remove('on')); }
    function onKey(ev) {
        const tag = (ev.target && ev.target.tagName) || '';
        if (!G || screen !== 'play' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !onTop()) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const g = G, code = ev.code;
        if ((code === 'Escape' || code === 'KeyP') && !g.online && !g.ended) { ev.preventDefault(); pause(); return; }
        if (g.paused || g.ended) return;
        let mine = false;
        for (const i of localSeats(g)) {
            const map = keysOf(g, i);
            if (map.f.includes(code)) { mine = true; if (!ev.repeat) fire(i); break; }
            if (map.l.includes(code) || map.r.includes(code)) mine = true;
        }
        if (!mine) return;
        ev.preventDefault(); ev.stopPropagation();
        held.add(code);
    }
    function onKeyUp(ev) {
        if (!held.has(ev.code)) return;
        held.delete(ev.code);
        if (screen === 'play') ev.preventDefault();
    }
    function bindPad() {
        pad.querySelectorAll('button').forEach(b => {
            const k = b.dataset.pad;
            b.addEventListener('pointerdown', ev => {
                ev.preventDefault();
                try { b.setPointerCapture(ev.pointerId); } catch (e) { }
                b.classList.add('on');
                if (k === 'f') { const g = G; if (g) fire(localSeats(g)[0]); }
                else { padHeld[k] = true; if (G) G.target = -1; }
            }, { passive: false });
            const up = () => { b.classList.remove('on'); if (k !== 'f') padHeld[k] = false; };
            b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
            b.addEventListener('contextmenu', ev => ev.preventDefault());
        });
    }
    // a click or tap on the playfield: walk there and fire
    function bindCanvas() {
        cv.addEventListener('pointerdown', ev => {
            const g = G;
            if (!g || screen !== 'play' || g.paused || g.ended) return;
            ev.preventDefault();
            const r = cv.getBoundingClientRect();
            const x = (ev.clientX - r.left) / r.width * FW;
            const i = localSeats(g)[0];
            const p = g.s.players[i];
            if (!p) return;
            if (abs(x - p.x) < 10) { g.target = -1; fire(i); }
            else { g.target = max(S.P_W / 2, min(FW - S.P_W / 2, x)); g.targetFire = true; }
        }, { passive: false });
        cv.addEventListener('contextmenu', ev => { if (screen === 'play') ev.preventDefault(); });
    }

    // ===============================================================
    // events: sounds and bits of bubble
    // ===============================================================
    const BUBBLE_COL = ['#ff4f7a', '#ffb020', '#39c46a', '#3a8cff'];
    function readEvents(g) {
        const s = g.s;
        if (!s.ev.length) return;
        const loud = g === G;
        for (const e of s.ev) playEvent(g, e, loud);
        s.ev.length = 0;
    }
    function playEvent(g, e, loud) {
        switch (e.e) {
            case 'pop': burst(g, e.x, e.y, BUBBLE_COL[e.s] || '#fff', 8 + e.s * 3); if (loud) sfx.pop(e.s); break;
            case 'glass': burst(g, e.x, e.y, '#bff4ff', 14); if (loud) sfx.glass(); break;
            case 'fire': if (loud && (g.isHost || e.i !== g.me)) sfx.fire(); break;
            case 'item': if (loud) { sfx.item(); say(g, itemWords[e.t] || e.t, 1.6); } break;
            case 'boom': g.flash = 0.4; g.shake = 0.4; if (loud) sfx.boom(); break;
            case 'shield': if (loud) sfx.shield(); break;
            case 'die': g.shake = 0.5; burst(g, e.x, FH - 16, COLORS[e.i] || '#fff', 18); if (loud) sfx.die(); break;
            case 'go': if (loud) sfx.go(); break;
            case 'clear': if (loud) sfx.clear(); break;
            case 'over': if (loud) sfx.over(); break;
            case 'win': if (loud) sfx.clear(); break;
        }
    }
    const itemWords = { double: 'double rope!', sticky: 'sticky rope!', shield: 'shield!', freeze: 'freeze!', dynamite: 'dynamite!', life: 'extra life!' };
    // a fixed pool of particles: no garbage while bubbles pop
    const FX_MAX = 220;
    function burst(g, x, y, col, n) {
        for (let k = 0; k < n; k++) {
            let f = null;
            for (const q of g.fx) if (q.life <= 0) { f = q; break; }
            if (!f) { if (g.fx.length >= FX_MAX) return; f = {}; g.fx.push(f); }
            const a = (k / n) * PI * 2 + k, sp = 60 + ((k * 37) % 120);
            f.x = x; f.y = y; f.vx = cos(a) * sp; f.vy = sin(a) * sp - 40; f.life = 0.5 + (k % 4) * 0.08; f.col = col;
        }
    }
    function tickFx(g, dt) {
        for (const f of g.fx) {
            if (f.life <= 0) continue;
            f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 500 * dt;
        }
        if (g.shake > 0) g.shake = max(0, g.shake - dt);
        if (g.flash > 0) g.flash = max(0, g.flash - dt);
        if (g.sayT > 0) g.sayT -= dt;
    }
    function say(g, text, sec) { g.sayText = text; g.sayT = sec || 2; }

    // ===============================================================
    // the picture
    // ===============================================================
    const SKIES = [['#7fd0ff', '#e8f8ff'], ['#008080', '#30b0b0'], ['#ff9a5a', '#ffe0a0'], ['#1a1a5a', '#5050a0'], ['#5ab0ff', '#b8e8a0'], ['#8a5cd0', '#f0a0d0']];
    let bgCache = null, bgLv = -1, sprites = null;
    function background(lv) {
        if (bgCache && bgLv === lv) return bgCache;
        bgLv = lv;
        const c = bgCache || document.createElement('canvas');
        c.width = cv.width; c.height = round(FH * scale);
        const x = c.getContext('2d');
        x.setTransform(scale, 0, 0, scale, 0, 0);
        const sky = SKIES[lv % SKIES.length];
        const gr = x.createLinearGradient(0, 0, 0, FH);
        gr.addColorStop(0, sky[0]); gr.addColorStop(1, sky[1]);
        x.fillStyle = gr; x.fillRect(0, 0, FW, FH);
        // soft hills and clouds, different on every level
        x.fillStyle = 'rgba(255,255,255,0.35)';
        for (let k = 0; k < 4; k++) {
            const cx = ((lv * 131 + k * 173) % FW), cy = 40 + ((lv * 53 + k * 71) % 140);
            x.beginPath(); x.ellipse(cx, cy, 46, 14, 0, 0, PI * 2); x.ellipse(cx + 26, cy - 8, 28, 13, 0, 0, PI * 2); x.fill();
        }
        x.fillStyle = 'rgba(0,60,30,0.18)';
        x.beginPath(); x.moveTo(0, FH);
        for (let px = 0; px <= FW; px += 20) x.lineTo(px, FH - 40 - 26 * sin(px / 90 + lv));
        x.lineTo(FW, FH); x.fill();
        // the floor: a grey taskbar
        x.fillStyle = '#c0c0c0'; x.fillRect(0, FH - 3, FW, 3);
        x.fillStyle = '#fff'; x.fillRect(0, FH - 3, FW, 1);
        bgCache = c;
        return c;
    }
    // one shiny sprite per bubble size, drawn once per size of the canvas
    function bubbleSprites() {
        if (sprites) return sprites;
        sprites = S.RADIUS.map((r, sz) => {
            const px = Math.ceil((r * 2 + 4) * scale);
            const c = document.createElement('canvas');
            c.width = c.height = px;
            const x = c.getContext('2d');
            x.scale(scale, scale);
            const m = r + 2;
            const gr = x.createRadialGradient(m - r * 0.35, m - r * 0.4, r * 0.1, m, m, r);
            gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, BUBBLE_COL[sz]); gr.addColorStop(1, shade(BUBBLE_COL[sz]));
            x.fillStyle = gr; x.beginPath(); x.arc(m, m, r, 0, PI * 2); x.fill();
            x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 1; x.stroke();
            if (sz >= 2) {
                // a face, because the desktop has opinions
                x.fillStyle = '#111';
                x.beginPath(); x.arc(m - r * 0.3, m - r * 0.05, r * 0.1, 0, PI * 2); x.arc(m + r * 0.3, m - r * 0.05, r * 0.1, 0, PI * 2); x.fill();
                x.strokeStyle = '#111'; x.lineWidth = max(1, r * 0.08);
                x.beginPath(); x.arc(m, m + r * 0.15, r * 0.35, 0.15 * PI, 0.85 * PI); x.stroke();
            }
            return { c, m };
        });
        return sprites;
    }
    function shade(hex) {
        const n = parseInt(hex.slice(1), 16);
        const f = v => max(0, floor(v * 0.55));
        return 'rgb(' + f(n >> 16) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
    }
    const ITEM_LOOK = { double: ['2x', '#1848c8'], sticky: ['st', '#c07000'], shield: ['sh', '#00a0a0'], freeze: ['fz', '#40a0ff'], dynamite: ['tnt', '#d02020'], life: ['+1', '#20a040'] };
    function draw(g) {
        const s = g.s, c = ctx;
        c.setTransform(1, 0, 0, 1, 0, 0);
        const shx = g.shake > 0 ? (sin(g.t * 80) * 4 * g.shake) * scale : 0;
        c.drawImage(background(s.lv), shx, 0);
        c.setTransform(scale, 0, 0, scale, shx, 0);
        // blocks
        for (const k of s.blocks) {
            if (k.hp <= 0) continue;
            if (k.glass) {
                c.fillStyle = 'rgba(190,240,255,0.55)'; c.fillRect(k.x, k.y, k.w, k.h);
                c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1; c.strokeRect(k.x + 0.5, k.y + 0.5, k.w - 1, k.h - 1);
                c.beginPath(); c.moveTo(k.x + 4, k.y + k.h - 3); c.lineTo(k.x + min(k.w, k.h) - 2, k.y + 3); c.stroke();
            } else {
                c.fillStyle = '#c0c0c0'; c.fillRect(k.x, k.y, k.w, k.h);
                c.fillStyle = '#fff'; c.fillRect(k.x, k.y, k.w, 2); c.fillRect(k.x, k.y, 2, k.h);
                c.fillStyle = '#404040'; c.fillRect(k.x, k.y + k.h - 2, k.w, 2); c.fillRect(k.x + k.w - 2, k.y, 2, k.h);
            }
        }
        // ropes
        for (const p of s.players) for (const r of p.ropes) drawRope(c, r, p.i);
        // items
        for (const it of s.items) {
            if (it.life < 2 && floor(it.life * 8) % 2) continue;
            const look = ITEM_LOOK[it.t] || ['?', '#000'];
            c.fillStyle = look[1]; c.fillRect(it.x - 9, it.y - 7, 18, 14);
            c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(it.x - 9, it.y - 7, 18, 1); c.fillRect(it.x - 9, it.y - 7, 1, 14);
            c.fillStyle = '#fff'; c.font = 'bold 9px Tahoma, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText(look[0], it.x, it.y + 0.5);
        }
        // bubbles
        const sp = bubbleSprites();
        c.setTransform(1, 0, 0, 1, 0, 0);
        for (const b of s.bubbles) {
            const q = sp[b.s];
            c.drawImage(q.c, round((b.x - q.m) * scale + shx), round((b.y - q.m) * scale));
        }
        c.setTransform(scale, 0, 0, scale, shx, 0);
        if (s.freeze > 0) {
            c.strokeStyle = 'rgba(200,240,255,0.9)'; c.lineWidth = 2;
            for (const b of s.bubbles) { c.beginPath(); c.arc(b.x, b.y, S.RADIUS[b.s] + 2, 0, PI * 2); c.stroke(); }
        }
        // players
        for (const p of s.players) if (p.on) drawPlayer(c, p, g);
        // bits of bubble
        for (const f of g.fx) { if (f.life > 0) { c.fillStyle = f.col; c.fillRect(f.x - 2, f.y - 2, 4, 4); } }
        if (g.flash > 0) { c.fillStyle = 'rgba(255,255,255,' + (g.flash * 1.5).toFixed(2) + ')'; c.fillRect(0, 0, FW, FH); }
        c.setTransform(scale, 0, 0, scale, 0, 0);
        hud(c, g);
        banner(c, g);
    }
    function drawRope(c, r, i) {
        const sticky = r.sticky;
        c.strokeStyle = sticky ? '#c07000' : i ? '#802020' : '#203080'; c.lineWidth = 2;
        c.beginPath();
        let y = FH, k = 0;
        c.moveTo(r.x, y);
        while (y > r.tip + 5) { y -= 5; c.lineTo(r.x + (k++ % 2 ? 2.5 : -2.5), y); }
        c.lineTo(r.x, r.tip);
        c.stroke();
        c.fillStyle = sticky ? '#ffb020' : '#e0e0e0';
        c.beginPath(); c.moveTo(r.x, r.tip - 2); c.lineTo(r.x - 5, r.tip + 8); c.lineTo(r.x + 5, r.tip + 8); c.closePath(); c.fill();
        c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();
    }
    function drawPlayer(c, p, g) {
        if (p.inv > 0 && floor(g.t * 12) % 2) return;
        const x = p.x, y = FH, col = COLORS[p.i] || '#000';
        const stride = p.in.b ? sin(x / 7) * 4 : 0;
        c.fillStyle = '#202020';
        c.fillRect(x - 6 + stride * 0.5, y - 10, 4, 10); c.fillRect(x + 2 - stride * 0.5, y - 10, 4, 10);
        c.fillStyle = col; c.fillRect(x - 9, y - 26, 18, 17);
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x - 9, y - 26, 18, 3);
        c.fillStyle = '#f2c79a'; c.beginPath(); c.arc(x, y - 30, 6, 0, PI * 2); c.fill();
        c.fillStyle = col; c.fillRect(x - 7, y - 37, 14, 4); c.fillRect(x + p.face * 3, y - 34, 6 * p.face, 2);
        c.fillStyle = '#000'; c.fillRect(x + p.face * 2 - 1, y - 31, 2, 2);
        if (p.shield) {
            c.strokeStyle = 'rgba(80,240,255,0.9)'; c.lineWidth = 2;
            c.beginPath(); c.arc(x, y - 18, 20 + sin(g.t * 8), 0, PI * 2); c.stroke();
        }
        if (g.s.players.length > 1 || g.online) {
            c.fillStyle = col; c.font = 'bold 9px Tahoma, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
            const nm = (g.seats[p.i] && g.seats[p.i].name) || 'p' + (p.i + 1);
            c.fillText(nm.slice(0, 10), x, y - 40);
        }
    }
    function bevel(c, x, y, w, h, inset) {
        c.fillStyle = '#c0c0c0'; c.fillRect(x, y, w, h);
        c.fillStyle = inset ? '#808080' : '#fff'; c.fillRect(x, y, w, 1); c.fillRect(x, y, 1, h);
        c.fillStyle = inset ? '#fff' : '#404040'; c.fillRect(x, y + h - 1, w, 1); c.fillRect(x + w - 1, y, 1, h);
    }
    function hud(c, g) {
        const s = g.s, y = FH;
        bevel(c, 0, y, FW, HUD, false);
        c.textBaseline = 'middle';
        const n = s.players.length;
        s.players.forEach((p, i) => {
            const x0 = i === 0 ? 6 : FW - 196;
            bevel(c, x0, y + 5, 190, 30, true);
            c.fillStyle = '#fff'; c.fillRect(x0 + 1, y + 6, 188, 28);
            c.fillStyle = COLORS[i]; c.fillRect(x0 + 5, y + 12, 8, 16);
            c.fillStyle = p.out ? '#808080' : '#000'; c.font = 'bold 13px Tahoma, sans-serif'; c.textAlign = 'left';
            c.fillText(String(p.score).padStart(6, '0'), x0 + 18, y + 14);
            c.font = '10px Tahoma, sans-serif';
            const nm = (g.seats[i] && g.seats[i].name) || '';
            c.fillText(nm.slice(0, 12), x0 + 18, y + 27);
            // lives as little hearts
            c.fillStyle = '#d02040';
            for (let k = 0; k < min(p.lives, 9); k++) heart(c, x0 + 100 + (k % 5) * 12, y + (k < 5 ? 14 : 26));
            if (p.weapon !== 'rope' || p.shield) {
                c.fillStyle = '#000'; c.font = 'bold 9px Tahoma, sans-serif'; c.textAlign = 'right';
                c.fillText((p.weapon !== 'rope' ? ITEM_LOOK[p.weapon][0] : '') + (p.shield ? ' sh' : ''), x0 + 186, y + 27);
            }
        });
        // the middle: level and the clock
        const mx = n > 1 ? 204 : 204, mw = n > 1 ? FW - 408 : FW - 210;
        c.fillStyle = '#000'; c.textAlign = 'center'; c.font = 'bold 11px Tahoma, sans-serif';
        c.fillText('level ' + (s.lv + 1) + ' · ' + S.LEVELS[s.lv].name, mx + mw / 2, y + 13);
        const L = S.LEVELS[s.lv];
        bevel(c, mx + 8, y + 23, mw - 16, 11, true);
        const frac = max(0, min(1, s.time / L.time));
        c.fillStyle = frac < 0.2 ? '#d02020' : s.freeze > 0 ? '#40a0ff' : '#000080';
        c.fillRect(mx + 10, y + 25, (mw - 20) * frac, 7);
    }
    function heart(c, x, y) {
        c.beginPath(); c.moveTo(x, y + 4); c.lineTo(x - 4.5, y - 0.5); c.arc(x - 2.2, y - 1.5, 2.4, PI * 0.8, PI * 1.95); c.arc(x + 2.2, y - 1.5, 2.4, PI * 1.05, PI * 0.2); c.closePath(); c.fill();
    }
    function banner(c, g) {
        const s = g.s;
        let big = '', small = '';
        if (g === attract) { return; }
        if (s.ph === 'ready') { big = 'level ' + (s.lv + 1); small = S.LEVELS[s.lv].name + ' · get ready'; }
        else if (s.ph === 'dead') { big = s.why === 'time' ? "time's up" : 'pop goes you'; small = s.players.some(p => p.lives > 0) ? 'try that level again' : ''; }
        else if (s.ph === 'clear') { big = 'level clear!'; small = 'time bonus +' + (s.bonus || 0); }
        else if (s.ph === 'over') { big = 'game over'; }
        else if (s.ph === 'win') { big = 'every bubble popped!'; }
        else if (g.paused) { big = 'paused'; small = 'p or esc to go on'; }
        if (g.paused && !big) { big = 'paused'; }
        if (big) {
            c.font = 'bold 26px Tahoma, sans-serif';
            const w = max(c.measureText(big).width, small ? (c.font = '12px Tahoma, sans-serif', c.measureText(small).width) : 0) + 40;
            const bx = FW / 2 - w / 2, by = 130;
            c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(bx + 4, by + 4, w, small ? 70 : 54);
            bevel(c, bx, by, w, small ? 70 : 54, false);
            const gr = c.createLinearGradient(bx, 0, bx + w, 0); gr.addColorStop(0, '#000080'); gr.addColorStop(1, '#1084d0');
            c.fillStyle = gr; c.fillRect(bx + 3, by + 3, w - 6, 8);
            c.fillStyle = '#000'; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.font = 'bold 26px Tahoma, sans-serif'; c.fillText(big, FW / 2, by + 32);
            if (small) { c.font = '12px Tahoma, sans-serif'; c.fillText(small, FW / 2, by + 56); }
        } else if (g.sayT > 0 && g.sayText) {
            c.font = 'bold 16px Tahoma, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillStyle = '#000'; c.fillText(g.sayText, FW / 2 + 1, 41);
            c.fillStyle = '#fff'; c.fillText(g.sayText, FW / 2, 40);
        }
    }

    // ===============================================================
    // the end of a game
    // ===============================================================
    function achieve(id) { try { if (typeof unlockAchievement === 'function') unlockAchievement(id); } catch (e) { } }
    function gameOver(g) {
        g.ended = true;
        g.endAt = performance.now() + 1400;
        if (g.recorded) return;
        g.recorded = true;
        const b = loadBest();
        const score = g.online ? (g.s.players[g.me] || {}).score || 0 : S.total(g.s);
        g.newBest = score > b.score;
        writeJson(BEST_KEY, { score: max(b.score, score), level: max(b.level, g.s.lv + 1), games: b.games + 1, wins: b.wins + (g.s.ph === 'win' ? 1 : 0) });
        if (g.s.ph === 'win') achieve('popz_win');
    }
    // the furthest level reached also counts while playing, so a later start unlocks
    function noteLevel(g) {
        if (!g || g.noted === g.s.lv) return;
        g.noted = g.s.lv;
        const b = loadBest();
        if (g.s.lv + 1 > b.level) writeJson(BEST_KEY, Object.assign(b, { level: g.s.lv + 1 }));
        if (g.s.lv + 1 >= 10) achieve('popz_10');
    }

    // ===============================================================
    // the wire
    // ===============================================================
    let session = null, offs = [], finished = new Set();
    const onRelays = () => !!(session && session.transport && session.transport.kind === 'bus');
    function leaveOnline() {
        offs.forEach(off => { try { off(); } catch (e) { } }); offs = [];
        if (session && session.alive) session.leave();
        session = null;
        if (G && G.online) G = null;
    }
    function net(g, now) {
        if (g.isHost) {
            if (now - g.sentAt >= 1000 / (onRelays() ? 6 : 20) - 4) { g.sentAt = now; sendSnapshot(g); }
        } else {
            const changed = g.localB !== g.sentB;
            if (changed || now - g.inputAt > (onRelays() ? 500 : 250)) sendInput(g);
        }
    }
    function sendSnapshot(g, to) {
        if (!session || !session.alive) return;
        const d = S.snapshot(g.s);
        d.mt = g.match;
        d.E = g.netEv.splice(0, g.netEv.length).map(e => [e.e, e.x | 0, e.y | 0, e.s | 0, e.i | 0, typeof e.t === 'string' ? e.t : '']);
        session.send('popz:s', d, to);
    }
    function sendInput(g) {
        if (!session || !session.alive) return;
        g.sentB = g.localB || 0; g.sentF = g.presses[g.me]; g.inputAt = performance.now();
        session.sendToHost('popz:i', { mt: g.match, b: g.sentB, f: g.sentF });
    }
    const EV_KINDS = ['pop', 'glass', 'fire', 'item', 'boom', 'shield', 'die', 'go', 'clear', 'over', 'win'];
    function onSnapshot(g, d) {
        if (G !== g || !d || typeof d !== 'object' || d.mt !== g.match || !Number.isInteger(d.k)) return;
        if (g.tick0 !== undefined && d.k < g.tick0) return;
        const me = g.s.players[g.me], predX = me ? me.x : 0;
        if (!S.applySnapshot(g.s, d)) return;
        g.tick0 = d.k;
        g.lastSnap = performance.now();
        if (g.quiet) { g.quiet = false; showNote(''); }
        // our own player: where we walked it, pulled towards where the host has it
        if (me && me.on && g.s.ph !== 'ready') me.x = predX + (me.x - predX) * 0.35;
        g.acc = 0;
        if (Array.isArray(d.E)) for (const e of d.E.slice(0, 40)) {
            if (!Array.isArray(e) || !EV_KINDS.includes(e[0])) continue;
            playEvent(g, { e: e[0], x: +e[1] || 0, y: +e[2] || 0, s: min(3, max(0, e[3] | 0)), i: e[4] | 0, t: String(e[5] || '').slice(0, 12) }, true);
        }
    }
    function hostInput(g, d, from) {
        if (G !== g || !d || typeof d !== 'object' || d.mt !== g.match || !from) return;
        const i = g.seats.findIndex(p => p.kind === 'remote' && p.id === from.id);
        if (i < 0) return;
        if (!Number.isInteger(d.b) || d.b < 0 || d.b > 3 || !Number.isSafeInteger(d.f) || d.f < 0) return;
        S.input(g.s, i, d.b, d.f);
    }
    function seatLeft(g, p) {
        if (!g || !g.isHost) return;
        const i = g.seats.findIndex(q => q.kind === 'remote' && q.id === p.id);
        if (i < 0) return;
        g.seats[i].kind = 'bot';
        g.bots[i] = S.newBot((g.s.seed + 31 * i) >>> 0);
        say(g, (p.name || 'your partner') + ' left. a bot plays on', 3);
    }
    function showNote(text) { if (!note) return; note.hidden = !text; note.textContent = text; }
    // a match: who is in it, which level, which seed
    function matchFrom(d) {
        if (!d || typeof d !== 'object' || !Array.isArray(d.slots) || !d.slots.length || !Number.isSafeInteger(d.seed)) return null;
        const slots = d.slots.filter(x => typeof x === 'string' && x && x.length <= 64).slice(0, 2);
        if (!slots.length) return null;
        const lvl = +((d.options && d.options.level) || d.level || 1);
        const level = STARTS.includes(lvl) ? lvl : 1;
        const bots = Array.isArray(d.bots) ? slots.map((_, i) => d.bots[i] === 1) : slots.map(() => false);
        return { seed: d.seed >>> 0, slots, level, bots, match: typeof d.match === 'string' && d.match.length <= 64 ? d.match : String(d.at || 0) + ':' + d.seed };
    }
    function enter(s, d) {
        const m = matchFrom(d);
        if (!m) return;
        ensureWindow();
        if (session !== s) {
            offs.forEach(off => { try { off(); } catch (e) { } }); offs = [];
            if (session && session !== s && session.alive) session.leave();
            session = s;
            s.state = 'playing';
            if (s.isHost) {
                offs.push(
                    s.on('popz:i', (data, from) => { if (G && G.online) hostInput(G, data, from); }),
                    s.on('popz:hi', (data, from) => { const g = G; if (g && g.online && g.isHost && from) { session.send('popz:go', g.goMsg, from.id); sendSnapshot(g, from.id); } }),
                    s.on('player-leave', p => { if (G && G.online) seatLeft(G, p); })
                );
            } else {
                offs.push(
                    s.on('popz:s', data => { if (G && G.online) onSnapshot(G, data); }),
                    s.on('popz:go', (data, from) => { if (from && from.id === hostOf(s)) { const mm = matchFrom(data); if (mm && !finished.has(mm.match) && (!G || G.match !== mm.match)) begin(s, data); } }),
                    s.on('net:down', () => { if (G && G.online && !G.ended) { G.quiet = true; showNote('the host went quiet...'); } }),
                    s.on('net:up', () => { showNote(''); }),
                    s.on('player-leave', p => { if (p && p.host) lost('the host left.'); }),
                    s.on('closed', () => { if (G && G.online) lost('the game closed.'); })
                );
            }
        }
        begin(s, d);
    }
    const hostOf = s => (s.players.find(p => p.host) || {}).id || s.hostId || '';
    function begin(s, d) {
        const m = matchFrom(d);
        if (!m) return;
        if (G && G.match) finished.add(G.match);
        const names = id => ((s.players.find(p => p.id === id) || {}).name || 'player');
        const me = m.slots.indexOf(s.id);
        const seats = m.slots.map((id, i) => ({ id, name: m.bots[i] ? 'bot buddy' : names(id), kind: m.bots[i] ? 'bot' : id === s.id ? 'local' : s.isHost ? 'remote' : 'remote' }));
        // a slot whose person is already gone is a bot from the start
        if (s.isHost) seats.forEach((p, i) => { if (p.kind === 'remote' && !s.player(p.id)) { p.kind = 'bot'; m.bots[i] = true; } });
        const g = makeGame({ seed: m.seed, level: m.level - 1, seats, session: s, isHost: s.isHost, me: max(0, me), match: m.match, puppet: !s.isHost });
        if (!s.isHost) g.bots = g.bots.map(() => null);
        g.goMsg = { match: m.match, seed: m.seed, level: m.level, slots: m.slots, bots: m.bots.map(b => (b ? 1 : 0)) };
        G = g;
        attract = null;
        screen = 'play';
        showNote('');
        render();
        if (s.isHost) { session.send('popz:go', g.goMsg); sendSnapshot(g); }
        else session.sendToHost('popz:hi', {});
    }
    function again() {
        const g = G;
        if (!g) return;
        if (!g.online) { startLocal({ mode: g.mode, start: g.level + 1 }); return; }
        if (!g.isHost || !session) return;
        const d = { match: Date.now() + ':' + ((Math.random() * 1e9) >>> 0), seed: (Math.random() * 1e9) >>> 0, level: g.goMsg.level, slots: g.goMsg.slots, bots: g.seats.map(p => (p.kind === 'bot' ? 1 : 0)) };
        d.match = Date.now() + ':' + d.seed;
        begin(session, d);
    }
    function lost(why) {
        offs.forEach(off => { try { off(); } catch (e) { } }); offs = [];
        if (session && session.alive) session.leave();
        session = null;
        G = null;
        screen = 'menu';
        render();
        showNote(why + ' back to the menu.');
        setTimeout(() => { if (note && note.textContent.startsWith(why)) showNote(''); }, 5000);
    }

    // ===============================================================
    // screens
    // ===============================================================
    function render() {
        if (!root) return;
        const g = G;
        if (screen === 'menu') {
            over.innerHTML = panel === 'help' ? helpHtml() : menuHtml();
            over.classList.add('on');
        } else if (g && g.ended && g.overShown) {
            over.innerHTML = overHtml(g);
            over.classList.add('on');
        } else if (g && g.paused) {
            over.innerHTML = panel === 'help' ? helpHtml(true) : `<div class="pz-panel"><div class="pz-title">paused</div><div class="pz-big">paused</div>
                <div class="pz-sub">the bubbles will wait. press p or esc, or the button.</div>
                <div class="pz-btns"><button class="pz-btn pz-go" data-act="resume">go on</button><button class="pz-btn" data-act="help">how to play</button><button class="pz-btn" data-act="menu">quit to menu</button></div></div>`;
            over.classList.add('on');
        } else { over.innerHTML = ''; over.classList.remove('on'); }
        fit(true);
        const f = over.querySelector('.pz-go');
        if (f && screen !== 'play') { try { f.focus({ preventScroll: true }); } catch (e) { } }
    }
    function menuHtml() {
        const p = prefs(), b = loadBest();
        const starts = STARTS.filter(n => n === 1 || n <= b.level);
        const sel = (k, vals, cur) => `<select class="pz-sel" data-k="${k}">${vals.map(v => `<option value="${esc(v[0])}" ${String(v[0]) === String(cur) ? 'selected' : ''}>${esc(v[1])}</option>`).join('')}</select>`;
        return `<div class="pz-panel pz-menu">
            <div class="pz-logo">popz<span>98</span></div>
            <div class="pz-sub">fire a rope straight up. a bubble it touches splits in two, smaller and smaller, until the smallest ones pop. clear the room before the clock runs out, and don't let one land on you.</div>
            <div class="pz-opts">
                <label>who is playing ${sel('mode', [['solo', 'just me'], ['two', 'two of us, one keyboard'], ['buddy', 'me and a bot buddy']], p.mode)}</label>
                <label>start at ${sel('start', starts.map(n => [n, 'level ' + n]), starts.includes(p.start) ? p.start : 1)}</label>
            </div>
            <div class="pz-btns">
                <button class="pz-btn pz-go" data-act="play">play</button>
                <button class="pz-btn" data-act="online">online, 2 players</button>
                <button class="pz-btn" data-act="help">how to play</button>
            </div>
            <div class="pz-rec">${b.games ? `best score <b>${b.score}</b> · furthest level ${b.level} of ${S.LEVELS.length} · games ${b.games}${b.wins ? ' · cleared them all ' + b.wins + 'x' : ''}` : `${S.LEVELS.length} levels. no best score yet bradar`}</div>
        </div>`;
    }
    function helpHtml(paused) {
        const it = (t, d) => `<div><i style="background:${ITEM_LOOK[t][1]}">${ITEM_LOOK[t][0]}</i>${d}</div>`;
        return `<div class="pz-panel pz-help"><div class="pz-title">how to play popz 98</div>
            <h3>the idea</h3>
            <ul><li>your rope goes straight up from where you stand. it splits any bubble it touches.</li>
            <li>big bubbles become two smaller ones; the smallest just pop. smaller is worth more.</li>
            <li>clear the room to finish a level. seconds left on the clock are bonus points.</li>
            <li>a bubble on your head or the clock running out costs a life and restarts the level.</li>
            <li>grey blocks stop ropes, glass ones break when a rope reaches them.</li></ul>
            <h3>keys</h3>
            <ul><li>alone: <b>arrows</b> or <b>a d</b> to walk, <b>space</b>, <b>up</b> or <b>w</b> to fire.</li>
            <li>two at one keyboard: player 1 <b>arrows</b> + <b>up</b>/<b>enter</b>, player 2 <b>a d</b> + <b>w</b>/<b>space</b>.</li>
            <li>mouse or finger: tap the floor to walk there and fire; on a phone the buttons below work too.</li>
            <li><b>p</b> or <b>esc</b> pauses (not online).</li></ul>
            <h3>things that drop</h3>
            <div class="pz-items">${it('double', 'two ropes at once')}${it('sticky', 'rope sticks to the ceiling a while')}${it('shield', 'takes one hit for you')}${it('freeze', 'bubbles stop for 5 seconds')}${it('dynamite', 'everything to the smallest size')}${it('life', 'one more life')}</div>
            <div class="pz-btns"><button class="pz-btn pz-go" data-act="${paused ? 'unhelp' : 'back'}">got it</button></div></div>`;
    }
    function overHtml(g) {
        const s = g.s, b = loadBest(), won = s.ph === 'win';
        const score = g.online ? S.total(s) : S.total(s);
        const rows = s.players.map((p, i) => `<div>${esc((g.seats[i] && g.seats[i].name) || 'p' + (i + 1))}: <b>${p.score}</b></div>`).join('');
        const btns = g.online
            ? (g.isHost ? '<button class="pz-btn pz-go" data-act="again">play again</button><button class="pz-btn" data-act="leave">leave</button>' : '<span>waiting for the host to go again...</span> <button class="pz-btn" data-act="leave">leave</button>')
            : '<button class="pz-btn pz-go" data-act="again">play again</button><button class="pz-btn" data-act="menu">menu</button>';
        return `<div class="pz-panel"><div class="pz-title">${won ? 'you did it' : 'game over'}</div>
            <div class="pz-big">${won ? 'every bubble popped!' : 'game over'}</div>
            <div class="pz-sub">reached level ${s.lv + 1} of ${S.LEVELS.length}. score <b>${score}</b>${g.newBest ? ' · <b>new best!</b>' : ' · best ' + b.score}</div>
            ${s.players.length > 1 ? `<div class="pz-sub">${rows}</div>` : ''}
            <div class="pz-btns">${btns}</div></div>`;
    }
    function onOverChange(ev) {
        const el = ev.target;
        if (!el.dataset.k) return;
        const p = prefs();
        if (el.dataset.k === 'mode') p.mode = el.value; else p.start = +el.value;
        writeJson(PREFS_KEY, p);
    }
    function onOverClick(ev) {
        const b = ev.target.closest('[data-act]');
        if (b) act(b.dataset.act);
    }
    function act(a) {
        switch (a) {
            case 'play': panel = ''; startLocal(); break;
            case 'online':
                if (typeof openNetplay === 'function') openNetplay({ gameId: 'popz' });
                else if (window.Netplay) Netplay.openLobby({ gameId: 'popz' });
                break;
            case 'help': panel = 'help'; render(); break;
            case 'back': panel = ''; render(); break;
            case 'unhelp': panel = ''; render(); break;
            case 'resume': panel = ''; pause(false); break;
            case 'again': panel = ''; again(); break;
            case 'menu': panel = ''; if (G && G.online) leaveOnline(); G = null; screen = 'menu'; render(); break;
            case 'leave': panel = ''; leaveOnline(); G = null; screen = 'menu'; render(); break;
        }
    }

    // behind the menu: a bot playing a random level
    function startAttract() {
        const seed = (Math.random() * 1e9) >>> 0;
        attract = makeGame({ seed, level: seed % 12, seats: [{ name: 'bot', kind: 'bot' }] });
        attract.s.lives = 9;
        attract.s.players[0].lives = 9;
    }

    // ===============================================================
    // the way in
    // ===============================================================
    function openMenu() {
        ensureWindow();
        if (G && screen === 'play') { winRef.win.style.display = 'flex'; return winRef.win; }
        screen = 'menu';
        render();
        return winRef.win;
    }
    window.startPopz = openMenu;
    function paintAvatar(canvas) {
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        const s = window.Netplay && Netplay.current;
        const i = s ? max(0, s.players.findIndex(p => p.id === canvas.dataset.pid)) % 2 : 0;
        const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, SKIES[0][0]); gr.addColorStop(1, SKIES[0][1]);
        c.fillStyle = gr; c.fillRect(0, 0, w, h);
        const k = w / 64;
        c.fillStyle = BUBBLE_COL[i ? 0 : 3]; c.beginPath(); c.arc(44 * k, 18 * k, 12 * k, 0, PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,.7)'; c.beginPath(); c.arc(40 * k, 14 * k, 3 * k, 0, PI * 2); c.fill();
        c.fillStyle = COLORS[i]; c.fillRect(18 * k, 34 * k, 18 * k, 18 * k);
        c.fillStyle = '#f2c79a'; c.beginPath(); c.arc(27 * k, 28 * k, 7 * k, 0, PI * 2); c.fill();
        c.fillStyle = '#202020'; c.fillRect(19 * k, 52 * k, 6 * k, 10 * k); c.fillRect(29 * k, 52 * k, 6 * k, 10 * k);
        c.strokeStyle = '#203080'; c.lineWidth = 2 * k; c.beginPath(); c.moveTo(27 * k, 20 * k); c.lineTo(27 * k, 0); c.stroke();
    }
    if (window.Netplay) {
        Netplay.registerGame({
            id: 'popz',
            name: 'popz 98',
            start: (s, opts) => { if (!s || (opts && opts.solo) || s.solo) { openMenu(); return; } enter(s, opts); },
            startSolo: () => { openMenu(); },
            soloLabel: 'play alone or with a bot buddy',
            paintAvatar
        });
    }
    // for the browser test: the state, a clock it can turn up, a bot at a person's controls
    window.POPZ_ENGINE = {
        state: () => (G ? G.s : null), game: () => G, screen: () => screen, startLocal, act, clock: n => { testClock = max(1, +n || 1); },
        best: () => loadBest(), sim: S,
        autopilot: (i, on) => { if (G && G.isHost) { G.auto = G.auto || []; G.auto[i] = on ? S.newBot(91 + i) : null; } },
        // empties the room on the host, which then clears the level by the rules
        clearLevel: () => { if (G && G.isHost && G.s.ph === 'play') G.s.bubbles.length = 0; },
        fit: () => fit(true)
    };
})();
