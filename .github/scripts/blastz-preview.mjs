// ===================================================================
// blastz-preview.mjs — join/blastz/preview.jpg, out of the game itself
//
// What a chat app shows when somebody pastes an invite: a real frame of a
// four-bot match, drawn at 1200 x 630 by the game's own renderer, with the
// name on top.
//
//   node .github/scripts/blastz-preview.mjs        writes join/blastz/preview.jpg
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
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.route('**/*', r => /^https?:\/\/127\.0\.0\.1[:/]/.test(r.request().url()) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
await ctx.addInitScript(() => { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); localStorage.setItem('mrhakan98-blastz-prefs', JSON.stringify({ map: 'start', count: 4, lives: 5, humans: 1, music: false })); });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:' + server.address().port + '/?app=blastz', { waitUntil: 'load' });
await p.waitForSelector('.bz-menu', { timeout: 20000 });
await p.waitForFunction(() => RIFT_ART.ready());
await p.click('[data-act=solo]');
await p.waitForFunction(() => BLASTZ_ENGINE.state()?.s.phase === 'fight');
await p.evaluate(() => { BLASTZ_ENGINE.state().s.players[0].bot = true; });
// a few seconds in, at a moment with bullets in the air and a crate down
await p.waitForFunction(() => { const s = BLASTZ_ENGINE.state().s; return s.tick > 900 && s.shots.length >= 3 && s.players.every(q => !q.dead && !q.out) && s.crates.length > 0; }, null, { timeout: 60000, polling: 50 });
const url = await p.evaluate(() => {
    BLASTZ_ENGINE.state().paused = true;
    const s = JSON.parse(JSON.stringify(BLASTZ_ENGINE.state().s));
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:630px;z-index:99999';
    document.body.appendChild(cv);
    window.devicePixelRatio = 1;
    const R = BLASTZ_RENDER.create(cv);
    R.draw(s, 5, { clock: s.tick, labels: ['P1', 'cpu', 'cpu', 'cpu'] });
    const c = document.createElement('canvas'); c.width = 1200; c.height = 630;
    const x = c.getContext('2d');
    x.drawImage(cv, 0, 0, 1200, 630);
    // the name, in a little window title bar
    const g = x.createLinearGradient(40, 0, 560, 0); g.addColorStop(0, '#000080'); g.addColorStop(1, '#1084d0');
    x.fillStyle = '#c0c0c0'; x.fillRect(36, 30, 520, 150);
    x.fillStyle = '#fff'; x.fillRect(36, 30, 520, 3); x.fillRect(36, 30, 3, 150);
    x.fillStyle = '#404040'; x.fillRect(36, 177, 520, 3); x.fillRect(553, 30, 3, 150);
    x.fillStyle = g; x.fillRect(42, 36, 508, 30);
    x.fillStyle = '#fff'; x.font = 'bold 20px Tahoma, sans-serif'; x.fillText('blastz.exe', 52, 58);
    x.fillStyle = '#000'; x.font = 'bold 64px Tahoma, sans-serif'; x.fillText('blastz', 54, 130);
    const w = x.measureText('blastz').width;
    x.fillStyle = '#c0002a'; x.font = 'bold 40px Tahoma, sans-serif'; x.fillText('98', 64 + w, 130);
    x.fillStyle = '#000'; x.font = '20px Tahoma, sans-serif'; x.fillText('no health. just knockback. join my room', 56, 164);
    return c.toDataURL('image/jpeg', 0.86);
});
const out = path.join(ROOT, 'join/blastz/preview.jpg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log('wrote ' + path.relative(ROOT, out) + ', ' + Math.round(fs.statSync(out).size / 1024) + 'kb');
await browser.close(); server.close();
