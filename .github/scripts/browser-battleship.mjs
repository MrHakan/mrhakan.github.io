// browser-battleship.mjs — battleship 98 in a real browser: open it from
// Start > games, place the fleet (a touching move is refused), fight a whole
// battle against the bot, close mid-battle and continue, give a save up with
// a new fleet, ignore a broken save, and lay the seas out on a phone.
// Online, two tabs in 'local' mode through the lobby: both place and ready up,
// a whole match by clicks with both pages agreeing on every answer and a
// verified result, a rematch where one side lies (void), and a guest walking
// out mid-battle (forfeit).
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

// ---------------- online helpers ----------------
const O = p => p.evaluate(() => BATTLESHIP_ENGINE.online());
// spy on achievements: the desktop's list may not know battleship's ids yet
const spyAchievements = p => p.evaluate(() => {
    // what this tab writes to its stats, as it writes it
    window.__stats = []; const set = Storage.prototype.setItem, get = Storage.prototype.getItem; let seen = null;
    const K = 'mrhakan98-battleship-stats', parse = v => { try { return JSON.parse(v) || {}; } catch (e) { return {}; } };
    Storage.prototype.getItem = function (k) { const v = get.call(this, k); if (k === K) seen = v; return v; };
    Storage.prototype.setItem = function (k, v) { if (k === K) window.__stats.push({ before: parse(seen), after: parse(v) }); return set.call(this, k, v); };
    window.__ach = []; const real = window.unlockAchievement; window.unlockAchievement = id => { window.__ach.push(id); if (typeof real === 'function') real(id); }; });
async function desktopIn(ctx) {
    const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForFunction(() => typeof startMenuAction === 'function' && typeof openNetplay === 'function');
    await p.evaluate(() => document.getElementById('boot-screen')?.remove());
    await spyAchievements(p);
    return p;
}
async function lobby(ctx) {
    const host = await desktopIn(ctx), guest = await desktopIn(ctx);
    // the host goes through battleship's own menu, the guest through the lobby window
    await host.evaluate(() => startMenuAction('battleship'));
    ok(await menuShown(host), 'online: the host opens battleship');
    await host.click(W + ' [data-act=online]');
    await host.waitForSelector('#np-host', { timeout: 15000 });
    ok(await host.evaluate(() => Netplay.CATALOG.some(g => g.id === 'battleship' && g.min === 2 && g.max === 2) && !!Netplay.games.battleship), 'play online opens the lobby, with battleship in the catalogue and registered');
    await host.selectOption('#np-mode', 'local');
    await host.click('#np-host');
    await host.waitForSelector('.np-code', { timeout: 20000 });
    const code = (await host.textContent('.np-code')).trim();
    await guest.evaluate(() => openNetplay({ gameId: 'battleship' }));
    await guest.waitForSelector('#np-code', { timeout: 15000 });
    await guest.selectOption('#np-mode', 'local');
    await guest.fill('#np-code', code);
    await guest.click('#np-join');
    await guest.waitForSelector('.np-code', { timeout: 30000 });
    await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
    await guest.click('#np-ready');
    await host.click('#np-ready');
    await host.waitForFunction(() => !document.querySelector('#np-start')?.disabled, null, { timeout: 5000 }).catch(() => {});
    await host.click('#np-start');
    await Promise.all([host, guest].map(x => x.waitForFunction(() => window.BATTLESHIP_ENGINE && BATTLESHIP_ENGINE.online() && BATTLESHIP_ENGINE.phase() === 'place', null, { timeout: 30000 })));
    return { host, guest };
}
// both sides place (a shuffle, then ready) with real clicks; the guest sees the host ready first
async function readyUp(host, guest) {
    await host.click(W + ' [data-act=random]');
    await host.click(W + ' [data-act=ready]');
    const seen = await guest.waitForSelector(W + ' .bs-opp[data-ready="1"]', { timeout: 8000 }).then(() => true, () => false);
    ok(seen && /is ready/.test(await guest.textContent(W + ' .bs-opp')), 'the guest sees that the host is ready');
    ok(await guest.evaluate(() => BATTLESHIP_ENGINE.phase()) === 'place', 'and is still placing its own fleet');
    await guest.click(W + ' [data-act=random]');
    await guest.click(W + ' [data-act=ready]');
    await Promise.all([host, guest].map(x => x.waitForFunction(() => BATTLESHIP_ENGINE.phase() === 'battle', null, { timeout: 8000 })));
}
// fire, by clicks, wherever the hard bot would, until both pages are over
async function battle(host, guest, maxShots) {
    let shooter = (await O(host)).duel.turn === 'me' ? host : guest, shots = 0;
    while (shots < (maxShots || 400)) {
        await shooter.waitForFunction(() => { const o = BATTLESHIP_ENGINE.online(); return o.duel.over || (o.duel.turn === 'me' && !o.duel.pending); }, null, { timeout: 8000 });
        if ((await O(shooter)).duel.over) break;
        const c = await shooter.evaluate(() => BATTLESHIP_ENGINE.hint());
        await shooter.click(`${W} .bs-sea[data-side="1"] .bs-cell[data-x="${c.x}"][data-y="${c.y}"]`);
        shots++;
        shooter = shooter === host ? guest : host;
    }
    return shots;
}
const endShown = (p, v, ms) => p.waitForSelector(`${W} .bs-online-end[data-verdict="${v}"]`, { timeout: ms || 10000 }).then(() => true, () => false);

async function online() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route('**/*', r => r.request().url().startsWith(BASE) || r.request().url().startsWith('data:') || r.request().url().startsWith('blob:') ? r.continue() : r.abort());
    await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (_) {} });
    const { host, guest } = await lobby(ctx);
    await host.evaluate(() => { localStorage.removeItem('mrhakan98-battleship-stats'); localStorage.removeItem('mrhakan98-battleship-save'); });
    const seats = [await O(host), await O(guest)];
    ok(seats[0].host && seats[0].me === 0 && !seats[1].host && seats[1].me === 1, 'the lobby seats the host and the guest in the game');

    // ---- an honest match to the end ----
    await readyUp(host, guest);
    const turns = [await O(host), await O(guest)].map(o => o.duel.turn);
    ok(turns[0] !== turns[1], 'exactly one side opens (' + turns.join(' / ') + ')');
    // a click on the other side's turn fires nothing
    const waiter = turns[0] === 'me' ? guest : host;
    await waiter.locator(`${W} .bs-sea[data-side="1"] .bs-cell[data-x="0"][data-y="0"]`).click({ force: true });
    const w0 = await O(waiter);
    ok(w0.duel.pending === null && w0.duel.mine.length === 0, 'clicking on the other side\'s turn fires nothing');
    const shots = await battle(host, guest);
    const [a, b] = [await O(host), await O(guest)];
    ok(a.duel.over && b.duel.over, 'the match is played to the end with ' + shots + ' clicked shots');
    ok(JSON.stringify(a.duel.mine) === JSON.stringify(b.duel.theirs) && JSON.stringify(a.duel.theirs) === JSON.stringify(b.duel.mine), 'both pages agree on every shot and its answer');
    ok((a.duel.over === 'me') === (b.duel.over === 'them'), 'and on who sank whom (host ' + a.duel.over + ', guest ' + b.duel.over + ')');
    ok(await endShown(host, 'verified') && await endShown(guest, 'verified'), 'the result dialog says verified on both pages');
    await Promise.all([host, guest].map(x => x.waitForFunction(() => BATTLESHIP_ENGINE.online().theirVerdict === 'verified', null, { timeout: 8000 }).catch(() => {})));
    const [a2, b2] = [await O(host), await O(guest)];
    ok(a2.outcome.verdict === 'verified' && b2.outcome.verdict === 'verified' && (a2.outcome.winner === 'me') === (b2.outcome.winner === 'them') && a2.outcome.winner !== b2.outcome.winner, 'one winner, the same on both pages (host ' + a2.outcome.winner + ')');
    ok(a2.theirVerdict === 'verified' && b2.theirVerdict === 'verified', 'each side hears that the other verified its fleet too');
    ok(/verified/.test(await host.textContent(W + ' .bs-verdict')) && /checked yours: verified/.test(await guest.textContent(W + ' .bs-online-end')), 'in words, on the dialog');
    const winner = a2.outcome.winner === 'me' ? host : guest, loser = winner === host ? guest : host;
    ok(/victory/.test(await winner.textContent(W + ' .bs-dlg-bar')) && /defeat/.test(await loser.textContent(W + ' .bs-dlg-bar')), 'victory on one, defeat on the other');
    ok((await winner.evaluate(() => window.__ach)).includes('battleship_online') && !(await loser.evaluate(() => window.__ach)).includes('battleship_online'), 'the verified winner gets battleship_online, the loser does not');
    // Both tabs share one localStorage here, and Chrome syncs it between tabs on its
    // own schedule, so two writes in the same moment can lose one. A real player has
    // their own. So read what each tab itself wrote, not the shared result.
    const wrote = await Promise.all([winner, loser].map(x => x.evaluate(() => (window.__stats || []).slice(-1)[0] || null)));
    const delta = w => w && JSON.stringify(['onlineGames', 'onlineWins', 'onlineLosses', 'games', 'wins'].map(f => (w.after[f] || 0) - (w.before[f] || 0)));
    ok(delta(wrote[0]) === '[1,1,0,0,0]' && delta(wrote[1]) === '[1,0,1,0,0]', 'online results go to the stats\' online fields, not the bot battles ' + JSON.stringify(wrote));
    ok(await host.evaluate(() => localStorage.getItem('mrhakan98-battleship-save') === null), 'and nothing is written to the single player save');
    // the loser never hit every cell of the winner's fleet: the rest comes from the reveal
    const lo = loser === host ? a : b;
    const unseen = 17 - lo.duel.mine.filter(s => s.result !== 'miss').length;
    const drawn = await loser.locator(W + ' .bs-sea[data-side="1"] .bs-ship.bs-left').count();
    ok(unseen > 0 && drawn === unseen, 'the loser sees the rest of the revealed fleet in their waters (' + drawn + ' of ' + unseen + ' cells)');
    await host.screenshot({ path: path.join(SHOTS, 'battleship-online.png') });

    // ---- a rematch with a liar: the guest answers one hit with a miss ----
    await loser.click(W + ' .bs-dlg [data-act=rematch]');
    const asked = await winner.waitForFunction(sel => /wants a rematch/.test(document.querySelector(sel + ' .bs-online-end')?.textContent || ''), W, { timeout: 8000 }).then(() => true, () => false);
    ok(asked, 'a rematch: the other side is told it is wanted');
    await winner.click(W + ' .bs-dlg [data-act=rematch]');
    await Promise.all([host, guest].map(x => x.waitForFunction(() => BATTLESHIP_ENGINE.phase() === 'place' && BATTLESHIP_ENGINE.online().mid === 1, null, { timeout: 8000 })));
    await readyUp(host, guest);
    await guest.evaluate(() => BATTLESHIP_ENGINE.lie(1));
    await guest.evaluate(() => { window.__ach = []; });
    await battle(host, guest);
    ok(await endShown(host, 'void'), 'the honest host catches the lie: the result says void');
    ok(/answered miss/.test(await host.textContent(W + ' .bs-online-end')), 'and says which shot was answered falsely');
    ok(await endShown(guest, 'verified'), 'while the liar still finds the host\'s fleet verified');
    await guest.waitForFunction(() => BATTLESHIP_ENGINE.online().theirVerdict === 'void', null, { timeout: 8000 }).catch(() => {});
    ok(/checked yours: void/.test(await guest.textContent(W + ' .bs-online-end')), 'and is told the host found its answers void');
    ok(!(await guest.evaluate(() => window.__ach)).includes('battleship_online'), 'a liar earns no achievement, whoever sank whom');

    // ---- a third match: the guest walks out mid-battle ----
    await host.click(W + ' .bs-dlg [data-act=rematch]');
    await guest.click(W + ' .bs-dlg [data-act=rematch]');
    await Promise.all([host, guest].map(x => x.waitForFunction(() => BATTLESHIP_ENGINE.phase() === 'place' && BATTLESHIP_ENGINE.online().mid === 2, null, { timeout: 8000 })));
    await readyUp(host, guest);
    await battle(host, guest, 4);
    const before = await host.evaluate(() => JSON.parse(localStorage.getItem('mrhakan98-battleship-stats')));
    const errs = guest.errors.slice();
    await guest.close();
    ok(await endShown(host, 'forfeit', 25000), 'when the guest leaves mid-battle the host wins by forfeit');
    const ft = await host.textContent(W + ' .bs-online-end');
    ok(/can't be handed to a bot/.test(ft) && /you win/.test(ft), 'and the dialog says why no bot finishes it');
    ok(!(await host.locator(W + ' .bs-dlg [data-act=rematch]').count()), 'with no rematch on offer');
    const after = await host.evaluate(() => JSON.parse(localStorage.getItem('mrhakan98-battleship-stats')));
    ok(after.onlineWins === before.onlineWins + 1 && after.onlineGames === before.onlineGames + 1, 'the forfeit counts as an online win');
    await host.click(W + ' .bs-dlg [data-act=menu]');
    ok(await menuShown(host) && (await O(host)) === null, 'menu leaves the online match for the single player menu');
    ok(!host.errors.length && !errs.length, 'no page errors online ' + host.errors.concat(errs).join(' | '));
    await ctx.close();
}
try {
    // ---------------- desktop ----------------
    const { ctx, p } = await desktop({ width: 1366, height: 768 });
    await p.evaluate(() => localStorage.removeItem('mrhakan98-battleship-stats'));
    await spyAchievements(p);
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
    const ach = await p.evaluate(() => window.__ach);
    ok(end.over === 'you' ? ach.includes('battleship_win') && !ach.includes('battleship_hard') : !ach.length, 'achievements: battleship_win only for a win, battleship_hard not against normal (' + ach.join() + ')');
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
    const wide = await q.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok(wide.sw <= wide.iw, 'nothing sticks out sideways at 390 px (' + wide.sw + ' / ' + wide.iw + ')');
    ok(!q.errors.length, 'no page errors on the phone ' + q.errors.join(' | '));
    await phone.ctx.close();

    // ---------------- online, two tabs ----------------
    try { await online(); } catch (e) { ok(false, 'online: ' + (e && e.stack || e)); }
} finally { await browser.close(); server.close(); }
console.log(fail ? fail + ' battleship browser checks FAILED' : 'battleship browser checks passed');
process.exit(fail ? 1 : 0);
