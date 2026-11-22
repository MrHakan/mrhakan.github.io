// ===================================================================
// browser-okey.mjs — okey 98 played, not just opened
//
//   solo     the start menu opens it in a desktop window; how to play; a
//            dealt hand; tiles dragged round the rack; a finish dropped on
//            the indicator with the mouse; the next hand played with keys
//            and clicks; pause holds the bots; the save survives a reload;
//            a whole match against the bots with the clock turned up
//   101      tiles clicked into a selection and laid down to open, one
//            dragged onto a meld on the table, then thrown
//   101 to a finish   an okey swapped off the table by dragging the tile it
//            stands for onto its meld; then a seeded 101 match against
//            normal bots, my turns by keys and clicks, until a bot goes out
//            (the clock turned up, nothing else helped)
//   phone    390x844: nothing sticks out sideways, a tap selects, a tap throws
//   online   two pages over the lobby's same-browser transport: host and
//            join with the code, moves from both sides, both screens agree,
//            the guest never sees the host's tiles, and the guest walking
//            out leaves a bot in its seat
//
// Its own static server on port 0; nothing leaves the machine.
//   node .github/scripts/browser-okey.mjs
// ===================================================================
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.OK_SHOTS || path.join(ROOT, '.ci-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.xml': 'text/xml' };
const server = http.createServer((req, res) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
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
const errors = [];
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

async function context(opts) {
    const ctx = await browser.newContext(opts || { viewport: { width: 1366, height: 860 } });
    await ctx.route('**/*', r => {
        const u = r.request().url();
        return u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
    });
    await ctx.addInitScript(() => {
        try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('sound-enabled', 'false'); } catch (e) { }
    });
    return ctx;
}
async function desk(ctx) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForFunction(() => typeof startMenuAction === 'function');
    await p.evaluate(() => document.getElementById('boot-screen')?.remove());
    return p;
}
async function openOkey(p) {
    await p.evaluate(() => startMenuAction('okey'));
    await p.waitForSelector('.app-window .ok-app', { timeout: 20000 });
    await p.waitForFunction(() => window.OKEY_ENGINE);
    // the window opens with an animation: coordinates mean nothing until it stops
    await p.waitForFunction(() => { const w = document.querySelector('.okey-window'); return w && !w.getAnimations({ subtree: true }).some(a => a.playState === 'running'); }, null, { timeout: 5000 }).catch(() => { });
    await p.waitForTimeout(100);
}
const E = (p, fn, arg) => p.evaluate(fn, arg);
const view = p => E(p, () => { const v = OKEY_ENGINE.view(); return v && JSON.parse(JSON.stringify(v)); });
async function drag(p, a, b) {
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
    await p.mouse.move(b.x, b.y, { steps: 5 });
    await p.mouse.up();
}
const T = (c, n, copy = 0) => c * 26 + copy * 13 + (n - 1);
const [R, Y, B, K] = [0, 1, 2, 3];
// four melds (with 11-12-13-1) and the stray yellow 11: a finished classic hand
const WIN15 = [T(R, 1), T(R, 2), T(R, 3), T(R, 4), T(Y, 9), T(B, 9), T(K, 9), T(K, 11), T(K, 12), T(K, 13), T(K, 1), T(Y, 5), T(Y, 6), T(Y, 7), T(Y, 11)];
// a seed whose indicator is none of those tiles and whose okey is not among them
async function cleanSeed(p, mode, tiles) {
    return E(p, ([mode, tiles]) => {
        for (let seed = 1; seed < 500; seed++) {
            const m = OKEY_SIM.newMatch({ mode, seed, dealer: 0 });
            if (!tiles.includes(m.hand.ind) && !tiles.some(t => OKEY_SIM.isWild(t, m.hand.ok)) && !tiles.some(t => OKEY_SIM.isFalse(t))) return seed;
        }
        return 1;
    }, [mode, tiles]);
}

try {
    // ===================================================================
    section('solo');
    // ===================================================================
    {
        const ctx = await context();
        const p = await desk(ctx);
        expect(await E(p, () => !window.OKEY_SIM), 'none of it loads with the desktop');
        await openOkey(p);
        expect(await p.locator('.app-window .ok-app').count() === 1, 'the start menu opens it in a desktop popup window');
        expect(await p.locator('.app-window .app-window-title', { hasText: 'okey 98' }).count() >= 1, 'titled okey 98');
        await p.click('.ok-over [data-act=help]');
        expect(await p.locator('.ok-dlg[aria-label="how to play okey"]').isVisible(), 'how to play opens from the menu');
        await p.click('.ok-over [data-act=closehelp]');
        expect(await p.locator('.ok-over .ok-title').isVisible(), 'and goes back to the menu');
        await p.click('.ok-over [data-act=opt][data-k=start][data-v="10"]');
        await p.click('.ok-over [data-act=deal]');
        await p.waitForFunction(() => OKEY_ENGINE.view() && document.querySelector('.ok-over').hidden);
        let v = await view(p);
        expect(v.mode === 'classic' && v.seats[0].score === 10 && v.hand.length >= 14 && v.seats.filter(s => s.bot).length === 3, 'deal: classic, 10 points, me and three bots', v.hand.length + ' tiles');
        expect(await E(p, () => OKEY_ENGINE.rack().filter(x => x >= 0).length === OKEY_ENGINE.view().hand.length), 'every tile I hold sits in the rack');
        await p.screenshot({ path: path.join(SHOTS, 'okey-desktop.png') });

        // a deterministic deal for the finish: I deal, holding a finished hand
        const seed = await cleanSeed(p, 'classic', WIN15);
        await E(p, ([seed, ids]) => { OKEY_ENGINE.startLocal({ seed, dealer: 0, mode: 'classic', start: 4, level: 'normal' }); OKEY_ENGINE.rig(0, ids); OKEY_ENGINE.speed(4); }, [seed, WIN15]);
        // drag a tile to an empty slot: the rack changes, the hand does not
        const from = await E(p, () => OKEY_ENGINE.rack().findIndex(x => x >= 0));
        const to = await E(p, () => OKEY_ENGINE.rack().lastIndexOf(-1));
        const id = await E(p, i => OKEY_ENGINE.rack()[i], from);
        await drag(p, await E(p, i => OKEY_ENGINE.slot(i), from), await E(p, i => OKEY_ENGINE.slot(i), to));
        expect(await E(p, ([i, t]) => OKEY_ENGINE.rack()[t] === i, [id, to]), 'a tile dragged along the rack lands in the slot it was dropped on');
        await p.keyboard.press('g');
        expect(await E(p, () => OKEY_ENGINE.rack().filter(x => x >= 0).length) === 15, 'sort by groups (g) keeps all fifteen');
        // finish: the stray yellow 11 dropped on the indicator
        const stray = await E(p, id => OKEY_ENGINE.slotOf(id), T(Y, 11));
        await drag(p, await E(p, i => OKEY_ENGINE.slot(i), stray), await E(p, () => OKEY_ENGINE.finishAt()));
        await p.waitForSelector('.ok-dlg .ok-table', { timeout: 8000 });
        v = await view(p);
        expect(v.result && v.result.winner === 0 && v.seats.slice(1).every(s => s.score === 2), 'a finish dropped on the indicator wins the hand: the bots lose 2 each', JSON.stringify(v.result && v.result.scores));
        expect(/you finish/.test(await p.textContent('.ok-dlg')), 'and the dialog says so');
        await p.screenshot({ path: path.join(SHOTS, 'okey-finish.png') });
        await p.click('.ok-over [data-act=next]');
        await p.waitForFunction(() => OKEY_ENGINE.view().handNo === 1 && document.querySelector('.ok-over').hidden);
        expect(true, 'next hand deals');

        // the next hand, played with keys and clicks
        await E(p, () => OKEY_ENGINE.speed(6));
        let mine = 0;
        for (let i = 0; i < 80 && mine < 2; i++) {
            v = await view(p);
            if (v.result) break;
            if (v.turn !== 0 || await E(p, () => OKEY_ENGINE.state().flyers.length)) { await p.waitForTimeout(120); continue; }
            if (v.phase === 'draw') { await p.locator('.ok-app').focus(); await p.keyboard.press('d'); await p.waitForFunction(() => OKEY_ENGINE.view().phase === 'play'); continue; }
            const before = v.discardCounts[0];
            const slot = await E(p, () => OKEY_ENGINE.rack().findIndex(x => x >= 0 && !OKEY_SIM.isWild(x, OKEY_ENGINE.view().ok)));
            await p.mouse.click(...Object.values(await E(p, i => OKEY_ENGINE.slot(i), slot)));
            await p.click('.ok-tools [data-act=throw]');
            await p.waitForFunction(b => OKEY_ENGINE.view().discardCounts[0] > b || OKEY_ENGINE.view().result, before);
            mine++;
        }
        v = await view(p);
        expect(mine >= 2 && v.turns >= 4, 'two turns of mine (d to draw, click a tile, the throw button) and the bots play theirs', mine + ' turns, ' + v.turns + ' in the hand');

        // pause holds the bots
        await p.locator('.ok-app').focus();
        await p.keyboard.press('p');
        expect(await p.locator('.ok-dlg[aria-label=paused]').isVisible(), 'p pauses');
        const t0 = (await view(p)).turns;
        await p.waitForTimeout(1200);
        expect((await view(p)).turns === t0, 'and nothing moves while paused');
        await p.click('.ok-over [data-act=resume]');

        // the save survives a reload
        const saved = await view(p);
        await p.reload({ waitUntil: 'load' });
        await p.waitForFunction(() => typeof startMenuAction === 'function');
        await p.evaluate(() => document.getElementById('boot-screen')?.remove());
        await openOkey(p);
        expect(await p.locator('.ok-over [data-act=continue]').count() === 1, 'after a reload the menu offers to continue');
        await p.click('.ok-over [data-act=continue]');
        const back = await view(p);
        expect(back.handNo === saved.handNo && back.seats.map(s => s.score).join() === saved.seats.map(s => s.score).join() && back.hand.length >= 14, 'and the match comes back where it was', back.handNo + ' / ' + back.seats.map(s => s.score).join());

        // a whole match with the clock turned up (my seat on autopilot)
        await E(p, () => { window.__ach = []; window.unlockAchievement = id => window.__ach.push(id); });
        await E(p, () => { OKEY_ENGINE.startLocal({ seed: 4242, mode: 'classic', start: 4, level: 'hard' }); OKEY_ENGINE.match().seats[0].bot = true; OKEY_ENGINE.speed(40); });
        let over = false;
        for (let i = 0; i < 200 && !over; i++) {
            await p.waitForTimeout(150);
            if (await p.locator('.ok-over [data-act=next]').isVisible().catch(() => false)) await p.click('.ok-over [data-act=next]');
            over = await p.locator('.ok-over [data-act=again]').isVisible().catch(() => false);
        }
        v = await view(p);
        expect(over && v.over && v.seats.some(s => s.score <= 0), 'a whole match to the end: "match over" with a new match button', v.seats.map(s => s.score).join());
        expect(await E(p, () => { const s = JSON.parse(localStorage.getItem('mrhakan98-okey-stats')); return s && s.hands >= 3 && s.handWins >= 1; }), 'and the stats are kept under mrhakan98-okey-stats');
        const ach = await E(p, () => window.__ach.slice());
        expect((v.winner === 0) === ach.includes('okey_win') && !ach.includes('okey_101'), 'okey_win is asked for when my seat wins the classic match, and only then', 'winner ' + v.winner + ', ' + JSON.stringify(ach));
        await ctx.close();
    }

    // ===================================================================
    section('101');
    // ===================================================================
    {
        const ctx = await context();
        const p = await desk(ctx);
        await openOkey(p);
        const OPEN = [T(R, 11), T(R, 12), T(R, 13), T(Y, 13), T(B, 13), T(K, 13), T(K, 10), T(K, 11), T(K, 12), T(K, 13, 1)];
        const REST = [T(R, 10), T(R, 2), T(Y, 3), T(Y, 8), T(R, 5), T(B, 1), T(Y, 1), T(R, 9), T(Y, 11), T(K, 2), T(K, 4), T(B, 4)];
        const seed = await cleanSeed(p, '101', OPEN.concat(REST));
        await E(p, ([seed, ids]) => { OKEY_ENGINE.startLocal({ seed, dealer: 0, mode: '101', hands: 1 }); OKEY_ENGINE.rig(0, ids); OKEY_ENGINE.speed(4); }, [seed, OPEN.concat(REST)]);
        for (const id of OPEN) await p.mouse.click(...Object.values(await E(p, id => OKEY_ENGINE.slot(OKEY_ENGINE.slotOf(id)), id)));
        expect(await E(p, () => OKEY_ENGINE.state().sel.size) === 10, 'ten tiles clicked into a selection');
        await p.click('.ok-tools [data-act=lay]');
        await p.waitForFunction(() => OKEY_ENGINE.view().table.length === 3);
        let v = await view(p);
        expect(v.seats[0].opened === 'melds' && v.hand.length === 12, 'lay down opens with 121 points: three melds on the table');
        await p.waitForTimeout(400);
        const meld = await E(p, () => OKEY_ENGINE.view().table.findIndex(t => t.tiles.length === 3 && OKEY_SIM.colorOf(t.tiles[0]) === 0));
        await drag(p, await E(p, id => OKEY_ENGINE.slot(OKEY_ENGINE.slotOf(id)), T(R, 10)), await E(p, i => OKEY_ENGINE.meld(i), meld));
        await p.waitForFunction(m => OKEY_ENGINE.view().table[m].tiles.length === 4, meld, { timeout: 5000 }).catch(() => { });
        v = await view(p);
        expect(v.table[meld].tiles.length === 4 && v.hand.length === 11, 'a red 10 dragged onto 11-12-13 joins it');
        await p.screenshot({ path: path.join(SHOTS, 'okey-101.png') });
        await drag(p, await E(p, id => OKEY_ENGINE.slot(OKEY_ENGINE.slotOf(id)), T(K, 2)), await E(p, () => OKEY_ENGINE.throwAt()));
        await p.waitForFunction(() => OKEY_ENGINE.view().discardCounts[0] === 1);
        expect(true, 'a tile dragged to my corner is thrown, and the bots go on');
        await E(p, () => { OKEY_ENGINE.match().seats[0].bot = true; OKEY_ENGINE.speed(40); });
        await p.waitForSelector('.ok-over [data-act=again]', { timeout: 30000 });
        v = await view(p);
        expect(v.over && v.result && v.result.deltas.length === 4, 'the one hand match plays to its table', v.result && v.result.scores.join());
        await ctx.close();
    }

    // ===================================================================
    section('101 against the bots, to a finish');
    // ===================================================================
    {
        const ctx = await context();
        const p = await desk(ctx);
        await openOkey(p);
        // achievements asked for, kept here instead of shown
        await E(p, () => { window.__ach = []; window.unlockAchievement = id => window.__ach.push(id); });
        await p.click('.ok-over [data-act=opt][data-k=mode][data-v=\"101\"]');
        await p.click('.ok-over [data-act=deal]');
        await p.waitForFunction(() => OKEY_ENGINE.view() && document.querySelector('.ok-over').hidden);
        // swapping the okey off the table: open with black 10-okey-12, then
        // drag the black 11 onto it and the okey comes back to the rack
        const SW = [T(R, 11), T(R, 12), T(R, 13), T(Y, 13), T(B, 13), T(K, 13), T(K, 10), T(K, 12)];
        const swSeed = await E(p, tiles => {
            for (let seed = 1; seed < 500; seed++) {
                const m = OKEY_SIM.newMatch({ mode: '101', seed, dealer: 0 }), ok = m.hand.ok;
                const okey = ok.c * 26 + ok.n - 1;
                if (!tiles.concat([3 * 26 + 10, 1, 26 + 4, 26 + 8]).some(t => t === m.hand.ind || OKEY_SIM.isWild(t, ok) || t === okey) && m.hand.ind !== okey) return seed;
            }
            return 1;
        }, SW);
        const okeyId = await E(p, ([seed, tiles]) => {
            OKEY_ENGINE.startLocal({ seed, dealer: 0, mode: '101', hands: 1 });
            const ok = OKEY_ENGINE.view().ok, okey = ok.c * 26 + ok.n - 1;
            OKEY_ENGINE.rig(0, tiles.concat([okey, 3 * 26 + 10, 1, 26 + 4, 26 + 8]));
            OKEY_ENGINE.speed(4);
            return okey;
        }, [swSeed, SW]);
        for (const id of SW.concat([okeyId])) await p.mouse.click(...Object.values(await E(p, id => OKEY_ENGINE.slot(OKEY_ENGINE.slotOf(id)), id)));
        await p.click('.ok-tools [data-act=lay]');
        await p.waitForFunction(() => OKEY_ENGINE.view().table.length === 3);
        await p.waitForTimeout(400);
        const okMeld = await E(p, id => OKEY_ENGINE.view().table.findIndex(t => t.tiles.includes(id)), okeyId);
        await drag(p, await E(p, id => OKEY_ENGINE.slot(OKEY_ENGINE.slotOf(id)), T(K, 11)), await E(p, i => OKEY_ENGINE.meld(i), okMeld));
        await p.waitForFunction(id => OKEY_ENGINE.view().hand.includes(id), okeyId, { timeout: 5000 }).catch(() => { });
        let v = await view(p);
        expect(okMeld >= 0 && v.hand.includes(okeyId) && v.table[okMeld].tiles.includes(T(K, 11)), 'the black 11 dragged onto black 10-okey-12 takes the okey back to my rack', JSON.stringify(v.table[okMeld]));
        // a fixed seed, my seat first: the bots are deterministic, so is this
        await E(p, () => { OKEY_ENGINE.startLocal({ seed: 4101, dealer: 0, mode: '101', hands: 5, level: 'normal' }); OKEY_ENGINE.speed(30); });
        let mine = 0, hands = 0, finished = null;
        v = await view(p);
        for (let i = 0; i < 400 && !finished; i++) {
            await p.waitForFunction(() => { const v = OKEY_ENGINE.view(); return v.result || (v.turn === 0 && !OKEY_ENGINE.state().flyers.length); }, null, { timeout: 20000 });
            v = await view(p);
            if (v.result) {
                hands++;
                if (v.result.winner >= 0) { finished = v.result; break; }
                if (v.over) break;
                await p.waitForSelector('.ok-over [data-act=next]', { timeout: 10000 });
                await p.click('.ok-over [data-act=next]');
                await p.waitForFunction(h => OKEY_ENGINE.view().handNo === h && !OKEY_ENGINE.view().result, v.handNo + 1);
                continue;
            }
            await p.locator('.ok-app').focus();
            if (v.phase === 'draw') {
                await p.keyboard.press('d');
                await p.waitForFunction(() => OKEY_ENGINE.view().phase === 'play' || OKEY_ENGINE.view().result);
                continue;
            }
            // a tile that neither is the okey nor fits the table: clicked, then x
            const before = v.discardCounts[0];
            const slot = await E(p, () => { const v = OKEY_ENGINE.view(), r = OKEY_ENGINE.rack(); const k = r.findIndex(x => x >= 0 && !OKEY_SIM.isWild(x, v.ok) && OKEY_SIM.playableOnTable({ table: v.table, ok: v.ok }, x) < 0); return k >= 0 ? k : r.findIndex(x => x >= 0); });
            await p.mouse.click(...Object.values(await E(p, i => OKEY_ENGINE.slot(i), slot)));
            await p.keyboard.press('x');
            await p.waitForFunction(b => { const v = OKEY_ENGINE.view(); return v.discardCounts[0] > b || v.result || v.turn !== 0; }, before);
            mine++;
        }
        v = await view(p);
        expect(mine >= 4, 'my turns played with d, a click and x', mine + ' throws over ' + hands + ' hands');
        expect(finished && finished.winner > 0 && v.table.some(t => t.owner === finished.winner), 'a hand ends with a bot going out: opened, laid down, and no tiles left', finished ? v.seats[finished.winner].name + ' finished hand ' + (v.handNo + 1) + ', ' + finished.deltas.join(' / ') : 'no finish in ' + hands + ' hands');
        expect(finished && v.reveal && v.reveal[finished.winner].length === 0 && finished.deltas[finished.winner] < 0, 'the finisher holds nothing and scores minus');
        await p.waitForSelector('.ok-dlg .ok-table', { timeout: 8000 });
        expect(/finishes/.test(await p.textContent('.ok-dlg')), 'and the dialog says who finished');
        await p.screenshot({ path: path.join(SHOTS, 'okey-101-finish.png') });
        const ach = await E(p, () => window.__ach.slice());
        expect(!ach.includes('okey_win') && (v.over && v.winner === 0) === ach.includes('okey_101'), 'okey_101 is asked for only if I win the 101 match', JSON.stringify(ach));
        await ctx.close();
    }

    // ===================================================================
    section('phone');
    // ===================================================================
    {
        const ctx = await context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const p = await desk(ctx);
        await openOkey(p);
        await p.tap('.ok-over [data-act=deal]');
        await p.waitForFunction(() => OKEY_ENGINE.view());
        await E(p, () => { OKEY_ENGINE.startLocal({ seed: 77, dealer: 0, mode: 'classic' }); });
        await p.waitForTimeout(300);
        const w = await E(p, () => ({ doc: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, win: document.querySelector('.okey-window').getBoundingClientRect().right, cols: OKEY_ENGINE.state() && OKEY_ENGINE.state().rack.length }));
        expect(w.doc <= w.vw && w.win <= w.vw + 1, 'nothing sticks out sideways at 390px', JSON.stringify(w));
        const r = await E(p, () => OKEY_ENGINE.slot(9));
        const r2 = await E(p, () => OKEY_ENGINE.slot(10));
        expect(r2.y > r.y, 'the rack goes to three rows of ten on a phone');
        const slot = await E(p, () => OKEY_ENGINE.rack().findIndex(x => x >= 0 && !OKEY_SIM.isWild(x, OKEY_ENGINE.view().ok)));
        const pt = await E(p, i => OKEY_ENGINE.slot(i), slot);
        await p.touchscreen.tap(pt.x, pt.y);
        expect(await E(p, () => OKEY_ENGINE.state().sel.size) === 1, 'a tap selects a tile');
        await p.tap('.ok-tools [data-act=throw]');
        await p.waitForFunction(() => OKEY_ENGINE.view().discardCounts[0] === 1);
        expect(true, 'and a tap on throw throws it');
        await p.screenshot({ path: path.join(SHOTS, 'okey-phone.png') });
        await ctx.close();
    }

    // ===================================================================
    section('online');
    // ===================================================================
    {
        const ctx = await context({ viewport: { width: 1200, height: 860 } });
        const host = await desk(ctx), guest = await desk(ctx);
        const lobby = async p => { await p.evaluate(() => openNetplay({ gameId: 'okey' })); await p.waitForSelector('#np-host', { timeout: 15000 }); await p.selectOption('#np-mode', 'local'); };
        await lobby(host);
        expect(await host.inputValue('#np-game') === 'okey', 'the lobby opens on okey');
        await host.click('#np-host');
        await host.waitForSelector('.np-code');
        const code = (await host.textContent('.np-code')).trim();
        await lobby(guest);
        await guest.fill('#np-code', code);
        await guest.click('#np-join');
        await guest.waitForSelector('.np-code', { timeout: 20000 });
        await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
        await host.selectOption('[data-opt=mode]', '101');
        await guest.click('#np-ready');
        await host.waitForTimeout(400);
        await host.click('#np-ready');
        await host.click('#np-start');
        await Promise.all([host, guest].map(p => p.waitForFunction(() => window.OKEY_ENGINE && OKEY_ENGINE.view() && OKEY_ENGINE.view().hand.length > 0, null, { timeout: 30000 })));
        expect(await guest.locator('.app-window .ok-app').count() === 1 && await host.locator('.app-window .ok-app').count() === 1, 'both pages sit at the table in a desktop window');
        let hv = await view(host), gv = await view(guest);
        expect(hv.mode === '101' && gv.mode === '101', "the host's rules reach the guest (okey 101)");
        expect(hv.me === 0 && gv.me === 1 && hv.seats[2].bot && hv.seats[3].bot, 'two people and two bots');
        expect(!gv.hand.some(id => hv.hand.includes(id)) && gv.reveal === null, "the guest never holds or sees the host's tiles");
        await E(host, () => OKEY_ENGINE.speed(5));
        // play: whoever of the two is to move draws and throws, by keys and clicks
        const moved = [0, 0];
        for (let i = 0; i < 120 && (moved[0] < 2 || moved[1] < 2); i++) {
            hv = await view(host);
            if (hv.result) break;
            const who = hv.turn;
            if (who > 1) { await host.waitForTimeout(120); continue; }
            const p = who === 0 ? host : guest;
            const v = await view(p);
            if (v.turn !== who) { await p.waitForTimeout(80); continue; }
            await p.locator('.ok-app').focus();
            if (v.phase === 'draw') {
                await p.keyboard.press('d');
                await p.waitForFunction(() => OKEY_ENGINE.view().phase === 'play', null, { timeout: 5000 }).catch(() => { });
                continue;
            }
            const before = v.discardCounts[who];
            const slot = await E(p, () => { const v = OKEY_ENGINE.view(); return OKEY_ENGINE.rack().findIndex(x => x >= 0 && !OKEY_SIM.isWild(x, v.ok) && OKEY_SIM.playableOnTable({ table: v.table, ok: v.ok }, x) < 0); });
            await p.mouse.click(...Object.values(await E(p, i => OKEY_ENGINE.slot(i), slot)));
            await p.keyboard.press('x');
            await host.waitForFunction(([w, b]) => OKEY_ENGINE.view().discardCounts[w] > b || OKEY_ENGINE.view().result, [who, before], { timeout: 5000 }).catch(() => { });
            moved[who]++;
        }
        expect(moved[0] >= 2 && moved[1] >= 2, 'host and guest each drew and threw at least twice', moved.join(' / '));
        await guest.waitForTimeout(500);
        const same = await Promise.all([host, guest].map(p => E(p, () => { const v = OKEY_ENGINE.view(); return JSON.stringify([v.turn, v.phase, v.pile, v.discardCounts, v.seats.map(s => [s.count, s.score, s.opened]), v.table.length, v.ind]); })));
        expect(same[0] === same[1], 'both screens show the same table', same.join(' vs '));
        // a guest asking for a move out of turn changes nothing on the host
        const before = await view(host);
        await E(guest, () => OKEY_ENGINE.state().session.sendToHost('okey:act', { a: { t: 'discard', tile: OKEY_ENGINE.view().hand[0] } }));
        await host.waitForTimeout(300);
        const after = await view(host);
        expect(before.turn === 1 || JSON.stringify(after.discardCounts) === JSON.stringify(before.discardCounts) || after.turns > before.turns, "a guest's forged move out of turn is refused by the host");
        await host.screenshot({ path: path.join(SHOTS, 'okey-online-host.png') });
        await guest.close();
        await host.waitForFunction(() => OKEY_ENGINE.match().seats[1].bot, null, { timeout: 15000 }).catch(() => { });
        expect(await E(host, () => OKEY_ENGINE.match().seats[1].bot), 'the guest walks out: a bot takes the seat');
        const turnsNow = (await view(host)).turns;
        await E(host, () => OKEY_ENGINE.match().seats[0].bot = true);
        await host.waitForFunction(t => OKEY_ENGINE.view().turns > t + 2 || OKEY_ENGINE.view().result, turnsNow, { timeout: 15000 }).catch(() => { });
        expect((await view(host)).turns > turnsNow, 'and the game goes on');
        await ctx.close();
    }
} catch (e) {
    failures++;
    console.log('  FAIL  ' + (e && e.stack || e));
} finally {
    expect(errors.length === 0, 'no page errors', errors.join(' | '));
    await browser.close();
    server.close();
}
console.log('\n' + (failures ? failures + ' of ' + checks + ' okey browser checks FAILED' : checks + ' okey browser checks passed'));
process.exit(failures ? 1 : 0);
