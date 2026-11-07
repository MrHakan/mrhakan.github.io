// ===================================================================
// check-trophies.mjs — the trophy room and the installable site
//
// The trophy room only reads what games left behind, so the ways it can
// go wrong are: an achievement that is on no shelf or on the wrong one,
// a game handing out an achievement that does not exist, and a save it
// does not expect taking the window down. All three are checked against
// js/trophies.js running in a sandbox with a fake localStorage.
//
// The second half holds site.webmanifest to what Chrome asks of a site
// before it offers to install it, and to the files actually being there.
// ===================================================================
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));

let checks = 0, failures = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg);
    else { failures++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

const fun = read('js/fun.js');
const ACHIEVEMENTS = (0, eval)('(' + /const ACHIEVEMENTS = (\{[\s\S]*?\n\});/.exec(fun)[1] + ')');
const getUnlockedSrc = /function getUnlocked\(\) \{[\s\S]*?\n\}/.exec(fun)[0];

// a localStorage that is a Map, with the same refusals a real one has
function fakeStorage(init) {
    const m = new Map(Object.entries(init || {}));
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: k => { m.delete(k); },
        key: i => [...m.keys()][i] ?? null,
        get length() { return m.size; },
        _map: m
    };
}

const catalogue = JSON.parse(read('data/playground.json'));

// js/trophies.js with nothing but what it needs from the desktop
function room(init) {
    const localStorage = fakeStorage(init);
    const won = [];
    const sandbox = {
        localStorage, console, Date, Math, JSON, Object, Array, String, Number, Promise, isFinite, parseFloat, URL,
        ACHIEVEMENTS,
        fetch: async () => ({ ok: true, json: async () => catalogue }),
        document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() { }, removeEventListener() { } },
        navigator: {}
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(getUnlockedSrc + '\nthis.getUnlocked = getUnlocked;', sandbox);
    sandbox.unlockAchievement = id => {
        if (!ACHIEVEMENTS[id]) throw new Error('no such achievement ' + id);
        const un = sandbox.getUnlocked();
        if (un[id]) return;
        un[id] = Date.now();
        localStorage.setItem('achievements', JSON.stringify(un));
        won.push(id);
    };
    vm.runInContext(read('js/trophies.js'), sandbox, { filename: 'js/trophies.js' });
    return { T: sandbox.TROPHIES, localStorage, won, sandbox };
}

// ===================================================================
section('every achievement is real and has a place');
// ===================================================================
const ids = Object.keys(ACHIEVEMENTS);
expect(ids.length > 90, 'fun.js has the achievements (' + ids.length + ')');
const badShape = ids.filter(id => {
    const a = ACHIEVEMENTS[id];
    return !a.icon || !a.name || !a.desc || (a.hint !== undefined && (typeof a.hint !== 'string' || !a.hint));
});
expect(!badShape.length, 'each has an icon, a name and something to say', badShape.join(', '));
const newOnes = ['dungeonz', 'dungeonz_win', 'playground', 'playground_5', 'playground_15', 'trophy_room', 'installed'];
expect(newOnes.every(id => ACHIEVEMENTS[id]), 'and the ones this room brought with it exist');
expect(newOnes.every(id => ACHIEVEMENTS[id].name === ACHIEVEMENTS[id].name.toLowerCase() && ACHIEVEMENTS[id].desc === ACHIEVEMENTS[id].desc.toLowerCase()),
    'in the house style, lower case');

// everything that hands one out, anywhere on the disk
{
    const files = [];
    const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach(e => {
        const p = d + '/' + e.name;
        if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p); }
        else if (/\.(js|html)$/.test(e.name)) files.push(p);
    });
    walk('js'); walk('games');
    const asked = new Map();
    for (const f of files) {
        for (const m of read(f).matchAll(/(?:unlockAchievement|achieve)\('([\w-]+)'\)/g)) asked.set(m[1], f);
    }
    const phantom = [...asked.keys()].filter(id => !ACHIEVEMENTS[id] && !/^troll_wave_$/.test(id));
    expect(asked.size > 80, 'found the places that hand them out (' + asked.size + ')');
    expect(!phantom.length, 'and every one they hand out exists', phantom.map(id => id + ' (' + asked.get(id) + ')').join(', '));
    expect(/unlockAchievement\('dungeonz_win'\)/.test(read('games/dungeonz/dungeonz.js')), 'dungeonz hands out its own now, one line each');
}

{
    const { T } = room();
    const shelfIds = T.SHELVES.map(s => s.id);
    expect(shelfIds[shelfIds.length - 1] === 'desktop', 'the last shelf takes whatever no game claims');
    const expected = {
        jokerz_win: 'jokerz', 'aot-hard': 'ageoftroll', 'echoes-end': 'echoes', troll_wave_25: 'trollproblem',
        become_user_all: 'becomeuser', dungeonz_win: 'dungeonz', wizardz_win: 'wizardz', snake10: 'arcade',
        g2048: 'arcade', playground_15: 'playground', nat20: 'toys', konami: 'desktop', installed: 'desktop'
    };
    const wrong = Object.entries(expected).filter(([id, s]) => T.shelfOf(id).id !== s).map(([id, s]) => id + ' on ' + T.shelfOf(id).id + ', not ' + s);
    expect(!wrong.length, 'a game\'s achievements are on its shelf', wrong.join(', '));
    const strays = ids.filter(id => T.shelfOf(id).id === 'desktop' && /jokerz|troll|echoes|aot|become|wizardz|dungeonz|playground/.test(id));
    expect(!strays.length, 'and none of them fell through to the desktop', strays.join(', '));

    const actions = read('js/index.js');
    const table = actions.slice(actions.indexOf('function appActions()'), actions.indexOf('function startMenuAction'));
    const dead = T.SHELVES.filter(s => s.open && !new RegExp("^\\s+'?" + s.open + "'?:", 'm').test(table)).map(s => s.open);
    expect(!dead.length, 'every shelf\'s open button is on the action table', dead.join(', '));
    expect(/^\s+trophies: openTrophies,/m.test(table), 'and so is the room itself, which makes it ?app=trophies');
}

// ===================================================================
section('nothing on the disk takes the room down');
// ===================================================================
{
    const empty = room();
    let s;
    try { s = empty.T.summary(); } catch (e) { s = e; }
    expect(s && s.total === ids.length && s.got === 0 && s.percent === 0 && s.time === 0, 'an empty browser is an empty room', String(s && s.message || ''));
    expect(s.shelves.every(x => !x.records.length), 'with no records on any shelf');
    expect(/0 of \d+ \(0%\)/.test(empty.T.shareText(s)) && /\?app=trophies/.test(empty.T.shareText(s)), 'and still something to share');

    // every key a shelf reads, and the achievements, set to each kind of junk
    const keys = ['achievements', 'mrhakan98-playtime', 'mrhakan98-dungeonz-meta', 'ECHOES_OF_THE_TIDE_SAVE', 'jokerz98-run',
        'trollproblem-meta-v2', 'becomeuser-meta-v1', 'mrhakan98-ageoftroll-meta', 'mrhakan98-wizardz-avatar',
        'snake-best', 'arcade-simon', 'lights-out-98-best', 'crate-shift-98-v1'];
    const junk = ['{', 'null', '[]', '42', '"text"', 'undefined', '{"player":5,"wins":"many","best":[1,2]}', '{"endings":"all","bestWave":null,"stats":7}', 'NaN', ''];
    const broke = [];
    for (const j of junk) {
        const r = room(Object.fromEntries(keys.map(k => [k, j])));
        try {
            const x = r.T.summary();
            r.T.playgroundRecords(r.T.SHELVES && catalogue.filter(i => i.type === 'game').map(i => ({ slug: i.url.split('/')[2], name: i.name, url: i.url })));
            r.T.shareText(x);
            if (!(x.got >= 0 && x.got <= x.total) || !isFinite(x.time)) broke.push(j + ' gave nonsense');
            const shown = x.shelves.flatMap(y => y.records).filter(p => p[1] === undefined || p[1] === null || Number.isNaN(p[1]) || p[1] === 'NaN' || p[1] === '$undefined');
            if (shown.length) broke.push(j + ' shows ' + JSON.stringify(shown));
        } catch (e) { broke.push(JSON.stringify(j) + ': ' + e.message); }
    }
    expect(!broke.length, 'a broken save in every slot reads as nothing, ' + junk.length + ' kinds of broken', broke.join(' | '));

    // the room never rewrites a save it reads
    const before = Object.fromEntries(keys.map(k => [k, '{"keep":"me"}']));
    const r = room(before);
    r.T.summary();
    const touched = keys.filter(k => k !== 'achievements' && r.localStorage.getItem(k) !== before[k]);
    expect(!touched.length, 'and none of them is written over', touched.join(', '));

    // an achievements list from an older version is still read
    const legacy = room({ achievements: '["konami","snake10"]' });
    const ls = legacy.T.summary();
    expect(ls.got === 2, 'an old achievements list as an array still counts', 'got ' + ls.got);
}

// ===================================================================
section('records come out of what the games saved');
// ===================================================================
{
    const r = room({
        achievements: JSON.stringify({ konami: 1700000000000, dungeonz: 1700000005000, snake10: 1 }),
        'mrhakan98-dungeonz-meta': JSON.stringify({ runs: 7, wins: { bin: 2, crypt: 1 }, best: { bin: 125.4, crypt: 300 }, wipes: 3, kills: 99 }),
        'trollproblem-meta-v2': JSON.stringify({ bestWave: { a: 12, b: 7 }, runs: 4, totalKills: 300 }),
        'mrhakan98-ageoftroll-meta': JSON.stringify({ wins: 3, losses: 1, draws: 0 }),
        'becomeuser-meta-v1': JSON.stringify({ endings: ['a', 'b'], runs: 5 }),
        'snake-best': '23',
        'mrhakan98-playtime': JSON.stringify({ 'dungeonz 98': 3720, 'snake': 60, 'tetris': 30, 'notepad': 600, 'broken': 'x' })
    });
    const s = r.T.summary();
    const shelf = id => s.shelves.find(x => x.shelf.id === id);
    const rec = (id, label) => (shelf(id).records.find(p => p[0] === label) || [])[1];
    expect(rec('dungeonz', 'fastest clear') === '2:05' && rec('dungeonz', 'dungeons cleared') === 3 && rec('dungeonz', 'runs') === 7,
        'dungeonz: runs, clears and the fastest one', JSON.stringify(shelf('dungeonz').records));
    expect(rec('trollproblem', 'best wave') === 12, 'troll problem: the best wave over every map');
    expect(rec('ageoftroll', 'won') === 3 && rec('ageoftroll', 'drawn') === undefined, 'age of troll: wins, and no zero rows');
    expect(rec('becomeuser', 'endings found') === 2, 'become user: endings found');
    expect(rec('arcade', 'snake') === 23, 'the arcade: snake');
    expect(shelf('dungeonz').time === 3720 && shelf('arcade').time === 90, 'time played adds up per shelf, by window title',
        shelf('dungeonz').time + ', ' + shelf('arcade').time);
    expect(s.time === 4410, 'and the total counts every window, but not a broken entry', String(s.time));
    expect(r.T.duration(3720) === '1h 2m' && r.T.duration(59) === '59s' && r.T.duration(0) === '0m', 'time reads like time');
    expect(s.latest[0] === 'dungeonz', 'the latest trophy comes first');
    expect(shelf('dungeonz').got === 1 && shelf('dungeonz').ids.length === 2, 'and each shelf counts its own');
}

// ===================================================================
section('the playground keeps its records under its own names');
// ===================================================================
{
    const games = catalogue.filter(i => i.type === 'game');
    const list = games.map(i => ({ slug: i.url.split('/')[2], name: i.name.replace(/\s*98$/, '').toLowerCase(), url: i.url, icon: i.icon }));
    const r = room({
        'lights-out-98-best': '9',
        'dots-boxes-98-record': '{"w":2,"l":1}',
        'playground.word-ladder98.v1.0': '{"rungs":4}',
        'playground.word-ladder98.v1.1': '{"rungs":6}',
        'mrhakan.river-ferry.v1': '{"daily-2026-11-01":7,"daily-2026-11-02":9}',
        'binary-bloom-2026-11-05': '120',
        'binary-bloom-2026-11-06': '140',
        'hex-merge-98-best': '2048',
        'wire-trace-best:2026-11-06': '42s',
        'snake-best': '30'
    });
    const recs = r.T.playgroundRecords(list);
    const by = Object.fromEntries(recs.map(g => [g.slug, g]));
    expect(!!by['lights-out'] && /best 9/.test(by['lights-out'].line), 'lights out: a best', by['lights-out'] && by['lights-out'].line);
    expect(!!by['dots-and-boxes'], 'dots and boxes saved as dots-boxes and is still found');
    expect(!!by['word-ladder'] && by['word-ladder'].keys.length === 2, 'word ladder, behind a playground. prefix');
    expect(!!by['river-ferry'] && /2 records/.test(by['river-ferry'].line), 'river ferry, behind a mrhakan. prefix', by['river-ferry'] && by['river-ferry'].line);
    expect(!!by['binary-bloom'] && /2 days on record/.test(by['binary-bloom'].line), 'a daily puzzle counts its days', by['binary-bloom'] && by['binary-bloom'].line);
    expect(!recs.some(g => g.keys.includes('snake-best')), 'the desktop\'s snake is not cursor snake');
    expect(r.T.describe(['snake-best']) === 'best 30' && ['Infinity', 'null', '0', '', '{}'].every(v => { r.localStorage.setItem('x-junk', v); return r.T.describe(['x-junk']) === ''; }),
        'a best of Infinity, null or nothing is not a record');
    r.localStorage.removeItem('x-junk');
    expect(recs.length === 7, 'seven games on record', recs.map(g => g.slug).join(', '));

    // and what that earns, checked by the room since those pages do not load fun.js
    r.T.sync().then(() => {
        expect(r.won.includes('playground') && r.won.includes('playground_5') && !r.won.includes('playground_15'),
            'seven games on record earn the first two playground trophies, not the third', r.won.join(', '));
        finish();
    });
}

// ===================================================================
// the rest waits for that promise
// ===================================================================
function finish() {
    section('it loads when it is opened, and offline');
    {
        const lazy = read('js/lazy.js');
        expect(/'js\/trophies\.js': \['openTrophies'\]/.test(lazy), 'js/lazy.js stands in for openTrophies');
        expect(!/js\/trophies\.js/.test(read('index.html')), 'and nothing on the desktop loads it at boot');
        const sw = read('sw.js');
        expect(['/js/trophies.js', '/css/trophies.css'].every(f => sw.includes("'" + f + "'")), 'the service worker keeps the room for offline');
        expect(/achv-toast[\s\S]{0,30}/.test(fun) && /el\.onclick = \(\) => \{ el\.remove\(\); startMenuAction\('trophies'\); \}/.test(fun),
            'an achievement toast opens the room when clicked');
        expect(/'mrhakan98-playtime'/.test(read('js/documents.js')), 'my documents backs up the time played with the achievements');
    }

    section('site.webmanifest, by what Chrome asks before it offers an install');
    let m = null;
    try { m = JSON.parse(read('site.webmanifest')); } catch (e) { }
    expect(!!m, 'it is json');
    m = m || {};
    expect(typeof m.name === 'string' && m.name.length > 0 && typeof m.short_name === 'string' && m.short_name.length <= 12,
        'a name, and a short name that fits under an icon', m.short_name);
    expect(m.id === '/' && m.start_url === '/' && m.scope === '/', 'an id, and a start inside its scope');
    expect(['standalone', 'fullscreen', 'minimal-ui'].includes(m.display), 'it opens in a window of its own', m.display);
    const hex = c => /^#[0-9a-f]{6}$/i.test(c || '');
    expect(hex(m.theme_color) && hex(m.background_color), 'theme and background colours');
    const html = read('index.html');
    expect(html.includes('<meta name="theme-color" content="' + m.theme_color + '"'), 'the theme colour matches the page\'s');
    expect(/<link rel="manifest" href="site\.webmanifest"/.test(html), 'and the page links it');

    // the sizes come from the files, not from what the manifest says they are
    const png = f => {
        const b = fs.readFileSync(path.join(ROOT, f));
        if (b.readUInt32BE(0) !== 0x89504e47) return null;
        return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: b[25], trns: b.includes(Buffer.from('tRNS')), bytes: b.length };
    };
    const icons = Array.isArray(m.icons) ? m.icons : [];
    const bad = [];
    for (const i of icons) {
        const f = String(i.src || '').replace(/^\//, '');
        if (!exists(f)) { bad.push(i.src + ' is missing'); continue; }
        const p = png(f);
        if (!p) { bad.push(i.src + ' is not a png'); continue; }
        if (i.sizes !== p.w + 'x' + p.h) bad.push(i.src + ' says ' + i.sizes + ' and is ' + p.w + 'x' + p.h);
        if (i.type !== 'image/png') bad.push(i.src + ' type');
        if (p.bytes > 24 * 1024) bad.push(i.src + ' is ' + Math.round(p.bytes / 1024) + 'kb');
    }
    expect(icons.length >= 4 && !bad.length, 'every icon is there, a png of the size it says, under 24kb', bad.join(', '));
    const has = (size, purpose) => icons.some(i => i.sizes === size && (i.purpose || 'any').split(' ').includes(purpose));
    expect(has('192x192', 'any') && has('512x512', 'any'), 'a 192 and a 512 for anywhere');
    expect(has('192x192', 'maskable') && has('512x512', 'maskable'), 'and maskable ones for a phone that crops them round');
    const masks = icons.filter(i => i.purpose === 'maskable').map(i => png(i.src.replace(/^\//, '')));
    expect(masks.every(p => p && !p.trns && p.type !== 6 && p.type !== 4), 'a maskable icon has no see-through corners to crop into');
    const touch = /<link rel="apple-touch-icon" sizes="180x180" href="([^"]+)"/.exec(html);
    const tp = touch && exists(touch[1]) && png(touch[1]);
    expect(!!tp && tp.w === 180 && !tp.trns && tp.type !== 6, 'an iphone gets an opaque 180 of its own', touch && touch[1]);

    const sw = read('sw.js');
    expect(/navigator\.serviceWorker\.register\('\/sw\.js'\)/.test(html) && /addEventListener\('fetch'/.test(sw), 'a service worker that answers fetches');
    const precache = (/const PRECACHE = \[([\s\S]*?)\];/.exec(sw) || [])[1] || '';
    expect(["'/site.webmanifest'", "'/src/icons/icon-192.png'"].every(f => precache.includes(f)), 'which keeps the manifest and the icon from the first visit');
    const later = (/const PRECACHE_LATER = \[([\s\S]*?)\];/.exec(sw) || [])[1] || '';
    const listed = [...(precache + later).matchAll(/'([^']+)'/g)].map(x => x[1].split('?')[0]);
    const gone = listed.filter(f => f !== '/' && !exists(decodeURIComponent(f.slice(1))));
    expect(!gone.length, 'and everything it lists is on the disk', gone.join(', '));
    const unkept = icons.map(i => i.src).filter(s => !listed.includes(s));
    expect(!unkept.length, 'every icon is kept for offline', unkept.join(', '));

    const shortcuts = Array.isArray(m.shortcuts) ? m.shortcuts : [];
    const actions = read('js/index.js');
    const table = actions.slice(actions.indexOf('function appActions()'), actions.indexOf('function startMenuAction'));
    const deadShort = shortcuts.filter(s => {
        const app = (/^\/\?app=([\w-]+)$/.exec(s.url || '') || [])[1];
        return !app || !new RegExp("^\\s+'?" + app + "'?:", 'm').test(table) || !s.name;
    }).map(s => s.url);
    expect(shortcuts.length >= 2 && shortcuts.length <= 4 && !deadShort.length, 'shortcuts that open something real, four at most', deadShort.join(', '));

    section('the install button');
    {
        const entries = [...html.matchAll(/<button[^>]*class="[^"]*\binstall-entry\b[^"]*"[^>]*>/g)].map(x => x[0]);
        expect(entries.length === 2, 'one in the start menu and one in the tray', entries.length + ' found');
        expect(entries.every(e => /\bhidden\b/.test(e) && /onclick="installSite\(\)"/.test(e)), 'both hidden until there is something to install');
        expect(/addEventListener\('beforeinstallprompt', e => \{ e\.preventDefault\(\); installPrompt = e;/.test(fun), 'the browser\'s own prompt is caught and kept for the button');
        expect(/display-mode: standalone/.test(fun) && /navigator\.standalone/.test(fun), 'and nothing is offered inside the installed copy');
        expect(/add to home screen/.test(fun), 'an iphone is told the two taps instead');
        expect(/addEventListener\('appinstalled'/.test(fun), 'and an install is noticed');
    }

    section('offline, the online games say so');
    {
        const np = read('games/netplay.js');
        expect(/t\.kind !== 'local' && typeof navigator !== 'undefined' && navigator\.onLine === false\) return Promise\.reject\(new Error\(NP\.OFFLINE\)\)/.test(np),
            'a lobby offline fails at once with a reason, not after a timeout');
        expect(/function lazyFail/.test(read('js/extras.js')) && /navigator\.onLine === false/.test(read('js/lazy.js')),
            'a game that was never saved for offline says that, not "check the cable"');
    }

    console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
    process.exit(failures ? 1 : 0);
}
