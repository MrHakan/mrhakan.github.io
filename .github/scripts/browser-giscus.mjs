// Exercise the real board loader and markup, replacing only remote services.
// This test must report application exceptions and CORS errors, including in
// the embedded Guestbook document. No console-error filter is used here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, devices } from 'playwright';
import { mockGiscus } from './mock-giscus.mjs';

const BASE = process.env.SITE_URL || 'http://localhost:8099';
const origin = new URL(BASE).origin;
const tailwind = await (await fetch('https://cdn.tailwindcss.com?plugins=forms,container-queries')).text();
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
fs.mkdirSync('.ci-shots', { recursive: true });
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; console.log('ok ' + message); };

async function setup(options = {}, mode = 'ready', config) {
    const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
    await context.addInitScript(() => {
        sessionStorage.setItem('welcomed', '1');
        sessionStorage.setItem('booted', '1');
    });
    // Decorative images and public APIs have no bearing on board wiring.
    // Keep application files real, and give unrelated services deterministic
    // responses rather than discarding browser errors caused by failed requests.
    await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
        const headers = { 'Access-Control-Allow-Origin': '*' };
        if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: tailwind, headers });
        if (url.hostname === 'api.github.com') return route.fulfill({ contentType: 'application/json', body: url.pathname.endsWith('/MrHakan') ? '{}' : '[]', headers });
        if (request.resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', headers });
        if (request.resourceType() === 'stylesheet') return route.fulfill({ contentType: 'text/css', body: '', headers });
        throw new Error('Unmocked external dependency: ' + url.href);
    });
    const requests = await mockGiscus(context, { mode });
    if (config !== undefined) await context.route('**/data/site.json', async route => {
        const data = await (await route.fetch()).json();
        data.giscus = config;
        await route.fulfill({ json: data });
    });
    const errors = [];
    context.on('page', page => {
        page.on('pageerror', error => errors.push('pageerror: ' + error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
    });
    return { context, requests, errors, page: await context.newPage() };
}

try {
    for (const [name, options] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['mobile', devices['Pixel 7']]]) {
        const { context, page, requests, errors } = await setup(options);
        await page.goto(BASE + '/index.html');
        await page.waitForSelector('#shout-giscus-mount[data-state="ready"]');
        await page.evaluate(() => showSection('guestbook'));
        const embedded = page.frameLocator('iframe[title="Guestbook"]');
        await embedded.locator('#giscus-mount[data-state="ready"]').waitFor();
        const shout = new URL(await page.locator('#shout-giscus-mount iframe').getAttribute('src'));
        const guest = new URL(await embedded.locator('#giscus-mount iframe').getAttribute('src'));
        check(shout.searchParams.get('term') === 'Shoutbox' && guest.searchParams.get('term') === 'Guestbook', name + ': both boards keep their distinct terms');
        for (const url of [shout, guest]) {
            check(url.searchParams.get('repo') === 'MrHakan/mrhakan.github.io' && url.searchParams.get('categoryId') === 'DIC_kwDOFNnvlM4DEF5L', name + ': verified repository and category reach the widget');
            check(url.searchParams.get('mapping') === 'specific' && url.searchParams.get('theme') === origin + '/css/giscus-win98.css', name + ': specific mapping and Win98 theme are preserved');
        }
        check(await page.locator('#shout-giscus-mount iframe').count() === 1 && await embedded.locator('#giscus-mount iframe').count() === 1, name + ': mounting Guestbook never replaces Shoutbox');
        check(!await page.locator('#shout-name').isVisible() && !await embedded.locator('#guestbook-form').isVisible(), name + ': legacy forms hide only when configured');
        for (const frame of page.frames().filter(frame => new URL(frame.url()).origin === origin)) {
            check(await frame.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2), name + ': no horizontal overflow in either document');
        }
        check(requests.filter(url => url.includes('/client.js')).length === 2, name + ': both clients use the external fixture');
        const css = await context.request.get(BASE + '/css/giscus-win98.css');
        check(css.ok() && (await css.text()).includes('--w98-face'), name + ': actual custom CSS is served');
        await page.screenshot({ path: '.ci-shots/giscus-' + name + '.png', fullPage: true });
        check(errors.length === 0, name + ': no browser exceptions or console errors: ' + errors.join('\n'));

        // Prove the collector still reports both application failures and CORS
        // errors. These intentional sentinels are asserted, never filtered out.
        await context.route('https://giscus.app/cors-probe', route => route.fulfill({ body: 'wrong CORS origin', headers: { 'Access-Control-Allow-Origin': 'https://untrusted.invalid' } }));
        await page.evaluate(async () => {
            await fetch('https://giscus.app/cors-probe').catch(() => {});
            setTimeout(() => { throw new Error('application regression sentinel'); }, 0);
        });
        await page.waitForFunction(() => true);
        await new Promise(resolve => setTimeout(resolve, 100));
        check(errors.some(error => error.includes('CORS policy')) && errors.some(error => error.includes('application regression sentinel')), name + ': error collector detects real CORS and application failures');
        await context.unrouteAll({ behavior: 'wait' });
        await context.close();
    }

    for (const [name, config] of [['disabled', {}], ['partial', { repo: 'MrHakan/mrhakan.github.io', repoId: 'R_test', categoryId: '' }]]) {
        const { context, page, requests, errors } = await setup({}, 'ready', config);
        await page.goto(BASE + '/guestbook.html');
        await page.waitForFunction(() => document.querySelector('#guestbook-entries').textContent !== 'loading entries...');
        check(await page.locator('#guestbook-form').isVisible() && requests.length === 0, name + ': incomplete configuration keeps the legacy board');
        await page.goto(BASE + '/index.html');
        await page.evaluate(() => showSection('guestbook'));
        await page.frameLocator('iframe[title="Guestbook"]').locator('#guestbook-form').waitFor();
        check(await page.locator('#shout-name').isVisible() && requests.length === 0, name + ': the embedded Guestbook and Shoutbox both retain legacy signing');
        check(errors.length === 0, name + ': fallback has no application errors');
        await context.unrouteAll({ behavior: 'wait' });
        await context.close();
    }

    {
        const { context, page, errors } = await setup({}, 'missing');
        await page.goto(BASE + '/guestbook.html');
        await page.waitForSelector('#giscus-mount[data-state="ready"]');
        check(!await page.locator('#guestbook-form').isVisible(), 'an empty discussion keeps Giscus available for the first comment');
        await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
            origin: 'https://giscus.app', source: window, data: { giscus: { error: 'forged failure' } }
        })));
        check(await page.locator('#giscus-mount').getAttribute('data-state') === 'ready', 'messages from another window cannot fail the board');
        check(errors.length === 0, 'empty-discussion handling has no browser errors');
        await context.unrouteAll({ behavior: 'wait' });
        await context.close();
    }
    {
        const { context, page } = await setup({}, 'silent');
        await page.clock.install();
        await page.goto(BASE + '/guestbook.html');
        await page.locator('#giscus-mount').scrollIntoViewIfNeeded();
        await page.waitForSelector('#giscus-mount iframe');
        await page.clock.runFor(16000);
        await page.waitForSelector('#giscus-mount[data-state="failed"]');
        check(await page.locator('#guestbook-form').isVisible(), 'a visible iframe that never responds restores the legacy board');
        await context.unrouteAll({ behavior: 'wait' });
        await context.close();
    }

    for (const mode of ['blocked', 'error']) {
        const { context, page, errors } = await setup({}, mode);
        await page.goto(BASE + '/index.html');
        await page.waitForSelector('#shout-giscus-mount[data-state="failed"]');
        await page.evaluate(() => showSection('guestbook'));
        const guest = page.frameLocator('iframe[title="Guestbook"]');
        await guest.locator('#giscus-mount[data-state="failed"]').waitFor();
        check(await page.locator('#shout-name').isVisible() && await guest.locator('#guestbook-form').isVisible(), mode + ': each failed board restores its legacy form');
        check((await page.locator('#shout-giscus-mount a').getAttribute('href')).includes('Shoutbox') && (await guest.locator('#giscus-mount a').getAttribute('href')).includes('Guestbook'), mode + ': GitHub fallback links remain distinct');
        check(!errors.some(error => error.startsWith('pageerror:') || error.includes('CORS')), mode + ': failure recovery introduces no exception or CORS error');
        await context.unrouteAll({ behavior: 'wait' });
        await context.close();
    }
    console.log(`All ${checks} Giscus browser checks passed`);
} finally {
    for (const context of browser.contexts()) await context.unrouteAll({ behavior: 'wait' });
    await browser.close();
}
