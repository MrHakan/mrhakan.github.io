// ===================================================================
// battleship-preview.mjs — join/battleship/preview.jpg, out of the game itself
//
// What a chat app shows when somebody pastes a battleship invite: the real
// window a few volleys into a battle against the hard bot, with the name on a
// grey dialog beside it.
//
//   node .github/scripts/battleship-preview.mjs    writes join/battleship/preview.jpg
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
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 1 });
    await ctx.route('**/*', r => /^https?:\/\/127\.0\.0\.1[:/]/.test(r.request().url()) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
    await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); localStorage.removeItem('mrhakan98-battleship-save'); } catch (e) { } });
    const p = await ctx.newPage();
    await p.goto('http://127.0.0.1:' + server.address().port + '/?app=battleship', { waitUntil: 'load' });
    await p.waitForFunction(() => window.BATTLESHIP_ENGINE && document.querySelector('.battleship-window .bs-title'), null, { timeout: 20000 });
    await p.evaluate(() => document.getElementById('boot-screen')?.remove());
    const W = '.battleship-window[id^="app-win"]';
    await p.click(W + ' [data-act=level][data-v=hard]');
    await p.click(W + ' [data-act=place]');
    await p.click(W + ' [data-act=battle]');
    await p.evaluate(() => BATTLESHIP_ENGINE.speed(50));
    // a battle well under way: aim like the hard bot so there are hits and a sunk ship to see
    for (let i = 0; i < 26; i++) {
        await p.waitForFunction(() => BATTLESHIP_ENGINE.state().turn === 0 || BATTLESHIP_ENGINE.phase() !== 'battle');
        if (await p.evaluate(() => BATTLESHIP_ENGINE.phase()) !== 'battle') break;
        const c = await p.evaluate(() => { const g = BATTLESHIP_ENGINE.state(); return BATTLESHIP_SIM.botMove({ level: 'hard', turn: 0, shots: [g.shots[0], []], rs: 1000 + g.shots[0].length }); });
        await p.click(`${W} .bs-sea[data-side="1"] .bs-cell[data-x="${c.x}"][data-y="${c.y}"]`);
    }
    await p.waitForFunction(() => BATTLESHIP_ENGINE.state().turn === 0);
    await p.mouse.move(0, 0);
    const shot = await p.locator(W).screenshot({ type: 'png' });
    const box = await p.locator(W).boundingBox();
    const card = await ctx.newPage();
    await card.setViewportSize({ width: 1200, height: 630 });
    const h = 560, w = Math.round(h * box.width / box.height);
    await card.setContent(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#008080;position:relative;overflow:hidden;font-family:Tahoma,sans-serif">
        <img src="data:image/png;base64,${shot.toString('base64')}" style="position:absolute;right:30px;top:35px;height:${h}px;width:${w}px;box-shadow:6px 6px 0 rgba(0,0,0,.35)">
        <div style="position:absolute;left:34px;top:150px;width:${Math.min(400, 1200 - w - 100)}px;height:300px;background:#c0c0c0;border:3px solid;border-color:#fff #000 #000 #fff;box-shadow:6px 6px 0 rgba(0,0,0,.35);box-sizing:border-box">
            <div style="margin:3px;height:34px;background:linear-gradient(90deg,#000080,#1084d0);color:#fff;font:bold 20px Tahoma,sans-serif;line-height:34px;padding-left:10px">battleship 98</div>
            <div style="margin:18px 0 0 22px;font:italic 900 56px 'Arial Black',Tahoma,sans-serif;color:#000080;text-shadow:2px 2px 0 #fff,4px 4px 0 #808080">battleship <span style="color:#d82020;font:bold 28px Tahoma,sans-serif;vertical-align:super">98</span></div>
            <div style="margin:22px 0 0 24px;font:21px Tahoma,sans-serif;line-height:32px;color:#000">hide five ships, one shot a turn.<br>both fleets checked at the end.</div>
        </div></body></html>`);
    await card.waitForLoadState('load');
    const jpg = await card.screenshot({ type: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: 1200, height: 630 } });
    const out = path.join(ROOT, 'join/battleship/preview.jpg');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, jpg);
    console.log('wrote ' + path.relative(ROOT, out) + ', ' + Math.round(fs.statSync(out).size / 1024) + 'kb');
} finally {
    await browser.close();
    server.close();
}
