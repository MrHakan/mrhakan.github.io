// ===================================================================
// tankz 98 — the window, the keys and thumbs, the picture, the room, the wire
//
// tankz-sim.js is the rules, tankz-room.js the online room; this is what sits
// between them and a person. The sim steps at a fixed 60 a second whatever
// the screen does; the picture is drawn as often as the screen wants.
//
// Up to three people share a keyboard, with bots in the other seats. Online,
// everybody meets in a room first (games/netplay.js brings them there), says
// ready, and the host starts the match; when it ends they are all back in the
// same room with the same code, and the table of the match they just played.
//
// Online is host authoritative: the host runs the rules and the bots and sends
// snapshots (20 a second straight across, 6 over the relays). A guest drives
// its own tank on its own screen and tells the host where it is; the host keeps
// that to what a tank could have driven and decides every hit. Shells fly the
// same way on every screen, so a guest carries them on between snapshots.
// ===================================================================
(function () {
    'use strict';

    const TK = window.TK, S = window.TK_SIM, ROOM = window.TK_ROOM;
    if (!TK || !S || !ROOM) { console.warn('[tankz] a file is missing'); return; }
    const { min, max, floor, round, abs, sin, cos, atan2, PI, hypot, sqrt } = Math;
    const DT = 1 / TK.TICK;
    const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
    const META_KEY = 'mrhakan98-tankz-meta', PREFS_KEY = 'mrhakan98-tankz-prefs';
    const LEVELS = ['easy', 'normal', 'hard'];
    const COL = i => TK.COLORS[i % TK.COLORS.length];

    function ensureCss() {
        if (document.getElementById('tk-css')) return;
        const l = document.createElement('link');
        l.id = 'tk-css'; l.rel = 'stylesheet'; l.href = 'games/tankz/tankz.css';
        document.head.appendChild(l);
    }
    const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
    function prefs() {
        const p = readJson(PREFS_KEY) || {};
        const humans = [1, 2, 3].includes(p.humans) ? p.humans : 1;
        return {
            humans,
            bots: Number.isInteger(p.bots) && p.bots >= 0 && p.bots <= 6 ? p.bots : 2,
            level: LEVELS.concat('mixed').includes(p.level) ? p.level : 'normal',
            points: TK.POINTS.includes(p.points) ? p.points : TK.POINTS[0],
            size: TK.SIZE_BY_ID[p.size] ? p.size : 'medium'
        };
    }
    function savePrefs(o) { writeJson(PREFS_KEY, Object.assign(prefs(), o)); }
    function loadMeta() {
        const m = readJson(META_KEY);
        const o = m && typeof m === 'object' ? m : {};
        const n = v => (Number.isFinite(+v) && +v >= 0 ? +v : 0);
        return { matches: n(o.matches), wins: n(o.wins), rounds: n(o.rounds), roundWins: n(o.roundWins), kills: n(o.kills), selfs: n(o.selfs), online: n(o.online) };
    }
    function record(f) { const m = loadMeta(); f(m); writeJson(META_KEY, m); }
    const unlock = id => { if (typeof unlockAchievement === 'function') { try { unlockAchievement(id); } catch (e) { } } };

    // ===============================================================
    // sound: synthesized, and quiet when the site is
    // ===============================================================
    let actx = null;
    const soundOn = () => (typeof soundEnabled === 'undefined' ? true : soundEnabled);
    function audio() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!actx) { try { actx = new AC(); } catch (e) { return null; } }
        if (actx.state === 'suspended') actx.resume().catch(() => { });
        return actx;
    }
    function tone(freq, dur, o) {
        if (!soundOn()) return;
        const ctx = audio();
        if (!ctx) return;
        o = o || {};
        try {
            const t0 = ctx.currentTime + (o.delay || 0);
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.type = o.type || 'square';
            osc.frequency.setValueAtTime(max(1, freq), t0);
            if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(max(1, o.slideTo), t0 + dur);
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(o.gain || 0.04, t0 + min(0.01, dur / 3));
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(t0); osc.stop(t0 + dur + 0.02);
        } catch (e) { }
    }
    function noise(dur, gain, from, to) {
        if (!soundOn()) return;
        const ctx = audio();
        if (!ctx) return;
        try {
            const t0 = ctx.currentTime;
            const n = floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
            for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) * (1 - i / n);
            const src = ctx.createBufferSource(); src.buffer = b;
            const f = ctx.createBiquadFilter(); f.type = 'lowpass';
            f.frequency.setValueAtTime(from, t0); f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
            const g = ctx.createGain(); g.gain.setValueAtTime(gain, t0);
            src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t0);
        } catch (e) { }
    }
    const sfx = {
        shot: () => tone(620, 0.06, { slideTo: 240, gain: 0.025 }),
        heavy: () => tone(300, 0.12, { slideTo: 90, type: 'sawtooth', gain: 0.03 }),
        beam: () => tone(1500, 0.3, { slideTo: 160, type: 'sawtooth', gain: 0.035 }),
        boom: near => noise(0.6, near ? 0.14 : 0.06, 2600, 90),
        pick: () => { tone(660, 0.07, { type: 'triangle' }); tone(990, 0.1, { type: 'triangle', delay: 0.07 }); },
        round: () => tone(440, 0.12),
        win: () => { tone(660, 0.12); tone(880, 0.12, { delay: 0.12 }); tone(1320, 0.3, { delay: 0.24 }); },
        lose: () => tone(300, 0.4, { slideTo: 90, type: 'sawtooth', gain: 0.03 })
    };

    // ===============================================================
    // the window
    // ===============================================================
    let winRef = null, root = null, G = null, screen = 'menu', raf = 0, testClock = 1;
    let cv = null, ctx = null, stage = null, hud = null, over = null;
    const IS_TOUCH = () => { try { return !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } };
    function ensureWindow() {
        ensureCss();
        if (winRef && winRef.win && document.getElementById(winRef.win.id)) return winRef;
        const vw = typeof viewportWidth === 'function' ? viewportWidth() : 1000;
        winRef = createAppWindow('tankz 98', { icon: 'rocket_launch', width: min(980, vw - 20) });
        winRef.body.classList.add('tk-body');
        if (document.documentElement.clientHeight < 600) winRef.win.style.top = '0px';
        else if (document.documentElement.clientHeight < 900) winRef.win.style.top = '30px';
        winRef.win._cleanup = () => {
            leaveAll();
            stopLoop();
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', clearKeys);
            window.removeEventListener('resize', onResize);
            cv = null; ctx = null; stage = null; hud = null; over = null; root = null; winRef = null; mazeCache = null;
        };
        root = winRef.body;
        root.innerHTML = `
            <div class="tk-stage" id="tk-stage">
                <canvas id="tk-canvas" class="tk-canvas" aria-label="the maze"></canvas>
                <div class="tk-hud" id="tk-hud" aria-live="polite"></div>
                <div class="tk-thumbs" id="tk-thumbs" hidden>
                    <div class="tk-stick" id="tk-stick"><i></i></div>
                    <button class="tk-fire" id="tk-fire" aria-label="fire">fire</button>
                </div>
                <div class="tk-over" id="tk-over"></div>
            </div>`;
        stage = root.querySelector('#tk-stage');
        cv = root.querySelector('#tk-canvas');
        ctx = cv.getContext('2d');
        hud = root.querySelector('#tk-hud');
        over = root.querySelector('#tk-over');
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', clearKeys);
        window.addEventListener('resize', onResize);
        bindThumbs();
        over.addEventListener('click', onOverClick);
        over.addEventListener('change', onOverChange);
        startLoop();
        return winRef;
    }
    function onResize() { fitAt = 0; }
    function onTop() {
        if (!winRef || !winRef.win || winRef.win.style.display === 'none') return false;
        const z = +winRef.win.style.zIndex || 0;
        return ![...document.querySelectorAll('.app-window, .ie-window')].some(w => w !== winRef.win && w.style.display !== 'none' && (+w.style.zIndex || 0) > z);
    }

    // the stage fills the window's width; the canvas gets the screen's own pixels
    let fitAt = 0, dpr = 1;
    function fit(force) {
        if (!stage || !root) return;
        const now = performance.now();
        if (!force && fitAt && now - fitAt < 250) return;
        fitAt = now;
        const fs = winRef && winRef.win.classList.contains('fs-active');
        const rect = root.getBoundingClientRect();
        const vh = document.documentElement.clientHeight || window.innerHeight || 700;
        const cs = getComputedStyle(root);
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const w = max(240, floor(root.clientWidth - padX));
        let h;
        if (fs) h = max(200, root.clientHeight - padY);
        else {
            const room = vh - max(0, rect.top) - 8;
            h = max(260, min(w * 0.72, room));
            if (w < 560 && vh > w) h = max(260, min(w * 1.35, room));
        }
        h = floor(h);
        if (stage.style.width !== w + 'px' || stage.style.height !== h + 'px') { stage.style.width = w + 'px'; stage.style.height = h + 'px'; }
        let k = min(2, window.devicePixelRatio || 1);
        if (w * h * k * k > 2.4e6) k = sqrt(2.4e6 / (w * h));
        dpr = k;
        const bw = max(1, round(w * k)), bh = max(1, round(h * k));
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; mazeCache = null; }
        cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }

    // ===============================================================
    // a game: the sim, and what the screen keeps about it
    // ===============================================================
    // people first, then bots
    function seatsFor(people, bots, level, seed) {
        const out = people.map((p, i) => ({ id: p.id, name: p.name, local: p.local }));
        const used = new Set(out.map(p => p.name));
        for (let b = 0; b < bots && out.length < TK.MAX_TANKS; b++) {
            const lv = level === 'mixed' ? LEVELS[(out.length + 1) % 3] : (LEVELS.includes(level) ? level : 'normal');
            let name = TK.BOT_NAMES[(seed + b) % TK.BOT_NAMES.length];
            if (used.has(name)) name += b + 1;
            used.add(name);
            out.push({ id: 'bot' + out.length, name, bot: lv });
        }
        return out;
    }
    function makeGame(o) {
        const s = S.newMatch({ seed: o.seed, seats: o.seats, points: o.points, size: o.size, puppet: !o.isHost });
        const g = {
            s, online: !!o.session, session: o.session || null, isHost: !o.session || !!o.isHost, me: o.me === undefined ? 0 : o.me,
            locals: o.locals || [], bots: [], acc: 0, last: performance.now(), t: 0, ff: 1,
            view: s.tanks.map(t => ({ x: t.x, y: t.y, a: t.a, dist: 0 })), fx: [], wrecks: [], feed: [], banner: null, over: false, recorded: false,
            opts: o, match: o.match || '',
            // the wire
            sentAt: 0, inputAt: 0, lastSnap: performance.now(), snapGap: 0.05, pred: null, fp: 0, poseAt: [], netDown: false,
            fps: 0, frames: 0, fpsAt: performance.now(), hudAt: 0, lastPhase: s.phase
        };
        if (g.isHost) s.seats.forEach((p, i) => { if (p.bot) g.bots[i] = S.newBot(p.bot, (o.seed * 13 + i * 7) >>> 0); });
        return g;
    }
    function botFor(g, i) {
        const p = g.s.seats[i];
        if (!p || !p.bot) { g.bots[i] = null; return null; }
        if (!g.bots[i] || g.bots[i].level !== p.bot) { g.bots[i] = S.newBot(p.bot, (g.s.seed * 13 + i * 7) >>> 0); g.bots[i].fp = g.s.tanks[i].in.fp; }
        return g.bots[i];
    }

    // ---------------------------------------------------------------
    // the loop
    // ---------------------------------------------------------------
    function startLoop() { if (!raf) { const tick = () => { raf = requestAnimationFrame(tick); frame(); }; raf = requestAnimationFrame(tick); } }
    function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    function frame() {
        if (!root || !document.getElementById('tk-stage')) { stopLoop(); return; }
        fit();
        const now = performance.now();
        roomTick(now);
        const g = G;
        if (!g || screen !== 'play') {
            if (attract && (screen === 'menu' || screen === 'room')) attractFrame(now);
            else if (screen !== 'play') blank();
            return;
        }
        const dt = min(0.1, (now - g.last) / 1000);
        g.last = now;
        g.t += dt;
        g.frames++;
        if (now - g.fpsAt > 1000) { g.fps = g.frames * 1000 / (now - g.fpsAt); g.frames = 0; g.fpsAt = now; }
        pollPads();
        if (g.isHost) hostSteps(g, dt);
        else guestFrame(g, dt);
        readEvents(g);
        place(g, dt);
        draw(g, dt);
        hudPaint(g, now);
        if (g.online) net(g, now);
    }
    function hostSteps(g, dt) {
        const s = g.s;
        if (s.phase === 'over' || g.paused) return;
        // with nobody left but bots, the round is fought out at twice the speed
        g.ff = (s.phase === 'fight' || s.phase === 'after') && !S.people(s) && S.alive(s).length > 1 ? 2 : 1;
        g.acc += dt * g.ff * testClock;
        let n = 0;
        const cap = 12 * testClock * g.ff;
        while (g.acc >= DT && n++ < cap) {
            g.acc -= DT;
            applyLocals(g);
            for (let i = 0; i < s.n; i++) { const b = botFor(g, i) || (g.autopilot && g.autopilot[i]); if (b) S.think(s, i, b); }
            S.step(s);
            readEvents(g);
            if (s.phase === 'over') { g.acc = 0; break; }
        }
        if (g.acc > DT * 4) g.acc = DT * 4;
    }
    function applyLocals(g) {
        for (const L of g.locals) S.input(g.s, L.seat, L.mv, L.fp);
    }

    // ===============================================================
    // input: up to three people at one keyboard, thumbs, game pads
    // ===============================================================
    const KEYMAP = [
        { f: ['KeyW'], b: ['KeyS'], l: ['KeyA'], r: ['KeyD'], x: ['KeyQ', 'KeyF'], text: '<b>w a s d</b> drive, <b>q</b> fire' },
        { f: ['ArrowUp'], b: ['ArrowDown'], l: ['ArrowLeft'], r: ['ArrowRight'], x: ['Enter', 'NumpadEnter', 'Numpad0', 'Slash', 'Period', 'ShiftRight', 'ControlRight'], text: '<b>arrows</b> drive, <b>enter</b> or <b>/</b> fire' },
        { f: ['KeyI'], b: ['KeyK'], l: ['KeyJ'], r: ['KeyL'], x: ['KeyU', 'KeyO'], text: '<b>i j k l</b> drive, <b>u</b> fire' }
    ];
    const ALL = { f: [], b: [], l: [], r: [], x: ['Space', 'KeyM'] };
    KEYMAP.forEach(m => { for (const k of ['f', 'b', 'l', 'r', 'x']) ALL[k] = ALL[k].concat(m[k]); });
    const held = new Set();
    // with one person here, every key of every set is theirs, and space fires too
    const mapFor = (g, k) => (g.locals.length <= 1 ? ALL : KEYMAP[k] || KEYMAP[0]);
    const anyOf = (codes) => codes.some(c => held.has(c));
    function bitsOf(map) { return (anyOf(map.f) ? 1 : 0) | (anyOf(map.b) ? 2 : 0) | (anyOf(map.l) ? 4 : 0) | (anyOf(map.r) ? 8 : 0); }
    function refreshLocals(g) {
        g.locals.forEach((L, k) => {
            let mv = bitsOf(mapFor(g, k));
            if (k === 0 && stick.on) mv |= stickBits(g, L.seat);
            if (L.pad) mv |= L.pad;
            L.mv = mv;
        });
    }
    function fire(k) {
        const g = G;
        if (!g || screen !== 'play' || g.over) return;
        const L = g.locals[k];
        if (!L) return;
        const t = g.s.tanks[L.seat];
        if (!t || !t.alive || (g.s.phase !== 'fight' && g.s.phase !== 'after')) return;
        L.fp++;
        // a guest hears its own shot now, not when the host says so
        if (!g.isHost) { g.fp = L.fp; sendInput(g, true); if (!t.w && !t.frag) sfx.shot(); }
    }
    function clearKeys() { held.clear(); if (G) refreshLocals(G); }
    function onKey(ev) {
        const tag = (ev.target && ev.target.tagName) || '';
        if (screen !== 'play' || !G || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !onTop()) return;
        if (ev.ctrlKey && ev.code !== 'ControlRight' || ev.metaKey || ev.altKey) return;
        const g = G, code = ev.code;
        if ((code === 'Escape' || code === 'KeyP') && !g.online && !g.over) { ev.preventDefault(); togglePause(g); return; }
        let mine = false;
        for (let k = 0; k < max(1, g.locals.length); k++) {
            const map = mapFor(g, k);
            if (map.x.includes(code)) { mine = true; if (!ev.repeat) fire(k); break; }
            if (map.f.includes(code) || map.b.includes(code) || map.l.includes(code) || map.r.includes(code)) mine = true;
        }
        if (!mine) return;
        ev.preventDefault(); ev.stopPropagation();
        held.add(code);
        refreshLocals(g);
    }
    function onKeyUp(ev) {
        if (!held.has(ev.code)) return;
        held.delete(ev.code);
        if (G) refreshLocals(G);
        if (screen === 'play') ev.preventDefault();
    }
    function togglePause(g) {
        g.paused = !g.paused;
        g.last = performance.now();
        g.hudAt = 0;
    }
    // ---- the thumbs: a stick on the left, the trigger on the right ----
    const stick = { on: false, id: -1, cx: 0, cy: 0, dx: 0, dy: 0 };
    function bindThumbs() {
        const pad = root.querySelector('#tk-stick'), knob = pad.querySelector('i'), fb = root.querySelector('#tk-fire');
        const move = ev => {
            const r = pad.getBoundingClientRect();
            stick.cx = r.left + r.width / 2; stick.cy = r.top + r.height / 2;
            const dx = ev.clientX - stick.cx, dy = ev.clientY - stick.cy, d = hypot(dx, dy), lim = r.width * 0.42;
            stick.dx = d > lim ? dx * lim / d : dx; stick.dy = d > lim ? dy * lim / d : dy;
            stick.mag = min(1, d / lim);
            knob.style.transform = `translate(${stick.dx}px, ${stick.dy}px)`;
            if (G) refreshLocals(G);
        };
        pad.addEventListener('pointerdown', ev => { ev.preventDefault(); stick.on = true; stick.id = ev.pointerId; try { pad.setPointerCapture(ev.pointerId); } catch (e) { } move(ev); }, { passive: false });
        pad.addEventListener('pointermove', ev => { if (stick.on && ev.pointerId === stick.id) move(ev); });
        const up = ev => { if (ev.pointerId !== stick.id) return; stick.on = false; stick.mag = 0; knob.style.transform = ''; if (G) refreshLocals(G); };
        pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
        fb.addEventListener('pointerdown', ev => { ev.preventDefault(); fb.classList.add('on'); fire(0); }, { passive: false });
        const off = () => fb.classList.remove('on');
        fb.addEventListener('pointerup', off); fb.addEventListener('pointercancel', off); fb.addEventListener('pointerleave', off);
        stage.addEventListener('contextmenu', ev => { if (screen === 'play') ev.preventDefault(); });
    }
    // a direction to tank keys: turn towards it, and drive once it is roughly ahead
    function towards(g, seat, ang) {
        const t = seatPose(g, seat);
        if (!t) return 0;
        const diff = S.wrap(ang - t.a);
        let mv = abs(diff) < 0.1 ? 0 : diff > 0 ? 8 : 4;
        if (abs(diff) < 0.85) mv |= 1;
        return mv;
    }
    function seatPose(g, seat) { return !g.isHost && seat === g.me && g.pred ? g.pred : g.s.tanks[seat]; }
    function stickBits(g, seat) { return stick.mag > 0.25 ? towards(g, seat, atan2(stick.dy, stick.dx)) : 0; }
    function showThumbs(on) { const t = root && root.querySelector('#tk-thumbs'); if (t) t.hidden = !on; }
    // ---- game pads: pad k is the k-th person at this screen ----
    const padFire = [];
    function pollPads() {
        const g = G;
        if (!g || !navigator.getGamepads) return;
        let pads;
        try { pads = [...navigator.getGamepads()].filter(Boolean); } catch (e) { return; }
        let changed = false;
        g.locals.forEach((L, k) => {
            const p = pads[k];
            if (!p) { if (L.pad) { L.pad = 0; changed = true; } return; }
            const btn = i => !!(p.buttons[i] && p.buttons[i].pressed);
            let mv = (btn(12) ? 1 : 0) | (btn(13) ? 2 : 0) | (btn(14) ? 4 : 0) | (btn(15) ? 8 : 0);
            const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
            if (hypot(ax, ay) > 0.4) mv |= towards(g, L.seat, atan2(ay, ax));
            if (mv !== L.pad) { L.pad = mv; changed = true; }
            const f = btn(0) || btn(5) || btn(7);
            if (f && !padFire[k]) fire(k);
            padFire[k] = f;
        });
        if (changed || stick.on) refreshLocals(g);
    }

    // ===============================================================
    // a guest's own tank: driven here, told to the host
    // ===============================================================
    function guestFrame(g, dt) {
        const s = g.s;
        if (g.netDown) return;
        S.coast(s, dt * (g.ffHost || 1));
        const L = g.locals[0];
        const t = s.tanks[g.me];
        if (!L || !t) return;
        if (L) refreshLocals(g);
        const p = g.pred;
        if (!p || !t.alive || (s.phase !== 'fight' && s.phase !== 'after')) return;
        if (g.autopilot) {
            // a test's bot at a guest's controls: it looks at the maze with my tank where I have it
            const keep = [t.x, t.y, t.a, s.tick];
            t.x = p.x; t.y = p.y; t.a = p.a; s.tick = g.apTick = (g.apTick || 0) + 1;
            S.think(s, g.me, g.autopilot);
            [t.x, t.y, t.a, s.tick] = keep;
            L.mv = t.in.mv;
            if (g.autopilot.fp > (g.apFp || 0)) { g.apFp = g.autopilot.fp; fire(0); }
        }
        g.predAcc = (g.predAcc || 0) + dt;
        while (g.predAcc >= DT) { g.predAcc -= DT; S.moveTank(s.maze, p, L.mv, DT); }
    }
    // a snapshot's word on my own tank: a new round, or a death, or a host that disagrees a lot
    function reconcile(g) {
        const s = g.s, t = s.tanks[g.me];
        if (!t) return;
        const p = g.pred;
        if (!p || p.r !== s.round || !t.alive || s.phase === 'ready' || s.phase === 'end' || hypot(p.x - t.x, p.y - t.y) > 60) {
            g.pred = { x: t.x, y: t.y, a: t.a, r: s.round, moving: false };
        }
    }
    function sendInput(g, now) {
        const p = g.pred, s = g.s, L = g.locals[0];
        if (!p || !L) return;
        g.inputAt = performance.now();
        send(g, 'tk:i', { r: s.round, x: round(p.x * 10) / 10, y: round(p.y * 10) / 10, a: round(p.a * 1000) / 1000, mv: L.mv, fp: L.fp }, true);
    }
    function hostInput(g, d, from) {
        if (!d || !from || typeof d !== 'object') return;
        const s = g.s;
        const i = s.seats.findIndex(p => p.id === from.id);
        if (i < 0 || s.seats[i].bot) return;
        const t = s.tanks[i];
        t.remote = true;
        const now = performance.now();
        if (d.r === s.round && (s.phase === 'fight' || s.phase === 'after')) S.pose(s, i, +d.x, +d.y, +d.a, (now - (g.poseAt[i] || now - 50)) / 1000);
        g.poseAt[i] = now;
        S.input(s, i, d.mv | 0, Number.isSafeInteger(d.fp) ? d.fp : 0);
    }

    // ===============================================================
    // what happened: the sim's events, for the screen
    // ===============================================================
    function nameOf(g, i) { const p = g.s.seats[i]; return isMine(g, i) && g.locals.length <= 1 ? 'you' : (p ? p.name : 'somebody'); }
    const isMine = (g, i) => g.locals.some(L => L.seat === i);
    function say(g, text, t) { g.feed.unshift({ text, t: t || 4 }); g.feed.length = min(g.feed.length, 5); g.hudAt = 0; }
    function banner(g, text, sub, t) { g.banner = { text, sub: sub || '', t: t || 2 }; g.hudAt = 0; }
    const HOW = { shell: 'shelled', bits: 'shredded', frag: 'shrapnelled', seeker: 'got a seeker into', beam: 'beamed', mine: 'mined' };
    function readEvents(g) {
        const s = g.s;
        if (!s.events.length) return;
        const evs = s.events.splice(0, s.events.length);
        for (const e of evs) {
            if (e.e === 'die') {
                const t = s.tanks[e.i], v = g.view[e.i];
                boom(g, e.x, e.y, COL(e.i).css, 40);
                g.wrecks.push({ x: e.x, y: e.y, a: v ? v.a : 0, i: e.i });
                sfx.boom(isMine(g, e.i));
                const who = nameOf(g, e.i);
                let text;
                if (e.by === e.i) text = who === 'you' ? 'you got yourself bradar' : who + ' got themself';
                else if (e.by >= 0) text = nameOf(g, e.by) + ' ' + (HOW[e.how] || 'got') + ' ' + who;
                else text = who + ' is gone';
                say(g, text);
                if (isMine(g, e.i) && g.locals.length <= 1) { sfx.lose(); banner(g, 'hit', e.by === e.i ? 'by your own ' + (e.how === 'shell' ? 'shell' : 'trick') : '', 1.6); }
                if (g.isHost || !g.recorded) {
                    if (isMine(g, e.by) && e.by !== e.i) record(m => { m.kills++; });
                    if (isMine(g, e.i) && e.by === e.i) record(m => { m.selfs++; });
                }
            } else if (e.e === 'boom') { boom(g, e.x, e.y, '#ffb000', 26); sfx.boom(false); }
            else if (e.e === 'pick') {
                if (isMine(g, e.i)) { sfx.pick(); say(g, (g.locals.length > 1 ? nameOf(g, e.i) + ' picked up ' : 'you picked up ') + TK.WEAPONS[e.w].name, 3); }
                else say(g, nameOf(g, e.i) + ' picked up ' + TK.WEAPONS[e.w].name, 2.5);
            } else if (e.e === 'shot') {
                g.shots = g.shots || {};
                g.shots[e.i] = (g.shots[e.i] || 0) + 1;
                if (g.isHost || !isMine(g, e.i) || e.w) (e.w === 'frag' || e.w === 'seeker' || e.w === 'scatter' || e.w === 'burst' ? sfx.heavy : sfx.shot)();
            } else if (e.e === 'beam') sfx.beam();
            else if (e.e === 'round') { g.wrecks.length = 0; g.fx.length = 0; banner(g, 'round ' + e.r, 'first to ' + s.points, TK.READY + 0.2); sfx.round(); if (!g.isHost) g.pred = null; }
            else if (e.e === 'end') roundOver(g, e.w);
            else if (e.e === 'over') matchOver(g);
        }
    }
    function roundOver(g, w) {
        const s = g.s;
        if (w >= 0 && isMine(g, w)) { sfx.win(); banner(g, (g.locals.length > 1 ? nameOf(g, w) + ' takes' : 'you take') + ' the round', 'bradar', 1.6); }
        else if (w >= 0) banner(g, nameOf(g, w) + ' takes the round', '', 1.6);
        else banner(g, 'nobody takes the round', 'that was a draw', 1.6);
        record(m => { m.rounds++; if (w >= 0 && isMine(g, w)) m.roundWins++; });
    }
    function standings(g) {
        const s = g.s;
        return s.seats.map((p, i) => ({ i, id: p.id, name: p.name, bot: p.bot, pts: s.scores[i] || 0, kills: s.kills[i] || 0, deaths: s.deaths[i] || 0, selfs: s.selfs[i] || 0 }))
            .sort((a, b) => b.pts - a.pts || b.kills - a.kills || a.selfs - b.selfs || a.i - b.i);
    }
    function matchOver(g) {
        if (g.over) return;
        g.over = true;
        g.overAt = performance.now();
        const st = standings(g), w = g.s.winner >= 0 ? g.s.winner : st[0].i;
        const won = isMine(g, w);
        if (!g.recorded) { g.recorded = true; record(m => { m.matches++; if (g.online) m.online++; if (won && g.locals.length <= 1) m.wins++; }); }
        if (won) { sfx.win(); if (g.locals.length <= 1 || g.s.seats.filter(p => !p.bot).length > 1) unlock('tankz_win'); }
        if (g.online && g.isHost) hostFinish(g);
        paintOver();
    }

    // ===============================================================
    // the picture
    // ===============================================================
    function boom(g, x, y, col, n) {
        for (let k = 0; k < n; k++) {
            const a = Math.random() * PI * 2, sp = 30 + Math.random() * 140;
            g.fx.push({ x, y, vx: cos(a) * sp, vy: sin(a) * sp, t: 0, life: 0.35 + Math.random() * 0.6, col: k % 3 ? col : (k % 2 ? '#202020' : '#ffe060'), size: 2 + Math.random() * 4 });
        }
        g.fx.push({ ring: true, x, y, t: 0, life: 0.35 });
        if (g.fx.length > 700) g.fx.splice(0, g.fx.length - 700);
    }
    // where every tank is drawn this frame
    function place(g, dt) {
        const s = g.s;
        const k = 1 - Math.exp(-dt * 16);
        const age = min(0.25, (performance.now() - g.lastSnap) / 1000);
        for (const t of s.tanks) {
            const v = g.view[t.i];
            let x = t.x, y = t.y, a = t.a;
            if (!g.isHost) {
                if (t.i === g.me && g.pred) { x = g.pred.x; y = g.pred.y; a = g.pred.a; }
                else if (t.px !== undefined && t.alive && (s.phase === 'fight' || s.phase === 'after')) {
                    // carried on the way it was going, for as long as the snapshot is old
                    const gap = max(0.03, g.snapGap);
                    x += (t.x - t.px) / gap * age; y += (t.y - t.py) / gap * age;
                }
            }
            const jump = hypot(x - v.x, y - v.y) > 40 || !v.seen;
            const smooth = g.isHost && !t.remote ? 1 : (t.i === g.me ? 1 : k);
            const nx = jump ? x : v.x + (x - v.x) * smooth, ny = jump ? y : v.y + (y - v.y) * smooth;
            v.dist += hypot(nx - v.x, ny - v.y) + (t.moving ? abs(S.wrap(a - v.a)) * 8 : 0);
            v.x = nx; v.y = ny;
            v.a = jump ? a : v.a + S.wrap(a - v.a) * smooth;
            v.seen = true;
        }
        const out = [];
        for (const p of g.fx) {
            p.t += dt;
            if (p.t >= p.life) continue;
            if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 3; p.vy *= 1 - dt * 3; }
            out.push(p);
        }
        g.fx = out;
        // a trail behind every seeker
        for (const b of s.shells) if (b.k === 'm' && Math.random() < 0.7) g.fx.push({ x: b.x - b.vx * 0.04, y: b.y - b.vy * 0.04, vx: 0, vy: 0, t: 0, life: 0.6, col: 'rgba(80,80,80,.5)', size: 4, smoke: true });
    }
    let mazeCache = null;
    function layout(m, W, H) {
        const top = 34 * dpr, bottom = 20 * dpr, pad = 10 * dpr;
        const k = min((W - 2 * pad) / (m.W + TK.WALL), (H - top - bottom - 2 * pad) / (m.H + TK.WALL));
        const ox = (W - m.W * k) / 2, oy = top + pad + ((H - top - bottom - 2 * pad) - m.H * k) / 2;
        return { k, ox, oy };
    }
    // the floor and the walls, drawn once a maze and kept
    function mazeImage(m, L) {
        const key = m.seed + ':' + m.cols + 'x' + m.rows + ':' + L.k.toFixed(4) + ':' + cv.width + 'x' + cv.height;
        if (mazeCache && mazeCache.key === key) return mazeCache;
        const k = L.k, pad = ceilPx(TK.WALL * k) + 4;
        const c = document.createElement('canvas');
        c.width = Math.ceil(m.W * k + pad * 2); c.height = Math.ceil(m.H * k + pad * 2);
        const x = c.getContext('2d');
        const X = v => pad + v * k;
        // the floor: the desktop, a shade lighter, with the cells marked by dots
        x.fillStyle = '#0d8d8d'; x.fillRect(X(0), X(0), m.W * k, m.H * k);
        x.fillStyle = 'rgba(0,0,0,.16)';
        const dot = max(1, round(k * 1.2));
        for (let cy = 0; cy <= m.rows; cy++) for (let cx = 0; cx <= m.cols; cx++) x.fillRect(X(cx * TK.CELL) - dot / 2, X(cy * TK.CELL) - dot / 2, dot, dot);
        // the walls: raised grey, like every button in the house
        const e = max(1, round(k * 1.1));
        const rects = m.rects.map(q => [X(q.x0), X(q.y0), (q.x1 - q.x0) * k, (q.y1 - q.y0) * k]);
        x.fillStyle = 'rgba(0,0,0,.28)';
        for (const r of rects) x.fillRect(r[0] + e * 1.5, r[1] + e * 1.5, r[2], r[3]);
        x.fillStyle = '#ffffff';
        for (const r of rects) x.fillRect(r[0], r[1], r[2], r[3]);
        x.fillStyle = '#404040';
        for (const r of rects) x.fillRect(r[0] + e, r[1] + e, r[2] - e, r[3] - e);
        x.fillStyle = '#808080';
        for (const r of rects) x.fillRect(r[0] + e, r[1] + e, r[2] - 2 * e, r[3] - 2 * e);
        x.fillStyle = '#c0c0c0';
        for (const r of rects) x.fillRect(r[0] + e, r[1] + e, max(1, r[2] - 2.6 * e), max(1, r[3] - 2.6 * e));
        mazeCache = { key, c, pad };
        return mazeCache;
    }
    const ceilPx = v => Math.ceil(v);
    function blank() {
        if (!ctx) return;
        ctx.fillStyle = '#008080'; ctx.fillRect(0, 0, cv.width, cv.height);
    }
    function draw(g) {
        const s = g.s, m = s.maze;
        if (!ctx || !m) return;
        const W = cv.width, H = cv.height, x = ctx;
        const L = layout(m, W, H), k = L.k;
        const X = v => L.ox + v * k, Y = v => L.oy + v * k;
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.fillStyle = '#008080'; x.fillRect(0, 0, W, H);
        const img = mazeImage(m, L);
        x.drawImage(img.c, L.ox - img.pad, L.oy - img.pad);
        // scorch marks where tanks went up
        for (const w of g.wrecks) {
            x.fillStyle = 'rgba(20,20,20,.35)';
            x.beginPath(); x.arc(X(w.x), Y(w.y), 17 * k, 0, PI * 2); x.fill();
        }
        // files on the floor
        for (const p of s.picks) drawFile(x, X(p.x), Y(p.y) + sin(g.t * 3 + p.id) * 1.5 * k, k, TK.WEAPONS[p.w]);
        // my own mines: nobody else sees them
        for (const q of s.mines) {
            if (!isMine(g, q.o) && !(g.over || s.phase === 'end')) continue;
            const armed = q.age >= TK.WEAPON_BY_ID.mine.arm;
            x.globalAlpha = armed ? 0.55 : (floor(g.t * 6) % 2 ? 0.8 : 0.3);
            x.strokeStyle = '#202020'; x.lineWidth = max(1, k * 1.2);
            x.setLineDash([3 * k, 2 * k]);
            x.beginPath(); x.arc(X(q.x), Y(q.y), TK.WEAPON_BY_ID.mine.r * k, 0, PI * 2); x.stroke();
            x.setLineDash([]);
            x.fillStyle = COL(q.o).css;
            x.fillRect(X(q.x) - 3 * k, Y(q.y) - 1 * k, 6 * k, 2 * k); x.fillRect(X(q.x) - 1 * k, Y(q.y) - 3 * k, 2 * k, 6 * k);
            x.globalAlpha = 1;
        }
        // the aim of a loaded beam: a dotted line part of the way
        for (const t of s.tanks) {
            if (!t.alive || t.w !== 'beam') continue;
            const v = g.view[t.i], w = TK.WEAPON_BY_ID.beam;
            const c = S.cast(s, v.x, v.y, v.a, w.range * w.aim, w.bounces, 0, t.i);
            x.strokeStyle = 'rgba(255,40,40,.75)'; x.lineWidth = max(1, k * 1.3); x.setLineDash([4 * k, 4 * k]);
            x.beginPath();
            for (let j = 0; j < c.pts.length; j += 2) (j ? x.lineTo : x.moveTo).call(x, X(c.pts[j]), Y(c.pts[j + 1]));
            x.stroke(); x.setLineDash([]);
        }
        // tanks
        for (const t of s.tanks) if (t.alive) drawTank(x, g.view[t.i], X, Y, k, t.i, t, g);
        // everything flying
        for (const b of s.shells) {
            if (b.life <= 0 || b.age >= b.life) continue;
            const bx = X(b.x), by = Y(b.y);
            if (b.k === 's') {
                x.fillStyle = '#101010'; x.beginPath(); x.arc(bx, by, max(1.6, b.r * k), 0, PI * 2); x.fill();
            } else if (b.k === 'b') {
                x.fillStyle = '#303030'; const r = max(1.2, b.r * k); x.fillRect(bx - r, by - r, r * 2, r * 2);
            } else if (b.k === 'f') {
                x.fillStyle = '#202020'; x.beginPath(); x.arc(bx, by, b.r * k, 0, PI * 2); x.fill();
                x.strokeStyle = floor(g.t * 8) % 2 ? '#ffb000' : '#ff4000'; x.lineWidth = max(1, k * 1.5); x.stroke();
            } else if (b.k === 'm') {
                const a = atan2(b.vy, b.vx);
                x.save(); x.translate(bx, by); x.rotate(a);
                x.fillStyle = '#e0e0e0'; x.fillRect(-7 * k, -2.5 * k, 11 * k, 5 * k);
                x.fillStyle = TK.WEAPON_BY_ID.seeker.col; x.fillRect(2 * k, -2.5 * k, 4 * k, 5 * k);
                x.fillStyle = '#ff9000'; x.fillRect(-10 * k, -1.5 * k, 3 * k, 3 * k);
                x.restore();
            }
        }
        // beams
        for (const b of s.beams) {
            const a = max(0, 1 - b.age / 0.6);
            x.globalAlpha = a;
            x.strokeStyle = '#ff2020'; x.lineWidth = max(2, 4 * k); x.lineCap = 'round';
            x.beginPath();
            for (let j = 0; j < b.pts.length; j += 2) (j ? x.lineTo : x.moveTo).call(x, X(b.pts[j]), Y(b.pts[j + 1]));
            x.stroke();
            x.strokeStyle = '#ffffff'; x.lineWidth = max(1, 1.5 * k); x.stroke();
            x.globalAlpha = 1; x.lineCap = 'butt';
        }
        // smoke, sparks and rings
        for (const p of g.fx) {
            const a = 1 - p.t / p.life;
            if (p.ring) {
                x.strokeStyle = 'rgba(255,220,120,' + a + ')'; x.lineWidth = 3 * k;
                x.beginPath(); x.arc(X(p.x), Y(p.y), (8 + 50 * (1 - a)) * k, 0, PI * 2); x.stroke();
                continue;
            }
            x.globalAlpha = a; x.fillStyle = p.col;
            const r = (p.smoke ? p.size * (1 + p.t * 2) : p.size) * k;
            x.fillRect(X(p.x) - r / 2, Y(p.y) - r / 2, r, r);
        }
        x.globalAlpha = 1;
        if (g.paused) { x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, 0, W, H); }
    }
    function drawTank(x, v, X, Y, k, i, t, g) {
        const col = COL(i);
        x.save();
        x.translate(X(v.x), Y(v.y)); x.rotate(v.a); x.scale(k, k);
        const L = TK.BODY_L, B = TK.BODY_W;
        // treads, with the links going round as it drives
        x.fillStyle = '#202020';
        x.fillRect(-L / 2, -B / 2, L, 6); x.fillRect(-L / 2, B / 2 - 6, L, 6);
        x.fillStyle = '#6a6a6a';
        const off = (v.dist * 0.6) % 5;
        for (let p = -L / 2 + off; p < L / 2 - 1; p += 5) { x.fillRect(p, -B / 2 + 1, 2, 4); x.fillRect(p, B / 2 - 5, 2, 4); }
        // the hull
        x.fillStyle = '#000'; x.fillRect(-L / 2 + 1, -B / 2 + 4, L - 2, B - 8);
        x.fillStyle = col.css; x.fillRect(-L / 2 + 2, -B / 2 + 5, L - 4, B - 10);
        x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(-L / 2 + 2, -B / 2 + 5, L - 4, 1.5);
        // the barrel, and a stripe of the weapon it holds
        const wc = t.w ? TK.WEAPON_BY_ID[t.w].col : '#303030';
        x.fillStyle = '#000'; x.fillRect(0, -2.5, TK.BARREL + 1, 5);
        x.fillStyle = wc; x.fillRect(1, -1.5, TK.BARREL - 1, 3);
        // the turret
        x.fillStyle = '#000'; x.fillRect(-7, -6, 13, 12);
        x.fillStyle = col.dark; x.fillRect(-6, -5, 11, 10);
        x.fillStyle = col.css; x.fillRect(-5, -4, 8, 7);
        x.restore();
        // whose it is, when more than one person shares the screen
        if (isMine(g, i) && (g.locals.length > 1 || g.online)) {
            x.fillStyle = col.css; x.strokeStyle = '#000'; x.lineWidth = 1;
            const tx = X(v.x), ty = Y(v.y) - 22 * k;
            x.beginPath(); x.moveTo(tx - 4 * k, ty - 5 * k); x.lineTo(tx + 4 * k, ty - 5 * k); x.lineTo(tx, ty); x.closePath(); x.fill(); x.stroke();
        }
    }
    // a file lying on the floor: a page with its corner folded, and what it is
    function drawFile(x, cx, cy, k, w) {
        const fw = 18 * k, fh = 22 * k, f = 6 * k;
        const l = cx - fw / 2, t = cy - fh / 2;
        x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(l + 2 * k, t + 2 * k, fw, fh);
        x.fillStyle = '#ffffff'; x.strokeStyle = '#000'; x.lineWidth = max(1, k);
        x.beginPath(); x.moveTo(l, t); x.lineTo(l + fw - f, t); x.lineTo(l + fw, t + f); x.lineTo(l + fw, t + fh); x.lineTo(l, t + fh); x.closePath(); x.fill(); x.stroke();
        x.fillStyle = '#c0c0c0';
        x.beginPath(); x.moveTo(l + fw - f, t); x.lineTo(l + fw - f, t + f); x.lineTo(l + fw, t + f); x.closePath(); x.fill(); x.stroke();
        x.fillStyle = w.col; x.fillRect(l + 2 * k, t + fh - 9 * k, fw - 4 * k, 7 * k);
        x.fillStyle = '#fff'; x.font = 'bold ' + round(7 * k) + 'px Tahoma, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(w.glyph, cx, t + fh - 5.5 * k);
        x.fillStyle = w.col; x.font = 'bold ' + round(9 * k) + 'px Tahoma, sans-serif';
        x.fillText(w.glyph, cx - 1 * k, t + 8 * k);
    }

    // ===============================================================
    // the hud
    // ===============================================================
    function hudPaint(g, now) {
        if (!hud) return;
        const s = g.s;
        const dt = g.hudLast ? (now - g.hudLast) / 1000 : 0;
        g.hudLast = now;
        g.feed.forEach(f => { f.t -= dt; });
        g.feed = g.feed.filter(f => f.t > 0);
        if (g.banner) { g.banner.t -= dt; if (g.banner.t <= 0) { g.banner = null; g.hudAt = 0; } }
        if (g.hudAt && now - g.hudAt < 120) return;
        g.hudAt = now;
        const big = g.over ? '' : g.paused ? '<div class="tk-big">paused<small>p or esc to go on</small></div>'
            : g.banner ? `<div class="tk-big">${esc(g.banner.text)}${g.banner.sub ? `<small>${esc(g.banner.sub)}</small>` : ''}</div>` : '';
        const touch = IS_TOUCH() || g.touch;
        const help = touch ? 'stick to drive · fire to shoot' : g.locals.length > 1 ? g.locals.map((L, k) => `<span style="color:${COL(L.seat).css}">■</span> ${KEYMAP[k].text}`).join(' &nbsp; ') : '<b>arrows</b> or <b>w a s d</b> drive · <b>space</b> fire' + (g.online ? '' : ' · <b>p</b> pause');
        hud.innerHTML = `
            <div class="tk-top">
                <ol class="tk-board">${s.seats.map((p, i) => `<li class="${s.tanks[i].alive ? '' : 'out'}${isMine(g, i) ? ' me' : ''}"><i style="background:${COL(i).css}"></i><span>${esc(p.name)}${p.bot ? ' <em>bot</em>' : ''}</span>${s.tanks[i].w && s.tanks[i].alive ? `<u title="${esc(TK.WEAPON_BY_ID[s.tanks[i].w].name)}" style="color:${TK.WEAPON_BY_ID[s.tanks[i].w].col}">${TK.WEAPON_BY_ID[s.tanks[i].w].glyph}</u>` : ''}<b>${s.scores[i]}</b></li>`).join('')}</ol>
                <div class="tk-round">round ${s.round} · first to ${s.points}${g.ff > 1 ? ' · fast forward' : ''}${g.online ? ' · ' + (onRelays(g) ? 'relays' : 'direct') : ''}</div>
            </div>
            ${big}
            <div class="tk-feed">${g.feed.map(f => `<div style="opacity:${min(1, f.t)}">${esc(f.text)}</div>`).join('')}</div>
            <div class="tk-help">${help}</div>
            ${g.netDown ? '<div class="tk-net">lost the host bradar... waiting for them</div>' : ''}`;
    }
    function paintOver() {
        if (!over) return;
        const g = G;
        if (screen === 'room') { paintRoom(); return; }
        if (screen === 'menu') return;
        if (!g || !g.over) { over.innerHTML = ''; over.classList.remove('on'); return; }
        const st = standings(g);
        const w = g.s.winner >= 0 ? g.s.winner : st[0].i;
        over.classList.add('on');
        const title = isMine(g, w) && g.locals.length <= 1 ? 'you win the match bradar' : esc(g.s.seats[w].name) + ' wins the match';
        over.innerHTML = `<div class="tk-panel" role="dialog" aria-label="the match is over">
            <div class="tk-panel-title">${title}</div>
            ${table(st.map(r => ({ col: r.i, name: r.name + (isMine(g, r.i) && g.locals.length <= 1 ? ' (you)' : ''), bot: r.bot, pts: r.pts, kills: r.kills, deaths: r.deaths, selfs: r.selfs, win: r.i === w })))}
            <div class="tk-btns">${g.online
                ? '<button class="tk-btn tk-go" data-act="room">back to the room</button><button class="tk-btn" data-act="leave">leave</button>'
                : '<button class="tk-btn tk-go" data-act="again">again</button><button class="tk-btn" data-act="menu">menu</button>'}</div>
            ${g.online ? '<div class="tk-note">everybody is back in the room in a moment</div>' : ''}
        </div>`;
    }
    function table(rows) {
        return `<table class="tk-table"><thead><tr><th></th><th>tank</th><th>pts</th><th>hits</th><th>lost</th><th>own goals</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.win ? 'win' : ''}"><td><i style="background:${COL(r.col).css}"></i></td><td>${esc(r.name)}${r.bot ? ' <em>bot</em>' : ''}</td><td><b>${r.pts}</b></td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.selfs}</td></tr>`).join('')}</tbody></table>`;
    }

    // ===============================================================
    // the wire
    // ===============================================================
    const onRelays = g => !!(g.session && g.session.transport && g.session.transport.kind === 'bus');
    function send(g, type, data, toHost, to) {
        if (!g.session || !g.session.alive) return;
        if (toHost) g.session.sendToHost(type, data); else g.session.send(type, data, to);
    }
    function net(g, now) {
        if (g.isHost) {
            const hz = onRelays(g) ? 6 : 20;
            if (now - g.sentAt >= 1000 / hz - 4) { g.sentAt = now; sendSnapshot(g); }
        } else {
            const p = g.pred, L = g.locals[0];
            const gap = onRelays(g) ? 160 : 33;
            const moving = p && L && L.mv;
            if (p && now - g.inputAt > (moving || L.mv !== g.sentMv ? gap : 400)) { g.sentMv = L.mv; sendInput(g); }
        }
    }
    function sendSnapshot(g, to) {
        const d = S.snapshot(g.s);
        d.mt = g.match;
        if (g.ff > 1) d.ff = g.ff;
        if (g.seatsDirty || performance.now() - (g.seatsAt || 0) > 3000 || to) { d.P = S.seatList(g.s); g.seatsAt = performance.now(); g.seatsDirty = false; }
        send(g, 'tk:s', d, false, to);
    }
    function onSnapshot(g, d) {
        if (!d || typeof d !== 'object' || d.mt !== g.match || typeof d.k !== 'number') return;
        if (g.tick0 !== undefined && d.k < g.tick0) return;
        g.tick0 = d.k;
        const now = performance.now();
        g.snapGap = g.snapGap * 0.8 + min(0.5, (now - g.lastSnap) / 1000) * 0.2;
        g.lastSnap = now;
        if (g.netDown) { g.netDown = false; g.hudAt = 0; g.last = now; }
        const s = g.s;
        const was = s.round;
        for (const t of s.tanks) { t.px = t.x; t.py = t.y; }
        if (Array.isArray(d.P)) S.applySeats(s, d.P);
        if (!S.applySnapshot(s, d)) return;
        if (s.round !== was) for (const t of s.tanks) { t.px = t.x; t.py = t.y; }
        g.ffHost = d.ff || 1;
        reconcile(g);
        readEvents(g);
        if (s.phase === 'over' && !g.over) matchOver(g);
    }
    function goneQuiet(g) {
        if (g.over || g.isHost) return;
        g.netDown = true; g.hudAt = 0;
    }

    // ===============================================================
    // the online room
    //
    // `room` is the host's own copy and the only one that changes; `view` is
    // what everybody draws, the host included. Guests send wishes (`tk:want`)
    // and hear back the room (`tk:room`) and the start of a match (`tk:start`).
    // ===============================================================
    let session = null, room = null, view = null, viewAt = 0, shownRev = -1, roomDirty = false, roomSentAt = 0, roomLast = 0;
    let want = { r: false }, wantN = 0, wantAt = 0, wantDirty = false, wantTimer = 0, helloAt = 0, welcomed = new Set(), offs = [], finished = new Set();
    const hostId = () => (session && (session.players.find(p => p.host) || {}).id) || '';
    const mySeat = () => (view && session ? view.seats.find(p => p.id === session.id) || null : null);
    const slowWire = () => !!(session && session.transport && session.transport.kind === 'bus');
    function leaveAll() {
        endMatch();
        offs.forEach(off => { try { off(); } catch (e) { } }); offs = [];
        clearTimeout(wantTimer); wantTimer = 0;
        if (session && session.alive) session.leave();
        session = null; room = null; view = null;
    }
    function endMatch() {
        const g = G;
        if (g && g.offs) g.offs.forEach(off => { try { off(); } catch (e) { } });
        G = null;
        held.clear();
    }
    function enterRoom(s) {
        if (session === s && (screen === 'room' || screen === 'play')) return;
        ensureWindow();
        if (session && session !== s) leaveAll();
        endMatch();
        offs.forEach(off => off()); offs = [];
        session = s; room = null; view = null; shownRev = -1;
        want = { r: false }; wantN = 0; wantDirty = false; helloAt = 0; roomLast = performance.now();
        // the desktop's lobby window closing must not take this room with it
        const started = s.state === 'playing'; s.state = 'playing';
        offs.push(
            s.on('net:down', () => { if (screen === 'room') lost('the host left or stopped answering.'); }),
            s.on('closed', () => { if (screen === 'room' && !s.isHost) lost('the room closed.'); })
        );
        if (s.isHost) {
            const o = s.gameOptions || {};
            room = ROOM.create({ host: s.id, bots: o.bots, level: o.level, points: o.points, size: o.size });
            welcomed = new Set(started ? s.players.map(p => p.id) : []);
            offs.push(
                s.on('roster', reconcileRoom), s.on('player-leave', p => { reconcileRoom(); if (G && G.online) seatLeft(G, p); }),
                s.on('tk:want', (d, from) => {
                    if (!room || !from || !s.player(from.id)) return;
                    if (!ROOM.seat(room, from.id)) reconcileRoom();
                    ROOM.intent(room, from.id, d); publish();
                }),
                s.on('tk:hi', (d, from) => {
                    if (!room || !from || !s.player(from.id)) return;
                    reconcileRoom();
                    s.send('tk:room', ROOM.view(room), from.id);
                    const g = G;
                    if (g && g.online && room.phase === 'match' && g.startMsg && g.startMsg.people.some(p => p.id === from.id)) {
                        s.send('tk:start', g.startMsg, from.id);
                        sendSnapshot(g, from.id);
                    }
                })
            );
            reconcileRoom();
        } else {
            offs.push(
                s.on('tk:room', onRoomView), s.on('tk:start', onRoomStart),
                s.on('player-leave', p => { if (p.host) lost('the host left.', true); })
            );
        }
        showRoom();
        if (!s.isHost) sendWant(true);
        unlock('tankz');
    }
    function lost(why, gone) {
        if (!gone && screen === 'play' && G && !G.over) { goneQuiet(G); return; }
        leaveAll();
        screen = 'menu';
        render();
        over.insertAdjacentHTML('afterbegin', `<div class="tk-lost">${esc(why)} back to the menu.</div>`);
    }
    // host: the room follows the session's roster, both ways
    function reconcileRoom() {
        if (!room || !session) return;
        const s = session;
        for (const p of s.players) {
            ROOM.join(room, p.id, p.name);
            if (p.me || welcomed.has(p.id)) continue;
            // somebody who came through the desktop lobby is still looking at it.
            // this is what brings them to the room
            // said again until they answer from the room: a first one can be lost
            welcomed.add(p.id);
            const hand = n => {
                const seat = room && ROOM.seat(room, p.id);
                if (session !== s || !s.player(p.id) || (seat && seat.n > 0)) return;
                s.send('np:start', { gameId: 'tankz' }, p.id);
                if (n) setTimeout(() => hand(n - 1), 2500);
            };
            hand(4);
        }
        for (const seat of room.seats.slice()) if (!s.player(seat.id)) ROOM.leave(room, seat.id);
        publish();
    }
    function publish() {
        if (!room || !session || room.rev === shownRev) return;
        const next = ROOM.read(ROOM.view(room));
        if (!next) return;
        shownRev = room.rev; view = next; viewAt = performance.now(); roomDirty = true;
        const me = ROOM.seat(room, session.id);
        if (me) want.r = me.ready;
        paintRoom();
    }
    function flushRoom(force) {
        if (!room || !session) return;
        const now = performance.now();
        if (!force && !(roomDirty && now - roomSentAt >= (slowWire() ? 250 : 100)) && now - roomSentAt < 2000) return;
        roomDirty = false; roomSentAt = now;
        session.send('tk:room', ROOM.view(room));
    }
    function launch() {
        const m = ROOM.begin(room, Math.floor(Math.random() * 1e9), Date.now());
        if (!m) return;
        publish(); flushRoom(true);
        session.send('tk:start', m);
        startOnline(session, m);
    }
    // guest: the host's room, and the host's word that a match begins
    function onRoomView(d, from) {
        if (room || !session || !from || from.id !== hostId()) return;
        const next = ROOM.read(d);
        if (!next || (view && next.rev <= view.rev)) return;
        view = next; viewAt = performance.now();
        const me = mySeat();
        if (me && !wantDirty && me.n >= wantN) want.r = me.ready;
        // the host has closed the match this screen is still showing
        const g = G;
        if (g && g.online && screen === 'play' && view.phase !== 'match' && view.last && view.last.match === g.match) backToRoom();
        paintRoom();
    }
    function onRoomStart(d, from) {
        if (room || !session || !from || from.id !== hostId()) return;
        const m = ROOM.readStart(d);
        if (!m || finished.has(m.match) || (G && G.match === m.match)) return;
        if (!m.people.some(p => p.id === session.id)) return;
        startOnline(session, m);
    }
    function sendWant(force) {
        if (!session || room) return;
        clearTimeout(wantTimer); wantTimer = 0;
        const now = performance.now(), gap = slowWire() ? 300 : 120;
        if (!force && now - wantAt < gap) { wantDirty = true; wantTimer = setTimeout(() => sendWant(true), gap - (now - wantAt)); return; }
        wantDirty = false; wantAt = now;
        session.sendToHost('tk:want', { n: ++wantN, r: want.r });
    }
    function setReady(v) {
        const me = mySeat();
        if (!me || !view || view.phase === 'match') return;
        const r = v === undefined ? !want.r : !!v;
        if (r === want.r) return;
        want.r = r;
        if (room) { ROOM.intent(room, session.id, { n: ++wantN, r }); publish(); }
        else { sendWant(); paintRoom(); }
        tone(r ? 880 : 440, 0.08, { type: 'triangle' });
    }
    function hostSet(key, value) {
        if (!room || !session) return;
        if (!ROOM.setOpt(room, session.id, key, key === 'bots' || key === 'points' ? +value : value)) { paintRoom(true); return; }
        // the desktop lobby and the open list read these
        session.setOption(key, String(room.opts[key]));
        savePrefs({ [key]: room.opts[key] });
        publish();
    }
    // every frame while in a room, matches included: the host keeps late arrivals
    // informed and runs the countdown, a guest notices what the network dropped
    function roomTick(now) {
        if (!session) return;
        const elapsed = now - roomLast; roomLast = now;
        if (room) {
            if (ROOM.tick(room, elapsed)) { launch(); return; }
            flushRoom();
        } else if (now - helloAt > 1500) {
            const me = mySeat();
            const unheard = !!me && me.n < wantN && !wantDirty && now - wantAt > 1500;
            const missed = !!me && me.playing && view.phase === 'match' && screen === 'room' && !G;
            if (!me || missed) { helloAt = now; session.sendToHost('tk:hi', {}); }
            if (!me || unheard) { helloAt = now; sendWant(true); }
        }
        if (screen === 'room') paintCount();
    }
    function showRoom() {
        screen = 'room';
        showThumbs(false);
        if (hud) hud.innerHTML = '';
        startAttract();
        over.classList.add('on');
        over.innerHTML = `<div class="tk-room" role="dialog" aria-label="the room">
            <div class="tk-room-title">room <b class="tk-code">${esc(session.code || '')}</b>
                <button class="tk-btn tk-small" data-act="invite">copy the invite link</button><span class="tk-count" aria-live="polite"></span></div>
            <div class="tk-room-cols">
                <div><div class="tk-cap">in the room</div><ol class="tk-seats" id="tk-seats"></ol></div>
                <div><div class="tk-cap">the match</div><div class="tk-room-opts" id="tk-room-opts"></div></div>
            </div>
            <div class="tk-last" id="tk-last"></div>
            <div class="tk-room-foot">
                <button class="tk-btn tk-go tk-ready" data-act="ready" aria-pressed="false">ready</button>
                <span class="tk-status" role="status"></span>
                <button class="tk-btn" data-act="leave">leave the room</button>
            </div>
        </div>`;
        paintRoom(true);
        fit(true);
    }
    function swap(el, html) {
        if (!el || el._tkHtml === html) return false;
        el.innerHTML = html; el._tkHtml = html;
        return true;
    }
    function roomStatus(me) {
        if (!view) return 'getting into the room...';
        if (!me) return 'taking a seat...';
        if (view.phase === 'match') return me.playing ? 'the match is on...' : 'a match is on. you are in the next one';
        if (view.phase === 'countdown') return 'everybody is ready. here we go';
        if (!want.r) return 'say ready. the match starts when everybody has';
        const waiting = view.seats.filter(p => !p.ready && p.id !== me.id).map(p => p.name);
        return waiting.length ? 'waiting for ' + waiting.join(', ') : 'ready';
    }
    function paintRoom(force) {
        if (screen !== 'room' || !session || !over) return;
        const el = over.querySelector('.tk-room');
        if (!el) return;
        const me = mySeat(), host = !!room, hid = view ? view.host : hostId();
        const seats = view ? view.seats.map((p, i) => `<li class="${p.ready ? 'ready' : ''}${session && p.id === session.id ? ' me' : ''}"><i style="background:${COL(i).css}"></i><span>${esc(p.name)}${p.id === hid ? ' <em>host</em>' : ''}${session && p.id === session.id ? ' <em>you</em>' : ''}</span><u>${p.wins ? p.wins + (p.wins === 1 ? ' win' : ' wins') : ''}</u><b>${view.phase === 'match' && !p.playing ? 'next one' : p.ready ? 'ready' : 'not yet'}</b></li>`).join('')
            + Array.from({ length: view.bots }, (_, b) => `<li class="bot"><i style="background:${COL(view.seats.length + b).css}"></i><span>a bot <em>${esc(view.opts.level === 'mixed' ? LEVELS[(view.seats.length + b + 1) % 3] : view.opts.level)}</em></span><u></u><b>ready</b></li>`).join('') : '';
        swap(el.querySelector('#tk-seats'), seats);
        const locked = !host || view.phase !== 'select' || want.r;
        const sel = (k, vals, cur) => `<label>${k === 'bots' ? 'bots' : k === 'level' ? 'how good' : k === 'points' ? 'first to' : 'maze'} <select class="tk-sel" data-room="${k}" ${locked ? 'disabled' : ''}>${vals.map(v => `<option value="${esc(v[0])}" ${String(v[0]) === String(cur) ? 'selected' : ''}>${esc(v[1])}</option>`).join('')}</select></label>`;
        if (view) {
            const o = view.opts;
            const html = sel('bots', [0, 1, 2, 3, 4, 5, 6].map(n => [n, n ? n + (n === 1 ? ' bot' : ' bots') : 'no bots']), o.bots)
                + sel('level', [['easy', 'easy'], ['normal', 'normal'], ['hard', 'hard'], ['mixed', 'a mix']], o.level)
                + sel('points', TK.POINTS.slice().sort((a, b) => a - b).map(p => [p, p + ' points']), o.points)
                + sel('size', TK.SIZES.map(z => [z.id, z.name]), o.size)
                + `<div class="tk-hint">${host ? (locked && view.phase === 'select' ? 'not ready to change these' : 'you are the host: these are yours') : 'the host picks these'}</div>`;
            if (force) el.querySelector('#tk-room-opts')._tkHtml = null;
            swap(el.querySelector('#tk-room-opts'), html);
        }
        const last = view && view.last;
        swap(el.querySelector('#tk-last'), last ? `<div class="tk-cap">the last match${last.winner ? ': ' + esc((last.rows.find(r => r.id === last.winner) || {}).name || '') + ' won' : ''}</div>` + table(last.rows.map(r => Object.assign({}, r, { win: r.id === last.winner }))) : '');
        const ready = el.querySelector('.tk-ready');
        const open = !!me && view.phase !== 'match';
        ready.textContent = want.r ? 'not ready' : 'ready';
        ready.disabled = !open; ready.setAttribute('aria-pressed', String(want.r));
        const line = el.querySelector('.tk-status'), text = roomStatus(me);
        if (line.textContent !== text) line.textContent = text;
        paintCount();
    }
    function paintCount() {
        const el = over && over.querySelector('.tk-count');
        if (!el) return;
        const left = view && view.phase === 'countdown' ? String(max(1, Math.ceil((view.count - (performance.now() - viewAt)) / 1000))) : '';
        if (el.textContent !== left) el.textContent = left;
    }
    function backToRoom() {
        if (!session) { openMenu(); return; }
        if (G && G.match) finished.add(G.match);
        endMatch();
        showRoom();
    }
    // host: the match is over. The table goes into the room after a moment, and everybody is back
    function hostFinish(g) {
        const st = standings(g);
        const w = g.s.winner >= 0 ? g.s.winner : st[0].i;
        const res = {
            match: g.match, winner: g.s.seats[w].bot ? '' : g.s.seats[w].id,
            rows: st.map(r => ({ id: r.id, name: r.name, pts: r.pts, kills: r.kills, deaths: r.deaths, selfs: r.selfs, bot: !!r.bot, col: r.i }))
        };
        setTimeout(() => {
            if (!room || room.matchId !== g.match) return;
            ROOM.finish(room, res); publish(); flushRoom(true);
            if (G === g && screen === 'play') backToRoom();
        }, 5500);
    }
    function startOnline(s, m) {
        ensureWindow();
        stopAttract();
        endMatch();
        const people = m.people.map(p => ({ id: p.id, name: p.name }));
        const seats = seatsFor(people, m.bots, m.opts.level, m.seed);
        const isHost = !!s.isHost;
        const me = people.findIndex(p => p.id === s.id);
        const g = makeGame({ seed: m.seed, seats, points: m.opts.points, size: m.opts.size, session: s, isHost, me, locals: me >= 0 ? [{ seat: me, mv: 0, fp: 0 }] : [], match: m.match });
        g.startMsg = m;
        if (isHost) g.s.tanks.forEach((t, i) => { if (!seats[i].bot && seats[i].id !== s.id) t.remote = true; });
        G = g;
        bindNet(g);
        screen = 'play';
        render();
        if (isHost) sendSnapshot(g);
        else s.sendToHost('tk:hi', {});
        unlock('tankz');
    }
    function bindNet(g) {
        const s = g.session, o = [];
        if (g.isHost) {
            o.push(s.on('tk:i', (d, from) => hostInput(g, d, from)));
        } else {
            o.push(s.on('tk:s', d => onSnapshot(g, d)));
            o.push(s.on('net:down', () => goneQuiet(g)));
        }
        g.offs = o;
    }
    // host: somebody walked out in the middle of a match. A bot drives on for them
    function seatLeft(g, p) {
        const s = g.s, i = s.seats.findIndex(x => x.id === p.id);
        if (i < 0 || s.seats[i].bot) return;
        S.seatBot(s, i, 'normal');
        g.seatsDirty = true;
        say(g, (p.name || 'somebody') + ' left. a bot drives on for them', 4);
    }

    // ===============================================================
    // starting things
    // ===============================================================
    function startLocal(o) {
        ensureWindow();
        stopAttract();
        if (session) leaveAll(); else endMatch();
        const p = Object.assign(prefs(), o || {});
        savePrefs({ humans: p.humans, bots: p.bots, level: p.level, points: p.points, size: p.size });
        const seed = (o && o.seed) || ((Math.random() * 1e9) >>> 0);
        const name = (window.Netplay && Netplay.profile && Netplay.profile().name) || 'you';
        const humans = max(1, min(TK.MAX_LOCAL, p.humans));
        const people = Array.from({ length: humans }, (_, k) => ({ id: 'p' + k, name: humans === 1 ? name : 'player ' + (k + 1), local: k }));
        const bots = max(humans === 1 ? 1 : 0, min(TK.MAX_TANKS - humans, p.bots));
        const seats = seatsFor(people, bots, p.level, seed);
        G = makeGame({ seed, seats, points: p.points, size: p.size, locals: people.map((x, k) => ({ seat: k, mv: 0, fp: 0 })), me: 0 });
        screen = 'play';
        render();
        unlock('tankz');
    }

    // ===============================================================
    // screens
    // ===============================================================
    function render() {
        if (!root) return;
        if (screen === 'menu') {
            showThumbs(false);
            hud.innerHTML = '';
            over.classList.add('on');
            over.innerHTML = menuHtml();
            startAttract();
        } else if (screen === 'room') {
            showRoom();
        } else {
            over.innerHTML = ''; over.classList.remove('on');
            showThumbs(IS_TOUCH() || (G && G.touch));
            if (G && G.over) paintOver();
        }
        fit(true);
    }
    function menuHtml() {
        const p = prefs(), m = loadMeta();
        const sel = (k, vals, cur) => `<select class="tk-sel" data-k="${k}">${vals.map(v => `<option value="${esc(v[0])}" ${String(v[0]) === String(cur) ? 'selected' : ''}>${esc(v[1])}</option>`).join('')}</select>`;
        const touch = IS_TOUCH();
        return `<div class="tk-menu">
            <div class="tk-logo">tankz<span>98</span></div>
            <div class="tk-sub">tanks in a maze. shells bounce off the walls and don't care whose they are: yours can get you. the last tank standing takes the round. files on the floor are weapons.</div>
            <div class="tk-opts">
                <label>at this keyboard ${sel('humans', [[1, '1 person'], [2, '2 people'], [3, '3 people']], p.humans)}</label>
                <label>bots ${sel('bots', [0, 1, 2, 3, 4, 5, 6].map(n => [n, n ? n + (n === 1 ? ' bot' : ' bots') : 'no bots']), p.bots)}</label>
                <label>how good ${sel('level', [['easy', 'easy'], ['normal', 'normal'], ['hard', 'hard'], ['mixed', 'a mix']], p.level)}</label>
                <label>first to ${sel('points', TK.POINTS.slice().sort((a, b) => a - b).map(n => [n, n + ' points']), p.points)}</label>
                <label>maze ${sel('size', TK.SIZES.map(z => [z.id, z.name]), p.size)}</label>
            </div>
            <div class="tk-btns">
                <button class="tk-btn tk-go" data-act="local">play</button>
                <button class="tk-btn" data-act="online">online, 2 to 6</button>
            </div>
            <div class="tk-keys">${touch ? 'the stick on the left drives, the button on the right fires.' : KEYMAP.map((k, i) => `<span><i style="background:${COL(i).css}"></i>${k.text}</span>`).join('') + '<br>alone at the keyboard: <b>arrows</b> or <b>w a s d</b>, and <b>space</b> fires.'}</div>
            <div class="tk-files">${TK.WEAPONS.map(w => `<span title="${esc(fileHelp[w.id])}"><u style="background:${w.col}">${w.glyph}</u>${esc(w.name)}</span>`).join('')}</div>
            <div class="tk-rec">${m.matches ? `matches ${m.matches} · won ${m.wins} · rounds won ${m.roundWins} of ${m.rounds} · hits ${m.kills} · own goals ${m.selfs}` : 'no matches yet bradar'}</div>
        </div>`;
    }
    const fileHelp = {
        beam: 'a line of light that comes off walls. it shows you where it goes first',
        frag: 'a fat shell. fire again and it bursts into shrapnel',
        seeker: 'flies straight for a second, then goes for the nearest tank. any tank',
        mine: 'left behind you. nobody but you can see it',
        burst: 'a stream of small shells, one after another',
        scatter: 'a cone of pellets, all at once'
    };
    function onOverChange(ev) {
        const el = ev.target;
        if (el.dataset.k) {
            const k = el.dataset.k, v = el.value;
            savePrefs({ [k]: k === 'level' || k === 'size' ? v : +v });
        } else if (el.dataset.room) hostSet(el.dataset.room, el.value);
    }
    function onOverClick(ev) {
        const b = ev.target.closest('[data-act]');
        if (b) act(b.dataset.act);
    }
    function act(a) {
        const g = G;
        switch (a) {
            case 'local': startLocal(); break;
            case 'online':
                if (typeof openNetplay === 'function') openNetplay({ gameId: 'tankz' });
                else if (window.Netplay) Netplay.openLobby({ gameId: 'tankz' });
                break;
            case 'again': if (g) startLocal({ seed: (Math.random() * 1e9) >>> 0 }); break;
            case 'menu': openMenuFresh(); break;
            case 'ready': setReady(); break;
            case 'room': backToRoom(); break;
            case 'leave': leaveAll(); openMenuFresh(); break;
            case 'invite': {
                if (!session || !window.Netplay) break;
                const link = Netplay.inviteLink(session.code, 'tankz');
                const done = () => { if (typeof toast === 'function') toast('tankz 98', 'invite link copied'); };
                try { navigator.clipboard.writeText(link).then(done, () => window.prompt('the invite link', link)); } catch (e) { window.prompt('the invite link', link); }
                break;
            }
        }
    }
    function openMenuFresh() { endMatch(); screen = 'menu'; render(); }

    // ---------------------------------------------------------------
    // behind the menu and the room: four bots at it
    // ---------------------------------------------------------------
    let attract = null;
    function startAttract() {
        if (attract) return;
        const seed = (Math.random() * 1e9) >>> 0;
        const seats = seatsFor([], 4, 'hard', seed);
        attract = makeGame({ seed, seats, points: 10, size: 'small' });
        attract.s.quiet = true;
    }
    function stopAttract() { attract = null; }
    function attractFrame(now) {
        const g = attract;
        const dt = min(0.1, (now - g.last) / 1000);
        g.last = now; g.t += dt;
        g.acc += dt;
        while (g.acc >= DT) {
            g.acc -= DT;
            for (let i = 0; i < g.s.n; i++) { const b = botFor(g, i); if (b) S.think(g.s, i, b); }
            S.step(g.s);
            if (g.s.phase === 'over') { attract = null; startAttract(); return; }
        }
        for (const e of g.s.events) if (e.e === 'die') boom(g, e.x, e.y, COL(e.i).css, 30);
        g.s.events.length = 0;
        place(g, dt);
        draw(g, dt);
    }

    // ===============================================================
    // the way in
    // ===============================================================
    function openMenu() {
        ensureWindow();
        if ((G && screen === 'play') || screen === 'room') return;
        endMatch();
        screen = 'menu';
        render();
    }
    window.startTankz = openMenu;
    // the lobby's picture of a player: a tank in their seat's colour
    function paintAvatar(canvas) {
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        const s = window.Netplay && Netplay.current;
        const i = s ? max(0, s.players.findIndex(p => p.id === canvas.dataset.pid)) : 0;
        c.fillStyle = '#0d8d8d'; c.fillRect(0, 0, w, h);
        const k = min(w, h) / 40;
        const v = { x: 0, y: 0, a: -PI / 4, dist: 0 };
        drawTank(c, v, () => w / 2, () => h / 2, k, i, { w: '' }, { locals: [], online: false });
    }
    if (window.Netplay) {
        Netplay.registerGame({
            id: 'tankz',
            name: 'tankz 98',
            start: (s, opts) => { if (opts && opts.solo) { openMenu(); return; } enterRoom(s); },
            startSolo: () => startLocal(),
            soloLabel: 'against bots',
            paintAvatar
        });
    }
    // for the browser test: the state, a clock it can turn up, the room
    window.TK_ENGINE = {
        state: () => G, screen: () => screen, startLocal, act, fire, clock: n => { testClock = max(1, +n || 1); }, meta: () => loadMeta(),
        room: () => view, hostRoom: () => room, want: () => want, ready: setReady, set: hostSet,
        // a bot at the controls of a person's tank, on the host, so a test can leave a match running
        drive: (i, level) => {
            if (G && G.isHost) { G.autopilot = G.autopilot || []; G.autopilot[i] = level ? Object.assign(S.newBot(level, 77 + i), { fp: G.s.tanks[i].in.fp }) : null; }
            else if (G) G.autopilot = level ? S.newBot(level, 91) : null;
        },
        give: (i, w) => { if (G && G.isHost && G.s.tanks[i]) G.s.tanks[i].w = w; },
        fit: () => fit(true)
    };
})();
