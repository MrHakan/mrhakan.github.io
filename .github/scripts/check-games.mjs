// ===================================================================
// check-games.mjs — the test suite for the multiplayer half of the site
//
// There is no build step here and no test framework, so this script is
// both. It loads the real game files the same way the browser does and
// then asks the awkward questions:
//
//   · do all fifty spells exist, with sane numbers and legal effects?
//   · can the recogniser actually tell the fifty sigils apart, including
//     when they are drawn by a shaky hand? this is the one that matters:
//     two sigils that look alike to the recogniser make a spell
//     uncastable, and you would only find out mid-duel.
//   · is the game wired into the desktop — start menu, search, service
//     worker, run box?
//
// Run it locally with:  node .github/scripts/check-games.mjs
// ===================================================================
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

let failures = 0, checks = 0;
function ok(what) { checks++; console.log('  ok    ' + what); }
function bad(what, detail) {
    checks++; failures++;
    console.log('  FAIL  ' + what + (detail ? '\n        ' + detail : ''));
}
function expect(cond, what, detail) { cond ? ok(what) : bad(what, detail); }
function section(name) { console.log('\n== ' + name + ' =='); }

// ===================================================================
section('javascript parses');
// ===================================================================
// every directory that holds this site's own javascript. Named rather than
// discovered: the scripts moved into js/ once and this quietly stopped
// checking thirteen files, which is not a thing a syntax check should be
// able to do silently.
const JS_DIRS = ['', 'js', 'games', 'server'];
// games/ has a folder per game, so this walks rather than lists — the last
// time it only listed, thirteen files quietly stopped being checked
function jsUnder(dir, depth) {
    const abs = dir ? path.join(ROOT, dir) : ROOT;
    if (!fs.existsSync(abs)) return [];
    const out = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = dir ? dir + '/' + entry.name : entry.name;
        if (entry.isDirectory()) {
            if (depth > 0 && dir) out.push(...jsUnder(rel, depth - 1));
        } else if (entry.name.endsWith('.js')) out.push(rel);
    }
    return out;
}
const JS_FILES = JS_DIRS.flatMap(dir => jsUnder(dir, 2));
expect(JS_FILES.length >= 30, 'the syntax check can see the whole site', JS_FILES.length + ' files');
expect(JS_FILES.some(f => /^games\/[a-z-]+\//.test(f)),
    'including the games in their own folders', JS_FILES.filter(f => f.startsWith('games/')).join(', '));
expect(JS_FILES.some(f => f.startsWith('js/')) && JS_FILES.some(f => f.startsWith('games/')),
    'including both js/ and games/');
for (const f of JS_FILES) {
    try {
        execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' });
        ok(f);
    } catch (e) {
        bad(f, String(e.stderr || e.message).split('\n').slice(0, 3).join('\n        '));
    }
}

// ===================================================================
section('game files load');
// ===================================================================
// a browser-shaped hole for the game files to be poured into
function makeWindow() {
    const store = new Map();
    const win = {
        addEventListener() { }, removeEventListener() { },
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k)
        },
        location: { search: '', origin: 'https://mrhakan.github.io', pathname: '/' },
        crypto: globalThis.crypto,
        performance: globalThis.performance,
        BroadcastChannel: function () { },
        WebSocket: function () { }
    };
    win.window = win;
    return win;
}
const win = makeWindow();
function loadInto(w, file) {
    // eslint-disable-next-line no-new-func
    new Function('window', 'localStorage', 'performance', read(file))(w, w.localStorage, w.performance);
}
try { loadInto(win, 'games/netplay.js'); ok('games/netplay.js runs without a dom'); }
catch (e) { bad('games/netplay.js runs without a dom', e.message); }
try { loadInto(win, 'games/wizardz/wizardz-data.js'); ok('games/wizardz/wizardz-data.js runs'); }
catch (e) { bad('games/wizardz/wizardz-data.js runs', e.message); }
try { loadInto(win, 'games/wizardz/wizardz.js'); ok('games/wizardz/wizardz.js runs'); }
catch (e) { bad('games/wizardz/wizardz.js runs', e.message); }

const WZ = win.WZ;
const ENGINE = win.WZ_ENGINE;
const NP = win.Netplay;
if (!WZ || !ENGINE) {
    console.log('\nthe game did not load at all — nothing else can be checked');
    process.exit(1);
}
expect(typeof win.startWizardz === 'function', 'wizardz exposes its entry point');
expect(!!NP && typeof NP.openLobby === 'function', 'netplay exposes a lobby');
expect(!!(NP && NP.games && NP.games.wizardz), 'wizardz registered itself with netplay');

// ===================================================================
section('the fifty spells');
// ===================================================================
const S = WZ.SPELLS;
const KINDS = ['bolt', 'beam', 'wall', 'ward', 'heal', 'buff', 'hex', 'zone', 'summon', 'special'];
expect(S.length === 50, 'there are exactly 50 spells', 'found ' + S.length);
expect(new Set(S.map(s => s.id)).size === S.length, 'every spell id is unique');
expect(new Set(S.map(s => s.name)).size === S.length, 'every spell name is unique');

const elCounts = {};
let badFields = [];
for (const s of S) {
    elCounts[s.el] = (elCounts[s.el] || 0) + 1;
    if (!WZ.EL[s.el]) badFields.push(s.id + ': unknown element ' + s.el);
    if (!KINDS.includes(s.kind)) badFields.push(s.id + ': unknown kind ' + s.kind);
    if (typeof s.cost !== 'number' || s.cost < 0 || s.cost > 60) badFields.push(s.id + ': silly mana cost ' + s.cost);
    if (typeof s.cd !== 'number' || s.cd < 0 || s.cd > 40) badFields.push(s.id + ': silly cooldown ' + s.cd);
    if (s.dmg !== undefined && (s.dmg < 0 || s.dmg > WZ.ARENA.maxHp / 2)) badFields.push(s.id + ': damage out of range ' + s.dmg);
    if (!s.blurb || s.blurb.length < 10) badFields.push(s.id + ': no blurb');
    if (s.cost === 0 && !s.hp && s.kind !== 'buff' && s.kind !== 'special') badFields.push(s.id + ': free and not a buff');
    const st = (s.p && s.p.status) || (s.p && s.p.statusName);
    if (st && !WZ.STATUS[st]) badFields.push(s.id + ': unknown status ' + st);
}
expect(!badFields.length, 'every spell has sane numbers and legal effects', badFields.join('\n        '));
expect(Object.keys(elCounts).length === Object.keys(WZ.EL).length, 'every element is used',
    JSON.stringify(elCounts));
expect(WZ.DEFAULT_LOADOUT.length === 8 && WZ.DEFAULT_LOADOUT.every(id => WZ.byId(id)),
    'the default loadout is eight real spells');

// ===================================================================
section('sigils are drawable');
// ===================================================================
let glyphProblems = [];
for (const s of S) {
    const g = s.glyph;
    if (!Array.isArray(g) || !g.length) { glyphProblems.push(s.id + ': no sigil'); continue; }
    if (g.length > 6) glyphProblems.push(s.id + ': ' + g.length + ' strokes is too many to draw in a duel');
    let len = 0, pts = 0;
    for (const stroke of g) {
        if (!Array.isArray(stroke) || stroke.length < 2) { glyphProblems.push(s.id + ': a stroke with no line in it'); continue; }
        pts += stroke.length;
        for (let i = 0; i < stroke.length; i++) {
            const p = stroke[i];
            if (typeof p.x !== 'number' || typeof p.y !== 'number' || !isFinite(p.x) || !isFinite(p.y)) {
                glyphProblems.push(s.id + ': a point that is not a point'); break;
            }
            if (p.x < -6 || p.x > 106 || p.y < -6 || p.y > 106) {
                glyphProblems.push(s.id + ': point outside the 0..100 box (' + Math.round(p.x) + ',' + Math.round(p.y) + ')'); break;
            }
            if (i) len += Math.hypot(p.x - stroke[i - 1].x, p.y - stroke[i - 1].y);
        }
    }
    if (len < 60) glyphProblems.push(s.id + ': sigil is too short to be a gesture (' + Math.round(len) + ')');
    if (pts < 10) glyphProblems.push(s.id + ': sigil has too few points (' + pts + ')');
}
expect(!glyphProblems.length, 'all 50 sigils are well formed', glyphProblems.join('\n        '));

// ===================================================================
section('the recogniser can tell them apart');
// ===================================================================
const templates = ENGINE.templates();
expect(templates.length === 50, 'the recogniser built 50 templates');

// 1. a perfectly drawn sigil must come back as itself, top of the list
let selfFails = [];
for (const s of S) {
    const res = ENGINE.recognize(s.glyph);
    if (!res.length || res[0].id !== s.id) selfFails.push(s.id + ' -> ' + (res[0] ? res[0].id : 'nothing'));
}
expect(!selfFails.length, 'a clean sigil always matches itself', selfFails.join(', '));

// 2. no two templates may sit on top of each other
const feats = S.map(s => ({ id: s.id, f: ENGINE.featuresOf(s.glyph) }));
let worst = { s: 0 };
const closest = [];
for (let i = 0; i < feats.length; i++) {
    for (let j = i + 1; j < feats.length; j++) {
        const sim = ENGINE.similarity(feats[i].f, feats[j].f);
        closest.push({ a: feats[i].id, b: feats[j].id, s: sim });
        if (sim > worst.s) worst = { s: sim, a: feats[i].id, b: feats[j].id };
    }
}
closest.sort((x, y) => y.s - x.s);
const PAIR_CEILING = 0.70;
expect(worst.s < PAIR_CEILING,
    `no two sigils are more than ${PAIR_CEILING} alike`,
    'closest: ' + closest.slice(0, 3).map(p => `${p.a}~${p.b} ${p.s.toFixed(3)}`).join(', '));
console.log('        closest pairs: ' + closest.slice(0, 3).map(p => `${p.a}~${p.b} ${p.s.toFixed(3)}`).join(', '));

// 3. and they must survive being drawn badly
function mulberry(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
// rotation, aspect, a wobbly line and a few dropped points — roughly
// what a sigil looks like drawn at speed on a trackpad
function shaky(strokes, rnd, level, tiltDeg) {
    const rot = (rnd() - 0.5) * 2 * (tiltDeg === undefined ? level * 9 : tiltDeg) * Math.PI / 180;
    const sx = 1 + (rnd() - 0.5) * 0.3 * level, sy = 1 + (rnd() - 0.5) * 0.3 * level;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const wobA = level * 3.2, wobF = 1 + rnd() * 3;
    return strokes.map(st => {
        const pts = st.filter((_, i) => i === 0 || i === st.length - 1 || rnd() > 0.15 * level);
        return pts.map((p, i) => {
            const x = (p.x - 50) * sx, y = (p.y - 50) * sy;
            const rx = x * cos - y * sin, ry = x * sin + y * cos;
            return {
                x: rx + 50 + Math.sin(i / pts.length * Math.PI * wobF) * wobA + (rnd() - 0.5) * 2.4 * level,
                y: ry + 50 + Math.cos(i / pts.length * Math.PI * wobF) * wobA + (rnd() - 0.5) * 2.4 * level
            };
        });
    });
}
function trial(level, per, seed, tiltDeg) {
    const rnd = mulberry(seed);
    const misses = [], wrong = [];
    let n = 0, selfSum = 0, castable = 0;
    for (const s of S) {
        for (let k = 0; k < per; k++) {
            const res = ENGINE.recognize(shaky(s.glyph, rnd, level, tiltDeg));
            n++;
            const self = res.find(r => r.id === s.id);
            selfSum += self ? self.score : 0;
            const fires = res.length && res[0].score >= ENGINE.CAST_FLOOR &&
                (!res[1] || res[0].score - res[1].score >= ENGINE.CAST_MARGIN);
            if (fires && res[0].id === s.id) castable++;
            // a fizzle costs you a moment; a spell you did not ask for
            // costs you the mana and the exchange
            if (fires && res[0].id !== s.id) wrong.push(s.id + '->' + res[0].id);
            if (!res.length || res[0].id !== s.id) misses.push(s.id + '->' + (res[0] ? res[0].id : 'nothing'));
        }
    }
    return { n, misses, wrong, mean: selfSum / n, castable };
}
const tidy = trial(0.55, 8, 20260813);
const sloppy = trial(0.8, 8, 424242);
const awful = trial(1.0, 8, 7777);
// nobody draws upright, and this is the case the recogniser used to be
// worst at: a sigil leaning twenty degrees was a coin flip
const tilted = trial(0.6, 8, 31415, 22);
console.log(`        tidy   ${tidy.n - tidy.misses.length}/${tidy.n} right, mean score ${tidy.mean.toFixed(3)}, ${tidy.castable} would cast`);
console.log(`        sloppy ${sloppy.n - sloppy.misses.length}/${sloppy.n} right, mean score ${sloppy.mean.toFixed(3)}`);
console.log(`        awful  ${awful.n - awful.misses.length}/${awful.n} right, mean score ${awful.mean.toFixed(3)}`);
expect(!tidy.misses.length, 'a tidily drawn sigil is never mistaken for another spell', tidy.misses.slice(0, 8).join(', '));
expect(tidy.castable / tidy.n > 0.97, 'a tidily drawn sigil clears the casting threshold',
    `${tidy.castable}/${tidy.n} cleared ${ENGINE.CAST_FLOOR}`);
expect(sloppy.misses.length / sloppy.n <= 0.02, 'a sloppily drawn sigil is right at least 98% of the time',
    sloppy.misses.slice(0, 8).join(', '));
expect(awful.misses.length / awful.n <= 0.06, 'even a badly drawn sigil is right at least 94% of the time',
    awful.misses.slice(0, 8).join(', '));
console.log(`        tilted ±22° ${tilted.n - tilted.misses.length}/${tilted.n} right, ${tilted.castable} would cast`);
expect(tilted.misses.length / tilted.n <= 0.03, 'a sigil drawn at a lean is right at least 97% of the time',
    tilted.misses.slice(0, 8).join(', '));
expect(tilted.castable / tilted.n >= 0.9, 'and nine out of ten of those still cast',
    `${tilted.castable}/${tilted.n}`);

// the tilt search used to stop at ±18°, so a sigil drawn at thirty
// degrees fell off the end of it: two thirds of them cast, and the ones
// that did not were the ones firing the *wrong* spell. it reaches ±30°
// now, and this is the case that says so.
const leaning = trial(0.6, 8, 2718, 30);
console.log(`        tilted ±30° ${leaning.n - leaning.misses.length}/${leaning.n} right, ${leaning.castable} would cast`);
expect(leaning.misses.length / leaning.n <= 0.04, 'a sigil drawn at a heavy lean is still right 96% of the time',
    leaning.misses.slice(0, 8).join(', '));
expect(leaning.castable / leaning.n >= 0.93, 'and it casts rather than fizzling',
    `${leaning.castable}/${leaning.n}`);

// the unforgivable failure is not a fizzle, it is casting something
// nobody asked for — you lose the mana and the duel argues with you
{
    const misfires = [];
    for (const [name, t] of [['tidy', tidy], ['sloppy', sloppy], ['awful', awful], ['±22°', tilted], ['±30°', leaning]]) {
        if (t.wrong.length) misfires.push(`${name}: ${t.wrong.slice(0, 4).join(', ')}`);
    }
    const total = [tidy, sloppy, awful, tilted, leaning].reduce((a, t) => a + t.wrong.length, 0);
    const n = [tidy, sloppy, awful, tilted, leaning].reduce((a, t) => a + t.n, 0);
    console.log(`        wrong spell cast: ${total}/${n}`);
    expect(total / n <= 0.005, 'a drawn sigil almost never casts the wrong spell', misfires.join(' | '));
}

// how well you drew it decides how hard it hits, and the scale is
// anchored: scraping through the door is a weak spell, not a free one
expect(ENGINE.qualityOf(ENGINE.CAST_FLOOR) === 0 && ENGINE.qualityOf(ENGINE.CAST_FLOOR - 0.1) === 0,
    'a drawing at the threshold casts at zero power');
expect(ENGINE.qualityOf(0.86) === 1 && ENGINE.qualityOf(ENGINE.CAST_FLOOR + 0.13) > 0.45,
    'and a clean one at full', String(ENGINE.qualityOf(0.86)));

// and the other half of the job: a panic scribble must not fire a spell
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
// a slower hand: one long wandering line rather than a panic scrub. this
// is the junk that looks most like a real gesture, and the one the lower
// casting threshold lets closest to the door.
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
function junkRate(gen, n, seed) {
    const rnd = mulberry(seed);
    let fired = 0;
    for (let i = 0; i < n; i++) {
        const res = ENGINE.recognize(gen(rnd));
        if (res.length && res[0].score >= ENGINE.CAST_FLOOR &&
            (!res[1] || res[0].score - res[1].score >= ENGINE.CAST_MARGIN)) fired++;
    }
    return fired;
}
{
    const N = 200, fired = junkRate(scribble, N, 1234);
    console.log(`        scribbles that would cast: ${fired}/${N}`);
    expect(fired / N <= 0.04, 'a scribble almost never casts anything', fired + '/' + N + ' fired');

    const M = 150, wandered = junkRate(doodle, M, 5678);
    console.log(`        idle doodles that would cast: ${wandered}/${M}`);
    expect(wandered / M <= 0.22, 'and an idle doodle usually does not either', wandered + '/' + M + ' fired');
}
// what stops junk at a 0.60 door is that the score now costs you for
// wandering: a scribble turns a corner every few points, a sigil does not
{
    const rnd = mulberry(31337);
    const turns = S.map(s => ENGINE.featuresOf(s.glyph).turn).sort((a, b) => a - b);
    const junk = [];
    for (let i = 0; i < 40; i++) junk.push(ENGINE.featuresOf(scribble(rnd)).turn);
    junk.sort((a, b) => a - b);
    console.log(`        turning: sigils ${turns[0].toFixed(1)}..${turns[turns.length - 1].toFixed(1)}, scribbles median ${junk[20].toFixed(1)}`);
    expect(junk[20] > turns[Math.floor(turns.length * 0.9)],
        'a scribble turns more than nine out of ten real sigils', `${junk[20].toFixed(1)} vs ${turns[Math.floor(turns.length * 0.9)].toFixed(1)}`);
}

// ===================================================================
section('the faces you play against');
//
// Every ante has an opponent portrait, and a missing image file is the
// kind of thing nobody notices until a stranger opens the game and gets
// a broken-image icon staring at them.
// ===================================================================
{
    let BALD = null;
    try {
        const w2 = makeWindow();
        // balatro-data.js declares `const BAL` rather than hanging it off
        // window — which is right for the browser and useless here, so
        // the harness asks for it on the way out
        new Function('window', 'localStorage', 'performance',
            read('games/jokerz/balatro-data.js') + '\n;window.BAL = BAL;')(w2, w2.localStorage, w2.performance);
        BALD = w2.BAL;
        expect(!!BALD, 'balatro-data.js loads');
    } catch (e) { bad('balatro-data.js loads', e.message); }

    if (BALD) {
        const faces = (BALD.ANTE_FACES || []).concat(BALD.BOSS_FACES || []);
        expect(BALD.ANTE_FACES.length === 8, 'there is a face for each of the eight antes',
            String(BALD.ANTE_FACES.length));
        expect(BALD.BOSS_FACES.length >= 4, 'and a separate set for the bosses', String(BALD.BOSS_FACES.length));
        const gone = faces.map(f => f.src).concat([BALD.WIN_HEAD]).filter(src => !exists(src));
        expect(!gone.length, 'every portrait is a file that exists', gone.join(', '));
        expect(faces.every(f => f.name && f.name.length > 2), 'and each one is named, so it has a tooltip');

        // the same ante must always produce the same opponent, or the
        // face changes every time the screen redraws
        const twice = [BALD.faceFor(3, 0).src, BALD.faceFor(3, 0).src];
        expect(twice[0] === twice[1], 'the same blind always shows the same face');
        const perAnte = [1, 2, 3, 4, 5, 6, 7, 8].map(a => BALD.faceFor(a, 0).src);
        expect(new Set(perAnte).size === 8, 'the eight antes are eight different opponents',
            String(new Set(perAnte).size));
        // small and big blind of one ante: same face, different colour
        const small = BALD.faceFor(2, 0), big = BALD.faceFor(2, 1);
        expect(small.src === big.src && small.hue !== big.hue,
            'small and big blind are the same face at a different hue', JSON.stringify([small, big]));
        expect(BALD.faceFor(2, 2, 'wall').boss === true && BALD.faceFor(2, 2, 'wall').src !== small.src,
            'and the boss is somebody else entirely');
        expect(BALD.faceFor(2, 2, 'wall').src === BALD.faceFor(5, 2, 'wall').src,
            'a boss keeps its own face wherever it turns up');
        expect(BALD.faceFor(2, 2, 'wall').src !== BALD.faceFor(2, 2, 'needle').src,
            'and two different bosses do not share one');
        // an endless run past ante 8 must keep working
        const far = BALD.faceFor(19, 0);
        expect(far && far.src && far.hue > 0, 'an endless run past ante 8 wraps with a new tint', JSON.stringify(far));
    }
}

// ===================================================================
section('avatars');
// ===================================================================
const av = WZ.randomAvatar();
const parts = ['skin', 'hat', 'hatColor', 'hair', 'beard', 'robe', 'robeColor', 'staff', 'familiar', 'aura', 'eyes', 'title'];
expect(parts.every(k => av[k] !== undefined), 'a random wizard has every part', JSON.stringify(av));
const combos = WZ.AVATAR.hat.length * WZ.AVATAR.robe.length * WZ.AVATAR.beard.length *
    WZ.AVATAR.staff.length * WZ.AVATAR.familiar.length * WZ.AVATAR.aura.length *
    WZ.AVATAR.eyes.length * WZ.AVATAR.skin.length * WZ.AVATAR.palette.length;
expect(combos > 100000, 'there are enough wizards to go round', combos.toLocaleString() + ' combinations');
console.log('        ' + combos.toLocaleString() + ' visible combinations before colours are doubled up');

// ===================================================================
section('the bots');
// ===================================================================
const B = WZ.BOTS;
expect(Array.isArray(B) && B.length >= 4, 'there is a roster to fight', 'found ' + (B || []).length);
expect(new Set(B.map(b => b.id)).size === B.length, 'every bot id is unique');
expect(new Set(B.map(b => b.name)).size === B.length, 'every bot has its own name');
const botProblems = [];
const TIERS = ['easy', 'normal', 'hard'];
for (const b of B) {
    if (!TIERS.includes(b.tier)) botProblems.push(b.id + ': unknown tier ' + b.tier);
    if (!b.blurb || b.blurb.length < 15) botProblems.push(b.id + ': no blurb');
    const s = b.skill || {};
    // react is the real difficulty knob: a person needs about 1.5s to
    // draw a sigil, so anything under 1s is a machine being unfair
    if (!(s.react >= 1 && s.react <= 5)) botProblems.push(b.id + ': react ' + s.react + ' is outside 1..5s');
    if (!(s.dodge >= 0 && s.dodge <= 1)) botProblems.push(b.id + ': dodge out of range');
    if (!(s.quality >= 0 && s.quality <= 1)) botProblems.push(b.id + ': quality out of range');
    (b.style && b.style.els || []).forEach(el => { if (!WZ.EL[el]) botProblems.push(b.id + ': unknown element ' + el); });
    (b.style && b.style.pool || []).forEach(id => { if (!WZ.byId(id)) botProblems.push(b.id + ': pool has no spell ' + id); });
    if (b.style && b.style.pool && b.style.pool.length < 5) botProblems.push(b.id + ': pool too small to fight with');
    ['start', 'win', 'lose'].forEach(k => {
        if (!(b.lines && Array.isArray(b.lines[k]) && b.lines[k].length)) botProblems.push(b.id + ': nothing to say on ' + k);
    });
    const av = b.avatar || {};
    ['skin', 'hat', 'robe', 'staff', 'eyes'].forEach(k => { if (!av[k]) botProblems.push(b.id + ': avatar missing ' + k); });
    if (av.hat && !WZ.AVATAR.hat.includes(av.hat)) botProblems.push(b.id + ': unknown hat ' + av.hat);
    if (av.familiar && !WZ.AVATAR.familiar.includes(av.familiar)) botProblems.push(b.id + ': unknown familiar ' + av.familiar);
}
expect(!botProblems.length, 'every bot is playable and says something', botProblems.join('\n        '));
expect(TIERS.every(t => B.some(b => b.tier === t)), 'the roster spans easy to hard',
    B.map(b => b.tier).join(', '));
// a bot with no spell pool draws on all fifty, so only the pooled ones
// need checking — but every bot must be able to actually hurt someone
const toothless = B.filter(b => {
    const pool = (b.style.pool || []).map(id => WZ.byId(id));
    return b.style.pool && !pool.some(s => s && s.dmg > 0);
});
expect(!toothless.length, 'every bot owns at least one spell that deals damage', toothless.map(b => b.id).join(', '));
expect(Object.keys(WZ.BOT_DIFFICULTY).length === 3, 'the difficulty dropdown has three settings');
console.log('        roster: ' + B.map(b => `${b.name} (${b.tier}, ${b.skill.react}s)`).join(', '));

// ===================================================================
section('the public relay transport');
//
// The "public relays" mode posts the duel through nostr relays, which
// only accept signed events, so the site carries its own BIP-340
// schnorr. These are the official test vectors — if this drifts, real
// relays start rejecting everything and the mode silently dies.
// ===================================================================
{
    const hexToBytes = h => new Uint8Array(h.match(/.{2}/g).map(v => parseInt(v, 16)));
    const B = NP.bip340;
    expect(!!B && typeof B.sign === 'function', 'netplay ships a signer');
    const VECTORS = [
        ['0000000000000000000000000000000000000000000000000000000000000003',
            'F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9',
            '0000000000000000000000000000000000000000000000000000000000000000',
            '0000000000000000000000000000000000000000000000000000000000000000',
            'E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0'],
        ['B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF',
            'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
            '0000000000000000000000000000000000000000000000000000000000000001',
            '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            '6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE33418906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A'],
        ['C90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B14E5C9',
            'DD308AFEC5777E13121FA72B9CC1B7CC0139715309B086C960E18FD969774EB8',
            'C87AA53824B4D7AE2EB035A2B5BBBCCC080E76CDC6D1692C4B0B62D798E6D906',
            '7E2D58D8B3BCDF1ABADEC7829054F90DDA9805AAB56C77333024B9D0A508B75C',
            '5831AAEED7B44BB74E5EAB94BA9D4294C49BCF2A60728D8B4C200F50DD313C1BAB745879A5AD954A72C45A91C3A51D3C7ADEA98D82F8481E0E1E03674A6F3FB7'],
        ['0B432B2677937381AEF05BB02A66ECD012773062CF3FA2549E44F58ED2401710',
            '25D1DFF95105F5253C4022F628A996AD3A0D95FBF21D468A1B33F8C160D8F517',
            'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
            'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
            '7EB0509757E246F19449885651611CB965ECC1A187DD51B64FDA1EDC9637D5EC97582B9CB13DB3933705B32BA982AF5AF25FD78881EBB32771FC5922EFC66EA3']
    ];
    const wrong = [];
    for (const [sk, pk, aux, msg, sig] of VECTORS) {
        const gotPk = B.toHex(await B.pubkey(hexToBytes(sk))).toUpperCase();
        const gotSig = B.toHex(await B.sign(hexToBytes(msg), hexToBytes(sk), hexToBytes(aux))).toUpperCase();
        if (gotPk !== pk) wrong.push('pubkey for ' + sk.slice(0, 8) + ' came out ' + gotPk.slice(0, 16));
        if (gotSig !== sig) wrong.push('signature for ' + msg.slice(0, 8) + ' came out ' + gotSig.slice(0, 16));
    }
    expect(!wrong.length, 'schnorr matches all four official BIP-340 vectors', wrong.join('\n        '));
    const t0 = Date.now();
    const sk = B.newKey();
    for (let i = 0; i < 10; i++) await B.sign(await B.sha256(new TextEncoder().encode('x' + i)), sk);
    const ms = (Date.now() - t0) / 10;
    expect(ms < 60, 'signing is fast enough to batch at ten a second', ms.toFixed(1) + 'ms per signature');
    console.log('        ' + ms.toFixed(1) + 'ms per signature');

    expect(NP.nostrRelays().length >= 3, 'more than one public relay is configured, since one is always down',
        NP.nostrRelays().join(', '));
    expect(NP.TRANSPORTS.bus && NP.TRANSPORTS.bus.make, 'the lobby offers a non-p2p way online');
}

// ===================================================================
section('netplay');
// ===================================================================
expect(Array.isArray(NP.CATALOG) && NP.CATALOG.length >= 1, 'the lobby lists at least one game');
let missingScripts = [];
NP.CATALOG.forEach(g => {
    (g.scripts || []).forEach(src => { if (!exists(src)) missingScripts.push(g.id + ' -> ' + src); });
    if (!g.min || !g.max || g.min > g.max) missingScripts.push(g.id + ': bad player counts');
});
expect(!missingScripts.length, 'every catalogued game points at files that exist', missingScripts.join(', '));
expect(Object.keys(NP.TRANSPORTS).length >= 2, 'there is more than one way to connect',
    Object.keys(NP.TRANSPORTS).join(', '));
const codes = new Set();
for (let i = 0; i < 2000; i++) codes.add(NP.makeCode(5));
expect(codes.size > 1900, 'invite codes do not collide constantly', codes.size + '/2000 unique');
expect([...codes].every(c => /^[2-9A-HJ-NP-Z]{5}$/.test(c)), 'invite codes avoid characters people misread');

// ===================================================================
section('wired into the desktop');
// ===================================================================
const sw = read('sw.js');
const html = read('index.html');
const indexJs = read('js/index.js');
const extras = read('js/extras.js');
['games/netplay.js', 'games/wizardz/wizardz-data.js', 'games/wizardz/wizardz.js'].forEach(f =>
    expect(sw.includes('/' + f), 'service worker precaches ' + f));
expect(/const CACHE = 'mrhakan98-v(\d+)'/.test(sw), 'service worker has a cache version');
expect(html.includes("startMenuAction('wizardz')"), 'wizardz is in the start menu');
expect(html.includes("startMenuAction('netplay')"), 'the lobby is in the start menu');
expect(/wizardz: \(\) => openWizardz\(\)/.test(indexJs), 'wizardz is in the app action table');
expect(/netplay: \(\) => openNetplay\(\)/.test(indexJs), 'the lobby is in the app action table');
expect(/'wizardz':/.test(indexJs) && /'lobby':/.test(indexJs), 'both are reachable from the run box');
expect(/function openWizardz/.test(extras), 'js/extras.js has the wizardz loader');
expect(/function openNetplay/.test(extras), 'js/extras.js has the lobby loader');
expect(/\['wizardz 98', 'game'/.test(extras), 'wizardz is in find: files');
const css = read('css/style.css');
expect(/\.wz-canvas/.test(css) && /\.np-code/.test(css), 'the stylesheet has the game and lobby styles');

// every precached url has to actually be there, or the service worker
// installs a cache full of holes
const precache = (sw.match(/PRECACHE = \[([\s\S]*?)\]/) || [])[1] || '';
const missingPre = precache.split('\n').map(l => (l.match(/'([^']+)'/) || [])[1])
    .filter(Boolean)
    .map(u => decodeURIComponent(u))
    .filter(u => u !== '/' && !exists(u.replace(/^\//, '')));
expect(!missingPre.length, 'every precached file exists', missingPre.join(', '));

// ===================================================================
section('my documents');
// ===================================================================
// Every game keeps its progress in localStorage, which is per browser and
// gone when somebody clears their site data. This folder is the only way
// any of it leaves the machine, so its envelope has to be strict about
// what it will write back.
{
    const store = new Map();
    const win = {
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k)
        },
        btoa: str => Buffer.from(str, 'binary').toString('base64'),
        atob: str => Buffer.from(str, 'base64').toString('binary'),
        unescape: unescape, escape: escape,
        encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
    };
    win.window = win;
    try {
        // eslint-disable-next-line no-new-func
        new Function('window', 'localStorage', 'btoa', 'atob', read('js/documents.js'))(
            win, win.localStorage, win.btoa, win.atob);
        ok('documents.js runs without a dom');
    } catch (e) { bad('documents.js runs without a dom', e.message); }

    const DOC = win.DOCUMENTS;
    if (DOC) {
        const ids = DOC.DOCS.map(d => d.id);
        expect(new Set(ids).size === ids.length, 'every document has its own id', ids.join(', '));
        // a key owned by two documents means deleting one silently guts the other
        const owner = {}, shared = [];
        for (const d of DOC.DOCS) for (const k of d.keys) {
            if (owner[k]) shared.push(k + ' (' + owner[k] + ' + ' + d.id + ')');
            owner[k] = d.id;
        }
        expect(shared.length === 0, 'and no key belongs to two of them', shared.join(', '));
        // the games the site actually has should all be in the folder
        for (const want of ['echoes', 'jokerz', 'becomeuser', 'trollproblem', 'wizardz']) {
            expect(ids.indexOf(want) >= 0, want + ' has a document');
        }
        // the keys have to be the ones the games really write
        const realKeys = [read('games/echoes/echoes-core.js'), read('games/jokerz/balatro.js'), read('games/become-user/become-user.js'),
            read('games/troll-problem/troll-problem.js'), read('games/wizardz/wizardz.js')].join('\n');
        const wrong = ['ECHOES_OF_THE_TIDE_SAVE', 'jokerz98-run', 'becomeuser-run-v1',
            'trollproblem-run-v2', 'mrhakan98-wizardz-avatar'].filter(k => !realKeys.includes(k));
        expect(wrong.length === 0, 'and each one names a key its game really writes', wrong.join(', '));

        // a document with nothing saved reports nothing, not a broken row
        expect(DOC.DOCS.every(d => !DOC.present(d)), 'an empty machine has no documents');
        expect(DOC.DOCS.every(d => DOC.summaryOf(d) === null), 'and no summaries to show');

        // the envelope
        win.localStorage.setItem('snake-best', '412');
        win.localStorage.setItem('ECHOES_OF_THE_TIDE_SAVE', JSON.stringify({ player: { name: 'x', level: 3 } }));
        const code = DOC.pack(null);
        const back = DOC.unpack(code);
        expect(back.ok && Object.keys(back.files).length === 2, 'a backup packs and unpacks',
            JSON.stringify(back.error || Object.keys(back.files)));
        expect(!DOC.unpack('hello there').ok, 'a paste of something else is refused');
        expect(!DOC.unpack(win.btoa(JSON.stringify({ format: 'elsewhere', files: {} }))).ok,
            'and so is a code from another site');
        expect(DOC.unpack(win.btoa(JSON.stringify({
            format: DOC.ENVELOPE, version: DOC.ENVELOPE_VERSION + 5, files: { 'snake-best': '1' }
        }))).error === 'that backup is newer than this site', 'a backup from the future says so');
        // tampering has to be caught: the checksum is the only thing that can
        const tampered = JSON.parse(DOC.decode(code));
        tampered.files['snake-best'] = '999999';
        expect(!DOC.unpack(DOC.encode(JSON.stringify(tampered))).ok, 'and a damaged one is refused');
        // and a valid backup may not put arbitrary keys in somebody's storage
        const smuggled = JSON.parse(DOC.decode(code));
        smuggled.files['not-ours'] = 'evil';
        smuggled.checksum = DOC.checksum(JSON.stringify(smuggled.files));
        const opened = DOC.unpack(DOC.encode(JSON.stringify(smuggled)));
        expect(opened.ok && (opened.skipped || []).indexOf('not-ours') >= 0 && !opened.files['not-ours'],
            'a key this site does not own is dropped rather than written',
            JSON.stringify(opened.skipped));

        // and it survives a real round trip
        const saved = win.localStorage.getItem('ECHOES_OF_THE_TIDE_SAVE');
        DOC.wipe(DOC.DOCS.find(d => d.id === 'echoes'));
        expect(win.localStorage.getItem('ECHOES_OF_THE_TIDE_SAVE') === null, 'deleting a document deletes it');
        DOC.restore(DOC.unpack(code).files);
        expect(win.localStorage.getItem('ECHOES_OF_THE_TIDE_SAVE') === saved, 'and restoring brings it back byte for byte');
    }

    expect(/<script src="js\/documents\.js"/.test(read('index.html')), 'index.html loads it');
    expect(/startMenuAction\('documents'\)/.test(read('index.html')), 'and it is in the start menu');
    expect(/documents: openDocuments/.test(indexJs) && /'documents': openDocuments/.test(indexJs),
        'the app table and the run box both know it');
    expect(read('sw.js').includes("'/js/documents.js'"), 'the service worker precaches it');
    expect(/openDocuments\(\)/.test(read('js/extras.js')), 'and find: files finds it');
}

// ===================================================================
section('the github snapshot');
// ===================================================================
// The repo grid and user.dat used to call the anonymous GitHub API, which
// is sixty requests an hour per IP. They read a committed snapshot now.
expect(exists('data/github.json'), 'the snapshot is in the repo');
if (exists('data/github.json')) {
    let snap = null;
    try { snap = JSON.parse(read('data/github.json')); } catch (e) { /* reported below */ }
    expect(!!snap, 'and it is valid json');
    if (snap) {
        expect(!!(snap.user && snap.user.login), 'it has a profile');
        expect(Array.isArray(snap.repos) && snap.repos.length > 0, 'and repositories',
            String(snap.repos && snap.repos.length));
        expect(typeof snap.generated_at === 'string', 'and says when it was taken');
        // this file is served from a public site
        const priv = (snap.repos || []).filter(r => r.private || r.visibility === 'private');
        expect(priv.length === 0, 'and carries no private repository', priv.map(r => r.name).join(', '));
        // every field index.js renders has to be there or the grid shows holes
        const need = ['name', 'html_url', 'stargazers_count', 'forks_count', 'has_pages', 'fork'];
        const thin = (snap.repos || []).filter(r => need.some(k => !(k in r)));
        expect(thin.length === 0, 'and every repo carries the fields the grid renders',
            thin.slice(0, 3).map(r => r.name).join(', '));
    }
}
expect(/fetch\('data\/github\.json'/.test(indexJs), 'js/index.js reads the snapshot');
expect(indexJs.indexOf("fetch('data/github.json'") < indexJs.indexOf("fetch('https://api.github.com/users/mrhakan/repos"),
    'and reaches for it before it reaches for the api');
expect(/api\.github\.com\/users\/mrhakan/.test(indexJs), 'with the live api still there as a fallback');
expect(sw.includes("'/data/github.json'"), 'the service worker precaches it');
expect(exists('.github/workflows/github-data.yml') && exists('.github/scripts/fetch-github-data.mjs'),
    'and something refreshes it on a schedule');
const ghWorkflow = exists('.github/workflows/github-data.yml') ? read('.github/workflows/github-data.yml') : '';
expect(/schedule:/.test(ghWorkflow) && /cron:/.test(ghWorkflow), 'the refresh is on a cron');
expect(/contents: write/.test(ghWorkflow), 'and it is allowed to commit what it finds');
const ghScript = exists('.github/scripts/fetch-github-data.mjs') ? read('.github/scripts/fetch-github-data.mjs') : '';
expect(/private/.test(ghScript), 'and the fetcher refuses to write a private repository into it');

// ===================================================================
console.log('\n' + '='.repeat(58));
console.log(failures ? `${failures} of ${checks} checks failed` : `all ${checks} checks passed`);
process.exit(failures ? 1 : 0);
