// ===================================================================
// trailz 98 — the rules, the bots and the wire. No page in here, so node
// runs it (.github/scripts/check-trailz.mjs) exactly as a browser does.
//
// The arena is a square, x to the right and z down when seen from above. A
// cycle faces one of four ways (0 east, 1 south, 2 west, 3 north), so turning
// right is +1 and left is -1. Every wall is a straight line along one of the
// two axes: a cycle's wall is the list of places it turned, starting where it
// started, and then a line from the last turn to wherever it is now. That
// makes every question the rules ask ("does this step cross a wall, and
// where") a comparison of a few numbers.
//
// Finished lines are kept in buckets of 12 by 12 units as well, so a step
// only looks at the walls near it. That changes nothing about the answers,
// only how long they take: a round of eight went from a second to a tenth.
//
// Fairness inside one step. Every cycle moves at once, from where it was to
// where it will be, and a step is a sixtieth of a second, so two cycles can
// reach the same crossing in the same step. Each crossing is timed along the
// step: whoever got there first lays the wall, whoever got there later hits
// it, and two that meet head on, or get there at the same instant, both go.
// None of it depends on which seat is checked first, and the check holds the
// sim to that by playing the same crashes with the seats reversed.
//
// Fairness across the wire is in turnAt(): see there.
// ===================================================================
(function (root) {
    'use strict';

    const TZ = root.TZ;
    if (!TZ) { if (typeof console !== 'undefined') console.warn('[trailz] trailz-data.js is missing'); return; }
    const { abs, min, max, floor, round } = Math;
    const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
    const DT = 1 / TZ.TICK;
    const EPS = 1e-7;
    const BUCKET = 12;
    const PHASES = ['count', 'race', 'end', 'over'];

    // a small seeded generator, so a bot given the same seed does the same thing
    function rng(seed) {
        let a = (seed >>> 0) || 1;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ---------------------------------------------------------------
    // where everybody starts
    //
    // Four places, a quarter turn apart round the middle, each heading in and
    // off to one side, so no two start on the same line: nobody is born in a
    // head on crash. Eight is a second ring of four just inside the first.
    // The first two seats are opposite each other, so a duel is fair.
    // ---------------------------------------------------------------
    const RINGS = [[-0.15, 0.4, 3], [0.06, 0.3, 3]];
    const ORDER = [0, 2, 1, 3, 4, 6, 5, 7];
    function spawns(n, S) {
        const out = [], c = S / 2;
        for (let i = 0; i < n; i++) {
            const slot = ORDER[i], ring = RINGS[slot >> 2], q = slot & 3;
            let ox = ring[0], oz = ring[1], d = ring[2];
            for (let r = 0; r < q; r++) { const t = ox; ox = -oz; oz = t; d = (d + 1) & 3; }
            out.push({ x: c + ox * S, z: c + oz * S, dir: d });
        }
        return out;
    }

    // ---------------------------------------------------------------
    // a match
    // ---------------------------------------------------------------
    function newMatch(o) {
        o = o || {};
        const arena = TZ.ARENA_BY_ID[o.arena] || TZ.ARENA_BY_ID.medium;
        const seats = (o.seats || []).slice(0, TZ.MAX_SEATS).map((p, i) => ({
            id: p.id || 'seat' + i, name: String(p.name || 'cycle ' + (i + 1)).slice(0, 16),
            bot: p.bot || null, on: !p.bot, human: !p.bot
        }));
        while (seats.length < TZ.MIN_SEATS) seats.push({ id: 'bot' + seats.length, name: TZ.BOT_NAMES[seats.length], bot: 'normal', on: false, human: false });
        // the floor grows with the number of cycles on it: a duel on a floor made for
        // eight is a minute and a half of two people never meeting
        const S = o.size > 20 ? +o.size : round(arena.size * (0.62 + 0.38 * min(1, (seats.length - 2) / 6)));
        const s = {
            seed: (o.seed >>> 0) || 1, arena, S, seats, n: seats.length,
            rounds: TZ.ROUNDS.includes(+o.rounds) ? +o.rounds : 5,
            round: 0, tick: 0, phase: 'count', phaseT: 0, raceT: 0,
            scores: seats.map(() => 0), wins: seats.map(() => 0), lastWinner: -1,
            cycles: [], events: [], quiet: !!o.quiet,
            gw: Math.ceil(S / TZ.CELL), grid: null, gridDirty: false,
            bw: Math.ceil(S / BUCKET) + 1, buckets: null, segs: [], qstamp: 0, found: [],
            puppet: !!o.puppet
        };
        s.grid = new Uint8Array(s.gw * s.gw);
        s.buckets = Array.from({ length: s.bw * s.bw }, () => []);
        newRound(s);
        return s;
    }

    function newRound(s) {
        s.round++;
        s.phase = 'count'; s.phaseT = 0; s.raceT = 0;
        const at = spawns(s.n, s.S);
        s.cycles = at.map((p, i) => ({
            i, x: p.x, z: p.z, dir: p.dir, speed: TZ.BASE_SPEED, alive: true,
            pts: [p.x, p.z], lastTurn: -999, q: [], braking: false, fuel: 1, grind: 0,
            ahead: null, turnNext: 0, killMark: null, deadAt: -1, deadT: 0, fade: 1, gone: false,
            cause: null, place: 0
        }));
        s.alive = s.n;
        rebuildGrid(s);
        emit(s, { e: 'round', r: s.round });
    }

    function emit(s, ev) { if (!s.quiet) s.events.push(ev); if (s.events.length > 200) s.events.splice(0, s.events.length - 200); }

    // how fast the open floor is this far into a round
    function baseSpeed(s) {
        const over = s.raceT / TZ.TICK - TZ.RAMP_AFTER;
        return TZ.BASE_SPEED * (1 + (over > 0 ? over * TZ.RAMP : 0));
    }

    // ---------------------------------------------------------------
    // walls
    // ---------------------------------------------------------------
    // the bots' picture of the floor: a coarse grid of where walls are
    function mark(s, x0, z0, x1, z1) {
        const C = TZ.CELL, gw = s.gw, g = s.grid;
        let cx0 = floor(x0 / C), cz0 = floor(z0 / C), cx1 = floor(x1 / C), cz1 = floor(z1 / C);
        if (cx0 > cx1) { const t = cx0; cx0 = cx1; cx1 = t; }
        if (cz0 > cz1) { const t = cz0; cz0 = cz1; cz1 = t; }
        for (let z = max(0, cz0); z <= min(gw - 1, cz1); z++) for (let x = max(0, cx0); x <= min(gw - 1, cx1); x++) g[z * gw + x] = 1;
    }
    const bk = (s, v) => min(s.bw - 1, max(0, floor(v / BUCKET)));
    function addSeg(s, px, pz, qx, qz, o) {
        const id = s.segs.length;
        s.segs.push({ px, pz, qx, qz, o, q: 0 });
        const x0 = bk(s, min(px, qx)), x1 = bk(s, max(px, qx)), z0 = bk(s, min(pz, qz)), z1 = bk(s, max(pz, qz));
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) s.buckets[z * s.bw + x].push(id);
    }
    // every finished line near a box, each once, into s.found; how many
    function gather(s, xa, za, xb, zb) {
        const q = ++s.qstamp, out = s.found, segs = s.segs, bw = s.bw;
        let n = 0;
        const x0 = bk(s, min(xa, xb)), x1 = bk(s, max(xa, xb)), z0 = bk(s, min(za, zb)), z1 = bk(s, max(za, zb));
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
            const b = s.buckets[z * bw + x];
            for (let k = 0; k < b.length; k++) {
                const g = segs[b[k]];
                if (g.q === q) continue;
                g.q = q; out[n++] = g;
            }
        }
        return n;
    }
    // the grid and the buckets again, from the turn points
    function rebuildGrid(s) {
        s.grid.fill(0);
        for (const b of s.buckets) b.length = 0;
        s.segs.length = 0;
        for (const c of s.cycles) {
            if (c.gone) continue;
            const p = c.pts;
            for (let k = 0; k + 3 < p.length; k += 2) { mark(s, p[k], p[k + 1], p[k + 2], p[k + 3]); addSeg(s, p[k], p[k + 1], p[k + 2], p[k + 3], c.i); }
            mark(s, p[p.length - 2], p[p.length - 1], c.x, c.z);
        }
        s.gridDirty = false;
    }
    // every wall line as (ax, az, bx, bz, owner, open), for whoever draws them
    function forEachWall(s, fn) {
        for (const c of s.cycles) {
            if (c.gone) continue;
            const p = c.pts;
            for (let k = 0; k + 3 < p.length; k += 2) fn(p[k], p[k + 1], p[k + 2], p[k + 3], c.i, false);
            fn(p[p.length - 2], p[p.length - 1], c.x, c.z, c.i, true);
        }
    }

    // Going along axis ax (0 x, 1 z) the sg way from c0, at f across: how far
    // to the wall p-q, or -1 for never. A wall across the line is met where its
    // own x (or z) is; a wall along it only when it is on the very same line.
    function meet(ax, sg, c0, f, px, pz, qx, qz) {
        const pa = ax ? pz : px, qa = ax ? qz : qx, pf = ax ? px : pz, qf = ax ? qx : qz;
        if (pf === qf && pa !== qa) {
            if (abs(pf - f) > EPS) return -1;
            const lo = min(pa, qa), hi = max(pa, qa);
            if (sg > 0) return lo > c0 + EPS ? lo - c0 : -1;
            return hi < c0 - EPS ? c0 - hi : -1;
        }
        const lo = min(pf, qf), hi = max(pf, qf);
        if (f < lo - EPS || f > hi + EPS) return -1;
        const d = sg * (pa - c0);
        return d > EPS ? d : -1;
    }

    // how far along a straight line from (x, z) heading dir something is in
    // the way, up to `limit`, leaving out the open line of cycle `skip`
    function rayHit(s, x, z, dir, limit, skip) {
        if (skip === null || skip === undefined) skip = -1;
        const ax = dir & 1, sg = dir < 2 ? 1 : -1;
        const c0 = ax ? z : x, f = ax ? x : z;
        let best = limit, by = -2;
        const toEdge = sg > 0 ? s.S - c0 : c0;
        if (toEdge < best) { best = max(0, toEdge); by = -1; }
        const reach = min(best, s.S + 1);
        const n = gather(s, x, z, x + DX[dir] * reach, z + DZ[dir] * reach);
        for (let k = 0; k < n; k++) {
            const g = s.found[k];
            const d = meet(ax, sg, c0, f, g.px, g.pz, g.qx, g.qz);
            if (d > 0 && d < best) { best = d; by = g.o; }
        }
        for (const c of s.cycles) {
            if (c.gone || c.i === skip) continue;
            const p = c.pts, L = p.length;
            const d = meet(ax, sg, c0, f, p[L - 2], p[L - 1], c.x, c.z);
            if (d > 0 && d < best) { best = d; by = c.i; }
        }
        return { d: best, by };
    }
    function rayDist(s, i, dir, limit) {
        const c = s.cycles[i];
        return rayHit(s, c.x, c.z, dir, limit || 1e9, i).d;
    }

    // the nearest wall beside a cycle, on either side, for the grind
    function sideDist(s, c, range) {
        const ax = c.dir & 1;
        const along = ax ? c.z : c.x, f = ax ? c.x : c.z;
        let best = min(range, f, s.S - f);
        const check = (px, pz, qx, qz) => {
            const pa = ax ? pz : px, qa = ax ? qz : qx, pf = ax ? px : pz, qf = ax ? qx : qz;
            if (pf !== qf || pa === qa) return;           // only walls running alongside
            if (along < min(pa, qa) || along > max(pa, qa)) return;
            const d = abs(pf - f);
            if (d < best) best = d;
        };
        const n = ax ? gather(s, c.x - range, c.z, c.x + range, c.z) : gather(s, c.x, c.z - range, c.x, c.z + range);
        for (let k = 0; k < n; k++) { const g = s.found[k]; check(g.px, g.pz, g.qx, g.qz); }
        for (const o of s.cycles) {
            if (o.gone || o === c) continue;
            const p = o.pts, L = p.length;
            check(p[L - 2], p[L - 1], o.x, o.z);
        }
        return best;
    }

    // ---------------------------------------------------------------
    // turning
    // ---------------------------------------------------------------
    // a press, from the keyboard on this screen or a bot: it waits for the gap
    function turn(s, i, d) {
        const c = s.cycles[i];
        if (!c || !c.alive || s.phase === 'over' || s.phase === 'end') return false;
        if (d !== 1 && d !== -1) return false;
        if (c.q.length < 3) c.q.push(d);
        return true;
    }
    function doTurn(s, c, d) {
        const p = c.pts, L = p.length;
        addSeg(s, p[L - 2], p[L - 1], c.x, c.z, c.i);
        p.push(c.x, c.z);
        c.dir = (c.dir + d + 4) & 3;
        c.lastTurn = s.tick;
        c.killMark = null;
        emit(s, { e: 'turn', i: c.i, d, x: c.x, z: c.z });
    }
    function brake(s, i, on) {
        const c = s.cycles[i];
        if (c) c.braking = !!on;
    }
    function turnsOf(c) { return (c.pts.length >> 1) - 1; }

    // A guest's turn, which reaches the host a ping late. The guest says where
    // its cycle was when the key went down: `at`, the one coordinate that
    // changes along its current line, and `k`, how many turns it had made, so
    // the host knows which line that is. The host then puts the turn there:
    //
    //   behind the cycle (the usual case) the cycle is moved back to that spot,
    //   turned, and sent on the new way for the same distance, as if the host
    //   had heard it on time. Never further back than TZ.REWIND seconds of
    //   driving, never across the turn gap, and never back past a place where
    //   somebody has already died against this line: a wall that killed
    //   somebody stays. The new stretch is checked against every wall there is
    //   now, so a lagging cycle gets no wall-free shortcut out of it.
    //   ahead of the cycle (the guest's screen ran a little ahead) it turns
    //   when it gets there, within TZ.AHEAD seconds.
    //
    // A turn that cannot be placed is still a turn: it happens now.
    function turnAt(s, i, d, at, k) {
        const c = s.cycles[i];
        if (!c || !c.alive || s.phase !== 'race' || (d !== 1 && d !== -1) || typeof at !== 'number' || !isFinite(at)) return turn(s, i, d) && 'now';
        if (k !== turnsOf(c) || c.q.length || c.ahead || c.turnNext) { turn(s, i, d); return 'queued'; }
        const ax = c.dir & 1, sg = c.dir < 2 ? 1 : -1;
        const cur = ax ? c.z : c.x;
        const back = sg * (cur - at);
        if (back < 0) {
            if (-back <= TZ.AHEAD * c.speed) { c.ahead = { at, d }; return 'ahead'; }
            turn(s, i, d); return 'now';
        }
        let room = TZ.REWIND * c.speed;
        room = min(room, (s.tick - c.lastTurn - TZ.TURN_GAP) * c.speed * DT);
        const start = ax ? c.pts[c.pts.length - 1] : c.pts[c.pts.length - 2];
        room = min(room, sg * (cur - start) - 1e-3);
        if (c.killMark !== null) room = min(room, sg * (cur - c.killMark) - 0.05);
        const b = min(back, room);
        if (!(b > 1e-6)) { turn(s, i, d); return 'now'; }
        // back to the spot, and the turn there
        const px = c.x - DX[c.dir] * b, pz = c.z - DZ[c.dir] * b;
        c.x = px; c.z = pz;
        doTurn(s, c, d);
        c.lastTurn = s.tick - round(b / c.speed * TZ.TICK);
        // then the same distance the new way, against everything that is up now
        const hit = rayHit(s, px, pz, c.dir, b, i);
        c.x = px + DX[c.dir] * hit.d; c.z = pz + DZ[c.dir] * hit.d;
        s.gridDirty = true;
        if (hit.d < b) {
            const back2 = min(0.02, hit.d);
            c.x -= DX[c.dir] * back2; c.z -= DZ[c.dir] * back2;
            kill(s, [{ c, by: hit.by }]);
            settle(s);
            return 'crashed';
        }
        return b < back ? 'clamped' : 'rewound';
    }

    // ---------------------------------------------------------------
    // one step
    // ---------------------------------------------------------------
    function step(s) {
        s.tick++;
        if (s.phase === 'over') return;
        if (s.phase === 'count') {
            for (const c of s.cycles) c.q.length = 0;
            if (++s.phaseT >= TZ.COUNTDOWN * TZ.TICK) { s.phase = 'race'; s.phaseT = 0; emit(s, { e: 'go' }); }
            return;
        }
        if (s.phase === 'end') {
            fades(s);
            if (s.gridDirty) rebuildGrid(s);
            if (++s.phaseT >= TZ.ROUND_END * TZ.TICK) {
                if (s.round >= s.rounds) { s.phase = 'over'; s.phaseT = 0; emit(s, { e: 'over' }); }
                else newRound(s);
            }
            return;
        }
        s.raceT++;
        s.phaseT++;
        // turns waiting for the gap, and turns placed ahead
        for (const c of s.cycles) {
            if (!c.alive) continue;
            if (c.turnNext) { doTurn(s, c, c.turnNext); c.turnNext = 0; continue; }
            if (c.q.length && s.tick - c.lastTurn >= TZ.TURN_GAP) doTurn(s, c, c.q.shift());
        }
        // speed: the grind, the brake, and getting back to base
        const base = baseSpeed(s), top = TZ.MAX_SPEED * base / TZ.BASE_SPEED;
        for (const c of s.cycles) {
            if (!c.alive) continue;
            if (c.braking && c.fuel > 0) {
                c.speed = max(TZ.BRAKE_SPEED * base, c.speed - TZ.BRAKE_DECEL * DT);
                c.fuel = max(0, c.fuel - TZ.BRAKE_DRAIN * DT);
                c.grind = 0;
            } else {
                if (!c.braking) c.fuel = min(1, c.fuel + TZ.BRAKE_FILL * DT);
                const d = sideDist(s, c, TZ.GRIND_RANGE);
                const g = d < TZ.GRIND_RANGE ? 1 - d / TZ.GRIND_RANGE : 0;
                c.grind = g;
                if (g > 0) c.speed = min(top, c.speed + TZ.GRIND_ACCEL * g * DT);
                else if (c.speed > base) c.speed = max(base, c.speed - TZ.DECAY * DT);
                if (c.speed < base) c.speed = min(base, c.speed + TZ.RECOVER * DT);
            }
        }
        move(s);
        fades(s);
        if (s.gridDirty) rebuildGrid(s);
    }

    // Every living cycle goes from p0 to p1 at once. What happens on the way
    // is a list of events, each at a time t between 0 and 1 in the step, and
    // they are taken in order of time, so a cycle that dies early in the step
    // never gets to lay the rest of its wall, and so kills nobody with it.
    function move(s) {
        const m = [], mm = new Array(s.n).fill(null);
        for (const c of s.cycles) {
            if (!c.alive) continue;
            let len = c.speed * DT;
            // a turn placed ahead: go as far as the spot, turn there next step
            if (c.ahead) {
                const ax = c.dir & 1, sg = c.dir < 2 ? 1 : -1;
                const to = sg * (c.ahead.at - (ax ? c.z : c.x));
                if (to <= len) {
                    len = max(0, to);
                    if (s.tick - c.lastTurn + 1 >= TZ.TURN_GAP) c.turnNext = c.ahead.d; else c.q.push(c.ahead.d);
                    c.ahead = null;
                } else if (to > TZ.AHEAD * c.speed * 2) { c.q.push(c.ahead.d); c.ahead = null; }
            }
            const a = { c, x0: c.x, z0: c.z, x1: c.x + DX[c.dir] * len, z1: c.z + DZ[c.dir] * len, len, die: -1, by: -2, head: false };
            m.push(a); mm[c.i] = a;
        }
        if (!m.length) return;
        const ev = [];
        for (const a of m) {
            const c = a.c, ax = c.dir & 1, sg = c.dir < 2 ? 1 : -1;
            const c0 = ax ? a.z0 : a.x0, f = ax ? a.x0 : a.z0, L = a.len;
            if (L <= 0) continue;
            // the border
            const edge = sg > 0 ? s.S - c0 : c0;
            if (edge <= L) ev.push({ t: max(0, edge) / L, who: a, by: -1, need: null, u: -1, head: null });
            // finished lines near the step: they are simply there
            const n = gather(s, a.x0, a.z0, a.x1, a.z1);
            for (let k = 0; k < n; k++) {
                const g = s.found[k];
                const d = meet(ax, sg, c0, f, g.px, g.pz, g.qx, g.qz);
                if (d > 0 && d <= L) ev.push({ t: d / L, who: a, by: g.o, need: null, u: -1, head: null });
            }
            // everybody else's open line, which may be growing this very step
            for (const o of s.cycles) {
                if (o.gone || o === c) continue;
                const p = o.pts, P = p.length, px = p[P - 2], pz = p[P - 1];
                const mo = mm[o.i];
                const qx = mo ? mo.x1 : o.x, qz = mo ? mo.z1 : o.z;
                const pa = ax ? pz : px, qa = ax ? qz : qx, pf = ax ? px : pz;
                if (mo && (mo.c.dir & 1) === ax && abs(pf - f) <= EPS && pa !== qa) {
                    // on the same line as another moving cycle
                    const osg = mo.c.dir < 2 ? 1 : -1;
                    if (osg !== sg) {
                        // head on: we meet where the two fronts do
                        const gap = sg * ((ax ? mo.z0 : mo.x0) - c0);
                        if (gap >= 0 && gap <= L + mo.len) ev.push({ t: gap / (L + mo.len), who: a, by: o.i, need: null, u: -1, head: mo });
                        continue;
                    }
                    // the same way: only where its line starts can be in front of us
                    const lo = min(pa, qa), hi = max(pa, qa);
                    const d = sg > 0 ? lo - c0 : c0 - hi;
                    if (d > EPS && d <= L) ev.push({ t: d / L, who: a, by: o.i, need: null, u: -1, head: null });
                    continue;
                }
                const d = meet(ax, sg, c0, f, px, pz, qx, qz);
                if (!(d > 0 && d <= L)) continue;
                // where on its line we cross it, and so when it got there
                let u = -1;
                if (mo && mo.len > 0) {
                    const hitAlong = c0 + sg * d;
                    const hx = ax ? f : hitAlong, hz = ax ? hitAlong : f;
                    const oax = mo.c.dir & 1, osg2 = mo.c.dir < 2 ? 1 : -1;
                    const past = osg2 * ((oax ? hz : hx) - (oax ? mo.z0 : mo.x0));
                    if (past > 0) u = past / mo.len;
                }
                ev.push({ t: d / L, who: a, by: o.i, need: u >= 0 ? mo : null, u, head: null });
            }
        }
        ev.sort((p, q) => p.t - q.t);
        for (const e of ev) {
            const a = e.who;
            if (a.die >= 0 && a.die < e.t) continue;
            if (e.head) {
                const b = e.head;
                if (b.die >= 0 && b.die < e.t) continue;
                if (a.die < 0) { a.die = e.t; a.by = e.by; a.head = true; }
                if (b.die < 0) { b.die = e.t; b.by = a.c.i; b.head = true; }
                continue;
            }
            if (e.need) {
                // its wall at that spot is only there if it got there no later than us, and lived to
                if (e.u > e.t) continue;
                if (e.need.die >= 0 && e.need.die < e.u) continue;
            }
            if (a.die < 0) { a.die = e.t; a.by = e.by; }
        }
        const died = [];
        for (const a of m) {
            const c = a.c;
            const t = a.die >= 0 ? a.die : 1;
            let len = a.len * t;
            if (a.die >= 0) len = max(0, len - 0.02);
            const nx = a.x0 + DX[c.dir] * len, nz = a.z0 + DZ[c.dir] * len;
            mark(s, c.x, c.z, nx, nz);
            c.x = nx; c.z = nz;
            if (a.die >= 0) died.push({ c, by: a.by, head: a.head });
        }
        // a death against a living cycle's open line pins that line from there back
        for (const d of died) {
            if (d.by < 0 || d.head) continue;
            const o = s.cycles[d.by];
            if (!o || !o.alive) continue;
            const ax = o.dir & 1, sg = o.dir < 2 ? 1 : -1;
            const across = ax ? d.c.x : d.c.z, f = ax ? o.x : o.z;
            if (abs(across - f) > 0.05) continue;
            const spot = ax ? d.c.z : d.c.x;
            if (o.killMark === null || sg * (spot - o.killMark) > 0) o.killMark = spot;
        }
        if (died.length) kill(s, died);
        settle(s);
    }

    function kill(s, died) {
        const now = [];
        for (const d of died) {
            const c = d.c;
            if (!c.alive) continue;
            c.alive = false; c.deadAt = s.tick; c.deadT = 0; c.q.length = 0; c.ahead = null; c.turnNext = 0;
            c.cause = { by: d.by, head: !!d.head };
            c.speed = 0; c.grind = 0;
            now.push(c);
            emit(s, { e: 'die', i: c.i, by: d.by, head: !!d.head, x: c.x, z: c.z });
        }
        // a point for outliving each of them, to everybody still going
        const left = s.cycles.filter(c => c.alive);
        for (let k = 0; k < now.length; k++) for (const c of left) s.scores[c.i] += TZ.POINT_OUTLIVE;
        for (const c of now) c.place = left.length + 1;
        s.alive = left.length;
    }

    // the round ends when one is left, or none
    function settle(s) {
        if (s.phase !== 'race') return;
        const left = s.cycles.filter(c => c.alive);
        if (left.length > 1) return;
        s.phase = 'end'; s.phaseT = 0;
        s.lastWinner = left.length ? left[0].i : -1;
        if (left.length) { s.scores[left[0].i] += TZ.POINT_WIN; s.wins[left[0].i]++; left[0].place = 1; }
        emit(s, { e: 'end', w: s.lastWinner });
    }

    // a dead cycle's wall stays up a moment, then goes
    function fades(s) {
        for (const c of s.cycles) {
            if (c.alive || c.gone) continue;
            c.deadT += DT;
            const t = c.deadT - TZ.WALL_LINGER;
            c.fade = t <= 0 ? 1 : max(0, 1 - t / TZ.WALL_FADE);
            if (c.fade <= 0) { c.gone = true; s.gridDirty = true; }
        }
    }

    // ---------------------------------------------------------------
    // seats
    // ---------------------------------------------------------------
    // a person sitting down in a seat a bot was keeping, or getting up from one
    function seatOn(s, i, on, id, name) {
        const p = s.seats[i];
        if (!p) return;
        if (on) { p.on = true; p.human = true; p.bot = null; if (id) p.id = id; if (name) p.name = String(name).slice(0, 16); }
        else { p.on = false; if (p.human) p.bot = p.bot || 'normal'; }
    }
    function humansLeft(s) { return s.cycles.some(c => c.alive && s.seats[c.i].on && !s.seats[c.i].bot); }

    // ---------------------------------------------------------------
    // the bots
    //
    // A bot drives straight on until the way ahead gets short, then takes the
    // turn that leaves it the most: the most floor, for a bot good enough to
    // count it (a flood of the coarse grid from just round the corner), else
    // simply the longest line. A good bot also turns early when the way ahead
    // runs into a pocket, cuts in front of somebody running alongside it, and
    // likes to hug a wall for the speed. A bad bot looks less often, sees less
    // far and now and then does not look at all.
    // ---------------------------------------------------------------
    function newBot(level, seed) {
        const L = TZ.BOTS[level] || TZ.BOTS.normal;
        return { L, level: TZ.BOTS[level] ? level : 'normal', r: rng(seed), wait: 0, t: 0 };
    }
    let fq = null, fv = null, fstamp = 1;
    function flood(s, cx, cz, cap) {
        const gw = s.gw, g = s.grid, n = gw * gw;
        if (cx < 0 || cz < 0 || cx >= gw || cz >= gw) return 0;
        if (g[cz * gw + cx]) return 0;
        if (!fq || fq.length < n) { fq = new Int32Array(n); fv = new Uint32Array(n); fstamp = 1; }
        fstamp++;
        if (fstamp > 4e9) { fv.fill(0); fstamp = 1; }
        let h = 0, t = 0, count = 0;
        fq[t++] = cz * gw + cx; fv[cz * gw + cx] = fstamp;
        while (h < t && count < cap) {
            const k = fq[h++]; count++;
            const x = k % gw;
            if (x > 0 && !g[k - 1] && fv[k - 1] !== fstamp) { fv[k - 1] = fstamp; fq[t++] = k - 1; }
            if (x < gw - 1 && !g[k + 1] && fv[k + 1] !== fstamp) { fv[k + 1] = fstamp; fq[t++] = k + 1; }
            if (k >= gw && !g[k - gw] && fv[k - gw] !== fstamp) { fv[k - gw] = fstamp; fq[t++] = k - gw; }
            if (k < n - gw && !g[k + gw] && fv[k + gw] !== fstamp) { fv[k + gw] = fstamp; fq[t++] = k + gw; }
        }
        return count;
    }
    // the floor a way leaves, counted from just round the corner
    function roomFor(s, c, d, r, cap) {
        const C = TZ.CELL;
        const off = min(r - 0.4, C * 1.2);
        if (off <= 0) return 0;
        return flood(s, floor((c.x + DX[d] * off) / C), floor((c.z + DZ[d] * off) / C), cap);
    }
    // Whose floor is whose: a flood from every head at once, a ring of cells at a
    // time, and a cell belongs to whoever gets there first. Two at once: nobody's,
    // and nothing goes on through it. Returns how much more is mine than anybody
    // else's, were my head at cell `mine`.
    let vq = null, vs = null, vl = null, vr = null, vstamp = 1;
    function territory(s, mine, others) {
        const gw = s.gw, g = s.grid, n = gw * gw;
        if (!vq || vq.length < n) { vq = new Int32Array(n); vs = new Uint32Array(n); vl = new Uint8Array(n); vr = new Uint16Array(n); vstamp = 1; }
        vstamp++;
        let t = 0, ring = 0;
        const claim = (k, lab) => {
            if (g[k]) return;
            if (vs[k] === vstamp) { if (vr[k] === ring && vl[k] !== lab) vl[k] = 3; return; }
            vs[k] = vstamp; vl[k] = lab; vr[k] = ring; vq[t++] = k;
        };
        if (mine < 0 || mine >= n || g[mine]) return -n;
        claim(mine, 1);
        for (const k of others) if (k >= 0 && k < n) claim(k, 2);
        let h = 0, me = 0, them = 0;
        while (h < t) {
            const end = t;
            ring++;
            for (; h < end; h++) {
                const k = vq[h], lab = vl[k];
                if (lab === 3) continue;
                if (lab === 1) me++; else them++;
                const x = k % gw;
                if (x > 0) claim(k - 1, lab);
                if (x < gw - 1) claim(k + 1, lab);
                if (k >= gw) claim(k - gw, lab);
                if (k < n - gw) claim(k + gw, lab);
            }
        }
        return me - them;
    }
    // the cell a cycle's head is about to be in, going way d
    function headCell(s, x, z, d, r) {
        const C = TZ.CELL, off = min(r - 0.4, C * 1.2);
        if (off <= 0) return -1;
        const cx = floor((x + DX[d] * off) / C), cz = floor((z + DZ[d] * off) / C);
        if (cx < 0 || cz < 0 || cx >= s.gw || cz >= s.gw) return -1;
        return cz * s.gw + cx;
    }
    function think(s, i, bot) {
        const c = s.cycles[i];
        if (!c || !c.alive || s.phase !== 'race' || c.q.length || c.ahead || c.turnNext) return;
        const L = bot.L;
        const stepLen = c.speed * DT;
        // how short the way ahead may get before it is time to turn
        const near = stepLen * (TZ.TURN_GAP + L.every + 2) + L.panic;
        const ahead = rayDist(s, i, c.dir, L.look + near);
        const urgent = ahead < near;
        if (!urgent && bot.wait > 0) { bot.wait--; return; }
        bot.wait = L.every;
        bot.t++;
        // a missed look: this time it does nothing at all
        if (L.slip && bot.r() < L.slip) return;
        if (s.gridDirty) rebuildGrid(s);
        const opts = [0, -1, 1], ray = [ahead, 0, 0], ok = [false, false, false], room = [0, 0, 0];
        for (let k = 1; k < 3; k++) ray[k] = rayDist(s, i, (c.dir + opts[k] + 4) & 3, L.look + near);
        // any way taken has to leave room for the turn after it, which waits for the gap
        const room1 = stepLen * (TZ.TURN_GAP + 2) + 0.3;
        for (let k = 0; k < 3; k++) ok[k] = ray[k] > room1;
        if (!urgent) {
            // nothing in the way: a good bot still looks at where the way is going
            if (L.voronoi === 1 && bot.t % 4 === 0) {
                const others = heads(s, c);
                const v = [0, 1, 2].map(k => ok[k] ? territory(s, headCell(s, c.x, c.z, (c.dir + opts[k] + 4) & 3, ray[k]), others) : -1e9);
                const best = v[1] >= v[2] ? 1 : 2;
                if (ok[best] && v[best] > v[0] + 30 && ray[best] > 6) { turn(s, i, opts[best]); return; }
            } else if (L.space && L.early && bot.t % 3 === 0) {
                for (let k = 0; k < 3; k++) room[k] = ok[k] ? roomFor(s, c, (c.dir + opts[k] + 4) & 3, ray[k], L.space) : 0;
                const best = room[1] >= room[2] ? 1 : 2;
                if (ok[best] && room[best] > room[0] * 1.8 + 40 && ray[best] > 6) { turn(s, i, opts[best]); return; }
            }
            if (L.hunt && bot.r() < L.hunt && cutIn(s, c, ray, ok)) return;
            return;
        }
        // time to turn: the way that leaves the most
        let pick = -1, score = -1e9;
        const others = L.voronoi ? heads(s, c) : null;
        for (let k = 0; k < 3; k++) {
            if (!ok[k]) continue;
            const d = (c.dir + opts[k] + 4) & 3;
            let v = min(ray[k], L.look) * 4;
            if (L.voronoi) v += territory(s, headCell(s, c.x, c.z, d, ray[k]), others) * 0.5 + roomFor(s, c, d, ray[k], 400) * 0.3;
            else if (L.space) { room[k] = roomFor(s, c, d, ray[k], L.space); v += room[k] * 0.5; }
            // a good bot likes a wall alongside the way it takes
            if (L.grind && k > 0 && ray[k] > 10) v += L.grind * 8 * (sideDist(s, { x: c.x, z: c.z, dir: d }, TZ.GRIND_RANGE) < 2.5 ? 1 : 0);
            v += (bot.r() - 0.5) * 4;
            if (v > score) { score = v; pick = k; }
        }
        if (pick < 0) {
            // boxed in: the longest way, and hope
            pick = ray[1] >= ray[2] ? 1 : 2;
            if (ray[0] > ray[pick]) pick = 0;
        }
        if (pick) turn(s, i, opts[pick]);
    }
    // where everybody else's head is about to be
    function heads(s, c) {
        const out = [];
        for (const o of s.cycles) if (o.alive && o !== c) out.push(headCell(s, o.x, o.z, o.dir, 3));
        return out;
    }
    // somebody alongside, going the same way, a little behind: turn across their nose
    function cutIn(s, c, ray, ok) {
        const ax = c.dir & 1, sg = c.dir < 2 ? 1 : -1;
        for (const o of s.cycles) {
            if (!o.alive || o === c || o.dir !== c.dir) continue;
            const lead = sg * ((ax ? c.z : c.x) - (ax ? o.z : o.x));
            const side = (ax ? o.x : o.z) - (ax ? c.x : c.z);
            if (lead < 2 || lead > 14 || abs(side) < 1.5 || abs(side) > 16 || c.speed + 0.5 < o.speed) continue;
            // which of my turns heads towards their side
            const right = (c.dir + 1) & 3, k = ax ? DX[right] : DZ[right];
            const toward = Math.sign(side) === Math.sign(k) ? 2 : 1;
            if (!ok[toward] || ray[toward] < abs(side) + 4) continue;
            turn(s, c.i, toward === 2 ? 1 : -1);
            return true;
        }
        return false;
    }

    // ---------------------------------------------------------------
    // the wire
    //
    // A snapshot is the host's state in whole numbers: each cycle's place to a
    // hundredth, its way, speed, fuel and grind, and its turn points, the last
    // few of them only. A guest that finds a gap in somebody's turns asks for
    // the lot (full: true). The seats go when they change.
    // ---------------------------------------------------------------
    const R100 = v => round(v * 100);
    function snapshot(s, o) {
        o = o || {};
        const c = [];
        for (const y of s.cycles) {
            c.push(R100(y.x), R100(y.z), y.dir, R100(y.speed), (y.alive ? 1 : 0) | (y.braking ? 2 : 0) | (y.gone ? 4 : 0),
                turnsOf(y), round(y.fade * 100), round(y.fuel * 100), round(y.grind * 100));
        }
        const d = { k: s.tick, r: s.round, ph: PHASES.indexOf(s.phase), pt: s.phaseT, rt: s.raceT, c, sc: s.scores.slice(), wn: s.wins.slice(), lw: s.lastWinner };
        // turn points: all of them when asked, else the last few of anybody who turned lately
        const w = [];
        const tail = o.tail || 4;
        for (const y of s.cycles) {
            const n = turnsOf(y);
            if (!o.full && (n === 0 || (y.lastTurnSent === n && s.tick - (y.turnSentAt || 0) > (o.keep || 150)))) continue;
            if (!o.full && y.lastTurnSent !== n) { y.lastTurnSent = n; y.turnSentAt = s.tick; }
            const from = o.full ? 1 : max(1, n - tail + 1);
            const row = [y.i, from];
            for (let k = from; k <= n; k++) row.push(R100(y.pts[k * 2]), R100(y.pts[k * 2 + 1]));
            w.push(row);
        }
        if (w.length) d.w = w;
        return d;
    }
    function seatList(s) { return s.seats.map(p => [p.id, p.name, p.bot || 0, p.on ? 1 : 0]); }
    function applySeats(s, list) {
        if (!Array.isArray(list)) return;
        list.slice(0, TZ.MAX_SEATS).forEach((p, i) => {
            if (!Array.isArray(p) || !s.seats[i]) return;
            const q = s.seats[i];
            q.id = String(p[0]); q.name = String(p[1]).slice(0, 16); q.bot = p[2] || null; q.on = !!p[3]; q.human = !q.bot;
        });
    }
    // A guest's copy of the state, brought up to the host's. It returns true
    // when some cycle's turns have a hole in them, which wants a full one.
    function applySnapshot(s, d) {
        if (!d || !Array.isArray(d.c)) return false;
        if (typeof d.r === 'number' && d.r !== s.round) {
            s.round = d.r - 1;
            newRound(s);
        }
        s.tick = d.k; s.phase = PHASES[d.ph] || 'race'; s.phaseT = d.pt | 0; s.raceT = d.rt | 0;
        if (Array.isArray(d.sc)) s.scores = d.sc.slice(0, s.n).map(v => +v || 0);
        if (Array.isArray(d.wn)) s.wins = d.wn.slice(0, s.n).map(v => +v || 0);
        s.lastWinner = typeof d.lw === 'number' ? d.lw : -1;
        let hole = false;
        if (Array.isArray(d.w)) for (const row of d.w) {
            const y = s.cycles[row[0]];
            if (!y || !Array.isArray(row)) continue;
            const from = row[1] | 0, have = turnsOf(y);
            if (from < 1 || from > have + 1) { hole = true; continue; }
            y.pts.length = from * 2;
            for (let k = 2; k + 1 < row.length; k += 2) y.pts.push(row[k] / 100, row[k + 1] / 100);
        }
        let alive = 0;
        for (let i = 0; i < s.cycles.length; i++) {
            const y = s.cycles[i], b = i * 9;
            if (b + 8 >= d.c.length) break;
            const was = y.alive;
            y.x = d.c[b] / 100; y.z = d.c[b + 1] / 100; y.dir = d.c[b + 2] & 3; y.speed = d.c[b + 3] / 100;
            const fl = d.c[b + 4];
            y.alive = !!(fl & 1); y.braking = !!(fl & 2); y.gone = !!(fl & 4);
            const n = d.c[b + 5] | 0;
            if (n > turnsOf(y)) hole = true;
            else if (n < turnsOf(y)) y.pts.length = (n + 1) * 2;
            y.fade = d.c[b + 6] / 100; y.fuel = d.c[b + 7] / 100; y.grind = d.c[b + 8] / 100;
            if (was && !y.alive) { y.deadAt = s.tick; emit(s, { e: 'die', i, x: y.x, z: y.z }); }
            if (y.alive) alive++;
        }
        s.alive = alive;
        rebuildGrid(s);
        return hole;
    }

    // everything that matters, as one string, for the determinism check
    function hash(s) {
        let h = s.round + ':' + s.phase + ':' + s.tick + ':' + s.scores.join(',') + '|';
        for (const c of s.cycles) h += c.x.toFixed(4) + ',' + c.z.toFixed(4) + ',' + c.dir + ',' + c.alive + ',' + c.pts.length + ';';
        let x = 2166136261;
        for (let k = 0; k < h.length; k++) { x ^= h.charCodeAt(k); x = Math.imul(x, 16777619); }
        return (x >>> 0).toString(16);
    }

    root.TZ_SIM = {
        DX, DZ, PHASES, rng, spawns, newMatch, newRound, step, turn, turnAt, brake, turnsOf,
        meet, rayHit, rayDist, sideDist, forEachWall, baseSpeed, seatOn, humansLeft, newBot, think, flood,
        rebuildGrid, snapshot, applySnapshot, seatList, applySeats, hash
    };
})(typeof window !== 'undefined' ? window : globalThis);
