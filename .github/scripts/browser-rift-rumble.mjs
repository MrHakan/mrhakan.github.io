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
async function hosted(p, transport = 'local', mode = 1, arena) {
    if (mode === 2) await p.click('[data-mode="2"]');
    if (arena) await p.selectOption('#rr-arena', arena);
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
    await loadingCtx.route('**/games/rift-rumble/art/rig-*.png', async route => { await artGate; await route.continue(); });
    const loadingPage = await loadingCtx.newPage(); loadingPage.on('pageerror', e => errors.push(e.message));
    await loadingPage.goto(GAME_URL, { waitUntil: 'domcontentloaded' }); await loadingPage.waitForSelector('.rr-menu');
    await loadingPage.click('[data-act=solo]');
    ok(await state(loadingPage, () => RIFT_ENGINE.screen() === 'loading' && RIFT_ENGINE.state() === null), 'slow art loading holds the match before its countdown');
    releaseArt(); await loadingPage.waitForFunction(() => RIFT_ENGINE.state()?.s.phase === 'countdown');
    ok(await state(loadingPage, () => RIFT_ART.ready()), 'a match starts only after every cutout rig is ready'); await loadingCtx.close();
    const ctx = await context(), p = await open(ctx);
    ok(await p.locator('.rr-char').count() === 12, 'twelve original cursed emoji fighters are selectable');
    ok(await p.locator('.app-window .rr-app').count() === 1 && !await p.locator('#rift-app').count(), 'the game lives inside the main desktop app window');
    await p.waitForFunction(() => RIFT_ART.ready());
    ok(await state(p, () => RIFT_ART.metrics().length === 12 && RIFT_ART.metrics().every(r => r.parts === 16)), 'all twelve fighters load their sixteen separate cutout attachments');
    await p.click('[data-fighter="3"]'); await p.selectOption('#rr-arena', 'moon');
    await p.click('[data-mode="2"]');
    const teamMaps = await p.locator('#rr-arena option').allTextContents();
    ok(teamMaps.join(',') === 'LAN Party,Disk Defrag,Print Queue', '2v2 offers its own three large maps');
    await p.selectOption('#rr-arena', 'print');
    await p.click('[data-mode="1"]');
    ok(await p.locator('#rr-arena').inputValue() === 'moon', 'switching to 1v1 restores the last duel map');
    await p.click('[data-mode="2"]');
    ok(await p.locator('#rr-arena').inputValue() === 'print', 'switching back to 2v2 restores the team map');
    await p.screenshot({ path: path.join(SHOTS, 'rr-menu.png') });
    await p.click('[data-act=help]'); ok(await p.locator('[role=dialog]').isVisible(), 'instructions open from the menu'); await p.click('[data-act=close-help]');
    await p.click('[data-act=solo]');
    ok(await state(p, () => { const s = RIFT_ENGINE.state().s; return s.players.length === 4 && s.arena === 'print' && s.players[0].character === 3 && s.players.filter(p => p.bot).length === 3; }), 'fighter, team size and arena choices reach the rules');
    await fighting(p); const x = await state(p, () => RIFT_ENGINE.state().s.players[0].x);
    await p.keyboard.down('KeyD'); await p.waitForTimeout(200); await p.keyboard.up('KeyD');
    ok(await state(p, () => RIFT_ENGINE.state().s.players[0].x) > x + 10, 'real keyboard input moves the fighter');
    await p.keyboard.press('Space'); await p.waitForTimeout(75); await p.keyboard.press('Space'); await p.waitForTimeout(75);
    ok(await state(p, () => RIFT_ENGINE.state().s.players[0].jumps) === 2, 'real keyboard input double jumps');
    const readyAttack = () => state(p, () => {
        const s = RIFT_ENGINE.state().s, f = s.players[0];
        Object.assign(f, { x: 500, y: 524, vx: 0, vy: 0, grounded: true, stun: 0, dodge: 0, cooldown: 0, attack: null, invuln: 600 });
        s.players.slice(1).forEach((p, i) => { p.x = 930 + i * 25; p.y = 524; });
    });
    for (const [code, kind] of [['KeyE', 'light'], ['KeyF', 'heavy'], ['KeyR', 'special']]) {
        await readyAttack();
        await p.keyboard.press(code); await p.waitForTimeout(40);
        ok(await state(p, () => RIFT_ENGINE.state().s.players[0].attack?.kind) === kind, code + ' triggers the actual ' + kind + ' attack');
    }
    await p.evaluate(() => document.querySelector('.rr-app').addEventListener('contextmenu', e => { window.rrContextBlocked = e.defaultPrevented; }));
    for (const [button, kind] of [['left', 'light'], ['right', 'heavy']]) {
        await readyAttack();
        await p.locator('.rr-ui').click({ position: { x: 320, y: 280 }, button }); await p.waitForTimeout(40);
        ok(await state(p, () => RIFT_ENGINE.state().s.players[0].attack?.kind) === kind, button + ' mouse button triggers the actual ' + kind + ' attack');
    }
    ok(await p.evaluate(() => window.rrContextBlocked === true), 'right-click attacks suppress the browser context menu inside the arena');
    await readyAttack();
    const beforeShift = await state(p, () => RIFT_ENGINE.state().s.players[0].input.heavy);
    await p.evaluate(() => { window.rrContextBlocked = false; });
    await p.locator('.rr-ui').click({ position: { x: 320, y: 280 }, button: 'right', modifiers: ['Shift'] });
    ok(await state(p, () => window.rrContextBlocked && !document.querySelector('#ctx-menu.open')),
        'Shift and right-click suppress both menus inside the arena');
    await p.waitForFunction(value => RIFT_ENGINE.state().s.players[0].input.heavy >= value, beforeShift + 1);
    ok(await state(p, () => RIFT_ENGINE.state().s.players[0].input.heavy) === beforeShift + 1,
        'Shift and right-click still queue one heavy attack');
    const focusWindow = await p.evaluate(() => {
        const w = createAppWindow('Mouse focus check', { width: 120 });
        w.win.style.left = '0px'; w.win.style.top = '0px'; return w.win.id;
    });
    await readyAttack();
    await p.locator('.rr-ui').click({ position: { x: 320, y: 280 } });
    ok(await p.evaluate(id => Number(document.querySelector('.rr-app').closest('.app-window').style.zIndex) > Number(document.getElementById(id).style.zIndex), focusWindow), 'clicking the arena also brings its desktop window forward');
    await p.evaluate(id => closeAppWindow(id), focusWindow);
    await readyAttack();
    const arenaBox = await p.locator('.rr-ui').boundingBox();
    await p.mouse.move(arenaBox.x + 320, arenaBox.y + 280); await p.mouse.down();
    const held = await state(p, () => RIFT_ENGINE.state().s.players[0].input.light);
    await p.waitForTimeout(400); await p.mouse.up();
    ok(await state(p, () => RIFT_ENGINE.state().s.players[0].input.light) === held, 'holding a mouse button queues one attack per press');
    const beforeTools = await state(p, () => JSON.stringify(RIFT_ENGINE.state().s.players[0].input));
    await p.click('[data-act=sound]');
    ok(await state(p, () => JSON.stringify(RIFT_ENGINE.state().s.players[0].input)) === beforeTools, 'clicking match tools does not trigger an attack');
    await p.evaluate(() => { window.rrContextBlocked = false; });
    await p.locator('[data-act=sound]').click({ button: 'right', modifiers: ['Shift'] });
    ok(await state(p, () => window.rrContextBlocked && !document.querySelector('#ctx-menu.open')),
        'Shift and right-click suppress both menus over match tools');
    ok(await state(p, () => RIFT_ENGINE.state().s.players[0].input.heavy) === JSON.parse(beforeTools).heavy,
        'Shift and right-click over match tools do not queue a heavy attack');
    await p.waitForFunction(() => typeof heldTrack !== 'undefined' && !!heldTrack);
    ok(await state(p, () => tracks.some(t => t.filename === heldTrack.filename) && document.getElementById('audio-player').paused), 'match music chooses a library track and respects the site mute');
    await p.keyboard.press('Escape'); const tick = await state(p, () => RIFT_ENGINE.state().s.tick); await p.waitForTimeout(200);
    ok(await state(p, () => RIFT_ENGINE.state().s.tick) === tick, 'practice pauses without consuming match time');
    const beforeDialog = await state(p, () => JSON.stringify(RIFT_ENGINE.state().s.players[0].input));
    await p.locator('.rr-dialog h2').click();
    ok(await state(p, () => JSON.stringify(RIFT_ENGINE.state().s.players[0].input)) === beforeDialog, 'clicking a pause dialog does not queue an attack');
    await p.evaluate(() => { window.rrContextBlocked = false; });
    await p.locator('.rr-dialog h2').click({ button: 'right', modifiers: ['Shift'] });
    ok(await state(p, () => window.rrContextBlocked && !document.querySelector('#ctx-menu.open')),
        'Shift and right-click suppress both menus in the pause dialog');
    const pausedPicture = await state(p, () => document.querySelector('.rr-canvas').toDataURL()); await p.waitForTimeout(160);
    ok(await state(p, () => document.querySelector('.rr-canvas').toDataURL()) === pausedPicture, 'pause freezes fighter frames, invulnerability flashes and combat effects'); await p.click('[data-act=resume]');
    await state(p, () => {
        window.rrTestPad = { axes: [1, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.rrTestPad] });
        const fighter = RIFT_ENGINE.state().s.players[0]; fighter.x = 500; fighter.y = 524; fighter.vx = fighter.vy = 0; fighter.grounded = true; fighter.jumps = 0; fighter.stun = 0; fighter.dodge = 0; fighter.attack = null; fighter.invuln = 600;
        RIFT_ENGINE.state().s.players.slice(1).forEach((p, i) => { p.x = 930 + i * 25; p.y = 524; });
    });
    await p.waitForFunction(() => RIFT_ENGINE.state().s.players[0].x > 510);
    ok(true, 'gamepad axes move the actual fighter');
    const padPressTick = await state(p, () => { rrTestPad.axes[0] = 0; rrTestPad.buttons[0].pressed = true; return RIFT_ENGINE.state().s.tick; });
    await p.waitForFunction(tick => RIFT_ENGINE.state().s.tick >= tick + 6, padPressTick);
    ok(await state(p, () => RIFT_ENGINE.state().s.players[0].jumps === 1), 'a held gamepad jump triggers once');
    const padReleaseTick = await state(p, () => { rrTestPad.buttons[0].pressed = false; return RIFT_ENGINE.state().s.tick; });
    await p.waitForFunction(tick => RIFT_ENGINE.state().s.tick > tick, padReleaseTick);
    await state(p, () => { rrTestPad.buttons[0].pressed = true; });
    await p.waitForFunction(() => RIFT_ENGINE.state().s.players[0].jumps === 2);
    ok(true, 'a second gamepad press double jumps');
    await state(p, () => { window.rrTestPad = null; });
    await p.screenshot({ path: path.join(SHOTS, 'rr-fight.png') });
    if (process.env.RR_RECORD) {
        await p.evaluate(() => {
            window.rrClips = [];
            window.rrRecorder = new MediaRecorder(document.querySelector('.rr-canvas').captureStream(60), { mimeType: 'video/webm;codecs=vp9' });
            rrRecorder.ondataavailable = e => rrClips.push(e.data); rrRecorder.start();
        });
        for (const direction of ['KeyD', 'KeyA']) {
            await p.keyboard.down(direction); await p.waitForTimeout(550); await p.keyboard.up(direction);
            await p.keyboard.press('KeyE'); await p.waitForTimeout(550);
            await p.keyboard.press('KeyF'); await p.waitForTimeout(850);
            await p.keyboard.press('Space'); await p.waitForTimeout(850);
        }
        const clip = await p.evaluate(() => new Promise(resolve => {
            rrRecorder.onstop = () => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(new Blob(rrClips)); }; rrRecorder.stop();
        }));
        fs.writeFileSync(path.join(SHOTS, 'brawlz-gameplay.webm'), Buffer.from(clip, 'base64'));
    }
    await state(p, () => { RIFT_ENGINE.state().s.players.filter(p => p.team === 1).forEach(p => { p.stocks = 1; p.y = 1000; }); });
    await p.waitForSelector('[data-act=rematch]'); ok((await p.textContent('.rr-dialog h2')).includes('yours'), 'a win displays actual results');
    await p.click('[data-act=rematch]'); ok(await state(p, () => RIFT_ENGINE.state().s.phase === 'countdown'), 'practice rematch starts a fresh countdown');
    await p.click('[data-act=pause]'); await p.click('[data-act=menu]');
    await p.click('[data-fighter="5"]'); await p.click('[data-mode="1"]'); await p.selectOption('#rr-arena', 'sky');
    ok((await p.locator('.rr-special-name').innerText()).includes('Grin pounce'), 'Hehe lists his new special on the fighter screen');
    await p.click('[data-act=solo]'); await fighting(p); await readyAttack();
    await state(p, () => {
        const s = RIFT_ENGINE.state().s;
        const [hehe, rival] = s.players;
        hehe.facing = 1;
        Object.assign(rival, { x: 707, y: 524, vx: 0, vy: 0, grounded: true, bot: false, invuln: 0, damage: 0, attack: null, dodge: 0, drop: 0, queued: {} });
        RIFT_SIM.setInput(s, rival.slot, {});
    });
    await p.keyboard.press('KeyR');
    await p.waitForFunction(() => {
        const [hehe] = RIFT_ENGINE.state().s.players;
        return hehe.attack?.kind === 'special' && hehe.x > 540 && hehe.y < 495;
    });
    await p.waitForFunction(() => RIFT_ENGINE.state().s.players[1].damage > 0);
    ok(await state(p, () => RIFT_ENGINE.state().s.shots.length === 0), 'Hehe leaps forward and strikes the rival with a melee special');
    await p.click('[data-act=pause]'); await p.click('[data-act=menu]');
    await p.click('[data-act=online]');
    await state(p, () => closeAppWindow(document.querySelector('.rr-app').closest('.app-window').id));
    await state(p, () => startMenuAction('brawlz')); await p.waitForSelector('.rr-menu');
    ok(true, 'closing a lobby and reopening the desktop app restores the fighter menu');
    // Desktop lazy loading is a different entry point and must use the same engine.
    const desktop = await open(ctx, BASE + '/games/rift-rumble/');
    ok(await desktop.locator('.app-window .rr-menu').isVisible() && new globalThis.URL(desktop.url()).pathname === '/', 'the old game URL redirects into the main desktop'); await desktop.close();
    await ctx.close();

    // Exercise the real Winamp ownership and playback API. A short PCM tone
    // replaces media bytes only; selection, autoplay, mute and cleanup are real.
    const musicCtx = await context();
    await musicCtx.addInitScript(() => localStorage.setItem('sound-enabled', 'true'));
    const rate = 8000, wav = Buffer.alloc(44 + rate * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + rate * 2, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(rate * 2, 40);
    for (let i = 0; i < rate; i++) wav.writeInt16LE(Math.round(Math.sin(i / 8) * 2000), 44 + i * 2);
    await musicCtx.route(/\/src\/music\/.*\.(mp3|mp4|ogg|wav)(?:\?.*)?$/i, route => route.fulfill({ contentType: 'audio/wav', body: wav }));
    let releaseSongs;
    const songGate = new Promise(resolve => { releaseSongs = resolve; });
    await musicCtx.route('**/src/music/music.json', async route => { await songGate; await route.continue(); });
    const music = await open(musicCtx), closeMusicGame = () => music.evaluate(() => closeAppWindow(document.querySelector('.rr-app').closest('.app-window').id));
    await music.click('[data-act=solo]'); await music.waitForFunction(() => !!RIFT_ENGINE.state());
    await closeMusicGame(); releaseSongs();
    await music.waitForFunction(() => tracks.length > 1); await music.waitForTimeout(250);
    ok(await music.evaluate(() => !heldTrack), 'closing before the music list loads cancels the pending song');
    await music.evaluate(() => startMenuAction('brawlz')); await music.waitForSelector('.rr-menu'); await music.click('[data-act=solo]');
    const playing = () => music.waitForFunction(() => !!heldTrack && !document.getElementById('audio-player').paused && document.getElementById('audio-player').currentTime > 0, null, { timeout: 10000 });
    await playing();
    const song = await music.evaluate(() => heldTrack.filename);
    ok(await music.evaluate(() => tracks.some(t => t.filename === heldTrack.filename) && document.getElementById('audio-player').loop), 'a match automatically plays a random library song through Winamp');
    await music.click('[data-act=music]');
    ok(await music.evaluate(() => !heldTrack && document.getElementById('audio-player').paused), 'music can be muted independently of attack effects');
    await music.click('[data-act=music]'); await playing();
    ok(await music.evaluate(() => heldTrack.filename) !== song, 'starting music again chooses a different song');
    const beforeRematch = await music.evaluate(() => { const g = RIFT_ENGINE.state(); g.s.players.filter(p => p.team === 1).forEach(p => { p.stocks = 1; p.y = 1000; }); return heldTrack.filename; });
    await music.waitForSelector('[data-act=rematch]'); await music.click('[data-act=rematch]'); await playing();
    ok(await music.evaluate(() => heldTrack.filename) !== beforeRematch, 'a rematch gets a fresh random song');
    await music.evaluate(() => toggleSound());
    ok(await music.evaluate(() => document.getElementById('audio-player').paused), 'the global sound switch also mutes match music');
    await music.evaluate(() => toggleSound()); await playing();
    await music.evaluate(() => pauseTrack()); await music.waitForTimeout(300);
    ok(await music.evaluate(() => document.getElementById('audio-player').paused), 'manual Winamp pause stays paused');
    await music.click('[data-act=pause]'); await music.click('[data-act=menu]');
    ok(await music.evaluate(() => !heldTrack && !document.getElementById('audio-player').loop), 'leaving a match releases its music');
    await music.click('[data-act=music]'); await music.click('[data-act=solo]'); await music.waitForTimeout(250);
    ok(await music.evaluate(() => !heldTrack && JSON.parse(localStorage.getItem('mrhakan98-rift-prefs')).music === false), 'the saved music-off preference prevents automatic playback');
    await music.click('[data-act=music]'); await playing();
    await music.evaluate(() => { const i = tracks.findIndex(t => t.filename !== heldTrack.filename); currentTrackIndex = i; loadTrack(i); playTrack(); });
    await music.waitForFunction(() => !heldTrack && !document.getElementById('audio-player').paused);
    await closeMusicGame();
    ok(await music.evaluate(() => !document.getElementById('audio-player').paused), 'closing the game preserves a song the visitor chose manually');
    await musicCtx.close();

    const localCtx = await context(), host = await open(localCtx), guest = await open(localCtx);
    const code = await hosted(host); await join(guest, code);
    await host.waitForFunction(() => Netplay.current.players.length === 2);
    await host.click('[data-act=start]'); await Promise.all([fighting(host), fighting(guest)]);
    ok(await state(guest, () => !RIFT_ENGINE.state().host && RIFT_ENGINE.state().s.players.length === 2), 'two real tabs join and start a 1v1');
    const gx = await state(guest, () => { const g = RIFT_ENGINE.state(); return g.s.players.find(p => p.id === g.me).x; });
    await guest.keyboard.down('KeyA'); await guest.waitForTimeout(250); await guest.keyboard.up('KeyA');
    ok(await state(host, () => { const g = RIFT_ENGINE.state(); return g.s.players.find(p => p.id !== g.me).x; }) < gx - 15, 'guest input changes the host-authoritative fighter');
    for (const [button, kind] of [['left', 'light'], ['right', 'heavy']]) {
        await state(host, () => {
            const g = RIFT_ENGINE.state(), f = g.s.players.find(p => p.id !== g.me);
            Object.assign(f, { x: 500, y: 524, vx: 0, vy: 0, grounded: true, stun: 0, dodge: 0, cooldown: 0, attack: null, invuln: 600 });
        });
        await guest.locator('.rr-ui').click({ position: { x: 320, y: 280 }, button });
        await host.waitForFunction(kind => { const g = RIFT_ENGINE.state(); return g.s.players.find(p => p.id !== g.me).attack?.kind === kind; }, kind);
        ok(true, 'guest ' + button + '-click reaches the host as a ' + kind + ' attack');
    }
    await state(host, () => { const g = RIFT_ENGINE.state(); g.s.players[1].stocks = 1; g.s.players[1].y = 1000; });
    await host.waitForSelector('[data-act=rematch]'); await guest.waitForSelector('.rr-dialog');
    const matchId = await state(guest, () => RIFT_ENGINE.state().id); await host.click('[data-act=rematch]');
    await guest.waitForFunction(id => RIFT_ENGINE.state().id !== id, matchId); ok(true, 'online rematch reaches both tabs with a new match identity');
    await host.close(); await guest.waitForFunction(() => RIFT_ENGINE.state().netDown, null, { timeout: 10000 }); ok(true, 'host loss produces a recoverable connection-lost screen'); await localCtx.close();

    const relayContexts = await Promise.all(Array.from({ length: 4 }, () => context()));
    const pages = []; for (const c of relayContexts) pages.push(await open(c));
    const relayCode = await hosted(pages[0], 'relay', 2, 'defrag');
    for (let i = 1; i < 4; i++) { await pages[i].click('[data-fighter="' + i + '"]'); await join(pages[i], relayCode, 'relay'); }
    await pages[0].waitForFunction(() => Netplay.current.players.length === 4);
    await pages[0].click('[data-act=start]'); await Promise.all(pages.map(fighting));
    ok((await Promise.all(pages.map(p => state(p, () => { const g = RIFT_ENGINE.state(); return g.s.arena === 'defrag' && g.s.players.length === 4 && g.s.players.every(p => !p.bot); })))).every(Boolean), 'four independent browser contexts play a real WebSocket 2v2 on the host’s chosen team map');
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
    await phone.click('[data-mode="2"]'); await phone.selectOption('#rr-arena', 'lan');
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
    ok(await state(phone, () => {
        const status = document.querySelector('.rr-net-status').getBoundingClientRect();
        const tools = document.querySelector('.rr-match-tools').getBoundingClientRect();
        return status.bottom <= tools.top;
    }), 'mobile match status clears the match buttons');
    await phone.locator('[data-control=jump]').tap(); await phone.waitForTimeout(75);
    ok(await state(phone, () => RIFT_ENGINE.state().s.players[0].jumps > 0), 'touch input jumps in the actual simulation');
    await phone.screenshot({ path: path.join(SHOTS, 'rr-mobile.png') });
    await phone.setViewportSize({ width: 844, height: 390 }); await phone.waitForFunction(() => document.querySelector('.rr-app').closest('.app-window').classList.contains('fs-active'));
    ok(await state(phone, () => document.documentElement.scrollWidth <= innerWidth), 'landscape controls fit without horizontal overflow'); await phoneCtx.close();
    ok(errors.length === 0, 'no JavaScript page errors: ' + errors.join('; '));
    console.log('Brawlz 98: ' + checks + ' browser checks passed.');
} finally { if (browser) await browser.close(); relay.kill(); await new Promise(r => server.close(r)); }
