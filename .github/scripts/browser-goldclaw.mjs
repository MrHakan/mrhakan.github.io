// browser-goldclaw.mjs - gold claw 98 played in a real browser: opened from the
// start menu into a desktop popup, a level won with real key presses and
// clicks, the shop, dynamite, pausing from the desktop, a game over, the
// record surviving a reload, and a phone with real taps. Own server, no
// outside traffic.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const SHOTS = path.join(ROOT, '.ci-shots');
fs.mkdirSync(SHOTS, { recursive: true });

let checks = 0, fail = 0;
const ok = (c, m, d) => { checks++; console.log((c ? '  ok    ' : '  FAIL  ') + m + (c || d === undefined ? '' : '\n        ' + JSON.stringify(d))); if (!c) fail++; };

const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });

async function context(opts) {
    const ctx = await browser.newContext(opts);
    await ctx.route('**/*', r => {
        const u = r.request().url();
        return u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
    });
    await ctx.addInitScript(() => {
        try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (_) { /* blocked storage */ }
        window.__gcErrors = [];
        addEventListener('error', e => window.__gcErrors.push(String(e.message || e)));
        addEventListener('unhandledrejection', e => window.__gcErrors.push('rejection: ' + String(e.reason)));
    });
    return ctx;
}
function watch(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
    return errors;
}
async function openGame(page) {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof startMenuAction === 'function');
    await page.evaluate(() => document.getElementById('boot-screen')?.remove());
    await page.evaluate(() => startMenuAction('goldclaw'));
    const win = page.locator('.app-window.framed-goldclaw-window');
    await win.waitFor({ state: 'visible', timeout: 15000 });
    const handle = await win.locator('iframe.framed-game').elementHandle({ timeout: 15000 });
    const frame = await handle.contentFrame();
    await frame.waitForFunction(() => window.GOLDCLAW_ENGINE && document.querySelector('#overlay .primary'));
    return { win, frame };
}
const E = (frame, fn, arg) => frame.evaluate(fn, arg);
const st = frame => E(frame, () => { const s = GOLDCLAW_ENGINE.state; return s && { phase: s.phase, level: s.level, money: s.money, goal: s.goal, time: s.time, dynamite: s.dynamite, claw: s.claw.mode, held: s.claw.item && s.claw.item.type, items: s.items.length, ui: GOLDCLAW_ENGINE.ui() }; });

// Wait (inside the page, every frame) until a shot fired now would hook the
// target dead centre, then press the real key. Returns the target's type.
async function shootAt(page, frame, pick) {
    const target = await E(frame, pickSrc => {
        const S = GOLDCLAW_ENGINE.sim, s = GOLDCLAW_ENGINE.state;
        const pick = new Function('S', 's', 'return (' + pickSrc + ')(S, s)');
        const it = pick(S, s);
        if (!it) return null;
        GOLDCLAW_ENGINE.setTimeScale(1);
        return { id: it.id, type: it.type };
    }, pick.toString());
    if (!target) return null;
    await E(frame, id => new Promise(resolve => {
        const S = GOLDCLAW_ENGINE.sim;
        const t0 = performance.now();
        (function check() {
            const s = GOLDCLAW_ENGINE.state, a = s.claw.angle;
            const hit = x => S.rayFirst(s, x)?.id === id;
            if ((s.claw.mode === 'swing' && hit(a) && hit(a - 0.04) && hit(a + 0.04)) || performance.now() - t0 > 8000) resolve();
            else requestAnimationFrame(check);
        })();
    }), target.id);
    await page.keyboard.press('ArrowDown');
    return target;
}
async function reelIn(frame) {
    await E(frame, () => GOLDCLAW_ENGINE.setTimeScale(8));
    await frame.waitForFunction(() => { const s = GOLDCLAW_ENGINE.state; return s.claw.mode === 'swing' || s.phase !== 'play'; }, null, { timeout: 15000 });
    await E(frame, () => GOLDCLAW_ENGINE.setTimeScale(1));
}
// the most valuable thing that nothing else is in front of
const BEST_TARGET = (S, s) => {
    let best = null, bestRate = -1;
    for (const it of s.items) {
        if (it.vx || it.type === 'tnt' || it.type.startsWith('rock')) continue;
        const a = Math.atan2(it.x - S.PX, it.y - S.PY);
        if (Math.abs(a) > S.MAX_ANGLE - 0.06 || S.rayFirst(s, a) !== it) continue;
        const e = S.estimate(s, it), rate = e.worth / e.time;
        if (rate > bestRate) { bestRate = rate; best = it; }
    }
    return best;
};
const ROCK_TARGET = (S, s) => s.items.find(it => it.type.startsWith('rock') && !it.vx && Math.abs(Math.atan2(it.x - S.PX, it.y - S.PY)) < S.MAX_ANGLE - 0.06 && S.rayFirst(s, Math.atan2(it.x - S.PX, it.y - S.PY)) === it)
    || s.items.find(it => !it.vx && it.type !== 'tnt' && S.rayFirst(s, Math.atan2(it.x - S.PX, it.y - S.PY)) === it);

try {
    // ---------------- desktop: a whole level and more ----------------
    {
        const ctx = await context({ viewport: { width: 1366, height: 768 } });
        const page = await ctx.newPage(), errors = watch(page);
        const { win, frame } = await openGame(page);
        ok(await win.evaluate(w => w.classList.contains('app-window') && !!w.closest('body')), 'startMenuAction opens gold claw in a desktop popup window');
        ok(await E(frame, () => document.documentElement.dataset.embedded === 'true' && getComputedStyle(document.querySelector('.titlebar')).display === 'none'), 'the framed page is embedded and hides its own title bar');
        ok(/how to play/.test(await frame.locator('#overlay').textContent()), 'a how-to-play screen comes first');

        await frame.getByRole('button', { name: 'start digging' }).click();
        ok((await st(frame)).ui.mode === 'intro', 'start digging shows the level intro');
        await E(frame, () => GOLDCLAW_ENGINE.newGame(4242));
        ok(/goal is \$650/.test(await frame.locator('#overlay').textContent()), 'level 1 asks for $650');
        await frame.getByRole('button', { name: 'go!' }).click();
        let s = await st(frame);
        ok(s.ui.mode === 'play' && s.time > 59, 'the level starts with a full minute', s);
        await page.waitForTimeout(400);
        ok((await st(frame)).time < s.time, 'the clock runs');

        // real presses until the goal is in the bank
        let shots = 0;
        while ((s = await st(frame)).money < s.goal && s.phase === 'play' && shots < 14) {
            const t = await shootAt(page, frame, BEST_TARGET);
            if (!t) break;
            shots++;
            await frame.waitForFunction(() => GOLDCLAW_ENGINE.state.claw.mode !== 'swing', null, { timeout: 2000 }).catch(() => {});
            await reelIn(frame);
        }
        s = await st(frame);
        ok(s.money >= s.goal && s.phase === 'play', 'the goal reached with ' + shots + ' real shots: $' + s.money, s);
        ok((await frame.locator('#money').textContent()) === '$' + s.money, 'the money counter shows it');
        ok(await frame.locator('#goal-field.met').count() === 1, 'the goal field turns green');
        await page.screenshot({ path: path.join(SHOTS, 'goldclaw-desktop.png') });

        // the pause from the desktop: minimise the window
        await win.locator('button[title="minimize"]').click();
        await frame.waitForFunction(() => GOLDCLAW_ENGINE.ui().paused, null, { timeout: 5000 }).catch(() => {});
        ok((await st(frame)).ui.paused, 'minimising the window pauses the game');
        const before = (await st(frame)).time;
        await page.waitForTimeout(300);
        ok(Math.abs((await st(frame)).time - before) < 0.2, 'and the clock holds');
        await page.locator('#' + await win.getAttribute('id') + '-tb').click();
        await page.waitForFunction(() => !document.querySelector('.framed-goldclaw-window').getAnimations().some(a => a.playState === 'running'));
        await frame.locator('#overlay').getByRole('button', { name: 'resume' }).click();
        await page.waitForTimeout(200);
        ok(!(await st(frame)).ui.paused && (await st(frame)).time < before - 0.05, 'resume picks the clock back up');
        await page.keyboard.press('p');
        ok((await st(frame)).ui.paused, 'p pauses');
        await page.keyboard.press('p');
        ok(!(await st(frame)).ui.paused, 'p resumes');

        // done, the result screen and the shop
        await frame.getByRole('button', { name: /done/ }).click();
        await frame.getByRole('button', { name: 'to the shop' }).waitFor();
        ok((await st(frame)).phase === 'cleared', 'done ends the level with the goal met');
        ok(await E(frame, () => localStorage.getItem('mrhakan98-goldclaw-best-level')) === '1', 'the cleared level is saved as the best');
        await frame.getByRole('button', { name: 'to the shop' }).click();
        await frame.locator('.offer').first().waitFor();
        s = await st(frame);
        const offer = await E(frame, () => { const s = GOLDCLAW_ENGINE.state; const i = s.offers.findIndex(o => o.price <= s.money); return i < 0 ? null : { i, ...s.offers[i] }; });
        if (offer) {
            await frame.locator('.offer').nth(offer.i).click();
            const after = await st(frame);
            ok(after.money === s.money - offer.price, 'buying ' + offer.kind + ' with the mouse costs $' + offer.price, after);
            ok(await frame.locator('.offer').nth(offer.i).getAttribute('aria-pressed') === 'true', 'and marks it sold');
        } else ok(false, 'the shop had something affordable', s);
        await E(frame, () => { if (!GOLDCLAW_ENGINE.state.dynamite) GOLDCLAW_ENGINE.state.dynamite = 1; });
        await frame.getByRole('button', { name: 'next level', exact: true }).click();
        ok(/level 2/.test(await frame.locator('#overlay').textContent()), 'next level shows level 2');
        await page.keyboard.press('Enter');
        s = await st(frame);
        ok(s.ui.mode === 'play' && s.level === 2 && s.goal > 650, 'enter starts level 2 with a bigger goal', s);

        // dynamite on a real reel
        const dyn = s.dynamite;
        const rock = await shootAt(page, frame, ROCK_TARGET);
        await frame.waitForFunction(() => GOLDCLAW_ENGINE.state.claw.item, null, { timeout: 5000 }).catch(() => {});
        await page.keyboard.press('ArrowUp');
        s = await st(frame);
        ok(rock && s.dynamite === dyn - 1 && !s.held, 'up blows up the ' + (rock && rock.type) + ' on the hook', s);
        await reelIn(frame);

        // the clock runs out short of the goal: game over
        await E(frame, () => { GOLDCLAW_ENGINE.state.money = 0; GOLDCLAW_ENGINE.fastForward(61); });
        await frame.getByRole('button', { name: 'try again' }).waitFor();
        s = await st(frame);
        ok(s.phase === 'over' && /not impressed/.test(await frame.locator('#overlay').textContent()), 'running out of time below the goal is game over');
        ok(Number(await E(frame, () => localStorage.getItem('mrhakan98-goldclaw-best-money'))) >= 650, 'the best money is saved');
        await frame.getByRole('button', { name: 'try again' }).click();
        s = await st(frame);
        ok(s.level === 1 && s.money === 0 && s.ui.mode === 'intro', 'try again starts a fresh run');

        // the canvas really has a mine on it
        const pixels = await E(frame, () => {
            const c = document.getElementById('field'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
            let gold = 0, sky = 0, dirt = 0;
            for (let i = 0; i < d.length; i += 4 * 7) {
                const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
                if (r > 200 && gg > 150 && b < 90) gold++;
                if (b > 200 && r < 200) sky++;
                if (r > 100 && r < 190 && gg > 50 && gg < 130 && b < 80) dirt++;
            }
            return { gold, sky, dirt };
        });
        ok(pixels.gold > 30 && pixels.sky > 100 && pixels.dirt > 1000, 'the canvas draws sky, dirt and gold', pixels);

        // a reload keeps the record
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => typeof startMenuAction === 'function');
        await page.evaluate(() => document.getElementById('boot-screen')?.remove());
        await page.evaluate(() => startMenuAction('goldclaw'));
        const h2 = await page.locator('.framed-goldclaw-window iframe.framed-game').elementHandle({ timeout: 15000 });
        const f2 = await h2.contentFrame();
        await f2.waitForFunction(() => window.GOLDCLAW_ENGINE);
        ok(/best: level 1/.test(await f2.locator('#overlay').textContent()) && /best: level 1/.test(await f2.locator('#best').textContent()), 'the best level survives a reload');
        const frameErrors = [...await E(frame, () => window.__gcErrors).catch(() => []), ...await E(f2, () => window.__gcErrors)];
        ok(!errors.length && !frameErrors.length, 'no page errors on the desktop', [...errors, ...frameErrors]);
        await ctx.close();
    }

    // ---------------- standalone page ----------------
    {
        const ctx = await context({ viewport: { width: 1000, height: 900 } });
        const page = await ctx.newPage(), errors = watch(page);
        await page.goto(BASE + '/games/gold-claw/');
        await page.waitForFunction(() => window.GOLDCLAW_ENGINE);
        ok(await page.locator('.titlebar').isVisible(), 'the page also works on its own, with its title bar');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        ok((await st(page)).ui.mode === 'play', 'enter, enter: from the how-to straight into level 1');
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
        ok((await st(page)).ui.paused, 'a hidden tab pauses');
        ok(!errors.length, 'no page errors standalone', errors);
        await ctx.close();
    }

    // ---------------- a phone ----------------
    {
        const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
        const page = await ctx.newPage(), errors = watch(page);
        const { frame } = await openGame(page);
        const tapOn = async loc => { const b = await loc.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
        await tapOn(frame.getByRole('button', { name: 'start digging' }));
        await tapOn(frame.getByRole('button', { name: 'go!' }));
        ok((await st(frame)).ui.mode === 'play', 'taps start a run on a phone');
        const canvas = frame.locator('#field');
        const box = await canvas.boundingBox();
        ok(box && box.width >= 300 && box.height >= 220, 'the mine is a usable size on a phone', box);
        await page.waitForTimeout(200);
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.7);
        const s = await st(frame);
        ok(s.claw !== 'swing', 'tapping the mine shoots the claw', s);
        await reelIn(frame);
        await tapOn(frame.getByRole('button', { name: 'pause' }));
        ok((await st(frame)).ui.paused, 'the pause button works by touch');
        await tapOn(frame.locator('#overlay').getByRole('button', { name: 'resume' }));
        const widths = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
        const inner = await E(frame, () => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
        ok(widths.s <= widths.c + 1, 'the desktop does not overflow sideways at 390px', widths);
        ok(inner.s <= inner.c + 1, 'nor does the game inside its window', inner);
        const controls = await E(frame, () => [...document.querySelectorAll('.controls button')].every(b => { const r = b.getBoundingClientRect(); return r.right <= document.documentElement.clientWidth + 1 && r.height >= 30; }));
        ok(controls, 'the control buttons fit and are tappable');
        await page.screenshot({ path: path.join(SHOTS, 'goldclaw-phone.png') });
        // the shop fits a phone too
        await E(frame, () => { const s = GOLDCLAW_ENGINE.state; s.money = s.goal; GOLDCLAW_ENGINE.sim.finish(s); });
        await frame.getByRole('button', { name: 'to the shop' }).waitFor();
        await tapOn(frame.getByRole('button', { name: 'to the shop' }));
        await frame.getByRole('button', { name: 'next level', exact: true }).scrollIntoViewIfNeeded();
        ok(await frame.getByRole('button', { name: 'next level', exact: true }).isVisible(), 'the shop scrolls to its next level button on a phone');
        const frameErrors = await E(frame, () => window.__gcErrors);
        ok(!errors.length && !frameErrors.length, 'no page errors on the phone', [...errors, ...frameErrors]);
        await ctx.close();
    }
} catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
} finally {
    await browser.close();
    server.close();
}
console.log(fail ? fail + ' of ' + checks + ' goldclaw browser checks FAILED' : checks + ' goldclaw browser checks passed');
process.exit(fail ? 1 : 0);
