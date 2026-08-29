// ===================================================================
// browser-web.mjs — the reading layer, in a real browser
//
// check-web.mjs proves the routing functions are correct in isolation.
// This one proves the site behaves: type a name in the address bar and
// the page opens, press back and it closes, star it and it is still
// starred after a reload, select a sentence and get the sentence plus
// the address of the section it came from.
//
// It brings its own server for the 404 half, because github pages
// answers an unknown path with 404.html and python's http.server does
// not — and the 404 page is where /now and /uses are routed, so testing
// it against the wrong server would prove nothing.
//
// Needs playwright's chromium and a static server on :8099.
//   node .github/scripts/browser-web.mjs
// ===================================================================
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const BASE = process.env.SITE_URL || 'http://localhost:8099';
const PAGES_PORT = Number(process.env.PAGES_PORT || 8101);

let failures = 0, checks = 0;
const ok = m => { checks++; console.log('  ok    ' + m); };
const bad = (m, d) => { checks++; failures++; console.log('  FAIL  ' + m + (d ? '\n        ' + d : '')); };
const expect = (c, m, d) => c ? ok(m) : bad(m, d);
const section = n => console.log('\n== ' + n + ' ==');

// ---------- a stand-in for github pages ----------
// the one behaviour that matters here: an unknown path gets 404.html
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain',
    '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg',
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'
};
const pages = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(process.cwd(), p);
    if (file.startsWith(process.cwd()) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    } else {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end(fs.readFileSync('404.html'));
    }
});
await new Promise(r => pages.listen(PAGES_PORT, r));
const PAGES = 'http://localhost:' + PAGES_PORT;

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1180, height: 880 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
// the welcome popup evicts whatever dialog is on screen 1.4s after boot
await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); } catch (e) { } });

// nothing here is about the cdn. This run opens ~20 pages and every one of
// them would otherwise wait on tailwind, google fonts, the visitor counter
// and the github api — so the whole suite is hermetic: anything that is not
// this server is refused, which also means the test cannot go red because
// somebody else's cdn is having an afternoon.
await ctx.route('**/*', route => {
    const u = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) || u.startsWith('data:') || u.startsWith('blob:')) {
        return route.continue();
    }
    return route.abort();
});

const errors = [];

async function open(url) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(url + ': ' + e.message));
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    // the boot screen wants a keypress, and a deep link waits for it
    await p.keyboard.press('Enter');
    await p.evaluate(() => {
        const b = document.getElementById('boot-screen');
        if (b) { b.classList.add('booted'); b.remove(); }
        try { sessionStorage.setItem('booted', '1'); } catch (e) { }
        window.soundEnabled = false;
    }).catch(() => { });
    await p.waitForTimeout(700);
    return p;
}
const clearDialogs = p => p.evaluate(() =>
    document.querySelectorAll('.retro-dialog-overlay').forEach(d => d.remove()));
const clip = p => p.evaluate(() => navigator.clipboard.readText());
// The toolbar is part of the page and app windows float above it, so once
// something is open a click on back can land on the window instead. That is
// the desktop working as designed — you move the window or use the taskbar —
// and it is not what these checks are about, so they press the button
// directly. There is one check below that the toolbar is genuinely
// clickable when nothing is covering it.
const press = (p, sel) => p.locator(sel).click({ force: true });
const titles = p => p.$$eval('.app-window-title', els => els.map(e => e.textContent.trim()));

// ===================================================================
section('a url opens a document');
// ===================================================================
{
    const p = await open(BASE + '/?app=colophon');
    await p.waitForSelector('.doc-tools', { timeout: 15000 }).catch(() => { });
    expect((await titles(p)).some(t => /colophon/.test(t)),
        '?app=colophon opens the colophon', (await titles(p)).join(', '));
    expect(await p.locator('.doc-tools').count() > 0, 'with the reading toolbar on it');
    expect(/words/.test(await p.locator('.doc-count').first().textContent().catch(() => '')),
        'and its length');
    await p.close();
}
{
    // usespage is the action's key; /uses is what the url says
    const p = await open(BASE + '/?app=uses');
    await p.waitForSelector('.doc-tools', { timeout: 15000 }).catch(() => { });
    expect((await titles(p)).some(t => /uses/.test(t)),
        'the public name resolves to the action behind it', (await titles(p)).join(', '));
    await p.close();
}
{
    const p = await open(BASE + '/?app=zzz-not-a-page');
    expect(await p.locator('.app-window').count() === 0,
        'a url naming nothing opens nothing');
    expect(!errors.some(e => /zzz-not-a-page/.test(e)), 'and does not throw on the way');
    await p.close();
}

// ===================================================================
section('a url can point inside a document');
// ===================================================================
{
    const p = await open(BASE + '/?app=now');
    await p.waitForSelector('.doc-h2', { timeout: 15000 }).catch(() => { });
    const id = await p.locator('.doc-h2').first().getAttribute('id');
    expect(!!id, 'every section heading has an id', String(id));
    await p.close();

    const deep = await open(BASE + '/?app=now#' + id);
    await deep.waitForTimeout(900);
    const flashed = await deep.evaluate((i) => {
        const el = document.getElementById(i);
        return !!el && (el.classList.contains('anchor-hit') || el.getBoundingClientRect().top < 400);
    }, id);
    expect(flashed, 'and a url ending in one lands on it', '#' + id);
    await deep.close();
}
{
    // the devlog carries a second parameter, for the post
    const p = await open(BASE + '/?app=devlog');
    await p.waitForSelector('.post', { timeout: 15000 });
    const ids = await p.$$eval('.post', els => els.map(e => e.dataset.post));
    await p.close();
    const target = ids[Math.min(2, ids.length - 1)];
    const one = await open(BASE + '/?app=devlog&post=' + target);
    await one.waitForSelector('.post.open', { timeout: 15000 });
    expect(await one.locator('.post.open').getAttribute('data-post') === target,
        'a devlog url opens straight onto its post', target);
    await one.close();
}

// ===================================================================
section('the address bar');
// ===================================================================
{
    const p = await open(BASE + '/');
    const addr = p.locator('#ie-address');
    expect(await addr.count() === 1, 'the window has one');
    // with nothing open, the toolbar is reachable the ordinary way
    expect(await addr.isEditable() && await p.locator('#ie-go').isEnabled(),
        'and it is usable with nothing covering it');
    expect(!/app=/.test(await addr.inputValue()), 'the bare desktop has a clean address',
        await addr.inputValue());

    // typing a bare name
    await clearDialogs(p);
    await addr.fill('now', { force: true });
    await addr.press('Enter');
    await p.waitForTimeout(900);
    expect((await titles(p)).some(t => /now/.test(t)), 'typing a name opens that page',
        (await titles(p)).join(', '));
    expect(/app=now/.test(p.url()), 'and the url follows', p.url());
    expect(/app=now/.test(await addr.inputValue()), 'and so does the address bar',
        await addr.inputValue());

    // typing it the other ways people write it
    for (const [typed, want] of [['/uses', 'app=uses'], ['?app=changelog', 'app=changelog'],
    [BASE + '/?app=shrine', 'app=shrine']]) {
        await clearDialogs(p);
        await addr.fill(typed, { force: true });
        await addr.press('Enter');
        await p.waitForTimeout(800);
        expect(p.url().includes(want), '"' + typed + '" goes to ' + want, p.url());
    }

    // and something that is not a page at all
    await clearDialogs(p);
    await addr.fill('defragmenter', { force: true });
    await addr.press('Enter');
    await p.waitForTimeout(900);
    expect((await titles(p)).some(t => /find/.test(t)),
        'a word that is not a page opens find: instead of failing',
        (await titles(p)).join(', '));
    await p.close();
}

// ===================================================================
section('back, forward and home');
// ===================================================================
{
    const p = await open(BASE + '/');
    await clearDialogs(p);
    await p.evaluate(() => WEB.open('colophon'));
    await p.waitForTimeout(700);
    expect(/app=colophon/.test(p.url()), 'opening writes the url', p.url());

    await press(p, '#ie-back');
    await p.waitForTimeout(800);
    expect(!/app=/.test(p.url()), 'the toolbar back button walks out of it', p.url());
    expect(await p.locator('.app-window').count() === 0, 'and closes the window it opened');

    await press(p, '#ie-fwd');
    await p.waitForTimeout(900);
    expect(/app=colophon/.test(p.url()), 'forward walks back into it', p.url());
    expect(await p.locator('.app-window').count() > 0, 'and reopens the window');

    await press(p, '#ie-home');
    await p.waitForTimeout(700);
    expect(!/app=/.test(p.url()), 'home goes back to a clean address', p.url());
    await p.close();
}

// ===================================================================
section('copying the link');
// ===================================================================
{
    const p = await open(BASE + '/?app=colophon');
    await p.waitForSelector('.doc-tools', { timeout: 15000 });
    await clearDialogs(p);
    await p.locator('.doc-tool[data-t="link"]').first().click({ force: true });
    await p.waitForTimeout(400);
    expect(/\?app=colophon$/.test(await clip(p)), 'the toolbar link button copies the page url',
        await clip(p));

    // the title bar has one too, for windows with no toolbar
    expect(await p.locator('.app-window .ie-titlebar-btn', { hasText: '🔗' }).count() > 0,
        'and so does the title bar');

    const p2 = await open(BASE + '/?app=now');
    // the anchor is deliberately hover-only on a mouse, so it is attached
    // rather than visible until you are on the heading
    await p2.waitForSelector('.h-anchor', { state: 'attached', timeout: 15000 });
    await clearDialogs(p2);
    await p2.locator('.h-anchor').first().click({ force: true });
    await p2.waitForTimeout(400);
    const anchorUrl = await clip(p2);
    expect(/\?app=now#.+/.test(anchorUrl), 'a heading anchor copies a url into the document', anchorUrl);
    await p.close();
    await p2.close();
}

// ===================================================================
section('quoting');
// ===================================================================
{
    const p = await open(BASE + '/?app=colophon');
    await p.waitForSelector('.doc-body p', { timeout: 15000 });
    await clearDialogs(p);
    await p.evaluate(() => {
        const para = document.querySelector('.doc-body .doc-intro, .doc-body p');
        const r = document.createRange();
        r.selectNodeContents(para);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
    });
    await p.waitForTimeout(500);
    expect(await p.locator('.quote-bubble').count() > 0,
        'selecting a sentence offers to quote it');
    await p.locator('.quote-bubble').first().click({ force: true });
    await p.waitForTimeout(400);
    const q = await clip(p);
    expect(q.startsWith('"') && /\?app=colophon/.test(q),
        'and the quote carries the address it came from', JSON.stringify(q.slice(0, 90)));
    await p.close();
}

// ===================================================================
section('favorites, which used to be a joke');
// ===================================================================
{
    const p = await open(BASE + '/?app=shrine');
    await p.waitForSelector('.doc-tools', { timeout: 15000 });
    await clearDialogs(p);
    await press(p, '#ie-fav');
    await p.waitForTimeout(400);
    expect(await p.evaluate(() => WEB.isFavourite('shrine')), 'the star bookmarks the open page');
    await p.close();

    // the point of a bookmark is that it is there tomorrow
    const p2 = await open(BASE + '/');
    expect(await p2.evaluate(() => WEB.favourites().length) > 0,
        'and it survives a reload');
    await clearDialogs(p2);
    await p2.evaluate(() => WEB.toggleFavouritesMenu());
    await p2.waitForTimeout(300);
    expect(await p2.locator('.ie-fav-go').count() > 0, 'the favorites menu lists it');
    await p2.locator('.ie-fav-go').first().click({ force: true });
    await p2.waitForTimeout(800);
    expect(/app=shrine/.test(p2.url()), 'and clicking it goes there', p2.url());

    await clearDialogs(p2);
    await p2.evaluate(() => WEB.toggleFavouritesMenu());
    await p2.waitForTimeout(300);
    await p2.locator('.ie-fav-del').first().click({ force: true });
    await p2.waitForTimeout(300);
    expect(await p2.evaluate(() => WEB.favourites().length) === 0, 'and it can be taken off again');
    await p2.close();
}

// ===================================================================
section('text size');
// ===================================================================
{
    const p = await open(BASE + '/?app=uses');
    await p.waitForSelector('.doc-tools', { timeout: 15000 });
    await clearDialogs(p);
    const before = await p.evaluate(() =>
        getComputedStyle(document.querySelector('.doc-body')).fontSize);
    await p.locator('.doc-tool[data-t="bigger"]').first().click({ force: true });
    await p.waitForTimeout(300);
    const after = await p.evaluate(() =>
        getComputedStyle(document.querySelector('.doc-body')).fontSize);
    expect(parseFloat(after) > parseFloat(before), 'A+ makes the document bigger',
        before + ' -> ' + after);
    await p.close();

    const p2 = await open(BASE + '/?app=uses');
    await p2.waitForSelector('.doc-body', { timeout: 15000 });
    const kept = await p2.evaluate(() =>
        getComputedStyle(document.querySelector('.doc-body')).fontSize);
    expect(kept === after, 'and it is still that size next time', kept);
    await p2.close();
}

// ===================================================================
section('the slash pages github pages cannot route');
// ===================================================================
{
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push('404: ' + e.message));
    for (const [from, want] of [['/now', 'app=now'], ['/uses/', 'app=uses'],
    ['/blog', 'app=devlog'], ['/projects', 'app=github'], ['/colophon.html', 'app=colophon']]) {
        await p.goto(PAGES + from);
        await p.waitForTimeout(500);
        expect(p.url().includes(want), from + ' lands on ' + want, p.url());
    }
    for (const [from, want] of [['/colophn', 'colophon'], ['/guestbok', 'guestbook']]) {
        await p.goto(PAGES + from);
        await p.waitForTimeout(400);
        const txt = await p.locator('#guess-list').textContent().catch(() => '');
        expect(txt.includes(want), from + ' suggests ' + want, 'got: ' + txt);
    }
    await p.goto(PAGES + '/qzxwvpluglrhznt');
    await p.waitForTimeout(400);
    expect(await p.locator('#guess').isVisible() === false,
        'and nonsense gets no false confidence');
    await p.close();
}

// ===================================================================
section('page errors');
// ===================================================================
// the cdn bits (tailwind, google fonts) are somebody else's problem
const real = errors.filter(e => !/ERR_|Failed to load resource|net::/.test(e));
expect(!real.length, 'no javascript errors anywhere in the run',
    real.slice(0, 6).join('\n        '));

await browser.close();
pages.close();

console.log('\n' + '='.repeat(58));
if (failures) {
    console.log(`${failures} of ${checks} browser checks FAILED`);
    process.exit(1);
}
console.log(`all ${checks} browser checks passed`);
