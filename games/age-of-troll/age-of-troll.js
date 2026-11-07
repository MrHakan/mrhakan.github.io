// ===================================================================
// age of troll — the window: a lane, two walls, buttons, the wire
//
// The rules are in age-of-troll-sim.js and do not know any of this exists.
// This file draws what the simulation says and turns clicks into commands.
//
// Online the host owns the game, as in wizardz: a guest sends what it wants
// and the host decides. Between snapshots a guest keeps stepping the same
// rules from the last one it got, so units walk smoothly on three snapshots a
// second. A correction is eased in by the drawing, which keeps its own x for
// each unit. Each player sees their own wall on the left.
// ===================================================================
(function () {
    'use strict';

    const A = window.AOT;
    const HZ = A.HZ, DT = A.DT, LANE = A.LANE;
    const H = 350, GY = 296, MAX_VIEW = 1150;          // world height and where the ground is
    const SAVE = 'mrhakan98-ageoftroll-save';
    const META = 'mrhakan98-ageoftroll-meta';
    const SNAP_HZ = { direct: 8, bus: 3 };
    const AUTOSAVE_EVERY = 10;        // seconds
    const CLAIM_AFTER = 25;           // seconds an opponent can be gone before you can act on it
    const COLOR = { me: '#000080', meHi: '#1084d0', foe: '#800000', foeHi: '#d04030' };

    let G = null, winRef = null, root = null, cv = null, ctx = null;
    let raf = null, driver = null, ro = null;
    let speed = 1;                    // only the browser test ever changes this
    const motion = () => !window.FX || !FX.on || FX.on();
    const say = (t, bad) => {
        const el = root && root.querySelector('#aot-say');
        if (el) { el.textContent = t; el.classList.toggle('aot-bad', !!bad); }
        if (G) G.sayT = 4;
    };
    const beep = k => { if (typeof playSound === 'function') playSound(k); };
    const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } };
    const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window: no save, still a game */ } };
    const forget = k => { try { localStorage.removeItem(k); } catch (e) { } };
    const clock = sec => { const m = Math.floor(sec / 60), r = Math.floor(sec % 60); return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; };
    const money = n => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(Math.floor(n));
    const safe = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'));

    // ---------------------------------------------------------------
    // sprites. A troll that has not loaded yet is a yellow circle rather than
    // nothing, and one big png is not rescaled from 1154px on every frame.
    // ---------------------------------------------------------------
    const SPRITES = {};
    function sprite(src) {
        let e = SPRITES[src];
        if (e) return e;
        e = SPRITES[src] = { cv: null, ratio: 1 };
        const img = new Image();
        img.onload = () => {
            const box = 140, k = Math.min(1, box / Math.max(img.naturalWidth, img.naturalHeight));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.naturalWidth * k));
            c.height = Math.max(1, Math.round(img.naturalHeight * k));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            e.cv = c; e.ratio = c.height / c.width;
        };
        img.src = src;
        return e;
    }
    function warmSprites() { A.UNITS.forEach(u => sprite(u.sprite)); }

    // ---------------------------------------------------------------
    // the animations: a 4 x 4 sheet per move (A.ANIM, games/age-of-troll/anim).
    // A sheet is asked for the first time a troll of that kind turns up, or when
    // somebody reaches its age, and until it arrives the troll is its still
    // picture. Only the drawing changes: the rules never see any of this.
    // ---------------------------------------------------------------
    const FRAME = 0.08;          // the gifs' 80ms a frame
    const DEATH_HOLD = 0.6;      // and the last frame of a death held, as the gif does
    const SHEETS = {};
    const animStats = { walk: 0, attack: 0, death: 0, shot: 0, still: 0 };
    function animSheet(file) {
        let e = SHEETS[file];
        if (e) return e;
        e = SHEETS[file] = { img: null };
        const img = new Image();
        img.onload = () => { e.img = img; };
        img.src = A.ANIM_DIR + file + '.webp';
        return e;
    }
    function warmAge(age) {
        A.UNITS.forEach(u => {
            if (u.age !== age || !A.ANIM || !A.ANIM[u.anim]) return;
            ['walk', 'attack', 'death'].forEach(m => animSheet(u.anim + '-' + m));
            if (A.ANIM[u.anim].shot) animSheet(u.anim + '-projectile');
        });
    }
    // one frame of a move, standing on bottom, size across; false until it has loaded
    function drawAnim(c, file, cell, frame, x, bottom, size, flip, alpha) {
        const sh = animSheet(file);
        if (!sh.img) return false;
        const f = Math.max(0, Math.min(15, Math.floor(frame)));
        c.save();
        if (alpha !== undefined) c.globalAlpha = alpha;
        c.translate(x, bottom);
        if (flip) c.scale(-1, 1);
        c.drawImage(sh.img, (f % 4) * cell, (f >> 2) * cell, cell, cell, -size / 2, -size, size, size);
        c.restore();
        return true;
    }
    // a troll's own animation is drawn facing right, so the other side is the mirror image
    const animFlip = (file, mine) => (A.ANIM_LOOKS_LEFT && A.ANIM_LOOKS_LEFT[file] ? mine : !mine);
    // how big a troll's frame is drawn, for the size it has in the rules
    const animSize = type => type.size * (type.id === A.BOSS ? 1.5 : 1.6);

    // ===============================================================
    // a match
    // ===============================================================
    function makeMatch(o) {
        const seed = o.seed || Math.floor(Math.random() * 1e9);
        const watch = o.watch || null;
        const s = o.resume || (watch ? A.replay.start(watch.rp) : A.newGame(seed));
        // whoever runs the rules writes the match down, which is what a replay is
        if (!o.resume && !watch && (o.solo || o.session.isHost)) A.replay.record(s, seed);
        s.ev = [];
        const g = {
            s, session: o.session || null, solo: !!o.solo, watch,
            isHost: o.solo ? true : watch ? false : !!o.session.isHost,
            me: o.solo ? 0 : watch ? watch.rp.me : (o.session.isHost ? 0 : 1),
            names: o.names, diff: o.diff || null, plan: o.plan || null,
            brain: null,
            acc: 0, last: performance.now(),
            paused: false, pauseWhy: null,
            netDown: 0, downAt: 0, subbed: false,
            lastSnap: performance.now(), snapAcc: 0, snapTick: -1,
            seq: 0, pending: [], ack: 0, seen: new Set(), seenTo: 0, outbox: [], wantsRematch: false,
            saveAcc: 0, ended: false, sayT: 0,
            view: { cam: 0, follow: true, drag: null, heldAt: 0 },
            vis: new Map(), corpses: [], sparks: [], floats: [], shots: [], rings: [], popups: [], banners: [], flash: 0, t: 0,
            turretKick: [[0, 0, 0, 0], [0, 0, 0, 0]], wallHit: [0, 0], baseFlash: [0, 0], lastHud: 0
        };
        if (o.solo) {
            g.brain = o.brain || A.newBrain(o.diff, o.plan, (seed * 31 + 7) | 0);
            if (!o.resume) s.p[1].handicap = A.DIFFICULTIES[o.diff].income;
        }
        return g;
    }

    function stopEverything() {
        watchToken = null;            // a replay still being checked is not wanted any more
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        if (driver) clearInterval(driver);
        driver = null;
        if (ro) { ro.disconnect(); ro = null; }
        if (G) {
            if (G.offs) G.offs.forEach(off => { try { off(); } catch (e) { } });
            if (G.unbind) G.unbind();
        }
    }
    function leaveSession(g) {
        if (g && g.session && !g.solo && g.session.alive) g.session.leave();
    }

    function ensureWindow() {
        if (winRef && document.getElementById(winRef.win.id)) return winRef;
        winRef = createAppWindow('age of troll', { icon: 'castle', width: 900 });
        winRef.body.classList.add('aot-body');
        // the war has a theme, on winamp, on repeat, until the window closes
        const releaseMusic = typeof holdTrack === 'function' ? holdTrack('Age of War - Theme Soundtrack.mp3') : null;
        // a phone on its side has no height to waste on a window's usual offset
        if (document.documentElement.clientHeight < 500) winRef.win.style.top = '0px';
        winRef.win._cleanup = () => {
            if (G && G.solo && !G.s.over) saveNow(G);
            stopEverything();
            if (G) leaveSession(G);
            G = null; cv = null; ctx = null; root = null; winRef = null;
            if (releaseMusic) releaseMusic();
        };
        root = winRef.body;
        return winRef;
    }

    function saveNow(g) {
        if (!g || !g.solo || g.s.over) return;
        const s = Object.assign({}, g.s, { ev: null });
        store(SAVE, { v: 1, at: Date.now(), s, brain: g.brain, diff: g.diff, plan: g.plan, names: g.names });
    }

    // ===============================================================
    // the driver: rules on a timer, drawing on the display's own clock. A hidden
    // tab gets no animation frames and a host has to keep the game going for its
    // guest, so the two are not the same loop.
    // ===============================================================
    function drive() {
        const g = G;
        if (!g) return;
        const now = performance.now();
        const dt = (now - g.last) / 1000;
        g.last = now;
        if (g.watch) {
            watchDrive(g, dt);
            readEvents(g);
            if (now - g.lastHud > 150) { g.lastHud = now; hud(g); }
            return;
        }
        if (g.solo && !g.paused && winRef && (winRef.win.style.display === 'none' || document.hidden)) pause(g, true, 'away');

        const frozen = g.paused || g.netDown;
        if (!frozen && !g.s.over) {
            // caught up, within reason. a tab the browser has throttled to one
            // wake a minute should slow the game down, not fast-forward it
            g.acc += Math.min(dt, 2) * speed;
            if (g.isHost) {
                while (g.acc >= DT && !g.s.over) {
                    if (g.brain) A.think(g.s, 1, g.brain);
                    A.step(g.s);
                    g.acc -= DT;
                }
            } else {
                // a guest guesses forward from the last thing it was told, and
                // only so far: a host that stopped talking does not get imagined
                const limit = g.snapTick + HZ * 2;
                while (g.acc >= DT && !g.s.over && g.s.tick < limit) {
                    A.step(g.s);
                    g.acc -= DT;
                }
                if (g.acc > 1) g.acc = 0;
            }
        }
        readEvents(g);
        if (g.isHost && !g.solo) sendSnapshots(g, dt);
        if (!g.isHost) resendCommands(g, now);
        if (g.solo && !g.s.over && !g.paused) {
            g.saveAcc += dt;
            if (g.saveAcc >= AUTOSAVE_EVERY) { g.saveAcc = 0; saveNow(g); }
        }
        if (g.s.over && !g.ended) endMatch(g);
        if (now - g.lastHud > 150) { g.lastHud = now; hud(g); }
    }

    // ---------------------------------------------------------------
    // the wire
    // ---------------------------------------------------------------
    const onRelays = g => !!(g.session && g.session.transport && g.session.transport.kind === 'bus');

    function sendSnapshots(g, dt) {
        g.snapAcc += dt;
        // read every time: a direct link that dies moves to the relays mid-match.
        // once it is over, or frozen, a slow heartbeat is enough to say so
        const hz = (g.s.over || g.netDown) ? 1 : onRelays(g) ? SNAP_HZ.bus : SNAP_HZ.direct;
        if (g.snapAcc < 1 / hz) return;
        g.snapAcc = 0;
        // a finished match says so for a while, then stops bothering the relays
        if (g.s.over) { g.overSent = (g.overSent || 0) + 1; if (g.overSent > 30) return; } else g.overSent = 0;
        const extra = { a: g.seenTo };
        if (g.netDown) extra.d = 1;
        if (g.outbox.length) { extra.e = g.outbox; g.outbox = []; }
        g.session.send('aot:snap', A.snapshot(g.s, extra));
    }

    function onSnapshot(g, d) {
        if (!d || !d.p || !Array.isArray(d.u)) return;
        // relays reorder. An old snapshot is not news, unless it is a new match,
        // or the end of this one: a surrender lands between ticks, so the
        // snapshots saying it is over carry the tick the last one already had
        const ending = d.o && !g.s.over && d.k === g.snapTick;
        if (d.m < g.s.match || (d.m === g.s.match && d.k <= g.snapTick && !ending)) return;
        if (d.m > g.s.match) {
            // a rematch: the numbering of orders starts again with the match
            g.vis.clear(); g.ended = false; g.wantsRematch = false; hideEnd();
            g.seq = 0; g.ack = 0; g.pending = [];
            g.replayP = null; g.replayText = null;
        }
        A.applySnapshot(g.s, d);
        g.s.guessing = true;
        g.snapTick = d.k;
        g.lastSnap = performance.now();
        g.acc = 0;
        if (typeof d.a === 'number' && d.a > g.ack) {
            g.ack = d.a;
            g.pending = g.pending.filter(c => c.n > g.ack);
        }
        if (d.e) d.e.forEach(ev => g.s.ev.push(ev));
        // the host has lost sight of us. saying hello again is how a seat comes back
        if (d.d) {
            if (performance.now() - (g.helloAt || 0) > 2000) {
                g.helloAt = performance.now();
                if (g.session.alive) g.session.announceProfile();
            }
        }
    }

    function resendCommands(g, now) {
        if (!g.session || !g.session.alive) return;
        for (const c of g.pending) {
            if (now - c.at > 1500) {
                c.at = now;
                g.session.sendToHost('aot:cmd', { n: c.n, m: g.s.match, c: c.c });
            }
        }
    }

    function hostCommand(g, d, from) {
        if (!d || typeof d.n !== 'number' || !d.c) return;
        const guest = g.guestId;
        if (from && from.id && guest && from.id !== guest) return;
        // comes back to life if we had given up on them
        if (g.netDown) comeBack(g);
        // an order still in the post from the match before
        if (d.m !== g.s.match) return;
        // the same command twice, because the ack got lost, is still one command
        if (d.n <= g.seenTo || g.seen.has(d.n)) return;
        g.seen.add(d.n);
        while (g.seen.has(g.seenTo + 1)) { g.seenTo++; g.seen.delete(g.seenTo); }
        const why = A.command(g.s, 1, d.c);
        if (why && why !== 'over') g.session.send('aot:deny', { c: d.c.c, why }, guest);
    }

    function goneAway(g, why) {
        if (g.s.over || g.netDown) return;
        g.netDown = 1;
        g.downAt = performance.now();
        g.downWhy = why;
        renderNetChoice(g);
    }
    function comeBack(g) {
        if (!g.netDown && !g.subbed) return;
        g.netDown = 0;
        g.last = performance.now();
        if (g.subbed) { g.subbed = false; g.brain = null; say('they are back. the bot gets up from their seat'); }
        renderNetChoice(g);
    }

    function bindNet(g) {
        if (g.solo || !g.session) return;
        const s = g.session, offs = [];
        if (g.isHost) {
            const other = s.players.find(p => !p.me);
            g.guestId = other ? other.id : null;
            offs.push(s.on('aot:cmd', (d, from) => hostCommand(g, d, from)));
            offs.push(s.on('aot:rematch', () => { g.theyWantRematch = true; if (g.ended) renderEnd(g); }));
            offs.push(s.on('aot:replay?', d => { if (d && d.m === g.s.match) sendReplay(g); }));
            offs.push(s.on('player-join', p => { if (p.id === g.guestId) comeBack(g); }));
        } else {
            offs.push(s.on('aot:snap', d => {
                onSnapshot(g, d);
                if (g.netDown && !d.d) comeBack(g);
            }));
            offs.push(s.on('aot:deny', d => { say(denyText(d && d.why), true); beep('error'); }));
            offs.push(s.on('aot:replay', d => takeReplay(g, d)));
        }
        offs.push(s.on('player-leave', p => { if (g.isHost ? p.id === g.guestId : p.host) goneAway(g, 'left'); }));
        offs.push(s.on('net:down', () => goneAway(g, 'quiet')));
        offs.push(s.on('closed', () => goneAway(g, 'closed')));
        offs.push(s.on('net:up', () => {
            comeBack(g);
            if (!g.isHost && s.alive) s.announceProfile();
        }));
        g.offs = offs;
    }

    function denyText(why) {
        return ({
            gold: 'not enough gold', xp: 'not enough xp yet', queue: 'the factory queue is full',
            slots: 'no turret slot free: a new age opens more', age: 'that needs the next age',
            cooling: 'still cooling down', none: 'nothing to sell', max: 'that is maxed out'
        })[why] || 'cannot do that';
    }

    // ---------------------------------------------------------------
    // a command: straight into the rules for the host, and across the wire for a
    // guest, after a local check so a tap on an empty purse gets an instant no
    // ---------------------------------------------------------------
    function issue(cmd) {
        const g = G;
        // a replay is something that already happened
        if (!g || g.watch || g.s.over) return false;
        if (g.paused) { pause(g, false); }
        if (g.netDown) { say('the link is down, hold on', true); return false; }
        if (g.isHost) {
            const why = A.command(g.s, g.me, cmd);
            if (why) { say(denyText(why), true); beep('error'); return false; }
        } else {
            const why = cmd.c === 'resign' ? null : A.canCommand(g.s, g.me, cmd);
            if (why) { say(denyText(why), true); beep('error'); return false; }
            const n = ++g.seq;
            g.pending.push({ n, c: cmd, at: performance.now() });
            g.session.sendToHost('aot:cmd', { n, m: g.s.match, c: cmd });
        }
        hud(g);
        return true;
    }

    function pause(g, on, why) {
        if (!g.solo) return;
        if (on === g.paused) return;
        g.paused = on;
        g.pauseWhy = on ? why || 'you' : null;
        g.last = performance.now();
        if (on) saveNow(g);
        const b = root && root.querySelector('#aot-pause');
        if (b) b.textContent = on ? 'resume (P)' : 'pause (P)';
    }

    // ===============================================================
    // what happened, for the eyes. The rules drop these in s.ev and nothing in
    // the rules reads them back.
    // ===============================================================
    const IMPORTANT = { age: 1, special: 1, build: 1, overclock: 1, server: 1, modem: 1 };

    function readEvents(g) {
        const list = g.s.ev;
        if (!list || !list.length) return;
        const fancy = motion() && !document.hidden;
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if (g.isHost && !g.solo && IMPORTANT[e.e]) g.outbox.push(e);
            const mine = e.s === g.me;
            switch (e.e) {
                case 'hit': {
                    const v = g.vis.get(e.id);
                    if (v) {
                        v.swing = 1;
                        // the attack plays over the time to the next one, never slower than drawn
                        const ty = A.UNITS[v.t];
                        v.atk = g.t;
                        v.atkDur = Math.max(0.45, Math.min(16 * FRAME, ty ? ty.cd * 0.95 : 1));
                    }
                    if (e.base !== undefined) {
                        g.wallHit[e.base] = 1;
                        if (fancy) addSpark(g, A.BASE_FRONT[e.base] + (e.base ? 6 : -6), GY - 70 - Math.random() * 90, 3, '#ffe14d');
                    } else if (e.role === 1 && fancy) {
                        const ty = v && A.UNITS[v.t];
                        const anim = ty && A.ANIM && A.ANIM[ty.anim] && A.ANIM[ty.anim].shot ? ty.anim : null;
                        g.shots.push({ x0: e.x, x1: e.tx, y: GY - 32, t: 0, d: anim ? 0.32 : 0.22, s: e.s, anim });
                    } else if (fancy) {
                        addSpark(g, e.tx, GY - 22 - Math.random() * 24, 2, '#fff');
                    }
                    if (e.tid) { const w = g.vis.get(e.tid); if (w) w.hurt = 1; }
                    break;
                }
                case 'tshot':
                    if (e.i >= 0) g.turretKick[e.s][e.i] = 1;
                    if (fancy) {
                        const wallX = A.BASE_FRONT[e.s];
                        g.shots.push({ x0: wallX, x1: e.x, y: GY - 34, y0: GY - 170, t: 0, d: e.k === 1 ? 0.34 : 0.14, s: e.s, tracer: e.k === 0, shell: e.k === 1 });
                        if (e.k === 1) g.rings.push({ x: e.x, r: 6, max: A.TURRETS[1].radius, t: 0 });
                    }
                    break;
                case 'die': {
                    // it plays its death where it fell, and then it is gone
                    const v = g.vis.get(e.id);
                    const ty = v && A.UNITS[v.t];
                    if (fancy && ty && A.ANIM && A.ANIM[ty.anim]) {
                        g.corpses.push({ t: v.t, x: v.x, side: e.s, depth: (e.id * 7) % 3, at: g.t });
                        if (g.corpses.length > 40) g.corpses.shift();
                    } else if (fancy) {
                        for (let n = 0; n < 6; n++) addSpark(g, e.x, GY - 20 - Math.random() * 30, 3, e.s === g.me ? '#a0c0ff' : '#ffb0a0');
                    }
                    if (e.s !== g.me && e.g) addFloat(g, e.x, GY - 52, '+' + e.g, '#ffe14d');
                    g.vis.delete(e.id);
                    break;
                }
                case 'age':
                    warmAge(e.a);
                    addBanner(g, (g.watch ? nameOf(g, e.s) + ' reached ' : mine ? 'you reached ' : 'they reached ') + 'age ' + (e.a + 1) + ': ' + A.AGES[e.a].name, mine ? '#fff' : '#ffd0d0');
                    beep('ding');
                    break;
                case 'overclock':
                    addBanner(g, (g.watch ? nameOf(g, e.s) + ' overclocked +' : mine ? 'overclock +' : 'they overclocked +') + (e.a * 10) + '%', mine ? '#fff' : '#ffd0d0');
                    break;
                case 'special':
                    showSpecial(g, e, fancy, mine);
                    break;
                case 'server':
                    addBanner(g, g.watch ? nameOf(g, e.s) + ' took the server' : mine ? 'you took the server: more gold, more xp' : 'they took the server', mine ? '#c8ffc8' : '#ffd0d0');
                    break;
                case 'modem':
                    if (mine && !g.watch) say('modem upgraded: income is now +' + Math.round(A.incomeOf(g.s, g.me) * 10) / 10 + '/s');
                    break;
            }
        }
        g.s.ev = [];
    }
    function addSpark(g, x, y, n, color) {
        if (g.sparks.length > 80) return;
        for (let i = 0; i < n; i++) {
            g.sparks.push({ x, y, vx: (Math.random() - 0.5) * 110, vy: -30 - Math.random() * 90, t: 0, d: 0.35 + Math.random() * 0.2, color });
        }
    }
    function addFloat(g, x, y, text, color) {
        if (g.floats.length > 24) g.floats.shift();
        g.floats.push({ x, y, text, color, t: 0 });
    }
    function addBanner(g, text, color) {
        g.banners.push({ text, color, t: 0 });
        if (g.banners.length > 3) g.banners.shift();
    }
    function showSpecial(g, e, fancy, mine) {
        const sp = A.SPECIALS.find(x => x.key === e.k);
        addBanner(g, (g.watch ? nameOf(g, e.s) + ': ' : mine ? '' : 'they cast ') + sp.name.toUpperCase(), mine ? '#fff' : '#ffd0d0');
        beep(mine ? 'ding' : 'error');
        if (!fancy) return;
        if (e.k === 'popups') {
            for (let i = 0; i < 6; i++) g.popups.push({ x: e.x + (Math.random() - 0.5) * 170, y: -30 - i * 34, t: 0, d: 0.8, text: 'error' });
        } else if (e.k === 'ban') {
            g.popups.push({ x: e.x, y: -60, t: 0, d: 0.5, hammer: true, text: 'BANNED' });
            g.rings.push({ x: e.x, r: 10, max: 90, t: 0 });
        } else if (e.k === 'bsod') {
            g.flash = 1;
        }
    }

    // ===============================================================
    // drawing
    // ===============================================================
    let bg = null, bgScale = 0, scale = 1, viewW = 900;

    const screenX = wx => (G.me === 0 ? wx : LANE - wx);       // my wall is on the left

    function fit() {
        if (!cv) return;
        const wrap = cv.parentElement;
        const cssW = wrap.clientWidth;
        if (cssW < 100) return;
        const fs = winRef && winRef.win.classList.contains('fs-active');
        const vh = (document.documentElement.clientHeight || window.innerHeight || 700);
        let cssH;
        if (fs) cssH = Math.max(200, vh - 230);
        // a phone on its side has hardly any height, and the buttons need some of it
        else if (vh < 500) cssH = Math.round(Math.max(120, vh * 0.34));
        else cssH = Math.round(Math.max(200, Math.min(cssW * 0.46, vh * 0.46, 430)));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        cv.style.width = cssW + 'px';
        cv.style.height = cssH + 'px';
        const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
        // never so zoomed out that the trolls are specks, or that the lane runs out
        // before the canvas does. On a short wide canvas it is the sky that gives
        scale = Math.max(bh / H, bw / MAX_VIEW);
        viewW = bw / scale;
        if (bgScale !== scale) paintBackground();
    }

    // sky and ground painted once and blitted, since it never changes
    function paintBackground() {
        bgScale = scale;
        bg = document.createElement('canvas');
        bg.width = Math.ceil(LANE * scale);
        bg.height = Math.ceil(H * scale);
        const c = bg.getContext('2d');
        c.scale(scale, scale);
        c.fillStyle = '#008080';
        c.fillRect(0, 0, LANE, H);
        // the desktop has icons on it, because it is a desktop
        const icons = [[260, 36, 'my computer'], [520, 70, 'recycle bin'], [790, 28, 'the internet'], [1080, 66, 'notepad'], [1340, 34, 'dial-up']];
        c.font = '9px Tahoma, "MS Sans Serif", sans-serif';
        c.textAlign = 'center';
        icons.forEach(([x, y, name]) => {
            c.fillStyle = 'rgba(0,0,0,.14)'; c.fillRect(x - 12, y + 2, 26, 22);
            c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(x - 14, y, 26, 20);
            c.fillStyle = 'rgba(255,255,255,.34)';
            c.fillText(name, x, y + 33);
        });
        // a little dither low in the sky, the way 256 colours did gradients
        c.fillStyle = 'rgba(0,0,0,.07)';
        for (let y = 210; y < GY; y += 4) for (let x = (y % 8 ? 0 : 2); x < LANE; x += 4 + Math.floor((GY - y) / 16) * 2) c.fillRect(x, y, 2, 2);
        // the lane is a taskbar
        c.fillStyle = '#c0c0c0'; c.fillRect(0, GY, LANE, H - GY);
        c.fillStyle = '#fff'; c.fillRect(0, GY, LANE, 2);
        c.fillStyle = '#dfdfdf'; c.fillRect(0, GY + 2, LANE, 1);
        c.fillStyle = '#808080'; c.fillRect(0, H - 2, LANE, 2);
        for (let x = 200; x < LANE - 200; x += 200) {
            c.fillStyle = '#808080'; c.fillRect(x, GY + 10, 1, 30);
            c.fillStyle = '#fff'; c.fillRect(x + 1, GY + 10, 1, 30);
        }
    }

    function bevel(c, x, y, w, h, fill, inset) {
        c.fillStyle = fill; c.fillRect(x, y, w, h);
        c.fillStyle = inset ? '#404040' : '#fff';
        c.fillRect(x, y, w, 1); c.fillRect(x, y, 1, h);
        c.fillStyle = inset ? '#fff' : '#404040';
        c.fillRect(x, y + h - 1, w, 1); c.fillRect(x + w - 1, y, 1, h);
    }

    // -----------------------------------------------------------------
    // a wall. It is a computer that has been through something: a desk at dial-up,
    // a tower by msn, a castle of bevels by the time the trolls run it. Drawn from
    // the left wall's point of view; `flip` mirrors the shapes and not the writing.
    // -----------------------------------------------------------------
    const WALL_H = [128, 154, 182, 208, 232];
    function drawWall(c, leftEdge, flip, side, p, t) {
        const age = p.age, W = 150;
        const mine = side === G.me;
        const tint = mine ? COLOR.me : COLOR.foe, tintHi = mine ? COLOR.meHi : COLOR.foeHi;
        const X = (x, w) => leftEdge + (flip ? W - x - w : x);
        const rect = (x, y, w, h, fill) => { c.fillStyle = fill; c.fillRect(X(x, w), y, w, h); };
        const box = (x, y, w, h, fill, inset) => bevel(c, X(x, w), y, w, h, fill, inset);
        const frac = Math.max(0, p.hp / A.AGES[age].hp);
        const top = GY - WALL_H[age];
        const label = (text, x, y, w, color, size) => {
            c.fillStyle = color; c.font = (size || 9) + 'px Tahoma, "MS Sans Serif", sans-serif';
            c.textAlign = 'center';
            c.fillText(text, X(x, w) + w / 2, y);
        };
        // something to stand it all on
        box(0, GY - 12, W, 12, '#c0c0c0');

        // a desk first, and the tower that replaces it
        if (age === 0) {
            rect(2, GY - 34, 146, 6, '#a07840');
            rect(2, GY - 34, 146, 1, '#d0a868');
            rect(8, GY - 28, 8, 16, '#7a5a30');
            rect(134, GY - 28, 8, 16, '#7a5a30');
        } else {
            box(4, top + 58, 62, WALL_H[age] - 70, '#d4d0c8');       // tower
            for (let i = 0; i < 3; i++) box(12, top + 68 + i * 15, 46, 11, '#c0c0c0', true);
            rect(14, top + 72, 26, 2, '#404040');
            rect(47, top + 72, 5, 4, Math.floor(t * 2) % 2 ? '#30e030' : '#106010');
            box(12, GY - 30, 16, 12, '#c0c0c0');
        }
        if (age >= 2) box(0, top + 40, W, 20, '#c0c0c0');            // rampart
        if (age >= 2) {
            // crenellations, out of toolbar buttons
            const n = age >= 3 ? 7 : 5, bw = Math.floor(W / (n * 2 - 1));
            for (let i = 0; i < n; i++) box(i * bw * 2, top + 26, bw, 14, '#d4d0c8');
        }
        if (age >= 4) {
            box(0, top - 26, 34, 92, '#b8b4ac');
            box(W - 34, top - 26, 34, 92, '#b8b4ac');
            for (let i = 0; i < 3; i++) {
                box(i * 13, top - 36, 8, 10, '#d4d0c8');
                box(W - 34 + i * 13, top - 36, 8, 10, '#d4d0c8');
            }
        }

        // the window: the part that is really the base
        const sw = 62 + age * 11, sh = 50 + age * 12;
        const wx = age === 0 ? 34 : W - sw - 4, wy = age === 0 ? GY - 34 - sh - 8 : top + (age >= 2 ? 62 : 8) ;
        box(wx, wy, sw, sh, '#c0c0c0');
        // a title bar, in your colour
        const tb = X(wx + 2, sw - 4);
        const grad = c.createLinearGradient(tb, 0, tb + sw - 4, 0);
        grad.addColorStop(0, tint); grad.addColorStop(1, tintHi);
        c.fillStyle = grad; c.fillRect(tb, wy + 2, sw - 4, 10);
        box(wx + sw - 12, wy + 3, 8, 8, '#c0c0c0');
        c.textAlign = 'left';
        c.fillStyle = '#fff'; c.font = 'bold 8px Tahoma, "MS Sans Serif", sans-serif';
        c.fillText(['dial-up.exe', 'msn.exe', 'forum.exe', 'rage.exe', 'troll.exe'][age], tb + 2, wy + 10);
        // what is on the screen
        const sx = wx + 4, sy = wy + 14, iw = sw - 8, ih = sh - 18;
        const bsod = frac < 0.22;
        box(sx, sy, iw, ih, bsod ? '#0000aa' : age === 0 ? '#001800' : '#fff', true);
        if (bsod) {
            label('Windows', sx, sy + 11, iw, '#fff', 8);
            rect(sx + 5, sy + 15, iw - 10, 1, '#fff');
            rect(sx + 5, sy + 19, iw - 16, 1, '#fff');
            rect(sx + 5, sy + 23, iw - 12, 1, '#fff');
        } else if (age === 0) {
            label('CONNECT 56K', sx, sy + 12, iw, '#30ff30', 8);
            rect(sx + 5, sy + 17, Math.max(1, (iw - 10) * ((t * 0.3) % 1)), 3, '#30ff30');
        } else if (age === 1) {
            const a = sprite(A.UNITS[3].sprite), b = sprite(A.UNITS[4].sprite);
            if (a.cv) c.drawImage(a.cv, X(sx + 4, 20), sy + 2, 20, 20);
            if (b.cv) c.drawImage(b.cv, X(sx + iw - 24, 20), sy + 2, 20, 20);
            rect(sx + 5, sy + ih - 7, iw - 10, 1, '#808080');
            rect(sx + 5, sy + ih - 4, iw - 22, 1, '#808080');
        } else if (age === 2) {
            for (let i = 0; i < 5; i++) { rect(sx + 3, sy + 4 + i * 8, 5, 5, '#000080'); rect(sx + 11, sy + 5 + i * 8, iw - 18 - (i * 7) % 15, 2, '#606060'); }
        } else if (age === 3) {
            const q = sprite(A.UNITS[9].sprite), rr = sprite(A.UNITS[11].sprite);
            const w2 = (iw - 3) / 2;
            rect(sx + 1 + w2, sy, 1, ih, '#000');
            rect(sx, sy + ih / 2, iw, 1, '#000');
            if (q.cv) c.drawImage(q.cv, X(sx + 2, w2 - 4), sy + 2, w2 - 4, ih / 2 - 3);
            if (rr.cv) c.drawImage(rr.cv, X(sx + w2 + 3, w2 - 4), sy + ih / 2 + 2, w2 - 4, ih / 2 - 3);
        } else {
            const k = sprite(A.UNITS[12].sprite);
            if (k.cv) {
                const hh = ih - 4, ww = hh / k.ratio;
                c.drawImage(k.cv, X(sx + (iw - ww) / 2, ww), sy + 2, ww, hh);
            }
        }
        // the desk's own computer stands under that first window
        if (age === 0) {
            box(wx + 20, wy + sh, sw - 40, 8, '#c0c0c0');
            box(104, GY - 54, 40, 20, '#d4d0c8');         // the modem
            for (let i = 0; i < 4; i++) rect(108 + i * 7, GY - 48, 4, 3, Math.floor(t * 5 + i) % 2 ? '#30e030' : '#106010');
            rect(141, GY - 76, 2, 22, '#404040');
            rect(138, GY - 78, 8, 3, '#404040');
        }
        // your flag
        if (age >= 1) {
            const fx = 8;
            rect(fx, top - (age >= 4 ? 62 : 26), 2, 26, '#404040');
            const wave = motion() ? Math.sin(t * 4) * 1.5 : 0;
            rect(fx + 2, top - (age >= 4 ? 62 : 26) + wave, 20, 11, tint);
            rect(fx + 2, top - (age >= 4 ? 62 : 26) + wave, 20, 1, tintHi);
        }

        // what it costs to be hit
        if (frac < 0.72) {
            c.strokeStyle = 'rgba(0,0,0,.65)'; c.lineWidth = 1.2;
            c.beginPath();
            const cracks = frac < 0.4 ? 5 : 2;
            for (let i = 0; i < cracks; i++) {
                const cx = 24 + (i * 47) % 110, cy = top + 40 + (i * 53) % Math.max(30, WALL_H[age] - 60);
                c.moveTo(X(cx, 0), cy);
                c.lineTo(X(cx + 12, 0), cy + 10);
                c.lineTo(X(cx + 6, 0), cy + 22);
                c.lineTo(X(cx + 18, 0), cy + 32);
            }
            c.stroke();
        }
        if (frac < 0.5) {
            const n = frac < 0.25 ? 2 : 1;
            for (let i = 0; i < n; i++) {
                const ex = 26 + i * 46, ey = GY - 70 - i * 42;
                box(ex, ey, 62, 28, '#c0c0c0');
                rect(ex + 2, ey + 2, 58, 7, '#000080');
                rect(ex + 6, ey + 13, 11, 11, '#e02020');
                label('not enough', ex + 18, ey + 18, 44, '#000', 7);
                label('memory', ex + 18, ey + 25, 44, '#000', 7);
            }
        }

        // turrets on the roof
        const roofY = age === 0 ? wy - 2 : top + (age >= 2 ? 26 : 6);
        p.tur.forEach((tu, i) => {
            const kick = G.turretKick[side][i] || 0;
            const tx = 10 + i * 34, ty = roofY - 18;
            box(tx, ty + 8, 24, 10, tu.k === 0 ? '#c0c0c0' : '#b0b0d0');
            const tierCol = ['#808080', '#3060c0', '#30a050', '#c08020', '#c02050'][tu.a];
            rect(tx + 4, ty + 10, 16, 3, tierCol);
            if (tu.k === 0) {
                // a ping gun: a long thin barrel at the enemy
                box(tx + 12 - kick * 3, ty + 3, 22, 6, '#808080');
            } else {
                // a spam cannon: a fat one, with a speaker on it
                box(tx + 8 - kick * 3, ty, 20, 10, '#808080');
                c.fillStyle = '#404040';
                c.beginPath(); c.arc(X(tx + 26 - kick * 3, 0), ty + 5, 4, 0, Math.PI * 2); c.fill();
            }
        });
        // a shield on the wall while it is under attack
        const hit = G.wallHit[side];
        if (hit > 0) {
            c.fillStyle = 'rgba(255,255,255,' + (hit * 0.18) + ')';
            c.fillRect(X(0, W), top - 10, W, WALL_H[age] + 10);
        }
    }

    function drawServer(c, t) {
        const s = G.s, x = screenX(A.MID);
        const own = A.serverOwner(s);
        const swing = G.me === 0 ? s.srv : -s.srv;
        const col = own < 0 ? '#808080' : own === G.me ? COLOR.me : COLOR.foe;
        bevel(c, x - 13, GY - 62, 26, 62, '#d4d0c8');
        for (let i = 0; i < 4; i++) bevel(c, x - 9, GY - 56 + i * 11, 18, 8, '#c0c0c0', true);
        for (let i = 0; i < 4; i++) {
            c.fillStyle = own < 0 ? '#606060' : ((Math.floor(t * 4) + i) % 3 ? '#30e030' : '#106010');
            c.fillRect(x - 6, GY - 53 + i * 11, 3, 2);
        }
        c.fillStyle = '#404040'; c.fillRect(x - 1, GY - 90, 2, 28);
        c.fillStyle = col; c.fillRect(x + 1, GY - 90, 22, 13);
        c.fillStyle = '#fff'; c.font = 'bold 8px Tahoma, sans-serif'; c.textAlign = 'center';
        c.fillText('$', x + 12, GY - 80);
        // who is swinging it
        bevel(c, x - 30, GY - 105, 60, 8, '#fff', true);
        c.fillStyle = swing >= 0 ? COLOR.me : COLOR.foe;
        const w = Math.abs(swing) * 28;
        c.fillRect(swing >= 0 ? x : x - w, GY - 103, w, 4);
        c.fillStyle = '#000'; c.fillRect(x, GY - 104, 1, 6);
    }

    function drawUnits(c, dt) {
        const g = G, t = g.t;
        const all = [];
        // the fallen first, under everybody still standing
        const deathLen = 16 * FRAME + DEATH_HOLD, fade = 0.35;
        for (let i = g.corpses.length - 1; i >= 0; i--) {
            const k = g.corpses[i], age = t - k.at;
            if (age < 0 || age > deathLen + fade) { g.corpses.splice(i, 1); continue; }
            const type = A.UNITS[k.t], meta = A.ANIM[type.anim];
            const sx = screenX(k.x);
            if (sx < g.view.cam - 80 || sx > g.view.cam + viewW + 80) continue;
            const file = type.anim + '-death';
            const alpha = age > deathLen ? Math.max(0, 1 - (age - deathLen) / fade) : 1;
            if (drawAnim(c, file, meta.cell, age / FRAME, sx, GY + 2 + k.depth * 6, animSize(type), animFlip(file, k.side === g.me), alpha)) animStats.death++;
        }
        for (let side = 0; side < 2; side++) {
            for (const u of g.s.u[side]) {
                let v = g.vis.get(u.id);
                if (!v) { v = { x: u.x, swing: 0, hurt: 0, phase: u.id * 1.7 }; g.vis.set(u.id, v); }
                v.t = u.t;
                const moved = Math.abs(u.x - v.x);
                // eased, so a guest's correction is a nudge and not a teleport,
                // unless it is so wrong that a nudge would look worse
                v.x = moved > 90 ? u.x : v.x + (u.x - v.x) * Math.min(1, dt * 14);
                v.walking = moved > 0.02 && moved > (v.lastMoved || 0) * 0.2;
                v.lastMoved = moved;
                v.seen = t;
                v.swing = Math.max(0, v.swing - dt * 5);
                v.hurt = Math.max(0, v.hurt - dt * 6);
                const depth = (u.id * 7) % 3;
                all.push({ u, v, side, depth });
            }
        }
        all.sort((a, b) => a.depth - b.depth);
        const fancy = motion();
        for (const { u, v, side, depth } of all) {
            const type = A.UNITS[u.t];
            const sx = screenX(v.x);
            if (sx < g.view.cam - 80 || sx > g.view.cam + viewW + 80) continue;
            const mine = side === g.me;
            const faceRight = mine;
            const lane = GY + 4 + depth * 6;
            const bob = fancy && !u.stun ? Math.abs(Math.sin(t * (type.speed / 7) + v.phase)) * 4 : 0;
            const lunge = (fancy ? v.swing : 0) * (type.role === 1 ? -2 : 7) * (faceRight ? 1 : -1);
            // whose it is: a coloured chip under its feet, a taskbar button of sorts
            c.fillStyle = 'rgba(0,0,0,.28)';
            c.beginPath(); c.ellipse(sx, lane + 1, type.r + 2, 3, 0, 0, Math.PI * 2); c.fill();
            c.fillStyle = mine ? COLOR.meHi : COLOR.foeHi;
            c.fillRect(sx - type.r, lane - 2, type.r * 2, 2);
            const spr = sprite(type.sprite);
            const size = type.size * 1.2;
            const w = spr.cv ? size : size;
            let h = spr.cv ? Math.min(size * 1.3, size * spr.ratio) : size;
            let dx = sx + lunge, dy = lane - 2 - h - bob;
            // walking, swinging, or standing still waiting for the next swing
            const meta = A.ANIM && A.ANIM[type.anim];
            let animated = false;
            if (meta) {
                const big = animSize(type);
                const swinging = fancy && v.atk !== undefined && t - v.atk < v.atkDur;
                const move = swinging ? 'attack' : 'walk';
                const frame = swinging ? (t - v.atk) / v.atkDur * 16
                    : fancy && v.walking && !u.stun ? ((t + v.phase) / FRAME) % 16 : 0;
                const file = type.anim + '-' + move;
                animated = drawAnim(c, file, meta.cell, frame, sx, lane - 2, big, animFlip(file, mine));
                if (animated) {
                    animStats[fancy && (swinging || v.walking) ? move : 'still']++;
                    h = big * meta.h;
                    dx = sx; dy = lane - 2 - h;
                }
            }
            if (animated) {
                // drawn above
            } else if (spr.cv) {
                c.save();
                c.translate(dx, dy + h / 2);
                if (A.flipped(type, mine)) c.scale(-1, 1);
                if (fancy && v.hurt > 0) c.rotate((faceRight ? -1 : 1) * v.hurt * 0.12);
                c.drawImage(spr.cv, -w / 2, -h / 2, w, h);
                c.restore();
            } else {
                c.fillStyle = '#ffd400';
                c.beginPath(); c.arc(dx, dy + h / 2, size / 2, 0, Math.PI * 2); c.fill();
            }
            if (u.stun > 0) {
                c.fillStyle = '#ffe14d'; c.font = 'bold 10px Tahoma, sans-serif'; c.textAlign = 'center';
                c.fillText('zZ', dx, dy - 2);
            }
            // health, only once it has been touched
            if (u.hp < type.hp) {
                const bw = Math.max(16, type.r * 1.8);
                c.fillStyle = '#000'; c.fillRect(sx - bw / 2 - 1, dy - 7, bw + 2, 4);
                c.fillStyle = u.hp / type.hp > 0.4 ? (mine ? '#40d040' : '#e0a020') : '#e03030';
                c.fillRect(sx - bw / 2, dy - 6, Math.max(1, bw * u.hp / type.hp), 2);
            }
        }
        // anything that has not been in a snapshot for a moment is gone
        if (g.vis.size > 60) for (const [id, v] of g.vis) if (t - v.seen > 2) g.vis.delete(id);
    }

    function drawFx(c, dt) {
        const g = G;
        // fires on the lane
        for (const f of g.s.fire) {
            const x = screenX(f.x);
            c.fillStyle = 'rgba(240,90,20,.28)';
            c.fillRect(x - f.w / 2, GY - 14, f.w, 16);
            for (let i = 0; i < 16; i++) {
                const fx = x - f.w / 2 + (i + 0.5) * f.w / 16;
                const fh = 12 + Math.abs(Math.sin(g.t * 9 + i * 2.1)) * 24;
                c.fillStyle = i % 2 ? '#ff9020' : '#ffd040';
                c.fillRect(fx - 4, GY - fh, 8, fh);
            }
        }
        for (let i = g.shots.length - 1; i >= 0; i--) {
            const s = g.shots[i];
            s.t += dt;
            const k = s.t / s.d;
            if (k >= 1) { g.shots.splice(i, 1); continue; }
            const x0 = screenX(s.x0), x1 = screenX(s.x1);
            const y0 = s.y0 !== undefined ? s.y0 : s.y;
            const x = x0 + (x1 - x0) * k;
            const y = y0 + (s.y - y0) * k - (s.shell ? Math.sin(k * Math.PI) * 50 : 0);
            const shot = s.anim && A.ANIM[s.anim].shot;
            if (shot && drawAnim(c, s.anim + '-projectile', shot.cell, (s.t / FRAME) % 16, x, y + 13, 26, x1 < x0)) {
                animStats.shot++;
            } else if (s.tracer) {
                c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.4;
                c.beginPath(); c.moveTo(x0 + (x1 - x0) * Math.max(0, k - 0.3), y0 + (s.y - y0) * Math.max(0, k - 0.3)); c.lineTo(x, y); c.stroke();
            } else {
                c.fillStyle = s.s === g.me ? '#ffffff' : '#ffb080';
                c.fillRect(x - 3, y - 3, 6, 6);
                c.fillStyle = '#000'; c.fillRect(x - 1, y - 1, 2, 2);
            }
        }
        for (let i = g.rings.length - 1; i >= 0; i--) {
            const r = g.rings[i];
            r.t += dt;
            const k = r.t / 0.3;
            if (k >= 1) { g.rings.splice(i, 1); continue; }
            c.strokeStyle = 'rgba(255,240,180,' + (1 - k) + ')'; c.lineWidth = 2;
            c.beginPath(); c.ellipse(screenX(r.x), GY - 6, r.max * k + r.r, (r.max * k + r.r) * 0.3, 0, 0, Math.PI * 2); c.stroke();
        }
        for (let i = g.popups.length - 1; i >= 0; i--) {
            const p = g.popups[i];
            p.t += dt;
            const k = p.t / p.d;
            if (k >= 1.5) { g.popups.splice(i, 1); continue; }
            const y = Math.min(GY - 34, p.y + (GY - p.y) * k);
            const x = screenX(p.x);
            if (p.hammer) {
                bevel(c, x - 42, y - 26, 84, 30, '#c0c0c0');
                c.fillStyle = '#e02020'; c.font = 'bold 15px Tahoma, sans-serif'; c.textAlign = 'center';
                c.fillText(p.text, x, y - 6);
            } else {
                bevel(c, x - 26, y - 18, 52, 26, '#c0c0c0');
                c.fillStyle = '#000080'; c.fillRect(x - 24, y - 16, 48, 6);
                c.fillStyle = '#e02020'; c.fillRect(x - 20, y - 7, 10, 10);
                c.fillStyle = '#000'; c.font = '8px Tahoma, sans-serif'; c.textAlign = 'left';
                c.fillText(p.text, x - 7, y + 1);
            }
        }
        for (let i = g.sparks.length - 1; i >= 0; i--) {
            const s = g.sparks[i];
            s.t += dt;
            if (s.t >= s.d) { g.sparks.splice(i, 1); continue; }
            s.vy += 300 * dt; s.x += s.vx * dt * (g.me === 0 ? 1 : -1); s.y += s.vy * dt;
            c.fillStyle = s.color;
            c.fillRect(screenX(s.x) - 1, s.y - 1, 3, 3);
        }
        for (let i = g.floats.length - 1; i >= 0; i--) {
            const f = g.floats[i];
            f.t += dt;
            if (f.t >= 1) { g.floats.splice(i, 1); continue; }
            c.globalAlpha = 1 - f.t;
            c.fillStyle = f.color; c.font = 'bold 12px "Courier New", monospace'; c.textAlign = 'center';
            c.fillText(f.text, screenX(f.x), f.y - f.t * 22);
            c.globalAlpha = 1;
        }
    }

    // things pinned to the glass: the walls' health, the minimap, the news
    function drawOverlay(c, dt) {
        const g = G, s = g.s;
        const W = viewW, VH = cv.height / scale;
        const bar = (x, frac, name, tint, alignRight) => {
            const w = Math.min(230, W * 0.3);
            bevel(c, x, 6, w, 28, '#c0c0c0');
            const grad = c.createLinearGradient(x + 2, 0, x + w - 2, 0);
            grad.addColorStop(0, tint === 'me' ? COLOR.me : COLOR.foe);
            grad.addColorStop(1, tint === 'me' ? COLOR.meHi : COLOR.foeHi);
            c.fillStyle = grad; c.fillRect(x + 2, 8, w - 4, 11);
            c.fillStyle = '#fff'; c.font = 'bold 9px Tahoma, sans-serif';
            c.textAlign = 'left';
            c.fillText(name, x + 5, 17);
            bevel(c, x + 2, 20, w - 4, 12, '#fff', true);
            // a file copy progress bar: blocks, not a smooth fill
            const blocks = Math.floor((w - 8) / 7);
            const fill = Math.ceil(blocks * frac);
            c.fillStyle = frac > 0.3 ? '#000080' : '#c00000';
            const dir = alignRight ? -1 : 1;
            for (let i = 0; i < fill; i++) {
                const bx = alignRight ? x + w - 10 - i * 7 : x + 4 + i * 7;
                c.fillRect(bx + (dir < 0 ? 0 : 0), 22, 5, 8);
            }
        };
        const my = s.p[g.me], foe = s.p[1 - g.me];
        const barW = Math.min(230, W * 0.3);
        bar(6, my.hp / A.AGES[my.age].hp, g.names[g.me].slice(0, 14) + ' · age ' + (my.age + 1), 'me', false);
        bar(W - barW - 6, foe.hp / A.AGES[foe.age].hp, g.names[1 - g.me].slice(0, 14) + ' · age ' + (foe.age + 1), 'foe', true);

        // the whole lane, between them
        const mx = 6 + barW + 8, mw = W - 2 * (barW + 14);
        if (mw > 60) {
            bevel(c, mx, 6, mw, 16, '#008080', true);
            const toMap = wx => mx + 2 + (screenX(wx) / LANE) * (mw - 4);
            c.fillStyle = 'rgba(255,255,255,.45)';
            c.fillRect(mx + 2 + (g.view.cam / LANE) * (mw - 4), 8, Math.max(4, (viewW / LANE) * (mw - 4)), 12);
            for (let side = 0; side < 2; side++) {
                c.fillStyle = side === g.me ? '#40a0ff' : '#ff5040';
                for (const u of s.u[side]) c.fillRect(toMap(u.x) - 1, 11 - (u.id % 3), 2, 6);
            }
            c.fillStyle = '#000'; c.fillRect(mx + 2 + (mw - 4) / 2, 8, 1, 12);
        }
        // a full disk is news
        const left = A.DISK_FULL_AT - A.seconds(s);
        if (left <= 120) {
            const msg = left > 0 ? 'disk full in ' + clock(left) : 'DISK FULL: both walls are failing';
            c.fillStyle = left > 0 ? '#ffe14d' : '#ff6040'; c.font = 'bold 12px Tahoma, sans-serif'; c.textAlign = 'center';
            c.fillText(msg, W / 2, 38);
        }

        // news
        let y = 62;
        for (let i = g.banners.length - 1; i >= 0; i--) {
            const b = g.banners[i];
            b.t += dt;
            if (b.t > 3) { g.banners.splice(i, 1); continue; }
            c.globalAlpha = Math.min(1, 3 - b.t);
            c.font = 'bold 13px Tahoma, sans-serif'; c.textAlign = 'center';
            const tw = c.measureText(b.text).width + 18;
            c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(W / 2 - tw / 2, y - 14, tw, 20);
            c.fillStyle = b.color; c.fillText(b.text, W / 2, y);
            c.globalAlpha = 1;
            y += 24;
        }

        if (g.flash > 0) {
            c.fillStyle = 'rgba(0,0,170,' + (g.flash * 0.55) + ')';
            c.fillRect(0, 0, W, VH);
            if (g.flash > 0.4) {
                c.fillStyle = '#fff'; c.font = 'bold 15px "Courier New", monospace'; c.textAlign = 'center';
                c.fillText('A fatal exception has occurred.', W / 2, VH / 2 - 8);
                c.fillText('Press any key to continue trolling', W / 2, VH / 2 + 12);
            }
            g.flash = Math.max(0, g.flash - dt * 0.9);
        }
        const shout = g.paused ? (g.pauseWhy === 'away' ? 'paused while you were away' : 'paused')
            : g.netDown ? (g.isHost ? 'opponent gone: the game is frozen' : 'lost the host: the game is frozen') : null;
        if (shout) {
            c.fillStyle = 'rgba(0,0,0,.42)'; c.fillRect(0, 0, W, VH);
            bevel(c, W / 2 - 150, VH / 2 - 28, 300, 56, '#c0c0c0');
            c.fillStyle = '#000080'; c.fillRect(W / 2 - 148, VH / 2 - 26, 296, 14);
            c.fillStyle = '#fff'; c.font = 'bold 10px Tahoma, sans-serif'; c.textAlign = 'left';
            c.fillText('age of troll', W / 2 - 144, VH / 2 - 16);
            c.fillStyle = '#000'; c.font = '12px Tahoma, sans-serif'; c.textAlign = 'center';
            c.fillText(shout, W / 2, VH / 2 + 12);
        }
    }

    function camera(dt) {
        const g = G, v = g.view;
        if (v.follow && !v.drag) {
            // the action, which is wherever the two front lines meet
            const mineFront = g.s.u[g.me][0], foeFront = g.s.u[1 - g.me][0];
            const a = mineFront ? screenX(mineFront.x) : 100;
            const b = foeFront ? screenX(foeFront.x) : (mineFront ? a + 240 : 500);
            const want = (Math.min(a, b) + Math.max(a, b)) / 2 - viewW * 0.5;
            v.cam += (want - v.cam) * Math.min(1, dt * 1.6);
        } else if (!v.drag && performance.now() - v.heldAt > 7000) {
            v.follow = true;
        }
        v.cam = Math.max(0, Math.min(LANE - viewW, v.cam));
    }

    function render(now) {
        raf = requestAnimationFrame(render);
        const g = G;
        if (!g || !ctx || !bg) return;
        if (winRef && winRef.win.style.display === 'none') return;
        const dt = Math.max(0, Math.min(0.1, (now - (g.drawLast || now)) / 1000));
        g.drawLast = now;
        g.t += dt;
        const frozen = g.paused || g.netDown || (g.watch && !g.watch.playing);
        const c = ctx, v = g.view;
        camera(dt);
        g.wallHit[0] = Math.max(0, g.wallHit[0] - dt * 5);
        g.wallHit[1] = Math.max(0, g.wallHit[1] - dt * 5);
        g.turretKick.forEach(row => row.forEach((k, i) => { row[i] = Math.max(0, k - dt * 6); }));

        c.setTransform(1, 0, 0, 1, 0, 0);
        const sx = Math.round(v.cam * scale);
        const cropTop = Math.max(0, Math.round(H * scale) - cv.height);
        c.drawImage(bg, sx, cropTop, cv.width, cv.height, 0, 0, cv.width, cv.height);
        c.setTransform(scale, 0, 0, scale, -v.cam * scale, -cropTop);

        const leftWall = g.me === 0 ? g.s.p[0] : g.s.p[1], leftSide = g.me;
        drawWall(c, 0, false, leftSide, leftWall, g.t);
        drawWall(c, LANE - 150, true, 1 - leftSide, g.s.p[1 - leftSide], g.t);
        drawServer(c, g.t);
        drawUnits(c, frozen ? 0 : dt);
        drawFx(c, frozen ? 0 : dt);

        c.setTransform(scale, 0, 0, scale, 0, 0);
        drawOverlay(c, dt);
    }

    // ===============================================================
    // the buttons. They are made once and updated in place, so a tap's pressed
    // state survives the update that follows it.
    // ===============================================================
    const FLAVOUR = { 0: 'cheap front line. runs down shooters.', 1: 'hits from behind the line. picks tanks apart.', 2: 'slow, huge, its swing goes through crowds of grunts.', 3: 'there is one of him and he is enough.' };
    function commandSpecs() {
        return [
            { id: 'u0', key: '1', tap: () => issue({ c: 'train', r: 0 }) },
            { id: 'u1', key: '2', tap: () => issue({ c: 'train', r: 1 }) },
            { id: 'u2', key: '3', tap: () => issue({ c: 'train', r: 2 }) },
            { id: 'u3', key: '4', tap: () => issue({ c: 'train', r: 3 }) },
            { id: 'sp', key: 'space', tap: () => issue({ c: 'special' }) },
            { id: 'st', key: 'F', tap: () => issue({ c: 'stance', h: G.s.p[G.me].hold ? 0 : 1 }) },
            { id: 't0', key: 'Q', tap: () => issue({ c: 'turret', k: 0 }) },
            { id: 't1', key: 'W', tap: () => issue({ c: 'turret', k: 1 }) },
            { id: 'sl', key: 'X', tap: () => issue({ c: 'sell' }) },
            { id: 'mo', key: 'E', tap: () => issue({ c: 'modem' }) },
            { id: 'ag', key: 'R', tap: () => {
                const p = G.s.p[G.me];
                issue({ c: p.age < A.AGES.length - 1 ? 'age' : 'overclock' });
            } }
        ];
    }

    function buildGame(g) {
        root.innerHTML = `
            <div class="aot-hud">
                <span class="aot-chip aot-gold" title="gold, and what you earn a second"><b id="aot-gold">0</b> <small id="aot-rate"></small></span>
                <span class="aot-chip aot-xpbox" title="xp towards the next age"><span class="aot-xpfill" id="aot-xpfill"></span><span class="aot-xplabel" id="aot-xp"></span></span>
                <span class="aot-chip" id="aot-age"></span>
                <span class="aot-chip" id="aot-army" title="your units, out of the cap"></span>
                <span class="aot-chip" id="aot-clock"></span>
                <span class="aot-chip aot-link" id="aot-link"></span>
            </div>
            <div class="aot-stage">
                <canvas id="aot-canvas" tabindex="0" aria-label="The lane. Drag to look around. Your wall is on the left."></canvas>
                <div class="aot-net" id="aot-net" hidden></div>
            </div>
            <div class="aot-end" id="aot-end" hidden></div>
            <div class="aot-factory">
                <span class="aot-queue" id="aot-queue" aria-label="training queue"></span>
                <span class="aot-train"><span id="aot-trainfill"></span></span>
                <span class="aot-say" id="aot-say" role="status" aria-live="polite"></span>
            </div>
            <div class="aot-cmds" id="aot-cmds"${g.watch ? ' inert' : ''}>
                ${commandSpecs().map(c => `<button class="aot-cmd" data-cmd="${c.id}" type="button">
                    <span class="aot-pic" data-pic></span>
                    <span class="aot-txt"><b data-name></b><i data-cost></i></span>
                    <kbd>${c.key}</kbd><span class="aot-cool" data-cool></span>
                </button>`).join('')}
            </div>
            ${g.watch ? watchBar(g) : `<div class="aot-foot">
                ${g.solo ? '<button class="aot-btn" id="aot-pause" type="button">pause (P)</button>' : ''}
                <button class="aot-btn" id="aot-help" type="button">how to play</button>
                <button class="aot-btn" id="aot-resign" type="button">surrender</button>
                <button class="aot-btn" id="aot-quit" type="button">${g.solo ? 'save and leave' : 'leave match'}</button>
            </div>`}`;
        cv = root.querySelector('#aot-canvas');
        ctx = cv.getContext('2d');
        const specs = commandSpecs();
        const byId = {};
        specs.forEach(sp => { byId[sp.id] = sp; });
        g.btn = {};
        root.querySelectorAll('.aot-cmd').forEach(b => {
            const id = b.dataset.cmd;
            g.btn[id] = {
                el: b, pic: b.querySelector('[data-pic]'), name: b.querySelector('[data-name]'),
                cost: b.querySelector('[data-cost]'), cool: b.querySelector('[data-cool]'), picKey: null
            };
            b.onclick = () => { byId[id].tap(); if (G) focusGame(); };
        });
        if (g.watch) bindWatchBar(g);
        else {
            const pauseBtn = root.querySelector('#aot-pause');
            if (pauseBtn) pauseBtn.onclick = () => pause(g, !g.paused, 'you');
            root.querySelector('#aot-help').onclick = () => { if (g.solo) pause(g, true, 'you'); openHelp(); };
            root.querySelector('#aot-resign').onclick = () => {
                const go = () => { if (G === g) issue({ c: 'resign' }); };
                if (typeof showRetroDialog === 'function') showRetroDialog({ title: 'surrender', lines: ['give up this match?'], okLabel: 'yes', cancelLabel: 'no', onOk: go });
                else if (window.confirm('give up this match?')) go();
            };
            root.querySelector('#aot-quit').onclick = () => {
                if (g.solo) saveNow(g);
                openMenu();
            };
        }
        bindGameInput(g);
        fit();
        if (window.ResizeObserver) {
            let lastW = 0, lastFs = false;
            ro = new ResizeObserver(() => {
                if (!cv) return;
                const w = cv.parentElement.clientWidth;
                const fs = winRef && winRef.win.classList.contains('fs-active');
                if (w !== lastW || fs !== lastFs) { lastW = w; lastFs = fs; fit(); }
            });
            ro.observe(cv.parentElement);
        }
        hud(g);
    }
    function focusGame() {
        if (cv && !('ontouchstart' in window)) cv.focus({ preventScroll: true });
    }

    function setPic(entry, key, html) {
        if (entry.picKey === key) return;
        entry.picKey = key;
        entry.pic.innerHTML = html;
    }
    const pic = u => `<img src="${safe(u.sprite)}" alt="" draggable="false">`;

    function setBtn(id, o) {
        const b = G.btn[id];
        if (!b) return;
        if (b.name.textContent !== o.name) b.name.textContent = o.name;
        if (b.cost.textContent !== o.cost) b.cost.textContent = o.cost;
        b.el.classList.toggle('aot-off', !!o.off);
        b.el.classList.toggle('aot-on', !!o.on);
        b.el.classList.toggle('aot-ready', !!o.ready);
        if (b.title !== o.title) { b.title = o.title; b.el.title = o.title; b.el.setAttribute('aria-label', o.name + ', ' + o.cost + '. ' + o.title); }
        const cool = o.cool || 0;
        if (b.coolNow !== cool) { b.coolNow = cool; b.cool.style.height = Math.round(cool * 100) + '%'; }
    }

    function hud(g) {
        if (!root || !g.btn) return;
        const s = g.s, p = s.p[g.me];
        const $ = id => root.querySelector(id);
        const age = A.AGES[p.age], next = A.AGES[p.age + 1];
        $('#aot-gold').textContent = '$' + money(p.gold);
        $('#aot-rate').textContent = '+' + A.incomeOf(s, g.me).toFixed(1) + '/s';
        const xpNeed = next ? next.xp : A.overclockXp(p.oc);
        const xpFrom = next ? age.xp : (p.oc ? A.overclockXp(p.oc - 1) : A.AGES[4].xp);
        const xpFrac = Math.max(0, Math.min(1, (p.xp - xpFrom) / Math.max(1, xpNeed - xpFrom)));
        $('#aot-xpfill').style.width = Math.round(xpFrac * 100) + '%';
        $('#aot-xp').textContent = money(p.xp) + ' / ' + money(xpNeed) + ' xp';
        $('#aot-age').textContent = 'age ' + (p.age + 1) + ': ' + age.name + (p.oc ? ' +' + p.oc : '');
        $('#aot-army').textContent = s.u[g.me].length + '/' + A.POP_CAP + ' units';
        $('#aot-clock').textContent = clock(A.seconds(s));
        const link = $('#aot-link');
        const linkText = g.watch ? 'replay: ' + g.names[g.me].slice(0, 14) + "'s side" : g.solo ? 'bot: ' + g.diff : onRelays(g) ? 'via relays' : 'direct';
        if (g.watch) watchHud(g);
        if (link.textContent !== linkText) link.textContent = linkText;

        for (let r = 0; r < 3; r++) {
            const u = A.unitFor(p.age, r), b = g.btn['u' + r];
            setPic(b, u.sprite, pic(u));
            const waiting = g.pending.filter(c => c.c.c === 'train' && c.c.r === r).length;
            setBtn('u' + r, {
                name: u.name, cost: '$' + money(u.cost) + (waiting ? ' +' + waiting : ''),
                off: A.canCommand(s, g.me, { c: 'train', r }),
                title: FLAVOUR[r] + ' hp ' + u.hp + ', hits for ' + Math.round(u.dmg) + ', range ' + u.range + '.'
            });
        }
        const king = A.UNITS[A.BOSS], kb = g.btn.u3;
        setPic(kb, king.sprite, pic(king));
        setBtn('u3', {
            name: 'troll king', cost: p.age < 4 ? 'age 5' : '$' + money(king.cost),
            off: A.canCommand(s, g.me, { c: 'train', r: 3 }),
            title: FLAVOUR[3] + ' hp ' + king.hp + '. only in the last age.'
        });
        const sp = A.SPECIALS[p.age];
        setPic(g.btn.sp, sp.key, '<span class="aot-glyph">' + ['⚠', '🔨', '⇪', '🔥', '🟦'][p.age] + '</span>');
        setBtn('sp', {
            name: sp.name, cost: p.spCd > 0 ? Math.ceil(p.spCd) + 's' : 'ready',
            off: p.spCd > 0, ready: p.spCd <= 0, cool: p.spCd > 0 ? p.spCd / sp.cd : 0, title: sp.desc
        });
        setPic(g.btn.st, p.hold ? 'hold' : 'go', '<span class="aot-glyph">' + (p.hold ? '✋' : '»') + '</span>');
        setBtn('st', {
            name: p.hold ? 'holding' : 'marching', cost: p.hold ? 'tap: go' : 'tap: hold', on: !!p.hold,
            title: 'marching units walk at the enemy. held units stop at your rally line and wait, so you can send a wave instead of a trickle.'
        });
        for (let k = 0; k < 2; k++) {
            const t = A.TURRETS[k];
            setPic(g.btn['t' + k], t.key, '<span class="aot-glyph">' + (k ? '📢' : '📡') + '</span>');
            setBtn('t' + k, {
                name: t.name, cost: '$' + money(A.turretCost(k, p.age)) + ' ' + p.tur.length + '/' + A.slotsOf(p),
                off: A.canCommand(s, g.me, { c: 'turret', k }),
                title: (k ? 'hits everything around their front, at short range.' : 'long range, one target.') +
                    ' a full wall swaps out its oldest. a new age opens slots.'
            });
        }
        setPic(g.btn.sl, 'sell', '<span class="aot-glyph">♻</span>');
        const lastT = p.tur[p.tur.length - 1];
        setBtn('sl', {
            name: 'sell turret', cost: lastT ? '+$' + money(Math.round(A.turretCost(lastT.k, lastT.a) * A.TURRET_SELL)) : 'none',
            off: !p.tur.length, title: 'half its price back, for the newest one.'
        });
        setPic(g.btn.mo, 'modem', '<span class="aot-glyph">📟</span>');
        setBtn('mo', {
            name: 'modem',
            cost: p.modem + '/' + A.MODEM_COST.length + (p.modem < A.MODEM_COST.length ? ' $' + money(A.MODEM_COST[p.modem]) : ''),
            off: A.canCommand(s, g.me, { c: 'modem' }),
            title: 'more income, forever. greedy early, and a good way to lose to a rush.'
        });
        setPic(g.btn.ag, next ? 'age' : 'oc', '<span class="aot-glyph">' + (next ? '⏫' : '⚡') + '</span>');
        if (next) {
            const why = A.canCommand(s, g.me, { c: 'age' });
            // the xp is there and the gold is not: the moment to stop spending
            if (why === 'gold' && g.toldAge !== p.age && !g.watch) {
                g.toldAge = p.age;
                say('enough xp: save $' + money(next.gold) + ' for ' + next.name);
            }
            g.btn.ag.el.classList.toggle('aot-save', why === 'gold');
            setBtn('ag', {
                name: why === 'gold' ? 'save up: next age' : 'next age',
                cost: (why === 'xp' ? money(next.xp) + ' xp' : '$' + money(next.gold)) + ': ' + next.name,
                off: why, ready: !why,
                title: 'next age: better units, a tougher wall, more income, another special. needs xp and gold.'
            });
        } else {
            g.btn.ag.el.classList.remove('aot-save');
            const why = A.canCommand(s, g.me, { c: 'overclock' });
            setBtn('ag', {
                name: 'overclock',
                cost: p.oc + '/' + A.OVERCLOCK.max + (why === 'max' ? '' : why === 'xp' ? ' ' + money(A.overclockXp(p.oc)) + ' xp' : ' $' + money(A.overclockGold(p.oc))),
                off: why, ready: !why,
                title: 'no ages left, so: every unit hits ten percent harder and takes less. how a stalemate breaks.'
            });
        }

        // the factory
        const q = $('#aot-queue');
        const key = p.q.join(',');
        if (q.dataset.q !== key) {
            q.dataset.q = key;
            q.innerHTML = p.q.map(t => `<img src="${safe(A.UNITS[t].sprite)}" alt="${safe(A.UNITS[t].name)}">`).join('') ||
                '<span class="aot-dim">queue empty</span>';
        }
        const head = p.q.length ? A.UNITS[p.q[0]] : null;
        $('#aot-trainfill').style.width = head ? Math.round(Math.max(0, 1 - p.trainT / head.train) * 100) + '%' : '0%';
        if (g.sayT > 0) {
            g.sayT -= 0.15;
            if (g.sayT <= 0) { const el = $('#aot-say'); if (el) el.textContent = ''; }
        }
    }

    // ---------------------------------------------------------------
    // keys and fingers
    // ---------------------------------------------------------------
    function bindGameInput(g) {
        const v = g.view;
        const keydown = e => {
            if (G !== g || e.ctrlKey || e.metaKey || e.altKey) return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
            const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            if (g.watch) {
                // watching has its own keys, and none of them is an order
                const rate = { 1: 1, 2: 2, 3: 4, 4: 8 }[k];
                if (rate) { watchRate(g, rate); e.preventDefault(); return; }
                if (k === ' ' || k === 'k' || k === 'p') { watchPlay(g); e.preventDefault(); return; }
                if (k === 'c') { watchSide(g); e.preventDefault(); return; }
            } else {
                const press = id => { const b = g.btn[id]; if (b) b.el.click(); };
                const map = { 1: 'u0', 2: 'u1', 3: 'u2', 4: 'u3', q: 't0', w: 't1', e: 'mo', r: 'ag', f: 'st', x: 'sl' };
                if (map[k]) { press(map[k]); e.preventDefault(); return; }
                if (k === ' ') { press('sp'); e.preventDefault(); return; }
                if (k === 'p' && g.solo) { pause(g, !g.paused, 'you'); e.preventDefault(); return; }
            }
            if (k === 'ArrowLeft' || k === 'a') { v.cam -= 120; v.follow = false; v.heldAt = performance.now(); e.preventDefault(); }
            if (k === 'ArrowRight' || k === 'd') { v.cam += 120; v.follow = false; v.heldAt = performance.now(); e.preventDefault(); }
        };
        root.addEventListener('keydown', keydown);

        // dragging the lane, on a finger or a mouse, and a tap on the minimap
        const toWorld = e => {
            const r = cv.getBoundingClientRect();
            return { x: (e.clientX - r.left) * (cv.width / r.width) / scale, y: (e.clientY - r.top) * (cv.height / r.height) / scale };
        };
        const miniHit = (p) => {
            const barW = Math.min(230, viewW * 0.3), mx = 6 + barW + 8, mw = viewW - 2 * (barW + 14);
            return mw > 60 && p.y <= 26 && p.x >= mx && p.x <= mx + mw ? (p.x - mx) / mw * LANE : null;
        };
        const down = e => {
            if (e.button > 0) return;
            if (g.paused) { pause(g, false); return; }
            const p = toWorld(e);
            const mini = miniHit(p);
            if (mini !== null) {
                v.cam = mini - viewW / 2; v.follow = false; v.heldAt = performance.now();
                return;
            }
            v.drag = { id: e.pointerId, x: p.x, cam: v.cam };
            v.follow = false;
            try { cv.setPointerCapture(e.pointerId); } catch (err) { }
        };
        const move = e => {
            if (!v.drag || e.pointerId !== v.drag.id) return;
            const p = toWorld(e);
            v.cam = v.drag.cam - (p.x - v.drag.x);
            v.heldAt = performance.now();
        };
        const up = e => {
            if (v.drag && e.pointerId === v.drag.id) { v.drag = null; v.heldAt = performance.now(); }
        };
        cv.addEventListener('pointerdown', down);
        cv.addEventListener('pointermove', move);
        cv.addEventListener('pointerup', up);
        cv.addEventListener('pointercancel', up);
        const leftTab = () => { if (G === g && g.solo && document.hidden) { pause(g, true, 'away'); saveNow(g); } };
        document.addEventListener('visibilitychange', leftTab);
        const bye = () => { if (G === g) saveNow(g); };
        window.addEventListener('pagehide', bye);
        g.unbind = () => {
            document.removeEventListener('visibilitychange', leftTab);
            window.removeEventListener('pagehide', bye);
        };
    }

    // ===============================================================
    // the end of a match, and the two ways a match can go quiet
    // ===============================================================
    function endMatch(g) {
        g.ended = true;
        readEvents(g);
        if (g.solo) forget(SAVE);
        const won = g.s.winner === g.me, draw = g.s.winner === -1;
        const m = load(META, { wins: 0, losses: 0, draws: 0, best: {} });
        if (draw) m.draws = (m.draws || 0) + 1;
        else if (won) m.wins = (m.wins || 0) + 1;
        else m.losses = (m.losses || 0) + 1;
        if (g.solo && won) {
            const b = m.best || (m.best = {});
            b[g.diff] = (b[g.diff] || 0) + 1;
        }
        store(META, m);
        if (won && typeof unlockAchievement === 'function') {
            unlockAchievement('aot-win');
            if (g.solo && (g.diff === 'hard' || g.diff === 'troll')) unlockAchievement('aot-hard');
        }
        beep(won ? 'ding' : 'error');
        // the replay: written up here when the rules ran here, and asked for when they did not
        if (g.isHost) {
            const p = makeReplay(g);
            if (p && !g.solo) p.then(() => sendReplay(g));
        } else askReplay(g);
        renderEnd(g);
    }

    function renderEnd(g) {
        const box = root && root.querySelector('#aot-end');
        if (!box) return;
        const s = g.s, me = s.p[g.me], foe = s.p[1 - g.me];
        const won = s.winner === g.me, draw = s.winner === -1;
        const title = draw ? 'a draw' : won ? 'you win' : 'you lost';
        const why = s.endWhy === 'resign' ? (won ? 'they gave up.' : 'you gave up.')
            : s.endWhy === 'gone' ? 'they left and did not come back.'
                : won ? 'their wall came down.' : draw ? 'both walls fell in the same breath.' : 'your wall came down.';
        const again = g.solo || g.isHost
            ? '<button class="aot-btn aot-go" id="aot-again" type="button">' + (g.solo ? 'rematch' : g.theyWantRematch ? 'they want a rematch: start it' : 'rematch') + '</button>'
            : '<button class="aot-btn aot-go" id="aot-again" type="button"' + (g.wantsRematch ? ' disabled' : '') + '>' + (g.wantsRematch ? 'asked the host...' : 'ask for a rematch') + '</button>';
        box.hidden = false;
        box.innerHTML = `
            <div class="aot-dialog">
                <div class="aot-dtitle">age of troll</div>
                <div class="aot-dbody">
                    <div class="aot-result ${won ? 'aot-won' : ''}">${title}</div>
                    <p>${why}</p>
                    <table class="aot-stats">
                        <tr><th></th><th>you</th><th>them</th></tr>
                        <tr><td>age</td><td>${me.age + 1}</td><td>${foe.age + 1}</td></tr>
                        <tr><td>kills</td><td>${me.kills}</td><td>${foe.kills}</td></tr>
                        <tr><td>wall hurt</td><td>${money(me.baseDmg)}</td><td>${money(foe.baseDmg)}</td></tr>
                        <tr><td>gold made</td><td>${money(me.earned)}</td><td>${money(foe.earned)}</td></tr>
                    </table>
                    <p class="aot-dim">${clock(A.seconds(s))} on the clock</p>
                    <div class="aot-row">${again}<button class="aot-btn" id="aot-menu" type="button">back to the menu</button></div>
                    ${shareRow(g)}
                </div>
            </div>`;
        bindShare(g, box);
        box.querySelector('#aot-again').onclick = () => {
            if (g.solo) { startSolo(g.diff, g.plan); return; }
            if (g.isHost) { restartOnline(g); return; }
            g.wantsRematch = true;
            g.session.sendToHost('aot:rematch', {});
            renderEnd(g);
        };
        box.querySelector('#aot-menu').onclick = () => openMenu();
    }
    function hideEnd() {
        const box = root && root.querySelector('#aot-end');
        if (box) { box.hidden = true; box.innerHTML = ''; }
    }

    function restartOnline(g) {
        const match = g.s.match + 1;
        const seed = Math.floor(Math.random() * 1e9);
        const s = A.replay.record(A.newGame(seed), seed);
        s.match = match;
        s.ev = [];
        g.s = s;
        g.ended = false;
        g.replayP = null; g.replayText = null;
        g.theyWantRematch = false;
        g.vis.clear();
        g.seen = new Set(); g.seenTo = 0;
        g.acc = 0;
        hideEnd();
        if (g.session.alive) g.session.send('aot:snap', A.snapshot(s, { a: 0 }));
    }

    // somebody has gone quiet. Nothing happens to the match by itself: it freezes,
    // and after a moment the one who is left gets to decide
    function renderNetChoice(g) {
        const box = root && root.querySelector('#aot-net');
        if (!box) return;
        clearTimeout(g.netTimer);
        if (!g.netDown || g.s.over) { box.hidden = true; box.innerHTML = ''; return; }
        const waited = (performance.now() - g.downAt) / 1000;
        box.hidden = false;
        if (waited < CLAIM_AFTER) {
            box.innerHTML = '<span class="aot-dim">waiting for them to come back... ' + Math.ceil(CLAIM_AFTER - waited) + 's</span>';
            g.netTimer = setTimeout(() => { if (G === g) renderNetChoice(g); }, 1000);
            return;
        }
        if (g.isHost) {
            box.innerHTML = `<span>still gone.</span>
                <button class="aot-btn" id="aot-subbot" type="button">a bot takes their seat</button>
                <button class="aot-btn aot-go" id="aot-claim" type="button">claim the win</button>`;
            box.querySelector('#aot-subbot').onclick = () => {
                g.brain = A.newBrain('normal', 'balanced', 77);
                g.subbed = true;
                g.netDown = 0;
                g.last = performance.now();
                renderNetChoice(g);
                say('a bot is playing their side until they come back');
            };
            box.querySelector('#aot-claim').onclick = () => {
                A.command(g.s, 1, { c: 'resign' });
                g.s.endWhy = 'gone';
                renderNetChoice(g);
            };
        } else {
            box.innerHTML = `<span>the host is gone, and the game lives on their machine.</span>
                <button class="aot-btn" id="aot-giveup" type="button">leave</button>`;
            box.querySelector('#aot-giveup').onclick = () => openMenu();
        }
    }

    // ===============================================================
    // replays. The rules write every command down with its tick (see the end
    // of age-of-troll-sim.js), so a whole match is a few kilobytes and fits in
    // a link: no server, nobody keeps a copy, the link is the replay.
    // ===============================================================
    const LINK_MAX = 8000;            // GitHub Pages answers 414 past about 8,180 characters of address
    const nameOf = (g, side) => g.names[side] || (side ? 'right' : 'left');

    function replayUrl(code) {
        const base = location.origin + location.pathname + '?app=ageoftroll';
        // the part after # never goes to the server, so a long one rides there
        return base + (base.length + 8 + code.length <= LINK_MAX ? '&replay=' : '#replay=') + code;
    }
    // a link, a pasted link with words round it, a file with one in, or the bare code
    function replayIn(text) {
        text = String(text || '').trim();
        const m = text.match(/[?&#]replay=([A-Za-z0-9_-]+)/);
        return m ? m[1] : text.replace(/\s+/g, '');
    }
    function forgetReplayUrl() {
        if (!/[?&#]replay=/.test(location.search + location.hash)) return;
        const url = window.WEB && WEB.urlFor ? WEB.urlFor('ageoftroll') : location.pathname + '?app=ageoftroll';
        try { history.replaceState(history.state, '', url); } catch (e) { }
        if (window.WEB && WEB.paintAddress) WEB.paintAddress();
    }

    // the finished match as a replay's text, made where the rules ran
    function makeReplay(g) {
        if (g.replayP) return g.replayP;
        const rp = A.replay.replayOf(g.s, { me: g.me, names: g.names, label: g.solo ? g.diff : 'online', why: g.s.endWhy });
        // a save from before replays existed has nothing written down
        if (!rp || rp.c.length / 2 > A.replay.LIMIT.cmds) return null;
        const match = g.s.match;
        g.replayP = A.replay.encode(rp).then(code => {
            if (G === g && g.s.match === match) { g.replayText = code; refreshShare(g); }
            return code;
        });
        return g.replayP;
    }
    // the host hands its copy over once, and again whenever the guest asks
    function sendReplay(g) {
        if (!g.replayText || !g.session || !g.session.alive || !g.s.over) return;
        g.session.send('aot:replay', { m: g.s.match, r: g.replayText }, g.guestId);
    }
    function askReplay(g) {
        if (!g.session) return;
        const match = g.s.match;
        let tries = 0;
        const ask = () => {
            if (G !== g || g.replayText || g.replayFail || g.s.match !== match || !g.s.over || tries++ > 12) return;
            if (g.session.alive) g.session.sendToHost('aot:replay?', { m: match });
            setTimeout(ask, 2500);
        };
        setTimeout(ask, 1500);
    }
    function takeReplay(g, d) {
        if (!d || typeof d.r !== 'string' || d.m !== g.s.match || g.replayText || g.replayP) return;
        if (d.r.length > A.replay.LIMIT.chars) return;
        // the host's copy, turned round so it opens on this side of the lane
        g.replayP = A.replay.decode(d.r).then(res => {
            if (!res.rp) { g.replayFail = res.why === 'old' ? 'the host runs another version' : 'it arrived broken'; return null; }
            res.rp.me = g.me;
            return A.replay.encode(res.rp);
        }).then(code => {
            if (code && G === g && g.s.match === d.m) g.replayText = code;
            else g.replayP = null;
            refreshShare(g);
            return code;
        });
    }

    function shareRow() {
        return `<div class="aot-row">
                <button class="aot-btn" id="aot-share" type="button" disabled>share the replay</button>
                <button class="aot-btn" id="aot-savefile" type="button" disabled>save it as a file</button>
            </div>
            <input class="aot-input" id="aot-replay-link" readonly hidden aria-label="the replay link">
            <p class="aot-dim" id="aot-replay-note" hidden></p>`;
    }
    function refreshShare(g) {
        const box = root && root.querySelector('#aot-end');
        const share = box && box.querySelector('#aot-share'), file = box && box.querySelector('#aot-savefile');
        if (!share || !file) return;
        const ready = !!g.replayText;
        share.disabled = file.disabled = !ready;
        share.textContent = ready ? 'share the replay'
            : g.replayFail ? 'no replay: ' + g.replayFail
                : g.isHost && !g.replayP ? 'no replay of this one'
                    : g.isHost ? 'writing the replay...' : 'getting the replay from the host...';
    }
    function bindShare(g, box) {
        box.querySelector('#aot-share').onclick = () => {
            if (!g.replayText) return;
            const url = replayUrl(g.replayText);
            const field = box.querySelector('#aot-replay-link'), note = box.querySelector('#aot-replay-note');
            field.hidden = false;
            field.value = url;
            try { field.select(); } catch (e) { }
            if (window.WEB && WEB.copy) WEB.copy(url, 'replay link copied');
            else if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => { });
            note.hidden = false;
            note.textContent = 'copied: ' + url.length + ' characters. whoever opens it watches the whole match from the start.' +
                (url.length > 2000 ? ' that is longer than a discord message, so send the file there.' : '');
        };
        box.querySelector('#aot-savefile').onclick = () => { if (g.replayText) saveReplayFile(g.replayText); };
        refreshShare(g);
    }
    // the same link, in a file: for a match too long for a chat box
    function saveReplayFile(code) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([replayUrl(code) + '\n'], { type: 'text/plain' }));
        a.download = 'age-of-troll-replay.txt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    // ---------------------------------------------------------------
    // watching one
    // ---------------------------------------------------------------
    const PROBLEM = {
        old: 'this replay is from an older version of age of troll. the rules have changed since, so it would play out wrong, and it is not going to pretend otherwise.',
        wrong: 'this replay does not play out the way it was recorded. somebody edited it, or the rules changed under it.',
        big: 'that is far too big to be a replay, bradar.',
        browser: 'this browser cannot unpack a replay. a newer one can.',
        broken: 'that is not a replay, or a piece of it is missing. was the whole link copied?'
    };
    let watchToken = null;

    function watchReplay(text) {
        ensureWindow();
        stopEverything();
        if (G) { leaveSession(G); G = null; }
        cv = null; ctx = null;
        const token = watchToken = {};
        root.innerHTML = '<div class="aot-menu"><p class="aot-dim" id="aot-loading">rewinding the tape...</p></div>';
        A.replay.decode(replayIn(text)).then(res => {
            if (watchToken !== token || !root) return;
            if (!res.rp) { replayProblem(res.why); return; }
            // a moment for that message to be seen: the whole match is played
            // once before it is shown, which is a few hundred milliseconds
            setTimeout(() => {
                if (watchToken !== token || !root) return;
                let v = null;
                try { v = A.replay.verify(res.rp); } catch (e) { v = null; }
                if (!v || !v.ok) { replayProblem('wrong'); return; }
                const w = { rp: res.rp, keys: v.keys, cur: { i: 0 }, playing: true, rate: 1, acc: 0, scrub: false };
                beginMatch(makeMatch({ watch: w, names: res.rp.names.slice() }));
            }, 40);
        });
    }
    function replayProblem(why) {
        root.innerHTML = `<div class="aot-menu"><div class="aot-dialog">
                <div class="aot-dtitle">age of troll: replay</div>
                <div class="aot-dbody">
                    <p id="aot-problem" data-why="${safe(why)}">${PROBLEM[why] || PROBLEM.broken}</p>
                    <div class="aot-row"><button class="aot-btn aot-go" id="aot-menu" type="button">back to the menu</button></div>
                </div>
            </div></div>`;
        root.querySelector('#aot-menu').onclick = () => openMenu();
    }

    function watchBar(g) {
        return `<div class="aot-foot" style="justify-content:flex-start">
                <button class="aot-btn aot-go" id="aot-play" type="button">pause (space)</button>
                ${[1, 2, 4, 8].map(r => `<button class="aot-btn" data-rate="${r}" type="button" aria-pressed="false">${r}x</button>`).join('')}
                <input type="range" id="aot-seek" min="0" max="${g.watch.rp.end}" step="1" value="0" aria-label="where in the match" style="flex:1 1 140px;min-width:90px">
                <span class="aot-chip" id="aot-wclock"></span>
                <button class="aot-btn" id="aot-side" type="button"></button>
                <button class="aot-btn" id="aot-quit" type="button">back to the menu</button>
            </div>`;
    }
    function bindWatchBar(g) {
        root.querySelector('#aot-play').onclick = () => watchPlay(g);
        root.querySelectorAll('[data-rate]').forEach(b => { b.onclick = () => watchRate(g, +b.dataset.rate); });
        const seek = root.querySelector('#aot-seek');
        seek.oninput = () => { g.watch.scrub = true; watchSeek(g, +seek.value); };
        seek.onchange = () => { g.watch.scrub = false; watchSeek(g, +seek.value); };
        root.querySelector('#aot-side').onclick = () => watchSide(g);
        root.querySelector('#aot-quit').onclick = () => openMenu();
    }
    function watchHud(g) {
        const w = g.watch, $ = id => root.querySelector(id);
        const play = $('#aot-play');
        if (!play) return;
        const t = g.s.over ? 'watch again' : w.playing ? 'pause (space)' : 'play (space)';
        if (play.textContent !== t) play.textContent = t;
        root.querySelectorAll('[data-rate]').forEach(b => {
            const on = +b.dataset.rate === w.rate;
            b.classList.toggle('aot-go', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        const seek = $('#aot-seek');
        if (!w.scrub && +seek.value !== g.s.tick) seek.value = g.s.tick;
        $('#aot-wclock').textContent = clock(A.seconds(g.s)) + ' / ' + clock(w.rp.end / HZ);
        const side = $('#aot-side'), st = 'watch ' + nameOf(g, 1 - g.me).slice(0, 14) + ' (C)';
        if (side.textContent !== st) side.textContent = st;
    }
    function watchDrive(g, dt) {
        const w = g.watch;
        if (!w.playing || g.s.over) return;
        // the tab coming back after a minute away does not fast-forward it
        w.acc += Math.min(dt, 0.25) * w.rate;
        while (w.acc >= DT && !g.s.over) { A.replay.tick(g.s, w.rp, w.cur); w.acc -= DT; }
        if (g.s.over) { w.playing = false; w.acc = 0; watchEnd(g); }
    }
    function watchPlay(g) {
        const w = g.watch;
        if (g.s.over) { watchSeek(g, 0); w.playing = true; }
        else w.playing = !w.playing;
        hud(g);
    }
    function watchRate(g, r) {
        g.watch.rate = r;
        hud(g);
    }
    function watchSide(g) {
        g.me = 1 - g.me;
        g.view.follow = true;
        hud(g);
    }
    // anywhere in the match: from the saved state before it, played forward
    function watchSeek(g, tick) {
        const w = g.watch;
        tick = Math.max(0, Math.min(w.rp.end, Math.round(tick)));
        if (tick === g.s.tick && (tick < w.rp.end || g.s.over)) return;
        const r = A.replay.seek(w.rp, w.keys, tick);
        r.s.ev = [];
        g.s = r.s; w.cur = r.cur; w.acc = 0;
        g.vis.clear();
        g.sparks = []; g.shots = []; g.corpses = []; g.rings = []; g.popups = []; g.floats = []; g.banners = []; g.flash = 0;
        if (g.s.over) { w.playing = false; watchEnd(g); } else hideEnd();
        hud(g);
    }
    function watchEnd(g) {
        const box = root && root.querySelector('#aot-end');
        if (!box) return;
        const s = g.s, rp = g.watch.rp, w = s.winner;
        const n = side => safe(nameOf(g, side));
        const title = w === -1 ? 'a draw' : n(w) + ' wins';
        const why = w === -1 ? 'both walls fell in the same breath.'
            : rp.why === 1 ? n(1 - w) + ' gave up.'
                : rp.why === 2 ? n(1 - w) + ' left and did not come back.'
                    : n(1 - w) + "'s wall came down.";
        const a = s.p[0], b = s.p[1];
        box.hidden = false;
        box.innerHTML = `
            <div class="aot-dialog">
                <div class="aot-dtitle">age of troll: replay</div>
                <div class="aot-dbody">
                    <div class="aot-result ${w === -1 ? '' : 'aot-won'}" id="aot-replay-result" data-winner="${w}">${title}</div>
                    <p>${why}</p>
                    <table class="aot-stats">
                        <tr><th></th><th>${n(0)}</th><th>${n(1)}</th></tr>
                        <tr><td>age</td><td>${a.age + 1}</td><td>${b.age + 1}</td></tr>
                        <tr><td>kills</td><td>${a.kills}</td><td>${b.kills}</td></tr>
                        <tr><td>wall hurt</td><td>${money(a.baseDmg)}</td><td>${money(b.baseDmg)}</td></tr>
                        <tr><td>gold made</td><td>${money(a.earned)}</td><td>${money(b.earned)}</td></tr>
                    </table>
                    <p class="aot-dim">${clock(A.seconds(s))} on the clock${rp.label ? ', ' + safe(rp.label === 'online' ? 'online' : 'against ' + (/^[aeiou]/.test(rp.label) ? 'an ' : 'a ') + rp.label + ' bot') : ''}</p>
                    <div class="aot-row">
                        <button class="aot-btn aot-go" id="aot-again" type="button">watch it again</button>
                        <button class="aot-btn" id="aot-look" type="button">look around</button>
                        <button class="aot-btn" id="aot-menu" type="button">back to the menu</button>
                    </div>
                </div>
            </div>`;
        box.querySelector('#aot-again').onclick = () => { watchSeek(g, 0); g.watch.playing = true; hideEnd(); hud(g); };
        box.querySelector('#aot-look').onclick = () => hideEnd();
        box.querySelector('#aot-menu').onclick = () => openMenu();
    }

    // ===============================================================
    // screens
    // ===============================================================
    function beginMatch(g) {
        stopEverything();
        G = g;
        warmSprites();
        warmAge(0);
        buildGame(g);
        bindNet(g);
        g.last = performance.now();
        driver = setInterval(drive, 50);
        raf = requestAnimationFrame(render);
        focusGame();
    }

    function startSolo(diff, plan) {
        ensureWindow();
        const planKey = plan && plan !== 'surprise' ? plan : pickPlan();
        const d = A.DIFFICULTIES[diff] ? diff : 'normal';
        const me = window.Netplay ? Netplay.profile().name : 'you';
        const bot = A.BOT_NAMES[Math.floor(Math.random() * A.BOT_NAMES.length)];
        if (G && !G.s.over) leaveSession(G);
        forget(SAVE);
        beginMatch(makeMatch({ solo: true, diff: d, plan: planKey, names: [me, bot] }));
    }
    const pickPlan = () => { const k = ['balanced', 'rush', 'greed', 'turtle']; return k[Math.floor(Math.random() * k.length)]; };

    function resumeSolo() {
        const data = load(SAVE, null);
        if (!data || !data.s || data.v !== 1) { openMenu(); return; }
        ensureWindow();
        const g = makeMatch({ solo: true, resume: data.s, brain: data.brain, diff: data.diff, plan: data.plan, names: data.names });
        beginMatch(g);
        pause(g, true, 'you');
    }

    function startOnline(session, opts) {
        ensureWindow();
        if (G) leaveOld(session);
        const list = (opts && opts.slots ? opts.slots.map(id => session.player(id)).filter(Boolean) : session.players.slice());
        const host = list.find(p => p.host) || list[0];
        const other = list.find(p => p !== host) || { id: null, name: 'nobody' };
        const g = makeMatch({ session, seed: opts && opts.seed, names: [host.name, other.name] });
        g.s.guessing = !session.isHost;
        beginMatch(g);
    }
    function leaveOld(session) {
        if (G && G.session && G.session !== session) leaveSession(G);
    }

    function openMenu() {
        ensureWindow();
        stopEverything();
        if (G) { leaveSession(G); G = null; }
        cv = null; ctx = null;
        forgetReplayUrl();
        const saved = load(SAVE, null);
        const m = load(META, { wins: 0, losses: 0 });
        const pref = load(META + '-pref', { diff: 'normal', plan: 'surprise' });
        const diffs = Object.keys(A.DIFFICULTIES).map(k => `<option value="${k}" ${k === pref.diff ? 'selected' : ''}>${k} — ${safe(A.DIFFICULTIES[k].note)}</option>`).join('');
        const plans = ['surprise', 'balanced', 'rush', 'greed', 'turtle'].map(k => `<option value="${k}" ${k === pref.plan ? 'selected' : ''}>${k === 'surprise' ? 'surprise me' : k}</option>`).join('');
        const parade = [0, 4, 8, 9, 12, 14].map(i => `<img src="${safe(A.UNITS[i].sprite)}" alt="" draggable="false">`).join('');
        root.innerHTML = `
            <div class="aot-menu">
                <div class="aot-logo">
                    <div class="aot-logo-title">age of troll</div>
                    <div class="aot-parade" aria-hidden="true">${parade}</div>
                    <div class="aot-sub">five ages. two walls. one lane. about half an hour of your life.</div>
                </div>
                <div class="aot-menu-grid">
                    <fieldset class="aot-group">
                        <legend>1 v bot</legend>
                        ${saved && saved.s ? `<button class="aot-btn aot-go aot-wide" id="aot-continue" type="button">continue: age ${saved.s.p[0].age + 1}, ${clock(saved.s.tick / HZ)} in, vs ${safe(saved.diff)}</button>` : ''}
                        <label class="aot-field">difficulty<select id="aot-diff" class="aot-input">${diffs}</select></label>
                        <label class="aot-field">its plan<select id="aot-plan" class="aot-input">${plans}</select></label>
                        <button class="aot-btn aot-go aot-wide" id="aot-solo" type="button">new game</button>
                    </fieldset>
                    <fieldset class="aot-group">
                        <legend>1 v 1 online</legend>
                        <p>make a lobby, send somebody the code or the link. the host's machine runs the game. a long match is fine, and it survives the link changing roads.</p>
                        <button class="aot-btn aot-go aot-wide" id="aot-online" type="button">open the lobby</button>
                        <button class="aot-btn aot-wide" id="aot-help2" type="button">how to play</button>
                        ${m.wins || m.losses ? `<p class="aot-dim">record: ${m.wins || 0} won, ${m.losses || 0} lost</p>` : ''}
                    </fieldset>
                </div>
                <fieldset class="aot-group" style="margin-top:8px">
                    <legend>replays</legend>
                    <p>every match ends with a link to watch it again. got one? paste it here, or open a saved replay file.</p>
                    <input class="aot-input" id="aot-paste" type="text" placeholder="paste a replay link" aria-label="a replay link" autocomplete="off" spellcheck="false">
                    <div class="aot-row">
                        <button class="aot-btn aot-go" id="aot-watch" type="button">watch it</button>
                        <button class="aot-btn" id="aot-file" type="button">open a replay file</button>
                        <input id="aot-fileinput" type="file" accept=".txt,text/plain" hidden>
                    </div>
                </fieldset>
            </div>`;
        root.querySelector('#aot-watch').onclick = () => {
            const t = root.querySelector('#aot-paste').value;
            if (t.trim()) watchReplay(t);
        };
        root.querySelector('#aot-paste').onkeydown = e => { if (e.key === 'Enter') root.querySelector('#aot-watch').click(); };
        const picker = root.querySelector('#aot-fileinput');
        root.querySelector('#aot-file').onclick = () => picker.click();
        picker.onchange = () => {
            const f = picker.files && picker.files[0];
            if (!f) return;
            // a replay file is a link in a text file. anything much bigger is not one
            if (f.size > A.replay.LIMIT.chars + 4096) { replayProblem('big'); return; }
            f.text().then(t => watchReplay(t), () => replayProblem('broken'));
        };
        const savePref = () => store(META + '-pref', { diff: root.querySelector('#aot-diff').value, plan: root.querySelector('#aot-plan').value });
        root.querySelector('#aot-diff').onchange = savePref;
        root.querySelector('#aot-plan').onchange = savePref;
        root.querySelector('#aot-solo').onclick = () => {
            savePref();
            startSolo(root.querySelector('#aot-diff').value, root.querySelector('#aot-plan').value);
        };
        const cont = root.querySelector('#aot-continue');
        if (cont) cont.onclick = () => resumeSolo();
        root.querySelector('#aot-online').onclick = () => {
            if (window.Netplay) Netplay.openLobby({ gameId: 'ageoftroll' });
            else if (typeof showToast === 'function') showToast('age of troll', 'netplay is not loaded');
        };
        root.querySelector('#aot-help2').onclick = () => openHelp();
    }

    function openHelp() {
        const { body } = createAppWindow('how to play age of troll', { icon: 'castle', width: 620 });
        body.classList.add('aot-helpbody');
        const row = (u) => `<tr><td><img src="${safe(u.sprite)}" alt=""></td><td>${safe(u.name)}</td><td>${A.ROLES[u.role]}</td><td>$${u.cost}</td><td>${u.hp}</td><td>${Math.round(u.dmg / u.cd)}</td><td>${u.range}</td></tr>`;
        body.innerHTML = `
            <h3>the idea</h3>
            <p>train units, they march at the enemy wall and fight on their own. kills pay gold and xp. xp and gold buy the next age: better units, a tougher wall. knock down their wall and you win.</p>
            <h3>the triangle</h3>
            <p><b>grunts</b> run down <b>shooters</b>. <b>shooters</b> pick <b>tanks</b> apart from behind the line. a <b>tank's</b> swing goes through a crowd of <b>grunts</b>. only one kind loses. look at what they are making and answer it.</p>
            <h3>the rest of the buttons</h3>
            <ul>
                <li><b>hold / march</b>: held units wait at your rally line, so they arrive as a wave and not a trickle. every kill pays the killer, so a trickle is a gift.</li>
                <li><b>turrets</b>: a ping gun reaches far, a spam cannon hits a crowd. every new age or two opens a slot. your wall also has a free firewall.</li>
                <li><b>modem</b>: more income forever. buy too many too early and a rush walks in.</li>
                <li><b>the server</b> in the middle pays whoever stands on it: more gold, more xp. sitting on your wall hands it over.</li>
                <li><b>special</b>: one per age, on a long cooldown, aimed at their front.</li>
                <li><b>overclock</b>: the age button once there are no ages left. how a stalemate breaks.</li>
                <li><b>disk full</b>: at ${Math.round(A.DISK_FULL_AT / 60)} minutes both walls start failing, so it always ends, and whoever was ahead wins.</li>
            </ul>
            <h3>keys</h3>
            <p>1 2 3 4 train · Q W turrets · X sell · E modem · R age · F hold/march · space special · P pause · arrows or drag to look around. on a phone everything is a button.</p>
            <h3>the roster</h3>
            <table class="aot-roster"><tr><th></th><th>name</th><th>role</th><th>cost</th><th>hp</th><th>dps</th><th>range</th></tr>${A.UNITS.map(row).join('')}</table>`;
    }

    // the lobby asks for a picture of each player. Everybody is a troll here
    function paintAvatar(canvas) {
        const c = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        c.clearRect(0, 0, w, h);
        c.fillStyle = '#008080'; c.fillRect(0, 0, w, h);
        const img = new Image();
        img.onload = () => {
            const k = Math.min((w - 8) / img.naturalWidth, (h - 8) / img.naturalHeight);
            const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
            c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        };
        img.src = A.UNITS[12].sprite;
    }

    // ===============================================================
    // wiring
    // ===============================================================
    if (window.Netplay) {
        Netplay.registerGame({
            id: 'ageoftroll',
            name: 'age of troll',
            start: (session, opts) => {
                if (opts && opts.solo) { openMenu(); return; }
                startOnline(session, opts);
            },
            startSolo: () => openMenu(),
            soloLabel: '1 v bot',
            paintAvatar
        });
    }

    window.startAgeOfTroll = function (mode) {
        ensureWindow();
        if (mode === 'bot') { startSolo(load(META + '-pref', { diff: 'normal' }).diff, 'surprise'); return; }
        // ?app=ageoftroll&replay=... : js/extras.js read it off the address before anything could tidy it away
        if (mode && typeof mode === 'object' && typeof mode.replay === 'string') { watchReplay(mode.replay); return; }
        openMenu();
    };
    // handy for the console, and for the browser test
    window.AOT_ENGINE = {
        state: () => G, issue, openMenu, startSolo, fit, speed: n => { speed = n; },
        // how many frames of each move have been drawn, for the browser test
        animStats: () => Object.assign({ sheets: Object.keys(SHEETS).filter(k => SHEETS[k].img).length }, animStats),
        watchReplay, replayUrl, seek: t => { if (G && G.watch) watchSeek(G, t); }
    };
})();
