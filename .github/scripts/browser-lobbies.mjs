// ===================================================================
// browser-lobbies.mjs — strangers finding each other
//
// check-lobbies.mjs holds the list to its rules with fake relays. This is
// the same story in real pages, each in its own browser context so that
// nothing is shared between them but the relay: a host lists a lobby, a
// stranger sees it and joins with one click, the match starts and the
// listing goes; a host closing the tab takes its listing with it; two
// quick matches find each other, one after the other and both at once;
// and rubbish on the relay leaves the list standing.
//
// It brings its own static server and server/nostr-test-relay.mjs, and
// sends nothing off the machine.
//
//   node .github/scripts/browser-lobbies.mjs
// ===================================================================
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RELAY_PORT = 8600 + Math.floor(Math.random() * 90);
const RELAY = 'ws://127.0.0.1:' + RELAY_PORT;
const TTL = 8000;

let failures = 0, checks = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg);
    else { failures++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

// ---------- a server that answers the way github pages does ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'text/xml', '.webmanifest': 'application/json', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, clean);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not here'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const relay = spawn(process.execPath, [path.join(ROOT, 'server/nostr-test-relay.mjs')], { env: { ...process.env, PORT: String(RELAY_PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));

// peerjs that never finds anybody, so every pair goes through the relay the
// way two strangers behind strict routers would
const NO_PEERJS = String.raw`
window.Peer = function (id) {
    const on = {}, self = this;
    self.id = id || 'guest-' + Math.random().toString(36).slice(2, 8);
    self.on = (k, f) => { (on[k] = on[k] || []).push(f); return self; };
    const emit = (k, v) => (on[k] || []).slice().forEach(f => f(v));
    self.connect = () => {
        const c = { on() { return c; }, send() { }, close() { } };
        setTimeout(() => emit('error', { type: 'peer-unavailable' }), 100);
        return c;
    };
    self.reconnect = () => { };
    self.destroy = () => { };
    setTimeout(() => emit('open', self.id), 5);
};`;

const browser = await chromium.launch(Object.assign({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }, process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}));
const errors = [];
const contexts = [];
// a separate browser: its own storage, its own name, and only the relay in common
async function stranger(name) {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
    contexts.push(ctx);
    await ctx.route('**/*', route => {
        const u = route.request().url();
        if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        if (/peerjs/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: NO_PEERJS });
        // komarev.com, waust.at and every other stranger's server
        return route.abort();
    });
    await ctx.addInitScript(([relays, who, ttl]) => {
        window.NP_LOBBY_TTL_MS = ttl;
        try {
            sessionStorage.setItem('welcomed', '1');
            sessionStorage.setItem('booted', '1');
            localStorage.setItem('mrhakan98-netplay-relays', relays);
            localStorage.setItem('sound-enabled', 'false');
            if (!localStorage.getItem('mrhakan98-netplay-profile')) {
                localStorage.setItem('mrhakan98-netplay-profile', JSON.stringify({ id: who + Math.random().toString(36).slice(2, 8), name: who, avatar: null }));
            }
        } catch (e) { }
    }, [RELAY, name, TTL]);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.evaluate(() => openNetplay());
    await p.waitForSelector('#np-host', { timeout: 15000 });
    await p.waitForSelector('#np-lb-list', { timeout: 15000 });
    return p;
}
const codesOn = p => p.$$eval('.np-lb-join', b => b.map(x => x.dataset.code));
const rowOf = (p, code) => p.$eval(`.np-lb-join[data-code="${code}"]`, b => b.closest('.np-lb-row').textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const listed = (p, code, yes = true, ms = 12000) => p.waitForFunction(([c, y]) =>
    !!document.querySelector(`.np-lb-join[data-code="${c}"]`) === y, [code, yes], { timeout: ms }).then(() => true, () => false);
async function hostPublic(p, opts = {}) {
    if (opts.game) await p.selectOption('#np-game', opts.game);
    await p.check('#np-public');
    await p.click('#np-host');
    await p.waitForSelector('.np-code', { timeout: 20000 });
    if (opts.mode) await p.selectOption('select[data-opt="mode"]', opts.mode);
    return (await p.textContent('.np-code')).trim();
}
const seated = (p, n) => p.waitForFunction(k => document.querySelectorAll('.np-player:not(.np-empty)').length === k, n, { timeout: 20000 }).then(() => true, () => false);

try {
    // ===================================================================
    section('the window, before anyone has listed anything');
    // ===================================================================
    const watcher = await stranger('carol');
    {
        const sockets = await watcher.evaluate(() => performance.getEntriesByType('resource').filter(r => /lobbies\.js/.test(r.name)).length);
        expect(sockets === 1, 'the list code arrives with the lobby window');
        await watcher.waitForFunction(() => /none right now/.test(document.querySelector('#np-lb-count').textContent), null, { timeout: 15000 });
        expect(true, 'and says, rather than shows nothing, when nobody is listed');
        expect(!(await watcher.isChecked('#np-public')), 'a new lobby is private unless you say otherwise');
        const fresh = await browser.newContext();
        contexts.push(fresh);
        await fresh.route('**/*', r => (/^https?:\/\/127\.0\.0\.1[:/]/.test(r.request().url()) ? r.continue() : r.abort()));
        const idle = await fresh.newPage();
        const opened = [];
        idle.on('websocket', ws => opened.push(ws.url()));
        await idle.addInitScript(r => { try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); localStorage.setItem('mrhakan98-netplay-relays', r); } catch (e) { } }, RELAY);
        await idle.goto(BASE + '/', { waitUntil: 'load' });
        await idle.waitForTimeout(1500);
        const loaded = await idle.evaluate(() => !!window.Netplay);
        expect(!opened.length && !loaded, 'the desktop on its own connects to nothing and loads none of it', opened.join(', '));
        await fresh.close();
    }

    // ===================================================================
    section('a stranger finds a lobby, joins it, and the match starts');
    // ===================================================================
    {
        const alice = await stranger('alice');
        const code = await hostPublic(alice, { mode: '2' });
        expect(await alice.isChecked('#np-listed'), 'the host can see it is listed');
        const seen = await listed(watcher, code);
        expect(seen, 'somebody else with the lobby window open sees it');
        // the host picked 2 v 2 after the lobby went up, which is a new listing
        await watcher.waitForFunction(c => { const b = document.querySelector(`.np-lb-join[data-code="${c}"]`); return b && /2 v 2/.test(b.closest('.np-lb-row').textContent); }, code, { timeout: 8000 }).catch(() => { });
        const row = await rowOf(watcher, code);
        expect(/wizardz 98/.test(row) && /2 v 2/.test(row) && /the temple/.test(row), 'with the game, the mode and the map', row);
        expect(/alice/.test(row) && /1\/4/.test(row) && /3 free/.test(row), 'who is hosting, and the seats', row);
        expect(/open (just now|\dm)/.test(row), 'and how long it has been open', row);

        const bob = await stranger('bob');
        expect(await listed(bob, code), 'a stranger opening the window later sees it too');
        await bob.waitForFunction(c => /~\d+ms/.test(document.querySelector(`.np-lb-join[data-code="${c}"]`).closest('.np-lb-row').textContent), code, { timeout: 10000 }).catch(() => { });
        expect(/~\d+ms/.test(await rowOf(bob, code)), 'with a round trip through the relays as its ping', await rowOf(bob, code));
        await bob.click(`.np-lb-join[data-code="${code}"]`);
        await bob.waitForSelector('.np-code', { timeout: 30000 });
        expect((await bob.textContent('.np-code')).trim() === code, 'one click, and the stranger is in the same lobby');
        expect(await seated(alice, 2), 'and seated on the host\'s screen');
        await watcher.waitForFunction(c => { const b = document.querySelector(`.np-lb-join[data-code="${c}"]`); return b && /2\/4/.test(b.closest('.np-lb-row').textContent); }, code, { timeout: 12000 }).catch(() => { });
        expect(/2\/4/.test(await rowOf(watcher, code)), 'the list counts the new head', await rowOf(watcher, code));

        await bob.click('#np-ready');
        await alice.waitForTimeout(400);
        await alice.click('#np-ready');
        await alice.waitForTimeout(300);
        await alice.click('#np-start');
        const started = await Promise.all([alice, bob].map(p => p.waitForSelector('#wz-canvas', { timeout: 30000 }).then(() => true, () => false)));
        expect(started.every(Boolean), 'the match starts on both screens');
        expect(await listed(watcher, code, false, 6000), 'and the listing is gone from everyone else\'s');
        await alice.context().close();
        await bob.context().close();
    }

    // ===================================================================
    section('the host goes');
    // ===================================================================
    {
        const dave = await stranger('dave');
        const code = await hostPublic(dave, { game: 'ageoftroll' });
        expect(await listed(watcher, code), 'an age of troll lobby is listed');
        expect(/age of troll/.test(await rowOf(watcher, code)) && /1\/2/.test(await rowOf(watcher, code)), 'as age of troll, with two seats', await rowOf(watcher, code));
        await dave.waitForTimeout(1500);          // long enough for its goodbye to be signed in advance
        let t0 = Date.now();
        await dave.goto('about:blank');
        const gone = await listed(watcher, code, false, TTL + 4000);
        expect(gone && Date.now() - t0 < TTL / 2, 'leaving the site takes it off the list at once, not at the time limit', (Date.now() - t0) + 'ms');

        // a tab killed outright may not get its goodbye out, so the time limit is what catches it
        const kate = await stranger('kate');
        const code1 = await hostPublic(kate);
        expect(await listed(watcher, code1), 'another lobby is listed');
        t0 = Date.now();
        await kate.close();
        const dropped = await listed(watcher, code1, false, TTL + 5000);
        expect(dropped, 'a tab killed outright drops off by itself', (Date.now() - t0) + 'ms, the time limit is ' + TTL + 'ms');

        const erin = await stranger('erin');
        const code2 = await hostPublic(erin, { game: 'dungeonz' });
        expect(await listed(watcher, code2), 'a dungeonz lobby is listed');
        await erin.click('#np-leave');
        expect(await listed(watcher, code2, false, 4000), 'leaving the lobby takes it off');
        const code3 = await hostPublic(erin, { game: 'dungeonz' });
        expect(await listed(watcher, code3), 'and so does unticking the box', 'it was not listed again');
        await erin.uncheck('#np-listed');
        expect(await listed(watcher, code3, false, 4000), 'unticked, it is gone');
        await erin.context().close();
    }

    // ===================================================================
    section('rubbish on the relay');
    // ===================================================================
    {
        const frank = await stranger('frank');
        const real = await hostPublic(frank);
        expect(await listed(watcher, real), 'a real listing is up');
        // somebody else's socket on the same relay, posting what it likes
        const result = await watcher.evaluate(async ([url, real]) => {
            const N = window.Netplay, L = N.Lobbies, K = N.nostr.KIND;
            const ws = new WebSocket(url);
            await new Promise(r => { ws.onopen = r; });
            const send = ev => ws.send(JSON.stringify(['EVENT', ev]));
            const raw = s => ws.send(s);
            const sk = N.bip340.newKey(), pub = N.bip340.toHex(await N.bip340.pubkey(sk));
            const sign = (c, tag) => N.nostr.signEvent(sk, pub, K, [['d', tag || L.TAG]], typeof c === 'string' ? c : JSON.stringify(c));
            const t = Math.floor(Date.now() / 1000);
            const base = { v: 1, pv: N.VERSION, g: 'wizardz', o: { mode: '1', map: 'temple' }, c: 'XSS22', n: 'x', p: 1, m: 2, t };
            ['not json', '[]', '["EVENT"]', 'x'.repeat(9000)].forEach(raw);
            for (const c of ['{"v":1', 'null', JSON.stringify(Object.assign({}, base, { g: 'nope' })), JSON.stringify(Object.assign({}, base, { p: 99 })),
                JSON.stringify(Object.assign({}, base, { c: '<b>' })), JSON.stringify(Object.assign({}, base, { n: 'y'.repeat(900) }))]) send(await sign(c));
            const forged = await sign(Object.assign({}, base, { c: 'FRG22', n: 'forger' }));
            forged.content = JSON.stringify(Object.assign({}, base, { c: 'FRG22', n: 'hijacked' }));
            send(forged);
            // a goodbye for the real one, signed by the wrong key
            send(await sign({ v: 1, gone: 1, c: real }));
            await new Promise(r => setTimeout(r, 1100));
            // and one that is well formed, with a name that is html
            send(await sign(Object.assign({}, base, { n: '<img src=x onerror="window.__pwned=1">' })));
            await new Promise(r => setTimeout(r, 1500));
            ws.close();
            return L.stats();
        }, [RELAY, real]);
        expect(await listed(watcher, real), 'the real listing is still there', JSON.stringify(result));
        expect(!(await codesOn(watcher)).includes('FRG22'), 'a forged one never shows up');
        const xss = await rowOf(watcher, 'XSS22');
        expect(/<img src=x onerr/.test(xss), 'a name that is html shows up as text', xss);
        expect(!(await watcher.evaluate(() => window.__pwned)) && !(await watcher.$('.np-lb-list img')), 'and does nothing');
        expect(result && result.rejected >= 5, 'the rest is turned away, with reasons', JSON.stringify(result && result.why));
        await frank.context().close();
    }

    // ===================================================================
    section('quick match');
    // ===================================================================
    {
        const gina = await stranger('gina');
        await gina.selectOption('#np-qmode', '1');
        await gina.click('#np-quick');
        await gina.waitForSelector('.np-code', { timeout: 20000 });
        const code = (await gina.textContent('.np-code')).trim();
        expect(/listed/.test(await gina.textContent('#np-status')) && await gina.isChecked('#np-listed'), 'with nobody about, quick match opens a lobby and lists it', await gina.textContent('#np-status'));
        const harry = await stranger('harry');
        await harry.selectOption('#np-qmode', '1');
        await harry.click('#np-quick');
        await harry.waitForSelector('.np-code', { timeout: 30000 });
        expect((await harry.textContent('.np-code')).trim() === code, 'the next quick match lands in it');
        expect(await seated(gina, 2), 'two strangers in one lobby');
        expect(await listed(watcher, code, false, 6000), 'and full, it comes off the list');
        await gina.context().close();
        await harry.context().close();

        // both at once: both find nothing, both open one, and one moves
        const ivy = await stranger('ivy'), jack = await stranger('jack');
        await Promise.all([ivy, jack].map(p => p.click('#np-quick')));
        const together = await Promise.all([ivy, jack].map(p => p.waitForFunction(() =>
            document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 40000 }).then(() => true, () => false)));
        const codes = await Promise.all([ivy, jack].map(p => p.textContent('.np-code').catch(() => '')));
        expect(together.every(Boolean) && codes[0] === codes[1], 'two quick matches at the same moment end up in one lobby', codes.join(' / '));
        await ivy.context().close();
        await jack.context().close();
    }

    section('page errors');
    expect(!errors.length, 'nothing threw the whole way through', [...new Set(errors)].slice(0, 6).join('\n        '));
} catch (e) {
    expect(false, 'the run fell over', String(e.stack || e.message).split('\n').slice(0, 4).join('\n        '));
} finally {
    for (const c of contexts) await c.close().catch(() => { });
    await browser.close();
    relay.kill();
    server.close();
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' browser checks FAILED' : 'all ' + checks + ' browser checks passed'));
process.exit(failures ? 1 : 0);
