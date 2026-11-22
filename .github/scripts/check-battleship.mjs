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

console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
