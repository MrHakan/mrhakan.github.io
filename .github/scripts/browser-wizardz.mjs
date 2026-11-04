// ===================================================================
// browser-wizardz.mjs — play it, rather than open it
//
// A real mouse takes the pointer, a real E opens the ink stance and a real drawing
// goes through the real recogniser. A match gets played to the end with the clock
// turned up, then a screen big enough for the auto scaler, then old saves, then a
// phone with real touches, then two browsers: straight across, over the relays, with
// the link dying partway through and a player disappearing. It runs on no outside
// server: peerjs is a stand-in whose hole punching is a setting, as in
// browser-netplay.mjs, and the public relays are server/nostr-test-relay.mjs.
//
//   SITE_URL=http://localhost:8104 node .github/scripts/browser-wizardz.mjs
// ===================================================================
import { chromium, devices } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import { TRIANGLE, ZBOLT, live, takeMouse, inkDraw, shoot, faceOff, hpOf, MOUSE_LOCK, honestMouse } from './wizardz-play.mjs';

const BASE = (process.env.SITE_URL || 'http://localhost:8104').replace(/\/$/, '');
const SHOTS = process.env.WZ_SHOTS || '.ci-shots';
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
// a software gpu is what CI has. WZ_GPU=1 asks for the machine's own, for measuring
const launchArgs = process.env.WZ_GPU ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch(Object.assign({ args: launchArgs }, process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}));
const errors = [];

async function context(opts) {
    const ctx = await browser.newContext(opts);
    await honestMouse(ctx);
    await ctx.route('**/*', route => {
        const u = route.request().url();
        if (/komarev\.com/.test(u)) return route.abort();
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
const state = (p, fn, arg) => p.evaluate(`(${fn})(WZ_ENGINE.state(), ${JSON.stringify(arg === undefined ? null : arg)})`);
const tick = p => state(p, g => g.s.tick);

// a person who knows what the buttons do, at whatever speed the clock is on. The
// aiming is written in, and the drawing goes through the real reading of the ink.
const PLAY = `(function () {
    window.__autoT = setInterval(() => {
        const g = WZ_ENGINE.state();
        if (!g || g.ended || g.paused) return;
        const S = WZ_SIM, D = WZ;
        const me = g.wiz[g.me], foe = g.wiz[1 - g.me];
        const p = { x: me.x, y: me.y, z: me.z, yaw: g.yaw, pitch: g.pitch, aim: false };
        for (let k = 0; k < 3; k++) {
            const c = S.camera(g.s, p);
            p.yaw = Math.atan2(foe.x - c.x, -(foe.z - c.z));
            p.pitch = Math.atan2(foe.y + 1 - c.y, Math.hypot(foe.x - c.x, foe.z - c.z));
        }
        g.yaw = p.yaw; g.pitch = p.pitch;
        const dist = Math.hypot(foe.x - me.x, foe.z - me.z);
        g.keys = { w: dist > 11, d: Math.sin(g.s.t * 0.7) > 0, a: Math.sin(g.s.t * 0.7) <= 0 };
        if (g.s.phase !== 'live' || me.dead) { g.wantFire = false; return; }
        if (!g.stance && !me.chamber && me.ink > 30 && Math.random() < 0.25) {
            const usable = g.loadout.map(id => D.byId(id)).filter(sp => !S.canInscribe(g.s, g.me, sp));
            if (usable.length) {
                const sp = usable[Math.floor(Math.random() * usable.length)];
                g.stance = true;
                g.wantFire = false;
                g.__sketched = sp.id;
                const a = Math.random() * 6.28, c = Math.cos(a), s = Math.sin(a);
                g.strokes = sp.glyph.map(st => st.map(q => ({ x: 320 + ((q.x - 50) * c - (q.y - 50) * s) * 1.4, y: 180 + ((q.x - 50) * s + (q.y - 50) * c) * 1.4 })));
                g.penUpAt = 0;
                g.penMovedAt = 0;
                g.__sketches = (g.__sketches || 0) + 1;
            }
            return;
        }
        g.wantFire = !g.stance;
    }, 60);
})()`;

try {
    // ===================================================================
    section('one wizard, against a bot, with a real mouse');
    // ===================================================================
    {
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        const p = await open(ctx);
        const startBytes = await p.evaluate(() => performance.getEntriesByType('resource').filter(r => /wizardz/.test(r.name)).length);
        expect(startBytes === 0, 'nothing of the game comes down until somebody opens it');
        await p.evaluate(() => openWizardz());
        await p.waitForFunction(() => !!window.startWizardz, null, { timeout: 30000 });
        const files = await p.evaluate(() => performance.getEntriesByType('resource').filter(r => /games\/wizardz\//.test(r.name)).map(r => r.name.split('/').pop()));
        expect(files.length === 5, 'then all five files do', files.join(', '));
        await p.waitForSelector('#wz-solo', { timeout: 8000 });
        await p.waitForTimeout(400);
        await p.screenshot({ path: SHOTS + '/wz-menu.png' });
        await p.click('#wz-solo');
        await p.waitForSelector('.wz-bot', { timeout: 8000 });
        await p.waitForTimeout(300);
        await p.screenshot({ path: SHOTS + '/wz-bots.png' });
        const porch = await p.evaluate(() => {
            const c = document.querySelector('canvas[data-botav]').getContext('2d').getImageData(0, 0, 100, 118).data;
            const seen = new Set();
            for (let i = 0; i < c.length; i += 16) seen.add(c[i] + ',' + c[i + 1] + ',' + c[i + 2]);
            return seen.size;
        });
        expect(porch > 4, 'each bot has a low poly portrait', porch + ' colours');
        await p.click('.wz-bot[data-bot="bogwart"]');
        await p.waitForSelector('#wz-canvas', { timeout: 10000 });
        const opening = await live(p);
        expect(opening.bot === 'bogwart', 'you fight the bot you picked', JSON.stringify(opening));
        expect(!!opening.hint, 'and it says something first', opening.hint);

        const r = await state(p, g => ({ w: g.cv.width, h: g.cv.height, css: g.cv.getBoundingClientRect().width, ir: getComputedStyle(g.cv).imageRendering, st: g.R.stats() }));
        expect(r.h === 240, 'the arena really is 240 lines tall', r.w + 'x' + r.h);
        expect(r.css > r.w * 1.5 && r.ir === 'pixelated', 'and blown up with no smoothing', r.css + 'px, ' + r.ir);
        expect(r.st.triangles > 500 && r.st.triangles < 12000, 'it is low poly, and it is 3d', r.st.triangles + ' triangles');
        expect(r.st.drawCalls < 160, 'and a frame is not many draw calls', r.st.drawCalls + ' draw calls');

        // the look: read back real pixels. 5 bits a channel means at most 32 values
        const pix = await p.evaluate(() => new Promise(res => {
            requestAnimationFrame(() => {
                const g = WZ_ENGINE.state(), gl = g.R.gl, w = g.cv.width, h = g.cv.height;
                const px = new Uint8Array(w * h * 4);
                gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
                const colours = new Set();
                let onGrid = 0, n = 0;
                for (let i = 0; i < px.length; i += 4) {
                    colours.add(px[i] << 16 | px[i + 1] << 8 | px[i + 2]);
                    for (let k = 0; k < 3; k++) {
                        const v = px[i + k] / 255 * 31;
                        if (Math.abs(v - Math.round(v)) < 0.13) onGrid++;
                        n++;
                    }
                }
                res({ onGrid: onGrid / n, colours: colours.size });
            });
        }));
        // glows blend on top afterwards, as they did, so not quite every pixel
        expect(pix.onGrid >= 0.8, 'a channel has 5 bits in it, like a PlayStation', Math.round(pix.onGrid * 100) + '% of values on the grid, ' + pix.colours + ' colours');
        expect(pix.colours > 30, 'and the screen is not one colour', pix.colours + ' colours');

        const locked = await takeMouse(p);
        if (MOUSE_LOCK) expect(locked, 'a click takes the mouse');
        else {
            expect(!locked && await state(p, g => g.noLock), 'with no pointer lock to be had, it falls back to dragging');
            console.log('        (this run drives the no-lock path: see wizardz-play.mjs)');
        }
        expect(await state(p, g => !g.s.ents.length), 'and that first click does not fire anything');

        // ---- walking ----
        const place = await state(p, g => [g.wiz[0].x, g.wiz[0].z]);
        await p.keyboard.down('w');
        await p.waitForTimeout(700);
        await p.keyboard.up('w');
        const moved = await state(p, g => [g.wiz[0].x, g.wiz[0].z, g.wiz[0].mvx, g.wiz[0].mvz]);
        expect(Math.hypot(moved[0] - place[0], moved[1] - place[1]) > 1.5, 'W walks', JSON.stringify(place) + ' to ' + JSON.stringify(moved));
        await p.waitForTimeout(120);
        expect(await state(p, g => Math.hypot(g.wiz[0].mvx, g.wiz[0].mvz) === 0), 'and letting go stops');
        await p.keyboard.press('Space');
        await p.waitForTimeout(170);
        expect(await state(p, g => g.wiz[0].y > 0.2), 'space jumps');
        await p.waitForTimeout(800);
        const beforeDash = await state(p, g => [g.wiz[0].x, g.wiz[0].z]);
        await p.keyboard.down('w');
        await p.keyboard.press('Shift');
        await p.waitForTimeout(250);
        await p.keyboard.up('w');
        const afterDash = await state(p, g => [g.wiz[0].x, g.wiz[0].z, g.wiz[0].dashCd]);
        expect(Math.hypot(afterDash[0] - beforeDash[0], afterDash[1] - beforeDash[1]) > 2.5 && afterDash[2] > 0, 'shift dashes', JSON.stringify(afterDash));

        // ---- looking ----
        const m = await (await p.$('#wz-canvas')).boundingBox();
        const cx = m.x + m.width / 2, cy = m.y + m.height / 2;
        await p.mouse.move(cx, cy);
        const yaw0 = await state(p, g => [g.yaw, g.pitch]);
        if (!MOUSE_LOCK) await p.mouse.down();
        await p.mouse.move(cx + 120, cy - 40, { steps: 6 });
        await p.waitForTimeout(60);
        const yaw1 = await state(p, g => [g.yaw, g.pitch]);
        if (!MOUSE_LOCK) await p.mouse.up();
        expect(yaw1[0] > yaw0[0] + 0.1, 'moving the mouse right turns right', yaw0[0].toFixed(2) + ' to ' + yaw1[0].toFixed(2));
        expect(yaw1[1] > yaw0[1] + 0.03, 'and up looks up', yaw0[1].toFixed(2) + ' to ' + yaw1[1].toFixed(2));
        await p.mouse.move(cx, cy, { steps: 6 });
        // ---- aiming ----
        await p.mouse.down({ button: 'right' });
        await p.waitForTimeout(250);
        const aiming = await state(p, g => ({ aim: g.wiz[0].aim, fov: g.fovNow }));
        await p.mouse.up({ button: 'right' });
        await p.waitForTimeout(80);
        expect(await p.evaluate(() => {
            const asked = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 });
            document.querySelector('#wz-canvas').dispatchEvent(asked);
            return asked.defaultPrevented && !document.querySelector('#ctx-menu.open');
        }), 'and the desktop\'s right click menu stays out of it');
        expect(await p.evaluate(() => !document.querySelector('#ctx-menu.open')), 'after a real right click as well');
        if (MOUSE_LOCK) expect(await p.evaluate(() => !!document.pointerLockElement), 'and keeps hold of the mouse');
        await p.waitForTimeout(250);
        const hip = await state(p, g => g.fovNow);
        expect(aiming.aim && aiming.fov < hip - 0.1, 'the right button aims over the shoulder', aiming.fov.toFixed(2) + ' against ' + hip.toFixed(2));
        await p.screenshot({ path: SHOTS + '/wz-play.png' });

        // ---- the ink stance ----
        const stanceAt = await state(p, g => [g.yaw, g.pitch]);
        await p.keyboard.press('e');
        await p.waitForFunction(() => WZ_ENGINE.state().stance, null, { timeout: 3000 });
        await p.mouse.move(cx + 40, cy + 30, { steps: 4 });
        const still = await state(p, g => [g.yaw, g.pitch]);
        expect(still[0] === stanceAt[0], 'in the ink stance the camera stops');
        expect(await state(p, g => g.pen.x !== 320), 'and the mouse moves the pen instead');
        await p.mouse.move(cx, cy, { steps: 2 });
        await p.keyboard.press('e');
        await p.waitForFunction(() => !WZ_ENGINE.state().stance, null, { timeout: 3000 });
        expect(true, 'E puts it away again');

        const ink0 = await state(p, g => g.wiz[0].ink);
        await inkDraw(p, TRIANGLE);
        const read = await state(p, g => ({ c: g.wiz[0].chamber, ink: g.wiz[0].ink, hint: g.hint && g.hint.text, stance: g.stance }));
        expect(read.c && read.c.s === 'fireball', 'a triangle drawn with the mouse loads a fireball', JSON.stringify(read));
        expect(read.ink < ink0 && !read.stance, 'it costs ink, and ends the stance', ink0.toFixed(0) + ' to ' + read.ink.toFixed(0));
        await p.screenshot({ path: SHOTS + '/wz-loaded.png' });
        await p.mouse.down();
        await p.waitForTimeout(100);
        await p.mouse.up();
        const shot = await state(p, g => g.wiz[0].chamber && g.wiz[0].chamber.n);
        expect(shot === read.c.n - 1, 'a click fires one', read.c.n + ' to ' + shot);
        await p.waitForTimeout(50);

        // a drawing that goes nowhere
        await p.keyboard.press('e');
        await p.waitForTimeout(40);
        await p.mouse.move(cx - 80, cy, { steps: 2 });
        await p.mouse.down();
        for (let i = 0; i < 40; i++) await p.mouse.move(cx + Math.sin(i * 2.7) * 90, cy + Math.cos(i * 1.3) * 80);
        await p.mouse.up();
        await p.waitForFunction(() => !WZ_ENGINE.state().strokes.length, null, { timeout: 4000 });
        const scribble = await state(p, g => ({ c: g.wiz[0].chamber && g.wiz[0].chamber.s, ok: g.lastRead && g.lastRead.ok, hint: g.hint && g.hint.text, stance: g.stance }));
        expect(!scribble.ok && /fizzled|not in your book/.test(scribble.hint || ''), 'a scribble fizzles and says so', JSON.stringify(scribble));
        expect(scribble.stance, 'and you get another go without pressing anything');
        await p.keyboard.press('e');

        // ---- a bigger window ----
        await p.evaluate(() => document.exitPointerLock());
        await p.waitForTimeout(150);
        await p.evaluate(() => { WZ_ENGINE.state().paused = false; });
        await p.click('.app-window:has(.wz-body) .fs-btn');
        await p.waitForTimeout(600);
        const fullscreen = await p.evaluate(() => {
            const s = document.querySelector('#wz-stage').getBoundingClientRect();
            const c = document.querySelector('#wz-canvas').getBoundingClientRect();
            return { sw: s.width, sh: s.height, cw: c.width, ch: c.height, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight };
        });
        expect(fullscreen.sw > 1100 && fullscreen.sh > 650, 'fullscreen gives the arena the screen', JSON.stringify(fullscreen));
        expect(Math.abs(fullscreen.cw - fullscreen.sw) < 2 && Math.abs(fullscreen.ch - fullscreen.sh) < 2, 'and the canvas fills it', JSON.stringify(fullscreen));
        await p.click('.app-window:has(.wz-body) .fs-btn');
        await p.waitForTimeout(500);
        expect(await p.evaluate(() => document.querySelector('#wz-stage').getBoundingClientRect().width < 1100), 'and comes back');
        await p.evaluate(() => { const g = WZ_ENGINE.state(); if (g.paused) { g.paused = false; g.pauseWhy = null; } document.querySelectorAll('.wz-dialog').forEach(d => d.remove()); });
        await takeMouse(p);

        // ---- pausing ----
        await p.keyboard.press('p');
        await p.waitForSelector('#wz-resume', { timeout: 3000 });
        const frozen = await tick(p);
        await p.waitForTimeout(300);
        expect(await tick(p) === frozen, 'P freezes a bot match');
        expect(await p.evaluate(() => !document.pointerLockElement), 'and hands the mouse back');
        await p.screenshot({ path: SHOTS + '/wz-paused.png' });
        await p.click('#wz-resume');
        await p.waitForFunction(t => WZ_ENGINE.state().s.tick > t, frozen, { timeout: 4000 });
        expect(true, 'carry on carries on');
        await p.waitForTimeout(200);

        // ---- to the end ----
        await p.evaluate(() => { WZ_ENGINE.state().speed = 6; });
        await p.evaluate(PLAY);
        await p.waitForFunction(() => WZ_ENGINE.state().ended, null, { timeout: 200000, polling: 500 });
        await p.evaluate(() => clearInterval(window.__autoT));
        const end = await state(p, g => ({ over: g.over, reason: g.reason, score: g.wins, t: g.s.t, me: g.me, sketches: g.__sketches || 0 }));
        expect(end.over === 0 || end.over === 1, 'the match gets to an end', JSON.stringify(end));
        expect(['ko', 'ritual', 'time'].includes(end.reason), 'for a reason', end.reason);
        expect(end.sketches >= 3, 'with spells drawn along the way', end.sketches + ' of them');
        console.log('        ' + (end.over === end.me ? 'won' : 'lost') + ' ' + end.score.join('-') + ' in ' + Math.round(end.t) + 's of game time, by ' + end.reason);
        await p.waitForSelector('.wz-end', { timeout: 4000 });
        const words = await p.textContent('.wz-end');
        expect(/YOU (WIN|LOSE)/.test(words), 'the end of a match says who won', words.replace(/\s+/g, ' ').slice(0, 100));
        await p.screenshot({ path: SHOTS + '/wz-end.png' });
        await p.click('#wz-rematch');
        await p.waitForFunction(() => { const g = WZ_ENGINE.state(); return g.phase === 'countdown' && !g.ended; }, null, { timeout: 4000 });
        const again = await state(p, g => ({ score: g.wins, hp: g.wiz[0].hp, chamber: g.wiz[0].chamber, match: g.s.match }));
        expect(again.score[0] === 0 && again.score[1] === 0 && again.hp === 100 && !again.chamber && again.match === 2, 'a rematch starts clean', JSON.stringify(again));
        await p.evaluate(() => { WZ_ENGINE.state().speed = 1; });

        // ---- the other windows ----
        await p.evaluate(() => wizardzGrimoire());
        await p.waitForSelector('.wz-book-list', { timeout: 4000 });
        expect((await p.$$('.wz-book-item')).length === 50, 'the grimoire has all fifty');
        await p.waitForTimeout(1100);
        await p.screenshot({ path: SHOTS + '/wz-grimoire.png' });
        await p.click('#wz-practise');
        await p.waitForSelector('#wz-pad', { timeout: 3000 });
        const pad = await (await p.$('#wz-pad')).boundingBox();
        const px = pad.x + pad.width / 2, py = pad.y + pad.height / 2;
        // fireball, turned nearly upside down: the angle should not matter
        await p.mouse.move(px, py + 70);
        await p.mouse.down();
        await p.mouse.move(px + 70, py - 50, { steps: 10 });
        await p.mouse.move(px - 70, py - 50, { steps: 10 });
        await p.mouse.move(px, py + 70, { steps: 10 });
        await p.mouse.up();
        await p.waitForFunction(() => /would cast/.test(document.querySelector('#wz-score').textContent), null, { timeout: 3000 }).catch(() => { });
        const said = await p.textContent('#wz-score');
        expect(/would cast/.test(said), 'the practice pad reads an upside down triangle as a fireball', said);
        await p.evaluate(() => wizardzAvatar());
        await p.waitForSelector('.wz-part', { timeout: 3000 });
        expect((await p.$$('.wz-part')).length === 14, 'the dressing room has every part');
        await p.waitForTimeout(300);
        await p.screenshot({ path: SHOTS + '/wz-dress.png' });
        await p.evaluate(() => { document.querySelectorAll('.app-window').forEach(w => { if (!w.querySelector('.wz-body') && w.querySelector('.app-window-header')) { const b = [...w.querySelectorAll('.ie-titlebar-btn')].pop(); if (b) b.click(); } }); });
        await p.close();
        await ctx.close();
    }

    // ===================================================================
    section('a big screen, under the auto scaler');
    // ===================================================================
    {
        const ctx = await context({ viewport: { width: 2560, height: 1440 } });
        const p = await open(ctx);
        expect(await p.evaluate(() => window.SCALE && SCALE.scale > 1.2), 'the scaler is on', String(await p.evaluate(() => window.SCALE && SCALE.scale)));
        await p.evaluate(() => { localStorage.removeItem('mrhakan98-wizardz-loadout'); openWizardz('solo'); });
        await p.waitForFunction(() => window.WZ_ENGINE && WZ_ENGINE.state(), null, { timeout: 30000 });
        await live(p);
        const fits = await p.evaluate(() => {
            const s = document.querySelector('#wz-stage').getBoundingClientRect();
            return { top: s.top, bottom: s.bottom, vh: document.documentElement.clientHeight, w: s.width };
        });
        expect(fits.bottom <= fits.vh + 1, 'the arena fits on the screen', JSON.stringify(fits));
        await takeMouse(p);
        await inkDraw(p, TRIANGLE);
        const c = await state(p, g => g.wiz[g.me].chamber && g.wiz[g.me].chamber.s);
        expect(c === 'fireball', 'drawing still lands where the mouse went', String(c));
        await p.screenshot({ path: SHOTS + '/wz-scaled.png' });
        await p.close();
        await ctx.close();
    }

    // ===================================================================
    section('what an old save left behind');
    // ===================================================================
    {
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        // exactly what the old game wrote, spells it knew about and all
        await ctx.addInitScript(() => {
            localStorage.setItem('mrhakan98-wizardz-avatar', JSON.stringify({
                skin: '#a86b3c', hat: 'horned', hatColor: '#ff6b2b', hair: 'mohawk', hairColor: '#ff6b2b', beard: 'none',
                robe: 'ragged', robeColor: '#e4485f', trimColor: '#ffb400', staff: 'orb', familiar: 'imp', aura: 'flames', eyes: 'angry', title: 'the flammable'
            }));
            localStorage.setItem('mrhakan98-wizardz-loadout', JSON.stringify(['fireball', 'spark', 'magicmissile', 'blink', 'inferno', 'curse', 'quake', 'mirror']));
            localStorage.setItem('mrhakan98-wizardz-difficulty', 'hard');
            localStorage.setItem('mrhakan98-wizardz-manual-cast', 'true');
        });
        const p = await open(ctx);
        await p.evaluate(() => openWizardz('solo'));
        await p.waitForFunction(() => window.WZ_ENGINE && WZ_ENGINE.state(), null, { timeout: 30000 });
        await live(p);
        const old = await state(p, g => ({ book: g.loadout, hat: g.wiz[0].avatar.hat, manual: g.manualCast, react: g.brain.skill.react, base: g.bot.skill.react }));
        expect(old.book.length === 8 && old.book[3] === 'blink', 'the eight you picked are still yours', old.book.join(', '));
        expect(old.hat === 'horned', 'your wizard is still your wizard', old.hat);
        expect(old.manual, 'and manual cast is still on');
        expect(old.react < old.base, 'and the difficulty you left it on', old.react + ' against ' + old.base);
        await takeMouse(p);
        await inkDraw(p, TRIANGLE, { leaveOpen: true });
        await p.waitForTimeout(800);
        expect(await state(p, g => !g.wiz[0].chamber && g.stance && g.strokes.length > 0), 'with manual cast the ink waits for you');
        await p.keyboard.press('Enter');
        await p.waitForFunction(() => { const c = WZ_ENGINE.state().wiz[0].chamber; return c && c.s === 'fireball'; }, null, { timeout: 3000 });
        expect(true, 'and enter reads it');
        await p.close();
        await ctx.close();

        const ctx2 = await context({ viewport: { width: 1280, height: 860 } });
        await ctx2.addInitScript(() => {
            localStorage.setItem('mrhakan98-wizardz-avatar', '{"hat":"sombrero","skin":"url(javascript:alert(1))","robeColor":12,"familiar":{"a":1}}');
            localStorage.setItem('mrhakan98-wizardz-loadout', '["fireball","nonsense"]');
            localStorage.setItem('mrhakan98-wizardz-difficulty', 'impossible');
            localStorage.setItem('mrhakan98-wizardz-settings', 'garbage{{{');
        });
        const q = await open(ctx2);
        await q.evaluate(() => openWizardz('solo'));
        await q.waitForFunction(() => window.WZ_ENGINE && WZ_ENGINE.state(), null, { timeout: 30000 });
        await live(q);
        const rough = await state(q, g => ({ book: g.loadout.length, hat: g.wiz[0].avatar.hat, skin: g.wiz[0].avatar.skin, sens: g.settings.sens, skill: g.brain.skill.react, base: g.bot.skill.react }));
        expect(rough.book === 8 && rough.hat === 'pointy' && /^#/.test(rough.skin) && rough.sens === 1 && rough.skill === rough.base, 'a save full of nonsense gets you the defaults, not a crash', JSON.stringify(rough));
        await q.close();
        await ctx2.close();

        // and somebody with no 3d at all is told so
        const ctx3 = await context({ viewport: { width: 1280, height: 860 } });
        await ctx3.addInitScript(() => {
            const real = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (kind, o) { return /webgl/.test(kind) ? null : real.call(this, kind, o); };
        });
        const r = await open(ctx3);
        await r.evaluate(() => openWizardz('solo'));
        await r.waitForSelector('#wz-nogl-back', { timeout: 30000 });
        expect(/webgl/.test(await r.textContent('.wz-menu')), 'a browser with no webgl gets told, in words', (await r.textContent('.wz-title')).trim());
        await r.close();
        await ctx3.close();
    }

    // ===================================================================
    section('a phone');
    // ===================================================================
    {
        const phone = devices['Pixel 5'];
        const ctx = await context({ ...phone, viewport: { width: phone.viewport.height, height: phone.viewport.width } });
        const p = await open(ctx);
        const cdp = await ctx.newCDPSession(p);
        await p.evaluate(() => openWizardz('solo'));
        await p.waitForFunction(() => window.WZ_ENGINE && WZ_ENGINE.state(), null, { timeout: 30000 });
        await live(p);
        const fit = await p.evaluate(() => {
            const s = document.querySelector('#wz-stage').getBoundingClientRect();
            return { w: s.width, h: s.height, left: s.left, right: s.right, top: s.top, bottom: s.bottom, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, buttons: document.querySelector('#wz-touch').style.display };
        });
        expect(fit.right <= fit.vw + 1 && fit.bottom <= fit.vh + 1 && fit.top >= 0, 'the arena fits a phone on its side', JSON.stringify(fit));
        expect(fit.sw <= fit.vw + 1, 'and nothing scrolls sideways', fit.sw + ' in ' + fit.vw);
        expect(fit.buttons !== 'none', 'the thumb buttons are showing');
        await p.screenshot({ path: SHOTS + '/wz-phone.png' });
        const stage = await (await p.$('#wz-stage')).boundingBox();
        const ax = stage.x + stage.width * 0.2, ay = stage.y + stage.height * 0.65;
        const rx = stage.x + stage.width * 0.6, ry = stage.y + stage.height * 0.4;
        // touchStart and touchMove list every finger on the glass. touchEnd lists the ones lifting
        const touches = list => cdp.send('Input.dispatchTouchEvent', { type: list.type, touchPoints: list.points.map(t => ({ x: t[0], y: t[1], id: t[2] })) });
        const middleOf = async sel => { const b = await (await p.$(sel)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

        // ---- the left thumb walks ----
        const at0 = await state(p, g => [g.wiz[0].x, g.wiz[0].z]);
        await touches({ type: 'touchStart', points: [[ax, ay, 1]] });
        await touches({ type: 'touchMove', points: [[ax, ay - 40, 1]] });
        await p.waitForTimeout(600);
        const at1 = await state(p, g => [g.wiz[0].x, g.wiz[0].z, g.stick.y]);
        expect(Math.hypot(at1[0] - at0[0], at1[1] - at0[1]) > 1, 'the left thumb walks', JSON.stringify(at0) + ' to ' + JSON.stringify(at1));
        // ---- with the right one looking, at the same time ----
        const yaw0 = await state(p, g => g.yaw);
        await touches({ type: 'touchStart', points: [[ax, ay - 40, 1], [rx, ry, 2]] });
        for (let i = 1; i <= 6; i++) await touches({ type: 'touchMove', points: [[ax, ay - 40, 1], [rx + i * 12, ry, 2]] });
        await p.waitForTimeout(60);
        const yaw1 = await state(p, g => g.yaw);
        expect(yaw1 > yaw0 + 0.1, 'and the right thumb looks, at the same time', yaw0.toFixed(2) + ' to ' + yaw1.toFixed(2));
        await touches({ type: 'touchEnd', points: [[rx + 72, ry, 2]] });
        await p.waitForTimeout(40);

        // ---- the ink button, then a finger for a pen, still walking ----
        const inkAt = await middleOf('#wz-t-ink');
        await touches({ type: 'touchStart', points: [[ax, ay - 40, 1], [inkAt[0], inkAt[1], 9]] });
        await touches({ type: 'touchEnd', points: [[inkAt[0], inkAt[1], 9]] });
        await p.waitForFunction(() => WZ_ENGINE.state().stance, null, { timeout: 3000 });
        expect(await state(p, g => g.stick.id !== null), 'pressing ink does not let go of the stick');
        const walking = await state(p, g => [g.wiz[0].x, g.wiz[0].z]);
        const cx = stage.x + stage.width * 0.62, cy = stage.y + stage.height * 0.45, k = stage.height * 0.28;
        await touches({ type: 'touchStart', points: [[ax, ay - 40, 1], [cx, cy - k, 3]] });
        const path = [[cx + k, cy + k * 0.75], [cx - k, cy + k * 0.75], [cx, cy - k]];
        let from = [cx, cy - k];
        for (const to of path) {
            for (let i = 1; i <= 8; i++) {
                const x = from[0] + (to[0] - from[0]) * i / 8, y = from[1] + (to[1] - from[1]) * i / 8;
                await touches({ type: 'touchMove', points: [[ax, ay - 40, 1], [x, y, 3]] });
            }
            from = to;
        }
        await p.screenshot({ path: SHOTS + '/wz-phone-ink.png' });
        await touches({ type: 'touchEnd', points: [[cx, cy - k, 3]] });
        const shuffled = await state(p, g => [g.wiz[0].x, g.wiz[0].z, g.strokes.length]);
        expect(Math.hypot(shuffled[0] - walking[0], shuffled[1] - walking[1]) > 0.1, 'and you keep shuffling while you draw', JSON.stringify([walking, shuffled]));
        await p.waitForFunction(() => { const c = WZ_ENGINE.state().wiz[0].chamber; return c && c.s === 'fireball'; }, null, { timeout: 4000 }).catch(() => { });
        const read = await state(p, g => ({ c: g.wiz[0].chamber && g.wiz[0].chamber.s, r: g.lastRead && { ok: g.lastRead.ok, why: g.lastRead.why, id: g.lastRead.id }, hint: g.hint && g.hint.text }));
        expect(read.c === 'fireball', 'a triangle drawn with a finger loads a fireball, with the other thumb still on the stick', JSON.stringify(read));
        await touches({ type: 'touchEnd', points: [[ax, ay - 40, 1]] });
        await p.waitForTimeout(60);
        expect(await state(p, g => g.stick.id === null && g.stick.x === 0), 'letting go of the stick stops');

        // ---- the buttons ----
        const before = await state(p, g => g.wiz[0].chamber && g.wiz[0].chamber.n);
        await p.tap('#wz-t-fire');
        await p.waitForTimeout(120);
        const after = await state(p, g => ({ n: g.wiz[0].chamber && g.wiz[0].chamber.n, shots: g.ents.filter(e => e.k === 'shot').length, fire: g.wantFire }));
        expect(after.n === before - 1 && !after.fire, 'the fire button fires', before + ' to ' + JSON.stringify(after));
        await p.tap('#wz-t-jump');
        await p.waitForTimeout(150);
        expect(await state(p, g => g.wiz[0].y > 0.15), 'the jump button jumps');
        await p.tap('#wz-t-aim');
        await p.waitForTimeout(250);
        expect(await state(p, g => g.wiz[0].aim), 'the aim button aims');
        await p.tap('#wz-t-aim');
        await p.tap('#wz-t-menu');
        await p.waitForSelector('#wz-resume', { timeout: 2000 });
        expect(true, 'and the menu button gets you out');
        await p.close();
        await ctx.close();

        // the same phone held upright: it plays, in a taller frame
        const ctx2 = await context({ ...phone });
        const u = await open(ctx2);
        await u.evaluate(() => openWizardz('solo'));
        await u.waitForFunction(() => window.WZ_ENGINE && WZ_ENGINE.state(), null, { timeout: 30000 });
        await live(u);
        const up = await u.evaluate(() => {
            const s = document.querySelector('#wz-stage').getBoundingClientRect();
            const c = document.querySelector('#wz-canvas');
            return { w: s.width, h: s.height, bottom: s.bottom, vh: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, cw: c.width, ch: c.height };
        });
        expect(up.bottom <= up.vh + 1 && up.sw <= up.vw + 1, 'held upright it still fits', JSON.stringify(up));
        expect(up.ch > up.cw, 'and the arena goes tall rather than tiny', up.cw + 'x' + up.ch);
        await u.screenshot({ path: SHOTS + '/wz-phone-upright.png' });
        await u.close();
        await ctx2.close();
    }

    // ===================================================================
    // two browsers
    // ===================================================================
    const ctx = await context({ viewport: { width: 1180, height: 820 } });
    const lobbyOf = async p => {
        await p.evaluate(() => openNetplay());
        await p.waitForSelector('#np-host', { timeout: 15000 });
    };
    async function hostLobby(p) {
        await lobbyOf(p);
        await p.click('#np-host');
        await p.waitForSelector('.np-code', { timeout: 20000 });
        // the code shows as soon as one road is open, and the direct one takes a moment longer
        await p.waitForTimeout(1200);
        return (await p.textContent('.np-code')).trim();
    }
    async function joinLobby(p, code) {
        await lobbyOf(p);
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
        await Promise.all([host.waitForSelector('#wz-canvas', { timeout: 30000 }), guest.waitForSelector('#wz-canvas', { timeout: 30000 })]);
        await Promise.all([live(host), live(guest)]);
    }
    const kind = p => p.evaluate(() => WZ_ENGINE.state().session.transport.kind);
    async function crossFire(host, guest, what) {
        await faceOff(host, [guest]);
        await takeMouse(guest);
        await inkDraw(guest, TRIANGLE);
        const gc = await guest.waitForFunction(() => { const c = WZ_ENGINE.state().wiz[1].chamber; return c && c.s === 'fireball'; }, null, { timeout: 12000 }).then(() => true, () => false);
        expect(gc, 'a sigil drawn on the guest loads ' + what);
        await shoot(guest, 2);
        const hurt = await host.waitForFunction(() => WZ_ENGINE.state().wiz[0].hp < 100, null, { timeout: 20000 }).then(() => true, () => false);
        expect(hurt, 'and when the guest fires it hits the host ' + what, JSON.stringify(await hpOf(host)));
        await takeMouse(host);
        await inkDraw(host, ZBOLT);
        await shoot(host, 2);
        const hurt2 = await host.waitForFunction(() => WZ_ENGINE.state().wiz[1].hp < 100, null, { timeout: 20000 }).then(() => true, () => false);
        expect(hurt2, 'and the host hits back', JSON.stringify(await hpOf(host)));
        await host.waitForTimeout(900);
        const [a, b] = [await hpOf(host), await hpOf(guest)];
        expect(a.every((v, i) => Math.abs(v - b[i]) <= 10), 'and both screens agree', JSON.stringify([a, b]));
    }

    // ===================================================================
    section('two browsers, straight across');
    // ===================================================================
    {
        const host = await open(ctx);
        const code = await hostLobby(host);
        const guest = await open(ctx);
        await joinLobby(guest, code);
        await startMatch(host, guest);
        expect(await kind(host) === 'peer' && await kind(guest) === 'peer', 'it went direct', await kind(guest));
        expect(await state(host, g => g.isHost) && !(await state(guest, g => g.isHost)), 'and one of them owns the match');
        const me = await state(guest, g => g.me);
        expect(me === 1, 'the guest sits on the far side');

        // a guest moves at once, and the host catches up
        await takeMouse(guest);
        const g0 = await state(guest, g => [g.wiz[1].x, g.wiz[1].z]);
        const h0 = await state(host, g => [g.wiz[1].x, g.wiz[1].z]);
        await guest.keyboard.down('w');
        await guest.waitForTimeout(600);
        const g1 = await state(guest, g => [g.wiz[1].x, g.wiz[1].z]);
        await guest.keyboard.up('w');
        expect(Math.hypot(g1[0] - g0[0], g1[1] - g0[1]) > 1.5, 'a guest moves straight away', JSON.stringify(g1));
        await host.waitForTimeout(500);
        const h1 = await state(host, g => [g.wiz[1].x, g.wiz[1].z]);
        expect(Math.hypot(h1[0] - h0[0], h1[1] - h0[1]) > 1.5, 'and the host sees it', JSON.stringify(h1));
        await guest.waitForTimeout(300);
        const settled = await state(guest, g => [g.wiz[1].x, g.wiz[1].z]);
        expect(Math.hypot(settled[0] - h1[0], settled[1] - h1[1]) < 1.2, 'and they end up agreeing where it is', JSON.stringify([settled, h1]));

        // the guest's own ink is the guest's, and it reads the same whatever the wire does
        await crossFire(host, guest, 'over the direct link');
        await host.screenshot({ path: SHOTS + '/wz-duel-host.png' });
        await guest.screenshot({ path: SHOTS + '/wz-duel-guest.png' });

        // ---- the line going quiet, and coming back ----
        const running = await tick(host);
        // a guest still talking is itself proof of life, so gag it first
        await guest.evaluate(() => {
            const s = WZ_ENGINE.state().session;
            s.__toHost = s.sendToHost; s.__hello = s.announceProfile;
            s.sendToHost = () => { }; s.announceProfile = () => { };
        });
        await guest.waitForTimeout(120);
        await host.evaluate(() => WZ_ENGINE.state().session.emit('net:down', 'quiet'));
        await host.waitForTimeout(250);
        const frozenAt = await tick(host);
        await host.waitForTimeout(400);
        expect(await state(host, g => g.netDown) && await tick(host) === frozenAt, 'when the line goes quiet the match freezes', running + ' then ' + frozenAt);
        expect(await host.locator('.wz-dialog').count() === 1, 'and says why');
        await guest.evaluate(() => {
            const s = WZ_ENGINE.state().session;
            s.sendToHost = s.__toHost; s.announceProfile = s.__hello;
        });
        await Promise.all([host, guest].map(p => p.evaluate(() => WZ_ENGINE.state().session.emit('net:up'))));
        await host.waitForFunction(t => WZ_ENGINE.state().s.tick > t + 5, frozenAt, { timeout: 5000 });
        expect(!(await state(host, g => g.netDown)), 'and carries on from there when it comes back');

        // ---- a rematch across the wire ----
        await host.evaluate(() => { WZ_SIM.command(WZ_ENGINE.state().s, 1, { c: 'resign' }); });
        await guest.waitForSelector('.wz-end', { timeout: 8000 });
        await guest.waitForSelector('#wz-rematch-ask', { timeout: 3000 });
        expect(/YOU LOSE/.test(await guest.textContent('.wz-end')), 'the guest hears how it ended');
        await guest.click('#wz-rematch-ask');
        await host.waitForFunction(() => WZ_ENGINE.state().theyWantRematch, null, { timeout: 8000 });
        expect(true, 'and can ask for another');
        await host.click('#wz-rematch');
        await guest.waitForFunction(() => { const g = WZ_ENGINE.state(); return g.s.match === 2 && !g.ended; }, null, { timeout: 8000 });
        await guest.waitForFunction(() => document.querySelector('.wz-end') === null, null, { timeout: 4000 });
        expect(true, 'and a rematch reaches both');
        await Promise.all([live(host), live(guest)]);
        await takeMouse(guest);
        await inkDraw(guest, ZBOLT);
        const reload = await host.waitForFunction(() => { const c = WZ_ENGINE.state().wiz[1].chamber; return c && c.s === 'spark'; }, null, { timeout: 8000 }).then(() => true, () => false);
        expect(reload, 'and a guest\'s orders count in the new one, numbered from the start again');
        await host.close();
        await guest.waitForFunction(() => WZ_ENGINE.state().netDown, null, { timeout: 15000 });
        expect(true, 'a guest whose host vanished is told');
        await guest.waitForSelector('.wz-dialog [data-go="quit"]', { timeout: 4000 });
        await guest.click('.wz-dialog [data-go="quit"]');
        await guest.waitForSelector('#wz-solo', { timeout: 4000 });
        expect(true, 'and can leave');
        await guest.close();
    }

    // ===================================================================
    section('a direct link dying mid-match');
    // ===================================================================
    {
        const host = await open(ctx);
        const code = await hostLobby(host);
        const guest = await open(ctx);
        await joinLobby(guest, code);
        await startMatch(host, guest);
        expect(await kind(guest) === 'peer', 'the match starts direct');
        const seen = await state(host, g => g.s.tick);
        await guest.evaluate(() => window.__cutDirect());
        await guest.waitForFunction(() => WZ_ENGINE.state().session.transport.kind === 'bus', null, { timeout: 10000 }).catch(() => { });
        expect(await kind(guest) === 'bus', 'the guest moves to the relays');
        await host.waitForFunction(() => WZ_ENGINE.state().session.transport.kind === 'bus', null, { timeout: 10000 }).catch(() => { });
        expect(await kind(host) === 'bus', 'and the host follows');
        await host.waitForTimeout(1500);
        const down = await Promise.all([host, guest].map(p => state(p, g => g.netDown)));
        expect(down.every(d => !d), 'nobody gets told the other one walked out', JSON.stringify(down));
        expect(await tick(host) > seen + 20, 'and the match never stopped');
        await crossFire(host, guest, 'on the relays, after the move');
        await guest.close();
        const gone = await host.waitForFunction(() => WZ_ENGINE.state().netDown, null, { timeout: 15000 }).then(() => true, () => false);
        expect(gone, 'the host notices when the guest walks out');
        const frozenAt = await tick(host);
        await host.waitForTimeout(400);
        expect(await tick(host) === frozenAt, 'and it freezes rather than beating an empty seat');
        await host.close();
    }

    // ===================================================================
    section('no direct route at all');
    // ===================================================================
    {
        const host = await open(ctx);
        await host.evaluate(() => localStorage.setItem('test-direct', 'noroute'));
        const code = await hostLobby(host);
        const guest = await open(ctx);
        await joinLobby(guest, code);
        await startMatch(host, guest);
        expect(await kind(host) === 'bus' && await kind(guest) === 'bus', 'the match runs on the relays', await kind(host));
        await crossFire(host, guest, 'through the relays');
        await host.screenshot({ path: SHOTS + '/wz-duel-relay.png' });

        // what it costs: every byte on the wire, while both of them are shooting
        const meter = async p => {
            const b = { sent: 0, got: 0, on: false, frames: 0 };
            const cdp = await p.context().newCDPSession(p);
            await cdp.send('Network.enable');
            cdp.on('Network.webSocketFrameSent', e => { if (b.on) { b.sent += e.response.payloadData.length; b.frames++; } });
            cdp.on('Network.webSocketFrameReceived', e => { if (b.on) b.got += e.response.payloadData.length; });
            return b;
        };
        const hm = await meter(host), gm = await meter(guest);
        const busy = `(function () {
            window.__busy = setInterval(() => {
                const g = WZ_ENGINE.state(), S = WZ_SIM;
                const me = g.wiz[g.me], foe = g.wiz[1 - g.me];
                const p = { x: me.x, y: me.y, z: me.z, yaw: g.yaw, pitch: g.pitch, aim: false };
                for (let k = 0; k < 3; k++) { const c = S.camera(g.s, p); p.yaw = Math.atan2(foe.x - c.x, -(foe.z - c.z)); p.pitch = Math.atan2(foe.y + 1 - c.y, Math.hypot(foe.x - c.x, foe.z - c.z)); }
                g.yaw = p.yaw; g.pitch = p.pitch;
                g.keys = { w: Math.sin(g.s.t) > 0, s: Math.sin(g.s.t) <= 0, d: Math.cos(g.s.t * 1.3) > 0, a: Math.cos(g.s.t * 1.3) <= 0 };
                g.wantFire = true;
                me.hp = 100; foe.hp = 100;
            }, 100);
        })()`;
        await host.evaluate(busy);
        await guest.evaluate(busy);
        await host.waitForTimeout(1500);
        const seconds = 20;
        hm.on = gm.on = true;
        await host.waitForTimeout(seconds * 1000);
        hm.on = gm.on = false;
        await host.evaluate(() => clearInterval(window.__busy));
        await guest.evaluate(() => clearInterval(window.__busy));
        const perMin = n => n * 60 / seconds / 1048576;
        // one test relay here. The real thing posts to four, and the guide says 3MB a minute
        const hostFour = perMin(hm.sent) * 4, guestFour = perMin(gm.sent) * 4;
        console.log('        over one relay: host ' + perMin(hm.sent).toFixed(2) + 'MB a minute, guest ' + perMin(gm.sent).toFixed(2) + 'MB, in ' + hm.frames + ' and ' + gm.frames + ' frames in ' + seconds + 's');
        expect(hostFour <= 3, 'a fight over the relays costs the host what the guide says', hostFour.toFixed(2) + 'MB a minute over four');
        expect(guestFour <= 2.5, 'and the guest', guestFour.toFixed(2) + 'MB a minute over four');
        expect(hm.frames / seconds <= 12 && gm.frames / seconds <= 12, 'and neither of them is rude to the relay', (hm.frames / seconds).toFixed(1) + ' and ' + (gm.frames / seconds).toFixed(1) + ' events a second');
        await guest.evaluate(() => localStorage.removeItem('test-direct'));
        await host.close();
        await guest.close();
    }
    await ctx.close();

    section('page errors');
    expect(!errors.length, 'nothing threw the whole way through', [...new Set(errors)].slice(0, 6).join('\n        '));
} catch (e) {
    expect(false, 'the run fell over', String(e.stack || e.message).split('\n').slice(0, 6).join('\n        '));
} finally {
    await browser.close();
    relay.kill();
}
console.log('\n' + (failures ? failures + ' of ' + checks + ' browser checks FAILED' : 'all ' + checks + ' browser checks passed'));
process.exit(failures ? 1 : 0);
