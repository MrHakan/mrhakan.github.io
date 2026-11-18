// browser-pizzashift.mjs: pizza shift 98 played for real in chromium. Opens it from the
// start menu as a desktop popup, plays a whole first day with the mouse (perfect pizzas),
// a pizza with the keyboard only, taps on a phone, checks the save survives a reload,
// minimising pauses, a failed day, corrupt and blocked storage, and zero page errors.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const SAVE = 'mrhakan98-pizzashift-save';
const browser = await chromium.launch({ headless: true });
let checks = 0;
const ok = msg => { checks++; console.log('ok - ' + msg); };

async function context(opts = {}) {
    const ctx = await browser.newContext(opts);
    await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(BASE) || u.startsWith('data:') ? r.continue() : r.abort(); });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (_) { } });
    return ctx;
}
function watch(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
    return errors;
}
// open the desktop, launch from the start menu, return the game frame
async function openOnDesktop(page) {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof startMenuAction === 'function');
    await page.evaluate(() => document.getElementById('boot-screen')?.remove());
    const before = await page.locator('.app-window').count();
    await page.evaluate(() => startMenuAction('pizzashift'));
    await page.locator('.framed-pizzashift-window iframe.framed-game').waitFor({ timeout: 15000 });
    assert.ok(await page.locator('.app-window').count() > before, 'a desktop popup window opened');
    assert.equal(await page.locator('.framed-pizzashift-window').count(), 1);
    assert.equal(new URL(page.url()).searchParams.get('app'), 'pizzashift', 'the window has its desktop route');
    let fr;
    await page.waitForFunction(() => document.querySelector('.framed-pizzashift-window iframe')?.contentWindow?.PIZZASHIFT_ENGINE);
    for (const f of page.frames()) if (f.url().includes('/games/pizza-shift/')) fr = f;
    assert.ok(fr && fr.url().includes('embed=1'));
    return fr;
}
const E = (fr, fn, arg) => fr.evaluate(fn, arg);
const state = fr => E(fr, () => { const s = PIZZASHIFT_ENGINE.state(); return { phase: s.phase, paused: s.paused, station: s.station, sel: s.sel, game: s.game, served: s.day ? s.day.results.length : 0 }; });
async function canvasPoint(fr, kind, a, b) {
    const box = await fr.locator('#view').boundingBox();
    const p = await E(fr, ([k, x, y]) => k === 'pizza' ? PIZZASHIFT_ENGINE.pizzaPoint(x, y) : k === 'oven' ? PIZZASHIFT_ENGINE.ovenPoint(x) : PIZZASHIFT_ENGINE.frontPoint(), [kind, a, b]);
    return { x: box.x + p.x, y: box.y + p.y };
}
async function waitForCustomer(fr) {
    await E(fr, () => { const s = PIZZASHIFT_ENGINE.state(); let n = 0; while (!PIZZASHIFT_ENGINE.sim.queue(s.day).length && n++ < 200) PIZZASHIFT_ENGINE.fastForward(0.5); });
}
async function bakeToTarget(fr, oven) {
    await E(fr, i => {
        const S = PIZZASHIFT_ENGINE.sim, ds = PIZZASHIFT_ENGINE.state().day, o = ds.ovens[i];
        const target = S.bakeTarget(S.ticket(ds, o.ticket).order);
        PIZZASHIFT_ENGINE.fastForward(Math.max(0, (target - o.heat) / ds.heatRate));
    }, oven);
}
const tab = (fr, name) => fr.getByRole('tab', { name: new RegExp('^' + name) }).click();

// one perfect pizza with the mouse
async function mousePizza(page, fr) {
    await waitForCustomer(fr);
    await tab(fr, 'order');
    const front = await canvasPoint(fr, 'front');
    await page.mouse.click(front.x, front.y); // tapping the customer takes the order
    const id = (await state(fr)).sel;
    assert.ok(id > 0, 'tapping the customer took an order');
    await tab(fr, 'topping');
    const pieces = await E(fr, id => { const S = PIZZASHIFT_ENGINE.sim; return S.perfectPieces(S.ticket(PIZZASHIFT_ENGINE.state().day, id).order); }, id);
    for (const p of pieces) {
        await fr.getByRole('button', { name: S_NAME[p.t], exact: true }).click();
        const at = await canvasPoint(fr, 'pizza', p.x, p.y);
        await page.mouse.click(at.x, at.y);
    }
    assert.equal(await E(fr, id => PIZZASHIFT_ENGINE.sim.ticket(PIZZASHIFT_ENGINE.state().day, id).pieces.length, id), pieces.length, 'every click placed a piece');
    await fr.getByRole('button', { name: 'to oven →' }).click();
    const oven = await E(fr, id => PIZZASHIFT_ENGINE.sim.ticket(PIZZASHIFT_ENGINE.state().day, id).oven, id);
    assert.ok(oven >= 0);
    await tab(fr, 'bake');
    await bakeToTarget(fr, oven);
    const ov = await canvasPoint(fr, 'oven', oven);
    await page.mouse.click(ov.x, ov.y);
    assert.equal(await E(fr, id => PIZZASHIFT_ENGINE.sim.ticket(PIZZASHIFT_ENGINE.state().day, id).status, id), 'baked', 'clicking the oven took the pizza out');
    await tab(fr, 'cut');
    const n = await E(fr, id => PIZZASHIFT_ENGINE.sim.ticket(PIZZASHIFT_ENGINE.state().day, id).order.slices / 2, id);
    for (let k = 0; k < n; k++) {
        const a = k * Math.PI / n;
        const from = await canvasPoint(fr, 'pizza', -Math.cos(a) * 1.05, -Math.sin(a) * 1.05), to = await canvasPoint(fr, 'pizza', Math.cos(a) * 1.05, Math.sin(a) * 1.05);
        await page.mouse.move(from.x, from.y); await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up();
    }
    assert.equal(await E(fr, id => PIZZASHIFT_ENGINE.sim.ticket(PIZZASHIFT_ENGINE.state().day, id).cuts.length, id), n, 'every drag cut once');
    await fr.getByRole('button', { name: 'to serve →' }).click();
    await fr.getByRole('button', { name: new RegExp('^serve #' + id + '$') }).click();
    const r = await E(fr, id => PIZZASHIFT_ENGINE.state().day.results.find(r => r.id === id), id);
    assert.ok(r && r.total >= 95, 'a carefully made pizza scores high: ' + JSON.stringify(r && r.parts));
    return r;
}
const S_NAME = { pepperoni: 'pepperoni', mushroom: 'mushrooms', olive: 'olives', pepper: 'peppers', onion: 'onions', sausage: 'sausage' };

try {
    // ------------------------------------------------ desktop: a whole day with the mouse
    {
        const ctx = await context({ viewport: { width: 1366, height: 900 } });
        const page = await ctx.newPage(), errors = watch(page);
        let fr = await openOnDesktop(page);
        await fr.getByRole('button', { name: 'start day 1' }).waitFor();
        assert.ok(await fr.locator('#dlg-body').innerText().then(t => t.includes('2 pieces in each quarter')), 'the how-to-play screen explains the rules');
        assert.equal(await fr.locator('.titlebar').isVisible(), false, 'embedded: the desktop supplies the titlebar');
        ok('start menu opens pizza shift in a desktop popup with a how-to-play screen');

        await E(fr, () => PIZZASHIFT_ENGINE.newGame(4242));
        await fr.getByRole('button', { name: 'open up' }).click();
        assert.equal((await state(fr)).phase, 'playing');
        const results = [];
        for (let i = 0; i < 3; i++) results.push(await mousePizza(page, fr));
        assert.ok(+(await fr.locator('#hud-today').textContent()).slice(1) > 0, 'tips show up in the hud');
        ok('day 1 played with the mouse: ' + results.map(r => r.total).join(', '));
        await fr.getByRole('button', { name: 'to the shop' }).waitFor({ timeout: 5000 });
        const g = (await state(fr)).game;
        assert.equal(g.day, 2); assert.equal(g.stars[0], 3); assert.ok(g.money >= 1000, 'the jar holds ' + g.money);
        assert.ok((await fr.locator('#dlg-title').textContent()).includes('day 1 closed'));
        await fr.getByRole('button', { name: 'to the shop' }).click();
        assert.equal(await fr.locator('[data-buy="ovens"]').isDisabled(), true, 'cannot afford an oven yet');
        const saved = JSON.parse(await E(fr, k => localStorage.getItem(k), SAVE));
        assert.equal(saved.day, 2); assert.equal(saved.money, g.money);
        ok('day end: 3 stars, money in the jar, shop open, save written (' + g.money + ' cents)');

        // reload the game inside its window: the save carries on
        await E(fr, () => location.reload());
        await page.waitForFunction(() => document.querySelector('.framed-pizzashift-window iframe')?.contentWindow?.PIZZASHIFT_ENGINE);
        fr = page.frames().find(f => f.url().includes('/games/pizza-shift/'));
        await fr.getByRole('button', { name: 'continue: day 2' }).click();
        assert.equal((await state(fr)).game.money, g.money);
        await fr.getByRole('button', { name: 'open up' }).click();
        ok('reload keeps day 2 and the money');

        // one pizza with the keyboard only
        await waitForCustomer(fr);
        await fr.locator('#view').focus();
        await page.keyboard.press('Enter');
        const id = (await state(fr)).sel;
        assert.ok(id > 0, 'enter at the counter took the order');
        await page.keyboard.press('t');
        assert.equal((await state(fr)).station, 'topping');
        await page.keyboard.press('3');
        assert.equal(await E(fr, () => PIZZASHIFT_ENGINE.state().topping), 'olive');
        for (const key of ['ArrowRight', 'ArrowRight', 'ArrowUp', 'ArrowUp', 'Enter', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter', 'Backspace', 'Enter']) await page.keyboard.press(key);
        assert.equal(await E(fr, id => PIZZASHIFT_ENGINE.sim.ticket(PIZZASHIFT_ENGINE.state().day, id).pieces.length, id), 3, 'arrows + enter place, backspace undoes');
        await fr.getByRole('button', { name: 'to oven →' }).focus(); await page.keyboard.press('Enter');
        await page.keyboard.press('b');
        await bakeToTarget(fr, 0);
        await page.keyboard.press('1');
        await page.keyboard.press('c');
        await fr.locator('#view').focus();
        const n = await E(fr, id => PIZZASHIFT_ENGINE.sim.ticket(PIZZASHIFT_ENGINE.state().day, id).order.slices / 2, id);
        for (let k = 0; k < n; k++) { await page.keyboard.press('Enter'); for (let s = 0; s < 12 / n; s++) await page.keyboard.press('ArrowRight'); }
        const cutScore = await E(fr, id => { const S = PIZZASHIFT_ENGINE.sim, t = S.ticket(PIZZASHIFT_ENGINE.state().day, id); return S.scoreCut(t.order.slices, t.cuts); }, id);
        assert.equal(cutScore, 100, 'the keyboard knife cuts evenly');
        await page.keyboard.press('s'); await page.keyboard.press('Enter');
        const r = await E(fr, id => PIZZASHIFT_ENGINE.state().day.results.find(r => r.id === id), id);
        assert.ok(r && !r.walkout && r.parts.bake === 100 && r.parts.cut === 100, 'served by keyboard: ' + JSON.stringify(r));
        ok('one pizza made with the keyboard only (score ' + r.total + ')');

        // pause button freezes the clock, minimising the window pauses too
        const t0 = await E(fr, () => PIZZASHIFT_ENGINE.state().day.t);
        await fr.getByRole('button', { name: 'pause', exact: true }).click();
        const frozen = await E(fr, () => PIZZASHIFT_ENGINE.state().day.t);
        await page.waitForTimeout(200);
        assert.equal(await E(fr, () => PIZZASHIFT_ENGINE.state().day.t), frozen, 'paused clock stands still');
        assert.ok(frozen >= t0);
        await fr.locator('#dlg-actions').getByRole('button', { name: 'resume', exact: true }).click();
        await fr.waitForFunction(f => PIZZASHIFT_ENGINE.state().day.t > f, frozen);
        await page.evaluate(() => { document.querySelector('.framed-pizzashift-window').style.display = 'none'; });
        await fr.waitForFunction(() => PIZZASHIFT_ENGINE.state().paused === true);
        await page.evaluate(() => startMenuAction('pizzashift'));
        assert.equal(await page.locator('.framed-pizzashift-window').count(), 1, 'the start menu brings back the same window');
        assert.equal(await page.locator('.framed-pizzashift-window').isVisible(), true);
        ok('pause, resume, and minimising the window pauses the shift');
        await page.screenshot({ path: path.join(process.env.TMPDIR || '/tmp', 'pizzashift-desktop.png') });
        assert.deepEqual(errors, []);
        await ctx.close();
    }
    // ------------------------------------------------ phone: touch inside the popup, no overflow
    {
        const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        const page = await ctx.newPage(), errors = watch(page);
        const fr = await openOnDesktop(page);
        await E(fr, () => PIZZASHIFT_ENGINE.newGame(99));
        await fr.getByRole('button', { name: 'open up' }).tap();
        await waitForCustomer(fr);
        await fr.getByRole('button', { name: 'take order' }).tap();
        await fr.getByRole('tab', { name: /^topping/ }).tap();
        await fr.getByRole('button', { name: 'sausage', exact: true }).tap();
        for (const [x, y] of [[0.4, -0.4], [-0.4, 0.4]]) { const p = await canvasPoint(fr, 'pizza', x, y); await page.touchscreen.tap(p.x, p.y); }
        const st = await state(fr);
        assert.equal(await E(fr, id => PIZZASHIFT_ENGINE.sim.ticket(PIZZASHIFT_ENGINE.state().day, id).pieces.filter(p => p.t === 'sausage').length, st.sel), 2, 'taps place toppings');
        for (const w of [page, fr]) {
            const m = await w.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
            assert.ok(m.s <= m.c + 1, 'no horizontal overflow ' + JSON.stringify(m));
        }
        const cw = await fr.locator('#view').boundingBox();
        assert.ok(cw.width > 300 && cw.height > 280, 'the canvas uses the phone width: ' + JSON.stringify(cw));
        await page.screenshot({ path: path.join(process.env.TMPDIR || '/tmp', 'pizzashift-phone.png') });
        assert.deepEqual(errors, []);
        await ctx.close();
        ok('390x844 phone: touch play inside the popup, no horizontal overflow');
    }
    // ------------------------------------------------ standalone 360px, a failed day, corrupt then blocked storage
    {
        const ctx = await context({ viewport: { width: 360, height: 700 }, hasTouch: true });
        await ctx.addInitScript(k => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, '{broken'); sessionStorage.setItem('seeded', '1'); } } catch (_) { } }, SAVE);
        const page = await ctx.newPage(), errors = watch(page);
        await page.goto(BASE + '/games/pizza-shift/');
        await page.getByRole('button', { name: 'start day 1' }).click();
        await page.getByRole('button', { name: 'open up' }).click();
        await page.evaluate(() => PIZZASHIFT_ENGINE.fastForward(900));
        await page.getByRole('button', { name: 'to the shop' }).waitFor({ timeout: 5000 });
        assert.ok((await page.locator('#dlg-title').textContent()).includes('day 1 failed'), 'everybody walked out: the day fails');
        const g = await page.evaluate(() => PIZZASHIFT_ENGINE.state().game);
        assert.equal(g.day, 1); assert.equal(g.money, 0);
        await page.getByRole('button', { name: 'to the shop' }).click();
        await page.getByRole('button', { name: 'start day 1' }).click();
        await page.getByRole('heading', { name: 'day 1 of 10' }).waitFor();
        const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
        assert.ok(m.s <= m.c + 1, '360px: no horizontal overflow');
        assert.deepEqual(errors, []);
        await ctx.close();
        ok('corrupt save starts fresh; a day where everybody walks out fails and is retried; 360px fits');

        const blocked = await context({ viewport: { width: 800, height: 700 } });
        await blocked.addInitScript(() => {
            Storage.prototype.getItem = () => { throw new Error('storage blocked'); };
            Storage.prototype.setItem = () => { throw new Error('storage blocked'); };
        });
        const p2 = await blocked.newPage(), e2 = watch(p2);
        await p2.goto(BASE + '/games/pizza-shift/?embed=1');
        await p2.getByRole('button', { name: 'start day 1' }).click();
        await p2.getByRole('button', { name: 'open up' }).click();
        await p2.evaluate(() => PIZZASHIFT_ENGINE.fastForward(3));
        await p2.getByRole('button', { name: 'take order' }).click();
        await p2.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
        assert.equal(await p2.evaluate(() => PIZZASHIFT_ENGINE.state().paused), true, 'a hidden tab pauses');
        assert.deepEqual(e2, []);
        await blocked.close();
        ok('blocked storage still plays; a hidden tab pauses');
    }
} finally { await browser.close(); server.close(); }
console.log(checks + ' pizzashift browser checks passed');
