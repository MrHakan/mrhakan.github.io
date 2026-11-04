// ===================================================================
// check-wizardz.mjs — the rules, and a thousand matches of bots
//
// A shooter cannot be balanced by looking at it. So the targets are written down
// here, and the simulation is held to them: bots with random spellbooks play each
// other, and every one of the fifty spells has to win about as often as it loses
// when it is in the book. Seeds are fixed, so a number only moves when the rules or
// the data do. Tune in wizardz-data.js and run this.
//
//   node .github/scripts/check-wizardz.mjs
//   WZ_MATCHES=3000 WZ_TABLE=1 node ...       more matches, and the whole table
// ===================================================================
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let checks = 0, failures = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
const pct = n => (n * 100).toFixed(0) + '%';

const window = {};
const ctx = vm.createContext({ window, console });
vm.runInContext(read('games/wizardz/wizardz-data.js'), ctx);
vm.runInContext(read('games/wizardz/wizardz-sim.js'), ctx);
vm.runInContext(read('games/wizardz/wizardz-gl.js'), ctx);
const D = window.WZ, S = window.WZ_SIM, A = D.ARENA;
const HZ = S.HZ;
const SPELLS = D.SPELLS;

const fresh = (seed = 7) => {
    const s = S.newMatch({ seed, stats: true, players: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] });
    s.phase = 'live'; s.phaseT = 0;
    return s;
};
const stepFor = (s, sec) => { for (let i = 0; i < sec * HZ && s.over === null; i++) S.step(s); };
const spell = id => D.byId(id);
// put the two of them on open floor, a known distance apart, looking at each other
function faceOff(s, d = 8) {
    const [a, b] = s.wiz;
    // a clear strip of floor on the north side
    a.x = 11; a.z = -8; b.x = 11; b.z = -8 - d;
    a.y = b.y = 0;
    return aimAt(s, 0, 1);
}
function aimAt(s, i, j, height = 1) {
    const w = s.wiz[i], t = s.wiz[j];
    // the crosshair is a line from the camera, so walk it in
    for (let k = 0; k < 6; k++) {
        const c = S.camera(s, w);
        const yaw = Math.atan2(t.x - c.x, -(t.z - c.z));
        const pitch = Math.atan2(t.y + height - c.y, Math.hypot(t.x - c.x, t.z - c.z));
        w.yaw = yaw; w.pitch = pitch;
        s.input[i].yaw = yaw; s.input[i].pitch = pitch;
    }
    return { y: w.yaw, p: w.pitch };
}
const fire = (s, i, aim) => { s.wiz[i].fireCd = 0; return S.command(s, i, { c: 'fire', y: aim.y, p: aim.p }); };

// ===================================================================
section('the wizard faces where you look');
// ===================================================================
{
    const off = [];
    for (let yaw = -3.1; yaw < 3.2; yaw += 0.37) {
        const f = S.forward(yaw, 0), m = window.WZ_GL.modelFacing(yaw);
        if (Math.hypot(f.x - m.x, f.z - m.z) > 0.001) off.push(yaw.toFixed(2));
    }
    expect(!off.length, 'turn the camera and the model turns the same way, at every angle', off.join(', '));
    // and the code uses the camera's yaw for your own wizard, not the last one the sim heard
    expect(/const yawNow = mine \? g\.yaw : w\.yaw;/.test(read('games/wizardz/wizardz.js')), 'your own wizard turns with the mouse, straight away');
}

// ===================================================================
section('commands: the one way anything changes');
// ===================================================================
{
    let s = fresh();
    const junk = [null, undefined, 3, 'x', {}, { c: 'nope' }, { c: 'cast' }, { c: 'cast', s: 'nope' }, { c: 'cast', s: '__proto__' }, { c: 'cast', s: 'constructor' }, { c: 'cast', s: 7 }, { c: '__proto__' }, { c: 'constructor' }, { c: 'toString' }, { c: 'fire', y: NaN }];
    let threw = null;
    const before = JSON.stringify(s.wiz[1]);
    for (const j of junk) {
        try {
            const why = S.command(s, 1, j);
            if (why === null && !(j && j.c === 'fire')) threw = 'accepted ' + JSON.stringify(j);
        } catch (e) { threw = e.message; }
    }
    expect(!threw, 'nonsense is refused rather than thrown', threw || '');
    expect(S.command(s, 5, { c: 'fire' }) === 'bad' && S.command(s, -1, { c: 'fire' }) === 'bad', 'and a seat that does not exist has no say');
    s = fresh();
    S.setInput(s, 0, { mx: 99, mz: NaN, yaw: Infinity, pitch: 40, jump: 'yes' });
    const inp = s.input[0];
    expect(inp.mx === 1 && inp.mz === 0 && inp.yaw === 0 && Math.abs(inp.pitch) <= 1.4 && inp.jump === true, 'silly input is cleaned up', JSON.stringify(inp));
    expect(JSON.stringify(S.sanitizeInput(null)) === JSON.stringify(S.blankInput()), 'and no input at all is standing still');

    s = fresh();
    s.phase = 'countdown';
    expect(S.command(s, 0, { c: 'cast', s: 'fireball', q: 1 }) === 'inactive' && !s.wiz[0].chamber && s.wiz[0].ink === A.startInk, 'nothing can be cast before the fight');
    s = fresh();
    s.wiz[0].dead = true;
    expect(S.command(s, 0, { c: 'cast', s: 'fireball', q: 1 }) === 'dead', 'or by the dead');
    expect(S.command(s, 0, { c: 'fire' }) === 'dead', 'and the dead do not shoot');
    s = fresh();
    s.wiz[0].st.freeze = { t: 2 };
    expect(S.command(s, 0, { c: 'cast', s: 'fireball', q: 1 }) === 'frozen' && S.command(s, 0, { c: 'fire' }) === 'frozen', 'nor can anyone frozen');
    s = fresh();
    s.wiz[0].ink = 1;
    expect(S.command(s, 0, { c: 'cast', s: 'fireball', q: 1 }) === 'ink' && s.wiz[0].ink === 1, 'no ink, no spell, and nothing is taken');
    s = fresh();
    s.wiz[0].hp = 5;
    expect(S.command(s, 0, { c: 'cast', s: 'sacrifice', q: 1 }) === 'health' && s.wiz[0].hp === 5, 'a blood spell cannot kill the one casting it');
    s = fresh();
    S.command(s, 0, { c: 'resign' });
    expect(s.over === 1 && s.reason === 'resign', 'giving up hands it to the other side');
    expect(S.command(s, 0, { c: 'fire' }) === 'over', 'and a finished match takes no more orders');
}

// ===================================================================
section('a sigil is a reload');
// ===================================================================
{
    let s = fresh();
    const fb = spell('fireball');
    const w = s.wiz[0];
    const ink = w.ink;
    expect(S.command(s, 0, { c: 'cast', s: 'fireball', q: 0.2 }) === null, 'drawing a shot works');
    expect(w.ink === ink - fb.cost, 'it costs the ink', ink + ' to ' + w.ink);
    expect(w.chamber && w.chamber.s === 'fireball' && w.chamber.n === fb.charges, 'and goes in the staff rather than off', JSON.stringify(w.chamber));
    expect(S.command(s, 0, { c: 'cast', s: 'fireball', q: 1 }) === 'cooling', 'and it has a cooldown');
    s = fresh();
    S.command(s, 0, { c: 'cast', s: 'fireball', q: 1 });
    expect(s.wiz[0].chamber.n === fb.charges + 1, 'a clean drawing of a many-shot spell loads one extra', String(s.wiz[0].chamber.n));
    const lo = fresh(), hi = fresh();
    S.command(lo, 0, { c: 'cast', s: 'flamelance', q: 0 });
    S.command(hi, 0, { c: 'cast', s: 'flamelance', q: 1 });
    expect(hi.wiz[0].chamber.power > lo.wiz[0].chamber.power * 1.3, 'and a clean one hits harder', lo.wiz[0].chamber.power + ' to ' + hi.wiz[0].chamber.power);
    s = fresh();
    S.command(s, 0, { c: 'cast', s: 'spark', q: 0 });
    S.command(s, 0, { c: 'cast', s: 'flamelance', q: 0 });
    expect(s.wiz[0].chamber.s === 'flamelance', 'drawing another replaces what was loaded');
    s = fresh();
    const a = faceOff(s);
    S.command(s, 0, { c: 'cast', s: 'flamelance', q: 0.5 });
    expect(fire(s, 0, a) === null && s.ents.length === 1 && s.ents[0].s === 'flamelance' && !s.wiz[0].chamber, 'the last charge fires and empties it', s.ents.length + ' ents');
    expect(S.command(s, 0, { c: 'fire', y: a.y, p: a.p }) === 'cooling', 'the staff has a rate of fire');
    s = fresh();
    const a2 = faceOff(s);
    fire(s, 0, a2);
    expect(s.ents[0] && s.ents[0].zap, 'an empty staff still fires its free shot');
    const inkBefore = s.wiz[0].ink;
    stepFor(s, 0.8);
    expect(s.wiz[1].hp === A.maxHp - A.zap.dmg, 'which lands, for not very much', String(s.wiz[1].hp));
    expect(s.wiz[0].ink > inkBefore + A.inkOnHit * 0.9, 'and earns ink back', inkBefore.toFixed(1) + ' to ' + s.wiz[0].ink.toFixed(1));
    s = fresh();
    S.command(s, 0, { c: 'cast', s: 'regrowth', q: 0.5 });
    expect(!s.wiz[0].chamber && s.wiz[0].st.regen, 'a self spell goes off at once, and the chamber stays free');
    s = fresh();
    S.command(s, 0, { c: 'cast', s: 'spark', q: 0 });
    S.command(s, 0, { c: 'cast', s: 'runeward', q: 0 });
    expect(s.wiz[0].chamber && s.wiz[0].chamber.s === 'spark' && s.wiz[0].ward > 0, 'and leaves what is already loaded alone');
    s = fresh();
    S.command(s, 0, { c: 'cast', s: 'bloodpact', q: 0.5 });
    const hp = s.wiz[0].hp, inkP = s.wiz[0].ink;
    S.command(s, 0, { c: 'cast', s: 'fireball', q: 0.5 });
    expect(s.wiz[0].ink === inkP && s.wiz[0].hp < hp, 'a blood pact pays in health instead of ink');
    s = fresh();
    S.command(s, 0, { c: 'cast', s: 'rift', q: 0.5 });
    S.setInput(s, 0, { ink: true });
    stepFor(s, 0.1);
    expect(S.command(s, 0, { c: 'fire' }) === 'stance', 'you cannot fire while you are drawing');
}

// ===================================================================
section('the ink stance');
// ===================================================================
{
    let s = fresh();
    let a = faceOff(s);
    fire(s, 1, aimAt(s, 1, 0));
    S.setInput(s, 0, { ink: true, yaw: a.y, pitch: a.p });
    S.setInput(s, 1, { yaw: s.wiz[1].yaw, pitch: s.wiz[1].pitch });
    stepFor(s, 1);
    expect(s.wiz[0].stance, 'the input puts you in it');
    expect(Math.abs((A.maxHp - s.wiz[0].hp) - A.zap.dmg * A.stance.hurt) < 0.01, 'and you take a fifth more damage', (A.maxHp - s.wiz[0].hp).toFixed(1));

    const walk = (ink) => {
        const q = fresh();
        q.wiz[0].x = -6; q.wiz[0].z = 11; q.wiz[0].yaw = 0;
        S.setInput(q, 0, { mz: 1, ink });
        for (let i = 0; i < HZ; i++) S.step(q);
        return Math.abs(q.wiz[0].z - 11);
    };
    expect(walk(true) < walk(false) * 0.45, 'you can only shuffle', walk(true).toFixed(1) + 'm against ' + walk(false).toFixed(1) + 'm in a second');

    // a shot crossing the bubble of a drawing wizard slows right down
    const flight = (ink) => {
        const q = fresh();
        const aim = faceOff(q, 14);
        const b = aimAt(q, 1, 0);
        q.wiz[1].chamber = { s: 'deepfreeze', n: 1, power: 1 };
        fire(q, 1, b);
        S.setInput(q, 0, { ink, yaw: aim.y, pitch: aim.p });
        S.setInput(q, 1, { yaw: b.y, pitch: b.p });
        let t = 0;
        while (q.wiz[0].hp >= A.maxHp && t < 4) { S.step(q); t += 1 / HZ; }
        return t;
    };
    const fast = flight(false), slow = flight(true);
    expect(slow > fast * 1.5, 'and anything of theirs flying near you slows down', fast.toFixed(2) + 's to ' + slow.toFixed(2) + 's');
}

// ===================================================================
section('how a match ends');
// ===================================================================
{
    let s = fresh();
    s.wiz[1].hp = 1;
    faceOff(s);
    fire(s, 0, aimAt(s, 0, 1));
    S.setInput(s, 0, { yaw: s.wiz[0].yaw, pitch: s.wiz[0].pitch });
    stepFor(s, 0.7);
    expect(s.score[0] === 1 && s.wiz[1].dead, 'a knockout counts');
    expect(s.over === null, 'and the match goes on');
    stepFor(s, A.respawn + 0.3);
    expect(!s.wiz[1].dead && s.wiz[1].hp === A.maxHp, 'they come back', 'at ' + Math.round(s.wiz[1].x) + ',' + Math.round(s.wiz[1].z));
    expect(s.wiz[1].safe > 0, 'and cannot be hit straight away');
    s.wiz[1].safe = 0;
    s.score = [A.knockouts - 1, 0];
    s.wiz[1].hp = 1;
    faceOff(s);
    fire(s, 0, aimAt(s, 0, 1));
    S.setInput(s, 0, { yaw: s.wiz[0].yaw, pitch: s.wiz[0].pitch });
    stepFor(s, 0.7);
    expect(s.over === 0 && s.reason === 'ko', 'three of them is the match', String(s.reason));

    s = fresh();
    s.wiz[0].x = 0; s.wiz[0].z = 0; s.wiz[0].y = A.altar.h;
    s.wiz[1].x = 20; s.wiz[1].z = 20;
    stepFor(s, 3);
    expect(s.altar[0] > 2.8 && s.altar[0] < 3.2 && s.onAltar === 0, 'standing alone on the altar does the ritual', s.altar[0].toFixed(1) + 's');
    s.wiz[1].x = 1; s.wiz[1].z = 1; s.wiz[1].y = A.altar.h;
    const held = s.altar[0];
    stepFor(s, 2);
    expect(Math.abs(s.altar[0] - held) < 0.01 && s.altar[1] === 0 && s.onAltar === 2, 'two on it and it stops');
    s.wiz[1].x = 20; s.wiz[1].z = 20; s.wiz[1].y = 0;
    s.altar[0] = 20;
    s.wiz[0].hp = 1;
    s.wiz[1].st = {};
    // a knockout takes a share of it back
    S.command(s, 1, { c: 'cast', s: 'smite', q: 1 });
    s.wiz[0].hp = 0.1;
    s.wiz[0].st.burn = { t: 2, dps: 50 };
    stepFor(s, 0.3);
    expect(Math.abs(s.altar[0] - 20 * (1 - A.ritualKo)) < 0.6, 'being knocked out costs you a quarter of it', s.altar[0].toFixed(1));
    s = fresh();
    s.wiz[0].x = 0; s.wiz[0].z = 0; s.wiz[0].y = A.altar.h;
    s.wiz[1].x = 20; s.wiz[1].z = 20;
    s.altar[0] = A.ritual - 0.1;
    stepFor(s, 0.5);
    expect(s.over === 0 && s.reason === 'ritual', 'finishing it wins outright');

    s = fresh();
    s.t = A.fogAt - 1;
    s.wiz[0].x = -28; s.wiz[0].z = 28;
    s.wiz[1].x = 0; s.wiz[1].z = 0; s.wiz[1].y = A.altar.h;
    stepFor(s, 1.2);
    const hp0 = s.wiz[0].hp;
    expect(hp0 >= A.maxHp, 'the fog does not start until it starts', hp0.toFixed(0));
    s.t = A.fogAt + A.fogTime - 1;
    s.wiz[0].st = {};
    const h0 = s.wiz[0].hp;
    stepFor(s, 1);
    expect(s.wiz[0].hp < h0 - 5, 'then it hurts anyone outside', (h0 - s.wiz[0].hp).toFixed(1) + ' a second');
    expect(s.wiz[1].hp === A.maxHp, 'and nobody on the altar');
    s = fresh();
    s.t = A.hardCap - 0.5;
    s.score = [1, 0];
    s.wiz[0].x = s.wiz[1].x = 0; s.wiz[0].z = s.wiz[1].z = 1; s.wiz[0].y = s.wiz[1].y = A.altar.h;
    stepFor(s, 1);
    expect(s.over === 0 && s.reason === 'time', 'and a match that runs out of clock goes to the one ahead', String(s.reason));
}

// ===================================================================
section('the arena');
// ===================================================================
{
    const L = S.LAYOUT;
    const bad = [];
    L.boxes.forEach(b => {
        if (!L.boxes.some(o => o[0] === -b[0] && o[1] === -b[1] && o[4] === b[4])) bad.push('box at ' + b[0] + ',' + b[1]);
    });
    L.pickups.forEach(p => {
        if (!L.pickups.some(o => o.x === -p.x && o.z === -p.z && o.kind === p.kind)) bad.push('pickup at ' + p.x + ',' + p.z);
    });
    expect(!bad.length, 'it is the same from either side, so neither spawn is the good one', bad.join(', '));
    expect(L.spawns[0][0] === -L.spawns[1][0] && L.spawns[0][1] === -L.spawns[1][1], 'and the spawns are opposite');
    for (let k = 0; k < 400; k++) {
        const x = -32 + (k * 37 % 64), z = -32 + (k * 53 % 64);
        if (S.heightAt(x, z) !== S.heightAt(-x, -z)) { bad.push(x + ',' + z); break; }
    }
    expect(!bad.length, 'down to the height map', bad.join(', '));

    // walk it: a person should be able to get to everything from a spawn
    const P = S.navPassable, N = S.NAV_SIDE;
    const cell = (x, z) => Math.floor(z + 32) * N + Math.floor(x + 32);
    const seen = new Uint8Array(N * N);
    const start = cell(L.spawns[0][0], L.spawns[0][1]);
    const queue = [start];
    seen[start] = 1;
    for (let h = 0; h < queue.length; h++) {
        const c = queue[h], x = c % N, z = (c - x) / N;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const a = x + dx, b = z + dz;
            if (a < 0 || b < 0 || a >= N || b >= N) continue;
            const n = b * N + a;
            if (seen[n] || !P[n]) continue;
            seen[n] = 1;
            queue.push(n);
        }
    }
    const nearest = (x, z) => { for (let r = 0; r < 4; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (seen[cell(x + dx, z + dz)]) return true; return false; };
    const stranded = L.pickups.filter(p => !nearest(p.x, p.z)).map(p => p.kind + ' ' + p.x + ',' + p.z);
    expect(!stranded.length, 'every pickup can be walked to', stranded.join(', '));
    expect(nearest(0, 0) && nearest(L.spawns[1][0], L.spawns[1][1]), 'and the altar, and the other spawn');
    expect(L.pickups.every(p => S.heightAt(p.x, p.z) < 2), 'nothing is inside a wall');

    // walking
    let s = fresh();
    const w = s.wiz[0];
    const b = L.boxes.find(q => q[4] > 3);
    w.x = b[0]; w.z = b[1] + b[3] + 1.5; w.yaw = 0; w.y = 0;
    S.setInput(s, 0, { mz: 1 });
    stepFor(s, 2);
    expect(w.z > b[1] + b[3] && Math.abs(w.y) < 0.01, 'you cannot walk through a pillar', 'stopped at ' + w.z.toFixed(1));
    s = fresh();
    const ww = s.wiz[0];
    ww.x = 0; ww.z = A.altar.ramp + 1; ww.yaw = 0; ww.y = 0;
    S.setInput(s, 0, { mz: 1 });
    stepFor(s, 2);
    expect(ww.y > A.altar.h * 0.9, 'you can walk up a ramp', 'at height ' + ww.y.toFixed(2));
    s = fresh();
    const j = s.wiz[0];
    j.x = -6; j.z = 11; j.yaw = 0;
    S.setInput(s, 0, { jump: true });
    S.step(s);
    S.setInput(s, 0, {});
    let top = 0;
    for (let i = 0; i < HZ; i++) { S.step(s); top = Math.max(top, j.y); }
    expect(top > 1.2 && top < 2, 'a jump clears a waist high wall', top.toFixed(2) + 'm');
    expect(j.y === 0 && j.grounded, 'and you land');
    s = fresh();
    const d = s.wiz[0];
    d.x = -6; d.z = 14; d.yaw = 0;
    S.setInput(s, 0, { dash: true, mz: 1 });
    S.step(s);
    S.setInput(s, 0, {});
    stepFor(s, 0.3);
    expect(14 - d.z > 2.5 && d.dashCd > 0, 'a dash is quick, and it has a cooldown', (14 - d.z).toFixed(1) + 'm');

    // the camera is never inside something
    s = fresh();
    const q = s.wiz[0];
    let inside = 0, tests = 0;
    for (let k = 0; k < 500; k++) {
        q.x = -30 + (k * 73 % 60); q.z = -30 + (k * 41 % 60);
        q.y = S.heightAt(q.x, q.z);
        if (q.y > 2) continue;
        q.yaw = k * 0.37; q.pitch = -0.6 + (k % 12) * 0.1;
        const c = S.camera(s, q);
        tests++;
        if (c.y < S.heightAt(c.x, c.z) + 0.05) inside++;
    }
    expect(inside === 0, 'the camera never ends up inside a wall', inside + ' of ' + tests);
}

// ===================================================================
section('things people draw in the world');
// ===================================================================
{
    let s = fresh();
    const a = faceOff(s, 12);
    s.wiz[0].chamber = { s: 'icewall', n: 1, power: 1 };
    fire(s, 0, a);
    const wall = s.ents.find(e => e.k === 'wall');
    expect(!!wall, 'a wall goes up where you point');
    // it stands between them, so their shot should stop at it, and yours should not
    const b = aimAt(s, 1, 0);
    s.wiz[1].fireCd = 0;
    S.command(s, 1, { c: 'fire', y: b.y, p: b.p });
    S.setInput(s, 1, { yaw: b.y, pitch: b.p });
    S.setInput(s, 0, { yaw: a.y, pitch: a.p });
    stepFor(s, 1);
    expect(s.wiz[0].hp === A.maxHp, 'their shot stops at it', s.wiz[0].hp.toFixed(0));
    const a2 = aimAt(s, 0, 1);
    s.wiz[0].fireCd = 0;
    S.command(s, 0, { c: 'fire', y: a2.y, p: a2.p });
    S.setInput(s, 0, { yaw: a2.y, pitch: a2.p });
    stepFor(s, 1);
    expect(s.wiz[1].hp < A.maxHp, 'and your own goes through', s.wiz[1].hp.toFixed(0));
    s = fresh();
    faceOff(s, 12);
    s.wiz[0].pitch = -1.2;
    s.wiz[0].chamber = { s: 'pillar', n: 1, power: 1 };
    const down = { y: s.wiz[0].yaw, p: -1.32 };
    fire(s, 0, down);
    const pil = s.ents.find(e => e.k === 'wall');
    expect(pil && s.wiz[0].y >= pil.h - 0.01, 'a pillar pointed at your feet is a lift', pil ? s.wiz[0].y.toFixed(1) + ' on ' + pil.h.toFixed(1) : '');
    S.setInput(s, 0, { yaw: down.y, pitch: down.p });
    stepFor(s, 0.5);
    expect(s.wiz[0].y >= pil.h - 0.01, 'and you stay up there');
    // banish clears what it lands on, from the middle of a step
    s = fresh();
    const a8 = faceOff(s, 12);
    s.wiz[1].chamber = { s: 'icewall', n: 1, power: 1 };
    fire(s, 1, aimAt(s, 1, 0));
    const theirs = s.ents.find(e => e.k === 'wall');
    s.wiz[0].chamber = { s: 'banish', n: 1, power: 1 };
    fire(s, 0, a8);
    S.setInput(s, 0, { yaw: a8.y, pitch: a8.p });
    S.setInput(s, 1, { yaw: s.wiz[1].yaw, pitch: s.wiz[1].pitch });
    stepFor(s, 1);
    expect(theirs && !s.ents.includes(theirs), 'banish clears a wall it lands on');
    // a mirror
    s = fresh();
    const a3 = faceOff(s, 12);
    s.wiz[1].st.mirror = { t: 5 };
    s.wiz[0].chamber = { s: 'flamelance', n: 1, power: 1 };
    fire(s, 0, a3);
    S.setInput(s, 0, { yaw: a3.y, pitch: a3.p });
    stepFor(s, 0.8);
    expect(s.wiz[1].hp === A.maxHp && !s.wiz[1].st.mirror && s.wiz[0].hp < A.maxHp, 'a mirror sends it back', s.wiz[0].hp.toFixed(0));
    // jumping a thing on the floor
    const spike = (jump) => {
        const q = fresh();
        const a4 = faceOff(q, 6);
        q.wiz[0].chamber = { s: 'stonespike', n: 1, power: 1 };
        fire(q, 0, a4);
        S.setInput(q, 0, { yaw: a4.y, pitch: a4.p });
        for (let k = 0; k < 30; k++) {
            if (jump && k === 0) { q.wiz[1].vy = A.jump; q.wiz[1].grounded = false; }
            S.step(q);
        }
        return q.wiz[1].hp;
    };
    expect(spike(false) < A.maxHp && spike(true) === A.maxHp, 'a jump clears a stone spike', spike(false).toFixed(0) + ' against ' + spike(true).toFixed(0));
    // nothing in the book does nothing: all fifty, off a fresh start, at someone in the open
    const dud = [];
    for (const sp of SPELLS) {
        const q = fresh(11);
        const a5 = faceOff(q, 7);
        q.wiz[0].ink = A.maxInk; q.wiz[1].hp = 60; q.wiz[0].hp = 60;
        q.wiz[0].ink = 90;
        const before = JSON.stringify([q.wiz[0].st, q.wiz[0].ward, q.wiz[0].ink, q.wiz[0].x, q.wiz[0].hp, q.wiz[1].st, q.wiz[1].hp, q.wiz[1].ink]);
        const why = S.command(q, 0, { c: 'cast', s: sp.id, q: 0.8 });
        if (why) { dud.push(sp.id + ' refused: ' + why); continue; }
        if (q.wiz[0].chamber) {
            if (sp.kind === 'zone' || sp.kind === 'trap' || sp.kind === 'strike') { q.wiz[0].pitch = a5.p; }
            const firing = fire(q, 0, a5);
            if (firing) { dud.push(sp.id + ' would not fire: ' + firing); continue; }
        }
        let didSomething = q.ents.length > 0 || JSON.stringify([q.wiz[0].st, q.wiz[0].ward, q.wiz[0].ink, q.wiz[0].x, q.wiz[0].hp, q.wiz[1].st, q.wiz[1].hp, q.wiz[1].ink]) !== before;
        if (!didSomething) dud.push(sp.id + ' did nothing');
        try {
            S.setInput(q, 0, { yaw: a5.y, pitch: a5.p });
            stepFor(q, 3);
        } catch (e) { dud.push(sp.id + ' threw: ' + e.message); }
    }
    expect(!dud.length, 'all fifty do something, and none of them throws', dud.join(', '));
    // the ones that should hit a target standing in the open do
    const misses = [];
    for (const sp of SPELLS) {
        if (!sp.dmg || !['shot', 'beam', 'strike'].includes(sp.kind)) continue;
        const q = fresh(5);
        const a6 = faceOff(q, 7);
        q.wiz[1].hp = 99;
        q.wiz[0].chamber = { s: sp.id, n: 1, power: 1 };
        fire(q, 0, a6);
        S.setInput(q, 0, { yaw: a6.y, pitch: a6.p });
        stepFor(q, 3);
        if (q.wiz[1].hp >= 99 && !q.wiz[1].dead) misses.push(sp.id);
    }
    expect(!misses.length, 'and every direct spell hits somebody standing still', misses.join(', '));
    const nums = [];
    // the words in the book should not be selling a different spell
    const wordsOf = { twelve: 12, ten: 10, 'twenty two': 22, forty: 40, 'seventy five': 75 };
    for (const [id, field, get] of [['sacrifice', 'twelve', x => x.hp], ['blessing', 'ten', x => x.p.heal], ['regrowth', 'twenty two', x => x.p.heal], ['rift', 'forty', x => x.p.inkBurn]]) {
        const sp = spell(id);
        if (!sp.blurb.includes(field) || get(sp) !== wordsOf[field]) nums.push(id + ' says ' + field + ' and is ' + get(sp));
    }
    for (const sp of SPELLS) {
        if (!(sp.cd >= 0.5 && sp.cd <= 30)) nums.push(sp.id + ' cd');
        if (!(sp.cost >= 0 && sp.cost <= 60)) nums.push(sp.id + ' cost');
        if (sp.dmg > 60) nums.push(sp.id + ' dmg');
        if (sp.hp && sp.hp > 25) nums.push(sp.id + ' hp');
    }
    expect(!nums.length, 'the numbers are sane', nums.join(', '));
}

// ===================================================================
section('the wire');
// ===================================================================
{
    const s = fresh(3);
    const a = faceOff(s, 9);
    S.command(s, 0, { c: 'cast', s: 'fireball', q: 0.9 });
    fire(s, 0, a);
    s.wiz[1].chamber = { s: 'icewall', n: 1, power: 1 };
    fire(s, 1, aimAt(s, 1, 0));
    s.wiz[0].st.burn = { t: 2, dps: 3 };
    s.wiz[1].cd = { spark: 1.2 };
    const d = JSON.parse(JSON.stringify(S.snapshot(s, { a: 3, ai: 9 }, 1)));
    const g = S.newMatch({ seed: 9, players: [{ id: 'a' }, { id: 'b' }] });
    g.guessing = true; g.guessMe = 1;
    expect(S.applySnapshot(g, d), 'a snapshot applies');
    expect(g.phase === 'live' && Math.abs(g.wiz[0].x - s.wiz[0].x) < 0.1 && Math.abs(g.wiz[1].hp - s.wiz[1].hp) <= 0.5, 'and says where everyone is');
    expect(g.ents.length === s.ents.length, 'and everything in the air', g.ents.length + ' of ' + s.ents.length);
    expect(g.wiz[0].st.burn && g.wiz[1].cd.spark > 1, 'statuses, and your own cooldowns');
    expect(!g.wiz[0].cd.spark, 'and not other people\'s, which nobody needs');
    expect(S.applySnapshot(g, {}) === false && S.applySnapshot(g, null) === false && S.applySnapshot(g, { w: 3, e: 2 }) === false, 'and nonsense does not apply');
    // junk inside something that looks right must not throw
    let threw = null;
    try { S.applySnapshot(g, { k: 1, m: 1, ph: 9, w: [null, [1]], e: [null, 5, [1, 99, 99]], sc: [0, 0], al: [0, 0], pk: 0 }); } catch (e) { threw = e.message; }
    expect(!threw, 'not even if a bit of it is junk', threw || '');
    // a guest's guess moves things and never decides anything
    const h = fresh(4);
    const a2 = faceOff(h, 5);
    fire(h, 0, a2);
    const guess = S.newMatch({ seed: 4, players: [{ id: 'a' }, { id: 'b' }] });
    guess.guessing = true; guess.guessMe = 1;
    S.applySnapshot(guess, JSON.parse(JSON.stringify(S.snapshot(h, {}, 1))));
    const hp = guess.wiz[1].hp;
    for (let i = 0; i < 40; i++) S.step(guess);
    expect(guess.wiz[1].hp === hp && guess.score[0] === 0 && !guess.ev.length, 'a guest\'s guess moves things, and decides nothing');

    // what it costs
    const sizes = [], t0 = S.newMatch({ seed: 21, players: [{ id: 'a', bot: true }, { id: 'b', bot: true }] });
    const b0 = S.newBrain(D.BOTS[4], 'normal', 5), b1 = S.newBrain(D.BOTS[5], 'normal', 6);
    let tick = 0;
    while (t0.over === null && tick < HZ * 150) {
        S.think(t0, 0, b0); S.think(t0, 1, b1); S.step(t0);
        t0.ev.length = 0;
        if (t0.phase === 'live' && tick % 6 === 0) sizes.push(JSON.stringify(S.snapshot(t0, { a: tick, ai: tick }, 1)).length);
        tick++;
    }
    sizes.sort((x, y) => x - y);
    const med = sizes[sizes.length >> 1], p99 = sizes[Math.floor(sizes.length * 0.99)];
    expect(med <= 340, 'a snapshot is small', med + ' bytes typically');
    expect(p99 <= 700, 'even in a busy fight', p99 + ' bytes');
    // public relays charge by the event and pad it with a signature and a pubkey
    const envelope = 480;
    const mbPerMin = n => ((n * 1.37 + envelope) * A.relayHz * 60 / 1048576);
    console.log('        over one relay: about ' + mbPerMin(med).toFixed(2) + 'MB a minute, so ' + (mbPerMin(med) * 4).toFixed(2) + 'MB over four');
    expect(mbPerMin(med) * 4 <= 2, 'a match over four relays stays under what the guide says one costs', (mbPerMin(med) * 4).toFixed(2) + 'MB a minute');
}

// ===================================================================
// the bots
// ===================================================================
function mulberry(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
function play(seed, a, b, o = {}) {
    const s = S.newMatch({ seed, stats: true, players: [{ id: 'a', bot: true, loadout: o.la }, { id: 'b', bot: true, loadout: o.lb }] });
    const ba = S.newBrain(a, o.da || 'normal', seed * 3 + 1, o.la), bb = S.newBrain(b, o.db || 'normal', seed * 7 + 5, o.lb);
    let cap = HZ * (A.hardCap + 30);
    while (s.over === null && cap-- > 0) {
        S.think(s, 0, ba); S.think(s, 1, bb); S.step(s);
        s.ev.length = 0;
    }
    return s;
}
const AVERAGE = { id: 'avg', name: 'avg', skill: { react: 1.9, dodge: 0.5, quality: 0.65, aim: 4.2, turn: 3.2, sight: 0.32 }, style: { aggression: 1, defence: 1, hexes: 1, range: 16 }, lines: {} };
const STARTED = Date.now();

// ===================================================================
section('fifty spells, a thousand matches');
//
// Two average bots with random books, playing each other. A spell's number is
// how often the side carrying it won, counting only matches where the other side did
// not carry it too. Fifty per cent is a spell pulling its weight.
// ===================================================================
const MATCHES = Number(process.env.WZ_MATCHES || 1100);
const allGames = [];
{
    const ids = SPELLS.map(x => x.id);
    const rnd = mulberry(20261104);
    const shuffle = () => {
        const a = ids.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a.slice(0, D.LOADOUT_SIZE);
    };
    const tally = {};
    ids.forEach(i => { tally[i] = { games: 0, wins: 0, casts: 0, carried: 0, dmg: 0 }; });
    let totalDmg = 0;
    const sides = [0, 0];
    for (let n = 0; n < MATCHES; n++) {
        const la = shuffle(), lb = shuffle();
        const s = play(n + 1, AVERAGE, AVERAGE, { la, lb });
        allGames.push({ t: s.t, reason: s.reason, over: s.over, ko: s.score.slice() });
        if (s.over === 0 || s.over === 1) sides[s.over]++;
        for (const k of la) { if (!lb.includes(k)) { tally[k].games++; if (s.over === 0) tally[k].wins++; } tally[k].carried++; }
        for (const k of lb) { if (!la.includes(k)) { tally[k].games++; if (s.over === 1) tally[k].wins++; } tally[k].carried++; }
        for (const k in s.stats.casts) tally[k].casts += s.stats.casts[k];
        for (const k in s.stats.dmg) { if (tally[k]) { tally[k].dmg += s.stats.dmg[k]; totalDmg += s.stats.dmg[k]; } }
    }
    const rows = ids.map(k => ({
        id: k, wr: tally[k].wins / max1(tally[k].games), perMatch: tally[k].casts / max1(tally[k].carried),
        share: tally[k].dmg / max1(totalDmg), n: tally[k].games
    })).sort((a, b) => b.wr - a.wr);
    function max1(v) { return v || 1; }
    if (process.env.WZ_TABLE) {
        for (const r of rows) console.log('        ' + r.id.padEnd(16) + pct(r.wr).padStart(4) + '  ' + r.perMatch.toFixed(1).padStart(5) + ' casts a match  ' + (r.share * 100).toFixed(1).padStart(4) + '% of damage  n=' + r.n);
    }
    console.log('        best: ' + rows.slice(0, 6).map(r => r.id + ' ' + pct(r.wr)).join(', '));
    console.log('        worst: ' + rows.slice(-6).map(r => r.id + ' ' + pct(r.wr)).join(', '));
    const top = rows[0], bottom = rows[rows.length - 1];
    expect(top.wr <= 0.65, 'no spell wins everything', top.id + ' ' + pct(top.wr));
    expect(bottom.wr >= 0.35, 'and none of them loses you the match by being in your book', bottom.id + ' ' + pct(bottom.wr));
    const inside = rows.filter(r => r.wr >= 0.4 && r.wr <= 0.6).length;
    expect(inside >= 42, 'nearly all of them are close to even', inside + ' of 50 between 40% and 60%');
    const spread = rows.reduce((a, r) => a + Math.abs(r.wr - 0.5), 0) / rows.length;
    expect(spread <= 0.07, 'on average, within seven points of even', (spread * 100).toFixed(1) + ' points');
    const unused = rows.filter(r => r.perMatch < 0.3).map(r => r.id + ' ' + r.perMatch.toFixed(2));
    expect(!unused.length, 'and carrying a spell means it gets used', unused.join(', '));
    const hog = rows.slice().sort((a, b) => b.share - a.share)[0];
    expect(hog.share <= 0.1, 'no spell does most of the damage', hog.id + ' ' + (hog.share * 100).toFixed(1) + '%');
    const biggest = rows.filter(r => r.share > 0.002).length;
    expect(biggest >= 28, 'and damage comes from all over the book', biggest + ' spells do real damage');
    const left = sides[0] / (sides[0] + sides[1]);
    expect(left >= 0.46 && left <= 0.54, 'neither spawn is better', pct(left) + ' against ' + pct(1 - left));
}

// ===================================================================
section('how long a match is, and how it ends');
// ===================================================================
{
    const times = allGames.map(g => g.t).sort((a, b) => a - b);
    const at = p => times[Math.min(times.length - 1, Math.floor(times.length * p))];
    const mm = x => Math.floor(x / 60) + 'm' + String(Math.round(x % 60)).padStart(2, '0');
    expect(allGames.every(g => g.over !== null), 'every match ended');
    expect(at(0.5) >= 100 && at(0.5) <= 240, 'the typical match is a couple of minutes', 'median ' + mm(at(0.5)));
    expect(at(0.1) >= 60, 'hardly any are over in a moment', 'one in ten under ' + mm(at(0.1)));
    expect(times[times.length - 1] <= A.hardCap + 1, 'and none goes on for ever', 'longest ' + mm(times[times.length - 1]));
    const count = k => allGames.filter(g => g.reason === k).length / allGames.length;
    console.log('        ended by knockouts ' + pct(count('ko')) + ', ritual ' + pct(count('ritual')) + ', the clock ' + pct(count('time')));
    expect(count('ko') >= 0.5, 'most matches end in knockouts', pct(count('ko')));
    expect(count('ritual') >= 0.03, 'and the ritual is a real way to win', pct(count('ritual')));
    expect(count('time') <= 0.1, 'and the fog gets them moving before the clock runs out', pct(count('time')));
    const draws = allGames.filter(g => g.over < 0).length;
    expect(draws / allGames.length <= 0.01, 'and somebody wins', draws + ' draws');
    const fogged = allGames.filter(g => g.t > A.fogAt).length / allGames.length;
    expect(fogged >= 0.1, 'the fog is something you actually see', pct(fogged) + ' of matches get that far');
}

// ===================================================================
section('the roster');
// ===================================================================
{
    const bot = id => D.botById(id);
    const series = (a, b, o, n = 40, seed = 900) => {
        let wins = 0;
        for (let i = 0; i < n; i++) {
            // both ways round, since a spawn should not matter
            const flip = i % 2 === 1;
            const s = play(seed + i, flip ? b : a, flip ? a : b, flip ? { da: o.db, db: o.da } : o);
            if (s.over === (flip ? 1 : 0)) wins++;
        }
        return wins / n;
    };
    const tiers = {
        easy: D.BOTS.filter(b => b.tier === 'easy'), normal: D.BOTS.filter(b => b.tier === 'normal'), hard: D.BOTS.filter(b => b.tier === 'hard')
    };
    let ne = 0, hn = 0, he = 0, games = 0;
    for (const a of tiers.normal) for (const b of tiers.easy) { ne += series(a, b, {}, 12, 1000 + games++); }
    for (const a of tiers.hard) for (const b of tiers.normal) { hn += series(a, b, {}, 12, 1000 + games++); }
    for (const a of tiers.hard) for (const b of tiers.easy) { he += series(a, b, {}, 12, 1000 + games++); }
    const n = tiers.normal.length * tiers.easy.length;
    expect(ne / n >= 0.62, 'a normal bot beats an easy one', pct(ne / n));
    expect(hn / n >= 0.62, 'a hard bot beats a normal one', pct(hn / n));
    expect(he / n >= 0.8, 'and a hard one flattens an easy one', pct(he / n));
    const d = D.BOTS[2];
    const hardVsEasy = series(d, d, { da: 'hard', db: 'easy' }, 30, 2000);
    expect(hardVsEasy >= 0.75, 'the difficulty setting means something, on the same bot', pct(hardVsEasy));
    // a bot's own book against the field
    const each = D.BOTS.map(b => {
        let w = 0;
        for (const o of D.BOTS) { if (o !== b && o.tier === b.tier) w += series(b, o, {}, 16, 3000); }
        return [b.id, w];
    });
    console.log('        within a tier: ' + each.map(([k, w]) => k + ' ' + pct(w)).join(', '));
    const pairs = [['bogwart', 'mildred'], ['cinder', 'gary'], ['nyx', 'collector']];
    const lopsided = pairs.map(([a, b]) => [a + ' v ' + b, series(bot(a), bot(b), {}, 30, 4000)]).filter(([, w]) => w < 0.2 || w > 0.8);
    expect(!lopsided.length, 'and no pair in a tier is a walkover', lopsided.map(([k, w]) => k + ' ' + pct(w)).join(', '));

    // what it is like to stand there and take it
    const passive = id => {
        const s = S.newMatch({ seed: 12, players: [{ id: 'a' }, { id: 'b', bot: true, loadout: bot(id).style.pool }] });
        const b = S.newBrain(bot(id), 'normal', 77, bot(id).style.pool);
        let firstHit = null, firstKo = null;
        for (let i = 0; i < HZ * 200 && s.over === null; i++) {
            S.think(s, 1, b);
            S.step(s);
            s.ev.length = 0;
            if (firstHit === null && s.wiz[0].hp < A.maxHp) firstHit = s.t;
            if (firstKo === null && s.score[1] > 0) firstKo = s.t;
        }
        return { over: s.over, firstHit, firstKo, t: s.t };
    };
    const lazy = passive('cinder');
    expect(lazy.over === 1, 'a player who does nothing loses', JSON.stringify(lazy));
    expect(lazy.firstKo === null || lazy.firstKo > 12, 'but not instantly', lazy.firstKo === null ? 'it went for the ritual' : 'first knockout at ' + lazy.firstKo.toFixed(0) + 's');
}

// ===================================================================
section('same inputs, same match');
// ===================================================================
{
    const a = play(4242, D.BOTS[2], D.BOTS[3]), b = play(4242, D.BOTS[2], D.BOTS[3]);
    expect(a.over === b.over && a.tick === b.tick && a.wiz[0].x === b.wiz[0].x && a.wiz[1].hp === b.wiz[1].hp, 'seeds decide everything', a.tick + ' ticks');
    const c = play(4243, D.BOTS[2], D.BOTS[3]);
    expect(c.tick !== a.tick || c.wiz[0].x !== a.wiz[0].x, 'and a different seed is a different match');
}

// ===================================================================
section('wired into the site');
// ===================================================================
{
    const index = read('index.html');
    const scripts = ['games/wizardz/wizardz-data.js', 'games/wizardz/wizardz-sigil.js', 'games/wizardz/wizardz-sim.js', 'games/wizardz/wizardz-gl.js', 'games/wizardz/wizardz.js'];
    const sw = read('sw.js');
    const later = (sw.match(/PRECACHE_LATER = \[([\s\S]*?)\]/) || [])[1] || '';
    const first = (sw.match(/PRECACHE = \[([\s\S]*?)\]/) || [])[1] || '';
    const np = read('games/netplay.js');
    for (const f of scripts) {
        expect(fs.existsSync(path.join(ROOT, f)), f + ' exists');
        expect(!index.includes(f), 'and is not in the first load');
        expect(later.includes("'/" + f + "'") && !first.includes(f), 'and the service worker keeps it for later');
        expect(np.includes("'" + f + "'"), 'and the lobby knows it');
    }
    const ui = read('games/wizardz/wizardz.js');
    expect(/transport\.kind === 'bus'/.test(ui), 'it eases off over the relays');
    expect(/const onRelays = g =>/.test(ui) && !/const slow\s*=/.test(ui), 'and asks each time rather than once');
    expect(/net:down/.test(ui) && /net:up/.test(ui), 'it freezes when the line goes quiet, and carries on when it comes back');
    expect(!/holdTrack/.test(ui), 'and it has not started playing music at anyone');
    const css = read('css/style.css');
    const used = [...new Set([...ui.matchAll(/class="([^"$]*)"/g)].flatMap(m => m[1].split(/\s+/)))].filter(c => c.startsWith('wz-'));
    const unstyled = used.filter(c => !new RegExp('\\.' + c + '[\\s,:{.\\[>]').test(css));
    expect(!unstyled.length, 'every class it invents has a style', unstyled.join(', '));
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed') + ' in ' + Math.round((Date.now() - STARTED) / 1000) + 's of matches');
process.exit(failures ? 1 : 0);
