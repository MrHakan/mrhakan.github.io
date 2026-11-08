// ===================================================================
// browser-troll-problem.mjs — play it, rather than open it
//
// A run is half an hour, so the game clock is turned up for the one that goes
// to the end; everything else is pressed the way a person presses it: a tower
// from the shop, a click on the road (refused) and one beside it, the two
// upgrade paths until one locks the other, selling. Then a phone with real
// taps, then two browsers straight across and four over the relays, with one
// of the four walking out and somebody new taking the seat.
//
// It runs on no outside server: its own static server, a peerjs stand-in whose
// hole punching is a setting (as in browser-age-of-troll.mjs), and
// server/nostr-test-relay.mjs for the public relays.
//
//   node .github/scripts/browser-troll-problem.mjs
// ===================================================================
import { chromium, devices } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.TP_SHOTS || path.join(ROOT, '.ci-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const RELAY_PORT = 8500 + Math.floor(Math.random() * 90);
const RELAY = 'ws://127.0.0.1:' + RELAY_PORT;

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

// ---------- a server that answers the way github pages does ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'text/xml', '.webmanifest': 'application/json', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, clean);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not here'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const relay = spawn(process.execPath, [path.join(ROOT, 'server/nostr-test-relay.mjs')], { env: { ...process.env, PORT: String(RELAY_PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));

// peerjs between tabs of one browser; `test-direct = noroute` makes every offer go unanswered
const FAKE_PEERJS = String.raw`
(function () {
    const wire = new BroadcastChannel('fake-peerjs');
    const emitter = o => {
        const on = {};
        o.on = (k, f) => { (on[k] = on[k] || []).push(f); return o; };
        o.emit = (k, v) => (on[k] || []).slice().forEach(f => f(v));
        return o;
    };
    const everyConn = window.__conns = [];
    function Peer(id) {
        const self = emitter(this), conns = new Map();
        self.id = id || 'guest-' + Math.random().toString(36).slice(2, 8);
        function conn(other) {
            const c = emitter({ peer: other });
            c.send = d => wire.postMessage({ k: 'data', from: self.id, to: other, d });
            c.close = () => {
                if (c.closed) return;
                c.closed = true;
                wire.postMessage({ k: 'close', from: self.id, to: other });
                c.emit('close');
            };
            conns.set(other, c);
            everyConn.push(c);
            return c;
        }
        wire.addEventListener('message', ev => {
            const m = ev.data;
            if (m.to !== self.id) return;
            if (m.k === 'offer') {
                wire.postMessage({ k: 'here', from: self.id, to: m.from });
                if (localStorage.getItem('test-direct') === 'noroute') return;
                const c = conn(m.from);
                self.emit('connection', c);
                setTimeout(() => { wire.postMessage({ k: 'answer', from: self.id, to: m.from }); c.emit('open'); }, 5);
            } else if (m.k === 'here') {
                const c = conns.get(m.from);
                if (c) c.found = true;
            } else if (m.k === 'answer') {
                const c = conns.get(m.from);
                if (c) c.emit('open');
            } else if (m.k === 'data') {
                const c = conns.get(m.from);
                if (c) c.emit('data', m.d);
            } else if (m.k === 'close') {
                const c = conns.get(m.from);
                if (c && !c.closed) { c.closed = true; c.emit('close'); }
            }
        });
        self.connect = target => {
            const c = conn(target);
            wire.postMessage({ k: 'offer', from: self.id, to: target });
            setTimeout(() => { if (!c.found) self.emit('error', { type: 'peer-unavailable' }); }, 250);
            return c;
        };
        self.reconnect = () => { };
        self.destroy = () => { conns.forEach(c => c.close()); };
        setTimeout(() => self.emit('open', self.id), 5);
    }
    window.Peer = Peer;
    window.__cutDirect = () => everyConn.forEach(c => c.close());
})();`;

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const errors = [];
async function context(opts, name, seed) {
    const ctx = await browser.newContext(opts);
    await ctx.route('**/*', route => {
        const u = route.request().url();
        if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        if (/peerjs/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_PEERJS });
        // komarev.com, waust.at, whos.amung.us and every other stranger's server
        return route.abort();
    });
    await ctx.addInitScript(([relays, who, seedStore]) => {
        try {
            sessionStorage.setItem('welcomed', '1');
            sessionStorage.setItem('booted', '1');
            localStorage.setItem('mrhakan98-netplay-relays', relays);
            localStorage.setItem('sound-enabled', 'false');
            if (who && !localStorage.getItem('mrhakan98-netplay-profile')) localStorage.setItem('mrhakan98-netplay-profile', JSON.stringify({ id: who + Math.random().toString(36).slice(2, 8), name: who, avatar: null }));
            if (seedStore && !sessionStorage.getItem('tp-seeded')) {
                sessionStorage.setItem('tp-seeded', '1');
                for (const k in seedStore) localStorage.setItem(k, seedStore[k]);
            }
        } catch (e) { }
    }, [RELAY, name || null, seed || null]);
    return ctx;
}
async function open(ctx, url, label) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push((label || 'page') + ': ' + e.message));
    await p.goto(url || BASE + '/index.html', { waitUntil: 'load' });
    return p;
}
const state = (p, fn, arg) => p.evaluate(`(${fn})(TP_ENGINE.state(), ${JSON.stringify(arg === undefined ? null : arg)})`);
const world = async (p, x, y) => {
    const b = await p.locator('#tg-canvas').boundingBox();
    return { x: b.x + x / 960 * b.width, y: b.y + y / 600 * b.height };
};
// a spot off the road that a tower fits, found the way the bots find one
const freeSpot = (p, id, avoid) => p.evaluate(([id, avoid]) => {
    const g = TP_ENGINE.state(), s = g.s;
    let best = null;
    for (let y = 60; y < 560; y += 20) for (let x = 60; x < 900; x += 20) {
        if (TP_SIM.placeProblem(s, x, y) || TP_SIM.roadDist(s.road, x, y) < TP.PATH_R + TP.TOWER_R + 6) continue;
        if (avoid && avoid.some(a => Math.hypot(a.x - x, a.y - y) < 60)) continue;
        const d = TP_SIM.roadDist(s.road, x, y);
        if (!best || d < best.d) best = { x, y, d };
    }
    return best;
}, [id, avoid || null]);

// TP_ONLY=solo|phone|duo|four runs one part, for working on it
const ONLY = process.env.TP_ONLY || '';
const part = n => !ONLY || ONLY.split(',').includes(n);
try {
    // ===================================================================
    if (part('solo')) section('the desktop, and an old save');
    // ===================================================================
    if (part('solo')) {
        // what the old grid game left behind: a tree of upgrades that no longer exists, and a run on a grid
        const old = {
            'trollproblem-meta-v2': JSON.stringify({ crystals: 7, spent: { dmg: 3, lives: 1 }, unlockedTowers: ['archer', 'cannon'], unlockedMaps: ['outskirts', 'bridge'], bestWave: { outskirts: 17 }, runs: 6, totalKills: 900, totalLeaks: 40, cleared: false }),
            'trollproblem-run-v2': JSON.stringify({ mapId: 'outskirts', wave: 9, gold: 300, lives: 12, towers: [{ id: 'archer', cx: 3, cy: 3, level: 1 }] })
        };
        const ctx = await context({ viewport: { width: 1280, height: 900 } }, null, old);
        const p = await open(ctx, null, 'desktop');
        expect(await p.evaluate(() => !window.TP && !window.TP_SIM && !window.Netplay), 'nothing of it is in the first load');
        expect(await p.evaluate(() => !document.getElementById('tg-css') && ![...document.styleSheets].some(s => /troll-problem/.test(s.href || ''))), 'nor its stylesheet');
        await p.evaluate(() => startMenuAction('trollproblem'));
        await p.waitForSelector('.tg-menu', { timeout: 20000 });
        expect(await p.evaluate(() => !!document.getElementById('tg-css')), 'it opens from the start menu and brings its own styles');
        const meta = await p.evaluate(() => JSON.parse(localStorage.getItem('trollproblem-meta-v2')));
        const back = (2 + 4 + 6) + 4;
        expect(meta.v === 3 && meta.crystals === 7 + back && meta.refunded === back && meta.bestWave.outskirts === 17 && meta.runs === 6, 'an old save is moved over: every crystal it spent comes back, the records stay', meta.crystals + ' crystals');
        expect(await p.evaluate(() => localStorage.getItem('trollproblem-run-v2') === null) && !(await p.locator('[data-act="resume"]').count()), 'and the old grid run is gone rather than half loaded');
        expect(/refunded/.test(await p.textContent('.tg-menu')), 'and it says so');
        const unlocked = await p.evaluate(() => TP_SIM.unlockedTowers(TP_ENGINE.meta()));
        expect(unlocked.join() === 'pointer,floppy,fan,cpu,modem,fax,catapult,spam', 'the towers come from how far you got before', unlocked.join(', '));
        await p.screenshot({ path: SHOTS + '/tp-menu.png' });
        // the rest of this browser plays with every tower
        await p.evaluate(() => { const m = JSON.parse(localStorage.getItem('trollproblem-meta-v2')); m.bestWave.outskirts = 29; m.unlockedMaps = ['outskirts', 'bridge', 'woods', 'gates', 'throne']; localStorage.setItem('trollproblem-meta-v2', JSON.stringify(m)); });

        // ===================================================================
        section('putting a tower down');
        // ===================================================================
        await p.click('.tg-menu [data-act="maps"]');
        await p.click('[data-map="outskirts"]');
        await p.waitForSelector('#tg-canvas');
        await p.waitForTimeout(300);
        await state(p, g => { g.s.seats[0].gold = 20000; });
        await p.click('.tg-card[data-tower="pointer"]');
        expect(await state(p, g => g.build) === 'pointer', 'a tower picked from the shop is in your hand');
        const road = await p.evaluate(() => { const r = TP_SIM.roadOf(TP.MAPS[0]).road; return r.pts[Math.floor(r.pts.length / 2)]; });
        const onRoad = await world(p, road.x, road.y);
        await p.mouse.move(onRoad.x, onRoad.y);
        await p.waitForTimeout(100);
        expect(await state(p, g => g.ghost && !g.ghost.ok && g.ghost.why) === 'road', 'over the road it shows red');
        await p.mouse.click(onRoad.x, onRoad.y);
        await p.waitForTimeout(150);
        expect(await state(p, g => g.s.towers.length) === 0, 'and a click there builds nothing', await state(p, g => g.msg));
        const spot = await freeSpot(p, 'pointer');
        const at = await world(p, spot.x, spot.y);
        await p.mouse.move(at.x, at.y);
        await p.waitForTimeout(100);
        expect(await state(p, g => g.ghost && g.ghost.ok), 'right beside it, white, with the range drawn');
        await p.screenshot({ path: SHOTS + '/tp-placing.png' });
        const gold0 = await state(p, g => g.s.seats[0].gold);
        await p.mouse.click(at.x, at.y);
        await p.waitForTimeout(150);
        const t1 = await state(p, g => g.s.towers.map(t => [t.def.id, Math.round(t.x), Math.round(t.y)]));
        expect(t1.length === 1 && Math.abs(t1[0][1] - spot.x) < 3 && Math.abs(t1[0][2] - spot.y) < 3, 'a click there builds it, where the click was', JSON.stringify(t1));
        expect(gold0 - await state(p, g => g.s.seats[0].gold) === 170, 'for what the shop said');
        await p.click('.tg-card[data-tower="fax"]');
        const atop = await world(p, spot.x + 6, spot.y);
        await p.mouse.move(atop.x, atop.y);
        await p.mouse.click(atop.x, atop.y);
        await p.waitForTimeout(150);
        expect(await state(p, g => g.s.towers.length) === 1 && await state(p, g => g.ghost && g.ghost.why) === 'tower', 'and nothing else goes on top of it');
        await p.keyboard.press('Escape');
        expect(await state(p, g => !g.build), 'escape puts it back');

        // ===================================================================
        section('two paths, one of them all the way');
        // ===================================================================
        await p.mouse.click(at.x, at.y - 8);
        await p.waitForTimeout(150);
        expect(await state(p, g => !!g.sel) && await p.locator('.tg-path').count() === 2, 'a click on a tower opens its two paths');
        const pathA = () => p.locator('.tg-path-a [data-up]'), pathB = () => p.locator('.tg-path-b [data-up]');
        await pathA().click(); await pathA().click();
        await pathB().click(); await pathB().click();
        expect(await state(p, g => { const t = g.s.towers[0]; return t.a + '-' + t.b; }) === '2-2', 'both paths up to two', await state(p, g => g.s.towers[0].a + '-' + g.s.towers[0].b));
        await pathA().click();
        await p.waitForTimeout(100);
        expect(await pathB().count() === 0 && /locked/.test(await p.textContent('.tg-path-b')), 'one past two, and the other path shows locked');
        await p.keyboard.press('.');
        expect(await state(p, g => g.s.towers[0].b) === 2, 'and stays locked from the keyboard too');
        const look0 = await p.evaluate(() => TP_SIM.lookOf(TP_ENGINE.state().s.towers[0]));
        await p.keyboard.press(',');
        await p.waitForTimeout(150);
        expect(look0 === 'base' && await p.evaluate(() => TP_SIM.lookOf(TP_ENGINE.state().s.towers[0])) === 'a', 'the fourth tier swaps the picture for the path\'s own');
        expect(/maxed/.test(await p.textContent('.tg-path-a')), 'and that path is done');
        await p.screenshot({ path: SHOTS + '/tp-upgrades.png' });
        await p.locator('.tg-mode [data-mode="1"]').click();
        expect(await state(p, g => g.s.towers[0].mode) === 'last', 'targeting goes first, last, strong, weak, close');

        // ===================================================================
        section('selling');
        // ===================================================================
        const spent = await state(p, g => g.s.towers[0].spent);
        const before = await state(p, g => g.s.seats[0].gold);
        await p.click('[data-act="sell"]');
        await p.waitForTimeout(150);
        expect(await state(p, g => g.s.towers.length) === 0 && await state(p, g => g.s.seats[0].gold) - before === Math.floor(spent * 0.7), 'the sell button gives back 70% and the spot is free again');

        // ===================================================================
        section('a whole map, with the clock turned up');
        // ===================================================================
        await p.click('[data-act="quit"]');
        await p.waitForSelector('.tg-menu');
        // half the crystal tree, as a player who has been at it a while
        await p.evaluate(() => { const m = JSON.parse(localStorage.getItem('trollproblem-meta-v2')); TP.META.forEach(n => { m.spent[n.id] = Math.ceil(n.max / 2); }); localStorage.setItem('trollproblem-meta-v2', JSON.stringify(m)); });
        await p.click('.tg-menu [data-act="maps"]');
        await p.click('[data-map="outskirts"]');
        await p.waitForSelector('#tg-canvas');
        const runs0 = await p.evaluate(() => TP_ENGINE.meta().runs);
        await p.evaluate(() => { TP_ENGINE.addBot(0, 'smart'); TP_ENGINE.clock(40); });
        await p.click('#tg-go');
        await p.waitForFunction(() => TP_ENGINE.state().s.wave >= 12, null, { timeout: 120000, polling: 250 });
        await p.screenshot({ path: SHOTS + '/tp-midgame.png' });
        expect(await p.evaluate(() => !!localStorage.getItem('trollproblem-run-v3')), 'the run is saved as it goes, wave by wave');
        await p.waitForFunction(() => TP_ENGINE.screen() === 'end', null, { timeout: 240000, polling: 500 });
        const end = await state(p, g => ({ phase: g.s.phase, wave: g.s.wave, kills: g.s.kills, lives: g.s.lives, crystals: g.crystals }));
        expect(end.phase === 'won', 'thirty waves and the troll king, to the end', JSON.stringify(end));
        expect(/the desktop held/.test(await p.textContent('.tg-end')) && end.crystals > 0, 'the end says so, and pays crystals', end.crystals + ' crystals');
        const after = await p.evaluate(() => TP_ENGINE.meta());
        expect(after.runs === runs0 + 1 && after.wins.outskirts && after.totalKills >= end.kills, 'and the records keep it');
        expect(await p.evaluate(() => !localStorage.getItem('trollproblem-run-v3')), 'with no run left to continue');
        await p.screenshot({ path: SHOTS + '/tp-won.png' });
        await p.evaluate(() => TP_ENGINE.clock(1));
        await ctx.close();
    }

    // ===================================================================
    if (part('phone')) section('a phone');
    // ===================================================================
    if (part('phone')) {
        const ctx = await context({ ...devices['Pixel 7'] });
        const p = await open(ctx, null, 'phone');
        await p.evaluate(() => { const m = { v: 3, crystals: 0, spent: {}, bestWave: { outskirts: 25 }, wins: {}, unlockedMaps: ['outskirts'], runs: 1, totalKills: 0, totalLeaks: 0 }; localStorage.setItem('trollproblem-meta-v2', JSON.stringify(m)); });
        await p.evaluate(() => startMenuAction('trollproblem'));
        await p.waitForSelector('.tg-menu', { timeout: 20000 });
        await p.locator('.tg-menu [data-act="maps"]').tap();
        await p.locator('[data-map="outskirts"]').tap();
        await p.waitForSelector('#tg-canvas');
        await p.waitForTimeout(400);
        const wide = await p.evaluate(() => ({ page: document.documentElement.scrollWidth, view: window.innerWidth, canvas: document.querySelector('#tg-canvas').getBoundingClientRect().width }));
        expect(wide.page <= wide.view + 1 && wide.canvas >= wide.view * 0.8, 'the map fills the width and nothing scrolls sideways', JSON.stringify(wide));
        await p.locator('.tg-card[data-tower="pointer"]').tap();
        const spot = await freeSpot(p, 'pointer');
        const at = await world(p, spot.x, spot.y);
        await p.touchscreen.tap(at.x, at.y);
        await p.waitForTimeout(250);
        expect(await state(p, g => g.s.towers.length) === 0 && await p.locator('.tg-aim [data-act="place"]').count() === 1, 'the first tap puts the tower down to look at, and spends nothing');
        const bb = await p.locator('.tg-aim [data-act="place"]').boundingBox();
        expect(bb && bb.height >= 40, 'the build button is a thumb\'s size', bb ? Math.round(bb.width) + 'x' + Math.round(bb.height) : 'none');
        await p.locator('.tg-aim [data-act="place"]').tap();
        await p.waitForTimeout(250);
        expect(await state(p, g => g.s.towers.length) === 1, 'and the build button builds it');
        const t = await state(p, g => [g.s.towers[0].x, g.s.towers[0].y]);
        const tt = await world(p, t[0], t[1] - 8);
        await p.touchscreen.tap(tt.x, tt.y);
        await p.waitForTimeout(250);
        await p.locator('.tg-path-a [data-up]').tap();
        expect(await state(p, g => g.s.towers[0].a) === 1, 'a tap on it, a tap on an upgrade');
        await p.screenshot({ path: SHOTS + '/tp-phone.png' });
        await ctx.close();
    }

    // ===================================================================
    // online
    // ===================================================================
    async function hostLobby(p, map) {
        await p.evaluate(() => openNetplay({ gameId: 'trollproblem' }));
        await p.waitForSelector('#np-host', { timeout: 15000 });
        await p.click('#np-host');
        await p.waitForSelector('.np-code', { timeout: 20000 });
        await p.waitForTimeout(800);
        if (map) {
            const ok = await p.waitForSelector('[data-opt="map"]', { timeout: 8000 }).then(() => true, () => false);
            if (!ok) await p.screenshot({ path: SHOTS + '/tp-lobby-fail.png' });
            await p.selectOption('[data-opt="map"]', map);
        }
        return (await p.textContent('.np-code')).trim();
    }
    async function joinLobby(p, code) {
        await p.evaluate(() => openNetplay({ gameId: 'trollproblem' }));
        await p.waitForSelector('#np-code', { timeout: 15000 });
        await p.fill('#np-code', code);
        await p.click('#np-join');
        await p.waitForSelector('.np-code', { timeout: 40000 });
    }
    async function startMatch(host, guests) {
        await host.waitForFunction(n => document.querySelectorAll('.np-player:not(.np-empty)').length === n, guests.length + 1, { timeout: 40000 });
        for (const gp of guests) { await gp.click('#np-ready'); await host.waitForTimeout(300); }
        await host.click('#np-ready');
        await host.waitForTimeout(400);
        await host.click('#np-start');
        await Promise.all([host, ...guests].map(p => p.waitForSelector('#tg-canvas', { timeout: 40000 })));
        await Promise.all([host, ...guests].map(p => p.waitForFunction(() => TP_ENGINE.state() && TP_ENGINE.state().s.seats.length > 1 && TP_ENGINE.state().seat >= 0, null, { timeout: 30000 })));
    }
    const kind = p => p.evaluate(() => TP_ENGINE.state().session.transport.kind);
    async function build(p, id, avoid) {
        const spot = await freeSpot(p, id, avoid);
        await p.click('.tg-card[data-tower="' + id + '"]');
        const at = await world(p, spot.x, spot.y);
        await p.mouse.move(at.x, at.y);
        await p.mouse.click(at.x, at.y);
        return spot;
    }

    if (part('duo')) {
        // ===================================================================
        section('two browsers, straight across');
        // ===================================================================
        const ctx = await context({ viewport: { width: 1280, height: 900 } });
        const host = await open(ctx, null, 'host');
        const code = await hostLobby(host, 'woods');
        const guest = await open(ctx, null, 'guest');
        await joinLobby(guest, code);
        await startMatch(host, [guest]);
        expect(await kind(host) === 'peer' && await kind(guest) === 'peer', 'it went direct', await kind(guest));
        const who = p => state(p, g => g.s.map.id + ' ' + g.s.seats.map(s => s.id).join(',') + ' me=' + g.seat);
        const [hw, gw] = [await who(host), await who(guest)];
        expect(hw.split(' me=')[0] === gw.split(' me=')[0] && /woods/.test(hw) && /me=0/.test(hw) && /me=1/.test(gw), 'both on the map the host picked, two seats, one each', hw + ' | ' + gw);
        const money = await state(guest, g => Math.floor(g.s.seats[1].gold));
        expect(money === await state(host, g => Math.floor(g.s.seats[1].gold)), 'each with their own money', money + ' each');
        // the guest builds with the mouse, and the host's game decides
        await state(host, g => { g.s.seats.forEach(p => { p.gold = 4000; }); });
        await guest.waitForFunction(() => TP_ENGINE.state().s.seats[1].gold >= 4000, null, { timeout: 5000 });
        const gs = await build(guest, 'pointer');
        await host.waitForFunction(() => TP_ENGINE.state().s.towers.length === 1, null, { timeout: 8000 });
        expect(await state(host, g => g.s.towers[0].owner) === 1, 'a guest\'s tower is built on the host, and is the guest\'s');
        await guest.waitForFunction(() => TP_ENGINE.state().s.towers.length === 1, null, { timeout: 8000 });
        expect(true, 'and the guest sees it come back');
        await build(host, 'fax', [gs]);
        await guest.waitForFunction(() => TP_ENGINE.state().s.towers.length === 2, null, { timeout: 8000 });
        // the host clicks the guest's tower: it can look and not touch
        const gt = await state(host, g => { const t = g.s.towers.find(x => x.owner === 1); return [t.x, t.y]; });
        const gat = await world(host, gt[0], gt[1] - 8);
        await host.keyboard.press('Escape');
        await host.mouse.click(gat.x, gat.y);
        await host.waitForTimeout(150);
        expect(/not yours/.test(await host.textContent('#tg-panel')) && await host.locator('.tg-path-a [data-up]').isDisabled(), 'the host can look at a guest\'s tower and cannot touch it');
        expect(await host.evaluate(() => TP_ENGINE.issue({ c: 'sell', i: TP_ENGINE.state().s.towers.find(x => x.owner === 1).id })) === 'mine', 'not even by asking the rules directly');
        // the guest upgrades its own, by clicking it
        const gat2 = await world(guest, gt[0], gt[1] - 8);
        await guest.mouse.click(gat2.x, gat2.y);
        await guest.locator('.tg-path-b [data-up]').click();
        await host.waitForFunction(() => TP_ENGINE.state().s.towers.find(x => x.owner === 1).b === 1, null, { timeout: 8000 });
        expect(true, 'the guest upgrades its own');
        // both say go, and the wave comes
        await guest.click('#tg-go');
        await host.waitForTimeout(400);
        expect(await state(host, g => g.s.phase) === 'prep' && await state(host, g => g.s.seats[1].ready), 'one player saying go waits for the other');
        await host.click('#tg-go');
        await host.waitForFunction(() => TP_ENGINE.state().s.phase === 'wave', null, { timeout: 5000 });
        await guest.waitForFunction(() => TP_ENGINE.state().s.enemies.length > 2, null, { timeout: 15000 });
        await host.waitForTimeout(1500);
        const ids = p => state(p, g => g.s.enemies.map(e => e.id).sort((a, b) => a - b).join());
        const [he, ge] = [await ids(host), await ids(guest)];
        const overlap = he.split(',').filter(x => ge.split(',').includes(x)).length / Math.max(1, he.split(',').length);
        expect(overlap >= 0.8, 'the guest sees the same trolls on the road', Math.round(overlap * 100) + '% of ' + he.split(',').length);
        const pos = await state(host, g => g.s.enemies.slice(0, 5).map(e => [e.id, Math.round(e.x), Math.round(e.y)]));
        const gpos = await state(guest, g => g.s.enemies.map(e => [e.id, Math.round(e.x), Math.round(e.y)]));
        const off = pos.map(([id, x, y]) => { const o = gpos.find(q => q[0] === id); return o ? Math.hypot(o[1] - x, o[2] - y) : 0; });
        expect(Math.max(...off) < 40, 'in about the same places', Math.round(Math.max(...off)) + ' units at worst');
        await host.screenshot({ path: SHOTS + '/tp-duo-host.png' });
        await guest.screenshot({ path: SHOTS + '/tp-duo-guest.png' });

        // ---- the guest's line going quiet, and coming back ----
        await host.evaluate(() => { const s = TP_ENGINE.state().session; s.__send = s.send; s.send = () => { }; });
        await guest.waitForTimeout(150);
        await guest.evaluate(() => TP_ENGINE.state().session.emit('net:down', 'quiet'));
        await guest.waitForTimeout(200);
        expect(await state(guest, g => g.netDown) && /lost the host/.test(await guest.textContent('#tg-overlay')), 'a guest whose line goes quiet freezes, and says why');
        await host.evaluate(() => { const s = TP_ENGINE.state().session; s.send = s.__send; });
        await guest.waitForFunction(() => !TP_ENGINE.state().netDown, null, { timeout: 5000 });
        expect(true, 'and carries on when the host is heard again');
        // ---- a direct link dying: both move to the relays and the game goes on ----
        const tick0 = await state(host, g => g.s.tick);
        await guest.evaluate(() => window.__cutDirect());
        await guest.waitForFunction(() => TP_ENGINE.state().session.transport.kind === 'bus', null, { timeout: 15000 }).catch(() => { });
        await host.waitForFunction(() => TP_ENGINE.state().session.transport.kind === 'bus', null, { timeout: 15000 }).catch(() => { });
        expect(await kind(guest) === 'bus' && await kind(host) === 'bus', 'a direct link dying moves both to the relays');
        await host.waitForTimeout(2500);
        const age = await guest.evaluate(() => performance.now() - TP_ENGINE.state().lastSnap);
        expect(await state(host, g => g.s.tick) > tick0 + 40 && age < 2000, 'and the game never stopped', Math.round(age) + 'ms since the guest last heard');
        // ---- the guest walks out: its towers stay ----
        await guest.close();
        await host.waitForFunction(() => !TP_ENGINE.state().s.seats[1].on, null, { timeout: 25000 });
        const left = await state(host, g => g.s.towers.filter(t => t.owner === 1).length);
        expect(left === 1, 'a guest who leaves leaves its towers on the road');
        await host.close();
        await ctx.close();
    }

    if (part('four')) {
        // ===================================================================
        section('four browsers over the relays');
        // ===================================================================
        // four separate browsers, as four strangers would be, with no direct route between any of them
        const ctxs = [], pages = [];
        for (const name of ['ana', 'bob', 'cem', 'dee']) {
            const ctx = await context({ viewport: { width: 1180, height: 860 } }, name);
            await ctx.addInitScript(() => { try { localStorage.setItem('test-direct', 'noroute'); } catch (e) { } });
            ctxs.push(ctx);
            pages.push(await open(ctx, null, name));
        }
        const [host, ...guests] = pages;
        const code = await hostLobby(host, 'outskirts');
        for (const gp of guests) await joinLobby(gp, code);
        await startMatch(host, guests);
        expect((await Promise.all(pages.map(kind))).every(k => k === 'bus'), 'all four over the relays');
        const seats = await Promise.all(pages.map(p => state(p, g => g.seat)));
        expect(seats.join() === '0,1,2,3', 'four seats, one each', seats.join());
        expect(await state(host, g => g.s.seats.every(p => Math.floor(p.gold) === TP.coopStart(4))), 'each with a quarter of the start, and a bit');
        // everybody builds something
        await state(host, g => { g.s.seats.forEach(p => { p.gold = 3000; }); });
        const spots = [];
        for (const p of pages) { await p.waitForFunction(() => TP_ENGINE.state().s.seats[TP_ENGINE.state().seat].gold >= 3000, null, { timeout: 10000 }); spots.push(await build(p, 'pointer', spots)); await p.waitForTimeout(600); }
        await host.waitForFunction(() => TP_ENGINE.state().s.towers.length >= 4, null, { timeout: 20000 });
        const owners = await state(host, g => g.s.towers.map(t => t.owner).sort().join());
        expect(owners === '0,1,2,3', 'and every tower is its builder\'s', owners);
        // a road full of trolls, with bots keeping the four seats busy on the host, and the clock up
        // a road full of trolls: a late wave, and lives enough to watch it go by
        // (the four pointer posts hold their fire for this, or there would be no crowd to measure)
        await host.evaluate(() => { const g = TP_ENGINE.state(); g.s.wave = 26; g.s.lives = 10000; g.s.towers.forEach(t => { t.cd = 1e9; }); });
        for (const p of pages) await p.click('#tg-go').catch(() => { });
        await host.waitForFunction(() => TP_ENGINE.state().s.phase === 'wave' && TP_ENGINE.state().s.enemies.length > 40, null, { timeout: 30000, polling: 200 });
        const meter = async p => {
            const b = { sent: 0, got: 0, on: false, frames: 0 };
            const cdp = await p.context().newCDPSession(p);
            await cdp.send('Network.enable');
            cdp.on('Network.webSocketFrameSent', e => { if (b.on) { b.sent += e.response.payloadData.length; b.frames++; } });
            cdp.on('Network.webSocketFrameReceived', e => { if (b.on) b.got += e.response.payloadData.length; });
            return b;
        };
        const meters = await Promise.all(pages.map(meter));
        // and a steady stream of them while the bytes are counted
        await host.evaluate(() => { const s = TP_ENGINE.state().s; for (let i = 0; i < 120; i++) s.queue.push({ at: s.waveT + 0.5 + i * 0.15, id: 'grunt' }); s.queue.sort((a, b) => a.at - b.at); s.qi = 0; while (s.qi < s.queue.length && s.queue[s.qi].at < s.waveT) s.qi++; });
        const seconds = 12;
        meters.forEach(m => { m.on = true; });
        let crowd = 0;
        for (let i = 0; i < seconds * 2; i++) { await host.waitForTimeout(500); crowd = Math.max(crowd, await state(host, g => g.s.enemies.length)); }
        meters.forEach(m => { m.on = false; });
        const perMin = n => n * 60 / seconds / 1048576;
        const [hm, ...gm] = meters;
        console.log('        up to ' + crowd + ' trolls on the road: host up ' + perMin(hm.sent).toFixed(2) + 'MB a minute in ' + hm.frames + ' frames, guests up ' + gm.map(m => perMin(m.sent).toFixed(2)).join('/') + ', down ' + gm.map(m => perMin(m.got).toFixed(2)).join('/'));
        expect(crowd >= 40, 'with a crowd on the road', crowd + ' trolls');
        expect(perMin(hm.sent) <= 1.5, 'the host sends one copy to the relays for all three, and it is small', perMin(hm.sent).toFixed(2) + 'MB a minute');
        expect(gm.every(m => perMin(m.sent) <= 0.3), 'a guest sends next to nothing', gm.map(m => perMin(m.sent).toFixed(2)).join(', '));
        expect(hm.frames / seconds <= 8 && gm.every(m => m.frames / seconds <= 4), 'and nobody is rude to the relay', (hm.frames / seconds).toFixed(1) + ' frames a second from the host');
        const ages = await Promise.all(guests.map(p => p.evaluate(() => performance.now() - TP_ENGINE.state().lastSnap)));
        expect(ages.every(a => a < 2500), 'every guest is still hearing about it', ages.map(Math.round).join(', ') + 'ms');
        const counts = await Promise.all(pages.map(p => state(p, g => g.s.enemies.length)));
        expect(counts.every(c => Math.abs(c - counts[0]) <= 8), 'and every screen has about the same road', counts.join(', '));
        await host.screenshot({ path: SHOTS + '/tp-four-host.png' });
        await guests[2].screenshot({ path: SHOTS + '/tp-four-guest.png' });

        // ===================================================================
        section('one of four walks out, and somebody takes the seat');
        // ===================================================================
        await pages[3].close();
        await host.waitForFunction(() => !TP_ENGINE.state().s.seats[3].on, null, { timeout: 25000 });
        const tick0 = await state(host, g => g.s.tick);
        await host.waitForTimeout(1000);
        expect(await state(host, g => g.s.towers.some(t => t.owner === 3)) && await state(host, g => g.s.tick) > tick0 + 10, 'the game goes on, and the tower of the one who left is still there');
        await guests[0].waitForFunction(() => !TP_ENGINE.state().s.seats[3].on, null, { timeout: 15000 });
        expect(/left/.test(await guests[0].getAttribute('.tg-chip:nth-child(4)', 'title') || ''), 'the others see the seat empty');
        const g1 = await state(host, g => g.s.seats[1].gold);
        await host.evaluate(() => TP_SIM.pay(TP_ENGINE.state().s, 300));
        expect(Math.abs(await state(host, g => g.s.seats[1].gold) - g1 - 300 * await host.evaluate(() => TP.coopIncome(4)) / 3) < 1, 'and the money is split three ways now');
        const ctxE = await context({ viewport: { width: 1180, height: 860 } }, 'eve');
        await ctxE.addInitScript(() => { try { localStorage.setItem('test-direct', 'noroute'); } catch (e) { } });
        const eve = await open(ctxE, null, 'eve');
        await joinLobby(eve, code);
        const handed = await eve.waitForSelector('#tg-canvas', { timeout: 40000 }).then(() => true, () => false);
        if (!handed) {
            console.log('        host sees: ' + JSON.stringify(await host.evaluate(() => TP_ENGINE.state().session.players.map(p => p.name + ':' + p.id))));
            console.log('        eve: ' + JSON.stringify(await eve.evaluate(() => { const s = Netplay.current; return s && { state: s.state, game: s.gameId, players: s.players.map(p => p.name), seated: s.seated, kind: s.transport && s.transport.kind }; })));
            console.log('        errors: ' + errors.join(' | '));
            throw new Error('the newcomer was never handed the game');
        }
        await eve.waitForFunction(() => TP_ENGINE.state().seat === 3, null, { timeout: 30000 });
        expect(true, 'a newcomer with the code is handed the game, in the empty seat');
        await host.waitForFunction(() => TP_ENGINE.state().s.seats[3].on && TP_ENGINE.state().s.seats[3].name === 'eve', null, { timeout: 15000 });
        const theirs = await state(host, g => g.s.towers.find(t => t.owner === 3).id);
        await eve.waitForFunction(id => TP_ENGINE.state().s.towers.some(t => t.id === id), theirs, { timeout: 15000 });
        await eve.evaluate(id => TP_ENGINE.issue({ c: 'up', i: id, p: 0 }), theirs);
        await host.waitForFunction(id => TP_ENGINE.state().s.towers.find(t => t.id === id).a === 1, theirs, { timeout: 15000 });
        expect(true, 'and the towers that came with the seat are hers to upgrade');
        await eve.screenshot({ path: SHOTS + '/tp-late-join.png' });
        for (const p of [...pages.slice(0, 3), eve]) await p.close().catch(() => { });
        for (const c of [...ctxs, ctxE]) await c.close().catch(() => { });
    }

    section('page errors');
    expect(errors.length === 0, 'no page errors anywhere', errors.slice(0, 6).join(' | '));
} catch (e) {
    failures++;
    console.log('  FAIL  the test itself fell over: ' + (e && e.stack || e));
}
await browser.close();
relay.kill();
server.close();
console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
