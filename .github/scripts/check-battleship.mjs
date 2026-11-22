// ===================================================================
// check-battleship.mjs: battleship 98's rules, bot and fair-play receipt, under node
//
//   fleet     5-4-3-3-2, in the sea, no overlaps, no touching (corners too)
//   placing   10,000 seeded random fleets: every one legal, inside the try cap,
//             the same seed the same fleet
//   answers   miss / hit / sunk with the ship's length, repeat shots refused
//   bots      hundreds of matches per level, always finished, never a wasted
//             shot on known water above easy, hard < normal < easy in shots
//   receipt   commit + reveal: honest passes; another fleet, an illegal fleet
//             with a matching hash, one false answer, an early or mislabelled
//             sinking and a repeated cell all fail; no reveal is a forfeit
//   saves     a match through JSON plays on the same
//   duel      online, one side each: wrong turn, wrong running number, a
//             repeated or off-sea cell and malformed answers are refused; an
//             honest duel agrees and verifies, a lying one is void, leaving
//             before the reveal is a forfeit
//
//   node .github/scripts/check-battleship.mjs
// ===================================================================
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = require(path.join(ROOT, 'games/battleship/battleship-sim.js'));

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
const clone = o => JSON.parse(JSON.stringify(o));

// a hand-made legal fleet, one ship per row pair
const FLEET = [
    { x: 0, y: 0, len: 5, dir: 'h' },
    { x: 0, y: 2, len: 4, dir: 'h' },
    { x: 0, y: 4, len: 3, dir: 'h' },
    { x: 0, y: 6, len: 3, dir: 'h' },
    { x: 9, y: 0, len: 2, dir: 'v' }
];

section('fleet');
expect(S.validFleet(FLEET), 'a 5-4-3-3-2 fleet with room between is legal');
expect(!S.validFleet(FLEET.slice(0, 4)), 'four ships is not a fleet', S.fleetProblem(FLEET.slice(0, 4)));
{ const f = clone(FLEET); f[4].len = 3; expect(!S.validFleet(f), 'the wrong lengths are refused', S.fleetProblem(f)); }
{ const f = clone(FLEET); f[1].y = 0; f[1].x = 2; expect(S.fleetProblem(f) === 'two ships overlap', 'overlapping ships are refused', S.fleetProblem(f)); }
{ const f = clone(FLEET); f[1].y = 1; expect(!S.validFleet(f), 'ships side by side are refused', S.fleetProblem(f)); }
{ const f = clone(FLEET); f[4] = { x: 5, y: 1, len: 2, dir: 'v' }; expect(S.fleetProblem(f) === 'two ships touch', 'ships touching at a corner are refused', S.fleetProblem(f)); }
{ const f = clone(FLEET); f[4] = { x: 9, y: 9, len: 2, dir: 'h' }; expect(!S.validFleet(f), 'a ship hanging off the board is refused', S.fleetProblem(f)); }
{ const f = clone(FLEET); f[4].dir = 'd'; expect(!S.validFleet(f), 'a ship lies h or v'); }
expect(!S.validFleet(null) && !S.validFleet('garbage'), 'garbage is not a fleet');

section('placing');
{
    let bad = 0, maxTries = 0, firstBad = null;
    for (let seed = 1; seed <= 10000; seed++) {
        const { ships, tries } = S.placeFleet(S.makeRng(seed));
        maxTries = Math.max(maxTries, tries);
        if (!S.validFleet(ships)) { bad++; firstBad = firstBad || seed; }
    }
    expect(bad === 0, '10,000 seeded fleets are all legal', bad ? 'first bad seed ' + firstBad : undefined);
    expect(maxTries <= S.MAX_TRIES, 'and every one inside the try cap', 'worst ' + maxTries + ' of ' + S.MAX_TRIES);
    expect(S.encodeFleet(S.randomFleet(42)) === S.encodeFleet(S.randomFleet(42)), 'the same seed places the same fleet');
    expect(S.encodeFleet(S.randomFleet(42)) !== S.encodeFleet(S.randomFleet(43)), 'another seed, another fleet');
}

section('answers');
{
    const hit = new Set();
    expect(S.answer(FLEET, hit, 5, 5).result === 'miss', 'open water is a miss');
    expect(S.answer(FLEET, hit, 9, 0).result === 'hit', 'the first cell of the 2 is a hit');
    hit.add('9,0');
    const a = S.answer(FLEET, hit, 9, 1);
    expect(a.result === 'sunk' && a.len === 2, 'its second cell sinks it, and says it was the 2', JSON.stringify(a));

    const g = S.newGame({ seed: 7, fleet: FLEET });
    expect(S.encodeFleet(g.fleets[0]) === S.encodeFleet(FLEET), 'a match takes the fleet the player laid out');
    let threw = false; try { S.newGame({ seed: 7, fleet: FLEET.slice(0, 4) }); } catch (e) { threw = true; }
    expect(threw, 'and refuses an illegal one');
    const r1 = S.fire(g, 0, 0);
    expect(r1.side === 0 && g.turn === 1, 'a legal shot passes the turn', JSON.stringify(r1));
    g.turn = 0;
    expect(S.fire(g, 0, 0).result === 'invalid' && g.turn === 0, 'the same cell twice is refused and keeps the turn');
    expect(S.fire(g, 10, 0).result === 'invalid' && S.fire(g, 1.5, 0).result === 'invalid', 'off the board and half cells are refused');
}

section('bots');
// how many shots one level needs to sink a whole fleet, firing alone
function shotsToSink(level, seed) {
    const g = S.newGame({ seed, level });
    let n = 0, wasted = 0;
    while (!S.over(g)) {
        g.turn = 0;
        const known = S.knowledge(g.shots[0]);
        const m = S.botMove(g);
        if (known.water.has(m.x + ',' + m.y)) wasted++;
        const r = S.fire(g, m.x, m.y);
        if (r.result === 'invalid' || ++n > 100) return { n: Infinity, wasted };
    }
    return { n, wasted };
}
const avg = {};
for (const level of S.LEVELS) {
    let total = 0, worst = 0, wasted = 0, unfinished = 0;
    const N = 300;
    for (let seed = 1; seed <= N; seed++) {
        const r = shotsToSink(level, seed * 7919);
        if (!isFinite(r.n)) unfinished++;
        else { total += r.n; worst = Math.max(worst, r.n); }
        wasted += r.wasted;
    }
    avg[level] = total / N;
    expect(unfinished === 0, level + ': ' + N + ' fleets sunk, no illegal or endless shooting', 'mean ' + avg[level].toFixed(1) + ', worst ' + worst);
    if (level !== 'easy') expect(wasted === 0, level + ' never fires at known water', wasted + ' wasted');
}
expect(avg.hard < avg.normal && avg.normal < avg.easy, 'hard sinks a fleet in fewer shots than normal, normal than easy',
    ['easy', 'normal', 'hard'].map(l => l + ' ' + avg[l].toFixed(1)).join(', '));
{
    let finished = 0, bad = 0;
    for (let seed = 1; seed <= 200; seed++) {
        const g = S.newGame({ seed, level: S.LEVELS[seed % 3] });
        for (let i = 0; i < 200 && !S.over(g); i++) { const m = S.botMove(g); if (S.fire(g, m.x, m.y).result === 'invalid') { bad++; break; } }
        if (S.over(g)) finished++;
    }
    expect(finished === 200 && bad === 0, '200 bot-vs-bot matches across the levels all end with a winner', finished + ' finished, ' + bad + ' invalid');
}

section('receipt');
// play a real match and keep what side 1 answered to side 0's shots
const g = S.newGame({ seed: 99, level: 'hard' });
while (!S.over(g)) { const m = S.botMove(g); S.fire(g, m.x, m.y); }
const ships = g.fleets[1], salt = S.newSalt(), commitment = await S.commitFleet(ships, salt);
const log = g.shots[0].map(s => ({ ...s }));
expect(/^[0-9a-f]{64}$/.test(commitment) && /^[0-9a-f]{32}$/.test(salt), 'the commitment is a sha-256 hex, the salt 16 random bytes');
expect(await S.commitFleet(clone(ships).reverse(), salt) === commitment, 'ship order does not change the commitment');
expect(await S.commitFleet(ships, S.newSalt()) !== commitment, 'a new salt does');
const check = async (r, ok, msg) => { const v = await S.verifyReveal({ ships, salt, commitment, log, ...r }); expect(v.ok === ok, msg, v.reason); return v; };
await check({}, true, 'an honest reveal of a whole match verifies (' + log.length + ' answers)');
{
    const other = S.randomFleet(12345);
    await check({ ships: other }, false, 'another fleet than the committed one fails');
    const four = ships.slice(0, 4), c4 = await S.commitFleet(four, salt);
    await check({ ships: four, commitment: c4, log: [] }, false, 'a matching hash on a four-ship fleet still fails');
    const stack = clone(ships); stack[1] = { ...stack[0], len: stack[1].len }; const cs = await S.commitFleet(stack, salt);
    await check({ ships: stack, commitment: cs, log: [] }, false, 'a matching hash on overlapping ships still fails');
}
{
    const i = log.findIndex(s => s.result === 'hit');
    const lie = clone(log); lie[i] = { x: lie[i].x, y: lie[i].y, result: 'miss' };
    await check({ log: lie }, false, 'one hit answered as a miss voids the match');
    const j = log.findIndex(s => s.result === 'sunk');
    const early = clone(log); const k = early.findIndex(s => s.result === 'hit');
    early[k] = { ...early[k], result: 'sunk', len: early[j].len };
    await check({ log: early }, false, 'a sinking claimed before the last cell is hit voids it');
    const wrongLen = clone(log); wrongLen[j] = { ...wrongLen[j], len: wrongLen[j].len === 2 ? 3 : 2 };
    await check({ log: wrongLen }, false, 'a sinking with the wrong length voids it');
    const dup = clone(log); dup.splice(1, 0, { ...dup[0] });
    await check({ log: dup }, false, 'an answer to a cell already answered voids it');
}
expect(S.verdict(false) === 'forfeit', 'no reveal (left before the end) is a forfeit');
expect(S.verdict(true, { ok: true }) === 'verified' && S.verdict(true, { ok: false }) === 'void', 'a reveal is verified or void');

section('saves');
{
    const a = S.newGame({ seed: 2024, level: 'hard' });
    for (let i = 0; i < 30; i++) { const m = S.botMove(a); S.fire(a, m.x, m.y); }
    const b = clone(a);
    while (!S.over(a)) { const m = S.botMove(a); S.fire(a, m.x, m.y); }
    while (!S.over(b)) { const m = S.botMove(b); S.fire(b, m.x, m.y); }
    expect(JSON.stringify(a) === JSON.stringify(b), 'a match saved mid-way plays on exactly the same');
}

section('duel');
// two sides, each with only its own fleet, talking in messages
{
    const fa = S.randomFleet(501), fb = S.randomFleet(502);
    const A = S.newDuel({ first: true }), B = S.newDuel({ first: false });
    expect(A.turn === 'me' && B.turn === 'them', 'one side opens, the other waits');
    expect(S.aimShot(B, 0, 0).error === 'not your turn', 'the waiting side cannot aim');
    // B's message arriving on A out of turn
    expect(S.takeShot(A, fa, { n: 0, x: 0, y: 0 }).error === 'a shot out of turn' && A.theirs.length === 0, 'a shot on the shooter\'s own turn is refused');
    const a1 = S.aimShot(A, 3, 4);
    expect(a1.msg && a1.msg.n === 0 && A.pending, 'aiming makes the message and waits for the answer', JSON.stringify(a1.msg));
    expect(S.aimShot(A, 5, 5).error === 'still waiting for an answer', 'no second shot before the answer');
    expect(S.takeShot(B, fb, { n: 0, x: 10, y: 4 }).error === 'not a cell in the sea', 'a shot off the sea is refused');
    expect(S.takeShot(B, fb, { n: 0, x: 1.5, y: 4 }).error === 'not a cell in the sea' && S.takeShot(B, fb, null).error, 'and half cells and garbage');
    expect(S.takeShot(B, fb, { n: 3, x: 3, y: 4 }).error === 'a shot out of sequence', 'a shot with the wrong running number is refused');
    const r1 = S.takeShot(B, fb, a1.msg);
    expect(r1.answer && B.turn === 'me' && B.theirs.length === 1, 'the fired-at side answers from its own fleet and gets the turn', JSON.stringify(r1.answer));
    for (const bad of [{ ...r1.answer, n: 5 }, { ...r1.answer, x: 9 }, { ...r1.answer, result: 'maybe' }, { ...r1.answer, result: 'sunk', len: 7 }, { ...r1.answer, result: 'miss', len: 3 }, 'miss', null]) {
        expect(S.takeAnswer(A, bad).error && A.pending && A.mine.length === 0, 'a malformed answer is refused: ' + JSON.stringify(bad), S.takeAnswer(A, bad).error);
    }
    expect(!S.takeAnswer(A, r1.answer).error && A.turn === 'them' && !A.pending, 'the right answer is taken and the turn passes');
    expect(S.takeAnswer(A, r1.answer).error === 'an answer nobody asked for', 'the same answer twice is refused');
    // B fires back; then A tries the same cell again
    const b1 = S.aimShot(B, 0, 0); S.takeAnswer(B, S.takeShot(A, fa, b1.msg).answer);
    expect(S.aimShot(A, 3, 4).error === 'already fired there', 'a side cannot aim at a cell it fired at');
    const replay = S.takeShot(B, fb, { n: 2, x: 3, y: 4 });
    expect(replay.error === 'a cell already fired at' && B.turn === 'them', 'and a repeated cell sent anyway is refused');
}
// a whole duel played out, both sides firing like the hard bot; `lieAt` makes B answer one hit with a miss
async function duel(lieAt) {
    const fleets = [S.randomFleet(601), S.randomFleet(602)];
    const salts = [S.newSalt(), S.newSalt()];
    const commits = [await S.commitFleet(fleets[0], salts[0]), await S.commitFleet(fleets[1], salts[1])];
    const D = [S.newDuel({ first: true }), S.newDuel({ first: false })];
    const rs = [{ rs: 7 }, { rs: 8 }];
    let lies = 0;
    const tamper = a => (a.result === 'hit' && lies < 1 && lieAt ? (lies++, { result: 'miss' }) : a);
    for (let i = 0; i < 300 && !D[0].over; i++) {
        const me = D[0].turn === 'me' ? 0 : 1, them = 1 - me;
        const m = S.botMove({ level: 'hard', turn: 0, shots: [D[me].mine, []], rs: rs[me].rs++ });
        const aim = S.aimShot(D[me], m.x, m.y);
        const ans = S.takeShot(D[them], fleets[them], aim.msg, them === 1 ? tamper : null);
        S.takeAnswer(D[me], ans.answer);
    }
    const checks = [await S.checkReveal(D[0], commits[1], { ships: fleets[1], salt: salts[1] }), await S.checkReveal(D[1], commits[0], { ships: fleets[0], salt: salts[0] })];
    return { D, checks, commits, fleets, salts };
}
{
    const h = await duel(false);
    expect(h.D[0].over && h.D[1].over && (h.D[0].over === 'me') === (h.D[1].over === 'them'), 'an honest duel ends and both sides agree who won', h.D[0].over + ' / ' + h.D[1].over + ' after ' + (h.D[0].mine.length + h.D[0].theirs.length) + ' shots');
    expect(JSON.stringify(h.D[0].mine) === JSON.stringify(h.D[1].theirs) && JSON.stringify(h.D[0].theirs) === JSON.stringify(h.D[1].mine), 'both sides hold the same shots and answers, mirrored');
    expect(h.checks[0].ok && h.checks[1].ok, 'each side verifies the other\'s reveal');
    const o = [S.duelOutcome(h.D[0], { revealed: true, check: h.checks[0] }), S.duelOutcome(h.D[1], { revealed: true, check: h.checks[1] })];
    expect(o[0].verdict === 'verified' && o[1].verdict === 'verified' && (o[0].winner === 'me') === (o[1].winner === 'them'), 'verified on both ends, one winner', JSON.stringify(o));
    expect((await S.checkReveal(h.D[0], h.commits[1], { ships: h.fleets[0], salt: h.salts[1] })).ok === false, 'a reveal of another fleet than the committed one is void');
    expect((await S.checkReveal(h.D[0], h.commits[1], { ships: [null, 3], salt: h.salts[1] })).reason === 'a garbled reveal' && (await S.checkReveal(h.D[0], h.commits[1], 'x')).ok === false, 'a garbled reveal is void, not a crash');
    const l = await duel(true);
    expect(!l.checks[0].ok && /answered miss/.test(l.checks[0].reason), 'a hit answered as a miss is caught by the reveal', l.checks[0].reason);
    expect(l.checks[1].ok, 'while the honest side\'s reveal still verifies');
    const lo = S.duelOutcome(l.D[0], { revealed: true, check: l.checks[0] });
    expect(lo.verdict === 'void' && lo.winner === null, 'the honest side calls the match void', JSON.stringify(lo) + ', over ' + l.D[0].over);
    const mid = S.newDuel({ first: true });
    expect(JSON.stringify(S.duelOutcome(mid, { left: true })) === '{"verdict":"forfeit","winner":"me"}', 'the other side leaving before its reveal is a forfeit win');
    expect(S.duelOutcome(h.D[0], { left: true, revealed: true, check: h.checks[0] }).verdict === 'verified', 'leaving after the reveal changes nothing');
}

console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
