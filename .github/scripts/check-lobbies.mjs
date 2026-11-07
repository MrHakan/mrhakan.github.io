// ===================================================================
// check-lobbies.mjs — the open lobby list, against strangers
//
// The list is read off public relays, so everything on it was written by
// somebody we know nothing about. This loads the real games/netplay.js and
// games/lobbies.js and holds the list to what it promises: a listing is
// checked before it is believed, a stale one goes, a forged or broken one
// changes nothing, and one key gets one line however often it shouts.
//
// No browser and no network: the relays are fakes in this file.
// browser-lobbies.mjs is the same story in real pages, and
// `npm run relays -- --lobbies` asks the real relays.
// ===================================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NETPLAY = fs.readFileSync(path.join(ROOT, 'games/netplay.js'), 'utf8');
const LOBBIES = fs.readFileSync(path.join(ROOT, 'games/lobbies.js'), 'utf8');
const RELAYS = ['wss://a.test/', 'wss://b.test/', 'wss://c.test/'];
const TTL = 3000;

// ---------------------------------------------------------------
// a page: netplay.js and lobbies.js, a localStorage, and relays that
// behave like the real ones (they echo to the sender too)
// ---------------------------------------------------------------
function world(options = {}) {
    const net = options.net || { sockets: new Set(), opened: 0, frames: 0, policy: () => true, refused: 0 };
    class FakeSocket {
        constructor(url) {
            this.url = url;
            this.readyState = 0;
            this.subs = new Map();
            this.owner = options.name || 'page';
            net.opened++;
            net.sockets.add(this);
            setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1);
        }
        send(text) {
            const m = JSON.parse(text);
            if (m[0] === 'REQ') { this.subs.set(m[1], m.slice(2)); return; }
            if (m[0] === 'CLOSE') { this.subs.delete(m[1]); return; }
            if (m[0] !== 'EVENT') return;
            net.frames++;
            const ev = m[1];
            const verdict = net.policy(this.url, ev);
            setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(['OK', ev.id, verdict === true, verdict === true ? '' : verdict]) }), 1);
            if (verdict !== true) { net.refused++; return; }
            setTimeout(() => deliver(this.url, ev), 1);
        }
        close() {
            if (this.readyState === 3) return;
            this.readyState = 3;
            net.sockets.delete(this);
            setTimeout(() => this.onclose && this.onclose(), 0);
        }
    }
    const matches = (f, ev) => (!f.kinds || f.kinds.includes(ev.kind)) &&
        (!f['#d'] || ev.tags.some(t => t[0] === 'd' && f['#d'].includes(t[1])));
    function deliver(url, ev) {
        net.sockets.forEach(s => {
            if (s.url !== url || s.readyState !== 1) return;
            s.subs.forEach((filters, sub) => {
                if (filters.some(f => matches(f, ev))) s.onmessage && s.onmessage({ data: JSON.stringify(['EVENT', sub, ev]) });
            });
        });
    }
    // a raw frame from a relay, for the garbage tests
    net.inject = net.inject || ((text) => net.sockets.forEach(s => s.readyState === 1 && s.onmessage && s.onmessage({ data: text })));
    net.deliver = deliver;

    const store = new Map([['mrhakan98-netplay-relays', (options.relays || RELAYS).join(',')]]);
    const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
    const listeners = {};
    const win = {
        localStorage, crypto: globalThis.crypto, performance: globalThis.performance,
        NP_LOBBY_TTL_MS: TTL,
        addEventListener: (k, fn) => { (listeners[k] = listeners[k] || new Set()).add(fn); },
        removeEventListener: (k, fn) => { listeners[k] && listeners[k].delete(fn); },
        fire: k => (listeners[k] || new Set()).forEach(fn => fn())
    };
    win.window = win;
    const document = { readyState: 'complete', createElement: () => ({}), head: { appendChild() { } }, getElementById: () => null };
    // eslint-disable-next-line no-new-func
    new Function('window', 'localStorage', 'performance', 'WebSocket', 'document', 'fetch', 'location', NETPLAY)(
        win, localStorage, globalThis.performance, FakeSocket, document, undefined, undefined);
    // eslint-disable-next-line no-new-func
    new Function('window', 'WebSocket', 'document', LOBBIES)(win, FakeSocket, document);
    return { NP: win.Netplay, L: win.Netplay.Lobbies, net, win, localStorage };
}

let checks = 0;
async function test(name, run) {
    await run();
    checks++;
    console.log('  ok    ' + name);
}
const section = n => console.log('\n== ' + n + ' ==');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (cond, ms = 5000, what) => {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + (what || cond));
        await sleep(5);
    }
};

const { NP, L } = world();
const B = NP.bip340;
const now = () => Math.floor(Date.now() / 1000);
const SK = B.newKey();
const PUB = B.toHex(await B.pubkey(SK));
// a listing as a host would write it, with anything overridden
function content(over) {
    return Object.assign({ v: 1, pv: NP.VERSION, g: 'wizardz', o: { mode: '2', map: 'bin' }, c: 'ABCDE', n: 'zap248', p: 1, m: 4, t: now() - 90, r: 'europe' }, over);
}
async function signed(c, opts = {}) {
    const ev = await NP.nostr.signEvent(opts.sk || SK, opts.pub || PUB, NP.nostr.KIND, opts.tags || [['d', L.TAG]], typeof c === 'string' ? c : JSON.stringify(c));
    return ev;
}
// an unsigned event of the right shape, for the checks that come before the signature
function shaped(c, over) {
    return Object.assign({ id: 'a'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128), kind: NP.nostr.KIND, created_at: now(), tags: [['d', L.TAG]], content: typeof c === 'string' ? c : JSON.stringify(c) }, over);
}
const why = (c, over) => L.readEvent(shaped(c, over), now()).why;

// ===================================================================
section('reading a listing');
// ===================================================================
await test('a listing is read into what the list shows, and nothing else', async () => {
    const r = L.readEvent(shaped(content({ extra: 'x'.repeat(40) })), now());
    assert.ok(r.listing, JSON.stringify(r));
    const l = r.listing;
    assert.equal(l.game, 'wizardz');
    assert.deepEqual(l.opts, { mode: '2', map: 'bin' });
    assert.equal(l.mode, '2');
    assert.equal(l.seats, 4);
    assert.equal(l.players, 1);
    assert.equal(l.name, 'zap248');
    assert.equal(l.region, 'europe');
    assert.ok(Math.abs(l.openFor - 90) <= 1);
    assert.equal(l.extra, undefined);
});

await test('the seat count is the game\'s, never the listing\'s', async () => {
    assert.equal(L.readEvent(shaped(content({ m: 99 })), now()).listing.seats, 4);
    assert.equal(L.readEvent(shaped(content({ o: { mode: '4' } })), now()).listing.seats, 8);
    assert.equal(L.readEvent(shaped(content({ g: 'ageoftroll', o: {} })), now()).listing.seats, 2);
    assert.equal(L.readEvent(shaped(content({ g: 'dungeonz', o: { dungeon: 'bsod' } })), now()).listing.seats, 4);
    // every game in the catalogue gets a list entry without doing anything
    for (const g of NP.CATALOG) {
        const s = L.seatsFor(g, L.cleanOptions(g, {}));
        assert.ok(s >= g.min && s <= g.max, g.id + ' seats ' + s);
    }
});

await test('options are only ever ones the game offers', async () => {
    const r = L.readEvent(shaped(content({ o: { mode: '<b>9</b>', map: 'the moon', evil: 1, __proto__: { polluted: 1 } } })), now());
    assert.deepEqual(r.listing.opts, { mode: '1', map: 'temple' });
    assert.equal(({}).polluted, undefined);
    assert.deepEqual(L.readEvent(shaped(content({ o: ['1', '2'] })), now()).listing.opts, { mode: '1', map: 'temple' });
    assert.deepEqual(L.readEvent(shaped(content({ o: null })), now()).listing.opts, { mode: '1', map: 'temple' });
});

await test('names come out as short plain text, whatever went in', async () => {
    const name = c => L.readEvent(shaped(content({ n: c })), now()).listing.name;
    assert.equal(name('<img src=x onerror=alert(1)>'), '<img src=x onerr');   // text: the list escapes it when it draws
    assert.equal(NP.esc(name('<img src=x onerror=alert(1)>')), '&lt;img src=x onerr');
    assert.equal(name('a‮evil​\u0000\n\tname'), 'aevil name');
    assert.equal(name('ź̂̃̄̅̆'), 'ź̂');
    assert.equal(name('🧙'.repeat(20)), '🧙'.repeat(16));
    assert.equal(name('   '), 'someone');
    assert.equal(name(42), 'someone');
    assert.equal(name({ toString: 'x' }), 'someone');
    assert.equal(L.readEvent(shaped(content({ r: 'mars' })), now()).listing.region, null);
});

await test('anything that is not a lobby someone can join is dropped, and says why', async () => {
    assert.equal(why(content({ g: 'tetris' })), 'unknown game');
    assert.equal(why(content({ g: { id: 'wizardz' } })), 'unknown game');
    assert.equal(why(content({ pv: NP.VERSION + 1 })), 'another version of the site');
    for (const c of ['abcde', 'ABCDEF', 'ABCD', 'ABCO1', 'ABC D', 12345, null, '<b>X'])
        assert.equal(why(content({ c })), 'bad code', String(c));
    for (const p of [0, -1, 5, 1.5, '2', NaN, null, 1e309, Number.MAX_SAFE_INTEGER])
        assert.equal(why(content({ p })), 'bad player count', String(p));
    assert.equal(why(content({ t: now() + 3600 })), 'bad age');
    assert.equal(why(content({ t: now() - 7 * 3600 })), 'bad age');
    assert.equal(why(content({ t: 'yesterday' })), 'bad age');
    assert.equal(why(content({ v: 2 })), 'not a listing');
    assert.equal(why('[1,2,3]'), 'not a listing');
    assert.equal(why('null'), 'not a listing');
    assert.equal(why('{"v":1,'), 'not json');
    assert.equal(why(JSON.stringify(content({ n: 'x'.repeat(600) }))), 'too big');
    assert.equal(why(content(), { kind: 1 }), 'wrong kind');
    assert.equal(why(content(), { tags: [['d', 'mrh98-something-else']] }), 'not a lobby');
    assert.equal(why(content(), { tags: [] }), 'not a lobby');
    assert.equal(why(content(), { tags: [['d', L.TAG], ['t', 'a'], ['t', 'b'], ['t', 'c'], ['t', 'd']] }), 'bad tags');
    assert.equal(why(content(), { sig: 'nope' }), 'not signed');
    assert.equal(why(content(), { pubkey: 'B'.repeat(64) }), 'not signed');
    assert.equal(why(content(), { id: undefined }), 'not signed');
    for (const ev of [null, 42, 'EVENT', [], { kind: NP.nostr.KIND }]) assert.ok(L.readEvent(ev, now()).why);
});

await test('an old listing that somebody replays is stale before it is anything', async () => {
    assert.equal(why(content(), { created_at: now() - 600 }), 'stale');
    assert.equal(why(content(), { created_at: now() + 600 }), 'stale');
    assert.equal(why(content(), { created_at: '1700000000' }), 'stale');
    assert.ok(L.readEvent(shaped(content(), { created_at: now() - 60 }), now()).listing, 'a clock a minute out is fine');
});

await test('goodbyes and questions are told apart from listings', async () => {
    assert.deepEqual(L.readEvent(shaped({ v: 1, gone: 1, c: 'ABCDE' }), now()).gone, { key: 'b'.repeat(64), code: 'ABCDE' });
    assert.equal(L.readEvent(shaped({ v: 1, gone: 1, c: '<x>' }), now()).why, 'bad code');
    const ask = L.readEvent(shaped({ v: 1, ask: 1, q: 'abc123', g: 'wizardz' }, { tags: [['d', L.ASK_TAG]] }), now()).ask;
    assert.deepEqual(ask, { key: 'b'.repeat(64), q: 'abc123', game: 'wizardz' });
    const bad = L.readEvent(shaped({ v: 1, ask: 1, q: '<script>', g: 'nope' }, { tags: [['d', L.ASK_TAG]] }), now()).ask;
    assert.deepEqual(bad, { key: 'b'.repeat(64), q: null, game: null });
});

// ===================================================================
section('signatures');
// ===================================================================
await test('the official BIP-340 vectors verify, and nothing near them does', async () => {
    const hex = h => B.fromHex(h.toLowerCase());
    const VECTORS = [
        ['F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9', '0000000000000000000000000000000000000000000000000000000000000000',
            'E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0'],
        ['DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659', '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            '6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE33418906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A'],
        ['DD308AFEC5777E13121FA72B9CC1B7CC0139715309B086C960E18FD969774EB8', '7E2D58D8B3BCDF1ABADEC7829054F90DDA9805AAB56C77333024B9D0A508B75C',
            '5831AAEED7B44BB74E5EAB94BA9D4294C49BCF2A60728D8B4C200F50DD313C1BAB745879A5AD954A72C45A91C3A51D3C7ADEA98D82F8481E0E1E03674A6F3FB7'],
        ['25D1DFF95105F5253C4022F628A996AD3A0D95FBF21D468A1B33F8C160D8F517', 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
            '7EB0509757E246F19449885651611CB965ECC1A187DD51B64FDA1EDC9637D5EC97582B9CB13DB3933705B32BA982AF5AF25FD78881EBB32771FC5922EFC66EA3']
    ];
    for (const [pk, msg, sig] of VECTORS) {
        assert.equal(await B.verify(hex(msg), hex(pk), hex(sig)), true, 'vector ' + pk.slice(0, 8));
        const flip = (h, i) => { const b = hex(h); b[i] ^= 1; return b; };
        assert.equal(await B.verify(flip(msg, 31), hex(pk), hex(sig)), false, 'another message');
        assert.equal(await B.verify(hex(msg), hex(pk), flip(sig, 5)), false, 'a bent r');
        assert.equal(await B.verify(hex(msg), hex(pk), flip(sig, 60)), false, 'a bent s');
        assert.equal(await B.verify(hex(msg), flip(pk, 0), hex(sig)), false, 'somebody else');
    }
    // vector 5: a public key that is not on the curve
    assert.equal(await B.verify(hex(VECTORS[1][1]), hex('EEFDEA4CDB677750A420FEE807EACF21EB9898AE79B9768766E4FAA04A2D4A34'), hex(VECTORS[1][2])), false);
    const P = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F';
    const N = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141';
    assert.equal(await B.verify(hex(VECTORS[1][1]), hex(VECTORS[1][0]), hex(P + VECTORS[1][2].slice(64))), false, 'r is not below p');
    assert.equal(await B.verify(hex(VECTORS[1][1]), hex(VECTORS[1][0]), hex(VECTORS[1][2].slice(0, 64) + N)), false, 's is not below n');
    assert.equal(await B.verify(new Uint8Array(3), hex(VECTORS[1][0]), hex(VECTORS[1][2])), false, 'short input');
});

await test('a whole event checks out only if nobody touched it', async () => {
    const ev = await signed(content());
    assert.equal(await NP.nostr.verifyEvent(ev), true);
    assert.equal(await NP.nostr.verifyEvent(Object.assign({}, ev, { content: JSON.stringify(content({ p: 2 })) })), false, 'content changed');
    const otherSk = B.newKey(), otherPub = B.toHex(await B.pubkey(otherSk));
    assert.equal(await NP.nostr.verifyEvent(Object.assign({}, ev, { pubkey: otherPub })), false, 'claimed by another key');
    const theirs = await signed(content(), { sk: otherSk, pub: otherPub });
    assert.equal(await NP.nostr.verifyEvent(Object.assign({}, ev, { sig: theirs.sig })), false, 'a real signature from somebody else');
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) await NP.nostr.verifyEvent(ev);
    const ms = (Date.now() - t0) / 10;
    assert.ok(ms < 80, ms + 'ms a check');
    console.log('        ' + ms.toFixed(1) + 'ms to check one');
});

// ===================================================================
section('the list: stale, merged, capped');
// ===================================================================
function listing(over) {
    const base = L.readEvent(shaped(content()), now()).listing;
    return Object.assign(base, over);
}
await test('a listing nobody repeats is gone after the time limit', async () => {
    let t = 1e6;
    const dir = L.Directory(() => t);
    dir.put(listing({ key: 'k1', code: 'AAAAA' }));
    assert.equal(dir.list().length, 1);
    t += TTL - 100;
    dir.put(listing({ key: 'k2', code: 'BBBBB' }));
    assert.equal(dir.list().length, 2);
    t += 200;
    assert.deepEqual(dir.list().map(l => l.code), ['BBBBB'], 'k1 went quiet');
    t += TTL - 300;
    dir.put(listing({ key: 'k2', code: 'BBBBB', created: now() + 1 }));
    t += 500;
    assert.deepEqual(dir.list().map(l => l.code), ['BBBBB'], 'k2 kept saying it');
    assert.ok(dir.list()[0].age >= 90, 'and its age counts from when it opened');
});

await test('one key gets one line, the newest', async () => {
    let t = 1e6;
    const dir = L.Directory(() => t);
    const c0 = now();
    dir.put(listing({ key: 'k', code: 'AAAAA', players: 1, created: c0 }));
    dir.put(listing({ key: 'k', code: 'AAAAA', players: 2, created: c0 + 5 }));
    dir.put(listing({ key: 'k', code: 'AAAAA', players: 1, created: c0 + 2 }));     // a slow relay's copy
    assert.equal(dir.list().length, 1);
    assert.equal(dir.list()[0].players, 2);
    dir.put(listing({ key: 'k', code: 'CCCCC', created: c0 + 9 }));              // the same host, a new lobby
    assert.deepEqual(dir.list().map(l => l.code), ['CCCCC']);
});

await test('two keys claiming one code: whoever said it first keeps it', async () => {
    let t = 1e6;
    const dir = L.Directory(() => t);
    dir.put(listing({ key: 'real', code: 'AAAAA', name: 'real', players: 1 }));
    t += 10;
    dir.put(listing({ key: 'copycat', code: 'AAAAA', name: 'copycat', players: 3 }));
    assert.deepEqual(dir.list().map(l => l.name), ['real']);
});

await test('only the key that listed a lobby can take it down', async () => {
    const dir = L.Directory();
    dir.put(listing({ key: 'real', code: 'AAAAA' }));
    assert.equal(dir.gone('mallory', 'AAAAA'), false);
    assert.equal(dir.gone('real', 'BBBBB'), false);
    assert.equal(dir.list().length, 1);
    assert.equal(dir.gone('real', 'AAAAA'), true);
    assert.equal(dir.list().length, 0);
});

await test('a full lobby is not on the list', async () => {
    const dir = L.Directory();
    dir.put(listing({ key: 'k', code: 'AAAAA', players: 4, seats: 4 }));
    assert.equal(dir.list().length, 0);
});

await test('one event a second per key, and a ceiling on keys', async () => {
    let t = 1e6;
    const dir = L.Directory(() => t);
    assert.equal(dir.gate('k'), true);
    assert.equal(dir.gate('k'), false);
    t += 1001;
    assert.equal(dir.gate('k'), true);
    for (let i = 0; i < L.MAX_KEYS; i++) { dir.gate('s' + i); dir.put(listing({ key: 's' + i, code: 'AAAA' + '23456789ABCDEFGHJKMNPQRSTUVWXYZ'[i % 31] })); }
    assert.equal(dir.gate('one-too-many'), false);
    assert.ok(dir.list().length <= L.MAX_SHOWN);
    t += TTL + 1;
    assert.equal(dir.gate('one-too-many'), true, 'room again once the flood goes quiet');
});

await test('quick match picks the fullest lobby for the game and mode', async () => {
    const list = [
        listing({ code: 'AAAAA', players: 1, opts: { mode: '2', map: 'bin' }, mode: '2', age: 50 }),
        listing({ code: 'BBBBB', players: 3, opts: { mode: '2', map: 'bin' }, mode: '2', age: 10 }),
        listing({ code: 'CCCCC', players: 1, opts: { mode: '1', map: 'bin' }, mode: '1', seats: 2 }),
        listing({ code: 'DDDDD', game: 'dungeonz', players: 3 }),
        listing({ code: 'EEEEE', players: 4, seats: 4, mode: '2' })
    ];
    assert.equal(L.pickMatch(list, 'wizardz', '2').code, 'BBBBB');
    assert.equal(L.pickMatch(list, 'wizardz', '1').code, 'CCCCC');
    assert.equal(L.pickMatch(list, 'wizardz', null).code, 'BBBBB');
    assert.equal(L.pickMatch(list, 'wizardz', '2', new Set(['BBBBB'])).code, 'AAAAA');
    assert.equal(L.pickMatch(list, 'wizardz', '4'), null);
    assert.equal(L.pickMatch(list, 'ageoftroll', null), null);
});

await test('two quick matches opened at once: exactly one moves into the other', async () => {
    const a = listing({ code: 'AAAAA', since: 1000, mode: '1' }), b = listing({ code: 'BBBBB', since: 1003, mode: '1' });
    assert.equal(L.olderMatch({ game: 'wizardz', mode: '1', since: 1003, code: 'BBBBB' }, [a]).code, 'AAAAA');
    assert.equal(L.olderMatch({ game: 'wizardz', mode: '1', since: 1000, code: 'AAAAA' }, [b]), null);
    // the same second: the code breaks the tie, the same way on both screens
    const c = listing({ code: 'CCCCC', since: 1000, mode: '1' });
    assert.equal(L.olderMatch({ game: 'wizardz', mode: '1', since: 1000, code: 'CCCCC' }, [a]).code, 'AAAAA');
    assert.equal(L.olderMatch({ game: 'wizardz', mode: '1', since: 1000, code: 'AAAAA' }, [c]), null);
    assert.equal(L.olderMatch({ game: 'wizardz', mode: '2', since: 2000, code: 'BBBBB' }, [a]), null, 'another mode is not a match');
});

// ===================================================================
section('over the relays');
// ===================================================================
// a host page and a watching page on the same fake relays
function fakeSession(NPx, over) {
    const s = new NPx.Session(null, true, over.code || 'HQ234');
    s.gameId = over.gameId || 'wizardz';
    s.gameOptions = over.options || { mode: '2', map: 'temple' };
    s.alive = true;
    return s;
}

await test('nothing connects until the list is on screen or a lobby is listed', async () => {
    const page = world();
    await sleep(30);
    assert.equal(page.net.opened, 0);
    const stop = page.L.watch(() => { });
    await sleep(30);
    assert.equal(page.net.opened, RELAYS.length, 'one socket a relay');
    stop();
    await sleep(500);
    assert.equal(page.net.sockets.size, 0, 'and they close when it goes');
});

await test('a listed lobby turns up on another page, and leaves it when the host goes', async () => {
    const host = world();
    const watcher = world({ net: host.net });
    const s = fakeSession(host.NP, { code: 'HQ234' });
    let list = [];
    const stop = watcher.L.watch(l => { list = l; });
    await sleep(50);
    host.L.announce(s);
    await until(() => list.length === 1 && list[0].ping, 5000, 'the listing, answering our question');
    assert.equal(list[0].code, 'HQ234');
    assert.equal(list[0].seats, 4);
    assert.ok(list[0].ping > 0, 'a watcher that asked gets a round trip');
    s.players.push({ id: 'g', name: 'guest' });
    s.emit('roster', s.players);
    await until(() => list[0] && list[0].players === 2, 4000, 'the new head count');
    s.leave();
    await until(() => list.length === 0, 2000, 'the goodbye');
    stop();
});

await test('the match starting, the lobby filling and the tab closing all take it off', async () => {
    const host = world();
    const watcher = world({ net: host.net });
    let list = [];
    const stop = watcher.L.watch(l => { list = l; });
    await sleep(50);

    const s1 = fakeSession(host.NP, { code: 'ST234', options: { mode: '1', map: 'temple' } });
    host.L.announce(s1);
    await until(() => list.some(l => l.code === 'ST234'), 4000);
    s1.state = 'playing';
    s1.emit('start', {});
    await until(() => !list.some(l => l.code === 'ST234'), 2000, 'started');

    const s2 = fakeSession(host.NP, { code: 'FU234', options: { mode: '1', map: 'temple' } });
    host.L.announce(s2);
    await until(() => list.some(l => l.code === 'FU234'), 4000);
    s2.players.push({ id: 'g', name: 'guest' });
    s2.emit('roster', s2.players);
    await until(() => !list.some(l => l.code === 'FU234'), 4000, 'full');
    s2.players.pop();
    s2.emit('roster', s2.players);
    await until(() => list.some(l => l.code === 'FU234'), 4000, 'a seat free again');
    s2.leave();

    const s3 = fakeSession(host.NP, { code: 'TB234' });
    host.L.announce(s3);
    await until(() => list.some(l => l.code === 'TB234'), 4000);
    await sleep(1200);       // the goodbye gets signed after the listing
    host.win.fire('pagehide');
    await until(() => !list.some(l => l.code === 'TB234'), 2000, 'the tab closing');
    stop();
});

await test('a host that vanishes without a word is gone after the time limit', async () => {
    const host = world({ name: 'host' });
    const watcher = world({ net: host.net });
    let list = [];
    const stop = watcher.L.watch(l => { list = l; });
    await sleep(50);
    const s = fakeSession(host.NP, { code: 'VN234' });
    host.L.announce(s);
    await until(() => list.length === 1, 4000);
    // the host's sockets die with no goodbye, and no close either
    host.net.sockets.forEach(sock => { if (sock.owner === 'host') { sock.readyState = 3; host.net.sockets.delete(sock); } });
    const t0 = Date.now();
    await until(() => watcher.L.current().length === 0, TTL + 3000, 'the time limit');
    assert.ok(Date.now() - t0 > TTL / 3, 'not before it was due');
    stop();
});

await test('forged, broken and oversized events change nothing and throw nothing', async () => {
    const host = world();
    const watcher = world({ net: host.net });
    let list = [];
    const stop = watcher.L.watch(l => { list = l; });
    await sleep(50);
    const s = fakeSession(host.NP, { code: 'RX234' });
    host.L.announce(s);
    await until(() => list.length === 1, 4000);

    const junk = ['', 'null', '[]', '{}', '["EVENT"]', '["EVENT","lb",null]', '["EVENT","lb",42]', '["EVENT","lb",{"id":7}]',
        'x'.repeat(5000), '["EVENT","lb",' + JSON.stringify(shaped('x'.repeat(4000))) + ']', '\u0000\u0001', '["OK"]', '["NOTICE","hi"]'];
    junk.forEach(f => watcher.net.inject(f));
    // well formed and signed by nobody
    watcher.net.inject(JSON.stringify(['EVENT', 'lb', shaped(content({ c: 'FAKE2', n: 'forger' }))]));
    // a real key's listing with its content swapped after signing
    const real = await signed(content({ c: 'SWAP2', n: 'honest' }));
    watcher.net.inject(JSON.stringify(['EVENT', 'lb', Object.assign({}, real, { content: JSON.stringify(content({ c: 'SWAP2', n: 'hijacked', p: 3 })) })]));
    // a goodbye for the real lobby, signed by somebody else
    const mallory = B.newKey(), malloryPub = B.toHex(await B.pubkey(mallory));
    watcher.net.deliver('wss://a.test/', await signed({ v: 1, gone: 1, c: 'RX234' }, { sk: mallory, pub: malloryPub }));
    // and the same code listed by somebody else, with a better head count
    watcher.net.deliver('wss://a.test/', await signed(content({ c: 'RX234', n: 'copycat', p: 3, m: 4 }), { sk: mallory, pub: malloryPub }));
    await sleep(600);
    assert.deepEqual(list.map(l => l.code + ':' + l.name), ['RX234:' + host.NP.profile().name]);
    const st = watcher.L.stats();
    assert.ok(st.rejected >= 2, JSON.stringify(st));
    assert.ok(st.why['bad signature'] >= 2, JSON.stringify(st.why));
    s.leave();
    stop();
});

await test('a flood of keys fills the list up to its ceiling and no further', async () => {
    const watcher = world();
    let list = [];
    const stop = watcher.L.watch(l => { list = l; });
    await sleep(50);
    const codes = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    for (let i = 0; i < 120; i++) {
        const sk = B.newKey(), pub = B.toHex(await B.pubkey(sk));
        const ev = await signed(content({ c: 'FX' + codes[i % 31] + codes[(i / 31) | 0] + '2', n: 'spam' + i }), { sk, pub });
        watcher.net.deliver('wss://a.test/', ev);
    }
    await sleep(800);
    assert.ok(list.length > 0 && list.length <= watcher.L.MAX_SHOWN, list.length + ' shown');
    const st = watcher.L.stats();
    assert.ok(st.listed <= watcher.L.MAX_KEYS, st.listed + ' remembered');
    assert.ok(st.accepted <= 45, 'and the signature budget held: ' + st.accepted + ' checked');
    stop();
});

await test('a relay that says no is left alone, the same way the duel leaves it alone', async () => {
    const net = { sockets: new Set(), opened: 0, frames: 0, refused: 0, policy: url => (url === 'wss://b.test/' ? 'rate-limited: slow down' : true) };
    const host = world({ net });
    const s = fakeSession(host.NP, { code: 'RF234' });
    host.L.announce(s);
    await until(() => net.refused >= 1, 4000, 'a refusal');
    const before = net.refused;
    for (let i = 0; i < 3; i++) { s.listing.soon(0); await sleep(1200); }
    assert.equal(net.refused, before, 'nothing more was sent to the relay that asked for less');
    s.leave();
});

console.log('\n' + checks + ' lobby list checks passed.');
process.exit(0);
