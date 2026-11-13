// The online room: who sits where, who picked which fighter and who is ready.
// The host owns one of these and is the only one that changes it; guests get a
// small copy (`view`) and send back what they want (`intent`). No DOM, no
// clocks and no network here, so the whole thing runs under node in the tests.
(function (root) {
    'use strict';
    const D = root.RIFT;
    const COUNTDOWN = 3000;         // ms between "everyone is ready" and the match
    const MAX_SEATS = 8;            // more than Netplay ever lets into a room
    const BOT_NAMES = ['clippy', 'dialup', 'bonzi', 'winamp'];
    const PHASES = ['select', 'countdown', 'match'];
    const fighter = n => Number.isInteger(n) && n >= 0 && n < D.FIGHTERS.length;
    const size = mode => (mode === 2 || mode === '2' ? 2 : 1);
    const label = (v, fallback) => String(v == null || v === '' ? fallback : v).slice(0, 16);

    function random(room) {
        room.seed = (Math.imul(room.seed, 1664525) + 1013904223) >>> 0;
        return room.seed / 4294967296;
    }
    function create(opts = {}) {
        const mode = size(opts.mode);
        const room = {
            rev: 0, host: String(opts.host || ''), mode, arena: D.arenaFor(mode, opts.arena).id,
            phase: 'select', count: 0, played: 0, matchId: '',
            seats: [], bots: [], last: null, seed: opts.seed >>> 0 || 98
        };
        settle(room);
        return room;
    }
    const seatOf = (room, id) => room.seats.find(s => s.id === id) || null;
    const humans = (room, team) => room.seats.filter(s => s.team === team).length;
    const seated = room => room.seats.filter(s => s.team === 0 || s.team === 1);

    // Everything that must stay true after any change: nobody over a team's
    // size, waiting players moved into a seat that opened, a bot in each seat
    // still empty, and the countdown running only while everyone is ready.
    function settle(room) {
        const counts = [0, 0];
        for (const s of room.seats) {
            if (s.team !== 0 && s.team !== 1) continue;
            if (counts[s.team] < room.mode) counts[s.team]++;
            else { s.team = -1; s.ready = false; }
        }
        for (const s of room.seats) {
            if (s.team !== -1) continue;
            const team = counts[0] <= counts[1] ? 0 : 1;
            if (counts[team] >= room.mode) break;
            s.team = team; counts[team]++;
        }
        const bots = [];
        for (const team of [0, 1]) {
            const kept = room.bots.filter(b => b.team === team).slice(0, room.mode - counts[team]);
            while (kept.length < room.mode - counts[team]) kept.push({ team, pick: Math.floor(random(room) * D.FIGHTERS.length) });
            bots.push(...kept);
        }
        bots.forEach((b, i) => { b.name = BOT_NAMES[i % BOT_NAMES.length]; });
        room.bots = bots;
        if (room.phase !== 'match') {
            const players = seated(room);
            const go = players.length > 0 && players.every(s => s.ready);
            if (!go) { room.phase = 'select'; room.count = 0; }
            else if (room.phase === 'select') { room.phase = 'countdown'; room.count = COUNTDOWN; }
        }
        room.rev++;
    }

    // A player arrived. Calling it again for the same id only refreshes the name.
    function join(room, id, name, pick, team) {
        id = String(id || '');
        if (!id) return null;
        let seat = seatOf(room, id);
        if (seat) {
            const next = label(name, seat.name);
            if (next !== seat.name) { seat.name = next; room.rev++; }
            return seat;
        }
        if (room.seats.length >= MAX_SEATS) return null;
        seat = { id, name: label(name, 'player'), pick: fighter(pick) ? pick : 0, ready: false, team: team === 0 || team === 1 ? team : -1, wins: 0, n: 0, playing: false };
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

    // What a player asks for: { n, c, r, t } = sequence, fighter, ready, team.
    // `id` is whoever the transport says sent it, never a field of the message,
    // so nobody can pick or ready up for somebody else. The whole wish is sent
    // every time, which makes a lost or repeated packet harmless.
    function intent(room, id, msg) {
        const seat = seatOf(room, id);
        if (!seat || !msg || typeof msg !== 'object') return false;
        if (!Number.isSafeInteger(msg.n) || msg.n <= seat.n) return false;
        seat.n = msg.n;
        const wantsReady = msg.r === true;
        let changed = false;
        if (seat.ready && !wantsReady) { seat.ready = false; changed = true; }
        // a ready player is locked: no new fighter, no new side, until they undo it
        if (!seat.ready) {
            if (fighter(msg.c) && msg.c !== seat.pick) { seat.pick = msg.c; changed = true; }
            if ((msg.t === 0 || msg.t === 1) && msg.t !== seat.team && room.phase !== 'match' && humans(room, msg.t) < room.mode) {
                seat.team = msg.t; changed = true;
            }
            if (wantsReady && room.phase !== 'match' && seat.team !== -1) { seat.ready = true; changed = true; }
        }
        // the sequence number goes back out either way: it is how the sender
        // learns that this wish arrived, granted or not
        if (changed) settle(room); else room.rev++;
        return changed;
    }

    // Host settings. Like a fighter, they are locked while the host is ready.
    function hostMay(room, id) {
        const seat = seatOf(room, id);
        return !!id && id === room.host && room.phase === 'select' && !(seat && seat.ready);
    }
    function setMode(room, id, mode) {
        if (!hostMay(room, id) || (mode !== 1 && mode !== 2) || mode === room.mode) return false;
        room.mode = mode;
        room.arena = D.arenaFor(mode, room.arena).id;
        // sides are about to move under people, so nobody stays ready through it
        room.seats.forEach(s => { s.ready = false; });
        settle(room);
        return true;
    }
    function setArena(room, id, arena) {
        if (!hostMay(room, id)) return false;
        const stage = D.arenasFor(room.mode).find(a => a.id === arena);
        if (!stage || stage.id === room.arena) return false;
        room.arena = stage.id;
        room.rev++;
        return true;
    }
    function rerollBot(room, id, index) {
        const bot = room.bots[index];
        if (!hostMay(room, id) || !bot) return false;
        bot.pick = (bot.pick + 1 + Math.floor(random(room) * (D.FIGHTERS.length - 1))) % D.FIGHTERS.length;
        room.rev++;
        return true;
    }

    // Runs the countdown. True on the tick it ends: the host starts the match.
    function tick(room, ms) {
        if (room.phase !== 'countdown') return false;
        room.count -= Math.max(0, Number(ms) || 0);
        if (room.count > 0) return false;
        room.count = 0;
        return true;
    }
    // Turns the room into a match description every client builds its fighters from.
    function begin(room, seed, at) {
        if (room.phase === 'match') return null;
        const players = seated(room);
        if (!players.length) return null;
        room.phase = 'match'; room.count = 0;
        room.matchId = String(at) + ':' + seed;
        room.seats.forEach(s => { s.ready = false; s.playing = players.includes(s); });
        room.rev++;
        return {
            match: room.matchId, seed, at, options: { mode: String(room.mode), arena: room.arena },
            people: players.map(s => ({ id: s.id, name: s.name, character: s.pick, team: s.team, bot: false }))
                .concat(room.bots.map((b, i) => ({ id: 'bot-' + i, name: b.name, character: b.pick, team: b.team, bot: true })))
        };
    }
    // The match ended: remember the result, count the win, reopen the select screen.
    function finish(room, result) {
        if (room.phase !== 'match' || !result || result.match !== room.matchId) return false;
        const winner = result.winner === 1 ? 1 : 0;
        const rows = (Array.isArray(result.rows) ? result.rows : []).slice(0, 4).map(r => ({
            id: String(r.id || ''), name: label(r.name, 'player'), team: r.team === 1 ? 1 : 0,
            pick: fighter(r.pick) ? r.pick : 0, kos: Math.max(0, Math.round(Number(r.kos) || 0)),
            dealt: Math.max(0, Math.round(Number(r.dealt) || 0)), bot: !!r.bot
        }));
        for (const row of rows) {
            const seat = !row.bot && row.team === winner && seatOf(room, row.id);
            if (seat && seat.playing) seat.wins++;
        }
        room.last = { match: room.matchId, winner, rows };
        room.played++;
        room.phase = 'select'; room.matchId = '';
        room.seats.forEach(s => { s.ready = false; s.playing = false; });
        // fresh opponents for the next round
        room.bots.forEach(b => { b.pick = Math.floor(random(room) * D.FIGHTERS.length); });
        settle(room);
        return true;
    }

    // The copy guests receive. Arrays instead of objects: it goes out often.
    function view(room) {
        return {
            v: 1, rev: room.rev, host: room.host, mode: room.mode, arena: room.arena,
            phase: room.phase, count: Math.round(room.count), played: room.played, match: room.matchId,
            seats: room.seats.map(s => [s.id, s.name, s.pick, s.ready ? 1 : 0, s.team, s.wins, s.playing ? 1 : 0, s.n]),
            bots: room.bots.map(b => [b.team, b.pick, b.name]),
            last: room.last && [room.last.match, room.last.winner, room.last.rows.map(r => [r.id, r.name, r.team, r.pick, r.kos, r.dealt, r.bot ? 1 : 0])]
        };
    }
    // A guest never trusts the shape of what arrives: null unless all of it is sane.
    function read(w) {
        const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
        const text = v => typeof v === 'string' && v.length <= 64;
        if (!w || typeof w !== 'object' || w.v !== 1 || !int(w.rev, 0, 1e12) || !text(w.host)) return null;
        if ((w.mode !== 1 && w.mode !== 2) || !PHASES.includes(w.phase) || !int(w.count, 0, 60000) || !int(w.played, 0, 1e6) || !text(w.match)) return null;
        if (!D.arenasFor(w.mode).some(a => a.id === w.arena)) return null;
        if (!Array.isArray(w.seats) || w.seats.length > MAX_SEATS || !Array.isArray(w.bots) || w.bots.length > 4) return null;
        const seats = [], bots = [];
        for (const s of w.seats) {
            if (!Array.isArray(s) || !text(s[0]) || !s[0] || !text(s[1]) || !fighter(s[2]) || !int(s[4], -1, 1) || !int(s[5], 0, 1e6)) return null;
            seats.push({ id: s[0], name: label(s[1], 'player'), pick: s[2], ready: s[3] === 1, team: s[4], wins: s[5], playing: s[6] === 1, n: int(s[7], 0, 1e12) ? s[7] : 0 });
        }
        for (const b of w.bots) {
            if (!Array.isArray(b) || !int(b[0], 0, 1) || !fighter(b[1]) || !text(b[2])) return null;
            bots.push({ team: b[0], pick: b[1], name: label(b[2], 'cpu') });
        }
        let last = null;
        if (w.last != null) {
            const l = w.last;
            if (!Array.isArray(l) || !text(l[0]) || !int(l[1], 0, 1) || !Array.isArray(l[2]) || l[2].length > 4) return null;
            const rows = [];
            for (const r of l[2]) {
                if (!Array.isArray(r) || !text(r[0]) || !text(r[1]) || !int(r[2], 0, 1) || !fighter(r[3]) || !int(r[4], 0, 99) || !int(r[5], 0, 1e6)) return null;
                rows.push({ id: r[0], name: label(r[1], 'player'), team: r[2], pick: r[3], kos: r[4], dealt: r[5], bot: r[6] === 1 });
            }
            last = { match: l[0], winner: l[1], rows };
        }
        return { rev: w.rev, host: w.host, mode: w.mode, arena: w.arena, phase: w.phase, count: w.count, played: w.played, matchId: w.match, seats, bots, last };
    }
    // A match description from the host, checked the same way before a guest uses it.
    function readStart(d) {
        if (!d || typeof d !== 'object' || typeof d.match !== 'string' || d.match.length > 64) return null;
        if (!Number.isSafeInteger(d.seed) || !Number.isSafeInteger(d.at) || d.match !== d.at + ':' + d.seed) return null;
        const o = d.options, mode = o && (o.mode === '2' ? 2 : o.mode === '1' ? 1 : 0);
        if (!mode || !D.arenasFor(mode).some(a => a.id === o.arena)) return null;
        if (!Array.isArray(d.people) || d.people.length !== mode * 2) return null;
        const people = [];
        for (const p of d.people) {
            if (!p || typeof p.id !== 'string' || !p.id || p.id.length > 64 || !fighter(p.character) || (p.team !== 0 && p.team !== 1)) return null;
            people.push({ id: p.id, name: label(p.name, 'player'), character: p.character, team: p.team, bot: p.bot === true });
        }
        if ([0, 1].some(team => people.filter(p => p.team === team).length !== mode)) return null;
        return { match: d.match, seed: d.seed, at: d.at, options: { mode: String(mode), arena: o.arena }, people };
    }

    root.RIFT_ROOM = { COUNTDOWN, create, join, leave, intent, setMode, setArena, rerollBot, tick, begin, finish, view, read, readStart, seat: seatOf, seated };
})(typeof window === 'undefined' ? globalThis : window);
