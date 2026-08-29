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

// This run opens about twenty pages, and every one of them would otherwise
// wait on the visitor counter, the github api, google fonts and a 400kb
// tailwind — so everything off this server is refused.
//
// Except tailwind, which is fetched once and then served from memory to
// every page. It lays the site out, and a suite that clicks things cannot
// afford to be looking at a layout the site never actually has: the address
// bar's position relative to a floating window is exactly the sort of thing
// that only shows up when the real stylesheet is there. One request instead
// of twenty, and the run is still over in a couple of minutes.
const TAILWIND = 'https://cdn.tailwindcss.com';
let tailwind = null;
try {
    const res = await fetch(TAILWIND + '?plugins=forms,container-queries', { redirect: 'follow' });
    if (res.ok) tailwind = await res.text();
} catch (e) { }
console.log(tailwind
    ? '  ..    tailwind cached once (' + Math.round(tailwind.length / 1024) + 'kb), served to every page'
    : '  ..    tailwind could not be fetched — the layout will be unstyled, and any\n' +
    '        failure below that is about where something sits is that, not the site');

await ctx.route('**/*', route => {
    const u = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) || u.startsWith('data:') || u.startsWith('blob:')) {
        return route.continue();
    }
    if (tailwind && u.startsWith(TAILWIND)) {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: tailwind });
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
// The toolbar is part of the page and app windows float above it, so with a
// document open a click at the back button's coordinates can land on the
// window instead — force does not help, because a forced click is still a
// click at a point, and the point is under the window. That is the desktop
// working as designed: you move the window, or use the taskbar. It is not
// what these checks are about, so they send the event to the button itself
// and let the ordinary check below say whether it is reachable.
const press = (p, sel) => p.locator(sel).dispatchEvent('click');

// when something does go wrong, leave a picture behind — the workflow
// already uploads this directory, and "it passes here" is not a debugging
// technique
fs.mkdirSync('.ci-shots', { recursive: true });
let shots = 0;
async function shot(p, why) {
    try { await p.screenshot({ path: '.ci-shots/web-' + (++shots) + '-' + why + '.png' }); }
    catch (e) { }
}
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
    // with nothing open, the toolbar takes a real click at real coordinates.
    // This is the check that would catch the address bar being buried.
    let reachable = true, why = '';
    try { await p.locator('#ie-home').click({ timeout: 4000 }); }
    catch (e) { reachable = false; why = String(e.message).split('\n')[0]; }
    if (!reachable) await shot(p, 'toolbar-unreachable');
    expect(reachable, 'and with nothing open it takes an ordinary click', why);
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
    if (/app=/.test(p.url())) await shot(p, 'back-did-nothing');
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
    if (!await p.evaluate(() => WEB.isFavourite('shrine'))) await shot(p, 'star-did-nothing');
    expect(await p.evaluate(() => WEB.isFavourite('shrine')), 'the star bookmarks the open page');
    await p.close();

    // the point of a bookmark is that it is there tomorrow
    const p2 = await open(BASE + '/');
    expect(await p2.evaluate(() => WEB.favourites().length) > 0,
        'and it survives a reload');
    await clearDialogs(p2);
    await p2.evaluate(() => WEB.toggleFavouritesMenu());
    await p2.waitForTimeout(300);
    await p2.waitForSelector('.ie-fav-go', { state: 'attached', timeout: 6000 }).catch(() => { });
    if (!await p2.locator('.ie-fav-go').count()) await shot(p2, 'no-favourites-listed');
    expect(await p2.locator('.ie-fav-go').count() > 0, 'the favorites menu lists it');
    await p2.locator('.ie-fav-go').first().dispatchEvent('click');
    await p2.waitForTimeout(800);
    expect(/app=shrine/.test(p2.url()), 'and clicking it goes there', p2.url());

    await clearDialogs(p2);
    await p2.evaluate(() => WEB.toggleFavouritesMenu());
    await p2.waitForTimeout(300);
    await p2.locator('.ie-fav-del').first().dispatchEvent('click');
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
section('the address bar suggests');
// ===================================================================
{
    const p = await open(BASE + '/');
    const addr = p.locator('#ie-address');
    await addr.fill('col', { force: true });
    await p.waitForTimeout(350);
    const names = await p.$$eval('.ie-sug-name', e => e.map(x => x.textContent));
    expect(names.some(n => n.includes('colophon')), 'typing two letters offers the page',
        names.join(', '));
    await addr.press('ArrowDown');
    await addr.press('Enter');
    await p.waitForTimeout(900);
    expect(/app=colophon/.test(p.url()), 'and arrow-down then enter opens it', p.url());
    await p.close();
}

// ===================================================================
section('history');
// ===================================================================
{
    const p = await open(BASE + '/');
    await p.evaluate(() => WEB.open('now'));
    await p.waitForTimeout(800);
    await p.evaluate(() => WEB.open('uses'));
    await p.waitForTimeout(1100);
    const hist = await p.evaluate(() => WEB.history().map(h => h.slug));
    expect(hist.length >= 2, 'it records what you opened', hist.join(', '));
    expect(hist[0] === 'usespage', 'newest first', hist.join(', '));
    await p.evaluate(() => WEB.togglePanel('history'));
    await p.waitForTimeout(300);
    expect(await p.locator('.ie-hist-go').count() > 0, 'the panel lists it');
    expect(await p.locator('.ie-hist-when').count() > 0, 'with how long ago');
    await p.evaluate(() => WEB.clearHistory());
    expect(await p.evaluate(() => WEB.history().length) === 0, 'and it can be cleared');
    await p.close();
}

// ===================================================================
section('the status bar');
// ===================================================================
{
    const p = await open(BASE + '/?app=colophon');
    await p.waitForSelector('.doc-tools', { timeout: 15000 });
    expect(await p.locator('#ie-status').isVisible(), 'the window has one');
    expect(/internet/.test(await p.locator('#ie-zone').textContent()), 'and it names the zone');
    const link = p.locator('.doc-body a[href^="http"]').first();
    await link.scrollIntoViewIfNeeded();
    await link.hover();
    await p.waitForTimeout(300);
    const said = await p.locator('#ie-status-text').textContent();
    expect(/^https?:\/\//.test(said), 'and hovering a link says where it goes', said);
    await p.close();
}

// ===================================================================
section('finding your way around one document');
// ===================================================================
{
    const p = await open(BASE + '/?app=devlog');
    await p.waitForSelector('.post', { timeout: 15000 });
    const folded = await p.locator('.post:not(.open)').count();
    expect(folded > 0, 'the devlog folds most of its posts shut', folded + ' folded');

    await p.keyboard.press('/');
    await p.waitForTimeout(400);
    expect(await p.locator('.find-bar').count() > 0, 'and "/" opens a find bar in it');

    await p.locator('.find-in').fill('the');
    await p.waitForTimeout(500);
    const hits = await p.locator('mark.find-hit').count();
    expect(hits > 0, 'which highlights what it found (' + hits + ')');
    expect(await p.locator('mark.find-hit.on').count() === 1, 'and marks the one you are on');
    expect(await p.locator('.post:not(.open)').count() === 0,
        'the folded posts are opened, so the search can actually see them');

    const first = await p.locator('.find-n').textContent();
    await p.locator('[data-f="next"]').dispatchEvent('click');
    await p.waitForTimeout(200);
    expect(await p.locator('.find-n').textContent() !== first, 'next moves to the next one',
        first + ' -> ' + await p.locator('.find-n').textContent());

    await p.locator('[data-f="close"]').dispatchEvent('click');
    await p.waitForTimeout(300);
    expect(await p.locator('mark.find-hit').count() === 0, 'closing takes the highlights back out');
    expect(await p.locator('.post:not(.open)').count() === folded,
        'and folds the posts it opened back up', 'was ' + folded);
    await p.close();
}

// ===================================================================
section('the two keys it takes');
// ===================================================================
{
    const p = await open(BASE + '/?app=colophon');
    await p.waitForSelector('.doc-tools', { timeout: 15000 });
    // from inside a find bar, which stops propagation on purpose
    await p.evaluate(() => WEB.openFindBar(WEB.topDoc()));
    await p.waitForTimeout(300);
    await p.locator('.find-in').focus();
    await p.keyboard.press('F6');
    await p.waitForTimeout(250);
    expect(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'ie-address',
        'F6 reaches the address bar even from inside the find bar');
    // and the browser keeps its own
    const back = await p.evaluate(() => {
        let taken = false;
        const h = (e) => { if (e.altKey && e.key === 'ArrowLeft' && e.defaultPrevented) taken = true; };
        document.addEventListener('keydown', h);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }));
        document.removeEventListener('keydown', h);
        return taken;
    });
    expect(!back, 'and alt+left is left to the browser, which already does the right thing');
    await p.close();
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
section('on a phone');
// ===================================================================
// Measured rather than assumed: a 412x915 context with a coarse pointer,
// which is what the media queries are actually asking about.
{
    const phone = await browser.newContext({
        viewport: { width: 412, height: 915 }, deviceScaleFactor: 2,
        isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'
    });
    await phone.route('**/*', route => {
        const u = route.request().url();
        if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) return route.continue();
        if (tailwind && u.startsWith(TAILWIND)) {
            return route.fulfill({ status: 200, contentType: 'text/javascript', body: tailwind });
        }
        return route.abort();
    });
    await phone.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); } catch (e) { } });
    const p = await phone.newPage();
    p.on('pageerror', e => errors.push('phone: ' + e.message));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.keyboard.press('Enter');
    await p.evaluate(() => {
        const b = document.getElementById('boot-screen');
        if (b) b.remove();
        window.soundEnabled = false;
    });
    await p.waitForTimeout(1000);

    expect(await p.evaluate(() => matchMedia('(pointer: coarse)').matches),
        'the media queries agree this is a fingertip');

    // ---- what you see first ----
    // three columns stack on a phone, and the content was the middle one:
    // 957px of avatar, nav, hit counter, winamp and a badge wall above it
    const tops = await p.evaluate(() => {
        const t = id => Math.round(document.getElementById(id).getBoundingClientRect().top);
        return { main: t('main-window'), sidebar: t('desk-sidebar'), extras: t('desk-extras') };
    });
    expect(tops.main < tops.sidebar && tops.sidebar < tops.extras,
        'the content comes first, then the nav, then the furniture', JSON.stringify(tops));
    expect(tops.main < 200, 'and it is on the first screen', 'main at ' + tops.main + 'px');

    // ---- what a fingertip can hit ----
    const small = await p.evaluate(() => {
        const out = [];
        document.querySelectorAll('.ie-nav, .doc-tool, .start-item, #main-window .draggable-header button, #sound-toggle')
            .forEach(el => {
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return;
                if (r.width < 34 || r.height < 34) out.push((el.id || el.className).slice(0, 30) +
                    ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
            });
        return out;
    });
    expect(small.length === 0, 'the chrome is big enough to hit', small.join(', '));

    // ---- typing does not zoom the page in ----
    const tiny = await p.evaluate(() => {
        const out = [];
        document.querySelectorAll('input[type="text"], input:not([type]), textarea').forEach(el => {
            const r = el.getBoundingClientRect();
            if (!r.width) return;
            if (parseFloat(getComputedStyle(el).fontSize) < 16) out.push(el.id || el.className.slice(0, 24));
        });
        return out;
    });
    expect(tiny.length === 0,
        'and every text box is 16px, so safari does not zoom in when you tap one',
        tiny.join(', '));

    // ---- the toast is not sitting on the close button ----
    await p.evaluate(() => openNowPage());
    await p.waitForTimeout(1200);
    const clash = await p.evaluate(() => {
        const t = document.querySelector('.achv-toast');
        const h = document.querySelector('.app-window .app-window-header');
        if (!t || !h) return null;
        const a = t.getBoundingClientRect(), b = h.getBoundingClientRect();
        return !(a.bottom < b.top || a.top > b.bottom);
    });
    expect(clash !== true, 'an achievement toast does not land across the window title bar',
        clash === null ? '(no toast to check)' : 'it overlapped');

    // ---- echoes: the label that came out one word per line ----
    await p.evaluate(() => openEchoes());
    await p.waitForSelector('.et-field', { timeout: 20000 });
    await p.waitForTimeout(600);
    const seedLabel = await p.evaluate(() => {
        const l = [...document.querySelectorAll('.et-field label')].find(e => /seed/.test(e.textContent));
        if (!l) return null;
        const r = l.getBoundingClientRect();
        return { w: Math.round(r.width), lines: Math.round(r.height / 16) };
    });
    expect(seedLabel && seedLabel.lines <= 2,
        'the echoes seed label fits on a line instead of stacking one word per row',
        JSON.stringify(seedLabel));

    await p.close();
    await phone.close();
}

// ===================================================================
section('fullscreen, including where the api will not do it');
// ===================================================================
{
    const p = await open(BASE + '/');
    await clearDialogs(p);
    await p.evaluate(() => openSolitaire());
    await p.waitForTimeout(900);

    // Safari on iphone has never implemented requestFullscreen on an
    // element, so the button used to do nothing but apologise on the most
    // common device for playing a browser game. Take the api away and the
    // window should still go fullscreen.
    await p.evaluate(() => {
        const w = document.querySelector('.app-window');
        w.requestFullscreen = null;
        w.webkitRequestFullscreen = null;
        w.msRequestFullscreen = null;
        toggleWindowFullscreen(w);
    });
    await p.waitForTimeout(500);
    const fs = await p.evaluate(() => {
        const w = document.querySelector('.app-window');
        const r = w.getBoundingClientRect();
        return {
            active: w.classList.contains('fs-active'), faux: w.classList.contains('fs-faux'),
            locked: document.documentElement.classList.contains('fs-locked'),
            fillsW: Math.abs(r.width - innerWidth) < 2, fillsH: Math.abs(r.height - innerHeight) < 2,
            z: +getComputedStyle(w).zIndex
        };
    });
    expect(fs.active && fs.faux, 'with no api at all, the window still goes fullscreen');
    expect(fs.fillsW && fs.fillsH, 'and it fills the viewport', JSON.stringify(fs));
    expect(fs.locked, 'and nothing behind it scrolls');
    expect(fs.z > 9600, 'and nothing is drawn over it, not even the toasts', 'z ' + fs.z);

    // there is no escape key on a phone, but there is one here
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    const after = await p.evaluate(() => {
        const w = document.querySelector('.app-window');
        return {
            gone: !w || !w.classList.contains('fs-active'),
            unlocked: !document.documentElement.classList.contains('fs-locked'),
            stillOpen: !!w
        };
    });
    expect(after.gone && after.unlocked, 'escape leaves it', JSON.stringify(after));
    expect(after.stillOpen, 'and leaves the window it was showing open, rather than closing it');
    await p.close();
}

// ===================================================================
section('page errors');
// ===================================================================
// everything off this server is refused on purpose, so its failures are
// this suite's own doing and not the site's
const real = errors.filter(e => !/ERR_|Failed to load resource|net::/.test(e));
expect(!real.length, 'no javascript errors anywhere in the run',
    real.slice(0, 6).join('\n        '));

await browser.close();
// close() on its own waits for keep-alive sockets that nothing is going to
// close, so the run sat there for ten minutes after passing everything —
// which in CI is a green suite that reads as a hung job. Drop them and go.
if (pages.closeAllConnections) pages.closeAllConnections();
pages.close();

console.log('\n' + '='.repeat(58));
if (failures) {
    console.log(`${failures} of ${checks} browser checks FAILED`);
    process.exit(1);
}
console.log(`all ${checks} browser checks passed`);
process.exit(0);
