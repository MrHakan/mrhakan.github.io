/**
 * ws-lite — just enough RFC 6455 to move small json around
 *
 * Shared by server/relay.js and server/nostr-test-relay.mjs so the frame
 * handling lives in one place. No dependencies, on purpose: the whole
 * point of the servers in this folder is that you can drop one file on a
 * box and run `node` at it.
 */
'use strict';

const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// server frames are never masked
function frame(opcode, payload) {
    const len = payload.length;
    let head;
    if (len < 126) {
        head = Buffer.alloc(2);
        head[1] = len;
    } else if (len < 65536) {
        head = Buffer.alloc(4);
        head[1] = 126;
        head.writeUInt16BE(len, 2);
    } else {
        head = Buffer.alloc(10);
        head[1] = 127;
        head.writeBigUInt64BE(BigInt(len), 2);
    }
    head[0] = 0x80 | opcode;
    return Buffer.concat([head, payload]);
}

function sendText(socket, text) {
    if (!socket || socket.destroyed) return;
    try { socket.write(frame(0x1, Buffer.from(text))); } catch (e) { /* gone */ }
}

// answers the upgrade handshake; returns false if this was not a websocket
function accept(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if ((req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return false;
    }
    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n'
    );
    socket.setNoDelay(true);
    return true;
}

// pulls whole frames out of a growing buffer, keeping the leftovers on
// the connection object
function readFrames(conn, chunk, opts) {
    const maxMessage = (opts && opts.maxMessage) || 65536;
    const onMessage = opts.onMessage;
    const onClose = opts.onClose || (() => { });
    conn.buf = conn.buf && conn.buf.length ? Buffer.concat([conn.buf, chunk]) : chunk;
    for (;;) {
        const buf = conn.buf;
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2); off = 4;
        } else if (len === 127) {
            if (buf.length < 10) return;
            const big = buf.readBigUInt64BE(2);
            if (big > BigInt(maxMessage)) return onClose(1009, 'message too big');
            len = Number(big); off = 10;
        }
        if (len > maxMessage) return onClose(1009, 'message too big');
        const maskLen = masked ? 4 : 0;
        if (buf.length < off + maskLen + len) return;      // wait for the rest
        let data = buf.slice(off + maskLen, off + maskLen + len);
        if (masked) {
            const mask = buf.slice(off, off + 4);
            const out = Buffer.allocUnsafe(len);
            for (let i = 0; i < len; i++) out[i] = data[i] ^ mask[i & 3];
            data = out;
        }
        conn.buf = buf.slice(off + maskLen + len);
        conn.seen = Date.now();

        if (opcode === 0x8) return onClose(1000, 'bye');
        if (opcode === 0x9) { try { conn.socket.write(frame(0xA, data)); } catch (e) { } continue; }
        if (opcode === 0xA) continue;
        if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
            conn.frag = conn.frag ? Buffer.concat([conn.frag, data]) : data;
            if (conn.frag.length > maxMessage) return onClose(1009, 'message too big');
            if (!fin) continue;
            const whole = conn.frag;
            conn.frag = null;
            onMessage(whole.toString('utf8'));
            continue;
        }
        return onClose(1002, 'unknown opcode');
    }
}

function closeFrame(code, reason) {
    const body = Buffer.alloc(2 + Buffer.byteLength(reason || ''));
    body.writeUInt16BE(code, 0);
    body.write(reason || '', 2);
    return frame(0x8, body);
}

module.exports = { frame, sendText, accept, readFrames, closeFrame };
