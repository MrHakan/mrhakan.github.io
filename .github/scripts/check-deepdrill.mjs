// check-deepdrill.mjs - deep drill 98 rules without a browser: seeded world
// generation (ore by depth, hazards, the core cavern), physics (fuel, falls,
// drilling), shops, items, hazards, the win, saves, and many seeded bot runs
// that dig to 300 m and sell.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = process.cwd();
const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'games/deep-drill/deep-drill-sim.js'), 'utf8'), ctx);
const DD = ctx.DEEP_DRILL;
const { W, H, SURF, T, HALF, CAVE_TOP, CAVE_FLOOR } = DD;

let passed = 0, failed = 0;
function ok(cond, what, detail) {
    if (cond) { passed++; console.log('  ok  ' + what); }
    else { failed++; console.log('  FAIL  ' + what + (detail !== undefined ? '\n        ' + JSON.stringify(detail) : '')); }
}
const section = n => console.log('\n== ' + n + ' ==');
const tile = (s, x, y) => DD.tileAt(s.world, x, y);
const run = (s, seconds, input) => { for (let i = 0; i < Math.round(seconds / DD.DT) && !s.over; i++) DD.step(s, input || null); };
const hold = (s, input, until, max = 30) => { for (let i = 0; i < max * 60 && !s.over && !until(s); i++) DD.step(s, input); return until(s); };
const NONE = { left: false, right: false, up: false, down: false };
const DOWN = { ...NONE, down: true }, UP = { ...NONE, up: true }, RIGHT = { ...NONE, right: true }, LEFT = { ...NONE, left: true };
// stand the pod on top of the floor below row y, column x
function place(s, x, y) { const p = s.pod; p.x = x + 0.5; p.y = y + 1 - HALF; p.vx = 0; p.vy = 0; p.grounded = false; p.drill = null; DD.step(s, NONE); }
function dig(s, x, y0, y1) { for (let y = y0; y <= y1; y++) DD.setTile(s.world, x, y, T.EMPTY); }

// =================================================================
section('world generation');
const a = DD.genWorld(98), b = DD.genWorld(98), c = DD.genWorld(99);
ok(a.tiles.length === W * H && Buffer.from(a.tiles).equals(Buffer.from(b.tiles)), 'the same seed digs the same planet');
ok(!Buffer.from(a.tiles).equals(Buffer.from(c.tiles)), 'another seed digs another planet');
const bandM = 150, bands = Math.ceil(1500 / bandM);
const oreCount = Array.from({ length: bands }, () => new Array(DD.ORES.length).fill(0));
const rocks = new Array(bands).fill(0), cells = new Array(bands).fill(0);
let gasTooShallow = 0, lavaTooShallow = 0, oreTooShallow = 0, edgesOk = true, padsOk = true, coreTiles = 0, caveOpen = true, firstRowsRock = 0;
const SEEDS = 24;
for (let seed = 1; seed <= SEEDS; seed++) {
    const w = DD.genWorld(seed * 7919);
    for (let y = SURF; y < H; y++) for (let x = 0; x < W; x++) {
        const t = w.tiles[y * W + x], d = DD.depthOfRow(y);
        if ((x === 0 || x === W - 1 || y >= CAVE_FLOOR) && t !== T.BEDROCK) edgesOk = false;
        if (y === SURF && DD.BUILDINGS.some(bb => x >= bb.x0 && x <= bb.x1) && t !== T.PAD) padsOk = false;
        if (t === T.CORE) coreTiles++;
        if (y < SURF + 3 && t === T.ROCK) firstRowsRock++;
        if (t === T.GAS && d < 200) gasTooShallow++;
        if (t === T.LAVA && d < 450) lavaTooShallow++;
        if (DD.isOre(t) && d < DD.ORES[t - DD.ORE0].min) oreTooShallow++;
        if (y >= CAVE_FLOOR - 1 || y < SURF + 1 || x === 0 || x === W - 1) continue;
        const bi = Math.min(bands - 1, Math.floor(d / bandM));
        if (y < CAVE_TOP) { cells[bi]++; if (t === T.ROCK) rocks[bi]++; if (DD.isOre(t)) oreCount[bi][t - DD.ORE0]++; }
    }
    for (let y = CAVE_TOP; y < CAVE_FLOOR - 3; y++) for (let x = 13; x <= 17; x++) if (w.tiles[y * W + x] !== T.EMPTY) caveOpen = false;
}
ok(edgesOk, 'bedrock walls the sides and the floor');
ok(padsOk, 'every building stands on a concrete pad');
ok(firstRowsRock === 0, 'no boulders in the first three rows');
ok(gasTooShallow === 0 && lavaTooShallow === 0, 'gas starts below 200 m and lava below 450 m', { gasTooShallow, lavaTooShallow });
ok(oreTooShallow === 0, 'no ore shows up above its first depth');
ok(coreTiles === 9 * SEEDS, 'each planet has a 3x3 core');
ok(caveOpen, 'the core cavern above the core is open');
const avgValue = oreCount.map(row => { const n = row.reduce((x, y) => x + y, 0); return n ? row.reduce((sum, k, i) => sum + k * DD.ORES[i].price, 0) / n : 0; });
ok(avgValue.every((v, i) => i === 0 || v > avgValue[i - 1]), 'average ore value rises with every 150 m band', avgValue.map(Math.round));
const top = oreCount[0], topN = top.reduce((x, y) => x + y, 0);
ok(top[0] / topN > 0.45, 'rustite is the common ore near the surface', Math.round(top[0] / topN * 100) + '%');
ok(oreCount.slice(0, 6).every(r => r[7] === 0 && r[8] === 0), 'no diamond or quasarite above 900 m');
ok(oreCount[bands - 1][7] + oreCount[bands - 1][8] > oreCount[bands - 1][0], 'the deepest band is richer in diamond and quasarite than rustite');
ok(rocks[bands - 1] / cells[bands - 1] > rocks[0] / cells[0] * 2, 'boulders get much more common with depth',
    [rocks[0] / cells[0], rocks[bands - 1] / cells[bands - 1]].map(v => v.toFixed(3)));
const ore0 = oreCount.map(r => r.reduce((x, y) => x + y, 0) / 1);
ok(ore0.every(n => n > 0), 'every band has ore to find');

// =================================================================
section('physics');
{
    const s = DD.newGame(5);
    ok(s.hull === 10 && s.fuel === 10 && s.cash === 0, 'a new pod starts with 10 hull, 10 L and no cash');
    run(s, 5);
    ok(s.pod.grounded && s.fuel === 10, 'parked on the surface the pod burns nothing');
    const f0 = s.fuel; run(s, 1, RIGHT);
    ok(s.fuel === f0 && s.pod.x > DD.SPAWN_X + 1, 'driving on the surface is free too');
    // underground idle and thrust
    const u = DD.newGame(5); dig(u, 11, SURF, SURF + 30); place(u, 11, SURF + 30); u.pod.y = SURF + 31 - HALF;
    DD.setTile(u.world, 11, SURF + 31, T.DIRT);
    place(u, 11, SURF + 30);
    const fi = u.fuel; run(u, 1);
    ok(Math.abs(fi - u.fuel - 0.04) < 0.005, 'idling underground burns 0.04 L a second', fi - u.fuel);
    const ft = u.fuel, y0 = u.pod.y; run(u, 1, UP);
    ok(Math.abs(ft - u.fuel - 0.28) < 0.01 && u.pod.y < y0 - 2, 'thrust burns 0.28 L a second and lifts the pod', [ft - u.fuel, y0 - u.pod.y]);
    ok(u.pod.vy >= -4 - 1e-9, 'the stock engine climbs at most 4 tiles a second');
    // falls
    const fall = (h, hullUp) => {
        const s2 = DD.newGame(5); if (hullUp) { s2.up.hull = 5; s2.hull = DD.stat(s2, 'hull'); }
        dig(s2, 11, SURF, SURF + 60); DD.setTile(s2.world, 11, SURF + 61, T.BEDROCK);
        s2.pod.x = 11.5; s2.pod.y = SURF + 61 - HALF - h; s2.pod.vy = 0; s2.pod.grounded = false;
        hold(s2, NONE, x => x.pod.grounded, 10);
        return s2;
    };
    ok(fall(2).hull === 10, 'a two-tile drop does not hurt');
    const big = fall(30, true);
    ok(Math.abs((110 - big.hull) - (16 - 10) * 1.6) < 0.01, 'a long fall hits at terminal speed: 9.6 damage', 110 - big.hull);
    const mid = fall(5, true);
    ok(mid.hull < 110 && mid.hull > big.hull, 'a medium fall hurts less than a long one', [mid.hull, big.hull]);
    const thrustFall = DD.newGame(5); thrustFall.up.hull = 5; thrustFall.hull = 110;
    dig(thrustFall, 11, SURF, SURF + 60); DD.setTile(thrustFall.world, 11, SURF + 61, T.BEDROCK);
    thrustFall.pod.y = SURF + 30; thrustFall.pod.grounded = false;
    for (let i = 0; i < 60 * 10 && !thrustFall.pod.grounded; i++) DD.step(thrustFall, { ...NONE, up: thrustFall.pod.vy > 3 });
    ok(thrustFall.hull === 110, 'braking with the thruster lands softly');
    const dead = fall(30); dead.hull = 5;
    const dead2 = DD.newGame(5); dig(dead2, 11, SURF, SURF + 60); DD.setTile(dead2.world, 11, SURF + 61, T.BEDROCK);
    dead2.hull = 3; dead2.pod.y = SURF + 20; dead2.pod.grounded = false; run(dead2, 5);
    ok(dead2.over && !dead2.won && /fall/.test(dead2.reason), 'a fall can wreck the pod', dead2.reason);
    // fuel runs out underground
    const dry = DD.newGame(5); dig(dry, 11, SURF, SURF + 10); place(dry, 11, SURF + 10); dry.fuel = 0.05; run(dry, 3);
    ok(dry.over && /fuel/.test(dry.reason), 'an empty tank underground ends the run', dry.reason);
    const dryTop = DD.newGame(5); dryTop.fuel = 0; run(dryTop, 3, RIGHT);
    ok(!dryTop.over, 'an empty tank on the surface is not the end');
}

// =================================================================
section('drilling');
{
    const s = DD.newGame(11);
    for (let y = SURF; y < SURF + 3; y++) DD.setTile(s.world, 11, y, T.DIRT);
    DD.setTile(s.world, 11, SURF + 1, DD.ORE0);
    const t0 = s.time;
    ok(hold(s, DOWN, x => tile(x, 11, SURF) === T.EMPTY && !x.pod.drill, 5), 'holding down drills the tile below');
    ok(Math.abs(s.time - t0 - DD.hardness(T.DIRT, SURF)) < 0.05, 'a dirt tile takes its hardness in seconds with the stock bit', s.time - t0);
    hold(s, DOWN, x => tile(x, 11, SURF + 1) === T.EMPTY && !x.pod.drill, 5);
    ok(s.cargoCount === 1 && s.cargo[0] === 1, 'drilling ore puts it in the cargo bay');
    ok(DD.depthM(s) === 10, 'two tiles down reads 10 m', DD.depthM(s));
    const fast = DD.newGame(11); fast.up.drill = 5; DD.setTile(fast.world, 11, SURF, T.DIRT);
    const tf = fast.time; hold(fast, DOWN, x => tile(x, 11, SURF) === T.EMPTY && !x.pod.drill, 5);
    ok((fast.time - tf) < (s.time - t0) / 3, 'a maxed drill bit is over three times faster');
    // sideways
    DD.setTile(s.world, 12, SURF + 1, DD.ORE0 + 1);
    hold(s, RIGHT, x => tile(x, 12, SURF + 1) === T.EMPTY && !x.pod.drill, 5);
    ok(s.cargo[1] === 1 && Math.floor(s.pod.x) === 12, 'pushing sideways into ore drills it while grounded');
    // can't drill up
    dig(s, 12, SURF + 2, SURF + 2); DD.setTile(s.world, 12, SURF + 3, T.DIRT);
    place(s, 12, SURF + 2);
    DD.setTile(s.world, 12, SURF + 1, T.DIRT);
    run(s, 2, UP);
    ok(tile(s, 12, SURF + 1) === T.DIRT, 'thrusting into a ceiling never drills up');
    // boulders
    const r = DD.newGame(12); dig(r, 11, SURF, SURF + 4); DD.setTile(r.world, 11, SURF + 6, T.ROCK); DD.setTile(r.world, 11, SURF + 5, T.DIRT);
    place(r, 11, SURF + 4); DD.setTile(r.world, 11, SURF + 5, T.ROCK); r.events.length = 0;
    run(r, 2, DOWN);
    ok(tile(r, 11, SURF + 5) === T.ROCK && r.events.some(e => e.type === 'blocked'), 'boulders stop the drill and say so');
    // cargo cap
    const full = DD.newGame(13); full.cargoCount = 7; full.cargo[0] = 7; DD.setTile(full.world, 11, SURF, DD.ORE0 + 3);
    hold(full, DOWN, x => tile(x, 11, SURF) === T.EMPTY && !x.pod.drill, 5);
    ok(full.cargoCount === 7 && full.events.some(e => e.type === 'full'), 'a full cargo bay loses new ore');
    // treasure pays at once
    const tr = DD.newGame(14); DD.setTile(tr.world, 11, SURF, T.TREASURE);
    hold(tr, DOWN, x => tile(x, 11, SURF) === T.EMPTY && !x.pod.drill, 5);
    ok(tr.cash >= 1000 && tr.earned === tr.cash, 'a lost floppy pays cash straight away', tr.cash);
}

// =================================================================
section('hazards');
{
    const g = DD.newGame(21); dig(g, 11, SURF, SURF + 59); place(g, 11, SURF + 59); DD.setTile(g.world, 11, SURF + 60, T.GAS);
    const h0 = g.hull; hold(g, DOWN, x => tile(x, 11, SURF + 60) === T.EMPTY && !x.pod.drill, 5);
    ok(Math.abs(h0 - g.hull - (3 + 300 / 80)) < 0.01, 'a gas pocket at 300 m costs 6.75 hull', h0 - g.hull);
    const lava = (rad) => {
        const l = DD.newGame(22); l.up.hull = 5; l.hull = 110; l.up.rad = rad; dig(l, 11, SURF, SURF + 99); place(l, 11, SURF + 99); DD.setTile(l.world, 11, SURF + 100, T.LAVA);
        hold(l, DOWN, x => tile(x, 11, SURF + 100) === T.EMPTY && !x.pod.drill, 5); return 110 - l.hull;
    };
    ok(lava(0) > lava(4) * 2, 'the radiator softens lava', [lava(0), lava(4)]);
    const heat = rad => { const s = DD.newGame(23); s.up.hull = 5; s.hull = 110; s.up.rad = rad; s.up.tank = 5; s.fuel = 80; dig(s, 11, SURF, SURF + 200); place(s, 11, SURF + 199); run(s, 10); return 110 - s.hull; };
    ok(heat(0) > 5 && heat(2) < heat(0) && heat(3) === 0, 'deep heat at 1000 m hurts until the radiator is good enough', [heat(0), heat(2), heat(3)]);
}

// =================================================================
section('shops and items');
{
    const s = DD.newGame(31);
    ok(!DD.sell(s).ok, 'you cannot sell away from the ore buyer');
    s.cargo[0] = 3; s.cargo[2] = 1; s.cargoCount = 4;
    place(s, 7, SURF - 1);
    ok(DD.building(s) && DD.building(s).id === 'sell', 'parking on the pad puts you at the ore buyer');
    const r = DD.sell(s);
    ok(r.ok && r.value === 3 * 25 + 120 && s.cash === 195 && s.cargoCount === 0 && s.trips === 1, 'selling pays the listed prices', r);
    ok(!DD.buyFuel(s).ok, 'no fuel unless you are at the station');
    place(s, 2, SURF - 1); s.fuel = 4;
    const f = DD.buyFuel(s);
    ok(f.ok && s.fuel === 10 && f.cost === 12 && s.cash === 183, 'filling 6 L costs $12', f);
    ok(!DD.buyFuel(s).ok, 'a full tank takes no more');
    s.cash = 5; s.fuel = 1; DD.buyFuel(s);
    ok(s.cash >= 0 && s.cash < 2 && s.fuel > 1 && s.fuel < 4, 'short of cash, you get what you can pay for', [s.cash, s.fuel]);
    s.cash = 500; place(s, 22, SURF - 1); s.hull = 4;
    const rp = DD.repair(s);
    ok(rp.ok && s.hull === 10 && s.cash === 500 - 72, 'repairing 6 hull costs $72', rp);
    place(s, 15, SURF - 1); s.cash = 399;
    ok(!DD.upgrade(s, 'tank').ok && s.up.tank === 0, 'an upgrade needs the full price');
    s.cash = 400; s.fuel = 5;
    ok(DD.upgrade(s, 'tank').ok && s.up.tank === 1 && s.cash === 0 && s.fuel === 11, 'tank mk 2 costs $400 and adds the extra litres');
    s.up.drill = 5; s.cash = 1e6;
    ok(!DD.upgrade(s, 'drill').ok, 'a maxed part cannot go further');
    ok(!DD.buyItem(s, 'dynamite').ok, 'items are sold at the item shop only');
    place(s, 27, SURF - 1);
    for (let i = 0; i < 12; i++) DD.buyItem(s, 'dynamite');
    ok(s.items.dynamite === DD.ITEM_MAX, 'you can carry nine of an item');
    for (const id of ['c4', 'teleport', 'repairkit', 'reserve']) DD.buyItem(s, id);
    ok(!DD.useItem(s, 'dynamite').ok, 'no blasting next to the buildings');
    // dynamite clears boulders
    dig(s, 11, SURF, SURF + 20); for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1]]) DD.setTile(s.world, 11 + dx, SURF + 20 + dy, T.ROCK);
    place(s, 11, SURF + 20);
    ok(DD.useItem(s, 'dynamite').ok && tile(s, 10, SURF + 20) === T.EMPTY && tile(s, 12, SURF + 21) === T.EMPTY, 'dynamite blasts the 3x3 around the pod, rock too');
    dig(s, 11, SURF + 21, SURF + 40); place(s, 11, SURF + 40);
    for (let x = 9; x <= 13; x++) for (let y = SURF + 39; y <= SURF + 43; y++) if (!(x === 11 && y <= SURF + 40)) DD.setTile(s.world, x, y, T.ROCK);
    DD.useItem(s, 'c4');
    ok(tile(s, 9, SURF + 41) === T.EMPTY && tile(s, 13, SURF + 40) === T.EMPTY && tile(s, 11, SURF + 42) === T.EMPTY && tile(s, 9, SURF + 42) === T.ROCK && tile(s, 11, SURF + 43) === T.ROCK, 'plastic explosive clears a rounded 5x5');
    s.up.hull = 5; s.up.tank = 5; s.hull = 1; DD.useItem(s, 'repairkit');
    ok(s.hull === 26, 'a repair kit adds 25 hull');
    s.fuel = 1; DD.useItem(s, 'reserve');
    ok(s.fuel === 21, 'reserve fuel adds 20 L');
    DD.useItem(s, 'teleport');
    ok(s.pod.x === DD.SPAWN_X && s.pod.y === DD.SPAWN_Y && DD.depthM(s) === 0, 'the teleporter puts you back on the surface');
    ok(!DD.useItem(s, 'teleport').ok, 'an item you do not have does nothing');
}

// =================================================================
section('the core');
{
    const s = DD.newGame(41);
    s.up.hull = 5; s.hull = 110; s.up.rad = 5; s.up.drill = 5; s.up.tank = 5; s.fuel = 80;
    ok(s.coreLeft === 9, 'nine core shards to crack');
    let flares = 0;
    for (let y = CAVE_FLOOR - 3; y < CAVE_FLOOR; y++) for (let x = 14; x <= 16; x++) {
        place(s, x, y - 1);
        hold(s, DOWN, q => tile(q, x, y) === T.EMPTY && !q.pod.drill, 20);
        flares += s.events.filter(e => e.type === 'flare').length; s.events.length = 0;
    }
    ok(s.over && s.won && s.coreLeft === 0, 'cracking all nine shards wins the run', s.reason);
    ok(DD.depthM(s) === 1500 && s.maxDepth === 1500, 'the core floor sits at 1500 m', DD.depthM(s));
    ok(flares > 0, 'the core flares while you work on it');
    ok(s.earned >= 25000, 'the win pays the $25000 bonus');
    ok(!DD.step(s, DOWN), 'a finished run does not step');
}

// =================================================================
section('saves');
{
    const s = DD.newGame(51), mem = {};
    for (let i = 0; i < 60 * 90; i++) DD.step(s, DD.bot(s, mem));
    const text = DD.serialize(s), back = DD.deserialize(text);
    ok(back && DD.serialize(back) === text, 'a save loads back to the same run');
    ok(back && Buffer.from(back.world.tiles).equals(Buffer.from(s.world.tiles)), 'the dug tunnels survive a save');
    ok(DD.deserialize('{') === null && DD.deserialize('null') === null && DD.deserialize(JSON.stringify({ ...JSON.parse(text), cash: -5 })) === null, 'corrupt saves are refused');
    ok(DD.deserialize(JSON.stringify({ ...JSON.parse(text), tiles: JSON.parse(text).tiles.slice(1) })) === null, 'a truncated world is refused');
    ok(DD.deserialize(JSON.stringify({ ...JSON.parse(text), up: { ...s.up, drill: 9 } })) === null, 'impossible upgrade levels are refused');
}

// =================================================================
section('seeded bot runs');
{
    const N = 40, fails = [];
    let totalTime = 0;
    for (let i = 0; i < N; i++) {
        const seed = (i * 2654435761) >>> 0, s = DD.newGame(seed), mem = {};
        let reached = -1, soldAfter = false, steps = 0;
        while (!s.over && steps < 60 * 60 * 20) {
            DD.step(s, DD.bot(s, mem)); steps++;
            if (reached < 0 && s.maxDepth >= 300) reached = steps;
            for (const e of s.events) if (e.type === 'sold' && reached >= 0) soldAfter = true;
            s.events.length = 0;
            if (soldAfter) break;
            if (![s.pod.x, s.pod.y, s.fuel, s.hull, s.cash].every(Number.isFinite)) { fails.push([seed, 'nan']); break; }
        }
        totalTime += s.time;
        if (!soldAfter) fails.push([seed, s.over ? s.reason : 'timeout', s.maxDepth]);
    }
    ok(fails.length === 0, N + ' seeded bots each dig to 300 m and sell the load', fails);
    console.log('        average ' + (totalTime / N / 60).toFixed(1) + ' game minutes per run');
    const r1 = DD.newGame(777), r2 = DD.newGame(777), m1 = {}, m2 = {};
    for (let i = 0; i < 60 * 120; i++) { DD.step(r1, DD.bot(r1, m1)); DD.step(r2, DD.bot(r2, m2)); }
    ok(DD.serialize(r1) === DD.serialize(r2), 'the same seed and the same inputs replay exactly');
    // every run terminates with a valid result: run bots aggressively until over or long cap
    let ended = 0, valid = true;
    for (let i = 0; i < 12; i++) {
        const s = DD.newGame(1000 + i), mem = { target: 1600 };
        for (let k = 0; k < 60 * 60 * 30 && !s.over; k++) { DD.step(s, DD.bot(s, mem)); s.events.length = 0; }
        if (s.over) { ended++; if (!(s.reason && (s.won || s.hull <= 0 || s.fuel <= 0))) valid = false; }
        if (!(s.maxDepth >= 0 && s.maxDepth <= 1500 && s.cash >= 0)) valid = false;
    }
    ok(valid, 'deep bot runs stay valid and any ending has a reason (' + ended + '/12 ended)');
}

console.log('\n' + passed + ' deepdrill checks passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed ? 1 : 0);
