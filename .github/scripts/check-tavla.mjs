// ===================================================================
// check-tavla.mjs — tavla 98's rules and bots, under node
//
//   the board    fifteen a side, 167 pips each, the same start every time
//   a move       hits, the bar first, a closed board, bearing off right
//   a turn       both dice if you can, the larger one if only one, doubles
//                four times; checked against a brute force on many positions
//   a game       mars is 2, a win is 1, undo goes back one checker
//   a match      first to the target; seeded bot matches always finish, with
//                fifteen checkers a side the whole way
//   the bots     hard beats easy, normal beats easy
//   the wire     snapshots survive the trip, junk does not
//
//   node .github/scripts/check-tavla.mjs
// ===================================================================
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
require(path.join(ROOT, 'games/tavla/tavla-sim.js'));
const S = globalThis.TAVLA_SIM;

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

// a position from a list of [seat, rel point, count]
function make(list, extra) {
    const pos = { p: new Array(24).fill(0), bar: [0, 0], off: [0, 0] };
    for (const [pl, r, n] of list) pos.p[S.abs(pl, r)] += pl ? -n : n;
    Object.assign(pos, extra || {});
    for (const pl of [0, 1]) { const missing = S.N - S.count(pos, pl); pos.off[pl] += missing; }
    return pos;
}
function matchAt(pos, turn, dice) {
    const s = S.newMatch({ seed: 7, target: 5 });
    s.pos = pos; s.turn = turn; s.phase = 'roll';
    s.r = 1;
    // roll the dice we want, honestly through the rules
    s.dice = dice; s.rem = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice.slice();
    s.phase = 'move'; s.turnStart = S.clonePos(pos); s.steps = [];
    return s;
}
const stepsKey = list => list.map(x => x.from + ':' + x.die).sort().join(' ');

// the slow honest way: every sequence, no shortcuts
function brute(pos, pl, rem) {
    const seqs = [];
    (function go(p, r, seq) {
        let any = false;
        for (let i = 0; i < r.length; i++) {
            if (r.indexOf(r[i]) !== i) continue;
            for (const from of S.stepsFor(p, pl, r[i])) {
                any = true;
                const c = S.clonePos(p);
                S.applyStep(c, pl, from, r[i]);
                const rr = r.slice(); rr.splice(i, 1);
                go(c, rr, seq.concat([{ from, die: r[i], pos: c }]));
            }
        }
        if (!any) seqs.push({ seq, end: p });
    })(pos, rem, []);
    const max = Math.max(...seqs.map(x => x.seq.length));
    let good = seqs.filter(x => x.seq.length === max);
    if (max === 1 && rem.length === 2 && rem[0] !== rem[1]) {
        const hi = Math.max(...rem);
        if (good.some(x => x.seq[0].die === hi)) good = good.filter(x => x.seq[0].die === hi);
    }
    if (max === 0) return { first: [], ends: new Set() };
    const first = new Map();
    good.forEach(x => first.set(x.seq[0].from + ':' + x.seq[0].die, { from: x.seq[0].from, die: x.seq[0].die }));
    return { first: [...first.values()], ends: new Set(good.map(x => S.posKey(x.end))) };
}

// ===================================================================
section('the board');
// ===================================================================
{
    const p = S.startPos();
    expect(S.count(p, 0) === 15 && S.count(p, 1) === 15, 'fifteen checkers a side');
    expect(S.pips(p, 0) === 167 && S.pips(p, 1) === 167, 'both sides start 167 pips from home');
    expect(S.own(p, 0, 23) === 2 && S.own(p, 1, 23) === 2 && S.own(p, 0, 5) === 5 && S.own(p, 1, 5) === 5, 'the two sides are mirror images');
    expect(S.contact(p) && !S.allHome(p, 0), 'everybody is in contact at the start');
    const a = S.newMatch({ seed: 99, target: 3 }), b = S.newMatch({ seed: 99, target: 3 });
    expect(JSON.stringify(a) === JSON.stringify(b), 'the same seed makes the same match');
    expect(a.opening[0] !== a.opening[1] && a.turn === (a.opening[0] > a.opening[1] ? 0 : 1), 'the opening roll is never a tie and the higher die starts', a.opening.join('-'));
    expect(a.phase === 'move' && a.dice.join() === a.opening.join(), 'the opener plays the two opening dice');
    expect(S.newMatch({ seed: 1, target: 9 }).target === 5 && S.newMatch({ target: '1' }).target === 1, 'the target is one of 1, 3 or 5');
}

// ===================================================================
section('a move');
// ===================================================================
{
    // a hit sends the checker to the bar
    const pos = make([[0, 10, 1], [1, 17, 1]]);           // red's rel 17 is white's rel 6
    const hit = S.applyStep(pos, 0, 10, 4);
    expect(hit && pos.bar[1] === 1 && S.own(pos, 0, 6) === 1 && S.foe(pos, 0, 6) === 0, 'landing on a lone checker hits it to the bar');
    // two or more block
    const blocked = make([[0, 10, 1], [1, 17, 2]]);
    expect(!S.stepsFor(blocked, 0, 4).includes(10), 'two checkers make a point nobody can land on');
    // the bar comes first
    const onBar = make([[0, 10, 2], [0, 5, 5]], {});
    onBar.bar[0] = 1; onBar.off[0] -= 1;
    expect(S.stepsFor(onBar, 0, 3).join() === '24', 'with a checker on the bar it is the only thing that can move');
    expect(S.dest(24, 3) === 21, 'it enters on the other side\'s home board');
    // a closed board: no way in
    const closed = make([[1, 0, 2], [1, 1, 2], [1, 2, 2], [1, 3, 2], [1, 4, 2], [1, 5, 2], [0, 12, 3]]);
    closed.bar[0] = 1; closed.off[0] -= 1;
    const s = matchAt(closed, 0, [6, 5]);
    expect(S.legal(s).length === 0, 'nothing enters a closed board');
    // bearing off
    const home = make([[0, 4, 2], [0, 1, 3]]);
    expect(S.stepsFor(home, 0, 5).includes(4) && S.stepsFor(home, 0, 6).includes(4), 'bear off exactly, or with a bigger die from the highest point');
    expect(!S.stepsFor(home, 0, 6).includes(1), 'but not from a lower point while a higher one is taken');
    expect(S.stepsFor(home, 0, 2).includes(4) && S.stepsFor(home, 0, 2).includes(1), 'a small die moves inside the home board instead');
    const notHome = make([[0, 4, 2], [0, 9, 1]]);
    expect(S.stepsFor(notHome, 0, 5).indexOf(4) < 0, 'nobody bears off before everybody is home');
}

// ===================================================================
section('a turn');
// ===================================================================
{
    // only one die can be played: it has to be the larger one
    const one = make([[0, 12, 1], [1, 22, 2], [1, 18, 2]]);   // red blocks white rel 1 and rel 5 (12-6-5=1, 12-6=6 ok, 12-5=7 ok)
    const st = matchAt(one, 0, [6, 5]);
    const legalOne = S.legal(st);
    const bf1 = brute(one, 0, [6, 5]);
    expect(legalOne.length === 1 && legalOne[0].die === 6, 'only one of two dice playable: the larger one', stepsKey(legalOne));
    expect(stepsKey(legalOne) === stepsKey(bf1.first), 'and the brute force agrees');
    // both dice must be used when they can be: 6 first leaves the 1 unplayable
    // white: one checker on rel 7; red holds rel 0 (7-6-1); 7-1=6 then 6-6=0 is
    // blocked, so the other order has to be found by playing... the rules only
    // allow the first steps of turns that use both dice
    const both = make([[0, 7, 1], [0, 13, 1], [1, 23 - 0, 2], [1, 23 - 12, 2]]);
    const bfb = brute(both, 0, [6, 1]);
    const lb = S.legalSteps(both, 0, [6, 1]);
    expect(stepsKey(lb) === stepsKey(bfb.first), 'a turn that can use both dice has to', stepsKey(lb) + ' vs ' + stepsKey(bfb.first));
    // doubles play four times
    const s = matchAt(S.startPos(), 0, [3, 3]);
    expect(s.rem.length === 4, 'doubles are four moves');
    for (let i = 0; i < 4; i++) { const l = S.legal(s); S.act(s, 0, { t: 'move', from: l[0].from, die: l[0].die }); }
    expect(s.rem.length === 0 && s.steps.length === 4 && S.pips(s.pos, 0) === 167 - 12, 'and all four come off the pip count');
    // against the brute force, on positions out of real games
    let compared = 0, mismatch = '';
    for (let seed = 1; seed <= 40 && !mismatch; seed++) {
        const m = S.newMatch({ seed, target: 1 });
        let guard = 0;
        while (m.phase !== 'match' && m.phase !== 'over' && guard++ < 400) {
            if (m.phase === 'roll') { S.act(m, m.turn, { t: 'roll' }); continue; }
            if (m.steps.length === 0 && compared < 1200) {
                const bf = brute(m.pos, m.turn, m.rem);
                const mine = S.legal(m);
                const opts = S.turnOptions(m.pos, m.turn, m.rem);
                const ends = new Set(opts.filter(o => o.seq.length).map(o => S.posKey(o.pos)));
                compared++;
                if (stepsKey(mine) !== stepsKey(bf.first)) mismatch = 'first steps ' + S.posKey(m.pos) + ' ' + m.rem + ': ' + stepsKey(mine) + ' vs ' + stepsKey(bf.first);
                else if (ends.size !== bf.ends.size || [...ends].some(k => !bf.ends.has(k))) mismatch = 'end positions ' + S.posKey(m.pos) + ' ' + m.rem;
            }
            const plan = S.botTurn(m, m.turn, seed % 2 ? 'easy' : 'normal');
            for (const x of plan) if (m.phase === 'move') S.act(m, m.turn, { t: 'move', from: x.from, die: x.die });
            if (m.phase === 'move') S.act(m, m.turn, { t: 'done' });
        }
    }
    expect(!mismatch && compared > 500, 'legal moves and whole turns match a brute force on ' + compared + ' positions from real games', mismatch);
}

// ===================================================================
section('a game');
// ===================================================================
{
    // white bears off the last checker while red has none off: mars
    const pos = make([[0, 0, 1], [1, 3, 15]]);
    pos.off[1] = 0;
    const s = matchAt(pos, 0, [2, 1]);
    expect(S.act(s, 1, { t: 'move', from: 0, die: 2 }) === 'not your turn', 'nobody moves out of turn');
    expect(S.act(s, 0, { t: 'move', from: 5, die: 2 }) !== null, 'a move from an empty point is refused');
    expect(S.act(s, 0, { t: 'done' }) !== null, 'and so is ending the turn with a move left');
    expect(S.act(s, 0, { t: 'move', from: 0, die: 2 }) === null, 'the last checker comes off');
    expect(s.phase === 'over' && s.result.winner === 0 && s.result.mars && s.score[0] === 2, 'mars: the loser had nothing off, 2 points', JSON.stringify(s.result));
    // and with one red checker off it is a plain win
    const pos2 = make([[0, 0, 1], [1, 3, 14]]);
    const s2 = matchAt(pos2, 0, [2, 1]);
    expect(S.act(s2, 0, { t: 'move', from: 0, die: 1 }) !== null, 'the last checker comes off with the larger die when either would do');
    S.act(s2, 0, { t: 'move', from: 0, die: 2 });
    expect(s2.result && !s2.result.mars && s2.score[0] === 1, 'one checker off saves the mars: 1 point');
    // a backgammon is still just a mars in the coffee house
    const pos3 = make([[0, 0, 1], [1, 20, 15]]);
    pos3.off[1] = 0;
    const s3 = matchAt(pos3, 0, [6, 1]);
    S.act(s3, 0, { t: 'move', from: 0, die: 6 });
    expect(s3.result && s3.result.pts === 2, 'red still in white\'s home board: still 2, there is no backgammon');
    // next game: the winner opens with a normal roll
    expect(S.act(s3, 1, { t: 'next' }) === null && s3.game === 2 && s3.turn === 0 && s3.phase === 'roll', 'the next game starts with the winner to roll');
    expect(S.count(s3.pos, 0) === 15 && S.count(s3.pos, 1) === 15 && s3.score[0] === 2, 'a fresh board, the score kept');
    // undo goes back one checker at a time
    const u = matchAt(S.startPos(), 0, [6, 5]);
    const before = S.posKey(u.pos);
    S.act(u, 0, { t: 'move', from: 23, die: 6 });
    const mid = S.posKey(u.pos);
    S.act(u, 0, { t: 'move', from: 17, die: 5 });
    expect(S.act(u, 0, { t: 'undo' }) === null && S.posKey(u.pos) === mid && u.rem.join() === '5', 'undo takes back the last checker');
    S.act(u, 0, { t: 'undo' });
    expect(S.posKey(u.pos) === before && u.rem.join() === '6,5' && S.act(u, 0, { t: 'undo' }) !== null, 'and the one before, and then there is nothing left to undo');
    // a turn with no move still has to be passed on
    const closed = make([[1, 0, 2], [1, 1, 2], [1, 2, 2], [1, 3, 2], [1, 4, 2], [1, 5, 2], [0, 12, 3]]);
    closed.bar[0] = 1; closed.off[0] -= 1;
    const nm = matchAt(closed, 0, [6, 5]);
    expect(S.act(nm, 0, { t: 'done' }) === null && nm.turn === 1 && nm.log[nm.log.length - 1].steps.length === 0, 'no move: the turn passes, and the log says so');
    expect(S.turnText(nm.log[nm.log.length - 1]) === '6-5: no move', 'in words too');
    expect(S.turnText({ dice: [6, 4], steps: [[24, 20, 0], [12, 6, 1]] }) === '6-4: bar/21 13/7*' && S.stepText({ from: 3, to: -1 }) === '4/off', 'the log speaks the usual notation');
    // an obvious bear-off is found for a person
    const race = make([[0, 5, 2], [0, 2, 3], [1, 4, 5]]);
    const r = matchAt(race, 0, [6, 3]);
    const ob = S.obviousBearOff(r);
    expect(ob && ob.length === 2 && ob.every(x => S.dest(x.from, x.die) === -1), 'a race at home bears two off with 6-3', JSON.stringify(ob));
    expect(S.obviousBearOff(matchAt(S.startPos(), 0, [6, 3])) === null, 'and nothing is obvious in a middle game');
}

// ===================================================================
section('a match');
// ===================================================================
function playMatch(seed, target, levels, watch) {
    const m = S.newMatch({ seed, target });
    let actions = 0, bad = '';
    while (m.phase !== 'match' && actions < 20000) {
        if (m.phase === 'over') { S.act(m, 0, { t: 'next' }); continue; }
        if (m.phase === 'roll') { S.act(m, m.turn, { t: 'roll' }); actions++; continue; }
        const plan = S.botTurn(m, m.turn, levels[m.turn]);
        for (const x of plan) {
            if (m.phase !== 'move') break;
            const err = S.act(m, m.turn, { t: 'move', from: x.from, die: x.die });
            if (err && !bad) bad = 'bot move refused: ' + err;
            actions++;
        }
        if (m.phase === 'move') {
            const err = S.act(m, m.turn, { t: 'done' });
            if (err && !bad) bad = 'bot left a move: ' + err;
        }
        if (watch && (S.count(m.pos, 0) !== 15 || S.count(m.pos, 1) !== 15) && !bad) bad = 'checkers went missing';
    }
    return { m, actions, bad };
}
{
    let finished = 0, bad = '', mars = 0, games = 0;
    const t0 = Date.now();
    for (let seed = 1; seed <= 150; seed++) {
        const lv = [S.LEVELS[seed % 3], S.LEVELS[(seed >> 1) % 2]];
        if (lv[0] === 'hard' && lv[1] === 'hard') lv[1] = 'easy';
        const { m, bad: b } = playMatch(seed, [1, 3, 5][seed % 3], lv, true);
        if (b && !bad) bad = 'seed ' + seed + ': ' + b;
        if (m.phase === 'match' && Math.max(...m.score) >= m.target && m.score[m.result.winner] >= m.target) finished++;
        games += m.games.length; mars += m.games.filter(g => g.mars).length;
        if (m.games.some(g => g.pts !== (g.mars ? 2 : 1))) bad = bad || 'seed ' + seed + ': points that are not 1 or 2';
    }
    expect(finished === 150 && !bad, '150 seeded bot matches all end with a winner at the target', bad || (games + ' games, ' + mars + ' mars, ' + (Date.now() - t0) + 'ms'));
    expect(mars > 0 && mars < games, 'some games end in a mars, most do not', mars + '/' + games);
    const a = playMatch(4242, 3, ['normal', 'hard']), b = playMatch(4242, 3, ['normal', 'hard']);
    expect(JSON.stringify(a.m) === JSON.stringify(b.m), 'a seeded match plays out the same twice');
}

// ===================================================================
section('the bots');
// ===================================================================
{
    function duel(lvA, lvB, n, seed0) {
        let a = 0;
        for (let i = 0; i < n; i++) {
            // alternate the seats so the opening roll is fair
            const flip = i % 2;
            const { m } = playMatch(seed0 + i, 1, flip ? [lvB, lvA] : [lvA, lvB]);
            if (m.result && (m.result.winner === 0) !== !!flip) a++;
        }
        return a;
    }
    const t0 = Date.now();
    const ne = duel('normal', 'easy', 60, 1000);
    expect(ne >= 39, 'normal beats easy most of the time', ne + '/60');
    const he = duel('hard', 'easy', 24, 2000);
    expect(he >= 16, 'hard beats easy most of the time', he + '/24, ' + (Date.now() - t0) + 'ms');
    // hard's thinking stays quick enough for a browser's main thread
    const m = S.newMatch({ seed: 31, target: 1 });
    let worst = 0;
    for (let k = 0; k < 40 && m.phase !== 'match' && m.phase !== 'over'; k++) {
        if (m.phase === 'roll') S.act(m, m.turn, { t: 'roll' });
        const t = Date.now();
        const plan = S.botTurn(m, m.turn, 'hard');
        worst = Math.max(worst, Date.now() - t);
        for (const x of plan) if (m.phase === 'move') S.act(m, m.turn, { t: 'move', from: x.from, die: x.die });
        if (m.phase === 'move') S.act(m, m.turn, { t: 'done' });
    }
    expect(worst < 400, 'a hard bot decides in well under half a second', worst + 'ms worst');
    // the bot always takes a forced hit-free entry rather than standing still
    const s = matchAt(make([[0, 10, 2], [0, 5, 12]], {}), 0, [4, 2]);
    s.pos.bar[0] = 1; s.pos.off[0] = 0; s.pos.p[S.abs(0, 5)] -= 1;
    const plan = S.botTurn(s, 0, 'hard');
    expect(plan.length === 2 && plan[0].from === 24, 'a bot with a checker on the bar enters it first', JSON.stringify(plan));
}

// ===================================================================
section('the wire');
// ===================================================================
{
    const s = S.newMatch({ seed: 5, target: 3 });
    const snap = S.snapshot(s);
    expect(S.validSnapshot(snap) && JSON.stringify(snap) === JSON.stringify(s), 'a snapshot is the whole match, plain data');
    const junk = S.snapshot(s); junk.pos.p[5] = 9;
    expect(!S.validSnapshot(junk), 'one with checkers made up is turned away');
    expect(!S.validSnapshot(null) && !S.validSnapshot({ pos: { p: [] } }) && !S.validSnapshot(Object.assign(S.snapshot(s), { phase: 'party' })), 'and so is junk');
    expect(S.act(s, s.turn, { t: 'move', from: '<img>', die: 99 }) !== null && S.act(s, s.turn, null) !== null && S.act(s, s.turn, { t: 'teleport' }) !== null, 'nonsense actions are refused');
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' tavla checks FAILED' : checks + ' tavla checks passed'));
process.exit(failures ? 1 : 0);
