// ===================================================================
// browser-dungeonz.mjs — a raid, played in a real browser
//
// One wizard and three bots go into the recycle bin with the clock turned up and
// come out the other side of the boss. On the way a real keyboard picks a card, a
// real mouse fires and draws a fireball's sigil through the wizardz recogniser, and
// the frame rate gets measured with four wizards and a crowd. Then a phone with
// real touches, then two browsers: straight across, over the relays, a direct link
// dying partway, and a guest walking out. It runs on no outside server: peerjs is a
// stand-in whose hole punching is a setting, and the relays are
// server/nostr-test-relay.mjs, as in browser-wizardz.mjs.
//
//   SITE_URL=http://localhost:8105 node .github/scripts/browser-dungeonz.mjs
//   DZ_GPU=1 asks for the machine's own gpu, for measuring
// ===================================================================
import { chromium, devices } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';

const BASE = (process.env.SITE_URL || 'http://localhost:8105').replace(/\/$/, '');
const SHOTS = process.env.DZ_SHOTS || '.ci-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const RELAY_PORT = 8600 + Math.floor(Math.random() * 90);
const RELAY = 'ws://127.0.0.1:' + RELAY_PORT;
// headless chromium on linux reports a locked mouse as zeros: there the no-lock path is played
const MOUSE_LOCK = !process.env.WZ_NO_LOCK && process.platform !== 'linux';

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

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

const relay = spawn(process.execPath, ['server/nostr-test-relay.mjs'], { env: { ...process.env, PORT: String(RELAY_PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 500));
const launchArgs = process.env.DZ_GPU ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch(Object.assign({ args: launchArgs }, process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}));
const errors = [];

async function context(opts) {
    const ctx = await browser.newContext(opts);
    if (!MOUSE_LOCK) await ctx.addInitScript(() => { Element.prototype.requestPointerLock = undefined; });
    await ctx.route('**/*', route => {
        const u = route.request().url();
        // the visitor counters: nothing of ours, and nothing a test should touch
        if (/komarev\.com|waust\.at|whos\.amung\.us/.test(u)) return route.abort();
        if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        if (/peerjs/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_PEERJS });
        return route.abort();
    });
    await ctx.addInitScript(relays => {
        try {
            sessionStorage.setItem('welcomed', '1');
            sessionStorage.setItem('booted', '1');
            localStorage.setItem('mrhakan98-netplay-relays', relays);
            localStorage.setItem('sound-enabled', 'false');
        } catch (e) { }
    }, RELAY);
    return ctx;
}
async function open(ctx, url) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(url || BASE + '/', { waitUntil: 'load' });
    return p;
}
const state = (p, fn, arg) => p.evaluate(`(${fn})(DZ_ENGINE.state(), ${JSON.stringify(arg === undefined ? null : arg)})`);
const tick = p => state(p, g => g.s.tick);
const live = p => p.waitForFunction(() => { const g = window.DZ_ENGINE && DZ_ENGINE.state(); return g && g.s && g.R ? true : null; }, null, { timeout: 40000 });
async function middle(p) {
    const b = await (await p.$('#dz-canvas')).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}
async function takeMouse(p) {
    const m = await middle(p);
    const already = await p.evaluate(() => !!document.pointerLockElement || !!DZ_ENGINE.state().noLock);
    if (!already) { await p.mouse.move(m.x, m.y); await p.mouse.click(m.x, m.y); await p.waitForTimeout(150); }
    await p.evaluate(() => { const g = DZ_ENGINE.state(); g.wantFire = false; });
}
// a party of bots, me included, with the clock turned up and the camera following
const AUTOPILOT = `(function () {
    const g = DZ_ENGINE.state();
    if (!g.brains[g.me]) g.brains[g.me] = DZ_SIM.newBrain(77, { pick: 'smart' });
    clearInterval(window.__follow);
    window.__follow = setInterval(() => { const q = DZ_ENGINE.state(); if (q) { q.yaw = q.s.heroes[q.me].yaw; q.pitch = -0.12; } }, 40);
})()`;
// a person holding fire and walking about, for the guest side of a test
const BUSY = `(function () {
    clearInterval(window.__busy);
    window.__busy = setInterval(() => {
        const g = DZ_ENGINE.state();
        if (!g) return;
        const h = g.s.heroes[g.me];
        const foe = DZ_SIM.enemiesNear(g.s, h.x, h.z, 30).sort((a, b) => a.d - b.d)[0];
        if (foe) g.yaw = Math.atan2(foe.e.x - h.x, -(foe.e.z - h.z));
        g.keys = { w: Math.sin(g.s.t * 0.8) > 0.3, s: Math.sin(g.s.t * 0.8) < -0.3, a: Math.cos(g.s.t) > 0, d: Math.cos(g.s.t) <= 0 };
        g.wantFire = true;
        if (h.offer && h.picks > 0) DZ_ENGINE.pickCard(g, 0);
    }, 100);
})()`;

try {
    // ===================================================================
    section('one wizard and three bots, through the boss');
    // ===================================================================
    {
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        const p = await open(ctx);
        const before = await p.evaluate(() => performance.getEntriesByType('resource').filter(r => /dungeonz|games\/ps1\//.test(r.name)).length);
        expect(before === 0, 'nothing of the game comes down until somebody opens it');
        // the address opens it
        await p.goto(BASE + '/?app=dungeonz', { waitUntil: 'load' });
        await p.waitForSelector('#dz-solo', { timeout: 30000 });
        const files = await p.evaluate(() => performance.getEntriesByType('resource').filter(r => /games\/(dungeonz|ps1)\/|wizardz-(data|sigil)/.test(r.name)).map(r => r.name.split('/').pop()));
        expect(files.length === 9, '/?app=dungeonz opens it, and its eight scripts and a stylesheet come down', files.join(', '));
        expect(await p.evaluate(() => !document.querySelector('script[src*="wizardz.js"]')), 'it borrows the wizardz sigils, not the wizardz game');
        await p.waitForTimeout(300);
        await p.screenshot({ path: SHOTS + '/dz-menu.png' });
        await p.click('.dz-dungeon[data-dungeon="bin"]');
        await p.evaluate(() => startDungeonz('solo', { seed: 1000, dungeon: 'bin' }));
        await live(p);
        const r = await state(p, g => ({ w: g.cv.width, h: g.cv.height, css: g.cv.getBoundingClientRect().width, ir: getComputedStyle(g.cv).imageRendering, st: g.R.stats(), seats: g.seats.map(q => q.bot), cards: !!g.cardsShown }));
        expect(r.h === 240, 'the dungeon really is 240 lines tall', r.w + 'x' + r.h);
        expect(r.css > r.w * 1.5 && r.ir === 'pixelated', 'and blown up with no smoothing', r.css + 'px, ' + r.ir);
        expect(r.st.triangles > 1000 && r.st.triangles < 30000, 'it is low poly, and it is 3d', r.st.triangles + ' triangles, ' + r.st.drawCalls + ' draw calls');
        expect(r.seats.join() === 'false,true,true,true', 'you, and three bots in the seats nobody is in');
        const pix = await p.evaluate(() => new Promise(res => requestAnimationFrame(() => {
            const g = DZ_ENGINE.state(), gl = g.R.gl, w = g.cv.width, h = g.cv.height;
            const px = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
            const colours = new Set(); let on = 0, n = 0;
            for (let i = 0; i < px.length; i += 4) { colours.add(px[i] << 16 | px[i + 1] << 8 | px[i + 2]); for (let k = 0; k < 3; k++) { const v = px[i + k] / 255 * 31; if (Math.abs(v - Math.round(v)) < 0.13) on++; n++; } }
            res({ on: on / n, colours: colours.size });
        })));
        expect(pix.on >= 0.8 && pix.colours > 30, '5 bits a channel, like the wizardz arena, and not one colour', Math.round(pix.on * 100) + '% on the grid, ' + pix.colours + ' colours');
        // ---- the first card, with a real key. Make one of them a fireball, so it can be drawn ----
        expect(r.cards, 'the entrance shrine offers a card');
        await p.evaluate(() => { const g = DZ_ENGINE.state(); g.s.heroes[0].offer[0] = { t: 'new', id: 'fireball' }; DZ_ENGINE.state().cardsKey = null; });
        await p.waitForTimeout(300);
        await p.screenshot({ path: SHOTS + '/dz-cards.png' });
        await p.evaluate(() => DZ_ENGINE.state().cv.focus());
        await p.keyboard.press('1');
        await p.waitForFunction(() => DZ_ENGINE.state().s.heroes[0].skills.length === 1, null, { timeout: 4000 });
        expect(await state(p, g => g.s.heroes[0].skills[0].id === 'fireball' && !g.cardsShown), 'pressing 1 takes the first card, and the cards go away');
        await p.waitForFunction(() => DZ_ENGINE.state().s.phase === 'live' && DZ_ENGINE.state().s.frontier === 1, null, { timeout: 10000 });
        expect(true, 'and once the bots have picked too, the gate opens');
        await takeMouse(p);
        // ---- walking, firing ----
        const at0 = await state(p, g => [g.s.heroes[0].x, g.s.heroes[0].z]);
        await p.keyboard.down('w');
        await p.waitForTimeout(700);
        await p.keyboard.up('w');
        const at1 = await state(p, g => [g.s.heroes[0].x, g.s.heroes[0].z]);
        expect(Math.hypot(at1[0] - at0[0], at1[1] - at0[1]) > 2, 'W walks', JSON.stringify(at0) + ' to ' + JSON.stringify(at1));
        const m = await middle(p);
        await p.mouse.move(m.x, m.y);
        await p.mouse.down();
        await p.waitForTimeout(400);
        const shots = await state(p, g => g.s.proj.filter(q => q.o === 0 && q.kind === 'bolt').length);
        await p.mouse.up();
        expect(shots > 0, 'holding the button fires the staff', shots + ' bolts in the air');
        // ---- E, and a triangle drawn with the mouse ----
        await p.keyboard.press('e');
        await p.waitForFunction(() => DZ_ENGINE.state().stance, null, { timeout: 3000 });
        const size = 90, tri = [[0, -size], [size, size * 0.75], [-size, size * 0.75], [0, -size]];
        let px = tri[0][0], py = tri[0][1];
        await p.mouse.move(m.x + px, m.y + py, { steps: 3 });
        await p.mouse.down();
        for (const [x, y] of tri.slice(1)) {
            for (let i = 1; i <= 8; i++) { await p.mouse.move(m.x + px + (x - px) * i / 8, m.y + py + (y - py) * i / 8); await p.waitForTimeout(10); }
            px = x; py = y;
        }
        await p.mouse.up();
        await p.waitForFunction(() => !DZ_ENGINE.state().stance || (DZ_ENGINE.state().lastRead && !DZ_ENGINE.state().lastRead.ok), null, { timeout: 5000 });
        const drawn = await state(p, g => ({ ok: g.lastRead && g.lastRead.ok, id: g.lastRead && g.lastRead.id, q: g.lastRead && g.lastRead.q, cd: g.s.heroes[0].skills[0].cd, hint: g.hint && g.hint.text }));
        expect(drawn.ok && drawn.id === 'fireball' && drawn.cd > 0, 'a triangle drawn in the ink stance casts the fireball, through the wizardz recogniser', JSON.stringify(drawn));
        expect(/power/.test(drawn.hint || ''), 'and says how hard it hit for how clean it was', drawn.hint);
        await p.screenshot({ path: SHOTS + '/dz-drawn.png' });
        // ---- then the bots take my seat too, and the clock goes up ----
        await p.evaluate(AUTOPILOT);
        await p.evaluate(() => { DZ_ENGINE.state().speed = 30; });
        await p.waitForFunction(() => { const g = DZ_ENGINE.state(); return g.s.bossOn || g.s.over; }, null, { timeout: 120000, polling: 250 });
        const atBoss = await state(p, g => ({ t: Math.round(g.s.t), lv: g.s.heroes.map(h => h.level), over: g.s.over, skills: g.s.heroes[0].skills.length }));
        expect(!atBoss.over, 'the party makes it through three sections to the boss', JSON.stringify(atBoss));
        expect(atBoss.lv.every(l => l >= 3) && atBoss.skills >= 2, 'levelling up and picking skills on the way', JSON.stringify(atBoss.lv));
        await p.evaluate(() => { DZ_ENGINE.state().speed = 1; });
        await p.waitForTimeout(3500);
        await p.screenshot({ path: SHOTS + '/dz-boss.png' });
        const bossView = await state(p, g => ({ hp: g.s.boss.hp / g.s.boss.maxHp, tel: g.s.tel.length, fps: Math.round(g.lastFps), ms: +(g.lastMs || 0).toFixed(2), st: g.R.stats() }));
        console.log('        at the boss: ' + bossView.fps + 'fps, ' + bossView.ms + 'ms of javascript a frame, ' + bossView.st.drawCalls + ' draw calls');
        expect(bossView.hp < 1, 'and fights it', JSON.stringify(bossView));
        await p.evaluate(() => { DZ_ENGINE.state().speed = 30; });
        await p.waitForFunction(() => DZ_ENGINE.state().s.over, null, { timeout: 120000, polling: 250 });
        const end = await state(p, g => ({ over: g.s.over, t: Math.round(g.s.t), boss: g.s.stats.bossT, phase: g.s.boss && g.s.boss.phase }));
        expect(end.over === 'win', 'and closes it, through all three phases', JSON.stringify(end));
        await p.waitForSelector('.wz-end', { timeout: 5000 });
        expect(/DUNGEON CLEARED/.test(await p.textContent('.wz-end')), 'the end says so');
        await p.screenshot({ path: SHOTS + '/dz-cleared.png' });
        const meta = await p.evaluate(() => JSON.parse(localStorage.getItem('mrhakan98-dungeonz-meta') || '{}'));
        expect(meta.runs === 1 && meta.wins && meta.wins.bin === 1 && meta.best && meta.best.bin > 0, 'a trophy and a best time are kept, and nothing that makes you stronger', JSON.stringify(meta));
        await p.click('#dz-quit');
        await p.waitForSelector('.dz-dungeon-best', { timeout: 4000 });
        expect(/🏆/.test(await p.textContent('.dz-dungeon[data-dungeon="bin"]')), 'and the menu shows it');

        // ---- the frame rate, with four wizards and a crowd ----
        await p.evaluate(() => startDungeonz('solo', { seed: 4242, dungeon: 'bsod' }));
        await live(p);
        await p.evaluate(() => {
            const g = DZ_ENGINE.state(), s = g.s;
            s.heroes.forEach(h => { h.picks = 0; h.offer = null; h.skills = [{ id: 'fireball', rank: 2, cd: 0 }, { id: 'blizzard', rank: 1, cd: 0 }]; h.hp = h.maxHp = 9999; });
            s.phase = 'live';
            // the second section's first room, and everything in the next three awake at once
            const rm = s.dun.rooms.find(r => r.kind === 'fight' && r.section === 1);
            s.heroes.forEach((h, i) => { h.x = rm.cx + (i - 1.5) * 2; h.z = rm.z0 + 2; });
            s.shrine.done = true; s.dun.gates.forEach((q, k) => { s.gateOpen[k] = 1; });
            for (let r = rm.i; r < rm.i + 3; r++) { s.entered[r] = 1; s.minions.forEach(m => { if (m.room === r) { m.state = 1; m.x = rm.cx + (Math.random() - 0.5) * 10; m.z = rm.cz + (Math.random() - 0.5) * 8; } }); }
            g.frontier = rm.i;
        });
        await p.evaluate(AUTOPILOT);
        await p.waitForTimeout(1500);
        const crowd = await state(p, g => g.s.minions.filter(m => m.state === 1).length);
        await p.waitForTimeout(2200);
        const perf = await state(p, g => ({ fps: Math.round(g.lastFps), ms: +(g.lastMs || 0).toFixed(2), st: g.R.stats(), awake: g.s.minions.filter(m => m.state === 1).length }));
        await p.screenshot({ path: SHOTS + '/dz-crowd.png' });
        console.log('        four wizards and ' + crowd + ' minions awake: ' + perf.fps + 'fps, ' + perf.ms + 'ms of javascript a frame, ' + perf.st.triangles + ' triangles in ' + perf.st.drawCalls + ' draw calls');
        expect(crowd >= 25, 'a crowd: three rooms of the blue screen awake at once', crowd + ' minions');
        // CI has a software renderer and no gpu, so the bar here is what that can do. Measured
        // on a real gpu it is in the readme
        expect(perf.fps >= (process.env.DZ_GPU ? 55 : 20) && perf.ms < 12, 'and it keeps up', perf.fps + 'fps, ' + perf.ms + 'ms');
        await p.close();
        await ctx.close();
    }

    // ===================================================================
    section('a phone');
    // ===================================================================
    {
        const phone = devices['Pixel 5'];
        const ctx = await context({ ...phone, viewport: { width: phone.viewport.height, height: phone.viewport.width } });
        const p = await open(ctx);
        const cdp = await ctx.newCDPSession(p);
        await p.evaluate(() => openDungeonz('solo'));
        await live(p);
        await p.waitForTimeout(500);
        const fit = await p.evaluate(() => {
            const s = document.querySelector('#dz-stage').getBoundingClientRect();
            return { right: s.right, bottom: s.bottom, top: s.top, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, buttons: document.querySelector('#dz-touch').style.display };
        });
        expect(fit.right <= fit.vw + 1 && fit.bottom <= fit.vh + 1 && fit.top >= 0, 'the dungeon fits a phone on its side', JSON.stringify(fit));
        expect(fit.sw <= fit.vw + 1 && fit.buttons !== 'none', 'nothing scrolls sideways, and the thumb buttons are there');
        const touches = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(t => ({ x: t[0], y: t[1], id: t[2] })) });
        const at = async sel => { const b = await (await p.$(sel)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
        // a card, with a finger
        const card = await at('[data-card="0"]');
        await touches('touchStart', [[card[0], card[1], 1]]);
        await touches('touchEnd', [[card[0], card[1], 1]]);
        await p.waitForFunction(() => DZ_ENGINE.state().s.heroes[0].skills.length === 1, null, { timeout: 4000 });
        expect(true, 'a tap on a card takes it');
        await p.screenshot({ path: SHOTS + '/dz-phone.png' });
        await p.waitForFunction(() => DZ_ENGINE.state().s.frontier === 1, null, { timeout: 10000 });
        const stage = await (await p.$('#dz-stage')).boundingBox();
        const ax = stage.x + stage.width * 0.2, ay = stage.y + stage.height * 0.65;
        const p0 = await state(p, g => [g.s.heroes[0].x, g.s.heroes[0].z]);
        await touches('touchStart', [[ax, ay, 2]]);
        await touches('touchMove', [[ax, ay - 40, 2]]);
        await p.waitForTimeout(700);
        const p1 = await state(p, g => [g.s.heroes[0].x, g.s.heroes[0].z]);
        expect(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 1.5, 'the left thumb walks', JSON.stringify(p0) + ' to ' + JSON.stringify(p1));
        const fire = await at('#dz-t-fire');
        await touches('touchStart', [[ax, ay - 40, 2], [fire[0], fire[1], 3]]);
        const bolts = await p.waitForFunction(() => DZ_ENGINE.state().s.proj.filter(q => q.o === 0).length, null, { timeout: 2000, polling: 50 }).then(h => h.jsonValue(), () => 0);
        await touches('touchEnd', [[fire[0], fire[1], 3]]);
        expect(bolts > 0, 'fire fires, while the other thumb keeps walking', bolts + ' bolts');
        const s1 = await at('#dz-t-s0');
        await touches('touchStart', [[ax, ay - 40, 2], [s1[0], s1[1], 4]]);
        await touches('touchEnd', [[s1[0], s1[1], 4]]);
        await p.waitForTimeout(150);
        expect(await state(p, g => g.s.heroes[0].skills[0].cd > 0), 'and the first skill button casts the first skill');
        await touches('touchEnd', [[ax, ay - 40, 2]]);
        const ink = await at('#dz-t-ink');
        await touches('touchStart', [[ink[0], ink[1], 5]]);
        await touches('touchEnd', [[ink[0], ink[1], 5]]);
        expect(await state(p, g => g.stance), 'ink opens the stance for a finger to draw in');
        await p.close();
        await ctx.close();
    }

    // ===================================================================
    // two browsers
    // ===================================================================
    const ctx = await context({ viewport: { width: 1180, height: 820 } });
    async function hostLobby(p, dungeon) {
        await p.evaluate(() => openNetplay({ gameId: 'dungeonz' }));
        await p.waitForSelector('#np-host', { timeout: 15000 });
        await p.click('#np-host');
        await p.waitForSelector('.np-code', { timeout: 20000 });
        await p.waitForTimeout(1200);
        if (dungeon) { await p.waitForSelector('[data-opt="dungeon"]', { timeout: 8000 }); await p.selectOption('[data-opt="dungeon"]', dungeon); }
        return (await p.textContent('.np-code')).trim();
    }
    async function joinLobby(p, code) {
        await p.evaluate(() => openNetplay({ gameId: 'dungeonz' }));
        await p.waitForSelector('#np-code', { timeout: 15000 });
        await p.fill('#np-code', code);
        await p.click('#np-join');
        await p.waitForSelector('.np-code', { timeout: 30000 });
    }
    async function startMatch(host, guest) {
        await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
        await guest.click('#np-ready');
        await host.waitForTimeout(500);
        await host.click('#np-ready');
        await host.waitForTimeout(300);
        await host.click('#np-start');
        await Promise.all([host.waitForSelector('#dz-canvas', { timeout: 30000 }), guest.waitForSelector('#dz-canvas', { timeout: 30000 })]);
        await Promise.all([live(host), live(guest)]);
    }
    const kind = p => p.evaluate(() => DZ_ENGINE.state().session.transport.kind);
    // both pick, and the run goes on to a room with something awake in it
    async function intoAFight(host, guest) {
        await guest.evaluate(BUSY);
        await host.evaluate(() => { const g = DZ_ENGINE.state(); DZ_ENGINE.pickCard(g, 0); });
        await host.evaluate(AUTOPILOT);
        await host.waitForFunction(() => { const s = DZ_ENGINE.state().s; return s.frontier >= 1 && s.minions.some(m => m.state === 1); }, null, { timeout: 60000, polling: 200 });
    }
    {
        // ===================================================================
        section('two browsers, straight across');
        // ===================================================================
        const host = await open(ctx);
        const code = await hostLobby(host, 'bin');
        const guest = await open(ctx);
        await joinLobby(guest, code);
        await startMatch(host, guest);
        expect(await kind(host) === 'peer' && await kind(guest) === 'peer', 'it went direct', await kind(guest));
        const seats = p => state(p, g => g.s.heroes.map(h => h.name + ':' + (h.bot ? 'b' : 'h')).join(',') + ' ' + g.s.dungeon + ' ' + g.seed);
        const [hs, gs] = [await seats(host), await seats(guest)];
        expect(hs === gs, 'both screens agree who sits where, in which dungeon, from which seed', hs);
        expect(await state(host, g => Object.keys(g.brains).length) === 2 && await state(guest, g => Object.keys(g.brains).length) === 0, 'two people and two bots, and the bots run on the host');
        expect(await state(guest, g => g.me) === 1 && await state(guest, g => g.s.minions.length) === await state(host, g => g.s.minions.length), 'the guest built the same dungeon and the same sleeping minions from the seed');
        // the guest picks a card, with a click
        await guest.waitForSelector('[data-card="1"]', { timeout: 8000 });
        await guest.click('[data-card="1"]');
        await host.waitForFunction(() => DZ_ENGINE.state().s.heroes[1].skills.length === 1, null, { timeout: 8000 });
        await guest.waitForFunction(() => DZ_ENGINE.state().s.heroes[1].skills.length === 1, null, { timeout: 8000 });
        const pickedG = await state(guest, g => g.s.heroes[1].skills.map(k => k.id).join()), pickedH = await state(host, g => g.s.heroes[1].skills.map(k => k.id).join());
        expect(pickedG === pickedH, 'a card the guest picks is the one the host gives it', pickedH);
        await host.evaluate(() => { const g = DZ_ENGINE.state(); DZ_ENGINE.pickCard(g, 0); });
        await host.waitForFunction(() => DZ_ENGINE.state().s.frontier === 1, null, { timeout: 10000 });
        // the guest walks at once, and the host catches up
        await takeMouse(guest);
        const g0 = await state(guest, g => [g.s.heroes[1].x, g.s.heroes[1].z]);
        await guest.keyboard.down('w');
        await guest.waitForTimeout(700);
        const g1 = await state(guest, g => [g.s.heroes[1].x, g.s.heroes[1].z]);
        await guest.keyboard.up('w');
        expect(Math.hypot(g1[0] - g0[0], g1[1] - g0[1]) > 2, 'a guest moves straight away', JSON.stringify(g1));
        await host.waitForTimeout(500);
        const h1 = await state(host, g => [g.s.heroes[1].x, g.s.heroes[1].z]);
        expect(Math.hypot(h1[0] - g1[0], h1[1] - g1[1]) < 1.5, 'and the host sees it there', JSON.stringify(h1));
        // a skill from the guest, by key
        await guest.keyboard.press('1');
        const cast = await host.waitForFunction(() => DZ_ENGINE.state().s.heroes[1].skills[0].cd > 0, null, { timeout: 8000 }).then(() => true, () => false);
        expect(cast, 'and a guest\'s skill is cast on the host');
        await intoAFight(host, guest);
        // Compare one authoritative checkpoint, not two moving battle frames.
        // Pausing physics keeps the normal snapshot transport running.
        const checkpoint = await (await host.waitForFunction(() => {
            const g = DZ_ENGINE.state(), awake = g.s.minions.filter(m => m.state === 1).map(m => m.id).sort().join();
            if (!awake) return false;
            g.paused = true; g.snapAcc = 1;
            return { tick: g.s.tick, awake };
        }, null, { timeout: 10000 })).jsonValue();
        let synced;
        try {
            synced = await guest.waitForFunction(({ tick, awake }) => {
                const g = DZ_ENGINE.state();
                return g.snapTick === tick && g.s.minions.filter(m => m.state === 1).map(m => m.id).sort().join() === awake;
            }, checkpoint, { timeout: 8000 }).then(() => true, () => false);
            expect(synced, 'a guest sees the same minions awake as the host at the same tick', checkpoint.awake.split(',').length + ' at tick ' + checkpoint.tick);
            const hp = p => state(p, g => g.s.heroes.map(h => Math.round(h.hp)));
            const [ha, ga] = [await hp(host), await hp(guest)];
            expect(ha.every((v, i) => Math.abs(v - ga[i]) <= 25), 'and roughly the same health on everybody', JSON.stringify([ha, ga]));
        } finally { await host.evaluate(() => { DZ_ENGINE.state().paused = false; }); }
        await host.screenshot({ path: SHOTS + '/dz-duo-host.png' });
        await guest.screenshot({ path: SHOTS + '/dz-duo-guest.png' });

        // ---- the line going quiet on the guest, and coming back ----
        // a guest hears nothing: gag the host, so no snapshot proves the line is up
        await host.evaluate(() => { const s = DZ_ENGINE.state().session; s.__send = s.send; s.send = () => { }; });
        await guest.waitForTimeout(150);
        await guest.evaluate(() => DZ_ENGINE.state().session.emit('net:down', 'quiet'));
        await guest.waitForTimeout(300);
        expect(await state(guest, g => g.netDown) && await guest.locator('.wz-dialog').count() === 1, 'a guest whose line goes quiet freezes, and says why');
        await host.evaluate(() => { const s = DZ_ENGINE.state().session; s.send = s.__send; });
        await guest.evaluate(() => DZ_ENGINE.state().session.emit('net:up'));
        await guest.waitForFunction(() => !DZ_ENGINE.state().netDown, null, { timeout: 5000 });
        expect(true, 'and carries on when it comes back');
        // ---- and on the host: the run goes on with a bot in the quiet seat ----
        const t0 = await tick(host);
        await guest.evaluate(() => { const s = DZ_ENGINE.state().session; s.__toHost = s.sendToHost; s.sendToHost = () => { }; });
        await host.evaluate(() => DZ_ENGINE.state().session.emit('net:down', 'quiet'));
        await host.waitForTimeout(800);
        expect(await state(host, g => !!g.brains[1]) && await tick(host) > t0 + 5, 'when the host loses the line the run goes on, with a bot in the quiet seat');
        await guest.evaluate(() => { const s = DZ_ENGINE.state().session; s.sendToHost = s.__toHost; });
        await host.waitForFunction(() => !DZ_ENGINE.state().brains[1], null, { timeout: 8000 });
        expect(true, 'and the guest gets the seat back the moment it speaks, same level, same cards');
        // ---- the guest walks out ----
        await guest.close();
        const taken = await host.waitForFunction(() => !!DZ_ENGINE.state().brains[1], null, { timeout: 20000 }).then(() => true, () => false);
        expect(taken, 'when a guest walks out, a bot sits down in their seat');
        const t1 = await tick(host);
        await host.waitForTimeout(1000);
        expect(await tick(host) > t1 + 10, 'and the run does not stop for it');
        await host.close();
    }
    {
        // ===================================================================
        section('a direct link dying mid-run');
        // ===================================================================
        const host = await open(ctx);
        const code = await hostLobby(host);
        const guest = await open(ctx);
        await joinLobby(guest, code);
        await startMatch(host, guest);
        expect(await kind(guest) === 'peer', 'the run starts direct');
        await intoAFight(host, guest);
        const seen = await tick(host);
        await guest.evaluate(() => window.__cutDirect());
        await guest.waitForFunction(() => DZ_ENGINE.state().session.transport.kind === 'bus', null, { timeout: 10000 }).catch(() => { });
        await host.waitForFunction(() => DZ_ENGINE.state().session.transport.kind === 'bus', null, { timeout: 10000 }).catch(() => { });
        expect(await kind(guest) === 'bus' && await kind(host) === 'bus', 'both move to the relays');
        await host.waitForTimeout(2500);
        expect(await tick(host) > seen + 30 && !(await state(guest, g => g.netDown)), 'and the run never stopped');
        const age = await guest.evaluate(() => performance.now() - DZ_ENGINE.state().lastSnap);
        expect(age < 1500, 'the guest is still hearing about it, five times a second now', Math.round(age) + 'ms since the last one');
        await host.close();
        await guest.close();
    }
    {
        // ===================================================================
        section('no direct route at all: the relays, and what they cost');
        // ===================================================================
        const host = await open(ctx);
        await host.evaluate(() => localStorage.setItem('test-direct', 'noroute'));
        const code = await hostLobby(host, 'bsod');
        const guest = await open(ctx);
        await joinLobby(guest, code);
        await startMatch(host, guest);
        expect(await kind(host) === 'bus' && await kind(guest) === 'bus', 'the run goes over the relays', await kind(host));
        await intoAFight(host, guest);
        const meter = async p => {
            const b = { sent: 0, got: 0, on: false, frames: 0 };
            const cdp = await p.context().newCDPSession(p);
            await cdp.send('Network.enable');
            cdp.on('Network.webSocketFrameSent', e => { if (b.on) { b.sent += e.response.payloadData.length; b.frames++; } });
            cdp.on('Network.webSocketFrameReceived', e => { if (b.on) b.got += e.response.payloadData.length; });
            return b;
        };
        const hm = await meter(host), gm = await meter(guest);
        // a crowd awake, so this is the expensive part of a run
        await host.evaluate(() => {
            const s = DZ_ENGINE.state().s;
            const rm = s.dun.rooms[s.frontier];
            s.minions.forEach(m => { if (m.room > rm.i && m.room <= rm.i + 2 && m.state === 0) { m.state = 1; m.x = rm.cx + (Math.random() - 0.5) * 10; m.z = rm.cz + (Math.random() - 0.5) * 8; } });
            s.heroes.forEach(h => { h.maxHp = h.hp = 5000; });
        });
        await host.waitForTimeout(1500);
        const crowd = await state(host, g => g.s.minions.filter(m => m.state === 1).length);
        const seconds = 20;
        hm.on = gm.on = true;
        await host.waitForTimeout(seconds * 1000);
        hm.on = gm.on = false;
        const perMin = n => n * 60 / seconds / 1048576;
        const hostFour = perMin(hm.sent) * 4, guestFour = perMin(gm.sent) * 4;
        console.log('        ' + crowd + ' awake, over one relay: host up ' + perMin(hm.sent).toFixed(2) + 'MB a minute, guest up ' + perMin(gm.sent).toFixed(2) + ', down ' + perMin(gm.got).toFixed(2) + ', in ' + hm.frames + ' and ' + gm.frames + ' frames in ' + seconds + 's');
        expect(crowd >= 12, 'with a crowd awake', crowd + ' minions');
        expect(hostFour <= 3, 'a fight over the relays costs the host what the guide says', hostFour.toFixed(2) + 'MB a minute over four');
        expect(guestFour <= 2.5, 'and the guest', guestFour.toFixed(2) + 'MB a minute over four');
        expect(hm.frames / seconds <= 12 && gm.frames / seconds <= 12, 'and neither of them is rude to the relay', (hm.frames / seconds).toFixed(1) + ' and ' + (gm.frames / seconds).toFixed(1) + ' events a second');
        const age = await guest.evaluate(() => performance.now() - DZ_ENGINE.state().lastSnap);
        expect(age < 2000, 'and the guest is still hearing about it', Math.round(age) + 'ms');
        const awakeH = await state(host, g => g.s.minions.filter(m => m.state === 1).length);
        const awakeG = await state(guest, g => g.s.minions.filter(m => m.state === 1).length);
        expect(Math.abs(awakeH - awakeG) <= 4, 'with both screens roughly agreeing what is awake', awakeH + ' and ' + awakeG);
        await host.screenshot({ path: SHOTS + '/dz-relay-host.png' });
        await host.evaluate(() => localStorage.removeItem('test-direct'));
        await host.close();
        await guest.close();
    }
    await ctx.close();

    section('page errors');
    expect(errors.length === 0, 'no page errors anywhere', errors.slice(0, 5).join(' | '));
} catch (e) {
    failures++;
    console.log('  FAIL  the test itself fell over: ' + (e && e.stack || e));
}
await browser.close();
relay.kill();
console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
