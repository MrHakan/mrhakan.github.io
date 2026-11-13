// ===================================================================
// tankz 98 — the online room: who is in, who is ready, what the host picked
//
// The host owns one of these and is the only one that changes it; guests get
// a small copy (`view`) and send back what they want (`intent`). Everybody
// comes back here when a match ends, with the same code and the same people.
// No DOM, no clocks, no network: the whole thing runs under node in the tests.
// ===================================================================
(function (root) {
    'use strict';
    const TK = root.TK;
    const COUNTDOWN = 3000;          // ms between "everyone is ready" and the match
    const MAX_SEATS = 8;
    const PHASES = ['select', 'countdown', 'match'];
    const LEVELS = ['normal', 'easy', 'hard', 'mixed'];
    const label = (v, fallback) => String(v == null || v === '' ? fallback : v).slice(0, 16);
    const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
    const text = v => typeof v === 'string' && v.length <= 64;

    function cleanOpts(o) {
        o = o || {};
        const bots = Number.isFinite(+o.bots) ? Math.max(0, Math.min(6, Math.round(+o.bots))) : 1;
        return {
            bots,
            level: LEVELS.includes(o.level) ? o.level : 'normal',
            points: TK.POINTS.includes(+o.points) ? +o.points : TK.POINTS[0],
            size: TK.SIZE_BY_ID[o.size] ? o.size : 'medium'
        };
    }
    function create(opts = {}) {
        const room = { rev: 0, host: String(opts.host || ''), phase: 'select', count: 0, played: 0, matchId: '', seats: [], opts: cleanOpts(opts), last: null };
        settle(room);
        return room;
    }
    const seatOf = (room, id) => room.seats.find(s => s.id === id) || null;
    // how many bots a match would have: what the host asked for, as many as fit,
    // and at least one when somebody is alone
    function botsFor(room) {
        const people = room.seats.length;
        let b = Math.min(room.opts.bots, MAX_SEATS - people);
        if (people + b < 2) b = 2 - people;
        return Math.max(0, b);
    }
    // what must stay true after any change: the countdown runs only while everyone is ready
    function settle(room) {
        if (room.phase !== 'match') {
            const go = room.seats.length > 0 && room.seats.every(s => s.ready);
            if (!go) { room.phase = 'select'; room.count = 0; }
            else if (room.phase === 'select') { room.phase = 'countdown'; room.count = COUNTDOWN; }
        }
        room.rev++;
    }
    // somebody arrived. Again for the same id only refreshes the name
    function join(room, id, name) {
        id = String(id || '');
        if (!id) return null;
        let seat = seatOf(room, id);
        if (seat) {
            const next = label(name, seat.name);
            if (next !== seat.name) { seat.name = next; room.rev++; }
            return seat;
        }
        if (room.seats.length >= MAX_SEATS) return null;
        seat = { id, name: label(name, 'tank'), ready: false, wins: 0, pts: 0, n: 0, playing: false };
        room.seats.push(seat);
        settle(room);
        return seat;
    }
    function leave(room, id) {
        const before = room.seats.length;
        room.seats = room.seats.filter(s => s.id !== id);
        if (room.seats.length === before) return false;
        settle(room);
        return true;
    }
    // what a player asks for: { n, r } = sequence, ready. `id` is who the
    // transport says sent it, never a field of the message. The whole wish
    // goes every time, so a lost or repeated packet is harmless
    function intent(room, id, msg) {
        const seat = seatOf(room, id);
        if (!seat || !msg || typeof msg !== 'object') return false;
        if (!Number.isSafeInteger(msg.n) || msg.n <= seat.n) return false;
        seat.n = msg.n;
        const r = msg.r === true && room.phase !== 'match';
        const changed = r !== seat.ready;
        seat.ready = r;
        // the sequence number goes back out either way: it is how the sender learns it arrived
        if (changed) settle(room); else room.rev++;
        return changed;
    }
    // the host's settings, locked while the host is ready
    function setOpt(room, id, key, value) {
        const seat = seatOf(room, id);
        if (!id || id !== room.host || room.phase !== 'select' || (seat && seat.ready)) return false;
        if (!['bots', 'level', 'points', 'size'].includes(key)) return false;
        const next = cleanOpts(Object.assign({}, room.opts, { [key]: value }));
        if (next[key] === room.opts[key]) return false;
        room.opts = next;
        room.rev++;
        return true;
    }
    // runs the countdown. True on the tick it ends: the host starts the match
    function tick(room, ms) {
        if (room.phase !== 'countdown') return false;
        room.count -= Math.max(0, Number(ms) || 0);
        if (room.count > 0) return false;
        room.count = 0;
        return true;
    }
    // the room becomes a match description every screen builds its match from
    function begin(room, seed, at) {
        if (room.phase === 'match' || !room.seats.length) return null;
        room.phase = 'match'; room.count = 0;
        room.matchId = String(at) + ':' + seed;
        room.seats.forEach(s => { s.ready = false; s.playing = true; });
        room.rev++;
        return {
            match: room.matchId, seed, at, opts: Object.assign({}, room.opts),
            people: room.seats.map(s => ({ id: s.id, name: s.name })), bots: botsFor(room)
        };
    }
    // the match ended: remember the table, count the win, open the room again
    function finish(room, result) {
        if (room.phase !== 'match' || !result || result.match !== room.matchId) return false;
        const rows = (Array.isArray(result.rows) ? result.rows : []).slice(0, MAX_SEATS).map(r => ({
            id: String(r.id || ''), name: label(r.name, 'tank'), pts: clampInt(r.pts, 0, 99), kills: clampInt(r.kills, 0, 999),
            deaths: clampInt(r.deaths, 0, 999), selfs: clampInt(r.selfs, 0, 999), bot: !!r.bot, col: clampInt(r.col, 0, 7)
        }));
        const winner = typeof result.winner === 'string' ? result.winner : '';
        const seat = winner && seatOf(room, winner);
        if (seat && seat.playing) seat.wins++;
        room.last = { match: room.matchId, winner, rows };
        room.played++;
        room.phase = 'select'; room.matchId = '';
        room.seats.forEach(s => { s.ready = false; s.playing = false; });
        settle(room);
        return true;
    }
    function clampInt(v, lo, hi) { v = Math.round(Number(v) || 0); return Math.max(lo, Math.min(hi, v)); }

    // the copy guests get. Arrays, not objects: it goes out often
    function view(room) {
        return {
            v: 1, rev: room.rev, host: room.host, phase: room.phase, count: Math.round(room.count), played: room.played, match: room.matchId,
            o: [room.opts.bots, room.opts.level, room.opts.points, room.opts.size], bots: botsFor(room),
            seats: room.seats.map(s => [s.id, s.name, s.ready ? 1 : 0, s.wins, s.playing ? 1 : 0, s.n]),
            last: room.last && [room.last.match, room.last.winner, room.last.rows.map(r => [r.id, r.name, r.pts, r.kills, r.deaths, r.selfs, r.bot ? 1 : 0, r.col])]
        };
    }
    // a guest never trusts the shape of what arrives: null unless all of it is sane
    function read(w) {
        if (!w || typeof w !== 'object' || w.v !== 1 || !int(w.rev, 0, 1e12) || !text(w.host)) return null;
        if (!PHASES.includes(w.phase) || !int(w.count, 0, 60000) || !int(w.played, 0, 1e6) || !text(w.match) || !int(w.bots, 0, MAX_SEATS)) return null;
        if (!Array.isArray(w.o) || w.o.length !== 4) return null;
        const opts = cleanOpts({ bots: w.o[0], level: w.o[1], points: w.o[2], size: w.o[3] });
        if (!Array.isArray(w.seats) || w.seats.length > MAX_SEATS) return null;
        const seats = [];
        for (const s of w.seats) {
            if (!Array.isArray(s) || !text(s[0]) || !s[0] || !text(s[1]) || !int(s[3], 0, 1e6)) return null;
            seats.push({ id: s[0], name: label(s[1], 'tank'), ready: s[2] === 1, wins: s[3], playing: s[4] === 1, n: int(s[5], 0, 1e12) ? s[5] : 0 });
        }
        let last = null;
        if (w.last != null) {
            const l = w.last;
            if (!Array.isArray(l) || !text(l[0]) || !text(l[1]) || !Array.isArray(l[2]) || l[2].length > MAX_SEATS) return null;
            const rows = [];
            for (const r of l[2]) {
                if (!Array.isArray(r) || !text(r[0]) || !text(r[1]) || !int(r[2], 0, 99) || !int(r[3], 0, 999) || !int(r[4], 0, 999) || !int(r[5], 0, 999) || !int(r[7], 0, 7)) return null;
                rows.push({ id: r[0], name: label(r[1], 'tank'), pts: r[2], kills: r[3], deaths: r[4], selfs: r[5], bot: r[6] === 1, col: r[7] });
            }
            last = { match: l[0], winner: l[1], rows };
        }
        return { rev: w.rev, host: w.host, phase: w.phase, count: w.count, played: w.played, matchId: w.match, opts, bots: w.bots, seats, last };
    }
    // a match description from the host, checked the same way before a guest uses it
    function readStart(d) {
        if (!d || typeof d !== 'object' || typeof d.match !== 'string' || d.match.length > 64) return null;
        if (!Number.isSafeInteger(d.seed) || !Number.isSafeInteger(d.at) || d.match !== d.at + ':' + d.seed) return null;
        if (!Array.isArray(d.people) || !d.people.length || d.people.length > MAX_SEATS || !int(d.bots, 0, MAX_SEATS) || d.people.length + d.bots > MAX_SEATS || d.people.length + d.bots < 2) return null;
        const people = [];
        for (const p of d.people) {
            if (!p || typeof p.id !== 'string' || !p.id || p.id.length > 64) return null;
            people.push({ id: p.id, name: label(p.name, 'tank') });
        }
        return { match: d.match, seed: d.seed, at: d.at, opts: cleanOpts(d.opts), people, bots: d.bots };
    }

    root.TK_ROOM = { COUNTDOWN, MAX_SEATS, LEVELS, create, join, leave, intent, setOpt, tick, begin, finish, view, read, readStart, seat: seatOf, botsFor, cleanOpts };
})(typeof window === 'undefined' ? globalThis : window);
