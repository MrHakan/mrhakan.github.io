// ===================================================================
// check-kartz.mjs — kartz 98's rules, bots and wire, under node
//
//   the deck     52 cards, a shuffle per seed, the same seed the same deal
//   batak        bidding (min 5, the forced dealer, the end of the auction),
//                follow / beat / trump / over-trump, trumps not led until
//                broken, the trick winner, the scoring
//   king         the contract quotas (two of each penalty, two trumps each),
//                the hearts lock, the forced king of hearts, early ends, a
//                whole game summing to zero
//   pisti        capture by rank and by jack, pisti 10 and 20, card points,
//                most cards, partners, every card accounted for
//   the bots     always legal, every match ends, and they beat random play
//   the wire     a seat's view hides every other hand and the deck; a guest's
//                action is read and checked, never believed
//
//   node .github/scripts/check-kartz.mjs
// ===================================================================
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = require(path.join(ROOT, 'games/kartz/kartz-sim.js'));

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
const C = (s, r) => S.card(s, r);
const [CL, DI, HE, SP] = [0, 1, 2, 3];
const clone = o => JSON.parse(JSON.stringify(o));
// a hand already in play, with the cards we want where we want them
function trickState(game, o) {
    const st = S.newMatch({ game, seed: 1, seats: [] });
    Object.assign(st, { phase: 'play', trick: [], trump: -1, broken: false, turn: 0, leader: 0 }, o);
    return st;
}
function runBots(st, policy) {
    let guard = 0;
    while (!st.over && guard++ < 200000) {
        if (st.turn >= 0) {
            const a = policy ? policy(st, st.turn) : S.bot(st, st.turn);
            if (!S.act(st, st.turn, a)) return 'illegal ' + JSON.stringify(a) + ' in ' + st.phase;
        } else if (!S.advance(st)) return 'stuck in ' + st.phase;
    }
    return st.over ? '' : 'never ended';
}
function lcg(seed) { let x = seed >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); }

// ===================================================================
section('the deck');
// ===================================================================
{
    const a = S.newMatch({ game: 'batak', seed: 42, seats: [{ id: 'a', name: 'ana' }] });
    const all = a.hands.flat();
    expect(all.length === 52 && new Set(all).size === 52 && all.every(c => c >= 0 && c < 52), 'batak deals all 52 cards, thirteen each, no card twice');
    const b = S.newMatch({ game: 'batak', seed: 42, seats: [{ id: 'a', name: 'ana' }] });
    expect(JSON.stringify(a.hands) === JSON.stringify(b.hands), 'the same seed deals the same hands');
    const c = S.newMatch({ game: 'batak', seed: 43, seats: [{ id: 'a', name: 'ana' }] });
    expect(JSON.stringify(a.hands) !== JSON.stringify(c.hands), 'another seed deals other hands');
    expect(a.n === 4 && a.seats[0].name === 'ana' && a.seats.slice(1).every(p => p.bot), 'one person and three bots at a batak table');
    expect(S.label(C(HE, 14)) === 'A\u2665' && S.label(C(CL, 10)) === '10\u2663', 'cards have names');
    expect(S.newMatch({ game: 'pisti', seed: 1, seats: [{ id: 'a' }, { id: 'b' }] }).n === 2 && S.newMatch({ game: 'pisti', seed: 1, seats: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }).n === 4, 'pisti: two people sit two, three sit four with a bot');
}

// ===================================================================
section('batak: the auction');
// ===================================================================
{
    const st = S.newMatch({ game: 'batak', seed: 7, seats: [] });
    const first = st.turn;
    expect(st.phase === 'bid' && first === (st.dealer + 1) % 4, 'the auction starts left of the dealer');
    const opts = S.legal(st, first).map(o => o.v);
    expect(opts[0] === 0 && opts[1] === 5 && opts[opts.length - 1] === 13, 'pass, or 5 to 13', opts.join());
    expect(!S.act(st, first, { t: 'bid', v: 4 }) && !S.act(st, (first + 1) % 4, { t: 'bid', v: 6 }), 'a bid under 5 is refused, and so is one out of turn');
    S.act(st, first, { t: 'bid', v: 6 });
    expect(!S.legal(st, st.turn).some(o => o.v > 0 && o.v <= 6), 'the next bid must be higher');
    // everybody passes: the dealer is stuck with it
    const f = S.newMatch({ game: 'batak', seed: 8, seats: [] });
    for (let k = 0; k < 3; k++) S.act(f, f.turn, { t: 'bid', v: 0 });
    expect(f.turn === f.dealer && !S.legal(f, f.turn).some(o => o.v === 0), 'three passes: the dealer has to bid');
    S.act(f, f.turn, { t: 'bid', v: 5 });
    expect(f.phase === 'trump' && f.turn === f.dealer && f.bidder === f.dealer && f.high === 5, 'and names trumps');
    // a normal auction to its end
    const g = S.newMatch({ game: 'batak', seed: 9, seats: [] });
    const a = g.turn;
    S.act(g, a, { t: 'bid', v: 5 });
    S.act(g, g.turn, { t: 'bid', v: 7 });
    const high = (a + 1) % 4;
    S.act(g, g.turn, { t: 'bid', v: 0 }); S.act(g, g.turn, { t: 'bid', v: 0 });
    expect(g.phase === 'bid' && g.turn === a, 'passed seats are skipped: back to the first bidder');
    S.act(g, a, { t: 'bid', v: 0 });
    expect(g.phase === 'trump' && g.bidder === high && g.high === 7 && g.turn === high, 'the last one standing wins the bid at 7');
    S.act(g, high, { t: 'trump', s: SP });
    expect(g.phase === 'play' && g.trump === SP && g.turn === high, 'and leads after naming spades');
}

// ===================================================================
section('batak: what may be played');
// ===================================================================
{
    let st = trickState('batak', { trump: SP });
    st.hands[0] = [C(SP, 2), C(HE, 3), C(HE, 9)];
    expect(S.legal(st, 0).every(o => S.suitOf(o.c) !== SP), 'trumps cannot be led before they are broken');
    st.hands[0] = [C(SP, 2), C(SP, 9)];
    expect(S.legal(st, 0).length === 2, 'unless trumps are all there is');
    st.broken = true; st.hands[0] = [C(SP, 2), C(HE, 3)];
    expect(S.legal(st, 0).length === 2, 'once broken, anything can be led');
    st = trickState('batak', { trump: SP, trick: [{ s: 3, c: C(HE, 10) }] });
    st.hands[0] = [C(HE, 4), C(HE, 12), C(HE, 14), C(CL, 9)];
    expect(S.legal(st, 0).map(o => o.c).sort().join() === [C(HE, 12), C(HE, 14)].sort().join(), 'follow suit and beat the 10 if you can');
    st.hands[0] = [C(HE, 4), C(HE, 6), C(CL, 9)];
    expect(S.legal(st, 0).map(o => o.c).sort().join() === [C(HE, 4), C(HE, 6)].sort().join(), 'can not beat it: any heart');
    st.hands[0] = [C(SP, 3), C(SP, 11), C(CL, 9)];
    expect(S.legal(st, 0).map(o => o.c).sort().join() === [C(SP, 3), C(SP, 11)].sort().join(), 'void in hearts: must trump');
    st.trick.push({ s: 1, c: C(SP, 8) });
    expect(S.legal(st, 0).map(o => o.c).join() === String(C(SP, 11)), 'and over-trump the 8 when you can');
    st.hands[0] = [C(SP, 3), C(CL, 9)];
    expect(S.legal(st, 0).map(o => o.c).join() === String(C(SP, 3)), 'a trump that can not over-trump still has to go');
    st.hands[0] = [C(CL, 9), C(DI, 2)];
    expect(S.legal(st, 0).length === 2, 'no hearts and no trumps: anything');
    // who takes it
    const w = trickState('batak', { trump: SP, trick: [{ s: 0, c: C(HE, 10) }, { s: 1, c: C(HE, 14) }, { s: 2, c: C(SP, 2) }, { s: 3, c: C(CL, 14) }] });
    expect(S.trickWinner(w) === 2, 'the two of trumps beats the ace of hearts');
    const w2 = trickState('batak', { trump: SP, trick: [{ s: 0, c: C(HE, 10) }, { s: 1, c: C(HE, 14) }, { s: 2, c: C(DI, 14) }, { s: 3, c: C(HE, 2) }] });
    expect(S.trickWinner(w2) === 1, 'no trumps: the highest of the led suit; an off-suit ace counts for nothing');
}

// ===================================================================
section('batak: scoring a hand');
// ===================================================================
{
    for (const seed of [11, 12, 13, 14]) {
        const st = S.newMatch({ game: 'batak', seed, seats: [] });
        S.act(st, st.turn, { t: 'bid', v: 6 });
        while (st.phase === 'bid') S.act(st, st.turn, { t: 'bid', v: 0 });
        const bidder = st.bidder;
        S.act(st, bidder, { t: 'trump', s: HE });
        // play out with a policy that makes the bidder win or lose; then fix the trick counts and check the arithmetic
        const err = (() => { let g = 0; while (st.phase !== 'handEnd' && g++ < 500) { if (st.turn >= 0) S.act(st, st.turn, S.bot(st, st.turn)); else S.advance(st); } return st.phase; })();
        const tr = st.summary.tricks, pts = st.summary.pts;
        const ok = tr.every((t, i) => pts[i] === (i === bidder ? (t >= 6 ? t : -6) : t)) && tr.reduce((a, b) => a + b, 0) === 13;
        expect(err === 'handEnd' && ok, 'seed ' + seed + ': thirteen tricks; the bidder ' + (tr[bidder] >= 6 ? 'made it: + tricks' : 'went down: minus the bid') + ', the others + tricks', 'tricks ' + tr.join() + ' pts ' + pts.join());
    }
}

// ===================================================================
section('king');
// ===================================================================
{
    const st = S.newMatch({ game: 'king', seed: 5, seats: [] });
    expect(st.phase === 'pick' && st.turn === 0 && S.legal(st, 0).length === 7, 'hand one: the first chooser has all seven contracts');
    expect(!S.act(st, 1, { t: 'pick', k: 'el' }) && !S.act(st, 0, { t: 'pick', k: 'nope' }), 'out of turn, or a contract that does not exist: refused');
    // quotas
    const q = S.newMatch({ game: 'king', seed: 6, seats: [] });
    q.used.kiz = 2; q.picks[0] = { koz: 2, pen: 1 };
    const ks = S.legal(q, 0).map(o => o.k);
    expect(!ks.includes('kiz') && !ks.includes('koz') && ks.length === 5, 'a penalty called twice is gone, and so are trumps after two', ks.join());
    q.picks[0] = { koz: 1, pen: 3 };
    expect(S.legal(q, 0).map(o => o.k).join() === 'koz', 'three penalties called: trumps it has to be');
    // hearts lock and forced cards
    let t = trickState('king', { contract: 'kupa' });
    t.hands[0] = [C(HE, 2), C(CL, 5)];
    expect(S.legal(t, 0).map(o => o.c).join() === String(C(CL, 5)), 'no hearts: hearts can not be led before one is played');
    t = trickState('king', { contract: 'kupa', trick: [{ s: 3, c: C(CL, 9) }] });
    t.hands[0] = [C(HE, 2), C(SP, 5)];
    expect(S.legal(t, 0).map(o => o.c).join() === String(C(HE, 2)), 'void in the led suit: a heart has to go');
    t = trickState('king', { contract: 'rifki', trick: [{ s: 3, c: C(CL, 9) }] });
    t.hands[0] = [C(HE, 2), C(HE, 13), C(SP, 5)];
    expect(S.legal(t, 0).map(o => o.c).join() === String(S.KING_HEARTS), 'king of hearts: void, and the king has to go');
    t = trickState('king', { contract: 'el', trick: [{ s: 3, c: C(CL, 9) }] });
    t.hands[0] = [C(CL, 2), C(CL, 14)];
    expect(S.legal(t, 0).length === 2, 'penalty hands: follow suit, no need to beat');
    // whole games
    let zero = true, early = 0, quotas = true, err = '';
    for (let seed = 1; seed <= 60; seed++) {
        const g = S.newMatch({ game: 'king', seed, seats: [] });
        let guard = 0;
        while (!g.over && guard++ < 200000) {
            if (g.turn >= 0) { if (!S.act(g, g.turn, S.bot(g, g.turn))) { err = 'illegal'; break; } }
            else { if (g.phase === 'handEnd' && g.trickNo < 13) early++; S.advance(g); }
        }
        if (g.scores.reduce((a, b) => a + b, 0) !== 0) zero = false;
        const used = g.history.reduce((m, r) => { m[r.contract] = (m[r.contract] || 0) + 1; return m; }, {});
        if (g.history.length !== 20 || used.koz !== 8 || S.PENALTIES.some(k => used[k] !== 2) || g.picks.some(p => p.koz !== 2 || p.pen !== 3)) quotas = false;
    }
    expect(!err && quotas, 'sixty bot games: twenty hands, every penalty twice, two trump hands each');
    expect(zero, 'and every game adds up to exactly zero');
    expect(early > 0, 'hands with nothing left to lose stop early', early + ' hands');
}

// ===================================================================
section('pisti');
// ===================================================================
{
    const st = S.newMatch({ game: 'pisti', seed: 3, seats: [{ id: 'a' }, { id: 'b' }] });
    expect(st.pile.length === 4 && st.pileHidden === 3 && S.rankOf(st.pile[3]) !== 11, 'four on the table, three hidden, the top one never a jack');
    expect(st.hands.every(h => h.length === 4) && st.deck.length === 40, 'four each, forty in the deck');
    // a pisti
    const p = clone(st);
    p.pile = [C(HE, 7)]; p.pileHidden = 0; p.hands[p.turn] = [C(CL, 7), C(DI, 3), C(SP, 4), C(SP, 6)];
    const who = p.turn;
    S.act(p, who, { t: 'play', c: C(CL, 7) });
    expect(p.pistis[who] === 1 && p.handPts[who] === 10 && p.taken[who] === 2 && p.pile.length === 0, 'a lone 7 taken by a 7: pisti, 10 points');
    const j = clone(st);
    j.pile = [C(HE, 11)]; j.pileHidden = 0; j.hands[j.turn] = [C(CL, 11), C(DI, 3), C(SP, 4), C(SP, 6)];
    S.act(j, j.turn, { t: 'play', c: C(CL, 11) });
    expect(j.handPts[st.turn] === 22, 'jack on a lone jack: 20, and a point for each jack', j.handPts[st.turn]);
    const jk = clone(st);
    jk.pile = [C(HE, 5)]; jk.pileHidden = 0; jk.hands[jk.turn] = [C(CL, 11), C(DI, 3), C(SP, 4), C(SP, 6)];
    S.act(jk, jk.turn, { t: 'play', c: C(CL, 11) });
    expect(jk.pistis[st.turn] === 0 && jk.handPts[st.turn] === 1 && jk.taken[st.turn] === 2, 'a jack on a lone 5 sweeps it, but is no pisti');
    const big = clone(st);
    big.pile = [C(DI, 10), C(CL, 2), C(HE, 14), C(SP, 9)]; big.pileHidden = 0; big.hands[big.turn] = [C(HE, 9), C(DI, 3), C(SP, 4), C(SP, 6)];
    S.act(big, big.turn, { t: 'play', c: C(HE, 9) });
    expect(big.handPts[st.turn] === 6 && big.taken[st.turn] === 5, 'a 9 on a 9 takes the pile: ten of diamonds 3, two of clubs 2, the ace 1');
    const miss = clone(st);
    miss.pile = [C(HE, 5)]; miss.pileHidden = 0; miss.hands[miss.turn] = [C(CL, 8), C(DI, 3), C(SP, 4), C(SP, 6)];
    S.act(miss, miss.turn, { t: 'play', c: C(CL, 8) });
    expect(miss.pile.length === 2 && miss.taken[st.turn] === 0, 'no match: the card goes on the pile');
    expect(S.cardPoints(C(CL, 2)) === 2 && S.cardPoints(C(DI, 10)) === 3 && S.cardPoints(C(SP, 14)) === 1 && S.cardPoints(C(HE, 11)) === 1 && S.cardPoints(C(HE, 10)) === 0, 'the card points');
    // whole hands: every card accounted for
    let counted = true, partners = true, err = '';
    for (let seed = 1; seed <= 200; seed++) {
        const n = seed % 2 ? 2 : 4;
        const g = S.newMatch({ game: 'pisti', seed, n, seats: [] });
        let guard = 0;
        while (!g.over && guard++ < 100000) {
            if (g.turn >= 0 && g.phase === 'play') { if (!S.act(g, g.turn, S.bot(g, g.turn))) { err = 'illegal'; break; } }
            else if (g.phase === 'handEnd') {
                const r = g.summary;
                if (r.taken.reduce((a, b) => a + b, 0) !== 52) counted = false;
                const pis = r.pistis.reduce((a, b) => a + b, 0);
                const bonus = r.raw.reduce((a, b) => a + b, 0) - 13 - (r.most >= 0 ? 3 : 0);
                if (bonus < pis * 10 || bonus > pis * 20 || bonus % 10) counted = false;
                if (n === 4 && (r.pts[0] !== r.pts[2] || r.pts[1] !== r.pts[3])) partners = false;
                S.advance(g);
            } else S.advance(g);
        }
        if (!g.over) err = err || 'never ended';
    }
    expect(!err, 'two hundred bot games, two and four players, all ended', err);
    expect(counted, 'every hand: all 52 cards taken, 13 card points plus most cards');
    expect(partners, 'partners across the table share their points');
}

// ===================================================================
section('the bots');
// ===================================================================
{
    for (const [game, n, games] of [['batak', 4, 300], ['king', 4, 80], ['pisti', 2, 300], ['pisti', 4, 200]]) {
        let bad = '', hands = 0;
        for (let seed = 1; seed <= games; seed++) {
            const st = S.newMatch({ game, n, seed: seed * 7919, seats: [] });
            const e = runBots(st);
            if (e) { bad = 'seed ' + seed + ': ' + e; break; }
            hands += st.history.length;
            if (!st.winners.length || st.winners.some(w => st.scores[w] !== Math.max(...st.scores))) { bad = 'seed ' + seed + ' winners wrong'; break; }
        }
        expect(!bad, game + (game === 'pisti' ? ' for ' + n : '') + ': ' + games + ' bot matches, every move legal, every match ends with the top score winning', bad || (hands / games).toFixed(1) + ' hands a match');
    }
    // the bots against somebody playing whatever is legal
    const randomPolicy = r => (st, seat) => { const o = S.legal(st, seat); return o[Math.floor(r() * o.length)]; };
    for (const [game, n] of [['batak', 4], ['king', 4], ['pisti', 2]]) {
        let botWins = 0, total = 0, botPts = 0, rndPts = 0;
        for (let seed = 1; seed <= 120; seed++) {
            const st = S.newMatch({ game, n, seed, seats: [] });
            const r = lcg(seed), rnd = randomPolicy(r);
            const e = runBots(st, (s, seat) => (seat === 0 ? rnd(s, seat) : S.bot(s, seat)));
            if (e) { botWins = -1; break; }
            total++;
            if (!st.winners.includes(0)) botWins++;
            botPts += n === 2 ? st.scores[1] : (st.scores[1] + st.scores[2] + st.scores[3]) / 3;
            rndPts += st.scores[0];
        }
        expect(botPts > rndPts, game + ': the bots score more than a random player', 'bots ' + (botPts / total).toFixed(1) + ' a match, random ' + (rndPts / total).toFixed(1));
    }
    // batak bidders make their bid more often than not
    let bids = 0, made = 0;
    for (let seed = 1; seed <= 200; seed++) {
        const st = S.newMatch({ game: 'batak', seed, seats: [] });
        runBots(st);
        for (const h of st.history) { bids++; if (h.tricks[h.bidder] >= h.bid) made++; }
    }
    expect(made / bids > 0.5, 'batak: bidding bots make their bid more often than not', (100 * made / bids).toFixed(0) + '% of ' + bids);
}

// ===================================================================
section('the wire');
// ===================================================================
{
    const st = S.newMatch({ game: 'batak', seed: 21, seats: [{ id: 'h', name: 'host' }, { id: 'g', name: 'guest' }] });
    const v = S.view(st, 1);
    expect(v.hands[1].join() === st.hands[1].join() && [0, 2, 3].every(i => v.hands[i].length === 13 && v.hands[i].every(c => c === -1)), 'a seat sees its own thirteen and only the backs of the others');
    expect(v.rng === undefined && v.me === 1, 'and not the rng, which would give the deal away');
    const hv = S.view(Object.assign(clone(st), { phase: 'play', turn: 2 }), 1);
    expect(S.legal(hv, 2).length === 0, 'a hidden hand has no moves in a view');
    const p = S.newMatch({ game: 'pisti', seed: 22, seats: [{ id: 'h' }, { id: 'g' }] });
    const pv = S.view(p, 0);
    expect(pv.deck === 40 && pv.pile.slice(0, 3).every(c => c === -1) && pv.pile[3] === p.pile[3], 'pisti: the deck is a number, the three face down cards stay face down');
    expect(JSON.stringify(pv).length < 4000 && JSON.stringify(S.view(st, 0)).length < 4000, 'a view is small enough to send on every move', JSON.stringify(S.view(st, 0)).length + ' bytes');
    expect(S.readAction({ t: 'play', c: 12 }).c === 12 && S.readAction({ t: 'pick', k: 'kiz' }).k === 'kiz', 'a well formed action reads');
    const junk = [null, 'x', { t: 'cheat' }, { t: 'play', c: 99 }, { t: 'play', c: 1.5 }, { t: 'play', c: '3' }, { t: 'pick', k: '__proto__' }, { t: 'bid', v: -1 }];
    expect(junk.every(d => S.readAction(d) === null), 'junk, out of range numbers and strange contracts do not', junk.length + ' tried');
    // a guest claiming a card it does not hold
    const g = S.newMatch({ game: 'batak', seed: 23, seats: [{ id: 'h' }, { id: 'g' }] });
    while (g.phase !== 'play') S.act(g, g.turn, S.bot(g, g.turn));
    const other = g.hands[(g.turn + 1) % 4][0];
    expect(!S.act(g, g.turn, { t: 'play', c: other }), 'a card from somebody else\'s hand is refused');
    const before = JSON.stringify(g);
    expect(!S.act(g, (g.turn + 1) % 4, S.bot(g, g.turn) || { t: 'play', c: 0 }) && JSON.stringify(g) === before, 'out of turn: refused, and nothing changed');
    expect(S.seatBot(g, 1) && g.seats[1].bot && !S.seatBot(g, 1), 'a seat whose player left becomes a bot, once');
    // two copies of the sim, the same actions: the same match
    const a = S.newMatch({ game: 'king', seed: 99, seats: [] }), b = S.newMatch({ game: 'king', seed: 99, seats: [] });
    runBots(a); runBots(b);
    expect(JSON.stringify(a.scores) === JSON.stringify(b.scores) && a.evN === b.evN, 'the same seed plays the same game twice', a.scores.join());
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' kartz checks FAILED' : checks + ' kartz checks passed'));
process.exit(failures ? 1 : 0);
