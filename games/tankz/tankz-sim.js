// ===================================================================
// tankz 98 — the rules: the maze, the tanks, what flies, the bots, the wire
//
// No DOM and no clocks: everything steps at TK.TICK a second, so the same
// numbers come out in node (check-tankz.mjs), on the host and in a test.
//
// Coordinates: x right, y down, a tank's angle a = 0 faces right and grows
// clockwise on the screen. A maze is cols x rows cells of TK.CELL units, its
// walls TK.WALL thick and centred on the grid lines. Walls are boxes; a tank
// is a circle against them and a box against what flies; a shell is a dot of
// radius r and comes off a wall the way light comes off a mirror.
// ===================================================================
(function (root) {
    'use strict';

    const TK = root.TK;
    const { min, max, floor, round, abs, sin, cos, atan2, PI, hypot, sqrt, ceil } = Math;
    const DT = 1 / TK.TICK, C = TK.CELL, HW = TK.WALL / 2;
    const HL = TK.BODY_L / 2, HB = TK.BODY_W / 2;
    const PHASES = ['ready', 'fight', 'after', 'end', 'over'];
    const KINDS = ['s', 'f', 'm', 'b'];          // shell, frag shell, seeker, bit
    const W_IDS = TK.WEAPONS.map(w => w.id);
    const END_T = 1.6;                             // seconds the round's result stays up
    const GRACE = 0.12;                            // a fresh shell can't hit the tank that fired it, unless it bounced

    // ---------------------------------------------------------------
    // a small seeded random, its whole state one number
    // ---------------------------------------------------------------
    function rnd(o) {
        o.rs = (o.rs + 0x6D2B79F5) >>> 0;
        let t = o.rs;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const mix = (a, b) => (Math.imul((a >>> 0) ^ 0x9E3779B9, 2654435761) + Math.imul(b + 1, 40503)) >>> 0;
    const wrap = a => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

    // ===============================================================
    // the maze
    // ===============================================================
    function dims(n, size, seed) {
        const r = { rs: mix(seed, 7) };
        const add = (TK.SIZE_BY_ID[size] || TK.SIZES[0]).add;
        const base = n <= 2 ? [7, 5] : n <= 3 ? [8, 5] : n <= 4 ? [8, 6] : n <= 6 ? [10, 7] : [11, 8];
        const cols = clamp(base[0] + add + floor(rnd(r) * 3) - 1, 4, 16);
        const rows = clamp(base[1] + add + (rnd(r) < 0.5 ? 0 : 1) - (add < 0 ? 0 : rnd(r) < 0.3 ? 1 : 0), 3, 11);
        return [cols, rows];
    }
    // h[r][c]: the wall along the top of cell (c, r), r = 0..rows
    // v[r][c]: the wall along the left of cell (c, r), c = 0..cols
    function makeMaze(seed, n, size) {
        const [cols, rows] = dims(n, size, seed);
        const r = { rs: mix(seed, 11) };
        const h = [], v = [];
        for (let y = 0; y <= rows; y++) h.push(new Array(cols).fill(true));
        for (let y = 0; y < rows; y++) v.push(new Array(cols + 1).fill(true));
        // a spanning tree, walked depth first
        const seen = new Uint8Array(cols * rows);
        const stack = [floor(rnd(r) * cols * rows)];
        seen[stack[0]] = 1;
        while (stack.length) {
            const k = stack[stack.length - 1], x = k % cols, y = (k / cols) | 0;
            const opts = [];
            if (x > 0 && !seen[k - 1]) opts.push(0);
            if (x < cols - 1 && !seen[k + 1]) opts.push(1);
            if (y > 0 && !seen[k - cols]) opts.push(2);
            if (y < rows - 1 && !seen[k + cols]) opts.push(3);
            if (!opts.length) { stack.pop(); continue; }
            const d = opts[floor(rnd(r) * opts.length)];
            let nk;
            if (d === 0) { v[y][x] = false; nk = k - 1; }
            else if (d === 1) { v[y][x + 1] = false; nk = k + 1; }
            else if (d === 2) { h[y][x] = false; nk = k - cols; }
            else { h[y + 1][x] = false; nk = k + cols; }
            seen[nk] = 1; stack.push(nk);
        }
        // and then some loops, so nobody is ever in a dead end for long
        for (let y = 1; y < rows; y++) for (let x = 0; x < cols; x++) if (h[y][x] && rnd(r) < TK.LOOPS) h[y][x] = false;
        for (let y = 0; y < rows; y++) for (let x = 1; x < cols; x++) if (v[y][x] && rnd(r) < TK.LOOPS) v[y][x] = false;
        return buildMaze(cols, rows, h, v, seed);
    }
    function buildMaze(cols, rows, h, v, seed) {
        const m = { seed, cols, rows, h, v, W: cols * C, H: rows * C, rects: [], nb: [] };
        // the walls as boxes: one per straight run, the ends squared off
        for (let y = 0; y <= rows; y++) {
            let x = 0;
            while (x < cols) {
                if (!h[y][x]) { x++; continue; }
                const x0 = x;
                while (x < cols && h[y][x]) x++;
                m.rects.push({ x0: x0 * C - HW, x1: x * C + HW, y0: y * C - HW, y1: y * C + HW, o: 0 });
            }
        }
        for (let x = 0; x <= cols; x++) {
            let y = 0;
            while (y < rows) {
                if (!v[y][x]) { y++; continue; }
                const y0 = y;
                while (y < rows && v[y][x]) y++;
                m.rects.push({ x0: x * C - HW, x1: x * C + HW, y0: y0 * C - HW, y1: y * C + HW, o: 1 });
            }
        }
        // which cell reaches which
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
            const out = [];
            if (x > 0 && !v[y][x]) out.push(y * cols + x - 1);
            if (x < cols - 1 && !v[y][x + 1]) out.push(y * cols + x + 1);
            if (y > 0 && !h[y][x]) out.push((y - 1) * cols + x);
            if (y < rows - 1 && !h[y + 1][x]) out.push((y + 1) * cols + x);
            m.nb.push(out);
        }
        return m;
    }
    const cellOf = (m, x, y) => clamp(floor(y / C), 0, m.rows - 1) * m.cols + clamp(floor(x / C), 0, m.cols - 1);
    const centre = (m, k) => [(k % m.cols + 0.5) * C, (((k / m.cols) | 0) + 0.5) * C];
    // steps from one cell to every other
    function bfs(m, from) {
        const d = new Int16Array(m.cols * m.rows).fill(-1);
        const q = [from]; d[from] = 0;
        for (let h = 0; h < q.length; h++) {
            const k = q[h];
            for (const n of m.nb[k]) if (d[n] < 0) { d[n] = d[k] + 1; q.push(n); }
        }
        return d;
    }

    // ===============================================================
    // geometry
    // ===============================================================
    // a ray against a box: the distance in, and which axis it crossed (0: x, 1: y)
    function slab(ox, oy, dx, dy, x0, y0, x1, y1) {
        let tmin = -Infinity, tmax = Infinity, ax = -1;
        if (abs(dx) < 1e-12) { if (ox <= x0 || ox >= x1) return null; }
        else {
            let a = (x0 - ox) / dx, b = (x1 - ox) / dx;
            if (a > b) { const t = a; a = b; b = t; }
            if (a > tmin) { tmin = a; ax = 0; }
            if (b < tmax) tmax = b;
        }
        if (abs(dy) < 1e-12) { if (oy <= y0 || oy >= y1) return null; }
        else {
            let a = (y0 - oy) / dy, b = (y1 - oy) / dy;
            if (a > b) { const t = a; a = b; b = t; }
            if (a > tmin) { tmin = a; ax = 1; }
            if (b < tmax) tmax = b;
        }
        if (tmax < tmin || tmax <= 0 || tmin < 0) return null;
        return [tmin, ax];
    }
    function hitsTank(t, x, y, r) {
        const dx = x - t.x, dy = y - t.y, c = cos(t.a), s = sin(t.a);
        const lx = dx * c + dy * s, ly = -dx * s + dy * c;
        return abs(lx) <= HL + r && abs(ly) <= HB + r;
    }
    function rayTank(t, ox, oy, dx, dy, r) {
        const c = cos(t.a), s = sin(t.a);
        const px = ox - t.x, py = oy - t.y;
        const lx = px * c + py * s, ly = -px * s + py * c;
        const ldx = dx * c + dy * s, ldy = -dx * s + dy * c;
        const h = slab(lx, ly, ldx, ldy, -HL - r, -HB - r, HL + r, HB + r);
        return h ? h[0] : Infinity;
    }
    // a line through the maze that comes off walls: where a beam goes, or a shell
    // would go if nothing moved. `skip` is a tank it passes through until it first bounces
    function cast(s, x, y, a, len, bounces, r, skip) {
        const m = s.maze;
        let dx = cos(a), dy = sin(a), left = len;
        const pts = [x, y];
        for (let b = 0; b <= bounces; b++) {
            let tw = Infinity, ax = 0;
            for (const q of m.rects) {
                const h = slab(x, y, dx, dy, q.x0 - r, q.y0 - r, q.x1 + r, q.y1 + r);
                if (h && h[0] < tw) { tw = h[0]; ax = h[1]; }
            }
            let tt = Infinity, who = -1;
            for (const t of s.tanks) {
                if (!t.alive || (b === 0 && t.i === skip)) continue;
                const d = rayTank(t, x, y, dx, dy, r);
                if (d < tt) { tt = d; who = t.i; }
            }
            if (who >= 0 && tt <= tw && tt <= left) { pts.push(x + dx * tt, y + dy * tt); return { pts, hit: who, len: len - left + tt, bounces: b }; }
            if (tw >= left) { pts.push(x + dx * left, y + dy * left); return { pts, hit: -1, len, bounces: b }; }
            x += dx * tw; y += dy * tw; left -= tw;
            pts.push(x, y);
            if (ax === 0) dx = -dx; else dy = -dy;
            x += dx * 0.01; y += dy * 0.01;
        }
        return { pts, hit: -1, len: len - left, bounces };
    }
    // a circle out of the walls and inside the maze
    function pushOut(m, o, R) {
        for (let it = 0; it < 3; it++) {
            let moved = false;
            for (const q of m.rects) {
                if (o.x < q.x0 - R || o.x > q.x1 + R || o.y < q.y0 - R || o.y > q.y1 + R) continue;
                const cx = clamp(o.x, q.x0, q.x1), cy = clamp(o.y, q.y0, q.y1);
                const dx = o.x - cx, dy = o.y - cy, d2 = dx * dx + dy * dy;
                if (d2 >= R * R) continue;
                if (d2 > 1e-9) { const d = sqrt(d2), k = (R - d) / d; o.x += dx * k; o.y += dy * k; }
                else {
                    // the centre is inside the wall: out the nearest side
                    const l = o.x - q.x0, rr = q.x1 - o.x, u = o.y - q.y0, dd = q.y1 - o.y, mn = min(l, rr, u, dd);
                    if (mn === l) o.x = q.x0 - R; else if (mn === rr) o.x = q.x1 + R; else if (mn === u) o.y = q.y0 - R; else o.y = q.y1 + R;
                }
                moved = true;
            }
            if (!moved) break;
        }
        o.x = clamp(o.x, HW + R, m.W - HW - R);
        o.y = clamp(o.y, HW + R, m.H - HW - R);
    }
    // mv: 1 forward, 2 back, 4 turn left, 8 turn right
    function moveTank(m, t, mv, dt) {
        const turn = (mv & 8 ? 1 : 0) - (mv & 4 ? 1 : 0);
        t.a = wrap(t.a + turn * TK.TURN * dt);
        const sp = mv & 1 ? TK.SPEED : mv & 2 ? -TK.BACK : 0;
        t.x += cos(t.a) * sp * dt; t.y += sin(t.a) * sp * dt;
        t.moving = sp !== 0 || turn !== 0;
        pushOut(m, t, TK.TANK_R);
    }
    // a shell along its line for dt, off any wall it meets. 'wall' if it met one
    function moveShell(m, b, dt) {
        const sp = hypot(b.vx, b.vy), dist = sp * dt;
        const n = max(1, ceil(dist / 2)), h = dt / n, r = b.r;
        let hit = false;
        for (let k = 0; k < n; k++) {
            const px = b.x, py = b.y;
            b.x += b.vx * h; b.y += b.vy * h;
            for (const q of m.rects) {
                if (b.x <= q.x0 - r || b.x >= q.x1 + r || b.y <= q.y0 - r || b.y >= q.y1 + r) continue;
                const inX = px > q.x0 - r && px < q.x1 + r, inY = py > q.y0 - r && py < q.y1 + r;
                if (!inX) b.vx = -b.vx;
                if (!inY) b.vy = -b.vy;
                if (inX && inY) { b.vx = -b.vx; b.vy = -b.vy; }
                b.x = px; b.y = py; hit = true;
                break;
            }
            if (hit && b.k === 'b') return true;
        }
        return hit;
    }

    // ===============================================================
    // a match
    // ===============================================================
    function newMatch(o) {
        const seats = (o.seats || []).map((p, i) => ({ id: String(p.id || 'seat' + i), name: String(p.name || 'tank').slice(0, 16), bot: p.bot || '', on: !p.bot, local: p.local === undefined ? -1 : p.local }));
        const n = seats.length;
        const s = {
            seed: o.seed >>> 0, rs: mix(o.seed >>> 0, 3), n, seats, size: TK.SIZE_BY_ID[o.size] ? o.size : 'medium',
            points: TK.POINTS.includes(+o.points) ? +o.points : TK.POINTS[0],
            round: 0, phase: 'ready', phaseT: 0, roundT: 0, tick: 0, maze: null,
            tanks: [], shells: [], picks: [], mines: [], beams: [], nextId: 1,
            scores: new Array(n).fill(0), kills: new Array(n).fill(0), deaths: new Array(n).fill(0), selfs: new Array(n).fill(0),
            lastWinner: -1, winner: -1, dropT: 0, events: [], log: [], evN: 0, quiet: false, puppet: !!o.puppet
        };
        for (let i = 0; i < n; i++) s.tanks.push({ i, x: 0, y: 0, a: 0, alive: true, w: '', cool: 0, in: { mv: 0, fp: 0 }, fpSeen: 0, burst: 0, burstT: 0, frag: 0, remote: false, moving: false, held: 0 });
        newRound(s);
        return s;
    }
    function ev(s, e) {
        e.n = ++s.evN; e.k = s.tick;
        s.events.push(e);
        s.log.push(e);
        while (s.log.length && s.log[0].k < s.tick - 100) s.log.shift();
    }
    const mazeSeed = s => mix(s.seed, s.round * 977 + 5);
    function newRound(s) {
        s.round++;
        s.maze = makeMaze(mazeSeed(s), s.n, s.size);
        s.shells.length = 0; s.picks.length = 0; s.mines.length = 0; s.beams.length = 0;
        s.phase = 'ready'; s.phaseT = 0; s.roundT = 0; s.lastWinner = -1;
        s.dropT = round(TK.DROP_FIRST * TK.TICK);
        // places as far from each other as the maze allows
        const m = s.maze, cells = m.cols * m.rows, taken = [];
        let far = null;
        for (let i = 0; i < s.n; i++) {
            let k;
            if (!taken.length) k = floor(rnd(s) * cells);
            else {
                const best = [];
                for (let c = 0; c < cells; c++) {
                    if (taken.includes(c)) continue;
                    best.push([far[c], c]);
                }
                best.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
                const top = best.slice(0, max(1, min(3, best.length >> 2)));
                k = top[floor(rnd(s) * top.length)][1];
            }
            taken.push(k);
            const d = bfs(m, k);
            far = far ? far.map((v, c) => min(v, d[c] < 0 ? 99 : d[c])) : Array.from(d, v => (v < 0 ? 99 : v));
            const [x, y] = centre(m, k);
            const ways = m.nb[k];
            const to = ways.length ? ways[floor(rnd(s) * ways.length)] : k;
            const [tx, ty] = centre(m, to);
            const t = s.tanks[i];
            Object.assign(t, { x, y, a: to === k ? floor(rnd(s) * 4) * PI / 2 : atan2(ty - y, tx - x), alive: true, w: '', cool: 0, burst: 0, burstT: 0, frag: 0, moving: false, held: 0 });
            t.in.mv = 0;
        }
        ev(s, { e: 'round', r: s.round });
    }
    function setPhase(s, p) { s.phase = p; s.phaseT = 0; }
    const alive = s => s.tanks.filter(t => t.alive);
    const people = s => s.seats.some((p, i) => !p.bot && s.tanks[i].alive);
    function input(s, i, mv, fp) {
        const t = s.tanks[i];
        if (!t) return;
        t.in.mv = mv & 15;
        if (Number.isSafeInteger(fp) && fp > t.in.fp) t.in.fp = fp;
    }
    // a guest's own word on where its tank is, kept to what it could have driven
    function pose(s, i, x, y, a, dtSince) {
        const t = s.tanks[i];
        if (!t || !t.alive || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(a)) return false;
        const reach = TK.SPEED * min(0.6, max(0.05, dtSince)) * 1.35 + 10;
        let dx = x - t.x, dy = y - t.y;
        const d = hypot(dx, dy);
        if (d > reach) { dx *= reach / d; dy *= reach / d; }
        t.x += dx; t.y += dy; t.a = wrap(a);
        t.moving = d > 0.5;
        pushOut(s.maze, t, TK.TANK_R);
        return d <= reach;
    }

    function step(s) {
        s.tick++; s.phaseT++;
        const ph = s.phase;
        if (ph === 'over') return;
        if (ph === 'ready' || ph === 'end') {
            // a trigger pulled while frozen is not saved up for later
            for (const t of s.tanks) t.fpSeen = t.in.fp;
            if (ph === 'ready' && s.phaseT >= TK.READY * TK.TICK) setPhase(s, 'fight');
            if (ph === 'end' && s.phaseT >= END_T * TK.TICK) newRound(s);
            return;
        }
        s.roundT++;
        const m = s.maze;
        for (const t of s.tanks) {
            if (!t.alive) { t.fpSeen = t.in.fp; continue; }
            if (!t.remote) moveTank(m, t, t.in.mv, DT);
            if (t.cool > 0) t.cool -= DT;
            let presses = 0;
            while (t.fpSeen < t.in.fp) { t.fpSeen++; if (presses++ < 3) press(s, t.i); }
            if (t.w) t.held += DT;
            if (t.burst > 0) {
                t.burstT -= DT;
                while (t.burst > 0 && t.burstT <= 0) {
                    const w = TK.WEAPON_BY_ID.burst;
                    spread(s, t, 'b2', w.speed, w.life, w.r, (rnd(s) - 0.5) * 2 * w.spread);
                    t.burst--; t.burstT += w.every;
                }
            }
            // a file on the floor, if the hands are free
            if (!t.w && !t.burst && !t.frag) {
                for (let k = 0; k < s.picks.length; k++) {
                    const p = s.picks[k];
                    if (hypot(p.x - t.x, p.y - t.y) < TK.PICK_R + TK.TANK_R * 0.6) {
                        t.w = W_IDS[p.w]; t.held = 0;
                        s.picks.splice(k, 1);
                        ev(s, { e: 'pick', i: t.i, w: p.w });
                        break;
                    }
                }
            }
        }
        shells(s);
        mines(s);
        for (const b of s.beams) b.age += DT;
        s.beams = s.beams.filter(b => b.age < 0.6);
        // files dropping
        if (--s.dropT <= 0) {
            const cap = TK.DROP_MAX + (s.n >= 5 ? 1 : 0);
            if (s.picks.length < cap) drop(s);
            s.dropT = round((TK.DROP_EVERY[0] + rnd(s) * (TK.DROP_EVERY[1] - TK.DROP_EVERY[0])) * TK.TICK);
        }
        // the end of a round
        const left = alive(s);
        if (s.phase === 'fight' && left.length <= 1) setPhase(s, 'after');
        if (s.phase === 'after' && s.phaseT >= TK.AFTER * TK.TICK) award(s, left.length === 1 ? left[0].i : -1);
        else if (s.roundT >= TK.DRAW_AT * TK.TICK) award(s, -1);
    }
    function award(s, w) {
        s.lastWinner = w;
        if (w >= 0) s.scores[w]++;
        ev(s, { e: 'end', w });
        const top = max(...s.scores);
        if (w >= 0 && top >= s.points) {
            s.winner = w;
            setPhase(s, 'over');
            ev(s, { e: 'over', w });
        } else setPhase(s, 'end');
    }
    function drop(s) {
        const m = s.maze, cells = m.cols * m.rows;
        for (let tries = 0; tries < 12; tries++) {
            const k = floor(rnd(s) * cells);
            const [x, y] = centre(m, k);
            if (s.tanks.some(t => t.alive && hypot(t.x - x, t.y - y) < C * 1.2)) continue;
            if (s.picks.some(p => hypot(p.x - x, p.y - y) < 4)) continue;
            const w = floor(rnd(s) * W_IDS.length);
            s.picks.push({ id: s.nextId++, x, y, w });
            ev(s, { e: 'drop', w });
            return;
        }
    }
    const ownShells = (s, i) => s.shells.reduce((n, b) => n + (b.o === i && b.k === 's' ? 1 : 0), 0);
    // something leaves the barrel: from the middle of the tank to the muzzle, off a wall on the way if the muzzle is in one
    function launch(s, t, k, a, speed, life, r) {
        const b = { id: s.nextId++, k, o: t.i, x: t.x, y: t.y, vx: cos(a) * speed, vy: sin(a) * speed, r, age: 0, life, bounced: false, tgt: -1 };
        if (moveShell(s.maze, b, TK.BARREL / speed)) b.bounced = true;
        if (k === 'b' && b.bounced) return null;
        s.shells.push(b);
        return b;
    }
    function spread(s, t, kind, speed, life, r, da) { launch(s, t, 'b', t.a + da, speed, life, r); }
    function press(s, i) {
        const t = s.tanks[i];
        if (!t.alive) return;
        // a frag shell in the air bursts on the second press
        if (t.frag) {
            const f = s.shells.find(b => b.id === t.frag);
            if (f) burstFrag(s, f);
            t.frag = 0; t.w = '';
            return;
        }
        if (t.cool > 0 || t.burst) return;
        const w = t.w;
        t.cool = TK.FIRE_GAP;
        if (!w) {
            if (ownShells(s, i) >= TK.SHELLS) return;
            launch(s, t, 's', t.a, TK.SHELL_SPEED, TK.SHELL_LIFE, TK.SHELL_R);
            ev(s, { e: 'shot', i });
            return;
        }
        const d = TK.WEAPON_BY_ID[w];
        t.w = '';
        if (w === 'beam') {
            const c = cast(s, t.x, t.y, t.a, d.range, d.bounces, 0, i);
            s.beams.push({ id: s.nextId++, o: i, pts: c.pts.map(v => round(v * 10) / 10), age: 0 });
            ev(s, { e: 'beam', i, pts: s.beams[s.beams.length - 1].pts });
            if (c.hit >= 0) kill(s, c.hit, i, 'beam');
        } else if (w === 'frag') {
            const b = launch(s, t, 'f', t.a, d.speed, d.life, d.r);
            t.w = 'frag'; t.frag = b ? b.id : 0;
            if (!b) t.w = '';
            ev(s, { e: 'shot', i, w: 'frag' });
        } else if (w === 'seeker') {
            launch(s, t, 'm', t.a, d.speed, d.life, d.r);
            ev(s, { e: 'shot', i, w: 'seeker' });
        } else if (w === 'mine') {
            const x = t.x - cos(t.a) * (TK.TANK_R + 6), y = t.y - sin(t.a) * (TK.TANK_R + 6);
            const p = { x, y };
            pushOut(s.maze, p, 4);
            s.mines.push({ id: s.nextId++, o: i, x: p.x, y: p.y, age: 0 });
            ev(s, { e: 'mine', i });
        } else if (w === 'burst') {
            t.burst = d.count; t.burstT = 0;
            ev(s, { e: 'shot', i, w: 'burst' });
        } else if (w === 'scatter') {
            for (let k = 0; k < d.count; k++) spread(s, t, 'b', d.speed * (0.9 + rnd(s) * 0.2), d.life, d.r, -d.cone + (2 * d.cone * k) / (d.count - 1));
            ev(s, { e: 'shot', i, w: 'scatter' });
        }
    }
    function bits(s, x, y, o, count) {
        const d = TK.WEAPON_BY_ID.frag;
        for (let k = 0; k < count; k++) {
            const a = (k / count) * 2 * PI + rnd(s) * 0.3;
            const sp = d.bitSpeed * (0.75 + rnd(s) * 0.5);
            s.shells.push({ id: s.nextId++, k: 'b', o, x, y, vx: cos(a) * sp, vy: sin(a) * sp, r: 2, age: 0, life: d.bitLife * (0.8 + rnd(s) * 0.4), bounced: true, tgt: -1 });
        }
        ev(s, { e: 'boom', x: round(x), y: round(y) });
    }
    function burstFrag(s, f) {
        f.life = 0;
        bits(s, f.x, f.y, f.o, TK.WEAPON_BY_ID.frag.bits);
    }
    function kill(s, i, by, how) {
        const t = s.tanks[i];
        if (!t.alive) return;
        t.alive = false; t.burst = 0;
        s.deaths[i]++;
        if (by === i) s.selfs[i]++;
        else if (by >= 0) s.kills[by]++;
        ev(s, { e: 'die', i, by, how, x: round(t.x), y: round(t.y) });
    }
    // where a seeker goes: the nearest tank by the maze's own paths, whoever's
    function seek(s, b) {
        const m = s.maze, here = cellOf(m, b.x, b.y), d = bfs(m, here);
        let best = -1, bd = Infinity;
        for (const t of s.tanks) {
            if (!t.alive) continue;
            const k = d[cellOf(m, t.x, t.y)];
            const v = (k < 0 ? 999 : k) * C + hypot(t.x - b.x, t.y - b.y) * 0.01;
            if (v < bd) { bd = v; best = t.i; }
        }
        b.tgt = best;
        if (best < 0) return null;
        const t = s.tanks[best], tc = cellOf(m, t.x, t.y);
        if (tc === here) return [t.x, t.y];
        const back = bfs(m, tc);
        let next = -1, nd = back[here];
        for (const n of m.nb[here]) if (back[n] >= 0 && back[n] < nd) { nd = back[n]; next = n; }
        return next < 0 ? [t.x, t.y] : centre(m, next);
    }
    function steer(s, b, dt) {
        const d = TK.WEAPON_BY_ID.seeker;
        if (b.age < d.wait) return;
        if (!b.goal || (s.tick + b.id) % 6 === 0) b.goal = seek(s, b);
        if (!b.goal) return;
        const want = atan2(b.goal[1] - b.y, b.goal[0] - b.x), now = atan2(b.vy, b.vx);
        const turn = clamp(wrap(want - now), -d.steer * dt, d.steer * dt);
        const a = now + turn, sp = hypot(b.vx, b.vy);
        b.vx = cos(a) * sp; b.vy = sin(a) * sp;
    }
    function shells(s) {
        const m = s.maze, out = [];
        for (const b of s.shells) {
            if (b.life <= 0) continue;
            if (b.k === 'm') steer(s, b, DT);
            const wall = moveShell(m, b, DT);
            if (wall) { b.bounced = true; if (b.k === 'b') continue; }
            b.age += DT;
            if (b.age >= b.life) {
                if (b.k === 'f') { burstFrag(s, b); const t = s.tanks[b.o]; if (t.frag === b.id) { t.frag = 0; t.w = ''; } }
                continue;
            }
            let gone = false;
            for (const t of s.tanks) {
                if (!t.alive) continue;
                if (t.i === b.o && !b.bounced && b.age < GRACE) continue;
                if (b.k === 'm' && t.i === b.o && b.age < TK.WEAPON_BY_ID.seeker.wait * 0.5) continue;
                if (!hitsTank(t, b.x, b.y, b.r)) continue;
                kill(s, t.i, b.o, b.k === 's' ? 'shell' : b.k === 'b' ? 'bits' : b.k === 'f' ? 'frag' : 'seeker');
                if (b.k === 'f') { burstFrag(s, b); const o = s.tanks[b.o]; if (o.frag === b.id) { o.frag = 0; o.w = ''; } }
                gone = true;
                break;
            }
            if (!gone && b.life > 0) out.push(b);
        }
        s.shells = out;
    }
    function mines(s) {
        const d = TK.WEAPON_BY_ID.mine;
        const out = [];
        for (const q of s.mines) {
            q.age += DT;
            let boom = -1;
            if (q.age >= d.arm) for (const t of s.tanks) if (t.alive && hypot(t.x - q.x, t.y - q.y) < d.r + TK.TANK_R * 0.8) { boom = t.i; break; }
            if (boom < 0) { out.push(q); continue; }
            kill(s, boom, q.o, 'mine');
            bits(s, q.x, q.y, q.o, d.bits);
        }
        s.mines = out;
    }
    // a guest between two snapshots: everything flying keeps flying, nothing is decided
    function coast(s, dt) {
        if (s.phase !== 'fight' && s.phase !== 'after') return;
        const m = s.maze;
        for (const b of s.shells) {
            if (b.life <= 0 || b.age >= b.life) continue;
            if (b.k === 'm') steer(s, b, dt);
            if (moveShell(m, b, dt)) { b.bounced = true; if (b.k === 'b') { b.life = 0; continue; } }
            b.age += dt;
        }
        for (const b of s.beams) b.age += dt;
    }

    // ===============================================================
    // the bots
    // ===============================================================
    function newBot(level, seed) {
        const lv = TK.BOTS[level] || TK.BOTS.normal;
        return { level: TK.BOTS[level] ? level : 'normal', lv, rs: seed >>> 0 || 1, aim: null, wait: 0, fp: 0, danger: null, stuck: 0, last: null, unstick: 0, flee: 0, shotGap: 0, noise: 0 };
    }
    const muzzle = t => [t.x + cos(t.a) * TK.BARREL, t.y + sin(t.a) * TK.BARREL];
    // the angle that gets a shot to a tank that is not me, if there is one
    function findShot(s, i, bot, w) {
        const t = s.tanks[i], lv = bot.lv;
        const enemies = s.tanks.filter(e => e.alive && e.i !== i);
        if (!enemies.length) return null;
        const beam = w === 'beam';
        const range = beam ? TK.WEAPON_BY_ID.beam.range : w === 'scatter' ? 300 : w === 'burst' ? 480 : lv.range;
        const bounces = beam ? min(TK.WEAPON_BY_ID.beam.bounces, lv.bounces + 2) : lv.bounces;
        const r = beam ? 0 : TK.SHELL_R;
        const tries = [];
        for (const e of enemies) tries.push(atan2(e.y - t.y, e.x - t.x));
        for (let k = 0; k < lv.fans; k++) tries.push(t.a + ((k + rnd(bot) * 0.5) / lv.fans) * 2 * PI);
        let best = null;
        for (const a of tries) {
            const c = cast(s, t.x, t.y, a, range, bounces, r, i);
            if (c.hit < 0 || c.hit === i) continue;
            const cost = abs(wrap(a - t.a)) + c.bounces * 0.15 + c.len / 2000;
            if (!best || cost < best.cost) best = { a, cost, hit: c.hit };
        }
        return best;
    }
    // what is coming at me: the nearest shell whose path runs through where I am
    function threat(s, i) {
        const t = s.tanks[i];
        let worst = null;
        for (const b of s.shells) {
            if (b.o === i && !b.bounced && b.age < 0.4) continue;
            const dx = t.x - b.x, dy = t.y - b.y;
            if (dx * dx + dy * dy > 300 * 300) continue;
            const sp = hypot(b.vx, b.vy) || 1;
            const look = min(sp * 0.9, (b.life - b.age) * sp);
            const c = cast(s, b.x, b.y, atan2(b.vy, b.vx), look, 1, b.r, -2);
            // walk the path in steps and see how close it comes
            let acc = 0;
            for (let k = 2; k < c.pts.length; k += 2) {
                const x0 = c.pts[k - 2], y0 = c.pts[k - 1], x1 = c.pts[k], y1 = c.pts[k + 1];
                const L = hypot(x1 - x0, y1 - y0) || 1;
                const u = clamp(((t.x - x0) * (x1 - x0) + (t.y - y0) * (y1 - y0)) / (L * L), 0, 1);
                const px = x0 + (x1 - x0) * u, py = y0 + (y1 - y0) * u;
                const d = hypot(t.x - px, t.y - py);
                const when = (acc + L * u) / sp;
                if (d < TK.TANK_R + b.r + 9 && (!worst || when < worst.when)) worst = { when, x: px, y: py, vx: (x1 - x0) / L, vy: (y1 - y0) / L, b };
                acc += L;
            }
        }
        return worst;
    }
    // try each way of moving for a moment and keep the one that ends furthest from the shell's line
    function dodge(s, i, w) {
        const t = s.tanks[i];
        let best = 1, bestD = -1;
        for (const mv of [1, 2, 5, 9, 6, 10, 0]) {
            const g = { x: t.x, y: t.y, a: t.a };
            for (let k = 0; k < 14; k++) moveTank(s.maze, g, mv, DT);
            // distance from the path line through the danger point
            const px = g.x - w.x, py = g.y - w.y;
            const side = abs(px * w.vy - py * w.vx);
            const d = side + (mv === 0 ? -6 : 0);
            if (d > bestD) { bestD = d; best = mv; }
        }
        return best;
    }
    function think(s, i, bot) {
        const t = s.tanks[i];
        if (!t || !t.alive || (s.phase !== 'fight' && s.phase !== 'after')) { if (t) t.in.mv = 0; return; }
        const lv = bot.lv, m = s.maze;
        if (bot.shotGap > 0) bot.shotGap -= DT;
        if (bot.flee > 0) bot.flee -= DT;
        const look = (s.tick + i * 3) % lv.every === 0;
        if (look) {
            bot.danger = rnd(bot) < lv.dodge ? threat(s, i) : null;
            const w = t.w;
            if (!t.frag && w !== 'mine' && w !== 'seeker' && !t.burst) {
                const own = ownShells(s, i);
                bot.aim = (w || own < TK.SHELLS) && bot.shotGap <= 0 ? findShot(s, i, bot, w) : null;
                if (bot.aim && !bot.aimed) { bot.aimed = true; bot.wait = lv.wait; bot.noise = (rnd(bot) - 0.5) * 2 * lv.aim; }
                if (!bot.aim) bot.aimed = false;
            } else bot.aim = null;
        }
        let mv = 0, fire = false;
        // the special cases first: a frag in the air, a mine to drop, a seeker to send
        if (t.frag) {
            const f = s.shells.find(b => b.id === t.frag);
            if (f) {
                const near = s.tanks.some(e => e.alive && e.i !== i && hypot(e.x - f.x, e.y - f.y) < 85);
                const safe = hypot(t.x - f.x, t.y - f.y) > 120;
                if (near && safe || f.age > f.life - 0.2) fire = true;
            }
        }
        const enemy = nearestEnemy(s, i);
        if (t.w === 'mine' && (t.held > 2.5 || (enemy && enemy.steps <= 3))) fire = true;
        if (t.w === 'seeker' && enemy && enemy.steps <= 5 && abs(wrap(t.a - enemy.dir)) < 1.6) { fire = true; bot.flee = 3; }
        if (bot.danger && bot.danger.when < 0.9) mv = dodge(s, i, bot.danger);
        else if (bot.aim) {
            const want = bot.aim.a + bot.noise;
            const diff = wrap(want - t.a);
            mv = abs(diff) < 0.02 ? 0 : diff > 0 ? 8 : 4;
            if (abs(diff) < 0.05 + lv.aim) {
                bot.wait -= DT * lv.every / max(1, lv.every);
                if (bot.wait <= 0) {
                    // one last look along the barrel as it is now: never into my own face
                    const beam = t.w === 'beam';
                    const c = cast(s, t.x, t.y, t.a, beam ? TK.WEAPON_BY_ID.beam.range : lv.range, beam ? TK.WEAPON_BY_ID.beam.bounces : lv.bounces + 1, beam ? 0 : TK.SHELL_R, i);
                    if (c.hit !== i) { fire = true; bot.shotGap = 0.25 + rnd(bot) * 0.5; bot.aim = null; bot.aimed = false; }
                    else { bot.aim = null; bot.aimed = false; }
                }
            }
        } else mv = drive(s, i, bot, enemy);
        // stuck against a corner: back off and turn for a moment
        if (bot.unstick > 0) { bot.unstick -= DT; mv = 2 | (bot.unstickDir || 4); }
        else if (mv & 1) {
            if (bot.last && hypot(bot.last[0] - t.x, bot.last[1] - t.y) < 0.5) bot.stuck += DT; else bot.stuck = 0;
            if (bot.stuck > 0.5) { bot.stuck = 0; bot.unstick = 0.35; bot.unstickDir = rnd(bot) < 0.5 ? 4 : 8; }
        }
        bot.last = [t.x, t.y];
        if (fire) bot.fp++;
        input(s, i, mv, bot.fp);
    }
    function nearestEnemy(s, i) {
        const t = s.tanks[i], m = s.maze, d = bfs(m, cellOf(m, t.x, t.y));
        let best = null;
        for (const e of s.tanks) {
            if (!e.alive || e.i === i) continue;
            const k = d[cellOf(m, e.x, e.y)];
            const steps = k < 0 ? 99 : k;
            if (!best || steps < best.steps) best = { i: e.i, steps, dir: atan2(e.y - t.y, e.x - t.x), x: e.x, y: e.y };
        }
        return best;
    }
    // along the maze's paths: to a file if one is close and the hands are free, else at somebody
    function drive(s, i, bot, enemy) {
        const t = s.tanks[i], m = s.maze, here = cellOf(m, t.x, t.y);
        let goal = null;
        if (bot.flee > 0) {
            const ms = s.shells.filter(b => b.k === 'm');
            if (ms.length) {
                const d = bfs(m, cellOf(m, ms[0].x, ms[0].y));
                let best = here;
                for (const n of m.nb[here]) if (d[n] > d[best]) best = n;
                goal = centre(m, best);
            }
        }
        if (!goal && !t.w && !t.frag && s.picks.length) {
            const d = bfs(m, here);
            let bp = null;
            for (const p of s.picks) { const k = d[cellOf(m, p.x, p.y)]; if (k >= 0 && (!bp || k < bp.k)) bp = { k, p }; }
            if (bp && (!enemy || bp.k <= enemy.steps + 2)) goal = bp.k === 0 ? [bp.p.x, bp.p.y] : stepTo(m, here, cellOf(m, bp.p.x, bp.p.y));
        }
        if (!goal && enemy) {
            if (enemy.steps <= 1 && hypot(enemy.x - t.x, enemy.y - t.y) < 110) {
                // close enough: just face them
                const diff = wrap(enemy.dir - t.a);
                return abs(diff) < 0.05 ? 0 : diff > 0 ? 8 : 4;
            }
            goal = stepTo(m, here, cellOf(m, enemy.x, enemy.y));
        }
        if (!goal) return 0;
        const want = atan2(goal[1] - t.y, goal[0] - t.x), diff = wrap(want - t.a);
        let mv = abs(diff) < 0.08 ? 0 : diff > 0 ? 8 : 4;
        if (abs(diff) < 0.6) mv |= 1;
        return mv;
    }
    function stepTo(m, from, to) {
        if (from === to) return centre(m, to);
        const back = bfs(m, to);
        let next = -1, nd = back[from] < 0 ? 999 : back[from];
        for (const n of m.nb[from]) if (back[n] >= 0 && back[n] < nd) { nd = back[n]; next = n; }
        return next < 0 ? null : centre(m, next);
    }

    // ===============================================================
    // the wire: what the host sends, and a guest reads
    // ===============================================================
    const r1 = v => round(v * 10) / 10, r2 = v => round(v * 100) / 100;
    function snapshot(s) {
        return {
            k: s.tick, r: s.round, ph: PHASES.indexOf(s.phase), pt: s.phaseT, rt: s.roundT, ms: s.maze.seed, lw: s.lastWinner, wn: s.winner,
            sc: s.scores.slice(),
            st: [s.kills.slice(), s.deaths.slice(), s.selfs.slice()],
            t: s.tanks.map(t => [r1(t.x), r1(t.y), round(t.a * 1000) / 1000, t.alive ? 1 : 0, t.w ? W_IDS.indexOf(t.w) : -1, t.moving ? 1 : 0, t.frag ? 1 : 0, t.fpSeen]),
            b: s.shells.map(b => [b.id, KINDS.indexOf(b.k), b.o, r2(b.x), r2(b.y), r2(b.vx), r2(b.vy), r2(b.age), r2(b.life), b.r, b.bounced ? 1 : 0]),
            p: s.picks.map(p => [p.id, round(p.x), round(p.y), p.w]),
            m: s.mines.map(q => [q.id, q.o, round(q.x), round(q.y), r1(q.age)]),
            e: s.log.map(e => evOut(e))
        };
    }
    function evOut(e) {
        const o = [e.n, e.e];
        if (e.e === 'die') o.push(e.i, e.by, e.how, e.x, e.y);
        else if (e.e === 'boom') o.push(e.x, e.y);
        else if (e.e === 'pick') o.push(e.i, e.w);
        else if (e.e === 'shot' || e.e === 'mine') o.push(e.i, e.w || '');
        else if (e.e === 'beam') o.push(e.i, e.pts);
        else if (e.e === 'end' || e.e === 'over') o.push(e.w);
        else if (e.e === 'round') o.push(e.r);
        return o;
    }
    function evIn(a) {
        if (!Array.isArray(a) || !Number.isSafeInteger(a[0]) || typeof a[1] !== 'string') return null;
        const e = { n: a[0], e: a[1] };
        const int = v => (Number.isFinite(v) ? v : 0);
        if (e.e === 'die') Object.assign(e, { i: int(a[2]), by: int(a[3]), how: String(a[4] || ''), x: int(a[5]), y: int(a[6]) });
        else if (e.e === 'boom') Object.assign(e, { x: int(a[2]), y: int(a[3]) });
        else if (e.e === 'pick') Object.assign(e, { i: int(a[2]), w: int(a[3]) });
        else if (e.e === 'shot' || e.e === 'mine') Object.assign(e, { i: int(a[2]), w: String(a[3] || '') });
        else if (e.e === 'beam') { if (!Array.isArray(a[3]) || a[3].length > 40) return null; Object.assign(e, { i: int(a[2]), pts: a[3].map(int) }); }
        else if (e.e === 'end' || e.e === 'over') e.w = int(a[2]);
        else if (e.e === 'round') e.r = int(a[2]);
        return e;
    }
    // into a puppet match: what the host says, as it says it. Events not seen before go on s.events
    function applySnapshot(s, d) {
        if (!d || typeof d !== 'object' || !Array.isArray(d.t) || d.t.length !== s.n) return false;
        const num = Number.isFinite;
        if (d.r !== s.round || !s.maze || d.ms !== s.maze.seed) {
            s.round = d.r | 0;
            s.maze = makeMaze(d.ms >>> 0, s.n, s.size);
            s.beams.length = 0;
        }
        s.phase = PHASES[d.ph] || 'fight'; s.phaseT = d.pt | 0; s.roundT = d.rt | 0; s.tick = d.k | 0;
        s.lastWinner = num(d.lw) ? d.lw : -1; s.winner = num(d.wn) ? d.wn : -1;
        if (Array.isArray(d.sc) && d.sc.length === s.n) s.scores = d.sc.map(v => +v || 0);
        if (Array.isArray(d.st) && d.st.length === 3) { s.kills = d.st[0].slice(0, s.n); s.deaths = d.st[1].slice(0, s.n); s.selfs = d.st[2].slice(0, s.n); }
        d.t.forEach((a, i) => {
            if (!Array.isArray(a)) return;
            const t = s.tanks[i];
            t.sx = num(a[0]) ? a[0] : t.x; t.sy = num(a[1]) ? a[1] : t.y; t.sa = num(a[2]) ? a[2] : t.a;
            t.x = t.sx; t.y = t.sy; t.a = t.sa;
            t.alive = a[3] === 1; t.w = a[4] >= 0 && a[4] < W_IDS.length ? W_IDS[a[4]] : ''; t.moving = a[5] === 1; t.frag = a[6] ? 1 : 0;
            t.fpSeen = a[7] | 0;
        });
        if (Array.isArray(d.b)) s.shells = d.b.filter(a => Array.isArray(a) && a.length >= 11).slice(0, 400).map(a => ({ id: a[0], k: KINDS[a[1]] || 's', o: a[2] | 0, x: +a[3], y: +a[4], vx: +a[5], vy: +a[6], age: +a[7], life: +a[8], r: +a[9] || 2, bounced: a[10] === 1, tgt: -1 }));
        if (Array.isArray(d.p)) s.picks = d.p.filter(a => Array.isArray(a)).slice(0, 12).map(a => ({ id: a[0], x: +a[1], y: +a[2], w: clamp(a[3] | 0, 0, W_IDS.length - 1) }));
        if (Array.isArray(d.m)) s.mines = d.m.filter(a => Array.isArray(a)).slice(0, 40).map(a => ({ id: a[0], o: a[1] | 0, x: +a[2], y: +a[3], age: +a[4] }));
        if (Array.isArray(d.e)) {
            for (const a of d.e) {
                const e = evIn(a);
                if (!e || e.n <= s.evN) continue;
                s.evN = e.n;
                s.events.push(e);
                if (e.e === 'beam') s.beams.push({ id: e.n, o: e.i, pts: e.pts, age: 0 });
            }
        }
        return true;
    }
    function seatList(s) { return s.seats.map(p => [p.id, p.name, p.bot || '', p.on ? 1 : 0]); }
    function applySeats(s, list) {
        if (!Array.isArray(list) || list.length !== s.n) return;
        list.forEach((a, i) => {
            if (!Array.isArray(a)) return;
            const p = s.seats[i];
            p.id = String(a[0] || p.id).slice(0, 64); p.name = String(a[1] || p.name).slice(0, 16); p.bot = typeof a[2] === 'string' ? a[2] : ''; p.on = a[3] === 1;
        });
    }
    // a seat changes hands: somebody left (a bot drives on), or came back
    function seatBot(s, i, level) {
        const p = s.seats[i];
        if (!p) return;
        p.bot = level || ''; p.on = !level;
        s.tanks[i].remote = false;
        if (level) s.tanks[i].in.mv = 0;
    }

    root.TK_SIM = {
        DT, PHASES, W_IDS, makeMaze, dims, bfs, cellOf, centre, cast, hitsTank, pushOut, moveTank, moveShell,
        newMatch, step, input, pose, press, kill, coast, newBot, think, findShot, threat, nearestEnemy,
        snapshot, applySnapshot, seatList, applySeats, seatBot, people, alive, mazeSeed, wrap
    };
})(typeof window !== 'undefined' ? window : globalThis);
