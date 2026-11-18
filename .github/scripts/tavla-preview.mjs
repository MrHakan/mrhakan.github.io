// ===================================================================
// tavla-preview.mjs — join/tavla/preview.jpg, out of the game itself
//
// What a chat app shows when somebody pastes a tavla invite: a real frame of
// a real game (two bots, a few turns in) drawn by the game's own renderer,
// with the name on a grey dialog beside it.
//
//   node .github/scripts/tavla-preview.mjs        writes join/tavla/preview.jpg
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
try {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
    await ctx.route('**/*', r => /^https?:\/\/127\.0\.0\.1[:/]/.test(r.request().url()) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
    await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (e) { } });
    const p = await ctx.newPage();
    await p.goto('http://127.0.0.1:' + server.address().port + '/?app=tavla', { waitUntil: 'load' });
    await p.waitForFunction(() => window.TAVLA_ENGINE, null, { timeout: 20000 });
    await p.evaluate(() => { TAVLA_ENGINE.startSolo({ seed: 1983, level: 'hard', points: 5 }); TAVLA_ENGINE.fast(6); TAVLA_ENGINE.game().bots[0] = 'hard'; });
    // a few turns in, stopped with fresh dice on the board
    await p.waitForFunction(() => { const s = TAVLA_ENGINE.state(); return s.log.length >= 9 && s.phase === 'move' && s.steps.length === 0; }, null, { timeout: 60000, polling: 20 });
    await p.evaluate(() => { const g = TAVLA_ENGINE.game(); g.bots[0] = null; g.bots[1] = null; g.me = 0; g.diceAt = -1e9; });
    await p.waitForTimeout(400);
    const url = await p.evaluate(() => {
        const src = document.querySelector('.tv-canvas');
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 630;
        const x = c.getContext('2d');
        x.fillStyle = '#008080'; x.fillRect(0, 0, 1200, 630);
        // the board on the right, in a grey window frame
        const bh = 560, bw = Math.round(bh * src.width / src.height), bx = 1200 - bw - 24, by = 35;
        x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(bx - 4, by - 4, bw + 16, bh + 16);
        x.fillStyle = '#c0c0c0'; x.fillRect(bx - 8, by - 8, bw + 16, bh + 16);
        x.drawImage(src, bx, by, bw, bh);
        // a dialog on the left with the name
        const dx = 34, dy = 150, dw = 400, dh = 300;
        x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(dx + 6, dy + 6, dw, dh);
        x.fillStyle = '#c0c0c0'; x.fillRect(dx, dy, dw, dh);
        x.fillStyle = '#fff'; x.fillRect(dx, dy, dw, 3); x.fillRect(dx, dy, 3, dh);
        x.fillStyle = '#000'; x.fillRect(dx, dy + dh - 3, dw, 3); x.fillRect(dx + dw - 3, dy, 3, dh);
        const g = x.createLinearGradient(dx, 0, dx + dw, 0); g.addColorStop(0, '#000080'); g.addColorStop(1, '#1084d0');
        x.fillStyle = g; x.fillRect(dx + 6, dy + 6, dw - 12, 34);
        x.fillStyle = '#fff'; x.font = 'bold 20px Tahoma, sans-serif'; x.textBaseline = 'middle';
        x.fillText('tavla 98', dx + 16, dy + 24);
        x.font = 'italic 900 92px "Arial Black", Tahoma, sans-serif'; x.textBaseline = 'alphabetic';
        x.fillStyle = '#808080'; x.fillText('tavla', dx + 34, dy + 154);
        x.fillStyle = '#fff'; x.fillText('tavla', dx + 30, dy + 150);
        x.fillStyle = '#000080'; x.fillText('tavla', dx + 28, dy + 148);
        x.fillStyle = '#d82020'; x.font = 'bold 34px Tahoma, sans-serif'; x.fillText('98', dx + 330, dy + 92);
        x.fillStyle = '#000'; x.font = '21px Tahoma, sans-serif';
        x.fillText('roll, hit, bear off first.', dx + 30, dy + 204);
        x.fillText('a mars is two. sit down', dx + 30, dy + 236);
        return c.toDataURL('image/jpeg', 0.86);
    });
    const out = path.join(ROOT, 'join/tavla/preview.jpg');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote ' + path.relative(ROOT, out) + ', ' + Math.round(fs.statSync(out).size / 1024) + 'kb');
} finally {
    await browser.close();
    server.close();
}
