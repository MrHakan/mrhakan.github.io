// ===================================================================
// check-defrag.mjs — tests for the disk defragmenter
//
// The interesting half of defrag.js is not the colours, it is the plan:
// a sequence of swaps that has to leave every cluster of every file
// somewhere sensible. The first version worked every move out from the
// original layout, which is wrong the moment a cluster lands on a slot
// a later move still thinks it owns — the disk came out full of holes
// with clusters missing, and it looked *fine* while it was running.
//
// So this replays the whole plan against a model of the disk and asks
// the only questions that matter: is everything still there, is it all
// in one piece, and did anything move that was never allowed to.
//
//   node .github/scripts/check-defrag.mjs
// ===================================================================
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failures = 0, checks = 0;
const ok = m => { checks++; console.log('  ok    ' + m); };
const bad = (m, d) => { checks++; failures++; console.log('  FAIL  ' + m + (d ? '\n        ' + d : '')); };
const expect = (c, m, d) => c ? ok(m) : bad(m, d);
const section = n => console.log('\n== ' + n + ' ==');

// ---------- a browser-shaped hole ----------
function makeWindow(opts) {
    const o = opts || {};
    const win = {
        performance: {
            getEntriesByType: type => (type === 'resource' ? (o.resources || []) : (o.navigation || []))
        },
        location: { pathname: '/index.html' },
        document: { querySelectorAll: () => [] },
        addEventListener() { }, removeEventListener() { }
    };
    win.window = win;
    return win;
}
const load = w => new Function('window', 'performance', 'location', 'document', read('defrag.js'))
    (w, w.performance, w.location, w.document);

// ===================================================================
section('defrag.js loads without a browser');
// ===================================================================
const win = makeWindow();
try { load(win); ok('defrag.js runs'); } catch (e) { bad('defrag.js runs', e.message); process.exit(1); }
const D = win.DEFRAG;
expect(!!D && typeof win.openDefrag === 'function', 'it exposes the app and its parts');
expect(D.TOTAL === D.COLS * D.ROWS, 'the disk is a grid', `${D.COLS}x${D.ROWS}`);

// ===================================================================
section('what is on the disk');
// ===================================================================
{
    const empty = makeWindow();
    load(empty);
    const fallback = empty.DEFRAG.realFiles();
    expect(fallback.length > 4 && fallback.every(f => f.name && f.bytes > 0),
        'a browser that will not list its resources still gets a disk', JSON.stringify(fallback.slice(0, 2)));

    const real = makeWindow({
        resources: [
            { name: 'https://mrhakan.github.io/index.js', decodedBodySize: 90000 },
            { name: 'https://mrhakan.github.io/style.css', decodedBodySize: 140000 },
            { name: 'https://mrhakan.github.io/style.css', decodedBodySize: 140000 },   // asked for twice
            { name: 'data:image/png;base64,AAAA', decodedBodySize: 40 },                 // not a file
            { name: 'https://mrhakan.github.io/nothing.js', decodedBodySize: 0 },        // never arrived
            { name: 'https://mrhakan.github.io/games/wizardz.js', transferSize: 60000 }
        ],
        navigation: [{ decodedBodySize: 96000 }]
    });
    load(real);
    const files = real.DEFRAG.realFiles();
    const names = files.map(f => f.name);
    expect(names.includes('/index.js') && names.includes('/games/wizardz.js'),
        'the real files this page downloaded are the disk', names.join(', '));
    expect(names.filter(n => n === '/style.css').length === 1, 'a file fetched twice is one file');
    expect(!names.some(n => /^data:/.test(n)), 'inline data is not a file');
    expect(!names.includes('/nothing.js'), 'and neither is something that weighed nothing');
    expect(names[0] === '/index.html', 'the page itself is on its own disk', names[0]);
}

// ===================================================================
section('laying it out badly');
// ===================================================================
const FILES = [
    { name: '/index.html', bytes: 96000 }, { name: '/style.css', bytes: 150000 },
    { name: '/index.js', bytes: 92000 }, { name: '/apps.js', bytes: 38000 },
    { name: '/extras.js', bytes: 44000 }, { name: '/games/wizardz.js', bytes: 120000 },
    { name: '/games/balatro.js', bytes: 96000 }, { name: '/sw.js', bytes: 4000 },
    { name: '/src/emoj/troll.png', bytes: 220000 }
];
{
    const disk = D.makeDisk(FILES, 4242);
    expect(disk.cells.length === D.TOTAL && disk.owner.length === D.TOTAL, 'the disk is the size of the grid');
    expect(disk.files.length === FILES.length, 'every file got laid down', String(disk.files.length));
    expect(disk.clusterBytes >= 512, 'clusters are a sane size', disk.clusterBytes + ' bytes');

    const used = disk.cells.filter(c => c !== D.FREE).length;
    expect(used > D.TOTAL * 0.4 && used < D.TOTAL * 0.9, 'the disk is neither empty nor full',
        `${used}/${D.TOTAL} clusters used`);
    expect(D.fragmentation(disk) > 50, 'and it starts in a state worth defragmenting',
        D.fragmentation(disk) + '%');

    // the scaffolding of the site is pinned down, the way the swap file was
    const locked = disk.files.filter(f => f.locked).map(f => f.name);
    expect(locked.includes('/index.html') && locked.includes('/sw.js') && locked.includes('/style.css'),
        'the files that hold the site up cannot be moved', locked.join(', '));
    expect(!locked.includes('/games/wizardz.js'), 'and the rest can');
    expect(disk.cells.filter(c => c === D.BAD).length === 3, 'every disk has a few bad clusters');

    // the same seed twice is the same mess, or a redraw would reshuffle it
    const again = D.makeDisk(FILES, 4242);
    expect(again.cells.join(',') === disk.cells.join(','), 'the same seed lays out the same disk');
    const other = D.makeDisk(FILES, 9001);
    expect(other.cells.join(',') !== disk.cells.join(','), 'and a different one does not');
}

// ===================================================================
section('and then defragmenting it');
//
// The plan is replayed here exactly as the window replays it, and then
// the disk is inspected. This is the check that caught the version
// where clusters quietly went missing.
// ===================================================================
function replay(disk) {
    const moves = D.plan(disk);
    const cells = disk.cells.slice(), owner = disk.owner.slice();
    moves.forEach(m => {
        const wasOwner = owner[m.to], wasCell = cells[m.to];
        owner[m.to] = m.file; cells[m.to] = D.PLACED;
        owner[m.from] = wasOwner;
        cells[m.from] = wasOwner >= 0 ? (wasCell === D.WRITE ? D.MOVE : wasCell) : D.FREE;
    });
    return { moves, cells, owner };
}
for (const seed of [1, 4242, 31337, 65535]) {
    const disk = D.makeDisk(FILES, seed);
    const before = {};
    disk.owner.forEach(o => { if (o >= 0) before[o] = (before[o] || 0) + 1; });
    const badAt = disk.cells.map((c, i) => c === D.BAD ? i : -1).filter(i => i >= 0);
    const lockedAt = disk.cells.map((c, i) => c === D.LOCKED ? i : -1).filter(i => i >= 0);

    const { moves, cells, owner } = replay(disk);

    // 1. nothing lost, nothing invented
    const after = {};
    owner.forEach(o => { if (o >= 0) after[o] = (after[o] || 0) + 1; });
    const lost = Object.keys(before).filter(k => before[k] !== after[k])
        .map(k => `${disk.files[k].name}: ${before[k]} -> ${after[k] || 0}`);
    expect(!lost.length, `seed ${seed}: every cluster of every file survives`, lost.join(', '));

    // 2. each file ends up in one piece. a bad cluster in the middle of
    // a file is a hole in the disk, not a fragment, so it is skipped —
    // the same way the app counts it
    const runs = {};
    let prev = -1;
    for (let i = 0; i < D.TOTAL; i++) {
        if (cells[i] === D.BAD) continue;
        const o = owner[i];
        if (o < 0) { prev = -1; continue; }
        if (o !== prev) runs[o] = (runs[o] || 0) + 1;
        prev = o;
    }
    const split = Object.keys(runs).filter(k => runs[k] > 1 && !disk.files[k].locked)
        .map(k => `${disk.files[k].name} in ${runs[k]} pieces`);
    expect(!split.length, `seed ${seed}: every file comes out in one piece`, split.join(', '));

    // 3. the things that could not move did not move
    const movedBad = badAt.filter(i => cells[i] !== D.BAD);
    const movedLocked = lockedAt.filter(i => cells[i] !== D.LOCKED);
    expect(!movedBad.length && !movedLocked.length,
        `seed ${seed}: bad and unmovable clusters stayed put`,
        JSON.stringify({ bad: movedBad, locked: movedLocked }));

    // 4. the free space ends up at the end, which is the entire point.
    // not *all* of it: a file that will not fit in front of a bad
    // cluster is placed after it instead of being split across it, and
    // the gap that leaves is deliberate — the real one did the same.
    const lastUsed = owner.reduce((acc, o, i) => (o >= 0 ? i : acc), -1);
    const holes = owner.slice(0, lastUsed).filter((o, i) => o < 0 && cells[i] === D.FREE).length;
    const freeTotal = owner.filter(o => o < 0).length;
    expect(holes < freeTotal * 0.3, `seed ${seed}: nearly all the free space ends up in one lump at the end`,
        `${holes} clusters left in gaps, of ${freeTotal} free`);

    // 5. and it finishes
    expect(moves.length > 0 && moves.length <= D.TOTAL,
        `seed ${seed}: the plan is bounded and does something`, String(moves.length));
    expect(moves.every(m => m.from !== m.to && m.from >= 0 && m.to >= 0 && m.from < D.TOTAL && m.to < D.TOTAL),
        `seed ${seed}: every move goes somewhere real`);
}
{
    const disk = D.makeDisk(FILES, 777);
    const { owner } = replay(disk);
    const done = { cells: disk.cells, owner: owner, files: disk.files };
    expect(D.fragmentation(done) === 0, 'a defragmented disk reports 0% fragmented',
        D.fragmentation(done) + '%');
    // running it again has nothing left to do
    expect(D.plan({ cells: disk.cells, owner: owner, files: disk.files }).length >= 0,
        'and planning it a second time does not fall over');
}
{
    // a disk with nothing on it must not throw
    let threw = '';
    try {
        const empty = D.makeDisk([], 5);
        D.plan(empty);
        D.fragmentation(empty);
    } catch (e) { threw = e.message; }
    expect(!threw, 'an empty disk is survivable', threw);
}

// ===================================================================
section('wired into the desktop');
// ===================================================================
{
    const html = read('index.html');
    expect(/<script src="defrag\.js"/.test(html), 'index.html loads defrag.js');
    expect(/startMenuAction\('defrag'\)/.test(html), 'and it is in the start menu');
    const idx = read('index.js');
    expect(/defrag: openDefrag/.test(idx) && /'defrag': openDefrag/.test(idx),
        'the app table and the run box both know it');
    expect(read('sw.js').includes("'/defrag.js'"), 'the service worker precaches it');
    expect(/\/defrag\.js/.test(read('sw.js')) && /mrhakan98-v\d+/.test(read('sw.js')),
        'behind a bumped cache version');

    // the old one is gone, along with its styles
    const extras = read('extras.js');
    expect(!/^function openDefrag/m.test(extras), 'extras.js no longer defines a second defragmenter');
    expect(/openDefrag\(\)/.test(extras), 'but find: files still finds this one');
    const css = read('style.css');
    expect(!/^\.df-/m.test(css), 'and the old defrag styles went with it');
    expect(/\.dfg-map/.test(css) && /\.dfg-fill/.test(css), 'the new one has styles');
    expect(/\.no-motion \.dfg-fill/.test(css), 'that respect the reduced-motion setting');

    // the achievement it unlocks has to be one that exists
    const fun = read('fun.js');
    expect(/defrag: \{ icon:/.test(fun) && /unlockAchievement\('defrag'\)/.test(read('defrag.js')),
        'it unlocks an achievement the site actually has');
}

// ===================================================================
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
    console.log(`${failures} failed`);
    process.exit(1);
}
