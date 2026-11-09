// Render the share card from the same local art and renderer used by the game.
import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    await page.addInitScript(() => { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); });
    await page.goto((process.env.SITE_URL || 'http://127.0.0.1:8099') + '/?app=brawlz');
    await page.waitForFunction(() => window.RIFT_ART?.ready());
    await page.evaluate(() => {
        const cv = document.createElement('canvas'); cv.id = 'rr-share-card'; cv.width = 1200; cv.height = 630;
        Object.assign(cv.style, { position: 'fixed', zIndex: '2147483647', left: '0', top: '0', width: '1200px', height: '630px' }); document.body.appendChild(cv);
        const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
        RIFT_STAGES.background(c, RIFT.ARENAS[0], 0); c.fillStyle = '#0c254caa'; c.fillRect(0, 0, 1200, 630);
        c.fillStyle = '#ffedb5'; c.font = 'italic 900 69px Arial Black,sans-serif'; c.fillText('BRAWLZ 98', 42, 87);
        c.fillStyle = '#b3e6d6'; c.font = '18px Trebuchet MS,sans-serif'; c.fillText('12 cursed residents. One very unstable desktop.', 46, 121);
        c.fillStyle = '#daeae6'; c.font = 'bold 20px Trebuchet MS,sans-serif'; c.textAlign = 'right'; c.fillText('ONLINE 1v1 / 2v2', 1154, 69); c.font = '14px Trebuchet MS,sans-serif'; c.fillText('Share a code. Settle the argument.', 1154, 98);
        for (let i = 0; i < 12; i++) {
            const x = 104 + (i % 6) * 196, y = i < 6 ? 322 : 552;
            c.fillStyle = '#234a6877'; c.fillRect(x - 79, y - 172, 158, 191);
            RIFT_RENDER.sprite(c, x, y - 9, i, { scale: 2.25 });
            c.textAlign = 'center'; c.fillStyle = '#fff0bd'; c.font = 'bold 15px Trebuchet MS,sans-serif'; c.fillText(RIFT.FIGHTERS[i].name, x, y + 12);
        }
        c.textAlign = 'center'; c.fillStyle = '#d7e6dc'; c.font = '13px Trebuchet MS,sans-serif'; c.fillText('mrhakan.github.io/?app=brawlz', 600, 608);
    });
    fs.mkdirSync('join/riftrumble', { recursive: true });
    await page.locator('#rr-share-card').screenshot({ path: 'join/riftrumble/preview.jpg', type: 'jpeg', quality: 77 });
    console.log('Wrote 1200 × 630 Brawlz invite card.');
} finally { await browser.close(); }
