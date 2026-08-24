// ===================================================================
// documents.js — My Documents
//
// Every game on this site keeps its progress in localStorage, which is
// per browser, per device, and gone the moment somebody clears their
// site data. Echoes of the Tide had an export button. The other five
// did not, so anyone who switched browsers lost a run of Jokerz, a
// Become User playthrough, a Troll Problem meta, and a wizard.
//
// This is the folder that was missing: one window that knows where each
// game keeps its save, reads a human summary out of it, and lets you
// take the lot with you. The export is a base64 envelope with a version
// and a checksum on it, so an import can tell our blob from a paste of
// something else and refuse the second kind.
//
// The registry is the whole design. A game is a row in DOCS; adding one
// is adding an entry, and the window does not need to know anything
// else about it.
// ===================================================================

(function () {
    'use strict';

    const ENVELOPE = 'mrhakan98-documents';
    const ENVELOPE_VERSION = 1;

    // ---------- reading what is on the disk ----------
    const raw = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const json = k => { try { return JSON.parse(raw(k) || 'null'); } catch (e) { return null; } };

    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

    // when a save was last written, if it says. not every game records it.
    function whenever(stamp) {
        if (!stamp) return '';
        const t = typeof stamp === 'number' ? stamp : Date.parse(stamp);
        if (!isFinite(t)) return '';
        const mins = Math.round((Date.now() - t) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return plural(mins, 'minute') + ' ago';
        const hours = Math.round(mins / 60);
        if (hours < 24) return plural(hours, 'hour') + ' ago';
        return plural(Math.round(hours / 24), 'day') + ' ago';
    }

    // ---------- the registry ----------
    // keys: everything this document owns. the first is the one that
    // decides whether the document exists at all.
    // summary: one line a person can read, out of whatever is stored.
    const DOCS = [
        {
            id: 'echoes',
            name: 'echoes of the tide',
            icon: '🌊',
            keys: ['ECHOES_OF_THE_TIDE_SAVE', 'ECHOES_OF_THE_TIDE_SAVE_BACKUP'],
            open: 'echoes',
            summary() {
                const d = json('ECHOES_OF_THE_TIDE_SAVE');
                if (!d || !d.player) return null;
                const p = d.player;
                const bits = [p.name || 'a diver', 'level ' + (p.level || 1)];
                if (p.realm) bits.push(String(p.realm).replace(/_/g, ' '));
                if (p.act) bits.push('act ' + p.act);
                const stats = p.stats || {};
                if (stats.kills) bits.push(plural(stats.kills, 'kill'));
                if (stats.deaths) bits.push(plural(stats.deaths, 'death'));
                return { line: bits.join(' · '), when: whenever(d.save_timestamp) };
            }
        },
        {
            id: 'jokerz',
            name: 'jokerz 98',
            icon: '🃏',
            keys: ['jokerz98-run'],
            open: 'jokerz',
            summary() {
                const d = json('jokerz98-run');
                if (!d) return null;
                const bits = [];
                if (d.ante) bits.push('ante ' + d.ante);
                if (d.round) bits.push('round ' + d.round);
                if (typeof d.money === 'number') bits.push('$' + d.money);
                if (Array.isArray(d.jokers)) bits.push(plural(d.jokers.length, 'joker'));
                return { line: bits.length ? bits.join(' · ') : 'a run in progress', when: '' };
            }
        },
        {
            id: 'becomeuser',
            name: 'become user',
            icon: '💻',
            keys: ['becomeuser-run-v1', 'becomeuser-meta-v1'],
            open: 'becomeuser',
            summary() {
                const run = json('becomeuser-run-v1'), meta = json('becomeuser-meta-v1');
                if (!run && !meta) return null;
                const bits = [];
                if (run && run.day) bits.push('day ' + run.day);
                if (run && run.stage) bits.push(String(run.stage).replace(/_/g, ' '));
                if (meta && meta.runs) bits.push(plural(meta.runs, 'run'));
                if (meta && meta.best) bits.push('best ' + meta.best);
                return { line: bits.length ? bits.join(' · ') : (run ? 'a run in progress' : 'no run, but a history'), when: '' };
            }
        },
        {
            id: 'trollproblem',
            name: 'the troll problem',
            icon: '🚋',
            keys: ['trollproblem-run-v2', 'trollproblem-meta-v2'],
            open: 'trollproblem',
            summary() {
                const run = json('trollproblem-run-v2'), meta = json('trollproblem-meta-v2');
                if (!run && !meta) return null;
                const bits = [];
                if (run && run.wave) bits.push('wave ' + run.wave);
                if (meta && meta.bestWave) bits.push('best wave ' + meta.bestWave);
                if (meta && meta.runs) bits.push(plural(meta.runs, 'run'));
                return { line: bits.length ? bits.join(' · ') : 'a run in progress', when: '' };
            }
        },
        {
            id: 'wizardz',
            name: 'wizardz 98',
            icon: '🧙',
            keys: ['mrhakan98-wizardz-avatar', 'mrhakan98-wizardz-loadout', 'mrhakan98-wizardz-difficulty'],
            open: 'wizardz',
            summary() {
                const av = json('mrhakan98-wizardz-avatar'), lo = json('mrhakan98-wizardz-loadout');
                const diff = raw('mrhakan98-wizardz-difficulty');
                if (!av && !lo && !diff) return null;
                const bits = [];
                if (av && av.name) bits.push(av.name);
                if (Array.isArray(lo)) bits.push(plural(lo.length, 'spell') + ' picked');
                if (diff) bits.push(diff);
                return { line: bits.length ? bits.join(' · ') : 'a wizard', when: '' };
            }
        },
        {
            id: 'snake',
            name: 'snake',
            icon: '🐍',
            keys: ['snake-best'],
            open: 'snake',
            summary() {
                const best = raw('snake-best');
                if (!best) return null;
                return { line: 'best score ' + best, when: '' };
            }
        },
        {
            id: 'achievements',
            name: 'achievements',
            icon: '🏆',
            keys: ['achievements'],
            open: 'achievements',
            summary() {
                const a = json('achievements');
                if (!a) return null;
                const got = Array.isArray(a) ? a.length : Object.keys(a).length;
                if (!got) return null;
                return { line: plural(got, 'unlocked', 'unlocked'), when: '' };
            }
        },
        {
            id: 'desktop',
            name: 'desktop settings',
            icon: '🖥️',
            keys: [
                'wallpaper', 'screensaver', 'sound-enabled', 'crt-off', 'sparkles-off',
                'stars-off', 'motion-off', 'assistant-off', 'jokerz98-music',
                'mrhakan98-netplay-profile', 'mrhakan98-netplay-mode',
                'mrhakan98-netplay-relay', 'mrhakan98-netplay-relays'
            ],
            summary() {
                const set = this.keys.filter(k => raw(k) !== null);
                if (!set.length) return null;
                const bits = [];
                if (raw('wallpaper')) bits.push('a wallpaper');
                if (raw('screensaver')) bits.push('a screensaver');
                const prof = json('mrhakan98-netplay-profile');
                if (prof && prof.name) bits.push('signed in as ' + prof.name);
                bits.push(plural(set.length, 'setting'));
                return { line: bits.join(' · '), when: '' };
            }
        }
    ];

    // ---------- what is actually on this machine ----------
    function present(doc) {
        return doc.keys.some(k => raw(k) !== null);
    }
    function bytes(doc) {
        return doc.keys.reduce((n, k) => n + ((raw(k) || '').length), 0);
    }
    function readable(n) {
        if (n < 1024) return n + ' b';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' kb';
        return (n / 1048576).toFixed(1) + ' mb';
    }
    function summaryOf(doc) {
        try { return doc.summary() || null; } catch (e) { return { line: 'unreadable', when: '', broken: true }; }
    }

    // ---------- the envelope ----------
    // DJB2, the same corruption check the Echoes save layer uses. Not a
    // security measure — nobody is being kept out of their own files.
    function checksum(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }

    // base64 that survives anything anybody typed into a guestbook
    const encode = s => btoa(unescape(encodeURIComponent(s)));
    const decode = s => decodeURIComponent(escape(atob(s)));

    function pack(ids) {
        const files = {};
        for (const doc of DOCS) {
            if (ids && ids.indexOf(doc.id) < 0) continue;
            for (const k of doc.keys) {
                const v = raw(k);
                if (v !== null) files[k] = v;
            }
        }
        const body = JSON.stringify(files);
        return encode(JSON.stringify({
            format: ENVELOPE,
            version: ENVELOPE_VERSION,
            saved_at: new Date().toISOString(),
            checksum: checksum(body),
            files: files
        }));
    }

    // returns { ok, files, error }. A paste of something else has to come
    // back as a refusal and not as a half-applied restore.
    function unpack(text) {
        let doc;
        try { doc = JSON.parse(decode(String(text || '').trim())); }
        catch (e) { return { ok: false, error: 'that is not a backup code' }; }
        if (!doc || doc.format !== ENVELOPE) return { ok: false, error: 'that code is from somewhere else' };
        if (doc.version > ENVELOPE_VERSION) return { ok: false, error: 'that backup is newer than this site' };
        if (!doc.files || typeof doc.files !== 'object') return { ok: false, error: 'there are no files in it' };
        const body = JSON.stringify(doc.files);
        if (doc.checksum && doc.checksum !== checksum(body)) return { ok: false, error: 'that backup is damaged' };
        // only keys this site owns get written back: a backup is not a
        // licence to put arbitrary things in somebody's localStorage
        const known = {};
        for (const d of DOCS) for (const k of d.keys) known[k] = true;
        const files = {}, strangers = [];
        for (const k in doc.files) {
            if (known[k] && typeof doc.files[k] === 'string') files[k] = doc.files[k];
            else strangers.push(k);
        }
        if (!Object.keys(files).length) return { ok: false, error: 'nothing in that backup belongs to this site' };
        return { ok: true, files: files, skipped: strangers, saved_at: doc.saved_at || '' };
    }

    function restore(files) {
        let n = 0;
        for (const k in files) {
            try { localStorage.setItem(k, files[k]); n++; } catch (e) { /* quota, private mode */ }
        }
        return n;
    }

    function wipe(doc) {
        for (const k of doc.keys) { try { localStorage.removeItem(k); } catch (e) { } }
    }

    // ---------- the window ----------
    function openDocuments() {
        const { body, win } = createAppWindow('my documents', { icon: 'folder', width: 560 });
        body.classList.add('doc-body');

        function render() {
            const rows = DOCS.map(doc => {
                const here = present(doc);
                const s = here ? summaryOf(doc) : null;
                return `
                <div class="doc-row${here ? '' : ' empty'}" data-doc="${doc.id}">
                    <span class="doc-icon">${doc.icon}</span>
                    <span class="doc-name">${doc.name}
                        <i>${here ? ((s && s.line) || 'saved') + ((s && s.when) ? ' — ' + s.when : '') : 'nothing saved'}</i>
                    </span>
                    <span class="doc-size">${here ? readable(bytes(doc)) : '—'}</span>
                    <span class="doc-acts">
                        ${here ? `<button class="bevel-out doc-btn" data-act="export" data-id="${doc.id}">export</button>` : ''}
                        ${here && doc.open ? `<button class="bevel-out doc-btn" data-act="open" data-id="${doc.id}">open</button>` : ''}
                        ${here ? `<button class="bevel-out doc-btn danger" data-act="delete" data-id="${doc.id}">delete</button>` : ''}
                    </span>
                </div>`;
            }).join('');

            const total = DOCS.filter(present).reduce((n, d) => n + bytes(d), 0);
            body.innerHTML = `
                <div class="doc-head">
                    <span>C:\\My Documents</span>
                    <span class="doc-total">${DOCS.filter(present).length} of ${DOCS.length} · ${readable(total)}</span>
                </div>
                <div class="doc-note">everything on this page lives in this browser only. take a backup and it will
                    still be here on the next machine.</div>
                <div class="doc-list bevel-in">${rows}</div>
                <div class="doc-actions">
                    <button class="bevel-out doc-btn wide" data-act="export-all">back everything up</button>
                    <button class="bevel-out doc-btn wide" data-act="import">restore from a code</button>
                </div>`;
        }

        // a code, in a box, with a copy button — the same way the rest of
        // the site hands somebody a string
        function offer(title, code, note) {
            showRetroDialog({
                title: title,
                lines: note ? [note] : [],
                preview: code,
                okLabel: 'copy',
                cancelLabel: 'close',
                onOk: () => {
                    const done = () => showToast('my documents', 'copied. paste it somewhere you will find it again.');
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(code).then(done).catch(() => showToast('my documents', 'clipboard blocked — select the text and copy it'));
                    } else {
                        showToast('my documents', 'clipboard blocked — select the text and copy it');
                    }
                }
            });
        }

        function ask(title, lines, onYes) {
            showRetroDialog({ title: title, lines: lines, okLabel: 'yes', cancelLabel: 'no', onOk: onYes });
        }

        body.addEventListener('click', e => {
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            const doc = DOCS.find(d => d.id === btn.getAttribute('data-id'));
            if (typeof playSound === 'function') playSound('click');

            if (act === 'export' && doc) {
                offer('export — ' + doc.name, pack([doc.id]),
                    'this is ' + doc.name + ', as a code. paste it into restore on another browser.');
            } else if (act === 'export-all') {
                const ids = DOCS.filter(present).map(d => d.id);
                if (!ids.length) return showToast('my documents', 'there is nothing saved yet.');
                offer('back everything up', pack(ids),
                    plural(ids.length, 'document') + ', in one code. it is the whole desktop.');
            } else if (act === 'open' && doc && typeof startMenuAction === 'function') {
                startMenuAction(doc.open);
            } else if (act === 'delete' && doc) {
                ask('delete ' + doc.name + '?', [
                    'this cannot be undone, and there is no recycle bin for it.',
                    'export it first if you might want it back.'
                ], () => {
                    wipe(doc);
                    if (typeof playSound === 'function') playSound('ding');
                    showToast('my documents', doc.name + ' deleted.');
                    render();
                });
            } else if (act === 'import') {
                const code = prompt('paste a backup code:');
                if (!code) return;
                const got = unpack(code);
                if (!got.ok) {
                    if (typeof playSound === 'function') playSound('error');
                    return showToast('my documents', got.error + '.');
                }
                const n = Object.keys(got.files).length;
                ask('restore ' + plural(n, 'file') + '?', [
                    got.saved_at ? 'that backup was taken ' + whenever(got.saved_at) + '.' : '',
                    'anything already saved under the same name is overwritten.',
                    got.skipped && got.skipped.length ? plural(got.skipped.length, 'entry', 'entries') + ' in it are not from this site and will be ignored.' : ''
                ].filter(Boolean), () => {
                    const wrote = restore(got.files);
                    if (typeof playSound === 'function') playSound('ding');
                    showToast('my documents', plural(wrote, 'file') + ' restored. reload to see them.');
                    render();
                });
            }
        });

        render();
        win._cleanup = () => { };
    }

    window.openDocuments = openDocuments;

    // the pure half, so the test suite can load it with no dom in the room
    window.DOCUMENTS = {
        DOCS: DOCS, ENVELOPE: ENVELOPE, ENVELOPE_VERSION: ENVELOPE_VERSION,
        checksum: checksum, pack: pack, unpack: unpack, restore: restore, wipe: wipe,
        present: present, bytes: bytes, readable: readable, summaryOf: summaryOf,
        whenever: whenever, encode: encode, decode: decode
    };
})();
