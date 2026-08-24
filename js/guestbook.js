// ===================================================================
// guestbook.js — the guestbook is a gist, and signing it is a comment
//
// The old trick from the personal-readme crowd: make a public gist,
// and its comment thread *is* the guestbook. Nothing here needs a
// fork, a branch, a pull request, an issue, or a robot with write
// access to this repo — a visitor writes a comment on a gist, the site
// reads the comments off the public gist api and puts them on the
// wall.
//
//   https://gist.github.com/traumverloren/a7fa4c89c27fc3adedf1ff96b0514472
//
// This file is the pure half: composing the comment a visitor pastes,
// reading one back out, and deciding which gist a board points at. No
// dom and no network in here on purpose, so the test suite can load it
// on its own — .github/scripts/check-guestbook.mjs. The fetching and
// the rendering live in index.js.
// ===================================================================

(function () {
    'use strict';

    // per board caps. the guestbook has room for a paragraph; the
    // shoutbox is a one-liner and carries no website
    const LIMITS = {
        guestbook: { name: 30, website: 100, message: 500 },
        shouts: { name: 20, website: 0, message: 140 }
    };
    const limitsFor = kind => LIMITS[kind] || LIMITS.guestbook;

    // control characters, zero-width tricks and line separators come
    // out; everything else somebody wrote is left exactly as written.
    // markup is deliberately *not* stripped here — it is escaped where
    // it is rendered, which keeps "i <3 this" intact and still cannot
    // run anything
    const strip = s => String(s === null || s === undefined ? '' : s)
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, '');
    // a single line: no newlines, no runs of whitespace, capped
    const line = (s, max) => strip(s).replace(/\s+/g, ' ').trim().slice(0, max || 80);
    // a block: newlines survive, but not five of them in a row
    const text = (s, max) => strip(s)
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, max || 500);

    // links are http/https or they are nothing. a bare domain is taken
    // as https, which is what people type
    function cleanUrl(raw, max) {
        const cap = max || 100;
        const v = line(raw, cap * 2);
        if (!v) return '';
        const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v;
        try {
            const u = new URL(withScheme);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
            return u.href.length > cap ? '' : u.href;
        } catch (e) {
            return '';
        }
    }

    // ---------- the comment ----------
    // what a visitor pastes into the gist's comment box: a couple of
    // header lines, a blank line, then whatever they wrote. plain
    // enough to read on the gist page and to type by hand if the
    // clipboard does not cooperate.
    function composeSignature(kind, entry) {
        const l = limitsFor(kind);
        const e = entry || {};
        const head = ['name: ' + line(e.name, l.name)];
        const site = l.website ? cleanUrl(e.website, l.website) : '';
        if (site) head.push('site: ' + site);
        return head.join('\n') + '\n\n' + text(e.message, l.message) + '\n';
    }

    const HEADER = /^(name|from|site|website|url)\s*:\s*(.*)$/i;

    // the reverse. a comment with no header at all is still a signing —
    // the whole body is the message, and the name is then whoever
    // github says wrote it
    function parseSignature(kind, body) {
        const l = limitsFor(kind);
        const lines = strip(body).split('\n');
        let name = '', site = '', i = 0;
        for (; i < lines.length; i++) {
            const m = lines[i].match(HEADER);
            if (!m) break;
            const key = m[1].toLowerCase();
            if ((key === 'name' || key === 'from')) {
                if (!name) name = line(m[2], l.name);
            } else if (!site && l.website) {
                site = cleanUrl(m[2], l.website);
            }
        }
        const message = text(lines.slice(i).join('\n'), l.message);
        if (!message) return null;
        const out = { name: name, message: message };
        if (site) out.website = site;
        return out;
    }

    // one gist comment -> one entry the site can render. the display
    // name is whatever the header says, but the github login always
    // rides along with it, so a borrowed name cannot pass for somebody
    // else
    function entryFromComment(kind, c) {
        if (!c || typeof c.body !== 'string') return null;
        const sig = parseSignature(kind, c.body);
        if (!sig) return null;
        const user = c.user || {};
        // github logins are letters, digits and hyphens; anything else in
        // there did not come from github and is not going on the wall
        const login = String(user.login || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 39);
        const entry = {
            name: sig.name || login || 'anonymous',
            message: sig.message,
            date: String(c.created_at || '').slice(0, 10),
            timestamp: String(c.created_at || '')
        };
        if (sig.website) entry.website = sig.website;
        if (login) entry.by = login;
        const avatar = cleanUrl(user.avatar_url, 300);
        if (avatar) entry.avatar = avatar;
        const url = cleanUrl(c.html_url, 300);
        if (url) entry.url = url;
        entry.id = 'gist-' + (c.id !== undefined && c.id !== null ? c.id : entry.timestamp + '-' + entry.name);
        return entry;
    }

    // ---------- which gist ----------
    // data/site.json carries { boards: { owner, guestbook, shouts } },
    // each board the id of a public gist. an id that is not a hex blob
    // is treated as missing rather than pasted into a url
    function boardConfig(site) {
        const b = (site && site.boards) || {};
        const id = v => (/^[0-9a-f]{5,64}$/i.test(String(v || '')) ? String(v) : '');
        return {
            owner: String(b.owner || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 39),
            guestbook: id(b.guestbook),
            shouts: id(b.shouts)
        };
    }
    // giscus: the same "no backend" idea, one click instead of five steps.
    // A visitor comments on a GitHub Discussion in the repo rather than
    // copying an entry, opening a gist and pasting it in. It only counts as
    // configured once both ids are there — giscus cannot mount without
    // them, and a half-filled config should fall back to the gist board
    // rather than render an empty box.
    // Each board gets its own discussion category, so the guestbook and the
    // shoutbox can be switched over one at a time. The old shape — a single
    // category at the top level — still reads as the guestbook's, so a
    // config written before this keeps working.
    function giscusConfig(site, kind) {
        const g = (site && site.giscus) || {};
        const board = kind || 'guestbook';
        const per = g[board] || (board === 'guestbook' ? g : {});
        // both boards can live in one category — they are told apart by the
        // discussion title, not the category — so a category set at the top
        // level is inherited by any board that does not name its own
        const pick = (k) => (per[k] !== undefined && per[k] !== '' ? per[k] : g[k]);
        const repo = String(g.repo || '');
        const id = v => (/^[A-Za-z0-9_=-]{4,120}$/.test(String(v || '')) ? String(v) : '');
        const cfg = {
            board: board,
            // owner/name, and nothing that is not one
            repo: /^[A-Za-z0-9._-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo) ? repo : '',
            // giscus node ids are opaque; allow what GitHub actually issues
            repoId: id(g.repoId),
            category: String(pick('category') || '').replace(/[\u0000-\u001f]/g, '').slice(0, 60),
            categoryId: id(pick('categoryId')),
            // the discussion each board maps onto, so two boards in one repo
            // do not end up sharing a thread. giscus finds it by the
            // discussion's title, so if you opened one by hand and called it
            // something else, say so here rather than renaming it.
            term: String(per.term || (board === 'shouts' ? 'shoutbox' : 'guestbook'))
                .replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80)
        };
        cfg.ready = !!(cfg.repo && cfg.repoId && cfg.categoryId);
        return cfg;
    }

    const gistPage = (cfg, kind) => (cfg && cfg[kind])
        ? 'https://gist.github.com/' + (cfg.owner ? cfg.owner + '/' : '') + cfg[kind]
        : '';
    const gistCommentsUrl = (cfg, kind) => (cfg && cfg[kind])
        ? 'https://api.github.com/gists/' + cfg[kind] + '/comments?per_page=100'
        : '';

    // gist comments plus the json files that were signed before the
    // guestbook moved onto a gist. newest first, and the same entry
    // arriving twice only lands once
    function mergeEntries(lists, limit) {
        const out = [], seen = {};
        (lists || []).forEach(list => (list || []).forEach(e => {
            if (!e || !e.name || !e.message) return;
            const key = e.id || ((e.timestamp || e.date || '') + '|' + e.name + '|' + e.message);
            if (seen[key]) return;
            seen[key] = true;
            out.push(e);
        }));
        const when = e => Date.parse(e.timestamp || e.date || '') || 0;
        out.sort((a, b) => when(b) - when(a));
        return out.slice(0, limit || 60);
    }

    const API = {
        LIMITS: LIMITS, limitsFor: limitsFor,
        strip: strip, line: line, text: text, cleanUrl: cleanUrl,
        composeSignature: composeSignature, parseSignature: parseSignature,
        entryFromComment: entryFromComment,
        boardConfig: boardConfig, giscusConfig: giscusConfig,
        gistPage: gistPage, gistCommentsUrl: gistCommentsUrl,
        mergeEntries: mergeEntries
    };
    if (typeof window !== 'undefined') window.GUESTBOOK = API;
})();
