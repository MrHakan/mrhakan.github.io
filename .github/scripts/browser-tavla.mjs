// ===================================================================
// browser-tavla.mjs — tavla 98 in a real browser, played with real hands
//
//   solo     from the start menu into a desktop window, a whole game against
//            the bot with clicks, a drag, keys and undo; the score, the stats
//            and a match in progress survive a reload; pause on minimise
//   phone    390x844 with touches, nothing sticking out sideways
//   online   two tabs in 'local' mode through the desktop lobby: both sides
//            move, both see the same board, a forged move is ignored, a game
//            to the end, a rematch, and a guest who leaves gets a bot
//
//   node .github/scripts/browser-tavla.mjs
// ===================================================================
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
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
const expect = (c, m, d) => { checks++; if (c) console.log('  ok    ' + m + (d !== undefined ? '  (' + d + ')' : '')); else { failures++; console.log('  FAIL  ' + m + (d !== undefined ? '\n        ' + d : '')); } };
const section = n => console.log('\n== ' + n + ' ==');
const errors = [];

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
async function context(opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 } }, opts || {}));
    await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (_) { } });
    return ctx;
}
async function open(ctx) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForFunction(() => typeof startMenuAction === 'function');
    await p.evaluate(() => document.getElementById('boot-screen')?.remove());
    return p;
}
const st = (p, f, a) => p.evaluate(f, a);
const S = p => st(p, () => { const s = TAVLA_ENGINE.state(); return s && JSON.parse(JSON.stringify(s)); });
async function waitV(p, v, ms) { return p.waitForFunction(v0 => { const s = TAVLA_ENGINE.state(); return s && s.v !== v0; }, v, { timeout: ms || 8000 }).then(() => true).catch(() => false); }
async function xy(p, rel) { return st(p, r => TAVLA_ENGINE.xy(r), rel); }

// one turn of whoever sits at this page, with real input; returns false if it is not this page's turn
let moveNo = 0;
async function playTurn(p, how) {
    const g = await st(p, () => { const g = TAVLA_ENGINE.game(); return g && { me: g.me, turn: g.s.turn, phase: g.s.phase, bot: g.bots[g.me], v: g.s.v, paused: g.paused, over: TAVLA_ENGINE.over(), seq: g.seq, ack: g.ack }; });
    if (!g || g.turn !== g.me || g.over || g.paused || (g.phase !== 'roll' && g.phase !== 'move') || g.seq > g.ack) return false;
    if (g.phase === 'roll') {
        if (moveNo++ % 2) await p.keyboard.press('Space');
        else { const c = await xy(p, 0); await p.click('.tv-bar [data-act="roll"]'); void c; }
        await waitV(p, g.v);
        await p.waitForTimeout(80);
        return true;
    }
    const legal = await st(p, () => TAVLA_ENGINE.legal());
    const s = await S(p);
    if (!legal.length) {
        if (s.steps.length) { await p.click('.tv-bar [data-act="done"]'); await waitV(p, g.v); }
        else await waitV(p, g.v, 4000);         // no move: it passes by itself
        return true;
    }
    const m = legal[(moveNo++) % legal.length];
    const a = await xy(p, m.from);
    if (!a || !Number.isFinite(a.x)) throw new Error('no place on the page for ' + JSON.stringify(m) + ': ' + JSON.stringify(a));
    if (how === 'drag') {
        const b = await xy(p, m.to);
        await p.mouse.move(a.x, a.y); await p.mouse.down();
        await p.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
        await p.mouse.move(b.x, b.y, { steps: 4 }); await p.mouse.up();
    } else if (how === 'tap') {
        await p.touchscreen.tap(a.x, a.y);
        if (!(await waitV(p, g.v, 400))) { const b = await xy(p, m.to); await p.touchscreen.tap(b.x, b.y); }
    } else {
        await p.mouse.click(a.x, a.y);
        if (!(await waitV(p, g.v, 400))) { const b = await xy(p, m.to); await p.mouse.click(b.x, b.y); }
    }
    await waitV(p, g.v, 3000);
    await p.waitForTimeout(40);
    return true;
}

try {
    // ===============================================================
    section('solo against the bot');
    // ===============================================================
    const ctx = await context();
    const p = await open(ctx);
    await p.evaluate(() => startMenuAction('tavla'));
    await p.waitForSelector('.app-window .tv-menu', { timeout: 15000 });
    const title = await p.locator('.app-window', { has: p.locator('.tv-stage') }).locator('.app-window-title').textContent();
    expect(title.includes('tavla 98'), 'tavla opens in a desktop popup window', title);
    await p.selectOption('#tv-level', 'easy');
    await p.selectOption('#tv-points', '1');
    await p.click('.tv-menu [data-act="solo"]');
    await p.waitForFunction(() => TAVLA_ENGINE.screen() === 'play');
    await st(p, () => TAVLA_ENGINE.fast(5));
    let s0 = await S(p);
    expect(s0.target === 1 && s0.game === 1 && !!s0.opening && s0.opening[0] !== s0.opening[1], 'a one game match starts with the opening roll', s0.opening.join('-') + ' ' + s0.phase + ' target ' + s0.target);
    // wait for my first move phase, then try undo and the keys
    for (let i = 0; i < 40; i++) {
        const g = await st(p, () => { const g = TAVLA_ENGINE.game(); return { t: g.s.turn, ph: g.s.phase }; });
        if (g.t === 0 && g.ph === 'move' && (await st(p, () => TAVLA_ENGINE.legal().length))) break;
        if (g.t === 0 && g.ph === 'roll') { await playTurn(p); continue; }
        await p.waitForTimeout(150);
    }
    let s1 = await S(p);
    const before = JSON.stringify(s1.pos);
    await playTurn(p, 'drag');
    let s2 = await S(p);
    expect(s2.steps.length === 1 && JSON.stringify(s2.pos) !== before, 'a checker dragged to a green point moves', JSON.stringify(s2.steps));
    await p.keyboard.press('u');
    await p.waitForTimeout(100);
    s2 = await S(p);
    expect(s2.steps.length === 0 && JSON.stringify(s2.pos) === before, 'u takes it back');
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    s2 = await S(p);
    expect(s2.steps.length === 1, 'arrow keys pick a checker and enter moves it', JSON.stringify(s2.steps));
    // pause: the p key, and minimising the window
    await p.keyboard.press('p');
    expect(await st(p, () => TAVLA_ENGINE.game().paused && TAVLA_ENGINE.over() === 'pause'), 'p pauses');
    await p.keyboard.press('p');
    expect(await st(p, () => !TAVLA_ENGINE.game().paused), 'and p again resumes');
    // play the game out with real clicks
    let turns = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
        const ph = await st(p, () => TAVLA_ENGINE.state().phase);
        if (ph === 'match') break;
        if (!(await playTurn(p, turns % 7 === 3 ? 'drag' : 'click'))) await p.waitForTimeout(60);
        else turns++;
    }
    const end = await S(p);
    expect(end.phase === 'match' && end.result && Math.max(...end.score) >= 1, 'the game is played to the end against the bot', end.score.join('-') + ', ' + turns + ' actions, ' + end.log.length + ' turns, ' + (end.result && end.result.mars ? 'mars' : 'plain'));
    await p.waitForFunction(() => TAVLA_ENGINE.over() === 'result', null, { timeout: 5000 }).catch(() => { });
    expect(await p.locator('.tv-panel', { hasText: 'match over' }).count() === 1, 'the match over panel shows');
    const logLines = await p.locator('#tv-log li').count();
    expect(logLines > 5, 'the move log filled up', logLines + ' lines');
    const stats = await st(p, () => JSON.parse(localStorage.getItem('mrhakan98-tavla-stats') || '{}'));
    expect(stats.games === 1 && stats.matches === 1, 'the game and the match are counted', JSON.stringify(stats));

    // a match in progress survives a reload
    await p.click('.tv-panel [data-act="again"]');
    await p.waitForFunction(() => TAVLA_ENGINE.state().phase !== 'match');
    await st(p, () => TAVLA_ENGINE.fast(5));
    for (let i = 0; i < 30; i++) {
        const s = await S(p);
        if (s.log.length >= 2) break;
        if (!(await playTurn(p))) await p.waitForTimeout(120);
    }
    const saved = await S(p);
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => typeof startMenuAction === 'function');
    await p.evaluate(() => document.getElementById('boot-screen')?.remove());
    await p.evaluate(() => startMenuAction('tavla'));
    await p.waitForSelector('.tv-menu [data-act="continue"]', { timeout: 15000 });
    expect(true, 'after a reload the menu offers to continue the match');
    await p.click('.tv-menu [data-act="continue"]');
    const back = await S(p);
    expect(back.seed === saved.seed && back.log.length >= Math.min(2, saved.log.length) && back.target === 1, 'and continuing brings the same match back', 'seed ' + back.seed + ', ' + back.log.length + ' turns');
    const stats2 = await st(p, () => JSON.parse(localStorage.getItem('mrhakan98-tavla-stats') || '{}'));
    expect(stats2.games === 1, 'the stats survived the reload too');
    // minimise pauses
    await p.locator('.app-window', { has: p.locator('.tv-stage') }).locator('.ie-titlebar-btn', { hasText: '_' }).click();
    await p.waitForFunction(() => TAVLA_ENGINE.game().paused, null, { timeout: 4000 }).catch(() => { });
    expect(await st(p, () => TAVLA_ENGINE.game().paused), 'minimising the window pauses the bot');
    await ctx.close();

    // ===============================================================
    section('a phone');
    // ===============================================================
    const pctx = await context({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const ph = await open(pctx);
    await ph.evaluate(() => startMenuAction('tavla'));
    await ph.waitForSelector('.tv-menu', { timeout: 15000 });
    await ph.locator('.tv-menu [data-act="solo"]').tap();
    await ph.waitForFunction(() => TAVLA_ENGINE.screen() === 'play');
    await st(ph, () => TAVLA_ENGINE.fast(5));
    let tapped = 0;
    for (let i = 0; i < 60 && tapped < 4; i++) { if (await playTurn(ph, 'tap')) tapped++; else await ph.waitForTimeout(120); }
    const lay = await ph.evaluate(() => { const c = document.querySelector('.tv-canvas').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: innerWidth, cl: c.left, cr: c.right, cw: c.width }; });
    expect(lay.sw <= lay.iw && lay.cl >= 0 && lay.cr <= lay.iw, 'nothing sticks out sideways at 390px', JSON.stringify(lay));
    expect(lay.cw > 300, 'the board uses the width', lay.cw + 'px');
    expect(tapped >= 4, 'rolling and moving by touch works', tapped + ' taps played');
    // Rules update immediately, but the destination checker is drawn only after its move animation.
    const painted = await ph.waitForFunction(() => {
        const s = TAVLA_ENGINE.state(), S = TAVLA_ENGINE.sim, cv = document.querySelector('.tv-canvas');
        const look = seat => { for (let r = 0; r < 24; r++) if (S.own(s.pos, seat, r)) { const q = TAVLA_ENGINE.xy(r, seat), b = cv.getBoundingClientRect(); const d = cv.getContext('2d').getImageData(Math.round((q.x - b.left) * cv.width / b.width), Math.round((q.y - b.top) * cv.height / b.height), 1, 1).data; return [...d.slice(0, 3)]; } return null; };
        const white = look(0), red = look(1);
        return white && white[0] > 190 && white[2] > 150 && red && red[0] > 90 && red[1] < 90;
    }, null, { timeout: 3000 }).then(() => true, () => false);
    expect(painted, 'white and red checkers are painted where the rules put them');
    await ph.screenshot({ path: path.join(process.env.TMPDIR || '/tmp', 'tavla-phone.png') });
    await pctx.close();

    // ===============================================================
    section('online, two tabs');
    // ===============================================================
    const octx = await context({ viewport: { width: 1180, height: 900 } });
    const host = await open(octx), guest = await open(octx);
    await host.evaluate(() => openNetplay({ gameId: 'tavla' }));
    await host.waitForSelector('#np-host', { timeout: 15000 });
    await host.selectOption('#np-mode', 'local');
    await host.click('#np-host');
    await host.waitForSelector('.np-code', { timeout: 20000 });
    await host.waitForSelector('[data-opt="points"]', { timeout: 8000 });
    await host.selectOption('[data-opt="points"]', '1');
    const code = (await host.textContent('.np-code')).trim();
    await guest.evaluate(() => openNetplay({ gameId: 'tavla' }));
    await guest.waitForSelector('#np-code', { timeout: 15000 });
    await guest.selectOption('#np-mode', 'local');
    await guest.fill('#np-code', code);
    await guest.click('#np-join');
    await guest.waitForSelector('.np-code', { timeout: 30000 });
    await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
    await guest.click('#np-ready'); await host.waitForTimeout(300);
    await host.click('#np-ready'); await host.waitForTimeout(300);
    await host.click('#np-start');
    await Promise.all([host, guest].map(x => x.waitForFunction(() => window.TAVLA_ENGINE && TAVLA_ENGINE.screen() === 'play' && TAVLA_ENGINE.game().mode === 'online', null, { timeout: 30000 })));
    const seats = await Promise.all([host, guest].map(x => st(x, () => ({ me: TAVLA_ENGINE.game().me, host: TAVLA_ENGINE.game().isHost }))));
    expect(seats[0].me === 0 && seats[0].host && seats[1].me === 1 && !seats[1].host, 'the host is white, the guest red', JSON.stringify(seats));
    await guest.waitForFunction(() => TAVLA_ENGINE.state().target === 1, null, { timeout: 8000 }).catch(() => { });
    expect((await S(guest)).target === 1, 'the lobby\'s match option reaches the game');
    for (const x of [host, guest]) await st(x, () => TAVLA_ENGINE.fast(5));
    // a few turns each, real input on whichever tab has the turn
    let hostActs = 0, guestActs = 0;
    const tt = Date.now();
    while (Date.now() - tt < 60000 && (hostActs < 6 || guestActs < 6)) {
        if (await playTurn(host)) hostActs++;
        else if (await playTurn(guest)) guestActs++;
        else await host.waitForTimeout(80);
    }
    expect(hostActs >= 6 && guestActs >= 6, 'both sides rolled and moved with real input', hostActs + ' host, ' + guestActs + ' guest actions');
    const same = async () => {
        await host.waitForTimeout(400);
        const [a, b] = [await S(host), await S(guest)];
        return { ok: JSON.stringify([a.pos, a.score, a.phase, a.turn, a.rem, a.log.length]) === JSON.stringify([b.pos, b.score, b.phase, b.turn, b.rem, b.log.length]), a, b };
    };
    let cmp = await same();
    expect(cmp.ok, 'both tabs show the same board', 'v ' + cmp.a.v + ' / ' + cmp.b.v);
    // a guest cannot move for the host, or play a move that does not exist
    for (let i = 0; i < 40; i++) { const s = await S(host); if (s.turn === 0) break; if (!(await playTurn(guest))) await guest.waitForTimeout(100); }
    const forgedBefore = JSON.stringify((await S(host)).pos);
    await guest.evaluate(() => { const g = TAVLA_ENGINE.game(); g.session.sendToHost('tavla:act', { a: { t: 'move', from: 23, die: 6 }, n: g.seq + 1 }); g.session.sendToHost('tavla:act', { a: { t: 'move', from: 5, die: 9 }, n: g.seq + 2 }); });
    await host.waitForTimeout(500);
    const afterForge = await S(host);
    expect(afterForge.turn === 0 && JSON.stringify(afterForge.pos) === forgedBefore, 'a guest moving on the host\'s turn, or with a die nobody rolled, changes nothing');
    // the end of the game: white bears off its last checker while red has none off
    await host.evaluate(() => {
        const p = new Array(24).fill(0); p[0] = 1; p[20] = -15;
        TAVLA_ENGINE.force({ p, bar: [0, 0], off: [14, 0] }, 0);
    });
    await guest.waitForFunction(() => TAVLA_ENGINE.state().pos.off[0] === 14, null, { timeout: 8000 });
    expect(true, 'the guest sees the host\'s new position');
    for (let i = 0; i < 20; i++) { const s = await S(host); if (s.phase === 'match') break; if (!(await playTurn(host))) await host.waitForTimeout(150); }
    await guest.waitForFunction(() => TAVLA_ENGINE.state().phase === 'match', null, { timeout: 8000 }).catch(() => { });
    cmp = await same();
    expect(cmp.a.phase === 'match' && cmp.b.phase === 'match' && cmp.a.score.join() === '2,0' && cmp.b.score.join() === '2,0', 'the host bears off and wins by mars, on both screens', cmp.a.score + ' / ' + cmp.b.score);
    await guest.waitForFunction(() => TAVLA_ENGINE.over() === 'result', null, { timeout: 5000 }).catch(() => { });
    expect(await guest.locator('.tv-panel', { hasText: 'match over' }).count() === 1, 'the guest gets the match over panel');
    await host.waitForSelector('.tv-panel [data-act="rematch"]', { timeout: 5000 });
    await host.click('.tv-panel [data-act="rematch"]');
    await guest.waitForFunction(() => TAVLA_ENGINE.state().phase !== 'match' && TAVLA_ENGINE.state().score.join() === '0,0', null, { timeout: 8000 }).catch(() => { });
    cmp = await same();
    expect(cmp.a.phase !== 'match' && cmp.b.score.join() === '0,0' && cmp.a.seed === cmp.b.seed, 'a rematch starts a new match on both screens');
    // the guest walks out: a bot takes the seat and the game goes on
    await guest.close();
    await host.waitForFunction(() => TAVLA_ENGINE.game().bots[1] === 'normal', null, { timeout: 20000 }).catch(() => { });
    expect(await st(host, () => TAVLA_ENGINE.game().bots[1] === 'normal'), 'when the guest leaves a bot takes red');
    const logBefore = (await S(host)).log.length;
    for (let i = 0; i < 40; i++) { const s = await S(host); if (s.log.length >= logBefore + 2) break; if (!(await playTurn(host))) await host.waitForTimeout(150); }
    expect((await S(host)).log.length >= logBefore + 2, 'and the match carries on against it');
    await octx.close();

    expect(errors.length === 0, 'no page errors', errors.join(' | '));
} catch (e) {
    failures++;
    console.log('  FAIL  ' + (e && e.stack || e));
} finally {
    await browser.close();
    server.close();
}
console.log('\n' + (failures ? failures + ' of ' + checks + ' tavla browser checks FAILED' : checks + ' tavla browser checks passed'));
process.exit(failures ? 1 : 0);
