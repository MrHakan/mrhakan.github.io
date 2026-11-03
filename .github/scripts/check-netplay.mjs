// ===================================================================
// check-netplay.mjs — the ways online, against a network that misbehaves
//
// A lobby on a static site stands on other people's servers, and those have
// been the whole problem: the free TURN servers vanished, relays started
// refusing and throttling, and none of it looks wrong from one machine. So
// this loads the real file against a fake broker and fake relays that can be
// told to do the things real ones have been measured doing, and holds the
// transports to what happens next.
//
// No browser and no network. browser-netplay.mjs is the same story in a real
// page, and `npm run relays` asks the real relays what they think today.
// ===================================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'games/netplay.js'), 'utf8');
const RELAY = 'wss://relay.test/', RELAYS = ['wss://a.test/', 'wss://b.test/', 'wss://c.test/'];

// everything in the file runs twenty times faster, so the waits are real but short
const SPEED = 20;
const sleep = ms => new Promise(r => setTimeout(r, ms / SPEED));

function world(options = {}) {
    const sockets = new Set();
    const net = {
        sockets, published: {}, opened: {},
        policy: options.policy || (() => true),   // (url, event, n) -> true, or the reason it was refused
        deliver: options.deliver || null,         // (send, url, event, n) -> how an accepted event reaches subscribers
        unreachable: new Set(options.unreachable || []),
        peers: new Map(), peerMode: options.peerMode || 'works', cdnDown: !!options.cdnDown, conns: []
    };

    class FakeSocket {
        constructor(url) {
            this.url = url;
            this.readyState = 0;
            this.subs = new Map();
            this.sentFrames = [];
            net.opened[url] = (net.opened[url] || 0) + 1;
            sockets.add(this);
            setTimeout(() => {
                if (net.unreachable.has(url)) { this.readyState = 3; sockets.delete(this); this.onclose && this.onclose(); return; }
                this.readyState = 1;
                this.onopen && this.onopen();
            }, 1);
        }
        send(text) {
            const m = JSON.parse(text);
            if (m[0] === 'REQ') { this.subs.set(m[1], m[2]); return; }
            if (m[0] !== 'EVENT') return;
            const ev = m[1];
            const n = (net.published[this.url] = (net.published[this.url] || 0) + 1);
            this.sentFrames.push(ev);
            const verdict = net.policy(this.url, ev, n);
            setTimeout(() => {
                if (this.readyState !== 1) return;
                this.onmessage && this.onmessage({ data: JSON.stringify(['OK', ev.id, verdict === true, verdict === true ? '' : verdict]) });
            }, 1);
            if (verdict !== true) return;
            const send = () => {
                sockets.forEach(s => {
                    if (s === this || s.url !== this.url || s.readyState !== 1) return;
                    s.subs.forEach((filter, sub) => {
                        if (filter.kinds && !filter.kinds.includes(ev.kind)) return;
                        s.onmessage && s.onmessage({ data: JSON.stringify(['EVENT', sub, ev]) });
                    });
                });
            };
            if (net.deliver) net.deliver(send, this.url, ev, n);
            else setTimeout(send, 1);
        }
        close() {
            if (this.readyState === 3) return;
            this.readyState = 3;
            sockets.delete(this);
            setTimeout(() => this.onclose && this.onclose(), 0);
        }
    }

    const emitter = () => {
        const on = {};
        return { on(k, fn) { (on[k] = on[k] || []).push(fn); }, emit(k, v) { (on[k] || []).forEach(fn => fn(v)); } };
    };
    // the bits of peerjs the transport touches, with hole punching as a setting
    class FakePeer {
        constructor(id) {
            Object.assign(this, emitter());
            this.id = id || 'guest-' + Math.random().toString(36).slice(2, 8);
            setTimeout(() => {
                if (net.peerMode === 'brokerdown') { this.emit('error', { type: 'network' }); return; }
                net.peers.set(this.id, this);
                this.emit('open', this.id);
            }, 1);
        }
        connect(target) {
            const mine = Object.assign(emitter(), { peer: target, send: d => setTimeout(() => theirs.emit('data', d), 1), close: () => { mine.emit('close'); theirs.emit('close'); } });
            const theirs = Object.assign(emitter(), { peer: this.id, send: d => setTimeout(() => mine.emit('data', d), 1), close: () => { mine.emit('close'); theirs.emit('close'); } });
            net.conns.push(mine);
            setTimeout(() => {
                const host = net.peers.get(target);
                if (!host) { this.emit('error', { type: 'peer-unavailable' }); return; }
                // the broker can introduce them, and the routers will not let them talk
                if (net.peerMode === 'noroute') return;
                host.emit('connection', theirs);
                setTimeout(() => { theirs.emit('open'); mine.emit('open'); }, 1);
            }, 1);
            return mine;
        }
        reconnect() { }
        destroy() { net.peers.delete(this.id); }
    }

    const store = new Map(RELAYS.length ? [['mrhakan98-netplay-relays', (options.relays || RELAYS).join(',')]] : []);
    const localStorage = {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k)
    };
    const win = { localStorage, crypto: globalThis.crypto, performance: globalThis.performance, addEventListener() { } };
    win.window = win;
    const document = {
        readyState: 'complete',
        createElement: () => ({}),
        head: { appendChild(s) {
            setTimeout(() => {
                if (net.cdnDown) { s.onerror && s.onerror(); return; }
                win.Peer = FakePeer;
                s.onload && s.onload();
            }, 1);
        } }
    };
    const fast = {
        setTimeout: (fn, ms) => setTimeout(fn, (ms || 0) / SPEED),
        clearTimeout, setInterval: (fn, ms) => setInterval(fn, ms / SPEED), clearInterval
    };
    // eslint-disable-next-line no-new-func
    new Function('window', 'localStorage', 'performance', 'WebSocket', 'document', 'Peer', 'fetch',
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'location',
        SOURCE.replace(/\bnew Peer\(/g, 'new window.Peer('))(
        win, localStorage, globalThis.performance, FakeSocket, document, FakePeer, undefined,
        fast.setTimeout, fast.clearTimeout, fast.setInterval, fast.clearInterval, undefined);
    return { NP: win.Netplay, net, localStorage };
}

let checks = 0;
async function test(name, run) {
    await run();
    checks++;
    console.log('  ok    ' + name);
}
const section = n => console.log('\n== ' + n + ' ==');
// a transport with its callbacks written down, the way Session would use them
function wired(t) {
    const log = { data: [], peers: [], errors: [], status: [], leaves: [] };
    t.h = {
        data: (from, msg) => log.data.push({ from, msg }),
        peer: id => log.peers.push(id),
        error: e => log.errors.push(e),
        status: s => log.status.push(s),
        leave: id => log.leaves.push(id)
    };
    return log;
}
const texts = log => log.data.map(d => d.msg);
const until = async (cond, ms = 6000) => {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + cond);
        await new Promise(r => setTimeout(r, 2));
    }
};

// signing takes real time and the clock here does not, so a test that needs
// separate events waits for each one to go out rather than sleeping past it
const sendEach = async (t, net, url, messages) => {
    for (const m of messages) {
        const before = net.published[url] || 0;
        t.send('*', m);
        await until(() => (net.published[url] || 0) > before);
    }
};

// ===================================================================
section('the public relays');
// ===================================================================
await test('every message arrives once, however many relays carry it', async () => {
    const { NP } = world();
    const a = NP.TRANSPORTS.bus.make('ROOM1', true), b = NP.TRANSPORTS.bus.make('ROOM1', false);
    const la = wired(a), lb = wired(b);
    await a.open(); await b.open();
    await sleep(100);
    a.send('*', 'one');
    await until(() => lb.data.length);
    await sleep(400);
    assert.deepEqual(texts(lb), ['one']);
    assert.equal(lb.peers.length, 1);
    assert.equal(lb.errors.length + la.errors.length, 0);
    a.close(); b.close();
});
await test('someone else\'s room is noise', async () => {
    const { NP } = world();
    const a = NP.TRANSPORTS.bus.make('ROOM1', true), b = NP.TRANSPORTS.bus.make('ROOM2', false);
    wired(a); const lb = wired(b);
    await a.open(); await b.open();
    await sleep(100);
    a.send('*', 'private');
    await sleep(600);
    assert.deepEqual(lb.data, []);
    assert.deepEqual(lb.peers, []);
    a.close(); b.close();
});
await test('batches that land out of order are put back in order', async () => {
    // holds one event back so the next overtakes it, as a slower relay does. Not
    // the first: a guest can join mid-stream, so where a stream starts is unknowable
    const held = [];
    const { NP, net } = world({
        relays: [RELAY],
        deliver: (send, url, ev, n) => { if (n === 2) held.push(send); else { send(); held.splice(0).forEach(s => s()); } }
    });
    const a = NP.TRANSPORTS.bus.make('ROOM1', true), b = NP.TRANSPORTS.bus.make('ROOM1', false);
    wired(a); const lb = wired(b);
    await a.open(); await b.open();
    await sleep(100);
    await sendEach(a, net, RELAY, ['key down', 'key up', 'cast']);
    await until(() => lb.data.length === 3);
    assert.deepEqual(texts(lb), ['key down', 'key up', 'cast']);
    a.close(); b.close();
});
await test('a batch that never turns up holds the rest back only briefly', async () => {
    const { NP, net } = world({ relays: [RELAY], deliver: (send, url, ev, n) => { if (n !== 2) send(); } });
    const a = NP.TRANSPORTS.bus.make('ROOM1', true), b = NP.TRANSPORTS.bus.make('ROOM1', false);
    wired(a); const lb = wired(b);
    await a.open(); await b.open();
    await sleep(100);
    await sendEach(a, net, RELAY, ['one', 'lost', 'three']);
    await until(() => lb.data.length === 2);
    assert.deepEqual(texts(lb), ['one', 'three']);
    a.close(); b.close();
});
await test('a numbered batch is still readable by an older copy of the site', async () => {
    // an old copy reads the sealed list and skips anything not addressed to it,
    // and the number at the front is not: this holds that shape in place
    assert.match(SOURCE, /const batch = \[\{ n: \+\+sent \}\]\.concat\(queue\);/);
    assert.match(SOURCE, /if \(batch\[0\] && typeof batch\[0\]\.n === 'number'\) inOrder/);
    assert.match(SOURCE, /else deliver\(ev\.pubkey, batch\);/, 'and a batch from one still gets through here');
});
await test('a relay asking for less gets left alone, and one refusing outright stays that way', async () => {
    const { NP, net } = world({
        policy: url => (url === RELAYS[0] ? 'rate-limited: slow down matey' : url === RELAYS[1] ? 'banned: too many rate-limit violations' : true)
    });
    const a = NP.TRANSPORTS.bus.make('ROOM1', true);
    const la = wired(a);
    await a.open();
    await sleep(100);
    await sendEach(a, net, RELAYS[2], ['one']);
    await sleep(100);          // the refusals take a moment to come back
    await sendEach(a, net, RELAYS[2], ['two', 'three']);
    assert.equal(net.published[RELAYS[0]], 1, 'the rate limited relay heard one event and then nothing');
    assert.equal(net.published[RELAYS[1]], 1, 'and so did the one that banned us');
    assert.equal(net.published[RELAYS[2]], 3, 'the relay that is fine keeps getting everything');
    assert.deepEqual(la.errors, []);
    a.close();
});
await test('being told "duplicate" is not being told no', async () => {
    const { NP, net } = world({ relays: [RELAY], policy: () => 'duplicate: already have this event' });
    const a = NP.TRANSPORTS.bus.make('ROOM1', true);
    wired(a);
    await a.open();
    await sleep(100);
    await sendEach(a, net, RELAY, ['one']);
    await sleep(100);
    await sendEach(a, net, RELAY, ['two']);
    assert.equal(net.published[RELAY], 2);
    a.close();
});
await test('when every relay refuses, the player gets told', async () => {
    const { NP } = world({ policy: () => 'blocked: not in web of trust' });
    const a = NP.TRANSPORTS.bus.make('ROOM1', true);
    const la = wired(a);
    await a.open();
    await sleep(100);
    a.send('*', 'one');
    await until(() => la.errors.length);
    assert.match(la.errors[0], /refusing/);
    a.close();
});
await test('a relay that drops the connection gets reconnected, and resubscribed', async () => {
    const { NP, net } = world({ relays: [RELAY] });
    const a = NP.TRANSPORTS.bus.make('ROOM1', true), b = NP.TRANSPORTS.bus.make('ROOM1', false);
    const la = wired(a), lb = wired(b);
    await a.open(); await b.open();
    await sleep(100);
    const before = net.opened[RELAY];
    [...net.sockets].forEach(s => s.close());
    await until(() => la.errors.length && lb.errors.length);
    assert.match(la.errors[0], /lost every public relay/);
    await until(() => net.opened[RELAY] >= before + 2 && [...net.sockets].every(s => s.readyState === 1) && net.sockets.size === 2);
    await sleep(40);
    a.send('*', 'still here');
    await until(() => lb.data.length);
    assert.deepEqual(texts(lb), ['still here']);
    assert.ok(la.status.includes('back on the public relays'));
    a.close(); b.close();
});
await test('a closed connection stays closed', async () => {
    const { NP, net } = world({ relays: [RELAY] });
    const a = NP.TRANSPORTS.bus.make('ROOM1', true);
    wired(a);
    await a.open();
    const before = net.opened[RELAY];
    a.close();
    await sleep(3000);
    assert.equal(net.opened[RELAY], before);
});
await test('the last thing said before closing gets said', async () => {
    const { NP, net } = world({ relays: [RELAY] });
    const a = NP.TRANSPORTS.bus.make('ROOM1', true);
    wired(a);
    await a.open();
    await sleep(100);
    a.send('*', { t: 'np:bye' });
    a.close();
    await until(() => net.published[RELAY] === 1);
});
await test('the built in list has enough relays on it, and not the ones that have turned on us', () => {
    const { NP, localStorage } = world();
    localStorage.removeItem('mrhakan98-netplay-relays');
    const list = NP.nostrRelays();
    assert.ok(list.length >= 3);
    assert.ok(!list.includes('wss://relay.damus.io'), 'bans an address for carrying a duel');
    assert.ok(!list.includes('wss://nostr.mom'), 'accepts events and delivers none of them');
    assert.ok(!list.includes('wss://nos.lol'), 'throttles to a trickle after about 300 events');
});

// ===================================================================
section('auto');
// ===================================================================
const pair = async (opts, code = 'DUEL1') => {
    const w = world(opts);
    const host = w.NP.TRANSPORTS.auto.make(code, true), guest = w.NP.TRANSPORTS.auto.make(code, false);
    return { ...w, host, guest, lh: wired(host), lg: wired(guest) };
};
// the parts of Session this needs: answer a knock by being audible, as pings do
const audible = (t, every = 400) => { const i = setInterval(() => t.send('*', { t: 'np:ping' }), every / SPEED); return () => clearInterval(i); };

await test('it is what the lobby offers first, and plain peer is not on the menu', () => {
    const { NP } = world();
    assert.equal(Object.keys(NP.TRANSPORTS)[0], 'auto');
    assert.equal(NP.TRANSPORTS.peer.hidden, true);
    // the chip still needs a name for each road once it knows which one it is on
    for (const k of ['auto', 'peer', 'bus']) assert.ok(NP.TRANSPORTS[k].label, k);
});
await test('a direct route gets used, and the relays go quiet', async () => {
    const { host, guest, lh, lg, net } = await pair();
    await host.open();
    await sleep(100);
    assert.equal(host.kind, 'auto');
    await guest.open();
    await until(() => host.kind === 'peer');
    assert.equal(guest.kind, 'peer');
    guest.send(null, 'from guest');
    host.send('*', 'from host');
    await until(() => lh.data.length && lg.data.length);
    assert.deepEqual(texts(lh), ['from guest']);
    assert.deepEqual(texts(lg), ['from host']);
    const quiet = { ...net.published };
    host.send('*', 'more'); guest.send(null, 'more');
    await sleep(400);
    assert.deepEqual(net.published, quiet, 'nothing on the relays while a direct link is carrying the game');
    host.close(); guest.close();
});
await test('no route to the host: the guest ends up on the relays by itself', async () => {
    const { host, guest, lh, lg } = await pair({ peerMode: 'noroute' });
    await host.open();
    const stop = audible(host);
    await guest.open();
    assert.equal(guest.kind, 'bus');
    assert.ok(lg.status.includes('no direct route, trying the public relays...'));
    guest.send(null, 'over the relays');
    await until(() => lh.data.some(d => d.msg === 'over the relays'));
    assert.equal(host.kind, 'bus');
    host.send(lh.data.find(d => d.msg === 'over the relays').from, 'and back');
    await until(() => lg.data.some(d => d.msg === 'and back'));
    stop(); host.close(); guest.close();
});
await test('a host nobody can see over p2p is still found by knocking', async () => {
    // no pings at all: only the knock can wake it, the way Session answers a new peer
    const { host, guest, lh } = await pair({ peerMode: 'noroute' });
    await host.open();
    const t = setInterval(() => { if (lh.peers.length) { clearInterval(t); host.send('*', { t: 'np:hello' }); } }, 2);
    await guest.open();
    assert.equal(guest.kind, 'bus');
    host.close(); guest.close();
});
await test('the peerjs cdn being blocked, or the broker being down, is no reason to fail', async () => {
    for (const opts of [{ cdnDown: true }, { peerMode: 'brokerdown' }]) {
        const { host, guest } = await pair(opts);
        await host.open();
        const stop = audible(host);
        await guest.open();
        assert.equal(guest.kind, 'bus');
        stop(); host.close(); guest.close();
    }
});
await test('dead relays are no reason to fail either, when a direct route exists', async () => {
    const { host, guest } = await pair({ unreachable: RELAYS });
    await host.open();
    await guest.open();
    assert.equal(guest.kind, 'peer');
    host.close(); guest.close();
});
await test('with no way through at all, a guest gets told so', async () => {
    const { guest } = await pair({ peerMode: 'noroute', unreachable: RELAYS });
    await assert.rejects(guest.open(), /could not reach the host/);
    guest.close();
});
await test('a code nobody is hosting fails with something a person can act on', async () => {
    const { guest } = await pair();
    await assert.rejects(guest.open(), /nobody answered that code/);
    guest.close();
});
await test('a guest on any mode reaches an auto host, and auto reaches a plain relays host', async () => {
    const w = world({ peerMode: 'noroute' });
    const host = w.NP.TRANSPORTS.auto.make('DUEL1', true), guest = w.NP.TRANSPORTS.bus.make('DUEL1', false);
    const lh = wired(host), lg = wired(guest);
    await host.open(); await guest.open();
    await sleep(100);
    guest.send('*', 'plain');
    await until(() => lh.data.length);
    host.send('*', 'reply');
    await until(() => lg.data.length);
    host.close(); guest.close();

    const x = world({ peerMode: 'noroute' });
    const plainHost = x.NP.TRANSPORTS.bus.make('DUEL2', true), autoGuest = x.NP.TRANSPORTS.auto.make('DUEL2', false);
    wired(plainHost); wired(autoGuest);
    await plainHost.open();
    const stop = audible(plainHost);
    await autoGuest.open();
    assert.equal(autoGuest.kind, 'bus');
    stop(); plainHost.close(); autoGuest.close();
});
await test('a direct link that dies mid-duel moves to the relays, and nobody is told they left', async () => {
    const { host, guest, lh, lg, net } = await pair();
    await host.open();
    await guest.open();
    await until(() => host.kind === 'peer');
    net.conns[0].close();
    await until(() => guest.kind === 'bus');
    assert.deepEqual(lh.leaves, [], 'Session decides who is gone, from silence or a goodbye');
    assert.deepEqual(lg.leaves, []);
    assert.ok(lg.peers.includes('relays'), 'the session is told to say hello down the new road');
    await sleep(100);
    guest.send(null, 'still here');
    await until(() => lh.data.some(d => d.msg === 'still here'));
    assert.equal(host.kind, 'bus');
    host.send('*', 'me too');
    await until(() => lg.data.some(d => d.msg === 'me too'));
    host.close(); guest.close();
});
await test('but a host saying goodbye does not send the guest looking for it', async () => {
    const { host, guest, net } = await pair();
    await host.open();
    await guest.open();
    await until(() => host.kind === 'peer');
    host.send('*', { t: 'np:bye' });
    await sleep(100);
    net.conns[0].close();
    await sleep(600);
    assert.equal(guest.kind, 'peer');
    host.close(); guest.close();
});

// ===================================================================
section('the session on top');
// ===================================================================
await test('a guest keeps saying hello until the host has seated it', async () => {
    const { NP } = world({ relays: [RELAY] });
    const said = [];
    // a relay eating the first few hellos, which is what a slow subscription amounts to
    const host = await NP.host('bus', 'wizardz', 'SEAT1');
    const orig = host._onData.bind(host);
    host._onData = (pid, env) => {
        if (env.t === 'np:hello') { said.push(pid); if (said.length < 3) return; }
        return orig(pid, env);
    };
    const guest = await NP.join('bus', 'SEAT1');
    await until(() => guest.seated);
    assert.ok(said.length >= 3);
    const count = said.length;
    await sleep(4000);
    assert.ok(said.length <= count + 1, 'and stops once it has been');
    guest.leave(); host.leave();
});
await test('going quiet is not forever: the duel hears it when the link comes back', async () => {
    const { NP } = world({ relays: [RELAY] });
    const host = await NP.host('bus', 'wizardz', 'QUIET');
    const guest = await NP.join('bus', 'QUIET');
    await until(() => guest.seated);
    const heard = [];
    guest.on('net:down', () => heard.push('down'));
    guest.on('net:up', () => heard.push('up'));
    // silence from the host's side: the pings stop reaching the guest
    const hostSend = host.transport.send;
    host.transport.send = () => { };
    // silence is measured in real seconds, not the sped up kind
    await until(() => heard.includes('down'), 9000);
    host.transport.send = hostSend;
    await until(() => heard.includes('up'), 3000);
    assert.deepEqual(heard, ['down', 'up']);
    guest.leave(); host.leave();
});
await test('the lobby is told what is happening while it happens', async () => {
    const { NP } = world({ peerMode: 'noroute' });
    const seen = [];
    await assert.rejects(NP.join('auto', 'NOPE1', m => seen.push(m)));
    assert.deepEqual(seen.slice(0, 2), ['trying a direct connection...', 'no direct route, trying the public relays...']);
});
await test('a failed attempt leaves no connections open', async () => {
    const { NP, net } = world({ peerMode: 'noroute' });
    await assert.rejects(NP.join('auto', 'NOPE1'));
    await sleep(100);
    assert.equal(net.sockets.size, 0);
});
await test('turn servers can come from the site config, and stun is always there', () => {
    const { NP } = world();
    assert.ok(JSON.stringify(NP.iceServers()).includes('stun:'));
    assert.ok(!JSON.stringify(NP.iceServers()).includes('peerjs.com'), 'those are gone from dns');
    NP._siteIce = [{ urls: 'turn:turn.example:3478', username: 'u', credential: 'c' }];
    assert.ok(NP.iceServers().some(s => s.urls === 'turn:turn.example:3478'));
});

// ===================================================================
section('invite links');
// ===================================================================
await test('the desktop opens one without the multiplayer code having loaded', () => {
    const web = fs.readFileSync(path.join(ROOT, 'js/web.js'), 'utf8');
    const open = web.slice(web.indexOf('function openFromUrl'), web.indexOf('function scrollToAnchor'));
    assert.match(open, /query\.get\('lobby'\)/);
    assert.match(open, /openNetplay\(\{ joinCode: invite, autoJoin: true \}\)/);
    assert.match(open, /clearUrl\(\)/, 'a reload should not try to rejoin a lobby that is gone');
    assert.ok(!SOURCE.includes('checkInviteLink'), 'and netplay.js, which is not loaded yet, no longer pretends to');
});
await test('the links it hands out are the ones the desktop reads', () => {
    assert.match(SOURCE, /return base \+ '\?lobby=' \+ code;/);
});

console.log(`\n${checks} netplay regression checks passed.`);
// the sessions left over from the tests above are still pinging each other
process.exit(0);
