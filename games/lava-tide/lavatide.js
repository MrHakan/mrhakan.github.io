// ===================================================================
// lava & tide 98 — the window, the keys and thumbs, the picture, the wire
//
// lavatide-sim.js is the rules. This is what sits between them and people:
// two at one keyboard (lava on w a d, tide on the arrows), one person
// driving both (tab or q swaps), or two browsers over the lobby.
//
// Online is host authoritative. The host is lava and runs the world at a
// fixed 60 a second; the guest (tide) sends only its keys and gets the whole
// state back 20 times a second (6 over the relays). The guest runs the same
// rules on its own keys meanwhile, and replays them on top of each snapshot,
// so its own character answers at once and the host still decides.
// ===================================================================
(function () {
    'use strict';

    const S = window.LT_SIM;
    if (!S) { console.warn('[lava & tide] the rules are missing'); return; }
    const { min, max, floor, round, sin, cos, PI, abs } = Math;
    const T = S.T, W = S.COLS * T, H = S.ROWS * T, DT = 1000 / S.TICK;
    const BEST_KEY = 'mrhakan98-lavatide-best', PREFS_KEY = 'mrhakan98-lavatide-prefs';
    const NAMES = ['lava', 'tide'];
    const CH_COL = ['#f0c020', '#b060e0', '#30c8c8', '#e85050', '#60d060'];
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    function ensureCss() {
        if (document.getElementById('lt-css')) return;
        const l = document.createElement('link');
        l.id = 'lt-css'; l.rel = 'stylesheet'; l.href = 'games/lava-tide/lavatide.css';
        document.head.appendChild(l);
    }
    const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
    // best per level: { "0": { r: 'A', t: seconds, g: gems } }
    function loadBest() {
        const b = readJson(BEST_KEY), out = {};
        if (b && typeof b === 'object') for (const k in b) {
            const v = b[k], i = +k;
            if (Number.isInteger(i) && i >= 0 && i < S.LEVELS.length && v && /^[ABC]$/.test(v.r)) out[i] = { r: v.r, t: +v.t || 0, g: +v.g || 0 };
        }
        return out;
    }
    const unlocked = best => { let n = 0; while (best[n]) n++; return min(S.LEVELS.length - 1, n); };
    function record(s) {
        const best = loadBest(), r = S.rank(s), t = round(s.endT / S.TICK * 10) / 10, g = S.gemCount(s);
        const old = best[s.lv];
        const fresh = !old || S.better(r, old.r) || (r === old.r && t < old.t);
        if (fresh) { best[s.lv] = { r, t, g }; writeJson(BEST_KEY, best); }
        return { r, t, g, fresh, old };
    }
    const prefs = () => Object.assign({ mode: 'duo' }, readJson(PREFS_KEY) || {});
    const savePrefs = o => writeJson(PREFS_KEY, Object.assign(prefs(), o));

    // ---------------------------------------------------------------
    // sound: a few beeps, quiet when the site is
    // ---------------------------------------------------------------
    let actx = null;
    function soundOn() {
        try { if (localStorage.getItem('sound-enabled') === 'false') return false; } catch (e) { }
        return typeof soundEnabled === 'undefined' ? true : !!soundEnabled;
    }
    function tone(f, dur, o) {
        if (!soundOn()) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
            if (!actx) actx = new AC();
            if (actx.state === 'suspended') actx.resume().catch(() => { });
            o = o || {};
            const t0 = actx.currentTime + (o.delay || 0), osc = actx.createOscillator(), g = actx.createGain();
            osc.type = o.type || 'square';
            osc.frequency.setValueAtTime(f, t0);
            if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(o.gain || 0.035, t0 + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(g); g.connect(actx.destination);
            osc.start(t0); osc.stop(t0 + dur + 0.02);
        } catch (e) { }
    }
    const sfx = {
        jump: i => tone(i ? 520 : 380, 0.08, { to: i ? 760 : 560, type: 'triangle', gain: 0.025 }),
        gem: () => { tone(880, 0.06, { type: 'triangle' }); tone(1320, 0.1, { type: 'triangle', delay: 0.06 }); },
        click: () => tone(300, 0.05, { gain: 0.02 }),
        die: () => tone(260, 0.5, { to: 60, type: 'sawtooth', gain: 0.04 }),
        won: () => { tone(523, 0.12); tone(659, 0.12, { delay: 0.12 }); tone(784, 0.12, { delay: 0.24 }); tone(1046, 0.3, { delay: 0.36 }); }
    };

    // ---------------------------------------------------------------
    // the window
    // ---------------------------------------------------------------
    let winRef = null, root = null, cv = null, cx = null, stage = null, over = null, bar = null, pad = null, toastEl = null;
    let G = null, screen = 'menu', raf = 0, menuMode = 'duo', ff = 1;
    const held = new Set();
    const touchBits = [0, 0];
    let touchSeen = false;
    const IS_TOUCH = () => { try { return !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } };

    function ensureWindow() {
        ensureCss();
        if (winRef && winRef.win && document.getElementById(winRef.win.id)) return winRef;
        const vw = typeof viewportWidth === 'function' ? viewportWidth() : (document.documentElement.clientWidth || 800);
        winRef = createAppWindow('lava & tide 98', { icon: 'castle', width: min(760, vw - 20) });
        winRef.body.classList.add('lt-body');
        if ((document.documentElement.clientHeight || 800) < 700) winRef.win.style.top = '4px';
        root = winRef.body;
        root.innerHTML = `<div class="lt-wrap">
            <div class="lt-bar" id="lt-bar"></div>
            <div class="lt-stage" id="lt-stage">
                <canvas class="lt-canvas" id="lt-canvas" aria-label="the temple"></canvas>
                <div class="lt-toast" id="lt-toast" hidden></div>
                <div class="lt-over" id="lt-over"></div>
            </div>
            <div class="lt-pad" id="lt-pad">
                <div class="lt-pad-l"><button class="lt-btn" data-pad="1" aria-label="left">◀</button><button class="lt-btn" data-pad="2" aria-label="right">▶</button></div>
                <button class="lt-btn lt-swap" data-act="swap">swap</button>
                <div class="lt-pad-r"><button class="lt-btn" data-pad="4" aria-label="jump">▲</button></div>
            </div>
        </div>`;
        bar = root.querySelector('#lt-bar');
        stage = root.querySelector('#lt-stage');
        cv = root.querySelector('#lt-canvas');
        cx = cv.getContext('2d');
        over = root.querySelector('#lt-over');
        pad = root.querySelector('#lt-pad');
        toastEl = root.querySelector('#lt-toast');
        root.addEventListener('click', onClick);
        bindPad();
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', clearKeys);
        window.addEventListener('resize', onResize);
        window.addEventListener('message', onMessage);
        document.addEventListener('visibilitychange', onVis);
        winRef.win._cleanup = () => {
            leaveOnline();
            stopLoop();
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', clearKeys);
            window.removeEventListener('resize', onResize);
            window.removeEventListener('message', onMessage);
            document.removeEventListener('visibilitychange', onVis);
            G = null; root = null; cv = null; cx = null; stage = null; over = null; bar = null; pad = null; toastEl = null; winRef = null; cache = null;
        };
        startLoop();
        return winRef;
    }
    function onTop() {
        if (!winRef || !winRef.win || winRef.win.style.display === 'none') return false;
        const z = +winRef.win.style.zIndex || 0;
        return ![...document.querySelectorAll('.app-window, .ie-window')].some(w => w !== winRef.win && w.style.display !== 'none' && (+w.style.zIndex || 0) > z);
    }
    let fitAt = 0, scale = 1, dpr = 1;
    function onResize() { fitAt = 0; }
    function fit(force) {
        if (!stage || !root) return;
        const now = performance.now();
        if (!force && fitAt && now - fitAt < 300) return;
        fitAt = now;
        const avail = max(200, root.clientWidth - 10);
        const vh = document.documentElement.clientHeight || 700;
        const top = stage.getBoundingClientRect().top;
        const padH = pad && pad.classList.contains('on') ? 64 : 0;
        const room = max(150, vh - max(0, top) - padH - 14);
        let w = avail, h = round(w * H / W);
        if (h > room && !winRef.win.classList.contains('fs-active')) { h = room; w = round(h * W / H); }
        if (winRef.win.classList.contains('fs-active')) { h = min(round(avail * H / W), root.clientHeight - padH - 40); w = round(h * W / H); }
        w = max(200, min(avail, w)); h = round(w * H / W);
        stage.style.width = w + 'px'; stage.style.height = h + 'px'; stage.style.margin = '0 auto';
        dpr = min(2, window.devicePixelRatio || 1);
        const bw = round(w * dpr), bh = round(h * dpr);
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; cache = null; }
        scale = bw / W;
    }

    // ---------------------------------------------------------------
    // a game
    // ---------------------------------------------------------------
    // mode: 'duo' two at one keyboard, 'solo' one person both, 'online'
    function makeGame(lv, mode, o) {
        o = o || {};
        const s = S.newLevel(lv, o.seed || 1);
        return {
            s, lv, mode, active: 0, acc: 0, last: performance.now(), paused: false, over: false, result: null,
            prev: posOf(s), fx: [], seen: s.t, gemsSeen: 0,
            session: o.session || null, isHost: mode !== 'online' || !!o.isHost, me: o.me || 0, match: o.match || '',
            remote: 0, remoteSeq: 0, q: [], qTop: 0, buffering: true, ackSeen: 0, seq: 0, hist: [], sentAt: 0, sentBits: -1, snapAt: 0, lastSnap: performance.now(), netDown: false,
            pilot: null, alone: false, offs: []
        };
    }
    function posOf(s) {
        return { c: s.chars.map(c => [c.x, c.y]), b: s.boxes.map(b => [b.x, b.y]), p: s.plats.map(p => [p.x, p.y]) };
    }
    function savePrev(g) {
        const s = g.s, P = g.prev;
        s.chars.forEach((c, i) => { P.c[i][0] = c.x; P.c[i][1] = c.y; });
        s.boxes.forEach((b, i) => { P.b[i][0] = b.x; P.b[i][1] = b.y; });
        s.plats.forEach((p, i) => { P.p[i][0] = p.x; P.p[i][1] = p.y; });
    }
    function startLevel(lv, mode) {
        ensureWindow();
        if (mode !== 'online') leaveOnline();
        const g = makeGame(lv, mode || menuMode);
        if (mode === 'solo') g.active = 0;
        G = g; screen = 'play'; cache = null;
        hideOver();
        showPad();
        paintBar(true);
        toast(S.LEVELS[lv].hint, 3500);
    }
    function restart() {
        const g = G;
        if (!g) return;
        if (g.mode === 'online' && !g.isHost) { ask('retry'); return; }
        const fresh = carry(g, makeGame(g.lv, g.mode, { session: g.session, isHost: g.isHost, me: g.me, match: g.match }));
        G = fresh; cache = null;
        hideOver(); paintBar(true);
        if (g.mode === 'online') sendSnap(fresh, true);
    }
    // a new level keeps who is who and the wire
    function carry(g, fresh) {
        for (const k of ['active', 'offs', 'alone', 'remoteSeq', 'remote', 'q', 'qTop', 'buffering', 'ackSeen', 'other', 'seq', 'sentBits', 'auto']) fresh[k] = g[k];
        return fresh;
    }
    function gotoLevel(lv) {
        const g = G;
        if (!g) return;
        if (g.mode === 'online' && !g.isHost) { ask('next'); return; }
        const fresh = carry(g, makeGame(lv, g.mode, { session: g.session, isHost: g.isHost, me: g.me, match: g.match }));
        G = fresh; cache = null;
        hideOver(); paintBar(true);
        toast(S.LEVELS[lv].hint, 3500);
        if (g.mode === 'online') sendSnap(fresh, true);
    }

    // ---------------------------------------------------------------
    // keys and thumbs
    // ---------------------------------------------------------------
    const LAVA_KEYS = { KeyA: 1, KeyD: 2, KeyW: 4 }, TIDE_KEYS = { ArrowLeft: 1, ArrowRight: 2, ArrowUp: 4 };
    function bitsFor(set, map) { let b = 0; for (const k in map) if (set.has(k)) b |= map[k]; return b; }
    // what each seat is asking for this step
    function localKeys(g) {
        const lava = bitsFor(held, LAVA_KEYS), tide = bitsFor(held, TIDE_KEYS) | (held.has('Space') ? 4 : 0);
        const out = [0, 0];
        if (g.mode === 'duo') { out[0] = lava; out[1] = tide; out[g.active] |= touchBits[0]; }
        else if (g.mode === 'solo' || g.alone) out[g.active] = lava | tide | touchBits[0];
        else out[g.me] = lava | tide | touchBits[0];
        return out;
    }
    const typing = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
    function onKey(e) {
        if (!root || typing(e) || !onTop()) return;
        const k = e.code;
        if (screen !== 'play' || !G) {
            if (k === 'Enter' && over && over.classList.contains('on')) { const b = over.querySelector('.lt-go'); if (b) { e.preventDefault(); b.click(); } }
            return;
        }
        const g = G;
        if (LAVA_KEYS[k] || TIDE_KEYS[k] || k === 'Space' || k === 'ArrowDown' || k === 'KeyS') { e.preventDefault(); held.add(k); return; }
        if (e.repeat) return;
        if (k === 'Tab' || k === 'KeyQ') { e.preventDefault(); swap(); return; }
        if (k === 'Escape' || k === 'KeyP') { e.preventDefault(); e.stopPropagation(); togglePause(); return; }
        if (k === 'KeyR') { e.preventDefault(); restart(); return; }
        if ((k === 'Enter' || k === 'KeyN') && g.over) { e.preventDefault(); const b = over.querySelector('.lt-go'); if (b) b.click(); }
    }
    function onKeyUp(e) { held.delete(e.code); }
    function clearKeys() { held.clear(); touchBits[0] = 0; }
    function swap() {
        const g = G;
        if (!g || (g.mode === 'online' && !g.alone)) return;
        g.active = 1 - g.active;
        sfx.click(); paintBar(true);
    }
    function bindPad() {
        pad.querySelectorAll('[data-pad]').forEach(b => {
            const bit = +b.dataset.pad;
            const down = e => { e.preventDefault(); touchSeen = true; touchBits[0] |= bit; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (_) { } };
            const up = e => { e.preventDefault(); touchBits[0] &= ~bit; b.classList.remove('on'); };
            b.addEventListener('pointerdown', down);
            b.addEventListener('pointerup', up);
            b.addEventListener('pointercancel', up);
            b.addEventListener('lostpointercapture', up);
            b.addEventListener('contextmenu', e => e.preventDefault());
        });
        stage.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && !touchSeen) { touchSeen = true; showPad(); } });
    }
    function showPad() {
        if (!pad) return;
        const on = screen === 'play' && (IS_TOUCH() || touchSeen);
        pad.classList.toggle('on', on);
        const sw = pad.querySelector('.lt-swap');
        if (sw) sw.style.visibility = G && (G.mode !== 'online' || G.alone) ? 'visible' : 'hidden';
        fitAt = 0;
    }

    // ---------------------------------------------------------------
    // pausing: by hand, when the window is minimised, when the tab hides
    // ---------------------------------------------------------------
    function canPause(g) { return g && (g.mode !== 'online' || g.alone); }
    function togglePause(force) {
        const g = G;
        if (!g || g.over) return;
        if (!canPause(g)) { toast('an online game does not pause. your partner is still there'); return; }
        g.paused = force === undefined ? !g.paused : force;
        clearKeys();
        if (g.paused) showPanel('paused', `<div class="lt-big">paused</div><div class="lt-row">
            <button class="lt-btn lt-go" data-act="resume">carry on</button><button class="lt-btn" data-act="restart">restart</button><button class="lt-btn" data-act="menu">levels</button></div>
            <div class="lt-note">esc or p pauses, r restarts${G.mode === 'solo' ? ', tab or q swaps' : ''}</div>`);
        else { hideOver(); g.last = performance.now(); g.acc = 0; }
    }
    function onVis() { if (document.hidden && G && screen === 'play' && !G.paused && !G.over && canPause(G)) togglePause(true); }
    function onMessage(e) {
        if (e.origin !== location.origin || !e.data || e.data.type !== 'game-pause') return;
        if (G && screen === 'play' && !G.paused && !G.over && canPause(G)) togglePause(true);
    }

    // ---------------------------------------------------------------
    // the loop
    // ---------------------------------------------------------------
    function startLoop() { if (!raf) { const tick = () => { raf = requestAnimationFrame(tick); frame(); }; raf = requestAnimationFrame(tick); } }
    function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    let barAt = 0;
    function frame() {
        if (!root || !document.getElementById('lt-stage')) { stopLoop(); return; }
        fit();
        const now = performance.now();
        const g = G;
        if (!g || screen !== 'play') { drawIdle(now); return; }
        // minimised: hold still
        if (winRef.win.style.display === 'none' && canPause(g) && !g.paused && !g.over) togglePause(true);
        let dt = min(250, now - g.last);
        g.last = now;
        if (!g.paused) {
            g.acc += dt * ff;
            let n = 0;
            while (g.acc >= DT && n < 8 * ff) { g.acc -= DT; n++; tickOnce(g); if (G !== g) return; }
            if (g.acc > DT * 4) g.acc = 0;
            // the host falling behind the guest's keys catches up with extra steps;
            // a key is never dropped, or tide would end up somewhere it never went
            if (g.mode === 'online' && g.isHost && !g.alone) for (let k = 0; k < 8 && g.q.length > (onRelays(g) ? 60 : 30); k++) { tickOnce(g); if (G !== g) return; }
        }
        if (g.mode === 'online') net(g, now);
        draw(g, g.paused ? 1 : min(1, g.acc / DT), now);
        if (now - barAt > 120) { barAt = now; paintBar(); }
    }
    function tickOnce(g) {
        const s = g.s;
        if (s.ph !== 'play') { finishCheck(g); return; }
        savePrev(g);
        const k = localKeys(g);
        let hold = 0;
        if (g.auto && !g.pilot) g.pilot = S.autopilot(s.lv);
        if (g.pilot) { const a = g.pilot.keys(s); k[0] = a[0]; k[1] = a[1]; }
        if (g.mode === 'online' && !g.alone) {
            if (g.isHost) {
                // the guest's keys, one per step and in order, a few steps late
                // a small buffer soaks up the wire's jitter: an empty queue
                // means tide keeps its last keys until a few steps are in hand
                if (!g.q.length) g.buffering = true;
                else if (g.buffering && g.q.length >= (onRelays(g) ? 16 : 6)) g.buffering = false;
                if (!g.buffering) { g.remoteSeq = g.q.shift(); g.remote = g.q.shift(); }
                else hold = 2;
                k[1] = g.remote;
            }
            else {
                // the guest moves only its own character; the host's comes in
                // the snapshots, so a guess about it can never end the level
                k[0] = s.inputs[0];
                hold = 1;
                g.seq++;
                g.hist.push(g.seq, k[1]);
                if (g.hist.length > 600) g.hist.splice(0, g.hist.length - 600);
            }
        }
        S.step(s, k[0], k[1], hold);
        events(g);
        finishCheck(g);
    }
    function events(g) {
        const s = g.s;
        for (const e of s.events) {
            if (e.e === 'jump') sfx.jump(e.i);
            else if (e.e === 'gem') { sfx.gem(); const gm = s.gems[e.g]; burst(g, gm.x * T + 8, gm.y * T + 8, e.i ? '#7fd0ff' : '#ff7050', 10); }
            else if (e.e === 'lever' || e.e === 'press') sfx.click();
            else if (e.e === 'die') { sfx.die(); const c = s.chars[e.i]; burst(g, c.x + 5, c.y + 10, '#808080', 24); }
        }
        s.events.length = 0;
    }
    function finishCheck(g) {
        const s = g.s;
        if (g.over || s.ph === 'play') return;
        g.over = true;
        clearKeys();
        if (s.ph === 'won') {
            sfx.won();
            const res = record(s);
            g.result = res;
            const lv = s.lv, last = lv >= S.LEVELS.length - 1;
            const host = g.mode !== 'online' || g.isHost || g.alone;
            showPanel('won', `<div class="lt-big">level ${lv + 1} done: rank <span class="lt-rank lt-rank-${res.r.toLowerCase()}">${res.r}</span></div>
                <div class="lt-stats"><span>time</span><b>${res.t.toFixed(1)}s <small>(par ${S.LEVELS[lv].par}s)</small></b><span>gems</span><b>${res.g} of ${s.gems.length}</b>
                <span>best</span><b>${res.fresh ? 'new best!' : esc(res.old.r + ', ' + res.old.t.toFixed(1) + 's')}</b></div>
                <div class="lt-row">${last ? '' : `<button class="lt-btn lt-go" data-act="next">${host ? 'next level' : 'ask for the next level'}</button>`}
                <button class="lt-btn${last ? ' lt-go' : ''}" data-act="restart">${host ? 'play it again' : 'ask to replay'}</button><button class="lt-btn" data-act="menu">levels</button></div>
                <div class="lt-note">${last ? 'that was the last door. every level again for an A?' : 'a: every gem inside par. b: every gem, or par with half. c: you got out.'}</div>`);
        } else {
            const who = s.chars.findIndex(c => c.dead);
            const why = who === 0 ? 'lava touched water or goo' : 'tide touched lava or goo';
            showPanel('dead', `<div class="lt-big">${esc(why)}</div><div class="lt-row">
                <button class="lt-btn lt-go" data-act="restart">try again</button><button class="lt-btn" data-act="menu">levels</button></div>
                <div class="lt-note">r restarts any time</div>`);
        }
        paintBar(true);
    }

    // ---------------------------------------------------------------
    // the bar over the picture
    // ---------------------------------------------------------------
    let barHtml = '';
    function paintBar(force) {
        if (!bar) return;
        let html;
        if (screen !== 'play' || !G) html = `<span class="lt-chip lt-name">lava &amp; tide 98</span><span class="lt-sp"></span>`;
        else {
            const g = G, s = g.s, secs = s.t / S.TICK;
            const got = k => s.gems.filter(x => x.k === k && x.got).length, all = k => s.gems.filter(x => x.k === k).length;
            let who = '';
            if (g.mode === 'solo' || g.alone) who = `<span class="lt-chip lt-who lt-${NAMES[g.active]}">you: ${NAMES[g.active]}</span>`;
            else if (g.mode === 'online') who = `<span class="lt-chip lt-who lt-${NAMES[g.me]}">you: ${NAMES[g.me]}</span>`;
            html = `<span class="lt-chip lt-name">${s.lv + 1}. ${esc(S.LEVELS[s.lv].name)}</span>
                <span class="lt-chip" title="time">${floor(secs / 60)}:${String(floor(secs % 60)).padStart(2, '0')}</span>
                <span class="lt-chip" title="gems"><i class="lt-red"></i>${got(0)}/${all(0)} <i class="lt-blue"></i>${got(1)}/${all(1)}</span>
                ${who}${g.netDown ? '<span class="lt-chip">waiting for the host...</span>' : ''}<span class="lt-sp"></span>
                ${g.mode === 'solo' || g.alone ? '<button class="lt-btn" data-act="swap" title="tab or q">swap</button>' : ''}
                <button class="lt-btn" data-act="pause" title="esc or p">pause</button><button class="lt-btn" data-act="restart" title="r">restart</button><button class="lt-btn" data-act="menu">levels</button>`;
        }
        if (!force && html === barHtml) return;
        barHtml = html; bar.innerHTML = html;
    }
    let toastT = 0;
    function toast(msg, ms) {
        if (!toastEl) return;
        toastEl.textContent = msg; toastEl.hidden = false;
        clearTimeout(toastT);
        toastT = setTimeout(() => { if (toastEl) toastEl.hidden = true; }, ms || 2500);
    }

    // ---------------------------------------------------------------
    // dialogs
    // ---------------------------------------------------------------
    function showPanel(title, inner) {
        over.innerHTML = `<div class="lt-panel" role="dialog" aria-label="${esc(title)}"><div class="lt-title">${esc(title)}</div><div class="lt-in">${inner}</div></div>`;
        over.classList.add('on');
    }
    function hideOver() { if (over) { over.classList.remove('on'); over.innerHTML = ''; } }
    function openMenu() {
        ensureWindow();
        if (G && screen === 'play' && G.mode === 'online') return;
        screen = 'menu';
        G = null;
        menuMode = prefs().mode === 'solo' ? 'solo' : 'duo';
        showPad();
        paintBar(true);
        paintMenu();
        fit(true);
    }
    function paintMenu() {
        const best = loadBest(), open = unlocked(best);
        const touch = IS_TOUCH();
        showPanel('lava & tide 98', `<div class="lt-logo"><b>lava</b> &amp; <u>tide</u> <small>98</small></div>
            <ul class="lt-how">
                <li><b>lava</b> walks through lava, <b>tide</b> walks through water. green goo gets anybody.</li>
                <li>red gems are lava's, blue gems are tide's. both of you in your own doors ends the level.</li>
                <li>plates hold things while somebody (or a box) stands on them. levers stay where you push them.</li>
                <li>${touch ? 'the buttons under the temple move whoever you are; swap changes who.' : 'two of you: lava on <b>w a d</b>, tide on the <b>arrows</b>. alone: either set moves one, <b>tab</b> or <b>q</b> swaps. <b>r</b> restarts, <b>esc</b> pauses.'}</li>
            </ul>
            <div class="lt-modes">
                <button class="lt-btn ${menuMode === 'duo' ? 'on' : ''}" data-act="mode" data-m="duo" aria-pressed="${menuMode === 'duo'}">two at one keyboard</button>
                <button class="lt-btn ${menuMode === 'solo' ? 'on' : ''}" data-act="mode" data-m="solo" aria-pressed="${menuMode === 'solo'}">alone, both of them</button>
                <button class="lt-btn" data-act="online">online with a friend</button>
            </div>
            <div class="lt-levels">${S.LEVELS.map((L, i) => {
                const b = best[i], locked = i > open;
                return `<button class="lt-btn lt-lv${i === open ? ' lt-go lt-cur' : ''}" data-act="level" data-lv="${i}" ${locked ? 'disabled' : ''} title="${esc(L.name)}"><b>${i + 1}</b><em>${locked ? 'locked' : b ? `<span class="lt-rank lt-rank-${b.r.toLowerCase()}">${b.r}</span> ${b.t.toFixed(0)}s` : 'new'}</em></button>`;
            }).join('')}</div>
            <div class="lt-note">${Object.keys(best).length} of ${S.LEVELS.length} temples cleared. finish one to open the next.</div>`);
    }
    function onClick(e) {
        const b = e.target.closest('[data-act]');
        if (!b || b.disabled) return;
        const g = G;
        switch (b.dataset.act) {
            case 'mode': menuMode = b.dataset.m === 'solo' ? 'solo' : 'duo'; savePrefs({ mode: menuMode }); paintMenu(); break;
            case 'level': startLevel(+b.dataset.lv, menuMode); break;
            case 'online':
                if (typeof openNetplay === 'function') openNetplay({ gameId: 'lavatide' });
                else if (window.Netplay) Netplay.openLobby({ gameId: 'lavatide' });
                break;
            case 'resume': togglePause(false); break;
            case 'pause': togglePause(); break;
            case 'restart': restart(); break;
            case 'swap': swap(); break;
            case 'next': if (g) { if (g.mode === 'online' && !g.isHost && !g.alone) ask('next'); else if (g.lv + 1 < S.LEVELS.length) gotoLevel(g.lv + 1); } break;
            case 'menu':
                if (g && g.mode === 'online' && !g.alone) { if (!confirmLeave()) break; leaveOnline(); }
                openMenu(); break;
            case 'solo-here': { const lv = g ? g.lv : 0; leaveOnline(); startLevel(lv, 'solo'); break; }
        }
    }
    function confirmLeave() { try { return window.confirm('leave the online game?'); } catch (e) { return true; } }

    // ---------------------------------------------------------------
    // online
    // ---------------------------------------------------------------
    const onRelays = g => !!(g.session && g.session.transport && g.session.transport.kind === 'bus');
    function startOnline(session, opts) {
        ensureWindow();
        leaveOnline();
        const o = (opts && opts.options) || session.gameOptions || {};
        const lv = max(0, min(S.LEVELS.length - 1, (parseInt(o.level, 10) || 1) - 1));
        const slots = Array.isArray(opts && opts.slots) ? opts.slots : session.players.map(p => p.id);
        const me = slots.indexOf(session.id);
        const match = String((opts && opts.at) || 0) + ':' + String((opts && opts.seed) || 0);
        session.state = 'playing';
        const g = makeGame(lv, 'online', { session, isHost: !!session.isHost, me: me === 1 ? 1 : 0, match });
        g.other = slots.find(id => id !== session.id) || '';
        G = g; screen = 'play'; cache = null;
        hideOver(); showPad(); paintBar(true);
        const s = session, offs = g.offs;
        if (g.isHost) {
            offs.push(s.on('lavatide:i', (d, from) => {
                const gg = G;
                if (!gg || gg.mode !== 'online' || !from || from.id !== gg.other || !d || d.m !== gg.match) return;
                if (!Number.isSafeInteger(d.q) || d.q < 1 || !Array.isArray(d.b) || d.b.length > 150 || !d.b.every(b => Number.isInteger(b) && b >= 0 && b <= 7)) return;
                // a guest only ever runs ahead of what we have by a few seconds
                if (gg.qTop && d.q > gg.qTop + 600) return;
                const first = d.q - d.b.length + 1;
                d.b.forEach((b, i) => { const q = first + i; if (q > gg.qTop) { gg.q.push(q, b); gg.qTop = q; } });
            }));
            offs.push(s.on('lavatide:ask', (d, from) => {
                const gg = G;
                if (!gg || !from || from.id !== gg.other || !d || d.m !== gg.match) return;
                if (d.a === 'retry') restart();
                else if (d.a === 'next' && gg.s.ph === 'won' && gg.lv + 1 < S.LEVELS.length) gotoLevel(gg.lv + 1);
            }));
            offs.push(s.on('player-leave', p => { const gg = G; if (gg && gg.mode === 'online' && p && p.id === gg.other) partnerGone(gg, p.name); }));
            sendSnap(g, true);
        } else {
            offs.push(s.on('lavatide:s', (d, from) => onSnap(d, from)));
            offs.push(s.on('player-leave', p => { if (p && p.host) hostGone(); }));
            offs.push(s.on('net:down', () => { if (G) { G.netDown = true; paintBar(true); } }));
            offs.push(s.on('net:up', () => { if (G) { G.netDown = false; paintBar(true); } }));
        }
        offs.push(s.on('closed', () => { if (G && G.mode === 'online' && !G.alone && G.session === s && !G.isHost) hostGone(); }));
        toast(`you are ${NAMES[g.me]}. ${g.me ? 'tide: the arrows (or w a d)' : 'lava: w a d (or the arrows)'}`, 4000);
    }
    function leaveOnline() {
        const g = G;
        if (!g || !g.session) return;
        g.offs.forEach(off => { try { off(); } catch (e) { } });
        g.offs = [];
        if (g.session.alive) g.session.leave();
        g.session = null;
    }
    // the guest walked out: the host carries on with both, like alone
    function partnerGone(g, name) {
        g.alone = true; g.active = 0; g.remote = 0;
        toast((name || 'your partner') + ' left. you drive both now: tab or q swaps', 5000);
        showPad(); paintBar(true);
    }
    function hostGone() {
        const g = G;
        if (!g || g.alone) return;
        g.alone = true; g.netDown = false;
        showPanel('the host left', `<div class="lt-big">the host left</div><div class="lt-row">
            <button class="lt-btn lt-go" data-act="solo-here">carry on alone from level ${g.lv + 1}</button><button class="lt-btn" data-act="menu">levels</button></div>`);
        g.paused = true;
    }
    function ask(a) {
        const g = G;
        if (!g || !g.session) return;
        g.session.sendToHost('lavatide:ask', { a, m: g.match });
        toast(a === 'next' ? 'asked the host for the next level' : 'asked the host to restart');
    }
    function sendSnap(g, now) {
        if (!g.session || !g.session.alive || g.alone) return;
        const d = S.snapshot(g.s);
        d.m = g.match; d.ack = g.remoteSeq;
        g.session.send('lavatide:s', d);
        g.snapAt = performance.now();
        void now;
    }
    function net(g, now) {
        if (g.alone || !g.session) return;
        if (g.isHost) {
            const hz = onRelays(g) ? 6 : 20;
            if (now - g.snapAt >= 1000 / hz - 2) sendSnap(g);
        } else {
            // every step's keys since the host last said it had them, again and again
            const gap = onRelays(g) ? 150 : 40;
            if (now - g.sentAt > gap && g.hist.length) {
                g.sentAt = now;
                const H = g.hist, b = [];
                let i = 0;
                while (i < H.length && H[i] <= g.ackSeen) i += 2;
                i = max(i, H.length - 240);
                for (; i < H.length; i += 2) b.push(H[i + 1]);
                if (b.length) g.session.sendToHost('lavatide:i', { q: H[H.length - 2], b, m: g.match });
            }
        }
    }
    // the guest: the host's word, then our own keys since, again
    function onSnap(d, from) {
        const g = G;
        if (!g || g.mode !== 'online' || g.isHost || g.alone || !d || d.m !== g.match) return;
        const host = g.session && g.session.players.find(p => p.host);
        if (!from || !host || from.id !== host.id) return;
        if (!Number.isInteger(d.l) || d.l < 0 || d.l >= S.LEVELS.length) return;
        if (!Number.isSafeInteger(d.ack) || d.ack < 0) return;
        g.lastSnap = performance.now();
        if (g.netDown) { g.netDown = false; paintBar(true); }
        let s = g.s;
        if (d.l !== s.lv || (d.ph === 'play' && g.over)) {
            // a new level or a restart: start clean from the host's word
            const fresh = carry(g, makeGame(d.l, 'online', { session: g.session, isHost: false, me: g.me, match: g.match }));
            G = fresh; cache = null; hideOver(); paintBar(true);
            if (d.l !== s.lv) toast(S.LEVELS[d.l].hint, 3500);
            return onSnap(d, from);
        }
        const before = s.chars.map(c => [c.x, c.y]);
        const gemsBefore = S.gemCount(s);
        if (!S.applySnapshot(s, d)) return;
        // replay what the host has not seen yet
        const H = g.hist;
        let k = 0;
        while (k < H.length && H[k] <= d.ack) k += 2;
        H.splice(0, k);
        g.ackSeen = max(g.ackSeen, d.ack);
        if (s.ph === 'play') for (let i = 0; i < H.length; i += 2) { g.rep = H[i]; S.step(s, 0, H[i + 1], 1); if (s.ph !== 'play') break; }
        g.rep = 0;
        s.events.length = 0;
        if (S.gemCount(s) > gemsBefore) sfx.gem();
        // a small correction slides, a big one jumps
        s.chars.forEach((c, i) => {
            const P = g.prev.c[i], dx = c.x - before[i][0], dy = c.y - before[i][1];
            if (abs(dx) + abs(dy) < 24) { P[0] += dx * 0.5; P[1] += dy * 0.5; } else { P[0] = c.x; P[1] = c.y; }
        });
        finishCheck(g);
    }

    // ---------------------------------------------------------------
    // the picture
    // ---------------------------------------------------------------
    let cache = null;
    function buildCache(g) {
        const B = g.s.B;
        const back = document.createElement('canvas'), front = document.createElement('canvas');
        back.width = front.width = cv.width; back.height = front.height = cv.height;
        const b = back.getContext('2d'), f = front.getContext('2d');
        b.setTransform(scale, 0, 0, scale, 0, 0); f.setTransform(scale, 0, 0, scale, 0, 0);
        // the back wall: dark bricks
        b.fillStyle = '#2a2416'; b.fillRect(0, 0, W, H);
        for (let y = 0; y < H; y += 8) for (let x = (y / 8) % 2 ? -8 : 0; x < W; x += 16) {
            b.fillStyle = ((x * 7 + y * 3) >> 3) % 3 === 0 ? '#2f2919' : '#272113';
            b.fillRect(x + 0.5, y + 0.5, 15, 7);
        }
        // doors
        for (let i = 0; i < 2; i++) {
            const d = B.doors[i], x = d.x * T, y = (d.y - 1) * T;
            b.fillStyle = '#5a4a2a'; b.fillRect(x - 3, y - 3, T + 6, 2 * T + 3);
            b.fillStyle = '#120e08'; b.beginPath(); b.moveTo(x, y + 2 * T); b.lineTo(x, y + 6); b.arc(x + T / 2, y + 6, T / 2, PI, 0); b.lineTo(x + T, y + 2 * T); b.fill();
            b.fillStyle = i ? '#3aa0ff' : '#ff5a20';
            if (i) { b.beginPath(); b.arc(x + 8, y + 14, 3.5, 0, PI); b.lineTo(x + 8, y + 7); b.closePath(); b.fill(); }
            else { b.beginPath(); b.moveTo(x + 4.5, y + 15); b.quadraticCurveTo(x + 4, y + 9, x + 8, y + 6); b.quadraticCurveTo(x + 8, y + 10, x + 11, y + 10); b.quadraticCurveTo(x + 12.5, y + 14, x + 11.5, y + 15); b.closePath(); b.fill(); }
        }
        // the stone: sandstone blocks with a lit top and a dark seam
        for (let y = 0; y < S.ROWS; y++) for (let x = 0; x < S.COLS; x++) {
            if (B.grid[y][x] !== 1) continue;
            const px = x * T, py = y * T;
            f.fillStyle = (x * 31 + y * 17) % 5 === 0 ? '#8a7840' : '#7d6c38';
            f.fillRect(px, py, T, T);
            f.fillStyle = '#5c4f28'; f.fillRect(px, py + T - 1, T, 1); f.fillRect(px + ((y % 2) ? 0 : 8), py, 1, T);
            if (y > 0 && B.grid[y - 1][x] !== 1) { f.fillStyle = '#b8a060'; f.fillRect(px, py, T, 2); }
            if (x > 0 && B.grid[y][x - 1] !== 1) { f.fillStyle = '#4a3f20'; f.fillRect(px, py, 1, T); }
        }
        cache = { back, front, lv: g.s.lv, w: cv.width };
    }
    const LIQ = { 2: ['#ff7a00', '#ffc040'], 3: ['#1c6cff', '#80d8ff'], 4: ['#2fae3a', '#a8f060'] };
    function draw(g, a, now) {
        if (!cx) return;
        if (!cache || cache.lv !== g.s.lv || cache.w !== cv.width) buildCache(g);
        const s = g.s, c = cx, t = now / 1000;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.drawImage(cache.back, 0, 0);
        c.setTransform(scale, 0, 0, scale, 0, 0);
        // pools
        const B = s.B;
        for (let y = 0; y < S.ROWS; y++) for (let x = 0; x < S.COLS; x++) {
            const k = B.grid[y][x];
            if (k < 2) continue;
            const px = x * T, py = y * T, L = LIQ[k];
            c.fillStyle = L[0]; c.fillRect(px, py + S.POOL - 1, T, T - S.POOL + 1);
            c.fillStyle = L[1];
            for (let i = 0; i < T; i += 2) { const h = 1.5 + sin(t * 4 + (px + i) * 0.4) * 1.2; c.fillRect(px + i, py + S.POOL - 1 - h + 1.5, 2, h); }
        }
        // platforms, under the stone so a gate can sink into a wall
        const lerp = (p, q) => p + (q - p) * a;
        s.plats.forEach((p, i) => {
            const P = g.prev.p[i], x = lerp(P[0], p.x), y = lerp(P[1], p.y);
            const col = p.lift ? '#9a9aa8' : CH_COL[p.ch % CH_COL.length];
            c.fillStyle = '#1a1a1a'; c.fillRect(x, y, p.w, p.h);
            c.fillStyle = col; c.fillRect(x + 1, y + 1, p.w - 2, p.h - 2);
            c.fillStyle = 'rgba(255,255,255,.45)'; c.fillRect(x + 1, y + 1, p.w - 2, 2);
            c.fillStyle = 'rgba(0,0,0,.25)';
            for (let k = 4; k < p.w - 2; k += 8) c.fillRect(x + k, y + 4, 3, max(1, p.h - 6));
        });
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.drawImage(cache.front, 0, 0);
        c.setTransform(scale, 0, 0, scale, 0, 0);
        // plates and levers
        for (const b of s.btns) {
            const x = b.x * T, y = (b.y + 1) * T, h = b.down ? 1.5 : 3.5;
            c.fillStyle = '#1a1a1a'; c.fillRect(x + 1, y - 2, T - 2, 2);
            c.fillStyle = CH_COL[b.ch % CH_COL.length]; c.fillRect(x + 3, y - 2 - h, T - 6, h);
        }
        for (const l of s.levers) {
            const x = l.x * T + 8, y = (l.y + 1) * T, ang = l.on ? 0.6 : -0.6;
            c.strokeStyle = '#d8d0b0'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x, y - 3); c.lineTo(x + sin(ang) * 10, y - 3 - cos(ang) * 10); c.stroke();
            c.fillStyle = CH_COL[l.ch % CH_COL.length]; c.beginPath(); c.arc(x + sin(ang) * 10, y - 3 - cos(ang) * 10, 2.2, 0, 2 * PI); c.fill();
            c.fillStyle = '#4a4030'; c.fillRect(x - 5, y - 4, 10, 4);
        }
        // boxes
        s.boxes.forEach((b, i) => {
            const P = g.prev.b[i], x = lerp(P[0], b.x), y = lerp(P[1], b.y);
            c.fillStyle = '#3a3020'; c.fillRect(x, y, b.w, b.h);
            c.fillStyle = '#a89068'; c.fillRect(x + 1, y + 1, b.w - 2, b.h - 2);
            c.strokeStyle = '#6a5838'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 2, y + 2); c.lineTo(x + b.w - 2, y + b.h - 2); c.moveTo(x + b.w - 2, y + 2); c.lineTo(x + 2, y + b.h - 2); c.stroke();
        });
        // gems
        for (const gm of s.gems) {
            if (gm.got) continue;
            const x = gm.x * T + 8, y = gm.y * T + 8 + sin(t * 3 + gm.x) * 1.2;
            c.fillStyle = gm.k ? '#30a0ff' : '#ff3040';
            c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + 4.5, y); c.lineTo(x, y + 5); c.lineTo(x - 4.5, y); c.closePath(); c.fill();
            c.fillStyle = 'rgba(255,255,255,.75)'; c.fillRect(x - 1.5, y - 2.5, 1.5, 2);
        }
        // doors light up while somebody stands in them
        for (let i = 0; i < 2; i++) if (s.chars[i].inDoor) {
            const d = B.doors[i];
            c.fillStyle = i ? 'rgba(80,170,255,.35)' : 'rgba(255,120,40,.35)';
            c.fillRect(d.x * T, (d.y - 1) * T + 2, T, 2 * T - 2);
        }
        // the two of them
        s.chars.forEach((ch, i) => {
            if (ch.dead) return;
            const P = g.prev.c[i];
            let x = lerp(P[0], ch.x), y = lerp(P[1], ch.y);
            // a guest sees the host's character 20 times a second: glide between
            if (g.mode === 'online' && !g.isHost && !g.alone && i !== g.me) {
                const m = g.smooth || (g.smooth = [ch.x, ch.y]);
                if (abs(m[0] - ch.x) + abs(m[1] - ch.y) > 48) { m[0] = ch.x; m[1] = ch.y; }
                m[0] += (ch.x - m[0]) * 0.3; m[1] += (ch.y - m[1]) * 0.3;
                x = m[0]; y = m[1];
            }
            drawChar(c, i, x, y, ch.face, t, !ch.g, ch.vx);
            const mark = g.mode === 'solo' || g.alone ? g.active === i : g.mode === 'online' ? g.me === i : false;
            if (mark) {
                const x = lerp(P[0], ch.x) + 5, y = lerp(P[1], ch.y) - 9 + sin(t * 5);   // only ever over your own
                c.fillStyle = '#fff'; c.beginPath(); c.moveTo(x - 3, y - 3); c.lineTo(x + 3, y - 3); c.lineTo(x, y + 1); c.closePath(); c.fill();
            }
        });
        // sparks and smoke
        for (let i = g.fx.length - 1; i >= 0; i--) {
            const p = g.fx[i];
            p.life -= 1 / 60; p.x += p.vx; p.y += p.vy; p.vy += 0.05;
            if (p.life <= 0) { g.fx.splice(i, 1); continue; }
            c.globalAlpha = min(1, p.life * 2); c.fillStyle = p.col; c.fillRect(p.x - 1, p.y - 1, 2, 2);
        }
        c.globalAlpha = 1;
    }
    function burst(g, x, y, col, n) {
        for (let i = 0; i < n && g.fx.length < 120; i++) {
            const a = (i / n) * 2 * PI;
            g.fx.push({ x, y, vx: cos(a) * (0.6 + (i % 3) * 0.4), vy: sin(a) * (0.6 + (i % 2) * 0.5) - 0.6, life: 0.6 + (i % 4) * 0.1, col });
        }
    }
    function drawChar(c, i, x, y, face, t, air, vx) {
        const body = i ? '#2a8cff' : '#ff5a1a', dark = i ? '#0d4a9a' : '#a02800', hair = i ? '#b0ecff' : '#ffd040';
        const bob = !air && vx ? abs(sin(t * 14)) * 1 : 0;
        y -= bob;
        // legs
        c.fillStyle = dark;
        const step = !air && vx ? sin(t * 14) * 2 : 0;
        c.fillRect(x + 1.5 + step * 0.5, y + 16, 3, 4); c.fillRect(x + 5.5 - step * 0.5, y + 16, 3, 4);
        // body and head
        c.fillStyle = body;
        c.fillRect(x + 1, y + 10, 8, 7);
        c.beginPath(); c.arc(x + 5, y + 7, 5.5, 0, 2 * PI); c.fill();
        // hair: flames or a curling wave
        c.fillStyle = hair;
        if (i === 0) {
            for (let k = 0; k < 3; k++) {
                const fx = x + 1.5 + k * 3.5, fh = 4 + sin(t * 12 + k * 2) * 1.5;
                c.beginPath(); c.moveTo(fx - 1.8, y + 3); c.lineTo(fx, y + 1 - fh); c.lineTo(fx + 1.8, y + 3); c.closePath(); c.fill();
            }
        } else {
            c.beginPath(); c.moveTo(x - 0.5, y + 4); c.quadraticCurveTo(x + 2, y - 4 + sin(t * 6), x + 6 + face * 2, y - 3); c.quadraticCurveTo(x + 5, y + 0, x + 10.5, y + 4); c.closePath(); c.fill();
        }
        // eyes
        const ex = x + 5 + face * 1.6;
        c.fillStyle = '#fff'; c.fillRect(ex - 3, y + 5, 2.6, 3); c.fillRect(ex + 0.6, y + 5, 2.6, 3);
        c.fillStyle = '#000'; c.fillRect(ex - 2.2 + face * 0.6, y + 6, 1.2, 1.6); c.fillRect(ex + 1.4 + face * 0.6, y + 6, 1.2, 1.6);
    }
    // behind the menu: the first temple, empty and glowing
    let idle = null;
    function drawIdle(now) {
        if (!cx) return;
        if (!idle || idle.lv !== 0) { idle = makeGame(0, 'duo'); idle.pilot = S.autopilot(0); idle.lv = 0; }
        const g = idle;
        const dt = min(100, now - g.last); g.last = now; g.acc += dt;
        while (g.acc >= DT) {
            g.acc -= DT;
            savePrev(g);
            const k = g.pilot.keys(g.s);
            S.step(g.s, k[0], k[1]);
            g.s.events.length = 0;
            if (g.s.ph !== 'play') { idle = null; return; }
        }
        draw(g, g.acc / DT, now);
    }

    // ---------------------------------------------------------------
    // the way in
    // ---------------------------------------------------------------
    window.startLavaTide = function () { openMenu(); return winRef && winRef.win; };
    function paintAvatar(canvas, avatar, o) {
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        const s = window.Netplay && Netplay.current;
        const i = s ? max(0, s.players.findIndex(p => p.id === canvas.dataset.pid)) % 2 : 0;
        c.fillStyle = '#2a2416'; c.fillRect(0, 0, w, h);
        c.save(); c.scale(w / 16, h / 24); drawChar(c, i, 3, 3, 1, 0, false, 0); c.restore();
        void avatar; void o;
    }
    if (window.Netplay) {
        Netplay.registerGame({
            id: 'lavatide',
            name: 'lava & tide 98',
            start: (session, opts) => { if (opts && opts.solo) { menuMode = 'solo'; openMenu(); return; } startOnline(session, opts || {}); },
            startSolo: () => { savePrefs({ mode: 'solo' }); openMenu(); },
            soloLabel: 'alone, switching between them',
            paintAvatar
        });
    }
    // for the tests: the state, a faster clock, the level's own solution
    window.LT_ENGINE = {
        state: () => G, screen: () => screen, sim: S,
        start: (lv, mode) => startLevel(lv || 0, mode || 'duo'),
        menu: () => openMenu(),
        clock: n => { ff = max(1, min(16, +n || 1)); },
        autopilot: on => { if (G) { G.auto = !!on; G.pilot = null; G.made = (G.made || 0); } },
        best: () => loadBest(),
        act: a => { const b = document.createElement('button'); b.dataset.act = a; root && root.appendChild(b); b.click(); b.remove(); },
        fit: () => fit(true)
    };
})();
