// ===================================================================
// nostr-test-relay — a nostr relay small enough to test against
//
// The "public relays" transport in games/netplay.js posts the duel
// through real nostr relays. Tests should not depend on strangers'
// servers being up or in a good mood, so this speaks just enough of the
// protocol to stand in for them: REQ with kind and #d filters, EVENT in
// and back out to whoever is subscribed, OK and EOSE.
//
// It does NOT verify signatures — real relays do, and that they accept
// the signatures this site produces is checked separately (the BIP-340
// vectors in check-games.mjs prove the implementation, and it has been
// confirmed by hand against nos.lol, relay.snort.social and nostr.mom).
//
//   node server/nostr-test-relay.mjs          # listens on :8790
//   PORT=9001 node server/nostr-test-relay.mjs
// ===================================================================
import http from 'http';
import { createRequire } from 'module';
const ws = createRequire(import.meta.url)('./ws-lite.js');

const PORT = parseInt(process.env.PORT || '8790', 10);
const clients = new Set();          // { socket, subs: Map(subId -> filter) }

function matches(filter, ev) {
    if (filter.kinds && !filter.kinds.includes(ev.kind)) return false;
    for (const key of Object.keys(filter)) {
        if (key[0] !== '#') continue;
        const want = filter[key];
        const tagName = key.slice(1);
        const have = (ev.tags || []).filter(t => t[0] === tagName).map(t => t[1]);
        if (!have.some(v => want.includes(v))) return false;
    }
    return true;
}

const server = http.createServer((req, res) => {
    // NIP-11 style hello, so a browser can sanity check the address
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name: 'wizardz test relay', supported_nips: [1] }));
});

server.on('upgrade', (req, socket) => {
    if (!ws.accept(req, socket)) return;
    const conn = { socket, subs: new Map(), buf: Buffer.alloc(0) };
    clients.add(conn);
    const drop = () => { clients.delete(conn); try { socket.destroy(); } catch (e) { } };

    socket.on('data', chunk => ws.readFrames(conn, chunk, {
        maxMessage: 262144,
        onClose: drop,
        onMessage: (text) => {
            let m = null;
            try { m = JSON.parse(text); } catch (e) { return; }
            if (!Array.isArray(m)) return;
            if (m[0] === 'REQ') {
                const [, subId, filter] = m;
                conn.subs.set(subId, filter || {});
                ws.sendText(socket, JSON.stringify(['EOSE', subId]));
            } else if (m[0] === 'CLOSE') {
                conn.subs.delete(m[1]);
            } else if (m[0] === 'EVENT') {
                const ev = m[1];
                if (!ev || !ev.id) return;
                ws.sendText(socket, JSON.stringify(['OK', ev.id, true, '']));
                // ephemeral kinds are relayed and forgotten, which is all
                // this game needs
                clients.forEach(c => {
                    if (c === conn) return;
                    c.subs.forEach((filter, subId) => {
                        if (matches(filter, ev)) ws.sendText(c.socket, JSON.stringify(['EVENT', subId, ev]));
                    });
                });
            }
        }
    }));
    socket.on('end', drop);
    socket.on('close', drop);
    socket.on('error', drop);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`nostr test relay listening on ws://127.0.0.1:${PORT}`);
});
