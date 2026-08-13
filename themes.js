// ===================================================================
// mrhakan 98 — theme engine
//
// a theme is a plain json object. it maps *nodes* (named pieces of the
// desktop) to css properties, can set global css variables, can carry
// scheduled events that fire on a clock or an interval, and can bring
// its own winamp track along.
//
// nothing here writes css by hand. the node registry below is the single
// source of truth: the theme maker builds its ui from it, the compiler
// turns a theme into a stylesheet from it, and the validator rejects
// anything that isn't in it. adding a new customisable node is one entry.
// ===================================================================

const THEME_FORMAT = 'mrhakan-theme/1';
const THEME_KEY_INSTALLED = 'themes-installed';
const THEME_KEY_ACTIVE = 'theme-active';

// ---------- property types ----------
// every editable property knows what css it writes and how to edit it.
// `css` may be a single property or a list (bevel writes four borders).
const THEME_PROPS = {
    bg: { label: 'background', type: 'color', css: 'background-color' },
    bgImage: { label: 'background image / gradient', type: 'text', css: 'background-image', placeholder: 'linear-gradient(#000, #333)' },
    bgSize: { label: 'background size', type: 'select', css: 'background-size', options: ['auto', 'cover', 'contain', '100% 100%', '8px 8px', '32px 32px'] },
    color: { label: 'text colour', type: 'color', css: 'color' },
    font: { label: 'font family', type: 'font', css: 'font-family' },
    size: { label: 'font size', type: 'px', css: 'font-size', min: 7, max: 40 },
    weight: { label: 'font weight', type: 'select', css: 'font-weight', options: ['normal', 'bold', '900'] },
    spacing: { label: 'letter spacing', type: 'px', css: 'letter-spacing', min: -2, max: 8 },
    textShadow: { label: 'text glow', type: 'text', css: 'text-shadow', placeholder: '0 0 6px #0f0' },
    transform: { label: 'text case', type: 'select', css: 'text-transform', options: ['none', 'uppercase', 'lowercase', 'capitalize'] },
    borderColor: { label: 'border colour', type: 'color', css: 'border-color' },
    borderWidth: { label: 'border width', type: 'px', css: 'border-width', min: 0, max: 8 },
    borderStyle: { label: 'border style', type: 'select', css: 'border-style', options: ['solid', 'dashed', 'dotted', 'double', 'ridge', 'groove'] },
    radius: { label: 'corner radius', type: 'px', css: 'border-radius', min: 0, max: 30 },
    shadow: { label: 'drop shadow', type: 'text', css: 'box-shadow', placeholder: '8px 8px 0 rgba(0,0,0,.5)' },
    opacity: { label: 'opacity', type: 'range', css: 'opacity', min: 0, max: 1, step: 0.05 },
    filter: { label: 'filter', type: 'text', css: 'filter', placeholder: 'hue-rotate(90deg) saturate(1.4)' },
    padding: { label: 'padding', type: 'px', css: 'padding', min: 0, max: 24 },
    // composite: the win98 bevel is four borders, so it gets its own writers
    bevelLight: { label: 'bevel highlight', type: 'color', css: ['border-top-color', 'border-left-color'] },
    bevelDark: { label: 'bevel shadow', type: 'color', css: ['border-right-color', 'border-bottom-color'] },
    cursor: { label: 'cursor', type: 'cursor', css: 'cursor' }
};

// cursors offered in the picker. all inline svg so a theme never pulls a
// remote asset (and a theme therefore can't be used to phone home).
const THEME_CURSORS = {
    default: { name: 'windows arrow', css: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><polygon points="0,0 0,12 3,9 6,14 8,13 5,8 9,8" fill="white" stroke="black"/></svg>'), auto` },
    black: { name: 'inverted arrow', css: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><polygon points="0,0 0,12 3,9 6,14 8,13 5,8 9,8" fill="black" stroke="white"/></svg>'), auto` },
    crosshair: { name: 'crosshair', css: 'crosshair' },
    pointer: { name: 'pointing hand', css: 'pointer' },
    help: { name: 'help', css: 'help' },
    wait: { name: 'hourglass', css: 'wait' },
    grab: { name: 'grab', css: 'grab' },
    none: { name: 'invisible (evil)', css: 'none' }
};

// fonts a theme can pick. kept to families that are actually installed
// somewhere or already used by the site — no webfont loading from a theme.
const THEME_FONTS = [
    '"Comic Sans MS", "Comic Sans", cursive',
    '"MS Sans Serif", Tahoma, sans-serif',
    'Tahoma, Verdana, sans-serif',
    '"Courier New", Courier, monospace',
    'Consolas, "Lucida Console", monospace',
    'Impact, Haettenschweiler, sans-serif',
    'Georgia, "Times New Roman", serif',
    '"Trebuchet MS", sans-serif',
    'Verdana, Geneva, sans-serif',
    'system-ui, sans-serif'
];

// ---------- the node registry ----------
// group = which tab of the editor it lands in.
// sel   = the selectors this node owns. compiled rules use !important so a
//         theme reliably wins against tailwind's utility classes.
const THEME_NODES = {
    desktop: {
        label: 'desktop', group: 'desktop', sel: ['body'],
        props: ['bg', 'bgImage', 'bgSize', 'color', 'font', 'filter', 'cursor']
    },
    crt: {
        label: 'CRT overlay', group: 'desktop', sel: ['.crt-overlay'],
        props: ['opacity', 'bgImage', 'bgSize']
    },
    icons: {
        label: 'icons', group: 'desktop', sel: ['.material-symbols-outlined'],
        props: ['color', 'filter', 'size']
    },
    selection: {
        label: 'text selection', group: 'desktop', sel: ['::selection'],
        props: ['bg', 'color']
    },
    link: {
        label: 'links', group: 'desktop', sel: ['a'],
        props: ['color', 'textShadow', 'weight']
    },
    scrollThumb: {
        label: 'scrollbar thumb', group: 'desktop', sel: ['::-webkit-scrollbar-thumb'],
        props: ['bg', 'bevelLight', 'bevelDark', 'radius']
    },
    scrollTrack: {
        label: 'scrollbar track', group: 'desktop', sel: ['::-webkit-scrollbar-track', '::-webkit-scrollbar'],
        props: ['bg', 'bgImage', 'bgSize']
    },

    window: {
        label: 'window frame', group: 'windows',
        sel: ['.app-window', '.ie-window', '#main-window', '#winamp-window', '#shoutbox-window', '.retro-dialog'],
        props: ['bg', 'shadow', 'radius', 'borderColor', 'padding']
    },
    windowBody: {
        label: 'window body', group: 'windows',
        sel: ['.app-window-body', '.bg-retro-gray'],
        props: ['bg', 'bgImage', 'color', 'font', 'size']
    },
    pageContent: {
        label: 'page content panels', group: 'windows',
        // the white sheets inside the main window, the guestbook and the
        // shoutbox — tailwind paints them, so the theme has to override it
        sel: ['.bg-white'],
        props: ['bg', 'bgImage', 'color', 'font', 'size']
    },
    titleBar: {
        label: 'title bar', group: 'windows',
        sel: ['.app-window-header', '#draggable-header', '#winamp-header', '#shoutbox-header', '.retro-dialog-title', '.ie-window-header'],
        props: ['bg', 'bgImage', 'radius', 'padding']
    },
    titleText: {
        label: 'title bar text', group: 'windows',
        sel: ['.app-window-title', '.retro-dialog-title', '#draggable-header', '.ie-window-title'],
        props: ['color', 'font', 'size', 'weight', 'spacing', 'textShadow', 'transform']
    },
    browserChrome: {
        label: 'browser bars', group: 'windows',
        sel: ['.ie-address-bar', '.ie-status-bar', '.ie-address-input'],
        props: ['bg', 'color', 'font', 'size']
    },
    bevelOut: {
        label: 'raised bevel', group: 'windows', sel: ['.bevel-out'],
        props: ['bevelLight', 'bevelDark', 'borderWidth', 'borderStyle', 'shadow', 'radius']
    },
    bevelIn: {
        label: 'sunken bevel', group: 'windows', sel: ['.bevel-in'],
        props: ['bevelLight', 'bevelDark', 'borderWidth', 'borderStyle', 'radius']
    },
    dialog: {
        label: 'dialog box', group: 'windows', sel: ['.retro-dialog-body'],
        props: ['bg', 'color', 'font', 'size']
    },
    toast: {
        label: 'toast balloon', group: 'windows', sel: ['.retro-toast'],
        props: ['bg', 'color', 'font', 'size', 'radius', 'shadow']
    },

    taskbar: {
        label: 'taskbar', group: 'shell', sel: ['#taskbar'],
        props: ['bg', 'bgImage', 'color', 'borderColor', 'shadow']
    },
    taskbarBtn: {
        label: 'taskbar buttons', group: 'shell', sel: ['.taskbar-btn', '.taskbar-window-btn'],
        props: ['bg', 'color', 'radius', 'font', 'size']
    },
    clock: {
        label: 'taskbar clock', group: 'shell', sel: ['#taskbar-clock'],
        props: ['color', 'font', 'size', 'textShadow', 'weight']
    },
    startButton: {
        label: 'start button', group: 'shell', sel: ['#start-button'],
        props: ['bg', 'bgImage', 'color', 'font', 'size', 'weight', 'radius']
    },
    startMenu: {
        label: 'start menu', group: 'shell', sel: ['#start-menu', '.start-flyout'],
        props: ['bg', 'bgImage', 'borderColor', 'shadow', 'radius']
    },
    startItem: {
        label: 'start menu items', group: 'shell', sel: ['.start-item'],
        props: ['color', 'font', 'size', 'weight', 'spacing', 'transform']
    },
    startItemHover: {
        label: 'start item (hover)', group: 'shell', sel: ['.start-item:hover'],
        props: ['bg', 'color', 'bgImage']
    },

    heading: {
        label: 'headings', group: 'content', sel: ['.font-header', 'h1', 'h2', 'h3'],
        props: ['color', 'font', 'textShadow', 'spacing', 'transform']
    },
    marquee: {
        label: 'scrolling marquee', group: 'content', sel: ['.animate-marquee', '.animate-marquee span'],
        props: ['color', 'bg', 'font', 'size', 'weight', 'textShadow']
    },
    counter: {
        label: 'visitor counter', group: 'content', sel: ['#visitor-box', '#visitor-count'],
        props: ['bg', 'color', 'font', 'size', 'textShadow', 'borderColor']
    },
    winampText: {
        label: 'winamp display', group: 'content', sel: ['#winamp-text', '#winamp-time'],
        props: ['color', 'font', 'size', 'textShadow', 'bg']
    },
    tagline: {
        label: 'typed tagline', group: 'content', sel: ['#typed-tagline'],
        props: ['color', 'font', 'size', 'textShadow']
    }
};

const THEME_GROUPS = {
    desktop: 'desktop & chrome',
    windows: 'windows',
    shell: 'taskbar & start',
    content: 'content'
};

// global css variables a theme may set. anything not listed is dropped.
const THEME_VARS = {
    '--primary-color': { label: 'primary colour', type: 'color' },
    '--accent-color': { label: 'accent colour', type: 'color' },
    '--font-main': { label: 'main font', type: 'font' }
};

// ===================================================================
// events — a theme can schedule things
// ===================================================================
const THEME_TRIGGERS = {
    activate: { label: 'when the theme turns on', fields: [] },
    delay: { label: 'once, N seconds after it turns on', fields: [{ k: 'seconds', label: 'seconds', type: 'num', min: 1, max: 86400, def: 10 }] },
    interval: { label: 'every N seconds, forever', fields: [{ k: 'seconds', label: 'seconds', type: 'num', min: 5, max: 86400, def: 60 }] },
    clock: { label: 'daily at a set time', fields: [{ k: 'at', label: 'time (HH:MM)', type: 'time', def: '21:00' }] },
    between: { label: 'only between two times', fields: [{ k: 'from', label: 'from (HH:MM)', type: 'time', def: '20:00' }, { k: 'to', label: 'to (HH:MM)', type: 'time', def: '06:00' }] },
    date: { label: 'on a date every year', fields: [{ k: 'on', label: 'date (MM-DD)', type: 'date', def: '12-25' }] },
    weekday: { label: 'on a weekday', fields: [{ k: 'day', label: 'day', type: 'select', options: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'], def: 'friday' }] },
    idle: { label: 'after N seconds of no input', fields: [{ k: 'seconds', label: 'seconds', type: 'num', min: 10, max: 3600, def: 60 }] }
};

// every action a theme is allowed to perform. anything else is refused at
// validation time, so a downloaded theme can't run arbitrary code.
const THEME_ACTIONS = {
    setVar: {
        label: 'set a colour variable',
        fields: [{ k: 'name', label: 'variable', type: 'select', options: Object.keys(THEME_VARS), def: '--primary-color' }, { k: 'value', label: 'value', type: 'color', def: '#ff0000' }]
    },
    setNode: {
        label: 'restyle a node',
        fields: [{ k: 'node', label: 'node', type: 'node', def: 'desktop' }, { k: 'prop', label: 'property', type: 'prop', def: 'bg' }, { k: 'value', label: 'value', type: 'text', def: '#000000' }]
    },
    toast: {
        label: 'pop a toast balloon',
        fields: [{ k: 'title', label: 'title', type: 'text', def: 'theme.exe' }, { k: 'text', label: 'message', type: 'text', def: 'hello bradar' }]
    },
    dialog: {
        label: 'open a dialog box',
        fields: [{ k: 'title', label: 'title', type: 'text', def: 'system message' }, { k: 'text', label: 'message', type: 'text', def: 'it is late. go to sleep.' }]
    },
    marquee: {
        label: 'change the marquee text',
        fields: [{ k: 'text', label: 'text', type: 'text', def: '::: THEME TAKEOVER :::' }]
    },
    wallpaper: {
        label: 'switch the wallpaper',
        fields: [{ k: 'id', label: 'wallpaper', type: 'select', options: ['space', 'bliss', 'maze', 'clouds', 'teal', 'vapor', 'matrix'], def: 'vapor' }]
    },
    effect: {
        label: 'turn a screen effect on',
        fields: [{ k: 'id', label: 'effect', type: 'select', options: ['drunk-mode', 'upside-down', 'pixelate-mode', 'rainbow-mode', 'invert-mode', 'blur-mode', 'disco-floor', 'party-mode'], def: 'rainbow-mode' }, { k: 'seconds', label: 'for N seconds (0 = leave on)', type: 'num', min: 0, max: 600, def: 5 }]
    },
    sound: {
        label: 'play a system sound',
        fields: [{ k: 'id', label: 'sound', type: 'select', options: ['click', 'ding', 'error', 'notify', 'balloon', 'navigate', 'startup'], def: 'ding' }]
    },
    title: {
        label: 'change the browser tab title',
        fields: [{ k: 'text', label: 'title', type: 'text', def: 'you have been themed' }]
    },
    reset: { label: 'undo every event change so far', fields: [] }
};

// ===================================================================
// validation + sanitising
//
// themes arrive from three untrusted places: a .thm file someone drops in,
// the repo gallery, and localStorage. all three go through here.
// ===================================================================

// css values are written straight into a stylesheet, so anything that can
// escape the declaration or fetch a remote resource has to die here.
// no url() and no data: of any kind. a theme is colours, gradients, fonts
// from the built-in list and numbers — nothing more. that means a published
// theme can never reference an external resource, so it cannot be used to
// phone home, track who applied it, or smuggle a payload past the scanner.
// the only url() values on the page come from THEME_CURSORS, which the
// compiler substitutes by key *after* validation and which are hard-coded
// here rather than supplied by the theme.
const CSS_FORBIDDEN = [
    /<\/?\s*style/i, /<\s*script/i, /@import/i, /expression\s*\(/i, /behavio(u)?r\s*:/i,
    /-moz-binding/i, /url\s*\(/i, /\/\//, /data\s*:/i,
    /javascript\s*:/i, /vbscript\s*:/i,
    /[{};]/, /\\[0-9a-f]{2}/i, /&#/, /\/\*|\*\//
];

function themeSafeCssValue(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s || s.length > 400) return null;
    for (const re of CSS_FORBIDDEN) if (re.test(s)) return null;
    return s;
}

// a selector-shaped string, used when a theme brings raw css. we only allow
// selectors that already exist in the node registry, so raw css can restyle
// the desktop but can never reach outside it.
function themeAllowedSelectors() {
    const out = new Set();
    Object.values(THEME_NODES).forEach(n => n.sel.forEach(s => out.add(s)));
    return out;
}

function themeValidate(raw) {
    const errors = [];
    const warnings = [];
    if (!raw || typeof raw !== 'object') return { ok: false, errors: ['not a json object'], warnings, theme: null };

    const t = {
        format: THEME_FORMAT,
        id: String(raw.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40),
        name: String(raw.name || 'untitled theme').slice(0, 60),
        author: String(raw.author || 'anonymous').slice(0, 40),
        authorUrl: '',
        description: String(raw.description || '').slice(0, 240),
        created: /^\d{4}-\d{2}-\d{2}$/.test(raw.created) ? raw.created : new Date().toISOString().slice(0, 10),
        vars: {}, nodes: {}, events: [], music: null
    };
    if (!t.id) t.id = 'theme-' + Math.random().toString(36).slice(2, 8);

    // author url: http(s) only, no javascript: smuggling
    if (typeof raw.authorUrl === 'string' && /^https?:\/\/[^\s<>"']{4,200}$/i.test(raw.authorUrl.trim())) {
        t.authorUrl = raw.authorUrl.trim();
    } else if (raw.authorUrl) {
        warnings.push('author url dropped — only http(s) links are allowed');
    }

    // vars
    if (raw.vars && typeof raw.vars === 'object') {
        for (const [k, v] of Object.entries(raw.vars)) {
            if (!THEME_VARS[k]) { warnings.push(`unknown variable "${k}" dropped`); continue; }
            const safe = themeSafeCssValue(v);
            if (safe === null) { errors.push(`variable "${k}" has an unsafe value`); continue; }
            t.vars[k] = safe;
        }
    }

    // nodes
    if (raw.nodes && typeof raw.nodes === 'object') {
        for (const [nodeId, propsObj] of Object.entries(raw.nodes)) {
            const node = THEME_NODES[nodeId];
            if (!node) { warnings.push(`unknown node "${nodeId}" dropped`); continue; }
            if (!propsObj || typeof propsObj !== 'object') continue;
            const clean = {};
            for (const [propId, val] of Object.entries(propsObj)) {
                if (!node.props.includes(propId)) { warnings.push(`"${propId}" is not editable on "${nodeId}"`); continue; }
                const safe = themeSafeCssValue(val);
                if (safe === null) { errors.push(`${nodeId}.${propId} has an unsafe value`); continue; }
                clean[propId] = safe;
            }
            if (Object.keys(clean).length) t.nodes[nodeId] = clean;
        }
    }

    // events
    if (Array.isArray(raw.events)) {
        if (raw.events.length > 24) warnings.push('only the first 24 events are kept');
        raw.events.slice(0, 24).forEach((ev, i) => {
            const trig = ev && ev.trigger;
            if (!trig || !THEME_TRIGGERS[trig.type]) { warnings.push(`event ${i + 1}: unknown trigger, dropped`); return; }
            const cleanTrig = { type: trig.type };
            let trigOk = true;
            THEME_TRIGGERS[trig.type].fields.forEach(f => {
                const v = trig[f.k];
                if (f.type === 'num') {
                    const n = Number(v);
                    if (!isFinite(n) || n < f.min || n > f.max) { warnings.push(`event ${i + 1}: ${f.k} out of range, dropped`); trigOk = false; return; }
                    cleanTrig[f.k] = Math.round(n);
                } else if (f.type === 'time') {
                    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) { warnings.push(`event ${i + 1}: bad time, dropped`); trigOk = false; return; }
                    cleanTrig[f.k] = v;
                } else if (f.type === 'date') {
                    if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) { warnings.push(`event ${i + 1}: bad date, dropped`); trigOk = false; return; }
                    cleanTrig[f.k] = v;
                } else if (f.type === 'select') {
                    if (!f.options.includes(v)) { warnings.push(`event ${i + 1}: bad ${f.k}, dropped`); trigOk = false; return; }
                    cleanTrig[f.k] = v;
                }
            });
            if (!trigOk) return;

            const actions = [];
            (Array.isArray(ev.actions) ? ev.actions : []).slice(0, 8).forEach(a => {
                const spec = a && THEME_ACTIONS[a.type];
                if (!spec) { warnings.push(`event ${i + 1}: unknown action dropped`); return; }
                const clean = { type: a.type };
                let ok = true;
                spec.fields.forEach(f => {
                    let v = a[f.k];
                    if (f.type === 'num') {
                        const n = Number(v);
                        if (!isFinite(n) || n < f.min || n > f.max) { ok = false; return; }
                        clean[f.k] = Math.round(n);
                    } else if (f.type === 'select') {
                        if (!f.options.includes(v)) { ok = false; return; }
                        clean[f.k] = v;
                    } else if (f.type === 'node') {
                        if (!THEME_NODES[v]) { ok = false; return; }
                        clean[f.k] = v;
                    } else if (f.type === 'prop') {
                        if (!THEME_PROPS[v]) { ok = false; return; }
                        clean[f.k] = v;
                    } else {
                        const safe = themeSafeCssValue(String(v == null ? '' : v));
                        if (safe === null) { ok = false; return; }
                        clean[f.k] = safe.slice(0, 160);
                    }
                });
                // setNode must name a property the node actually exposes
                if (ok && clean.type === 'setNode' && !THEME_NODES[clean.node].props.includes(clean.prop)) ok = false;
                if (ok) actions.push(clean); else warnings.push(`event ${i + 1}: an action had bad values and was dropped`);
            });
            if (!actions.length) { warnings.push(`event ${i + 1}: no valid actions, dropped`); return; }
            t.events.push({ id: 'ev' + (i + 1), name: String(ev.name || '').slice(0, 60), trigger: cleanTrig, actions });
        });
    }

    // music metadata (the audio file itself is verified separately by the scanner)
    if (raw.music && typeof raw.music === 'object') {
        const m = raw.music;
        const filename = String(m.filename || '').slice(0, 160);
        const badName = !filename || /[\\/]|\.\./.test(filename) || !/\.(mp3|ogg|wav|m4a|flac)$/i.test(filename);
        if (badName) {
            warnings.push('music entry dropped — filename must be a bare audio file name');
        } else if (!/^[a-f0-9]{64}$/i.test(String(m.sha256 || ''))) {
            warnings.push('music entry dropped — missing or malformed sha256');
        } else {
            t.music = {
                filename,
                title: String(m.title || 'untitled').slice(0, 80),
                artist: String(m.artist || 'unknown').slice(0, 80),
                sha256: String(m.sha256).toLowerCase(),
                bytes: Number(m.bytes) || 0,
                duration: Number(m.duration) || 0,
                memes: Array.isArray(m.memes) ? m.memes.slice(0, 40).map(s => String(s).slice(0, 200)) : []
            };
        }
    }

    if (!Object.keys(t.nodes).length && !Object.keys(t.vars).length && !t.events.length && !t.music) {
        errors.push('this theme does not change anything');
    }
    return { ok: errors.length === 0, errors, warnings, theme: errors.length ? null : t };
}

// ===================================================================
// compiling a theme into css
// ===================================================================
function themeCompile(theme) {
    const out = [];
    const vars = Object.entries(theme.vars || {});
    if (vars.length) out.push(`:root{${vars.map(([k, v]) => `${k}:${v} !important;`).join('')}}`);

    for (const [nodeId, props] of Object.entries(theme.nodes || {})) {
        const node = THEME_NODES[nodeId];
        if (!node) continue;
        const decls = [];
        for (const [propId, value] of Object.entries(props)) {
            const spec = THEME_PROPS[propId];
            if (!spec) continue;
            let v = value;
            if (propId === 'cursor') v = (THEME_CURSORS[value] || {}).css || value;
            if (spec.type === 'px' && /^-?\d+(\.\d+)?$/.test(v)) v += 'px';
            const cssProps = Array.isArray(spec.css) ? spec.css : [spec.css];
            cssProps.forEach(p => decls.push(`${p}:${v} !important`));
        }
        if (decls.length) out.push(`${node.sel.join(',')}{${decls.join(';')}}`);
    }
    return out.join('\n');
}

// ===================================================================
// applying / clearing
// ===================================================================
let themeActive = null;          // the theme object currently applied
let themeEventTimers = [];       // every timer the event engine owns
let themeEventStyleEl = null;    // a second sheet events write into, so a
                                 // "reset" action can wipe them in one go
let themeIdleHandler = null;

function themeStyleEl(id) {
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('style');
        el.id = id;
        document.head.appendChild(el);
    }
    return el;
}

function themeApply(theme, opts = {}) {
    const res = themeValidate(theme);
    if (!res.ok) {
        console.warn('theme rejected:', res.errors);
        return res;
    }
    themeClear({ keepActive: true });
    themeActive = res.theme;
    themeStyleEl('theme-sheet').textContent = themeCompile(res.theme);
    document.body.classList.add('themed');
    if (!opts.preview) {
        localStorage.setItem(THEME_KEY_ACTIVE, res.theme.id);
        themeStartEvents(res.theme);
        themeSyncMusic(res.theme);
    }
    return res;
}

function themeClear(opts = {}) {
    themeStopEvents();
    const sheet = document.getElementById('theme-sheet');
    if (sheet) sheet.textContent = '';
    if (themeEventStyleEl) themeEventStyleEl.textContent = '';
    document.body.classList.remove('themed');
    if (!opts.keepActive) {
        if (themeActive) themeUnsyncMusic(themeActive);
        themeActive = null;
        localStorage.removeItem(THEME_KEY_ACTIVE);
    }
}

// ===================================================================
// the event engine
// ===================================================================
function themeStopEvents() {
    themeEventTimers.forEach(t => { clearInterval(t); clearTimeout(t); });
    themeEventTimers = [];
    if (themeIdleHandler) {
        ['mousemove', 'keydown', 'pointerdown', 'wheel'].forEach(e => document.removeEventListener(e, themeIdleHandler));
        themeIdleHandler = null;
    }
}

function themeStartEvents(theme) {
    themeStopEvents();
    themeEventStyleEl = themeStyleEl('theme-events-sheet');
    if (!theme.events || !theme.events.length) return;

    theme.events.forEach(ev => {
        const run = () => themeRunActions(ev.actions, ev);
        const trig = ev.trigger;

        if (trig.type === 'activate') {
            themeEventTimers.push(setTimeout(run, 60));

        } else if (trig.type === 'delay') {
            themeEventTimers.push(setTimeout(run, trig.seconds * 1000));

        } else if (trig.type === 'interval') {
            themeEventTimers.push(setInterval(run, trig.seconds * 1000));

        } else if (trig.type === 'clock') {
            // fire at the next occurrence, then every 24h
            const schedule = () => {
                const [h, m] = trig.at.split(':').map(Number);
                const now = new Date();
                const next = new Date(now);
                next.setHours(h, m, 0, 0);
                if (next <= now) next.setDate(next.getDate() + 1);
                themeEventTimers.push(setTimeout(() => { run(); schedule(); }, next - now));
            };
            schedule();

        } else if (trig.type === 'between') {
            // a window rather than an instant: run the actions on entry, and
            // undo them on exit, checked once a minute
            let inside = null;
            const check = () => {
                const now = new Date();
                const mins = now.getHours() * 60 + now.getMinutes();
                const [fh, fm] = trig.from.split(':').map(Number);
                const [th, tm] = trig.to.split(':').map(Number);
                const from = fh * 60 + fm, to = th * 60 + tm;
                // a window that ends before it starts wraps past midnight
                const now_in = from <= to ? (mins >= from && mins < to) : (mins >= from || mins < to);
                if (now_in !== inside) {
                    inside = now_in;
                    if (now_in) run(); else themeRunActions([{ type: 'reset' }], ev);
                }
            };
            check();
            themeEventTimers.push(setInterval(check, 30000));

        } else if (trig.type === 'date') {
            const check = () => {
                const now = new Date();
                const md = String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
                if (md === trig.on) run();
            };
            check();
            themeEventTimers.push(setInterval(check, 3600000));

        } else if (trig.type === 'weekday') {
            const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const check = () => { if (days[new Date().getDay()] === trig.day) run(); };
            check();
            themeEventTimers.push(setInterval(check, 3600000));

        } else if (trig.type === 'idle') {
            let timer = null;
            const arm = () => {
                clearTimeout(timer);
                timer = setTimeout(run, trig.seconds * 1000);
                themeEventTimers.push(timer);
            };
            themeIdleHandler = arm;
            ['mousemove', 'keydown', 'pointerdown', 'wheel'].forEach(e => document.addEventListener(e, arm, { passive: true }));
            arm();
        }
    });
}

// event-driven css lives in its own sheet keyed by selector so repeated
// fires overwrite instead of piling up thousands of rules
const themeEventCss = new Map();
function themeWriteEventCss(selector, prop, value) {
    const cur = themeEventCss.get(selector) || {};
    cur[prop] = value;
    themeEventCss.set(selector, cur);
    themeEventStyleEl.textContent = [...themeEventCss.entries()]
        .map(([sel, decls]) => `${sel}{${Object.entries(decls).map(([p, v]) => `${p}:${v} !important`).join(';')}}`)
        .join('\n');
}

function themeRunActions(actions, ev) {
    actions.forEach(a => {
        try {
            switch (a.type) {
                case 'setVar':
                    themeWriteEventCss(':root', a.name, a.value);
                    break;
                case 'setNode': {
                    const node = THEME_NODES[a.node], spec = THEME_PROPS[a.prop];
                    if (!node || !spec) break;
                    let v = a.value;
                    if (a.prop === 'cursor') v = (THEME_CURSORS[v] || {}).css || v;
                    if (spec.type === 'px' && /^-?\d+(\.\d+)?$/.test(v)) v += 'px';
                    (Array.isArray(spec.css) ? spec.css : [spec.css]).forEach(p =>
                        themeWriteEventCss(node.sel.join(','), p, v));
                    break;
                }
                case 'toast':
                    if (typeof showToast === 'function') showToast(a.title, a.text);
                    break;
                case 'dialog':
                    if (typeof showRetroDialog === 'function') {
                        showRetroDialog({ title: a.title, lines: [a.text], okLabel: 'ok', cancelLabel: null, onOk: () => { } });
                    }
                    break;
                case 'marquee': {
                    const el = document.querySelector('.animate-marquee span');
                    if (el) el.textContent = a.text;
                    break;
                }
                case 'wallpaper':
                    if (typeof applyWallpaper === 'function') applyWallpaper(a.id);
                    break;
                case 'effect':
                    document.body.classList.add(a.id);
                    if (a.seconds > 0) {
                        themeEventTimers.push(setTimeout(() => document.body.classList.remove(a.id), a.seconds * 1000));
                    }
                    break;
                case 'sound':
                    if (typeof playSound === 'function') playSound(a.id);
                    break;
                case 'title':
                    document.title = a.text;
                    break;
                case 'reset':
                    themeEventCss.clear();
                    if (themeEventStyleEl) themeEventStyleEl.textContent = '';
                    ['drunk-mode', 'upside-down', 'pixelate-mode', 'rainbow-mode', 'invert-mode', 'blur-mode', 'disco-floor', 'party-mode']
                        .forEach(c => document.body.classList.remove(c));
                    break;
            }
        } catch (e) {
            console.warn('theme event action failed', ev && ev.id, a.type, e);
        }
    });
}

// ===================================================================
// theme storage — installed themes live in localStorage, their audio
// blobs (for themes not yet published) live in indexeddb
// ===================================================================
function themeInstalled() {
    try {
        const raw = JSON.parse(localStorage.getItem(THEME_KEY_INSTALLED) || '[]');
        return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
}

function themeSaveInstalled(list) {
    localStorage.setItem(THEME_KEY_INSTALLED, JSON.stringify(list.slice(0, 60)));
}

function themeInstall(theme) {
    const res = themeValidate(theme);
    if (!res.ok) return res;
    const list = themeInstalled().filter(t => t.id !== res.theme.id);
    list.unshift(res.theme);
    themeSaveInstalled(list);
    return res;
}

function themeUninstall(id) {
    themeSaveInstalled(themeInstalled().filter(t => t.id !== id));
    themeAudioDelete(id).catch(() => { });
    if (themeActive && themeActive.id === id) themeClear();
}

function themeById(id) {
    return themeInstalled().find(t => t.id === id) || THEME_PRESETS.find(t => t.id === id) || null;
}

// ---------- indexeddb for local audio ----------
const THEME_DB = 'mrhakan-themes';
function themeDbOpen() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('no indexeddb'));
        const req = indexedDB.open(THEME_DB, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('audio')) req.result.createObjectStore('audio'); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function themeAudioPut(id, blob) {
    return themeDbOpen().then(db => new Promise((res, rej) => {
        const tx = db.transaction('audio', 'readwrite');
        tx.objectStore('audio').put(blob, id);
        tx.oncomplete = () => res(true);
        tx.onerror = () => rej(tx.error);
    }));
}
function themeAudioGet(id) {
    return themeDbOpen().then(db => new Promise((res, rej) => {
        const tx = db.transaction('audio', 'readonly');
        const r = tx.objectStore('audio').get(id);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => rej(r.error);
    }));
}
function themeAudioDelete(id) {
    return themeDbOpen().then(db => new Promise((res) => {
        const tx = db.transaction('audio', 'readwrite');
        tx.objectStore('audio').delete(id);
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
    }));
}

// ===================================================================
// winamp integration — an active theme's track joins the playlist
// ===================================================================
function themeTrackId(themeId) { return `theme:${themeId}`; }

async function themeSyncMusic(theme) {
    if (typeof tracks === 'undefined' || !Array.isArray(tracks)) return;
    if (!theme.music) { themeUnsyncMusic(theme, true); return; }

    // a published theme's file sits in src/music. a theme that is still
    // local plays from the blob the author attached, out of indexeddb.
    let url = `src/music/${theme.music.filename}`;
    try {
        const blob = await themeAudioGet(theme.id);
        if (blob) url = URL.createObjectURL(blob);
    } catch (e) { /* published themes have no local blob, that's fine */ }

    // dedupe *after* the await, not before. at boot two syncs run at once —
    // one restoring the saved theme, one reacting to music.json landing — and
    // clearing the old entry before awaiting lets both of them append a copy.
    const wasPresent = tracks.some(t => t.id === themeTrackId(theme.id));
    themeUnsyncMusic(theme, true);

    tracks.push({
        id: themeTrackId(theme.id),
        _theme: theme.id,
        url,
        title: theme.music.title,
        artist: theme.music.artist,
        theme: { primaryColor: theme.vars['--primary-color'] || '#0df259', accentColor: theme.vars['--accent-color'] || '#000000', fontStyle: 'inherit' },
        memes: theme.music.memes && theme.music.memes.length ? theme.music.memes : [`added by the "${theme.name}" theme`]
    });
    if (typeof initPlaylist === 'function') initPlaylist();
    // only announce it the first time, so the boot-time re-sync stays silent
    if (!wasPresent && typeof showToast === 'function') showToast('winamp', `"${theme.music.title}" added to the playlist`);
}

// the winamp playlist is fetched asynchronously and *replaces* the tracks
// array wholesale, so a theme applied at boot would have its track thrown
// away a moment later. index.js calls this once the fetch lands.
function themeOnTracksLoaded() {
    if (themeActive && themeActive.music) themeSyncMusic(themeActive);
}

function themeUnsyncMusic(theme, quiet) {
    if (typeof tracks === 'undefined' || !Array.isArray(tracks)) return;
    const id = themeTrackId(theme.id);
    const before = tracks.length;
    for (let i = tracks.length - 1; i >= 0; i--) {
        if (tracks[i].id === id) {
            if (typeof tracks[i].url === 'string' && tracks[i].url.startsWith('blob:')) URL.revokeObjectURL(tracks[i].url);
            tracks.splice(i, 1);
        }
    }
    if (before !== tracks.length && typeof initPlaylist === 'function' && !quiet) initPlaylist();
}

// ===================================================================
// the gallery — themes published to the repo, same pull-request flow the
// guestbook uses
// ===================================================================
async function themeFetchGallery() {
    const repo = (typeof GH_REPO !== 'undefined' && GH_REPO) || 'MrHakan/mrhakan.github.io';
    const branch = (typeof GH_BRANCH !== 'undefined' && GH_BRANCH) || 'main';
    const cacheKey = 'theme-gallery-cache';
    try {
        const res = await fetch(`https://api.github.com/repos/${repo}/contents/data/themes?ref=${branch}`);
        const files = await res.json();
        if (!Array.isArray(files)) throw new Error((files && files.message) || 'unexpected response');
        const jsons = files.filter(f => f.name.endsWith('.json') && f.name !== 'index.json').slice(0, 40);
        const loaded = await Promise.all(jsons.map(f => fetch(f.download_url).then(r => r.json()).catch(() => null)));
        const valid = loaded.map(t => themeValidate(t)).filter(r => r.ok).map(r => r.theme);
        localStorage.setItem(cacheKey, JSON.stringify(valid));
        return valid;
    } catch (e) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) { try { return JSON.parse(cached); } catch (_) { } }
        throw e;
    }
}

// ===================================================================
// presets — the themes that ship with the site, and the starting point
// for anyone who opens the maker
// ===================================================================
const THEME_PRESETS = [
    {
        format: THEME_FORMAT, id: 'classic98', name: 'classic 98', author: 'mrhakan',
        description: 'the factory default, in case you break something.',
        vars: { '--primary-color': '#0df259', '--accent-color': '#000000' },
        nodes: {}, events: []
    },
    {
        format: THEME_FORMAT, id: 'hotdog', name: 'hot dog stand', author: 'microsoft (1992)',
        description: 'the legendary windows 3.1 accessibility scheme that nobody could look at for more than a minute.',
        vars: { '--primary-color': '#ffff00', '--accent-color': '#ff0000' },
        nodes: {
            desktop: { bg: '#ff0000', bgImage: 'none', color: '#000000' },
            window: { bg: '#ffff00', shadow: '6px 6px 0 rgba(0,0,0,.6)' },
            windowBody: { bg: '#ffff00', color: '#000000' },
            titleBar: { bg: '#000000', bgImage: 'none' },
            titleText: { color: '#ffff00', transform: 'uppercase' },
            taskbar: { bg: '#ffff00' },
            taskbarBtn: { bg: '#ff0000', color: '#ffffff' },
            startButton: { bg: '#000000', color: '#ffff00' },
            startMenu: { bg: '#ffff00' },
            startItem: { color: '#000000' },
            startItemHover: { bg: '#ff0000', color: '#ffffff' },
            bevelOut: { bevelLight: '#ffffff', bevelDark: '#800000' },
            heading: { color: '#000000' },
            counter: { bg: '#000000', color: '#ffff00' }
        },
        events: []
    },
    {
        format: THEME_FORMAT, id: 'terminal', name: 'green phosphor', author: 'mrhakan',
        description: 'one colour, one font, no mercy. the marquee flickers every half minute.',
        vars: { '--primary-color': '#33ff66', '--accent-color': '#0a3d1a', '--font-main': '"Courier New", Courier, monospace' },
        nodes: {
            desktop: { bg: '#020a04', bgImage: 'none', color: '#33ff66', font: '"Courier New", Courier, monospace' },
            window: { bg: '#041206', shadow: '0 0 24px rgba(51,255,102,.25)' },
            windowBody: { bg: '#041206', color: '#33ff66', font: '"Courier New", Courier, monospace' },
            titleBar: { bg: '#0a3d1a', bgImage: 'none' },
            titleText: { color: '#7dffa8', font: '"Courier New", Courier, monospace', transform: 'uppercase', spacing: '1' },
            taskbar: { bg: '#041206', color: '#33ff66' },
            taskbarBtn: { bg: '#0a3d1a', color: '#33ff66' },
            startButton: { bg: '#0a3d1a', color: '#33ff66', font: '"Courier New", Courier, monospace' },
            startMenu: { bg: '#041206' },
            startItem: { color: '#33ff66', font: '"Courier New", Courier, monospace' },
            startItemHover: { bg: '#33ff66', color: '#020a04' },
            bevelOut: { bevelLight: '#1f7a3c', bevelDark: '#020a04' },
            bevelIn: { bevelLight: '#020a04', bevelDark: '#1f7a3c' },
            heading: { color: '#7dffa8', textShadow: '0 0 8px rgba(51,255,102,.7)' },
            marquee: { color: '#33ff66', textShadow: '0 0 6px rgba(51,255,102,.8)' },
            counter: { bg: '#020a04', color: '#33ff66', textShadow: '0 0 8px #33ff66' },
            link: { color: '#7dffa8' },
            selection: { bg: '#33ff66', color: '#020a04' },
            icons: { color: '#33ff66' },
            crt: { opacity: '0.55' }
        },
        events: [
            { id: 'ev1', name: 'phosphor flicker', trigger: { type: 'interval', seconds: 30 }, actions: [{ type: 'effect', id: 'blur-mode', seconds: 1 }] }
        ]
    },
    {
        format: THEME_FORMAT, id: 'afterdark', name: 'after dark', author: 'mrhakan',
        description: 'a bright desktop that flips to a dim one between 20:00 and 06:00, all on its own.',
        vars: { '--primary-color': '#7aa2f7', '--accent-color': '#1a1b26' },
        nodes: {
            desktop: { bg: '#c8d3f5', bgImage: 'none', color: '#1a1b26' },
            window: { bg: '#e2e7ff' },
            windowBody: { bg: '#e2e7ff', color: '#1a1b26' },
            titleBar: { bgImage: 'linear-gradient(to right, #3d59a1, #7aa2f7)' },
            taskbar: { bg: '#d5ddf7' },
            startMenu: { bg: '#e2e7ff' }
        },
        events: [
            {
                id: 'ev1', name: 'night mode', trigger: { type: 'between', from: '20:00', to: '06:00' },
                actions: [
                    { type: 'setNode', node: 'desktop', prop: 'bg', value: '#12131c' },
                    { type: 'setNode', node: 'desktop', prop: 'color', value: '#c8d3f5' },
                    { type: 'setNode', node: 'window', prop: 'bg', value: '#1a1b26' },
                    { type: 'setNode', node: 'windowBody', prop: 'bg', value: '#1a1b26' },
                    { type: 'setNode', node: 'windowBody', prop: 'color', value: '#c8d3f5' },
                    { type: 'setNode', node: 'taskbar', prop: 'bg', value: '#16161e' },
                    { type: 'setNode', node: 'startMenu', prop: 'bg', value: '#1a1b26' },
                    { type: 'toast', title: 'after dark', text: 'sun is down. dimming the desktop.' }
                ]
            }
        ]
    },
    {
        format: THEME_FORMAT, id: 'bubblegum', name: 'bubblegum crisis', author: 'mrhakan',
        description: 'pink, rounded, and it says something to you every couple of minutes whether you asked or not.',
        vars: { '--primary-color': '#ff71ce', '--accent-color': '#01cdfe' },
        nodes: {
            desktop: { bgImage: 'linear-gradient(160deg, #2b1055, #7597de)', bg: '#2b1055', color: '#fff0fb' },
            window: { bg: '#ffd6f5', radius: '10', shadow: '0 8px 0 rgba(255,113,206,.4)' },
            windowBody: { bg: '#ffd6f5', color: '#4a1942' },
            titleBar: { bgImage: 'linear-gradient(to right, #ff71ce, #01cdfe)', radius: '8' },
            titleText: { color: '#ffffff', textShadow: '1px 1px 0 rgba(0,0,0,.35)' },
            taskbar: { bgImage: 'linear-gradient(to right, #ff71ce, #01cdfe)' },
            taskbarBtn: { bg: '#ffd6f5', radius: '8' },
            startButton: { bg: '#ffffff', color: '#ff2bb0', radius: '8' },
            startMenu: { bg: '#ffd6f5', radius: '10' },
            startItem: { color: '#4a1942' },
            startItemHover: { bg: '#ff71ce', color: '#ffffff' },
            bevelOut: { bevelLight: '#ffffff', bevelDark: '#ff71ce', radius: '8' },
            heading: { color: '#ff71ce', textShadow: '2px 2px 0 #01cdfe' },
            counter: { bg: '#2b1055', color: '#ff71ce', textShadow: '0 0 10px #ff71ce' },
            selection: { bg: '#ff71ce', color: '#ffffff' }
        },
        events: [
            { id: 'ev1', name: 'hello', trigger: { type: 'activate' }, actions: [{ type: 'toast', title: 'bubblegum crisis', text: 'welcome to the pink zone bradar' }, { type: 'sound', id: 'ding' }] },
            { id: 'ev2', name: 'nagging', trigger: { type: 'interval', seconds: 120 }, actions: [{ type: 'toast', title: 'bubblegum crisis', text: 'still pink. still crisp.' }] },
            { id: 'ev3', name: 'idle disco', trigger: { type: 'idle', seconds: 90 }, actions: [{ type: 'effect', id: 'disco-floor', seconds: 8 }] }
        ]
    }
];

// ===================================================================
// boot — restore whatever was active last time
// ===================================================================
function themeInit() {
    const id = localStorage.getItem(THEME_KEY_ACTIVE);
    if (!id) return;
    const t = themeById(id);
    if (t) themeApply(t);
    else localStorage.removeItem(THEME_KEY_ACTIVE);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', themeInit);
    else themeInit();
}

// node/test access
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { THEME_NODES, THEME_PROPS, THEME_TRIGGERS, THEME_ACTIONS, THEME_PRESETS, themeValidate, themeCompile, themeSafeCssValue };
}
