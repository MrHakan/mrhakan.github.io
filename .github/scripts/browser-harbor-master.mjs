// Real controls, desktop and touch. Uses local files and no outside services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, devices } from 'playwright';
const base = (process.env.SITE_URL || 'http://127.0.0.1:8099').replace(/\/$/, '');
fs.mkdirSync('.ci-shots', { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
let checks = 0;
try {
  const seedContext = await browser.newContext(), seedPage = await seedContext.newPage();
  await seedPage.goto(base + '/games/harbor-master/');
  await seedPage.locator('#seed').fill('12345');
  await seedPage.getByRole('button', { name: 'start shift', exact: true }).click();
  assert.equal(await seedPage.evaluate(() => HARBOR_MASTER_APP.state().seed), 12345, 'first start applies the seed entered while ready');
  await seedPage.getByRole('button', { name: 'new shift', exact: true }).click();
  await seedPage.locator('#seed').fill('54321');
  await seedPage.getByRole('button', { name: 'start shift', exact: true }).click();
  assert.equal(await seedPage.evaluate(() => HARBOR_MASTER_APP.state().seed), 54321, 'a new shift applies the newly entered seed');
  await seedPage.getByRole('button', { name: 'new shift', exact: true }).click();
  await seedPage.getByRole('button', { name: 'route to matching berth', exact: true }).click();
  const planned = await seedPage.evaluate(() => HARBOR_MASTER_APP.state().ships[0].waypoints);
  await seedPage.getByRole('button', { name: 'start shift', exact: true }).click();
  assert.deepEqual(await seedPage.evaluate(() => HARBOR_MASTER_APP.state().ships[0].waypoints), planned, 'an unchanged seed preserves routes plotted before start');
  for (const value of ['-1', '4294967296', '1.5', '']) {
    await seedPage.getByRole('button', { name: 'new shift', exact: true }).click();
    await seedPage.locator('#seed').fill(value);
    await seedPage.getByRole('button', { name: 'start shift', exact: true }).click();
    assert.equal(await seedPage.evaluate(() => HARBOR_MASTER_APP.state().seed), 98, 'invalid seeds use the default');
    assert.equal(await seedPage.locator('#seed').inputValue(), '98', 'the input shows the chosen fallback');
  }
  await seedContext.close(); checks++;
  console.log('ok - ready-phase seed changes, unchanged preplotted routes and visible invalid-seed fallback');
  for (const [name, device] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['mobile', devices['Pixel 7']]]) {
    const context = await browser.newContext(device);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/games/harbor-master/');
    await page.getByRole('heading', { name: 'harbor master 98', exact: true }).waitFor();
    assert.equal(await page.locator('main').count(), 1);
    await page.getByRole('button', { name: 'start shift', exact: true }).click();
    const ship = page.getByRole('button', { name: /ship 1.*Patron/i });
    await ship.waitFor(); await ship.click();
    const chart = page.getByRole('application', { name: 'harbor chart' });
    await chart.focus();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => HARBOR_MASTER_APP.state().ships[0].waypoints.length), 1);
    await page.screenshot({ path: '.ci-shots/harbor-master-' + name + '.png', fullPage: true });
    await page.getByRole('button', { name: 'clear route', exact: true }).click();
    assert.equal(await page.evaluate(() => HARBOR_MASTER_APP.state().ships[0].waypoints.length), 0);
    // Position a real simulated ship near the quay, then dock it with actual pointer input.
    await page.evaluate(() => { const s = HARBOR_MASTER_APP.state().ships[0]; s.x = 725; s.y = 100; s.vx = 0; s.vy = 0; });
    const box = await chart.boundingBox();
    const point = { x: box.x + box.width * 740 / 800, y: box.y + box.height * 100 / 520 };
    if (name === 'mobile') await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => HARBOR_MASTER_APP.state().docked === 1);
    assert.equal(await page.locator('#score').textContent(), '100');
    await page.getByRole('button', { name: 'pause', exact: true }).click();
    const frozen = await page.evaluate(() => HARBOR_MASTER_APP.state().ticks);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => HARBOR_MASTER_APP.state().ticks), frozen);
    await page.getByRole('button', { name: 'resume', exact: true }).click();
    await page.waitForFunction(t => HARBOR_MASTER_APP.state().ticks > t, frozen);
    // Hiding the document pauses too, and a new shift cannot retain the old score.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(await page.getByRole('button', { name: 'resume', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'new shift', exact: true }).click();
    assert.equal(await page.locator('#score').textContent(), '0');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(width.scroll <= width.client + 1, name + ': no horizontal overflow');
    assert.deepEqual(errors, []);
    console.log('ok - ' + name + ': real keyboard/pointer docking, pause, visibility, restart, reduced motion and layout');
    checks++;
    await context.close();
  }
  // Both tabs cache zero before either shift finishes; the later, lower score must not win.
  const shared = await browser.newContext(), first = await shared.newPage(), stale = await shared.newPage();
  await first.goto(base + '/games/harbor-master/');
  await first.evaluate(() => localStorage.setItem('unrelated-game-save', 'keep me'));
  await stale.goto(base + '/games/harbor-master/');
  for (const tab of [first, stale]) assert.equal(await tab.locator('#best').textContent(), '0');
  for (const [tab, score] of [[first, 700], [stale, 100]]) {
    await tab.bringToFront();
    await tab.getByRole('button', { name: 'start shift', exact: true }).click();
    await tab.evaluate(score => {
      const state = HARBOR_MASTER_APP.state();
      state.ticks = 2399; state.ships = []; state.score = score; state.nextSpawn = Infinity;
    }, score);
    await tab.getByRole('button', { name: 'try again', exact: true }).waitFor();
    assert.equal(await tab.evaluate(() => HARBOR_MASTER_APP.state().reason), 'shift complete');
    assert.equal(await tab.evaluate(() => localStorage.getItem('harbor-master-98-best')), '700', 'a stale tab cannot overwrite a higher stored record');
    assert.equal(await tab.locator('#best').textContent(), '700');
    assert.equal(await tab.evaluate(() => localStorage.getItem('unrelated-game-save')), 'keep me');
  }
  await shared.close(); checks++;
  console.log('ok - two already-open tabs retain the higher completed-shift record and unrelated saves');
  const context = await browser.newContext(), page = await context.newPage();
  await page.addInitScript(() => { localStorage.setItem('harbor-master-98-best', 'broken'); localStorage.setItem('unrelated-game-save', 'keep me'); });
  await page.goto(base + '/games/harbor-master/');
  assert.equal(await page.locator('#best').textContent(), '0', 'a corrupt record does not break play');
  await page.getByRole('button', { name: 'start shift', exact: true }).click();
  await page.evaluate(() => { const state = HARBOR_MASTER_APP.state(); state.score = 100; state.docked = 1; state.ships = []; state.ticks = 2399; state.nextSpawn = Infinity; });
  await page.getByRole('button', { name: 'try again', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('harbor-master-98-best')), '100');
  assert.equal(await page.evaluate(() => localStorage.getItem('unrelated-game-save')), 'keep me');
  await page.unrouteAll({ behavior: 'wait' });
  await context.close();
  const blocked = await browser.newContext();
  await blocked.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('storage blocked'); };
    Storage.prototype.setItem = () => { throw new Error('storage blocked'); };
  });
  const privatePage = await blocked.newPage(), errors = [];
  privatePage.on('pageerror', error => errors.push(error.message));
  await privatePage.goto(base + '/games/harbor-master/');
  await privatePage.getByRole('button', { name: 'start shift', exact: true }).click();
  assert.equal(await privatePage.locator('#best').textContent(), '0');
  await privatePage.evaluate(() => {
    const state = HARBOR_MASTER_APP.state();
    state.score = 100; state.ships = []; state.ticks = 2399; state.nextSpawn = Infinity;
  });
  await privatePage.getByRole('button', { name: 'try again', exact: true }).waitFor();
  assert.equal(await privatePage.locator('#best').textContent(), '100', 'a completed shift retains its record in memory when storage is blocked');
  assert.deepEqual(errors, [], 'play does not require storage permission');
  await blocked.close(); checks++;
  console.log('ok - corrupt/blocked storage, completed-shift record and unrelated saves');

  // On the site it is a desktop game: the games tab and the start menu open it
  // in a popup window, never in a new tab or by leaving the desktop.
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await desk.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); } catch (e) { } });
  const home = await desk.newPage(), deskErrors = [];
  home.on('pageerror', error => deskErrors.push(error.message));
  await home.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await home.waitForFunction(() => typeof showSection === 'function' && typeof startMenuAction === 'function');
  await home.evaluate(() => document.getElementById('boot-screen')?.remove());
  await home.evaluate(() => showSection('playground'));
  await home.locator('[data-playground-filter="game"]').click();
  const launch = home.locator('[data-playground-app="harbormaster"]');
  await launch.waitFor();
  const tabs = desk.pages().length;
  await home.evaluate(() => { window.__sameDesktop = true; });
  await launch.click();
  await home.locator('.harbor-window iframe.harbor-frame').waitFor();
  const game = home.frameLocator('.harbor-window iframe.harbor-frame');
  await game.getByRole('button', { name: 'start shift', exact: true }).click();
  assert.equal(await game.locator('.titlebar').isVisible(), false, 'the desktop window supplies the titlebar');
  assert.equal(desk.pages().length, tabs, 'the games tab opens a popup, not a new tab');
  assert.equal(await home.evaluate(() => window.__sameDesktop), true, 'the desktop page never navigated away');
  assert.equal(new URL(home.url()).searchParams.get('app'), 'harbormaster', 'the window has its own desktop route');
  await home.evaluate(() => { document.querySelector('.harbor-window').style.display = 'none'; });
  await home.waitForFunction(() => document.querySelector('.harbor-frame').contentWindow.HARBOR_MASTER_APP.state().paused);
  await home.evaluate(() => startMenuAction('harbormaster'));
  assert.equal(await home.locator('.harbor-window').count(), 1, 'the start menu brings back the same window');
  assert.equal(await home.locator('.harbor-window').isVisible(), true);
  assert.deepEqual(deskErrors, []);
  await desk.close(); checks++;
  console.log('ok - desktop: games tab and start menu open one harbor popup; minimising pauses the watch');
} finally { await browser.close(); }
console.log(`Harbor Master: ${checks} browser control flows passed.`);
