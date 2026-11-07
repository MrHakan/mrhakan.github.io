// ===================================================================
// SIR, WE HAVE A TROLL PROBLEM — the rules
//
// Everything that decides what happens, and nothing that draws it: the road,
// the trolls, the towers and their upgrades, the money, the waves, and the
// bots. No page in here, so .github/scripts/check-troll-problem.mjs runs this
// same file in node and plays a few hundred games with it.
//
// One state, any number of seats (one to four), each with its own money and
// its own towers. Everything a player does goes through TP_SIM.command, which
// refuses what it should, so the host of an online game can feed it whatever
// a guest sends. Online, a guest runs this same simulation as a puppet: the
// trolls walk and the towers fire for show, and the host's snapshots say who
// is hurt, who is dead and who is where.
// ===================================================================
(function (root) {
    'use strict';
    const TP = root.TP;
    const S = {};
    const DT = TP.DT;
    const { hypot, min, max, floor, round, sqrt, atan2 } = Math;

    // ---------------------------------------------------------------
    // a seeded random number, so a seed is a game
    // ---------------------------------------------------------------
    function rng(seed) {
        let a = (seed >>> 0) || 1;
        const r = () => {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        return r;
    }
    S.rng = rng;

    // ---------------------------------------------------------------
    // the road: the map's waypoints with the corners rounded off
    // ---------------------------------------------------------------
    function buildPath(points, corner) {
        const pts = [];
        const P = points.map(p => ({ x: p[0], y: p[1] }));
        pts.push(P[0]);
        for (let i = 1; i < P.length - 1; i++) {
            const a = P[i - 1], p = P[i], b = P[i + 1];
            const l1 = hypot(p.x - a.x, p.y - a.y), l2 = hypot(b.x - p.x, b.y - p.y);
            const t = min(corner, l1 * 0.45, l2 * 0.45);
            const s = { x: p.x - (p.x - a.x) / l1 * t, y: p.y - (p.y - a.y) / l1 * t };
            const e = { x: p.x + (b.x - p.x) / l2 * t, y: p.y + (b.y - p.y) / l2 * t };
            // a quadratic curve through the corner: close enough to an arc
            for (let k = 0; k <= 8; k++) {
                const u = k / 8, v = 1 - u;
                pts.push({ x: v * v * s.x + 2 * v * u * p.x + u * u * e.x, y: v * v * s.y + 2 * v * u * p.y + u * u * e.y });
            }
        }
        pts.push(P[P.length - 1]);
        return lineOf(pts);
    }
    function lineOf(pts) {
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
        return { pts, cum, total: cum[cum.length - 1] };
    }
    S.buildPath = buildPath;
    // where on a line `d` is, starting the search at `hint`
    function along(line, d, hint) {
        const cum = line.cum, pts = line.pts, n = pts.length;
        let i = hint || 0;
        if (i > n - 2) i = n - 2;
        if (i < 0) i = 0;
        if (d < cum[i]) i = 0;
        while (i < n - 2 && cum[i + 1] < d) i++;
        const len = cum[i + 1] - cum[i] || 1;
        const u = max(0, min(1, (d - cum[i]) / len));
        const a = pts[i], b = pts[i + 1];
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, i, dx: b.x - a.x };
    }
    S.along = along;
    function segDist(px, py, ax, ay, bx, by) {
        const vx = bx - ax, vy = by - ay;
        const l2 = vx * vx + vy * vy || 1;
        const u = max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
        return hypot(px - (ax + vx * u), py - (ay + vy * u));
    }
    function roadDist(line, x, y) {
        let best = 1e9;
        const p = line.pts;
        for (let i = 0; i < p.length - 1; i++) {
            const d = segDist(x, y, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y);
            if (d < best) best = d;
        }
        return best;
    }
    S.roadDist = roadDist;

    // one road per map, built once
    const roads = {};
    function roadOf(map) {
        if (!roads[map.id]) {
            const road = buildPath(map.points, TP.CORNER);
            const a = road.pts[0], b = road.pts[road.pts.length - 1];
            // fliers go straight from where the road comes in to where it leaves
            const fly = lineOf([a, b]);
            // samples every 14 units, for the bots to judge a spot by
            const samples = [];
            for (let d = 0; d <= road.total; d += 14) { const p = along(road, d, 0); if (p.x > -10 && p.x < TP.W + 10 && p.y > -10 && p.y < TP.H + 10) samples.push(p); }
            const flySamples = [];
            for (let d = 0; d <= fly.total; d += 30) { const p = along(fly, d, 0); if (p.x > -10 && p.x < TP.W + 10) flySamples.push(p); }
            roads[map.id] = { road, fly, samples, flySamples };
        }
        return roads[map.id];
    }
    S.roadOf = roadOf;

    // ---------------------------------------------------------------
    // a tower's numbers: the base, and every tier bought on top
    // ---------------------------------------------------------------
    function statsOf(def, a, b) {
        const st = Object.assign({ pierce: 1, shots: 1, ap: 0, splash: 0, minRange: 0 }, def.base);
        const apply = mod => {
            if (!mod) return;
            if (mod.set) for (const k in mod.set) st[k] = mod.set[k];
            if (mod.add) for (const k in mod.add) st[k] = (st[k] || 0) + mod.add[k];
            if (mod.mul) for (const k in mod.mul) st[k] = (st[k] || 0) * mod.mul[k];
        };
        for (let i = 0; i < a; i++) apply(def.paths[0].tiers[i].mod);
        for (let i = 0; i < b; i++) apply(def.paths[1].tiers[i].mod);
        if (st.minRange < 0) st.minRange = 0;
        return st;
    }
    S.statsOf = statsOf;
    // can this path go up a tier: bought in order, and only one path past the cap
    function tierProblem(tw, p) {
        const now = p ? tw.b : tw.a, other = p ? tw.a : tw.b;
        if (now >= TP.TIERS) return 'max';
        if (now + 1 > TP.CROSS_CAP && other > TP.CROSS_CAP) return 'locked';
        return null;
    }
    S.tierProblem = tierProblem;
    // which picture: tier 4 of a path is that path's
    S.lookOf = tw => tw.a >= TP.TIERS ? 'a' : tw.b >= TP.TIERS ? 'b' : 'base';

    // ---------------------------------------------------------------
    // a new game
    // ---------------------------------------------------------------
    // o: { map, seats: [{ id, name }], seed, meta: { dmg: levels, ... } (solo only),
    //      unlocked: [tower ids] or null for all, puppet }
    S.newGame = function (o) {
        const map = TP.MAP_BY_ID[o.map] || TP.MAPS[0];
        const r = roadOf(map);
        const seats = (o.seats && o.seats.length ? o.seats : [{ id: 'me', name: 'you' }]).slice(0, TP.MAX_SEATS);
        const n = seats.length;
        const meta = o.meta || {};
        const lv = id => max(0, min(TP.META_BY_ID[id].max, meta[id] | 0));
        const per = id => TP.META_BY_ID[id].per * lv(id);
        const s = {
            map, road: r.road, fly: r.fly, seed: o.seed >>> 0, r: rng(o.seed || 1),
            n, puppet: !!o.puppet, quiet: !!o.quiet,
            mods: { dmg: per('dmg'), rate: per('rate'), range: per('range'), discount: per('discount'), bounty: per('bounty'), resale: per('resale') },
            unlocked: o.unlocked ? new Set(o.unlocked) : null,
            seats: seats.map((p, i) => ({ id: p.id, name: String(p.name || 'player ' + (i + 1)).slice(0, 16), gold: TP.coopStart(n) + (n === 1 ? per('start') : 0), on: true, ready: false, bot: !!p.bot })),
            lives: TP.START_LIVES + per('lives'),
            wave: 1, phase: 'prep', prep: TP.FIRST_PREP, waveT: 0,
            queue: [], qi: 0,
            enemies: [], towers: [], shots: [], clouds: [], ev: [],
            t: 0, tick: 0, nextId: 1, towerVer: 0,
            kills: 0, leaked: 0, leakByWave: [], cash: 0
        };
        return s;
    };

    // ---------------------------------------------------------------
    // money
    // ---------------------------------------------------------------
    const onSeats = s => { let k = 0; for (const p of s.seats) if (p.on) k++; return k || 1; };
    // everything the team earns is split evenly between whoever is still here
    function pay(s, amount) {
        if (s.puppet || amount <= 0) return;
        const share = amount * TP.coopIncome(s.n) / onSeats(s);
        let any = false;
        for (const p of s.seats) if (p.on) { p.gold += share; any = true; }
        if (!any) s.seats[0].gold += share;
        s.cash += amount;
    }
    S.pay = pay;
    S.towerCost = (s, def) => max(1, round(def.cost * (1 - s.mods.discount)));
    S.tierCost = (s, def, p, tier) => max(1, round(def.paths[p].tiers[tier].cost * (1 - s.mods.discount)));
    S.refundOf = (s, tw) => floor(tw.spent * (TP.SELL_REFUND + s.mods.resale));

    // ---------------------------------------------------------------
    // placing
    // ---------------------------------------------------------------
    function placeProblem(s, x, y, ignore) {
        const R = TP.TOWER_R;
        if (!(x >= R && x <= TP.W - R && y >= R && y <= TP.H - R)) return 'edge';
        if (roadDist(s.road, x, y) < TP.PATH_R + R - 2) return 'road';
        for (const t of s.towers) if (t !== ignore && hypot(t.x - x, t.y - y) < R * 2) return 'tower';
        return null;
    }
    S.placeProblem = placeProblem;

    // ---------------------------------------------------------------
    // commands: the only way a player changes anything
    // ---------------------------------------------------------------
    const finite = v => typeof v === 'number' && isFinite(v);
    S.towerById = (s, id) => { for (const t of s.towers) if (t.id === id) return t; return null; };
    S.command = function (s, seat, c) {
        if (!c || typeof c !== 'object' || typeof c.c !== 'string') return 'what';
        if (!(seat >= 0 && seat < s.seats.length) || seat !== (seat | 0)) return 'who';
        if (s.phase === 'won' || s.phase === 'lost') return 'over';
        const me = s.seats[seat];
        switch (c.c) {
            case 'place': {
                const def = typeof c.t === 'string' && Object.prototype.hasOwnProperty.call(TP.TOWERS_BY_ID, c.t) ? TP.TOWERS_BY_ID[c.t] : null;
                if (!def) return 'what';
                if (!finite(c.x) || !finite(c.y)) return 'what';
                if (s.unlocked && !s.unlocked.has(def.id)) return 'locked';
                const why = placeProblem(s, c.x, c.y);
                if (why) return why;
                const cost = S.towerCost(s, def);
                if (me.gold < cost) return 'gold';
                me.gold -= cost;
                const tw = {
                    id: s.nextId++, def, x: round(c.x * 10) / 10, y: round(c.y * 10) / 10, a: 0, b: 0, owner: seat,
                    mode: 'first', spent: cost, cd: 0.2, kills: 0, dmg: 0, st: null, e: null, buff: null
                };
                s.towers.push(tw);
                changed(s);
                return null;
            }
            case 'up': {
                const tw = S.towerById(s, c.i);
                if (!tw) return 'what';
                if (tw.owner !== seat) return 'mine';
                if (c.p !== 0 && c.p !== 1) return 'what';
                const why = tierProblem(tw, c.p);
                if (why) return why;
                const cost = S.tierCost(s, tw.def, c.p, c.p ? tw.b : tw.a);
                if (me.gold < cost) return 'gold';
                me.gold -= cost;
                tw.spent += cost;
                if (c.p) tw.b++; else tw.a++;
                changed(s);
                return null;
            }
            case 'sell': {
                const tw = S.towerById(s, c.i);
                if (!tw) return 'what';
                if (tw.owner !== seat) return 'mine';
                me.gold += S.refundOf(s, tw);
                s.towers.splice(s.towers.indexOf(tw), 1);
                changed(s);
                return null;
            }
            case 'mode': {
                const tw = S.towerById(s, c.i);
                if (!tw) return 'what';
                if (tw.owner !== seat) return 'mine';
                if (!TP.TARGET_MODES.some(m => m.id === c.m)) return 'what';
                tw.mode = c.m;
                s.towerVer++;
                return null;
            }
            case 'go': {
                if (s.phase !== 'prep') return 'wait';
                me.ready = true;
                if (s.seats.every(p => !p.on || p.ready)) startWave(s, true);
                return null;
            }
        }
        return 'what';
    };

    // the numbers a tower actually fires with: its tiers, the meta tree and any paperclip near it
    function changed(s) {
        s.towerVer++;
        refresh(s);
    }
    function refresh(s) {
        const m = s.mods;
        for (const t of s.towers) t.st = statsOf(t.def, t.a, t.b);
        const clips = s.towers.filter(t => t.def.kind === 'support');
        for (const t of s.towers) {
            const st = t.st;
            const buff = { dmg: 0, rate: 0, range: 0, ap: 0 };
            if (t.def.kind !== 'support') {
                for (const c of clips) {
                    const r = c.st.range * (1 + m.range);
                    if (hypot(c.x - t.x, c.y - t.y) > r) continue;
                    buff.dmg = max(buff.dmg, c.st.buffDmg || 0);
                    buff.rate = max(buff.rate, c.st.buffRate || 0);
                    buff.range = max(buff.range, c.st.buffRange || 0);
                    buff.ap = max(buff.ap, c.st.buffAp || 0);
                }
            }
            t.buff = buff;
            const dm = 1 + m.dmg + buff.dmg;
            t.e = {
                range: st.range * (1 + m.range) * (1 + buff.range),
                cd: (st.cd || 1) / (1 + m.rate + buff.rate),
                dmg: (st.dmg || 0) * dm,
                burn: (st.burn || 0) * dm,
                cloudDps: (st.cloudDps || 0) * dm,
                ap: (st.ap || 0) + buff.ap
            };
        }
    }
    S.refresh = refresh;

    // ---------------------------------------------------------------
    // waves
    // ---------------------------------------------------------------
    function startWave(s, early) {
        if (s.phase !== 'prep') return;
        if (early && s.prep > 0) pay(s, floor(s.prep * TP.EARLY_BONUS));
        s.phase = 'wave';
        s.waveT = 0;
        s.prep = 0;
        const spec = TP.WAVES[s.wave - 1] || [];
        const q = [];
        for (const [id, count, gap, at] of spec) for (let i = 0; i < count; i++) q.push({ at: at + i * gap, id });
        q.sort((a, b) => a.at - b.at);
        s.queue = q;
        s.qi = 0;
        s.waveLeaks = 0;
        for (const p of s.seats) p.ready = false;
        fx(s, 'wave', s.wave);
    }
    S.startWave = startWave;
    S.maxHpOf = (s, def) => round(def.hp * TP.waveHp(s.wave) * s.map.hp);
    function spawn(s, id, dist) {
        const def = TP.ENEMY_BY_ID[id];
        const hp = S.maxHpOf(s, def);
        const e = {
            id: s.nextId++, k: def.i, def, hp, max: hp, speed: def.speed * TP.waveSpeed(s.wave), armor: def.armor,
            dist: dist || 0, seg: 0, x: 0, y: 0, dir: 1, fly: !!def.flying,
            slowM: 1, slowT: 0, stunT: 0, stunImm: 0, brittle: 1, burnDps: 0, burnT: 0, burnSrc: null, spread: 0, curseT: 0, curse: 1,
            healT: def.heal ? def.heal.every : 0, sumT: def.summon ? def.summon.every : 0, dead: false, hit: 0
        };
        place(s, e);
        s.enemies.push(e);
        return e;
    }
    S.spawn = spawn;
    function place(s, e) {
        const p = along(e.fly ? s.fly : s.road, e.dist, e.seg);
        e.seg = p.i;
        e.x = p.x; e.y = p.y;
        if (p.dx > 0.01) e.dir = 1; else if (p.dx < -0.01) e.dir = -1;
    }
    const lineOfE = (s, e) => e.fly ? s.fly : s.road;
    const progress = (s, e) => e.dist / lineOfE(s, e).total;
    S.progress = progress;

    function waveOver(s) {
        const w = s.wave;
        s.leakByWave[w - 1] = s.waveLeaks || 0;
        pay(s, TP.waveReward(w));
        // a paperclip's money goes to whoever owns it, not to the team
        for (const t of s.towers) if (t.st.income) s.seats[t.owner].gold += t.st.income;
        fx(s, 'clear', w);
        if (w >= TP.TOTAL_WAVES) { s.phase = 'won'; fx(s, 'won', w); return; }
        s.wave++;
        s.phase = 'prep';
        s.prep = TP.PREP;
    }

    // ---------------------------------------------------------------
    // hurting things
    // ---------------------------------------------------------------
    function fx(s, ...a) { if (!s.quiet) s.ev.push(a); }
    function slow(e, mult, dur) {
        if (e.def.boss) mult = 1 - (1 - mult) * 0.5;
        if (e.slowT <= 0 || mult <= e.slowM) { e.slowM = mult; }
        if (dur > e.slowT) e.slowT = dur;
    }
    function stun(e, dur, brittle) {
        if (e.def.boss || e.stunImm > 0 || e.dead) return;
        if (dur > e.stunT) e.stunT = dur;
        if (brittle && brittle > e.brittle) e.brittle = brittle;
    }
    function hurt(s, e, amount, o, src) {
        if (e.dead || s.puppet) return;
        let d = amount;
        if (o.boss && e.def.boss) d *= o.boss;
        if (!o.tru) d = max(1, d - max(0, e.armor - (o.ap || 0)));
        if (e.stunT > 0) d *= e.brittle;
        if (e.curseT > 0) d *= e.curse;
        const dealt = min(d, e.hp);
        e.hp -= d;
        e.hit = 0.09;
        if (src) src.dmg += dealt;
        if (e.hp <= 0) kill(s, e, src);
    }
    function kill(s, e, src) {
        if (e.dead) return;
        e.dead = true;
        s.kills++;
        if (src) src.kills++;
        pay(s, e.def.bounty * (1 + s.mods.bounty));
        fx(s, 'die', e.x, e.y, e.k, e.dir, e.fly ? 1 : 0);
        // a burning troll passes the fire on
        if (e.burnT > 0 && e.spread > 0) {
            let n = e.spread;
            for (const o of s.enemies) {
                if (n <= 0) break;
                if (o.dead || o === e || o.burnT > 0 || o.fly) continue;
                if (hypot(o.x - e.x, o.y - e.y) > 70) continue;
                o.burnDps = e.burnDps; o.burnT = 2.5; o.burnSrc = e.burnSrc; o.spread = max(0, e.spread - 1);
                n--;
            }
        }
        if (e.def.split) {
            for (let i = 0; i < e.def.split.n; i++) {
                const c = spawn(s, e.def.split.id, max(0, e.dist - i * 9));
                c.stunImm = 0.3;
            }
        }
    }

    // ---------------------------------------------------------------
    // the trolls walk
    // ---------------------------------------------------------------
    function stepEnemies(s) {
        const E = s.enemies;
        for (let i = 0; i < E.length; i++) {
            const e = E[i];
            if (e.dead) continue;
            const def = e.def;
            if (e.hit > 0) e.hit -= DT;
            if (e.curseT > 0) e.curseT -= DT;
            if (!s.puppet) {
                if (e.burnT > 0) {
                    e.burnT -= DT;
                    hurt(s, e, e.burnDps * DT, { tru: true }, e.burnSrc);
                    if (e.dead) continue;
                } else if (def.regen && e.hp < e.max) e.hp = min(e.max, e.hp + e.max * def.regen * DT);
                if (def.heal) {
                    e.healT -= DT;
                    if (e.healT <= 0) {
                        e.healT = def.heal.every;
                        let any = false;
                        for (const o of E) {
                            if (o === e || o.dead || o.hp >= o.max || o.def.boss) continue;
                            if (hypot(o.x - e.x, o.y - e.y) > def.heal.radius) continue;
                            o.hp = min(o.max, o.hp + o.max * def.heal.pct);
                            any = true;
                        }
                        if (any) fx(s, 'heal', e.x, e.y, def.heal.radius);
                    }
                }
                if (def.summon) {
                    e.sumT -= DT;
                    if (e.sumT <= 0) {
                        e.sumT = def.summon.every;
                        for (let k = 0; k < def.summon.n; k++) spawn(s, def.summon.id, max(0, e.dist - 30 - k * 16));
                    }
                }
            } else if (e.burnT > 0) e.burnT -= DT;
            let sp = e.speed;
            if (e.stunT > 0) {
                e.stunT -= DT;
                sp = 0;
                if (e.stunT <= 0) { e.stunImm = 0.6; e.brittle = 1; }
            } else if (e.stunImm > 0) e.stunImm -= DT;
            if (e.slowT > 0) { e.slowT -= DT; sp *= e.slowM; } else e.slowM = 1;
            e.dist += sp * DT;
            place(s, e);
            if (e.dist >= lineOfE(s, e).total) {
                if (s.puppet) { e.dist = lineOfE(s, e).total; continue; }
                e.dead = true;
                e.leaked = true;
                s.lives -= def.leak;
                s.leaked++;
                s.waveLeaks = (s.waveLeaks || 0) + def.leak;
                fx(s, 'leak', e.x, e.y, def.leak);
                if (s.lives <= 0) { s.lives = 0; s.phase = 'lost'; fx(s, 'lost', s.wave); }
            }
        }
        // the dead go, in place
        let w = 0;
        for (let i = 0; i < E.length; i++) if (!E[i].dead) E[w++] = E[i];
        E.length = w;
    }

    // ---------------------------------------------------------------
    // the towers pick, and fire
    // ---------------------------------------------------------------
    // the n best targets for a tower, by its mode
    const pickBuf = [], keyBuf = [];
    function pick(s, t, n, range, minRange, air) {
        pickBuf.length = 0; keyBuf.length = 0;
        const mode = t.mode;
        for (const e of s.enemies) {
            if (e.dead) continue;
            if (e.fly && !air) continue;
            const d = hypot(e.x - t.x, e.y - t.y);
            if (d > range || d < minRange) continue;
            if (e.dist < 4) continue;      // still coming on to the board
            let k;
            switch (mode) {
                case 'last': k = progress(s, e); break;
                case 'strong': k = -e.hp - progress(s, e) * 0.001; break;
                case 'weak': k = e.hp - progress(s, e) * 0.001; break;
                case 'close': k = d; break;
                default: k = -progress(s, e);
            }
            // keep the best n, in order
            let j = keyBuf.length;
            if (j >= n && k >= keyBuf[j - 1]) continue;
            if (j < n) { keyBuf.push(k); pickBuf.push(e); }
            else { j = n - 1; keyBuf[j] = k; pickBuf[j] = e; }
            j = keyBuf.length - 1;
            while (j > 0 && keyBuf[j] < keyBuf[j - 1]) {
                const tk = keyBuf[j]; keyBuf[j] = keyBuf[j - 1]; keyBuf[j - 1] = tk;
                const te = pickBuf[j]; pickBuf[j] = pickBuf[j - 1]; pickBuf[j - 1] = te;
                j--;
            }
        }
        return pickBuf;
    }
    S.pick = (s, t) => pick(s, t, t.st.shots || 1, t.e.range, t.st.minRange || 0, !!t.st.air).slice();
    // where a troll will be in `time` seconds, if nothing changes
    function ahead(s, e, time) {
        let sp = e.stunT > 0 ? 0 : e.speed * (e.slowT > 0 ? e.slowM : 1);
        const line = lineOfE(s, e);
        return along(line, min(line.total, e.dist + sp * time), e.seg);
    }
    function payload(t) {
        const st = t.st, e = t.e;
        return {
            dmg: e.dmg, ap: e.ap, tru: !!st.true, boss: st.boss || 0, splash: st.splash || 0, air: !!st.air,
            slow: st.slow || 0, slowDur: st.slowDur || 0, stun: st.stun || 0, brittle: st.brittle || 0,
            burn: e.burn, burnDur: st.burnDur || 0, spread: st.spread || 0
        };
    }
    function stepTowers(s) {
        for (const t of s.towers) {
            if (t.def.kind === 'support') continue;
            const st = t.st;
            if (st.aura) {
                const r = t.e.range;
                for (const e of s.enemies) if (!e.dead && hypot(e.x - t.x, e.y - t.y) <= r) slow(e, st.slow, 0.25);
            }
            t.cd -= DT;
            if (t.cd > 0) continue;
            const targets = pick(s, t, st.shots || 1, t.e.range, st.minRange || 0, !!st.air);
            if (!targets.length) { t.cd = 0; continue; }
            t.cd += t.e.cd;
            if (t.cd < 0) t.cd = 0;
            fire(s, t, targets.slice());
        }
    }
    function fire(s, t, targets) {
        const st = t.st, k = t.def.kind;
        const pl = payload(t);
        fx(s, 'fire', t.id, targets[0].x, targets[0].y);
        if (k === 'chain') {
            const hit = new Set();
            let cur = targets[0], d = pl.dmg;
            const pts = [t.x, t.y];
            for (let i = 0; i < (st.chain || 1) && cur; i++) {
                hit.add(cur);
                pts.push(round(cur.x), round(cur.y));
                hurt(s, cur, d, pl, t);
                if (pl.stun) stun(cur, pl.stun, 0);
                d *= st.chainFall || 1;
                let next = null, nd = 80;
                for (const e of s.enemies) {
                    if (e.dead || hit.has(e) || (e.fly && !pl.air)) continue;
                    const dd = hypot(e.x - cur.x, e.y - cur.y);
                    if (dd < nd) { nd = dd; next = e; }
                }
                cur = next;
            }
            fx(s, 'zap', pts);
            return;
        }
        for (let n = 0; n < targets.length; n++) {
            const e = targets[n];
            if (k === 'lob' || k === 'cloud') {
                const flight = st.flight || 0.8;
                const per = k === 'cloud' ? (st.clouds || 1) : 1;
                for (let c = 0; c < per; c++) {
                    const p = c ? along(lineOfE(s, e), min(lineOfE(s, e).total, e.dist + e.speed * flight + 60 * c), e.seg) : ahead(s, e, flight);
                    s.shots.push({ k, src: t, x0: t.x, y0: t.y - 14, x: t.x, y: t.y - 14, x1: p.x, y1: p.y, t: 0, T: flight, pl, ti: t.def.i });
                }
            } else if ((st.pierce || 1) > 1) {
                // a straight line through whatever is in the way
                const d0 = hypot(e.x - t.x, e.y - t.y);
                const p = ahead(s, e, d0 / st.speed);
                const dx = p.x - t.x, dy = p.y - t.y, l = hypot(dx, dy) || 1;
                s.shots.push({ k: 'line', src: t, x: t.x, y: t.y - 10, vx: dx / l * st.speed, vy: dy / l * st.speed, left: t.e.range * 1.25, pierce: st.pierce, hit: [], pl, ti: t.def.i });
            } else {
                s.shots.push({ k: 'homing', src: t, x: t.x, y: t.y - 14, tgt: e, tx: e.x, ty: e.y, sp: st.speed, life: 3, pl, ti: t.def.i });
            }
        }
    }
    function land(s, sh, x, y, target) {
        const pl = sh.pl;
        if (pl.splash > 0) {
            fx(s, 'boom', round(x), round(y), pl.splash, sh.ti);
            for (const e of s.enemies) {
                if (e.dead || (e.fly && !pl.air)) continue;
                if (hypot(e.x - x, e.y - y) > pl.splash + e.def.size * 0.25) continue;
                strike(s, e, pl, sh.src);
            }
        } else if (target && !target.dead) strike(s, target, pl, sh.src);
    }
    function strike(s, e, pl, src) {
        if (pl.slow) slow(e, pl.slow, pl.slowDur);
        if (pl.stun) stun(e, pl.stun, pl.brittle);
        if (pl.burn > 0 && !e.fly) {
            if (e.burnT <= 0 || pl.burn >= e.burnDps) { e.burnDps = pl.burn; e.burnSrc = src; }
            e.burnT = max(e.burnT, pl.burnDur);
            if (pl.spread > e.spread) e.spread = pl.spread;
        }
        if (pl.dmg > 0) hurt(s, e, pl.dmg, pl, src);
    }
    function stepShots(s) {
        const L = s.shots;
        for (let i = 0; i < L.length; i++) {
            const sh = L[i];
            if (sh.dead) continue;
            if (sh.k === 'lob' || sh.k === 'cloud') {
                sh.t += DT;
                const u = min(1, sh.t / sh.T);
                sh.x = sh.x0 + (sh.x1 - sh.x0) * u;
                sh.y = sh.y0 + (sh.y1 - sh.y0) * u;
                if (u >= 1) {
                    sh.dead = true;
                    if (sh.k === 'cloud') {
                        const st = sh.src.st;
                        s.clouds.push({ x: sh.x1, y: sh.y1, r: st.cloudR, dps: sh.src.e.cloudDps, slow: st.cloudSlow || 1, curse: st.curse || 0, t: st.cloudDur, T: st.cloudDur, acc: 0, src: sh.src });
                    } else land(s, sh, sh.x1, sh.y1, null);
                }
            } else if (sh.k === 'line') {
                const x0 = sh.x, y0 = sh.y;
                sh.x += sh.vx * DT; sh.y += sh.vy * DT;
                sh.left -= hypot(sh.vx, sh.vy) * DT;
                for (const e of s.enemies) {
                    if (e.dead || (e.fly && !sh.pl.air) || sh.hit.indexOf(e.id) >= 0) continue;
                    if (segDist(e.x, e.y, x0, y0, sh.x, sh.y) > e.def.size * 0.35 + 6) continue;
                    sh.hit.push(e.id);
                    strike(s, e, sh.pl, sh.src);
                    if (sh.hit.length >= sh.pierce) break;
                }
                if (sh.hit.length >= sh.pierce || sh.left <= 0 || sh.x < -40 || sh.x > TP.W + 40 || sh.y < -40 || sh.y > TP.H + 40) sh.dead = true;
            } else {
                const e = sh.tgt;
                if (e && !e.dead) { sh.tx = e.x; sh.ty = e.y; }
                const dx = sh.tx - sh.x, dy = sh.ty - sh.y, d = hypot(dx, dy);
                const step = sh.sp * DT;
                sh.life -= DT;
                if (d <= step + 3 || sh.life <= 0) {
                    sh.x = sh.tx; sh.y = sh.ty;
                    sh.dead = true;
                    land(s, sh, sh.x, sh.y, e && !e.dead ? e : null);
                } else { sh.x += dx / d * step; sh.y += dy / d * step; }
            }
        }
        let w = 0;
        for (let i = 0; i < L.length; i++) if (!L[i].dead) L[w++] = L[i];
        L.length = w;
    }
    function stepClouds(s) {
        const C = s.clouds;
        for (const c of C) {
            c.t -= DT;
            c.acc += DT;
            if (c.acc < 0.25) continue;
            c.acc -= 0.25;
            for (const e of s.enemies) {
                if (e.dead || e.fly) continue;
                if (hypot(e.x - c.x, e.y - c.y) > c.r + e.def.size * 0.2) continue;
                slow(e, c.slow, 0.35);
                if (c.curse) { e.curseT = 0.35; e.curse = c.curse; }
                hurt(s, e, c.dps * 0.25, { tru: true }, c.src);
            }
        }
        let w = 0;
        for (let i = 0; i < C.length; i++) if (C[i].t > 0) C[w++] = C[i];
        C.length = w;
    }

    // ---------------------------------------------------------------
    // one step of the game, DT seconds of it
    // ---------------------------------------------------------------
    S.step = function (s) {
        if (s.phase === 'won' || s.phase === 'lost') return;
        s.t += DT;
        s.tick++;
        if (s.phase === 'prep') {
            if (!s.puppet) {
                s.prep -= DT;
                if (s.prep <= 0) startWave(s, false);
            } else if (s.prep > 0) s.prep = max(0, s.prep - DT);
        } else if (s.phase === 'wave') {
            s.waveT += DT;
            if (!s.puppet) while (s.qi < s.queue.length && s.queue[s.qi].at <= s.waveT) spawn(s, s.queue[s.qi++].id, 0);
        }
        stepClouds(s);
        stepEnemies(s);
        if (s.phase === 'lost') return;
        stepTowers(s);
        stepShots(s);
        if (!s.puppet && s.phase === 'wave' && s.qi >= s.queue.length && !s.enemies.length) waveOver(s);
    };

    // a seat leaving or coming back. Its towers stay where they are either way
    S.seatOn = function (s, seat, on, id, name) {
        const p = s.seats[seat];
        if (!p) return;
        p.on = !!on;
        if (id !== undefined) p.id = id;
        if (name !== undefined) p.name = String(name).slice(0, 16);
        if (!on) p.ready = false;
        // a wave waiting on somebody who has gone does not wait any more
        if (!on && s.phase === 'prep' && s.seats.some(q => q.on) && s.seats.every(q => !q.on || q.ready)) startWave(s, true);
    };

    // ---------------------------------------------------------------
    // the wire: what a host sends, and what a guest makes of it
    // ---------------------------------------------------------------
    const PHASES = ['prep', 'wave', 'won', 'lost'];
    S.snapshot = function (s) {
        const e = [];
        for (const x of s.enemies) {
            if (x.dead) continue;
            const f = (x.slowT > 0 ? 1 : 0) | (x.burnT > 0 ? 2 : 0) | (x.stunT > 0 ? 4 : 0) | (x.curseT > 0 ? 8 : 0);
            e.push(x.id, x.k, round(x.dist), max(1, round(x.hp / x.max * 999)), f);
        }
        return {
            k: s.tick, w: s.wave, ph: PHASES.indexOf(s.phase), pr: round(s.prep * 10), lv: max(0, round(s.lives)),
            g: s.seats.map(p => floor(p.gold)), on: s.seats.map(p => (p.on ? 1 : 0) | (p.ready ? 2 : 0)),
            kl: s.kills, tv: s.towerVer, e
        };
    };
    S.seatList = s => s.seats.map(p => [p.id, p.name]);
    S.towerList = s => s.towers.map(t => [t.id, t.def.i, t.x, t.y, t.a, t.b, TP.TARGET_MODES.findIndex(m => m.id === t.mode), t.owner, t.spent]);
    S.applySeats = function (s, list) {
        if (!Array.isArray(list)) return;
        list.slice(0, TP.MAX_SEATS).forEach((p, i) => {
            if (!Array.isArray(p)) return;
            if (!s.seats[i]) s.seats[i] = { id: '', name: '', gold: 0, on: true, ready: false };
            s.seats[i].id = String(p[0]);
            s.seats[i].name = String(p[1] || '').slice(0, 16);
        });
        s.seats.length = min(s.seats.length, list.length);
    };
    S.applyTowers = function (s, list) {
        if (!Array.isArray(list)) return;
        const old = new Map(s.towers.map(t => [t.id, t]));
        const out = [];
        for (const r of list) {
            if (!Array.isArray(r)) continue;
            const def = TP.TOWERS[r[1]];
            if (!def) continue;
            let t = old.get(r[0]);
            if (!t) t = { id: r[0], def, x: 0, y: 0, a: 0, b: 0, owner: 0, mode: 'first', spent: 0, cd: 0.3, kills: 0, dmg: 0 };
            t.def = def; t.x = +r[2]; t.y = +r[3];
            t.a = max(0, min(TP.TIERS, r[4] | 0)); t.b = max(0, min(TP.TIERS, r[5] | 0));
            t.mode = (TP.TARGET_MODES[r[6]] || TP.TARGET_MODES[0]).id;
            t.owner = r[7] | 0; t.spent = +r[8] || 0;
            out.push(t);
        }
        s.towers = out;
        refresh(s);
    };
    // returns the trolls that went since the last one, for the view to see off
    S.applySnapshot = function (s, d) {
        if (!d || typeof d !== 'object' || !Array.isArray(d.e)) return null;
        if (typeof d.w === 'number' && d.w !== s.wave) s.wave = max(1, min(TP.TOTAL_WAVES, d.w | 0));
        s.phase = PHASES[d.ph] || s.phase;
        s.prep = (+d.pr || 0) / 10;
        s.lives = +d.lv || 0;
        s.kills = +d.kl || 0;
        if (Array.isArray(d.g)) d.g.forEach((v, i) => { if (s.seats[i]) s.seats[i].gold = +v || 0; });
        if (Array.isArray(d.on)) d.on.forEach((v, i) => { if (s.seats[i]) { s.seats[i].on = !!(v & 1); s.seats[i].ready = !!(v & 2); } });
        const have = new Map();
        for (const e of s.enemies) have.set(e.id, e);
        const keep = [];
        const a = d.e;
        for (let i = 0; i + 4 < a.length; i += 5) {
            const id = a[i], def = TP.ENEMIES[a[i + 1]];
            if (!def) continue;
            let e = have.get(id);
            if (!e) {
                e = spawnPuppet(s, def, id);
            } else have.delete(id);
            const dist = +a[i + 2] || 0;
            // close enough is left alone, so a walking troll does not stutter
            if (Math.abs(dist - e.dist) > 6) e.dist = dist;
            e.hp = e.max * (a[i + 3] / 999);
            const f = a[i + 4] | 0;
            e.slowT = f & 1 ? 0.3 : 0; if (f & 1) e.slowM = min(e.slowM, 0.6); else e.slowM = 1;
            e.burnT = f & 2 ? 0.3 : 0;
            e.stunT = f & 4 ? 0.3 : 0;
            e.curseT = f & 8 ? 0.3 : 0;
            place(s, e);
            keep.push(e);
        }
        const gone = [...have.values()];
        s.enemies = keep;
        return gone;
    };
    function spawnPuppet(s, def, id) {
        const hp = S.maxHpOf(s, def);
        const e = {
            id, k: def.i, def, hp, max: hp, speed: def.speed * TP.waveSpeed(s.wave), armor: def.armor,
            dist: 0, seg: 0, x: 0, y: 0, dir: 1, fly: !!def.flying,
            slowM: 1, slowT: 0, stunT: 0, stunImm: 0, brittle: 1, burnDps: 0, burnT: 0, burnSrc: null, spread: 0, curseT: 0, curse: 1,
            healT: 0, sumT: 0, dead: false, hit: 0
        };
        return e;
    }

    // ---------------------------------------------------------------
    // a run you can come back to (solo)
    // ---------------------------------------------------------------
    S.saveOf = s => ({
        v: 3, map: s.map.id, wave: s.wave, lives: s.lives, gold: floor(s.seats[0].gold), kills: s.kills, leaked: s.leaked,
        towers: s.towers.map(t => [t.def.id, t.x, t.y, t.a, t.b, t.mode, t.spent])
    });
    S.restore = function (save, o) {
        if (!save || save.v !== 3 || !TP.MAP_BY_ID[save.map]) return null;
        const s = S.newGame(Object.assign({}, o, { map: save.map }));
        s.wave = max(1, min(TP.TOTAL_WAVES, save.wave | 0));
        s.lives = max(1, +save.lives || 1);
        s.seats[0].gold = max(0, +save.gold || 0);
        s.kills = save.kills | 0; s.leaked = save.leaked | 0;
        s.prep = TP.PREP;
        for (const r of Array.isArray(save.towers) ? save.towers : []) {
            const def = TP.TOWERS_BY_ID[r && r[0]];
            if (!def || !finite(r[1]) || !finite(r[2])) continue;
            if (placeProblem(s, r[1], r[2])) continue;
            const a = max(0, min(TP.TIERS, r[3] | 0)), b = max(0, min(TP.TIERS, r[4] | 0));
            if (a > TP.CROSS_CAP && b > TP.CROSS_CAP) continue;
            s.towers.push({ id: s.nextId++, def, x: r[1], y: r[2], a, b, owner: 0, mode: TP.TARGET_MODES.some(m => m.id === r[5]) ? r[5] : 'first', spent: +r[6] || def.cost, cd: 0.2, kills: 0, dmg: 0 });
        }
        changed(s);
        return s;
    };

    // ---------------------------------------------------------------
    // the permanent upgrades, kept in localStorage. A save from the old
    // game (towers on a grid, a different tree) gets every crystal it spent
    // back, keeps its records and loses nothing else worth keeping.
    // ---------------------------------------------------------------
    const OLD_TREE = { dmg: [2, 2], rate: [2, 2], range: [3, 2], gold: [3, 3], start: [2, 2], lives: [4, 3], discount: [4, 3], crystal: [5, 4] };
    S.defaultMeta = () => ({ v: 3, crystals: 0, spent: {}, bestWave: {}, wins: {}, unlockedMaps: [TP.MAPS[0].id], runs: 0, totalKills: 0, totalLeaks: 0, cleared: false });
    S.migrateMeta = function (raw) {
        const m = S.defaultMeta();
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return m;
        const num = v => (typeof v === 'number' && isFinite(v) && v >= 0 ? floor(v) : 0);
        m.crystals = num(raw.crystals);
        m.runs = num(raw.runs); m.totalKills = num(raw.totalKills); m.totalLeaks = num(raw.totalLeaks);
        m.cleared = !!raw.cleared;
        const bw = raw.bestWave && typeof raw.bestWave === 'object' ? raw.bestWave : {};
        for (const map of TP.MAPS) if (num(bw[map.id])) m.bestWave[map.id] = min(TP.TOTAL_WAVES, num(bw[map.id]));
        if (Array.isArray(raw.unlockedMaps)) for (const id of raw.unlockedMaps) if (TP.MAP_BY_ID[id] && m.unlockedMaps.indexOf(id) < 0) m.unlockedMaps.push(id);
        const spent = raw.spent && typeof raw.spent === 'object' ? raw.spent : {};
        if (raw.v === 3) {
            for (const node of TP.META) { const l = min(node.max, num(spent[node.id])); if (l) m.spent[node.id] = l; }
            if (raw.wins && typeof raw.wins === 'object') for (const map of TP.MAPS) if (raw.wins[map.id]) m.wins[map.id] = true;
            if (num(raw.refunded)) m.refunded = num(raw.refunded);
        } else {
            // the old tree, bought back at what it cost
            let back = 0;
            for (const id in OLD_TREE) { const l = min(10, num(spent[id])); for (let k = 0; k < l; k++) back += OLD_TREE[id][0] + OLD_TREE[id][1] * k; }
            m.crystals += back;
            if (back) m.refunded = back;
        }
        m.unlockedMaps.sort((a, b) => TP.MAP_BY_ID[a].i - TP.MAP_BY_ID[b].i);
        return m;
    };
    // which towers a player has: the pointer post, and every tower whose wave they have reached
    S.unlockedTowers = meta => {
        const best = max(0, ...Object.values(meta.bestWave || {}).map(Number).filter(isFinite));
        return TP.TOWERS.filter(t => !TP.TOWER_UNLOCKS[t.id] || best >= TP.TOWER_UNLOCKS[t.id]).map(t => t.id);
    };

    // ===============================================================
    // BOTS
    //
    // A bot is a plan: which towers it likes, which path it takes on each, how
    // many towers it wants by which wave, and whether it pours its money into
    // one tower or spreads it. They are the balance instrument: the check plays
    // the maps with a lot of different plans and holds the results to targets.
    // ===============================================================
    const AIR = ['pointer', 'fan', 'modem', 'fax', 'hammer'];
    S.STRATS = {
        smart: {
            weights: { pointer: 2, floppy: 2, fan: 1.2, cpu: 1, modem: 1.5, fax: 1.4, catapult: 1, spam: 1, clip: 0.6, hammer: 1 },
            paths: { pointer: 0, floppy: 1, fan: 1, cpu: 1, modem: 0, fax: 1, catapult: 0, spam: 1, clip: 0, hammer: 1 },
            n0: 3, slope: 0.45, maxT: 18, focus: 0.4,
            modes: { fax: 'strong', hammer: 'strong' }
        }
    };
    S.newBot = function (strat, seed) {
        const st = typeof strat === 'string' ? S.STRATS[strat] : strat;
        return { st, r: rng(seed || 7), next: 0, want: null };
    };
    const order = [[0, 1], [0, 2], [1, 1], [1, 2], [0, 3], [0, 4]];
    // the next tier this bot would buy on a tower: main path to 2, the other to 2, then the main to 4
    function nextTier(bot, tw) {
        const main = bot.st.paths[tw.def.id] !== undefined ? bot.st.paths[tw.def.id] : (tw.id % 2);
        for (const [which, lvl] of order) {
            const p = which === 0 ? main : 1 - main;
            const now = p ? tw.b : tw.a;
            if (now >= lvl) continue;
            if (tierProblem(tw, p)) return null;
            return p;
        }
        return null;
    }
    S.nextTier = nextTier;
    // what a bot will save up for at this point of the game
    const budget = (s, gold) => max(gold, 450 + 160 * (s.wave - 1));
    function choose(bot, weights, s, gold) {
        let total = 0;
        const list = [];
        const cap = budget(s, gold || 0);
        for (const id in weights) {
            if (weights[id] <= 0) continue;
            if (s.unlocked && !s.unlocked.has(id)) continue;
            if (S.towerCost(s, TP.TOWERS_BY_ID[id]) > cap) continue;
            list.push(id); total += weights[id];
        }
        let x = bot.r() * total;
        for (const id of list) { x -= weights[id]; if (x <= 0) return id; }
        return list[list.length - 1] || 'pointer';
    }
    // the best free spot for a tower: the most road (or the most friends) in range
    S.bestSpot = function (s, def, seat, noise, r) {
        const R = roadOf(s.map);
        const st = statsOf(def, 0, 0);
        const range = st.range * (1 + s.mods.range), minR = st.minRange || 0;
        let best = null, bestScore = -1;
        const rr = r || Math.random;
        for (let y = TP.TOWER_R + 2; y <= TP.H - TP.TOWER_R; y += 18) {
            for (let x = TP.TOWER_R + 2; x <= TP.W - TP.TOWER_R; x += 18) {
                if (placeProblem(s, x, y)) continue;
                let score = 0;
                if (def.kind === 'support') {
                    for (const t of s.towers) if (t.def.kind !== 'support' && hypot(t.x - x, t.y - y) <= range) score += t.spent * (t.owner === seat ? 1 : 0.5);
                } else {
                    for (const p of R.samples) { const d = hypot(p.x - x, p.y - y); if (d <= range && d >= minR) score++; }
                    if (st.air) for (const p of R.flySamples) { const d = hypot(p.x - x, p.y - y); if (d <= range) score += 0.7; }
                }
                score *= 1 + (noise || 0) * (rr() - 0.5);
                if (score > bestScore) { bestScore = score; best = { x, y }; }
            }
        }
        return best;
    };
    // what the bot does this moment: null, or a command it wants
    S.think = function (s, seat, bot) {
        if (s.phase === 'won' || s.phase === 'lost') return null;
        if (s.t < bot.next) return null;
        bot.next = s.t + 0.5;
        const me = s.seats[seat], st = bot.st;
        const mine = s.towers.filter(t => t.owner === seat);
        // a boss on the road: everything that can hurt it looks for the biggest troll, as a person would
        const boss = s.phase === 'wave' && TP.isBossWave(s.wave);
        if (boss !== !!bot.bossMode) {
            bot.bossMode = boss;
            for (const t of mine) if (t.def.kind === 'shot' || t.def.kind === 'chain') S.command(s, seat, { c: 'mode', i: t.id, m: boss ? 'strong' : ((st.modes && st.modes[t.def.id]) || 'first') });
        }
        // what it is saving for
        if (!bot.want) bot.want = plan(s, seat, bot, mine);
        const w = bot.want;
        if (!w) return null;
        if (me.gold < w.cost) return null;
        bot.want = null;
        let c;
        if (w.kind === 'build') {
            const def = TP.TOWERS_BY_ID[w.t];
            const spot = S.bestSpot(s, def, seat, st.noise || 0.08, bot.r);
            if (!spot) return null;
            c = { c: 'place', t: w.t, x: spot.x, y: spot.y };
        } else c = { c: 'up', i: w.i, p: w.p };
        const why = S.command(s, seat, c);
        if (!why && c.c === 'place') {
            const tw = s.towers[s.towers.length - 1];
            if (st.modes && st.modes[tw.def.id]) tw.mode = st.modes[tw.def.id];
        }
        return why ? null : c;
    };
    function plan(s, seat, bot, mine) {
        const st = bot.st, me = s.seats[seat];
        const spent = mine.reduce((a, t) => a + t.spent, 0);
        const fighters = mine.filter(t => t.def.kind !== 'support');
        // fliers come on wave 7: something that can hit them by then
        const airSpent = mine.filter(t => t.st && t.st.air && t.def.kind !== 'support').reduce((a, t) => a + t.spent, 0);
        const needAir = (s.wave >= 6 && airSpent === 0) || (s.wave >= 12 && airSpent < spent * (st.airShare || 0.2));
        // in company, everybody builds their share
        const share = s.n > 1 ? 1 / s.n : 1;
        const desired = min(st.maxT || 14, Math.ceil(((st.n0 || 2) + s.wave * (st.slope || 0.3)) * share));
        if (!fighters.length || needAir || mine.length < desired) {
            let id;
            if (needAir) {
                const air = {};
                for (const k of AIR) if (st.weights[k] > 0) air[k] = st.weights[k];
                id = Object.keys(air).length ? choose(bot, air, s, me.gold) : 'pointer';
            } else if (!fighters.length) {
                const w = Object.assign({}, st.weights); delete w.clip;
                id = choose(bot, w, s, me.gold);
            } else {
                const w = Object.assign({}, st.weights);
                // a paperclip with nothing round it helps nobody
                if (fighters.length < 3) delete w.clip;
                id = choose(bot, w, s, me.gold);
            }
            if (s.unlocked && !s.unlocked.has(id)) id = 'pointer';
            const def = TP.TOWERS_BY_ID[id];
            return { kind: 'build', t: id, cost: S.towerCost(s, def) };
        }
        // an upgrade: the most invested tower first when focused, the cheapest otherwise
        let best = null;
        const focus = bot.r() < (st.focus === undefined ? 0.5 : st.focus);
        const cap = budget(s, me.gold);
        for (const t of mine) {
            const p = nextTier(bot, t);
            if (p === null) continue;
            const cost = S.tierCost(s, t.def, p, p ? t.b : t.a);
            if (cost > cap) continue;
            const score = focus ? -t.spent : cost;
            if (!best || score < best.score) best = { kind: 'up', i: t.id, p, cost, score };
        }
        if (best) return best;
        const w = Object.assign({}, st.weights);
        const id = choose(bot, w, s, me.gold);
        return { kind: 'build', t: id, cost: S.towerCost(s, TP.TOWERS_BY_ID[id]) };
    }

    root.TP_SIM = S;
})(typeof window !== 'undefined' ? window : globalThis);
