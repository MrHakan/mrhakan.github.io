// ===================================================================
// mrhakan 98 — theme maker
//
// the editor for the theme engine in themes.js. every control in here is
// generated from THEME_NODES / THEME_PROPS / THEME_TRIGGERS / THEME_ACTIONS,
// so the day a new customisable node is added to the registry it shows up
// here on its own.
//
// live preview writes straight onto the real desktop rather than into a
// scaled-down mock, because a theme that looks right in a 200px box and
// wrong at full size is not much of a preview. closing the window without
// saving puts everything back.
// ===================================================================

let TM = null;

function openThemeMaker() {
    if (typeof THEME_NODES === 'undefined') {
        showToast('theme maker', 'theme engine did not load bradar');
        return;
    }
    const { body, win, close } = createAppWindow('theme maker', { icon: 'palette', width: 620 });
    win.classList.add('tm-window');

    TM = {
        theme: tmBlankTheme(),
        tab: 'design',
        node: 'desktop',
        audioFile: null,
        audioReport: null,
        preview: true,
        // what was running before the maker opened, so closing restores it
        prevActiveId: localStorage.getItem(THEME_KEY_ACTIVE) || null,
        body, win, close
    };
    tmRender();
    if (typeof unlockAchievement === 'function') unlockAchievement('theme_maker');

    // restore the desktop when the window goes away
    const observer = new MutationObserver(() => {
        if (!document.body.contains(win)) {
            observer.disconnect();
            tmRestoreDesktop();
            TM = null;
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function tmBlankTheme() {
    return {
        format: THEME_FORMAT,
        id: 'my-theme-' + Math.random().toString(36).slice(2, 6),
        name: 'my theme',
        author: '',
        authorUrl: '',
        description: '',
        created: new Date().toISOString().slice(0, 10),
        vars: {}, nodes: {}, events: [], music: null
    };
}

function tmRestoreDesktop() {
    themeClear({ keepActive: true });
    const prev = TM && TM.prevActiveId ? themeById(TM.prevActiveId) : null;
    if (prev) themeApply(prev);
    else localStorage.removeItem(THEME_KEY_ACTIVE);
}

function tmLivePreview() {
    if (!TM) return;
    if (!TM.preview) { themeClear({ keepActive: true }); return; }
    // preview mode: paint the css, but don't persist or start timers
    const res = themeValidate(TM.theme);
    themeClear({ keepActive: true });
    if (res.ok) themeStyleEl('theme-sheet').textContent = themeCompile(res.theme);
}

// ===================================================================
// shell
// ===================================================================
const TM_TABS = [
    ['design', 'design', 'tune'],
    ['colours', 'colours', 'palette'],
    ['events', 'events', 'schedule'],
    ['music', 'music', 'music_note'],
    ['gallery', 'gallery', 'folder'],
    ['publish', 'publish', 'rocket_launch']
];

function tmRender() {
    if (!TM) return;
    const t = TM.theme;
    TM.body.innerHTML = `
        <div class="tm-meta bevel-in">
            <label>name <input class="tm-input" id="tm-name" maxlength="60" value="${escapeHtml(t.name)}"></label>
            <label>by <input class="tm-input" id="tm-author" maxlength="40" placeholder="your name" value="${escapeHtml(t.author)}"></label>
            <label class="tm-wide">about <input class="tm-input" id="tm-desc" maxlength="240" placeholder="one line about your theme" value="${escapeHtml(t.description)}"></label>
        </div>
        <div class="tm-tabs">
            ${TM_TABS.map(([id, label, icon]) => `
                <button class="tm-tab bevel-out${TM.tab === id ? ' sel' : ''}" data-tab="${id}">
                    <span class="material-symbols-outlined">${icon}</span>${label}
                </button>`).join('')}
            <label class="tm-live"><input type="checkbox" id="tm-preview"${TM.preview ? ' checked' : ''}> live</label>
        </div>
        <div class="tm-panel" id="tm-panel"></div>
        <div class="tm-foot">
            <button class="bevel-out tm-btn" id="tm-apply">apply for real</button>
            <button class="bevel-out tm-btn" id="tm-save">save to my themes</button>
            <button class="bevel-out tm-btn" id="tm-export">export .thm</button>
            <button class="bevel-out tm-btn" id="tm-import">import…</button>
            <button class="bevel-out tm-btn tm-danger" id="tm-reset">start over</button>
        </div>`;

    TM.body.querySelectorAll('.tm-tab').forEach(b => b.onclick = () => {
        TM.tab = b.dataset.tab; playSound('click'); tmRender();
    });
    const nameEl = TM.body.querySelector('#tm-name');
    nameEl.oninput = () => {
        t.name = nameEl.value;
        // keep the id in step with the name until the theme is saved
        t.id = (nameEl.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)) || 'my-theme';
    };
    TM.body.querySelector('#tm-author').oninput = e => t.author = e.target.value;
    TM.body.querySelector('#tm-desc').oninput = e => t.description = e.target.value;
    TM.body.querySelector('#tm-preview').onchange = e => { TM.preview = e.target.checked; tmLivePreview(); };

    TM.body.querySelector('#tm-apply').onclick = () => {
        const res = themeInstall(t);
        if (!res.ok) { tmAlert('cannot apply', res.errors); return; }
        TM.prevActiveId = res.theme.id;
        themeApply(res.theme);
        playSound('ding');
        showToast('theme maker', `"${res.theme.name}" is live. it will still be here after a reload.`);
    };
    TM.body.querySelector('#tm-save').onclick = () => {
        const res = themeInstall(t);
        if (!res.ok) { tmAlert('cannot save', res.errors); return; }
        if (TM.audioFile) themeAudioPut(res.theme.id, TM.audioFile).catch(() => { });
        playSound('ding');
        showToast('theme maker', `saved. find it under gallery → my themes.`);
        tmRender();
    };
    TM.body.querySelector('#tm-export').onclick = () => tmExport();
    TM.body.querySelector('#tm-import').onclick = () => tmImport();
    TM.body.querySelector('#tm-reset').onclick = () => {
        showRetroDialog({
            title: 'start over', lines: ['this throws away everything you have not saved.'],
            okLabel: 'do it', cancelLabel: 'nevermind',
            onOk: () => { TM.theme = tmBlankTheme(); TM.audioFile = null; TM.audioReport = null; tmLivePreview(); tmRender(); }
        });
    };

    const panel = TM.body.querySelector('#tm-panel');
    ({
        design: tmRenderDesign, colours: tmRenderColours, events: tmRenderEvents,
        music: tmRenderMusic, gallery: tmRenderGallery, publish: tmRenderPublish
    })[TM.tab](panel);

    tmLivePreview();
}

function tmAlert(title, lines) {
    showRetroDialog({ title, lines: Array.isArray(lines) ? lines.slice(0, 6) : [String(lines)], okLabel: 'ok', cancelLabel: null, onOk: () => { } });
    playSound('error');
}

// ===================================================================
// design tab — the node tree and its property editors
// ===================================================================
function tmRenderDesign(panel) {
    const t = TM.theme;
    const groups = {};
    Object.entries(THEME_NODES).forEach(([id, n]) => {
        (groups[n.group] = groups[n.group] || []).push([id, n]);
    });

    panel.innerHTML = `
        <div class="tm-split">
            <div class="tm-tree bevel-in">
                ${Object.entries(THEME_GROUPS).map(([gid, glabel]) => `
                    <div class="tm-tree-group">${escapeHtml(glabel)}</div>
                    ${(groups[gid] || []).map(([id, n]) => {
                        const count = Object.keys(t.nodes[id] || {}).length;
                        return `<button class="tm-node${TM.node === id ? ' sel' : ''}" data-node="${id}">
                            ${escapeHtml(n.label)}${count ? `<span class="tm-badge">${count}</span>` : ''}
                        </button>`;
                    }).join('')}
                `).join('')}
            </div>
            <div class="tm-props" id="tm-props"></div>
        </div>`;

    panel.querySelectorAll('.tm-node').forEach(b => b.onclick = () => {
        TM.node = b.dataset.node; playSound('click'); tmRenderDesign(panel);
    });
    tmRenderProps(panel.querySelector('#tm-props'));
}

function tmRenderProps(host) {
    const t = TM.theme;
    const nodeId = TM.node;
    const node = THEME_NODES[nodeId];
    const set = t.nodes[nodeId] || {};

    host.innerHTML = `
        <div class="tm-props-head">
            <strong>${escapeHtml(node.label)}</strong>
            <button class="bevel-out tm-mini" id="tm-clear-node">clear all</button>
        </div>
        <p class="tm-sel">${escapeHtml(node.sel.join(', '))}</p>
        ${node.props.map(p => tmPropRow(nodeId, p, set[p])).join('')}`;

    host.querySelector('#tm-clear-node').onclick = () => {
        delete t.nodes[nodeId];
        playSound('click');
        tmRenderDesign(host.closest('.tm-panel'));
        tmLivePreview();
    };

    host.querySelectorAll('[data-prop]').forEach(el => {
        const prop = el.dataset.prop;
        const commit = v => {
            if (v === '' || v == null) delete (t.nodes[nodeId] || {})[prop];
            else { t.nodes[nodeId] = t.nodes[nodeId] || {}; t.nodes[nodeId][prop] = String(v); }
            if (t.nodes[nodeId] && !Object.keys(t.nodes[nodeId]).length) delete t.nodes[nodeId];
            tmLivePreview();
            // keep the paired colour swatch and text field in sync
            const row = el.closest('.tm-row');
            const mate = row && row.querySelector(`[data-prop="${prop}"]:not(:focus)`);
            if (mate && mate !== el && mate.value !== String(v)) mate.value = String(v);
            if (row) row.classList.toggle('set', v !== '' && v != null);
            tmSyncBadge(nodeId);
        };
        el.oninput = () => commit(el.value);
        el.onchange = () => commit(el.value);
    });
    host.querySelectorAll('.tm-unset').forEach(b => b.onclick = () => {
        delete (t.nodes[nodeId] || {})[b.dataset.unset];
        if (t.nodes[nodeId] && !Object.keys(t.nodes[nodeId]).length) delete t.nodes[nodeId];
        playSound('click');
        tmRenderDesign(host.closest('.tm-panel'));
        tmLivePreview();
    });
}

// the tree badge shows how many properties a node carries. it has to be
// created on the first edit and removed on the last, not just updated —
// otherwise setting a node's very first property looks like nothing happened.
function tmSyncBadge(nodeId) {
    const btn = document.querySelector(`.tm-node[data-node="${nodeId}"]`);
    if (!btn) return;
    const count = Object.keys((TM.theme.nodes || {})[nodeId] || {}).length;
    let badge = btn.querySelector('.tm-badge');
    if (!count) { if (badge) badge.remove(); return; }
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'tm-badge';
        btn.appendChild(badge);
    }
    badge.textContent = count;
}

function tmPropRow(nodeId, prop, value) {
    const spec = THEME_PROPS[prop];
    const has = value !== undefined;
    const v = has ? value : '';
    let control = '';

    if (spec.type === 'color') {
        const hex = /^#[0-9a-f]{6}$/i.test(v) ? v : '#c0c0c0';
        control = `<input type="color" class="tm-color" data-prop="${prop}" value="${hex}">
                   <input type="text" class="tm-input tm-input-sm" data-prop="${prop}" placeholder="#c0c0c0 / transparent" value="${escapeHtml(v)}">`;
    } else if (spec.type === 'font') {
        control = `<select class="tm-input bevel-in" data-prop="${prop}">
            <option value="">— not set —</option>
            ${THEME_FONTS.map(f => `<option value="${escapeHtml(f)}"${f === v ? ' selected' : ''} style="font-family:${escapeHtml(f)}">${escapeHtml(f.split(',')[0].replace(/"/g, ''))}</option>`).join('')}
        </select>`;
    } else if (spec.type === 'cursor') {
        control = `<select class="tm-input bevel-in" data-prop="${prop}">
            <option value="">— not set —</option>
            ${Object.entries(THEME_CURSORS).map(([id, c]) => `<option value="${id}"${id === v ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>`;
    } else if (spec.type === 'select') {
        control = `<select class="tm-input bevel-in" data-prop="${prop}">
            <option value="">— not set —</option>
            ${spec.options.map(o => `<option value="${escapeHtml(o)}"${o === v ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}
        </select>`;
    } else if (spec.type === 'px' || spec.type === 'range') {
        const min = spec.min ?? 0, max = spec.max ?? 100, step = spec.step ?? 1;
        const num = v === '' ? '' : parseFloat(v);
        control = `<input type="range" class="tm-range" data-prop="${prop}" min="${min}" max="${max}" step="${step}" value="${num === '' ? min : num}">
                   <input type="text" class="tm-input tm-input-xs" data-prop="${prop}" placeholder="${spec.type === 'px' ? 'px' : ''}" value="${escapeHtml(v)}">`;
    } else {
        control = `<input type="text" class="tm-input" data-prop="${prop}" placeholder="${escapeHtml(spec.placeholder || '')}" value="${escapeHtml(v)}">`;
    }

    return `<div class="tm-row${has ? ' set' : ''}">
        <span class="tm-row-label">${escapeHtml(spec.label)}</span>
        <span class="tm-row-ctl">${control}</span>
        <button class="tm-unset" data-unset="${prop}" title="unset">×</button>
    </div>`;
}

// ===================================================================
// colours tab — global variables + a one-click palette generator
// ===================================================================
function tmRenderColours(panel) {
    const t = TM.theme;
    panel.innerHTML = `
        <p class="tm-hint">these feed the whole site — the winamp visualiser, the marquee, the counter glow. anything that already reads a css variable picks them up.</p>
        ${Object.entries(THEME_VARS).map(([k, spec]) => {
            const v = t.vars[k] || '';
            if (spec.type === 'font') {
                return `<div class="tm-row${v ? ' set' : ''}">
                    <span class="tm-row-label">${escapeHtml(spec.label)}</span>
                    <span class="tm-row-ctl"><select class="tm-input bevel-in" data-var="${k}">
                        <option value="">— not set —</option>
                        ${THEME_FONTS.map(f => `<option value="${escapeHtml(f)}"${f === v ? ' selected' : ''}>${escapeHtml(f.split(',')[0].replace(/"/g, ''))}</option>`).join('')}
                    </select></span>
                    <button class="tm-unset" data-unsetvar="${k}">×</button></div>`;
            }
            const hex = /^#[0-9a-f]{6}$/i.test(v) ? v : '#0df259';
            return `<div class="tm-row${v ? ' set' : ''}">
                <span class="tm-row-label">${escapeHtml(spec.label)}</span>
                <span class="tm-row-ctl">
                    <input type="color" class="tm-color" data-var="${k}" value="${hex}">
                    <input type="text" class="tm-input tm-input-sm" data-var="${k}" value="${escapeHtml(v)}">
                </span>
                <button class="tm-unset" data-unsetvar="${k}">×</button></div>`;
        }).join('')}

        <p class="tm-label">generate a whole theme from one colour:</p>
        <div class="tm-gen">
            <input type="color" class="tm-color" id="tm-gen-color" value="#7a5cff">
            <select class="tm-input bevel-in" id="tm-gen-mood">
                <option value="dark">dark</option>
                <option value="light">light</option>
                <option value="neon">neon</option>
                <option value="paper">paper</option>
            </select>
            <button class="bevel-out tm-btn" id="tm-gen-go">build it</button>
        </div>
        <p class="tm-hint">this overwrites the nodes it touches. everything stays editable afterwards.</p>`;

    panel.querySelectorAll('[data-var]').forEach(el => {
        const k = el.dataset.var;
        const commit = v => {
            if (!v) delete t.vars[k]; else t.vars[k] = v;
            tmLivePreview();
            const row = el.closest('.tm-row');
            const mate = row && row.querySelector(`[data-var="${k}"]:not(:focus)`);
            if (mate && mate !== el && mate.value !== v) mate.value = v;
        };
        el.oninput = () => commit(el.value);
        el.onchange = () => commit(el.value);
    });
    panel.querySelectorAll('[data-unsetvar]').forEach(b => b.onclick = () => {
        delete t.vars[b.dataset.unsetvar]; playSound('click'); tmRenderColours(panel); tmLivePreview();
    });
    panel.querySelector('#tm-gen-go').onclick = () => {
        tmGenerate(panel.querySelector('#tm-gen-color').value, panel.querySelector('#tm-gen-mood').value);
        playSound('ding');
        tmRender();
    };
}

// build a coherent palette from one seed colour. plain hsl maths — the
// point is to give someone a working theme in one click that they can then
// pull apart, not to be clever.
function tmHexToHsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    return [h, s * 100, l * 100];
}
function tmHsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)); l = Math.max(0, Math.min(100, l));
    // to hex so the colour inputs can show it
    const a = s / 100 * Math.min(l / 100, 1 - l / 100);
    const f = n => {
        const k = (n + h / 30) % 12;
        const c = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
        return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function tmGenerate(seed, mood) {
    const [h, s] = tmHexToHsl(seed);
    const t = TM.theme;
    const P = {
        dark: { deskL: 8, winL: 16, textL: 88, barL: 22, accentL: 62, sat: Math.max(20, s) },
        light: { deskL: 82, winL: 92, textL: 14, barL: 46, accentL: 44, sat: Math.max(15, s * 0.7) },
        neon: { deskL: 5, winL: 10, textL: 78, barL: 30, accentL: 60, sat: 95 },
        paper: { deskL: 88, winL: 96, textL: 20, barL: 40, accentL: 38, sat: Math.min(30, s) }
    }[mood];

    const desk = tmHsl(h, P.sat * 0.5, P.deskL);
    const win = tmHsl(h, P.sat * 0.25, P.winL);
    const text = tmHsl(h, P.sat * 0.2, P.textL);
    const bar = tmHsl(h, P.sat, P.barL);
    const bar2 = tmHsl(h + 24, P.sat, P.barL + 16);
    const accent = tmHsl(h + 180, P.sat, P.accentL);
    const light = tmHsl(h, P.sat * 0.3, Math.min(96, P.winL + 26));
    const dark = tmHsl(h, P.sat * 0.4, Math.max(4, P.winL - 14));
    const glow = mood === 'neon' ? `0 0 8px ${accent}` : '';

    t.vars['--primary-color'] = accent;
    t.vars['--accent-color'] = bar;
    Object.assign(t.nodes, {
        desktop: { bg: desk, bgImage: mood === 'neon' ? `radial-gradient(circle at 30% 20%, ${tmHsl(h, 90, 22)}, ${desk} 60%)` : 'none', color: text },
        window: { bg: win, shadow: mood === 'paper' ? '4px 4px 0 rgba(0,0,0,.25)' : '8px 8px 0 rgba(0,0,0,.5)' },
        windowBody: { bg: win, color: text },
        pageContent: { bg: tmHsl(h, P.sat * 0.15, Math.min(98, P.winL + 6)), color: text },
        browserChrome: { bg: win, color: text },
        titleBar: { bgImage: `linear-gradient(to right, ${bar}, ${bar2})` },
        titleText: { color: '#ffffff' },
        taskbar: { bg: tmHsl(h, P.sat * 0.35, P.winL) },
        taskbarBtn: { bg: win, color: text },
        startButton: { bg: bar, color: '#ffffff' },
        startMenu: { bg: win },
        startItem: { color: text },
        startItemHover: { bg: bar, color: '#ffffff' },
        bevelOut: { bevelLight: light, bevelDark: dark },
        bevelIn: { bevelLight: dark, bevelDark: light },
        heading: Object.assign({ color: accent }, glow ? { textShadow: glow } : {}),
        marquee: Object.assign({ color: accent }, glow ? { textShadow: glow } : {}),
        counter: { bg: tmHsl(h, P.sat, Math.max(3, P.deskL - 5)), color: accent },
        selection: { bg: bar, color: '#ffffff' },
        link: { color: accent },
        icons: { color: text }
    });
}

// ===================================================================
// events tab
// ===================================================================
function tmRenderEvents(panel) {
    const t = TM.theme;
    panel.innerHTML = `
        <p class="tm-hint">a theme can do things on a schedule — go dark after 20:00, nag you every two minutes, throw confetti on your birthday. up to 24 events, and everything they can do is on this list. nothing else is allowed to run.</p>
        <div class="tm-events">
            ${t.events.length ? t.events.map((ev, i) => tmEventCard(ev, i)).join('') : '<p class="tm-empty">no events yet.</p>'}
        </div>
        <button class="bevel-out tm-btn" id="tm-add-event"${t.events.length >= 24 ? ' disabled' : ''}>+ add an event</button>`;

    panel.querySelector('#tm-add-event').onclick = () => {
        t.events.push({ id: 'ev' + (t.events.length + 1), name: 'new event', trigger: { type: 'interval', seconds: 60 }, actions: [{ type: 'toast', title: 'theme.exe', text: 'hello bradar' }] });
        playSound('click'); tmRenderEvents(panel);
    };
    panel.querySelectorAll('[data-evdel]').forEach(b => b.onclick = () => {
        t.events.splice(+b.dataset.evdel, 1); playSound('click'); tmRenderEvents(panel);
    });
    panel.querySelectorAll('[data-evtest]').forEach(b => b.onclick = () => {
        const ev = t.events[+b.dataset.evtest];
        const res = themeValidate(t);
        const valid = res.ok && res.theme.events.find(e => e.name === ev.name);
        if (!valid) { tmAlert('cannot test', ['this event has invalid values — fix the red fields first.']); return; }
        themeEventStyleEl = themeStyleEl('theme-events-sheet');
        themeRunActions(valid.actions, valid);
    });
    panel.querySelectorAll('[data-evname]').forEach(el => el.oninput = () => { t.events[+el.dataset.evname].name = el.value; });
    panel.querySelectorAll('[data-evtrig]').forEach(el => el.onchange = () => {
        const ev = t.events[+el.dataset.evtrig];
        ev.trigger = { type: el.value };
        THEME_TRIGGERS[el.value].fields.forEach(f => ev.trigger[f.k] = f.def);
        playSound('click'); tmRenderEvents(panel);
    });
    panel.querySelectorAll('[data-trigfield]').forEach(el => el.oninput = el.onchange = () => {
        const [i, k] = el.dataset.trigfield.split(':');
        t.events[+i].trigger[k] = el.value;
    });
    panel.querySelectorAll('[data-actadd]').forEach(b => b.onclick = () => {
        const ev = t.events[+b.dataset.actadd];
        if (ev.actions.length >= 8) { tmAlert('too many', ['eight actions per event is the ceiling.']); return; }
        ev.actions.push({ type: 'toast', title: 'theme.exe', text: 'hello bradar' });
        playSound('click'); tmRenderEvents(panel);
    });
    panel.querySelectorAll('[data-actdel]').forEach(b => b.onclick = () => {
        const [i, j] = b.dataset.actdel.split(':');
        t.events[+i].actions.splice(+j, 1);
        if (!t.events[+i].actions.length) t.events[+i].actions.push({ type: 'toast', title: 'theme.exe', text: 'hello' });
        playSound('click'); tmRenderEvents(panel);
    });
    panel.querySelectorAll('[data-acttype]').forEach(el => el.onchange = () => {
        const [i, j] = el.dataset.acttype.split(':');
        const a = { type: el.value };
        THEME_ACTIONS[el.value].fields.forEach(f => a[f.k] = f.def);
        t.events[+i].actions[+j] = a;
        playSound('click'); tmRenderEvents(panel);
    });
    panel.querySelectorAll('[data-actfield]').forEach(el => el.oninput = el.onchange = () => {
        const [i, j, k] = el.dataset.actfield.split(':');
        t.events[+i].actions[+j][k] = el.value;
        // switching the node changes which properties are legal
        if (k === 'node') tmRenderEvents(panel);
    });
}

function tmEventCard(ev, i) {
    const trig = THEME_TRIGGERS[ev.trigger.type] || THEME_TRIGGERS.interval;
    return `<div class="tm-event bevel-in">
        <div class="tm-event-head">
            <input class="tm-input tm-input-sm" data-evname="${i}" maxlength="60" value="${escapeHtml(ev.name || '')}" placeholder="what this does">
            <button class="bevel-out tm-mini" data-evtest="${i}">test</button>
            <button class="bevel-out tm-mini tm-danger" data-evdel="${i}">delete</button>
        </div>
        <div class="tm-event-trig">
            <span class="tm-when">when</span>
            <select class="tm-input bevel-in" data-evtrig="${i}">
                ${Object.entries(THEME_TRIGGERS).map(([id, s]) => `<option value="${id}"${id === ev.trigger.type ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
            </select>
            ${trig.fields.map(f => tmField(`trigfield="${i}:${f.k}"`, f, ev.trigger[f.k])).join('')}
        </div>
        <div class="tm-actions">
            ${ev.actions.map((a, j) => tmActionRow(a, i, j)).join('')}
            <button class="bevel-out tm-mini" data-actadd="${i}">+ action</button>
        </div>
    </div>`;
}

function tmActionRow(a, i, j) {
    const spec = THEME_ACTIONS[a.type] || THEME_ACTIONS.toast;
    return `<div class="tm-action">
        <span class="tm-then">then</span>
        <select class="tm-input bevel-in" data-acttype="${i}:${j}">
            ${Object.entries(THEME_ACTIONS).map(([id, s]) => `<option value="${id}"${id === a.type ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
        </select>
        ${spec.fields.map(f => tmField(`actfield="${i}:${j}:${f.k}"`, f, a[f.k], a)).join('')}
        <button class="tm-unset" data-actdel="${i}:${j}" title="remove">×</button>
    </div>`;
}

function tmField(attr, f, value, ctx) {
    const v = value == null ? (f.def == null ? '' : f.def) : value;
    const label = `<span class="tm-fl">${escapeHtml(f.label)}</span>`;
    if (f.type === 'select') {
        return `${label}<select class="tm-input bevel-in" data-${attr}>${f.options.map(o => `<option value="${escapeHtml(o)}"${o === v ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`;
    }
    if (f.type === 'node') {
        return `${label}<select class="tm-input bevel-in" data-${attr}>${Object.entries(THEME_NODES).map(([id, n]) => `<option value="${id}"${id === v ? ' selected' : ''}>${escapeHtml(n.label)}</option>`).join('')}</select>`;
    }
    if (f.type === 'prop') {
        // only offer properties the chosen node actually has
        const node = THEME_NODES[(ctx && ctx.node) || 'desktop'] || THEME_NODES.desktop;
        return `${label}<select class="tm-input bevel-in" data-${attr}>${node.props.map(p => `<option value="${p}"${p === v ? ' selected' : ''}>${escapeHtml(THEME_PROPS[p].label)}</option>`).join('')}</select>`;
    }
    if (f.type === 'color') {
        const hex = /^#[0-9a-f]{6}$/i.test(v) ? v : '#ff0000';
        return `${label}<input type="color" class="tm-color" data-${attr} value="${hex}">`;
    }
    if (f.type === 'num') {
        return `${label}<input type="number" class="tm-input tm-input-xs" data-${attr} min="${f.min}" max="${f.max}" value="${escapeHtml(String(v))}">`;
    }
    if (f.type === 'time') {
        return `${label}<input type="time" class="tm-input tm-input-sm" data-${attr} value="${escapeHtml(String(v))}">`;
    }
    if (f.type === 'date') {
        return `${label}<input type="text" class="tm-input tm-input-xs" data-${attr} placeholder="MM-DD" maxlength="5" value="${escapeHtml(String(v))}">`;
    }
    return `${label}<input type="text" class="tm-input tm-input-sm" data-${attr} value="${escapeHtml(String(v))}">`;
}

// ===================================================================
// music tab
// ===================================================================
function tmRenderMusic(panel) {
    const t = TM.theme;
    const m = t.music;
    const r = TM.audioReport;

    panel.innerHTML = `
        <p class="tm-hint">a theme can bring its own track. it gets added to the winamp playlist while the theme is active, and if you publish it, it becomes a permanent track on the site.</p>
        <div class="tm-drop bevel-in" id="tm-drop">
            <span class="material-symbols-outlined">music_note</span>
            <span>drop an mp3 / ogg / wav / flac here, or click to pick one</span>
            <span class="tm-drop-sub">max ${SCAN_LIMITS.audioBytes / 1048576} MB · scanned before it is accepted</span>
            <input type="file" id="tm-file" accept="audio/*,.mp3,.ogg,.wav,.flac,.m4a" hidden>
        </div>
        ${r ? tmScanReport(r) : ''}
        ${m ? `
        <div class="tm-track bevel-in">
            <label>title <input class="tm-input" id="tm-mtitle" maxlength="80" value="${escapeHtml(m.title)}"></label>
            <label>artist <input class="tm-input" id="tm-martist" maxlength="80" value="${escapeHtml(m.artist)}"></label>
            <label class="tm-wide">ticker lines, one per line — these scroll in the marquee while it plays
                <textarea class="tm-input tm-area" id="tm-mmemes" rows="4" placeholder="one line per row">${escapeHtml((m.memes || []).join('\n'))}</textarea></label>
            <p class="tm-sel">file: ${escapeHtml(m.filename)} · ${(m.bytes / 1048576).toFixed(2)} MB · sha-256 ${escapeHtml(m.sha256.slice(0, 24))}…</p>
            <div class="tm-track-btns">
                <button class="bevel-out tm-btn" id="tm-mplay">preview in winamp</button>
                <button class="bevel-out tm-btn tm-danger" id="tm-mdrop">remove track</button>
            </div>
        </div>` : ''}
        <p class="tm-legal">only upload audio you have the right to share. published tracks are reviewed before they are merged, and anything that looks like a commercial release gets rejected.</p>`;

    const drop = panel.querySelector('#tm-drop');
    const file = panel.querySelector('#tm-file');
    drop.onclick = () => file.click();
    file.onchange = () => file.files[0] && tmAcceptAudio(file.files[0], panel);
    ['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', ev => {
        const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (f) tmAcceptAudio(f, panel);
    });

    if (m) {
        panel.querySelector('#tm-mtitle').oninput = e => m.title = e.target.value;
        panel.querySelector('#tm-martist').oninput = e => m.artist = e.target.value;
        panel.querySelector('#tm-mmemes').oninput = e => m.memes = e.target.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 40);
        panel.querySelector('#tm-mdrop').onclick = () => {
            t.music = null; TM.audioFile = null; TM.audioReport = null;
            themeAudioDelete(t.id).catch(() => { });
            playSound('click'); tmRenderMusic(panel);
        };
        panel.querySelector('#tm-mplay').onclick = () => {
            const res = themeInstall(t);
            if (!res.ok) { tmAlert('cannot preview', res.errors); return; }
            if (TM.audioFile) {
                themeAudioPut(res.theme.id, TM.audioFile)
                    .then(() => themeSyncMusic(res.theme))
                    .catch(() => tmAlert('preview failed', ['could not stash the audio locally.']));
            } else {
                themeSyncMusic(res.theme);
            }
        };
    }
}

async function tmAcceptAudio(file, panel) {
    if (typeof scanFile !== 'function') { tmAlert('scanner missing', ['the scanner did not load — refusing to accept the file.']); return; }
    TM.audioReport = { scanning: true };
    tmRenderMusic(panel);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const report = await scanFile(bytes, { name: file.name, kind: 'audio' });
    TM.audioReport = report;

    if (report.verdict === 'blocked') {
        TM.audioFile = null;
        playSound('error');
        tmRenderMusic(panel);
        return;
    }

    const accept = () => {
        TM.audioFile = file;
        // strip the path and anything that could confuse a shell or a URL
        const safeName = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
        TM.theme.music = {
            filename: safeName,
            title: safeName.replace(/\.[^.]+$/, '').slice(0, 80),
            artist: TM.theme.author || 'unknown',
            sha256: report.sha256,
            bytes: report.bytes,
            duration: Math.round(report.duration || 0),
            memes: []
        };
        playSound('ding');
        tmRenderMusic(panel);
    };

    if (report.verdict === 'suspicious') {
        showRetroDialog({
            title: 'scanner: suspicious',
            lines: ['the file passed the hard checks but tripped some soft ones.', 'read the report before you accept it.', 'CI will scan it again when you publish.'],
            okLabel: 'accept anyway', cancelLabel: 'discard',
            onOk: accept
        });
        tmRenderMusic(panel);
    } else {
        accept();
    }
}

function tmScanReport(r) {
    if (r.scanning) return `<div class="tm-scan bevel-in"><p class="tm-scan-head">scanning…</p></div>`;
    const icon = { pass: '✓', warn: '!', fail: '✕' };
    return `<div class="tm-scan bevel-in tm-scan-${r.verdict}">
        <p class="tm-scan-head">
            <span class="tm-verdict">${r.verdict === 'clean' ? 'CLEAN' : r.verdict === 'suspicious' ? 'SUSPICIOUS' : 'BLOCKED'}</span>
            ${r.passed} passed · ${r.warned} warnings · ${r.failed} failed · ${r.ms || 0}ms
        </p>
        <table class="tm-scan-table">
            ${r.checks.map(c => `<tr class="tm-c-${c.status}">
                <td class="tm-c-icon">${icon[c.status]}</td>
                <td class="tm-c-name">${escapeHtml(c.name)}</td>
                <td class="tm-c-detail">${escapeHtml(c.detail)}</td>
            </tr>`).join('')}
        </table>
        ${r.sha256 ? `<p class="tm-scan-hash">sha-256 ${escapeHtml(r.sha256)}</p>` : ''}
    </div>`;
}

// ===================================================================
// gallery tab
// ===================================================================
function tmRenderGallery(panel) {
    const mine = themeInstalled();
    panel.innerHTML = `
        <p class="tm-label">start from a preset</p>
        <div class="tm-cards">${THEME_PRESETS.map(t => tmThemeCard(t, 'preset')).join('')}</div>
        <p class="tm-label">my themes</p>
        <div class="tm-cards">${mine.length ? mine.map(t => tmThemeCard(t, 'mine')).join('') : '<p class="tm-empty">nothing saved yet.</p>'}</div>
        <p class="tm-label">published by other people</p>
        <div class="tm-cards" id="tm-published"><p class="tm-empty">loading…</p></div>`;

    panel.querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
        const src = b.dataset.src === 'preset' ? THEME_PRESETS.find(t => t.id === b.dataset.load)
            : b.dataset.src === 'mine' ? themeInstalled().find(t => t.id === b.dataset.load)
                : (TM.published || []).find(t => t.id === b.dataset.load);
        if (!src) return;
        TM.theme = JSON.parse(JSON.stringify(src));
        // an imported theme becomes yours to edit, under a new id
        if (b.dataset.src !== 'mine') {
            TM.theme.id = src.id + '-remix';
            TM.theme.name = src.name + ' (remix)';
        }
        TM.audioFile = null; TM.audioReport = null;
        playSound('ding');
        TM.tab = 'design';
        tmRender();
    });
    panel.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
        themeUninstall(b.dataset.del); playSound('click'); tmRenderGallery(panel);
    });

    const host = panel.querySelector('#tm-published');
    themeFetchGallery().then(list => {
        TM.published = list;
        host.innerHTML = list.length ? list.map(t => tmThemeCard(t, 'pub')).join('') : '<p class="tm-empty">nobody has published one yet. be the first.</p>';
        host.querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
            const src = list.find(t => t.id === b.dataset.load);
            if (!src) return;
            TM.theme = JSON.parse(JSON.stringify(src));
            TM.theme.id = src.id + '-remix';
            TM.theme.name = src.name + ' (remix)';
            playSound('ding'); TM.tab = 'design'; tmRender();
        });
    }).catch(() => {
        host.innerHTML = '<p class="tm-empty">could not reach github. published themes will show up when you are back online.</p>';
    });
}

function tmThemeCard(t, src) {
    const swatch = t.vars && t.vars['--primary-color'] || '#0df259';
    const bg = (t.nodes && t.nodes.desktop && t.nodes.desktop.bg) || '#1a0b2e';
    const bar = (t.nodes && t.nodes.titleBar && (t.nodes.titleBar.bg || t.nodes.titleBar.bgImage)) || 'linear-gradient(to right,#000080,#1084d0)';
    return `<div class="tm-card bevel-out">
        <div class="tm-card-prev" style="background:${escapeHtml(bg)}">
            <div class="tm-card-bar" style="background:${escapeHtml(bar)}"></div>
            <div class="tm-card-dot" style="background:${escapeHtml(swatch)}"></div>
        </div>
        <div class="tm-card-name">${escapeHtml(t.name)}</div>
        <div class="tm-card-by">by ${escapeHtml(t.author || 'anonymous')}${t.music ? ' · ♪' : ''}${t.events && t.events.length ? ` · ${t.events.length} event${t.events.length > 1 ? 's' : ''}` : ''}</div>
        <div class="tm-card-btns">
            <button class="bevel-out tm-mini" data-load="${escapeHtml(t.id)}" data-src="${src}">${src === 'mine' ? 'edit' : 'remix'}</button>
            ${src === 'mine' ? `<button class="bevel-out tm-mini tm-danger" data-del="${escapeHtml(t.id)}">delete</button>` : ''}
        </div>
    </div>`;
}

// ===================================================================
// import / export
// ===================================================================
function tmExport() {
    const res = themeValidate(TM.theme);
    if (!res.ok) { tmAlert('cannot export', res.errors); return; }
    const blob = new Blob([JSON.stringify(res.theme, null, 4)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${res.theme.id}.thm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    showToast('theme maker', 'exported. the audio file is not inside it — keep that separately.');
}

function tmImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.thm,.json,application/json';
    input.onchange = async () => {
        const f = input.files[0];
        if (!f) return;
        if (f.size > SCAN_LIMITS.themeBytes) { tmAlert('too big', ['a theme file should be a few kilobytes, not this.']); return; }
        const text = await f.text();
        const report = scanThemeJson(text);
        if (report.verdict === 'blocked') {
            TM.tab = 'music'; // the report renderer lives on that tab
            tmAlert('import blocked', report.checks.filter(c => c.status === 'fail').map(c => `${c.name}: ${c.detail}`));
            return;
        }
        let parsed;
        try { parsed = JSON.parse(text); } catch (e) { tmAlert('import failed', ['that is not valid json.']); return; }
        const res = themeValidate(parsed);
        if (!res.ok) { tmAlert('import failed', res.errors); return; }
        TM.theme = res.theme;
        TM.audioFile = null; TM.audioReport = null;
        playSound('ding');
        tmRender();
        if (res.warnings.length) tmAlert('imported with changes', res.warnings);
        else showToast('theme maker', `imported "${res.theme.name}"`);
    };
    input.click();
}

// ===================================================================
// publish tab
// ===================================================================
function tmRenderPublish(panel) {
    const t = TM.theme;
    const res = themeValidate(t);
    const json = res.ok ? JSON.stringify(res.theme, null, 4) + '\n' : '';
    const jsonReport = res.ok ? scanThemeJson(json) : null;
    const repo = (typeof GH_REPO !== 'undefined' && GH_REPO) || 'MrHakan/mrhakan.github.io';
    const nodeCount = res.ok ? Object.keys(res.theme.nodes).length : 0;

    const blockers = [];
    if (!res.ok) blockers.push(...res.errors);
    if (!t.author || !t.author.trim()) blockers.push('put your name in the "by" box so people know whose theme it is');
    if (jsonReport && jsonReport.verdict === 'blocked') blockers.push(...jsonReport.checks.filter(c => c.status === 'fail').map(c => `${c.name}: ${c.detail}`));
    if (t.music && (!TM.audioReport || TM.audioReport.verdict === 'blocked')) {
        blockers.push('the attached track has not passed a scan — re-attach it on the music tab');
    }

    panel.innerHTML = `
        <p class="tm-hint">publishing opens a pull request against the site's repo — a theme is a file in here, so unlike signing the guestbook this one really does need one. mrhakan reviews it, CI scans everything again on the server, and once it is merged your theme shows up in everyone's gallery.</p>

        <div class="tm-summary bevel-in">
            <div><strong>${escapeHtml(t.name)}</strong> by ${escapeHtml(t.author || '—')}</div>
            <div>${nodeCount} customised node${nodeCount === 1 ? '' : 's'} · ${res.ok ? res.theme.events.length : 0} event${(res.ok && res.theme.events.length === 1) ? '' : 's'} · ${t.music ? '1 track' : 'no track'}</div>
            <div>file: <code>data/themes/${escapeHtml(t.id)}.json</code></div>
        </div>

        ${jsonReport ? tmScanReport(jsonReport) : ''}
        ${t.music && TM.audioReport && !TM.audioReport.scanning ? `<p class="tm-label">attached track</p>${tmScanReport(TM.audioReport)}` : ''}

        ${blockers.length ? `<div class="tm-blockers bevel-in">
            <strong>fix these first:</strong>
            <ul>${blockers.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
        </div>` : `<div class="tm-ready bevel-in">ready to publish.</div>`}

        ${res.warnings.length ? `<p class="tm-hint">note: ${escapeHtml(res.warnings.join('; '))}</p>` : ''}

        <button class="bevel-out tm-btn tm-publish" id="tm-pub"${blockers.length ? ' disabled' : ''}>
            <span class="material-symbols-outlined">rocket_launch</span> publish via pull request
        </button>
        <p class="tm-hint">it opens github with the file pre-filled — you review it and click "create pull request". you need a github account; forking and the branch are handled for you.</p>
        <details class="tm-json"><summary>see the exact json this will submit</summary><pre>${escapeHtml(json || '—')}</pre></details>`;

    const btn = panel.querySelector('#tm-pub');
    if (btn && !blockers.length) btn.onclick = () => tmPublish(res.theme, json, repo);
}

function tmPublish(theme, json, repo) {
    const branch = (typeof GH_BRANCH !== 'undefined' && GH_BRANCH) || 'main';
    const filename = `data/themes/${theme.id}.json`;
    const url = `https://github.com/${repo}/new/${branch}?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(json)}`;

    const lines = [
        'step 1 — github opens with your theme file already filled in.',
        'step 2 — click "commit changes", then "create pull request".',
        'step 3 — CI scans the file and comments on the PR with the result.'
    ];
    if (theme.music) {
        lines.push(`step 4 — your track is a separate binary, so it has to be uploaded on its own. after the PR exists, open it and use "add file → upload files" on your branch, into src/music/, with the file named exactly "${theme.music.filename}".`);
        lines.push('CI checks that the uploaded file hashes to the sha-256 recorded in your theme, so a swapped file is caught automatically.');
    }
    lines.push('the json is on your clipboard as a backup either way.');

    showRetroDialog({
        title: 'publish theme',
        lines,
        okLabel: 'open github',
        cancelLabel: 'not yet',
        onOk: () => {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).catch(() => { });
            window.open(url, '_blank', 'noopener');
            if (theme.music) {
                const upload = `https://github.com/${repo}/upload/${branch}/src/music`;
                setTimeout(() => showRetroDialog({
                    title: 'and the music file',
                    lines: [
                        `your theme references "${theme.music.filename}".`,
                        'upload it to src/music on the same branch as the PR you just opened.',
                        'if you upload it to a different branch it will become a second pull request — that still works, just mention it in the first one.'
                    ],
                    okLabel: 'open the upload page', cancelLabel: 'later',
                    onOk: () => window.open(upload, '_blank', 'noopener')
                }), 900);
            }
            if (typeof unlockAchievement === 'function') unlockAchievement('theme_publisher');
            showToast('github.exe', 'waiting for your pull request bradar');
        }
    });
}
