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
        sockets, timers: new Set(), published: {}, opened: {},
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
        setTimeout: (fn, ms) => {
            const timer = setTimeout(() => { net.timers.delete(timer); fn(); }, (ms || 0) / SPEED);
            net.timers.add(timer);
            return timer;
        },
        clearTimeout: timer => { net.timers.delete(timer); clearTimeout(timer); },
        setInterval: (fn, ms) => setInterval(fn, ms / SPEED), clearInterval
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
await test('invalid signed events cannot create peers, deliver data or poison dedupe', async () => {
    let captured;
    const { NP, net } = world({ relays: [RELAY], deliver: (send, url, ev) => { captured = ev; } });
    const a = NP.TRANSPORTS.bus.make('SIG01', true), b = NP.TRANSPORTS.bus.make('SIG01', false);
    wired(a); const lb = wired(b);
    await a.open(); await b.open();
    a.send('*', 'authenticated');
    await until(() => captured);
    const socket = [...net.sockets][1];
    const inject = ev => socket.onmessage({ data: JSON.stringify(['EVENT', 'np', ev]) });
    const sk = NP.bip340.newKey(), pub = NP.bip340.toHex(await NP.bip340.pubkey(sk));
    const wrongRoom = await NP.nostr.signEvent(sk, pub, NP.nostr.KIND, [['d', 'wrong-room']], captured.content);
    for (const ev of [
        { ...captured, sig: '0'.repeat(128) },
        { ...captured, id: 'f'.repeat(64) },
        { ...captured, pubkey: pub },
        { ...captured, tags: null },
        { ...captured, tags: [null] },
        { ...captured, created_at: -1 },
        { ...captured, content: 'x'.repeat(300000) }, wrongRoom
    ]) inject(ev);
    await sleep(2500);
    assert.deepEqual(lb.data, [], 'a relay is not trusted to check signatures or room tags');
    assert.deepEqual(lb.peers, [], 'reject before peer/liveness callbacks');
    inject(captured);
    await until(() => lb.data.length === 1);
    inject(captured);
    await sleep(500);
    assert.deepEqual(texts(lb), ['authenticated'], 'bad copies do not suppress a later valid event, and valid duplicates arrive once');
    a.close(); b.close();
});
await test('an invalid in-flight signature cannot suppress a valid copy of the same event', async () => {
    const { NP, net } = world({ relays: [RELAY], deliver: (send, url, ev) => {
        for (const socket of net.sockets) {
            if (socket.url !== url) continue;
            for (const sub of socket.subs.keys()) {
                socket.onmessage({ data: JSON.stringify(['EVENT', sub, { ...ev, sig: '0'.repeat(128) }]) });
            }
        }
        // No await or timer: the forged signature is still being checked when
        // the real relay copy (and its duplicate) reaches the same callback.
        send(); send();
    } });
    const a = NP.TRANSPORTS.bus.make('RACE1', true), b = NP.TRANSPORTS.bus.make('RACE1', false);
    wired(a); const lb = wired(b);
    try {
        await a.open(); await b.open();
        a.send('*', 'valid after corrupt copy');
        await sleep(5000);
        assert.deepEqual(texts(lb), ['valid after corrupt copy'], 'an unverified claimed ID cannot suppress the authentic event');
        assert.deepEqual(lb.peers, [a.id], 'the authenticated peer is announced exactly once');
    } finally {
        a.close(); b.close();
    }
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
    assert.equal(net.sockets.size, 0, 'closing with no work closes the pool synchronously');
    a.send('*', 'after close');
    a.close();
    await sleep(3000);
    assert.equal(net.opened[RELAY], before);
    assert.equal(net.published[RELAY] || 0, 0);
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
for (const queued of [false, true]) {
    await test('closing waits for every overlapping batch' + (queued ? ' before draining the queue' : ''), async () => {
        const { NP, net } = world({ relays: [RELAY] });
        const a = NP.TRANSPORTS.bus.make('DRAIN', true);
        const log = wired(a), held = [];
        const sign = NP.bip340.sign;
        let signCalls = 0;
        // Only pause the first two signatures; encryption and signing stay real.
        NP.bip340.sign = async (...args) => {
            if (++signCalls <= 2) await new Promise(resolve => held.push(resolve));
            return sign(...args);
        };
        try {
            await a.open();
            // Let the already-settled open timeout expire before tracking leaks.
            await until(() => net.timers.size === 0);
            const socket = [...net.sockets][0];
            a.send('*', 'older');
            await until(() => held.length === 1);
            a.send('*', 'newer');
            await until(() => held.length === 2);
            if (queued) a.send('*', 'goodbye');
            a.close();
            a.close();
            held[1]();                // the newest post finishes, the older is still signing
            await until(() => (net.published[RELAY] || 0) >= 1);
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(socket.readyState, 1, 'the older batch must keep the pool open');
            assert.equal(signCalls, 2, 'the queued goodbye waits for every earlier post');
            a.send('*', 'too late');
            assert.equal(net.timers.size, 0, 'closing refuses new messages without scheduling a flush');
            held[0]();
            await until(() => net.sockets.size === 0);
            assert.equal(net.published[RELAY], queued ? 3 : 2, 'all accepted batches were published before closing');
            assert.equal(signCalls, queued ? 3 : 2, 'repeated close does not duplicate a drain');
            assert.equal(net.timers.size, 0, 'no transport timers survive the drain');
            assert.deepEqual(log.errors, []);

            const keyHash = await NP.bip340.sha256(new TextEncoder().encode('mrhakan98-key|DRAIN'));
            const key = await crypto.subtle.importKey('raw', keyHash, 'AES-GCM', false, ['decrypt']);
            const batches = [];
            for (const ev of socket.sentFrames) {
                assert.equal(await NP.nostr.verifyEvent(ev), true);
                const raw = Buffer.from(ev.content, 'base64');
                const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
                batches.push(JSON.parse(new TextDecoder().decode(plain)));
            }
            assert.deepEqual(batches, [
                [{ n: 2 }, { to: '*', msg: 'newer' }],
                [{ n: 1 }, { to: '*', msg: 'older' }],
                ...(queued ? [[{ n: 3 }, { to: '*', msg: 'goodbye' }]] : [])
            ], 'the original batch numbers and contents survive out-of-order signing');
            a.send('*', 'after close');
            a.close();
            await sleep(3000);
            assert.equal(net.published[RELAY], batches.length, 'nothing is sent after the pool closes');
            assert.equal(net.opened[RELAY], 1, 'closed sockets do not reconnect');
            assert.equal(net.timers.size, 0);
        } finally {
            NP.bip340.sign = sign;
            held.forEach(release => release());
            a.close();
        }
    });
}
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
    host.send('*', { t: 'np:bye', f: host.id });
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
await test('leaving says goodbye, so nobody waits out the silence', async () => {
    const { NP } = world({ relays: [RELAY] });
    const host = await NP.host('bus', 'wizardz', 'BYE01');
    const guest = await NP.join('bus', 'BYE01');
    await until(() => guest.seated && host.players.length === 2);
    const left = [];
    host.on('player-leave', p => left.push(p.id));
    const t0 = Date.now();
    guest.leave();
    // silence takes six real seconds to count; a goodbye is one batch away
    await until(() => left.length, 2500);
    assert.deepEqual(left, [guest.id]);
    assert.ok(Date.now() - t0 < 2500);
    const heard = [];
    const again = await NP.join('bus', 'BYE01');
    await until(() => again.seated);
    again.on('net:down', why => heard.push(why));
    host.leave();
    await until(() => heard.length, 2500);
    assert.deepEqual(heard, ['the host disappeared']);
    again.leave();
});
await test('a guest on each road still hears the other, through the host', async () => {
    const { NP } = world({ relays: [RELAY] });
    const host = await NP.host('auto', 'trailz', 'MIXED');
    const direct = await NP.join('auto', 'MIXED');
    await until(() => direct.seated && direct.transport.kind === 'peer');
    const relayed = await NP.join('bus', 'MIXED');
    await until(() => relayed.seated && host.players.length === 3);
    assert.equal(host.transport.kind, 'bus', 'the host eases off for everybody once one guest is on the relays');
    const heard = { direct: [], relayed: [], host: [] };
    direct.on('chat', m => heard.direct.push(m.text));
    relayed.on('chat', m => heard.relayed.push(m.text));
    host.on('chat', m => heard.host.push(m.text));
    direct.on('tz:poke', d => heard.direct.push('poke ' + d.n));
    relayed.on('tz:poke', d => heard.relayed.push('poke ' + d.n));
    direct.send('np:chat', { text: 'from the direct one' });
    relayed.send('np:chat', { text: 'from the relayed one' });
    relayed.send('tz:poke', { n: 1 }, direct.id);
    direct.send('tz:poke', { n: 2 }, relayed.id);
    await until(() => heard.direct.length >= 2 && heard.relayed.length >= 2 && heard.host.length >= 2, 4000);
    await sleep(400);
    assert.deepEqual(heard.direct.sort(), ['from the relayed one', 'poke 1']);
    assert.deepEqual(heard.relayed.sort(), ['from the direct one', 'poke 2']);
    assert.deepEqual(heard.host.sort(), ['from the direct one', 'from the relayed one'], 'and the host hears each of them once');
    direct.leave(); relayed.leave(); host.leave();
});
await test('copying the host ID cannot authorize signed guest controls', async () => {
    const { NP } = world({ relays: [RELAY] });
    NP.launch = () => { };
    const host = await NP.host('bus', 'trailz', 'COPY1');
    const a = await NP.join('bus', 'COPY1');
    const b = await NP.join('bus', 'COPY1');
    await until(() => a.seated && b.seated && a.players.length === 3 && b.players.length === 3 && b.gameId === 'trailz' && b.players.some(p => p.id === host.id && p.host));
    const roster = () => b.players.map(({ id, name, ready, host }) => ({ id, name, ready, host }));
    const before = roster(), started = [];
    b.on('start', () => started.push(true));
    for (const [t, d] of [
        ['np:start', { gameId: 'wizardz' }],
        ['np:roster', [{ id: host.id, host: true }, { id: b.id }]],
        ['np:game', { gameId: 'wizardz' }]
    ]) a.transport.send('*', { v: NP.VERSION, t, d, f: host.id, to: '*' });
    await sleep(3000);
    assert.deepEqual(started, [], 'a valid guest signature is not a host signature');
    assert.equal(b.gameId, 'trailz');
    assert.deepEqual(roster(), before);
    host.send('np:start', { gameId: 'trailz' });
    await until(() => started.length === 1);
    a.leave(); b.leave(); host.leave();
});
await test('a relay signature cannot be rebound to another player by hello, ready or bye', async () => {
    const { NP } = world({ relays: [RELAY] });
    const host = await NP.host('bus', 'trailz', 'BIND1');
    const a = await NP.join('bus', 'BIND1'), b = await NP.join('bus', 'BIND1');
    await until(() => a.seated && b.seated && host.players.length === 3);
    const victim = host.players.find(p => p.id === b.id), peer = victim.peerId, name = victim.name;
    for (const [t, d] of [['np:ready', { ready: true }], ['np:hello', { name: 'forged' }], ['np:bye', {}]]) {
        a.transport.send('*', { v: NP.VERSION, t, d, f: b.id, to: '*' });
    }
    await sleep(3000);
    assert.equal(host.players.length, 3);
    assert.equal(victim.peerId, peer, 'a forged hello cannot rewrite the authenticated route');
    assert.equal(victim.name, name);
    assert.equal(victim.ready, false);
    b.send('np:ready', { ready: true });
    await until(() => victim.ready === true);
    a.leave(); b.leave(); host.leave();
});
await test('a Session keeps its signing identity and seat when direct play moves to the relays', async () => {
    const { NP, net } = world({ relays: [RELAY] });
    const host = await NP.host('auto', 'trailz', 'ROAD2');
    const guest = await NP.join('auto', 'ROAD2');
    await until(() => guest.seated && guest.transport.kind === 'peer');
    const identity = guest.id, departed = [], heard = [];
    assert.match(identity, /^[0-9a-f]{64}$/);
    host.on('player-leave', p => departed.push(p.id));
    host.on('tz:input', (d, from) => heard.push({ d, id: from.id }));
    net.conns[0].close();
    await until(() => guest.transport.kind === 'bus' && host.players.find(p => p.id === identity)?.peerId === 'b:' + identity, 6000);
    guest.send('tz:input', { turn: 7 });
    await until(() => heard.length);
    assert.equal(guest.id, identity);
    assert.equal(host.players.filter(p => p.id === identity).length, 1);
    assert.deepEqual(heard, [{ d: { turn: 7 }, id: identity }]);
    assert.deepEqual(departed, []);
    guest.leave(); host.leave();
});
await test('an unsigned PeerJS ID cannot impersonate a signing public key', async () => {
    const { NP, net } = world({ relays: [RELAY] });
    const host = await NP.host('auto', 'trailz', 'KEYID');
    const victim = await NP.join('bus', 'KEYID');
    await until(() => victim.seated && net.peers.size > 0);
    const broker = [...net.peers.keys()][0], Peer = net.peers.get(broker).constructor;
    const attacker = new Peer(victim.id);
    await new Promise(resolve => attacker.on('open', resolve));
    const conn = attacker.connect(broker);
    await new Promise(resolve => conn.on('open', resolve));
    conn.send({ v: NP.VERSION, t: 'np:ready', f: victim.id, d: { ready: true }, to: '*' });
    await sleep(2000);
    assert.equal(host.players.find(p => p.id === victim.id).ready, false);
    conn.close(); attacker.destroy(); victim.leave(); host.leave();
});
await test('a reused PeerJS ID does not inherit the signing identity of a closed connection', async () => {
    const { NP, net } = world({ relays: [RELAY] });
    const host = await NP.host('auto', 'trailz', 'REUSE');
    const victim = await NP.join('auto', 'REUSE');
    await until(() => victim.seated && victim.transport.kind === 'peer');
    const brokerId = [...net.peers.keys()].find(id => id.startsWith('mrh98-'));
    const reusedId = [...net.peers.keys()].find(id => id !== brokerId);
    const Peer = net.peers.get(brokerId).constructor;
    net.conns[0].close();
    await until(() => victim.transport.kind === 'bus' && host.players.find(p => p.id === victim.id)?.peerId === 'b:' + victim.id, 6000);
    const attacker = new Peer(reusedId);
    await new Promise(resolve => attacker.on('open', resolve));
    const conn = attacker.connect(brokerId);
    await new Promise(resolve => conn.on('open', resolve));
    conn.send({ auth: { id: victim.id }, msg: { v: NP.VERSION, t: 'np:ready', f: victim.id, d: { ready: true }, to: '*' } });
    await sleep(2000);
    assert.equal(host.players.find(p => p.id === victim.id).ready, false);
    conn.close(); attacker.destroy(); victim.leave(); host.leave();
});
await test('a reused broker ID cannot speak for a plain peer player who has left', async () => {
    const { NP, net } = world({ relays: [RELAY] });
    const host = await NP.host('peer', 'trailz', 'PEER2');
    const victim = await NP.join('peer', 'PEER2');
    await until(() => victim.seated && host.players.length === 2);
    const brokerId = [...net.peers.keys()].find(id => id.startsWith('mrh98-'));
    const reusedId = [...net.peers.keys()].find(id => id !== brokerId);
    const Peer = net.peers.get(brokerId).constructor, heard = [];
    host.on('chat', message => heard.push(message));
    net.conns[0].close();
    await sleep(500);
    const attacker = new Peer(reusedId);
    await new Promise(resolve => attacker.on('open', resolve));
    const conn = attacker.connect(brokerId);
    await new Promise(resolve => conn.on('open', resolve));
    const forged = { v: NP.VERSION, t: 'np:chat', f: victim.id, d: { text: 'gg I quit' }, to: '*' };
    conn.send(forged);
    conn.send({ auth: { id: victim.id }, msg: forged });
    await sleep(2000);
    assert.deepEqual(heard.filter(m => m.id === victim.id), [], 'nobody speaks for the departed player');
    conn.close(); attacker.destroy(); victim.leave(); host.leave();
});
await test('a flood of strangers on the relays cannot crowd out a player already in the room', async () => {
    let network, flood = false;
    const { NP, net } = world({ relays: [RELAY], deliver(send, url, ev) {
        if (!flood) return setTimeout(send, 1);
        // Throwaway keys, the room's tag, junk signatures: all still pending
        // when every relay copy of the real event arrives in the same turn.
        const junk = () => Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        for (const socket of network.sockets) {
            if (socket.url !== url) continue;
            for (const sub of socket.subs.keys()) {
                for (let i = 0; i < 80; i++) {
                    socket.onmessage?.({ data: JSON.stringify(['EVENT', sub, { ...ev, id: junk(), pubkey: junk(), sig: junk() + junk() }]) });
                }
                // and forgeries that claim the real sender's public key, which is
                // no secret: they must not use up that player's share either
                for (let i = 0; i < 40; i++) {
                    socket.onmessage?.({ data: JSON.stringify(['EVENT', sub, { ...ev, id: junk(), sig: junk() + junk() }]) });
                }
                socket.onmessage?.({ data: JSON.stringify(['EVENT', sub, ev]) });
            }
        }
    } });
    network = net;
    const a = NP.TRANSPORTS.bus.make('FLOOD', true), b = NP.TRANSPORTS.bus.make('FLOOD', false);
    const lb = wired(b); wired(a);
    await a.open(); await b.open();
    a.send('*', 'hello');
    await until(() => lb.data.length === 1, 4000);
    flood = true;
    a.send('*', 'still here');
    await until(() => lb.data.length === 2, 4000);
    await sleep(300);
    assert.deepEqual(texts(lb), ['hello', 'still here']);
    assert.equal(lb.peers.length, 1);
    a.close(); b.close();
});
await test('real Sessions seat, exchange chat and start across plain-peer and auto combinations', async () => {
    for (const [hostMode, guestMode] of [['auto', 'peer'], ['peer', 'auto'], ['peer', 'peer']]) {
        const { NP } = world({ relays: [RELAY] });
        NP.launch = () => { };
        const host = await NP.host(hostMode, 'trailz', 'PLAIN');
        const guest = await NP.join(guestMode, 'PLAIN');
        await until(() => guest.seated && host.players.length === 2, 4000);
        const messages = [];
        host.on('chat', msg => messages.push(msg));
        guest.send('np:chat', { text: 'plain and auto' });
        await until(() => messages.length === 1);
        assert.equal(messages[0].id, guest.id);
        const starts = [];
        guest.on('start', () => starts.push(true));
        host.startGame();
        await until(() => starts.length === 1);
        guest.leave(); host.leave();
    }
});
await test('cached version-one identities request a refresh without seating or starting anyone', async () => {
    const { NP, net } = world({ relays: [RELAY] });
    const host = await NP.host('auto', 'trailz', 'OLDV1');
    const guest = await NP.join('auto', 'OLDV1');
    await until(() => guest.seated);
    const errors = [];
    host.on('net:error', message => errors.push(message));
    net.conns[0].send({ v: NP.VERSION - 1, t: 'np:hello', f: 'legacy-auto-id', d: { name: 'old client' }, to: '*' });
    await until(() => errors.length, 2500);
    assert.match(errors[0], /refresh/);
    assert.equal(host.players.length, 2);
    guest.leave(); host.leave();
});
await test('only the host runs the room: a guest cannot start it, reseat it or sign somebody else out', async () => {
    const { NP } = world({ relays: [RELAY] });
    NP.launch = () => { };
    const host = await NP.host('bus', 'trailz', 'BOSS1');
    const a = await NP.join('bus', 'BOSS1');
    await until(() => a.seated);
    const b = await NP.join('bus', 'BOSS1');
    await until(() => b.seated && host.players.length === 3 && a.players.length === 3);
    assert.equal(a.hostId, host.id, 'a guest knows the host from the roster that seated it');
    const started = [], left = [];
    [host, a, b].forEach((s, i) => s.on('start', () => started.push(i)));
    host.on('player-leave', p => left.push(p.id));
    // a guest trying the host's lines, to everybody and to one
    a.send('np:start', { gameId: 'trailz', seed: 1, slots: [a.id], at: Date.now() });
    a.send('np:roster', [{ id: a.id, name: 'boss', host: true }]);
    a.send('np:game', { gameId: 'wizardz' }, b.id);
    // and a goodbye in somebody else's name
    a.send('np:bye', {}, host.id);
    a.transport.send(a.transport.hostId, { v: NP.VERSION, t: 'np:bye', d: {}, f: b.id, to: host.id });
    // broken envelopes change nothing either
    a.transport.send(a.transport.hostId, { v: NP.VERSION, t: 7, f: a.id });
    a.transport.send(a.transport.hostId, { v: NP.VERSION, t: 'np:chat', d: { text: 'x' } });
    await sleep(3000);
    assert.deepEqual(started, []);
    assert.deepEqual(b.players.map(p => p.id).sort(), [host.id, b.id].sort(), 'b sees the host\'s roster, not the forged one');
    assert.ok(b.players.find(p => p.id === host.id).host);
    assert.equal(b.gameId, host.gameId);
    assert.deepEqual(left.filter(id => id === b.id), [], 'b is still seated');
    assert.equal(host.players.length, 2, 'a signed itself out, which it may');
    // and the host's own start still goes through
    host.players.forEach(p => { p.ready = true; });
    host.send('np:start', { gameId: 'trailz', seed: 2, slots: host.players.map(p => p.id), at: Date.now() });
    await until(() => started.includes(2), 3000);
    host.leave(); b.leave();
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
    assert.match(SOURCE, /\+ '\?lobby=' \+ code;/);
    assert.match(SOURCE, /'join\/' \+ gameId \+ '\/'/);
    assert.match(SOURCE, /NP\.inviteLink\(s\.code, s\.gameId\)/, 'the lobby copies the link for its own game');
});
await test('every online game has a join page that previews as that game and goes on to the lobby', () => {
    const ids = [...SOURCE.slice(SOURCE.indexOf('NP.CATALOG = ['), SOURCE.indexOf('NP.games = {}')).matchAll(/\bid: '([a-z0-9]+)'/g)].map(m => m[1]);
    assert.ok(ids.length >= 3, 'found the catalog');
    for (const id of ids) {
        const dir = path.join(ROOT, 'join', id);
        const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
        const meta = k => (html.match(new RegExp('<meta (?:property|name)="' + k + '" content="([^"]*)"')) || [])[1];
        assert.ok(meta('og:title') && meta('og:description') && meta('og:description').length > 60, id + ': a title and a real description');
        assert.equal(meta('og:url'), 'https://mrhakan.github.io/join/' + id + '/');
        assert.equal(meta('og:image'), 'https://mrhakan.github.io/join/' + id + '/preview.jpg');
        assert.equal(meta('twitter:card'), 'summary_large_image');
        assert.equal(meta('robots'), 'noindex', id + ': not a page for search results');
        const jpg = fs.readFileSync(path.join(dir, 'preview.jpg'));
        assert.ok(jpg[0] === 0xff && jpg[1] === 0xd8, id + ': the preview is a jpeg');
        assert.ok(jpg.length < 300 * 1024, id + ': and small enough for a chat app to fetch');
        let size = null;
        for (let i = 2; i < jpg.length - 8;) {
            if (jpg[i] !== 0xff) { i++; continue; }
            const marker = jpg[i + 1];
            if (marker >= 0xc0 && marker <= 0xc3) { size = [jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)]; break; }
            i += 2 + jpg.readUInt16BE(i + 2);
        }
        assert.deepEqual(size, [1200, 630], id + ': 1200 x 630, which is what the tags say');
        assert.match(html, /location\.replace\('\.\.\/\.\.\/' \+ \(code\.length >= 4 \? '\?lobby=' \+ code/, id + ': and it goes on to the lobby');
    }
});

console.log(`\n${checks} netplay regression checks passed.`);
// the sessions left over from the tests above are still pinging each other
process.exit(0);
