// ===================================================================
// tavla 98 — the window, the board on a canvas, the hands, the bots, the wire
//
// tavla-sim.js is the rules; this is everything between them and a person.
// Solo is you against a bot (easy, normal or hard). Online is one on one
// through the desktop lobby, host authoritative: the host owns the match and
// rolls every die, a guest sends what it wants to do (tavla:act) and draws
// the state the host sends back (tavla:state). A guest who leaves gets a bot;
// a host who leaves hands the guest a bot to finish the match against.
// ===================================================================
(function () {
    'use strict';

    const S = window.TAVLA_SIM;
    if (!S) { console.warn('[tavla] the rules did not load'); return; }
    const { min, max, floor, round, sqrt, random, PI } = Math;
    const PREFS_KEY = 'mrhakan98-tavla-prefs', STATS_KEY = 'mrhakan98-tavla-stats', SAVE_KEY = 'mrhakan98-tavla-save';
    const COLORS = ['white', 'red'];
    const BOT_NAMES = { easy: 'çırak bot', normal: 'kahveci bot', hard: 'usta bot' };
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
    const drop = k => { try { localStorage.removeItem(k); } catch (e) { } };
    function prefs() {
        const p = readJson(PREFS_KEY) || {};
        return {
            level: S.LEVELS.includes(p.level) ? p.level : 'normal',
            points: [1, 3, 5].includes(p.points) ? p.points : 3,
            autoBear: p.autoBear !== false
        };
    }
    const savePrefs = o => writeJson(PREFS_KEY, Object.assign(prefs(), o));
    function stats() {
        const o = readJson(STATS_KEY) || {};
        const n = v => (Number.isFinite(+v) && +v >= 0 ? +v : 0);
        return { games: n(o.games), wins: n(o.wins), mars: n(o.mars), matches: n(o.matches), matchWins: n(o.matchWins), online: n(o.online) };
    }
    function record(f) { const m = stats(); f(m); writeJson(STATS_KEY, m); }
    const unlock = id => { if (typeof unlockAchievement === 'function') { try { unlockAchievement(id); } catch (e) { } } };
    function ensureCss() {
        if (document.getElementById('tv-css')) return;
        const l = document.createElement('link');
        l.id = 'tv-css'; l.rel = 'stylesheet'; l.href = 'games/tavla/tavla.css';
        document.head.appendChild(l);
    }

    // ---------------------------------------------------------------
    // sound: a few beeps, and quiet when the site is
    // ---------------------------------------------------------------
    let actx = null;
    function soundOn() {
        try { if (localStorage.getItem('sound-enabled') === 'false') return false; } catch (e) { }
        return typeof soundEnabled === 'undefined' ? true : soundEnabled !== false;
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
            osc.frequency.setValueAtTime(freq, t0);
            if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(o.gain || 0.035, t0 + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(g); g.connect(actx.destination);
            osc.start(t0); osc.stop(t0 + dur + 0.02);
        } catch (e) { }
    }
    const sfx = {
        dice: () => { for (let i = 0; i < 4; i++) tone(180 + random() * 260, 0.04, { type: 'triangle', delay: i * 0.07, gain: 0.03 }); },
        click: () => tone(520, 0.05, { type: 'triangle', gain: 0.03 }),
        hit: () => tone(240, 0.16, { type: 'sawtooth', to: 90, gain: 0.03 }),
        off: () => tone(880, 0.07, { type: 'triangle' }),
        bad: () => tone(140, 0.12, { gain: 0.025 }),
        win: () => { tone(660, 0.12); tone(880, 0.12, { delay: 0.12 }); tone(1320, 0.3, { delay: 0.24 }); },
        lose: () => tone(300, 0.4, { to: 90, type: 'sawtooth', gain: 0.03 })
    };

    // ---------------------------------------------------------------
    // the board's geometry, in board units; the canvas scales it
    // ---------------------------------------------------------------
    const W = 748, H = 540, FR = 16, PW = 50, BX0 = 316, BX1 = 360, RX = 360, TX0 = 676, TX1 = 732;
    const TOP = FR, BOT = H - FR, PH = 212, CR = 22;
    // d is a point in the viewer's own numbering: 0 is their 1-point, bottom right
    function pointX(d) {
        if (d < 6) return RX + (5 - d) * PW + PW / 2;
        if (d < 12) return FR + (11 - d) * PW + PW / 2;
        if (d < 18) return FR + (d - 12) * PW + PW / 2;
        return RX + (d - 18) * PW + PW / 2;
    }
    const isBottom = d => d < 12;
    function stackY(d, k, n) {
        const sp = n > 5 ? (PH - 2 * CR) / (n - 1) : 2 * CR;
        return isBottom(d) ? BOT - CR - k * sp : TOP + CR + k * sp;
    }

    // ---------------------------------------------------------------
    // the window
    // ---------------------------------------------------------------
    let winRef = null, root = null, cv = null, ctx = null, wrap = null, over = null, logEl = null, topEl = null, statusEl = null, barEl = null;
    let G = null, screen = 'menu', raf = 0, dpr = 1, cssW = 0, bg = null, sprites = null, dirty = true, fitAt = 0, overKind = '';
    function onTop() {
        if (!winRef || !winRef.win || winRef.win.style.display === 'none') return false;
        const z = +winRef.win.style.zIndex || 0;
        return ![...document.querySelectorAll('.app-window, .ie-window')].some(w => w !== winRef.win && w.style.display !== 'none' && (+w.style.zIndex || 0) > z);
    }
    const hiddenNow = () => document.hidden || !winRef || !winRef.win || winRef.win.style.display === 'none';
    function ensureWindow() {
        ensureCss();
        if (winRef && winRef.win && document.getElementById(winRef.win.id)) {
            if (winRef.win.style.display === 'none') winRef.win.style.display = '';
            if (typeof ieHighestZ === 'number') { ieHighestZ++; winRef.win.style.zIndex = ieHighestZ; }
            return winRef;
        }
        const vw = typeof viewportWidth === 'function' ? viewportWidth() : (window.innerWidth || 1000);
        winRef = createAppWindow('tavla 98', { icon: 'casino', width: min(960, vw - 20) });
        winRef.body.classList.add('tv-body');
        const vh0 = document.documentElement.clientHeight || 800;
        if (vw >= 768) winRef.win.style.top = (vh0 < 900 ? 0 : 30) + 'px';
        winRef.win._cleanup = () => {
            leaveOnline();
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('resize', onResize);
            document.removeEventListener('visibilitychange', onVis);
            G = null; root = null; winRef = null; cv = null; ctx = null; bg = null; sprites = null;
        };
        root = winRef.body;
        root.innerHTML = `
            <div class="tv-stage" id="tv-stage">
                <div class="tv-top" id="tv-top"></div>
                <div class="tv-main">
                    <div class="tv-wrap" id="tv-wrap">
                        <canvas class="tv-canvas" id="tv-canvas" aria-label="the tavla board"></canvas>
                        <div class="tv-over" id="tv-over"></div>
                    </div>
                    <div class="tv-log"><h4>moves</h4><ol id="tv-log"></ol></div>
                </div>
                <div class="tv-bar" id="tv-bar">
                    <button class="tv-btn go" data-act="roll">roll</button>
                    <button class="tv-btn" data-act="undo">undo</button>
                    <button class="tv-btn go" data-act="done">done</button>
                    <button class="tv-btn" data-act="pause">pause</button>
                    <button class="tv-btn" data-act="menu">menu</button>
                    <div class="tv-status" id="tv-status" aria-live="polite"></div>
                </div>
            </div>`;
        cv = root.querySelector('#tv-canvas');
        ctx = cv.getContext('2d');
        wrap = root.querySelector('#tv-wrap');
        over = root.querySelector('#tv-over');
        logEl = root.querySelector('#tv-log');
        topEl = root.querySelector('#tv-top');
        statusEl = root.querySelector('#tv-status');
        barEl = root.querySelector('#tv-bar');
        barEl.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) command(b.dataset.act); });
        over.addEventListener('click', onOverClick);
        over.addEventListener('change', () => { if (overKind === 'menu') readMenu(); });
        cv.addEventListener('pointerdown', onDown);
        cv.addEventListener('pointermove', onMove);
        cv.addEventListener('pointerup', onUp);
        cv.addEventListener('pointercancel', () => { drag = null; dirty = true; });
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', onResize);
        document.addEventListener('visibilitychange', onVis);
        const tick = () => { raf = requestAnimationFrame(tick); frame(); };
        raf = requestAnimationFrame(tick);
        return winRef;
    }
    function onResize() { fitAt = 0; }
    function onVis() { if (document.hidden) autoPause(); }
    function autoPause() { if (G && G.mode === 'solo' && !G.paused && G.s.phase !== 'match') { G.paused = true; showPause(); } }

    // the board fills the space beside the log; never taller than the screen has room for
    function fit() {
        const now = performance.now();
        if (fitAt && now - fitAt < 300) return;
        fitAt = now;
        const ww = wrap.clientWidth;
        if (!ww) return;
        const vh = document.documentElement.clientHeight || 700;
        const top = wrap.getBoundingClientRect().top;
        const below = (barEl ? barEl.offsetHeight : 34) + 22;
        const room = max(220, vh - max(0, top) - below);
        let w = min(ww, floor(room * W / H));
        w = max(200, w);
        const k = min(2, window.devicePixelRatio || 1);
        const bw = round(w * k), bh = round(w * H / W * k);
        cv.style.width = w + 'px';
        cv.style.height = round(w * H / W) + 'px';
        cv.style.margin = '0 auto';
        // the log sits beside the board and is never taller than it
        const logBox = logEl.parentElement;
        const side = getComputedStyle(logBox.parentElement).flexDirection === 'row';
        const lh = side ? round(w * H / W) + 4 + 'px' : '';
        if (logBox.style.height !== lh) logBox.style.height = lh;
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; bg = null; sprites = null; dirty = true; }
        dpr = bw / W;
        cssW = w;
    }

    // ---------------------------------------------------------------
    // the wood, the points and the checkers, painted once per size
    // ---------------------------------------------------------------
    function paintBg() {
        const c = document.createElement('canvas');
        c.width = cv.width; c.height = cv.height;
        const x = c.getContext('2d');
        x.scale(dpr, dpr);
        // the case
        let g = x.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#6b3a1c'); g.addColorStop(1, '#4a2410');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        // grain on the case, seeded so it is the same every time
        const rs = { r: 977 };
        x.strokeStyle = 'rgba(30,10,0,.22)'; x.lineWidth = 1;
        for (let i = 0; i < 70; i++) {
            const y = S.rnd(rs, 'r') * H;
            x.beginPath(); x.moveTo(0, y);
            x.bezierCurveTo(W * 0.3, y + (S.rnd(rs, 'r') - 0.5) * 18, W * 0.7, y + (S.rnd(rs, 'r') - 0.5) * 18, W, y + (S.rnd(rs, 'r') - 0.5) * 10);
            x.stroke();
        }
        // the two fields, lighter wood
        for (const [x0, x1] of [[FR, BX0], [RX, TX0 - FR]]) {
            g = x.createLinearGradient(x0, 0, x1, H);
            g.addColorStop(0, '#d9a768'); g.addColorStop(0.5, '#c98f4f'); g.addColorStop(1, '#d6a060');
            x.fillStyle = g; x.fillRect(x0, TOP, x1 - x0, BOT - TOP);
            x.strokeStyle = 'rgba(120,70,20,.25)';
            for (let i = 0; i < 28; i++) {
                const y = TOP + S.rnd(rs, 'r') * (BOT - TOP);
                x.beginPath(); x.moveTo(x0, y); x.quadraticCurveTo((x0 + x1) / 2, y + (S.rnd(rs, 'r') - 0.5) * 14, x1, y); x.stroke();
            }
            x.strokeStyle = '#2a1206'; x.lineWidth = 2; x.strokeRect(x0, TOP, x1 - x0, BOT - TOP); x.lineWidth = 1;
        }
        // the points
        for (let d = 0; d < 24; d++) {
            const cx = pointX(d), b = isBottom(d);
            const base = b ? BOT : TOP, tip = b ? BOT - PH : TOP + PH;
            x.beginPath(); x.moveTo(cx - PW / 2 + 2, base); x.lineTo(cx, tip); x.lineTo(cx + PW / 2 - 2, base); x.closePath();
            x.fillStyle = d % 2 ? '#7a1a14' : '#1d3b2a';
            x.fill();
            x.strokeStyle = 'rgba(0,0,0,.35)'; x.stroke();
            // inlay
            x.beginPath(); x.moveTo(cx - PW / 2 + 9, base); x.lineTo(cx, tip + (b ? 26 : -26)); x.lineTo(cx + PW / 2 - 9, base); x.closePath();
            x.fillStyle = d % 2 ? 'rgba(255,200,120,.12)' : 'rgba(200,255,200,.08)'; x.fill();
        }
        // the bar and the tray
        g = x.createLinearGradient(BX0, 0, BX1, 0);
        g.addColorStop(0, '#3a1c0a'); g.addColorStop(0.5, '#6e3a18'); g.addColorStop(1, '#3a1c0a');
        x.fillStyle = g; x.fillRect(BX0, 0, BX1 - BX0, H);
        x.fillStyle = '#2a1206'; x.fillRect(TX0, TOP, TX1 - TX0, BOT - TOP);
        x.fillStyle = '#3d1d0b'; x.fillRect(TX0 + 4, TOP + 4, TX1 - TX0 - 8, (BOT - TOP) / 2 - 10);
        x.fillRect(TX0 + 4, H / 2 + 6, TX1 - TX0 - 8, (BOT - TOP) / 2 - 10);
        // hinges
        x.fillStyle = '#c8b070';
        for (const y of [H * 0.22, H * 0.78]) { x.fillRect(BX0 + 14, y - 14, BX1 - BX0 - 28, 28); x.fillStyle = '#8a7440'; x.fillRect(BX0 + 20, y - 1, BX1 - BX0 - 40, 2); x.fillStyle = '#c8b070'; }
        // point numbers, from the viewer's side
        x.font = '10px Tahoma, sans-serif'; x.textAlign = 'center'; x.fillStyle = 'rgba(255,240,210,.75)';
        for (let d = 0; d < 24; d++) x.fillText(String(d + 1), pointX(d), isBottom(d) ? H - 4 : 11);
        bg = c;
    }
    function paintSprites() {
        const r = CR * dpr, sz = Math.ceil(r * 2 + 4);
        sprites = [0, 1].map(pl => {
            const c = document.createElement('canvas');
            c.width = c.height = sz;
            const x = c.getContext('2d');
            const m = sz / 2;
            x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.arc(m + 1.5 * dpr / 2, m + 2 * dpr / 2, r, 0, PI * 2); x.fill();
            const g = x.createRadialGradient(m - r * 0.35, m - r * 0.35, r * 0.1, m, m, r);
            if (pl === 0) { g.addColorStop(0, '#fffdf4'); g.addColorStop(1, '#d8ccb0'); } else { g.addColorStop(0, '#e2505a'); g.addColorStop(1, '#7a0e16'); }
            x.fillStyle = g; x.beginPath(); x.arc(m, m, r, 0, PI * 2); x.fill();
            x.strokeStyle = pl === 0 ? '#8a7a58' : '#3a0408'; x.lineWidth = max(1, dpr); x.stroke();
            x.beginPath(); x.arc(m, m, r * 0.62, 0, PI * 2); x.strokeStyle = pl === 0 ? 'rgba(120,100,60,.45)' : 'rgba(255,170,170,.35)'; x.stroke();
            return c;
        });
    }

    // ---------------------------------------------------------------
    // where a checker of a seat sits, in board units
    // ---------------------------------------------------------------
    const viewD = (seat, rel) => { const a = S.abs(seat, rel); return G.me === 1 ? 23 - a : a; };
    function spotXY(seat, rel, k, n) {
        if (rel === S.BAR) {
            const mine = seat === G.me;
            return [(BX0 + BX1) / 2, mine ? H / 2 + 34 + k * 30 : H / 2 - 34 - k * 30];
        }
        if (rel === S.OFF) {
            const mine = seat === G.me;
            return [(TX0 + TX1) / 2, mine ? BOT - 10 - k * 15 : TOP + 10 + k * 15];
        }
        const d = viewD(seat, rel);
        return [pointX(d), stackY(d, k, max(n, k + 1))];
    }
    function countAt(s, seat, rel) {
        if (rel === S.BAR) return s.pos.bar[seat];
        if (rel === S.OFF) return s.pos.off[seat];
        return S.own(s.pos, seat, rel);
    }

    // ---------------------------------------------------------------
    // a game in this window
    // ---------------------------------------------------------------
    function makeGame(o) {
        return {
            s: o.s, mode: o.mode, me: o.me, names: o.names, bots: o.bots, level: o.level || 'normal',
            session: o.session || null, isHost: o.mode === 'solo' || !!o.isHost, seatIds: o.seatIds || [], unsubs: [],
            sel: null, kbTo: 0, autoBear: prefs().autoBear, botAt: 0, botPlan: null, autoAt: 0, paused: false, recorded: {}, anim: null, diceAt: -9, ff: (G && G.ff) || 1,
            prev: S.snapshot(o.s), seq: 0, ack: 0, logKey: '', hudKey: '', status: '', statusAt: 0, sentAt: 0, mid: o.mid || 1
        };
    }
    function startSolo(o) {
        o = o || {};
        const p = prefs();
        const level = S.LEVELS.includes(o.level) ? o.level : p.level;
        const target = [1, 3, 5].includes(+o.points) ? +o.points : p.points;
        const seed = o.seed !== undefined ? o.seed >>> 0 : (floor(random() * 1e9) >>> 0);
        leaveOnline();
        ensureWindow();
        const s = o.s || S.newMatch({ seed, target });
        G = makeGame({ s, mode: 'solo', me: 0, names: [youName(), BOT_NAMES[level]], bots: [null, level], level });
        enterPlay();
        if (!o.s) saveSolo();
        return G;
    }
    function youName() {
        try { const n = window.Netplay && Netplay.profile && Netplay.profile().name; if (n) return String(n).slice(0, 16); } catch (e) { }
        return 'you';
    }
    function enterPlay() {
        screen = 'play';
        G.diceAt = G.s.phase === 'move' && !G.s.steps.length ? performance.now() : -9;
        if (G.s.phase === 'move' && !G.s.steps.length) sfx.dice();
        closeOver();
        fitAt = 0; dirty = true;
        refresh(true);
        if (G.s.phase === 'over' || G.s.phase === 'match') showResult();
    }
    function saveSolo() {
        if (!G || G.mode !== 'solo') return;
        if (G.s.phase === 'match') { drop(SAVE_KEY); return; }
        writeJson(SAVE_KEY, { s: G.s, level: G.level, at: Date.now() });
    }
    function loadSave() {
        const o = readJson(SAVE_KEY);
        if (!o || !S.validSnapshot(o.s) || !S.LEVELS.includes(o.level)) return null;
        return o;
    }

    // the legal moves of the moment, worked out once per state
    function legalNow() {
        if (G._ls !== G.s || G._lv !== G.s.v) { G._ls = G.s; G._lv = G.s.v; G._legal = S.legal(G.s); }
        return G._legal;
    }
    const myTurn = () => G && G.s.turn === G.me && !G.bots[G.me] && (G.s.phase === 'roll' || G.s.phase === 'move') && !G.paused;
    // every action goes through here, whoever does it
    function doAct(seat, a) {
        if (!G) return 'no game';
        if (G.isHost) {
            const err = S.act(G.s, seat, a);
            if (err) return err;
            changed();
            if (G.mode === 'online') broadcast();
            return null;
        }
        // a guest: rolls wait for the host; moves show at once and the host's word settles them
        if (seat !== G.me) return 'not yours';
        if (a.t === 'move' || a.t === 'undo') {
            const err = S.act(G.s, seat, a);
            if (err) return err;
            changed();
        } else if (a.t === 'done') {
            if (legalNow().length) return 'you still have a move';
        } else if (a.t === 'roll' && (G.s.phase !== 'roll' || G.s.turn !== G.me)) return 'not the time to roll';
        G.seq++;
        G.session.sendToHost('tavla:act', { a, n: G.seq });
        return null;
    }
    // what changed since the last look: animations, sounds, saves, the score
    function changed() {
        const s = G.s, p = G.prev, now = performance.now();
        if (s.phase === 'move' && !s.steps.length && (p.phase !== 'move' || p.turn !== s.turn || p.game !== s.game)) {
            G.diceAt = now; sfx.dice();
        }
        if (s.last && s.mc === p.mc + 1 && s.last.mc === s.mc) {
            const L = s.last;
            const n0 = countAt(s, L.pl, L.from);
            const n1 = countAt(s, L.pl, L.to);
            G.anim = { pl: L.pl, to: L.to, a: spotXY(L.pl, L.from, n0, n0 + 1), b: spotXY(L.pl, L.to, n1 - 1, n1), t0: now, dur: 230 / G.ff };
            if (L.hit) sfx.hit(); else if (L.to === S.OFF) sfx.off(); else sfx.click();
        } else G.anim = null;
        if ((s.phase === 'over' || s.phase === 'match') && s.result && !G.recorded[s.game + ':' + G.mid]) {
            G.recorded[s.game + ':' + G.mid] = 1;
            gameEnded();
        }
        if (s.phase === 'over' && p.phase !== 'over' || s.phase === 'match' && p.phase !== 'match') setTimeout(() => { if (G && G.s === s) showResult(); }, 650 / G.ff);
        if (p.phase !== s.phase || p.turn !== s.turn || p.game !== s.game) { G.sel = null; G.botPlan = null; }
        if (G.sel !== null && !legalNow().some(x => x.from === G.sel)) G.sel = null;
        G.prev = S.snapshot(s);
        saveSolo();
        dirty = true;
        refresh();
    }
    function gameEnded() {
        const r = G.s.result;
        if (G.me < 0) return;
        const won = r.winner === G.me;
        (won ? sfx.win : sfx.lose)();
        record(m => {
            m.games++; if (won) { m.wins++; if (r.mars) m.mars++; }
            if (G.mode === 'online') m.online++;
            if (G.s.phase === 'match') { m.matches++; if (won) m.matchWins++; }
        });
        if (won) { unlock('tavla'); if (r.mars && (G.mode === 'online' || G.level === 'hard')) unlock('tavla_mars'); }
    }

    // ---------------------------------------------------------------
    // the loop: bots, the automatic bits, and a picture when something moved
    // ---------------------------------------------------------------
    function frame() {
        if (!root || !cv || !document.getElementById('tv-stage')) return;
        fit();
        const now = performance.now();
        if (G && screen === 'play') {
            if (hiddenNow()) autoPause();
            else think(now);
            if (G.mode === 'online' && G.isHost && now - G.sentAt > 4000) broadcast();
            if (G.status && now - G.statusAt > 3500) { G.status = ''; refresh(); }
        }
        const busy = G && (G.anim || now - G.diceAt < 700 / G.ff);
        if (dirty || busy || drag) { draw(now); dirty = !!busy; }
    }
    function think(now) {
        const g = G, s = g.s;
        if (g.paused || (g.anim && now - g.anim.t0 < g.anim.dur) || now - g.diceAt < 650 / g.ff) return;
        if (s.phase !== 'roll' && s.phase !== 'move') return;
        const lvl = g.bots[s.turn];
        if (lvl && g.isHost) {
            if (!g.botAt) { g.botAt = now + (s.phase === 'roll' ? 550 : 420) / g.ff; return; }
            if (now < g.botAt) return;
            g.botAt = 0;
            if (s.phase === 'roll') { doAct(s.turn, { t: 'roll' }); return; }
            if (!g.botPlan) g.botPlan = S.botTurn(s, s.turn, lvl);
            const x = g.botPlan.shift();
            if (x && !doAct(s.turn, { t: 'move', from: x.from, die: x.die })) return;
            g.botPlan = null;
            doAct(s.turn, { t: 'done' });
            return;
        }
        // a person: pass a turn with no move, and play an obvious bear-off
        if (s.turn !== g.me || s.phase !== 'move') { g.autoAt = 0; return; }
        if (!g.isHost && g.seq > g.ack) return;
        const legal = legalNow();
        if (!legal.length && !s.steps.length) {
            if (!g.autoAt) { g.autoAt = now + 1300 / g.ff; say('no move for you with ' + s.dice.join('-') + '.'); return; }
            if (now >= g.autoAt) { g.autoAt = 0; doAct(g.me, { t: 'done' }); }
            return;
        }
        if (legal.length && g.autoBear && !s.steps.length || g.autoPlan) {
            if (!g.autoPlan) { g.autoPlan = S.obviousBearOff(s); if (!g.autoPlan) return; g.autoAt = now + 350 / g.ff; }
            if (now < g.autoAt) return;
            const x = g.autoPlan.shift();
            if (!x || doAct(g.me, { t: 'move', from: x.from, die: x.die })) { g.autoPlan = null; return; }
            g.autoAt = now + 330 / g.ff;
            if (!g.autoPlan.length) g.autoPlan = null;
        }
    }

    // ---------------------------------------------------------------
    // the picture
    // ---------------------------------------------------------------
    function targetsOf(from) {
        const out = [];
        for (const x of legalNow()) if (x.from === from && !out.includes(x.to)) out.push(x.to);
        return out;
    }
    function draw(now) {
        if (!bg) paintBg();
        if (!sprites) paintSprites();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(bg, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (!G) { drawAttract(); return; }
        const s = G.s, mine = myTurn() && s.phase === 'move';
        const legal = mine ? legalNow() : [];
        const anim = G.anim && now - G.anim.t0 < G.anim.dur ? G.anim : null;
        if (!anim) G.anim = null;
        // movable checkers and the selected one's targets
        const sources = new Set(legal.map(x => x.from));
        const sel = drag ? drag.from : G.sel;
        const tg = sel !== null && sel !== undefined ? targetsOf(sel) : [];
        for (const to of tg) {
            if (to === S.OFF) { ctx.fillStyle = 'rgba(120,255,120,.35)'; ctx.fillRect(TX0 + 2, H / 2 + 4, TX1 - TX0 - 4, BOT - H / 2 - 6); continue; }
            const d = viewD(G.me, to), cx = pointX(d), b = isBottom(d);
            ctx.beginPath(); ctx.moveTo(cx - PW / 2 + 2, b ? BOT : TOP); ctx.lineTo(cx, b ? BOT - PH : TOP + PH); ctx.lineTo(cx + PW / 2 - 2, b ? BOT : TOP); ctx.closePath();
            ctx.fillStyle = 'rgba(120,255,120,.38)'; ctx.fill();
            if (G.kbTo === tg.indexOf(to) && kbUsed) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
        }
        // checkers
        for (const pl of [0, 1]) {
            for (let r = 0; r < 24; r++) {
                let n = S.own(s.pos, pl, r);
                if (anim && anim.pl === pl && anim.to === r) n--;
                if (drag && drag.moved && pl === G.me && drag.from === r) n--;
                for (let k = 0; k < n; k++) { const [x, y] = spotXY(pl, r, k, n); checker(pl, x, y); }
                if (n > 0 && sources.has(r) && pl === G.me) ring(...spotXY(pl, r, n - 1, n), sel === r ? '#ffe040' : 'rgba(255,255,160,.75)', sel === r ? 3 : 1.5);
            }
            let nb = s.pos.bar[pl];
            if (anim && anim.pl === pl && anim.to === S.BAR) nb--;
            if (drag && drag.moved && pl === G.me && drag.from === S.BAR) nb--;
            for (let k = 0; k < nb; k++) checker(pl, ...spotXY(pl, S.BAR, k, nb));
            if (anim && anim.pl !== pl && s.last && s.last.hit && anim.to !== S.OFF) { /* the hit checker is already on the bar */ }
            if (nb > 0 && sources.has(S.BAR) && pl === G.me) ring(...spotXY(pl, S.BAR, nb - 1, nb), sel === S.BAR ? '#ffe040' : 'rgba(255,255,160,.75)', sel === S.BAR ? 3 : 1.5);
            let no = s.pos.off[pl];
            if (anim && anim.pl === pl && anim.to === S.OFF) no--;
            for (let k = 0; k < no; k++) {
                const [x, y] = spotXY(pl, S.OFF, k, no);
                ctx.fillStyle = pl === 0 ? '#efe4c8' : '#a01822';
                ctx.fillRect(x - 21, y - 6, 42, 12);
                ctx.strokeStyle = pl === 0 ? '#8a7a58' : '#3a0408'; ctx.strokeRect(x - 21, y - 6, 42, 12);
            }
        }
        if (anim) {
            const t = min(1, (now - anim.t0) / anim.dur), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) * (-2 * t + 2) / 2;
            const lift = Math.sin(t * PI) * 18;
            checker(anim.pl, anim.a[0] + (anim.b[0] - anim.a[0]) * e, anim.a[1] + (anim.b[1] - anim.a[1]) * e - lift);
        }
        if (drag && drag.moved) checker(G.me, drag.x, drag.y);
        drawDice(now);
        // pips
        ctx.font = 'bold 11px Tahoma, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe9c0';
        ctx.fillText(S.pips(s.pos, 1 - max(0, G.me)) + '', (TX0 + TX1) / 2, H / 2 - 6);
        ctx.fillText(S.pips(s.pos, max(0, G.me)) + '', (TX0 + TX1) / 2, H / 2 + 14);
        if (G.paused) {
            ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, W, H);
        }
    }
    function checker(pl, x, y) {
        const sp = sprites[pl], w = sp.width / dpr;
        ctx.drawImage(sp, x - w / 2, y - w / 2, w, w);
    }
    function ring(x, y, col, lw) {
        ctx.beginPath(); ctx.arc(x, y, CR - 1, 0, PI * 2); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); ctx.lineWidth = 1;
    }
    const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
    function dieFace(x, y, sz, v, used, ang, pl) {
        ctx.save();
        ctx.translate(x, y); ctx.rotate(ang);
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-sz / 2 + 3, -sz / 2 + 3, sz, sz);
        ctx.fillStyle = used ? '#9a9080' : (pl === 0 ? '#fbf6e8' : '#c42a34');
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
        ctx.strokeStyle = '#000'; ctx.strokeRect(-sz / 2 + 0.5, -sz / 2 + 0.5, sz - 1, sz - 1);
        ctx.fillStyle = used ? '#5a5248' : (pl === 0 ? '#111' : '#fff');
        const q = sz * 0.26;
        for (const [a, b] of PIPS[v] || []) { ctx.beginPath(); ctx.arc(a * q, b * q, sz * 0.09, 0, PI * 2); ctx.fill(); }
        ctx.restore();
    }
    function drawDice(now) {
        const s = G.s;
        const mineSide = s.turn === G.me || G.me < 0 && s.turn === 0;
        const cx = mineSide ? (RX + TX0 - FR) / 2 : (FR + BX0) / 2, cy = H / 2;
        if (s.phase === 'roll') {
            if (myTurn()) {
                ctx.fillStyle = 'rgba(0,0,128,.82)'; ctx.fillRect(cx - 70, cy - 17, 140, 34);
                ctx.strokeStyle = '#fff'; ctx.strokeRect(cx - 69.5, cy - 16.5, 139, 33);
                ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Tahoma, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('click to roll', cx, cy + 1); ctx.textBaseline = 'alphabetic';
            }
            return;
        }
        if (s.phase !== 'move') return;
        const rolling = now - G.diceAt < 600 / G.ff;
        const dbl = s.dice[0] === s.dice[1];
        const faces = dbl ? [s.dice[0], s.dice[0], s.dice[0], s.dice[0]] : s.dice;
        const usedN = faces.length - s.rem.length;
        const sz = dbl ? 30 : 38, gap = sz + 8;
        faces.forEach((v, i) => {
            const x = cx + (i - (faces.length - 1) / 2) * gap;
            let used;
            if (dbl) used = i < usedN;
            else used = !s.rem.includes(v) || (s.rem.length === 1 && s.dice[0] === s.dice[1]);
            if (rolling) dieFace(x + (random() - 0.5) * 8, cy + (random() - 0.5) * 8, sz, 1 + floor(random() * 6), false, (random() - 0.5) * 0.9, s.turn);
            else dieFace(x, cy, sz, v, used, (i % 2 ? 0.08 : -0.06), s.turn);
        });
        if (s.opening && !s.log.length && !s.steps.length && !rolling) {
            ctx.font = '11px Tahoma, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff2d0';
            ctx.fillText('opening roll: ' + COLORS[0] + ' ' + s.opening[0] + ', ' + COLORS[1] + ' ' + s.opening[1], cx, cy + 36);
        }
        if (!rolling && s.noMove && !s.steps.length) {
            ctx.font = 'bold 13px Tahoma, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff2d0';
            ctx.fillText('no move', cx, cy - 30);
        }
    }
    // the menu's backdrop: the starting position, gently
    function drawAttract() {
        const s = S.startPos();
        const fake = { me: 0 };
        const keep = G; G = fake;
        for (const pl of [0, 1]) for (let r = 0; r < 24; r++) { const n = S.own(s, pl, r); for (let k = 0; k < n; k++) checker(pl, ...spotXY(pl, r, k, n)); }
        G = keep;
    }

    // ---------------------------------------------------------------
    // the hud around the board, redrawn only when it says something new
    // ---------------------------------------------------------------
    function say(t) { if (G) { G.status = t; G.statusAt = performance.now(); } refresh(); }
    function statusText() {
        const s = G.s, who = G.names[s.turn];
        if (G.status && performance.now() - G.statusAt < 3500) return G.status;
        if (G.paused) return 'paused. press p or resume.';
        if (s.phase === 'over' || s.phase === 'match') return G.names[s.result.winner] + ' won the game' + (s.result.mars ? ' with a mars' : '') + '.';
        if (s.turn === G.me && !G.bots[G.me]) {
            if (s.phase === 'roll') return 'your turn: roll the dice (space).';
            const left = legalNow().length;
            if (!left) return s.steps.length ? 'all played. done (space) or undo (u).' : 'no move, passing...';
            return 'move ' + s.rem.length + ' more: click a checker, then a green point.';
        }
        return (G.bots[s.turn] ? who + ' is thinking...' : 'waiting for ' + who + '...');
    }
    function refresh(force) {
        if (!G || !root) return;
        const s = G.s;
        const key = [s.v, s.phase, s.turn, G.paused, G.sel, G.status, G.names.join(), G.bots.join(), screen].join('|');
        if (!force && key === G.hudKey) return;
        G.hudKey = key;
        const chip = pl => `<div class="tv-chip ${s.turn === pl && (s.phase === 'roll' || s.phase === 'move') ? 'on' : ''}" data-seat="${pl}"><i class="${pl ? 'r' : 'w'}"></i><span>${esc(G.names[pl])}${pl === G.me ? ' (you)' : ''}</span><em>${S.pips(s.pos, pl)} pips</em><b>${s.score[pl]}</b></div>`;
        const order = G.me === 1 ? [1, 0] : [0, 1];
        topEl.innerHTML = chip(order[0]) + `<div class="tv-mid">${s.target === 1 ? 'one game' : 'first to ' + s.target} · game ${s.game}</div>` + chip(order[1]);
        const mine = myTurn();
        const btn = a => barEl.querySelector('[data-act="' + a + '"]');
        btn('roll').disabled = !(mine && s.phase === 'roll');
        btn('undo').disabled = !(mine && s.phase === 'move' && s.steps.length);
        btn('done').disabled = !(mine && s.phase === 'move' && !legalNow().length);
        btn('pause').hidden = G.mode !== 'solo';
        btn('pause').textContent = G.paused ? 'resume' : 'pause';
        btn('menu').textContent = G.mode === 'online' ? 'leave' : 'menu';
        statusEl.textContent = statusText();
        // the log
        const lk = s.game + ':' + s.log.length + ':' + G.mid;
        if (lk !== G.logKey) {
            G.logKey = lk;
            logEl.innerHTML = '<li class="sep">game ' + s.game + '</li>' + s.log.map(e => `<li class="${e.pl ? 'r' : 'w'}">${e.pl ? 'red' : 'wht'} ${esc(S.turnText(e))}</li>`).join('');
            logEl.scrollTop = logEl.scrollHeight;
        }
    }

    // ---------------------------------------------------------------
    // overlays: the menu, how to play, pause, the end of a game
    // ---------------------------------------------------------------
    function openOver(kind, html) { overKind = kind; over.innerHTML = html; over.classList.add('on'); }
    function closeOver() { overKind = ''; over.classList.remove('on'); over.innerHTML = ''; }
    function menu() {
        ensureWindow();
        if (G && G.mode === 'online') leaveOnline();
        G = null; screen = 'menu'; dirty = true;
        topEl.innerHTML = '<div class="tv-chip"><i class="w"></i><span>white</span></div><div class="tv-mid">tavla 98</div><div class="tv-chip"><i class="r"></i><span>red</span></div>';
        logEl.innerHTML = '';
        statusEl.textContent = 'pick a match.';
        barEl.querySelectorAll('[data-act]').forEach(b => { b.disabled = b.dataset.act !== 'menu'; });
        const p = prefs(), st = stats(), save = loadSave();
        const sel = (id, list, v) => `<select class="tv-sel" id="${id}">${list.map(([k, t]) => `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
        openOver('menu', `<div class="tv-panel tv-menu">
            <div class="tv-logo">tavla<span>98</span></div>
            <div class="tv-sub">backgammon the way the coffee house plays it. no cube, a mars is worth two.</div>
            <div class="tv-opts">
                <label>the bot ${sel('tv-level', [['easy', 'easy (çırak)'], ['normal', 'normal (kahveci)'], ['hard', 'hard (usta)']], p.level)}</label>
                <label>match ${sel('tv-points', [[5, 'first to 5'], [3, 'first to 3'], [1, 'one game']], p.points)}</label>
                <label class="tv-check"><input type="checkbox" id="tv-autobear" ${p.autoBear ? 'checked' : ''}> bear off by itself when the race is obvious</label>
            </div>
            <div class="tv-btns">
                ${save ? `<button class="tv-btn go" data-act="continue">continue match (${save.s.score[0]}-${save.s.score[1]})</button>` : ''}
                <button class="tv-btn go" data-act="solo">play the bot</button>
                <button class="tv-btn" data-act="online">play online</button>
                <button class="tv-btn" data-act="help">how to play</button>
            </div>
            <div class="tv-stats">${st.games ? `${st.wins} of ${st.games} games won · ${st.mars} by mars · ${st.matchWins}/${st.matches} matches` : 'no games yet. the tea is on the house.'}</div>
        </div>`);
    }
    function help() {
        const back = G ? 'back' : 'menu';
        if (G && G.mode === 'solo' && !G.paused) G.paused = true;
        openOver('help', `<div class="tv-panel tv-help"><h3>how to play</h3><ul>
            <li>you are <b>white</b> (or whoever sits at the bottom). move all fifteen checkers round to your home board, bottom right, then bear them off. first one off wins.</li>
            <li>roll, then move one checker per die. doubles play four times. you have to use both dice if you can, and the bigger one if only one fits.</li>
            <li>you can't land on two or more of theirs. land on a lone one and it goes to the bar; a checker on the bar has to come in before anything else moves.</li>
            <li>win before they bear off a single checker: <b>mars</b>, 2 points. otherwise 1.</li>
            <li><b>mouse/touch:</b> click a checker, then a green point (or drag it). a checker with one way to go just goes. click the dice area to roll.</li>
            <li><b>keys:</b> space roll / done · ←→ pick a checker · ↑↓ pick a target · enter move · 1-6 move with that die · u undo · p pause.</li>
        </ul><div class="tv-btns"><button class="tv-btn go" data-act="${back}">${back}</button></div></div>`);
    }
    function showPause() {
        refresh(true); dirty = true;
        openOver('pause', `<div class="tv-panel"><h3>paused</h3><div class="tv-sub">the bot is waiting with its tea.</div><div class="tv-btns"><button class="tv-btn go" data-act="resume">resume</button><button class="tv-btn" data-act="help">how to play</button><button class="tv-btn" data-act="menu">menu</button></div></div>`);
    }
    function showResult() {
        if (!G || !G.s.result) return;
        const s = G.s, r = s.result, won = r.winner === G.me;
        const head = G.me < 0 ? G.names[r.winner] + ' wins' : won ? 'you win' : G.names[r.winner] + ' wins';
        const pts = r.pts + (r.pts === 1 ? ' point' : ' points') + (r.mars ? ', mars!' : '');
        const score = `${esc(G.names[0])} ${s.score[0]} - ${s.score[1]} ${esc(G.names[1])}`;
        let btns;
        if (s.phase === 'match') {
            btns = G.mode === 'solo' ? '<button class="tv-btn go" data-act="again">play again</button><button class="tv-btn" data-act="menu">menu</button>'
                : G.isHost ? '<button class="tv-btn go" data-act="rematch">rematch</button><button class="tv-btn" data-act="menu">leave</button>'
                    : '<button class="tv-btn" data-act="menu">leave</button>';
        } else btns = '<button class="tv-btn go" data-act="next">next game</button>' + (G.mode === 'solo' ? '<button class="tv-btn" data-act="menu">menu</button>' : '');
        openOver('result', `<div class="tv-panel"><h3>${s.phase === 'match' ? 'match over' : 'game ' + r.game}</h3>
            <div class="tv-big">${esc(head)}</div><div class="tv-score">${esc(pts)}</div><div class="tv-score">${score}${s.phase === 'match' ? '' : ' · first to ' + s.target}</div>
            ${s.phase === 'match' && G.mode === 'online' && !G.isHost ? '<div class="tv-sub">the host can start a rematch.</div>' : ''}
            <div class="tv-btns">${btns}</div></div>`);
    }
    function onOverClick(e) {
        const b = e.target.closest('[data-act]');
        if (b) command(b.dataset.act);
    }
    function readMenu() {
        const lv = over.querySelector('#tv-level'), pt = over.querySelector('#tv-points'), ab = over.querySelector('#tv-autobear');
        const o = {};
        if (lv) o.level = lv.value;
        if (pt) o.points = +pt.value;
        if (ab) o.autoBear = ab.checked;
        savePrefs(o);
        return o;
    }
    function command(act) {
        switch (act) {
            case 'solo': { const o = readMenu(); startSolo(o); break; }
            case 'continue': { readMenu(); const sv = loadSave(); if (sv) startSolo({ s: sv.s, level: sv.level }); break; }
            case 'online': readMenu(); if (typeof openNetplay === 'function') openNetplay({ gameId: 'tavla' }); else if (typeof openLobby === 'function') openLobby({ gameId: 'tavla' }); break;
            case 'help': if (overKind === 'menu') readMenu(); help(); break;
            case 'menu': if (G && G.mode === 'solo') saveSolo(); menu(); break;
            case 'back': closeOver(); if (G && G.paused) showPause(); break;
            case 'roll': if (myTurn() && G.s.phase === 'roll') doAct(G.me, { t: 'roll' }); break;
            case 'undo': if (myTurn() && G.s.steps.length) { G.autoPlan = null; doAct(G.me, { t: 'undo' }); } break;
            case 'done': if (myTurn() && G.s.phase === 'move') doAct(G.me, { t: 'done' }); break;
            case 'pause': if (G && G.mode === 'solo') { if (G.paused) command('resume'); else { G.paused = true; showPause(); } } break;
            case 'resume': if (G) { G.paused = false; G.botAt = 0; closeOver(); refresh(true); dirty = true; } break;
            case 'next':
                if (!G || G.s.phase !== 'over') break;
                closeOver();
                if (G.isHost) doAct(G.me < 0 ? 0 : G.me, { t: 'next' });
                else { G.seq++; G.session.sendToHost('tavla:act', { a: { t: 'next' }, n: G.seq }); }
                break;
            case 'again': startSolo({ level: G.level, points: G.s.target }); break;
            case 'rematch': if (G && G.isHost && G.mode === 'online') rematch(); break;
        }
    }

    // ---------------------------------------------------------------
    // hands: mouse, finger and keys
    // ---------------------------------------------------------------
    let drag = null, kbUsed = false;
    function toBoard(e) {
        const r = cv.getBoundingClientRect();
        return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height];
    }
    // which spot in the viewer's own numbering is under a board point
    function spotAt(x, y) {
        if (x >= TX0 - 8 && x <= TX1 + 8) return S.OFF;
        if (x >= BX0 && x < BX1) return S.BAR;
        let d = -1;
        if (x >= FR && x < BX0) { const c = floor((x - FR) / PW); d = y >= H / 2 ? 11 - c : 12 + c; }
        else if (x >= RX && x < TX0 - FR) { const c = floor((x - RX) / PW); d = y >= H / 2 ? 5 - c : 18 + c; }
        if (d < 0) return null;
        // viewer numbering is the viewer's own rel numbering
        return d;
    }
    function tryMove(from, to) {
        const opts = legalNow().filter(x => x.from === from && x.to === to).sort((a, b) => a.die - b.die);
        if (!opts.length) return false;
        G.sel = null;
        return !doAct(G.me, { t: 'move', from, die: opts[0].die });
    }
    function onDown(e) {
        if (!G || screen !== 'play' || overKind) return;
        e.preventDefault();
        kbUsed = false;
        const s = G.s;
        if (!myTurn()) return;
        if (s.phase === 'roll') { command('roll'); return; }
        const [x, y] = toBoard(e);
        const at = spotAt(x, y);
        // the dice: done when everything is played
        if (at !== null && at !== S.OFF && at !== S.BAR && !legalNow().length && s.steps.length) { const cx = (RX + TX0 - FR) / 2; if (Math.abs(x - cx) < 70 && Math.abs(y - H / 2) < 30) { command('done'); return; } }
        if (G.sel !== null && at !== null && targetsOf(G.sel).includes(at)) { tryMove(G.sel, at); return; }
        const sources = new Set(legalNow().map(m => m.from));
        if (at !== null && sources.has(at)) {
            G.sel = at; G.kbTo = 0;
            drag = { from: at, x, y, sx: x, sy: y, moved: false, id: e.pointerId };
            try { cv.setPointerCapture(e.pointerId); } catch (_) { }
        } else G.sel = null;
        dirty = true; refresh();
    }
    function onMove(e) {
        if (!drag) return;
        const [x, y] = toBoard(e);
        drag.x = x; drag.y = y;
        if (!drag.moved && Math.hypot(x - drag.sx, y - drag.sy) > 8) drag.moved = true;
        dirty = true;
    }
    function onUp(e) {
        if (!drag) return;
        const d = drag;
        drag = null;
        dirty = true;
        if (!G) return;
        const [x, y] = toBoard(e);
        const t = targetsOf(d.from);
        if (d.moved) {
            const at = spotAt(x, y);
            if (at !== null && t.includes(at)) tryMove(d.from, at);
            return;
        }
        // a plain click: one place to go means go there
        if (t.length === 1) tryMove(d.from, t[0]);
    }
    function onKey(e) {
        if (!onTop() || !G || screen !== 'play') return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        const k = e.key, s = G.s;
        let used = true;
        if (overKind === 'result' && (k === 'n' || k === 'N' || k === 'Enter' || k === ' ')) { const b = over.querySelector('.tv-btn.go'); if (b) command(b.dataset.act); }
        else if (overKind === 'pause' && (k === 'p' || k === 'P' || k === 'Escape' || k === ' ')) command('resume');
        else if (overKind) used = false;
        else if (k === 'p' || k === 'P' || k === 'Escape') command('pause');
        else if (k === 'u' || k === 'U' || k === 'Backspace' || (k === 'z' && (e.ctrlKey || e.metaKey))) command('undo');
        else if (!myTurn()) used = k === ' ';
        else if (k === ' ' || (k === 'Enter' && G.sel === null)) {
            if (s.phase === 'roll') command('roll'); else if (!legalNow().length) command('done');
        } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
            const src = [...new Set(legalNow().map(m => m.from))].sort((a, b) => b - a);
            if (src.length) { const i = src.indexOf(G.sel), n = src.length; G.sel = src[k === 'ArrowRight' ? (i + 1) % n : (i < 0 ? n - 1 : (i - 1 + n) % n)]; G.kbTo = 0; kbUsed = true; }
        } else if (k === 'ArrowUp' || k === 'ArrowDown') {
            if (G.sel !== null) { const t = targetsOf(G.sel); if (t.length) G.kbTo = (G.kbTo + (k === 'ArrowUp' ? 1 : t.length - 1)) % t.length; kbUsed = true; }
        } else if (k === 'Enter') {
            if (G.sel !== null) { const t = targetsOf(G.sel); if (t.length) tryMove(G.sel, t[min(G.kbTo, t.length - 1)]); }
        } else if (/^[1-6]$/.test(k)) {
            const d = +k, m = legalNow().find(x => x.die === d && (G.sel === null ? false : x.from === G.sel));
            if (m) doAct(G.me, { t: 'move', from: m.from, die: d }); else sfx.bad();
        } else used = false;
        if (used) { e.preventDefault(); e.stopPropagation(); dirty = true; refresh(); }
    }

    // ---------------------------------------------------------------
    // online: host authoritative
    // ---------------------------------------------------------------
    function startOnline(session, d) {
        ensureWindow();
        leaveOnline(session);
        const slots = (d && Array.isArray(d.slots) ? d.slots : [session.id]).slice(0, 2);
        const me = slots.indexOf(session.id);
        const name = id => { const p = session.player(id); return p ? String(p.name).slice(0, 16) : 'someone'; };
        const target = [1, 3, 5].includes(+(d.options && d.options.points)) ? +d.options.points : 5;
        const s = S.newMatch({ seed: (d.seed >>> 0) || 1, target });
        const bots = [null, slots[1] ? null : 'normal'];
        const names = [name(slots[0]), slots[1] ? name(slots[1]) : BOT_NAMES.normal];
        G = makeGame({ s, mode: 'online', me, names, bots, session, isHost: !!session.isHost, seatIds: slots });
        const g = G;
        const on = (t, f) => g.unsubs.push(session.on(t, f));
        if (g.isHost) {
            on('tavla:act', (m, from) => hostIntent(g, m, from));
            on('tavla:hi', (m, from) => { if (G === g) broadcast(from && from.id); });
            on('player-leave', p => {
                if (G !== g) return;
                const seat = g.seatIds.indexOf(p.id);
                if (seat < 0 || g.bots[seat]) return;
                g.bots[seat] = 'normal';
                g.names[seat] = g.names[seat] + ' (bot)';
                say(p.name + ' left. a bot took the seat.');
                broadcast();
            });
            broadcast();
        } else {
            on('tavla:state', m => guestState(g, m));
            on('player-leave', p => { if (p.host) hostGone(g); });
            on('closed', () => hostGone(g));
            on('net:down', () => say('the host went quiet...'));
            session.sendToHost('tavla:hi', {});
            setTimeout(() => { if (G === g && g.prevMid === undefined && session.alive) session.sendToHost('tavla:hi', {}); }, 1500);
        }
        enterPlay();
        say(g.isHost ? 'you host. you are white, you roll the dice for everybody.' : 'connected. you are red.');
    }
    function broadcast(to) {
        const g = G;
        if (!g || g.mode !== 'online' || !g.isHost || !g.session) return;
        g.sentAt = performance.now();
        g.session.send('tavla:state', { s: g.s, ack: g.ack, names: g.names, bots: g.bots, mid: g.mid }, to);
    }
    function hostIntent(g, m, from) {
        if (G !== g || !m || !from) return;
        const seat = g.seatIds.indexOf(from.id);
        if (seat < 0 || seat === g.me || g.bots[seat]) return;
        const n = +m.n;
        if (Number.isFinite(n) && n > g.ack) g.ack = n;
        const a = m.a || {};
        let err = 'bad action';
        if (a.t === 'next') { if (g.s.phase === 'over') { closeOver(); err = doAct(seat, { t: 'next' }); } else err = 'not over'; }
        else if (['roll', 'move', 'undo', 'done'].includes(a.t)) err = doAct(seat, a.t === 'move' ? { t: 'move', from: +a.from, die: +a.die } : { t: a.t });
        // the guest hears back either way, so a refused move snaps back on its screen
        if (err) broadcast();
    }
    function guestState(g, m) {
        if (G !== g || !m || !S.validSnapshot(m.s)) return;
        const ack = +m.ack || 0;
        if (ack > g.ack) g.ack = ack;
        const newMatch = m.mid !== g.prevMid && g.prevMid !== undefined;
        g.prevMid = m.mid;
        if (g.seq > ack && !newMatch) return;     // still waiting on my own moves to come back
        if (newMatch) { g.mid = m.mid; g.recorded = {}; g.prev = S.snapshot(m.s); closeOver(); }
        if (Array.isArray(m.names)) g.names = m.names.slice(0, 2).map(x => String(x).slice(0, 24));
        if (Array.isArray(m.bots)) g.bots = [m.bots[0] ? 'normal' : null, m.bots[1] ? 'normal' : null];
        g.bots[g.me] = null;
        if (m.s.v === g.s.v && JSON.stringify(m.s) === JSON.stringify(g.s)) { refresh(); return; }
        if (overKind === 'result' && (m.s.phase === 'roll' || m.s.phase === 'move')) closeOver();
        g.s = m.s;
        changed();
    }
    function hostGone(g) {
        if (G !== g || g.mode !== 'online' || g.isHost) return;
        const host = 1 - g.me;
        g.unsubs.forEach(f => f()); g.unsubs = [];
        try { if (g.session && g.session.alive) g.session.leave(); } catch (e) { }
        g.session = null;
        g.mode = 'solo'; g.isHost = true; g.level = 'normal';
        g.bots[host] = 'normal'; g.bots[g.me] = null;
        g.names[host] = g.names[host] + ' (bot)';
        g.seq = g.ack = 0;
        say('the host left. a bot took their seat; finish the match.');
        if (overKind === 'result') showResult();
        dirty = true; refresh(true);
    }
    function rematch() {
        const g = G;
        g.s = S.newMatch({ seed: (floor(random() * 1e9) >>> 0) || 1, target: g.s.target });
        g.mid++; g.recorded = {}; g.prev = S.snapshot(g.s);
        closeOver();
        enterPlay();
        broadcast();
    }
    function leaveOnline(keep) {
        if (!G || !G.session) return;
        G.unsubs.forEach(f => f());
        G.unsubs = [];
        if (G.session !== keep) { try { if (G.session.alive) G.session.leave(); } catch (e) { } }
        G.session = null;
    }

    // ---------------------------------------------------------------
    // the front doors
    // ---------------------------------------------------------------
    window.startTavla = function () {
        ensureWindow();
        if (!G && overKind !== 'menu') menu();
        return winRef.win;
    };
    function paintAvatar(canvas) {
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        c.fillStyle = '#c98f4f'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#1d3b2a'; c.beginPath(); c.moveTo(w * 0.1, 0); c.lineTo(w * 0.3, h * 0.6); c.lineTo(w * 0.5, 0); c.fill();
        c.fillStyle = '#7a1a14'; c.beginPath(); c.moveTo(w * 0.5, h); c.lineTo(w * 0.7, h * 0.4); c.lineTo(w * 0.9, h); c.fill();
        c.fillStyle = '#fbf6e8'; c.fillRect(w * 0.28, h * 0.42, w * 0.3, h * 0.3);
        c.strokeStyle = '#000'; c.strokeRect(w * 0.28, h * 0.42, w * 0.3, h * 0.3);
        c.fillStyle = '#000'; [[0.36, 0.5], [0.5, 0.64], [0.43, 0.57]].forEach(([a, b]) => { c.beginPath(); c.arc(w * a, h * b, w * 0.03, 0, PI * 2); c.fill(); });
    }
    if (window.Netplay) {
        Netplay.registerGame({
            id: 'tavla', name: 'tavla 98',
            start: (session, d) => startOnline(session, d || {}),
            startSolo: () => { ensureWindow(); menu(); },
            soloLabel: 'play the bot',
            paintAvatar
        });
    }

    // for the tests: read the match, set one up, speed it up
    window.TAVLA_ENGINE = {
        sim: S,
        game: () => G,
        state: () => G && G.s,
        screen: () => screen,
        over: () => overKind,
        startSolo: o => { startSolo(o); return true; },
        fast: k => { if (G) G.ff = k || 1; },
        legal: () => (G ? legalNow() : []),
        // host or solo only: put a position on the board (a test's shortcut to the end of a game)
        force: (pos, turn, extra) => {
            if (!G || !G.isHost) return false;
            G.s.pos = S.clonePos(pos);
            G.s.turn = turn; G.s.phase = 'roll'; G.s.rem = []; G.s.steps = []; G.s.dice = []; G.s.turnStart = null; G.s.noMove = false;
            Object.assign(G.s, extra || {});
            G.s.v++;
            G.botPlan = null; G.autoPlan = null;
            changed();
            if (G.mode === 'online') broadcast();
            return true;
        },
        // where on the page a spot is: the top checker of a point, the bar, the tray
        xy: (rel, seat) => {
            if (!G || !cv) return null;
            const s = G.s, pl = seat === undefined ? G.me : seat;
            const n = countAt(s, pl, rel);
            const [x, y] = spotXY(pl, rel, max(0, n - 1), max(1, n));
            const r = cv.getBoundingClientRect();
            return { x: r.left + x * r.width / W, y: r.top + y * r.height / H };
        }
    };
})();
