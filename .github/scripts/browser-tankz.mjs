// ===================================================================
// browser-tankz.mjs — tankz 98 driven, not just opened
//
//   solo     the desktop loads none of it until asked; the start menu and the
//            address bar open it; a match against a bot from the menu's own
//            buttons: real keys drive, turn and fire, at most five shells of
//            yours fly at once, a beam goes where its dotted line said, the
//            picture is a teal floor with grey walls, and the clock turned up
//            to the end of the match and the table
//   keyboard three people at one keyboard, each with their own keys
//   phone    real touches: the stick drives the tank where it points, the
//            button fires
//   room     two browsers straight across: the desktop lobby brings both to
//            the room, the host's settings reach the guest, the match starts
//            when both say ready, a guest's tank and shells reach the host,
//            the match ends and both are back in the same room with the
//            table, and somebody arriving later with the code lands there too
//   relays   three browsers over the relays only: a match to its end, a guest
//            walking out (a bot drives on), and the bytes counted
//
// It runs on no outside server: its own static server, a peerjs stand-in and
// server/nostr-test-relay.mjs.
//
//   node .github/scripts/browser-tankz.mjs
//   TK_ONLY=solo,room node .github/scripts/browser-tankz.mjs     one part at a time
// ===================================================================
import { chromium, devices } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.TK_SHOTS || path.join(ROOT, '.ci-shots');
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
const state = (p, fn, arg) => p.evaluate(`(${fn})(TK_ENGINE.state(), ${JSON.stringify(arg === undefined ? null : arg)})`);
const fight = p => p.waitForFunction(() => { const g = TK_ENGINE.state(); return g && (g.s.phase === 'fight' || g.s.phase === 'after'); }, null, { timeout: 20000 });
const tank = (p, i) => state(p, (g, i) => { const t = g.s.tanks[i]; return { x: t.x, y: t.y, a: t.a, alive: t.alive }; }, i);
// what the picture is made of: the teal outside, the floor, the grey of the walls
const colours = p => p.evaluate(() => {
    const c = document.getElementById('tk-canvas'), x = c.getContext('2d');
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let teal = 0, floor = 0, grey = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
        n++;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (r < 6 && g > 123 && g < 133 && b > 123 && b < 133) teal++;
        else if (r > 6 && r < 24 && g > 134 && g < 148 && b > 134 && b < 148) floor++;
        else if (r > 185 && r < 200 && g > 185 && g < 200 && b > 185 && b < 200) grey++;
    }
    return { teal: teal / n, floor: floor / n, grey: grey / n, w: c.width, h: c.height };
});
const hold = async (p, key, ms) => { await p.keyboard.down(key); await p.waitForTimeout(ms); await p.keyboard.up(key); };

const ONLY = process.env.TK_ONLY || '';
const part = n => !ONLY || ONLY.split(',').includes(n);
try {
    // ===================================================================
    if (part('solo')) {
        section('the desktop, the start menu and the address bar');
        // ===================================================================
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        const p = await open(ctx, null, 'desktop');
        expect(await p.evaluate(() => !window.TK && !window.TK_SIM && !window.TK_ROOM && !window.Netplay), 'none of it is in the first load');
        expect(await p.evaluate(() => !document.getElementById('tk-css') && ![...document.styleSheets].some(s => /tankz/.test(s.href || ''))), 'nor its stylesheet');
        expect(await p.locator('.start-item', { hasText: 'tankz 98' }).count() === 1, 'it has a place in the start menu');
        await p.evaluate(() => startMenuAction('tankz'));
        await p.waitForSelector('.tk-menu', { timeout: 20000 });
        expect(await p.evaluate(() => !!document.getElementById('tk-css') && !!window.TK_SIM && !!window.TK_ROOM), 'and opens from it, bringing its own styles');
        await p.waitForTimeout(1200);
        await p.screenshot({ path: SHOTS + '/tk-menu.png' });
        const viaUrl = await open(ctx, BASE + '/?app=tankz', 'address bar');
        expect(await viaUrl.waitForSelector('.tk-menu', { timeout: 20000 }).then(() => true, () => false), 'it opens from the address bar, ?app=tankz');
        await viaUrl.close();

        // ===================================================================
        section('a match against a bot, from the menu');
        // ===================================================================
        await p.selectOption('.tk-menu [data-k="humans"]', '1');
        await p.selectOption('.tk-menu [data-k="bots"]', '1');
        await p.selectOption('.tk-menu [data-k="level"]', 'easy');
        await p.selectOption('.tk-menu [data-k="points"]', '3');
        await p.click('.tk-menu [data-act="local"]');
        await p.waitForFunction(() => TK_ENGINE.screen() === 'play' && TK_ENGINE.state());
        const setup = await state(p, g => [g.s.n, g.s.points, g.s.seats[1].bot, g.s.phase, g.s.round].join());
        expect(setup === '2,3,easy,ready,1', 'the menu\'s choices are the match: one easy bot, first to three, and a moment to look first', setup);
        expect(/round 1/.test(await p.textContent('.tk-big').catch(() => '')), 'the round is on the screen');
        await fight(p);
        // nothing near to shoot at it for a moment: the bot is told to sit still
        await p.evaluate(() => TK_ENGINE.drive(1, null));
        await p.evaluate(() => { const g = TK_ENGINE.state(); g.bots[1] = null; g.s.seats[1].bot = ''; });
        const a0 = await tank(p, 0);
        await hold(p, 'ArrowRight', 300);
        const a1 = await tank(p, 0);
        expect(((a1.a - a0.a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI > 0.5, 'holding the right arrow turns the tank clockwise', (a1.a - a0.a).toFixed(2) + ' radians');
        await hold(p, 'KeyW', 400);
        const a2 = await tank(p, 0);
        const ahead = (a2.x - a1.x) * Math.cos(a1.a) + (a2.y - a1.y) * Math.sin(a1.a);
        const moved = Math.hypot(a2.x - a1.x, a2.y - a1.y);
        expect(moved > 8 && ahead > -1, 'and w drives it, forward or along the wall it ran into', moved.toFixed(1) + ' units');
        await hold(p, 'ArrowDown', 300);
        const a3 = await tank(p, 0);
        expect(Math.hypot(a3.x - a2.x, a3.y - a2.y) > 4, 'the down arrow backs it up');
        // fire: at most five of mine in the air
        for (let k = 0; k < 8; k++) { await p.keyboard.press('Space'); await p.waitForTimeout(110); }
        const mine = await state(p, g => g.s.shells.filter(b => b.o === 0 && b.k === 's').length);
        expect(mine === 5 || (mine >= 3 && mine <= 5), 'space fires, and no more than five shells of yours fly at once', mine + ' in the air');
        await p.screenshot({ path: SHOTS + '/tk-solo.png' });
        const look = await colours(p);
        expect(look.teal > 0.05 && look.floor > 0.25 && look.grey > 0.01, 'the picture: a teal desktop, a lighter floor, grey walls', JSON.stringify(look));
        // a beam goes where its dotted line said it would
        await p.waitForFunction(() => TK_ENGINE.state().s.tanks[0].alive || TK_ENGINE.state().s.phase !== 'fight', null, { timeout: 5000 }).catch(() => { });
        if (await state(p, g => g.s.tanks[0].alive && g.s.phase === 'fight')) {
            await p.evaluate(() => TK_ENGINE.give(0, 'beam'));
            await p.waitForTimeout(150);
            await p.screenshot({ path: SHOTS + '/tk-beam-aim.png' });
            const plan = await state(p, g => { const t = g.s.tanks[0]; return TK_SIM.cast(g.s, t.x, t.y, t.a, TK.WEAPON_BY_ID.beam.range, TK.WEAPON_BY_ID.beam.bounces, 0, 0).pts.slice(0, 6).map(v => Math.round(v)); });
            await p.keyboard.press('Space');
            await p.waitForFunction(() => TK_ENGINE.state().s.beams.length > 0, null, { timeout: 2000 }).catch(() => { });
            const shot = await state(p, g => g.s.beams.length ? g.s.beams[0].pts.slice(0, 6).map(v => Math.round(v)) : []);
            const off = shot.length ? Math.max(...shot.map((v, i) => Math.abs(v - plan[i]))) : 999;
            expect(off <= 3 && !(await state(p, g => g.s.tanks[0].w)), 'a beam goes where the dotted line said, off the walls, and it is used up', off + ' units off');
        }
        // and the rest of the match, with the clock up and a bot at the wheel
        await p.evaluate(() => { const g = TK_ENGINE.state(); g.s.seats[1].bot = 'easy'; TK_ENGINE.drive(0, 'hard'); TK_ENGINE.clock(12); });
        await p.waitForSelector('.tk-panel', { timeout: 120000 });
        const fin = await state(p, g => [g.s.phase, Math.max(...g.s.scores), g.over].join());
        expect(/^over,3,true$/.test(fin), 'first to three, and the match is over', fin);
        const panel = (await p.textContent('.tk-panel')).replace(/\s+/g, ' ');
        expect(/wins the match|you win the match/.test(panel) && /pts/.test(panel) && /own goals/.test(panel), 'and the table says who won, with hits and own goals', panel.slice(0, 90));
        const meta = await p.evaluate(() => TK_ENGINE.meta());
        expect(meta.matches === 1 && meta.rounds >= 3, 'the match is in the records', JSON.stringify(meta));
        await p.screenshot({ path: SHOTS + '/tk-solo-over.png' });
        await p.evaluate(() => TK_ENGINE.clock(1));
        await p.click('.tk-panel [data-act="again"]');
        expect(await state(p, g => g.s.round === 1 && !g.over && g.s.n === 2), 'again starts a new one');
        const trophies = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('achievements') || '{}'); } catch (e) { return {}; } });
        expect(JSON.stringify(trophies).includes('tankz'), 'and the trophy for driving one is on the shelf');
        await ctx.close();
    }

    // ===================================================================
    if (part('keyboard')) {
        section('three people at one keyboard');
        // ===================================================================
        const ctx = await context({ viewport: { width: 1280, height: 860 } }, null, { 'mrhakan98-tankz-prefs': JSON.stringify({ humans: 3, bots: 0, level: 'easy', points: 5, size: 'medium' }) });
        const p = await open(ctx, BASE + '/?app=tankz', 'keyboard');
        await p.waitForSelector('.tk-menu', { timeout: 20000 });
        expect(/w a s d/.test(await p.textContent('.tk-keys')) && /i j k l/.test(await p.textContent('.tk-keys')), 'the menu shows each person their keys');
        await p.click('.tk-menu [data-act="local"]');
        await p.waitForFunction(() => TK_ENGINE.screen() === 'play');
        expect(await state(p, g => g.s.n === 3 && g.locals.length === 3 && g.s.seats.every(x => !x.bot)), 'three tanks, three people, no bots');
        await fight(p);
        const before = await Promise.all([0, 1, 2].map(i => tank(p, i)));
        await hold(p, 'KeyD', 250); await hold(p, 'ArrowLeft', 250); await hold(p, 'KeyL', 250);
        const after = await Promise.all([0, 1, 2].map(i => tank(p, i)));
        const d = i => ((after[i].a - before[i].a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        expect(d(0) > 0.4 && d(1) < -0.4 && d(2) > 0.4, 'd turns the first, the left arrow the second, l the third', [0, 1, 2].map(i => d(i).toFixed(2)).join(' '));
        await p.keyboard.press('KeyQ'); await p.keyboard.press('Enter'); await p.keyboard.press('KeyU');
        await p.waitForTimeout(150);
        const owners = await state(p, g => [...new Set(g.s.shells.map(b => b.o))].sort().join());
        expect(owners === '0,1,2', 'q, enter and u each fire their own tank', owners);
        await p.screenshot({ path: SHOTS + '/tk-three.png' });
        await ctx.close();
    }

    // ===================================================================
    if (part('phone')) {
        section('a phone');
        // ===================================================================
        const ctx = await context(Object.assign({}, devices['Pixel 7']));
        const p = await open(ctx, BASE + '/?app=tankz', 'phone');
        await p.waitForSelector('.tk-menu', { timeout: 20000 });
        expect(/stick on the left/.test(await p.textContent('.tk-keys')), 'the menu explains the stick, not the keys');
        await p.locator('.tk-menu [data-act="local"]').tap();
        await p.waitForFunction(() => TK_ENGINE.screen() === 'play');
        expect(await p.isVisible('#tk-stick') && await p.isVisible('#tk-fire'), 'the thumbs are out: a stick and a fire button');
        await fight(p);
        await p.evaluate(() => { const g = TK_ENGINE.state(); for (let i = 1; i < g.s.n; i++) { g.bots[i] = null; g.s.seats[i].bot = ''; } });
        const t0 = await tank(p, 0);
        // push the stick the other way from where the tank faces, and hold it
        const box = await p.locator('#tk-stick').boundingBox();
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        const want = t0.a + Math.PI * 0.6;
        const cdp = await ctx.newCDPSession(p);
        const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
        await touch('touchStart', cx, cy);
        await touch('touchMove', cx + Math.cos(want) * 40, cy + Math.sin(want) * 40);
        await p.waitForTimeout(900);
        const t1 = await tank(p, 0);
        await touch('touchEnd', 0, 0);
        const left = Math.abs(((want - t1.a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        expect(left < 0.5 && Math.hypot(t1.x - t0.x, t1.y - t0.y) > 5, 'the stick turns the tank to where it points, and drives it', 'off by ' + left.toFixed(2) + ' rad, ' + Math.hypot(t1.x - t0.x, t1.y - t0.y).toFixed(0) + ' units');
        await p.locator('#tk-fire').dispatchEvent('pointerdown');
        await p.waitForTimeout(150);
        expect(await state(p, g => g.s.log.some(e => e.e === 'shot' && e.i === 0)), 'the fire button fires', await state(p, g => 'fp ' + g.locals[0].fp + ', alive ' + g.s.tanks[0].alive + ', ' + g.s.phase));
        await p.screenshot({ path: SHOTS + '/tk-phone.png' });
        await ctx.close();
    }

    // ===================================================================
    // online
    // ===================================================================
    async function hostLobby(p, opts) {
        await p.evaluate(() => openNetplay({ gameId: 'tankz' }));
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
        await p.evaluate(() => openNetplay({ gameId: 'tankz' }));
        await p.waitForSelector('#np-code', { timeout: 15000 });
        await p.fill('#np-code', code);
        await p.click('#np-join');
        await p.waitForSelector('.np-code', { timeout: 40000 });
    }
    // the desktop lobby's start button brings everybody to the room
    async function toRoom(host, guests) {
        await host.waitForFunction(n => document.querySelectorAll('.np-player:not(.np-empty)').length === n, guests.length + 1, { timeout: 40000 });
        for (const gp of guests) { await gp.click('#np-ready'); await host.waitForTimeout(300); }
        await host.click('#np-ready');
        await host.waitForTimeout(400);
        await host.click('#np-start');
        await Promise.all([host, ...guests].map(p => p.waitForSelector('.tk-room', { timeout: 40000 })));
        await Promise.all([host, ...guests].map(p => p.waitForFunction(n => TK_ENGINE.room() && TK_ENGINE.room().seats.length === n, guests.length + 1, { timeout: 30000 })));
    }
    async function readyAll(pages) {
        for (const p of pages) { await p.click('.tk-room [data-act="ready"]'); await p.waitForTimeout(200); }
        await Promise.all(pages.map(p => p.waitForFunction(() => TK_ENGINE.screen() === 'play' && TK_ENGINE.state(), null, { timeout: 30000 })));
    }
    const kind = p => p.evaluate(() => TK_ENGINE.state().session.transport.kind);

    if (part('room')) {
        section('the room, two browsers straight across');
        const ctx = await context({ viewport: { width: 1200, height: 860 } });
        const host = await open(ctx, null, 'host');
        const code = await hostLobby(host, { set: { points: '3', bots: '1', level: 'easy' } });
        const guest = await open(ctx, null, 'guest');
        await joinLobby(guest, code);
        await toRoom(host, [guest]);
        expect(true, 'the desktop lobby\'s start brings both to the room');
        const v = await guest.evaluate(() => TK_ENGINE.room());
        expect(v.opts.points === 3 && v.opts.level === 'easy' && v.bots === 1 && v.seats.length === 2, 'the lobby\'s choices are the room\'s: first to three, one easy bot, two people', JSON.stringify(v.opts));
        expect(await guest.evaluate(() => document.querySelectorAll('.tk-seats li').length) === 3, 'the guest sees both people and the bot');
        // the host changes a setting; the guest can't
        await host.selectOption('.tk-room [data-room="bots"]', '2');
        await guest.waitForFunction(() => TK_ENGINE.room().bots === 2, null, { timeout: 5000 });
        expect(true, 'the host adds a bot and the guest sees it');
        expect(await guest.evaluate(() => document.querySelector('.tk-room [data-room="bots"]').disabled), 'the guest\'s settings are the host\'s to change');
        await guest.click('.tk-room [data-act="ready"]');
        await host.waitForFunction(() => TK_ENGINE.room().seats.some(s => !s.ready === false && s.ready), null, { timeout: 5000 });
        const readyText = await host.textContent('.tk-seats');
        expect(/ready/.test(readyText) && /not yet/.test(readyText), 'the host sees who is ready and who is not', readyText.replace(/\s+/g, ' ').slice(0, 80));
        await host.screenshot({ path: SHOTS + '/tk-room.png' });
        await host.click('.tk-room [data-act="ready"]');
        await host.waitForFunction(() => TK_ENGINE.room().phase === 'countdown', null, { timeout: 5000 });
        expect(true, 'everybody ready: the countdown runs');
        await Promise.all([host, guest].map(p => p.waitForFunction(() => TK_ENGINE.screen() === 'play' && TK_ENGINE.state(), null, { timeout: 15000 })));
        expect(await kind(host) === 'peer' && await kind(guest) === 'peer', 'and the match starts on both screens, straight across');
        const seats = p => state(p, g => g.s.seats.map(x => (x.bot ? 'bot:' : '') + x.name).join(',') + ' me=' + g.me);
        const [hs, gs] = [await seats(host), await seats(guest)];
        expect(hs.split(' me=')[0] === gs.split(' me=')[0] && / me=0$/.test(hs) && / me=1$/.test(gs) && (hs.match(/bot:/g) || []).length === 2, 'one match on both: two people, two bots, a tank each', hs + ' | ' + gs);
        expect(await state(host, g => g.s.maze.seed) === await state(guest, g => g.s.maze.seed), 'the same maze on both');
        await fight(guest);
        await host.evaluate(() => { const g = TK_ENGINE.state(); for (const i of [2, 3]) { g.bots[i] = null; g.s.seats[i].bot = ''; } });
        // the guest drives: at once on its own screen, and on the host soon after
        const g0 = await state(guest, g => [g.pred.x, g.pred.y, g.pred.a]);
        await hold(guest, 'ArrowRight', 350);
        await hold(guest, 'ArrowUp', 400);
        const g1 = await state(guest, g => [g.pred.x, g.pred.y, g.pred.a]);
        expect(Math.hypot(g1[0] - g0[0], g1[1] - g0[1]) > 8, 'a guest\'s tank moves on its own screen as the key goes down');
        await host.waitForTimeout(400);
        const h1 = await tank(host, 1);
        const off = Math.hypot(h1.x - g1[0], h1.y - g1[1]);
        expect(off < 6, 'and the host has it where the guest put it', off.toFixed(2) + ' units apart');
        await guest.keyboard.press('Space');
        const shot = await host.waitForFunction(() => TK_ENGINE.state().s.shells.some(b => b.o === 1) || TK_ENGINE.state().s.events.concat(TK_ENGINE.state().s.log).some(e => e.e === 'shot' && e.i === 1), null, { timeout: 3000, polling: 10 }).then(() => true, () => false);
        expect(shot, 'a guest\'s shot is fired on the host', await state(host, g => { const t = g.s.tanks[1]; return 'fp ' + t.in.fp + ' seen ' + t.fpSeen + ' alive ' + t.alive + ' ' + g.s.phase; }) + ' | guest fp ' + await state(guest, g => g.locals[0].fp));
        const gsh = await guest.waitForFunction(() => TK_ENGINE.state().s.shells.some(b => b.o === 1), null, { timeout: 3000 }).then(() => true, () => false);
        expect(gsh, 'and comes back to the guest\'s screen, flying');
        await guest.screenshot({ path: SHOTS + '/tk-guest.png' });
        // to the end of the match, fast
        await host.evaluate(() => { const g = TK_ENGINE.state(); g.s.seats[2].bot = 'easy'; g.s.seats[3].bot = 'easy'; TK_ENGINE.drive(0, 'hard'); TK_ENGINE.clock(10); });
        await guest.evaluate(() => TK_ENGINE.drive(1, 'normal'));
        await Promise.all([host, guest].map(p => p.waitForSelector('.tk-panel', { timeout: 150000 })));
        const ht = (await host.textContent('.tk-panel')).replace(/\s+/g, ' '), gt = (await guest.textContent('.tk-panel')).replace(/\s+/g, ' ');
        const rows = t => t.split('own goals')[1].replace(/\(you\)/g, '').replace(/back to the room.*$/, '').replace(/\s+/g, '');
        expect(/win/.test(ht) && rows(ht) === rows(gt), 'the match ends on both with the same table', rows(ht).slice(0, 60) + ' | ' + rows(gt).slice(0, 60));
        await host.evaluate(() => TK_ENGINE.clock(1));
        await Promise.all([host, guest].map(p => p.waitForSelector('.tk-room .tk-last table', { timeout: 15000 })));
        expect(true, 'and both are back in the same room, with the table of the match');
        const after = await guest.evaluate(() => [TK_ENGINE.room().played, TK_ENGINE.room().phase, TK_ENGINE.room().seats.every(s => !s.ready)].join());
        expect(after === '1,select,true', 'one match played, nobody ready yet', after);
        await guest.screenshot({ path: SHOTS + '/tk-room-after.png' });
        // somebody new with the code lands in the room too
        const late = await open(ctx, null, 'late');
        await joinLobby(late, code);
        const landed = await late.waitForSelector('.tk-room', { timeout: 30000 }).then(() => true, () => false);
        expect(landed, 'somebody joining later with the code lands in the room');
        await host.waitForFunction(() => TK_ENGINE.room().seats.length === 3, null, { timeout: 10000 }).catch(() => { });
        expect(await host.evaluate(() => TK_ENGINE.room().seats.length) === 3, 'with a seat of their own');
        // the second match: all three ready
        await readyAll([late, guest, host]);
        expect(await state(late, g => g.me) === 2 && await state(host, g => g.s.n) === 5, 'and plays the next match: three people, two bots');
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
        const code = await hostLobby(host, { set: { points: '3', bots: '1', level: 'normal' } });
        for (const gp of guests) await joinLobby(gp, code);
        await toRoom(host, guests);
        await readyAll([...guests, host]);
        expect((await Promise.all(pages.map(kind))).every(k => k === 'bus'), 'all three over the relays');
        expect((await Promise.all(pages.map(p => state(p, g => g.me)))).join() === '0,1,2' && await state(host, g => g.s.n) === 4, 'four tanks: three people and a bot');
        await fight(guests[0]);
        const meter = async p => {
            const b = { sent: 0, got: 0, on: false };
            const cdp = await p.context().newCDPSession(p);
            await cdp.send('Network.enable');
            cdp.on('Network.webSocketFrameSent', e => { if (b.on) b.sent += e.response.payloadData.length; });
            cdp.on('Network.webSocketFrameReceived', e => { if (b.on) b.got += e.response.payloadData.length; });
            return b;
        };
        const meters = await Promise.all(pages.map(meter));
        await host.evaluate(() => TK_ENGINE.drive(0, 'normal'));
        for (const gp of guests) await gp.evaluate(() => TK_ENGINE.drive(1, 'normal'));
        meters.forEach(m => { m.on = true; });
        await host.waitForTimeout(8000);
        meters.forEach(m => { m.on = false; });
        const kb = m => ((m.sent + m.got) / 8 / 1024).toFixed(1);
        console.log('        bytes a second: host ' + kb(meters[0]) + ' KB, guests ' + kb(meters[1]) + ' and ' + kb(meters[2]) + ' KB');
        expect((meters[0].sent + meters[0].got) / 8 < 60 * 1024, 'the host stays under 60 KB a second over the relays', kb(meters[0]) + ' KB/s');
        const moved = await state(host, g => g.s.shells.length + g.s.round);
        expect(moved > 1, 'and the match goes on: shells and rounds');
        // a guest walks out: a bot drives on
        const leaver = guests[1];
        const seat = await state(leaver, g => g.me);
        await leaver.evaluate(() => { const s = TK_ENGINE.state().session; s.leave(); });
        const took = await host.waitForFunction(i => !!TK_ENGINE.state().s.seats[i].bot, seat, { timeout: 20000 }).then(() => true, () => false);
        expect(took, 'a guest who walks out is replaced by a bot');
        await host.evaluate(() => TK_ENGINE.clock(10));
        const ended = await guests[0].waitForSelector('.tk-room .tk-last table', { timeout: 150000 }).then(() => true, () => false);
        expect(ended, 'the match runs to its end, and the one left is back in the room with the table');
        const seatsLeft = await host.evaluate(() => TK_ENGINE.room().seats.length);
        expect(seatsLeft === 2, 'where the one who walked out no longer has a seat', seatsLeft + ' seats');
        for (const c of ctxs) await c.close();
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
