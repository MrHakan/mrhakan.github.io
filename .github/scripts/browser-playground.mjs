import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const base = (process.env.SITE_URL || 'http://127.0.0.1:8095').replace(/\/$/, '');
const catalog = JSON.parse(await readFile('data/playground.json', 'utf8'));
const browser = await chromium.launch({ headless: true });
const failures = [];

for (const viewport of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    for (const item of catalog) {
        const page = await context.newPage();
        const errors = [];
        const foreign = new Set();
        page.on('pageerror', error => errors.push('pageerror: ' + error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
        page.on('request', request => {
            const url = request.url();
            if (!/^https?:/i.test(url)) return;
            try {
                if (new URL(url).origin !== new URL(base).origin) foreign.add(url);
            } catch {}
        });
        try {
            const response = await page.goto(base + item.url, { waitUntil: 'domcontentloaded', timeout: 12000 });
            if (!response || response.status() >= 400) errors.push('HTTP ' + (response?.status() ?? 'no response'));
            await page.waitForTimeout(80);
            const state = await page.evaluate(() => ({
                title: document.title.trim(),
                headings: document.querySelectorAll('h1').length,
                main: !!document.querySelector('main'),
                interactive: !!document.querySelector('button,input,select,textarea,canvas'),
                overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth
            }));
            if (!state.title) errors.push('document title is empty');
            if (state.headings !== 1) errors.push('expected one page heading, found ' + state.headings);
            if (!state.main) errors.push('main element is missing');
            if (!state.interactive) errors.push('no interactive control/canvas found');
            if (state.overflow > 64) errors.push('horizontal overflow: ' + state.overflow + 'px');
            if (foreign.size) errors.push('unexpected third-party requests: ' + [...foreign].join(', '));
        } catch (error) {
            errors.push(error.message);
        }
        if (errors.length) failures.push(`${viewport.name} ${item.url}: ${errors.join(' | ')}`);
        await page.close();
    }
    await context.close();
}

await browser.close();
if (failures.length) {
    console.error('\nPlayground browser smoke failed:\n- ' + failures.join('\n- '));
    process.exit(1);
}
console.log(`Playground browser smoke OK: ${catalog.length} pages × 2 viewports.`);
