// ===================================================================
// trophies.js — the trophy room
//
// Every game on this desktop keeps its own score in its own corner of
// localStorage, and the achievements live in a fourth place. This is the
// room where all of it is on one wall: what you have, what is still
// locked (with a hint), each game's records and how long you have spent
// in it, and a picture of the lot to send somebody.
//
// It reads and never rewrites a game's save. The only things it writes
// are achievements, through unlockAchievement() like everything else.
//
// Adding an achievement is one line in ACHIEVEMENTS (js/fun.js) and a
// unlockAchievement call where it happens. The shelf it lands on comes from its
// prefix below, so a new dungeonz_something needs nothing here.
//
// Loaded by js/lazy.js the first time somebody opens the room.
// ===================================================================

(function () {
    'use strict';

    const PLAYTIME_KEY = 'mrhakan98-playtime';
    const SITE = 'https://mrhakan.github.io/';

    // ---------- reading, carefully ----------
    // A save from an older version, a half-written one, or a paste of
    // something else entirely: all of them read as "nothing here".
    const raw = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const json = k => { try { return JSON.parse(raw(k) || 'null'); } catch (e) { return null; } };
    const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
    const count = v => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.floor(v) : 0);
    const sum = o => Object.values(obj(o) || {}).reduce((n, v) => n + count(v), 0);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
    const clock = sec => Math.floor(sec / 60) + ':' + ('0' + Math.floor(sec % 60)).slice(-2);

    function duration(sec) {
        sec = Math.round(sec || 0);
        if (sec < 60) return sec ? sec + 's' : '0m';
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
        return h ? h + 'h ' + m + 'm' : m + 'm';
    }
    function ago(t) {
        if (!(t > 1e12)) return '';
        const d = Math.floor((Date.now() - t) / 864e5);
        return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? d + ' days ago' : new Date(t).toLocaleDateString();
    }

    const defs = () => (typeof ACHIEVEMENTS === 'object' && ACHIEVEMENTS) || {};
    const unlocked = () => (typeof getUnlocked === 'function' ? getUnlocked() : obj(json('achievements')) || {});
    function playtime() {
        const t = obj(json(PLAYTIME_KEY)) || {};
        const out = {};
        for (const k in t) if (count(t[k])) out[k] = count(t[k]);
        return out;
    }

    // ---------- the shelves ----------
    // has: which achievements are this game's, by id. windows: which window
    // titles are this game's, for the time played. records: what the game
    // itself saved, as [label, value] pairs, nothing if it saved nothing.
    const SHELVES = [
        {
            id: 'wizardz', name: 'wizardz 98', icon: '🧙', open: 'wizardz',
            has: /^wizardz/, windows: /^wizardz|^customise wizard/,
            records() {
                const av = obj(json('mrhakan98-wizardz-avatar'));
                return [['wizard', av && typeof av.name === 'string' ? av.name.slice(0, 20) : '']];
            }
        },
        {
            id: 'dungeonz', name: 'dungeonz 98', icon: '🕯️', open: 'dungeonz',
            has: /^dungeonz/, windows: /^dungeonz/,
            records() {
                const m = obj(json('mrhakan98-dungeonz-meta'));
                if (!m) return [];
                const times = Object.values(obj(m.best) || {}).filter(v => count(v));
                return [['runs', count(m.runs)], ['dungeons cleared', sum(m.wins)],
                    ['fastest clear', times.length ? clock(Math.min(...times)) : ''], ['wipes', count(m.wipes)]];
            }
        },
        {
            id: 'trailz', name: 'trailz 98', icon: '🏍️', open: 'trailz',
            has: /^trailz/, windows: /^trailz/,
            records() {
                const m = obj(json('mrhakan98-trailz-meta'));
                if (!m) return [];
                return [['matches', count(m.matches)], ['matches won', count(m.wins)], ['rounds won', count(m.roundWins)], ['longest ride', count(m.best) ? count(m.best) + 's' : '']];
            }
        },
        {
            id: 'blastz', name: 'blastz 98', icon: '💥', open: 'blastz',
            has: /^blastz/, windows: /^blastz/,
            records() {
                const m = obj(json('mrhakan98-blastz-meta'));
                if (!m) return [];
                return [['matches', count(m.matches)], ['matches won', count(m.wins)], ['knockouts', count(m.kos)], ['falls', count(m.falls)]];
            }
        },
        {
            id: 'echoes', name: 'echoes of the tide', icon: '🌊', open: 'echoes',
            has: /^echoes/, windows: /^echoes/,
            records() {
                const d = obj(json('ECHOES_OF_THE_TIDE_SAVE'));
                const p = d && obj(d.player);
                if (!p) return [];
                const s = obj(p.stats) || {};
                return [['level', count(p.level)], ['kills', count(s.kills)], ['lords ended', count(s.lords_ended)], ['deaths', count(s.deaths)]];
            }
        },
        {
            id: 'jokerz', name: 'jokerz 98', icon: '🃏', open: 'jokerz',
            has: /^jokerz/, windows: /^jokerz/,
            records() {
                const r = obj(json('jokerz98-run'));
                if (!r) return [];
                return [['run in progress', count(r.ante) ? 'ante ' + count(r.ante) : 'yes'], ['money', typeof r.money === 'number' ? '$' + r.money : '']];
            }
        },
        {
            id: 'trollproblem', name: 'sir, we have a troll problem', icon: '🛡️', open: 'trollproblem',
            has: /^troll_/, windows: /troll problem/,
            records() {
                const m = obj(json('trollproblem-meta-v2'));
                if (!m) return [];
                const waves = Object.values(obj(m.bestWave) || {}).map(count);
                return [['best wave', waves.length ? Math.max(...waves) : 0], ['runs', count(m.runs)], ['trolls stopped', count(m.totalKills)]];
            }
        },
        {
            id: 'becomeuser', name: 'become user', icon: '🖥️', open: 'becomeuser',
            has: /^become_user/, windows: /^become user/,
            records() {
                const m = obj(json('becomeuser-meta-v1'));
                if (!m) return [];
                return [['endings found', Array.isArray(m.endings) ? m.endings.length : 0], ['runs', count(m.runs)]];
            }
        },
        {
            id: 'ageoftroll', name: 'age of troll', icon: '🏰', open: 'ageoftroll',
            has: /^aot-/, windows: /age of troll/,
            records() {
                const m = obj(json('mrhakan98-ageoftroll-meta'));
                if (!m) return [];
                return [['won', count(m.wins)], ['lost', count(m.losses)], ['drawn', count(m.draws)]];
            }
        },
        {
            id: 'arcade', name: 'the arcade', icon: '🕹️',
            has: /^(snake10|pong|minesweeper|solitaire|ttt|rps|hangman|simon|g2048|tetris|breakout|whack)$/,
            windows: /^(snake|pong|minesweeper|solitaire|tic tac toe|rock paper scissors|hangman|simon|2048|tetris|breakout|whack a troll)$/,
            records() {
                const n = k => count(parseFloat(raw(k)));
                return [['snake', n('snake-best')], ['simon', n('arcade-simon')], ['2048', n('arcade-2048')],
                    ['tetris lines', n('arcade-tetris')], ['breakout', n('arcade-breakout')], ['whack', n('arcade-whack')]];
            }
        },
        {
            id: 'playground', name: 'the playground', icon: '🧩',
            has: /^playground/, windows: /^$/,
            records() {
                const games = playgroundRecords();
                const best = games.slice(0, 4).map(g => [g.name, g.line]);
                return games.length ? [['games on record', games.length]].concat(best) : [];
            }
        },
        {
            id: 'toys', name: 'toys and the old web', icon: '🧸',
            has: /^(adopted|petted|neko|blinkie|stamps|awards|directory|scandisk|setup|ram|virus|hunter2|soundboard|moon|biorhythm|love|cowsay|nat20|surprise|rated|scroller|trail|fortune|voter|quiz)$/,
            windows: /^$/,
            records() { return []; }
        },
        // everything that is not somebody else's
        { id: 'desktop', name: 'the desktop', icon: '💾', has: /^/, windows: /^$/, records() { return []; } }
    ];

    function shelfOf(id) {
        for (const s of SHELVES) if (s.has.test(id)) return s;
        return SHELVES[SHELVES.length - 1];
    }
    function recordsOf(shelf) {
        let r = [];
        try { r = shelf.records() || []; } catch (e) { r = []; }
        return r.filter(p => p && p[1] !== '' && p[1] !== 0 && p[1] != null);
    }
    function timeOf(shelf, pt) {
        let n = 0;
        for (const t in pt) if (shelf.windows.test(t)) n += pt[t];
        return n;
    }

    // ---------- the playground ----------
    // Forty-odd small games, each a page of its own that keeps its bests
    // under its own name. Which key is whose comes from its folder name.
    let catalog = null, catalogAsked = null;
    function loadCatalog() {
        if (catalogAsked) return catalogAsked;
        catalogAsked = fetch('data/playground.json').then(r => r.ok ? r.json() : []).catch(() => []).then(list => {
            catalog = (Array.isArray(list) ? list : []).filter(i => i && i.type === 'game' && /^\/games\/[\w-]+\/$/.test(i.url || ''))
                .map(i => ({ slug: i.url.split('/')[2], name: String(i.name || '').replace(/\s*98$/, '').toLowerCase(), url: i.url, icon: i.icon || '🎮' }));
            return catalog;
        });
        return catalogAsked;
    }
    const squash = s => String(s).toLowerCase().replace(/^(mrhakan|playground)\./, '').replace(/[^a-z0-9]/g, '');
    // the few that saved under a shorter name than their folder
    const ALIAS = { 'dots-and-boxes': 'dotsboxes' };

    function storageKeys() {
        const out = [];
        try { for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); } catch (e) { }
        return out.filter(k => typeof k === 'string');
    }

    function describe(keys) {
        if (keys.length > 1) {
            const dated = keys.filter(k => /\d{4}-?\d{2}-?\d{2}/.test(k)).length;
            return dated ? plural(dated, 'day') + ' on record' : plural(keys.length, 'record');
        }
        const v = raw(keys[0]);
        let parsed = null;
        try { parsed = JSON.parse(v); } catch (e) { }
        if (parsed && typeof parsed === 'object') {
            const n = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
            return n ? plural(n, 'record') : '';
        }
        const s = String(v == null ? '' : v).trim();
        if (!s || s === 'Infinity' || s === 'null' || s === '0') return '';
        return 'best ' + s.slice(0, 14);
    }

    // [{ slug, name, icon, url, keys, line }], the most kept first
    function playgroundRecords(list) {
        const games = list || catalog || [];
        if (!games.length) return [];
        const bySlug = games.map(g => ({ g, key: ALIAS[g.slug] || squash(g.slug) })).sort((a, b) => b.key.length - a.key.length);
        const found = {};
        for (const k of storageKeys()) {
            const s = squash(k);
            const hit = bySlug.find(x => s.startsWith(x.key));
            if (hit) (found[hit.g.slug] = found[hit.g.slug] || []).push(k);
        }
        return games.filter(g => found[g.slug]).map(g => {
            const keys = found[g.slug].sort();
            return { slug: g.slug, name: g.name || g.slug.replace(/-/g, ' '), icon: g.icon, url: g.url, keys, line: describe(keys) };
        }).filter(g => g.line).sort((a, b) => b.keys.length - a.keys.length || a.name.localeCompare(b.name));
    }

    // ---------- what the room says ----------
    function summary() {
        const all = defs(), un = unlocked(), pt = playtime();
        const ids = Object.keys(all);
        const got = ids.filter(id => un[id]);
        const latest = got.slice().sort((a, b) => (+un[b] || 0) - (+un[a] || 0));
        const shelves = SHELVES.map(s => {
            const mine = ids.filter(id => shelfOf(id) === s);
            return { shelf: s, ids: mine, got: mine.filter(id => un[id]).length, records: recordsOf(s), time: timeOf(s, pt) };
        });
        // games, not the desktop's own furniture; the playground counts each of its own
        const pg = shelves.find(x => x.shelf.id === 'playground');
        const pgGames = pg && pg.records.length ? +pg.records[0][1] || 0 : 0;
        const played = shelves.filter(x => !/^(desktop|toys|playground)$/.test(x.shelf.id) && (x.records.length || x.time || x.got)).length + pgGames;
        return {
            total: ids.length, got: got.length,
            percent: ids.length ? Math.round(got.length / ids.length * 100) : 0,
            time: Object.values(pt).reduce((a, b) => a + b, 0),
            latest, shelves, played, unlocked: un
        };
    }

    // achievements a game earned by keeping records, rather than by calling
    // unlockAchievement itself. Pages in the playground do not load the
    // desktop's scripts, so they are counted from what they left behind.
    function sync() {
        return loadCatalog().then(list => {
            if (typeof unlockAchievement !== 'function') return;
            const n = playgroundRecords(list).length;
            if (n >= 1) unlockAchievement('playground');
            if (n >= 5) unlockAchievement('playground_5');
            if (n >= 15) unlockAchievement('playground_15');
        }).catch(() => { });
    }

    function shareText(s) {
        s = s || summary();
        const lines = ['mrhakan 98 trophy room: ' + s.got + ' of ' + s.total + ' (' + s.percent + '%)'];
        const names = s.latest.slice(0, 3).map(id => defs()[id] && defs()[id].name).filter(Boolean);
        if (names.length) lines.push('latest: ' + names.join(', '));
        if (s.time) lines.push(duration(s.time) + ' on the desktop');
        lines.push(SITE + '?app=trophies');
        return lines.join('\n');
    }

    // ---------- the picture ----------
    // A 1200x630 card in the desktop's own colours, the size every chat
    // app previews without cropping.
    function drawCard(s) {
        s = s || summary();
        const W = 1200, H = 630;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d');
        if (!x) return c;
        const UI = '"Tahoma", "MS Sans Serif", "Segoe UI", sans-serif';
        const bevel = (l, t, w, h, inset) => {
            x.fillStyle = inset ? '#808080' : '#ffffff'; x.fillRect(l, t, w, 3); x.fillRect(l, t, 3, h);
            x.fillStyle = inset ? '#ffffff' : '#404040'; x.fillRect(l, t + h - 3, w, 3); x.fillRect(l + w - 3, t, 3, h);
        };
        // the space behind the window
        x.fillStyle = '#0d0517'; x.fillRect(0, 0, W, H);
        for (let i = 0; i < 140; i++) {
            x.fillStyle = i % 7 ? 'rgba(255,255,255,0.5)' : '#0df259';
            x.fillRect((i * 337) % W, (i * 211) % H, i % 3 ? 2 : 3, i % 3 ? 2 : 3);
        }
        // the window
        const L = 60, T = 44, WW = W - 120, WH = H - 88;
        x.fillStyle = '#c0c0c0'; x.fillRect(L, T, WW, WH); bevel(L, T, WW, WH);
        const g = x.createLinearGradient(L, 0, L + WW, 0); g.addColorStop(0, '#000080'); g.addColorStop(1, '#1084d0');
        x.fillStyle = g; x.fillRect(L + 6, T + 6, WW - 12, 44);
        x.fillStyle = '#fff'; x.font = 'bold 26px ' + UI; x.textBaseline = 'middle';
        x.fillText('🏆 trophy room — mrhakan 98', L + 18, T + 29);
        // the big number
        x.fillStyle = '#000'; x.textBaseline = 'alphabetic';
        x.font = 'bold 76px ' + UI; x.fillText(s.got + ' / ' + s.total, L + 30, T + 150);
        x.font = '26px ' + UI; x.fillStyle = '#222';
        x.fillText(s.percent + '% unlocked' + (s.time ? ' · ' + duration(s.time) + ' played' : '') + (s.played ? ' · ' + plural(s.played, 'game') + ' on record' : ''), L + 32, T + 192);
        // a Win98 progress bar, in blocks
        const PL = L + 30, PT = T + 214, PW = WW - 60, PH = 36;
        x.fillStyle = '#fff'; x.fillRect(PL, PT, PW, PH); bevel(PL, PT, PW, PH, true);
        const blocks = Math.floor((PW - 12) / 22), lit = Math.round(blocks * s.percent / 100);
        x.fillStyle = '#000080';
        for (let i = 0; i < lit; i++) x.fillRect(PL + 6 + i * 22, PT + 6, 18, PH - 12);
        // the latest trophies, on a shelf
        const SL = L + 30, ST = T + 276, SW = WW - 60, SH = 150;
        x.fillStyle = '#1a0b2e'; x.fillRect(SL, ST, SW, SH); bevel(SL, ST, SW, SH, true);
        x.fillStyle = '#8a5a1e'; x.fillRect(SL + 3, ST + SH - 22, SW - 6, 19);
        x.fillStyle = '#c08a3e'; x.fillRect(SL + 3, ST + SH - 22, SW - 6, 4);
        const latest = s.latest.slice(0, 10);
        x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '64px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
        latest.forEach((id, i) => {
            const a = defs()[id];
            if (a) x.fillText(a.icon, SL + 60 + i * ((SW - 60) / 10), ST + 60);
        });
        if (!latest.length) {
            x.font = 'italic 26px ' + UI; x.fillStyle = '#9a8ec4';
            x.fillText('an empty shelf, waiting for its first trophy', SL + SW / 2, ST + 60);
        }
        x.textAlign = 'left'; x.textBaseline = 'alphabetic';
        // a few records, from the games with the most to say
        const recs = s.shelves.filter(y => y.records.length && !/^(desktop|toys)$/.test(y.shelf.id))
            .map(y => y.shelf.name.replace(/^the /, '') + ': ' + y.records.slice(0, 2).map(r => r[0] + ' ' + r[1]).join(', '));
        x.fillStyle = '#222'; x.font = '22px ' + UI;
        recs.slice(0, 2).forEach((line, i) => x.fillText(line.length > 78 ? line.slice(0, 77) + '…' : line, L + 32, T + 462 + i * 28));
        // the address
        x.fillStyle = '#000'; x.font = 'bold 24px "Courier New", monospace';
        x.fillText('mrhakan.github.io/?app=trophies', L + 30, T + WH - 16);
        return c;
    }

    // ---------- the window ----------
    let cssAsked = false;
    function loadCss() {
        if (cssAsked || document.getElementById('tr-css')) return;
        cssAsked = true;
        const l = document.createElement('link');
        l.id = 'tr-css'; l.rel = 'stylesheet'; l.href = 'css/trophies.css';
        document.head.appendChild(l);
    }

    function openTrophies(tab) {
        loadCss();
        // one room: asking again brings the open one forward
        const existing = [...document.querySelectorAll('.app-window .tr-room')].find(r => r.closest('.app-window').id && r._show);
        if (existing) { existing._show(typeof tab === 'string' ? tab : null); return; }
        const { body, win } = createAppWindow('trophy room', { icon: 'emoji_events', width: 620 });
        body.classList.add('tr-body');
        const room = document.createElement('div');
        room.className = 'tr-room';
        body.appendChild(room);

        let page = ['shelves', 'all', 'records'].indexOf(tab) >= 0 ? tab : 'shelves';
        let filter = 'all';

        function plaque(id, un) {
            const a = defs()[id];
            const got = !!un[id];
            const tip = got ? a.name + ' — ' + a.desc : 'locked — ' + (a.hint || a.desc);
            return `<button type="button" class="tr-plaque${got ? ' got' : ''}" data-id="${esc(id)}" title="${esc(tip)}" aria-label="${esc(tip)}">
                <span class="tr-plaque-icon">${got ? a.icon : (a.hint ? '?' : a.icon)}</span></button>`;
        }

        function shelvesPage(s) {
            return s.shelves.filter(x => x.ids.length || x.records.length).map(x => {
                const recs = x.records.map(r => `<span><i>${esc(r[0])}</i> ${esc(r[1])}</span>`);
                if (x.time) recs.push(`<span><i>played</i> ${duration(x.time)}</span>`);
                return `<section class="tr-shelf" data-shelf="${x.shelf.id}">
                    <header class="tr-shelf-head"><span class="tr-shelf-name">${x.shelf.icon} ${esc(x.shelf.name)}</span>
                        <span class="tr-shelf-count">${x.got} / ${x.ids.length}</span>
                        ${x.shelf.open ? `<button type="button" class="bevel-out tr-btn small" data-open="${x.shelf.open}">open</button>` : ''}</header>
                    <div class="tr-case">${x.ids.map(id => plaque(id, s.unlocked)).join('') || '<span class="tr-none">no trophies here yet, only records</span>'}</div>
                    <div class="tr-recs">${recs.join('') || '<span class="tr-none">nothing saved yet</span>'}</div>
                </section>`;
            }).join('');
        }

        function allPage(s) {
            const all = defs();
            const ids = Object.keys(all).filter(id => filter === 'all' || (filter === 'got') === !!s.unlocked[id]);
            const order = filter === 'got' ? ids.sort((a, b) => (+s.unlocked[b] || 0) - (+s.unlocked[a] || 0)) : ids;
            const radio = (v, label) => `<label><input type="radio" name="tr-filter" value="${v}"${filter === v ? ' checked' : ''}> ${label}</label>`;
            return `<div class="tr-filter" role="radiogroup" aria-label="show">${radio('all', 'all')}${radio('got', 'earned')}${radio('locked', 'locked')}</div>
                <div class="tr-list">${order.map(id => {
                const a = all[id], got = !!s.unlocked[id];
                return `<div class="tr-row${got ? ' got' : ''}" data-id="${esc(id)}">
                        <span class="tr-row-icon">${got || !a.hint ? a.icon : '?'}</span>
                        <span class="tr-row-text"><b>${esc(a.name)}</b><small>${got ? esc(a.desc) : 'hint: ' + esc(a.hint || a.desc)}</small></span>
                        <span class="tr-row-when">${got ? esc(ago(+s.unlocked[id]) || 'earned') : 'locked'}</span>
                    </div>`;
            }).join('') || '<div class="tr-none pad">nothing here. yet.</div>'}</div>`;
        }

        function recordsPage(s) {
            const rows = s.shelves.filter(x => x.records.length || x.time).map(x => ({
                name: x.shelf.icon + ' ' + x.shelf.name,
                recs: x.shelf.id === 'playground' ? x.records.slice(0, 1) : x.records,
                time: x.time, open: x.shelf.open
            }));
            playgroundRecords().forEach(g => rows.push({ name: g.icon + ' ' + g.name, recs: [['', g.line]], url: g.url }));
            if (!rows.length) return '<div class="tr-none pad">no records yet. go and play something, then come back bradar.</div>';
            return `<table class="tr-table"><thead><tr><th>game</th><th>records</th><th>played</th></tr></thead><tbody>${rows.map(r => `
                <tr><td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</td>
                    <td>${r.recs.map(p => (p[0] ? esc(p[0]) + ' ' : '') + '<b>' + esc(p[1]) + '</b>').join(' · ')}</td>
                    <td>${r.time ? duration(r.time) : '—'}</td></tr>`).join('')}</tbody></table>`;
        }

        function render() {
            const s = summary();
            const tabs = [['shelves', 'shelves'], ['all', 'every achievement'], ['records', 'records']];
            room.innerHTML = `
                <div class="tr-head">
                    <div class="tr-cup" aria-hidden="true">🏆</div>
                    <div class="tr-sum">
                        <div class="tr-path">C:\\My Documents\\trophy room</div>
                        <div class="tr-meter bevel-in" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.percent}" aria-label="achievements unlocked">
                            <div class="tr-fill" style="width:${s.percent}%"></div></div>
                        <div class="tr-line"><b>${s.got} of ${s.total}</b> · ${s.percent}% · ${duration(s.time)} played · ${plural(s.played, 'game')} on record</div>
                    </div>
                    <button type="button" class="bevel-out tr-btn" data-act="share">share...</button>
                </div>
                <div class="tr-tabs" role="tablist">${tabs.map(([id, label]) =>
                    `<button type="button" role="tab" class="tr-tab${page === id ? ' on' : ''}" aria-selected="${page === id}" data-tab="${id}">${label}</button>`).join('')}</div>
                <div class="tr-page bevel-in" role="tabpanel">${page === 'all' ? allPage(s) : page === 'records' ? recordsPage(s) : shelvesPage(s)}</div>
                <div class="tr-status bevel-in" aria-live="polite">${s.got ? 'click a trophy to read its plaque' : 'an empty room. everything you do on this desktop ends up in here, bradar.'}</div>`;
        }

        function say(id) {
            const a = defs()[id];
            const st = room.querySelector('.tr-status');
            if (!a || !st) return;
            const un = unlocked();
            st.textContent = un[id]
                ? a.icon + ' ' + a.name + ' — ' + a.desc + (ago(+un[id]) ? ' (' + ago(+un[id]) + ')' : '')
                : '🔒 ' + a.name + ' — hint: ' + (a.hint || a.desc);
        }

        room.addEventListener('click', e => {
            const t = e.target.closest('[data-tab],[data-id],[data-open],[data-act]');
            if (!t) return;
            if (t.dataset.tab) { page = t.dataset.tab; playSound('click'); render(); }
            else if (t.dataset.open) { playSound('click'); startMenuAction(t.dataset.open); }
            else if (t.dataset.act === 'share') share();
            else if (t.dataset.id) say(t.dataset.id);
        });
        room.addEventListener('focusin', e => { const t = e.target.closest('.tr-plaque'); if (t) say(t.dataset.id); });
        room.addEventListener('change', e => { if (e.target.name === 'tr-filter') { filter = e.target.value; render(); } });

        room._show = t => {
            if (t && ['shelves', 'all', 'records'].indexOf(t) >= 0) page = t;
            render();
            win.style.display = '';
            if (typeof ieHighestZ === 'number') win.style.zIndex = ++ieHighestZ;
        };
        render();
        // a record kept in another tab shows up the next time this is looked at
        const refresh = () => { if (!document.hidden && room.isConnected) render(); };
        document.addEventListener('visibilitychange', refresh);
        win._cleanup = () => document.removeEventListener('visibilitychange', refresh);

        loadCatalog().then(() => sync()).then(() => { if (room.isConnected) render(); });
        unlockAchievement('trophy_room');
    }

    function share() {
        playSound('click');
        const s = summary();
        let canvas;
        try { canvas = drawCard(s); } catch (e) { canvas = null; }
        const text = shareText(s);
        const box = document.createElement('div');
        box.className = 'tr-share';
        if (canvas) {
            const img = document.createElement('img');
            img.alt = 'your trophy room, as a picture';
            img.src = canvas.toDataURL('image/png');
            box.appendChild(img);
        }
        const copy = () => {
            const done = () => showToast('trophy room', 'copied. paste it wherever your friends are.');
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => showToast('trophy room', 'the clipboard said no. the picture still works.'));
            else showToast('trophy room', 'the clipboard said no. the picture still works.');
        };
        const blob = () => new Promise(res => canvas ? canvas.toBlob(res, 'image/png') : res(null));
        const save = () => blob().then(b => {
            if (!b) return copy();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = 'mrhakan98-trophies.png';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        });
        // a phone can hand the picture straight to a chat app
        const native = () => blob().then(b => {
            const file = b && typeof File === 'function' ? new File([b], 'mrhakan98-trophies.png', { type: 'image/png' }) : null;
            const data = file && navigator.canShare && navigator.canShare({ files: [file] }) ? { files: [file], text } : { text, url: SITE + '?app=trophies' };
            return navigator.share(data);
        }).catch(() => { });
        showRetroDialog({
            title: 'share the trophy room',
            lines: ['a picture of your shelf. nothing is uploaded: it is made right here, in this browser.'],
            content: box,
            okLabel: 'save picture',
            onOk: save,
            secondaryLabel: navigator.share ? 'share...' : 'copy as text',
            onSecondary: navigator.share ? native : copy,
            cancelLabel: 'close'
        });
    }

    window.openTrophies = openTrophies;
    window.TROPHIES = {
        SHELVES, ALIAS, shelfOf, summary, sync, shareText, drawCard, duration,
        playgroundRecords, loadCatalog, squash, describe, recordsOf, PLAYTIME_KEY
    };
})();
