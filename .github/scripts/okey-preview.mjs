// ===================================================================
// okey-preview.mjs — join/okey/preview.jpg, out of the game itself
//
// A chat app shows this when somebody pastes an invite. It is a real frame of
// a real hand (three bots and an autopilot, a few turns in) drawn by the
// game's own canvas, with the name on a grey dialog beside it.
//
//   node .github/scripts/okey-preview.mjs        writes join/okey/preview.jpg
// ===================================================================
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
    let file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
await ctx.route('**/*', r => /^https?:\/\/127\.0\.0\.1[:/]/.test(r.request().url()) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
await ctx.addInitScript(() => { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:' + server.address().port + '/?app=okey', { waitUntil: 'load' });
await p.evaluate(() => document.getElementById('boot-screen')?.remove());
await p.waitForFunction(() => window.OKEY_ENGINE && document.querySelector('.ok-canvas'), null, { timeout: 20000 });
await p.waitForTimeout(800);
// a few turns of four bots, then the autopilot hands the seat back
await p.evaluate(() => { OKEY_ENGINE.startLocal({ seed: 9182, mode: 'classic', start: 20, level: 'hard', dealer: 3 }); OKEY_ENGINE.match().seats[0].bot = true; OKEY_ENGINE.speed(30); });
await p.waitForFunction(() => OKEY_ENGINE.view().turns >= 9, null, { timeout: 20000 });
await p.evaluate(() => { OKEY_ENGINE.match().seats[0].bot = false; });
await p.waitForFunction(() => OKEY_ENGINE.view().turn === 0 && !OKEY_ENGINE.state().flyers.length, null, { timeout: 20000 });
await p.keyboard.press('s');
await p.waitForTimeout(400);
const url = await p.evaluate(() => {
    const src = document.querySelector('.ok-canvas');
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 630;
    const x = c.getContext('2d');
    x.fillStyle = '#008080'; x.fillRect(0, 0, 1200, 630);
    // the table on the right, as tall as the card
    const k = 630 / src.height, w = src.width * k;
    x.drawImage(src, 0, 0, src.width, src.height, 1200 - w, 0, w, 630);
    // a dialog on the left with the name
    const bx = 34, by = 160, bw = 400, bh = 300;
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(bx + 6, by + 6, bw, bh);
    x.fillStyle = '#c0c0c0'; x.fillRect(bx, by, bw, bh);
    x.fillStyle = '#fff'; x.fillRect(bx, by, bw, 3); x.fillRect(bx, by, 3, bh);
    x.fillStyle = '#000'; x.fillRect(bx, by + bh - 3, bw, 3); x.fillRect(bx + bw - 3, by, 3, bh);
    const g = x.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#000080'); g.addColorStop(1, '#1084d0');
    x.fillStyle = g; x.fillRect(bx + 6, by + 6, bw - 12, 34);
    x.fillStyle = '#fff'; x.font = 'bold 20px Tahoma, sans-serif'; x.textBaseline = 'middle';
    x.fillText('okey 98', bx + 16, by + 24);
    x.font = 'italic 900 96px "Arial Black", Tahoma, sans-serif'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#808080'; x.fillText('okey', bx + 34, by + 158);
    x.fillStyle = '#fff'; x.fillText('okey', bx + 30, by + 154);
    x.fillStyle = '#000080'; x.fillText('okey', bx + 28, by + 152);
    x.fillStyle = '#d01818'; x.font = 'bold 34px Tahoma, sans-serif'; x.fillText('98', bx + 300, by + 96);
    x.fillStyle = '#000'; x.font = '21px Tahoma, sans-serif';
    x.fillText('draw, throw, finish on the okey.', bx + 30, by + 204);
    x.fillText('classic or 101. pull up a stool', bx + 30, by + 236);
    return c.toDataURL('image/jpeg', 0.85);
});
const out = path.join(ROOT, 'join/okey/preview.jpg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log('wrote ' + path.relative(ROOT, out) + ', ' + Math.round(fs.statSync(out).size / 1024) + 'kb');
await browser.close();
server.close();
