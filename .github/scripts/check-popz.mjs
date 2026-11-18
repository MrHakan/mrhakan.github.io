// ===================================================================
// check-popz.mjs — popz 98's rules, bot and wire, under node
//
//   the levels    at least twenty, every bubble and block inside the room,
//                 no bubble starting inside a block, a clock on each
//   the bubbles   bigger bounce higher, nothing ever leaves the room,
//                 a hit splits one into two smaller ones, the smallest pops
//   the ropes     one at a time (two with double), stop under steel, break
//                 glass, sticky ones stay at the top for a while
//   the players   a bubble costs a life and restarts the level, a shield
//                 takes one hit, no lives left is game over, the clock running
//                 out costs a life too, walls on the floor cannot be walked through
//   the items     freeze, dynamite, extra life, double, sticky, shield
//   progression   a cleared level pays its time bonus and the next one loads;
//                 the last one wins the game
//   the wire      a snapshot puts the same game on a guest's screen; anything
//                 malformed is refused and changes nothing
//   the bot       clears levels 1 to 5 on every seed, every level is cleared
//                 on some seed, and whole games always end
//
//   node .github/scripts/check-popz.mjs
// ===================================================================
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
require(path.join(ROOT, 'games/popz/popz-sim.js'));
const S = globalThis.POPZ_SIM;

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
const { W, H, RADIUS } = S;

// a game already in play, with nothing on the floor and a clock that does not run out
function playing(o) {
    const s = S.newGame(Object.assign({ seed: 7, level: 0, players: 1 }, o || {}));
    while (s.ph !== 'play') S.step(s);
    s.ev.length = 0;
    return s;
}
const steps = (s, n, each) => { for (let i = 0; i < n; i++) { if (each) each(); S.step(s); } };
const press = (s, i) => S.input(s, i, s.players[i].in.b, s.players[i].in.f + 1);

try {
    // =================================================================
    section('the levels');
    // =================================================================
    {
        expect(S.LEVELS.length >= 20, 'there are at least twenty levels', S.LEVELS.length);
        let inside = true, blocksIn = true, clear = true, named = true, timed = true;
        S.LEVELS.forEach((L, i) => {
            if (!L.name || L.name !== L.name.toLowerCase()) named = false;
            if (!(L.time > 20)) timed = false;
            for (const b of L.b) {
                const r = RADIUS[b[0]], y = b[3] || 90;
                if (b[1] - r < 0 || b[1] + r > W || y - r < 0 || y + r > H) inside = false;
                for (const k of L.k) if (b[1] + r > k[0] && b[1] - r < k[0] + k[2] && y + r > k[1] && y - r < k[1] + k[3]) clear = false;
            }
            for (const k of L.k) if (k[0] < 0 || k[1] < 0 || k[0] + k[2] > W || k[1] + k[3] > H) blocksIn = false;
            if (!L.b.length) inside = false;
        });
        expect(named, 'every level has a lowercase name');
        expect(timed, 'every level has a clock');
        expect(inside, 'every bubble starts inside the room');
        expect(blocksIn, 'every block is inside the room');
        expect(clear, 'no bubble starts inside a block');
        expect(S.LEVELS.some(L => L.k.some(k => k[4])) && S.LEVELS.some(L => L.k.some(k => !k[4])), 'there are glass and steel blocks');
        expect(new Set(S.LEVELS.map(L => JSON.stringify(L.b) + JSON.stringify(L.k))).size === S.LEVELS.length, 'no two levels are the same');
    }

    // =================================================================
    section('the bubbles');
    // =================================================================
    {
        const apex = size => {
            const b = { x: 320, y: H - RADIUS[size], vx: 85, vy: -S.BOUNCE[size], s: size };
            let top = b.y;
            for (let i = 0; i < 300; i++) { S.moveBubble([], b, S.DT); top = Math.min(top, b.y + RADIUS[size]); }
            return H - top;
        };
        const tops = [0, 1, 2, 3].map(apex);
        expect(tops[0] < tops[1] && tops[1] < tops[2] && tops[2] < tops[3], 'bigger bubbles bounce higher', tops.map(Math.round).join(' < '));
        expect(Math.abs(tops[3] - 280) < 8, 'the big one bounces to about 280 units', Math.round(tops[3]));
        // the same height every bounce: nothing gains or loses energy
        const b = { x: 100, y: 100, vx: 85, vy: 0, s: 2 };
        const peaks = [];
        let prev = b.vy;
        for (let i = 0; i < 60 * 12; i++) { S.moveBubble([], b, S.DT); if (prev < 0 && b.vy >= 0) peaks.push(Math.round(b.y)); prev = b.vy; }
        expect(peaks.length >= 4 && peaks.slice(1).every(p => Math.abs(p - peaks[1]) <= 2), 'a bubble keeps bouncing to the same height', peaks.join(','));
        // walls turn it round
        const w = { x: W - 30, y: 200, vx: 85, vy: 0, s: 1 };
        for (let i = 0; i < 40; i++) S.moveBubble([], w, S.DT);
        expect(w.vx < 0 && w.x <= W - RADIUS[1], 'the side wall sends it back');
        // a block: from above it bounces, from below it is sent down, from the side it turns
        const shelf = [{ x: 200, y: 250, w: 200, h: 14, hp: 1 }];
        const onTop = { x: 300, y: 200, vx: 0, vy: 0, s: 1 };
        let bounced = false;
        for (let i = 0; i < 60; i++) { S.moveBubble(shelf, onTop, S.DT); if (onTop.vy < 0) bounced = true; }
        expect(bounced && onTop.y < 250, 'it bounces off the top of a block');
        const under = { x: 300, y: 290, vx: 0, vy: -500, s: 1 };
        S.moveBubble(shelf, under, S.DT); S.moveBubble(shelf, under, S.DT);
        expect(under.vy > 0 && under.y >= 264 + RADIUS[1] - 0.01, 'it is sent down from the underside');
        const side = { x: 180, y: 257, vx: 85, vy: 0, s: 1 };
        for (let i = 0; i < 20; i++) S.moveBubble(shelf, side, S.DT);
        expect(side.vx < 0, 'and turned round by the side');
        // a long seeded game with bots never puts a bubble outside the room
        let ok = true, ticks = 0;
        for (let seed = 1; seed <= 6 && ok; seed++) {
            const s = S.newGame({ seed, level: (seed * 5) % S.LEVELS.length, players: 2 });
            const bots = [S.newBot(seed), S.newBot(seed + 50)];
            for (let i = 0; i < 60 * 60 && ok && !S.over(s); i++) { S.think(s, 0, bots[0]); S.think(s, 1, bots[1]); S.step(s); ticks++; if (!S.valid(s)) ok = false; }
        }
        expect(ok, 'six minutes of play never put a bubble or a player outside the room', ticks + ' steps');
    }

    // =================================================================
    section('splitting');
    // =================================================================
    {
        const s = playing();
        s.bubbles = [{ x: 300, y: 200, vx: 85, vy: 40, s: 2 }];
        S.split(s, 0, s.players[0]);
        const [a, b] = s.bubbles;
        expect(s.bubbles.length === 2 && a.s === 1 && b.s === 1, 'a hit splits a bubble into two of the next size');
        expect(a.vx < 0 && b.vx > 0 && a.vy < 0 && b.vy < 0, 'the halves go apart and hop up');
        expect(s.players[0].score === S.POINTS[2], 'the hit scores', s.players[0].score);
        s.bubbles = [{ x: 300, y: 200, vx: 85, vy: 0, s: 0 }];
        S.split(s, 0, s.players[0]);
        expect(s.bubbles.length === 0, 'the smallest one just pops');
        expect(S.POINTS[0] > S.POINTS[3], 'small ones are worth more than big ones');
        expect([0, 1, 2, 3].map(S.hitsFor).join() === '1,3,7,15', 'a bubble of size n takes 2^(n+1) - 1 hits');
        // the edge: the halves stay inside
        s.bubbles = [{ x: RADIUS[3], y: RADIUS[3], vx: 85, vy: 0, s: 3 }];
        S.split(s, 0, null);
        expect(s.bubbles.every(q => q.x >= RADIUS[q.s] && q.y >= RADIUS[q.s]), 'halves made in a corner start inside the room');
    }

    // =================================================================
    section('the ropes');
    // =================================================================
    {
        const s = playing();
        s.bubbles = [{ x: 600, y: 60, vx: 0, vy: 0, s: 0 }];
        s.freeze = 99;
        const p = s.players[0];
        press(s, 0); S.step(s);
        expect(p.ropes.length === 1 && s.ev.some(e => e.e === 'fire'), 'a press fires a rope');
        press(s, 0); S.step(s);
        expect(p.ropes.length === 1, 'only one rope at a time');
        const tip0 = p.ropes[0].tip;
        S.step(s);
        expect(p.ropes[0].tip < tip0, 'the rope grows upwards');
        steps(s, 70);
        expect(p.ropes.length === 0, 'and is gone once it reaches the ceiling');
        // a huge press counter from the wire is one shot, not many
        S.input(s, 0, 0, p.in.f + 1000); S.step(s);
        expect(p.ropes.length === 1, 'a press counter that jumps by a thousand fires once');
        steps(s, 70);
        // double
        p.weapon = 'double';
        press(s, 0); S.step(s); press(s, 0); S.step(s); press(s, 0); S.step(s);
        expect(p.ropes.length === 2, 'double lets two ropes fly');
        steps(s, 70);
        // sticky
        p.weapon = 'sticky';
        press(s, 0); S.step(s);
        steps(s, 60);
        expect(p.ropes.length === 1 && p.ropes[0].st > 0 && p.ropes[0].tip === 0, 'a sticky rope stays at the top');
        steps(s, Math.ceil(S.STICK_TIME * 60) + 2);
        expect(p.ropes.length === 0, 'for a few seconds');
        press(s, 0); S.step(s); steps(s, 60);
        press(s, 0); S.step(s);
        expect(p.ropes.length === 1 && p.ropes[0].st < 0, 'a stuck rope never blocks a new shot');
        p.weapon = 'rope'; p.ropes = [];
        // a hit
        s.freeze = 0;
        s.bubbles = [{ x: p.x, y: 120, vx: 0, vy: 0, s: 2 }];
        s.freeze = 99;
        press(s, 0);
        let n = 0;
        while (s.bubbles.length === 1 && n++ < 120) S.step(s);
        expect(s.bubbles.length === 2 && p.ropes.length === 0, 'a rope that meets a bubble splits it and is used up', n + ' steps');
        // steel stops it, glass breaks
        const g = playing();
        g.freeze = 99;
        g.bubbles = [{ x: 600, y: 30, vx: 0, vy: 0, s: 0 }];
        const q = g.players[0];
        g.blocks = [{ x: q.x - 40, y: 150, w: 80, h: 14, glass: false, hp: 1 }];
        press(g, 0);
        let lowest = H, gone = -1;
        for (let i = 0; i < 60; i++) { S.step(g); if (q.ropes[0]) lowest = Math.min(lowest, q.ropes[0].tip); else if (gone < 0) gone = i; }
        expect(lowest >= 164 - 0.01 && gone > 0 && gone < 40 && g.blocks[0].hp === 1, 'a rope stops under steel', 'never above ' + lowest.toFixed(1) + ', gone after ' + gone + ' steps');
        g.blocks = [{ x: q.x - 40, y: 150, w: 80, h: 14, glass: true, hp: 1 }];
        const before = q.score;
        press(g, 0); steps(g, 60);
        expect(g.blocks[0].hp === 0 && q.score > before && g.ev.some(e => e.e === 'glass'), 'and breaks glass');
        expect(S.ropeTop(g, q.x).top === 0, 'after which the way to the ceiling is open');
        // nobody fires while the level gets ready
        const r = S.newGame({ seed: 3 });
        press(r, 0); S.step(r);
        expect(r.ph === 'ready' && r.players[0].ropes.length === 0, 'no shots while the level gets ready');
    }

    // =================================================================
    section('the players');
    // =================================================================
    {
        const s = playing();
        const p = s.players[0];
        const lives = p.lives;
        s.bubbles = [{ x: p.x, y: H - 20, vx: 0, vy: 0, s: 1 }];
        S.step(s);
        expect(s.ph === 'dead' && p.lives === lives - 1 && s.why === 'hit', 'a bubble costs a life');
        steps(s, Math.ceil(S.DEAD_TIME * 60) + 1);
        expect(s.ph === 'ready' && s.lv === 0 && s.bubbles.length === S.LEVELS[0].b.length && s.bubbles[0].s === S.LEVELS[0].b[0][0], 'and the level starts again');
        while (s.ph !== 'play') S.step(s);
        expect(p.inv > 0, 'with a moment of grace');
        // shield
        const t = playing();
        const q = t.players[0];
        q.shield = true;
        t.bubbles = [{ x: q.x, y: H - 20, vx: 0, vy: 0, s: 1 }, { x: 600, y: 50, vx: 0, vy: 0, s: 0 }];
        S.step(t);
        expect(t.ph === 'play' && !q.shield && q.lives === S.LIVES && q.inv > 0, 'a shield takes one hit');
        // game over
        const o = playing({ lives: 1 });
        o.bubbles = [{ x: o.players[0].x, y: H - 20, vx: 0, vy: 0, s: 1 }];
        S.step(o); steps(o, 200);
        expect(o.ph === 'over' && S.over(o), 'no lives left is game over');
        // the clock
        const c = playing();
        c.bubbles = [{ x: 600, y: 40, vx: 0, vy: 0, s: 0 }];
        c.freeze = 1e6;
        const t0 = c.time;
        steps(c, 60);
        expect(Math.abs(t0 - c.time - 1) < 0.02, 'the clock counts down a second a second', (t0 - c.time).toFixed(3));
        c.time = 0.01;
        S.step(c);
        expect(c.ph === 'dead' && c.why === 'time' && c.players[0].lives === S.LIVES - 1, 'running out of time costs a life');
        // walking
        const w = playing();
        const a = w.players[0];
        w.bubbles = [{ x: 600, y: 40, vx: 0, vy: 0, s: 0 }]; w.freeze = 1e6;
        const x0 = a.x;
        S.input(w, 0, 2, a.in.f); steps(w, 60);
        expect(Math.abs(a.x - x0 - S.P_SPEED) < 1, 'a player walks 150 units a second', (a.x - x0).toFixed(1));
        S.input(w, 0, 1, a.in.f); steps(w, 600);
        expect(a.x === S.P_W / 2, 'and stops at the wall');
        w.blocks = [{ x: 200, y: 300, w: 20, h: 100, glass: false, hp: 1 }];
        S.input(w, 0, 2, a.in.f); steps(w, 300);
        expect(a.x <= 200 - S.P_W / 2 + 0.01, 'a block standing on the floor is a wall', a.x);
        // two players: one hit does not cost the other a life
        const d = playing({ players: 2 });
        const [p1, p2] = d.players;
        d.bubbles = [{ x: p1.x, y: H - 20, vx: 0, vy: 0, s: 1 }];
        S.step(d);
        expect(p1.lives === S.LIVES - 1 && p2.lives === S.LIVES, 'in co-op only the one who was hit loses a life');
        // a player with no lives sits out while the other plays on
        const e = playing({ players: 2, lives: 1 });
        e.bubbles = [{ x: e.players[0].x, y: H - 20, vx: 0, vy: 0, s: 1 }];
        S.step(e); steps(e, 200);
        expect(e.ph !== 'over' && e.players[0].out && !e.players[0].on && e.players[1].on, 'in co-op the game goes on while one of you has lives');
    }

    // =================================================================
    section('the items');
    // =================================================================
    {
        const s = playing();
        const p = s.players[0];
        s.bubbles = [{ x: 100, y: 100, vx: 85, vy: 0, s: 3 }, { x: 500, y: 100, vx: 85, vy: 0, s: 2 }];
        S.take(s, p, { t: 'dynamite', x: p.x });
        expect(s.bubbles.length === 8 + 4 && s.bubbles.every(b => b.s === 0), 'dynamite takes every bubble down to the smallest', s.bubbles.length);
        S.take(s, p, { t: 'freeze', x: p.x });
        const snap = JSON.stringify(s.bubbles);
        steps(s, 60);
        expect(JSON.stringify(s.bubbles) === snap, 'freeze stops the bubbles');
        steps(s, 60 * 5);
        expect(JSON.stringify(s.bubbles) !== snap, 'for a while');
        const lives = p.lives;
        S.take(s, p, { t: 'life', x: p.x });
        expect(p.lives === lives + 1, 'an extra life');
        S.take(s, p, { t: 'double', x: p.x });
        expect(p.weapon === 'double', 'double rope');
        S.take(s, p, { t: 'sticky', x: p.x });
        expect(p.weapon === 'sticky', 'sticky rope');
        S.take(s, p, { t: 'shield', x: p.x });
        expect(p.shield, 'shield');
        // dropping, falling, picking up, running out
        const d = playing();
        d.bubbles = [{ x: 600, y: 40, vx: 0, vy: 0, s: 0 }]; d.freeze = 1e6;
        d.items = [{ x: 100, y: 50, vy: 0, t: 'life', life: 7 }];
        steps(d, 90);
        expect(d.items[0].y === H - 6, 'an item falls to the floor');
        steps(d, 60 * 7);
        expect(!d.items.length, 'and is gone after a while');
        d.items = [{ x: d.players[0].x, y: 50, vy: 0, t: 'life', life: 7 }];
        const l2 = d.players[0].lives;
        steps(d, 90);
        expect(!d.items.length && d.players[0].lives === l2 + 1 && d.ev.some(e => e.e === 'item' && e.t === 'life'), 'walking over an item takes it');
        d.blocks = [{ x: 50, y: 200, w: 100, h: 14, glass: false, hp: 1 }];
        d.items = [{ x: 100, y: 50, vy: 0, t: 'life', life: 7 }];
        steps(d, 60);
        expect(d.items[0].y === 194, 'an item lands on a block');
        // drops are seeded: the same seed drops the same things
        const drops = seed => { const g = playing({ seed }); const out = []; for (let i = 0; i < 200; i++) { g.items = []; g.bubbles = [{ x: 300, y: 200, vx: 0, vy: 0, s: 0 }]; S.split(g, 0, null); out.push(g.items.map(it => it.t).join()); } return out.join('|'); };
        expect(drops(11) === drops(11) && drops(11) !== drops(12), 'what drops depends on the seed and nothing else');
        const all = new Set(); { const g = playing({ seed: 5 }); for (let i = 0; i < 2000; i++) { g.items = []; S.dropItem(g, 100, 100); all.add(g.items[0].t); } }
        expect(S.ITEMS.every(t => all.has(t)), 'every one of the six items drops', [...all].join(' '));
    }

    // =================================================================
    section('progression');
    // =================================================================
    {
        const s = playing();
        const p = s.players[0];
        s.bubbles = [{ x: p.x, y: 300, vx: 0, vy: 0, s: 0 }];
        s.freeze = 99;
        const time = s.time, score = p.score;
        press(s, 0);
        let n = 0;
        while (s.ph === 'play' && n++ < 200) S.step(s);
        expect(s.ph === 'clear' && s.bonus === Math.ceil(s.time) * 10 && s.bonus > 0 && s.bonus <= Math.ceil(time) * 10, 'clearing a level pays ten points a second left', s.bonus);
        expect(p.score === score + S.POINTS[0] + s.bonus, 'on top of the hits');
        steps(s, Math.ceil(S.CLEAR_TIME * 60) + 1);
        expect(s.lv === 1 && s.ph === 'ready', 'and the next level loads');
        const last = S.newGame({ seed: 2, level: S.LEVELS.length - 1 });
        while (last.ph !== 'play') S.step(last);
        last.bubbles = [];
        S.step(last); steps(last, 200);
        expect(last.ph === 'win' && S.over(last), 'clearing the last level wins the game');
        const st = S.newGame({ seed: 1, level: 9 });
        expect(st.lv === 9 && st.start === 9, 'a game can start at a later level');
        expect(S.newGame({ seed: 1, level: 99 }).lv === S.LEVELS.length - 1 && S.newGame({ seed: 1, level: -4 }).lv === 0, 'and a silly start level is clamped');
    }

    // =================================================================
    section('the wire');
    // =================================================================
    {
        const host = S.newGame({ seed: 99, level: 4, players: 2 });
        const bots = [S.newBot(1), S.newBot(2)];
        for (let i = 0; i < 60 * 8; i++) { S.think(host, 0, bots[0]); S.think(host, 1, bots[1]); S.step(host); }
        const guest = S.newGame({ seed: 99, level: 0, players: 2, puppet: true });
        const d = JSON.parse(JSON.stringify(S.snapshot(host)));
        expect(S.applySnapshot(guest, d), 'a guest takes the host\'s snapshot');
        expect(JSON.stringify(S.snapshot(guest)) === JSON.stringify(S.snapshot(host)), 'and then has the same game', JSON.stringify(S.snapshot(host)).length + ' bytes');
        // the guest carries the picture on between snapshots without deciding anything
        const n0 = guest.bubbles.length, lives = guest.players.map(p => p.lives).join();
        guest.bubbles.push({ x: guest.players[0].x, y: H - 20, vx: 0, vy: 0, s: 1 });
        guest.players[0].ropes = [{ x: guest.bubbles[0].x, tip: 10, st: -1, sticky: false }];
        steps(guest, 30);
        expect(guest.bubbles.length === n0 + 1 && guest.players.map(p => p.lives).join() === lives, 'a guest moves things along but never splits or kills');
        // what is malformed changes nothing
        const keep = JSON.stringify(S.snapshot(guest));
        const bad = [
            null, 5, {}, Object.assign({}, d, { v: 99 }), Object.assign({}, d, { lv: 77 }), Object.assign({}, d, { ph: 'cheat' }),
            Object.assign({}, d, { P: d.P.slice(0, 1) }), Object.assign({}, d, { B: [1, 2, 3] }), Object.assign({}, d, { B: [1e9, 2, 3, 4, 1] }),
            Object.assign({}, d, { B: [100, 100, 0, 0, 9] }), Object.assign({}, d, { K: '1' }), Object.assign({}, d, { I: [[1, 2, 3, 99, 1]] }),
            Object.assign({}, d, { P: d.P.map((q, i) => (i ? q : q.map((v, j) => (j === 2 ? 1000 : v)))) }),
            Object.assign({}, d, { P: d.P.map((q, i) => (i ? q : q.map((v, j) => (j === 10 ? [[1, 2, 3], [1, 2, 3], [1, 2, 3]] : v)))) }),
            Object.assign({}, d, { tm: NaN }), Object.assign({}, d, { k: -1 })
        ];
        expect(bad.every(b => S.applySnapshot(guest, b) === false), 'malformed snapshots are refused', bad.length + ' kinds');
        expect(JSON.stringify(S.snapshot(guest)) === keep, 'and leave the guest\'s game as it was');
        // the same seed and the same inputs: the same game
        const run = seed => { const g = S.newGame({ seed, level: 2, players: 2 }); const b = [S.newBot(seed), S.newBot(seed + 1)]; for (let i = 0; i < 60 * 30; i++) { S.think(g, 0, b[0]); S.think(g, 1, b[1]); S.step(g); } return JSON.stringify(S.snapshot(g)); };
        expect(run(5) === run(5), 'the same seed plays the same game');
        expect(run(5) !== run(6), 'and another seed another one');
    }

    // =================================================================
    section('the bot');
    // =================================================================
    {
        // levels 1 to 5, one after another, on every seed
        const SEEDS = 16;
        let made = 0, worst = 0;
        const fails = [];
        for (let seed = 1; seed <= SEEDS; seed++) {
            const s = S.newGame({ seed: seed * 7919, level: 0, players: 1 });
            const bot = S.newBot(seed);
            let n = 0;
            while (s.lv < 5 && !S.over(s) && n++ < 60 * 60 * 20) { S.think(s, 0, bot); S.step(s); }
            if (s.lv >= 5) { made++; worst = Math.max(worst, S.LIVES - s.players[0].lives); } else fails.push(seed + ':' + s.lv + ':' + s.ph);
        }
        expect(made === SEEDS, 'the bot clears levels 1 to 5 on all ' + SEEDS + ' seeds', 'most lives lost ' + worst + (fails.length ? ', failed ' + fails.join(' ') : ''));
        // every level is cleared from a fresh start on some seed: they can all be done
        const stuck = [];
        S.LEVELS.forEach((L, lv) => {
            let done = false;
            for (let seed = 1; seed <= 8 && !done; seed++) {
                const s = S.newGame({ seed: seed * 31 + lv, level: lv, players: 1, lives: 1 });
                const bot = S.newBot(seed);
                let n = 0;
                while (s.ph !== 'clear' && !S.over(s) && n++ < 60 * 400) { S.think(s, 0, bot); S.step(s); }
                done = s.ph === 'clear';
            }
            if (!done) stuck.push(lv + 1);
        });
        expect(!stuck.length, 'every one of the ' + S.LEVELS.length + ' levels can be cleared', stuck.length ? 'not: ' + stuck.join(',') : undefined);
        // whole games, alone and two together, always end with a real result
        const ends = [];
        let sane = true;
        for (let seed = 1; seed <= 8; seed++) {
            const two = seed % 2 === 0;
            const s = S.newGame({ seed: seed * 104729, level: (seed * 3) % 12, players: two ? 2 : 1 });
            const bots = [S.newBot(seed), S.newBot(seed + 100)];
            let n = 0;
            const cap = 60 * 60 * 60;
            while (!S.over(s) && n++ < cap) { S.think(s, 0, bots[0]); if (two) S.think(s, 1, bots[1]); S.step(s); }
            if (!S.over(s) || !S.valid(s)) sane = false;
            ends.push(s.ph + '@' + (s.lv + 1) + ':' + S.total(s));
        }
        expect(sane, 'eight whole games with bots, alone and in co-op, all end in a win or a game over', ends.join(' '));
    }
} catch (e) {
    failures++;
    console.error(e);
}
console.log('\n' + (failures ? failures + ' of ' + checks + ' popz checks FAILED' : checks + ' popz checks passed'));
process.exit(failures ? 1 : 0);
