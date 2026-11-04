// ===================================================================
// check-startup.mjs — what the first visit is allowed to cost
//
// Nothing about a slow page fails on its own. It gets a little worse with
// every feature and nobody sees it from a fast connection on their own
// machine. So the things that made it fast are written down here: no remote
// script, a stylesheet that has every class the markup asks for, a window
// that loads when it is opened, and a budget.
//
// Over budget means looking at what grew before raising the number. New
// windows belong in js/lazy.js, not in the budget.
// ===================================================================
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));
const gz = f => zlib.gzipSync(fs.readFileSync(path.join(ROOT, f)), { level: 6 }).length;

let checks = 0, failures = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg);
    else { failures++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

// gzipped, the way a browser gets them
const BUDGET = {
    scripts: 145 * 1024,      // every <script src> on the desktop
    styles: 52 * 1024,        // both stylesheets, which block the first paint
    image: 24 * 1024          // any one image the desktop paints at boot
};

const PAGES = ['index.html', 'guestbook.html', 'links.html'];
const html = read('index.html');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);

// ===================================================================
section('nothing in the head waits on somebody else');
// ===================================================================
for (const page of PAGES) {
    const src = read(page);
    const remote = [...src.matchAll(/<script\b[^>]*\bsrc="(https?:[^"]+)"/g)].map(m => m[1]);
    expect(!remote.length, page + ' loads no script from another server', remote.join(', '));
    const blocking = [...src.matchAll(/<script\b([^>]*\bsrc="[^"]+"[^>]*)>/g)].map(m => m[1])
        .filter(attrs => !/\b(defer|async)\b/.test(attrs));
    expect(!blocking.length, 'and none that stops the parser', blocking.join(' | '));
    expect(!/\btailwind\.config\b|cdn\.tailwindcss/.test(src), 'and nothing is left of the tailwind cdn');

    // tailwind came after style.css when it was injected at runtime, and the
    // same rule at the same specificity has to keep losing to it
    expect(src.indexOf('css/tailwind.css') > src.indexOf('css/style.css') && src.indexOf('css/style.css') !== -1,
        page + ' links tailwind.css after style.css');
}
expect(!/tailwind\.config/.test(read('js/index.js')), 'js/index.js no longer configures a compiler that is not there');

// a preload that does not match to the letter is a second download, not a head start
{
    const font = (read('css/style.css').match(/url\('\/(src\/fonts\/[^']+)'\)/) || [])[1];
    expect(!!font && html.includes('<link rel="preload" href="' + font + '"'), 'the font preload asks for exactly what the stylesheet asks for', font);
    expect(!!font && read('sw.js').includes("'/" + font + "'"), 'and so does the service worker');
}

// ===================================================================
section('css/tailwind.css has every class the markup asks for');
// ===================================================================
{
    const escaped = read('css/tailwind.css') + read('css/style.css');
    // a selector in the stylesheet, with the css escaping undone
    const known = new Set();
    // ...which is both \: and \2c with a space after it, tailwind's way of writing a comma
    for (const m of escaped.matchAll(/\.((?:[\w-]|\\[0-9a-f]{1,6}\s?|\\.)+)/gi)) {
        known.add(m[1].replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex, c) => hex ? String.fromCodePoint(parseInt(hex, 16)) : c));
    }

    const VARIANT = /^(?:(?:hover|focus|focus-within|focus-visible|active|disabled|group-hover|first|last|odd|even|sm|md|lg|xl|2xl|dark|peer-[a-z]+):)+/;
    // the shape of a tailwind utility. Everything else on a class attribute is
    // the site's own vocabulary, which check-web.mjs looks after.
    const UTILITY = /^-?(?:flex|grid|hidden|block|inline|table|contents|container|absolute|relative|fixed|sticky|static|visible|invisible|truncate|italic|underline|uppercase|lowercase|capitalize|shrink|grow|antialiased|(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min-w|min-h|max-w|max-h|gap|space-x|space-y|top|right|bottom|left|inset|inset-x|inset-y|z|opacity|text|bg|border|border-[xytblr]|rounded|rounded-[a-z]+|shadow|font|leading|tracking|overflow|overflow-[xy]|col-span|row-span|grid-cols|grid-rows|items|justify|self|whitespace|break|cursor|select|transition|duration|ease|animate|rotate|scale|translate-[xy]|object|aspect|basis|order|ring|outline|divide-[xy]|drop-shadow|blur|from|via|to|decoration|underline-offset|pointer-events|list|align|content|fill|stroke)-.+)$/;

    // these are shaped like utilities and are not: the indieweb's microformats,
    // and a z-1 that has never matched anything and that the desktop's layering
    // has been built on top of for years
    const NOT_UTILITIES = new Set(['h-card', 'p-name', 'p-nickname', 'p-country-name', 'p-category', 'u-photo', 'u-url', 'u-uid', 'z-1']);
    const asked = new Map();
    const note = (token, file) => {
        const t = token.trim().replace(/^!/, '');
        if (!/^[-!\w:.[\]#%(),/_]+$/.test(t)) return;
        if (NOT_UTILITIES.has(t)) return;
        if (UTILITY.test(t.replace(VARIANT, ''))) { if (!asked.has(t)) asked.set(t, file); }
    };
    const sources = ['index.html', 'guestbook.html', 'links.html',
        ...fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)];
    for (const file of sources) {
        const src = read(file);
        for (const m of src.matchAll(/\bclass(?:Name)?\s*[=:]\s*(?:\\?["'`])((?:[^"'`\\]|\\.)*)/g)) m[1].split(/\s+/).forEach(t => note(t, file));
        for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) for (const q of m[1].matchAll(/['"`]([^'"`]+)['"`]/g)) note(q[1], file);
    }
    const missing = [...asked.keys()].filter(c => !known.has(c));
    expect(asked.size > 200, 'and found the classes to check', asked.size + ' found');
    expect(!missing.length, 'all ' + asked.size + ' of them have a rule',
        missing.slice(0, 24).map(c => c + ' (' + asked.get(c) + ')').join(', ') + '\n        run: npm run css');
}

// ===================================================================
section('a window loads when it is opened');
// ===================================================================
{
    const lazy = read('js/lazy.js');
    // the table in js/lazy.js, read as data
    const table = /const MODULES = (\{[\s\S]*?\});/.exec(lazy);
    const MODULES = table ? (0, eval)('(' + table[1] + ')') : {};
    const files = Object.keys(MODULES);
    expect(files.length >= 4, 'js/lazy.js has a table of what it stands in for');
    expect(scripts[0] === 'js/lazy.js', 'and loads first, before anything can ask for one', scripts[0]);
    expect(scripts.indexOf('js/lazy.js') < scripts.indexOf('js/web.js'),
        'which puts the stand-ins in place for the reading layer to patch');

    const actionsSrc = read('js/index.js');
    const sw = read('sw.js');
    for (const file of files) {
        expect(exists(file), file + ' exists');
        expect(!scripts.includes(file), 'and has no script tag downloading it anyway');
        expect(sw.includes(`'/${file}'`), 'and the service worker keeps it for offline');
        const src = read(file);
        const undeclared = MODULES[file].filter(n =>
            !new RegExp('^(?:async\\s+)?function\\s+' + n + '\\b', 'm').test(src) &&
            !new RegExp('window\\.' + n + '\\s*=').test(src));
        expect(!undeclared.length, 'and declares everything the table says it does', undeclared.join(', '));
    }
    // a name a file exposes that the table forgot is a ReferenceError the first
    // time anything calls it, so hold the whole action table to something real
    const declared = new Set(Object.values(MODULES).flat());
    const onDemand = files.map(read).join('\n');
    const forgotten = [...actionsSrc.slice(actionsSrc.indexOf('function appActions()')).matchAll(/^\s+['\w]+: (open[A-Z]\w+|toggle[A-Z]\w+|surpriseMe)\b/gm)]
        .map(m => m[1]).filter(fn => new RegExp('function ' + fn + '\\b').test(onDemand) && !declared.has(fn));
    expect(!forgotten.length, 'every action an on-demand file answers is in the table', forgotten.join(', '));

    const sw2 = sw.match(/PRECACHE = \[([\s\S]*?)\]/);
    expect(sw2 && !sw2[1].includes('/games/') && !sw2[1].includes('/js/vendor/motion.js'),
        'the install only waits for the desktop itself, not the games');
    expect(/PRECACHE_LATER = \[/.test(sw) && /postMessage\('warm'\)/.test(lazy),
        'and the rest is fetched after somebody has stayed');
    expect(/saveData/.test(lazy), 'unless their connection asked it not to be');
}

// ===================================================================
section('startup does not build what nobody asked for');
// ===================================================================
{
    const index = read('js/index.js');
    const boot = index.slice(index.indexOf("document.addEventListener('DOMContentLoaded'"), index.indexOf('function whenIdle'));
    for (const fn of ['fetchGitHubRepos', 'fetchManualProjects', 'fetchPlaygroundCatalog']) {
        expect(!new RegExp('\\b' + fn + '\\(').test(boot), fn + ' waits for its section to open');
    }
    expect(/whenOnScreen\(document\.getElementById\('shoutbox-window'\), fetchShoutbox\)/.test(boot), 'the shoutbox waits to be looked at');
    expect(/userActivation/.test(index.slice(index.indexOf('function playSound'), index.indexOf('function toggleSound'))),
        'and no sound is downloaded for a page that is not allowed to play it');
    expect(/function createSparkle[\s\S]{0,700}?createElement\('i'\)/.test(index),
        'a sparkle is not a div, so it cannot become the last one in body');
    expect(/if \(!window\.Motion && window\.LAZY\)/.test(read('js/music-stage.js')), 'Motion waits for concert mode');
}

// ===================================================================
section('the auto scaler');
// ===================================================================
{
    const unix = s => s.replace(/\r\n/g, '\n').replace(/^[ \t]+/gm, '');
    const snippet = src => (/<script>\s*\/\/ the half of js\/scale\.js[\s\S]*?<\/script>/.exec(src) || [''])[0];
    const first = unix(snippet(html));
    expect(first.includes('window.siteFit'), 'index.html fits the page in its head');
    for (const page of PAGES) {
        const src = read(page);
        expect(unix(snippet(src)) === first, page + ' carries the same text');
        expect(src.indexOf('the half of js/scale.js') < src.indexOf('css/style.css'), 'and runs before the first stylesheet, so nothing paints at the wrong size');
        const order = [...src.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
        expect(order.includes('js/scale.js') && order.indexOf('js/scale.js') < order.indexOf('js/index.js'), 'and loads js/scale.js before anything that reads the mouse');
    }
    expect(scripts[1] === 'js/scale.js', 'on the desktop right behind js/lazy.js, first in the queue for a resize', scripts[1]);
    expect(read('sw.js').includes("'/js/scale.js'"), 'the service worker keeps it for offline');

    // Under zoom, 100vh is taller than the screen in two engines out of three. A
    // rule behind a narrow media query never sees a scale above 1: it takes a
    // viewport over 1706 wide to get one.
    const bare = /(?<![\w.])[\d.]+d?v[hw]\b(?!\s*\/\s*var\(--z)/;
    const offenders = [];
    let depth = 0, inComment = false;
    const narrow = [];
    read('css/style.css').split(/\r?\n/).forEach((line, i) => {
        const code = line.replace(/\/\*.*?\*\//g, '');
        const opens = code.includes('/*'), closes = code.includes('*/');
        const live = inComment || opens ? '' : code;
        if (opens && !closes) inComment = true;
        if (closes && !opens) inComment = false;
        if (bare.test(live) && !narrow.length && !/@supports/.test(live) && !/-?[\d.]+d?v[hw] \/ var/.test(live)) offenders.push((i + 1) + ': ' + live.trim());
        if (/@media[^{]*max-(?:width|height)/.test(live)) narrow.push(depth);
        depth += (live.match(/\{/g) || []).length - (live.match(/\}/g) || []).length;
        while (narrow.length && depth <= narrow[narrow.length - 1]) narrow.pop();
    });
    expect(!offenders.length, 'style.css divides every viewport unit by the scale', offenders.slice(0, 6).join(' | '));
    // the declarations only: a class name is allowed to mention what it does
    const tw = read('css/tailwind.css').replace(/[^{}]+{/g, '{');
    expect(!/[\d.]d?v[hw](?!\s*\/\s*var\(--z)[^\w]/.test(tw), 'and so does tailwind.css', (/.{30}\d+d?v[hw].{20}/.exec(tw) || [''])[0]);

    // in a script a viewport unit is a string. isMobile is never scaled, and the
    // minimize animation only overshoots a little further off the screen.
    const strays = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))) {
        read('js/' + f).split(/\r?\n/).forEach((line, i) => {
            if (/['"`][^'"`]*\d+d?v[hw]\b/.test(line) && !/isMobile|translateY\(40vh\)|var\(--z/.test(line) && !/^\s*\/\//.test(line)) strays.push(f + ':' + (i + 1));
        });
    }
    expect(!strays.length, 'and so does every script', strays.join(', '));
}

// ===================================================================
section('data/news.json opens what it says it opens');
// ===================================================================
{
    const news = JSON.parse(read('data/news.json'));
    expect(Array.isArray(news) && news.length >= 3, 'it has news in it');
    const actionsSrc = read('js/index.js');
    const actions = actionsSrc.slice(actionsSrc.indexOf('function appActions()'), actionsSrc.indexOf('function startMenuAction'));
    for (const item of news) {
        const name = item.title || JSON.stringify(item);
        expect(/^\d{4}-\d{2}-\d{2}$/.test(item.date || ''), name + ' has a date');
        expect(!!item.text && item.text === item.text.toLowerCase(), 'and a line in the house style');
        expect(!!item.app !== !!item.url, 'and one thing it opens, an app or a url');
        if (item.app) expect(new RegExp("^\\s+'?" + item.app + "'?:", 'm').test(actions), item.app + ' is on the action table');
        if (item.url) expect(/^\/[\w/-]+\/$/.test(item.url) && exists(item.url.slice(1) + 'index.html'), item.url + ' is a page on the disk');
    }
    const dates = news.map(i => i.date);
    expect(dates.join() === [...dates].sort().reverse().join(), 'newest first, since the panel shows the top of the file');
    expect(read('sw.js').includes("'/data/news.json'"), 'and the service worker has it for offline');
}

// ===================================================================
section('the budget');
// ===================================================================
{
    const kb = n => Math.round(n / 1024) + 'kb';
    const scriptBytes = scripts.reduce((sum, s) => sum + gz(s), 0);
    expect(scriptBytes <= BUDGET.scripts, 'the desktop\'s scripts fit in ' + kb(BUDGET.scripts) + ' (' + kb(scriptBytes) + ')',
        scripts.map(s => kb(gz(s)) + ' ' + s).join(', '));
    const styleBytes = gz('css/style.css') + gz('css/tailwind.css');
    expect(styleBytes <= BUDGET.styles, 'its stylesheets fit in ' + kb(BUDGET.styles) + ' (' + kb(styleBytes) + ')');

    // the images in the markup, before anything has been clicked
    const images = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
    expect(images.length > 0, 'and the desktop has images to check');
    const heavy = images.filter(s => exists(s) && fs.statSync(path.join(ROOT, s)).size > BUDGET.image);
    expect(!heavy.length, 'none of them is over ' + kb(BUDGET.image), heavy.join(', '));
    const missing = images.filter(s => !exists(s));
    expect(!missing.length, 'and every one of them exists', missing.join(', '));
    const unsized = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<img\b[^>]*>/g)].map(m => m[0])
        .filter(t => !/\b(?:width|height)=/.test(t) && !/\bclass="[^"]*\bw-/.test(t));
    expect(!unsized.length, 'and every one has a size before it loads', unsized.join(' '));
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
