// ===================================================================
// LOBBIES — the open lobby list and quick match
//
// An invite code only helps if you have somebody to send it to. This is
// for everybody else: a host can put its lobby on a public list, and
// anyone with the lobby window open sees it and joins with one click.
//
// There is still no server. The list lives on the same public nostr relays
// the bus transport plays over (netplay.js, NOSTR_DEFAULTS), with the same
// sockets code, so a relay that says no gets the same good manners. Every
// listing is an ephemeral event: the relay passes it on and forgets it.
// A host says its listing again every few seconds, a browser that opens
// the list asks out loud and hosts answer, and anything not heard from
// for TTL_MS drops off. When the host leaves, starts, or fills up, it says
// "gone", and the time limit catches the hosts that never got to.
//
// What arrives off a public relay is a stranger's writing. Everything in
// a listing is checked against the game catalogue, cut to length and
// escaped before it is drawn; the signature is checked here as well as at
// the relay; one key gets one listing and one event a second; and the list
// has a ceiling. A flood can fill the list for as long as it keeps posting,
// it cannot break it.
//
// Not loaded at boot. netplay.js pulls it in the first time the lobby
// window shows the list, and nothing connects until then.
// ===================================================================
(function () {
    'use strict';
    const NP = window.Netplay;
    if (!NP || NP.Lobbies) return;
    const L = {};
    NP.Lobbies = L;
    const { KIND, bip340, RelayPool, signEvent, verifyEvent } = NP.nostr;

    const TAG = 'mrh98-lobbies-1';            // listings and goodbyes
    const ASK_TAG = 'mrh98-lobbies-1-ask';    // "who is out there?", which only hosts hear
    // a test can make the clock shorter. Nothing else reads these
    const knob = (name, fallback) => { const v = Number(window[name]); return v > 0 ? v : fallback; };
    const TTL_MS = knob('NP_LOBBY_TTL_MS', 40000);     // unheard from for this long is gone
    const EVERY_MS = Math.round(TTL_MS * 0.35);        // so a host says it about three times a ttl
    const HOST_GAP_MS = Math.min(2500, EVERY_MS);      // and never faster than this, whoever asks
    const KEY_GAP_MS = 1000;                           // the list takes one event a second per key
    const ASK_GAP_MS = 3000;
    const SKEW_S = 120;                                // how wrong a stranger's clock may be
    const MAX_CONTENT = 512;                           // characters of listing
    const MAX_FRAME = 2048;                            // a whole relay frame, before it is even parsed
    const MAX_KEYS = 80;                               // listings remembered
    const MAX_SHOWN = 30;                              // and drawn
    const VERIFY_PER_10S = 40;                         // signatures checked, at most
    const REGIONS = ['africa', 'america', 'antarctica', 'asia', 'atlantic', 'australia', 'europe', 'indian', 'pacific'];
    const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;
    const HEX64 = /^[0-9a-f]{64}$/, HEX128 = /^[0-9a-f]{128}$/, NONCE = /^[a-z0-9]{4,12}$/;
    Object.assign(L, { TAG, ASK_TAG, TTL_MS, EVERY_MS, MAX_CONTENT, MAX_KEYS, MAX_SHOWN });

    const esc = NP.esc;

    // ===============================================================
    // reading a listing. Pure, so check-lobbies.mjs can hold it to account
    // ===============================================================

    // control characters, the invisible ones, the ones that turn text round,
    // and more than two accents stacked on one letter
    const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿￰-￿]/g;
    const STACKED = /([̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]{2})[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]+/g;
    function cleanText(s, max) {
        if (typeof s !== 'string') return '';
        const flat = s.replace(/[\t\n\v\f\r]/g, ' ').replace(INVISIBLE, '').replace(STACKED, '$1').replace(/\s+/g, ' ').trim();
        // by code point, so an emoji is not cut in half
        return Array.from(flat).slice(0, max).join('').trim();
    }
    // a game's own rules, never the listing's, decide how many seats there are
    function seatsFor(game, opts) {
        const lo = game.min || 2, hi = game.max || lo;
        let n = hi;
        if (typeof game.seats === 'function') {
            try { n = Math.round(Number(game.seats(opts || {}))); } catch (e) { n = hi; }
        }
        return Math.max(lo, Math.min(hi, Number.isFinite(n) && n > 0 ? n : hi));
    }
    // only the options the game has, and only values it offers
    function cleanOptions(game, o) {
        const out = {};
        const given = o && typeof o === 'object' && !Array.isArray(o) ? o : {};
        (game.options || []).forEach(opt => {
            const v = Object.prototype.hasOwnProperty.call(given, opt.key) ? given[opt.key] : undefined;
            out[opt.key] = opt.values.some(x => x[0] === v) ? v : opt.values[0][0];
        });
        return out;
    }
    // what quick match matches on: the first thing a game lets the host pick
    function modeKey(game) { return game && game.options && game.options.length ? game.options[0].key : null; }
    function optionLabels(game, opts) {
        return (game.options || []).map(o => (o.values.find(v => v[0] === (opts || {})[o.key]) || o.values[0])[1]);
    }
    function region() {
        try {
            const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            const r = zone.split('/')[0].toLowerCase();
            return REGIONS.includes(r) ? r : null;
        } catch (e) { return null; }
    }

    // ev, the relay's event, and the time in seconds. Returns exactly one of
    // { listing }, { gone }, { ask } or { why }. The signature is not looked
    // at here: that is the expensive part, and only what survives this gets it.
    function readEvent(ev, nowS) {
        if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return { why: 'not an event' };
        if (ev.kind !== KIND) return { why: 'wrong kind' };
        if (typeof ev.id !== 'string' || !HEX64.test(ev.id) || typeof ev.pubkey !== 'string' || !HEX64.test(ev.pubkey) ||
            typeof ev.sig !== 'string' || !HEX128.test(ev.sig)) return { why: 'not signed' };
        if (!Number.isInteger(ev.created_at) || Math.abs(ev.created_at - nowS) > SKEW_S) return { why: 'stale' };
        if (!Array.isArray(ev.tags) || ev.tags.length > 4) return { why: 'bad tags' };
        const d = ev.tags.find(t => Array.isArray(t) && t[0] === 'd');
        if (!d || (d[1] !== TAG && d[1] !== ASK_TAG)) return { why: 'not a lobby' };
        if (typeof ev.content !== 'string' || ev.content.length > MAX_CONTENT) return { why: 'too big' };
        let c = null;
        try { c = JSON.parse(ev.content); } catch (e) { return { why: 'not json' }; }
        if (!c || typeof c !== 'object' || Array.isArray(c) || c.v !== 1) return { why: 'not a listing' };

        if (d[1] === ASK_TAG) {
            if (c.ask !== 1) return { why: 'not an ask' };
            return { ask: { key: ev.pubkey, q: typeof c.q === 'string' && NONCE.test(c.q) ? c.q : null, game: typeof c.g === 'string' && NP.byId(c.g) ? c.g : null } };
        }
        if (c.gone === 1) {
            return typeof c.c === 'string' && CODE_RE.test(c.c) ? { gone: { key: ev.pubkey, code: c.c } } : { why: 'bad code' };
        }
        const game = typeof c.g === 'string' ? NP.byId(c.g) : null;
        if (!game) return { why: 'unknown game' };
        if (c.pv !== NP.VERSION) return { why: 'another version of the site' };
        if (typeof c.c !== 'string' || !CODE_RE.test(c.c)) return { why: 'bad code' };
        const opts = cleanOptions(game, c.o);
        const seats = seatsFor(game, opts);
        if (!Number.isInteger(c.p) || c.p < 1 || c.p > seats) return { why: 'bad player count' };
        // both times are off the host's own clock, so its age survives the clock being wrong
        if (!Number.isInteger(c.t) || c.t > ev.created_at + 5 || c.t < ev.created_at - 6 * 3600) return { why: 'bad age' };
        const key = modeKey(game);
        return {
            listing: {
                key: ev.pubkey, code: c.c, game: game.id, opts, mode: key ? opts[key] : null,
                name: cleanText(c.n, 16) || 'someone', players: c.p, seats,
                region: REGIONS.includes(c.r) ? c.r : null,
                q: typeof c.q === 'string' && NONCE.test(c.q) ? c.q : null,
                since: c.t, openFor: ev.created_at - c.t, created: ev.created_at
            }
        };
    }

    // ===============================================================
    // the list itself: one listing per key, one per code, nothing stale
    // ===============================================================
    function Directory(now) {
        now = now || Date.now;
        const keys = new Map();      // pubkey -> { listing, at, first }
        const lastAt = new Map();    // pubkey -> when it last got a hearing
        const dir = { keys };

        // cheap, and before the signature: one event a second per key, and a
        // ceiling on how many keys get remembered at all
        dir.gate = function (key) {
            const t = now();
            if (t - (lastAt.get(key) || -Infinity) < KEY_GAP_MS) return false;
            if (!keys.has(key) && keys.size >= MAX_KEYS) {
                dir.prune();
                if (keys.size >= MAX_KEYS) return false;
            }
            if (lastAt.size > MAX_KEYS * 4) lastAt.forEach((at, k) => { if (t - at > KEY_GAP_MS) lastAt.delete(k); });
            lastAt.set(key, t);
            return true;
        };
        dir.put = function (l) {
            const had = keys.get(l.key);
            // an older copy that a slower relay has only just passed on
            if (had && had.listing.created > l.created) return false;
            const same = had && had.listing.code === l.code;
            if (!l.ping && same && had.listing.ping) l.ping = had.listing.ping;
            keys.set(l.key, { listing: l, at: now(), first: same ? had.first : now() });
            return true;
        };
        dir.has = (key, code) => { const had = keys.get(key); return !!had && had.listing.code === code; };
        // only the key that said it can take its own listing down
        dir.gone = function (key, code) {
            if (!dir.has(key, code)) return false;
            keys.delete(key);
            return true;
        };
        dir.prune = function () {
            const t = now();
            keys.forEach((v, k) => { if (t - v.at > TTL_MS) keys.delete(k); });
        };
        dir.list = function () {
            dir.prune();
            const t = now();
            const byCode = new Map();
            keys.forEach(v => {
                const l = v.listing;
                if (l.players >= l.seats) return;                 // nothing left to join
                const other = byCode.get(l.code);
                // two keys claiming one code: whoever claimed it first keeps it
                if (!other || v.first < other.first) byCode.set(l.code, v);
            });
            return [...byCode.values()]
                .map(v => Object.assign({}, v.listing, { age: Math.max(0, v.listing.openFor) + Math.round((t - v.at) / 1000) }))
                .sort((a, b) => (b.players - a.players) || (b.age - a.age))
                .slice(0, MAX_SHOWN);
        };
        dir.clear = () => { keys.clear(); lastAt.clear(); };
        return dir;
    }

    // the best open lobby for this game and mode, or null. mode null is any
    function pickMatch(list, gameId, mode, skip) {
        const game = NP.byId(gameId);
        if (!game) return null;
        const key = modeKey(game);
        return list.filter(l => l.game === gameId && l.players < l.seats && !(skip && skip.has(l.code)) &&
            (!mode || !key || l.opts[key] === mode))
            .sort((a, b) => (b.players - a.players) || ((a.ping || 9e9) - (b.ping || 9e9)) || (b.age - a.age))[0] || null;
    }
    // Two people pressing quick match at once both find nothing and both open a
    // lobby, and then wait for each other forever. So a quick match lobby with
    // nobody in it yet moves into a matching one that opened before it. The
    // older one never moves, so exactly one of the two does.
    function olderMatch(mine, list) {
        return list.filter(l => l.game === mine.game && l.code !== mine.code && l.players < l.seats &&
            (!mine.mode || l.mode === mine.mode) &&
            (l.since < mine.since || (l.since === mine.since && l.code < mine.code)))
            .sort((a, b) => (a.since - b.since) || (a.code < b.code ? -1 : 1))[0] || null;
    }
    Object.assign(L, { readEvent, Directory, cleanText, cleanOptions, seatsFor, modeKey, optionLabels, pickMatch, olderMatch, region });

    // ===============================================================
    // the hub: one set of sockets per page, opened by the first thing that
    // needs it (the list on screen, or a listed lobby) and closed by the last
    // ===============================================================
    let hub = null;
    function useHub() {
        if (hub) return hub;
        const h = { watchers: new Set(), hosts: new Set(), asks: new Map(), stats: { accepted: 0, rejected: 0, why: {} } };
        hub = h;
        h.dir = Directory();
        h.sk = bip340.newKey();
        h.ready = bip340.pubkey(h.sk).then(p => { h.pub = bip340.toHex(p); });
        let seen = new Set(), seenBefore = new Set();
        let tokens = VERIFY_PER_10S, refilled = Date.now();
        const spend = () => {
            const t = Date.now();
            tokens = Math.min(VERIFY_PER_10S, tokens + ((t - refilled) / 10000) * VERIFY_PER_10S);
            refilled = t;
            if (tokens < 1) return false;
            tokens--;
            return true;
        };
        const reject = why => { h.stats.rejected++; h.stats.why[why] = (h.stats.why[why] || 0) + 1; };
        let changeTimer = 0;
        h.changed = () => {
            if (changeTimer) return;
            changeTimer = setTimeout(() => {
                changeTimer = 0;
                const list = h.dir.list();
                h.watchers.forEach(w => { try { w.onChange(list); } catch (e) { } });
            }, 40);
        };

        h.onEvent = async function (ev) {
            if (!ev || typeof ev.id !== 'string' || seen.has(ev.id) || seenBefore.has(ev.id)) return;
            seen.add(ev.id);
            if (seen.size > 600) { seenBefore = seen; seen = new Set(); }
            if (ev.pubkey === h.pub) return;
            const r = readEvent(ev, Math.floor(Date.now() / 1000));
            // an ask costs a host at most one announcement a few seconds, so
            // it is not worth a signature check
            if (r.ask) { h.hosts.forEach(a => a.asked(r.ask)); return; }
            if (!h.watchers.size) return;
            if (r.gone) {
                if (!h.dir.has(r.gone.key, r.gone.code)) return;
                if (!spend() || !(await verifyEvent(ev))) return reject('bad signature');
                if (h.dir.gone(r.gone.key, r.gone.code)) h.changed();
                return;
            }
            if (!r.listing) return reject(r.why);
            if (!h.dir.gate(r.listing.key)) return reject('too fast');
            if (!spend()) return reject('too many to check');
            if (!(await verifyEvent(ev))) return reject('bad signature');
            const asked = r.listing.q && h.asks.get(r.listing.q);
            if (asked) r.listing.ping = Math.max(1, Date.now() - asked);
            h.stats.accepted++;
            if (h.dir.put(r.listing)) h.changed();
        };

        h.pool = RelayPool({
            sub: 'lb',
            maxFrame: MAX_FRAME,
            filters: () => {
                const s = Math.floor(Date.now() / 1000), f = [];
                if (h.watchers.size) f.push({ kinds: [KIND], '#d': [TAG], since: s - 30 });
                if (h.hosts.size) f.push({ kinds: [KIND], '#d': [ASK_TAG], since: s - 10 });
                return f;
            },
            onEvent: ev => { h.onEvent(ev); },
            onOpen: () => {
                h.opened = true;
                // the other relays are usually a moment behind the first
                if (h.watchers.size) setTimeout(() => h.ask(), 500);
                h.hosts.forEach(a => a.soon(500));
            }
        });

        h.publish = async function (tag, content) {
            await h.ready;
            const ev = await signEvent(h.sk, h.pub, KIND, [['d', tag]], JSON.stringify(content));
            if (hub === h) h.pool.sendEvent(ev);
            return ev;
        };
        h.sign = async function (tag, content) {
            await h.ready;
            return signEvent(h.sk, h.pub, KIND, [['d', tag]], JSON.stringify(content));
        };
        let lastAsk = 0;
        h.ask = function () {
            const t = Date.now();
            if (!h.watchers.size || t - lastAsk < ASK_GAP_MS || !h.pool.up()) return;
            lastAsk = t;
            const q = Math.random().toString(36).slice(2, 10);
            h.asks.set(q, t);
            if (h.asks.size > 6) h.asks.delete(h.asks.keys().next().value);
            h.publish(ASK_TAG, { v: 1, ask: 1, q }).catch(() => { });
        };
        h.refresh = () => { h.pool.resubscribe(); };
        h.release = function () {
            if (h.watchers.size || h.hosts.size) { h.pool.resubscribe(); return; }
            // let a goodbye that was just handed over get out of the door
            setTimeout(() => {
                if (h.watchers.size || h.hosts.size) return;
                h.pool.close();
                clearTimeout(changeTimer);
                if (hub === h) hub = null;
            }, 400);
        };
        h.pool.open();
        return h;
    }
    L.stats = () => (hub ? Object.assign({ listed: hub.dir.keys.size, up: hub.pool.up() }, hub.stats) : null);

    // listen while something on screen wants the list. Returns the stop
    L.watch = function (onChange) {
        const h = useHub();
        const w = { onChange };
        const first = !h.watchers.size;
        h.watchers.add(w);
        if (first) h.refresh();
        if (h.opened) setTimeout(() => h.ask(), first ? 50 : 0);
        setTimeout(() => onChange(h.dir.list()), 0);
        return () => {
            if (!h.watchers.delete(w)) return;
            if (!h.watchers.size) h.dir.clear();
            h.release();
        };
    };
    L.current = () => (hub && hub.watchers.size ? hub.dir.list() : []);
    L.up = () => !!(hub && hub.pool.up());

    // ===============================================================
    // a host's side: put session on the list and keep it right until the
    // match starts, the lobby fills or the host goes
    // ===============================================================
    L.announce = function (session, opts) {
        if (session.listing) return session.listing;
        const h = useHub();
        const since = Math.floor(Date.now() / 1000);
        const a = { quick: !!(opts && opts.quick), listed: false, stopped: false, since };
        let last = 0, timer = 0, q = null, goneEv = null;
        const offs = [];

        const game = () => NP.byId(session.gameId);
        const full = () => session.players.length >= seatsFor(game(), cleanOptions(game(), session.gameOptions));
        function content() {
            const g = game(), o = cleanOptions(g, session.gameOptions);
            const c = {
                v: 1, pv: NP.VERSION, g: g.id, o, c: session.code, n: cleanText(NP.profile().name, 16) || 'someone',
                p: session.players.length, m: seatsFor(g, o), t: since
            };
            const r = region();
            if (r) c.r = r;
            if (q) c.q = q;
            return c;
        }
        async function say() {
            timer = 0;
            if (a.stopped) return;
            if (!session.alive || session.state !== 'lobby') { a.stop('started'); return; }
            last = Date.now();
            if (full()) {
                // a full lobby comes off the list, and goes back on if a seat frees up
                if (a.listed) { a.listed = false; h.publish(TAG, { v: 1, gone: 1, c: session.code }).catch(() => { }); }
                return;
            }
            const c = content();
            q = null;
            try {
                await h.publish(TAG, c);
                a.listed = true;
                // signed now, so that a closing tab can say goodbye without waiting on maths
                goneEv = await h.sign(TAG, { v: 1, gone: 1, c: session.code });
            } catch (e) { }
        }
        a.soon = function (ms) {
            if (a.stopped || timer) return;
            timer = setTimeout(say, Math.max(ms || 0, last + HOST_GAP_MS - Date.now(), 0));
        };
        a.asked = function (ask) {
            if (ask.game && ask.game !== session.gameId) return;
            q = ask.q || q;
            a.soon(0);
        };
        a.info = () => ({ game: session.gameId, mode: a.mode || null, since, code: session.code });
        const onHide = () => { if (a.listed && goneEv) h.pool.sendEvent(goneEv); };
        a.stop = function (why) {
            if (a.stopped) return;
            a.stopped = true;
            a.why = why;
            clearTimeout(timer);
            clearInterval(every);
            offs.forEach(off => off());
            window.removeEventListener('pagehide', onHide);
            h.hosts.delete(a);
            if (session.listing === a) session.listing = null;
            if (a.listed) {
                a.listed = false;
                if (goneEv) h.pool.sendEvent(goneEv);
                else h.publish(TAG, { v: 1, gone: 1, c: session.code }).catch(() => { });
            }
            h.release();
            session.emit('listing', null);
        };

        h.hosts.add(a);
        session.listing = a;
        h.refresh();
        const every = setInterval(() => a.soon(0), EVERY_MS);
        offs.push(session.on('roster', () => a.soon(400)));
        offs.push(session.on('options', () => a.soon(400)));
        offs.push(session.on('game-pick', () => a.soon(400)));
        offs.push(session.on('start', () => a.stop('started')));
        offs.push(session.on('closed', () => a.stop('left')));
        window.addEventListener('pagehide', onHide);
        if (h.pool.up()) a.soon(0);
        session.emit('listing', a);
        return a;
    };

    // resolves with the best open lobby for the game and mode, as soon as one
    // turns up or after waitMs with null
    L.find = function (gameId, mode, waitMs, skip) {
        return new Promise(resolve => {
            let done = false, stop = null;
            const finish = l => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                setTimeout(() => stop && stop(), 0);
                resolve(l);
            };
            const timer = setTimeout(() => finish(pickMatch(L.current(), gameId, mode, skip)), waitMs || 3000);
            stop = L.watch(list => { const l = pickMatch(list, gameId, mode, skip); if (l) finish(l); });
        });
    };

    // ===============================================================
    // the list, drawn into the lobby window
    // ===============================================================
    const CSS = `
.np-lb-head{display:flex;align-items:baseline;gap:6px}
.np-lb-count{margin-left:auto;font-size:10px;color:#333;font-weight:normal}
.np-lb-list{max-height:184px;overflow-y:auto;background:#fff;border-top:2px solid #404040;border-left:2px solid #404040;border-right:2px solid #fff;border-bottom:2px solid #fff}
.np-lb-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-bottom:1px dotted #999}
.np-lb-row.np-lb-other{opacity:.65}
.np-lb-main{flex:1;min-width:0}
.np-lb-title,.np-lb-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-lb-sub{font-size:10px;color:#444}
.np-lb-seats{flex-shrink:0;width:54px;text-align:center;font-size:10px;line-height:1.2}
.np-lb-empty{padding:8px;color:#444;font-size:10.5px}
.np-check{display:flex;align-items:center;gap:5px;font-size:10.5px;margin-top:6px;cursor:pointer}
.np-quickrow{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.np-quickrow .np-input{flex:1 1 90px}`;
    L.css = function () {
        if (document.getElementById('np-lb-css')) return;
        const s = document.createElement('style');
        s.id = 'np-lb-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    };

    function ago(s) {
        if (s < 45) return 'just now';
        if (s < 3600) return Math.round(s / 60) + 'm';
        return Math.floor(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm';
    }

    // el: where to draw. ctx: { game() -> the game picked above, join(listing),
    // mine() -> a code not to show, which is the one you are hosting }
    L.mountList = function (el, ctx) {
        L.css();
        el.innerHTML = `
            <div class="np-card np-lb">
                <div class="np-card-title np-lb-head">open lobbies <span class="np-lb-count" id="np-lb-count">tuning in...</span></div>
                <div class="np-lb-list" id="np-lb-list"><div class="np-lb-empty">listening to the public relays...</div></div>
            </div>`;
        const listEl = el.querySelector('#np-lb-list'), countEl = el.querySelector('#np-lb-count');
        const dead = new Map();          // code -> until, for a lobby that would not let us in
        let rows = [], stopped = false;
        const opened = Date.now();

        function draw() {
            if (stopped) return;
            if (!el.isConnected) { ui.stop(); return; }
            const t = Date.now(), want = ctx.game(), mine = ctx.mine && ctx.mine();
            dead.forEach((until, code) => { if (until < t) dead.delete(code); });
            rows = L.current().filter(l => l.code !== mine && !dead.has(l.code))
                .sort((a, b) => ((b.game === want) - (a.game === want)));
            const up = L.up();
            countEl.textContent = !up ? (t - opened > 9000 ? "can't reach the public relays" : 'tuning in...')
                : rows.length ? rows.length + ' open' : 'none right now';
            if (!rows.length) {
                listEl.innerHTML = `<div class="np-lb-empty">${up
                    ? "nobody's hosting in public right now. hit quick match and you're the lobby the next stranger finds, bradar."
                    : 'listening to the public relays...'}</div>`;
                return;
            }
            listEl.innerHTML = rows.map(l => {
                const game = NP.byId(l.game);
                const bits = optionLabels(game, l.opts);
                const where = [l.region, l.ping ? '~' + l.ping + 'ms' : null].filter(Boolean).join(' · ') || 'somewhere';
                const free = l.seats - l.players;
                return `<div class="np-lb-row${l.game === want ? '' : ' np-lb-other'}">
                    <div class="np-lb-main">
                        <div class="np-lb-title"><b>${esc(game.name)}</b>${bits.map(b => ' · ' + esc(b)).join('')}</div>
                        <div class="np-lb-sub">${esc(l.name)} · ${esc(where)} · open ${esc(ago(l.age))}</div>
                    </div>
                    <div class="np-lb-seats"><b>${l.players}/${l.seats}</b><br>${free} free</div>
                    <button class="np-btn np-small np-go np-lb-join" data-code="${esc(l.code)}">join</button>
                </div>`;
            }).join('');
        }
        listEl.addEventListener('click', e => {
            const b = e.target.closest && e.target.closest('[data-code]');
            if (!b) return;
            const l = rows.find(r => r.code === b.dataset.code);
            if (l) ctx.join(l);
        });
        const unwatch = L.watch(() => draw());
        const tick = setInterval(draw, 2500);      // ages, the ttl and the relays coming up
        const ui = {
            draw,
            hide(code) { dead.set(code, Date.now() + 60000); draw(); },
            stop() {
                if (stopped) return;
                stopped = true;
                clearInterval(tick);
                unwatch();
            }
        };
        draw();
        return ui;
    };
})();
