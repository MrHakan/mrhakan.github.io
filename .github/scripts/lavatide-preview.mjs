// ===================================================================
// lavatide-preview.mjs — join/lavatide/preview.jpg, out of the game itself
//
// What a chat app shows when somebody pastes an invite: a real frame of the
// last temple a few seconds in, drawn by the game's own renderer, with the
// name on a grey dialog beside it.
//
//   node .github/scripts/lavatide-preview.mjs      writes join/lavatide/preview.jpg
// ===================================================================
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
    let file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
try {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, deviceScaleFactor: 2 });
    await ctx.route('**/*', r => /^https?:\/\/127\.0\.0\.1[:/]/.test(r.request().url()) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
    await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (e) { } });
    const p = await ctx.newPage();
    await p.goto('http://127.0.0.1:' + server.address().port + '/?app=lavatide', { waitUntil: 'load' });
    await p.waitForSelector('.lt-panel .lt-logo', { timeout: 20000 });
    await p.evaluate(() => { LT_ENGINE.start(11, 'duo'); LT_ENGINE.autopilot(true); });
    await p.waitForTimeout(6200);
    await p.evaluate(() => { const g = LT_ENGINE.state(); g.paused = true; });
    await p.waitForTimeout(100);
    const url = await p.evaluate(() => {
        const src = document.getElementById('lt-canvas');
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 630;
        const x = c.getContext('2d');
        x.fillStyle = '#008080'; x.fillRect(0, 0, 1200, 630);
        // the temple on the right, as tall as the card
        const h = 630, w = src.width * h / src.height;
        x.imageSmoothingQuality = 'high';
        x.drawImage(src, 1200 - w, 0, w, h);
        // a dialog on the left
        const bx = 30, by = 150, bw = 400, bh = 320;
        x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(bx + 6, by + 6, bw, bh);
        x.fillStyle = '#c0c0c0'; x.fillRect(bx, by, bw, bh);
        x.fillStyle = '#fff'; x.fillRect(bx, by, bw, 3); x.fillRect(bx, by, 3, bh);
        x.fillStyle = '#000'; x.fillRect(bx, by + bh - 3, bw, 3); x.fillRect(bx + bw - 3, by, 3, bh);
        const g = x.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#000080'); g.addColorStop(1, '#1084d0');
        x.fillStyle = g; x.fillRect(bx + 6, by + 6, bw - 12, 34);
        x.fillStyle = '#fff'; x.font = 'bold 20px Tahoma, sans-serif'; x.textBaseline = 'middle';
        x.fillText('lava & tide 98', bx + 16, by + 24);
        x.textBaseline = 'alphabetic';
        x.font = 'italic 900 68px "Arial Black", Tahoma, sans-serif';
        const word = (t, px, py, col) => { x.fillStyle = '#808080'; x.fillText(t, px + 4, py + 4); x.fillStyle = '#fff'; x.fillText(t, px + 2, py + 2); x.fillStyle = col; x.fillText(t, px, py); };
        word('lava', bx + 28, by + 118, '#d83000');
        x.font = 'italic 900 40px "Arial Black", Tahoma, sans-serif'; word('&', bx + 222, by + 112, '#000080');
        x.font = 'italic 900 68px "Arial Black", Tahoma, sans-serif'; word('tide', bx + 100, by + 196, '#1060c0');
        x.fillStyle = '#000'; x.font = '21px Tahoma, sans-serif';
        x.fillText('one walks through fire, one through', bx + 28, by + 248);
        x.fillText('water. both doors, together. join me', bx + 28, by + 278);
        return c.toDataURL('image/jpeg', 0.86);
    });
    const out = path.join(ROOT, 'join/lavatide/preview.jpg');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log('wrote ' + path.relative(ROOT, out) + ', ' + kb + 'kb');
    if (kb >= 300) { console.error('too big for a preview'); process.exitCode = 1; }
} finally {
    await browser.close();
    server.close();
}
