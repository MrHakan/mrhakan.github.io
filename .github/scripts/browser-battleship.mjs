// browser-battleship.mjs — battleship 98 in a real browser: open it from
// Start > games, place the fleet (a touching move is refused), fight a whole
// battle against the bot, close mid-battle and continue, give a save up with
// a new fleet, ignore a broken save, and lay the seas out on a phone.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const SHOTS = process.env.SHOT_DIR || path.join(ROOT, '.ci-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL  ') + m); if (!c) fail++; };
const SAVE = 'mrhakan98-battleship-save';
// the live window: a closing one keeps an empty id until its fade ends
const W = '.battleship-window[id^="app-win"]';

async function desktop(viewport) {
    const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
    await ctx.route('**/*', r => r.request().url().startsWith(BASE) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
    await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (_) {} });
    const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForFunction(() => typeof startMenuAction === 'function' && typeof openBattleship === 'function');
    await p.evaluate(() => document.getElementById('boot-screen')?.remove());
    return { ctx, p };
}
const menuShown = p => p.waitForSelector(W + ' .bs-over:not([hidden]) .bs-title', { timeout: 10000 }).then(() => true, () => false);
const acts = p => p.$$eval(W + ' .bs-actions button', bs => bs.map(b => b.dataset.act));
async function closeWin(p) {
    await p.evaluate(sel => closeAppWindow(document.querySelector(sel).id), W);
    await p.waitForFunction(() => !document.querySelector('.battleship-window'), null, { timeout: 3000 }).catch(() => {});
}
async function reopen(p) { await closeWin(p); await p.evaluate(() => startMenuAction('battleship')); return menuShown(p); }
const state = p => p.evaluate(() => JSON.stringify(BATTLESHIP_ENGINE.state()));
// fire at the first open cell in enemy waters, by a real click, on our turn
async function shoot(p) {
    await p.waitForFunction(() => BATTLESHIP_ENGINE.phase() !== 'battle' || BATTLESHIP_ENGINE.state().turn === 0, null, { timeout: 5000 });
    if (await p.evaluate(() => BATTLESHIP_ENGINE.phase()) !== 'battle') return false;
    await p.locator(W + ' .bs-sea[data-side="1"] .bs-cell:not([disabled])').first().click();
    return true;
}

try {
    // ---------------- desktop ----------------
    const { ctx, p } = await desktop({ width: 1366, height: 768 });
    await p.evaluate(() => localStorage.removeItem('mrhakan98-battleship-stats'));
    await p.click('#start-button').catch(() => p.evaluate(() => document.querySelector('[onclick*="toggleStartMenu"], #start-btn')?.click()));
    const games = p.locator('.start-sub', { has: p.locator('.has-sub', { hasText: 'games' }) }).first();
    await games.locator('.has-sub').hover();
    await p.waitForTimeout(300);
    await games.locator('.start-item', { hasText: 'battleship 98' }).click();
    ok(await menuShown(p), 'start > games > battleship 98 opens a desktop window with its menu');
    ok(/goal: sink all five enemy ships/.test(await p.textContent(W + ' .bs-over')), 'the menu says the goal in one line');
    await p.click(W + ' [data-act=level][data-v=normal]');
    await p.click(W + ' [data-act=place]');
    ok(await p.evaluate(() => BATTLESHIP_ENGINE.phase()) === 'place', 'place your fleet starts the placing');

    // a refused move and an accepted one, worked out from the fleet on screen
    const plan = await p.evaluate(() => {
        const S = BATTLESHIP_SIM, f = BATTLESHIP_ENGINE.fleet();
        let bad = null, good = null;
        for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
            if (f.some(s => S.cellsOf(s).some(([cx, cy]) => cx === x && cy === y))) continue;     // a ship's cell would pick that ship up
            const why = S.fleetProblem(f.map((s, i) => (i === 0 ? Object.assign({}, s, { x, y }) : s)));
            if (why && /touch|overlap/.test(why) && !bad) bad = { x, y };
            if (!why && !good && (x !== f[0].x || y !== f[0].y)) good = { x, y };
        }
        return { f0: f[0], bad, good };
    });
    const cell = (side, c) => `${W} .bs-sea[data-side="${side}"] .bs-cell[data-x="${c.x}"][data-y="${c.y}"]`;
    await p.click(cell(0, plan.f0));
    ok(/picked up the 5/.test(await p.textContent(W + ' .bs-msg')), 'clicking a ship picks it up');
    await p.click(cell(0, plan.bad));
    const afterBad = await p.evaluate(() => BATTLESHIP_ENGINE.fleet()[0]);
    ok(afterBad.x === plan.f0.x && afterBad.y === plan.f0.y && /can't go there/.test(await p.textContent(W + ' .bs-msg')), 'a move that makes ships touch is refused, and says why');
    await p.click(cell(0, plan.good));
    const afterGood = await p.evaluate(() => BATTLESHIP_ENGINE.fleet()[0]);
    ok(afterGood.x === plan.good.x && afterGood.y === plan.good.y, 'a legal move puts the bow where you clicked');
    await p.click(W + ' [data-act=battle]');
    ok(await p.evaluate(() => BATTLESHIP_ENGINE.phase() === 'battle' && BATTLESHIP_ENGINE.state().level === 'normal'), 'start battle: against the normal bot');
    await p.evaluate(() => BATTLESHIP_ENGINE.speed(40));

    // the keyboard fires too
    await p.focus(W + ' .bs-app');
    await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter');
    ok(await p.evaluate(() => BATTLESHIP_ENGINE.state().shots[0].length === 1 && BATTLESHIP_ENGINE.state().shots[0][0].x === 5), 'arrows aim and enter fires');
    for (let i = 0; i < 3; i++) await shoot(p);
    await p.waitForFunction(() => BATTLESHIP_ENGINE.state().turn === 0);
    const mid = await state(p);
    ok(JSON.parse(mid).shots[0].length === 4 && JSON.parse(mid).shots[1].length === 4, 'turns alternate: 4 shots each');

    // close mid-battle, continue
    ok(await reopen(p), 'closing mid-battle and opening again shows the menu');
    ok((await acts(p)).includes('continue'), 'which offers to continue the battle');
    await p.click(W + ' [data-act=continue]');
    ok(await state(p) === mid, 'continue brings back exactly the same battle');
    ok(await p.locator(W + ' .bs-sea[data-side="1"] :is(.bs-miss, .bs-hit, .bs-sunk)').count() === 4, 'with its four shots marked in enemy waters');

    // fight it out
    await p.evaluate(() => BATTLESHIP_ENGINE.speed(50));
    for (let i = 0; i < 120 && await shoot(p); i++);
    const end = await p.evaluate(() => ({ phase: BATTLESHIP_ENGINE.phase(), over: BATTLESHIP_SIM.over(BATTLESHIP_ENGINE.state()), bar: document.querySelector('.battleship-window[id^="app-win"] .bs-dlg-bar')?.textContent }));
    ok(end.phase === 'over' && (end.over === 'you' ? end.bar === 'victory' : end.bar === 'defeat'), 'the battle ends on the ' + end.bar + ' screen');
    ok(await p.evaluate(k => localStorage.getItem(k) === null, SAVE), 'and the save is gone');
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('mrhakan98-battleship-stats')));
    ok(st && st.games === 1 && st.wins === (end.over === 'you' ? 1 : 0), 'the stats count the battle');
    await p.screenshot({ path: path.join(SHOTS, 'battleship-end.png') });

    // a new fleet gives the saved battle up
    await p.click(W + ' .bs-dlg [data-act=again]');     // the end dialog's own button: the toolbar one sits under it
    await p.click(W + ' [data-act=battle]');
    await shoot(p);
    ok(await reopen(p) && (await acts(p)).includes('continue'), 'another battle is saved after a shot');
    await p.click(W + ' [data-act=place]');
    ok(await reopen(p), 'close while placing a new fleet, open again');
    ok(!(await acts(p)).includes('continue'), 'no continue: the new fleet gave the old battle up');

    // a broken save is ignored
    await p.evaluate(k => localStorage.setItem(k, JSON.stringify({ g: { fleets: [5], shots: [], winner: null } })), SAVE);
    ok(await reopen(p) && !(await acts(p)).includes('continue'), 'a broken save offers no continue');
    ok(!p.errors.length, 'no page errors on the desktop ' + p.errors.join(' | '));
    await ctx.close();

    // ---------------- phone ----------------
    const phone = await desktop({ width: 390, height: 844 });
    const q = phone.p;
    await q.evaluate(() => { localStorage.removeItem('mrhakan98-battleship-save'); startMenuAction('battleship'); });
    ok(await menuShown(q), 'a phone opens it too');
    await q.click(W + ' [data-act=place]');
    const lay = () => q.evaluate(sel => {
        const r = s => document.querySelector(sel + ' .bs-sea[data-side="' + s + '"]').getBoundingClientRect();
        const tools = document.querySelector(sel + ' .bs-tools').getBoundingClientRect();
        const bar = document.getElementById('taskbar')?.getBoundingClientRect().top ?? innerHeight;
        return { mine: r(0), theirs: r(1), toolsBottom: tools.bottom, bar };
    }, W);
    let L = await lay();
    ok(L.theirs.height === 0 && L.mine.height > 0, 'placing on a phone shows only your sea');
    ok(L.toolsBottom <= L.bar + 1, 'with the buttons above the taskbar');
    await q.click(W + ' [data-act=battle]');
    L = await lay();
    ok(L.theirs.top < L.mine.top, 'in battle the enemy sea comes first');
    ok(L.theirs.right <= 390 && L.theirs.width / 11 >= 24, 'and fits the screen with cells big enough to tap (' + Math.round(L.theirs.width / 11) + ' px)');
    await q.screenshot({ path: path.join(SHOTS, 'battleship-phone.png') });
    ok(!q.errors.length, 'no page errors on the phone ' + q.errors.join(' | '));
    await phone.ctx.close();
} finally { await browser.close(); server.close(); }
console.log(fail ? fail + ' battleship browser checks FAILED' : 'battleship browser checks passed');
process.exit(fail ? 1 : 0);
