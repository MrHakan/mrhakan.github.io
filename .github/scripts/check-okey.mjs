// ===================================================================
// check-okey.mjs — okey 98's rules and bots, under node
//
//   tiles     106 of them, the okey after the indicator (13 -> 1), false
//             jokers playing as the okey's face
//   melds     runs (12-13-1 yes, 13-1-2 no), groups, pairs, okeys in holes
//   finishing 14 tiles in melds or seven pairs; the classic scoring
//   101       the 101 opening, five pairs, laying off, the penalties, the
//             discard you take has to be used (or put back)
//   the seat  what one seat sees: never another's tiles, never a pile draw
//   the wire  a guest's move is checked like anybody's: out of turn, made
//             up tiles, garbage
//   matches   hundreds of seeded bot matches in both rule sets, every tile
//             accounted for after every move, always ending with a winner;
//             the same seed is the same match; a saved match plays on the same
//
//   node .github/scripts/check-okey.mjs
// ===================================================================
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = require(path.join(ROOT, 'games/okey/okey-sim.js'));

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
const R = 0, Y = 1, B = 2, K = 3;
const T = (c, n, copy = 0) => c * 26 + copy * 13 + (n - 1);
const FJ = 104;
const OK_BLUE7 = { c: B, n: 7 };          // indicator blue 6

// put tiles where a test wants them without losing any: swap from wherever they are
function swapIn(m, seat, ids) {
    const h = m.hand, mine = h.hands[seat];
    const want = new Set(ids);
    const spare = mine.filter(x => !want.has(x));
    for (const id of ids) {
        if (mine.includes(id)) continue;
        const where = [h.pile].concat(h.hands, h.discards).find(a => a.includes(id));
        const out = spare.pop();
        if (!where) throw new Error('tile ' + id + ' is not anywhere movable');
        where[where.indexOf(id)] = out;
        mine[mine.indexOf(out)] = id;
    }
    // trim or pad to the length asked for
    while (mine.length > ids.length) { const x = mine.find(t => !want.has(t)); mine.splice(mine.indexOf(x), 1); h.pile.unshift(x); }
    while (mine.length < ids.length) throw new Error('not enough tiles in the seat');
    S.audit(m);
}
function setIndicator(m, id) {
    const h = m.hand;
    if (h.ind === id) return;
    const where = [h.pile].concat(h.hands, h.discards).find(a => a.includes(id));
    where[where.indexOf(id)] = h.ind;
    h.ind = id;
    h.ok = S.okeyOf(id);
}
// a match where `seat` is to move in `phase`, holding `ids`
function rigged(mode, ids, o = {}) {
    const m = S.newMatch({ mode, seed: o.seed || 7, dealer: 0, seats: [{ bot: false }, { bot: true }, { bot: true }, { bot: true }] });
    setIndicator(m, o.ind === undefined ? T(B, 6) : o.ind);
    swapIn(m, 0, ids);
    return m;
}

// ===================================================================
section('tiles');
// ===================================================================
{
    const m = S.newMatch({ seed: 1 });
    const h = m.hand;
    expect(h.pile.length + h.hands.flat().length + 1 === 106, '106 tiles in the box');
    expect(h.hands.map(x => x.length).sort().join() === '14,14,14,15', 'classic deals 14 each and 15 to the dealer');
    expect(h.hands[m.dealer].length === 15 && h.turn === m.dealer && h.phase === 'play', 'the dealer starts by throwing');
    expect(!S.isFalse(h.ind), 'the indicator is never a false joker');
    const m1 = S.newMatch({ seed: 1, mode: '101' });
    expect(m1.hand.hands.map(x => x.length).sort().join() === '21,21,21,22' && m1.hand.pile.length === 20, '101 deals 21 each, 22 to the dealer, 20 left');
    expect(JSON.stringify(S.okeyOf(T(K, 13))) === JSON.stringify({ c: K, n: 1 }), 'after a 13 the okey is the 1');
    expect(S.isWild(T(B, 7, 1), OK_BLUE7) && !S.isWild(T(B, 7, 1), { c: R, n: 7 }), 'both copies of the okey are wild, nothing else');
    expect(S.faceOf(FJ, OK_BLUE7) === S.faceOf(T(B, 7), { c: R, n: 1 }), 'a false joker plays as the okey face');
    expect(S.handValue(T(B, 7), OK_BLUE7) === 101 && S.handValue(FJ, OK_BLUE7) === 7 && S.handValue(T(R, 12), OK_BLUE7) === 12, 'left in your rack: okey 101, joker its face, the rest their number');
}

// ===================================================================
section('melds');
// ===================================================================
{
    const ok = OK_BLUE7, mi = ids => S.meldInfo(ids, ok);
    expect(mi([T(R, 3), T(R, 4), T(R, 5)])?.kind === 'run', 'red 3-4-5 is a run');
    expect(mi([T(R, 12), T(R, 13), T(R, 1)])?.kind === 'run', '12-13-1 is a run');
    expect(mi([T(R, 13), T(R, 1), T(R, 2)]) === null, '13-1-2 is not');
    expect(mi([T(R, 3), T(Y, 4), T(R, 5)]) === null, 'two colours are not a run');
    expect(mi([T(R, 3), T(R, 5), T(R, 6)]) === null, 'a hole is not a run');
    expect(mi([T(R, 3), T(B, 7), T(R, 5)])?.kind === 'run', 'unless an okey fills it');
    expect(mi([T(R, 9), T(Y, 9), T(K, 9)])?.kind === 'group', 'three 9s in three colours is a group');
    expect(mi([T(R, 9), T(Y, 9), T(K, 9), T(B, 9)])?.kind === 'group', 'and four');
    expect(mi([T(R, 9), T(R, 9, 1), T(K, 9)]) === null, 'not with a colour twice');
    expect(mi([T(R, 9), T(Y, 9), T(K, 9), T(B, 9), T(B, 7)]) === null, 'five is too many');
    expect(mi([T(R, 9), T(Y, 9)]) === null && S.meldInfo([T(R, 9), T(R, 9, 1)], ok, true)?.kind === 'pair', 'two are a pair only where pairs count');
    expect(mi([T(B, 6), FJ, T(B, 8)])?.kind === 'run', 'a false joker is a blue 7 when the okey is blue 7');
    expect(mi([T(R, 11), T(R, 12), T(R, 13)])?.value === 36 && mi([T(R, 13), T(Y, 13), T(K, 13)])?.value === 39, 'what melds are worth: their numbers');
    expect(mi([T(R, 11), T(R, 12), T(B, 7)])?.value === 36, 'an okey at the end of a run takes the higher end (10 or 13: 13)');
    expect(S.splitMelds([T(R, 1), T(R, 2), T(R, 3), T(Y, 5), T(B, 5), T(K, 5)], ok)?.length === 2, 'the lay down button splits a selection into its melds');
    expect(S.splitMelds([T(R, 1), T(R, 2), T(Y, 5)], ok) === null, 'and refuses one that does not split');
}

// ===================================================================
section('a finished hand');
// ===================================================================
const WIN14 = [T(R, 1), T(R, 2), T(R, 3), T(R, 4), T(Y, 9), T(B, 9), T(K, 9), T(K, 11), T(K, 12), T(K, 13), T(K, 1), T(Y, 5), T(Y, 6), T(Y, 7)];
const PAIRS14 = [T(R, 1), T(R, 1, 1), T(Y, 4), T(Y, 4, 1), T(K, 9), T(K, 9, 1), T(R, 12), T(R, 12, 1), T(Y, 2), T(Y, 2, 1), T(K, 5), T(K, 5, 1), T(R, 8), T(B, 7)];
{
    const ok = OK_BLUE7;
    expect(S.finishKind(WIN14, ok) === 'melds', 'four melds including 11-12-13-1 finish');
    expect(S.finishKind(PAIRS14, ok) === 'pairs', 'seven pairs (an okey pairing the odd one) finish');
    const broken = WIN14.slice(0, 13).concat([T(Y, 11)]);
    expect(S.finishKind(broken, ok) === null, 'one stray tile does not');
    expect(S.finishKind(WIN14.slice(0, 13), ok) === null, 'thirteen tiles do not');
    const withOkeys = [T(R, 1), T(R, 2), T(B, 7), T(R, 4), T(Y, 9), T(B, 9), T(B, 7, 1), T(K, 11), T(K, 12), T(K, 13), T(K, 1), T(Y, 5), T(Y, 6), T(Y, 7)];
    expect(S.finishKind(withOkeys, ok) === 'melds', 'two okeys standing in finish too');
}

// ===================================================================
section('classic: moves and scores');
// ===================================================================
{
    let m = rigged('classic', WIN14.concat([T(Y, 11)]));
    expect(S.apply(m, 1, { t: 'draw' }).err === 'not your turn', 'out of turn is refused');
    expect(S.apply(m, 0, { t: 'draw' }).ok === false, 'the dealer cannot draw: it already has 15');
    expect(S.apply(m, 0, { t: 'discard', tile: T(Y, 12) }).ok === false || !m.hand.hands[0].includes(T(Y, 12)), 'a tile you do not hold cannot be thrown');
    expect(S.apply(m, 0, { t: 'finish', tile: T(R, 1) }).err === "that's not a winning hand yet", 'finishing on the wrong tile is refused');
    expect(S.apply(m, 0, { t: 'meld', melds: [[T(R, 1), T(R, 2), T(R, 3)]] }).ok === false, 'nothing is laid on the table in classic');
    expect(S.apply(m, 0, null).ok === false && S.apply(m, 0, { t: 'nuke' }).ok === false && S.apply(m, 0, { t: 'discard', tile: 'x' }).ok === false, 'garbage is refused');
    const r = S.apply(m, 0, { t: 'finish', tile: T(Y, 11) });
    expect(r.ok && m.hand.result.winner === 0, 'finishing on the stray tile wins the hand');
    expect(m.scores.join() === '20,18,18,18', 'the others lose 2', m.scores.join());
    expect(S.apply(m, 1, { t: 'draw' }).ok === false, 'nothing moves once the hand is over');
    expect(S.nextHand(m) && m.hand.hands.flat().length === 57 && m.dealer === 1, 'the next hand deals and the deal moves round');

    m = rigged('classic', WIN14.slice(0, 7).concat([T(B, 7), T(K, 12), T(K, 13), T(K, 1), T(Y, 5), T(Y, 6), T(Y, 7), T(B, 7, 1)]));
    const r2 = S.apply(m, 0, { t: 'finish', tile: T(B, 7, 1) });
    expect(r2.ok && m.hand.result.okey && m.scores.join() === '20,16,16,16', 'finishing by throwing the okey: 4 each', m.scores.join());

    m = rigged('classic', PAIRS14.slice(0, 12).concat([T(R, 8), T(R, 8, 1), T(Y, 13)]), { ind: T(R, 6) });
    const r3 = S.apply(m, 0, { t: 'finish', tile: T(Y, 13) });
    expect(r3.ok && m.hand.result.how === 'pairs' && m.scores[1] === 16, 'seven pairs: 4 each', m.scores.join());

    // showing the indicator's twin
    m = rigged('classic', WIN14.concat([T(B, 6, 1)]));
    expect(S.apply(m, 0, { t: 'show' }).ok && m.scores.join() === '20,19,19,19', "showing the indicator's twin costs the others 1");
    expect(S.apply(m, 0, { t: 'show' }).ok === false, 'once');
    // taking the discard
    m = rigged('classic', WIN14.concat([T(Y, 11)]));
    S.apply(m, 0, { t: 'discard', tile: T(Y, 11) });
    const took = S.apply(m, 1, { t: 'take' });
    expect(took.ok && m.hand.hands[1].includes(T(Y, 11)) && !m.hand.discards[0].length, 'the next seat can take what was just thrown');
    expect(S.apply(m, 1, { t: 'draw' }).ok === false, 'and then not draw as well');

    // a match ends at 0
    m = S.newMatch({ seed: 3, start: 2, seats: [{ bot: true }, {}, {}, {}] });
    let n = 0;
    while (!m.over && n < 20) { S.playHand(m); if (!m.over) S.nextHand(m); n++; }
    expect(m.over && m.scores.some(s => s <= 0) && m.scores[m.winner] === Math.max(...m.scores), 'the match ends when somebody reaches 0, most points wins', m.scores.join());
}

// ===================================================================
section('101');
// ===================================================================
{
    // 11-12-13 red (36), 13s (39), 10-11-12-13 black (46): 121, plus spares
    const OPEN = [T(R, 11), T(R, 12), T(R, 13), T(Y, 13), T(B, 13), T(K, 13), T(K, 10), T(K, 11), T(K, 12), T(K, 13, 1)];
    const spare = [T(R, 2), T(Y, 3), T(Y, 8), T(R, 5), T(B, 1), T(Y, 1), T(R, 9), T(Y, 11), T(K, 2), T(K, 4), T(R, 4), T(Y, 3, 1)];
    let m = rigged('101', OPEN.concat(spare));
    expect(S.apply(m, 0, { t: 'meld', melds: [OPEN.slice(0, 3), OPEN.slice(3, 6)] }).err.startsWith('an opening needs 101'), 'an opening under 101 is refused');
    expect(S.apply(m, 0, { t: 'meld', melds: [OPEN.slice(0, 3), [T(R, 2), T(Y, 3), T(Y, 8)]] }).ok === false, 'a meld that is not one is refused');
    expect(S.apply(m, 0, { t: 'meld', melds: [OPEN.slice(0, 3), OPEN.slice(0, 3)] }).ok === false, 'the same tile twice is refused');
    const op = S.apply(m, 0, { t: 'meld', melds: [OPEN.slice(0, 3), OPEN.slice(3, 6), OPEN.slice(6, 10)] });
    expect(op.ok && m.hand.opened[0] === 'melds' && m.hand.table.length === 3, '121 points opens', op.err);
    expect(S.apply(m, 0, { t: 'layoff', tile: T(R, 9), meld: 0 }).ok === false, 'a 9 does not fit 11-12-13');
    expect(S.apply(m, 0, { t: 'discard', tile: T(K, 2) }).ok, 'then throw');
    // seat 1 has not opened: cannot lay off
    m.hand.phase = 'play';
    const s1 = m.hand.hands[1];
    expect(S.apply(m, 1, { t: 'layoff', tile: s1[0], meld: 0 }).ok === false, 'nobody adds to the table before opening');
    // penalty for throwing a tile that fits the table: give seat 1 a red 10
    swapIn(m, 1, s1.slice(0, 21).filter(x => x !== T(R, 10, 1)).slice(0, 20).concat([T(R, 10, 1)]));
    const pen = S.apply(m, 1, { t: 'discard', tile: T(R, 10, 1) });
    expect(pen.ok && m.hand.pens[1] === 101, 'throwing a tile that fits the table costs 101', JSON.stringify(pen.ev.filter(e => e.e === 'pen')));
    // the next seat takes it: has to use it or put it back
    S.apply(m, 2, { t: 'take' });
    expect(m.hand.took === T(R, 10, 1), 'a taken tile is marked');
    expect(S.apply(m, 2, { t: 'discard', tile: m.hand.hands[2].find(x => x !== T(R, 10, 1)) }).err === 'use the tile you took, or put it back', 'it cannot just be kept');
    expect(S.apply(m, 2, { t: 'return' }).ok && m.hand.phase === 'draw' && m.hand.discards[1].includes(T(R, 10, 1)), 'put back, it goes back on the stack');
    expect(S.apply(m, 2, { t: 'take' }).ok === false && S.apply(m, 2, { t: 'draw' }).ok, 'and then it is the pile');
    S.audit(m);

    // laying off, and keeping one tile to throw
    m = rigged('101', OPEN.concat([T(R, 10), T(K, 9), T(Y, 2)]));
    S.apply(m, 0, { t: 'meld', melds: [OPEN.slice(0, 3), OPEN.slice(3, 6), OPEN.slice(6, 10)] });
    expect(S.apply(m, 0, { t: 'layoff', tile: T(R, 10), meld: 0 }).ok && m.hand.table[0].tiles.length === 4, 'an opened seat adds a red 10 to 11-12-13');
    expect(S.apply(m, 0, { t: 'layoff', tile: T(K, 9), meld: 2 }).err === 'keep one tile to throw' || m.hand.hands[0].length === 1, 'and keeps one tile to throw');
    // finishing: throw the last tile
    m = rigged('101', OPEN.concat([T(Y, 2)]));
    S.apply(m, 0, { t: 'meld', melds: [OPEN.slice(0, 3), OPEN.slice(3, 6), OPEN.slice(6, 10)] });
    const fin = S.apply(m, 0, { t: 'discard', tile: T(Y, 2) });
    const res = m.hand.result;
    expect(fin.ok && res.winner === 0 && res.inOne && res.mult === 2, 'playing out every tile in one go finishes, doubled');
    expect(res.deltas[0] === -202 && res.deltas[1] === 404, 'finisher -101 x2, an unopened seat 202 x2', res.deltas.join());
    // five pairs open
    const P5 = [T(R, 1), T(R, 1, 1), T(Y, 4), T(Y, 4, 1), T(K, 9), T(K, 9, 1), T(R, 12), T(R, 12, 1), T(Y, 2), T(Y, 2, 1)];
    m = rigged('101', P5.concat([T(K, 5), T(R, 8), T(Y, 9)]));
    const pairs = S.pairMelds(P5, m.hand.ok).melds;
    expect(S.apply(m, 0, { t: 'meld', melds: pairs.slice(0, 4) }).err === 'opening with pairs takes five of them', 'four pairs do not open');
    expect(S.apply(m, 0, { t: 'meld', melds: pairs }).ok && m.hand.opened[0] === 'pairs', 'five pairs do');
    expect(S.apply(m, 0, { t: 'meld', melds: [[T(K, 5), T(R, 8), T(Y, 9)]] }).ok === false, 'a pairs opener lays only pairs');
}

// ===================================================================
section('what a seat sees');
// ===================================================================
{
    const m = S.newMatch({ seed: 11 });
    const v = S.view(m, 2);
    expect(v.hand.length === m.hand.hands[2].length && v.reveal === null, 'its own tiles and nobody else\'s');
    expect(!JSON.stringify(v).includes('"pile":[') && typeof v.pile === 'number', 'the pile is a number, not a list');
    const ev = [{ e: 'draw', s: 1, from: 'pile', tile: 42 }, { e: 'draw', s: 2, from: 'pile', tile: 43 }];
    const f = S.eventsFor(ev, 2);
    expect(f[0].tile === -1 && f[1].tile === 43, "a pile draw is shown to the drawer only");
    expect(S.view(m, 0).took === -1, 'nobody else learns what you took');
}

// ===================================================================
section('bots, many matches');
// ===================================================================
function playMatch(o) {
    const m = S.newMatch(o);
    let moves = 0, hands = 0;
    const tally = { melds: 0, pairs: 0, pile: 0, okey: 0 };
    while (!m.over) {
        while (!m.hand.result) {
            const s = m.hand.turn;
            const a = S.botAct(m, s);
            const r = S.apply(m, s, a);
            if (!r.ok) throw new Error('seed ' + o.seed + ': bot move refused ' + JSON.stringify(a) + ' ' + r.err);
            S.audit(m);
            if (++moves > 20000) throw new Error('seed ' + o.seed + ' never ends');
        }
        hands++;
        tally[m.hand.result.how] = (tally[m.hand.result.how] || 0) + 1;
        if (m.hand.result.okey) tally.okey++;
        if (!m.over) S.nextHand(m);
    }
    return { m, moves, hands, tally };
}
const lv = ['easy', 'normal', 'hard'];
for (const mode of ['classic', '101']) {
    const N = mode === 'classic' ? 60 : 60;
    let bad = '', hands = 0, moves = 0, ends = { melds: 0, pairs: 0, pile: 0, okey: 0 }, won = [0, 0, 0, 0];
    const t0 = Date.now();
    for (let seed = 1; seed <= N; seed++) {
        try {
            const r = playMatch({ mode, seed, start: 8, hands: 2, seats: [0, 1, 2, 3].map(i => ({ bot: true, level: lv[(i + seed) % 3] })) });
            hands += r.hands; moves += r.moves;
            for (const k in r.tally) ends[k] = (ends[k] || 0) + r.tally[k];
            if (!(r.m.winner >= 0 && r.m.winner < 4)) bad = 'seed ' + seed + ' has no winner';
            won[(r.m.winner - seed % 3 + 3 * 4) % 3]++;
        } catch (e) { bad = e.message; break; }
    }
    expect(!bad, N + ' ' + mode + ' bot matches end with a winner, every tile accounted for after every move', bad || hands + ' hands, ' + moves + ' moves, ' + (Date.now() - t0) + 'ms, ' + JSON.stringify(ends));
    if (mode === 'classic') expect(ends.melds + ends.pairs > hands * 0.7, 'classic hands mostly end in a finish, not an empty pile', JSON.stringify(ends));
    else expect(ends.melds + ends.pairs > 0 && ends.pile < hands, '101 hands are finished as well as run dry', JSON.stringify(ends));
}
{
    // hard against easy: hand wins over many classic hands, seats rotated
    const w = { easy: 0, hard: 0 };
    for (let seed = 1; seed <= 40; seed++) {
        const levels = seed % 2 ? ['hard', 'easy', 'hard', 'easy'] : ['easy', 'hard', 'easy', 'hard'];
        const m = S.newMatch({ seed: 1000 + seed, start: 40, seats: levels.map(l => ({ bot: true, level: l })) });
        for (let h = 0; h < 3 && !m.over; h++) { S.playHand(m); const r = m.hand.result; if (r.winner >= 0) w[levels[r.winner]]++; if (!m.over) S.nextHand(m); }
    }
    expect(w.hard > w.easy, 'hard bots win more hands than easy ones', JSON.stringify(w));
}
{
    const a = playMatch({ seed: 99, mode: 'classic', start: 6, seats: [{ bot: true }, {}, {}, {}] });
    const b = playMatch({ seed: 99, mode: 'classic', start: 6, seats: [{ bot: true }, {}, {}, {}] });
    expect(JSON.stringify(a.m.history) === JSON.stringify(b.m.history) && a.moves === b.moves, 'the same seed plays the same match');
    // a save in the middle of a hand plays on exactly as the original
    const m = S.newMatch({ seed: 5, mode: '101', hands: 1, seats: [{ bot: true }, {}, {}, {}] });
    for (let i = 0; i < 25; i++) { const s = m.hand.turn; S.apply(m, s, S.botAct(m, s)); }
    const copy = JSON.parse(JSON.stringify(m));
    S.playHand(m); S.playHand(copy);
    expect(JSON.stringify(m.scores) === JSON.stringify(copy.scores) && m.hand.result.winner === copy.hand.result.winner, 'a saved match (JSON) plays on the same');
}
{
    // a guest's move is the same rules: refused out of turn, refused with someone else's tile
    const m = S.newMatch({ seed: 21, dealer: 0, seats: [{ bot: false }, { bot: false }, {}, {}] });
    expect(S.apply(m, 1, { t: 'discard', tile: m.hand.hands[1][0] }).err === 'not your turn', 'a guest out of turn is refused');
    expect(S.apply(m, 0, { t: 'discard', tile: m.hand.hands[1][0] }).err === "that tile isn't yours", "a tile from another rack is refused");
    expect(S.apply(m, 7, { t: 'draw' }).ok === false && S.apply(m, -1, { t: 'draw' }).ok === false, 'a seat that does not exist is refused');
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' okey checks FAILED' : checks + ' okey checks passed'));
process.exit(failures ? 1 : 0);
