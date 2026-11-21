// browser-classics.mjs — the games flyout spills into columns, and every new entry opens a desktop popup.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL  ') + m); if (!c) fail++; };
try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route('**/*', r => r.request().url().startsWith(BASE) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
    await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (_) {} });
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForFunction(() => typeof startMenuAction === 'function');
    await p.evaluate(() => document.getElementById('boot-screen')?.remove());
    await p.click('#start-button').catch(() => p.evaluate(() => document.querySelector('[onclick*="toggleStartMenu"], #start-btn')?.click()));
    const games = p.locator('.start-sub', { has: p.locator('.has-sub', { hasText: 'games' }) }).first();
    await games.locator('.has-sub').hover();
    await p.waitForTimeout(300);
    const box = await games.locator('.start-flyout').evaluate(f => { const r = f.getBoundingClientRect(); const cols = new Set([...f.querySelectorAll(':scope > .start-item')].map(b => Math.round(b.getBoundingClientRect().left))); const bar = document.getElementById('taskbar')?.getBoundingClientRect().top ?? innerHeight; return { display: getComputedStyle(f).display, cols: cols.size, bottom: r.bottom, bar, right: r.right, width: innerWidth }; });
    console.log(JSON.stringify(box));
    ok(box.display === 'grid' && box.cols >= 2, 'the games flyout spills into ' + box.cols + ' columns to the right');
    ok(box.bottom <= box.bar + 1, 'and stays above the taskbar');
    ok(box.right <= box.width, 'and inside the screen');
    await p.screenshot({ path: process.env.SHOT || path.join(process.env.TMPDIR || '/tmp', 'classics-flyout.png') });
    // Each game is opened once, on its first use in this page: that is the only
    // time its loading window exists (a second open finds start* defined and
    // skips it), so it is the only time the handoff can leave one behind.
    // A closing window is id-less for its ~110 ms fade, hence a wait, not a count.
    for (const key of ['okey', 'kartz', 'tavla', 'lavatide', 'popz', 'goldclaw', 'pizzashift', 'learntoglide', 'blockroll', 'deepdrill']) {
        const live = () => [...document.querySelectorAll('.app-window[id]')].filter(w => !w.querySelector('.bj-loading')).length;
        const before = await p.evaluate(live);
        await p.evaluate(k => startMenuAction(k), key);
        const sawLoading = await p.waitForFunction(() => document.querySelector('.bj-loading'), null, { timeout: 2000 }).then(() => true, () => false);
        const opened = await p.waitForFunction(n => [...document.querySelectorAll('.app-window[id]')].filter(w => !w.querySelector('.bj-loading')).length > n, before, { timeout: 15000 }).then(() => true, () => false);
        const title = await p.locator('.app-window[id]').last().locator('.app-window-title').first().textContent().catch(() => '');
        ok(opened, key + ' opens a desktop popup: ' + title.trim().slice(0, 40));
        ok(sawLoading, key + ' showed its loading window first (so the handoff was exercised)');
        const cleared = await p.waitForFunction(() => !document.querySelector('.bj-loading') && !document.querySelector('.app-window:not([id])'), null, { timeout: 2000 }).then(() => true, () => false);
        const left = await p.evaluate(() => [...document.querySelectorAll('.app-window')].map(w => (w.id || '(no id)') + ':' + (w.querySelector('.bj-loading')?.textContent || '')).join(', '));
        ok(cleared, key + ' leaves no loading window behind  [' + left + ']');
    }
    ok(!errors.length, 'no page errors ' + errors.join(' | '));
} finally { await browser.close(); server.close(); }
process.exit(fail ? 1 : 0);
