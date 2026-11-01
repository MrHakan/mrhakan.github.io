// Exercise the real board loader and markup, replacing only remote services.
// This test must report application exceptions and CORS errors, including in
// the embedded Guestbook document. No console-error filter is used here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, devices } from 'playwright';
import { mockGiscus } from './mock-giscus.mjs';

const BASE = process.env.SITE_URL || 'http://localhost:8099';
const origin = new URL(BASE).origin;
const productionGiscus = JSON.parse(fs.readFileSync('data/site.json', 'utf8')).giscus;
const tailwind = await (await fetch('https://cdn.tailwindcss.com?plugins=forms,container-queries')).text();
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
fs.mkdirSync('.ci-shots', { recursive: true });
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; console.log('ok ' + message); };

// Keep testing the dormant composer with an explicit enabled fixture while
// separately verifying the actual disabled production configuration below.
async function setup(options = {}, mode = 'ready', config = { ...productionGiscus, enabled: true }) {
    const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
    await context.addInitScript(() => {
        sessionStorage.setItem('welcomed', '1');
        sessionStorage.setItem('booted', '1');
        window.__openedUrls = [];
        window.open = url => { window.__openedUrls.push(String(url)); return null; };
        Object.defineProperty(navigator, 'clipboard', { configurable: true,
            value: { writeText: value => { window.__copied = value; return Promise.resolve(); } } });
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

const draftMessage = 'hello <img src=x onerror="window.__draftExecuted=1">';
const gistIds = { shouts: '73cb5a6e7e8325e0858427b255a95a87', guestbook: '498b5a262bbba0289a344d0d75cc1683' };
async function fillBoard(scope, kind) {
    await scope.locator(kind === 'shouts' ? '#shout-name' : '#gb-name').fill('test visitor');
    await scope.locator(kind === 'shouts' ? '#shout-message' : '#gb-message').fill(draftMessage);
    if (kind === 'guestbook') await scope.locator('#gb-website').fill('example.com');
    await scope.locator(kind === 'shouts' ? 'button[onclick="postShout()"]' : '#guestbook-form button[type="submit"]').click();
}
const closeContext = async context => {
    await context.unrouteAll({ behavior: 'wait' });
    await context.close();
};
async function oldSchool(scope, kind) {
    await scope.getByRole('button', { name: 'Eski usul', exact: true }).click();
    check((await scope.locator('.retro-dialog-pre').textContent()).includes(draftMessage), kind + ': old-school preview retains the draft');
    await scope.getByRole('button', { name: 'copy + open the gist', exact: true }).click();
    const state = await scope.locator('body').evaluate(() => ({ copied: window.__copied, opened: window.__openedUrls, executed: !!window.__draftExecuted }));
    check(state.copied.includes(draftMessage) && state.opened.at(-1) === 'https://gist.github.com/MrHakan/' + gistIds[kind] + '#comments', kind + ': old school copies the message and opens its own Gist');
    check(!state.executed, kind + ': draft markup never executes');
}
async function giscusComposer(scope, kind) {
    await scope.getByRole('button', { name: 'Giscus ile devam et', exact: true }).click();
    const title = kind === 'shouts' ? 'Giscus Shoutbox' : 'Giscus Guestbook';
    const composer = scope.frameLocator('iframe[title="' + title + '"]');
    await composer.locator('#giscus-mount[data-state="ready"]').waitFor();
    const url = new URL(await composer.locator('#giscus-mount iframe').getAttribute('src'));
    check(url.searchParams.get('term') === (kind === 'shouts' ? 'Shoutbox' : 'Guestbook'), kind + ': Giscus reaches its distinct discussion term');
    check(url.searchParams.get('repo') === 'MrHakan/mrhakan.github.io' && url.searchParams.get('categoryId') === 'DIC_kwDOFNnvlM4DEF5L', kind + ': verified repo and category reach the widget');
    check(url.searchParams.get('mapping') === 'specific' && url.searchParams.get('theme') === origin + '/css/giscus-win98.css', kind + ': mapping and Win98 theme survive the optional composer');
    const copied = await scope.locator('body').evaluate(() => window.__copied);
    check(copied.includes(draftMessage), kind + ': the Giscus choice copies the draft for pasting');
    const src = await scope.locator('iframe[title="' + title + '"]').getAttribute('src');
    check(!new URL(src, BASE).searchParams.has('giscus') && !src.includes('test visitor') && !src.includes('onerror') && !src.includes('hello'), kind + ': draft content is never put in a URL');
    check(!await composer.locator('#guestbook-form').isVisible(), kind + ': the composer does not expose the wrong legacy form');
    return composer;
}

try {
    {
        check(productionGiscus.enabled === false, 'Giscus is explicitly disabled in production');
        const { context, page, requests, errors } = await setup({}, 'ready', productionGiscus);
        await page.goto(BASE + '/index.html');
        await page.evaluate(() => showSection('guestbook'));
        const guest = page.frameLocator('#guestbook-frame');
        for (const [scope, kind] of [[page, 'shouts'], [guest, 'guestbook']]) {
            await fillBoard(scope, kind);
            await page.getByRole('button', { name: 'copy + open the gist', exact: true }).waitFor();
            check(await page.getByRole('button', { name: 'Giscus ile devam et', exact: true }).count() === 0,
                kind + ': submit goes straight to the original Gist flow without a chooser');
            check((await page.locator('.retro-dialog-pre').textContent()).includes(draftMessage), kind + ': original flow retains the draft');
            await page.getByRole('button', { name: 'nevermind', exact: true }).click();
        }
        await page.goto(BASE + '/guestbook.html?composer=giscus&board=shouts');
        await page.locator('#giscus-mount').filter({ hasText: 'not configured' }).waitFor();
        check(requests.length === 0 && errors.length === 0, 'disabled Giscus makes no widget requests, including direct composer links');
        await closeContext(context);
    }
    for (const [name, options] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['mobile', devices['Pixel 7']]]) {
        const { context, page, requests, errors } = await setup(options);
        await page.goto(BASE + '/index.html');
        await page.locator('#shout-name').waitFor();
        await page.evaluate(() => showSection('guestbook'));
        const embedded = page.frameLocator('#guestbook-frame');
        await embedded.locator('#guestbook-form').waitFor();
        check(requests.length === 0, name + ': both original boards load without contacting Giscus');
        await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
            origin: location.origin, source: window, data: { guestbookSign: { name: 'forged', message: 'not a visitor submission' } }
        })));
        check(await page.locator('.retro-dialog-overlay').count() === 0, name + ': only the actual Guestbook frame can request its chooser');
        check(await page.locator('#shoutbox-messages').isVisible() && await page.locator('#shout-name').isVisible(), name + ': original compact Shoutbox wall and inputs stay visible');
        check(await page.locator('#shout-giscus-mount').count() === 0, name + ': no large widget replaces Shoutbox');
        await page.screenshot({ path: '.ci-shots/boards-legacy-' + name + '.png', fullPage: true });

        await fillBoard(page, 'shouts');
        check(await page.getByRole('button', { name: 'Giscus ile devam et', exact: true }).isVisible() && await page.getByRole('button', { name: 'Eski usul', exact: true }).isVisible(), name + ': submitting offers both posting methods');
        await page.getByRole('button', { name: 'vazgeç', exact: true }).click();
        check(await page.locator('#shout-message').inputValue() === draftMessage && requests.length === 0, name + ': cancelling keeps the draft and loads no widget');
        await fillBoard(page, 'shouts');
        await giscusComposer(page, 'shouts');
        check(await page.locator('#shout-message').inputValue() === draftMessage, name + ': opening Giscus preserves the original Shoutbox draft');
        await page.getByRole('button', { name: 'yöntem seçimine dön', exact: true }).click();
        await oldSchool(page, 'shouts');

        await fillBoard(embedded, 'guestbook');
        await giscusComposer(page, 'guestbook');
        check(await page.locator('#shout-name').isVisible(), name + ': Guestbook composer never replaces Shoutbox');
        for (const frame of page.frames().filter(frame => new URL(frame.url()).origin === origin)) {
            check(await frame.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2), name + ': board and method dialogs fit the screen');
        }
        check(requests.filter(url => url.includes('/client.js')).length === 2, name + ': widgets load only for the two explicit choices');
        const css = await context.request.get(BASE + '/css/giscus-win98.css');
        check(css.ok() && (await css.text()).includes('--w98-face'), name + ': real custom stylesheet remains served');
        await page.screenshot({ path: '.ci-shots/boards-giscus-' + name + '.png', fullPage: true });
        await page.getByRole('button', { name: 'yöntem seçimine dön', exact: true }).click();
        await oldSchool(page, 'guestbook');
        check(errors.length === 0, name + ': no browser exceptions or console errors: ' + errors.join('\n'));

        // Keep a real rejected cross-origin request and an application throw:
        // changing the default board must never mask the original CI failure.
        await context.route('https://giscus.app/cors-probe', route => route.fulfill({ body: 'wrong CORS origin', headers: { 'Access-Control-Allow-Origin': 'https://untrusted.invalid' } }));
        await page.evaluate(async () => {
            await fetch('https://giscus.app/cors-probe').catch(() => {});
            setTimeout(() => { throw new Error('application regression sentinel'); }, 0);
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        check(errors.some(error => error.includes('CORS policy')) && errors.some(error => error.includes('application regression sentinel')), name + ': collector still detects real CORS and application failures');
        await closeContext(context);
    }

    for (const [name, config] of [['disabled', {}], ['partial', { repo: 'MrHakan/mrhakan.github.io', repoId: 'R_test', categoryId: '' }]]) {
        const { context, page, requests, errors } = await setup({}, 'ready', config);
        await page.goto(BASE + '/guestbook.html');
        await fillBoard(page, 'guestbook');
        await page.getByRole('button', { name: 'copy + open the gist', exact: true }).waitFor();
        check(await page.locator('#guestbook-form').isVisible() && requests.length === 0, name + ': unconfigured Giscus retains the working old-school flow');
        await page.goto(BASE + '/guestbook.html?composer=giscus&board=shouts');
        await page.locator('#giscus-mount').filter({ hasText: 'not configured' }).waitFor();
        check(!await page.locator('#guestbook-form').isVisible() && requests.length === 0, name + ': a missing Shoutbox config never posts to Guestbook instead');
        check(errors.length === 0, name + ': no application errors');
        await closeContext(context);
    }
    {
        const { context, page, errors } = await setup({}, 'missing');
        await page.goto(BASE + '/guestbook.html?composer=giscus');
        await page.waitForSelector('#giscus-mount[data-state="ready"]');
        check(!await page.locator('#guestbook-form').isVisible(), 'empty discussions stay available for a first Giscus comment');
        await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
            origin: 'https://giscus.app', source: window, data: { giscus: { error: 'forged failure' } }
        })));
        check(await page.locator('#giscus-mount').getAttribute('data-state') === 'ready', 'another window cannot fail the composer');
        check(errors.length === 0, 'empty-discussion handling has no browser errors');
        await closeContext(context);
    }
    {
        const { context, page, errors } = await setup({}, 'silent');
        await page.clock.install();
        await page.goto(BASE + '/guestbook.html?composer=giscus&board=shouts');
        await page.locator('#giscus-mount').scrollIntoViewIfNeeded();
        await page.waitForSelector('#giscus-mount iframe');
        await page.clock.runFor(16000);
        await page.waitForSelector('#giscus-mount[data-state="failed"]');
        check((await page.locator('#giscus-mount a').getAttribute('href')).includes('Shoutbox'), 'a stalled composer offers the correct GitHub discussion');
        check(!await page.locator('#guestbook-form').isVisible() && errors.length === 0, 'a stalled Shoutbox never exposes a Guestbook posting form');
        await closeContext(context);
    }
    for (const mode of ['blocked', 'error']) {
        const { context, page, errors } = await setup({}, mode);
        await page.goto(BASE + '/index.html');
        await page.evaluate(() => showSection('guestbook'));
        const embedded = page.frameLocator('#guestbook-frame');
        for (const [scope, kind] of [[page, 'shouts'], [embedded, 'guestbook']]) {
            await fillBoard(scope, kind);
            await page.getByRole('button', { name: 'Giscus ile devam et', exact: true }).click();
            const title = kind === 'shouts' ? 'Giscus Shoutbox' : 'Giscus Guestbook';
            const composer = page.frameLocator('iframe[title="' + title + '"]');
            await composer.locator('#giscus-mount[data-state="failed"]').waitFor();
            check((await composer.locator('#giscus-mount a').getAttribute('href')).includes(kind === 'shouts' ? 'Shoutbox' : 'Guestbook'), mode + ': ' + kind + ' fallback uses its own thread');
            await page.getByRole('button', { name: 'yöntem seçimine dön', exact: true }).click();
            await oldSchool(page, kind);
        }
        check(!errors.some(error => error.startsWith('pageerror:') || error.includes('CORS')), mode + ': recovery introduces no application exception or CORS error');
        await closeContext(context);
    }
    console.log(`All ${checks} Giscus browser checks passed`);
} finally {
    for (const context of browser.contexts()) await context.unrouteAll({ behavior: 'wait' });
    await browser.close();
}
