// ===================================================================
// browser-kartz.mjs — kartz 98 played, not just opened
//
//   solo     none of it in the first load; the start menu opens it in a desktop
//            window; a batak hand played with real clicks and keys (bid, name
//            trumps, follow suit), the hand scored, the score sheet window, a
//            reload in the middle and the table resumed, the bots to the end
//   king     a contract called with a click, cards played, twenty hands
//   pisti    cards thrown with clicks and keys, played to the end
//   phone    390x844: the table fits with no sideways scroll, taps play
//   online   two browsers in one machine ('local' mode): host and join with the
//            code, the host picks the game, real moves on both sides, the same
//            table on both, played to the end, dealt again, and a guest who
//            walks out becomes a bot
//
//   node .github/scripts/browser-kartz.mjs
//   KZ_ONLY=solo,online node .github/scripts/browser-kartz.mjs
// ===================================================================
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.KZ_SHOTS || path.join(ROOT, '.ci-shots');
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'text/xml', '.webmanifest': 'application/json', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    let file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not here'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const errors = [];
async function context(opts, name) {
    const ctx = await browser.newContext(opts);
    await ctx.route('**/*', route => {
        const u = route.request().url();
        if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        return route.abort();
    });
    await ctx.addInitScript(who => {
        try {
            sessionStorage.setItem('welcomed', '1');
            sessionStorage.setItem('booted', '1');
            localStorage.setItem('sound-enabled', 'false');
            if (who && !localStorage.getItem('mrhakan98-netplay-profile')) localStorage.setItem('mrhakan98-netplay-profile', JSON.stringify({ id: who + Math.random().toString(36).slice(2, 8), name: who, avatar: null }));
        } catch (e) { }
    }, name || null);
    return ctx;
}
async function open(ctx, label, url) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push((label || 'page') + ': ' + e.message));
    await p.goto(url || BASE + '/', { waitUntil: 'load' });
    await p.waitForFunction(() => typeof startMenuAction === 'function');
    await p.evaluate(() => document.getElementById('boot-screen')?.remove());
    return p;
}
const st = (p, f) => p.evaluate(`(() => { const g = KARTZ_ENGINE.game(); const st = g && g.st; return (${f})(st, g); })()`);
// whose move is it on this page: mine, the table's, or nobody's yet
const myTurn = p => st(p, (s, g) => !!s && !s.over && s.turn === g.me && !g.pending && !g.paused);
async function waitMine(p, timeout) {
    return p.waitForFunction(() => { const g = KARTZ_ENGINE.game(), s = g && g.st; return s && (s.over || s.phase === 'handEnd' || (s.turn === g.me && !g.pending)); }, null, { timeout: timeout || 30000, polling: 50 });
}
// one move by real input: a button for bids, trumps and contracts; a card by click or by keys
async function move(p, how) {
    const phase = await st(p, s => s.phase);
    if (phase !== 'play') { await p.click('.kz-prompt .kz-choice >> nth=0'); return phase; }
    if (how === 'keys') {
        await p.keyboard.press('ArrowRight');
        await p.keyboard.press('Enter');
    } else {
        await p.locator('.kz-hcard.kz-ok').last().click({ position: { x: 6, y: 12 } });
    }
    return phase;
}
// keep moving for this page until a hand ends
async function playHand(p, maxMoves) {
    const seen = new Set();
    let moves = 0, keys = 0;
    for (let k = 0; k < (maxMoves || 80); k++) {
        await waitMine(p);
        const s = await st(p, s => ({ phase: s.phase, over: s.over, ev: s.evN }));
        if (s.phase === 'handEnd' || s.over) break;
        const how = moves % 2 ? 'keys' : 'click';
        const before = s.ev;
        seen.add(await move(p, how));
        if (how === 'keys') keys++;
        moves++;
        await p.waitForFunction(b => { const g = KARTZ_ENGINE.game(); return g.st.evN > b; }, before, { timeout: 8000, polling: 30 });
    }
    return { moves, keys, phases: [...seen] };
}
const ONLY = process.env.KZ_ONLY || '';
const part = n => !ONLY || ONLY.split(',').includes(n);

try {
    if (part('solo')) {
        section('the desktop, the start menu, a batak hand by hand');
        const ctx = await context({ viewport: { width: 1280, height: 860 } });
        const p = await open(ctx, 'solo');
        expect(await p.evaluate(() => !window.KZ_SIM && !document.getElementById('kz-css')), 'none of it is in the first load');
        await p.evaluate(() => { try { localStorage.setItem('mrhakan98-kartz-prefs', JSON.stringify({ game: 'king' })); } catch (e) { } });
        await p.evaluate(() => startMenuAction('kartz'));
        await p.waitForSelector('.app-window .kz-menu', { timeout: 20000 });
        const title = await p.locator('.app-window', { has: p.locator('.kz-stage') }).locator('.app-window-title').textContent();
        expect(/kartz 98/.test(title), 'it opens from the start menu in a desktop popup window', title);
        expect(await p.evaluate(() => !!document.getElementById('kz-css') && getComputedStyle(document.querySelector('.kz-table')).backgroundImage.includes('gradient')), 'with its own stylesheet and a green felt');
        await p.click('.kz-menu [data-act="how"]');
        expect(/follow suit/.test(await p.textContent('.kz-how')), 'how to play explains the rules');
        await p.click('[data-act="howclose"]');
        await p.click('.kz-radio:has(input[value="batak"])');
        expect(await p.evaluate(() => JSON.parse(localStorage.getItem('mrhakan98-kartz-prefs')).game) === 'batak', 'picking batak is remembered');
        await p.screenshot({ path: SHOTS + '/kz-menu.png' });
        await p.click('.kz-menu [data-act="deal"]');
        await p.waitForFunction(() => KARTZ_ENGINE.screen() === 'play' && KARTZ_ENGINE.state());
        const setup = await st(p, s => [s.game, s.n, s.seats.filter(x => x.bot).length, s.phase, s.hands[0].length].join());
        expect(setup === 'batak,4,3,bid,13', 'a batak table: you and three bots, thirteen cards each, the auction on', setup);
        expect(await p.locator('.kz-hand .kz-hcard').count() === 13 && await p.locator('.kz-seat').count() === 4, 'thirteen cards in your hand, four seats round the table');
        await p.evaluate(() => KARTZ_ENGINE.ff(4));
        const r = await playHand(p, 40);
        await p.screenshot({ path: SHOTS + '/kz-batak-hand.png' });
        expect(r.phases.includes('play') && r.moves >= 10 && r.keys >= 5, 'a whole hand played: bids or trumps by button, cards by click and by arrow and enter', JSON.stringify(r));
        const sum = await st(p, s => ({ phase: s.phase, h: s.history.length, scores: s.scores, tricks: s.summary && s.summary.tricks.reduce((a, b) => a + b, 0) }));
        expect(sum.phase === 'handEnd' && sum.h === 1 && sum.tricks === 13 && sum.scores.some(v => v !== 0), 'the hand is scored: thirteen tricks, the points on the board', JSON.stringify(sum));
        expect(await p.isVisible('.kz-panel [data-act="next"]') && /hand 1/.test(await p.textContent('.kz-ptitle')), 'the hand summary is on the table');
        await p.keyboard.press('s');
        await p.waitForFunction(() => KARTZ_ENGINE.sheetOpen());
        const sheetText = await p.textContent('.kz-sheet');
        expect(/total/.test(sheetText) && await p.locator('.kz-sheet tbody tr').count() === 1, 'the score sheet opens in its own window with the hand on a line');
        await p.keyboard.press('s');
        await p.click('.kz-panel [data-act="next"]');
        await p.waitForFunction(() => KARTZ_ENGINE.state().handNo === 1 && KARTZ_ENGINE.state().phase === 'bid');
        expect(true, 'next hand deals again');
        // pause
        await p.keyboard.press('p');
        expect(await st(p, (s, g) => g.paused) && await p.isVisible('.kz-panel[aria-label="paused"]'), 'p pauses');
        const ev = await st(p, s => s.evN);
        await p.waitForTimeout(1200);
        expect(await st(p, s => s.evN) === ev, 'and nothing moves while paused');
        await p.keyboard.press('p');
        // a save across a reload
        await p.waitForTimeout(400);
        const saved = await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('mrhakan98-kartz-save')); return o && o.st.handNo; });
        expect(saved === 1, 'the table is saved as it goes', saved);
        await p.reload({ waitUntil: 'load' });
        await p.waitForFunction(() => typeof startMenuAction === 'function');
        await p.evaluate(() => document.getElementById('boot-screen')?.remove());
        await p.evaluate(() => startMenuAction('kartz'));
        await p.waitForSelector('.kz-menu [data-act="resume"]', { timeout: 20000 });
        expect(/batak, hand 2/.test(await p.textContent('.kz-menu [data-act="resume"]')), 'after a reload the menu offers to resume it');
        await p.click('.kz-menu [data-act="resume"]');
        expect(await st(p, s => s.handNo === 1 && s.history.length === 1 && s.game === 'batak'), 'and resumes the same table at hand 2');
        // the bots to the end
        await p.evaluate(() => { KARTZ_ENGINE.auto(true); KARTZ_ENGINE.ff(400); });
        await p.waitForSelector('.kz-panel[aria-label="the table is over"]', { timeout: 90000 });
        const end = await st(p, s => ({ over: s.over, top: Math.max(...s.scores), target: s.target, w: s.winners }));
        expect(end.over && (end.top >= end.target) && end.w.length, 'played to the target, a winner named', JSON.stringify(end));
        const stat = await p.evaluate(() => KARTZ_ENGINE.stats().batak);
        expect(stat.played === 1 && stat.hands >= 2, 'the table is in the records', JSON.stringify(stat));
        expect(await p.evaluate(() => localStorage.getItem('mrhakan98-kartz-save') === null), 'and the finished table is no longer saved');
        await p.screenshot({ path: SHOTS + '/kz-batak-over.png' });
        await p.click('.kz-panel [data-act="again"]');
        expect(await st(p, s => s.handNo === 0 && !s.over && s.game === 'batak'), 'deal again starts a new table');

        section('king');
        await p.evaluate(() => { KARTZ_ENGINE.auto(false); KARTZ_ENGINE.ff(1); });
        await p.click('[data-act="menu"]');
        await p.click('.kz-radio:has(input[value="king"])');
        await p.click('.kz-menu [data-act="deal"]');
        await p.waitForFunction(() => KARTZ_ENGINE.state() && KARTZ_ENGINE.state().game === 'king');
        expect(await st(p, (s, g) => s.phase === 'pick' && s.turn === g.me) && await p.locator('.kz-prompt .kz-contract').count() === 7, 'you call first: seven contracts on the buttons');
        await p.evaluate(() => KARTZ_ENGINE.ff(4));
        await p.click('.kz-prompt [data-k="el"]');
        expect(await st(p, s => s.contract === 'el' && s.used.el === 1), 'a click calls no tricks');
        const kr = await playHand(p, 20);
        expect(kr.moves >= 8, 'and the hand is played with clicks and keys', JSON.stringify(kr));
        await p.evaluate(() => { KARTZ_ENGINE.auto(true); KARTZ_ENGINE.ff(400); });
        await p.waitForSelector('.kz-panel[aria-label="the table is over"]', { timeout: 90000 });
        const k = await st(p, s => ({ h: s.history.length, sum: s.scores.reduce((a, b) => a + b, 0) }));
        expect(k.h === 20 && k.sum === 0, 'twenty hands and the scores add up to zero', JSON.stringify(k));

        section('pisti');
        await p.evaluate(() => { KARTZ_ENGINE.auto(false); KARTZ_ENGINE.ff(1); });
        await p.click('[data-act="menu"]');
        await p.click('.kz-radio:has(input[value="pisti"])');
        await p.selectOption('.kz-menu [data-k="pistiSeats"]', '2');
        await p.click('.kz-menu [data-act="deal"]');
        await p.waitForFunction(() => KARTZ_ENGINE.state() && KARTZ_ENGINE.state().game === 'pisti');
        expect(await st(p, s => s.n === 2 && s.pile.length === 4) && await p.locator('.kz-pile .kz-card').count() >= 2, 'two at the table, a pile of four with its top card up');
        await p.evaluate(() => KARTZ_ENGINE.ff(4));
        let thrown = 0;
        for (let i = 0; i < 6; i++) {
            await waitMine(p);
            const b = await st(p, s => s.evN);
            await move(p, i % 2 ? 'keys' : 'click');
            await p.waitForFunction(x => KARTZ_ENGINE.state().evN > x, b, { timeout: 8000 });
            thrown++;
        }
        expect(thrown === 6 && await st(p, s => s.played.length >= 7), 'six cards thrown by click and by keys', await st(p, s => s.played.length + ' played'));
        await p.screenshot({ path: SHOTS + '/kz-pisti.png' });
        await p.evaluate(() => { KARTZ_ENGINE.auto(true); KARTZ_ENGINE.ff(400); });
        await p.waitForSelector('.kz-panel[aria-label="the table is over"]', { timeout: 90000 });
        expect(await st(p, s => Math.max(...s.scores) >= s.target), 'played to the end');
        expect(await p.evaluate(() => KARTZ_ENGINE.stats().pisti.played === 1 && KARTZ_ENGINE.stats().king.played === 1), 'all three tables are in the records');
        await ctx.close();
    }

    if (part('phone')) {
        section('a phone, 390 x 844');
        const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        const p = await open(ctx, 'phone', BASE + '/?app=kartz');
        await p.waitForSelector('.kz-menu', { timeout: 20000 });
        await p.locator('.kz-menu [data-act="deal"]').tap();
        await p.waitForFunction(() => KARTZ_ENGINE.state());
        await p.evaluate(() => KARTZ_ENGINE.ff(4));
        const wide = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, win: document.querySelector('.kz-window').getBoundingClientRect().right, hand: Math.max(...[...document.querySelectorAll('.kz-hcard')].map(e => e.getBoundingClientRect().right)) }));
        expect(wide.sw <= wide.cw && wide.win <= wide.cw + 1 && wide.hand <= wide.cw, 'nothing sticks out sideways: the page, the window, the hand', JSON.stringify(wide));
        await waitMine(p);
        const b = await st(p, s => s.evN);
        if (await st(p, s => s.phase) === 'play') await p.locator('.kz-hcard.kz-ok').last().tap({ position: { x: 6, y: 12 } });
        else await p.locator('.kz-prompt .kz-choice').first().tap();
        expect(await p.waitForFunction(x => KARTZ_ENGINE.state().evN > x, b, { timeout: 8000 }).then(() => true, () => false), 'a tap plays');
        await p.screenshot({ path: SHOTS + '/kz-phone.png' });
        await ctx.close();
    }

    if (part('online')) {
        section('two browsers at one table');
        const ctx = await context({ viewport: { width: 1100, height: 820 } });
        const host = await open(ctx, 'host');
        const guest = await open(ctx, 'guest');
        await host.evaluate(() => openNetplay({ gameId: 'kartz' }));
        await host.waitForSelector('#np-host', { timeout: 15000 });
        await host.selectOption('#np-mode', 'local');
        await host.click('#np-host');
        await host.waitForSelector('.np-code', { timeout: 15000 });
        await host.waitForSelector('[data-opt="game"]', { timeout: 8000 });
        await host.selectOption('[data-opt="game"]', 'batak');
        const code = (await host.textContent('.np-code')).trim();
        await guest.evaluate(() => openNetplay({ gameId: 'kartz' }));
        await guest.waitForSelector('#np-code', { timeout: 15000 });
        await guest.selectOption('#np-mode', 'local');
        await guest.fill('#np-code', code);
        await guest.click('#np-join');
        await guest.waitForSelector('.np-code', { timeout: 15000 });
        await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 15000 });
        await guest.click('#np-ready');
        await host.waitForTimeout(300);
        await host.click('#np-start');
        await Promise.all([host, guest].map(p => p.waitForFunction(() => window.KARTZ_ENGINE && KARTZ_ENGINE.state(), null, { timeout: 20000 })));
        expect(await host.locator('.app-window .kz-stage').count() === 1 && await guest.locator('.app-window .kz-stage').count() === 1, 'the start button brings both to the table, each in a desktop window');
        const seats = p => st(p, (s, g) => s.seats.map(x => (x.bot ? 'bot:' : '') + x.name).join(',') + ' me=' + g.me + ' host=' + g.host);
        const [hs, gs] = [await seats(host), await seats(guest)];
        expect(hs.split(' me=')[0] === gs.split(' me=')[0] && /me=0 host=true/.test(hs) && /me=1 host=false/.test(gs) && (hs.match(/bot:/g) || []).length === 2, 'one batak table on both: two people, two bots', hs + ' | ' + gs);
        expect(await guest.evaluate(() => KARTZ_ENGINE.state().hands.every((h, i) => i === 1 ? h.every(c => c >= 0) : h.every(c => c === -1))), 'the guest sees its own cards and only backs of the others');
        await Promise.all([host, guest].map(p => p.evaluate(() => KARTZ_ENGINE.ff(5))));
        // both play by hand until a few cards each are down
        const did = { host: 0, guest: 0 };
        for (let k = 0; k < 400 && (did.host < 4 || did.guest < 4); k++) {
            const [h, g] = await Promise.all([myTurn(host), myTurn(guest)]);
            const p = h ? host : g ? guest : null;
            if (!p) { await host.waitForTimeout(60); if (await st(host, s => s.phase === 'handEnd')) break; continue; }
            const b = await st(host, s => s.evN);
            await move(p, (did.host + did.guest) % 2 ? 'keys' : 'click');
            did[p === host ? 'host' : 'guest']++;
            await host.waitForFunction(x => KARTZ_ENGINE.state().evN > x, b, { timeout: 8000 });
        }
        expect(did.host >= 4 && did.guest >= 4, 'host and guest each make their moves with real input', JSON.stringify(did));
        await guest.waitForFunction(() => { const g = KARTZ_ENGINE.game(); return !g.pending; }, null, { timeout: 5000 });
        await host.waitForTimeout(400);
        const same = async () => {
            const a = await st(host, s => JSON.stringify([s.evN, s.scores, s.trick, s.tricks, s.phase, s.turn, s.hands[1]]));
            const b = await st(guest, s => JSON.stringify([s.evN, s.scores, s.trick, s.tricks, s.phase, s.turn, s.hands[1]]));
            return [a === b, a.slice(0, 90), b.slice(0, 90)];
        };
        const sm = await same();
        expect(sm[0], 'both screens show the same table: the trick, the tricks, the turn, the guest\'s hand', sm[1] + ' | ' + sm[2]);
        await guest.screenshot({ path: SHOTS + '/kz-guest.png' });
        // a guest claiming a card it does not hold changes nothing
        const evBefore = await st(host, s => s.evN);
        await guest.evaluate(() => { const g = KARTZ_ENGINE.game(); g.session.sendToHost('kartz:act', { m: g.mid, a: { t: 'play', c: 999 } }); g.session.sendToHost('kartz:act', { m: g.mid, a: { t: 'bid', v: 13 } }); });
        await host.waitForTimeout(500);
        expect(await st(host, s => s.evN) === evBefore || await st(host, s => s.log.slice(-3).every(e => e.s !== 1 || e.e !== 'bid' || e.v !== 13)), 'a forged action from the guest changes nothing');
        // to the end
        await Promise.all([host, guest].map(p => p.evaluate(() => { KARTZ_ENGINE.auto(true); KARTZ_ENGINE.ff(400); })));
        await Promise.all([host, guest].map(p => p.waitForSelector('.kz-panel[aria-label="the table is over"]', { timeout: 120000 })));
        const fin = await Promise.all([host, guest].map(p => st(p, s => JSON.stringify([s.scores, s.winners, s.history.length]))));
        expect(fin[0] === fin[1], 'the table ends on both with the same scores and winner', fin[0]);
        expect(await guest.isVisible('.kz-panel [data-act="leave"]') && await host.isVisible('.kz-panel [data-act="rematch"]'), 'the host can deal again, the guest can leave');
        await Promise.all([host, guest].map(p => p.evaluate(() => { KARTZ_ENGINE.auto(false); KARTZ_ENGINE.ff(1); })));
        const oldMid = await guest.evaluate(() => KARTZ_ENGINE.game().mid);
        await host.click('.kz-panel [data-act="rematch"]');
        expect(await guest.waitForFunction(m => KARTZ_ENGINE.game().mid !== m && !KARTZ_ENGINE.state().over, oldMid, { timeout: 10000 }).then(() => true, () => false), 'deal again reaches the guest');
        // the guest walks out: a bot takes the seat
        await guest.evaluate(() => KARTZ_ENGINE.game().session.leave());
        expect(await host.waitForFunction(() => KARTZ_ENGINE.state().seats[1].bot, null, { timeout: 15000 }).then(() => true, () => false), 'a guest who walks out becomes a bot');
        await host.evaluate(() => { KARTZ_ENGINE.auto(true); KARTZ_ENGINE.ff(400); });
        expect(await host.waitForSelector('.kz-panel[aria-label="the table is over"]', { timeout: 90000 }).then(() => true, () => false), 'and the host plays on to the end with the bots');
        await ctx.close();
    }

    section('page errors');
    expect(errors.length === 0, 'no page errors anywhere', errors.slice(0, 6).join(' | '));
} catch (e) {
    failures++;
    console.log('  FAIL  the test itself fell over: ' + (e && e.stack || e));
}
await browser.close();
server.close();
console.log('\n' + (failures ? failures + ' of ' + checks + ' kartz browser checks FAILED' : 'all ' + checks + ' kartz browser checks passed'));
process.exit(failures ? 1 : 0);
