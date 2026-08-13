// smoke test for server/relay.js — boots the relay, connects two fake
// browsers, and checks that a message posted by one comes out of the
// other. no dependencies, so CI does not need an npm install.
import { spawn } from 'child_process';
import net from 'net';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8791 + Math.floor(Math.random() * 90);

// --- the tiniest websocket client that can talk to our relay ---
function connect(port) {
    return new Promise((resolve, reject) => {
        const key = crypto.randomBytes(16).toString('base64');
        const sock = net.connect(port, '127.0.0.1');
        let handshook = false;
        let buf = Buffer.alloc(0);
        const handlers = [];
        const client = {
            send(obj) {
                const payload = Buffer.from(JSON.stringify(obj));
                const mask = crypto.randomBytes(4);
                const len = payload.length;
                let head;
                if (len < 126) { head = Buffer.alloc(2); head[1] = 0x80 | len; }
                else { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
                head[0] = 0x81;
                const masked = Buffer.allocUnsafe(len);
                for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
                sock.write(Buffer.concat([head, mask, masked]));
            },
            next(pred, ms = 3000) {
                return new Promise((res, rej) => {
                    const timer = setTimeout(() => rej(new Error('timed out waiting for a message')), ms);
                    handlers.push(m => {
                        if (pred && !pred(m)) return false;
                        clearTimeout(timer); res(m); return true;
                    });
                });
            },
            close() { sock.destroy(); }
        };
        sock.on('data', chunk => {
            buf = Buffer.concat([buf, chunk]);
            if (!handshook) {
                const end = buf.indexOf('\r\n\r\n');
                if (end < 0) return;
                const head = buf.slice(0, end).toString();
                if (!/101/.test(head)) return reject(new Error('handshake failed: ' + head.split('\r\n')[0]));
                buf = buf.slice(end + 4);
                handshook = true;
                resolve(client);
            }
            for (;;) {
                if (buf.length < 2) return;
                const opcode = buf[0] & 0x0f;
                let len = buf[1] & 0x7f, off = 2;
                if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
                else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
                if (buf.length < off + len) return;
                const data = buf.slice(off, off + len);
                buf = buf.slice(off + len);
                if (opcode !== 0x1) continue;
                let m = null;
                try { m = JSON.parse(data.toString()); } catch (e) { continue; }
                for (let i = 0; i < handlers.length; i++) {
                    if (handlers[i](m)) { handlers.splice(i, 1); break; }
                }
            }
        });
        sock.on('error', reject);
        sock.on('connect', () => {
            sock.write(
                'GET / HTTP/1.1\r\n' +
                'Host: 127.0.0.1:' + port + '\r\n' +
                'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
                'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n'
            );
        });
    });
}

const relay = spawn(process.execPath, [path.join(here, 'relay.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
});
relay.stderr.on('data', d => process.stderr.write('[relay] ' + d));
let failed = null;
const done = (msg) => { failed = msg; };

try {
    await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('relay did not start')), 8000);
        relay.stdout.on('data', d => { if (String(d).includes('listening')) { clearTimeout(t); res(); } });
    });
    console.log('relay started on', PORT);

    const host = await connect(PORT);
    host.send({ k: 'join', room: 'TEST1', id: 'hostid', host: true, v: 1 });
    const joined = await host.next(m => m.k === 'joined');
    if (joined.hostId !== 'hostid') throw new Error('host was not recorded as host');

    const guest = await connect(PORT);
    const peerSeen = host.next(m => m.k === 'peer');
    guest.send({ k: 'join', room: 'TEST1', id: 'guestid', host: false, v: 1 });
    const gj = await guest.next(m => m.k === 'joined');
    if (!gj.peers.includes('hostid')) throw new Error('guest did not see the host in the room');
    const peer = await peerSeen;
    if (peer.id !== 'guestid') throw new Error('host was not told about the guest');
    console.log('both players joined room TEST1');

    // broadcast one way
    const got = guest.next(m => m.k === 'data');
    host.send({ k: 'data', to: '*', msg: { t: 'wz:snap', d: { hp: 42 } } });
    const relayed = await got;
    if (relayed.from !== 'hostid' || relayed.msg.d.hp !== 42) throw new Error('broadcast came out wrong: ' + JSON.stringify(relayed));
    console.log('broadcast host -> guest ok');

    // and addressed the other way
    const got2 = host.next(m => m.k === 'data');
    guest.send({ k: 'data', to: 'hostid', msg: { t: 'wz:cast', d: 'fireball' } });
    const direct = await got2;
    if (direct.msg.d !== 'fireball') throw new Error('direct message came out wrong');
    console.log('direct guest -> host ok');

    // leaving tells the other side
    const byeSeen = host.next(m => m.k === 'bye');
    guest.close();
    const bye = await byeSeen;
    if (bye.id !== 'guestid') throw new Error('host was not told the guest left');
    console.log('disconnect notice ok');

    // a junk room code is refused rather than crashing anything
    const bad = await connect(PORT);
    bad.send({ k: 'join', room: 'X', id: 'x', host: true });
    const err = await bad.next(m => m.k === 'err');
    if (!err.msg) throw new Error('bad room code was not refused');
    console.log('bad room code refused:', err.msg);
    bad.close();
    host.close();
} catch (e) {
    done(e.message);
}

relay.kill();
if (failed) {
    console.error('RELAY SMOKE TEST FAILED:', failed);
    process.exit(1);
}
console.log('relay smoke test passed');
