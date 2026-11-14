// ===================================================================
// check-blastz.mjs — the rules of blastz 98, its bots and its online room
//
// Everything here runs the game's own files under node: no browser, no
// clocks. node .github/scripts/check-blastz.mjs
// ===================================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const world = vm.createContext({ console });
for (const f of ['blastz-data.js', 'blastz-sim.js', 'blastz-room.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'games/blastz', f), 'utf8'), world, { filename: f });
const D = world.BLASTZ, S = world.BLASTZ_SIM, ROOM = world.BLASTZ_ROOM;
const plain = v => JSON.parse(JSON.stringify(v));
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('  ok    ' + name); }
const step = (s, n = 1) => { while (n--) S.step(s); };
// two players face each other on the main platform of the start menu, guns ready
function duel(opts = {}) {
    const s = S.create(Object.assign({ map: 'start', seed: 7, count: 2, people: [{ id: 'a', character: 0, perk: 'turbo' }, { id: 'b', character: 1, perk: 'turbo' }] }, opts));
    s.phase = 'fight'; s.crateAt = 1e9;
    const main = D.map(s.map).platforms[0];
    s.players.forEach((p, i) => Object.assign(p, { x: main.x + main.w / 2 + (i ? 150 : -150), y: main.y, vx: 0, vy: 0, grounded: true, facing: i ? -1 : 1, invuln: 0 }));
    return s;
}

console.log('\n== the data ==');
test('ten guns, six perks, three items and four maps, all with names of our own', () => {
    assert.equal(D.WEAPONS.length, 10); assert.equal(new Set(D.WEAPONS.map(w => w.id)).size, 10); assert.equal(new Set(D.WEAPONS.map(w => w.name)).size, 10);
    assert.equal(D.PERKS.length, 6); assert.equal(D.ITEMS.length, 3); assert.equal(D.MAPS.length, 4);
    const text = JSON.stringify([D.WEAPONS, D.PERKS, D.ITEMS, D.MAPS]).toLowerCase();
    assert.ok(!/mayhem|gun mayhem/.test(text), 'nothing borrowed from the game this is in the genre of');
    assert.equal(D.WEAPONS[0].clips, -1, 'the starting gun never runs out');
    for (const w of D.WEAPONS) assert.ok(w.rate > 0 && w.mag > 0 && w.speed > 0 && w.knock > 0 && w.life > 0, w.id);
});
test('every platform is inside the world and every spawn is over one', () => {
    for (const m of D.MAPS) {
        for (const pl of m.platforms) assert.ok(pl.x >= 0 && pl.x + pl.w <= D.W && pl.y > 0 && pl.y < D.H, m.id);
        for (const [x, y] of m.spawns) assert.ok(S.under(m, x, y, 0), m.id + ' spawn ' + x);
    }
});

console.log('\n== moving ==');
test('the countdown freezes everybody, then the fight starts', () => {
    const s = S.create({ seed: 4, count: 4 }), xs = s.players.map(p => p.x);
    step(s, D.COUNTDOWN - 1); assert.equal(s.phase, 'countdown'); assert.deepEqual(s.players.map(p => p.x), xs);
    step(s); assert.equal(s.phase, 'fight');
});
test('inputs are cleaned, and a press is a counter that only counts once', () => {
    const s = duel(), p = s.players[0];
    S.setInput(s, 0, { left: 'yes', right: true, fire: 1, jump: 1, bomb: -4 });
    assert.equal(p.input.left, false); assert.equal(p.input.right, true); assert.equal(p.input.fire, false); assert.equal(p.input.bomb, 0);
    step(s); assert.ok(p.vy < 0 && p.jumps === 1, 'one jump');
    S.setInput(s, 0, { jump: 1 }); step(s); assert.equal(p.jumps, 1, 'the same counter again is not a second jump');
    S.setInput(s, 0, { jump: 2 }); step(s); assert.equal(p.jumps, 2, 'a new press is the double jump');
    S.setInput(s, 0, { jump: 3 }); step(s); assert.equal(p.jumps, 2, 'and there is no third without the perk');
});
test('spring boots give a third jump', () => {
    const s = duel(), p = s.players[0]; p.perk = 'spring';
    for (let n = 1; n <= 3; n++) { S.setInput(s, 0, { jump: n }); step(s, 4); }
    assert.equal(p.jumps, 3);
});
test('holding down drops through a platform; jumping goes up through one', () => {
    const s = duel(), p = s.players[0], main = D.map('start').platforms[0];
    S.setInput(s, 0, { down: true }); step(s, 30);
    assert.ok(p.y > main.y + 20 && !p.grounded, 'fell through');
    const t = duel(), q = t.players[0]; Object.assign(q, { x: 330, y: 560 });
    S.setInput(t, 0, { jump: 1 }); step(t, 6); S.setInput(t, 0, { jump: 2 }); step(t, 60);
    assert.equal(q.y, 430, 'landed on top of the platform above');
});
test('walking off a ledge leaves only the air jump', () => {
    const s = duel(), p = s.players[0], main = D.map('start').platforms[0];
    Object.assign(p, { x: main.x + 4 }); S.setInput(s, 0, { left: true }); step(s, 10);
    assert.ok(!p.grounded); assert.equal(p.jumps, 1);
});

console.log('\n== guns and knockback ==');
test('a bullet shoves who it hits, and the shot kicks the shooter back', () => {
    const s = duel(), [a, b] = s.players;
    S.setInput(s, 0, { fire: true }); step(s, 22);
    assert.ok(b.vx > 2 || b.x > 790 + 3, 'the target is pushed away from the shooter');
    assert.ok(b.stun > 0 && b.hitBy === 0, 'and remembers who did it');
    assert.ok(a.x < 490, 'recoil moved the shooter back');
});
test('steady hands have no recoil; heavy boots take less of a push', () => {
    const s = duel(), [a] = s.players; a.perk = 'steady';
    S.setInput(s, 0, { fire: true }); step(s); assert.equal(a.vx, 0);
    const push = perk => { const t = duel(); t.players[1].perk = perk; S.setInput(t, 0, { fire: true }); step(t, 30); return t.players[1].x - 790; };
    assert.ok(push('anchor') < push('turbo') * 0.85, 'anchor ' + push('anchor') + ' vs ' + push('turbo'));
});
test('a magazine runs dry, reloads, and an empty gun turns back into the pea shooter', () => {
    const s = duel(), [a] = s.players; s.players[1].x = 4000;
    const cannon = D.WEAPONS.findIndex(w => w.id === 'cannon');
    Object.assign(a, { weapon: cannon, mag: 1, clips: 0, reload: 0, cd: 0 });
    S.setInput(s, 0, { fire: true }); step(s, 2);
    assert.equal(a.weapon, 0, 'back to the pea shooter'); assert.equal(a.mag, D.WEAPONS[0].mag);
    Object.assign(a, { weapon: cannon, mag: 1, clips: 2, reload: 0, cd: 0 }); step(s, 2);
    assert.ok(a.reload > 0 && a.clips === 1 && a.weapon === cannon, 'a spare magazine reloads instead');
});
test('the spin cycle winds up before it fires; triple click fires three', () => {
    const s = duel(), [a] = s.players; s.players[1].x = 4000;
    Object.assign(a, { weapon: D.WEAPONS.findIndex(w => w.id === 'spin'), mag: 120, clips: 1 });
    S.setInput(s, 0, { fire: true }); step(s, 20); assert.equal(s.shots.length, 0);
    step(s, 34); assert.ok(s.shots.length > 2);
    const t = duel(), [b] = t.players; t.players[1].x = 4000;
    Object.assign(b, { weapon: D.WEAPONS.findIndex(w => w.id === 'triple'), mag: 27, clips: 3 });
    S.setInput(t, 0, { fire: true }); step(t, 1); S.setInput(t, 0, { fire: false }); step(t, 14);
    assert.equal(t.shots.length, 3);
});
test('rockets and bombs blow up and push everyone near, the thrower too', () => {
    const s = duel(), [a, b] = s.players; b.x = a.x + 70;
    S.setInput(s, 0, { bomb: 1 }); step(s); assert.equal(s.bombs.length, 1); assert.equal(a.bombs, D.GRENADES - 1);
    step(s, D.BOMB.fuse - 6); Object.assign(b, { x: s.bombs[0].x + 30, y: 560, vx: 0 }); step(s, 8);
    assert.equal(s.bombs.length, 0); assert.ok(s.events.some(e => e.type === 'boom'));
    assert.ok(b.stun > 0 && b.hitBy === 0 && Math.hypot(b.vx, b.vy) > 2, 'the rival flew');
    const r = duel(), [c, d] = r.players;
    Object.assign(c, { weapon: D.WEAPONS.findIndex(w => w.id === 'delete'), mag: 3, clips: 2 }); d.x = c.x + 200;
    S.setInput(r, 0, { fire: true }); step(r, 40);
    assert.ok(r.events.some(e => e.type === 'boom') && d.hitBy === 0 && d.x > c.x + 225, 'the rocket blew up on the rival');
});
test('teammates are not pushed by each other; a firewall stops every push', () => {
    const s = duel({ teams: true, people: [{ id: 'a', team: 0, perk: 'turbo' }, { id: 'b', team: 0, perk: 'turbo' }], count: 4 });
    assert.equal(s.players[0].team, s.players[1].team);
    s.players.slice(2).forEach(p => { p.out = true; });
    S.setInput(s, 0, { fire: true }); step(s, 20); assert.ok(Math.abs(s.players[1].vx) < 0.01);
    const t = duel(); t.players[1].shield = 300;
    S.setInput(t, 0, { fire: true }); step(t, 20); assert.ok(Math.abs(t.players[1].vx) < 0.01);
});

console.log('\n== lives ==');
test('falling off costs a life, the last hitter gets the KO, and a shielded respawn follows', () => {
    const s = duel(), [a, b] = s.players;
    b.hitBy = 0; b.hitAt = s.tick; b.y = D.BLAST.bottom + 5;
    step(s);
    assert.equal(b.lives, s.lives - 1); assert.equal(b.falls, 1); assert.equal(a.kos, 1); assert.ok(b.dead > 0);
    step(s, D.RESPAWN);
    assert.equal(b.dead, 0); assert.ok(b.invuln > 0); assert.equal(b.weapon, 0);
    const t = duel(); t.players[1].hitBy = 0; t.players[1].hitAt = t.tick - D.CREDIT - 5; t.players[1].x = D.BLAST.right + 5; step(t);
    assert.equal(t.players[0].kos, 0, 'an old hit is not a KO');
});
test('the last one with lives wins, and places count down from the bottom', () => {
    const s = S.create({ seed: 3, count: 3, lives: 3 }); s.phase = 'fight';
    for (const i of [2, 0]) { const p = s.players[i]; p.lives = 1; p.y = D.BLAST.bottom + 9; step(s); }
    assert.equal(s.phase, 'over'); assert.equal(s.winner, 1);
    assert.deepEqual(plain(S.result(s).rows.map(r => r.place)), [1, 2, 3]);
    assert.equal(S.result(s).rows[2].id, s.players[2].id);
});
test('in teams the side with anybody left wins', () => {
    const s = S.create({ seed: 3, count: 4, teams: true, people: [{ id: 'a', team: 0 }, { id: 'b', team: 1 }, { id: 'c', team: 0 }] });
    assert.deepEqual(plain(s.players.map(p => p.team).sort()), [0, 0, 1, 1]);
    s.phase = 'fight';
    for (const p of s.players.filter(p => p.team === 1)) { p.lives = 1; p.y = D.BLAST.bottom + 9; }
    step(s); assert.equal(s.phase, 'over'); assert.equal(s.winner, 0);
});

console.log('\n== crates ==');
test('crates fall onto a platform, and touching one hands over a full gun or an item', () => {
    const s = duel(); s.crateAt = 1;
    step(s); assert.equal(s.crates.length, 1); s.crateAt = 1e9;
    step(s, 200); assert.ok(s.crates[0].landed);
    const c = s.crates[0], a = s.players[0];
    Object.assign(c, { item: false, kind: 4 }); Object.assign(a, { x: c.x, y: c.y, vx: 0, grounded: true });
    step(s);
    assert.equal(a.weapon, 4); assert.equal(a.mag, D.WEAPONS[4].mag); assert.equal(s.crates.length, 0);
    const t = duel(); t.crates.push({ id: 9, x: 490, y: 560, vy: 0, item: true, kind: 0, life: 900, landed: true }); step(t);
    assert.ok(t.players[0].shield > 0, 'the firewall item');
});

console.log('\n== bots ==');
test('four bots finish a five-life match on every map, and fall off on their own very rarely', () => {
    for (const m of D.MAPS) {
        let alone = 0, falls = 0;
        for (let seed = 1; seed <= 3; seed++) {
            const s = S.create({ map: m.id, seed, count: 4, lives: 5 });
            const credited = () => s.players.reduce((n, p) => n + p.kos, 0);
            let n = 0;
            while (s.phase !== 'over' && n < 7 * 60 * 60) { S.step(s); n++; }
            assert.equal(s.phase, 'over', m.id + ' seed ' + seed + ' ended');
            const f = s.players.reduce((k, p) => k + p.falls, 0); falls += f; alone += f - credited();
        }
        assert.ok(alone <= falls * 0.12, m.id + ': ' + alone + ' of ' + falls + ' falls had nobody behind them');
    }
});
test('a lone player against three bots gets pushed, and bots pick up crates', () => {
    const s = S.create({ seed: 12, count: 4, people: [{ id: 'me' }] });
    let picks = 0, before = 0;
    for (let n = 0; n < 60 * 60 && s.phase !== 'over'; n++) { S.step(s); for (const e of s.events) if (e.id > before) { if (e.type === 'pick') picks++; before = e.id; } }
    assert.ok(s.players[0].falls > 0, 'standing still is not safe');
    assert.ok(picks > 0, 'crates get picked');
});
test('a bot turns to a player in its line and keeps shooting, crate above or not', () => {
    for (const crate of [false, true]) {
        const s = S.create({ map: 'start', seed: 21, count: 2, people: [{ id: 'me', perk: 'turbo' }] });
        s.phase = 'fight'; s.crateAt = 1e9;
        const [me, bot] = s.players;
        Object.assign(me, { x: 520, y: 560, grounded: true, invuln: 0 });
        Object.assign(bot, { x: 820, y: 560, grounded: true, facing: 1, invuln: 0 });
        // the one that used to freeze them: a crate on the platform two jumps up
        if (crate) s.crates.push({ id: 99, x: 640, y: 320, vy: 0, item: false, kind: 2, life: 5000, landed: true });
        let shots = 0, hits = 0, seen = 0;
        for (let n = 0; n < 7 * 60; n++) {
            Object.assign(me, { x: 520, vx: 0, y: 560, vy: 0, grounded: true });   // a player who stands still and takes it
            S.step(s);
            for (const e of s.events) if (e.id > seen) { seen = e.id; if (e.type === 'shot' && e.slot === 1) shots++; if (e.type === 'hit' && e.slot === 0) hits++; }
        }
        assert.ok(shots >= 8, (crate ? 'with' : 'without') + ' a crate above: ' + shots + ' shots in seven seconds');
        assert.ok(hits >= 6, hits + ' of them hit');
    }
});
test('a bot finds its way to a rival it cannot shoot from where it stands', () => {
    // other floor, other side of the minefield: down, across the gaps, then shoot
    for (const [x, y] of [[980, 560], [460, 450], [835, 230]]) {
        const s = S.create({ map: 'mines', seed: 3, count: 2, people: [{ id: 'bot', bot: true }, { id: 'me', perk: 'turbo' }] });
        s.phase = 'fight'; s.crateAt = 1e9;
        Object.assign(s.players[0], { x: 245, y: 340, grounded: true });
        let n = 0, seen = 0, hit = false;
        while (!hit && n < 15 * 60) {
            Object.assign(s.players[1], { x, y, vx: 0, vy: 0, grounded: true, invuln: 0 });
            S.step(s); n++;
            for (const e of s.events) if (e.id > seen) { seen = e.id; if (e.type === 'hit' && e.slot === 1) hit = true; }
        }
        assert.ok(hit, 'reached and hit a player standing at ' + x + ',' + y);
    }
});
test('the pace is readable: a walk, a jump and a bullet a person can follow', () => {
    assert.ok(D.RUN <= 4 && D.GRAVITY <= 0.45, 'walking and falling');
    const one = D.JUMP * D.JUMP / 2 / D.GRAVITY, two = one + D.AIR_JUMP * D.AIR_JUMP / 2 / D.GRAVITY;
    assert.ok(one > 115 && two > 210, 'but a jump still reaches the next floor: ' + Math.round(one) + ' / ' + Math.round(two));
    for (const w of D.WEAPONS) assert.ok(w.speed <= 50 && w.rate >= 4, w.id + ' is not a blur');
    assert.ok(D.WEAPONS[0].speed <= 20 && D.WEAPONS[0].rate >= 18, 'the pea shooter fires about three a second');
});
test('the same seed and the same inputs play the same match', () => {
    const run = () => { const s = S.create({ seed: 77, count: 4, map: 'tower' }); for (let n = 0; n < 3000; n++) { if (n % 50 === 0) S.setInput(s, 1, { fire: n % 100 === 0, jump: n / 50 }); S.step(s); } return JSON.stringify(S.snapshot(s)); };
    assert.equal(run(), run());
});

console.log('\n== the wire ==');
test('a snapshot survives JSON and validates; a broken one does not', () => {
    const s = S.create({ seed: 5, count: 4 }); step(s, 600);
    const snap = plain(S.snapshot(s));
    assert.ok(S.valid(snap, 4)); assert.ok(!S.valid(snap, 3));
    assert.ok(JSON.stringify(snap).length < 12000, 'small enough to send twenty times a second');
    for (const broken of [{ ...snap, version: 2 }, { ...snap, map: 'nowhere' }, { ...snap, players: snap.players.map((p, i) => i ? p : { ...p, x: 'left' }) }, { ...snap, shots: [{ w: 99, x: 0, y: 0, vx: 0, vy: 0 }] }, null])
        assert.ok(!S.valid(broken, 4));
});

console.log('\n== the online room ==');
test('players join, bots fill the rest, and the room stops at the match size', () => {
    const r = ROOM.create({ host: 'h', count: 4 });
    ROOM.join(r, 'h', 'host', 3, 'turbo'); ROOM.join(r, 'g', 'guest', 30, 'nope');
    assert.equal(r.seats.length, 2); assert.equal(r.bots.length, 2);
    assert.equal(ROOM.seat(r, 'g').pick, 0, 'an unknown fighter becomes the first one'); assert.equal(ROOM.seat(r, 'g').perk, D.PERKS[0].id);
    ROOM.setRule(r, 'h', 'count', 2);
    assert.equal(r.bots.length, 0); ROOM.join(r, 'x', 'late');
    assert.equal(ROOM.seat(r, 'x').in, false, 'the third of a duel waits');
    ROOM.leave(r, 'g'); assert.equal(ROOM.seat(r, 'x').in, true, 'and takes the seat that opens');
});
test('intents: newest only, locked while ready, and the countdown needs everybody', () => {
    const r = ROOM.create({ host: 'h', count: 3 });
    ROOM.join(r, 'h', 'host'); ROOM.join(r, 'g', 'guest');
    assert.ok(ROOM.intent(r, 'g', { n: 2, c: 5, p: 'bomber', r: false }));
    assert.ok(!ROOM.intent(r, 'g', { n: 1, c: 7 }), 'an old packet changes nothing');
    assert.equal(ROOM.seat(r, 'g').pick, 5); assert.equal(ROOM.seat(r, 'g').perk, 'bomber');
    ROOM.intent(r, 'g', { n: 3, c: 5, p: 'bomber', r: true }); assert.equal(r.phase, 'select');
    ROOM.intent(r, 'g', { n: 4, c: 9, p: 'bomber', r: true }); assert.equal(ROOM.seat(r, 'g').pick, 5, 'ready locks the fighter');
    ROOM.intent(r, 'h', { n: 1, c: 2, r: true }); assert.equal(r.phase, 'countdown');
    assert.ok(!ROOM.tick(r, 1000)); assert.ok(ROOM.tick(r, 2100));
    const m = ROOM.begin(r, 42, 1000);
    assert.equal(m.people.length, 3); assert.equal(m.people.filter(p => p.bot).length, 1);
    assert.ok(ROOM.readStart(plain(m)), 'the start message reads back');
    assert.ok(!ROOM.readStart({ ...plain(m), people: m.people.slice(1) }), 'and a short one does not');
    const sim = S.create(Object.assign({ seed: m.seed, people: m.people }, m.options));
    assert.equal(sim.players[1].character, 5); assert.equal(sim.players[1].perk, 'bomber'); assert.ok(sim.players[2].bot);
    sim.players[1].place = 1;
    assert.ok(ROOM.finish(r, { match: m.match, rows: S.result(sim).rows }));
    assert.equal(ROOM.seat(r, 'g').wins, 1); assert.equal(r.phase, 'select'); assert.equal(r.played, 1);
});
test('only the host changes the rules, never while ready; teams keep the sides even', () => {
    const r = ROOM.create({ host: 'h', count: 4 });
    ROOM.join(r, 'h'); ROOM.join(r, 'a'); ROOM.join(r, 'b');
    assert.ok(!ROOM.setRule(r, 'a', 'map', 'tower'));
    assert.ok(ROOM.setRule(r, 'h', 'map', 'tower')); assert.equal(r.rules.map, 'tower');
    assert.ok(ROOM.setRule(r, 'h', 'teams', true));
    const sides = r.seats.map(s => s.team).concat(r.bots.map(b => b.team));
    assert.equal(sides.filter(t => t === 0).length, 2); assert.equal(sides.filter(t => t === 1).length, 2);
    const t = ROOM.seat(r, 'a').team; ROOM.intent(r, 'a', { n: 1, t: 1 - t });
    const after = r.seats.map(s => s.team);
    assert.ok(after.filter(x => x === 0).length <= 2 && after.filter(x => x === 1).length <= 2, 'never three on a side');
    ROOM.intent(r, 'h', { n: 9, r: true }); assert.ok(!ROOM.setRule(r, 'h', 'lives', 10), 'a ready host is locked too');
});
test('the room view survives the wire and a guest rejects a malformed one', () => {
    const r = ROOM.create({ host: 'h', count: 4, map: 'mines', lives: 10 });
    ROOM.join(r, 'h', 'host', 4, 'anchor');
    const v = ROOM.read(plain(ROOM.view(r)));
    assert.equal(v.rules.map, 'mines'); assert.equal(v.rules.lives, 10); assert.equal(v.seats[0].perk, 'anchor'); assert.equal(v.bots.length, 3);
    const w = plain(ROOM.view(r));
    for (const bad of [{ ...w, v: 2 }, { ...w, rules: ['x', 5, 0, 4] }, { ...w, seats: [['h', 'x', 99, 'anchor', 0, 0, 0, 1, 0, 0]] }, { ...w, bots: Array(5).fill([0, 1, 'turbo', 'x']) }])
        assert.equal(ROOM.read(bad), null);
});

console.log('\n== on the site ==');
test('the lobby lists blastz, with a join page, and the desktop opens it', () => {
    const np = fs.readFileSync(path.join(ROOT, 'games/netplay.js'), 'utf8');
    assert.match(np, /id: 'blastz'/);
    const scripts = np.slice(np.indexOf("id: 'blastz'")).match(/scripts: \[([^\]]+)\]/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
    for (const f of scripts) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    for (const f of scripts.concat('games/blastz/blastz.css')) assert.ok(sw.includes("'/" + f + "'"), 'offline copy of ' + f);
    assert.ok(fs.existsSync(path.join(ROOT, 'join/blastz/index.html')) && fs.existsSync(path.join(ROOT, 'join/blastz/preview.jpg')));
    assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /startMenuAction\('blastz'\)/);
    assert.match(fs.readFileSync(path.join(ROOT, 'js/index.js'), 'utf8'), /blastz: openBlastz/);
});

console.log('\nall ' + checks + ' checks passed');
