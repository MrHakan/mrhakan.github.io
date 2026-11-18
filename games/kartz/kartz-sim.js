// ===================================================================
// kartz 98 — the rules of the card table, with no page in them
//
// Three games on one standard 52 card deck: batak (bid, name trumps, take
// tricks), king (twenty hands of contracts: six ways to lose points and the
// trump hands that win them back) and pisti (sweep the pile). Everything here
// is plain data and pure functions so node can run it: a match is one JSON
// object, a seeded rng lives inside it, and the same seed and the same
// actions always give the same match.
//
// A card is a number 0..51: suit = floor(c / 13) (clubs, diamonds, hearts,
// spades), rank = c % 13 + 2 (2..10, J 11, Q 12, K 13, A 14).
//
// The only ways to change a match are act(st, seat, action) for the seat whose
// turn it is, and advance(st) for the table itself (sweep a finished trick,
// deal the next hand). Both refuse anything the rules do not allow.
// ===================================================================
(function (root) {
    'use strict';

    const SUIT_GLYPH = ['\u2663', '\u2666', '\u2665', '\u2660'];
    const SUIT_NAME = ['clubs', 'diamonds', 'hearts', 'spades'];
    const CLUBS = 0, DIAMONDS = 1, HEARTS = 2;
    const RANK_LABEL = r => (r <= 10 ? String(r) : ['J', 'Q', 'K', 'A'][r - 11]);
    const suitOf = c => (c / 13) | 0;
    const rankOf = c => (c % 13) + 2;
    const card = (s, r) => s * 13 + r - 2;
    const label = c => RANK_LABEL(rankOf(c)) + SUIT_GLYPH[suitOf(c)];
    const KING_HEARTS = card(HEARTS, 13);

    const GAMES = {
        batak: { name: 'batak', seats: [4], targets: { short: 31, long: 51 }, maxHands: 20 },
        king: { name: 'king', seats: [4], hands: 20 },
        pisti: { name: 'pisti', seats: [2, 4], targets: { short: 51, long: 151 }, maxHands: 30 }
    };
    // the classic turkish king set: six penalty contracts, two of each per table,
    // and two trump hands for every player. The penalties add up to exactly what
    // the trump hands give back, so a whole game sums to zero
    const CONTRACTS = [
        { id: 'el', name: 'no tricks', tr: 'el almaz', per: -50, help: '-50 for every trick you take' },
        { id: 'kupa', name: 'no hearts', tr: 'kupa almaz', per: -30, help: '-30 for every heart you take' },
        { id: 'erkek', name: 'no jacks/kings', tr: 'erkek almaz', per: -60, help: '-60 for every jack or king you take' },
        { id: 'kiz', name: 'no queens', tr: 'kiz almaz', per: -100, help: '-100 for every queen you take' },
        { id: 'rifki', name: 'king of hearts', tr: 'rifki', per: -320, help: '-320 for whoever takes the king of hearts' },
        { id: 'son', name: 'last two', tr: 'son iki', per: -180, help: '-180 for each of the last two tricks' },
        { id: 'koz', name: 'trumps', tr: 'koz', per: 50, help: '+50 for every trick you take. the chooser names trumps' }
    ];
    const CONTRACT = {};
    CONTRACTS.forEach(k => { CONTRACT[k.id] = k; });
    const PENALTIES = CONTRACTS.filter(k => k.id !== 'koz').map(k => k.id);
    const BOT_NAMES = ['dayi', 'teyze', 'kuzen', 'eniste', 'bacanak', 'hala'];

    // ---------------------------------------------------------------
    // the rng lives in the match: mulberry32, one uint32 of state
    // ---------------------------------------------------------------
    function rand(st) {
        let t = (st.rng = (st.rng + 0x6D2B79F5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function shuffled(st) {
        const d = [];
        for (let i = 0; i < 52; i++) d.push(i);
        for (let i = 51; i > 0; i--) { const j = Math.floor(rand(st) * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; }
        return d;
    }
    // suits alternate colour in the hand: clubs, hearts, spades, diamonds
    const SUIT_ORDER = [0, 3, 1, 2];
    const sortHand = h => h.sort((a, b) => SUIT_ORDER[suitOf(a)] - SUIT_ORDER[suitOf(b)] || rankOf(a) - rankOf(b));

    // ---------------------------------------------------------------
    // a match
    // ---------------------------------------------------------------
    function seatCount(game, people) {
        if (game === 'pisti') return people <= 2 ? 2 : 4;
        return 4;
    }
    // o: { game, seats: [{id, name, bot}], seed, length: 'short'|'long', n }
    function newMatch(o) {
        const game = GAMES[o.game] ? o.game : 'batak';
        const def = GAMES[game];
        const seed = o.seed >>> 0;
        let seats = (o.seats || []).map(p => ({ id: String(p.id || ''), name: String(p.name || 'player').slice(0, 16), bot: !!p.bot }));
        const n = def.seats.includes(o.n) ? o.n : seatCount(game, seats.length);
        seats = seats.slice(0, n);
        let b = 0;
        while (seats.length < n) { seats.push({ id: 'bot' + seats.length, name: BOT_NAMES[(seed % 6 + b) % BOT_NAMES.length] + ' bot', bot: true }); b++; }
        const length = o.length === 'long' ? 'long' : 'short';
        const st = {
            v: 1, game, n, seats, seed, rng: (seed ^ 0x9E3779B9) >>> 0, length,
            target: def.targets ? def.targets[length] : 0,
            phase: 'deal', handNo: 0, dealer: seed % n, turn: -1,
            hands: [], scores: new Array(n).fill(0), history: [],
            trick: [], leader: -1, trump: -1, broken: false, tricks: new Array(n).fill(0), trickNo: 0, trickWinner: -1, lastTrick: null,
            played: [], log: [], evN: 0, over: false, winners: [], summary: null
        };
        if (game === 'king') {
            st.used = {}; PENALTIES.forEach(k => { st.used[k] = 0; });
            st.picks = seats.map(() => ({ koz: 0, pen: 0 }));
            st.contract = '';
        }
        deal(st);
        return st;
    }
    function ev(st, e) {
        e.n = ++st.evN;
        st.log.push(e);
        if (st.log.length > 24) st.log.splice(0, st.log.length - 24);
    }
    const teamOf = (st, s) => (st.game === 'pisti' && st.n === 4 ? s % 2 : s);

    function deal(st) {
        const n = st.n;
        st.trick = []; st.trump = -1; st.broken = false; st.trickNo = 0; st.trickWinner = -1; st.lastTrick = null;
        st.tricks = new Array(n).fill(0); st.played = []; st.summary = null;
        const d = shuffled(st);
        if (st.game === 'pisti') {
            // four on the table, three face down and one up. A jack does not start
            // a pile: it goes back under the deck and the next card comes up
            st.pile = d.splice(0, 4);
            while (rankOf(st.pile[3]) === 11) { d.push(st.pile.pop()); st.pile.push(d.shift()); }
            st.pileHidden = 3;
            st.deck = d;
            st.hands = [];
            for (let s = 0; s < n; s++) st.hands.push(sortHand(st.deck.splice(0, 4)));
            st.taken = new Array(n).fill(0); st.handPts = new Array(n).fill(0); st.pistis = new Array(n).fill(0);
            st.lastCap = -1;
            st.played.push(st.pile[3]);
            st.phase = 'play';
            st.turn = (st.dealer + 1) % n;
            st.leader = st.turn;
        } else {
            st.hands = [];
            for (let s = 0; s < n; s++) st.hands.push(sortHand(d.slice(s * 13, s * 13 + 13)));
            st.pen = new Array(n).fill(0);
            st.got = 0;
            if (st.game === 'batak') {
                st.bids = new Array(n).fill(null); st.high = 0; st.bidder = -1;
                st.phase = 'bid';
                st.turn = (st.dealer + 1) % n;
            } else {
                // king: the chooser goes round the table, five hands each
                st.chooser = st.handNo % n;
                st.dealer = (st.chooser + n - 1) % n;
                st.contract = '';
                st.phase = 'pick';
                st.turn = st.chooser;
            }
        }
        ev(st, { e: 'deal', h: st.handNo });
    }

    // ---------------------------------------------------------------
    // what a seat may do now
    // ---------------------------------------------------------------
    function bidLegal(st) {
        const out = [];
        const passed = st.bids.filter(b => b === 0).length;
        // everybody else passed and nobody bid: this seat has to take it
        if (!(st.bidder < 0 && passed === st.n - 1)) out.push({ t: 'bid', v: 0 });
        for (let v = Math.max(5, st.high + 1); v <= 13; v++) out.push({ t: 'bid', v });
        return out;
    }
    const strict = st => st.game === 'batak' || (st.game === 'king' && st.contract === 'koz');
    function breakSuit(st) {
        if (st.trump >= 0) return st.trump;
        if (st.game === 'king' && (st.contract === 'kupa' || st.contract === 'rifki')) return HEARTS;
        return -1;
    }
    // the cards of `hand` its seat may put on the trick on the table
    function playable(st, hand) {
        const trick = st.trick, T = st.trump;
        if (st.game === 'pisti') return hand.slice();
        if (!trick.length) {
            const bs = breakSuit(st);
            if (bs >= 0 && !st.broken) {
                const other = hand.filter(c => suitOf(c) !== bs);
                if (other.length) return other;
            }
            return hand.slice();
        }
        const L = suitOf(trick[0].c);
        const follow = hand.filter(c => suitOf(c) === L);
        if (follow.length) {
            if (strict(st)) {
                let top = 0;
                for (const t of trick) if (suitOf(t.c) === L && rankOf(t.c) > top) top = rankOf(t.c);
                const higher = follow.filter(c => rankOf(c) > top);
                if (higher.length) return higher;
            }
            return follow;
        }
        if (strict(st) && T >= 0) {
            const trumps = hand.filter(c => suitOf(c) === T);
            if (trumps.length) {
                let top = 0;
                for (const t of trick) if (suitOf(t.c) === T && rankOf(t.c) > top) top = rankOf(t.c);
                const over = trumps.filter(c => rankOf(c) > top);
                return over.length ? over : trumps;
            }
            return hand.slice();
        }
        if (st.game === 'king') {
            // void in the led suit: the king of hearts, and the hearts, have to go
            if (st.contract === 'rifki' && hand.includes(KING_HEARTS)) return [KING_HEARTS];
            if (st.contract === 'kupa') { const h = hand.filter(c => suitOf(c) === HEARTS); if (h.length) return h; }
        }
        return hand.slice();
    }
    function kingPicks(st, seat) {
        const p = st.picks[seat], out = [];
        if (p.koz < 2) out.push({ t: 'pick', k: 'koz' });
        if (p.pen < 3) for (const k of PENALTIES) if (st.used[k] < 2) out.push({ t: 'pick', k });
        return out;
    }
    function legal(st, seat) {
        if (!st || st.over || seat !== st.turn || seat < 0) return [];
        switch (st.phase) {
            case 'bid': return bidLegal(st);
            case 'trump': return [0, 1, 2, 3].map(s => ({ t: 'trump', s }));
            case 'pick': return kingPicks(st, seat);
            case 'play': {
                const h = st.hands[seat];
                if (!Array.isArray(h) || h.some(c => c < 0)) return [];
                return playable(st, h).map(c => ({ t: 'play', c }));
            }
        }
        return [];
    }
    const same = (a, b) => a.t === b.t && a.v === b.v && a.s === b.s && a.c === b.c && a.k === b.k;
    function isLegal(st, seat, a) {
        if (!a || typeof a !== 'object' || typeof a.t !== 'string') return false;
        return legal(st, seat).some(x => same(x, a));
    }

    // ---------------------------------------------------------------
    // doing it
    // ---------------------------------------------------------------
    function act(st, seat, a) {
        if (!Number.isInteger(seat) || !isLegal(st, seat, a)) return false;
        if (a.t === 'bid') doBid(st, seat, a.v);
        else if (a.t === 'trump') doTrump(st, seat, a.s);
        else if (a.t === 'pick') doPick(st, seat, a.k);
        else if (a.t === 'play') (st.game === 'pisti' ? pistiPlay : trickPlay)(st, seat, a.c);
        return true;
    }
    function doBid(st, seat, v) {
        st.bids[seat] = v;
        if (v > 0) { st.high = v; st.bidder = seat; }
        ev(st, { e: 'bid', s: seat, v });
        let live = 0;
        for (let s = 0; s < st.n; s++) if (st.bids[s] !== 0) live++;
        if (st.bidder >= 0 && (live === 1 || st.high === 13)) {
            st.phase = 'trump'; st.turn = st.bidder;
            ev(st, { e: 'won-bid', s: st.bidder, v: st.high });
            return;
        }
        let t = seat;
        for (let k = 0; k < st.n; k++) { t = (t + 1) % st.n; if (st.bids[t] !== 0) break; }
        st.turn = t;
    }
    function doTrump(st, seat, s) {
        st.trump = s;
        ev(st, { e: 'trump', s: seat, suit: s });
        st.phase = 'play';
        st.leader = st.turn = seat;
    }
    function doPick(st, seat, k) {
        st.contract = k;
        if (k === 'koz') st.picks[seat].koz++;
        else { st.picks[seat].pen++; st.used[k]++; }
        ev(st, { e: 'pick', s: seat, k });
        if (k === 'koz') { st.phase = 'trump'; st.turn = seat; return; }
        st.phase = 'play';
        st.leader = st.turn = (seat + 1) % st.n;
    }
    function trickPlay(st, seat, c) {
        const h = st.hands[seat];
        h.splice(h.indexOf(c), 1);
        st.trick.push({ s: seat, c });
        st.played.push(c);
        if (suitOf(c) === breakSuit(st)) st.broken = true;
        ev(st, { e: 'play', s: seat, c });
        if (st.trick.length < st.n) { st.turn = (seat + 1) % st.n; return; }
        st.trickWinner = trickWinner(st);
        st.phase = 'trickEnd'; st.turn = -1;
    }
    function trickWinner(st) {
        const T = st.trump;
        let best = st.trick[0];
        for (const t of st.trick) {
            const bs = suitOf(best.c), ts = suitOf(t.c);
            if (ts === bs) { if (rankOf(t.c) > rankOf(best.c)) best = t; }
            else if (ts === T) best = t;
        }
        return best.s;
    }
    // how many of the things this king contract counts a trick holds
    function kingItems(st, cards, no) {
        const k = st.contract;
        if (k === 'el' || k === 'koz') return 1;
        if (k === 'kupa') return cards.filter(c => suitOf(c) === HEARTS).length;
        if (k === 'erkek') return cards.filter(c => rankOf(c) === 11 || rankOf(c) === 13).length;
        if (k === 'kiz') return cards.filter(c => rankOf(c) === 12).length;
        if (k === 'rifki') return cards.includes(KING_HEARTS) ? 1 : 0;
        if (k === 'son') return no >= 12 ? 1 : 0;
        return 0;
    }
    // once all of these are taken the hand is over: nothing is left to lose
    const KING_ITEMS = { kupa: 13, erkek: 8, kiz: 4, rifki: 1 };

    // the table moves on: a finished trick is swept, a finished hand gives way
    // to the next deal. Returns false when there is nothing to move
    function advance(st) {
        if (!st || st.over) return false;
        if (st.phase === 'trickEnd') { sweep(st); return true; }
        if (st.phase === 'handEnd') {
            st.handNo++;
            if (st.game !== 'king') st.dealer = (st.dealer + 1) % st.n;
            deal(st);
            return true;
        }
        return false;
    }
    function sweep(st) {
        const w = st.trickWinner, cards = st.trick.map(t => t.c);
        st.trickNo++;
        st.tricks[w]++;
        if (st.game === 'king') {
            const items = kingItems(st, cards, st.trickNo);
            st.pen[w] += items * CONTRACT[st.contract].per;
            st.got += items;
        }
        st.lastTrick = { w, cards: st.trick.slice() };
        ev(st, { e: 'trick', w, no: st.trickNo });
        st.trick = []; st.trickWinner = -1;
        const k = st.game === 'king' ? st.contract : '';
        const early = !!KING_ITEMS[k] && st.got >= KING_ITEMS[k];
        if (st.trickNo >= 13 || early) { endTrickHand(st, early); return; }
        st.phase = 'play';
        st.leader = st.turn = w;
    }
    function endTrickHand(st, early) {
        const n = st.n, pts = new Array(n).fill(0);
        let text;
        if (st.game === 'batak') {
            for (let s = 0; s < n; s++) {
                if (s === st.bidder) pts[s] = st.tricks[s] >= st.high ? st.tricks[s] : -st.high;
                else pts[s] = st.tricks[s];
            }
            const made = st.tricks[st.bidder] >= st.high;
            text = st.seats[st.bidder].name + (made ? ' made ' : ' went down on ') + st.high + ' in ' + SUIT_NAME[st.trump];
        } else {
            for (let s = 0; s < n; s++) pts[s] = st.pen[s];
            const c = CONTRACT[st.contract];
            text = c.name + (st.contract === 'koz' ? ' in ' + SUIT_NAME[st.trump] : '') + ', called by ' + st.seats[st.chooser].name + (early ? '. all of it went early' : '');
        }
        finishHand(st, pts, text, { tricks: st.tricks.slice(), bid: st.game === 'batak' ? st.high : 0, bidder: st.game === 'batak' ? st.bidder : -1, contract: st.contract || '', trump: st.trump, chooser: st.game === 'king' ? st.chooser : -1 });
    }
    function finishHand(st, pts, text, extra) {
        for (let s = 0; s < st.n; s++) st.scores[s] += pts[s];
        const row = Object.assign({ h: st.handNo + 1, pts: pts.slice(), text }, extra || {});
        st.history.push(row);
        st.summary = row;
        st.phase = 'handEnd'; st.turn = -1;
        ev(st, { e: 'hand', h: st.handNo + 1 });
        checkOver(st);
    }
    function checkOver(st) {
        const def = GAMES[st.game];
        const top = Math.max.apply(null, st.scores);
        const leaders = [];
        for (let s = 0; s < st.n; s++) if (st.scores[s] === top) leaders.push(s);
        const teams = new Set(leaders.map(s => teamOf(st, s)));
        let done;
        if (st.game === 'king') done = st.history.length >= def.hands;
        else done = st.history.length >= def.maxHands || (top >= st.target && teams.size === 1);
        if (!done) return;
        st.over = true;
        st.phase = 'over';
        st.winners = leaders;
        ev(st, { e: 'over', w: leaders });
    }

    // ---------------------------------------------------------------
    // pisti
    // ---------------------------------------------------------------
    function cardPoints(c) {
        if (c === card(CLUBS, 2)) return 2;
        if (c === card(DIAMONDS, 10)) return 3;
        const r = rankOf(c);
        return r === 14 || r === 11 ? 1 : 0;
    }
    function pistiPlay(st, seat, c) {
        const h = st.hands[seat];
        h.splice(h.indexOf(c), 1);
        st.played.push(c);
        const pile = st.pile, top = pile.length ? pile[pile.length - 1] : -1;
        if (top >= 0 && (rankOf(c) === rankOf(top) || rankOf(c) === 11)) {
            const pisti = pile.length === 1 && rankOf(c) === rankOf(top);
            const bonus = pisti ? (rankOf(c) === 11 ? 20 : 10) : 0;
            const got = pile.concat([c]);
            let p = bonus;
            for (const x of got) p += cardPoints(x);
            st.taken[seat] += got.length;
            st.handPts[seat] += p;
            if (pisti) st.pistis[seat]++;
            st.pile = []; st.pileHidden = 0; st.lastCap = seat;
            st.lastTrick = { w: seat, cards: [{ s: seat, c }], over: top };
            ev(st, { e: 'capture', s: seat, c, top, n: got.length, pisti: bonus, p });
        } else {
            pile.push(c);
            ev(st, { e: 'play', s: seat, c });
        }
        st.turn = (seat + 1) % st.n;
        if (st.hands.every(x => x.length === 0)) {
            if (st.deck.length) {
                for (let k = 0; k < st.n; k++) { const s = (st.dealer + 1 + k) % st.n; st.hands[s] = sortHand(st.deck.splice(0, 4)); }
                ev(st, { e: 'redeal', left: st.deck.length });
            } else endPisti(st);
        }
    }
    function endPisti(st) {
        const n = st.n;
        if (st.pile.length && st.lastCap >= 0) {
            let p = 0;
            for (const x of st.pile) p += cardPoints(x);
            st.taken[st.lastCap] += st.pile.length;
            st.handPts[st.lastCap] += p;
            ev(st, { e: 'last', s: st.lastCap, n: st.pile.length });
            st.pile = [];
        }
        // most cards: three points, to nobody on a tie
        const teams = n === 4 ? 2 : n;
        const cards = new Array(teams).fill(0), raw = new Array(teams).fill(0);
        for (let s = 0; s < n; s++) { cards[teamOf(st, s)] += st.taken[s]; raw[teamOf(st, s)] += st.handPts[s]; }
        const most = Math.max.apply(null, cards);
        const mostTeams = cards.map((v, t) => (v === most ? t : -1)).filter(t => t >= 0);
        if (mostTeams.length === 1) raw[mostTeams[0]] += 3;
        const pts = [];
        for (let s = 0; s < n; s++) pts.push(raw[teamOf(st, s)]);
        const best = Math.max.apply(null, raw);
        const who = raw.map((v, t) => (v === best ? t : -1)).filter(t => t >= 0);
        const name = t => (n === 4 ? st.seats[t].name + ' & ' + st.seats[t + 2].name : st.seats[t].name);
        const text = who.length > 1 ? 'an even hand' : name(who[0]) + ' took the hand';
        finishHand(st, pts, text, { cards: cards.slice(), most: mostTeams.length === 1 ? mostTeams[0] : -1, pistis: st.pistis.slice(), taken: st.taken.slice(), raw: raw.slice() });
    }

    // ---------------------------------------------------------------
    // what one seat may see: its own hand, never anybody else's, nor the deck
    // ---------------------------------------------------------------
    function view(st, seat) {
        const v = JSON.parse(JSON.stringify(st));
        v.hands = st.hands.map((h, s) => (s === seat ? h.slice() : h.map(() => -1)));
        if (st.game === 'pisti') {
            v.deck = st.deck.length;
            v.pile = st.pile.map((c, i) => (i < st.pileHidden ? -1 : c));
        }
        delete v.rng;
        v.me = seat;
        return v;
    }
    const people = st => st.seats.filter(p => !p.bot).length;

    // ---------------------------------------------------------------
    // the bots. They know what a person at the table would: their own hand
    // and every card played face up
    // ---------------------------------------------------------------
    function bySuit(hand) {
        const o = [[], [], [], []];
        for (const c of hand) o[suitOf(c)].push(c);
        o.forEach(a => a.sort((x, y) => rankOf(x) - rankOf(y)));
        return o;
    }
    // about how many tricks a hand takes with `T` as trumps
    function estimate(hand, T) {
        const s = bySuit(hand);
        let e = 0;
        for (let k = 0; k < 4; k++) {
            const a = s[k], len = a.length, has = r => a.some(c => rankOf(c) === r);
            if (k === T) {
                e += (has(14) ? 1 : 0) + (has(13) ? (len >= 2 ? 0.9 : 0.4) : 0) + (has(12) ? (len >= 3 ? 0.6 : 0.2) : 0);
                e += Math.max(0, len - 3) * 0.85;
            } else {
                e += (has(14) ? 0.95 : 0) + (has(13) && len >= 2 && len <= 5 ? 0.7 : 0) + (has(12) && len >= 3 && len <= 4 ? 0.3 : 0);
                if (T >= 0 && s[T].length >= 3) e += len === 0 ? 0.8 : len === 1 ? 0.4 : 0;
            }
        }
        return e;
    }
    function bestSuit(hand) {
        const s = bySuit(hand);
        let best = 0, bv = -1;
        for (let k = 0; k < 4; k++) { const v = estimate(hand, k) + s[k].length * 0.01; if (v > bv) { bv = v; best = k; } }
        return best;
    }
    // nothing outside my hand that has not been played beats it in its suit
    function master(st, hand, c) {
        const s = suitOf(c);
        for (let r = rankOf(c) + 1; r <= 14; r++) { const x = card(s, r); if (!hand.includes(x) && !st.played.includes(x)) return false; }
        return true;
    }
    // would c, played now, be winning the trick
    function wins(st, c) {
        if (!st.trick.length) return true;
        const T = st.trump;
        let best = st.trick[0].c;
        for (const t of st.trick) {
            const bs = suitOf(best), ts = suitOf(t.c);
            if (ts === bs) { if (rankOf(t.c) > rankOf(best)) best = t.c; }
            else if (ts === T) best = t.c;
        }
        const bs = suitOf(best), cs = suitOf(c);
        if (cs === bs) return rankOf(c) > rankOf(best);
        return T >= 0 && cs === T;
    }
    const lowFirst = (a, b) => rankOf(a) - rankOf(b);
    // the lowest card, not a trump if it can help it, from the shortest suit
    function lowest(cards, T, hand) {
        const lens = bySuit(hand).map(a => a.length);
        return cards.slice().sort((a, b) => ((suitOf(a) === T) - (suitOf(b) === T)) || rankOf(a) - rankOf(b) || lens[suitOf(a)] - lens[suitOf(b)])[0];
    }
    function trickBot(st, seat, cards) {
        const hand = st.hands[seat], T = st.trump;
        if (!st.trick.length) {
            const masters = cards.filter(c => master(st, hand, c));
            const side = masters.filter(c => suitOf(c) !== T);
            const myTrumps = hand.filter(c => suitOf(c) === T).length;
            // whoever named trumps, holding plenty, draws everybody else's first
            const named = (st.game === 'batak' && st.bidder === seat) || (st.game === 'king' && st.chooser === seat);
            const tm = masters.filter(c => suitOf(c) === T);
            if (named && tm.length && myTrumps >= 4) return tm.sort(lowFirst).pop();
            if (side.length) return side.sort(lowFirst).pop();
            if (masters.length) return masters.sort(lowFirst).pop();
            const lens = bySuit(hand).map(a => a.length);
            const pool = cards.filter(c => suitOf(c) !== T);
            const from = pool.length ? pool : cards;
            // a low card from the longest side suit
            return from.slice().sort((a, b) => lens[suitOf(b)] - lens[suitOf(a)] || rankOf(a) - rankOf(b))[0];
        }
        const winners = cards.filter(c => wins(st, c)).sort(lowFirst);
        const last = st.trick.length === st.n - 1;
        if (winners.length) {
            if (last) return winners[0];
            // a winner that will hold: a master, or a trump when trumps were not led
            const sure = winners.filter(c => master(st, hand, c) || (suitOf(c) === T && suitOf(st.trick[0].c) !== T));
            if (sure.length) return sure[0];
            if (rankOf(winners[0]) >= 12) return winners[0];
        }
        return lowest(cards, T, hand);
    }
    // how much a card hurts whoever takes it in the contract on now
    function harm(st, c) {
        const k = st.contract, r = rankOf(c), s = suitOf(c);
        if (k === 'kupa') return s === HEARTS ? 3 + r / 14 : r / 30;
        if (k === 'rifki') return c === KING_HEARTS ? 10 : s === HEARTS && r > 13 ? 4 : r / 30;
        if (k === 'kiz') return r === 12 ? 6 : r > 12 ? 2 + r / 14 : r / 30;
        if (k === 'erkek') return r === 11 || r === 13 ? 5 : r > 11 ? 2 : r / 30;
        return r / 14;
    }
    // a penalty contract: lose the tricks that hurt, and get rid of what hurts
    function penaltyBot(st, seat, cards) {
        if (cards.length === 1) return cards[0];
        // last two: the early tricks cost nothing, so they are for emptying the hand of winners
        if (st.contract === 'son' && st.trickNo < 9) return trickBot(st, seat, cards);
        if (!st.trick.length) return cards.slice().sort((a, b) => harm(st, a) - harm(st, b) || rankOf(a) - rankOf(b))[0];
        const L = suitOf(st.trick[0].c);
        const follow = cards.filter(c => suitOf(c) === L);
        if (follow.length) {
            let top = 0;
            for (const t of st.trick) if (suitOf(t.c) === L && rankOf(t.c) > top) top = rankOf(t.c);
            const under = follow.filter(c => rankOf(c) < top).sort(lowFirst);
            if (under.length) return under.pop();
            const last = st.trick.length === st.n - 1;
            const hurts = st.trick.some(t => harm(st, t.c) >= 2) || st.contract === 'el' || st.contract === 'son';
            // taking it anyway: last and harmless, so take it with the worst card
            if (last && !hurts) return follow.slice().sort((a, b) => harm(st, b) - harm(st, a) || rankOf(b) - rankOf(a))[0];
            if (last) return follow.slice().sort((a, b) => harm(st, a) - harm(st, b) || rankOf(b) - rankOf(a))[0];
            return follow.slice().sort(lowFirst)[0];
        }
        // void: throw what hurts most
        return cards.slice().sort((a, b) => harm(st, b) - harm(st, a) || rankOf(b) - rankOf(a))[0];
    }
    function pickBot(st, seat, opts) {
        const hand = st.hands[seat], s = bySuit(hand);
        const highs = hand.reduce((a, c) => a + Math.max(0, rankOf(c) - 9) / 5, 0);
        const shortHas = r => hand.filter(c => rankOf(c) === r && s[suitOf(c)].length <= 3).length;
        let best = opts[0], bv = -1e9;
        for (const o of opts) {
            let v;
            if (o.k === 'koz') v = (estimate(hand, bestSuit(hand)) - 3.25) * 60;
            else {
                let risk;
                if (o.k === 'el') risk = 50 * highs;
                else if (o.k === 'kupa') risk = 30 * (s[HEARTS].filter(c => rankOf(c) > 9).length * 1.6 + highs * 0.6);
                else if (o.k === 'erkek') risk = 60 * (shortHas(11) + shortHas(13)) * 0.9;
                else if (o.k === 'kiz') risk = 100 * shortHas(12) * 0.8;
                else if (o.k === 'rifki') risk = hand.includes(KING_HEARTS) ? (s[HEARTS].length <= 3 ? 280 : 120) : hand.includes(card(HEARTS, 14)) && s[HEARTS].length <= 2 ? 160 : 50;
                else risk = 180 * Math.min(2, hand.filter(c => rankOf(c) === 14).length * 0.4 + highs * 0.12);
                v = { el: 650, kupa: 390, erkek: 480, kiz: 400, rifki: 320, son: 360 }[o.k] / 4 - risk;
            }
            if (v > bv) { bv = v; best = o; }
        }
        return best;
    }
    function bidBot(st, seat, opts) {
        const hand = st.hands[seat];
        const want = Math.floor(estimate(hand, bestSuit(hand)) + 0.35);
        const pass = opts.find(o => o.v === 0);
        const can = opts.filter(o => o.v > 0 && o.v <= want);
        if (can.length) return can[0];
        return pass || opts.find(o => o.v > 0);
    }
    function pistiBot(st, seat) {
        const hand = st.hands[seat], pile = st.pile;
        const top = pile.length ? pile[pile.length - 1] : -1;
        const seen = new Array(15).fill(0);
        for (const c of st.played) seen[rankOf(c)]++;
        for (const c of hand) seen[rankOf(c)]++;
        if (top >= 0) {
            const match = hand.filter(c => rankOf(c) === rankOf(top));
            if (match.length) return match[0];
            const jacks = hand.filter(c => rankOf(c) === 11);
            let worth = pile.length * 0.25;
            for (const c of pile) if (c >= 0) worth += cardPoints(c);
            if (jacks.length && (worth >= 1.5 || pile.length >= 5 || hand.length === 1)) return jacks[0];
        }
        // throw what nobody is likely to answer, never a jack if it can help it
        const scored = hand.map(c => {
            const r = rankOf(c);
            let risk = (4 - seen[r]) + cardPoints(c) * 1.5 + (r === 11 ? 6 : 0);
            if (pile.length === 0) risk += (4 - seen[r]) * 1.5;   // an empty table: a pisti waiting to happen
            return { c, risk };
        }).sort((a, b) => a.risk - b.risk || rankOf(a.c) - rankOf(b.c));
        return scored[0].c;
    }
    // the bot's move for the seat whose turn it is, or null when it has none
    function bot(st, seat) {
        const opts = legal(st, seat);
        if (!opts.length) return null;
        if (st.phase === 'bid') return bidBot(st, seat, opts);
        if (st.phase === 'trump') return { t: 'trump', s: bestSuit(st.hands[seat]) };
        if (st.phase === 'pick') return pickBot(st, seat, opts);
        if (st.game === 'pisti') return { t: 'play', c: pistiBot(st, seat) };
        const cards = opts.map(o => o.c);
        const c = st.game === 'king' && st.contract !== 'koz' ? penaltyBot(st, seat, cards) : trickBot(st, seat, cards);
        return { t: 'play', c: cards.includes(c) ? c : cards[0] };
    }

    // ---------------------------------------------------------------
    // a guest's word is read, then checked, before it is believed
    // ---------------------------------------------------------------
    function readAction(d) {
        if (!d || typeof d !== 'object') return null;
        const t = String(d.t || '');
        if (!['bid', 'trump', 'pick', 'play'].includes(t)) return null;
        const a = { t };
        for (const k of ['v', 's', 'c']) {
            if (d[k] === undefined) continue;
            if (!Number.isInteger(d[k]) || d[k] < 0 || d[k] > 51) return null;
            a[k] = d[k];
        }
        if (d.k !== undefined) { if (typeof d.k !== 'string' || !Object.prototype.hasOwnProperty.call(CONTRACT, d.k)) return null; a.k = d.k; }
        return a;
    }
    // somebody walked out: a bot plays on in their seat
    function seatBot(st, seat) {
        const p = st.seats[seat];
        if (!p || p.bot) return false;
        p.bot = true;
        p.left = true;
        ev(st, { e: 'left', s: seat });
        return true;
    }

    const API = {
        SUIT_GLYPH, SUIT_NAME, RANK_LABEL, GAMES, CONTRACTS, CONTRACT, PENALTIES, BOT_NAMES, KING_HEARTS,
        suitOf, rankOf, card, label, cardPoints, teamOf, seatCount,
        newMatch, legal, isLegal, act, advance, view, bot, readAction, seatBot, people, playable, trickWinner, estimate, bestSuit
    };
    root.KZ_SIM = API;
    if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
