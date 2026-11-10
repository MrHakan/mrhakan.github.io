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
//   WZ_ONLY_MAPS=1 runs the same map checks without the rest of the suite.
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

async function checkEveryMap() {
    section('every map');
    const ctx = await context({ viewport: { width: 1280, height: 860 } });
    const p = await open(ctx);
    await p.evaluate(() => openWizardz());
    await p.waitForSelector('#wz-mappick', { timeout: 30000 });
    const maps = await p.evaluate(() => WZ.MAPS.map(m => m.id));
    expect(maps.length >= 4, 'the menu has maps to pick from', maps.join(', '));
    for (const map of maps) {
        await p.evaluate(() => startWizardz());
        await p.waitForSelector('#wz-mappick', { timeout: 5000 });
        await p.selectOption('#wz-modepick', '2');
        await p.selectOption('#wz-mappick', map);
        expect((await p.textContent('#wz-mapnote')).length > 20, map + ': the menu says what it is like');
        await p.click('#wz-quick');
        await p.waitForSelector('#wz-canvas', { timeout: 10000 });
        await live(p);
        const start = await state(p, g => ({ map: g.map, seats: g.wiz.length, at: g.wiz.map(w => [w.x, w.z]), st: g.R.stats(), mode: g.mode }));
        expect(start.map === map && start.seats === 4 && start.mode === 2, map + ': the menu got you the map and the size you asked for', JSON.stringify({ map: start.map, seats: start.seats }));
        expect(start.st.triangles > 800 && start.st.triangles < 16000, map + ': it draws', start.st.triangles + ' triangles');
        await p.evaluate(() => { WZ_ENGINE.state().speed = 4; });
        await p.waitForFunction(() => { const g = WZ_ENGINE.state(); return g.s.t > 9 && (g.ents.length > 0 || g.wiz.some(w => w.hp < 100) || g.s.t > 25); }, null, { timeout: 30000 });
        await p.evaluate(() => { WZ_ENGINE.state().speed = 1; });
        const later = await state(p, g => ({ at: g.wiz.map(w => [w.x, w.z]), t: g.s.t }));
        const moved = later.at.filter((q, i) => i !== 0 && Math.hypot(q[0] - start.at[i][0], q[1] - start.at[i][1]) > 2).length;
        expect(moved >= 2, map + ': the bots get moving', moved + ' of 3 moved in ' + Math.round(later.t) + 's');

        // A hostile stun correctly cancels drawing. After proving the bots act,
        // exercise real input in a fresh round without random attacks in flight.
        await p.evaluate(map => {
            startWizardz('solo', 'cinder', { mode: 2, map, seed: 711 });
            WZ_ENGINE.state().brains = {};
        }, map);
        await live(p);
        await takeMouse(p);
        const before = await state(p, g => ({ x: g.wiz[g.me].x, z: g.wiz[g.me].z }));
        await p.keyboard.down('w');
        const walked = await p.waitForFunction(before => {
            const g = WZ_ENGINE.state(), me = g.wiz[g.me];
            return Math.hypot(me.x - before.x, me.z - before.z) > 0.2;
        }, before, { timeout: 8000 }).then(() => true, () => false);
        await p.keyboard.up('w');
        expect(walked, map + ': real movement input changes the player position');
        await inkDraw(p, TRIANGLE);
        const drawn = await p.waitForFunction(() => {
            const g = WZ_ENGINE.state();
            return g.wiz[g.me].chamber?.s === 'fireball' && g.lastRead?.ok && g.lastRead.id === 'fireball';
        }, null, { timeout: 5000 }).then(() => true, () => false);
        const detail = await state(p, g => ({ chamber: g.wiz[g.me].chamber?.s, dead: g.wiz[g.me].dead, read: g.lastRead && { id: g.lastRead.id, ok: g.lastRead.ok, why: g.lastRead.why }, hint: g.hint?.text }));
        expect(drawn, map + ': the real drawing loads a fireball', JSON.stringify(detail));
        await p.screenshot({ path: SHOTS + '/wz-map-' + map + '.png' });
    }
    await p.close(); await ctx.close();
}

// a person who knows what the buttons do, at whatever speed the clock is on. The
// aiming is written in, and the drawing goes through the real reading of the ink.
const PLAY = `(function () {
    window.__autoT = setInterval(() => {
        const g = WZ_ENGINE.state();
        if (!g || g.ended || g.paused) return;
        const S = WZ_SIM, D = WZ;
        const me = g.wiz[g.me];
        const foe = g.wiz.filter(w => w.team !== me.team && !w.dead).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0] || g.wiz[1 - g.me];
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
    if (process.env.WZ_ONLY_MAPS) {
        await checkEveryMap();
    } else {
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

        // the loadout window, on a thumb
        await p.evaluate(() => { startWizardz(); window.wizardzLoadout(); });
        await p.waitForSelector('.wz-preset', { timeout: 5000 });
        const lw = await p.evaluate(() => {
            const w = document.querySelector('.wz-book').closest('.app-window').getBoundingClientRect(), b = document.querySelector('#wz-load-id').getBoundingClientRect();
            return { left: w.left, right: w.right, boxh: b.height, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
        });
        expect(lw.right <= lw.vw + 1 && lw.left >= -1 && lw.sw <= lw.vw + 1, 'the loadout window fits a phone', JSON.stringify(lw));
        await p.screenshot({ path: SHOTS + '/wz-phone-loadouts.png' });
        await p.locator('.wz-preset').nth(4).tap();
        expect(await p.evaluate(() => WZ_ENGINE.myLoadout().join() === WZ.PRESETS[4].sigils.join()), 'and a thumb can pick one');
        await p.evaluate(() => { document.querySelector('.wz-book').closest('.app-window').querySelector('.ie-titlebar-btn[title="close"]').click(); });

        // the front door, with its two new boxes, and eight wizards on a small screen
        await p.evaluate(() => startWizardz());
        await p.waitForSelector('#wz-mappick', { timeout: 5000 });
        await p.locator('#wz-mappick').scrollIntoViewIfNeeded();
        const picks = await p.evaluate(() => {
            const b = q => { const r = document.querySelector(q).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height }; };
            return { mode: b('#wz-modepick'), map: b('#wz-mappick'), note: b('#wz-mapnote'), vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth };
        });
        expect(picks.map.r <= picks.vw + 1 && picks.map.b <= picks.vh + 1 && picks.map.t >= 0 && picks.sw <= picks.vw + 1, 'the map box can be got at on a phone', JSON.stringify(picks.map));
        expect(picks.mode.h >= 28 && picks.map.h >= 28, 'and they are big enough for a thumb', picks.mode.h + ' and ' + picks.map.h);
        await p.screenshot({ path: SHOTS + '/wz-phone-menu.png' });
        await p.evaluate(() => startWizardz('solo', 'cinder', { mode: 4, map: 'bin' }));
        await p.waitForFunction(() => { const g = WZ_ENGINE.state(); return g && g.wiz.length === 8 && g.phase === 'live'; }, null, { timeout: 15000 });
        await p.waitForTimeout(2500);
        const small = await state(p, g => ({ n: g.wiz.length, t: g.s.t, tris: g.R.stats().triangles, fps: g.lastFps }));
        expect(small.n === 8, 'a 4 v 4 plays on a phone', JSON.stringify(small));
        await p.screenshot({ path: SHOTS + '/wz-phone-4v4.png' });
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
    section('loadout ids');
    // ===================================================================
    {
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        const p = await open(ctx);
        await p.evaluate(() => { localStorage.removeItem('mrhakan98-wizardz-loadout'); openWizardz(); });
        await p.waitForSelector('#wz-loid', { timeout: 30000 });
        const presets = await p.evaluate(() => WZ.PRESETS.map(x => ({ id: x.id, name: x.name, code: x.code, sigils: x.sigils })));
        const carrying = () => p.evaluate(() => WZ_ENGINE.myLoadout().join());
        const strip = () => p.evaluate(() => Array.from(document.querySelectorAll('#wz-mini-strip canvas')).map(c => c.dataset.sigil).join());
        const standard = await p.evaluate(() => WZ.DEFAULT_LOADOUT.join());
        expect(await p.inputValue('#wz-loid') === await p.evaluate(() => WZ.loadoutToId(WZ.DEFAULT_LOADOUT)), 'the menu shows the id of what you are carrying');

        // typed by a person: nothing happens, nothing happens, then it has happened
        const typed = presets[3];
        await p.click('#wz-loid');
        await p.keyboard.press('Control+A');
        await p.keyboard.type(typed.code.replace(/-/g, '').slice(0, 11).toLowerCase());
        expect(await carrying() === standard, 'eleven characters in, nothing has changed', await p.textContent('#wz-lomsg'));
        expect(!(await p.getAttribute('#wz-lomsg', 'class')).includes('wz-bad'), 'and nobody is being told off for typing');
        await p.keyboard.type(typed.code.slice(-1).toLowerCase());
        expect(await carrying() === typed.sigils.join(), 'the twelfth character loads it, with nothing else pressed', await p.textContent('#wz-lomsg'));
        expect(await strip() === typed.sigils.join(), 'and the sigils on the menu change with it');
        expect(await p.inputValue('#wz-loid') === typed.code, 'and it tidies what you typed', await p.inputValue('#wz-loid'));
        expect((await p.textContent('#wz-lomsg')).includes(typed.name), 'and says which one that was', await p.textContent('#wz-lomsg'));

        // all ten
        const failed = [];
        for (const x of presets) {
            await p.fill('#wz-loid', x.code);
            if (await carrying() !== x.sigils.join() || await strip() !== x.sigils.join()) failed.push(x.id);
        }
        expect(!failed.length, 'all ten ids load, each as its own eight', failed.join(', '));
        expect(new Set(presets.map(x => x.sigils.join())).size === 10, 'and they are ten different eights');

        // and what is not an id
        const held = presets[0];
        await p.fill('#wz-loid', held.code);
        const bad = [['nope', 'chars-or-short'], ['8044-1NS8-WKE0', 'check'], ['8044-1NS8-WKEYY', 'long'], ['UUUU-UUUU-UUUU', 'chars'], ['<b>!</b>', 'chars']];
        for (const [x] of bad) {
            await p.fill('#wz-loid', x);
            await p.keyboard.press('Enter');
            const msg = await p.textContent('#wz-lomsg');
            expect(await carrying() === held.sigils.join() && msg.length > 10 && (await p.getAttribute('#wz-lomsg', 'class')).includes('wz-bad'), 'a bad id leaves you with what you had, and says why: ' + x, msg);
        }
        await p.fill('#wz-loid', '8044');
        await p.keyboard.press('Tab');
        expect(/too short/.test(await p.textContent('#wz-lomsg')), 'half an id gets told so when you leave it', await p.textContent('#wz-lomsg'));
        expect(await p.evaluate(() => document.querySelector('#wz-lomsg').children.length === 0), 'nothing typed in there ends up as markup');

        // the window with the choosing in it
        await p.click('#wz-load2');
        await p.waitForSelector('.wz-preset', { timeout: 4000 });
        expect(await p.locator('.wz-preset').count() === 10, 'the loadout window offers the ten');
        const shown = await p.evaluate(() => Array.from(document.querySelectorAll('.wz-preset')).every(b => b.querySelectorAll('canvas').length === 8 && /[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/.test(b.textContent)));
        expect(shown, 'each with its sigils and its id');
        await p.screenshot({ path: SHOTS + '/wz-loadouts.png' });
        await p.click('[data-preset="' + presets[5].id + '"]');
        expect(await carrying() === presets[5].sigils.join(), 'clicking one loads it, no questions');
        expect(await p.inputValue('#wz-load-id') === presets[5].code, 'and its id is in the box');
        expect(await p.inputValue('#wz-loid') === presets[5].code, 'and on the menu behind it');
        // building your own: slot one, then a spell nobody in that preset has
        const swap = await p.evaluate(p5 => WZ.SPELLS.find(s => !p5.includes(s.id)).id, presets[5].sigils);
        await p.click('[data-slot="0"]');
        await p.click('#wz-all [data-id="' + swap + '"]');
        const own = await p.evaluate(() => WZ_ENGINE.myLoadout());
        expect(own[0] === swap && own.length === 8 && new Set(own).size === 8, 'you can still build your own', own.join(', '));
        const ownId = await p.inputValue('#wz-load-id');
        expect(ownId !== presets[5].code && await p.evaluate(([id, l]) => WZ.loadoutFromId(id).list.join() === l.join(), [ownId, own]), 'and it gets an id of its own', ownId);
        await p.evaluate(() => { navigator.clipboard = undefined; });
        await p.click('#wz-load-copy');
        expect((await p.textContent('#wz-load-msg')).includes(ownId), 'and there is a way of getting it out', await p.textContent('#wz-load-msg'));
        await p.fill('#wz-load-id', presets[8].code);
        expect(await carrying() === presets[8].sigils.join(), 'and an id typed in this window loads at once too');
        expect(await p.evaluate(c => document.querySelector('.wz-preset.on .wz-preset-code').textContent === c, presets[8].code), 'and lights up the one it is');
        await p.reload({ waitUntil: 'load' });
        expect(await p.evaluate(() => JSON.parse(localStorage.getItem('mrhakan98-wizardz-loadout')).length === 8), 'it is saved the way loadouts always were');

        // what you loaded is what you play with
        await p.evaluate(() => openWizardz('solo'));
        await p.waitForFunction(() => window.WZ_ENGINE && WZ_ENGINE.state(), null, { timeout: 30000 });
        await p.evaluate(() => startWizardz('solo', 'cinder', { mode: 4, map: 'temple' }));
        await p.waitForFunction(() => { const g = WZ_ENGINE.state(); return g && g.wiz.length === 8; }, null, { timeout: 8000 });
        await live(p);
        const inMatch = await state(p, g => ({ book: g.loadout.join(), seat: g.wiz[g.me].loadout.join(), bots: g.seats.filter(x => x.bot).map(x => x.loadout.join()) }));
        expect(inMatch.book === presets[8].sigils.join() && inMatch.seat === inMatch.book, 'the match gives you what you loaded');
        const legal = await p.evaluate(ls => ls.every(l => !WZ.loadoutProblem(l.split(','))), inMatch.bots);
        expect(legal, 'and every bot is carrying a legal eight');
        const botsOnPresets = await p.evaluate(() => {
            let seen = 0;
            for (let k = 0; k < 8; k++) {
                startWizardz('solo', 'cinder', { mode: 4, map: 'temple' });
                const g = WZ_ENGINE.state();
                seen += g.seats.filter(x => x.bot && WZ.PRESETS.some(q => q.sigils.join() === x.loadout.join())).length;
            }
            return seen;
        });
        expect(botsOnPresets >= 8, 'and the bots do turn up with the ready made ones', botsOnPresets + ' of 56 seats');
        await live(p);
        const inBrain = await state(p, g => Object.keys(g.brains).every(i => g.brains[i].loadout.map(x => x.id).join() === g.wiz[i].loadout.join()));
        expect(inBrain, 'and that is what they actually think with');

        // changing it in the middle of a match waits for the next one
        const before = await state(p, g => g.loadout.join());
        await p.evaluate(() => { window.wizardzLoadout(); });
        await p.waitForSelector('#wz-load-id', { timeout: 4000 });
        await p.fill('#wz-load-id', presets[1].code);
        expect(/next match/.test(await p.textContent('#wz-load-msg')), 'loading one mid match says when it counts', await p.textContent('#wz-load-msg'));
        expect(await state(p, g => g.loadout.join()) === before, 'and the match you are in does not change');
        await p.evaluate(() => { document.querySelector('.wz-book').closest('.app-window').querySelector('.ie-titlebar-btn[title="close"]').click(); });
        await p.evaluate(() => { const g = WZ_ENGINE.state(); g.paused = false; WZ_SIM.command(g.s, g.me, { c: 'resign' }); });
        await p.waitForSelector('#wz-rematch', { timeout: 8000 });
        await p.click('#wz-rematch');
        await p.waitForFunction(() => { const g = WZ_ENGINE.state(); return !g.ended && g.s.over === null; }, null, { timeout: 4000 });
        expect(await state(p, g => g.loadout.join() === g.wiz[g.me].loadout.join() && g.loadout.join()) === presets[1].sigils.join(), 'the rematch does');
        await p.close();
        await ctx.close();
    }

    await checkEveryMap();

    // ===================================================================
    section('4 v 4 against bots, to the end');
    // ===================================================================
    {
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        const p = await open(ctx);
        await p.evaluate(() => openWizardz('solo'));
        await p.waitForFunction(() => window.WZ_ENGINE && WZ_ENGINE.state(), null, { timeout: 30000 });
        await p.evaluate(() => startWizardz('solo', 'cinder', { mode: 4, map: 'temple' }));
        await p.waitForFunction(() => { const g = WZ_ENGINE.state(); return g && g.wiz.length === 8; }, null, { timeout: 8000 });
        await live(p);
        const seats = await state(p, g => ({
            n: g.wiz.length, teams: g.wiz.map(w => w.team).join(''), me: g.me, bots: g.wiz.filter(w => w.bot).length,
            brains: Object.keys(g.brains).length, names: new Set(g.wiz.map(w => w.name)).size, goal: g.s.koGoal
        }));
        expect(seats.n === 8 && seats.teams === '01010101', 'eight seats, four a side', JSON.stringify(seats));
        expect(seats.bots === 7 && seats.brains === 7, 'and bots in all of them but yours', seats.bots + ' bots');
        expect(seats.names === 8, 'none of them with the same name', seats.names + ' names');
        expect(seats.goal === 12, 'first to twelve', String(seats.goal));
        // what eight of them cost, at the speed a person plays
        await p.waitForTimeout(4000);
        const cost = await state(p, g => ({ ms: g.lastMs, max: g.lastMax, st: g.R.stats(), fps: g.lastFps }));
        console.log('        4 v 4 here: ' + Math.round(cost.fps) + 'fps, ' + cost.ms.toFixed(2) + 'ms of javascript a frame, ' + cost.max.toFixed(1) + 'ms at worst, ' + cost.st.drawCalls + ' draw calls, ' + cost.st.triangles + ' triangles');
        expect(cost.ms < 6, 'eight wizards do not hurt the frame rate', cost.ms.toFixed(2) + 'ms of javascript a frame');
        expect(cost.st.drawCalls < 200, 'or the draw calls', String(cost.st.drawCalls));
        await p.screenshot({ path: SHOTS + '/wz-4v4.png' });
        await p.evaluate(() => { WZ_ENGINE.state().speed = 6; });
        await p.evaluate(PLAY);
        await p.waitForFunction(() => WZ_ENGINE.state().ended, null, { timeout: 200000, polling: 500 });
        await p.evaluate(() => clearInterval(window.__autoT));
        const end = await state(p, g => ({ over: g.over, reason: g.reason, score: g.wins, t: g.s.t, team: g.myTeam, feed: g.feed.length }));
        expect(end.over === 0 || end.over === 1, 'it gets to an end', JSON.stringify(end));
        expect(end.reason !== 'ko' || Math.max(...end.score) === 12, 'and a knockout win took twelve', end.score.join('-'));
        console.log('        ' + (end.over === end.team ? 'won ' : 'lost ') + end.score.join('-') + ' in ' + Math.round(end.t) + 's of game time, by ' + end.reason);
        await p.waitForSelector('.wz-end', { timeout: 4000 });
        expect(/your side \d+ - \d+ their side/.test(await p.textContent('.wz-end')), 'and the end says how the sides did');
        await p.screenshot({ path: SHOTS + '/wz-4v4-end.png' });
        await p.click('#wz-rematch');
        await p.waitForFunction(() => { const g = WZ_ENGINE.state(); return g.phase === 'countdown' && !g.ended; }, null, { timeout: 4000 });
        const again = await state(p, g => ({ n: g.wiz.length, brains: Object.keys(g.brains).length, map: g.s.map, score: g.wins }));
        expect(again.n === 8 && again.brains === 7 && again.map === 'temple' && again.score[0] === 0, 'a rematch is the same match again', JSON.stringify(again));
        await p.close();
        await ctx.close();
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
    section('2 v 2: two people, and bots in the other seats');
    // ===================================================================
    {
        const host = await open(ctx);
        const code = await hostLobby(host);
        const guest = await open(ctx);
        await joinLobby(guest, code);
        await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
        // the host picks. The guest gets told
        await host.waitForSelector('[data-opt="mode"]', { timeout: 8000 });
        await host.selectOption('[data-opt="mode"]', '2');
        await host.selectOption('[data-opt="map"]', 'wire');
        await guest.waitForFunction(() => { const b = document.querySelector('[data-optshow="map"]'); return b && /long wire/.test(b.textContent); }, null, { timeout: 8000 });
        expect(/2 v 2/.test(await guest.textContent('[data-optshow="mode"]')), 'the host picks the size and the map, and the guest sees it');
        expect(await guest.locator('[data-opt="map"]').count() === 0, 'and only the host can');
        await guest.waitForSelector('.np-team1', { timeout: 4000 });
        await host.screenshot({ path: SHOTS + '/wz-lobby.png' });
        await startMatch(host, guest);
        const seats = p => state(p, g => g.wiz.map(w => w.name + ':' + w.team + ':' + (w.bot ? 'b' : 'h')).join(','));
        const [ha, ga] = [await seats(host), await seats(guest)];
        expect(ha === ga, 'both screens agree who is sitting where', ha);
        const hs = await state(host, g => ({ n: g.wiz.length, map: g.s.map, me: g.me, team: g.myTeam, brains: Object.keys(g.brains).length }));
        const gs = await state(guest, g => ({ n: g.wiz.length, map: g.s.map, me: g.me, team: g.myTeam, brains: Object.keys(g.brains).length }));
        expect(hs.n === 4 && gs.n === 4 && hs.map === 'wire' && gs.map === 'wire', 'four seats, on the map the host picked', JSON.stringify([hs, gs]));
        expect(hs.team !== gs.team, 'on opposite sides, until somebody says otherwise');
        expect(hs.brains === 2 && gs.brains === 0, 'and the bots only run on the host', hs.brains + ' and ' + gs.brains);
        // the bots' shots, walking about, all of it arrives
        const before = await state(guest, g => g.wiz.filter(w => w.bot).map(w => [w.x, w.z]));
        await guest.waitForTimeout(2500);
        const after = await state(guest, g => g.wiz.filter(w => w.bot).map(w => [w.x, w.z]));
        expect(after.some((q, i) => Math.hypot(q[0] - before[i][0], q[1] - before[i][1]) > 2), 'a guest sees the bots moving');
        // stop the bots to hear ourselves think, and see whose shots hurt whom
        await host.evaluate(() => {
            const g = WZ_ENGINE.state(), L = WZ_SIM.LAYOUT;
            g.brains = {};
            g.wiz.slice(2).forEach(w => { const q = L.spawns[w.team][3]; w.x = q[0]; w.z = q[1]; w.y = WZ_SIM.heightAt(q[0], q[1]); });
        });
        await crossFire(host, guest, 'in a 2 v 2');
        await host.screenshot({ path: SHOTS + '/wz-2v2-host.png' });
        await guest.screenshot({ path: SHOTS + '/wz-2v2-guest.png' });
        // somebody walks out
        await guest.close();
        const taken = await host.waitForFunction(() => Object.keys(WZ_ENGINE.state().brains).length === 1, null, { timeout: 20000 }).then(() => true, () => false);
        expect(taken, 'when a guest walks out, a bot sits down in their seat');
        const seat = await state(host, g => ({ down: g.netDown, seat: +Object.keys(g.brains)[0], hint: g.hint && g.hint.text, t: g.s.tick }));
        expect(!seat.down, 'and the match does not stop for it', JSON.stringify(seat));
        await host.waitForTimeout(1500);
        expect(await tick(host) > seat.t + 15, 'it carries on');
        const walked = await state(host, (g, seat) => g.s.input[seat].mx || g.s.input[seat].mz || 0, seat.seat);
        expect(walked !== 0, 'with the bot actually playing');
        await host.close();
    }

    // ===================================================================
    section('loadouts, online');
    // ===================================================================
    {
        const host = await open(ctx);
        const code = await hostLobby(host);
        const guest = await open(ctx);
        await joinLobby(guest, code);
        await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
        // both tabs share a save, so the host's sees the standard eight whatever the guest picks
        await host.evaluate(() => {
            const real = Storage.prototype.getItem;
            Storage.prototype.getItem = function (k) { return k === 'mrhakan98-wizardz-loadout' ? null : real.call(this, k); };
        });
        await guest.waitForSelector('#np-loadout2', { timeout: 8000 });
        await guest.click('#np-loadout2');
        await guest.waitForSelector('#wz-load-id', { timeout: 8000 });
        const quarry = await guest.evaluate(() => WZ.PRESETS.find(p => p.id === 'quarry'));
        await guest.fill('#wz-load-id', quarry.code);
        expect(await guest.evaluate(() => WZ_ENGINE.myLoadout().join()) === quarry.sigils.join(), 'a guest can type an id from the lobby');
        await guest.evaluate(() => { document.querySelector('.wz-book').closest('.app-window').querySelector('.ie-titlebar-btn[title="close"]').click(); });
        await startMatch(host, guest);
        await guest.waitForFunction(() => WZ_ENGINE.state().loadoutHeard, null, { timeout: 8000 });
        const told = await state(host, g => ({ held: g.wiz[1].loadout.join(), mine: g.wiz[0].loadout.join() }));
        expect(told.held === quarry.sigils.join(), 'the host ends up holding the eight the guest brought', told.held);
        expect(told.mine === await host.evaluate(() => WZ.DEFAULT_LOADOUT.join()), 'and keeps its own');
        expect(await state(guest, g => g.loadout.join()) === quarry.sigils.join(), 'and the guest draws from them');

        // ---- a guest with their own idea of the rules: send what a cheat would send ----
        await faceOff(host, [guest]);
        await host.evaluate(() => { WZ_ENGINE.state().brains = {}; });
        const cast = (spell, n) => guest.evaluate(([spell, n]) => {
            const g = WZ_ENGINE.state();
            g.session.sendToHost('wz:i', { q: 0, m: g.s.match, c: [[n, 0, WZ.SPELLS.findIndex(s => s.id === spell), 0.95]] });
        }, [spell, n]);
        const foreign = await guest.evaluate(q => WZ.SPELLS.find(s => !q.includes(s.id) && s.kind === 'shot').id, quarry.sigils);
        const inkBefore = await state(host, g => g.wiz[1].ink);
        await cast(foreign, 90001);
        const denied = await guest.waitForFunction(() => { const h = WZ_ENGINE.state().hint; return h && /not one of your eight/.test(h.text); }, null, { timeout: 8000 }).then(() => true, () => false);
        expect(denied, 'casting a sigil that is not in your eight gets refused, and you get told');
        const after = await state(host, g => ({ c: g.wiz[1].chamber, ink: g.wiz[1].ink, k: g.s.tick }));
        expect(!(after.c && after.c.s === foreign) && after.ink >= inkBefore - 0.01, 'and nothing happens on the host', JSON.stringify(after));
        await cast('boulder', 90002);
        const carried = await host.waitForFunction(() => { const c = WZ_ENGINE.state().wiz[1].chamber; return c && c.s === 'boulder'; }, null, { timeout: 8000 }).then(() => true, () => false);
        expect(carried, 'while one that is in it goes through the same way');

        // a change of heart mid match, a list, a lie, and things that are not even ids
        await guest.evaluate(() => {
            const g = WZ_ENGINE.state(), other = WZ.PRESETS.find(p => p.id === 'abyss').code;
            for (const l of [other, WZ.SPELLS.map(s => s.id), 'nope', 12, null, { a: 1 }, 'x'.repeat(5000), ['fireball']]) g.session.sendToHost('wz:i', { q: 0, m: g.s.match, l });
        });
        await host.waitForTimeout(800);
        expect(await state(host, g => g.wiz[1].loadout.join()) === quarry.sigils.join(), 'a second loadout in the same match is not listened to');

        // what the host does with rubbish as the first thing it hears, by the handful
        const fuzz = await host.evaluate(() => {
            const g = WZ_ENGINE.state(), from = { id: g.wiz[1].id };
            const out = { threw: 0, illegal: 0, took: 0 };
            const rubbish = [undefined, null, 0, 1, true, {}, [], ['a'], { toString: 1 }, '', ' ', 'nope', '8044-1NS8-WKE0', 'UUUU-UUUU-UUUU', 'x'.repeat(100000), '0000-0000-0000', '__proto__', '🧙'.repeat(12)];
            const fakes = [{ m: g.s.match }, { m: g.s.match, c: 'x' }, { m: g.s.match, c: [[1e9, 0, 999, 1]] }, { m: g.s.match, c: [[1e9 + 1, 0, -1, 1]] }, { m: g.s.match, c: [['a']] }, 'text', 7, null];
            for (const l of rubbish) {
                if (g.ears[1]) delete g.ears[1].loadout;
                try {
                    WZ_ENGINE.hostInput(g, { m: g.s.match, l: l === undefined ? 'x' : l }, from);
                    if (WZ.loadoutProblem(g.wiz[1].loadout)) out.illegal++;
                    if (g.wiz[1].loadout.join() !== WZ.DEFAULT_LOADOUT.join()) out.took++;
                } catch (e) { out.threw++; }
            }
            for (const d of fakes) { try { WZ_ENGINE.hostInput(g, d, from); WZ_ENGINE.hostInput(g, d, { id: 'nobody' }); WZ_ENGINE.hostInput(g, d, null); } catch (e) { out.threw++; } }
            return out;
        });
        expect(fuzz.threw === 0, 'rubbish never knocks the host over', JSON.stringify(fuzz));
        expect(fuzz.took === 0 && fuzz.illegal === 0, 'and the seat gets the standard eight, never the rubbish', JSON.stringify(fuzz));
        const tickA = await tick(host);
        await host.waitForTimeout(800);
        expect(await tick(host) > tickA + 8, 'and the match is still going');
        await host.close();
        await guest.close();

        // a guest whose very first word is nonsense
        const h2 = await open(ctx);
        const code2 = await hostLobby(h2);
        const g2 = await open(ctx);
        await joinLobby(g2, code2);
        await h2.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
        await g2.evaluate(() => {
            const real = Storage.prototype.getItem;
            Storage.prototype.getItem = function (k) { return k === 'mrhakan98-wizardz-loadout' ? JSON.stringify(window.WZ_WANT) : real.call(this, k); };
            window.WZ_WANT = ['oblivion', 'meteor', 'bloodlance', 'boulder', 'flamelance', 'arcaneorb', 'singularity', 'inferno'];
        });
        await g2.waitForFunction(() => window.WZ && window.WZ_ENGINE, null, { timeout: 30000 });
        await g2.evaluate(() => { WZ.loadoutToId = () => '!!NOT-AN-ID!!'; });
        await startMatch(h2, g2);
        const heard = await g2.waitForFunction(() => WZ_ENGINE.state().loadoutHeard, null, { timeout: 10000 }).then(() => true, () => false);
        expect(heard, 'a guest with a broken id still hears back');
        const std = await h2.evaluate(() => WZ.DEFAULT_LOADOUT.join());
        expect(await state(h2, g => g.wiz[1].loadout.join()) === std, 'the host gives that seat the standard eight');
        const after2 = await state(g2, g => ({ book: g.loadout.join(), hint: g.hint && g.hint.text }));
        expect(after2.book === std, 'and so does the guest\'s own screen, so it draws what it can actually cast', after2.book);
        expect(/host would not take/.test(after2.hint || ''), 'and the guest gets told why', after2.hint);
        const tickB = await tick(h2);
        await h2.waitForTimeout(600);
        expect(await tick(h2) > tickB + 5, 'and the match goes ahead anyway');
        // the tabs share a save, and the rest of this file draws from the standard eight
        await h2.evaluate(() => localStorage.removeItem('mrhakan98-wizardz-loadout'));
        await h2.close();
        await g2.close();
    }

    // ===================================================================
    section('2 v 2 on the same side, against bots');
    // ===================================================================
    {
        const host = await open(ctx);
        const code = await hostLobby(host);
        const guest = await open(ctx);
        await joinLobby(guest, code);
        await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
        await guest.waitForSelector('#np-team', { timeout: 8000 });
        await guest.click('#np-team');
        await host.waitForFunction(() => document.querySelectorAll('.np-team0').length === 2, null, { timeout: 8000 });
        expect(true, 'switching sides reaches the host');
        await host.selectOption('[data-opt="mode"]', '2');
        await startMatch(host, guest);
        const [ht, gt] = [await state(host, g => g.myTeam), await state(guest, g => g.myTeam)];
        expect(ht === 0 && gt === 0, 'and the two of them start on one side', ht + ' and ' + gt);
        // no friendly fire across the wire either
        await host.evaluate(() => { const g = WZ_ENGINE.state(); g.brains = {}; const [a, , c] = g.wiz; a.x = 11; a.z = -8; a.y = 0; c.x = 11; c.z = -16; c.y = 0; a.safe = c.safe = 0; });
        await guest.waitForFunction(() => { const g = WZ_ENGINE.state(); return Math.abs(g.wiz[g.me].z + 16) < 3; }, null, { timeout: 15000 }).catch(() => { });
        await takeMouse(guest);
        await guest.evaluate(() => {
            const g = WZ_ENGINE.state(), S = WZ_SIM, me = g.wiz[g.me], ally = g.wiz.find(w => w.team === me.team && w !== me);
            const p = { x: me.x, y: me.y, z: me.z, yaw: g.yaw, pitch: g.pitch, aim: false };
            for (let k = 0; k < 6; k++) { const c = S.camera(g.s, p); p.yaw = Math.atan2(ally.x - c.x, -(ally.z - c.z)); p.pitch = Math.atan2(ally.y + 1 - c.y, Math.hypot(ally.x - c.x, ally.z - c.z)); }
            g.yaw = p.yaw; g.pitch = p.pitch;
        });
        await guest.mouse.down();
        await guest.waitForTimeout(700);
        await guest.mouse.up();
        await host.waitForTimeout(1000);
        const shots = await state(host, g => g.wiz[0].hp);
        expect(shots === 100, 'shooting your own side does nothing', String(shots));
        await host.close();
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
        await host.evaluate(() => { WZ_ENGINE.state().downAt -= 60000; });
        await host.waitForFunction(t => WZ_ENGINE.state().s.tick > t + 10, frozenAt, { timeout: 8000 });
        expect(await state(host, g => Object.keys(g.brains).length === 1 && !g.netDown), 'until a while later, when a bot sits down and you get your game');
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
                const me = g.wiz[g.me], foe = g.wiz.find(w => w.team !== me.team);
                const p = { x: me.x, y: me.y, z: me.z, yaw: g.yaw, pitch: g.pitch, aim: false };
                for (let k = 0; k < 3; k++) { const c = S.camera(g.s, p); p.yaw = Math.atan2(foe.x - c.x, -(foe.z - c.z)); p.pitch = Math.atan2(foe.y + 1 - c.y, Math.hypot(foe.x - c.x, foe.z - c.z)); }
                g.yaw = p.yaw; g.pitch = p.pitch;
                g.keys = { w: Math.sin(g.s.t) > 0, s: Math.sin(g.s.t) <= 0, d: Math.cos(g.s.t * 1.3) > 0, a: Math.cos(g.s.t * 1.3) <= 0 };
                g.wantFire = true;
                g.wiz.forEach(w => { w.hp = 100; });
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
        await host.close();
        await guest.close();

        // and with all eight seats. Six bots and two people, which is the usual 4 v 4
        {
            const h4 = await open(ctx);
            const code4 = await hostLobby(h4);
            const g4 = await open(ctx);
            await joinLobby(g4, code4);
            await h4.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
            await h4.selectOption('[data-opt="mode"]', '4');
            await startMatch(h4, g4);
            expect(await kind(h4) === 'bus' && await state(h4, g => g.wiz.length) === 8, 'a 4 v 4 starts on the relays');
            const hm4 = await meter(h4), gm4 = await meter(g4);
            await h4.waitForTimeout(6000);
            hm4.on = gm4.on = true;
            await h4.waitForTimeout(seconds * 1000);
            hm4.on = gm4.on = false;
            const hf = perMin(hm4.sent) * 4, gf = perMin(gm4.sent) * 4;
            console.log('        4 v 4 over one relay: host ' + perMin(hm4.sent).toFixed(2) + 'MB a minute, guest ' + perMin(gm4.sent).toFixed(2) + 'MB, in ' + hm4.frames + ' and ' + gm4.frames + ' frames in ' + seconds + 's. down: host ' + perMin(hm4.got).toFixed(2) + ', guest ' + perMin(gm4.got).toFixed(2));
            expect(hf <= 3, 'a 4 v 4 over the relays still costs the host what the guide says', hf.toFixed(2) + 'MB a minute over four');
            expect(gf <= 2.5, 'and the guest', gf.toFixed(2) + 'MB a minute over four');
            expect(hm4.frames / seconds <= 12, 'and it is not rude to the relay', (hm4.frames / seconds).toFixed(1) + ' events a second');
            expect(await state(g4, g => g.loadoutHeard), 'and the loadout got through the relays');
            const fresh = await g4.evaluate(() => { const g = WZ_ENGINE.state(); return { n: g.wiz.length, hp: g.wiz.map(w => Math.round(w.hp)), age: performance.now() - g.lastSnap }; });
            expect(fresh.age < 3000, 'and the guest is still hearing about it', Math.round(fresh.age) + 'ms since the last one');
            const [ah, ag] = [await hpOf(h4), await hpOf(g4)];
            expect(ah.filter((v, i) => Math.abs(v - ag[i]) <= 35).length >= 7, 'with both screens roughly agreeing', JSON.stringify([ah, ag]));
            await h4.close();
            await g4.close();
        }

        // Every seat a person, which nobody can do in CI: WZ_EIGHT=1 opens eight browsers
        if (process.env.WZ_EIGHT) {
            const pages = [await open(ctx)];
            const c8 = await hostLobby(pages[0]);
            for (let i = 1; i < 8; i++) { const q = await open(ctx); await joinLobby(q, c8); pages.push(q); }
            await pages[0].waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 8, null, { timeout: 60000 });
            await pages[0].selectOption('[data-opt="mode"]', '4');
            for (let i = 1; i < 8; i++) await pages[i].click('#np-ready');
            await pages[0].waitForTimeout(800);
            await pages[0].click('#np-ready');
            await pages[0].waitForTimeout(300);
            await pages[0].click('#np-start');
            await Promise.all(pages.map(p => p.waitForSelector('#wz-canvas', { timeout: 60000 })));
            await Promise.all(pages.map(p => live(p)));
            expect(await kind(pages[1]) === 'bus', 'eight people, on the relays');
            const ms = await Promise.all(pages.slice(0, 2).map(meter));
            for (const p of pages) await p.evaluate(busy);
            await pages[0].waitForTimeout(3000);
            ms.forEach(m => { m.on = true; });
            await pages[0].waitForTimeout(seconds * 1000);
            ms.forEach(m => { m.on = false; });
            const ages = await Promise.all(pages.slice(1).map(p => p.evaluate(() => Math.round(performance.now() - WZ_ENGINE.state().lastSnap))));
            console.log('        8 people over one relay: host up ' + perMin(ms[0].sent).toFixed(2) + ' down ' + perMin(ms[0].got).toFixed(2) + 'MB a minute, a guest up ' + perMin(ms[1].sent).toFixed(2) + ' down ' + perMin(ms[1].got).toFixed(2) + 'MB. up events a second: host ' + (ms[0].frames / seconds).toFixed(1) + ', guest ' + (ms[1].frames / seconds).toFixed(1) + '. last snapshot ages ' + ages.join(','));
            expect(ages.every(a => a < 3000), 'and all seven guests are still hearing about it', ages.join(','));
            for (const p of pages) await p.close();
        }
        const tidy = await open(ctx);
        await tidy.evaluate(() => localStorage.removeItem('test-direct'));
        await tidy.close();
    }
    await ctx.close();

    // ===================================================================
    section('esc, and getting the mouse back');
    // ===================================================================
    // Esc lets go of the mouse, and for about a second after that Chrome refuses to
    // hand it back: exactly when a player clicks carry on. That refusal was taken to
    // mean this browser has no pointer lock, and the rest of the match had no aim
    // and a pen that would not follow the mouse. The runners have no real pointer
    // lock to give, so this is a stand-in that behaves the way Chrome does.
    {
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        await ctx.addInitScript(() => {
            let el = null, exitedAt = -1e9;
            const fire = t => document.dispatchEvent(new Event(t));
            Object.defineProperty(Document.prototype, 'pointerLockElement', { get() { return el; }, configurable: true });
            Element.prototype.requestPointerLock = function () {
                if (performance.now() - exitedAt < 1000) {
                    setTimeout(() => fire('pointerlockerror'), 0);
                    return Promise.reject(new DOMException('The user has exited the lock before this request was completed.', 'SecurityError'));
                }
                el = this; setTimeout(() => fire('pointerlockchange'), 0); return Promise.resolve();
            };
            Document.prototype.exitPointerLock = function () { if (el) { el = null; setTimeout(() => fire('pointerlockchange'), 0); } };
            // the browser keeps the esc that lets go of the mouse for itself
            window.addEventListener('keydown', e => {
                if (e.key === 'Escape' && el) { el = null; exitedAt = performance.now(); setTimeout(() => fire('pointerlockchange'), 0); e.stopImmediatePropagation(); }
            }, true);
        });
        const p = await open(ctx);
        await p.evaluate(() => openWizardz());
        await p.waitForSelector('#wz-solo', { timeout: 30000 });
        await p.click('#wz-solo');
        await p.waitForSelector('.wz-bot', { timeout: 8000 });
        await p.click('.wz-bot[data-bot="bogwart"]');
        await live(p);
        const box = await (await p.$('#wz-canvas')).boundingBox();
        await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await p.waitForTimeout(150);
        const mine = () => state(p, g => ({ locked: !!document.pointerLockElement, noLock: !!g.noLock, paused: !!g.paused, ask: !!document.querySelector('#wz-click') }));
        expect((await mine()).locked, 'a click takes the mouse');
        await p.keyboard.press('Escape');
        await p.waitForSelector('#wz-resume', { timeout: 3000 });
        expect(true, 'esc lets go of it and pauses');
        await p.click('#wz-resume');
        await p.waitForTimeout(150);
        const refused = await mine();
        expect(!refused.noLock && refused.ask, 'carry on, too soon for the browser: it asks for the mouse again rather than giving up on it', JSON.stringify(refused));
        await p.waitForTimeout(1000);
        await p.click('#wz-click');
        await p.waitForTimeout(150);
        const back = await mine();
        expect(back.locked && !back.noLock && !back.paused, 'and the next click has it back', JSON.stringify(back));
        const after = await p.evaluate(async () => {
            const g = WZ_ENGINE.state(), y0 = g.yaw;
            const mv = (dx, dy) => window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', movementX: dx, movementY: dy, bubbles: true }));
            for (let i = 0; i < 6; i++) mv(20, 0);
            const turned = g.yaw - y0;
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
            await new Promise(r => setTimeout(r, 50));
            const x0 = g.pen.x;
            g.cv.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', button: 0, buttons: 1, bubbles: true, cancelable: true }));
            for (let i = 0; i < 6; i++) mv(15, 0);
            const out = { turned: +turned.toFixed(2), stance: g.stance, pen: Math.round(g.pen.x - x0) };
            window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', button: 0, buttons: 0, bubbles: true }));
            return out;
        });
        expect(after.turned > 0.1, 'the mouse turns the camera again', JSON.stringify(after));
        expect(after.stance && after.pen > 20, 'and the pen follows it in the ink stance', JSON.stringify(after));
        await ctx.close();
    }

    // ===================================================================
    section('a tablet on its side');
    // ===================================================================
    {
        const tab = devices['Galaxy Tab S4 landscape'];
        const ctx = await context({ ...tab });
        const p = await open(ctx);
        await p.evaluate(() => openWizardz('solo'));
        await p.waitForFunction(() => window.WZ_ENGINE && WZ_ENGINE.state(), null, { timeout: 30000 });
        await live(p);
        await p.waitForTimeout(500);
        const look = () => p.evaluate(() => {
            const st = document.querySelector('#wz-stage').getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
            const off = [...document.querySelectorAll('.wz-touch [id^="wz-t-"]')].filter(e => e.offsetParent)
                .filter(e => { const r = e.getBoundingClientRect(); return r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1; }).map(e => e.id);
            return { fs: document.querySelector('.app-window:has(.wz-body)').classList.contains('fs-active'), share: +(st.width * st.height / (vw * vh)).toFixed(2), off };
        });
        const turn = async (w, h) => { await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(700); };
        const { width: W, height: H } = tab.viewport;
        let r = await look();
        expect(r.fs && r.share > 0.85 && !r.off.length, 'held sideways, the match takes the whole screen', JSON.stringify(r));
        await p.screenshot({ path: SHOTS + '/wz-tablet.png' });
        await turn(H, W);
        r = await look();
        expect(!r.fs && !r.off.length, 'held upright it goes back in its window, with every thumb button on the screen', JSON.stringify(r));
        await turn(W, H);
        r = await look();
        expect(r.fs, 'and turned back it takes the screen again', JSON.stringify(r));
        await p.tap('.app-window:has(.wz-body) .fs-btn');
        await p.waitForTimeout(900);
        expect(!(await look()).fs, 'leave it with the button and it stays left');
        await turn(H, W); await turn(W, H);
        expect((await look()).fs, 'until the screen turns again');
        await p.evaluate(() => closeAppWindow(document.querySelector('.app-window:has(.wz-body)').id));
        await p.waitForTimeout(300);
        expect(await p.evaluate(() => !document.documentElement.classList.contains('fs-locked')), 'and closing the game gives the page back');
        await ctx.close();
    }

    // ===================================================================
    section('the menu, fullscreen on a narrow phone');
    // ===================================================================
    // From a screenshot: a phone with no courier new falls back to a wider monospace,
    // and the teams, map and difficulty row would not wrap. The menu column cannot
    // shrink below its widest row, so every button in it ran off the right of the
    // screen. And the body kept its desktop cap of 80vh, leaving the bottom bare.
    {
        const ctx = await context({ viewport: { width: 320, height: 658 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await ctx.addInitScript(() => {
            Element.prototype.requestFullscreen = undefined;
            Element.prototype.webkitRequestFullscreen = undefined;
            document.addEventListener('DOMContentLoaded', () => {
                const s = document.createElement('style');
                s.textContent = '.wz-body, .wz-body * { font-family: "DejaVu Sans Mono", monospace !important; letter-spacing: 1.6px !important; }';
                document.head.appendChild(s);
            });
        });
        const p = await open(ctx);
        await p.evaluate(() => openWizardz());
        await p.waitForSelector('#wz-solo', { timeout: 30000 });
        await p.waitForTimeout(400);
        await p.tap('.app-window:has(.wz-body) .fs-btn');
        await p.waitForTimeout(800);
        const m = await p.evaluate(() => {
            const w = document.querySelector('.app-window:has(.wz-body)'), body = w.querySelector('.app-window-body');
            const wr = w.getBoundingClientRect(), br = body.getBoundingClientRect();
            const cut = [...body.querySelectorAll('button, select, input')].filter(e => e.offsetParent && e.getBoundingClientRect().right > br.right - 1).map(e => e.id || e.tagName);
            return { fs: w.classList.contains('fs-active'), cut, sideways: body.scrollWidth - body.clientWidth, winShort: Math.round(innerHeight - wr.bottom), bodyShort: Math.round(wr.bottom - br.bottom) };
        });
        expect(m.fs && !m.cut.length && m.sideways <= 1, 'with a wide font on a narrow phone, nothing in the menu runs off the right', JSON.stringify(m));
        expect(m.winShort <= 1 && m.bodyShort <= 8, 'and fullscreen means the whole screen, not 80% of it', JSON.stringify(m));
        await p.screenshot({ path: SHOTS + '/wz-menu-narrow-fullscreen.png' });
        await ctx.close();
    }

    // ===================================================================
    section('a phone held upright, and aim assist for thumbs');
    // ===================================================================
    {
        const ctx = await context({ ...devices['Pixel 7'] });
        const p = await open(ctx);
        await p.evaluate(() => openWizardz());
        await p.waitForSelector('#wz-solo', { timeout: 30000 });
        await p.tap('#wz-solo');
        await p.waitForSelector('.wz-bot', { timeout: 8000 });
        await p.tap('.wz-bot[data-bot="bogwart"]');
        await live(p);
        // the way the screenshot that started this was taken: fullscreen, held upright
        await p.tap('.app-window:has(.wz-body) .fs-btn');
        await p.waitForTimeout(900);
        const up = await state(p, g => {
            const st = g.stage.getBoundingClientRect();
            const across = 2 * Math.atan(Math.tan(g.fovNow / 2) * g.aspect);
            return { scale: +(st.width / g.hud.width).toFixed(2), across: Math.round(across * 180 / Math.PI), aspect: +g.aspect.toFixed(2), padLeft: g.padLeft, cx: g.hud.width / 2 };
        });
        // it was 0.6: seven pixel writing for hp, ink and the loaded spell
        expect(up.scale >= 0.8, 'the hud is drawn near its real size on an upright phone', JSON.stringify(up));
        // vertical fov 1.4 at this shape saw 47 degrees across, most of it your own back
        expect(up.aspect < 0.6 && up.across >= 58, 'and the lens is wider, so you see past yourself', JSON.stringify(up));
        expect(typeof up.padLeft === 'number' && up.padLeft < up.cx + 56, 'it knows the thumb buttons are where the spell box was, and moves it', JSON.stringify(up));
        await p.screenshot({ path: SHOTS + '/wz-phone-upright.png' });

        // the foe stands still ten metres off, and the crosshair starts `off` to the side of them
        const trial = (off, busy) => p.evaluate(async ([off, busy]) => {
            const g = WZ_ENGINE.state(), S = WZ_SIM, s = g.s, me = s.wiz[g.me], fi = 1 - g.me, foe = s.wiz[fi];
            // the bot stops thinking, and lets go of whatever it was holding down
            g.brains = {}; g.keys = {}; g.wantFire = false; s.input[fi] = S.blankInput();
            foe.x = me.x + Math.sin(g.yaw) * 10; foe.z = me.z - Math.cos(g.yaw) * 10;
            s.ents = s.ents.filter(e => e.k !== 'wall');
            await new Promise(r => setTimeout(r, 250));
            const onThem = () => { const t = { x: me.x, y: me.y, z: me.z, yaw: g.yaw, pitch: g.pitch, aim: false };
                for (let k = 0; k < 4; k++) { const c = S.camera(s, t); t.yaw = Math.atan2(foe.x - c.x, -(foe.z - c.z)); t.pitch = Math.atan2(foe.y + 1.1 - c.y, Math.hypot(foe.x - c.x, foe.z - c.z)); }
                return t; };
            const t0 = onThem();
            g.yaw = t0.yaw + off; g.pitch = t0.pitch;
            if (busy) g.stick.id = 999;
            const y0 = g.yaw, f0 = [foe.x, foe.z];
            await new Promise(r => setTimeout(r, 600));
            g.stick.id = null;
            const want = onThem().yaw, miss = Math.atan2(Math.sin(g.yaw - want), Math.cos(g.yaw - want));
            return { off, left: +miss.toFixed(4), turned: +(g.yaw - y0).toFixed(4), foeMoved: +Math.hypot(foe.x - f0[0], foe.z - f0[1]).toFixed(2) };
        }, [off, busy]);
        let r = await trial(0.05, true);
        expect(r.foeMoved < 0.05, 'the one being aimed at stands still for this', JSON.stringify(r));
        // light: closer, and not on them in a snap
        expect(r.left < r.off * 0.85 && r.left > r.off * 0.15, 'a little off them, with a thumb down: it leans onto them, lightly', JSON.stringify(r));
        r = await trial(0.05, false);
        expect(Math.abs(r.turned) < 0.0005, 'with no thumb on the glass it leaves the camera alone', JSON.stringify(r));
        r = await trial(0.3, true);
        expect(Math.abs(r.turned) < 0.0005, 'well off them it does nothing', JSON.stringify(r));
        await p.evaluate(() => { WZ_ENGINE.state().settings.assist = false; });
        r = await trial(0.05, true);
        expect(Math.abs(r.turned) < 0.0005, 'and switched off in settings, it is off', JSON.stringify(r));
        await ctx.close();
    }
    {
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        const p = await open(ctx);
        await p.evaluate(() => openWizardz());
        await p.waitForSelector('#wz-solo', { timeout: 30000 });
        await p.click('#wz-solo');
        await p.waitForSelector('.wz-bot', { timeout: 8000 });
        await p.click('.wz-bot[data-bot="bogwart"]');
        await live(p);
        const r = await p.evaluate(async () => {
            const g = WZ_ENGINE.state(), s = g.s, me = s.wiz[g.me], foe = s.wiz[1 - g.me];
            g.brains = {}; s.input[1 - g.me] = WZ_SIM.blankInput();
            foe.x = me.x + Math.sin(g.yaw) * 10; foe.z = me.z - Math.cos(g.yaw) * 10;
            await new Promise(r => setTimeout(r, 250));
            g.yaw += 0.03; g.stick.id = 999; g.wantFire = true;
            const y0 = g.yaw;
            await new Promise(r => setTimeout(r, 500));
            g.stick.id = null; g.wantFire = false;
            return { turned: +(g.yaw - y0).toFixed(4), touch: g.touch };
        });
        expect(!r.touch && Math.abs(r.turned) < 0.0005, 'a mouse gets no help', JSON.stringify(r));
        await ctx.close();
    }

    }
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
