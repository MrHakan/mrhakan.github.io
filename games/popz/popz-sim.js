// ===================================================================
// popz 98 — the rules: bubbles, ropes, levels, items and the bot
//
// No page, no clock, no network: a fixed step of 1/60 s, a seeded random
// number generator kept inside the state, and plain arrays. The browser and
// node run exactly the same code, so the tests in check-popz.mjs play the real
// game. popz.js draws it, reads the keys and carries it over the wire.
//
// The field is 640 x 400 units, y grows downwards and the floor is y = 400.
// The players walk on the floor only; blocks are for the bubbles (they bounce
// on and off them) and for the ropes (which stop under them). Glass blocks
// break when a rope reaches them.
// ===================================================================
(function (root) {
    'use strict';
    const { abs, sqrt, min, max, round } = Math;

    const REV = 1;
    const W = 640, H = 400, TICK = 60, DT = 1 / TICK;
    const GRAV = 600;
    const RADIUS = [7, 12, 19, 28];                       // size 0 pops, size 3 is the big one
    const BOUNCE = [100, 160, 220, 280].map(h => sqrt(2 * GRAV * h));   // floor speed: bigger bounces higher
    const VX = 85;                                        // every bubble drifts at the same pace
    const POP_VY = 250;                                   // the little hop two halves make
    const P_W = 22, P_H = 34, P_SPEED = 150;              // the player
    const HIT_HW = 8, HIT_H = 28;                         // the part of the player a bubble can touch
    const ROPE_SPEED = 460, STICK_TIME = 4;
    const ITEM_LIFE = 7, DROP = 0.13;
    const LIVES = 3, MAX_LIVES = 9;
    const POINTS = [100, 75, 50, 25];                     // per hit, by size: the small ones are worth more
    const ITEMS = ['double', 'sticky', 'shield', 'freeze', 'dynamite', 'life'];
    const ITEM_WEIGHT = [3, 3, 3, 2, 2, 1];
    const WEAPONS = ['rope', 'double', 'sticky'];
    const READY_TIME = 1.6, DEAD_TIME = 2, CLEAR_TIME = 2.6, FREEZE_TIME = 5, SHIELD_GRACE = 1.5, RESPAWN_GRACE = 1.2;

    // -----------------------------------------------------------------
    // the levels. bubbles: [size, x, direction, y = 90]; blocks: [x, y, w, h, glass]
    // -----------------------------------------------------------------
    const row = (y, step, glass, from = 0, to = W) => { const o = []; for (let x = from; x < to; x += step) o.push([x, y, step, 14, glass]); return o; };
    const LEVELS = [
        { name: 'hello world', b: [[2, 160, 1]] },
        { name: 'a pair', b: [[2, 140, 1], [2, 500, -1]] },
        { name: 'the big one', b: [[3, 320, 1]] },
        { name: 'the shelf', b: [[2, 110, 1], [2, 530, -1]], k: [[230, 190, 180, 14, 0]] },
        { name: 'glass ceiling', b: [[3, 200, 1, 190]], k: row(110, 80, 1) },
        { name: 'stalactites', b: [[2, 100, 1], [2, 540, -1], [1, 320, 1]], k: [[200, 0, 16, 170, 0], [424, 0, 16, 170, 0]] },
        { name: 'twins', b: [[3, 160, 1], [3, 480, -1]] },
        { name: 'two rooms', b: [[2, 150, 1], [2, 490, -1], [1, 70, 1, 200], [1, 570, -1, 200]], k: [[312, 0, 16, 330, 0]] },
        { name: 'the stairs', b: [[2, 140, 1, 200], [2, 500, -1, 60]], k: [[80, 280, 120, 14, 0], [260, 200, 120, 14, 0], [440, 120, 120, 14, 0]] },
        { name: 'drizzle', b: [[1, 60, 1, 70], [1, 160, -1, 120], [1, 260, 1, 70], [1, 380, -1, 120], [1, 480, 1, 70], [1, 580, -1, 120]] },
        { name: 'glass maze', b: [[3, 160, 1, 210], [2, 480, -1, 210]], k: row(100, 64, 1) },
        { name: 'sandwich', b: [[2, 320, 1, 220], [2, 70, 1], [2, 570, -1]], k: [[120, 150, 400, 14, 0], [120, 290, 400, 14, 0]] },
        { name: 'the greenhouse', b: [[3, 320, 1, 120], [1, 90, 1], [1, 550, -1]], k: [[200, 200, 240, 14, 1]] },
        { name: 'triplets', b: [[2, 100, 1], [2, 320, 1], [2, 540, -1]] },
        { name: 'heavy weather', b: [[3, 120, 1], [3, 520, -1]], k: [[300, 0, 40, 120, 0]] },
        { name: 'chimneys', b: [[2, 70, 1], [2, 320, 1, 280], [2, 570, -1]], k: [[150, 0, 16, 250, 0], [474, 0, 16, 250, 0]] },
        { name: 'double glazing', b: [[3, 320, 1, 270]], k: row(90, 80, 1, 0, 320).concat(row(170, 80, 1, 320, 640)) },
        { name: 'hailstorm', b: [[0, 40, 1, 60], [0, 110, -1, 140], [0, 180, 1, 60], [0, 250, -1, 140], [0, 390, 1, 60], [0, 460, -1, 140], [0, 530, 1, 60], [0, 600, -1, 140], [1, 300, 1, 100], [1, 340, -1, 100]] },
        { name: 'the pit', b: [[3, 320, 1], [2, 100, 1, 150], [2, 540, -1, 150]], k: [[0, 250, 200, 14, 0], [440, 250, 200, 14, 0]] },
        { name: 'big three', b: [[3, 110, 1], [3, 320, -1], [3, 530, 1]] },
        { name: 'the corridor', b: [[2, 80, 1], [2, 220, -1], [2, 420, 1], [2, 560, -1]], k: [[0, 180, 260, 14, 0], [380, 180, 260, 14, 0]] },
        { name: 'glass pillars', b: [[3, 320, 1], [2, 70, 1], [2, 570, -1]], k: [[160, 0, 16, 300, 1], [464, 0, 16, 300, 1]] },
        { name: 'everything', b: [[3, 160, 1], [3, 480, -1], [1, 320, 1, 60]], k: [[260, 130, 120, 14, 1], [40, 230, 120, 14, 0], [480, 230, 120, 14, 0]] },
        { name: 'the last pop', b: [[3, 90, 1], [3, 250, -1], [3, 390, 1], [3, 550, -1]] }
    ];
    // a level's clock: thirty seconds, and five more for every hit it takes
    const hitsFor = size => (1 << (size + 1)) - 1;
    LEVELS.forEach(l => { l.k = l.k || []; l.time = l.time || 30 + 5 * l.b.reduce((n, b) => n + hitsFor(b[0]), 0); });

    // -----------------------------------------------------------------
    // the random numbers: mulberry32, its state kept in the game
    // -----------------------------------------------------------------
    function mulberry(o) {
        let t = (o.rng = (o.rng + 0x6D2B79F5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const rand = mulberry;

    // -----------------------------------------------------------------
    // a game
    // -----------------------------------------------------------------
    const homeX = (i, n) => (n === 1 ? W / 2 : W / 2 + (i ? 70 : -70));
    function newPlayer(i, n, lives) {
        return { i, x: homeX(i, n), face: i ? -1 : 1, lives, score: 0, weapon: 'rope', shield: false, inv: 0, on: true, out: false, ropes: [], in: { b: 0, f: 0 }, fs: 0, pops: 0 };
    }
    function newGame(o) {
        o = o || {};
        const n = o.players === 2 ? 2 : 1;
        const seed = (o.seed >>> 0) || 1;
        const lives = int(o.lives, 1, MAX_LIVES) ? o.lives : LIVES;
        const s = {
            rev: REV, seed, rng: seed, k: 0, lv: 0, ph: 'ready', pt: READY_TIME, time: 0, freeze: 0, bonus: 0, why: '',
            players: [], bubbles: [], items: [], blocks: [], ev: [], puppet: !!o.puppet, start: 0, cleared: 0
        };
        for (let i = 0; i < n; i++) s.players.push(newPlayer(i, n, lives));
        s.start = max(0, min(LEVELS.length - 1, (o.level | 0)));
        loadLevel(s, s.start);
        return s;
    }
    function loadBlocks(s, lv) {
        s.blocks = LEVELS[lv].k.map(b => ({ x: b[0], y: b[1], w: b[2], h: b[3], glass: !!b[4], hp: 1 }));
    }
    function loadLevel(s, lv) {
        const L = LEVELS[lv];
        s.lv = lv;
        s.ph = 'ready'; s.pt = READY_TIME;
        s.time = L.time; s.freeze = 0;
        s.bubbles = L.b.map(b => ({ x: b[1], y: b[3] || 90, vx: VX * (b[2] < 0 ? -1 : 1), vy: 0, s: b[0] }));
        s.items = [];
        loadBlocks(s, lv);
        const n = s.players.length;
        s.players.forEach(p => {
            p.ropes = []; p.on = !p.out; p.inv = 0;
            p.x = homeX(p.i, n);
            p.fs = p.in.f;
        });
    }
    const active = s => s.players.filter(p => p.on);
    const total = s => s.players.reduce((a, p) => a + p.score, 0);
    const event = (s, e) => { if (s.ev.length < 64) s.ev.push(e); };
    const over = s => s.ph === 'over' || s.ph === 'win';

    // -----------------------------------------------------------------
    // things that touch
    // -----------------------------------------------------------------
    // a bubble one step on: gravity, the walls, the floor, the ceiling and blocks
    function moveBubble(blocks, b, dt) {
        const r = RADIUS[b.s];
        b.vy += GRAV * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x - r < 0) { b.x = r; b.vx = abs(b.vx); }
        else if (b.x + r > W) { b.x = W - r; b.vx = -abs(b.vx); }
        if (b.y + r > H) { b.y = H - r; b.vy = -BOUNCE[b.s]; }
        else if (b.y - r < 0) { b.y = r; b.vy = abs(b.vy); }
        for (let j = 0; j < blocks.length; j++) {
            const k = blocks[j];
            if (k.hp <= 0) continue;
            const cx = b.x < k.x ? k.x : b.x > k.x + k.w ? k.x + k.w : b.x;
            const cy = b.y < k.y ? k.y : b.y > k.y + k.h ? k.y + k.h : b.y;
            let dx = b.x - cx, dy = b.y - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 >= r * r) continue;
            if (d2 === 0) {
                // the centre got inside: out by the shortest way
                const l = b.x - k.x, rr = k.x + k.w - b.x, t = b.y - k.y, bt = k.y + k.h - b.y;
                const m = min(l, rr, t, bt);
                dx = m === l ? -1 : m === rr ? 1 : 0; dy = dx ? 0 : m === t ? -1 : 1;
                if (dx < 0) b.x = k.x - r; else if (dx > 0) b.x = k.x + k.w + r;
                if (dy < 0) b.y = k.y - r; else if (dy > 0) b.y = k.y + k.h + r;
            } else {
                const d = sqrt(d2);
                dx /= d; dy /= d;
                b.x = cx + dx * r; b.y = cy + dy * r;
            }
            if (abs(dy) >= abs(dx)) {
                if (dy < 0) { if (b.vy > 0) b.vy = -BOUNCE[b.s]; }
                else b.vy = abs(b.vy);
            } else b.vx = dx > 0 ? abs(b.vx) : -abs(b.vx);
        }
        // a block can push a bubble out of the room; the room wins
        if (b.x < r) b.x = r; else if (b.x > W - r) b.x = W - r;
        if (b.y < r) b.y = r; else if (b.y > H - r) b.y = H - r;
    }
    // how high a rope at x can go: the underside of the lowest block over it
    function ropeTop(s, x) {
        let top = 0, hit = -1;
        for (let j = 0; j < s.blocks.length; j++) {
            const k = s.blocks[j];
            if (k.hp <= 0 || x < k.x - 2 || x > k.x + k.w + 2) continue;
            const bottom = k.y + k.h;
            if (bottom > top && bottom < H - P_H) { top = bottom; hit = j; }
        }
        return { top, hit };
    }
    // a circle against the part of a player that counts
    function touches(b, x) {
        const r = RADIUS[b.s] - 1;
        const cx = b.x < x - HIT_HW ? x - HIT_HW : b.x > x + HIT_HW ? x + HIT_HW : b.x;
        const cy = b.y < H - HIT_H ? H - HIT_H : b.y;
        const dx = b.x - cx, dy = b.y - cy;
        return dx * dx + dy * dy < r * r;
    }
    function ropeHits(b, rope) {
        const r = RADIUS[b.s];
        return abs(b.x - rope.x) < r + 2 && b.y + r > rope.tip && b.y - r < H;
    }
    // a block standing on the floor is a wall the players cannot walk through
    function walk(s, p, dx) {
        let x = p.x + dx;
        const hw = P_W / 2;
        x = max(hw, min(W - hw, x));
        for (const k of s.blocks) {
            if (k.hp <= 0 || k.y + k.h <= H - P_H) continue;
            if (x + hw > k.x && x - hw < k.x + k.w) x = p.x <= k.x ? k.x - hw : k.x + k.w + hw;
        }
        p.x = x;
    }

    // -----------------------------------------------------------------
    // splitting, items, firing
    // -----------------------------------------------------------------
    function split(s, idx, p, quiet) {
        const b = s.bubbles[idx];
        if (p) { p.score += POINTS[b.s]; p.pops++; }
        if (!quiet) event(s, { e: 'pop', x: round(b.x), y: round(b.y), s: b.s, i: p ? p.i : -1 });
        if (!quiet && rand(s) < DROP) dropItem(s, b.x, b.y);
        if (b.s === 0) { s.bubbles.splice(idx, 1); return; }
        const ns = b.s - 1, r = RADIUS[ns];
        const y = max(r, b.y);
        s.bubbles.splice(idx, 1,
            { x: max(r, b.x - r * 0.5), y, vx: -VX, vy: -POP_VY, s: ns },
            { x: min(W - r, b.x + r * 0.5), y, vx: VX, vy: -POP_VY, s: ns });
    }
    function dropItem(s, x, y) {
        let w = rand(s) * ITEM_WEIGHT.reduce((a, b) => a + b, 0), t = 0;
        while (t < ITEMS.length - 1 && w >= ITEM_WEIGHT[t]) { w -= ITEM_WEIGHT[t]; t++; }
        if (s.items.length < 12) s.items.push({ x: max(8, min(W - 8, x)), y: max(8, y), vy: 0, t: ITEMS[t], life: ITEM_LIFE });
    }
    function take(s, p, it) {
        p.score += 50;
        switch (it.t) {
            case 'double': case 'sticky': p.weapon = it.t; break;
            case 'shield': p.shield = true; break;
            case 'freeze': s.freeze = FREEZE_TIME; break;
            case 'life': p.lives = min(MAX_LIVES, p.lives + 1); break;
            case 'dynamite': dynamite(s, p); break;
        }
        event(s, { e: 'item', t: it.t, i: p.i, x: round(it.x) });
    }
    // every bubble down to the smallest size, at once
    function dynamite(s, p) {
        let guard = 0;
        for (let j = 0; j < s.bubbles.length && guard < 400; guard++) {
            if (s.bubbles[j].s > 0) { if (p) p.score += POINTS[s.bubbles[j].s] >> 1; split(s, j, null, true); }
            else j++;
        }
        event(s, { e: 'boom' });
    }
    function fire(s, p) {
        if (!p.on || s.ph !== 'play') return false;
        const cap = p.weapon === 'double' ? 2 : 1;
        if (p.ropes.length >= cap) {
            // a rope stuck to the ceiling never blocks a new shot: the oldest goes
            const stuck = p.ropes.findIndex(r => r.st >= 0);
            if (stuck < 0) return false;
            p.ropes.splice(stuck, 1);
        }
        p.ropes.push({ x: p.x, tip: H - P_H * 0.6, st: -1, sticky: p.weapon === 'sticky' });
        event(s, { e: 'fire', i: p.i });
        return true;
    }
    // what a person (or the wire) can ask for: walk bits (1 left, 2 right) and a press counter
    function input(s, i, bits, presses) {
        const p = s.players[i];
        if (!p) return;
        p.in.b = bits & 3;
        if (Number.isSafeInteger(presses) && presses >= p.in.f) p.in.f = presses;
    }

    // -----------------------------------------------------------------
    // one step
    // -----------------------------------------------------------------
    function step(s) {
        s.k++;
        if (s.ph === 'over' || s.ph === 'win') return;
        if (s.ph === 'dead' || s.ph === 'clear') {
            if (s.ph === 'clear') moveItems(s, DT, true);
            if (s.puppet) return;
            s.pt -= DT;
            if (s.pt > 0) return;
            if (s.ph === 'dead') afterDeath(s); else afterClear(s);
            return;
        }
        const ready = s.ph === 'ready';
        // the players walk, also while the level gets ready
        for (const p of s.players) {
            if (!p.on) continue;
            const dir = (p.in.b & 2 ? 1 : 0) - (p.in.b & 1 ? 1 : 0);
            if (dir) { walk(s, p, dir * P_SPEED * DT); p.face = dir; }
            if (p.inv > 0 && !ready) p.inv = max(0, p.inv - DT);
            if (p.in.f !== p.fs) {
                p.fs = p.in.f;
                if (!ready && !s.puppet) fire(s, p);
            }
        }
        if (ready) {
            if (s.puppet) return;
            s.pt -= DT;
            if (s.pt <= 0) { s.ph = 'play'; s.pt = 0; event(s, { e: 'go' }); }
            return;
        }
        // the bubbles, unless the clock is frozen
        if (s.freeze > 0) s.freeze = max(0, s.freeze - DT);
        else for (let j = 0; j < s.bubbles.length; j++) moveBubble(s.blocks, s.bubbles[j], DT);
        // the ropes
        for (const p of s.players) {
            for (let r = p.ropes.length - 1; r >= 0; r--) {
                const rope = p.ropes[r];
                if (rope.st >= 0) {
                    rope.st -= DT;
                    if (rope.st <= 0 && !s.puppet) p.ropes.splice(r, 1);
                    continue;
                }
                const lim = ropeTop(s, rope.x);
                rope.tip -= ROPE_SPEED * DT;
                if (rope.tip > lim.top) continue;
                rope.tip = lim.top;
                if (s.puppet) continue;
                if (lim.hit >= 0 && s.blocks[lim.hit].glass) {
                    const k = s.blocks[lim.hit];
                    k.hp = 0;
                    p.score += 50;
                    event(s, { e: 'glass', x: round(k.x + k.w / 2), y: round(k.y + k.h / 2), w: k.w, h: k.h });
                    if (rand(s) < DROP) dropItem(s, k.x + k.w / 2, k.y + k.h);
                }
                if (rope.sticky) rope.st = STICK_TIME; else p.ropes.splice(r, 1);
            }
        }
        moveItems(s, DT, false);
        if (s.puppet) { s.time = max(0, s.time - DT); return; }
        // ropes against bubbles: each rope takes one bubble and is gone
        for (const p of s.players) {
            for (let r = p.ropes.length - 1; r >= 0; r--) {
                const rope = p.ropes[r];
                for (let j = 0; j < s.bubbles.length; j++) {
                    if (!ropeHits(s.bubbles[j], rope)) continue;
                    split(s, j, p);
                    p.ropes.splice(r, 1);
                    break;
                }
            }
        }
        // items to whoever walks over them
        for (let j = s.items.length - 1; j >= 0; j--) {
            const it = s.items[j];
            const p = s.players.find(q => q.on && abs(q.x - it.x) < 15 && it.y > H - P_H - 6);
            if (p) { s.items.splice(j, 1); take(s, p, it); }
        }
        if (!s.bubbles.length) { clear(s); return; }
        // bubbles against players
        const hit = [];
        for (const p of s.players) {
            if (!p.on || p.inv > 0) continue;
            if (!s.bubbles.some(b => touches(b, p.x))) continue;
            if (p.shield) { p.shield = false; p.inv = SHIELD_GRACE; event(s, { e: 'shield', i: p.i }); continue; }
            hit.push(p);
        }
        if (hit.length) { die(s, hit, 'hit'); return; }
        s.time = max(0, s.time - DT);
        if (s.time <= 0) die(s, active(s), 'time');
    }
    function moveItems(s, dt, frozen) {
        for (let j = s.items.length - 1; j >= 0; j--) {
            const it = s.items[j];
            if (it.vy !== 0 || it.y < H - 6) {
                const before = it.y;
                it.vy = min(400, it.vy + GRAV * dt);
                it.y += it.vy * dt;
                if (it.y > H - 6) { it.y = H - 6; it.vy = 0; }
                for (const k of s.blocks) {
                    if (k.hp > 0 && it.x > k.x && it.x < k.x + k.w && before + 6 <= k.y + 0.01 && it.y + 6 > k.y) { it.y = k.y - 6; it.vy = 0; }
                }
            }
            if (frozen) continue;
            it.life -= dt;
            if (it.life <= 0 && !s.puppet) s.items.splice(j, 1);
        }
    }
    function die(s, who, why) {
        for (const p of who) {
            p.lives = max(0, p.lives - 1);
            p.weapon = 'rope'; p.shield = false;
            event(s, { e: 'die', i: p.i, why, x: round(p.x) });
        }
        s.ph = 'dead'; s.pt = DEAD_TIME; s.why = why;
        s.players.forEach(p => { p.ropes = []; });
    }
    function afterDeath(s) {
        s.players.forEach(p => { if (p.lives <= 0) { p.out = true; p.on = false; } });
        if (!s.players.some(p => !p.out)) { s.ph = 'over'; s.pt = 0; event(s, { e: 'over' }); return; }
        loadLevel(s, s.lv);
        s.players.forEach(p => { if (p.on) p.inv = RESPAWN_GRACE; });
    }
    function clear(s) {
        const bonus = Math.ceil(s.time) * 10;
        s.bonus = bonus;
        active(s).forEach(p => { p.score += bonus; });
        s.ph = 'clear'; s.pt = CLEAR_TIME;
        s.cleared++;
        s.players.forEach(p => { p.ropes = []; });
        event(s, { e: 'clear', lv: s.lv, bonus });
    }
    function afterClear(s) {
        if (s.lv >= LEVELS.length - 1) { s.ph = 'win'; s.pt = 0; event(s, { e: 'win' }); return; }
        loadLevel(s, s.lv + 1);
    }

    // -----------------------------------------------------------------
    // the bot: looks a second and a half ahead, stands where nothing lands
    // and fires when a rope from where it stands would meet a bubble
    // -----------------------------------------------------------------
    const SAMPLE = 3, SAMPLES = 30;     // every 3 steps, for 1.5 s
    function newBot(seed) { return { rng: (seed >>> 0) || 7, at: -99, tx: -1, pred: [], scratch: [], n: 0, jitter: 0, idle: 0 }; }
    // where every bubble will be: pred[t] = flat [x, y, r, ...]
    function predict(s, bot) {
        const n = s.bubbles.length, sc = bot.scratch;
        for (let j = 0; j < n; j++) {
            const b = s.bubbles[j];
            const c = sc[j] || (sc[j] = { x: 0, y: 0, vx: 0, vy: 0, s: 0 });
            c.x = b.x; c.y = b.y; c.vx = b.vx; c.vy = b.vy; c.s = b.s;
        }
        for (let t = 0; t < SAMPLES; t++) {
            const rw = bot.pred[t] || (bot.pred[t] = []);
            rw.length = n * 3;
            const moving = t > 0 && s.freeze <= t * SAMPLE * DT;
            for (let j = 0; j < n; j++) {
                const c = sc[j];
                if (moving) for (let k = 0; k < SAMPLE; k++) moveBubble(s.blocks, c, DT);
                rw[j * 3] = c.x; rw[j * 3 + 1] = c.y; rw[j * 3 + 2] = RADIUS[c.s];
            }
        }
        bot.n = n;
    }
    // the gap between a predicted bubble and a player standing at x
    function gap(rw, j, x) {
        const bx = rw[j * 3], by = rw[j * 3 + 1], r = rw[j * 3 + 2];
        const cx = bx < x - HIT_HW ? x - HIT_HW : bx > x + HIT_HW ? x + HIT_HW : bx;
        const cy = by < H - HIT_H ? H - HIT_H : by;
        return sqrt((bx - cx) * (bx - cx) + (by - cy) * (by - cy)) - r;
    }
    function reachable(s, from, to) {
        const lo = min(from, to), hi = max(from, to);
        for (const k of s.blocks) if (k.hp > 0 && k.y + k.h > H - P_H && k.x < hi + P_W / 2 && k.x + k.w > lo - P_W / 2) return false;
        return true;
    }
    // would a rope fired at x, `delay` samples from now, meet a bubble?
    function ropeWouldHit(s, bot, x, delay) {
        const top = ropeTop(s, x).top;
        for (let t = delay; t < SAMPLES; t++) {
            const tip = max(top, H - P_H * 0.6 - ROPE_SPEED * (t - delay) * SAMPLE * DT);
            const rw = bot.pred[t];
            for (let j = 0; j < bot.n; j++) {
                const r = rw[j * 3 + 2];
                if (abs(rw[j * 3] - x) < r && rw[j * 3 + 1] + r > tip + 4) return true;
            }
            if (tip <= top && t - delay > 2) break;
        }
        return false;
    }
    function glassOver(s, x) {
        const lim = ropeTop(s, x);
        return lim.hit >= 0 && s.blocks[lim.hit].glass;
    }
    function think(s, i, bot) {
        const p = s.players[i];
        if (!p) return;
        if (!p.on || (s.ph !== 'play' && s.ph !== 'ready')) { p.in.b = 0; return; }
        if (s.k - bot.at >= 3) {
            bot.at = s.k;
            predict(s, bot);
            let best = p.x, bestScore = -1e9;
            const mate = s.players.find(q => q !== p && q.on);
            const step = P_SPEED * SAMPLE * DT;
            for (let cx = 14; cx <= W - 14; cx += 12) {
                const x0 = abs(cx - p.x) < 6 ? p.x : cx;
                if (!reachable(s, p.x, x0)) continue;
                let safe = 1e9;
                const dir = x0 > p.x ? 1 : -1, far = abs(x0 - p.x);
                for (let t = 0; t < SAMPLES; t++) {
                    const x = p.x + dir * min(far, step * t);
                    const rw = bot.pred[t], ease = t < 12 ? 0 : (t - 12) * 0.6;   // the far future counts a little less
                    for (let j = 0; j < bot.n; j++) {
                        const g = gap(rw, j, x) + ease;
                        if (g < safe) safe = g;
                    }
                }
                let score = min(safe, 40) * 10 - far * 0.08;
                if (safe < 8) score -= 2000;
                const arrive = min(SAMPLES - 1, Math.ceil(far / step));
                if (ropeWouldHit(s, bot, x0, arrive)) score += 120 - arrive * 4;
                else if (bot.idle > 90 && glassOver(s, x0)) score += 90;
                if (mate) score -= max(0, 60 - abs(mate.x - x0)) * 0.8;   // two players do not share a spot
                score += bot.jitter * ((cx * 7919) % 13);
                if (score > bestScore) { bestScore = score; best = x0; }
            }
            bot.tx = best;
            bot.jitter = mulberry(bot) * 0.6;
            const cap = p.weapon === 'double' ? 2 : 1;
            let flying = 0;
            for (const r of p.ropes) if (r.st < 0) flying++;
            // with nothing to hit for a while, a rope at the glass overhead opens the way
            if (s.ph === 'play' && flying < cap && (ropeWouldHit(s, bot, p.x, 0) || (bot.idle > 90 && glassOver(s, p.x)))) { p.in.f++; bot.idle = 0; }
        }
        if (s.ph === 'play') bot.idle++;
        const d = bot.tx - p.x;
        p.in.b = abs(d) < 2 ? 0 : d < 0 ? 1 : 2;
    }

    // -----------------------------------------------------------------
    // the wire: what the host sends twenty times a second, and the guest's check of it
    // -----------------------------------------------------------------
    const r1 = v => round(v * 10) / 10, r2 = v => round(v * 100) / 100;
    const PHASES = ['ready', 'play', 'dead', 'clear', 'over', 'win'];
    function snapshot(s) {
        const B = [];
        for (const b of s.bubbles) B.push(r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.s);
        return {
            v: REV, k: s.k, lv: s.lv, ph: s.ph, pt: r2(s.pt), tm: r1(s.time), fz: r2(s.freeze), bn: s.bonus || 0, cl: s.cleared,
            P: s.players.map(p => [r1(p.x), p.face, p.lives, p.score, WEAPONS.indexOf(p.weapon), p.shield ? 1 : 0, r2(p.inv), p.on ? 1 : 0, p.out ? 1 : 0, p.in.b, p.ropes.map(r => [r1(r.x), r1(r.tip), r2(r.st), r.sticky ? 1 : 0])]),
            B, I: s.items.map(it => [r1(it.x), r1(it.y), r1(it.vy), ITEMS.indexOf(it.t), r1(it.life)]),
            K: s.blocks.map(k => (k.hp > 0 ? 1 : 0)).join('')
        };
    }
    function num(v, lo, hi) { return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi; }
    function int(v, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi; }
    // a guest never trusts the shape of what arrives: false, and nothing changed, unless all of it is sane
    function applySnapshot(s, d) {
        if (!d || typeof d !== 'object' || d.v !== REV || !int(d.k, 0, 1e9) || !int(d.lv, 0, LEVELS.length - 1) || !PHASES.includes(d.ph)) return false;
        if (!num(d.pt, -1, 10) || !num(d.tm, 0, 1000) || !num(d.fz, 0, 30) || !int(d.bn, 0, 1e5) || !int(d.cl, 0, 1000)) return false;
        if (!Array.isArray(d.P) || d.P.length !== s.players.length || !Array.isArray(d.B) || d.B.length % 5 || d.B.length > 5 * 400 || !Array.isArray(d.I) || d.I.length > 64 || typeof d.K !== 'string' || d.K.length !== LEVELS[d.lv].k.length) return false;
        for (const q of d.P) {
            if (!Array.isArray(q) || q.length !== 11 || !num(q[0], 0, W) || !int(q[2], 0, MAX_LIVES) || !int(q[3], 0, 1e8) || !int(q[4], 0, 2) || !num(q[6], 0, 10) || !int(q[9], 0, 3)) return false;
            if (!Array.isArray(q[10]) || q[10].length > 2 || q[10].some(r => !Array.isArray(r) || !num(r[0], 0, W) || !num(r[1], -10, H) || !num(r[2], -2, 10))) return false;
        }
        for (let j = 0; j < d.B.length; j += 5) if (!num(d.B[j], -50, W + 50) || !num(d.B[j + 1], -50, H + 50) || !num(d.B[j + 2], -500, 500) || !num(d.B[j + 3], -2000, 2000) || !int(d.B[j + 4], 0, 3)) return false;
        for (const it of d.I) if (!Array.isArray(it) || !num(it[0], 0, W) || !num(it[1], -50, H) || !num(it[2], -1000, 1000) || !int(it[3], 0, ITEMS.length - 1) || !num(it[4], -1, 20)) return false;
        if (d.lv !== s.lv || s.blocks.length !== LEVELS[d.lv].k.length) loadBlocks(s, d.lv);
        s.k = d.k; s.lv = d.lv; s.ph = d.ph; s.pt = d.pt; s.time = d.tm; s.freeze = d.fz; s.bonus = d.bn; s.cleared = d.cl;
        s.blocks.forEach((k, j) => { k.hp = d.K[j] === '1' ? 1 : 0; });
        d.P.forEach((q, i) => {
            const p = s.players[i];
            p.x = q[0]; p.face = q[1] < 0 ? -1 : 1; p.lives = q[2]; p.score = q[3]; p.weapon = WEAPONS[q[4]]; p.shield = q[5] === 1; p.inv = q[6];
            p.on = q[7] === 1; p.out = q[8] === 1; p.in.b = q[9];
            p.ropes = q[10].map(r => ({ x: r[0], tip: r[1], st: r[2], sticky: r[3] === 1 }));
        });
        s.bubbles.length = d.B.length / 5;
        for (let j = 0, n = 0; j < d.B.length; j += 5, n++) {
            const b = s.bubbles[n] || (s.bubbles[n] = { x: 0, y: 0, vx: 0, vy: 0, s: 0 });
            b.x = d.B[j]; b.y = d.B[j + 1]; b.vx = d.B[j + 2]; b.vy = d.B[j + 3]; b.s = d.B[j + 4];
        }
        s.items = d.I.map(it => ({ x: it[0], y: it[1], vy: it[2], t: ITEMS[it[3]], life: it[4] }));
        return true;
    }

    // -----------------------------------------------------------------
    // a check for the tests: the whole state still makes sense
    // -----------------------------------------------------------------
    function valid(s) {
        if (!PHASES.includes(s.ph) || s.lv < 0 || s.lv >= LEVELS.length) return false;
        for (const b of s.bubbles) {
            const r = RADIUS[b.s];
            if (!(b.s >= 0 && b.s <= 3) || !Number.isFinite(b.x) || !Number.isFinite(b.y) || b.x < r - 0.01 || b.x > W - r + 0.01 || b.y > H - r + 0.01 || b.y < r - 0.01) return false;
        }
        return s.players.every(p => p.x >= P_W / 2 - 0.01 && p.x <= W - P_W / 2 + 0.01 && p.lives >= 0 && p.score >= 0);
    }

    root.POPZ_SIM = {
        REV, W, H, TICK, DT, GRAV, RADIUS, BOUNCE, VX, POP_VY, P_W, P_H, P_SPEED, ROPE_SPEED, STICK_TIME, LIVES, MAX_LIVES, POINTS, ITEMS, WEAPONS, LEVELS,
        READY_TIME, DEAD_TIME, CLEAR_TIME, FREEZE_TIME,
        newGame, loadLevel, step, input, fire, split, dynamite, take, dropItem, moveBubble, ropeTop, touches, ropeHits,
        newBot, think, snapshot, applySnapshot, valid, total, active, over, rand, hitsFor
    };
})(typeof window === 'undefined' ? globalThis : window);
