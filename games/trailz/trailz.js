// ===================================================================
// trailz 98 — the window, the keys and thumbs, the camera, and the wire
//
// trailz-sim.js is the rules and trailz-gl.js the picture; this is what sits
// between them and a person. The sim steps at a fixed 60 a second whatever
// the screen does, and the picture is drawn as often as the screen wants,
// with each cycle carried on from its last step to now.
//
// Online is host authoritative, through games/netplay.js:
//
//   the host runs the sim, the bots and its own cycle, and sends snapshots:
//   20 a second straight across, 6 over the relays
//   a guest runs no rules at all. Everybody else's cycle is drawn where the
//   last snapshot put it, carried on along its line for as long as the
//   snapshot is old (and never through a wall). Its own cycle is its own:
//   a turn happens on the guest's screen the moment the key goes down, and
//   goes to the host with the place it happened. The host puts it there
//   (TZ_SIM.turnAt), so a turn pressed in time is a turn in time, whatever
//   the ping. Every message from a guest carries all its turns the host has
//   not acknowledged yet, so a lost one costs nothing
//
// Empty seats get bots; a guest who leaves is replaced by one at once, and
// somebody joining with the code takes a bot's seat, the one they left if
// it was theirs. The host leaving ends the match: there is no host migration.
// ===================================================================
(function () {
    'use strict';

    const TZ = window.TZ, S = window.TZ_SIM, GL = window.TZ_GL;
    if (!TZ || !S || !GL) { console.warn('[trailz] a file is missing'); return; }
    const { min, max, floor, round, abs, sin, cos, atan2, PI, hypot, sqrt } = Math;
    const DT = 1 / TZ.TICK;
    const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
    const META_KEY = 'mrhakan98-trailz-meta', PREFS_KEY = 'mrhakan98-trailz-prefs';
    const CAMS = ['chase', 'high', 'arena'];
    const CAM_NAMES = { chase: 'behind the cycle', high: 'panorama', arena: 'the whole arena' };
    const LEVELS = ['easy', 'normal', 'hard'];

    function ensureCss() {
        if (document.getElementById('tz-css')) return;
        const l = document.createElement('link');
        l.id = 'tz-css'; l.rel = 'stylesheet'; l.href = 'games/trailz/trailz.css';
        document.head.appendChild(l);
    }
    const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
    function prefs() {
        const p = readJson(PREFS_KEY) || {};
        return {
            cam: CAMS.includes(p.cam) ? p.cam : 'chase',
            bots: Number.isInteger(p.bots) && p.bots >= 1 && p.bots <= 7 ? p.bots : 3,
            level: LEVELS.concat('mixed').includes(p.level) ? p.level : 'normal',
            arena: TZ.ARENA_BY_ID[p.arena] ? p.arena : 'medium',
            rounds: TZ.ROUNDS.includes(p.rounds) ? p.rounds : 5
        };
    }
    function savePrefs(o) { writeJson(PREFS_KEY, Object.assign(prefs(), o)); }
    function loadMeta() {
        const m = readJson(META_KEY);
        const o = m && typeof m === 'object' ? m : {};
        const n = v => (Number.isFinite(+v) && +v >= 0 ? +v : 0);
        return { matches: n(o.matches), wins: n(o.wins), rounds: n(o.rounds), roundWins: n(o.roundWins), best: n(o.best), online: n(o.online) };
    }

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
    function crashSound(near) {
        if (!soundOn()) return;
        const ctx = audio();
        if (!ctx) return;
        try {
            const t0 = ctx.currentTime, dur = 0.5;
            const n = floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
            for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) * (1 - i / n);
            const src = ctx.createBufferSource(); src.buffer = b;
            const f = ctx.createBiquadFilter(); f.type = 'lowpass';
            f.frequency.setValueAtTime(3000, t0); f.frequency.exponentialRampToValueAtTime(120, t0 + dur);
            const g = ctx.createGain(); g.gain.setValueAtTime(near ? 0.12 : 0.04, t0);
            src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t0);
        } catch (e) { }
    }
    const sfx = {
        turn: () => tone(520, 0.04, { type: 'triangle', gain: 0.025 }),
        count: () => tone(440, 0.12),
        go: () => tone(880, 0.25, { slideTo: 1320 }),
        win: () => { tone(660, 0.12); tone(880, 0.12, { delay: 0.12 }); tone(1320, 0.3, { delay: 0.24 }); },
        lose: () => tone(300, 0.4, { slideTo: 90, type: 'sawtooth', gain: 0.03 })
    };

    // ===============================================================
    // the window
    // ===============================================================
    let winRef = null, root = null, G = null, screen = 'menu', raf = 0, testClock = 1;
    let R = null, cv = null, cv2 = null, stage = null, hud = null;
    const IS_TOUCH = () => { try { return !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } };
    function ensureWindow() {
        ensureCss();
        if (winRef && winRef.win && document.getElementById(winRef.win.id)) return winRef;
        const vw = typeof viewportWidth === 'function' ? viewportWidth() : 1100;
        winRef = createAppWindow('trailz 98', { icon: 'bolt', width: min(1100, vw - 20) });
        winRef.body.classList.add('tz-body');
        if (document.documentElement.clientHeight < 600) winRef.win.style.top = '0px';
        else if (document.documentElement.clientHeight < 900) winRef.win.style.top = '30px';
        winRef.win._cleanup = () => {
            tearDown();
            stopLoop();
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('resize', onResize);
            R = null; cv = null; cv2 = null; stage = null; hud = null; root = null; winRef = null;
        };
        root = winRef.body;
        root.innerHTML = `
            <div class="tz-stage" id="tz-stage">
                <canvas id="tz-canvas" class="tz-canvas" aria-label="the arena"></canvas>
                <div class="tz-hud" id="tz-hud" aria-live="polite"></div>
                <div class="tz-thumbs" id="tz-thumbs" hidden>
                    <div class="tz-thumb tz-thumb-l" data-turn="-1"><span>&#9664;</span></div>
                    <div class="tz-thumb tz-thumb-r" data-turn="1"><span>&#9654;</span></div>
                    <button class="tz-brake" id="tz-brake" aria-label="brake">brake</button>
                </div>
                <div class="tz-over" id="tz-over"></div>
            </div>`;
        stage = root.querySelector('#tz-stage');
        cv = root.querySelector('#tz-canvas');
        hud = root.querySelector('#tz-hud');
        try { R = GL.create(cv); } catch (e) { R = null; }
        if (!R) {
            // no webgl here: the same game, drawn flat from above
            cv2 = cv.getContext('2d');
            stage.classList.add('tz-flat');
        }
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('resize', onResize);
        bindThumbs();
        startLoop();
        return winRef;
    }
    function onResize() { fitAt = 0; }
    function tearDown() {
        const g = G;
        if (g) {
            if (g.offs) g.offs.forEach(off => { try { off(); } catch (e) { } });
            if (g.session && !g.solo && g.session.alive) g.session.leave();
        }
        G = null;
    }
    function onTop() {
        if (!winRef || !winRef.win || winRef.win.style.display === 'none') return false;
        const z = +winRef.win.style.zIndex || 0;
        return ![...document.querySelectorAll('.app-window, .ie-window')].some(w => w !== winRef.win && w.style.display !== 'none' && (+w.style.zIndex || 0) > z);
    }

    // ---------------------------------------------------------------
    // fitting the stage into the window, and the canvas to the screen's pixels
    // ---------------------------------------------------------------
    let fitAt = 0;
    function sideways() {
        const win = winRef && winRef.win;
        if (!win || typeof enterFauxFullscreen !== 'function') return;
        const land = window.innerWidth > window.innerHeight;
        const touchy = IS_TOUCH();
        const ours = typeof fauxFullscreenWin !== 'undefined' && fauxFullscreenWin === win;
        if (win._tzLand !== land) { win._tzLand = land; win._tzDeclined = false; }
        if (win._tzAutoFs && !win.classList.contains('fs-active')) { win._tzAutoFs = false; win._tzDeclined = true; }
        // a phone on its side plays fullscreen; turned back up, it gives the screen back
        if (land && touchy && screen === 'play' && !win._tzDeclined && !win.classList.contains('fs-active') && !(typeof fullscreenWindow === 'function' && fullscreenWindow())) {
            enterFauxFullscreen(win); win._tzAutoFs = true; fitAt = 0;
        } else if (!land && win._tzAutoFs && ours) {
            win._tzAutoFs = false; exitFauxFullscreen(); fitAt = 0;
        }
    }
    function fit(force) {
        if (!stage || !root) return;
        const now = performance.now();
        if (!force && fitAt && now - fitAt < 250) return;
        fitAt = now;
        sideways();
        const fs = winRef && winRef.win.classList.contains('fs-active');
        const rect = root.getBoundingClientRect();
        const vh = document.documentElement.clientHeight || window.innerHeight || 700;
        const cs = getComputedStyle(root);
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const w = max(160, floor(root.clientWidth - padX));
        let h;
        if (fs) h = max(120, root.clientHeight - padY);
        else {
            const room = vh - max(0, rect.top) - 8;
            h = max(140, min(w * 9 / 16, room));
            // a phone held upright gets a taller picture, with room for the thumbs
            if (w < 560 && vh > w) h = max(140, min(w * 1.3, room));
        }
        h = floor(h);
        if (stage.style.width !== w + 'px' || stage.style.height !== h + 'px') { stage.style.width = w + 'px'; stage.style.height = h + 'px'; }
        if (cv.style.width !== w + 'px' || cv.style.height !== h + 'px') { cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
        // the screen's own pixels (devicePixelRatio already carries the site's zoom),
        // up to about two million of them: past that a laptop's fan is all you get
        let k = min(2, window.devicePixelRatio || 1);
        const budget = 2.1e6;
        if (w * h * k * k > budget) k = sqrt(budget / (w * h));
        const bw = max(1, round(w * k)), bh = max(1, round(h * k));
        if (R) R.resize(bw, bh);
        else if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    }

    // ===============================================================
    // a game: the sim, and what the screen keeps about it
    // ===============================================================
    function seatsFor(o) {
        // people first, then bots, as many as the arena wants
        const out = (o.people || []).map(p => ({ id: p.id, name: p.name }));
        const total = max(out.length, min(TZ.MAX_SEATS, o.cycles || out.length));
        const used = new Set(out.map(p => p.name));
        let b = 0;
        while (out.length < total) {
            const lv = o.level === 'mixed' ? LEVELS[(out.length + 1) % 3] : (LEVELS.includes(o.level) ? o.level : 'normal');
            let name = TZ.BOT_NAMES[(o.seed + b++) % TZ.BOT_NAMES.length];
            if (used.has(name)) name += b;
            used.add(name);
            out.push({ id: 'bot' + out.length, name, bot: lv });
        }
        return out;
    }
    function makeGame(o) {
        const s = S.newMatch({ seed: o.seed, seats: o.seats, arena: o.arena, rounds: o.rounds, puppet: !o.isHost });
        const g = {
            s, solo: !o.session, session: o.session || null, isHost: !o.session || !!o.isHost,
            me: o.me === undefined ? 0 : o.me, opts: o, bots: [], acc: 0, last: performance.now(), t: 0,
            cam: { mode: prefs().cam, yaw: 0, eye: null, at: null, follow: -1, orbit: 0 },
            view: [], sparks: [], feed: [], banner: null, over: false, recorded: false,
            // the wire
            sentAt: 0, seatsAt: 0, seatsDirty: true, acks: [], inSeq: [], lastSnap: 0, netDown: false,
            pred: null, pending: [], seq: 0, brake: false, keys: { l: 0, r: 0 }, localQ: [], lastTurnT: -1,
            fps: 0, frames: 0, fpsAt: performance.now(), hudAt: 0, lastPhase: s.phase, lastCount: -1
        };
        for (let i = 0; i < s.n; i++) g.view.push({ i, x: 0, z: 0, yaw: 0, roll: 0, alive: true, col: TZ.COLORS[i % TZ.COLORS.length].rgb, fade: 1, gone: false, pts: null });
        if (g.isHost) s.seats.forEach((p, i) => { if (p.bot) g.bots[i] = S.newBot(p.bot, (o.seed * 13 + i * 7) >>> 0); });
        g.cam.yaw = (s.cycles[g.me] ? s.cycles[g.me].dir : 0) * PI / 2;
        return g;
    }
    function botFor(g, i) {
        const p = g.s.seats[i];
        if (!p || !p.bot) { g.bots[i] = null; return null; }
        if (!g.bots[i] || g.bots[i].level !== p.bot) g.bots[i] = S.newBot(p.bot, (g.s.seed * 13 + i * 7) >>> 0);
        return g.bots[i];
    }

    // ---------------------------------------------------------------
    // the loop
    // ---------------------------------------------------------------
    function startLoop() { if (!raf) { const tick = () => { raf = requestAnimationFrame(tick); frame(); }; raf = requestAnimationFrame(tick); } }
    function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    function frame() {
        if (!root || !document.getElementById('tz-stage')) { stopLoop(); return; }
        fit();
        const g = G;
        const now = performance.now();
        if (!g) { if (attract) attractFrame(now); return; }
        let dt = min(0.1, (now - g.last) / 1000);
        g.last = now;
        g.t += dt;
        g.frames++;
        if (now - g.fpsAt > 1000) { g.fps = g.frames * 1000 / (now - g.fpsAt); g.frames = 0; g.fpsAt = now; }
        if (g.isHost) hostSteps(g, dt);
        else guestFrame(g, dt);
        readEvents(g);
        draw(g, dt);
        hudPaint(g, now);
        if (!g.solo) net(g, now);
    }
    function hostSteps(g, dt) {
        const s = g.s;
        if (g.netDown || s.phase === 'over') return;
        // with nobody left riding but bots, the round is run out at three times the speed
        const ff = s.phase === 'race' && !S.humansLeft(s) ? 3 : 1;
        g.ff = ff;
        g.acc += dt * ff * testClock;
        let n = 0;
        const cap = 12 * testClock * ff;
        while (g.acc >= DT && n++ < cap) {
            g.acc -= DT;
            applyLocal(g);
            for (let i = 0; i < s.n; i++) { const b = botFor(g, i) || (g.autopilot && g.autopilot[i]); if (b) S.think(s, i, b); }
            S.step(s);
            readEvents(g);
            if (s.phase === 'over') { g.acc = 0; break; }
        }
        if (g.acc > DT * 4) g.acc = DT * 4;
    }
    // the keys of whoever sits at this screen, on the host: straight into the sim
    function applyLocal(g) {
        const s = g.s, c = s.cycles[g.me];
        if (!c) return;
        while (g.localQ.length) S.turn(s, g.me, g.localQ.shift());
        S.brake(s, g.me, g.brake);
    }

    // ===============================================================
    // input
    // ===============================================================
    function press(d) {
        const g = G;
        if (!g || screen !== 'play' || g.over) return;
        const s = g.s, c = s.cycles[g.me];
        if (!c || !c.alive || s.phase !== 'race') { if (!c || !c.alive) spectate(g, d); return; }
        sfx.turn();
        if (g.isHost) { g.localQ.push(d); return; }
        guestTurn(g, d);
    }
    function setBrake(on) {
        const g = G;
        if (!g || g.brake === !!on) return;
        g.brake = !!on;
        if (!g.isHost) sendInput(g);
    }
    const KEYS_L = ['ArrowLeft', 'a', 'A', 'q', 'Q'], KEYS_R = ['ArrowRight', 'd', 'D', 'e', 'E'], KEYS_B = ['ArrowDown', 's', 'S', ' '];
    function onKey(ev) {
        const tag = (ev.target && ev.target.tagName) || '';
        if (screen !== 'play' || !G || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !onTop()) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const k = ev.key;
        const mine = () => { ev.preventDefault(); ev.stopPropagation(); };
        if (KEYS_L.includes(k)) { mine(); if (!ev.repeat) press(-1); }
        else if (KEYS_R.includes(k)) { mine(); if (!ev.repeat) press(1); }
        else if (KEYS_B.includes(k)) { mine(); setBrake(true); }
        else if (k === 'c' || k === 'C' || k === 'v' || k === 'V') { mine(); cycleCam(); }
        else if (k === 'ArrowUp' || k === 'w' || k === 'W') { mine(); }
    }
    function onKeyUp(ev) {
        if (!G) return;
        if (KEYS_B.includes(ev.key)) { setBrake(false); if (screen === 'play') ev.preventDefault(); }
    }
    function cycleCam() {
        const g = G;
        if (!g) return;
        g.cam.mode = CAMS[(CAMS.indexOf(g.cam.mode) + 1) % CAMS.length];
        savePrefs({ cam: g.cam.mode });
        say(g, 'camera: ' + CAM_NAMES[g.cam.mode]);
    }
    // the thumbs: either half of the picture turns that way, the button in the middle brakes
    function bindThumbs() {
        const t = root.querySelector('#tz-thumbs');
        const zones = t.querySelectorAll('.tz-thumb');
        zones.forEach(z => {
            z.addEventListener('pointerdown', ev => { ev.preventDefault(); z.classList.add('on'); press(+z.dataset.turn); }, { passive: false });
            const off = () => z.classList.remove('on');
            z.addEventListener('pointerup', off); z.addEventListener('pointercancel', off); z.addEventListener('pointerleave', off);
        });
        const b = t.querySelector('#tz-brake');
        b.addEventListener('pointerdown', ev => { ev.preventDefault(); b.classList.add('on'); setBrake(true); }, { passive: false });
        const up = () => { b.classList.remove('on'); setBrake(false); };
        b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
        // no context menu or double tap zoom on a long press
        stage.addEventListener('contextmenu', ev => { if (screen === 'play') ev.preventDefault(); });
    }
    function showThumbs(on) {
        const t = root && root.querySelector('#tz-thumbs');
        if (t) t.hidden = !on;
    }
    // out of the round: the keys pick whose cycle to watch
    function spectate(g, d) {
        const alive = g.s.cycles.filter(c => c.alive).map(c => c.i);
        if (!alive.length) return;
        const k = alive.indexOf(g.cam.follow);
        g.cam.follow = alive[(k + d + alive.length) % alive.length];
    }

    // ===============================================================
    // the guest's own cycle
    //
    // pred is where this screen has its own cycle: the host's last word on it,
    // plus every turn made here since that the host has not acknowledged, driven
    // on at the speed the host last gave it.
    // ===============================================================
    function guestTurn(g, d) {
        const s = g.s, p = g.pred;
        if (!p || !p.alive) return;
        // the same gap the host keeps between two turns
        if (g.t - g.lastTurnT < TZ.TURN_GAP * DT) { g.localQ.push(d); return; }
        doGuestTurn(g, d);
    }
    function doGuestTurn(g, d) {
        const p = g.pred;
        g.lastTurnT = g.t;
        const at = (p.dir & 1) ? p.z : p.x;
        const k = p.confirmed + g.pending.length;
        g.pending.push({ n: ++g.seq, d, at: round(at * 1000) / 1000, k });
        p.pts.push(p.x, p.z);
        p.dir = (p.dir + d + 4) & 3;
        sendInput(g);
    }
    function sendInput(g) {
        g.inputAt = performance.now();
        send(g, 'tz:i', { t: g.pending.slice(-8).map(q => [q.n, q.d, q.at, q.k]), b: g.brake ? 1 : 0 }, true);
    }
    function guestFrame(g, dt) {
        const s = g.s, p = g.pred;
        if (!p || g.netDown) return;
        const ff = g.ffHost || 1;
        if (g.localQ.length && g.t - g.lastTurnT >= TZ.TURN_GAP * DT) doGuestTurn(g, g.localQ.shift());
        if (p.alive && s.phase === 'race') {
            // on along its line, and never through a wall
            const want = p.speed * dt * ff;
            // the ray is asked of the host's walls with this screen's own line left out
            const hit = S.rayHit(s, p.x, p.z, p.dir, want + 0.05, g.me);
            const go = max(0, min(want, hit.d - 0.05));
            p.x += S.DX[p.dir] * go; p.z += S.DZ[p.dir] * go;
        }
    }
    // a snapshot's word on my own cycle
    function reconcile(g, d) {
        const s = g.s, c = s.cycles[g.me];
        if (!c) return;
        const p = g.pred || (g.pred = { x: c.x, z: c.z, dir: c.dir, speed: c.speed, alive: c.alive, pts: c.pts.slice(), confirmed: S.turnsOf(c) });
        const acked = Array.isArray(d.ak) ? (+d.ak[g.me] || 0) : 0;
        g.pending = g.pending.filter(q => q.n > acked);
        p.speed = c.speed;
        p.confirmed = S.turnsOf(c);
        if (!c.alive || s.phase !== 'race') {
            Object.assign(p, { x: c.x, z: c.z, dir: c.dir, alive: c.alive, pts: c.pts.slice() });
            g.pending.length = 0;
            return;
        }
        p.alive = true;
        if (g.pending.length) return;
        // everything I did is in: the host's line is my line, and I am where it says, plus the trip
        const lead = min(0.6, (performance.now() - g.lastSnap) / 1000 + latency(g));
        const hx = c.x + S.DX[c.dir] * c.speed * lead, hz = c.z + S.DZ[c.dir] * c.speed * lead;
        const sameLine = p.dir === c.dir && p.pts.length === c.pts.length;
        const off = abs(hx - p.x) + abs(hz - p.z);
        p.pts = c.pts.slice();
        if (!sameLine || off > 6) { p.x = hx; p.z = hz; p.dir = c.dir; }
        else { p.x += (hx - p.x) * 0.25; p.z += (hz - p.z) * 0.25; }
        // stay on the line, whatever the blend did
        if (p.dir & 1) p.x = c.x; else p.z = c.z;
    }
    // half a round trip: this screen's own measure of it (a ping to the host every
    // two seconds), or until there is one, the lobby's
    function latency(g) {
        const s = g.session;
        if (!s) return 0;
        if (g.rtt) return min(0.45, g.rtt / 2000);
        const me = s.players && s.players.find(x => x.me);
        const host = s.players && s.players.find(x => x.host);
        const ping = (me && me.ping) || (host && host.ping) || (s.transport && s.transport.kind === 'bus' ? 300 : 60);
        return min(0.4, ping / 2000);
    }

    // ===============================================================
    // what happened: the sim's events, for the screen
    // ===============================================================
    function nameOf(g, i) { const p = g.s.seats[i]; return i === g.me ? 'you' : (p ? p.name : 'somebody'); }
    function say(g, text, t) { g.feed.unshift({ text, t: t || 4 }); g.feed.length = min(g.feed.length, 5); g.hudAt = 0; }
    function banner(g, text, sub, t) { g.banner = { text, sub: sub || '', t: t || 2.6 }; g.hudAt = 0; }
    function readEvents(g) {
        const s = g.s;
        if (!s.events.length) return;
        const evs = s.events.splice(0, s.events.length);
        for (const e of evs) {
            if (e.e === 'die') {
                const c = s.cycles[e.i];
                burst(g, e.x, e.z, TZ.COLORS[e.i % 8].rgb, 90);
                crashSound(e.i === g.me || e.i === g.cam.follow);
                const by = c && c.cause ? c.cause.by : e.by;
                const head = c && c.cause ? c.cause.head : e.head;
                const who = nameOf(g, e.i);
                let text;
                if (!g.isHost && by === undefined) text = who === 'you' ? 'you crashed bradar' : who + ' crashed';
                else if (by === -1) text = who === 'you' ? 'you hit the border bradar' : who + ' hit the border';
                else if (head) text = who + ' and ' + nameOf(g, by) + ' met head on';
                else if (by === e.i) text = who === 'you' ? 'you ran into your own wall' : who + ' ran into their own wall';
                else text = (who === 'you' ? 'you hit ' : who + ' hit ') + (by === g.me ? 'your' : nameOf(g, by) + '\'s') + ' wall';
                say(g, text);
                if (e.i === g.me) {
                    sfx.lose();
                    const left = s.cycles.filter(x => x.alive).length;
                    banner(g, 'out', left > 1 ? left + ' still riding. ← → to watch another' : '', 2.2);
                    g.cam.follow = -1;
                    record(g, 'died');
                }
            } else if (e.e === 'end') roundOver(g, e.w);
            else if (e.e === 'round') { g.cam.follow = -1; g.pending.length = 0; g.localQ.length = 0; g.sparks.length = 0; if (g.pred) g.pred = null; }
            else if (e.e === 'go') { sfx.go(); banner(g, 'go', '', 0.8); }
            else if (e.e === 'over') matchOver(g);
        }
    }
    function roundOver(g, w) {
        const s = g.s;
        if (w === g.me) { sfx.win(); banner(g, 'you take round ' + s.round, 'bradar', 2.6); }
        else if (w >= 0) banner(g, nameOf(g, w) + ' takes round ' + s.round, '', 2.6);
        else banner(g, 'nobody takes round ' + s.round, 'that was a draw', 2.6);
        record(g, 'round', w);
    }
    // a guest learns about rounds and the end from the snapshot, not from events
    function phaseChange(g, was) {
        const s = g.s;
        if (was === 'count' && s.phase === 'race') { sfx.go(); banner(g, 'go', '', 0.8); }
        if (was === 'race' && s.phase === 'end') roundOver(g, s.lastWinner);
        if (s.phase === 'over' && was !== 'over') matchOver(g);
    }
    function record(g, what, w) {
        const m = loadMeta();
        if (what === 'round') {
            m.rounds++;
            if (w === g.me) m.roundWins++;
        } else if (what === 'died') {
            const c = g.s.cycles[g.me];
            if (c) m.best = max(m.best, round(g.s.raceT / TZ.TICK));
        } else if (what === 'match') {
            m.matches++;
            if (!g.solo) m.online++;
            if (w) m.wins++;
        }
        writeJson(META_KEY, m);
    }
    function standings(g) {
        const s = g.s;
        return s.seats.map((p, i) => ({ i, name: i === g.me ? (p.name || 'you') + ' (you)' : p.name, bot: p.bot, pts: s.scores[i] || 0, wins: s.wins[i] || 0, on: p.on }))
            .sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.i - b.i);
    }
    function matchOver(g) {
        if (g.over) return;
        g.over = true;
        const st = standings(g);
        const won = st[0].i === g.me && (st.length < 2 || st[1].pts < st[0].pts);
        if (!g.recorded) { g.recorded = true; record(g, 'match', won); }
        if (won) sfx.win();
        if (won && typeof unlockAchievement === 'function') { try { unlockAchievement('trailz_win'); } catch (e) { } }
        paintOver(g);
    }

    // ===============================================================
    // the picture
    // ===============================================================
    const yawOf = d => d * PI / 2;
    function angDiff(a, b) { let d = (b - a) % (PI * 2); if (d > PI) d -= PI * 2; if (d < -PI) d += PI * 2; return d; }
    function burst(g, x, z, col, n) {
        for (let k = 0; k < n; k++) {
            const a = Math.random() * PI * 2, up = Math.random() * 9 + 2, sp = Math.random() * 12 + 2;
            g.sparks.push({ x, y: 0.8, z, vx: cos(a) * sp, vy: up, vz: sin(a) * sp, col, a: 1, life: 0.6 + Math.random() * 0.9, t: 0 });
        }
        if (g.sparks.length > 900) g.sparks.splice(0, g.sparks.length - 900);
    }
    // where every cycle is drawn this frame
    function placeCycles(g, dt) {
        const s = g.s;
        const age = g.isHost ? g.acc : min(0.6, (performance.now() - g.lastSnap) / 1000 + latency(g)) * (g.ffHost || 1);
        for (const c of s.cycles) {
            const v = g.view[c.i];
            let x = c.x, z = c.z, dir = c.dir, pts = c.pts, alive = c.alive;
            if (!g.isHost && c.i === g.me && g.pred) { x = g.pred.x; z = g.pred.z; dir = g.pred.dir; pts = g.pred.pts; alive = g.pred.alive && c.alive; }
            else if (alive && s.phase === 'race' && !g.netDown) {
                // carried on from the last step (host) or snapshot (guest) to now, but not through a wall
                const want = c.speed * (g.isHost ? g.acc : age);
                if (want > 0) {
                    const hit = S.rayHit(s, x, z, dir, want + 0.05, c.i);
                    const go = max(0, min(want, hit.d - 0.05));
                    x += S.DX[dir] * go; z += S.DZ[dir] * go;
                }
            }
            // the cycle swings round in a tenth of a second and leans into it
            const target = yawOf(dir);
            const dy = angDiff(v.yaw, target);
            if (abs(dy) > 2.5 || !v.seen) v.yaw = target;
            else v.yaw += dy * min(1, dt * 22);
            v.roll += ((abs(dy) > 0.05 ? -Math.sign(dy) * 0.45 : 0) - v.roll) * min(1, dt * 12);
            v.seen = true;
            v.x = x; v.z = z; v.alive = alive; v.show = alive; v.fade = c.fade; v.gone = c.gone; v.pts = pts;
            // sparks off a wall it is grinding along
            if (alive && c.grind > 0.35 && s.phase === 'race' && Math.random() < c.grind * 1.4) {
                const bx = x - S.DX[dir] * 1.1, bz = z - S.DZ[dir] * 1.1;
                g.sparks.push({ x: bx, y: 0.2, z: bz, vx: (Math.random() - 0.5) * 6 - S.DX[dir] * 4, vy: Math.random() * 4 + 1, vz: (Math.random() - 0.5) * 6 - S.DZ[dir] * 4, col: [1, 0.85, 0.5], a: 1, life: 0.25 + Math.random() * 0.25, t: 0 });
            }
        }
    }
    function moveSparks(g, dt) {
        const out = [];
        for (const p of g.sparks) {
            p.t += dt;
            if (p.t >= p.life) continue;
            p.vy -= 22 * dt;
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.35; p.vx *= 0.7; p.vz *= 0.7; }
            p.a = 1 - p.t / p.life;
            out.push(p);
        }
        g.sparks = out;
    }
    // the camera: behind and above whoever is being watched, swinging round after a turn
    function camera(g, dt) {
        const s = g.s, cam = g.cam;
        let i = g.me;
        const mineAlive = g.view[g.me] && g.view[g.me].alive;
        if (!mineAlive) {
            if (cam.follow < 0 || !s.cycles[cam.follow] || !s.cycles[cam.follow].alive) {
                const alive = s.cycles.filter(c => c.alive);
                cam.follow = alive.length ? alive.sort((a, b) => (s.scores[b.i] - s.scores[a.i]) || a.i - b.i)[0].i : g.me;
            }
            i = cam.follow;
        }
        const v = g.view[i] || g.view[0];
        const mode = cam.mode;
        const S2 = s.S;
        let eye, at, fov;
        if (mode === 'arena') {
            // the whole floor, tipped towards you: the classic view from above, in perspective
            eye = [S2 / 2, S2 * 0.92, S2 * 1.18];
            at = [S2 / 2, 0, S2 * 0.54];
            fov = 52 * PI / 180;
            cam.yaw = v.yaw;
        } else {
            const k = 1 - Math.exp(-dt * (mode === 'chase' ? 6 : 4.5));
            cam.yaw += angDiff(cam.yaw, v.yaw) * k;
            const fx = cos(cam.yaw), fz = sin(cam.yaw);
            const back = mode === 'chase' ? 11 : 20, up = mode === 'chase' ? 5.4 : 13, ahead = mode === 'chase' ? 12 : 16;
            eye = [v.x - fx * back, up, v.z - fz * back];
            at = [v.x + fx * ahead, 0, v.z + fz * ahead];
            fov = (mode === 'chase' ? 74 : 70) * PI / 180;
            // faster is wider
            const c = s.cycles[i];
            if (c && c.alive) fov += min(0.18, max(0, (c.speed - TZ.BASE_SPEED) / TZ.BASE_SPEED) * 0.14);
        }
        cam.eye = eye; cam.at = at; cam.fov = fov;
        return cam;
    }
    function draw(g, dt) {
        placeCycles(g, dt);
        moveSparks(g, dt);
        const cam = camera(g, dt);
        if (R) {
            const ok = R.frame({ s: g.s, cycles: g.view, cam, sparks: g.sparks, t: g.t, seed: g.s.seed });
            if (!ok && R.lost && !g.lostSaid) { g.lostSaid = true; say(g, 'the graphics card gave up. close and open the window again'); }
        } else flat(g);
    }
    // no webgl: the arena from straight above, on a 2d canvas
    function flat(g) {
        const x = cv2, W = cv.width, H = cv.height, s = g.s;
        if (!x) return;
        x.fillStyle = '#030512'; x.fillRect(0, 0, W, H);
        const k = min(W, H) / s.S * 0.94, ox = (W - s.S * k) / 2, oy = (H - s.S * k) / 2;
        x.strokeStyle = 'rgba(30,150,190,.25)'; x.lineWidth = 1;
        x.beginPath();
        for (let v = 0; v <= s.S; v += 10) { x.moveTo(ox + v * k, oy); x.lineTo(ox + v * k, oy + s.S * k); x.moveTo(ox, oy + v * k); x.lineTo(ox + s.S * k, oy + v * k); }
        x.stroke();
        x.strokeStyle = '#7fe3ff'; x.lineWidth = 2; x.strokeRect(ox, oy, s.S * k, s.S * k);
        for (const v of g.view) {
            if (v.gone || !v.pts) continue;
            x.globalAlpha = v.fade;
            x.strokeStyle = TZ.COLORS[v.i % 8].css; x.lineWidth = max(1.5, k * 0.9);
            x.beginPath();
            for (let j = 0; j < v.pts.length; j += 2) { const px = ox + v.pts[j] * k, pz = oy + v.pts[j + 1] * k; j ? x.lineTo(px, pz) : x.moveTo(px, pz); }
            x.lineTo(ox + v.x * k, oy + v.z * k);
            x.stroke();
            if (v.alive) { x.fillStyle = '#fff'; x.fillRect(ox + v.x * k - 2, oy + v.z * k - 2, 4, 4); }
        }
        x.globalAlpha = 1;
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
        // the countdown, every second of it
        let count = -1;
        if (s.phase === 'count') count = TZ.COUNTDOWN - floor(s.phaseT / TZ.TICK);
        if (count !== g.lastCount) { g.lastCount = count; if (count > 0) sfx.count(); g.hudAt = 0; }
        if (g.hudAt && now - g.hudAt < 120) return;
        g.hudAt = now;
        const me = s.cycles[g.me];
        const st = standings(g);
        const alive = s.cycles.filter(c => c.alive).length;
        const speed = me && me.alive ? (g.pred && !g.isHost ? g.pred.speed : me.speed) : 0;
        const fuel = me ? me.fuel : 1;
        const big = g.over ? '' : count > 0 ? `<div class="tz-big tz-count">${count}</div>`
            : g.banner ? `<div class="tz-big">${esc(g.banner.text)}${g.banner.sub ? `<small>${esc(g.banner.sub)}</small>` : ''}</div>` : '';
        const sp = min(1, speed / TZ.MAX_SPEED);
        hud.innerHTML = `
            <div class="tz-top">
                <div class="tz-round">round ${s.round} of ${s.rounds} · ${alive} riding${g.ff > 1 ? ' · fast forward' : ''}${g.solo ? '' : ' · ' + (onRelays(g) ? 'relays' : 'direct')}</div>
                <ol class="tz-board">${st.map(p => `<li class="${s.cycles[p.i] && s.cycles[p.i].alive ? '' : 'out'}${p.i === g.me ? ' me' : ''}"><i style="background:${TZ.COLORS[p.i % 8].css}"></i><span>${esc(p.name)}${p.bot && !g.solo ? ' <em>bot</em>' : p.bot ? ' <em>' + esc(p.bot) + '</em>' : ''}</span><b>${p.pts}</b></li>`).join('')}</ol>
            </div>
            ${big}
            <div class="tz-feed">${g.feed.map(f => `<div style="opacity:${min(1, f.t)}">${esc(f.text)}</div>`).join('')}</div>
            <div class="tz-bars">
                <div class="tz-bar"><span>speed</span><i><b style="width:${round(sp * 100)}%"></b></i><em>${round(speed)}</em></div>
                <div class="tz-bar tz-fuel"><span>brake</span><i><b style="width:${round(fuel * 100)}%"></b></i></div>
            </div>
            <div class="tz-help">${IS_TOUCH() ? 'tap left or right half to turn · hold brake' : '← → or a d to turn · ↓ s or space to brake · c camera'}</div>
            ${g.netDown ? '<div class="tz-net">lost the host bradar... waiting for them</div>' : ''}`;
    }
    function paintOver(g) {
        const o = root && root.querySelector('#tz-over');
        if (!o) return;
        if (!g || !g.over) { o.innerHTML = ''; o.classList.remove('on'); return; }
        const st = standings(g);
        const winner = st[0];
        const tie = st.length > 1 && st[1].pts === winner.pts;
        o.classList.add('on');
        o.innerHTML = `<div class="tz-panel">
            <div class="tz-panel-title">${tie ? 'a draw at the top' : winner.i === g.me ? 'you win the match bradar' : esc(g.s.seats[winner.i].name) + ' wins the match'}</div>
            <ol class="tz-final">${st.map((p, k) => `<li class="${p.i === g.me ? 'me' : ''}"><span>${k + 1}.</span><i style="background:${TZ.COLORS[p.i % 8].css}"></i><span class="n">${esc(p.name)}</span><b>${p.pts} pts</b><em>${p.wins} won</em></li>`).join('')}</ol>
            <div class="tz-btns">
                ${g.solo || g.isHost ? '<button class="tz-btn tz-go" data-act="again">again</button>' : `<button class="tz-btn tz-go" data-act="again">${g.askedAgain ? 'asked the host' : 'ask for another'}</button>`}
                <button class="tz-btn" data-act="menu">menu</button>
            </div></div>`;
        o.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => act(b.dataset.act); });
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
            if (g.pending.length && now - (g.inputAt || 0) > (onRelays(g) ? 400 : 200)) sendInput(g);
            if (now - (g.pingAt || 0) > 2000) { g.pingAt = now; send(g, 'tz:p', { t: round(now) }, true); }
        }
    }
    function sendSnapshot(g, o) {
        const s = g.s;
        o = o || {};
        const d = S.snapshot(s, { full: !!o.full, tail: onRelays(g) ? 6 : 4, keep: onRelays(g) ? 240 : 120 });
        d.ak = s.seats.map((p, i) => g.acks[i] || 0);
        if (g.ff > 1) d.ff = g.ff;
        if (g.seatsDirty || performance.now() - g.seatsAt > 3000 || o.full) { d.P = S.seatList(s); g.seatsAt = performance.now(); g.seatsDirty = false; }
        send(g, 'tz:s', d, false, o.to);
    }
    function onSnapshot(g, d) {
        if (!d || typeof d !== 'object' || !Array.isArray(d.c) || typeof d.k !== 'number') return;
        if (g.tick0 !== undefined && d.k < g.tick0 && d.r === g.s.round) return;
        g.tick0 = d.k;
        g.lastSnap = performance.now();
        if (g.netDown) comeBack(g);
        const s = g.s;
        const was = s.phase;
        if (Array.isArray(d.P)) {
            S.applySeats(s, d.P);
            const mine = s.seats.findIndex(p => p.id === g.session.id);
            if (mine >= 0 && mine !== g.me) { g.me = mine; g.pred = null; }
        }
        const hole = S.applySnapshot(s, d);
        g.ffHost = d.ff || 1;
        if (hole && performance.now() - (g.fullAt || 0) > 800) { g.fullAt = performance.now(); send(g, 'tz:full', {}, true); }
        reconcile(g, d);
        phaseChange(g, was);
        readEvents(g);
    }
    function hostInput(g, d, from) {
        if (!d || !from) return;
        const s = g.s;
        const seat = s.seats.findIndex(p => p.id === from.id);
        if (seat < 0 || s.seats[seat].bot) return;
        if (Array.isArray(d.t)) {
            for (const q of d.t.slice(0, 12)) {
                if (!Array.isArray(q) || typeof q[0] !== 'number') continue;
                if (q[0] <= (g.acks[seat] || 0)) continue;
                g.acks[seat] = q[0];
                const r = S.turnAt(s, seat, q[1] === 1 ? 1 : -1, +q[2], q[3] | 0);
                g.lastRetro = r;
            }
        }
        S.brake(s, seat, !!d.b);
    }
    // somebody joining a match already going: a bot's seat, theirs if they had one
    function seatJoin(g, p) {
        const s = g.s;
        let i = s.seats.findIndex(x => x.id === p.id);
        if (i < 0) i = s.seats.findIndex(x => x.human && !x.on);
        if (i < 0) i = s.seats.findIndex(x => x.bot);
        if (i < 0) { say(g, (p.name || 'somebody') + ' is watching: every seat is taken'); return; }
        S.seatOn(s, i, true, p.id, p.name);
        g.bots[i] = null; g.acks[i] = 0;
        g.seatsDirty = true;
        say(g, p.name + ' took seat ' + (i + 1));
        const d = Object.assign({}, g.start, { late: 1 });
        g.hi = g.hi || {};
        const hand = n => { if (G !== g || g.hi[p.id] || !g.session.player(p.id)) return; send(g, 'np:start', d, false, p.id); if (n) setTimeout(() => hand(n - 1), 2500); };
        setTimeout(() => hand(3), 60);
    }
    function seatLeft(g, p) {
        const s = g.s;
        const i = s.seats.findIndex(x => x.id === p.id);
        if (i < 0 || i === g.me) return;
        S.seatOn(s, i, false);
        S.brake(s, i, false);
        g.seatsDirty = true;
        say(g, (p.name || 'somebody') + ' left. a bot rides for them, and the code gets the seat back', 4);
    }
    function goneQuiet(g) {
        if (g.over || g.isHost) return;
        g.netDown = true; g.hudAt = 0;
    }
    function comeBack(g) {
        if (!g.netDown) return;
        g.netDown = false; g.hudAt = 0;
        g.last = performance.now();
    }
    function bindNet(g) {
        const s = g.session, offs = [];
        if (g.isHost) {
            offs.push(s.on('tz:i', (d, from) => hostInput(g, d, from)));
            offs.push(s.on('tz:p', (d, from) => { if (from && d) send(g, 'tz:q', { t: d.t }, false, from.id); }));
            offs.push(s.on('tz:full', (d, from) => { if (from) sendSnapshot(g, { full: true, to: from.id }); }));
            offs.push(s.on('player-join', p => seatJoin(g, p)));
            offs.push(s.on('player-leave', p => seatLeft(g, p)));
            offs.push(s.on('tz:again', () => { if (g.over) say(g, 'somebody wants another go: press again'); }));
            offs.push(s.on('tz:hi', (d, from) => { if (from) { (g.hi = g.hi || {})[from.id] = true; g.seatsDirty = true; sendSnapshot(g, { full: true, to: from.id }); } }));
        } else {
            offs.push(s.on('tz:s', d => onSnapshot(g, d)));
            offs.push(s.on('tz:q', d => {
                const v = d && performance.now() - d.t;
                if (v > 0 && v < 5000) g.rtt = g.rtt ? g.rtt * 0.6 + v * 0.4 : v;
            }));
            offs.push(s.on('tz:new', d => { if (d && d.seed) startOnline(g.session, Object.assign({}, g.start, { seed: d.seed, slots: d.slots || g.start.slots })); }));
            offs.push(s.on('player-leave', p => { if (p.host) goneQuiet(g); }));
            offs.push(s.on('closed', () => goneQuiet(g)));
        }
        offs.push(s.on('net:down', () => goneQuiet(g)));
        offs.push(s.on('net:up', () => { comeBack(g); if (!g.isHost && s.alive) s.announceProfile(); }));
        g.offs = offs;
    }

    // ===============================================================
    // starting things
    // ===============================================================
    function startSolo(o) {
        ensureWindow();
        stopAttract();
        tearDown();
        const p = Object.assign(prefs(), o || {});
        savePrefs({ bots: p.bots, level: p.level, arena: p.arena, rounds: p.rounds });
        const seed = (o && o.seed) || ((Math.random() * 1e9) >>> 0);
        const name = (window.Netplay && Netplay.profile && Netplay.profile().name) || 'you';
        const seats = seatsFor({ people: [{ id: 'me', name }], cycles: 1 + p.bots, level: p.level, seed });
        G = makeGame({ seed, seats, arena: p.arena, rounds: p.rounds, me: 0 });
        screen = 'play';
        render();
        if (typeof unlockAchievement === 'function') { try { unlockAchievement('trailz'); } catch (e) { } }
    }
    function startOnline(session, opts) {
        if (G && G.session === session && G.start && G.start.seed === opts.seed && screen === 'play') return;
        ensureWindow();
        stopAttract();
        const old = G;
        if (old) {
            if (old.offs) old.offs.forEach(off => off());
            if (old.session && old.session !== session && !old.solo && old.session.alive) old.session.leave();
        }
        G = null;
        const o = opts.options || {};
        const cycles = Math.max(TZ.MIN_SEATS, Math.min(TZ.MAX_SEATS, +o.cycles || 4));
        const level = LEVELS.includes(o.bots) ? o.bots : 'normal';
        const arena = TZ.ARENA_BY_ID[o.arena] ? o.arena : 'medium';
        const rounds = TZ.ROUNDS.includes(+o.rounds) ? +o.rounds : 5;
        const slots = (Array.isArray(opts.slots) ? opts.slots : [session.id]).slice(0, TZ.MAX_SEATS);
        const people = slots.map(id => { const p = session.player(id); return { id, name: p ? p.name : 'rider' }; });
        const seats = seatsFor({ people, cycles: max(cycles, people.length), level, seed: opts.seed });
        const isHost = !!session.isHost;
        const me = slots.indexOf(session.id);
        const g = makeGame({ seed: opts.seed, seats, arena, rounds, session, isHost, me: me >= 0 ? me : 0 });
        g.start = { gameId: 'trailz', seed: opts.seed, slots, options: { cycles: String(cycles), bots: level, arena, rounds: String(rounds) }, at: opts.at };
        G = g;
        if (isHost) {
            // whoever was in the lobby and did not make it here has left: a bot rides for them
            g.s.seats.forEach((p, i) => { if (!p.bot && !session.player(p.id)) S.seatOn(g.s, i, false); });
        } else {
            g.lastSnap = performance.now();
            if (me < 0) g.me = -1;
        }
        bindNet(g);
        screen = 'play';
        render();
        if (isHost) sendSnapshot(g, { full: true });
        else session.sendToHost('tz:hi', {});
    }
    function again(g) {
        if (g.solo) { startSolo({ bots: g.s.n - 1 }); return; }
        if (g.isHost) {
            const seed = (Math.random() * 1e9) >>> 0;
            const slots = g.s.seats.filter(p => p.on && !p.bot).map(p => p.id);
            send(g, 'tz:new', { seed, slots });
            startOnline(g.session, Object.assign({}, g.start, { seed, slots }));
        } else { g.askedAgain = true; send(g, 'tz:again', {}, true); paintOver(g); }
    }

    // ===============================================================
    // screens
    // ===============================================================
    function render() {
        if (!root) return;
        const o = root.querySelector('#tz-over');
        if (screen === 'menu') {
            showThumbs(false);
            hud.innerHTML = '';
            o.classList.add('on');
            o.innerHTML = menuHtml();
            bindMenu(o);
            startAttract();
        } else {
            o.innerHTML = ''; o.classList.remove('on');
            showThumbs(IS_TOUCH() || (G && G.touch));
            if (G && G.over) paintOver(G);
        }
        fit(true);
    }
    function menuHtml() {
        const p = prefs(), m = loadMeta();
        const sel = (k, vals, cur) => `<select class="tz-sel" data-k="${k}">${vals.map(v => `<option value="${esc(v[0])}" ${String(v[0]) === String(cur) ? 'selected' : ''}>${esc(v[1])}</option>`).join('')}</select>`;
        return `<div class="tz-menu">
            <div class="tz-logo">trailz<span>98</span></div>
            <div class="tz-sub">light cycles on a grid. turn at right angles, leave a wall behind you, and touch none of them, yours included. the last one riding takes the round.</div>
            <div class="tz-opts">
                <label>bots ${sel('bots', [1, 2, 3, 4, 5, 6, 7].map(n => [n, n === 1 ? '1 bot' : n + ' bots']), p.bots)}</label>
                <label>how good ${sel('level', [['easy', 'easy'], ['normal', 'normal'], ['hard', 'hard'], ['mixed', 'a mix']], p.level)}</label>
                <label>arena ${sel('arena', TZ.ARENAS.map(a => [a.id, a.name]), p.arena)}</label>
                <label>rounds ${sel('rounds', TZ.ROUNDS.map(r => [r, r + ' rounds']), p.rounds)}</label>
                <label>camera ${sel('cam', CAMS.map(c => [c, CAM_NAMES[c]]), p.cam)}</label>
            </div>
            <div class="tz-btns">
                <button class="tz-btn tz-go" data-act="solo">ride</button>
                <button class="tz-btn" data-act="online">online, 2 to 8</button>
            </div>
            <div class="tz-keys">${IS_TOUCH() ? 'tap the left or right half of the picture to turn. hold brake to slow down.' : '<b>← →</b> or <b>a d</b> turn &nbsp; <b>↓</b> <b>s</b> or <b>space</b> brake &nbsp; <b>c</b> camera'}
                <br>ride close beside a wall and you go faster. that is the grind, and it is how you win.</div>
            <div class="tz-rec">${m.matches ? `matches ${m.matches} · won ${m.wins} · rounds won ${m.roundWins} of ${m.rounds} · longest ride ${m.best}s` : 'no matches yet bradar'}</div>
        </div>`;
    }
    function bindMenu(o) {
        o.querySelectorAll('select[data-k]').forEach(sel => {
            sel.onchange = () => {
                const k = sel.dataset.k, v = sel.value;
                savePrefs({ [k]: k === 'bots' || k === 'rounds' ? +v : v });
            };
        });
        o.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => act(b.dataset.act); });
    }
    function act(a) {
        const g = G;
        switch (a) {
            case 'solo': startSolo(); break;
            case 'online':
                if (typeof openNetplay === 'function') openNetplay({ gameId: 'trailz' });
                else if (window.Netplay) Netplay.openLobby({ gameId: 'trailz' });
                break;
            case 'again': if (g) again(g); break;
            case 'menu': tearDown(); screen = 'menu'; render(); break;
        }
    }

    // ---------------------------------------------------------------
    // behind the menu: four bots riding, and the camera going slowly round
    // ---------------------------------------------------------------
    let attract = null;
    function startAttract() {
        if (attract) return;
        const seed = (Math.random() * 1e9) >>> 0;
        const seats = seatsFor({ people: [], cycles: 4, level: 'hard', seed });
        attract = makeGame({ seed, seats, arena: 'small', rounds: 9 });
        attract.s.quiet = true;
        attract.cam.orbit = Math.random() * PI * 2;
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
        g.s.events.length = 0;
        placeCycles(g, dt);
        moveSparks(g, dt);
        const S2 = g.s.S;
        g.cam.orbit += dt * 0.06;
        const r = S2 * 0.95;
        const cam = { eye: [S2 / 2 + cos(g.cam.orbit) * r, S2 * 0.32, S2 / 2 + sin(g.cam.orbit) * r], at: [S2 / 2, 0, S2 / 2], fov: 62 * PI / 180 };
        if (R) R.frame({ s: g.s, cycles: g.view, cam, sparks: g.sparks, t: g.t, seed: g.s.seed });
        else flat(g);
    }

    // ===============================================================
    // the way in
    // ===============================================================
    function openMenu() {
        ensureWindow();
        if (G && screen === 'play') return;
        tearDown();
        screen = 'menu';
        render();
    }
    window.startTrailz = openMenu;
    // the lobby's picture of a player: a cycle on the grid, in their colour
    function paintAvatar(canvas) {
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        // a player's colour is their seat's: their place in the lobby
        const s = window.Netplay && Netplay.current;
        const i = s ? max(0, s.players.findIndex(p => p.id === canvas.dataset.pid)) : 0;
        const col = TZ.COLORS[i % 8].css;
        c.fillStyle = '#030512'; c.fillRect(0, 0, w, h);
        c.strokeStyle = 'rgba(40,170,210,.45)'; c.lineWidth = 1;
        for (let k = 0; k <= w; k += w / 6) { c.beginPath(); c.moveTo(k, h * 0.55); c.lineTo(w / 2 + (k - w / 2) * 2.2, h); c.stroke(); }
        for (let y = h * 0.6; y < h; y += h / 10) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
        c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 8;
        c.fillRect(w * 0.12, h * 0.52, w * 0.42, h * 0.06);
        c.fillStyle = '#e8f6ff'; c.fillRect(w * 0.54, h * 0.44, w * 0.3, h * 0.14);
        c.shadowBlur = 0;
    }
    if (window.Netplay) {
        Netplay.registerGame({
            id: 'trailz',
            name: 'trailz 98',
            start: (session, opts) => {
                if (opts && opts.solo) { openMenu(); return; }
                startOnline(session, opts || {});
            },
            startSolo: () => startSolo(),
            soloLabel: 'against bots',
            paintAvatar
        });
    }
    // for the browser test: the state, a clock it can turn up, and a look at the picture
    window.TZ_ENGINE = {
        state: () => G, screen: () => screen, startSolo, act, press, brake: setBrake, cam: m => { if (G && CAMS.includes(m)) G.cam.mode = m; },
        clock: n => { testClock = max(1, +n || 1); }, meta: () => loadMeta(), gl: () => R,
        // a bot at the wheel of a person's cycle, on the host, so a test can leave a match running
        drive: (i, level) => { if (G && G.isHost) { G.autopilot = G.autopilot || []; G.autopilot[i] = level ? S.newBot(level, 77 + i) : null; } },
        sample: () => (R && G ? R.sample({ s: G.s, cycles: G.view, cam: G.cam, sparks: G.sparks, t: G.t, seed: G.s.seed }) : null),
        fit: () => fit(true)
    };
})();
