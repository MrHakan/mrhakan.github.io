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
const JS_FILES = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'))
    .concat(fs.readdirSync(path.join(ROOT, 'games')).filter(f => f.endsWith('.js')).map(f => 'games/' + f))
    .concat(fs.existsSync(path.join(ROOT, 'server')) ? fs.readdirSync(path.join(ROOT, 'server')).filter(f => f.endsWith('.js')).map(f => 'server/' + f) : []);
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
try { loadInto(win, 'games/wizardz-data.js'); ok('games/wizardz-data.js runs'); }
catch (e) { bad('games/wizardz-data.js runs', e.message); }
try { loadInto(win, 'games/wizardz.js'); ok('games/wizardz.js runs'); }
catch (e) { bad('games/wizardz.js runs', e.message); }

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
function shaky(strokes, rnd, level) {
    const rot = (rnd() - 0.5) * 2 * level * 9 * Math.PI / 180;
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
function trial(level, per, seed) {
    const rnd = mulberry(seed);
    const misses = [];
    let n = 0, selfSum = 0, castable = 0;
    for (const s of S) {
        for (let k = 0; k < per; k++) {
            const res = ENGINE.recognize(shaky(s.glyph, rnd, level));
            n++;
            const self = res.find(r => r.id === s.id);
            selfSum += self ? self.score : 0;
            if (self && self.score >= ENGINE.CAST_FLOOR && res[0].id === s.id) castable++;
            if (!res.length || res[0].id !== s.id) misses.push(s.id + '->' + (res[0] ? res[0].id : 'nothing'));
        }
    }
    return { n, misses, mean: selfSum / n, castable };
}
const tidy = trial(0.55, 8, 20260813);
const sloppy = trial(0.8, 8, 424242);
const awful = trial(1.0, 8, 7777);
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
const indexJs = read('index.js');
const extras = read('extras.js');
['games/netplay.js', 'games/wizardz-data.js', 'games/wizardz.js'].forEach(f =>
    expect(sw.includes('/' + f), 'service worker precaches ' + f));
expect(/const CACHE = 'mrhakan98-v(\d+)'/.test(sw), 'service worker has a cache version');
expect(html.includes("startMenuAction('wizardz')"), 'wizardz is in the start menu');
expect(html.includes("startMenuAction('netplay')"), 'the lobby is in the start menu');
expect(/wizardz: \(\) => openWizardz\(\)/.test(indexJs), 'wizardz is in the app action table');
expect(/netplay: \(\) => openNetplay\(\)/.test(indexJs), 'the lobby is in the app action table');
expect(/'wizardz':/.test(indexJs) && /'lobby':/.test(indexJs), 'both are reachable from the run box');
expect(/function openWizardz/.test(extras), 'extras.js has the wizardz loader');
expect(/function openNetplay/.test(extras), 'extras.js has the lobby loader');
expect(/\['wizardz 98', 'game'/.test(extras), 'wizardz is in find: files');
const css = read('style.css');
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
console.log('\n' + '='.repeat(58));
console.log(failures ? `${failures} of ${checks} checks failed` : `all ${checks} checks passed`);
process.exit(failures ? 1 : 0);
