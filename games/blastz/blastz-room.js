// The online room of blastz 98: who is in, which fighter and perk each one
// picked, who is ready, and the host's rules. The host owns it and is the
// only one who changes it; guests get `view` and send back an `intent`.
// No DOM, clocks or network, so the tests run it under node.
(function (root) {
    'use strict';
    const D = root.BLASTZ;
    const COUNTDOWN = 3000, MAX_SEATS = 6;
    const PHASES = ['select', 'countdown', 'match'];
    const fighter = n => Number.isInteger(n) && n >= 0 && n < D.FIGHTERS;
    const perkOk = id => D.PERKS.some(p => p.id === id);
    const label = (v, fallback) => String(v == null || v === '' ? fallback : v).slice(0, 16);

    function random(room) {
        room.seed = (Math.imul(room.seed, 1664525) + 1013904223) >>> 0;
        return room.seed / 4294967296;
    }
    function rules(o = {}) {
        return { map: D.map(o.map).id, lives: D.lives(o.lives), teams: o.teams === true || o.teams === '1' || o.teams === 'teams', count: D.count(o.count) };
    }
    function create(opts = {}) {
        const room = { rev: 0, host: String(opts.host || ''), rules: rules(opts), phase: 'select', count: 0, played: 0, matchId: '', seats: [], bots: [], last: null, seed: opts.seed >>> 0 || 98 };
        settle(room);
        return room;
    }
    const seatOf = (room, id) => room.seats.find(s => s.id === id) || null;
    const playing = room => room.seats.filter(s => s.in);
    const cap = room => room.rules.teams ? Math.ceil(room.rules.count / 2) : room.rules.count;

    // After every change: the first `count` people in the room play, everybody
    // else waits; in teams nobody is over a side's size; bots fill what is left,
    // and the countdown runs only while every player is ready.
    function settle(room) {
        const r = room.rules;
        room.seats.forEach((s, i) => { s.in = i < r.count; if (!s.in) s.ready = false; });
        if (r.teams) {
            const counts = [0, 0];
            for (const s of playing(room)) {
                if (s.team !== 0 && s.team !== 1) s.team = counts[0] <= counts[1] ? 0 : 1;
                if (counts[s.team] >= cap(room)) s.team = 1 - s.team;
                counts[s.team]++;
            }
            const bots = [];
            for (let i = 0; i < r.count - playing(room).length; i++) {
                const team = counts[0] <= counts[1] ? 0 : 1; counts[team]++;
                bots.push(Object.assign(room.bots[i] || { pick: Math.floor(random(room) * D.FIGHTERS), perk: D.PERKS[Math.floor(random(room) * D.PERKS.length)].id }, { team }));
            }
            room.bots = bots;
        } else {
            room.bots = room.bots.slice(0, Math.max(0, r.count - playing(room).length));
            while (room.bots.length < r.count - playing(room).length) room.bots.push({ pick: Math.floor(random(room) * D.FIGHTERS), perk: D.PERKS[Math.floor(random(room) * D.PERKS.length)].id, team: 0 });
        }
        room.bots.forEach((b, i) => { b.name = D.BOT_NAMES[i % D.BOT_NAMES.length]; });
        if (room.phase !== 'match') {
            const players = playing(room), go = players.length > 0 && players.every(s => s.ready);
            if (!go) { room.phase = 'select'; room.count = 0; }
            else if (room.phase === 'select') { room.phase = 'countdown'; room.count = COUNTDOWN; }
        }
        room.rev++;
    }
    function join(room, id, name, pick, perk) {
        id = String(id || '');
        if (!id) return null;
        let seat = seatOf(room, id);
        if (seat) {
            const next = label(name, seat.name);
            if (next !== seat.name) { seat.name = next; room.rev++; }
            return seat;
        }
        if (room.seats.length >= MAX_SEATS) return null;
        seat = { id, name: label(name, 'player'), pick: fighter(pick) ? pick : 0, perk: perkOk(perk) ? perk : D.PERKS[0].id, ready: false, team: -1, wins: 0, n: 0, in: false, playing: false };
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
    // { n, c, p, r, t }: sequence, fighter, perk, ready, side. The sender is
    // whoever the transport says, never a field of the message.
    function intent(room, id, msg) {
        const seat = seatOf(room, id);
        if (!seat || !msg || typeof msg !== 'object') return false;
        if (!Number.isSafeInteger(msg.n) || msg.n <= seat.n) return false;
        seat.n = msg.n;
        const wantsReady = msg.r === true;
        let changed = false;
        if (seat.ready && !wantsReady) { seat.ready = false; changed = true; }
        if (!seat.ready) {
            if (fighter(msg.c) && msg.c !== seat.pick) { seat.pick = msg.c; changed = true; }
            if (perkOk(msg.p) && msg.p !== seat.perk) { seat.perk = msg.p; changed = true; }
            if (room.rules.teams && seat.in && (msg.t === 0 || msg.t === 1) && msg.t !== seat.team && room.phase !== 'match' &&
                playing(room).filter(s => s.team === msg.t).length < cap(room)) { seat.team = msg.t; changed = true; }
            if (wantsReady && room.phase !== 'match' && seat.in) { seat.ready = true; changed = true; }
        }
        if (changed) settle(room); else room.rev++;
        return changed;
    }
    function hostMay(room, id) {
        const seat = seatOf(room, id);
        return !!id && id === room.host && room.phase === 'select' && !(seat && seat.ready);
    }
    // The host changes a rule. Ones that move people around unready everybody.
    function setRule(room, id, key, value) {
        if (!hostMay(room, id) || !['map', 'lives', 'teams', 'count'].includes(key)) return false;
        const next = rules(Object.assign({}, room.rules, { [key]: value }));
        if (next[key] === room.rules[key]) return false;
        room.rules = next;
        if (key === 'teams' || key === 'count') room.seats.forEach(s => { s.ready = false; });
        settle(room);
        return true;
    }
    function rerollBot(room, id, index) {
        const bot = room.bots[index];
        if (!hostMay(room, id) || !bot) return false;
        bot.pick = (bot.pick + 1 + Math.floor(random(room) * (D.FIGHTERS - 1))) % D.FIGHTERS;
        bot.perk = D.PERKS[Math.floor(random(room) * D.PERKS.length)].id;
        room.rev++;
        return true;
    }
    function tick(room, ms) {
        if (room.phase !== 'countdown') return false;
        room.count -= Math.max(0, Number(ms) || 0);
        if (room.count > 0) return false;
        room.count = 0;
        return true;
    }
    function begin(room, seed, at) {
        if (room.phase === 'match') return null;
        const players = playing(room);
        if (!players.length) return null;
        room.phase = 'match'; room.count = 0;
        room.matchId = String(at) + ':' + seed;
        room.seats.forEach(s => { s.ready = false; s.playing = players.includes(s); });
        room.rev++;
        const r = room.rules;
        return {
            match: room.matchId, seed, at, options: { map: r.map, lives: r.lives, teams: r.teams, count: r.count },
            people: players.map(s => ({ id: s.id, name: s.name, character: s.pick, perk: s.perk, team: r.teams ? s.team : 0, bot: false }))
                .concat(room.bots.map((b, i) => ({ id: 'bot-' + i, name: b.name, character: b.pick, perk: b.perk, team: r.teams ? b.team : 0, bot: true })))
        };
    }
    // The match is over: count the wins, reopen the select screen.
    function finish(room, result) {
        if (room.phase !== 'match' || !result || result.match !== room.matchId) return false;
        const rows = (Array.isArray(result.rows) ? result.rows : []).slice(0, 4).map(r => ({
            id: String(r.id || ''), name: label(r.name, 'player'), team: Number.isInteger(r.team) && r.team >= 0 && r.team <= 3 ? r.team : 0,
            pick: fighter(r.pick) ? r.pick : 0, kos: Math.max(0, Math.round(Number(r.kos) || 0)), falls: Math.max(0, Math.round(Number(r.falls) || 0)),
            place: Math.max(1, Math.min(4, Math.round(Number(r.place) || 1))), bot: !!r.bot
        }));
        for (const row of rows) {
            const seat = !row.bot && row.place === 1 && seatOf(room, row.id);
            if (seat && seat.playing) seat.wins++;
        }
        room.last = { match: room.matchId, rows };
        room.played++;
        room.phase = 'select'; room.matchId = '';
        room.seats.forEach(s => { s.ready = false; s.playing = false; });
        room.bots.forEach(b => { b.pick = Math.floor(random(room) * D.FIGHTERS); });
        settle(room);
        return true;
    }
    function view(room) {
        const r = room.rules;
        return {
            v: 1, rev: room.rev, host: room.host, rules: [r.map, r.lives, r.teams ? 1 : 0, r.count],
            phase: room.phase, count: Math.round(room.count), played: room.played, match: room.matchId,
            seats: room.seats.map(s => [s.id, s.name, s.pick, s.perk, s.ready ? 1 : 0, s.team, s.wins, s.in ? 1 : 0, s.playing ? 1 : 0, s.n]),
            bots: room.bots.map(b => [b.team, b.pick, b.perk, b.name]),
            last: room.last && [room.last.match, room.last.rows.map(x => [x.id, x.name, x.team, x.pick, x.kos, x.falls, x.place, x.bot ? 1 : 0])]
        };
    }
    function read(w) {
        const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
        const text = v => typeof v === 'string' && v.length <= 64;
        if (!w || typeof w !== 'object' || w.v !== 1 || !int(w.rev, 0, 1e12) || !text(w.host)) return null;
        if (!Array.isArray(w.rules) || !D.MAPS.some(m => m.id === w.rules[0]) || !D.LIVES.includes(w.rules[1]) || !int(w.rules[2], 0, 1) || !int(w.rules[3], 2, 4)) return null;
        if (!PHASES.includes(w.phase) || !int(w.count, 0, 60000) || !int(w.played, 0, 1e6) || !text(w.match)) return null;
        if (!Array.isArray(w.seats) || w.seats.length > MAX_SEATS || !Array.isArray(w.bots) || w.bots.length > 4) return null;
        const seats = [], bots = [];
        for (const s of w.seats) {
            if (!Array.isArray(s) || !text(s[0]) || !s[0] || !text(s[1]) || !fighter(s[2]) || !perkOk(s[3]) || !int(s[5], -1, 1) || !int(s[6], 0, 1e6)) return null;
            seats.push({ id: s[0], name: label(s[1], 'player'), pick: s[2], perk: s[3], ready: s[4] === 1, team: s[5], wins: s[6], in: s[7] === 1, playing: s[8] === 1, n: int(s[9], 0, 1e12) ? s[9] : 0 });
        }
        for (const b of w.bots) {
            if (!Array.isArray(b) || !int(b[0], 0, 1) || !fighter(b[1]) || !perkOk(b[2]) || !text(b[3])) return null;
            bots.push({ team: b[0], pick: b[1], perk: b[2], name: label(b[3], 'cpu') });
        }
        let last = null;
        if (w.last != null) {
            const l = w.last;
            if (!Array.isArray(l) || !text(l[0]) || !Array.isArray(l[1]) || l[1].length > 4) return null;
            const rows = [];
            for (const x of l[1]) {
                if (!Array.isArray(x) || !text(x[0]) || !text(x[1]) || !int(x[2], 0, 3) || !fighter(x[3]) || !int(x[4], 0, 99) || !int(x[5], 0, 99) || !int(x[6], 1, 4)) return null;
                rows.push({ id: x[0], name: label(x[1], 'player'), team: x[2], pick: x[3], kos: x[4], falls: x[5], place: x[6], bot: x[7] === 1 });
            }
            last = { match: l[0], rows };
        }
        const rl = { map: w.rules[0], lives: w.rules[1], teams: w.rules[2] === 1, count: w.rules[3] };
        return { rev: w.rev, host: w.host, rules: rl, phase: w.phase, count: w.count, played: w.played, matchId: w.match, seats, bots, last };
    }
    function readStart(d) {
        if (!d || typeof d !== 'object' || typeof d.match !== 'string' || d.match.length > 64) return null;
        if (!Number.isSafeInteger(d.seed) || !Number.isSafeInteger(d.at) || d.match !== d.at + ':' + d.seed) return null;
        const o = d.options;
        if (!o || !D.MAPS.some(m => m.id === o.map) || !D.LIVES.includes(o.lives) || typeof o.teams !== 'boolean' || !Number.isInteger(o.count) || o.count < 2 || o.count > 4) return null;
        if (!Array.isArray(d.people) || d.people.length !== o.count) return null;
        const people = [];
        for (const p of d.people) {
            if (!p || typeof p.id !== 'string' || !p.id || p.id.length > 64 || !fighter(p.character) || !perkOk(p.perk) || (p.team !== 0 && p.team !== 1)) return null;
            people.push({ id: p.id, name: label(p.name, 'player'), character: p.character, perk: p.perk, team: p.team, bot: p.bot === true });
        }
        return { match: d.match, seed: d.seed, at: d.at, options: { map: o.map, lives: o.lives, teams: o.teams, count: o.count }, people };
    }
    root.BLASTZ_ROOM = { COUNTDOWN, create, join, leave, intent, setRule, rerollBot, tick, begin, finish, view, read, readStart, seat: seatOf, playing, rules };
})(typeof window === 'undefined' ? globalThis : window);
