// ===================================================================
// mrhakan 98 — the reading layer
//
// The desktop was always good at being a desktop and bad at being a
// document. Everything below is about the second half: making a window
// something you can link to, skim, quote, print and read.
//
// Nothing here is a framework and nothing here is required — every
// feature degrades to "the window still opens" if it fails. The layer
// patches the desktop's own globals rather than editing them in place,
// so index.js stays the file that draws windows and this stays the file
// that makes them readable. js/web.js therefore loads last.
// ===================================================================

const WEB = (function () {

    // ---------- routes ----------
    // the four things the desktop calls "sections" — everything else is an
    // app window, and its slug is whatever key appActions() files it under
    const SECTIONS = ['home', 'github', 'links', 'guestbook'];

    // the url should read the way the rest of the web writes these — /uses,
    // not /usespage — so a handful of routes get a public name that is not
    // the key appActions() happens to file them under. The table is read
    // both ways: in to resolve, out to build.
    const PRETTY = {
        usespage: 'uses',
        nethistory: 'internet-life',
        sysprops: 'system',
        taskmgr: 'task-manager',
        thememaker: 'theme-maker',
        l33t: 'l33t-name',
        '8ball': 'magic-8-ball'
    };
    const CANONICAL = Object.keys(PRETTY).reduce((m, k) => (m[PRETTY[k]] = k, m), {});

    // a few more names people type for the same thing, one way only
    const INPUT_ALIASES = {
        blog: 'devlog', posts: 'devlog', writing: 'devlog',
        projects: 'github', work: 'github', portfolio: 'github',
        friends: 'blogroll', badges: 'buttons', '88x31': 'buttons',
        timeline: 'nethistory', map: 'sitemap', settings: 'control',
        search: 'find', about: 'home', feed: 'rss'
    };

    // actions written as arrows in appActions() carry the slug as their
    // .name and no global of that name, so the wrapper below skips them.
    // These are the ones worth routing anyway, named by hand.
    const ARROW_ROUTES = {
        openEchoes: 'echoes',
        openWizardz: 'wizardz',
        openNetplay: 'netplay',
        openNotepad: 'notepad'
    };

    let pending = null;   // slug of the route currently being opened
    let routed = null;    // the window that route produced
    let ready = false;

    function slugs() {
        const out = SECTIONS.slice();
        try { out.push(...Object.keys(appActions())); } catch (e) { }
        return out;
    }

    // whatever came out of the address bar, in the desktop's own vocabulary
    function resolve(slug) {
        if (!slug) return null;
        const s = String(slug).toLowerCase();
        const c = CANONICAL[s] || INPUT_ALIASES[s] || s;
        return slugs().indexOf(c) !== -1 ? c : null;
    }

    function isRoute(slug) { return !!resolve(slug); }

    function urlFor(slug, hash) {
        const c = resolve(slug);
        if (!c) return location.origin + location.pathname;
        const base = location.origin + location.pathname;
        const q = c === 'home' ? '' : '?app=' + encodeURIComponent(PRETTY[c] || c);
        return base + q + (hash ? '#' + hash : '');
    }

    function push(slug, replace) {
        if (!isRoute(slug)) return;
        const url = urlFor(slug);
        if (url === location.href) return;
        try { history[replace ? 'replaceState' : 'pushState']({ app: slug }, '', url); } catch (e) { }
        paintAddress();
    }

    // back to the desktop with no app in the address bar
    function clearUrl() {
        if (!location.search && !location.hash) return;
        try { history.replaceState({}, '', location.origin + location.pathname); } catch (e) { }
        paintAddress();
    }

    // open a slug the same way the start menu would, and say so in the url
    function open(slug, opts) {
        opts = opts || {};
        const c = resolve(slug);
        if (!c) return false;
        pending = c;
        if (opts.push !== false) push(c, opts.replace);
        try {
            if (SECTIONS.indexOf(c) !== -1) showSection(c);
            else { const a = appActions()[c]; if (a) a(); }
        } catch (e) { pending = null; return false; }
        pending = null;
        return true;
    }

    // ?app=colophon#what-it-is-built-with — open it, then find the heading
    function openFromUrl(opts) {
        const slug = new URLSearchParams(location.search).get('app');
        if (!slug) return false;
        const hash = (location.hash || '').replace(/^#/, '');
        const done = open(slug, { push: false });
        if (done && hash) setTimeout(() => scrollToAnchor(hash), 120);
        return done;
    }

    function scrollToAnchor(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.scrollIntoView({ block: 'start', behavior: FX && FX.on && FX.on() ? 'smooth' : 'auto' });
        el.classList.add('anchor-hit');
        setTimeout(() => el.classList.remove('anchor-hit'), 1600);
    }

    // ---------- the toolbar every document window gets ----------

    function words(el) {
        const t = (el.innerText || el.textContent || '').trim();
        return t ? t.split(/\s+/).length : 0;
    }

    // both numbers, deliberately. "minutes" assumes a reader at 220wpm and
    // that is not everybody, so the word count is there to argue with.
    function readingTime(n) {
        const mins = Math.max(1, Math.round(n / 220));
        return n.toLocaleString() + ' words · ~' + mins + ' min';
    }

    // ---------- headings you can link to ----------

    function slugify(s) {
        return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'section';
    }

    function anchorHeadings(body, route) {
        const heads = body.querySelectorAll('.doc-h2, .doc-h3, h3.doc-h2, h2.doc-h1');
        const seen = {};
        heads.forEach(h => {
            if (h.classList.contains('doc-h1')) return;      // the title is not a section
            if (h.querySelector('.h-anchor')) return;
            let id = slugify(h.textContent.replace(/^::\s*|\s*::$/g, ''));
            while (seen[id]) id = id + '-' + (seen[id]++);
            seen[id] = 1;
            h.id = id;
            const a = document.createElement('button');
            a.className = 'h-anchor';
            a.type = 'button';
            a.title = 'copy a link to this bit';
            // the headings are written ":: like this ::"; a screen reader
            // should not read the decoration out as part of the name
            a.setAttribute('aria-label', 'copy a link to "' +
                h.textContent.replace(/^::\s*|\s*::$/g, '').trim() + '"');
            a.textContent = '#';
            a.onclick = (e) => {
                e.stopPropagation();
                copy(urlFor(route || 'home', id), 'link to that section copied');
            };
            h.appendChild(a);
        });
        return heads.length;
    }

    // ---------- table of contents ----------
    // only earns its space on a long document; three headings is the line

    function buildToc(body) {
        const heads = Array.prototype.filter.call(
            body.querySelectorAll('.doc-h2'), h => !!h.id);
        if (heads.length < 3) return null;
        const box = document.createElement('details');
        box.className = 'doc-toc';
        const sum = document.createElement('summary');
        sum.textContent = 'contents (' + heads.length + ')';
        box.appendChild(sum);
        const ul = document.createElement('ul');
        heads.forEach(h => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = '#' + h.id;
            a.textContent = h.textContent.replace(/^::\s*|\s*::$/g, '').replace(/#$/, '').trim();
            a.onclick = (e) => { e.preventDefault(); scrollToAnchor(h.id); };
            li.appendChild(a);
            ul.appendChild(li);
        });
        box.appendChild(ul);
        return box;
    }

    // ---------- links that tell you where they go ----------
    // an arrow for "this leaves the site", and a letter for the ones worth
    // recognising on sight. Cheap, and it stops the guessing.

    const LINK_MARKS = [
        [/(^|\.)github\.com$/, 'GH', 'github'],
        [/(^|\.)wikipedia\.org$/, 'W', 'wikipedia'],
        [/(^|\.)(youtube\.com|youtu\.be)$/, '▶', 'youtube'],
        [/(^|\.)(twitter\.com|x\.com)$/, 'X', 'twitter'],
        [/(^|\.)(archive\.org|web\.archive\.org)$/, '▤', 'archive'],
        [/(^|\.)neocities\.org$/, 'N', 'neocities'],
        [/(^|\.)(reddit\.com)$/, 'R', 'reddit'],
        [/(^|\.)(steamcommunity\.com|steampowered\.com)$/, 'S', 'steam']
    ];

    function markLinks(root) {
        root.querySelectorAll('a[href]').forEach(a => {
            if (a.dataset.marked) return;
            let u;
            try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
            if (u.origin === location.origin) return;             // ours, leave it be
            if (!/^https?:$/.test(u.protocol)) return;
            a.dataset.marked = '1';
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            let glyph = '↗', kind = 'external';
            for (const [re, g, k] of LINK_MARKS) {
                if (re.test(u.hostname)) { glyph = g; kind = k; break; }
            }
            const s = document.createElement('span');
            s.className = 'link-mark link-mark-' + kind;
            s.setAttribute('aria-hidden', 'true');
            s.textContent = glyph;
            a.appendChild(s);
            if (!a.title) a.title = u.hostname + ' — opens in a new tab';
        });
    }

    // ---------- sidenotes ----------
    // prose written anywhere in data/ can say [[note: ...]] and get a
    // margin note out of it. On a window too narrow for a margin the note
    // folds inline under the paragraph instead of being thrown away.

    let noteSeq = 0;

    function prose(text) {
        const parts = String(text).split(/\[\[note:\s*([\s\S]*?)\]\]/g);
        let out = '';
        for (let i = 0; i < parts.length; i++) {
            if (i % 2 === 0) { out += escapeHtml(parts[i]); continue; }
            const n = ++noteSeq;
            out += '<span class="sn"><button type="button" class="sn-ref" aria-expanded="false"' +
                ' aria-controls="sn-' + n + '" title="a note">' + n + '</button>' +
                '<span class="sn-note" id="sn-' + n + '" role="note"><b>' + n + '.</b> ' +
                escapeHtml(parts[i]) + '</span></span>';
        }
        return out;
    }

    function wireSidenotes(root) {
        root.querySelectorAll('.sn-ref').forEach(btn => {
            if (btn.dataset.wired) return;
            btn.dataset.wired = '1';
            btn.onclick = () => {
                const on = btn.parentNode.classList.toggle('open');
                btn.setAttribute('aria-expanded', on ? 'true' : 'false');
            };
        });
    }

    // ---------- plain text ----------
    // the whole document, no markup, no styling, selectable in one go —
    // the thing you actually want when you mean to quote it somewhere.

    function toText(body) {
        const lines = [];
        const walk = (node) => {
            node.childNodes.forEach(n => {
                if (n.nodeType === 3) return;
                if (n.nodeType !== 1) return;
                if (n.classList && (n.classList.contains('doc-tools') ||
                    n.classList.contains('doc-toc') ||
                    n.classList.contains('h-anchor') ||
                    n.classList.contains('link-mark'))) return;
                const txt = (n.innerText || n.textContent || '').replace(/\s+\n/g, '\n').trim();
                if (n.classList && n.classList.contains('doc-h1')) {
                    lines.push('', txt.replace(/#$/, '').trim(), '='.repeat(Math.min(60, txt.length)), '');
                } else if (n.classList && n.classList.contains('doc-h2')) {
                    lines.push('', txt.replace(/#$/, '').trim(), '-'.repeat(Math.min(60, txt.length)));
                } else if (n.tagName === 'UL' || n.tagName === 'OL') {
                    n.querySelectorAll('li').forEach(li => lines.push('  - ' + (li.innerText || li.textContent).trim()));
                    lines.push('');
                } else if (n.children.length && n.tagName !== 'P') {
                    walk(n);
                } else if (txt) {
                    lines.push(wrap(txt, 72), '');
                }
            });
        };
        walk(body);
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    }

    function wrap(s, n) {
        const out = [];
        let line = '';
        s.split(/\s+/).forEach(w => {
            if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; }
            else line += ' ' + w;
        });
        if (line.trim()) out.push(line.trim());
        return out.join('\n');
    }

    function copy(text, msg) {
        const done = () => { if (typeof showToast === 'function') showToast(msg || 'copied'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
        } else fallbackCopy(text, done);
    }

    function fallbackCopy(text, done) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { }
        ta.remove();
    }

    // ---------- how big the text is ----------
    // 12px courier is a period-correct choice and an unkind one. The
    // setting is per-person and it sticks, because changing it on every
    // document you open is not a setting, it is a chore.

    const SIZE_KEY = 'mrhakan98.textsize';
    const SIZES = [11, 12, 13, 15, 17];

    function textSize() {
        const n = parseInt(localStorage.getItem(SIZE_KEY) || '', 10);
        return SIZES.indexOf(n) !== -1 ? n : 12;
    }

    function setTextSize(px) {
        const n = SIZES.indexOf(px) !== -1 ? px : 12;
        try { localStorage.setItem(SIZE_KEY, String(n)); } catch (e) { }
        document.documentElement.style.setProperty('--doc-font-size', n + 'px');
        return n;
    }

    function restoreTextSize() { setTextSize(textSize()); }

    function stepTextSize(dir) {
        const at = SIZES.indexOf(textSize());
        const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, at + dir))];
        setTextSize(next);
        if (typeof showToast === 'function') showToast('text size', next + 'px');
        return next;
    }

    // ---------- printing ----------
    // the desktop is chrome. Printing one window should print the document
    // in it and nothing else — see the @media print block in style.css.

    function printWindow(win) {
        document.querySelectorAll('.print-target').forEach(w => w.classList.remove('print-target'));
        win.classList.add('print-target');
        document.body.classList.add('printing');
        const off = () => {
            document.body.classList.remove('printing');
            win.classList.remove('print-target');
            window.removeEventListener('afterprint', off);
        };
        window.addEventListener('afterprint', off);
        setTimeout(() => { window.print(); setTimeout(off, 1000); }, 40);
    }

    // ---------- the whole pipeline ----------
    // called once a document window has its real content in it

    function enhance(body, opts) {
        opts = opts || {};
        const win = body.closest('.app-window') || body.parentNode;
        if (!body || body.querySelector('.doc-tools')) return;
        const route = opts.route || (win && win._route) || null;

        anchorHeadings(body, route);
        markLinks(body);
        wireSidenotes(body);

        const n = words(body);
        const tools = document.createElement('div');
        tools.className = 'doc-tools';
        tools.innerHTML =
            '<button type="button" class="doc-tool" data-t="text" title="the same document as plain text">¶ text</button>' +
            '<button type="button" class="doc-tool" data-t="print" title="print just this window">⎙ print</button>' +
            (route ? '<button type="button" class="doc-tool" data-t="link" title="copy a link that opens this window">🔗 link</button>' : '') +
            '<span class="doc-size" role="group" aria-label="text size">' +
            '<button type="button" class="doc-tool" data-t="smaller" title="smaller text" aria-label="smaller text">A-</button>' +
            '<button type="button" class="doc-tool" data-t="bigger" title="bigger text" aria-label="bigger text">A+</button>' +
            '</span>' +
            '<span class="doc-count" title="at about 220 words a minute, which may well not be your minute">' +
            readingTime(n) + '</span>';

        const toc = buildToc(body);
        body.insertBefore(tools, body.firstChild);
        if (toc) body.insertBefore(toc, tools.nextSibling);

        // plain text swaps in and back out, so the rendered version is never lost
        let plain = null;
        tools.querySelector('[data-t="text"]').onclick = function () {
            if (plain) { plain.remove(); plain = null; this.classList.remove('on'); return; }
            const pre = document.createElement('pre');
            pre.className = 'doc-plain';
            pre.textContent = toText(body);
            const bar = document.createElement('div');
            bar.className = 'doc-plain-bar';
            const c = document.createElement('button');
            c.type = 'button';
            c.className = 'doc-tool';
            c.textContent = 'copy all';
            c.onclick = () => copy(pre.textContent, 'the whole thing, as text');
            const np = document.createElement('button');
            np.type = 'button';
            np.className = 'doc-tool';
            np.textContent = 'open in notepad';
            np.onclick = () => { if (typeof openNotepad === 'function') openNotepad(pre.textContent); };
            bar.appendChild(c);
            bar.appendChild(np);
            plain = document.createElement('div');
            plain.className = 'doc-plain-wrap';
            plain.appendChild(bar);
            plain.appendChild(pre);
            body.insertBefore(plain, toc ? toc.nextSibling : tools.nextSibling);
            this.classList.add('on');
        };
        tools.querySelector('[data-t="print"]').onclick = () => printWindow(win);
        tools.querySelector('[data-t="smaller"]').onclick = () => stepTextSize(-1);
        tools.querySelector('[data-t="bigger"]').onclick = () => stepTextSize(1);
        const linkBtn = tools.querySelector('[data-t="link"]');
        if (linkBtn) linkBtn.onclick = () => copy(urlFor(route), 'link to this window copied');

        addProgress(win, body);
    }

    // ---------- how far through you are ----------
    // the window scrolls, not the page, so the page scrollbar cannot answer
    // this. The bar only appears once there is something to scroll.

    function addProgress(win, body) {
        if (!win || win.querySelector('.doc-progress')) return;
        const bar = document.createElement('div');
        bar.className = 'doc-progress';
        bar.innerHTML = '<i></i>';
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-label', 'how far through this document you are');
        win.insertBefore(bar, body);
        const fill = bar.querySelector('i');
        const update = () => {
            const max = body.scrollHeight - body.clientHeight;
            if (max < 40) { bar.classList.add('idle'); return; }
            bar.classList.remove('idle');
            const pct = Math.min(100, Math.max(0, (body.scrollTop / max) * 100));
            fill.style.width = pct.toFixed(1) + '%';
            bar.setAttribute('aria-valuenow', Math.round(pct));
        };
        body.addEventListener('scroll', update, { passive: true });
        setTimeout(update, 60);
    }

    // ---------- patching the desktop ----------

    function patch() {
        // every window created while a route is being opened belongs to it
        const _create = window.createAppWindow;
        if (typeof _create === 'function') {
            window.createAppWindow = function (title, opts) {
                const res = _create.apply(this, arguments);
                if (pending && res && res.win) {
                    res.win._route = pending;
                    routed = res.win;
                    addLinkButton(res.win, pending);
                }
                return res;
            };
        }

        // closing the window the address bar is pointing at gives the url back
        const _close = window.closeAppWindow;
        if (typeof _close === 'function') {
            window.closeAppWindow = function (id) {
                const win = document.getElementById(id);
                if (win && win._route && win === routed) { routed = null; clearUrl(); }
                return _close.apply(this, arguments);
            };
        }

        // the start menu, the run box and find: all funnel through here
        const _menu = window.startMenuAction;
        if (typeof _menu === 'function') {
            window.startMenuAction = function (action) {
                if (isRoute(action)) { open(action); return; }
                return _menu.apply(this, arguments);
            };
        }

        const _section = window.showSection;
        if (typeof _section === 'function') {
            window.showSection = function (id) {
                const r = _section.apply(this, arguments);
                if (ready && SECTIONS.indexOf(id) !== -1) {
                    if (id === 'home') clearUrl(); else push(id);
                }
                return r;
            };
        }

        // anything opened by calling its function directly — the site map's
        // links, find:, the run box — still knows which route it is
        let actions = {};
        try { actions = appActions(); } catch (e) { }
        Object.keys(actions).forEach(slug => {
            const fn = actions[slug];
            const name = fn && fn.name;
            if (!name || typeof window[name] !== 'function' || window[name] !== fn) return;
            const orig = window[name];
            window[name] = function () {
                const had = pending;
                if (!had) pending = slug;
                try { return orig.apply(this, arguments); }
                finally { if (!had) pending = null; }
            };
        });
        Object.keys(ARROW_ROUTES).forEach(name => {
            if (typeof window[name] !== 'function' || window[name].__routed) return;
            const orig = window[name], slug = ARROW_ROUTES[name];
            const wrapped = function () {
                const had = pending;
                if (!had) pending = slug;
                try { return orig.apply(this, arguments); }
                finally { if (!had) pending = null; }
            };
            wrapped.__routed = true;
            window[name] = wrapped;
        });
    }

    // a link button in the title bar, next to minimise — the window's own
    // permalink, because "how do i show someone this" should have an answer
    function addLinkButton(win, slug) {
        const header = win.querySelector('.app-window-header');
        const btns = header && header.querySelector('.flex.gap-\\[2px\\]');
        const row = btns || (header && header.lastElementChild);
        if (!row) return;
        const b = document.createElement('button');
        b.className = 'ie-titlebar-btn bevel-out';
        b.textContent = '🔗';
        b.title = 'copy a link straight to this window';
        b.setAttribute('aria-label', 'copy a link to this window');
        b.onclick = (e) => { e.stopPropagation(); copy(urlFor(slug), 'link to this window copied'); };
        row.insertBefore(b, row.firstChild);
    }

    // ===================================================================
    // the address bar
    //
    // The main window has been dressed as internet explorer forever, with
    // a menu that did nothing and no address bar, because there was
    // nothing to put in one. There is now.
    // ===================================================================

    function addressEl() { return document.getElementById('ie-address'); }

    // what the address bar should read, for whatever is on top
    function currentUrl() {
        const slug = new URLSearchParams(location.search).get('app');
        return slug ? urlFor(slug) : location.origin + location.pathname;
    }

    function paintAddress() {
        const el = addressEl();
        if (!el || el === document.activeElement) return;   // never fight a typist
        el.value = currentUrl();
        const fav = document.getElementById('ie-fav');
        if (fav) {
            const on = isFavourite(currentRouteSlug());
            fav.classList.toggle('on', on);
            fav.title = on ? 'remove this page from favorites' : 'add this page to favorites';
        }
    }

    function currentRouteSlug() {
        return new URLSearchParams(location.search).get('app') || 'home';
    }

    // what a person types is not a url. "now", "/now", "?app=now" and the
    // whole address all mean the same page, so all four work.
    function parseTyped(text) {
        let t = String(text || '').trim();
        if (!t) return null;
        try {
            if (/^https?:\/\//i.test(t)) {
                const u = new URL(t);
                if (u.origin !== location.origin) return { external: u.href };
                t = new URLSearchParams(u.search).get('app') || u.pathname;
            }
        } catch (e) { }
        t = t.replace(/^\?app=/, '').replace(/^\/+|\/+$/g, '').replace(/\.(html?|txt)$/, '');
        if (!t) return { slug: 'home' };
        const r = resolve(t);
        return r ? { slug: r } : { unknown: t };
    }

    function goTyped() {
        const el = addressEl();
        if (!el) return;
        const parsed = parseTyped(el.value);
        if (!parsed) return;
        if (parsed.external) { window.open(parsed.external, '_blank', 'noopener'); paintAddress(); return; }
        if (parsed.slug) {
            el.blur();
            open(parsed.slug);
            if (typeof playSound === 'function') playSound('navigate');
            return;
        }
        // not a page — hand it to find:, which is what you wanted anyway
        el.blur();
        if (typeof showToast === 'function') showToast('address', 'no page called "' + parsed.unknown + '" — searching instead');
        if (typeof openFindFiles === 'function') openFindFiles(parsed.unknown);
    }

    // ---------- favourites, which used to be a joke ----------
    // the menu said "added mrhakan.github.io to your favorites!" and added
    // nothing. A bookmark is a url, and there are urls now.

    const FAV_KEY = 'mrhakan98.favourites';

    function favourites() {
        try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]').filter(f => f && f.slug); }
        catch (e) { return []; }
    }

    function saveFavourites(list) {
        try { localStorage.setItem(FAV_KEY, JSON.stringify(list.slice(0, 40))); } catch (e) { }
    }

    function isFavourite(slug) {
        const c = resolve(slug);
        return favourites().some(f => f.slug === c);
    }

    function toggleFavourite(slug, label) {
        const c = resolve(slug || currentRouteSlug());
        if (!c) return false;
        const list = favourites();
        const at = list.findIndex(f => f.slug === c);
        if (at !== -1) {
            list.splice(at, 1);
            saveFavourites(list);
            if (typeof showToast === 'function') showToast('favorites', 'removed from favorites');
        } else {
            list.unshift({ slug: c, name: label || routeLabel(c), at: Date.now() });
            saveFavourites(list);
            if (typeof showToast === 'function') showToast('favorites', 'added "' + (label || routeLabel(c)) + '" to favorites');
            if (typeof unlockAchievement === 'function') unlockAchievement('bookmarked');
        }
        if (typeof playSound === 'function') playSound('ding');
        paintAddress();
        return true;
    }

    // the title of whatever the route opens, taken from the window it made
    // rather than a second list that would drift out of date
    function routeLabel(slug) {
        const c = resolve(slug);
        if (!c) return slug;
        if (routed && routed._route === c) {
            const t = routed.querySelector('.app-window-title');
            if (t && t.textContent.trim()) return t.textContent.trim();
        }
        return PRETTY[c] || c;
    }

    function renderFavourites() {
        const box = document.getElementById('ie-favs');
        if (!box) return;
        const list = favourites();
        box.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'ie-favs-head';
        head.textContent = list.length ? 'favorites' : 'no favorites yet';
        box.appendChild(head);
        if (!list.length) {
            const hint = document.createElement('div');
            hint.className = 'ie-favs-empty';
            hint.textContent = 'open something and press the ★ in the address bar.';
            box.appendChild(hint);
        }
        list.forEach(f => {
            const row = document.createElement('div');
            row.className = 'ie-fav-row';
            const go = document.createElement('button');
            go.className = 'ie-fav-go';
            go.type = 'button';
            go.textContent = f.name || f.slug;
            go.title = urlFor(f.slug);
            go.onclick = () => { hideFavourites(); open(f.slug); };
            const del = document.createElement('button');
            del.className = 'ie-fav-del';
            del.type = 'button';
            del.textContent = '✕';
            del.title = 'remove';
            del.setAttribute('aria-label', 'remove ' + (f.name || f.slug) + ' from favorites');
            del.onclick = (e) => {
                e.stopPropagation();
                saveFavourites(favourites().filter(x => x.slug !== f.slug));
                renderFavourites();
                paintAddress();
            };
            row.appendChild(go);
            row.appendChild(del);
            box.appendChild(row);
        });
        box.hidden = false;
    }

    function hideFavourites() {
        const box = document.getElementById('ie-favs');
        if (box) box.hidden = true;
    }

    function toggleFavouritesMenu() {
        const box = document.getElementById('ie-favs');
        if (!box) return;
        if (box.hidden) renderFavourites(); else hideFavourites();
    }

    function initAddressBar() {
        const el = addressEl();
        if (!el) return;
        paintAddress();
        el.addEventListener('keydown', (e) => {
            e.stopPropagation();                       // the desktop eats keys otherwise
            if (e.key === 'Enter') goTyped();
            if (e.key === 'Escape') { paintAddress(); el.blur(); }
        });
        el.addEventListener('focus', () => el.select());
        el.addEventListener('blur', () => setTimeout(paintAddress, 40));

        const on = (id, fn) => {
            const b = document.getElementById(id);
            if (b) b.onclick = fn;
        };
        on('ie-go', goTyped);
        on('ie-back', () => history.back());
        on('ie-fwd', () => history.forward());
        on('ie-home', () => { hideFavourites(); open('home'); });
        on('ie-reload', () => {
            // reopen whatever the address is pointing at, rather than
            // reloading the page and losing every other open window
            const slug = currentRouteSlug();
            if (routed && routed.id && typeof window.closeAppWindow === 'function') {
                const id = routed.id;
                routed = null;
                window.closeAppWindow(id);
            }
            open(slug, { push: false });
            if (typeof playSound === 'function') playSound('navigate');
        });
        on('ie-fav', () => toggleFavourite());

        document.addEventListener('click', (e) => {
            if (e.target.closest('#ie-favs') || e.target.closest('[onclick*="favorites"]')) return;
            hideFavourites();
        });
    }

    // ===================================================================
    // quote a document
    //
    // Select a sentence and you get the sentence plus the address of the
    // section it came from. Quoting somebody accurately should not require
    // hunting for where you were.
    // ===================================================================

    function initQuoting() {
        let bubble = null;
        const kill = () => { if (bubble) { bubble.remove(); bubble = null; } };

        document.addEventListener('selectionchange', () => {
            const sel = document.getSelection();
            if (!sel || sel.isCollapsed) { kill(); return; }
            const text = sel.toString().trim();
            const node = sel.anchorNode;
            const body = node && (node.nodeType === 1 ? node : node.parentNode);
            const doc = body && body.closest && body.closest('.doc-body');
            if (!doc || text.length < 12) { kill(); return; }
            if (bubble) return;                        // one bubble is enough
            bubble = document.createElement('button');
            bubble.type = 'button';
            bubble.className = 'quote-bubble bevel-out';
            bubble.textContent = '❝ copy quote';
            bubble.title = 'copy the selection with a link back to it';
            bubble.onmousedown = (e) => e.preventDefault();   // keep the selection
            bubble.onclick = () => {
                const win = doc.closest('.app-window');
                const route = (win && win._route) || currentRouteSlug();
                const heading = nearestHeading(sel.anchorNode);
                copy('"' + text + '"\n\n— ' + urlFor(route, heading),
                    'quote copied, with the link');
                kill();
            };
            doc.appendChild(bubble);
        });
        document.addEventListener('scroll', kill, true);
    }

    // which section a selection landed in, so the link lands there too
    function nearestHeading(node) {
        let el = node && (node.nodeType === 1 ? node : node.parentNode);
        while (el && !el.classList?.contains('doc-body')) {
            let sib = el.previousElementSibling;
            while (sib) {
                if (sib.classList && sib.classList.contains('doc-h2') && sib.id) return sib.id;
                sib = sib.previousElementSibling;
            }
            el = el.parentNode;
        }
        return '';
    }

    // ---------- back button ----------

    window.addEventListener('popstate', () => {
        paintAddress();
        const slug = new URLSearchParams(location.search).get('app');
        if (!slug) {
            // back to the bare desktop: shut the window the url had opened
            if (routed && routed.id) {
                const id = routed.id;
                routed = null;
                const c = window.closeAppWindow;
                if (typeof c === 'function') c(id);
            }
            return;
        }
        if (routed && routed._route === resolve(slug)) return;
        open(slug, { push: false });
    });

    document.addEventListener('DOMContentLoaded', () => {
        patch();
        markLinks(document.body);
        wireSidenotes(document.body);
        initAddressBar();
        initQuoting();
        restoreTextSize();
        ready = true;
        // wait for the boot screen to be out of the way before an app
        // shoves itself in front of it
        const boot = document.getElementById('boot-screen');
        const go = () => openFromUrl();
        if (!boot || boot.classList.contains('booted')) setTimeout(go, 60);
        else {
            const t = setInterval(() => {
                const b = document.getElementById('boot-screen');
                if (!b || b.classList.contains('booted')) { clearInterval(t); setTimeout(go, 260); }
            }, 200);
            setTimeout(() => clearInterval(t), 30000);
        }
    });

    return {
        open, openFromUrl, urlFor, isRoute, resolve, slugs, enhance, prose, markLinks,
        paintAddress, parseTyped, favourites, toggleFavourite, isFavourite,
        toggleFavouritesMenu, renderFavourites, routeLabel, nearestHeading,
        textSize, setTextSize, stepTextSize, restoreTextSize,
        wireSidenotes, toText, readingTime, words, copy, printWindow,
        scrollToAnchor, anchorHeadings, slugify
    };
})();

window.WEB = WEB;
