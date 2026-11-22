// browser-games-finder.mjs — start > games, found fast: a search box that filters
// the flyout as you type, a "recent" group written by every launch path, and a
// "favorites" group pinned with a star that survives a reload. On a desktop, a
// short desktop, a phone, and a browser whose storage throws.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const SHOTS = process.env.TMPDIR || '/tmp';
const browser = await chromium.launch();

let checks = 0, fail = 0;
const ok = (c, m, detail) => { checks++; console.log((c ? '  ok    ' : '  FAIL  ') + m + (!c && detail ? '\n        ' + detail : '')); if (!c) fail++; };
const section = n => console.log('\n== ' + n + ' ==');

const SUB = '#start-menu .start-sub:has(.start-flyout-columns)';
const FLY = SUB + ' .start-flyout-columns';
const INPUT = FLY + ' .gf-search input';

async function open(opts = {}) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opts.ctx || {}));
    await ctx.route('**/*', r => r.request().url().startsWith(BASE) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
    await ctx.addInitScript(() => {
        try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); } catch (_) { }
        try { localStorage.setItem('sound-enabled', 'false'); } catch (_) { }
    });
    if (opts.blocked) await ctx.addInitScript(() => {
        // a browser that says no to every bit of storage it is asked for
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await load(p, opts.url || '/');
    return { ctx, p, errors };
}
async function load(p, url) {
    await p.goto(BASE + url, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof startMenuAction === 'function');
    await p.evaluate(() => document.getElementById('boot-screen')?.remove());
}

// start, then games, with real clicks (taps on a phone), until the finder is drawn
async function openGames(p, tap) {
    const go = sel => tap ? p.tap(sel) : p.click(sel);
    if (await p.evaluate(() => document.getElementById('start-menu').classList.contains('hidden'))) await go('#start-button');
    await p.waitForFunction(() => !document.getElementById('start-menu').classList.contains('hidden'));
    if (!await p.evaluate(s => document.querySelector(s).classList.contains('open'), SUB)) await go(SUB + ' > .has-sub');
    await p.waitForFunction(s => !!document.querySelector(s), INPUT, { timeout: 10000 });
    await p.waitForFunction(s => getComputedStyle(document.querySelector(s)).display !== 'none', FLY);
}

// what the flyout shows, in the order it shows it
const shown = p => p.evaluate(s => [...document.querySelector(s).children]
    .filter(el => getComputedStyle(el).display !== 'none')
    .map(el => el.classList.contains('gf-label') ? '#' + el.textContent
        : el.classList.contains('gf-search') ? '[search]'
        : [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()), FLY);
const hits = async p => (await shown(p)).filter(x => x !== '[search]' && !x.startsWith('#'));
const geometry = p => p.evaluate(s => {
    const f = document.querySelector(s), r = f.getBoundingClientRect();
    const rows = [...f.querySelectorAll(':scope > .start-item')].filter(b => getComputedStyle(b).display !== 'none');
    const bar = document.getElementById('taskbar')?.getBoundingClientRect().top ?? innerHeight;
    return {
        display: getComputedStyle(f).display,
        // one line per row: a name pushed onto two lines makes its whole grid row taller
        even: new Set(getComputedStyle(f).gridTemplateRows.split(' ')).size <= 1,
        cols: new Set(rows.map(b => Math.round(b.getBoundingClientRect().left))).size,
        left: r.left, right: r.right, bottom: r.bottom, bar, width: document.documentElement.clientWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
}, FLY);
const windows = p => p.evaluate(() => [...document.querySelectorAll('.app-window')].filter(w => w.id).length);
const menuHidden = p => p.waitForFunction(() => document.getElementById('start-menu').classList.contains('hidden'), null, { timeout: 5000 }).then(() => true, () => false);
const stored = (p, k) => p.evaluate(k => localStorage.getItem(k), k);

try {
    // ---------------------------------------------------------------
    section('desktop 1280x800: search');
    // ---------------------------------------------------------------
    const d = await open();
    const nothingYet = await d.p.evaluate(() => !document.querySelector('.gf-search') && ![...document.scripts].some(s => /games-finder/.test(s.src)));
    ok(nothingYet, 'the finder is not part of the boot');
    await openGames(d.p);
    const all = await geometry(d.p);
    ok(all.display === 'grid' && all.cols >= 2, 'the games flyout still spills into ' + all.cols + ' columns');
    ok(all.even && all.right <= all.width && all.bottom <= all.bar + 1, 'and stays inside the screen, above the taskbar', JSON.stringify(all));
    const first = await shown(d.p);
    ok(first[0] === '[search]' && !first.some(x => x.startsWith('#')), 'a fresh browser: the search box on top and no groups');

    await d.p.click(INPUT);
    await d.p.keyboard.type('pisti');
    ok(JSON.stringify(await hits(d.p)) === '["kartz 98"]', '"pisti" finds kartz 98 by its keywords', JSON.stringify(await hits(d.p)));
    await d.p.fill(INPUT, '');
    await d.p.keyboard.type('PİŞTİ');
    ok(JSON.stringify(await hits(d.p)) === '["kartz 98"]', 'and so does "PİŞTİ": case and accents do not matter');
    await d.p.fill(INPUT, '');
    await d.p.keyboard.type('amiral');
    ok(JSON.stringify(await hits(d.p)) === '["battleship 98"]', '"amiral" finds battleship 98', JSON.stringify(await hits(d.p)));
    await d.p.fill(INPUT, '');
    await d.p.keyboard.type('zzqx');
    const none = await shown(d.p);
    ok(none.includes('#no games match') && !(await hits(d.p)).length, 'nothing matching says so', JSON.stringify(none));

    await d.p.fill(INPUT, '');
    await d.p.keyboard.type('troll');
    const trolls = await hits(d.p);
    ok(trolls.length >= 3 && trolls[0] === 'troll problem' && trolls.includes('age of troll') && trolls.includes('Brawlz 98'), 'a word several games share finds them all, names first: ' + trolls.join(', '));
    const few = await geometry(d.p);
    ok(few.cols === 1 && few.right <= few.width && few.bottom <= few.bar + 1, 'the columns fit to what is left: one column, inside the screen', JSON.stringify(few));
    await d.p.screenshot({ path: path.join(SHOTS, 'games-finder-search.png') });

    // arrows walk the matches and come back to the box
    await d.p.keyboard.press('ArrowDown');
    const focus = () => d.p.evaluate(() => document.activeElement.matches('input') ? '[search]' : [...document.activeElement.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim());
    ok(await focus() === trolls[0], 'arrow down goes to the first match');
    await d.p.keyboard.press('ArrowDown');
    ok(await focus() === trolls[1], 'and the next one');
    await d.p.keyboard.press('ArrowUp');
    await d.p.keyboard.press('ArrowUp');
    ok(await focus() === '[search]', 'arrow up from the first goes back to the box');

    // escape: clears, then closes
    await d.p.keyboard.press('Escape');
    ok(await d.p.inputValue(INPUT) === '' && (await hits(d.p)).length === await d.p.locator(FLY + ' > .start-item').count(), 'escape clears the search and every game is back');
    ok(await d.p.evaluate(() => !document.getElementById('start-menu').classList.contains('hidden')), 'and the start menu is still open');
    await d.p.keyboard.press('Escape');
    ok(await menuHidden(d.p), 'escape again closes the start menu');

    // ---------------------------------------------------------------
    section('desktop: enter launches, recent remembers');
    // ---------------------------------------------------------------
    const before = await windows(d.p);
    await openGames(d.p);
    await d.p.click(INPUT);
    await d.p.keyboard.type('pong');
    await d.p.keyboard.press('Enter');
    const launched = await d.p.waitForFunction(n => [...document.querySelectorAll('.app-window')].filter(w => w.id).length > n, before, { timeout: 10000 }).then(() => true, () => false);
    const title = await d.p.locator('.app-window[id] .app-window-title').last().textContent().catch(() => '');
    ok(launched && /pong/i.test(title), 'enter opens the first match in a window: ' + title.trim());
    ok(await menuHidden(d.p), 'and the start menu closes');

    await openGames(d.p);
    ok(await d.p.inputValue(INPUT) === '', 'the next visit starts with an empty search');
    await d.p.click(FLY + ' > .start-item:has-text("snake")');
    ok(await menuHidden(d.p), 'a game clicked in the menu closes the start menu');
    await d.p.waitForFunction(() => [...document.querySelectorAll('.app-window-title')].some(t => /snake/i.test(t.textContent)), null, { timeout: 10000 });
    ok(await stored(d.p, 'mrhakan98-games-recent') === '["snake","pong"]', 'recent is stored newest first', await stored(d.p, 'mrhakan98-games-recent'));
    await openGames(d.p);
    let list = await shown(d.p);
    ok(JSON.stringify(list.slice(0, 5)) === '["[search]","#recent","snake","pong","#all games"]', 'reopened: a recent group with snake, then pong', JSON.stringify(list.slice(0, 6)));
    ok(list.filter(x => x === 'snake').length === 1, 'and each game is still one row, not a copy');
    const withGroups = await geometry(d.p);
    ok(withGroups.even && withGroups.right <= withGroups.width && withGroups.bottom <= withGroups.bar + 1, 'the groups still fit inside the screen', JSON.stringify(withGroups));
    await d.p.click(INPUT);
    await d.p.keyboard.type('snake');
    ok(!(await shown(d.p)).some(x => x.startsWith('#')), 'with a search going the groups step aside and only matches show');
    await d.p.keyboard.press('Escape');

    // ---------------------------------------------------------------
    section('desktop: favorites');
    // ---------------------------------------------------------------
    const n = await windows(d.p);
    const mine = FLY + ' > .start-item:has-text("minesweeper") .gf-star';
    ok(await d.p.getAttribute(mine, 'aria-pressed') === 'false', 'every row has a star, not pressed');
    await d.p.click(mine);
    ok(await d.p.getAttribute(mine, 'aria-pressed') === 'true', 'clicking it pins the game');
    ok(await windows(d.p) === n && await d.p.evaluate(() => !document.getElementById('start-menu').classList.contains('hidden')), 'without opening it or closing the menu');
    list = await shown(d.p);
    ok(JSON.stringify(list.slice(0, 4)) === '["[search]","#favorites","minesweeper","#recent"]', 'favorites sit above recent', JSON.stringify(list.slice(0, 6)));

    // the keyboard gets there too: a row, arrow right to its star, enter
    await d.p.focus(FLY + ' > .start-item:has-text("solitaire")');
    await d.p.keyboard.press('ArrowRight');
    ok(await d.p.evaluate(() => document.activeElement.classList.contains('gf-star')), 'arrow right on a row reaches its star');
    await d.p.keyboard.press('Enter');
    ok(await d.p.getAttribute(FLY + ' > .start-item:has-text("solitaire") .gf-star', 'aria-pressed') === 'true', 'and enter pins it');
    ok(await d.p.evaluate(() => document.activeElement.classList.contains('gf-star')), 'keeping the focus on the star');
    await d.p.keyboard.press('Space');
    ok(await d.p.getAttribute(FLY + ' > .start-item:has-text("solitaire") .gf-star', 'aria-pressed') === 'false', 'space unpins it again');
    ok(await windows(d.p) === n, 'and none of that opened a game');
    ok(await stored(d.p, 'mrhakan98-games-favs') === '["minesweeper"]', 'favorites are stored', await stored(d.p, 'mrhakan98-games-favs'));

    await load(d.p, '/');
    await openGames(d.p);
    list = await shown(d.p);
    ok(JSON.stringify(list.slice(0, 7)) === '["[search]","#favorites","minesweeper","#recent","snake","pong","#all games"]', 'after a reload: favorites, then recent, in order', JSON.stringify(list.slice(0, 8)));
    await d.p.screenshot({ path: path.join(SHOTS, 'games-finder-groups.png') });

    // the start menu over an open window: still on top
    await d.p.evaluate(() => startMenuAction('pong'));
    await openGames(d.p);
    const onTop = await d.p.evaluate(s => {
        const r = document.querySelector(s).getBoundingClientRect();
        const el = document.elementFromPoint(r.left + 20, r.top + 10);
        return !!el && !!el.closest('#start-menu');
    }, FLY);
    ok(onTop, 'the flyout stays above an open window');
    await d.p.keyboard.press('Escape').catch(() => { });

    // ?app= is a launch too
    await load(d.p, '/?app=snake');
    await d.p.waitForFunction(() => /^\["snake"/.test(localStorage.getItem('mrhakan98-games-recent') || ''));
    await load(d.p, '/?app=minesweeper');
    await d.p.waitForFunction(() => /^\["minesweeper"/.test(localStorage.getItem('mrhakan98-games-recent') || ''), null, { timeout: 5000 }).catch(() => { });
    ok(await stored(d.p, 'mrhakan98-games-recent') === '["minesweeper","snake","pong"]', 'a game opened by ?app= goes to the top of recent', await stored(d.p, 'mrhakan98-games-recent'));
    // a non-game is not a game
    await d.p.evaluate(() => startMenuAction('notepad'));
    ok(await stored(d.p, 'mrhakan98-games-recent') === '["minesweeper","snake","pong"]', 'notepad is not a game and does not count');
    // a direct call (the run box, find:) counts as well
    await d.p.evaluate(() => openPong());
    ok(await stored(d.p, 'mrhakan98-games-recent') === '["pong","minesweeper","snake"]', 'nor does it matter that a game was opened without the menu', await stored(d.p, 'mrhakan98-games-recent'));
    ok(!d.errors.length, 'no page errors', d.errors.join(' | '));
    await d.ctx.close();

    // ---------------------------------------------------------------
    section('a short desktop, 1280x680, with both groups');
    // ---------------------------------------------------------------
    const s = await open({ ctx: { viewport: { width: 1280, height: 680 } } });
    await s.p.evaluate(() => {
        localStorage.setItem('mrhakan98-games-favs', JSON.stringify(['tetris', 'snake', 'pong']));
        localStorage.setItem('mrhakan98-games-recent', JSON.stringify(['wizardz', 'kartz', 'tavla', 'okey', 'popz']));
    });
    await load(s.p, '/');
    await openGames(s.p);
    const short = await geometry(s.p);
    ok(short.display === 'grid' && short.even && short.right <= short.width && short.bottom <= short.bar + 1, 'more columns, still inside the screen and above the taskbar (' + short.cols + ' columns)', JSON.stringify(short));
    list = await shown(s.p);
    ok(list[1] === '#favorites' && list[2] === 'snake' && list[3] === 'pong' && list[4] === '#recent', 'a favorite that is not a game in this menu is left out, the rest in pinned order', JSON.stringify(list.slice(0, 6)));
    await s.p.screenshot({ path: path.join(SHOTS, 'games-finder-short.png') });
    ok(!s.errors.length, 'no page errors', s.errors.join(' | '));
    await s.ctx.close();

    // ---------------------------------------------------------------
    section('phone 390x844');
    // ---------------------------------------------------------------
    const m = await open({ ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
    await openGames(m.p, true);
    const ph = await geometry(m.p);
    ok(ph.display === 'block' && ph.cols === 1, 'one column on a phone');
    ok(ph.overflow <= 0 && ph.left >= 0 && ph.right <= ph.width, 'nothing sticks out sideways', JSON.stringify(ph));
    const scrolls = await m.p.evaluate(s => { const f = document.querySelector(s); return getComputedStyle(f).overflowY === 'auto' && f.scrollHeight > f.clientHeight; }, FLY);
    ok(scrolls, 'and the list scrolls up and down');
    await m.p.evaluate(s => { const f = document.querySelector(s); f.scrollTop = f.scrollHeight; }, FLY);
    const sticky = await m.p.evaluate(s => {
        const f = document.querySelector(s).getBoundingClientRect(), b = document.querySelector(s + ' .gf-search').getBoundingClientRect();
        return b.top >= f.top - 1 && b.bottom <= f.bottom;
    }, FLY);
    ok(sticky, 'with the search box kept in sight while it scrolls');
    await m.p.tap(INPUT);
    await m.p.keyboard.type('snak');
    ok(JSON.stringify(await hits(m.p)) === '["snake"]', 'typing filters it');
    await m.p.tap(FLY + ' > .start-item:has-text("snake") .gf-star');
    ok(await m.p.getAttribute(FLY + ' > .start-item:has-text("snake") .gf-star', 'aria-pressed') === 'true', 'a tap on the star pins it');
    const mb = await windows(m.p);
    await m.p.tap(INPUT);
    await m.p.keyboard.press('Enter');
    const mOpened = await m.p.waitForFunction(n => [...document.querySelectorAll('.app-window')].filter(w => w.id).length > n, mb, { timeout: 10000 }).then(() => true, () => false);
    ok(mOpened && await menuHidden(m.p), 'enter opens it and the start menu closes');
    await openGames(m.p, true);
    list = await shown(m.p);
    ok(JSON.stringify(list.slice(0, 3)) === '["[search]","#favorites","snake"]' && !list.includes('#recent'), 'a pinned game is not listed twice in recent', JSON.stringify(list.slice(0, 5)));
    ok((await geometry(m.p)).overflow <= 0, 'still nothing sticks out sideways');
    await m.p.screenshot({ path: path.join(SHOTS, 'games-finder-phone.png') });
    ok(!m.errors.length, 'no page errors', m.errors.join(' | '));
    await m.ctx.close();

    // ---------------------------------------------------------------
    section('storage that throws');
    // ---------------------------------------------------------------
    const b = await open({ blocked: true });
    await openGames(b.p);
    ok(!(await shown(b.p)).some(x => x.startsWith('#')), 'no groups');
    await b.p.click(INPUT);
    await b.p.keyboard.type('pong');
    ok(JSON.stringify(await hits(b.p)) === '["pong"]', 'the search still works');
    const bb = await windows(b.p);
    await b.p.keyboard.press('Enter');
    const bOpened = await b.p.waitForFunction(n => [...document.querySelectorAll('.app-window')].filter(w => w.id).length > n, bb, { timeout: 10000 }).then(() => true, () => false);
    ok(bOpened && await menuHidden(b.p), 'and enter still opens the game');
    await openGames(b.p);
    ok(!(await shown(b.p)).some(x => x.startsWith('#')), 'nowhere to keep a recent list: still no groups');
    await b.p.click(FLY + ' > .start-item:has-text("solitaire") .gf-star');
    ok(await b.p.getAttribute(FLY + ' > .start-item:has-text("solitaire") .gf-star', 'aria-pressed') === 'true', 'a star still answers, for as long as the page is open');
    ok(!b.errors.length, 'no page errors', b.errors.join(' | '));
    await b.ctx.close();
} finally {
    await browser.close();
    server.close();
}
console.log('\n' + (fail ? fail + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(fail ? 1 : 0);
