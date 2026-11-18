// ===================================================================
// kartz-preview.mjs — join/kartz/preview.jpg, out of the game itself
//
// A chat app shows this when somebody pastes an invite. It is a real frame of
// a real batak table (a seeded deal, the bots a few tricks in) drawn by the
// game's own page, with the name on a grey dialog beside it.
//
//   node .github/scripts/kartz-preview.mjs        writes join/kartz/preview.jpg
// ===================================================================
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2' };
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
await p.goto('http://127.0.0.1:' + server.address().port + '/?app=kartz', { waitUntil: 'load' });
await p.waitForSelector('.kz-menu', { timeout: 20000 });
// a seeded deal, played by bots until somebody is mid-trick on your turn
await p.evaluate(() => { KARTZ_ENGINE.startSolo({ game: 'batak', seed: 4242, length: 'long' }); KARTZ_ENGINE.auto(true); KARTZ_ENGINE.ff(50); });
await p.waitForFunction(() => { const s = KARTZ_ENGINE.state(); return s.trickNo >= 3 && s.phase === 'play' && s.trick.length >= 2 && s.turn === 0; }, null, { timeout: 30000, polling: 5 });
await p.evaluate(() => { KARTZ_ENGINE.auto(false); KARTZ_ENGINE.ff(1); document.querySelectorAll('.kz-feed').forEach(e => { e.style.display = 'none'; }); });
await p.waitForTimeout(500);
const shot = await p.locator('.kz-stage').screenshot({ type: 'png' });
const url = await p.evaluate(async src => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 630;
    const x = c.getContext('2d');
    x.fillStyle = '#008080'; x.fillRect(0, 0, 1200, 630);
    // the table on the right, as tall as the card
    const k = 630 / img.height, w = img.width * k;
    x.drawImage(img, 1200 - w, 0, w, 630);
    // a dialog on the left with the name
    const bx = 40, by = 150, bw = 430, bh = 300;
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(bx + 6, by + 6, bw, bh);
    x.fillStyle = '#c0c0c0'; x.fillRect(bx, by, bw, bh);
    x.fillStyle = '#fff'; x.fillRect(bx, by, bw, 3); x.fillRect(bx, by, 3, bh);
    x.fillStyle = '#000'; x.fillRect(bx, by + bh - 3, bw, 3); x.fillRect(bx + bw - 3, by, 3, bh);
    const g = x.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#000080'); g.addColorStop(1, '#1084d0');
    x.fillStyle = g; x.fillRect(bx + 6, by + 6, bw - 12, 34);
    x.fillStyle = '#fff'; x.font = 'bold 20px Tahoma, sans-serif'; x.textBaseline = 'middle';
    x.fillText('kartz 98', bx + 16, by + 24);
    x.font = 'italic 900 92px "Arial Black", Tahoma, sans-serif'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#808080'; x.fillText('kartz', bx + 34, by + 154);
    x.fillStyle = '#fff'; x.fillText('kartz', bx + 30, by + 150);
    x.fillStyle = '#000080'; x.fillText('kartz', bx + 28, by + 148);
    x.fillStyle = '#d82020'; x.font = 'bold 34px Tahoma, sans-serif'; x.fillText('98', bx + 360, by + 92);
    x.fillStyle = '#000'; x.font = '21px Tahoma, sans-serif';
    x.fillText('batak, king and pisti for four.', bx + 30, by + 200);
    x.fillText('sit at my card table', bx + 30, by + 232);
    return c.toDataURL('image/jpeg', 0.86);
}, shot.toString('base64'));
const out = path.join(ROOT, 'join/kartz/preview.jpg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log('wrote ' + path.relative(ROOT, out) + ', ' + Math.round(fs.statSync(out).size / 1024) + 'kb');
await browser.close();
server.close();
