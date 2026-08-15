// ===================================================================
// JOKERZ 98 — engine
//
// A Balatro-like poker roguelike deckbuilder. Content lives in
// balatro-data.js; this file is the rules engine and the UI.
//
// The scoring pipeline is the whole game, and it runs in this order:
//   1. base chips/mult from the poker hand at its current level
//   2. boss blind modifiers
//   3. onPlay joker hooks (can mutate the hand before it scores)
//   4. each scoring card, left to right, with retriggers:
//        card chips -> enhancement -> edition -> seal -> joker scored()
//   5. each card still held in hand, with retriggers
//   6. joker indep() effects, left to right
//   7. chips x mult
// ===================================================================

let BG = null;               // the active run
let balWinBody = null;       // the app window body we render into
let balSuppressRender = false; // true while a scoring animation owns the DOM
let balAnimating = false;      // re-entrancy guard for the play-hand flow

// ---------- rng ----------
// a seeded PRNG so a run can be replayed from its seed string
let balRngState = 1;
function balSeedFrom(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
}
function balRand() {
    balRngState = (balRngState + 0x6D2B79F5) | 0;
    let t = balRngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function balRandInt(n) { return Math.floor(balRand() * n); }
function balPick(arr) { return arr[balRandInt(arr.length)]; }
function balShuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = balRandInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
function balNewSeed() {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';
    return Array.from({ length: 8 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
}

// ---------- ids & cards ----------
let balUidN = 0;
function balUid() { return `u${++balUidN}`; }

function balMakeCard(rank, suit) {
    return { uid: balUid(), rank, suit, enhancement: null, edition: null, seal: null, bonusChips: 0 };
}
function balCloneCard(c) {
    return { ...c, uid: balUid() };
}
function balIsRed(c) { return BAL.SUITS[c.suit].red; }
function balRandomRank() { return 2 + balRandInt(13); }

// base chip value of a card's rank
function balChipsOf(card) {
    if (card.enhancement === 'stone') return 0;
    const r = card.rank;
    return (r <= 10 ? r : r === 14 ? 11 : 10) + (card.bonusChips || 0);
}

function balHasJoker(g, id) { return g.jokers.some(j => j.def.id === id && !j.disabled); }
function balHasVoucher(g, id) { return g.vouchers.includes(id); }

// face cards, unless Pareidolia says everything is a face card
function balIsFace(card, g) {
    if (card.enhancement === 'stone') return false;
    if (g && balHasJoker(g, 'pareidolia')) return true;
    return card.rank >= 11 && card.rank <= 13;
}

// does a card count as the given suit? wild cards are every suit,
// and Smeared Joker merges the two red suits and the two black suits
function balSuit(card, suit, g) {
    if (!card || card.enhancement === 'stone') return false;
    if (card.enhancement === 'wild') return true;
    if (card.suit === suit) return true;
    if (g && balHasJoker(g, 'smeared')) {
        const red = BAL.SUITS[suit].red;
        return BAL.SUITS[card.suit].red === red;
    }
    return false;
}

// "1 in 4" style rolls, doubled by Oops! All 6s
function balChance(g, num, den) {
    let n = num;
    if (g) g.jokers.forEach(j => { if (j.def.id === 'oops' && !j.disabled) n *= 2; });
    return balRand() < Math.min(1, n / den);
}

// ---------- slots & values ----------
function balJokerSlots(g) {
    let n = 5;
    if (g.deckId === 'black') n += 1;
    if (g.deckId === 'painted') n -= 1;
    if (balHasVoucher(g, 'antimatter')) n += 1;
    n += g.jokers.filter(j => j.edition === 'negative').length;
    return n;
}
function balConsumableSlots(g) {
    let n = 2;
    if (balHasVoucher(g, 'crystal_ball')) n += 1;
    if (g.deckId === 'nebula') n -= 1;
    n += g.consumables.filter(c => c.negative).length;
    return n;
}
function balSellValue(j) {
    const base = Math.max(1, Math.floor((j.def ? j.def.cost : j.cost || 3) / 2));
    return base + (j.extraValue || 0);
}
function balHandSize(g) {
    let n = 8;
    if (g.deckId === 'painted') n += 2;
    if (balHasVoucher(g, 'paint_brush')) n += 1;
    if (balHasVoucher(g, 'palette')) n += 1;
    n += g.handSizeMod || 0;
    g.jokers.forEach(j => {
        if (j.disabled) return;
        if (j.def.handSizeFn) n += j.def.handSizeFn(j);
        else if (j.def.handSize) n += j.def.handSize;
    });
    if (g.blindIndex === 2 && balBossActive(g, 'manacle')) n -= 1;
    if (g.blindIndex === 2 && balBossActive(g, 'lowmem')) n -= 2;
    n += g.tempHandSize || 0;
    return Math.max(1, n);
}
function balMaxHands(g) {
    let n = 4;
    if (g.deckId === 'blue') n += 1;
    if (g.deckId === 'black') n -= 1;
    if (balHasVoucher(g, 'grabber')) n += 1;
    if (balHasVoucher(g, 'nacho_tong')) n += 1;
    if (balHasVoucher(g, 'hieroglyph')) n -= 1;
    g.jokers.forEach(j => { if (!j.disabled && j.def.hands) n += j.def.hands; });
    if (g.blindIndex === 2 && balBossActive(g, 'needle')) n = 1;
    if (g.blindIndex === 2 && balBossActive(g, 'lowmem')) n += 1;
    return Math.max(1, n);
}
function balMaxDiscards(g) {
    let n = 3;
    if (g.deckId === 'red') n += 1;
    if (balHasVoucher(g, 'wasteful')) n += 1;
    if (balHasVoucher(g, 'recyclomancy')) n += 1;
    if (balHasVoucher(g, 'petroglyph')) n -= 1;
    if (g.stake >= 5) n -= 1;
    g.jokers.forEach(j => { if (!j.disabled && j.def.discards) n += j.def.discards; });
    if (g.blindIndex === 2 && balBossActive(g, 'water')) n = 0;
    if (g.blindIndex === 2 && balBossActive(g, 'lag')) n += 1;
    return Math.max(0, n);
}

// is the current boss ability live? Chicot and Luchador switch it off
function balBossActive(g, id) {
    if (g.blindIndex !== 2 || !g.bossId) return false;
    if (g.bossDisabled) return false;
    if (balHasJoker(g, 'chicot')) return false;
    return g.bossId === id;
}
function balCurrentBoss(g) {
    return BAL.BOSSES.find(b => b.id === g.bossId) || null;
}

// ---------- hand levels & stats ----------
function balLevelUp(g, key, n) {
    g.handLevels[key] = Math.max(1, (g.handLevels[key] || 1) + n);
}
function balHandValues(g, key) {
    const h = BAL.HANDS[key];
    const lvl = g.handLevels[key] || 1;
    return { chips: h.chips + (lvl - 1) * h.lc, mult: h.mult + (lvl - 1) * h.lm, level: lvl };
}
function balMostPlayedHand(g) {
    let best = 'high_card', n = -1;
    Object.keys(BAL.HANDS).forEach(k => { const v = g.handPlays[k] || 0; if (v > n) { n = v; best = k; } });
    return best;
}
function balLeastPlayedHand(g) {
    let best = 'high_card', n = Infinity;
    Object.keys(BAL.HANDS).forEach(k => { const v = g.handPlays[k] || 0; if (v < n) { n = v; best = k; } });
    return best;
}
function balRandomHandKey() { return balPick(Object.keys(BAL.HANDS)); }

// ===================================================================
// hand evaluation
// ===================================================================
function balEvaluate(g, cards) {
    const parts = {};
    const stones = cards.filter(c => c.enhancement === 'stone');
    const ranked = cards.filter(c => c.enhancement !== 'stone');

    const fourFingers = balHasJoker(g, 'four_fingers');
    const need = fourFingers ? 4 : 5;
    const shortcut = balHasJoker(g, 'shortcut');

    // --- rank groups ---
    const byRank = {};
    ranked.forEach(c => { (byRank[c.rank] = byRank[c.rank] || []).push(c); });
    const groups = Object.keys(byRank).map(r => ({ rank: +r, cards: byRank[r] }))
        .sort((a, b) => b.cards.length - a.cards.length || b.rank - a.rank);

    const withAtLeast = n => groups.filter(gr => gr.cards.length >= n);
    parts.pair = withAtLeast(2).length >= 1;
    parts.two_pair = withAtLeast(2).length >= 2 || withAtLeast(4).length >= 1;
    parts.three = withAtLeast(3).length >= 1;
    parts.four = withAtLeast(4).length >= 1;
    parts.five = withAtLeast(5).length >= 1;
    parts.full_house = parts.three && (withAtLeast(2).length >= 2);

    // --- flush ---
    let flushCards = null;
    for (let s = 0; s < 4; s++) {
        const m = ranked.filter(c => balSuit(c, s, g));
        if (m.length >= need && m.length >= ranked.length - (fourFingers ? 1 : 0)) {
            // every ranked card must be in the flush, minus the one Four Fingers lets you drop
            if (m.length > (flushCards ? flushCards.length : 0)) flushCards = m;
        }
    }
    parts.flush = !!flushCards;

    // --- straight ---
    const straightCards = balFindStraight(ranked, need, shortcut);
    parts.straight = !!straightCards;
    parts.straight_flush = parts.straight && parts.flush;

    // --- pick the best hand ---
    let key, scoring;
    if (parts.five && parts.flush) { key = 'flush_five'; scoring = ranked.slice(); }
    else if (parts.full_house && parts.flush) { key = 'flush_house'; scoring = ranked.slice(); }
    else if (parts.five) { key = 'five'; scoring = ranked.slice(); }
    else if (parts.straight_flush) { key = 'straight_flush'; scoring = ranked.slice(); }
    else if (parts.four) { key = 'four'; scoring = withAtLeast(4)[0].cards.slice(0, 4); }
    else if (parts.full_house) { key = 'full_house'; scoring = ranked.slice(); }
    else if (parts.flush) { key = 'flush'; scoring = flushCards.slice(); }
    else if (parts.straight) { key = 'straight'; scoring = straightCards.slice(); }
    else if (parts.three) { key = 'three'; scoring = withAtLeast(3)[0].cards.slice(0, 3); }
    else if (parts.two_pair) {
        key = 'two_pair';
        const pairs = withAtLeast(2).slice(0, 2);
        scoring = pairs.flatMap(p => p.cards.slice(0, 2));
    }
    else if (parts.pair) { key = 'pair'; scoring = withAtLeast(2)[0].cards.slice(0, 2); }
    else {
        key = 'high_card';
        scoring = ranked.length ? [ranked.reduce((a, b) => b.rank > a.rank ? b : a)] : [];
    }

    // stone cards always score, and Splash makes everything score
    if (balHasJoker(g, 'splash')) scoring = cards.slice();
    else scoring = scoring.concat(stones);

    // keep the played order so left-to-right scoring is honest
    const order = new Map(cards.map((c, i) => [c.uid, i]));
    scoring = [...new Set(scoring)].sort((a, b) => order.get(a.uid) - order.get(b.uid));

    return { key, scoring, parts };
}

// longest run of consecutive ranks, treating Ace as high and low
function balFindStraight(ranked, need, shortcut) {
    if (ranked.length < need) return null;
    const byRank = new Map();
    ranked.forEach(c => { if (!byRank.has(c.rank)) byRank.set(c.rank, c); });
    // an Ace can also sit below a 2
    if (byRank.has(14)) byRank.set(1, byRank.get(14));

    const ranks = [...byRank.keys()].sort((a, b) => a - b);
    const maxGap = shortcut ? 2 : 1;

    let best = null;
    for (let i = 0; i < ranks.length; i++) {
        const run = [ranks[i]];
        for (let j = i + 1; j < ranks.length; j++) {
            const gap = ranks[j] - run[run.length - 1];
            if (gap >= 1 && gap <= maxGap) run.push(ranks[j]);
            else if (gap > maxGap) break;
        }
        if (run.length >= need && (!best || run.length > best.length)) best = run;
    }
    if (!best) return null;
    // every played card has to belong to the straight, minus what Four Fingers forgives
    const cards = best.map(r => byRank.get(r));
    const unique = [...new Set(cards)];
    if (unique.length < need) return null;
    if (ranked.length - unique.length > (need === 4 ? 1 : 0)) return null;
    return unique;
}

// ===================================================================
// joker resolution — Blueprint and Brainstorm copy other jokers
// ===================================================================
function balEffective(g, joker, depth) {
    depth = depth || 0;
    const d = joker.def;
    if (depth > 4) return { def: null, self: joker };
    if (d.copy) {
        const i = g.jokers.indexOf(joker);
        const t = g.jokers[i + d.copy];
        if (!t || t.disabled) return { def: null, self: joker };
        return balEffective(g, t, depth + 1);
    }
    if (d.copyLeftmost) {
        const t = g.jokers[0];
        if (!t || t === joker || t.disabled) return { def: null, self: joker };
        return balEffective(g, t, depth + 1);
    }
    return { def: d, self: joker };
}

// walk the jokers in board order, calling `fn(def, stateJoker, holder)`
function balEachJoker(g, fn) {
    g.jokers.slice().forEach(j => {
        if (j.disabled || j.debuffed) return;
        const e = balEffective(g, j);
        if (!e.def) return;
        fn(e.def, e.self, j);
    });
}

// ===================================================================
// scoring
// ===================================================================
function balScoreHand(g, played) {
    const ev = balEvaluate(g, played);
    const held = g.hand.filter(c => !played.includes(c));
    const vals = balHandValues(g, ev.key);

    const ctx = {
        g, handKey: ev.key, played, scoring: ev.scoring, held,
        parts: ev.parts, chips: vals.chips, mult: vals.mult,
        money: 0, log: [], destroyPlayed: [], after: null, self: null
    };
    ctx.log.push({ t: BAL.HANDS[ev.key].name, v: `lvl ${vals.level}`, chips: ctx.chips, mult: ctx.mult });

    // --- boss modifiers on the base numbers ---
    if (balBossActive(g, 'flint')) {
        ctx.chips = Math.ceil(ctx.chips / 2);
        ctx.mult = Math.ceil(ctx.mult / 2);
        g.bossTriggeredThisHand = true;
    }
    if (balBossActive(g, 'arm')) {
        balLevelUp(g, ev.key, -1);
        g.bossTriggeredThisHand = true;
    }

    // --- onPlay hooks (may mutate ctx or the cards) ---
    const afters = [];
    balEachJoker(g, (def, self) => {
        if (!def.onPlay) return;
        ctx.self = self; ctx.after = null;
        def.onPlay(ctx);
        if (ctx.after) { afters.push(ctx.after); ctx.after = null; }
    });

    // --- Observatory: held Planet cards boost their own hand ---
    if (balHasVoucher(g, 'observatory')) {
        g.consumables.forEach(c => {
            if (c.kind === 'planet') {
                const p = BAL.PLANETS.find(x => x.id === c.id);
                if (p && p.hand === ev.key) { ctx.mult *= 1.5; ctx.log.push({ t: 'Observatory', v: 'X1.5', chips: ctx.chips, mult: ctx.mult }); }
            }
        });
    }

    // --- scoring cards, left to right ---
    ev.scoring.forEach(card => {
        if (card.debuffed) { ctx.log.push({ t: balCardLabel(card), v: 'debuffed', chips: ctx.chips, mult: ctx.mult }); return; }

        let triggers = 1;
        if (card.seal === 'red') triggers += 1;
        balEachJoker(g, (def, self) => {
            if (def.retrigger) { ctx.self = self; triggers += def.retrigger(ctx, card) || 0; }
        });

        for (let t = 0; t < triggers; t++) {
            const base = balChipsOf(card);
            if (base) { ctx.chips += base; ctx.log.push({ t: balCardLabel(card), v: `+${base}`, chips: ctx.chips, mult: ctx.mult }); }

            switch (card.enhancement) {
                case 'bonus': ctx.chips += 30; ctx.log.push({ t: 'Bonus', v: '+30', chips: ctx.chips, mult: ctx.mult }); break;
                case 'mult': ctx.mult += 4; ctx.log.push({ t: 'Mult Card', v: '+4', chips: ctx.chips, mult: ctx.mult }); break;
                case 'stone': ctx.chips += 50; ctx.log.push({ t: 'Stone', v: '+50', chips: ctx.chips, mult: ctx.mult }); break;
                case 'glass': ctx.mult *= 2; ctx.log.push({ t: 'Glass', v: 'X2', chips: ctx.chips, mult: ctx.mult }); break;
                case 'lucky': {
                    if (balChance(g, 1, 5)) {
                        ctx.mult += 20; ctx.log.push({ t: 'Lucky!', v: '+20', chips: ctx.chips, mult: ctx.mult });
                        balEachJoker(g, (d2, s2) => { if (d2.id === 'lucky_cat') s2.counter += 1; });
                    }
                    if (balChance(g, 1, 15)) { ctx.money += 20; ctx.log.push({ t: 'Lucky!', v: '+$20', chips: ctx.chips, mult: ctx.mult }); }
                    break;
                }
            }
            switch (card.edition) {
                case 'foil': ctx.chips += 50; ctx.log.push({ t: 'Foil', v: '+50', chips: ctx.chips, mult: ctx.mult }); break;
                case 'holo': ctx.mult += 10; ctx.log.push({ t: 'Holo', v: '+10', chips: ctx.chips, mult: ctx.mult }); break;
                case 'poly': ctx.mult *= 1.5; ctx.log.push({ t: 'Poly', v: 'X1.5', chips: ctx.chips, mult: ctx.mult }); break;
            }
            if (card.seal === 'gold') { ctx.money += 3; ctx.log.push({ t: 'Gold Seal', v: '+$3', chips: ctx.chips, mult: ctx.mult }); }

            balEachJoker(g, (def, self) => {
                if (!def.scored) return;
                ctx.self = self;
                balApply(ctx, def.scored(ctx, card), def.name);
            });
        }
    });

    // --- cards held in hand ---
    held.forEach(card => {
        if (card.debuffed) return;
        let triggers = 1;
        if (card.seal === 'red') triggers += 1;
        balEachJoker(g, (def, self) => {
            if (def.heldRetrigger) { ctx.self = self; triggers += def.heldRetrigger(ctx, card) || 0; }
        });
        for (let t = 0; t < triggers; t++) {
            if (card.enhancement === 'steel') { ctx.mult *= 1.5; ctx.log.push({ t: 'Steel', v: 'X1.5', chips: ctx.chips, mult: ctx.mult }); }
            balEachJoker(g, (def, self) => {
                if (!def.held) return;
                ctx.self = self;
                balApply(ctx, def.held(ctx, card), def.name);
            });
        }
    });

    // --- independent joker effects, left to right ---
    balEachJoker(g, (def, self) => {
        if (!def.indep) return;
        ctx.self = self;
        balApply(ctx, def.indep(ctx), def.name);
        if (self.edition === 'foil') { ctx.chips += 50; ctx.log.push({ t: 'Foil Joker', v: '+50', chips: ctx.chips, mult: ctx.mult }); }
        if (self.edition === 'holo') { ctx.mult += 10; ctx.log.push({ t: 'Holo Joker', v: '+10', chips: ctx.chips, mult: ctx.mult }); }
        if (self.edition === 'poly') { ctx.mult *= 1.5; ctx.log.push({ t: 'Poly Joker', v: 'X1.5', chips: ctx.chips, mult: ctx.mult }); }
    });

    afters.forEach(fn => fn());

    // --- Plasma deck balances the two halves before multiplying ---
    if (g.deckId === 'plasma') {
        const avg = (ctx.chips + ctx.mult) / 2;
        ctx.chips = avg; ctx.mult = avg;
        ctx.log.push({ t: 'Plasma', v: 'balanced', chips: ctx.chips, mult: ctx.mult });
    }

    ctx.mult = Math.max(0, ctx.mult);
    ctx.chips = Math.max(0, ctx.chips);
    ctx.total = Math.floor(ctx.chips * ctx.mult);
    return ctx;
}

// fold one effect result into the running score
function balApply(ctx, r, name) {
    if (!r) return;
    if (r.chips) { ctx.chips += r.chips; ctx.log.push({ t: name, v: `+${r.chips}`, chips: ctx.chips, mult: ctx.mult }); }
    if (r.mult) { ctx.mult += r.mult; ctx.log.push({ t: name, v: `+${r.mult}`, chips: ctx.chips, mult: ctx.mult }); }
    if (r.xmult !== undefined && r.xmult !== 1) { ctx.mult *= r.xmult; ctx.log.push({ t: name, v: `X${r.xmult}`, chips: ctx.chips, mult: ctx.mult }); }
    if (r.money) { ctx.money += r.money; ctx.log.push({ t: name, v: `+$${r.money}`, chips: ctx.chips, mult: ctx.mult }); }
    if (r.create) { balCreateConsumable(ctx.g, r.create); }
    if (r.msg) ctx.log.push({ t: name, v: r.msg, chips: ctx.chips, mult: ctx.mult });
}

function balCardLabel(c) {
    if (c.enhancement === 'stone') return 'Stone';
    return BAL.RANK_LABEL[c.rank] + BAL.SUITS[c.suit].glyph;
}

// ===================================================================
// creation helpers (the data file calls into these)
// ===================================================================
function balToast(g, title, msg) {
    (g.messages = g.messages || []).push({ title, msg });
    if (typeof showToast === 'function') showToast(title, msg);
}

function balAddJoker(g, def, opts) {
    opts = opts || {};
    if (g.jokers.length >= balJokerSlots(g) && opts.edition !== 'negative') return null;
    const j = {
        uid: balUid(), def, counter: def.counter || 0, extraValue: 0,
        edition: opts.edition || null, eternal: !!opts.eternal, perishable: !!opts.perishable,
        rental: !!opts.rental, roundsLeft: opts.perishable ? 5 : 0, disabled: false, debuffed: false
    };
    if (def.init) def.init(j);
    g.jokers.push(j);
    return j;
}

// weighted rarity roll: 70% common, 25% uncommon, 5% rare
function balRollRarity() {
    const r = balRand();
    return r < 0.70 ? 1 : r < 0.95 ? 2 : 3;
}
function balJokerPool(g, rarity) {
    const owned = new Set(g.jokers.map(j => j.def.id));
    const showman = balHasJoker(g, 'showman');
    return BAL.JOKERS.filter(d => d.rarity === rarity && (showman || !owned.has(d.id)));
}
function balCreateJoker(g, rarity, opts) {
    const r = rarity || balRollRarity();
    let pool = balJokerPool(g, r);
    if (!pool.length) pool = balJokerPool(g, 1);
    if (!pool.length) return null;
    return balAddJoker(g, balPick(pool), opts);
}

function balMakeConsumable(kind, id) {
    let src;
    if (kind === 'tarot') src = BAL.TAROTS.find(t => t.id === id);
    else if (kind === 'planet') src = BAL.PLANETS.find(t => t.id === id);
    else src = BAL.SPECTRALS.find(t => t.id === id);
    if (!src) return null;
    return { uid: balUid(), kind, id: src.id, name: src.name, cost: src.cost || (kind === 'spectral' ? 4 : 3), extraValue: 0, negative: false };
}
function balRandomConsumable(g, kind) {
    let pool;
    if (kind === 'tarot') pool = BAL.TAROTS;
    else if (kind === 'planet') pool = BAL.PLANETS.filter(p => !p.secret || (g.handPlays[p.hand] > 0));
    else pool = BAL.SPECTRALS.filter(s => !s.secret);
    if (!balHasJoker(g, 'showman')) {
        const owned = new Set(g.consumables.filter(c => c.kind === kind).map(c => c.id));
        const fresh = pool.filter(p => !owned.has(p.id));
        if (fresh.length) pool = fresh;
    }
    return balMakeConsumable(kind, balPick(pool).id);
}
function balCreateConsumable(g, kind) {
    if (g.consumables.length >= balConsumableSlots(g)) return null;
    const c = balRandomConsumable(g, kind);
    if (c) g.consumables.push(c);
    return c;
}

function balRemoveFromDeck(g, card) {
    [g.deck, g.hand, g.drawPile, g.discardPile].forEach(pile => {
        const i = pile.indexOf(card);
        if (i >= 0) pile.splice(i, 1);
    });
    if (balIsFace(card, g)) balEachJoker(g, (d, s) => { if (d.id === 'canio') s.counter += 1; });
}

// ===================================================================
// run setup
// ===================================================================
function balBuildDeck(deckId) {
    const deck = [];
    if (deckId === 'checkered') {
        // 26 spades and 26 hearts instead of the usual four suits
        [0, 1].forEach(s => { for (let r = 2; r <= 14; r++) { deck.push(balMakeCard(r, s)); deck.push(balMakeCard(r, s)); } });
        return deck;
    }
    for (let s = 0; s < 4; s++) {
        for (let r = 2; r <= 14; r++) {
            if (deckId === 'abandoned' && r >= 11 && r <= 13) continue;
            if (deckId === 'floppy' && r === 2) continue;
            deck.push(balMakeCard(r, s));
        }
    }
    if (deckId === 'erratic') deck.forEach(c => { c.rank = balRandomRank(); c.suit = balRandInt(4); });
    if (deckId === 'dither') {
        const enh = Object.keys(BAL.ENHANCEMENTS);
        balShuffle(deck.slice()).slice(0, 8).forEach(c => { c.enhancement = balPick(enh); });
    }
    return deck;
}

function balNewRun(deckId, stake, seed) {
    seed = (seed || balNewSeed()).toUpperCase();
    balRngState = balSeedFrom(seed);

    const g = {
        seed, deckId, stake: stake || 1,
        ante: 1, round: 1, blindIndex: 0, bossId: null, bossDisabled: false,
        money: 4, score: 0, required: 0,
        hands: 0, discards: 0,
        deck: balBuildDeck(deckId), drawPile: [], hand: [], discardPile: [], played: [],
        jokers: [], consumables: [], vouchers: [],
        handLevels: {}, handPlays: {},
        selected: [], sortMode: 'rank',
        handsPlayedThisRound: 0, discardsUsedThisRound: 0, roundHands: [],
        antePlayedUids: [], pendingHandCards: [], pendingTags: [], activeTags: [],
        handSizeMod: 0, tempHandSize: 0, bossTriggeredThisHand: false,
        shop: null, pack: null, screen: 'blind', lastConsumable: null,
        stats: { tarotsUsed: 0, planetsUsed: 0, uniquePlanets: new Set(), blindsSkipped: 0, cardsSold: 0, handsPlayed: 0, bestHandScore: 0 },
        log: [], won: false, over: false
    };
    Object.keys(BAL.HANDS).forEach(k => { g.handLevels[k] = deckId === 'floppy' ? 2 : 1; g.handPlays[k] = 0; });

    if (deckId === 'yellow') g.money += 10;
    if (deckId === 'dither') g.money -= 4;
    if (deckId === 'magic') { g.vouchers.push('crystal_ball'); g.consumables.push(balMakeConsumable('tarot', 'fool'), balMakeConsumable('tarot', 'fool')); }
    if (deckId === 'nebula') g.vouchers.push('telescope');
    if (deckId === 'ghost') g.consumables.push(balMakeConsumable('spectral', 'hex'));
    if (deckId === 'zodiac') g.vouchers.push('tarot_merchant', 'planet_merchant', 'overstock');
    g.startingDeckSize = g.deck.length;

    balRollBoss(g);
    BG = g;
    return g;
}

function balRollBoss(g) {
    const finisher = g.ante % 8 === 0;
    let pool = BAL.BOSSES.filter(b => !!b.finisher === finisher);
    const seen = g.seenBosses || (g.seenBosses = []);
    const fresh = pool.filter(b => !seen.includes(b.id));
    if (fresh.length) pool = fresh;
    g.bossId = balPick(pool).id;
    g.bossDisabled = false;
}

// ===================================================================
// blinds
// ===================================================================
const BAL_BLIND_NAMES = ['Small Blind', 'Big Blind'];
const BAL_BLIND_MULT = [1, 1.5];
const BAL_BLIND_REWARD = [3, 4, 5];

function balBlindInfo(g, index) {
    const base = BAL.anteBase(g.ante, g.stake);
    if (index === 2) {
        const boss = balCurrentBoss(g);
        return { name: boss ? boss.name : 'Boss Blind', mult: boss ? boss.mult : 2, req: Math.round(base * (boss ? boss.mult : 2)), reward: 5, text: boss ? boss.text : '' };
    }
    return { name: BAL_BLIND_NAMES[index], mult: BAL_BLIND_MULT[index], req: Math.round(base * BAL_BLIND_MULT[index]), reward: BAL_BLIND_REWARD[index], text: '' };
}

function balSelectBlind() {
    const g = BG;
    balSfx('blindselect');
    const info = balBlindInfo(g, g.blindIndex);
    g.required = info.req * (g.deckId === 'plasma' ? 2 : 1);
    g.score = 0;
    g.handsPlayedThisRound = 0;
    g.discardsUsedThisRound = 0;
    g.roundHands = [];
    g.tempHandSize = 0;
    g.bossDisabled = false;
    g.selected = [];
    g.messages = [];

    // consume any tags that were banked from skipping
    balConsumeTags(g);

    g.hands = balMaxHands(g);
    g.discards = balMaxDiscards(g);
    g.handsMax = g.hands;
    g.discardsMax = g.discards;

    balEachJoker(g, (def, self) => { if (def.onBlindStart) def.onBlindStart(g, self); });

    // reshuffle the whole deck for the round
    g.drawPile = balShuffle(g.deck.slice());
    g.hand = [];
    g.discardPile = [];
    g.played = [];
    balDrawToFull(g, true);
    g.screen = 'play';
    balRender();
}

function balSkipBlind() {
    const g = BG;
    if (g.blindIndex === 2) return;
    balSfx('take');
    g.stats.blindsSkipped++;
    const tag = balPick(BAL.TAGS).id;
    g.pendingTags.push(tag);
    balToast(g, 'Blind skipped', BAL.TAGS.find(t => t.id === tag).name);
    balAdvanceBlind(g, true);
    balRender();
}

function balConsumeTags(g) {
    const tags = g.pendingTags.splice(0);
    let doubleNext = false;
    tags.forEach(id => {
        const apply = () => {
            switch (id) {
                case 'investment': g.investmentTag = true; break;
                case 'handy': g.money += g.stats.handsPlayed; break;
                case 'garbage': g.money += g.stats.unusedDiscards || 0; break;
                case 'economy': g.money += Math.min(40, Math.max(0, g.money)); break;
                case 'juggle': g.tempHandSize += 3; break;
                case 'boss': balRollBoss(g); break;
                case 'uncommon': g.shopFreeJoker = 2; break;
                case 'rare': g.shopFreeJoker = 3; break;
                case 'foil': case 'holo': case 'poly': g.shopEdition = id; break;
                case 'voucher': g.shopExtraVoucher = true; break;
                case 'coupon': g.shopCoupon = true; break;
                case 'd6': g.shopFreeRerolls = true; break;
                case 'standard': g.pendingPack = 'standard_m'; break;
                case 'charm': g.pendingPack = 'arcana_m'; break;
                case 'meteor': g.pendingPack = 'celestial_m'; break;
                case 'buffoon': g.pendingPack = 'buffoon_m'; break;
                case 'ethereal': g.pendingPack = 'spectral'; break;
            }
        };
        if (id === 'double') { doubleNext = true; return; }
        apply();
        if (doubleNext) { apply(); doubleNext = false; }
    });
}

function balAdvanceBlind(g, skipped) {
    if (g.blindIndex === 2) {
        g.ante++;
        g.blindIndex = 0;
        balRollBoss(g);
    } else {
        g.blindIndex++;
    }
    g.round++;
    if (!skipped) g.screen = 'shop';
}

// ===================================================================
// drawing and debuffs
// ===================================================================
function balDrawToFull(g, firstDraw) {
    const size = balHandSize(g);
    const dealt = [];
    while (g.hand.length < size && g.drawPile.length) {
        const c = g.drawPile.pop();
        c.faceDown = false;
        g.hand.push(c);
        dealt.push(c.uid);
    }
    // cards jokers asked to be dealt straight into hand
    while (g.pendingHandCards.length && g.hand.length < size + 2) {
        const c = g.pendingHandCards.shift();
        g.hand.push(c);
        dealt.push(c.uid);
    }
    // whatever came off the deck gets flown in when the table next
    // renders — balDiscard adds to this rather than replacing it, since
    // a discard and a draw are one move to the player
    if (dealt.length) g.pendingDeal = (g.pendingDeal || []).concat(dealt);
    balApplyFaceDown(g, firstDraw);
    balApplyDebuffs(g);
    balSortHand(g);
}

function balApplyFaceDown(g, firstDraw) {
    g.hand.forEach(c => {
        if (balBossActive(g, 'house') && firstDraw) c.faceDown = true;
        else if (balBossActive(g, 'wheel') && balChance(g, 1, 7)) c.faceDown = true;
        else if (balBossActive(g, 'mark') && balIsFace(c, g)) c.faceDown = true;
        else if (balBossActive(g, 'fish') && !firstDraw && g.handsPlayedThisRound > 0) c.faceDown = true;
    });
}

function balApplyDebuffs(g) {
    const all = g.deck;
    all.forEach(c => { c.debuffed = false; });
    if (g.blindIndex !== 2 || g.bossDisabled || balHasJoker(g, 'chicot')) return;
    const boss = balCurrentBoss(g);
    if (!boss) return;
    let hit = false;
    all.forEach(c => {
        if (boss.debuffSuit !== undefined && c.suit === boss.debuffSuit) { c.debuffed = true; hit = true; }
        if (boss.debuffFace && balIsFace(c, g)) { c.debuffed = true; hit = true; }
        if (boss.id === 'pillar' && g.antePlayedUids.includes(c.uid)) { c.debuffed = true; hit = true; }
        if (boss.id === 'leaf' && !g.leafCleared) { c.debuffed = true; hit = true; }
    });
    if (hit) g.bossTriggeredThisHand = true;
    if (boss.id === 'bsod' && g.jokers[0]) g.jokers[0].disabled = true;
}

function balSortHand(g) {
    if (g.sortMode === 'rank') g.hand.sort((a, b) => b.rank - a.rank || a.suit - b.suit);
    else g.hand.sort((a, b) => a.suit - b.suit || b.rank - a.rank);
}

// ===================================================================
// playing a hand
// ===================================================================
function balCanPlay(g) {
    const n = g.selected.length;
    if (n < 1 || n > 5) return 'select 1 to 5 cards';
    if (g.hands <= 0) return 'no hands left';
    if (balBossActive(g, 'psychic') && n !== 5) return 'The Psychic: must play 5 cards';
    const ev = balEvaluate(g, g.selected);
    if (balBossActive(g, 'eye') && g.roundHands.includes(ev.key)) return 'The Eye: no repeat hand types';
    if (balBossActive(g, 'mouth') && g.roundHands.length && g.roundHands[0] !== ev.key) return 'The Mouth: one hand type only';
    if (balBossActive(g, 'bell') && g.forcedCard && !g.selected.includes(g.forcedCard)) return 'Cerulean Bell: that card must be played';
    return null;
}

function balPlayHand() {
    const g = BG;
    const err = balCanPlay(g);
    if (err) { balToast(g, 'jokerz', err); return; }

    g.bossTriggeredThisHand = false;
    const played = g.selected.slice();
    const ctx = balScoreHand(g, played);

    g.hands--;
    g.score += ctx.total;
    g.money += ctx.money;
    g.handPlays[ctx.handKey] = (g.handPlays[ctx.handKey] || 0) + 1;
    g.roundHands.push(ctx.handKey);
    g.handsPlayedThisRound++;
    g.stats.handsPlayed++;
    if (ctx.total > g.stats.bestHandScore) g.stats.bestHandScore = ctx.total;
    played.forEach(c => { if (!g.antePlayedUids.includes(c.uid)) g.antePlayedUids.push(c.uid); });

    // boss reactions
    if (balBossActive(g, 'ox') && ctx.handKey === balMostPlayedHand(g)) { g.money = 0; g.bossTriggeredThisHand = true; }
    if (balBossActive(g, 'tooth')) { g.money -= played.length; g.bossTriggeredThisHand = true; }
    if (balBossActive(g, 'heart')) {
        const live = g.jokers.filter(j => !j.disabled);
        g.jokers.forEach(j => j.disabled = false);
        if (live.length) balPick(live).disabled = true;
        g.bossTriggeredThisHand = true;
    }

    // glass cards that scored can shatter
    ctx.scoring.forEach(c => {
        if (c.enhancement === 'glass' && balChance(g, 1, 4)) {
            balRemoveFromDeck(g, c);
            balEachJoker(g, (d, s) => { if (d.id === 'glass_joker') s.counter += 1; });
            balToast(g, 'Glass Card', 'shattered');
        }
    });
    ctx.destroyPlayed.forEach(c => balRemoveFromDeck(g, c));

    // move played cards out of hand
    played.forEach(c => {
        const i = g.hand.indexOf(c);
        if (i >= 0) g.hand.splice(i, 1);
        if (g.deck.includes(c)) g.discardPile.push(c);
    });
    g.selected = [];
    g.lastScore = ctx;

    if (balBossActive(g, 'hook')) {
        for (let i = 0; i < 2 && g.hand.length; i++) {
            const c = balPick(g.hand);
            g.hand.splice(g.hand.indexOf(c), 1);
            g.discardPile.push(c);
        }
        g.bossTriggeredThisHand = true;
    }

    // did the blind fall?
    if (g.score >= g.required) { balWinBlind(g); return; }

    if (g.hands <= 0) {
        // Mr. Bones cheats death once
        const bones = g.jokers.find(j => j.def.id === 'mr_bones');
        if (bones && g.score >= g.required * 0.25) {
            g.jokers.splice(g.jokers.indexOf(bones), 1);
            balToast(g, 'Mr. Bones', 'saved you, then crumbled');
            balWinBlind(g);
            return;
        }
        balGameOver(g);
        return;
    }

    if (balBossActive(g, 'serpent')) {
        for (let i = 0; i < 3 && g.drawPile.length; i++) g.hand.push(g.drawPile.pop());
        g.bossTriggeredThisHand = true;
        balApplyFaceDown(g, false);
        balApplyDebuffs(g);
        balSortHand(g);
    } else {
        balDrawToFull(g, false);
    }
    balPickForcedCard(g);
    balRender();
}

// the cards leave the screen before the state does — the discard itself
// is unchanged below, this just waits for them to finish flying
async function balDiscardUI() {
    const g = BG;
    if (balAnimating) return;
    if (!g.selected.length) { balToast(g, 'jokerz', 'select cards to discard'); balSfx('error'); return; }
    if (g.discards <= 0) { balToast(g, 'jokerz', 'no discards left'); balSfx('error'); return; }
    const els = g.selected
        .map(c => balWinBody && balWinBody.querySelector(`.bj-hand .bj-card[data-uid="${c.uid}"]`))
        .filter(Boolean);
    if (els.length && BJFX.on()) {
        balAnimating = true;
        balSfx('carddiscard');
        await BJFX.flyOut(els, balWinBody.querySelector('.bj-deckcount'));
        balAnimating = false;
        balDiscard(true);
        return;
    }
    balDiscard();
}

function balDiscard(sfxAlreadyPlayed) {
    const g = BG;
    if (!g.selected.length) { balToast(g, 'jokerz', 'select cards to discard'); balSfx('error'); return; }
    if (g.discards <= 0) { balToast(g, 'jokerz', 'no discards left'); balSfx('error'); return; }
    if (!sfxAlreadyPlayed) balSfx('carddiscard');
    const cards = g.selected.slice();
    const before = g.hand.slice();

    cards.forEach(c => { if (c.seal === 'purple') balCreateConsumable(g, 'tarot'); });

    let consumed = false;
    balEachJoker(g, (def, self) => {
        if (!def.onDiscard) return;
        const r = def.onDiscard(g, cards, self);
        if (r && r.money) { g.money += r.money; balToast(g, def.name, `+$${r.money}`); }
        if (r && r.consumed) consumed = true;
    });

    g.discards--;
    g.discardsUsedThisRound++;
    cards.forEach(c => {
        const i = g.hand.indexOf(c);
        if (i >= 0) g.hand.splice(i, 1);
        if (!consumed && g.deck.includes(c)) g.discardPile.push(c);
    });
    g.selected = [];

    if (balBossActive(g, 'serpent')) {
        for (let i = 0; i < 3 && g.drawPile.length; i++) g.hand.push(g.drawPile.pop());
        balApplyFaceDown(g, false);
        balApplyDebuffs(g);
        balSortHand(g);
    } else {
        balDrawToFull(g, false);
    }
    balPickForcedCard(g);
    // the serpent branch above pushes straight onto the hand rather than
    // going through balDrawToFull, so catch anything it added too
    const fresh = g.hand.filter(c => !before.includes(c)).map(c => c.uid);
    g.pendingDeal = (g.pendingDeal || []).concat(fresh.filter(u => !(g.pendingDeal || []).includes(u)));
    balRender();
}

function balPickForcedCard(g) {
    if (balBossActive(g, 'bell') && g.hand.length) g.forcedCard = balPick(g.hand);
    else g.forcedCard = null;
}

// ===================================================================
// round end
// ===================================================================
function balWinBlind(g) {
    const info = balBlindInfo(g, g.blindIndex);
    let reward = info.reward;
    if (g.stake >= 2 && g.blindIndex === 0) reward = 0;

    const handBonus = g.hands;
    let interest = 0;
    if (g.deckId !== 'green') {
        let cap = 5;
        if (balHasVoucher(g, 'seed_money')) cap = 10;
        if (balHasVoucher(g, 'money_tree')) cap = 20;
        const per = balHasJoker(g, 'to_the_moon') ? 2 : 1;
        interest = Math.min(cap, Math.floor(Math.max(0, g.money) / 5) * per);
    }
    let greenBonus = 0;
    if (g.deckId === 'green') greenBonus = g.hands * 2 + g.discards;

    // cards still held in hand pay out
    let sealMoney = 0;
    g.hand.forEach(c => {
        if (c.enhancement === 'gold') sealMoney += 3;
        if (c.seal === 'blue') balCreateConsumable(g, 'planet');
    });

    g.stats.unusedDiscards = (g.stats.unusedDiscards || 0) + g.discards;

    const payouts = [];
    if (reward) payouts.push([info.name, reward]);
    if (handBonus) payouts.push([`${handBonus} hand${handBonus > 1 ? 's' : ''} remaining`, handBonus]);
    if (greenBonus) payouts.push(['Green Deck', greenBonus]);
    if (interest) payouts.push(['Interest', interest]);
    if (sealMoney) payouts.push(['Gold cards', sealMoney]);

    g.money += reward + handBonus + interest + greenBonus + sealMoney;

    // joker end-of-round hooks
    const dead = [];
    g.jokers.slice().forEach(j => {
        if (j.disabled) return;
        const e = balEffective(g, j);
        if (!e.def || !e.def.onRoundEnd) return;
        const r = e.def.onRoundEnd(g, e.self);
        if (!r) return;
        if (r.money) { g.money += r.money; payouts.push([e.def.name, r.money]); }
        if (r.destroy) dead.push(j);
        if (r.msg) balToast(g, e.def.name, r.msg);
    });
    dead.forEach(j => { const i = g.jokers.indexOf(j); if (i >= 0) g.jokers.splice(i, 1); });

    // boss-only bookkeeping
    if (g.blindIndex === 2) {
        g.antePlayedUids = [];
        g.seenBosses = (g.seenBosses || []).concat(g.bossId);
        balEachJoker(g, (d, s) => { if (d.id === 'rocket') s.counter += 2; if (d.id === 'campfire') s.counter = 0; });
        if (g.investmentTag) { g.money += 25; payouts.push(['Investment Tag', 25]); g.investmentTag = false; }
        if (g.deckId === 'anaglyph') g.pendingTags.push('double');
    }

    // perishable jokers age out, rentals charge rent
    g.jokers.forEach(j => {
        if (j.perishable) { j.roundsLeft--; if (j.roundsLeft <= 0) j.debuffed = true; }
        if (j.rental) g.money -= 3;
    });

    g.roundPayouts = payouts;
    g.jokers.forEach(j => j.disabled = false);

    if (g.blindIndex === 2 && g.ante >= 3 && typeof unlockAchievement === 'function') unlockAchievement('jokerz_ante');
    if (g.blindIndex === 2 && g.ante >= 8 && !g.won) {
        g.won = true;
        if (typeof unlockAchievement === 'function') unlockAchievement('jokerz_win');
        g.screen = 'won';
        balRender();
        return;
    }
    g.screen = 'cashout';
    balRender();
}

function balCashOut() {
    const g = BG;
    balAdvanceBlind(g, false);
    balOpenShop(g);
    balRender();
}

function balGameOver(g) {
    // the Blue Screen joker does not survive a loss
    const bsod = g.jokers.find(j => j.def.id === 'x_bsod');
    if (bsod) g.jokers.splice(g.jokers.indexOf(bsod), 1);
    g.over = true;
    g.screen = 'over';
    balSaveClear();
    balRender();
}

// ===================================================================
// shop
// ===================================================================
function balShopSlots(g) {
    let n = 2;
    if (balHasVoucher(g, 'overstock')) n++;
    if (balHasVoucher(g, 'overstock_plus')) n++;
    return n;
}
function balRerollCost(g) {
    if (!g.shop) return 0;
    let c = 5 + (g.shop.rerolls || 0);
    if (balHasVoucher(g, 'reroll_surplus')) c -= 2;
    if (balHasVoucher(g, 'reroll_glut')) c -= 2;
    if (g.shop.freeRerolls) c = 0;
    if (balHasJoker(g, 'chaos') && !g.shop.chaosUsed) c = 0;
    return Math.max(0, c);
}
function balPriceOf(g, item) {
    let base = item.cost;
    if (item.type === 'planet' && balHasJoker(g, 'astronomer')) return 0;
    if (item.type === 'pack' && item.def.kind === 'planet' && balHasJoker(g, 'astronomer')) return 0;
    if (balHasVoucher(g, 'liquidation')) base = Math.ceil(base * 0.5);
    else if (balHasVoucher(g, 'clearance')) base = Math.ceil(base * 0.75);
    if (g.shop && g.shop.coupon && item.couponable) return 0;
    if (item.free) return 0;
    return Math.max(0, base);
}

function balShopItem(g) {
    // weights shift with vouchers, and some decks unlock spectrals
    const w = [];
    w.push(['joker', 20]);
    let tw = 4;
    if (balHasVoucher(g, 'tarot_merchant')) tw *= 2;
    if (balHasVoucher(g, 'tarot_tycoon')) tw *= 2;
    w.push(['tarot', tw]);
    let pw = 4;
    if (balHasVoucher(g, 'planet_merchant')) pw *= 2;
    if (balHasVoucher(g, 'planet_tycoon')) pw *= 2;
    w.push(['planet', pw]);
    if (g.deckId === 'ghost') w.push(['spectral', 2]);
    if (balHasVoucher(g, 'magic_trick')) w.push(['card', 4]);

    const total = w.reduce((s, x) => s + x[1], 0);
    let r = balRand() * total, kind = 'joker';
    for (const [k, v] of w) { if (r < v) { kind = k; break; } r -= v; }

    if (kind === 'joker') {
        let rarity = balRollRarity();
        if (g.shopFreeJoker) { rarity = g.shopFreeJoker; }
        const pool = balJokerPool(g, rarity).length ? balJokerPool(g, rarity) : balJokerPool(g, 1);
        if (!pool.length) return null;
        const def = balPick(pool);
        let edition = null;
        const editionOdds = balHasVoucher(g, 'glow_up') ? 0.16 : balHasVoucher(g, 'hone') ? 0.08 : 0.04;
        if (g.shopEdition) { edition = g.shopEdition; g.shopEdition = null; }
        else if (balRand() < editionOdds) edition = balPick(['foil', 'holo', 'poly']);
        const item = { type: 'joker', def, cost: def.cost + (edition ? 2 : 0), edition, couponable: true };
        if (g.shopFreeJoker) { item.free = true; g.shopFreeJoker = 0; }
        // higher stakes sprinkle in downside stickers
        if (g.stake >= 4 && balRand() < 0.12) item.eternal = true;
        if (g.stake >= 7 && balRand() < 0.12) item.perishable = true;
        if (g.stake >= 8 && balRand() < 0.12) item.rental = true;
        return item;
    }
    if (kind === 'card') {
        const c = balMakeCard(balRandomRank(), balRandInt(4));
        if (balHasVoucher(g, 'illusion') && balRand() < 0.5) {
            const roll = balRand();
            if (roll < 0.4) c.enhancement = balPick(Object.keys(BAL.ENHANCEMENTS));
            else if (roll < 0.7) c.edition = balPick(['foil', 'holo', 'poly']);
            else c.seal = balPick(['red', 'blue', 'gold', 'purple']);
        }
        return { type: 'card', card: c, cost: 3, couponable: true };
    }
    const con = balRandomConsumable(g, kind);
    if (!con) return null;
    return { type: kind, con, cost: con.cost, couponable: true };
}

function balRollPack(g) {
    const total = BAL.PACKS.reduce((s, p) => s + p.weight, 0);
    let r = balRand() * total;
    for (const p of BAL.PACKS) { if (r < p.weight) return p; r -= p.weight; }
    return BAL.PACKS[0];
}

function balNextVoucher(g) {
    const owned = new Set(g.vouchers);
    const pool = BAL.VOUCHERS.filter(v => !owned.has(v.id) && (!v.req || owned.has(v.req)));
    return pool.length ? balPick(pool) : null;
}

function balOpenShop(g) {
    const items = [];
    for (let i = 0; i < balShopSlots(g); i++) { const it = balShopItem(g); if (it) items.push(it); }
    const packCount = 2 + (balHasVoucher(g, 'dialup') ? 1 : 0);
    const packs = [];
    for (let i = 0; i < packCount; i++) {
        const def = balRollPack(g);
        packs.push({ type: 'pack', def, cost: def.cost, couponable: true });
    }
    if (g.pendingPack) {
        const def = BAL.PACKS.find(p => p.id === g.pendingPack);
        if (def) packs.unshift({ type: 'pack', def, cost: 0, free: true });
        g.pendingPack = null;
    }
    const vouchers = [];
    const v = balNextVoucher(g);
    if (v) vouchers.push({ type: 'voucher', def: v, cost: v.cost });
    if (g.shopExtraVoucher) { const v2 = balNextVoucher(g); if (v2 && v2.id !== (v && v.id)) vouchers.push({ type: 'voucher', def: v2, cost: v2.cost }); g.shopExtraVoucher = false; }

    g.shop = {
        items, packs, vouchers, rerolls: 0,
        coupon: !!g.shopCoupon, freeRerolls: !!g.shopFreeRerolls,
        chaosUsed: false, shareware: balHasVoucher(g, 'shareware')
    };
    g.shopCoupon = false;
    g.shopFreeRerolls = false;
    g.screen = 'shop';
}

function balReroll() {
    const g = BG;
    const cost = balRerollCost(g);
    if (g.money < cost && !balCanAfford(g, cost)) { balToast(g, 'shop', 'not enough money'); balSfx('error'); return; }
    balSfx('reroll');
    if (balHasJoker(g, 'chaos') && !g.shop.chaosUsed && cost === 0) g.shop.chaosUsed = true;
    g.money -= cost;
    g.shop.rerolls++;
    g.shop.coupon = false;
    g.shop.items = [];
    for (let i = 0; i < balShopSlots(g); i++) { const it = balShopItem(g); if (it) g.shop.items.push(it); }
    balEachJoker(g, (d, s) => { if (d.id === 'flash_card') s.counter += 2; });
    balRender();
}

function balCanAfford(g, cost) {
    const floor = balHasJoker(g, 'credit_card') ? -20 : 0;
    return g.money - cost >= floor;
}

function balBuy(kind, index) {
    const g = BG;
    const list = kind === 'item' ? g.shop.items : kind === 'pack' ? g.shop.packs : g.shop.vouchers;
    const item = list[index];
    if (!item) return;
    let cost = balPriceOf(g, item);
    if (item.type === 'joker' && g.shop.shareware && !g.shop.sharewareUsed) { cost = 0; g.shop.sharewareUsed = true; }
    if (!balCanAfford(g, cost)) { balToast(g, 'shop', 'not enough money'); balSfx('error'); return; }

    if (item.type === 'joker') {
        if (g.jokers.length >= balJokerSlots(g) && item.edition !== 'negative') { balToast(g, 'shop', 'no joker slots free'); balSfx('error'); return; }
        balAddJoker(g, item.def, { edition: item.edition, eternal: item.eternal, perishable: item.perishable, rental: item.rental });
        balSfx('buy');
    } else if (item.type === 'tarot' || item.type === 'planet' || item.type === 'spectral') {
        if (g.consumables.length >= balConsumableSlots(g)) { balToast(g, 'shop', 'no consumable slots free'); balSfx('error'); return; }
        g.consumables.push(item.con);
        balSfx('buy');
    } else if (item.type === 'card') {
        g.deck.push(item.card);
        balEachJoker(g, (d, s) => { if (d.id === 'hologram') s.counter += 1; });
        balSfx('buy');
    } else if (item.type === 'voucher') {
        g.vouchers.push(item.def.id);
        balApplyVoucher(g, item.def.id);
        balSfx('buy');
    } else if (item.type === 'pack') {
        g.money -= cost;
        balSfx('packopen');
        balOpenPack(g, item.def);
        list.splice(index, 1);
        balRender();
        return;
    }
    g.money -= cost;
    list.splice(index, 1);
    balRender();
}

function balApplyVoucher(g, id) {
    if (id === 'hieroglyph' || id === 'petroglyph') { g.ante = Math.max(1, g.ante - 1); balRollBoss(g); }
    if (id === 'antimatter') balToast(g, 'Antimatter', '+1 joker slot');
}

function balLeaveShop() {
    const g = BG;
    balEachJoker(g, (def, self) => { if (def.onShopExit) def.onShopExit(g, self); });
    g.shop = null;
    g.screen = 'blind';
    balSave();
    balRender();
}

// ===================================================================
// booster packs
// ===================================================================
function balOpenPack(g, def) {
    const extra = balHasVoucher(g, 'broadband') ? 1 : 0;
    const size = def.size + extra;
    const cards = [];
    for (let i = 0; i < size; i++) {
        if (def.kind === 'tarot') {
            const spectralChance = balHasVoucher(g, 'omen_globe') && balChance(g, 1, 5);
            cards.push({ type: spectralChance ? 'spectral' : 'tarot', con: balRandomConsumable(g, spectralChance ? 'spectral' : 'tarot') });
        } else if (def.kind === 'planet') {
            let con;
            if (i === 0 && balHasVoucher(g, 'telescope')) {
                const most = balMostPlayedHand(g);
                const p = BAL.PLANETS.find(x => x.hand === most);
                con = balMakeConsumable('planet', p.id);
            } else con = balRandomConsumable(g, 'planet');
            cards.push({ type: 'planet', con });
        } else if (def.kind === 'spectral') {
            const pool = BAL.SPECTRALS.filter(s => !s.secret || balChance(g, 1, 25));
            cards.push({ type: 'spectral', con: balMakeConsumable('spectral', balPick(pool).id) });
        } else if (def.kind === 'joker') {
            const rarity = balRollRarity();
            const pool = balJokerPool(g, rarity).length ? balJokerPool(g, rarity) : balJokerPool(g, 1);
            let edition = null;
            if (balRand() < 0.06) edition = balPick(['foil', 'holo', 'poly']);
            cards.push({ type: 'joker', def: balPick(pool), edition });
        } else {
            const c = balMakeCard(balRandomRank(), balRandInt(4));
            const roll = balRand();
            if (roll < 0.25) c.enhancement = balPick(Object.keys(BAL.ENHANCEMENTS));
            if (balRand() < 0.1) c.edition = balPick(['foil', 'holo', 'poly']);
            if (balRand() < 0.08) c.seal = balPick(['red', 'blue', 'gold', 'purple']);
            cards.push({ type: 'card', card: c });
        }
    }
    // Hallucination rolls for a bonus tarot whenever a pack is opened
    if (balHasJoker(g, 'hallucination') && balChance(g, 1, 2)) balCreateConsumable(g, 'tarot');
    g.pack = { def, cards, picks: def.pick, taken: [] };
    g.screen = 'pack';
}

function balPackTake(index) {
    const g = BG;
    const p = g.pack;
    const item = p.cards[index];
    if (!item || p.taken.includes(index)) return;

    if (item.type === 'joker') {
        if (g.jokers.length >= balJokerSlots(g)) { balToast(g, 'pack', 'no joker slots free'); balSfx('error'); return; }
        balAddJoker(g, item.def, { edition: item.edition });
    } else if (item.type === 'card') {
        g.deck.push(item.card);
        balEachJoker(g, (d, s) => { if (d.id === 'hologram') s.counter += 1; });
    } else {
        // a consumable from a pack can be used at once if there is no slot
        if (g.consumables.length >= balConsumableSlots(g)) {
            balToast(g, 'pack', 'no consumable slots free');
            balSfx('error');
            return;
        }
        g.consumables.push(item.con);
    }
    balSfx('take');
    p.taken.push(index);
    p.picks--;
    if (p.picks <= 0) balPackClose();
    else balRender();
}

function balPackClose() {
    const g = BG;
    if (g.pack && g.pack.picks > 0 && !g.pack.taken.length) {
        balEachJoker(g, (d, s) => { if (d.id === 'red_card') s.counter += 3; });
    }
    g.pack = null;
    g.screen = g.shop ? 'shop' : 'blind';
    balRender();
}

// ===================================================================
// consumables
// ===================================================================
function balUseConsumable(uid) {
    const g = BG;
    const idx = g.consumables.findIndex(c => c.uid === uid);
    if (idx < 0) return;
    const con = g.consumables[idx];
    const sel = g.selected.slice();

    const src = con.kind === 'tarot' ? BAL.TAROTS.find(t => t.id === con.id)
        : con.kind === 'planet' ? BAL.PLANETS.find(t => t.id === con.id)
            : BAL.SPECTRALS.find(t => t.id === con.id);
    if (!src) return;

    if (src.need && src.need !== 0) {
        const [min, max] = src.need;
        if (sel.length < min || sel.length > max) {
            balToast(g, con.name, `select ${min === max ? min : min + '-' + max} card${max > 1 ? 's' : ''}`);
            balSfx('error');
            return;
        }
    }

    const ok = con.kind === 'planet' ? balUsePlanet(g, con) : balUseCard(g, con, src, sel);
    if (!ok) return;
    balSfx('use');

    g.consumables.splice(idx, 1);
    g.selected = [];
    g.lastConsumable = { kind: con.kind, id: con.id };
    if (con.kind === 'tarot') g.stats.tarotsUsed++;
    balApplyDebuffs(g);
    balRender();
}

function balUsePlanet(g, con) {
    const p = BAL.PLANETS.find(x => x.id === con.id);
    balLevelUp(g, p.hand, 1);
    g.stats.planetsUsed++;
    g.stats.uniquePlanets.add(p.id);
    balEachJoker(g, (d, s) => { if (d.id === 'constellation') s.counter += 1; });
    balToast(g, p.name, `${BAL.HANDS[p.hand].name} -> level ${g.handLevels[p.hand]}`);
    return true;
}

function balEnhance(cards, enh) { cards.forEach(c => { c.enhancement = enh; }); }

function balUseCard(g, con, src, sel) {
    const id = con.id;
    const enhMap = { magician: 'lucky', empress: 'mult', hierophant: 'bonus', lovers: 'wild', chariot: 'steel', justice: 'glass', devil: 'gold', tower: 'stone' };
    if (enhMap[id]) { balEnhance(sel, enhMap[id]); return true; }

    switch (id) {
        case 'fool': {
            if (!g.lastConsumable) { balToast(g, 'The Fool', 'nothing used yet'); return false; }
            if (g.consumables.length - 1 >= balConsumableSlots(g)) { balToast(g, 'The Fool', 'no room'); return false; }
            const c = balMakeConsumable(g.lastConsumable.kind, g.lastConsumable.id);
            if (c) g.consumables.push(c);
            return true;
        }
        case 'priestess': { balCreateConsumable(g, 'planet'); balCreateConsumable(g, 'planet'); return true; }
        case 'emperor': { balCreateConsumable(g, 'tarot'); balCreateConsumable(g, 'tarot'); return true; }
        case 'hermit': { const gain = Math.min(20, Math.max(0, g.money)); g.money += gain; balToast(g, 'The Hermit', `+$${gain}`); return true; }
        case 'wheel': {
            if (g.jokers.length && balChance(g, 1, 4)) {
                const j = balPick(g.jokers.filter(x => !x.edition));
                if (j) { j.edition = balPick(['foil', 'holo', 'poly']); balToast(g, 'Wheel of Fortune', `${j.def.name} is ${BAL.EDITIONS[j.edition].name}`); return true; }
            }
            balToast(g, 'Wheel of Fortune', 'nothing happens');
            return true;
        }
        case 'strength': { sel.forEach(c => { c.rank = c.rank >= 14 ? 2 : c.rank + 1; }); return true; }
        case 'hanged': { sel.forEach(c => balRemoveFromDeck(g, c)); return true; }
        case 'death': {
            const [a, b] = sel;
            a.rank = b.rank; a.suit = b.suit; a.enhancement = b.enhancement; a.edition = b.edition; a.seal = b.seal;
            return true;
        }
        case 'temperance': {
            const v = Math.min(50, g.jokers.reduce((s, j) => s + balSellValue(j), 0));
            g.money += v; balToast(g, 'Temperance', `+$${v}`); return true;
        }
        case 'star': sel.forEach(c => c.suit = 2); return true;
        case 'moon': sel.forEach(c => c.suit = 3); return true;
        case 'sun': sel.forEach(c => c.suit = 1); return true;
        case 'world': sel.forEach(c => c.suit = 0); return true;
        case 'judgement': {
            if (g.jokers.length >= balJokerSlots(g)) { balToast(g, 'Judgement', 'no joker slots free'); return false; }
            balCreateJoker(g); return true;
        }
        // ---- spectrals ----
        case 'familiar': case 'grim': case 'incantation': {
            if (!g.hand.length) { balToast(g, con.name, 'no cards in hand'); return false; }
            balRemoveFromDeck(g, balPick(g.hand));
            const n = id === 'familiar' ? 3 : id === 'grim' ? 2 : 4;
            for (let i = 0; i < n; i++) {
                const rank = id === 'familiar' ? 11 + balRandInt(3) : id === 'grim' ? 14 : 2 + balRandInt(9);
                const c = balMakeCard(rank, balRandInt(4));
                c.enhancement = balPick(Object.keys(BAL.ENHANCEMENTS));
                g.deck.push(c); g.hand.push(c);
            }
            balSortHand(g);
            return true;
        }
        case 'talisman': sel.forEach(c => c.seal = 'gold'); return true;
        case 'dejavu': sel.forEach(c => c.seal = 'red'); return true;
        case 'trance': sel.forEach(c => c.seal = 'blue'); return true;
        case 'medium': sel.forEach(c => c.seal = 'purple'); return true;
        case 'aura': sel.forEach(c => c.edition = balPick(['foil', 'holo', 'poly'])); return true;
        case 'wraith': {
            if (g.jokers.length >= balJokerSlots(g)) { balToast(g, 'Wraith', 'no joker slots free'); return false; }
            balCreateJoker(g, 3); g.money = 0; return true;
        }
        case 'sigil': { const s = balRandInt(4); g.hand.forEach(c => c.suit = s); return true; }
        case 'ouija': { const r = balRandomRank(); g.hand.forEach(c => c.rank = r); g.handSizeMod--; return true; }
        case 'ectoplasm': {
            const pool = g.jokers.filter(j => !j.edition);
            if (!pool.length) { balToast(g, 'Ectoplasm', 'no eligible joker'); return false; }
            balPick(pool).edition = 'negative'; g.handSizeMod--; return true;
        }
        case 'immolate': {
            balShuffle(g.hand.slice()).slice(0, 5).forEach(c => balRemoveFromDeck(g, c));
            g.money += 20; return true;
        }
        case 'ankh': {
            if (!g.jokers.length) { balToast(g, 'Ankh', 'no jokers'); return false; }
            const keep = balPick(g.jokers);
            g.jokers = [keep];
            balAddJoker(g, keep.def, { edition: keep.edition });
            return true;
        }
        case 'hex': {
            if (!g.jokers.length) { balToast(g, 'Hex', 'no jokers'); return false; }
            const keep = balPick(g.jokers);
            keep.edition = 'poly';
            g.jokers = [keep];
            return true;
        }
        case 'cryptid': {
            const c = sel[0];
            for (let i = 0; i < 2; i++) { const copy = balCloneCard(c); g.deck.push(copy); g.hand.push(copy); }
            balSortHand(g);
            return true;
        }
        case 'soul': {
            if (g.jokers.length >= balJokerSlots(g)) { balToast(g, 'The Soul', 'no joker slots free'); return false; }
            balCreateJoker(g, 4); return true;
        }
        case 'black_hole': { Object.keys(BAL.HANDS).forEach(k => balLevelUp(g, k, 1)); balToast(g, 'Black Hole', 'every hand +1 level'); return true; }
        // ---- original spectrals ----
        case 'defrag': {
            g.deck.forEach(c => { c.bonusChips = (c.bonusChips || 0) + 2; });
            balSortHand(g);
            balToast(g, 'Defragment', 'every card +2 chips');
            return true;
        }
        case 'overclock': {
            if (!g.jokers.length) { balToast(g, 'Overclock', 'no jokers'); return false; }
            const j = balPick(g.jokers);
            j.overclock = (j.overclock || 1) * 1.5;
            j.edition = j.edition || 'poly';
            g.handSizeMod--;
            balToast(g, 'Overclock', j.def.name + ' overclocked');
            return true;
        }
        case 'recycle_bin': {
            const n = g.hand.length;
            g.hand.slice().forEach(c => balRemoveFromDeck(g, c));
            g.money += n * 4;
            balToast(g, 'Recycle Bin', `+$${n * 4}`);
            return true;
        }
    }
    return false;
}

function balSellJoker(uid) {
    const g = BG;
    const i = g.jokers.findIndex(j => j.uid === uid);
    if (i < 0) return;
    const j = g.jokers[i];
    if (j.eternal) { balToast(g, 'Eternal', 'this joker cannot be sold'); balSfx('error'); return; }
    balSfx('sell');
    const v = balSellValue(j);
    const e = balEffective(g, j);
    g.jokers.splice(i, 1);
    g.money += v;
    g.stats.cardsSold++;
    balEachJoker(g, (d, s) => { if (d.id === 'campfire') s.counter += 1; });
    if (j.def.onSold) j.def.onSold(g, j);
    else if (e.def && e.def.onSold) e.def.onSold(g, e.self);
    if (balBossActive(g, 'leaf')) { g.leafCleared = true; balApplyDebuffs(g); }
    balRender();
}

function balSellConsumable(uid) {
    const g = BG;
    const i = g.consumables.findIndex(c => c.uid === uid);
    if (i < 0) return;
    const c = g.consumables[i];
    balSfx('sell');
    g.money += Math.max(1, Math.floor((c.cost || 3) / 2)) + (c.extraValue || 0);
    g.consumables.splice(i, 1);
    g.stats.cardsSold++;
    balEachJoker(g, (d, s) => { if (d.id === 'campfire') s.counter += 1; });
    balRender();
}

// ===================================================================
// save / load
// ===================================================================
const BAL_SAVE_KEY = 'jokerz98-run';

function balSave() {
    const g = BG;
    if (!g || g.over) return;
    try {
        const uids = c => c.uid;
        const data = {
            v: 1, seed: g.seed, deckId: g.deckId, stake: g.stake, rng: balRngState,
            ante: g.ante, round: g.round, blindIndex: g.blindIndex, bossId: g.bossId,
            money: g.money, handLevels: g.handLevels, handPlays: g.handPlays,
            vouchers: g.vouchers, seenBosses: g.seenBosses || [],
            handSizeMod: g.handSizeMod, startingDeckSize: g.startingDeckSize,
            deck: g.deck, hand: g.hand.map(uids), drawPile: g.drawPile.map(uids), discardPile: g.discardPile.map(uids),
            jokers: g.jokers.map(j => ({
                id: j.def.id, counter: j.counter, extraValue: j.extraValue, edition: j.edition,
                eternal: j.eternal, perishable: j.perishable, rental: j.rental, roundsLeft: j.roundsLeft,
                target: j.target, suit: j.suit, state: j.state, overclock: j.overclock
            })),
            consumables: g.consumables,
            stats: { ...g.stats, uniquePlanets: [...g.stats.uniquePlanets] },
            pendingTags: g.pendingTags, screen: g.screen === 'play' ? 'blind' : g.screen
        };
        localStorage.setItem(BAL_SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* storage full or blocked — the run just won't resume */ }
}

function balHasSave() {
    try { return !!localStorage.getItem(BAL_SAVE_KEY); } catch (e) { return false; }
}
function balSaveClear() {
    try { localStorage.removeItem(BAL_SAVE_KEY); } catch (e) { }
}

function balLoad() {
    let d;
    try { d = JSON.parse(localStorage.getItem(BAL_SAVE_KEY)); } catch (e) { return false; }
    if (!d || d.v !== 1) return false;

    const g = balNewRun(d.deckId, d.stake, d.seed);
    balRngState = d.rng;
    Object.assign(g, {
        ante: d.ante, round: d.round, blindIndex: d.blindIndex, bossId: d.bossId,
        money: d.money, handLevels: d.handLevels, handPlays: d.handPlays,
        vouchers: d.vouchers, seenBosses: d.seenBosses, handSizeMod: d.handSizeMod,
        startingDeckSize: d.startingDeckSize, consumables: d.consumables, pendingTags: d.pendingTags || []
    });
    g.deck = d.deck;
    const byUid = new Map(g.deck.map(c => [c.uid, c]));
    g.hand = (d.hand || []).map(u => byUid.get(u)).filter(Boolean);
    g.drawPile = (d.drawPile || []).map(u => byUid.get(u)).filter(Boolean);
    g.discardPile = (d.discardPile || []).map(u => byUid.get(u)).filter(Boolean);
    g.jokers = (d.jokers || []).map(j => {
        const def = BAL.JOKERS_BY_ID[j.id];
        if (!def) return null;
        return { uid: balUid(), def, counter: j.counter, extraValue: j.extraValue, edition: j.edition, eternal: j.eternal, perishable: j.perishable, rental: j.rental, roundsLeft: j.roundsLeft, target: j.target, suit: j.suit, state: j.state, overclock: j.overclock, disabled: false, debuffed: false };
    }).filter(Boolean);
    g.stats = { ...d.stats, uniquePlanets: new Set(d.stats.uniquePlanets || []) };
    // keep the uid counter ahead of everything we just restored
    g.deck.forEach(c => { const n = +String(c.uid).slice(1); if (n > balUidN) balUidN = n; });
    g.screen = 'blind';
    BG = g;
    return true;
}

// ===================================================================
// rendering
// ===================================================================
function balCardHtml(c, opts) {
    opts = opts || {};
    if (c.faceDown && !opts.reveal) return `<div class="bj-card bj-back" data-uid="${c.uid}"></div>`;
    const suit = BAL.SUITS[c.suit];
    const cls = ['bj-card'];
    if (suit.red) cls.push('red');
    if (c.enhancement) cls.push('enh-' + c.enhancement);
    if (c.edition) cls.push('ed-' + c.edition);
    if (c.debuffed) cls.push('debuffed');
    if (opts.selected) cls.push('sel');
    const label = c.enhancement === 'stone' ? '' : BAL.RANK_LABEL[c.rank];
    const glyph = c.enhancement === 'stone' ? '⬤' : suit.glyph;
    const bits = [];
    if (c.enhancement) bits.push(BAL.ENHANCEMENTS[c.enhancement].name);
    if (c.edition) bits.push(BAL.EDITIONS[c.edition].name);
    if (c.seal) bits.push(BAL.SEALS[c.seal].name);
    if (c.bonusChips) bits.push(`+${c.bonusChips} chips`);
    return `<div class="${cls.join(' ')}" data-uid="${c.uid}" title="${escapeHtml(bits.join(' · ') || balCardLabel(c))}">
        ${c.seal ? `<span class="bj-seal seal-${c.seal}"></span>` : ''}
        <span class="bj-rank">${label}</span>
        <span class="bj-suit">${glyph}</span>
    </div>`;
}

function balJokerHtml(g, j, i) {
    const def = j.def;
    const dyn = def.desc ? def.desc(g, j) : '';
    const tags = [];
    if (j.eternal) tags.push('Eternal');
    if (j.perishable) tags.push(`Perishable ${j.roundsLeft}`);
    if (j.rental) tags.push('Rental');
    if (j.edition) tags.push(BAL.EDITIONS[j.edition].name);
    const cls = ['bj-joker'];
    if (j.edition) cls.push('ed-' + j.edition);
    if (j.debuffed || j.disabled) cls.push('debuffed');
    if (def.extra) cls.push('bj-extra');
    return `<div class="${cls.join(' ')}" data-joker="${j.uid}" data-i="${i}" style="--rar:${BAL.RARITY_COLOR[def.rarity]}">
        <div class="bj-joker-name">${escapeHtml(def.name)}</div>
        <div class="bj-joker-text">${escapeHtml(def.text)}</div>
        ${dyn ? `<div class="bj-joker-dyn">${escapeHtml(dyn)}</div>` : ''}
        ${tags.length ? `<div class="bj-joker-tags">${escapeHtml(tags.join(' · '))}</div>` : ''}
        <div class="bj-joker-foot"><span>${BAL.RARITY_NAME[def.rarity]}</span><span>$${balSellValue(j)}</span></div>
    </div>`;
}

function balConHtml(g, c) {
    const src = c.kind === 'tarot' ? BAL.TAROTS.find(t => t.id === c.id)
        : c.kind === 'planet' ? BAL.PLANETS.find(t => t.id === c.id)
            : BAL.SPECTRALS.find(t => t.id === c.id);
    const text = c.kind === 'planet'
        ? `Level up ${BAL.HANDS[src.hand].name} (lvl ${g.handLevels[src.hand] || 1})`
        : (src ? src.text : '');
    return `<div class="bj-con bj-con-${c.kind}${c.negative ? ' ed-negative' : ''}" data-con="${c.uid}">
        <div class="bj-con-name">${escapeHtml(c.name)}</div>
        <div class="bj-con-text">${escapeHtml(text)}</div>
        <div class="bj-con-foot">${c.kind}</div>
    </div>`;
}

function balRender() {
    if (balSuppressRender || !balWinBody || !BG) return;
    const g = BG;
    const screens = {
        menu: balRenderMenu, blind: balRenderBlind, play: balRenderPlay,
        cashout: balRenderCashout, shop: balRenderShop, pack: balRenderPack,
        over: balRenderOver, won: balRenderWon, info: balRenderInfo
    };
    const changed = balLastScreen !== g.screen;
    balLastScreen = g.screen;
    const moneyBefore = balLastMoney;
    balLastMoney = g.money;
    balWinBody.innerHTML = (screens[g.screen] || balRenderPlay)(g);
    balBind(g);
    // money is the one number that changes on screens where nothing else
    // moved, so it says so itself
    if (moneyBefore !== null && g.money !== undefined && g.money !== moneyBefore) {
        const el = balWinBody.querySelector('.bj-money span');
        const d = g.money - moneyBefore;
        BJFX.pop(el, { scale: 1.3 });
        BJFX.floatOff(el, (d > 0 ? '+$' : '-$') + Math.abs(d), { color: d > 0 ? '#ffd400' : '#ff5c5c', up: 22 });
    }
    // arriving somewhere new is worth announcing; redrawing the table
    // you are already sitting at is not
    if (changed) BJFX.screenIn(balWinBody);
    if (g.screen === 'play') balDealPending(g);
}
let balLastScreen = null;
let balLastMoney = null;

// the readout is the only part of the table that a selection changes,
// so selecting a card updates that instead of rebuilding everything
function balUpdateReadout(g) {
    if (!balWinBody) return;
    const ev = g.selected.length ? balEvaluate(g, g.selected) : null;
    const vals = ev ? balHandValues(g, ev.key) : null;
    const last = g.lastScore;
    const nameEl = balWinBody.querySelector('.bj-hand-name');
    const chipsEl = balWinBody.querySelector('.bj-chips');
    const multEl = balWinBody.querySelector('.bj-mult');
    if (nameEl) {
        const wasEmpty = nameEl.dataset.key || '';
        nameEl.innerHTML = ev
            ? escapeHtml(BAL.HANDS[ev.key].name) + ` <small>lvl ${vals.level}</small>`
            : 'select up to 5 cards';
        nameEl.dataset.key = ev ? ev.key : '';
        // the hand you are holding changed into a different hand — that
        // is the thing a player most wants to notice
        if (ev && wasEmpty !== ev.key) BJFX.pop(nameEl, { scale: 1.12, duration: 220 });
    }
    if (chipsEl) BJFX.countTo(chipsEl, ev ? vals.chips : (last ? Math.round(last.chips) : 0), { duration: 220 });
    if (multEl) BJFX.countTo(multEl, ev ? vals.mult : (last ? +last.mult.toFixed(2) : 0), {
        duration: 220, format: v => String(Math.round(v * 100) / 100)
    });
}

// cards drawn while the table was not on screen get their deal-in the
// moment it is
function balDealPending(g) {
    if (!g.pendingDeal || !g.pendingDeal.length || !balWinBody) return;
    const uids = g.pendingDeal;
    g.pendingDeal = null;
    const els = uids.map(u => balWinBody.querySelector(`.bj-hand .bj-card[data-uid="${u}"]`)).filter(Boolean);
    BJFX.dealIn(els, balWinBody.querySelector('.bj-deckcount'));
}

function balTopBar(g) {
    const info = balBlindInfo(g, g.blindIndex);
    return `<div class="bj-top">
        <div class="bj-stat"><b>Ante</b><span>${g.ante}/8</span></div>
        <div class="bj-stat"><b>Round</b><span>${g.round}</span></div>
        <div class="bj-stat bj-money"><b>Money</b><span>$${g.money}</span></div>
        <div class="bj-stat"><b>Blind</b><span>${escapeHtml(info.name)}</span></div>
        <button class="bj-btn bj-small" data-act="music" title="toggle background music">${balMusic.isOn() ? '♪ music' : '♪ muted'}</button>
        <button class="bj-btn bj-small" data-act="info">run info</button>
    </div>`;
}

// ---------- deck & stake picker ----------
function balRenderMenu(g) {
    return `<div class="bj-menu">
        <div class="bj-menutop"><button class="bj-btn bj-small" data-act="music">${balMusic.isOn() ? '♪ music: on' : '♪ music: off'}</button></div>
        <h2 class="bj-title">JOKERZ 98</h2>
        <p class="bj-sub">a poker roguelike. build a deck of jokers, beat the blind, do it again with worse ideas.</p>
        ${balHasSave() ? `<button class="bj-btn bj-wide" data-act="continue">continue saved run</button>` : ''}
        <div class="bj-field"><label>seed</label><input class="bj-input" id="bj-seed" placeholder="leave blank for random" spellcheck="false" autocomplete="off"></div>
        <p class="bj-label">deck</p>
        <div class="bj-choices">${BAL.DECKS.map(d => `
            <button class="bj-choice${d.id === (g && g.pickDeck || 'red') ? ' sel' : ''}${d.extra ? ' bj-extra' : ''}" data-deck="${d.id}">
                <b>${escapeHtml(d.name)}</b><span>${escapeHtml(d.text)}</span>
            </button>`).join('')}</div>
        <p class="bj-label">stake</p>
        <div class="bj-choices bj-stakes">${BAL.STAKES.map(s => `
            <button class="bj-choice${s.id === (g && g.pickStake || 1) ? ' sel' : ''}" data-stake="${s.id}" style="--rar:${s.color}">
                <b>${escapeHtml(s.name)}</b><span>${escapeHtml(s.text)}</span>
            </button>`).join('')}</div>
        <button class="bj-btn bj-wide bj-go" data-act="start">start run</button>
    </div>`;
}

// ---------- blind select ----------
function balRenderBlind(g) {
    const cards = [0, 1, 2].map(i => {
        const info = balBlindInfo(g, i);
        const done = i < g.blindIndex;
        const now = i === g.blindIndex;
        return `<div class="bj-blind${now ? ' now' : ''}${done ? ' done' : ''}${i === 2 ? ' boss' : ''}">
            <div class="bj-blind-name">${escapeHtml(info.name)}</div>
            <div class="bj-blind-req">${balNum(info.req * (g.deckId === 'plasma' ? 2 : 1))}</div>
            <div class="bj-blind-sub">score at least</div>
            ${info.text ? `<div class="bj-blind-text">${escapeHtml(info.text)}</div>` : ''}
            <div class="bj-blind-reward">reward $${g.stake >= 2 && i === 0 ? 0 : info.reward}</div>
            ${now ? `<button class="bj-btn" data-act="select">select</button>
                     ${i < 2 ? `<button class="bj-btn bj-ghost" data-act="skip">skip for a tag</button>` : ''}` :
                done ? '<div class="bj-blind-done">defeated</div>' : '<div class="bj-blind-done">upcoming</div>'}
        </div>`;
    }).join('');
    return `${balTopBar(g)}
        <div class="bj-blinds">${cards}</div>
        ${g.pendingTags.length ? `<div class="bj-tags">tags: ${g.pendingTags.map(t => escapeHtml(BAL.TAGS.find(x => x.id === t).name)).join(', ')}</div>` : ''}
        ${balSideHtml(g)}`;
}

// ---------- the table ----------
function balRenderPlay(g) {
    const info = balBlindInfo(g, g.blindIndex);
    const ev = g.selected.length ? balEvaluate(g, g.selected) : null;
    const vals = ev ? balHandValues(g, ev.key) : null;
    const last = g.lastScore;
    const boss = g.blindIndex === 2 ? balCurrentBoss(g) : null;

    return `${balTopBar(g)}
    <div class="bj-blindbar${boss ? ' boss' : ''}">
        <span class="bj-blindbar-name">${escapeHtml(info.name)}</span>
        ${boss && !g.bossDisabled ? `<span class="bj-blindbar-text">${escapeHtml(boss.text)}</span>` : ''}
        <span class="bj-blindbar-score">${balNum(g.score)} / ${balNum(g.required)}</span>
    </div>
    <div class="bj-progress bevel-in"><div class="bj-progress-fill" style="width:${Math.min(100, (g.score / g.required) * 100)}%"></div></div>

    <div class="bj-slots">
        <div class="bj-slotrow">
            <span class="bj-slotlabel">jokers ${g.jokers.length}/${balJokerSlots(g)}</span>
            <div class="bj-jokers">${g.jokers.map((j, i) => balJokerHtml(g, j, i)).join('') || '<div class="bj-empty">no jokers yet</div>'}</div>
        </div>
        <div class="bj-slotrow">
            <span class="bj-slotlabel">consumables ${g.consumables.length}/${balConsumableSlots(g)}</span>
            <div class="bj-cons">${g.consumables.map(c => balConHtml(g, c)).join('') || '<div class="bj-empty">empty</div>'}</div>
        </div>
    </div>

    <div class="bj-readout">
        <div class="bj-hand-name">${ev ? escapeHtml(BAL.HANDS[ev.key].name) + ` <small>lvl ${vals.level}</small>` : 'select up to 5 cards'}</div>
        <div class="bj-calc">
            <span class="bj-chips">${ev ? vals.chips : (last ? Math.round(last.chips) : 0)}</span>
            <span class="bj-x">X</span>
            <span class="bj-mult">${ev ? vals.mult : (last ? +last.mult.toFixed(2) : 0)}</span>
        </div>
        ${last ? `<div class="bj-last">last hand: ${balNum(last.total)}</div>` : ''}
    </div>

    <div class="bj-hand">${g.hand.map(c => balCardHtml(c, { selected: g.selected.includes(c) })).join('')}</div>

    <div class="bj-actions">
        <button class="bj-btn bj-play" data-act="play">play hand</button>
        <div class="bj-counts">
            <span class="bj-count bj-hands">hands <b>${g.hands}</b></span>
            <span class="bj-count bj-discards">discards <b>${g.discards}</b></span>
        </div>
        <button class="bj-btn bj-disc" data-act="discard">discard</button>
    </div>
    <div class="bj-actions2">
        <button class="bj-btn bj-small" data-act="sort-rank">sort: rank</button>
        <button class="bj-btn bj-small" data-act="sort-suit">sort: suit</button>
        <button class="bj-btn bj-small" data-act="use">use consumable</button>
        <span class="bj-deckcount">deck ${g.drawPile.length}/${g.deck.length}</span>
    </div>
    ${last && last.log.length ? `<details class="bj-log"><summary>scoring breakdown</summary>
        <div class="bj-logrows">${last.log.map(l => `<span><b>${escapeHtml(String(l.t))}</b>${escapeHtml(String(l.v))}</span>`).join('')}</div>
    </details>` : ''}`;
}

// ---------- cash out ----------
function balRenderCashout(g) {
    const rows = (g.roundPayouts || []).map(([label, v]) => `<div class="bj-payrow"><span>${escapeHtml(label)}</span><b>+$${v}</b></div>`).join('');
    const total = (g.roundPayouts || []).reduce((s, p) => s + p[1], 0);
    return `${balTopBar(g)}
        <div class="bj-cashout">
            <h3>blind defeated</h3>
            <div class="bj-paylist">${rows || '<div class="bj-payrow"><span>nothing</span><b>$0</b></div>'}</div>
            <div class="bj-paytotal">cash out: <b>$${total}</b></div>
            <button class="bj-btn bj-wide" data-act="cashout">cash out</button>
        </div>`;
}

// ---------- shop ----------
function balShopCardHtml(g, item, kind, i) {
    const price = balPriceOf(g, item);
    let inner = '';
    if (item.type === 'joker') {
        const fake = { def: item.def, counter: item.def.counter || 0, edition: item.edition, extraValue: 0, eternal: item.eternal, perishable: item.perishable, rental: item.rental, roundsLeft: 5 };
        inner = balJokerHtml(g, fake, i);
    } else if (item.type === 'card') {
        inner = `<div class="bj-shopcard-card">${balCardHtml(item.card, { reveal: true })}</div>`;
    } else if (item.type === 'pack') {
        inner = `<div class="bj-pack"><b>${escapeHtml(item.def.name)}</b><span>choose ${item.def.pick} of ${item.def.size}</span></div>`;
    } else if (item.type === 'voucher') {
        inner = `<div class="bj-voucher"><b>${escapeHtml(item.def.name)}</b><span>${escapeHtml(item.def.text)}</span></div>`;
    } else {
        inner = balConHtml(g, item.con);
    }
    return `<div class="bj-shopitem" data-buy="${kind}" data-i="${i}">
        ${inner}
        <button class="bj-btn bj-buy">buy $${price}</button>
    </div>`;
}

function balRenderShop(g) {
    if (!g.shop) balOpenShop(g);
    return `${balTopBar(g)}
    <div class="bj-shop">
        <div class="bj-shophead">
            <h3>the shop</h3>
            <button class="bj-btn" data-act="reroll">reroll $${balRerollCost(g)}</button>
            <button class="bj-btn bj-go" data-act="leave">next round</button>
        </div>
        <div class="bj-shoprow">${g.shop.items.map((it, i) => balShopCardHtml(g, it, 'item', i)).join('') || '<div class="bj-empty">sold out</div>'}</div>
        <p class="bj-label">booster packs</p>
        <div class="bj-shoprow">${g.shop.packs.map((it, i) => balShopCardHtml(g, it, 'pack', i)).join('') || '<div class="bj-empty">sold out</div>'}</div>
        ${g.shop.vouchers.length ? `<p class="bj-label">voucher</p>
        <div class="bj-shoprow">${g.shop.vouchers.map((it, i) => balShopCardHtml(g, it, 'voucher', i)).join('')}</div>` : ''}
    </div>
    ${balSideHtml(g)}`;
}

// ---------- pack opening ----------
function balRenderPack(g) {
    const p = g.pack;
    return `${balTopBar(g)}
    <div class="bj-shop">
        <div class="bj-shophead">
            <h3>${escapeHtml(p.def.name)}</h3>
            <span class="bj-label">picks left: ${p.picks}</span>
            <button class="bj-btn bj-ghost" data-act="skippack">skip</button>
        </div>
        <div class="bj-shoprow">${p.cards.map((item, i) => {
        if (p.taken.includes(i)) return `<div class="bj-shopitem taken"><div class="bj-empty">taken</div></div>`;
        let inner;
        if (item.type === 'joker') inner = balJokerHtml(g, { def: item.def, counter: item.def.counter || 0, edition: item.edition, extraValue: 0 }, i);
        else if (item.type === 'card') inner = `<div class="bj-shopcard-card">${balCardHtml(item.card, { reveal: true })}</div>`;
        else inner = balConHtml(g, item.con);
        return `<div class="bj-shopitem" data-pack="${i}">${inner}<button class="bj-btn bj-buy">take</button></div>`;
    }).join('')}</div>
        ${p.def.kind === 'tarot' || p.def.kind === 'spectral' ? '<p class="bj-hint">select cards in your hand first if the card needs targets</p>' : ''}
    </div>
    ${g.screen === 'pack' && g.hand.length ? `<div class="bj-hand small">${g.hand.map(c => balCardHtml(c, { selected: g.selected.includes(c), reveal: true })).join('')}</div>` : ''}`;
}

// ---------- side panel: hand levels ----------
function balSideHtml(g) {
    return `<details class="bj-side"><summary>poker hands &amp; levels</summary>
        <div class="bj-levels">${BAL.HAND_ORDER.map(k => {
        const v = balHandValues(g, k);
        const played = g.handPlays[k] || 0;
        if (BAL.HANDS[k].chips >= 120 && !played && k !== 'straight_flush') return '';
        return `<div class="bj-level"><span class="bj-lvlname">${escapeHtml(BAL.HANDS[k].name)}</span>
                <span class="bj-lvlnum">lvl ${v.level}</span>
                <span class="bj-lvlval">${v.chips} X ${v.mult}</span>
                <span class="bj-lvlplays">${played}</span></div>`;
    }).join('')}</div></details>`;
}

// ---------- run info ----------
function balRenderInfo(g) {
    const s = g.stats;
    return `${balTopBar(g)}
    <div class="bj-info">
        <h3>run info</h3>
        <div class="bj-inforow"><span>seed</span><b>${escapeHtml(g.seed)}</b></div>
        <div class="bj-inforow"><span>deck</span><b>${escapeHtml(BAL.DECKS.find(d => d.id === g.deckId).name)}</b></div>
        <div class="bj-inforow"><span>stake</span><b>${escapeHtml(BAL.STAKES.find(x => x.id === g.stake).name)}</b></div>
        <div class="bj-inforow"><span>hands played</span><b>${s.handsPlayed}</b></div>
        <div class="bj-inforow"><span>best hand</span><b>${balNum(s.bestHandScore)}</b></div>
        <div class="bj-inforow"><span>tarots used</span><b>${s.tarotsUsed}</b></div>
        <div class="bj-inforow"><span>planets used</span><b>${s.planetsUsed}</b></div>
        <div class="bj-inforow"><span>cards sold</span><b>${s.cardsSold}</b></div>
        <div class="bj-inforow"><span>blinds skipped</span><b>${s.blindsSkipped}</b></div>
        <div class="bj-inforow"><span>deck size</span><b>${g.deck.length}</b></div>
        <p class="bj-label">vouchers</p>
        <div class="bj-vlist">${g.vouchers.length ? g.vouchers.map(v => `<span>${escapeHtml(BAL.VOUCHERS.find(x => x.id === v).name)}</span>`).join('') : '<span>none</span>'}</div>
        ${balSideHtml(g)}
        <div class="bj-inforow2">
            <button class="bj-btn" data-act="back">back</button>
            <button class="bj-btn bj-ghost" data-act="abandon">abandon run</button>
        </div>
    </div>`;
}

function balRenderOver(g) {
    return `<div class="bj-end">
        <h2 class="bj-title bj-lose">game over</h2>
        <p>you were defeated by ${escapeHtml(balBlindInfo(g, g.blindIndex).name)} on ante ${g.ante}.</p>
        <p class="bj-sub">final score ${balNum(g.score)} of ${balNum(g.required)} required. best hand ${balNum(g.stats.bestHandScore)}.</p>
        <p class="bj-sub">seed ${escapeHtml(g.seed)}</p>
        <button class="bj-btn bj-wide bj-go" data-act="menu">new run</button>
    </div>`;
}
function balRenderWon(g) {
    return `<div class="bj-end">
        <h2 class="bj-title bj-win">you win</h2>
        <p>ante 8 cleared with the ${escapeHtml(BAL.DECKS.find(d => d.id === g.deckId).name)} on ${escapeHtml(BAL.STAKES.find(x => x.id === g.stake).name)}.</p>
        <p class="bj-sub">best hand ${balNum(g.stats.bestHandScore)} · ${g.stats.handsPlayed} hands played · seed ${escapeHtml(g.seed)}</p>
        <button class="bj-btn bj-wide bj-go" data-act="endless">keep going (endless)</button>
        <button class="bj-btn bj-wide" data-act="menu">new run</button>
    </div>`;
}

function balNum(n) {
    if (n < 1000) return String(Math.floor(n));
    if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 2 : 1).replace(/\.0+$/, '') + 'k';
    if (n < 1e9) return (n / 1e6).toFixed(2).replace(/\.0+$/, '') + 'm';
    if (n < 1e12) return (n / 1e9).toFixed(2) + 'b';
    return n.toExponential(2);
}

// ===================================================================
// input
// ===================================================================
function balBind(g) {
    const b = balWinBody;
    const on = (sel, fn) => b.querySelectorAll(sel).forEach(el => el.onclick = e => { e.stopPropagation(); fn(el, e); });

    // every button on the table acknowledges the click, not just the
    // two that do something dramatic afterwards
    on('[data-act]', el => { BJFX.press(el); balAction(el.dataset.act, el); });
    on('[data-deck]', el => { g.pickDeck = el.dataset.deck; balRender(); });
    on('[data-stake]', el => { g.pickStake = +el.dataset.stake; balRender(); });

    // selecting cards in hand.
    //
    // This used to call balRender(), which rebuilt the whole table with
    // innerHTML — so the card you clicked was destroyed and recreated
    // already sitting in its raised position, and the transition it has
    // always had never played. Nothing about the table changes when you
    // pick a card except that card and the readout above it, so now
    // only those two things are touched and the card survives long
    // enough to move.
    on('.bj-hand .bj-card', el => {
        if (balAnimating) return;
        const c = g.hand.find(x => x.uid === el.dataset.uid);
        if (!c) return;
        const i = g.selected.indexOf(c);
        let picked;
        if (i >= 0) { g.selected.splice(i, 1); balSfx('deselect'); picked = false; }
        else if (g.selected.length < 5) { g.selected.push(c); balSfx('select'); picked = true; }
        else { balSfx('error'); BJFX.refuse(el); return; }
        // keep selection in the order shown on the table
        g.selected.sort((a, x) => g.hand.indexOf(a) - g.hand.indexOf(x));
        el.classList.toggle('sel', picked);
        BJFX.selectCard(el, picked);
        balUpdateReadout(g);
    });

    // jokers: click to sell (with a confirm step so it is never a slip)
    on('.bj-jokers .bj-joker', el => {
        const j = g.jokers.find(x => x.uid === el.dataset.joker);
        if (!j) return;
        if (el.classList.contains('confirm')) { balSellJoker(j.uid); return; }
        b.querySelectorAll('.bj-joker.confirm').forEach(x => x.classList.remove('confirm'));
        el.classList.add('confirm');
        el.setAttribute('data-hint', `click again to sell for $${balSellValue(j)}`);
        balSfx('select');
    });

    // consumables: click to use, shift-click to sell
    on('.bj-cons .bj-con', (el, e) => {
        if (e.shiftKey) { balSellConsumable(el.dataset.con); return; }
        balUseConsumable(el.dataset.con);
    });

    on('[data-buy]', el => balBuy(el.dataset.buy, +el.dataset.i));
    on('[data-pack]', el => balPackTake(+el.dataset.pack));
}

// plays the hand for real (balPlayHand, unchanged), then reveals the
// already-decided result as an animation before handing off to balRender —
// the animation is pure presentation, it can't affect the outcome
async function balPlayHandUI() {
    if (balAnimating) return;
    const g = BG;
    const err = balCanPlay(g);
    if (err) { balToast(g, 'jokerz', err); balSfx('error'); return; }
    balAnimating = true;
    balSfx('cardplay');
    balSuppressRender = true;
    balPlayHand();
    balSuppressRender = false;
    const ctx = g.lastScore;
    await balAnimateScoring(ctx);
    if (g.screen === 'cashout') balSfx('blindwin');
    else if (g.screen === 'won') balSfx('win');
    else if (g.screen === 'over') balSfx('gameover');
    balSave();
    balAnimating = false;
    balRender();
}

function balAction(act, el) {
    const g = BG;
    switch (act) {
        case 'start': {
            const seedEl = balWinBody.querySelector('#bj-seed');
            const seed = seedEl && seedEl.value.trim() ? seedEl.value.trim() : null;
            const deck = g.pickDeck || 'red';
            const stake = g.pickStake || 1;
            balNewRun(deck, stake, seed);
            BG.screen = 'blind';
            balSfx('newrun');
            balMusic.start();
            balSave();
            balRender();
            break;
        }
        case 'continue': if (balLoad()) { balSfx('newrun'); balMusic.start(); balRender(); } break;
        case 'select': balMusic.start(); balSelectBlind(); break;
        case 'skip': balSkipBlind(); break;
        case 'play': balPlayHandUI(); break;
        case 'discard': balDiscardUI(); break;
        case 'sort-rank': g.sortMode = 'rank'; balSortHand(g); balRender(); break;
        case 'sort-suit': g.sortMode = 'suit'; balSortHand(g); balRender(); break;
        case 'use': if (g.consumables.length) balUseConsumable(g.consumables[0].uid); break;
        case 'cashout': balSfx('money'); balCashOut(); break;
        case 'reroll': balReroll(); break;
        case 'leave': balLeaveShop(); break;
        case 'skippack': balSfx('carddiscard'); balPackClose(); break;
        case 'info': g.prevScreen = g.screen; g.screen = 'info'; balRender(); break;
        case 'back': g.screen = g.prevScreen || 'blind'; balRender(); break;
        case 'abandon': balMusic.stop(); balSaveClear(); BG = { screen: 'menu', pickDeck: 'red', pickStake: 1 }; balRender(); break;
        case 'menu': balMusic.stop(); balSaveClear(); BG = { screen: 'menu', pickDeck: 'red', pickStake: 1 }; balRender(); break;
        case 'endless': g.screen = 'blind'; g.ante++; g.blindIndex = 0; balRollBoss(g); balRender(); break;
        case 'music': balMusic.toggle(); balSfx('select'); balRender(); break;
    }
}

// ===================================================================
// sound — every effect and the background loop are synthesized with the
// Web Audio API, no audio files. Nothing here is a Balatro sample; it's
// an original chiptune-ish sound bank built to fit the win98 aesthetic.
// Respects the site's global mute (the `soundEnabled` toggle in the tray).
// ===================================================================
let balActx = null;
function balAudioCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!balActx) balActx = new AC();
    if (balActx.state === 'suspended') balActx.resume().catch(() => { });
    return balActx;
}
function balSoundOn() {
    return typeof soundEnabled === 'undefined' ? true : soundEnabled;
}

// a single tone with a short percussive envelope
function balTone(freq, dur, opts) {
    if (!balSoundOn()) return;
    const ctx = balAudioCtx();
    if (!ctx) return;
    opts = opts || {};
    try {
        const t0 = ctx.currentTime + (opts.delay || 0);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = opts.type || 'square';
        osc.frequency.setValueAtTime(Math.max(1, freq), t0);
        if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + dur);
        const peak = opts.gain !== undefined ? opts.gain : 0.09;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.015, dur / 3));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    } catch (e) { /* audio can fail quietly on locked-down browsers */ }
}
function balChord(freqs, dur, opts) { freqs.forEach(f => balTone(f, dur, opts)); }

// a short filtered noise burst, used for whooshes (card play/discard, reroll)
function balNoiseBurst(dur, opts) {
    if (!balSoundOn()) return;
    const ctx = balAudioCtx();
    if (!ctx) return;
    opts = opts || {};
    try {
        const t0 = ctx.currentTime + (opts.delay || 0);
        const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buf = ctx.createBuffer(1, n, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(opts.filterStart || 4000, t0);
        if (opts.filterEnd) filter.frequency.exponentialRampToValueAtTime(opts.filterEnd, t0 + dur);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(opts.gain || 0.12, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
        src.start(t0);
    } catch (e) { }
}

// the sound bank: every distinct in-game event gets its own short cue
function balSfx(name, opts) {
    opts = opts || {};
    switch (name) {
        case 'select': balTone(880, 0.05, { type: 'square', gain: 0.06 }); break;
        case 'deselect': balTone(520, 0.05, { type: 'square', gain: 0.05 }); break;
        case 'cardtick': balTone(600 + Math.min(8, opts.pitch || 0) * 22, 0.07, { type: 'triangle', gain: 0.08 }); break;
        case 'chip': balTone(700 + Math.random() * 60, 0.055, { type: 'square', gain: 0.065 }); break;
        case 'mult': balTone(340, 0.09, { type: 'sawtooth', gain: 0.08, slideTo: 240 }); break;
        case 'xmult': balChord([392, 587], 0.14, { type: 'sawtooth', gain: 0.09 }); break;
        case 'money': balTone(1046, 0.06, { type: 'square', gain: 0.08 }); balTone(1568, 0.09, { type: 'square', gain: 0.08, delay: 0.05 }); break;
        case 'joker': balTone(500, 0.08, { type: 'sine', gain: 0.07, slideTo: 900 }); break;
        case 'total': balChord([523, 659, 784], 0.32, { type: 'square', gain: 0.1 }); break;
        case 'cardplay': balNoiseBurst(0.16, { filterStart: 3200, filterEnd: 800, gain: 0.1 }); break;
        case 'carddiscard': balNoiseBurst(0.14, { filterStart: 1800, filterEnd: 300, gain: 0.09 }); break;
        case 'buy': balTone(660, 0.05, { type: 'square', gain: 0.07 }); balTone(990, 0.08, { type: 'square', gain: 0.07, delay: 0.05 }); break;
        case 'sell': balTone(880, 0.05, { type: 'triangle', gain: 0.07 }); balTone(660, 0.08, { type: 'triangle', gain: 0.06, delay: 0.05 }); break;
        case 'reroll': balNoiseBurst(0.18, { filterStart: 2500, filterEnd: 2500, gain: 0.08 }); balTone(440, 0.05, { type: 'square', gain: 0.05, delay: 0.05 }); break;
        case 'packopen': balTone(392, 0.08, { type: 'triangle', gain: 0.07 }); balTone(523, 0.08, { type: 'triangle', gain: 0.07, delay: 0.06 }); balTone(659, 0.1, { type: 'triangle', gain: 0.07, delay: 0.12 }); break;
        case 'take': balTone(880, 0.07, { type: 'triangle', gain: 0.07 }); break;
        case 'use': balTone(700, 0.06, { type: 'sine', gain: 0.07 }); balTone(1050, 0.08, { type: 'sine', gain: 0.06, delay: 0.05 }); balTone(1400, 0.1, { type: 'sine', gain: 0.05, delay: 0.1 }); break;
        case 'blindselect': balTone(220, 0.16, { type: 'triangle', gain: 0.08 }); balTone(165, 0.22, { type: 'triangle', gain: 0.07, delay: 0.08 }); break;
        case 'newrun': balTone(392, 0.08, { type: 'triangle', gain: 0.07 }); balTone(523, 0.08, { type: 'triangle', gain: 0.07, delay: 0.06 }); balTone(784, 0.14, { type: 'triangle', gain: 0.07, delay: 0.12 }); break;
        case 'blindwin': balChord([523, 659, 784], 0.22, { type: 'square', gain: 0.09 }); break;
        case 'gameover': balTone(392, 0.18, { type: 'sawtooth', gain: 0.09, slideTo: 220 }); balTone(220, 0.3, { type: 'sawtooth', gain: 0.08, delay: 0.16, slideTo: 110 }); break;
        case 'win': balTone(523, 0.12, { type: 'square', gain: 0.1 }); balTone(659, 0.12, { type: 'square', gain: 0.1, delay: 0.11 }); balTone(784, 0.12, { type: 'square', gain: 0.1, delay: 0.22 }); balTone(1046, 0.3, { type: 'square', gain: 0.11, delay: 0.33 }); break;
        case 'error': balTone(180, 0.12, { type: 'sawtooth', gain: 0.08 }); balTone(140, 0.14, { type: 'sawtooth', gain: 0.07, delay: 0.06 }); break;
    }
}

// a short, fixed 16-step lounge-ish loop (bass + a soft arp on top), scheduled
// with a lookahead timer so it can't drift or stack notes if a tab stalls
const balMusic = (() => {
    let playing = false, timer = null, nextTime = 0, step = 0;
    const bpm = 96, stepDur = 60 / bpm / 2;
    const bassPat = [110, 0, 110, 0, 82.4, 0, 82.4, 0, 98, 0, 98, 0, 73.4, 0, 98, 0];
    const arpPat = [660, 0, 554, 0, 494, 0, 440, 0, 587, 0, 494, 0, 440, 0, 554, 0];
    function note(freq, time, dur, type, peak) {
        const ctx = balAudioCtx();
        if (!ctx) return;
        try {
            const osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.type = type; osc.frequency.setValueAtTime(freq, time);
            gain.gain.setValueAtTime(0.0001, time);
            gain.gain.exponentialRampToValueAtTime(peak, time + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(time); osc.stop(time + dur + 0.02);
        } catch (e) { }
    }
    function tick() {
        const ctx = balAudioCtx();
        if (!ctx) return;
        while (nextTime < ctx.currentTime + 0.12) {
            if (balSoundOn()) {
                const b = bassPat[step % bassPat.length];
                const a = arpPat[step % arpPat.length];
                if (b) note(b, nextTime, stepDur * 1.8, 'triangle', 0.045);
                if (a) note(a, nextTime, stepDur * 2.6, 'sine', 0.026);
            }
            step++;
            nextTime += stepDur;
        }
    }
    return {
        start() {
            if (playing || localStorage.getItem('jokerz98-music') === 'off') return;
            const ctx = balAudioCtx();
            if (!ctx) return;
            playing = true; step = 0; nextTime = ctx.currentTime + 0.1;
            timer = setInterval(tick, 100);
        },
        stop() { playing = false; if (timer) clearInterval(timer); timer = null; },
        toggle() {
            const wasOn = localStorage.getItem('jokerz98-music') !== 'off';
            localStorage.setItem('jokerz98-music', wasOn ? 'off' : 'on');
            if (wasOn) this.stop(); else this.start();
        },
        isOn: () => localStorage.getItem('jokerz98-music') !== 'off'
    };
})();

// ===================================================================
// scoring animation — plays back the log balScoreHand already recorded
// (nothing here changes the outcome, it only reveals it) with a quick
// left-to-right flash across the played cards, then a tally through
// every scoring step with a matching sound and a pulse on whichever
// joker earned it, before handing off to the real render.
// ===================================================================
function balAnimateScoring(ctx) {
    return new Promise(resolve => {
        if (!balWinBody || !ctx || !ctx.log || !ctx.log.length) { resolve(); return; }
        const chipsEl = balWinBody.querySelector('.bj-chips');
        const multEl = balWinBody.querySelector('.bj-mult');
        if (!chipsEl || !multEl) { resolve(); return; }
        const readout = balWinBody.querySelector('.bj-readout');
        balWinBody.classList.add('bj-animating');

        const cardEls = [...balWinBody.querySelectorAll('.bj-hand .bj-card.sel')];
        const jokerEls = [...balWinBody.querySelectorAll('.bj-jokers .bj-joker')];
        const findJokerEl = name => jokerEls.find(el => {
            const n = el.querySelector('.bj-joker-name');
            return n && n.textContent === name;
        });

        const rows = ctx.log;
        const perStep = Math.max(30, Math.min(120, Math.floor(1100 / rows.length)));
        const cardStep = Math.max(55, Math.min(130, perStep));
        const phaseADuration = cardEls.length ? cardEls.length * cardStep + 120 : 0;

        cardEls.forEach((el, i) => {
            setTimeout(() => {
                if (!balWinBody) return;
                el.classList.add('bj-scoring-pulse');
                BJFX.scorePulse(el);
                balSfx('cardtick', { pitch: i });
                setTimeout(() => el.classList.remove('bj-scoring-pulse'), 220);
            }, i * cardStep);
        });

        let step = 0;
        const finish = () => {
            if (balWinBody) {
                chipsEl.textContent = balNum(Math.round(ctx.chips));
                multEl.textContent = balMultText(ctx.mult);
                balSfx('total');
                if (readout) readout.classList.add('bj-finale');
                BJFX.pop(readout, { scale: 1.06, duration: 320 });
                hitTheBlind();
            }
            setTimeout(() => {
                if (readout) readout.classList.remove('bj-finale');
                if (balWinBody) balWinBody.classList.remove('bj-animating');
                resolve();
            }, BJFX.on() ? 620 : 260);
        };
        // the blind is what you are fighting, so the total lands on it as
        // damage: the bar takes a knock, the fill runs up to where the
        // score now is, and the number floats off it. balPlayHand has
        // already moved g.score — this is showing what it did.
        const hitTheBlind = () => {
            const g = BG;
            const bar = balWinBody.querySelector('.bj-blindbar');
            const fill = balWinBody.querySelector('.bj-progress-fill');
            const scoreEl = balWinBody.querySelector('.bj-blindbar-score');
            const total = ctx.total || 0;
            const before = Math.max(0, g.score - total);
            if (scoreEl) BJFX.countTo(scoreEl, g.score, {
                from: before, duration: 520, format: v => balNum(Math.round(v)) + ' / ' + balNum(g.required)
            });
            BJFX.damage(bar, fill, {
                percent: Math.min(100, (g.score / g.required) * 100),
                amount: total, required: g.required,
                text: '-' + balNum(Math.round(total))
            });
        };
        const tally = () => {
            if (!balWinBody || step >= rows.length) { finish(); return; }
            const row = rows[step];
            const prev = step > 0 ? rows[step - 1] : { chips: 0, mult: 0 };
            const dChips = row.chips - prev.chips;
            const dMult = +(row.mult - prev.mult).toFixed(4);
            chipsEl.textContent = balNum(Math.round(row.chips));
            multEl.textContent = balMultText(row.mult);
            chipsEl.classList.remove('tick'); void chipsEl.offsetWidth; chipsEl.classList.add('tick');
            multEl.classList.remove('tick'); void multEl.offsetWidth; multEl.classList.add('tick');
            const v = String(row.v || '');
            if (v.startsWith('+$')) balSfx('money');
            else if (dMult > 0) balSfx(v.startsWith('X') ? 'xmult' : 'mult');
            else if (dChips > 0) balSfx('chip');
            else balSfx('joker');
            const je = findJokerEl(row.t);
            if (je) {
                je.classList.add('bj-trigger-pulse');
                BJFX.trigger(je);
                // what it actually did, floating off the joker that did it
                if (v) BJFX.floatOff(je, v, {
                    color: v.startsWith('+$') ? '#ffd400' : v.startsWith('X') ? '#ff5c5c' : '#0df259', up: 30
                });
                setTimeout(() => je.classList.remove('bj-trigger-pulse'), 260);
            }
            BJFX.pop(dMult > 0 ? multEl : chipsEl, { scale: 1.22, duration: 200 });
            step++;
            setTimeout(tally, perStep);
        };
        setTimeout(tally, phaseADuration);
    });
}
function balMultText(m) { const r = Math.round(m * 100) / 100; return Number.isInteger(r) ? String(r) : r.toFixed(2); }

// ===================================================================
// entry point
// ===================================================================
function startBalatro() {
    const { body, win } = createAppWindow('jokerz 98', { icon: 'casino', width: 780 });
    body.classList.add('bj-body');
    balWinBody = body;
    win._cleanup = () => { balSave(); balMusic.stop(); balWinBody = null; };
    if (!BG || BG.over) BG = { screen: 'menu', pickDeck: 'red', pickStake: 1 };
    balRender();
    if (BG.screen !== 'menu') balMusic.start();
    if (typeof unlockAchievement === 'function') unlockAchievement('jokerz');
}
