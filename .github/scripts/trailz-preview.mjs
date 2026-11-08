// ===================================================================
// trailz-preview.mjs — join/trailz/preview.jpg, out of the game itself
//
// A chat app shows this when somebody pastes an invite. It is a real frame
// of a real match (seven hard bots, the panorama camera, a few seconds in),
// drawn at 1200 x 630 by the game's own renderer, with the name on top.
//
//   node .github/scripts/trailz-preview.mjs        writes join/trailz/preview.jpg
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.route('**/*', r => /^https?:\/\/127\.0\.0\.1[:/]/.test(r.request().url()) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
await ctx.addInitScript(() => { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:' + server.address().port + '/?app=trailz', { waitUntil: 'load' });
await p.waitForSelector('.tz-menu', { timeout: 20000 });
await p.evaluate(() => { TZ_ENGINE.startSolo({ bots: 7, level: 'hard', arena: 'medium', rounds: 3, seed: 8128 }); TZ_ENGINE.drive(0, 'hard'); TZ_ENGINE.cam('high'); });
await p.waitForTimeout(9500);
const url = await p.evaluate(() => {
    const R = TZ_ENGINE.gl(), g = TZ_ENGINE.state();
    R.resize(1200, 630);
    R.frame({ s: g.s, cycles: g.view, cam: g.cam, sparks: g.sparks, t: g.t, seed: g.s.seed });
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 630;
    const x = c.getContext('2d');
    x.drawImage(R.canvas, 0, 0);
    // the name, the way the menu writes it
    x.font = 'bold 84px "Courier New", monospace';
    x.textAlign = 'left';
    x.shadowColor = '#26f2ff'; x.shadowBlur = 28; x.fillStyle = '#ffffff';
    x.fillText('trailz', 56, 120); x.fillText('trailz', 56, 120);
    const w = x.measureText('trailz').width;
    x.font = 'bold 36px "Courier New", monospace';
    x.shadowColor = '#ff8c1a'; x.fillStyle = '#ff8c1a';
    x.fillText('98', 56 + w + 14, 78);
    x.shadowBlur = 6; x.shadowColor = '#000'; x.fillStyle = '#bfefff';
    x.font = 'bold 26px "Courier New", monospace';
    x.fillText('light cycles for up to eight. join my lobby', 60, 168);
    return c.toDataURL('image/jpeg', 0.86);
});
const out = path.join(ROOT, 'join/trailz/preview.jpg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log('wrote ' + path.relative(ROOT, out) + ', ' + Math.round(fs.statSync(out).size / 1024) + 'kb');
await browser.close();
server.close();
