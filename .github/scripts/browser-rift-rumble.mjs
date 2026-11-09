// Real Chromium and real shared transports: no mock game or multiplayer messages.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, '.ci-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    let file = path.resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('missing'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port, GAME_URL = BASE + '/?app=brawlz';
const relayPort = 8900 + Math.floor(Math.random() * 90);
const relay = spawn(process.execPath, [path.join(ROOT, 'server/relay.js')], { env: { ...process.env, PORT: String(relayPort), HOST: '127.0.0.1' }, stdio: 'ignore' });
let browser;
const errors = []; let checks = 0;
const ok = (value, text) => { assert.ok(value, text); checks++; console.log('  ok    ' + text); };
async function context(options = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, ...options });
    await ctx.route('**/*', route => /^https?:\/\/127\.0\.0\.1[:/]/.test(route.request().url()) ? route.continue() : route.abort());
    await ctx.addInitScript(() => { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); });
    return ctx;
}
async function open(ctx, url = GAME_URL) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(url); await p.waitForSelector('.rr-menu,.rr-lobby'); return p; }
const state = (p, fn) => p.evaluate(fn);
async function hosted(p, transport = 'local', mode = 1) {
    if (mode === 2) await p.click('[data-mode="2"]');
    await p.click('[data-act=online]'); await p.selectOption('#rr-transport', transport);
    if (transport === 'relay') await p.fill('#rr-relay', 'ws://127.0.0.1:' + relayPort);
    await p.click('[data-act=host]'); await p.waitForSelector('.rr-room-code');
    return (await p.textContent('.rr-room-code')).trim();
}
async function join(p, code, transport = 'local') {
    await p.click('[data-act=online]'); await p.selectOption('#rr-transport', transport);
    if (transport === 'relay') await p.fill('#rr-relay', 'ws://127.0.0.1:' + relayPort);
    await p.fill('#rr-code', code); await p.click('[data-act=join]'); await p.waitForSelector('.rr-room-code');
}
async function fighting(p) { await p.waitForFunction(() => RIFT_ENGINE.state()?.s.phase === 'fight'); }
try {
    for (let i = 0; i < 30; i++) { try { if ((await fetch('http://127.0.0.1:' + relayPort + '/healthz')).ok) break; } catch (_) {} await new Promise(r => setTimeout(r, 100)); }
    browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
    if (process.env.RR_ONLY !== 'phone') {
    // A real delayed image response must not start a fight using placeholder art.
    const loadingCtx = await context(); let releaseArt;
    const artGate = new Promise(resolve => { releaseArt = resolve; });
    await loadingCtx.route('**/games/rift-rumble/art/fighters-*.png', async route => { await artGate; await route.continue(); });
    const loadingPage = await loadingCtx.newPage(); loadingPage.on('pageerror', e => errors.push(e.message));
    await loadingPage.goto(GAME_URL, { waitUntil: 'domcontentloaded' }); await loadingPage.waitForSelector('.rr-menu');
    await loadingPage.click('[data-act=solo]');
    ok(await state(loadingPage, () => RIFT_ENGINE.screen() === 'loading' && RIFT_ENGINE.state() === null), 'slow art loading holds the match before its countdown');
    releaseArt(); await loadingPage.waitForFunction(() => RIFT_ENGINE.state()?.s.phase === 'countdown');
    ok(await state(loadingPage, () => RIFT_ART.ready()), 'a match starts only after every fixed animation rig is ready'); await loadingCtx.close();
    const ctx = await context(), p = await open(ctx);
    ok(await p.locator('.rr-char').count() === 12, 'twelve original cursed emoji fighters are selectable');
    ok(await p.locator('.app-window .rr-app').count() === 1 && !await p.locator('#rift-app').count(), 'the game lives inside the main desktop app window');
    await p.waitForFunction(() => RIFT_ART.ready());
    ok(await state(p, () => RIFT_ART.metrics().length === 12 && RIFT_ART.metrics().every(r => r.frames === 50)), 'all twelve consistent rigs prepare their 600 cached animation frames');
    await p.click('[data-fighter="3"]'); await p.click('[data-mode="2"]'); await p.selectOption('#rr-arena', 'moon');
    await p.screenshot({ path: path.join(SHOTS, 'rr-menu.png') });
    await p.click('[data-act=help]'); ok(await p.locator('[role=dialog]').isVisible(), 'instructions open from the menu'); await p.click('[data-act=close-help]');
    await p.click('[data-act=solo]');
    ok(await state(p, () => { const s = RIFT_ENGINE.state().s; return s.players.length === 4 && s.arena === 'moon' && s.players[0].character === 3 && s.players.filter(p => p.bot).length === 3; }), 'fighter, team size and arena choices reach the rules');
    await fighting(p); const x = await state(p, () => RIFT_ENGINE.state().s.players[0].x);
    await p.keyboard.down('KeyD'); await p.waitForTimeout(200); await p.keyboard.up('KeyD');
    ok(await state(p, () => RIFT_ENGINE.state().s.players[0].x) > x + 10, 'real keyboard input moves the fighter');
    await p.keyboard.press('Space'); await p.waitForTimeout(75); await p.keyboard.press('Space'); await p.waitForTimeout(75);
    ok(await state(p, () => RIFT_ENGINE.state().s.players[0].jumps) === 2, 'real keyboard input double jumps');
    await p.keyboard.press('KeyJ'); await p.waitForTimeout(40); ok(await state(p, () => !!RIFT_ENGINE.state().s.players[0].attack), 'real keyboard input attacks');
    await p.keyboard.press('Escape'); const tick = await state(p, () => RIFT_ENGINE.state().s.tick); await p.waitForTimeout(200);
    ok(await state(p, () => RIFT_ENGINE.state().s.tick) === tick, 'practice pauses without consuming match time');
    const pausedPicture = await state(p, () => document.querySelector('.rr-canvas').toDataURL()); await p.waitForTimeout(160);
    ok(await state(p, () => document.querySelector('.rr-canvas').toDataURL()) === pausedPicture, 'pause freezes fighter frames, invulnerability flashes and combat effects'); await p.click('[data-act=resume]');
    await state(p, () => {
        window.rrTestPad = { axes: [1, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.rrTestPad] });
        const fighter = RIFT_ENGINE.state().s.players[0]; fighter.x = 500; fighter.y = 524; fighter.vx = fighter.vy = 0; fighter.grounded = true; fighter.jumps = 0; fighter.stun = 0; fighter.attack = null; fighter.invuln = 600;
        RIFT_ENGINE.state().s.players.slice(1).forEach((p, i) => { p.x = 930 + i * 25; p.y = 524; });
    });
    await p.waitForTimeout(160); ok(await state(p, () => RIFT_ENGINE.state().s.players[0].x > 510), 'gamepad axes move the actual fighter');
    await state(p, () => { rrTestPad.axes[0] = 0; rrTestPad.buttons[0].pressed = true; }); await p.waitForTimeout(100);
    ok(await state(p, () => RIFT_ENGINE.state().s.players[0].jumps === 1), 'a held gamepad jump triggers once');
    await state(p, () => { rrTestPad.buttons[0].pressed = false; }); await p.waitForTimeout(40);
    await state(p, () => { rrTestPad.buttons[0].pressed = true; }); await p.waitForTimeout(70);
    ok(await state(p, () => RIFT_ENGINE.state().s.players[0].jumps === 2), 'a second gamepad press double jumps');
    await state(p, () => { window.rrTestPad = null; });
    await p.screenshot({ path: path.join(SHOTS, 'rr-fight.png') });
    await state(p, () => { RIFT_ENGINE.state().s.players.filter(p => p.team === 1).forEach(p => { p.stocks = 1; p.y = 1000; }); });
    await p.waitForSelector('[data-act=rematch]'); ok((await p.textContent('.rr-dialog h2')).includes('yours'), 'a win displays actual results');
    await p.click('[data-act=rematch]'); ok(await state(p, () => RIFT_ENGINE.state().s.phase === 'countdown'), 'practice rematch starts a fresh countdown');
    await p.click('[data-act=pause]'); await p.click('[data-act=menu]');
    await p.click('[data-act=online]');
    await state(p, () => closeAppWindow(document.querySelector('.rr-app').closest('.app-window').id));
    await state(p, () => startMenuAction('brawlz')); await p.waitForSelector('.rr-menu');
    ok(true, 'closing a lobby and reopening the desktop app restores the fighter menu');
    // Desktop lazy loading is a different entry point and must use the same engine.
    const desktop = await open(ctx, BASE + '/games/rift-rumble/');
    ok(await desktop.locator('.app-window .rr-menu').isVisible() && new globalThis.URL(desktop.url()).pathname === '/', 'the old game URL redirects into the main desktop'); await desktop.close();
    await ctx.close();

    const localCtx = await context(), host = await open(localCtx), guest = await open(localCtx);
    const code = await hosted(host); await join(guest, code);
    await host.waitForFunction(() => Netplay.current.players.length === 2);
    await host.click('[data-act=start]'); await Promise.all([fighting(host), fighting(guest)]);
    ok(await state(guest, () => !RIFT_ENGINE.state().host && RIFT_ENGINE.state().s.players.length === 2), 'two real tabs join and start a 1v1');
    const gx = await state(guest, () => { const g = RIFT_ENGINE.state(); return g.s.players.find(p => p.id === g.me).x; });
    await guest.keyboard.down('KeyA'); await guest.waitForTimeout(250); await guest.keyboard.up('KeyA');
    ok(await state(host, () => { const g = RIFT_ENGINE.state(); return g.s.players.find(p => p.id !== g.me).x; }) < gx - 15, 'guest input changes the host-authoritative fighter');
    await state(host, () => { const g = RIFT_ENGINE.state(); g.s.players[1].stocks = 1; g.s.players[1].y = 1000; });
    await host.waitForSelector('[data-act=rematch]'); await guest.waitForSelector('.rr-dialog');
    const matchId = await state(guest, () => RIFT_ENGINE.state().id); await host.click('[data-act=rematch]');
    await guest.waitForFunction(id => RIFT_ENGINE.state().id !== id, matchId); ok(true, 'online rematch reaches both tabs with a new match identity');
    await host.close(); await guest.waitForFunction(() => RIFT_ENGINE.state().netDown, null, { timeout: 10000 }); ok(true, 'host loss produces a recoverable connection-lost screen'); await localCtx.close();

    const relayContexts = await Promise.all(Array.from({ length: 4 }, () => context()));
    const pages = []; for (const c of relayContexts) pages.push(await open(c));
    const relayCode = await hosted(pages[0], 'relay', 2);
    for (let i = 1; i < 4; i++) { await pages[i].click('[data-fighter="' + i + '"]'); await join(pages[i], relayCode, 'relay'); }
    await pages[0].waitForFunction(() => Netplay.current.players.length === 4);
    await pages[0].click('[data-act=start]'); await Promise.all(pages.map(fighting));
    ok((await Promise.all(pages.map(p => state(p, () => { const g = RIFT_ENGINE.state(); return g.s.players.length === 4 && g.s.players.every(p => !p.bot); })))).every(Boolean), 'four independent browser contexts play a real WebSocket 2v2');
    ok(await state(pages[0], () => RIFT_ENGINE.state().s.players.map(p => p.character).join(',') === '0,1,2,3'), 'each remote player keeps their chosen character');
    // Put the guest on a safe platform and delay its real packets, then verify movement.
    await state(pages[0], () => { const p = RIFT_ENGINE.state().s.players[3]; p.x = 640; p.y = 524; p.vx = p.vy = 0; });
    await state(pages[3], () => { const s = Netplay.current, original = s.sendToHost.bind(s); s.sendToHost = (k, d) => setTimeout(() => original(k, d), 120); });
    await pages[3].keyboard.down('KeyD'); await pages[3].waitForTimeout(450); await pages[3].keyboard.up('KeyD');
    ok(await state(pages[0], () => RIFT_ENGINE.state().s.players[3].x > 655), 'delayed guest input still reaches the host');
    await pages[0].screenshot({ path: path.join(SHOTS, 'rr-online-2v2.png') });
    await pages[3].close(); await pages[0].waitForFunction(() => RIFT_ENGINE.state().s.players[3].bot, null, { timeout: 10000 });
    ok(true, 'a disconnected guest becomes a bot without ending the team match');
    for (const c of relayContexts) await c.close();

    }
    const phoneCtx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }), phone = await open(phoneCtx);
    ok(await state(phone, () => document.documentElement.scrollWidth <= innerWidth), 'portrait menu has no horizontal overflow');
    await phone.click('[data-act=solo]'); await fighting(phone);
    await phone.waitForTimeout(350); // the desktop window's responsive fit runs every 250 ms
    ok(await phone.locator('.rr-touch').isVisible(), 'touch controls appear on a phone');
    const phoneGeometry = await state(phone, () => {
        const body = document.querySelector('.rr-body').getBoundingClientRect(), header = document.querySelector('.rr-body').previousElementSibling.getBoundingClientRect();
        const hud = document.querySelector('.rr-match-hud').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.rr-touch button')].map(b => { const r = b.getBoundingClientRect(); return { key: b.dataset.control, left:r.left, right:r.right, bottom:r.bottom }; });
        return { ok: hud.top >= header.bottom && buttons.every(r => r.left >= body.left && r.right <= body.right && r.bottom <= body.bottom), body:{left:body.left,right:body.right,bottom:body.bottom}, headerBottom:header.bottom,hudTop:hud.top,buttons };
    });
    ok(phoneGeometry.ok, 'mobile HUD clears the titlebar and every touch button fits inside the window' + (phoneGeometry.ok ? '' : ': ' + JSON.stringify(phoneGeometry)));
    await phone.locator('[data-control=jump]').tap(); await phone.waitForTimeout(75);
    ok(await state(phone, () => RIFT_ENGINE.state().s.players[0].jumps > 0), 'touch input jumps in the actual simulation');
    await phone.screenshot({ path: path.join(SHOTS, 'rr-mobile.png') });
    await phone.setViewportSize({ width: 844, height: 390 }); await phone.waitForFunction(() => document.querySelector('.rr-app').closest('.app-window').classList.contains('fs-active'));
    ok(await state(phone, () => document.documentElement.scrollWidth <= innerWidth), 'landscape controls fit without horizontal overflow'); await phoneCtx.close();
    ok(errors.length === 0, 'no JavaScript page errors: ' + errors.join('; '));
    console.log('Brawlz 98: ' + checks + ' browser checks passed.');
} finally { if (browser) await browser.close(); relay.kill(); await new Promise(r => server.close(r)); }
