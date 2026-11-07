// ===================================================================
// WIZARDZ 98 — the rules, and the bots
//
// Nothing in here touches the page, which is how check-wizardz.mjs can play a few
// thousand matches in a minute. Numbers live in wizardz-data.js.
//
// One state object, two kinds of change:
//   setInput(s, i, {mx, mz, yaw, pitch, aim, jump, dash, ink})   what they are holding
//   command(s, i, {c: 'cast'|'fire'|'drop'|'resign', ...})       what they just did
// and step(s) moves it on by a tick. A bot and a person, and a person on the other
// end of a wire, all come in through those same doors. command() is what a stranger
// can reach, so it refuses nonsense rather than throwing.
//
// Up to eight seats. A seat's team is its number mod 2, so seat 0 and seat 1 are on
// opposite sides however many people there are, and a 1v1 is the same game it was.
// There is no friendly fire: a team's shots go through its own wizards and its own
// walls, and splash and zones only hurt the other side.
//
// Each map is a height map with no overhangs, so "is that a wall" and "can they see me"
// are array lookups, which is why a match costs a few milliseconds to run. The height
// map and the bots' flow fields are games/ps1/ps1-world.js, shared with dungeonz 98.
// ===================================================================
(function () {
    'use strict';

    const D = window.WZ;
    const A = D.ARENA;
    const { sin, cos, hypot, atan2, sqrt, abs, min, max, floor, ceil, round, PI } = Math;
    const HZ = A.tickHz, DT = 1 / HZ;
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
    const SPELL_INDEX = {};
    D.SPELLS.forEach((sp, i) => { SPELL_INDEX[sp.id] = i; });
    const ZAP = 255;          // spell index of the staff's free shot, on the wire
    const STATUS_KEYS = Object.keys(D.STATUS);
    const STATUS_INDEX = {};
    STATUS_KEYS.forEach((k, i) => { STATUS_INDEX[k] = i; });
    const KIND_LOADED = { shot: 1, beam: 1, strike: 1, wall: 1, zone: 1, trap: 1, summon: 1 };

    // ===============================================================
    // the ground: a height map per map, built once, and one in use at a time
    // ===============================================================
    const CELLS = 4;          // height samples per metre
    const SIDE = A.size * CELLS + 1;
    const HALF = A.size / 2;
    const OUTER = 12;         // how tall the wall round the edge is
    const NAV = 1;            // metres a cell, for the bots
    const NAV_SIDE = A.size / NAV;
    const WORLDS = new Map();
    let W = null;
    function buildWorld(id) {
        const layout = D.makeLayout(id);
        const w = window.PS1_WORLD.build({
            x0: -HALF, z0: -HALF, w: A.size, d: A.size, cells: CELLS, nav: NAV, outer: OUTER,
            ground: layout.ground, boxes: layout.boxes
        });
        const at = w.at, passable = w.passable;
        // somewhere to stand with something in the way, for a bot that wants to draw
        const cover = [];
        layout.boxes.forEach(b => {
            const m = 1.1;
            [[b[0] + b[2] + m, b[1]], [b[0] - b[2] - m, b[1]], [b[0], b[1] + b[3] + m], [b[0], b[1] - b[3] - m]].forEach(p => {
                if (abs(p[0]) >= HALF - 2 || abs(p[1]) >= HALF - 2) return;
                const c = clamp(floor((p[1] + HALF) / NAV), 0, NAV_SIDE - 1) * NAV_SIDE + clamp(floor((p[0] + HALF) / NAV), 0, NAV_SIDE - 1);
                if (passable[c] && at(p[0], p[1]) + 1.2 < b[4]) cover.push(p);
            });
        });
        return Object.assign(w, { id: layout.id, layout, cover });
    }
    function useMap(id) {
        const m = D.mapById(id);
        let w = WORLDS.get(m.id);
        if (!w) { w = buildWorld(m.id); WORLDS.set(m.id, w); }
        W = w;
        return w;
    }
    useMap(D.MAPS[0].id);
    function heightAt(x, z) {
        const i = round((x + HALF) * CELLS), j = round((z + HALF) * CELLS);
        if (i < 0 || j < 0 || i >= SIDE || j >= SIDE) return OUTER;
        return W.height[j * SIDE + i];
    }

    // ===============================================================
    // a new match
    // ===============================================================
    function newWizard(i, player) {
        const team = i % 2, sp = W.layout.spawns[team][floor(i / 2)];
        return {
            i, team, id: player.id, name: player.name || 'wizard', avatar: player.avatar || null,
            bot: !!player.bot,
            loadout: player.loadout || D.DEFAULT_LOADOUT.slice(),
            x: sp[0], y: heightAt(sp[0], sp[1]), z: sp[1], vy: 0,
            mvx: 0, mvz: 0,          // what the legs are doing, which the renderer wants
            kx: 0, kz: 0,            // being shoved
            yaw: faceCentre(sp[0], sp[1]), pitch: 0,
            grounded: true,
            hp: A.maxHp, ink: A.startInk, ward: 0, wardT: 0, wardThorns: 0, wardZap: false,
            st: {}, cd: {},
            chamber: null,
            fireCd: 0, dashCd: 0, dashT: 0, dashX: 0, dashZ: 0,
            stance: false, aim: false,
            dead: false, respawn: 0, safe: 0,
            castT: 0, hitT: 0, fireT: 0,
            dot: 0, dotT: 0
        };
    }
    function faceCentre(x, z) { return atan2(-x, z); }

    function newMatch(o) {
        o = o || {};
        useMap(o.map);
        const list = (o.players && o.players.length >= 2) ? o.players : [(o.players || [])[0] || { id: 'a' }, { id: 'b' }];
        const mode = ceil(list.length / 2);
        const s = {
            seed: (o.seed >>> 0) || 1, rng: (o.seed >>> 0) || 1,
            tick: 0, t: 0, match: o.match || 1,
            map: W.id, mode,
            koGoal: A.knockouts[mode] || A.knockouts[4],
            phase: 'countdown', phaseT: A.countdown,
            wiz: list.map((p, i) => newWizard(i, p)),
            input: list.map(() => blankInput()),
            ents: [], nextId: 1,
            score: [0, 0],
            altar: [0, 0],
            onAltar: -1,
            pickups: W.layout.pickups.map((p, i) => ({ i, kind: p.kind, x: p.x, z: p.z, y: heightAt(p.x, p.z), t: 0 })),
            over: null, reason: null,
            fog: A.fogStart,
            ev: [],
            guessing: false,
            guessMe: -1,
            stats: o.stats ? newStats() : null
        };
        s.input.forEach((inp, i) => { inp.yaw = s.wiz[i].yaw; });
        return s;
    }
    function newStats() { return { casts: {}, dmg: {}, shots: 0, ko: [0, 0], ritual: 0, pickups: 0 }; }
    const blankInput = () => ({ mx: 0, mz: 0, yaw: 0, pitch: 0, aim: false, jump: false, dash: false, ink: false });
    function rnd(s) {
        s.rng ^= s.rng << 13; s.rng ^= s.rng >>> 17; s.rng ^= s.rng << 5; s.rng >>>= 0;
        return s.rng / 4294967296;
    }
    function emit(s, ...e) { if (!s.guessing) s.ev.push(e); }
    const live = s => s.phase === 'live';
    // the nearest somebody on the other side, by plain distance. dead ones do not count
    function nearestEnemy(s, team, x, y, z) {
        let best = null, far = 1e18;
        for (const q of s.wiz) {
            if (q.team === team || q.dead) continue;
            const d = (q.x - x) * (q.x - x) + (q.y - y) * (q.y - y) + (q.z - z) * (q.z - z);
            if (d < far) { far = d; best = q; }
        }
        return best;
    }

    // ===============================================================
    // statuses and damage
    // ===============================================================
    const has = (w, k) => { const c = w.st[k]; return !!c && c.t > 0; };
    function addStatus(w, key, dur, extra) {
        const cur = w.st[key];
        w.st[key] = Object.assign({ t: max(dur, cur ? cur.t : 0) }, extra || {});
    }
    function clearBad(w) { for (const k of Object.keys(w.st)) if ((D.STATUS[k] || {}).bad) delete w.st[k]; }
    function clearGood(w) { for (const k of Object.keys(w.st)) if (!(D.STATUS[k] || {}).bad) delete w.st[k]; }
    const canAct = w => !has(w, 'freeze') && !has(w, 'stun');
    const canWalk = w => !has(w, 'freeze') && !has(w, 'stun') && !has(w, 'root');

    function dealtBy(w) {
        let m = 1;
        if (has(w, 'weak')) m *= 0.7;
        if (has(w, 'focus')) m *= 1.25;
        if (has(w, 'pact')) m *= 1.3;
        if (has(w, 'clock')) m *= 1.3;
        return m;
    }
    // Everything that hurts goes through here. src: {from, dot, spell}
    function hurt(s, target, amount, src) {
        src = src || {};
        const w = s.wiz[target];
        if (!w || w.dead || amount <= 0 || w.safe > 0) return 0;
        if (s.guessing) return 0;
        if (has(w, 'phase') && !src.dot) return 0;
        const attacker = src.from !== undefined && src.from !== null ? s.wiz[src.from] : null;
        // nobody on your own side can hurt you, whatever they threw
        if (attacker && attacker.team === w.team && src.from !== target) return 0;
        let dmg = amount;
        if (attacker && src.from !== target) dmg *= dealtBy(attacker);
        if (has(w, 'mark')) dmg *= 1.3;
        if (has(w, 'stoneskin')) dmg *= 0.67;
        if (w.stance) dmg *= A.stance.hurt;
        if (w.ward > 0 && !src.fog) {
            const eaten = min(w.ward, dmg);
            w.ward -= eaten; dmg -= eaten;
            if (w.ward <= 0) {
                w.ward = 0; w.wardT = 0; w.wardZap = false;
                // a burning ward bites whoever broke it
                if (w.wardThorns && attacker && !src.dot && attacker !== w) {
                    addStatus(attacker, 'burn', 2.5, { dps: w.wardThorns / 2.5 });
                    emit(s, 'zap', r1(attacker.x), r1(attacker.y + 1), r1(attacker.z), 'fire');
                }
                w.wardThorns = 0;
            }
        }
        if (s.stats && src.spell && src.from !== target) s.stats.dmg[src.spell] = (s.stats.dmg[src.spell] || 0) + amount;
        if (dmg > 0) {
            w.hp = max(0, w.hp - dmg);
            if (attacker && attacker !== w) { w.lastHit = attacker.i; w.lastHitT = s.t; }
            if (!src.dot) {
                w.hitT = 0.25;
                emit(s, 'hit', target, r1(dmg), src.spell ? SPELL_INDEX[src.spell] : ZAP, attacker ? attacker.i : -1);
            } else {
                w.dot += dmg;
                if (w.dotT <= 0) { emit(s, 'hit', target, r1(w.dot), 254, -1); w.dot = 0; w.dotT = 0.6; }
            }
        }
        if (attacker && src.lifesteal && !attacker.dead) heal(s, attacker.i, dmg * src.lifesteal);
        if (w.hp <= 0 && !w.dead) knockedOut(s, w, attacker);
        return dmg;
    }
    function heal(s, i, amount) {
        const w = s.wiz[i];
        if (!w || w.dead || amount <= 0 || s.guessing) return;
        w.hp = min(A.maxHp, w.hp + amount);
    }
    function knockedOut(s, w, attacker) {
        w.dead = true;
        w.hp = 0;
        w.respawn = A.respawn;
        w.chamber = null;
        w.stance = false;
        w.st = {};
        w.ward = 0; w.wardT = 0; w.wardThorns = 0; w.wardZap = false;
        // one of four going down should not cost as much as the only one going down
        s.altar[w.team] *= 1 - A.ritualKo / s.mode;
        const other = 1 - w.team;
        s.score[other]++;
        if (s.stats) s.stats.ko[other]++;
        // a burn or a fog gets the kill for whoever hit them last
        const by = attacker && attacker.team !== w.team ? attacker.i : (s.t - (w.lastHitT || -99) < 8 ? w.lastHit : -1);
        emit(s, 'ko', w.i, by === undefined ? -1 : by);
        if (s.score[other] >= s.koGoal) finish(s, other, 'ko');
    }
    function finish(s, winner, reason) {
        if (s.over !== null && s.over !== undefined) return;
        s.over = winner;
        s.reason = reason;
        s.phase = 'matchover';
        s.phaseT = 0;
        emit(s, 'over', winner, reason);
    }

    // ===============================================================
    // where everybody is pointing
    // ===============================================================
    function forward(yaw, pitch, out) {
        const cp = cos(pitch);
        out = out || {};
        out.x = sin(yaw) * cp; out.y = sin(pitch); out.z = -cos(yaw) * cp;
        return out;
    }
    // the camera. The sim needs it too, because a crosshair is a line from the camera
    // and not from the staff: the shot leaves the staff and goes where the line lands.
    // The picture's lens is a ball rather than a point (w.lens): the near plane is wide, and a
    // camera that only kept its centre out of a wall, with your back to it, drew a slice of the
    // inside of it. The rules' camera, which aims, keeps the point, so a lens changes no match.
    const LENS = [];
    for (let k = 0; k < 16; k++) LENS.push([cos(k * PI / 8) * 0.42, sin(k * PI / 8) * 0.42]);
    for (let k = 0; k < 8; k++) LENS.push([cos(k * PI / 4 + PI / 8) * 0.25, sin(k * PI / 4 + PI / 8) * 0.25]);
    function lensInWorld(x, y, z, size) {
        const m = (size || 0.42) / 0.42;
        for (let k = 0; k < LENS.length; k++) if (heightAt(x + LENS[k][0] * m, z + LENS[k][1] * m) > y - 0.05) return true;
        return false;
    }
    function camera(s, w, out) {
        const aim = w.aim;
        const back = aim ? 2.4 : 4, side = aim ? 0.8 : 1, up = aim ? 1.7 : 1.95;
        const f = forward(w.yaw, w.pitch);
        const px = w.x, py = w.y + up, pz = w.z;
        const rx = cos(w.yaw), rz = sin(w.yaw);
        const wantX = px - f.x * back + rx * side, wantY = py - f.y * back, wantZ = pz - f.z * back + rz * side;
        // a camera in a wall sees the inside of the wall. Walk out from the head and
        // stop just short of the first solid thing.
        const dx = wantX - px, dy = wantY - py, dz = wantZ - pz, len = hypot(dx, dy, dz) || 1;
        let t = 1;
        const steps = ceil(len / 0.2);
        for (let k = 1; k <= steps; k++) {
            const u = k / steps;
            const x = px + dx * u, y = py + dy * u, z = pz + dz * u;
            if (y < heightAt(x, z) + (w.lens ? 0.3 : 0.18) || (w.lens && lensInWorld(x, y, z)) || insideWall(s, x, y, z, 0.2)) { t = max(0.05, (k - 1) / steps - 0.04); break; }
        }
        // The picture's camera never jumps where it does not have to. The arm's end is found to a
        // centimetre rather than a fifth of a metre, and with what the arm was last frame (w.was, in
        // metres) and the frame time (w.dt): where it is now still fits, it eases towards where it
        // wants to be, and where it does not, it comes in only as far as it must. Coming off a box's
        // corner it used to snap two metres at once as you turned.
        if (w.lens) {
            const fits = (u, size) => {
                const x = px + dx * u, y = py + dy * u, z = pz + dz * u;
                return !(y < heightAt(x, z) + 0.3 || lensInWorld(x, y, z, size) || insideWall(s, x, y, z, 0.2));
            };
            if (t < 1) {
                let lo = max(0, t), hi = min(1, t + 0.04 + 2 / steps);
                if (!fits(lo)) lo = 0;
                for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
                t = max(0.05, lo - 0.02 / len);
            }
            if (w.was !== undefined && w.dt !== undefined) {
                const was = clamp(w.was / len, 0.05, 1);
                let u;
                if (fits(was)) u = was + clamp((t - was) * (1 - Math.exp(-(t > was ? 4 : 14) * w.dt)), -9 * w.dt / len, 5 * w.dt / len);
                // grazing something: slide in at a camera's pace with a slightly tighter lens, rather than cut
                else if (fits(was, 0.32)) { u = max(t, was - 9 * w.dt / len); while (u > 0.05 && !fits(u, 0.32)) u -= 0.03 / len; }
                else { u = was; while (u > 0.05 && !fits(u, 0.32)) u -= 0.03 / len; }
                while (u > t && !fits(u, 0.32)) u = max(t, u - 0.03 / len);
                t = max(0.05, u);
            }
        }
        out = out || {};
        out.x = px + dx * t; out.y = py + dy * t; out.z = pz + dz * t; out.t = t; out.len = t * len;
        out.fx = f.x; out.fy = f.y; out.fz = f.z;
        return out;
    }
    function muzzle(w, out) {
        const f = forward(w.yaw, w.pitch);
        const rx = cos(w.yaw), rz = sin(w.yaw);
        out = out || {};
        out.x = w.x + rx * 0.42 + f.x * 0.55;
        out.y = w.y + 1.28 + f.y * 0.55;
        out.z = w.z + rz * 0.42 + f.z * 0.55;
        return out;
    }
    // a wall stops anything of the other side's, and lets its own team's through
    function insideWall(s, x, y, z, grow, passTeam) {
        for (const e of s.ents) {
            if (e.k !== 'wall' || y >= e.h) continue;
            if (passTeam !== undefined && e.tm === passTeam) continue;
            if (inBox(e, x, z, grow)) return e;
        }
        return null;
    }
    function inBox(e, x, z, grow) {
        const dx = x - e.x, dz = z - e.z, c = e.ca, sn = e.sa;
        const lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
        return abs(lx) <= e.hw + grow && abs(lz) <= e.hd + grow;
    }
    // where the crosshair lands: the world, a wall, or one of them
    function aimPoint(s, i, range) {
        const w = s.wiz[i];
        const c = camera(s, w);
        const rng = range || 64;
        const n = ceil(rng / 0.4);
        let x = c.x, y = c.y, z = c.z;
        for (let k = 1; k <= n; k++) {
            const d = k * 0.4;
            x = c.x + c.fx * d; y = c.y + c.fy * d; z = c.z + c.fz * d;
            if (d < 1) continue;
            if (y < heightAt(x, z)) return { x, y, z, hit: 'world', d };
            if (insideWall(s, x, y, z, 0, w.team)) return { x, y, z, hit: 'wall', d };
            for (const q of s.wiz) {
                if (q.team === w.team || q.dead) continue;
                if (abs(x - q.x) < 0.7 && abs(z - q.z) < 0.7 && y > q.y && y < q.y + A.height + 0.1) return { x, y, z, hit: 'foe', d, who: q.i };
            }
        }
        return { x, y, z, hit: null, d: rng };
    }
    function clearLine(s, ax, ay, az, bx, by, bz) {
        const d = hypot(bx - ax, by - ay, bz - az);
        const n = max(1, ceil(d / 0.6));
        for (let k = 1; k < n; k++) {
            const u = k / n;
            const x = ax + (bx - ax) * u, y = ay + (by - ay) * u, z = az + (bz - az) * u;
            if (y < heightAt(x, z)) return false;
        }
        return true;
    }

    // ===============================================================
    // commands
    // ===============================================================
    function inscribeCosts(w, sp) {
        const pact = has(w, 'pact');
        return { ink: pact ? 0 : (sp.cost || 0), hp: (sp.hp || 0) + (pact ? (sp.cost || 0) * 0.5 : 0) };
    }
    function canInscribe(s, i, sp) {
        const w = s.wiz[i];
        if (!live(s)) return 'inactive';
        if (w.dead) return 'dead';
        if (!canAct(w)) return 'frozen';
        if ((w.cd[sp.id] || 0) > 0) return 'cooling';
        const c = inscribeCosts(w, sp);
        if (w.ink < c.ink) return 'ink';
        if (c.hp > 0 && w.hp <= c.hp) return 'health';
        return null;
    }
    function command(s, i, c) {
        if (!c || typeof c !== 'object' || !Number.isInteger(i) || !s.wiz[i]) return 'bad';
        if (s.over !== null && s.over !== undefined) return 'over';
        const w = s.wiz[i];
        switch (c.c) {
            case 'cast': {
                if (typeof c.s !== 'string' || !Object.prototype.hasOwnProperty.call(SPELL_INDEX, c.s)) return 'bad';
                const sp = D.SPELLS[SPELL_INDEX[c.s]];
                const q = typeof c.q === 'number' && c.q >= 0 && c.q <= 1 ? c.q : 0;
                const why = canInscribe(s, i, sp);
                if (why) return why;
                const cost = inscribeCosts(w, sp);
                w.ink -= cost.ink;
                w.hp -= cost.hp;
                w.cd[sp.id] = sp.cd || 0;
                w.castT = 0.35;
                if (s.stats) s.stats.casts[sp.id] = (s.stats.casts[sp.id] || 0) + 1;
                emit(s, 'cast', i, SPELL_INDEX[sp.id], round(q * 100));
                const power = A.qualityPower[0] + (A.qualityPower[1] - A.qualityPower[0]) * q;
                if (KIND_LOADED[sp.kind]) {
                    const base = sp.charges || 1;
                    w.chamber = { s: sp.id, n: base + (base > 1 && q >= A.cleanCharge ? 1 : 0), power };
                    w.fireCd = max(w.fireCd, 0.12);
                    return null;
                }
                release(s, i, sp, power);
                return null;
            }
            case 'fire': {
                if (!live(s)) return 'inactive';
                if (w.dead) return 'dead';
                if (w.stance) return 'stance';
                if (!canAct(w)) return 'frozen';
                if (w.fireCd > 0) return 'cooling';
                if (typeof c.y === 'number' && isFinite(c.y)) w.yaw = c.y;
                if (typeof c.p === 'number' && isFinite(c.p)) w.pitch = clamp(c.p, -1.35, 1.35);
                if (w.chamber) {
                    const sp = D.byId(w.chamber.s);
                    fireSpell(s, i, sp, w.chamber.power);
                    w.chamber.n--;
                    const rof = (sp.p && sp.p.rof) || A.rof;
                    w.fireCd = has(w, 'overload') ? rof * 0.7 : rof;
                    if (w.chamber.n <= 0) w.chamber = null;
                } else {
                    fireZap(s, i);
                    w.fireCd = has(w, 'overload') ? A.zap.rof * 0.7 : A.zap.rof;
                }
                w.fireT = 0.14;
                if (has(w, 'stealth')) delete w.st.stealth;
                return null;
            }
            case 'drop': {
                if (!w.chamber) return 'none';
                w.chamber = null;
                return null;
            }
            case 'resign': {
                finish(s, 1 - w.team, 'resign');
                return null;
            }
            default:
                return 'bad';
        }
    }
    function sanitizeInput(d) {
        const o = blankInput();
        if (!d || typeof d !== 'object') return o;
        const n = v => typeof v === 'number' && isFinite(v) ? v : 0;
        o.mx = clamp(n(d.mx), -1, 1); o.mz = clamp(n(d.mz), -1, 1);
        o.yaw = n(d.yaw); o.pitch = clamp(n(d.pitch), -1.35, 1.35);
        o.aim = !!d.aim; o.jump = !!d.jump; o.dash = !!d.dash; o.ink = !!d.ink;
        return o;
    }
    function setInput(s, i, d) { if (s.input[i]) s.input[i] = sanitizeInput(d); }

    // ---------------------------------------------------------------
    // firing
    // ---------------------------------------------------------------
    function launch(s, i, spellId, o) {
        const w = s.wiz[i];
        const m = muzzle(w);
        const aim = aimPoint(s, i);
        let dx = aim.x - m.x, dy = aim.y - m.y, dz = aim.z - m.z;
        const l = hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
        return { m, dx, dy, dz, spell: spellId, o };
    }
    // a little off, unless you stopped to aim
    function jitter(s, w, v, degrees) {
        if (!degrees) return v;
        const a = (rnd(s) - 0.5) * 2 * degrees * PI / 180, b = (rnd(s) - 0.5) * 2 * degrees * PI / 180;
        const cy = cos(a), sy = sin(a);
        const x = v.x * cy - v.z * sy, z = v.x * sy + v.z * cy;
        return { x, y: v.y + sin(b), z };
    }
    function fireZap(s, i) {
        const w = s.wiz[i];
        const l = launch(s, i, null);
        const v = jitter(s, w, { x: l.dx, y: l.dy, z: l.dz }, w.aim ? 0.2 : 1.1);
        if (s.stats) s.stats.shots++;
        s.ents.push({
            id: s.nextId++, k: 'shot', s: null, si: ZAP, o: i, tm: w.team, el: 'arcane',
            x: l.m.x, y: l.m.y, z: l.m.z, vx: v.x * A.zap.speed, vy: v.y * A.zap.speed, vz: v.z * A.zap.speed,
            r: A.zap.r, dmg: A.zap.dmg, life: A.zap.range / A.zap.speed, zap: true, hits: 0
        });
        emit(s, 'fire', i, ZAP);
    }
    function fireSpell(s, i, sp, power) {
        const w = s.wiz[i];
        const p = sp.p || {};
        emit(s, 'fire', i, SPELL_INDEX[sp.id]);
        if (s.stats) s.stats.shots++;
        const base = { id: 0, s: sp.id, si: SPELL_INDEX[sp.id], o: i, tm: w.team, el: sp.el };
        const make = o => { const e = Object.assign({}, base, o); e.id = s.nextId++; s.ents.push(e); return e; };
        switch (sp.kind) {
            case 'shot': return fireShot(s, i, sp, power);
            case 'beam': return fireBeam(s, i, sp, power);
            case 'strike': {
                const t = groundTarget(s, i, p.range);
                make({ k: 'strike', x: t.x, y: t.y, z: t.z, r: p.r, t: p.delay, dmg: sp.dmg * power });
                return;
            }
            case 'wall': {
                const t = groundTarget(s, i, p.range);
                placeWall(s, i, sp, t, power);
                return;
            }
            case 'zone': {
                const t = groundTarget(s, i, p.range);
                limitOwned(s, i, 'zone');
                make({ k: 'zone', x: t.x, y: t.y, z: t.z, r: p.r, life: p.dur, power });
                return;
            }
            case 'trap': {
                const t = groundTarget(s, i, p.range);
                limitOwned(s, i, 'trap');
                make({ k: 'trap', x: t.x, y: t.y, z: t.z, r: p.r, life: p.dur, arm: 0.6, dmg: sp.dmg * power });
                return;
            }
            case 'summon': {
                const t = groundTarget(s, i, p.range);
                limitOwned(s, i, 'summon');
                const d = hypot(t.x - w.x, t.z - w.z) || 1;
                make({ k: 'decoy', x: w.x, y: w.y, z: w.z, gx: t.x, gz: t.z, vx: (t.x - w.x) / d * A.walk * 0.85, vz: (t.z - w.z) / d * A.walk * 0.85, yaw: atan2(t.x - w.x, -(t.z - w.z)), life: p.dur, hp: p.hp || 1 });
                if (p.stealth) addStatus(w, 'stealth', p.stealth);
                return;
            }
        }
    }
    function limitOwned(s, i, k) {
        const cap = A.maxOwned[k === 'decoy' ? 'summon' : k];
        const kind = k === 'summon' ? 'decoy' : k;
        const mine = s.ents.filter(e => e.k === kind && e.o === i);
        if (cap && mine.length >= cap) {
            const old = mine[0];
            s.ents.splice(s.ents.indexOf(old), 1);
        }
    }
    function groundTarget(s, i, range) {
        const w = s.wiz[i];
        const a = aimPoint(s, i, 64);
        let x = a.x, z = a.z;
        const d = hypot(x - w.x, z - w.z);
        const r = range || 30;
        if (d > r) { x = w.x + (x - w.x) / d * r; z = w.z + (z - w.z) / d * r; }
        x = clamp(x, -HALF + 2, HALF - 2); z = clamp(z, -HALF + 2, HALF - 2);
        return { x, y: heightAt(x, z), z };
    }
    function placeWall(s, i, sp, t, power) {
        const w = s.wiz[i], p = sp.p;
        limitOwned(s, i, 'wall');
        const yaw = atan2(t.x - w.x, -(t.z - w.z));
        const e = {
            id: s.nextId++, k: 'wall', s: sp.id, si: SPELL_INDEX[sp.id], o: i, tm: w.team, el: sp.el,
            x: t.x, z: t.z, y: t.y, ang: yaw,
            // across your aim: the long side faces you
            ca: cos(yaw), sa: sin(yaw), hw: p.w / 2, hd: p.d / 2,
            h: t.y + p.h, hp: p.hp * power, maxHp: p.hp * power, life: p.dur
        };
        s.ents.push(e);
        // a pillar under your feet is a lift, and a slab on top of you shoves you off
        for (const q of s.wiz) {
            if (q.dead || !inBox(e, q.x, q.z, A.radius)) continue;
            if (p.w <= 3) { q.y = max(q.y, e.h); q.grounded = true; q.vy = 0; }
            else {
                const dx = q.x - e.x, dz = q.z - e.z, lz = -dx * e.sa + dz * e.ca;
                const side = lz >= 0 ? 1 : -1, need = e.hd + A.radius + 0.1 - abs(lz);
                q.x += -e.sa * side * need; q.z += e.ca * side * need;
            }
        }
        emit(s, 'zap', r1(t.x), r1(t.y + 0.4), r1(t.z), sp.el);
    }
    function fireShot(s, i, sp, power) {
        const w = s.wiz[i], p = sp.p;
        const l = launch(s, i, sp.id);
        const count = p.count || 1;
        for (let n = 0; n < count; n++) {
            const sp2 = count > 1 ? p.spread || 6 : (w.aim ? 0.15 : 0.7);
            const v = jitter(s, w, { x: l.dx, y: l.dy, z: l.dz }, sp2);
            const m = hypot(v.x, v.y, v.z) || 1;
            const e = {
                id: s.nextId++, k: 'shot', s: sp.id, si: SPELL_INDEX[sp.id], o: i, tm: w.team, el: sp.el,
                x: l.m.x, y: l.m.y, z: l.m.z,
                vx: v.x / m * p.speed, vy: v.y / m * p.speed, vz: v.z / m * p.speed,
                r: p.r, dmg: (sp.dmg || 0) * power, life: p.life || 3.2, bounce: p.bounce || 0, hits: 0
            };
            if (p.ground || p.roll) {
                // these go along the floor, whatever the staff was pointing at
                const flat = hypot(l.dx, l.dz) || 1;
                e.vx = l.dx / flat * p.speed; e.vz = l.dz / flat * p.speed; e.vy = 0;
                e.y = heightAt(w.x, w.z) + (p.ground ? 0.2 : p.r);
            }
            s.ents.push(e);
        }
    }
    function fireBeam(s, i, sp, power) {
        const p = sp.p, w = s.wiz[i];
        const m = muzzle(w);
        const aim = aimPoint(s, i);
        const dx0 = aim.x - m.x, dy0 = aim.y - m.y, dz0 = aim.z - m.z, l0 = hypot(dx0, dy0, dz0) || 1;
        const ray = { x: m.x, y: m.y, z: m.z, dx: dx0 / l0, dy: dy0 / l0, dz: dz0 / l0 };
        if (p.delay) {
            s.ents.push({ id: s.nextId++, k: 'pending', s: sp.id, si: SPELL_INDEX[sp.id], o: i, tm: w.team, el: sp.el, x: m.x, y: m.y, z: m.z, dx: ray.dx, dy: ray.dy, dz: ray.dz, t: p.delay, power });
            emit(s, 'line', r1(m.x), r1(m.y), r1(m.z), r1(m.x + ray.dx * p.range), r1(m.y + ray.dy * p.range), r1(m.z + ray.dz * p.range), sp.el);
            return;
        }
        resolveBeam(s, i, sp, ray, power);
    }
    function resolveBeam(s, i, sp, ray, power) {
        const p = sp.p, me = s.wiz[i];
        // how far it gets
        let reach = p.range;
        if (!p.through) {
            const n = ceil(p.range / 0.4);
            for (let k = 1; k <= n; k++) {
                const d = k * 0.4;
                const x = ray.x + ray.dx * d, y = ray.y + ray.dy * d, z = ray.z + ray.dz * d;
                if (y < heightAt(x, z)) { reach = d; break; }
                const wall = insideWall(s, x, y, z, 0, me.team);
                if (wall) { wall.hp -= (sp.dmg || 0) * power; reach = d; break; }
            }
        }
        // decoys take it
        for (const e of s.ents) {
            if (e.k !== 'decoy' || e.tm === me.team) continue;
            if (rayNear(ray, e.x, e.y + 0.9, e.z, reach) < (p.width || 0.8)) { e.hp = 0; reach = 0; emit(s, 'zap', r1(e.x), r1(e.y + 1), r1(e.z), 'shadow'); }
        }
        // the first of them along the line
        let foe = null, closest = 1e9;
        if (reach > 0) {
            for (const q of s.wiz) {
                if (q.team === me.team || q.dead || has(q, 'phase') || q.safe > 0) continue;
                const off = rayNear(ray, q.x, q.y + 0.9, q.z, reach);
                if (off >= (p.width || 0.8) + 0.25) continue;
                const along = (q.x - ray.x) * ray.dx + (q.y + 0.9 - ray.y) * ray.dy + (q.z - ray.z) * ray.dz;
                if (along < closest) { closest = along; foe = q; }
            }
        }
        const ex = foe ? foe.x : ray.x + ray.dx * reach, ey = foe ? foe.y + 1 : ray.y + ray.dy * reach, ez = foe ? foe.z : ray.z + ray.dz * reach;
        emit(s, 'beam', r1(ray.x), r1(ray.y), r1(ray.z), r1(ex), r1(ey), r1(ez), sp.el);
        if (!foe) return;
        let dmg = (sp.dmg || 0) * power;
        if (p.execute) dmg += (A.maxHp - foe.hp) * p.execute;
        hurt(s, foe.i, dmg, { from: i, spell: sp.id, lifesteal: p.lifesteal });
        if (foe.dead) return;
        if (p.inkBurn) burnInk(s, foe, me, p.inkBurn, p.inkGain);
        if (p.status) applyStatus(s, foe, p.status, i, power);
        if (p.pull && !s.guessing) {
            const d = hypot(me.x - foe.x, me.z - foe.z) || 1;
            foe.kx += (me.x - foe.x) / d * p.pull * 2.5;
            foe.kz += (me.z - foe.z) / d * p.pull * 2.5;
        }
    }
    // closest a point gets to the ray, or Infinity if that is past the end of it
    function rayNear(ray, x, y, z, reach) {
        const px = x - ray.x, py = y - ray.y, pz = z - ray.z;
        const t = px * ray.dx + py * ray.dy + pz * ray.dz;
        if (t < 0 || t > reach + 1) return Infinity;
        return hypot(px - ray.dx * t, py - ray.dy * t, pz - ray.dz * t);
    }
    function burnInk(s, foe, me, burn, gain) {
        if (s.guessing) return;
        const taken = min(foe.ink, burn);
        foe.ink -= taken;
        if (gain) me.ink = min(A.maxInk, me.ink + min(taken, gain));
        emit(s, 'ink', foe.i, round(taken));
    }
    function applyStatus(s, w, st, from, power) {
        if (s.guessing || w.dead) return;
        const dur = st.dur * (0.85 + 0.15 * (power || 1));
        const extra = {};
        if (st.dps) extra.dps = st.dps;
        if (st.moveDps) extra.moveDps = st.moveDps;
        if (st.feed) { extra.feed = true; extra.from = from; }
        addStatus(w, st.k, dur, extra);
    }

    // ---------------------------------------------------------------
    // spells that go off the moment the ink dries
    // ---------------------------------------------------------------
    function release(s, i, sp, power) {
        const w = s.wiz[i], p = sp.p || {};
        switch (sp.kind) {
            case 'nova': {
                emit(s, 'nova', i, p.r, sp.el);
                if (p.selfDispel) clearBad(w);
                if (p.breaks) s.ents = s.ents.filter(e => !(e.k === 'trap' && e.tm !== w.team && hypot(e.x - w.x, e.z - w.z) < p.r));
                for (const foe of s.wiz) {
                    if (foe.team === w.team || foe.dead) continue;
                    const d = hypot(foe.x - w.x, foe.z - w.z);
                    const airborne = foe.y - heightAt(foe.x, foe.z) > 0.6;
                    if (d < p.r && !(p.ground && airborne) && abs(foe.y - w.y) < p.r) {
                        hurt(s, foe.i, (sp.dmg || 0) * power, { from: i, spell: sp.id });
                        if (!foe.dead) {
                            if (p.status) applyStatus(s, foe, p.status, i, power);
                            if (p.knock && !s.guessing) {
                                foe.kx += (foe.x - w.x) / (d || 1) * p.knock * 2;
                                foe.kz += (foe.z - w.z) / (d || 1) * p.knock * 2;
                            }
                        }
                    }
                }
                return;
            }
            case 'self': {
                if (p.shield) {
                    w.ward = max(w.ward, p.shield * power);
                    w.wardT = p.dur || 8;
                    w.wardThorns = p.thorns || 0;
                    w.wardZap = !!p.zap;
                }
                if (p.heal && p.over) addStatus(w, 'regen', p.over, { hps: p.heal * power / p.over });
                else if (p.heal) heal(s, i, p.heal * power);
                if (p.ink) w.ink = min(A.maxInk, w.ink + p.ink);
                if (p.status) applyStatus(s, w, p.status, i, power);
                emit(s, 'buff', i, SPELL_INDEX[sp.id]);
                return;
            }
            case 'move': {
                const inp = s.input[i];
                let dx = sin(w.yaw) * inp.mz + cos(w.yaw) * inp.mx, dz = -cos(w.yaw) * inp.mz + sin(w.yaw) * inp.mx;
                let m = hypot(dx, dz);
                if (m < 0.1) { dx = sin(w.yaw); dz = -cos(w.yaw); m = 1; }
                dx /= m; dz /= m;
                const fromX = w.x, fromY = w.y, fromZ = w.z;
                let x = w.x, z = w.z, y = w.y;
                const stepLen = 0.4, n = ceil(p.dist / stepLen);
                for (let k = 1; k <= n; k++) {
                    const nx = w.x + dx * k * stepLen, nz = w.z + dz * k * stepLen;
                    const h = groundUnder(nx, nz);
                    if (h > w.y + 1.6 || insideWall(s, nx, w.y + 0.9, nz, A.radius)) break;
                    x = nx; z = nz; y = max(h, min(w.y, h + 0.5));
                }
                w.x = x; w.z = z; w.y = y; w.vy = 0;
                addStatus(w, 'phase', p.phase || 0.4);
                emit(s, 'blink', r1(fromX), r1(fromY), r1(fromZ), r1(x), r1(y), r1(z));
                return;
            }
        }
    }

    // ===============================================================
    // the step
    // ===============================================================
    function groundUnder(x, z) {
        const r = A.radius * 0.7;
        return max(heightAt(x, z), heightAt(x + r, z), heightAt(x - r, z), heightAt(x, z + r), heightAt(x, z - r));
    }
    function dynamicGround(s, x, z, y) {
        let g = 0;
        for (const e of s.ents) {
            if (e.k === 'wall' && e.h <= y + A.step && inBox(e, x, z, A.radius * 0.5) && e.h > g) g = e.h;
        }
        return g;
    }
    function blockedAt(s, w, x, z) {
        const lim = w.y + A.step;
        if (groundUnder(x, z) > lim) return true;
        for (const e of s.ents) if (e.k === 'wall' && e.h > lim && inBox(e, x, z, A.radius * 0.8)) return true;
        return false;
    }

    function stepWizard(s, i) {
        const w = s.wiz[i], inp = s.input[i];
        if (w.dead) {
            w.respawn -= DT;
            if (w.respawn <= 0 && !s.guessing) respawn(s, w);
            return;
        }
        // a guest has no idea what anyone else is pressing: they carry on as they were
        if (s.guessing && i !== s.guessMe) {
            const nx = w.x + w.mvx * DT, nz = w.z + w.mvz * DT;
            if (!blockedAt(s, w, nx, w.z)) w.x = nx;
            if (!blockedAt(s, w, w.x, nz)) w.z = nz;
            w.vy -= A.gravity * DT;
            w.y += w.vy * DT;
            const g = max(groundUnder(w.x, w.z), dynamicGround(s, w.x, w.z, w.y));
            if (w.y <= g) { w.y = g; w.vy = 0; w.grounded = true; }
            for (const k in w.st) { w.st[k].t -= DT; if (w.st[k].t <= 0) delete w.st[k]; }
            w.hitT = max(0, w.hitT - DT);
            w.fireT = max(0, w.fireT - DT);
            return;
        }
        w.yaw = inp.yaw;
        w.pitch = inp.pitch;
        w.aim = !!inp.aim && canAct(w);
        const wasStance = w.stance;
        w.stance = !!inp.ink && canAct(w);
        if (!wasStance && w.stance) emit(s, 'stance', i, 1);

        // ---- what is wrong with them ----
        let inkMul = 1;
        for (const k in w.st) {
            const c = w.st[k];
            c.t -= DT;
            if (c.t <= 0) { delete w.st[k]; continue; }
            switch (k) {
                case 'burn': hurt(s, i, (c.dps || 3) * DT, { dot: true }); break;
                case 'bleed': {
                    const moving = abs(w.mvx) + abs(w.mvz) > 0.5;
                    hurt(s, i, ((c.dps || 1) + (moving ? (c.moveDps || 0) : 0)) * DT, { dot: true, spell: 'hemorrhage' });
                    break;
                }
                case 'leech': {
                    const take = (c.dps || 3) * DT;
                    hurt(s, i, take, { dot: true, spell: 'leech' });
                    if (c.feed && c.from !== undefined) heal(s, c.from, take);
                    break;
                }
                case 'overload': inkMul *= 3; hurt(s, i, (c.dps || 1.5) * DT, { dot: true }); break;
                case 'shock': inkMul *= 0.25; break;
                case 'regen': heal(s, i, (c.hps || 4) * DT); break;
            }
            if (w.dead) return;
        }
        w.ink = min(A.maxInk, w.ink + A.inkRegen * inkMul * DT);
        w.castT = max(0, w.castT - DT);
        w.hitT = max(0, w.hitT - DT);
        w.fireT = max(0, w.fireT - DT);
        w.fireCd = max(0, w.fireCd - DT);
        w.dashCd = max(0, w.dashCd - DT);
        w.safe = max(0, w.safe - DT);
        w.dotT = max(0, w.dotT - DT);
        for (const k in w.cd) { w.cd[k] -= DT; if (w.cd[k] <= 0) delete w.cd[k]; }
        if (w.wardT > 0) { w.wardT -= DT; if (w.wardT <= 0) { w.ward = 0; w.wardThorns = 0; w.wardZap = false; } }

        moveWizard(s, w, inp);
        if (s.guessing) return;

        // ---- things on the floor ----
        for (const p of s.pickups) {
            if (p.t > 0) continue;
            if (hypot(p.x - w.x, p.z - w.z) > 1.3 || abs(p.y - w.y) > 1.9) continue;
            const def = A.pickups[p.kind];
            if (def.ink && w.ink >= A.maxInk) continue;
            if (def.hp && w.hp >= A.maxHp) continue;
            if (def.ink) w.ink = min(A.maxInk, w.ink + def.ink);
            if (def.hp) heal(s, i, def.hp);
            if (def.status) addStatus(w, def.status, def.dur);
            p.t = def.respawn;
            if (s.stats) s.stats.pickups++;
            emit(s, 'pick', i, p.i);
        }
    }
    // Walking, jumping, dashing, being shoved. A guest runs this for itself as well,
    // to move at once rather than a round trip later.
    function moveWizard(s, w, inp) {
        const free = canWalk(w);
        let speed = w.stance ? A.stanceWalk : w.aim ? A.aimWalk : A.walk;
        if (has(w, 'chill')) speed *= 0.65;
        if (has(w, 'turbo')) speed *= 1.4;
        if (has(w, 'stoneskin')) speed *= 0.8;
        const fx = sin(w.yaw), fz = -cos(w.yaw), rx = cos(w.yaw), rz = sin(w.yaw);
        let mx = free ? inp.mx : 0, mz = free ? inp.mz : 0;
        const m = hypot(mx, mz);
        if (m > 1) { mx /= m; mz /= m; }
        let vx = (rx * mx + fx * mz) * speed, vz = (rz * mx + fz * mz) * speed;
        w.mvx = vx; w.mvz = vz;

        if (inp.dash && free && w.dashCd <= 0 && !w.stance) {
            let dx = rx * mx + fx * mz, dz = rz * mx + fz * mz;
            const l = hypot(dx, dz);
            if (l < 0.1) { dx = fx; dz = fz; } else { dx /= l; dz /= l; }
            w.dashX = dx; w.dashZ = dz; w.dashT = A.dash.time; w.dashCd = A.dash.cd;
            emit(s, 'dash', w.i);
        }
        if (w.dashT > 0) {
            w.dashT -= DT;
            vx = w.dashX * A.dash.speed; vz = w.dashZ * A.dash.speed;
        }
        // being shoved fades, and it works on somebody rooted as well
        vx += w.kx; vz += w.kz;
        const fade = Math.pow(0.02, DT);
        w.kx *= fade; w.kz *= fade;
        if (abs(w.kx) < 0.05) w.kx = 0;
        if (abs(w.kz) < 0.05) w.kz = 0;

        const nx = w.x + vx * DT, nz = w.z + vz * DT;
        if (!blockedAt(s, w, nx, w.z)) w.x = nx;
        if (!blockedAt(s, w, w.x, nz)) w.z = nz;

        if (inp.jump && w.grounded && free && !w.stance) { w.vy = A.jump; w.grounded = false; }
        w.vy -= A.gravity * DT;
        w.y += w.vy * DT;
        const ground = max(groundUnder(w.x, w.z), dynamicGround(s, w.x, w.z, w.y));
        if (w.y <= ground) { w.y = ground; w.vy = 0; w.grounded = true; }
        else if (w.y - ground > 0.12) w.grounded = false;
        // down a ramp you stay on it, rather than skipping like a stone
        if (w.grounded && w.vy <= 0 && w.y - ground < 0.5) { w.y = ground; w.vy = 0; }
    }
    function respawn(s, w) {
        // of your side's spawn points, whichever is furthest from the nearest of them
        const spots = W.layout.spawns[w.team];
        let best = spots[0], far = -1;
        for (const sp of spots) {
            let near = 1e9;
            for (const q of s.wiz) {
                if (q.team === w.team || q.dead) continue;
                near = min(near, hypot(sp[0] - q.x, sp[1] - q.z));
            }
            const score = near + rnd(s) * 3;
            if (score > far) { far = score; best = sp; }
        }
        w.x = best[0]; w.z = best[1]; w.y = heightAt(best[0], best[1]);
        w.dead = false; w.hp = A.maxHp; w.ink = max(w.ink, A.startInk * 0.7);
        w.safe = A.spawnSafe; w.kx = w.kz = 0; w.vy = 0; w.dashT = 0;
        w.yaw = faceCentre(best[0], best[1]);
        w.lastHit = undefined;
        emit(s, 'spawn', w.i, r1(w.x), r1(w.z));
    }

    function stepShot(s, e, keep) {
        const sp = e.s ? D.byId(e.s) : null, p = sp ? sp.p : {};
        // a wizard mid-sigil has a bubble of slow time round them. This is a rule of the
        // world rather than a screen effect, so it works the same online.
        let slow = 1;
        for (const q of s.wiz) {
            if (q.team !== e.tm && q.stance && hypot(e.x - q.x, e.y - q.y, e.z - q.z) < A.stance.slowR) { slow = A.stance.slowBy; break; }
        }
        if (p.homing) {
            const dec = s.ents.find(o => o.k === 'decoy' && o.tm !== e.tm);
            const foe = dec ? null : nearestEnemy(s, e.tm, e.x, e.y, e.z);
            if (dec || foe) {
                const tx = dec ? dec.x : foe.x, ty = dec ? dec.y + 1 : foe.y + 1, tz = dec ? dec.z : foe.z;
                const dx = tx - e.x, dy = ty - e.y, dz = tz - e.z, l = hypot(dx, dy, dz) || 1;
                const speed = hypot(e.vx, e.vy, e.vz) || p.speed;
                const turn = p.homing * DT;
                e.vx += (dx / l) * speed * turn; e.vy += (dy / l) * speed * turn; e.vz += (dz / l) * speed * turn;
                const n = hypot(e.vx, e.vy, e.vz) || 1;
                e.vx *= speed / n; e.vy *= speed / n; e.vz *= speed / n;
            }
        }
        if (p.gravity && !p.roll) e.vy -= p.gravity * DT;
        e.life -= DT;
        if (e.life <= 0) { if (p.aoe) boom(s, e, sp, -1); return; }

        const dist = hypot(e.vx, e.vy, e.vz) * DT * slow;
        const n = max(1, ceil(dist / 0.45));
        const stepT = DT * slow / n;
        for (let k = 0; k < n; k++) {
            const nx = e.x + e.vx * stepT, ny = e.y + e.vy * stepT, nz = e.z + e.vz * stepT;
            if (p.ground) {
                // along the floor: climbs a ramp, and stops dead at a wall
                const h = heightAt(nx, nz);
                if (h > e.y - 0.2 + 1) { spark(s, e); return; }
                e.x = nx; e.z = nz; e.y = h + 0.2;
            } else if (p.roll) {
                const h = heightAt(nx, nz);
                const blockX = heightAt(nx, e.z) > e.y + 0.4 || !!insideWall(s, nx, e.y, e.z, e.r, e.tm);
                const blockZ = heightAt(e.x, nz) > e.y + 0.4 || !!insideWall(s, e.x, e.y, nz, e.r, e.tm);
                if (blockX || blockZ) {
                    if (e.bounce <= 0) { spark(s, e); return; }
                    e.bounce--;
                    if (blockX) e.vx = -e.vx * 0.85;
                    if (blockZ) e.vz = -e.vz * 0.85;
                } else {
                    e.x = nx; e.z = nz;
                    e.y = max(h + e.r, e.y - p.gravity * DT * stepT * 3);
                }
            } else {
                e.x = nx; e.y = ny; e.z = nz;
                if (!p.ghost) {
                    if (e.y < heightAt(e.x, e.z)) {
                        if (p.aoe) boom(s, e, sp, -1); else spark(s, e);
                        return;
                    }
                    const wall = insideWall(s, e.x, e.y, e.z, e.r * 0.5, e.tm);
                    if (wall && e.hitWall !== wall.id) {
                        if (!s.guessing) wall.hp -= e.dmg;
                        e.hitWall = wall.id;
                        if (!p.pierce) {
                            if (p.aoe) boom(s, e, sp, -1); else spark(s, e);
                            return;
                        }
                    }
                }
            }
            // things that eat shots
            for (const z of s.ents) {
                if (z.k !== 'zone' || z.tm === e.tm) continue;
                const zp = D.byId(z.s).p;
                if (!zp.eats && !zp.blocks) continue;
                if (hypot(e.x - z.x, e.z - z.z) < z.r && e.y < z.y + z.r + 1) { spark(s, e); return; }
            }
            // decoys
            const decoy = s.ents.find(o => o.k === 'decoy' && o.tm !== e.tm && hypot(o.x - e.x, o.y + 0.9 - e.y, o.z - e.z) < e.r + 0.7);
            if (decoy) {
                decoy.hp -= 1;
                spark(s, e);
                return;
            }
            // anybody on the other side
            for (const foe of s.wiz) {
                if (foe.team === e.tm || foe.dead) continue;
                // a static field swats anything small
                if (foe.wardZap && foe.ward > 0 && e.dmg <= 15 && !p.aoe && hypot(e.x - foe.x, e.y - foe.y - 1, e.z - foe.z) < 2.4) {
                    if (!s.guessing) foe.ward = max(0, foe.ward - e.dmg * 0.5);
                    spark(s, e);
                    return;
                }
                if (e.hits & (1 << foe.i) || has(foe, 'phase') || foe.safe > 0) continue;
                const rr = e.r + A.radius;
                const dy = e.y < foe.y ? foe.y - e.y : e.y > foe.y + A.height ? e.y - foe.y - A.height : 0;
                if ((e.x - foe.x) ** 2 + (e.z - foe.z) ** 2 + dy * dy >= rr * rr) continue;
                if (p.ground && foe.y - heightAt(foe.x, foe.z) > 0.55) continue;
                if (has(foe, 'mirror') && !e.zap) {
                    delete foe.st.mirror;
                    e.o = foe.i; e.tm = foe.team; e.vx = -e.vx; e.vz = -e.vz; e.vy = -e.vy;
                    e.hits = 0; e.hitWall = null;
                    emit(s, 'mirror', foe.i);
                    keep.push(e);
                    return;
                }
                if (!s.guessing) shotHits(s, e, sp, foe);
                if (!p.pierce) {
                    if (p.aoe) boom(s, e, sp, foe.i);
                    spark(s, e);
                    return;
                }
                e.hits |= 1 << foe.i;
            }
        }
        if (abs(e.x) > HALF + 4 || abs(e.z) > HALF + 4 || e.y > 30) return;
        keep.push(e);
    }
    function spark(s, e) { emit(s, 'zap', r1(e.x), r1(e.y), r1(e.z), e.el); }
    function shotHits(s, e, sp, foe) {
        const p = sp ? sp.p : {};
        const me = s.wiz[e.o];
        hurt(s, foe.i, e.dmg, { from: e.o, spell: e.s });
        if (e.zap) me.ink = min(A.maxInk, me.ink + A.inkOnHit);
        if (foe.dead) return;
        if (p.burn) addStatus(foe, 'burn', p.burn.dur, { dps: p.burn.dps });
        if (p.status) applyStatus(s, foe, p.status, e.o, 1);
        if (p.inkBurn) burnInk(s, foe, me, p.inkBurn, p.inkGain);
        if (p.knock) {
            const l = hypot(e.vx, e.vz) || 1;
            foe.kx += e.vx / l * p.knock * 2; foe.kz += e.vz / l * p.knock * 2;
            addStatus(foe, 'stun', 0.2);
        }
        if (p.knockUp) { foe.vy = p.knockUp; foe.grounded = false; }
        if (p.dispel) {
            foe.ward = 0; foe.wardT = 0; foe.wardThorns = 0; foe.wardZap = false;
            clearGood(foe);
        }
    }
    function boom(s, e, sp, skip) {
        const p = sp.p;
        emit(s, 'boom', r1(e.x), r1(e.y), r1(e.z), p.aoe, e.el);
        if (s.guessing) return;
        if (p.dispel) {
            // this can run in the middle of stepEntities, which rebuilds the list, so mark rather than remove
            for (const o of s.ents) {
                if (o.tm === e.tm || hypot(o.x - e.x, o.z - e.z) >= p.aoe) continue;
                if (o.k === 'wall' || o.k === 'trap' || o.k === 'zone') o.life = 0;
                if (o.k === 'decoy') o.hp = 0;
            }
        }
        if (!p.splash) return;
        for (const foe of s.wiz) {
            if (foe.team === e.tm || foe.i === skip || foe.dead) continue;
            const d = hypot(foe.x - e.x, foe.y + 0.9 - e.y, foe.z - e.z);
            if (d < p.aoe) {
                hurt(s, foe.i, e.dmg * p.splash * (1 - d / p.aoe * 0.5), { from: e.o, spell: e.s });
                if (p.burn && !foe.dead) addStatus(foe, 'burn', p.burn.dur, { dps: p.burn.dps });
            }
        }
    }

    function stepEntities(s) {
        const keep = [];
        const list = s.ents;
        for (let n = 0; n < list.length; n++) {
            const e = list[n];
            switch (e.k) {
                case 'shot': stepShot(s, e, keep); break;
                case 'wall':
                    e.life -= DT;
                    if (e.life > 0 && e.hp > 0) keep.push(e);
                    else emit(s, 'zap', r1(e.x), r1(e.y + 1), r1(e.z), e.el);
                    break;
                case 'pending':
                    e.t -= DT;
                    if (e.t <= 0) { if (!s.guessing) resolveBeam(s, e.o, D.byId(e.s), e, e.power); }
                    else keep.push(e);
                    break;
                case 'strike':
                    e.t -= DT;
                    if (e.t > 0) { keep.push(e); break; }
                    if (s.guessing) break;
                    {
                        const sp = D.byId(e.s), p = sp.p;
                        emit(s, 'boom', r1(e.x), r1(e.y), r1(e.z), p.r, e.el);
                        for (const foe of s.wiz) {
                            if (foe.team === e.tm || foe.dead) continue;
                            if (hypot(foe.x - e.x, foe.z - e.z) >= p.r + A.radius) continue;
                            let dmg = e.dmg;
                            if (p.punish && foe.hp < A.maxHp * 0.6) dmg *= p.punish;
                            hurt(s, foe.i, dmg, { from: e.o, spell: e.s });
                            if (!foe.dead && p.burn) addStatus(foe, 'burn', p.burn.dur, { dps: p.burn.dps });
                        }
                    }
                    break;
                case 'zone': {
                    e.life -= DT;
                    if (e.life <= 0) break;
                    keep.push(e);
                    if (s.guessing) break;
                    const p = D.byId(e.s).p;
                    if (p.ownerOnly) {
                        const me = s.wiz[e.o];
                        if (!me.dead && hypot(me.x - e.x, me.z - e.z) < e.r && p.inkPerSec) me.ink = min(A.maxInk, me.ink + p.inkPerSec * DT);
                        break;
                    }
                    for (const foe of s.wiz) {
                        if (foe.team === e.tm || foe.dead) continue;
                        const d = hypot(foe.x - e.x, foe.z - e.z);
                        if (d >= e.r) continue;
                        if (p.dps) hurt(s, foe.i, p.dps * e.power * DT, { from: e.o, dot: true, spell: e.s });
                        if (foe.dead) continue;
                        if (p.burn) addStatus(foe, 'burn', p.burn.dur, { dps: p.burn.dps });
                        if (p.status) addStatus(foe, p.status.k, p.status.dur);
                        if (p.pull && d > 0.5) {
                            foe.kx += (e.x - foe.x) / d * p.pull * DT * 7;
                            foe.kz += (e.z - foe.z) / d * p.pull * DT * 7;
                        }
                    }
                    break;
                }
                case 'trap': {
                    e.life -= DT;
                    e.arm -= DT;
                    if (e.life <= 0) break;
                    let sprung = false;
                    if (e.arm <= 0 && !s.guessing) {
                        for (const foe of s.wiz) {
                            if (foe.team === e.tm || foe.dead) continue;
                            if (hypot(foe.x - e.x, foe.z - e.z) >= e.r || foe.y - e.y >= 1.2) continue;
                            const sp = D.byId(e.s);
                            emit(s, 'boom', r1(e.x), r1(e.y + 0.3), r1(e.z), sp.p.aoe, e.el);
                            hurt(s, foe.i, e.dmg, { from: e.o, spell: e.s });
                            if (!foe.dead && sp.p.status) applyStatus(s, foe, sp.p.status, e.o, 1);
                            sprung = true;
                            break;
                        }
                    }
                    if (!sprung) keep.push(e);
                    break;
                }
                case 'decoy': {
                    e.life -= DT;
                    if (e.life <= 0 || e.hp <= 0) { emit(s, 'zap', r1(e.x), r1(e.y + 1), r1(e.z), 'shadow'); break; }
                    if (hypot(e.gx - e.x, e.gz - e.z) > 0.5) {
                        const nx = e.x + e.vx * DT, nz = e.z + e.vz * DT;
                        const h = groundUnder(nx, nz);
                        if (h <= e.y + A.step) { e.x = nx; e.z = nz; e.y = h; }
                        else { e.gx = e.x; e.gz = e.z; }
                    }
                    keep.push(e);
                    break;
                }
                default: keep.push(e);
            }
        }
        // anything added while stepping (nothing usually) must not be lost
        for (let n = list.length; n < s.ents.length; n++) keep.push(s.ents[n]);
        s.ents = keep;
    }

    function onAltarNow(w) {
        const a = W.layout.altar;
        return !w.dead && D.octagon(w.x, w.z) <= a.r + 0.3 && w.y >= a.h - 0.4;
    }
    function stepAltar(s) {
        const on = [false, false];
        for (const w of s.wiz) if (onAltarNow(w)) on[w.team] = true;
        s.onAltar = on[0] && on[1] ? 2 : on[0] ? 0 : on[1] ? 1 : -1;
        if (s.guessing || s.onAltar < 0 || s.onAltar === 2) return;
        s.altar[s.onAltar] += DT;
        if (s.altar[s.onAltar] >= A.ritual) {
            if (s.stats) s.stats.ritual = 1;
            finish(s, s.onAltar, 'ritual');
        }
    }
    function stepFog(s) {
        if (s.t < A.fogAt) { s.fog = A.fogStart; return; }
        const k = min(1, (s.t - A.fogAt) / A.fogTime);
        s.fog = A.fogStart + (A.fogEnd - A.fogStart) * k;
        if (s.guessing) return;
        const dps = A.fogDps + (A.fogMaxDps - A.fogDps) * k;
        for (const w of s.wiz) {
            if (w.dead) continue;
            if (hypot(w.x, w.z) > s.fog) hurt(s, w.i, dps * DT, { dot: true, fog: true });
        }
    }
    function step(s) {
        s.tick++;
        s.t += DT;
        if (s.phase === 'countdown') {
            s.phaseT -= DT;
            if (s.phaseT <= 0) { s.phase = 'live'; s.t = 0; emit(s, 'go'); }
            return;
        }
        if (s.phase !== 'live') return;
        for (let i = 0; i < s.wiz.length; i++) {
            stepWizard(s, i);
            if (s.phase !== 'live') return;
        }
        stepEntities(s);
        if (s.phase !== 'live') return;
        stepAltar(s);
        if (s.phase !== 'live') return;
        stepFog(s);
        if (s.phase !== 'live') return;
        for (const p of s.pickups) if (p.t > 0) p.t -= DT;
        if (s.t >= A.hardCap && !s.guessing) {
            const [a, b] = s.score;
            let w;
            if (a !== b) w = a > b ? 0 : 1;
            else if (abs(s.altar[0] - s.altar[1]) > 0.01) w = s.altar[0] > s.altar[1] ? 0 : 1;
            else {
                const left = t => s.wiz.reduce((sum, q) => sum + (q.team === t ? q.hp : 0), 0);
                w = abs(left(0) - left(1)) > 0.01 ? (left(0) > left(1) ? 0 : 1) : -1;
            }
            finish(s, w, 'time');
        }
    }

    // ===============================================================
    // the wire
    //
    // Arrays and short numbers, because over the relays this goes through a signed
    // nostr event five times a second, and with eight seats it has to fit eight of
    // everything. So where everybody is goes every time, and what they have (health,
    // statuses) only when it changes, a few times over since relays drop things, with one
    // seat round in turn in case. What is in somebody's chamber is only sent for a seat a
    // person is in, since a bot's is nobody's business. The guest runs the same step()
    // between snapshots, so this only has to say what changed its mind.
    // ===============================================================
    const r1 = v => round(v * 10) / 10;
    const r2 = v => round(v * 100) / 100;
    const PHASES = ['countdown', 'live', 'matchover'];
    function packFast(w) {
        const flags = (w.dead ? 1 : 0) | (w.stance ? 2 : 0) | (w.aim ? 4 : 0) | (w.grounded ? 8 : 0) | (w.wardZap ? 16 : 0) | (w.safe > 0 ? 32 : 0) | (w.fireT > 0 ? 64 : 0);
        return [r1(w.x), r1(w.y), r1(w.z), r2(w.yaw), r1(w.pitch), r1(w.mvx), r1(w.mvz), r1(w.vy), flags];
    }
    function packSlow(w, human) {
        const st = [];
        for (const k in w.st) st.push(STATUS_INDEX[k], r1(w.st[k].t));
        const out = [w.i, round(w.hp * 2) / 2, round(w.ward), r1(w.respawn), st];
        if (human) {
            const cd = [];
            for (const k in w.cd) cd.push(SPELL_INDEX[k], r1(w.cd[k]));
            out.push(round(w.ink), w.chamber ? SPELL_INDEX[w.chamber.s] : -1, w.chamber ? w.chamber.n : 0, cd, r1(w.fireCd), r1(w.dashCd));
        }
        return out;
    }
    // the same if nothing has happened that a guest's own guess would not work out for itself
    function slowKey(w, human) {
        let k = round(w.hp * 2) + ',' + round(w.ward) + ',' + ceil(w.respawn) + ',';
        for (const n in w.st) k += STATUS_INDEX[n] + ':' + ceil(w.st[n].t) + ';';
        if (human) {
            k += '|' + round(w.ink / 6) + ',' + (w.chamber ? w.chamber.s + w.chamber.n : '');
            for (const n in w.cd) k += SPELL_INDEX[n] + ':' + ceil(w.cd[n]) + ';';
        }
        return k;
    }
    function packEntity(e) {
        switch (e.k) {
            case 'shot': return [e.id, 0, e.si, e.o, r1(e.x), r1(e.y), r1(e.z), r1(e.vx), r1(e.vy), r1(e.vz)];
            case 'wall': return [e.id, 1, e.si, e.o, r1(e.x), r1(e.y), r1(e.z), r2(e.ang), r2(e.hp / e.maxHp), r1(e.life)];
            case 'zone': return [e.id, 2, e.si, e.o, r1(e.x), r1(e.y), r1(e.z), r1(e.life)];
            case 'trap': return [e.id, 3, e.si, e.o, r1(e.x), r1(e.y), r1(e.z), r1(e.life)];
            case 'decoy': return [e.id, 4, e.si, e.o, r1(e.x), r1(e.y), r1(e.z), r1(e.vx), r1(e.vz), r1(e.gx), r1(e.gz), r2(e.yaw), r1(e.life)];
            case 'strike': return [e.id, 5, e.si, e.o, r1(e.x), r1(e.y), r1(e.z), r2(e.t)];
            case 'pending': return [e.id, 6, e.si, e.o, r1(e.x), r1(e.y), r1(e.z), r2(e.dx), r2(e.dy), r2(e.dz), r2(e.t)];
        }
        return null;
    }
    function unpackEntity(s, a, was) {
        const sp = a[2] === ZAP ? null : D.SPELLS[a[2]];
        const owner = s.wiz[a[3]];
        if (!owner || (a[2] !== ZAP && !sp)) return null;
        const base = { id: a[0], si: a[2], s: sp ? sp.id : null, el: sp ? sp.el : 'arcane', o: a[3], tm: owner.team, x: a[4], y: a[5], z: a[6] };
        switch (a[1]) {
            case 0: return Object.assign(base, {
                k: 'shot', vx: a[7], vy: a[8], vz: a[9], r: sp ? sp.p.r : A.zap.r, dmg: sp ? sp.dmg : A.zap.dmg,
                life: was ? was.life : (sp ? sp.p.life || 3.2 : 1), bounce: sp ? sp.p.bounce || 0 : 0, zap: !sp, hits: was ? was.hits : 0
            });
            case 1: return Object.assign(base, {
                k: 'wall', ang: a[7], ca: cos(a[7]), sa: sin(a[7]), hw: sp.p.w / 2, hd: sp.p.d / 2, h: a[5] + sp.p.h,
                hp: a[8], maxHp: 1, life: a[9]
            });
            case 2: return Object.assign(base, { k: 'zone', r: sp.p.r, life: a[7], power: 1 });
            case 3: return Object.assign(base, { k: 'trap', r: sp.p.r, life: a[7], arm: 0, dmg: 0 });
            case 4: return Object.assign(base, { k: 'decoy', vx: a[7], vz: a[8], gx: a[9], gz: a[10], yaw: a[11], life: a[12], hp: 1 });
            case 5: return Object.assign(base, { k: 'strike', r: sp.p.r, t: a[7], dmg: 0 });
            case 6: return Object.assign(base, { k: 'pending', dx: a[7], dy: a[8], dz: a[9], t: a[10], power: 1 });
        }
        return null;
    }
    // humans: the seats somebody is sitting in, whose chambers and cooldowns are needed.
    // full: everything, for a new match or a resync.
    function snapshot(s, extra, humans, full) {
        const hum = humans || [];
        const wire = s._wire || (s._wire = { key: [], left: [], rr: 0 });
        const v = [];
        s.wiz.forEach((w, i) => {
            const human = hum.includes(i);
            const key = slowKey(w, human);
            if (key !== wire.key[i]) { wire.key[i] = key; wire.left[i] = 3; }
        });
        wire.rr = (wire.rr + 1) % s.wiz.length;
        s.wiz.forEach((w, i) => {
            if (full || wire.left[i] > 0 || i === wire.rr) {
                v.push(packSlow(w, hum.includes(i)));
                if (wire.left[i] > 0) wire.left[i]--;
            }
        });
        const d = {
            k: s.tick, m: s.match, ph: PHASES.indexOf(s.phase), pt: r1(s.phaseT), t: r1(s.t),
            sc: s.score, al: [r1(s.altar[0]), r1(s.altar[1])],
            pk: s.pickups.reduce((acc, p, i) => acc | (p.t <= 0 ? 1 << i : 0), 0),
            w: s.wiz.map(packFast),
            v,
            e: s.ents.map(packEntity)
        };
        if (s.over !== null && s.over !== undefined) { d.ov = s.over; d.rs = s.reason; }
        if (extra) Object.assign(d, extra);
        return d;
    }
    function applyFast(w, a) {
        if (a[0] === undefined || a[8] === undefined) return;
        w.x = a[0]; w.y = a[1]; w.z = a[2]; w.yaw = a[3]; w.pitch = a[4]; w.mvx = a[5]; w.mvz = a[6]; w.vy = a[7];
        const f = a[8];
        w.dead = !!(f & 1); w.stance = !!(f & 2); w.aim = !!(f & 4); w.grounded = !!(f & 8); w.wardZap = !!(f & 16); w.safe = f & 32 ? 0.5 : 0;
        if (f & 64) w.fireT = max(w.fireT || 0, 0.1);
    }
    function applySlow(s, a) {
        if (!Array.isArray(a)) return;
        const w = s.wiz[a[0]];
        if (!w) return;
        w.hp = a[1]; w.ward = a[2]; w.respawn = a[3];
        const st = {};
        const list = a[4] || [];
        for (let i = 0; i + 1 < list.length; i += 2) if (STATUS_KEYS[list[i]]) st[STATUS_KEYS[list[i]]] = { t: list[i + 1] };
        w.st = st;
        if (a.length > 5) {
            w.ink = a[5];
            w.chamber = a[6] >= 0 && D.SPELLS[a[6]] ? { s: D.SPELLS[a[6]].id, n: a[7], power: 1 } : null;
            const cd = {};
            const c = a[8] || [];
            for (let i = 0; i + 1 < c.length; i += 2) if (D.SPELLS[c[i]]) cd[D.SPELLS[c[i]].id] = c[i + 1];
            w.cd = cd;
            w.fireCd = a[9] || 0;
            w.dashCd = a[10] || 0;
        }
    }
    function applySnapshot(s, d) {
        if (!d || !Array.isArray(d.w) || !Array.isArray(d.e)) return false;
        s.tick = d.k; s.match = d.m;
        s.phase = PHASES[d.ph] || s.phase;
        s.phaseT = d.pt; s.t = d.t;
        s.score = d.sc || s.score;
        s.altar = d.al || s.altar;
        s.pickups.forEach((p, i) => { p.t = d.pk & (1 << i) ? 0 : 1; });
        d.w.forEach((a, i) => { if (s.wiz[i] && Array.isArray(a)) applyFast(s.wiz[i], a); });
        if (Array.isArray(d.v)) d.v.forEach(a => applySlow(s, a));
        const was = {};
        s.ents.forEach(e => { was[e.id] = e; });
        s.ents = d.e.map(a => {
            if (!Array.isArray(a)) return null;
            return unpackEntity(s, a, was[a[0]]);
        }).filter(Boolean);
        s.over = d.ov === undefined ? null : d.ov;
        s.reason = d.rs || null;
        return true;
    }

    // ===============================================================
    // THE BOTS
    //
    // Same input, same commands, same stance. It has a crosshair that has to get to
    // you, drawing takes it time, and it stands there exposed while it does.
    //
    // A flow field on a coarse grid, one per goal per map, kept for ever since a map does
    // not change. That turns "how do I get to the altar" into a table lookup.
    // ===============================================================
    // the flow fields themselves live in ps1-world.js, one per goal per map
    function nextStep(x, z, gx, gz) { return W.nextStep(x, z, gx, gz); }
    // can this be walked to from there? the check that a map is any good
    function canWalkBetween(ax, az, bx, bz) { return W.canWalkBetween(ax, az, bx, bz); }

    function botSkill(def, difficulty) {
        const d = D.BOT_DIFFICULTY[difficulty] || D.BOT_DIFFICULTY.normal, k = def.skill;
        return {
            react: k.react * d.react,
            dodge: min(0.95, k.dodge * d.dodge),
            quality: min(1, k.quality * d.quality),
            aim: k.aim * d.aim,
            turn: k.turn * d.turn,
            sight: k.sight * d.sight
        };
    }
    function newBrain(def, difficulty, seed, loadout) {
        return {
            def, skill: botSkill(def, difficulty), style: def.style || {},
            loadout: (loadout || (def.style && def.style.pool) || D.DEFAULT_LOADOUT).map(id => D.byId(id)).filter(Boolean),
            rng: (seed >>> 0) || 7,
            target: -1, targetT: 0,
            ring: [], lastSeen: null, seeT: 0, sees: false,
            yaw: null, pitch: 0, errYaw: 0, errPitch: 0, errT: 0,
            plan: null, planT: 0, strafe: 1, strafeT: 0, jumpT: 0,
            drawing: null, drawT: 0, thinkT: 0,
            dodgeT: 0, dodgeX: 0, dodgeJump: false, dashWanted: false, stuckT: 0, lx: 0, lz: 0,
            place: null
        };
    }
    function brnd(b) {
        b.rng ^= b.rng << 13; b.rng ^= b.rng >>> 17; b.rng ^= b.rng << 5; b.rng >>>= 0;
        return b.rng / 4294967296;
    }
    function shotSpeed(w) {
        if (!w.chamber) return A.zap.speed;
        const sp = D.byId(w.chamber.s);
        return sp.p && sp.p.speed ? sp.p.speed : 1e3;
    }
    // What would be useful right now. A score for every spell it can afford, a little
    // noise, and the best one wins. This is where the bots' opinions live.
    function spellValue(s, i, b, sp, sense) {
        const w = s.wiz[i], foe = sense.foe, p = sp.p || {};
        const style = b.style;
        const att = style.aggression === undefined ? 1 : style.aggression;
        const def = style.defence === undefined ? 1 : style.defence;
        const hex = style.hexes === undefined ? 1 : style.hexes;
        const d = sense.dist;
        const foeOnAltar = s.onAltar === foe.team;
        let v = 0;
        switch (sp.kind) {
            case 'shot': {
                v = 18 + (sp.dmg || 0) * 0.75 * att;
                if (sp.charges) v += (sp.charges - 1) * 3;
                if (p.homing) v += 6;
                if (p.ground && sense.foeAir) v -= 12;
                // a slow one against a target far off misses
                if (p.speed < 22 && d > 16) v -= 10;
                if (p.count && d > 14) v -= 12;
                if (p.count && d < 8) v += 12;
                if (p.status) {
                    v += 12 * hex;
                    if (foe.st[p.status.k]) v -= 18;
                }
                if (p.inkBurn) v += foe.ink > 45 ? 16 : -6;
                if (p.dispel) v += foe.ward > 12 || has(foe, 'focus') || has(foe, 'stoneskin') || has(foe, 'overload') ? 26 : -8;
                if (sp.hp) v -= w.hp < 45 ? 20 : 2;
                break;
            }
            case 'beam': {
                v = 22 + (sp.dmg || 0) * 0.8 * att;
                if (d > p.range) v -= 25;
                if (p.execute) v = 10 + (A.maxHp - foe.hp) * 0.75;
                if (p.lifesteal) v += w.hp < 60 ? 14 : 0;
                if (p.inkBurn) v += foe.ink > 40 ? 6 : -2;
                if (p.pull && d < 9) v -= 14;
                break;
            }
            case 'strike': {
                v = 18 + (sp.dmg || 0) * 0.55 * att;
                if (has(foe, 'root') || has(foe, 'freeze') || has(foe, 'stun') || foe.stance) v += 24;
                if (foeOnAltar) v += 16;
                if (p.punish && foe.hp < 60) v += 12;
                if (d > (p.range || 40)) v -= 20;
                break;
            }
            case 'zone': {
                if (p.ownerOnly) {
                    v = w.ink < 40 ? 42 : w.ink < 65 ? 14 : -20;
                    if (sense.seesFoe && d < 16) v -= 14;
                } else if (p.blocks) {
                    v = (sense.seesFoe && w.hp < 65 ? 34 : 6) * def;
                    if (w.ward > 0) v -= 10;
                } else if (p.obscure && !p.dps) {
                    v = sense.seesFoe && w.hp < 55 ? 30 : 14;
                } else {
                    v = 18 + (p.dps || 0) * 1.6 * att;
                    if (has(foe, 'root') || has(foe, 'freeze') || has(foe, 'stun') || foe.stance) v += 18;
                    if (foeOnAltar) v += 26;
                    if (d > (p.range || 26)) v -= 16;
                    if (s.ents.some(e => e.k === 'zone' && e.o === i && e.s === sp.id)) v -= 30;
                }
                break;
            }
            case 'wall': {
                v = (sense.seesFoe ? 28 : 8) * def;
                if (s.ents.some(e => e.k === 'wall' && e.o === i)) v -= 26;
                if (sense.incoming) v += 12;
                break;
            }
            case 'trap': {
                v = 14 + (sense.seesFoe ? -4 : 12);
                if (s.ents.filter(e => e.k === 'trap' && e.o === i).length >= 2) v -= 24;
                if (d < 7) v += 10;
                break;
            }
            case 'summon': {
                v = w.hp < 55 ? 34 : 15;
                if (s.ents.some(e => e.k === 'decoy' && e.o === i)) v -= 30;
                break;
            }
            case 'nova': {
                v = d < p.r - 1 ? 34 + (sp.dmg || 0) * 0.8 : -20;
                if (p.selfDispel && Object.keys(w.st).some(k => (D.STATUS[k] || {}).bad)) v += 22;
                if (p.ground && sense.foeAir) v -= 18;
                break;
            }
            case 'self': {
                if (p.shield) v = (w.ward > 0 ? -30 : (sense.seesFoe ? 26 : 8) + (w.hp < 60 ? 18 : 0)) * def;
                if (p.heal) v = w.hp < 40 ? 52 : w.hp < 65 ? 28 : w.hp < 85 ? 2 : -30;
                if (p.heal && p.status) v += sense.seesFoe ? 12 : 0;
                if (p.ink) v = w.ink < 28 && w.hp > 40 ? 42 : -30;
                if (p.status) {
                    const k = p.status.k;
                    if (w.st[k]) v = -30;
                    else if (k === 'overload') v = w.ink < 35 && w.hp > 40 ? 38 : w.ink < 60 ? 10 : -14;
                    else if (k === 'mirror') v = sense.seesFoe ? 25 : 2;
                    else if (k === 'stoneskin') v = sense.seesFoe ? 26 * def : 8;
                    else if (k === 'pact') v = w.ink < 25 && w.hp > 50 ? 36 : w.hp > 70 && sense.seesFoe ? 14 : -10;
                }
                break;
            }
            case 'move': {
                v = sense.incoming ? 34 : sense.seesFoe && w.hp < 45 ? 34 : 4;
                break;
            }
        }
        if ((style.els || []).includes(sp.el)) v += 7;
        // do not spend the last drop on something small
        const cost = sp.cost || 0;
        if (cost > w.ink - 6 && (sp.dmg || 0) < 18) v -= 8;
        v -= max(0, cost - w.ink * 0.7) * 0.5;
        // the big ones stay occasional, or a machine chaining nukes is a mugging
        v -= max(0, cost - 25) * 0.7;
        return v + brnd(b) * 12;
    }
    function pickSpell(s, i, b, sense) {
        let best = null, score = 8;
        for (const sp of b.loadout) {
            if (canInscribe(s, i, sp)) continue;
            if (KIND_LOADED[sp.kind] && s.wiz[i].chamber) continue;
            const v = spellValue(s, i, b, sp, sense);
            if (v > score) { score = v; best = sp; }
        }
        return best;
    }
    function nearestPickup(s, w, kind) {
        let best = null, far = 1e9;
        for (const p of s.pickups) {
            if (p.kind !== kind || p.t > 0) continue;
            const d = hypot(p.x - w.x, p.z - w.z);
            if (d < far) { far = d; best = p; }
        }
        return best ? { p: best, d: far } : null;
    }
    function incomingShot(s, i) {
        const w = s.wiz[i];
        let hit = null, soon = 0.9;
        for (const e of s.ents) {
            if (e.k !== 'shot' || e.tm === w.team) continue;
            const dx = w.x - e.x, dz = w.z - e.z;
            const sp2 = e.vx * e.vx + e.vz * e.vz;
            if (sp2 < 1) continue;
            const t = (dx * e.vx + dz * e.vz) / sp2;
            if (t < 0 || t > soon) continue;
            const off = hypot(dx - e.vx * t, dz - e.vz * t);
            if (off < 1.6) { soon = t; hit = e; }
        }
        return hit;
    }
    function angleDiff(a, b) {
        let d = a - b;
        while (d > PI) d -= 2 * PI;
        while (d < -PI) d += 2 * PI;
        return d;
    }
    // who it is looking at: somebody it can see before somebody it cannot, nearest first,
    // and it does not change its mind every tick
    function pickTarget(s, i, b) {
        const w = s.wiz[i];
        const cur = s.wiz[b.target];
        b.targetT -= DT;
        if (cur && !cur.dead && cur.team !== w.team && b.targetT > 0) return cur;
        b.targetT = 0.7 + brnd(b) * 0.8;
        let best = null, score = 1e18;
        const eyeY = w.y + 1.6;
        for (const q of s.wiz) {
            if (q.team === w.team || q.dead) continue;
            let v = hypot(q.x - w.x, q.z - w.z);
            if (!clearLine(s, w.x, eyeY, w.z, q.x, q.y + 1.2, q.z)) v += 22;
            if (onAltarNow(q)) v -= 12;
            if (has(q, 'stealth')) v += 30;
            if (q === cur) v -= 5;
            if (v < score) { score = v; best = q; }
        }
        if (best && best !== cur) { b.ring.length = 0; b.lastSeen = null; }
        b.target = best ? best.i : -1;
        return best;
    }
    function think(s, i, b) {
        const w = s.wiz[i];
        if (s.phase !== 'live' || w.dead) {
            s.input[i] = Object.assign(blankInput(), { yaw: w.yaw, pitch: w.pitch });
            b.drawing = null;
            return;
        }
        if (b.yaw === null) { b.yaw = w.yaw; b.pitch = w.pitch; }
        const k = b.skill;
        // with everyone on the other side dead there is nobody to look at, and that is
        // what the altar is for
        const foe = pickTarget(s, i, b) || s.wiz.find(q => q.team !== w.team);

        // ---- what it can see, a beat late ----
        b.thinkT -= DT;
        const eyeY = w.y + 1.6, foeEye = foe.y + 1.2;
        const stealthed = has(foe, 'stealth');
        if (b.thinkT <= 0) {
            b.thinkT = 0.1;
            b.sees = !foe.dead && !stealthed && !has(w, 'blind') && clearLine(s, w.x, eyeY, w.z, foe.x, foeEye, foe.z);
            if (b.sees) {
                for (const e of s.ents) {
                    if (e.k === 'zone' && e.s && D.byId(e.s).p.obscure && e.tm !== w.team && hypot(foe.x - e.x, foe.z - e.z) < e.r) { b.sees = false; break; }
                }
            }
        }
        const lag = floor(k.sight * HZ);
        b.ring.push({ x: foe.x, y: foe.y, z: foe.z, vx: foe.mvx, vz: foe.mvz });
        if (b.ring.length > lag + 1) b.ring.shift();
        const seen = b.ring[0];
        if (b.sees) { b.lastSeen = seen; b.seeT = s.t; }
        const memory = b.lastSeen || { x: foe.x, y: foe.y, z: foe.z, vx: 0, vz: 0 };
        // a decoy works on a machine exactly as it should
        let target = memory;
        const decoy = s.ents.find(e => e.k === 'decoy' && e.tm !== w.team);
        if (decoy && brnd(b) < 0.9 && (!b.sees || stealthed)) target = { x: decoy.x, y: decoy.y, z: decoy.z, vx: decoy.vx, vz: decoy.vz };

        const dist = hypot(target.x - w.x, target.z - w.z);
        const inc = incomingShot(s, i);
        const foeAir = foe.y - heightAt(foe.x, foe.z) > 0.6;
        const sense = { dist, seesFoe: b.sees, incoming: !!inc, foeAir, foe };

        // ---- planning where to go ----
        b.planT -= DT;
        if (b.planT <= 0 || !b.plan) {
            b.planT = 0.4 + brnd(b) * 0.3;
            b.plan = choosePlan(s, i, b, target, sense);
        }
        const plan = b.plan;
        b.strafeT -= DT;
        if (b.strafeT <= 0) { b.strafe = brnd(b) < 0.5 ? -1 : 1; b.strafeT = 0.7 + brnd(b) * 1.4; }

        // ---- drawing ----
        const inp = blankInput();
        if (b.drawing) {
            b.drawT -= DT;
            inp.ink = true;
            if (!canAct(w)) { b.drawing = null; inp.ink = false; }
            else if (b.drawT <= 0) {
                const sp = b.drawing;
                b.drawing = null;
                inp.ink = false;
                // a hurried hand fizzles sometimes, and it only gets told afterwards
                if (brnd(b) > (1 - k.quality) * 0.22) {
                    const q = clamp(k.quality * (0.82 + brnd(b) * 0.25), 0, 1);
                    // the world has moved on while it was drawing
                    if (!canInscribe(s, i, sp)) command(s, i, { c: 'cast', s: sp.id, q });
                }
            }
        } else if (!w.chamber || w.ink > 88) {
            // it does not stop to write poetry with somebody on top of it, usually
            const pressed = sense.seesFoe && dist < 7 && brnd(b) < 0.03;
            b.castWait = (b.castWait || 0) - DT;
            if (b.castWait <= 0 && !pressed && canAct(w) && !has(w, 'blind')) {
                b.castWait = 0.25;
                const sp = pickSpell(s, i, b, sense);
                if (sp) {
                    b.drawing = sp;
                    b.drawT = (0.5 + 0.34 * sp.glyph.length) * (k.react / 1.9) * (0.9 + brnd(b) * 0.3);
                    inp.ink = true;
                }
            }
        }

        // ---- aiming ----
        const sp = w.chamber ? D.byId(w.chamber.s) : null;
        let aimAt;
        const cam = camera(s, w);
        const lead = hypot(target.x - cam.x, target.z - cam.z) / shotSpeed(w);
        const groundAim = sp && (sp.kind === 'strike' || sp.kind === 'zone' || sp.kind === 'trap');
        if (sp && sp.kind === 'wall') {
            const d = dist || 1;
            const near = sp.p.w <= 3 ? 4 : 5.5;
            aimAt = { x: w.x + (target.x - w.x) / d * near, y: heightAt(w.x, w.z) + 0.2, z: w.z + (target.z - w.z) / d * near };
        } else if (sp && sp.p.ownerOnly) {
            aimAt = { x: w.x + sin(w.yaw) * 3, y: heightAt(w.x, w.z), z: w.z - cos(w.yaw) * 3 };
        } else if (sp && (sp.p.blocks)) {
            aimAt = { x: w.x + sin(w.yaw) * 2.5, y: heightAt(w.x, w.z), z: w.z - cos(w.yaw) * 2.5 };
        } else if (groundAim) {
            const delay = sp.kind === 'strike' ? sp.p.delay : 0.4;
            const x = target.x + target.vx * delay, z = target.z + target.vz * delay;
            aimAt = { x, y: heightAt(x, z) + 0.1, z };
        } else {
            const x = target.x + target.vx * lead, z = target.z + target.vz * lead;
            aimAt = { x, y: target.y + 1, z };
        }
        const wantYaw = atan2(aimAt.x - cam.x, -(aimAt.z - cam.z));
        const wantPitch = atan2(aimAt.y - cam.y, hypot(aimAt.x - cam.x, aimAt.z - cam.z));
        b.errT -= DT;
        if (b.errT <= 0) {
            b.errT = 0.25 + brnd(b) * 0.4;
            const r = k.aim * PI / 180;
            b.errYaw = (brnd(b) - 0.5) * 2 * r;
            b.errPitch = (brnd(b) - 0.5) * r;
        }
        if (!inp.ink) {
            const turn = k.turn * DT;
            const dy = angleDiff(wantYaw + b.errYaw, b.yaw), dp = wantPitch + b.errPitch - b.pitch;
            b.yaw += clamp(dy, -turn, turn);
            b.pitch += clamp(dp, -turn, turn);
            b.pitch = clamp(b.pitch, -1.2, 1.2);
        }
        inp.yaw = b.yaw;
        inp.pitch = b.pitch;
        inp.aim = !inp.ink && dist > 17 && b.sees;

        // ---- firing ----
        const aligned = abs(angleDiff(wantYaw, b.yaw)) < 0.3 && abs(wantPitch - b.pitch) < 0.32;
        if (!inp.ink && w.fireCd <= 0 && canAct(w) && aligned) {
            let shoot = false;
            if (sp) {
                if (sp.kind === 'wall') shoot = sense.seesFoe || sense.incoming;
                else if (sp.p.ownerOnly || sp.p.blocks) shoot = true;
                else if (sp.kind === 'trap') shoot = dist < (sp.p.range || 24);
                else if (sp.kind === 'summon') shoot = true;
                else if (sp.kind === 'beam') shoot = b.sees && dist < sp.p.range;
                else if (sp.kind === 'strike' || sp.kind === 'zone') shoot = (b.sees || s.t - b.seeT < 1.2) && dist < (sp.p.range || 30);
                else shoot = b.sees;
            } else shoot = b.sees && dist < A.zap.range * 0.8;
            if (shoot && !foe.dead) command(s, i, { c: 'fire', y: b.yaw, p: b.pitch });
            else if (shoot && sp && (sp.kind === 'trap' || sp.p.ownerOnly)) command(s, i, { c: 'fire', y: b.yaw, p: b.pitch });
        }

        // ---- legs ----
        const gx = plan.x, gz = plan.z;
        const n = nextStep(w.x, w.z, gx, gz);
        let wx = n.x - w.x, wz = n.z - w.z;
        const wl = hypot(wx, wz);
        const arrived = hypot(gx - w.x, gz - w.z) < (plan.loose ? plan.loose : 0.8);
        if (arrived) { wx = 0; wz = 0; } else if (wl > 0) { wx /= wl; wz /= wl; }
        // keep moving sideways whenever somebody is shooting
        if (b.sees && plan.fight) {
            const dx = target.x - w.x, dz = target.z - w.z, l = hypot(dx, dz) || 1;
            const px = -dz / l * b.strafe, pz = dx / l * b.strafe;
            wx += px * 0.8; wz += pz * 0.8;
        }
        // getting out of the way
        b.dodgeT -= DT;
        if (inc && b.dodgeT < -0.2 && brnd(b) < k.dodge * DT * 7) {
            b.dodgeT = 0.34;
            const l = hypot(inc.vx, inc.vz) || 1;
            const side = brnd(b) < 0.5 ? -1 : 1;
            b.dodgeX = -inc.vz / l * side;
            b.dodgeZ = inc.vx / l * side;
            if (brnd(b) < 0.35) inp.dash = true;
            else if (brnd(b) < 0.3) inp.jump = true;
        }
        if (b.dodgeT > 0) { wx += b.dodgeX * 1.8; wz += (b.dodgeZ || 0) * 1.8; }
        const wlen = hypot(wx, wz);
        if (wlen > 0.01) { wx /= wlen; wz /= wlen; }
        // stuck against something
        if (wlen > 0.1 && hypot(w.x - b.lx, w.z - b.lz) < 0.01 && !inp.ink && canWalk(w)) {
            b.stuckT += DT;
            if (b.stuckT > 0.3) { inp.jump = true; b.planT = 0; b.stuckT = 0; b.strafe = -b.strafe; }
        } else b.stuckT = 0;
        b.lx = w.x; b.lz = w.z;

        // world direction into its own left/right and forward/back
        const fx = sin(w.yaw), fz = -cos(w.yaw), rx = cos(w.yaw), rz = sin(w.yaw);
        inp.mx = wx * rx + wz * rz;
        inp.mz = wx * fx + wz * fz;
        s.input[i] = inp;
    }
    function choosePlan(s, i, b, target, sense) {
        const w = s.wiz[i], foe = sense.foe;
        const style = b.style;
        const def = style.defence === undefined ? 1 : style.defence;
        const att = style.aggression === undefined ? 1 : style.aggression;
        const altar = { x: 0, z: 0, loose: W.layout.altar.r * 0.55 };
        // the fog is the boss now
        if (s.fog < A.fogStart && hypot(w.x, w.z) > s.fog - 4) return altar;
        if (s.t > A.fogAt - 10 && hypot(w.x, w.z) > 26) return altar;
        const hp = nearestPickup(s, w, 'hp');
        if (hp && (w.hp < 45 * def || (w.hp < 70 && hp.d < 12))) return { x: hp.p.x, z: hp.p.z };
        const ink = nearestPickup(s, w, 'ink');
        if (ink && (w.ink < 25 || (w.ink < 65 && ink.d < 13))) return { x: ink.p.x, z: ink.p.z };
        for (const kind of ['clock', 'turbo']) {
            const pow = nearestPickup(s, w, kind);
            if (pow && pow.d < 14) return { x: pow.p.x, z: pow.p.z };
        }
        // somebody has to stop the ritual, and if nobody is home it is free
        if (s.onAltar === foe.team) return { x: 0, z: 0, fight: true, loose: 11 };
        const allyOn = s.wiz.some(q => q.team === w.team && q !== w && onAltarNow(q));
        const allDead = s.wiz.every(q => q.team === w.team || q.dead);
        const free = allDead || (!b.sees && s.t - b.seeT > 3);
        const myRit = s.altar[w.team], theirRit = s.altar[1 - w.team];
        // a team does not all need to stand on it. the nearest goes, and the rest fight
        if (!allyOn && (free || s.mode > 1 || myRit > A.ritual * 0.6 || (s.t > 40 && theirRit > myRit + 8))) {
            const myD = hypot(w.x, w.z);
            const closer = s.wiz.some(q => q.team === w.team && q !== w && !q.dead && hypot(q.x, q.z) < myD - 2);
            if (!closer || s.mode === 1) return altar;
        }
        // wants to draw, and somebody can see it: get behind something
        if (b.sees && !w.chamber && w.ink > 16 && def > 0.6 && brnd(b) < 0.5 * def) {
            let bestC = null, bestD = 30;
            for (const c of W.cover) {
                const d = hypot(c[0] - w.x, c[1] - w.z);
                if (d >= bestD) continue;
                if (clearLine(s, c[0], heightAt(c[0], c[1]) + 1.5, c[1], foe.x, foe.y + 1.2, foe.z)) continue;
                bestD = d; bestC = c;
            }
            if (bestC) return { x: bestC[0], z: bestC[1] };
        }
        // otherwise it goes and has the fight, at the range it likes
        const want = (style.range || 16) / (att > 1.2 ? 1.2 : 1);
        const d = hypot(target.x - w.x, target.z - w.z) || 1;
        if (d < want * 0.65) {
            // too close: backs off
            return { x: clamp(w.x - (target.x - w.x) / d * 7, -29, 29), z: clamp(w.z - (target.z - w.z) / d * 7, -29, 29), fight: true };
        }
        return { x: target.x, z: target.z, fight: true, loose: want };
    }

    window.WZ_SIM = {
        newMatch, step, command, setInput, sanitizeInput, blankInput,
        snapshot, applySnapshot,
        useMap, heightAt, camera, muzzle, aimPoint, forward, clearLine, moveWizard, inBox, onAltarNow,
        canInscribe, inscribeCosts, has, canAct, canWalk,
        newBrain, think, botSkill, canWalkBetween,
        HZ, DT, ZAP, KIND_LOADED, SPELL_INDEX, STATUS_KEYS, NAV_SIDE,
        get LAYOUT() { return W.layout; },
        get navPassable() { return W.passable; }
    };
})();
