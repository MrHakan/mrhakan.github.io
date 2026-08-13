// ===================================================================
// NETPLAY — invite-code lobbies for every game on this desktop
//
// The site is static files on github pages. There is no server to run a
// game on, and there never will be, so multiplayer here is peer to peer:
// two browsers open a webrtc data channel and talk straight to each
// other. The only thing a "server" is needed for is introducing them,
// and that is what the invite code does.
//
// Three transports, same interface, picked in the lobby:
//
//   peer   webrtc through the public peerjs broker. real internet play,
//          no server of mine involved. the default.
//   relay  a websocket relay you host yourself (server/relay.js). for
//          networks that block p2p, or if the public broker is down.
//   local  broadcastchannel between two tabs of the same browser. costs
//          nothing, works offline, and is how you test a game at 3am
//          when nobody is awake to play with you.
//
// Games register themselves here and get a lobby for free — see
// NP.CATALOG at the bottom and games/wizardz.js for a worked example.
// ===================================================================
(function () {
    'use strict';

    const NP = {};
    window.Netplay = NP;

    NP.VERSION = 1;                 // protocol version, bumped on breaking changes
    const PEER_PREFIX = 'mrh98-';   // namespaces our codes on the shared public broker
    const PEERJS_CDN = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    // no 0/O/1/I/L — invite codes get read out loud over discord voice
    const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

    // ===============================================================
    // small helpers
    // ===============================================================
    function makeCode(len) {
        let s = '';
        const buf = new Uint8Array(len || 5);
        (window.crypto || {}).getRandomValues ? crypto.getRandomValues(buf) : buf.forEach((_, i) => buf[i] = Math.random() * 256);
        for (let i = 0; i < buf.length; i++) s += CODE_CHARS[buf[i] % CODE_CHARS.length];
        return s;
    }
    function randId() {
        return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function toast(title, msg) {
        if (typeof showToast === 'function') showToast(title, msg);
    }
    function beep(kind) {
        if (typeof playSound === 'function') playSound(kind);
    }
    NP.makeCode = makeCode;
    NP.esc = esc;

    // ---------------------------------------------------------------
    // profile — the name and wizard you show up as. lives in
    // localstorage, travels to the other player on join.
    // ---------------------------------------------------------------
    const PROFILE_KEY = 'mrhakan98-netplay-profile';
    const NAME_BITS = ['grim', 'mort', 'zap', 'hex', 'rune', 'bog', 'fizz', 'nyx', 'orb', 'cinder', 'gloom', 'thistle', 'vex', 'wisp'];
    function defaultProfile() {
        return {
            id: randId(),
            name: NAME_BITS[Math.floor(Math.random() * NAME_BITS.length)] + Math.floor(Math.random() * 900 + 100),
            avatar: null
        };
    }
    NP.profile = function () {
        let p = null;
        try { p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { p = null; }
        if (!p || !p.id || !p.name) { p = defaultProfile(); NP.saveProfile(p); }
        return p;
    };
    NP.saveProfile = function (p) {
        try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { }
        return p;
    };
    NP.setName = function (name) {
        const p = NP.profile();
        p.name = String(name || '').trim().slice(0, 16) || p.name;
        return NP.saveProfile(p);
    };
    // games call this when the player edits their character, so the
    // lobby and the opponent both see the new one
    NP.setAvatar = function (avatar) {
        const p = NP.profile();
        p.avatar = avatar;
        NP.saveProfile(p);
        if (NP.current) NP.current.announceProfile();
        return p;
    };

    // ---------------------------------------------------------------
    // relay url — only used by the relay transport. set it from the
    // lobby, or ship one in data/site.json under multiplayer.relay.
    // ---------------------------------------------------------------
    const RELAY_KEY = 'mrhakan98-netplay-relay';
    NP.relayUrl = function () {
        try { return localStorage.getItem(RELAY_KEY) || NP._siteRelay || ''; } catch (e) { return NP._siteRelay || ''; }
    };
    NP.setRelayUrl = function (url) {
        try { url ? localStorage.setItem(RELAY_KEY, url) : localStorage.removeItem(RELAY_KEY); } catch (e) { }
    };
    // best effort: the site config may carry a default relay
    try {
        if (typeof fetch === 'function' && typeof location !== 'undefined') {
            fetch('data/site.json').then(r => r.json()).then(j => {
                if (j && j.multiplayer && j.multiplayer.relay) NP._siteRelay = j.multiplayer.relay;
            }).catch(() => { });
        }
    } catch (e) { /* no network, no config, no problem */ }

    // ===============================================================
    // script loading — games and the peerjs client arrive on demand
    // ===============================================================
    const loaded = {};
    function loadScript(src) {
        if (loaded[src]) return loaded[src];
        loaded[src] = new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = res;
            s.onerror = () => { loaded[src] = null; rej(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
        return loaded[src];
    }
    NP.loadScript = loadScript;

    // ===============================================================
    // TRANSPORTS
    //
    // Every transport exposes the same four things:
    //   id            my peer id once open() resolves
    //   open()        promise, rejects with a human-readable message
    //   send(to,msg)  to is a peer id or '*'
    //   close()
    // and calls back through .h — { peer, data, leave, error, status }.
    // ===============================================================

    // ---------- local: two tabs, one browser, no network ----------
    function LocalTransport(code, isHost) {
        const t = { kind: 'local', id: randId(), h: {}, code };
        let ch = null;
        const CH = 'mrhakan98-np-' + code;

        function post(o) { try { ch.postMessage(o); } catch (e) { } }

        t.open = function () {
            return new Promise((resolve, reject) => {
                if (!window.BroadcastChannel) return reject(new Error('this browser has no broadcastchannel, use peer instead'));
                ch = new BroadcastChannel(CH);
                let settled = false;
                ch.onmessage = (ev) => {
                    const m = ev.data;
                    if (!m || m.from === t.id) return;
                    if (isHost) {
                        if (m.k === 'probe') { post({ k: 'busy', from: t.id }); return; }
                        if (m.k === 'knock') {
                            post({ k: 'welcome', from: t.id, to: m.from });
                            t.h.peer && t.h.peer(m.from);
                            return;
                        }
                    } else {
                        if (m.k === 'busy') return;
                        if (m.k === 'welcome' && m.to === t.id) {
                            t.hostId = m.from;
                            if (!settled) { settled = true; resolve(); }
                            t.h.peer && t.h.peer(m.from);
                            return;
                        }
                    }
                    if (m.k === 'bye') { t.h.leave && t.h.leave(m.from); return; }
                    if (m.k === 'data' && (m.to === '*' || m.to === t.id)) t.h.data && t.h.data(m.from, m.msg);
                };
                if (isHost) {
                    // make sure another tab is not already hosting this code
                    let busy = false;
                    const onBusy = (ev) => { if (ev.data && ev.data.k === 'busy') busy = true; };
                    ch.addEventListener('message', onBusy);
                    post({ k: 'probe', from: t.id });
                    setTimeout(() => {
                        ch.removeEventListener('message', onBusy);
                        if (busy) { try { ch.close(); } catch (e) { } reject(new Error('that code is already open in another tab')); }
                        else resolve();
                    }, 350);
                } else {
                    post({ k: 'knock', from: t.id });
                    setTimeout(() => {
                        if (!settled) { settled = true; try { ch.close(); } catch (e) { } reject(new Error('no lobby with that code in this browser')); }
                    }, 1500);
                }
            });
        };
        t.send = function (to, msg) { post({ k: 'data', from: t.id, to: to || '*', msg }); };
        t.close = function () { post({ k: 'bye', from: t.id }); try { ch && ch.close(); } catch (e) { } };
        return t;
    }

    // ---------- peer: webrtc through the public peerjs broker ----------
    function PeerTransport(code, isHost) {
        const t = { kind: 'peer', id: null, h: {}, code };
        let peer = null;
        const conns = new Map();     // peerId -> DataConnection (host side)
        let hostConn = null;         // guest side

        function wire(conn) {
            conn.on('data', d => t.h.data && t.h.data(conn.peer, d));
            conn.on('close', () => { conns.delete(conn.peer); t.h.leave && t.h.leave(conn.peer); });
            conn.on('error', () => { conns.delete(conn.peer); t.h.leave && t.h.leave(conn.peer); });
        }

        t.open = function () {
            return loadScript(PEERJS_CDN).catch(() => {
                throw new Error('could not reach the peerjs cdn — try the "same browser" mode');
            }).then(() => new Promise((resolve, reject) => {
                if (!window.Peer) return reject(new Error('peerjs did not load'));
                t.h.status && t.h.status(isHost ? 'opening the lobby...' : 'looking for the lobby...');
                peer = new Peer(isHost ? PEER_PREFIX + code : undefined, { debug: 0 });
                let settled = false;
                const fail = (msg) => { if (!settled) { settled = true; reject(new Error(msg)); } };

                peer.on('error', (err) => {
                    const type = (err && err.type) || '';
                    if (type === 'unavailable-id') return fail('that code is taken — make a new one');
                    if (type === 'peer-unavailable') return fail('nobody is hosting that code');
                    if (type === 'browser-incompatible') return fail('this browser cannot do webrtc');
                    if (!settled) return fail('could not reach the matchmaking broker (' + (type || 'network') + ')');
                    // after connect: a dead peer is a dropped opponent, not a fatal error
                    t.h.error && t.h.error(type || 'network trouble');
                });
                peer.on('open', (id) => {
                    t.id = id;
                    if (isHost) {
                        if (!settled) { settled = true; resolve(); }
                        return;
                    }
                    const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
                    hostConn = conn;
                    t.hostId = PEER_PREFIX + code;
                    conn.on('open', () => {
                        wire(conn);
                        if (!settled) { settled = true; resolve(); }
                        t.h.peer && t.h.peer(conn.peer);
                    });
                    setTimeout(() => fail('the host never answered — check the code'), 15000);
                });
                if (isHost) {
                    peer.on('connection', (conn) => {
                        conn.on('open', () => {
                            conns.set(conn.peer, conn);
                            wire(conn);
                            t.h.peer && t.h.peer(conn.peer);
                        });
                    });
                }
                peer.on('disconnected', () => {
                    t.h.status && t.h.status('reconnecting to the broker...');
                    try { peer.reconnect(); } catch (e) { }
                });
                setTimeout(() => fail('the broker took too long to answer'), 20000);
            }));
        };
        t.send = function (to, msg) {
            if (isHost) {
                if (!to || to === '*') conns.forEach(c => { try { c.send(msg); } catch (e) { } });
                else { const c = conns.get(to); if (c) { try { c.send(msg); } catch (e) { } } }
            } else if (hostConn) {
                try { hostConn.send(msg); } catch (e) { }
            }
        };
        t.close = function () {
            conns.forEach(c => { try { c.close(); } catch (e) { } });
            conns.clear();
            try { hostConn && hostConn.close(); } catch (e) { }
            try { peer && peer.destroy(); } catch (e) { }
        };
        return t;
    }

    // ---------- relay: your own websocket server ----------
    function RelayTransport(code, isHost) {
        const t = { kind: 'relay', id: randId(), h: {}, code };
        let ws = null;
        t.open = function () {
            return new Promise((resolve, reject) => {
                const url = NP.relayUrl();
                if (!url) return reject(new Error('no relay url set — put one in lobby settings'));
                let settled = false;
                try { ws = new WebSocket(url); } catch (e) { return reject(new Error('that relay url is not valid')); }
                ws.onopen = () => ws.send(JSON.stringify({ k: 'join', room: code, id: t.id, host: !!isHost, v: NP.VERSION }));
                ws.onmessage = (ev) => {
                    let m = null;
                    try { m = JSON.parse(ev.data); } catch (e) { return; }
                    if (m.k === 'joined') {
                        t.hostId = m.hostId || null;
                        if (!settled) { settled = true; resolve(); }
                        (m.peers || []).forEach(id => t.h.peer && t.h.peer(id));
                    } else if (m.k === 'peer') {
                        t.h.peer && t.h.peer(m.id);
                    } else if (m.k === 'bye') {
                        t.h.leave && t.h.leave(m.id);
                    } else if (m.k === 'data') {
                        t.h.data && t.h.data(m.from, m.msg);
                    } else if (m.k === 'err') {
                        if (!settled) { settled = true; reject(new Error(m.msg || 'the relay said no')); }
                        else t.h.error && t.h.error(m.msg || 'relay error');
                    }
                };
                ws.onerror = () => { if (!settled) { settled = true; reject(new Error('could not reach the relay')); } };
                ws.onclose = () => { if (!settled) { settled = true; reject(new Error('the relay closed the connection')); } else t.h.error && t.h.error('the relay dropped'); };
                setTimeout(() => { if (!settled) { settled = true; reject(new Error('the relay never answered')); } }, 12000);
            });
        };
        t.send = function (to, msg) {
            if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify({ k: 'data', to: to || '*', msg })); } catch (e) { } }
        };
        t.close = function () { try { ws && ws.close(); } catch (e) { } };
        return t;
    }

    NP.TRANSPORTS = {
        peer: { make: PeerTransport, label: 'internet (p2p)', note: 'webrtc via the public broker. share the code with anyone, anywhere.' },
        relay: { make: RelayTransport, label: 'my relay server', note: 'a websocket relay you host yourself. see server/relay.js.' },
        local: { make: LocalTransport, label: 'same browser', note: 'two tabs on this machine. no network at all — good for testing.' }
    };

    // ===============================================================
    // SESSION — roster, routing and the little protocol on top
    //
    // The host is authoritative for the roster and, in most games, for
    // the simulation too. Guests always talk to the host; if a message
    // is addressed to a third player the host forwards it. Star
    // topology, one hop, nothing clever.
    // ===============================================================
    function Session(transport, isHost, code) {
        const s = this;
        s.transport = transport;
        s.isHost = !!isHost;
        s.code = code;
        s.id = transport ? (transport.id || randId()) : randId();
        s.players = [];             // [{id,name,avatar,ready,host,ping,me}]
        s.gameId = null;
        s.state = 'lobby';          // lobby | playing | closed
        s.alive = true;
        s._handlers = {};
        s._pingAt = {};

        const me = NP.profile();
        s.me = { id: s.id, name: me.name, avatar: me.avatar, ready: false, host: s.isHost, ping: 0, me: true };
        s.players = [s.me];

        if (transport) {
            transport.h = {
                peer: (pid) => s._onPeer(pid),
                data: (pid, msg) => s._onData(pid, msg),
                leave: (pid) => s._onLeave(pid),
                error: (msg) => s.emit('net:error', msg),
                status: (msg) => s.emit('net:status', msg)
            };
        }
    }

    Session.prototype.on = function (type, fn) {
        (this._handlers[type] = this._handlers[type] || []).push(fn);
        return () => this.off(type, fn);
    };
    Session.prototype.off = function (type, fn) {
        const a = this._handlers[type];
        if (!a) return;
        const i = a.indexOf(fn);
        if (i >= 0) a.splice(i, 1);
    };
    Session.prototype.emit = function (type, data, from) {
        (this._handlers[type] || []).slice().forEach(fn => {
            try { fn(data, from); } catch (e) { console.warn('[netplay] handler for', type, 'threw', e); }
        });
    };
    // games use this one: send(type, payload) reaches everybody else
    Session.prototype.send = function (type, data, to) {
        if (!this.transport || !this.alive) return;
        const env = { v: NP.VERSION, t: type, d: data, f: this.id, to: to || '*' };
        if (this.isHost) this.transport.send(to && to !== '*' ? this._peerFor(to) : '*', env);
        else this.transport.send(this.transport.hostId, env);
    };
    Session.prototype.sendToHost = function (type, data) {
        const host = this.players.find(p => p.host);
        this.send(type, data, host ? host.id : undefined);
    };
    // player ids and transport peer ids are the same thing everywhere
    // except peerjs, where the host addresses guests by connection id
    Session.prototype._peerFor = function (playerId) {
        const p = this.players.find(x => x.id === playerId);
        return (p && p.peerId) || playerId;
    };

    Session.prototype._onPeer = function (pid) {
        if (this.isHost) {
            // a stranger appeared; wait for their hello before seating them
            this.emit('net:status', 'someone is joining...');
        } else {
            this.emit('net:status', 'connected — saying hello');
        }
        this.announceProfile();
    };
    Session.prototype._onLeave = function (pid) {
        const p = this.players.find(x => x.peerId === pid || x.id === pid);
        if (!p) return;
        this.players = this.players.filter(x => x !== p);
        this.emit('player-leave', p);
        if (this.isHost) this.broadcastRoster();
        else if (p.host) { this.emit('net:down', 'the host disappeared'); }
        this.emit('roster', this.players);
    };
    Session.prototype._onData = function (pid, env) {
        if (!env || typeof env !== 'object') return;
        // anything at all counts as a sign of life
        this.lastRx = Date.now();
        const seen = this.players.find(p => p.id === env.f);
        if (seen) seen.seen = this.lastRx;
        if (env.v !== NP.VERSION) {
            // one side is running an older cached copy of the site
            this.emit('net:error', 'version mismatch — one of you needs to refresh');
            return;
        }
        // host is the switchboard: anything not addressed to it moves on
        if (this.isHost && env.to && env.to !== '*' && env.to !== this.id) {
            this.transport.send(this._peerFor(env.to), env);
            return;
        }
        if (this.isHost && env.to === '*' && env.f !== this.id) {
            // fan a guest broadcast out to the other guests
            this.players.forEach(p => {
                if (p.id !== env.f && p.id !== this.id) this.transport.send(this._peerFor(p.id), env);
            });
        }
        const from = this.players.find(p => p.id === env.f) || { id: env.f, name: 'someone' };
        switch (env.t) {
            case 'np:hello': return this._onHello(pid, env);
            case 'np:roster': return this._onRoster(env.d);
            case 'np:chat': {
                this.emit('chat', { from: from.name, text: String(env.d && env.d.text || '').slice(0, 200), id: env.f });
                return;
            }
            case 'np:ready': {
                const p = this.players.find(x => x.id === env.f);
                if (p) p.ready = !!(env.d && env.d.ready);
                if (this.isHost) this.broadcastRoster();
                this.emit('roster', this.players);
                return;
            }
            case 'np:game': {
                this.gameId = env.d && env.d.gameId;
                this.emit('game-pick', this.gameId);
                return;
            }
            case 'np:start': return this._onStart(env.d);
            case 'np:ping': { this.send('np:pong', { t: env.d && env.d.t }, env.f); return; }
            case 'np:pong': {
                const p = this.players.find(x => x.id === env.f);
                if (p && env.d && env.d.t) p.ping = Math.max(1, Math.round(performance.now() - env.d.t));
                this.emit('roster', this.players);
                return;
            }
            case 'np:full': {
                this.emit('net:error', (env.d && env.d.reason) || 'that lobby is full');
                return;
            }
            case 'np:bye': return this._onLeave(env.f);
            default:
                this.emit(env.t, env.d, from);
        }
    };
    Session.prototype._onHello = function (pid, env) {
        const prof = env.d || {};
        let p = this.players.find(x => x.id === env.f);
        if (!p) {
            p = { id: env.f, name: String(prof.name || 'wizard').slice(0, 16), avatar: prof.avatar || null, ready: false, host: false, ping: 0 };
            this.players.push(p);
            this.emit('player-join', p);
            beep('ding');
        } else {
            p.name = String(prof.name || p.name).slice(0, 16);
            p.avatar = prof.avatar || p.avatar;
        }
        p.peerId = pid;
        if (this.isHost) {
            const cap = (NP.byId(this.gameId) || {}).max || 8;
            if (this.players.length > cap) {
                this.send('np:full', { reason: 'lobby is full' }, p.id);
                this.players = this.players.filter(x => x !== p);
            }
            this.broadcastRoster();
            if (this.gameId) this.send('np:game', { gameId: this.gameId });
        }
        this.emit('roster', this.players);
    };
    Session.prototype._onRoster = function (list) {
        if (!Array.isArray(list)) return;
        const mine = this.id;
        this.players = list.map(p => Object.assign({}, p, { me: p.id === mine }));
        this.me = this.players.find(p => p.me) || this.me;
        this.emit('roster', this.players);
    };
    Session.prototype._onStart = function (d) {
        if (!d || !d.gameId) return;
        this.gameId = d.gameId;
        this.state = 'playing';
        this.emit('start', d);
        NP.launch(this, d);
    };

    Session.prototype.announceProfile = function () {
        const prof = NP.profile();
        this.me.name = prof.name;
        this.me.avatar = prof.avatar;
        this.send('np:hello', { name: prof.name, avatar: prof.avatar });
        if (this.isHost) this.broadcastRoster();
        this.emit('roster', this.players);
    };
    Session.prototype.broadcastRoster = function () {
        if (!this.isHost) return;
        const list = this.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, ready: p.ready, host: !!p.host, ping: p.ping || 0 }));
        this.send('np:roster', list);
    };
    Session.prototype.chat = function (text) {
        text = String(text || '').trim().slice(0, 200);
        if (!text) return;
        this.send('np:chat', { text });
        this.emit('chat', { from: this.me.name, text, id: this.id, mine: true });
    };
    Session.prototype.setReady = function (v) {
        this.me.ready = !!v;
        this.send('np:ready', { ready: this.me.ready });
        if (this.isHost) this.broadcastRoster();
        this.emit('roster', this.players);
    };
    Session.prototype.pickGame = function (gameId) {
        if (!this.isHost) return;
        this.gameId = gameId;
        this.send('np:game', { gameId });
        this.emit('game-pick', gameId);
    };
    Session.prototype.startGame = function () {
        if (!this.isHost) return;
        const g = NP.byId(this.gameId);
        if (!g) return;
        const slots = this.players.map(p => p.id);
        const d = { gameId: this.gameId, seed: Math.floor(Math.random() * 1e9), slots, at: Date.now() };
        this.send('np:start', d);
        this._onStart(d);
    };
    Session.prototype.opponent = function () {
        return this.players.find(p => !p.me) || null;
    };
    Session.prototype.player = function (id) {
        return this.players.find(p => p.id === id) || null;
    };
    Session.prototype.leave = function () {
        if (!this.alive) return;
        this.alive = false;
        this.state = 'closed';
        try { this.send('np:bye', {}); } catch (e) { }
        setTimeout(() => { try { this.transport && this.transport.close(); } catch (e) { } }, 60);
        if (NP.current === this) NP.current = null;
        this.emit('closed');
    };
    // The host pings everybody every couple of seconds. That gives the
    // lobby a latency number instead of vibes, and — more importantly —
    // it is how anyone notices a player who did not say goodbye. Closing
    // a tab sends nothing at all on some transports, so silence has to be
    // the signal.
    const SILENCE_MS = 6000;
    Session.prototype.startPings = function () {
        if (this._pingTimer) return;
        this.lastRx = Date.now();
        this.players.forEach(p => { p.seen = Date.now(); });
        this._pingTimer = setInterval(() => {
            if (!this.alive) { clearInterval(this._pingTimer); this._pingTimer = null; return; }
            const now = Date.now();
            if (this.isHost) {
                this.send('np:ping', { t: performance.now() });
                this.players.slice().forEach(p => {
                    if (p.me || !p.seen) return;
                    if (now - p.seen > SILENCE_MS) {
                        this.players = this.players.filter(x => x !== p);
                        this.emit('player-leave', p);
                        this.emit('roster', this.players);
                        this.broadcastRoster();
                    }
                });
            } else if (this.lastRx && now - this.lastRx > SILENCE_MS && !this._downSent) {
                this._downSent = true;
                this.emit('net:down', 'the host went quiet');
            }
        }, 2000);
    };

    NP.Session = Session;

    // ---------------------------------------------------------------
    // solo session — the same object shape with nobody on the other
    // end, so a game's netplay code path is also its practice mode.
    // ---------------------------------------------------------------
    NP.soloSession = function (gameId) {
        const s = new Session(null, true, 'SOLO');
        s.solo = true;
        s.gameId = gameId;
        s.state = 'playing';
        s.send = function () { };
        s.leave = function () { s.alive = false; s.state = 'closed'; s.emit('closed'); };
        return s;
    };

    // ===============================================================
    // GAME CATALOG
    //
    // Static so the lobby can list games before their code is loaded;
    // each game calls NP.registerGame() when its script arrives.
    // ===============================================================
    NP.CATALOG = [
        {
            id: 'wizardz',
            name: 'wizardz 98',
            icon: 'auto_fix_high',
            min: 2, max: 2,
            blurb: 'draw sigils to sling 50 spells at another wizard',
            scripts: ['games/wizardz-data.js', 'games/wizardz.js']
        }
    ];
    NP.games = {};
    NP.registerGame = function (g) {
        if (!g || !g.id || typeof g.start !== 'function') return;
        NP.games[g.id] = g;
    };
    NP.byId = function (id) { return NP.CATALOG.find(g => g.id === id) || null; };
    NP.loadGame = function (id) {
        const entry = NP.byId(id);
        if (!entry) return Promise.reject(new Error('no such game'));
        if (NP.games[id]) return Promise.resolve(NP.games[id]);
        // sequential on purpose: engines read their data file at definition time
        return entry.scripts.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
            .then(() => {
                if (!NP.games[id]) throw new Error(entry.name + ' did not register itself');
                return NP.games[id];
            });
    };
    NP.launch = function (session, opts) {
        const id = opts.gameId;
        NP.loadGame(id).then(g => {
            if (NP.lobbyWin) { try { NP.lobbyWin.close(); } catch (e) { } NP.lobbyWin = null; }
            g.start(session, opts);
        }).catch(err => {
            toast('netplay', 'could not start: ' + err.message);
            session.emit('net:error', err.message);
        });
    };

    // ===============================================================
    // CONNECT
    // ===============================================================
    NP.host = function (mode, gameId, code) {
        code = code || makeCode(5);
        const spec = NP.TRANSPORTS[mode] || NP.TRANSPORTS.peer;
        const t = spec.make(code, true);
        return t.open().then(() => {
            const s = new Session(t, true, code);
            s.id = t.id || s.id;
            s.me.id = s.id;
            s.me.host = true;
            s.gameId = gameId || NP.CATALOG[0].id;
            s.startPings();
            NP.current = s;
            return s;
        });
    };
    NP.join = function (mode, code) {
        code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
        if (code.length < 4) return Promise.reject(new Error('that code looks wrong'));
        const spec = NP.TRANSPORTS[mode] || NP.TRANSPORTS.peer;
        const t = spec.make(code, false);
        return t.open().then(() => {
            const s = new Session(t, false, code);
            s.id = t.id || s.id;
            s.me.id = s.id;
            s.startPings();          // the guest side only watches for silence
            NP.current = s;
            setTimeout(() => s.announceProfile(), 30);
            return s;
        });
    };

    NP.inviteLink = function (code) {
        const base = location.origin + location.pathname.replace(/index\.html?$/, '');
        return base + '?lobby=' + code;
    };

    // ===============================================================
    // LOBBY WINDOW
    // ===============================================================
    NP.openLobby = function (opts) {
        opts = opts || {};
        if (typeof createAppWindow !== 'function') return;
        const { body, win, close } = createAppWindow('multiplayer lobby', { icon: 'group', width: 560 });
        body.classList.add('np-body');
        NP.lobbyWin = { close: () => close(), win, body };

        let session = NP.current && NP.current.alive && NP.current.state === 'lobby' ? NP.current : null;
        let mode = (localStorage.getItem('mrhakan98-netplay-mode') || 'peer');
        if (!NP.TRANSPORTS[mode]) mode = 'peer';
        let gameId = opts.gameId || (session && session.gameId) || NP.CATALOG[0].id;
        let busy = false;
        const unsubs = [];

        win._cleanup = () => {
            unsubs.forEach(u => { try { u(); } catch (e) { } });
            NP.lobbyWin = null;
            // leaving the window while still in the lobby means leaving the lobby
            if (session && session.alive && session.state === 'lobby') session.leave();
        };

        function setBusy(v, msg) {
            busy = v;
            const s = body.querySelector('#np-status');
            if (s && msg) s.textContent = msg;
            body.querySelectorAll('button').forEach(b => { if (!b.dataset.always) b.disabled = v; });
        }

        // ---------- the two screens ----------
        function renderConnect() {
            const game = NP.byId(gameId) || NP.CATALOG[0];
            body.innerHTML = `
                <div class="np-head">
                    <span class="material-symbols-outlined">sports_esports</span>
                    <b>play with someone else</b>
                </div>
                <div class="np-row">
                    <label class="np-label">you are</label>
                    <input id="np-name" class="np-input" maxlength="16" value="${esc(NP.profile().name)}">
                    <button id="np-avatar" class="np-btn np-small" data-always="1">edit wizard</button>
                </div>
                <div class="np-row">
                    <label class="np-label">game</label>
                    <select id="np-game" class="np-input">
                        ${NP.CATALOG.map(g => `<option value="${esc(g.id)}" ${g.id === gameId ? 'selected' : ''}>${esc(g.name)} — ${esc(g.blurb)}</option>`).join('')}
                    </select>
                </div>
                <div class="np-row">
                    <label class="np-label">how</label>
                    <select id="np-mode" class="np-input">
                        ${Object.keys(NP.TRANSPORTS).map(k => `<option value="${k}" ${k === mode ? 'selected' : ''}>${esc(NP.TRANSPORTS[k].label)}</option>`).join('')}
                    </select>
                </div>
                <div class="np-note" id="np-modenote">${esc(NP.TRANSPORTS[mode].note)}</div>
                <div id="np-relay-row" class="np-row ${mode === 'relay' ? '' : 'np-hidden'}">
                    <label class="np-label">relay</label>
                    <input id="np-relay" class="np-input" placeholder="wss://your-relay.example/ws" value="${esc(NP.relayUrl())}">
                </div>
                <div class="np-split">
                    <div class="np-card">
                        <div class="np-card-title">start a lobby</div>
                        <p class="np-p">you get a 5 letter code. whoever types it in joins you.</p>
                        <button id="np-host" class="np-btn np-go">create lobby</button>
                    </div>
                    <div class="np-card">
                        <div class="np-card-title">join a lobby</div>
                        <p class="np-p">got a code off a friend? in it goes.</p>
                        <div class="np-join">
                            <input id="np-code" class="np-input np-code-input" maxlength="5" placeholder="CODE" value="${esc(opts.joinCode || '')}">
                            <button id="np-join" class="np-btn np-go">join</button>
                        </div>
                    </div>
                </div>
                <div class="np-solo">
                    <button id="np-solo" class="np-btn np-small">or practise on your own vs the machine</button>
                </div>
                <div id="np-status" class="np-status">not connected</div>`;

            body.querySelector('#np-name').addEventListener('change', e => {
                NP.setName(e.target.value);
                e.target.value = NP.profile().name;
            });
            body.querySelector('#np-game').onchange = e => { gameId = e.target.value; };
            body.querySelector('#np-mode').onchange = e => {
                mode = e.target.value;
                localStorage.setItem('mrhakan98-netplay-mode', mode);
                body.querySelector('#np-modenote').textContent = NP.TRANSPORTS[mode].note;
                body.querySelector('#np-relay-row').classList.toggle('np-hidden', mode !== 'relay');
            };
            const relayInput = body.querySelector('#np-relay');
            if (relayInput) relayInput.addEventListener('change', e => NP.setRelayUrl(e.target.value.trim()));
            body.querySelector('#np-avatar').onclick = () => {
                NP.loadGame(gameId).then(g => {
                    if (g.editAvatar) g.editAvatar();
                    else toast('netplay', 'this game has no dress-up screen');
                }).catch(e => toast('netplay', e.message));
            };
            body.querySelector('#np-host').onclick = () => {
                if (busy) return;
                setBusy(true, 'opening a lobby...');
                NP.host(mode, gameId).then(s => {
                    session = s;
                    bind(s);
                    setBusy(false);
                    renderLobby();
                    beep('ding');
                }).catch(err => { setBusy(false, 'failed: ' + err.message); beep('error'); });
            };
            body.querySelector('#np-join').onclick = () => {
                if (busy) return;
                const code = body.querySelector('#np-code').value;
                setBusy(true, 'knocking...');
                NP.join(mode, code).then(s => {
                    session = s;
                    bind(s);
                    setBusy(false);
                    renderLobby();
                    beep('ding');
                }).catch(err => { setBusy(false, 'failed: ' + err.message); beep('error'); });
            };
            body.querySelector('#np-code').addEventListener('input', e => {
                e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            });
            body.querySelector('#np-solo').onclick = () => {
                NP.loadGame(gameId).then(g => {
                    close();
                    g.start(NP.soloSession(gameId), { solo: true, seed: Math.floor(Math.random() * 1e9) });
                }).catch(e => toast('netplay', e.message));
            };
        }

        function renderLobby() {
            const s = session;
            if (!s) return renderConnect();
            const game = NP.byId(s.gameId) || NP.CATALOG[0];
            body.innerHTML = `
                <div class="np-head">
                    <span class="material-symbols-outlined">group</span>
                    <b>${esc(game.name)}</b>
                    <span class="np-chip">${esc(NP.TRANSPORTS[s.transport ? s.transport.kind : 'peer'].label)}</span>
                </div>
                <div class="np-codebox">
                    <div>
                        <div class="np-code-label">invite code</div>
                        <div class="np-code">${esc(s.code)}</div>
                    </div>
                    <div class="np-code-actions">
                        <button id="np-copycode" class="np-btn np-small" data-always="1">copy code</button>
                        <button id="np-copylink" class="np-btn np-small" data-always="1">copy link</button>
                    </div>
                </div>
                <div class="np-players" id="np-players"></div>
                ${s.isHost ? `<div class="np-row">
                    <label class="np-label">game</label>
                    <select id="np-game2" class="np-input">
                        ${NP.CATALOG.map(g => `<option value="${esc(g.id)}" ${g.id === s.gameId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
                    </select>
                </div>` : ''}
                <div class="np-chat" id="np-chat"></div>
                <div class="np-chatrow">
                    <input id="np-chatin" class="np-input" maxlength="200" placeholder="say something">
                    <button id="np-send" class="np-btn np-small" data-always="1">send</button>
                </div>
                <div class="np-actions">
                    <button id="np-ready" class="np-btn">${s.me.ready ? 'not ready' : "i'm ready"}</button>
                    ${s.isHost ? '<button id="np-start" class="np-btn np-go">start match</button>' : ''}
                    <button id="np-leave" class="np-btn np-small" data-always="1">leave</button>
                </div>
                <div id="np-status" class="np-status">${s.isHost ? 'waiting for someone to join...' : 'in the lobby'}</div>`;

            body.querySelector('#np-copycode').onclick = () => copy(s.code, 'code copied');
            body.querySelector('#np-copylink').onclick = () => copy(NP.inviteLink(s.code), 'invite link copied');
            const g2 = body.querySelector('#np-game2');
            if (g2) g2.onchange = e => s.pickGame(e.target.value);
            body.querySelector('#np-ready').onclick = () => { s.setReady(!s.me.ready); drawPlayers(); body.querySelector('#np-ready').textContent = s.me.ready ? 'not ready' : "i'm ready"; };
            const startBtn = body.querySelector('#np-start');
            if (startBtn) startBtn.onclick = () => {
                const g = NP.byId(s.gameId);
                if (s.players.length < (g.min || 2)) { toast('lobby', 'you need ' + g.min + ' wizards for that'); return; }
                if (s.players.some(p => !p.ready && !p.host)) { toast('lobby', 'somebody is not ready'); return; }
                setBusy(true, 'loading the game...');
                s.startGame();
            };
            body.querySelector('#np-leave').onclick = () => { s.leave(); session = null; renderConnect(); };
            const chatin = body.querySelector('#np-chatin');
            const send = () => { if (chatin.value.trim()) { s.chat(chatin.value); chatin.value = ''; } };
            body.querySelector('#np-send').onclick = send;
            chatin.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); send(); } });
            drawPlayers();
            drawChat();
        }

        function drawPlayers() {
            const box = body.querySelector('#np-players');
            if (!box || !session) return;
            const painter = (NP.games[session.gameId] || {}).paintAvatar;
            // the game's code draws the avatars — pull it in while people
            // are still deciding whether they are ready
            if (!painter && !NP._preloading) {
                NP._preloading = true;
                NP.loadGame(session.gameId).then(() => { NP._preloading = false; drawPlayers(); })
                    .catch(() => { NP._preloading = false; });
            }
            box.innerHTML = session.players.map(p => `
                <div class="np-player ${p.ready ? 'np-ok' : ''}">
                    <canvas class="np-avatar" width="64" height="64" data-pid="${esc(p.id)}"></canvas>
                    <div class="np-pname">${esc(p.name)}${p.host ? ' <span class="np-tag">host</span>' : ''}${p.me ? ' <span class="np-tag np-you">you</span>' : ''}</div>
                    <div class="np-pstate">${p.ready ? 'ready' : 'waiting'}${p.ping ? ' · ' + p.ping + 'ms' : ''}</div>
                </div>`).join('') +
                (session.players.length < 2 ? '<div class="np-player np-empty"><div class="np-slot">empty seat</div><div class="np-pstate">share the code</div></div>' : '');
            if (painter) {
                box.querySelectorAll('canvas.np-avatar').forEach(cv => {
                    const p = session.players.find(x => x.id === cv.dataset.pid);
                    try { painter(cv, p && p.avatar, { scale: 1 }); } catch (e) { }
                });
            }
        }

        const chatLog = [];
        function drawChat() {
            const box = body.querySelector('#np-chat');
            if (!box) return;
            box.innerHTML = chatLog.slice(-40).map(c =>
                `<div class="np-line"><b>${esc(c.from)}:</b> ${esc(c.text)}</div>`).join('') || '<div class="np-line np-dim">say hi</div>';
            box.scrollTop = box.scrollHeight;
        }

        function copy(text, msg) {
            const done = () => toast('lobby', msg);
            if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(() => prompt('copy this:', text));
            else prompt('copy this:', text);
        }

        function bind(s) {
            unsubs.push(s.on('roster', () => { drawPlayers(); }));
            unsubs.push(s.on('chat', c => { chatLog.push(c); drawChat(); if (!c.mine) beep('click'); }));
            unsubs.push(s.on('player-join', p => {
                const st = body.querySelector('#np-status');
                if (st) st.textContent = p.name + ' joined';
            }));
            unsubs.push(s.on('player-leave', p => {
                const st = body.querySelector('#np-status');
                if (st) st.textContent = p.name + ' left';
                drawPlayers();
            }));
            unsubs.push(s.on('game-pick', () => renderLobby()));
            unsubs.push(s.on('net:status', m => { const st = body.querySelector('#np-status'); if (st) st.textContent = m; }));
            unsubs.push(s.on('net:error', m => { const st = body.querySelector('#np-status'); if (st) st.textContent = 'trouble: ' + m; }));
            unsubs.push(s.on('net:down', m => { const st = body.querySelector('#np-status'); if (st) st.textContent = m; }));
            unsubs.push(s.on('start', () => { setBusy(false); }));
        }

        if (session) { bind(session); renderLobby(); } else renderConnect();

        // an invite link drops you straight into the join box
        if (opts.joinCode && !session && opts.autoJoin) {
            setTimeout(() => { const b = body.querySelector('#np-join'); if (b) b.click(); }, 400);
        }
    };

    // ===============================================================
    // invite links: /?lobby=ABCDE opens the lobby with the code filled
    // ===============================================================
    function checkInviteLink() {
        let code = '';
        try {
            const q = new URLSearchParams(location.search);
            code = (q.get('lobby') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
        } catch (e) { }
        if (code.length < 4) return;
        // wait for the desktop to finish booting before throwing a window at it
        const go = () => NP.openLobby({ joinCode: code, autoJoin: true });
        if (document.readyState === 'complete') setTimeout(go, 1200);
        else window.addEventListener('load', () => setTimeout(go, 1200));
    }
    checkInviteLink();

    // desktop entry points
    window.openLobby = function (opts) { NP.openLobby(opts || {}); };
})();
