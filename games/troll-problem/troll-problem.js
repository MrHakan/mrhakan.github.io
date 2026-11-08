// ===================================================================
// SIR, WE HAVE A TROLL PROBLEM — the game on the page
//
// A tower defense in the style of bloons, on the desktop: trolls walk a road
// across the wallpaper, and you put the desktop's own furniture down anywhere
// off it. Every tower has two upgrade paths of four tiers; one path can go all
// the way and the other stops at two. Up to four of you can hold one road.
//
//   troll-problem-data.js   the numbers
//   troll-problem-sim.js    the rules and the bots. no page in it
//   this file               the window, the canvas, the mouse and the wire
//
// Online the host owns the game: a guest sends what it wants to build and the
// host's simulation decides. The guest runs the same simulation as a puppet so
// the trolls walk and the towers fire smoothly between the host's snapshots,
// which say who is where, who is hurt and who has gone.
// ===================================================================
(function () {
    'use strict';

    const TP = window.TP, S = window.TP_SIM;
    if (!TP || !S) { console.warn('[troll problem] a file is missing'); return; }
    const { hypot, min, max, floor, round, sin, cos, atan2, PI } = Math;
    const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
    const money = n => '$' + floor(n).toLocaleString('en-US');

    // the styles for this game only, fetched with it rather than with the desktop
    function ensureCss() {
        if (document.getElementById('tg-css')) return;
        const l = document.createElement('link');
        l.id = 'tg-css'; l.rel = 'stylesheet'; l.href = 'games/troll-problem/troll-problem.css';
        document.head.appendChild(l);
    }

    // ===============================================================
    // sound: synthesized, no files, and quiet when the site is muted
    // ===============================================================
    let actx = null;
    function audio() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!actx) actx = new AC();
        if (actx.state === 'suspended') actx.resume().catch(() => { });
        return actx;
    }
    const soundOn = () => (typeof soundEnabled === 'undefined' ? true : soundEnabled);
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
            g.gain.exponentialRampToValueAtTime(o.gain || 0.05, t0 + min(0.012, dur / 3));
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(t0); osc.stop(t0 + dur + 0.02);
        } catch (e) { }
    }
    function noise(dur, o) {
        if (!soundOn()) return;
        const ctx = audio();
        if (!ctx) return;
        o = o || {};
        try {
            const t0 = ctx.currentTime;
            const n = max(1, floor(ctx.sampleRate * dur));
            const buf = ctx.createBuffer(1, n, ctx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
            const src = ctx.createBufferSource(); src.buffer = buf;
            const f = ctx.createBiquadFilter(); f.type = 'lowpass';
            f.frequency.setValueAtTime(o.from || 2400, t0);
            f.frequency.exponentialRampToValueAtTime(o.to || 200, t0 + dur);
            const g = ctx.createGain();
            g.gain.setValueAtTime(o.gain || 0.07, t0);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            src.connect(f); f.connect(g); g.connect(ctx.destination);
            src.start(t0);
        } catch (e) { }
    }
    const sfxAt = {};
    function sfx(name) {
        // a hundred trolls can die in one second: each sound gets a little room
        const now = performance.now();
        if (sfxAt[name] && now - sfxAt[name] < (name === 'die' || name === 'shot' ? 60 : 30)) return;
        sfxAt[name] = now;
        switch (name) {
            case 'shot': tone(620 + Math.random() * 90, 0.035, { type: 'triangle', gain: 0.025 }); break;
            case 'die': tone(170, 0.08, { type: 'sawtooth', gain: 0.035, slideTo: 60 }); break;
            case 'boom': noise(0.16, { from: 1400, to: 160, gain: 0.07 }); break;
            case 'zap': tone(900, 0.06, { type: 'sawtooth', gain: 0.03, slideTo: 1700 }); break;
            case 'ban': tone(140, 0.14, { type: 'square', gain: 0.07, slideTo: 70 }); noise(0.12, { gain: 0.05 }); break;
            case 'build': tone(440, 0.05, { gain: 0.05 }); tone(660, 0.07, { gain: 0.05, delay: 0.05 }); break;
            case 'sell': tone(660, 0.05, { type: 'triangle', gain: 0.05 }); tone(440, 0.07, { type: 'triangle', gain: 0.05, delay: 0.05 }); break;
            case 'up': tone(523, 0.06, { gain: 0.05 }); tone(784, 0.09, { gain: 0.05, delay: 0.06 }); break;
            case 'top': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.1, { gain: 0.05, delay: i * 0.06 })); break;
            case 'leak': tone(220, 0.18, { type: 'sawtooth', gain: 0.07, slideTo: 90 }); break;
            case 'wave': tone(392, 0.09, { type: 'triangle', gain: 0.06 }); tone(523, 0.12, { type: 'triangle', gain: 0.06, delay: 0.08 }); break;
            case 'boss': tone(110, 0.3, { type: 'sawtooth', gain: 0.08 }); tone(98, 0.35, { type: 'sawtooth', gain: 0.08, delay: 0.32 }); break;
            case 'clear': tone(523, 0.1, { gain: 0.06 }); tone(659, 0.1, { gain: 0.06, delay: 0.09 }); tone(784, 0.16, { gain: 0.06, delay: 0.18 }); break;
            case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, i === 3 ? 0.4 : 0.13, { gain: 0.08, delay: i * 0.12 })); break;
            case 'lose': tone(392, 0.2, { type: 'sawtooth', gain: 0.08, slideTo: 190 }); tone(190, 0.4, { type: 'sawtooth', gain: 0.07, delay: 0.18, slideTo: 80 }); break;
            case 'no': tone(170, 0.1, { type: 'sawtooth', gain: 0.05 }); break;
            case 'tick': tone(880, 0.03, { type: 'triangle', gain: 0.03 }); break;
            case 'crystal': tone(1200, 0.07, { type: 'sine', gain: 0.05 }); tone(1600, 0.12, { type: 'sine', gain: 0.04, delay: 0.06 }); break;
        }
    }

    // ===============================================================
    // pictures
    // ===============================================================
    const IMG = Object.create(null);
    function img(src) {
        let i = IMG[src];
        if (!i) { i = IMG[src] = new Image(); i.decoding = 'async'; i.src = src; }
        return i.complete && i.naturalWidth ? i : null;
    }
    const towerSrc = (def, look) => TP.ART_DIR + def.art + '-' + look + '.webp';
    const shotSrc = def => TP.ART_DIR + def.art + '-projectile.webp';
    const animSrc = (def, move) => TP.ANIM_DIR + def.anim + '-' + move + '.webp';
    function preload(s) {
        TP.TOWERS.forEach(t => { img(towerSrc(t, 'base')); if (TP.ART[t.art].shot) img(shotSrc(t)); });
        const seen = new Set();
        (TP.WAVES[(s ? s.wave : 1) - 1] || []).concat(TP.WAVES[s ? s.wave : 1] || []).forEach(g => seen.add(g[0]));
        TP.ENEMIES.forEach(e => { if (!s || seen.has(e.id)) { img(animSrc(e, 'walk')); img(animSrc(e, 'death')); } });
    }

    // ===============================================================
    // what is kept: the upgrade tree, and a run to come back to
    // ===============================================================
    const META_KEY = 'trollproblem-meta-v2';      // the name the trophy room reads; the shape inside is v3
    const RUN_KEY = 'trollproblem-run-v3';
    const OLD_RUN = 'trollproblem-run-v2';        // a grid game: its towers do not exist any more
    const PREF_KEY = 'trollproblem-prefs';
    const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
    const drop = k => { try { localStorage.removeItem(k); } catch (e) { } };
    function loadMeta() {
        try { if (localStorage.getItem(OLD_RUN) !== null) localStorage.removeItem(OLD_RUN); } catch (e) { }
        const raw = readJson(META_KEY);
        const m = S.migrateMeta(raw);
        if (raw && raw.v !== 3) saveMeta(m);
        return m;
    }
    const saveMeta = m => writeJson(META_KEY, m);
    const metaLevels = m => Object.assign({}, m.spent);
    const hasRun = () => { const r = readJson(RUN_KEY); return !!(r && r.v === 3 && TP.MAP_BY_ID[r.map]); };
    const prefs = () => Object.assign({ speed: 1 }, readJson(PREF_KEY) || {});

    // ===============================================================
    // the window
    // ===============================================================
    let winRef = null, root = null, G = null, M = null, screen = 'menu';
    let raf = null, driver = null, testClock = 1;
    function ensureWindow() {
        ensureCss();
        if (winRef && winRef.win && document.getElementById(winRef.win.id)) return winRef;
        const vw = typeof viewportWidth === 'function' ? viewportWidth() : 1100;
        winRef = createAppWindow('sir, we have a troll problem', { icon: 'castle', width: min(1100, vw - 20) });
        winRef.body.classList.add('tg-body');
        if (document.documentElement.clientHeight < 500) winRef.win.style.top = '0px';
        else if (document.documentElement.clientHeight < 900) winRef.win.style.top = '40px';
        winRef.win._cleanup = () => {
            if (G && G.solo && !G.over) saveRun(G);
            tearDown();
            window.removeEventListener('keydown', onKey, true);
            root = null; winRef = null;
        };
        root = winRef.body;
        root.tabIndex = -1;
        // on the window, ahead of the desktop's own keys, and only while this is the window on top
        window.addEventListener('keydown', onKey, true);
        return winRef;
    }
    function tearDown() {
        stopLoop();
        if (G) {
            if (G.offs) G.offs.forEach(off => { try { off(); } catch (e) { } });
            if (G.unbind) G.unbind();
            if (G.session && !G.solo && G.session.alive) G.session.leave();
        }
        G = null;
    }

    // ===============================================================
    // a game: the simulation, plus everything the screen needs about it
    // ===============================================================
    function makeGame(o) {
        const s = o.restore ? S.restore(o.restore, o) : S.newGame(o);
        if (!s) return null;
        S.refresh(s);
        const g = {
            s, seat: o.seat === undefined ? 0 : o.seat, solo: !o.session, session: o.session || null, isHost: !o.session || !!o.isHost,
            opts: o, speed: o.session ? 1 : prefs().speed, paused: false,
            build: null, ghost: null, sel: null, touchAim: false,
            fx: [], deaths: [], floats: [], banner: null, shake: 0,
            acc: 0, last: performance.now(), snapAcc: 0, lastSnap: performance.now(), hudAt: 0,
            seq: 0, pending: [], acks: {}, seen: {}, sentVer: -1, sentSeatsAt: 0, verAt: 0,
            netDown: false, over: false, ended: false, crystals: 0, msg: null, msgT: 0, tick0: 0
        };
        return g;
    }
    const myGold = g => (g.seat >= 0 && g.s.seats[g.seat] ? g.s.seats[g.seat].gold : 0);
    const towerById = (g, id) => S.towerById(g.s, id);
    function say(g, text, t) { g.msg = text; g.msgT = t || 1.8; }
    function banner(g, text, color, t) { g.banner = { text, color: color || '#ffe14d', t: t || 2, T: t || 2 }; }

    // ---------------------------------------------------------------
    // commands: the host and a solo game run them, a guest sends them
    // ---------------------------------------------------------------
    const WHY = {
        gold: 'not enough money bradar', road: 'not on the road', tower: 'something is already there', edge: 'too close to the edge',
        locked: 'locked: only one path goes past tier ' + TP.CROSS_CAP, max: 'that path is maxed out', mine: 'that is somebody else\'s tower',
        wait: 'the wave is already coming', over: 'the run is over', what: 'that did not work', who: 'you do not have a seat'
    };
    function issue(g, c) {
        if (!g || g.over) return 'over';
        if (g.seat < 0) { say(g, 'you are watching this one'); sfx('no'); return 'who'; }
        if (g.isHost) {
            const why = S.command(g.s, g.seat, c);
            if (why) { if (c.c !== 'go') { say(g, WHY[why] || why); sfx('no'); } }
            else afterCommand(g, c);
            return why;
        }
        // a guest: checked here first so a mistake is said at once, then sent
        const pre = guestCheck(g, c);
        if (pre) { say(g, WHY[pre] || pre); sfx('no'); return pre; }
        g.seq++;
        g.pending.push({ n: g.seq, c, at: performance.now() });
        sendPending(g, true);
        afterCommand(g, c, true);
        return null;
    }
    function guestCheck(g, c) {
        const s = g.s, me = s.seats[g.seat];
        if (!me) return 'who';
        if (c.c === 'place') {
            const why = S.placeProblem(s, c.x, c.y);
            if (why) return why;
            if (me.gold < S.towerCost(s, TP.TOWERS_BY_ID[c.t])) return 'gold';
        } else if (c.c === 'up') {
            const t = S.towerById(s, c.i);
            if (!t) return 'what';
            if (t.owner !== g.seat) return 'mine';
            const why = S.tierProblem(t, c.p);
            if (why) return why;
            if (me.gold < S.tierCost(s, t.def, c.p, c.p ? t.b : t.a)) return 'gold';
        } else if (c.c === 'sell' || c.c === 'mode') {
            const t = S.towerById(s, c.i);
            if (!t) return 'what';
            if (t.owner !== g.seat) return 'mine';
        }
        return null;
    }
    function afterCommand(g, c, guess) {
        if (c.c === 'place') {
            sfx('build');
            if (!guess) g.sel = g.s.towers[g.s.towers.length - 1].id;
            if (!g.keepBuilding) { g.build = null; g.ghost = null; g.touchAim = false; }
            paintShop(g);
        } else if (c.c === 'up') {
            const t = towerById(g, c.i);
            sfx(t && (c.p ? t.b : t.a) >= TP.TIERS ? 'top' : 'up');
        } else if (c.c === 'sell') { sfx('sell'); g.sel = null; }
        else if (c.c === 'go') sfx('tick');
        paintPanel(g);
        hud(g, true);
    }

    // ===============================================================
    // the clock: the rules on a timer, drawing on the display's frames. A
    // hidden tab gets no frames, and a host has to keep its guests' game going
    // ===============================================================
    function startLoop() {
        stopLoop();
        if (G) G.last = performance.now();
        driver = setInterval(drive, 25);
        const frame = () => { raf = requestAnimationFrame(frame); draw(); };
        raf = requestAnimationFrame(frame);
    }
    function stopLoop() {
        if (driver) { clearInterval(driver); driver = null; }
        if (raf) { cancelAnimationFrame(raf); raf = null; }
    }
    function drive() {
        const g = G;
        if (!g) return;
        const now = performance.now();
        let dt = min(0.25, (now - g.last) / 1000);
        g.last = now;
        const run = !g.paused && !g.netDown && !g.over;
        if (run) {
            g.acc += dt * g.speed * testClock;
            let steps = 0;
            const cap = 40 * max(1, testClock);
            while (g.acc >= TP.DT && steps < cap) {
                g.acc -= TP.DT;
                steps++;
                if (g.isHost && g.bots) g.bots.forEach((b, i) => { if (b) S.think(g.s, i, b); });
                S.step(g.s);
                readEvents(g);
                if (g.s.phase === 'won' || g.s.phase === 'lost') break;
            }
            if (steps >= cap) g.acc = 0;
        }
        tickFx(g, dt);
        if (!g.solo) net(g, dt);
        if ((g.s.phase === 'won' || g.s.phase === 'lost') && !g.over) gameOver(g);
        if (now - g.hudAt > 120) { g.hudAt = now; hud(g); }
    }

    // what happened in the rules, turned into things to see and hear
    function readEvents(g) {
        const ev = g.s.ev;
        if (!ev.length) return;
        for (const e of ev) {
            switch (e[0]) {
                case 'fire': {
                    const t = towerById(g, e[1]);
                    if (t) { t.fireT = 0.14; const k = t.def.kind; sfx(k === 'chain' ? 'zap' : t.def.id === 'hammer' ? 'ban' : 'shot'); }
                    break;
                }
                case 'boom': g.fx.push({ k: 'ring', x: e[1], y: e[2], r: e[3], t: 0.3, T: 0.3, c: RING[e[4]] || '#ffb03a' }); sfx('boom'); break;
                case 'zap': g.fx.push({ k: 'zap', pts: e[1], t: 0.16, T: 0.16, seed: Math.random() }); break;
                case 'die': died(g, e[1], e[2], e[3], e[4], e[5]); break;
                case 'leak': leaked(g, e[1], e[2], e[3]); break;
                case 'heal': g.fx.push({ k: 'ring', x: e[1], y: e[2], r: e[3], t: 0.35, T: 0.35, c: '#6aff9a' }); break;
                case 'wave': waveStarted(g, e[1]); break;
                case 'clear': waveCleared(g, e[1]); break;
            }
        }
        ev.length = 0;
    }
    const RING = ['#ffe9a0', '#7ab8ff', '#bfefff', '#ff9a3a', '#9ad8ff', '#ffffff', '#f2f2f2', '#9ad14a', '#ffffff', '#ff4a4a'];
    function died(g, x, y, k, dir, fly) {
        const def = TP.ENEMIES[k];
        if (!def) return;
        g.deaths.push({ def, x, y: y - (fly ? 16 : 0), dir, t: 0 });
        if (g.deaths.length > 60) g.deaths.shift();
        // the money for a boss is worth a word; a hundred imps' worth is noise
        if (def.boss) {
            const share = def.bounty * (1 + g.s.mods.bounty) * TP.coopIncome(g.s.n) / max(1, g.s.seats.filter(p => p.on).length);
            g.floats.push({ x, y: y - 30, text: '+' + money(share), c: '#ffe14d', t: 1.4, T: 1.4 });
        }
        sfx('die');
    }
    function leaked(g, x, y, n) {
        g.fx.push({ k: 'leak', x: min(TP.W - 20, max(20, x)), y: min(TP.H - 20, max(20, y)), t: 0.5, T: 0.5 });
        g.floats.push({ x: min(TP.W - 30, max(30, x)), y: min(TP.H - 20, max(30, y)), text: '-' + n + ' ❤', c: '#ff6a6a', t: 1, T: 1 });
        g.shake = 0.25;
        sfx('leak');
    }
    function waveStarted(g, w) {
        const boss = TP.isBossWave(w);
        banner(g, boss ? 'wave ' + w + ': boss incoming' : 'wave ' + w, boss ? '#ff6a5a' : '#ffe14d', 1.6);
        sfx(boss ? 'boss' : 'wave');
        preload(g.s);
        paintShop(g);
    }
    function waveCleared(g, w) {
        banner(g, 'wave ' + w + ' cleared  +' + money(TP.waveReward(w) * TP.coopIncome(g.s.n) / max(1, g.s.seats.filter(p => p.on).length)), '#8fe86a', 1.8);
        sfx('clear');
        if (TP.ACHIEVEMENT_WAVES.includes(w) && typeof unlockAchievement === 'function') unlockAchievement('troll_wave_' + w);
        recordWave(g, w);
        if (g.solo) saveRun(g);
    }
    function recordWave(g, w) {
        if (!M) return;
        const id = g.s.map.id;
        const before = S.unlockedTowers(M);
        if ((M.bestWave[id] || 0) < w) M.bestWave[id] = w;
        if (w >= TP.MAP_UNLOCK_WAVE) {
            const next = TP.MAPS[g.s.map.i + 1];
            if (next && M.unlockedMaps.indexOf(next.id) < 0) { M.unlockedMaps.push(next.id); toast('new map: ' + next.name); }
        }
        const now = S.unlockedTowers(M);
        now.filter(id => before.indexOf(id) < 0).forEach(id => toast('new tower: ' + TP.TOWERS_BY_ID[id].name));
        saveMeta(M);
        if (g.solo && now.length !== before.length) { g.s.unlocked = new Set(now); paintShop(g); }
    }
    function toast(text) { if (typeof showToast === 'function') showToast('troll problem', text); }

    function gameOver(g) {
        g.over = true;
        const s = g.s, won = s.phase === 'won';
        sfx(won ? 'win' : 'lose');
        if (M) {
            const cleared = won ? TP.TOTAL_WAVES : s.wave - 1;
            const mult = g.solo ? 1 + (M.spent.crystal || 0) * TP.META_BY_ID.crystal.per : 1;
            g.crystals = max(1, round(TP.crystalsFor(cleared, won, s.map.i) * mult));
            M.crystals += g.crystals;
            M.runs++;
            M.totalKills += s.kills;
            M.totalLeaks += s.leaked;
            if (won) {
                M.wins[s.map.id] = true;
                M.cleared = true;
                M.bestWave[s.map.id] = TP.TOTAL_WAVES;
                if (typeof unlockAchievement === 'function') unlockAchievement('troll_king_slain');
            }
            saveMeta(M);
        }
        if (g.solo) drop(RUN_KEY);
        if (!g.solo && g.isHost) sendSnapshot(g, true);
        setTimeout(() => { if (G === g) { screen = 'end'; render(); } }, 900);
    }

    function saveRun(g) {
        if (!g || !g.solo || g.over || g.s.phase === 'won' || g.s.phase === 'lost') return;
        const save = S.saveOf(g.s);
        // a run in the middle of a wave starts that wave again
        writeJson(RUN_KEY, save);
    }

    // ===============================================================
    // the wire
    // ===============================================================
    const onRelays = g => !!(g.session && g.session.transport && g.session.transport.kind === 'bus');
    const send = (g, type, data, to) => { if (g.session && g.session.alive) g.session.send(type, data, to); };
    function net(g, dt) {
        if (g.isHost) {
            g.snapAcc += dt;
            const hz = onRelays(g) ? 4 : 10;
            if (g.snapAcc >= 1 / hz) { g.snapAcc = 0; sendSnapshot(g); }
        } else {
            // a command the host has not answered goes again
            if (g.pending.length && performance.now() - (g.pendingAt || 0) > 1200) sendPending(g);
        }
    }
    function sendPending(g, now) {
        if (!g.pending.length) return;
        g.pendingAt = performance.now();
        if (g.session && g.session.alive) g.session.sendToHost('tp:c', g.pending.slice(0, 8).map(p => [p.n, p.c]));
    }
    function sendSnapshot(g, final) {
        const s = g.s;
        const d = S.snapshot(s);
        d.sp = g.speed; d.pa = g.paused ? 1 : 0;
        d.ak = s.seats.map((p, i) => (g.acks[i] || 0));
        const now = performance.now();
        // the towers and the seats go when they change, and now and then in case a frame got lost
        if (s.towerVer !== g.sentVer || now - g.verAt > 3000 || final) {
            if (s.towerVer !== g.sentVer) { g.sentVer = s.towerVer; g.verRepeat = 3; }
            d.T = S.towerList(s);
            g.verAt = now;
        } else if (g.verRepeat > 0) { g.verRepeat--; d.T = S.towerList(s); }
        if (now - g.sentSeatsAt > 3000 || g.seatsDirty || final) { d.P = S.seatList(s); g.sentSeatsAt = now; g.seatsDirty = false; }
        if (final) { d.T = S.towerList(s); d.P = S.seatList(s); }
        send(g, 'tp:s', d);
    }
    function onSnapshot(g, d) {
        if (!d || typeof d !== 'object' || typeof d.k !== 'number') return;
        if (d.k < g.tick0) return;
        g.tick0 = d.k;
        g.lastSnap = performance.now();
        if (g.netDown) comeBack(g);
        const s = g.s;
        const was = { wave: s.wave, phase: s.phase, lives: s.lives };
        if (Array.isArray(d.P)) {
            S.applySeats(s, d.P);
            s.n = s.seats.length;
            const mine = s.seats.findIndex(p => p.id === g.session.id);
            if (mine !== g.seat) { g.seat = mine; paintShop(g); }
        }
        if (Array.isArray(d.T)) { S.applyTowers(s, d.T); if (g.sel && !towerById(g, g.sel)) g.sel = null; paintPanel(g); }
        const gone = S.applySnapshot(s, d);
        if (gone) for (const e of gone) {
            if (e.dist >= (e.fly ? s.fly : s.road).total - 30) leaked(g, e.x, e.y, e.def.leak);
            else died(g, e.x, e.y, e.k, e.dir, e.fly ? 1 : 0);
        }
        g.speed = TP.SPEEDS.includes(d.sp) ? d.sp : 1;
        g.paused = !!d.pa;
        // what the host has done with my commands
        if (Array.isArray(d.ak) && g.seat >= 0) { const a = +d.ak[g.seat] || 0; g.pending = g.pending.filter(p => p.n > a); }
        if (s.phase === 'wave' && was.phase === 'prep') waveStarted(g, s.wave);
        if (s.wave !== was.wave && s.phase === 'prep') waveCleared(g, was.wave);
        if ((s.phase === 'won' || s.phase === 'lost') && was.phase !== s.phase && !g.over) {
            if (s.phase === 'won') waveCleared(g, was.wave);
            gameOver(g);
        }
    }
    function hostCommands(g, list, from) {
        if (!Array.isArray(list) || !from) return;
        const seat = g.s.seats.findIndex(p => p.id === from.id);
        if (seat < 0) return;
        const seen = g.seen[seat] || (g.seen[seat] = new Set());
        for (const item of list.slice(0, 16)) {
            if (!Array.isArray(item) || typeof item[0] !== 'number') continue;
            const n = item[0];
            if (n <= (g.acks[seat] || 0) || seen.has(n)) continue;
            seen.add(n);
            while (seen.has((g.acks[seat] || 0) + 1)) { g.acks[seat] = (g.acks[seat] || 0) + 1; seen.delete(g.acks[seat]); }
            const why = S.command(g.s, seat, item[1]);
            if (why && !(item[1] && item[1].c === 'go')) send(g, 'tp:no', { n, why }, from.id);
        }
    }
    // somebody joining a game already going: their own seat back, or an empty one
    function seatJoin(g, p) {
        const s = g.s;
        let i = s.seats.findIndex(x => x.id === p.id);
        if (i < 0) i = s.seats.findIndex(x => !x.on);
        if (i >= 0) {
            S.seatOn(s, i, true, p.id, p.name);
            g.seen[i] = new Set(); g.acks[i] = 0;
            say(g, p.name + ' took ' + (i === 0 ? 'a' : 'the') + ' seat ' + (i + 1));
        }
        g.seatsDirty = true;
        g.sentVer = -1;
        // the lobby is long closed for them: hand them the game. Not at once: the
        // session learns which road reaches them just after it says they joined,
        // and once more in a while in case the relays lost it
        const d = Object.assign({}, g.start, { late: 1 });
        g.hi = g.hi || {};
        const hand = n => { if (G !== g || g.hi[p.id] || !g.session.player(p.id)) return; send(g, 'np:start', d, p.id); if (n) setTimeout(() => hand(n - 1), 2500); };
        setTimeout(() => hand(3), 60);
        paintPlayers(g);
    }
    function seatLeft(g, p) {
        const s = g.s;
        const i = s.seats.findIndex(x => x.id === p.id);
        if (i < 0 || i === g.seat) return;
        S.seatOn(s, i, false);
        g.seatsDirty = true;
        say(g, (p.name || 'somebody') + ' left. their towers stay, and anybody who joins with the code takes their seat', 3.5);
        paintPlayers(g);
    }
    function goneQuiet(g) {
        if (g.over || g.isHost) return;
        g.netDown = true;
        paintOverlay(g);
    }
    function comeBack(g) {
        if (!g.netDown) return;
        g.netDown = false;
        g.last = performance.now();
        paintOverlay(g);
    }
    function bindNet(g) {
        const s = g.session, offs = [];
        if (g.isHost) {
            offs.push(s.on('tp:c', (d, from) => hostCommands(g, d, from)));
            offs.push(s.on('player-join', p => seatJoin(g, p)));
            offs.push(s.on('player-leave', p => seatLeft(g, p)));
            offs.push(s.on('tp:again', () => { g.theyWantAgain = true; }));
            offs.push(s.on('tp:hi', (d, from) => { if (from) { (g.hi = g.hi || {})[from.id] = true; g.sentVer = -1; g.seatsDirty = true; } }));
        } else {
            offs.push(s.on('tp:s', d => onSnapshot(g, d)));
            offs.push(s.on('tp:no', d => { if (!d) return; g.pending = g.pending.filter(p => p.n !== d.n); say(g, WHY[d.why] || 'the host said no'); sfx('no'); }));
            offs.push(s.on('tp:new', d => { if (d && d.seed) startOnline(g.session, Object.assign({}, g.start, { seed: d.seed })); }));
            offs.push(s.on('player-leave', p => { if (p.host) goneQuiet(g); }));
            offs.push(s.on('closed', () => goneQuiet(g)));
        }
        offs.push(s.on('net:down', () => goneQuiet(g)));
        offs.push(s.on('net:up', () => { comeBack(g); if (!g.isHost && s.alive) s.announceProfile(); }));
        offs.push(s.on('roster', () => paintPlayers(g)));
        g.offs = offs;
    }

    // ===============================================================
    // starting things
    // ===============================================================
    function startSolo(mapId, restore) {
        ensureWindow();
        tearDown();
        M = loadMeta();
        const g = makeGame({ map: mapId, seed: (Math.random() * 1e9) >>> 0, meta: metaLevels(M), unlocked: S.unlockedTowers(M), restore });
        if (!g) { drop(RUN_KEY); screen = 'maps'; render(); return; }
        G = g;
        screen = 'play';
        render();
        startLoop();
        preload(g.s);
    }
    function startOnline(session, opts) {
        // the same start twice (a late joiner's hand-over resent) changes nothing
        if (G && G.session === session && G.start && G.start.seed === opts.seed && screen === 'play') return;
        ensureWindow();
        const old = G;
        if (old) {
            if (old.offs) old.offs.forEach(off => off());
            if (old.session && old.session !== session && !old.solo && old.session.alive) old.session.leave();
        }
        stopLoop();
        G = null;
        M = loadMeta();
        const o = opts.options || {};
        const map = TP.MAP_BY_ID[o.map] ? o.map : TP.MAPS[0].id;
        const slots = (Array.isArray(opts.slots) ? opts.slots : [session.id]).slice(0, TP.MAX_SEATS);
        const seats = slots.map(id => { const p = session.player(id); return { id, name: p ? p.name : 'player' }; });
        const isHost = !!session.isHost;
        const g = makeGame({ map, seed: opts.seed, seats, session, isHost, seat: slots.indexOf(session.id), puppet: !isHost });
        g.start = { gameId: 'trollproblem', seed: opts.seed, slots, options: { map }, at: opts.at };
        G = g;
        if (isHost) {
            // anybody who was in the lobby and did not make it to the game has left already
            g.s.seats.forEach((p, i) => { if (!session.player(p.id)) S.seatOn(g.s, i, false); });
        }
        bindNet(g);
        screen = 'play';
        render();
        startLoop();
        preload(g.s);
        if (isHost) sendSnapshot(g, true);
        else session.sendToHost('tp:hi', {});
    }
    function again(g) {
        if (g.solo) { startSolo(g.s.map.id); return; }
        if (g.isHost) {
            const seed = (Math.random() * 1e9) >>> 0;
            send(g, 'tp:new', { seed });
            startOnline(g.session, Object.assign({}, g.start, { seed, slots: g.s.seats.filter(p => p.on).map(p => p.id) }));
        } else { send(g, 'tp:again', {}); say(g, 'asked the host for another go'); }
    }

    // ===============================================================
    // drawing
    // ===============================================================
    let cv = null, ctx = null, scale = 1, bgCache = null, bgKey = '';
    function fit() {
        if (!cv) return;
        const r = cv.getBoundingClientRect();
        const dpr = min(2, window.devicePixelRatio || 1);
        const w = max(200, round(r.width * dpr)), h = round(w * TP.H / TP.W);
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        scale = w / TP.W;
    }
    function background(s) {
        const key = s.map.id + ':' + cv.width;
        if (bgCache && bgKey === key) return bgCache;
        const c = document.createElement('canvas');
        c.width = cv.width; c.height = cv.height;
        const x = c.getContext('2d');
        x.scale(scale, scale);
        const m = s.map;
        x.fillStyle = m.ground;
        x.fillRect(0, 0, TP.W, TP.H);
        // a wallpaper: soft diagonal tiles
        x.fillStyle = m.ground2;
        for (let i = -TP.H; i < TP.W; i += 48) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 24, 0); x.lineTo(i + 24 + TP.H, TP.H); x.lineTo(i + TP.H, TP.H); x.fill(); }
        // a few desktop icons, for decoration where nothing can be built anyway
        const pts = s.road.pts;
        const line = (w, col, dash) => {
            x.strokeStyle = col; x.lineWidth = w; x.lineJoin = 'round'; x.lineCap = 'round';
            x.setLineDash(dash || []);
            x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)); x.stroke();
            x.setLineDash([]);
        };
        line(TP.PATH_R * 2 + 10, 'rgba(0,0,0,0.18)');
        line(TP.PATH_R * 2 + 6, m.edge);
        line(TP.PATH_R * 2, m.road);
        line(3, 'rgba(0,0,0,0.12)', [10, 14]);
        // where they come from and where they are going
        const a = pts[0], b = pts[pts.length - 1];
        const at = (p, q) => ({ x: min(TP.W - 18, max(18, p.x)), y: min(TP.H - 18, max(18, p.y)), ang: atan2(q.y - p.y, q.x - p.x) });
        const st = at(a, pts[1]), en = at(b, pts[pts.length - 2]);
        x.save(); x.translate(st.x, st.y); x.rotate(st.ang);
        x.fillStyle = 'rgba(80,40,120,0.85)'; x.beginPath(); x.moveTo(-10, -14); x.lineTo(12, 0); x.lineTo(-10, 14); x.closePath(); x.fill();
        x.restore();
        x.save(); x.translate(en.x, en.y);
        x.fillStyle = '#c0c0c0'; x.fillRect(-15, -15, 30, 30);
        x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.moveTo(-15, 15); x.lineTo(-15, -15); x.lineTo(15, -15); x.stroke();
        x.strokeStyle = '#404040'; x.beginPath(); x.moveTo(15, -15); x.lineTo(15, 15); x.lineTo(-15, 15); x.stroke();
        x.strokeStyle = '#000'; x.lineWidth = 3; x.beginPath(); x.moveTo(-6, -6); x.lineTo(6, 6); x.moveTo(6, -6); x.lineTo(-6, 6); x.stroke();
        x.restore();
        bgCache = c; bgKey = key;
        return c;
    }
    const TOWER_DRAW = TP.TOWER_R * 1.38;
    function drawTower(x, t, alpha, ghost) {
        const def = t.def, look = ghost ? 'base' : S.lookOf(t);
        const meta = TP.ART[def.art][look];
        const im = img(towerSrc(def, look)) || img(towerSrc(def, 'base'));
        const m = im === IMG[towerSrc(def, look)] ? meta : TP.ART[def.art].base;
        const k = TOWER_DRAW / m.r;
        const bump = t.fireT > 0 ? 1 - t.fireT * 0.4 : 1;
        x.save();
        x.globalAlpha = alpha === undefined ? 1 : alpha;
        if (!ghost) {
            x.fillStyle = 'rgba(0,0,0,0.25)';
            x.beginPath(); x.ellipse(t.x + 2, t.y + 4, TOWER_DRAW * 1.02, TOWER_DRAW * 0.5, 0, 0, 2 * PI); x.fill();
            if (G && G.s.n > 1) {
                x.strokeStyle = TP.SEAT_COLORS[t.owner] || '#fff'; x.lineWidth = 3;
                x.beginPath(); x.ellipse(t.x, t.y + 1, TOWER_DRAW * 1.05, TOWER_DRAW * 0.52, 0, 0, 2 * PI); x.stroke();
            }
        }
        if (im) {
            x.translate(t.x, t.y);
            x.scale(1, bump);
            x.drawImage(im, -m.ax * k, -m.ay * k, m.w * k, m.h * k);
        } else {
            x.fillStyle = '#d8ccb0'; x.beginPath(); x.ellipse(t.x, t.y, TOWER_DRAW, TOWER_DRAW * 0.5, 0, 0, 2 * PI); x.fill();
        }
        x.restore();
        if (!ghost && (t.a || t.b)) {
            // the tiers bought, as pips under the base: the first path gold, the second blue
            const n = t.a + t.b;
            let px = t.x - (n - 1) * 3.5;
            for (let i = 0; i < n; i++, px += 7) {
                x.fillStyle = i < t.a ? '#ffd84a' : '#5ab8ff';
                x.strokeStyle = '#000'; x.lineWidth = 1;
                x.beginPath(); x.arc(px, t.y + TOWER_DRAW * 0.55 + 4, 2.6, 0, 2 * PI); x.fill(); x.stroke();
            }
        }
    }
    function drawEnemy(x, e, now) {
        const def = e.def, size = def.size * 1.3;
        const lift = e.fly ? 16 + sin(now * 4 + e.id) * 3 : 0;
        x.fillStyle = 'rgba(0,0,0,0.22)';
        x.beginPath(); x.ellipse(e.x, e.y + size * 0.28, size * 0.3, size * 0.1, 0, 0, 2 * PI); x.fill();
        const cell = TP.ANIM_CELL[def.anim] || 96;
        const im = img(animSrc(def, 'walk'));
        const foot = e.y + size * 0.3 - lift;
        const slowNow = e.slowT > 0 ? e.slowM : 1;
        const f = e.stunT > 0 ? 0 : floor((now / 0.08) * slowNow + e.id * 3) % 16;
        x.save();
        if (e.hit > 0) x.filter = 'brightness(1.8)';
        else if (e.stunT > 0) x.filter = 'saturate(0.3) brightness(1.3) hue-rotate(160deg)';
        else if (e.slowT > 0) x.filter = 'saturate(0.6) hue-rotate(150deg)';
        x.translate(e.x, foot);
        const flipped = TP.ANIM_LOOKS_LEFT[def.anim] ? e.dir > 0 : e.dir < 0;
        if (flipped) x.scale(-1, 1);
        if (im) x.drawImage(im, (f % 4) * cell, (f >> 2) * cell, cell, cell, -size / 2, -size, size, size);
        else { x.fillStyle = '#8fbf6a'; x.beginPath(); x.arc(0, -size / 2, size / 3, 0, 2 * PI); x.fill(); }
        x.restore();
        const top = foot - size * 0.92;
        if (e.burnT > 0) {
            x.fillStyle = 'rgba(255,140,40,' + (0.5 + 0.3 * sin(now * 20 + e.id)) + ')';
            for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(e.x - 7 + i * 7, foot - size * (0.35 + 0.1 * sin(now * 9 + i + e.id)), 3, 0, 2 * PI); x.fill(); }
        }
        if (e.curseT > 0) { x.strokeStyle = 'rgba(160,255,90,0.8)'; x.lineWidth = 2; x.beginPath(); x.arc(e.x, foot - size * 0.45, size * 0.38, 0, 2 * PI); x.stroke(); }
        if (e.hp < e.max || def.boss) {
            const bw = max(22, size * 0.62);
            x.fillStyle = 'rgba(0,0,0,0.75)'; x.fillRect(e.x - bw / 2 - 1, top - 1, bw + 2, def.boss ? 6 : 5);
            x.fillStyle = def.boss ? '#ff5a5a' : e.hp / e.max > 0.5 ? '#7ee06a' : e.hp / e.max > 0.25 ? '#ffd84a' : '#ff7a4a';
            x.fillRect(e.x - bw / 2, top, bw * max(0, e.hp / e.max), def.boss ? 4 : 3);
        }
        if (def.armor >= 4) { x.fillStyle = '#c8d4dc'; x.font = 'bold 10px Tahoma, sans-serif'; x.textAlign = 'center'; x.fillText('⛨', e.x + max(22, size * 0.62) / 2 + 6, top + 5); }
    }
    function drawShot(x, sh, now) {
        const def = TP.TOWERS[sh.ti];
        if (!def) return;
        const meta = TP.ART[def.art].shot;
        const im = meta ? img(shotSrc(def)) : null;
        let ang, px = sh.x, py = sh.y, sc = 1;
        if (sh.k === 'lob' || sh.k === 'cloud') {
            const u = min(1, sh.t / sh.T);
            const d = hypot(sh.x1 - sh.x0, sh.y1 - sh.y0);
            const h = sin(PI * u) * (30 + d * 0.25);
            x.fillStyle = 'rgba(0,0,0,0.2)'; x.beginPath(); x.ellipse(px, py, 7, 3, 0, 0, 2 * PI); x.fill();
            py -= h;
            sc = 1 + sin(PI * u) * 0.35;
            ang = sh.k === 'lob' ? now * 6 : atan2(sh.y1 - sh.y0, sh.x1 - sh.x0);
        } else if (sh.k === 'line') ang = atan2(sh.vy, sh.vx);
        else ang = atan2(sh.ty - sh.y, sh.tx - sh.x);
        const len = (def.id === 'hammer' ? 30 : def.id === 'catapult' ? 26 : 24) * sc;
        if (im) {
            const k = len / max(meta.w, meta.h);
            x.save(); x.translate(px, py); x.rotate(def.id === 'hammer' ? 0 : ang);
            x.drawImage(im, -meta.w * k / 2, -meta.h * k / 2, meta.w * k, meta.h * k);
            x.restore();
        } else { x.fillStyle = '#ffe9a0'; x.beginPath(); x.arc(px, py, 4, 0, 2 * PI); x.fill(); }
    }
    function draw() {
        const g = G;
        if (!g || !cv || screen !== 'play') return;
        fit();
        const s = g.s, x = ctx, now = performance.now() / 1000;
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.drawImage(background(s), 0, 0);
        const sh = g.shake > 0 ? g.shake * 10 : 0;
        x.setTransform(scale, 0, 0, scale, sh ? (Math.random() - 0.5) * sh * scale : 0, sh ? (Math.random() - 0.5) * sh * scale : 0);

        // spam clouds, under everything
        for (const c of s.clouds) {
            const a = min(1, c.t / 0.6) * 0.55;
            const grd = x.createRadialGradient(c.x, c.y, 2, c.x, c.y, c.r);
            grd.addColorStop(0, 'rgba(150,230,60,' + a + ')');
            grd.addColorStop(1, 'rgba(90,170,30,0)');
            x.fillStyle = grd;
            x.beginPath();
            for (let i = 0; i <= 10; i++) { const an = i / 10 * 2 * PI, rr = c.r * (0.85 + 0.15 * sin(now * 3 + i * 1.7 + c.x)); i ? x.lineTo(c.x + cos(an) * rr, c.y + sin(an) * rr * 0.75) : x.moveTo(c.x + cos(an) * rr, c.y + sin(an) * rr * 0.75); }
            x.fill();
        }

        // building: where you cannot, in red, and the range where you would
        if (g.build && g.ghost) {
            x.save();
            x.strokeStyle = 'rgba(255,40,40,0.22)'; x.lineWidth = (TP.PATH_R + TP.TOWER_R - 2) * 2; x.lineJoin = 'round'; x.lineCap = 'round';
            x.beginPath(); s.road.pts.forEach((p, i) => i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)); x.stroke();
            x.fillStyle = 'rgba(255,40,40,0.22)';
            for (const t of s.towers) { x.beginPath(); x.arc(t.x, t.y, TP.TOWER_R * 2, 0, 2 * PI); x.fill(); }
            x.restore();
            const def = TP.TOWERS_BY_ID[g.build];
            const st = S.statsOf(def, 0, 0);
            ring(x, g.ghost.x, g.ghost.y, st.range * (1 + s.mods.range), g.ghost.ok ? 'rgba(255,255,255,0.16)' : 'rgba(255,60,60,0.2)', g.ghost.ok ? 'rgba(255,255,255,0.7)' : 'rgba(255,80,80,0.9)');
            if (st.minRange) ring(x, g.ghost.x, g.ghost.y, st.minRange, 'rgba(255,60,60,0.12)', 'rgba(255,90,90,0.6)');
        }
        const sel = g.sel ? towerById(g, g.sel) : null;
        if (sel) {
            ring(x, sel.x, sel.y, sel.e.range, 'rgba(255,255,255,0.13)', 'rgba(255,255,255,0.75)');
            if (sel.st.minRange) ring(x, sel.x, sel.y, sel.st.minRange, 'rgba(255,60,60,0.1)', 'rgba(255,90,90,0.6)');
        }
        for (const t of s.towers) if (t.st && t.st.aura) ring(x, t.x, t.y, t.e.range, 'rgba(170,230,255,' + (0.06 + 0.03 * sin(now * 4)) + ')', null);

        // towers and trolls, back to front
        const things = [];
        for (const t of s.towers) things.push([t.y, 0, t]);
        for (const e of s.enemies) things.push([e.y + (e.fly ? 40 : 0), 1, e]);
        things.sort((a, b) => a[0] - b[0]);
        for (const [, k, o] of things) {
            if (k) drawEnemy(x, o, now);
            else {
                if (o === sel) { x.strokeStyle = '#ffe14d'; x.lineWidth = 2.5; x.beginPath(); x.ellipse(o.x, o.y + 1, TOWER_DRAW * 1.15, TOWER_DRAW * 0.6, 0, 0, 2 * PI); x.stroke(); }
                drawTower(x, o);
            }
        }
        // the dying
        for (const d of g.deaths) {
            const cell = TP.ANIM_CELL[d.def.anim] || 96, size = d.def.size * 1.3;
            const im = img(animSrc(d.def, 'death'));
            const f = min(15, floor(d.t / 0.07));
            x.save();
            x.globalAlpha = max(0, 1 - max(0, d.t - 1.1) / 0.4);
            x.translate(d.x, d.y + size * 0.3);
            if (TP.ANIM_LOOKS_LEFT[d.def.anim] ? d.dir > 0 : d.dir < 0) x.scale(-1, 1);
            if (im) x.drawImage(im, (f % 4) * cell, (f >> 2) * cell, cell, cell, -size / 2, -size, size, size);
            x.restore();
        }
        for (const p of s.shots) drawShot(x, p, now);
        // effects
        for (const f of g.fx) {
            const a = f.t / f.T;
            if (f.k === 'ring') {
                x.globalAlpha = a; x.strokeStyle = f.c; x.lineWidth = 3;
                x.beginPath(); x.arc(f.x, f.y, f.r * (1.1 - a * 0.5), 0, 2 * PI); x.stroke(); x.globalAlpha = 1;
            } else if (f.k === 'zap') {
                x.globalAlpha = a; x.strokeStyle = '#bfe6ff'; x.lineWidth = 2.5; x.shadowColor = '#4ab0ff'; x.shadowBlur = 8;
                x.beginPath();
                for (let i = 0; i + 1 < f.pts.length; i += 2) {
                    const px = f.pts[i], py = f.pts[i + 1];
                    if (!i) { x.moveTo(px, py - 14); continue; }
                    const qx = f.pts[i - 2], qy = f.pts[i - 1] - (i === 2 ? 14 : 0);
                    for (let k = 1; k <= 3; k++) { const u = k / 4; x.lineTo(qx + (px - qx) * u + (Math.random() - 0.5) * 10, qy + (py - 10 - qy) * u + (Math.random() - 0.5) * 10); }
                    x.lineTo(px, py - 10);
                }
                x.stroke(); x.shadowBlur = 0; x.globalAlpha = 1;
            } else if (f.k === 'leak') {
                x.globalAlpha = a; x.strokeStyle = '#ff4a4a'; x.lineWidth = 4;
                x.beginPath(); x.arc(f.x, f.y, 34 * (1.4 - a), 0, 2 * PI); x.stroke(); x.globalAlpha = 1;
            }
        }
        for (const f of g.floats) {
            x.globalAlpha = min(1, f.t / f.T * 2);
            x.font = 'bold 13px Tahoma, Verdana, sans-serif'; x.textAlign = 'center';
            x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,0.7)'; x.strokeText(f.text, f.x, f.y);
            x.fillStyle = f.c; x.fillText(f.text, f.x, f.y);
            x.globalAlpha = 1;
        }
        // the tower you are about to put down
        if (g.build && g.ghost) drawTower(x, { def: TP.TOWERS_BY_ID[g.build], x: g.ghost.x, y: g.ghost.y, a: 0, b: 0 }, g.ghost.ok ? 0.85 : 0.45, true);
        if (g.banner) {
            const b = g.banner, a = min(1, b.t / 0.4, (b.T - b.t) / 0.25 + 0.2);
            x.globalAlpha = max(0, a);
            x.font = 'bold 26px Tahoma, Verdana, sans-serif'; x.textAlign = 'center';
            x.lineWidth = 5; x.strokeStyle = 'rgba(0,0,0,0.75)'; x.strokeText(b.text, TP.W / 2, 64);
            x.fillStyle = b.color; x.fillText(b.text, TP.W / 2, 64);
            x.globalAlpha = 1;
        }
        if (g.msg) {
            x.font = 'bold 15px Tahoma, Verdana, sans-serif'; x.textAlign = 'center';
            const w = x.measureText(g.msg).width + 24;
            x.fillStyle = 'rgba(0,0,0,0.7)'; x.fillRect(TP.W / 2 - w / 2, TP.H - 46, w, 28);
            x.fillStyle = '#fff'; x.fillText(g.msg, TP.W / 2, TP.H - 27);
        }
        if (g.paused && !g.over) {
            x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 0, TP.W, TP.H);
            x.font = 'bold 30px Tahoma, Verdana, sans-serif'; x.textAlign = 'center'; x.fillStyle = '#fff';
            x.fillText('paused', TP.W / 2, TP.H / 2);
        }
    }
    function ring(x, cx, cy, r, fill, stroke) {
        x.beginPath(); x.arc(cx, cy, r, 0, 2 * PI);
        if (fill) { x.fillStyle = fill; x.fill(); }
        if (stroke) { x.strokeStyle = stroke; x.lineWidth = 1.5; x.stroke(); }
    }
    function tickFx(g, dt) {
        const sdt = dt * (g.paused ? 0 : max(1, g.speed * 0.7));
        for (const t of g.s.towers) if (t.fireT > 0) t.fireT -= dt;
        g.fx = g.fx.filter(f => (f.t -= sdt) > 0);
        g.floats = g.floats.filter(f => { f.t -= dt; f.y -= 22 * dt; return f.t > 0; });
        g.deaths = g.deaths.filter(d => (d.t += sdt) < 1.5);
        if (g.banner && (g.banner.t -= dt) <= 0) g.banner = null;
        if (g.msg && (g.msgT -= dt) <= 0) g.msg = null;
        if (g.shake > 0) g.shake -= dt;
    }

    // ===============================================================
    // the screens
    // ===============================================================
    function render() {
        if (!root) return;
        const fn = { menu: menuHtml, maps: mapsHtml, meta: metaHtml, play: playHtml, end: endHtml }[screen] || menuHtml;
        root.innerHTML = fn();
        bind();
        if (screen === 'play' && G) {
            cv = root.querySelector('#tg-canvas');
            ctx = cv.getContext('2d');
            bgCache = null;
            fit();
            paintShop(G); paintPanel(G); paintPlayers(G); paintOverlay(G); hud(G, true);
        } else { cv = null; ctx = null; }
    }
    const towerImgHtml = (def, look) => `<img src="${towerSrc(def, look || 'base')}" alt="" draggable="false">`;
    function menuHtml() {
        M = loadMeta();
        const best = max(0, ...Object.values(M.bestWave).map(Number));
        const have = S.unlockedTowers(M);
        return `<div class="tg-menu">
            <h2 class="tg-title">sir, we have a<br>troll problem</h2>
            <p class="tg-sub">they come down the road in their thousands. the desktop defends itself.</p>
            ${M.refunded ? `<p class="tg-note">the towers are new, so your old upgrades were refunded: <b>💎 ${M.refunded}</b> back to spend.</p>` : ''}
            <div class="tg-menu-btns">
                ${hasRun() ? '<button class="tg-btn tg-go tg-wide" data-act="resume">continue run</button>' : ''}
                <button class="tg-btn tg-wide ${hasRun() ? '' : 'tg-go'}" data-act="maps">play</button>
                <button class="tg-btn tg-wide" data-act="online">play with friends (up to 4)</button>
                <button class="tg-btn tg-wide" data-act="meta">💎 upgrades <b>${M.crystals}</b></button>
            </div>
            <div class="tg-statsgrid">
                <div><b>${best}</b><span>best wave</span></div>
                <div><b>${M.totalKills}</b><span>trolls stopped</span></div>
                <div><b>${M.runs}</b><span>runs</span></div>
                <div><b>${Object.keys(M.wins).length}/${TP.MAPS.length}</b><span>maps held</span></div>
            </div>
            <div class="tg-armory">${TP.TOWERS.map(t => `<span class="tg-armory-item${have.includes(t.id) ? '' : ' locked'}" title="${esc(t.name + (have.includes(t.id) ? ': ' + t.text : ': reach wave ' + TP.TOWER_UNLOCKS[t.id]))}">${towerImgHtml(t)}${have.includes(t.id) ? '' : '<i>' + TP.TOWER_UNLOCKS[t.id] + '</i>'}</span>`).join('')}</div>
            <p class="tg-hint">pick a tower, put it anywhere off the road. click it to upgrade: two paths, and only one of them goes past tier ${TP.CROSS_CAP}. keys: 1-0 towers, , and . upgrade, tab target, space send the wave, backspace sell.</p>
        </div>`;
    }
    function mapsHtml() {
        return `<div class="tg-menu">
            <div class="tg-head"><h3>choose your ground</h3><button class="tg-btn" data-act="menu">back</button></div>
            <div class="tg-maplist">${TP.MAPS.map(m => {
            const locked = M.unlockedMaps.indexOf(m.id) < 0;
            return `<button class="tg-mapcard${locked ? ' locked' : ''}" ${locked ? 'disabled' : `data-map="${m.id}"`}>
                    <canvas class="tg-mapthumb" width="192" height="120" data-thumb="${m.id}"></canvas>
                    <span class="tg-mapname">${locked ? '🔒 ' : ''}${esc(m.name)}${M.wins[m.id] ? ' 👑' : ''}</span>
                    <span class="tg-mapblurb">${locked ? 'reach wave ' + TP.MAP_UNLOCK_WAVE + ' on the map before it' : esc(m.blurb)}</span>
                    <span class="tg-mapmeta">trolls x${m.hp} · best wave ${M.bestWave[m.id] || 0}</span>
                </button>`;
        }).join('')}</div></div>`;
    }
    function metaHtml() {
        return `<div class="tg-menu">
            <div class="tg-head"><h3>💎 upgrades</h3><span class="tg-crystals">${M.crystals} crystals</span><button class="tg-btn" data-act="menu">back</button></div>
            <p class="tg-hint">crystals come from every run, win or lose, and these never reset. they count when you play alone; online everybody plays the stock towers.</p>
            <div class="tg-offers">${TP.META.map(node => {
            const lvl = M.spent[node.id] || 0, maxed = lvl >= node.max, cost = TP.metaCost(node.id, lvl);
            return `<div class="tg-offer"><span class="tg-offer-icon">${node.icon}</span>
                    <div class="tg-offer-info"><b>${esc(node.name)} <span class="tg-lvl">${lvl}/${node.max}</span></b><span>${esc(node.text)}</span></div>
                    ${maxed ? '<span class="tg-maxed">max</span>' : `<button class="tg-btn tg-buy${M.crystals < cost ? ' tg-poor' : ''}" data-meta="${node.id}">💎 ${cost}</button>`}</div>`;
        }).join('')}</div></div>`;
    }
    function endHtml() {
        const g = G;
        if (!g) return menuHtml();
        const s = g.s, won = s.phase === 'won';
        return `<div class="tg-end">
            <h2 class="tg-title ${won ? 'tg-win' : 'tg-lose'}">${won ? 'the desktop held' : 'the trolls got in'}</h2>
            <p>${won ? 'all ' + TP.TOTAL_WAVES + ' waves turned back on ' + esc(s.map.name) + '.' : 'they got through on wave ' + s.wave + ' of ' + esc(s.map.name) + '.'}</p>
            <p class="tg-sub">${s.kills} trolls stopped · ${s.leaked} got past · ${max(0, round(s.lives))} lives left</p>
            <p class="tg-crystals">💎 +${g.crystals} crystals</p>
            <div class="tg-menu-btns">
                ${g.solo || g.isHost ? '<button class="tg-btn tg-go tg-wide" data-act="again">again</button>' : '<button class="tg-btn tg-wide" data-act="again">ask for another go</button>'}
                ${g.solo ? '<button class="tg-btn tg-wide" data-act="meta">spend crystals</button><button class="tg-btn tg-wide" data-act="maps">another map</button>' : ''}
                <button class="tg-btn tg-wide" data-act="leave">main menu</button>
            </div></div>`;
    }
    function playHtml() {
        const g = G;
        return `<div class="tg-top">
                <span class="tg-stat" title="lives">❤️ <b id="tg-lives"></b></span>
                <span class="tg-stat tg-money" title="your money">💰 <b id="tg-gold"></b></span>
                <span class="tg-stat" title="wave">🌊 <b id="tg-wave"></b></span>
                <span class="tg-players" id="tg-players"></span>
                <span class="tg-grow"></span>
                <span class="tg-speeds">
                    <button class="tg-sbtn" data-speed="pause" title="pause">⏸</button>
                    ${TP.SPEEDS.map(v => `<button class="tg-sbtn" data-speed="${v}">${v}×</button>`).join('')}
                </span>
                <button class="tg-btn tg-go" id="tg-go" data-act="go"></button>
                <button class="tg-btn" data-act="quit">${g.solo ? 'menu' : 'leave'}</button>
            </div>
            <div class="tg-stage">
                <div class="tg-field"><canvas id="tg-canvas" class="tg-canvas"></canvas><div class="tg-overlay" id="tg-overlay"></div></div>
                <div class="tg-shop" id="tg-shop"></div>
            </div>
            <div class="tg-panel" id="tg-panel"></div>`;
    }

    // the shop: every tower, its price, and whether you can have it
    function paintShop(g) {
        const el = root && root.querySelector('#tg-shop');
        if (!el || !g) return;
        const gold = myGold(g);
        // built once, then only its classes and prices change, so the pictures never reload
        if (el.children.length !== TP.TOWERS.length) {
            el.innerHTML = TP.TOWERS.map(t => `<button class="tg-card" data-tower="${t.id}" title="${esc(t.name + ': ' + t.text)}">${towerImgHtml(t)}<span class="tg-cost"></span><span class="tg-key">${t.key}</span></button>`).join('');
            el.querySelectorAll('[data-tower]').forEach(b => b.onclick = e => { e.stopPropagation(); pickTower(G, b.dataset.tower); });
        }
        el.querySelectorAll('[data-tower]').forEach(b => {
            const t = TP.TOWERS_BY_ID[b.dataset.tower];
            const locked = !!(g.s.unlocked && !g.s.unlocked.has(t.id));
            const cost = S.towerCost(g.s, t);
            b.classList.toggle('sel', g.build === t.id);
            b.classList.toggle('locked', locked);
            b.classList.toggle('poor', !locked && gold < cost);
            b.disabled = locked;
            const txt = locked ? '🔒 w' + TP.TOWER_UNLOCKS[t.id] : money(cost);
            const c = b.querySelector('.tg-cost');
            if (c.textContent !== txt) c.textContent = txt;
        });
    }
    function pickTower(g, id) {
        if (!g || g.over) return;
        if (g.seat < 0) { say(g, 'you are watching this one'); return; }
        const def = TP.TOWERS_BY_ID[id];
        if (!def || (g.s.unlocked && !g.s.unlocked.has(id))) return;
        g.build = g.build === id ? null : id;
        g.sel = null;
        g.touchAim = false;
        g.ghost = null;
        sfx('tick');
        paintShop(g); paintPanel(g);
    }
    // the panel under the map: the tower in hand, or the one you clicked
    function paintPanel(g) {
        const el = root && root.querySelector('#tg-panel');
        if (!el || !g) return;
        let html;
        if (g.build) {
            const def = TP.TOWERS_BY_ID[g.build];
            const cost = S.towerCost(g.s, def);
            const ok = g.ghost && g.ghost.ok;
            html = `<div class="tg-p-tower">${towerImgHtml(def)}<div><b>${esc(def.name)}</b> <span class="tg-dim">${money(cost)}</span><br><span>${esc(def.text)}</span></div></div>
                ${g.touchAim && g.ghost ? `<div class="tg-aim"><span>${ok ? 'drag to move it' : esc(WHY[g.ghost.why] || 'not there')}</span>
                    <button class="tg-btn tg-go${ok && myGold(g) >= cost ? '' : ' tg-poor'}" data-act="place">build ${money(cost)}</button>
                    <button class="tg-btn" data-act="cancel">cancel</button></div>`
                    : `<div class="tg-aim"><span class="tg-dim">${isTouch() ? 'tap the map where it goes' : 'click anywhere off the road. shift keeps placing. esc puts it back'}</span><button class="tg-btn" data-act="cancel">cancel</button></div>`}`;
        } else if (g.sel && towerById(g, g.sel)) {
            const t = towerById(g, g.sel), mine = t.owner === g.seat;
            const owner = g.s.seats[t.owner];
            const mode = TP.TARGET_MODES.find(m => m.id === t.mode) || TP.TARGET_MODES[0];
            const st = t.st, e = t.e;
            const line = t.def.kind === 'support'
                ? 'towers in range: +' + round((st.buffDmg || 0) * 100) + '% damage, +' + round((st.buffRate || 0) * 100) + '% speed' + (st.buffAp ? ', ' + st.buffAp + ' armour cut' : '') + (st.income ? ', ' + money(st.income) + ' a wave' : '')
                : (t.def.kind === 'cloud' ? round(e.cloudDps) + ' a second in the cloud' : round(e.dmg * 10) / 10 + ' damage') + ' · ' + (round(10 / e.cd) / 10) + ' a second · range ' + round(e.range) + ' · ' + t.kills + ' kills';
            html = `<div class="tg-p-tower">${towerImgHtml(t.def, S.lookOf(t))}<div><b>${esc(t.def.name)}</b>${g.s.n > 1 ? ` <span class="tg-owner" style="--c:${TP.SEAT_COLORS[t.owner]}">${esc(owner ? owner.name : '?')}</span>` : ''}<br><span class="tg-dim">${esc(line)}</span></div></div>
                ${t.def.kind === 'support' || t.def.kind === 'cloud' && false ? '' : `<div class="tg-mode"><button class="tg-btn" data-mode="-1"${mine ? '' : ' disabled'}>‹</button><span>target <b>${mode.name}</b></span><button class="tg-btn" data-mode="1"${mine ? '' : ' disabled'}>›</button></div>`}
                <div class="tg-paths">${[0, 1].map(p => pathHtml(g, t, p, mine)).join('')}</div>
                ${mine ? `<button class="tg-btn tg-sell" data-act="sell">sell ${money(S.refundOf(g.s, t))}</button>` : `<span class="tg-dim">not yours</span>`}`;
        } else {
            html = `<div class="tg-p-idle">${g.seat < 0 ? 'you are watching. a seat comes free when somebody leaves.' : isTouch() ? 'tap a tower in the shop, then the map. tap a tower on the map to upgrade it.' : 'pick a tower from the shop and put it anywhere off the road. click a tower to upgrade it.'}</div>`;
        }
        // the same panel again is left alone, so its picture does not reload under the mouse
        if (el._html === html) return;
        el._html = html;
        el.innerHTML = html;
        el.querySelectorAll('[data-act]').forEach(b => b.onclick = ev => { ev.stopPropagation(); act(b.dataset.act); });
        el.querySelectorAll('[data-up]').forEach(b => b.onclick = ev => { ev.stopPropagation(); upgrade(g, +b.dataset.up); });
        el.querySelectorAll('[data-mode]').forEach(b => b.onclick = ev => { ev.stopPropagation(); cycleMode(g, +b.dataset.mode); });
    }
    function pathHtml(g, t, p, mine) {
        const path = t.def.paths[p], have = p ? t.b : t.a;
        const why = S.tierProblem(t, p);
        const next = have < TP.TIERS ? path.tiers[have] : null;
        const cost = next ? S.tierCost(g.s, t.def, p, have) : 0;
        const pips = path.tiers.map((tier, i) => `<i class="${i < have ? 'on' : ''}${i === TP.TIERS - 1 ? ' top' : ''}" title="${esc(tier.name + ': ' + tier.text)}"></i>`).join('');
        let btn;
        if (why === 'max') btn = `<span class="tg-maxed">${esc(path.name)}: maxed</span>`;
        else if (why === 'locked') btn = `<span class="tg-locked">🔒 locked: the other path went past ${TP.CROSS_CAP}</span>`;
        else btn = `<button class="tg-up${myGold(g) < cost ? ' poor' : ''}" data-up="${p}"${mine ? '' : ' disabled'}><b>${esc(next.name)}</b><span>${esc(next.text)}</span><em>${money(cost)}</em></button>`;
        return `<div class="tg-path tg-path-${p ? 'b' : 'a'}${why === 'locked' ? ' locked' : ''}"><div class="tg-path-head"><span>${esc(path.name)}</span><span class="tg-pips">${pips}</span></div>${btn}</div>`;
    }
    function upgrade(g, p) {
        const t = g.sel && towerById(g, g.sel);
        if (!t) return;
        issue(g, { c: 'up', i: t.id, p });
    }
    function cycleMode(g, d) {
        const t = g.sel && towerById(g, g.sel);
        if (!t || t.owner !== g.seat) return;
        const i = TP.TARGET_MODES.findIndex(m => m.id === t.mode);
        const m = TP.TARGET_MODES[(i + d + TP.TARGET_MODES.length) % TP.TARGET_MODES.length].id;
        if (!g.isHost) t.mode = m;
        issue(g, { c: 'mode', i: t.id, m });
    }
    function paintPlayers(g) {
        const el = root && root.querySelector('#tg-players');
        if (!el || !g) return;
        if (g.s.n <= 1) { el.innerHTML = ''; return; }
        el.innerHTML = g.s.seats.map((p, i) => `<span class="tg-chip${p.on ? '' : ' off'}${i === g.seat ? ' me' : ''}" style="--c:${TP.SEAT_COLORS[i]}" title="${esc(p.name + (p.on ? '' : ' (left: anybody joining takes this seat)'))}">${esc(p.name)} <b data-gold="${i}">${money(p.gold)}</b>${p.ready ? ' ✓' : ''}</span>`).join('');
    }
    function paintOverlay(g) {
        const el = root && root.querySelector('#tg-overlay');
        if (!el || !g) return;
        el.innerHTML = g.netDown ? `<div class="tg-dialog"><b>lost the host</b><p>nothing has come from them for a while. waiting for the line to come back…</p><button class="tg-btn" data-act="leave">leave</button></div>` : '';
        el.querySelectorAll('[data-act]').forEach(b => b.onclick = ev => { ev.stopPropagation(); act(b.dataset.act); });
    }
    let hudCache = {};
    function hud(g, force) {
        if (!root || screen !== 'play' || !g) return;
        if (force) hudCache = {};
        const s = g.s;
        const set = (sel, v) => { if (hudCache[sel] === v) return; hudCache[sel] = v; const el = root.querySelector(sel); if (el) el.textContent = v; };
        set('#tg-lives', String(max(0, round(s.lives))));
        set('#tg-gold', g.seat < 0 ? 'watching' : money(myGold(g)));
        set('#tg-wave', s.wave + '/' + TP.TOTAL_WAVES);
        const go = root.querySelector('#tg-go');
        if (go) {
            const me = s.seats[g.seat];
            const txt = s.phase === 'prep'
                ? (me && me.ready ? 'waiting for the others' : (s.wave === 1 && !g.started ? '▶ start' : '▶ send them in') + ' +' + money(floor(s.prep * TP.EARLY_BONUS)) + ' · ' + Math.ceil(s.prep) + 's')
                : s.phase === 'wave' ? (s.enemies.length + (s.queue.length - s.qi > 0 ? s.queue.length - s.qi : 0)) + ' trolls on the road' : '';
            if (hudCache.go !== txt) { hudCache.go = txt; go.textContent = txt; go.disabled = s.phase !== 'prep' || g.seat < 0 || (me && me.ready); }
        }
        const speedKey = g.paused + ':' + g.speed + ':' + g.isHost;
        if (hudCache.speed !== speedKey) {
            hudCache.speed = speedKey;
            root.querySelectorAll('[data-speed]').forEach(b => {
                const v = b.dataset.speed;
                b.classList.toggle('on', v === 'pause' ? g.paused : !g.paused && +v === g.speed);
                b.disabled = !g.isHost;
            });
        }
        // the shop greys what you cannot afford, and the panel's prices
        const gold = floor(myGold(g));
        if (hudCache.goldShop !== gold) {
            hudCache.goldShop = gold;
            root.querySelectorAll('.tg-card[data-tower]').forEach(b => { const def = TP.TOWERS_BY_ID[b.dataset.tower]; if (!b.classList.contains('locked')) b.classList.toggle('poor', gold < S.towerCost(s, def)); });
            root.querySelectorAll('.tg-up[data-up]').forEach(b => { const t = g.sel && towerById(g, g.sel); if (t) { const p = +b.dataset.up; const have = p ? t.b : t.a; if (have < TP.TIERS) b.classList.toggle('poor', gold < S.tierCost(s, t.def, p, have)); } });
        }
        if (s.n > 1) s.seats.forEach((p, i) => { const el = root.querySelector('[data-gold="' + i + '"]'); if (el) { const v = money(p.gold); if (el.textContent !== v) el.textContent = v; } });
        const ready = s.seats.map(p => (p.on ? 1 : 0) + (p.ready ? 2 : 0)).join();
        if (hudCache.ready !== ready) { hudCache.ready = ready; paintPlayers(g); }
    }

    // ===============================================================
    // input
    // ===============================================================
    const isTouch = () => !!(window.TOUCH && TOUCH.coarse());
    function worldAt(ev) {
        const r = cv.getBoundingClientRect();
        const t = ev.touches && ev.touches[0] || ev.changedTouches && ev.changedTouches[0] || ev;
        return { x: (t.clientX - r.left) / r.width * TP.W, y: (t.clientY - r.top) / r.height * TP.H };
    }
    function towerAt(g, p) {
        let best = null, bd = 1e9;
        for (const t of g.s.towers) {
            const d = hypot(t.x - p.x, (t.y - 12) - p.y);
            if (d < 30 && d < bd) { bd = d; best = t; }
        }
        return best;
    }
    function setGhost(g, p) {
        const why = S.placeProblem(g.s, p.x, p.y);
        g.ghost = { x: p.x, y: p.y, ok: !why, why };
    }
    function place(g) {
        if (!g.build || !g.ghost) return;
        if (!g.ghost.ok) { say(g, WHY[g.ghost.why] || 'not there'); sfx('no'); return; }
        issue(g, { c: 'place', t: g.build, x: round(g.ghost.x), y: round(g.ghost.y) });
    }
    function bind() {
        root.querySelectorAll('[data-act]').forEach(b => b.onclick = ev => { ev.stopPropagation(); act(b.dataset.act); });
        root.querySelectorAll('[data-map]').forEach(b => b.onclick = ev => { ev.stopPropagation(); drop(RUN_KEY); sfx('build'); startSolo(b.dataset.map); });
        root.querySelectorAll('[data-meta]').forEach(b => b.onclick = ev => {
            ev.stopPropagation();
            const id = b.dataset.meta, lvl = M.spent[id] || 0, cost = TP.metaCost(id, lvl);
            if (M.crystals < cost || lvl >= TP.META_BY_ID[id].max) { sfx('no'); return; }
            M.crystals -= cost; M.spent[id] = lvl + 1; delete M.refunded;
            saveMeta(M); sfx('crystal'); render();
        });
        root.querySelectorAll('[data-thumb]').forEach(c => thumb(c, TP.MAP_BY_ID[c.dataset.thumb]));
        root.querySelectorAll('[data-speed]').forEach(b => b.onclick = ev => {
            ev.stopPropagation();
            const g = G;
            if (!g || !g.isHost) return;
            const v = b.dataset.speed;
            if (v === 'pause') g.paused = !g.paused; else { g.paused = false; g.speed = +v; if (g.solo) writeJson(PREF_KEY, Object.assign(prefs(), { speed: g.speed })); }
            hud(g, true);
        });
        const c = root.querySelector('#tg-canvas');
        if (!c) return;
        let dragging = false;
        c.addEventListener('mousemove', ev => {
            const g = G;
            if (!g || isTouch()) return;
            const p = worldAt(ev);
            if (g.build) { const was = g.ghost && g.ghost.ok; setGhost(g, p); if (was !== g.ghost.ok) paintPanel(g); }
            c.style.cursor = g.build ? 'none' : towerAt(g, p) ? 'pointer' : 'default';
        });
        c.addEventListener('mouseleave', () => { const g = G; if (g && g.build && !isTouch()) g.ghost = null; });
        c.addEventListener('click', ev => {
            const g = G;
            if (!g) return;
            root.focus({ preventScroll: true });
            const p = worldAt(ev);
            if (g.build) {
                if (isTouch()) { setGhost(g, p); g.touchAim = true; paintPanel(g); return; }
                setGhost(g, p);
                g.keepBuilding = ev.shiftKey;
                place(g);
                return;
            }
            const t = towerAt(g, p);
            g.sel = t ? t.id : null;
            if (t) sfx('tick');
            paintPanel(g);
        });
        // a finger can move the tower it is aiming before it pays
        c.addEventListener('touchmove', ev => {
            const g = G;
            if (!g || !g.build || !g.touchAim) return;
            ev.preventDefault();
            dragging = true;
            setGhost(g, worldAt(ev));
            paintPanel(g);
        }, { passive: false });
        c.addEventListener('touchend', () => { dragging = false; });
        const ro = window.ResizeObserver ? new ResizeObserver(() => fit()) : null;
        if (ro) { ro.observe(c); if (G) G.unbind = () => ro.disconnect(); }
    }
    function thumb(c, m) {
        const x = c.getContext('2d'), k = c.width / TP.W;
        x.fillStyle = m.ground; x.fillRect(0, 0, c.width, c.height);
        const road = S.roadOf(m).road;
        x.strokeStyle = m.edge; x.lineWidth = (TP.PATH_R * 2 + 6) * k; x.lineJoin = 'round';
        x.beginPath(); road.pts.forEach((p, i) => i ? x.lineTo(p.x * k, p.y * k) : x.moveTo(p.x * k, p.y * k)); x.stroke();
        x.strokeStyle = m.road; x.lineWidth = TP.PATH_R * 2 * k; x.stroke();
    }
    function onTop() {
        if (!winRef || !winRef.win || winRef.win.style.display === 'none') return false;
        const z = +winRef.win.style.zIndex || 0;
        return ![...document.querySelectorAll('.app-window, .ie-window')].some(w => w !== winRef.win && w.style.display !== 'none' && (+w.style.zIndex || 0) > z);
    }
    function onKey(ev) {
        const g = G;
        const tag = (ev.target && ev.target.tagName) || '';
        if (!g || screen !== 'play' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !onTop()) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const k = ev.key;
        // what this game answers stops here, so the desktop's own keys (escape closes
        // the top window) only see what the game left alone
        const mine = () => { ev.preventDefault(); ev.stopPropagation(); };
        const tower = TP.TOWERS.find(t => t.key === k);
        if (tower) { pickTower(g, tower.id); mine(); return; }
        if (k === 'Escape') {
            // with nothing in hand and nothing picked, escape still closes the window
            if (!g.build && !g.sel) return;
            g.build = null; g.ghost = null; g.sel = null; g.touchAim = false; paintShop(g); paintPanel(g); mine();
        }
        else if (k === ',' || k === '.') { upgrade(g, k === ',' ? 0 : 1); mine(); }
        else if (k === 'Tab') { cycleMode(g, ev.shiftKey ? -1 : 1); mine(); }
        else if (k === ' ') { act('go'); mine(); }
        else if (k === 'Backspace' || k === 'Delete') { act('sell'); mine(); }
    }
    function act(a) {
        const g = G;
        switch (a) {
            case 'menu': screen = 'menu'; render(); break;
            case 'maps': M = loadMeta(); screen = 'maps'; render(); break;
            case 'meta': M = loadMeta(); screen = 'meta'; render(); break;
            case 'resume': { const r = readJson(RUN_KEY); M = loadMeta(); startSolo(r && r.map, r); break; }
            case 'online':
                if (typeof openNetplay === 'function') openNetplay({ gameId: 'trollproblem' });
                else if (window.Netplay) Netplay.openLobby({ gameId: 'trollproblem' });
                break;
            case 'go': if (g && g.s.phase === 'prep') { g.started = true; issue(g, { c: 'go' }); } break;
            case 'place': if (g) place(g); break;
            case 'cancel': if (g) { g.build = null; g.ghost = null; g.touchAim = false; paintShop(g); paintPanel(g); } break;
            case 'sell': if (g && g.sel) issue(g, { c: 'sell', i: g.sel }); break;
            case 'quit': case 'leave':
                if (g && g.solo && !g.over) saveRun(g);
                tearDown();
                screen = 'menu'; render();
                break;
            case 'again': if (g) again(g); break;
        }
    }

    // ===============================================================
    // the way in
    // ===============================================================
    function openMenu() {
        ensureWindow();
        if (G && screen === 'play') return;
        tearDown();
        M = loadMeta();
        screen = 'menu';
        render();
        if (typeof unlockAchievement === 'function') unlockAchievement('troll_problem');
    }
    window.startTrollProblem = openMenu;
    // the lobby's picture of a player: a pointer post on the desktop's teal
    function paintAvatar(canvas) {
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        c.fillStyle = '#2f8f83'; c.fillRect(0, 0, w, h);
        const im = new Image();
        im.onload = () => { const k = min((w - 6) / im.naturalWidth, (h - 6) / im.naturalHeight); c.drawImage(im, (w - im.naturalWidth * k) / 2, (h - im.naturalHeight * k) / 2, im.naturalWidth * k, im.naturalHeight * k); };
        im.src = towerSrc(TP.TOWERS[0], 'base');
    }
    if (window.Netplay) {
        Netplay.registerGame({
            id: 'trollproblem',
            name: 'sir, we have a troll problem',
            start: (session, opts) => {
                if (opts && opts.solo) { openMenu(); return; }
                startOnline(session, opts || {});
            },
            startSolo: () => openMenu(),
            soloLabel: 'on my own',
            paintAvatar
        });
    }
    // for the browser test: the state, and a clock it can turn up
    window.TP_ENGINE = {
        state: () => G, screen: () => screen, issue: (c) => issue(G, c), act, pickTower: id => pickTower(G, id),
        clock: n => { testClock = max(1, +n || 1); }, meta: () => loadMeta(), startSolo,
        addBot: (seat, strat) => { if (G && G.isHost) { G.bots = G.bots || []; G.bots[seat] = S.newBot(strat || 'smart', 99 + seat); } },
        fit, draw
    };
})();
