// ===================================================================
// toys.js — the rest of the furniture
//
// Two kinds of thing, both from the same era.
//
// The first is what a personal site had on it in 1999 and mostly does
// not now: a pet you adopted and had to feed, a cat that chased your
// cursor, blinkies, stamps, a directory, awards it gave itself. The
// field guide at yahew.com calls most of these extinct, which they are.
//
// The second is what Windows did to you: a disk scan that found a bad
// cluster, a setup wizard whose estimate was a lie, a virus scanner
// that found exactly what it had planted. Jokes, but accurate ones.
//
// Nothing here talks to a server. The pet, the awards and the ratings
// all live in localStorage, which means they are yours and they are
// gone when you clear your browser, which is also how it was.
// ===================================================================

// ===================================================================
// the pet you adopt
// ===================================================================
const PET_KEY = 'mrhakan.pet';
const PET_KINDS = [
    { id: 'blob', name: 'blob', face: ['( ˘ ³˘)', '( ˘ω˘ )', '( ・_・)', '(x_x)'] },
    { id: 'cat', name: 'cat', face: ['(=^･ω･^=)', '(=｀ω´=)', '(=；ｪ；=)', '(=xエx=)'] },
    { id: 'troll', name: 'troll', face: ['( ͡° ͜ʖ ͡°)', '(◣_◢)', '(╥﹏╥)', '(✖╭╮✖)'] },
    { id: 'ghost', name: 'ghost', face: ['(∩｀-´)⊃', '( ⚆ _ ⚆ )', '( ˘︹˘ )', '( ✖﹏✖ )'] }
];

function petLoad() {
    try {
        const p = JSON.parse(localStorage.getItem(PET_KEY) || 'null');
        return p && p.kind ? p : null;
    } catch (e) { return null; }
}
function petSave(p) { try { localStorage.setItem(PET_KEY, JSON.stringify(p)); } catch (e) { } }

// Hunger is not a ticking timer that runs while the window is open — it
// is worked out from the clock, which is the only way a pet can still
// be hungry when you come back tomorrow. One point every three hours.
function petState(p) {
    const hours = (Date.now() - (p.fed || Date.now())) / 3600000;
    const hunger = Math.min(4, Math.floor(hours / 3));
    const age = Math.floor((Date.now() - (p.born || Date.now())) / 86400000);
    return { hunger, age, dead: hunger >= 4 };
}

function openPet() {
    const { body, win } = createAppWindow('adopt.exe', { icon: 'favorite', width: 260 });
    body.classList.add('toy-body');
    let timer;

    function adoptScreen() {
        body.innerHTML = `
            <div class="toy-h">adopt something</div>
            <p class="toy-p">it will be hungry in three hours whether this page is open or not.</p>
            <div class="pet-pick">${PET_KINDS.map(k =>
            `<button class="bevel-out pet-choice" data-k="${k.id}">
                    <span class="pet-face">${k.face[0]}</span><span>${k.name}</span></button>`).join('')}</div>`;
        body.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
            const name = prompt('name it', b.dataset.k) || b.dataset.k;
            petSave({ kind: b.dataset.k, name: name.slice(0, 16), born: Date.now(), fed: Date.now(), pats: 0 });
            playSound('ding');
            unlockAchievement('adopted');
            render();
        });
    }

    function render() {
        const p = petLoad();
        if (!p) return adoptScreen();
        const kind = PET_KINDS.find(k => k.id === p.kind) || PET_KINDS[0];
        const st = petState(p);
        const mood = ['fine', 'peckish', 'hungry', 'miserable', 'gone'][Math.min(4, st.hunger)];
        body.innerHTML = `
            <div class="pet-stage${st.dead ? ' dead' : ''}">
                <div class="pet-big" data-face>${kind.face[Math.min(3, st.hunger)]}</div>
                <div class="pet-name">${escapeHtml(p.name)}</div>
            </div>
            <div class="pet-stats">
                <div>age <b>${st.age}</b> day${st.age === 1 ? '' : 's'}</div>
                <div>mood <b>${mood}</b></div>
                <div>pats <b>${p.pats || 0}</b></div>
            </div>
            <div class="pet-bar bevel-in"><i style="width:${Math.max(0, 100 - st.hunger * 25)}%"></i></div>
            <div class="pet-acts">
                <button class="bevel-out arc-btn" data-feed${st.dead ? ' disabled' : ''}>feed</button>
                <button class="bevel-out arc-btn" data-pat${st.dead ? ' disabled' : ''}>pat</button>
                <button class="bevel-out arc-btn" data-release>release</button>
            </div>
            ${st.dead ? '<p class="toy-p">it left. that is what happens. you can adopt another.</p>' : ''}`;

        body.querySelector('[data-feed]')?.addEventListener('click', () => {
            p.fed = Date.now(); petSave(p); playSound('ding');
            showToast('adopt', p.name + ' ate.');
            render();
        });
        body.querySelector('[data-pat]')?.addEventListener('click', () => {
            p.pats = (p.pats || 0) + 1; petSave(p);
            const face = body.querySelector('[data-face]');
            if (face && window.FX) FX.animate(face, [{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260 });
            if ((p.pats % 50) === 0) unlockAchievement('petted');
            body.querySelector('.pet-stats b:last-of-type');
            render();
        });
        body.querySelector('[data-release]').onclick = () => {
            showRetroDialog({
                title: 'release',
                lines: ['let ' + p.name + ' go?', 'this cannot be undone.'],
                okLabel: 'let go', cancelLabel: 'keep',
                onOk: () => { try { localStorage.removeItem(PET_KEY); } catch (e) { } render(); }
            });
        };
    }
    render();
    timer = setInterval(render, 60000);          // the clock moves on its own
    win._cleanup = () => clearInterval(timer);
}

// ===================================================================
// oneko — the cat that chases the cursor
// ===================================================================
// The 1989 X11 toy, and then a fixture on half the web revival. Drawn
// rather than sprited, because the sprite sheet is somebody else's art
// and this file has no business shipping it.
let nekoOn = false, nekoEl = null, nekoRaf = 0;
function toggleNeko() {
    if (nekoOn) {
        nekoOn = false;
        cancelAnimationFrame(nekoRaf);
        if (nekoEl) { nekoEl.remove(); nekoEl = null; }
        showToast('oneko', 'the cat went home');
        return;
    }
    nekoOn = true;
    nekoEl = document.createElement('div');
    nekoEl.className = 'neko';
    nekoEl.setAttribute('aria-hidden', 'true');
    nekoEl.textContent = '🐈';
    document.body.appendChild(nekoEl);
    unlockAchievement('neko');
    showToast('oneko', 'a cat is following your cursor now');

    let x = window.innerWidth / 2, y = window.innerHeight / 2;
    let tx = x, ty = y, still = 0;
    const move = (e) => { tx = e.clientX; ty = e.clientY; };
    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', (e) => {
        if (e.touches[0]) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }
    }, { passive: true });

    const step = () => {
        if (!nekoOn) { document.removeEventListener('mousemove', move); return; }
        const dx = tx - x, dy = ty - y;
        const d = Math.hypot(dx, dy);
        // it stops short, the way the real one does — a cat that lands
        // exactly on the pointer looks like a bug rather than a cat
        if (d > 34) {
            const speed = Math.min(9, 2 + d / 26);
            x += (dx / d) * speed;
            y += (dy / d) * speed;
            still = 0;
            nekoEl.classList.remove('asleep');
            nekoEl.textContent = '🐈';
            nekoEl.style.transform = 'translate(-50%,-50%) scaleX(' + (dx < 0 ? -1 : 1) + ')';
        } else if (++still > 180) {
            nekoEl.classList.add('asleep');
            nekoEl.textContent = '🐈‍⬛';
        }
        nekoEl.style.left = x + 'px';
        nekoEl.style.top = y + 'px';
        nekoRaf = requestAnimationFrame(step);
    };
    step();
}

// ===================================================================
// the blinkie maker
// ===================================================================
// 150x20, three colours, two frames. It is drawn on a canvas and comes
// out as a png you can put on your own site, which is the entire point
// of a blinkie.
const BLINKIE_STYLES = [
    { name: 'classic', bg: '#000080', fg: '#ffffff', edge: '#00ff00' },
    { name: 'hot pink', bg: '#ff00a0', fg: '#ffffff', edge: '#ffff00' },
    { name: 'toxic', bg: '#000000', fg: '#0df259', edge: '#0df259' },
    { name: 'sunset', bg: '#4b0082', fg: '#ffcc00', edge: '#ff4500' },
    { name: 'grey plastic', bg: '#c0c0c0', fg: '#000000', edge: '#808080' },
    { name: 'bsod', bg: '#0000aa', fg: '#ffffff', edge: '#ffffff' }
];

function openBlinkieMaker() {
    const { body, win } = createAppWindow('blinkie maker', { icon: 'photo_camera', width: 300 });
    body.classList.add('toy-body');
    body.innerHTML = `
        <div class="toy-h">blinkie maker</div>
        <p class="toy-p">150 by 20, three colours, two frames. the format has not changed since 2001.</p>
        <div class="blink-preview bevel-in"><canvas width="150" height="20" data-cv></canvas></div>
        <label class="toy-field">text
            <input class="bevel-in" data-text maxlength="28" value="best viewed in netscape">
        </label>
        <label class="toy-field">style
            <select class="bevel-in" data-style>
                ${BLINKIE_STYLES.map((s, i) => `<option value="${i}">${s.name}</option>`).join('')}
            </select>
        </label>
        <div class="toy-acts">
            <button class="bevel-out arc-btn" data-save>save png</button>
            <button class="bevel-out arc-btn" data-shelf>the shelf</button>
        </div>`;

    const cv = body.querySelector('[data-cv]'), ctx = cv.getContext('2d');
    const textEl = body.querySelector('[data-text]'), styleEl = body.querySelector('[data-style]');
    let frame = 0, timer;

    function paint() {
        const s = BLINKIE_STYLES[+styleEl.value] || BLINKIE_STYLES[0];
        ctx.fillStyle = s.bg; ctx.fillRect(0, 0, 150, 20);
        // the blinking border is the whole genre
        ctx.strokeStyle = frame ? s.edge : s.fg;
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, 148, 18);
        ctx.fillStyle = frame ? s.fg : s.edge;
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((textEl.value || '').slice(0, 28), 75, 11);
    }
    timer = setInterval(() => { frame ^= 1; paint(); }, 420);
    textEl.addEventListener('input', paint);
    textEl.addEventListener('keydown', e => e.stopPropagation());
    styleEl.addEventListener('change', paint);
    paint();

    body.querySelector('[data-save]').onclick = () => {
        cv.toBlob(b => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = 'blinkie.png';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        });
        unlockAchievement('blinkie');
    };
    body.querySelector('[data-shelf]').onclick = () => openStampShelf();
    win._cleanup = () => clearInterval(timer);
}

// ===================================================================
// the stamp shelf
// ===================================================================
// 99x56 with a torn border, saying what the webmaster is into. Drawn
// here rather than collected, so nothing is hotlinked off a dead host.
const STAMPS = [
    ['no build step', '#0df259', '#000'],
    ['view source', '#fff', '#000080'],
    ['rss enjoyer', '#ff7f00', '#000'],
    ['i miss winamp', '#29293d', '#0df259'],
    ['keyboard first', '#c0c0c0', '#000'],
    ['tabs, not spaces', '#000', '#ff0'],
    ['dial-up survivor', '#4b0082', '#fff'],
    ['anti-cookie-banner', '#c40000', '#fff'],
    ['made in notepad', '#fff', '#c00'],
    ['800x600 forever', '#000080', '#fff'],
    ['the web is not an app', '#0a8c3a', '#fff'],
    ['still using bookmarks', '#ffcc00', '#000']
];

function openStampShelf() {
    const { body } = createAppWindow('stamps.html', { icon: 'photo_camera', width: 340 });
    body.classList.add('doc-body');
    body.innerHTML = `
        <h2 class="doc-h1">the stamp shelf</h2>
        <p class="doc-intro">99 by 56 with a torn edge, saying what the webmaster is into. every one of
            these is drawn by the page — nothing here is hotlinked off a host that died in 2009.</p>
        <div class="stamp-wall">${STAMPS.map((s, i) =>
        `<canvas class="stamp" width="99" height="56" data-s="${i}" title="${escapeHtml(s[0])}"></canvas>`).join('')}</div>
        <p class="doc-foot">take them. that is what they are for.</p>`;

    body.querySelectorAll('[data-s]').forEach(cv => {
        const [text, bg, fg] = STAMPS[+cv.dataset.s];
        const ctx = cv.getContext('2d');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, 99, 56);
        // the perforated edge, punched out of the four sides
        ctx.fillStyle = '#c0c0c0';
        for (let x = 0; x < 99; x += 8) { dot(ctx, x, 0); dot(ctx, x, 56); }
        for (let y = 0; y < 56; y += 8) { dot(ctx, 0, y); dot(ctx, 99, y); }
        ctx.fillStyle = fg;
        ctx.font = 'bold 9px "Courier New", monospace';
        ctx.textAlign = 'center';
        const words = text.split(' ');
        const lines = [];
        let line = '';
        words.forEach(w => {
            if ((line + ' ' + w).trim().length > 13) { lines.push(line.trim()); line = w; }
            else line += ' ' + w;
        });
        if (line.trim()) lines.push(line.trim());
        lines.forEach((l, i) => ctx.fillText(l, 49, 28 - (lines.length - 1) * 6 + i * 12));
    });
    function dot(ctx, x, y) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }
    unlockAchievement('stamps');
}

// ===================================================================
// awards
// ===================================================================
function openAwards() {
    const { body } = createAppWindow('awards.html', { icon: 'emoji_events', width: 340 });
    body.classList.add('doc-body');
    body.innerHTML = `
        <h2 class="doc-h1">awards</h2>
        <p class="doc-intro">in 1998 a site with a good background got a gif saying so, from a person
            with a site of their own and no particular authority. there was no committee. there was
            never a committee. these are in that tradition, which is to say i made all of them up.</p>
        <ul class="doc-list">
            <li><b>cool site of the day</b> — awarded by me, to me, on a day i decided</li>
            <li><b>best viewed at 800x600</b> — it is not, but the badge exists</li>
            <li><b>no cookie banner 2026</b> — a real achievement, actually</li>
            <li><b>zero build steps</b> — the whole site is what is in the repository</li>
            <li><b>heaviest page on a 56k modem</b> — runner up, narrowly</li>
            <li><b>most windows opened at once</b> — held by whoever is reading this</li>
            <li><b>site of the year</b> — 1999, self-declared, uncontested</li>
        </ul>
        <p class="doc-foot">if you would like to give this site an award, the guestbook is open. i will
            put it here and i will not check it.</p>`;
    unlockAchievement('awards');
}

// ===================================================================
// the directory
// ===================================================================
// Yahoo!'s idea: a person sorts the web into categories by hand. It did
// not scale, which is why we have search instead — but a site's own
// links have never needed to scale.
function openDirectory() {
    const { body } = createAppWindow('directory', { icon: 'folder_open', width: 340 });
    body.classList.add('doc-body');
    body.innerHTML = '<div class="doc-loading">loading...</div>';
    loadSiteData().then(d => {
        // The categories are decided here rather than stored in the data,
        // because that is what a directory was: a person deciding. data
        // /site.json has no "kind" on anything and it does not need one.
        const cats = [];

        const outward = (d.friends || []).filter(f => f.url);
        if (outward.length) cats.push(['sites worth your afternoon', outward.map(f =>
            ({ name: f.name, url: f.url, note: f.note }))]);

        // most of the 88x31s are decoration and link nowhere; the ones
        // that do link somewhere belong in a directory
        const linked = (d.buttons || []).filter(b => b.url);
        if (linked.length) cats.push(['buttons that go somewhere', linked.map(b =>
            ({ name: b.alt || 'button', url: b.url }))]);

        // and this site's own pages, which is the half a directory of your
        // own links can actually keep up to date
        if (window.WEB) {
            const mine = [
                ['now', 'what i am up to'], ['uses', 'what i use'],
                ['colophon', 'how this is built'], ['devlog', 'writing'],
                ['changelog', 'what changed'], ['buttons', 'the 88x31 wall'],
                ['shrine', 'things i love'], ['internet-life', 'a timeline'],
                ['blogroll', 'feeds worth reading'], ['sitemap', 'everything at once']
            ].filter(([slug]) => WEB.isRoute(slug));
            if (mine.length) cats.push(['this site, sorted by hand', mine.map(([slug, note]) =>
                ({ name: '/' + slug, url: WEB.urlFor(slug), note: note, internal: true }))]);
        }

        const total = cats.reduce((n, c) => n + c[1].length, 0);
        body.innerHTML = `
            <h2 class="doc-h1">the directory</h2>
            <p class="doc-intro">before search, a person sorted the web into categories by hand.
                it did not scale — that is why we have google — but a single site's links never
                needed to. ${total} entries, filed by one person with no qualifications.</p>
            ${cats.map(([name, items]) => `
                <h3 class="doc-h2">:: ${escapeHtml(name)} (${items.length}) ::</h3>
                <ul class="doc-list">${items.map(it =>
            `<li><a href="${escapeHtml(it.url)}"${it.internal ? '' : ' target="_blank" rel="noopener"'}>${escapeHtml(it.name)}</a>${it.note ? ' <span class="dir-note">— ' + escapeHtml(it.note) + '</span>' : ''}</li>`).join('')}</ul>`).join('')}
            <p class="doc-foot">yahoo! did this for the whole web until it could not. this is the
                size the idea actually works at.</p>`;
        if (window.WEB) WEB.enhance(body, { route: 'directory' });
        unlockAchievement('directory');
    }).catch(() => {
        body.innerHTML = '<div class="doc-loading">could not load data/site.json bradar</div>';
    });
}

// ===================================================================
// scandisk
// ===================================================================
function openScanDisk() {
    const { body, win } = createAppWindow('scandisk', { icon: 'storage', width: 320 });
    body.classList.add('toy-body');
    const COLS = 30, ROWS = 12, TOTAL = COLS * ROWS;
    body.innerHTML = `
        <div class="toy-h">scandisk — drive c:</div>
        <div class="sd-grid" data-grid></div>
        <div class="sd-legend">
            <span><i class="sd-sw sd-unscanned"></i>unscanned</span>
            <span><i class="sd-sw sd-ok"></i>ok</span>
            <span><i class="sd-sw sd-bad"></i>bad</span>
        </div>
        <div class="sd-status" data-status>ready.</div>
        <div class="sd-bar bevel-in"><i data-bar></i></div>
        <div class="toy-acts">
            <button class="bevel-out arc-btn" data-go>start</button>
            <label class="sd-check"><input type="checkbox" data-thorough> thorough (surface scan)</label>
        </div>`;

    const grid = body.querySelector('[data-grid]');
    grid.innerHTML = Array.from({ length: TOTAL }, () => '<i class="sd-cell sd-unscanned"></i>').join('');
    const cells = [...grid.children];
    const status = body.querySelector('[data-status]');
    const bar = body.querySelector('[data-bar]');
    let at = 0, timer, bad = 0;

    const FOUND = [
        'lost chain found in c:\\windows\\temp — converted to file0001.chk',
        'cross-linked file: guestbook.dat and passwords.txt',
        'invalid date stamp on shithole.sys — 1st january 1980',
        'directory entry with no name. left it alone.',
        'file allocation table has two opinions about cluster 4096'
    ];

    body.querySelector('[data-go]').onclick = () => {
        if (timer) { clearInterval(timer); timer = null; body.querySelector('[data-go]').textContent = 'start'; return; }
        const thorough = body.querySelector('[data-thorough]').checked;
        at = 0; bad = 0;
        cells.forEach(c => { c.className = 'sd-cell sd-unscanned'; });
        body.querySelector('[data-go]').textContent = 'stop';
        playSound('navigate');
        timer = setInterval(() => {
            for (let n = 0; n < (thorough ? 1 : 3) && at < TOTAL; n++, at++) {
                // one in eighty is bad, which is enough to be alarming and
                // rare enough to still feel like a finding
                const isBad = Math.random() < 0.012;
                cells[at].className = 'sd-cell ' + (isBad ? 'sd-bad' : 'sd-ok');
                if (isBad) {
                    bad++;
                    status.textContent = FOUND[(Math.random() * FOUND.length) | 0];
                    playSound('click');
                } else if (at % 17 === 0) {
                    status.textContent = 'scanning cluster ' + (at * 128) + '…';
                }
            }
            bar.style.width = ((at / TOTAL) * 100).toFixed(1) + '%';
            if (at >= TOTAL) {
                clearInterval(timer); timer = null;
                body.querySelector('[data-go]').textContent = 'start';
                status.textContent = bad
                    ? 'scandisk found ' + bad + ' bad cluster' + (bad === 1 ? '' : 's') + ' and fixed none of them.'
                    : 'scandisk did not find any errors on this drive.';
                playSound('ding');
                unlockAchievement('scandisk');
            }
        }, thorough ? 90 : 45);
    };
    win._cleanup = () => clearInterval(timer);
}

// ===================================================================
// setup, whose estimate is a lie
// ===================================================================
function openSetup() {
    const { body, win } = createAppWindow('mrhakan 98 setup', { icon: 'storage', width: 330 });
    body.classList.add('toy-body');
    const STEPS = [
        ['preparing setup wizard', 12],
        ['copying shithole.sys', 40],
        ['registering components', 55],
        ['installing winamp skins', 68],
        ['copying guestbook.dat', 74],
        ['detecting hardware', 88],
        ['finishing setup', 99],
        ['finishing setup', 99]
    ];
    body.innerHTML = `
        <div class="toy-h">installing mrhakan 98</div>
        <p class="toy-p" data-step>preparing setup wizard…</p>
        <div class="sd-bar bevel-in"><i data-bar></i></div>
        <p class="toy-p sd-eta" data-eta>estimated time remaining: 4 minutes</p>
        <div class="setup-tip bevel-in" data-tip></div>
        <div class="toy-acts"><button class="bevel-out arc-btn" data-cancel>cancel</button></div>`;

    const TIPS = [
        'did you know? you can right-click almost anything.',
        'tip: the start menu has more in it than you think.',
        'did you know? this site has no build step at all.',
        'tip: press ? for the keyboard shortcuts.',
        'did you know? every window here has its own address.',
        'tip: the guestbook is a pull request, honestly.'
    ];
    const stepEl = body.querySelector('[data-step]');
    const bar = body.querySelector('[data-bar]');
    const eta = body.querySelector('[data-eta]');
    const tip = body.querySelector('[data-tip]');
    let i = 0, pct = 0, tipTimer, timer;
    tip.textContent = TIPS[0];
    tipTimer = setInterval(() => { tip.textContent = TIPS[(Math.random() * TIPS.length) | 0]; }, 4000);

    timer = setInterval(() => {
        const target = STEPS[Math.min(i, STEPS.length - 1)][1];
        if (pct < target) pct += Math.random() * 2.2;
        else if (i < STEPS.length - 1) { i++; stepEl.textContent = STEPS[i][0] + '…'; }
        bar.style.width = Math.min(99, pct) + '%';
        // the estimate is a random number that occasionally goes up,
        // which is the single most accurate detail in this whole file
        const guess = Math.max(1, Math.round((99 - pct) / 8) + ((Math.random() * 3) | 0));
        eta.textContent = 'estimated time remaining: ' + guess + ' minute' + (guess === 1 ? '' : 's');
        if (pct >= 99) {
            stepEl.textContent = 'finishing setup…';
            eta.textContent = 'estimated time remaining: 1 minute';
        }
    }, 220);

    body.querySelector('[data-cancel]').onclick = () => {
        showRetroDialog({
            title: 'setup', lines: ['setup is not finished.', 'it is never going to be finished.'],
            okLabel: 'oh', cancelLabel: 'wait'
        });
        unlockAchievement('setup');
    };
    win._cleanup = () => { clearInterval(timer); clearInterval(tipTimer); };
}

// ===================================================================
// download more ram
// ===================================================================
function openMoreRam() {
    const { body, win } = createAppWindow('downloadmoreram.exe', { icon: 'monitoring', width: 300 });
    body.classList.add('toy-body');
    body.innerHTML = `
        <div class="toy-h">download more ram</div>
        <p class="toy-p">select how much ram you would like to download.</p>
        <div class="ram-opts">
            ${[64, 128, 256, 512].map(m => `<button class="bevel-out arc-btn" data-mb="${m}">${m} MB</button>`).join('')}
        </div>
        <div class="sd-bar bevel-in"><i data-bar></i></div>
        <p class="toy-p" data-status>waiting.</p>`;
    const bar = body.querySelector('[data-bar]');
    const status = body.querySelector('[data-status]');
    let timer;
    body.querySelectorAll('[data-mb]').forEach(b => b.onclick = () => {
        clearInterval(timer);
        let pct = 0;
        const mb = +b.dataset.mb;
        playSound('navigate');
        timer = setInterval(() => {
            // it accelerates, then it stops at 99, because of course it does
            pct += pct < 60 ? 3.5 : 0.6;
            bar.style.width = Math.min(99, pct) + '%';
            status.textContent = 'downloading ' + mb + 'MB … ' + Math.min(99, pct).toFixed(0) + '%';
            if (pct >= 99) {
                clearInterval(timer);
                status.textContent = 'download failed at 99%. please try again.';
                playSound('error');
                unlockAchievement('ram');
            }
        }, 90);
    });
    win._cleanup = () => clearInterval(timer);
}

// ===================================================================
// the virus scanner, which finds what it planted
// ===================================================================
function openVirusScan() {
    const { body, win } = createAppWindow('antivirus 98', { icon: 'bug_report', width: 320 });
    body.classList.add('toy-body');
    const FILES = [
        'c:\\windows\\shithole.sys', 'c:\\windows\\system\\winamp.dll',
        'c:\\my documents\\guestbook.dat', 'c:\\windows\\temp\\file0001.chk',
        'c:\\games\\minesweeper.exe', 'c:\\windows\\passwords.txt',
        'c:\\windows\\system\\trolldll.dll', 'c:\\my documents\\homework.doc.exe',
        'c:\\progra~1\\bonzi\\bonzi.exe', 'c:\\windows\\clippy.dat'
    ];
    const THREATS = [
        ['TROLL.GIF.EXE', 'not actually a gif'],
        ['BONZI.BUDDY', 'it was never free'],
        ['Y2K.BUG', 'dormant since 2000, still angry'],
        ['CLIPPY.PERSIST', 'it looks like you are trying to remove me'],
        ['COOKIE.BANNER', 'the only real virus on this list']
    ];
    body.innerHTML = `
        <div class="toy-h">antivirus 98 — scanning</div>
        <div class="av-file" data-file>ready.</div>
        <div class="sd-bar bevel-in"><i data-bar></i></div>
        <div class="av-found bevel-in" data-found></div>
        <div class="toy-acts">
            <button class="bevel-out arc-btn" data-go>scan</button>
            <button class="bevel-out arc-btn" data-clean disabled>remove all</button>
        </div>`;
    const fileEl = body.querySelector('[data-file]');
    const bar = body.querySelector('[data-bar]');
    const found = body.querySelector('[data-found]');
    let timer, hits = [];

    body.querySelector('[data-go]').onclick = () => {
        clearInterval(timer);
        hits = []; found.innerHTML = '';
        body.querySelector('[data-clean]').disabled = true;
        let n = 0;
        playSound('navigate');
        timer = setInterval(() => {
            fileEl.textContent = FILES[n % FILES.length];
            bar.style.width = ((n / 40) * 100).toFixed(0) + '%';
            if (Math.random() < 0.14 && hits.length < THREATS.length) {
                const t = THREATS[hits.length];
                hits.push(t);
                const row = document.createElement('div');
                row.className = 'av-hit';
                row.innerHTML = '<b>' + escapeHtml(t[0]) + '</b><span>' + escapeHtml(t[1]) + '</span>';
                found.appendChild(row);
                playSound('error');
            }
            if (++n >= 40) {
                clearInterval(timer);
                bar.style.width = '100%';
                fileEl.textContent = 'scan complete — ' + hits.length + ' item(s) found.';
                body.querySelector('[data-clean]').disabled = hits.length === 0;
                unlockAchievement('virus');
            }
        }, 110);
    };
    body.querySelector('[data-clean]').onclick = () => {
        found.innerHTML = '<div class="av-hit"><b>0 removed</b><span>this is a joke program, they were never there</span></div>';
        playSound('ding');
    };
    win._cleanup = () => clearInterval(timer);
}

// ===================================================================
// enter network password
// ===================================================================
function openNetworkPassword() {
    const { body } = createAppWindow('enter network password', { icon: 'key', width: 280 });
    body.classList.add('toy-body');
    body.innerHTML = `
        <p class="toy-p">enter your network password for microsoft networking.</p>
        <label class="toy-field">user name <input class="bevel-in" value="bradar" data-user></label>
        <label class="toy-field">password <input class="bevel-in" type="password" value="hunter2" data-pass></label>
        <label class="sd-check"><input type="checkbox" checked> save this password in your password list</label>
        <div class="toy-acts">
            <button class="bevel-out arc-btn" data-ok>ok</button>
            <button class="bevel-out arc-btn" data-cancel>cancel</button>
        </div>`;
    body.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => e.stopPropagation()));
    body.querySelector('[data-ok]').onclick = () => {
        showRetroDialog({
            title: 'microsoft networking',
            lines: ['the password you typed shows as ' + '*'.repeat(7) + ' to everyone else.',
                'that is the joke. it has been the joke since 2004.'],
            okLabel: 'hunter2'
        });
        unlockAchievement('hunter2');
    };
    body.querySelector('[data-cancel]').onclick = () =>
        showToast('networking', 'you have been logged out of a network that does not exist');
}

// ===================================================================
// the sound board
// ===================================================================
function openSoundBoard() {
    const { body } = createAppWindow('sounds', { icon: 'graphic_eq', width: 280 });
    body.classList.add('toy-body');
    const SOUNDS = ['startup', 'ding', 'click', 'navigate', 'error', 'shutdown'];
    body.innerHTML = `
        <div class="toy-h">sound board</div>
        <p class="toy-p">the whole scheme, in one window. it respects the sound toggle in the tray.</p>
        <div class="snd-grid">
            ${SOUNDS.map(s => `<button class="bevel-out snd-btn" data-s="${s}">${s}</button>`).join('')}
        </div>`;
    body.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
        playSound(b.dataset.s);
        if (window.FX) FX.nudge(b);
        unlockAchievement('soundboard');
    });
}

// ===================================================================
// the small clocks and calculators
// ===================================================================

// moon phase — Conway's approximation, which is off by at most a day
// and fits in six lines, which is the trade every almanac made
function moonPhase(d) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    let r = y % 100;
    r %= 19;
    if (r > 9) r -= 19;
    r = ((r * 11) % 30) + m + day;
    if (m < 3) r += 2;
    r -= (y < 2000 ? 4 : 8.3);
    r = Math.floor(r + 0.5) % 30;
    return r < 0 ? r + 30 : r;
}

function openMoon() {
    const { body } = createAppWindow('moon.exe', { icon: 'star', width: 250 });
    body.classList.add('toy-body');
    const NAMES = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous',
        'full moon', 'waning gibbous', 'last quarter', 'waning crescent'];
    const GLYPH = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
    const age = moonPhase(new Date());
    const i = Math.min(7, Math.floor((age / 29.53) * 8 + 0.5) % 8);
    body.innerHTML = `
        <div class="moon-face">${GLYPH[i]}</div>
        <div class="toy-h">${NAMES[i]}</div>
        <p class="toy-p">the moon is about <b>${age}</b> days into its cycle.</p>
        <p class="toy-p toy-dim">conway's approximation, computed on your machine. off by a day at
            worst, which is what every printed almanac was too.</p>`;
    unlockAchievement('moon');
}

function openWorldClock() {
    const { body, win } = createAppWindow('world clock', { icon: 'schedule', width: 260 });
    body.classList.add('toy-body');
    const ZONES = [
        ['istanbul', 'Europe/Istanbul'], ['london', 'Europe/London'],
        ['new york', 'America/New_York'], ['são paulo', 'America/Sao_Paulo'],
        ['tokyo', 'Asia/Tokyo'], ['sydney', 'Australia/Sydney'],
        ['los angeles', 'America/Los_Angeles'], ['UTC', 'UTC']
    ];
    body.innerHTML = `<div class="toy-h">world clock</div><div class="wc-list" data-list></div>
        <p class="toy-p toy-dim">the browser knows every timezone rule there is. no server involved.</p>`;
    const list = body.querySelector('[data-list]');
    function tick() {
        list.innerHTML = ZONES.map(([name, tz]) => {
            let t = '??:??';
            try {
                t = new Intl.DateTimeFormat('en-GB', {
                    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
                }).format(new Date());
            } catch (e) { }
            const hour = +t.slice(0, 2);
            const night = hour < 7 || hour >= 20;
            return `<div class="wc-row"><span>${night ? '🌙' : '☀️'} ${escapeHtml(name)}</span><b>${t}</b></div>`;
        }).join('');
    }
    tick();
    const timer = setInterval(tick, 1000);
    win._cleanup = () => clearInterval(timer);
}

// biorhythm — 23, 28 and 33 day sine waves off your birthday. It is
// complete pseudoscience and it was on every second homepage in 1999,
// which is exactly why it is here.
function openBiorhythm() {
    const { body } = createAppWindow('biorhythm', { icon: 'monitoring', width: 320 });
    body.classList.add('toy-body');
    body.innerHTML = `
        <div class="toy-h">biorhythm</div>
        <label class="toy-field">born <input class="bevel-in" type="date" data-dob value="1995-06-15"></label>
        <canvas class="bevel-in bio-canvas" width="290" height="130"></canvas>
        <div class="bio-key">
            <span class="bio-p">physical (23d)</span><span class="bio-e">emotional (28d)</span>
            <span class="bio-i">intellectual (33d)</span>
        </div>
        <div class="bio-now" data-now></div>
        <p class="toy-p toy-dim">complete pseudoscience, and it was on every second homepage in 1999.
            that is the only reason it is here.</p>`;
    const cv = body.querySelector('canvas'), ctx = cv.getContext('2d');
    const dob = body.querySelector('[data-dob]');
    const now = body.querySelector('[data-now]');
    const CYCLES = [[23, '#c40000', 'physical'], [28, '#0080c4', 'emotional'], [33, '#0a8c3a', 'intellectual']];

    function draw() {
        const born = new Date(dob.value || '1995-06-15');
        const days = Math.floor((Date.now() - born.getTime()) / 86400000);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.strokeStyle = '#ccc'; ctx.beginPath();
        ctx.moveTo(0, 65); ctx.lineTo(cv.width, 65); ctx.stroke();
        // today sits in the middle, fifteen days either side
        ctx.strokeStyle = '#999'; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(cv.width / 2, 0); ctx.lineTo(cv.width / 2, cv.height); ctx.stroke();
        ctx.setLineDash([]);
        const out = [];
        CYCLES.forEach(([period, colour, name]) => {
            ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.beginPath();
            for (let x = 0; x <= cv.width; x++) {
                const d = days + (x - cv.width / 2) / (cv.width / 30);
                const v = Math.sin((2 * Math.PI * d) / period);
                const y = 65 - v * 52;
                x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.stroke();
            const today = Math.sin((2 * Math.PI * days) / period);
            out.push(name + ' ' + (today * 100).toFixed(0) + '%');
        });
        now.textContent = 'day ' + days.toLocaleString() + ' — ' + out.join(' · ');
    }
    dob.addEventListener('change', draw);
    dob.addEventListener('keydown', e => e.stopPropagation());
    draw();
    unlockAchievement('biorhythm');
}

// the love calculator, which every 90s site had and which is, and always
// was, a hash of two strings
function openLoveCalc() {
    const { body } = createAppWindow('love calculator', { icon: 'favorite', width: 270 });
    body.classList.add('toy-body');
    body.innerHTML = `
        <div class="toy-h">love calculator</div>
        <label class="toy-field">name <input class="bevel-in" data-a maxlength="20"></label>
        <label class="toy-field">name <input class="bevel-in" data-b maxlength="20"></label>
        <button class="bevel-out arc-btn" data-go>calculate</button>
        <div class="love-out" data-out></div>
        <p class="toy-p toy-dim">it is a hash of the two names. it always was. that is why the answer
            never changes, which is the only way anybody ever believed it.</p>`;
    const out = body.querySelector('[data-out]');
    body.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => e.stopPropagation()));
    body.querySelector('[data-go]').onclick = () => {
        const a = (body.querySelector('[data-a]').value || '').trim().toLowerCase();
        const b = (body.querySelector('[data-b]').value || '').trim().toLowerCase();
        if (!a || !b) { out.textContent = 'two names, please.'; return; }
        // deterministic and symmetric — the same pair always gets the same
        // answer whichever way round you type them, which is the one thing
        // these had to get right
        const s = [a, b].sort().join('+');
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        const pct = h % 101;
        const verdict = pct > 90 ? 'get married immediately' : pct > 70 ? 'promising' :
            pct > 45 ? 'it could work' : pct > 20 ? 'be friends' : 'absolutely not';
        out.innerHTML = `<div class="love-pct">${pct}%</div><div>${escapeHtml(verdict)}</div>`;
        playSound('ding');
        unlockAchievement('love');
    };
}

// cowsay, ported honestly: the bubble is drawn to the widest line and
// the tail points at the cow
function openCowsay() {
    const { body } = createAppWindow('cowsay', { icon: 'terminal', width: 320 });
    body.classList.add('toy-body');
    body.innerHTML = `
        <label class="toy-field">say <input class="bevel-in" data-text value="moo" maxlength="60"></label>
        <label class="toy-field">who
            <select class="bevel-in" data-who>
                <option value="cow">cow</option><option value="tux">tux</option>
                <option value="troll">troll</option>
            </select>
        </label>
        <pre class="cow-out" data-out></pre>
        <div class="toy-acts"><button class="bevel-out arc-btn" data-copy>copy</button></div>`;
    const ART = {
        cow: '        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||',
        tux: '   \\\n    \\\n        .--.\n       |o_o |\n       |:_/ |\n      //   \\ \\\n     (|     | )\n    /\'\\_   _/`\\\n    \\___)=(___/',
        troll: '     \\\n      \\   \\\\\\\\|||////\n           ( o o )\n       ---ooO-(_)-Ooo---'
    };
    const text = body.querySelector('[data-text]'), who = body.querySelector('[data-who]');
    const out = body.querySelector('[data-out]');
    text.addEventListener('keydown', e => e.stopPropagation());

    function render() {
        const words = (text.value || ' ').split(/\s+/);
        const lines = [];
        let line = '';
        words.forEach(w => {
            if ((line + ' ' + w).trim().length > 38) { lines.push(line.trim()); line = w; }
            else line += ' ' + w;
        });
        if (line.trim()) lines.push(line.trim());
        const width = Math.max.apply(null, lines.map(l => l.length));
        let bubble = ' ' + '_'.repeat(width + 2) + '\n';
        if (lines.length === 1) bubble += '< ' + lines[0].padEnd(width) + ' >\n';
        else lines.forEach((l, i) => {
            const [a, b] = i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|'];
            bubble += a + ' ' + l.padEnd(width) + ' ' + b + '\n';
        });
        bubble += ' ' + '-'.repeat(width + 2) + '\n';
        out.textContent = bubble + ART[who.value];
    }
    text.addEventListener('input', render);
    who.addEventListener('change', render);
    body.querySelector('[data-copy]').onclick = () => {
        if (window.WEB) WEB.copy(out.textContent, 'the cow is on your clipboard');
        unlockAchievement('cowsay');
    };
    render();
}

// dice and a coin, which is two toys but one window
function openDice() {
    const { body } = createAppWindow('dice', { icon: 'casino', width: 260 });
    body.classList.add('toy-body');
    body.innerHTML = `
        <div class="toy-h">dice &amp; coin</div>
        <div class="dice-out" data-out>—</div>
        <div class="dice-row">
            ${[4, 6, 8, 10, 12, 20, 100].map(n => `<button class="bevel-out arc-btn" data-d="${n}">d${n}</button>`).join('')}
        </div>
        <div class="toy-acts">
            <button class="bevel-out arc-btn" data-coin>flip a coin</button>
            <label class="sd-check">how many <input class="bevel-in dice-n" type="number" value="1" min="1" max="10" data-n></label>
        </div>
        <div class="dice-log" data-log></div>`;
    const out = body.querySelector('[data-out]'), log = body.querySelector('[data-log]');
    const note = (t) => {
        const d = document.createElement('div');
        d.textContent = t;
        log.prepend(d);
        while (log.children.length > 8) log.lastChild.remove();
    };
    body.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
        const sides = +b.dataset.d;
        const n = Math.max(1, Math.min(10, +body.querySelector('[data-n]').value || 1));
        const rolls = Array.from({ length: n }, () => 1 + ((Math.random() * sides) | 0));
        const total = rolls.reduce((a, c) => a + c, 0);
        out.textContent = n > 1 ? total + '  (' + rolls.join(', ') + ')' : String(total);
        note(n + 'd' + sides + ' → ' + total);
        playSound('click');
        if (sides === 20 && rolls.includes(20)) { showToast('dice', 'natural 20'); unlockAchievement('nat20'); }
    });
    body.querySelector('[data-coin]').onclick = () => {
        const heads = Math.random() < 0.5;
        out.textContent = heads ? 'heads' : 'tails';
        note('coin → ' + out.textContent);
        playSound('ding');
    };
    body.querySelector('[data-n]').addEventListener('keydown', e => e.stopPropagation());
}

// ===================================================================
// surprise me
// ===================================================================
// The 'random page' button every directory had. It picks out of the
// desktop's own routes, so it can never point at something that is not
// there — which is more than the 1998 ones could say.
function surpriseMe() {
    if (!window.WEB) return;
    const skip = ['home', 'shutdown', 'run', 'reset', 'find', 'favorites', 'discord', 'netplay'];
    const all = WEB.slugs().filter(s => skip.indexOf(s) === -1);
    const pick = all[(Math.random() * all.length) | 0];
    showToast('surprise', 'opening /' + pick);
    WEB.open(pick);
    unlockAchievement('surprise');
}

// ===================================================================
// rate this site
// ===================================================================
function openRating() {
    const { body } = createAppWindow('rate this site', { icon: 'star', width: 270 });
    body.classList.add('toy-body');
    const KEY = 'mrhakan.rating';
    let mine = +(localStorage.getItem(KEY) || 0);
    body.innerHTML = `
        <div class="toy-h">rate this site</div>
        <div class="rate-stars" data-stars></div>
        <p class="toy-p" data-msg></p>
        <p class="toy-p toy-dim">this is stored in your browser and goes nowhere. there is no server,
            no average, and nobody counting. it is a 1999 star rating: entirely for you.</p>`;
    const stars = body.querySelector('[data-stars]');
    const msg = body.querySelector('[data-msg]');
    const WORDS = ['', 'harsh', 'fair enough', 'thank you', 'very kind', 'you are too generous'];
    function paint() {
        stars.innerHTML = [1, 2, 3, 4, 5].map(n =>
            `<button class="rate-star${n <= mine ? ' on' : ''}" data-n="${n}"
                aria-label="${n} out of 5">★</button>`).join('');
        stars.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
            mine = +b.dataset.n;
            try { localStorage.setItem(KEY, String(mine)); } catch (e) { }
            playSound('ding');
            unlockAchievement('rated');
            paint();
        });
        msg.textContent = mine ? WORDS[mine] : 'go on then.';
    }
    paint();
}

// ===================================================================
// the status bar scroller
// ===================================================================
// window.status used to be writable, and every second homepage had a
// letter-by-letter message crawling along the bottom of the browser.
// Browsers took it away in about 2010 for good reasons. This site
// happens to have built its own status bar, so it can have it back.
let scrollerTimer = null;
function toggleStatusScroller() {
    const el = document.getElementById('ie-status-text');
    if (!el) return;
    if (scrollerTimer) {
        clearInterval(scrollerTimer);
        scrollerTimer = null;
        if (window.WEB) WEB.setStatus('done');
        showToast('status bar', 'it stopped. probably for the best.');
        return;
    }
    const MSG = '*** welcome to mrhakan 98 *** best viewed at 800x600 *** sign the guestbook *** ';
    let at = 0;
    scrollerTimer = setInterval(() => {
        el.textContent = (MSG.slice(at) + MSG.slice(0, at)).slice(0, 60);
        at = (at + 1) % MSG.length;
    }, 110);
    unlockAchievement('scroller');
    showToast('status bar', 'window.status is back. browsers removed this in 2010.');
}

// ===================================================================
// the cursor trail
// ===================================================================
let trailOn = false, trailDots = [];
function toggleCursorTrail() {
    if (trailOn) {
        trailOn = false;
        trailDots.forEach(d => d.remove());
        trailDots = [];
        document.removeEventListener('mousemove', trailMove);
        showToast('cursor', 'the trail is gone');
        return;
    }
    trailOn = true;
    for (let i = 0; i < 12; i++) {
        const d = document.createElement('div');
        d.className = 'trail-dot';
        d.setAttribute('aria-hidden', 'true');
        d.style.background = `hsl(${i * 30},100%,60%)`;
        document.body.appendChild(d);
        trailDots.push(d);
    }
    document.addEventListener('mousemove', trailMove);
    unlockAchievement('trail');
    showToast('cursor', 'a trail. it was on every site in 1999.');
}
const trailPoints = [];
function trailMove(e) {
    trailPoints.unshift({ x: e.clientX, y: e.clientY });
    trailPoints.length = Math.min(trailPoints.length, trailDots.length * 3);
    trailDots.forEach((d, i) => {
        const p = trailPoints[i * 3];
        if (!p) return;
        d.style.left = p.x + 'px';
        d.style.top = p.y + 'px';
    });
}
