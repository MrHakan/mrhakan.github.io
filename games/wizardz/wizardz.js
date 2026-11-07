// ===================================================================
// WIZARDZ 98 — the game on the page
//
// A third person shooter in a window. You walk round a walled arena with a staff,
// and a sigil is how you load it: press E and the camera stops, you draw, and
// whatever you drew goes in the chamber for the left mouse button. Self spells go
// off at once. Between sigils the staff still fires a weak free shot that earns ink
// back when it lands.
//
//   wizardz-data.js    the numbers, the symbols, the bots
//   wizardz-sigil.js   reads a drawing
//   wizardz-sim.js     the rules, and the bots' brains. no page in it
//   wizardz-gl.js      the renderer, pretending to be 1995
//   this file          the window, the mouse, the wire, the hud
//
// Online the host owns the game. A guest sends what it is holding and what it just
// did, numbered, and keeps resending until a snapshot says it landed, because relays
// drop and reorder things. In between snapshots a guest runs the same step() from the
// last one, and moves itself at once and corrects afterwards.
// ===================================================================
(function () {
    'use strict';

    const D = window.WZ;
    const R = window.WZ_SIGIL;
    const S = window.WZ_SIM;
    const GL = window.WZ_GL;
    if (!D || !R || !S || !GL) { console.warn('[wizardz] a file is missing'); return; }
    const A = D.ARENA;
    const DT = S.DT;
    const { sin, cos, hypot, atan2, abs, min, max, floor, round, PI } = Math;
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

    const REC_FLOOR = R.CAST_FLOOR;

    // ===============================================================
    // who you are: same fourteen strings as before the rebuild, same keys
    // ===============================================================
    const BASE_AVATAR = {
        skin: D.AVATAR.skin[0], hat: 'pointy', hatColor: D.AVATAR.palette[0],
        hair: 'none', hairColor: D.AVATAR.palette[9], beard: 'long',
        robe: 'plain', robeColor: D.AVATAR.palette[0], trimColor: D.AVATAR.palette[4],
        staff: 'gnarled', familiar: 'none', aura: 'none', eyes: 'normal', title: 'apprentice'
    };
    // somebody who never opened the dressing room still needs a face, and it has to
    // be the same face on both screens, so it comes from their id
    function seededAvatar(seed) {
        let h = 2166136261;
        const s = String(seed || 'wizard');
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        const rnd = () => {
            h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13;
            return ((h >>> 0) % 100003) / 100003;
        };
        const pick = a => a[floor(rnd() * a.length) % a.length];
        return {
            skin: pick(D.AVATAR.skin), hat: pick(D.AVATAR.hat), hatColor: pick(D.AVATAR.palette),
            hair: pick(D.AVATAR.hair), hairColor: pick(D.AVATAR.palette), beard: pick(D.AVATAR.beard),
            robe: pick(D.AVATAR.robe), robeColor: pick(D.AVATAR.palette), trimColor: pick(D.AVATAR.palette),
            staff: pick(D.AVATAR.staff), familiar: pick(D.AVATAR.familiar), aura: pick(D.AVATAR.aura),
            eyes: pick(D.AVATAR.eyes), title: pick(D.AVATAR.titles)
        };
    }
    // anything out of an old save or off the wire goes through here first
    function normAvatar(av) {
        const a = Object.assign({}, BASE_AVATAR, av && typeof av === 'object' ? av : {});
        const clampTo = (v, list, def) => list.indexOf(v) >= 0 ? v : def;
        const colour = (v, def) => /^#[0-9a-f]{3,8}$/i.test(String(v)) ? v : def;
        a.hat = clampTo(a.hat, D.AVATAR.hat, 'pointy');
        a.hair = clampTo(a.hair, D.AVATAR.hair, 'none');
        a.beard = clampTo(a.beard, D.AVATAR.beard, 'none');
        a.robe = clampTo(a.robe, D.AVATAR.robe, 'plain');
        a.staff = clampTo(a.staff, D.AVATAR.staff, 'gnarled');
        a.familiar = clampTo(a.familiar, D.AVATAR.familiar, 'none');
        a.aura = clampTo(a.aura, D.AVATAR.aura, 'none');
        a.eyes = clampTo(a.eyes, D.AVATAR.eyes, 'normal');
        ['skin', 'hatColor', 'hairColor', 'robeColor', 'trimColor'].forEach(k => { a[k] = colour(a[k], BASE_AVATAR[k]); });
        return a;
    }

    const LS = {
        avatar: 'mrhakan98-wizardz-avatar',
        loadout: 'mrhakan98-wizardz-loadout',
        diff: 'mrhakan98-wizardz-difficulty',
        manual: 'mrhakan98-wizardz-manual-cast',
        settings: 'mrhakan98-wizardz-settings',
        mode: 'mrhakan98-wizardz-mode',
        map: 'mrhakan98-wizardz-map'
    };
    function preference(key, fallback) {
        try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
    }
    function savePreference(key, value) { try { localStorage.setItem(key, value); } catch (e) { } }
    function readJson(key) {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
    }
    function myAvatar() {
        const prof = window.Netplay ? Netplay.profile() : null;
        if (prof && prof.avatar) return normAvatar(prof.avatar);
        const a = readJson(LS.avatar) || D.randomAvatar();
        saveAvatar(a);
        return normAvatar(a);
    }
    function saveAvatar(a) {
        savePreference(LS.avatar, JSON.stringify(a));
        if (window.Netplay) Netplay.setAvatar(a);
    }
    function myLoadout() {
        const l = readJson(LS.loadout);
        if (D.loadoutProblem(l)) return D.DEFAULT_LOADOUT.slice();
        return l;
    }
    function saveLoadout(l) { savePreference(LS.loadout, JSON.stringify(l)); }
    // Against a bot it counts at once if the shooting has not started. Online the host has
    // already been told for this match, so it is the next one.
    function useLoadout(l) {
        saveLoadout(l);
        if (!G || !G.s) return true;
        const finished = G.s.over !== null && G.s.over !== undefined;
        if (G.solo && G.s.phase !== 'live' && !finished) { G.loadout = l.slice(); G.s.wiz[G.me].loadout = l.slice(); return true; }
        return finished;
    }
    const chosenMode = () => { const m = Number(preference(LS.mode, '1')); return A.modes.includes(m) ? m : 1; };
    const chosenMap = () => D.mapById(preference(LS.map, D.MAPS[0].id)).id;
    const difficulty = () => { const d = preference(LS.diff, 'normal'); return D.BOT_DIFFICULTY[d] ? d : 'normal'; };
    function settings() {
        const s = readJson(LS.settings);
        const out = { sens: 1, invert: false, assist: true };
        if (s && typeof s === 'object') {
            if (typeof s.sens === 'number' && s.sens >= 0.2 && s.sens <= 3) out.sens = s.sens;
            out.invert = !!s.invert;
            if (s.assist === false) out.assist = false;
        }
        return out;
    }

    // ===============================================================
    // sound: synthesised, follows the site's mute button
    // ===============================================================
    let actx = null;
    function audio() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!actx) actx = new AC();
        if (actx.state === 'suspended') actx.resume().catch(() => { });
        return actx;
    }
    const soundOn = () => typeof soundEnabled === 'undefined' ? true : soundEnabled;
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
            const peak = o.gain !== undefined ? o.gain : 0.05;
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(peak, t0 + min(0.012, dur / 3));
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
            const t0 = ctx.currentTime + (o.delay || 0);
            const n = max(1, floor(ctx.sampleRate * dur));
            const buf = ctx.createBuffer(1, n, ctx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
            const src = ctx.createBufferSource(); src.buffer = buf;
            const f = ctx.createBiquadFilter(); f.type = o.filter || 'lowpass';
            f.frequency.value = o.freq || 900;
            const g = ctx.createGain(); g.gain.value = o.gain === undefined ? 0.06 : o.gain;
            src.connect(f); f.connect(g); g.connect(ctx.destination);
            src.start(t0); src.stop(t0 + dur);
        } catch (e) { }
    }
    const SFX = {
        cast: el => tone(el === 'ice' ? 900 : 520, 0.14, { type: 'triangle', slideTo: 1200, gain: 0.045 }),
        zap: () => tone(1400, 0.07, { type: 'square', slideTo: 500, gain: 0.018 }),
        fire: () => { tone(660, 0.1, { type: 'sawtooth', slideTo: 180, gain: 0.03 }); noise(0.06, { freq: 2000, gain: 0.025 }); },
        fizzle: () => tone(220, 0.16, { type: 'sawtooth', slideTo: 90, gain: 0.035 }),
        hit: () => { noise(0.1, { freq: 1400, gain: 0.05 }); tone(180, 0.1, { type: 'square', slideTo: 70, gain: 0.04 }); },
        hurt: () => { noise(0.14, { freq: 700, gain: 0.07 }); tone(120, 0.18, { type: 'sawtooth', slideTo: 60, gain: 0.05 }); },
        boom: () => { noise(0.4, { freq: 500, gain: 0.1 }); tone(90, 0.3, { type: 'square', slideTo: 40, gain: 0.05 }); },
        ward: () => tone(700, 0.2, { type: 'sine', slideTo: 980, gain: 0.04 }),
        pick: () => { tone(660, 0.08, { type: 'square', gain: 0.03 }); tone(990, 0.1, { type: 'square', delay: 0.07, gain: 0.03 }); },
        ko: () => { tone(300, 0.5, { type: 'sawtooth', slideTo: 60, gain: 0.06 }); noise(0.4, { freq: 500 }); },
        win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, { type: 'square', delay: i * 0.11, gain: 0.05 })),
        tick: () => tone(880, 0.06, { type: 'square', gain: 0.03 })
    };

    // ===============================================================
    // the match on this machine
    // ===============================================================
    let G = null;
    let raf = null, lastT = 0;
    let root = null, winRef = null;
    const IS_TOUCH = () => {
        try { return !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); } catch (e) { return false; }
    };

    const randomBot = () => D.BOTS[floor(Math.random() * D.BOTS.length)];
    function seededRandom(seed) {
        let h = (seed >>> 0) || 1;
        return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
    }
    // Who sits where. Every screen works this out from the same seed and the same list, so
    // they agree without asking. Seat numbers go side a, side b, side a, so a seat's team
    // is its number mod 2. Whoever does not fit their side moves to the other one, and bots
    // fill what is left.
    function seatsFor(session, opts, solo, lead) {
        opts = opts || {};
        const o = opts.options || {};
        const rnd = seededRandom(opts.seed ^ 0x9e3779b9);
        const humans = solo
            ? [{ id: 'me', name: (window.Netplay ? Netplay.profile().name : 'you'), avatar: myAvatar(), loadout: myLoadout() }]
            : (opts.slots ? opts.slots.map(id => session.player(id)).filter(Boolean) : session.players.slice());
        let mode = Number(opts.mode || o.mode) || 1;
        mode = clamp(Math.max(mode, Math.ceil(humans.length / 2)), 1, 4);
        const sides = [[], []];
        humans.forEach((p, i) => {
            const want = opts.teams && (opts.teams[p.id] === 0 || opts.teams[p.id] === 1) ? opts.teams[p.id] : i % 2;
            const t = sides[want].length < mode ? want : 1 - want;
            sides[t].push(p);
        });
        // Everyone in the roster gets a turn before anybody plays twice. They bring their own
        // face and their own taste in spells, and borrow one pair of hands, or whichever side
        // drew the two hard bots would just win.
        const hands = lead ? lead.skill : D.botById('cinder').skill;
        const bag = D.BOTS.filter(b => b !== lead);
        let bagAt = 0;
        for (let i = bag.length - 1; i > 0; i--) { const j = floor(rnd() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
        const used = {};
        // The one you picked brings their own eight. The ones who just turned up to make the
        // numbers either do that too or bring one of the ready made ones.
        const presets = D.PRESETS.slice();
        for (let i = presets.length - 1; i > 0; i--) { const j = floor(rnd() * (i + 1)); [presets[i], presets[j]] = [presets[j], presets[i]]; }
        let presetAt = 0;
        const seat = (who, skill, filler) => {
            const book = filler && rnd() < 0.5 ? presets[presetAt++ % presets.length].sigils : (who.style.pool || D.DEFAULT_LOADOUT);
            used[who.id] = (used[who.id] || 0) + 1;
            return { id: 'bot-' + who.id + '-' + used[who.id], name: who.name + (used[who.id] > 1 ? ' ' + used[who.id] : ''), avatar: who.avatar, bot: true, def: Object.assign({}, who, { skill }), loadout: book.slice(0, D.LOADOUT_SIZE) };
        };
        if (lead) sides[1].unshift(seat(lead, lead.skill));
        [0, 1].forEach(t => { while (sides[t].length < mode) sides[t].push(seat(bag[bagAt++ % bag.length], hands, true)); });
        const seats = [];
        for (let i = 0; i < mode; i++) { seats.push(sides[0][i], sides[1][i]); }
        return { seats, mode };
    }

    function makeGame(session, opts) {
        opts = opts || {};
        const solo = !!opts.solo || !!(session && session.solo);
        const seed = opts.seed || floor(Math.random() * 1e9) + 1;
        const bot = solo ? (D.botById(opts.botId) || randomBot()) : null;
        const o = opts.options || {};
        const map = D.mapById(opts.map || o.map || (solo ? chosenMap() : D.MAPS[0].id)).id;
        const { seats, mode } = seatsFor(session, Object.assign({}, opts, { seed, mode: opts.mode || (solo ? chosenMode() : o.mode) }), solo, bot);
        const s = S.newMatch({
            seed, map,
            players: seats.map(p => ({
                id: p.id, name: p.name || 'wizard', bot: !!p.bot, loadout: p.loadout,
                avatar: normAvatar(p.avatar || seededAvatar(p.id))
            }))
        });
        const me = solo ? seats.findIndex(p => p.id === 'me') : seats.findIndex(p => p.id === session.id);
        const isHost = solo ? true : !!session.isHost;
        const n = seats.length;
        const g = {
            session, solo, bot, s, me, seed, seats, mode, map,
            myTeam: me % 2,
            isHost,
            brains: {},
            yaw: s.wiz[me].yaw, pitch: -0.02,
            keys: {}, wantFire: false, wantAim: false, touchAim: false, jumpQ: false, dashQ: false,
            stick: { x: 0, y: 0, id: null, ox: 0, oy: 0, cx: 0, cy: 0 }, lookId: null, lookX: 0, lookY: 0, fireId: null,
            stance: false, strokes: [], stroke: null, lastInk: 0, penUpAt: 0, penMovedAt: 0, pen: { x: 0, y: 0 }, penDown: false, guide: null,
            manualCast: preference(LS.manual, 'false') === 'true',
            loadout: myLoadout(), settings: settings(),
            acc: 0, snapAcc: 0, inputAcc: 0, netDown: 0, paused: false, pauseWhy: null,
            pending: [], seq: 0, ack: 0, inAck: 0, outbox: [], history: [], snapTick: -1,
            // on the host, what it has heard from each guest
            ears: {},
            fireClock: 0,
            fx: [], floats: [], beams: [], rings: [], feed: [],
            shake: 0, vignette: 0, hitMark: 0, errX: 0, errY: 0, errZ: 0,
            hint: null, hintT: 0, banner: null, bannerT: 0,
            camT: 1, fovNow: 1.15, walkA: new Array(n).fill(0), fall: new Array(n).fill(0), raise: new Array(n).fill(0), rv: new Array(n).fill(null), seen: new Array(n).fill(false), ended: false,
            frames: 0, frameMs: 0, frameMax: 0, lastFps: 0, fpsT: 0,
            speed: 1, trafficOut: 0, trafficIn: 0,
            // the names a test, or a console, wants to ask about
            get wiz() { return this.s.wiz; },
            get ents() { return this.s.ents; },
            get phase() { return this.s.phase; },
            get over() { return this.s.over; },
            get reason() { return this.s.reason; },
            get wins() { return this.s.score; },
            get brain() { return this.brains[seats.findIndex((p, i) => p.bot && i % 2 !== me % 2)] || null; },
            set brain(v) { if (!v) this.brains = {}; }
        };
        if (isHost) {
            seats.forEach((p, i) => { if (p.bot) g.brains[i] = S.newBrain(p.def, difficulty(), (seed ^ (0x5bd1e995 + i * 7919)) >>> 0, p.loadout); });
        }
        if (!solo) s.guessing = !isHost;
        s.guessMe = me;
        s.wiz[me].loadout = g.loadout.slice();
        return g;
    }
    function say(g, text, kind, t) {
        g.hint = { text, kind: kind || 'ok' };
        g.hintT = t || 1.8;
    }
    function banner(g, text, color, t) {
        g.banner = { text, color: color || '#ffe14d' };
        g.bannerT = t || 1.6;
    }

    // ---------------------------------------------------------------
    // commands: the only way anything changes
    // ---------------------------------------------------------------
    function denyText(why) {
        return ({
            ink: 'not enough ink', health: 'not enough health', cooling: 'still cooling down',
            inactive: 'wait for it', frozen: 'you cannot do that right now', dead: 'you are dead bradar', stance: 'you are drawing',
            notcarried: 'that is not one of your eight'
        })[why] || 'no';
    }
    function issue(g, c) {
        if (g.isHost) {
            const why = S.command(g.s, g.me, c);
            return why;
        }
        // a guest numbers it, and it goes with every input until a snapshot says it landed
        g.seq++;
        g.pending.push({ n: g.seq, c });
        return null;
    }
    function packCommand(p) {
        const c = p.c;
        if (c.c === 'cast') return [p.n, 0, S.SPELL_INDEX[c.s], round(c.q * 100) / 100];
        if (c.c === 'fire') return [p.n, 1, round(c.y * 100) / 100, round(c.p * 100) / 100];
        if (c.c === 'drop') return [p.n, 2];
        if (c.c === 'resign') return [p.n, 3];
        return [p.n, 9];
    }
    function unpackCommand(a) {
        if (!Array.isArray(a)) return null;
        switch (a[1]) {
            case 0: { const sp = D.SPELLS[a[2]]; return sp ? { c: 'cast', s: sp.id, q: a[3] } : null; }
            case 1: return { c: 'fire', y: a[2], p: a[3] };
            case 2: return { c: 'drop' };
            case 3: return { c: 'resign' };
        }
        return null;
    }

    // ===============================================================
    // the wire
    // ===============================================================
    const onRelays = g => !!(g.session && g.session.transport && g.session.transport.kind === 'bus');
    function netSend(g, type, data, to) {
        if (!g.session || g.solo || !g.session.alive) return;
        g.session.send(type, data, to);
    }
    const QUIET_EVENTS = { zap: 1, fire: 1, dash: 1, stance: 1, spawn: 1, go: 1 };
    function sendSnapshot(g, dt) {
        g.snapAcc += dt;
        // read every time: a direct link that dies moves to the relays mid-match. A
        // finished or frozen match only needs a slow heartbeat to say so.
        const finished = g.s.over !== null && g.s.over !== undefined;
        const hz = (finished || g.netDown) ? 1 : onRelays(g) ? A.relayHz : A.snapshotHz;
        if (g.snapAcc < 1 / hz) return;
        g.snapAcc = 0;
        if (finished) { g.overSent = (g.overSent || 0) + 1; if (g.overSent > 30) return; } else g.overSent = 0;
        const relays = onRelays(g);
        const ears = Object.keys(g.ears);
        const extra = {};
        if (ears.length) extra.a = ears.map(i => [+i, g.ears[i].seenTo, g.ears[i].inSeq]);
        if (g.netDown) extra.d = 1;
        if (g.outbox.length) {
            // over the relays, only what somebody would miss. A spark nobody saw is no loss
            const keep = relays ? g.outbox.filter(e => !QUIET_EVENTS[e[0]]) : g.outbox;
            if (keep.length) extra.ev = keep.slice(relays ? -10 : -24);
            g.outbox = [];
        }
        netSend(g, 'wz:s', S.snapshot(g.s, extra, g.humanSeats));
    }
    function onSnapshot(g, d) {
        if (!d || !Array.isArray(d.w)) return;
        const s = g.s;
        // relays reorder. An old snapshot is not news, unless it is a new match
        if (d.m < s.match || (d.m === s.match && d.k <= g.snapTick)) return;
        if (d.m > s.match) {
            g.seq = 0; g.ack = 0; g.inAck = 0; g.pending = []; g.history = []; g.ended = false; g.wantRematch = false;
            g.fx = []; g.floats = []; g.beams = []; g.rings = [];
            g.loadout = myLoadout();
            s.wiz[g.me].loadout = g.loadout.slice();
            g.loadoutHeard = false;
            clearStance(g);
            s.match = d.m;
            g.freshMatch = true;
        }
        const me = s.wiz[g.me];
        const bx = me.x, by = me.y, bz = me.z;
        const ownVy = me.vy, ownGrounded = me.grounded;
        if (!S.applySnapshot(s, d)) return;
        g.snapTick = d.k;
        g.lastSnap = performance.now();
        const mine = Array.isArray(d.a) ? d.a.find(x => Array.isArray(x) && x[0] === g.me) : null;
        if (mine && mine[1] > g.ack) {
            g.ack = mine[1];
            g.pending = g.pending.filter(c => c.n > g.ack);
        }
        if (Array.isArray(d.ev)) d.ev.forEach(ev => s.ev.push(ev));
        // own seat: what the host says, then the inputs it has not seen yet, again
        me.yaw = g.yaw; me.pitch = g.pitch;
        if (!me.dead) {
            const seenInput = mine ? mine[2] : 0;
            g.history = g.history.filter(h => h.q >= seenInput);
            if (g.history.length) { me.vy = ownVy; me.grounded = ownGrounded; }
            for (const h of g.history) S.moveWizard(s, me, h.inp);
            const ex = bx - me.x, ey = by - me.y, ez = bz - me.z;
            // close enough to ease over. Further than that and something shoved you
            if (hypot(ex, ez) < 5) { g.errX += ex; g.errY += ey; g.errZ += ez; }
            else { g.errX = g.errY = g.errZ = 0; }
        } else { g.errX = g.errY = g.errZ = 0; g.history = []; }
        if (d.d && performance.now() - (g.helloAt || 0) > 2000) {
            g.helloAt = performance.now();
            if (g.session.alive) g.session.announceProfile();
        }
        if (g.netDown && !d.d) comeBack(g);
        s.guessing = true;
        // only now, because this repaints off the phase that just arrived
        if (g.freshMatch) { g.freshMatch = false; paintOverlay(g); focusGame(g); }
    }
    function hostInput(g, d, from) {
        if (!d || typeof d !== 'object') return;
        const i = g.s.wiz.findIndex(w => w.id === (from && from.id));
        if (i < 0 || i === g.me || g.seats[i].bot) return;
        if (g.netDown) comeBack(g);
        if (g.brains[i]) seatBack(g, i);
        if (typeof d.m === 'number' && d.m !== g.s.match) return;
        const ear = g.ears[i] || (g.ears[i] = { inSeq: 0, seen: new Set(), seenTo: 0 });
        if (d.l !== undefined) hearLoadout(g, i, ear, d.l, from);
        if (typeof d.q === 'number' && d.q > ear.inSeq) {
            ear.inSeq = d.q;
            const fl = d.f | 0;
            S.setInput(g.s, i, { mx: (d.x | 0) / 100, mz: (d.z | 0) / 100, yaw: d.y, pitch: d.p, aim: !!(fl & 1), ink: !!(fl & 2), jump: !!(fl & 4), dash: !!(fl & 8) });
        }
        if (Array.isArray(d.c)) {
            for (const a of d.c.slice(0, 32)) {
                if (!Array.isArray(a) || typeof a[0] !== 'number') continue;
                const n = a[0];
                // the same command twice, because an ack got lost, is still one command
                if (n <= ear.seenTo || ear.seen.has(n)) continue;
                ear.seen.add(n);
                while (ear.seen.has(ear.seenTo + 1)) { ear.seenTo++; ear.seen.delete(ear.seenTo); }
                const cmd = unpackCommand(a);
                if (!cmd) continue;
                // the guest's recogniser only reads their eight, but nobody has to use it
                const why = cmd.c === 'cast' && !g.s.wiz[i].loadout.includes(cmd.s) ? 'notcarried' : S.command(g.s, i, cmd);
                if (why && cmd.c === 'cast') netSend(g, 'wz:deny', { why, s: cmd.s }, from.id);
            }
        }
    }
    // A guest says which eight they brought, as an id, with every input until the host answers.
    // The first thing a seat says in a match is what it gets: no swapping once you have seen
    // what they are carrying. Anything that does not read leaves them the standard eight, and
    // they get told why.
    function hearLoadout(g, i, ear, text, from) {
        if (ear.loadout === undefined) {
            const r = D.loadoutFromId(text);
            ear.loadout = r.ok ? r.id : null;
            ear.loadoutWhy = r.ok ? '' : r.why;
            if (r.ok) g.s.wiz[i].loadout = r.list;
            else g.s.wiz[i].loadout = D.DEFAULT_LOADOUT.slice();
        }
        const now = performance.now();
        if (now - (ear.loadoutAt || -1e9) < 400) return;
        ear.loadoutAt = now;
        netSend(g, 'wz:lo', { m: g.s.match, id: D.loadoutToId(g.s.wiz[i].loadout), why: ear.loadoutWhy || undefined }, from.id);
    }
    function heardLoadout(g, d) {
        if (!d || d.m !== g.s.match || g.loadoutHeard) return;
        g.loadoutHeard = true;
        const r = D.loadoutFromId(d.id);
        if (r.ok) { g.loadout = r.list; g.s.wiz[g.me].loadout = r.list.slice(); }
        if (d.why) say(g, 'the host would not take your eight: ' + (D.LOADOUT_WHY[d.why] || 'no reason given') + '. you have the standard ones', 'bad', 4);
    }
    function sendInput(g, dt) {
        g.inputAcc += dt;
        const hz = onRelays(g) ? A.relayHz : A.snapshotHz;
        if (g.inputAcc < 1 / hz) return;
        g.inputAcc = 0;
        const inp = g.s.input[g.me];
        const f = (inp.aim ? 1 : 0) | (inp.ink ? 2 : 0) | (g.jumpSent ? 4 : 0) | (g.dashSent ? 8 : 0);
        g.jumpSent = false; g.dashSent = false;
        const msg = { q: ++g.inAck, m: g.s.match, x: round(inp.mx * 100), z: round(inp.mz * 100), y: round(g.yaw * 100) / 100, p: round(g.pitch * 100) / 100, f };
        if (g.pending.length) msg.c = g.pending.slice(0, 12).map(packCommand);
        if (!g.loadoutHeard) msg.l = D.loadoutToId(g.loadout);
        if (g.session && g.session.alive) g.session.sendToHost('wz:i', msg);
    }
    function freeMouse(g) { if (isLocked(g) && document.exitPointerLock) { g.hadLock = false; document.exitPointerLock(); } }
    // A person gone from a seat. In a team game a bot sits down at once and it carries on.
    // In a 1v1 there is nobody left to play, so it waits a bit to see if they come back.
    const VACANT_MS = 10000;
    function seatLeft(g, id) {
        const i = g.s.wiz.findIndex(w => w.id === id);
        if (i < 0 || i === g.me || g.brains[i]) return;
        if (g.s.over !== null && g.s.over !== undefined) return;
        if (g.mode === 1) { g.vacant = i; goneAway(g); return; }
        putBotIn(g, i);
    }
    function putBotIn(g, i) {
        const def = D.BOTS[(i * 3 + g.seed) % D.BOTS.length];
        g.brains[i] = S.newBrain(def, 'normal', (g.seed + i * 104729) >>> 0, g.s.wiz[i].loadout);
        g.s.ev.push(['sub', i, 1]);
    }
    function seatBack(g, i) {
        delete g.brains[i];
        g.s.ev.push(['sub', i, 0]);
    }
    function goneAway(g) {
        if (g.s.over !== null && g.s.over !== undefined) return;
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
            offs.push(s.on('wz:i', (d, from) => hostInput(g, d, from)));
            offs.push(s.on('wz:rematch', () => { g.theyWantRematch = true; if (g.ended) paintOverlay(g); }));
            offs.push(s.on('player-join', p => {
                const i = g.s.wiz.findIndex(w => w.id === p.id);
                if (i < 0) return;
                comeBack(g);
                if (g.brains[i] && !g.seats[i].bot) seatBack(g, i);
            }));
            offs.push(s.on('player-leave', p => seatLeft(g, p.id)));
        } else {
            offs.push(s.on('wz:s', d => onSnapshot(g, d)));
            offs.push(s.on('wz:lo', d => heardLoadout(g, d)));
            offs.push(s.on('wz:deny', d => {
                if (!d) return;
                const sp = D.byId(d.s);
                say(g, (sp ? sp.name + ': ' : '') + denyText(d.why), 'bad', 1.4);
                SFX.fizzle();
            }));
        }
        // a host going is the end of it: the game was on their machine. Guests are told
        if (!g.isHost) offs.push(s.on('player-leave', p => { if (p.host) goneAway(g); }));
        offs.push(s.on('net:down', () => goneAway(g)));
        offs.push(s.on('closed', () => goneAway(g)));
        offs.push(s.on('net:up', () => {
            comeBack(g);
            if (!g.isHost && s.alive) s.announceProfile();
        }));
        g._netOffs = offs;
    }
    function restartMatch(g) {
        const s = g.s;
        const next = S.newMatch({
            seed: (g.seed = (g.seed * 31 + 17) >>> 0), match: s.match + 1, map: s.map,
            players: s.wiz.map(w => ({ id: w.id, name: w.name, bot: w.bot, avatar: w.avatar, loadout: w.loadout }))
        });
        next.guessing = !g.isHost;
        next.guessMe = g.me;
        g.s = next;
        g.yaw = next.wiz[g.me].yaw; g.pitch = -0.02;
        g.ended = false; g.theyWantRematch = false; g.wantRematch = false;
        g.loadout = myLoadout();
        next.wiz[g.me].loadout = g.loadout.slice();
        g.ears = {}; g.outbox = [];
        g.acc = 0;
        g.fx = []; g.floats = []; g.beams = []; g.rings = []; g.feed = [];
        // a seat somebody walked out of stays a bot until they come back
        const oldBrains = g.brains;
        g.brains = {};
        Object.keys(oldBrains).forEach(i => { g.brains[i] = S.newBrain(oldBrains[i].def, difficulty(), (g.seed ^ (0x5bd1e995 + i * 7919)) >>> 0, next.wiz[i].loadout); });
        clearStance(g);
        paintOverlay(g);
        focusGame(g);
        if (g.isHost) netSend(g, 'wz:s', S.snapshot(next, {}, g.humanSeats, true));
    }

    // ===============================================================
    // the mouse, the keys, and the thumbs
    // ===============================================================
    const INK_PAUSE = 480;      // ms of the pen off the paper that ends a sigil
    const INK_PAUSE_MAX = 1050; // and how long it waits for a pen that is on its way somewhere
    const HUD_W = 640;
    // The hud is drawn on a canvas this many units across, stretched over the arena. On
    // a phone held upright that stretch was 0.6: seven pixel writing for hp, ink and the
    // spell you have loaded. Narrow touch screens get a narrower canvas, so it is drawn
    // nearer its real size. Everything that reads the pen goes through this as well.
    const hudW = g => g.hudW || HUD_W;
    function wantHudW(g, w) { return g.touch && w < 560 ? clamp(round(w / 0.85), 440, HUD_W) : HUD_W; }
    function clearInk(g) { g.strokes = []; g.stroke = null; g.penDown = false; }
    function enterStance(g) {
        const me = g.s.wiz[g.me];
        if (g.stance || g.paused || g.s.phase !== 'live' || me.dead || !S.canAct(me)) return;
        g.stance = true;
        clearInk(g);
        g.wantFire = false;
        g.pen.x = hudW(g) / 2; g.pen.y = g.hudH ? g.hudH / 2 : 180;
        SFX.tick();
        paintTouch(g);
    }
    function clearStance(g) {
        g.stance = false;
        clearInk(g);
        g.lookId = null;
        paintTouch(g);
    }
    function toggleStance(g) { if (g.stance) clearStance(g); else enterStance(g); }

    function strokePoint(g, x, y) {
        g.pen.x = clamp(x, 0, hudW(g)); g.pen.y = clamp(y, 0, g.hudH || 360);
        g.penMovedAt = performance.now();
        if (!g.stroke) return;
        const last = g.stroke[g.stroke.length - 1];
        if (hypot(g.pen.x - last.x, g.pen.y - last.y) > 1.2) {
            g.stroke.push({ x: g.pen.x, y: g.pen.y });
            g.lastInk = performance.now();
        }
    }
    function penDown(g) {
        if (!g.stance || g.penDown) return;
        g.penDown = true;
        g.stroke = [{ x: g.pen.x, y: g.pen.y }];
        g.strokes.push(g.stroke);
        g.lastInk = performance.now();
    }
    function penUp(g) {
        if (!g.penDown) return;
        g.penDown = false;
        // a tap is not a stroke
        if (g.stroke && g.stroke.length < 2) g.strokes.pop();
        g.stroke = null;
        g.penUpAt = performance.now();
        g.lastInk = performance.now();
    }

    // when the drawing is done, did it mean anything?
    function maybeRead(g, force) {
        if (!g.stance || !g.strokes.length || g.stroke) return;
        const now = performance.now();
        if (!force) {
            if (g.manualCast) return;
            const quiet = now - g.penUpAt;
            if (quiet < INK_PAUSE) return;
            // on its way to the next stroke: give it a moment
            if (now - g.penMovedAt < 140 && quiet < INK_PAUSE_MAX) return;
        }
        const strokes = g.strokes;
        clearInk(g);
        // too small to have been on purpose
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        strokes.forEach(st => st.forEach(p => { x0 = min(x0, p.x); y0 = min(y0, p.y); x1 = max(x1, p.x); y1 = max(y1, p.y); }));
        if (max(x1 - x0, y1 - y0) < 14) { say(g, 'draw it bigger bradar', 'bad', 1.2); return; }
        const res = R.decide(strokes, g.loadout);
        g.lastRead = res;
        if (!res.ok) {
            const name = sp => (sp ? sp.name : '');
            let text = 'fizzled';
            if (res.why === 'split') text = 'fizzled: half ' + name(res.spell) + ', half ' + name(res.spell2);
            else if (res.why === 'book') text = name(res.spell) + ' is not in your book';
            else if (res.why === 'rough') text = 'fizzled: that nearly looked like ' + name(res.spell);
            say(g, text, 'bad', 1.8);
            SFX.fizzle();
            return;
        }
        // on a guest this can only be a guess, the host has the last word
        if (g.isHost) {
            const why = S.canInscribe(g.s, g.me, res.spell);
            if (why) { say(g, res.spell.name + ': ' + denyText(why), 'bad', 1.4); SFX.fizzle(); return; }
        }
        issue(g, { c: 'cast', s: res.id, q: res.q });
        if (!g.isHost) SFX.cast(res.spell.el);
        say(g, res.spell.name + (res.q > 0.8 ? ': clean!' : ''), 'cast', 1.3);
        clearStance(g);
    }

    // A browser hands over at most one move a frame and merges the rest. At 60fps that
    // is fine. On a slow machine a triangle arrives as three points with the corners cut
    // off, and fizzles, so a pen has to ask for everything that happened since last time.
    function everyMove(ev) {
        const list = ev.getCoalescedEvents ? ev.getCoalescedEvents() : null;
        return list && list.length && list.length < 64 ? list : [ev];
    }
    // Chrome has been known to report a locked mouse teleporting hundreds of pixels in one
    // event, usually straight back to where it was. A hand does not do that in 1/60 of a
    // second, and believing it throws your aim at the sky.
    const MOUSE_SPIKE = 500;
    function canvasRect(g) { return g.cv.getBoundingClientRect(); }
    function toHud(g, clientX, clientY) {
        const r = canvasRect(g);
        return { x: (clientX - r.left) / r.width * hudW(g), y: (clientY - r.top) / r.height * g.hudH };
    }
    function focusGame(g) { if (g.cv && g.cv.focus) g.cv.focus({ preventScroll: true }); }

    function look(g, dx, dy) {
        // over somebody, a thumb slows down a little, so it stays on them
        const k = 0.0026 * g.settings.sens * (g.wantAim || g.touchAim ? 0.6 : 1) * (g.assist && g.lookId !== null ? ASSIST.slow : 1);
        g.yaw += dx * k;
        g.pitch = clamp(g.pitch - dy * k * (g.settings.invert ? -1 : 1), -1.2, 1.2);
    }
    // whether this browser has ever handed over the mouse: a fact about the browser,
    // so it outlives the match it was learned in
    let lockEverGiven = false;
    function isLocked(g) { return !!document.pointerLockElement && document.pointerLockElement === g.cv; }
    function askLock(g) {
        if (g.noLock || !g.cv.requestPointerLock) { g.noLock = true; return; }
        try {
            const p = g.cv.requestPointerLock();
            if (p && p.catch) p.catch(() => lockRefused(g));
        } catch (e) { lockRefused(g); }
    }
    // A browser that has never given the mouse is one that will not: from then on
    // you hold a button and drag. One that has given it already is only saying
    // "not yet". Chrome refuses for about a second after esc lets go, which is
    // exactly when a player clicks carry on, and treating that as "never" left the
    // rest of the match with no aim and a pen that would not follow the mouse.
    // So it stays the locked game, and the click to take the mouse asks again.
    function lockRefused(g) {
        if (isLocked(g)) return;
        if (!lockEverGiven) g.noLock = true;
        paintOverlay(g);
    }

    // A second button pressed while one is already down is not a pointerdown, because the
    // pointer is already down: it is a pointermove whose button says which one changed, and
    // letting go of one of two is a pointermove too. So holding the right button to aim
    // and pressing the left fired nothing.
    const BUTTON_BIT = [1, 4, 2, 8, 16];
    function chorded(ev, down, up) {
        if (ev.type !== 'pointermove' || !(ev.button >= 0) || ev.button > 4) return;
        if (ev.buttons & BUTTON_BIT[ev.button]) down(ev); else up(ev);
    }
    function bindInput(g) {
        const cv = g.cv, stage = g.stage;
        const touch = g.touch = IS_TOUCH();
        // ---- the mouse ----
        const isFinger = ev => ev.pointerType === 'touch' || ev.pointerType === 'pen';
        const down = ev => {
            if (isFinger(ev)) return;
            if (g.touchMode) { g.touchMode = false; g.touch = IS_TOUCH(); paintTouch(g); }
            if (g.paused || g.ended) return;
            ev.preventDefault();
            focusGame(g);
            if (!isLocked(g) && !g.noLock) {
                // the first click only takes the mouse
                askLock(g);
                g.mouseX = ev.clientX; g.mouseY = ev.clientY;
                if (!g.stance) return;
            }
            if (g.noLock) { g.mouseX = ev.clientX; g.mouseY = ev.clientY; g.dragging = true; }
            if (ev.button === 2) {
                if (g.stance) clearStance(g);
                else g.wantAim = true;
                return;
            }
            if (ev.button !== 0) return;
            if (g.stance) {
                if (g.noLock || !isLocked(g)) { const h = toHud(g, ev.clientX, ev.clientY); g.pen.x = h.x; g.pen.y = h.y; }
                penDown(g);
            } else { g.wantFire = true; g.fireQ = true; }
        };
        const move = ev => {
            if (isFinger(ev)) return;
            chorded(ev, down, up);
            if (g.paused) return;
            if (isLocked(g)) {
                const mx = ev.movementX || 0, my = ev.movementY || 0;
                if (abs(mx) > MOUSE_SPIKE || abs(my) > MOUSE_SPIKE) return;
                if (g.stance) {
                    const r = canvasRect(g);
                    // the pen moves as far on the screen as the mouse did
                    const parts = everyMove(ev);
                    let sx = 0, sy = 0;
                    for (const e of parts) { sx += e.movementX || 0; sy += e.movementY || 0; }
                    // some browsers leave these empty, and then the total is all there is
                    const trust = abs(sx - mx) <= 2 && abs(sy - my) <= 2 ? parts : [ev];
                    for (const e of trust) strokePoint(g, g.pen.x + (e.movementX || 0) / r.width * hudW(g), g.pen.y + (e.movementY || 0) / r.height * g.hudH);
                } else look(g, mx, my);
                return;
            }
            if (g.stance) {
                for (const e of everyMove(ev)) {
                    const h = toHud(g, e.clientX, e.clientY);
                    strokePoint(g, h.x, h.y);
                }
                return;
            }
            // no pointer lock on this browser: hold a button and drag to look
            if (g.noLock && g.dragging) {
                look(g, ev.clientX - (g.mouseX || ev.clientX), ev.clientY - (g.mouseY || ev.clientY));
                g.mouseX = ev.clientX; g.mouseY = ev.clientY;
            }
        };
        const up = ev => {
            if (isFinger(ev)) return;
            if (ev.button === 2) g.wantAim = false;
            if (ev.button === 0 || ev.buttons === 0) {
                g.wantFire = false;
                penUp(g);
                g.dragging = false;
            }
        };
        const noMenu = e => { e.preventDefault(); e.stopPropagation(); };
        cv.addEventListener('pointerdown', down);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        // the right button aims in here: neither the browser nor the desktop gets a say
        stage.addEventListener('contextmenu', noMenu);
        const lockChange = () => {
            if (isLocked(g)) { g.hadLock = true; lockEverGiven = true; paintOverlay(g); return; }
            // esc, or the browser taking it back
            g.lockLostAt = performance.now();
            g.wantFire = false; g.wantAim = false; penUp(g);
            if (g.hadLock && !g.ended) {
                g.hadLock = false;
                if (g.solo) pause(g, true, 'mouse');
                paintOverlay(g);
            }
        };
        const lockError = () => lockRefused(g);
        document.addEventListener('pointerlockchange', lockChange);
        document.addEventListener('pointerlockerror', lockError);

        // ---- the keys ----
        const typing = e => /^(input|textarea|select)$/i.test((e.target || {}).tagName || '') || (e.target && e.target.isContentEditable);
        const focused = () => root && (root.contains(document.activeElement) || isLocked(g));
        const keyDown = e => {
            if (typing(e) || !focused() || e.ctrlKey || e.metaKey || e.altKey) return;
            const k = e.key.toLowerCase();
            if (k === 'escape') {
                // the desktop would close the window: here it opens the menu
                e.stopPropagation();
                e.preventDefault();
                // the same press that let go of the mouse: that was all it was for, and
                // taking the pause straight back off would ask for the mouse too soon
                if (performance.now() - (g.lockLostAt || -1e9) < 300) return;
                if (!g.ended) { if (g.paused) pause(g, false); else if (g.solo) pause(g, true, 'menu'); else toggleMenu(g); }
                return;
            }
            if (k === 'p' && !e.repeat) { if (g.solo) pause(g, !g.paused, 'menu'); else toggleMenu(g); return; }
            if (g.paused) return;
            if (e.target && e.target.tagName === 'BUTTON' && (k === ' ' || k === 'enter')) return;
            if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'enter', 'shift'].includes(k)) e.preventDefault();
            if ((k === 'e' || k === 'q' || k === 'r') && !e.repeat) { toggleStance(g); return; }
            if (k === 'enter' && !e.repeat) { maybeRead(g, true); return; }
            if (/^[1-8]$/.test(k) && !e.repeat) { pickGuide(g, g.loadout[Number(k) - 1]); return; }
            if (k === ' ') {
                if (g.stance) { clearInk(g); return; }
                if (!e.repeat) g.jumpQ = true;
            }
            if (k === 'shift' && !e.repeat) g.dashQ = true;
            g.keys[k] = true;
        };
        const keyUp = e => { delete g.keys[e.key.toLowerCase()]; };
        const blur = () => { g.keys = {}; g.wantFire = false; g.wantAim = false; penUp(g); if (g.solo && !g.ended) pause(g, true, 'focus'); };
        const hidden = () => { if (document.hidden) blur(); };
        window.addEventListener('keydown', keyDown, true);
        window.addEventListener('keyup', keyUp);
        window.addEventListener('blur', blur);
        document.addEventListener('visibilitychange', hidden);

        // ---- thumbs ----
        const touches = new Map();
        const tDown = ev => {
            if (!isFinger(ev)) return;
            ev.preventDefault();
            g.touchMode = true;
            g.touch = true;
            paintTouch(g);
            if (g.paused || g.ended) return;
            const r = stage.getBoundingClientRect();
            const px = ev.clientX - r.left;
            const left = px < r.width * 0.42;
            if (left && g.stick.id === null) {
                g.stick.id = ev.pointerId;
                g.stick.ox = g.stick.cx = ev.clientX; g.stick.oy = g.stick.cy = ev.clientY;
                touches.set(ev.pointerId, 'stick');
            } else if (g.stance) {
                const h = toHud(g, ev.clientX, ev.clientY);
                g.pen.x = h.x; g.pen.y = h.y;
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
                g.stick.cx = ev.clientX; g.stick.cy = ev.clientY;
                const R0 = 46;
                let dx = (ev.clientX - g.stick.ox) / R0, dy = (ev.clientY - g.stick.oy) / R0;
                const l = hypot(dx, dy);
                if (l > 1) { dx /= l; dy /= l; }
                g.stick.x = dx; g.stick.y = dy;
            } else if (role === 'look') {
                look(g, (ev.clientX - g.lookX) * 2.1, (ev.clientY - g.lookY) * 2.1);
                g.lookX = ev.clientX; g.lookY = ev.clientY;
            } else if (role === 'pen') {
                for (const e of everyMove(ev)) {
                    const h = toHud(g, e.clientX, e.clientY);
                    strokePoint(g, h.x, h.y);
                }
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
            if (isLocked(g) && document.exitPointerLock) document.exitPointerLock();
        };
    }
    // online there is nothing to pause, but you can still want the menu
    function toggleMenu(g) {
        g.menuOpen = !g.menuOpen;
        if (g.menuOpen) { g.wantFire = false; penUp(g); freeMouse(g); }
        paintOverlay(g);
    }
    function pickGuide(g, id) { g.guide = g.guide === id ? null : id; }
    function pause(g, on, why) {
        if (!g || !g.solo || g.ended) return;
        if (g.paused === on) return;
        g.paused = on;
        g.pauseWhy = why || null;
        g.keys = {}; g.wantFire = false; g.wantAim = false;
        if (on) {
            penUp(g);
            if (isLocked(g) && document.exitPointerLock) document.exitPointerLock();
        } else {
            lastT = performance.now();
            g.acc = 0;
            if (!g.touchMode && !g.noLock) askLock(g);
            focusGame(g);
        }
        paintOverlay(g);
    }

    // what this seat is holding, in the form the rules read
    function currentInput(g) {
        const k = g.keys;
        let mx = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0);
        let mz = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0);
        if (g.stick.id !== null) { mx = g.stick.x; mz = -g.stick.y; }
        const inp = {
            mx, mz, yaw: g.yaw, pitch: g.pitch,
            aim: (g.wantAim || g.touchAim) && !g.stance,
            ink: g.stance,
            jump: g.jumpQ, dash: g.dashQ
        };
        if (g.jumpQ) g.jumpSent = true;
        if (g.dashQ) g.dashSent = true;
        g.jumpQ = false; g.dashQ = false;
        return inp;
    }
    function tryFire(g, dt) {
        g.fireClock -= dt;
        const me = g.s.wiz[g.me];
        // a tap can start and end between two frames, and it still counts
        if (g.stance || me.dead || g.s.phase !== 'live' || !S.canAct(me)) { g.fireQ = false; return; }
        if (!g.wantFire && !g.fireQ) return;
        if (g.fireClock > 0) return;
        g.fireQ = false;
        const sp = me.chamber ? D.byId(me.chamber.s) : null;
        const rof = sp ? ((sp.p && sp.p.rof) || A.rof) : A.zap.rof;
        const why = issue(g, { c: 'fire', y: g.yaw, p: g.pitch });
        if (!why) {
            g.fireClock = rof * (S.has(me, 'overload') ? 0.7 : 1);
            if (!g.isHost) {
                // a guess, so that a guest's staff answers before the round trip does
                g.muzzle = 0.1;
                me.fireT = 0.14;
                sp ? SFX.fire() : SFX.zap();
            }
        } else if (why === 'cooling') g.fireClock = 0.03;
    }

    // ===============================================================
    // the loop
    // ===============================================================
    function pumpEvents(g) {
        const s = g.s;
        if (!s.ev.length) return;
        for (const e of s.ev) {
            onEvent(g, e);
            if (g.isHost && !g.solo) g.outbox.push(e);
        }
        s.ev.length = 0;
    }
    function tick(g) {
        const s = g.s;
        // keep the last place for everything, so a frame can land in between ticks
        s.wiz.forEach(w => { w.px = w.x; w.py = w.y; w.pz = w.z; });
        s.ents.forEach(e => { e.px = e.x; e.py = e.y; e.pz = e.z; });
        const inp = currentInput(g);
        S.setInput(s, g.me, inp);
        if (!g.isHost) {
            g.history.push({ q: g.inAck, inp: S.sanitizeInput(inp) });
            if (g.history.length > 120) g.history.shift();
        }
        for (const i in g.brains) S.think(s, +i, g.brains[i]);
        S.step(s);
        if (g.stance && (!S.canAct(s.wiz[g.me]) || s.wiz[g.me].dead || s.phase !== 'live')) clearStance(g);
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
            let budget = g.speed > 1 ? 200 : 6;
            while (g.acc + 1e-9 >= DT && budget-- > 0) {
                tick(g);
                g.acc -= DT;
            }
            if (g.acc > DT * 4 && g.speed <= 1) g.acc = 0;
            pumpEvents(g);
            tryFire(g, dt);
            maybeRead(g, false);
        }
        if (g.isHost && !g.solo) sendSnapshot(g, dt);
        if (!g.isHost && !g.solo && !g.netDown) sendInput(g, dt);
        // nobody came back to a 1v1: a bot takes the seat, and the one left gets their game
        if (g.isHost && g.netDown && g.vacant !== undefined && performance.now() - g.downAt > VACANT_MS) {
            putBotIn(g, g.vacant);
            g.vacant = undefined;
            comeBack(g);
        }
        if (!g.ended && g.s.phase === 'matchover') endMatch(g);
        render(g, g.paused ? 0 : dt);

        // how it is doing, measured
        const ms = performance.now() - t0;
        g.frames++;
        g.frameMs += ms;
        g.frameMax = max(g.frameMax, ms);
        g.fpsT += dtRaw;
        if (g.fpsT >= 1) {
            g.lastFps = g.frames / g.fpsT;
            g.lastMs = g.frameMs / g.frames;
            g.lastMax = g.frameMax;
            g.frames = 0; g.fpsT = 0; g.frameMs = 0; g.frameMax = 0;
        }
    }
    function stopLoop() {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
    }

    // ===============================================================
    // what happened, as light and noise
    // ===============================================================
    const elCol = el => GL.hex((D.EL[el] || {}).color || '#ffffff');
    const elGlow = el => GL.hex((D.EL[el] || {}).glow || '#ffffff');
    const ZAPCOL = [0.05, 0.95, 0.35];
    function burst(g, x, y, z, n, col, speed, size, life, opts) {
        if (g.fx.length > 420) return;
        opts = opts || {};
        for (let i = 0; i < n; i++) {
            const a = Math.random() * 6.28, b = Math.random() * 3.14 - 1.57;
            const v = speed * (0.4 + Math.random() * 0.6);
            g.fx.push({
                x, y, z, vx: cos(a) * cos(b) * v, vy: sin(b) * v + (opts.up || 0), vz: sin(a) * cos(b) * v,
                t: life * (0.6 + Math.random() * 0.5), life, size: size * (0.7 + Math.random() * 0.6),
                tile: opts.tile === undefined ? GL.TILE.star : opts.tile, col, grav: opts.grav === undefined ? 6 : opts.grav, rot: a
            });
        }
    }
    function onEvent(g, e) {
        const s = g.s, me = g.me;
        switch (e[0]) {
            case 'cast': {
                const w = s.wiz[e[1]], sp = D.SPELLS[e[2]];
                if (!sp) break;
                burst(g, w.x, w.y + 1, w.z, 14, elGlow(sp.el), 4, 0.22, 0.5);
                g.rings.push({ x: w.x, y: w.y + 0.06, z: w.z, r0: 0.5, r1: 2.2, t: 0.4, life: 0.4, col: elCol(sp.el), tile: GL.TILE.sigil });
                if (e[1] === me) { SFX.cast(sp.el); } else if (e[1] !== me) tone(420, 0.1, { type: 'triangle', gain: 0.02 });
                break;
            }
            case 'fire': {
                const w = s.wiz[e[1]], si = e[2];
                if (e[1] === me) g.muzzle = 0.1;
                if (si === S.ZAP) { if (e[1] === me) SFX.zap(); }
                else if (e[1] === me) SFX.fire();
                break;
            }
            case 'hit': {
                const i = e[1], amount = e[2];
                const w = s.wiz[i];
                const si = e[3], by = e[4];
                const mineToo = i === me || by === me || (si === 254 && hypot(w.x - s.wiz[me].x, w.z - s.wiz[me].z) < 20);
                const col = i === me ? '#ff6b6b' : si === S.ZAP ? '#0df259' : '#ffe14d';
                if (mineToo) addFloat(g, w, 2.1, '-' + max(1, round(amount)), col);
                if (si !== 254) {
                    if (i === me) { g.vignette = min(1, g.vignette + 0.45); g.shake = min(0.5, g.shake + amount * 0.015); SFX.hurt(); }
                    else if (by === me) { g.hitMark = 0.22; SFX.hit(); }
                    burst(g, w.x, w.y + 1.1, w.z, 6, [1, 0.3, 0.3], 3, 0.16, 0.4);
                }
                break;
            }
            case 'boom': {
                const [, x, y, z, r, el] = e;
                const col = elCol(el), gl = elGlow(el);
                g.rings.push({ x, y: y + 0.05, z, r0: 0.4, r1: r * 1.1, t: 0.45, life: 0.45, col: gl, tile: GL.TILE.ring });
                burst(g, x, y + 0.4, z, 26, col, r * 2.3, 0.34, 0.65, { tile: GL.TILE.smoke, grav: 2 });
                burst(g, x, y + 0.4, z, 16, gl, r * 3, 0.2, 0.5);
                const d = hypot(x - s.wiz[me].x, z - s.wiz[me].z);
                if (d < 28) { SFX.boom(); g.shake = min(0.7, g.shake + (1 - d / 28) * 0.45); }
                break;
            }
            case 'zap': {
                const [, x, y, z, el] = e;
                burst(g, x, y, z, 7, elGlow(el), 4, 0.13, 0.32);
                break;
            }
            case 'beam': {
                const [, x1, y1, z1, x2, y2, z2, el] = e;
                g.beams.push({ x1, y1, z1, x2, y2, z2, t: 0.22, life: 0.22, w: 0.36, col: elCol(el), gl: elGlow(el) });
                burst(g, x2, y2, z2, 12, elGlow(el), 5, 0.18, 0.4);
                SFX.fire();
                break;
            }
            case 'line': {
                const [, x1, y1, z1, x2, y2, z2, el] = e;
                g.beams.push({ x1, y1, z1, x2, y2, z2, t: 0.5, life: 0.5, w: 0.06, col: elCol(el), gl: elCol(el), warn: true });
                break;
            }
            case 'nova': {
                const w = s.wiz[e[1]];
                g.rings.push({ x: w.x, y: w.y + 0.3, z: w.z, r0: 0.5, r1: e[2], t: 0.42, life: 0.42, col: elGlow(e[3]), tile: GL.TILE.halo });
                burst(g, w.x, w.y + 0.9, w.z, 26, elCol(e[3]), e[2] * 2.3, 0.24, 0.55);
                SFX.boom();
                break;
            }
            case 'buff': {
                const w = s.wiz[e[1]], sp = D.SPELLS[e[2]];
                burst(g, w.x, w.y + 1, w.z, 18, elGlow(sp.el), 2.6, 0.2, 0.7, { grav: -3 });
                if (e[1] === me) SFX.ward();
                break;
            }
            case 'blink': {
                const [, x1, y1, z1, x2, y2, z2] = e;
                g.beams.push({ x1, y1: y1 + 1, z1, x2, y2: y2 + 1, z2, t: 0.25, life: 0.25, w: 0.5, col: [0.75, 0.55, 1], gl: [1, 0.85, 1] });
                burst(g, x1, y1 + 1, z1, 14, [0.75, 0.55, 1], 3, 0.2, 0.45);
                burst(g, x2, y2 + 1, z2, 14, [0.9, 0.8, 1], 3, 0.2, 0.45);
                SFX.ward();
                break;
            }
            case 'dash': {
                const w = s.wiz[e[1]];
                burst(g, w.x, w.y + 0.3, w.z, 9, [0.8, 0.8, 0.8], 2.4, 0.26, 0.35, { tile: GL.TILE.smoke, grav: 0 });
                break;
            }
            case 'ink': {
                const w = s.wiz[e[1]];
                addFloat(g, w, 2.4, '-' + e[2] + ' ink', '#7fa0ff');
                break;
            }
            case 'mirror': {
                const w = s.wiz[e[1]];
                addFloat(g, w, 2.4, 'mirrored', '#e0b3ff');
                SFX.ward();
                break;
            }
            case 'pick': {
                const p = s.pickups[e[2]];
                if (!p) break;
                burst(g, p.x, p.y + 0.6, p.z, 12, [0.6, 0.9, 1], 3, 0.18, 0.5, { grav: -2 });
                if (e[1] === me) {
                    SFX.pick();
                    say(g, A.pickups[p.kind].label, 'pick', 1);
                }
                break;
            }
            case 'ko': {
                const vic = e[1];
                SFX.ko();
                const w = s.wiz[vic];
                burst(g, w.x, w.y + 1, w.z, 30, [1, 0.25, 0.3], 7, 0.26, 0.9);
                const by = e[2];
                if (vic === me) banner(g, 'knocked out', '#ff6b6b', 2.2);
                else if (by === me) banner(g, s.wiz[vic].name + ' is down', '#0df259', 1.8);
                else if (g.mode === 1) banner(g, s.wiz[vic].name + ' is down', '#0df259', 1.8);
                g.feed.push({ text: (by >= 0 && s.wiz[by] ? s.wiz[by].name + ' got ' : '') + s.wiz[vic].name, good: s.wiz[vic].team !== g.myTeam, t: 5 });
                if (g.feed.length > 4) g.feed.shift();
                if (g.solo && g.bot && g.mode === 1) botLine(g, vic === 0 ? 'win' : 'lose');
                break;
            }
            case 'sub': {
                const w = s.wiz[e[1]];
                if (w) say(g, e[2] ? w.name + ' left. a bot took the seat' : w.name + ' is back', 'bot', 2.4);
                break;
            }
            case 'spawn': break;
            case 'go': {
                SFX.tick();
                if (g.solo) botLine(g, 'start');
                break;
            }
            case 'stance': break;
            case 'over': break;
        }
    }
    function botLine(g, kind) {
        if (!g.solo || !g.bot) return;
        const lines = (g.bot.lines || {})[kind];
        if (!lines || !lines.length) return;
        g.hint = { text: g.bot.name + ': ' + lines[floor(Math.random() * lines.length)], kind: 'bot' };
        g.hintT = 2.8;
    }
    function addFloat(g, w, height, text, color) {
        if (g.floats.length > 24) g.floats.shift();
        g.floats.push({ x: w.x + (Math.random() - 0.5) * 0.5, y: w.y + height, z: w.z, text, color, t: 1.1 });
    }

    // ===============================================================
    // the frame
    // ===============================================================
    function lerp(a, b, t) { return a + (b - a) * t; }
    function buildWizards(g, dt, alpha) {
        const out = [];
        const s = g.s;
        const near = g.camLen === undefined ? 1 : clamp((g.camLen - 0.6) / 1.1, 0, 1);
        for (let i = 0; i < s.wiz.length; i++) {
            const w = s.wiz[i];
            const mine = i === g.me;
            let x = w.px === undefined ? w.x : lerp(w.px, w.x, alpha), y = w.py === undefined ? w.y : lerp(w.py, w.y, alpha), z = w.pz === undefined ? w.z : lerp(w.pz, w.z, alpha);
            if (mine && !g.isHost) {
                const k = Math.pow(0.0005, dt);
                g.errX *= k; g.errY *= k; g.errZ *= k;
                x += g.errX; y += g.errY; z += g.errZ;
            }
            if (!mine && !g.isHost && !g.solo) {
                // their last known place, eased, so that five snapshots a second does not stutter
                const k = 1 - Math.pow(0.0004, dt);
                const rv = g.rv[i] || (g.rv[i] = { x, y, z });
                // a respawn is a jump, and nobody wants to watch them slide there
                if (hypot(x - rv.x, z - rv.z) > 12) { rv.x = x; rv.y = y; rv.z = z; }
                rv.x = lerp(rv.x, x, k); rv.y = lerp(rv.y, y, k); rv.z = lerp(rv.z, z, k);
                x = rv.x; y = rv.y; z = rv.z;
            }
            const speed = hypot(w.mvx || 0, w.mvz || 0);
            g.walkA[i] += speed * dt * 1.5;
            const wantFall = w.dead ? 1 : 0;
            g.fall[i] = lerp(g.fall[i], wantFall, min(1, dt * 7));
            const yawNow = mine ? g.yaw : w.yaw;
            const wantRaise = w.aim || w.fireT > 0 || w.stance ? 1 : 0.25;
            g.raise[i] = lerp(g.raise[i], wantRaise, min(1, dt * 12));
            const pos = { x, y, z };
            const dist = hypot(x - s.wiz[g.me].x, z - s.wiz[g.me].z);
            let alphaOut;
            if (S.has(w, 'phase')) alphaOut = 0.4;
            if (S.has(w, 'stealth')) alphaOut = mine || w.team === g.myTeam ? 0.45 : (dist <= 4.5 ? 0.28 : 0);
            if (w.safe > 0 && floor(s.t * 10) % 2) alphaOut = 0.5;
            if (w.dead && g.fall[i] > 0.9 && w.respawn < 0.8) alphaOut = max(0, w.respawn);
            out.push({
                x: pos.x, y: pos.y, z: pos.z, groundY: S.heightAt(pos.x, pos.z),
                yaw: yawNow, pitch: mine ? g.pitch : w.pitch,
                avatar: w.avatar,
                walk: speed > 0.3 && !w.dead ? g.walkA[i] : 0,
                raise: g.raise[i], kneel: w.stance ? 1 : 0, fall: g.fall[i],
                // your own wizard fades out as the camera comes in to your head, rather than showing its inside
                alpha: mine && near < 1 ? min(alphaOut === undefined ? 1 : alphaOut, near) : alphaOut, hidden: alphaOut === 0 || (mine && near < 0.15),
                flash: w.hitT > 0 ? 0.7 * w.hitT / 0.25 : 0,
                xray: w.team !== g.myTeam && S.has(w, 'mark') && !w.dead, stance: w.stance, i, w
            });
        }
        return out;
    }

    // ---------- a light hand on the aim, for thumbs ----------
    // A thumb on glass is a worse mouse, so on a touch screen the crosshair leans a little
    // towards an opponent who is already nearly under it: within about a metre of them,
    // and only while you are doing something (looking, walking, aiming or firing), so it
    // never swings the camera round by itself. It is light, it slows the thumb a little on
    // them, it does not see through walls or invisibility, and it can be switched off in
    // settings. Only the yaw and pitch this side sends are touched, so online it is the
    // same as having aimed that way.
    const ASSIST = { metres: 1.05, range: 34, pull: 1.6, aimPull: 2.4, slow: 0.7 };
    function assistAim(g, dt, wiz, cam) {
        g.assist = null;
        const s = g.s, me = s.wiz[g.me];
        if (!g.touch || !g.settings.assist || g.stance || g.paused || g.ended || me.dead || s.phase !== 'live') return;
        let best = null;
        for (const f of wiz) {
            const q = f.w;
            if (!q || q.team === g.myTeam || q.dead || f.hidden || (typeof f.alpha === 'number' && f.alpha < 0.3)) continue;
            const tx = f.x, ty = f.y + 1.1, tz = f.z;
            const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z, flat = hypot(dx, dz), d = hypot(flat, dy);
            if (d > ASSIST.range || d < 1.5) continue;
            let ey = atan2(dx, -dz) - g.yaw;
            ey = atan2(sin(ey), cos(ey));
            const ep = atan2(dy, flat) - g.pitch;
            const err = hypot(ey * cos(g.pitch), ep), cone = Math.atan(ASSIST.metres / d) + 0.015;
            if (err > cone || (best && err >= best.err)) continue;
            if (!lineToThem(s, cam, tx, ty, tz, d, g.myTeam)) continue;
            best = { ey, ep, err, cone, who: q.i };
        }
        if (!best) return;
        g.assist = best;
        const busy = g.lookId !== null || g.stick.id !== null || g.wantFire || g.touchAim;
        if (!busy) return;
        const k = min(1, (g.touchAim ? ASSIST.aimPull : ASSIST.pull) * dt) * (1 - best.err / best.cone);
        g.yaw += best.ey * k;
        g.pitch = clamp(g.pitch + best.ep * k, -1.2, 1.2);
    }
    // the ground, and walls that would stop your shot (your own side's let it through)
    function lineToThem(s, cam, tx, ty, tz, d, team) {
        if (!S.clearLine(s, cam.x, cam.y, cam.z, tx, ty, tz)) return false;
        const n = Math.ceil(d / 0.5);
        for (const e of s.ents) {
            if (e.k !== 'wall' || e.tm === team) continue;
            for (let k = 1; k < n; k++) {
                const u = k / n, x = cam.x + (tx - cam.x) * u, y = cam.y + (ty - cam.y) * u, z = cam.z + (tz - cam.z) * u;
                if (y < e.h && S.inBox(e, x, z, 0)) return false;
            }
        }
        return true;
    }
    function render(g, dt) {
        const s = g.s, me = s.wiz[g.me], renderer = g.R;
        fit(g);
        const alpha = clamp(g.acc / DT, 0, 1);
        const wiz = buildWizards(g, dt, alpha);
        const mine = wiz[g.me];
        // the camera follows you, with your own yaw and pitch, which never wait for anything
        const proxy = { x: mine.x, y: mine.y, z: mine.z, yaw: g.yaw, pitch: g.pitch, aim: (g.wantAim || g.touchAim) && !g.stance, lens: true, was: g.camLen, dt };
        // the arm carries on from last frame, unless you went somewhere else entirely (a respawn, a blink)
        if (g.camAt && hypot(mine.x - g.camAt.x, mine.z - g.camAt.z, mine.y - g.camAt.y) > 3) proxy.was = undefined;
        const cam = S.camera(s, proxy);
        g.camAt = { x: mine.x, y: mine.y, z: mine.z };
        g.camLen = cam.len; g.camT = cam.t; g.cam = cam;
        assistAim(g, dt, wiz, cam);
        g.shake = max(0, g.shake - dt * 1.4);
        const shake = g.shake > 0 ? g.shake * 0.25 : 0;
        const camV = {
            x: cam.x + (shake ? (Math.random() - 0.5) * shake : 0), y: cam.y + (shake ? (Math.random() - 0.5) * shake : 0), z: cam.z,
            fx: cam.fx, fy: cam.fy, fz: cam.fz
        };
        // fov is vertical, so a screen taller than wide saw a slice 47 degrees across, and
        // most of that was your own back. Upright it aims for about 70 across instead, as
        // far as 100 degrees of height allows. Only the picture: the crosshair is the
        // middle of the screen whatever the lens, so this is nothing to the sim.
        const hipFov = g.aspect < 1 ? min(1.75, 2 * Math.atan(Math.tan(0.61) / g.aspect)) : 1.12;
        const wantFov = proxy.aim ? hipFov * 0.7 : hipFov;
        g.fovNow = lerp(g.fovNow, wantFov, min(1, dt * 12));

        // the draw distance is short anyway, and the closing fog takes it down further
        const theme = S.LAYOUT.theme;
        const near = S.has(me, 'blind') ? 2 : (theme.near || 9), far = S.has(me, 'blind') ? 9 : (theme.far || 30);
        const shrink = s.fog < A.fogStart ? clamp(s.fog / 24 + 0.35, 0.38, 1) : 1;
        const inCloud = s.ents.some(e => e.k === 'zone' && e.s && D.byId(e.s).p.obscure && hypot(e.x - me.x, e.z - me.z) < e.r);
        const fog = [near * shrink * (inCloud ? 0.4 : 1), far * shrink * (inCloud ? 0.45 : 1)];
        const danger = s.fog < A.fogStart ? [0.32, 0.36, 0.42] : null;

        let tint = null;
        if (g.stance) tint = [0.62, 0.66, 0.85];
        else if (me.dead) tint = [0.55, 0.4, 0.4];
        else if (S.has(me, 'freeze')) tint = [0.7, 0.85, 1.1];

        const walls = [], gems = [];
        for (const e of s.ents) {
            if (e.k === 'wall') {
                const sp = D.byId(e.s);
                walls.push({ x: e.x, y: e.y, z: e.z, yaw: -e.ang, sx: sp.p.w, sy: sp.p.h, sz: sp.p.d, ice: sp.el === 'ice', flash: e.hp / e.maxHp < 0.3 ? 0.15 : 0 });
            } else if (e.k === 'shot') {
                const x = e.px === undefined ? e.x : lerp(e.px, e.x, alpha), y = e.py === undefined ? e.y : lerp(e.py, e.y, alpha), z = e.pz === undefined ? e.z : lerp(e.pz, e.z, alpha);
                e.rx = x; e.ry = y; e.rz = z;
                if (!e.zap) gems.push({ x, y, z, r: max(0.14, e.r * 0.8), col: elCol(e.el), spin: s.t * 7 + e.id });
            }
        }
        const decoys = [];
        for (const e of s.ents) {
            if (e.k !== 'decoy') continue;
            const owner = s.wiz[e.o];
            const moving = hypot(e.gx - e.x, e.gz - e.z) > 0.5;
            decoys.push({ x: e.x, y: e.y, z: e.z, groundY: S.heightAt(e.x, e.z), yaw: e.yaw, pitch: 0, avatar: owner.avatar, walk: moving ? s.t * 11 : 0, raise: 0.25, kneel: 0, fall: 0, alpha: e.o === g.me ? 0.6 : undefined, flash: 0 });
        }
        const pickups = s.pickups.filter(p => p.t <= 0);
        const glow = b => drawGlow(g, b, dt, wiz, alpha);
        renderer.frame({
            cam: camV, fov: g.fovNow, fog, fogColor: danger, tint,
            wizards: decoys.length ? wiz.concat(decoys) : wiz, walls, gems, pickups, t: s.t + 100, glow
        });
        drawHud(g, dt, wiz);
        renderTouchKnobs(g);
    }

    function drawGlow(g, b, dt, wiz, alpha) {
        const s = g.s, T = b.TILE;
        // ---- what is on the ground ----
        for (const e of s.ents) {
            switch (e.k) {
                case 'shot': {
                    const col = e.zap ? ZAPCOL : elCol(e.el), gl = e.zap ? [0.7, 1, 0.8] : elGlow(e.el);
                    const x = e.rx === undefined ? e.x : e.rx, y = e.ry === undefined ? e.y : e.ry, z = e.rz === undefined ? e.z : e.rz;
                    const r = e.zap ? 0.28 : e.r;
                    b.sprite(x, y, z, r * 1.9, T.glow, col, 0);
                    b.sprite(x, y, z, r * 1.1, e.zap ? T.flare : T.star, gl, s.t * 9);
                    if (dt > 0 && g.fx.length < 380 && !e.zap && Math.random() < 0.65) {
                        g.fx.push({ x, y, z, vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), vz: (Math.random() - 0.5), t: 0.32, life: 0.32, size: r * 0.8, tile: T.smoke, col, grav: 0, rot: Math.random() * 6 });
                    }
                    break;
                }
                case 'zone': {
                    const sp = D.byId(e.s), col = elCol(sp.el), gl = elGlow(sp.el), p = sp.p;
                    const y = e.y + 0.05;
                    b.disc(e.x, y, e.z, e.r, T.ring, col, s.t * 0.5);
                    b.disc(e.x, y + 0.02, e.z, e.r * 0.7, T.sigil, gl, -s.t * 0.8);
                    if (p.blocks) {
                        // a dome: three rings stacked
                        for (let k = 0; k < 3; k++) b.sprite(e.x, y + e.r * (0.2 + k * 0.28), e.z, e.r * (1 - k * 0.18), T.halo, gl, s.t * (k + 1));
                    }
                    if (dt > 0 && g.fx.length < 380) {
                        const n = p.obscure ? 3 : 1;
                        for (let k = 0; k < n; k++) {
                            const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * e.r;
                            g.fx.push({
                                x: e.x + cos(a) * d, y, z: e.z + sin(a) * d, vx: p.pull ? -cos(a) * 3 : 0, vy: p.obscure ? 0.9 : 1.8, vz: p.pull ? -sin(a) * 3 : 0,
                                t: 0.9, life: 0.9, size: p.obscure ? 1.5 : 0.35, tile: p.obscure ? T.smoke : T.star, col: p.obscure ? gl : col, grav: 0, rot: a
                            });
                        }
                    }
                    break;
                }
                case 'trap': {
                    // yours shows. Theirs is a glint until you are nearly on it
                    const mine = e.tm === g.myTeam;
                    const d = hypot(e.x - s.wiz[g.me].x, e.z - s.wiz[g.me].z);
                    if (mine || d < 6.5) {
                        const col = elCol(e.el);
                        const k = mine ? 0.9 : 0.5;
                        b.disc(e.x, e.y + 0.05, e.z, 1.2, T.star, [col[0] * k, col[1] * k, col[2] * k], s.t);
                    }
                    break;
                }
                case 'strike': {
                    const sp = D.byId(e.s), col = elCol(sp.el), gl = elGlow(sp.el);
                    b.disc(e.x, e.y + 0.08, e.z, sp.p.r * (1 + sin(s.t * 18) * 0.05), T.ring, col, s.t * 2);
                    const delay = sp.p.delay;
                    const left = clamp(e.t / delay, 0, 1);
                    // something coming down
                    const top = e.y + left * 28;
                    if (sp.el === 'fire') { b.sprite(e.x, top, e.z, 2.2, T.glow, col, 0); b.sprite(e.x, top, e.z, 1.2, T.star, gl, s.t * 6); }
                    else b.streak(e.x, e.y, e.z, e.x, e.y + 28, e.z, sp.p.r * 0.5 * (1 - left), T.beam, gl);
                    break;
                }
                case 'pending': {
                    const sp = D.byId(e.s);
                    const c = elCol(sp.el);
                    b.streak(e.x, e.y, e.z, e.x + e.dx * sp.p.range, e.y + e.dy * sp.p.range, e.z + e.dz * sp.p.range, 0.08, T.beam, c);
                    break;
                }
            }
        }
        // ---- a wizard's own light ----
        for (const w of wiz) {
            const av = w.avatar;
            const q = w.w;
            if (w.hidden || q.dead) continue;
            // whose side they are on, at their feet, when there are sides to speak of
            if (g.mode > 1 && w.i !== g.me) b.disc(w.x, w.groundY + 0.05, w.z, 0.85, T.halo, q.team === g.myTeam ? [0.05, 0.8, 0.3] : [0.9, 0.12, 0.15], 0);
            if (av.aura && av.aura !== 'none') {
                const col = { sparks: [1, 0.9, 0.3], flames: [1, 0.45, 0.15], frost: [0.45, 0.85, 1], shadow: [0.6, 0.45, 0.85], holy: [1, 1, 0.85] }[av.aura];
                for (let k = 0; k < 4; k++) {
                    const a = s.t * 1.8 + k * 1.57;
                    b.sprite(w.x + cos(a) * 0.62, w.y + 0.6 + sin(s.t * 2 + k) * 0.5, w.z + sin(a) * 0.62, 0.12, T.star, col, a);
                }
            }
            if (q.ward > 0) {
                const col = q.wardZap ? [1, 0.9, 0.3] : q.wardThorns ? [1, 0.5, 0.2] : [0.6, 0.85, 1];
                b.sprite(w.x, w.y + 1, w.z, 1.25, T.halo, col, s.t * 2);
                b.sprite(w.x, w.y + 1, w.z, 1.15, T.halo, [col[0] * 0.6, col[1] * 0.6, col[2] * 0.6], -s.t * 1.6);
            }
            if (q.stance) {
                // a wizard drawing has a bubble of slow time round them, and it shows
                b.disc(w.x, w.groundY + 0.06, w.z, A.stance.slowR, T.ring, [0.05, 0.5, 0.25], s.t * 0.5);
                b.disc(w.x, w.groundY + 0.07, w.z, 1.1, T.sigil, ZAPCOL, -s.t * 2);
                b.sprite(w.x, w.y + 1.1, w.z, 1.5, T.halo, [0.1, 0.6, 0.3], s.t * 3);
            }
            for (const k of Object.keys(q.st)) {
                if (k === 'burn' && Math.random() < 0.7 && dt > 0) g.fx.push({ x: w.x + (Math.random() - 0.5) * 0.5, y: w.y + Math.random() * 1.6, z: w.z + (Math.random() - 0.5) * 0.5, vx: 0, vy: 2, vz: 0, t: 0.35, life: 0.35, size: 0.2, tile: T.glow, col: [1, 0.5, 0.15], grav: -1, rot: 0 });
                if (k === 'freeze') b.sprite(w.x, w.y + 1, w.z, 1.1, T.shard, [0.6, 0.85, 1], 0);
                if (k === 'root') b.disc(w.x, w.groundY + 0.08, w.z, 1, T.star, [0.35, 0.8, 0.3], s.t);
                if (k === 'stun') for (let n = 0; n < 3; n++) { const a = s.t * 6 + n * 2.1; b.sprite(w.x + cos(a) * 0.4, w.y + 2.1, w.z + sin(a) * 0.4, 0.12, T.star, [1, 1, 0.5], a); }
                if (k === 'mirror') b.sprite(w.x, w.y + 1, w.z, 1, T.sigil, [0.75, 0.4, 1], s.t);
                if (k === 'clock') b.sprite(w.x, w.y + 2.3, w.z, 0.22, T.star, [1, 0.4, 0.8], s.t * 3);
                if (k === 'turbo') b.sprite(w.x, w.y + 0.1, w.z, 0.55, T.glow, [0.1, 0.9, 0.4], 0);
            }
            if (q.fireT > 0) {
                const f = S.forward(w.yaw, w.pitch);
                const rx = cos(w.yaw), rz = sin(w.yaw);
                b.sprite(w.x + rx * 0.42 + f.x * 0.7, w.y + 1.3 + f.y * 0.7, w.z + rz * 0.42 + f.z * 0.7, 0.5, T.flare, q.chamber ? elGlow(D.byId(q.chamber.s).el) : ZAPCOL, s.t * 20);
            }
        }
        // ---- pickups glint, and the altar gives itself away ----
        for (const p of s.pickups) {
            if (p.t > 0) continue;
            const col = p.kind === 'ink' ? [0.35, 0.5, 1] : p.kind === 'hp' ? [1, 0.3, 0.4] : p.kind === 'turbo' ? [0.2, 1, 0.5] : [1, 0.4, 0.85];
            b.sprite(p.x, p.y + 0.8, p.z, 0.9, T.glow, col, 0);
            b.disc(p.x, p.y + 0.04, p.z, 1, T.halo, col, s.t);
        }
        const on = s.onAltar;
        const owner = on === 0 || on === 1;
        const altar = S.LAYOUT.altar;
        const aCol = owner ? (on === g.myTeam ? [0.05, 0.9, 0.35] : [0.95, 0.25, 0.3]) : on === 2 ? [1, 0.9, 0.2] : [0.55, 0.3, 0.9];
        b.disc(0, altar.h + 0.05, 0, altar.r, T.ring, aCol, s.t * 0.25);
        b.sprite(0, altar.h + 3.8, 0, 3.4, T.glow, [aCol[0] * 0.5, aCol[1] * 0.5, aCol[2] * 0.5], 0);
        // ---- particles ----
        const keep = [];
        for (const f of g.fx) {
            f.t -= dt;
            if (f.t <= 0) continue;
            f.vy -= f.grav * dt;
            f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
            const k = clamp(f.t / f.life, 0, 1);
            b.sprite(f.x, f.y, f.z, f.size * (0.5 + 0.5 * k), f.tile, [f.col[0] * k, f.col[1] * k, f.col[2] * k], f.rot + f.t * 3);
            keep.push(f);
        }
        g.fx = keep;
        const rkeep = [];
        for (const r of g.rings) {
            r.t -= dt;
            if (r.t <= 0) continue;
            const k = r.t / r.life;
            b.disc(r.x, r.y, r.z, lerp(r.r1, r.r0, k), r.tile, [r.col[0] * k, r.col[1] * k, r.col[2] * k], s.t);
            rkeep.push(r);
        }
        g.rings = rkeep;
        const bkeep = [];
        for (const r of g.beams) {
            r.t -= dt;
            if (r.t <= 0) continue;
            const k = r.t / r.life;
            const w = r.warn ? r.w : r.w * (0.4 + k);
            b.streak(r.x1, r.y1, r.z1, r.x2, r.y2, r.z2, w, T.beam, [r.col[0] * k, r.col[1] * k, r.col[2] * k]);
            b.streak(r.x1, r.y1, r.z1, r.x2, r.y2, r.z2, w * 0.45, T.beam, [r.gl[0] * k, r.gl[1] * k, r.gl[2] * k]);
            bkeep.push(r);
        }
        g.beams = bkeep;
    }

    // ===============================================================
    // the hud: a 2d canvas over the top
    // ===============================================================
    const sigilCache = new Map();
    function sigilImage(id, size, color) {
        const key = id + ':' + size + ':' + (color || '');
        let c = sigilCache.get(key);
        if (c) return c;
        c = document.createElement('canvas');
        c.width = c.height = size;
        paintSigil(c, D.byId(id), { width: 9, pad: 2, color });
        sigilCache.set(key, c);
        return c;
    }
    function bevelBox(c, x, y, w, h, fill) {
        c.fillStyle = fill || '#c0c0c0';
        c.fillRect(x, y, w, h);
        c.fillStyle = '#ffffff'; c.fillRect(x, y, w, 1); c.fillRect(x, y, 1, h);
        c.fillStyle = '#404040'; c.fillRect(x, y + h - 1, w, 1); c.fillRect(x + w - 1, y, 1, h);
    }
    function bar(c, x, y, w, h, frac, col, back, right) {
        c.fillStyle = '#000'; c.fillRect(x - 1, y - 1, w + 2, h + 2);
        c.fillStyle = back; c.fillRect(x, y, w, h);
        const fw = max(0, min(1, frac)) * w;
        c.fillStyle = col;
        c.fillRect(right ? x + w - fw : x, y, fw, h);
        c.fillStyle = '#ffffff33'; c.fillRect(right ? x + w - fw : x, y, fw, 1);
    }
    function text(c, s, x, y, col, size, align, shadow) {
        c.font = 'bold ' + (size || 11) + 'px "Courier New", monospace';
        c.textAlign = align || 'left';
        c.textBaseline = 'alphabetic';
        if (shadow !== false) { c.fillStyle = '#000'; c.fillText(s, x + 1, y + 1); }
        c.fillStyle = col || '#fff';
        c.fillText(s, x, y);
    }
    function clock(sec) {
        sec = max(0, Math.ceil(sec));
        return floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    }
    function drawHud(g, dt, wiz) {
        const c = g.hctx, W = hudW(g), H = g.hudH, s = g.s;
        const me = s.wiz[g.me], team = g.myTeam;
        const enemies = s.wiz.filter(q => q.team !== team), allies = s.wiz.filter(q => q.team === team && q !== me);
        c.clearRect(0, 0, W, H);
        c.imageSmoothingEnabled = false;
        g.hintT = max(0, g.hintT - dt);
        g.bannerT = max(0, g.bannerT - dt);
        g.vignette = max(0, g.vignette - dt * 1.6);
        g.hitMark = max(0, g.hitMark - dt);

        // ---- the screen itself ----
        if (g.vignette > 0 || me.hp < 28) {
            const low = me.hp < 28 && !me.dead ? (0.2 + 0.1 * sin(s.t * 6)) : 0;
            const a = max(g.vignette * 0.55, low);
            c.fillStyle = 'rgba(190,20,30,' + a + ')';
            c.fillRect(0, 0, W, 14); c.fillRect(0, H - 14, W, 14); c.fillRect(0, 0, 14, H); c.fillRect(W - 14, 0, 14, H);
        }
        if (S.has(me, 'blind')) {
            c.fillStyle = 'rgba(126,224,106,0.28)'; c.fillRect(0, 0, W, H);
            c.fillStyle = 'rgba(126,224,106,0.55)';
            for (let i = 0; i < 46; i++) {
                const x = (i * 137 + sin(s.t + i) * 22) % W, y = (i * 71 + cos(s.t * 0.7 + i) * 18) % H;
                c.fillRect(x, y, 3 + (i % 4) * 2, 3 + (i % 4) * 2);
            }
        }
        if (S.has(me, 'freeze')) { c.fillStyle = 'rgba(190,240,255,0.32)'; c.fillRect(0, 0, W, H); }
        const outside = s.fog < A.fogStart && hypot(me.x, me.z) > s.fog;
        if (outside && !me.dead) { c.fillStyle = 'rgba(60,90,100,0.35)'; c.fillRect(0, 0, W, H); }

        // ---- numbers floating off people ----
        const keep = [];
        for (const f of g.floats) {
            f.t -= dt;
            if (f.t <= 0) continue;
            const p = g.R.project(f.x, f.y + (1.1 - f.t) * 0.9, f.z);
            if (p && p.d < 50) {
                c.globalAlpha = min(1, f.t * 2);
                text(c, f.text, p.x * W, p.y * H, f.color, 12, 'center');
                c.globalAlpha = 1;
            }
            keep.push(f);
        }
        g.floats = keep;

        // ---- a name over everybody ----
        // one line of sight a frame, because eight every frame is what the bots are for
        g.seeI = ((g.seeI || 0) + 1) % s.wiz.length;
        const looked = s.wiz[g.seeI];
        g.seen[g.seeI] = S.clearLine(s, me.x, me.y + 1.7, me.z, looked.x, looked.y + 1.5, looked.z);
        wiz.forEach(f => {
            const q = f.w;
            if (!q || q === me || q.dead || f.hidden) return;
            const ally = q.team === team;
            if (!ally && !g.seen[q.i]) return;
            const p = g.R.project(f.x, f.y + 2.25, f.z);
            if (!p || p.d > (ally ? 60 : 36)) return;
            const bw = 44;
            if (ally) text(c, q.name, p.x * W, p.y * H - 2, g.seen[q.i] ? '#7dffa8' : '#3f9f66', 8, 'center');
            bar(c, p.x * W - bw / 2, p.y * H, bw, 3, q.hp / A.maxHp, ally ? '#0df259' : '#e4485f', ally ? '#0a3018' : '#3a0f18');
            if (q.ward > 0) { c.fillStyle = '#bfe8ff'; c.fillRect(p.x * W - bw / 2, p.y * H - 2, min(1, q.ward / 40) * bw, 1); }
        });

        // ---- the top: who is winning ----
        const cx = W / 2;
        bevelBox(c, cx - 98, 3, 196, 25, '#c0c0c0');
        if (s.koGoal <= 3) {
            const pips = (t, x, dir) => {
                for (let k = 0; k < s.koGoal; k++) {
                    const px = x + dir * k * 11;
                    c.fillStyle = '#404040'; c.fillRect(px, 8, 9, 9);
                    c.fillStyle = k < s.score[t] ? (t === team ? '#0df259' : '#e4485f') : '#808080';
                    c.fillRect(px + 1, 9, 7, 7);
                }
            };
            pips(team, cx - 92, 1);
            pips(1 - team, cx + 83, -1);
        } else {
            text(c, s.score[team] + '/' + s.koGoal, cx - 92, 16, '#006020', 11, 'left', false);
            text(c, s.score[1 - team] + '/' + s.koGoal, cx + 92, 16, '#a00020', 11, 'right', false);
        }
        const fogIn = A.fogAt - s.t;
        const timeLabel = s.phase === 'live' ? (fogIn > 0 ? clock(fogIn) : 'FOG') : '';
        text(c, timeLabel, cx, 16, fogIn > 0 ? '#000' : '#a00000', 11, 'center', false);
        // the ritual
        const rit = (t, x, dir) => {
            const f = s.altar[t] / A.ritual;
            c.fillStyle = '#404040'; c.fillRect(x, 20, dir * 86, 5);
            c.fillStyle = t === team ? '#0df259' : '#e4485f';
            c.fillRect(x, 21, dir * 86 * f, 3);
        };
        rit(team, cx - 2, -1);
        rit(1 - team, cx + 2, 1);
        if (s.onAltar === team) text(c, g.mode > 1 ? 'your side is doing the ritual. hold the altar' : 'the ritual is going. hold the altar', cx, 40, '#0df259', 10, 'center');
        else if (s.onAltar === 1 - team) text(c, (g.mode > 1 ? 'they are' : enemies[0].name + ' is') + ' doing the ritual! get them off', cx, 40, '#ff6b6b', 10, 'center');
        else if (s.onAltar === 2) text(c, 'the altar is contested', cx, 40, '#ffe14d', 10, 'center');
        else if (s.fog < A.fogStart) text(c, 'the fog is closing. get to the altar', cx, 40, '#ffe14d', 10, 'center');

        // ---- them, top right ----
        if (enemies.length === 1) {
            const foe = enemies[0];
            const fw = clamp(W - (cx + 98) - 16, 90, 150), fx = W - fw - 8;
            text(c, foe.name, W - 8, 13, '#ff9aa8', 10, 'right');
            bar(c, fx, 17, fw, 6, foe.hp / A.maxHp, '#e4485f', '#3a0f18', true);
            if (foe.ward > 0) { c.fillStyle = '#bfe8ff'; const ww = min(1, foe.ward / 40) * fw; c.fillRect(fx + fw - ww, 17, ww, 2); }
            statusRow(c, foe, W - 8, 34, -1);
        } else {
            enemies.forEach((q, n) => {
                const y = 11 + n * 14;
                text(c, q.name.slice(0, 16), W - 8, y, q.dead ? '#806060' : '#ff9aa8', 8, 'right');
                bar(c, W - 78, y + 2, 70, 3, q.hp / A.maxHp, '#e4485f', '#3a0f18', true);
            });
        }
        // ---- your side, top left ----
        allies.forEach((q, n) => {
            const y = (g.touch ? 74 : 40) + n * 14;   // the menu button is up there on a phone
            text(c, q.name.slice(0, 16), 6, y, q.dead ? '#608060' : '#7dffa8', 8);
            bar(c, 6, y + 2, 70, 3, q.hp / A.maxHp, '#0df259', '#0a3018');
        });
        // ---- who got whom ----
        g.feed = g.feed.filter(e => (e.t -= dt) > 0);
        g.feed.forEach((e, n) => {
            c.globalAlpha = min(1, e.t);
            text(c, e.text, cx, 52 + n * 11, e.good ? '#7dffa8' : '#ff9aa8', 9, 'center');
            c.globalAlpha = 1;
        });

        // ---- you, bottom left ----
        const bx = 8, by = H - 34, bw2 = 150;
        text(c, Math.ceil(me.hp) + ' hp', bx, by - 4, '#ffb0b8', 11);
        bar(c, bx, by, bw2, 9, me.hp / A.maxHp, '#e4485f', '#3a0f18');
        if (me.ward > 0) { c.fillStyle = '#bfe8ff'; c.fillRect(bx, by, min(1, me.ward / 40) * bw2, 3); }
        bar(c, bx, by + 13, bw2, 7, me.ink / A.maxInk, '#4a7dff', '#101a3a');
        text(c, floor(me.ink) + ' ink', bx + bw2 + 6, by + 20, '#9fbaff', 10);
        statusRow(c, me, bx, by - 15, 1);
        if (me.dashCd > 0) { c.fillStyle = '#fff'; c.fillRect(bx, by + 24, bw2 * (1 - me.dashCd / A.dash.cd), 1); }

        // ---- the chamber, bottom middle ----
        // on a narrow phone the thumb buttons sit where this goes: it moves up over your hp
        const underThumbs = g.padLeft !== null && g.padLeft !== undefined && cx + 56 > g.padLeft - 4;
        const chX = underThumbs ? bx : cx - 56, chY = underThumbs ? by - 64 : H - 42;
        bevelBox(c, chX, chY, 112, 36, '#000040');
        if (me.chamber) {
            const sp = D.byId(me.chamber.s);
            c.drawImage(sigilImage(sp.id, 28, (D.EL[sp.el] || {}).color), chX + 4, chY + 4, 28, 28);
            text(c, sp.name, chX + 36, chY + 14, (D.EL[sp.el] || {}).color, 10);
            for (let k = 0; k < me.chamber.n; k++) { c.fillStyle = '#fff'; c.fillRect(chX + 36 + k * 8, chY + 20, 6, 8); }
        } else {
            text(c, 'staff', chX + 8, chY + 15, '#0df259', 11);
            text(c, g.touch ? 'tap ink to load' : 'E to load a spell', chX + 8, chY + 28, '#90b0a0', 9);
        }

        // ---- your eight, bottom right ----
        const per = g.aspect < 1 ? 4 : 8;
        const sz = g.aspect < 1 ? 26 : 26, gap = 2;
        const stripW = per * (sz + gap);
        const sx0 = W - stripW - 6, sy0 = g.aspect < 1 || g.touch ? max(46, 14 + enemies.length * 14) : H - sz - 6;
        g.loadout.forEach((id, i) => {
            const sp = D.byId(id);
            const row = floor(i / per), x = sx0 + (i % per) * (sz + gap), y = sy0 + row * (sz + gap);
            const cool = me.cd[id] || 0;
            const poor = !!S.canInscribe(s, g.me, sp) && !cool;
            c.fillStyle = g.guide === id ? '#3a2a60' : 'rgba(10,6,32,0.7)';
            c.fillRect(x, y, sz, sz);
            c.globalAlpha = cool ? 0.35 : poor ? 0.5 : 1;
            c.drawImage(sigilImage(id, sz, (D.EL[sp.el] || {}).color), x + 1, y + 1, sz - 2, sz - 2);
            c.globalAlpha = 1;
            if (!g.touch) text(c, String(i + 1), x + 1, y + 9, '#bcaddc', 8);
            if (cool) text(c, cool.toFixed(cool < 10 ? 1 : 0), x + sz / 2, y + sz / 2 + 3, '#ffe14d', 9, 'center');
            if (g.guide === id) { c.strokeStyle = '#ffe14d'; c.strokeRect(x + 0.5, y + 0.5, sz - 1, sz - 1); }
        });
        g.stripBox = { x: sx0, y: sy0, w: stripW, h: (sz + gap) * (per === 8 ? 1 : 2), per, sz, gap };

        // ---- the crosshair ----
        if (!g.stance && !me.dead && s.phase === 'live') {
            const aimP = S.aimPoint(s, g.me, 60);
            const onFoe = aimP.hit === 'foe';
            const col = onFoe ? '#ff4040' : '#ffffff';
            const y = H / 2, gapC = g.wantAim || g.touchAim ? 2 : 4;
            c.fillStyle = '#000';
            c.fillRect(cx - gapC - 5, y, 5, 2); c.fillRect(cx + gapC + 1, y, 5, 2); c.fillRect(cx, y - gapC - 5, 2, 5); c.fillRect(cx, y + gapC + 1, 2, 5);
            c.fillStyle = col;
            c.fillRect(cx - gapC - 5, y - 1, 5, 1); c.fillRect(cx + gapC + 1, y - 1, 5, 1); c.fillRect(cx - 1, y - gapC - 5, 1, 5); c.fillRect(cx - 1, y + gapC + 1, 1, 5);
            if (g.hitMark > 0) {
                c.fillStyle = '#ffe14d';
                for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) c.fillRect(cx + dx * 8, y + dy * 8, 3, 3);
            }
        }

        // ---- the ink stance ----
        if (g.stance) drawStance(g, c, W, H);

        // ---- words ----
        if (g.hintT > 0 && g.hint) {
            c.globalAlpha = min(1, g.hintT * 2.5);
            const col = g.hint.kind === 'bad' ? '#ff9aa8' : g.hint.kind === 'bot' ? '#ffe14d' : g.hint.kind === 'pick' ? '#9fe0ff' : '#0df259';
            // a long line under the thumbs is a line nobody reads: it goes above them
            const wide = g.hint.text.length * 7.2 / 2;
            const hy = g.padLeft !== null && g.padLeft !== undefined && cx + wide > g.padLeft - 4 ? min(H - 52, g.padTop - 10) : H - 52;
            text(c, g.hint.text, cx, hy, col, 12, 'center');
            c.globalAlpha = 1;
        }
        if (g.bannerT > 0 && g.banner) {
            c.globalAlpha = min(1, g.bannerT * 2);
            text(c, g.banner.text, cx, H / 2 - 46, g.banner.color, 26, 'center');
            c.globalAlpha = 1;
        }
        if (s.phase === 'countdown') {
            const n = Math.ceil(s.phaseT);
            text(c, n > 0 ? String(n) : 'DUEL', cx, H / 2 - 20, '#ffe14d', 54, 'center');
            text(c, g.touch ? 'left thumb walks. right thumb looks. the ink button draws.' : 'wasd walks. mouse looks. E draws a sigil, click fires it.', cx, H / 2 + 10, '#fff', 12, 'center');
            text(c, g.mode + ' v ' + g.mode + ' on ' + D.mapById(g.map).name + '. first to ' + s.koGoal + ' knockouts, or hold the altar', cx, H / 2 + 26, '#ffe14d', 10, 'center');
        }
        if (me.dead && s.phase === 'live') {
            text(c, 'back in ' + max(1, Math.ceil(me.respawn)), cx, H / 2 + 6, '#fff', 22, 'center');
        }
        if (g.netDown) {
            c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, H / 2 - 22, W, 44);
            text(c, 'your opponent vanished', cx, H / 2 + 5, '#ff9aa8', 16, 'center');
        }
        if (g.showFps) text(c, round(g.lastFps || 0) + ' fps', 4, 12, '#0df259', 9);
    }
    function statusRow(c, w, x, y, dir) {
        let n = 0;
        for (const k of Object.keys(w.st)) {
            const d = D.STATUS[k];
            if (!d) continue;
            const px = x + dir * n * 34 - (dir < 0 ? 32 : 0);
            c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(px, y - 8, 32, 10);
            text(c, d.short, px + 1, y, d.color, 8, 'left', false);
            n++;
            if (n >= 5) break;
        }
    }
    function drawStance(g, c, W, H) {
        const cx = W / 2, cy = H / 2, r = min(W, H) * 0.42;
        c.fillStyle = 'rgba(8,6,40,0.42)';
        c.fillRect(0, 0, W, H);
        c.strokeStyle = 'rgba(13,242,89,0.35)';
        c.lineWidth = 1;
        c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke();
        // a guide, if you asked for one
        const sp = D.byId(g.guide);
        if (sp) {
            const size = r * 1.5, x0 = cx - size / 2, y0 = cy - size / 2;
            c.strokeStyle = (D.EL[sp.el] || {}).color;
            c.globalAlpha = 0.45;
            c.lineWidth = 3;
            c.setLineDash([5, 5]);
            sp.glyph.forEach(st => {
                c.beginPath();
                st.forEach((p, i) => { const xx = x0 + p.x * size / 100, yy = y0 + p.y * size / 100; i ? c.lineTo(xx, yy) : c.moveTo(xx, yy); });
                c.stroke();
            });
            c.setLineDash([]);
            c.globalAlpha = 0.9;
            sp.glyph.forEach((st, i) => {
                const p = st[0];
                text(c, String(i + 1), x0 + p.x * size / 100 - 4, y0 + p.y * size / 100 - 4, '#ffe14d', 11);
            });
            c.globalAlpha = 1;
        }
        // the ink
        c.lineCap = 'round'; c.lineJoin = 'round';
        const drawLine = (w, col) => {
            c.strokeStyle = col; c.lineWidth = w;
            g.strokes.forEach(st => {
                if (st.length < 2) return;
                c.beginPath();
                c.moveTo(st[0].x, st[0].y);
                for (let i = 1; i < st.length; i++) c.lineTo(st[i].x, st[i].y);
                c.stroke();
            });
        };
        drawLine(5, 'rgba(13,242,89,0.3)');
        drawLine(2, '#baffd0');
        // the pen, because there is no cursor while the mouse is locked
        if (!g.touchMode) {
            c.fillStyle = g.penDown ? '#0df259' : '#ffffff';
            c.fillRect(g.pen.x - 1, g.pen.y - 6, 2, 12); c.fillRect(g.pen.x - 6, g.pen.y - 1, 12, 2);
        }
        const me = g.s.wiz[g.me];
        const label = sp ? 'trace ' + sp.name : (g.touch ? 'draw with your right thumb' : 'hold left click to draw. E or right click to stop');
        text(c, label, cx, 56, '#baffd0', 11, 'center');
        if (me.chamber) text(c, 'this replaces your ' + D.byId(me.chamber.s).name, cx, cy + r + 13 > H - 44 ? H - 46 : cy + r + 13, '#ffe14d', 10, 'center');
        if (g.manualCast && g.strokes.length) text(c, 'enter to cast', cx, cy + r - 2, '#fff', 10, 'center');
    }

    // ===============================================================
    // sizing: low resolution on purpose, whatever the window is
    // ===============================================================
    const LINES = 240;
    // A tablet or a phone held sideways is a handheld console, not a desktop: the
    // match takes the whole screen, with no title bar, taskbar or desktop around
    // it. Held upright again, it goes back in its window. The site's own css
    // fullscreen does it, since the real one needs a tap and a rotation is not one.
    // Leave it with the button and it stays left, until the next turn of the screen.
    // What it knows lives on the window, so it carries from one match to the next.
    function sideways() {
        const win = winRef && winRef.win;
        if (!win || typeof enterFauxFullscreen !== 'function') return;
        const land = window.innerWidth > window.innerHeight;
        const touchy = G ? G.touch : IS_TOUCH();
        const ours = typeof fauxFullscreenWin !== 'undefined' && fauxFullscreenWin === win;
        if (win._wzLand !== land) { win._wzLand = land; win._wzDeclined = false; }
        // it was put there by turning the screen, and somebody took it back out
        if (win._wzAutoFs && !win.classList.contains('fs-active')) { win._wzAutoFs = false; win._wzDeclined = true; }
        if (land && touchy && G && !win._wzDeclined && !win.classList.contains('fs-active')
            && !(typeof fullscreenWindow === 'function' && fullscreenWindow())) {
            enterFauxFullscreen(win);
            win._wzAutoFs = true;
            if (G) { G.fitAt = 0; G.stageW = 0; }
        } else if (!land && win._wzAutoFs && ours) {
            win._wzAutoFs = false;
            exitFauxFullscreen();
            if (G) { G.fitAt = 0; G.stageW = 0; }
        }
        if (touchy) keepOnScreen(win);
    }
    // a window placed for the screen sideways is too far right for it upright: fire
    // and jump hung off the edge after a turn. Narrower if it has to be, then back in.
    function keepOnScreen(win) {
        if (win.classList.contains('fs-active') || win.classList.contains('maximized')) return;
        const vw = document.documentElement.clientWidth || window.innerWidth;
        const r = win.getBoundingClientRect();
        if (r.right <= vw + 1 && r.left >= -1) return;
        const w = Math.min(r.width, vw - 20);
        win.style.width = w + 'px';
        win.style.left = Math.max(10, Math.min(r.left, vw - w - 10)) + 'px';
        if (G) { G.fitAt = 0; G.stageW = 0; }
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
        // the desktop pads a fullscreen window's body, and that is not ours to fill
        const cs = getComputedStyle(body);
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const w = max(120, body.clientWidth - padX);
        let h;
        if (fs) h = max(120, body.clientHeight - padY);
        else {
            const room = vh - max(0, rect.top) - 6;
            h = clamp(w * 9 / 16, 120, room);
            // a phone held upright can have a taller stage than 16:9, and it wants one
            if (w < 520 && vh > w) h = clamp(w * 1.25, 120, room);
        }
        h = floor(h);
        if (g.stageW === w && g.stageH === h && g.hudW === wantHudW(g, w) && g.cv.style.width === w + 'px' && g.cv.style.height === h + 'px' && g.hud.style.width === w + 'px' && g.hud.style.height === h + 'px') return;
        g.stageW = w; g.stageH = h;
        stage.style.height = h + 'px';
        stage.style.width = w + 'px';
        const aspect = w / h;
        g.aspect = aspect;
        // 240 lines tall, or 240 across if it is taller than wide
        const rw = aspect >= 1 ? round(LINES * aspect) : LINES;
        const rh = aspect >= 1 ? LINES : round(LINES / aspect);
        g.R.resize(rw, rh);
        g.cv.style.width = w + 'px';
        g.cv.style.height = h + 'px';
        g.hudW = wantHudW(g, w);
        g.hudH = round(g.hudW / aspect);
        g.hud.width = g.hudW;
        g.hud.height = g.hudH;
        g.hud.style.width = w + 'px';
        g.hud.style.height = h + 'px';
        g.pen.y = min(g.pen.y, g.hudH);
        g.pen.x = min(g.pen.x, g.hudW);
        measurePad(g);
        // maximize and fullscreen are buttons on this window, and they keep the keyboard
        const active = document.activeElement;
        if (winRef && !root.contains(active) && (active === document.body || winRef.win.contains(active))) focusGame(g);
    }

    // ===============================================================
    // what sits on top: touch buttons and the paper dialogs
    // ===============================================================
    // where the thumb buttons are, in hud units, so the hud can keep out from under them
    function measurePad(g) {
        g.padTop = null; g.padLeft = null;
        if (!g.touch || !g.touchEl || !g.stage) return;
        const st = g.stage.getBoundingClientRect();
        if (!st.width || !st.height) return;
        let top = Infinity, left = Infinity;
        g.touchEl.querySelectorAll('.wz-t:not(.wz-t-menu)').forEach(b => {
            const r = b.getBoundingClientRect();
            if (!r.width) return;
            top = min(top, r.top - st.top); left = min(left, r.left - st.left);
        });
        if (top === Infinity) return;
        g.padTop = top * g.hudH / st.height;
        g.padLeft = left * hudW(g) / st.width;
    }
    function paintTouch(g) {
        const el = g && g.touchEl;
        if (!el) return;
        el.style.display = g.touch ? '' : 'none';
        if (g.touch !== g.padFor) { g.padFor = g.touch; g.stageW = 0; }
        const small = g.stage && g.stage.querySelector('#wz-menubtn');
        if (small) small.style.display = g.touch ? 'none' : '';
        const ink = el.querySelector('#wz-t-ink');
        if (ink) { ink.classList.toggle('on', !!g.stance); ink.textContent = g.stance ? 'stop' : 'ink'; }
        const aim = el.querySelector('#wz-t-aim');
        if (aim) aim.classList.toggle('on', !!g.touchAim);
    }
    function renderTouchKnobs(g) {
        const k = g.knob;
        if (!k) return;
        if (g.stick.id === null) { k.style.display = 'none'; return; }
        const r = g.stage.getBoundingClientRect();
        k.style.display = '';
        k.style.left = (g.stick.ox - r.left) + 'px';
        k.style.top = (g.stick.oy - r.top) + 'px';
        const n = k.firstElementChild;
        if (n) n.style.transform = 'translate(' + (g.stick.x * 36) + 'px,' + (g.stick.y * 36) + 'px)';
    }
    function hideOverlay() { const o = G && G.overlay; if (o) { o.style.display = 'none'; o.innerHTML = ''; } }
    function paintOverlay(g) {
        const o = g.overlay;
        if (!o) return;
        const canvasOk = !!g.R;
        if (!canvasOk) return;
        if (g.ended) { renderEnd(g); return; }
        const panel = html => { o.style.display = ''; o.innerHTML = '<div class="wz-dialog">' + html + '</div>'; return o; };
        const menuButtons = `
            <button class="wz-btn wz-wide" data-go="book">grimoire</button>
            <button class="wz-btn wz-wide" data-go="load">your eight spells</button>
            <button class="wz-btn wz-wide" data-go="set">settings</button>
            <button class="wz-btn wz-wide" data-go="help">how to play</button>
            <button class="wz-btn wz-wide" data-go="quit">leave the match</button>`;
        const wire = () => {
            o.querySelectorAll('[data-go]').forEach(b => {
                const go = b.dataset.go;
                b.onclick = e => {
                    e.stopPropagation();
                    if (go === 'book') openGrimoire();
                    if (go === 'load') openLoadout();
                    if (go === 'set') openSettings();
                    if (go === 'help') openHelp();
                    if (go === 'quit') { if (g.session && !g.solo && g.session.alive) g.session.leave(); openMenu(); }
                    if (go === 'resume') { if (g.solo) pause(g, false); g.menuOpen = false; paintOverlay(g); if (!g.touchMode && !isLocked(g)) askLock(g); }
                };
            });
        };
        if (g.paused) {
            panel(`<div class="wz-dialog-title">paused</div>
                <p>${g.pauseWhy === 'mouse' ? 'you let go of the mouse.' : 'take your time bradar.'}</p>
                <button class="wz-btn wz-go wz-wide" id="wz-resume" data-go="resume">carry on</button>${menuButtons}`);
            wire();
            return;
        }
        if (g.menuOpen) {
            panel(`<div class="wz-dialog-title">menu</div>
                <p>this does not stop the match bradar. it is still going.</p>
                <button class="wz-btn wz-go wz-wide" data-go="resume">back to it</button>${menuButtons}`);
            wire();
            return;
        }
        if (g.netDown) {
            panel(`<div class="wz-dialog-title">the line went quiet</div>
                <p>your opponent vanished. if they come back this carries on from here.</p>
                <button class="wz-btn wz-wide" data-go="quit">leave the match</button>`);
            wire();
            return;
        }
        if (!g.touchMode && !g.touch && !g.noLock && !isLocked(g) && g.s.phase !== 'matchover') {
            // nothing else tells you the window wants a click
            o.style.display = '';
            o.innerHTML = '<button class="wz-clicktoplay" id="wz-click">click to take the mouse. esc lets go.</button>';
            const b = o.querySelector('#wz-click');
            if (b) b.onclick = () => { askLock(g); focusGame(g); };
            return;
        }
        hideOverlay();
    }

    function endMatch(g) {
        g.ended = true;
        clearStance(g);
        g.wantFire = false;
        if (isLocked(g) && document.exitPointerLock) document.exitPointerLock();
        const s = g.s;
        if (s.over === g.myTeam) {
            SFX.win();
            if (typeof unlockAchievement === 'function') unlockAchievement('wizardz_win');
            if (g.solo) botLine(g, 'lose');
        } else if (g.solo) botLine(g, 'win');
        renderEnd(g);
    }
    function renderEnd(g) {
        const s = g.s, o = g.overlay;
        if (!o) return;
        const won = s.over === g.myTeam;
        const duel = g.mode === 1;
        const how = {
            ko: (won ? '' : 'against: ') + s.koGoal + ' knockouts' + (won ? ', bradar' : ''),
            ritual: won ? (duel ? 'you' : 'your side') + ' finished the ritual' : (duel ? s.wiz[1 - g.me].name : 'they') + ' finished the ritual',
            time: 'the fog ended it. most knockouts wins',
            resign: won ? 'they gave up' : 'you gave up'
        }[s.reason] || '';
        const line = duel
            ? escapeHtml(s.wiz[0].name) + ' ' + s.score[0] + ' - ' + s.score[1] + ' ' + escapeHtml(s.wiz[1].name)
            : 'your side ' + s.score[g.myTeam] + ' - ' + s.score[1 - g.myTeam] + ' their side';
        const title = s.over < 0 ? 'nobody wins' : won ? 'YOU WIN' : 'YOU LOSE';
        const canAgain = g.isHost;
        o.style.display = '';
        o.innerHTML = `<div class="wz-dialog wz-end">
            <div class="wz-dialog-title">${title}</div>
            <p>${escapeHtml(how)}</p>
            <p>${line}</p>
            ${g.theyWantRematch && !g.solo ? '<p>they want another one.</p>' : ''}
            ${canAgain
                ? '<button class="wz-btn wz-go wz-wide" id="wz-rematch">rematch</button>'
                : `<button class="wz-btn wz-go wz-wide" id="wz-rematch-ask">${g.wantRematch ? 'waiting for the host...' : 'ask for a rematch'}</button>`}
            <button class="wz-btn wz-wide" id="wz-quit">leave</button>
        </div>`;
        const again = o.querySelector('#wz-rematch');
        if (again) again.onclick = () => restartMatch(g);
        const ask = o.querySelector('#wz-rematch-ask');
        if (ask) ask.onclick = () => { g.wantRematch = true; netSend(g, 'wz:rematch', {}); renderEnd(g); };
        o.querySelector('#wz-quit').onclick = () => {
            if (g.session && !g.solo && g.session.alive) g.session.leave();
            openMenu();
        };
    }

    // ===============================================================
    // the window
    // ===============================================================
    function ensureWindow(title) {
        if (winRef && document.getElementById(winRef.id)) return winRef;
        const vw = typeof viewportWidth === 'function' ? viewportWidth() : 1000;
        winRef = createAppWindow(title || 'wizardz 98', { icon: 'auto_fix_high', width: min(1000, vw - 20) });
        winRef.id = winRef.id || winRef.win.id;
        winRef.body.classList.add('wz-body');
        if (document.documentElement.clientHeight < 500) winRef.win.style.top = '0px';
        else if (document.documentElement.clientHeight < 900) winRef.win.style.top = '44px';
        // a rotation can land on a menu as well as on a match
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
    // the grimoire, the loadout, settings and help are windows of their own. With the
    // match taking the screen they opened underneath it, where nobody could see them,
    // so while it does they go on top. A tap on a window raises it with an inline
    // z-index, which is why the css for this is !important.
    function subWindow(title, opts) {
        const w = createAppWindow(title, opts);
        if (winRef && winRef.win.classList.contains('fs-active')) w.win.classList.add('wz-over-fs');
        return w;
    }
    function tearDown() {
        stopLoop();
        if (G) {
            if (G._unbind) G._unbind();
            if (G._netOffs) G._netOffs.forEach(off => off());
            if (G.session && !G.solo && G.session.alive) G.session.leave();
            if (G.R && G.R.gl) { const lose = G.R.gl.getExtension && G.R.gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); }
        }
        G = null;
    }

    function startDuel(session, opts) {
        ensureWindow('wizardz 98');
        stopLoop();
        if (G && G._unbind) G._unbind();
        if (G && G._netOffs) G._netOffs.forEach(off => off());
        if (G && G.session && G.session !== session && !G.solo && G.session.alive) G.session.leave();
        if (G && G.R && G.R.gl) { const lose = G.R.gl.getExtension && G.R.gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); }
        G = makeGame(session, opts || {});
        const g = G;
        root.classList.add('wz-playing');
        root.innerHTML = `
            <div class="wz-stage" id="wz-stage">
                <canvas id="wz-canvas" class="wz-canvas" data-fit="self" tabindex="0" aria-label="The arena. W A S D walks, the mouse looks, E starts drawing a sigil, click fires, right click aims, space jumps, shift dashes."></canvas>
                <canvas id="wz-hud" class="wz-hud" data-fit="self" aria-hidden="true"></canvas>
                <div id="wz-touch" class="wz-touch" style="display:none">
                    <button type="button" class="wz-t wz-t-fire" id="wz-t-fire" aria-label="fire">fire</button>
                    <button type="button" class="wz-t wz-t-ink" id="wz-t-ink" aria-label="draw a sigil">ink</button>
                    <button type="button" class="wz-t wz-t-jump" id="wz-t-jump" aria-label="jump">jump</button>
                    <button type="button" class="wz-t wz-t-dash" id="wz-t-dash" aria-label="dash">dash</button>
                    <button type="button" class="wz-t wz-t-aim" id="wz-t-aim" aria-label="aim">aim</button>
                    <button type="button" class="wz-t wz-t-menu" id="wz-t-menu" aria-label="menu">≡</button>
                    <div class="wz-knob" id="wz-knob" style="display:none"><span></span></div>
                </div>
                <button type="button" class="wz-menubtn" id="wz-menubtn" title="menu (P or esc)">≡</button>
                <div id="wz-overlay" class="wz-overlay" style="display:none"></div>
            </div>`;
        g.stage = root.querySelector('#wz-stage');
        g.cv = root.querySelector('#wz-canvas');
        g.hud = root.querySelector('#wz-hud');
        g.hctx = g.hud.getContext('2d');
        g.overlay = root.querySelector('#wz-overlay');
        g.touchEl = root.querySelector('#wz-touch');
        g.knob = root.querySelector('#wz-knob');
        g.R = GL.create(g.cv);
        if (!g.R) {
            root.classList.remove('wz-playing');
            root.innerHTML = `<div class="wz-menu"><div class="wz-title">no 3d, bradar</div>
                <div class="wz-sub">this browser would not give wizardz a webgl canvas, so there is nothing to draw the arena on.
                turn hardware acceleration back on, or try another browser. the grimoire still works.</div>
                <button class="wz-btn wz-wide" id="wz-nogl-book">grimoire</button>
                <button class="wz-btn wz-wide" id="wz-nogl-back">back</button></div>`;
            root.querySelector('#wz-nogl-book').onclick = () => openGrimoire();
            root.querySelector('#wz-nogl-back').onclick = () => openMenu();
            if (session && !session.solo && session.alive) session.leave();
            G = null;
            return;
        }
        fit(g);
        bindInput(g);
        bindNet(g);
        bindTouchButtons(g);
        g.cv.addEventListener('webglcontextlost', e => { e.preventDefault(); });
        g.cv.addEventListener('webglcontextrestored', () => { if (G === g) { g.R = GL.create(g.cv); g.fitAt = 0; g.stageW = 0; } });
        paintTouch(g);
        paintOverlay(g);
        root.querySelector('#wz-menubtn').onclick = e => {
            e.stopPropagation();
            if (g.solo) pause(g, !g.paused, 'menu');
            else toggleMenu(g);
        };
        focusGame(g);
        lastT = performance.now();
        raf = requestAnimationFrame(loop);
        if (typeof unlockAchievement === 'function') unlockAchievement('wizardz');
    }
    function bindTouchButtons(g) {
        const el = g.touchEl;
        const stop = e => { e.stopPropagation(); e.preventDefault(); };
        const hold = (id, on, off) => {
            const b = el.querySelector(id);
            b.addEventListener('pointerdown', e => { stop(e); g.touchMode = true; g.touch = true; try { b.setPointerCapture(e.pointerId); } catch (x) { } on(); });
            const release = e => { stop(e); if (off) off(); };
            b.addEventListener('pointerup', release);
            b.addEventListener('pointercancel', release);
        };
        hold('#wz-t-fire', () => { if (!g.stance) { g.wantFire = true; g.fireQ = true; } }, () => { g.wantFire = false; });
        hold('#wz-t-ink', () => { toggleStance(g); });
        hold('#wz-t-jump', () => { g.jumpQ = true; });
        hold('#wz-t-dash', () => { g.dashQ = true; });
        hold('#wz-t-aim', () => { g.touchAim = !g.touchAim; paintTouch(g); });
        hold('#wz-t-menu', () => { if (g.solo) pause(g, !g.paused, 'menu'); else toggleMenu(g); });
    }

    // ---------------------------------------------------------------
    // a sigil on a small canvas, for the book and the hud
    // ---------------------------------------------------------------
    function paintSigil(canvas, spell, opts) {
        if (!canvas || !spell) return;
        const c = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const pad = (opts && opts.pad) || 5;
        c.clearRect(0, 0, w, h);
        const s = min(w, h) - pad * 2;
        c.save();
        c.translate(pad + (w - pad * 2 - s) / 2, pad + (h - pad * 2 - s) / 2);
        c.scale(s / 100, s / 100);
        c.strokeStyle = (opts && opts.color) || (D.EL[spell.el] || {}).color || '#fff';
        c.lineWidth = (opts && opts.width) || 6;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        const upTo = opts && opts.progress !== undefined ? opts.progress : 1;
        const total = spell.glyph.reduce((a, st) => a + st.length, 0);
        let drawn = 0;
        spell.glyph.forEach(st => {
            c.beginPath();
            for (let i = 0; i < st.length; i++) {
                if (drawn / total > upTo) break;
                drawn++;
                if (i === 0) c.moveTo(st[i].x, st[i].y); else c.lineTo(st[i].x, st[i].y);
            }
            c.stroke();
        });
        if (opts && opts.numbers) {
            c.fillStyle = '#ffe14d';
            c.font = 'bold 11px "Courier New", monospace';
            c.textAlign = 'center';
            spell.glyph.forEach((st, i) => { c.fillText(String(i + 1), st[0].x, st[0].y - 3); });
        }
        c.restore();
    }

    // ===============================================================
    // screens
    // ===============================================================
    function leaveMatch() {
        stopLoop();
        if (G && G._unbind) G._unbind();
        if (G && G._netOffs) G._netOffs.forEach(off => off());
        if (G && G.session && !G.solo && G.session.alive) G.session.leave();
        if (G && G.R && G.R.gl) { const lose = G.R.gl.getExtension && G.R.gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); }
        G = null;
        if (root) root.classList.remove('wz-playing');
    }
    function spinPortrait(cv, avatar, opt) {
        let ok = true;
        const t0 = performance.now();
        let last = 0;
        const spin = now => {
            if (!ok || !document.body.contains(cv)) return;
            if (now - last > 66) {
                last = now;
                const t = (performance.now() - t0) / 1000;
                const a = typeof avatar === 'function' ? avatar() : avatar;
                if (!GL.paintPortrait(cv, a, t, Object.assign({ angle: 0.6 + sin(t * 0.6) * 0.5 }, opt || {}))) { ok = false; return; }
            }
            requestAnimationFrame(spin);
        };
        requestAnimationFrame(spin);
    }
    function openMenu() {
        ensureWindow('wizardz 98');
        leaveMatch();
        const av = myAvatar();
        const lo = myLoadout();
        root.innerHTML = `
            <div class="wz-menu">
                <div class="wz-title">wizardz 98</div>
                <div class="wz-sub">a third person shooter where the only way to load your staff is to draw on the air, bradar.</div>
                <div class="wz-menu-grid">
                    <div class="wz-menu-side">
                        <canvas id="wz-me" width="180" height="210"></canvas>
                        <div class="wz-me-name" id="wz-me-name"></div>
                        <button class="wz-btn wz-wide" id="wz-edit">customise wizard</button>
                    </div>
                    <div class="wz-menu-main">
                        <button class="wz-btn wz-go wz-wide" id="wz-mp">play people — invite code</button>
                        <button class="wz-btn wz-go wz-wide" id="wz-solo">play bots — pick an opponent</button>
                        <button class="wz-btn wz-wide" id="wz-quick">quick match against random bots</button>
                        <div class="wz-row">
                            <label for="wz-modepick">teams</label>
                            <select id="wz-modepick" class="wz-input">
                                ${A.modes.map(m => '<option value="' + m + '">' + m + ' v ' + m + '</option>').join('')}
                            </select>
                            <label for="wz-mappick">map</label>
                            <select id="wz-mappick" class="wz-input">
                                ${D.MAPS.map(m => '<option value="' + m.id + '">' + escapeHtml(m.name) + '</option>').join('')}
                            </select>
                            <label for="wz-diff">difficulty</label>
                            <select id="wz-diff" class="wz-input">
                                <option value="easy">easy</option>
                                <option value="normal">normal</option>
                                <option value="hard">hard</option>
                            </select>
                        </div>
                        <div class="wz-hint" id="wz-mapnote"></div>
                        <button class="wz-btn wz-wide" id="wz-load2">your eight spells — and ready made ones</button>
                        <div class="wz-row wz-idrow">
                            <label for="wz-loid">loadout id</label>
                            <input id="wz-loid" class="wz-input wz-idbox" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="wz-lomsg">
                        </div>
                        <div class="wz-hint" id="wz-lomsg" aria-live="polite"></div>
                        <button class="wz-btn wz-wide" id="wz-book2">grimoire — all 50 sigils</button>
                        <button class="wz-btn wz-wide" id="wz-help">how to play</button>
                        <button class="wz-btn wz-wide" id="wz-set">settings</button>
                        <div class="wz-mini-strip" id="wz-mini-strip" aria-label="what you are carrying"></div>
                    </div>
                </div>
            </div>`;
        const meCv = root.querySelector('#wz-me');
        const nameEl = root.querySelector('#wz-me-name');
        const prof = window.Netplay ? Netplay.profile() : { name: 'you' };
        nameEl.textContent = prof.name + ' — ' + (av.title || 'apprentice');
        spinPortrait(meCv, av, { bg: [0, 0.5, 0.5] });
        const strip = root.querySelector('#wz-mini-strip');
        const paintStrip = l => {
            strip.innerHTML = l.map(id => `<canvas width="34" height="34" title="${escapeHtml(D.byId(id).name)}" data-sigil="${id}"></canvas>`).join('');
            strip.querySelectorAll('canvas').forEach(c => paintSigil(c, D.byId(c.dataset.sigil), { width: 8 }));
        };
        paintStrip(lo);
        const idBox = wireLoadoutBox(root.querySelector('#wz-loid'), root.querySelector('#wz-lomsg'), l => { paintStrip(l); if (windowLoadout) windowLoadout(l); });
        menuLoadout = l => { idBox.show(l); paintStrip(l); };
        const diff = root.querySelector('#wz-diff');
        diff.value = difficulty();
        diff.onchange = () => savePreference(LS.diff, diff.value);
        const modePick = root.querySelector('#wz-modepick'), mapPick = root.querySelector('#wz-mappick'), note = root.querySelector('#wz-mapnote');
        modePick.value = String(chosenMode());
        mapPick.value = chosenMap();
        const paintNote = () => { note.textContent = D.mapById(mapPick.value).blurb; };
        paintNote();
        modePick.onchange = () => savePreference(LS.mode, modePick.value);
        mapPick.onchange = () => { savePreference(LS.map, mapPick.value); paintNote(); };
        root.querySelector('#wz-edit').onclick = () => openAvatarEditor();
        root.querySelector('#wz-book2').onclick = () => openGrimoire();
        root.querySelector('#wz-load2').onclick = () => openLoadout();
        root.querySelector('#wz-help').onclick = () => openHelp();
        root.querySelector('#wz-set').onclick = () => openSettings();
        root.querySelector('#wz-solo').onclick = () => openBotPicker();
        root.querySelector('#wz-quick').onclick = () => startBotDuel();
        root.querySelector('#wz-mp').onclick = () => {
            if (window.Netplay) Netplay.openLobby({ gameId: 'wizardz' });
            else showToast('wizardz', 'netplay is not loaded');
        };
    }
    function startBotDuel(botId, extra) {
        const s = window.Netplay ? Netplay.soloSession('wizardz') : null;
        ensureWindow('wizardz 98');
        startDuel(s, Object.assign({ solo: true, botId }, extra || {}));
    }
    function openBotPicker() {
        ensureWindow('wizardz 98');
        leaveMatch();
        const tierColor = { easy: '#7ee06a', normal: '#ffe14d', hard: '#e4485f' };
        const elColor = el => (D.EL[el] || {}).color || '#fff';
        root.innerHTML = `
            <div class="wz-menu">
                <div class="wz-title">1 v bot</div>
                <div class="wz-sub">pick something to fight. they all cheat in different directions.</div>
                <div class="wz-row">
                    <label for="wz-diff3">difficulty</label>
                    <select id="wz-diff3" class="wz-input">
                        <option value="easy">easy — slower hands</option>
                        <option value="normal">normal — as written</option>
                        <option value="hard">hard — faster, dodgier, better aim</option>
                    </select>
                </div>
                <div class="wz-bots">
                    ${D.BOTS.map(b => `
                        <button class="wz-bot" data-bot="${escapeHtml(b.id)}">
                            <canvas width="100" height="118" data-botav="${escapeHtml(b.id)}"></canvas>
                            <div class="wz-bot-name">${escapeHtml(b.name)}</div>
                            <div class="wz-bot-title">${escapeHtml(b.title)}</div>
                            <div class="wz-bot-tier" style="color:${tierColor[b.tier] || '#fff'}">${escapeHtml(b.tier)}</div>
                            <div class="wz-bot-blurb">${escapeHtml(b.blurb)}</div>
                            <div class="wz-bot-els">${(b.style.els || []).map(e => `<span style="color:${elColor(e)}">${escapeHtml(e)}</span>`).join(' · ')}</div>
                        </button>`).join('')}
                </div>
                <div class="wz-foot">
                    <button class="wz-btn" id="wz-bot-random">surprise me</button>
                    <button class="wz-btn" id="wz-bot-back">back</button>
                </div>
            </div>`;
        const diff = root.querySelector('#wz-diff3');
        diff.value = difficulty();
        diff.onchange = () => savePreference(LS.diff, diff.value);
        // six little stages, painted once. Nobody needs them spinning at once
        root.querySelectorAll('canvas[data-botav]').forEach(cv2 => {
            const b = D.botById(cv2.dataset.botav);
            GL.paintPortrait(cv2, normAvatar(b.avatar), 1, { angle: 0.5, bg: [0.09, 0.05, 0.17] });
        });
        root.querySelectorAll('.wz-bot').forEach(b => { b.onclick = () => startBotDuel(b.dataset.bot); });
        root.querySelector('#wz-bot-random').onclick = () => startBotDuel();
        root.querySelector('#wz-bot-back').onclick = () => openMenu();
    }

    const KIND_WORDS = {
        shot: 'loads your staff: shots', beam: 'loads your staff: an instant beam', strike: 'loads your staff: falls from above',
        wall: 'loads your staff: stands where you point', zone: 'loads your staff: a patch of ground', trap: 'loads your staff: waits on the floor',
        summon: 'loads your staff: a decoy', nova: 'goes off at once, round you', self: 'goes off at once, on you', move: 'goes off at once, moves you'
    };
    function openHelp() {
        pause(G, true, 'menu');
        const { body } = subWindow('how to play wizardz', { icon: 'auto_stories', width: 480 });
        body.classList.add('wz-book');
        body.innerHTML = `<div class="wz-help">
            <h3>the idea</h3>
            <p>a sigil is a reload. press <b>E</b>, draw, and whatever you drew goes in your staff.
            click to fire it where the crosshair points. out of spells, the staff still fires a weak free shot, and every hit earns ink back.</p>
            <p>while you draw you can only shuffle, you cannot shoot, and you take a fifth more damage.
            but anything of theirs that flies near you slows right down. duck behind something first, bradar.</p>
            <h3>winning</h3>
            <p><b>knockouts</b> (three in a 1 v 1, twelve in a 4 v 4), or <b>the ritual</b>: your side alone on the altar in the middle for ${A.ritual} seconds in total.
            after ${A.fogAt} seconds the fog closes in on the altar and hurts anyone outside it.</p>
            <h3>the mouse and the keys</h3>
            <table class="wz-keys">
                <tr><td>wasd</td><td>walk</td></tr>
                <tr><td>mouse</td><td>look</td></tr>
                <tr><td>left click</td><td>fire</td></tr>
                <tr><td>right click</td><td>aim, over the shoulder</td></tr>
                <tr><td>space</td><td>jump (clears the ink while drawing)</td></tr>
                <tr><td>shift</td><td>dash</td></tr>
                <tr><td>e</td><td>start drawing, or stop</td></tr>
                <tr><td>1 to 8</td><td>show a tracing guide while drawing</td></tr>
                <tr><td>esc or p</td><td>let go of the mouse, menu</td></tr>
            </table>
            <h3>on a phone</h3>
            <p>left thumb walks, right thumb looks. the ink button starts a drawing and your right thumb is the pen, while your left one keeps walking.</p>
            <h3>teams and maps</h3>
            <p>up to four a side, and bots fill any seat nobody is in. nothing of yours can hurt your own side, and your shots go through their walls too.
            if somebody drops out, a bot takes the seat. each map plays differently: pick one on the menu, or in the lobby if you are hosting.</p>
            <h3>the sigils</h3>
            <p>stroke order, direction, size and angle do not matter. upside down is fine. draw it big, and clean ones hit harder.
            you carry eight into a match, and only those can be cast.</p>
        </div>`;
    }
    function openSettings() {
        pause(G, true, 'menu');
        const { body } = subWindow('wizardz settings', { icon: 'settings', width: 340 });
        body.classList.add('wz-book');
        const cur = settings();
        const manual = preference(LS.manual, 'false') === 'true';
        body.innerHTML = `<div class="wz-help">
            <label class="wz-row" for="wz-sens">mouse speed <input id="wz-sens" type="range" min="0.2" max="3" step="0.05" value="${cur.sens}"></label>
            <label class="wz-row"><input id="wz-inv" type="checkbox" ${cur.invert ? 'checked' : ''}> invert up and down</label>
            <label class="wz-row"><input id="wz-assist" type="checkbox" ${cur.assist ? 'checked' : ''}> aim assist with thumbs: a light pull towards whoever is near the crosshair</label>
            <label class="wz-row"><input id="wz-man" type="checkbox" ${manual ? 'checked' : ''}> manual cast: wait for enter instead of reading the ink when you stop</label>
            <label class="wz-row"><input id="wz-fps" type="checkbox" ${G && G.showFps ? 'checked' : ''}> show frames per second</label>
        </div>`;
        const save = () => {
            const s = { sens: Number(body.querySelector('#wz-sens').value), invert: body.querySelector('#wz-inv').checked, assist: body.querySelector('#wz-assist').checked };
            savePreference(LS.settings, JSON.stringify(s));
            const m = body.querySelector('#wz-man').checked;
            savePreference(LS.manual, String(m));
            if (G) { G.settings = settings(); G.manualCast = m; G.showFps = body.querySelector('#wz-fps').checked; }
        };
        body.querySelectorAll('input').forEach(i => { i.onchange = save; i.oninput = save; });
    }
    function openGrimoire() {
        pause(G, true, 'menu');
        const { body } = subWindow('grimoire — 50 sigils', { icon: 'auto_stories', width: 560 });
        body.classList.add('wz-book');
        const elColor = el => (D.EL[el] || {}).color || '#fff';
        let filter = 'all';
        let picked = D.SPELLS[0];
        function draw() {
            const list = filter === 'all' ? D.SPELLS : D.SPELLS.filter(s => s.el === filter);
            body.innerHTML = `
                <div class="wz-book-tabs">
                    <button class="wz-tab ${filter === 'all' ? 'on' : ''}" data-el="all">all 50</button>
                    ${Object.keys(D.EL).map(k => `<button class="wz-tab ${filter === k ? 'on' : ''}" data-el="${k}" style="color:${D.EL[k].color}">${k}</button>`).join('')}
                </div>
                <div class="wz-book-body">
                    <div class="wz-book-list">
                        ${list.map(s => `<button class="wz-book-item ${s.id === picked.id ? 'on' : ''}" data-id="${s.id}">
                            <canvas width="34" height="34" data-sigil="${s.id}"></canvas>
                            <span style="color:${elColor(s.el)}">${escapeHtml(s.name)}</span>
                        </button>`).join('')}
                    </div>
                    <div class="wz-book-detail">
                        <canvas id="wz-big" width="180" height="180"></canvas>
                        <div class="wz-book-name" style="color:${elColor(picked.el)}">${escapeHtml(picked.name)}</div>
                        <div class="wz-book-meta">${picked.el} · ${picked.cost || 0} ink${picked.hp ? ' + ' + picked.hp + ' hp' : ''} · ${picked.cd}s · ${picked.glyph.length} stroke${picked.glyph.length > 1 ? 's' : ''}</div>
                        <div class="wz-book-meta">${KIND_WORDS[picked.kind]}${picked.charges > 1 ? ', ' + picked.charges + ' of them' : ''}</div>
                        <div class="wz-book-blurb">${escapeHtml(picked.blurb)}</div>
                        ${picked.dmg ? `<div class="wz-book-meta">damage ${picked.dmg}</div>` : ''}
                        <button class="wz-btn wz-wide" id="wz-practise">practise this sigil</button>
                    </div>
                </div>`;
            body.querySelectorAll('canvas[data-sigil]').forEach(c => paintSigil(c, D.byId(c.dataset.sigil), { width: 8 }));
            body.querySelectorAll('.wz-tab').forEach(b => { b.onclick = () => { filter = b.dataset.el; if (filter !== 'all' && picked.el !== filter) picked = D.SPELLS.find(s => s.el === filter); draw(); }; });
            body.querySelectorAll('.wz-book-item').forEach(b => { b.onclick = () => { picked = D.byId(b.dataset.id); draw(); }; });
            body.querySelector('#wz-practise').onclick = () => openTrainer(picked);
            const big = body.querySelector('#wz-big');
            const t0 = performance.now();
            const anim = () => {
                if (!document.body.contains(big)) return;
                const p = min(1.4, (performance.now() - t0) / 900);
                paintSigil(big, picked, { width: 9, progress: min(1, p), numbers: p >= 1 });
                if (p < 1.4) requestAnimationFrame(anim);
            };
            anim();
        }
        draw();
    }
    // draw it, get scored on it. also the honest way to find out whether your circle is a circle
    function openTrainer(spell) {
        const { body, win } = subWindow('practise: ' + spell.name, { icon: 'draw', width: 400 });
        body.classList.add('wz-train');
        body.innerHTML = `
            <div class="wz-train-row">
                <canvas id="wz-ref" width="150" height="150"></canvas>
                <canvas id="wz-pad" width="180" height="180" class="wz-pad" aria-label="Draw the practice sigil here"></canvas>
            </div>
            <div id="wz-score" class="wz-score" role="status">draw it on the right. any angle, any size.</div>
            <button class="wz-btn wz-wide" id="wz-clear">clear</button>`;
        paintSigil(body.querySelector('#wz-ref'), spell, { width: 8, numbers: true });
        const pad = body.querySelector('#wz-pad'), pctx = pad.getContext('2d');
        let strokes = [], cur = null, timer = null, pointer = null;
        const redraw = () => {
            pctx.clearRect(0, 0, pad.width, pad.height);
            pctx.strokeStyle = '#0df259'; pctx.lineWidth = 3; pctx.lineCap = 'round'; pctx.lineJoin = 'round';
            strokes.forEach(s => {
                if (s.length < 2) return;
                pctx.beginPath(); pctx.moveTo(s[0].x, s[0].y);
                for (let i = 1; i < s.length; i++) pctx.lineTo(s[i].x, s[i].y);
                pctx.stroke();
            });
        };
        const at = ev => {
            const r = pad.getBoundingClientRect();
            return { x: (ev.clientX - r.left) * (pad.width / r.width), y: (ev.clientY - r.top) * (pad.height / r.height) };
        };
        const score = () => {
            const res = R.recognize(strokes);
            const el = body.querySelector('#wz-score');
            if (!res.length) return;
            const mine = res.find(r => r.id === spell.id);
            const best = res[0];
            const pct = Math.round((mine ? mine.score : 0) * 100);
            const tooClose = res[1] && best.score - res[1].score < R.CAST_MARGIN;
            if (best.id === spell.id && best.score >= REC_FLOOR && !tooClose) {
                const lo = A.qualityPower[0], hi = A.qualityPower[1];
                el.innerHTML = `<b style="color:#0df259">${pct}% — that would cast, at ${Math.round((lo + (hi - lo) * R.qualityOf(best.score)) * 100)}% power</b>`;
            } else if (best.id === spell.id && tooClose) {
                el.innerHTML = `<b style="color:#ffe14d">${pct}% — half ${escapeHtml(spell.name)}, half ${escapeHtml(res[1].spell.name)}</b>`;
            } else if (best.id === spell.id) {
                el.innerHTML = `<b style="color:#ffe14d">${pct}% — closest match, but ${Math.round(REC_FLOOR * 100)}% is the bar</b>`;
            } else {
                el.innerHTML = `<b style="color:#ff9aa8">${pct}% — the game read that as ${escapeHtml(best.spell.name)}</b>`;
            }
        };
        const down = e => {
            if (pointer !== null || e.button > 0) return;
            e.preventDefault(); pointer = e.pointerId; pad.setPointerCapture(pointer);
            cur = [at(e)]; strokes.push(cur); clearTimeout(timer);
        };
        const move = e => { if (!cur || e.pointerId !== pointer) return; e.preventDefault(); for (const m of everyMove(e)) cur.push(at(m)); redraw(); };
        const up = e => { if (e.pointerId !== pointer) return; pointer = null; cur = null; redraw(); clearTimeout(timer); timer = setTimeout(score, INK_PAUSE); };
        const clear = () => { clearTimeout(timer); strokes = []; cur = null; pointer = null; redraw(); body.querySelector('#wz-score').textContent = 'draw it on the right. any angle, any size.'; };
        pad.addEventListener('pointerdown', down); pad.addEventListener('pointermove', move);
        pad.addEventListener('pointerup', up);
        pad.addEventListener('pointercancel', e => { if (pointer === e.pointerId) clear(); });
        body.querySelector('#wz-clear').onclick = clear;
        win._cleanup = () => { clearTimeout(timer); };
    }
    // A box you type or paste an id into. There is no button: the moment it is a whole id it is
    // loaded, and until then it is only complained at if it can already never be one.
    let menuLoadout = null, windowLoadout = null;
    function wireLoadoutBox(input, msg, loaded) {
        const tell = (text, bad) => { msg.textContent = text; msg.classList.toggle('wz-bad', !!bad); };
        const show = l => { input.value = D.loadoutToId(l) || ''; };
        const read = final => {
            const clean = D.cleanLoadoutId(input.value);
            if (!clean) { tell(final ? '' : 'type or paste one, and it loads as soon as it is whole'); return; }
            const r = D.loadoutFromId(input.value);
            if (r.ok) {
                const now = useLoadout(r.list);
                input.value = r.id;
                const known = D.PRESETS.find(p => p.code === r.id);
                tell((known ? known.name + ' ' : '') + 'loaded. ' + (now ? 'it is what you are carrying.' : 'the next match uses it.'));
                loaded(r.list.slice());
            } else if (r.why === 'short' && !final) {
                tell(clean.length + ' of ' + D.ID_LENGTH);
            } else {
                tell(r.text, true);
            }
        };
        input.addEventListener('input', () => read(false));
        input.addEventListener('blur', () => { if (D.cleanLoadoutId(input.value) !== D.cleanLoadoutId(D.loadoutToId(myLoadout()) || '')) read(true); });
        input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') read(true); });
        show(myLoadout());
        return { show, tell };
    }
    function openLoadout() {
        pause(G, true, 'menu');
        const { body } = subWindow('your eight spells', { icon: 'bookmark', width: 560 });
        body.classList.add('wz-book');
        const elColor = el => (D.EL[el] || {}).color || '#fff';
        let loadout = myLoadout();
        let slot = 0;
        body.innerHTML = `
            <div class="wz-load-top">you carry eight sigils into a match, and only those can be cast. pick a slot, then a spell,
            or take a ready made eight, or type somebody's id. the next match uses them.</div>
            <div class="wz-row wz-idrow">
                <label for="wz-load-id">loadout id</label>
                <input id="wz-load-id" class="wz-input wz-idbox" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="wz-load-msg">
                <button class="wz-btn" id="wz-load-copy">copy</button>
            </div>
            <div class="wz-hint" id="wz-load-msg" aria-live="polite"></div>
            <div class="wz-load-row" id="wz-chosen"></div>
            <div class="wz-load-head">ready made</div>
            <div class="wz-presets" id="wz-presets"></div>
            <div class="wz-load-head">all fifty</div>
            <div class="wz-book-list wz-load-all" id="wz-all"></div>`;
        const idBox = wireLoadoutBox(body.querySelector('#wz-load-id'), body.querySelector('#wz-load-msg'), l => { loadout = l; slot = 0; draw(); });
        // whichever of the two windows you changed it in, the other one catches up
        const changed = () => {
            useLoadout(loadout);
            if (menuLoadout && root && root.querySelector('#wz-loid')) menuLoadout(loadout);
            idBox.show(loadout);
        };
        body.querySelector('#wz-load-copy').onclick = () => {
            const id = D.loadoutToId(loadout);
            const done = () => idBox.tell('copied ' + id + '. anyone who types that gets these eight.');
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(id).then(done, () => idBox.tell('your browser will not let me copy. it is ' + id));
            else idBox.tell('your browser will not let me copy. it is ' + id);
        };
        windowLoadout = l => { loadout = l.slice(); slot = 0; idBox.show(l); draw(); };
        const presets = body.querySelector('#wz-presets');
        presets.innerHTML = D.PRESETS.map(p => `<button class="wz-preset" data-preset="${p.id}">
            <span class="wz-preset-name">${escapeHtml(p.name)}</span>
            <span class="wz-preset-style">${escapeHtml(p.style)}</span>
            <span class="wz-preset-sigils">${p.sigils.map(id => `<canvas width="24" height="24" title="${escapeHtml(D.byId(id).name)}" data-sigil="${id}"></canvas>`).join('')}</span>
            <span class="wz-preset-code">${p.code}</span></button>`).join('');
        presets.querySelectorAll('canvas[data-sigil]').forEach(c => paintSigil(c, D.byId(c.dataset.sigil), { width: 8 }));
        presets.querySelectorAll('[data-preset]').forEach(b => {
            b.onclick = () => {
                const p = D.PRESETS.find(x => x.id === b.dataset.preset);
                loadout = p.sigils.slice();
                slot = 0;
                changed();
                idBox.tell(p.name + ' loaded.');
                draw();
            };
        });
        function draw() {
            const code = D.loadoutToId(loadout);
            presets.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('on', D.PRESETS.find(x => x.id === b.dataset.preset).code === code));
            if (menuLoadout && root && root.querySelector('#wz-loid')) menuLoadout(loadout);
            const chosen = body.querySelector('#wz-chosen');
            chosen.innerHTML = loadout.map((id, i) => {
                const s = D.byId(id);
                return `<button class="wz-card ${i === slot ? 'on' : ''}" data-slot="${i}"><canvas width="40" height="40" data-sigil="${id}"></canvas>
                    <div class="wz-card-name" style="color:${elColor(s.el)}">${escapeHtml(s.name)}</div></button>`;
            }).join('');
            const all = body.querySelector('#wz-all');
            all.innerHTML = D.SPELLS.map(s => `<button class="wz-book-item ${loadout.includes(s.id) ? 'on' : ''}" data-id="${s.id}">
                <canvas width="30" height="30" data-sigil="${s.id}"></canvas>
                <span style="color:${elColor(s.el)}">${escapeHtml(s.name)}</span></button>`).join('');
            body.querySelectorAll('canvas[data-sigil]').forEach(c => paintSigil(c, D.byId(c.dataset.sigil), { width: 8 }));
            body.querySelectorAll('[data-slot]').forEach(b => { b.onclick = () => { slot = +b.dataset.slot; draw(); }; });
            all.querySelectorAll('[data-id]').forEach(b => {
                b.onclick = () => {
                    const id = b.dataset.id;
                    const already = loadout.indexOf(id);
                    // picking something you already carry swaps the two
                    if (already >= 0) { loadout[already] = loadout[slot]; }
                    loadout[slot] = id;
                    slot = (slot + 1) % D.LOADOUT_SIZE;
                    changed();
                    idBox.tell('');
                    draw();
                };
            });
        }
        draw();
    }
    function openAvatarEditor() {
        const { body } = createAppWindow('customise wizard', { icon: 'face', width: 500 });
        body.classList.add('wz-dress');
        let av = myAvatar();
        const parts = [
            ['hat', 'hat', D.AVATAR.hat], ['hatColor', 'hat colour', D.AVATAR.palette],
            ['hair', 'hair', D.AVATAR.hair], ['hairColor', 'hair colour', D.AVATAR.palette],
            ['beard', 'beard', D.AVATAR.beard], ['skin', 'skin', D.AVATAR.skin],
            ['eyes', 'eyes', D.AVATAR.eyes], ['robe', 'robe', D.AVATAR.robe],
            ['robeColor', 'robe colour', D.AVATAR.palette], ['trimColor', 'trim colour', D.AVATAR.palette],
            ['staff', 'staff', D.AVATAR.staff], ['familiar', 'familiar', D.AVATAR.familiar],
            ['aura', 'aura', D.AVATAR.aura], ['title', 'title', D.AVATAR.titles]
        ];
        body.innerHTML = `
            <div class="wz-dress-wrap">
                <div class="wz-dress-view">
                    <canvas id="wz-dress-cv" width="200" height="230"></canvas>
                    <div class="wz-row">
                        <input id="wz-dress-name" class="wz-input" maxlength="16" value="${escapeHtml(window.Netplay ? Netplay.profile().name : 'wizard')}">
                    </div>
                    <button class="wz-btn wz-wide" id="wz-random">randomise everything</button>
                    <button class="wz-btn wz-go wz-wide" id="wz-save">save</button>
                </div>
                <div class="wz-dress-parts">
                    ${parts.map(([key, label]) => `
                        <div class="wz-part" data-key="${key}">
                            <button class="wz-btn wz-tiny" data-dir="-1">◄</button>
                            <div class="wz-part-label"><span>${label}</span><b id="wz-v-${key}"></b></div>
                            <button class="wz-btn wz-tiny" data-dir="1">►</button>
                        </div>`).join('')}
                </div>
            </div>`;
        const cvd = body.querySelector('#wz-dress-cv');
        const paintVals = () => parts.forEach(([key]) => {
            const el = body.querySelector('#wz-v-' + key);
            if (!el) return;
            const v = av[key];
            if (String(v).startsWith('#')) { el.textContent = '■'; el.style.color = v; }
            else { el.textContent = v; el.style.color = '#ffe14d'; }
        });
        spinPortrait(cvd, () => normAvatar(av), { bg: [0, 0.5, 0.5] });
        paintVals();
        body.querySelectorAll('.wz-part').forEach(row => {
            const key = row.dataset.key;
            const list = (parts.find(p => p[0] === key) || [])[2] || [];
            row.querySelectorAll('button[data-dir]').forEach(b => {
                b.onclick = () => {
                    const i = max(0, list.indexOf(av[key]));
                    av[key] = list[(i + list.length + (+b.dataset.dir)) % list.length];
                    paintVals();
                    if (typeof playSound === 'function') playSound('click');
                };
            });
        });
        body.querySelector('#wz-random').onclick = () => { av = D.randomAvatar(); paintVals(); };
        body.querySelector('#wz-save').onclick = () => {
            saveAvatar(av);
            const n = body.querySelector('#wz-dress-name').value.trim();
            if (n && window.Netplay) Netplay.setName(n);
            if (G) G.s.wiz[G.me].avatar = normAvatar(av);
            if (typeof showToast === 'function') showToast('wizardz', 'your wizard is saved');
            if (typeof playSound === 'function') playSound('ding');
        };
    }

    // used by the lobby to draw everybody's wizard on a small canvas
    function paintAvatar(canvas, avatar) {
        if (!canvas || !canvas.getContext) return;
        if (!GL.paintPortrait(canvas, normAvatar(avatar), performance.now() / 1000, { angle: 0.5, bg: [0.09, 0.05, 0.17] })) {
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
            id: 'wizardz',
            name: 'wizardz 98',
            start: (session, opts) => startDuel(session, opts),
            startSolo: () => openBotPicker(),
            soloLabel: 'play bots — pick an opponent',
            paintAvatar,
            editAvatar: openAvatarEditor,
            editLoadout: openLoadout
        });
    }
    // extra: { mode: 1..4, map: id } if you do not want what the menu has saved
    window.startWizardz = function (mode, botId, extra) {
        if (mode === 'solo') { startBotDuel(botId, extra); return; }
        if (mode === 'bot' || mode === 'bots') { openBotPicker(); return; }
        openMenu();
    };
    window.wizardzGrimoire = openGrimoire;
    window.wizardzAvatar = openAvatarEditor;
    window.wizardzBots = openBotPicker;
    window.wizardzLoadout = openLoadout;
    // handy for the console, and for the browser tests. state() hands out the live match
    window.WZ_ENGINE = {
        recognize: R.recognize, decide: R.decide, featuresOf: R.featuresOf, templates: R.templates,
        paintSigil, paintAvatar, CAST_FLOOR: R.CAST_FLOOR, CAST_MARGIN: R.CAST_MARGIN, qualityOf: R.qualityOf,
        normAvatar, myLoadout, state: () => G, onSnapshot, hostInput
    };
})();
