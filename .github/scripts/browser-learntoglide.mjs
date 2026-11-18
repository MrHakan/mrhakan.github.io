// browser-learntoglide.mjs - learn to glide 98 from the start menu: the how-to,
// a day flown with real keys, the hangar with real clicks, rockets on space,
// pause, minimise, a save across a reload, the wall smashed, and a phone with
// real touches. own static server, nothing from outside.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SHOTS = process.env.TMPDIR || '/tmp';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
let checks = 0;
const ok = msg => { checks++; console.log('  ok  ' + msg); };

async function desktop(options) {
    const ctx = await browser.newContext(options);
    await ctx.route('**/*', r => (r.request().url().startsWith(BASE) || r.request().url().startsWith('data:') ? r.continue() : r.abort()));
    await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (_) { /* blocked */ } });
    return ctx;
}
async function openGame(page) {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof startMenuAction === 'function');
    await page.evaluate(() => document.getElementById('boot-screen')?.remove());
    await page.evaluate(() => startMenuAction('learntoglide'));
    const win = page.locator('.app-window.framed-learntoglide-window');
    await win.waitFor({ timeout: 15000 });
    const iframe = win.locator('iframe.framed-game');
    await iframe.waitFor();
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.waitForFunction(() => window.LTG_ENGINE && document.readyState === 'complete');
    return { win, frame, iframe };
}
const E = (frame, fn, arg) => frame.evaluate(fn, arg);

try {
    // ------------------------------------------------------------ desktop
    const ctx = await desktop({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // blocked outside requests log 'Failed to load resource'; anything else is ours
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    let { win, frame } = await openGame(page);
    assert.equal(await page.locator('.app-window.framed-learntoglide-window').count(), 1);
    assert.equal(new URL(page.url()).searchParams.get('app'), 'learntoglide', 'the window has its own route');
    assert.equal(await frame.locator('.titlebar').isVisible(), false, 'embedded: the desktop owns the titlebar');
    ok('start menu opens learn to glide in one desktop popup window');

    // the how-to shows on a first visit, then the hangar
    await frame.getByRole('dialog', { name: 'how to play' }).waitFor();
    await frame.getByRole('button', { name: 'got it' }).click();
    await frame.getByRole('dialog', { name: 'hangar' }).waitFor();
    assert.equal(await E(frame, () => LTG_ENGINE.phase()), 'hangar');
    ok('first visit: how to play, then the hangar');
    await page.screenshot({ path: path.join(SHOTS, 'ltg-hangar.png') });

    // day one, flown with real keys
    await frame.getByRole('button', { name: /launch day 1/ }).click();
    await frame.waitForFunction(() => LTG_ENGINE.phase() === 'run' && LTG_ENGINE.run().phase === 'air', null, { timeout: 15000 });
    const p0 = await E(frame, () => LTG_ENGINE.run().pitch);
    await page.keyboard.down('ArrowUp'); await page.waitForTimeout(250); await page.keyboard.up('ArrowUp');
    const p1 = await E(frame, () => LTG_ENGINE.run().pitch);
    assert.ok(p1 > p0 + 0.1, 'arrow up noses up: ' + p0.toFixed(2) + ' -> ' + p1.toFixed(2));
    await page.keyboard.down('s'); await page.waitForTimeout(250); await page.keyboard.up('s');
    const p2 = await E(frame, () => LTG_ENGINE.run().pitch);
    assert.ok(p2 < p1 - 0.1, 's noses down');
    await page.screenshot({ path: path.join(SHOTS, 'ltg-flight.png') });
    ok('arrow up / s tilt the penguin in the air');
    await frame.getByRole('dialog', { name: 'day over' }).waitFor({ timeout: 20000 });
    const day1 = await E(frame, () => ({ day: LTG_ENGINE.game().day, money: LTG_ENGINE.game().money, best: LTG_ENGINE.game().best.distance }));
    assert.equal(day1.day, 1); assert.ok(day1.money > 0 && day1.best > 10, JSON.stringify(day1));
    assert.equal(await frame.locator('#money').textContent(), String(day1.money));
    assert.match(await frame.locator('#report-line').textContent(), /day 1: .*\+\$\d+/);
    ok('day one ends, pays $' + day1.money + ' for ' + day1.best.toFixed(0) + ' m, and the toolbar shows it');
    await page.screenshot({ path: path.join(SHOTS, 'ltg-report.png') });

    // the hangar with real clicks
    await frame.getByRole('button', { name: 'to the hangar' }).click();
    await frame.getByRole('dialog', { name: 'hangar' }).waitFor();
    await E(frame, () => LTG_ENGINE.setMoney(LTG_ENGINE.game().money + 200));
    const before = await E(frame, () => LTG_ENGINE.game().money);
    await frame.getByRole('button', { name: /^buy rockets \$120$/ }).click();
    await frame.getByRole('button', { name: /^buy glider \$70$/ }).click();
    const after = await E(frame, () => ({ money: LTG_ENGINE.game().money, levels: LTG_ENGINE.game().levels }));
    assert.equal(after.money, before - 190); assert.equal(after.levels.rocket, 1); assert.equal(after.levels.glider, 1);
    assert.equal(await frame.getByRole('button', { name: /^buy glider/ }).isDisabled(), true, 'cannot afford the next glider');
    ok('buying rockets and a glider with clicks spends $190 and greys out what is too dear');

    // day two: enter launches, space burns fuel
    await frame.locator('#view').focus();
    await page.keyboard.press('Enter');
    await frame.waitForFunction(() => LTG_ENGINE.run() && LTG_ENGINE.run().phase === 'air', null, { timeout: 15000 });
    const f0 = await E(frame, () => LTG_ENGINE.run().fuel);
    await page.keyboard.down(' '); await page.waitForTimeout(400);
    const boosting = await E(frame, () => LTG_ENGINE.run().boosting);
    await page.keyboard.up(' ');
    const f1 = await E(frame, () => LTG_ENGINE.run().fuel);
    assert.ok(boosting && f1 < f0 - 0.2, 'space burns fuel ' + f0 + ' -> ' + f1);
    ok('enter launches day two, holding space fires the rockets');

    // pause with the button, then a minimised window
    await frame.getByRole('button', { name: 'pause', exact: true }).click();
    const t0 = await E(frame, () => LTG_ENGINE.run().ticks);
    await page.waitForTimeout(300);
    assert.equal(await E(frame, () => LTG_ENGINE.run().ticks), t0, 'nothing moves while paused');
    await frame.getByRole('dialog', { name: 'paused' }).waitFor();
    await frame.locator('#resume').click();
    await frame.waitForFunction(t => LTG_ENGINE.run().ticks > t, t0);
    await page.evaluate(() => { document.querySelector('.framed-learntoglide-window').style.display = 'none'; });
    await frame.waitForFunction(() => LTG_ENGINE.paused());
    await page.evaluate(() => startMenuAction('learntoglide'));
    assert.equal(await page.locator('.framed-learntoglide-window').count(), 1, 'the start menu brings back the same window');
    assert.equal(await E(frame, () => LTG_ENGINE.paused()), true, 'and it waits for resume');
    await frame.locator('#view').focus();
    await page.keyboard.press('p');
    assert.equal(await E(frame, () => LTG_ENGINE.paused()), false);
    ok('pause button, minimising the window and p all pause and resume cleanly');
    await E(frame, () => LTG_ENGINE.setSpeed(8));
    await frame.getByRole('dialog', { name: 'day over' }).waitFor({ timeout: 30000 });
    assert.equal(await E(frame, () => LTG_ENGINE.game().day), 2);

    // the save survives a reload of the whole desktop
    const saved = await E(frame, () => JSON.stringify({ d: LTG_ENGINE.game().day, m: LTG_ENGINE.game().money, l: LTG_ENGINE.game().levels }));
    assert.ok(await page.evaluate(() => localStorage.getItem('mrhakan98-learntoglide-save')), 'the save is under the mrhakan98- prefix');
    await page.reload({ waitUntil: 'load' });
    ({ win, frame } = await openGame(page));
    await frame.getByRole('dialog', { name: 'hangar' }).waitFor();
    assert.equal(await E(frame, () => JSON.stringify({ d: LTG_ENGINE.game().day, m: LTG_ENGINE.game().money, l: LTG_ENGINE.game().levels })), saved);
    assert.equal(await frame.getByRole('dialog', { name: 'how to play' }).isVisible(), false, 'the how-to is not shown twice');
    ok('the season survives a reload: ' + saved);

    // the wall: a maxed hangar, the clock turned up and the pilot steering
    await E(frame, () => { LTG_ENGINE.setLevels({ ramp: 4, sled: 4, glider: 4, rocket: 4, payload: 4 }); LTG_ENGINE.setSpeed(16); LTG_ENGINE.autopilot(true); });
    await frame.getByRole('button', { name: /launch day 3/ }).click();
    await frame.getByRole('dialog', { name: 'day over' }).waitFor({ timeout: 40000 });
    assert.match(await frame.locator('#report-line').textContent(), /SMASHED/);
    await page.screenshot({ path: path.join(SHOTS, 'ltg-wall.png') });
    await frame.getByRole('button', { name: 'see the season' }).click();
    await frame.getByRole('dialog', { name: 'you broke the wall!' }).waitFor();
    assert.match(await frame.locator('#end-line').textContent(), /day 3.*gold medal/);
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('mrhakan98-learntoglide-records')));
    assert.equal(rec.bestDays, 3); assert.equal(rec.wins, 1);
    await frame.getByRole('button', { name: 'new season' }).last().click();
    await frame.getByRole('dialog', { name: 'hangar' }).waitFor();
    const fresh = await E(frame, () => ({ day: LTG_ENGINE.game().day, money: LTG_ENGINE.game().money, won: LTG_ENGINE.game().won }));
    assert.deepEqual(fresh, { day: 0, money: 0, won: false });
    ok('the ice wall smashed on day 3: gold medal, record saved, new season starts clean');
    assert.deepEqual(errors, [], 'no page errors on the desktop');
    ok('no page or console errors on the desktop');
    await ctx.close();

    // ------------------------------------------------------------ a lost season
    {
        const c = await desktop({ viewport: { width: 1024, height: 768 } });
        await c.addInitScript(() => { try { localStorage.setItem('mrhakan98-learntoglide-howto', '1'); localStorage.setItem('mrhakan98-learntoglide-save', JSON.stringify({ seed: 5, day: 29, money: 0, levels: {} })); } catch (_) { /* blocked */ } });
        const p = await c.newPage(), errs = [];
        p.on('pageerror', e => errs.push(e.message));
        const { frame: f } = await openGame(p);
        await E(f, () => LTG_ENGINE.setSpeed(16));
        await f.getByRole('button', { name: /launch day 30/ }).click();
        await f.getByRole('dialog', { name: 'day over' }).waitFor({ timeout: 30000 });
        await f.getByRole('button', { name: 'see the season' }).click();
        await f.getByRole('dialog', { name: 'season over' }).waitFor();
        assert.match(await f.locator('#end-line').textContent(), /wall still stands/);
        assert.deepEqual(errs, []);
        ok('day 30 without the wall: the season is lost');
        await c.close();
    }

    // ------------------------------------------------------------ blocked storage
    {
        const c = await desktop({ viewport: { width: 1024, height: 768 } });
        const p = await c.newPage(), errs = [];
        p.on('pageerror', e => errs.push(e.message));
        await p.addInitScript(() => {
            if (location.pathname.includes('learn-to-glide')) {
                Storage.prototype.getItem = () => { throw new Error('storage blocked'); };
                Storage.prototype.setItem = () => { throw new Error('storage blocked'); };
            }
        });
        await p.goto(BASE + '/games/learn-to-glide/', { waitUntil: 'load' });
        await p.getByRole('button', { name: 'got it' }).click();
        await p.evaluate(() => LTG_ENGINE.setSpeed(16));
        await p.getByRole('button', { name: /launch day 1/ }).click();
        await p.getByRole('dialog', { name: 'day over' }).waitFor({ timeout: 30000 });
        assert.equal(await p.evaluate(() => LTG_ENGINE.game().day), 1);
        assert.equal(await p.locator('.titlebar').isVisible(), true, 'standalone page shows its own titlebar');
        assert.deepEqual(errs, []);
        ok('blocked storage: a day still flies and pays, standalone page keeps its chrome');
        await c.close();
    }

    // ------------------------------------------------------------ phone
    {
        const c = await desktop({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
        await c.addInitScript(() => { try { localStorage.setItem('mrhakan98-learntoglide-howto', '1'); } catch (_) { /* blocked */ } });
        const p = await c.newPage(), errs = [];
        p.on('pageerror', e => errs.push(e.message));
        const { frame: f, iframe } = await openGame(p);
        await f.getByRole('dialog', { name: 'hangar' }).waitFor();
        const launchBtn = f.getByRole('button', { name: /launch day 1/ });
        await launchBtn.scrollIntoViewIfNeeded();
        let b = await launchBtn.boundingBox();
        await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
        await f.waitForFunction(() => LTG_ENGINE.run() && LTG_ENGINE.run().phase === 'air', null, { timeout: 15000 });
        await p.screenshot({ path: path.join(SHOTS, 'ltg-phone.png') });
        // hold the up pad with a real finger
        const cdp = await c.newCDPSession(p);
        const up = f.getByRole('button', { name: 'nose up' });
        await up.scrollIntoViewIfNeeded();
        b = await up.boundingBox();
        const q0 = await E(f, () => LTG_ENGINE.run().pitch);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
        await p.waitForTimeout(300);
        const mid = await E(f, () => LTG_ENGINE.held().up);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const q1 = await E(f, () => LTG_ENGINE.run().pitch);
        assert.ok(mid && q1 > q0 + 0.1, 'a finger on the up pad noses up ' + q0.toFixed(2) + ' -> ' + q1.toFixed(2));
        assert.equal(await E(f, () => LTG_ENGINE.held().up), false, 'and lifting it stops');
        const widths = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
        const inner = await E(f, () => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
        assert.ok(widths.s <= widths.c + 1, 'desktop page does not widen: ' + JSON.stringify(widths));
        assert.ok(inner.s <= inner.c + 1, 'game page does not widen: ' + JSON.stringify(inner));
        const frameBox = await iframe.boundingBox();
        assert.ok(frameBox.width <= 390, 'the game window fits the phone');
        await E(f, () => LTG_ENGINE.setSpeed(16));
        await f.getByRole('dialog', { name: 'day over' }).waitFor({ timeout: 30000 });
        const toShop = f.getByRole('button', { name: 'to the hangar' });
        await toShop.scrollIntoViewIfNeeded();
        b = await toShop.boundingBox();
        await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
        await f.getByRole('dialog', { name: 'hangar' }).waitFor();
        const inner2 = await E(f, () => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
        assert.ok(inner2.s <= inner2.c + 1, 'the hangar fits the phone: ' + JSON.stringify(inner2));
        await p.screenshot({ path: path.join(SHOTS, 'ltg-phone-hangar.png') });
        assert.deepEqual(errs, []);
        ok('390x844 phone: real taps launch and steer, a day ends, nothing overflows sideways');
        await c.close();
    }
} finally {
    await browser.close();
    server.close();
}
console.log(checks + ' learntoglide browser checks passed');
