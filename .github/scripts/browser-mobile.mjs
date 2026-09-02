// ===================================================================
// browser-mobile.mjs — open the site on a phone and hold it to the
// things a phone needs that a desktop never notices
//
// There is a `@media (pointer: coarse)` block in the stylesheet that
// grows every control to something a fingertip can hit. That part is
// visible when it breaks. These are the three that are not:
//
// 1. The page scrolling sideways. This one never looks like what it is.
//    If a single element sticks out past the right edge, the browser
//    widens the layout viewport to cover it and shrinks the whole page
//    to fit — so a 395px window renders at half size in the middle of
//    the screen with dead space round it, and every control on it is
//    suddenly too small to hit. The cause was nothing to do with any
//    game: the news ticker is animated 396px off the right of the
//    screen for half of every loop, and the class that clips it comes
//    off a cdn.
// 2. A window that cannot be moved. A finger drag emits pointer events
//    and nothing else — no browser synthesises mousemove for one — so a
//    titlebar wired to mousedown/mousemove is simply immovable.
// 3. A game that needs a hover it can never get. The troll problem drew
//    its build ghost on mouseover and placed on click; a finger only
//    has the click, so the tower went down blind on a cell rendered
//    eighteen pixels wide.
//
// Needs a static server on :8099 and playwright's chromium.
// ===================================================================
import { chromium, devices } from 'playwright';
import fs from 'fs';

const BASE = process.env.SITE_URL || 'http://localhost:8099/index.html';
const SHOTS = '.ci-shots';
fs.mkdirSync(SHOTS, { recursive: true });

// a fingertip is about 45; 30 is the floor the 98-era chrome is willing
// to grow to without stopping looking like itself
const TAP_FLOOR = 30;

let failures = 0;
const ok = m => console.log('  ok    ' + m);
const bad = (m, d) => { failures++; console.log('  FAIL  ' + m + (d ? '\n        ' + d : '')); };
const expect = (c, m, d) => c ? ok(m) : bad(m, d);
const section = n => console.log('\n== ' + n + ' ==');

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
// the BIOS screen and the welcome popup both sit over the desktop, and
// neither of them is what is being measured here
await ctx.addInitScript(() => {
    try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); } catch (e) { }
});
const errors = [];
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !/ERR_|404|504|Failed to load resource/.test(t)) errors.push('console: ' + t);
});

const measure = () => page.evaluate(() => {
    const win = [...document.querySelectorAll('.app-window')].pop();
    const box = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
        vw: document.documentElement.clientWidth,
        scrollW: document.documentElement.scrollWidth,
        win: win ? box(win) : null,
        touchClass: document.documentElement.classList.contains('is-touch')
    };
});

async function opens(name, open, opts) {
    const o = opts || {};
    await page.evaluate(() => document.querySelectorAll('.app-window').forEach(w => w.remove()));
    await page.evaluate(open);
    if (o.ready) await page.waitForSelector(o.ready, { timeout: 20000 });
    await page.waitForTimeout(o.wait || 1000);
    const m = await measure();
    // a couple of pixels of slack: a 1px border on a full-width child is
    // not what this is looking for
    expect(m.scrollW <= m.vw + 2, name + ': does not push the page sideways',
        'page is ' + m.scrollW + 'px wide on a ' + m.vw + 'px screen');
    expect(m.win && m.win.x >= -2 && m.win.x + m.win.w <= m.vw + 2 && m.win.y >= 0,
        name + ': opens on the screen', JSON.stringify(m.win));
    return m;
}

try {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(900);
    await page.evaluate(() => { window.soundEnabled = false; });

    section('the phone is recognised as one');
    {
        const m = await measure();
        expect(m.touchClass, 'the document is marked as a touch device');
        expect(await page.evaluate(() => window.TOUCH && TOUCH.coarse()), 'the touch layer agrees the pointer is coarse');
        expect(await page.evaluate(() => window.TOUCH && TOUCH.narrow()), 'and that the screen is a narrow one');
        expect(await page.evaluate(() => TOUCH.viewportWidth() === document.documentElement.clientWidth),
            'and it measures the viewport the way the media queries do');
    }

    section('nothing widens the page');
    {
        // the ticker is off the right of the screen for half of every
        // fifteen-second loop, so one sample proves nothing
        let worst = 0;
        for (let i = 0; i < 10; i++) {
            worst = Math.max(worst, await page.evaluate(() => document.documentElement.scrollWidth));
            await page.waitForTimeout(420);
        }
        const vw = await page.evaluate(() => document.documentElement.clientWidth);
        expect(worst <= vw + 2, 'the page stays its own width right through the marquee loop',
            'widest sample was ' + worst + 'px on a ' + vw + 'px screen');
    }

    section('a window can be moved and closed with a finger');
    {
        await page.evaluate(() => { document.querySelectorAll('.app-window').forEach(w => w.remove()); window.openCalculator(); });
        await page.waitForTimeout(500);

        // driven the way a finger drives it: pointer events and nothing
        // else, which is exactly what the old mousemove handler never saw
        const moved = await page.evaluate(async () => {
            const win = document.querySelector('.app-window');
            const header = win.querySelector('.app-window-header');
            const r = header.getBoundingClientRect();
            const before = Math.round(win.getBoundingClientRect().top);
            const at = (x, y) => ({ clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', bubbles: true, isPrimary: true });
            header.dispatchEvent(new PointerEvent('pointerdown', at(r.x + 40, r.y + r.height / 2)));
            for (let i = 1; i <= 8; i++) {
                header.dispatchEvent(new PointerEvent('pointermove', at(r.x + 40, r.y + r.height / 2 + i * 12)));
                await new Promise(res => setTimeout(res, 16));
            }
            header.dispatchEvent(new PointerEvent('pointerup', at(r.x + 40, r.y + r.height / 2 + 96)));
            return { before, after: Math.round(win.getBoundingClientRect().top) };
        });
        expect(moved.after > moved.before + 40, 'a finger on the titlebar drags the window', JSON.stringify(moved));

        // and it cannot be shoved somewhere it can never be got back from
        const shoved = await page.evaluate(() => {
            const win = document.querySelector('.app-window');
            const header = win.querySelector('.app-window-header');
            const r = header.getBoundingClientRect();
            const at = (x, y) => ({ clientX: x, clientY: y, pointerId: 8, pointerType: 'touch', bubbles: true, isPrimary: true });
            header.dispatchEvent(new PointerEvent('pointerdown', at(r.x + 40, r.y + r.height / 2)));
            header.dispatchEvent(new PointerEvent('pointermove', at(4000, 4000)));
            header.dispatchEvent(new PointerEvent('pointerup', at(4000, 4000)));
            const b = win.getBoundingClientRect();
            const close = [...win.querySelectorAll('.ie-titlebar-btn')].pop().getBoundingClientRect();
            return {
                left: Math.round(b.x), closeRight: Math.round(close.right), closeBottom: Math.round(close.bottom),
                vw: document.documentElement.clientWidth, vh: window.innerHeight
            };
        });
        expect(shoved.left >= -1 && shoved.closeRight <= shoved.vw + 1 && shoved.closeBottom <= shoved.vh + 1,
            'and shoving it at the corner of the world leaves the close button on screen',
            JSON.stringify(shoved));

        const closeBtn = page.locator('.app-window .ie-titlebar-btn').last();
        const cb = await closeBtn.boundingBox();
        expect(cb && cb.width >= TAP_FLOOR && cb.height >= TAP_FLOOR,
            'the close button is a target a thumb can find',
            cb ? Math.round(cb.width) + '×' + Math.round(cb.height) : 'no button');
        await closeBtn.click();
        await page.waitForTimeout(400);
        expect(await page.locator('.app-window').count() === 0, 'and closing one actually closes it');
    }

    section('every app opens on the screen');
    await opens('minesweeper', () => window.openMinesweeper());
    await opens('paint', () => window.openPaint());
    await opens('snake', () => window.openSnake());
    await opens('pong', () => window.openPong());
    await opens('jokerz', () => window.openBalatro(), { ready: '.bj-body .bj-btn', wait: 1400 });
    await opens('troll problem', () => window.openTrollProblem(), { ready: '.tg-body .tg-btn', wait: 1400 });
    await opens('become user', () => window.openBecomeUser(), { ready: '.bu-body', wait: 1400 });
    await opens('wizardz', () => window.openWizardz(), { ready: '.wz-btn', wait: 1400 });

    section('the troll problem aims before it builds');
    {
        await page.evaluate(() => {
            document.querySelectorAll('.app-window').forEach(w => w.remove());
            try { localStorage.removeItem('troll-problem-run'); } catch (e) { }
            window.openTrollProblem();
        });
        await page.waitForSelector('.tg-body .tg-btn', { timeout: 20000 });
        await page.locator('.tg-body button', { hasText: 'choose a map' }).first().click();
        await page.waitForTimeout(400);
        await page.locator('[data-map]').first().click();
        await page.waitForSelector('#tg-canvas', { timeout: 10000 });
        await page.waitForTimeout(700);

        await page.locator('.tg-tbtn').first().click();
        await page.waitForTimeout(250);
        const cv = await page.locator('#tg-canvas').boundingBox();
        const before = await page.evaluate(() => TG.towers.length);
        await page.touchscreen.tap(cv.x + cv.width * 0.2, cv.y + cv.height * 0.15);
        await page.waitForTimeout(350);

        expect(await page.evaluate(() => TG.towers.length) === before,
            'the first tap does not spend your gold');
        expect(await page.locator('.tg-aim').count() === 1,
            'it puts the ghost down and asks');
        const build = page.locator('[data-act="place"]');
        const bb = await build.boundingBox();
        expect(bb && bb.height >= TAP_FLOOR, 'and the build button is a real target',
            bb ? Math.round(bb.width) + '×' + Math.round(bb.height) : 'missing');
        await build.click();
        await page.waitForTimeout(350);
        expect(await page.evaluate(() => TG.towers.length) === before + 1, 'the second one builds it');
        await page.screenshot({ path: SHOTS + '/mobile-troll.png' });

        // picking the same tower again and aiming at the road: refused,
        // out loud, rather than silently eaten
        await page.touchscreen.tap(cv.x + cv.width * 0.5, cv.y + cv.height * 0.5);
        await page.waitForTimeout(300);
        const onRoad = await page.evaluate(() => TG.hover && TG.path.cells.has(TG.hover.cy * 20 + TG.hover.cx));
        if (onRoad) {
            const n = await page.evaluate(() => TG.towers.length);
            await page.locator('[data-act="place"]').click();
            await page.waitForTimeout(300);
            expect(await page.evaluate(() => TG.towers.length) === n,
                'and a cell on the road is refused rather than silently eaten');
        } else {
            ok('and a cell on the road is refused rather than silently eaten (skipped: that tap missed the road)');
        }
    }

    section('echoes of the tide, played with a thumb');
    {
        await page.evaluate(() => {
            document.querySelectorAll('.app-window').forEach(w => w.remove());
            localStorage.removeItem('ECHOES_OF_THE_TIDE_SAVE');
            localStorage.removeItem('ECHOES_OF_THE_TIDE_SAVE_BACKUP');
            window.openEchoes();
        });
        await page.waitForSelector('#et-seed', { timeout: 20000 });
        await page.fill('#et-name', 'thumb');
        await page.fill('#et-seed', '20260824');
        await page.locator('.et-body button', { hasText: 'take the boat out' }).first().click();
        await page.waitForSelector('#et-world', { timeout: 15000 });
        await page.waitForTimeout(900);

        const m = await measure();
        expect(m.scrollW <= m.vw + 2, 'the overworld does not push the page sideways',
            m.scrollW + ' vs ' + m.vw);

        const geom = await page.evaluate(() => {
            const b = s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { y: Math.round(r.y), w: Math.round(r.width) }; };
            return { map: b('#et-world'), pad: b('.tp-pad'), side: b('.et-side'), vh: window.innerHeight };
        });
        expect(geom.map && geom.map.y < geom.vh * 0.6, 'the map is on screen without scrolling for it',
            JSON.stringify(geom.map));
        expect(geom.side && geom.map && geom.side.y > geom.map.y,
            'the character sheet reads under the board rather than over it',
            JSON.stringify([geom.map && geom.map.y, geom.side && geom.side.y]));
        expect(geom.pad && geom.pad.w > 0, 'and the pad is there to walk with', JSON.stringify(geom.pad));
        await page.screenshot({ path: SHOTS + '/mobile-echoes.png' });
    }

    section('the music comes out of the speakers');
    {
        // createMediaElementSource is a one-way door: it takes the <audio>
        // element off the speakers and hands its output to the web audio
        // graph. Do that while the AudioContext is suspended — which is how
        // a phone creates one — and the track plays with the clock ticking
        // and no sound. So the element must never be routed into a graph
        // that is not running.
        await page.evaluate(() => { document.querySelectorAll('.app-window').forEach(w => w.remove()); });
        const btn = page.locator('button[onclick="playTrack()"]').first();
        await btn.evaluate(b => { b.scrollIntoView(); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click(); });
        await page.waitForTimeout(2200);
        const audio = await page.evaluate(() => {
            const a = document.getElementById('audio-player');
            return {
                playing: !a.paused && a.currentTime > 0.5,
                volume: a.volume, muted: a.muted,
                routed: !!mediaSource,
                ctx: audioContext ? audioContext.state : 'none'
            };
        });
        expect(audio.playing, 'a track actually plays', JSON.stringify(audio));
        expect(audio.volume > 0 && !audio.muted, 'at an audible volume', JSON.stringify(audio));
        expect(!audio.routed || audio.ctx === 'running',
            'and it is never handed to an audio graph that is asleep',
            JSON.stringify(audio));
    }
} catch (e) {
    bad('the run fell over', e.stack || e.message);
}

section('page errors');
expect(!errors.length, 'nothing threw the whole way through', errors.slice(0, 8).join('\n        '));

await browser.close();
console.log('\n' + '='.repeat(58));
console.log(failures ? failures + ' mobile checks failed' : 'all mobile checks passed');
process.exit(failures ? 1 : 0);
