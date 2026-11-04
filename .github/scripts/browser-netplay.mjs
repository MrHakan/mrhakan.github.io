// ===================================================================
// browser-netplay.mjs — getting two strangers into a duel
//
// browser-check.mjs duels over the transports you can pick by hand. This
// one is the way online most people actually get: nothing picked, an invite
// link, and whatever the network between them allows. It runs on no outside
// server at all. peerjs is replaced with a stand-in whose hole punching is a
// setting, and the public relays are server/nostr-test-relay.mjs, which this
// starts for itself.
//
//   python3 -m http.server 8092 &
//   SITE_URL=http://localhost:8092 node .github/scripts/browser-netplay.mjs
// ===================================================================
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { TRIANGLE, ZBOLT, takeMouse, inkDraw, faceOff, shoot, honestMouse } from './wizardz-play.mjs';

const BASE = (process.env.SITE_URL || 'http://localhost:8092').replace(/\/$/, '');
const RELAY_PORT = 8700 + Math.floor(Math.random() * 90);
const RELAY = 'ws://127.0.0.1:' + RELAY_PORT;

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg);
    else { failures++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

// The parts of peerjs the transport touches, over a BroadcastChannel between
// the tabs. 'noroute' is what a strict NAT comes to: the broker introduces
// the two browsers and they never manage to talk.
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

const browser = await chromium.launch(Object.assign({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }, process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}));
const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
await honestMouse(ctx);
let cdnBlocked = false;
await ctx.route('**/*', route => {
    const u = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    if (/peerjs/.test(u) && !cdnBlocked) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_PEERJS });
    return route.abort();
});
await ctx.addInitScript(relays => {
    try {
        sessionStorage.setItem('welcomed', '1');
        // an invite gets the boot screen, because that is part of what it has to survive
        if (!location.search.includes('lobby=')) sessionStorage.setItem('booted', '1');
        localStorage.setItem('mrhakan98-netplay-relays', relays);
        localStorage.setItem('sound-enabled', 'false');
    } catch (e) { }
}, RELAY);

const errors = [];
async function open(url) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(url || BASE + '/', { waitUntil: 'load' });
    return p;
}
const lobbyOf = async p => {
    await p.evaluate(() => openNetplay());
    await p.waitForSelector('#np-host', { timeout: 15000 });
};
async function hostOn(p) {
    await lobbyOf(p);
    await p.click('#np-host');
    await p.waitForSelector('.np-code', { timeout: 20000 });
    return (await p.textContent('.np-code')).trim();
}
async function joinOn(p, code) {
    await lobbyOf(p);
    await p.fill('#np-code', code);
    await p.click('#np-join');
    await p.waitForSelector('.np-code', { timeout: 30000 });
}
const kind = p => p.evaluate(() => Netplay.current ? Netplay.current.transport.kind : (window.WZ_ENGINE && WZ_ENGINE.state().session.transport.kind));
const live = p => p.waitForFunction(() => { const g = window.WZ_ENGINE && WZ_ENGINE.state(); return g && g.phase === 'live'; }, null, { timeout: 30000 });
async function startDuel(host, guest) {
    await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
    await guest.click('#np-ready');
    await host.waitForTimeout(500);
    await host.click('#np-ready');
    await host.waitForTimeout(300);
    await host.click('#np-start');
    await Promise.all([host.waitForSelector('#wz-canvas', { timeout: 30000 }), guest.waitForSelector('#wz-canvas', { timeout: 30000 })]);
    await Promise.all([live(host), live(guest)]);
}
async function spellsCross(host, guest, what) {
    await faceOff(host, [guest]);
    await takeMouse(guest);
    await inkDraw(guest, TRIANGLE);
    await shoot(guest, 2);
    await takeMouse(host);
    await inkDraw(host, ZBOLT);
    await shoot(host, 3);
    const landed = await host.waitForFunction(() => { const g = WZ_ENGINE.state(); return g.wiz[0].hp < 100 && g.wiz[1].hp < 100; }, null, { timeout: 25000 }).then(() => true, () => false);
    expect(landed, 'spells drawn on both sides land ' + what);
    await host.waitForTimeout(800);
    const hp = p => p.evaluate(() => WZ_ENGINE.state().wiz.map(w => Math.round(w.hp)));
    const [a, b] = [await hp(host), await hp(guest)];
    expect(a.every((v, i) => Math.abs(v - b[i]) <= 8), 'and both screens agree', JSON.stringify([a, b]));
}

try {
    // ===================================================================
    section('the lobby');
    // ===================================================================
    {
        const p = await open();
        await lobbyOf(p);
        expect(await p.inputValue('#np-mode') === 'auto', 'nobody has to pick anything: automatic is the default');
        const offered = await p.$$eval('#np-mode option', o => o.map(x => x.value));
        expect(!offered.includes('peer'), 'and a mode that can only fail where automatic would not is not on offer', offered.join(', '));
        await p.close();

        // what the old default left behind in somebody's browser
        const q = await open();
        await q.evaluate(() => localStorage.setItem('mrhakan98-netplay-mode', 'peer'));
        await lobbyOf(q);
        expect(await q.inputValue('#np-mode') === 'auto', 'a browser that remembers the old default gets the new one');
        await q.evaluate(() => localStorage.removeItem('mrhakan98-netplay-mode'));
        await q.close();
    }

    // ===================================================================
    section('an invite link, with a direct route');
    // ===================================================================
    {
        const host = await open();
        const code = await hostOn(host);
        const guest = await ctx.newPage();
        guest.on('pageerror', e => errors.push(e.message));
        await guest.goto(BASE + '/?lobby=' + code, { waitUntil: 'load' });
        await guest.waitForSelector('#boot-prompt.visible', { timeout: 15000 });
        expect(await guest.locator('.np-body').count() === 0, 'the lobby waits for the boot screen, rather than opening behind it');
        await guest.keyboard.press('Enter');
        await guest.waitForSelector('.np-code', { timeout: 30000 });
        expect(true, 'opening the link gets you into the lobby, without anything else having loaded the multiplayer code');
        expect((await guest.textContent('.np-code')).trim() === code, 'the same lobby the host is in');
        expect(!/lobby=/.test(guest.url()), 'and the address is cleaned up, so a reload does not try to rejoin', guest.url());
        expect(await kind(guest) === 'peer' && await kind(host) === 'peer', 'it went direct', await kind(guest) + '/' + await kind(host));
        expect(/direct/.test(await guest.textContent('#np-link')), 'and the lobby says so');

        await guest.fill('#np-chatin', 'prepare to be hexed');
        await guest.click('#np-send');
        await host.waitForFunction(() => [...document.querySelectorAll('.np-line')].some(l => /prepare to be hexed/.test(l.textContent)), null, { timeout: 10000 });
        expect(true, 'the chat crosses');

        await startDuel(host, guest);
        await spellsCross(host, guest, 'over the direct link');
        await host.close();
        await guest.close();
    }

    // ===================================================================
    section('no direct route');
    // ===================================================================
    {
        const host = await open();
        await host.evaluate(() => localStorage.setItem('test-direct', 'noroute'));
        const code = await hostOn(host);
        const guest = await open();
        await lobbyOf(guest);
        await guest.fill('#np-code', code);
        await guest.evaluate(() => {
            window.__said = [];
            new MutationObserver(() => {
                const t = (document.querySelector('#np-status') || {}).textContent;
                if (t && window.__said[window.__said.length - 1] !== t) window.__said.push(t);
            }).observe(document.body, { subtree: true, childList: true, characterData: true });
        });
        const t0 = Date.now();
        await guest.click('#np-join');
        await guest.waitForSelector('.np-code', { timeout: 30000 });
        const took = Date.now() - t0;
        expect(took < 12000, 'the guest gets in by itself, in a reasonable time', took + 'ms');
        const said = await guest.evaluate(() => window.__said);
        expect(said.some(s => /direct/.test(s)) && said.some(s => /relays/.test(s)), 'and is told what it is doing meanwhile', JSON.stringify(said));
        await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
        expect(await kind(guest) === 'bus' && await kind(host) === 'bus', 'it went through the relays', await kind(guest) + '/' + await kind(host));
        expect(/relays/.test(await guest.textContent('#np-link')) && /relays/.test(await host.textContent('#np-link')),
            'and the lobby says so, on both sides');
        await startDuel(host, guest);
        await spellsCross(host, guest, 'through the relays');
        await host.evaluate(() => localStorage.removeItem('test-direct'));
        await host.close();
        await guest.close();
    }

    // ===================================================================
    section('the peerjs cdn blocked');
    // ===================================================================
    {
        cdnBlocked = true;
        const host = await open();
        const code = await hostOn(host);
        expect(true, 'a lobby still opens');
        const guest = await open();
        await joinOn(guest, code);
        await host.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 20000 });
        expect(await kind(guest) === 'bus', 'and a friend still gets into it', await kind(guest));
        await host.close();
        await guest.close();
        cdnBlocked = false;
    }

    // ===================================================================
    section('a code nobody is hosting');
    // ===================================================================
    {
        const p = await open();
        await lobbyOf(p);
        await p.fill('#np-code', 'ZZZZZ');
        const t0 = Date.now();
        await p.click('#np-join');
        await p.waitForFunction(() => /failed/.test((document.querySelector('#np-status') || {}).textContent || ''), null, { timeout: 30000 });
        expect(Date.now() - t0 < 12000, 'it says so before long', (Date.now() - t0) + 'ms');
        const msg = await p.textContent('#np-status');
        expect(/nobody answered/.test(msg), 'in words a person can do something with', msg);
        expect(await p.locator('.np-code').count() === 0, 'and does not leave you sitting alone in a lobby');
        await p.close();
    }

    // ===================================================================
    section('a direct link dying mid-duel');
    // ===================================================================
    {
        const host = await open();
        const code = await hostOn(host);
        const guest = await open();
        await joinOn(guest, code);
        await startDuel(host, guest);
        const before = await guest.evaluate(() => WZ_ENGINE.state().session.transport.kind);
        expect(before === 'peer', 'the duel starts direct', before);
        const hp = await host.evaluate(() => WZ_ENGINE.state().wiz[0].hp);
        await guest.evaluate(() => window.__cutDirect());
        await guest.waitForFunction(() => WZ_ENGINE.state().session.transport.kind === 'bus', null, { timeout: 10000 }).catch(() => { });
        expect(await guest.evaluate(() => WZ_ENGINE.state().session.transport.kind) === 'bus', 'the guest moves to the relays');
        await host.waitForFunction(() => WZ_ENGINE.state().session.transport.kind === 'bus', null, { timeout: 10000 }).catch(() => { });
        expect(await host.evaluate(() => WZ_ENGINE.state().session.transport.kind) === 'bus', 'and the host follows');
        await host.waitForTimeout(1500);
        const down = await Promise.all([host, guest].map(p => p.evaluate(() => WZ_ENGINE.state().netDown)));
        expect(down.every(d => !d), 'nobody gets told the other one walked out', JSON.stringify(down));
        await faceOff(host, [guest]);
        await takeMouse(guest);
        await inkDraw(guest, TRIANGLE);
        await shoot(guest, 2);
        const landed = await host.waitForFunction(h => WZ_ENGINE.state().wiz[0].hp < h, hp, { timeout: 25000 }).then(() => true, () => false);
        expect(landed, 'and a spell cast after the move still lands');
        await host.close();
        await guest.close();
    }

    section('page errors');
    expect(!errors.length, 'nothing threw the whole way through', [...new Set(errors)].slice(0, 6).join('\n        '));
} catch (e) {
    expect(false, 'the run fell over', String(e.message).split('\n').slice(0, 3).join('\n        '));
} finally {
    await browser.close();
    relay.kill();
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' browser checks FAILED' : 'all ' + checks + ' browser checks passed'));
process.exit(failures ? 1 : 0);
