#!/usr/bin/env node
/**
 * mrhakan 98 — netplay relay
 *
 * The site is static files on github pages, so multiplayer normally runs
 * peer to peer over webrtc and nobody hosts anything. This is the other
 * option: a websocket relay you run yourself, for networks that block
 * p2p, or for when the public matchmaking broker is having a day.
 *
 * It is deliberately dependency-free — plain node, no npm install, one
 * file you can drop on a $4 vps, fly.io, render, a raspberry pi, or
 * whatever else you have lying around. It speaks just enough RFC 6455
 * to move small json messages between two browsers.
 *
 *   node server/relay.js                 # listens on :8787
 *   PORT=9000 node server/relay.js       # or wherever
 *
 * Then paste ws://your-host:8787 (or wss:// behind a tls proxy) into the
 * lobby's relay box, or into data/site.json under multiplayer.relay.
 *
 * Protocol, mirroring RelayTransport in games/netplay.js:
 *   in   {k:'join', room, id, host, v}
 *        {k:'data', to, msg}                 to = peer id or '*'
 *   out  {k:'joined', id, hostId, peers[]}
 *        {k:'peer', id} · {k:'bye', id}
 *        {k:'data', from, to, msg}
 *        {k:'err', msg}
 *
 * It stores nothing, logs no message contents, and forgets a room the
 * moment the last player leaves.
 */
'use strict';

const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS || '500', 10);
const MAX_PER_ROOM = parseInt(process.env.MAX_PER_ROOM || '8', 10);
const MAX_MESSAGE = parseInt(process.env.MAX_MESSAGE || '65536', 10);   // bytes
const MSG_PER_SEC = parseInt(process.env.MSG_PER_SEC || '120', 10);     // snapshots are ~15/s, this is generous
const IDLE_MS = parseInt(process.env.IDLE_MS || '90000', 10);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** room code -> { code, clients: Map(id -> client), hostId, born } */
const rooms = new Map();
let clientSeq = 0;

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ===================================================================
// the smallest websocket implementation that is still correct
// ===================================================================
function send(client, obj) {
    if (client.socket.destroyed) return;
    const payload = Buffer.from(JSON.stringify(obj));
    client.socket.write(frame(0x1, payload));
}
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
    head[0] = 0x80 | opcode;          // FIN + opcode, server frames are never masked
    return Buffer.concat([head, payload]);
}
// pulls whole frames out of a growing buffer; returns the leftovers
function readFrames(client, chunk, onMessage) {
    client.buf = client.buf.length ? Buffer.concat([client.buf, chunk]) : chunk;
    for (;;) {
        const buf = client.buf;
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
            if (big > BigInt(MAX_MESSAGE)) return close(client, 1009, 'message too big');
            len = Number(big); off = 10;
        }
        if (len > MAX_MESSAGE) return close(client, 1009, 'message too big');
        const maskLen = masked ? 4 : 0;
        if (buf.length < off + maskLen + len) return;         // wait for the rest
        let data = buf.slice(off + maskLen, off + maskLen + len);
        if (masked) {
            const mask = buf.slice(off, off + 4);
            const out = Buffer.allocUnsafe(len);
            for (let i = 0; i < len; i++) out[i] = data[i] ^ mask[i & 3];
            data = out;
        }
        client.buf = buf.slice(off + maskLen + len);
        client.seen = Date.now();

        if (opcode === 0x8) return close(client, 1000, 'bye');                  // close
        if (opcode === 0x9) { client.socket.write(frame(0xA, data)); continue; } // ping -> pong
        if (opcode === 0xA) continue;                                           // pong
        if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
            // browsers do not fragment small json, but be safe about it
            client.frag = client.frag ? Buffer.concat([client.frag, data]) : data;
            if (client.frag.length > MAX_MESSAGE) return close(client, 1009, 'message too big');
            if (!fin) continue;
            const whole = client.frag;
            client.frag = null;
            onMessage(whole.toString('utf8'));
            continue;
        }
        return close(client, 1002, 'unknown opcode');
    }
}
function close(client, code, reason) {
    if (client.closed) return;
    client.closed = true;
    try {
        const body = Buffer.alloc(2 + Buffer.byteLength(reason || ''));
        body.writeUInt16BE(code, 0);
        body.write(reason || '', 2);
        client.socket.write(frame(0x8, body));
    } catch (e) { /* the socket was already gone */ }
    try { client.socket.end(); } catch (e) { }
    leave(client);
}

// ===================================================================
// rooms
// ===================================================================
function leave(client) {
    if (client.left) return;
    client.left = true;
    const room = rooms.get(client.room);
    if (!room) return;
    room.clients.delete(client.id);
    room.clients.forEach(c => send(c, { k: 'bye', id: client.id }));
    if (room.hostId === client.id) room.hostId = (room.clients.values().next().value || {}).id || null;
    if (!room.clients.size) {
        rooms.delete(room.code);
        log('room closed', room.code);
    }
}
function onJoin(client, m) {
    const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (code.length < 4) return send(client, { k: 'err', msg: 'bad room code' });
    let room = rooms.get(code);
    if (!room) {
        if (rooms.size >= MAX_ROOMS) return send(client, { k: 'err', msg: 'the relay is full, try again later' });
        room = { code, clients: new Map(), hostId: null, born: Date.now() };
        rooms.set(code, room);
        log('room opened', code);
    }
    if (room.clients.size >= MAX_PER_ROOM) return send(client, { k: 'err', msg: 'that lobby is full' });
    // the id the client picked, made unique if it collides
    let id = String(m.id || '').slice(0, 32) || 'p' + (++clientSeq);
    while (room.clients.has(id)) id = id + '-' + (++clientSeq);
    client.id = id;
    client.room = code;
    if (m.host && !room.hostId) room.hostId = id;
    const peers = [...room.clients.keys()];
    room.clients.set(id, client);
    send(client, { k: 'joined', id, hostId: room.hostId, peers });
    peers.forEach(pid => {
        const c = room.clients.get(pid);
        if (c) send(c, { k: 'peer', id });
    });
}
function onData(client, m) {
    const room = rooms.get(client.room);
    if (!room) return;
    const to = m.to || '*';
    const env = { k: 'data', from: client.id, to, msg: m.msg };
    if (to === '*') room.clients.forEach(c => { if (c !== client) send(c, env); });
    else { const c = room.clients.get(to); if (c) send(c, env); }
}

// ===================================================================
// http + upgrade
// ===================================================================
const server = http.createServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, rooms: rooms.size, up: Math.round(process.uptime()) }));
        return;
    }
    res.writeHead(404).end('no');
});

server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if ((req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    socket.setNoDelay(true);

    const client = {
        socket, buf: Buffer.alloc(0), frag: null, id: null, room: null,
        seen: Date.now(), windowStart: Date.now(), count: 0, closed: false
    };

    socket.on('data', chunk => {
        readFrames(client, chunk, (text) => {
            // a simple leaky bucket: nobody needs to send faster than this
            const now = Date.now();
            if (now - client.windowStart > 1000) { client.windowStart = now; client.count = 0; }
            if (++client.count > MSG_PER_SEC) return close(client, 1008, 'slow down');
            let m = null;
            try { m = JSON.parse(text); } catch (e) { return; }
            if (!m || typeof m !== 'object') return;
            if (m.k === 'join') return onJoin(client, m);
            if (!client.room) return send(client, { k: 'err', msg: 'join a room first' });
            if (m.k === 'data') return onData(client, m);
            if (m.k === 'ping') return send(client, { k: 'pong', t: m.t });
        });
    });
    // an upgraded socket is half-open by default: when the browser goes
    // away node gives us 'end' and nothing else, so that is the event
    // that has to clear the seat.
    socket.on('end', () => { try { socket.end(); } catch (e) { } leave(client); });
    socket.on('close', () => leave(client));
    socket.on('error', () => { try { socket.destroy(); } catch (e) { } leave(client); });
});

// drop anybody who has gone quiet, and ping the rest so proxies keep
// the connection open
setInterval(() => {
    const now = Date.now();
    rooms.forEach(room => room.clients.forEach(c => {
        if (now - c.seen > IDLE_MS) close(c, 1001, 'idle');
        else if (!c.socket.destroyed) { try { c.socket.write(frame(0x9, Buffer.alloc(0))); } catch (e) { } }
    }));
}, 30000).unref();

server.listen(PORT, HOST, () => {
    log(`netplay relay listening on ${HOST}:${PORT}`);
    log(`point the lobby at ws://<this host>:${PORT} (or wss:// through a tls proxy)`);
});

module.exports = { server, rooms };
