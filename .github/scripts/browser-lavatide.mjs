// ===================================================================
// browser-lavatide.mjs — lava & tide 98 in a real browser
//
//   the desktop    opens from the start menu into a desktop popup
//   real keys      level 1 played start to finish with w a d and the arrows,
//                  driven by watching the picture's state, not by a script
//   records        the rank is saved and survives a reload; level 2 opens
//   pausing        esc, and minimising the window, stop the clock
//   alone          tab swaps who you are; every level then played to the end
//                  by its own solution at a fast clock
//   a phone        390x844: no sideways overflow, thumbs that move lava
//   online         two pages in one browser, the lobby in 'same browser'
//                  mode: real keys on both sides, one authoritative state,
//                  a level finished together, and the guest walking out
//
// Its own static server on port 0, nothing off the machine.
//   node .github/scripts/browser-lavatide.mjs
// ===================================================================
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.SHOTS || path.join(process.env.TMPDIR || '/tmp', 'lavatide-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'text/xml', '.webmanifest': 'application/json', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const errors = [];
async function context(opts, who) {
    const ctx = await browser.newContext(opts);
    await ctx.route('**/*', r => {
        const u = r.request().url();
        return u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
    });
    await ctx.addInitScript(who => {
        try {
            sessionStorage.setItem('welcomed', '1');
            sessionStorage.setItem('booted', '1');
            localStorage.setItem('sound-enabled', 'false');
            if (who && !localStorage.getItem('mrhakan98-netplay-profile')) localStorage.setItem('mrhakan98-netplay-profile', JSON.stringify({ id: who + Math.random().toString(36).slice(2, 8), name: who, avatar: null }));
        } catch (e) { }
    }, who || null);
    return ctx;
}
async function open(ctx, label) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push((label || 'page') + ': ' + e.message));
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForFunction(() => typeof startMenuAction === 'function');
    await p.evaluate(() => document.getElementById('boot-screen')?.remove());
    return p;
}
async function launch(p) {
    const before = await p.locator('.app-window').count();
    await p.evaluate(() => startMenuAction('lavatide'));
    await p.waitForSelector('.lt-panel .lt-logo', { timeout: 20000 });
    return before;
}
const st = (p, fn, arg) => p.evaluate(`(${fn})(LT_ENGINE.state(), ${JSON.stringify(arg === undefined ? null : arg)})`);
const center = (p, i) => st(p, (g, i) => { const c = g.s.chars[i]; return { x: (c.x + 5) / 16 - 0.5, y: c.y, g: c.g, dead: c.dead }; }, i);

// --- real keys, steered by watching where the character is ---
const KEYS = [{ L: 'KeyA', R: 'KeyD', U: 'KeyW' }, { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp' }];
async function goTo(p, i, col) {
    const k = KEYS[i];
    for (let guard = 0; guard < 80; guard++) {
        const c = await center(p, i);
        const d = col - c.x;
        if (Math.abs(d) < 0.12) return;
        const key = d > 0 ? k.R : k.L;
        await p.keyboard.down(key);
        const res = await p.waitForFunction(([i, col, right]) => {
            const g = LT_ENGINE.state(), ch = g.s.chars[i], x = (ch.x + 5) / 16 - 0.5;
            if (right ? x >= col - 0.06 : x <= col + 0.06) return 'there';
            // stuck against a step: say so, and hop
            const w = window.__ltw = window.__ltw || {};
            if (w.x === ch.x && ch.g) { w.n = (w.n || 0) + 1; if (w.n > 3) { w.n = 0; return 'stuck'; } } else w.n = 0;
            w.x = ch.x;
            return ch.dead || g.s.ph !== 'play' ? 'over' : false;
        }, [i, col, d > 0], { polling: 'raf', timeout: 15000 }).then(h => h.jsonValue());
        if (res === 'stuck') { await p.keyboard.down(k.U); await p.waitForTimeout(60); await p.keyboard.up(k.U); await p.waitForTimeout(250); }
        await p.keyboard.up(key);
        if (res === 'over') return;
        await p.waitForFunction(i => { const ch = LT_ENGINE.state().s.chars[i]; return ch.g || ch.dead; }, i, { polling: 'raf', timeout: 5000 }).catch(() => { });
        if (res === 'there') { await p.waitForTimeout(30); const c2 = await center(p, i); if (Math.abs(col - c2.x) < 0.2) return; }
    }
}
async function jumpTo(p, i, col) {
    const k = KEYS[i];
    const c = await center(p, i);
    const key = col > c.x ? k.R : k.L;
    await p.keyboard.down(key);
    await p.keyboard.down(k.U);
    await p.waitForFunction(i => !LT_ENGINE.state().s.chars[i].g, i, { polling: 'raf', timeout: 3000 }).catch(() => { });
    await p.keyboard.up(k.U);
    await p.waitForFunction(([i, col, right]) => {
        const ch = LT_ENGINE.state().s.chars[i], x = (ch.x + 5) / 16 - 0.5;
        return ch.g || ch.dead || (right ? x >= col : x <= col);
    }, [i, col, col > c.x], { polling: 'raf', timeout: 5000 }).catch(() => { });
    await p.keyboard.up(key);
    await p.waitForFunction(i => { const ch = LT_ENGINE.state().s.chars[i]; return ch.g || ch.dead; }, i, { polling: 'raf', timeout: 5000 }).catch(() => { });
    await goTo(p, i, col);
}
// a level's own script, played with the keyboard ('go' and 'jump' only)
async function playByHand(p, lv) {
    const sol = await p.evaluate(lv => LT_ENGINE.sim.LEVELS[lv].sol, lv);
    for (const [i, steps] of [[0, sol.f], [1, sol.t]]) {
        for (const s of steps) {
            if ((await st(p, g => g.s.ph)) !== 'play') return;
            if (s[0] === 'go') await goTo(p, i, s[1]);
            else if (s[0] === 'jump') await jumpTo(p, i, s[1]);
            if (process.env.LT_DEBUG) console.log('    ', i, JSON.stringify(s), JSON.stringify(await center(p, i)), await st(p, g => g.s.ph));
        }
    }
}

try {
    // ===================================================================
    section('the desktop and the start menu');
    // ===================================================================
    const ctx = await context({ viewport: { width: 1280, height: 900 } }, 'lava');
    const p = await open(ctx, 'desktop');
    expect(await p.evaluate(() => !window.LT_SIM && !document.getElementById('lt-css')), 'none of it is in the first load');
    const before = await launch(p);
    expect(await p.locator('.app-window').count() > before, 'startMenuAction opens it in a desktop popup');
    expect(/lava & tide 98/.test(await p.locator('.app-window').last().locator('.app-window-title').textContent()), 'with its own title bar');
    expect(await p.evaluate(() => !!document.getElementById('lt-css') && !!window.LT_ENGINE), 'it brings its own styles and engine');
    expect((await p.locator('.lt-how li').count()) >= 4, 'the menu says how to play');
    expect(await p.locator('.lt-lv').count() >= 12, 'twelve temples or more', await p.locator('.lt-lv').count());
    expect(await p.locator('.lt-lv:disabled').count() === (await p.locator('.lt-lv').count()) - 1, 'only the first is open on a fresh browser');
    await p.screenshot({ path: SHOTS + '/lt-menu.png' });
    const viaUrl = await ctx.newPage();
    viaUrl.on('pageerror', e => errors.push('url: ' + e.message));
    await viaUrl.goto(BASE + '/?app=lavatide', { waitUntil: 'load' });
    expect(await viaUrl.waitForSelector('.lt-panel .lt-logo', { timeout: 20000 }).then(() => true, () => false), 'and from the address bar, ?app=lavatide');
    await viaUrl.close();

    // ===================================================================
    section('level 1, two at one keyboard, real keys');
    // ===================================================================
    await p.click('.lt-modes [data-m="duo"]');
    await p.click('.lt-lv[data-lv="0"]');
    await p.waitForFunction(() => LT_ENGINE.screen() === 'play' && LT_ENGINE.state());
    await p.waitForTimeout(200);
    const look = await p.evaluate(() => {
        const c = document.getElementById('lt-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let stone = 0, water = 0, lava = 0, goo = 0, dark = 0, n = 0;
        for (let i = 0; i < d.length; i += 4 * 5) {
            n++;
            const r = d[i], g = d[i + 1], b = d[i + 2];
            if (r > 110 && r < 150 && g > 95 && g < 130 && b > 45 && b < 75) stone++;
            else if (b > 200 && r < 140) water++;
            else if (r > 230 && g > 90 && g < 210 && b < 80) lava++;
            else if (g > 150 && r < 180 && b < 110) goo++;
            else if (r < 60 && g < 55 && b < 40) dark++;
        }
        return { stone: stone / n, water: water / n, lava: lava / n, goo: goo / n, dark: dark / n, w: c.width };
    });
    expect(look.stone > 0.2 && look.dark > 0.2 && look.water > 0.001 && look.lava > 0.001 && look.goo > 0.001, 'the picture: sandstone walls, a dark hall, and water, lava and goo in the floor', JSON.stringify(look));
    const t0 = await st(p, g => g.s.t);
    await p.waitForTimeout(300);
    expect(await st(p, g => g.s.t) > t0, 'the clock runs');
    const a0 = await center(p, 0), b0 = await center(p, 1);
    await p.keyboard.down('KeyD'); await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(250); await p.keyboard.up('KeyD'); await p.keyboard.up('ArrowLeft');
    const a1 = await center(p, 0), b1 = await center(p, 1);
    expect(a1.x > a0.x + 0.5 && b1.x < b0.x - 0.5, 'd moves lava right, the left arrow moves tide left', `${a0.x.toFixed(2)}→${a1.x.toFixed(2)} ${b0.x.toFixed(2)}→${b1.x.toFixed(2)}`);
    await p.keyboard.press('KeyR');
    await p.waitForFunction(() => LT_ENGINE.state().s.t < 30);
    expect(true, 'r restarts the level');
    // pause by hand
    await p.keyboard.press('Escape');
    const tp = await st(p, g => [g.paused, g.s.t]);
    await p.waitForTimeout(400);
    expect(tp[0] && (await st(p, g => g.s.t)) === tp[1], 'esc pauses, and the clock stops');
    expect(await p.locator('.lt-panel', { hasText: 'paused' }).count() === 1, 'with a paused dialog');
    await p.keyboard.press('Escape');
    expect(!(await st(p, g => g.paused)), 'esc again carries on');
    // a death
    await p.keyboard.press('KeyR');
    await goTo(p, 0, 7.2);
    await p.waitForFunction(() => LT_ENGINE.state().s.ph !== 'play', null, { timeout: 5000 }).catch(() => { });
    expect(await st(p, g => g.s.ph === 'dead' && g.s.chars[0].dead), 'lava walking into water is the end of lava');
    expect(/water/.test(await p.textContent('.lt-panel')), 'and the dialog says why');
    await p.click('.lt-panel [data-act="restart"]');
    expect(await st(p, g => g.s.ph === 'play' && g.s.t < 30), 'try again starts the level over');
    // and now properly
    await playByHand(p, 0);
    await p.waitForFunction(() => LT_ENGINE.state().s.ph !== 'play', null, { timeout: 8000 }).catch(() => { });
    const fin = await st(p, g => ({ ph: g.s.ph, gems: LT_ENGINE.sim.gemCount(g.s), n: g.s.gems.length, t: g.s.endT }));
    expect(fin.ph === 'won', 'both in their doors: level 1 is done', JSON.stringify(fin));
    expect(fin.gems >= 4, 'gems picked up on the way', fin.gems + ' of ' + fin.n);
    await p.waitForSelector('.lt-panel .lt-rank', { timeout: 3000 });
    const rank = (await p.textContent('.lt-panel .lt-rank')).trim();
    expect(/^[ABC]$/.test(rank), 'it gets a rank', rank);
    await p.screenshot({ path: SHOTS + '/lt-won.png' });
    const best = await p.evaluate(() => LT_ENGINE.best());
    expect(best[0] && best[0].r === rank, 'and the rank is saved', JSON.stringify(best));

    // ===================================================================
    section('the record survives a reload');
    // ===================================================================
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => typeof startMenuAction === 'function');
    await p.evaluate(() => document.getElementById('boot-screen')?.remove());
    await launch(p);
    expect(await p.locator('.lt-lv[data-lv="1"]:not(:disabled)').count() === 1, 'level 2 is open now');
    expect((await p.textContent('.lt-lv[data-lv="0"]')).includes(rank), 'and level 1 shows its rank', await p.textContent('.lt-lv[data-lv="0"]'));
    expect(JSON.parse(await p.evaluate(() => localStorage.getItem('mrhakan98-lavatide-best')))[0].r === rank, 'under mrhakan98-lavatide-best');

    // ===================================================================
    section('alone: swapping, minimising, and every temple to the end');
    // ===================================================================
    await p.click('.lt-modes [data-m="solo"]');
    await p.click('.lt-lv[data-lv="1"]');
    await p.waitForFunction(() => LT_ENGINE.screen() === 'play' && LT_ENGINE.state().mode === 'solo');
    const s0 = await center(p, 0);
    await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(150); await p.keyboard.up('ArrowLeft');
    const s1 = await center(p, 0);
    expect(s1.x < s0.x - 0.2, 'alone, the arrows move lava too', s0.x.toFixed(2) + '→' + s1.x.toFixed(2));
    await p.keyboard.press('Tab');
    expect(await st(p, g => g.active === 1), 'tab swaps to tide');
    expect(/you: tide/.test(await p.textContent('.lt-bar')), 'and the bar says who you are');
    await p.keyboard.press('KeyQ');
    expect(await st(p, g => g.active === 0), 'q swaps back');
    await p.locator('.app-window').last().locator('button[title="minimize"]').click();
    await p.waitForTimeout(500);
    expect(await st(p, g => g.paused), 'minimising the window pauses it');
    await p.evaluate(() => { const w = [...document.querySelectorAll('.app-window')].pop(); w.style.display = ''; w.style.transform = ''; w.style.opacity = ''; });
    await p.click('.lt-panel [data-act="resume"]');
    expect(!(await st(p, g => g.paused)), 'and it carries on when asked');
    // the rest of the temples, by their own solutions, fast
    await p.evaluate(() => LT_ENGINE.clock(16));
    let solved = 1;
    for (let lv = 1; lv < await p.evaluate(() => LT_ENGINE.sim.LEVELS.length); lv++) {
        await p.evaluate(lv => { LT_ENGINE.start(lv, 'solo'); LT_ENGINE.autopilot(true); }, lv);
        const ok = await p.waitForFunction(() => LT_ENGINE.state().s.ph !== 'play', null, { timeout: 30000 }).then(() => true, () => false);
        const ph = await st(p, g => g.s.ph);
        if (ok && ph === 'won') solved++;
        else { expect(false, 'level ' + (lv + 1) + ' plays to the end', ph); break; }
    }
    const total = await p.evaluate(() => LT_ENGINE.sim.LEVELS.length);
    expect(solved === total, 'every level finished, alone', solved + ' of ' + total);
    expect(Object.keys(await p.evaluate(() => LT_ENGINE.best())).length === total, 'and every one is in the records');
    expect(await p.locator('.lt-panel', { hasText: 'last door' }).count() === 1, 'the last one says so');
    await p.evaluate(() => LT_ENGINE.clock(1));
    await p.screenshot({ path: SHOTS + '/lt-last.png' });
    await ctx.close();

    // ===================================================================
    section('a phone');
    // ===================================================================
    {
        const pc = await context({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
        const q = await open(pc, 'phone');
        await launch(q);
        await q.click('.lt-lv[data-lv="0"]');
        await q.waitForFunction(() => LT_ENGINE.screen() === 'play');
        await q.waitForTimeout(500);
        const m = await q.evaluate(() => {
            const w = [...document.querySelectorAll('.app-window')].pop().getBoundingClientRect();
            const c = document.getElementById('lt-canvas').getBoundingClientRect();
            return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, wl: w.left, wr: w.right, cwid: c.width, ch: c.height, cb: c.bottom, vh: innerHeight };
        });
        expect(m.sw <= m.cw, 'nothing sticks out sideways', JSON.stringify(m));
        expect(m.wl >= 0 && m.wr <= m.cw + 1 && m.cwid > 300, 'the window and the temple fit the screen', JSON.stringify(m));
        expect(await q.locator('.lt-pad.on').count() === 1, 'the thumb buttons are there');
        const x0 = await center(q, 0);
        const right = q.locator('.lt-pad [data-pad="2"]');
        await right.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true });
        await q.waitForTimeout(300);
        await right.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, isPrimary: true });
        const x1 = await center(q, 0);
        expect(x1.x > x0.x + 0.5, 'holding ▶ walks lava right', x0.x.toFixed(2) + '→' + x1.x.toFixed(2));
        await q.locator('.lt-pad [data-act="swap"]').tap();
        expect(await st(q, g => g.active === 1), 'swap hands the thumbs to tide');
        await q.screenshot({ path: SHOTS + '/lt-phone.png' });
        await pc.close();
    }

    // ===================================================================
    section('online: two browsers, one temple');
    // ===================================================================
    {
        const oc = await context({ viewport: { width: 1200, height: 900 } });
        const host = await open(oc, 'host'), guest = await open(oc, 'guest');
        const lobby = async (pg) => {
            await pg.evaluate(() => openNetplay({ gameId: 'lavatide' }));
            await pg.waitForSelector('#np-host', { timeout: 15000 });
            await pg.selectOption('#np-mode', 'local');
        };
        await lobby(host);
        await host.click('#np-host');
        await host.waitForSelector('.np-code', { timeout: 15000 });
        const code = (await host.textContent('.np-code')).trim();
        await lobby(guest);
        await guest.fill('#np-code', code);
        await guest.click('#np-join');
        await guest.waitForSelector('.np-code', { timeout: 15000 });
        await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 15000 });
        expect(true, 'the guest joins with the code: ' + code);
        await guest.click('#np-ready');
        await host.waitForTimeout(400);
        await host.click('#np-start');
        const live = pg => pg.waitForFunction(() => window.LT_ENGINE && LT_ENGINE.state() && LT_ENGINE.state().mode === 'online', null, { timeout: 20000 });
        await Promise.all([live(host), live(guest)]);
        expect(await host.evaluate(() => LT_ENGINE.state().me === 0 && LT_ENGINE.state().isHost) && await guest.evaluate(() => LT_ENGINE.state().me === 1 && !LT_ENGINE.state().isHost),
            'the host is lava, the guest is tide');
        expect(await host.locator('.app-window', { hasText: 'lava & tide' }).count() >= 1, 'in a desktop popup on both');
        // real keys on both sides
        const hb = await center(host, 1);
        await guest.bringToFront();
        await guest.keyboard.down('ArrowLeft'); await guest.waitForTimeout(400); await guest.keyboard.up('ArrowLeft');
        await host.waitForTimeout(400);
        const ha = await center(host, 1);
        expect(ha.x < hb.x - 0.5, 'the guest\'s arrows move tide on the host', hb.x.toFixed(2) + '→' + ha.x.toFixed(2));
        const gb = await center(guest, 0);
        await host.bringToFront();
        await host.keyboard.down('KeyD'); await host.waitForTimeout(400); await host.keyboard.up('KeyD');
        await guest.waitForTimeout(500);
        const ga = await center(guest, 0);
        expect(ga.x > gb.x + 0.5, 'the host\'s d moves lava on the guest', gb.x.toFixed(2) + '→' + ga.x.toFixed(2));
        await host.waitForTimeout(300);
        const same = async () => {
            const [a, b] = await Promise.all([host, guest].map(pg => pg.evaluate(() => { const s = LT_ENGINE.state().s; return s.chars.map(c => [Math.round(c.x), Math.round(c.y)]).flat(); })));
            return { ok: a.every((v, i) => Math.abs(v - b[i]) <= 3), a, b };
        };
        const eq = await same();
        expect(eq.ok, 'both screens agree where everybody is', JSON.stringify(eq));
        // a guest cannot speak for lava, or send nonsense
        await guest.evaluate(() => { const g = LT_ENGINE.state(); g.session.sendToHost('lavatide:i', { q: g.seq + 5, b: [99], m: g.match }); g.session.sendToHost('lavatide:i', { q: g.seq + 1e6, b: [2], m: g.match }); g.session.sendToHost('lavatide:s', { v: 1 }); });
        await host.waitForTimeout(200);
        expect(await host.evaluate(() => { const g = LT_ENGINE.state(); return g.remote <= 7 && g.qTop < 1e5; }), 'the host ignores keys that are not keys, and a sequence from the far future');
        // play level 1 together: each side's own solution, through its own seat
        await host.evaluate(() => LT_ENGINE.state().s.ph === 'play' && LT_ENGINE.act('restart'));
        await guest.waitForTimeout(300);
        if (process.env.LT_DEBUG) for (const pg of [host, guest]) await pg.evaluate(() => {
            const S = LT_ENGINE.sim, step = S.step; window.__log = {};
            S.step = function (s, a, b, hold) { const r = step(s, a, b, hold); const g = LT_ENGINE.state(); if (g && g.s === s) { const k = g.isHost ? g.remoteSeq : (g.rep || g.seq); window.__log[k] = [+s.chars[1].x.toFixed(2), +s.chars[1].y.toFixed(2), b, hold || 0, s.t]; } return r; };
        });
        await host.evaluate(() => LT_ENGINE.autopilot(true));
        await guest.evaluate(() => LT_ENGINE.autopilot(true));
        const won = await Promise.all([host, guest].map(pg => pg.waitForFunction(() => LT_ENGINE.state().s.ph === 'won', null, { timeout: 60000 }).then(() => true, () => false)));
        if (process.env.LT_DEBUG && !(won[0] && won[1])) {
            const [hl, gl] = await Promise.all([host, guest].map(pg => pg.evaluate(() => window.__log)));
            const ks = Object.keys(hl).map(Number).filter(k => gl[k]).sort((a, b) => a - b);
            console.log('    common', ks[0], '..', ks[ks.length - 1], 'host first', JSON.stringify(Object.keys(hl).slice(0, 3).map(k => [k, hl[k]])), 'guest first', JSON.stringify(Object.keys(gl).slice(0, 3).map(k => [k, gl[k]])));
            for (const k of ks.slice(0, 4)) console.log('    seq', k, 'host', JSON.stringify(hl[k]), 'guest', JSON.stringify(gl[k]));
            let shown = 0;
            for (const k of Object.keys(hl).map(Number).sort((a, b) => a - b)) { const h = hl[k], g = gl[k]; if (g && (h[0] !== g[0] || h[1] !== g[1]) && shown++ < 8) console.log('    seq', k, 'host', JSON.stringify(h), 'guest', JSON.stringify(g)); }
        }
        const dump = pg => pg.evaluate(() => { const g = LT_ENGINE.state(); return { ph: g.s.ph, t: g.s.t, c: g.s.chars.map(c => [(c.x / 16).toFixed(2), (c.y / 16).toFixed(2), c.g, c.dead]), pa: g.pilot && g.pilot.a.i, pb: g.pilot && g.pilot.b.i, fresh: window.__ltFresh, auto: g.auto, remote: g.remote, seq: g.seq, rs: g.remoteSeq }; });
        expect(won[0] && won[1], 'a level finished together: both see the doors close', JSON.stringify(won) + (won[0] && won[1] ? '' : ' ' + JSON.stringify([await dump(host), await dump(guest)])));
        const gg = await Promise.all([host, guest].map(pg => pg.evaluate(() => LT_ENGINE.sim.gemCount(LT_ENGINE.state().s))));
        expect(gg[0] === gg[1], 'with the same gems on both', JSON.stringify(gg));
        await guest.waitForSelector('.lt-panel [data-act="next"]', { timeout: 5000 });
        await guest.click('.lt-panel [data-act="next"]');
        const moved = await Promise.all([host, guest].map(pg => pg.waitForFunction(() => LT_ENGINE.state().s.lv === 1 && LT_ENGINE.state().s.ph === 'play', null, { timeout: 8000 }).then(() => true, () => false)));
        expect(moved[0] && moved[1], 'the guest asks for the next level and both go', JSON.stringify(moved));
        await host.screenshot({ path: SHOTS + '/lt-online-host.png' });
        await guest.screenshot({ path: SHOTS + '/lt-online-guest.png' });
        // the guest walks out: the host gets both
        await guest.close();
        const alone = await host.waitForFunction(() => LT_ENGINE.state().alone, null, { timeout: 15000 }).then(() => true, () => false);
        expect(alone, 'when the guest leaves, the host drives both');
        await host.bringToFront();
        await host.keyboard.press('Tab');
        expect(await host.evaluate(() => LT_ENGINE.state().active === 1), 'and tab swaps to tide');
        await oc.close();
    }

    section('page errors');
    expect(!errors.length, 'nothing threw', [...new Set(errors)].slice(0, 6).join('\n        '));
} catch (e) {
    expect(false, 'the run fell over', String(e && e.stack || e).split('\n').slice(0, 4).join('\n        '));
} finally {
    await browser.close();
    server.close();
}
console.log('\n' + (failures ? failures + ' of ' + checks + ' browser checks FAILED' : 'all ' + checks + ' browser checks passed'));
process.exit(failures ? 1 : 0);
