// ===================================================================
// browser-scale.mjs — the auto scaler and the news panel, on real screens
//
// A scale that is wrong by a little looks fine in a screenshot and drags a
// window away from the cursor. So this sizes the viewport like the screens
// people have, moves a real mouse by a known number of real pixels, and checks
// where things landed. js/scale.js says why it works the way it does.
//
// It brings its own server, so a stale one cannot answer for it, and no request
// leaves the machine, so the real visitor counter is left alone.
//
//   node .github/scripts/browser-scale.mjs
//   SCALE_BROWSER=firefox node .github/scripts/browser-scale.mjs
// ===================================================================
import * as playwright from 'playwright';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.SCALE_SHOTS || path.join(ROOT, '.ci-shots');
const ENGINE = process.env.SCALE_BROWSER || 'chromium';
const CHROMIUM = ENGINE === 'chromium';
fs.mkdirSync(SHOTS, { recursive: true });

let checks = 0, failures = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance;

// ---------- a server that answers the way github pages does ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'text/xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, clean);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not here'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const browser = await playwright[ENGINE].launch();
const errors = [];

async function context(options, { boot = true } = {}) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', ...options });
    await ctx.route('**/*', route => route.request().url().startsWith(BASE) ? route.continue() : route.abort());
    if (boot) await ctx.addInitScript(() => {
        try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); } catch (e) { }
    });
    return ctx;
}

async function open(ctx, url = '/') {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(url + ': ' + e.message));
    p.on('dialog', d => d.dismiss());
    await p.goto(BASE + url, { waitUntil: 'load' });
    await p.evaluate(() => {
        const boot = document.getElementById('boot-screen');
        if (boot) boot.remove();
        window.soundEnabled = false;
        try { localStorage.setItem('sound', 'off'); } catch (e) { }
    });
    await p.waitForTimeout(250);
    return p;
}

// what the screen is doing, in real pixels and in the ones the page was told about
const layout = p => p.evaluate(() => {
    const root = document.documentElement;
    const zoom = parseFloat(root.style.zoom) || 1;
    const box = sel => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
        zoom,
        z: getComputedStyle(root).getPropertyValue('--z').trim(),
        reported: window.SCALE ? SCALE.scale : null,
        innerWidth, innerHeight,
        clientWidth: root.clientWidth,
        dpr: devicePixelRatio,
        scrollX: root.scrollWidth - root.clientWidth,
        bodyScroll: document.body.scrollWidth - document.body.clientWidth,
        taskbar: box('#taskbar'), main: box('#main-window'), news: box('#news-panel'),
        concert: box('#winamp-concert'), playlist: box('#winamp-playlist'), shoutForm: box('[data-board="shouts"] button'),
        sidebar: box('#desk-sidebar'), status: box('#ie-status'), enter: box('#section-home button'), winamp: box('#winamp-window'), shoutbox: box('#shoutbox-window'),
        mainBody: box('#main-window .bevel-in.flex-1')
    };
});

// ===================================================================
section('the scale is whatever brings the screen down to the reference');
// ===================================================================
const SCREENS = [
    ['2560x1440', 2560, 1440, 1.5],
    ['2560x1440 with a browser around it', 2560, 1380, 1.43],
    ['3840x2160', 3840, 2160, 2.25],
    ['1920x1080', 1920, 1080, 1.12],
    ['1920x1080 with a browser around it', 1920, 950, 1],
    ['1366x768', 1366, 768, 1],
    ['1280x720', 1280, 720, 1],
    ['an ultrawide', 3440, 1440, 1.5]
];
for (const [name, width, height, scale] of SCREENS) {
    const ctx = await context({ viewport: { width, height } });
    const p = await open(ctx);
    const l = await layout(p);
    expect(near(l.zoom, scale, 0.001) && l.reported === scale, name + ' scales by ' + scale, 'got ' + l.zoom);
    expect(near(l.innerWidth, Math.round(width / scale), 1) && near(l.clientWidth, l.innerWidth, 1),
        'the page is told its viewport is ' + Math.round(width / scale) + ' wide', l.innerWidth + ' / ' + l.clientWidth);
    expect(near(l.sidebar.width, 256, 2), 'a rem is still 16 of the page\'s pixels, in every engine', l.sidebar.width);
    expect(l.scrollX <= 1 && l.bodyScroll <= 1, 'nothing scrolls sideways', l.scrollX + ' / ' + l.bodyScroll);
    expect(l.taskbar && near(l.taskbar.bottom, height / scale, 2), 'the taskbar is on the bottom of the screen',
        l.taskbar && l.taskbar.bottom + ' of ' + height / scale);
    expect(l.main.right <= l.innerWidth + 1 && l.main.bottom <= l.innerHeight + 1, 'and the main window fits above it', JSON.stringify(l.main));
    if (scale === 1) expect(l.dpr === 1 && l.z === '1', 'and at 1 nothing is touched', l.dpr + ' ' + l.z);
    if (width >= 1920 && height >= 960) {
        for (const [what, b] of [['the concert button', l.concert], ['the shout button', l.shoutForm], ['the status bar', l.status]]) {
            expect(b && b.bottom <= l.innerHeight - 30 && b.height > 0, what + ' is on screen, above the taskbar', b && Math.round(b.bottom) + ' of ' + l.innerHeight);
        }
        expect(l.playlist.height >= 60, 'the playlist keeps some rows', Math.round(l.playlist.height) + 'px');
        expect(l.shoutbox.height >= 250, 'and the shoutbox some room', Math.round(l.shoutbox.height) + 'px');
    }
    if (width === 2560 && height === 1440) await p.screenshot({ path: path.join(SHOTS, 'scale-2560x1440.png') });
    if (width === 2560 && height === 1380) await p.screenshot({ path: path.join(SHOTS, 'scale-2560x1380.png') });
    if (width === 1920 && height === 1080) await p.screenshot({ path: path.join(SHOTS, 'scale-1920x1080.png') });
    if (width === 1366) await p.screenshot({ path: path.join(SHOTS, 'scale-1366x768.png') });
    await ctx.close();
}

// ===================================================================
section('it lands before the first paint, and nothing jumps');
// ===================================================================
{
    const ctx = await context({ viewport: { width: 2560, height: 1440 } });
    await ctx.addInitScript(() => {
        const root = document.documentElement;
        new MutationObserver((_, o) => {
            if (!document.body) return;
            window.__zoomAtBody = document.documentElement.style.zoom;
            o.disconnect();
        }).observe(root || document, { childList: true, subtree: true });
        window.__shift = 0;
        if (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
            new PerformanceObserver(list => { for (const e of list.getEntries()) window.__shift += e.value; })
                .observe({ type: 'layout-shift', buffered: true });
        }
    });
    const p = await open(ctx);
    await p.waitForTimeout(1500);
    expect(await p.evaluate(() => window.__zoomAtBody) === '1.5', 'the zoom is set before <body> exists');
    const shift = await p.evaluate(() => window.__shift);
    expect(shift < 0.03, 'the page does not shift as it loads', shift.toFixed(4));
    await ctx.close();
}

// ===================================================================
section('a window follows a real mouse at 1.5');
// ===================================================================
{
    const ctx = await context({ viewport: { width: 2560, height: 1440 } });
    const p = await open(ctx);

    async function dragChecks(name, header, win) {
        const h = await p.locator(header).boundingBox();
        const before = await p.locator(win).boundingBox();
        const x = h.x + 60, y = h.y + h.height / 2;
        await p.mouse.move(x, y);
        await p.mouse.down();
        await p.mouse.move(x + 150, y + 60, { steps: 4 });
        await p.mouse.move(x + 300, y + 120, { steps: 4 });
        await p.mouse.up();
        const after = await p.locator(win).boundingBox();
        expect(near(after.x - before.x, 300) && near(after.y - before.y, 120), name + ' moved exactly as far as the mouse',
            Math.round(after.x - before.x) + ',' + Math.round(after.y - before.y) + ' for 300,120');
    }

    await p.evaluate(() => openMinesweeper());
    await p.waitForSelector('.app-window .ms-cell');
    await p.waitForTimeout(400);
    await dragChecks('an app window', '.app-window .app-window-header', '.app-window');
    await dragChecks('the main window', '#draggable-header', '#main-window');
    await dragChecks('winamp', '#winamp-header', '#winamp-window');

    // a cell is hit where it is drawn
    const cell = p.locator('.app-window .ms-cell').nth(40);
    const cellBox = await cell.boundingBox();
    await p.mouse.click(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
    await p.waitForTimeout(100);
    const revealed = await p.evaluate(() => [...document.querySelectorAll('.app-window .ms-cell')].filter(c => /open|revealed/.test(c.className)).length);
    expect(revealed > 0, 'minesweeper opens the cell under the cursor', revealed + ' open');

    await p.evaluate(() => document.querySelectorAll('.app-window').forEach(w => w.remove()));
    await ctx.close();
}

// ===================================================================
section('what the mouse reports, against where things are');
// ===================================================================
{
    const ctx = await context({ viewport: { width: 2560, height: 1440 } });
    const p = await open(ctx);

    // the right click menu opens under the pointer
    await p.mouse.click(2100, 150, { button: 'right' });
    await p.waitForTimeout(100);
    const menu = await p.locator('.open[id*="menu"], .desk-menu.open, #desktop-context.open').first().boundingBox().catch(() => null);
    expect(menu && near(menu.x, 2100, 4) && near(menu.y, 150, 4), 'the right click menu opens under the pointer', menu && Math.round(menu.x) + ',' + Math.round(menu.y));
    await p.mouse.click(1000, 1300);

    // a click on a canvas lands on the bitmap pixel under it
    await p.evaluate(() => openPaint());
    await p.waitForSelector('.app-window canvas');
    await p.waitForTimeout(400);
    const paintAt = async (fx, fy) => {
        const c = await p.locator('.app-window canvas').boundingBox();
        const x = c.x + c.width * fx, y = c.y + c.height * fy;
        await p.mouse.move(x, y);
        await p.mouse.down();
        await p.mouse.move(x + 1, y + 1);
        await p.mouse.up();
        return p.evaluate(([fx, fy]) => {
            const cv = document.querySelector('.app-window canvas'), g = cv.getContext('2d');
            const d = g.getImageData(Math.round(cv.width * fx), Math.round(cv.height * fy), 1, 1).data;
            const far = g.getImageData(Math.round(cv.width * (1 - fx)), Math.round(cv.height * (1 - fy)), 1, 1).data;
            return { here: [d[0], d[1], d[2]], there: [far[0], far[1], far[2]] };
        }, [fx, fy]);
    };
    const drawn = await paintAt(0.25, 0.3);
    expect(drawn.here.join() !== drawn.there.join(), 'paint draws where the pointer is', drawn.here + ' against ' + drawn.there);

    // ...and again with the window fullscreen, where the canvas is scaled by hand
    if (CHROMIUM) {
        await p.locator('.app-window .fs-btn').click();
        await p.waitForTimeout(500);
        const fs = await p.evaluate(() => {
            const w = document.querySelector('.app-window');
            const r = w.getBoundingClientRect();
            return { active: w.classList.contains('fs-active'), w: r.width * SCALE.scale, h: r.height * SCALE.scale, left: r.left };
        });
        expect(fs.active && near(fs.w, 2560, 4) && near(fs.h, 1440, 4), 'a fullscreen window fills the screen', Math.round(fs.w) + 'x' + Math.round(fs.h));
        const again = await paintAt(0.7, 0.6);
        expect(again.here.join() !== again.there.join(), 'and paint still draws where the pointer is', again.here + ' against ' + again.there);
        await p.locator('.app-window .fs-btn').click();
        await p.waitForTimeout(300);
    }

    // maximize is a width in vw, which is the kind of thing zoom doubles
    await p.locator('.app-window [title="maximize"]').click();
    const max = await p.locator('.app-window').boundingBox();
    // .app-window caps itself at 96vw, at every scale
    expect(near(max.x, 0) && near(max.width, 2560 * 0.96, 4), 'maximize takes the same share of the screen as it does at 100%', Math.round(max.width));
    await p.evaluate(() => document.querySelectorAll('.app-window').forEach(w => w.remove()));

    // a native control is the browser's own arithmetic
    const vol = await p.locator('#winamp-volume').boundingBox();
    await p.mouse.click(vol.x + vol.width / 2, vol.y + vol.height / 2);
    const volume = await p.evaluate(() => +document.getElementById('winamp-volume').value);
    expect(near(volume, 50, 6), 'winamp volume lands in the middle when clicked in the middle', volume);

    // the start menu opens on the screen, and takes a click
    await p.locator('#start-button, #taskbar button').first().click();
    await p.waitForTimeout(200);
    const sm = await p.locator('#start-menu').boundingBox();
    expect(sm && sm.y >= 0 && near(sm.y + sm.height, 1440 - 40 * 1.5, 12), 'the start menu sits on the taskbar', sm && Math.round(sm.y + sm.height));
    await p.keyboard.press('Escape');
    await p.mouse.click(1000, 1300);

    // a canvas game, and a real pointer event on its lane
    await p.evaluate(() => startMenuAction('ageoftroll'));
    await p.waitForSelector('.aot-menu', { timeout: 20000 });
    await p.selectOption('#aot-diff', 'easy');
    await p.click('#aot-solo');
    await p.waitForSelector('#aot-canvas', { timeout: 10000 });
    await p.waitForTimeout(400);
    await p.evaluate(() => {
        const cv = document.querySelector('#aot-canvas');
        window.__at = null;
        cv.addEventListener('pointerdown', e => {
            const r = cv.getBoundingClientRect();
            window.__at = { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, w: cv.clientWidth, rw: r.width };
        }, true);
    });
    const lane = await p.locator('#aot-canvas').boundingBox();
    await p.mouse.click(lane.x + lane.width * 0.3, lane.y + lane.height * 0.4);
    const at = await p.evaluate(() => window.__at);
    expect(at && near(at.fx, 0.3, 0.01) && near(at.fy, 0.4, 0.02), 'age of troll reads a click where it was made', at && at.fx.toFixed(3) + ',' + at.fy.toFixed(3));
    expect(at && near(at.w, at.rw, 1), 'and the page\'s own two ways of measuring the lane agree', at && at.w + ' / ' + at.rw);
    await p.screenshot({ path: path.join(SHOTS, 'scale-age-of-troll.png') });
    await ctx.close();
}

// ===================================================================
section('concert mode is a canvas the size of the screen');
// ===================================================================
{
    const ctx = await context({ viewport: { width: 2560, height: 1440 } });
    const p = await open(ctx);
    await p.locator('#winamp-concert').click();
    await p.waitForSelector('body.concert-mode');
    await p.waitForTimeout(800);
    const stage = await p.evaluate(() => {
        const c = document.querySelector('.music-stage-canvas'), w = document.getElementById('winamp-window');
        const r = c.getBoundingClientRect(), b = w.getBoundingClientRect();
        return { w: r.width * SCALE.scale, h: r.height * SCALE.scale, bitmap: c.width, winampBottom: b.bottom, height: innerHeight, winampHeight: b.height };
    });
    expect(near(stage.w, 2560, 4) && near(stage.h, 1440, 4), 'the stage fills 2560x1440', Math.round(stage.w) + 'x' + Math.round(stage.h));
    expect(stage.winampBottom <= stage.height && stage.winampHeight > 100, 'and winamp is on it', Math.round(stage.winampBottom) + ' of ' + stage.height);
    await p.screenshot({ path: path.join(SHOTS, 'scale-concert.png') });
    await p.keyboard.press('Escape');
    await ctx.close();
}

// ===================================================================
section('the window changes size, and the browser zoom changes');
// ===================================================================
{
    const ctx = await context({ viewport: { width: 2560, height: 1440 } });
    const p = await open(ctx);
    const size = async (width, height, expected, note) => {
        await p.setViewportSize({ width, height });
        await p.waitForTimeout(250);
        const l = await layout(p);
        expect(near(l.zoom, expected, 0.001) && near(l.taskbar.bottom, height / expected, 2) && l.scrollX <= 1,
            note + ': ' + width + 'x' + height + ' is ' + expected, l.zoom + ', taskbar at ' + Math.round(l.taskbar.bottom));
        return l;
    };
    const atFull = await size(2560, 1440, 1.5, 'start');
    // ctrl+plus to 150% on that screen is what the page sees as this: the viewport
    // comes down to 1707, and only that. Nobody here is told it was a key press.
    const at150 = await size(1707, 960, 1, 'the browser taken to 150%');
    expect(near(at150.main.width, atFull.main.width, 2), 'the browser at 150% gets the same layout, not twice the size',
        Math.round(at150.main.width) + ' against ' + Math.round(atFull.main.width));
    await size(2048, 1152, 1.2, 'the browser at 125%');
    await size(5120, 2880, 3, 'the browser at 50%');
    await size(1000, 700, 1, 'a small window');
    await size(2560, 1440, 1.5, 'and back');

    // the taps a canvas listens for still have to line up after all of that
    await p.evaluate(() => openPaint());
    await p.waitForSelector('.app-window canvas');
    await p.waitForTimeout(400);
    const c = await p.locator('.app-window canvas').boundingBox();
    expect(near(c.width, await p.evaluate(() => document.querySelector('.app-window canvas').offsetWidth * SCALE.scale), 2),
        'a window opened afterwards is measured at the new scale');
    await ctx.close();
}

// ===================================================================
section('it can be turned off, and that sticks');
// ===================================================================
{
    const ctx = await context({ viewport: { width: 2560, height: 1440 } });
    const p = await open(ctx);
    await p.evaluate(() => openControlPanel());
    await p.waitForSelector('#cp-scale');
    expect(await p.isChecked('#cp-scale'), 'display properties has it ticked');
    await p.uncheck('#cp-scale');
    await p.waitForTimeout(150);
    let l = await layout(p);
    expect(l.zoom === 1 && l.innerWidth === 2560 && near(l.taskbar.bottom, 1440, 2), 'unticking it puts the page back to 100%', l.zoom + ', ' + l.innerWidth);
    await p.reload();
    await p.waitForTimeout(250);
    l = await layout(p);
    expect(l.zoom === 1, 'and a reload does not bring it back', l.zoom);
    await p.evaluate(() => { document.getElementById('boot-screen')?.remove(); openControlPanel(); });
    await p.waitForSelector('#cp-scale');
    await p.check('#cp-scale');
    await p.waitForTimeout(150);
    l = await layout(p);
    expect(l.zoom === 1.5, 'ticking it brings it back', l.zoom);
    await ctx.close();
}

// ===================================================================
section('the guestbook and the links page');
// ===================================================================
{
    const ctx = await context({ viewport: { width: 2560, height: 1440 } });
    const p = await open(ctx);
    await p.evaluate(() => showSection('guestbook'));
    await p.waitForSelector('#guestbook-frame');
    await p.waitForTimeout(800);
    const frame = p.frameLocator('#guestbook-frame');
    const inner = await frame.locator('html').evaluate(root => ({
        zoom: root.style.zoom, z: getComputedStyle(root).getPropertyValue('--z').trim(), scale: window.SCALE && SCALE.scale,
        scrollX: root.scrollWidth - root.clientWidth,
        form: !!document.querySelector('form')
    }));
    if (CHROMIUM) expect(inner.zoom === '' && inner.z === '1' && inner.scale === 1, 'the embedded guestbook does not scale itself on top', JSON.stringify(inner));
    // the same form on the same screen, whichever engine zoomed it
    const share = await frame.locator('input:not([type="hidden"])').first().evaluate(el => el.getBoundingClientRect().width / innerWidth);
    expect(share > 0.8, 'the embedded form fills its frame, rather than sitting small in the middle of it', share.toFixed(2));
    expect(inner.scrollX <= 1 && inner.form, 'and it fits its frame, with its form', inner.scrollX);
    const fb = await p.locator('#guestbook-frame').boundingBox();
    const box = await p.locator('#main-window').boundingBox();
    expect(fb.width > 900 && fb.x + fb.width <= box.x + box.width + 1, 'the frame sits inside the window', Math.round(fb.width) + ' wide');
    await p.screenshot({ path: path.join(SHOTS, 'scale-guestbook.png') });
    await ctx.close();

    for (const page of ['guestbook.html', 'links.html']) {
        const c2 = await context({ viewport: { width: 2560, height: 1440 } });
        const q = await open(c2, '/' + page);
        const l = await layout(q);
        expect(l.zoom === 1.5 && l.scrollX <= 1, page + ' on its own scales the same way, and does not scroll sideways', l.zoom + ', ' + l.scrollX);
        const fits = await q.evaluate(() => {
            const body = document.body;
            return getComputedStyle(body).overflowY === 'hidden'
                ? document.querySelector('.container').getBoundingClientRect().bottom <= innerHeight + 1
                : true;
        });
        expect(fits, 'and fits the height it is given');
        await q.screenshot({ path: path.join(SHOTS, 'scale-' + page + '.png') });
        await c2.close();
    }
}

// ===================================================================
section('what is new');
// ===================================================================
const news = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/news.json'), 'utf8'));
{
    const ctx = await context({ viewport: { width: 2560, height: 1440 } });
    const p = await open(ctx);
    await p.waitForSelector('#news-panel:not([hidden]) .news-item');
    const shown = await p.evaluate(() => [...document.querySelectorAll('.news-item')].map(i => ({
        title: i.querySelector('h3').firstChild.textContent, text: i.querySelector('p').textContent, button: i.querySelector('.news-btn').textContent.trim()
    })));
    expect(shown.length === Math.min(news.length, 5), 'it shows the first lines of data/news.json', shown.length + ' rows');
    expect(shown[0].title === news[0].title && shown[0].text === news[0].text, 'in that order', shown[0].title);
    expect(shown[0].button.startsWith(news[0].button), 'each with a button that says what it does', shown[0].button);

    let l = await layout(p);
    expect(l.news.top >= l.enter.bottom, 'under the hello block and its enter button', Math.round(l.news.top) + ' under ' + Math.round(l.enter.bottom));
    expect(l.news.bottom <= l.mainBody.bottom, 'and all of it is visible without scrolling at 2560x1440', Math.round(l.news.bottom) + ' of ' + Math.round(l.mainBody.bottom));

    // every button really opens its thing
    // there can be more than one line about it, and they all open the same window
    await p.locator('.news-item', { hasText: 'age of troll' }).locator('button.news-btn').first().click();
    await p.waitForSelector('.aot-menu', { timeout: 20000 });
    expect(true, 'play now on age of troll opens age of troll');
    await p.evaluate(() => document.querySelectorAll('.app-window').forEach(w => w.remove()));

    // the panel shows the top five, so those are the ones with a button to press
    for (const item of news.slice(0, 5).filter(i => i.url)) {
        const [popup] = await Promise.all([
            p.context().waitForEvent('page'),
            p.locator('.news-item', { hasText: item.title }).locator('a.news-btn').click()
        ]);
        const res = await popup.waitForLoadState('domcontentloaded').then(() => popup.evaluate(() => ({ path: location.pathname, title: document.title, h: document.body.textContent.length })));
        expect(res.path === item.url && res.h > 50, item.title + ' opens ' + item.url, res.title);
        await popup.close();
    }

    await p.locator('.news-foot .news-btn').click();
    await p.waitForFunction(() => [...document.querySelectorAll('.app-window-title')].some(t => /changelog/i.test(t.textContent)));
    expect(true, 'the whole changelog is one more click');
    await ctx.close();
}

// a new line is all it takes, and what is in the file is treated as text
{
    const ctx = await context({ viewport: { width: 1366, height: 768 } });
    await ctx.route('**/data/news.json', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
            { date: '2026-01-01', icon: '<b>', title: 'one <img src=x onerror="window.__xss=1">', text: 'a <script>', button: 'go', app: 'minesweeper' },
            { date: '2026-01-01', title: 'nowhere', text: 'opens nothing' },
            { date: '2026-01-01', title: 'evil', text: 'a scheme', url: 'javascript:window.__xss=1' },
            ...Array.from({ length: 8 }, (_, i) => ({ date: '2026-01-01', title: 'filler ' + i, text: 'x', url: '/games/flood-tiles/' }))
        ])
    }));
    const p = await open(ctx);
    await p.waitForSelector('#news-panel:not([hidden]) .news-item');
    const r = await p.evaluate(() => ({
        rows: document.querySelectorAll('.news-item').length,
        xss: window.__xss, images: document.querySelectorAll('.news-item img').length,
        first: document.querySelector('.news-item h3').textContent,
        titles: [...document.querySelectorAll('.news-item h3')].map(h => h.textContent).join()
    }));
    expect(r.rows === 5, 'it stops at five rows', r.rows);
    expect(!r.xss && !r.images && r.first.includes('<img'), 'markup in the file stays text', r.first);
    expect(!/nowhere|evil/.test(r.titles), 'a line that opens nothing, or opens a javascript: url, is left out', r.titles);
    await p.locator('.news-item button.news-btn').first().click();
    await p.waitForSelector('.ms-cell');
    expect(true, 'and an app line opens through the same table as the start menu');
    await ctx.close();
}

// a file that is not there or not json: the home page is what it always was
for (const [name, handler] of [['missing', r => r.fulfill({ status: 404, body: 'no' })], ['broken', r => r.fulfill({ contentType: 'application/json', body: '{nope' })]]) {
    const ctx = await context({ viewport: { width: 1366, height: 768 } });
    await ctx.route('**/data/news.json', handler);
    const p = await open(ctx);
    await p.waitForTimeout(300);
    expect(await p.evaluate(() => document.getElementById('news-panel').hidden), 'a ' + name + ' file leaves the panel hidden, not empty');
    await ctx.close();
}

// ===================================================================
section('a phone is not touched');
// ===================================================================
if (CHROMIUM) {
    for (const [name, opts] of [
        ['a phone', { ...playwright.devices['Pixel 7'] }],
        ['a phone on its side', { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true }],
        ['a big tablet', { viewport: { width: 2000, height: 1300 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }]
    ]) {
        const ctx = await context(opts);
        const p = await open(ctx);
        const l = await layout(p);
        expect(l.zoom === 1 && l.z === '1' && l.reported === 1, name + ' never scales', l.zoom);
        expect(l.scrollX <= 0, 'and does not scroll sideways', l.scrollX);
        await p.waitForSelector('#news-panel:not([hidden]) .news-item');
        const news2 = await layout(p);
        expect(news2.news.width > 0 && news2.news.right <= news2.innerWidth + 1, 'the news panel fits it', Math.round(news2.news.width) + ' of ' + news2.innerWidth);
        if (name === 'a phone') {
            const small = await p.evaluate(() => [...document.querySelectorAll('.news-btn')].filter(b => b.getBoundingClientRect().height < 40).length);
            expect(small === 0, 'its buttons are big enough for a finger', small + ' too small');
            await p.locator('#news-panel').scrollIntoViewIfNeeded();
            await p.screenshot({ path: path.join(SHOTS, 'scale-phone.png') });
            await p.locator('.news-item', { hasText: 'age of troll' }).locator('button.news-btn').first().tap();
            await p.waitForSelector('.aot-menu', { timeout: 20000 });
            expect(true, 'and a tap opens the game');
        }
        await ctx.close();
    }
} else {
    console.log('  (skipped: only chromium emulates a phone here)');
}

section('and nothing threw');
const real = errors.filter(e => !/net::|Failed to fetch|Load failed|NetworkError/i.test(e));
expect(!real.length, 'no page raised an error', real.slice(0, 6).join(' | '));

await browser.close();
server.close();
console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
