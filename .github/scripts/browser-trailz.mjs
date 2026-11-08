// ===================================================================
// browser-trailz.mjs — trailz 98 ridden, not just opened
//
//   solo     the desktop loads none of it until asked; the start menu and
//            the address bar open it; a match against a bot from the menu's
//            own buttons, real keys turning and braking the cycle, a crash
//            into the border, and the clock turned up to the end of the
//            match; the picture checked for being a perspective floor under
//            a dark sky, from every camera, and the frame rate written down
//   phone    real taps: either half of the picture turns, the brake button
//            brakes, and a phone on its side goes fullscreen
//   duo      two browsers straight across: the same match on both screens, a
//            guest's turn going where it was pressed even with a quarter of a
//            second of lag on the line, the line going quiet and coming back,
//            the direct link dying, and the guest walking out (a bot rides on)
//   relays   three browsers over the relays only, the bytes counted, a guest
//            leaving and somebody new with the code taking the seat
//   lobby    a public lobby shows up on a stranger's open list
//
// It runs on no outside server: its own static server, a peerjs stand-in
// (the one browser-troll-problem.mjs uses) and server/nostr-test-relay.mjs.
//
//   node .github/scripts/browser-trailz.mjs
//   TZ_ONLY=solo,phone node .github/scripts/browser-trailz.mjs     one part at a time
// ===================================================================
import { chromium, devices } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.TZ_SHOTS || path.join(ROOT, '.ci-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const RELAY_PORT = 8600 + Math.floor(Math.random() * 90);
const RELAY = 'ws://127.0.0.1:' + RELAY_PORT;

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
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
async function context(opts, name, extra) {
    const ctx = await browser.newContext(opts);
    await ctx.route('**/*', route => {
        const u = route.request().url();
        if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        if (/peerjs/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_PEERJS });
        // komarev.com, waust.at, whos.amung.us and every other stranger's server
        return route.abort();
    });
    await ctx.addInitScript(([relays, who, more]) => {
        try {
            sessionStorage.setItem('welcomed', '1');
            sessionStorage.setItem('booted', '1');
            localStorage.setItem('mrhakan98-netplay-relays', relays);
            localStorage.setItem('sound-enabled', 'false');
            if (who && !localStorage.getItem('mrhakan98-netplay-profile')) localStorage.setItem('mrhakan98-netplay-profile', JSON.stringify({ id: who + Math.random().toString(36).slice(2, 8), name: who, avatar: null }));
            if (more) for (const k in more) localStorage.setItem(k, more[k]);
        } catch (e) { }
    }, [RELAY, name || null, extra || null]);
    return ctx;
}
async function open(ctx, url, label) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push((label || 'page') + ': ' + e.message));
    await p.goto(url || BASE + '/index.html', { waitUntil: 'load' });
    return p;
}
const state = (p, fn, arg) => p.evaluate(`(${fn})(TZ_ENGINE.state(), ${JSON.stringify(arg === undefined ? null : arg)})`);
const race = p => p.waitForFunction(() => TZ_ENGINE.state() && TZ_ENGINE.state().s.phase === 'race', null, { timeout: 15000 });
// the way the rules look at it: how far until a wall, each way
const rays = (p, i) => p.evaluate(i => { const g = TZ_ENGINE.state(), c = g.s.cycles[i]; return [0, -1, 1].map(d => TZ_SIM.rayDist(g.s, i, (c.dir + d + 4) & 3, 999)); }, i);

const ONLY = process.env.TZ_ONLY || '';
const part = n => !ONLY || ONLY.split(',').includes(n);
try {
    // ===================================================================
    if (part('solo')) {
        section('the desktop, the start menu and the address bar');
        // ===================================================================
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        const p = await open(ctx, null, 'desktop');
        expect(await p.evaluate(() => !window.TZ && !window.TZ_SIM && !window.TZ_GL && !window.Netplay), 'none of it is in the first load');
        expect(await p.evaluate(() => !document.getElementById('tz-css') && ![...document.styleSheets].some(s => /trailz/.test(s.href || ''))), 'nor its stylesheet');
        const item = p.locator('.start-item', { hasText: 'trailz 98' });
        expect(await item.count() === 1, 'it has a place in the start menu');
        await p.evaluate(() => startMenuAction('trailz'));
        await p.waitForSelector('.tz-menu', { timeout: 20000 });
        expect(await p.evaluate(() => !!document.getElementById('tz-css') && !!window.TZ_SIM), 'and opens from it, bringing its own styles');
        await p.waitForTimeout(1500);
        await p.screenshot({ path: SHOTS + '/tz-menu.png' });
        const viaUrl = await open(ctx, BASE + '/?app=trailz', 'address bar');
        const fromUrl = await viaUrl.waitForSelector('.tz-menu', { timeout: 20000 }).then(() => true, () => false);
        expect(fromUrl, 'it opens from the address bar, ?app=trailz');
        await viaUrl.close();

        // ===================================================================
        section('a match against a bot, from the menu');
        // ===================================================================
        await p.selectOption('.tz-menu [data-k="bots"]', '1');
        await p.selectOption('.tz-menu [data-k="level"]', 'easy');
        await p.selectOption('.tz-menu [data-k="rounds"]', '3');
        await p.click('.tz-menu [data-act="solo"]');
        await p.waitForFunction(() => TZ_ENGINE.screen() === 'play' && TZ_ENGINE.state());
        const setup = await state(p, g => [g.s.n, g.s.rounds, g.s.seats[1].bot, g.s.phase].join());
        expect(setup === '2,3,easy,count', 'the menu\'s choices are the match: one easy bot, three rounds, and a countdown first', setup);
        expect(/^3$/.test((await p.textContent('.tz-count').catch(() => '')).trim()), 'the countdown is on the screen');
        await race(p);
        const d0 = await state(p, g => g.s.cycles[0].dir);
        await p.keyboard.press('ArrowRight');
        await p.waitForFunction(d => TZ_ENGINE.state().s.cycles[0].dir === ((d + 1) & 3), d0, { timeout: 2000 });
        expect(true, 'the right arrow turns the cycle right');
        await p.waitForTimeout(200);
        await p.keyboard.press('a');
        await p.waitForFunction(d => TZ_ENGINE.state().s.cycles[0].dir === d, d0, { timeout: 2000 });
        const turns = await state(p, g => TZ_SIM.turnsOf(g.s.cycles[0]));
        expect(turns === 2, 'and a turns it back left: two corners in its wall', turns + ' turns');
        await p.keyboard.down('ArrowDown');
        await p.waitForTimeout(700);
        const braking = await state(p, g => [g.s.cycles[0].speed, g.s.cycles[0].fuel]);
        await p.keyboard.up('ArrowDown');
        expect(braking[0] < 12 && braking[1] < 0.9, 'holding the down arrow brakes', braking[0].toFixed(1) + ' units a second, ' + Math.round(braking[1] * 100) + '% brake left');
        await p.waitForTimeout(900);
        expect(await state(p, g => g.s.cycles[0].speed) >= 17.9, 'and letting go gets the speed back');
        await p.screenshot({ path: SHOTS + '/tz-solo-chase.png' });

        // ---- the picture ----
        const look = async () => {
            await p.waitForTimeout(250);
            return p.evaluate(() => TZ_ENGINE.sample());
        };
        const chase = await look();
        const sky = chase.bands.slice(0, 2), floor = chase.bands.slice(5);
        const skyMean = sky.reduce((a, b) => a + b.mean, 0) / 2, floorLit = floor.reduce((a, b) => a + b.lit, 0) / 3;
        const nearLit = chase.bands[7].lit, farLit = chase.bands[4].lit;
        expect(chase.w >= 800, 'the picture is drawn at the screen\'s own pixels', chase.w + ' x ' + chase.h);
        expect(skyMean < 30 && floorLit > 0.005, 'from behind the cycle: a dark sky over a lit grid floor', 'sky ' + skyMean.toFixed(1) + ', floor lit ' + (floorLit * 100).toFixed(1) + '%');
        expect(farLit > nearLit * 0.9, 'and the grid gets denser towards the horizon, as a floor in perspective does', 'lit near ' + (nearLit * 100).toFixed(1) + '%, towards the horizon ' + (farLit * 100).toFixed(1) + '%');
        await p.evaluate(() => TZ_ENGINE.cam('high'));
        await p.waitForTimeout(1200);
        const high = await look();
        await p.screenshot({ path: SHOTS + '/tz-solo-panorama.png' });
        expect(high.bands[0].mean < 30 && high.bands.slice(3).some(b => b.lit > 0.004), 'the panorama: higher up, more floor, the same sky');
        await p.evaluate(() => TZ_ENGINE.cam('arena'));
        const arena = await look();
        await p.screenshot({ path: SHOTS + '/tz-solo-arena.png' });
        expect(arena.bands.slice(1, 7).every(b => b.lit > 0.002), 'the whole arena from above and behind: floor in every band', arena.bands.map(b => (b.lit * 100).toFixed(1)).join(' '));
        await p.keyboard.press('c');
        expect(await state(p, g => g.cam.mode) === 'chase', 'c goes round the cameras');
        // the frame rate, and the sim keeping time whatever it is
        const t0 = await state(p, g => [g.s.tick, performance.now()]);
        await p.waitForTimeout(2000);
        const t1 = await state(p, g => [g.s.tick, performance.now(), g.fps, g.s.phase]);
        const rate = (t1[0] - t0[0]) / ((t1[1] - t0[1]) / 1000);
        console.log('        ' + t1[2].toFixed(1) + ' frames a second here, at ' + chase.w + ' x ' + chase.h);
        expect(t1[2] > 8, 'it draws at a usable rate even here, on a machine with no graphics card', t1[2].toFixed(1) + ' fps');
        expect(t1[3] !== 'race' || (rate > 50 && rate < 190), 'and the rules keep their 60 steps a second (three times that with only bots left)', rate.toFixed(0) + ' steps a second');

        // ---- a crash: steer at the nearest wall and keep going ----
        await p.waitForFunction(() => { const g = TZ_ENGINE.state(); return g.s.phase === 'race' && g.s.cycles[0].alive; }, null, { timeout: 20000 }).catch(() => { });
        if (await state(p, g => g.s.phase === 'race' && g.s.cycles[0].alive)) {
            const r = await rays(p, 0);
            // the shortest of the three ways is where the crash is
            const k = r.indexOf(Math.min(...r));
            if (k) await p.keyboard.press(k === 1 ? 'ArrowLeft' : 'ArrowRight');
            await p.waitForFunction(() => !TZ_ENGINE.state().s.cycles[0].alive, null, { timeout: 20000 });
            const cause = await state(p, g => g.s.cycles[0].cause);
            const feed = await p.textContent('.tz-feed');
            expect(!!cause && /you (hit|ran into)/.test(feed), 'driving into a wall is the end of the round for you, and it says whose', feed.trim().split('\n')[0]);
            const big = (await p.textContent('.tz-big').catch(() => '')).trim();
            // in a duel the round is over the moment you are, and that is what the screen says
            expect(/^out|takes round|nobody takes/.test(big), 'with it across the screen', big);
        }
        // ---- to the end, with the clock up ----
        await p.evaluate(() => TZ_ENGINE.clock(10));
        await p.waitForSelector('.tz-panel', { timeout: 90000 });
        const fin = await state(p, g => [g.s.phase, g.s.round, g.s.scores.join('-'), g.over].join());
        expect(/^over,3,/.test(fin), 'three rounds later the match is over', fin);
        const panel = await p.textContent('.tz-panel');
        expect(/wins the match|you win the match|a draw/.test(panel) && /pts/.test(panel), 'and the standings say who won', panel.replace(/\s+/g, ' ').slice(0, 80));
        const meta = await p.evaluate(() => TZ_ENGINE.meta());
        expect(meta.matches === 1 && meta.rounds === 3, 'the match is in the records', JSON.stringify(meta));
        await p.screenshot({ path: SHOTS + '/tz-solo-over.png' });
        await p.click('.tz-panel [data-act="again"]');
        await p.evaluate(() => TZ_ENGINE.clock(1));
        expect(await state(p, g => g.s.round === 1 && !g.over && g.s.n === 2), 'again starts a new one');
        await p.click('.tz-hud', { force: true }).catch(() => { });
        await ctx.close();
    }

    // ===================================================================
    if (part('phone')) {
        section('a phone');
        // ===================================================================
        const ctx = await context(Object.assign({}, devices['Pixel 7']));
        const p = await open(ctx, BASE + '/?app=trailz', 'phone');
        await p.waitForSelector('.tz-menu', { timeout: 20000 });
        expect(await p.evaluate(() => /tap the left or right half/.test(document.querySelector('.tz-keys').textContent)), 'the menu explains the thumbs, not the keys');
        await p.locator('.tz-menu [data-act="solo"]').tap();
        await p.waitForFunction(() => TZ_ENGINE.screen() === 'play');
        expect(await p.isVisible('.tz-thumb-l') && await p.isVisible('#tz-brake'), 'the thumbs are out: two halves and a brake');
        await race(p);
        const box = await p.locator('#tz-stage').boundingBox();
        const d0 = await state(p, g => g.s.cycles[0].dir);
        await p.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height * 0.7);
        await p.waitForFunction(d => TZ_ENGINE.state().s.cycles[0].dir === ((d + 3) & 3), d0, { timeout: 2000 });
        expect(true, 'a tap on the left half turns left');
        await p.waitForTimeout(250);
        await p.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height * 0.7);
        await p.waitForFunction(d => TZ_ENGINE.state().s.cycles[0].dir === d, d0, { timeout: 2000 });
        expect(true, 'and on the right half turns right');
        await p.locator('#tz-brake').dispatchEvent('pointerdown');
        await p.waitForTimeout(600);
        const slow = await state(p, g => g.s.cycles[0].alive ? g.s.cycles[0].speed : 0);
        await p.locator('#tz-brake').dispatchEvent('pointerup');
        expect(slow < 14, 'holding the brake button brakes', slow.toFixed(1));
        await p.screenshot({ path: SHOTS + '/tz-phone.png' });
        // on its side, the game takes the whole screen
        await p.setViewportSize({ width: 915, height: 412 });
        await p.waitForTimeout(700);
        expect(await p.evaluate(() => document.querySelector('.app-window.fs-active .tz-body') !== null), 'a phone on its side plays fullscreen');
        await p.screenshot({ path: SHOTS + '/tz-phone-sideways.png' });
        await ctx.close();
    }

    // ===================================================================
    // online
    // ===================================================================
    async function hostLobby(p, opts) {
        await p.evaluate(() => openNetplay({ gameId: 'trailz' }));
        await p.waitForSelector('#np-host', { timeout: 15000 });
        if (opts && opts.public) await p.check('#np-public');
        await p.click('#np-host');
        await p.waitForSelector('.np-code', { timeout: 20000 });
        await p.waitForTimeout(600);
        for (const [k, v] of Object.entries((opts && opts.set) || {})) {
            await p.waitForSelector('[data-opt="' + k + '"]', { timeout: 8000 });
            await p.selectOption('[data-opt="' + k + '"]', v);
        }
        return (await p.textContent('.np-code')).trim();
    }
    async function joinLobby(p, code) {
        await p.evaluate(() => openNetplay({ gameId: 'trailz' }));
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
        await Promise.all([host, ...guests].map(p => p.waitForSelector('#tz-canvas', { timeout: 40000 })));
        await Promise.all([host, ...guests].map(p => p.waitForFunction(() => TZ_ENGINE.state() && TZ_ENGINE.state().me >= 0 && TZ_ENGINE.screen() === 'play', null, { timeout: 30000 })));
    }
    const kind = p => p.evaluate(() => TZ_ENGINE.state().session.transport.kind);

    if (part('duo')) {
        section('two browsers, straight across');
        const ctx = await context({ viewport: { width: 1200, height: 820 } });
        const host = await open(ctx, null, 'host');
        const code = await hostLobby(host, { set: { cycles: '4', bots: 'easy', rounds: '9' } });
        const guest = await open(ctx, null, 'guest');
        await joinLobby(guest, code);
        await startMatch(host, [guest]);
        expect(await kind(host) === 'peer' && await kind(guest) === 'peer', 'it went direct');
        const seats = p => state(p, g => g.s.seats.map(x => (x.bot ? 'bot:' : '') + x.name).join(',') + ' me=' + g.me + ' S=' + g.s.S);
        const [hs, gs] = [await seats(host), await seats(guest)];
        expect(hs.split(' me=')[0] === gs.split(' me=')[0] && / me=0 /.test(hs) && / me=1 /.test(gs) && (hs.match(/bot:/g) || []).length === 2,
            'one match on both screens: two people, two bots to make four, a seat each', hs + ' | ' + gs);
        await race(host); await race(guest);
        await guest.waitForTimeout(400);
        // a bot seen from both sides
        const where = p => state(p, g => { const v = g.view[2]; return [v.x, v.z, g.s.cycles[2].dir]; });
        const [hb, gb] = [await where(host), await where(guest)];
        expect(Math.abs(hb[0] - gb[0]) + Math.abs(hb[1] - gb[1]) < 4 && hb[2] === gb[2], 'a bot is in the same place on both screens', (Math.abs(hb[0] - gb[0]) + Math.abs(hb[1] - gb[1])).toFixed(2) + ' units apart');
        // the guest turns: at once on its own screen, and at that same spot on the host
        const before = await state(guest, g => [g.pred.dir, g.pred.x, g.pred.z]);
        await guest.keyboard.press('ArrowLeft');
        const mine = await state(guest, g => [g.pred.dir, g.pred.pts.slice(-2)]);
        expect(mine[0] === ((before[0] + 3) & 3), 'a guest\'s turn shows on its own screen the moment the key goes down');
        await host.waitForFunction(d => TZ_ENGINE.state().s.cycles[1].dir === d, mine[0], { timeout: 3000 });
        const hostPt = await state(host, g => g.s.cycles[1].pts.slice(-2));
        const off = Math.abs(hostPt[0] - mine[1][0]) + Math.abs(hostPt[1] - mine[1][1]);
        expect(off < 0.05, 'and the host puts the corner where the guest pressed', off.toFixed(3) + ' units off');
        // now with a quarter of a second on the line, both ways
        await guest.evaluate(() => { const s = TZ_ENGINE.state().session; s.__send = s.send; s.send = function (...a) { setTimeout(() => s.__send.apply(s, a), 250); }; });
        await host.evaluate(() => { const s = TZ_ENGINE.state().session; s.__send = s.send; s.send = function (...a) { setTimeout(() => s.__send.apply(s, a), 250); }; });
        // long enough for the guest's pings to measure the new lag (it leads its own cycle by half
        // of it), with a bot keeping the guest's cycle alive meanwhile
        await host.evaluate(() => TZ_ENGINE.drive(1, 'hard'));
        await guest.waitForTimeout(4500);
        await host.evaluate(() => TZ_ENGINE.drive(1, null));
        await guest.waitForTimeout(700);
        const lagMs = await state(guest, g => Math.round(g.rtt || 0));
        console.log('        the guest now measures ' + lagMs + 'ms there and back');
        const alive = await state(host, g => g.s.cycles[1].alive && g.s.phase === 'race');
        if (alive) {
            const r = await rays(guest, 1);
            const way = r[1] > r[2] ? 'ArrowLeft' : 'ArrowRight';
            const at = await state(guest, g => { return { dir: g.pred.dir, n: g.pred.pts.length }; });
            await guest.keyboard.press(way);
            const pressed = await state(guest, g => g.pred.pts.slice(-2));
            await host.waitForFunction(n => TZ_SIM.turnsOf(TZ_ENGINE.state().s.cycles[1]) * 2 + 2 >= n + 2 || !TZ_ENGINE.state().s.cycles[1].alive, at.n, { timeout: 4000 }).catch(() => { });
            const res = await state(host, g => [g.s.cycles[1].pts.slice(-2), g.lastRetro, g.s.cycles[1].alive]);
            const lag = Math.abs(res[0][0] - pressed[0]) + Math.abs(res[0][1] - pressed[1]);
            expect(res[2] === false || (lag < 0.05 && (res[1] === 'rewound' || res[1] === 'ahead')), 'with 250ms of lag each way, the turn still lands where it was pressed: the host moves the cycle back to it', res[1] + ', ' + lag.toFixed(3) + ' units off');
        } else expect(true, 'the guest\'s cycle was out before the lag test; skipped it');
        await guest.evaluate(() => { const s = TZ_ENGINE.state().session; s.send = s.__send; });
        await host.evaluate(() => { const s = TZ_ENGINE.state().session; s.send = s.__send; });
        await host.screenshot({ path: SHOTS + '/tz-duo-host.png' });
        await guest.screenshot({ path: SHOTS + '/tz-duo-guest.png' });

        // ---- the guest's line going quiet, and coming back ----
        await host.evaluate(() => { TZ_ENGINE.drive(0, 'hard'); TZ_ENGINE.drive(1, 'hard'); });
        await host.evaluate(() => { const s = TZ_ENGINE.state().session; s.__send = s.send; s.send = () => { }; });
        await guest.waitForTimeout(150);
        await guest.evaluate(() => TZ_ENGINE.state().session.emit('net:down', 'quiet'));
        await guest.waitForTimeout(300);
        expect(await state(guest, g => g.netDown) && /lost the host/.test(await guest.textContent('#tz-hud')), 'a guest whose line goes quiet stops, and says why');
        await host.evaluate(() => { const s = TZ_ENGINE.state().session; s.send = s.__send; });
        await guest.waitForFunction(() => !TZ_ENGINE.state().netDown, null, { timeout: 5000 });
        expect(true, 'and carries on when the host is heard again');
        // ---- a direct link dying: both move to the relays and the match goes on ----
        const tick0 = await state(host, g => g.s.tick);
        await guest.evaluate(() => window.__cutDirect());
        await guest.waitForFunction(() => TZ_ENGINE.state().session.transport.kind === 'bus', null, { timeout: 15000 }).catch(() => { });
        await host.waitForFunction(() => TZ_ENGINE.state().session.transport.kind === 'bus', null, { timeout: 15000 }).catch(() => { });
        expect(await kind(guest) === 'bus' && await kind(host) === 'bus', 'a direct link dying moves both to the relays');
        await host.waitForTimeout(2500);
        const age = await guest.evaluate(() => performance.now() - TZ_ENGINE.state().lastSnap);
        expect(await state(host, g => g.s.tick) > tick0 + 60 && age < 2000, 'and the match never stopped', Math.round(age) + 'ms since the guest last heard');
        // ---- the guest walks out: a bot rides its cycle ----
        await guest.close();
        await host.waitForFunction(() => !!TZ_ENGINE.state().s.seats[1].bot, null, { timeout: 25000 });
        const seat = await state(host, g => [g.s.seats[1].bot, g.s.seats[1].on].join());
        expect(seat === 'normal,false', 'a guest who leaves gets a bot in the seat', seat);
        const t2 = await state(host, g => g.s.tick);
        await host.waitForTimeout(1500);
        expect(await state(host, g => g.s.tick) > t2 + 60, 'and the match goes on without them');
        await host.close();
        await ctx.close();
    }

    if (part('relays')) {
        section('three browsers over the relays');
        const ctxs = [], pages = [];
        for (const name of ['ana', 'bob', 'cem']) {
            const ctx = await context({ viewport: { width: 1100, height: 780 } }, name, { 'test-direct': 'noroute' });
            ctxs.push(ctx);
            pages.push(await open(ctx, null, name));
        }
        const [host, ...guests] = pages;
        const code = await hostLobby(host, { set: { cycles: '8', bots: 'hard', arena: 'large', rounds: '9' } });
        for (const gp of guests) await joinLobby(gp, code);
        await startMatch(host, guests);
        expect((await Promise.all(pages.map(kind))).every(k => k === 'bus'), 'all three over the relays');
        const me = await Promise.all(pages.map(p => state(p, g => g.me)));
        expect(me.join() === '0,1,2' && await state(host, g => g.s.n) === 8, 'eight cycles: three people and five bots', me.join());
        await host.evaluate(() => { for (let i = 0; i < 3; i++) TZ_ENGINE.drive(i, 'hard'); });
        await race(host);
        // a turn from a guest, over the relays
        const g1 = guests[0];
        await g1.waitForFunction(() => TZ_ENGINE.state().pred && TZ_ENGINE.state().s.phase === 'race', null, { timeout: 15000 });
        await host.evaluate(() => TZ_ENGINE.drive(1, null));
        const r = await rays(g1, 1);
        const before = await state(g1, g => g.pred.dir);
        await g1.keyboard.press(r[1] > r[2] ? 'ArrowLeft' : 'ArrowRight');
        const want = await state(g1, g => g.pred.dir);
        const got = await host.waitForFunction(d => TZ_ENGINE.state().s.cycles[1].dir === d || !TZ_ENGINE.state().s.cycles[1].alive, want, { timeout: 5000 }).then(() => true, () => false);
        expect(got && want !== before, 'a guest\'s turn reaches the host over the relays');
        await host.evaluate(() => TZ_ENGINE.drive(1, 'hard'));
        // the bytes, while eight ride
        const meter = async p => {
            const b = { sent: 0, got: 0, on: false, frames: 0 };
            const cdp = await p.context().newCDPSession(p);
            await cdp.send('Network.enable');
            cdp.on('Network.webSocketFrameSent', e => { if (b.on) { b.sent += e.response.payloadData.length; b.frames++; } });
            cdp.on('Network.webSocketFrameReceived', e => { if (b.on) b.got += e.response.payloadData.length; });
            return b;
        };
        const meters = await Promise.all(pages.map(meter));
        const seconds = 12;
        meters.forEach(m => { m.on = true; });
        let most = 0;
        for (let i = 0; i < seconds * 2; i++) { await host.waitForTimeout(500); most = Math.max(most, await state(host, g => g.s.cycles.filter(c => c.alive).length)); }
        meters.forEach(m => { m.on = false; });
        const perMin = n => n * 60 / seconds / 1048576;
        const [hm, ...gm] = meters;
        console.log('        up to ' + most + ' riding: host up ' + perMin(hm.sent).toFixed(2) + 'MB a minute in ' + hm.frames + ' frames, guests up ' + gm.map(m => perMin(m.sent).toFixed(3)).join('/') + ', down ' + gm.map(m => perMin(m.got).toFixed(2)).join('/'));
        expect(perMin(hm.sent) <= 1.2, 'the host sends one copy for everybody to the relays, and it is small', perMin(hm.sent).toFixed(2) + 'MB a minute');
        expect(gm.every(m => perMin(m.sent) <= 0.15), 'a guest sends next to nothing', gm.map(m => perMin(m.sent).toFixed(3)).join(', '));
        expect(hm.frames / seconds <= 8 && gm.every(m => m.frames / seconds <= 4), 'and nobody is rude to the relay', (hm.frames / seconds).toFixed(1) + ' frames a second from the host');
        const ages = await Promise.all(guests.map(p => p.evaluate(() => performance.now() - TZ_ENGINE.state().lastSnap)));
        expect(ages.every(a => a < 1500), 'every guest is still hearing about it', ages.map(Math.round).join(', ') + 'ms');
        // the walls agree: every finished corner of every cycle, on every screen
        const walls = p => state(p, g => g.s.cycles.map(c => c.pts.slice(0, Math.max(0, c.pts.length - 2)).map(v => Math.round(v * 10)).join(',')).join('|'));
        await host.waitForTimeout(100);
        const hw = (await walls(host)).split('|');
        const gw = (await walls(guests[1])).split('|');
        const agree = hw.filter((w, i) => gw[i] && (gw[i].startsWith(w.slice(0, Math.max(0, w.length - 40))))).length;
        expect(agree >= 7, 'and every screen has the same walls, corner for corner', agree + ' of 8 cycles');
        await host.screenshot({ path: SHOTS + '/tz-relays-host.png' });
        await guests[1].screenshot({ path: SHOTS + '/tz-relays-guest.png' });

        section('one walks out, and somebody takes the seat');
        await guests[1].close();
        await host.waitForFunction(() => !!TZ_ENGINE.state().s.seats[2].bot, null, { timeout: 25000 });
        expect(true, 'the seat of the one who left goes to a bot');
        const ctxE = await context({ viewport: { width: 1100, height: 780 } }, 'eve', { 'test-direct': 'noroute' });
        const eve = await open(ctxE, null, 'eve');
        await joinLobby(eve, code);
        const handed = await eve.waitForSelector('#tz-canvas', { timeout: 40000 }).then(() => true, () => false);
        if (!handed) console.log('        eve: ' + JSON.stringify(await eve.evaluate(() => { const s = Netplay.current; return s && { state: s.state, game: s.gameId, players: s.players.map(p => p.name), seated: s.seated }; })));
        await eve.waitForFunction(() => TZ_ENGINE.state() && TZ_ENGINE.state().me === 2, null, { timeout: 30000 });
        await host.waitForFunction(() => TZ_ENGINE.state().s.seats[2].on && TZ_ENGINE.state().s.seats[2].name === 'eve', null, { timeout: 15000 });
        expect(true, 'a newcomer with the code is handed the match, in the empty seat');
        await eve.waitForFunction(() => TZ_ENGINE.state().lastSnap && performance.now() - TZ_ENGINE.state().lastSnap < 1500, null, { timeout: 10000 });
        expect(true, 'and hears the host');
        await eve.screenshot({ path: SHOTS + '/tz-late-join.png' });
        for (const p of [host, guests[0], eve]) await p.close().catch(() => { });
        for (const c of [...ctxs, ctxE]) await c.close().catch(() => { });
    }

    if (part('lobby')) {
        section('the open lobby list');
        const ctxA = await context({ viewport: { width: 1100, height: 800 } }, 'dee');
        const ctxB = await context({ viewport: { width: 1100, height: 800 } }, 'fay');
        const a = await open(ctxA, null, 'dee'), b = await open(ctxB, null, 'fay');
        const code = await hostLobby(a, { public: true });
        await b.evaluate(() => openNetplay({ gameId: 'trailz' }));
        const seen = await b.waitForFunction(c => !!document.querySelector(`.np-lb-join[data-code="${c}"]`), code, { timeout: 20000 }).then(() => true, () => false);
        expect(seen, 'a public trailz lobby is on a stranger\'s open list');
        const row = seen ? await b.evaluate(c => document.querySelector(`.np-lb-join[data-code="${c}"]`).closest('.np-lb-row, li, div').textContent, code) : '';
        expect(/trailz/.test(row) && /1\/4/.test(row), 'named, with its seats counted against its cycles', row.replace(/\s+/g, ' ').trim().slice(0, 90));
        await ctxA.close(); await ctxB.close();
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
