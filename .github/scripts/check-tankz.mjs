// ===================================================================
// check-tankz.mjs — tankz 98's rules, room and wire, under node
//
//   the maze     every cell reaches every other, the walls are where the grid
//                says, and the same seed is the same maze
//   the tank     drives, turns, and never ends up inside a wall
//   the shells   come off walls like light off a mirror, run out of time,
//                five at most, and get the tank that fired them too
//   the files    each of the six does its thing
//   a round      the last one standing gets the point, first to the match's
//                points wins it, a draw is a draw
//   the bots     hard beats easy, nobody shoots themselves often, matches end
//   the room     ready, countdown, match, back again; a guest can only speak
//                for itself; what arrives on the wire is checked
//   the wire     a snapshot puts the same match on a guest's screen
//
//   node .github/scripts/check-tankz.mjs            (--report for the bot numbers)
// ===================================================================
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['tankz-data.js', 'tankz-sim.js', 'tankz-room.js']) require(path.join(ROOT, 'games/tankz', f));
const TK = globalThis.TK, S = globalThis.TK_SIM, ROOM = globalThis.TK_ROOM;
const REPORT = process.argv.includes('--report');

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
const DT = 1 / TK.TICK, C = TK.CELL;
const seats = (n, bot) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'p' + i, bot: bot ? bot[i] || '' : '' }));
// a match with the round already on, and nothing on the floor
function fightMatch(n, seed, o) {
    const s = S.newMatch(Object.assign({ seed: seed || 5, seats: seats(n), points: 5 }, o || {}));
    while (s.phase !== 'fight') S.step(s);
    s.dropT = 1e9; s.events.length = 0;
    return s;
}
// a maze of one open room, so a test knows exactly where every wall is
function openMaze(s, cols, rows) {
    const h = [], v = [];
    for (let y = 0; y <= rows; y++) h.push(new Array(cols).fill(y === 0 || y === rows));
    for (let y = 0; y < rows; y++) v.push(Array.from({ length: cols + 1 }, (_, x) => x === 0 || x === cols));
    const m = S.makeMaze(1, 2, 'medium');
    // rebuild through the maze's own builder with these walls
    const built = rebuild(cols, rows, h, v);
    s.maze = built;
    return built;
}
function rebuild(cols, rows, h, v) {
    // the sim only exposes makeMaze; a maze is plain data, so this builds the same shape
    const HW = TK.WALL / 2, m = { seed: 1, cols, rows, h, v, W: cols * C, H: rows * C, rects: [], nb: [] };
    for (let y = 0; y <= rows; y++) { let x = 0; while (x < cols) { if (!h[y][x]) { x++; continue; } const x0 = x; while (x < cols && h[y][x]) x++; m.rects.push({ x0: x0 * C - HW, x1: x * C + HW, y0: y * C - HW, y1: y * C + HW }); } }
    for (let x = 0; x <= cols; x++) { let y = 0; while (y < rows) { if (!v[y][x]) { y++; continue; } const y0 = y; while (y < rows && v[y][x]) y++; m.rects.push({ x0: x * C - HW, x1: x * C + HW, y0: y0 * C - HW, y1: y * C + HW }); } }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const out = [];
        if (x > 0 && !v[y][x]) out.push(y * cols + x - 1);
        if (x < cols - 1 && !v[y][x + 1]) out.push(y * cols + x + 1);
        if (y > 0 && !h[y][x]) out.push((y - 1) * cols + x);
        if (y < rows - 1 && !h[y + 1][x]) out.push((y + 1) * cols + x);
        m.nb.push(out);
    }
    return m;
}
const round1 = v => Math.round(v);
const put = (s, i, x, y, a) => Object.assign(s.tanks[i], { x, y, a, alive: true });

// ===================================================================
section('the maze');
// ===================================================================
{
    let unreachable = 0, borders = 0, sizes = new Set(), same = true, loops = 0;
    for (let seed = 1; seed <= 300; seed++) {
        const n = 2 + (seed % 7);
        const m = S.makeMaze(seed * 7919, n, TK.SIZES[seed % 3].id);
        sizes.add(m.cols + 'x' + m.rows);
        const d = S.bfs(m, 0);
        if (d.some(v => v < 0)) unreachable++;
        if (!m.h[0].every(Boolean) || !m.h[m.rows].every(Boolean) || !m.v.every(r => r[0] && r[m.cols])) borders++;
        const edges = m.nb.reduce((a, b) => a + b.length, 0) / 2;
        if (edges > m.cols * m.rows - 1) loops++;
        const again = S.makeMaze(seed * 7919, n, TK.SIZES[seed % 3].id);
        if (JSON.stringify(again.h) !== JSON.stringify(m.h) || JSON.stringify(again.v) !== JSON.stringify(m.v)) same = false;
    }
    expect(unreachable === 0, 'in 300 mazes every cell reaches every other', unreachable + ' with a cut-off cell');
    expect(borders === 0, 'and the border is closed all the way round');
    expect(loops > 280, 'nearly every maze has loops in it, not one single path', loops + ' of 300');
    expect(same, 'the same seed is the same maze, which is how a guest gets the host\'s');
    expect(sizes.size >= 8, 'and they come in many sizes', [...sizes].slice(0, 8).join(' '));
    const two = S.makeMaze(9, 2, 'medium'), eight = S.makeMaze(9, 8, 'medium');
    expect(eight.cols * eight.rows > two.cols * two.rows, 'eight tanks get more maze than two', two.cols + 'x' + two.rows + ' vs ' + eight.cols + 'x' + eight.rows);
}

// ===================================================================
section('the tank');
// ===================================================================
{
    const s = fightMatch(2);
    openMaze(s, 4, 3);
    put(s, 0, 96, 96, 0);
    for (let k = 0; k < 30; k++) S.moveTank(s.maze, s.tanks[0], 1, DT);
    expect(Math.abs(s.tanks[0].x - (96 + TK.SPEED * 0.5)) < 0.5 && Math.abs(s.tanks[0].y - 96) < 0.01, 'half a second forward is half a second of speed', s.tanks[0].x.toFixed(1));
    for (let k = 0; k < 30; k++) S.moveTank(s.maze, s.tanks[0], 8, DT);
    expect(Math.abs(s.tanks[0].a - TK.TURN * 0.5) < 0.01, 'turning right turns clockwise on the screen', s.tanks[0].a.toFixed(2));
    // into the border, for three seconds: it stops at the wall
    put(s, 0, 96, 96, Math.PI);
    for (let k = 0; k < 180; k++) S.moveTank(s.maze, s.tanks[0], 1, DT);
    expect(Math.abs(s.tanks[0].x - (TK.WALL / 2 + TK.TANK_R)) < 0.5, 'driven into a wall it stops against it', s.tanks[0].x.toFixed(1));
    // in random mazes, driving about at random never puts a tank inside a wall
    let inside = 0;
    for (let seed = 1; seed <= 40; seed++) {
        const z = fightMatch(4, seed);
        const r = { rs: seed };
        for (let k = 0; k < 600; k++) {
            for (const t of z.tanks) S.moveTank(z.maze, t, [1, 5, 9, 2, 6][(k / 40 + t.i) % 5 | 0], DT);
            for (const t of z.tanks) for (const q of z.maze.rects) {
                const cx = Math.max(q.x0, Math.min(q.x1, t.x)), cy = Math.max(q.y0, Math.min(q.y1, t.y));
                if (Math.hypot(t.x - cx, t.y - cy) < TK.TANK_R - 0.75) inside++;
            }
        }
    }
    expect(inside === 0, 'driving about in 40 mazes, a tank is never inside a wall', inside + ' times');
}

// ===================================================================
section('the shells');
// ===================================================================
{
    // a shell straight at the right border comes straight back
    const s = fightMatch(2);
    openMaze(s, 6, 3);
    const b = { k: 's', x: C * 5, y: 96, vx: 190, vy: 0, r: 3 };
    let hit = false;
    for (let k = 0; k < 40; k++) if (S.moveShell(s.maze, b, DT)) hit = true;
    expect(hit && b.vx === -190 && b.vy === 0, 'straight at a wall, straight back');
    const c = { k: 's', x: C * 3, y: 96, vx: 100, vy: -100, r: 3 };
    for (let k = 0; k < 60; k++) S.moveShell(s.maze, c, DT);
    expect(c.vy === 100 && c.vx === 100, 'at an angle, the angle comes off the other way: in equals out');
    let escaped = 0;
    for (let seed = 1; seed <= 30; seed++) {
        const z = fightMatch(2, seed);
        for (let k = 0; k < 16; k++) {
            const a = k / 16 * Math.PI * 2;
            const q = { k: 's', x: z.tanks[0].x, y: z.tanks[0].y, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190, r: 3 };
            for (let t = 0; t < 600; t++) S.moveShell(z.maze, q, DT);
            if (q.x < 0 || q.y < 0 || q.x > z.maze.W || q.y > z.maze.H) escaped++;
        }
    }
    expect(escaped === 0, '480 shells bouncing for ten seconds each: none gets out of the maze', escaped + ' out');

    // five at most
    const f = fightMatch(2);
    openMaze(f, 8, 4);
    put(f, 0, 96, 96, 0); put(f, 1, C * 7.5, C * 3.5, 0);
    for (let k = 0; k < 8; k++) { f.tanks[0].in.fp++; for (let j = 0; j < 7; j++) S.step(f); }
    expect(f.shells.filter(b => b.o === 0).length === TK.SHELLS, 'eight presses, five shells: the limit', f.shells.length + ' shells');
    // and they run out of time
    for (const b of f.shells) b.age = TK.SHELL_LIFE - 0.01;
    S.step(f); S.step(f);
    expect(f.shells.filter(b => b.o === 0).length === 0, 'after their time they are gone');

    // your own shell gets you: fire at a wall in front of you
    const o = fightMatch(2);
    openMaze(o, 6, 3);
    put(o, 0, C * 5.5, 96, 0); put(o, 1, C * 0.5, C * 2.5, 0);
    o.tanks[0].in.fp = 1;
    for (let k = 0; k < 120 && o.tanks[0].alive; k++) S.step(o);
    const die = o.events.find(e => e.e === 'die');
    expect(!o.tanks[0].alive && die && die.by === 0 && o.selfs[0] === 1, 'a shell fired at a wall comes back and gets the tank that fired it', die ? die.how + ' by ' + die.by : 'still alive');
    // and the other's shell gets the other
    const p = fightMatch(2);
    openMaze(p, 6, 3);
    put(p, 0, 96, 96, 0); put(p, 1, C * 4.5, 96, Math.PI / 2);
    p.tanks[0].in.fp = 1;
    for (let k = 0; k < 120 && p.tanks[1].alive; k++) S.step(p);
    expect(!p.tanks[1].alive && p.kills[0] === 1 && p.tanks[0].alive, 'a shot along a corridor gets the tank at the end of it');
}

// ===================================================================
section('the files');
// ===================================================================
{
    const setup = w => {
        const s = fightMatch(2, 11);
        openMaze(s, 8, 4);
        put(s, 0, 96, 96, 0); put(s, 1, C * 6.5, 96, Math.PI / 2);
        s.tanks[0].w = w;
        return s;
    };
    const press = s => { s.tanks[0].in.fp++; S.step(s); };
    const run = (s, n, until) => { for (let k = 0; k < n && !(until && until()); k++) S.step(s); };

    // picking one up
    const pk = setup('');
    pk.picks.push({ id: 99, x: 96 + 30, y: 96, w: 0 });
    run(pk, 60, () => pk.tanks[0].w);
    pk.tanks[0].in.mv = 1; run(pk, 30, () => pk.tanks[0].w);
    expect(pk.tanks[0].w === 'beam' && !pk.picks.length, 'driving over a file picks it up');

    const beam = setup('beam');
    press(beam);
    expect(!beam.tanks[1].alive && beam.beams.length === 1 && beam.tanks[0].w === '', 'beam.exe: the first tank along the line is gone, and the file is used');
    // round a corner: the beam comes off the wall
    const bc = setup('beam');
    put(bc, 1, C * 7.5, C * 3.5, 0);
    bc.tanks[0].a = Math.atan2(C * 3.5 - 96, C * 7.5 - 96) + 0.0;
    const plan = S.cast(bc, bc.tanks[0].x, bc.tanks[0].y, bc.tanks[0].a, TK.WEAPON_BY_ID.beam.range, TK.WEAPON_BY_ID.beam.bounces, 0, 0);
    expect(plan.hit === 1, 'its line, cast first, says where it goes');

    const frag = setup('frag');
    put(frag, 1, C * 4.5, C * 2.5, 0);
    press(frag);
    run(frag, 30);
    expect(frag.shells.some(b => b.k === 'f') && frag.tanks[0].w === 'frag', 'shrapnel.zip: a fat shell goes out');
    press(frag);
    const bits = frag.shells.filter(b => b.k === 'b').length;
    expect(bits >= TK.WEAPON_BY_ID.frag.bits - 2 && !frag.shells.some(b => b.k === 'f') && frag.tanks[0].w === '', 'fire again and it bursts into shrapnel', bits + ' bits');
    run(frag, 40);
    expect(!frag.shells.some(b => b.k === 'b'), 'which is gone in a moment');

    const seek = setup('seeker');
    put(seek, 1, C * 6.5, C * 3.5, 0);
    seek.tanks[0].a = Math.PI / 2;      // aimed down, away from the other
    press(seek);
    run(seek, 600, () => !seek.tanks[1].alive || !seek.tanks[0].alive);
    const sd = seek.events.find(e => e.e === 'die');
    expect(sd && sd.how === 'seeker', 'seeker.dll: fired the wrong way, it still finds a tank', sd ? 'got ' + sd.i : 'nobody');
    // it goes for the nearest: here that is the one who fired it
    const sf = setup('seeker');
    put(sf, 1, C * 7.5, C * 3.5, 0);
    sf.tanks[0].a = 0;
    sf.tanks[0].in.mv = 0;
    press(sf);
    run(sf, round1(TK.WEAPON_BY_ID.seeker.wait * TK.TICK) + 8);
    const m0 = sf.shells.find(b => b.k === 'm');
    expect(m0 && m0.tgt === 0, 'it goes for the nearest tank, and that can be the one who fired it', m0 ? 'after ' + TK.WEAPON_BY_ID.seeker.wait + 's it wants tank ' + m0.tgt : 'no seeker');

    const mine = setup('mine');
    put(mine, 1, C * 7.5, C * 3.5, 0);
    press(mine);
    expect(mine.mines.length === 1 && mine.tanks[0].w === '', 'landmine.sys: left behind the tank');
    const q = mine.mines[0];
    put(mine, 1, q.x + 40, q.y, Math.PI);
    put(mine, 0, C * 6.5, C * 3.5, 0);
    run(mine, 30);
    expect(mine.tanks[1].alive, 'nobody near it, nothing happens');
    run(mine, round1(TK.WEAPON_BY_ID.mine.arm * TK.TICK));
    mine.tanks[1].in.mv = 1;
    run(mine, 60, () => !mine.tanks[1].alive);
    expect(!mine.tanks[1].alive && mine.events.some(e => e.e === 'die' && e.how === 'mine'), 'and the tank that drives over it once it is armed is gone');

    const burst = setup('burst');
    put(burst, 1, C * 7.5, C * 3.5, 0);
    press(burst);
    run(burst, 90);
    expect(burst.events.filter(e => e.e === 'shot').length >= 1 && burst.tanks[0].burst === 0, 'burst.bat: one press, a stream of shells', TK.WEAPON_BY_ID.burst.count + ' of them');

    const sc = setup('scatter');
    put(sc, 1, C * 7.5, C * 3.5, 0);
    press(sc);
    expect(sc.shells.filter(b => b.k === 'b').length === TK.WEAPON_BY_ID.scatter.count, 'scatter.ini: a cone of pellets at once');
    // the floor fills up with files over a round, but only so far
    const fl = fightMatch(4, 3);
    fl.dropT = 1;
    for (const t of fl.tanks) t.in.mv = 0;
    for (let k = 0; k < 60 * 40; k++) S.step(fl);
    expect(fl.picks.length === TK.DROP_MAX, 'files drop on the floor over a round, up to ' + TK.DROP_MAX, fl.picks.length + ' on the floor');
}

// ===================================================================
section('a round, and a match');
// ===================================================================
{
    const s = fightMatch(3, 21, { points: 3 });
    S.kill(s, 1, 0, 'shell'); S.kill(s, 2, 0, 'shell');
    for (let k = 0; k < TK.AFTER * TK.TICK + 2; k++) S.step(s);
    expect(s.scores.join() === '1,0,0' && s.phase === 'end', 'the last one standing gets the point, after a moment', s.scores.join());
    while (s.phase !== 'ready') S.step(s);
    expect(s.round === 2 && s.tanks.every(t => t.alive) && s.shells.length === 0, 'then a new round: everybody back, in a new maze');
    // a draw: the last two go together
    while (s.phase !== 'fight') S.step(s);
    S.kill(s, 0, 1, 'shell'); S.kill(s, 1, 2, 'shell'); S.kill(s, 2, 2, 'shell');
    for (let k = 0; k < TK.AFTER * TK.TICK + 2; k++) S.step(s);
    expect(s.scores.join() === '1,0,0' && s.lastWinner === -1, 'nobody left: nobody gets a point');
    // the last one can still lose it before the point is given
    while (s.phase !== 'fight') S.step(s);
    S.kill(s, 1, 0, 'shell'); S.kill(s, 2, 0, 'shell');
    S.step(s);
    S.kill(s, 0, 0, 'shell');
    for (let k = 0; k < TK.AFTER * TK.TICK + 2; k++) S.step(s);
    expect(s.scores.join() === '1,0,0', 'and the last one standing who then gets themselves gets nothing');
    // first to three
    for (let r = 0; r < 2; r++) {
        while (s.phase !== 'fight') S.step(s);
        S.kill(s, 1, 0, 'shell'); S.kill(s, 2, 0, 'shell');
        for (let k = 0; k < TK.AFTER * TK.TICK + 2; k++) S.step(s);
    }
    expect(s.phase === 'over' && s.winner === 0 && s.events.some(e => e.e === 'over'), 'first to three takes the match', s.scores.join());
}

// ===================================================================
section('the bots');
// ===================================================================
{
    function match(levels, seed, points) {
        const s = S.newMatch({ seed, seats: levels.map((l, i) => ({ id: 'b' + i, name: l + i, bot: l })), points: points || 5 });
        const bots = levels.map((l, i) => S.newBot(l, seed * 31 + i));
        const hows = {};
        let picks = 0, used = 0;
        while (s.phase !== 'over' && s.tick < 60 * 60 * 20) {
            for (let i = 0; i < s.n; i++) S.think(s, i, bots[i]);
            S.step(s);
            for (const e of s.events) { if (e.e === 'die') hows[e.how] = (hows[e.how] || 0) + 1; if (e.e === 'pick') picks++; if (e.e === 'beam' || (e.e === 'shot' && e.w) || e.e === 'mine') used++; }
            s.events.length = 0;
        }
        return { s, hows, picks, used };
    }
    const t0 = Date.now();
    let hard = 0, easy = 0, selfs = 0, kills = 0, unfinished = 0, picks = 0, used = 0, ticks = 0, rounds = 0;
    const hows = {};
    for (let seed = 1; seed <= 16; seed++) {
        const r = match(seed % 2 ? ['hard', 'easy'] : ['easy', 'hard'], seed);
        if (r.s.phase !== 'over') unfinished++;
        else if (r.s.seats[r.s.winner].bot === 'hard') hard++; else easy++;
        selfs += r.s.selfs.reduce((a, b) => a + b, 0); kills += r.s.kills.reduce((a, b) => a + b, 0);
        picks += r.picks; used += r.used; ticks += r.s.tick; rounds += r.s.round;
        for (const k in r.hows) hows[k] = (hows[k] || 0) + r.hows[k];
    }
    expect(unfinished === 0, '16 matches of bots all come to an end');
    expect(hard >= 12, 'a hard bot beats an easy one', hard + ' to ' + easy);
    expect(selfs <= kills * 0.35, 'bots get each other far more often than themselves', kills + ' hits, ' + selfs + ' own goals');
    expect(picks > 0 && used > 0, 'and they pick up files and use them', picks + ' picked up, ' + used + ' used');
    const per = ticks / 60 / rounds;
    expect(per > 4 && per < 60, 'a round between bots lasts seconds, not minutes', per.toFixed(1) + 's a round');
    const mixed = match(['normal', 'normal', 'easy', 'hard', 'normal', 'easy'], 99, 3);
    expect(mixed.s.phase === 'over', 'six bots in a big maze finish a match too');
    const ms = Date.now() - t0;
    expect(ms < 20000, 'and all of that takes seconds', ms + 'ms');
    if (REPORT) console.log('        ' + JSON.stringify({ hard, easy, selfs, kills, picks, used, perRound: per.toFixed(1), hows }));
    // the same seed, the same match
    const a = match(['normal', 'hard', 'easy'], 7, 3).s, b = match(['normal', 'hard', 'easy'], 7, 3).s;
    expect(a.tick === b.tick && a.scores.join() === b.scores.join(), 'the same seed and the same bots play the same match', a.tick + ' ticks');
}

// ===================================================================
section('the room');
// ===================================================================
{
    const r = ROOM.create({ host: 'H', bots: '1', level: 'easy', points: '3', size: 'small' });
    ROOM.join(r, 'H', 'host'); ROOM.join(r, 'G', 'guest');
    expect(r.seats.length === 2 && r.phase === 'select' && ROOM.botsFor(r) === 1, 'two people and a bot, nobody ready');
    expect(!ROOM.setOpt(r, 'G', 'bots', 3) && ROOM.setOpt(r, 'H', 'bots', 3) && r.opts.bots === 3, 'the host changes the settings, a guest can\'t');
    expect(ROOM.intent(r, 'G', { n: 1, r: true }) && r.seats[1].ready && r.phase === 'select', 'a guest says ready');
    expect(!ROOM.intent(r, 'G', { n: 1, r: false }) && r.seats[1].ready, 'an old wish arriving again changes nothing');
    expect(!ROOM.intent(r, 'X', { n: 5, r: true }), 'and nobody can speak for a seat that is not theirs');
    ROOM.intent(r, 'H', { n: 1, r: true });
    expect(r.phase === 'countdown' && !ROOM.setOpt(r, 'H', 'bots', 1), 'everybody ready: the countdown, and the settings are locked');
    ROOM.intent(r, 'G', { n: 2, r: false });
    expect(r.phase === 'select', 'somebody changes their mind: no countdown');
    ROOM.intent(r, 'G', { n: 3, r: true });
    expect(!ROOM.tick(r, 2000) && ROOM.tick(r, 1001), 'three seconds later the match starts');
    const m = ROOM.begin(r, 1234, 5678);
    expect(m && m.people.length === 2 && m.bots === 3 && m.match === '5678:1234' && r.phase === 'match', 'into a match: two people, three bots');
    const back = ROOM.readStart(JSON.parse(JSON.stringify(m)));
    expect(back && back.people.length === 2 && back.opts.points === 3, 'and a guest reads it back the same');
    expect(ROOM.readStart(Object.assign({}, m, { match: 'x' })) === null && ROOM.readStart(Object.assign({}, m, { bots: 9 })) === null, 'but not one that does not add up');
    ROOM.join(r, 'L', 'late');
    expect(r.seats.find(s => s.id === 'L').playing === false, 'somebody arriving during a match waits for the next one');
    expect(!ROOM.intent(r, 'L', { n: 1, r: true }) || !r.seats.find(s => s.id === 'L').ready, 'and can\'t ready up while it is on');
    ROOM.leave(r, 'G');
    const done = ROOM.finish(r, { match: m.match, winner: 'H', rows: [{ id: 'H', name: 'host', pts: 3, kills: 4, deaths: 1, selfs: 0, col: 0 }, { id: 'bot2', name: 'clippy', pts: 1, bot: true, col: 2 }] });
    expect(done && r.phase === 'select' && r.played === 1 && r.seats.find(s => s.id === 'H').wins === 1 && r.seats.every(s => !s.ready), 'the match ends: back in the room, the win counted, nobody ready');
    const w = ROOM.read(JSON.parse(JSON.stringify(ROOM.view(r))));
    expect(w && w.seats.length === 2 && w.last.rows.length === 2 && w.last.winner === 'H', 'a guest\'s copy of the room, table and all');
    const bad = ROOM.view(r); bad.seats[0][3] = -4;
    expect(ROOM.read(bad) === null && ROOM.read({ v: 2 }) === null, 'and a copy that makes no sense is thrown away');
    const solo = ROOM.create({ host: 'A', bots: 0 });
    ROOM.join(solo, 'A', 'alone');
    expect(ROOM.botsFor(solo) === 1, 'one person and no bots asked for still gets somebody to shoot at');
}

// ===================================================================
section('the wire');
// ===================================================================
{
    const host = S.newMatch({ seed: 77, seats: seats(4, ['', '', 'hard', 'normal']), points: 5 });
    const guest = S.newMatch({ seed: 77, seats: seats(4, ['', '', 'hard', 'normal']), points: 5, puppet: true });
    const bots = [null, null, S.newBot('hard', 1), S.newBot('normal', 2)];
    let worst = 0, bytes = 0, n = 0, same = true;
    for (let k = 0; k < 60 * 20; k++) {
        for (let i = 2; i < 4; i++) S.think(host, i, bots[i]);
        if (k % 30 === 0) { host.tanks[0].in.fp++; host.tanks[1].in.mv = (k / 30) % 2 ? 9 : 1; }
        S.step(host);
        if (k % 3 === 0) {
            const d = JSON.parse(JSON.stringify(S.snapshot(host)));
            bytes += JSON.stringify(d).length; n++;
            S.applySnapshot(guest, d);
            if (guest.maze.seed !== host.maze.seed || guest.round !== host.round) same = false;
            for (let i = 0; i < 4; i++) worst = Math.max(worst, Math.hypot(guest.tanks[i].x - host.tanks[i].x, guest.tanks[i].y - host.tanks[i].y));
        }
    }
    expect(same && worst < 0.1, 'a guest fed snapshots has the host\'s maze and tanks', worst.toFixed(3) + ' units at worst');
    expect(bytes / n < 3000, 'a snapshot is small', Math.round(bytes / n) + ' bytes on average');
    expect(guest.events.some(e => e.e === 'die') || guest.events.some(e => e.e === 'shot'), 'and its events come along: who shot, who is gone');
    // shells carried on between snapshots end up where the host's are
    const h = fightMatch(2, 41);
    const g = S.newMatch({ seed: 41, seats: seats(2), points: 5, puppet: true });
    h.tanks[0].in.fp = 1; h.tanks[1].in.fp = 1;
    for (let k = 0; k < 20; k++) S.step(h);
    S.applySnapshot(g, JSON.parse(JSON.stringify(S.snapshot(h))));
    for (let k = 0; k < 12; k++) { S.step(h); S.coast(g, DT); }
    let off = 0;
    for (const b of h.shells) { const c = g.shells.find(x => x.id === b.id); if (c) off = Math.max(off, Math.hypot(c.x - b.x, c.y - b.y)); }
    expect(h.shells.length && off < 1, 'a guest flies the shells on by itself between snapshots and lands where the host does', off.toFixed(3) + ' units');
    // a guest's word on where its tank is, kept to what a tank could do
    const p = fightMatch(2, 3);
    openMaze(p, 6, 3);
    put(p, 1, 96, 96, 0);
    S.pose(p, 1, 96 + 400, 96, 0, 0.05);
    expect(p.tanks[1].x < 96 + 30, 'a guest claiming to be far away in a twentieth of a second is not believed', (p.tanks[1].x - 96).toFixed(1) + ' units moved');
    S.pose(p, 1, -50, 96, 0, 0.6);
    expect(p.tanks[1].x >= TK.WALL / 2 + TK.TANK_R - 0.01, 'nor one through a wall');
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
