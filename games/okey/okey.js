// ===================================================================
// okey 98 — the window, the rack, the table, the bots' pace and the wire
//
// okey-sim.js is the rules. This file is everything between them and a
// person: a green felt table drawn on a canvas, a two row rack you drag
// tiles around on (three rows on a phone), buttons along the bottom, and
// the keyboard. The rack's order is yours alone: the rules only know which
// tiles you hold, so sorting and dragging never go over the wire.
//
// Online is host authoritative. Everybody comes through the desktop lobby;
// the host runs the match and the bots, a guest sends what it wants to do
// (`okey:act`) and the host checks it with the same rules and answers with
// what that guest may see (`okey:st`: its own tiles, never anybody else's).
// A guest that leaves gets a bot in its seat; a guest that sits on its turn
// for a minute gets one move played for it.
// ===================================================================
(function () {
    'use strict';
    const S = window.OKEY_SIM;
    if (!S) { console.warn('[okey] okey-sim.js is missing'); return; }
    const { min, max, floor, round, abs } = Math;

    const PREFS_KEY = 'mrhakan98-okey-prefs', STATS_KEY = 'mrhakan98-okey-stats', SAVE_KEY = 'mrhakan98-okey-save';
    const SLOTS = 30;
    const TURN_LIMIT = 60000;      // online: a minute, then a move is made for you
    const INK = ['#d01818', '#c07800', '#1050d0', '#151515'];
    const COLOR_NAMES = S.COLORS;
    const BOT_NAMES = ['nasiya', 'oleyy', 'heh', 'toplum', 'pffft', 'dusung', 'zirlak', 'ingaaa'];
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    function ensureCss() {
        if (document.getElementById('okey-css')) return;
        const l = document.createElement('link');
        l.id = 'okey-css'; l.rel = 'stylesheet'; l.href = 'games/okey/okey.css';
        document.head.appendChild(l);
    }
    const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
    const removeKey = k => { try { localStorage.removeItem(k); } catch (e) { } };
    function prefs() {
        const p = readJson(PREFS_KEY) || {};
        return {
            mode: p.mode === '101' ? '101' : 'classic',
            start: [10, 20].includes(p.start) ? p.start : 20,
            hands: [1, 3, 5].includes(p.hands) ? p.hands : 3,
            level: S.LEVELS.includes(p.level) ? p.level : 'normal'
        };
    }
    function stats() {
        const o = readJson(STATS_KEY) || {};
        const n = v => (Number.isFinite(+v) && +v >= 0 ? +v : 0);
        return { matches: n(o.matches), wins: n(o.wins), hands: n(o.hands), handWins: n(o.handWins), okeyWins: n(o.okeyWins), pairWins: n(o.pairWins), online: n(o.online) };
    }
    function record(f) { const s = stats(); f(s); writeJson(STATS_KEY, s); }

    // ---------------------------------------------------------------
    // sound: a few square-wave clicks, silent when the site is
    // ---------------------------------------------------------------
    let actx = null;
    const soundOn = () => { try { if (localStorage.getItem('sound-enabled') === 'false') return false; } catch (e) { } return typeof soundEnabled === 'undefined' ? true : soundEnabled !== false; };
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
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(o.gain || 0.03, t0 + 0.008);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(g); g.connect(actx.destination);
            osc.start(t0); osc.stop(t0 + dur + 0.02);
        } catch (e) { }
    }
    const sfx = {
        clack: () => tone(820, 0.05, { type: 'triangle', gain: 0.05 }),
        draw: () => tone(520, 0.05, { type: 'triangle' }),
        turn: () => { tone(660, 0.07); tone(880, 0.09, { delay: 0.07 }); },
        bad: () => tone(160, 0.18, { type: 'sawtooth', gain: 0.025 }),
        win: () => { tone(523, 0.1); tone(659, 0.1, { delay: 0.1 }); tone(784, 0.1, { delay: 0.2 }); tone(1046, 0.3, { delay: 0.3 }); },
        lose: () => { tone(330, 0.15); tone(247, 0.3, { delay: 0.15, type: 'sawtooth', gain: 0.02 }); }
    };

    // ---------------------------------------------------------------
    // the window
    // ---------------------------------------------------------------
    let winRef = null, root = null, cv = null, ctx = null, stage = null, overEl = null, msgEl = null, infoEl = null, toolsEl = null;
    let G = null, raf = 0, dirty = true, L = null, dpr = 1, ro = null, mo = null;
    let speed = 1;
    const faces = new Map();   // the cursed emoji faces the bots are named after, when they load

    function mount() {
        ensureCss();
        if (winRef && winRef.win.isConnected) {
            winRef.win.style.display = 'flex';
            if (typeof ieHighestZ === 'number') winRef.win.style.zIndex = ++ieHighestZ;
            return false;
        }
        const vw = typeof viewportWidth === 'function' ? viewportWidth() : innerWidth;
        winRef = createAppWindow('okey 98', { icon: 'calculate', width: min(900, vw - 20) });
        winRef.body.classList.add('ok-body');
        winRef.win.classList.add('okey-window');
        winRef.body.innerHTML = `
            <div class="ok-app" tabindex="0">
                <div class="ok-status"><span class="ok-msg">okey 98</span><span class="ok-info"></span></div>
                <div class="ok-stage"><canvas class="ok-canvas" aria-label="the okey table and your rack"></canvas></div>
                <div class="ok-tools"></div>
                <div class="ok-over" hidden></div>
            </div>`;
        root = winRef.body.querySelector('.ok-app');
        cv = root.querySelector('.ok-canvas');
        ctx = cv.getContext('2d');
        stage = root.querySelector('.ok-stage');
        overEl = root.querySelector('.ok-over');
        msgEl = root.querySelector('.ok-msg');
        infoEl = root.querySelector('.ok-info');
        toolsEl = root.querySelector('.ok-tools');
        bindInput();
        ro = new ResizeObserver(() => { resize(); });
        ro.observe(stage);
        // minimised: a solo game waits
        mo = new MutationObserver(() => { if (winRef && winRef.win.style.display === 'none') autoPause(); });
        mo.observe(winRef.win, { attributes: true, attributeFilter: ['style'] });
        document.addEventListener('visibilitychange', onVisibility);
        const cleanup = winRef.win._cleanup;
        winRef.win._cleanup = () => {
            stopGame();
            cancelAnimationFrame(raf); raf = 0;
            if (ro) ro.disconnect();
            if (mo) mo.disconnect();
            document.removeEventListener('visibilitychange', onVisibility);
            winRef = null; root = null; G = null;
            if (cleanup) cleanup();
        };
        loadFaces();
        resize();
        loop();
        setTimeout(() => root && root.focus({ preventScroll: true }), 30);
        return true;
    }
    function loadFaces() {
        if (faces.size) return;
        BOT_NAMES.forEach(n => {
            const img = new Image();
            img.onload = () => { dirty = true; };
            img.src = 'src/emoj/' + n + (n === 'zirlak' ? '.gif' : '.png');
            faces.set(n, img);
        });
    }
    function onVisibility() { if (document.hidden) autoPause(); }
    function autoPause() { if (G && !G.online && !G.paused && !G.done) pause(true); }

    // ---------------------------------------------------------------
    // a game: G holds the match (on the host), the view this screen draws,
    // and everything that is only this screen's: the rack, the selection,
    // tiles in flight, the drag
    // ---------------------------------------------------------------
    function newG(o) {
        return {
            online: !!o.session, session: o.session || null, isHost: !o.session || !!o.isHost, me: o.me, m: o.m || null, v: null,
            seatIds: o.seatIds || [null, null, null, null], rack: new Array(SLOTS).fill(-1), sel: new Set(), cursor: 0,
            flyers: [], hide: new Set(), drag: null, paused: false, done: false, botAt: 0, turnAt: performance.now(), lastTurn: -1,
            n: 0, lastN: -1, msg: '', msgAt: 0, unsubs: [], handKey: '', resultAt: 0, nextAt: 0, hiAt: 0, lost: false, sentAct: 0
        };
    }
    function stopGame() {
        if (!G) return;
        G.unsubs.forEach(u => { try { u(); } catch (e) { } });
        G.unsubs = [];
        if (G.session && G.session.alive) { try { G.session.leave(); } catch (e) { } }
        G = null;
    }

    function startLocal(o) {
        mount();
        stopGame();
        const p = Object.assign(prefs(), o || {});
        writeJson(PREFS_KEY, { mode: p.mode, start: p.start, hands: p.hands, level: p.level });
        const me = typeof NP_NAME === 'function' ? NP_NAME() : myName();
        const seed = p.seed !== undefined ? p.seed >>> 0 : (Math.random() * 1e9) >>> 0;
        const names = shuffled(BOT_NAMES, seed);
        const m = S.newMatch({
            mode: p.mode, seed, start: p.start, hands: p.hands, dealer: p.dealer,
            seats: [{ name: me, bot: false }].concat([1, 2, 3].map(i => ({ name: names[i], bot: true, level: p.level })))
        });
        G = newG({ m, me: 0 });
        record(s => { s.matches++; });
        enterHand();
        save();
        hideOver();
    }
    function resumeLocal() {
        const sv = readJson(SAVE_KEY);
        if (!sv || !sv.m || !sv.m.hand || sv.m.over) return false;
        try { S.audit(sv.m); } catch (e) { removeKey(SAVE_KEY); return false; }
        mount();
        stopGame();
        G = newG({ m: sv.m, me: 0 });
        G.v = S.view(G.m, 0);
        if (Array.isArray(sv.rack) && sv.rack.length === SLOTS) G.rack = sv.rack.map(x => (Number.isInteger(x) ? x : -1));
        syncRack(true);
        G.handKey = G.m.seed + ':' + G.m.handNo;
        hideOver();
        if (G.v.result) showResult();
        refresh();
        return true;
    }
    function save() {
        if (!G || G.online || !G.m) return;
        if (G.m.over) { removeKey(SAVE_KEY); return; }
        writeJson(SAVE_KEY, { m: G.m, rack: G.rack });
    }
    function myName() {
        try { if (window.Netplay && Netplay.profile) return Netplay.profile().name || 'you'; } catch (e) { }
        return 'you';
    }
    function shuffled(a, seed) {
        const b = a.slice();
        let s = seed >>> 0;
        for (let i = b.length - 1; i > 0; i--) { s = S.hash(s, i); const j = s % (i + 1); [b[i], b[j]] = [b[j], b[i]]; }
        return b;
    }

    // a new hand on this screen: the rack sorted into runs to start with
    function enterHand() {
        if (G.m) G.v = S.view(G.m, G.me);
        G.rack.fill(-1);
        G.sel.clear();
        G.flyers.length = 0;
        G.hide.clear();
        G.done = false;
        if (G.m) G.handKey = G.m.seed + ':' + G.m.handNo;
        arrange('run');
        G.botAt = performance.now() + 900 / speed;
        G.turnAt = performance.now();
        say(G.v.turn === G.me ? 'you deal: you hold ' + G.v.hand.length + ' tiles, throw one to start' : seatName(G.v.dealer) + ' deals');
        hideOver();
        refresh();
        dirty = true;
    }

    // ---------------------------------------------------------------
    // the rack: which slot each of my tiles sits in
    // ---------------------------------------------------------------
    function syncRack(keepAll) {
        const hand = G.v.hand;
        const inHand = new Set(hand);
        for (let i = 0; i < SLOTS; i++) if (G.rack[i] >= 0 && !inHand.has(G.rack[i])) G.rack[i] = -1;
        const placed = new Set(G.rack.filter(x => x >= 0));
        for (const id of hand) {
            if (placed.has(id)) continue;
            let slot = -1;
            if (G.dropSlot >= 0 && G.rack[G.dropSlot] < 0) { slot = G.dropSlot; G.dropSlot = -1; }
            if (slot < 0) slot = G.rack.indexOf(-1);
            if (slot < 0) break;
            G.rack[slot] = id;
        }
        for (const id of [...G.sel]) if (!inHand.has(id)) G.sel.delete(id);
        void keepAll;
    }
    function arrange(bias) {
        const v = G.v;
        if (!v) return;
        const { melds, left } = S.sortedRack(v.hand, v.ok, bias);
        const cols = L ? L.cols : 15;
        const out = new Array(SLOTS).fill(-1);
        let i = 0;
        const total = v.hand.length + melds.length;
        const gaps = total <= SLOTS;
        for (const m of melds) {
            const col = i % cols;
            if (gaps && col + m.length > cols && m.length <= cols && i + (cols - col) + m.length <= SLOTS) i += cols - col;
            for (const id of m) out[i++] = id;
            if (gaps && i % cols !== 0) i++;
        }
        for (const id of left) { while (i < SLOTS && out[i] >= 0) i++; if (i < SLOTS) out[i++] = id; }
        // anything that did not fit goes in the first holes
        const placed = new Set(out.filter(x => x >= 0));
        for (const id of v.hand) if (!placed.has(id)) { const k = out.indexOf(-1); if (k >= 0) out[k] = id; }
        G.rack = out;
        dirty = true;
        if (!G.online) save();
    }
    function moveTile(from, to) {
        if (from === to || from < 0 || to < 0 || to >= SLOTS) return;
        const t = G.rack[to];
        G.rack[to] = G.rack[from];
        G.rack[from] = t;
        sfx.clack();
        dirty = true;
        if (!G.online) save();
    }

    // ---------------------------------------------------------------
    // moves: the host applies them, a guest asks the host
    // ---------------------------------------------------------------
    function act(a) {
        if (!G || !G.v || G.done) return;
        if (G.paused) { say('paused: resume first'); return; }
        if (G.isHost) {
            const r = hostApply(G.me, a);
            if (!r.ok) { say(r.err); sfx.bad(); }
        } else {
            if (!G.session || !G.session.alive) return;
            G.session.sendToHost('okey:act', { a });
            G.sentAct = performance.now();
        }
    }
    function hostApply(seat, a) {
        const m = G.m;
        const r = S.apply(m, seat, a);
        if (!r.ok) return r;
        G.v = S.view(m, G.me);
        onEvents(S.eventsFor(r.ev, G.me), G.v);
        broadcast(r.ev);
        G.botAt = performance.now() + (m.hand.turn === seat ? 520 : 700) / speed;
        if (m.hand.turn !== G.lastTurn) { G.lastTurn = m.hand.turn; G.turnAt = performance.now(); }
        save();
        return r;
    }
    function broadcast(ev, only) {
        if (!G.online || !G.isHost || !G.session) return;
        G.n++;
        G.seatIds.forEach((id, seat) => {
            if (!id || id === G.session.id || (only && only !== id)) return;
            G.session.send('okey:st', { n: G.n, hk: G.m.seed + ':' + G.m.handNo, v: S.view(G.m, seat), ev: ev ? S.eventsFor(ev, seat) : [] }, id);
        });
    }

    // what happened, as this screen shows it: tiles fly, sounds, words
    function onEvents(ev, v) {
        const before = new Map();
        if (L) for (let i = 0; i < SLOTS; i++) if (G.rack[i] >= 0) before.set(G.rack[i], slotRect(i));
        G.v = v;
        syncRack();
        const now = performance.now();
        for (const e of ev) {
            const mine = e.s === G.me;
            if (e.e === 'draw') {
                const from = e.from === 'pile' ? pileRect() : stackRect(S.prevSeat(e.s));
                if (mine) { const k = G.rack.indexOf(e.tile); if (k >= 0) fly(e.tile, from, slotRect(k), now); }
                else fly(e.from === 'disc' ? e.tile : -1, from, badgeRect(e.s), now);
                sfx.draw();
            } else if (e.e === 'disc' || e.e === 'return') {
                const src = mine ? before.get(e.tile) || rackCentre() : badgeRect(e.s);
                const to = e.e === 'return' ? stackRect(S.prevSeat(e.s)) : stackRect(e.s);
                fly(e.tile, src, to, now);
                sfx.clack();
            } else if (e.e === 'meld') {
                e.melds.forEach((mm, k) => mm.forEach((id, j) => fly(id, mine ? before.get(id) || rackCentre() : badgeRect(e.s), meldTileRect(e.from + k, j) || feltCentre(), now + j * 30)));
                say((mine ? 'you' : seatName(e.s)) + ' laid down ' + e.melds.length + (e.melds.length === 1 ? ' meld' : ' melds'));
                sfx.clack();
            } else if (e.e === 'open') {
                say((mine ? 'you open' : seatName(e.s) + ' opens') + (e.pairs ? ' with pairs' : ' with ' + e.value + ' points'));
            } else if (e.e === 'layoff') {
                fly(e.tile, mine ? before.get(e.tile) || rackCentre() : badgeRect(e.s), feltCentre(), now);
                sfx.clack();
            } else if (e.e === 'show') {
                say((mine ? 'you show' : seatName(e.s) + ' shows') + " the indicator's twin" + (v.mode === 'classic' ? ': everybody else -1' : ': -101 for them'));
                sfx.turn();
            } else if (e.e === 'pen') {
                say((mine ? 'you' : seatName(e.s)) + ' ' + e.why + ': +' + e.pts);
                sfx.bad();
            } else if (e.e === 'finish') {
                const t = e.kind === 'pairs' ? 'seven pairs' : 'okey';
                say((mine ? 'you finish' : seatName(e.s) + ' finishes') + (e.okey ? ' throwing the okey!' : '!') + (v.mode === 'classic' ? ' (' + t + ')' : ''));
                const k = before.get(e.tile);
                if (mine && k) fly(e.tile, k, indRect(), now);
            } else if (e.e === 'end') {
                G.done = true;
                G.resultAt = now + 900 / speed;
                handOver(e.r);
            } else if (e.e === 'deal') {
                // a new hand from the host
            }
        }
        if (v.turn === G.me && v.phase === 'draw' && !v.result && !ev.some(e => e.e === 'return')) sfx.turn();
        refresh();
        dirty = true;
    }
    function fly(id, a, b, t0) {
        if (!a || !b) return;
        if (id >= 0) G.hide.add(id);
        G.flyers.push({ id, x0: a.x, y0: a.y, w0: a.w, h0: a.h, x1: b.x, y1: b.y, w1: b.w, h1: b.h, t0, dur: 260 / speed });
    }

    function handOver(r) {
        const me = G.me;
        if (me < 0) return;
        record(s => {
            s.hands++;
            if (r.winner === me) { s.handWins++; if (r.okey) s.okeyWins++; if (r.how === 'pairs') s.pairWins++; }
            if (r.matchOver) { if (r.matchWinner === me) s.wins++; if (G.online) s.online++; }
        });
        if (r.matchOver) (r.matchWinner === me ? sfx.win : sfx.lose)();
        else if (r.winner === me) sfx.win();
        if (G.m && r.matchOver && !G.online) removeKey(SAVE_KEY);
        if (G.online && G.isHost && !r.matchOver) G.nextAt = performance.now() + 15000;
    }

    function nextHand() {
        if (!G) return;
        if (!G.isHost) { say('waiting for the host to deal'); return; }
        if (!G.m.hand.result) return;
        if (G.m.over) { if (!G.online) startLocal(); return; }
        S.nextHand(G.m);
        G.lastTurn = -1;
        enterHand();
        broadcast([{ e: 'deal' }]);
        save();
    }

    // ---------------------------------------------------------------
    // the frame: bots on the host, the turn clock online, then the picture
    // ---------------------------------------------------------------
    function loop() {
        raf = requestAnimationFrame(loop);
        if (!G || !ctx) { if (dirty) draw(); return; }
        const now = performance.now();
        if (G.isHost && G.m && !G.paused) hostTick(now);
        if (!G.isHost && G.online && G.v === null && now > G.hiAt) { G.hiAt = now + 2000; G.session.sendToHost('okey:hi', {}); }
        if (G.done && G.resultAt && now >= G.resultAt) { G.resultAt = 0; showResult(); }
        if (G.flyers.length) {
            for (let i = G.flyers.length - 1; i >= 0; i--) {
                const f = G.flyers[i];
                if (now - f.t0 >= f.dur) { G.flyers.splice(i, 1); if (f.id >= 0 && !G.flyers.some(o => o.id === f.id)) G.hide.delete(f.id); }
            }
            dirty = true;
        }
        if (G.online && G.v && !G.v.result && (now - G.turnAt) > TURN_LIMIT - 20000 && floor(now / 1000) !== G.clockShown) { G.clockShown = floor(now / 1000); refreshStatus(); }
        if (dirty) draw();
    }
    function hostTick(now) {
        const m = G.m, h = m.hand;
        if (h.result) {
            if (G.online && G.nextAt && now >= G.nextAt && !m.over) { G.nextAt = 0; nextHand(); }
            return;
        }
        const seat = h.turn;
        const isBot = m.seats[seat].bot;
        const late = G.online && !isBot && now - G.turnAt > TURN_LIMIT;
        if ((isBot || late) && now >= G.botAt && !G.flyers.length) {
            const a = S.botAct(m, seat);
            const r = a ? hostApply(seat, a) : { ok: false };
            if (!r.ok) {
                // never stall: whatever the bot wanted, a plain draw and throw always works
                const mine = h.hands[seat];
                hostApply(seat, h.phase === 'draw' ? (h.pile.length ? { t: 'draw' } : { t: 'take' }) : (h.took >= 0 && mine.includes(h.took) ? { t: 'return' } : { t: 'discard', tile: mine.find(x => !S.isWild(x, h.ok)) ?? mine[0] }));
            }
            if (late) { G.turnAt = now - TURN_LIMIT + 4000; if (seat === G.me) say('too slow: a move was made for you'); }
        }
    }

    // ---------------------------------------------------------------
    // layout: everything the picture and the pointer agree on
    // ---------------------------------------------------------------
    function resize() {
        if (!stage || !cv) return;
        const w = stage.clientWidth, h = stage.clientHeight;
        if (!w || !h) return;
        dpr = min(2, window.devicePixelRatio || 1);
        cv.width = round(w * dpr); cv.height = round(h * dpr);
        const oldCols = L ? L.cols : 15;
        L = layout(w, h);
        if (G && L.cols !== oldCols) dirty = true;
        dirty = true;
    }
    function layout(W, H) {
        const narrow = W < 560;
        const cols = narrow ? 10 : 15, rows = narrow ? 3 : 2;
        const slotW = min(56, (W - 10) / cols);
        let tw = slotW - 3;
        let th = round(tw * 1.38);
        const maxRack = H * 0.48;
        if (rows * (th + 4) + 12 > maxRack) { th = floor((maxRack - 12) / rows - 4); tw = round(th / 1.38); }
        const slotH = th + 4;
        const rackH = rows * slotH + 12;
        const rackY = H - rackH;
        const rackX = (W - cols * slotW) / 2;
        const stripH = narrow ? 38 : 42;
        const bw = (W - 16) / 3;
        const fy = stripH, fh = rackY - stripH;
        const st = max(16, min(tw * 0.95, fh * 0.26, 46)), sth = round(st * 1.38);
        const pad = 6;
        const corners = {
            TL: { x: pad, y: fy + pad + 12, w: st, h: sth }, TR: { x: W - pad - st, y: fy + pad + 12, w: st, h: sth },
            BL: { x: pad, y: rackY - pad - sth, w: st, h: sth }, BR: { x: W - pad - st, y: rackY - pad - sth, w: st, h: sth }
        };
        const ct = max(18, min(st * 1.15, 52)), cth = round(ct * 1.38);
        const centre = G && G.v && G.v.mode === '101'
            ? { pile: { x: W / 2 - ct - 5, y: rackY - pad - cth, w: ct, h: cth }, ind: { x: W / 2 + 5, y: rackY - pad - cth, w: ct, h: cth } }
            : { pile: { x: W / 2 - ct - 8, y: fy + fh / 2 - cth / 2, w: ct, h: cth }, ind: { x: W / 2 + 8, y: fy + fh / 2 - cth / 2, w: ct, h: cth } };
        const meldArea = { x: pad + st + 10, y: fy + 6, w: W - 2 * (pad + st + 10), h: rackY - pad - cth - 8 - (fy + 6) };
        return { W, H, narrow, cols, rows, slotW, slotH, tw, th, rackY, rackX, rackH, stripH, bw, fy, fh, st, sth, corners, centre, meldArea, melds: [] };
    }
    const rel = seat => (seat - (G && G.me >= 0 ? G.me : 0) + 4) % 4;
    function slotRect(i) {
        const r = floor(i / L.cols), c = i % L.cols;
        return { x: L.rackX + c * L.slotW + 1.5, y: L.rackY + 8 + r * L.slotH, w: L.tw, h: L.th };
    }
    function slotAt(x, y) {
        if (y < L.rackY || x < L.rackX || x > L.rackX + L.cols * L.slotW) return -1;
        const r = floor((y - L.rackY - 6) / L.slotH), c = floor((x - L.rackX) / L.slotW);
        if (r < 0 || r >= L.rows || c < 0 || c >= L.cols) return -1;
        return r * L.cols + c;
    }
    function stackRect(seat) { return L.corners[['BR', 'TR', 'TL', 'BL'][rel(seat)]]; }
    function badgeRect(seat) {
        const r = rel(seat);
        if (r === 0) return rackCentre();
        const i = r === 3 ? 0 : r === 2 ? 1 : 2;
        return { x: 4 + i * (L.bw + 4), y: 4, w: L.bw, h: L.stripH - 8 };
    }
    const rackCentre = () => ({ x: L.W / 2 - L.tw / 2, y: L.rackY + 8, w: L.tw, h: L.th });
    const feltCentre = () => ({ x: L.W / 2 - L.st / 2, y: L.fy + L.fh / 2 - L.sth / 2, w: L.st, h: L.sth });
    const pileRect = () => L.centre.pile;
    const indRect = () => L.centre.ind;
    const inside = (r, x, y, grow) => r && x >= r.x - (grow || 0) && x <= r.x + r.w + (grow || 0) && y >= r.y - (grow || 0) && y <= r.y + r.h + (grow || 0);
    // the 101 table: melds flow left to right, shrinking until they fit
    function layoutMelds() {
        const t = G && G.v ? G.v.table : [];
        L.melds = [];
        if (!t.length) return;
        const A = L.meldArea;
        let mt = min(30, L.st * 0.8);
        for (; mt >= 9; mt -= 1) {
            const mh = round(mt * 1.38), gap = max(4, mt * 0.45);
            let x = A.x, y = A.y, okFit = true;
            const out = [];
            for (const m of t) {
                const w = m.tiles.length * (mt + 1);
                if (x + w > A.x + A.w && x > A.x) { x = A.x; y += mh + 5; }
                out.push({ x, y, w, h: mh, mt });
                x += w + gap;
            }
            if (y + mh > A.y + A.h) okFit = false;
            if (okFit || mt <= 9) { L.melds = out; return; }
        }
    }
    function meldTileRect(i, j) {
        layoutMelds();
        const r = L.melds[i];
        return r ? { x: r.x + j * (r.mt + 1), y: r.y, w: r.mt, h: r.h } : null;
    }
    function meldAt(x, y) { for (let i = 0; i < L.melds.length; i++) if (inside(L.melds[i], x, y, 3)) return i; return -1; }

    // ---------------------------------------------------------------
    // the picture
    // ---------------------------------------------------------------
    function roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
        c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
        c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
        c.closePath();
    }
    // one tile. o: back, sel, wild (gold edge), dim, cursor
    function drawTile(c, x, y, w, h, id, o) {
        o = o || {};
        const r = max(2, w * 0.12);
        c.fillStyle = 'rgba(0,0,0,.35)';
        roundRect(c, x + 1.5, y + 2, w, h, r); c.fill();
        if (o.back) {
            c.fillStyle = '#e8dcb0'; roundRect(c, x, y, w, h, r); c.fill();
            c.fillStyle = '#b89a50'; roundRect(c, x + w * 0.18, y + h * 0.15, w * 0.64, h * 0.7, r * 0.6); c.fill();
            c.strokeStyle = '#7a6430'; c.lineWidth = 1; roundRect(c, x + 0.5, y + 0.5, w - 1, h - 1, r); c.stroke();
            return;
        }
        const g = c.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, o.sel ? '#fff6b0' : '#fffdf2'); g.addColorStop(1, o.sel ? '#f0d870' : '#efe4c0');
        c.fillStyle = g; roundRect(c, x, y, w, h, r); c.fill();
        c.lineWidth = o.wild ? max(2, w * 0.07) : 1;
        c.strokeStyle = o.wild ? '#e0a800' : '#8a7a50';
        roundRect(c, x + 0.5, y + 0.5, w - 1, h - 1, r); c.stroke();
        if (S.isFalse(id)) {
            c.fillStyle = '#0a7a3a';
            star(c, x + w / 2, y + h * 0.42, w * 0.3);
            c.font = 'bold ' + round(w * 0.26) + 'px Tahoma, sans-serif';
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText('joker', x + w / 2, y + h * 0.8, w - 2);
        } else {
            const col = INK[S.colorOf(id)];
            c.fillStyle = col;
            c.font = 'bold ' + round(w * 0.6) + 'px Tahoma, "Arial Black", sans-serif';
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText(String(S.numOf(id)), x + w / 2, y + h * 0.4);
            c.beginPath(); c.arc(x + w / 2, y + h * 0.77, max(1.5, w * 0.1), 0, Math.PI * 2); c.fill();
            if (o.wild) { c.fillStyle = '#e0a800'; star(c, x + w * 0.8, y + h * 0.13, w * 0.13); }
        }
        if (o.dim) { c.fillStyle = 'rgba(40,40,40,.35)'; roundRect(c, x, y, w, h, r); c.fill(); }
    }
    function star(c, cx, cy, r) {
        c.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        c.closePath(); c.fill();
    }
    function bevel(c, x, y, w, h, inset) {
        c.fillStyle = '#c0c0c0'; c.fillRect(x, y, w, h);
        c.fillStyle = inset ? '#808080' : '#fff'; c.fillRect(x, y, w, 1); c.fillRect(x, y, 1, h);
        c.fillStyle = inset ? '#fff' : '#404040'; c.fillRect(x, y + h - 1, w, 1); c.fillRect(x + w - 1, y, 1, h);
    }
    function text(c, s, x, y, size, color, align, bold, maxW) {
        c.font = (bold ? 'bold ' : '') + size + 'px Tahoma, "MS Sans Serif", sans-serif';
        c.fillStyle = color; c.textAlign = align || 'left'; c.textBaseline = 'middle';
        c.fillText(s, x, y, maxW);
    }

    function draw() {
        dirty = false;
        if (!ctx || !L) return;
        const c = ctx;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const { W, H } = L;
        // felt
        const g = c.createRadialGradient(W / 2, L.fy + L.fh / 2, 10, W / 2, L.fy + L.fh / 2, max(W, L.fh));
        g.addColorStop(0, '#1a7a48'); g.addColorStop(1, '#0b4d2b');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        c.fillStyle = '#c0c0c0'; c.fillRect(0, 0, W, L.stripH);
        c.fillStyle = '#808080'; c.fillRect(0, L.stripH - 1, W, 1);
        if (!G || !G.v) {
            text(c, 'okey 98', W / 2, L.fy + L.fh / 2, 28, '#e8ffe8', 'center', true);
            drawRack(c, true);
            return;
        }
        const v = G.v;
        L.centre = layout(W, H).centre;
        // opponents along the top
        for (let s = 0; s < 4; s++) if (rel(s) !== 0 || G.me < 0) drawBadge(c, s);
        // discard stacks in the corners, with the name of whose they are
        for (let s = 0; s < 4; s++) drawStack(c, s);
        // pile and indicator
        const P = pileRect(), I = indRect();
        if (v.pile > 0) {
            for (let k = min(3, v.pile - 1); k >= 0; k--) drawTile(c, P.x - k * 1.5, P.y - k * 1.5, P.w, P.h, 0, { back: true });
            text(c, String(v.pile), P.x + P.w / 2, P.y + P.h + 9, 11, '#e8ffe8', 'center', true);
        } else text(c, 'empty', P.x + P.w / 2, P.y + P.h / 2, 11, '#e8ffe8', 'center');
        drawTile(c, I.x, I.y, I.w, I.h, v.ind, {});
        text(c, 'okey: ' + COLOR_NAMES[v.ok.c] + ' ' + v.ok.n, I.x + I.w / 2, I.y + I.h + 9, 11, '#ffe680', 'center', true);
        if (v.mode === 'classic' && G.drag && G.drag.kind === 'rack' && G.drag.moved && myPlay()) {
            c.strokeStyle = '#ffe680'; c.setLineDash([4, 3]); c.lineWidth = 2;
            c.strokeRect(I.x - 6, I.y - 6, I.w + 12, I.h + 12); c.setLineDash([]);
            text(c, 'drop here to finish', I.x + I.w / 2, I.y - 14, 11, '#ffe680', 'center', true);
        }
        // the 101 table
        if (v.mode === '101') {
            layoutMelds();
            v.table.forEach((m, i) => {
                const r = L.melds[i];
                if (!r) return;
                const hot = G.drag && G.drag.kind === 'rack' && G.drag.moved && G.drag.over === 'meld' + i;
                if (hot) { c.fillStyle = 'rgba(255,230,128,.35)'; c.fillRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6); }
                m.tiles.forEach((id, j) => { if (!G.hide.has(id)) drawTile(c, r.x + j * (r.mt + 1), r.y, r.mt, r.h, id, { wild: S.isWild(id, v.ok) }); });
            });
            if (!v.table.length) text(c, 'open with 101 points of runs and groups, or five pairs', W / 2, L.meldArea.y + L.meldArea.h / 2, 12, 'rgba(232,255,232,.7)', 'center', false, L.meldArea.w);
        }
        // whose turn
        const tr = rel(v.turn);
        if (!v.result) {
            if (tr === 0) text(c, v.phase === 'draw' ? 'your turn: draw' : 'your turn: throw', W / 2, L.rackY - 9, 12, '#ffe680', 'center', true);
        }
        drawRack(c, false);
        // tiles in flight
        const now = performance.now();
        for (const f of G.flyers) {
            let k = (now - f.t0) / f.dur;
            if (k < 0) continue;
            k = min(1, k); k = 1 - (1 - k) * (1 - k);
            const x = f.x0 + (f.x1 - f.x0) * k, y = f.y0 + (f.y1 - f.y0) * k - Math.sin(k * Math.PI) * 18;
            const w = f.w0 + (f.w1 - f.w0) * k, h = f.h0 + (f.h1 - f.h0) * k;
            drawTile(c, x, y, w, h, max(0, f.id), { back: f.id < 0, wild: f.id >= 0 && S.isWild(f.id, v.ok) });
        }
        // the dragged tile on top of everything
        const d = G.drag;
        if (d && d.moved) {
            if (d.kind === 'rack') drawTile(c, d.x - L.tw / 2, d.y - L.th / 2, L.tw, L.th, d.id, { wild: S.isWild(d.id, v.ok), sel: true });
            else drawTile(c, d.x - L.tw / 2, d.y - L.th / 2, L.tw, L.th, d.id >= 0 ? d.id : 0, { back: d.id < 0 });
        }
        if (G.paused) {
            c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, W, H);
        }
    }
    function drawBadge(c, s) {
        const v = G.v, r = badgeRect(s), st = v.seats[s];
        const turn = v.turn === s && !v.result;
        bevel(c, r.x, r.y, r.w, r.h, turn);
        if (turn) { c.fillStyle = '#000080'; c.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4); }
        const ink = turn ? '#fff' : '#000';
        const img = st.bot ? faces.get(st.name.replace(' (bot)', '')) : null;
        let x = r.x + 5;
        const sz = r.h - 8;
        if (img && img.complete && img.naturalWidth) { c.drawImage(img, x, r.y + 4, sz, sz); x += sz + 4; }
        else { c.fillStyle = ['#d01818', '#c07800', '#1050d0', '#151515'][s]; c.fillRect(x, r.y + r.h / 2 - 4, 8, 8); x += 12; }
        const score = v.mode === 'classic' ? st.score + ' pts' : st.score + (st.pen ? (st.pen > 0 ? ' +' : ' ') + st.pen : '');
        const small = L.narrow ? 10 : 11;
        text(c, st.name + (s === v.dealer ? ' ·d' : ''), x, r.y + r.h * 0.32, small, ink, 'left', true, r.w - (x - r.x) - 4);
        text(c, st.count + ' tiles · ' + score + (st.opened ? ' · open' : ''), x, r.y + r.h * 0.72, small - 1, turn ? '#e0e0ff' : '#303030', 'left', false, r.w - (x - r.x) - 4);
    }
    function drawStack(c, s) {
        const v = G.v, r = stackRect(s);
        const n = v.discardCounts[s];
        const takeable = rel(s) === 3 && G.v.turn === G.me && v.phase === 'draw' && !v.result && n > 0;
        c.strokeStyle = takeable ? '#ffe680' : 'rgba(255,255,255,.35)';
        c.setLineDash([3, 3]); c.lineWidth = takeable ? 2 : 1;
        c.strokeRect(r.x - 2.5, r.y - 2.5, r.w + 5, r.h + 5); c.setLineDash([]);
        const label = rel(s) === 0 ? 'you throw here' : rel(s) === 3 ? 'take' : '';
        const top = v.discards[s];
        if (n) {
            const id = top[top.length - 1];
            const vis = top.filter(x => !G.hide.has(x));
            const show = vis.length ? vis[vis.length - 1] : -1;
            if (n > 1) drawTile(c, r.x + 2, r.y - 3, r.w, r.h, top[max(0, top.length - 2)], { dim: true });
            if (show >= 0) {
                const face = v.finished === show;
                drawTile(c, r.x, r.y, r.w, r.h, show, { back: face, wild: !face && S.isWild(show, v.ok) });
            }
            void id;
        }
        const ly = r.y < L.fy + L.fh / 2 ? r.y - 9 : r.y + r.h + 9;
        const al = r.x < L.W / 2 ? 'left' : 'right';
        const lx = al === 'left' ? r.x - 2 : r.x + r.w + 2;
        const who = rel(s) === 0 ? 'yours' : v.seats[s].name;
        text(c, (label || who) + (n ? ' (' + n + ')' : ''), lx, ly, 10, takeable ? '#ffe680' : '#cfe8d8', al, takeable, L.W / 3);
    }
    function drawRack(c, empty) {
        // the wooden rack
        const x = L.rackX - 4, y = L.rackY + 2, w = L.cols * L.slotW + 8, h = L.rackH - 4;
        const g = c.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, '#a8743c'); g.addColorStop(1, '#6e4520');
        c.fillStyle = g; roundRect(c, x, y, w, h, 6); c.fill();
        c.fillStyle = 'rgba(0,0,0,.25)';
        for (let r = 0; r < L.rows; r++) c.fillRect(x + 4, L.rackY + 8 + r * L.slotH + L.th + 1, w - 8, 2);
        if (empty || !G || !G.v) return;
        const v = G.v, d = G.drag;
        for (let i = 0; i < SLOTS; i++) {
            const id = G.rack[i];
            const r = slotRect(i);
            if (d && d.moved && d.over === 'slot' + i) { c.fillStyle = 'rgba(255,240,160,.4)'; c.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2); }
            if (id >= 0 && !G.hide.has(id) && !(d && d.moved && d.kind === 'rack' && d.id === id)) {
                const sel = G.sel.has(id);
                drawTile(c, r.x, r.y - (sel ? 5 : 0), r.w, r.h, id, { sel, wild: S.isWild(id, v.ok) });
            }
            if (G.kbd && i === G.cursor) {
                c.strokeStyle = '#fff'; c.setLineDash([2, 2]); c.lineWidth = 1.5;
                c.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); c.setLineDash([]);
            }
        }
    }

    // ---------------------------------------------------------------
    // the pointer: drag tiles around the rack, onto the corner to throw,
    // onto the indicator to finish, onto a meld to add to it; drag (or
    // click) the pile or the stack on your left to draw
    // ---------------------------------------------------------------
    const myTurn = () => G && G.v && !G.v.result && G.v.turn === G.me && !G.paused;
    const myDraw = () => myTurn() && G.v.phase === 'draw';
    const myPlay = () => myTurn() && G.v.phase === 'play';
    function pointerPos(e) { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) * (L.W / b.width), y: (e.clientY - b.top) * (L.H / b.height) }; }
    function bindInput() {
        cv.addEventListener('pointerdown', e => {
            if (!G || !G.v || !L) return;
            root.focus({ preventScroll: true });
            G.kbd = false;
            const p = pointerPos(e);
            const slot = slotAt(p.x, p.y);
            let d = null;
            if (slot >= 0 && G.rack[slot] >= 0) d = { kind: 'rack', id: G.rack[slot], from: slot };
            else if (inside(pileRect(), p.x, p.y, 4)) d = { kind: 'pile', id: -1 };
            else if (inside(stackRect(S.prevSeat(G.me)), p.x, p.y, 4) && G.v.discardCounts[S.prevSeat(G.me)]) { const t = G.v.discards[S.prevSeat(G.me)]; d = { kind: 'take', id: t[t.length - 1] }; }
            else if (G.v.mode === '101') { const mi = meldAt(p.x, p.y); if (mi >= 0) d = { kind: 'meld', meld: mi }; }
            if (!d) return;
            d.sx = p.x; d.sy = p.y; d.x = p.x; d.y = p.y; d.moved = false; d.pid = e.pointerId;
            G.drag = d;
            try { cv.setPointerCapture(e.pointerId); } catch (err) { }
            e.preventDefault();
        });
        cv.addEventListener('pointermove', e => {
            const d = G && G.drag;
            if (!d || e.pointerId !== d.pid) return;
            const p = pointerPos(e);
            d.x = p.x; d.y = p.y;
            if (!d.moved && abs(p.x - d.sx) + abs(p.y - d.sy) > 6 && d.kind !== 'meld') d.moved = true;
            if (d.moved) { d.over = dropTarget(p.x, p.y, d); dirty = true; }
        });
        const end = e => {
            const d = G && G.drag;
            if (!d || e.pointerId !== d.pid) return;
            G.drag = null;
            dirty = true;
            if (e.type === 'pointercancel') return;
            const p = pointerPos(e);
            if (!d.moved) return click(d);
            const t = dropTarget(p.x, p.y, d) || '';
            if (d.kind === 'rack') {
                if (t.startsWith('slot')) moveTile(d.from, +t.slice(4));
                else if (t === 'throw') act({ t: 'discard', tile: d.id });
                else if (t === 'finish') act({ t: 'finish', tile: d.id });
                else if (t.startsWith('meld')) act({ t: 'layoff', tile: d.id, meld: +t.slice(4) });
            } else if (d.kind === 'pile' || d.kind === 'take') {
                if (t.startsWith('slot') && G.rack[+t.slice(4)] < 0) G.dropSlot = +t.slice(4);
                if (t.startsWith('slot') || t === 'rack') act({ t: d.kind === 'pile' ? 'draw' : 'take' });
            }
        };
        cv.addEventListener('pointerup', end);
        cv.addEventListener('pointercancel', end);
        root.addEventListener('keydown', onKey);
        toolsEl.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) tool(b.dataset.act); });
        overEl.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) tool(b.dataset.act, b); });
    }
    function dropTarget(x, y, d) {
        const s = slotAt(x, y);
        if (s >= 0) return 'slot' + s;
        if (d.kind !== 'rack') return y > L.rackY ? 'rack' : '';
        if (inside(stackRect(G.me), x, y, 14)) return 'throw';
        if (G.v.mode === 'classic' && inside(indRect(), x, y, 12)) return 'finish';
        if (G.v.mode === '101') { const mi = meldAt(x, y); if (mi >= 0) return 'meld' + mi; }
        return '';
    }
    function click(d) {
        if (d.kind === 'rack') {
            if (G.sel.has(d.id)) G.sel.delete(d.id);
            else { if (G.v.mode === 'classic') G.sel.clear(); G.sel.add(d.id); }
            G.cursor = d.from;
            sfx.clack();
            refresh();
        } else if (d.kind === 'pile') act({ t: 'draw' });
        else if (d.kind === 'take') act({ t: 'take' });
        else if (d.kind === 'meld') {
            if (G.sel.size === 1) act({ t: 'layoff', tile: [...G.sel][0], meld: d.meld });
            else say('select one tile, then click the meld to add it');
        }
        dirty = true;
    }

    // ---------------------------------------------------------------
    // the keyboard
    // ---------------------------------------------------------------
    function onKey(e) {
        if (!G || !G.v || e.target.closest('input,select,textarea')) return;
        const k = e.key;
        if ((k === ' ' || k === 'Enter') && e.target.closest('button')) return;
        if (!overEl.hidden) {
            if (k === 'Escape' && G.paused) { resume(); e.preventDefault(); }
            return;
        }
        const cols = L ? L.cols : 15;
        let handled = true;
        const moveCur = (dx) => {
            const to = (G.cursor + dx + SLOTS) % SLOTS;
            if (e.shiftKey) { if (G.rack[G.cursor] >= 0) moveTile(G.cursor, to); }
            G.cursor = to;
        };
        if (k === 'ArrowLeft') moveCur(-1);
        else if (k === 'ArrowRight') moveCur(1);
        else if (k === 'ArrowUp') moveCur(-cols);
        else if (k === 'ArrowDown') moveCur(cols);
        else if (k === ' ') { const id = G.rack[G.cursor]; if (id >= 0) click({ kind: 'rack', id, from: G.cursor }); }
        else if (k === 'd' || k === 'D') act({ t: 'draw' });
        else if (k === 't' || k === 'T') act({ t: 'take' });
        else if (k === 'Enter' || k === 'x' || k === 'X') tool('throw');
        else if (k === 'f' || k === 'F') tool('finish');
        else if (k === 's' || k === 'S') tool('sortrun');
        else if (k === 'g' || k === 'G') tool('sortgroup');
        else if (k === 'l' || k === 'L') tool('lay');
        else if (k === 'b' || k === 'B') tool('back');
        else if (k === 'i' || k === 'I') tool('show');
        else if (k === 'p' || k === 'P' || k === 'Escape') tool('pause');
        else if (k === 'h' || k === 'H' || k === '?') tool('help');
        else handled = false;
        if (handled) { G.kbd = true; e.preventDefault(); e.stopPropagation(); dirty = true; }
    }
    // the tile a button means: the selected one, or the one under the keyboard cursor
    function chosen() {
        if (G.sel.size === 1) return [...G.sel][0];
        if (G.kbd && G.rack[G.cursor] >= 0) return G.rack[G.cursor];
        return -1;
    }

    // ---------------------------------------------------------------
    // buttons
    // ---------------------------------------------------------------
    function tool(a, btn) {
        switch (a) {
            case 'draw': act({ t: 'draw' }); break;
            case 'take': act({ t: 'take' }); break;
            case 'throw': { const id = chosen(); if (id < 0) { say('pick a tile to throw first'); sfx.bad(); } else act({ t: 'discard', tile: id }); break; }
            case 'finish': { const id = chosen(); if (id < 0) { say('pick the tile to finish on (it goes face down)'); sfx.bad(); } else act({ t: 'finish', tile: id }); break; }
            case 'show': act({ t: 'show' }); break;
            case 'back': act({ t: 'return' }); break;
            case 'lay': {
                const v = G.v;
                const ids = [...G.sel];
                if (!ids.length) { say('select the tiles to lay down'); sfx.bad(); break; }
                const pairs = v.seats[G.me].opened === 'pairs' || (!v.seats[G.me].opened && ids.length % 2 === 0 && S.splitMelds(ids, v.ok, true) && !S.splitMelds(ids, v.ok, false));
                const melds = S.splitMelds(ids, v.ok, pairs);
                if (!melds) { say("those tiles don't make runs, groups or pairs"); sfx.bad(); break; }
                act({ t: 'meld', melds });
                break;
            }
            case 'sortrun': arrange('run'); say('sorted: runs first'); break;
            case 'sortgroup': arrange('group'); say('sorted: groups first'); break;
            case 'pause': if (G.paused) resume(); else pause(false); break;
            case 'resume': resume(); break;
            case 'help': showHelp(); break;
            case 'closehelp':
                if (helpBack) { helpBack = null; showMenu(); }
                else if (G && G.helpPaused) { G.helpPaused = false; resume(); }
                else if (G && G.v && !G.done) { if (G.paused) showPause(); else hideOver(); }
                else if (G && G.v && G.done) showResult();
                else showMenu();
                break;
            case 'menu': showMenu(); break;
            case 'next': nextHand(); break;
            case 'again': startLocal(); break;
            case 'deal': startLocal(); break;
            case 'continue': resumeLocal(); break;
            case 'online': openLobby(); break;
            case 'leave': stopGame(); showMenu(); break;
            case 'opt': {
                const p = prefs();
                const k = btn.dataset.k, val = btn.dataset.v;
                p[k] = k === 'start' || k === 'hands' ? +val : val;
                writeJson(PREFS_KEY, p);
                showMenu();
                break;
            }
        }
        refresh();
        dirty = true;
    }
    function openLobby() {
        if (typeof openNetplay === 'function') openNetplay({ gameId: 'okey' });
        else if (window.Netplay) Netplay.openLobby({ gameId: 'okey' });
    }
    function pause(auto) {
        if (!G || G.online) { if (G && G.online && !auto) say("online games don't pause: the table waits a minute for you"); return; }
        G.paused = true;
        showPause();
        dirty = true;
    }
    function resume() {
        if (!G) return;
        G.paused = false;
        G.botAt = performance.now() + 500 / speed;
        hideOver();
        root.focus({ preventScroll: true });
        dirty = true;
    }

    // ---------------------------------------------------------------
    // the status line and the buttons, from the view
    // ---------------------------------------------------------------
    function say(s) { if (G) { G.msg = s; G.msgAt = performance.now(); } refreshStatus(); }
    const seatName = s => (G && G.v ? (s === G.me ? 'you' : G.v.seats[s].name) : '');
    function refreshStatus() {
        if (!msgEl) return;
        if (!G || !G.v) { msgEl.textContent = 'okey 98'; infoEl.textContent = ''; return; }
        const v = G.v;
        let s;
        const fresh = G.msg && performance.now() - G.msgAt < 3500;
        if (v.result) s = G.msg || 'hand over';
        else if (v.turn === G.me) {
            const what = v.phase === 'draw' ? 'draw from the pile, or take ' + v.seats[S.prevSeat(G.me)].name + "'s tile" : (v.mode === 'classic' ? 'throw a tile to the right corner, or drop one on the indicator to finish' : (v.took >= 0 ? 'use the tile you took, or put it back' : 'lay down, add to melds, then throw a tile'));
            s = (fresh ? G.msg + ' · ' : '') + 'your turn: ' + what;
        } else s = fresh ? G.msg : v.seats[v.turn].name + (v.seats[v.turn].bot ? ' is thinking...' : "'s turn");
        if (G.online && !v.result) {
            const left = Math.ceil((TURN_LIMIT - (performance.now() - G.turnAt)) / 1000);
            if (G.isHost && left <= 20 && left >= 0) s += ' (' + left + 's)';
        }
        msgEl.textContent = s;
        msgEl.classList.toggle('ok-mine', v.turn === G.me && !v.result);
        infoEl.textContent = (v.mode === 'classic' ? 'classic · you: ' + v.seats[Math.max(0, G.me)].score + ' pts' : '101 · hand ' + (v.handNo + 1) + '/' + v.hands + ' · you: ' + v.seats[Math.max(0, G.me)].score) + (G.online ? ' · online' : '');
    }
    function refresh() {
        refreshStatus();
        if (!toolsEl) return;
        if (!G || !G.v) { toolsEl.innerHTML = ''; return; }
        const v = G.v, me = G.me;
        const is101 = v.mode === '101';
        const hasTwin = v.hand.some(id => S.isTwin(id, v.ind));
        const canShow = myTurn() && !v.acted[me] && !v.seats[me].shown && hasTwin;
        const prev = S.prevSeat(me);
        const btns = [
            ['draw', 'draw', myDraw() && v.pile > 0, myDraw()],
            ['take', 'take', myDraw() && v.discardCounts[prev] > 0 && !v.mustDraw, false],
            ['throw', 'throw', myPlay() && (G.sel.size === 1 || G.kbd), myPlay()],
            is101 ? ['lay', 'lay down', myPlay() && G.sel.size >= 2, false] : ['finish', 'finish', myPlay() && (G.sel.size === 1 || G.kbd), false],
            is101 && v.took >= 0 ? ['back', 'put back', myPlay(), false] : null,
            canShow ? ['show', 'show twin', true, true] : null,
            ['sortrun', 'sort runs', true, false],
            ['sortgroup', 'sort groups', true, false],
            ['spacer'],
            [G.online ? 'leave' : 'pause', G.online ? 'leave' : 'pause', true, false],
            ['help', '?', true, false]
        ].filter(Boolean);
        const html = btns.map(b => b[0] === 'spacer' ? '<span class="ok-spacer"></span>' : `<button class="ok-btn${b[3] ? ' ok-hot' : ''}" data-act="${b[0]}"${b[2] ? '' : ' disabled'}>${b[1]}</button>`).join('');
        if (toolsEl._html !== html) { toolsEl.innerHTML = html; toolsEl._html = html; }
    }

    // ---------------------------------------------------------------
    // the dialogs
    // ---------------------------------------------------------------
    function dialog(title, inner) {
        overEl.innerHTML = `<div class="ok-dlg" role="dialog" aria-label="${esc(title)}"><div class="ok-dlg-bar">${esc(title)}</div><div class="ok-dlg-in">${inner}</div></div>`;
        overEl.hidden = false;
    }
    function hideOver() { if (overEl) { overEl.hidden = true; overEl.innerHTML = ''; } }
    function seg(k, cur, list) {
        return '<span class="ok-seg">' + list.map(([v, l]) => `<button class="ok-btn" data-act="opt" data-k="${k}" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join('') + '</span>';
    }
    function showMenu() {
        if (!overEl) return;
        if (G && !G.online && G.m && !G.m.over) { G.paused = true; }
        const p = prefs(), st = stats();
        const sv = readJson(SAVE_KEY);
        const canResume = sv && sv.m && !sv.m.over;
        dialog('okey 98', `
            <div class="ok-title">okey <b>98</b></div>
            <p>turkish tile rummy for four. you and three bots, or friends online through the lobby.</p>
            <div class="ok-row"><span class="ok-label">rules</span>${seg('mode', p.mode, [['classic', 'classic okey'], ['101', 'okey 101']])}</div>
            ${p.mode === 'classic' ? `<div class="ok-row"><span class="ok-label">start on</span>${seg('start', p.start, [[10, '10 points'], [20, '20 points']])}</div>`
                : `<div class="ok-row"><span class="ok-label">match</span>${seg('hands', p.hands, [[1, '1 hand'], [3, '3 hands'], [5, '5 hands']])}</div>`}
            <div class="ok-row"><span class="ok-label">bots</span>${seg('level', p.level, [['easy', 'easy'], ['normal', 'normal'], ['hard', 'hard']])}</div>
            <div class="ok-actions">
                <button class="ok-btn" data-act="help">how to play</button>
                <button class="ok-btn" data-act="online">play online</button>
                ${canResume ? '<button class="ok-btn" data-act="continue">continue</button>' : ''}
                ${G && G.v && !G.online && G.m && !G.m.over ? '<button class="ok-btn" data-act="resume">back to the table</button>' : ''}
                <button class="ok-btn ok-go" data-act="deal">deal</button>
            </div>
            <p class="ok-note">${st.matches ? `matches ${st.matches}, won ${st.wins} · hands won ${st.handWins}/${st.hands}${st.okeyWins ? ' · okey finishes ' + st.okeyWins : ''}` : 'no matches yet. the bots are waiting, bradar'}</p>`);
        const go = overEl.querySelector('[data-act=deal]');
        if (go) go.focus({ preventScroll: true });
    }
    let helpBack = null;
    function showHelp() {
        helpBack = overEl && !overEl.hidden && overEl.querySelector('.ok-title') ? 'menu' : null;
        const was = !helpBack && G && G.v && !G.online && !G.paused;
        if (was) { G.paused = true; G.helpPaused = true; }
        dialog('how to play okey', `
            <ul class="ok-help">
                <li>106 tiles: red, yellow, blue and black 1-13, twice, and two jokers. the tile turned up in the middle is the <b>indicator</b>; the next number in its colour is the <b>okey</b>, the wild tile (13 is followed by 1). it has a gold edge in your rack. the jokers stand for the okey's own number.</li>
                <li>on your turn <b>draw</b> from the pile or <b>take</b> the tile the player on your left just threw, then <b>throw</b> one tile to the corner on your right.</li>
                <li><b>runs</b>: one colour in a row, 3 or more (12-13-1 is fine, 13-1-2 is not). <b>groups</b>: one number in 3 or 4 different colours.</li>
                <li><b>classic</b>: finish when your 14 tiles are all in runs and groups (or seven pairs): drop your 15th tile on the indicator. everybody else loses 2 points, 4 if you finish by throwing the okey or on pairs, 8 for both. holding the indicator's twin on your first turn? <b>show</b> it: the others lose 1. the match ends when somebody hits 0; most points wins.</li>
                <li><b>101</b>: 21 tiles each. <b>lay down</b> runs and groups worth 101 or more (or five pairs) to open, then add your tiles to any meld on the table. play out every tile to finish. penalties: 202 if you never opened, otherwise what is left in your rack (an okey is 101). throwing the okey or a tile that fits the table costs 101. lowest total after the hands wins.</li>
            </ul>
            <p class="ok-keys">mouse/touch: drag tiles around the rack; drag one to your corner to throw it, onto the indicator to finish (classic) or onto a meld to add it (101). click a tile to select it. drag or click the pile to draw.<br>
            keys: arrows move, shift+arrows carry a tile, space selects, d draw, t take, x/enter throw, f finish, l lay down, b put back, i show twin, s/g sort, p pause, h help.</p>
            <div class="ok-actions"><button class="ok-btn ok-go" data-act="closehelp">got it</button></div>`);
    }
    function showPause() {
        dialog('paused', `<p>the bots are waiting with their tiles face down.</p>
            <div class="ok-actions"><button class="ok-btn" data-act="menu">menu</button><button class="ok-btn" data-act="help">how to play</button><button class="ok-btn ok-go" data-act="resume">resume</button></div>`);
        const b = overEl.querySelector('[data-act=resume]');
        if (b) b.focus({ preventScroll: true });
    }
    function miniTiles(ids, ok) {
        return ids.map(id => id < 0 ? '<span class="ok-t ok-gap"></span>' : S.isFalse(id) ? '<span class="ok-t ok-fj">★</span>'
            : `<span class="ok-t c${S.colorOf(id)}${S.isWild(id, ok) ? ' ok-wild' : ''}">${S.numOf(id)}</span>`).join('');
    }
    function showResult() {
        if (!G || !G.v || !G.v.result) return;
        const v = G.v, r = v.result, me = G.me;
        const winName = r.winner >= 0 ? (r.winner === me ? 'you' : v.seats[r.winner].name) : null;
        let head;
        if (r.winner < 0) head = 'the pile ran out. nobody finished.';
        else head = winName + (r.winner === me ? ' finish' : ' finishes') + (r.how === 'pairs' ? ' on seven pairs' : '') + (r.okey ? ', throwing the okey' : '') + (r.inOne ? ', all in one go' : '') + (r.mult > 1 ? ' (x' + r.mult + ')' : '') + '.';
        let reveal = '';
        if (r.winner >= 0 && v.reveal) {
            const hand = v.reveal[r.winner];
            const melds = v.mode === 'classic'
                ? (r.how === 'pairs' ? S.pairMelds(hand, v.ok).melds : S.bestMelds(hand, v.ok).melds.map(m => S.meldInfo(m, v.ok).order))
                : v.table.filter(t => t.owner === r.winner).map(t => t.tiles);
            const flat = [];
            melds.forEach((m, i) => { if (i) flat.push(-1); flat.push(...m); });
            reveal = `<div class="ok-reveal">${miniTiles(flat, v.ok)}</div>`;
        }
        const order = [0, 1, 2, 3].sort((a, b) => (v.mode === 'classic' ? r.scores[b] - r.scores[a] : r.scores[a] - r.scores[b]));
        const rows = order.map(s => `<tr class="${s === (r.matchOver ? r.matchWinner : r.winner) ? 'ok-win' : ''}${s === me ? ' ok-me' : ''}"><td>${esc(v.seats[s].name)}${s === me ? ' (you)' : ''}</td><td class="ok-num">${r.deltas[s] > 0 ? '+' : ''}${r.deltas[s]}${r.pens[s] && v.mode === '101' ? ' <small>(' + (r.pens[s] > 0 ? '+' : '') + r.pens[s] + ' pen.)</small>' : ''}</td><td class="ok-num">${r.scores[s]}</td></tr>`).join('');
        let foot;
        if (r.matchOver) {
            const w = r.matchWinner;
            foot = `<p><b>${w === me ? 'you win the match!' : esc(v.seats[w].name) + ' wins the match.'}</b></p>
                <div class="ok-actions">${G.online ? '<button class="ok-btn" data-act="leave">leave</button>' : '<button class="ok-btn" data-act="menu">menu</button><button class="ok-btn ok-go" data-act="again">new match</button>'}</div>`;
        } else if (G.isHost) {
            foot = `<div class="ok-actions">${G.online ? '<span class="ok-note">the next hand deals itself in a few seconds</span>' : '<button class="ok-btn" data-act="menu">menu</button>'}<button class="ok-btn ok-go" data-act="next">next hand</button></div>`;
        } else foot = '<p class="ok-note">waiting for the host to deal the next hand...</p><div class="ok-actions"><button class="ok-btn" data-act="leave">leave</button></div>';
        dialog(r.matchOver ? 'match over' : (v.mode === '101' ? 'hand ' + (r.handNo + 1) + ' of ' + v.hands : 'hand over'), `
            <p>${esc(head)}</p>${reveal}
            <table class="ok-table"><tr><th>player</th><th>this hand</th><th>${v.mode === 'classic' ? 'points' : 'total'}</th></tr>${rows}</table>${foot}`);
        const b = overEl.querySelector('.ok-go');
        if (b) b.focus({ preventScroll: true });
    }
    function showLost(why) {
        if (!G) return;
        G.lost = true;
        dialog('connection', `<p>${esc(why)}</p><div class="ok-actions"><button class="ok-btn" data-act="leave">back to the menu</button><button class="ok-btn ok-go" data-act="deal">play the bots instead</button></div>`);
    }

    // ---------------------------------------------------------------
    // online: the lobby starts everybody here with the same seed and the
    // same list of player ids; the first four sit, bots take the rest
    // ---------------------------------------------------------------
    function startOnline(session, opts) {
        mount();
        stopGame();
        const slots = (Array.isArray(opts.slots) ? opts.slots : session.players.map(p => p.id)).slice(0, 4);
        const me = slots.indexOf(session.id);
        const mode = opts.options && opts.options.mode === '101' ? '101' : 'classic';
        const isHost = !!session.isHost;
        const names = shuffled(BOT_NAMES, opts.seed >>> 0);
        const seatIds = [0, 1, 2, 3].map(i => slots[i] || null);
        let m = null;
        if (isHost) {
            m = S.newMatch({
                mode, seed: opts.seed >>> 0, start: 20, hands: 3,
                seats: seatIds.map((id, i) => id ? { name: ((session.player(id) || {}).name || 'player ' + (i + 1)), bot: false } : { name: names[i] + ' (bot)', bot: true, level: 'normal' })
            });
        }
        G = newG({ session, isHost, me, m, seatIds });
        const s = session;
        if (isHost) {
            G.unsubs.push(
                s.on('okey:act', (d, from) => {
                    if (!G || !from || !d || typeof d !== 'object') return;
                    const seat = G.seatIds.indexOf(from.id);
                    if (seat < 0 || G.m.seats[seat].bot) return;
                    const r = hostApply(seat, d.a);
                    if (!r.ok) s.send('okey:no', { err: String(r.err).slice(0, 80) }, from.id);
                }),
                s.on('okey:hi', (d, from) => { if (G && from && G.seatIds.includes(from.id)) broadcast(null, from.id); }),
                s.on('player-leave', p => {
                    if (!G || !p) return;
                    const seat = G.seatIds.indexOf(p.id);
                    if (seat < 0) return;
                    G.seatIds[seat] = null;
                    G.m.seats[seat].bot = true;
                    G.m.seats[seat].name = (G.m.seats[seat].name + ' (bot)').slice(0, 22);
                    G.v = S.view(G.m, G.me);
                    say(p.name + ' left: a bot takes the seat');
                    broadcast([]);
                    refresh();
                    dirty = true;
                })
            );
            enterHand();
            broadcast([{ e: 'deal' }]);
        } else {
            G.unsubs.push(
                s.on('okey:st', (d, from) => {
                    if (!G || !d || typeof d !== 'object' || !d.v || typeof d.n !== 'number') return;
                    if (!from || !(s.players.find(p => p.host) || {}).id || from.id !== (s.players.find(p => p.host) || {}).id) return;
                    if (d.n <= G.lastN) return;
                    G.lastN = d.n;
                    const newHand = d.hk !== G.handKey;
                    if (newHand || !G.v) {
                        G.v = d.v;
                        G.handKey = d.hk;
                        enterHand();
                        if (d.v.result) { G.done = true; showResult(); }
                        return;
                    }
                    if (d.v.turn !== G.v.turn) G.turnAt = performance.now();
                    onEvents(Array.isArray(d.ev) ? d.ev : [], d.v);
                }),
                s.on('okey:no', d => { if (d && d.err) { say(String(d.err)); sfx.bad(); } }),
                s.on('player-leave', p => { if (p && p.host) showLost('the host left the table.'); }),
                s.on('net:down', () => { if (G && !G.lost) showLost('the host stopped answering.'); })
            );
            G.v = null;
            dialog('okey 98', '<p>sitting down at the table...</p>');
            G.hiAt = performance.now() + 800;
        }
        refresh();
        dirty = true;
    }

    // ---------------------------------------------------------------
    // the front door
    // ---------------------------------------------------------------
    window.startOkey = function () {
        const fresh = mount();
        if (fresh || !G) showMenu();
        return winRef && winRef.win;
    };
    function paintAvatar(c) {
        const x = c.getContext('2d');
        x.fillStyle = '#0d5c34'; x.fillRect(0, 0, c.width, c.height);
        const w = c.width * 0.5, h = w * 1.38;
        drawTile(x, (c.width - w) / 2, (c.height - h) / 2, w, h, 13 * 2 + 6, { wild: true });
    }
    if (window.Netplay) {
        Netplay.registerGame({
            id: 'okey', name: 'okey 98',
            start: (session, opts) => startOnline(session, opts || {}),
            startSolo: () => { startLocal(); },
            soloLabel: 'play with bots',
            paintAvatar
        });
    }

    // the test hook: what is going on, where things are, and a faster clock
    function pageRect(r) { const b = cv.getBoundingClientRect(); const k = b.width / L.W; return { x: b.left + (r.x + r.w / 2) * k, y: b.top + (r.y + r.h / 2) * k }; }
    window.OKEY_ENGINE = {
        state: () => G,
        view: () => (G ? G.v : null),
        match: () => (G ? G.m : null),
        rack: () => (G ? G.rack.slice() : []),
        startLocal: o => startLocal(o),
        speed: k => { speed = max(0.25, +k || 1); },
        slot: i => pageRect(slotRect(i)),
        slotOf: id => (G ? G.rack.indexOf(id) : -1),
        pile: () => pageRect(pileRect()),
        take: () => pageRect(stackRect(S.prevSeat(G.me))),
        throwAt: () => pageRect(stackRect(G.me)),
        finishAt: () => pageRect(indRect()),
        meld: i => { layoutMelds(); return L.melds[i] ? pageRect(L.melds[i]) : null; },
        // host only: deal this seat the given tiles (swapped in from wherever
        // they were, so the 106 stay 106) - a test's way to a finished hand
        rig: (seat, ids) => {
            const h = G.m.hand, mine = h.hands[seat];
            const want = new Set(ids);
            const spare = mine.filter(x => !want.has(x));
            for (const id of ids) {
                if (mine.includes(id)) continue;
                const out = spare.pop();
                const where = [h.pile].concat(h.hands, h.discards).find(a => a.includes(id));
                if (!where || out === undefined) continue;
                where[where.indexOf(id)] = out;
                mine[mine.indexOf(out)] = id;
            }
            if (h.ind !== undefined && want.has(h.ind)) throw new Error('the indicator cannot be dealt');
            S.audit(G.m);
            G.v = S.view(G.m, G.me);
            syncRack();
            arrange('run');
            refresh();
            return mine.slice();
        }
    };
})();
