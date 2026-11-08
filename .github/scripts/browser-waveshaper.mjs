import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const base = (process.env.SITE_URL || 'http://127.0.0.1:8095').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
const errors = [];
await fs.mkdir('.ci-shots', { recursive: true });
try {
    for (const mobile of [false, true]) {
        const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: mobile });
        // The same first wave each run; the production game still uses a fresh seed.
        await context.addInitScript(() => { Date.now = () => 42; });
        const page = await context.newPage();
        page.on('pageerror', e => errors.push(e.message));
        page.on('response', r => { if (r.status() >= 400) errors.push(r.url() + ': ' + r.status()); });
        await page.goto(base + '/games/waveshaper/');
        const start = page.locator('#start');
        await start.click();
        if (mobile) await page.locator('[data-action="2"]').tap();
        else await page.keyboard.press('ArrowUp');
        assert.equal(await page.locator('#score').textContent(), '1', 'keyboard/touch scores a real match');
        await page.locator('#pause').click();
        const score = await page.locator('#score').textContent();
        await page.waitForTimeout(250);
        assert.equal(await page.locator('#score').textContent(), score);
        assert.equal(await start.textContent(), 'RESUME RUN');
        await start.click();
        assert.ok(await page.locator('#overlay').isHidden());
        await page.locator('#pause').click();
        if (!mobile) {
            await page.locator('#fullscreen').click();
            assert.equal(await page.evaluate(() => document.fullscreenElement?.tagName), 'MAIN', 'fullscreen keeps touch controls and pause available');
            assert.ok(await page.locator('[data-action="0"]').isVisible());
            await page.locator('#fullscreen').click();
        }
        await page.screenshot({ path: `.ci-shots/waveshaper-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.equal(await page.locator('[data-action]').count(), 4);
        const smallest = await page.locator('[data-action]').evaluateAll(buttons => Math.min(...buttons.map(b => b.getBoundingClientRect().height)));
        assert.ok(smallest >= 44, 'touch targets are large enough');

        // Restart ends the pause and hard mode has its own record.
        await page.locator('#restart').click();
        await page.keyboard.press('KeyW');
        assert.equal(await page.locator('#lives').textContent(), '3 / 4');
        await page.reload();
        await page.locator('#mode').selectOption('hard');
        assert.equal(await page.locator('#best').textContent(), '0');
        await start.click(); await page.keyboard.press('KeyW');
        assert.equal(await page.locator('#heading').textContent(), 'SIGNAL LOST.');
        assert.equal(await page.locator('#lives').textContent(), '0 / 1');
        await start.click(); assert.ok(await page.locator('#overlay').isHidden());
        await context.close();
    }

    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        Date.now = () => 42;
        window.testPad = { index: 0, connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
        Object.defineProperty(navigator, 'getGamepads', { value: () => window.testPad.connected ? [window.testPad] : [] });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/games/waveshaper/');
    await page.waitForFunction(() => document.querySelector('#pad').textContent.includes('CONNECTED'));
    await page.evaluate(() => { window.testPad.buttons[9].pressed = true; });
    await page.waitForFunction(() => document.querySelector('#overlay').hidden);
    await page.evaluate(() => { window.testPad.buttons[9].pressed = false; });
    await page.waitForTimeout(50);
    await page.evaluate(() => { window.testPad.buttons[5].pressed = true; });
    await page.waitForFunction(() => document.querySelector('#score').textContent === '1');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#score').textContent(), '1', 'holding RB fires once');
    await page.evaluate(() => { window.testPad.connected = false; });
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('disconnected'));
    assert.equal(await page.locator('#start').textContent(), 'RESUME RUN');
    await context.close();
    assert.deepEqual(errors, []);
    console.log('WAVESHAPER browser OK: desktop + touch, scoring, pause/resume, restart, hard game over, records, reduced motion and simulated gamepad edges/disconnect.');
} finally { await browser.close(); }
