// ===================================================================
// DUNGEONZ 98 — the game on the page
//
// A four seat co-op raid. You and up to three friends (or bots, in whatever seats
// nobody is in) go through a dungeon a room at a time: the gate out of a room opens
// when everything in it is dead, every kill gives everybody xp, levels give cards,
// and cards are spent at the shrine at the end of each section. Then the boss.
//
//   dungeonz-data.js     the numbers
//   dungeonz-sim.js      the rules, the dungeon, the minions, the bots. no page in it
//   dungeonz-gl.js       the dungeon and its inhabitants, on games/ps1/ps1-gl.js
//   this file            the window, the mouse, the wire, the hud
//
// Skills are wizardz sigils (games/wizardz/wizardz-data.js has the glyphs and
// wizardz-sigil.js reads a drawing): press 1 to 4, or press E and draw one, and a
// clean drawing hits harder.
//
// Online the host owns the run, the same way wizardz works: a guest sends what it is
// holding and numbered commands until a snapshot says they landed, moves itself at
// once, and draws everything else from the snapshots.
// ===================================================================
(function () {
    'use strict';

    const D = window.DZ;
    const S = window.DZ_SIM;
    const GL = window.DZ_GL;
    const P = window.PS1_GL;
    const WZ = window.WZ;
    const SIGIL = window.WZ_SIGIL;
    if (!D || !S || !GL || !P) { console.warn('[dungeonz] a file is missing'); return; }
    const RUN = D.RUN, HERO = RUN.hero;
    const DT = S.DT;
    const { sin, cos, hypot, atan2, abs, min, max, floor, round, PI } = Math;
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
    const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));

    // the styles for this game only, fetched with it rather than with the desktop
    function ensureCss() {
        if (document.getElementById('dz-css')) return;
        const l = document.createElement('link');
        l.id = 'dz-css'; l.rel = 'stylesheet'; l.href = 'games/dungeonz/dungeonz.css';
        document.head.appendChild(l);
    }

    // ===============================================================
    // you: the wizard from the wizardz dressing room, if there is one
    // ===============================================================
    const LS = {
        meta: 'mrhakan98-dungeonz-meta',
        dungeon: 'mrhakan98-dungeonz-dungeon',
        settings: 'mrhakan98-dungeonz-settings',
        wzAvatar: 'mrhakan98-wizardz-avatar'
    };
    const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
    const pref = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
    const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
    const BASE_AV = { skin: '#f0c9a0', hat: 'pointy', hatColor: '#7b2ff7', hair: 'none', hairColor: '#e8e8e8', beard: 'long', robe: 'plain', robeColor: '#7b2ff7', trimColor: '#ffb400', staff: 'gnarled', familiar: 'none', aura: 'none', eyes: 'normal' };
    function normAvatar(av) {
        const a = Object.assign({}, BASE_AV, av && typeof av === 'object' ? av : {});
        const lists = WZ && WZ.AVATAR;
        if (lists) ['hat', 'hair', 'beard', 'robe', 'staff', 'familiar', 'eyes'].forEach(k => { if (lists[k].indexOf(a[k]) < 0) a[k] = BASE_AV[k]; });
        ['skin', 'hatColor', 'hairColor', 'robeColor', 'trimColor'].forEach(k => { if (!/^#[0-9a-f]{3,8}$/i.test(String(a[k]))) a[k] = BASE_AV[k]; });
        return a;
    }
    function seededAvatar(seed) {
        let h = 2166136261;
        const str = String(seed || 'wizard');
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return ((h >>> 0) % 100003) / 100003; };
        const L = WZ && WZ.AVATAR;
        if (!L) return BASE_AV;
        const pick = a => a[floor(rnd() * a.length) % a.length];
        return { skin: pick(L.skin), hat: pick(L.hat), hatColor: pick(L.palette), hair: pick(L.hair), hairColor: pick(L.palette), beard: pick(L.beard), robe: pick(L.robe), robeColor: pick(L.palette), trimColor: pick(L.palette), staff: pick(L.staff), familiar: 'none', aura: 'none', eyes: pick(L.eyes) };
    }
    function myAvatar() {
        const prof = window.Netplay ? Netplay.profile() : null;
        if (prof && prof.avatar) return normAvatar(prof.avatar);
        return normAvatar(readJson(LS.wzAvatar) || seededAvatar('me'));
    }
    const myName = () => (window.Netplay ? Netplay.profile().name : 'you');
    function settings() {
        const s = readJson(LS.settings) || {};
        return { sens: typeof s.sens === 'number' && s.sens >= 0.2 && s.sens <= 3 ? s.sens : 1, invert: !!s.invert, assist: s.assist !== false };
    }
    function meta() {
        const m = readJson(LS.meta) || {};
        return { runs: m.runs || 0, wins: m.wins || {}, best: m.best || {}, wipes: m.wipes || 0, kills: m.kills || 0 };
    }
    const chosenDungeon = () => D.dungeonById(pref(LS.dungeon, 'bin')).id;

    // ===============================================================
    // sound, synthesised, and it follows the site's mute button
    // ===============================================================
    let actx = null;
    const soundOn = () => typeof soundEnabled === 'undefined' ? true : soundEnabled;
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
            osc.frequency.setValueAtTime(max(1, freq), t0);
            if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(max(1, o.slideTo), t0 + dur);
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(o.gain || 0.04, t0 + min(0.012, dur / 3));
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(g); g.connect(actx.destination);
            osc.start(t0); osc.stop(t0 + dur + 0.02);
        } catch (e) { }
    }
    const SFX = {
        bolt: () => tone(1300, 0.05, { slideTo: 600, gain: 0.012 }),
        cast: () => tone(540, 0.14, { type: 'triangle', slideTo: 1200, gain: 0.04 }),
        hit: () => tone(200, 0.06, { slideTo: 90, gain: 0.02 }),
        hurt: () => tone(140, 0.16, { type: 'sawtooth', slideTo: 60, gain: 0.05 }),
        die: () => tone(380, 0.12, { type: 'square', slideTo: 90, gain: 0.025 }),
        boom: () => tone(90, 0.3, { type: 'square', slideTo: 40, gain: 0.05 }),
        level: () => [523, 659, 784].forEach((f, i) => tone(f, 0.12, { delay: i * 0.08, gain: 0.04 })),
        down: () => tone(300, 0.5, { type: 'sawtooth', slideTo: 70, gain: 0.05 }),
        gate: () => tone(220, 0.3, { type: 'triangle', slideTo: 440, gain: 0.04 }),
        shrine: () => [392, 523, 659, 784].forEach((f, i) => tone(f, 0.2, { type: 'sine', delay: i * 0.1, gain: 0.04 })),
        fizzle: () => tone(220, 0.16, { type: 'sawtooth', slideTo: 90, gain: 0.035 }),
        win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, { delay: i * 0.12, gain: 0.05 })),
        tick: () => tone(880, 0.06, { gain: 0.03 })
    };

    // ===============================================================
    // the run on this machine
    // ===============================================================
    let G = null, raf = null, lastT = 0, root = null, winRef = null;
    const IS_TOUCH = () => { try { return !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } };

    // who sits where. The same on every screen: the order the lobby gave, then bots
    function seatsFor(session, opts, solo) {
        const humans = solo
            ? [{ id: 'me', name: myName(), avatar: myAvatar() }]
            : (opts.slots ? opts.slots.map(id => session.player(id)).filter(Boolean) : session.players.slice());
        const seats = humans.slice(0, RUN.seats).map(p => ({ id: p.id, name: p.name || 'wizard', avatar: normAvatar(p.avatar || seededAvatar(p.id)), bot: false }));
        let k = (opts.seed >>> 0) % D.PARTY_BOTS.length;
        while (seats.length < RUN.seats) {
            const b = D.PARTY_BOTS[k++ % D.PARTY_BOTS.length];
            seats.push({ id: 'bot-' + b.id, name: b.name, avatar: normAvatar(b.avatar), bot: true });
        }
        return seats;
    }
    function makeGame(session, opts) {
        opts = opts || {};
        const solo = !!opts.solo || !!(session && session.solo);
        const seed = (opts.seed >>> 0) || (floor(Math.random() * 1e9) + 1);
        const o = opts.options || {};
        const dungeon = D.dungeonById(opts.dungeon || o.dungeon || (solo ? chosenDungeon() : 'bin')).id;
        const seats = seatsFor(session, Object.assign({}, opts, { seed }), solo);
        const s = S.newRun({ seed, dungeon, players: seats, stats: true });
        const me = solo ? 0 : seats.findIndex(p => p.id === session.id);
        const isHost = solo ? true : !!session.isHost;
        const g = {
            session, solo, s, me: max(0, me), seed, seats, dungeon, isHost,
            brains: {},
            yaw: PI, pitch: -0.1,
            keys: {}, wantFire: false, jumpQ: false, dashQ: false, fireQ: false,
            stick: { x: 0, y: 0, id: null, ox: 0, oy: 0 }, lookId: null, lookX: 0, lookY: 0,
            stance: false, strokes: [], stroke: null, penUpAt: 0, penMovedAt: 0, pen: { x: 0, y: 0 }, penDown: false,
            settings: settings(),
            acc: 0, snapAcc: 0, inputAcc: 0, netDown: 0, paused: false, pauseWhy: null, speed: 1,
            pending: [], seq: 0, ack: 0, inAck: 0, outbox: [], history: [], snapTick: -1,
            ears: {}, humanSeats: [],
            fx: [], floats: [], beams: [], rings: [], bolts: [], feed: [],
            shake: 0, vignette: 0, hitMark: 0, errX: 0, errZ: 0,
            hint: null, hintT: 0, banner: null, bannerT: 0,
            walkA: [0, 0, 0, 0], fall: [0, 0, 0, 0], raise: [0, 0, 0, 0], rv: [], fireAt: [0, 0, 0, 0],
            camT: 1, fovNow: 1.12, frames: 0, frameMs: 0, fpsT: 0, lastFps: 0, lastMs: 0,
            ended: false, cardsShown: null,
            get heroes() { return this.s.heroes; },
            get phase() { return this.s.phase; },
            get over() { return this.s.over; }
        };
        if (isHost) seats.forEach((p, i) => { if (p.bot) g.brains[i] = S.newBrain((seed ^ (0x5bd1e995 + i * 7919)) >>> 0, { pick: 'smart' }); });
        if (!solo) s.guessing = !isHost;
        g.yaw = s.heroes[g.me].yaw;
        return g;
    }
    function say(g, text, kind, t) { g.hint = { text, kind: kind || 'ok' }; g.hintT = t || 2; }
    function banner(g, text, color, t) { g.banner = { text, color: color || '#ffe14d' }; g.bannerT = t || 1.8; }
    const myHero = g => g.s.heroes[g.me];

    // ---------------------------------------------------------------
    // commands: a cast or a card. A guest numbers them and keeps sending
    // ---------------------------------------------------------------
    const DENY = { cooling: 'still cooling down', down: 'you are down bradar', stunned: 'you are stunned', wait: 'not yet', empty: 'nothing in that slot', notshrine: 'cards are for shrines', nothing: 'no cards to pick' };
    function issue(g, c) {
        if (g.isHost) return S.command(g.s, g.me, c);
        g.seq++;
        g.pending.push({ n: g.seq, c });
        return null;
    }
    function packCommand(p) {
        const c = p.c;
        if (c.c === 'cast') return [p.n, 0, c.k, round((c.q || 0) * 100), round(c.y * 100), c.tx === undefined ? null : round(c.tx * 5), c.tz === undefined ? null : round(c.tz * 5)];
        if (c.c === 'pick') return [p.n, 1, c.n];
        return [p.n, 9];
    }
    function unpackCommand(a) {
        if (!Array.isArray(a)) return null;
        if (a[1] === 0) return { c: 'cast', k: a[2] | 0, q: (a[3] || 0) / 100, y: (a[4] || 0) / 100, tx: typeof a[5] === 'number' ? a[5] / 5 : undefined, tz: typeof a[6] === 'number' ? a[6] / 5 : undefined };
        if (a[1] === 1) return { c: 'pick', n: a[2] | 0 };
        return null;
    }
    function castSlot(g, k, q) {
        const s = g.s, h = myHero(g);
        const why = S.castProblem(s, g.me, k);
        if (why) {
            if (why !== 'empty' || q) { say(g, (h.skills[k] ? D.skillById(h.skills[k].id).name + ': ' : '') + (DENY[why] || 'no'), 'bad', 1.2); SFX.fizzle(); }
            return false;
        }
        const sk = D.skillById(h.skills[k].id);
        const cam = S.camera(s, { x: h.x, y: h.y, z: h.z, yaw: g.yaw, pitch: g.pitch });
        const p = S.crosshairGround(s, cam, sk.range || 18, h);
        issue(g, { c: 'cast', k, q: q || 0, y: g.yaw, tx: p.x, tz: p.z });
        if (!g.isHost) {
            // a guess, so the button answers before the round trip
            const mine = h.skills[k];
            mine.cd = sk.cd; mine.guess = true;
            SFX.cast();
        }
        return true;
    }
    function pickCard(g, n) {
        const why = issue(g, { c: 'pick', n });
        if (why) say(g, DENY[why] || 'no', 'bad');
        else if (!g.isHost) { const h = myHero(g); h.offer = null; h.picks = max(0, h.picks - 1); }
        paintCards(g, true);
        // the card that had the focus has gone: give it back to the dungeon, or the keys stop
        focusGame(g);
    }

    // ===============================================================
    // the wire
    // ===============================================================
    const onRelays = g => !!(g.session && g.session.transport && g.session.transport.kind === 'bus');
    function netSend(g, type, data, to) {
        if (!g.session || g.solo || !g.session.alive) return;
        g.session.send(type, data, to);
    }
    // over the relays, only what somebody would miss
    const QUIET = { hit: 1, bhit: 1, spark: 1, dash: 1, mend: 1, bite: 1, block: 1, soak: 1, go: 1, cast: 1 };
    function sendSnapshot(g, dt) {
        g.snapAcc += dt;
        const done = !!g.s.over;
        const relays = onRelays(g);
        const hz = done ? 1 : relays ? RUN.relayHz : RUN.snapshotHz;
        if (g.snapAcc < 1 / hz) return;
        g.snapAcc = 0;
        if (done) { g.overSent = (g.overSent || 0) + 1; if (g.overSent > 30) return; }
        const extra = {};
        const ears = Object.keys(g.ears);
        if (ears.length) extra.a = ears.map(i => [+i, g.ears[i].seenTo, g.ears[i].inSeq]);
        if (g.outbox.length) {
            const keep = relays ? g.outbox.filter(e => !QUIET[e[0]]) : g.outbox;
            if (keep.length) extra.ev = keep.slice(relays ? -14 : -40);
            g.outbox = [];
        }
        netSend(g, 'dz:s', S.snapshot(g.s, extra, g.humanSeats));
    }
    function onSnapshot(g, d) {
        if (!d || !Array.isArray(d.h)) return;
        const s = g.s;
        if (d.r !== s.run || d.k <= g.snapTick) return;
        const me = myHero(g);
        const bx = me.x, bz = me.z, by = me.y, vy = me.vy, gr = me.grounded;
        if (!S.applySnapshot(s, d)) return;
        g.snapTick = d.k;
        g.lastSnap = performance.now();
        const mine = Array.isArray(d.a) ? d.a.find(x => Array.isArray(x) && x[0] === g.me) : null;
        if (mine && mine[1] > g.ack) { g.ack = mine[1]; g.pending = g.pending.filter(c => c.n > g.ack); }
        if (Array.isArray(d.ev)) d.ev.forEach(e => onEvent(g, e));
        // own seat: what the host says, then the inputs it has not seen yet, again
        me.yaw = g.yaw; me.pitch = g.pitch;
        if (!me.down && !me.out) {
            const seen = mine ? mine[2] : 0;
            g.history = g.history.filter(q => q.q >= seen);
            if (g.history.length) { me.vy = vy; me.grounded = gr; }
            for (const q of g.history) S.moveHero(s, me, q.inp);
            const ex = bx - me.x, ez = bz - me.z;
            if (hypot(ex, ez) < 5) { g.errX += ex; g.errZ += ez; } else { g.errX = g.errZ = 0; }
            if (abs(by - me.y) < 2) me.y = by;
        } else { g.errX = g.errZ = 0; g.history = []; }
        if (g.netDown) comeBack(g);
        paintCards(g);
    }
    function hostInput(g, d, from) {
        if (!d || typeof d !== 'object') return;
        const i = g.s.heroes.findIndex(h => h.id === (from && from.id));
        if (i < 0 || i === g.me || g.seats[i].bot) return;
        if (g.brains[i]) seatBack(g, i);
        if (g.netDown) comeBack(g);
        if (typeof d.r === 'number' && d.r !== g.s.run) return;
        const ear = g.ears[i] || (g.ears[i] = { inSeq: 0, seen: new Set(), seenTo: 0 });
        if (typeof d.q === 'number' && d.q > ear.inSeq) {
            ear.inSeq = d.q;
            const f = d.f | 0;
            S.setInput(g.s, i, { mx: (d.x | 0) / 100, mz: (d.z | 0) / 100, yaw: d.y, pitch: d.p, fire: !!(f & 1), ink: !!(f & 2), jump: !!(f & 4), dash: !!(f & 8) });
        }
        if (Array.isArray(d.c)) {
            for (const a of d.c.slice(0, 32)) {
                if (!Array.isArray(a) || typeof a[0] !== 'number') continue;
                const n = a[0];
                if (n <= ear.seenTo || ear.seen.has(n)) continue;
                ear.seen.add(n);
                while (ear.seen.has(ear.seenTo + 1)) { ear.seenTo++; ear.seen.delete(ear.seenTo); }
                const cmd = unpackCommand(a);
                if (!cmd) continue;
                const why = S.command(g.s, i, cmd);
                if (why && cmd.c === 'cast' && why !== 'empty') netSend(g, 'dz:deny', { why, k: cmd.k }, from.id);
            }
        }
    }
    function sendInput(g, dt) {
        g.inputAcc += dt;
        const hz = onRelays(g) ? RUN.relayHz : RUN.snapshotHz;
        if (g.inputAcc < 1 / hz) return;
        g.inputAcc = 0;
        const inp = g.s.input[g.me];
        const f = (inp.fire ? 1 : 0) | (inp.ink ? 2 : 0) | (g.jumpSent ? 4 : 0) | (g.dashSent ? 8 : 0);
        g.jumpSent = false; g.dashSent = false;
        const msg = { q: ++g.inAck, r: g.s.run, x: round(inp.mx * 100), z: round(inp.mz * 100), y: round(g.yaw * 100) / 100, p: round(g.pitch * 100) / 100, f };
        if (g.pending.length) msg.c = g.pending.slice(0, 12).map(packCommand);
        if (g.session && g.session.alive) g.session.sendToHost('dz:i', msg);
    }
    // somebody gone: a bot takes their seat at once, with their level and their cards,
    // and gives it back if they return. Co-op has nobody to be unfair to, so it never waits
    function seatLeft(g, id) {
        const i = g.s.heroes.findIndex(h => h.id === id);
        if (i < 0 || i === g.me || g.brains[i] || g.s.over) return;
        putBotIn(g, i);
    }
    function putBotIn(g, i) {
        g.brains[i] = S.newBrain((g.seed + i * 104729) >>> 0, { pick: 'smart' });
        g.s.ev.push(['sub', i, 1]);
    }
    function seatBack(g, i) {
        delete g.brains[i];
        g.s.ev.push(['sub', i, 0]);
    }
    function goneAway(g) {
        if (g.s.over) return;
        if (g.isHost) {
            // the host's run goes on: whoever went quiet gets a bot until they speak again
            g.seats.forEach((p, i) => { if (!p.bot && i !== g.me && !g.brains[i]) putBotIn(g, i); });
            say(g, 'the line went quiet. bots have their seats until they come back', 'bot', 3);
            return;
        }
        g.netDown = 1;
        g.downAt = performance.now();
        freeMouse(g);
        paintOverlay(g);
    }
    function comeBack(g) {
        if (!g.netDown) return;
        g.netDown = 0;
        g.acc = 0;
        lastT = performance.now();
        paintOverlay(g);
    }
    function bindNet(g) {
        if (!g.session || g.solo) return;
        const s = g.session, offs = [];
        if (g.isHost) {
            g.humanSeats = g.seats.map((p, i) => (!p.bot && i !== g.me ? i : -1)).filter(i => i >= 0);
            offs.push(s.on('dz:i', (d, from) => hostInput(g, d, from)));
            offs.push(s.on('player-join', p => { const i = g.s.heroes.findIndex(h => h.id === p.id); if (i >= 0 && g.brains[i] && !g.seats[i].bot) seatBack(g, i); }));
            offs.push(s.on('player-leave', p => seatLeft(g, p.id)));
            offs.push(s.on('dz:again', () => { g.theyWantAgain = true; if (g.ended) renderEnd(g); }));
        } else {
            offs.push(s.on('dz:s', d => onSnapshot(g, d)));
            offs.push(s.on('dz:deny', d => { if (!d) return; say(g, DENY[d.why] || 'no', 'bad', 1.2); SFX.fizzle(); const k = myHero(g).skills[d.k]; if (k) { k.cd = 0; k.guess = false; } }));
            offs.push(s.on('dz:new', d => { if (d && d.seed) startRun(g.session, Object.assign({}, g.opts, { seed: d.seed, dungeon: d.dungeon, run: d.run })); }));
            offs.push(s.on('player-leave', p => { if (p.host) goneAway(g); }));
        }
        offs.push(s.on('net:down', () => goneAway(g)));
        offs.push(s.on('closed', () => { if (!g.isHost) goneAway(g); }));
        offs.push(s.on('net:up', () => { comeBack(g); if (!g.isHost && s.alive) s.announceProfile(); }));
        g._netOffs = offs;
    }

    // ===============================================================
    // the mouse, the keys and the thumbs
    // ===============================================================
    const INK_PAUSE = 480, INK_PAUSE_MAX = 1050, HUD_W = 640;
    const hudW = g => g.hudW || HUD_W;
    const wantHudW = (g, w) => g.touch && w < 560 ? clamp(round(w / 0.85), 440, HUD_W) : HUD_W;
    function isLocked(g) { return !!document.pointerLockElement && document.pointerLockElement === g.cv; }
    let lockEverGiven = false;
    function askLock(g) {
        if (g.noLock || !g.cv.requestPointerLock) { g.noLock = true; return; }
        try { const p = g.cv.requestPointerLock(); if (p && p.catch) p.catch(() => lockRefused(g)); } catch (e) { lockRefused(g); }
    }
    function lockRefused(g) { if (isLocked(g)) return; if (!lockEverGiven) g.noLock = true; paintOverlay(g); }
    function freeMouse(g) { if (isLocked(g) && document.exitPointerLock) document.exitPointerLock(); }
    function focusGame(g) { if (g.cv && g.cv.focus) g.cv.focus({ preventScroll: true }); }
    function look(g, dx, dy) {
        const k = 0.0026 * g.settings.sens;
        g.yaw += dx * k;
        g.pitch = clamp(g.pitch - dy * k * (g.settings.invert ? -1 : 1), -0.9, 0.7);
    }
    function toHud(g, cx, cy) { const r = g.cv.getBoundingClientRect(); return { x: (cx - r.left) / r.width * hudW(g), y: (cy - r.top) / r.height * g.hudH }; }
    function everyMove(ev) { const l = ev.getCoalescedEvents ? ev.getCoalescedEvents() : null; return l && l.length && l.length < 64 ? l : [ev]; }

    // ---- the ink stance: draw a skill's sigil instead of pressing its key ----
    function clearInk(g) { g.strokes = []; g.stroke = null; g.penDown = false; }
    function enterStance(g) {
        const h = myHero(g);
        if (g.stance || g.paused || g.s.phase !== 'live' || h.down || h.out || !h.skills.length) {
            if (!h.skills.length) say(g, 'no skills to draw yet bradar. they come from shrines', 'bad');
            return;
        }
        if (!SIGIL) { say(g, 'the sigil reader did not load. use the keys', 'bad'); return; }
        g.stance = true; clearInk(g); g.wantFire = false;
        g.pen.x = hudW(g) / 2; g.pen.y = (g.hudH || 360) / 2;
        SFX.tick(); paintTouch(g);
    }
    function clearStance(g) { g.stance = false; clearInk(g); paintTouch(g); }
    function toggleStance(g) { if (g.stance) clearStance(g); else enterStance(g); }
    function strokePoint(g, x, y) {
        g.pen.x = clamp(x, 0, hudW(g)); g.pen.y = clamp(y, 0, g.hudH || 360);
        g.penMovedAt = performance.now();
        if (!g.stroke) return;
        const last = g.stroke[g.stroke.length - 1];
        if (hypot(g.pen.x - last.x, g.pen.y - last.y) > 1.2) g.stroke.push({ x: g.pen.x, y: g.pen.y });
    }
    function penDown(g) { if (!g.stance || g.penDown) return; g.penDown = true; g.stroke = [{ x: g.pen.x, y: g.pen.y }]; g.strokes.push(g.stroke); }
    function penUp(g) {
        if (!g.penDown) return;
        g.penDown = false;
        if (g.stroke && g.stroke.length < 2) g.strokes.pop();
        g.stroke = null;
        g.penUpAt = performance.now();
    }
    function maybeRead(g, force) {
        if (!g.stance || !g.strokes.length || g.stroke) return;
        const now = performance.now();
        if (!force) {
            const quiet = now - g.penUpAt;
            if (quiet < INK_PAUSE) return;
            if (now - g.penMovedAt < 140 && quiet < INK_PAUSE_MAX) return;
        }
        const strokes = g.strokes;
        clearInk(g);
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        strokes.forEach(st => st.forEach(p => { x0 = min(x0, p.x); y0 = min(y0, p.y); x1 = max(x1, p.x); y1 = max(y1, p.y); }));
        if (max(x1 - x0, y1 - y0) < 14) { say(g, 'draw it bigger bradar', 'bad', 1.2); return; }
        const h = myHero(g);
        const pool = h.skills.map(k => k.id);
        const res = SIGIL.decide(strokes, pool);
        g.lastRead = res;
        if (!res.ok) {
            const nm = sp => (sp ? sp.name : '');
            let text = 'fizzled';
            if (res.why === 'book') text = nm(res.spell) + ' is not one of your skills';
            else if (res.why === 'rough' || res.why === 'split') text = 'fizzled: that nearly looked like ' + nm(res.spell);
            say(g, text, 'bad', 1.6); SFX.fizzle();
            return;
        }
        const k = h.skills.findIndex(q => q.id === res.id);
        if (k < 0) { say(g, res.spell.name + ' is not one of your skills', 'bad'); SFX.fizzle(); return; }
        if (castSlot(g, k, res.q)) {
            const pow = S.drawPower(res.q);
            say(g, D.skillById(res.id).name + ' drawn: ' + round(pow * 100) + '% power' + (res.q > 0.8 ? '. clean!' : ''), 'cast', 1.6);
            clearStance(g);
        }
    }

    function bindInput(g) {
        const cv = g.cv, stage = g.stage;
        g.touch = IS_TOUCH();
        const isFinger = ev => ev.pointerType === 'touch' || ev.pointerType === 'pen';
        const down = ev => {
            if (isFinger(ev)) return;
            if (g.touchMode) { g.touchMode = false; g.touch = IS_TOUCH(); paintTouch(g); }
            if (g.paused || g.ended) return;
            ev.preventDefault();
            focusGame(g);
            if (!isLocked(g) && !g.noLock) { askLock(g); g.mouseX = ev.clientX; g.mouseY = ev.clientY; if (!g.stance) return; }
            if (g.noLock) { g.mouseX = ev.clientX; g.mouseY = ev.clientY; g.dragging = true; }
            if (ev.button === 2) { if (g.stance) clearStance(g); return; }
            if (ev.button !== 0) return;
            if (g.stance) {
                if (g.noLock || !isLocked(g)) { const p = toHud(g, ev.clientX, ev.clientY); g.pen.x = p.x; g.pen.y = p.y; }
                penDown(g);
            } else { g.wantFire = true; g.fireQ = true; }
        };
        const move = ev => {
            if (isFinger(ev) || g.paused) return;
            if (isLocked(g)) {
                const mx = ev.movementX || 0, my = ev.movementY || 0;
                if (abs(mx) > 500 || abs(my) > 500) return;
                if (g.stance) {
                    const r = cv.getBoundingClientRect();
                    for (const e of everyMove(ev)) strokePoint(g, g.pen.x + (e.movementX || 0) / r.width * hudW(g), g.pen.y + (e.movementY || 0) / r.height * g.hudH);
                } else look(g, mx, my);
                return;
            }
            if (g.stance) { for (const e of everyMove(ev)) { const p = toHud(g, e.clientX, e.clientY); strokePoint(g, p.x, p.y); } return; }
            if (g.noLock && g.dragging) {
                look(g, ev.clientX - (g.mouseX || ev.clientX), ev.clientY - (g.mouseY || ev.clientY));
                g.mouseX = ev.clientX; g.mouseY = ev.clientY;
            }
        };
        const up = ev => {
            if (isFinger(ev)) return;
            if (ev.button === 0 || ev.buttons === 0) { g.wantFire = false; penUp(g); g.dragging = false; }
        };
        const noMenu = e => { e.preventDefault(); e.stopPropagation(); };
        cv.addEventListener('pointerdown', down);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        stage.addEventListener('contextmenu', noMenu);
        const lockChange = () => {
            if (isLocked(g)) { lockEverGiven = true; g.hadLock = true; paintOverlay(g); return; }
            g.lockLostAt = performance.now();
            g.wantFire = false; penUp(g);
            if (g.hadLock && !g.ended) { g.hadLock = false; if (g.solo) pause(g, true, 'mouse'); paintOverlay(g); }
        };
        const lockError = () => lockRefused(g);
        document.addEventListener('pointerlockchange', lockChange);
        document.addEventListener('pointerlockerror', lockError);

        const typing = e => /^(input|textarea|select)$/i.test((e.target || {}).tagName || '') || (e.target && e.target.isContentEditable);
        const focused = () => root && (root.contains(document.activeElement) || isLocked(g));
        const keyDown = e => {
            if (typing(e) || !focused() || e.ctrlKey || e.metaKey || e.altKey) return;
            const k = e.key.toLowerCase();
            if (k === 'escape') {
                e.stopPropagation(); e.preventDefault();
                if (performance.now() - (g.lockLostAt || -1e9) < 300) return;
                if (!g.ended) { if (g.paused) pause(g, false); else if (g.solo) pause(g, true, 'menu'); else toggleMenu(g); }
                return;
            }
            if (k === 'p' && !e.repeat) { if (g.solo) pause(g, !g.paused, 'menu'); else toggleMenu(g); return; }
            if (g.paused) return;
            if (e.target && e.target.tagName === 'BUTTON' && (k === ' ' || k === 'enter')) return;
            if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'enter', 'shift'].includes(k)) e.preventDefault();
            if ((k === 'e' || k === 'q') && !e.repeat) { toggleStance(g); return; }
            if (k === 'enter' && !e.repeat) { maybeRead(g, true); return; }
            if (/^[1-4]$/.test(k) && !e.repeat) {
                // at a shrine, the number keys pick a card
                if (g.cardsShown && +k <= 3) { pickCard(g, +k - 1); return; }
                castSlot(g, +k - 1, 0); return;
            }
            if (k === ' ') { if (g.stance) { clearInk(g); return; } if (!e.repeat) g.jumpQ = true; }
            if (k === 'shift' && !e.repeat) g.dashQ = true;
            g.keys[k] = true;
        };
        const keyUp = e => { delete g.keys[e.key.toLowerCase()]; };
        const blur = () => { g.keys = {}; g.wantFire = false; penUp(g); if (g.solo && !g.ended) pause(g, true, 'focus'); };
        const hidden = () => { if (document.hidden) blur(); };
        window.addEventListener('keydown', keyDown, true);
        window.addEventListener('keyup', keyUp);
        window.addEventListener('blur', blur);
        document.addEventListener('visibilitychange', hidden);

        // thumbs: the left third is a stick, the rest looks, and in the stance it is a pen
        const touches = new Map();
        const tDown = ev => {
            if (!isFinger(ev)) return;
            ev.preventDefault();
            g.touchMode = true; g.touch = true; paintTouch(g);
            if (g.paused || g.ended) return;
            const r = stage.getBoundingClientRect();
            const left = ev.clientX - r.left < r.width * 0.42;
            if (left && g.stick.id === null) {
                g.stick.id = ev.pointerId; g.stick.ox = ev.clientX; g.stick.oy = ev.clientY;
                touches.set(ev.pointerId, 'stick');
            } else if (g.stance) {
                const p = toHud(g, ev.clientX, ev.clientY); g.pen.x = p.x; g.pen.y = p.y;
                if (!g.penDown) { penDown(g); touches.set(ev.pointerId, 'pen'); }
            } else if (g.lookId === null) {
                g.lookId = ev.pointerId; g.lookX = ev.clientX; g.lookY = ev.clientY;
                touches.set(ev.pointerId, 'look');
            }
            try { stage.setPointerCapture(ev.pointerId); } catch (e) { }
        };
        const tMove = ev => {
            if (!isFinger(ev)) return;
            const role = touches.get(ev.pointerId);
            if (!role) return;
            ev.preventDefault();
            if (role === 'stick') {
                let dx = (ev.clientX - g.stick.ox) / 46, dy = (ev.clientY - g.stick.oy) / 46;
                const l = hypot(dx, dy);
                if (l > 1) { dx /= l; dy /= l; }
                g.stick.x = dx; g.stick.y = dy;
            } else if (role === 'look') {
                look(g, (ev.clientX - g.lookX) * 2.1, (ev.clientY - g.lookY) * 2.1);
                g.lookX = ev.clientX; g.lookY = ev.clientY;
            } else if (role === 'pen') {
                for (const e of everyMove(ev)) { const p = toHud(g, e.clientX, e.clientY); strokePoint(g, p.x, p.y); }
            }
        };
        const tUp = ev => {
            if (!isFinger(ev)) return;
            const role = touches.get(ev.pointerId);
            touches.delete(ev.pointerId);
            if (role === 'stick') { g.stick.id = null; g.stick.x = 0; g.stick.y = 0; }
            else if (role === 'look') g.lookId = null;
            else if (role === 'pen') penUp(g);
        };
        stage.addEventListener('pointerdown', tDown);
        stage.addEventListener('pointermove', tMove);
        stage.addEventListener('pointerup', tUp);
        stage.addEventListener('pointercancel', tUp);
        g._unbind = () => {
            cv.removeEventListener('pointerdown', down);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            stage.removeEventListener('contextmenu', noMenu);
            document.removeEventListener('pointerlockchange', lockChange);
            document.removeEventListener('pointerlockerror', lockError);
            window.removeEventListener('keydown', keyDown, true);
            window.removeEventListener('keyup', keyUp);
            window.removeEventListener('blur', blur);
            document.removeEventListener('visibilitychange', hidden);
            stage.removeEventListener('pointerdown', tDown);
            stage.removeEventListener('pointermove', tMove);
            stage.removeEventListener('pointerup', tUp);
            stage.removeEventListener('pointercancel', tUp);
            freeMouse(g);
        };
    }
    function bindTouchButtons(g) {
        const el = g.touchEl;
        const stop = e => { e.stopPropagation(); e.preventDefault(); };
        const hold = (sel, on, off) => {
            const b = el.querySelector(sel);
            if (!b) return;
            b.addEventListener('pointerdown', e => { stop(e); g.touchMode = true; g.touch = true; try { b.setPointerCapture(e.pointerId); } catch (x) { } on(); });
            const rel = e => { stop(e); if (off) off(); };
            b.addEventListener('pointerup', rel);
            b.addEventListener('pointercancel', rel);
        };
        hold('#dz-t-fire', () => { if (!g.stance) { g.wantFire = true; g.fireQ = true; } }, () => { g.wantFire = false; });
        hold('#dz-t-ink', () => toggleStance(g));
        hold('#dz-t-jump', () => { g.jumpQ = true; });
        hold('#dz-t-dash', () => { g.dashQ = true; });
        hold('#dz-t-menu', () => { if (g.solo) pause(g, !g.paused, 'menu'); else toggleMenu(g); });
        for (let k = 0; k < 4; k++) hold('#dz-t-s' + k, () => castSlot(g, k, 0));
    }
    function toggleMenu(g) { g.menuOpen = !g.menuOpen; if (g.menuOpen) { g.wantFire = false; penUp(g); freeMouse(g); } paintOverlay(g); }
    function pause(g, on, why) {
        if (!g || !g.solo || g.ended || g.paused === on) return;
        g.paused = on; g.pauseWhy = why || null;
        g.keys = {}; g.wantFire = false;
        if (on) { penUp(g); freeMouse(g); }
        else { lastT = performance.now(); g.acc = 0; if (!g.touchMode && !g.noLock) askLock(g); focusGame(g); }
        paintOverlay(g);
    }
    function currentInput(g) {
        const k = g.keys;
        let mx = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0);
        let mz = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0);
        if (g.stick.id !== null) { mx = g.stick.x; mz = -g.stick.y; }
        const inp = { mx, mz, yaw: g.yaw, pitch: g.pitch, fire: (g.wantFire || g.fireQ) && !g.stance, ink: g.stance, jump: g.jumpQ, dash: g.dashQ };
        if (g.jumpQ) g.jumpSent = true;
        if (g.dashQ) g.dashSent = true;
        g.jumpQ = false; g.dashQ = false;
        return inp;
    }
    // a thumb on glass is a worse mouse: while it fires, the aim leans towards whatever
    // is nearly under the crosshair. Only the yaw this side sends is touched
    function assistAim(g, dt) {
        const h = myHero(g);
        if (!g.touch || !g.settings.assist || !g.wantFire || g.stance || h.down || h.out) return;
        let best = null, be = 0.28;
        for (const t of S.enemiesNear(g.s, h.x, h.z, 22)) {
            const e = abs(angleDiff(atan2(t.e.x - h.x, -(t.e.z - h.z)), g.yaw));
            if (e < be) { be = e; best = t.e; }
        }
        if (!best) return;
        g.yaw += angleDiff(atan2(best.x - h.x, -(best.z - h.z)), g.yaw) * min(1, dt * 6);
    }
    function angleDiff(a, b) { let d = a - b; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI; return d; }

    // ===============================================================
    // the loop
    // ===============================================================
    function pumpEvents(g) {
        const s = g.s;
        if (!s.ev.length) return;
        for (const e of s.ev) { onEvent(g, e); if (g.isHost && !g.solo) g.outbox.push(e); }
        s.ev.length = 0;
    }
    function tick(g) {
        const s = g.s;
        for (const h of s.heroes) { h.px = h.x; h.py = h.y; h.pz = h.z; }
        for (const m of s.minions) if (m.state === 1) { m.px = m.x; m.pz = m.z; }
        const inp = currentInput(g);
        S.setInput(s, g.me, inp);
        if (g.isHost) {
            for (const i in g.brains) S.think(s, +i, g.brains[i]);
            S.step(s);
        } else {
            // a guest moves itself, and guesses the rest from the last snapshot
            const me = myHero(g);
            g.history.push({ q: g.inAck, inp: S.sanitizeInput(inp) });
            if (g.history.length > 120) g.history.shift();
            if (!me.down && !me.out) S.moveHero(s, me, s.input[g.me]); else S.moveHero(s, me, Object.assign({}, s.input[g.me], { mx: me.down ? s.input[g.me].mx : 0, mz: me.down ? s.input[g.me].mz : 0 }));
            for (const k of me.skills) if (k.cd > 0) { k.cd = max(0, k.cd - DT); if (!k.cd) k.guess = false; }
            me.firing = inp.fire && !me.down && !me.out;
        }
        if (g.stance && (myHero(g).down || myHero(g).out || s.phase !== 'live')) clearStance(g);
    }
    function loop(now) {
        raf = requestAnimationFrame(loop);
        const g = G;
        if (!g || !g.R) return;
        const dtRaw = (now - lastT) / 1000 || 0;
        const dt = clamp(dtRaw, 0, 0.1);
        lastT = now;
        const t0 = performance.now();
        if (g.solo && winRef && winRef.win.style.display === 'none' && !g.paused) pause(g, true, 'focus');
        const running = !g.paused && !g.netDown;
        if (running) {
            g.acc += dt * (g.speed || 1);
            let budget = g.speed > 1 ? 400 : 6;
            while (g.acc + 1e-9 >= DT && budget-- > 0) { tick(g); g.acc -= DT; g.fireQ = false; }
            if (g.acc > DT * 4 && g.speed <= 1) g.acc = 0;
            pumpEvents(g);
            maybeRead(g, false);
        }
        if (g.isHost && !g.solo) sendSnapshot(g, dt);
        if (!g.isHost && !g.solo && !g.netDown) sendInput(g, dt);
        if (!g.ended && g.s.over) endRun(g);
        render(g, g.paused ? 0 : dt);
        const ms = performance.now() - t0;
        g.frames++; g.frameMs += ms; g.fpsT += dtRaw;
        if (g.fpsT >= 1) { g.lastFps = g.frames / g.fpsT; g.lastMs = g.frameMs / g.frames; g.frames = 0; g.fpsT = 0; g.frameMs = 0; }
    }
    function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = null; }

    // ===============================================================
    // what happened, as light and noise
    // ===============================================================
    const EL = { fire: [1, 0.5, 0.15], ice: [0.55, 0.85, 1], storm: [0.8, 0.85, 1], arcane: [0.75, 0.5, 1], nature: [0.4, 1, 0.45], shadow: [0.55, 0.3, 0.8] };
    const elCol = id => { const sk = D.skillById(id); return sk ? EL[sk.el] || [1, 1, 1] : [0.3, 1, 0.5]; };
    function burst(g, x, y, z, n, col, speed, size, life, opts) {
        if (g.fx.length > 500) return;
        opts = opts || {};
        for (let i = 0; i < n; i++) {
            const a = Math.random() * 6.28, b = Math.random() * 3.14 - 1.57, v = speed * (0.4 + Math.random() * 0.6);
            g.fx.push({ x, y, z, vx: cos(a) * cos(b) * v, vy: sin(b) * v + (opts.up || 0), vz: sin(a) * cos(b) * v, t: life * (0.6 + Math.random() * 0.5), life, size: size * (0.7 + Math.random() * 0.6), tile: opts.tile === undefined ? P.TILE.star : opts.tile, col, grav: opts.grav === undefined ? 6 : opts.grav, rot: a });
        }
    }
    function addFloat(g, x, y, z, text, color) {
        if (g.floats.length > 40) g.floats.shift();
        g.floats.push({ x: x + (Math.random() - 0.5) * 0.6, y, z, text, color, t: 1 });
    }
    function botLine(g, i, kind) {
        const h = g.s.heroes[i];
        if (!h || !g.seats[i] || !g.seats[i].bot) return;
        const l = D.BOT_LINES[kind];
        if (!l || Math.random() > 0.6) return;
        g.feed.push({ text: h.name + ': ' + l[floor(Math.random() * l.length)], t: 4, good: true });
        if (g.feed.length > 4) g.feed.shift();
    }
    function onEvent(g, e) {
        const s = g.s, me = g.me;
        switch (e[0]) {
            case 'cast': {
                const h = s.heroes[e[1]], sk = D.SKILLS[e[2]];
                if (!h || !sk) break;
                burst(g, h.x, h.y + 1.2, h.z, 10, EL[sk.el] || [1, 1, 1], 3.5, 0.14, 0.4);
                g.rings.push({ x: h.x, y: h.y + 0.06, z: h.z, r0: 0.4, r1: 2, t: 0.35, life: 0.35, col: EL[sk.el], tile: P.TILE.sigil });
                if (e[1] === me && g.isHost) SFX.cast();
                if (e[1] !== me && sk.kind === 'shot') g.bolts.push(cosmeticBolt(h, sk.id, h.yaw, 26));
                break;
            }
            case 'hit': {
                const m = s.byId.get(e[1]);
                if (!m) break;
                if (e[3] === me || g.solo) addFloat(g, m.x, 1.6, m.z, String(e[2]), e[3] === me ? '#ffe14d' : '#c8c8c8');
                if (e[3] === me) { g.hitMark = 0.12; SFX.hit(); }
                break;
            }
            case 'bhit': if (e[2] === me) { addFloat(g, s.boss ? s.boss.x : 0, 5, s.boss ? s.boss.z : 0, String(e[1]), '#ffe14d'); g.hitMark = 0.12; } break;
            case 'die': {
                const m = s.byId.get(e[1]);
                burst(g, e[2], 0.8, e[3], 14, m && m.elite ? [1, 0.85, 0.3] : [0.7, 1, 0.5], 4, 0.22, 0.6, { tile: P.TILE.smoke, grav: 2 });
                SFX.die();
                break;
            }
            case 'hurt': {
                const h = s.heroes[e[1]];
                if (!h) break;
                addFloat(g, h.x, h.y + 2.2, h.z, '-' + e[2], e[1] === me ? '#ff6b6b' : '#ff9a9a');
                if (e[1] === me) { g.vignette = min(1, g.vignette + 0.35); g.shake = min(0.4, g.shake + e[2] * 0.01); SFX.hurt(); }
                break;
            }
            case 'soak': { const h = s.heroes[e[1]]; if (h) addFloat(g, h.x, h.y + 2.2, h.z, 'blocked', '#9fc8ff'); break; }
            case 'boom': {
                const [, x, z, r, kind] = e;
                const col = kind === 3 ? [1, 0.3, 0.25] : kind === 2 ? [1, 0.55, 0.2] : kind === 4 ? [0.6, 0.3, 0.9] : [1, 0.6, 0.25];
                g.rings.push({ x, y: 0.1, z, r0: 0.3, r1: r * 1.1, t: 0.4, life: 0.4, col, tile: P.TILE.ring });
                burst(g, x, 0.6, z, 18, col, r * 2.2, 0.3, 0.55, { tile: P.TILE.smoke, grav: 2 });
                const h = myHero(g);
                if (hypot(x - h.x, z - h.z) < 20) { SFX.boom(); g.shake = min(0.6, g.shake + 0.15); }
                break;
            }
            case 'chain': g.beams.push({ x1: e[2], y1: 1.2, z1: e[3], x2: e[4], y2: 1.1, z2: e[5], t: 0.22, life: 0.22, w: 0.22, col: [0.75, 0.85, 1] }); break;
            case 'nova': { const h = s.heroes[e[1]]; if (h) { g.rings.push({ x: h.x, y: 0.3, z: h.z, r0: 0.5, r1: e[2], t: 0.4, life: 0.4, col: [0.8, 0.85, 1], tile: P.TILE.halo }); burst(g, h.x, 1, h.z, 22, [0.8, 0.9, 1], e[2] * 2, 0.22, 0.5); SFX.boom(); } break; }
            case 'blink': g.beams.push({ x1: e[2], y1: 1, z1: e[3], x2: e[4], y2: 1, z2: e[5], t: 0.25, life: 0.25, w: 0.5, col: [0.75, 0.55, 1] }); burst(g, e[4], 1, e[5], 14, [0.85, 0.7, 1], 3, 0.2, 0.45); break;
            case 'buff': { const h = s.heroes[e[1]], sk = D.SKILLS[e[2]]; if (h && sk) burst(g, h.x, h.y + 1, h.z, 14, EL[sk.el], 2.4, 0.2, 0.7, { grav: -3 }); break; }
            case 'mend': { const a = s.byId.get(e[1]), b = s.byId.get(e[2]); if (a && b) g.beams.push({ x1: a.x, y1: 1, z1: a.z, x2: b.x, y2: 1, z2: b.z, t: 0.35, life: 0.35, w: 0.15, col: [0.3, 1, 0.5] }); break; }
            case 'slam': SFX.boom(); g.shake = min(0.5, g.shake + 0.12); burst(g, e[2], 0.3, e[3], 16, [0.8, 0.7, 0.6], e[4] * 2, 0.3, 0.5, { tile: P.TILE.smoke, grav: 1 }); break;
            case 'level': {
                const h = s.heroes[e[1]];
                if (h) burst(g, h.x, h.y + 1, h.z, 16, [1, 0.9, 0.3], 3, 0.14, 0.8, { grav: -4 });
                if (e[1] === me) { banner(g, 'level ' + e[2], '#ffe14d', 1.6); SFX.level(); say(g, 'a new card waits at the next shrine', 'pick', 2.2); }
                else botLine(g, e[1], 'level');
                break;
            }
            case 'down': {
                const h = s.heroes[e[1]];
                if (e[1] === me) { banner(g, 'you are down. hold on', '#ff6b6b', 2.4); SFX.down(); }
                else { say(g, (h ? h.name : 'somebody') + ' is down. stand next to them to get them up', 'bad', 3); botLine(g, e[1], 'down'); }
                break;
            }
            case 'revived': { const h = s.heroes[e[1]]; if (e[1] === me) banner(g, 'back up', '#0df259', 1.4); else if (h) say(g, h.name + ' is back up', 'ok'); botLine(g, e[1], 'up'); break; }
            case 'out': if (e[1] === me) banner(g, 'out until the room is clear', '#ff6b6b', 2.4); break;
            case 'up': break;
            case 'wake': if (e[2] > 0) say(g, e[2] + ' of them woke up', 'bad', 1.4); break;
            case 'clear': SFX.gate(); banner(g, 'room clear. the gate is open', '#0df259', 1.6); break;
            case 'shrine': SFX.shrine(); banner(g, 'checkpoint', '#6fe8ff', 2); say(g, 'healed. spend your cards: 1, 2 or 3', 'pick', 3); break;
            case 'onward': if (e[1] > 0) say(g, 'the way on is open', 'ok', 2); break;
            case 'chest': SFX.level(); banner(g, 'a chest: a card each', '#ffcf3a', 1.8); break;
            case 'boss': {
                const B = D.BOSSES[s.dun.def.boss];
                banner(g, B.name, '#ff6b6b', 3); say(g, B.name + ': ' + B.phases[0].line, 'bad', 4);
                for (const i in g.brains) botLine(g, +i, 'boss');
                break;
            }
            case 'phase': { const B = D.BOSSES[s.dun.def.boss]; const p = B.phases[e[1]]; if (p) { banner(g, 'phase ' + (e[1] + 1), '#ff6b6b', 1.6); say(g, B.name + ': ' + p.line, 'bad', 4); } break; }
            case 'summon': say(g, 'it called for help', 'bad', 1.6); break;
            case 'bdie': SFX.win(); break;
            case 'wipe': banner(g, 'wiped. back to the shrine', '#ff6b6b', 3); say(g, e[2] + ' continue' + (e[2] === 1 ? '' : 's') + ' left', 'bad', 3); break;
            case 'pick': break;
            case 'sub': { const h = s.heroes[e[1]]; if (h) say(g, e[2] ? h.name + ' left. a bot has their seat' : h.name + ' is back', 'bot', 2.4); break; }
            case 'go': SFX.tick(); break;
        }
    }
    function cosmeticBolt(h, kind, yaw, speed) {
        const fx = sin(yaw), fz = -cos(yaw);
        return { x: h.x + fx * 0.6, y: S.SHOT_Y, z: h.z + fz * 0.6, vx: fx * speed, vz: fz * speed, t: 0.8, kind };
    }

    // ===============================================================
    // the frame
    // ===============================================================
    const lerp = (a, b, t) => a + (b - a) * t;
    function heroViews(g, dt, alpha) {
        const s = g.s, out = [];
        s.heroes.forEach((h, i) => {
            const mine = i === g.me;
            let x = h.px === undefined ? h.x : lerp(h.px, h.x, alpha), y = h.py === undefined ? h.y : lerp(h.py, h.y, alpha), z = h.pz === undefined ? h.z : lerp(h.pz, h.z, alpha);
            if (mine && !g.isHost) { const k = Math.pow(0.0005, dt); g.errX *= k; g.errZ *= k; x += g.errX; z += g.errZ; }
            if (!mine && !g.isHost) {
                const k = 1 - Math.pow(0.0004, dt);
                const rv = g.rv[i] || (g.rv[i] = { x, y, z });
                if (hypot(x - rv.x, z - rv.z) > 10) { rv.x = x; rv.y = y; rv.z = z; }
                rv.x = lerp(rv.x, x, k); rv.y = lerp(rv.y, y, k); rv.z = lerp(rv.z, z, k);
                x = rv.x; y = rv.y; z = rv.z;
            }
            const speed = hypot(h.mvx || 0, h.mvz || 0);
            g.walkA[i] += speed * dt * 1.5;
            g.fall[i] = lerp(g.fall[i], h.down || h.out ? 1 : 0, min(1, dt * 7));
            g.raise[i] = lerp(g.raise[i], h.firing || h.castT > 0 || h.stance ? 1 : 0.25, min(1, dt * 12));
            out.push({
                x, y, z, yaw: mine ? g.yaw : h.yaw, pitch: mine ? g.pitch * 0.5 : 0, avatar: h.avatar,
                walk: speed > 0.3 && !h.down ? g.walkA[i] : 0, raise: g.raise[i], kneel: h.stance ? 1 : 0, fall: g.fall[i],
                alpha: h.out ? 0.35 : h.safe > 0 && floor(s.t * 10) % 2 ? 0.6 : undefined,
                hidden: mine && g.camT < 0.25, flash: h.hitT > 0 ? 0.6 : 0, h, i
            });
        });
        return out;
    }
    function minionViews(g, dt, alpha) {
        const s = g.s, out = [], me = myHero(g);
        const k = 1 - Math.pow(0.002, dt);
        for (const m of s.minions) {
            if (m.state !== 1) continue;
            let x = m.x, z = m.z;
            if (!g.isHost) {
                // ease to where the host last said
                if (m.tx !== undefined) {
                    if (hypot(m.tx - m.x, m.tz - m.z) > 6) { m.x = m.tx; m.z = m.tz; }
                    m.vx = (m.tx - m.x) * 4; m.vz = (m.tz - m.z) * 4;
                    m.x = lerp(m.x, m.tx, k); m.z = lerp(m.z, m.tz, k);
                    m.yaw += angleDiff(m.tyaw, m.yaw) * k;
                }
                x = m.x; z = m.z;
            } else if (m.px !== undefined) { x = lerp(m.px, m.x, alpha); z = lerp(m.pz, m.z, alpha); }
            if (abs(z - me.z) > 48) continue;
            const M = D.MINIONS[m.kind];
            const moving = hypot(m.vx || 0, m.vz || 0) > 0.3;
            const bob = m.kind === 'popup' || m.kind === 'healer' ? 0.3 + sin(s.t * 3 + m.id) * 0.15 : moving ? abs(sin(s.t * 10 + m.id)) * 0.12 : 0;
            const wind = m.act ? sin(s.t * 30) * 0.08 : 0;
            out.push({
                kind: m.kind, x, y: bob, z, yaw: m.yaw + wind, lean: m.act === 1 ? -0.25 : m.stunT > 0 ? 0.3 : 0,
                roll: moving && m.kind !== 'popup' ? sin(s.t * 10 + m.id) * 0.1 : 0,
                scale: m.elite ? D.ELITE.size : 1, r: m.r, elite: m.elite,
                flash: m.hitT > 0 ? 0.7 : m.act === 2 ? (floor(s.t * 12) % 2 ? 0.8 : 0) : 0, m
            });
        }
        return out;
    }
    function bossView(g, dt) {
        const s = g.s, b = s.boss;
        if (!b || !s.bossOn) return null;
        const B = D.BOSSES[b.kind];
        if (!g.isHost && b.tx !== undefined) {
            const k = 1 - Math.pow(0.002, dt);
            b.x = lerp(b.x, b.tx, k); b.z = lerp(b.z, b.tz, k); b.yaw += angleDiff(b.tyaw, b.yaw) * k;
        }
        return { x: b.x, y: sin(s.t * 1.5) * 0.15 + (B.look === 'bsod' ? 0.4 : 0), z: b.z, yaw: b.yaw, look: B.look, r: b.r, flash: b.hitT > 0 ? 0.5 : 0, safe: b.safe > 0, lean: b.atk ? -0.12 : 0 };
    }
    function render(g, dt) {
        const s = g.s, R = g.R, me = myHero(g);
        fit(g);
        const alpha = clamp(g.acc / DT, 0, 1);
        if (!g.stance) assistAim(g, dt);
        const heroes = heroViews(g, dt, alpha);
        const mine = heroes[g.me];
        const cam = S.camera(s, { x: mine.x, y: me.out ? me.y + 1 : mine.y, z: mine.z, yaw: g.yaw, pitch: g.pitch });
        g.camT = cam.t;
        g.shake = max(0, g.shake - dt * 1.4);
        const sh = g.shake * 0.25;
        const camV = { x: cam.x + (sh ? (Math.random() - 0.5) * sh : 0), y: cam.y + (sh ? (Math.random() - 0.5) * sh : 0), z: cam.z, fx: cam.fx, fy: cam.fy, fz: cam.fz };
        const wantFov = g.aspect < 1 ? min(1.75, 2 * Math.atan(Math.tan(0.62) / g.aspect)) : 1.12;
        g.fovNow = lerp(g.fovNow, wantFov, min(1, dt * 12));
        let tint = null;
        if (g.stance) tint = [0.62, 0.66, 0.85];
        else if (me.down || me.out) tint = [0.6, 0.4, 0.4];
        const minions = minionViews(g, dt, alpha);
        const boss = bossView(g, dt);
        // cosmetic bolts: a guest's own at once, and everybody else's from their firing flag
        if (!g.isHost) {
            s.heroes.forEach((h, i) => {
                if (!h.firing || h.down || h.out) return;
                g.fireAt[i] -= dt;
                if (g.fireAt[i] > 0) return;
                g.fireAt[i] = HERO.bolt.rof;
                g.bolts.push(cosmeticBolt(h, 'bolt', i === g.me ? g.yaw : h.yaw, HERO.bolt.speed));
                if (i === g.me) SFX.bolt();
            });
        } else if (me.firing && s.tick !== g.boltTick && me.fireCd > HERO.bolt.rof - DT * 1.5) { g.boltTick = s.tick; SFX.bolt(); }
        const W = s.dun.world;
        g.bolts = g.bolts.filter(b => {
            b.t -= dt; b.x += b.vx * dt; b.z += b.vz * dt;
            if (b.t <= 0 || W.at(b.x, b.z) > b.y) return false;
            for (const m of minions) if (hypot(m.x - b.x, m.z - b.z) < m.r + 0.3) return false;
            if (boss && hypot(boss.x - b.x, boss.z - b.z) < boss.r + 0.3) return false;
            return true;
        });
        if (!g.isHost && s.eproj) for (const p of s.eproj) { p.x += p.vx * dt; p.z += p.vz * dt; }
        const glow = b => drawGlow(g, b, dt, heroes, minions, boss, alpha);
        R.frame({ dun: s.dun, s, cam: camV, fov: g.fovNow, tint, heroes, minions, boss, t: s.t + 100, glow });
        drawHud(g, dt, heroes, minions, boss);
        renderKnob(g);
    }
    function drawGlow(g, b, dt, heroes, minions, boss, alpha) {
        const s = g.s, T = b.TILE;
        const red = [1, 0.18, 0.12];
        // the red bits on the floor, filling up as the moment gets close
        for (const t of s.tel) {
            if (t.t < 0 && t.k !== 'ring') { b.disc(t.x, 0.06, t.z, t.r, T.ring, [0.35, 0.08, 0.06], 0); continue; }
            const u = clamp(t.t / (t.total || 1), 0, 1);
            const col = t.side === 0 ? [1, 0.55, 0.15] : red;
            if (t.k === 'lane') {
                b.lane(t.x, 0.07, t.z, t.x2, 0.07, t.z2, t.r, T.white, [col[0] * 0.25, col[1] * 0.25, col[2] * 0.25]);
                const mx = t.x + (t.x2 - t.x) * u, mz = t.z + (t.z2 - t.z) * u;
                b.lane(t.x, 0.08, t.z, mx, 0.08, mz, t.r, T.white, [col[0] * 0.6, col[1] * 0.6, col[2] * 0.6]);
            } else if (t.k === 'ring') {
                if (t.t < 0) continue;
                const r = t.r;
                for (let k = 0; k < 28; k++) {
                    const a = k / 28 * PI * 2;
                    b.sprite(t.x + sin(a) * r, 0.35, t.z + cos(a) * r, 0.45, T.flare, [1, 0.35, 0.2], 0);
                }
            } else {
                b.disc(t.x, 0.06, t.z, t.r, T.ring, col, s.t);
                b.disc(t.x, 0.07, t.z, t.r * u, T.glow, [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7], 0);
            }
        }
        // zones
        for (const z of s.zones) {
            b.disc(z.x, 0.08, z.z, z.r, T.ring, [0.5, 0.75, 1], s.t);
            for (let k = 0; k < 6; k++) { const a = s.t * 2 + k; b.sprite(z.x + sin(a * 1.7) * z.r * 0.7, 0.5 + (s.t * 3 + k) % 2.5, z.z + cos(a * 1.3) * z.r * 0.7, 0.18, T.star, [0.85, 0.95, 1], a); }
        }
        // decoys: a shadow of whoever cast it
        for (const d of s.decoys) { b.sprite(d.x, 1.2, d.z, 1.1, T.smoke, [0.45, 0.2, 0.7], s.t); b.disc(d.x, 0.06, d.z, d.taunt || 10, T.ring, [0.3, 0.15, 0.45], -s.t * 0.3); }
        // shrines and torches
        s.dun.rooms.forEach(rm => {
            if (abs(rm.cz - s.heroes[g.me].z) > 46) return;
            if (rm.kind === 'shrine') {
                const live = s.shrine && s.shrine.room === rm.i && !s.shrine.done;
                b.disc(rm.cx, 0.05, rm.cz, 4.5, T.ring, live ? [0.3, 1, 1] : [0.1, 0.35, 0.4], s.t * 0.4);
                b.sprite(rm.cx, 2.4 + sin(s.t * 2) * 0.2, rm.cz, 0.7, T.sigil, [0.4, 1, 1], s.t);
            }
            for (const [x, z] of [[rm.x0 + 0.3, rm.cz], [rm.x1 - 0.3, rm.cz]]) b.sprite(x, 2.6 + sin(s.t * 9 + x) * 0.05, z, 0.42, T.flare, [1, 0.6, 0.25], 0);
        });
        // a downed hero has a ring that fills as somebody picks them up
        for (const hv of heroes) {
            const h = hv.h;
            if (!h.down) continue;
            b.disc(hv.x, 0.06, hv.z, RUN.down.reach, T.ring, [1, 0.3, 0.3], s.t);
            b.disc(hv.x, 0.07, hv.z, RUN.down.reach * clamp(h.revive, 0, 1), T.glow, [0.2, 1, 0.4], 0);
            b.sprite(hv.x, 2.4 + sin(s.t * 4) * 0.2, hv.z, 0.35, T.star, [1, 0.3, 0.3], s.t);
        }
        // the shields people are wearing
        for (const hv of heroes) if (hv.h.shield > 0 && !hv.hidden) b.sprite(hv.x, hv.y + 1, hv.z, 1.2, T.halo, [0.45, 0.6, 1], s.t);
        // what flies: the host has the real ones, a guest its cosmetic ones and the enemy's
        if (g.isHost) {
            for (const p of s.proj) {
                const col = p.side === 1 ? (p.kind === 'bossorb' ? [1, 0.25, 0.55] : [1, 0.3, 0.2]) : p.kind === 'bolt' ? [0.25, 1, 0.45] : elCol(p.kind === 'missile' ? 'magicmissile' : p.kind);
                const sz = p.side === 1 ? (p.kind === 'bossorb' ? 0.55 : 0.42) : p.kind === 'bolt' ? 0.22 : 0.45;
                b.sprite(p.x, p.y, p.z, sz, T.glow, col, 0);
                b.streak(p.x, p.y, p.z, p.x - p.vx * 0.04, p.y, p.z - p.vz * 0.04, sz * 0.5, T.beam, col);
            }
        } else {
            for (const p of g.bolts) { const col = p.kind === 'bolt' ? [0.25, 1, 0.45] : elCol(p.kind); b.sprite(p.x, p.y, p.z, p.kind === 'bolt' ? 0.22 : 0.42, T.glow, col, 0); }
            for (const p of s.eproj || []) { const col = p.big ? [1, 0.25, 0.55] : [1, 0.3, 0.2]; b.sprite(p.x, p.y, p.z, p.big ? 0.55 : 0.42, T.glow, col, 0); }
        }
        // a healer's beam, a popup about to fire, a brute winding up
        for (const m of minions) if (m.m.act === 1 && m.kind === 'popup') b.sprite(m.x + sin(m.yaw) * 0.7, 1.1, m.z - cos(m.yaw) * 0.7, 0.35, T.glow, [1, 0.3, 0.2], 0);
        // beams, rings, sparks
        g.beams = g.beams.filter(q => {
            q.t -= dt;
            if (q.t <= 0) return false;
            const k = q.t / q.life;
            b.streak(q.x1, q.y1, q.z1, q.x2, q.y2, q.z2, q.w * k, T.beam, q.col);
            return true;
        });
        g.rings = g.rings.filter(q => {
            q.t -= dt;
            if (q.t <= 0) return false;
            const u = 1 - q.t / q.life;
            b.disc(q.x, q.y, q.z, q.r0 + (q.r1 - q.r0) * u, q.tile, q.col.map(c => c * (1 - u)), u * 2);
            return true;
        });
        g.fx = g.fx.filter(p => {
            p.t -= dt;
            if (p.t <= 0) return false;
            p.vy -= p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; }
            const k = p.t / p.life;
            b.sprite(p.x, p.y, p.z, p.size * (0.4 + k * 0.6), p.tile, p.col.map(c => c * k), p.rot += dt * 3);
            return true;
        });
    }

    // ===============================================================
    // the hud
    // ===============================================================
    const sigilCache = new Map();
    function sigilCanvas(id, size, color) {
        const key = id + size + color;
        if (sigilCache.has(key)) return sigilCache.get(key);
        const c = document.createElement('canvas');
        c.width = c.height = size;
        paintSigil(c, id, { color, width: max(3, size / 9) });
        sigilCache.set(key, c);
        return c;
    }
    function paintSigil(canvas, id, opts) {
        const sp = WZ && WZ.byId(id);
        const c = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        c.clearRect(0, 0, w, h);
        if (!sp) return;
        const pad = (opts && opts.pad) || 4, sz = min(w, h) - pad * 2;
        c.save();
        c.translate(pad + (w - pad * 2 - sz) / 2, pad + (h - pad * 2 - sz) / 2);
        c.scale(sz / 100, sz / 100);
        c.strokeStyle = (opts && opts.color) || '#fff';
        c.lineWidth = ((opts && opts.width) || 6) * 100 / sz;
        c.lineCap = 'round'; c.lineJoin = 'round';
        sp.glyph.forEach(st => { c.beginPath(); st.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke(); });
        c.restore();
    }
    const hex = c => '#' + c.map(v => ('0' + round(clamp(v, 0, 1) * 255).toString(16)).slice(-2)).join('');
    function text(c, s, x, y, col, size, align, shadow) {
        c.font = 'bold ' + (size || 11) + 'px "Courier New", monospace';
        c.textAlign = align || 'left';
        c.textBaseline = 'middle';
        if (shadow !== false) { c.fillStyle = '#000'; c.fillText(s, x + 1, y + 1); }
        c.fillStyle = col || '#fff';
        c.fillText(s, x, y);
    }
    function bar(c, x, y, w, h, frac, col, back) {
        c.fillStyle = back || '#1a0d2e'; c.fillRect(x, y, w, h);
        c.fillStyle = col; c.fillRect(x, y, w * clamp(frac, 0, 1), h);
        c.strokeStyle = '#000'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    function drawHud(g, dt, heroes, minions, boss) {
        const c = g.hctx, W = hudW(g), H = g.hudH, s = g.s, me = myHero(g);
        c.clearRect(0, 0, W, H);
        const small = W < 520;
        // ---- the party ----
        s.heroes.forEach((h, i) => {
            const y = 8 + i * 22, x = small ? 6 : 34;
            const col = h.out ? '#666' : h.down ? '#ff6b6b' : i === g.me ? '#ffe14d' : '#e8e2ff';
            text(c, (h.name || '').slice(0, 10) + ' ' + h.level + (g.seats[i] && g.seats[i].bot ? ' ·bot' : ''), x, y + 4, col, 9);
            bar(c, x, y + 10, 92, 5, h.hp / h.maxHp, h.down ? '#ff6b6b' : '#e4485f');
            if (h.shield > 0) bar(c, x, y + 10, 92 * min(1, h.shield / h.maxHp), 2, 1, '#9fc8ff', 'transparent');
            if (h.down) text(c, 'down ' + Math.ceil(h.bleed) + 's', x + 96, y + 12, '#ff6b6b', 8);
            if (h.out) text(c, 'out', x + 96, y + 12, '#888', 8);
        });
        // ---- where you are, or the boss ----
        const dun = s.dun;
        if (boss && s.boss) {
            const B = D.BOSSES[s.boss.kind];
            const bw = min(300, W * 0.5), bx = W / 2 - bw / 2;
            text(c, B.name, W / 2, 10, '#ff6b6b', 11, 'center');
            bar(c, bx, 17, bw, 9, s.boss.hp / s.boss.maxHp, '#e4485f');
            for (let p = 1; p < B.phases.length; p++) { c.fillStyle = '#fff'; c.fillRect(bx + bw * B.phases[p].at, 15, 1, 13); }
        } else {
            const fr = dun.rooms[s.frontier] || dun.rooms[0];
            const sec = fr.kind === 'boss' ? 'the boss' : 'section ' + (max(0, fr.section) + 1) + ' of ' + dun.def.rooms.length;
            text(c, dun.def.name + ' · ' + sec, W / 2, 10, '#c8bcea', 10, 'center');
            const alive = s.minions.filter(m => m.state === 1).length;
            if (alive) text(c, alive + ' awake', W / 2, 22, '#ff9a6b', 9, 'center');
        }
        text(c, 'continues ' + s.continues, W - 6, 10, s.continues ? '#c8bcea' : '#ff6b6b', 9, 'right');
        if (g.lastFps && !small) text(c, round(g.lastFps) + 'fps', W - 6, 22, '#666', 8, 'right');
        // ---- floating numbers ----
        g.floats = g.floats.filter(f => {
            f.t -= dt;
            if (f.t <= 0) return false;
            f.y += dt * 1.2;
            const p = g.R.project(f.x, f.y, f.z);
            if (!p) return true;
            c.globalAlpha = clamp(f.t * 1.5, 0, 1);
            text(c, f.text, p.x * W, p.y * H, f.color, 10, 'center');
            c.globalAlpha = 1;
            return true;
        });
        // ---- the hp of whatever is hurt, over its head ----
        for (const m of minions) {
            if (m.m.hp >= m.m.maxHp) continue;
            const p = g.R.project(m.x, (D.MINIONS[m.kind].h + 0.4) * m.scale, m.z);
            if (!p || p.d > 26) continue;
            bar(c, p.x * W - 12, p.y * H, 24, 3, m.m.hp / m.m.maxHp, m.elite ? '#ffcf3a' : '#e4485f');
        }
        // ---- the middle ----
        const cx = W / 2, cy = H * 0.5 - H * 0.04;
        if (!g.stance && !me.out) {
            c.fillStyle = g.hitMark > 0 ? '#ffe14d' : '#fff';
            c.fillRect(cx - 6, cy, 4, 1); c.fillRect(cx + 3, cy, 4, 1); c.fillRect(cx, cy - 6, 1, 4); c.fillRect(cx, cy + 3, 1, 4);
            g.hitMark = max(0, g.hitMark - dt);
        }
        if (g.vignette > 0) {
            g.vignette = max(0, g.vignette - dt * 1.5);
            c.fillStyle = 'rgba(200,0,0,' + (g.vignette * 0.25) + ')';
            c.fillRect(0, 0, W, H);
        }
        // ---- you ----
        const by = H - (g.touch ? 120 : 64);
        const slots = 4, sz = small ? 34 : 40, gap = 6, sx = W / 2 - (slots * sz + (slots - 1) * gap) / 2;
        for (let k = 0; k < slots; k++) {
            const x = sx + k * (sz + gap), y = by;
            const sk = me.skills[k];
            c.fillStyle = '#1a0d2ecc'; c.fillRect(x, y, sz, sz);
            c.strokeStyle = sk ? '#6a4aa0' : '#333'; c.strokeRect(x + 0.5, y + 0.5, sz - 1, sz - 1);
            if (sk) {
                const def = D.skillById(sk.id);
                const ready = sk.cd <= 0;
                c.globalAlpha = ready ? 1 : 0.45;
                c.drawImage(sigilCanvas(sk.id, sz, hex(EL[def.el] || [1, 1, 1])), x, y, sz, sz);
                c.globalAlpha = 1;
                if (!ready) {
                    const f = sk.cd / max(0.1, def.cd);
                    c.fillStyle = '#000a';
                    c.fillRect(x, y, sz, sz * clamp(f, 0, 1));
                    text(c, sk.cd.toFixed(sk.cd < 1 ? 1 : 0), x + sz / 2, y + sz / 2, '#fff', 11, 'center');
                }
                for (let r = 0; r < sk.rank; r++) { c.fillStyle = '#ffe14d'; c.fillRect(x + 3 + r * 5, y + sz - 5, 3, 3); }
            }
            if (!g.touch) text(c, String(k + 1), x + 3, y + 6, '#bcaddc', 8);
        }
        const hpw = slots * sz + (slots - 1) * gap;
        bar(c, sx, by + sz + 5, hpw, 7, me.hp / me.maxHp, '#e4485f');
        if (me.shield > 0) bar(c, sx, by + sz + 5, hpw * min(1, me.shield / me.maxHp), 3, 1, '#9fc8ff', 'transparent');
        text(c, round(me.hp) + '/' + me.maxHp, sx + hpw / 2, by + sz + 9, '#fff', 8, 'center');
        bar(c, sx, by + sz + 14, hpw, 3, me.xp / D.xpFor(me.level), '#ffe14d');
        text(c, 'lv ' + me.level, sx - 6, by + sz + 10, '#ffe14d', 10, 'right');
        if (me.picks > 0 && !g.cardsShown) text(c, me.picks + ' card' + (me.picks > 1 ? 's' : '') + ' for the next shrine', sx + hpw + 8, by + sz + 10, '#6fe8ff', 9);
        if (!g.touch && !small) text(c, 'E: draw a sigil instead', sx + hpw + 8, by + 8, '#7d6aa8', 8);
        // ---- the feed and the hint ----
        g.feed = g.feed.filter(f => (f.t -= dt) > 0);
        g.feed.forEach((f, k) => text(c, f.text, W - 6, 40 + k * 12, '#c8bcea', 9, 'right'));
        if (g.hintT > 0) {
            g.hintT -= dt;
            const col = g.hint.kind === 'bad' ? '#ff9a6b' : g.hint.kind === 'cast' ? '#0df259' : g.hint.kind === 'pick' ? '#6fe8ff' : '#e8e2ff';
            text(c, g.hint.text, W / 2, by - 12, col, 10, 'center');
        }
        if (g.bannerT > 0) {
            g.bannerT -= dt;
            c.globalAlpha = clamp(g.bannerT * 2, 0, 1);
            text(c, g.banner.text, W / 2, H * 0.3, g.banner.color, small ? 16 : 20, 'center');
            c.globalAlpha = 1;
        }
        // the entrance: your first card, then the others'
        if (s.shrine && s.shrine.room === 0 && !s.shrine.done) text(c, me.picks > 0 ? 'pick a skill to start: 1, 2 or 3' : 'waiting for the others to pick', W / 2, H * 0.22, '#6fe8ff', 12, 'center');
        // ---- downed friends you cannot see ----
        for (const hv of heroes) {
            if (!hv.h.down || hv.i === g.me) continue;
            const p = g.R.project(hv.x, 1, hv.z);
            if (p && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1) text(c, '+', p.x * W, p.y * H - 10, '#ff6b6b', 14, 'center');
            else {
                const a = angleDiff(atan2(hv.x - me.x, -(hv.z - me.z)), g.yaw);
                text(c, a < 0 ? '◀ ' + hv.h.name + ' down' : hv.h.name + ' down ▶', a < 0 ? 8 : W - 8, H * 0.5, '#ff6b6b', 10, a < 0 ? 'left' : 'right');
            }
        }
        // ---- the stance ----
        if (g.stance) drawStance(g, c, W, H);
    }
    function drawStance(g, c, W, H) {
        c.fillStyle = 'rgba(10,0,30,0.35)';
        c.fillRect(0, 0, W, H);
        const me = myHero(g);
        text(c, 'draw one of your sigils. right click or E to stop', W / 2, 40, '#c8bcea', 10, 'center');
        // what you can draw, small, up top
        const sz = 30;
        me.skills.forEach((k, i) => {
            const x = W / 2 - (me.skills.length * (sz + 34)) / 2 + i * (sz + 34);
            c.drawImage(sigilCanvas(k.id, sz, k.cd > 0 ? '#555555' : '#ffffff'), x, 50, sz, sz);
            text(c, D.skillById(k.id).name, x + sz / 2, 86, k.cd > 0 ? '#666' : '#e8e2ff', 8, 'center');
        });
        c.strokeStyle = '#0df259'; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
        for (const st of g.strokes) { c.beginPath(); st.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke(); }
        c.fillStyle = '#fff'; c.fillRect(g.pen.x - 1, g.pen.y - 1, 3, 3);
    }

    // ===============================================================
    // cards at the shrine, the menu, the end
    // ===============================================================
    function cardHtml(c) {
        if (c.t === 'pas') {
            const p = D.passiveById(c.id);
            return { title: p.name, sub: 'passive', blurb: p.blurb, sigil: null };
        }
        const sk = D.skillById(c.id);
        return { title: sk.name + (c.t === 'rank' ? ' +' : ''), sub: c.t === 'rank' ? 'rank up' : 'new skill · ' + sk.kind, blurb: sk.blurb, sigil: sk.id };
    }
    function paintCards(g, force) {
        const el = g.cardsEl;
        if (!el) return;
        const h = myHero(g), s = g.s;
        const atShrine = s.shrine && !s.shrine.done && s.shrine.healed;
        const show = atShrine && h.offer && h.picks > 0 && !g.ended;
        const key = show ? h.picks + ':' + h.offer.map(c => c.t + c.id).join(',') : '';
        if (!force && key === g.cardsKey) return;
        g.cardsKey = key;
        g.cardsShown = show ? h.offer : null;
        if (!show) { el.style.display = 'none'; el.innerHTML = ''; return; }
        el.style.display = '';
        el.innerHTML = `<div class="dz-cards-title">pick a card <span>${h.picks} to spend</span></div><div class="dz-cards-row">` +
            h.offer.map((c, k) => {
                const d = cardHtml(c);
                return `<button type="button" class="dz-card${c.t === 'pas' ? ' dz-card-pas' : ''}" data-card="${k}">
                    <span class="dz-card-key">${k + 1}</span>
                    ${d.sigil ? `<canvas width="44" height="44" data-sigil="${esc(d.sigil)}"></canvas>` : '<span class="dz-card-chip">+</span>'}
                    <span class="dz-card-name">${esc(d.title)}</span>
                    <span class="dz-card-sub">${esc(d.sub)}</span>
                    <span class="dz-card-blurb">${esc(d.blurb)}</span>
                </button>`;
            }).join('') + '</div>';
        el.querySelectorAll('canvas[data-sigil]').forEach(cv => { const sk = D.skillById(cv.dataset.sigil); paintSigil(cv, cv.dataset.sigil, { color: hex(EL[sk.el] || [1, 1, 1]), width: 5 }); });
        el.querySelectorAll('[data-card]').forEach(b => { b.onclick = e => { e.stopPropagation(); pickCard(g, +b.dataset.card); }; });
    }
    function hideOverlay(g) { const o = g && g.overlay; if (o) { o.style.display = 'none'; o.innerHTML = ''; } }
    function paintOverlay(g) {
        const o = g.overlay;
        if (!o || !g.R) return;
        if (g.ended) { renderEnd(g); return; }
        const panel = h => { o.style.display = ''; o.innerHTML = '<div class="wz-dialog">' + h + '</div>'; };
        const wire = () => o.querySelectorAll('[data-go]').forEach(b => {
            b.onclick = e => {
                e.stopPropagation();
                const go = b.dataset.go;
                if (go === 'help') openHelp();
                if (go === 'quit') { if (g.session && !g.solo && g.session.alive) g.session.leave(); openMenu(); }
                if (go === 'resume') { if (g.solo) pause(g, false); g.menuOpen = false; paintOverlay(g); if (!g.touchMode && !isLocked(g)) askLock(g); }
            };
        });
        const buttons = '<button class="wz-btn wz-wide" data-go="help">how to play</button><button class="wz-btn wz-wide" data-go="quit">leave the dungeon</button>';
        if (g.paused) { panel(`<div class="wz-dialog-title">paused</div><p>${g.pauseWhy === 'mouse' ? 'you let go of the mouse.' : 'take your time bradar.'}</p><button class="wz-btn wz-go wz-wide" data-go="resume">carry on</button>${buttons}`); wire(); return; }
        if (g.menuOpen) { panel(`<div class="wz-dialog-title">menu</div><p>this does not stop the run bradar.</p><button class="wz-btn wz-go wz-wide" data-go="resume">back to it</button>${buttons}`); wire(); return; }
        if (g.netDown) { panel(`<div class="wz-dialog-title">the line went quiet</div><p>the host vanished. if they come back this carries on from here.</p><button class="wz-btn wz-wide" data-go="quit">leave the dungeon</button>`); wire(); return; }
        if (!g.touchMode && !g.touch && !g.noLock && !isLocked(g) && !g.s.over) {
            o.style.display = '';
            o.innerHTML = '<button class="wz-clicktoplay" id="dz-click">click to take the mouse. esc lets go.</button>';
            o.querySelector('#dz-click').onclick = () => { askLock(g); focusGame(g); };
            return;
        }
        hideOverlay(g);
    }
    function endRun(g) {
        g.ended = true;
        clearStance(g);
        g.wantFire = false;
        freeMouse(g);
        const s = g.s, won = s.over === 'win';
        // what is kept between runs: trophies and times, never power
        const m = meta();
        m.runs++;
        m.wipes += s.stats ? s.stats.wipes : 0;
        if (won) {
            m.wins[s.dungeon] = (m.wins[s.dungeon] || 0) + 1;
            if (!m.best[s.dungeon] || s.t < m.best[s.dungeon]) m.best[s.dungeon] = round(s.t);
            SFX.win();
        }
        writeJson(LS.meta, m);
        paintCards(g, true);
        renderEnd(g);
    }
    const clock = sec => floor(sec / 60) + ':' + ('0' + floor(sec % 60)).slice(-2);
    function renderEnd(g) {
        const s = g.s, o = g.overlay;
        if (!o) return;
        const won = s.over === 'win';
        const me = myHero(g);
        const B = D.BOSSES[s.dun.def.boss];
        o.style.display = '';
        o.innerHTML = `<div class="wz-dialog wz-end">
            <div class="wz-dialog-title">${won ? 'DUNGEON CLEARED' : 'OUT OF CONTINUES'}</div>
            <p>${won ? esc(B.name) + ' is closed. the trophy is yours, and everybody\'s' : 'the dungeon wins this one bradar'}</p>
            <p>${esc(s.dun.def.name)} in ${clock(s.t)} · level ${me.level} · ${s.stats ? s.stats.kills : '?'} kills · ${s.stats ? s.stats.wipes : 0} wipes</p>
            ${g.theyWantAgain ? '<p>they want another one.</p>' : ''}
            ${g.isHost ? '<button class="wz-btn wz-go wz-wide" id="dz-again">again, new dungeon</button>' : `<button class="wz-btn wz-go wz-wide" id="dz-ask">${g.askedAgain ? 'waiting for the host...' : 'ask for another'}</button>`}
            <button class="wz-btn wz-wide" id="dz-quit">leave</button>
        </div>`;
        const again = o.querySelector('#dz-again');
        if (again) again.onclick = () => {
            const seed = floor(Math.random() * 1e9) + 1, run = s.run + 1;
            netSend(g, 'dz:new', { seed, dungeon: s.dungeon, run });
            startRun(g.session, Object.assign({}, g.opts, { seed, dungeon: s.dungeon, run }));
        };
        const ask = o.querySelector('#dz-ask');
        if (ask) ask.onclick = () => { g.askedAgain = true; netSend(g, 'dz:again', {}); renderEnd(g); };
        o.querySelector('#dz-quit').onclick = () => { if (g.session && !g.solo && g.session.alive) g.session.leave(); openMenu(); };
    }

    // ===============================================================
    // the window, and fitting 240 lines into it
    // ===============================================================
    const LINES = 240;
    function sideways() {
        const win = winRef && winRef.win;
        if (!win || typeof enterFauxFullscreen !== 'function') return;
        const land = window.innerWidth > window.innerHeight;
        const touchy = G ? G.touch : IS_TOUCH();
        const ours = typeof fauxFullscreenWin !== 'undefined' && fauxFullscreenWin === win;
        if (win._dzLand !== land) { win._dzLand = land; win._dzDeclined = false; }
        if (win._dzAutoFs && !win.classList.contains('fs-active')) { win._dzAutoFs = false; win._dzDeclined = true; }
        if (land && touchy && G && !win._dzDeclined && !win.classList.contains('fs-active') && !(typeof fullscreenWindow === 'function' && fullscreenWindow())) {
            enterFauxFullscreen(win); win._dzAutoFs = true; if (G) { G.fitAt = 0; G.stageW = 0; }
        } else if (!land && win._dzAutoFs && ours) {
            win._dzAutoFs = false; exitFauxFullscreen(); if (G) { G.fitAt = 0; G.stageW = 0; }
        }
    }
    function fit(g) {
        const now = performance.now();
        if (g.fitAt && now - g.fitAt < 200) return;
        g.fitAt = now;
        sideways();
        const body = root, stage = g.stage;
        const rect = body.getBoundingClientRect();
        const vh = document.documentElement.clientHeight || window.innerHeight || 700;
        const fs = winRef && winRef.win.classList.contains('fs-active');
        const cs = getComputedStyle(body);
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const w = max(120, body.clientWidth - padX);
        let h;
        if (fs) h = max(120, body.clientHeight - padY);
        else {
            const room = vh - max(0, rect.top) - 6;
            h = clamp(w * 9 / 16, 120, room);
            if (w < 520 && vh > w) h = clamp(w * 1.25, 120, room);
        }
        h = floor(h);
        if (g.stageW === w && g.stageH === h && g.hudW === wantHudW(g, w)) return;
        g.stageW = w; g.stageH = h;
        stage.style.width = w + 'px'; stage.style.height = h + 'px';
        const aspect = w / h;
        g.aspect = aspect;
        g.R.resize(aspect >= 1 ? round(LINES * aspect) : LINES, aspect >= 1 ? LINES : round(LINES / aspect));
        g.cv.style.width = w + 'px'; g.cv.style.height = h + 'px';
        g.hudW = wantHudW(g, w);
        g.hudH = round(g.hudW / aspect);
        g.hud.width = g.hudW; g.hud.height = g.hudH;
        g.hud.style.width = w + 'px'; g.hud.style.height = h + 'px';
    }
    function paintTouch(g) {
        const el = g && g.touchEl;
        if (!el) return;
        el.style.display = g.touch ? '' : 'none';
        if (g.touch !== g.padFor) { g.padFor = g.touch; g.stageW = 0; }
        const mb = g.stage && g.stage.querySelector('#dz-menubtn');
        if (mb) mb.style.display = g.touch ? 'none' : '';
        const ink = el.querySelector('#dz-t-ink');
        if (ink) { ink.classList.toggle('on', !!g.stance); ink.textContent = g.stance ? 'stop' : 'ink'; }
    }
    function renderKnob(g) {
        const k = g.knob;
        if (!k) return;
        if (g.stick.id === null) { k.style.display = 'none'; return; }
        const r = g.stage.getBoundingClientRect();
        k.style.display = '';
        k.style.left = (g.stick.ox - r.left) + 'px'; k.style.top = (g.stick.oy - r.top) + 'px';
        const n = k.firstElementChild;
        if (n) n.style.transform = 'translate(' + (g.stick.x * 36) + 'px,' + (g.stick.y * 36) + 'px)';
    }
    function ensureWindow() {
        ensureCss();
        if (winRef && document.getElementById(winRef.id)) return winRef;
        const vw = typeof viewportWidth === 'function' ? viewportWidth() : 1000;
        winRef = createAppWindow('dungeonz 98', { icon: 'bug_report', width: min(1000, vw - 20) });
        winRef.id = winRef.id || winRef.win.id;
        winRef.body.classList.add('wz-body', 'dz-body');
        if (document.documentElement.clientHeight < 500) winRef.win.style.top = '0px';
        else if (document.documentElement.clientHeight < 900) winRef.win.style.top = '44px';
        const turned = () => setTimeout(sideways, 150);
        window.addEventListener('resize', turned);
        window.addEventListener('orientationchange', turned);
        winRef.win._cleanup = () => {
            window.removeEventListener('resize', turned);
            window.removeEventListener('orientationchange', turned);
            tearDown();
            root = null; winRef = null;
        };
        root = winRef.body;
        return winRef;
    }
    function tearDown() {
        stopLoop();
        if (G) {
            if (G._unbind) G._unbind();
            if (G._netOffs) G._netOffs.forEach(off => off());
            if (G.session && !G.solo && G.session.alive) G.session.leave();
            if (G.R) G.R.dispose();
        }
        G = null;
    }
    function startRun(session, opts) {
        ensureWindow();
        stopLoop();
        const old = G;
        if (old) {
            if (old._unbind) old._unbind();
            if (old._netOffs) old._netOffs.forEach(off => off());
            if (old.session && old.session !== session && !old.solo && old.session.alive) old.session.leave();
            if (old.R) old.R.dispose();
        }
        G = makeGame(session, opts || {});
        const g = G;
        g.opts = opts || {};
        if (g.opts.run) g.s.run = g.opts.run;
        root.classList.add('wz-playing');
        root.innerHTML = `
            <div class="wz-stage dz-stage" id="dz-stage">
                <canvas id="dz-canvas" class="wz-canvas" tabindex="0" aria-label="The dungeon. W A S D walks, the mouse looks, click fires your staff, 1 to 4 cast your skills, E draws a sigil, space jumps, shift dashes."></canvas>
                <canvas id="dz-hud" class="wz-hud" aria-hidden="true"></canvas>
                <div id="dz-touch" class="wz-touch" style="display:none">
                    <button type="button" class="wz-t wz-t-fire" id="dz-t-fire" aria-label="fire">fire</button>
                    <button type="button" class="wz-t dz-t-skill" id="dz-t-s0" aria-label="skill 1">1</button>
                    <button type="button" class="wz-t dz-t-skill" id="dz-t-s1" aria-label="skill 2">2</button>
                    <button type="button" class="wz-t dz-t-skill" id="dz-t-s2" aria-label="skill 3">3</button>
                    <button type="button" class="wz-t dz-t-skill" id="dz-t-s3" aria-label="skill 4">4</button>
                    <button type="button" class="wz-t wz-t-jump" id="dz-t-jump" aria-label="jump">jump</button>
                    <button type="button" class="wz-t wz-t-dash" id="dz-t-dash" aria-label="dash">dash</button>
                    <button type="button" class="wz-t dz-t-ink" id="dz-t-ink" aria-label="draw a sigil">ink</button>
                    <button type="button" class="wz-t wz-t-menu" id="dz-t-menu" aria-label="menu">≡</button>
                    <div class="wz-knob" id="dz-knob" style="display:none"><span></span></div>
                </div>
                <div id="dz-cards" class="dz-cards" style="display:none"></div>
                <button type="button" class="wz-menubtn" id="dz-menubtn" title="menu (P or esc)">≡</button>
                <div id="dz-overlay" class="wz-overlay" style="display:none"></div>
            </div>`;
        g.stage = root.querySelector('#dz-stage');
        g.cv = root.querySelector('#dz-canvas');
        g.hud = root.querySelector('#dz-hud');
        g.hctx = g.hud.getContext('2d');
        g.overlay = root.querySelector('#dz-overlay');
        g.touchEl = root.querySelector('#dz-touch');
        g.knob = root.querySelector('#dz-knob');
        g.cardsEl = root.querySelector('#dz-cards');
        g.R = GL.create(g.cv);
        if (!g.R) {
            root.classList.remove('wz-playing');
            root.innerHTML = `<div class="wz-menu"><div class="wz-title">no 3d, bradar</div>
                <div class="wz-sub">this browser would not give dungeonz a webgl canvas. turn hardware acceleration back on, or try another browser.</div>
                <button class="wz-btn wz-wide" id="dz-nogl-back">back</button></div>`;
            root.querySelector('#dz-nogl-back').onclick = () => openMenu();
            if (session && !session.solo && session.alive) session.leave();
            G = null;
            return;
        }
        fit(g);
        bindInput(g);
        bindNet(g);
        bindTouchButtons(g);
        g.cv.addEventListener('webglcontextlost', e => e.preventDefault());
        g.cv.addEventListener('webglcontextrestored', () => { if (G === g) { g.R = GL.create(g.cv); g.fitAt = 0; g.stageW = 0; } });
        paintTouch(g);
        paintOverlay(g);
        paintCards(g, true);
        root.querySelector('#dz-menubtn').onclick = e => { e.stopPropagation(); if (g.solo) pause(g, !g.paused, 'menu'); else toggleMenu(g); };
        focusGame(g);
        lastT = performance.now();
        raf = requestAnimationFrame(loop);
        if (g.isHost && !g.solo) netSend(g, 'dz:s', S.snapshot(g.s, {}, g.humanSeats, true));
        // the shrine cards change on their own on the host, so a slow check keeps them right
        g.cardTimer = setInterval(() => { if (G !== g) { clearInterval(g.cardTimer); return; } paintCards(g); }, 250);
    }

    // ===============================================================
    // screens
    // ===============================================================
    function leaveRun() {
        tearDown();
        if (root) root.classList.remove('wz-playing');
    }
    function openMenu() {
        ensureWindow();
        leaveRun();
        const m = meta();
        const pick = chosenDungeon();
        root.innerHTML = `
            <div class="wz-menu">
                <div class="wz-title dz-title">dungeonz 98</div>
                <div class="wz-sub">four wizards, one dungeon, a lot of minions. level up, spend cards at the shrines, close the boss. bots take any seat nobody is in, bradar.</div>
                <div class="wz-menu-grid">
                    <div class="wz-menu-side">
                        <canvas id="dz-me" width="160" height="190"></canvas>
                        <div class="wz-me-name" id="dz-me-name"></div>
                        <div class="dz-meta">${m.runs} runs · ${Object.values(m.wins).reduce((a, b) => a + b, 0)} cleared</div>
                    </div>
                    <div class="wz-menu-main">
                        <div class="dz-dungeons" role="radiogroup" aria-label="dungeon">
                            ${D.DUNGEONS.map(d => `<button type="button" class="dz-dungeon${d.id === pick ? ' on' : ''}" data-dungeon="${d.id}" role="radio" aria-checked="${d.id === pick}">
                                <span class="dz-dungeon-name">${esc(d.name)}</span>
                                <span class="dz-tier dz-tier-${d.tier}">${d.tier}</span>
                                <span class="dz-dungeon-blurb">${esc(d.blurb)}</span>
                                <span class="dz-dungeon-best">${m.wins[d.id] ? '🏆 ' + m.wins[d.id] + ' · best ' + clock(m.best[d.id] || 0) : 'not cleared yet'}</span>
                            </button>`).join('')}
                        </div>
                        <button class="wz-btn wz-go wz-wide" id="dz-solo">play with bots</button>
                        <button class="wz-btn wz-go wz-wide" id="dz-mp">play with people — invite code</button>
                        <button class="wz-btn wz-wide" id="dz-help">how to play</button>
                        <div class="dz-set">
                            <label><input type="checkbox" id="dz-assist"> aim help for thumbs</label>
                            <label>mouse <input type="range" id="dz-sens" min="0.3" max="2.5" step="0.1"></label>
                        </div>
                    </div>
                </div>
            </div>`;
        const prof = window.Netplay ? Netplay.profile() : { name: 'you' };
        root.querySelector('#dz-me-name').textContent = prof.name;
        const meCv = root.querySelector('#dz-me');
        P.paintPortrait(meCv, myAvatar(), 1, { angle: 0.5, bg: [0.05, 0.03, 0.1] });
        root.querySelectorAll('[data-dungeon]').forEach(b => {
            b.onclick = () => {
                setPref(LS.dungeon, b.dataset.dungeon);
                root.querySelectorAll('[data-dungeon]').forEach(o => { o.classList.toggle('on', o === b); o.setAttribute('aria-checked', o === b); });
            };
        });
        const st = settings();
        const assist = root.querySelector('#dz-assist'), sens = root.querySelector('#dz-sens');
        assist.checked = st.assist; sens.value = st.sens;
        const save = () => writeJson(LS.settings, { assist: assist.checked, sens: +sens.value, invert: st.invert });
        assist.onchange = save; sens.onchange = save;
        root.querySelector('#dz-solo').onclick = () => startSolo();
        root.querySelector('#dz-help').onclick = () => openHelp();
        root.querySelector('#dz-mp').onclick = () => {
            if (window.Netplay) Netplay.openLobby({ gameId: 'dungeonz' });
            else if (typeof showToast === 'function') showToast('dungeonz', 'netplay is not loaded');
        };
    }
    function startSolo(extra) {
        const s = window.Netplay ? Netplay.soloSession('dungeonz') : { solo: true, players: [], on: () => () => { } };
        ensureWindow();
        startRun(s, Object.assign({ solo: true, dungeon: chosenDungeon() }, extra || {}));
    }
    function openHelp() {
        const g = G;
        if (g && g.solo) pause(g, true, 'menu');
        const w = createAppWindow('dungeonz: how to play', { icon: 'help', width: 440 });
        if (winRef && winRef.win.classList.contains('fs-active')) w.win.classList.add('wz-over-fs');
        w.body.classList.add('wz-body');
        w.body.innerHTML = `<div class="wz-help">
            <h3>a run</h3>
            <p>three sections of rooms, a shrine after each, then the boss. the gate out of a room opens when everything in it is dead. every kill gives everybody the xp, so nobody steals kills.</p>
            <h3>cards</h3>
            <p>a level is a card. cards are spent at shrines: a new skill (up to four), a rank on one you have, or a passive. a chest gives everyone one more. nothing carries over to the next run, apart from your trophies.</p>
            <h3>skills are sigils</h3>
            <p>press 1 to 4, or press E and draw the skill's wizardz sigil. a clean drawing hits up to half again as hard, but while you draw you are slow and you take more damage.</p>
            <h3>down, not dead</h3>
            <p>at no health you are down. stand next to somebody who is down and they get back up. nobody comes for 25 seconds and you are out until the room is clear. everybody down at once is a wipe: back to the last shrine, and it costs a continue.</p>
            <h3>bosses tell you first</h3>
            <p>red on the floor fills up before it hurts. a lane is a line it is about to fire down. a ring along the floor can be jumped.</p>
            <table class="wz-keys">
                <tr><td>WASD</td><td>walk</td></tr><tr><td>mouse</td><td>look, click fires the staff</td></tr>
                <tr><td>1-4</td><td>skills, or a card at a shrine</td></tr><tr><td>E</td><td>draw a sigil</td></tr>
                <tr><td>space</td><td>jump</td></tr><tr><td>shift</td><td>dash</td></tr><tr><td>P / esc</td><td>menu</td></tr>
            </table></div>`;
    }
    function paintAvatar(canvas, avatar) {
        if (!canvas || !canvas.getContext) return;
        if (!P.paintPortrait(canvas, normAvatar(avatar), performance.now() / 1000, { angle: 0.5, bg: [0.05, 0.03, 0.1] })) {
            const c = canvas.getContext('2d');
            c.fillStyle = (avatar && avatar.robeColor) || '#7b2ff7';
            c.fillRect(canvas.width * 0.3, canvas.height * 0.3, canvas.width * 0.4, canvas.height * 0.6);
        }
    }

    // ===============================================================
    // wiring
    // ===============================================================
    if (window.Netplay) {
        window.Netplay.registerGame({
            id: 'dungeonz', name: 'dungeonz 98',
            start: (session, opts) => startRun(session, opts),
            startSolo: () => startSolo(),
            soloLabel: 'play with bots',
            paintAvatar
        });
    }
    window.startDungeonz = function (mode, extra) {
        if (mode === 'solo') { startSolo(extra); return; }
        openMenu();
    };
    // for the console and the browser tests. state() hands out the live run
    window.DZ_ENGINE = { state: () => G, onSnapshot, hostInput, paintSigil, castSlot, pickCard, normAvatar, meta };
})();
