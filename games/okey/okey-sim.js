// ===================================================================
// okey 98 — the rules, the bots and what a seat is allowed to see
//
// No page in here, so node runs it (.github/scripts/check-okey.mjs). The
// window, the wire and the picture are in okey.js.
//
// 106 tiles: four colours x 1-13 x 2, and two false jokers. A tile is a
// number: 0-103 are colour (id / 26 | 0) and number (id % 13 + 1), 104 and
// 105 are the false jokers. A face is colour * 13 + number - 1 (0-51); the
// okey (the wild) has no face, it is -1 wherever faces are counted.
//
// Everything that changes lives in one plain object (the match), so it
// saves as JSON and the rng's state goes with it: the same seed and the
// same moves give the same match, on the host and in node.
// ===================================================================
(function (root) {
    'use strict';

    const COLORS = ['red', 'yellow', 'blue', 'black'];
    const SEATS = 4;
    const FALSE_JOKERS = [104, 105];
    const isFalse = id => id >= 104;
    const colorOf = id => (id / 26) | 0;
    const numOf = id => (id % 13) + 1;

    // mulberry32, with its state kept on the match so a save carries it
    function nextRand(o) {
        o.rs = (o.rs + 0x6D2B79F5) >>> 0;
        let t = o.rs;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function hash(a, b) {
        let h = (a >>> 0) ^ Math.imul(b >>> 0, 0x9E3779B1);
        h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
        h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
        return (h ^ (h >>> 16)) >>> 0;
    }

    // ---------------------------------------------------------------
    // faces
    // ---------------------------------------------------------------
    function okeyOf(ind) { return { c: colorOf(ind), n: numOf(ind) % 13 + 1 }; }
    function isWild(id, ok) { return !isFalse(id) && colorOf(id) === ok.c && numOf(id) === ok.n; }
    // the face a tile plays as: a false joker plays as the okey's own face
    function faceOf(id, ok) {
        if (isFalse(id)) return ok.c * 13 + ok.n - 1;
        if (isWild(id, ok)) return -1;
        return colorOf(id) * 13 + numOf(id) - 1;
    }
    // what a tile is worth left in your hand at the end of a 101 hand
    function handValue(id, ok) {
        if (isWild(id, ok)) return 101;
        return isFalse(id) ? ok.n : numOf(id);
    }
    function tileName(id, ok) {
        if (isFalse(id)) return 'false joker';
        const s = COLORS[colorOf(id)] + ' ' + numOf(id);
        return ok && isWild(id, ok) ? s + ' (okey)' : s;
    }
    const isTwin = (id, ind) => !isFalse(id) && id !== ind && colorOf(id) === colorOf(ind) && numOf(id) === numOf(ind);

    function countsOf(ids, ok) {
        const cnt = new Array(52).fill(0);
        let w = 0;
        for (const id of ids) {
            const f = faceOf(id, ok);
            if (f < 0) w++; else cnt[f]++;
        }
        return { cnt, w };
    }

    // ---------------------------------------------------------------
    // one meld on its own: a run, a group or a pair
    //
    // run    one colour, consecutive, 3 to 13 long. A 1 comes before the 2 or
    //        after the 13 (12-13-1 is fine, 13-1-2 is not)
    // group  one number in 3 or 4 different colours
    // pair   two of the same tile (101's pairs opening, and seven pairs)
    // An okey stands in for anything; where it could be read two ways it is
    // read the way worth more. A tile counts its number (the 1 after a 13
    // counts 1), an okey what it stands for.
    // ---------------------------------------------------------------
    function meldInfo(ids, ok, allowPair) {
        if (!Array.isArray(ids)) return null;
        const n = ids.length;
        const wild = [], real = [];
        for (const id of ids) (faceOf(id, ok) < 0 ? wild : real).push(id);
        if (n === 2) {
            if (!allowPair) return null;
            if (real.length < 2 || faceOf(real[0], ok) === faceOf(real[1], ok)) {
                const f = real.length ? faceOf(real[0], ok) : -1;
                return { kind: 'pair', value: f < 0 ? 0 : (f % 13 + 1) * 2, order: real.concat(wild) };
            }
            return null;
        }
        if (n < 3 || n > 13 || !real.length) return null;
        const faces = real.map(id => faceOf(id, ok));
        let best = null;
        // group
        if (n <= 4) {
            const num = faces[0] % 13;
            const cols = new Set();
            let good = true;
            for (const f of faces) { const c = (f / 13) | 0; if (f % 13 !== num || cols.has(c)) { good = false; break; } cols.add(c); }
            if (good) best = { kind: 'group', value: (num + 1) * n, order: real.slice().sort((a, b) => faceOf(a, ok) - faceOf(b, ok)).concat(wild), num: num + 1 };
        }
        // run
        const c = (faces[0] / 13) | 0;
        if (faces.every(f => ((f / 13) | 0) === c)) {
            let run = null;
            for (const high of [false, true]) {
                const pos = faces.map(f => { const v = f % 13 + 1; return v === 1 && high ? 14 : v; });
                if (high && !pos.includes(14)) continue;
                if (new Set(pos).size !== pos.length) continue;
                const lo = Math.min(...pos), hi = Math.max(...pos);
                const gaps = hi - lo + 1 - pos.length;
                if (gaps > wild.length) continue;
                const extra = wild.length - gaps;
                for (let up = 0; up <= extra; up++) {
                    const s = lo - (extra - up), e = hi + up;
                    if (s < 1 || e > 14 || e - s + 1 > 13) continue;
                    let v = 0;
                    for (let p = s; p <= e; p++) v += p === 14 ? 1 : p;
                    if (!run || v > run.value) run = { s, e, value: v, high };
                }
            }
            if (run && (!best || run.value > best.value)) {
                const byPos = new Map();
                for (const id of real) { const v = faceOf(id, ok) % 13 + 1; byPos.set(v === 1 && run.high ? 14 : v, id); }
                const order = [];
                let wi = 0;
                for (let p = run.s; p <= run.e; p++) order.push(byPos.has(p) ? byPos.get(p) : wild[wi++]);
                best = { kind: 'run', value: run.value, order, color: c, s: run.s, e: run.e };
            }
        }
        return best;
    }

    // ---------------------------------------------------------------
    // the search: the most a hand can put into melds
    //
    // Faces are taken in order (colour by colour, 1 to 13). The first face
    // left is either deadwood or in a meld, and every meld it can be in is
    // tried: groups with the colours after it, runs upwards from it (okeys
    // below it, since everything lower in its colour is already gone) and,
    // for a 1, runs that end in it after the 13. `pts` scores by face value
    // (101's opening), otherwise by the number of tiles. Memoised on the
    // counts, so one memo serves a whole turn's worth of questions.
    // ---------------------------------------------------------------
    const EMPTY = { s: 0, meld: null, rest: null };
    function search(cnt, w, pts, memo, bias) {
        let f = 0;
        while (f < 52 && !cnt[f]) f++;
        if (f === 52) return EMPTY;
        let key = f + ':' + w;
        for (let i = f; i < 52; i++) key += cnt[i];
        const hit = memo.get(key);
        if (hit) return hit;
        const c = (f / 13) | 0, n = f % 13 + 1;
        cnt[f]--;
        const skip = search(cnt, w, pts, memo, bias);
        cnt[f]++;
        let best = { s: skip.s, meld: null, rest: skip };
        const consider = (meld, score, wUsed) => {
            for (const x of meld) if (x >= 0) cnt[x]--;
            const r = search(cnt, w - wUsed, pts, memo, bias);
            for (const x of meld) if (x >= 0) cnt[x]++;
            const s = r.s + score;
            if (s > best.s + 1e-9) best = { s, meld: meld.slice(), rest: r };
        };
        const tieRun = bias === 'run' ? 0.01 : 0, tieGroup = bias === 'group' ? 0.01 : 0;
        // groups: f and some of the later colours, okeys for the rest
        const others = [];
        for (let k = c + 1; k < 4; k++) if (cnt[k * 13 + n - 1] > 0) others.push(k * 13 + n - 1);
        for (let mask = 0; mask < (1 << others.length); mask++) {
            const g = [f];
            for (let i = 0; i < others.length; i++) if (mask & (1 << i)) g.push(others[i]);
            for (let u = 0; u <= w; u++) {
                const len = g.length + u;
                if (len < 3 || len > 4) continue;
                const meld = g.slice();
                for (let i = 0; i < u; i++) meld.push(-1);
                consider(meld, (pts ? n * len : len) + tieGroup, u);
            }
        }
        // runs going up from f, okeys below it (faces in a run are all different,
        // so availability is a look, and consider() does the taking)
        const seq = [];
        const grow = (p, start, wl) => {
            if (seq.length >= 3) {
                let v = 0;
                for (let q = start; q < start + seq.length; q++) v += q === 14 ? 1 : q;
                consider(seq, (pts ? v : seq.length) + tieRun, w - wl);
            }
            if (p > 14 || seq.length >= 13 || (p === 14 && start === 1)) return;
            const fp = c * 13 + (p === 14 ? 0 : p - 1);
            if (cnt[fp] > 0 && fp !== f) { seq.push(fp); grow(p + 1, start, wl); seq.pop(); }
            if (wl > 0) { seq.push(-1); grow(p + 1, start, wl - 1); seq.pop(); }
        };
        for (let below = 0; below <= w && n - below >= 1; below++) {
            seq.length = 0;
            for (let i = 0; i < below; i++) seq.push(-1);
            seq.push(f);
            grow(n + 1, n - below, w - below);
        }
        // a 1 after the 13
        if (n === 1) {
            const down = (p, wl, run) => {
                if (run.length >= 3) {
                    let v = 0;
                    for (let q = 15 - run.length; q <= 14; q++) v += q === 14 ? 1 : q;
                    consider(run, (pts ? v : run.length) + tieRun, w - wl);
                }
                if (p < 2 || run.length >= 13) return;
                const fp = c * 13 + p - 1;
                if (cnt[fp] > 0) down(p - 1, wl, [fp].concat(run));
                if (wl > 0) down(p - 1, wl - 1, [-1].concat(run));
            };
            down(13, w, [f]);
        }
        memo.set(key, best);
        return best;
    }
    function meldsOf(r) { const out = []; for (let x = r; x && x.rest; x = x.rest) if (x.meld) out.push(x.meld); return out; }

    // faces back to tiles: each face takes one of its tiles, okeys fill the -1s.
    // `prefer` is a tile that should be the one used when its face is
    function toIds(faceMelds, ids, ok, prefer) {
        const byFace = new Map(), wild = [];
        for (const id of ids) {
            const f = faceOf(id, ok);
            if (f < 0) wild.push(id);
            else { if (!byFace.has(f)) byFace.set(f, []); byFace.get(f).push(id); }
        }
        if (prefer !== undefined && prefer >= 0) {
            const f = faceOf(prefer, ok);
            const a = f < 0 ? wild : byFace.get(f);
            if (a) { const i = a.indexOf(prefer); if (i >= 0) { a.splice(i, 1); a.push(prefer); } }
        }
        const melds = faceMelds.map(m => m.map(f => (f < 0 ? wild.pop() : byFace.get(f).pop())));
        const left = [];
        byFace.forEach(a => left.push(...a));
        left.push(...wild);
        return { melds, left };
    }

    // the best melds a hand holds, and what is left over
    function bestMelds(ids, ok, opts) {
        opts = opts || {};
        const { cnt, w } = countsOf(ids, ok);
        const memo = opts.memo || new Map();
        const tag = (opts.points ? 'p' : 'c') + (opts.bias || '');
        // one memo per way of scoring: keep them apart inside a shared map
        let sub = memo.get(tag);
        if (!sub) { sub = new Map(); memo.set(tag, sub); }
        const r = search(cnt, w, !!opts.points, sub, opts.bias || '');
        const { melds, left } = toIds(meldsOf(r), ids, ok, opts.prefer);
        let value = 0, tiles = 0;
        for (const m of melds) { const i = meldInfo(m, ok); if (i) { value += i.value; tiles += m.length; } }
        return { melds, left, value, tiles };
    }

    // how many pairs of identical tiles, okeys pairing with whatever is single
    function pairsOf(ids, ok) {
        const { cnt, w } = countsOf(ids, ok);
        let pairs = 0, singles = 0;
        for (const x of cnt) { pairs += x >> 1; singles += x & 1; }
        const used = Math.min(w, singles);
        return { pairs: pairs + used + ((w - used) >> 1), singles: singles - used + ((w - used) & 1) };
    }
    function pairMelds(ids, ok) {
        const byFace = new Map(), wild = [];
        for (const id of ids) {
            const f = faceOf(id, ok);
            if (f < 0) wild.push(id);
            else { if (!byFace.has(f)) byFace.set(f, []); byFace.get(f).push(id); }
        }
        const melds = [], single = [];
        [...byFace.keys()].sort((a, b) => a - b).forEach(f => {
            const a = byFace.get(f);
            while (a.length >= 2) melds.push([a.pop(), a.pop()]);
            if (a.length) single.push(a.pop());
        });
        // okeys pair the highest singles: those are worth the most left over
        single.sort((a, b) => (faceOf(b, ok) % 13) - (faceOf(a, ok) % 13));
        while (wild.length && single.length) melds.push([single.shift(), wild.pop()]);
        while (wild.length >= 2) melds.push([wild.pop(), wild.pop()]);
        return { melds, left: single.concat(wild) };
    }

    // a finished hand: 14 tiles all in melds, or seven pairs
    function finishKind(ids, ok, memo) {
        if (ids.length !== 14) return null;
        const p = pairsOf(ids, ok);
        if (p.pairs === 7 && p.singles === 0) return 'pairs';
        return bestMelds(ids, ok, { memo }).tiles === 14 ? 'melds' : null;
    }
    // every tile in exactly some melds (the lay down button)
    function splitMelds(ids, ok, pairs) {
        if (!ids.length) return null;
        if (pairs) {
            const p = pairMelds(ids, ok);
            return p.left.length ? null : p.melds;
        }
        const one = meldInfo(ids, ok);
        if (one) return [one.order];
        const b = bestMelds(ids, ok);
        return b.tiles === ids.length ? b.melds.map(m => meldInfo(m, ok).order) : null;
    }

    // the rack's two sorting buttons: melds first, then the rest
    function sortedRack(ids, ok, bias) {
        const b = bestMelds(ids, ok, { bias });
        const first = m => { const r = m.find(t => faceOf(t, ok) >= 0); return r === undefined ? 99 : faceOf(r, ok); };
        const melds = b.melds.map(m => (meldInfo(m, ok) || { order: m }).order).sort((x, y) => first(x) - first(y));
        const key = id => { const f = faceOf(id, ok); return f < 0 ? 999 : bias === 'group' ? (f % 13) * 4 + ((f / 13) | 0) : f; };
        const left = b.left.slice().sort((x, y) => key(x) - key(y));
        return { melds, left };
    }

    // ---------------------------------------------------------------
    // the match
    // ---------------------------------------------------------------
    const MODES = ['classic', '101'];
    const LEVELS = ['easy', 'normal', 'hard'];
    function newMatch(o) {
        o = o || {};
        const mode = o.mode === '101' ? '101' : 'classic';
        const seats = [];
        for (let i = 0; i < SEATS; i++) {
            const s = (o.seats || [])[i] || {};
            seats.push({ name: String(s.name || 'bot ' + (i + 1)).slice(0, 16), bot: s.bot === undefined ? i > 0 : !!s.bot, level: LEVELS.includes(s.level) ? s.level : 'normal' });
        }
        const seed = (o.seed >>> 0) || 1;
        const start = Math.max(2, Math.min(40, (o.start | 0) || 20));
        const m = {
            v: 1, mode, seed, rs: hash(seed, 77), seats,
            start: mode === 'classic' ? start : 0,
            hands: mode === '101' ? Math.max(1, Math.min(9, (o.hands | 0) || 3)) : 0,
            handNo: 0, scores: seats.map(() => (mode === 'classic' ? start : 0)),
            dealer: Number.isInteger(o.dealer) && o.dealer >= 0 && o.dealer < SEATS ? o.dealer : hash(seed, 5) % SEATS,
            hand: null, over: false, winner: -1, history: []
        };
        startHand(m);
        return m;
    }

    function startHand(m) {
        const deck = [];
        for (let i = 0; i < 106; i++) deck.push(i);
        for (let i = deck.length - 1; i > 0; i--) { const j = (nextRand(m) * (i + 1)) | 0; const t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
        // the indicator is turned up from the middle of the stacks; never a false joker
        let k = (nextRand(m) * deck.length) | 0;
        while (isFalse(deck[k])) k = (k + 1) % deck.length;
        const ind = deck.splice(k, 1)[0];
        const per = m.mode === '101' ? 21 : 14;
        const hands = [[], [], [], []];
        for (let r = 0; r < per; r++) for (let i = 0; i < SEATS; i++) hands[(m.dealer + i) % SEATS].push(deck.pop());
        hands[m.dealer].push(deck.pop());
        m.hand = {
            ind, ok: okeyOf(ind), pile: deck, hands, discards: [[], [], [], []],
            turn: m.dealer, phase: 'play', turns: 0, acted: [0, 0, 0, 0], shown: [false, false, false, false],
            took: -1, mustDraw: false, opened: ['', '', '', ''], openedTurn: [-1, -1, -1, -1],
            table: [], pens: [0, 0, 0, 0], takenBy: [[], [], [], []], finished: -1, result: null
        };
        return m;
    }

    const prevSeat = s => (s + SEATS - 1) % SEATS;
    const nextSeat = s => (s + 1) % SEATS;
    const fail = err => ({ ok: false, err, ev: [] });
    const has = (arr, id) => arr.indexOf(id) >= 0;
    function drop(arr, id) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); return i >= 0; }
    const intOr = (x, d) => (Number.isInteger(x) ? x : d);

    // can this tile go on that meld on the table?
    function layoffFits(h, idx, id) {
        const t = h.table[idx];
        if (!t || t.kind === 'pair') return false;
        return !!meldInfo(t.tiles.concat([id]), h.ok);
    }
    function playableOnTable(h, id) {
        for (let i = 0; i < h.table.length; i++) if (layoffFits(h, i, id)) return i;
        return -1;
    }

    // ---------------------------------------------------------------
    // apply: the only way the match changes. A seat asks, the rules say yes
    // (and what happened) or no (and why, in words a player reads). It never
    // trusts the asker: a guest's move arrives here exactly as sent.
    // ---------------------------------------------------------------
    function apply(m, seat, a) {
        if (!m || m.over) return fail('the match is over');
        const h = m.hand;
        if (!h || h.result) return fail('the hand is over');
        if (!a || typeof a !== 'object' || typeof a.t !== 'string') return fail('that is not a move');
        if (!(seat >= 0 && seat < SEATS)) return fail('no such seat');
        if (h.turn !== seat) return fail('not your turn');
        const mine = h.hands[seat];
        switch (a.t) {
            case 'show': {
                if (h.acted[seat] || h.shown[seat]) return fail('only on your first turn');
                const twin = mine.find(id => isTwin(id, h.ind));
                if (twin === undefined) return fail("you don't have the indicator's twin");
                h.shown[seat] = true;
                if (m.mode === 'classic') { for (let i = 0; i < SEATS; i++) if (i !== seat) m.scores[i] -= 1; }
                else h.pens[seat] -= 101;
                return { ok: true, ev: [{ e: 'show', s: seat, tile: twin }] };
            }
            case 'draw': {
                if (h.phase !== 'draw') return fail('you already have your tile');
                if (!h.pile.length) return fail('the pile is empty');
                const id = h.pile.pop();
                mine.push(id);
                h.phase = 'play';
                return { ok: true, ev: [{ e: 'draw', s: seat, from: 'pile', tile: id }] };
            }
            case 'take': {
                if (h.phase !== 'draw') return fail('you already have your tile');
                if (h.mustDraw) return fail('you put that back: draw from the pile');
                const st = h.discards[prevSeat(seat)];
                if (!st.length) return fail('nothing to take');
                const id = st.pop();
                mine.push(id);
                h.phase = 'play';
                h.takenBy[seat].push(id);
                if (m.mode === '101') h.took = id;
                return { ok: true, ev: [{ e: 'draw', s: seat, from: 'disc', tile: id }] };
            }
            case 'return': {
                if (m.mode !== '101' || h.took < 0) return fail('nothing to put back');
                if (!has(mine, h.took)) return fail('that tile is already on the table');
                const id = h.took;
                drop(mine, id);
                h.discards[prevSeat(seat)].push(id);
                h.takenBy[seat].pop();
                h.took = -1;
                h.mustDraw = true;
                h.phase = 'draw';
                return { ok: true, ev: [{ e: 'return', s: seat, tile: id }] };
            }
            case 'discard': return discard(m, seat, intOr(a.tile, -1), false);
            case 'finish':
                if (m.mode !== 'classic') return fail('in 101 you finish by playing out your tiles');
                return discard(m, seat, intOr(a.tile, -1), true);
            case 'meld': return meld(m, seat, a.melds);
            case 'layoff': return layoff(m, seat, intOr(a.tile, -1), intOr(a.meld, -1));
        }
        return fail('that is not a move');
    }

    function discard(m, seat, id, finishing) {
        const h = m.hand, mine = h.hands[seat];
        if (h.phase !== 'play') return fail('draw a tile first');
        if (!has(mine, id)) return fail("that tile isn't yours");
        const ev = [];
        if (m.mode === 'classic' && finishing) {
            const kind = finishKind(mine.filter(x => x !== id), h.ok);
            if (!kind) return fail("that's not a winning hand yet");
            drop(mine, id);
            h.discards[seat].push(id);
            h.finished = id;
            const okey = isWild(id, h.ok);
            ev.push({ e: 'finish', s: seat, tile: id, kind, okey });
            endHand(m, seat, { kind, okey }, ev);
            return { ok: true, ev };
        }
        if (m.mode === '101') {
            if (h.took >= 0 && has(mine, h.took)) return fail('use the tile you took, or put it back');
            // the two penalties: throwing away the okey, or a tile that fits the table
            if (mine.length > 1) {
                if (isWild(id, h.ok)) { h.pens[seat] += 101; ev.push({ e: 'pen', s: seat, pts: 101, why: 'threw away the okey' }); }
                else if (playableOnTable(h, id) >= 0) { h.pens[seat] += 101; ev.push({ e: 'pen', s: seat, pts: 101, why: 'threw a tile that fits the table' }); }
            }
        }
        drop(mine, id);
        h.discards[seat].push(id);
        h.acted[seat]++;
        ev.unshift({ e: 'disc', s: seat, tile: id });
        if (m.mode === '101' && !mine.length) {
            h.finished = id;
            const how = { okey: isWild(id, h.ok), inOne: h.openedTurn[seat] === h.turns, pairs: h.opened[seat] === 'pairs' };
            ev.push({ e: 'finish', s: seat, tile: id, kind: h.opened[seat], okey: how.okey, inOne: how.inOne });
            endHand(m, seat, how, ev);
            return { ok: true, ev };
        }
        if (!h.pile.length) { endHand(m, -1, null, ev); return { ok: true, ev }; }
        h.took = -1;
        h.mustDraw = false;
        h.turn = nextSeat(seat);
        h.phase = 'draw';
        h.turns++;
        return { ok: true, ev };
    }

    function meld(m, seat, melds) {
        const h = m.hand, mine = h.hands[seat];
        if (m.mode !== '101') return fail('in classic you keep your melds in your rack');
        if (h.phase !== 'play') return fail('draw a tile first');
        if (!Array.isArray(melds) || !melds.length || melds.length > 12) return fail('nothing to lay down');
        const seen = new Set(), infos = [];
        const opened = h.opened[seat];
        for (const raw of melds) {
            if (!Array.isArray(raw) || raw.length > 13) return fail('that is not a meld');
            for (const id of raw) { if (!Number.isInteger(id) || !has(mine, id) || seen.has(id)) return fail("that tile isn't yours"); seen.add(id); }
            const info = meldInfo(raw, h.ok, true);
            if (!info) return fail("that's not a run, a group or a pair");
            infos.push(info);
        }
        const pairs = infos.every(i => i.kind === 'pair');
        if (!pairs && infos.some(i => i.kind === 'pair')) return fail("pairs and runs don't go down together");
        if (seen.size >= mine.length) return fail('keep one tile to throw');
        const total = infos.reduce((s, i) => s + i.value, 0);
        if (!opened) {
            if (pairs && infos.length < 5) return fail('opening with pairs takes five of them');
            if (!pairs && total < 101) return fail('an opening needs 101 points (that is ' + total + ')');
        } else if (opened === 'pairs' && !pairs) return fail('you opened with pairs: only pairs now');
        else if (opened === 'melds' && pairs) return fail('you opened with runs and groups: no pairs now');
        for (const id of seen) drop(mine, id);
        const ev = [];
        if (!opened) { h.opened[seat] = pairs ? 'pairs' : 'melds'; h.openedTurn[seat] = h.turns; ev.push({ e: 'open', s: seat, pairs, value: total }); }
        const at = h.table.length;
        infos.forEach(i => h.table.push({ owner: seat, kind: i.kind, tiles: i.order.slice() }));
        ev.push({ e: 'meld', s: seat, from: at, melds: infos.map(i => i.order.slice()) });
        return { ok: true, ev };
    }

    function layoff(m, seat, id, idx) {
        const h = m.hand, mine = h.hands[seat];
        if (m.mode !== '101') return fail('nothing to add to in classic');
        if (h.phase !== 'play') return fail('draw a tile first');
        if (!has(mine, id)) return fail("that tile isn't yours");
        if (h.opened[seat] !== 'melds') return fail(h.opened[seat] ? 'pair openers cannot add to melds' : 'open first: 101 points of melds');
        if (mine.length <= 1) return fail('keep one tile to throw');
        if (!layoffFits(h, idx, id)) return fail("it doesn't fit there");
        const t = h.table[idx];
        t.tiles = meldInfo(t.tiles.concat([id]), h.ok).order;
        drop(mine, id);
        return { ok: true, ev: [{ e: 'layoff', s: seat, tile: id, meld: idx }] };
    }

    // ---------------------------------------------------------------
    // the end of a hand, and of the match
    //
    // classic  everybody starts on `start` points; a finish costs each of the
    //          others 2, doubled for throwing the okey to finish and doubled
    //          for seven pairs. Showing the indicator's twin costs them 1.
    //          The match ends when somebody reaches 0: most points wins.
    // 101      penalty points, lowest wins after `hands` hands. The finisher
    //          gets -101; nobody else opened: 202; opened: what is left in
    //          the rack (an okey is 101), doubled for a pairs opener. Throwing
    //          the okey to finish, finishing in one go and finishing on pairs
    //          each double the hand. Throwing the okey or a tile that fits the
    //          table costs 101 on the spot; showing the twin is -101.
    // ---------------------------------------------------------------
    function endHand(m, winner, how, ev) {
        const h = m.hand;
        const deltas = [0, 0, 0, 0];
        let mult = 1;
        if (m.mode === 'classic') {
            if (winner >= 0) {
                mult = (how.okey ? 2 : 1) * (how.kind === 'pairs' ? 2 : 1);
                for (let i = 0; i < SEATS; i++) if (i !== winner) deltas[i] = -2 * mult;
            }
            for (let i = 0; i < SEATS; i++) m.scores[i] += deltas[i];
        } else {
            if (winner >= 0) mult = (how.okey ? 2 : 1) * (how.inOne ? 2 : 1) * (how.pairs ? 2 : 1);
            for (let i = 0; i < SEATS; i++) {
                let d;
                if (i === winner) d = -101 * mult;
                else if (!h.opened[i]) d = 202 * mult;
                else d = h.hands[i].reduce((s, id) => s + handValue(id, h.ok), 0) * (h.opened[i] === 'pairs' ? 2 : 1) * mult;
                deltas[i] = d + h.pens[i];
                m.scores[i] += deltas[i];
            }
        }
        h.phase = 'done';
        const r = {
            winner, how: !how ? 'pile' : how.kind || (how.pairs ? 'pairs' : 'melds'), okey: !!(how && how.okey), inOne: !!(how && how.inOne),
            mult, deltas, scores: m.scores.slice(), pens: h.pens.slice(), handNo: m.handNo
        };
        h.result = r;
        m.history.push({ winner, deltas: deltas.slice() });
        const pick = (best, tied) => (tied.includes(winner) ? winner : tied[0]);
        if (m.mode === 'classic') {
            if (m.scores.some(s => s <= 0)) {
                const top = Math.max(...m.scores);
                m.winner = pick(top, m.scores.map((s, i) => (s === top ? i : -1)).filter(i => i >= 0));
                m.over = true;
            }
        } else if (m.handNo + 1 >= m.hands) {
            const low = Math.min(...m.scores);
            m.winner = pick(low, m.scores.map((s, i) => (s === low ? i : -1)).filter(i => i >= 0));
            m.over = true;
        }
        r.matchOver = m.over;
        r.matchWinner = m.winner;
        ev.push({ e: 'end', r });
    }

    function nextHand(m) {
        if (m.over || !m.hand || !m.hand.result) return false;
        m.handNo++;
        m.dealer = nextSeat(m.dealer);
        startHand(m);
        return true;
    }

    // ---------------------------------------------------------------
    // what one seat may see: its own tiles, everybody's discards, the table
    // and how many tiles the others hold, never which (until the hand ends)
    // ---------------------------------------------------------------
    function view(m, seat) {
        const h = m.hand;
        const me = seat >= 0 && seat < SEATS ? seat : -1;
        return {
            v: 1, mode: m.mode, me, start: m.start, hands: m.hands, handNo: m.handNo, dealer: m.dealer,
            seats: m.seats.map((s, i) => ({ name: s.name, bot: s.bot, count: h.hands[i].length, opened: h.opened[i], score: m.scores[i], pen: h.pens[i], shown: h.shown[i] })),
            hand: me >= 0 ? h.hands[me].slice() : [],
            reveal: h.result ? h.hands.map(x => x.slice()) : null,
            discards: h.discards.map(d => d.slice(-8)), discardCounts: h.discards.map(d => d.length), finished: h.result ? h.finished : -1,
            pile: h.pile.length, ind: h.ind, ok: { c: h.ok.c, n: h.ok.n }, turn: h.turn, phase: h.phase, turns: h.turns,
            acted: h.acted.slice(), took: me >= 0 && h.turn === me ? h.took : -1, mustDraw: h.mustDraw && h.turn === me,
            table: h.table.map(t => ({ owner: t.owner, kind: t.kind, tiles: t.tiles.slice() })),
            result: h.result, over: m.over, winner: m.winner
        };
    }
    // events as one seat sees them: nobody else learns what came off the pile
    function eventsFor(ev, seat) {
        return ev.map(e => (e.e === 'draw' && e.from === 'pile' && e.s !== seat ? { e: 'draw', s: e.s, from: 'pile', tile: -1 } : e));
    }

    // every tile somewhere, exactly once, and every meld on the table a meld
    function audit(m) {
        const h = m.hand, seen = new Array(106).fill(0);
        const mark = id => { if (!(id >= 0 && id < 106)) throw new Error('bad tile ' + id); seen[id]++; };
        mark(h.ind);
        h.pile.forEach(mark);
        h.hands.forEach(a => a.forEach(mark));
        h.discards.forEach(a => a.forEach(mark));
        h.table.forEach(t => { t.tiles.forEach(mark); const i = meldInfo(t.tiles, h.ok, true); if (!i || (i.kind === 'pair') !== (t.kind === 'pair')) throw new Error('broken meld on the table'); });
        const bad = seen.findIndex(x => x !== 1);
        if (bad >= 0) throw new Error('tile ' + bad + ' seen ' + seen[bad] + ' times');
        return true;
    }

    // ---------------------------------------------------------------
    // bots
    //
    // A bot is asked for one move at a time. It scores a hand by what the
    // search can meld, plus a little for tiles that are nearly there (a red
    // 5 and 6, two 9s), plus a lot for an okey it still holds. It takes the
    // discard only when that beats a blind draw by a margin, keeps away from
    // what the next seat has been picking up, and in 101 it opens as soon as
    // it can, lays off what it can, and never throws a tile that fits the
    // table. `easy` adds noise and skips the defence; `hard` defends more.
    // ---------------------------------------------------------------
    function nearness(left, ok) {
        const fs = [];
        for (const id of left) { const f = faceOf(id, ok); if (f >= 0) fs.push(f); }
        let v = 0;
        for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
            const a = fs[i], b = fs[j];
            if (a === b) { v += 1; continue; }
            const ca = (a / 13) | 0, cb = (b / 13) | 0, na = a % 13 + 1, nb = b % 13 + 1;
            if (ca === cb) { const d = Math.abs(na - nb); if (d === 1 || d === 12) v += 3; else if (d === 2 || d === 11) v += 1.5; }
            else if (na === nb) v += 2.5;
        }
        return v;
    }
    function evalClassic(ids, ok, memo) {
        const b = bestMelds(ids, ok, { memo });
        let wildLeft = 0;
        for (const id of b.left) if (faceOf(id, ok) < 0) wildLeft++;
        let v = b.tiles * 10 + nearness(b.left, ok) + wildLeft * 9;
        const p = pairsOf(ids, ok);
        if (p.pairs >= 5) v = Math.max(v, p.pairs * 19 + (p.pairs >= 6 ? 10 : 0));
        return v;
    }
    function eval101(ids, ok, opened, memo) {
        const b = bestMelds(ids, ok, { memo, points: true });
        let wildLeft = 0, dead = 0;
        for (const id of b.left) { if (faceOf(id, ok) < 0) wildLeft++; else dead += handValue(id, ok); }
        return b.value + nearness(b.left, ok) * 2.2 + wildLeft * 14 - dead * (opened ? 0.8 : 0.15);
    }

    // don't hand the next seat the neighbours of what it took from you
    function feedPenalty(m, seat, id) {
        const h = m.hand, ok = h.ok, nx = nextSeat(seat), f = faceOf(id, ok);
        if (f < 0) return 30;
        let p = 0;
        const c = (f / 13) | 0, n = f % 13 + 1;
        for (const d of h.discards[nx]) if (faceOf(d, ok) === f) p -= 2;     // it threw one itself
        for (const t of h.takenBy[nx]) {
            const g = faceOf(t, ok);
            if (g < 0) continue;
            const tc = (g / 13) | 0, tn = g % 13 + 1;
            if (tc === c && Math.abs(tn - n) <= 2) p += 4;
            if (tn === n && tc !== c) p += 3;
        }
        return p;
    }

    function botAct(m, seat) {
        const h = m.hand;
        if (!h || h.result || m.over || h.turn !== seat) return null;
        const mine = h.hands[seat], ok = h.ok;
        const lvl = m.seats[seat].level;
        const rnd = { rs: hash(hash(m.seed, m.handNo * 977 + h.turns), seat * 131 + mine.length) };
        const noise = () => (lvl === 'easy' ? (nextRand(rnd) - 0.5) * 14 : lvl === 'normal' ? (nextRand(rnd) - 0.5) * 2 : 0);
        const memo = new Map();
        // the indicator's twin is free points
        if (!h.acted[seat] && !h.shown[seat] && lvl !== 'easy' && mine.some(id => isTwin(id, h.ind))) return { t: 'show' };

        if (m.mode === 'classic') {
            if (h.phase === 'draw') {
                const st = h.discards[prevSeat(seat)];
                if (!st.length) return { t: 'draw' };
                const d = st[st.length - 1];
                if (faceOf(d, ok) < 0) return { t: 'take' };
                const withD = mine.concat([d]);
                const base = evalClassic(mine, ok, memo);
                let bestWith = -1e9;
                for (const x of new Set(mine)) {
                    const rest = withD.filter(y => y !== x);
                    if (finishKind(rest, ok, memo)) return { t: 'take' };
                    const v = evalClassic(rest, ok, memo);
                    if (v > bestWith) bestWith = v;
                }
                return { t: bestWith > base + (lvl === 'easy' ? 9 : 5) + noise() ? 'take' : 'draw' };
            }
            // a finish, throwing the okey if that also finishes (it doubles)
            let finish = null;
            for (const x of mine) {
                if (finish !== null && faceOf(finish, ok) < 0) break;
                if (finishKind(mine.filter(y => y !== x), ok, memo) && (finish === null || faceOf(x, ok) < 0)) finish = x;
            }
            if (finish !== null) return { t: 'finish', tile: finish };
            let best = null, bv = -1e9;
            const done = new Set();
            for (const x of mine) {
                const fx = faceOf(x, ok);
                if (done.has(fx)) continue;
                done.add(fx);
                if (fx < 0) continue;
                let v = evalClassic(mine.filter(y => y !== x), ok, memo) + noise();
                if (lvl !== 'easy') v -= feedPenalty(m, seat, x) * (lvl === 'hard' ? 1.4 : 0.7);
                if (v > bv) { bv = v; best = x; }
            }
            return { t: 'discard', tile: best === null ? mine[0] : best };
        }

        // ---- 101 ----
        const opened = h.opened[seat];
        if (h.phase === 'draw') {
            const st = h.discards[prevSeat(seat)];
            if (st.length && !h.mustDraw) {
                const d = st[st.length - 1];
                if (opened === 'melds' && (playableOnTable(h, d) >= 0 || bestMelds(mine.concat([d]), ok, { memo, prefer: d }).melds.some(x => x.includes(d)))) {
                    if (lvl !== 'easy' || nextRand(rnd) < 0.5) return { t: 'take' };
                }
                if (!opened) {
                    const b = bestMelds(mine.concat([d]), ok, { memo, points: true, prefer: d });
                    if (b.value >= 101 && b.left.length && b.melds.some(x => x.includes(d))) return { t: 'take' };
                }
            }
            return { t: 'draw' };
        }
        const took = h.took >= 0 && has(mine, h.took) ? h.took : -1;
        if (!opened) {
            const b = bestMelds(mine, ok, { memo, points: true, prefer: took });
            let melds = b.melds;
            if (melds.length && !b.left.length) {
                // keep a tile to throw: hold back the cheapest meld
                let lo = 0;
                melds.forEach((x, i) => { if (meldInfo(x, ok).value < meldInfo(melds[lo], ok).value) lo = i; });
                melds = melds.filter((_, i) => i !== lo);
            }
            const val = melds.reduce((s, x) => s + meldInfo(x, ok).value, 0);
            if (val >= 101 && (took < 0 || melds.some(x => x.includes(took)))) return { t: 'meld', melds };
            const p = pairMelds(mine, ok);
            const pm = p.left.length ? p.melds : p.melds.slice(0, -1);
            if (pm.length >= 5 && (took < 0 || pm.some(x => x.includes(took)))) return { t: 'meld', melds: pm };
            if (took >= 0) return { t: 'return' };
        } else if (opened === 'melds') {
            const b = bestMelds(mine, ok, { memo, prefer: took });
            let melds = b.melds;
            if (melds.length && !b.left.length) melds = melds.slice(0, -1);
            if (melds.length) return { t: 'meld', melds };
            if (mine.length > 1) {
                const order = took >= 0 ? [took].concat(mine.filter(x => x !== took)) : mine;
                for (const id of order) { const i = playableOnTable(h, id); if (i >= 0) return { t: 'layoff', tile: id, meld: i }; }
            }
            if (took >= 0) return { t: 'return' };
        } else {
            const p = pairMelds(mine, ok);
            const pm = p.left.length ? p.melds : p.melds.slice(0, -1);
            if (pm.length) return { t: 'meld', melds: pm };
            if (took >= 0) return { t: 'return' };
        }
        // throw: never the okey, never a tile that fits the table
        let best = null, bv = -1e9;
        const done = new Set();
        for (const x of mine) {
            const fx = faceOf(x, ok);
            if (done.has(fx)) continue;
            done.add(fx);
            let v = eval101(mine.filter(y => y !== x), ok, !!opened, memo) + noise();
            if (fx < 0) v -= 400;
            if (mine.length > 1 && playableOnTable(h, x) >= 0) v -= 300;
            if (lvl !== 'easy') v -= feedPenalty(m, seat, x) * (lvl === 'hard' ? 1.4 : 0.7);
            if (v > bv) { bv = v; best = x; }
        }
        return { t: 'discard', tile: best === null ? mine[0] : best };
    }

    // a whole hand of bots, for node and the tests
    function playHand(m, maxMoves) {
        let n = 0;
        while (!m.hand.result && n < (maxMoves || 4000)) {
            const s = m.hand.turn;
            const a = botAct(m, s);
            const r = apply(m, s, a);
            if (!r.ok) throw new Error('bot move refused: ' + JSON.stringify(a) + ': ' + r.err);
            n++;
        }
        return n;
    }

    const OKEY_SIM = {
        COLORS, SEATS, MODES, LEVELS, FALSE_JOKERS,
        isFalse, colorOf, numOf, okeyOf, isWild, isTwin, faceOf, handValue, tileName,
        meldInfo, bestMelds, pairsOf, pairMelds, finishKind, splitMelds, sortedRack,
        newMatch, startHand, nextHand, apply, view, eventsFor, audit,
        playableOnTable, layoffFits, botAct, playHand, nextSeat, prevSeat, hash
    };
    root.OKEY_SIM = OKEY_SIM;
    if (typeof module === 'object' && module.exports) module.exports = OKEY_SIM;
})(typeof window !== 'undefined' ? window : globalThis);
