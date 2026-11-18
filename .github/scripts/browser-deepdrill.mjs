// browser-deepdrill.mjs - deep drill 98 in a real browser: opened from the start
// menu as a desktop popup, played with real keys (dig, fly up, sell, refuel),
// a save that survives a reload, pausing (key, minimise, hidden tab), a win at
// the core and a wreck with a reload, and a phone played with the touch pad.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain' };
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

async function newContext(opts) {
    const context = await browser.newContext(opts);
    await context.route('**/*', r => { const u = r.request().url(); return u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
    await context.addInitScript(() => {
        try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (_) { /* blocked storage */ }
    });
    return context;
}
const errorsOf = page => { const e = []; page.on('pageerror', x => e.push(x.message)); return e; };
const E = (frame, fn, arg) => frame.evaluate(fn, arg);
const depth = frame => E(frame, () => DEEPDRILL_ENGINE.sim.depthM(DEEPDRILL_ENGINE.state()));
async function holdKey(page, key, frame, until, ms = 15000) {
    await page.keyboard.down(key);
    try { await frame.waitForFunction(until, null, { timeout: ms, polling: 50 }); }
    catch (e) {
        console.log('holdKey ' + key + ' state', await frame.evaluate(() => ({ phase: DEEPDRILL_ENGINE.phase(), held: DEEPDRILL_ENGINE.held, seed: DEEPDRILL_ENGINE.state().seed, cargo: DEEPDRILL_ENGINE.state().cargo.join(), ev: DEEPDRILL_ENGINE.state().trips, status: document.getElementById('status').textContent, y: DEEPDRILL_ENGINE.state().pod.y, focus: document.hasFocus(), active: document.activeElement && document.activeElement.id, dlg: document.getElementById('modal').className })));
        throw e;
    } finally { await page.keyboard.up(key); }
}

try {
    // ---------------- desktop: start menu -> popup -> a full trip with real keys ----------------
    const ctx = await newContext({ viewport: { width: 1366, height: 860 } });
    const page = await ctx.newPage(), errors = errorsOf(page);
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof startMenuAction === 'function');
    await page.evaluate(() => document.getElementById('boot-screen')?.remove());
    await page.evaluate(() => startMenuAction('deepdrill'));
    await page.locator('.app-window.framed-deepdrill-window iframe.framed-game').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('.app-window.framed-deepdrill-window').count(), 1);
    assert.equal(new URL(page.url()).searchParams.get('app'), 'deepdrill', 'the window has its own desktop route');
    const frame = page.frames().find(f => f.url().includes('/games/deep-drill/'));
    assert.ok(frame && new URL(frame.url()).searchParams.get('embed') === '1', 'the game is framed with ?embed=1');
    await frame.waitForFunction(() => window.DEEPDRILL_ENGINE && DEEPDRILL_ENGINE.phase() === 'title');
    const game = page.frameLocator('.framed-deepdrill-window iframe.framed-game');
    assert.equal(await game.locator('.titlebar').isVisible(), false, 'the desktop window supplies the titlebar');
    assert.ok(await game.getByRole('dialog').getByText('how to', { exact: false }).count() >= 0);
    assert.ok(/1500 m/.test(await game.locator('#dlg-body').textContent()), 'the title screen explains the goal');
    ok('start menu opens deep drill in one desktop popup with a how-to-play title screen');

    await game.getByRole('button', { name: 'new run', exact: true }).last().click();
    await frame.waitForFunction(() => DEEPDRILL_ENGINE.phase() === 'play');
    // deterministic setup: a known planet with ore in the first rows of the spawn column
    await E(frame, () => {
        const E = DEEPDRILL_ENGINE; E.newRun(4242);
        const s = E.state(), DD = E.sim;
        for (let y = DD.SURF; y < DD.SURF + 6; y++) DD.setTile(s.world, 11, y, y % 2 ? DD.ORE0 + 1 : DD.ORE0 + 2);
        DD.setTile(s.world, 11, DD.SURF + 6, DD.T.ROCK); // a boulder stops the drill under the ore
    });
    await game.locator('#view').click();
    await holdKey(page, 'ArrowDown', frame, () => DEEPDRILL_ENGINE.state().cargoCount >= 6 && !DEEPDRILL_ENGINE.state().pod.drill);
    const afterDig = await E(frame, () => { const s = DEEPDRILL_ENGINE.state(); return { cargo: s.cargoCount, fuel: s.fuel, hud: document.getElementById('depth').textContent }; });
    assert.equal(afterDig.cargo, 6, 'six ore tiles drilled into the bay');
    assert.ok(afterDig.fuel < 10, 'drilling burned fuel');
    assert.match(afterDig.hud, /^[3-9]\d m$/, 'the hud shows the depth');
    assert.equal(await game.locator('#cargo').textContent(), '6/7');
    ok('real ArrowDown drills 30 m, fills the cargo bay and burns fuel');

    // fly up out of the shaft and drive to the ore buyer
    await holdKey(page, 'ArrowUp', frame, () => DEEPDRILL_ENGINE.state().pod.y < DEEPDRILL_ENGINE.sim.SURF - 1.2);
    await holdKey(page, 'ArrowLeft', frame, () => DEEPDRILL_ENGINE.state().pod.x < 8.6);
    await frame.waitForFunction(() => DEEPDRILL_ENGINE.shop() === 'sell', null, { timeout: 8000 });
    const before = await E(frame, () => DEEPDRILL_ENGINE.state().cash);
    await game.getByRole('button', { name: /^sell all/ }).click();
    const sold = await E(frame, () => ({ cash: DEEPDRILL_ENGINE.state().cash, cargo: DEEPDRILL_ENGINE.state().cargoCount, trips: DEEPDRILL_ENGINE.state().trips }));
    assert.equal(before, 0);
    assert.equal(sold.cash, 3 * 55 + 3 * 120, 'three copperite and three silverine sold at list price');
    assert.equal(sold.cargo, 0); assert.equal(sold.trips, 1);
    assert.equal(await game.locator('#cash').textContent(), '$' + sold.cash);
    await page.keyboard.press('Escape');
    await frame.waitForFunction(() => DEEPDRILL_ENGINE.phase() === 'play' && !DEEPDRILL_ENGINE.shop());
    ok('thrust up, drive to the ore buyer, the shop opens itself and "sell all" pays $' + sold.cash);

    // the fuel station with keys + Enter
    await holdKey(page, 'ArrowLeft', frame, () => DEEPDRILL_ENGINE.state().pod.x < 3.4);
    await frame.waitForFunction(() => DEEPDRILL_ENGINE.shop() === 'fuel', null, { timeout: 8000 });
    await game.getByRole('button', { name: /^fill up/ }).click();
    const fuelled = await E(frame, () => ({ fuel: DEEPDRILL_ENGINE.state().fuel, cash: DEEPDRILL_ENGINE.state().cash }));
    assert.equal(fuelled.fuel, 10, 'the tank is full again');
    assert.ok(fuelled.cash < sold.cash && fuelled.cash > sold.cash - 21);
    await game.getByRole('button', { name: 'leave', exact: true }).click();
    ok('fuel station refills the tank for cash');

    // save persists across a reload of the game page
    const saved = await E(frame, k => JSON.parse(localStorage.getItem(k)), 'mrhakan98-deepdrill-save');
    assert.equal(saved.seed, 4242); assert.equal(saved.cash, fuelled.cash);
    await frame.goto(BASE + '/games/deep-drill/?embed=1');
    await frame.waitForFunction(() => window.DEEPDRILL_ENGINE && DEEPDRILL_ENGINE.phase() === 'title');
    await game.getByRole('button', { name: /^continue/ }).click();
    const restored = await E(frame, () => { const s = DEEPDRILL_ENGINE.state(); return { seed: s.seed, cash: s.cash, trips: s.trips, shaft: DEEPDRILL_ENGINE.sim.tileAt(s.world, 11, DEEPDRILL_ENGINE.sim.SURF + 3) }; });
    assert.deepEqual(restored, { seed: 4242, cash: fuelled.cash, trips: 1, shaft: 0 }, 'cash, trips and the dug shaft come back');
    ok('the surface autosave survives a reload and "continue" restores the run');

    // pause: P key freezes the sim; minimising the window pauses too
    await game.locator('#view').click();
    await page.keyboard.press('p');
    assert.equal(await E(frame, () => DEEPDRILL_ENGINE.phase()), 'paused');
    const tick = await E(frame, () => DEEPDRILL_ENGINE.state().tick);
    await page.waitForTimeout(300);
    assert.equal(await E(frame, () => DEEPDRILL_ENGINE.state().tick), tick, 'no ticks while paused');
    await game.getByRole('button', { name: 'resume', exact: true }).last().click();
    await frame.waitForFunction(t => DEEPDRILL_ENGINE.state().tick > t, tick);
    await page.evaluate(() => { document.querySelector('.framed-deepdrill-window').style.display = 'none'; });
    await frame.waitForFunction(() => DEEPDRILL_ENGINE.phase() === 'paused');
    await page.evaluate(() => startMenuAction('deepdrill'));
    assert.equal(await page.locator('.framed-deepdrill-window').count(), 1, 'the start menu brings back the same window');
    assert.equal(await page.locator('.framed-deepdrill-window').isVisible(), true);
    await game.getByRole('button', { name: 'resume', exact: true }).last().click();
    await E(frame, () => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(await E(frame, () => DEEPDRILL_ENGINE.phase()), 'paused', 'a hidden tab pauses');
    await E(frame, () => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); });
    await game.getByRole('button', { name: 'resume', exact: true }).last().click();
    ok('P pauses and freezes the sim; minimising the popup and hiding the tab pause too');

    // win: the last core shard, drilled with a real key
    await E(frame, () => {
        const E = DEEPDRILL_ENGINE, s = E.state(), DD = E.sim;
        s.up.hull = 5; s.hull = 110; s.up.rad = 5; s.up.drill = 5; s.up.tank = 5; s.fuel = 80;
        for (let y = DD.CAVE_FLOOR - 3; y < DD.CAVE_FLOOR; y++) for (let x = 14; x <= 16; x++) if (!(x === 15 && y === DD.CAVE_FLOOR - 1)) DD.setTile(s.world, x, y, DD.T.EMPTY);
        s.coreLeft = 1; s.pod.x = 15.5; s.pod.y = DD.CAVE_FLOOR - 2 + 0.6; s.pod.vx = s.pod.vy = 0;
    });
    await game.locator('#view').click();
    await holdKey(page, 'ArrowDown', frame, () => DEEPDRILL_ENGINE.phase() === 'over');
    assert.equal(await E(frame, () => DEEPDRILL_ENGINE.state().won), true);
    assert.equal(await game.locator('#dlg-title').textContent(), 'core cracked!');
    const bestRec = await E(frame, k => JSON.parse(localStorage.getItem(k)), 'mrhakan98-deepdrill-best');
    assert.equal(bestRec.wins, 1); assert.equal(bestRec.depth, 1500);
    assert.equal(await E(frame, k => localStorage.getItem(k), 'mrhakan98-deepdrill-save'), null, 'a won run clears its save');
    ok('drilling the last core shard at 1500 m wins, records the best and clears the save');

    // lose: run dry underground, then reload the last surface save
    await game.getByRole('button', { name: 'new run', exact: true }).last().click();
    await E(frame, () => { const s = DEEPDRILL_ENGINE.state(); s.cash = 777; DEEPDRILL_ENGINE.save(); });
    await game.locator('#view').click();
    await holdKey(page, 'ArrowDown', frame, () => DEEPDRILL_ENGINE.sim.depthM(DEEPDRILL_ENGINE.state()) >= 15 || DEEPDRILL_ENGINE.state().over);
    await E(frame, () => { DEEPDRILL_ENGINE.state().fuel = 0.02; });
    await frame.waitForFunction(() => DEEPDRILL_ENGINE.phase() === 'over');
    assert.equal(await game.locator('#dlg-title').textContent(), 'pod lost');
    assert.match(await game.locator('#dlg-body').textContent(), /out of fuel/);
    await game.getByRole('button', { name: 'reload last surface save', exact: true }).click();
    const reloaded = await E(frame, () => ({ phase: DEEPDRILL_ENGINE.phase(), cash: DEEPDRILL_ENGINE.state().cash, wrecks: DEEPDRILL_ENGINE.state().wrecks, d: DEEPDRILL_ENGINE.sim.depthM(DEEPDRILL_ENGINE.state()) }));
    assert.deepEqual(reloaded, { phase: 'play', cash: 777, wrecks: 1, d: 0 });
    ok('running dry underground ends the run; "reload last surface save" brings the pod back');

    // items with number keys and the item buttons
    await E(frame, () => { const s = DEEPDRILL_ENGINE.state(); s.items.teleport = 1; s.items.reserve = 1; s.fuel = 3; });
    await game.locator('#view').click();
    await page.keyboard.press('5');
    assert.equal(await E(frame, () => DEEPDRILL_ENGINE.state().fuel), 10);
    await holdKey(page, 'ArrowDown', frame, () => DEEPDRILL_ENGINE.sim.depthM(DEEPDRILL_ENGINE.state()) >= 10);
    await frame.waitForFunction(() => !DEEPDRILL_ENGINE.state().pod.drill);
    await game.locator('#item-teleport').click();
    assert.equal(await depth(frame), 0, 'the teleporter button lifts the pod home');
    ok('key 5 pours reserve fuel; the teleporter button brings the pod home');

    assert.deepEqual(errors, [], 'no page errors on the desktop');
    await ctx.close();

    // ---------------- phone: touch pad, layout, no overflow ----------------
    const phone = await newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const pp = await phone.newPage(), perrors = errorsOf(pp);
    await pp.goto(BASE + '/games/deep-drill/?seed=31337');
    await pp.waitForFunction(() => window.DEEPDRILL_ENGINE && DEEPDRILL_ENGINE.phase() === 'title');
    await pp.getByRole('button', { name: 'new run', exact: true }).last().tap();
    await pp.waitForFunction(() => DEEPDRILL_ENGINE.phase() === 'play');
    assert.equal(await pp.evaluate(() => DEEPDRILL_ENGINE.state().seed), 31337, 'the ?seed= parameter picks the planet');
    const down = pp.getByRole('button', { name: 'drill down' });
    assert.equal(await down.isVisible(), true, 'the touch pad shows on a phone');
    await pp.evaluate(() => { const s = DEEPDRILL_ENGINE.state(), DD = DEEPDRILL_ENGINE.sim; for (let y = DD.SURF; y < DD.SURF + 8; y++) DD.setTile(s.world, 11, y, DD.T.DIRT); });
    const box = await down.boundingBox();
    await down.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: box.x + 5, clientY: box.y + 5 });
    await pp.waitForFunction(() => DEEPDRILL_ENGINE.sim.depthM(DEEPDRILL_ENGINE.state()) >= 15, null, { timeout: 10000 });
    await down.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true });
    assert.equal(await pp.evaluate(() => DEEPDRILL_ENGINE.held.down), false, 'lifting the finger stops the drill');
    const up = pp.getByRole('button', { name: 'thrust up' });
    await up.dispatchEvent('pointerdown', { pointerId: 8, pointerType: 'touch', isPrimary: true });
    await pp.waitForFunction(() => DEEPDRILL_ENGINE.state().pod.y < DEEPDRILL_ENGINE.sim.SURF - 0.8, null, { timeout: 10000 });
    await up.dispatchEvent('pointerup', { pointerId: 8, pointerType: 'touch', isPrimary: true });
    ok('phone: holding the touch pad drills down 15 m and thrusts back up');
    await pp.getByRole('button', { name: 'how to play', exact: true }).tap();
    assert.equal(await pp.evaluate(() => DEEPDRILL_ENGINE.phase()), 'paused');
    await pp.getByRole('button', { name: 'back to the pod', exact: true }).tap();
    assert.equal(await pp.evaluate(() => DEEPDRILL_ENGINE.phase()), 'play');
    const w = await pp.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, canvas: document.getElementById('view').getBoundingClientRect().height }));
    assert.ok(w.scroll <= w.client + 1, 'no horizontal overflow at 390 px: ' + JSON.stringify(w));
    assert.ok(w.canvas > 250, 'the mine view keeps a usable height on a phone: ' + w.canvas);
    const painted = await pp.evaluate(() => { const c = document.getElementById('view'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 997) seen.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4); return seen.size; });
    assert.ok(painted > 8, 'the canvas is actually painted (' + painted + ' colours)');
    await pp.screenshot({ path: path.join(process.env.TMPDIR || '/tmp', 'deepdrill-phone.png') });
    ok('phone: how-to pauses and resumes, the page fits 390 px and the canvas is painted');
    assert.deepEqual(perrors, [], 'no page errors on the phone');
    await phone.close();

    // ---------------- the desktop site on a phone + blocked storage ----------------
    const site = await newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const sp = await site.newPage(), serrors = errorsOf(sp);
    await sp.goto(BASE + '/?app=deepdrill', { waitUntil: 'load' });
    await sp.waitForFunction(() => typeof startMenuAction === 'function');
    await sp.evaluate(() => document.getElementById('boot-screen')?.remove());
    await sp.evaluate(() => { if (!document.querySelector('.framed-deepdrill-window')) startMenuAction('deepdrill'); });
    await sp.locator('.framed-deepdrill-window iframe.framed-game').waitFor({ timeout: 15000 });
    await sp.waitForTimeout(400);
    const sw = await sp.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(sw.scroll <= sw.client + 1, 'the desktop at 390 px does not overflow with the game open: ' + JSON.stringify(sw));
    assert.deepEqual(serrors, []);
    await site.close();
    const blocked = await browser.newContext();
    await blocked.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
    await blocked.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('blocked'); }; Storage.prototype.setItem = () => { throw new Error('blocked'); }; });
    const bp = await blocked.newPage(), berrors = errorsOf(bp);
    await bp.goto(BASE + '/games/deep-drill/');
    await bp.getByRole('button', { name: 'new run', exact: true }).last().click();
    await bp.locator('#view').click();
    await bp.keyboard.down('ArrowDown'); await bp.waitForTimeout(800); await bp.keyboard.up('ArrowDown');
    assert.ok(await bp.evaluate(() => DEEPDRILL_ENGINE.sim.depthM(DEEPDRILL_ENGINE.state())) > 0);
    assert.deepEqual(berrors, [], 'blocked storage does not break play');
    await blocked.close();
    ok('the site on a phone fits with the game open; blocked storage still plays');
} finally {
    await browser.close();
    server.close();
}
console.log(`deep drill: ${checks} browser checks passed.`);
