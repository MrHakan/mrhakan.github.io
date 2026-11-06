// ===================================================================
// NETPLAY — invite-code lobbies for every game on this desktop
//
// The site is static files on github pages. There is no server to run a
// game on, and there never will be, so multiplayer here is peer to peer:
// two browsers open a webrtc data channel and talk straight to each
// other. The only thing a "server" is needed for is introducing them,
// and that is what the invite code does.
//
// Five ways through, same interface, picked in the lobby:
//
//   auto   the default, and the only one most people should ever need.
//          the host listens on peer and bus at once, and a guest tries
//          peer first and drops to bus by itself. see AutoTransport.
//   peer   webrtc through the public peerjs broker. real internet play,
//          no server of mine involved. the fastest way there is, when the
//          two routers in question allow it.
//   bus    the same duel posted through public nostr relays on port 443,
//          encrypted with the invite code. no p2p at all, which is the
//          point: it gets through everything webrtc cannot. still nothing
//          to sign up for and nothing to deploy.
//   relay  a websocket relay you host yourself (server/relay.js). for
//          when you would rather own the thing.
//   local  broadcastchannel between two tabs of the same browser. costs
//          nothing, works offline, and is how you test a game at 3am
//          when nobody is awake to play with you.
//
// Games register themselves here and get a lobby for free — see
// NP.CATALOG at the bottom and games/wizardz/wizardz.js for a worked example.
// ===================================================================
(function () {
    'use strict';

    const NP = {};
    window.Netplay = NP;

    NP.VERSION = 1;                 // protocol version, bumped on breaking changes
    const PEER_PREFIX = 'mrh98-';   // namespaces our codes on the shared public broker
    // in order: if one cdn is down or blocked, the other one gets a go
    const PEERJS_CDNS = [
        'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
        'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
    ];
    // Only STUN, which tells a browser its public address and is all that two
    // agreeable routers need. There is no free TURN left to put here: the
    // servers built into peerjs are gone from dns and Open Relay now resolves
    // to a reserved test address. That is what the public relays further down
    // are for. A TURN server you pay for goes in data/site.json, under
    // multiplayer.iceServers.
    const ICE_DEFAULTS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
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
                if (j && j.multiplayer && Array.isArray(j.multiplayer.nostrRelays) && j.multiplayer.nostrRelays.length) {
                    NP._siteNostr = j.multiplayer.nostrRelays;
                }
                if (j && j.multiplayer && Array.isArray(j.multiplayer.iceServers)) NP._siteIce = j.multiplayer.iceServers;
            }).catch(() => { });
        }
    } catch (e) { /* no network, no config, no problem */ }

    NP.iceServers = function () { return ICE_DEFAULTS.concat(NP._siteIce || []); };

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
    function PeerTransport(code, isHost, opts) {
        const t = { kind: 'peer', id: null, h: {}, code };
        const answerMs = (opts && opts.answerMs) || 15000;
        let peer = null;
        const conns = new Map();     // peerId -> DataConnection (host side)
        let hostConn = null;         // guest side

        function wire(conn) {
            conn.on('data', d => t.h.data && t.h.data(conn.peer, d));
            conn.on('close', () => { conns.delete(conn.peer); t.h.leave && t.h.leave(conn.peer); });
            conn.on('error', () => { conns.delete(conn.peer); t.h.leave && t.h.leave(conn.peer); });
        }

        t.open = function () {
            return loadScript(PEERJS_CDNS[0]).catch(() => loadScript(PEERJS_CDNS[1])).catch(() => {
                throw new Error('could not reach the peerjs cdn — try the public relays');
            }).then(() => new Promise((resolve, reject) => {
                if (!window.Peer) return reject(new Error('peerjs did not load'));
                t.h.status && t.h.status(isHost ? 'opening the lobby...' : 'looking for the lobby...');
                peer = new Peer(isHost ? PEER_PREFIX + code : undefined, { debug: 0, config: { iceServers: NP.iceServers() } });
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
                    // ice has given up, so there is no point waiting out the clock
                    conn.on('iceStateChanged', state => { if (state === 'failed') fail('no direct route to the host'); });
                    setTimeout(() => fail('the host never answered — check the code'), answerMs);
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

    // ===============================================================
    // bus: public nostr relays
    //
    // The other way to play over the internet without owning a server.
    // Instead of introducing two browsers and getting out of the way,
    // this posts every message to a handful of public relays and reads
    // the room back off them — no p2p, no signup, no account, nothing to
    // deploy. It exists because webrtc is the first thing a corporate or
    // campus network blocks, and these relays are plain wss on port 443,
    // which is the last thing anyone blocks.
    //
    // Relays only accept signed events, so there is a small BIP-340
    // schnorr implementation below (checked against the official test
    // vectors in CI). The key is thrown away when you close the tab.
    // The room is a hash of the invite code and the payload inside each
    // event is encrypted with a key derived from that code, so a public
    // relay carries opaque blobs rather than your duel.
    // ===============================================================
    // Four, because one of them will always be rate limiting, down, or
    // asking for an account this week. Every message goes to all of them
    // and arrives once — duplicates are dropped by event id. This list rots:
    // `npm run relays` measures who will still carry a duel at game rate.
    const NOSTR_DEFAULTS = [
        'wss://relay.primal.net',
        'wss://relay.snort.social',
        'wss://relay.sigit.io',
        'wss://relay.angor.io'
    ];
    const NOSTR_KEY = 'mrhakan98-netplay-relays';
    NP.nostrRelays = function () {
        try {
            const custom = (localStorage.getItem(NOSTR_KEY) || '').split(',').map(s => s.trim()).filter(Boolean);
            if (custom.length) return custom;
        } catch (e) { }
        return (NP._siteNostr && NP._siteNostr.length) ? NP._siteNostr : NOSTR_DEFAULTS;
    };
    NP.setNostrRelays = function (list) {
        try {
            const v = Array.isArray(list) ? list.join(',') : String(list || '');
            v ? localStorage.setItem(NOSTR_KEY, v) : localStorage.removeItem(NOSTR_KEY);
        } catch (e) { }
    };
    const NOSTR_KIND = 21998;      // 20000-29999 is ephemeral: relays pass it on and forget it
    const BATCH_MS = 90;           // messages are pooled into one signed event
    const REFUSED_MS = 60000;      // how long a relay asking for less gets left alone
    const GAP_MS = 250;            // how long later batches wait for one running late

    // ---------- BIP-340 schnorr over secp256k1 ----------
    // one signature per batched event, about a millisecond each
    const bip340 = (function () {
        const P = 2n ** 256n - 2n ** 32n - 977n;
        const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
        const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
        const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
        const mod = (a, m = P) => ((a % m) + m) % m;
        function pow(b, e, m = P) {
            let r = 1n; b = mod(b, m);
            while (e > 0n) { if (e & 1n) r = mod(r * b, m); b = mod(b * b, m); e >>= 1n; }
            return r;
        }
        const inv = (a, m = P) => pow(mod(a, m), m - 2n, m);
        // jacobian coordinates, so a scalar multiply needs no inversions
        function dbl(p) {
            const [x, y, z] = p;
            if (y === 0n) return [0n, 1n, 0n];
            const a = mod(x * x), b = mod(y * y), c = mod(b * b);
            const d = mod(2n * (mod((x + b) * (x + b)) - a - c));
            const e = mod(3n * a), f = mod(e * e);
            const X = mod(f - 2n * d);
            return [X, mod(e * (d - X) - 8n * c), mod(2n * y * z)];
        }
        function add(p, q) {
            const [x1, y1, z1] = p, [x2, y2, z2] = q;
            if (z1 === 0n) return q;
            if (z2 === 0n) return p;
            const z1z1 = mod(z1 * z1), z2z2 = mod(z2 * z2);
            const u1 = mod(x1 * z2z2), u2 = mod(x2 * z1z1);
            const s1 = mod(y1 * z2 * z2z2), s2 = mod(y2 * z1 * z1z1);
            const h = mod(u2 - u1), r = mod(2n * (s2 - s1));
            if (h === 0n) return r === 0n ? dbl(p) : [0n, 1n, 0n];
            const i = mod(mod(2n * h) * mod(2n * h)), j = mod(h * i), v = mod(u1 * i);
            const X = mod(r * r - j - 2n * v);
            return [X, mod(r * (v - X) - 2n * s1 * j), mod((mod((z1 + z2) * (z1 + z2)) - z1z1 - z2z2) * h)];
        }
        function affine(p) {
            const [x, y, z] = p;
            if (z === 0n) return [0n, 0n];
            const zi = inv(z), zi2 = mod(zi * zi);
            return [mod(x * zi2), mod(y * zi2 * zi)];
        }
        const G = [Gx, Gy, 1n];
        // Signing runs on the game's thread, several times a second on the relay
        // road, and nearly all of its cost is multiplying G. So that gets a table,
        // one row per four bits of the scalar, built the first time it is needed.
        let table = null;
        function mulG(k) {
            if (!table) {
                table = [];
                let base = G;
                for (let w = 0; w < 64; w++) {
                    const row = [null];
                    let p = base;
                    for (let i = 1; i < 16; i++) { row[i] = p; p = add(p, base); }
                    table.push(row);
                    base = p;
                }
            }
            let r = [0n, 1n, 0n];
            for (let w = 0; k > 0n; w++, k >>= 4n) {
                const digit = Number(k & 15n);
                if (digit) r = add(r, table[w][digit]);
            }
            return r;
        }
        // and the key's own point never changes between signatures
        let lastKey = null;
        function pointOf(d) {
            if (!lastKey || lastKey.d !== d) lastKey = { d, point: affine(mulG(d)) };
            return lastKey.point;
        }
        const toHex = b => Array.from(b).map(v => v.toString(16).padStart(2, '0')).join('');
        const fromHex = h => new Uint8Array(h.match(/.{2}/g).map(v => parseInt(v, 16)));
        const bytesToBig = b => BigInt('0x' + (toHex(b) || '0'));
        const bigTo32 = n => fromHex(n.toString(16).padStart(64, '0'));
        const cat = (...a) => {
            const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
            let o = 0;
            a.forEach(x => { out.set(x, o); o += x.length; });
            return out;
        };
        const sha256 = async (...parts) => new Uint8Array(await crypto.subtle.digest('SHA-256', cat(...parts)));
        async function tagged(tag, ...parts) {
            const t = await sha256(new TextEncoder().encode(tag));
            return sha256(t, t, cat(...parts));
        }
        return {
            toHex, fromHex, sha256, cat,
            newKey() {
                const sk = new Uint8Array(32);
                crypto.getRandomValues(sk);
                return sk;
            },
            async pubkey(sk) {
                return bigTo32(pointOf(mod(bytesToBig(sk), N))[0]);
            },
            // auxRand is a parameter only so the test suite can replay the
            // official BIP-340 vectors; real signing always uses fresh
            // randomness
            async sign(msg32, sk32, auxRand) {
                const d0 = mod(bytesToBig(sk32), N);
                const [px, py] = pointOf(d0);
                const d = (py % 2n === 0n) ? d0 : N - d0;
                let aux = auxRand;
                if (!aux) { aux = new Uint8Array(32); crypto.getRandomValues(aux); }
                const t = bigTo32(d ^ bytesToBig(await tagged('BIP0340/aux', aux)));
                const rand = await tagged('BIP0340/nonce', t, bigTo32(px), msg32);
                const k0 = mod(bytesToBig(rand), N);
                const [rx, ry] = affine(mulG(k0));
                const k = (ry % 2n === 0n) ? k0 : N - k0;
                const e = mod(bytesToBig(await tagged('BIP0340/challenge', bigTo32(rx), bigTo32(px), msg32)), N);
                return cat(bigTo32(rx), bigTo32(mod(k + e * d, N)));
            }
        };
    })();
    NP.bip340 = bip340;   // exported so CI can hold it to the official vectors

    // the invite code is the shared secret: it names the room and it
    // encrypts what goes in it
    async function roomFromCode(code) {
        const enc = new TextEncoder();
        const tagHash = await bip340.sha256(enc.encode('mrhakan98-room|' + code));
        const keyHash = await bip340.sha256(enc.encode('mrhakan98-key|' + code));
        const key = await crypto.subtle.importKey('raw', keyHash, 'AES-GCM', false, ['encrypt', 'decrypt']);
        return { tag: 'mrh98-' + bip340.toHex(tagHash).slice(0, 16), key };
    }
    const b64 = bytes => btoa(String.fromCharCode.apply(null, Array.from(bytes)));
    const unb64 = s => new Uint8Array(atob(s).split('').map(c => c.charCodeAt(0)));
    async function seal(key, obj) {
        const iv = new Uint8Array(12);
        crypto.getRandomValues(iv);
        const data = new TextEncoder().encode(JSON.stringify(obj));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
        return b64(bip340.cat(iv, ct));
    }
    async function unseal(key, text) {
        const raw = unb64(text);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
        return JSON.parse(new TextDecoder().decode(pt));
    }

    function NostrTransport(code, isHost) {
        const t = { kind: 'bus', id: null, h: {}, code };
        const links = new Map();         // relay url -> { ws, quietUntil, tries }
        const known = new Set();         // peers we have told the session about
        const streams = new Map();       // peer -> how far through their batches we are
        let seen = new Set(), seenBefore = new Set();   // event ids already handled
        let room = null, sk = null, queue = [], flushTimer = null, closed = false;
        let sent = 0, everUp = false, lost = false;

        function publish(text) {
            const now = Date.now();
            links.forEach(link => {
                if (link.ws.readyState !== 1 || link.quietUntil > now) return;
                try { link.ws.send(text); } catch (e) { }
            });
        }
        // A relay says what it thinks of every event. Carrying on at ten a second
        // after it has said no is what gets an address banned, and relay.damus.io
        // has done exactly that: "too many rate-limit violations". So a relay
        // asking for less gets a minute's peace and one that will never take these
        // events gets left alone. Either way it can still be read from.
        function refused(link, why) {
            if (/^duplicate/i.test(why)) return;
            const slowDown = /rate.?limit|slow down/i.test(why) && !/^banned/i.test(why);
            link.quietUntil = slowDown ? Date.now() + REFUSED_MS : Infinity;
            const now = Date.now();
            if (![...links.values()].some(l => l.quietUntil <= now)) {
                t.h.error && t.h.error('every public relay is refusing this connection');
            }
        }
        async function flush() {
            flushTimer = null;
            if (closed || !room || !t.id) { queue = []; return; }
            if (!queue.length) return;
            // the number goes first where an older copy of the site skips over it
            const batch = [{ n: ++sent }].concat(queue);
            queue = [];
            try {
                const content = await seal(room.key, batch);
                const created = Math.floor(Date.now() / 1000);
                const tags = [['d', room.tag]];
                const pub = t.id;
                const ser = JSON.stringify([0, pub, created, NOSTR_KIND, tags, content]);
                const id = await bip340.sha256(new TextEncoder().encode(ser));
                const sig = await bip340.sign(id, sk);
                const ev = {
                    id: bip340.toHex(id), pubkey: pub, created_at: created,
                    kind: NOSTR_KIND, tags, content, sig: bip340.toHex(sig)
                };
                seen.add(ev.id);
                publish(JSON.stringify(['EVENT', ev]));
            } catch (e) {
                t.h.error && t.h.error('could not post to the relays');
            }
        }
        function enqueue(to, msg) {
            if (closed) return;
            queue.push({ to: to || '*', msg });
            // one signature per batch instead of one per message, which
            // also keeps the relays from calling it flooding
            if (!flushTimer) flushTimer = setTimeout(flush, BATCH_MS);
        }
        function deliver(pub, batch) {
            if (closed) return;
            batch.forEach(item => {
                if (!item || (item.to !== '*' && item.to !== t.id)) return;
                t.h.data && t.h.data(pub, item.msg);
            });
        }
        // Whichever relay is quickest delivers each batch, so they can land out
        // of order, and "key down" arriving after "key up" leaves a wizard walking
        // into a wall. Later batches wait a moment for one that is running late.
        function inOrder(pub, n, batch) {
            let s = streams.get(pub);
            if (!s) { s = { next: n, held: new Map(), timer: 0 }; streams.set(pub, s); }
            // already given up on, but late beats never: a cast is still a cast
            if (n < s.next) { deliver(pub, batch); return; }
            s.held.set(n, batch);
            drain(pub, s);
        }
        function drain(pub, s) {
            clearTimeout(s.timer);
            while (s.held.has(s.next)) {
                const batch = s.held.get(s.next);
                s.held.delete(s.next++);
                deliver(pub, batch);
            }
            if (s.held.size) {
                s.timer = setTimeout(() => {
                    s.next = Math.min(...s.held.keys());
                    drain(pub, s);
                }, GAP_MS);
            }
        }
        async function onEvent(ev) {
            if (!ev || ev.kind !== NOSTR_KIND || seen.has(ev.id) || seenBefore.has(ev.id)) return;
            seen.add(ev.id);
            // two generations, so forgetting old ids cannot let a slow relay's
            // copy of a recent one back in
            if (seen.size > 400) { seenBefore = seen; seen = new Set(); }
            if (ev.pubkey === t.id) return;
            let batch = null;
            try { batch = await unseal(room.key, ev.content); } catch (e) { return; }  // someone else's room
            if (!Array.isArray(batch)) return;
            if (!known.has(ev.pubkey)) {
                known.add(ev.pubkey);
                t.h.peer && t.h.peer(ev.pubkey);
            }
            if (batch[0] && typeof batch[0].n === 'number') inOrder(ev.pubkey, batch[0].n, batch.slice(1));
            else deliver(ev.pubkey, batch);
        }
        function connect(url, opened) {
            let ws;
            try { ws = new WebSocket(url); } catch (e) { return; }
            const link = links.get(url) || { quietUntil: 0, tries: 0 };
            link.ws = ws;
            links.set(url, link);
            ws.onopen = () => {
                link.tries = 0;
                everUp = true;
                ws.send(JSON.stringify(['REQ', 'np', { kinds: [NOSTR_KIND], '#d': [room.tag], since: Math.floor(Date.now() / 1000) - 20 }]));
                if (lost) { lost = false; t.h.status && t.h.status('back on the public relays'); }
                opened();
            };
            ws.onmessage = (e) => {
                let m = null;
                try { m = JSON.parse(e.data); } catch (err) { return; }
                if (m[0] === 'EVENT') onEvent(m[2]);
                else if (m[0] === 'OK' && m[2] === false) refused(link, String(m[3] || ''));
            };
            ws.onerror = () => { };
            ws.onclose = () => {
                if (closed) return;
                // relays restart and phones sleep, so none of this is final. One
                // dropping is nothing and all of them at once is worth a mention.
                if (everUp && !lost && ![...links.values()].some(l => l.ws.readyState === 1)) {
                    lost = true;
                    t.h.error && t.h.error('lost every public relay, trying to get back');
                }
                link.tries = Math.min(link.tries + 1, 5);
                setTimeout(() => { if (!closed) connect(url, opened); }, 1000 * Math.pow(2, link.tries));
            };
        }

        t.open = function () {
            return new Promise((resolve, reject) => {
                if (!window.crypto || !crypto.subtle) return reject(new Error('this browser has no webcrypto'));
                t.h.status && t.h.status('signing in to the public relays...');
                roomFromCode(code).then(r => {
                    room = r;
                    sk = bip340.newKey();
                    return bip340.pubkey(sk);
                }).then(pub => {
                    t.id = bip340.toHex(pub);
                    t.hostId = null;                 // a bus has no host to address
                    let settled = false;
                    NP.nostrRelays().forEach(url => connect(url, () => {
                        if (settled) return;
                        settled = true;
                        t.h.status && t.h.status('on the public relays');
                        resolve();
                    }));
                    setTimeout(() => {
                        if (!settled) {
                            settled = true;
                            reject(new Error('no public relay would answer — try p2p, or your own relay'));
                        }
                    }, 12000);
                }).catch(err => reject(err));
            });
        };
        t.send = function (to, msg) { enqueue(to, msg); };
        t.close = function () {
            if (closed) return;
            const finish = () => {
                closed = true;
                clearTimeout(flushTimer);
                streams.forEach(s => clearTimeout(s.timer));
                links.forEach(link => { try { link.ws.close(); } catch (e) { } });
            };
            // one last batch, because it is usually the goodbye
            if (queue.length && room) flush().then(finish, finish);
            else finish();
        };
        return t;
    }

    // ---------- auto: whichever way through works ----------
    //
    // A direct connection is the best thing to have, and nothing guarantees
    // one. Two browsers behind strict or carrier-grade NATs cannot find a way
    // to each other, and the free TURN servers that used to carry those pairs
    // are gone, so whether p2p connects comes down to both players' routers.
    // Making people pick a mode was no answer: they had to pick the same one,
    // and the only sign of getting it wrong was "nobody is hosting that code".
    //
    // So the host is on both at once and a guest tries direct, then the relays.
    // Nobody has to know which it was except the game, which reads .kind and
    // eases off over a relay. A direct link that dies mid-duel moves to the
    // relays the same way, inside the six seconds before Session calls anybody
    // gone. Every game in the catalog is two players, so this never has to
    // forward between a guest on each road.
    const DIRECT_MS = 7000;        // how long a guest gives webrtc to find a route
    const ANSWER_MS = 6000;        // and how long the relays then get to turn up a host

    function AutoTransport(code, isHost) {
        const t = { id: randId(), h: {}, code, hostId: null };
        const direct = PeerTransport(code, isHost, { answerMs: DIRECT_MS });
        let relays = NostrTransport(code, isHost);
        let link = null;           // guest: whichever one is carrying the game
        let closed = false, goodbye = false, heard = false, onHeard = null;
        const viaDirect = new Set(), viaRelays = new Set();   // host: who came in which way

        Object.defineProperty(t, 'kind', {
            get: () => (isHost
                ? (viaRelays.size ? 'bus' : viaDirect.size ? 'peer' : 'auto')
                : (link ? link.kind : 'auto'))
        });
        const say = msg => { t.h.status && t.h.status(msg); };

        function openHost() {
            direct.h = {
                peer: pid => { viaDirect.add(pid); t.h.peer && t.h.peer('p:' + pid); say('connected directly'); },
                data: (pid, msg) => { t.h.data && t.h.data('p:' + pid, msg); },
                // Not a goodbye: those arrive as np:bye, and Session notices real
                // silence by itself. This may be a guest on its way back by relay.
                leave: pid => { viaDirect.delete(pid); }
            };
            relays.h = {
                peer: pid => { viaRelays.add(pid); t.h.peer && t.h.peer('b:' + pid); say('connected through the public relays'); },
                data: (pid, msg) => { t.h.data && t.h.data('b:' + pid, msg); },
                error: msg => { if (!viaDirect.size) t.h.error && t.h.error(msg); }
            };
            return new Promise((resolve, reject) => {
                const why = [];
                const down = e => { why.push(e.message); if (why.length === 2) reject(new Error(why.join(', and '))); };
                say('opening the lobby...');
                direct.open().then(resolve, down);
                relays.open().then(resolve, down);
            });
        }

        function listenForHost() {
            relays.h = {
                peer: pid => {
                    heard = true;
                    if (onHeard) onHeard();
                    if (link === relays) t.h.peer && t.h.peer(pid);
                },
                data: (pid, msg) => { if (link === relays) t.h.data && t.h.data(pid, msg); },
                error: msg => { if (link === relays) t.h.error && t.h.error(msg); }
            };
        }
        // the relays have no way of saying that nobody is there, so ask out loud
        function knock() {
            return new Promise((resolve, reject) => {
                if (heard) return resolve();
                const env = { v: NP.VERSION, t: 'np:knock', d: null, f: t.id, to: '*' };
                relays.send('*', env);
                const again = setInterval(() => relays.send('*', env), 1500);
                const giveUp = setTimeout(() => {
                    clearInterval(again);
                    reject(new Error('nobody answered that code — check it, and ask them to keep the lobby open'));
                }, ANSWER_MS);
                onHeard = () => { clearInterval(again); clearTimeout(giveUp); resolve(); };
            });
        }
        function openGuest() {
            direct.h = {
                data: (pid, msg) => {
                    if (msg && msg.t === 'np:bye') goodbye = true;
                    if (link === direct) t.h.data && t.h.data(pid, msg);
                },
                leave: () => fallBack()
            };
            listenForHost();
            const listening = relays.open().then(() => true, () => false);
            say('trying a direct connection...');
            return direct.open().then(() => {
                link = direct;
                relays.close();
                say('connected directly');
            }, () => {
                direct.close();
                say('no direct route, trying the public relays...');
                return listening.then(up => {
                    if (!up) throw new Error('could not reach the host directly or through the public relays');
                    return knock();
                }).then(() => {
                    link = relays;
                    say('connected through the public relays');
                });
            });
        }
        // the direct link died with the game still on
        function fallBack() {
            if (closed || goodbye || link !== direct) return;
            link = null;
            say('lost the direct link, moving to the public relays...');
            relays = NostrTransport(code, false);
            listenForHost();
            relays.open().then(() => {
                link = relays;
                // a new hello down the new road tells the host where to send things
                t.h.peer && t.h.peer('relays');
            }, () => { t.h.error && t.h.error('the direct link died and the public relays will not answer'); });
        }

        t.open = () => (isHost ? openHost() : openGuest());
        t.send = function (to, msg) {
            if (!isHost) {
                if (link === direct) direct.send(direct.hostId, msg);
                else if (link === relays) relays.send('*', msg);
                return;
            }
            if (to && to !== '*') {
                if (to.slice(0, 2) === 'b:') relays.send(to.slice(2), msg);
                else direct.send(to.replace(/^p:/, ''), msg);
                return;
            }
            if (viaDirect.size) direct.send('*', msg);
            // stay audible on the relays for anyone still looking, until a guest
            // has come in directly and there is nobody left to hear it
            if (viaRelays.size || !viaDirect.size) relays.send('*', msg);
        };
        t.close = function () {
            closed = true;
            try { direct.close(); } catch (e) { }
            try { relays.close(); } catch (e) { }
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
        auto: { make: AutoTransport, label: 'internet (automatic)', note: 'tries a direct connection first, and goes through the public relays if your routers will not allow one. nothing to set up, and your friend does not have to pick the same thing.' },
        bus: { make: NostrTransport, label: 'public relays only', chip: 'through the public relays', note: 'posts the duel through public nostr relays on port 443. slower than a direct connection, but it gets through anything. no server, no signup, encrypted with your invite code.' },
        relay: { make: RelayTransport, label: 'my relay server', note: 'a websocket relay you host yourself. see server/relay.js.' },
        local: { make: LocalTransport, label: 'same browser', note: 'two tabs on this machine. no network at all — good for testing.' },
        // what auto tries first and what the lobby says when it worked. On its
        // own it can only fail in ways auto recovers from, so it is not on offer.
        peer: { make: PeerTransport, label: 'direct connection', hidden: true, note: 'webrtc straight between the two of you.' }
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
        s.gameOptions = {};         // whatever the host picked, for games that offer a choice
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
        // a relay hiccup or a link changing roads does not have to end the duel
        if (this._downSent) { this._downSent = false; this.emit('net:up'); }
        const seen = this.players.find(p => p.id === env.f);
        if (seen) seen.seen = this.lastRx;
        if (env.v !== NP.VERSION) {
            // one side is running an older cached copy of the site
            this.emit('net:error', 'version mismatch — one of you needs to refresh');
            return;
        }
        // host is the switchboard: anything not addressed to it moves on
        if (this.isHost && this.transport.kind !== 'bus' && env.to && env.to !== '*' && env.to !== this.id) {
            this.transport.send(this._peerFor(env.to), env);
            return;
        }
        const isBus = this.transport && this.transport.kind === 'bus';
        if (this.isHost && !isBus && env.to === '*' && env.f !== this.id) {
            // fan a guest broadcast out to the other guests. a bus needs
            // no help with this — everyone in the room already has it
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
            case 'np:opts': {
                this.gameOptions = (env.d && typeof env.d === 'object') ? env.d : {};
                this.emit('options', this.gameOptions);
                return;
            }
            case 'np:team': {
                const p = this.players.find(x => x.id === env.f);
                if (p && this.isHost) { p.team = env.d && env.d.team === 1 ? 1 : 0; this.broadcastRoster(); this.emit('roster', this.players); }
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
            this.send('np:opts', this.gameOptions);
        }
        this.emit('roster', this.players);
    };
    Session.prototype._onRoster = function (list) {
        if (!Array.isArray(list)) return;
        const mine = this.id;
        this.players = list.map(p => Object.assign({}, p, { me: p.id === mine }));
        this.me = this.players.find(p => p.me) || this.me;
        if (this.players.some(p => p.me)) this.seated = true;
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
        const list = this.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, ready: p.ready, host: !!p.host, ping: p.ping || 0, team: p.team }));
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
    // the host's choice of map and the like, which every guest hears
    Session.prototype.setOption = function (key, value) {
        if (!this.isHost) return;
        this.gameOptions = Object.assign({}, this.gameOptions, { [key]: value });
        this.send('np:opts', this.gameOptions);
        this.emit('options', this.gameOptions);
    };
    // which side somebody is on, until they say otherwise: every other seat
    Session.prototype.teamOf = function (p) {
        if (p.team === 0 || p.team === 1) return p.team;
        return Math.max(0, this.players.indexOf(p)) % 2;
    };
    Session.prototype.setTeam = function (team) {
        this.me.team = team === 1 ? 1 : 0;
        if (this.isHost) this.broadcastRoster();
        else this.send('np:team', { team: this.me.team }, (this.players.find(p => p.host) || {}).id);
        this.emit('roster', this.players);
    };
    Session.prototype.startGame = function () {
        if (!this.isHost) return;
        const g = NP.byId(this.gameId);
        if (!g) return;
        const slots = this.players.map(p => p.id);
        const d = { gameId: this.gameId, seed: Math.floor(Math.random() * 1e9), slots, at: Date.now() };
        if (g.options) d.options = this.gameOptions;
        if (g.teams) { d.teams = {}; this.players.forEach(p => { d.teams[p.id] = this.teamOf(p); }); }
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
            min: 2, max: 8,
            blurb: 'a low poly shooter: draw sigils to load your staff, then go and hit somebody. up to 4 v 4, and bots fill the seats',
            teams: true,
            loadouts: true,
            options: [
                { key: 'mode', label: 'teams', values: [['1', '1 v 1'], ['2', '2 v 2'], ['3', '3 v 3'], ['4', '4 v 4']] },
                { key: 'map', label: 'map', values: [['temple', 'the temple'], ['bin', 'the recycle bin'], ['defrag', 'defrag'], ['wire', 'the long wire']] }
            ],
            scripts: ['games/wizardz/wizardz-data.js', 'games/wizardz/wizardz-sigil.js', 'games/ps1/ps1-world.js', 'games/wizardz/wizardz-sim.js', 'games/ps1/ps1-gl.js', 'games/wizardz/wizardz-gl.js', 'games/wizardz/wizardz.js']
        },
        {
            id: 'dungeonz',
            name: 'dungeonz 98',
            icon: 'bug_report',
            min: 2, max: 4,
            blurb: 'a co-op raid for four: rooms of minions, shrines, cards, a boss at the end. bots take the empty seats',
            options: [
                { key: 'dungeon', label: 'dungeon', values: [['bin', 'the recycle bin (easy)'], ['registry', 'the registry (normal)'], ['bsod', 'the blue screen (hard)']] }
            ],
            scripts: ['games/wizardz/wizardz-data.js', 'games/wizardz/wizardz-sigil.js', 'games/ps1/ps1-world.js', 'games/ps1/ps1-gl.js', 'games/dungeonz/dungeonz-data.js', 'games/dungeonz/dungeonz-sim.js', 'games/dungeonz/dungeonz-gl.js', 'games/dungeonz/dungeonz.js']
        },
        {
            id: 'ageoftroll',
            name: 'age of troll',
            icon: 'castle',
            min: 2, max: 2,
            blurb: 'march an army of trolls through five ages at somebody\'s wall',
            scripts: ['games/age-of-troll/age-of-troll-data.js', 'games/age-of-troll/age-of-troll-sim.js', 'games/age-of-troll/age-of-troll.js']
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
    // the lobby is told what is happening while it happens, since a guest can
    // spend seven seconds finding out that there is no direct route
    // Offline, every way through but two tabs of one browser is a wait that
    // ends in a network error. Say so before the wait.
    NP.OFFLINE = 'you are offline bradar. online play needs the internet; the bots and the two-tab local mode still work';
    function opening(t, onStatus) {
        t.h = { status: onStatus };
        if (t.kind !== 'local' && navigator.onLine === false) return Promise.reject(new Error(NP.OFFLINE));
        return t.open().catch(err => {
            try { t.close(); } catch (e) { }
            throw err;
        });
    }
    NP.host = function (mode, gameId, code, onStatus) {
        code = code || makeCode(5);
        const spec = NP.TRANSPORTS[mode] || NP.TRANSPORTS.auto;
        const t = spec.make(code, true);
        return opening(t, onStatus).then(() => {
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
    NP.join = function (mode, code, onStatus) {
        code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
        if (code.length < 4) return Promise.reject(new Error('that code looks wrong'));
        const spec = NP.TRANSPORTS[mode] || NP.TRANSPORTS.auto;
        const t = spec.make(code, false);
        return opening(t, onStatus).then(() => {
            const s = new Session(t, false, code);
            s.id = t.id || s.id;
            s.me.id = s.id;
            s.startPings();          // the guest side only watches for silence
            NP.current = s;
            setTimeout(() => s.announceProfile(), 30);
            // a hello can fall between two relays, so keep knocking until seated
            const knock = setInterval(() => {
                if (!s.alive || s.seated) clearInterval(knock);
                else s.announceProfile();
            }, 1500);
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
        let mode = localStorage.getItem('mrhakan98-netplay-mode') || 'auto';
        // an invite is for the internet whatever this browser was last used for,
        // and auto can reach a host on any of the internet modes
        if (!NP.TRANSPORTS[mode] || NP.TRANSPORTS[mode].hidden || opts.joinCode) mode = 'auto';
        let gameId = opts.gameId || (session && session.gameId) || NP.CATALOG[0].id;
        let busy = false;
        const unsubs = [];

        win._cleanup = () => {
            unsubs.forEach(u => { try { u(); } catch (e) { } });
            NP.lobbyWin = null;
            // leaving the window while still in the lobby means leaving the lobby
            if (session && session.alive && session.state === 'lobby') session.leave();
        };

        const say = msg => {
            const st = body.querySelector('#np-status');
            if (st) st.textContent = msg;
        };
        function paintLink() {
            const chip = body.querySelector('#np-link');
            const spec = session && session.transport && NP.TRANSPORTS[session.transport.kind];
            if (chip && spec) chip.textContent = spec.chip || spec.label;
        }
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
                    ${(NP.byId(gameId) || {}).loadouts ? '<button id="np-loadout" class="np-btn np-small" data-always="1">your eight spells</button>' : ''}
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
                        ${Object.keys(NP.TRANSPORTS).filter(k => !NP.TRANSPORTS[k].hidden).map(k => `<option value="${k}" ${k === mode ? 'selected' : ''}>${esc(NP.TRANSPORTS[k].label)}</option>`).join('')}
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
                    <button id="np-solo" class="np-btn np-small">or play a bot — no code, no waiting</button>
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
            const loadoutBtn = body.querySelector('#np-loadout');
            if (loadoutBtn) loadoutBtn.onclick = () => {
                NP.loadGame(gameId).then(g => { if (g.editLoadout) g.editLoadout(); }).catch(e => toast('netplay', e.message));
            };
            body.querySelector('#np-avatar').onclick = () => {
                NP.loadGame(gameId).then(g => {
                    if (g.editAvatar) g.editAvatar();
                    else toast('netplay', 'this game has no dress-up screen');
                }).catch(e => toast('netplay', e.message));
            };
            body.querySelector('#np-host').onclick = () => {
                if (busy) return;
                setBusy(true, 'opening a lobby...');
                NP.host(mode, gameId, undefined, say).then(s => {
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
                NP.join(mode, code, say).then(s => {
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
            body.querySelector('#np-solo').onclick = () => startSolo(gameId);
        }

        function renderLobby() {
            const s = session;
            if (!s) return renderConnect();
            const game = NP.byId(s.gameId) || NP.CATALOG[0];
            body.innerHTML = `
                <div class="np-head">
                    <span class="material-symbols-outlined">group</span>
                    <b>${esc(game.name)}</b>
                    <span class="np-chip" id="np-link"></span>
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
                <div id="np-options"></div>
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
            paintLink();
            drawPlayers();
            drawOptions();
            drawChat();
        }

        // anything the game lets the host pick, and which side you are on
        function drawOptions() {
            const box = body.querySelector('#np-options');
            if (!box || !session) return;
            const s = session;
            const game = NP.byId(s.gameId) || {};
            const label = (o, v) => ((o.values.find(x => x[0] === v) || o.values[0])[1]);
            const opts = game.options || [];
            box.innerHTML = opts.map(o => {
                const cur = s.gameOptions[o.key] || o.values[0][0];
                return `<div class="np-row"><label class="np-label">${esc(o.label)}</label>${s.isHost
                    ? `<select class="np-input" data-opt="${esc(o.key)}">${o.values.map(v => `<option value="${esc(v[0])}" ${v[0] === cur ? 'selected' : ''}>${esc(v[1])}</option>`).join('')}</select>`
                    : `<b data-optshow="${esc(o.key)}">${esc(label(o, cur))}</b>`}</div>`;
            }).join('') + (game.teams ? `<div class="np-row"><button id="np-team" class="np-btn np-small" data-always="1">switch sides</button>${game.loadouts ? '<button id="np-loadout2" class="np-btn np-small" data-always="1">your eight spells</button>' : ''}<span class="np-dim">bots fill the empty seats</span></div>` : '');
            const lo2 = box.querySelector('#np-loadout2');
            if (lo2) lo2.onclick = () => { NP.loadGame(s.gameId).then(g => { if (g.editLoadout) g.editLoadout(); }).catch(e => toast('netplay', e.message)); };
            box.querySelectorAll('[data-opt]').forEach(sel => { sel.onchange = () => s.setOption(sel.dataset.opt, sel.value); });
            const t = box.querySelector('#np-team');
            if (t) t.onclick = () => { s.setTeam(1 - s.teamOf(s.me)); drawPlayers(); };
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
                    <div class="np-pstate">${(NP.byId(session.gameId) || {}).teams ? '<span class="np-team' + session.teamOf(p) + '">side ' + (session.teamOf(p) ? 'b' : 'a') + '</span> · ' : ''}${p.ready ? 'ready' : 'waiting'}${p.ping ? ' · ' + p.ping + 'ms' : ''}</div>
                </div>`).join('') +
                (session.players.length < 2
                    ? `<div class="np-player np-empty">
                           <div class="np-slot">empty seat</div>
                           <div class="np-pstate">share the code, or</div>
                           <button id="np-botseat" class="np-btn np-small" data-always="1">play a bot</button>
                       </div>`
                    : '');
            const seatBtn = box.querySelector('#np-botseat');
            // leaving the lobby for a bot match is the honest version of
            // "fill the seat": the code stops working the moment you go
            if (seatBtn) seatBtn.onclick = () => {
                const gid = session.gameId;
                session.leave();
                session = null;
                startSolo(gid);
            };
            if (painter) {
                box.querySelectorAll('canvas.np-avatar').forEach(cv => {
                    const p = session.players.find(x => x.id === cv.dataset.pid);
                    try { painter(cv, p && p.avatar, { scale: 1 }); } catch (e) { }
                });
            }
        }

        // a game may want its own single player front door (wizardz has a
        // roster of opponents); otherwise just start it with a solo session
        function startSolo(gameId) {
            NP.loadGame(gameId).then(g => {
                close();
                if (g.startSolo) g.startSolo();
                else g.start(NP.soloSession(gameId), { solo: true, seed: Math.floor(Math.random() * 1e9) });
            }).catch(e => toast('netplay', e.message));
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
            unsubs.push(s.on('roster', () => { drawPlayers(); paintLink(); }));
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
            unsubs.push(s.on('options', () => drawOptions()));
            unsubs.push(s.on('net:status', m => { say(m); paintLink(); }));
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

    // desktop entry points
    window.openLobby = function (opts) { NP.openLobby(opts || {}); };
})();
