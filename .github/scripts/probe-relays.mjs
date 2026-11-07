// ===================================================================
// probe-relays.mjs — which public relays will still carry a duel?
//
// The relay list in games/netplay.js rots. Relays start asking for accounts,
// proof of work and web-of-trust scores, and some keep answering "OK" while
// quietly dropping everything after the first few hundred events. A quick
// probe misses most of that. nostr.mom passed a thirty second one and then
// delivered nothing at all in a real duel, so this does what a duel does: two
// keys, each on one socket that both publishes and subscribes, one sending
// snapshots at game rate for long enough to get past the limits.
//
//   npm run relays                         # the built-in list, 90 seconds
//   npm run relays -- wss://a.example wss://b.example
//   SECONDS=180 npm run relays
//   npm run relays -- --lobbies            # the open lobby list instead: do the
//                                          # relays take a listing, a question and
//                                          # a goodbye, and pass them on?
//
// Needs node 22 or later for the built-in WebSocket. Not part of the test
// suite on purpose: it talks to strangers' servers, and they are entitled to
// have a bad day. check-netplay.mjs is the part that runs in CI.
// ===================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECONDS = parseInt(process.env.SECONDS || '90', 10);
const RATE = 8;                   // what the host sends over relays, in events a second
const KIND = 21998;

// the signer and the list, out of the real file
const win = { localStorage: { getItem: () => null, setItem() { }, removeItem() { } }, crypto: globalThis.crypto, performance: globalThis.performance, addEventListener() { } };
win.window = win;
// eslint-disable-next-line no-new-func
new Function('window', 'localStorage', 'performance', 'fetch', 'location',
    fs.readFileSync(path.join(ROOT, 'games/netplay.js'), 'utf8'))(win, win.localStorage, win.performance, undefined, undefined);
const { bip340: B, nostrRelays } = win.Netplay;
const LOBBIES = process.argv.includes('--lobbies');
const urls = process.argv.slice(2).filter(a => a !== '--lobbies');
const RELAYS = urls.length ? urls : nostrRelays();

// ---------------------------------------------------------------
// --lobbies: what the open lobby list asks of a relay. A host posts its
// listing every few seconds, answers a question, and says goodbye; a
// watcher on its own socket has to see all three.
// ---------------------------------------------------------------
if (LOBBIES) {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'games/lobbies.js'), 'utf8'))(win, undefined);
    const L = win.Netplay.Lobbies, N = win.Netplay;
    const ROUNDS = parseInt(process.env.ROUNDS || '12', 10);
    const keyOf = async () => { const sk = B.newKey(); return { sk, pub: B.toHex(await B.pubkey(sk)) }; };
    console.log(`${RELAYS.length} relays, ${ROUNDS} listings each ${L.EVERY_MS}ms apart, a question and a goodbye\n`);
    const rows = await Promise.all(RELAYS.map(async url => {
        const row = { url, sent: 0, got: 0, refused: 0, why: new Set(), lat: [], ask: false, gone: false, ok: 0 };
        const host = await keyOf(), asker = await keyOf();
        const sentAt = new Map();
        const open = (onEvent) => new Promise(resolve => {
            let ws;
            try { ws = new WebSocket(url); } catch (e) { row.why.add('bad url'); return resolve(null); }
            const timer = setTimeout(() => { row.why.add('would not connect'); resolve(null); }, 10000);
            ws.onopen = () => { clearTimeout(timer); resolve(ws); };
            ws.onerror = () => { };
            ws.onmessage = e => {
                let m;
                try { m = JSON.parse(e.data); } catch (x) { return; }
                if (m[0] === 'EVENT') onEvent(m[2]);
                else if (m[0] === 'OK') { if (m[2] === false) { row.refused++; row.why.add(String(m[3]).slice(0, 70)); } else row.ok++; }
                else if (m[0] === 'NOTICE' || m[0] === 'CLOSED') row.why.add(String(m[m.length - 1]).slice(0, 70));
            };
        });
        const watcher = await open(ev => {
            const at = sentAt.get(ev.id);
            if (at === undefined) return;
            sentAt.delete(ev.id);
            if (at.kind === 'listing') { row.got++; row.lat.push(Date.now() - at.t); }
            if (at.kind === 'gone') row.gone = true;
        });
        const hostWs = await open(ev => { if (sentAt.get(ev.id) && sentAt.get(ev.id).kind === 'ask') { sentAt.delete(ev.id); row.ask = true; } });
        if (!watcher || !hostWs) return row;
        const s = Math.floor(Date.now() / 1000);
        watcher.send(JSON.stringify(['REQ', 'lb', { kinds: [N.nostr.KIND], '#d': [L.TAG], since: s - 30 }]));
        hostWs.send(JSON.stringify(['REQ', 'lb', { kinds: [N.nostr.KIND], '#d': [L.ASK_TAG], since: s - 10 }]));
        await new Promise(r => setTimeout(r, 800));
        const post = async (ws, who, tag, content, kind) => {
            const ev = await N.nostr.signEvent(who.sk, who.pub, N.nostr.KIND, [['d', tag]], JSON.stringify(content));
            sentAt.set(ev.id, { t: Date.now(), kind });
            try { ws.send(JSON.stringify(['EVENT', ev])); } catch (e) { }
        };
        const askQ = 'probe' + Math.random().toString(36).slice(2, 6);
        await post(watcher, asker, L.ASK_TAG, { v: 1, ask: 1, q: askQ }, 'ask');
        const code = N.makeCode(5), since = Math.floor(Date.now() / 1000);
        for (let i = 0; i < ROUNDS; i++) {
            await post(hostWs, host, L.TAG, { v: 1, pv: N.VERSION, g: 'wizardz', o: { mode: '1', map: 'temple' }, c: code, n: 'probe', p: 1, m: 2, t: since, r: 'europe' }, 'listing');
            row.sent++;
            await new Promise(r => setTimeout(r, L.EVERY_MS));
        }
        await post(hostWs, host, L.TAG, { v: 1, gone: 1, c: code }, 'gone');
        await new Promise(r => setTimeout(r, 3000));
        watcher.close();
        hostWs.close();
        return row;
    }));
    const verdict = r => (r.got >= r.sent - 1 && r.gone && r.ask && !r.refused ? 'good' : r.got ? 'partly' : 'no');
    console.log('relay'.padEnd(36) + 'verdict  listings  question  goodbye  refused  p50');
    for (const r of rows) {
        const l = r.lat.sort((a, b) => a - b);
        console.log(r.url.padEnd(36) + verdict(r).padEnd(9) + (r.got + '/' + r.sent).padStart(8) + (r.ask ? 'passed' : 'lost').padStart(10) +
            (r.gone ? 'passed' : 'lost').padStart(9) + String(r.refused).padStart(9) + String(l.length ? l[l.length >> 1] + 'ms' : '-').padStart(7));
        if (r.why.size) console.log('    ' + [...r.why].join(' | '));
    }
    console.log('\n"good" means every listing, the question and the goodbye got through, and nothing was refused.');
    process.exit(0);
}

const enc = new TextEncoder();
const tag = 'mrh98-probe-' + Math.random().toString(36).slice(2, 10);
async function signer() {
    const sk = B.newKey(), pub = B.toHex(await B.pubkey(sk));
    return async content => {
        const created = Math.floor(Date.now() / 1000), tags = [['d', tag]];
        const id = await B.sha256(enc.encode(JSON.stringify([0, pub, created, KIND, tags, content])));
        const sig = await B.sign(id, sk);
        return JSON.stringify(['EVENT', { id: B.toHex(id), pubkey: pub, created_at: created, kind: KIND, tags, content, sig: B.toHex(sig) }]);
    };
}

function join(url, row, onEvent) {
    return new Promise(resolve => {
        const t0 = Date.now();
        let ws;
        try { ws = new WebSocket(url); } catch (e) { row.why.add('bad url'); return resolve(null); }
        const timer = setTimeout(() => { row.why.add('would not connect'); resolve(null); }, 10000);
        ws.onopen = () => {
            clearTimeout(timer);
            row.connectMs = Math.max(row.connectMs || 0, Date.now() - t0);
            ws.send(JSON.stringify(['REQ', 'np', { kinds: [KIND], '#d': [tag], since: Math.floor(Date.now() / 1000) - 20 }]));
            resolve(ws);
        };
        ws.onerror = () => { };
        ws.onclose = () => { row.drops++; };
        ws.onmessage = e => {
            let m;
            try { m = JSON.parse(e.data); } catch (x) { return; }
            if (m[0] === 'EVENT') onEvent(m[2]);
            else if (m[0] === 'OK' && m[2] === false) { row.refused++; row.why.add(String(m[3]).slice(0, 70)); }
        };
    });
}

console.log(`${RELAYS.length} relays, ${SECONDS}s at ${RATE} events a second (${SECONDS * RATE} events each)\n`);
const pad = 'x'.repeat(800);
const [signHost, signGuest] = await Promise.all([signer(), signer()]);
const rows = await Promise.all(RELAYS.map(async url => {
    const row = { url, sent: 0, got: 0, refused: 0, drops: 0, why: new Set(), lat: [], lastThird: 0, connectMs: 0 };
    const sentAt = new Map();
    row.host = await join(url, row, () => { });
    row.guest = await join(url, row, ev => {
        const at = sentAt.get(ev.id);
        if (at === undefined) return;
        sentAt.delete(ev.id);
        row.got++;
        row.lat.push(Date.now() - at.t);
        if (at.i >= (SECONDS * RATE * 2) / 3) row.lastThird++;
    });
    row.sentAt = sentAt;
    return row;
}));

for (let i = 0; i < SECONDS * RATE; i++) {
    const frame = await signHost(i + ':' + pad);
    const id = JSON.parse(frame)[1].id;
    for (const row of rows) {
        if (!row.host || row.host.readyState !== 1) continue;
        row.sentAt.set(id, { t: Date.now(), i });
        row.sent++;
        try { row.host.send(frame); } catch (e) { }
    }
    // the guest talks too, a pong every couple of seconds
    if (i % (RATE * 2) === 0) {
        const pong = await signGuest('pong');
        for (const row of rows) if (row.guest && row.guest.readyState === 1) { try { row.guest.send(pong); } catch (e) { } }
    }
    await new Promise(r => setTimeout(r, 1000 / RATE));
}
await new Promise(r => setTimeout(r, 2500));

const third = Math.floor((SECONDS * RATE) / 3);
const verdict = r => (r.lastThird >= third * 0.9 && !r.refused ? 'good' : r.got ? 'no' : 'dead');
rows.sort((a, b) => b.lastThird - a.lastThird);
console.log('relay'.padEnd(36) + 'verdict  connect   sent    got  last third  refused  p50   p95');
for (const r of rows) {
    const l = r.lat.sort((a, b) => a - b);
    console.log(r.url.padEnd(36) + verdict(r).padEnd(9) + String(r.connectMs + 'ms').padStart(7) + String(r.sent).padStart(7) + String(r.got).padStart(7) +
        String(r.lastThird + '/' + third).padStart(12) + String(r.refused).padStart(9) +
        String(l.length ? l[l.length >> 1] : '-').padStart(5) + String(l.length ? l[Math.floor(l.length * 0.95)] : '-').padStart(6));
    if (r.why.size) console.log('    ' + [...r.why].join(' | '));
}
console.log('\n"good" means it was still delivering at full rate at the end, and refused nothing.');
process.exit(0);
