// ===================================================================
// browser-age-of-troll.mjs — play it, rather than open it
//
// A match is twenty minutes, so the game clock is turned up, and the buttons
// are still pressed the way a person presses them. Then a phone, and then two
// browsers: straight across, over the relays, with the link dying partway
// through and a player disappearing. It runs on no outside server: peerjs is a
// stand-in whose hole punching is a setting, as in browser-netplay.mjs, and the
// public relays are server/nostr-test-relay.mjs.
//
//   SITE_URL=http://localhost:8103 node .github/scripts/browser-age-of-troll.mjs
// ===================================================================
import { chromium, devices } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';

const BASE = (process.env.SITE_URL || 'http://localhost:8103').replace(/\/$/, '');
const SHOTS = process.env.AOT_SHOTS || '.ci-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const RELAY_PORT = 8600 + Math.floor(Math.random() * 90);
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
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const errors = [];

async function context(opts) {
    const ctx = await browser.newContext(opts);
    await ctx.route('**/*', route => {
        const u = route.request().url();
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
const state = (p, fn, arg) => p.evaluate(`(${fn})(AOT_ENGINE.state(), AOT, ${JSON.stringify(arg === undefined ? null : arg)})`);
const live = p => p.waitForFunction(() => window.AOT_ENGINE && AOT_ENGINE.state() && AOT_ENGINE.state().btn, null, { timeout: 30000 });

// a person who knows roughly what the buttons do, at whatever speed the clock is on
const PLAY = `(function (g, A) {
    const p = g.s.p[g.me];
    const wanted = [];
    const can = c => !A.canCommand(g.s, g.me, c);
    if (can({ c: p.age < 4 ? 'age' : 'overclock' })) wanted.push('ag');
    if (p.spCd <= 0 && g.s.u[1 - g.me].length >= 2) wanted.push('sp');
    if (p.tur.length < A.slotsOf(p) && p.gold > A.turretCost(0, p.age) * 2) wanted.push('t0');
    if (p.modem < 3 && can({ c: 'modem' })) wanted.push('mo');
    const foe = g.s.u[1 - g.me][0];
    const close = foe && Math.abs(foe.x - A.BASE_FRONT[g.me]) < 450;
    const next = A.AGES[p.age + 1];
    const saving = !close && g.s.u[g.me].length >= 3 && ((next && p.xp >= next.xp) || (p.modem < 3 && g.s.u[g.me].length >= 4));
    const n = g.s.u[g.me].length + p.q.length;
    if (n < A.POP_CAP && !saving) {
        const have = [0, 0, 0];
        g.s.u[g.me].forEach(u => { const r = A.UNITS[u.t].role; if (r < 3) have[r]++; });
        p.q.forEach(t => { const r = A.UNITS[t].role; if (r < 3) have[r]++; });
        const pick = have[0] <= have[1] ? 0 : have[1] <= have[2] * 2 ? 1 : 2;
        if (can({ c: 'train', r: pick })) wanted.push('u' + pick);
    }
    return wanted;
})(AOT_ENGINE.state(), AOT)`;

// presses buttons until the match ends or the time runs out
async function playUntilOver(pages, ms, how) {
    const t0 = Date.now();
    let presses = 0;
    while (Date.now() - t0 < ms) {
        for (const p of pages) {
            const over = await p.evaluate(() => { const g = AOT_ENGINE.state(); return !g || g.s.over; });
            if (over) return presses;
            const want = await p.evaluate(PLAY);
            for (const id of want.slice(0, 3)) {
                const b = p.locator(`.aot-cmd[data-cmd="${id}"]`);
                if (how === 'tap') await b.tap({ timeout: 2000 }).catch(() => { });
                else await b.click({ timeout: 2000 }).catch(() => { });
                presses++;
            }
        }
        await pages[0].waitForTimeout(60);
    }
    return presses;
}

try {
    // ===================================================================
    section('the desktop');
    // ===================================================================
    {
        const ctx = await context({ viewport: { width: 1180, height: 900 } });
        const p = await open(ctx);
        expect(await p.evaluate(() => !window.AOT && !window.Netplay), 'nothing of it is in the first load');
        await p.evaluate(() => startMenuAction('ageoftroll'));
        await p.waitForSelector('.aot-menu', { timeout: 20000 });
        expect(true, 'it opens from the start menu');
        expect(await p.evaluate(() => WEB.resolve(new URLSearchParams(location.search).get('app'))) === 'ageoftroll', 'and has an address');

        const look = await p.evaluate(async () => {
            const out = [];
            for (const u of AOT.UNITS) {
                const img = new Image();
                img.src = u.sprite;
                await img.decode().catch(() => { });
                const c = document.createElement('canvas');
                c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1;
                const x = c.getContext('2d');
                x.drawImage(img, 0, 0);
                const d = x.getImageData(0, 0, c.width, c.height).data;
                const at = (px, py) => d[(py * c.width + px) * 4 + 3];
                const w = c.width - 1, h = c.height - 1;
                out.push({ name: u.name, ok: img.naturalWidth > 0, corners: [at(0, 0), at(w, 0), at(0, h), at(w, h)] });
            }
            return out;
        });
        expect(look.every(l => l.ok), 'all sixteen trolls load', look.filter(l => !l.ok).map(l => l.name).join(', '));
        const boxed = look.filter(l => l.corners.filter(a => a > 200).length >= 3).map(l => l.name);
        expect(!boxed.length, 'and none of them walks around in a white box', boxed.join(', '));

        await p.screenshot({ path: SHOTS + '/aot-menu.png' });
        await p.selectOption('#aot-diff', 'easy');
        await p.selectOption('#aot-plan', 'balanced');
        await p.click('#aot-solo');
        await live(p);
        await p.waitForTimeout(300);
        const size = await p.evaluate(() => { const c = document.querySelector('#aot-canvas'); return { w: c.clientWidth, h: c.clientHeight, bw: c.width }; });
        expect(size.w > 500 && size.h > 180 && size.bw > 0, 'the lane has a size', JSON.stringify(size));

        // real clicks, at the real speed
        const gold0 = await state(p, g => g.s.p[0].gold);
        const cost = await state(p, (g, A) => A.unitFor(0, 0).cost);
        await p.click('.aot-cmd[data-cmd="u0"]');
        const gold1 = await state(p, g => g.s.p[0].gold);
        expect(gold1 <= gold0 - cost + 2, 'a click trains a unit and costs what it says', gold0 + ' to ' + gold1);
        await p.waitForFunction(() => AOT_ENGINE.state().s.u[0].length === 1, null, { timeout: 5000 });
        expect(true, 'and it walks out of the door a moment later');
        const x0 = await state(p, g => g.s.u[0][0].x);
        await p.waitForTimeout(800);
        expect(await state(p, g => g.s.u[0][0].x) > x0, 'and keeps walking');
        await p.focus('#aot-canvas');
        await p.keyboard.press('2');
        expect(await state(p, g => g.s.p[0].q.length) >= 0 && await state(p, g => g.s.p[0].spent) > cost, 'the number keys do the same');
        await p.keyboard.press('f');
        expect(await state(p, g => g.s.p[0].hold) === 1, 'F holds the army');
        expect(await p.textContent('.aot-cmd[data-cmd="st"] [data-name]') === 'holding', 'and the button says so');
        await p.keyboard.press('f');
        expect(await state(p, g => g.s.p[0].hold) === 0, 'and marches it again');

        // a no is a no, out loud
        await p.evaluate(() => { AOT_ENGINE.state().s.p[0].gold = 0; });
        const q0 = await state(p, g => g.s.p[0].q.length);
        await p.click('.aot-cmd[data-cmd="u2"]');
        expect(await state(p, g => g.s.p[0].q.length) === q0 && /gold/.test(await p.textContent('#aot-say')), 'a click you cannot afford says why');
        await p.evaluate(() => { AOT_ENGINE.state().s.p[0].gold = 500; });

        // minimising it pauses it, and nothing is lost
        await p.evaluate(() => document.querySelector('.aot-body').closest('.app-window').querySelector('[title="minimize"]').click());
        await p.waitForFunction(() => AOT_ENGINE.state().paused, null, { timeout: 4000 });
        expect(await state(p, g => g.pauseWhy) === 'away', 'minimising the window pauses a bot game');
        const tickPaused = await state(p, g => g.s.tick);
        await p.waitForTimeout(400);
        expect(await state(p, g => g.s.tick) === tickPaused, 'and the clock really stops');
        await p.waitForFunction(() => document.querySelector('.aot-body').closest('.app-window').style.display === 'none', null, { timeout: 4000 });
        await p.locator('.taskbar-window-btn', { hasText: 'age of troll' }).click();
        await p.click('#aot-pause');
        await p.waitForTimeout(400);
        expect(await state(p, g => g.s.tick) > tickPaused, 'and the button starts it again');

        // a long game has to survive the tab
        await state(p, g => { g.s.p[0].xp = 321; });
        await p.click('#aot-quit');
        await p.waitForSelector('#aot-continue', { timeout: 4000 });
        expect(/age 1/.test(await p.textContent('#aot-continue')), 'saving and leaving offers to continue');
        await p.reload({ waitUntil: 'load' });
        await p.evaluate(() => openAgeOfTroll());
        await p.waitForSelector('#aot-continue', { timeout: 20000 });
        await p.click('#aot-continue');
        await live(p);
        expect(Math.round(await state(p, g => g.s.p[0].xp)) >= 321, 'and a reload later the game is still there');
        expect(await state(p, g => g.paused), 'waiting for you to come back to it');
        await p.click('#aot-pause');

        // a whole match, buttons and all, with the clock turned up
        await p.evaluate(() => AOT_ENGINE.speed(12));
        const presses = await playUntilOver([p], 240000);
        const end = await state(p, (g, A) => ({ over: g.s.over, winner: g.s.winner, t: A.seconds(g.s), age: g.s.p.map(x => x.age), kills: g.s.p.map(x => x.kills) }));
        await p.screenshot({ path: SHOTS + '/aot-end.png' });
        expect(end.over, 'a whole match plays through to the end', presses + ' button presses, ' + Math.round(end.t / 60) + ' game minutes, ages ' + end.age.join('/') + ', kills ' + end.kills.join('/'));
        // the numbers on who ought to win are in check-age-of-troll.mjs, where the
        // clock is not the test machine's. Here it only has to tell the truth
        await p.waitForSelector('#aot-end:not([hidden]) .aot-result', { timeout: 5000 });
        const said = await p.textContent('.aot-result');
        expect(end.winner === 0 ? /you win/.test(said) : end.winner === 1 ? /you lost/.test(said) : /draw/.test(said), 'the end screen says who won', said + ', winner ' + end.winner);
        expect(await p.evaluate(() => !localStorage.getItem('mrhakan98-ageoftroll-save')), 'a finished game is not offered back');
        const won = await p.evaluate(() => (JSON.parse(localStorage.getItem('achievements') || '{}'))['aot-win'] !== undefined);
        expect(won === (end.winner === 0), 'and only a win is an achievement');
        await p.evaluate(() => AOT_ENGINE.speed(1));
        await p.click('#aot-again');
        await p.waitForFunction(() => { const g = AOT_ENGINE.state(); return g && !g.s.over && g.s.tick < 200; }, null, { timeout: 5000 });
        expect(await p.locator('#aot-end:not([hidden])').count() === 0, 'and a rematch starts clean');
        await p.click('#aot-help');
        await p.waitForSelector('.aot-roster img', { timeout: 3000 });
        expect(await p.locator('.aot-roster tr').count() === 17, 'how to play lists the whole roster');
        await ctx.close();
    }

    // ===================================================================
    section('a phone');
    // ===================================================================
    {
        const ctx = await context({ ...devices['Pixel 7'] });
        const p = await open(ctx);
        await p.evaluate(() => openAgeOfTroll('bot'));
        await live(p);
        await p.waitForTimeout(400);
        await p.screenshot({ path: SHOTS + '/aot-phone.png' });
        const m = await p.evaluate(() => ({
            page: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth,
            win: document.querySelector('.aot-body').closest('.app-window').getBoundingClientRect().right,
            canvas: document.querySelector('#aot-canvas').getBoundingClientRect().height,
            small: [...document.querySelectorAll('.aot-cmd, .aot-btn')].map(b => b.getBoundingClientRect()).filter(r => r.height < 40 || r.width < 40).length,
            clipped: [...document.querySelectorAll('.aot-cmd')].filter(b => b.getBoundingClientRect().right > document.documentElement.clientWidth).length
        }));
        expect(m.page <= m.screen, 'the page does not get wider than the phone', m.page + ' on ' + m.screen);
        expect(m.win <= m.screen, 'and neither does the window');
        expect(m.small === 0, 'every button is big enough for a thumb', m.small + ' are not');
        expect(m.clipped === 0, 'and none of them is off the edge');
        expect(m.canvas >= 180, 'and the lane is big enough to see', Math.round(m.canvas) + 'px');

        const g0 = await state(p, g => g.s.p[0].spent);
        await p.locator('.aot-cmd[data-cmd="u0"]').tap();
        expect(await state(p, g => g.s.p[0].spent) > g0, 'a tap trains a unit');

        // a finger drags the lane
        const cam0 = await state(p, g => g.view.cam);
        const box = await p.locator('#aot-canvas').boundingBox();
        await p.evaluate(({ x, y }) => {
            const c = document.querySelector('#aot-canvas');
            const fire = (t, px) => c.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: px, clientY: y, button: 0 }));
            fire('pointerdown', x + 300); fire('pointermove', x + 200); fire('pointermove', x + 50); fire('pointerup', x + 50);
        }, { x: box.x, y: box.y + box.height / 2 });
        await p.waitForTimeout(100);
        expect(await state(p, g => g.view.cam) > cam0 + 100, 'a finger drags the lane', cam0 + ' to ' + Math.round(await state(p, g => g.view.cam)));

        await p.evaluate(() => AOT_ENGINE.speed(12));
        const presses = await playUntilOver([p], 240000, 'tap');
        await p.waitForSelector('#aot-end:not([hidden]) #aot-menu', { timeout: 5000 });
        await p.screenshot({ path: SHOTS + '/aot-phone-end.png' });
        const reachable = await p.evaluate(() => [...document.querySelectorAll('#aot-end button')].every(b => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= document.documentElement.clientWidth && r.height >= 40; }));
        expect(reachable, 'the end screen\'s buttons are on the screen and big enough to tap');
        const end = await state(p, (g, A) => ({ over: g.s.over, winner: g.s.winner, t: A.seconds(g.s) }));
        expect(end.over, 'a whole match plays through on a phone', presses + ' taps, ' + Math.round(end.t / 60) + ' game minutes, winner ' + end.winner);
        expect(await p.locator('#aot-menu').count() === 1, 'and the end screen fits something to tap');
        expect(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'and it still has not widened the page');
        await ctx.close();
    }

    // ===================================================================
    section('a phone on its side');
    // ===================================================================
    {
        const ctx = await context({ ...devices['Pixel 7 landscape'] });
        const p = await open(ctx);
        await p.evaluate(() => openAgeOfTroll('bot'));
        await live(p);
        await p.waitForTimeout(400);
        const m = await p.evaluate(() => {
            const c = document.querySelector('#aot-canvas').getBoundingClientRect();
            const a = document.querySelector('.aot-cmd[data-cmd="u0"]').getBoundingClientRect();
            const b = document.querySelector('.aot-cmd[data-cmd="ag"]').getBoundingClientRect();
            return { lane: c.height, bottom: b.bottom, page: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth, h: innerHeight, view: AOT_ENGINE.state() && document.querySelector('#aot-canvas').width };
        });
        await p.screenshot({ path: SHOTS + '/aot-landscape.png' });
        expect(m.page <= m.screen, 'the page does not get wider than the phone', m.page + ' on ' + m.screen);
        expect(m.lane >= 110, 'the lane still shows', Math.round(m.lane) + 'px');
        expect(m.bottom <= m.h, 'and every button is on the screen without scrolling', 'bottom at ' + Math.round(m.bottom) + ' of ' + m.h);
        await ctx.close();
    }

    // ===================================================================
    section('two browsers, a direct link');
    // ===================================================================
    const ctx = await context({ viewport: { width: 1180, height: 900 } });
    async function hostLobby(p) {
        await p.evaluate(() => openAgeOfTroll());
        await p.waitForSelector('#aot-online', { timeout: 20000 });
        await p.click('#aot-online');
        await p.waitForSelector('#np-host', { timeout: 15000 });
        expect(await p.inputValue('#np-game') === 'ageoftroll', 'the lobby comes up on the right game');
        await p.click('#np-host');
        await p.waitForSelector('.np-code', { timeout: 20000 });
        return (await p.textContent('.np-code')).trim();
    }
    async function joinLobby(p, code) {
        await p.evaluate(() => openNetplay());
        await p.waitForSelector('#np-host', { timeout: 15000 });
        await p.fill('#np-code', code);
        await p.click('#np-join');
        await p.waitForSelector('.np-code', { timeout: 30000 });
    }
    async function startMatch(host, guest) {
        await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
        await guest.click('#np-ready');
        await host.waitForTimeout(400);
        await host.click('#np-ready');
        await host.waitForTimeout(200);
        await host.click('#np-start');
        await Promise.all([live(host), live(guest)]);
    }
    const kind = p => p.evaluate(() => AOT_ENGINE.state().session.transport.kind);
    const snapRate = async (p, ms) => {
        await p.evaluate(() => {
            window.__snaps = 0;
            if (!window.__counted) { window.__counted = true; AOT_ENGINE.state().session.on('aot:snap', () => { window.__snaps++; }); }
        });
        await p.waitForTimeout(ms);
        return p.evaluate(ms => window.__snaps / (ms / 1000), ms);
    };
    {
        const host = await open(ctx);
        const code = await hostLobby(host);
        const guest = await open(ctx);
        await joinLobby(guest, code);
        await guest.waitForFunction(() => Netplay.current && Netplay.current.gameId === 'ageoftroll', null, { timeout: 8000 }).catch(() => { });
        expect(await guest.evaluate(() => Netplay.current && Netplay.current.gameId) === 'ageoftroll', 'a guest finds out which game it is');
        await startMatch(host, guest);
        expect(await kind(host) === 'peer' && await kind(guest) === 'peer', 'it went direct');
        expect(await state(host, g => g.me) === 0 && await state(guest, g => g.me) === 1, 'they are on opposite sides');
        await host.waitForTimeout(600);
        await host.screenshot({ path: SHOTS + '/aot-online-host.png' });
        const rate = await snapRate(guest, 3000);
        expect(rate >= 5 && rate <= 10, 'snapshots run at the direct rate', rate.toFixed(1) + ' a second');
        expect((await guest.textContent('#aot-link')) === 'direct', 'and the game says which road it is on');

        // a guest's click reaches the host, and comes back as their army
        await guest.click('.aot-cmd[data-cmd="u0"]');
        await host.waitForFunction(() => { const g = AOT_ENGINE.state(); return g.s.p[1].q.length + g.s.u[1].length >= 1; }, null, { timeout: 4000 });
        expect(true, 'a guest\'s click lands on the host');
        await guest.waitForFunction(() => { const g = AOT_ENGINE.state(); return !g.pending.length && g.s.p[1].spent !== undefined; }, null, { timeout: 4000 });
        expect(true, 'and the host says it got it');
        await guest.waitForFunction(() => AOT_ENGINE.state().s.u[1].length >= 1, null, { timeout: 6000 });
        expect(true, 'and the guest sees its own unit');
        const screenLeft = await state(guest, g => { const v = g.s.u[1][0]; return g.me === 1 ? 1600 - v.x : v.x; });
        expect(screenLeft < 800, 'on its own left, where a guest\'s wall is drawn', Math.round(screenLeft) + ' of 1600');
        const agree = async () => {
            const a = await state(host, g => ({ t: g.s.tick, g: g.s.p.map(p => Math.round(p.gold)), n: g.s.u.map(u => u.length) }));
            const b = await state(guest, g => ({ t: g.s.tick, g: g.s.p.map(p => Math.round(p.gold)), n: g.s.u.map(u => u.length) }));
            return { a, b, ok: Math.abs(a.t - b.t) <= 30 && a.n.join() === b.n.join() };
        };
        // the two are read a moment apart, and a guest is a tick or two either
        // side of a unit coming out of the door, so give it a few looks
        let same = await agree();
        for (let i = 0; i < 12 && !same.ok; i++) { await host.waitForTimeout(150); same = await agree(); }
        expect(same.ok, 'both screens agree', JSON.stringify(same));

        // the host decides: the guest cannot spend money it does not have
        await host.evaluate(() => { AOT_ENGINE.state().s.p[1].gold = 0; });
        await guest.waitForFunction(() => AOT_ENGINE.state().s.p[1].gold < 40, null, { timeout: 3000 });
        const forged = await guest.evaluate(() => {
            const g = AOT_ENGINE.state();
            g.session.sendToHost('aot:cmd', { n: ++g.seq, m: g.s.match, c: { c: 'train', r: 2 } });
            return g.seq;
        });
        await host.waitForFunction(n => AOT_ENGINE.state().seenTo >= n, forged, { timeout: 4000 });
        expect(await state(host, g => g.s.p[1].q.length) === 0, 'a guest cannot order what the host says it cannot afford');
        await guest.waitForFunction(() => /gold/.test(document.querySelector('#aot-say').textContent), null, { timeout: 3000 }).catch(() => { });
        expect(/gold/.test(await guest.textContent('#aot-say')), 'and is told so');
        await host.evaluate(() => { AOT_ENGINE.state().s.p[1].gold = 2000; AOT_ENGINE.state().s.p[0].gold = 2000; });

        // relays drop things: a lost command goes again, and a repeat counts once
        await guest.waitForFunction(() => AOT_ENGINE.state().s.p[1].gold > 1000, null, { timeout: 3000 });
        const spent0 = await state(host, g => g.s.p[1].spent);
        await guest.evaluate(() => {
            const s = AOT_ENGINE.state().session, real = s.sendToHost;
            let dropped = 0;
            s.sendToHost = function (t, d) { if (t === 'aot:cmd' && !dropped) { dropped = 1; return; } return real.call(s, t, d); };
        });
        await guest.click('.aot-cmd[data-cmd="u0"]');
        await host.waitForFunction(s => AOT_ENGINE.state().s.p[1].spent > s, spent0, { timeout: 6000 }).catch(() => { });
        const unit = await state(host, (g, A) => A.unitFor(g.s.p[1].age, 0).cost);
        expect(await state(host, g => g.s.p[1].spent) === spent0 + unit, 'a command the network ate goes again');
        await guest.waitForFunction(() => !AOT_ENGINE.state().pending.length, null, { timeout: 4000 });
        const spent1 = await state(host, g => g.s.p[1].spent);
        await guest.evaluate(() => { const g = AOT_ENGINE.state(); g.session.sendToHost('aot:cmd', { n: g.seq, m: g.s.match, c: { c: 'train', r: 0 } }); });
        await host.waitForTimeout(300);
        expect(await state(host, g => g.s.p[1].spent) === spent1, 'and a command that arrives twice happens once');

        // ===================================================================
        section('the link dies mid-match');
        // ===================================================================
        await guest.evaluate(() => window.__cutDirect());
        await guest.waitForFunction(() => AOT_ENGINE.state().session.transport.kind === 'bus', null, { timeout: 10000 }).catch(() => { });
        await host.waitForFunction(() => AOT_ENGINE.state().session.transport.kind === 'bus', null, { timeout: 10000 }).catch(() => { });
        expect(await kind(guest) === 'bus' && await kind(host) === 'bus', 'both sides move to the relays');
        await host.waitForTimeout(1500);
        expect(!(await state(host, g => g.netDown)) && !(await state(guest, g => g.netDown)), 'and nobody is told the other one walked out');
        const slow = await snapRate(guest, 5000);
        expect(slow >= 1.5 && slow <= 4, 'snapshots ease off by themselves', slow.toFixed(1) + ' a second');
        expect((await guest.textContent('#aot-link')) === 'via relays', 'and the game says so');
        const before = await state(host, g => g.s.p[1].spent);
        await guest.click('.aot-cmd[data-cmd="u1"]');
        await host.waitForFunction(s => AOT_ENGINE.state().s.p[1].spent > s, before, { timeout: 8000 }).catch(() => { });
        expect(await state(host, g => g.s.p[1].spent) > before, 'a guest\'s order still lands, through the relays');
        await guest.waitForFunction(() => !AOT_ENGINE.state().pending.length, null, { timeout: 8000 }).catch(() => { });
        expect(!(await state(guest, g => g.pending.length)), 'and is acknowledged');

        // ===================================================================
        section('all the way through, on the relays');
        // ===================================================================
        await host.evaluate(() => AOT_ENGINE.speed(20));
        const presses = await playUntilOver([host, guest], 300000);
        await host.evaluate(() => AOT_ENGINE.speed(1));
        const h = await state(host, (g, A) => ({ over: g.s.over, winner: g.s.winner, t: A.seconds(g.s) }));
        expect(h.over, 'a whole match plays out between two browsers', presses + ' button presses, ' + Math.round(h.t / 60) + ' game minutes, winner ' + h.winner);
        await guest.waitForSelector('#aot-end:not([hidden]) .aot-result', { timeout: 8000 });
        await host.waitForSelector('#aot-end:not([hidden]) .aot-result', { timeout: 8000 });
        const [ht, gt] = [await host.textContent('.aot-result'), await guest.textContent('.aot-result')];
        expect(h.winner === -1 ? ht === gt : ht !== gt, 'both screens know how it ended', ht + ' / ' + gt);
        await host.screenshot({ path: SHOTS + '/aot-online-end.png' });
        await guest.click('#aot-again');
        await host.waitForFunction(() => /rematch: start/.test((document.querySelector('#aot-again') || {}).textContent || ''), null, { timeout: 8000 });
        expect(true, 'a guest can ask for a rematch');
        await host.click('#aot-again');
        await guest.waitForFunction(() => { const g = AOT_ENGINE.state(); return !g.s.over && g.s.match === 1 && g.s.tick < 400; }, null, { timeout: 8000 });
        expect(await guest.locator('#aot-end:not([hidden])').count() === 0, 'and it starts for both of them');
        await guest.click('.aot-cmd[data-cmd="u0"]');
        await host.waitForFunction(() => { const g = AOT_ENGINE.state(); return g.s.p[1].spent > 0; }, null, { timeout: 8000 }).catch(() => { });
        expect(await state(host, g => g.s.p[1].spent) > 0, 'and a new match takes orders from the start, numbered or not');

        // ===================================================================
        section('a player disappears');
        // ===================================================================
        await guest.close();
        await host.waitForFunction(() => AOT_ENGINE.state().netDown, null, { timeout: 15000 });
        expect(true, 'the match freezes rather than playing on against nobody');
        const frozen = await state(host, g => g.s.tick);
        await host.waitForTimeout(500);
        expect(await state(host, g => g.s.tick) === frozen, 'and it really is frozen');
        await host.evaluate(() => { const g = AOT_ENGINE.state(); g.downAt -= 60000; });
        await host.waitForSelector('#aot-subbot', { timeout: 4000 });
        expect(await host.locator('#aot-claim').count() === 1, 'after a while the one who is left gets a choice');
        await host.click('#aot-subbot');
        await host.waitForFunction(t => AOT_ENGINE.state().s.tick > t + 20, frozen, { timeout: 5000 });
        expect(await state(host, g => !!g.brain && !g.netDown), 'a bot can take the empty seat and the match goes on');
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
        expect(await kind(host) === 'bus' && await kind(guest) === 'bus', 'the match starts on the relays');

        // what it costs: every byte the host puts on the wire, on four relays' worth of sockets
        const bytes = { sent: 0, got: 0, on: false };
        const cdp = await host.context().newCDPSession(host);
        await cdp.send('Network.enable');
        cdp.on('Network.webSocketFrameSent', e => { if (bytes.on) bytes.sent += e.response.payloadData.length; });
        cdp.on('Network.webSocketFrameReceived', e => { if (bytes.on) bytes.got += e.response.payloadData.length; });
        await host.evaluate(() => {
            const g = AOT_ENGINE.state(), A = AOT;
            // a busy battlefield, since that is the expensive case
            g.s.p.forEach(p => { p.age = 2; p.gold = 1e6; });
            g.brain = A.newBrain('hard', 'balanced', 5);
            g.mine = A.newBrain('hard', 'balanced', 6);
            window.__bots = setInterval(() => A.think(g.s, 0, g.mine), 200);
        });
        await host.waitForFunction(() => AOT_ENGINE.state().s.u[0].length + AOT_ENGINE.state().s.u[1].length >= 10, null, { timeout: 60000 }).catch(() => { });
        const seconds = 20;
        bytes.on = true;
        await host.waitForTimeout(seconds * 1000);
        bytes.on = false;
        const mb = n => (n * 60 / seconds / 1048576).toFixed(2);
        // one test relay here. The real thing posts to four, and the guide's 3MB
        // a minute is for four, at the eight snapshots a second wizardz sends
        const four = bytes.sent * 4 * 60 / seconds / 1048576;
        expect(four <= 2, 'a battle over the relays costs less than the guide says a duel does', mb(bytes.sent) + 'MB a minute per relay sent, so ' + four.toFixed(2) + 'MB over four');
        await host.evaluate(() => clearInterval(window.__bots));
        await host.evaluate(() => { AOT_ENGINE.state().brain = null; });

        await guest.click('.aot-cmd[data-cmd="u0"]');
        await guest.waitForFunction(() => !AOT_ENGINE.state().pending.length, null, { timeout: 8000 }).catch(() => { });
        expect(!(await state(guest, g => g.pending.length)), 'a guest\'s order lands');

        // the host goes: the guest cannot carry on, because the game was on the host
        await host.close();
        await guest.waitForFunction(() => AOT_ENGINE.state().netDown, null, { timeout: 15000 });
        expect(true, 'a guest whose host vanished is told');
        await guest.evaluate(() => { AOT_ENGINE.state().downAt -= 60000; });
        await guest.waitForSelector('#aot-giveup', { timeout: 4000 });
        await guest.click('#aot-giveup');
        await guest.waitForSelector('.aot-menu', { timeout: 4000 });
        expect(true, 'and can leave');
        await guest.evaluate(() => localStorage.removeItem('test-direct'));
        await guest.close();
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
