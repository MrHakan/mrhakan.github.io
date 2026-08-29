// ===================================================================
// mrhakan 98 — "personal web" pages, inspired by the indieweb / neocities
// scene: slash pages (/now, /uses, /colophon, /changelog), an 88x31
// button wall with a link-to-me badge, a shrine, an internet-history
// timeline, a site map and a classic old-web personality quiz.
// ===================================================================

let siteData = null;
async function loadSiteData() {
    if (siteData) return siteData;
    const res = await fetch('data/site.json');
    siteData = await res.json();
    return siteData;
}

// small helper: a scrollable "document" window with a title bar strip
function docWindow(title, icon, width) {
    const { body, win } = createAppWindow(title, { icon: icon, width: width || 380 });
    body.classList.add('doc-body');
    body.innerHTML = '<div class="doc-loading">loading...</div>';
    return { body, win };
}
function docFail(body) {
    body.innerHTML = '<div class="doc-loading">could not load data/site.json bradar</div>';
}

// every document window ends here once its real content is in: the reading
// layer adds the anchors, the contents, the plain-text view and the rest.
// It is deliberately unable to break the document it is decorating.
function docReady(body) {
    try { if (window.WEB) WEB.enhance(body); } catch (e) { }
}

// prose out of data/ may carry [[note: ...]] markers, which become margin
// notes. Everything else is escaped exactly as it always was.
function docProse(t) {
    return (window.WEB && WEB.prose) ? WEB.prose(t) : escapeHtml(t);
}

// ---------- /now ----------
async function openNowPage() {
    const { body } = docWindow('now.txt', 'schedule', 400);
    try {
        const d = (await loadSiteData()).now;
        body.innerHTML = `
            <h2 class="doc-h1">what im up to right now</h2>
            <p class="doc-meta">last updated: ${escapeHtml(d.updated)}</p>
            <p class="doc-intro">${docProse(d.intro)}</p>
            ${d.sections.map(s => `
                <h3 class="doc-h2">:: ${escapeHtml(s.title)} ::</h3>
                <ul class="doc-list">${s.items.map(i => `<li>${docProse(i)}</li>`).join('')}</ul>
            `).join('')}
            <p class="doc-foot">inspired by nownownow.com — every personal site should have one.</p>`;
        unlockAchievement('nosy');
        docReady(body);
    } catch (e) { docFail(body); }
}

// ---------- /uses ----------
async function openUsesPage() {
    const { body } = docWindow('uses.txt', 'computer', 400);
    try {
        const d = (await loadSiteData()).uses;
        body.innerHTML = `
            <h2 class="doc-h1">what i use</h2>
            <p class="doc-intro">${docProse(d.intro)}</p>
            ${d.groups.map(g => `
                <h3 class="doc-h2">:: ${escapeHtml(g.title)} ::</h3>
                <ul class="doc-list">${g.items.map(i => `<li>${docProse(i)}</li>`).join('')}</ul>
            `).join('')}`;
        docReady(body);
    } catch (e) { docFail(body); }
}

// ---------- /colophon ----------
async function openColophon() {
    const { body } = docWindow('colophon.txt', 'description', 400);
    try {
        const d = (await loadSiteData()).colophon;
        body.innerHTML = `
            <h2 class="doc-h1">colophon</h2>
            <p class="doc-intro">${docProse(d.intro)}</p>
            <ul class="doc-list">${d.lines.map(l => `<li>${docProse(l)}</li>`).join('')}</ul>
            <p class="doc-foot">view the source: it is all right there in the repo. no build step, no secrets.</p>
            <a class="doc-btn bevel-out" href="https://github.com/MrHakan/mrhakan.github.io" target="_blank" rel="noopener">view source on github</a>`;
        docReady(body);
    } catch (e) { docFail(body); }
}

// ---------- /changelog ----------
async function openChangelog() {
    const { body } = docWindow('changelog.txt', 'history', 400);
    try {
        const d = (await loadSiteData()).changelog;
        body.innerHTML = `
            <h2 class="doc-h1">site changelog</h2>
            <p class="doc-intro">this website has version numbers. yes, really.</p>
            ${d.map((v, i) => `
                <div class="cl-entry">
                    <div class="cl-head"><b>v${escapeHtml(v.version)}</b>
                        <span>${escapeHtml(v.date)}</span>
                        ${i === 0 ? '<span class="cl-latest">LATEST</span>' : ''}</div>
                    <ul class="doc-list">${v.changes.map(c => `<li>${docProse(c)}</li>`).join('')}</ul>
                </div>`).join('')}`;
        docReady(body);
    } catch (e) { docFail(body); }
}

// ---------- 88x31 button wall + link to me ----------
const LINK_HTML = '<a href="https://mrhakan.github.io"><img src="https://mrhakan.github.io/src/88x31/mrhakan.png" alt="mrhakan\'s shithole" width="88" height="31"></a>';
async function openButtonWall() {
    const { body } = docWindow('buttons.html', 'photo_camera', 420);
    try {
        const d = await loadSiteData();
        body.innerHTML = `
            <h2 class="doc-h1">88x31 button wall</h2>
            <p class="doc-intro">the currency of the old web. collect them all.</p>

            <h3 class="doc-h2">:: link to me ::</h3>
            <div class="btn-mine">
                <img src="src/88x31/mrhakan.png" width="88" height="31" alt="mrhakan's shithole" class="btn-badge">
                <div class="btn-mine-txt">
                    <p>put me on your site bradar. copy this:</p>
                    <textarea id="btn-code" class="bevel-in btn-code" readonly rows="3">${escapeHtml(LINK_HTML)}</textarea>
                    <button class="bevel-out doc-btn" id="btn-copy">copy html</button>
                </div>
            </div>

            <h3 class="doc-h2">:: my collection ::</h3>
            <div class="btn-wall">${d.buttons.map(b => b.url
            ? `<a href="${escapeHtml(b.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(b.img)}" alt="${escapeHtml(b.alt)}" title="${escapeHtml(b.alt)}" width="88" height="31" loading="lazy"></a>`
            : `<img src="${escapeHtml(b.img)}" alt="${escapeHtml(b.alt)}" title="${escapeHtml(b.alt)}" width="88" height="31" loading="lazy">`
        ).join('')}</div>
            <p class="doc-foot">buttons hosted by cyber.dabamos.de — a public 88x31 archive.</p>`;
        body.querySelector('#btn-copy').onclick = () => {
            const ta = body.querySelector('#btn-code');
            ta.select();
            if (navigator.clipboard) navigator.clipboard.writeText(LINK_HTML).catch(() => { });
            showToast('buttons.html', 'copied! now go put it on your site');
            playSound('ding');
            unlockAchievement('linkback');
        };
        docReady(body);
    } catch (e) { docFail(body); }
}

// ---------- blogroll / cool sites ----------
async function openFriends() {
    const { body } = docWindow('blogroll.txt', 'link', 380);
    try {
        const d = (await loadSiteData()).friends;
        body.innerHTML = `
            <h2 class="doc-h1">blogroll</h2>
            <p class="doc-intro">sites that keep the web weird. go visit them, not just mine.</p>
            <div class="friend-list">${d.map(f => `
                <a href="${escapeHtml(f.url)}" target="_blank" rel="noopener" class="friend-row">
                    <span class="friend-name">${escapeHtml(f.name)}</span>
                    <span class="friend-note">${escapeHtml(f.note)}</span>
                </a>`).join('')}</div>
            <p class="doc-foot">want to be here? sign the guestbook with your url.</p>`;
        docReady(body);
    } catch (e) { docFail(body); }
}

// ---------- shrine ----------
async function openShrine() {
    const { body } = docWindow('shrine.html', 'favorite', 400);
    try {
        const d = (await loadSiteData()).shrine;
        body.innerHTML = `
            <h2 class="doc-h1">the shrine</h2>
            <p class="doc-intro">${docProse(d.intro)}</p>
            ${d.categories.map(c => `
                <div class="shrine-cat">
                    <h3 class="doc-h2">${c.icon} ${escapeHtml(c.title)}</h3>
                    <div class="shrine-tags">${c.items.map(i => `<span class="shrine-tag">${escapeHtml(i)}</span>`).join('')}</div>
                </div>`).join('')}`;
        unlockAchievement('shrine');
        docReady(body);
    } catch (e) { docFail(body); }
}

// ---------- internet history timeline ----------
async function openInternetHistory() {
    const { body } = docWindow('my_internet_life.txt', 'history', 400);
    try {
        const d = (await loadSiteData()).history;
        body.innerHTML = `
            <h2 class="doc-h1">my internet life</h2>
            <p class="doc-intro">where i hung out before this shithole existed.</p>
            <div class="timeline">${d.map(h => `
                <div class="tl-row">
                    <span class="tl-year">${escapeHtml(h.year)}</span>
                    <span class="tl-dot"></span>
                    <span class="tl-text">${escapeHtml(h.text)}</span>
                </div>`).join('')}</div>`;
        docReady(body);
    } catch (e) { docFail(body); }
}

// ---------- site map ----------
const SITE_MAP = [
    {
        group: 'sections', items: [
            ['about me', "showSection('home')"], ['my work', "showSection('github')"],
            ['cool links', "showSection('links')"], ['guestbook', "showSection('guestbook')"]
        ]
    },
    {
        group: 'about this site', items: [
            ['devlog.txt', 'openDevlog()'],
            ['now.txt', 'openNowPage()'], ['uses.txt', 'openUsesPage()'],
            ['colophon.txt', 'openColophon()'], ['changelog.txt', 'openChangelog()'],
            ['buttons.html', 'openButtonWall()'], ['blogroll.txt', 'openFriends()'],
            ['shrine.html', 'openShrine()'], ['my internet life', 'openInternetHistory()']
        ]
    },
    {
        group: 'programs', items: [
            ['notepad', 'openNotepad()'], ['calculator', 'openCalculator()'],
            ['ms-dos prompt', 'openTerminal()'], ['paint', 'openPaint()'],
            ['character map', 'openCharMap()'], ['clock', 'openClock()'],
            ['my computer', 'openMyComputer()'], ['recycle bin', 'openRecycleBin()'],
            ['dial-up networking', 'openDialUp()'], ['task manager', 'openTaskManager()'],
            ['disk defragmenter', 'openDefrag()'], ['find: files', 'openFindFiles()']
        ]
    },
    {
        group: 'games & toys', items: [
            ['jokerz 98 (poker roguelike)', 'openBalatro()'],
            ['sir, we have a troll problem', 'openTrollProblem()'], ['become user', 'openBecomeUser()'],
            ['wizardz 98 (draw your spells)', 'openWizardz()'], ['wizardz: 1 v bot', "openWizardz('bot')"],
            ['multiplayer lobby', 'openNetplay()'],
            ['solitaire', 'openSolitaire()'],
            ['minesweeper', 'openMinesweeper()'], ['snake', 'openSnake()'], ['pong', 'openPong()'],
            ['which track are you?', 'openQuiz()'], ['magic 8-ball', 'openMagic8Ball()'],
            ['visitor poll', 'openPoll()'], ['achievements', 'openAchievements()']
        ]
    },
    {
        group: 'system', items: [
            ['display properties', 'openControlPanel()'], ['theme maker', 'launchThemeMaker()'],
            ['system properties', 'openSystemProperties()'],
            ['equalizer', 'openEqualizer()'], ['oscilloscope', 'openOscilloscope()'],
            ['site statistics', 'openSiteStats()'], ['keyboard shortcuts', 'showShortcuts()'],
            ['web ring', 'openWebRing()'], ['rss feed', "window.open('feed.xml','_blank')"], ['json feed', "window.open('feed.json','_blank')"],
        ['directory', 'openDirectory()'], ['awards', 'openAwards()'], ['stamps', 'openStampShelf()']
        ]
    }
];
function openSiteMap() {
    const { body } = docWindow('sitemap.html', 'public', 400);
    body.innerHTML = `
        <h2 class="doc-h1">site map</h2>
        <p class="doc-intro">everything in the shithole, in one list. ${SITE_MAP.reduce((n, g) => n + g.items.length, 0)} destinations.</p>
        ${SITE_MAP.map(g => `
            <h3 class="doc-h2">:: ${escapeHtml(g.group)} ::</h3>
            <div class="map-grid">${g.items.map(([label, fn]) =>
        `<button class="map-link" data-fn="${escapeHtml(fn)}">${escapeHtml(label)}</button>`).join('')}</div>
        `).join('')}`;
    body.querySelectorAll('.map-link').forEach(b => b.onclick = () => {
        // the map stores tiny call expressions; run them through Function so the
        // buttons stay declarative in SITE_MAP
        try { new Function(b.dataset.fn)(); } catch (e) { console.error(e); }
    });
    docReady(body);
}

// ---------- "which track are you?" quiz (peak old-web) ----------
const QUIZ = [
    {
        q: 'its 3am. what are you doing?', a: [
            { t: 'still coding, obviously', s: 'matrix' },
            { t: 'crying to sad music', s: 'goth' },
            { t: 'dancing alone in my room', s: 'euro' },
            { t: 'raging in a lobby', s: 'rage' }
        ]
    },
    {
        q: 'pick a colour scheme', a: [
            { t: 'green on black', s: 'matrix' },
            { t: 'black on blacker', s: 'goth' },
            { t: 'pink and yellow', s: 'euro' },
            { t: 'red. blood red.', s: 'rage' }
        ]
    },
    {
        q: 'your ideal saturday night?', a: [
            { t: 'reinstalling my os for fun', s: 'matrix' },
            { t: 'staring at rain through a window', s: 'goth' },
            { t: 'a party where nobody knows me', s: 'euro' },
            { t: 'a mosh pit', s: 'rage' }
        ]
    },
    {
        q: 'someone insults your website. you:', a: [
            { t: 'explain the architecture for 40 minutes', s: 'matrix' },
            { t: 'take it personally forever', s: 'goth' },
            { t: 'add three more gifs out of spite', s: 'euro' },
            { t: 'let the bodies hit the floor', s: 'rage' }
        ]
    },
    {
        q: 'pick an era', a: [
            { t: '1999, right before y2k', s: 'matrix' },
            { t: '2007 myspace emo peak', s: 'goth' },
            { t: '2008 eurodance youtube', s: 'euro' },
            { t: '2005 flash game rage comics', s: 'rage' }
        ]
    }
];
const QUIZ_RESULTS = {
    matrix: { title: 'clubbed to death', artist: 'rob dougan', emoji: '🕶️', desc: 'you are the one. you see the code behind reality and you refuse to touch grass. respect.', track: 3 },
    goth: { title: 'bring me to life', artist: 'evanescence', emoji: '🖤', desc: 'you feel things very deeply and your playlist knows it. the rain is always falling somewhere in your heart.', track: 1 },
    euro: { title: 'caramelldansen', artist: 'caramella girls', emoji: '🐰', desc: 'pure unfiltered serotonin. you cannot be stopped, only contained. you make everything a party.', track: 2 },
    rage: { title: 'bodies', artist: 'drowning pool', emoji: '💀', desc: 'you have exactly one volume setting: maximum. everyone is slightly afraid of you and you love it.', track: null }
};
function openQuiz() {
    const { body } = createAppWindow('which track are you?', { icon: 'psychology', width: 360 });
    body.classList.add('doc-body');
    let step = 0;
    const scores = { matrix: 0, goth: 0, euro: 0, rage: 0 };

    const render = () => {
        if (step >= QUIZ.length) return showResult();
        const q = QUIZ[step];
        body.innerHTML = `
            <div class="quiz-progress bevel-in"><div class="quiz-fill" style="width:${(step / QUIZ.length) * 100}%"></div>
                <span>question ${step + 1} of ${QUIZ.length}</span></div>
            <h2 class="quiz-q">${escapeHtml(q.q)}</h2>
            <div class="quiz-answers">${q.a.map((a, i) =>
            `<button class="bevel-out quiz-a" data-i="${i}">${escapeHtml(a.t)}</button>`).join('')}</div>`;
        body.querySelectorAll('.quiz-a').forEach(b => b.onclick = () => {
            scores[q.a[+b.dataset.i].s]++;
            step++;
            playSound('click');
            render();
        });
    };
    const showResult = () => {
        const win = Object.keys(scores).reduce((a, b) => scores[a] >= scores[b] ? a : b);
        const r = QUIZ_RESULTS[win];
        body.innerHTML = `
            <div class="quiz-result">
                <div class="quiz-emoji">${r.emoji}</div>
                <p class="quiz-label">you are...</p>
                <h2 class="quiz-title">${escapeHtml(r.title)}</h2>
                <p class="quiz-artist">${escapeHtml(r.artist)}</p>
                <p class="quiz-desc">${escapeHtml(r.desc)}</p>
                <div class="quiz-actions">
                    ${r.track !== null ? '<button class="bevel-out doc-btn" id="quiz-play">play it</button>' : ''}
                    <button class="bevel-out doc-btn" id="quiz-again">try again</button>
                    <button class="bevel-out doc-btn" id="quiz-share">copy result</button>
                </div>
            </div>`;
        playSound('ding');
        launchConfetti(60);
        unlockAchievement('quiz');
        const playBtn = body.querySelector('#quiz-play');
        if (playBtn) playBtn.onclick = () => {
            if (typeof tracks !== 'undefined' && tracks[r.track]) {
                currentTrackIndex = r.track; loadTrack(r.track); playTrack();
            }
        };
        body.querySelector('#quiz-again').onclick = () => {
            step = 0; Object.keys(scores).forEach(k => scores[k] = 0); render();
        };
        body.querySelector('#quiz-share').onclick = () => {
            const txt = `i took the quiz on mrhakan's shithole and i am "${r.title}" by ${r.artist} ${r.emoji} — https://mrhakan.github.io`;
            if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => { });
            showToast('quiz', 'result copied! go brag about it');
        };
    };
    render();
}

// ---------- status widget in the tray ----------
async function initStatusWidget() {
    const tray = document.querySelector('#taskbar .bevel-in');
    if (!tray) return;
    try {
        const d = (await loadSiteData()).status;
        const el = document.createElement('button');
        el.id = 'tray-status';
        el.className = 'tray-status';
        el.title = 'what mrhakan is up to';
        el.innerHTML = `<span>${d.emoji}</span><span class="tray-status-txt">${escapeHtml(d.text)}</span>`;
        el.onclick = () => showRetroDialog({
            title: 'current status',
            lines: [`${d.emoji}  ${d.text}`, `set on ${d.updated}`, 'see now.txt for the full story.'],
            okLabel: 'ok', cancelLabel: 'open now.txt',
            onOk: () => { }
        });
        tray.parentElement.insertBefore(el, tray);
    } catch (e) { /* no status, no problem */ }
}

// ---------- boot ----------
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initStatusWidget, 600);
});
