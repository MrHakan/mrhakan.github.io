// ===================================================================
// tavla 98 — the rules: the board, the dice, a turn, a match, the bots
//
// No DOM and no clocks, so node (check-tavla.mjs), the host and a test all
// get the same game out of the same seed.
//
// The board is 24 points, index 0..23. Seat 0 (white) runs from 23 down to
// 0 and bears off below 0; seat 1 (red) runs from 0 up to 23 and bears off
// above 23. pos.p[i] > 0 is white checkers, < 0 is red ones. Rules code
// thinks in "rel" points: rel 0 is your own 1-point, rel 23 your 24-point,
// rel 24 the bar and rel -1 off the board, whoever you are.
//
// Coffee house rules: no doubling cube, a mars (gammon, and a backgammon
// too) is worth 2, a plain win 1. The first game starts with one die each;
// after that the last game's winner opens.
// ===================================================================
(function (root) {
    'use strict';

    const BAR = 24, OFF = -1, N = 15;
    const LEVELS = ['easy', 'normal', 'hard'];

    // ---------------------------------------------------------------
    // a small seeded random, its whole state one number
    // ---------------------------------------------------------------
    function rnd(o, k) {
        o[k] = (o[k] + 0x6D2B79F5) >>> 0;
        let t = o[k];
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const die = s => 1 + Math.floor(rnd(s, 'r') * 6);

    // ---------------------------------------------------------------
    // positions
    // ---------------------------------------------------------------
    const abs = (pl, r) => (pl ? 23 - r : r);
    function own(pos, pl, r) { const v = pos.p[pl ? 23 - r : r]; return pl ? (v < 0 ? -v : 0) : (v > 0 ? v : 0); }
    function foe(pos, pl, r) { const v = pos.p[pl ? 23 - r : r]; return pl ? (v > 0 ? v : 0) : (v < 0 ? -v : 0); }
    function startPos() {
        const p = new Array(24).fill(0);
        p[23] = 2; p[12] = 5; p[7] = 3; p[5] = 5;
        p[0] = -2; p[11] = -5; p[16] = -3; p[18] = -5;
        return { p, bar: [0, 0], off: [0, 0] };
    }
    const clonePos = pos => ({ p: pos.p.slice(), bar: pos.bar.slice(), off: pos.off.slice() });
    const posKey = pos => pos.p.join(',') + '|' + pos.bar.join(',') + '|' + pos.off.join(',');
    function count(pos, pl) {
        let n = pos.bar[pl] + pos.off[pl];
        for (let i = 0; i < 24; i++) { const v = pos.p[i]; if (pl ? v < 0 : v > 0) n += pl ? -v : v; }
        return n;
    }
    function pips(pos, pl) {
        let n = pos.bar[pl] * 25;
        for (let r = 0; r < 24; r++) n += own(pos, pl, r) * (r + 1);
        return n;
    }
    function highest(pos, pl) {
        if (pos.bar[pl]) return BAR;
        for (let r = 23; r >= 0; r--) if (own(pos, pl, r)) return r;
        return OFF;
    }
    const allHome = (pos, pl) => highest(pos, pl) < 6;
    // contact: somebody still has to get past somebody
    function contact(pos) {
        let w = -1, rd = 24;
        if (pos.bar[0]) w = 24;
        else for (let i = 23; i >= 0; i--) if (pos.p[i] > 0) { w = i; break; }
        if (pos.bar[1]) rd = -1;
        else for (let i = 0; i < 24; i++) if (pos.p[i] < 0) { rd = i; break; }
        return w > rd;
    }
    const dest = (from, d) => (from === BAR ? 24 - d : (from - d < 0 ? OFF : from - d));

    // every point a checker can leave with this die
    function stepsFor(pos, pl, d) {
        const out = [];
        if (pos.bar[pl]) { if (foe(pos, pl, 24 - d) <= 1) out.push(BAR); return out; }
        const hi = highest(pos, pl), home = hi < 6;
        for (let r = hi; r >= 0; r--) {
            if (!own(pos, pl, r)) continue;
            const t = r - d;
            if (t >= 0) { if (foe(pos, pl, t) <= 1) out.push(r); }
            else if (home && (t === -1 || r === hi)) out.push(r);
        }
        return out;
    }
    // moves one checker; true if it hit
    function applyStep(pos, pl, from, d) {
        const to = dest(from, d), sg = pl ? -1 : 1;
        if (from === BAR) pos.bar[pl]--; else pos.p[abs(pl, from)] -= sg;
        if (to === OFF) { pos.off[pl]++; return false; }
        const a = abs(pl, to);
        let hit = false;
        if (pos.p[a] === -sg) { pos.p[a] = 0; pos.bar[1 - pl]++; hit = true; }
        pos.p[a] += sg;
        return hit;
    }
    function without(rem, d) { const i = rem.indexOf(d), o = rem.slice(); if (i >= 0) o.splice(i, 1); return o; }
    const uniq = rem => rem.filter((d, i) => rem.indexOf(d) === i);

    // how many of these dice can be played from here, at most
    function maxUse(pos, pl, rem) {
        if (!rem.length) return 0;
        let best = 0;
        for (const d of uniq(rem)) {
            for (const from of stepsFor(pos, pl, d)) {
                const c = clonePos(pos);
                applyStep(c, pl, from, d);
                const v = 1 + maxUse(c, pl, without(rem, d));
                if (v === rem.length) return v;
                if (v > best) best = v;
            }
        }
        return best;
    }
    // the single moves that start a legal turn: use as many dice as can be
    // used, and the larger one if only one of two can be
    function legalSteps(pos, pl, rem) {
        const m = maxUse(pos, pl, rem);
        if (!m) return [];
        let out = [];
        for (const d of uniq(rem)) {
            for (const from of stepsFor(pos, pl, d)) {
                const c = clonePos(pos);
                applyStep(c, pl, from, d);
                if (1 + maxUse(c, pl, without(rem, d)) === m) out.push({ from, die: d, to: dest(from, d) });
            }
        }
        if (m === 1 && rem.length === 2 && rem[0] !== rem[1]) {
            const hi = Math.max(rem[0], rem[1]);
            if (out.some(s => s.die === hi)) out = out.filter(s => s.die === hi);
        }
        return out;
    }
    // every different position a whole turn can end in, with one way there
    function turnOptions(pos, pl, rem) {
        const leaves = new Map(), seen = new Set();
        let maxLen = 0;
        (function dfs(p, r, seq) {
            const k = posKey(p) + '#' + r.join('');
            if (seen.has(k)) return;
            seen.add(k);
            let moved = false;
            for (const d of uniq(r)) {
                for (const from of stepsFor(p, pl, d)) {
                    moved = true;
                    const c = clonePos(p);
                    const hit = applyStep(c, pl, from, d);
                    dfs(c, without(r, d), seq.concat([{ from, die: d, to: dest(from, d), hit }]));
                }
            }
            if (!moved) {
                if (seq.length > maxLen) maxLen = seq.length;
                const pk = posKey(p);
                const was = leaves.get(pk);
                // one checker off with a 5 or a 6 is the same position; when
                // only one die can be played it has to be the larger one
                if (!was || was.seq.length < seq.length || (seq.length === 1 && was.seq.length === 1 && seq[0].die > was.seq[0].die)) leaves.set(pk, { seq, pos: p });
            }
        })(pos, rem, []);
        let out = [...leaves.values()].filter(o => o.seq.length === maxLen);
        if (maxLen === 1 && rem.length === 2 && rem[0] !== rem[1]) {
            const hi = Math.max(rem[0], rem[1]);
            if (out.some(o => o.seq[0].die === hi)) out = out.filter(o => o.seq[0].die === hi);
        }
        return out;
    }

    // ---------------------------------------------------------------
    // a match
    // ---------------------------------------------------------------
    function newMatch(o) {
        o = o || {};
        const seed = (o.seed >>> 0) || 1;
        const target = [1, 3, 5].includes(+o.target) ? +o.target : 5;
        const s = {
            v: 0, seed, r: seed, br: (seed * 2654435761) >>> 0, target, score: [0, 0], game: 0,
            pos: startPos(), turn: 0, dice: [], rem: [], phase: 'roll', turnStart: null, steps: [],
            log: [], opening: null, result: null, mc: 0, last: null, noMove: false, games: []
        };
        newGame(s);
        return s;
    }
    function newGame(s) {
        s.game++;
        s.pos = startPos();
        s.log = [];
        s.result = null;
        s.last = null;
        if (s.game === 1) {
            let a, b;
            do { a = die(s); b = die(s); } while (a === b);
            s.opening = [a, b];
            s.turn = a > b ? 0 : 1;
            beginTurn(s, [a, b]);
        } else {
            s.opening = null;
            s.turn = s.games.length ? s.games[s.games.length - 1].winner : 0;
            s.phase = 'roll';
            s.dice = []; s.rem = []; s.steps = []; s.turnStart = null; s.noMove = false;
        }
        s.v++;
    }
    function beginTurn(s, dice) {
        s.dice = dice.slice();
        s.rem = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice.slice();
        s.phase = 'move';
        s.turnStart = clonePos(s.pos);
        s.steps = [];
        s.noMove = legalSteps(s.pos, s.turn, s.rem).length === 0;
    }
    const legal = s => (s.phase === 'move' ? legalSteps(s.pos, s.turn, s.rem) : []);

    function finishGame(s, pl) {
        const loser = 1 - pl;
        const mars = s.pos.off[loser] === 0;
        const pts = mars ? 2 : 1;
        s.score[pl] += pts;
        s.result = { winner: pl, pts, mars, game: s.game };
        s.games.push({ winner: pl, pts, mars });
        s.phase = s.score[pl] >= s.target ? 'match' : 'over';
        s.rem = [];
    }
    function closeTurn(s) {
        s.log.push({ pl: s.turn, dice: s.dice.slice(), steps: s.steps.map(x => [x.from, x.to, x.hit ? 1 : 0]) });
        if (s.log.length > 120) s.log.shift();
    }

    // one action by one seat; returns null if it happened, else why not
    function act(s, pl, a) {
        if (!a || typeof a !== 'object') return 'nothing to do';
        const t = a.t;
        if (t === 'next') {
            if (s.phase !== 'over') return 'the game is not over';
            newGame(s);
            return null;
        }
        if (pl !== s.turn) return 'not your turn';
        if (t === 'roll') {
            if (s.phase !== 'roll') return 'not the time to roll';
            beginTurn(s, [die(s), die(s)]);
            s.v++;
            return null;
        }
        if (s.phase !== 'move') return 'roll first';
        if (t === 'move') {
            const from = +a.from, d = +a.die;
            const ok = legalSteps(s.pos, pl, s.rem).find(x => x.from === from && x.die === d);
            if (!ok) return 'that move is not allowed';
            const hit = applyStep(s.pos, pl, from, d);
            s.rem = without(s.rem, d);
            s.steps.push({ from, die: d, to: ok.to, hit });
            s.mc++;
            s.last = { pl, from, to: ok.to, hit, mc: s.mc };
            if (s.pos.off[pl] === N) { closeTurn(s); finishGame(s, pl); }
            s.v++;
            return null;
        }
        if (t === 'undo') {
            if (!s.steps.length) return 'nothing to undo';
            const keep = s.steps.slice(0, -1);
            s.pos = clonePos(s.turnStart);
            s.rem = s.dice[0] === s.dice[1] ? [s.dice[0], s.dice[0], s.dice[0], s.dice[0]] : s.dice.slice();
            s.steps = [];
            for (const x of keep) { applyStep(s.pos, pl, x.from, x.die); s.rem = without(s.rem, x.die); s.steps.push(x); }
            s.mc++;
            s.last = null;
            s.v++;
            return null;
        }
        if (t === 'done') {
            if (legalSteps(s.pos, pl, s.rem).length) return 'you still have a move';
            closeTurn(s);
            s.turn = 1 - s.turn;
            s.phase = 'roll';
            s.rem = []; s.steps = []; s.turnStart = null; s.noMove = false;
            s.v++;
            return null;
        }
        return 'unknown action';
    }

    // ---------------------------------------------------------------
    // notation: 24/18 13/9* bar/22 6/off, from the mover's side
    // ---------------------------------------------------------------
    const ptName = r => (r === BAR ? 'bar' : r === OFF ? 'off' : String(r + 1));
    function stepText(x) { return ptName(x.from !== undefined ? x.from : x[0]) + '/' + ptName(x.to !== undefined ? x.to : x[1]) + ((x.hit || x[2]) ? '*' : ''); }
    function turnText(e) { return e.dice.join('-') + ': ' + (e.steps.length ? e.steps.map(stepText).join(' ') : 'no move'); }

    // ---------------------------------------------------------------
    // the bots
    // ---------------------------------------------------------------
    // how good a position is for pl, minus how good it is for the other one
    function side(pos, pl, race) {
        const op = 1 - pl;
        let v = pos.off[pl] * 3;
        if (race) {
            // waste: checkers piled deep in the home board bear off slowly
            for (let r = 0; r < 6; r++) { const n = own(pos, pl, r); if (n > 3) v -= (n - 3) * 0.4; }
            return v;
        }
        // the other side's checkers in pl's numbering: a checker at q hits a blot at r < q
        const shooters = [];
        if (pos.bar[op]) shooters.push(24);
        for (let r = 0; r < 24; r++) if (foe(pos, pl, r)) shooters.push(r);
        let run = 0, prime = 0, home = 0, anchor = 0;
        for (let r = 0; r < 24; r++) {
            const n = own(pos, pl, r);
            if (n >= 2) {
                v += 1;
                if (r < 6) { home++; v += 2.2; }
                if (r >= 3 && r <= 7) v += 1;
                if (r >= 18) anchor = 1;
                run++; if (run > prime) prime = run;
                if (n > 3) v -= (n - 3) * 0.35;
            } else run = 0;
            if (n === 1) {
                let direct = 0, indirect = 0, seenD = 0;
                for (const q of shooters) {
                    const dd = q - r;
                    if (dd >= 1 && dd <= 6) { if (!(seenD & (1 << dd))) { seenD |= 1 << dd; direct++; } }
                    else if (dd >= 7 && dd <= 12) indirect++;
                }
                if (direct || indirect) {
                    const p = Math.min(0.9, (direct * 11 + Math.min(indirect, 3) * 3) / 36);
                    v -= p * (3 + (24 - r) * 0.42);
                }
            }
        }
        v += prime * prime * 0.55 + anchor * 2;
        v += pos.bar[op] * (2 + home * 1.4);
        return v;
    }
    function evaluate(pos, pl) {
        const race = !contact(pos);
        const pip = (pips(pos, 1 - pl) - pips(pos, pl)) * (race ? 1 : 0.55);
        return pip + side(pos, pl, race) - side(pos, 1 - pl, race);
    }
    const ROLLS = [];
    for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push({ d: [a, b], w: a === b ? 1 / 36 : 2 / 36 });

    // what the bot plays with these dice: a list of {from, die}
    function botTurn(s, pl, level) {
        const opts = turnOptions(s.pos, pl, s.rem);
        if (!opts.length || !opts[0].seq.length) return [];
        const r = () => rnd(s, 'br');
        let pick;
        if (opts.length === 1) pick = opts[0];
        else if (level === 'easy') {
            // now and then whatever, otherwise a sloppy look at the board
            if (r() < 0.3) pick = opts[Math.floor(r() * opts.length)];
            else {
                let bv = -Infinity;
                for (const o of opts) { const v = evaluate(o.pos, pl) + r() * 9; if (v > bv) { bv = v; pick = o; } }
            }
        } else {
            const scored = opts.map(o => ({ o, v: evaluate(o.pos, pl) }));
            scored.sort((x, y) => y.v - x.v);
            pick = scored[0].o;
            if (level === 'hard' && contact(s.pos)) {
                // one ply: for the best few, the other side's best answer to every roll
                let best = -Infinity;
                for (const c of scored.slice(0, 6)) {
                    let e = 0;
                    for (const roll of ROLLS) {
                        const rem = roll.d[0] === roll.d[1] ? [roll.d[0], roll.d[0], roll.d[0], roll.d[0]] : roll.d;
                        const answers = turnOptions(c.o.pos, 1 - pl, rem);
                        let worst = Infinity;
                        if (!answers.length || !answers[0].seq.length) worst = evaluate(c.o.pos, pl);
                        else for (const a of answers) { const v = evaluate(a.pos, pl); if (v < worst) worst = v; }
                        e += roll.w * worst;
                    }
                    e = e * 0.8 + c.v * 0.2;
                    if (e > best) { best = e; pick = c.o; }
                }
            }
        }
        return pick.seq.map(x => ({ from: x.from, die: x.die }));
    }
    // the bear-off a person would make without thinking about it, if there is one
    function obviousBearOff(s) {
        if (s.phase !== 'move' || contact(s.pos) || !allHome(s.pos, s.turn)) return null;
        const opts = turnOptions(s.pos, s.turn, s.rem);
        if (!opts.length || !opts[0].seq.length) return null;
        let best = null, bv = -Infinity;
        for (const o of opts) { const v = o.pos.off[s.turn] * 100 - pips(o.pos, s.turn) + side(o.pos, s.turn, true); if (v > bv) { bv = v; best = o; } }
        return best.seq.map(x => ({ from: x.from, die: x.die }));
    }

    // a copy for the wire: plain data, nothing shared
    const snapshot = s => JSON.parse(JSON.stringify(s));
    // a guest checks the shape of what arrives before drawing it
    function validSnapshot(x) {
        if (!x || typeof x !== 'object' || !x.pos || !Array.isArray(x.pos.p) || x.pos.p.length !== 24) return false;
        if (!Array.isArray(x.pos.bar) || !Array.isArray(x.pos.off) || !x.pos.p.every(Number.isInteger)) return false;
        if (!Array.isArray(x.score) || !Array.isArray(x.rem) || !Array.isArray(x.log) || !Array.isArray(x.dice)) return false;
        if (!['roll', 'move', 'over', 'match'].includes(x.phase) || (x.turn !== 0 && x.turn !== 1)) return false;
        return count(x.pos, 0) === N && count(x.pos, 1) === N;
    }

    root.TAVLA_SIM = {
        BAR, OFF, N, LEVELS, ROLLS,
        rnd, startPos, clonePos, posKey, own, foe, abs, count, pips, highest, allHome, contact, dest,
        stepsFor, applyStep, maxUse, legalSteps, turnOptions,
        newMatch, newGame, act, legal, ptName, stepText, turnText,
        evaluate, botTurn, obviousBearOff, snapshot, validSnapshot
    };
})(typeof window !== 'undefined' ? window : globalThis);
