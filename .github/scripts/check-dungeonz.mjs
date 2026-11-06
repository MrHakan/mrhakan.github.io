// ===================================================================
// check-dungeonz.mjs — the rules, the dungeons, the wire, and a few hundred runs
//
// A co-op raid cannot be balanced by looking at it either. So the targets are
// written down here and parties of four bots play every dungeon many times over,
// with seeds fixed, so a number only moves when the rules or the data do:
//
//   - the three dungeons get harder in order, and none is a wall or a walk
//   - a run, a boss fight and the level you reach the boss at are in range
//   - every skill and every passive gets picked, and none of them is worth far
//     more or far less than the rest, measured two ways: what it does per second
//     you own it (damage, and health it saved), and how often a party carrying it
//     clears the dungeon against a party that is not
//
// The bots pick their cards at random here, so each card is measured, rather
// than the bots' taste. They are still the instrument: a skill they use badly
// reads as weak, which is the limit of this, and nothing here has been played
// by a crowd of people.
//
//   node .github/scripts/check-dungeonz.mjs
//   DZ_RUNS=120 DZ_TABLE=1 node ...     more runs, and the whole table
// ===================================================================
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
function load() {
    const window = {};
    const ctx = vm.createContext({ window, console });
    for (const f of ['games/ps1/ps1-world.js', 'games/dungeonz/dungeonz-data.js', 'games/dungeonz/dungeonz-sim.js']) vm.runInContext(read(f), ctx);
    return window;
}
const SEATS = [0, 1, 2, 3].map(i => ({ id: 'b' + i, name: 'bot ' + i, bot: true }));
function playRun(W, dungeon, seed) {
    const S = W.DZ_SIM;
    const s = S.newRun({ seed, dungeon, stats: true, players: SEATS });
    const brains = s.heroes.map((h, i) => S.newBrain((seed * 31 + i * 7) >>> 0, { pick: 'random' }));
    const cap = S.HZ * 60 * 30;
    for (let t = 0; t < cap && !s.over; t++) {
        for (let i = 0; i < 4; i++) S.think(s, i, brains[i]);
        S.step(s);
        s.ev.length = 0;
    }
    const party = new Set(), pas = new Set();
    s.heroes.forEach(h => { h.skills.forEach(k => party.add(k.id)); Object.keys(h.pas).forEach(p => pas.add(p)); });
    return {
        dungeon, seed, win: s.over === 'win', timeout: !s.over, t: s.t, frontier: s.frontier, rooms: s.dun.rooms.length,
        bossT: s.stats.bossT, bossAt: s.stats.bossAt, lv: s.stats.levelAtBoss, endLv: s.heroes.reduce((a, h) => a + h.level, 0) / 4,
        downs: s.stats.downs, wipes: s.stats.wipes, kills: s.stats.kills, revives: s.stats.revives,
        dmg: s.stats.dmg, saved: s.stats.saved, own: s.stats.own, picks: s.stats.picks,
        party: [...party], pas: [...pas], mid: s.stats.mid || null
    };
}

// ===================================================================
// a worker plays the runs it is handed
// ===================================================================
if (!isMainThread) {
    const W = load();
    const out = workerData.jobs.map(j => playRun(W, j.dungeon, j.seed));
    parentPort.postMessage(out);
    process.exit(0);
}

let checks = 0, failures = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
const pct = n => (n * 100).toFixed(0) + '%';
const STARTED = Date.now();

const window = load();
const D = window.DZ, S = window.DZ_SIM;
const WZ = (() => { const w = {}; vm.runInContext(read('games/wizardz/wizardz-data.js'), vm.createContext({ window: w, console })); return w.WZ; })();

// ===================================================================
section('the data');
// ===================================================================
{
    expect(D.SKILLS.length === 12, 'twelve skills', D.SKILLS.map(s => s.id).join(', '));
    const notSigils = D.SKILLS.filter(s => !WZ.byId(s.id));
    expect(!notSigils.length, 'and every one is a wizardz sigil, so it can be drawn', notSigils.map(s => s.id).join(', '));
    expect(D.SKILLS.every(s => s.r.length === 3 && s.cd > 0), 'each has three ranks and a cooldown');
    const kinds = new Set(['shot', 'chain', 'strike', 'zone', 'wall', 'decoy', 'nova', 'ward', 'heal', 'blink', 'missiles']);
    expect(D.SKILLS.every(s => kinds.has(s.kind)), 'and a kind the sim knows how to cast');
    expect(D.PASSIVES.length >= 5 && D.PASSIVES.every(p => p.max >= 1), 'passives, with a limit each');
    expect(Object.keys(D.MINIONS).length >= 6, 'six or more kinds of minion', Object.keys(D.MINIONS).join(', '));
    for (const d of D.DUNGEONS) {
        const B = D.BOSSES[d.boss];
        expect(!!B && B.phases.length === 3, d.name + ' has a boss with three phases', B && B.name);
        const known = B ? B.phases.every(p => p.attacks.every(a => a === 'summon' ? !!p.summon : !!D.ATTACKS[a])) : false;
        expect(known, 'and every attack it has is a real one');
        expect(Object.keys(d.kinds).every(k => D.MINIONS[k]), 'and its minions are real ones');
    }
    // readable: anything that hurts from the floor says so for long enough to move
    const telegraphed = Object.entries(D.ATTACKS).filter(([, a]) => ['slam', 'rain', 'lane'].includes(a.kind));
    const quick = telegraphed.filter(([, a]) => a.windup < 0.9);
    expect(!quick.length, 'every attack on the floor shows its red for 0.9s or more first', quick.map(q => q[0]).join(', '));
    const slow = Object.entries(D.MINIONS).filter(([, m]) => (m.slam && m.slam.windup < 0.8) || (m.fuse && m.fuse.windup < 0.8));
    expect(!slow.length, 'and so does every minion that hits an area');
    expect(D.tier === undefined && D.DUNGEONS.map(d => d.tier).join() === 'easy,normal,hard', 'one dungeon per difficulty, in order');
}

// ===================================================================
section('the dungeons, built from a seed');
// ===================================================================
{
    let unreachable = [], spawnsOut = [], sizes = [];
    for (const d of D.DUNGEONS) {
        for (let k = 0; k < 25; k++) {
            const seed = 77 + k * 1013;
            const s = S.newRun({ seed, dungeon: d.id, players: SEATS });
            const dun = s.dun, W = dun.world;
            const start = dun.rooms[0];
            for (const rm of dun.rooms) {
                if (!W.canWalkBetween(start.cx, start.cz, rm.cx, rm.cz)) unreachable.push(d.id + '#' + seed + ' room ' + rm.i);
                if (rm.exit && !W.canWalkBetween(rm.cx, rm.cz, rm.exit.x, rm.exit.z - 1)) unreachable.push(d.id + '#' + seed + ' exit of ' + rm.i);
            }
            for (const c of dun.chests) if (!W.canWalkBetween(start.cx, start.cz, c.x, c.z)) unreachable.push(d.id + '#' + seed + ' chest ' + c.i);
            for (const m of s.minions) {
                const rm = dun.rooms[m.room];
                if (!(m.x > rm.x0 && m.x < rm.x1 && m.z > rm.z0 && m.z < rm.z1) || !W.passable[W.navCell(m.x, m.z)]) spawnsOut.push(d.id + '#' + seed + ' ' + m.kind + ' ' + m.id);
            }
            sizes.push(s.minions.filter(m => m.room === 1).length);
            const fights = dun.rooms.filter(r => r.kind === 'fight').length;
            if (k === 0) {
                expect(fights === d.rooms.reduce((a, b) => a + b, 0) && dun.rooms.filter(r => r.kind === 'shrine').length === 4 && dun.rooms[dun.rooms.length - 1].kind === 'boss',
                    d.name + ': ' + fights + ' fight rooms in three sections, four shrines, the boss at the end');
                expect(dun.gates.length === dun.rooms.length, 'a gate out of every room, and a door behind you into the boss');
                expect(dun.chests.length === d.rooms.length, 'and a chest in each section');
            }
        }
    }
    expect(!unreachable.length, 'every room, exit and chest of 75 dungeons can be walked to from the start', unreachable.slice(0, 6).join('; '));
    expect(!spawnsOut.length, 'and every minion starts on floor inside its own room', spawnsOut.slice(0, 6).join('; '));
    expect(Math.max(...sizes) <= 10, 'the first room never has more than ten in it, for a level one party', 'up to ' + Math.max(...sizes));
    const a = S.newRun({ seed: 4242, dungeon: 'registry', players: SEATS }), b = S.newRun({ seed: 4242, dungeon: 'registry', players: SEATS }), c = S.newRun({ seed: 4243, dungeon: 'registry', players: SEATS });
    const sig = s => JSON.stringify(s.dun.rooms.map(r => [r.x0, r.z0, r.x1, r.z1])) + s.minions.map(m => m.id + m.kind + m.x.toFixed(2) + m.z.toFixed(2)).join();
    expect(sig(a) === sig(b), 'the same seed is the same dungeon and the same minions on every screen');
    expect(sig(a) !== sig(c), 'and another seed is another one');
}

// ===================================================================
section('the rules');
// ===================================================================
const fresh = (dungeon = 'bin', seed = 9) => {
    const s = S.newRun({ seed, dungeon, stats: true, players: SEATS });
    s.phase = 'live';
    return s;
};
const ticks = (s, sec, brains) => { for (let i = 0; i < sec * S.HZ && !s.over; i++) { if (brains) brains.forEach((b, k) => S.think(s, k, b)); S.step(s); } };
{
    const s = fresh();
    expect(s.heroes.length === 4 && s.heroes.every(h => h.level === 1 && h.picks === 1 && h.skills.length === 0), 'four heroes at level one, each with a card to spend');
    expect(s.heroes.every(h => h.offer && h.offer.some(c => c.t === 'new') && h.offer.every(c => c.t !== 'pas')), 'and the first card is always a skill');
    expect(S.command(s, 0, { c: 'cast', k: 0 }) === 'empty', 'casting with nothing in the slot is refused');
    expect(S.command(s, 0, { c: 'pick', n: 0 }) === null && s.heroes[0].skills.length === 1, 'a pick at the entrance shrine gives a skill');
    expect(S.command(s, 0, { c: 'pick', n: 0 }) === 'nothing', 'and there is nothing more to pick');
    ['x', null, 7, { c: 'cast', k: 99 }, { c: 'pick', n: 'hello' }, { c: 'hack' }].forEach(c => S.command(s, 1, c));
    expect(true, 'nonsense from a stranger is refused without throwing');
    // the gate only opens once everybody has picked
    expect(!s.gateOpen[s.dun.rooms[0].gate], 'the way on stays shut while somebody is still choosing');
    for (let i = 1; i < 4; i++) S.command(s, i, { c: 'pick', n: 0 });
    ticks(s, 0.2);
    expect(!!s.gateOpen[s.dun.rooms[0].gate] && s.frontier === 1, 'and opens once they all have');
    // a cast: cooldown, power from a clean drawing
    const h = s.heroes[0];
    const id = h.skills[0].id;
    expect(S.command(s, 0, { c: 'cast', k: 0, q: 0 }) === null && h.skills[0].cd > 0, 'a cast puts ' + id + ' on cooldown');
    expect(S.command(s, 0, { c: 'cast', k: 0 }) === 'cooling', 'and it cannot go again until it comes back');
    expect(S.drawPower(0) === 1 && S.drawPower(0.85) >= 1.49 && S.drawPower(0.6) > 1 && S.drawPower(0.6) < 1.5, 'a key casts at 100%, and a drawing at up to 150% by how clean it is', [0, 0.6, 0.85].map(q => S.drawPower(q).toFixed(2)).join(' '));
    expect(S.command(s, 0, { c: 'pick', n: 0 }) !== null, 'cards cannot be spent away from a shrine');
}
{
    // a staff bolt, a firewall's front, a healer that cannot mend a healer
    const s = fresh('registry', 12);
    const h = s.heroes[0];
    const room = s.dun.rooms[1];
    const mk = (kind, x, z) => { const m = s.minions.find(q => q.kind === kind) || s.minions[0]; return Object.assign(m, { kind, x, z, state: 1, hp: D.MINIONS[kind].hp, maxHp: D.MINIONS[kind].hp, r: D.MINIONS[kind].r, act: 0, cd: 5, stunT: 9 }); };
    s.minions.forEach(m => { m.state = 2; });
    h.x = room.cx; h.z = room.z0 + 3; h.yaw = Math.PI;
    s.entered.fill(1);
    const g = mk('gremlin', room.cx, room.z0 + 9);
    const hp0 = g.hp;
    s.input[0] = Object.assign(S.blankInput(), { yaw: Math.PI, fire: true });
    ticks(s, 1);
    expect(g.hp < hp0, 'the staff hits what it is pointed at', Math.round(hp0 - g.hp) + ' damage in a second');
    // the firewall
    const f = Object.assign({}, g, { id: 999999, kind: 'shield', hp: 200, maxHp: 200, yaw: 0, stunT: 0, r: 0.6 });
    const front = S.damageEnemy(s, f, 50, { o: 0, src: 'bolt', fx: 0, fz: 30 });
    f.yaw = Math.PI;
    const back = S.damageEnemy(s, f, 50, { o: 0, src: 'bolt', fx: 0, fz: 30 });
    expect(front < back * 0.5, 'a firewall takes most of a shot from the front off, and none from behind', front + ' against ' + back);
}
{
    // down, revived, out, and a wipe
    const s = fresh('bin', 21);
    for (let i = 0; i < 4; i++) S.command(s, i, { c: 'pick', n: 0 });
    ticks(s, 0.2);
    const [a, b] = s.heroes;
    S.hurtHero(s, a, 1e6, 0);
    expect(a.down && !a.out && a.bleed > 20, 'at no health a hero is down, not dead');
    b.x = a.x + 1; b.z = a.z;
    ticks(s, RUN().down.revive + 0.3);
    expect(!a.down && a.hp > 0, 'a friend standing next to them brings them back', Math.round(a.hp) + ' health');
    s.heroes.forEach((o, k) => { if (k) { o.x = a.x + 6 + k * 3; } });
    a.safe = 0;
    S.hurtHero(s, a, 1e6, 0);
    ticks(s, RUN().down.bleed + 0.5);
    expect(a.out, 'nobody comes for 25 seconds and they are out');
    const cont = s.continues;
    s.heroes.forEach(h => S.hurtHero(s, h, 1e6, 0));
    ticks(s, RUN().wipeDelay + 0.3);
    expect(s.continues === cont - 1 && s.heroes.every(h => !h.down && !h.out && h.hp === h.maxHp), 'everybody down is a wipe: back up at the shrine, one continue fewer');
    for (let k = 0; k < 2; k++) { s.heroes.forEach(h => { h.safe = 0; S.hurtHero(s, h, 1e6, 0); }); ticks(s, RUN().wipeDelay + 0.3); }
    expect(s.over === 'lose', 'and out of continues, the run is over', s.over + ', ' + s.continues);
}
function RUN() { return D.RUN; }
{
    // levels and cards
    const s = fresh('bin', 5);
    const h = s.heroes[2];
    const lv = h.level;
    S.damageEnemy(s, Object.assign(s.minions[0], { state: 1, hp: 1 }), 10, { o: 0, src: 'bolt' });
    expect(h.xp > 0, 'a kill by somebody else gives this hero the xp too', h.xp.toFixed(1) + ' xp');
    for (let k = 0; k < 40; k++) S.damageEnemy(s, Object.assign(s.minions[k + 1], { state: 1, hp: 1 }), 10, { o: 1, src: 'bolt' });
    expect(h.level > lv && h.picks > 1, 'and levels give cards', 'level ' + h.level + ', ' + h.picks + ' cards');
    // fill a hero up and see that nothing goes over the top
    const t = s.heroes[3];
    t.picks = 60; S.rollOffer(s, t);
    for (let k = 0; k < 60 && t.offer; k++) S.command(s, 3, { c: 'pick', n: k % 3 });
    expect(t.skills.length <= D.MAX_SKILLS && t.skills.every(q => q.rank <= 3) && D.PASSIVES.every(p => (t.pas[p.id] || 0) <= p.max), 'never more than four skills, rank three, or a passive past its limit', t.skills.map(q => q.id + q.rank).join(' '));
}

// ===================================================================
section('the wire');
// ===================================================================
{
    const W = load(), S2 = W.DZ_SIM;
    const host = S.newRun({ seed: 31337, dungeon: 'bsod', stats: true, players: SEATS });
    const brains = host.heroes.map((h, i) => S.newBrain(i + 1, { pick: 'random' }));
    // play until a crowd is awake, then measure what one snapshot costs
    let biggest = 0, crowd = 0, sizes = [];
    for (let t = 0; t < S.HZ * 240 && !host.over; t++) {
        brains.forEach((b, i) => S.think(host, i, b));
        S.step(host);
        host.ev.length = 0;
        if (t % 4 === 0) {
            const json = JSON.stringify(S.snapshot(host, null, [1, 2, 3]));
            sizes.push(json.length);
            const awake = host.minions.filter(m => m.state === 1).length;
            if (json.length > biggest) { biggest = json.length; crowd = awake; }
        }
    }
    const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    // over the relays: 5 a second, through four relays, about 1.4 times the bytes once it is encrypted and signed
    const mbMin = avg * 1.4 * 5 * 60 * 4 / 1048576;
    expect(biggest < 6000, 'the biggest snapshot of a hard run stays small', biggest + ' bytes, with ' + crowd + ' awake');
    expect(mbMin < 3, 'and on average it fits the relays\' budget of 3MB a minute for the host', mbMin.toFixed(2) + 'MB a minute over four, ' + Math.round(avg) + ' bytes a snapshot');
    // a guest builds the same dungeon from the seed and draws the rest from the snapshot
    const guest = S2.newRun({ seed: 31337, dungeon: 'bsod', players: SEATS });
    guest.guessing = true;
    S2.applySnapshot(guest, JSON.parse(JSON.stringify(S.snapshot(host, null, [1, 2, 3], true))));
    const hAgree = host.heroes.every((h, i) => Math.hypot(h.x - guest.heroes[i].x, h.z - guest.heroes[i].z) < 0.3 && Math.abs(h.hp - guest.heroes[i].hp) <= 1 && h.level === guest.heroes[i].level && h.skills.length === guest.heroes[i].skills.length);
    expect(hAgree, 'a guest agrees where the heroes are, their health, levels and skills');
    const awakeH = host.minions.filter(m => m.state === 1).map(m => m.id).sort().join();
    const awakeG = guest.minions.filter(m => m.state === 1).map(m => m.id).sort().join();
    expect(awakeH === awakeG, 'and which minions are awake, without being sent the sleeping ones', host.minions.filter(m => m.state === 1).length + ' awake');
    expect(host.frontier === guest.frontier && Array.from(host.gateOpen).join() === Array.from(guest.gateOpen).join(), 'and which gates are open');
    // a wipe on the host rebuilds the rooms on the guest from the seed too
    host.heroes.forEach(h => S.hurtHero(host, h, 1e6, 0));
    for (let t = 0; t < S.HZ * 4; t++) S.step(host);
    S2.applySnapshot(guest, JSON.parse(JSON.stringify(S.snapshot(host, null, [], true))));
    const sameAfter = host.minions.filter(m => m.state === 0).length > 0 && host.minions.filter(m => m.state === 0).map(m => m.id + m.kind + m.x.toFixed(1)).join() === guest.minions.filter(m => m.state === 0).map(m => m.id + m.kind + m.x.toFixed(1)).join();
    expect(host.attempt === guest.attempt && sameAfter, 'and after a wipe a guest rebuilds the same fresh minions as the host', 'attempt ' + guest.attempt);
}

// ===================================================================
section('balance: parties of bots, many runs of every dungeon');
// ===================================================================
const RUNS = +(process.env.DZ_RUNS || 36);
const jobs = [];
for (const d of D.DUNGEONS) for (let k = 0; k < RUNS; k++) jobs.push({ dungeon: d.id, seed: 1000 + k * 7919 });
// half the cores: the runs make garbage, and the collector's threads are shared
const nWorkers = Math.max(1, Math.min(Math.floor(os.cpus().length / 2), 6, jobs.length));
const results = (await Promise.all(Array.from({ length: nWorkers }, (_, w) => new Promise((res, rej) => {
    const mine = jobs.filter((_, k) => k % nWorkers === w);
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: mine } });
    wk.on('message', res);
    wk.on('error', rej);
})))).flat();
console.log('        ' + results.length + ' runs on ' + nWorkers + ' threads in ' + Math.round((Date.now() - STARTED) / 1000) + 's');
const by = {};
for (const r of results) (by[r.dungeon] = by[r.dungeon] || []).push(r);
const mean = (a, f) => a.length ? a.reduce((s, r) => s + f(r), 0) / a.length : NaN;
const TARGET = {
    bin: { clear: [0.85, 1], time: [2.5, 8], lv: [4, 9] },
    registry: { clear: [0.55, 0.97], time: [3.5, 11], lv: [5.5, 11] },
    bsod: { clear: [0.3, 0.85], time: [4.5, 14], lv: [6.5, 13] }
};
const clear = {};
for (const d of D.DUNGEONS) {
    const rs = by[d.id], wins = rs.filter(r => r.win), T = TARGET[d.id];
    const c = wins.length / rs.length;
    clear[d.id] = c;
    expect(rs.every(r => !r.timeout), d.name + ': no run gets stuck', rs.filter(r => r.timeout).map(r => r.seed + ' at room ' + r.frontier).join(', '));
    expect(c >= T.clear[0] && c <= T.clear[1], d.name + ' (' + d.tier + ') is cleared ' + pct(T.clear[0]) + ' to ' + pct(T.clear[1]) + ' of the time', pct(c) + ' of ' + rs.length);
    const mins = mean(wins, r => r.t) / 60;
    expect(mins >= T.time[0] && mins <= T.time[1], 'a clear takes ' + T.time[0] + ' to ' + T.time[1] + ' minutes of bot time', mins.toFixed(1) + ' minutes on average');
    const boss = mean(wins, r => r.bossT);
    expect(boss >= 40 && boss <= 240, 'the boss takes 40s to 4 minutes', Math.round(boss) + 's on average');
    const lv = mean(rs.filter(r => r.bossAt >= 0), r => r.lv);
    expect(lv >= T.lv[0] && lv <= T.lv[1], 'the party reaches the boss at level ' + T.lv[0] + ' to ' + T.lv[1], lv.toFixed(1));
    const fails = rs.filter(r => !r.win);
    const early = fails.filter(r => r.frontier <= 2).length;
    expect(early <= Math.max(1, rs.length * 0.06), 'and when it fails it is rarely in the first two rooms', early + ' of ' + fails.length + ' failures');
    if (process.env.DZ_TABLE) console.log('        ' + d.id + ': downs ' + mean(rs, r => r.downs).toFixed(1) + ', wipes ' + mean(rs, r => r.wipes).toFixed(2) + ', revives ' + mean(rs, r => r.revives).toFixed(1) + ', kills ' + mean(rs, r => r.kills).toFixed(0) + ', fails at ' + fails.map(r => r.frontier + '/' + r.rooms).join(' '));
}
expect(clear.bin > clear.registry && clear.registry > clear.bsod, 'easy is easier than normal, and normal than hard', pct(clear.bin) + ' > ' + pct(clear.registry) + ' > ' + pct(clear.bsod));
{
    // what a card is worth: damage done and health saved, per second somebody owned it
    const value = {}, own = {}, pickN = {};
    for (const r of results) {
        for (const k in r.own) own[k] = (own[k] || 0) + r.own[k];
        for (const k in r.dmg) value[k] = (value[k] || 0) + r.dmg[k];
        for (const k in r.saved) value[k] = (value[k] || 0) + r.saved[k];
        for (const k in r.picks) pickN[k] = (pickN[k] || 0) + r.picks[k];
    }
    const per = D.SKILLS.map(sk => ({ id: sk.id, v: (value[sk.id] || 0) / Math.max(1, own[sk.id] || 0), own: own[sk.id] || 0, picks: pickN[sk.id] || 0 }));
    const sorted = per.map(p => p.v).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const strong = per.filter(p => p.v > median * 3), weak = per.filter(p => p.v < median * 0.33);
    if (process.env.DZ_TABLE) per.slice().sort((a, b) => b.v - a.v).forEach(p => console.log('        ' + p.id.padEnd(15) + (p.v / median).toFixed(2) + 'x the median, ' + p.picks + ' picks'));
    expect(per.every(p => p.picks >= results.length * 0.15), 'every skill gets picked', per.map(p => p.id + ' ' + p.picks).join(', '));
    expect(!strong.length, 'no skill does more than three times the median per second owned', strong.map(p => p.id + ' ' + (p.v / median).toFixed(1) + 'x').join(', '));
    expect(!weak.length, 'and none does less than a third of it', weak.map(p => p.id + ' ' + (p.v / median).toFixed(2) + 'x').join(', '));
    // and what a party carrying it does, on the dungeons that can be lost. Measured from the
    // second shrine, with what the party held there: counted at the end, every card would look
    // good, because a party that got further had picked more of them
    const hard = results.filter(r => r.dungeon !== 'bin' && r.mid);
    const base = hard.filter(r => r.win).length / hard.length;
    const swing = [];
    for (const sk of D.SKILLS) {
        const w = hard.filter(r => r.mid.skills.includes(sk.id)), wo = hard.filter(r => !r.mid.skills.includes(sk.id));
        if (w.length < 8 || wo.length < 8) continue;
        const dlt = w.filter(r => r.win).length / w.length - wo.filter(r => r.win).length / wo.length;
        swing.push({ id: sk.id, d: dlt, n: w.length });
    }
    if (process.env.DZ_TABLE) swing.forEach(q => console.log('        ' + q.id.padEnd(15) + 'with it ' + (q.d >= 0 ? '+' : '') + pct(q.d) + ' (' + q.n + ' runs)'));
    const outliers = swing.filter(q => Math.abs(q.d) > 0.3);
    expect(!outliers.length, 'no skill held at the second shrine moves a party\'s clear rate by more than 30 points either way', outliers.map(q => q.id + ' ' + pct(q.d)).join(', ') || hard.length + ' runs got there, ' + pct(base) + ' of them cleared');
    const pasSwing = [];
    for (const p of D.PASSIVES) {
        const w = hard.filter(r => r.mid.pas.includes(p.id)), wo = hard.filter(r => !r.mid.pas.includes(p.id));
        if (w.length < 8 || wo.length < 8) continue;
        pasSwing.push({ id: p.id, d: w.filter(r => r.win).length / w.length - wo.filter(r => r.win).length / wo.length });
    }
    const pasOut = pasSwing.filter(q => Math.abs(q.d) > 0.3);
    expect(D.PASSIVES.every(p => (pickN['pas:' + p.id] || 0) >= results.length * 0.1), 'every passive gets picked', D.PASSIVES.map(p => p.id + ' ' + (pickN['pas:' + p.id] || 0)).join(', '));
    expect(!pasOut.length, 'and none of them moves the clear rate by more than 30 points', pasOut.map(q => q.id + ' ' + pct(q.d)).join(', '));
}

// ===================================================================
section('wired into the site');
// ===================================================================
{
    const index = read('index.html');
    const sw = read('sw.js');
    const later = (sw.match(/PRECACHE_LATER = \[([\s\S]*?)\]/) || [])[1] || '';
    const np = read('games/netplay.js');
    const files = ['games/dungeonz/dungeonz-data.js', 'games/dungeonz/dungeonz-sim.js', 'games/dungeonz/dungeonz-gl.js', 'games/dungeonz/dungeonz.js', 'games/ps1/ps1-world.js', 'games/ps1/ps1-gl.js'];
    for (const f of files) {
        expect(fs.existsSync(path.join(ROOT, f)) && !index.includes(f), f + ' exists, and is not in the first load');
        expect(later.includes("'/" + f + "'"), 'and the service worker keeps it for later');
        expect(np.includes("'" + f + "'"), 'and the lobby knows it');
    }
    expect(later.includes("'/games/dungeonz/dungeonz.css'") && !read('css/style.css').includes('.dz-'), 'its stylesheet comes with it, not with the desktop');
    const ui = read('games/dungeonz/dungeonz.js');
    expect(/transport\.kind === 'bus'/.test(ui) && /const onRelays = g =>/.test(ui), 'it eases off over the relays, and asks each time');
    expect(/net:down/.test(ui) && /net:up/.test(ui) && /player-leave/.test(ui), 'it hears the line going quiet, coming back, and people leaving');
    const css = read('games/dungeonz/dungeonz.css') + read('css/style.css');
    const used = [...new Set([...ui.matchAll(/class="([^"$]*)"/g)].flatMap(m => m[1].split(/\s+/)))].filter(c => /^(dz|wz)-/.test(c));
    const unstyled = used.filter(c => !new RegExp('\\.' + c + '[\\s,:{.\\[>]').test(css));
    expect(!unstyled.length, 'every class it uses has a style', unstyled.join(', '));
    expect(index.includes("startMenuAction('dungeonz')"), 'it is in the start menu');
    expect(/openDungeonz: 'dungeonz'/.test(read('js/web.js')) && read('404.html').includes("'dungeonz'"), 'and has an address, /dungeonz');
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed') + ' in ' + Math.round((Date.now() - STARTED) / 1000) + 's');
process.exit(failures ? 1 : 0);
