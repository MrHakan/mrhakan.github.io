// ===================================================================
// kartz 98 — the card table: the window, the cards, the clicks and keys,
// the bots' pace, and the wire
//
// kartz-sim.js is the rules; this is what sits between them and a person.
// The table is plain DOM (a card is a button), redrawn when the match
// changes and not on a clock, so it costs nothing while somebody thinks.
//
// Alone, the bots take the other seats and this page runs the match. Online
// the host runs it: guests send what they want to do (`kartz:act`), the host
// checks it against the rules, and everybody gets back what their own seat
// may see (`kartz:state`). A guest who walks out becomes a bot.
// ===================================================================
(function () {
    'use strict';

    const S = window.KZ_SIM;
    if (!S) { console.warn('[kartz] the rules did not load'); return; }
    const { min, max, floor } = Math;
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const PREFS_KEY = 'mrhakan98-kartz-prefs', STATS_KEY = 'mrhakan98-kartz-stats', SAVE_KEY = 'mrhakan98-kartz-save';
    const GAME_IDS = ['batak', 'king', 'pisti'];
    const BOT_FACES = ['src/emoj/heh.png', 'src/emoj/xdtroll.png', 'src/emoj/oleyy.png', 'src/emoj/pffft.png', 'src/emoj/thehehe.png', 'src/emoj/toplum.png'];
    const PACE = { bot: 700, trick: 1400, hand: 9000, lead: 450 };
    const BLURB = {
        batak: 'four players, thirteen cards each. bid how many tricks you will take, name trumps if you win the bid, then make it.',
        king: 'twenty hands of contracts. six of them cost points, the trump hands pay them back. everybody calls five.',
        pisti: 'match the top card of the pile or throw a jack to sweep it. a single card swept by its twin is a pisti.'
    };
    const RULES = {
        batak: [
            'thirteen cards each. starting left of the dealer, bid 5 to 13 tricks or pass. if everybody else passes, the dealer has to take it at 5 or more.',
            'whoever bids highest names trumps and leads the first trick. trumps cannot be led until one has been played.',
            'follow suit, and beat the best card of that suit on the table if you can. out of the suit? you must trump, and over-trump if you can.',
            'make your bid: + your tricks. go down: minus your bid. everybody else: + their tricks. first to the target wins.'
        ],
        king: [
            'twenty hands. the chooser goes round the table and calls a contract for the hand: five calls each, two of them trumps.',
            'six penalty contracts, each called twice per table: no tricks (-50 a trick), no hearts (-30 a heart), no jacks/kings (-60 each), no queens (-100 each), king of hearts (-320), last two (-180 a trick).',
            'trumps (+50 a trick): the chooser names the suit and leads. same rules as batak: follow, beat, trump and over-trump.',
            'in penalty hands just follow suit. hearts cannot be led in no hearts or king of hearts until one has been played; out of the suit you must throw the king of hearts or a heart there. the hand stops once there is nothing left to lose. most points after twenty hands wins.'
        ],
        pisti: [
            'four cards each and four on the table, only the top one face up. play one card a turn.',
            'same rank as the top card takes the whole pile. a jack takes any pile.',
            'a pile of one card taken by its twin is a pisti: 10 points, 20 if both are jacks.',
            'at the end of a hand: aces 1, jacks 1, two of clubs 2, ten of diamonds 3, and 3 for most cards. four players play as partners across the table.'
        ]
    };

    const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
    const dropKey = k => { try { localStorage.removeItem(k); } catch (e) { } };
    function prefs() {
        const p = readJson(PREFS_KEY) || {};
        return {
            game: GAME_IDS.includes(p.game) ? p.game : 'batak',
            pistiSeats: p.pistiSeats === 4 ? 4 : 2,
            length: p.length === 'long' ? 'long' : 'short'
        };
    }
    const savePrefs = o => writeJson(PREFS_KEY, Object.assign(prefs(), o));
    function stats() {
        const o = readJson(STATS_KEY);
        const out = {};
        for (const g of GAME_IDS) {
            const r = o && o[g] && typeof o[g] === 'object' ? o[g] : {};
            const n = v => (Number.isFinite(+v) && +v >= 0 ? floor(+v) : 0);
            out[g] = { played: n(r.played), won: n(r.won), hands: n(r.hands), pistis: n(r.pistis) };
        }
        return out;
    }
    function record(f) { const s = stats(); f(s); writeJson(STATS_KEY, s); }
    function loadSave() {
        const o = readJson(SAVE_KEY);
        const st = o && o.st;
        if (!st || st.v !== 1 || !GAME_IDS.includes(st.game) || st.over || !Array.isArray(st.hands) || !Array.isArray(st.seats)) return null;
        return o;
    }

    // ===============================================================
    // sound: little beeps, and none when the site is muted
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
            osc.frequency.setValueAtTime(freq, t0);
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(o.gain || 0.03, t0 + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(g); g.connect(actx.destination);
            osc.start(t0); osc.stop(t0 + dur + 0.02);
        } catch (e) { }
    }
    const sfx = {
        card: () => tone(1800, 0.03, { type: 'triangle', gain: 0.02 }),
        trick: () => tone(520, 0.08, { type: 'triangle' }),
        turn: () => { tone(880, 0.07, { type: 'triangle' }); tone(1175, 0.09, { type: 'triangle', delay: 0.07 }); },
        pisti: () => { tone(660, 0.08); tone(990, 0.08, { delay: 0.08 }); tone(1320, 0.16, { delay: 0.16 }); },
        win: () => { tone(660, 0.12); tone(880, 0.12, { delay: 0.12 }); tone(1320, 0.3, { delay: 0.24 }); },
        lose: () => tone(300, 0.4, { type: 'sawtooth', gain: 0.025 })
    };

    // ===============================================================
    // the window
    // ===============================================================
    let winRef = null, root = null, stage = null, table = null, over = null, bar = null, feedEl = null;
    let screen = 'menu', G = null, ticker = 0, ff = 1, cursor = -1, sheet = null, howFor = '';
    function ensureCss() {
        if (document.getElementById('kz-css')) return;
        const l = document.createElement('link');
        l.id = 'kz-css'; l.rel = 'stylesheet'; l.href = 'games/kartz/kartz.css';
        document.head.appendChild(l);
    }
    function ensureWindow() {
        ensureCss();
        if (winRef && winRef.win && document.getElementById(winRef.win.id)) return winRef;
        const vw = typeof viewportWidth === 'function' ? viewportWidth() : 1000;
        winRef = createAppWindow('kartz 98', { icon: 'style', width: min(860, vw - 20) });
        winRef.win.classList.add('kz-window');
        winRef.body.classList.add('kz-body');
        if (document.documentElement.clientHeight < 760) winRef.win.style.top = '4px';
        root = winRef.body;
        root.innerHTML = `<div class="kz-stage" id="kz-stage">
            <div class="kz-bar" id="kz-bar"></div>
            <div class="kz-table" id="kz-table" aria-live="polite"></div>
            <div class="kz-feed" id="kz-feed" role="status"></div>
            <div class="kz-over" id="kz-over"></div>
        </div>`;
        stage = root.querySelector('#kz-stage');
        table = root.querySelector('#kz-table');
        over = root.querySelector('#kz-over');
        bar = root.querySelector('#kz-bar');
        feedEl = root.querySelector('#kz-feed');
        stage.addEventListener('click', onClick);
        stage.addEventListener('change', onChange);
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', onResize);
        window.addEventListener('message', onMessage);
        document.addEventListener('visibilitychange', onVisibility);
        winRef.win._cleanup = () => {
            leave();
            clearInterval(ticker); ticker = 0;
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('resize', onResize);
            window.removeEventListener('message', onMessage);
            document.removeEventListener('visibilitychange', onVisibility);
            closeSheet();
            winRef = null; root = null; stage = null; table = null; over = null; bar = null; feedEl = null;
            screen = 'menu';
        };
        ticker = setInterval(tick, 50);
        return winRef;
    }
    function onTop() {
        if (!winRef || !winRef.win || winRef.win.style.display === 'none') return false;
        const z = +winRef.win.style.zIndex || 0;
        return ![...document.querySelectorAll('.app-window, .ie-window')].some(w => w !== winRef.win && w !== (sheet && sheet.win) && w.style.display !== 'none' && (+w.style.zIndex || 0) > z);
    }
    let fitW = 0;
    function fit() {
        if (!stage || !root) return;
        const w = root.clientWidth || 360;
        const vh = document.documentElement.clientHeight || window.innerHeight || 700;
        const fs = winRef && winRef.win.classList.contains('fs-active');
        const top = max(0, root.getBoundingClientRect().top);
        const narrow = w < 560;
        let h = fs ? root.clientHeight : vh - top - 8;
        h = max(narrow ? 470 : 430, min(h, narrow ? 720 : 620));
        stage.style.height = floor(h) + 'px';
        stage.classList.toggle('kz-narrow', narrow);
        stage.classList.toggle('kz-short', h < 520);
        fitW = w;
    }
    function onResize() { const w = root ? root.clientWidth : 0; fit(); if (w && screen === 'play') render(); }

    // ===============================================================
    // a match on this screen
    // ===============================================================
    // host: the whole match. guest: what the host says this seat may see
    function makeG(o) {
        return {
            st: o.st || null, host: !!o.host, online: !!o.session, session: o.session || null, me: o.me || 0, mid: o.mid || '',
            waitUntil: 0, paused: false, lastEv: o.st ? o.st.evN : 0, drawnEv: o.st ? o.st.evN : 0, pending: false, pendingAt: 0,
            feed: [], offs: [], recorded: false, auto: false, hiAt: 0, netDown: false, prevTurn: -2
        };
    }
    function startSolo(o) {
        ensureWindow();
        leave();
        const p = Object.assign(prefs(), o || {});
        savePrefs({ game: p.game, pistiSeats: p.pistiSeats, length: p.length });
        const seed = (o && Number.isInteger(o.seed)) ? o.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
        const name = (window.Netplay && Netplay.profile && Netplay.profile().name) || 'you';
        const st = S.newMatch({ game: p.game, seed, length: p.length, n: p.game === 'pisti' ? p.pistiSeats : 4, seats: [{ id: 'me', name }] });
        G = makeG({ st, host: true, me: 0 });
        screen = 'play';
        changed(true);
    }
    function resumeSolo() {
        const sv = loadSave();
        if (!sv) return;
        ensureWindow();
        leave();
        G = makeG({ st: sv.st, host: true, me: 0 });
        screen = 'play';
        say('picked up where you left off');
        changed(true);
    }
    const isBotSeat = (st, i) => !!(st.seats[i] && st.seats[i].bot) || (G && G.auto && i === G.me);
    // the host's clock: bots think, tricks are swept, hands dealt
    function tick() {
        if (!root || !document.getElementById('kz-stage')) return;
        const g = G;
        if (!g || screen !== 'play' || !g.st) return;
        if (winRef && winRef.win.style.display === 'none' && !g.online && !g.paused) pause(true);
        if (feedEl && g.feed.length && performance.now() > g.feed[0].until) paintFeed();
        if (!g.host) { guestTick(g); return; }
        if (g.paused || g.st.over) return;
        const st = g.st;
        let n = 0, moved = false;
        const cap = ff > 1 ? 60 : 1;
        while (n++ < cap && !st.over && performance.now() >= g.waitUntil) {
            if (st.phase === 'trickEnd' || st.phase === 'handEnd') { S.advance(st); moved = true; }
            else if (st.turn >= 0 && isBotSeat(st, st.turn)) { if (!S.act(st, st.turn, S.bot(st, st.turn))) break; moved = true; }
            else break;
            setWait(g);
        }
        if (moved) changed();
    }
    function setWait(g) {
        const st = g.st, now = performance.now();
        let w = 0;
        if (st.phase === 'trickEnd') w = PACE.trick;
        else if (st.phase === 'handEnd') w = PACE.hand;
        else if (st.turn >= 0 && isBotSeat(st, st.turn)) {
            const last = st.log[st.log.length - 1];
            w = last && (last.e === 'trick' || last.e === 'deal') ? PACE.bot + PACE.lead : PACE.bot;
        }
        g.waitUntil = now + w / ff;
    }
    function guestTick(g) {
        const now = performance.now();
        // no word from the host yet, or an action of ours with no answer: ask again
        if ((!g.st && now - g.hiAt > 1500) || (g.pending && now - g.pendingAt > 2500)) {
            g.hiAt = now; g.pendingAt = now;
            send(g, 'kartz:hi', { m: g.mid });
        }
        if (g.auto && g.st && !g.pending && g.st.turn === g.me && !g.st.over && now >= g.waitUntil) {
            const a = S.bot(g.st, g.me);
            if (a) doAct(a);
        }
    }
    // the match changed: draw it, tell the others, keep it
    function changed(fresh) {
        const g = G;
        if (!g) return;
        if (fresh) { setWait(g); cursor = -1; }
        readEvents(g);
        render();
        if (g.online && g.host) broadcast(g);
        if (!g.online && g.host && g.st) {
            if (g.st.over) dropKey(SAVE_KEY);
            else writeJson(SAVE_KEY, { st: g.st, at: Date.now() });
        }
        refreshSheet();
    }
    // a person (this one) does something
    function doAct(a) {
        const g = G;
        if (!g || !g.st || g.paused || g.st.turn !== g.me || g.pending) return false;
        if (!S.isLegal(g.st, g.me, a)) return false;
        if (g.host) {
            if (!S.act(g.st, g.me, a)) return false;
            setWait(g);
            cursor = -1;
            changed();
            return true;
        }
        g.pending = true; g.pendingAt = performance.now();
        send(g, 'kartz:act', { m: g.mid, a });
        render();
        return true;
    }
    function next() {
        const g = G;
        if (!g || !g.host || !g.st || g.st.phase !== 'handEnd') return;
        S.advance(g.st);
        setWait(g);
        changed();
    }
    function pause(on) {
        const g = G;
        if (!g || g.online || !g.st || g.st.over) return;
        const v = on === undefined ? !g.paused : !!on;
        if (v === g.paused) return;
        g.paused = v;
        if (!v) g.waitUntil = max(g.waitUntil, performance.now() + 300);
        render();
    }
    function onVisibility() { if (document.hidden && G && !G.online) pause(true); }
    function onMessage(ev) {
        if (ev.origin !== location.origin) return;
        if (ev.data && ev.data.type === 'game-pause' && G && !G.online) pause(true);
    }

    // ===============================================================
    // what happened: sounds and the line of news under the table
    // ===============================================================
    const nameOf = (st, i) => (G && i === G.me ? 'you' : (st.seats[i] ? st.seats[i].name : 'somebody'));
    const vb = (st, i, you, they) => nameOf(st, i) + ' ' + (G && i === G.me ? you : they);
    function say(text, t) {
        if (!G) return;
        G.feed.push({ text, until: performance.now() + (t || 3200) });
        if (G.feed.length > 3) G.feed.shift();
        paintFeed();
    }
    function paintFeed() {
        if (!feedEl || !G) return;
        const now = performance.now();
        G.feed = G.feed.filter(f => f.until > now);
        const html = G.feed.map(f => `<div>${esc(f.text)}</div>`).join('');
        if (feedEl._html !== html) { feedEl.innerHTML = html; feedEl._html = html; }
    }
    function readEvents(g) {
        const st = g.st;
        if (!st) return;
        const fresh = st.log.filter(e => e.n > g.lastEv);
        g.lastEv = st.evN;
        const quiet = fresh.length > 30;
        for (const e of quiet ? fresh.slice(-6) : fresh) {
            if (e.e === 'play') sfx.card();
            else if (e.e === 'bid') say(e.v ? vb(st, e.s, 'bid ', 'bids ') + e.v : vb(st, e.s, 'pass', 'passes'));
            else if (e.e === 'won-bid') say(vb(st, e.s, 'take', 'takes') + ' the bid at ' + e.v);
            else if (e.e === 'trump') say(vb(st, e.s, 'name', 'names') + ' ' + S.SUIT_NAME[e.suit] + ' ' + S.SUIT_GLYPH[e.suit] + ' as trumps');
            else if (e.e === 'pick') say(vb(st, e.s, 'call', 'calls') + ' ' + S.CONTRACT[e.k].name);
            else if (e.e === 'trick') { sfx.trick(); if (e.w === g.me) say('you take the trick', 1600); }
            else if (e.e === 'capture') {
                sfx.card();
                if (e.pisti) { sfx.pisti(); say('pisti! ' + nameOf(st, e.s) + ' +' + e.pisti, 3500); if (e.s === g.me && !g.recorded) record(s => { s.pisti.pistis++; }); }
                else say(vb(st, e.s, 'sweep', 'sweeps') + ' ' + e.n + ' cards', 1800);
            } else if (e.e === 'last') say(nameOf(st, e.s) + ' gets the last ' + e.n + ' cards');
            else if (e.e === 'redeal') say('four more each. ' + e.left + ' left in the deck', 2000);
            else if (e.e === 'left') say(st.seats[e.s].name + ' left. a bot plays on for them', 4000);
            else if (e.e === 'hand') { if (!g.recorded) record(s => { s[st.game].hands++; }); }
            else if (e.e === 'over') matchOver(g);
        }
        if (st.over && !g.recorded) matchOver(g);
        if (st.turn === g.me && g.prevTurn !== g.me && !st.over) sfx.turn();
        g.prevTurn = st.turn;
    }
    function iWon(st) { return G && st.winners.some(w => S.teamOf(st, w) === S.teamOf(st, G.me)); }
    function matchOver(g) {
        if (g.recorded) return;
        g.recorded = true;
        const st = g.st, won = iWon(st);
        record(s => { s[st.game].played++; if (won) s[st.game].won++; });
        (won ? sfx.win : sfx.lose)();
        if (!g.online) dropKey(SAVE_KEY);
    }

    // ===============================================================
    // the picture
    // ===============================================================
    const RED = c => S.suitOf(c) === 1 || S.suitOf(c) === 2;
    const LONG = ['', '', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
    const cardName = c => LONG[S.rankOf(c)] + ' of ' + S.SUIT_NAME[S.suitOf(c)];
    function face(c) {
        const r = S.rankOf(c), g = S.SUIT_GLYPH[S.suitOf(c)], l = S.RANK_LABEL(r);
        const mid = r >= 11 && r <= 13 ? `<span class="kz-court kz-court-${l}">${l}<i>${g}</i></span>` : `<span class="kz-pip">${g}</span>`;
        return `<b class="kz-ix">${l}<i>${g}</i></b>${mid}<b class="kz-ix kz-ix2">${l}<i>${g}</i></b>`;
    }
    const cardHtml = (c, cls, extra) => (c < 0
        ? `<div class="kz-card kz-back ${cls || ''}" ${extra || ''}></div>`
        : `<div class="kz-card ${RED(c) ? 'kz-red' : 'kz-black'} ${cls || ''}" data-c="${c}" title="${cardName(c)}" ${extra || ''}>${face(c)}</div>`);
    // where each seat sits on this screen: me at the bottom
    function posOf(st, i) {
        const rel = (i - G.me + st.n) % st.n;
        return st.n === 2 ? ['bottom', 'top'][rel] : ['bottom', 'left', 'top', 'right'][rel];
    }
    function seatLine(st, i) {
        const p = [];
        if (st.game === 'batak') {
            if (st.phase === 'bid') { const b = st.bids[i]; p.push(b === null ? '...' : b === 0 ? 'pass' : 'bid ' + b); }
            else if (st.bidder >= 0) { if (i === st.bidder) p.push('bid ' + st.high); p.push(st.tricks[i] + (st.tricks[i] === 1 ? ' trick' : ' tricks')); }
        } else if (st.game === 'king') {
            if (st.phase !== 'pick') p.push(st.tricks[i] + (st.tricks[i] === 1 ? ' trick' : ' tricks'));
            if (st.pen && st.pen[i]) p.push((st.pen[i] > 0 ? '+' : '') + st.pen[i]);
            if (i === st.chooser) p.push('chooser');
        } else {
            p.push(st.taken[i] + ' cards');
            if (st.pistis[i]) p.push(st.pistis[i] + ' pisti');
        }
        return p.join(' · ');
    }
    function avatar(st, i) {
        const p = st.seats[i];
        if (p.bot && !p.left) return `<img class="kz-face" src="${BOT_FACES[i % BOT_FACES.length]}" alt="" onerror="this.remove()">`;
        return `<span class="kz-face kz-initial">${esc((p.name || '?').slice(0, 1).toUpperCase())}</span>`;
    }
    function plate(st, i) {
        const pos = posOf(st, i), p = st.seats[i];
        const cnt = st.hands[i] ? st.hands[i].length : 0;
        const team = st.game === 'pisti' && st.n === 4 ? `<em class="kz-team kz-team${i % 2}">${i % 2 === S.teamOf(st, G.me) ? 'us' : 'them'}</em>` : '';
        const backs = pos === 'bottom' ? '' : `<div class="kz-backs" aria-label="${cnt} cards">${Array.from({ length: min(cnt, 13) }, () => '<i></i>').join('')}<u>${cnt}</u></div>`;
        const turn = st.turn === i && !st.over;
        return `<div class="kz-seat kz-p-${pos}${turn ? ' kz-turn' : ''}${i === G.me ? ' kz-me' : ''}" data-seat="${i}">
            <div class="kz-plate">${avatar(st, i)}<span class="kz-name">${esc(i === G.me ? (G.online ? p.name + ' (you)' : 'you') : p.name)}${p.bot ? ' <em>bot</em>' : ''}${team}</span><b class="kz-score">${st.scores[i]}</b></div>
            <div class="kz-line">${esc(seatLine(st, i))}</div>${backs}
        </div>`;
    }
    function centerHtml(st) {
        if (st.game === 'pisti') {
            const pile = st.pile || [];
            const deck = typeof st.deck === 'number' ? st.deck : (st.deck || []).length;
            const under = pile.slice(max(0, pile.length - 5), -1);
            const top = pile.length ? pile[pile.length - 1] : null;
            const fresh = freshEvent(st);
            let flying = '';
            if (fresh && fresh.e === 'capture') {
                const to = posOf(st, fresh.s);
                flying = cardHtml(fresh.top, 'kz-pc kz-sweep kz-to-' + to, `style="animation-duration:${floor(700 / ff)}ms"`) + cardHtml(fresh.c, 'kz-pc kz-sweep kz-to-' + to + ' kz-pc-hit', `style="animation-duration:${floor(700 / ff)}ms"`);
            }
            const enter = fresh && fresh.e === 'play' ? ' kz-from-' + posOf(st, fresh.s) : '';
            return `<div class="kz-center kz-pisti">
                <div class="kz-deck">${deck ? cardHtml(-1, 'kz-dk') : '<div class="kz-card kz-empty"></div>'}<span>deck ${deck}</span></div>
                <div class="kz-pile" aria-label="the pile, ${pile.length} cards">
                    ${under.map((c, k) => cardHtml(c, 'kz-pc kz-under', `style="--k:${k - under.length}"`)).join('')}
                    ${top !== null ? cardHtml(top, 'kz-pc kz-top' + enter) : '<div class="kz-card kz-empty"></div>'}
                    ${flying}
                    <span class="kz-count">${pile.length ? 'pile ' + pile.length : 'empty table'}</span>
                </div>
            </div>`;
        }
        const fresh = freshEvent(st);
        const sweeping = st.phase === 'trickEnd';
        const winPos = sweeping ? posOf(st, st.trickWinner) : '';
        const cards = st.trick.map(t => {
            const pos = posOf(st, t.s);
            let cls = 'kz-tc kz-t-' + pos, extra = '';
            if (sweeping) { cls += ' kz-sweep kz-to-' + winPos + (t.s === st.trickWinner ? ' kz-best' : ''); extra = `style="animation-delay:${floor(PACE.trick * 0.6 / ff)}ms;animation-duration:${floor(PACE.trick * 0.35 / ff)}ms"`; }
            else if (fresh && fresh.e === 'play' && fresh.s === t.s && fresh.c === t.c) cls += ' kz-from-' + pos;
            return cardHtml(t.c, cls, extra);
        }).join('');
        return `<div class="kz-center kz-tricks">${cards}${!st.trick.length && st.lastTrick && st.phase === 'play' ? `<div class="kz-lastnote">last trick: ${esc(nameOf(st, st.lastTrick.w))}</div>` : ''}</div>`;
    }
    // the newest thing that happened, if it has not been drawn yet
    function freshEvent(st) {
        const e = st.log[st.log.length - 1];
        return e && e.n > G.drawnEv && (e.e === 'play' || e.e === 'capture') ? e : null;
    }
    function barText(st) {
        const g = st.game;
        const parts = [g + ' · hand ' + (st.handNo + 1) + (g === 'king' ? ' of 20' : '')];
        if (g === 'batak') {
            if (st.trump >= 0) parts.push(`trumps <b class="${st.trump === 1 || st.trump === 2 ? 'kz-r' : ''}">${S.SUIT_GLYPH[st.trump]}</b> ${esc(st.seats[st.bidder].name)} ${st.high}`);
            parts.push('to ' + st.target);
        } else if (g === 'king') {
            if (st.contract) parts.push(esc(S.CONTRACT[st.contract].name) + (st.trump >= 0 ? ` <b class="${st.trump === 1 || st.trump === 2 ? 'kz-r' : ''}">${S.SUIT_GLYPH[st.trump]}</b>` : ''));
        } else parts.push('to ' + st.target + (st.n === 4 ? ' · partners' : ''));
        if (G.online) parts.push(G.host ? 'hosting' : 'online');
        return parts.join(' · ');
    }
    function promptHtml(st) {
        const g = G;
        if (st.over) return '';
        if (st.phase === 'trickEnd') return `<div class="kz-msg">${esc(vb(st, st.trickWinner, 'take', 'takes'))} the trick</div>`;
        if (st.phase === 'handEnd') return '';
        if (st.turn !== g.me) return `<div class="kz-msg">${g.paused ? 'paused' : 'waiting for ' + esc(nameOf(st, st.turn)) + '...'}</div>`;
        if (g.pending) return '<div class="kz-msg">sending...</div>';
        const opts = S.legal(st, g.me);
        if (st.phase === 'bid') {
            return `<div class="kz-msg">your bid${st.high ? ' (highest ' + st.high + ')' : ''}</div><div class="kz-choices">${opts.map(o => `<button class="kz-btn kz-choice${o.v ? '' : ' kz-pass'}" data-act="bid" data-v="${o.v}">${o.v ? o.v : 'pass'}</button>`).join('')}</div>`;
        }
        if (st.phase === 'trump') {
            return `<div class="kz-msg">name trumps</div><div class="kz-choices">${[0, 1, 2, 3].map(s => `<button class="kz-btn kz-choice kz-suit${s === 1 || s === 2 ? ' kz-r' : ''}" data-act="trump" data-s="${s}" aria-label="${S.SUIT_NAME[s]}">${S.SUIT_GLYPH[s]}<small>${S.SUIT_NAME[s]}</small></button>`).join('')}</div>`;
        }
        if (st.phase === 'pick') {
            const mine = st.picks[g.me];
            return `<div class="kz-msg">call the contract <small>(trumps ${2 - mine.koz} left, penalties ${3 - mine.pen} left)</small></div><div class="kz-choices">${opts.map(o => { const k = S.CONTRACT[o.k]; return `<button class="kz-btn kz-choice kz-contract" data-act="pick" data-k="${o.k}" title="${esc(k.help)}">${esc(k.name)}${o.k !== 'koz' ? `<small>${2 - st.used[o.k]} left</small>` : ''}</button>`; }).join('')}</div>`;
        }
        const all = st.hands[g.me].length;
        return `<div class="kz-msg kz-go">your turn${opts.length < all && st.game !== 'pisti' ? ': the raised cards are the ones you may play' : ': play a card'}</div>`;
    }
    function handHtml(st) {
        const g = G, hand = st.hands[g.me] || [];
        const w = fitW || 600;
        const cw = stage.classList.contains('kz-narrow') ? 48 : 66;
        const room = w - 16;
        const k = hand.length;
        const step = k > 1 ? min(cw * 0.78, (room - cw) / (k - 1)) : 0;
        const x0 = (w - (cw + step * (k - 1))) / 2;
        const mine = st.turn === g.me && st.phase === 'play' && !g.pending && !g.paused;
        const ok = new Set(mine ? S.legal(st, g.me).map(o => o.c) : []);
        return hand.map((c, i) => {
            const can = ok.has(c);
            return `<button class="kz-card kz-hcard ${RED(c) ? 'kz-red' : 'kz-black'}${mine ? (can ? ' kz-ok kz-choice' : ' kz-no') : ''}" data-act="${can ? 'play' : ''}" data-c="${c}" style="left:${floor(x0 + i * step)}px;z-index:${i + 1}" aria-label="${cardName(c)}${mine && !can ? ', not playable' : ''}" ${mine && !can ? 'aria-disabled="true"' : ''}>${face(c)}</button>`;
        }).join('');
    }
    function render() {
        if (!root || !stage) return;
        fit();
        const g = G;
        if (screen === 'menu' || !g) { renderMenu(); return; }
        const st = g.st;
        if (!st) {
            bar.innerHTML = '<span>kartz 98 · online</span>';
            table.innerHTML = `<div class="kz-wait">${g.netDown ? 'lost the host... waiting for them' : 'waiting for the host to deal...'}</div>`;
            paintOverlay();
            return;
        }
        bar.innerHTML = `<span class="kz-bar-text">${barText(st)}</span>
            <span class="kz-bar-btns">
                <button class="kz-tool" data-act="sheet" title="score sheet (s)">score sheet</button>
                <button class="kz-tool" data-act="how" title="how to play (h)">?</button>
                ${g.online ? '' : `<button class="kz-tool" data-act="pause" title="pause (p)">${g.paused ? 'go on' : 'pause'}</button>`}
                <button class="kz-tool" data-act="${g.online ? 'leave' : 'menu'}">${g.online ? 'leave' : 'menu'}</button>
            </span>`;
        let seats = '';
        for (let i = 0; i < st.n; i++) seats += plate(st, i);
        table.innerHTML = `${seats}${centerHtml(st)}
            <div class="kz-prompt">${promptHtml(st)}</div>
            <div class="kz-hand${st.turn === g.me && st.phase === 'play' ? ' kz-myturn' : ''}" aria-label="your hand">${handHtml(st)}</div>
            ${g.netDown ? '<div class="kz-net">lost the host... waiting for them</div>' : ''}`;
        G.drawnEv = st.evN;
        paintOverlay();
        paintCursor();
    }
    function paintOverlay() {
        const g = G, st = g && g.st;
        let html = '';
        if (howFor) html = howHtml(howFor);
        else if (g && g.paused) html = `<div class="kz-panel kz-small-panel" role="dialog" aria-label="paused"><div class="kz-ptitle">paused</div><div class="kz-pbody"><p>the bots are waiting. p or esc to go on.</p><div class="kz-btns"><button class="kz-btn kz-go kz-choice" data-act="pause">go on</button></div></div></div>`;
        else if (st && st.over) html = overHtml(st);
        else if (st && st.phase === 'handEnd') html = handEndHtml(st);
        over.innerHTML = html;
        over.classList.toggle('on', !!html);
        over.classList.toggle('kz-soft', !!html && !!st && st.phase === 'handEnd' && !st.over && !howFor && !g.paused);
    }
    function scoreRows(st, pts) {
        return st.seats.map((p, i) => `<tr class="${i === G.me ? 'kz-mine' : ''}${st.over && st.winners.includes(i) ? ' kz-won' : ''}"><td>${esc(i === G.me ? p.name + ' (you)' : p.name)}${p.bot ? ' <em>bot</em>' : ''}</td>${pts ? `<td>${pts[i] > 0 ? '+' : ''}${pts[i]}</td>` : ''}<td><b>${st.scores[i]}</b></td></tr>`).join('');
    }
    function handEndHtml(st) {
        const s = st.summary || st.history[st.history.length - 1];
        if (!s) return '';
        let detail = '';
        if (st.game === 'pisti') detail = `<p class="kz-small">cards taken: ${s.cards.map((c, t) => esc(st.n === 4 ? (t === S.teamOf(st, G.me) ? 'us ' : 'them ') : nameOf(st, t) + ' ') + c).join(', ')}${s.most >= 0 ? ' · most cards +3' : ' · even on cards'}</p>`;
        else detail = `<p class="kz-small">tricks: ${s.tricks.map((t, i) => esc(nameOf(st, i)) + ' ' + t).join(', ')}</p>`;
        return `<div class="kz-panel kz-small-panel" role="dialog" aria-label="hand ${s.h} is over">
            <div class="kz-ptitle">hand ${s.h} · ${esc(s.text)}</div>
            <div class="kz-pbody">${detail}
                <table class="kz-table-s"><thead><tr><th></th><th>this hand</th><th>total</th></tr></thead><tbody>${scoreRows(st, s.pts)}</tbody></table>
                <div class="kz-btns">${G.host ? '<button class="kz-btn kz-go kz-choice" data-act="next">next hand</button>' : '<span class="kz-small">the host deals the next hand in a moment</span>'}<button class="kz-btn kz-choice" data-act="sheet">score sheet</button></div>
            </div></div>`;
    }
    function overHtml(st) {
        const won = iWon(st);
        const names = st.winners.map(i => nameOf(st, i));
        const title = won ? (st.game === 'pisti' && st.n === 4 ? 'you and your partner win' : 'you win the table bradar') : (names.join(' & ') + ' ' + (names.length > 1 ? 'win' : 'wins'));
        const btns = !G.online ? '<button class="kz-btn kz-go kz-choice" data-act="again">deal again</button><button class="kz-btn kz-choice" data-act="menu">menu</button>'
            : G.host ? '<button class="kz-btn kz-go kz-choice" data-act="rematch">deal again</button><button class="kz-btn kz-choice" data-act="leave">leave</button>'
                : '<button class="kz-btn kz-choice" data-act="leave">leave</button><span class="kz-small">the host can deal again</span>';
        return `<div class="kz-panel" role="dialog" aria-label="the table is over">
            <div class="kz-ptitle">${esc(st.game)} is over</div>
            <div class="kz-pbody">
                <div class="kz-big">${esc(title)}</div>
                <p class="kz-small">${st.history.length} hands played${st.game !== 'king' ? ', to ' + st.target : ''}</p>
                <table class="kz-table-s"><thead><tr><th></th><th>points</th></tr></thead><tbody>${scoreRows(st)}</tbody></table>
                <div class="kz-btns">${btns}<button class="kz-btn kz-choice" data-act="sheet">score sheet</button></div>
            </div></div>`;
    }
    function howHtml(game) {
        const touch = matchMedia && matchMedia('(pointer: coarse)').matches;
        return `<div class="kz-panel" role="dialog" aria-label="how to play ${esc(game)}">
            <div class="kz-ptitle">how to play ${esc(game)}</div>
            <div class="kz-pbody kz-how">
                <ol>${RULES[game].map(r => `<li>${esc(r)}</li>`).join('')}</ol>
                <p class="kz-small">${touch ? 'tap a raised card to play it, and tap a button to bid or call.' : 'click a card to play it, or use <b>left</b>/<b>right</b> and <b>enter</b>. <b>s</b> score sheet, <b>p</b> pause, <b>h</b> this page.'}</p>
                <div class="kz-btns"><button class="kz-btn kz-go kz-choice" data-act="howclose">got it</button></div>
            </div></div>`;
    }
    function renderMenu() {
        const p = prefs(), r = stats(), sv = loadSave();
        bar.innerHTML = '<span class="kz-bar-text">kartz 98 · the card table</span>';
        table.innerHTML = `<div class="kz-attract" aria-hidden="true">${[51, 38, 25, 12, 49].map((c, i) => cardHtml(c, 'kz-fan', `style="--i:${i - 2}"`)).join('')}</div>`;
        const games = GAME_IDS.map(g => `<label class="kz-radio${p.game === g ? ' on' : ''}"><input type="radio" name="kz-game" value="${g}" ${p.game === g ? 'checked' : ''}><b>${g}</b><small>${esc(BLURB[g])}</small></label>`).join('');
        const rec = GAME_IDS.filter(g => r[g].played).map(g => `${g} ${r[g].won}/${r[g].played}`).join(' · ');
        over.classList.add('on'); over.classList.remove('kz-soft');
        over.innerHTML = howFor ? howHtml(howFor) : `<div class="kz-panel kz-menu" role="dialog" aria-label="kartz 98">
            <div class="kz-ptitle">kartz 98</div>
            <div class="kz-pbody">
                <div class="kz-logo">kartz<span>98</span></div>
                <div class="kz-games">${games}</div>
                <div class="kz-opts">
                    <label class="${p.game === 'pisti' ? '' : 'kz-hide'}">players <select class="kz-sel" data-k="pistiSeats"><option value="2" ${p.pistiSeats === 2 ? 'selected' : ''}>2, you and a bot</option><option value="4" ${p.pistiSeats === 4 ? 'selected' : ''}>4, partners across</option></select></label>
                    <label class="${p.game === 'king' ? 'kz-hide' : ''}">play to <select class="kz-sel" data-k="length"><option value="short" ${p.length === 'short' ? 'selected' : ''}>${p.game === 'pisti' ? 51 : 31} points</option><option value="long" ${p.length === 'long' ? 'selected' : ''}>${p.game === 'pisti' ? 151 : 51} points</option></select></label>
                    ${p.game === 'king' ? '<span class="kz-small">twenty hands, every contract twice</span>' : ''}
                </div>
                <div class="kz-btns">
                    <button class="kz-btn kz-go" data-act="deal">deal</button>
                    ${sv ? `<button class="kz-btn" data-act="resume">resume ${esc(sv.st.game)}, hand ${sv.st.handNo + 1}</button>` : ''}
                    <button class="kz-btn" data-act="online">online, 2 to 4</button>
                    <button class="kz-btn" data-act="how">how to play</button>
                </div>
                <div class="kz-rec">${rec ? 'won/played: ' + esc(rec) : 'no tables played yet bradar'}</div>
            </div></div>`;
    }

    // ===============================================================
    // the keyboard: left and right go through what can be chosen, enter picks it
    // ===============================================================
    function choices() { return stage ? [...stage.querySelectorAll(over.classList.contains('on') && !over.classList.contains('kz-soft') ? '.kz-over .kz-choice' : '.kz-choice')] : []; }
    function paintCursor() {
        if (!stage) return;
        stage.querySelectorAll('.kz-cur').forEach(e => e.classList.remove('kz-cur'));
        if (cursor < 0) return;
        const list = choices();
        if (!list.length) return;
        cursor = min(cursor, list.length - 1);
        list[cursor].classList.add('kz-cur');
    }
    function onKey(ev) {
        if (!root || !onTop()) return;
        const tag = (ev.target && ev.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const k = ev.key;
        if (screen !== 'play') return;
        let used = true;
        if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'd') {
            const list = choices();
            if (list.length) {
                const dir = k === 'ArrowLeft' || k === 'a' ? -1 : 1;
                cursor = cursor < 0 ? (dir > 0 ? 0 : list.length - 1) : (cursor + dir + list.length) % list.length;
                paintCursor();
            }
        } else if (k === 'Enter' || k === ' ') {
            const el = stage.querySelector('.kz-cur');
            if (el) el.click();
            else used = false;
        } else if (k === 'Escape' || k === 'p' || k === 'P') {
            if (howFor) { howFor = ''; render(); } else if (G && !G.online) pause();
            else used = false;
        } else if (k === 's' || k === 'S') toggleSheet();
        else if (k === 'h' || k === 'H' || k === '?') { howFor = howFor ? '' : (G && G.st ? G.st.game : prefs().game); render(); }
        else if ((k === 'n' || k === 'N') && G && G.host && G.st && G.st.phase === 'handEnd') next();
        else used = false;
        if (used) { ev.preventDefault(); ev.stopPropagation(); }
    }

    // ===============================================================
    // clicks and taps
    // ===============================================================
    function onChange(ev) {
        const el = ev.target;
        if (el.name === 'kz-game') { savePrefs({ game: el.value }); render(); }
        else if (el.dataset.k === 'pistiSeats') savePrefs({ pistiSeats: +el.value });
        else if (el.dataset.k === 'length') savePrefs({ length: el.value });
    }
    function onClick(ev) {
        const b = ev.target.closest('[data-act]');
        if (!b || !b.dataset.act || b.disabled) return;
        const a = b.dataset.act;
        const list = choices();
        const at = list.indexOf(b);
        if (at >= 0) cursor = at;
        switch (a) {
            case 'play': doAct({ t: 'play', c: +b.dataset.c }); break;
            case 'bid': doAct({ t: 'bid', v: +b.dataset.v }); break;
            case 'trump': doAct({ t: 'trump', s: +b.dataset.s }); break;
            case 'pick': doAct({ t: 'pick', k: b.dataset.k }); break;
            case 'next': next(); break;
            case 'deal': startSolo(); break;
            case 'resume': resumeSolo(); break;
            case 'again': startSolo(); break;
            case 'rematch': rematch(); break;
            case 'menu': openMenu(true); break;
            case 'leave': leave(); openMenu(true); break;
            case 'pause': pause(); break;
            case 'sheet': toggleSheet(); break;
            case 'how': howFor = G && G.st && screen === 'play' ? G.st.game : prefs().game; render(); break;
            case 'howclose': howFor = ''; render(); break;
            case 'online':
                if (typeof openNetplay === 'function') openNetplay({ gameId: 'kartz' });
                else if (window.Netplay) Netplay.openLobby({ gameId: 'kartz' });
                break;
        }
    }

    // ===============================================================
    // the score sheet: its own window, every hand on a line
    // ===============================================================
    function closeSheet() { if (sheet && sheet.close) { const s = sheet; sheet = null; try { s.close(); } catch (e) { } } sheet = null; }
    function toggleSheet() {
        if (sheet && sheet.win && document.getElementById(sheet.win.id)) { closeSheet(); return; }
        if (!G || !G.st) return;
        const vw = typeof viewportWidth === 'function' ? viewportWidth() : 800;
        const w = createAppWindow('kartz 98 · score sheet', { icon: 'style', width: min(420, vw - 20) });
        w.body.classList.add('kz-sheet-body');
        sheet = w;
        w.win._cleanup = () => { if (sheet === w) sheet = null; };
        refreshSheet();
    }
    function refreshSheet() {
        if (!sheet || !sheet.body || !G || !G.st) return;
        const st = G.st;
        const head = st.seats.map((p, i) => `<th>${esc(i === G.me ? 'you' : p.name.replace(/ bot$/, ''))}</th>`).join('');
        const what = r => (st.game === 'batak' ? esc(st.seats[r.bidder].name.replace(/ bot$/, '')) + ' ' + r.bid + S.SUIT_GLYPH[r.trump]
            : st.game === 'king' ? esc(S.CONTRACT[r.contract].name) + (r.trump >= 0 ? ' ' + S.SUIT_GLYPH[r.trump] : '') : (r.pistis.some(x => x) ? r.pistis.reduce((a, b) => a + b, 0) + ' pisti' : ''));
        const rows = st.history.map(r => `<tr><td>${r.h}</td><td class="kz-what">${what(r)}</td>${r.pts.map(v => `<td>${v}</td>`).join('')}</tr>`).join('');
        const html = `<div class="kz-sheet"><table class="kz-table-s"><thead><tr><th>#</th><th>${st.game === 'king' ? 'contract' : st.game === 'batak' ? 'bid' : ''}</th>${head}</tr></thead>
            <tbody>${rows || `<tr><td colspan="${st.n + 2}">no hands finished yet</td></tr>`}</tbody>
            <tfoot><tr><td></td><td>total</td>${st.scores.map(v => `<td><b>${v}</b></td>`).join('')}</tr></tfoot></table>
            ${st.game === 'king' ? `<p class="kz-small">left to call: ${S.PENALTIES.map(k => esc(S.CONTRACT[k].name) + ' ' + (2 - st.used[k])).join(', ')}</p>` : ''}</div>`;
        if (sheet.body._html !== html) { sheet.body.innerHTML = html; sheet.body._html = html; }
    }

    // ===============================================================
    // online: the host runs the table, guests ask
    // ===============================================================
    const hostIdOf = s => s.hostId || ((s.players.find(p => p.host) || {}).id) || '';
    function send(g, type, data, to) {
        const s = g.session;
        if (!s || !s.alive) return;
        if (g.host) s.send(type, data, to);
        else s.sendToHost(type, data);
    }
    function broadcast(g) {
        const st = g.st;
        st.seats.forEach((p, i) => {
            if (p.bot || p.id === g.session.id) return;
            send(g, 'kartz:state', { m: g.mid, st: S.view(st, i) }, p.id);
        });
    }
    function startOnline(session, opts) {
        ensureWindow();
        leave(true);
        const o = opts || {};
        const game = GAME_IDS.includes(o.options && o.options.game) ? o.options.game : GAME_IDS.includes(session.gameOptions && session.gameOptions.game) ? session.gameOptions.game : 'batak';
        const ids = Array.isArray(o.slots) && o.slots.length ? o.slots : session.players.map(p => p.id);
        const people = ids.map(id => { const p = session.player(id); return { id, name: p ? p.name : 'player' }; });
        const seed = Number.isFinite(+o.seed) ? (+o.seed >>> 0) : (Math.random() * 4294967296) >>> 0;
        const g = makeG({ session, host: !!session.isHost, mid: 'm' + seed });
        g.game = game;
        G = g;
        screen = 'play';
        if (g.host) {
            g.st = S.newMatch({ game, seed, seats: people, length: 'short' });
            g.me = g.st.seats.findIndex(p => p.id === session.id);
            g.lastEv = g.drawnEv = g.st.evN;
        }
        bindNet(g);
        if (g.host) changed(true);
        else { g.hiAt = performance.now(); send(g, 'kartz:hi', { m: g.mid }); render(); }
    }
    function bindNet(g) {
        const s = g.session;
        if (g.host) {
            g.offs.push(
                s.on('kartz:act', (d, from) => {
                    if (G !== g || !from || !d || typeof d !== 'object' || d.m !== g.mid) return;
                    const i = g.st.seats.findIndex(p => p.id === from.id && !p.bot);
                    const a = S.readAction(d.a);
                    if (i >= 0 && a && S.act(g.st, i, a)) { setWait(g); changed(); return; }
                    // refused: put them straight again
                    if (i >= 0) send(g, 'kartz:state', { m: g.mid, st: S.view(g.st, i) }, from.id);
                }),
                s.on('kartz:hi', (d, from) => {
                    if (G !== g || !from) return;
                    const i = g.st.seats.findIndex(p => p.id === from.id);
                    send(g, 'kartz:state', { m: g.mid, st: S.view(g.st, i) }, from.id);
                }),
                s.on('player-leave', p => {
                    if (G !== g || !p) return;
                    const i = g.st.seats.findIndex(x => x.id === p.id);
                    if (i >= 0 && S.seatBot(g.st, i)) { setWait(g); changed(); }
                })
            );
        } else {
            g.offs.push(
                s.on('kartz:state', (d, from) => {
                    if (G !== g || !from || from.id !== hostIdOf(s) || !d || typeof d !== 'object') return;
                    const st = d.st;
                    if (!st || st.v !== 1 || !Array.isArray(st.seats) || !Array.isArray(st.hands) || !Array.isArray(st.log)) return;
                    if (d.m !== g.mid) { g.mid = String(d.m); g.recorded = false; g.lastEv = 0; g.drawnEv = 0; cursor = -1; }
                    else if (g.st && st.evN < g.st.evN) return;
                    g.st = st; g.me = st.me; g.pending = false; g.netDown = false;
                    g.waitUntil = performance.now() + 250;
                    readEvents(g);
                    render();
                    refreshSheet();
                }),
                s.on('player-leave', p => { if (G === g && p && p.host) lost('the host left the table.'); }),
                s.on('net:down', () => { if (G === g) { g.netDown = true; render(); } }),
                s.on('net:up', () => { if (G === g && g.netDown) { g.netDown = false; render(); } }),
                s.on('closed', () => { if (G === g) lost('the table closed.'); })
            );
        }
    }
    function rematch() {
        const g = G;
        if (!g || !g.host || !g.online || !g.st || !g.st.over) return;
        const seed = (Math.random() * 4294967296) >>> 0;
        const seats = g.st.seats.map(p => ({ id: p.id, name: p.name, bot: p.bot }));
        g.st = S.newMatch({ game: g.st.game, seed, seats, length: g.st.length, n: g.st.n });
        g.mid = 'm' + seed; g.recorded = false; g.lastEv = g.drawnEv = g.st.evN;
        changed(true);
    }
    function lost(why) {
        const s = G && G.session;
        leave();
        openMenu(true);
        if (over) over.insertAdjacentHTML('afterbegin', `<div class="kz-lost">${esc(why)} back to the menu.</div>`);
        if (s && s.alive) s.leave();
    }
    function leave(keepSession) {
        const g = G;
        if (!g) return;
        g.offs.forEach(off => { try { off(); } catch (e) { } });
        g.offs = [];
        if (!keepSession && g.session && g.session.alive) g.session.leave();
        G = null;
        howFor = '';
    }

    // ===============================================================
    // the way in
    // ===============================================================
    function openMenu(force) {
        ensureWindow();
        if (!force && G && screen === 'play') { render(); return; }
        if (G && !G.online) G = null;
        screen = 'menu';
        render();
    }
    window.startKartz = function () { openMenu(false); return winRef && winRef.win; };
    // the lobby's picture of a player: two cards in a fan on the felt
    function paintAvatar(canvas) {
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        const s = window.Netplay && Netplay.current;
        const i = s ? max(0, s.players.findIndex(p => p.id === canvas.dataset.pid)) : 0;
        c.fillStyle = '#0a7a3a'; c.fillRect(0, 0, w, h);
        const suits = [['\u2665', '#c00000'], ['\u2660', '#000'], ['\u2666', '#c00000'], ['\u2663', '#000']];
        for (let k = 0; k < 2; k++) {
            c.save();
            c.translate(w / 2, h * 0.62); c.rotate((k ? 0.22 : -0.22));
            const cw = w * 0.42, ch = h * 0.6;
            c.fillStyle = '#000'; c.fillRect(-cw / 2 - 1, -ch - 1, cw + 2, ch + 2);
            c.fillStyle = '#fff'; c.fillRect(-cw / 2, -ch, cw, ch);
            const [g, col] = suits[(i + k) % 4];
            c.fillStyle = col; c.font = 'bold ' + floor(ch * 0.5) + 'px Tahoma, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText(g, 0, -ch / 2);
            c.restore();
        }
    }
    if (window.Netplay) {
        Netplay.registerGame({
            id: 'kartz',
            name: 'kartz 98',
            start: (s, opts) => { if (opts && opts.solo) { openMenu(true); return; } startOnline(s, opts); },
            startSolo: () => openMenu(true),
            soloLabel: 'play with bots',
            paintAvatar
        });
    }
    // for the tests: the match, the clock turned up, a bot at this seat
    window.KARTZ_ENGINE = {
        sim: S,
        state: () => (G ? G.st : null),
        game: () => G,
        screen: () => screen,
        startSolo,
        act: a => doAct(a),
        next,
        ff: n => { ff = max(1, +n || 1); if (G) G.waitUntil = min(G.waitUntil, performance.now()); },
        auto: on => { if (G) { G.auto = !!on; G.waitUntil = performance.now(); } },
        stats,
        sheetOpen: () => !!(sheet && sheet.win && document.getElementById(sheet.win.id))
    };
})();
