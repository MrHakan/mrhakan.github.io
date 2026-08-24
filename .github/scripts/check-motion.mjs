// ===================================================================
// check-motion.mjs — tests for fx.js and charts.js
//
// Both files are pure enough to run without a browser if you hand them
// a small enough hole to run in, which is what this does: a fake
// element that records the keyframes it was asked to animate, and a
// fake 2d context that records the drawing calls.
//
// The thing worth protecting here is the promise fx.js makes: if the
// visitor asked for less motion, *nothing* animates and the end state
// is applied anyway. A motion layer that silently keeps animating for
// somebody who gets motion sick is worse than no motion layer.
//
//   node .github/scripts/check-motion.mjs
// ===================================================================
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failures = 0, checks = 0;
const ok = m => { checks++; console.log('  ok    ' + m); };
const bad = (m, d) => { checks++; failures++; console.log('  FAIL  ' + m + (d ? '\n        ' + d : '')); };
const expect = (c, m, d) => c ? ok(m) : bad(m, d);
const section = n => console.log('\n== ' + n + ' ==');

// ---------- a browser-shaped hole ----------
function fakeElement() {
    const el = {
        style: {}, nodeType: 1, calls: [],
        animate(keyframes, options) {
            el.calls.push({ keyframes, options });
            return {
                finished: Promise.resolve(),
                cancel() { this.cancelled = true; },
                reverse() { this.reversed = true; }
            };
        }
    };
    return el;
}
function makeWindow(opts) {
    const o = opts || {};
    const store = new Map(o.store || []);
    const win = {
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k)
        },
        matchMedia: q => ({ matches: !!o.reduced && /reduce/.test(q) }),
        IntersectionObserver: null,
        devicePixelRatio: o.dpr || 1,
        CSS: { supports: () => o.linear !== false },
        document: {
            querySelectorAll: () => [],
            documentElement: {
                classes: new Set(),
                classList: {
                    toggle(name, want) {
                        want ? win.document.documentElement.classes.add(name)
                            : win.document.documentElement.classes.delete(name);
                    }
                }
            }
        }
    };
    win.window = win;
    return win;
}
const load = (w, file) => new Function('window', 'localStorage', 'document', 'CSS', read(file))(w, w.localStorage, w.document, w.CSS);

// ===================================================================
section('js/fx.js runs without a dom');
// ===================================================================
const win = makeWindow();
try { load(win, 'js/fx.js'); ok('js/fx.js loads'); } catch (e) { bad('js/fx.js loads', e.message); process.exit(1); }
const FX = win.FX;
expect(typeof FX.animate === 'function' && typeof FX.stagger === 'function' && typeof FX.inView === 'function',
    'it exposes the motion.dev shape: animate, stagger, inView');
expect(typeof FX.openWindow === 'function' && typeof FX.toastIn === 'function' && typeof FX.reveal === 'function',
    'and the presets this desktop uses');

// ===================================================================
section('it animates');
// ===================================================================
{
    const el = fakeElement();
    const a = FX.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    expect(el.calls.length === 1, 'one element, one animation', String(el.calls.length));
    expect(el.calls[0].options.duration === 200, 'the duration is passed through', JSON.stringify(el.calls[0].options));
    expect(typeof a.finished.then === 'function' && typeof a.cancel === 'function',
        'and it hands back something you can await and cancel');

    const many = [fakeElement(), fakeElement(), fakeElement()];
    FX.animate(many, [{ opacity: 0 }, { opacity: 1 }], { delay: FX.stagger(0.05) });
    expect(many.every(e => e.calls.length === 1), 'a list animates every element');
    const delays = many.map(e => e.calls[0].options.delay);
    expect(delays[0] === 0 && delays[1] === 50 && delays[2] === 100, 'staggered by 50ms each', JSON.stringify(delays));

    const centred = FX.stagger(0.1, { from: 'center' });
    expect(centred(0, 3) === 100 && centred(1, 3) === 0 && centred(2, 3) === 100,
        'stagger can start from the middle', [centred(0, 3), centred(1, 3), centred(2, 3)].join(','));
    const last = FX.stagger(20, { from: 'last' });
    expect(last(0, 3) === 40 && last(2, 3) === 0, 'or from the end');
    expect(FX.stagger(0.04)(1, 2) === 40 && FX.stagger(40)(1, 2) === 40,
        'seconds and milliseconds both work, like motion.dev');

    expect(FX.animate(null, [{ opacity: 1 }]).skipped === true, 'animating nothing is not an error');
    expect(FX.animate([], [{ opacity: 1 }]).skipped === true, 'nor is animating an empty list');
}

// ===================================================================
section('springs');
// ===================================================================
{
    const easing = FX.spring({ stiffness: 300, damping: 20 });
    expect(/^linear\(/.test(easing), 'a spring becomes a linear() easing curve', easing.slice(0, 40));
    const points = easing.slice(7, -1).split(',').map(Number);
    expect(points.length > 20, 'sampled finely enough to look like a spring', String(points.length));
    expect(points[0] < 0.2 && points[points.length - 1] === 1,
        'it starts at rest and ends exactly on target', `${points[0]} .. ${points[points.length - 1]}`);
    expect(Math.max.apply(null, points) > 1, 'and overshoots on the way, which is the whole point',
        String(Math.max.apply(null, points)));

    const noLinear = makeWindow({ linear: false });
    load(noLinear, 'js/fx.js');
    expect(/^cubic-bezier/.test(noLinear.FX.spring({})), 'a browser without linear() gets a bezier instead',
        noLinear.FX.spring({}));
}

// ===================================================================
section('and it stops when asked');
//
// The promise: reduced motion means nothing animates, but the end state
// still lands, so no caller has to know which mode it is in.
// ===================================================================
{
    for (const [name, w] of [
        ['the system asks for reduced motion', makeWindow({ reduced: true })],
        ['the visitor unticks window animations', makeWindow({ store: [['motion-off', '1']] })]
    ]) {
        load(w, 'js/fx.js');
        const el = fakeElement();
        const a = w.FX.animate(el, [{ opacity: 0 }, { opacity: 1, transform: 'scale(1)' }]);
        expect(el.calls.length === 0, name + ': nothing animates');
        expect(el.style.opacity === 1 && el.style.transform === 'scale(1)',
            name + ': but the end state is applied anyway', JSON.stringify(el.style));
        expect(typeof a.finished.then === 'function', name + ': and it still resolves');
        expect(w.FX.on() === false, name + ': FX.on() says so');
    }
    const w = makeWindow({ store: [['motion-off', '1']] });
    load(w, 'js/fx.js');
    expect(w.FX.enabled() === false, 'the tickbox reads its own setting');
    w.FX.setEnabled(true);
    expect(w.FX.enabled() === true && w.FX.on() === true, 'and flipping it takes effect immediately');
    // the system setting is not something a tickbox may override
    const sys = makeWindow({ reduced: true });
    load(sys, 'js/fx.js');
    sys.FX.setEnabled(true);
    expect(sys.FX.on() === false, 'ticking the box cannot override the system setting');
}

// ===================================================================
section('css transitions hear about it too');
//
// A media query cannot see a tickbox in display properties, so fx.js
// publishes the answer as a class on <html> and the stylesheet reads
// it there. Without this, javascript motion stops and every css
// transition on the page carries on regardless.
// ===================================================================
{
    const quiet = makeWindow({ store: [['motion-off', '1']] });
    load(quiet, 'js/fx.js');
    expect(quiet.document.documentElement.classes.has('no-motion'),
        'motion off publishes .no-motion on the root element');
    quiet.FX.setEnabled(true);
    expect(!quiet.document.documentElement.classes.has('no-motion'), 'and ticking the box takes it off again');

    const sys = makeWindow({ reduced: true });
    load(sys, 'js/fx.js');
    expect(sys.document.documentElement.classes.has('no-motion'), 'the system setting publishes it too');

    const css = read('css/style.css');
    expect(/\.no-motion \.bj-card/.test(css) && /transition: none !important/.test(css),
        'and the stylesheet turns the card transitions off when it sees it');
}

// ===================================================================
section('jokerz 98');
//
// The table was rebuilt with innerHTML on every click, which is why
// nothing in it ever animated — the card was destroyed and recreated
// already raised. These are the checks that stop that coming back.
// ===================================================================
{
    const jwin = makeWindow();
    load(jwin, 'js/fx.js');
    try { load(jwin, 'games/balatro-fx.js'); ok('balatro-fx.js loads'); }
    catch (e) { bad('balatro-fx.js loads', e.message); }
    const BJ = jwin.BJFX;
    if (BJ) {
        expect(['selectCard', 'flyOut', 'dealIn', 'damage', 'countTo', 'pop', 'press', 'trigger', 'scorePulse', 'screenIn']
            .every(k => typeof BJ[k] === 'function'), 'it exposes the moves the table needs',
            Object.keys(BJ).join(', '));
        // every one of them has to survive being handed nothing, because
        // the table is redrawn under them constantly
        let threw = '';
        try {
            BJ.selectCard(null, true); BJ.refuse(null); BJ.pop(null); BJ.press(null);
            BJ.trigger(null); BJ.scorePulse(null); BJ.screenIn(null);
            BJ.damage(null, null, {}); BJ.floatOff(null, '1'); BJ.countTo(null, 5);
            BJ.bonk(null, 'x.png');
        } catch (e) { threw = e.message; }
        expect(!threw, 'and none of them mind an element that is no longer there', threw);
        expect(BJ.flyOut([], null) instanceof Promise && BJ.dealIn([], null) instanceof Promise
            && BJ.bonk(null, 'x.png') instanceof Promise,
            'the ones the game awaits always hand back a promise');
    }

    const game = read('games/balatro.js');
    expect(/el\.classList\.toggle\('sel', picked\)/.test(game) && /balUpdateReadout\(g\)/.test(game),
        'selecting a card touches that card and the readout, not the whole table');
    expect(!/g\.selected\.sort[\s\S]{0,200}balRender\(\);\n    \}\);/.test(game),
        'and no longer redraws everything on a click');
    expect(/async function balDiscardUI/.test(game) && /await BJFX\.flyOut/.test(game),
        'discarded cards fly out before the state changes');
    expect(/case 'discard': balDiscardUI\(\)/.test(game),
        'and the discard button is wired to the animated path');
    expect(/on\('\[data-act\]', el => \{ BJFX\.press\(el\)/.test(game),
        'every button on the table acknowledges the click');
    expect(/g\.pendingDeal/.test(game) && /BJFX\.dealIn/.test(game), 'drawn cards are dealt in');
    expect(/hitTheBlind/.test(game) && /BJFX\.damage/.test(game), 'the blind visibly takes the hit');
    expect(/BJFX\.bonk\(face, BAL\.WIN_HEAD\)/.test(game), 'and something lands on their head when they lose');
    expect(/balFaceHtml/.test(game) && /bj-victim/.test(game), 'the opponent has a face to land it on');
    // the readout used to fall back to the last hand's numbers when
    // nothing was selected, which read as the game failing to
    // recalculate rather than as history
    expect(!/last \? Math\.round\(last\.chips\)/.test(game) && !/last \? \+last\.mult/.test(game),
        'an empty readout reads zero, not whatever the last hand scored');
    expect(/typeof moneyBefore === 'number'/.test(game),
        'and the money float cannot subtract a number that is not there yet');
    expect(/balLastScreen !== g\.screen/.test(game), 'a new screen animates in, a redraw of the same one does not');

    const loader = read('js/extras.js');
    expect(/balatro-fx\.js'\)\)[\s\S]{0,80}balatro\.js/.test(loader),
        'the loader pulls the animation layer in before the engine');
    expect(read('sw.js').includes('/games/balatro-fx.js'), 'and the service worker precaches it');
}

// ===================================================================
section('js/charts.js');
// ===================================================================
const cwin = makeWindow();
try { load(cwin, 'js/charts.js'); ok('js/charts.js loads'); } catch (e) { bad('js/charts.js loads', e.message); }
const Charts = cwin.Charts;
function fakeCanvas(w, h) {
    const calls = [];
    const ctx = new Proxy({}, {
        get(_, k) {
            if (k === 'createLinearGradient') return () => ({ addColorStop() { } });
            if (k === 'setTransform' || k === 'measureText') return () => ({ width: 10 });
            return (...args) => calls.push({ fn: k, args });
        },
        set() { return true; }
    });
    return { clientWidth: w, clientHeight: h, width: 0, height: 0, getContext: () => ctx, calls };
}
{
    expect(typeof Charts.history === 'function' && typeof Charts.bars === 'function' && typeof Charts.ring === 'function',
        'it draws the three shapes the performance tab needs');

    const t = Charts.track(5);
    expect(t.points.length === 5 && t.points.every(v => v === 0), 'a track starts empty and fixed length');
    for (let i = 1; i <= 7; i++) t.push(i);
    expect(t.points.length === 5, 'and never grows past its length', String(t.points.length));
    expect(t.points.join(',') === '3,4,5,6,7', 'the oldest samples fall off the left', t.points.join(','));
    expect(t.peak() === 7 && t.mean() === 5, 'it can report its own peak and mean', `${t.peak()} / ${t.mean()}`);

    const c = fakeCanvas(200, 60);
    Charts.history(c, { series: [{ points: t.points, color: '#0df259', fill: 'rgba(0,0,0,.2)' }], max: 100, label: '42%' });
    expect(c.width === 200 && c.height === 60, 'the canvas is sized to its css box', `${c.width}x${c.height}`);
    expect(c.calls.some(x => x.fn === 'stroke') && c.calls.some(x => x.fn === 'fillRect'),
        'a history chart strokes a line onto a filled panel');
    expect(c.calls.some(x => x.fn === 'fillText' && x.args[0] === '42%'), 'and writes its label');

    const hi = fakeCanvas(200, 60);
    Charts.surface(hi);           // same canvas, twice, must not keep growing
    Charts.surface(hi);
    expect(hi.width === 200, 'redrawing does not inflate the backing store', String(hi.width));
    const retina = { clientWidth: 100, clientHeight: 50, width: 0, height: 0, getContext: () => fakeCanvas(1, 1).getContext() };
    cwin.devicePixelRatio = 2;
    const rwin = makeWindow({ dpr: 2 });
    load(rwin, 'js/charts.js');
    rwin.Charts.surface(retina);
    expect(retina.width === 200 && retina.height === 100, 'and a retina screen gets real pixels',
        `${retina.width}x${retina.height}`);

    // a chart with nothing in it must not throw — the performance tab
    // paints before any sample has been taken
    const empty = fakeCanvas(120, 40);
    let threw = '';
    try {
        Charts.history(empty, {});
        Charts.bars(empty, { items: [] });
        Charts.ring(empty, {});
        Charts.series(empty.getContext(), 100, 40, [1], {});
    } catch (e) { threw = e.message; }
    expect(!threw, 'an empty chart draws nothing rather than throwing', threw);
}

// ===================================================================
section('wired into the desktop');
// ===================================================================
{
    const indexJs = read('js/index.js');
    const sw = read('sw.js');
    for (const f of ['/js/fx.js', '/js/charts.js']) {
        expect(sw.includes(`'${f}'`), 'the service worker precaches ' + f);
    }
    // index.js reaches for FX on every page it runs on, so every page
    // that loads index.js has to load fx.js first — that is the whole
    // failure mode of a global helper
    for (const page of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
        if (!/<script src="js\/index\.js"/.test(read(page))) continue;
        expect(/<script src="js\/fx\.js"[^>]*>[\s\S]*?<script src="js\/index\.js"/.test(read(page)),
            page + ' loads fx.js before index.js');
    }
    expect(/FX\.openWindow\(win\)/.test(indexJs), 'windows animate open');
    expect(/FX\.closeWindow\(win\)/.test(indexJs), 'and closed');
    expect(/FX\.toastIn\(toast\)/.test(indexJs), 'toasts slide in');
    // a window that is closing must stop being findable straight away,
    // or a second click animates a corpse
    expect(/win\.id = '';[\s\S]{0,120}pointerEvents = 'none'/.test(indexJs),
        'a closing window is unreachable before the animation finishes');
    expect(/if \(!FX\.on\(\)\) \{ win\.remove\(\); return; \}/.test(indexJs),
        'and with motion off it just goes');

    const apps = read('js/apps.js');
    expect(/id="cp-motion"/.test(apps) && /FX\.setEnabled/.test(apps),
        'display properties can turn window animations off');
    expect(/prefers-reduced-motion: reduce/.test(apps) && /mo\.disabled = true/.test(apps),
        'and defers to the system setting instead of lying about it');
    expect(/if \(!FX\.on\(\)\) return;/.test(indexJs), 'cursor sparkles respect it too');

    const css = read('css/style.css');
    expect(/\.tm-canvas/.test(css) && /\.tm-perf/.test(css), 'the performance tab has styles');
    expect(/id="tm-cpu"/.test(indexJs) && /Charts\.history/.test(indexJs), 'and a chart in it');
    expect(/clearInterval\(ticker\)/.test(indexJs), 'whose ticker is cleaned up with the window');
}

// ===================================================================
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
    console.log(`${failures} failed`);
    process.exit(1);
}// ===================================================================
section('a dialog is on top of the desktop');
// ===================================================================
// The retro dialog was z-index 95 while app windows start at 100 and climb
// on every click. Every dialog opened from inside a window — the save
// export, the courier, my documents' backup — was drawn behind it.
{
    const css = read('css/style.css');
    const overlay = (css.match(/\.retro-dialog-overlay\s*\{[\s\S]*?\}/) || [''])[0];
    const z = parseInt((overlay.match(/z-index:\s*(\d+)/) || [])[1], 10);
    const windowZ = parseInt((((css.match(/^\.app-window\s*\{[\s\S]*?\}/m) || [''])[0])
        .match(/z-index:\s*(\d+)/) || [])[1], 10);
    expect(isFinite(z) && isFinite(windowZ), 'both the dialog and the app window declare a z-index',
        z + ' / ' + windowZ);
    expect(z > windowZ, 'and the dialog is above the window in the stylesheet', z + ' vs ' + windowZ);
    const idx = read('js/index.js');
    expect(/function topWindowZ/.test(idx), 'index.js works out what is actually on top');
    expect(/overlay\.style\.zIndex/.test(idx),
        'and raises the dialog past it, since the windows climb every time one is clicked');
}

// ===================================================================
section('the stylesheet\'s own links');
// ===================================================================
// style.css lives in css/ now, so a relative url() inside it resolves
// against css/ and not the site root. That is how the icon font started
// 404ing at /css/src/fonts/... — silently, because a missing font just
// renders as a box.
{
    const css = read('css/style.css');
    const urls = [...css.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)].map(m => m[2].trim());
    const relative = urls.filter(u => !/^(data:|https?:|\/|#)/.test(u));
    expect(relative.length === 0,
        'every url() in the stylesheet is absolute, so moving the file cannot break it',
        relative.join(', '));
    const assets = urls.filter(u => /^\//.test(u)).map(u => u.split('?')[0].replace(/^\//, ''));
    const missing = assets.filter(a => !fs.existsSync(path.join(ROOT, a)));
    expect(missing.length === 0, 'and every file it points at is actually there', missing.join(', '));
}


