// ===================================================================
// games-finder.js — start > games, when there are too many games
//
// The games flyout grew past a hundred rows and nobody can find anything in
// it. This adds three things to it, and loads the first time it opens
// (fitFlyoutColumns in js/index.js asks for it), so the boot pays nothing:
//
//   a search box: name and the site search's keywords, accents ignored, so
//     "pisti" finds kartz and "amiral" finds battleship. enter opens the
//     first match, the arrows walk the matches, escape clears, then closes.
//   favorites: the star on a row pins it to the top.
//   recent: the last five games opened from anywhere. js/web.js writes the
//     list as they open (played()); this only draws it.
//
// The rows are never copied, only put in a different order, so every game
// is still exactly one button and anything that looks one up by its text
// finds one. Blocked storage means no groups, not an error.
// ===================================================================

(function () {
    'use strict';

    const FAVS = 'mrhakan98-games-favs', RECENT = 'mrhakan98-games-recent';
    const fly = document.querySelector('#start-menu .start-flyout-columns');
    if (!fly || fly.querySelector('.gf-search')) return;
    const sub = fly.closest('.start-sub');

    // lowercase with the accents off: "Pişti", "pisti" and "PISTI" are one word
    const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/ı/g, 'i');

    // the site search already knows what people call these games
    let index = [];
    try { if (typeof siteSearchIndex === 'function') index = siteSearchIndex(); } catch (e) { }
    const aliases = label => {
        const l = fold(label);
        const hit = index.find(e => fold(e.name) === l) || index.find(e => fold(e.name).includes(l) || l.includes(fold(e.name)));
        return hit ? fold(hit.name + ' ' + hit.keywords) : '';
    };

    let memFavs = [];
    const read = k => {
        try {
            const v = JSON.parse(localStorage.getItem(k));
            return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
        } catch (e) { return null; }
    };
    const favs = () => read(FAVS) || memFavs;

    const items = [...fly.querySelectorAll(':scope > .start-item')].map((btn, i) => {
        const slug = (/startMenuAction\('([^']+)'\)/.exec(btn.getAttribute('onclick') || '') || [])[1];
        // the row's own words, without the icon font's ligature in front
        const label = [...btn.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
        const name = fold(label);
        const star = document.createElement('span');
        star.className = 'gf-star';
        star.setAttribute('role', 'button');
        star.tabIndex = 0;
        star.setAttribute('aria-label', 'pin ' + label + ' to favorites');
        star.title = 'pin to favorites';
        btn.appendChild(star);
        return { btn, star, slug, i, name, words: (fold(slug) + ' ' + aliases(label)).split(/[^a-z0-9]+/) };
    }).filter(it => it.slug);
    const bySlug = {};
    items.forEach(it => { bySlug[it.slug] = it; });

    const box = document.createElement('div');
    box.className = 'gf-search';
    box.innerHTML = '<input class="bevel-in" type="text" placeholder="find a game..." aria-label="find a game" autocomplete="off" spellcheck="false">';
    const input = box.firstChild;
    fly.prepend(box);

    const label = text => {
        const d = document.createElement('div');
        d.className = 'gf-label';
        d.textContent = text;
        return d;
    };

    function matches(q) {
        const words = fold(q).split(/\s+/).filter(Boolean);
        const rank = it => it.name.startsWith(words[0]) ? 0 : it.name.includes(words[0]) ? 1 : 2;
        // anywhere in the name, but only the start of a keyword: "troll" is not in "controller"
        return items.filter(it => words.every(w => it.name.includes(w) || it.words.some(x => x.startsWith(w))))
            .sort((a, b) => rank(a) - rank(b) || a.i - b.i);
    }

    function render() {
        fly.querySelectorAll('.gf-label').forEach(l => l.remove());
        const q = input.value.trim();
        const pinned = favs().filter(s => bySlug[s]);
        items.forEach(it => {
            const on = pinned.includes(it.slug);
            it.star.textContent = on ? '★' : '☆';
            it.star.setAttribute('aria-pressed', String(on));
        });
        const order = [];
        if (q) {
            const hits = matches(q);
            items.forEach(it => it.btn.classList.toggle('gf-hide', !hits.includes(it)));
            if (!hits.length) order.push(label('no games match'));
            hits.forEach(it => order.push(it.btn));
        } else {
            items.forEach(it => it.btn.classList.remove('gf-hide'));
            const recent = (read(RECENT) || []).filter(s => bySlug[s] && !pinned.includes(s)).slice(0, 5);
            const used = new Set(pinned.concat(recent));
            if (pinned.length) order.push(label('favorites'), ...pinned.map(s => bySlug[s].btn));
            if (recent.length) order.push(label('recent'), ...recent.map(s => bySlug[s].btn));
            if (used.size) order.push(label('all games'));
            items.forEach(it => { if (!used.has(it.slug)) order.push(it.btn); });
        }
        fly.append(...order);
        if (typeof fitFlyoutColumns === 'function') fitFlyoutColumns(sub);
    }

    function toggle(it) {
        const list = favs().filter(s => s !== it.slug);
        if (it.star.getAttribute('aria-pressed') !== 'true') list.push(it.slug);
        memFavs = list;
        try { localStorage.setItem(FAVS, JSON.stringify(list)); } catch (e) { }
        if (typeof playSound === 'function') playSound('click');
        render();
        it.star.focus();
    }

    const visible = () => items.filter(it => !it.btn.classList.contains('gf-hide'))
        .map(it => it.btn).sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);

    // a star is not its row: the click stops here, before the row opens the game
    fly.addEventListener('click', e => {
        const star = e.target.closest('.gf-star');
        if (!star) return;
        e.preventDefault();
        e.stopPropagation();
        toggle(items.find(it => it.star === star));
    }, true);

    // a game opened from here: the next visit starts from a clean list
    fly.addEventListener('click', e => {
        if (!e.target.closest('.start-item')) return;
        input.value = '';
        setTimeout(render, 0);
    });

    input.addEventListener('focus', () => sub.classList.add('open'));
    input.addEventListener('input', render);

    fly.addEventListener('keydown', e => {
        const k = e.key;
        if (e.target === input) {
            // the desktop's own shortcuts and secret words are not listening here
            e.stopPropagation();
            if (k === 'Enter') {
                e.preventDefault();
                const first = visible()[0];
                if (input.value.trim() && first) first.click();
            } else if (k === 'ArrowDown') {
                e.preventDefault();
                const first = visible()[0];
                if (first) first.focus();
            } else if (k === 'Escape') {
                e.preventDefault();
                if (input.value) { input.value = ''; render(); }
                else { input.blur(); closeStartMenu(); }
            }
            return;
        }
        const star = e.target.closest('.gf-star');
        const row = e.target.closest('.start-item');
        if (!row) return;
        const list = visible(), at = list.indexOf(row);
        if (star && (k === 'Enter' || k === ' ')) { e.preventDefault(); e.stopPropagation(); toggle(items.find(it => it.star === star)); }
        else if (k === 'ArrowDown' || k === 'ArrowUp') {
            e.preventDefault(); e.stopPropagation();
            const next = list[at + (k === 'ArrowDown' ? 1 : -1)];
            (next || (k === 'ArrowUp' ? input : row)).focus();
        } else if (k === 'ArrowRight' && !star) { e.preventDefault(); e.stopPropagation(); row.querySelector('.gf-star').focus(); }
        else if (k === 'ArrowLeft' && star) { e.preventDefault(); e.stopPropagation(); row.focus(); }
        else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeStartMenu(); }
        else if (k.length === 1 && k !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // typing on a row types into the search
            e.stopPropagation();
            input.focus();
        }
    });

    // the recent list changes behind its back, whenever a game opens elsewhere
    const refresh = () => { if (!input.value) render(); };
    sub.addEventListener('mouseenter', refresh);
    const btn = sub.querySelector('.has-sub');
    if (btn) btn.addEventListener('click', refresh);

    render();
    window.GAMES_FINDER = { render };
})();
