// ===================================================================
// check-sigils.mjs — does the recogniser read a bad drawing?
//
// Every one of the fifty symbols gets drawn a few hundred times by a pretend hand:
// any angle, any size, strokes in any order and either way round, a wobble, a
// tremor, corners rounded off, a circle that stops short of itself, a second stroke
// that lands a little to one side. The answers go in a confusion matrix, and the
// matrix is what gets held to targets. Seeds are fixed, so a number only moves when
// the symbols or the recogniser do.
//
// A fizzle costs you a moment. A spell you did not ask for costs you the ink and the
// exchange, so those two rates are held separately.
//
//   node .github/scripts/check-sigils.mjs           the checks
//   SIGIL_REPORT=1 node ...                         and the whole matrix
//
// The full matrix also lands in .ci-shots/sigil-confusion.json, which CI keeps.
// ===================================================================
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let checks = 0, failures = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');
const pct = n => (n * 100).toFixed(1) + '%';

const window = {};
const ctx = vm.createContext({ window, console, Math, Float64Array, Uint8Array, Set, Object, Array, Number });
vm.runInContext(read('games/wizardz/wizardz-data.js'), ctx);
vm.runInContext(read('games/wizardz/wizardz-sigil.js'), ctx);
const D = window.WZ, R = window.WZ_SIGIL;
const SPELLS = D.SPELLS;

function mulberry(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// One person's one attempt. level 0 is a ruler and level 1 is a phone on a bus.
function hand(glyph, rnd, level) {
    const pick = (a, b) => a + (b - a) * rnd();
    const angle = rnd() * Math.PI * 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    const scale = pick(0.4, 3);
    const sx = 1 + pick(-0.14, 0.14) * level, sy = 1 + pick(-0.14, 0.14) * level;
    const shear = pick(-0.1, 0.1) * level;
    const ox = pick(-300, 300), oy = pick(-300, 300);
    const out = glyph.map(raw => {
        let st = raw.map(p => ({ x: p.x, y: p.y }));
        // a closed shape can start anywhere
        const closed = Math.hypot(st[0].x - st[st.length - 1].x, st[0].y - st[st.length - 1].y) < 2;
        if (closed) {
            const k = Math.floor(rnd() * (st.length - 1));
            st = st.slice(k, st.length - 1).concat(st.slice(0, k + 1));
        }
        if (rnd() < 0.5) st.reverse();
        // stopping short of it, or a little past it
        const trim = pick(-0.03, 0.09) * level;
        if (trim > 0) st = st.slice(0, Math.max(3, Math.floor(st.length * (1 - trim))));
        else if (trim < 0 && st.length > 2) {
            const a = st[st.length - 2], b = st[st.length - 1];
            st.push({ x: b.x + (b.x - a.x) * 4, y: b.y + (b.y - a.y) * 4 });
        }
        // each stroke lands a little off from the last, and a little the wrong size
        const dx = pick(-5.5, 5.5) * level * (glyph.length > 1 ? 1 : 0), dy = pick(-5.5, 5.5) * level * (glyph.length > 1 ? 1 : 0);
        const k = 1 + pick(-0.11, 0.11) * level * (glyph.length > 1 ? 1 : 0);
        let mx = 0, my = 0;
        st.forEach(p => { mx += p.x; my += p.y; });
        mx /= st.length; my /= st.length;
        // a hand wanders slowly, and shakes quickly
        const wa = 4.2 * level * rnd(), wf = 1 + rnd() * 2.5, wp = rnd() * 6.28, wq = rnd() * 6.28;
        const pts = [];
        const total = st.length;
        for (let i = 0; i < total; i++) {
            if (i > 0 && i < total - 1 && rnd() < 0.22 * level) continue;   // a fast bit of line
            const p = st[i], u = i / total;
            pts.push({
                x: (p.x - mx) * k + mx + dx + Math.sin(u * 6.28 * wf + wp) * wa + pick(-1.4, 1.4) * level,
                y: (p.y - my) * k + my + dy + Math.cos(u * 6.28 * wf + wq) * wa + pick(-1.4, 1.4) * level
            });
        }
        return pts;
    });
    // order of strokes does not count either
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out.map(st => st.map(p => {
        const x = (p.x - 50) * sx + (p.y - 50) * shear, y = (p.y - 50) * sy;
        return { x: (x * c - y * s) * scale + ox, y: (x * s + y * c) * scale + oy };
    }));
}

// a panic scrub, and a slower wander. neither of these is a spell
function scribble(rnd) {
    const strokes = [];
    for (let s = 0; s < 1 + Math.floor(rnd() * 2); s++) {
        const pts = [];
        let x = rnd() * 100, y = rnd() * 100;
        for (let i = 0; i < 12 + Math.floor(rnd() * 20); i++) {
            x = Math.max(0, Math.min(100, x + (rnd() - 0.5) * 34));
            y = Math.max(0, Math.min(100, y + (rnd() - 0.5) * 34));
            pts.push({ x, y });
        }
        strokes.push(pts);
    }
    return strokes;
}
function doodle(rnd) {
    const pts = [];
    let x = 20 + rnd() * 60, y = 20 + rnd() * 60, a = rnd() * Math.PI * 2;
    for (let i = 0; i < 20 + Math.floor(rnd() * 25); i++) {
        a += (rnd() - 0.5) * 1.2;
        x = Math.max(2, Math.min(98, x + Math.cos(a) * 9));
        y = Math.max(2, Math.min(98, y + Math.sin(a) * 9));
        pts.push({ x, y });
    }
    return [pts];
}

function matrix(level, per, seed, pool) {
    const rnd = mulberry(seed);
    const ids = SPELLS.map(s => s.id);
    const m = {};
    ids.forEach(a => { m[a] = {}; });
    let n = 0, right = 0, top1 = 0, wrong = 0, fizz = 0;
    const list = pool ? SPELLS.filter(s => pool.includes(s.id)) : SPELLS;
    for (const s of list) {
        for (let k = 0; k < per; k++) {
            const drawn = hand(s.glyph, rnd, level);
            const res = R.decide(drawn, pool || undefined);
            n++;
            if (res.top === s.id) top1++;
            if (res.ok && res.id === s.id) right++;
            else if (res.ok) { wrong++; m[s.id][res.id] = (m[s.id][res.id] || 0) + 1; }
            else {
                fizz++;
                if (res.why === 'split') m[s.id][res.id === s.id ? res.id2 : res.id] = (m[s.id][res.id === s.id ? res.id2 : res.id] || 0) + 0.25;
                else if (res.id && res.id !== s.id) m[s.id][res.id] = (m[s.id][res.id] || 0) + 0.25;
            }
        }
    }
    return { n, right: right / n, top1: top1 / n, wrong: wrong / n, fizz: fizz / n, m };
}
function worstPairs(m, n = 8) {
    const pairs = [];
    const seen = new Set();
    for (const a of Object.keys(m)) for (const b of Object.keys(m[a])) {
        const k = [a, b].sort().join('~');
        if (seen.has(k)) continue;
        seen.add(k);
        pairs.push([k, (m[a][b] || 0) + ((m[b] || {})[a] || 0)]);
    }
    return pairs.sort((x, y) => y[1] - x[1]).slice(0, n);
}
function perSpell(res, per) {
    return SPELLS.map(s => {
        const wrong = Object.values(res.m[s.id]).reduce((a, b) => a + b, 0);
        return [s.id, wrong / per];
    }).sort((a, b) => b[1] - a[1]);
}

// ===================================================================
section('the fifty symbols');
// ===================================================================
{
    expect(SPELLS.length === 50, 'there are fifty', String(SPELLS.length));
    const problems = [];
    for (const s of SPELLS) {
        if (!Array.isArray(s.glyph) || !s.glyph.length) { problems.push(s.id + ': no symbol'); continue; }
        if (s.glyph.length > 4) problems.push(s.id + ': ' + s.glyph.length + ' strokes is too many for a firefight');
        for (const st of s.glyph) for (const p of st) {
            if (!(p.x >= -8 && p.x <= 108 && p.y >= -8 && p.y <= 108)) { problems.push(s.id + ': outside the box'); break; }
        }
    }
    expect(!problems.length, 'all of them can be drawn in a hurry', problems.join(', '));
    const sizes = SPELLS.map(s => s.glyph.length);
    console.log('        strokes: ' + [1, 2, 3, 4].map(k => k + ' stroke ' + sizes.filter(v => v === k).length).join(', '));
    expect(sizes.filter(v => v <= 2).length >= 34, 'and most take one or two strokes', sizes.filter(v => v <= 2).length + ' of 50');
    expect(new Set(SPELLS.map(s => JSON.stringify(s.glyph))).size === 50, 'and no two are the same drawing');
}

// ===================================================================
section('order, direction, size and angle do not count');
// ===================================================================
{
    const rnd = mulberry(99);
    const bad = [];
    for (const s of SPELLS) {
        const clean = R.recognize(s.glyph);
        if (!clean.length || clean[0].id !== s.id) bad.push(s.id + ' read as ' + (clean[0] && clean[0].id));
        // perfect drawing, every sort of transformation
        for (let i = 0; i < 6; i++) {
            const a = rnd() * 6.28, c = Math.cos(a), si = Math.sin(a), k = 0.3 + rnd() * 4;
            const st = s.glyph.map(g => (rnd() < 0.5 ? g.slice().reverse() : g.slice()).map(p => ({ x: (p.x * c - p.y * si) * k + 500, y: (p.x * si + p.y * c) * k - 200 })));
            if (rnd() < 0.5) st.reverse();
            const res = R.recognize(st);
            if (res[0].id !== s.id) { bad.push(s.id + ' turned ' + Math.round(a * 57) + ' read as ' + res[0].id); break; }
            if (res[0].score < 0.8) { bad.push(s.id + ' turned ' + Math.round(a * 57) + ' only scored ' + res[0].score.toFixed(2)); break; }
        }
    }
    expect(!bad.length, 'a perfect drawing reads as itself at any angle, size, order and direction', bad.slice(0, 12).join('; '));
    const shaken = [];
    for (const s of SPELLS) {
        let lo = 9, hi = -9;
        for (let a = 0; a < 360; a += 15) {
            const c = Math.cos(a * Math.PI / 180), si = Math.sin(a * Math.PI / 180);
            const res = R.recognize(s.glyph.map(g => g.map(p => ({ x: p.x * c - p.y * si, y: p.x * si + p.y * c }))));
            const me = res.find(x => x.id === s.id);
            const v = me ? me.score : 0;
            lo = Math.min(lo, v); hi = Math.max(hi, v);
        }
        if (hi - lo > 0.15) shaken.push(s.id + ' ' + lo.toFixed(2) + '..' + hi.toFixed(2));
    }
    expect(!shaken.length, 'and the score hardly moves as it turns, including at exactly upright', shaken.join(', '));
    const junk = [null, undefined, 3, [], [null], [[]], [[{ x: 4, y: 4 }]], [[{ x: 4, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 4 }]], [[{ x: NaN, y: 4 }, { x: 1, y: Infinity }]], 'x'];
    let threw = null;
    for (const j of junk) { try { const r = R.decide(j); if (r.ok) threw = 'cast something from ' + JSON.stringify(j); } catch (e) { threw = e.message; } }
    expect(!threw, 'nonsense is not a spell and does not throw', threw || '');
    const dot = R.decide([[{ x: 10, y: 10 }, { x: 10.1, y: 10.1 }]]);
    expect(!dot.ok, 'and neither is a tap', JSON.stringify({ ok: dot.ok, why: dot.why }));
}

// ===================================================================
section('the confusion matrix');
// ===================================================================
const PER = Number(process.env.SIGIL_PER || 24);
const tidy = matrix(0.4, PER, 20261104);
const usual = matrix(0.7, PER, 424242);
const awful = matrix(1, PER, 7777);
for (const [name, r] of [['tidy', tidy], ['usual', usual], ['awful', awful]]) {
    console.log(`        ${name.padEnd(6)} ${r.n} drawings: right ${pct(r.right)}, top guess ${pct(r.top1)}, fizzled ${pct(r.fizz)}, WRONG SPELL ${pct(r.wrong)}`);
}
console.log('        most confused (usual): ' + worstPairs(usual.m).map(([k, v]) => k + ' ' + v).join(', '));
console.log('        most confused (awful): ' + worstPairs(awful.m).map(([k, v]) => k + ' ' + v).join(', '));
console.log('        hardest to draw (usual): ' + perSpell(usual, PER).slice(0, 8).map(([k, v]) => k + ' ' + pct(v)).join(', '));
if (process.env.SIGIL_REPORT) {
    for (const s of SPELLS) {
        const row = Object.entries(usual.m[s.id]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + ':' + v).join(' ');
        console.log('        ' + s.id.padEnd(16) + row);
    }
}
try {
    fs.mkdirSync(path.join(ROOT, '.ci-shots'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, '.ci-shots', 'sigil-confusion.json'), JSON.stringify({ tidy, usual, awful }, null, 1));
} catch (e) { /* only a convenience */ }

expect(tidy.right >= 0.94, 'a tidy hand gets what it drew', pct(tidy.right));
expect(tidy.wrong <= 0.003, 'and almost never the wrong spell', pct(tidy.wrong));
expect(usual.right >= 0.9, 'an ordinary hand gets it nine times in ten', pct(usual.right));
expect(usual.top1 >= 0.97, 'and even when it fizzles, the first guess was right', pct(usual.top1));
expect(usual.wrong <= 0.01, 'with one in a hundred going wrong', pct(usual.wrong));
expect(awful.top1 >= 0.9, 'a phone on a bus still gets the first guess right', pct(awful.top1));
expect(awful.wrong <= 0.02, 'and a bad drawing fizzles rather than firing the wrong spell', pct(awful.wrong));
{
    const hardest = perSpell(usual, PER)[0];
    expect(hardest[1] <= 0.25, 'no symbol is much harder than the rest', hardest[0] + ' ' + pct(hardest[1]));
    const pairs = worstPairs(usual.m, 1)[0];
    expect(!pairs || pairs[1] <= PER * 0.4, 'and no pair of symbols keeps being taken for each other', pairs ? pairs.join(' ') : '');
}

// ===================================================================
section('what you actually play with');
//
// You take eight into a match, so that is the matrix a player meets.
// ===================================================================
{
    const rnd = mulberry(1234);
    let right = 0, wrong = 0, n = 0;
    const shuffle = () => {
        const ids = SPELLS.map(s => s.id);
        for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
        return ids.slice(0, D.LOADOUT_SIZE);
    };
    const pools = [D.DEFAULT_LOADOUT, ...D.BOTS.map(b => b.style.pool), ...Array.from({ length: 24 }, shuffle)];
    for (const pool of pools) {
        const r = matrix(0.7, 10, 500 + n, pool);
        right += r.right * r.n; wrong += r.wrong * r.n; n += r.n;
    }
    expect(right / n >= 0.92, 'with eight in the book, an ordinary hand gets what it drew', pct(right / n) + ' over ' + pools.length + ' loadouts');
    expect(wrong / n <= 0.006, 'and the wrong spell nearly never', pct(wrong / n));
    const off = SPELLS.find(s => !D.DEFAULT_LOADOUT.includes(s.id) && s.id === 'oblivion');
    const notPacked = R.decide(off.glyph, D.DEFAULT_LOADOUT);
    expect(!notPacked.ok && notPacked.why === 'book' && notPacked.id === 'oblivion', 'a real symbol you did not pack is not cast as something else, and you are told', JSON.stringify({ why: notPacked.why, id: notPacked.id }));
}

// ===================================================================
section('things that are not spells');
// ===================================================================
{
    const rate = (gen, n, seed, pool) => {
        const rnd = mulberry(seed);
        let fired = 0;
        for (let i = 0; i < n; i++) if (R.decide(gen(rnd), pool).ok) fired++;
        return fired / n;
    };
    const scrub = rate(scribble, 300, 1234), wander = rate(doodle, 300, 5678);
    expect(scrub <= 0.03, 'a panic scribble does not cast', pct(scrub));
    expect(wander <= 0.3, 'and an idle doodle usually does not', pct(wander));
    const packed = rate(doodle, 300, 91, D.DEFAULT_LOADOUT);
    expect(packed <= 0.1, 'and with eight in the book, a doodle has less to land on', pct(packed));
}

// ===================================================================
section('power comes from how clean it was');
// ===================================================================
{
    expect(R.qualityOf(R.CAST_FLOOR) === 0, 'scraping through is the weakest spell');
    expect(R.qualityOf(R.CLEAN) === 1, 'and a clean one is the strongest');
    const rnd = mulberry(4);
    const mean = l => { let t = 0, n = 0; for (const s of SPELLS) for (let i = 0; i < 6; i++) { const r = R.recognize(hand(s.glyph, rnd, l)); const m = r.find(x => x.id === s.id); t += R.qualityOf(m ? m.score : 0); n++; } return t / n; };
    const good = mean(0.2), bad = mean(1);
    expect(good > bad + 0.1, 'a careful hand does better than a hurried one', good.toFixed(2) + ' against ' + bad.toFixed(2));
    expect(good >= 0.6, 'and it is not hard to do well', good.toFixed(2));
}

// ===================================================================
section('how long it takes');
// ===================================================================
{
    const rnd = mulberry(8);
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 3; i++) for (const s of SPELLS) { R.decide(hand(s.glyph, rnd, 0.7), D.DEFAULT_LOADOUT); n++; }
    const ms = (performance.now() - t0) / n;
    console.log('        ' + ms.toFixed(1) + 'ms a drawing');
    expect(ms < 80, 'reading a drawing does not drop frames you would miss', ms.toFixed(1) + 'ms');
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
