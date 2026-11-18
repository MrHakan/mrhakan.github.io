// browser-blockroll.mjs — block roll 98 played for real: start menu popup,
// keyboard rolls through a level, swipes and taps on a phone, pause on
// minimise, passcodes, saves across a reload, blocked storage and layout.
import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
let fail = 0, passed = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  FAIL  ') + m); if (c) passed++; else fail++; };
const shots = process.env.TMPDIR || '/tmp';

async function context(opts = {}) {
    const ctx = await browser.newContext(opts);
    await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (_) { /* blocked */ } });
    return ctx;
}
const KEY = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight', x: 'Space' };
const idle = f => f.waitForFunction(() => !BLOCKROLL_ENGINE.busy(), null, { timeout: 5000 });
// press the real keys for a path, waiting out each roll animation
async function playKeys(frame, keyboard, pathStr) {
    for (const ch of pathStr) { await keyboard.press(KEY[ch]); await idle(frame); }
}

try {
    // ---------------------------------------------------------- desktop popup
    const ctx = await context({ viewport: { width: 1366, height: 860 } });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push('desk: ' + e.message));
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof startMenuAction === 'function');
    await page.evaluate(() => document.getElementById('boot-screen')?.remove());
    await page.evaluate(() => startMenuAction('blockroll'));
    const win = page.locator('.app-window.framed-blockroll-window');
    await win.waitFor({ timeout: 15000 });
    ok(await win.count() === 1, 'startMenuAction(blockroll) opens a desktop popup window');
    ok(new URL(page.url()).searchParams.get('app') === 'blockroll', 'the popup has its own /?app=blockroll route');
    const frameEl = await win.locator('iframe.framed-game').elementHandle();
    const game = await frameEl.contentFrame();
    game.on && null;
    await game.waitForFunction(() => window.BLOCKROLL_ENGINE && BLOCKROLL_ENGINE.overlay() === 'title');
    ok(!(await game.locator('.titlebar').isVisible()), 'embedded: the desktop window supplies the titlebar');
    ok(await game.locator('#d-title').isVisible(), 'a how-to-play screen greets the player');
    await game.locator('#t-play').click();
    ok(await game.evaluate(() => BLOCKROLL_ENGINE.overlay()) === null, 'play closes it');
    // level 1 through the real keyboard, using the solver's optimal line
    const path1 = await game.evaluate(() => BLOCKROLL_ENGINE.solution(0));
    const par1 = await game.evaluate(() => BLOCKROLL_ENGINE.sim.LEVELS[0].par);
    await game.locator('#board').focus();
    await page.keyboard.press(KEY[path1[0]]); await idle(game);
    ok(await game.locator('#h-moves').textContent() === '1', 'a key press rolls the block and counts a move');
    await page.keyboard.press('r'); await idle(game);
    ok(await game.locator('#h-moves').textContent() === '0', 'R restarts the level');
    await playKeys(game, page.keyboard, path1);
    await game.waitForFunction(() => BLOCKROLL_ENGINE.overlay() === 'win', null, { timeout: 5000 });
    ok(await game.locator('#d-win').isVisible(), 'standing in the hole clears level 1 (' + path1.length + ' moves, par ' + par1 + ')');
    ok((await game.locator('#w-stars').textContent()) === '\u2605\u2605\u2605', 'a par run earns three stars');
    const code2 = await game.evaluate(() => BLOCKROLL_ENGINE.sim.passcode(1));
    ok((await game.locator('#w-code').textContent()).includes(code2), 'the win screen shows the next passcode');
    const saved = await game.evaluate(() => BLOCKROLL_ENGINE.save());
    ok(saved.unlocked === 1 && saved.best[0] === path1.length, 'progress and best moves are saved');
    await game.locator('#w-next').click();
    ok(await game.evaluate(() => BLOCKROLL_ENGINE.level()) === 1, 'next level loads level 2');
    ok(await game.locator('#h-stars').textContent() === '3/' + (await game.evaluate(() => BLOCKROLL_ENGINE.sim.LEVELS.length * 3)), 'the star total updates');
    // falling off: roll until the block leaves the floor
    await game.locator('#board').focus();
    const before = await game.evaluate(() => BLOCKROLL_ENGINE.state().moves);
    for (let i = 0; i < 12; i++) {
        await page.keyboard.press('ArrowUp');
        await idle(game);
        if (await game.evaluate(() => BLOCKROLL_ENGINE.state().moves === 0)) break;
    }
    ok(await game.evaluate(() => BLOCKROLL_ENGINE.state().moves === 0 && BLOCKROLL_ENGINE.state().status === 'play') &&
        (await game.locator('#status').textContent()).includes('try 2'), 'rolling off the edge falls and restarts the level');
    void before;
    // minimising the window pauses the game
    await page.evaluate(() => { document.querySelector('.framed-blockroll-window').style.display = 'none'; });
    await game.waitForFunction(() => BLOCKROLL_ENGINE.overlay() === 'pause');
    ok(true, 'minimising the desktop window pauses the game');
    await page.evaluate(() => startMenuAction('blockroll'));
    ok(await page.locator('.app-window.framed-blockroll-window').count() === 1, 'the start menu brings back the same window');
    await game.locator('#p-resume').click();
    ok(await game.evaluate(() => BLOCKROLL_ENGINE.overlay()) === null, 'resume continues');
    await page.screenshot({ path: path.join(shots, 'blockroll-desktop.png') });
    ok(errors.length === 0, 'no desktop page errors ' + errors.join(' | '));
    await ctx.close();

    // ---------------------------------------------------------- standalone: switches, split, passcodes, saves
    const ctx2 = await context({ viewport: { width: 1100, height: 800 } });
    const p2 = await ctx2.newPage(), errors2 = [];
    p2.on('pageerror', e => errors2.push(e.message));
    p2.on('console', m => { if (m.type() === 'error') errors2.push(m.text()); });
    await p2.goto(BASE + '/games/block-roll/');
    await p2.waitForFunction(() => window.BLOCKROLL_ENGINE);
    ok(await p2.locator('.titlebar').isVisible(), 'standalone page shows its own titlebar');
    const info = await p2.evaluate(() => BLOCKROLL_ENGINE.sim.LEVELS.map((l, i) => ({ i, split: l.map.some(r => r.includes('%')), bridge: /[a-z]/i.test(l.map.join('')) })));
    const splitLevel = info.find(l => l.split).i, bridgeLevel = info.find(l => l.bridge).i;
    // the level grid starts locked; a passcode opens a later level
    await p2.locator('#t-levels').click();
    ok(await p2.locator('#l-grid button:disabled').count() === info.length - 1, 'only level 1 is open at first');
    await p2.locator('#l-input').fill('000000'); await p2.locator('#l-code button').click();
    ok((await p2.locator('#l-msg').textContent()).includes('no level'), 'a wrong passcode is refused');
    const code = await p2.evaluate(i => BLOCKROLL_ENGINE.sim.passcode(i), splitLevel);
    await p2.locator('#l-input').fill(code); await p2.locator('#l-code button').click();
    ok(await p2.evaluate(() => BLOCKROLL_ENGINE.level()) === splitLevel, 'the passcode ' + code + ' jumps to level ' + (splitLevel + 1));
    // play the split level for real: keys and space to swap
    const pathS = await p2.evaluate(() => BLOCKROLL_ENGINE.solution());
    await p2.locator('#board').focus();
    let sawSplit = false;
    for (const ch of pathS) {
        await p2.keyboard.press(KEY[ch]); await idle(p2);
        if (await p2.evaluate(() => !!BLOCKROLL_ENGINE.state().cubes)) sawSplit = true;
    }
    await p2.waitForFunction(() => BLOCKROLL_ENGINE.overlay() === 'win', null, { timeout: 5000 });
    ok(sawSplit, 'the splitter made two cubes, space swapped them and they merged to finish level ' + (splitLevel + 1));
    // bridges through the real keyboard
    await p2.locator('#w-levels').click();
    await p2.locator('#l-grid button[data-level="' + bridgeLevel + '"]').click();
    const pathB = await p2.evaluate(() => BLOCKROLL_ENGINE.solution());
    const mask0 = await p2.evaluate(() => BLOCKROLL_ENGINE.state().mask);
    let maskChanged = false;
    await p2.locator('#board').focus();
    for (const ch of pathB) { await p2.keyboard.press(KEY[ch]); await idle(p2); if (await p2.evaluate(m => BLOCKROLL_ENGINE.state().mask !== m, mask0)) maskChanged = true; }
    await p2.waitForFunction(() => BLOCKROLL_ENGINE.overlay() === 'win', null, { timeout: 5000 });
    ok(maskChanged, 'a switch opened a bridge on the way to clearing level ' + (bridgeLevel + 1));
    await p2.screenshot({ path: path.join(shots, 'blockroll-standalone.png') });
    // saves survive a reload
    await p2.reload();
    await p2.waitForFunction(() => window.BLOCKROLL_ENGINE);
    const s2 = await p2.evaluate(() => BLOCKROLL_ENGINE.save());
    ok(s2.unlocked >= splitLevel + 1 && s2.best[splitLevel] > 0 && s2.best[bridgeLevel] > 0, 'progress survives a reload');
    ok((await p2.locator('#t-play').textContent()).startsWith('continue'), 'the title offers to continue');
    // pause button and P key freeze the game; visibility hides pause too
    await p2.locator('#t-play').click();
    await p2.keyboard.press('p');
    ok(await p2.evaluate(() => BLOCKROLL_ENGINE.overlay()) === 'pause', 'P pauses');
    await p2.keyboard.press('ArrowRight');
    ok(await p2.locator('#h-moves').textContent() === '0', 'no moves while paused');
    await p2.keyboard.press('Escape');
    await p2.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    ok(await p2.evaluate(() => BLOCKROLL_ENGINE.overlay()) === 'pause', 'a hidden tab pauses');
    // a corrupt save does not break anything
    await p2.evaluate(() => localStorage.setItem('mrhakan98-blockroll-save', '{broken'));
    await p2.reload(); await p2.waitForFunction(() => window.BLOCKROLL_ENGINE);
    ok(await p2.evaluate(() => BLOCKROLL_ENGINE.level()) === 0, 'a corrupt save starts fresh');
    ok(errors2.length === 0, 'no standalone page errors ' + errors2.join(' | '));
    await ctx2.close();

    // ---------------------------------------------------------- phone: swipes, taps, pad, layout
    const ctx3 = await context({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } });
    const p3 = await ctx3.newPage(), errors3 = [];
    p3.on('pageerror', e => errors3.push(e.message));
    await p3.goto(BASE + '/games/block-roll/?embed=1');
    await p3.waitForFunction(() => window.BLOCKROLL_ENGINE);
    await p3.locator('#t-play').tap();
    ok(await p3.locator('#pad').isVisible(), 'the touch pad shows on a phone');
    const path3 = await p3.evaluate(() => BLOCKROLL_ENGINE.solution(0));
    // first move: a real swipe with touch pointer events, second: a tap beside the block
    const box = await p3.locator('#board').boundingBox();
    const vec = { R: [0.92, 0.30], L: [-0.92, -0.30], D: [-0.40, 0.56], U: [0.40, -0.56] };
    const swipe = async dir => {
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2, v = vec[dir];
        await p3.locator('#board').dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy, isPrimary: true, bubbles: true });
        await p3.locator('#board').dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: cx + v[0] * 80, clientY: cy + v[1] * 80, isPrimary: true, bubbles: true });
    };
    await swipe(path3[0]); await idle(p3);
    ok(await p3.locator('#h-moves').textContent() === '1', 'a swipe rolls the block');
    for (let i = 1; i < path3.length; i++) {
        const dir = path3[i];
        if (i % 2) await p3.locator('#pad button[data-dir="' + dir + '"]').tap();
        else await swipe(dir);
        await idle(p3);
    }
    await p3.waitForFunction(() => BLOCKROLL_ENGINE.overlay() === 'win', null, { timeout: 5000 });
    ok(true, 'level 1 cleared on a phone with swipes and pad taps');
    const width = await p3.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    ok(width.s <= width.c + 1, 'no horizontal overflow at 390px (' + width.s + '/' + width.c + ')');
    const cv = await p3.locator('#board').boundingBox();
    ok(cv.height > 200 && cv.width > 300, 'the board gets real space on a phone (' + Math.round(cv.width) + 'x' + Math.round(cv.height) + ')');
    await p3.screenshot({ path: path.join(shots, 'blockroll-phone.png') });
    // a mouse-style tap beside the block on level 2
    await p3.locator('#w-next').tap();
    // a tap beside the block (no drag) rolls towards the tap
    const centre = await p3.evaluate(() => { const r = document.getElementById('board').getBoundingClientRect(); return [r.left, r.top]; });
    const tapAt = await p3.evaluate(() => BLOCKROLL_ENGINE.tapPoint('R'));
    await p3.touchscreen.tap(centre[0] + tapAt[0], centre[1] + tapAt[1]);
    await idle(p3);
    ok(await p3.locator('#h-moves').textContent() === '1', 'a tap beside the block rolls it toward the tap');
    ok(errors3.length === 0, 'no phone page errors ' + errors3.join(' | '));
    await ctx3.close();

    // ---------------------------------------------------------- blocked storage + desktop phone layout
    const ctx4 = await context({ viewport: { width: 360, height: 740 } });
    await ctx4.addInitScript(() => {
        Storage.prototype.getItem = () => { throw new Error('blocked'); };
        Storage.prototype.setItem = () => { throw new Error('blocked'); };
    });
    const p4 = await ctx4.newPage(), errors4 = [];
    p4.on('pageerror', e => errors4.push(e.message));
    await p4.goto(BASE + '/games/block-roll/');
    await p4.waitForFunction(() => window.BLOCKROLL_ENGINE);
    await p4.locator('#t-play').click();
    await p4.locator('#board').focus();
    const path4 = await p4.evaluate(() => BLOCKROLL_ENGINE.solution(0));
    await playKeys(p4, p4.keyboard, path4);
    await p4.waitForFunction(() => BLOCKROLL_ENGINE.overlay() === 'win', null, { timeout: 5000 });
    const w4 = await p4.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    ok(w4 && errors4.length === 0, 'blocked storage still plays at 360px, no overflow ' + errors4.join(' | '));
    await ctx4.close();
} finally { await browser.close(); server.close(); }
console.log(fail ? `\n${fail} blockroll browser checks FAILED` : `\n${passed} blockroll browser checks passed`);
process.exit(fail ? 1 : 0);
