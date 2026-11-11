import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const world = vm.createContext({ console });
for (const file of ['rift-data.js', 'rift-sim.js']) vm.runInContext(fs.readFileSync('games/rift-rumble/' + file, 'utf8'), world);
const D = world.RIFT, S = world.RIFT_SIM;
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('  ok    ' + name); }
function duel(mode = 1) {
    const s = S.create({ mode, seed: 91, people: Array.from({ length: mode * 2 }, (_, i) => ({ id: 'p' + i, character: i, team: i % 2 })) });
    s.phase = 'fight'; s.players.forEach(p => { p.invuln = 0; p.x = 600 + p.slot * 48; p.y = 524; p.grounded = true; }); return s;
}
const step = (s, n = 1) => { while (n--) S.step(s); };
test('all 12 fighters have unique identities, weapons and legal profiles', () => {
    assert.equal(D.FIGHTERS.length, 12); assert.equal(new Set(D.FIGHTERS.map(f => f.id)).size, 12); assert.equal(new Set(D.FIGHTERS.map(f => f.special)).size, 12);
    for (let i = 0; i < 12; i++) { assert.equal(S.character(i), i); assert.ok(fs.existsSync('src/emoj/' + D.FIGHTERS[i].reference)); }
    assert.equal(S.character(12), 0); assert.equal(S.character(-1), 0);
});
test('all fighters can perform their distinct special, including dash and triple tears', () => {
    for (let character = 0; character < 12; character++) {
        const s = duel(), p = s.players[0]; p.character = character; s.players[1].x = 1000;
        S.setInput(s, 0, { special: 1 }); step(s, D.attackFor(character, 'special').startup);
        if (D.FIGHTERS[character].specialMelee) { assert.equal(s.shots.length, 0); assert.ok(p.x > 625); }
        else assert.equal(s.shots.length, character === 4 ? 3 : 1, D.FIGHTERS[character].name);
    }
});
test('each fighter has distinct light and heavy timings, reach or hit behavior', () => {
    for (const kind of ['light', 'heavy']) {
        const attacks = D.FIGHTERS.map((_, character) => D.attackFor(character, kind));
        const signatures = attacks.map(a => [a.pose, a.reach, a.startup, a.active, a.damage, a.force, a.lift].join('/'));
        assert.equal(new Set(signatures).size, D.FIGHTERS.length);
    }
    const jab = duel(), cane = duel();
    jab.players[0].character = 2; cane.players[0].character = 1;
    for (const s of [jab, cane]) { s.players[1].x = 680; S.setInput(s, 0, { light: 1 }); step(s, 12); }
    assert.equal(jab.players[1].damage, 0);
    assert.ok(cane.players[1].damage > 0);
});
test('Hehe leaps forward and connects while descending, facing either direction', () => {
    for (const facing of [-1, 1]) {
        const s = duel(), [hehe, rival] = s.players;
        Object.assign(hehe, { character: 5, facing });
        rival.x = hehe.x + facing * 207;
        S.setInput(s, 0, { special: 1 }); step(s, 10);
        assert.ok(hehe.y < 492 && (hehe.x - 600) * facing > 40);
        assert.equal(rival.damage, 0);
        step(s, 12);
        assert.ok(hehe.vy > 0 && rival.damage > 0);
        assert.equal(s.shots.length, 0);
    }
    const s = duel(); s.players[0].character = 5;
    S.setInput(s, 0, { up: true, special: 1 }); step(s);
    assert.ok(s.players[0].recovered && s.players[0].vy < -14);
});
test('countdown freezes all fighters for three seconds', () => {
    const s = S.create({ seed: 4 }); const x = s.players[0].x; step(s, 179); assert.equal(s.phase, 'countdown'); assert.equal(s.players[0].x, x); step(s); assert.equal(s.phase, 'fight');
});
test('one player and three bots fill a balanced 2v2', () => {
    const s = S.create({ mode: 2, people: [{ id: 'me', team: 0, character: 3 }] }); assert.equal(s.players.length, 4); assert.equal(s.players.filter(p => p.bot).length, 3); assert.equal(s.players.filter(p => p.team === 0).length, 2);
});
test('team arenas are wider with distinct safe spawn seats and extended right edges', () => {
    assert.equal(S.create({ mode: 2, arena: 'moon' }).arena, 'lan');
    assert.equal(S.create({ mode: 1, arena: 'defrag' }).arena, 'sky');
    for (const arena of D.arenasFor(2)) {
        const main = arena.platforms[0];
        assert.ok(arena.width > D.W && main.w > Math.max(...D.arenasFor(1).map(stage => stage.platforms[0].w)));
        const s = S.create({ mode: 2, arena: arena.id, people: [0, 0, 1, 1].map((team, slot) => ({ id: `p${slot}`, team })) });
        assert.equal(s.arena, arena.id);
        assert.equal(new Set(s.players.map(p => p.x)).size, 4);
        assert.ok(s.players.every(p => p.x > main.x && p.x < main.x + main.w && p.y < main.y));
        const p = s.players[0]; s.phase = 'fight'; p.x = 1500;
        step(s); assert.equal(p.stocks, 3);
        p.x = arena.width + 171; step(s); assert.equal(p.stocks, 2);
    }
});
test('input rejects non-booleans, hostile counters and missing payloads', () => {
    assert.equal(S.input(null).jump, 0); assert.equal(S.input({ left: 'yes', right: 1 }).left, false); assert.equal(S.input({ jump: Infinity, light: -1 }).jump, 0); assert.equal(S.input({ jump: 2 }).jump, 2);
});
test('a repeated input packet cannot replay a jump', () => {
    const s = duel(); S.setInput(s, 0, { jump: 1 }); step(s); assert.equal(s.players[0].jumps, 1); for (let i = 0; i < 10; i++) { S.setInput(s, 0, { jump: 1 }); step(s); } assert.equal(s.players[0].jumps, 1);
});
test('double jump works and a third jump is refused', () => {
    const s = duel(), p = s.players[0]; for (let i = 1; i <= 3; i++) { S.setInput(s, 0, { jump: i }); step(s, 3); } assert.equal(p.jumps, 2); assert.ok(p.vy > D.JUMP);
});
test('landing restores jumps and recovery', () => {
    const s = duel(), p = s.players[0]; p.y = 510; p.vy = 8; p.jumps = 2; p.recovered = true; step(s, 3); assert.equal(p.y, 524); assert.equal(p.jumps, 0); assert.equal(p.recovered, false);
});
test('light attacks have startup, hit once and put the target in stun', () => {
    const s = duel(); S.setInput(s, 0, { light: 1 }); step(s, 3); assert.equal(s.players[1].damage, 0); step(s); assert.equal(s.players[1].damage, 8); assert.ok(s.players[1].stun > 0); step(s, 14); assert.equal(s.players[1].damage, 8);
});
test('heavies deal more damage and higher damage increases knockback', () => {
    const a = duel(), b = duel(); b.players[1].damage = 100;
    S.setInput(a, 0, { heavy: 1 }); S.setInput(b, 0, { heavy: 1 }); step(a, 13); step(b, 13); assert.equal(a.players[1].damage, 18); assert.ok(Math.abs(b.players[1].vx) > Math.abs(a.players[1].vx) + 5);
});
test('teammates cannot damage each other', () => {
    const s = duel(2); s.players[2].x = 643; s.players[1].x = 950; s.players[3].x = 1000; S.setInput(s, 0, { heavy: 1 }); step(s, 20); assert.equal(s.players[2].damage, 0);
});
test('dodge grants invulnerability and a cooldown', () => {
    const s = duel(); S.setInput(s, 0, { light: 1 }); S.setInput(s, 1, { dodge: 1 }); step(s, 8); assert.equal(s.players[1].damage, 0); assert.ok(s.players[1].dodgeCd > 0);
});
test('specials create projectiles and upward special recovers once per landing', () => {
    const s = duel(); s.players[1].x = 900; S.setInput(s, 0, { special: 1 }); step(s, 9); assert.equal(s.shots.length, 1);
    const b = duel(), p = b.players[0]; p.x = 1100; p.y = 600; p.jumps = 2; S.setInput(b, 0, { up: true, special: 1 }); step(b); assert.equal(p.recovered, true); assert.ok(p.vy < -14); p.cooldown = 0; p.vy = 0; S.setInput(b, 0, { up: true, special: 2 }); step(b); assert.ok(p.vy >= 0);
});
test('platforms are passable from below and down drops through a ledge', () => {
    const s = duel(), p = s.players[0]; p.x = 400; p.y = 380; p.vy = -7; step(s, 4); assert.ok(p.y < 365); p.y = 365; p.vy = 0; p.grounded = true; p.platform = 1; S.setInput(s, 0, { down: true }); step(s, 4); assert.ok(p.y > 370);
});
test('a knockout consumes a stock, credits the attacker and respawns with protection', () => {
    const s = duel(), p = s.players[1]; p.y = 930; p.lastHit = 0; p.lastHitAt = s.tick; step(s); assert.equal(p.stocks, 2); assert.equal(s.players[0].kos, 1); step(s, 100); assert.ok(p.invuln > 0); assert.equal(p.damage, 0);
});
test('the last living team wins and the terminal state stays still', () => {
    const s = duel(2); s.players.filter(p => p.team === 1).forEach(p => { p.stocks = 1; p.y = 930; }); step(s); assert.equal(s.phase, 'over'); assert.equal(s.winner, 0); const t = s.tick; step(s, 100); assert.equal(s.tick, t);
});
test('time limit ranks stocks, then damage; an exact tie starts sudden death', () => {
    const a = duel(); a.players[0].stocks = 2; a.remaining = 1; step(a); assert.equal(a.winner, 1);
    const b = duel(); b.players[1].damage = 70; b.remaining = 1; step(b); assert.equal(b.winner, 0);
    const c = duel(); c.remaining = 1; step(c); assert.equal(c.sudden, true); assert.ok(c.players.every(p => p.damage === 200 && p.stocks === 1));
});
test('stale directional input expires when packets stop arriving', () => {
    const s = duel(); S.setInput(s, 0, { right: true }); step(s, 50); assert.equal(s.players[0].input.right, false);
});
test('snapshots are detached, bounded and omit input counters', () => {
    const s = duel(), snap = S.snapshot(s); snap.players[0].x = 99; assert.notEqual(s.players[0].x, 99); assert.equal(snap.players[0].input, undefined); assert.ok(JSON.stringify(snap).length < 12000);
});
test('same seed and inputs produce the same complete match', () => {
    const a = S.create({ seed: 882, mode: 2 }), b = S.create({ seed: 882, mode: 2 }); step(a, 8000); step(b, 8000); assert.equal(JSON.stringify(a), JSON.stringify(b));
});
test('bots fight, recover and finish on every arena in its intended mode', () => {
    let hits = 0, kos = 0;
    for (const mode of [1, 2]) for (const arena of D.arenasFor(mode)) for (let seed = 1; seed <= 5; seed++) {
        const s = S.create({ arena: arena.id, mode, seed }); let n = 0;
        while (s.phase !== 'over' && n++ < 24000) S.step(s);
        assert.equal(s.phase, 'over', arena.id + '/' + mode + '/' + seed); assert.ok(s.players.every(p => Number.isFinite(p.x) && Number.isFinite(p.damage))); hits += s.players.reduce((n, p) => n + p.dealt, 0); kos += s.players.reduce((n, p) => n + p.kos, 0);
    }
    assert.ok(hits > 5000); assert.ok(kos > 30); console.log('        30 bot matches, ' + Math.round(hits) + ' damage, ' + kos + ' knockouts');
});
console.log('Brawlz 98: ' + checks + ' rule checks passed.');
