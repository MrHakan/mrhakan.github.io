// ===================================================================
// tankz-preview.mjs — join/tankz/preview.jpg, out of the game itself
//
// A chat app shows this when somebody pastes an invite. It is a real frame of
// a real match (six hard bots, a few seconds in) drawn by the game's own
// renderer, with the name on a grey dialog beside it.
//
//   node .github/scripts/tankz-preview.mjs        writes join/tankz/preview.jpg
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
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
await ctx.route('**/*', r => /^https?:\/\/127\.0\.0\.1[:/]/.test(r.request().url()) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
await ctx.addInitScript(() => { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:' + server.address().port + '/?app=tankz', { waitUntil: 'load' });
await p.waitForSelector('.tk-menu', { timeout: 20000 });
await p.evaluate(() => { TK_ENGINE.startLocal({ humans: 1, bots: 5, level: 'hard', points: 10, size: 'medium', seed: 4242 }); TK_ENGINE.drive(0, 'hard'); });
await p.waitForTimeout(5200);
const url = await p.evaluate(() => {
    const src = document.getElementById('tk-canvas');
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 630;
    const x = c.getContext('2d');
    x.fillStyle = '#008080'; x.fillRect(0, 0, 1200, 630);
    // the maze on the right, as big as the card is tall
    const top = 30 * (src.width / src.clientWidth);
    const sh = src.height - top, k = 630 / sh, w = src.width * k;
    x.drawImage(src, 0, top, src.width, sh, 1200 - w + 40, 0, w, 630);
    // a dialog on the left with the name
    const bx = 40, by = 150, bw = 430, bh = 300;
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(bx + 6, by + 6, bw, bh);
    x.fillStyle = '#c0c0c0'; x.fillRect(bx, by, bw, bh);
    x.fillStyle = '#fff'; x.fillRect(bx, by, bw, 3); x.fillRect(bx, by, 3, bh);
    x.fillStyle = '#000'; x.fillRect(bx, by + bh - 3, bw, 3); x.fillRect(bx + bw - 3, by, 3, bh);
    const g = x.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#000080'); g.addColorStop(1, '#1084d0');
    x.fillStyle = g; x.fillRect(bx + 6, by + 6, bw - 12, 34);
    x.fillStyle = '#fff'; x.font = 'bold 20px Tahoma, sans-serif'; x.textBaseline = 'middle';
    x.fillText('tankz 98', bx + 16, by + 24);
    x.font = 'italic 900 92px "Arial Black", Tahoma, sans-serif'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#808080'; x.fillText('tankz', bx + 34, by + 154);
    x.fillStyle = '#fff'; x.fillText('tankz', bx + 30, by + 150);
    x.fillStyle = '#000080'; x.fillText('tankz', bx + 28, by + 148);
    x.fillStyle = '#d82020'; x.font = 'bold 34px Tahoma, sans-serif'; x.fillText('98', bx + 360, by + 92);
    x.fillStyle = '#000'; x.font = '21px Tahoma, sans-serif';
    x.fillText('tanks in a maze. shells bounce.', bx + 30, by + 200);
    x.fillText('yours too. join my room', bx + 30, by + 232);
    return c.toDataURL('image/jpeg', 0.86);
});
const out = path.join(ROOT, 'join/tankz/preview.jpg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log('wrote ' + path.relative(ROOT, out) + ', ' + Math.round(fs.statSync(out).size / 1024) + 'kb');
await browser.close();
server.close();
