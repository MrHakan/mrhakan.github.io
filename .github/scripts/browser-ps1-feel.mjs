// ===================================================================
// browser-ps1-feel.mjs — what players said was wrong with the two ps1 shooters
//
// dungeonz 98 and wizardz 98 share a renderer and a lot of their mouse code, and
// these are the things people ran into, each one played in a real browser:
//
//   - fullscreen on a 2560x1440 screen, where the site zooms itself to 1.5: the
//     dungeon shrank to a little box in the corner and stayed there
//   - the dungeonz camera at the ends of its pitch, with its back to a wall and in a
//     corridor: it climbed over the walls looking up, and dived into the floor and
//     the wall beside you looking down
//   - a shrine's cards, which came up with the mouse still locked, so they could not
//     be clicked
//   - holding the right button (aiming, in wizardz) and pressing the left: no shot,
//     because a second button pressed is a pointermove, not a pointerdown
//
// The boss being too easy is measured by check-dungeonz.mjs instead, with bots.
//
// The runners have no pointer lock to give, and a real one would not survive esc the
// way Chrome's does, so this brings a stand-in that behaves like Chrome's: esc lets go,
// and for a second after that a request is refused. It brings its own server too.
//
//   node .github/scripts/browser-ps1-feel.mjs
// ===================================================================
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.PS1_SHOTS || path.join(ROOT, '.ci-shots');
fs.mkdirSync(SHOTS, { recursive: true });

let checks = 0, failures = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

// ---------- a server that answers the way github pages does ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'text/xml', '.webmanifest': 'application/json' };
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

const browser = await chromium.launch(Object.assign({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }, process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}));
const errors = [];

// Chrome's pointer lock, as far as these games can tell
function chromeLikeLock() {
    let el = null, exitedAt = -1e9;
    const fire = t => document.dispatchEvent(new Event(t));
    Object.defineProperty(Document.prototype, 'pointerLockElement', { get() { return el; }, configurable: true });
    Element.prototype.requestPointerLock = function () {
        if (performance.now() - exitedAt < 1000) {
            setTimeout(() => fire('pointerlockerror'), 0);
            return Promise.reject(new DOMException('The user has exited the lock before this request was completed.', 'SecurityError'));
        }
        if (!navigator.userActivation || !navigator.userActivation.isActive) {
            setTimeout(() => fire('pointerlockerror'), 0);
            return Promise.reject(new DOMException('A user gesture is required', 'NotAllowedError'));
        }
        el = this; setTimeout(() => fire('pointerlockchange'), 0); return Promise.resolve();
    };
    Document.prototype.exitPointerLock = function () { if (el) { el = null; setTimeout(() => fire('pointerlockchange'), 0); } };
    // the browser keeps the esc that lets go of the mouse for itself
    window.addEventListener('keydown', e => {
        if (e.key === 'Escape' && el) { el = null; exitedAt = performance.now(); setTimeout(() => fire('pointerlockchange'), 0); e.stopImmediatePropagation(); }
    }, true);
}

async function context(options) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', ...options });
    await ctx.route('**/*', route => {
        const u = route.request().url();
        // the visitor counters and everything else off the machine
        if (/komarev\.com|waust\.at|whos\.amung\.us/.test(u)) return route.abort();
        return u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:') ? route.continue() : route.abort();
    });
    await ctx.addInitScript(() => {
        try {
            sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1');
            localStorage.setItem('sound-enabled', 'false');
        } catch (e) { }
    });
    await ctx.addInitScript(chromeLikeLock);
    return ctx;
}
async function open(ctx, url = '/') {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(url + ': ' + e.message));
    p.on('dialog', d => d.dismiss());
    await p.goto(BASE + url, { waitUntil: 'load' });
    await p.evaluate(() => { const boot = document.getElementById('boot-screen'); if (boot) boot.remove(); });
    return p;
}

// ---------- the two games ----------
const GAMES = {
    dungeonz: {
        engine: 'DZ_ENGINE', sim: 'DZ_SIM', cv: '#dz-canvas', body: '.dz-body', resume: '[data-go="resume"]', click: '#dz-click',
        async start(p, opts) {
            await p.goto(BASE + '/?app=dungeonz', { waitUntil: 'load' });
            await p.waitForSelector('#dz-solo', { timeout: 30000 });
            await p.evaluate(o => startDungeonz('solo', o), Object.assign({ seed: 1000, dungeon: 'bin' }, opts || {}));
            await p.waitForFunction(() => { const g = window.DZ_ENGINE && DZ_ENGINE.state(); return g && g.s && g.R ? true : null; }, null, { timeout: 40000 });
            // the entrance shrine's card, by key, and the gate opens
            await p.waitForSelector('[data-card="0"]', { timeout: 8000 });
            await p.evaluate(() => DZ_ENGINE.state().cv.focus());
            await p.keyboard.press('1');
            await p.waitForFunction(() => { const g = DZ_ENGINE.state(); return g.s.phase === 'live' && !g.cardsShown; }, null, { timeout: 15000 });
        }
    },
    wizardz: {
        engine: 'WZ_ENGINE', sim: 'WZ_SIM', cv: '#wz-canvas', body: '.wz-body', resume: '#wz-resume', click: '#wz-click',
        async start(p) {
            await p.evaluate(() => openWizardz());
            await p.waitForSelector('#wz-solo', { timeout: 30000 });
            await p.click('#wz-solo');
            await p.waitForSelector('.wz-bot', { timeout: 8000 });
            await p.click('.wz-bot[data-bot="bogwart"]');
            await p.waitForFunction(() => { const g = window.WZ_ENGINE && WZ_ENGINE.state(); return g && g.s && g.R && g.s.phase === 'live' ? true : null; }, null, { timeout: 40000 });
        }
    }
};
const eng = (p, G, fn, arg) => p.evaluate(`(${fn})(${G.engine}.state(), ${JSON.stringify(arg === undefined ? null : arg)})`);
async function takeMouse(p, G) {
    const b = await (await p.$(G.cv)).boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down(); await p.mouse.up();
    await p.waitForTimeout(150);
    return p.evaluate(sel => document.pointerLockElement === document.querySelector(sel), G.cv);
}

try {
    // ===================================================================
    section('fullscreen on a 2560x1440 screen, at the site\'s zoom of 1.5');
    // ===================================================================
    // What was reported: the window's fullscreen button on a big screen, after esc had let go of
    // the mouse. The site sizes a fullscreen window's canvases itself, by shrinking each one to a
    // pixel and measuring what is left round it. The game's stage was still there at full size,
    // so nothing looked left, the dungeon was drawn in a box in the corner, and dungeonz, which
    // only refits when its own numbers change, never noticed.
    for (const name of ['dungeonz', 'wizardz']) {
        const G = GAMES[name];
        // Chrome's tabs and address bar take about 140 of the screen's 1440 until fullscreen
        // gives them back, and that resize is what the site refits a fullscreen canvas on
        const ctx = await context({ viewport: { width: 2560, height: 1301 }, deviceScaleFactor: 1, screen: { width: 2560, height: 1440 } });
        const p = await open(ctx);
        await G.start(p);
        expect(await takeMouse(p, G), name + ': a click takes the mouse');
        await p.keyboard.press('Escape');
        await p.waitForSelector(G.resume, { timeout: 3000 });
        // a moment, as a person takes, then the window's fullscreen button
        await p.waitForTimeout(400);
        await p.click(`.app-window:has(${G.body}) .fs-btn`);
        await p.setViewportSize({ width: 2560, height: 1440 });
        await p.waitForTimeout(900);
        expect(await p.evaluate(() => window.SCALE && SCALE.scale) === 1.5, name + ': the page is zoomed to 1.5 on the whole screen');
        const measure = () => p.evaluate(sel => {
            const r = document.querySelector(sel).getBoundingClientRect();
            const fsEl = document.fullscreenElement;
            return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, share: +(r.width * r.height / (innerWidth * innerHeight)).toFixed(2), fs: !!fsEl || !!document.querySelector('.app-window.fs-active') };
        }, G.cv);
        const inFs = await measure();
        await p.screenshot({ path: SHOTS + '/ps1-fs-' + name + '-paused.png' });
        expect(inFs.fs && inFs.share > 0.85, name + ': in fullscreen, paused, the picture fills the screen', JSON.stringify(inFs));
        await p.click(G.resume);
        await p.waitForTimeout(1300);
        const back = await measure();
        await p.screenshot({ path: SHOTS + '/ps1-fs-' + name + '-playing.png' });
        expect(back.share > 0.85, name + ': and it still does once you carry on', JSON.stringify(back));
        const hud = await p.evaluate(sel => { const a = document.querySelector(sel).getBoundingClientRect(), b = document.querySelector(sel.replace('canvas', 'hud')).getBoundingClientRect(); return Math.abs(a.width - b.width) + Math.abs(a.height - b.height); }, G.cv);
        expect(hud < 2, name + ': with the hud over it the same size', hud + 'px apart');
        // and out again: back into its window, the width of the window
        await p.click(`.app-window:has(${G.body}) .fs-btn`);
        await p.setViewportSize({ width: 2560, height: 1301 });
        await p.waitForTimeout(900);
        const out = await p.evaluate(([cv, body]) => {
            const c = document.querySelector(cv).getBoundingClientRect(), b = document.querySelector(body).getBoundingClientRect();
            return { cw: Math.round(c.width), bw: Math.round(b.width), fs: !!document.querySelector('.app-window.fs-active') };
        }, [G.cv, G.body]);
        expect(!out.fs && out.cw > out.bw * 0.9, name + ': out of fullscreen it fills its window again', JSON.stringify(out));
        await ctx.close();
    }

    // ===================================================================
    section('the dungeonz camera, at the ends of its pitch');
    // ===================================================================
    // Looking up, the camera rose with your pitch and peered over the walls with you under the
    // bottom of the screen. Looking down it sank to the floor and into the wall beside you, and
    // looked down at the floor in front of you while you were above it. These are measured, and
    // the pictures are kept to be looked at.
    {
        const G = GAMES.dungeonz;
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        const p = await open(ctx);
        await G.start(p, { seed: 4242, dungeon: 'registry' });
        expect(await takeMouse(p, G), 'a click takes the mouse');
        // no minions, nothing moving: the camera is all there is
        await p.evaluate(() => { const g = DZ_ENGINE.state(); g.s.minions.forEach(m => { m.state = 2; m.hp = 0; }); g.speed = 1e-9; clearInterval(window.__follow); });
        // the camera's own pitch limits, reached with the mouse
        const pitchTo = dir => p.evaluate(dir => {
            for (let i = 0; i < 30; i++) window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', movementX: 0, movementY: dir * 300, bubbles: true }));
            return DZ_ENGINE.state().pitch;
        }, dir);
        const up = await pitchTo(-1), down = await pitchTo(1);
        // the places: the middle of a room, back to its side wall, and a corridor, across and along
        const spots = await p.evaluate(() => {
            const g = DZ_ENGINE.state(), dun = g.s.dun, W = dun.world;
            const floor = (x, z) => [0, 0.5, -0.5].every(a => [0, 0.5, -0.5].every(b => W.at(x + a, z + b) < 0.1));
            const rm = dun.rooms.find(r => r.kind === 'fight');
            let mid = null;
            for (let k = 0; k < 60 && !mid; k++) { const x = rm.cx + (k % 7 - 3), z = rm.cz + (Math.floor(k / 7) - 4); if (floor(x, z)) mid = { x, z }; }
            let wall = null;
            for (let k = 0; k < 40 && !wall; k++) { const z = rm.cz + (k % 2 ? 1 : -1) * k * 0.5, x = rm.x0 + 0.55; if (floor(x + 0.5, z) && W.at(x - 0.6, z) > 3) wall = { x, z }; }
            const c = dun.corridors.find(q => q.z1 - q.z0 > 3) || dun.corridors[0];
            const corr = { x: (c.x0 + c.x1) / 2, z: (c.z0 + c.z1) / 2, half: (c.x1 - c.x0) / 2 };
            return { mid, wall, corr };
        });
        const views = [
            ['the middle of a room', spots.mid, Math.PI],
            ['back to the wall', spots.wall, Math.PI / 2],
            ['across a corridor, back to its side', spots.corr, Math.PI / 2],
            ['along a corridor', spots.corr, Math.PI]
        ];
        const look = (spot, yaw, pitch) => p.evaluate(({ spot, yaw, pitch }) => new Promise(res => {
            const g = DZ_ENGINE.state(), h = g.s.heroes[g.me], W = g.s.dun.world;
            h.x = h.px = spot.x; h.z = h.pz = spot.z; h.y = h.py = 0; h.yaw = yaw;
            g.yaw = yaw; g.pitch = pitch;
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const cam = DZ_SIM.camera(g.s, { x: h.x, y: h.y, z: h.z, yaw, pitch });
                // how close the lens is to anything solid: the near plane is 0.2 away, and wide
                let clear = 9;
                for (let a = 0; a < 16; a++) for (let d = 0.05; d <= 0.6; d += 0.05) {
                    const x = cam.x + Math.cos(a * Math.PI / 8) * d, z = cam.z + Math.sin(a * Math.PI / 8) * d;
                    if (W.at(x, z) > cam.y - 0.05) { clear = Math.min(clear, d); break; }
                }
                const floorGap = cam.y - W.at(cam.x, cam.z);
                // where you are on the picture: the angle from the middle of it to your chest and your hat
                const f = [cam.fx, cam.fy, cam.fz], fl = Math.hypot(...f);
                const ang = y => { const v = [h.x - cam.x, y - cam.y, h.z - cam.z], vl = Math.hypot(...v); return Math.acos((v[0] * f[0] + v[1] * f[1] + v[2] * f[2]) / vl / fl); };
                const half = (g.fovNow || 1.12) / 2;
                res({
                    cam: [+cam.x.toFixed(2), +cam.y.toFixed(2), +cam.z.toFixed(2)], fy: +(cam.fy / fl).toFixed(2), clear: +clear.toFixed(2), floorGap: +floorGap.toFixed(2),
                    chest: +ang(h.y + 1).toFixed(2), hat: +ang(h.y + 2.2).toFixed(2), half: +half.toFixed(2), back: +Math.hypot(cam.x - h.x, cam.z - h.z).toFixed(2), wallTop: 4.5
                });
            }));
        }), { spot, yaw, pitch });
        const flat = await look(spots.mid, Math.PI, 0);
        for (const [where, spot, yaw] of views) {
            if (!spot) { expect(false, 'found a place for ' + where); continue; }
            for (const [which, pitch] of [['all the way up', up], ['level', -0.1], ['all the way down', down]]) {
                const v = await look(spot, yaw, pitch);
                const file = 'ps1-cam-' + where.replace(/[^a-z]+/g, '-') + '-' + which.replace(/[^a-z]+/g, '-') + '.png';
                await p.screenshot({ path: SHOTS + '/' + file });
                const tag = where + ', ' + which;
                expect(v.clear >= 0.3, tag + ': the lens keeps out of the walls', JSON.stringify(v) + ' ' + file);
                expect(v.floorGap >= 0.35, tag + ': and off the floor', v.floorGap + 'm');
                expect(v.cam[1] <= v.wallTop - 0.4, tag + ': and below the tops of the walls', v.cam[1] + 'm up');
                // in the open you are on the picture. Up against something there is nowhere
                // behind you for a camera, so it goes over your head, never into it
                const seen = Math.min(v.chest, v.hat) < v.half - 0.03;
                if (where === 'the middle of a room' || where === 'along a corridor') expect(seen, tag + ': and you are in the picture', 'chest ' + v.chest + ', hat ' + v.hat + ' rad from the middle, the picture is ' + v.half + ' each way');
                else expect(seen || v.cam[1] > 2.6, tag + ': and you are in the picture, or it is over your head', JSON.stringify(v));
                if (where === 'the middle of a room' && which !== 'level') {
                    if (which === 'all the way up') expect(v.cam[1] <= flat.cam[1] && v.fy > 0.2, 'looking up brings the camera down behind you and tips it up', v.cam[1] + 'm against ' + flat.cam[1] + 'm level, looking ' + v.fy);
                    else expect(v.cam[1] >= flat.cam[1] && v.fy < -0.5, 'looking down lifts it over you and tips it down', v.cam[1] + 'm against ' + flat.cam[1] + 'm level, looking ' + v.fy);
                }
            }
        }
        await ctx.close();
    }

    // ===================================================================
    section('the wizardz camera, at the ends of its pitch');
    // ===================================================================
    {
        const G = GAMES.wizardz;
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        const p = await open(ctx);
        await G.start(p);
        expect(await takeMouse(p, G), 'a click takes the mouse');
        await p.evaluate(() => { const g = WZ_ENGINE.state(); g.speed = 1e-9; g.brains = {}; g.s.wiz.forEach((w, i) => { if (i !== g.me) { w.x = 60; w.z = 60; } }); });
        const pitchTo = dir => p.evaluate(dir => {
            for (let i = 0; i < 30; i++) window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', movementX: 0, movementY: dir * 300, bubbles: true }));
            return WZ_ENGINE.state().pitch;
        }, dir);
        const up = await pitchTo(-1), down = await pitchTo(1);
        // the open middle, and back to the biggest box near a spawn
        const spots = await p.evaluate(() => {
            const g = WZ_ENGINE.state(), S = WZ_SIM;
            const me = g.s.wiz[g.me];
            let wall = null;
            for (let r = 2; r < 30 && !wall; r += 0.5) for (let a = 0; a < 32 && !wall; a++) {
                const x = me.x + Math.cos(a / 32 * 6.283) * r, z = me.z + Math.sin(a / 32 * 6.283) * r;
                if (S.heightAt(x, z) > 0.1 || S.heightAt(x + 0.6, z) > 0.1) continue;
                if (S.heightAt(x - 0.7, z) > 2.5) wall = { x, z };
            }
            return { start: { x: me.x, z: me.z }, wall };
        });
        const look = (spot, yaw, pitch) => p.evaluate(({ spot, yaw, pitch }) => new Promise(res => {
            const g = WZ_ENGINE.state(), w = g.s.wiz[g.me], S = WZ_SIM;
            w.x = spot.x; w.z = spot.z; w.y = S.heightAt(spot.x, spot.z); w.px = w.x; w.pz = w.z; w.py = w.y;
            g.yaw = yaw; g.pitch = pitch;
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const cam = S.camera(g.s, { x: w.x, y: w.y, z: w.z, yaw, pitch, aim: false, lens: true });
                let clear = 9;
                for (let a = 0; a < 16; a++) for (let d = 0.05; d <= 0.6; d += 0.05) {
                    const x = cam.x + Math.cos(a * Math.PI / 8) * d, z = cam.z + Math.sin(a * Math.PI / 8) * d;
                    if (S.heightAt(x, z) > cam.y - 0.05) { clear = Math.min(clear, d); break; }
                }
                res({ cam: [+cam.x.toFixed(2), +cam.y.toFixed(2), +cam.z.toFixed(2)], clear: +clear.toFixed(2), floorGap: +(cam.y - S.heightAt(cam.x, cam.z)).toFixed(2), t: +cam.t.toFixed(2) });
            }));
        }), { spot, yaw, pitch });
        for (const [where, spot, yaw] of [['where you start', spots.start, 0], ['back to a wall', spots.wall, Math.PI / 2]]) {
            if (!spot) { expect(false, 'found a place for ' + where); continue; }
            for (const [which, pitch] of [['all the way up', up], ['level', 0], ['all the way down', down]]) {
                const v = await look(spot, yaw, pitch);
                const file = 'ps1-wzcam-' + where.replace(/[^a-z]+/g, '-') + '-' + which.replace(/[^a-z]+/g, '-') + '.png';
                await p.screenshot({ path: SHOTS + '/' + file });
                expect(v.clear >= 0.3 && v.floorGap >= 0.25, 'wizardz, ' + where + ', ' + which + ': the lens keeps out of the walls and the floor', JSON.stringify(v) + ' ' + file);
            }
        }
        await ctx.close();
    }

    // ===================================================================
    section('a shrine\'s cards, with the mouse locked');
    // ===================================================================
    // The cards came up with the mouse still locked to the game, so there was no pointer to
    // pick one with. Now they let go of it, without pausing the run, and the click that picks
    // the last card takes it back. 1 to 3 still pick, and still get the mouse back.
    {
        const G = GAMES.dungeonz;
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        const p = await open(ctx);
        await G.start(p);
        // a person who has been playing for a while
        await p.waitForTimeout(1100);
        expect(await takeMouse(p, G), 'a click takes the mouse');
        const shrine = n => p.evaluate(n => {
            // the next shrine, with n cards to spend for me
            const g = DZ_ENGINE.state(), s = g.s, h = s.heroes[g.me];
            const offer = [{ t: 'new', id: 'frostbolt' }, { t: 'new', id: 'chainlightning' }, { t: 'pas', id: 'turbo' }];
            s.shrine = { room: s.shrine ? s.shrine.room : 0, t: 0, done: false, healed: true };
            s.heroes.forEach(o => { if (o !== h) { o.picks = 0; o.offer = null; } });
            h.picks = n; h.offer = offer.slice(); h.offerN = 3;
        }, n);
        const now = () => p.evaluate(() => {
            const g = DZ_ENGINE.state(), h = g.s.heroes[g.me];
            const card = document.querySelector('[data-card="0"]');
            const top = card ? document.elementFromPoint(...(r => [r.left + r.width / 2, r.top + r.height / 2])(card.getBoundingClientRect())) : null;
            return { locked: !!document.pointerLockElement, paused: !!g.paused, cards: !!g.cardsShown, clickable: !!(top && top.closest('[data-card]')), skills: h.skills.length, picks: h.picks, dialog: !!document.querySelector('.wz-dialog'), ask: !!document.querySelector('#dz-click') };
        });
        await shrine(2);
        await p.waitForTimeout(400);
        const shown = await now();
        await p.screenshot({ path: SHOTS + '/ps1-cards-free.png' });
        expect(shown.cards && !shown.locked, 'the cards let go of the mouse', JSON.stringify(shown));
        expect(!shown.paused && !shown.dialog && shown.clickable, 'without pausing, and nothing sits over them', JSON.stringify(shown));
        // a click on the canvas round them does not lock it again while they are up
        const box = await (await p.$(G.cv)).boundingBox();
        await p.mouse.click(box.x + 40, box.y + box.height - 40);
        await p.waitForTimeout(200);
        expect(!(await now()).locked, 'a stray click beside them does not take the mouse back while there is a card to pick');
        // pick one with the mouse; one more is left, so the mouse stays free for it
        const card = await (await p.$('[data-card="1"]')).boundingBox();
        await p.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
        await p.waitForTimeout(300);
        const one = await now();
        expect(one.skills === 2 && one.picks === 1 && one.cards && !one.locked, 'a click on a card takes it, and the next one comes up with the mouse still free', JSON.stringify(one));
        // the last one, by key, as before
        await p.evaluate(() => DZ_ENGINE.state().cv.focus());
        await p.keyboard.press('3');
        await p.waitForTimeout(300);
        const two = await now();
        expect(two.picks === 0 && !two.cards, '3 takes the third card, as it always did', JSON.stringify(two));
        expect(two.locked || two.ask, 'and the mouse is the game\'s again, or one click from it', JSON.stringify(two));
        if (!two.locked) { await p.click('#dz-click'); await p.waitForTimeout(200); }
        expect((await now()).locked, 'the game has the mouse back');
        // the same again, picked with the mouse this time: that click takes the mouse back
        await shrine(1);
        await p.waitForTimeout(400);
        expect(!(await now()).locked, 'the next shrine lets go of it again');
        const c0 = await (await p.$('[data-card="0"]')).boundingBox();
        await p.mouse.click(c0.x + c0.width / 2, c0.y + c0.height / 2);
        await p.waitForTimeout(300);
        const last = await now();
        expect(!last.cards && last.locked && !last.paused, 'and the click on the last card takes the mouse back with it', JSON.stringify(last));
        await ctx.close();
    }

    // ===================================================================
    section('holding the right button, and firing with the left');
    // ===================================================================
    // A second mouse button pressed while one is already down is not a pointerdown: the
    // pointer is already down. It comes as a pointermove whose button says which one changed.
    for (const name of ['wizardz', 'dungeonz']) {
        const G = GAMES[name];
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        const p = await open(ctx);
        await G.start(p);
        expect(await takeMouse(p, G), name + ': a click takes the mouse');
        await p.evaluate(e => { const g = window[e].state(); g.wantFire = false; g.fireQ = false; }, G.engine);
        const b = await (await p.$(G.cv)).boundingBox();
        await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await p.mouse.down({ button: 'right' });
        await p.waitForTimeout(150);
        const aiming = await eng(p, G, g => ({ aim: !!g.wantAim, fire: !!g.wantFire }));
        if (name === 'wizardz') expect(aiming.aim && !aiming.fire, name + ': the right button aims', JSON.stringify(aiming));
        await p.mouse.down({ button: 'left' });
        const shotsNow = `(() => { const g = ${G.engine}.state(); return ${name === 'wizardz' ? "g.s.ents.filter(e => e.o === g.me && e.k === 'shot').length" : "g.s.proj.filter(q => q.o === g.me && q.kind === 'bolt').length"}; })()`;
        const fired = await p.waitForFunction(shotsNow, null, { timeout: 1500, polling: 30 }).then(() => true, () => false);
        const both = await eng(p, G, g => ({ aim: !!g.wantAim, fire: !!g.wantFire }));
        both.shots = fired ? 1 : 0;
        expect(both.fire && both.shots > 0, name + ': the left button fires while the right is held', JSON.stringify(both));
        if (name === 'wizardz') expect(both.aim, name + ': and it is still aiming', JSON.stringify(both));
        await p.mouse.up({ button: 'left' });
        await p.waitForTimeout(150);
        const letGo = await eng(p, G, g => ({ aim: !!g.wantAim, fire: !!g.wantFire }));
        expect(!letGo.fire, name + ': letting go of the left stops firing', JSON.stringify(letGo));
        if (name === 'wizardz') expect(letGo.aim, name + ': and the right is still aiming', JSON.stringify(letGo));
        await p.mouse.up({ button: 'right' });
        await p.waitForTimeout(150);
        const done = await eng(p, G, g => ({ aim: !!g.wantAim, fire: !!g.wantFire }));
        expect(!done.aim && !done.fire, name + ': and letting go of both lets go of both', JSON.stringify(done));
        // the other order: fire, then aim while firing
        await p.mouse.down({ button: 'left' });
        await p.mouse.down({ button: 'right' });
        await p.waitForTimeout(150);
        const other = await eng(p, G, g => ({ aim: !!g.wantAim, fire: !!g.wantFire }));
        expect(other.fire && (name !== 'wizardz' || other.aim), name + ': and firing first, then aiming, does both', JSON.stringify(other));
        await p.mouse.up({ button: 'right' });
        await p.mouse.up({ button: 'left' });
        await ctx.close();
    }
} catch (e) {
    failures++;
    console.log('  FAIL  ' + (e && e.stack || e));
} finally {
    await browser.close();
    server.close();
}
const real = errors.filter(e => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/.test(e));
if (real.length) { failures++; console.log('  FAIL  page errors:\n        ' + real.slice(0, 8).join('\n        ')); }
console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
