// ===================================================================
// browser-blastz.mjs — blastz 98 in real Chromium, with real transports
//
// The desktop opens it; one player and then two on one keyboard play with
// real keys and the mouse; a phone plays with taps; two tabs play online
// through the room (pick, perk, ready, a match, back to the room, a second
// match); four browsers over a real WebSocket relay with one dropping out;
// and the desktop's own multiplayer lobby sends everybody to the same room.
// Nothing leaves the machine. BZ_ONLY=solo|duo|phone|tabs|relay|desk runs one part.
// ===================================================================
import { chromium, devices } from 'playwright';
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
const BASE = 'http://127.0.0.1:' + server.address().port, GAME = BASE + '/?app=blastz';
const relayPort = 8800 + Math.floor(Math.random() * 90);
const relay = spawn(process.execPath, [path.join(ROOT, 'server/relay.js')], { env: { ...process.env, PORT: String(relayPort), HOST: '127.0.0.1' }, stdio: 'ignore' });
const only = process.env.BZ_ONLY || '';
const part = name => !only || only.split(',').includes(name);
let browser; const errors = []; let checks = 0;
const ok = (value, text) => { assert.ok(value, text); checks++; console.log('  ok    ' + text); };
async function context(options = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, ...options });
    await ctx.route('**/*', route => /^https?:\/\/127\.0\.0\.1[:/]/.test(route.request().url()) ? route.continue() : route.abort());
    await ctx.addInitScript(() => { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); });
    return ctx;
}
async function open(ctx, url = GAME) {
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
    await p.goto(url); await p.waitForSelector('.bz-menu'); await p.waitForFunction(() => RIFT_ART.ready()); return p;
}
const state = (p, fn, arg) => p.evaluate(fn, arg);
const fighting = p => p.waitForFunction(() => BLASTZ_ENGINE.state()?.s.phase === 'fight', null, { timeout: 30000 });
const inRoom = p => p.waitForSelector('.bz-room .bz-card');
// park a player in the middle of the main platform, nobody near, a long shield on everybody else
const park = (p, slot) => state(p, slot => {
    const s = BLASTZ_ENGINE.state().s, m = BLASTZ.map(s.map).platforms[0];
    s.crateAt = 1e9; s.crates = []; s.bombs = []; s.shots = [];
    s.players.forEach((q, i) => { if (i !== slot) Object.assign(q, { bot: false, x: 4000 + i * 50, y: -2000, vx: 0, vy: 0, dead: 0, input: BLASTZ_SIM.input() }); });
    Object.assign(s.players[slot], { x: m.x + m.w / 2, y: m.y, vx: 0, vy: 0, grounded: true, dead: 0, invuln: 0, facing: 1, jumps: 0, bombs: 2 });
    s.players.forEach((q, i) => { if (i !== slot) q.dead = 99999; });
}, slot);
async function hosted(p, transport = 'local') {
    await p.click('[data-act=online]'); await p.selectOption('#bz-transport', transport);
    if (transport === 'relay') await p.fill('#bz-relay', 'ws://127.0.0.1:' + relayPort);
    await p.click('[data-act=host]'); await inRoom(p);
    return (await p.textContent('.bz-room-code')).trim();
}
async function join(p, code, transport = 'local') {
    await p.click('[data-act=online]'); await p.selectOption('#bz-transport', transport);
    if (transport === 'relay') await p.fill('#bz-relay', 'ws://127.0.0.1:' + relayPort);
    await p.fill('#bz-code', code); await p.click('[data-act=join]'); await inRoom(p);
}
// everyone but `keep` loses their last life: the match ends
const endMatch = (p, keep) => state(p, keep => { BLASTZ_ENGINE.state().s.players.forEach((q, i) => { if (i !== keep) { q.lives = 1; q.dead = 0; q.y = 5000; } }); }, keep);

try {
    for (let i = 0; i < 30; i++) { try { if ((await fetch('http://127.0.0.1:' + relayPort + '/healthz')).ok) break; } catch (_) {} await new Promise(r => setTimeout(r, 100)); }
    browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

    if (part('solo')) {
        console.log('\n== one player ==');
        const ctx = await context(), p = await open(ctx);
        ok(await p.locator('.app-window .bz-app').count() === 1, 'blastz opens in a window on the desktop');
        ok(await p.locator('.bz-char').count() === 12, 'all twelve Brawlz 98 fighters are there');
        ok(await state(p, () => [...document.querySelectorAll('.bz-char canvas')].every(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n > 400; })), 'and every one is drawn from its rig');
        await p.click('[data-fighter="3"]'); await p.click('[data-perk="anchor"]');
        await p.click('[data-act=count][data-v="3"]'); await p.selectOption('#bz-map', 'tower');
        ok(await p.locator('[data-fighter="3"][aria-pressed=true]').count() === 1 && await p.locator('[data-perk="anchor"][aria-pressed=true]').count() === 1, 'a fighter and a perk are picked');
        await p.screenshot({ path: path.join(SHOTS, 'bz-menu.png') });
        await p.click('[data-act=help]'); ok(await p.locator('[role=dialog]').isVisible(), 'how to play opens'); await p.click('[data-act=close-help]');
        await p.click('[data-act=solo]'); await fighting(p);
        ok(await state(p, () => { const s = BLASTZ_ENGINE.state().s; return s.players.length === 3 && s.map === 'tower' && s.players[0].character === 3 && s.players[0].perk === 'anchor' && s.players.filter(q => q.bot).length === 2; }), 'the choices reach the rules: map, fighter, perk and two bots');
        await park(p, 0);
        const x = await state(p, () => BLASTZ_ENGINE.state().s.players[0].x);
        await p.keyboard.down('KeyD'); await p.waitForTimeout(250); await p.keyboard.up('KeyD');
        ok(await state(p, () => BLASTZ_ENGINE.state().s.players[0].x) > x + 15, 'D walks right');
        await p.keyboard.press('Space'); await p.waitForTimeout(80); await p.keyboard.press('KeyW'); await p.waitForTimeout(80);
        ok(await state(p, () => BLASTZ_ENGINE.state().s.players[0].jumps) === 2, 'Space and W double jump');
        await p.waitForFunction(() => BLASTZ_ENGINE.state().s.players[0].grounded, null, { timeout: 5000 });
        await park(p, 0);
        await p.keyboard.down('KeyF'); await p.waitForTimeout(400); await p.keyboard.up('KeyF');
        ok(await state(p, () => BLASTZ_ENGINE.state().s.players[0].mag < BLASTZ.WEAPONS[0].mag), 'holding F fires');
        // the site's sound switch is on in this part: every gun has a voice of its own
        await p.evaluate(() => { soundEnabled = true; });
        await park(p, 0);
        await p.keyboard.down('KeyF'); await p.waitForTimeout(300); await p.keyboard.up('KeyF');
        for (const id of ['cannon', 'sheet', 'delete']) {
            await park(p, 0);
            await state(p, id => { const q = BLASTZ_ENGINE.state().s.players[0]; Object.assign(q, { weapon: BLASTZ.WEAPONS.findIndex(w => w.id === id), mag: 3, clips: 1, cd: 0, reload: 0 }); }, id);
            await p.keyboard.down('KeyF'); await p.waitForTimeout(120); await p.keyboard.up('KeyF');
        }
        await p.waitForTimeout(100);
        ok(await state(p, () => ['pea', 'cannon', 'sheet', 'delete'].every(k => BLASTZ_ENGINE.heard().includes(k))), 'with sound on, the pea shooter, hand cannon, spread sheet and delete key each make their own sound');
        await park(p, 0); await state(p, () => { const s = BLASTZ_ENGINE.state().s, m = BLASTZ.map(s.map).platforms[0]; Object.assign(s.players[0], { x: m.x + 60, facing: 1 }); });
        await p.keyboard.press('KeyG');
        await p.waitForFunction(() => BLASTZ_ENGINE.heard().includes('boom'), null, { timeout: 5000 });
        ok(true, 'and a bomb goes off with a bang');
        await p.click('[data-act=sound]');
        const before = await state(p, () => BLASTZ_ENGINE.heard().length);
        await park(p, 0); await p.keyboard.down('KeyF'); await p.waitForTimeout(300); await p.keyboard.up('KeyF');
        ok(await state(p, n => BLASTZ_ENGINE.heard().length === n, before), 'the effects button silences them');
        await p.click('[data-act=sound]');
        await p.evaluate(() => { soundEnabled = false; });
        await p.keyboard.press('KeyG'); await p.waitForTimeout(80);
        ok(await state(p, () => BLASTZ_ENGINE.state().s.bombs.length === 1), 'G throws a bomb');
        await park(p, 0);
        await p.evaluate(() => { window.bzMenu = false; document.querySelector('.bz-app').addEventListener('contextmenu', e => { window.bzMenu = e.defaultPrevented; }); });
        await p.locator('.bz-ui').click({ position: { x: 600, y: 300 }, button: 'right' }); await p.waitForTimeout(80);
        ok(await state(p, () => BLASTZ_ENGINE.state().s.bombs.length === 1 && window.bzMenu === true), 'a right click throws a bomb, not the browser menu');
        await park(p, 0);
        const box = await p.locator('.bz-ui').boundingBox();
        await p.mouse.move(box.x + 600, box.y + 300); await p.mouse.down(); await p.waitForTimeout(400); await p.mouse.up();
        ok(await state(p, () => BLASTZ_ENGINE.state().s.players[0].mag < BLASTZ.WEAPONS[0].mag && !BLASTZ_ENGINE.locals()[0].fire), 'holding the left button fires, letting go stops');
        await p.screenshot({ path: path.join(SHOTS, 'bz-solo.png') });
        await p.keyboard.press('Escape'); ok(await state(p, () => BLASTZ_ENGINE.state().paused), 'Escape pauses practice');
        await p.click('[data-act=resume]');
        await endMatch(p, 0);
        await p.waitForSelector('.bz-dialog [data-act=again]', { timeout: 10000 });
        ok(await state(p, () => BLASTZ_ENGINE.meta().matches === 1 && BLASTZ_ENGINE.meta().wins === 1) && (await p.locator('.bz-result').count()) === 3, 'a win ends with the places and goes on the record');
        ok(await state(p, () => { const a = JSON.parse(localStorage.getItem('achievements') || '{}'); return !!(a.blastz && a.blastz_win); }), 'opening it and winning unlock the two achievements');
        await p.click('[data-act=again]'); await fighting(p);
        ok(await state(p, () => BLASTZ_ENGINE.state().s.players.length === 3), 'again starts a fresh match');
        await p.click('[data-act=pause]'); await p.click('.bz-dialog [data-act=menu]'); await p.waitForSelector('.bz-menu');
        // the run box and the start menu open the same window
        await p.evaluate(() => closeAppWindow(document.querySelector('.bz-app').closest('.app-window').id));
        await p.waitForFunction(() => !document.querySelector('.bz-app'));
        await p.evaluate(() => startMenuAction('blastz')); await p.waitForSelector('.bz-menu');
        ok(true, 'the start menu opens it again');
        await ctx.close();
    }

    if (part('duo')) {
        console.log('\n== two on one keyboard ==');
        const ctx = await context(), p = await open(ctx);
        await p.click('[data-act=humans][data-v="2"]');
        ok(await p.locator('.bz-tabs [role=tab]').count() === 2, 'two players get a tab each');
        await p.click('.bz-tabs [data-v="1"]'); await p.click('[data-fighter="7"]'); await p.click('[data-perk="steady"]');
        await p.click('.bz-tabs [data-v="0"]'); await p.click('[data-fighter="2"]');
        await p.click('[data-act=solo]'); await fighting(p);
        ok(await state(p, () => { const s = BLASTZ_ENGINE.state().s; return !s.players[0].bot && !s.players[1].bot && s.players[0].character === 2 && s.players[1].character === 7 && s.players[1].perk === 'steady'; }), 'both players are in, with their own fighters and perks');
        await park(p, 1);
        const x = await state(p, () => BLASTZ_ENGINE.state().s.players[1].x);
        await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(250); await p.keyboard.up('ArrowLeft');
        await p.keyboard.down('KeyK'); await p.waitForTimeout(300); await p.keyboard.up('KeyK');
        ok(await state(p, x => { const q = BLASTZ_ENGINE.state().s.players[1]; return q.x < x - 15 && q.mag < BLASTZ.WEAPONS[0].mag; }, x), 'P2 walks on the arrows and fires on K');
        await park(p, 0);
        const y = await state(p, () => BLASTZ_ENGINE.state().s.players[1].y);
        await p.keyboard.down('KeyD'); await p.waitForTimeout(250); await p.keyboard.up('KeyD');
        ok(await state(p, y => { const s = BLASTZ_ENGINE.state().s; return s.players[0].x > 650 && s.players[1].y === y; }, y), 'WASD moves P1 and only P1');
        await ctx.close();
    }

    if (part('phone')) {
        console.log('\n== a phone ==');
        const ctx = await context({ ...devices['Pixel 7'] }), p = await open(ctx);
        await p.click('[data-act=solo]'); await fighting(p);
        ok(await p.locator('.bz-touch [data-control=fire]').isVisible(), 'a phone gets touch buttons');
        await park(p, 0);
        const x = await state(p, () => BLASTZ_ENGINE.state().s.players[0].x);
        await p.locator('[data-control=right]').dispatchEvent('pointerdown', { pointerId: 3, button: 0, pointerType: 'touch' }); await p.waitForTimeout(250);
        await p.locator('[data-control=right]').dispatchEvent('pointerup', { pointerId: 3, button: 0, pointerType: 'touch' });
        await p.locator('[data-control=fire]').dispatchEvent('pointerdown', { pointerId: 4, button: 0, pointerType: 'touch' }); await p.waitForTimeout(250);
        await p.locator('[data-control=fire]').dispatchEvent('pointerup', { pointerId: 4, button: 0, pointerType: 'touch' });
        ok(await state(p, x => { const q = BLASTZ_ENGINE.state().s.players[0]; return q.x > x + 10 && q.mag < BLASTZ.WEAPONS[0].mag; }, x), 'taps move and fire');
        await p.screenshot({ path: path.join(SHOTS, 'bz-phone.png') });
        await ctx.close();
    }

    if (part('tabs')) {
        console.log('\n== online, two tabs ==');
        const ctx = await context(), host = await open(ctx), guest = await open(ctx);
        const code = await hosted(host, 'local');
        ok(/^[2-9A-HJ-NP-Z]{5}$/.test(code), 'a room has a five letter code');
        await join(guest, code, 'local');
        await Promise.all([host, guest].map(p => p.waitForFunction(() => BLASTZ_ENGINE.room()?.seats.length === 2)));
        ok(await guest.locator('.bz-card').count() === 4 && await guest.locator('.bz-card-cpu').count() === 2, 'two people and two bots in a four-fighter room');
        await host.selectOption('[data-rule=map]', 'mines'); await host.selectOption('[data-rule=lives]', '3');
        await guest.waitForFunction(() => BLASTZ_ENGINE.room().rules.map === 'mines' && BLASTZ_ENGINE.room().rules.lives === 3);
        ok((await guest.locator('#bz-rules').innerText()).includes('the minefield'), "the host's rules reach the guest");
        await guest.click('.bz-room [data-fighter="9"]'); await guest.click('.bz-room [data-perk="bomber"]');
        await host.waitForFunction(() => { const s = BLASTZ_ENGINE.room().seats[1]; return s.pick === 9 && s.perk === 'bomber'; });
        ok(true, "the guest's fighter and perk reach the host");
        await guest.click('.bz-room [data-act=ready]');
        await host.waitForFunction(() => BLASTZ_ENGINE.room().seats[1].ready);
        await guest.click('.bz-room [data-fighter="4"]', { force: true }); await guest.waitForTimeout(300);
        ok(await state(host, () => BLASTZ_ENGINE.room().seats[1].pick === 9), 'ready locks the pick');
        await host.click('.bz-room [data-act=ready]');
        await Promise.all([fighting(host), fighting(guest)]);
        ok(await state(guest, () => { const g = BLASTZ_ENGINE.state(); return g.s.map === 'mines' && g.s.lives === 3 && g.s.players[1].character === 9 && g.s.players[1].perk === 'bomber' && g.s.players.length === 4; }), 'everybody starts the same match from the room');
        await park(host, 1);
        const gx = await state(host, () => BLASTZ_ENGINE.state().s.players[1].x);
        await guest.keyboard.down('KeyA'); await guest.waitForTimeout(400); await guest.keyboard.up('KeyA');
        await guest.keyboard.down('KeyF'); await guest.waitForTimeout(400); await guest.keyboard.up('KeyF');
        await host.waitForFunction(gx => BLASTZ_ENGINE.state().s.players[1].x < gx - 15, gx);
        ok(await state(host, () => BLASTZ_ENGINE.state().s.players[1].mag < BLASTZ.WEAPONS[0].mag), "the guest's keys move and fire its fighter on the host");
        await guest.waitForFunction(() => BLASTZ_ENGINE.state().s.players[1].mag < BLASTZ.WEAPONS[0].mag);
        ok(true, 'and the host sends that back in its snapshots');
        await guest.screenshot({ path: path.join(SHOTS, 'bz-online.png') });
        const first = await state(host, () => BLASTZ_ENGINE.state().id);
        await endMatch(host, 1);
        await Promise.all([host, guest].map(p => p.waitForSelector('.bz-dialog [data-act=room]', { timeout: 15000 })));
        await guest.click('[data-act=room]'); await host.click('[data-act=room]');
        await Promise.all([host, guest].map(p => inRoom(p)));
        ok(await state(guest, () => { const r = BLASTZ_ENGINE.room(); return r.played === 1 && r.seats[1].wins === 1 && r.seats[0].wins === 0 && r.seats.every(s => !s.ready); }), 'back in the same room, the win on the right card, nobody ready');
        ok(await state(guest, () => BLASTZ_ENGINE.meta().wins === 1), 'the guest keeps its own record');
        await guest.click('.bz-room [data-fighter="5"]');
        await host.click('.bz-room [data-act=ready]'); await guest.click('.bz-room [data-act=ready]');
        await Promise.all([fighting(host), fighting(guest)]);
        ok(await state(guest, id => { const g = BLASTZ_ENGINE.state(); return g.id !== id && g.s.players[1].character === 5; }, first), 'a second match from the same room, with the new pick');
        // somebody arriving through the desktop lobby in the middle of it waits for the next one
        const late = await open(ctx);
        await late.evaluate(() => Netplay.openLobby({ gameId: 'blastz' }));
        await late.selectOption('#np-mode', 'local'); await late.fill('#np-code', code); await late.click('#np-join');
        await late.waitForSelector('.bz-room .bz-card', { timeout: 15000 });
        await late.waitForFunction(() => BLASTZ_ENGINE.room()?.seats.length === 3);
        ok(await state(late, () => BLASTZ_ENGINE.room().phase === 'match' && document.querySelector('.bz-ready').disabled), 'a late joiner from the desktop lobby waits in the room');
        await host.close();
        await guest.waitForFunction(() => BLASTZ_ENGINE.state()?.netDown, null, { timeout: 10000 });
        ok(true, 'losing the host shows a connection lost screen');
        await ctx.close();
    }

    if (part('relay')) {
        console.log('\n== four browsers over a WebSocket relay ==');
        const ctxs = await Promise.all([0, 1, 2, 3].map(() => context()));
        const pages = []; for (const c of ctxs) pages.push(await open(c));
        for (let i = 1; i < 4; i++) { await pages[i].click('[data-fighter="' + (i + 4) + '"]'); }
        const code = await hosted(pages[0], 'relay');
        for (let i = 1; i < 4; i++) await join(pages[i], code, 'relay');
        await Promise.all(pages.map(p => p.waitForFunction(() => BLASTZ_ENGINE.room()?.seats.length === 4)));
        ok((await Promise.all(pages.map(p => state(p, () => BLASTZ_ENGINE.room().seats.slice(1).map(s => s.pick).join() === '5,6,7' && !document.querySelector('.bz-card-cpu'))))).every(Boolean), 'four separate browsers see the same four picks and no bots');
        await pages[0].selectOption('[data-rule=teams]', '1');
        await Promise.all(pages.map(p => p.waitForFunction(() => BLASTZ_ENGINE.room().rules.teams)));
        ok(await state(pages[2], () => { const t = BLASTZ_ENGINE.room().seats.map(s => s.team); return t.filter(x => x === 0).length === 2 && t.filter(x => x === 1).length === 2; }), 'two teams split the room two and two');
        for (const p of pages.slice(0, 3)) await p.click('.bz-room [data-act=ready]');
        await pages[0].waitForTimeout(500);
        ok(await state(pages[0], () => BLASTZ_ENGINE.room().phase === 'select'), 'the room waits for the one who is not ready');
        await pages[3].close();
        await Promise.all(pages.slice(0, 3).map(p => fighting(p)));
        ok(await state(pages[1], () => { const s = BLASTZ_ENGINE.state().s; return s.teams && s.players.length === 4 && s.players.filter(q => q.bot).length === 1; }), 'the one who left gets a bot and the rest start');
        await park(pages[0], 2);
        await state(pages[2], () => { const s = Netplay.current, send = s.sendToHost.bind(s); s.sendToHost = (k, d) => setTimeout(() => send(k, d), 120); });
        await pages[2].keyboard.down('KeyD'); await pages[2].waitForTimeout(450); await pages[2].keyboard.up('KeyD');
        await pages[0].waitForFunction(() => BLASTZ_ENGINE.state().s.players[2].x > 660, null, { timeout: 5000 });
        ok(true, 'a guest with 120 ms of lag still moves on the host');
        await pages[2].close();
        await pages[0].waitForFunction(() => BLASTZ_ENGINE.state().s.players[2].bot, null, { timeout: 10000 });
        ok(true, 'a guest who drops mid-match turns into a bot');
        for (const c of ctxs) await c.close();
    }

    if (part('desk')) {
        console.log('\n== from the desktop lobby ==');
        const ctx = await context(), a = await open(ctx), b = await open(ctx);
        await a.evaluate(() => Netplay.openLobby({ gameId: 'blastz' }));
        await a.selectOption('#np-mode', 'local'); await a.click('#np-host'); await a.waitForSelector('.np-code');
        const code = (await a.textContent('.np-code')).trim();
        await b.evaluate(() => Netplay.openLobby({ gameId: 'blastz' }));
        await b.selectOption('#np-mode', 'local'); await b.fill('#np-code', code); await b.click('#np-join');
        await b.waitForSelector('#np-ready'); await b.click('#np-ready');
        await a.waitForFunction(() => Netplay.current.players.length === 2 && Netplay.current.players.every(p => p.ready || p.host));
        await a.selectOption('[data-opt=count]', '2'); await a.selectOption('[data-opt=map]', 'board');
        await a.click('#np-start');
        await Promise.all([a, b].map(p => p.waitForFunction(() => BLASTZ_ENGINE.screen() === 'room' && BLASTZ_ENGINE.room()?.seats.length === 2)));
        ok(await state(b, c => BLASTZ_ENGINE.room().rules.count === 2 && BLASTZ_ENGINE.room().rules.map === 'board' && document.querySelectorAll('.bz-card').length === 2 && document.querySelector('.bz-room-code').textContent === c, code), "starting in the desktop lobby brings both to the room with the host's choices");
        ok(await state(a, () => Netplay.inviteLink(Netplay.current.code, 'blastz').includes('join/blastz/?lobby=')), 'the invite link goes through join/blastz/');
        await ctx.close();
    }
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('\nall ' + checks + ' checks passed');
} catch (e) {
    console.error(e); if (errors.length) console.error('page errors:', errors.join('\n'));
    process.exitCode = 1;
} finally {
    if (browser) await browser.close();
    relay.kill(); server.close();
}
