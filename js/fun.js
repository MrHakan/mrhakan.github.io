// ===================================================================
// mrhakan 98 — fun stuff: achievements, effects, toys, shortcuts
// ===================================================================

// ---------- achievements ----------
const ACHIEVEMENTS = {
    firstboot: { icon: '💾', name: 'hello world', desc: 'booted the shithole' },
    signer: { icon: '✍️', name: 'certified bradar', desc: 'signed the guestbook' },
    konami: { icon: '🎮', name: 'up up down down', desc: 'entered the konami code' },
    hacker: { icon: '💀', name: 'h4x0r', desc: 'read passwords.txt' },
    terminal: { icon: '⌨️', name: 'command line warrior', desc: 'used the terminal' },
    snake10: { icon: '🐍', name: 'snake charmer', desc: 'scored 10 in snake' },
    pong: { icon: '🏓', name: 'pong champion', desc: 'beat the cpu 5 times' },
    minesweeper: { icon: '🚩', name: 'bomb defuser', desc: 'won minesweeper' },
    painter: { icon: '🎨', name: 'digital picasso', desc: 'saved a painting' },
    writer: { icon: '📝', name: 'novelist', desc: 'saved a notepad file' },
    sparta: { icon: '💥', name: 'system destroyer', desc: 'ended every process' },
    bsod: { icon: '🟦', name: 'blue screen of death', desc: 'crashed windows' },
    party: { icon: '🪩', name: 'party animal', desc: 'activated party mode' },
    explorer: { icon: '🖥️', name: 'explorer', desc: 'opened my computer' },
    cleaner: { icon: '🗑️', name: 'marie kondo', desc: 'emptied the recycle bin' },
    decorator: { icon: '🖼️', name: 'interior designer', desc: 'changed the wallpaper' },
    dialup: { icon: '☎️', name: 'you got mail', desc: 'connected via dial-up' },
    charmap: { icon: '🔣', name: 'ascii artist', desc: 'used the character map' },
    nice: { icon: '😎', name: 'nice', desc: 'calculated a funny number' },
    dj: { icon: '🎧', name: 'the dj', desc: 'played 3 different tracks' },
    fortune: { icon: '🥠', name: 'seeker', desc: 'asked the magic 8-ball' },
    voter: { icon: '🗳️', name: 'democracy', desc: 'voted in the poll' },
    nosy: { icon: '👀', name: 'nosy', desc: 'read the /now page' },
    shrine: { icon: '⛩️', name: 'pilgrim', desc: 'visited the shrine' },
    linkback: { icon: '🔗', name: 'webmaster', desc: 'copied the 88x31 link-to-me code' },
    quiz: { icon: '🔮', name: 'know thyself', desc: 'found out which track you are' },
    solitaire: { icon: '🃏', name: 'card shark', desc: 'won a game of solitaire' },
    jokerz: { icon: '🎰', name: 'the run begins', desc: 'opened jokerz 98' },
    jokerz_ante: { icon: '🂡', name: 'small time', desc: 'cleared ante 3 in jokerz 98' },
    jokerz_win: { icon: '👑', name: 'beat the house', desc: 'cleared ante 8 in jokerz 98' },
    troll_problem: { icon: '🛡️', name: 'sir, indeed', desc: 'opened sir, we have a troll problem' },
    troll_wave_5: { icon: '🪓', name: 'outskirts cleared', desc: 'cleared wave 5 in troll problem' },
    troll_wave_10: { icon: '🌉', name: 'bridge holds', desc: 'cleared wave 10 in troll problem' },
    troll_wave_15: { icon: '🌲', name: 'the woods are quiet now', desc: 'cleared wave 15 in troll problem' },
    troll_wave_20: { icon: '🏰', name: 'gates unbreached', desc: 'cleared wave 20 in troll problem' },
    troll_wave_25: { icon: '⚔️', name: 'throne room', desc: 'cleared wave 25 in troll problem' },
    troll_king_slain: { icon: '👑', name: 'problem solved', desc: 'defeated the troll king' },
    become_user: { icon: '🖥️', name: 'still running', desc: 'started become user' },
    become_user_end: { icon: '🕛', name: 'y2k compliant', desc: 'reached an ending in become user' },
    become_user_all: { icon: '🌿', name: 'every branch', desc: 'found 4 endings in become user' },
    theme_maker: { icon: '🎨', name: 'interior decorator', desc: 'opened the theme maker' },
    theme_publisher: { icon: '📮', name: 'shipped it', desc: 'sent a theme off as a pull request' },
    echoes: { icon: '🌊', name: 'tidewalker', desc: 'sailed out in echoes of the tide' },
    'echoes-ten': { icon: '⚓', name: 'sea legs', desc: 'reached level 10 in the Sunken Firmament' },
    'echoes-faction': { icon: '🏴', name: 'signed', desc: 'put your name to one of the three tables' },
    'echoes-lord': { icon: '💀', name: 'properly drowned', desc: 'ended a Drowned Lord for good' },
    'echoes-boss': { icon: '🐋', name: 'the thing at the bottom', desc: 'put down something with phases' },
    'echoes-masterwork': { icon: '🔨', name: 'masterwork', desc: 'pulled a masterwork off the deep-forge' },
    'echoes-relic': { icon: '🧭', name: 'relic band', desc: 'landed something that should not have been down there' },
    'echoes-codex': { icon: '📖', name: 'read it all', desc: 'completed the codex of the Sunken Firmament' },
    'echoes-end': { icon: '🌅', name: 'the heart', desc: 'reached the Heart of the Sunken Beacon and decided' },
    'echoes-courier': { icon: '📮', name: 'the courier', desc: 'sent a Drowned Lord after somebody else, or took one they sent you' },
    defrag: { icon: '💽', name: 'clean machine', desc: 'defragmented drive C:' },
    reader: { icon: '📰', name: 'subscriber', desc: 'read the devlog' },
    completionist: { icon: '🏆', name: 'completionist', desc: 'unlocked everything else' }
};
function getUnlocked() {
    try { return JSON.parse(localStorage.getItem('achievements') || '{}'); } catch (e) { return {}; }
}
function unlockAchievement(id) {
    if (!ACHIEVEMENTS[id]) return;
    const un = getUnlocked();
    if (un[id]) return;
    un[id] = Date.now();
    localStorage.setItem('achievements', JSON.stringify(un));
    const a = ACHIEVEMENTS[id];
    showAchievementToast(a);
    // completionist unlocks once every other achievement is done
    const ids = Object.keys(ACHIEVEMENTS).filter(k => k !== 'completionist');
    if (id !== 'completionist' && ids.every(k => un[k])) setTimeout(() => unlockAchievement('completionist'), 1800);
}
function showAchievementToast(a) {
    const el = document.createElement('div');
    el.className = 'achv-toast bevel-out';
    el.innerHTML = `<div class="achv-icon">${a.icon}</div>
        <div><div class="achv-head">achievement unlocked!</div>
        <div class="achv-name">${escapeHtml(a.name)}</div>
        <div class="achv-desc">${escapeHtml(a.desc)}</div></div>`;
    document.body.appendChild(el);
    playSound('ding');
    setTimeout(() => el.classList.add('fading'), 3400);
    setTimeout(() => el.remove(), 4000);
}
function openAchievements() {
    const { body } = createAppWindow('achievements', { icon: 'emoji_events', width: 340 });
    const un = getUnlocked();
    const total = Object.keys(ACHIEVEMENTS).length;
    const got = Object.keys(un).filter(k => ACHIEVEMENTS[k]).length;
    body.innerHTML = `
        <div class="achv-progress bevel-in"><div class="achv-progress-fill" style="width:${(got / total) * 100}%"></div>
            <span>${got} / ${total} unlocked</span></div>
        <div class="achv-list">${Object.entries(ACHIEVEMENTS).map(([id, a]) => {
        const has = !!un[id];
        return `<div class="achv-row${has ? '' : ' locked'}">
                <span class="achv-row-icon">${has ? a.icon : '🔒'}</span>
                <span><b>${has ? escapeHtml(a.name) : '???'}</b><br><small>${has ? escapeHtml(a.desc) : 'keep exploring bradar'}</small></span>
            </div>`;
    }).join('')}</div>`;
}

// ---------- snow ----------
let snowRAF = null;
function startSnow() {
    if (document.getElementById('snow-canvas')) return;
    const cv = document.createElement('canvas');
    cv.id = 'snow-canvas';
    cv.className = 'fx-canvas';
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    const resize = () => { cv.width = window.innerWidth; cv.height = window.innerHeight; };
    resize(); window.addEventListener('resize', resize);
    const flakes = Array.from({ length: 90 }, () => ({
        x: Math.random() * cv.width, y: Math.random() * cv.height,
        r: Math.random() * 3 + 1, s: Math.random() * 1.2 + 0.4, d: Math.random() * 2
    }));
    let t = 0;
    const draw = () => {
        snowRAF = requestAnimationFrame(draw);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        t += 0.01;
        flakes.forEach(f => {
            f.y += f.s; f.x += Math.sin(t + f.d) * 0.6;
            if (f.y > cv.height) { f.y = -5; f.x = Math.random() * cv.width; }
            ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
        });
    };
    draw();
    cv._resize = resize;
    showToast('winter.exe', 'let it snow bradar');
}
function stopSnow() {
    const cv = document.getElementById('snow-canvas');
    if (!cv) return;
    cancelAnimationFrame(snowRAF); snowRAF = null;
    if (cv._resize) window.removeEventListener('resize', cv._resize);
    cv.remove();
}
function toggleSnow() { document.getElementById('snow-canvas') ? stopSnow() : startSnow(); }

// ---------- confetti ----------
function launchConfetti(count) {
    const n = count || 90;
    const colors = ['#0df259', '#ff00ff', '#ffff00', '#00ffff', '#ff6600', '#fff'];
    for (let i = 0; i < n; i++) {
        const p = document.createElement('div');
        p.className = 'confetti-bit';
        p.style.left = `${Math.random() * 100}vw`;
        p.style.background = colors[(Math.random() * colors.length) | 0];
        p.style.animationDuration = `${2 + Math.random() * 2}s`;
        p.style.animationDelay = `${Math.random() * 0.5}s`;
        p.style.transform = `rotate(${Math.random() * 360}deg)`;
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 4600);
    }
}

// ---------- click fireworks ----------
let fireworksOn = false;
function toggleFireworks() {
    fireworksOn = !fireworksOn;
    showToast('fireworks.exe', fireworksOn ? 'click anywhere to launch!' : 'fireworks off');
    document.body.style.cursor = fireworksOn ? 'crosshair' : '';
}
function fireworkAt(x, y) {
    const colors = ['#ff0055', '#0df259', '#ffcc00', '#00ccff', '#ff00ff'];
    const c = colors[(Math.random() * colors.length) | 0];
    for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const dist = 40 + Math.random() * 60;
        const p = document.createElement('div');
        p.className = 'fw-spark';
        p.style.left = `${x}px`; p.style.top = `${y}px`;
        p.style.background = c;
        p.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
        p.style.setProperty('--dy', `${Math.sin(a) * dist}px`);
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 900);
    }
}
document.addEventListener('click', (e) => {
    if (!fireworksOn) return;
    if (e.target.closest('button, a, input, textarea, select')) return;
    fireworkAt(e.clientX, e.clientY);
});

// ---------- bubbles ----------
let bubbleTimer = null;
function toggleBubbles() {
    if (bubbleTimer) {
        clearInterval(bubbleTimer); bubbleTimer = null;
        document.querySelectorAll('.bubble').forEach(b => b.remove());
        showToast('bubbles', 'bubbles popped');
        return;
    }
    bubbleTimer = setInterval(() => {
        const b = document.createElement('div');
        b.className = 'bubble';
        const size = 12 + Math.random() * 34;
        b.style.width = b.style.height = `${size}px`;
        b.style.left = `${Math.random() * 100}vw`;
        b.style.animationDuration = `${5 + Math.random() * 5}s`;
        b.onclick = () => { b.remove(); playSound('click'); };
        document.body.appendChild(b);
        setTimeout(() => b.remove(), 10500);
    }, 420);
    showToast('bubbles', 'blub blub. click to pop them');
}

// ---------- screen filter modes ----------
const filterModes = ['drunk-mode', 'upside-down', 'pixelate-mode', 'rainbow-mode', 'invert-mode', 'blur-mode'];
function toggleMode(cls, label) {
    const on = document.body.classList.toggle(cls);
    showToast('display', `${label} ${on ? 'ON' : 'OFF'}`);
    playSound(on ? 'notify' : 'click');
    return on;
}
function toggleDrunk() { toggleMode('drunk-mode', 'drunk mode'); }
function toggleUpsideDown() { toggleMode('upside-down', 'australia mode'); }
function togglePixelate() { toggleMode('pixelate-mode', 'low resolution'); }
function toggleRainbow() { toggleMode('rainbow-mode', 'rainbow text'); }
function toggleInvert() { toggleMode('invert-mode', 'negative colors'); }
function toggleDiscoFloor() {
    const on = document.body.classList.toggle('disco-floor');
    showToast('disco', on ? 'the floor is lava (but disco)' : 'disco over');
}
function resetAllModes() {
    filterModes.forEach(m => document.body.classList.remove(m));
    document.body.classList.remove('disco-floor', 'party-mode');
    stopSnow();
    if (bubbleTimer) { clearInterval(bubbleTimer); bubbleTimer = null; document.querySelectorAll('.bubble').forEach(b => b.remove()); }
    fireworksOn = false; document.body.style.cursor = '';
    stopGravity();
    showToast('display', 'everything back to normal. boring.');
}

// ---------- gravity mode (everything falls) ----------
let gravityRAF = null, gravityItems = [];
function startGravity() {
    if (gravityRAF) return;
    const targets = Array.from(document.querySelectorAll(
        '#main-window, #winamp-window, #shoutbox-window, .app-window, .ie-window, #taskbar'
    ));
    gravityItems = targets.map(el => {
        const r = el.getBoundingClientRect();
        el.style.position = 'fixed';
        el.style.left = `${r.left}px`;
        el.style.top = `${r.top}px`;
        el.style.width = `${r.width}px`;
        el.style.margin = '0';
        return { el, x: r.left, y: r.top, w: r.width, h: r.height, vy: 0, vx: (Math.random() - 0.5) * 3, rot: 0, vr: (Math.random() - 0.5) * 6 };
    });
    const stepFn = () => {
        gravityRAF = requestAnimationFrame(stepFn);
        gravityItems.forEach(it => {
            it.vy += 0.8;
            it.y += it.vy; it.x += it.vx; it.rot += it.vr;
            const floor = window.innerHeight - it.h;
            if (it.y > floor) { it.y = floor; it.vy *= -0.42; it.vx *= 0.8; it.vr *= 0.6; }
            if (it.x < 0 || it.x + it.w > window.innerWidth) { it.vx *= -0.7; it.x = Math.max(0, Math.min(it.x, window.innerWidth - it.w)); }
            it.el.style.top = `${it.y}px`;
            it.el.style.left = `${it.x}px`;
            it.el.style.transform = `rotate(${it.rot}deg)`;
        });
    };
    stepFn();
    showToast('gravity.sys', 'oh no. type "gravity" again or refresh to fix it');
}
function stopGravity() {
    if (!gravityRAF) return;
    cancelAnimationFrame(gravityRAF); gravityRAF = null;
    gravityItems.forEach(it => {
        it.el.style.transform = '';
        it.el.style.position = ''; it.el.style.left = ''; it.el.style.top = '';
        it.el.style.width = ''; it.el.style.margin = '';
    });
    gravityItems = [];
    showToast('gravity.sys', 'gravity restored. you are welcome');
}
function toggleGravity() { gravityRAF ? stopGravity() : startGravity(); }

// ---------- magic 8-ball ----------
const eightBallAnswers = [
    'it is certain', 'without a doubt', 'yes definitely', 'you may rely on it',
    'most likely bradar', 'outlook good', 'signs point to yes',
    'reply hazy, try again', 'ask again later', 'better not tell you now',
    'concentrate and ask again', "don't count on it", 'my reply is no',
    'my sources say no', 'outlook not so good', 'very doubtful',
    'lol no', 'absolutely bradar', 'have you tried turning it off and on again'
];
function openMagic8Ball() {
    const { body } = createAppWindow('magic 8-ball', { icon: 'psychology', width: 280 });
    body.innerHTML = `
        <div class="ball-wrap">
            <div class="magic-ball" id="magic-ball"><span id="ball-text">ask me</span></div>
        </div>
        <input id="ball-q" class="bevel-in ball-input" placeholder="ask a yes/no question...">
        <button class="bevel-out ball-btn" id="ball-go">shake it</button>`;
    const ball = body.querySelector('#magic-ball'), txt = body.querySelector('#ball-text');
    const q = body.querySelector('#ball-q');
    q.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') shake(); });
    const shake = () => {
        ball.classList.remove('shaking'); void ball.offsetWidth; ball.classList.add('shaking');
        txt.textContent = '...';
        playSound('notify');
        setTimeout(() => {
            txt.textContent = eightBallAnswers[(Math.random() * eightBallAnswers.length) | 0];
            unlockAchievement('fortune');
        }, 900);
    };
    body.querySelector('#ball-go').onclick = shake;
}

// ---------- fortune / roast / hacker name ----------
const fortunes = [
    'you will sign a guestbook today.', 'a mysterious bradar will enter your life.',
    'your code compiles on the first try. (in another universe)',
    'beware of mondays and unclosed brackets.', 'great vibes are coming your way.',
    'the wifi will be strong in your house tonight.', 'you left the stove on. probably.',
    'someone is thinking about your website right now.',
    'your next commit message will be "fix".', 'touch grass. then come back.'
];
const roasts = [
    'you look like you use light mode.', 'your playlist is mid and you know it.',
    'you probably say "per my last email".', 'bro really opened the roast machine.',
    'you use spaces instead of tabs. disgusting.', 'your browser has 47 tabs open right now.',
    'you laughed at a minion meme once. we know.', 'you still say "epic".',
    'your password is definitely 123456.', 'nice site you got there. wait, that is mine.'
];
const hackerFirst = ['Xx', 'Dark', 'Cyber', 'Neo', 'Ghost', 'Zero', 'Mega', 'Turbo', 'Lord', 'Toxic'];
const hackerLast = ['Slayer69', 'Hunter', 'Bradar', 'Destroyer', 'Ninja', 'Sniper420', 'Wizard', 'Troll', 'Phantom', 'Overlord'];
function randomOf(a) { return a[(Math.random() * a.length) | 0]; }
function showFortune() {
    showRetroDialog({ title: 'fortune.exe', lines: ['🥠 ' + randomOf(fortunes)], okLabel: 'thanks i guess' });
    unlockAchievement('fortune');
}
function roastMe() {
    playSound('error');
    showRetroDialog({ title: 'roast.exe', lines: ['🔥 ' + randomOf(roasts)], okLabel: 'ouch', cancelLabel: 'again', onOk: () => { } });
}
function hackerName() {
    const name = `${randomOf(hackerFirst)}${randomOf(hackerLast)}${randomOf(['', 'xX', '_', '99'])}`;
    showRetroDialog({
        title: 'l33t name generator',
        lines: ['your hacker name is:', name, '(use it responsibly)'],
        okLabel: 'copy it',
        cancelLabel: 'reroll',
        onOk: () => { navigator.clipboard && navigator.clipboard.writeText(name).catch(() => { }); showToast('l33t', 'copied bradar'); }
    });
}
function moodRing() {
    const h = new Date().getHours();
    const moods = h < 6 ? ['🌙', 'nocturnal gremlin', '#6b21a8'] : h < 12 ? ['☕', 'barely awake', '#f59e0b']
        : h < 18 ? ['😎', 'peak performance', '#0df259'] : h < 22 ? ['🍕', 'cozy chaos', '#ec4899'] : ['🦉', 'terminally online', '#3b82f6'];
    showRetroDialog({ title: 'mood ring', lines: [`${moods[0]}  your current mood:`, moods[1], `ring color: ${moods[2]}`], okLabel: 'accurate' });
}
const horoscopes = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
function showHoroscope() {
    const sign = randomOf(horoscopes);
    showRetroDialog({
        title: 'horoscope.txt',
        lines: [`♒ ${sign}:`, randomOf(fortunes), 'lucky number: ' + ((Math.random() * 99) | 0), 'lucky website: this one'],
        okLabel: 'wow so true'
    });
}

// ---------- visitor poll ----------
const POLL_Q = 'best era of the internet?';
const POLL_OPTS = ['90s geocities', 'y2k flash games', '2010s forums', 'today (cringe)'];
function openPoll() {
    const { body } = createAppWindow('visitor poll', { icon: 'poll', width: 300 });
    let votes;
    try { votes = JSON.parse(localStorage.getItem('poll-votes') || 'null'); } catch (e) { votes = null; }
    if (!votes || votes.length !== POLL_OPTS.length) votes = [37, 52, 24, 3];
    const myVote = localStorage.getItem('poll-mine');
    const render = () => {
        const total = votes.reduce((a, b) => a + b, 0) || 1;
        body.innerHTML = `<p class="poll-q">${escapeHtml(POLL_Q)}</p>
            ${POLL_OPTS.map((o, i) => {
            const pct = Math.round((votes[i] / total) * 100);
            const mine = String(i) === myVote;
            return `<div class="poll-row">
                    <button class="poll-opt${mine ? ' voted' : ''}" data-i="${i}"${myVote ? ' disabled' : ''}>${escapeHtml(o)}${mine ? ' ✓' : ''}</button>
                    <div class="poll-bar bevel-in"><div class="poll-fill" style="width:${pct}%"></div><span>${pct}% (${votes[i]})</span></div>
                </div>`;
        }).join('')}
            <p class="poll-total">${total} votes &middot; ${myVote ? 'thanks for voting bradar' : 'pick one'}</p>`;
        body.querySelectorAll('.poll-opt').forEach(b => b.onclick = () => {
            const i = +b.dataset.i;
            votes[i]++;
            localStorage.setItem('poll-votes', JSON.stringify(votes));
            localStorage.setItem('poll-mine', String(i));
            playSound('ding');
            unlockAchievement('voter');
            render();
        });
    };
    render();
}

// ---------- site stats ----------
function openSiteStats() {
    const { body, win } = createAppWindow('site statistics', { icon: 'monitoring', width: 300 });
    const start = Date.now();
    const un = getUnlocked();
    const render = () => {
        const secs = Math.floor((Date.now() - start) / 1000);
        const mm = String(Math.floor(secs / 60)).padStart(2, '0'), ss = String(secs % 60).padStart(2, '0');
        body.innerHTML = `<div class="stats-list">
            <div><span>time on site</span><b>${mm}:${ss}</b></div>
            <div><span>visitors</span><b>${document.getElementById('visitor-count')?.textContent || '?'}</b></div>
            <div><span>achievements</span><b>${Object.keys(un).length} / ${Object.keys(ACHIEVEMENTS).length}</b></div>
            <div><span>tracks loaded</span><b>${(typeof tracks !== 'undefined' ? tracks.length : 0)}</b></div>
            <div><span>windows open</span><b>${document.querySelectorAll('.app-window, .ie-window').length}</b></div>
            <div><span>sound</span><b>${(typeof soundEnabled !== 'undefined' && soundEnabled) ? 'ON' : 'OFF'}</b></div>
            <div><span>snake best</span><b>${localStorage.getItem('snake-best') || 0}</b></div>
            <div><span>browser</span><b>${(navigator.userAgent.match(/(Firefox|Edg|Chrome|Safari)/) || ['IE4'])[0]}</b></div>
            <div><span>screen</span><b>${screen.width}x${screen.height}</b></div>
            <div><span>vibes</span><b class="stats-vibe">MAXIMUM</b></div>
        </div>`;
    };
    render();
    const t = setInterval(render, 1000);
    const orig = win._cleanup;
    win._cleanup = () => { clearInterval(t); orig && orig(); };
}

// ---------- web ring ----------
function openWebRing() {
    const { body } = createAppWindow('the shithole web ring', { icon: 'public', width: 320 });
    body.innerHTML = `
        <div class="webring">
            <img src="https://cyber.dabamos.de/88x31/geocities.gif" alt="" class="webring-badge" onerror="this.style.display='none'">
            <p>you are visitor of the <b>retro web ring</b> — a chain of sites that refuse to look modern.</p>
            <div class="webring-nav">
                <a href="https://neocities.org/browse?sort_by=random" target="_blank" rel="noopener" class="bevel-out">&laquo; prev</a>
                <a href="https://neocities.org" target="_blank" rel="noopener" class="bevel-out">ring hub</a>
                <a href="https://theoldnet.com" target="_blank" rel="noopener" class="bevel-out">next &raquo;</a>
            </div>
            <p class="webring-small">want to join? sign the guestbook and ask nicely.</p>
        </div>`;
}

// ---------- desktop right-click context menu ----------
const contextItems = [
    { label: 'refresh', icon: 'refresh', act: () => { showToast('desktop', 'refreshed (nothing happened)'); playSound('click'); } },
    { label: 'display properties', icon: 'wallpaper', act: () => openControlPanel() },
    { label: 'new folder', icon: 'folder', act: () => showToast('desktop', 'cannot create folder: disk full of vibes') },
    { label: 'let it snow', icon: 'ac_unit', act: () => toggleSnow() },
    { label: 'confetti', icon: 'celebration', act: () => { launchConfetti(); playSound('ding'); } },
    { label: 'achievements', icon: 'emoji_events', act: () => openAchievements() },
    { label: 'site stats', icon: 'monitoring', act: () => openSiteStats() },
    { label: 'reset effects', icon: 'settings', act: () => resetAllModes() }
];
function initContextMenu() {
    const menu = document.createElement('div');
    menu.id = 'ctx-menu';
    menu.className = 'bevel-out';
    menu.innerHTML = contextItems.map((it, i) =>
        `<button class="ctx-item" data-i="${i}"><span class="material-symbols-outlined">${it.icon}</span>${escapeHtml(it.label)}</button>`
    ).join('');
    document.body.appendChild(menu);
    menu.querySelectorAll('.ctx-item').forEach(b => b.onclick = () => {
        menu.classList.remove('open');
        contextItems[+b.dataset.i].act();
    });
    document.addEventListener('contextmenu', (e) => {
        // let the browser menu through inside real inputs and the minesweeper grid
        if (e.target.closest('input, textarea, .ms-cell, a')) return;
        e.preventDefault();
        menu.style.left = `${Math.min(e.clientX, window.innerWidth - 190)}px`;
        menu.style.top = `${Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 45)}px`;
        menu.classList.add('open');
    });
    document.addEventListener('click', () => menu.classList.remove('open'));
}

// ---------- taskbar clock -> calendar ----------
function initCalendarPopup() {
    const clock = document.getElementById('taskbar-clock');
    if (!clock) return;
    clock.style.cursor = 'pointer';
    clock.title = 'click for calendar';
    const pop = document.createElement('div');
    pop.id = 'cal-popup';
    pop.className = 'bevel-out';
    document.body.appendChild(pop);
    const render = () => {
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth();
        const first = new Date(y, m, 1).getDay();
        const days = new Date(y, m + 1, 0).getDate();
        const monthName = now.toLocaleString('en-US', { month: 'long' });
        let cells = '';
        for (let i = 0; i < first; i++) cells += '<span></span>';
        for (let d = 1; d <= days; d++) {
            cells += `<span class="${d === now.getDate() ? 'cal-today' : ''}">${d}</span>`;
        }
        pop.innerHTML = `<div class="cal-head">${monthName} ${y}</div>
            <div class="cal-grid cal-dow"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
            <div class="cal-grid">${cells}</div>
            <div class="cal-foot">${now.toLocaleTimeString()}</div>`;
    };
    clock.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = pop.classList.toggle('open');
        if (open) { render(); playSound('click'); }
    });
    document.addEventListener('click', (e) => { if (!pop.contains(e.target)) pop.classList.remove('open'); });
}

// ---------- keyboard shortcuts + help overlay ----------
const SHORTCUTS = [
    ['Ctrl + Alt + Del', 'task manager'],
    ['F1', 'help / about'],
    ['F2', 'achievements'],
    ['F3', 'find: files'],
    ['F4', 'terminal'],
    ['?', 'this shortcut list'],
    ['Esc', 'close top window / stop chaos'],
    ['konami code', 'you know what it does'],
    ['type: party, troll, bsod', 'chaos words'],
    ['type: snow, disco, drunk', 'more chaos words'],
    ['type: gravity, sparta, 8ball', 'even more'],
    ['type: solitaire, defrag', 'the good windows programs'],
    ['type: jokerz or balatro', 'the poker roguelike'],
    ['type: troll or orcs', 'sir, we have a troll problem'],
    ['type: wizardz or duel', 'draw spells at another wizard'],
    ['type: bot', '1 v bot — pick an opponent'],
    ['type: lobby', 'the multiplayer lobby'],
    ['right-click desktop', 'context menu']
];
function showShortcuts() {
    const { body } = createAppWindow('keyboard shortcuts', { icon: 'key', width: 330 });
    body.innerHTML = `<div class="shortcut-list">${SHORTCUTS.map(([k, d]) =>
        `<div class="shortcut-row"><kbd>${escapeHtml(k)}</kbd><span>${escapeHtml(d)}</span></div>`).join('')}</div>`;
}
function initShortcuts() {
    document.addEventListener('keydown', (e) => {
        const tag = (e.target.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea';
        if (e.ctrlKey && e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault(); openTaskManager(); return;
        }
        if (typing) return;
        if (e.key === 'F1') { e.preventDefault(); handleTab('help'); }
        else if (e.key === 'F2') { e.preventDefault(); openAchievements(); }
        else if (e.key === 'F3') { e.preventDefault(); openFindFiles(); }
        else if (e.key === 'F4') { e.preventDefault(); openTerminal(); }
        else if (e.key === '?') { e.preventDefault(); showShortcuts(); }
        else if (e.key === 'Escape') {
            // in fullscreen, escape belongs to the browser — closing the window
            // as well would yank the game out from under you
            if (typeof fullscreenSwallowsEscape === 'function' && fullscreenSwallowsEscape()) return;
            const wins = document.querySelectorAll('.app-window, .ie-window');
            if (wins.length) closeAppWindow(wins[wins.length - 1].id) || wins[wins.length - 1].remove();
        }
    });
}

// ---------- extra secret words ----------
function initExtraSecrets() {
    const words = {
        snow: toggleSnow,
        disco: toggleDiscoFloor,
        drunk: toggleDrunk,
        flip: toggleUpsideDown,
        pixel: togglePixelate,
        rainbow: toggleRainbow,
        invert: toggleInvert,
        gravity: toggleGravity,
        bubbles: toggleBubbles,
        confetti: () => { launchConfetti(140); playSound('ding'); },
        boom: () => { toggleFireworks(); },
        snake: () => openSnake(),
        pong: () => openPong(),
        solitaire: () => openSolitaire(),
        jokerz: () => openBalatro(),
        balatro: () => openBalatro(),
        troll: () => openTrollProblem(),
        orcs: () => openTrollProblem(),
        wizardz: () => openWizardz(),
        duel: () => openWizardz(),
        bot: () => openWizardz('bot'),
        lobby: () => openNetplay(),
        defrag: () => openDefrag(),
        roast: roastMe,
        fortune: showFortune,
        l33t: hackerName,
        mood: moodRing,
        reset: resetAllModes
    };
    let buf = '';
    document.addEventListener('keydown', (e) => {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key.length !== 1) return;
        buf = (buf + e.key.toLowerCase()).slice(-12);
        for (const w of Object.keys(words)) {
            if (buf.endsWith(w)) { buf = ''; words[w](); break; }
        }
    });
}

// ---------- winamp extras: equalizer, search, favorites, scope ----------
const EQ_BANDS = [60, 250, 1000, 4000, 12000];
let eqFilters = null;
function openEqualizer() {
    const { body } = createAppWindow('winamp equalizer', { icon: 'graphic_eq', width: 300 });
    body.innerHTML = `<div class="eq-rack">${EQ_BANDS.map((f, i) => `
        <label class="eq-band">
            <input type="range" class="eq-slider" data-i="${i}" min="-12" max="12" value="0" step="1" orient="vertical">
            <span>${f >= 1000 ? (f / 1000) + 'k' : f}</span>
        </label>`).join('')}</div>
        <div class="eq-presets">
            <button class="bevel-out eq-preset" data-p="flat">flat</button>
            <button class="bevel-out eq-preset" data-p="bass">bass</button>
            <button class="bevel-out eq-preset" data-p="vocal">vocal</button>
            <button class="bevel-out eq-preset" data-p="nuke">nuke it</button>
        </div>
        <p class="eq-note">play a track first — the eq hooks into the audio graph</p>`;

    const setup = () => {
        // reuse the analyser graph built by index.js; insert filters before it
        if (eqFilters || typeof audioContext === 'undefined' || !audioContext) return;
        try {
            eqFilters = EQ_BANDS.map((f, i) => {
                const filt = audioContext.createBiquadFilter();
                filt.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
                filt.frequency.value = f; filt.Q.value = 1; filt.gain.value = 0;
                return filt;
            });
            // chain: analyser -> f0 -> f1 ... -> destination
            analyser.disconnect();
            let node = analyser;
            eqFilters.forEach(f => { node.connect(f); node = f; });
            node.connect(audioContext.destination);
        } catch (e) { eqFilters = null; }
    };
    const applyGains = (gains) => {
        setup();
        if (!eqFilters) return;
        gains.forEach((g, i) => { if (eqFilters[i]) eqFilters[i].gain.value = g; });
    };
    body.querySelectorAll('.eq-slider').forEach(s => s.addEventListener('input', () => {
        const gains = Array.from(body.querySelectorAll('.eq-slider')).map(x => +x.value);
        applyGains(gains);
    }));
    const presets = { flat: [0, 0, 0, 0, 0], bass: [10, 6, 0, 2, 4], vocal: [-4, 0, 6, 4, 0], nuke: [12, 12, 12, 12, 12] };
    body.querySelectorAll('.eq-preset').forEach(b => b.onclick = () => {
        const g = presets[b.dataset.p];
        body.querySelectorAll('.eq-slider').forEach((s, i) => s.value = g[i]);
        applyGains(g);
        playSound('click');
        if (b.dataset.p === 'nuke') showToast('equalizer', 'your speakers hate you now');
    });
}

// oscilloscope window fed by the existing analyser
function openOscilloscope() {
    const { body, win } = createAppWindow('oscilloscope', { icon: 'graphic_eq', width: 280 });
    body.innerHTML = `<canvas id="scope-canvas" width="256" height="120" class="bevel-in scope-canvas"></canvas>
        <p class="game-hint">play a track to see the waveform</p>`;
    const cv = body.querySelector('#scope-canvas'), ctx = cv.getContext('2d');
    let raf, phase = 0;
    const draw = () => {
        raf = requestAnimationFrame(draw);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.strokeStyle = '#0df259'; ctx.lineWidth = 2; ctx.beginPath();
        if (typeof analyser !== 'undefined' && analyser && typeof dataArray !== 'undefined' && dataArray) {
            analyser.getByteFrequencyData(dataArray);
            for (let i = 0; i < dataArray.length; i++) {
                const x = (i / dataArray.length) * cv.width;
                const y = cv.height - (dataArray[i] / 255) * cv.height;
                i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
        } else {
            // idle sine so the window isn't dead before playback starts
            phase += 0.05;
            for (let x = 0; x < cv.width; x++) {
                const y = cv.height / 2 + Math.sin(x * 0.05 + phase) * 12;
                x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
        }
        ctx.stroke();
    };
    draw();
    const orig = win._cleanup;
    win._cleanup = () => { cancelAnimationFrame(raf); orig && orig(); };
}

function initPlaylistSearch() {
    const list = document.getElementById('winamp-playlist');
    if (!list || document.getElementById('pl-search')) return;
    const inp = document.createElement('input');
    inp.id = 'pl-search';
    inp.className = 'pl-search bevel-in';
    inp.placeholder = 'search tracks...';
    list.parentElement.insertBefore(inp, list);
    inp.addEventListener('keydown', e => e.stopPropagation());
    inp.addEventListener('input', () => {
        const q = inp.value.toLowerCase();
        Array.from(list.children).forEach(ch => {
            ch.style.display = ch.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    });
}

// track how many distinct tracks got played -> dj achievement
const playedTracks = new Set();
function noteTrackPlayed(i) {
    playedTracks.add(i);
    if (playedTracks.size >= 3) unlockAchievement('dj');
}

// ---------- welcome popup ----------
function showWelcomePopup() {
    if (sessionStorage.getItem('welcomed')) return;
    sessionStorage.setItem('welcomed', '1');
    setTimeout(() => {
        const n = document.getElementById('visitor-count')?.textContent || '???';
        showRetroDialog({
            title: 'welcome!',
            lines: [`you are visitor #${n}`, randomOf(fortunes), 'press ? for keyboard shortcuts. right-click the desktop for tricks.'],
            okLabel: 'lets go',
            cancelLabel: 'show me the toys',
            onOk: () => unlockAchievement('firstboot')
        });
        unlockAchievement('firstboot');
    }, 1400);
}

// ---------- boot everything ----------
document.addEventListener('DOMContentLoaded', () => {
    applyDisplayPrefs();
    initContextMenu();
    initCalendarPopup();
    initShortcuts();
    initExtraSecrets();
    setTimeout(initPlaylistSearch, 900);
    showWelcomePopup();
    if (localStorage.getItem('sparkles-off') === '1') {
        document.removeEventListener('mousemove', createSparkle);
    }
});
