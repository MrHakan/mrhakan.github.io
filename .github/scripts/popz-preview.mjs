// ===================================================================
// popz-preview.mjs — join/popz/preview.jpg, out of the game itself
//
// A chat app shows this when somebody pastes an invite. It is a real frame of
// a real game (a bot and its bot buddy on level 20) drawn by the game's own
// renderer, with the name on a grey dialog beside it.
//
//   node .github/scripts/popz-preview.mjs        writes join/popz/preview.jpg
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
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.route('**/*', r => /^https?:\/\/127\.0\.0\.1[:/]/.test(r.request().url()) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
    await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (e) { } });
    const p = await ctx.newPage();
    await p.goto('http://127.0.0.1:' + server.address().port + '/?app=popz', { waitUntil: 'load' });
    await p.waitForSelector('.pz-menu', { timeout: 20000 });
    await p.evaluate(() => { POPZ_ENGINE.startLocal({ mode: 'buddy', start: 20, seed: 4242 }); POPZ_ENGINE.autopilot(0, true); });
    await p.waitForFunction(() => { const s = POPZ_ENGINE.state(); return s.ph === 'play' && s.k > 330 && s.bubbles.length >= 5; }, null, { timeout: 30000 });
    const url = await p.evaluate(() => {
        const src = document.getElementById('pz-canvas');
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 630;
        const x = c.getContext('2d');
        x.fillStyle = '#008080'; x.fillRect(0, 0, 1200, 630);
        // the playfield on the right, as tall as the card
        const k = 630 / src.height, w = src.width * k;
        x.drawImage(src, 0, 0, src.width, src.height, 1200 - w, 0, w, 630);
        // a dialog on the left with the name
        const bx = 30, by = 150, bw = 400, bh = 300;
        x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(bx + 6, by + 6, bw, bh);
        x.fillStyle = '#c0c0c0'; x.fillRect(bx, by, bw, bh);
        x.fillStyle = '#fff'; x.fillRect(bx, by, bw, 3); x.fillRect(bx, by, 3, bh);
        x.fillStyle = '#000'; x.fillRect(bx, by + bh - 3, bw, 3); x.fillRect(bx + bw - 3, by, 3, bh);
        const g = x.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#000080'); g.addColorStop(1, '#1084d0');
        x.fillStyle = g; x.fillRect(bx + 6, by + 6, bw - 12, 34);
        x.fillStyle = '#fff'; x.font = 'bold 20px Tahoma, sans-serif'; x.textBaseline = 'middle';
        x.fillText('popz 98', bx + 16, by + 24);
        x.font = 'italic 900 96px "Arial Black", Tahoma, sans-serif'; x.textBaseline = 'alphabetic';
        x.fillStyle = '#808080'; x.fillText('popz', bx + 34, by + 154);
        x.fillStyle = '#fff'; x.fillText('popz', bx + 30, by + 150);
        x.fillStyle = '#000080'; x.fillText('popz', bx + 28, by + 148);
        x.fillStyle = '#d82020'; x.font = 'bold 34px Tahoma, sans-serif'; x.fillText('98', bx + 300, by + 92);
        x.fillStyle = '#000'; x.font = '21px Tahoma, sans-serif';
        x.fillText('shoot the bubbles. split them', bx + 30, by + 200);
        x.fillText('till they pop. pop them with me', bx + 30, by + 232);
        return c.toDataURL('image/jpeg', 0.86);
    });
    const out = path.join(ROOT, 'join/popz/preview.jpg');
    fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote ' + path.relative(ROOT, out) + ', ' + Math.round(fs.statSync(out).size / 1024) + 'kb');
} finally {
    await browser.close();
    server.close();
}
