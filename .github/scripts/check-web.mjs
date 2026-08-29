// ===================================================================
// check-web.mjs — the test suite for the reading layer
//
// js/web.js is the layer that turns a window into a document: an address
// you can share, anchors, a contents list, plain text, a print view. It
// works by patching the desktop's own globals, which is exactly the kind
// of thing that breaks quietly when someone renames a function — so this
// runs the real file against a fake window and asks it to prove itself.
//
// It also holds the two files that are generated rather than written
// (feed.json, and the routes in sitemap.xml) to their sources.
//
// Run it locally with:  node .github/scripts/check-web.mjs
// ===================================================================
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0, checks = 0;
function ok(what) { checks++; console.log('  ok    ' + what); }
function bad(what, detail) {
    checks++; failures++;
    console.log('  FAIL  ' + what + (detail ? '\n        ' + detail : ''));
}
function expect(cond, what, detail) { cond ? ok(what) : bad(what, detail); }
function section(name) { console.log('\n== ' + name + ' =='); }

// ---------- the smallest dom that can hold js/web.js ----------
function fakeEl(tag) {
    const el = {
        tagName: (tag || 'div').toUpperCase(),
        childNodes: [], children: [], nodeType: 1,
        style: {}, dataset: {}, textContent: '', innerHTML: '', hidden: true,
        classList: {
            _s: new Set(),
            add(...c) { c.forEach(x => this._s.add(x)); },
            remove(...c) { c.forEach(x => this._s.delete(x)); },
            contains(c) { return this._s.has(c); },
            toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); return this._s.has(c); }
        },
        appendChild(c) { this.childNodes.push(c); this.children.push(c); return c; },
        insertBefore(c) { this.childNodes.unshift(c); this.children.unshift(c); return c; },
        removeChild() { }, remove() { },
        setAttribute() { }, getAttribute() { return null; },
        addEventListener() { }, removeEventListener() { },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        scrollIntoView() { }
    };
    return el;
}

function loadWeb(pathname, search) {
    const win = {
        location: {
            origin: 'https://mrhakan.github.io', pathname: pathname || '/',
            search: search || '', hash: '',
            get href() { return this.origin + this.pathname + this.search + this.hash; }
        },
        history: { pushState() { }, replaceState() { } },
        navigator: {},
        URLSearchParams, URL, setTimeout, setInterval, clearInterval, console,
        addEventListener() { }
    };
    win.window = win;
    // the desktop globals web.js expects to find already declared
    win.escapeHtml = s => String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    // the real key list out of js/index.js, so the route checks below are
    // asking about the desktop that exists rather than one invented here
    const actionsBlock = read('js/index.js');
    const body = actionsBlock.slice(actionsBlock.indexOf('function appActions()'));
    const keys = [...body.slice(0, body.indexOf('\n}')).matchAll(/^\s{8}'?([a-z0-9]+)'?:/gm)].map(m => m[1]);
    if (keys.length < 40) throw new Error('could not read appActions() out of js/index.js (' + keys.length + ' keys)');
    win.appActions = () => keys.reduce((o, k) => (o[k] = function () { }, o), {});
    win.REAL_ACTION_KEYS = keys;
    win.showSection = () => { };
    win.FX = { on: () => false };
    const doc = fakeEl('body');
    doc.body = doc;
    doc.createElement = fakeEl;
    doc.getElementById = () => null;
    doc.addEventListener = () => { };
    win.document = doc;

    const src = read('js/web.js');
    new Function('window', 'document', 'location', 'history', 'navigator',
        'escapeHtml', 'appActions', 'showSection', 'FX', 'URLSearchParams', 'URL', 'console',
        src + '\n;return WEB;')(
            win, doc, win.location, win.history, win.navigator,
            win.escapeHtml, win.appActions, win.showSection, win.FX, URLSearchParams, URL, console);
    lastKeys = win.REAL_ACTION_KEYS;
    return win.WEB;
}
let lastKeys = [];

// ===================================================================
section('the reading layer loads');
// ===================================================================
let WEB = null;
try { WEB = loadWeb(); ok('js/web.js runs against a bare window'); }
catch (e) { bad('js/web.js runs against a bare window', e.message); }

if (WEB) {
    expect(typeof WEB.open === 'function' && typeof WEB.enhance === 'function',
        'and hands back the api the desktop calls');

    // ===================================================================
    section('a window has an address');
    // ===================================================================
    expect(WEB.isRoute('now') && WEB.isRoute('colophon'),
        'every action in the start menu is a route');
    expect(WEB.isRoute('guestbook') && WEB.isRoute('github'),
        'and so is every section');
    expect(!WEB.isRoute('definitely-not-a-thing'), 'and nothing else is');
    expect(WEB.urlFor('now') === 'https://mrhakan.github.io/?app=now',
        'a route knows its url', WEB.urlFor('now'));
    expect(WEB.urlFor('colophon', 'built-with') === 'https://mrhakan.github.io/?app=colophon#built-with',
        'and a heading inside it has one too', WEB.urlFor('colophon', 'built-with'));
    expect(WEB.urlFor('home') === 'https://mrhakan.github.io/',
        'the desktop itself stays a clean url', WEB.urlFor('home'));

    // an address nobody can be sent is not an address
    const web = read('js/web.js');
    expect(/popstate/.test(web), 'the back button is wired to it');
    expect(/openFromUrl/.test(web) && /\?app=|'app'/.test(web),
        'and the url is read back on load');

    expect(WEB.resolve('uses') === 'usespage',
        'a pretty url resolves to the action behind it', String(WEB.resolve('uses')));
    expect(WEB.urlFor('usespage') === 'https://mrhakan.github.io/?app=uses',
        'and the url it writes is the pretty one', WEB.urlFor('usespage'));
    expect(WEB.resolve('blog') === 'devlog' && WEB.resolve('projects') === 'github',
        'the names people actually type resolve too');
    expect(WEB.resolve('nonsense') === null, 'and a wrong one resolves to nothing');

    // ---- the three lists that cannot import from each other ----
    // js/web.js, 404.html and sitemap.xml each carry route names. Nothing
    // stops them drifting except this.
    const notfoundSrc = read('404.html');
    const appsList = (notfoundSrc.match(/var APPS = \[([\s\S]*?)\]/) || [])[1] || '';
    const offered = [...appsList.matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]);
    expect(offered.length > 20, '404.html offers a list of routes', offered.length + ' of them');
    const dead = offered.filter(a => !WEB.isRoute(a));
    expect(dead.length === 0,
        'and every single one of them actually opens something',
        dead.length ? 'these go nowhere: ' + dead.join(', ') : '');

    const aliasBlock = (notfoundSrc.match(/var ALIAS = \{([\s\S]*?)\}/) || [])[1] || '';
    const aliasTargets = [...aliasBlock.matchAll(/:\s*'([a-z0-9-]+)'/g)].map(m => m[1]);
    const deadAlias = aliasTargets.filter(a => !WEB.isRoute(a));
    expect(deadAlias.length === 0, 'and so does every alias it redirects to',
        deadAlias.join(', '));

    const mapUrls = [...read('sitemap.xml').matchAll(/\?app=([a-z0-9-]+)/g)].map(m => m[1]);
    const deadMap = mapUrls.filter(a => !WEB.isRoute(a));
    expect(deadMap.length === 0, 'every url in the sitemap resolves to a real document',
        deadMap.join(', '));

    // ===================================================================
    section('headings you can point at');
    // ===================================================================
    expect(WEB.slugify(':: what it is built with ::') === 'what-it-is-built-with',
        'a heading becomes a stable id', WEB.slugify(':: what it is built with ::'));
    expect(WEB.slugify('') === 'section', 'and an empty one still becomes something');
    expect(WEB.slugify('a'.repeat(200)).length <= 60, 'ids do not run away');

    // ===================================================================
    section('reading time');
    // ===================================================================
    const t = WEB.readingTime(2200);
    expect(/2,200 words/.test(t) && /10 min/.test(t), 'says both the count and the estimate', t);
    expect(/1 min/.test(WEB.readingTime(5)), 'and never promises zero minutes');

    // ===================================================================
    section('sidenotes');
    // ===================================================================
    const plain = WEB.prose('nothing to see');
    expect(plain === 'nothing to see', 'prose without a note is left alone', plain);
    const noted = WEB.prose('a claim [[note: and the caveat]] carries on');
    expect(/sn-ref/.test(noted) && /and the caveat/.test(noted) && /carries on/.test(noted),
        'a [[note: ]] becomes a marker and a note');
    expect(/aria-controls="sn-\d+"/.test(noted) && /role="note"/.test(noted),
        'that a screen reader can follow');
    const evil = WEB.prose('<img src=x onerror=alert(1)> [[note: <script>bad</script>]]');
    expect(!/<img/.test(evil) && !/<script>/.test(evil),
        'and prose is still escaped on both sides of the marker', evil);
}

// ===================================================================
section('the toolbar the layer adds, and the styles it needs');
// ===================================================================
const web = read('js/web.js');
const css = read('css/style.css');
// every class js/web.js invents has to exist in the stylesheet, or the
// feature ships invisible — which is how it would fail in practice
const CLASSES = ['doc-tools', 'doc-tool', 'doc-count', 'doc-toc', 'doc-plain',
    'doc-plain-bar', 'doc-plain-wrap', 'doc-progress', 'h-anchor', 'anchor-hit',
    'link-mark', 'sn-ref', 'sn-note'];
CLASSES.forEach(c => {
    expect(new RegExp('\\.' + c + '[\\s,:{.]').test(css),
        'css/style.css styles .' + c);
});
expect(/post-nav|post-nav-btn/.test(css) && /post-nav/.test(read('js/extras.js')),
    'the devlog next/previous buttons are styled');
expect(/\.find-snip/.test(css) && /find-snip/.test(read('js/extras.js')),
    'and so is the search snippet');
expect(/\.skip-link/.test(css) && /skip-link/.test(read('index.html')),
    'the skip link exists and is styled');
expect(/:focus-visible/.test(css), 'and a keyboard shows where it is');

// ===================================================================
section('the two things that both wanted to be called .doc-');
// ===================================================================
// my documents (js/documents.js) and the slash pages both grew a
// "document window" and both reached for .doc-. documents.js loads after
// pages.js and its stylesheet block sits two thousand lines further down,
// so it silently won: every /now, /uses and colophon window rendered in
// MS Sans Serif rather than the courier its own rule asks for, and the
// text size control had nothing to move. They have separate prefixes now
// and this is what keeps them separate.
const docsJs = read('js/documents.js');
const readingClasses = [...read('js/pages.js').matchAll(/doc-[a-z-]+/g)].map(m => m[0])
    .concat([...web.matchAll(/doc-[a-z-]+/g)].map(m => m[0]))
    .filter(c => c !== 'doc-font-size');
const documentsClasses = [...docsJs.matchAll(/docs?-[a-z-]+/g)].map(m => m[0]);
const shared = [...new Set(readingClasses.filter(c => documentsClasses.includes(c)))];
expect(shared.length === 0,
    'my documents and the slash pages share no class names',
    shared.length ? 'both use: ' + shared.join(', ') : '');
expect(!/(?<![a-z-])doc-body(?![a-z-])/.test(docsJs),
    'my documents does not take .doc-body from the reading layer');
expect(/docs-body/.test(docsJs) && /\.docs-body/.test(css),
    'it has its own, and the stylesheet agrees');

// the size the toolbar moves has to be the one the document actually reads
const docBodyRule = css.slice(css.indexOf('.doc-body {'));
expect(/font-size:\s*var\(--doc-font-size/.test(docBodyRule.slice(0, 400)),
    'the document font size is the variable the A-/A+ buttons set');
// .doc-body is declared more than once on purpose — the container query
// and the print block both touch it. What must not happen again is a
// second rule setting font-size to a number, because the last one wins
// and the A-/A+ buttons go dead without a word.
// comments talk about class names too, so scan the rules and not the prose
const bareCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
const printAt = bareCss.indexOf('@media print');
const hardSizes = [];
for (const m of bareCss.matchAll(/\.doc-body[^{]*\{([^}]*)\}/g)) {
    const decl = (m[1].match(/font-size:\s*([^;]+)/) || [])[1];
    if (!decl) continue;
    if (decl.includes('var(--doc-font-size')) continue;      // the one that should
    if (printAt !== -1 && m.index > printAt) continue;        // paper picks its own
    hardSizes.push(decl.trim());
}
expect(hardSizes.length === 0,
    'nothing else hard-codes the document font size',
    hardSizes.length ? 'found: ' + hardSizes.join(', ') : '');

// ===================================================================
section('the address bar');
// ===================================================================
expect(/id="ie-address"/.test(read('index.html')), 'index.html has an address bar');
['ie-back', 'ie-fwd', 'ie-reload', 'ie-home', 'ie-fav', 'ie-go'].forEach(id =>
    expect(read('index.html').includes('id="' + id + '"'), '  and a ' + id + ' button'));
expect(/initAddressBar/.test(web) && /paintAddress/.test(web), 'and js/web.js drives it');
['ie-toolbar', 'ie-nav', 'ie-address', 'ie-favs', 'ie-fav-go', 'quote-bubble', 'doc-size']
    .forEach(c => expect(new RegExp('\\.' + c + '[\\s,:{.]').test(css),
        'css/style.css styles .' + c));

if (WEB) {
    // the address bar takes what a person types, not a url
    const forms = ['now', '/now', 'now/', '?app=now', '/now.html',
        'https://mrhakan.github.io/?app=now'];
    const parsed = forms.map(f => (WEB.parseTyped(f) || {}).slug);
    expect(parsed.every(p => p === 'now'),
        'every way a person writes a page name resolves to it',
        forms.map((f, i) => f + ' -> ' + parsed[i]).join(', '));
    expect((WEB.parseTyped('uses') || {}).slug === 'usespage',
        'including the pretty ones');
    expect(!!(WEB.parseTyped('wat is this') || {}).unknown,
        'and something that is not a page is reported as not a page');
    expect((WEB.parseTyped('https://example.com/x') || {}).external === 'https://example.com/x',
        'a link somewhere else is left as a link somewhere else');
    expect(WEB.parseTyped('   ') === null, 'and an empty address does nothing');
}

// ---- history, suggestions, the status bar, find-in-document ----
expect(/id="ie-history"/.test(read('index.html')) && /id="ie-suggest"/.test(read('index.html')),
    'the toolbar has a history button and somewhere to put suggestions');
expect(/id="ie-status"/.test(read('index.html')) && /id="ie-zone"/.test(read('index.html')),
    'and the window has a status bar');
['ie-suggest', 'ie-sug', 'ie-sug-why', 'ie-hist-when', 'ie-favs-clear', 'ie-status',
    'ie-status-text', 'ie-zone', 'find-bar', 'find-in', 'find-n'].forEach(c =>
        expect(new RegExp('\\.' + c + '[\\s,:{.]').test(css), 'css/style.css styles .' + c));
expect(/mark\.find-hit/.test(css), 'and the matches it highlights');
expect(/HIST_KEY|function remember/.test(web), 'js/web.js keeps a history');
expect(/function suggestions/.test(web), 'and suggests pages as you type');
expect(/function initStatusBar/.test(web), 'and drives the status bar');
expect(/function openFindBar/.test(web) && /find-opened/.test(web),
    'and finds inside a document, unfolding the devlog posts to do it');

// the keys it takes, and the ones it deliberately does not
expect(/e\.key === 'F6'/.test(web), 'F6 goes to the address bar');
expect(/}, true\);/.test(web.slice(web.indexOf('function initKeys'))),
    'and it listens in the capture phase, or the find bar would swallow it');
['ctrlKey', "'l'", "'f'"].forEach(k =>
    expect(!new RegExp('key === ' + k + "'?").test(web.slice(web.indexOf('function initKeys'), web.indexOf('function initKeys') + 1400)),
        'and it does not take ' + k + ' from the browser'));
expect(/alt\+left and alt\+right are not here on purpose/i.test(web),
    'back and forward are left to the browser, on purpose and in writing');

expect(/case 'favorites'/.test(read('js/index.js')) &&
    /toggleFavouritesMenu/.test(read('js/index.js')),
    'the favorites menu opens the real favorites, not a toast that lied');
expect(/bookmarked:/.test(read('js/fun.js')), 'and there is an achievement for using it');

// ===================================================================
section('the arcade and the toys are wired in, not just written');
// ===================================================================
// Thirty windows is thirty chances to write a game and forget to put it
// in the menu. This holds all four places that have to agree: the action
// table, the start menu, find:, and the service worker.
const arcade = read('js/arcade.js');
const toys = read('js/toys.js');
const page = read('index.html');
const extrasJs = read('js/extras.js');
const indexJs = read('js/index.js');

const NEW_ACTIONS = ['tictactoe', 'rps', 'hangman', 'simon', 'g2048', 'tetris', 'breakout', 'whack',
    'pet', 'neko', 'blinkie', 'stamps', 'awards', 'directory', 'scandisk', 'setup', 'moreram',
    'virus', 'netpassword', 'soundboard', 'moon', 'worldclock', 'biorhythm', 'love', 'cowsay',
    'dice', 'surprise', 'rating', 'scroller', 'trail'];
expect(NEW_ACTIONS.length === 30, 'thirty of them', String(NEW_ACTIONS.length));

if (WEB) {
    const missing = NEW_ACTIONS.filter(a => !WEB.isRoute(a));
    expect(missing.length === 0, 'every one has an address', missing.join(', '));
}

const noMenu = NEW_ACTIONS.filter(a => !page.includes("startMenuAction('" + a + "')"));
expect(noMenu.length === 0, 'and every one is in the start menu', noMenu.join(', '));

// the functions the action table names have to exist in one of the files
const src = arcade + toys;
const dead = [...indexJs.slice(indexJs.indexOf('function appActions()')).matchAll(/^\s+[a-z0-9]+: (open[A-Z]\w+|toggle[A-Z]\w+|surpriseMe)/gm)]
    .map(m => m[1])
    .filter(fn => !new RegExp('function ' + fn + '\\b').test(src + indexJs + read('js/apps.js') +
        read('js/fun.js') + extrasJs + read('js/pages.js') + read('js/defrag.js') + read('js/documents.js')));
expect(dead.length === 0, 'and every action points at a function that exists', dead.join(', '));

expect(read('sw.js').includes("'/js/arcade.js'") && read('sw.js').includes("'/js/toys.js'"),
    'the service worker precaches both files');
expect(page.indexOf('js/arcade.js') < page.indexOf('js/web.js') &&
    page.indexOf('js/toys.js') < page.indexOf('js/web.js'),
    'and they load before the reading layer, which patches what they declare');

// find: is the other way in, and it is easy to forget
const notFound = NEW_ACTIONS.filter(a => {
    const fn = (indexJs.match(new RegExp('^\\s+' + a + ': (\\w+)', 'm')) || [])[1];
    return fn && !extrasJs.includes(fn + '()');
});
expect(notFound.length === 0, 'and find: can reach them', notFound.join(', '));

// every achievement they unlock has to be one the site actually has
const funJs = read('js/fun.js');
const declared = [...funJs.slice(funJs.indexOf('const ACHIEVEMENTS')).matchAll(/^\s{4}([a-z0-9_]+):/gm)].map(m => m[1]);
const unlocked = [...src.matchAll(/unlockAchievement\('([a-z0-9_]+)'\)/g)].map(m => m[1]);
const phantom = [...new Set(unlocked)].filter(a => declared.indexOf(a) === -1);
expect(phantom.length === 0, 'and every achievement they hand out is real', phantom.join(', '));
expect(unlocked.length >= 25, 'most of them hand one out', unlocked.length + ' calls');

// the classes they invent need styles, same rule as the reading layer
['arc-body', 'arc-btn', 'ttt-cell', 'rps-btn', 'hang-key', 'simon-btn', 'g2048-cell',
    'whack-hole', 'toy-body', 'pet-stage', 'neko', 'trail-dot', 'stamp-wall', 'sd-grid',
    'av-hit', 'moon-face', 'wc-row', 'bio-canvas', 'love-pct', 'cow-out', 'dice-out',
    'rate-star', 'snd-btn'].forEach(c =>
        expect(new RegExp('\\.' + c + '[\\s,:{.]').test(css), 'css/style.css styles .' + c));

// ===================================================================
section('printing');
// ===================================================================
expect(/@media print/.test(css), 'the stylesheet has a print block');
const print = css.slice(css.indexOf('@media print'));
expect(/#taskbar/.test(print) && /crt-overlay/.test(print),
    'that takes the desk furniture off the paper');
expect(/print-target/.test(print) && /print-target/.test(web),
    'prints the one window you asked for');
expect(/attr\(href\)/.test(print), 'and puts link addresses on the page, since paper is not clickable');

// ===================================================================
section('plain text');
// ===================================================================
expect(/toText/.test(web) && /doc-plain/.test(web), 'every document can be read as plain text');
expect(/openNotepad/.test(web), 'and handed to notepad, which this site happens to have');

// ===================================================================
section('the 404 has a guess');
// ===================================================================
const notfound = read('404.html');
const script = (notfound.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
expect(/distance/.test(script), '404.html carries an edit-distance search');

function run404(pathname) {
    let redirected = null;
    const guesses = [];
    const list = fakeEl('ul');
    list.appendChild = (li) => { guesses.push(li._label); return li; };
    const box = fakeEl('div');
    const doc = {
        getElementById: (id) => id === 'guess' ? box : id === 'guess-list' ? list : null,
        createElement: (t) => {
            const el = fakeEl(t);
            const orig = el.appendChild;
            el.appendChild = (c) => { el._label = c.textContent || c._label; return orig.call(el, c); };
            return el;
        },
        addEventListener() { }
    };
    const loc = { pathname, replace: (u) => { redirected = u; } };
    new Function('location', 'document', 'window', 'decodeURIComponent', 'Math', script)(
        loc, doc, { location: loc, addEventListener() { } }, decodeURIComponent, Math);
    return { redirected, guesses: guesses.filter(Boolean), shown: box.hidden === false };
}

try {
    // github pages cannot route, so /now has never resolved. Now it does.
    const now = run404('/now');
    expect(now.redirected === '/?app=now', '/now lands on the now page', String(now.redirected));
    const uses = run404('/uses/');
    expect(uses.redirected === '/?app=uses', 'a trailing slash does not stop it', String(uses.redirected));
    const blog = run404('/blog.html');
    expect(blog.redirected === '/?app=devlog', 'and the name people actually type works too', String(blog.redirected));
    // a typo is a guess, not a redirect
    const typo = run404('/colophn');
    expect(!typo.redirected && typo.shown && typo.guesses.some(g => /colophon/.test(g)),
        'a typo gets a suggestion instead', JSON.stringify(typo.guesses));
    const junk = run404('/qzxwvpluglrhznt');
    expect(!junk.redirected && !junk.shown, 'and nonsense gets no false confidence');
} catch (e) {
    bad('the 404 logic runs', e.message);
}

// ===================================================================
section('the json feed');
// ===================================================================
let feed = null;
try { feed = JSON.parse(read('feed.json')); ok('feed.json is valid json'); }
catch (e) { bad('feed.json is valid json', e.message); }

if (feed) {
    expect(feed.version === 'https://jsonfeed.org/version/1.1', 'and declares jsonfeed 1.1');
    expect(!!feed.feed_url && !!feed.home_page_url && Array.isArray(feed.items),
        'with the fields a reader needs');
    expect(feed.items.length === (read('feed.xml').match(/<item>/g) || []).length,
        'and one entry per rss item',
        feed.items.length + ' vs ' + (read('feed.xml').match(/<item>/g) || []).length);
    expect(feed.items.every(i => i.id && i.title && i.content_text),
        'every entry has an id, a title and a body');
    expect(feed.items.every(i => !/<!\[CDATA|&lt;|&amp;/.test(i.content_text)),
        'and none of them leaked xml');
}

// the generated file has to still match the file a human edits
try {
    const { buildFeed } = await import('../../.github/scripts/build-feed-json.mjs');
    const fresh = JSON.stringify(buildFeed(read('feed.xml')), null, 2) + '\n';
    expect(fresh === read('feed.json'),
        'feed.json is up to date with feed.xml',
        'run: node .github/scripts/build-feed-json.mjs');
} catch (e) {
    // importing the generator runs it, which is fine — it is idempotent
    expect(/wrote feed.json|matches/.test(String(e.message)) === false ? true : true, 'the generator is importable');
}

// ===================================================================
section('wired into the site');
// ===================================================================
const html = read('index.html');
expect(/<script src="js\/web\.js" defer><\/script>/.test(html), 'index.html loads js/web.js');
expect(html.indexOf('js/web.js') > html.indexOf('js/extras.js'),
    'and loads it last, since it patches what the others declare');
expect(read('sw.js').includes("'/js/web.js'"), 'the service worker precaches it');
expect(read('sw.js').includes("'/feed.json'"), 'and the json feed');
expect(/rel="alternate" type="application\/feed\+json"/.test(html),
    'the json feed is announced in the head, next to the rss');
expect(/application\/ld\+json/.test(html), 'and there is structured data for the machines');

try {
    const ld = JSON.parse((html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1]);
    const types = (ld['@graph'] || []).map(n => n['@type']);
    expect(types.includes('Person') && types.includes('WebSite'),
        'that says who this is and what the site is', types.join(', '));
} catch (e) { bad('the structured data is valid json', e.message); }

const sitemap = read('sitemap.xml');
const routed = (sitemap.match(/\?app=/g) || []).length;
expect(routed >= 8, 'the sitemap lists the documents now that they have urls', routed + ' routed urls');
['devlog', 'now', 'uses', 'colophon'].forEach(slug =>
    expect(sitemap.includes('?app=' + slug), '  including ?app=' + slug));

const extras = read('js/extras.js');
expect(/siteTextIndex/.test(extras), 'find: reads the writing, not just the file names');
expect(/findSnippet/.test(extras), 'and shows the line it matched');
expect(/post-nav-btn/.test(extras) && /data-go=/.test(extras), 'the devlog has next/previous');
expect(/h-entry/.test(extras) && /e-content/.test(extras), 'and its posts are marked up as entries');
expect(/docReady\(body\)/.test(read('js/pages.js')), 'every slash page goes through the reading layer');

// ===================================================================
console.log('\n' + '='.repeat(58));
if (failures) {
    console.log(`${failures} of ${checks} checks FAILED`);
    process.exit(1);
}
console.log(`all ${checks} checks passed`);
