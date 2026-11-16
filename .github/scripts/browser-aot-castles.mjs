// Castle art must stay below the HUD on cropped landscape canvases too.
// Observe actual Canvas calls in the real desktop game, not a geometry mock.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mockGiscus } from './mock-giscus.mjs';

const base = (process.env.SITE_URL || 'http://127.0.0.1:8103').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true,
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
try {
    for (const [width, height, dpr] of [[900, 400, 1], [915, 412, 2], [1280, 900, 1], [390, 844, 2]]) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
        await mockGiscus(context);
        await context.addInitScript(() => sessionStorage.setItem('welcomed', '1'));
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof openAgeOfTroll === 'function');
        await page.evaluate(() => { document.getElementById('boot-screen')?.remove(); openAgeOfTroll('bot'); });
        await page.waitForFunction(() => window.AOT_ENGINE?.state()?.s.tick > 1);
        await page.evaluate(() => {
            const g = AOT_ENGINE.state(), canvas = document.querySelector('#aot-canvas');
            AOT_ENGINE.speed(0); g.brain = null; g.s.u = [[], []]; g.banners = [];
            for (const p of g.s.p) { p.age = 4; p.hp = AOT.AGES[4].hp; p.tur = []; p.q = []; }
            const context = canvas.getContext('2d'), fill = context.fillRect;
            window.__castleRoof = [];
            context.fillRect = function (x, y, w, h) {
                // The six stepped roof tiles have these world dimensions and
                // team colours. Record their final device-pixel coordinates.
                if (h === 4 && [8, 12, 16, 20, 24, 28].includes(w) && y >= 70 && y <= 120 &&
                    ['#000080', '#1084d0', '#800000', '#d04030'].includes(this.fillStyle)) {
                    const m = this.getTransform(), p = new DOMPoint(x, y).matrixTransform(m);
                    const end = new DOMPoint(x + w, y + h).matrixTransform(m);
                    if (Math.max(p.x, end.x) > 0 && Math.min(p.x, end.x) < canvas.width) window.__castleRoof.push(Math.min(p.y, end.y));
                }
                return fill.call(this, x, y, w, h);
            };
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const before = await page.evaluate(() => AOT.replay.stateHash(AOT_ENGINE.state().s));
        for (const side of ['left', 'right']) {
            await page.evaluate(side => {
                const g = AOT_ENGINE.state();
                g.view.follow = false; g.view.heldAt = performance.now();
                g.view.cam = side === 'left' ? 0 : 100000;
                window.__castleRoof = [];
            }, side);
            await page.waitForFunction(() => window.__castleRoof.length >= 6);
            const bounds = await page.evaluate(() => {
                const c = document.querySelector('#aot-canvas');
                const scale = Math.max(c.height / 350, c.width / 1150);
                return { top: Math.min(...window.__castleRoof), hudBottom: 34 * scale };
            });
            assert.ok(bounds.top >= bounds.hudBottom + 1,
                `${width}x${height} ${side} roof at ${bounds.top} must clear HUD at ${bounds.hudBottom}`);
        }
        assert.equal(await page.evaluate(() => AOT.replay.stateHash(AOT_ENGINE.state().s)), before,
            'responsive castle art must not mutate the simulation');
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`ok - both castle roofs clear the HUD at ${width}x${height}, DPR ${dpr}; simulation unchanged`);
    }
    console.log('4 responsive castle browser flows passed.');
} finally {
    await browser.close();
}
