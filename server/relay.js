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

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS || '500', 10);
const MAX_PER_ROOM = parseInt(process.env.MAX_PER_ROOM || '8', 10);
const MAX_MESSAGE = parseInt(process.env.MAX_MESSAGE || '65536', 10);   // bytes
const MSG_PER_SEC = parseInt(process.env.MSG_PER_SEC || '120', 10);     // snapshots are ~15/s, this is generous
const IDLE_MS = parseInt(process.env.IDLE_MS || '90000', 10);

/** room code -> { code, clients: Map(id -> client), hostId, born } */
const rooms = new Map();
let clientSeq = 0;

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ===================================================================
// websocket plumbing lives in ws-lite.js, shared with the nostr test
// relay next door
// ===================================================================
const ws = require('./ws-lite.js');

function send(client, obj) {
    ws.sendText(client.socket, JSON.stringify(obj));
}
function close(client, code, reason) {
    if (client.closed) return;
    client.closed = true;
    try { client.socket.write(ws.closeFrame(code, reason)); } catch (e) { /* already gone */ }
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
    if (!ws.accept(req, socket)) return;

    const client = {
        socket, buf: Buffer.alloc(0), frag: null, id: null, room: null,
        seen: Date.now(), windowStart: Date.now(), count: 0, closed: false
    };

    socket.on('data', chunk => ws.readFrames(client, chunk, {
        maxMessage: MAX_MESSAGE,
        onClose: (code, reason) => close(client, code, reason),
        onMessage: (text) => {
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
        }
    }));
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
        else if (!c.socket.destroyed) { try { c.socket.write(ws.frame(0x9, Buffer.alloc(0))); } catch (e) { } }
    }));
}, 30000).unref();

server.listen(PORT, HOST, () => {
    log(`netplay relay listening on ${HOST}:${PORT}`);
    log(`point the lobby at ws://<this host>:${PORT} (or wss:// through a tls proxy)`);
});

module.exports = { server, rooms };
