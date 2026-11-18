// ===================================================================
// browser-popz.mjs — popz 98 driven, not just opened
//
//   solo     the start menu opens it in a desktop window; the how-to-play
//            screen; real keys walk and fire; a brain reading the game presses
//            the real keys until level 1 is cleared and the score is up;
//            pause by key and by minimising; game over, play again, and the
//            best score still there after a reload
//   two      two people at one keyboard, each with their own keys
//   phone    390 x 844 with touches: nothing sticks out sideways, the thumb
//            buttons walk and fire, a tap on the floor walks there
//   online   two pages over the lobby's 'local' mode: host and join with the
//            code, the host's start level reaches the guest, the guest's keys
//            move its player and fire on the host, both screens agree, and a
//            guest that walks out is replaced by a bot
//   bots     a game with a bot buddy and an autopilot played to its end
//
// Its own static server on port 0, nothing from outside.
//   node .github/scripts/browser-popz.mjs
// ===================================================================
import { chromium, devices } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.PZ_SHOTS || path.join(process.env.TMPDIR || '/tmp', 'popz-shots');
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'text/xml', '.webmanifest': 'application/json', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    let file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not here'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch();
const errors = [];
async function context(o) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 } }, o || {}));
    await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (e) { } });
    return ctx;
}
async function open(ctx) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForFunction(() => typeof startMenuAction === 'function');
    await p.evaluate(() => document.getElementById('boot-screen')?.remove());
    return p;
}
async function launch(p) {
    await p.evaluate(() => startMenuAction('popz'));
    await p.waitForSelector('.app-window .pz-menu', { timeout: 20000 });
}
const st = (p, f, arg) => p.evaluate(f, arg);
const wait = (p, f, arg, ms) => p.waitForFunction(f, arg, { timeout: ms || 15000 });
// a brain that reads the game and decides; the hands are the real keyboard
async function brainKeys(p, until, ms, keys) {
    keys = keys || { l: 'ArrowLeft', r: 'ArrowRight', f: 'Space' };
    const end = Date.now() + ms;
    let down = '';
    while (Date.now() < end) {
        const d = await p.evaluate(() => {
            const E = window.POPZ_ENGINE, g = E.game();
            if (!g) return null;
            const S = E.sim, s = JSON.parse(JSON.stringify(g.s));
            s.ev = [];
            const bot = window.__brain = window.__brain || S.newBot(5);
            const f0 = s.players[0].in.f;
            bot.at = -99;
            S.think(s, 0, bot);
            return { b: s.players[0].in.b, fire: s.players[0].in.f > f0, ph: g.s.ph };
        });
        if (!d) break;
        if (await p.evaluate(until)) break;
        const want = d.b === 1 ? keys.l : d.b === 2 ? keys.r : '';
        if (want !== down) { if (down) await p.keyboard.up(down); if (want) await p.keyboard.down(want); down = want; }
        if (d.fire) await p.keyboard.press(keys.f);
        await p.waitForTimeout(30);
    }
    if (down) await p.keyboard.up(down);
}

try {
    // =================================================================
    section('solo');
    // =================================================================
    {
        const ctx = await context();
        const p = await open(ctx);
        expect(await st(p, () => !window.POPZ_ENGINE), 'the desktop loads none of popz until asked');
        await launch(p);
        const win = await st(p, () => { const w = document.querySelector('.pz-window'); return w && w.classList.contains('app-window') ? w.querySelector('.app-window-title').textContent : ''; });
        expect(win === 'popz 98', 'startMenuAction opens it in a desktop popup window', win);
        await p.click('.pz-menu [data-act=help]');
        expect(await p.isVisible('.pz-help'), 'there is a how-to-play screen');
        await p.click('.pz-help [data-act=back]');
        await p.selectOption('.pz-menu [data-k=mode]', 'solo');
        await p.click('.pz-menu [data-act=play]');
        await wait(p, () => POPZ_ENGINE.state() && POPZ_ENGINE.state().ph === 'play');
        expect(true, 'play starts level 1 and it gets going');
        await p.screenshot({ path: path.join(SHOTS, 'solo.png') });
        const x0 = await st(p, () => POPZ_ENGINE.state().players[0].x);
        await p.keyboard.down('ArrowRight'); await p.waitForTimeout(400); await p.keyboard.up('ArrowRight');
        const x1 = await st(p, () => POPZ_ENGINE.state().players[0].x);
        expect(x1 > x0 + 30, 'the right arrow walks right', (x1 - x0).toFixed(0) + ' units');
        await p.keyboard.down('KeyA'); await p.waitForTimeout(250); await p.keyboard.up('KeyA');
        expect(await st(p, () => POPZ_ENGINE.state().players[0].x) < x1 - 15, 'and a walks left too when alone');
        await p.keyboard.press('Space');
        await p.waitForTimeout(150);
        expect(await st(p, () => POPZ_ENGINE.state().players[0].in.f === 1), 'space fires a rope');
        await brainKeys(p, () => POPZ_ENGINE.state().lv >= 1 || POPZ_ENGINE.state().ph === 'clear', 60000);
        const s1 = await st(p, () => ({ lv: POPZ_ENGINE.state().lv, ph: POPZ_ENGINE.state().ph, score: POPZ_ENGINE.state().players[0].score }));
        expect(s1.lv >= 1 || s1.ph === 'clear', 'level 1 cleared with the real keys', JSON.stringify(s1));
        expect(s1.score > 0, 'and the score went up', s1.score);
        // a click on the floor: walk there and fire
        await wait(p, () => POPZ_ENGINE.state().ph === 'play', null, 10000);
        const box = await p.locator('#pz-canvas').boundingBox();
        await p.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.8);
        await wait(p, () => POPZ_ENGINE.state().players[0].x > 500, null, 5000).catch(() => { });
        expect(await st(p, () => POPZ_ENGINE.state().players[0].x > 500), 'a click on the floor walks there');
        // pause
        await p.keyboard.press('KeyP');
        const k0 = await st(p, () => POPZ_ENGINE.state().k);
        await p.waitForTimeout(300);
        expect(await st(p, k => POPZ_ENGINE.game().paused && POPZ_ENGINE.state().k === k, k0) && await p.isVisible('.pz-over.on [data-act=resume]'), 'p pauses and the game stands still');
        await p.click('[data-act=resume]');
        await p.waitForTimeout(200);
        expect(await st(p, k => !POPZ_ENGINE.game().paused && POPZ_ENGINE.state().k > k, k0), 'and it goes on');
        await p.click('.pz-window .ie-titlebar-btn[title=minimize]');
        await p.waitForTimeout(600);
        expect(await st(p, () => POPZ_ENGINE.game().paused), 'minimising the window pauses it');
        await st(p, () => { document.querySelector('.pz-window').style.display = 'flex'; });
        await p.click('[data-act=resume]');
        // game over and the best score
        await st(p, () => { const s = POPZ_ENGINE.state(); s.players[0].lives = 1; s.players[0].inv = 0; s.players[0].shield = false; s.bubbles.push({ x: s.players[0].x, y: 380, vx: 0, vy: 0, s: 1 }); });
        await wait(p, () => !!document.querySelector('.pz-over.on [data-act=again]'), null, 10000);
        const best = await st(p, () => POPZ_ENGINE.best());
        expect(best.score > 0 && best.games === 1, 'game over shows play again, and the best score is saved', JSON.stringify(best));
        await p.screenshot({ path: path.join(SHOTS, 'over.png') });
        await p.click('[data-act=again]');
        await wait(p, () => POPZ_ENGINE.state() && POPZ_ENGINE.state().ph === 'ready' && POPZ_ENGINE.state().players[0].score === 0);
        expect(true, 'play again starts a fresh game');
        await p.reload({ waitUntil: 'load' });
        await p.waitForFunction(() => typeof startMenuAction === 'function');
        await p.evaluate(() => document.getElementById('boot-screen')?.remove());
        await launch(p);
        const rec = await p.textContent('.pz-rec');
        expect(rec.includes('best score ' + best.score) || rec.includes(String(best.score)), 'after a reload the menu still shows the best score', rec.trim());
        await ctx.close();
    }

    // =================================================================
    section('two at one keyboard');
    // =================================================================
    {
        const ctx = await context();
        const p = await open(ctx);
        await launch(p);
        await p.selectOption('.pz-menu [data-k=mode]', 'two');
        await p.click('.pz-menu [data-act=play]');
        await wait(p, () => POPZ_ENGINE.state() && POPZ_ENGINE.state().ph === 'play');
        const [a0, b0] = await st(p, () => POPZ_ENGINE.state().players.map(q => q.x));
        await p.keyboard.down('ArrowLeft'); await p.keyboard.down('KeyD');
        await p.waitForTimeout(300);
        await p.keyboard.up('ArrowLeft'); await p.keyboard.up('KeyD');
        const [a1, b1] = await st(p, () => POPZ_ENGINE.state().players.map(q => q.x));
        expect(a1 < a0 - 15 && b1 > b0 + 15, 'arrows move player 1 and a d player 2 at the same time', [a0, a1, b0, b1].map(Math.round).join(' '));
        await p.keyboard.press('KeyW');
        await p.waitForTimeout(150);
        const r = await st(p, () => POPZ_ENGINE.state().players.map(q => q.in.f));
        await p.keyboard.press('Enter');
        await p.waitForTimeout(150);
        const r2 = await st(p, () => POPZ_ENGINE.state().players.map(q => q.in.f));
        expect(r[0] === 0 && r[1] === 1 && r2[0] === 1 && r2[1] === 1, 'w fires for player 2 and enter for player 1', r.join(',') + ' / ' + r2.join(','));
        await ctx.close();
    }

    // =================================================================
    section('phone');
    // =================================================================
    {
        const ctx = await context(Object.assign({}, devices['iPhone 13'], { viewport: { width: 390, height: 844 } }));
        const p = await open(ctx);
        await launch(p);
        await p.click('.pz-menu [data-act=play]');
        await wait(p, () => POPZ_ENGINE.state() && POPZ_ENGINE.state().ph === 'play');
        const wide = await st(p, () => ({ doc: document.documentElement.scrollWidth, vw: innerWidth, win: document.querySelector('.pz-window').getBoundingClientRect().right }));
        expect(wide.doc <= wide.vw && wide.win <= wide.vw + 1, 'nothing sticks out sideways at 390 px', JSON.stringify(wide));
        expect(await p.isVisible('#pz-pad'), 'the thumb buttons are there');
        await p.screenshot({ path: path.join(SHOTS, 'phone.png') });
        const x0 = await st(p, () => POPZ_ENGINE.state().players[0].x);
        const right = p.locator('#pz-pad [data-pad=r]');
        await right.dispatchEvent('pointerdown', { pointerId: 3, pointerType: 'touch', isPrimary: true });
        await p.waitForTimeout(300);
        await right.dispatchEvent('pointerup', { pointerId: 3, pointerType: 'touch', isPrimary: true });
        const x1 = await st(p, () => POPZ_ENGINE.state().players[0].x);
        expect(x1 > x0 + 20, 'holding the right button walks right', (x1 - x0).toFixed(0));
        const f0 = await st(p, () => POPZ_ENGINE.state().players[0].in.f);
        await p.locator('#pz-pad [data-pad=f]').tap();
        await p.waitForTimeout(150);
        expect(await st(p, f => POPZ_ENGINE.state().players[0].in.f > f, f0), 'the fire button fires');
        const box = await p.locator('#pz-canvas').boundingBox();
        await p.touchscreen.tap(box.x + box.width * 0.1, box.y + box.height * 0.8);
        await wait(p, () => POPZ_ENGINE.state().players[0].x < 120 || POPZ_ENGINE.state().ph !== 'play', null, 5000).catch(() => { });
        expect(await st(p, () => POPZ_ENGINE.state().players[0].x < 120 || POPZ_ENGINE.state().ph !== 'play'), 'a tap on the floor walks there');
        await ctx.close();
    }

    // =================================================================
    section('online');
    // =================================================================
    {
        const ctx = await context({ viewport: { width: 1100, height: 820 } });
        const host = await open(ctx), guest = await open(ctx);
        await launch(host); await launch(guest);
        await host.evaluate(() => Netplay.openLobby({ gameId: 'popz' }));
        await host.selectOption('#np-mode', 'local'); await host.click('#np-host'); await host.waitForSelector('.np-code', { timeout: 20000 });
        const code = (await host.textContent('.np-code')).trim();
        await guest.evaluate(() => Netplay.openLobby({ gameId: 'popz' }));
        await guest.selectOption('#np-mode', 'local'); await guest.fill('#np-code', code); await guest.click('#np-join');
        await guest.waitForSelector('#np-ready', { timeout: 20000 });
        await host.waitForFunction(() => Netplay.current && Netplay.current.players.length === 2, null, { timeout: 20000 });
        expect(true, 'the guest joins the host with the code ' + code);
        await host.selectOption('[data-opt=level]', '5');
        await guest.click('#np-ready');
        await host.waitForFunction(() => Netplay.current.players.every(p => p.ready || p.host), null, { timeout: 10000 });
        await host.click('#np-start');
        await Promise.all([host, guest].map(p => wait(p, () => window.POPZ_ENGINE && POPZ_ENGINE.screen() === 'play' && POPZ_ENGINE.state() && POPZ_ENGINE.state().ph === 'play', null, 20000)));
        const lv = await Promise.all([host, guest].map(p => st(p, () => POPZ_ENGINE.state().lv)));
        expect(lv[0] === 4 && lv[1] === 4, "both start at the host's level 5", lv.join(','));
        expect(await st(guest, () => !POPZ_ENGINE.game().isHost && POPZ_ENGINE.game().me === 1) && await st(host, () => POPZ_ENGINE.game().isHost), 'the host runs the rules and the guest is player 2');
        expect(await st(host, () => !!document.querySelector('.pz-window.app-window')) && await st(guest, () => !!document.querySelector('.pz-window.app-window')), 'both play in a desktop window');
        // the guest's real keys reach the host
        const gx0 = await st(host, () => POPZ_ENGINE.state().players[1].x);
        await guest.bringToFront();
        await guest.keyboard.down('ArrowRight'); await guest.waitForTimeout(500); await guest.keyboard.up('ArrowRight');
        await host.waitForTimeout(300);
        const gx1 = await st(host, () => POPZ_ENGINE.state().players[1].x);
        expect(gx1 > gx0 + 30, "the guest's arrow keys move player 2 on the host", (gx1 - gx0).toFixed(0));
        const f0 = await st(host, () => POPZ_ENGINE.state().players[1].in.f);
        await guest.keyboard.press('Space');
        await host.waitForFunction(f => POPZ_ENGINE.state().players[1].in.f > f, f0, { timeout: 5000 }).catch(() => { });
        expect(await st(host, f => POPZ_ENGINE.state().players[1].in.f > f, f0), "the guest's space fires on the host");
        // the host's own keys
        await host.bringToFront();
        await wait(host, () => POPZ_ENGINE.state().ph === 'play' && POPZ_ENGINE.state().players[0].x > 60);
        const hx0 = await st(host, () => POPZ_ENGINE.state().players[0].x);
        await host.keyboard.down('ArrowLeft'); await host.waitForTimeout(400); await host.keyboard.up('ArrowLeft');
        expect(await st(host, x => POPZ_ENGINE.state().players[0].x < x - 20, hx0), "the host's keys move player 1", await st(host, x => JSON.stringify([x, POPZ_ENGINE.state().players[0].x, POPZ_ENGINE.state().ph, document.activeElement && document.activeElement.tagName, POPZ_ENGINE.game().seats[0]]), hx0));
        // both screens agree
        for (let i = 0; i < 40 && await st(host, () => POPZ_ENGINE.state().lv) < 5; i++) { await st(host, () => POPZ_ENGINE.clearLevel()); await host.waitForTimeout(250); }
        await Promise.all([host, guest].map(p => wait(p, () => POPZ_ENGINE.state().lv === 5, null, 15000)));
        await host.waitForTimeout(400);
        const view = p => st(p, () => { const s = POPZ_ENGINE.state(); return JSON.stringify({ lv: s.lv, sc: s.players.map(q => q.score), lives: s.players.map(q => q.lives), n: s.bubbles.length, k: s.blocks.map(b => b.hp).join('') }); });
        const [hv, gv] = [await view(host), await view(guest)];
        expect(hv === gv, 'after the level is cleared both screens show the same game', hv + ' / ' + gv);
        // the guest walks out
        await guest.close();
        await host.waitForFunction(() => POPZ_ENGINE.game().seats[1].kind === 'bot', null, { timeout: 20000 }).catch(() => { });
        expect(await st(host, () => POPZ_ENGINE.game().seats[1].kind === 'bot'), 'a guest that walks out is replaced by a bot');
        await ctx.close();
    }

    // =================================================================
    section('with a bot buddy, to the end');
    // =================================================================
    {
        const ctx = await context();
        const p = await open(ctx);
        await launch(p);
        await p.selectOption('.pz-menu [data-k=mode]', 'buddy');
        await st(p, () => POPZ_ENGINE.startLocal({ mode: 'buddy', start: 20 }));
        await wait(p, () => POPZ_ENGINE.state() && POPZ_ENGINE.state().players.length === 2);
        await st(p, () => { POPZ_ENGINE.autopilot(0, true); POPZ_ENGINE.clock(16); });
        await wait(p, () => !!document.querySelector('.pz-over.on [data-act=again]'), null, 120000);
        const end = await st(p, () => { const s = POPZ_ENGINE.state(); return { ph: s.ph, lv: s.lv + 1, score: s.players.map(q => q.score) }; });
        expect(end.ph === 'win' || end.ph === 'over', 'a game with a bot buddy plays through to its end', JSON.stringify(end));
        expect(await st(p, () => POPZ_ENGINE.best().level >= 21), 'and the furthest level is saved');
        await ctx.close();
    }
    expect(!errors.length, 'no page errors', errors.join(' | ') || undefined);
} catch (e) {
    failures++;
    console.error(e);
    if (errors.length) console.error('page errors:', errors.join('\n'));
} finally {
    await browser.close();
    server.close();
}
console.log('\n' + (failures ? failures + ' of ' + checks + ' popz browser checks FAILED' : checks + ' popz browser checks passed'));
process.exit(failures ? 1 : 0);
