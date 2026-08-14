if (typeof tailwind === 'undefined') window.tailwind = {};
tailwind.config = {
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                "primary": "#0df259",
                "background-light": "#f5f8f6",
                "background-dark": "#102216",
                "retro-gray": "#c0c0c0",
                "retro-blue": "#000080",
                "winamp-base": "#29293d",
            },
            fontFamily: {
                "header": ["Comic Sans MS", "Comic Sans", "cursive"],
                "body": ["Times New Roman", "Times", "serif"],
                "pixel": ["Courier New", "monospace"],
            },
            borderRadius: { "DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem" },
            backgroundImage: {
                'stars': 'radial-gradient(white, rgba(255,255,255,.2) 2px, transparent 3px), radial-gradient(white, rgba(255,255,255,.15) 1px, transparent 2px), radial-gradient(white, rgba(255,255,255,.1) 2px, transparent 3px)',
            }
        },
    },
}
let tracks = [];
let currentTrackIndex = 0;
let isPlaying = false;
let audioContext, analyser, dataArray;

document.addEventListener('DOMContentLoaded', () => {
    const audio = document.getElementById('audio-player');
    initVisitorCounter();
    fetchShoutbox();
    fetchGitHubRepos();
    fetchManualProjects();


    fetch('src/music/music.json')
        .then(response => response.json())
        .then(data => {
            tracks = data;
            initPlaylist();
            // this replaced the array, so an active theme has to put its own
            // track back on the end
            if (typeof themeOnTracksLoaded === 'function') themeOnTracksLoaded();
        })
        .catch(err => console.error('Error loading music:', err));

    if (audio) {
        audio.addEventListener('timeupdate', updateProgressBar);
        audio.addEventListener('ended', nextTrack);
        audio.addEventListener('play', () => {
            initAudioVisualizer();
            applyTheme(tracks[currentTrackIndex]);
        });
    }

    document.addEventListener('mousemove', createSparkle);
    initDraggable();
    initKonamiCode();
    initBootScreen();
    initTaskbarClock();
    initSeekAndVolume();
    initTypedTagline();
    updateSoundUI();
    initCounterEgg();
    initStartFlyouts();
    fetchGitHubUser();
    initScreensaver();
    initAssistant();

    if (window.innerWidth < 768) {
        const mainWindow = document.getElementById('main-window');
        if (mainWindow) mainWindow.style.position = 'relative';
        console.log('PDA mode detected - drag disabled');
    }
});

function initBootScreen() {
    const boot = document.getElementById('boot-screen');
    if (!boot) return;
    if (sessionStorage.getItem('booted')) {
        boot.remove();
        return;
    }
    const log = document.getElementById('boot-log');
    const prompt = document.getElementById('boot-prompt');
    const lines = [
        'mrhakan BIOS v4.20 (c) 1998 shithole industries',
        'CPU: Intel Pentium II 400MHz .......... OK',
        'Memory Test: 65536K ................... OK',
        'Detecting IDE drives .................. OK',
        'Loading shithole.sys .................. OK',
        'Initializing winamp.exe ............... OK',
        'Mounting guestbook.dat ................ OK',
        'Starting mrhakan 98 ...'
    ];
    let ready = false;
    lines.forEach((line, i) => {
        setTimeout(() => {
            const div = document.createElement('div');
            const okIndex = line.lastIndexOf('OK');
            if (okIndex !== -1) {
                div.textContent = line.slice(0, okIndex);
                const ok = document.createElement('span');
                ok.className = 'ok';
                ok.textContent = 'OK';
                div.appendChild(ok);
            } else {
                div.textContent = line;
            }
            log.appendChild(div);
            if (i === lines.length - 1) {
                prompt.classList.add('visible');
                ready = true;
            }
        }, 200 + i * 250);
    });
    const enter = () => {
        if (!ready) return;
        sessionStorage.setItem('booted', '1');
        playSound('startup');
        boot.classList.add('booted');
        document.removeEventListener('keydown', enter);
        setTimeout(() => boot.remove(), 600);
        const desktop = document.querySelector('.container');
        if (desktop) {
            desktop.classList.add('crt-on');
            setTimeout(() => desktop.classList.remove('crt-on'), 700);
        }
    };
    boot.addEventListener('click', enter);
    document.addEventListener('keydown', enter);
}

function initTaskbarClock() {
    const el = document.getElementById('taskbar-clock');
    if (!el) return;
    const tick = () => {
        const d = new Date();
        let h = d.getHours();
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        el.textContent = `${h}:${d.getMinutes().toString().padStart(2, '0')} ${ampm}`;
    };
    tick();
    setInterval(tick, 1000);
}

function initSeekAndVolume() {
    const audio = document.getElementById('audio-player');
    const seek = document.getElementById('winamp-seek');
    const volume = document.getElementById('winamp-volume');
    if (seek && audio) {
        seek.addEventListener('click', (e) => {
            if (!audio.duration) return;
            const rect = seek.getBoundingClientRect();
            const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
            audio.currentTime = ratio * audio.duration;
            updateProgressBar();
        });
    }
    if (volume && audio) {
        audio.volume = volume.value / 100;
        volume.addEventListener('input', () => {
            audio.volume = volume.value / 100;
        });
    }
}

function initTypedTagline() {
    const el = document.getElementById('typed-tagline');
    if (!el) return;
    const strings = [
        'just a simple man trying to make his way in the universe...',
        'dont forget to sign the guestbook!',
        'now playing: absolute bangers only',
        'best viewed at 800x600 with ie4',
        'try the konami code ;)',
        'made with notepad and pure love'
    ];
    if (typeof Typed !== 'undefined') {
        new Typed('#typed-tagline', {
            strings, typeSpeed: 40, backSpeed: 20, backDelay: 2200, loop: true, smartBackspace: false
        });
        return;
    }
    // fallback typewriter (runs if the typed.js file fails to load for any reason)
    let si = 0, ci = 0, deleting = false;
    (function tick() {
        const s = strings[si];
        el.textContent = deleting ? s.slice(0, ci--) : s.slice(0, ci++);
        let delay = deleting ? 20 : 40;
        if (!deleting && ci > s.length) { deleting = true; delay = 2200; }
        else if (deleting && ci < 0) { deleting = false; ci = 0; si = (si + 1) % strings.length; delay = 300; }
        setTimeout(tick, delay);
    })();
}

let startMenuOpen = false;
function toggleStartMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('start-menu');
    if (!menu) return;
    startMenuOpen = !startMenuOpen;
    menu.classList.toggle('hidden', !startMenuOpen);
    if (startMenuOpen) playSound('click');
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('start-menu');
    if (menu && startMenuOpen && !menu.contains(e.target)) {
        startMenuOpen = false;
        menu.classList.add('hidden');
    }
});

// every start-menu / run-dialog entry point lives in one map so the menu,
// the run box and the terminal all stay in sync
function appActions() {
    return {
        discord: copyDiscord,
        shutdown: shutDown,
        run: showRunDialog,
        minesweeper: openMinesweeper,
        paint: openPaint,
        taskmgr: openTaskManager,
        notepad: () => openNotepad(),
        calc: openCalculator,
        terminal: openTerminal,
        charmap: openCharMap,
        clock: openClock,
        mycomputer: openMyComputer,
        recycle: openRecycleBin,
        dialup: openDialUp,
        snake: openSnake,
        pong: openPong,
        achievements: openAchievements,
        '8ball': openMagic8Ball,
        fortune: showFortune,
        roast: roastMe,
        l33t: hackerName,
        mood: moodRing,
        horoscope: showHoroscope,
        poll: openPoll,
        webring: openWebRing,
        snow: toggleSnow,
        confetti: () => { launchConfetti(); playSound('ding'); },
        control: openControlPanel,
        thememaker: launchThemeMaker,
        sysprops: openSystemProperties,
        equalizer: openEqualizer,
        scope: openOscilloscope,
        stats: openSiteStats,
        shortcuts: showShortcuts,
        reset: resetAllModes,
        now: openNowPage,
        usespage: openUsesPage,
        colophon: openColophon,
        changelog: openChangelog,
        buttons: openButtonWall,
        blogroll: openFriends,
        shrine: openShrine,
        nethistory: openInternetHistory,
        sitemap: openSiteMap,
        quiz: openQuiz,
        solitaire: openSolitaire,
        jokerz: openBalatro,
        trollproblem: openTrollProblem,
        becomeuser: openBecomeUser,
        wizardz: () => openWizardz(),
        wizardzbot: () => openWizardz('bot'),
        netplay: () => openNetplay(),
        defrag: openDefrag,
        devlog: openDevlog,
        find: openFindFiles,
        rss: () => window.open('feed.xml', '_blank', 'noopener')
    };
}

function startMenuAction(action) {
    startMenuOpen = false;
    const menu = document.getElementById('start-menu');
    if (menu) { menu.classList.add('hidden'); menu.querySelectorAll('.start-sub.open').forEach(s => s.classList.remove('open')); }
    const actions = appActions();
    if (actions[action]) actions[action]();
    else showSection(action);
}

// start menu flyouts: hover on desktop, tap on touch
function initStartFlyouts() {
    document.querySelectorAll('.start-sub').forEach(sub => {
        const btn = sub.querySelector('.has-sub');
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasOpen = sub.classList.contains('open');
            document.querySelectorAll('.start-sub').forEach(s => s.classList.remove('open'));
            if (!wasOpen) { sub.classList.add('open'); playSound('click'); }
        });
    });
}


// ===== start > run... =====
function showRunDialog() {
    document.querySelectorAll('.retro-dialog-overlay').forEach(d => d.remove());
    const overlay = document.createElement('div');
    overlay.className = 'retro-dialog-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'retro-dialog bevel-out';
    dialog.innerHTML = `
        <div class="retro-dialog-title">run<button class="retro-dialog-close bevel-out" onclick="this.closest('.retro-dialog-overlay').remove()">✕</button></div>
        <div class="retro-dialog-body">
            <p>type the name of a program, folder, or vibe, and windows will open it for you.</p>
            <input id="run-input" class="bevel-in run-input" placeholder="C:\\>" autocomplete="off" spellcheck="false">
            <p style="color:#666;font-size:10px;">try: troll, jokerz, sol, defrag, blog, find, mystify, pipes, snake, pong, calc, notepad, cmd, computer, 8ball, snow, disco, gravity, achievements, help</p>
        </div>
        <div class="retro-dialog-buttons">
            <button class="bevel-out retro-dialog-btn" onclick="execRunCommand()">ok</button>
            <button class="bevel-out retro-dialog-btn" onclick="this.closest('.retro-dialog-overlay').remove()">cancel</button>
        </div>`;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    playSound('notify');
    const input = document.getElementById('run-input');
    input.focus();
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            // prevent the browser's default Enter activation from "clicking"
            // whatever button gets focused by the dialog we open next
            e.preventDefault();
            execRunCommand();
        }
        if (e.key === 'Escape') overlay.remove();
    });
}

function execRunCommand() {
    const input = document.getElementById('run-input');
    const cmd = (input?.value || '').trim().toLowerCase().replace(/\.exe$/, '');
    document.querySelectorAll('.retro-dialog-overlay').forEach(d => d.remove());
    const commands = {
        ...appActions(),
        'home': () => showSection('home'),
        'about': () => showSection('home'),
        'work': () => showSection('github'),
        'projects': () => showSection('github'),
        'links': () => showSection('links'),
        'guestbook': () => showSection('guestbook'),
        'discord': copyDiscord,
        'minesweeper': openMinesweeper,
        'mines': openMinesweeper,
        'paint': openPaint,
        'mspaint': openPaint,
        'taskmgr': openTaskManager,
        'taskmanager': openTaskManager,
        'cmd': openTerminal,
        'command': openTerminal,
        'computer': openMyComputer,
        'bin': openRecycleBin,
        'trash': openRecycleBin,
        'wallpaper': openControlPanel,
        'theme': launchThemeMaker,
        'themes': launchThemeMaker,
        'skin': launchThemeMaker,
        'eq': openEqualizer,
        'scope': openOscilloscope,
        'achievements': openAchievements,
        'achv': openAchievements,
        'ball': openMagic8Ball,
        '8ball': openMagic8Ball,
        'snow': toggleSnow,
        'disco': toggleDiscoFloor,
        'drunk': toggleDrunk,
        'flip': toggleUpsideDown,
        'pixel': togglePixelate,
        'rainbow': toggleRainbow,
        'invert': toggleInvert,
        'gravity': toggleGravity,
        'bubbles': toggleBubbles,
        'fireworks': toggleFireworks,
        'boom': toggleFireworks,
        'reset': resetAllModes,
        'party': togglePartyMode,
        'sparta': startSpartaRemix,
        'troll': () => { startTrollBouncing(); showToast('troll.exe', 'problem?'); },
        'bsod': triggerBSOD,
        'matrix': () => window.hax(),
        'hax': () => window.hax(),
        'play': () => playTrack(),
        'winamp': () => playTrack(),
        'shutdown': shutDown,
        'jokerz': openBalatro,
        'troll': openTrollProblem,
        'trollproblem': openTrollProblem,
        'orcs': openTrollProblem,
        'become': openBecomeUser,
        'becomeuser': openBecomeUser,
        'story': openBecomeUser,
        'wizardz': () => openWizardz(),
        'wizards': () => openWizardz(),
        'bot': () => openWizardz('bot'),
        '1vbot': () => openWizardz('bot'),
        'wizard': () => openWizardz(),
        'duel': () => openWizardz(),
        'magic': () => openWizardz(),
        'lobby': () => openNetplay(),
        'netplay': () => openNetplay(),
        'multiplayer': () => openNetplay(),
        'join': () => openNetplay(),
        'balatro': openBalatro,
        'poker': openBalatro,
        'sol': openSolitaire,
        'cards': openSolitaire,
        'klondike': openSolitaire,
        'defrag': openDefrag,
        'blog': openDevlog,
        'posts': openDevlog,
        'search': openFindFiles,
        'screensaver': () => startScreensaver(),
        'mystify': () => startScreensaver('mystify'),
        'starfield': () => startScreensaver('starfield'),
        'pipes': () => startScreensaver('pipes'),
        'flying': () => startScreensaver('flying'),
        'help': () => showRetroDialog({
            title: 'help.txt',
            lines: ['mrhakan 98 - digital soul v2.0', 'built with notepad and pure love.', 'secrets: konami code, click the counter 5x, press the maximize button, type party/troll/bsod anywhere.'],
            okLabel: 'nice'
        })
    };
    if (!cmd) return;
    if (commands[cmd]) {
        commands[cmd]();
    } else {
        playSound('error');
        showRetroDialog({
            title: 'error',
            lines: [`'${cmd}' is not recognized as an internal or external command, operable program or vibe.`],
            okLabel: 'my bad'
        });
    }
}

function shutDown() {
    playSound('navigate');
    const screen = document.createElement('div');
    screen.id = 'shutdown-screen';
    const msg = document.createElement('span');
    msg.innerHTML = "It's now safe to turn off<br>your computer.<br><br><small style='font-size:1rem;'>(click anywhere to turn it back on)</small>";
    screen.appendChild(msg);
    document.body.appendChild(screen);
    const wake = () => {
        screen.remove();
        document.removeEventListener('keydown', wake);
        playSound('startup');
    };
    setTimeout(() => {
        screen.addEventListener('click', wake);
        document.addEventListener('keydown', wake);
    }, 300);
}

function showToast(title, message) {
    document.querySelectorAll('.retro-toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = 'retro-toast';
    const titleEl = document.createElement('div');
    titleEl.className = 'toast-title';
    titleEl.textContent = `💬 ${title}`;
    const msgEl = document.createElement('div');
    msgEl.textContent = message;
    toast.appendChild(titleEl);
    toast.appendChild(msgEl);
    document.body.appendChild(toast);
    playSound('balloon');
    setTimeout(() => toast.classList.add('fading'), 3000);
    setTimeout(() => toast.remove(), 3500);
}

function applyTheme(track) {
    if (!track) return;

    const root = document.documentElement;
    const body = document.body;
    const effectsContainer = document.getElementById('effects-container');


    if (track.theme) {
        root.style.setProperty('--primary-color', track.theme.primaryColor);
        root.style.setProperty('--accent-color', track.theme.accentColor);
    }

    // tint the space background towards the track color instead of painting the
    // whole page with it (raw #0000FF backgrounds made everything unreadable)
    body.classList.add('theme-transition');
    if (track.theme && window.CSS && CSS.supports('background-color', 'color-mix(in srgb, red 50%, black)')) {
        body.style.backgroundColor = `color-mix(in srgb, ${track.theme.primaryColor} 30%, #0d0517)`;
    } else if (track.theme) {
        body.style.backgroundColor = '#1a0b2e';
    }

    document.title = `▶ ${track.artist} - ${track.title} | mrhakan's shithole`;


    effectsContainer.className = "absolute inset-0 z-1 pointer-events-none h-full w-full fixed overflow-hidden";
    effectsContainer.innerHTML = '';
    document.getElementById('main-window').classList.remove('effect-pulse');
    if (typeof trollInterval !== 'undefined') clearInterval(trollInterval);
    stopMatrixRain();

    if (track.effect) {
        if (track.effect === 'matrix_digital_rain') {
            effectsContainer.classList.add('effect-matrix');
            startMatrixRain(effectsContainer);
        } else if (track.effect === 'falling_rain_dark') {
            effectsContainer.classList.add('effect-rain');
        } else if (track.effect === 'flashing_rainbow_strobe') {
            effectsContainer.classList.add('effect-strobe');
        } else if (track.effect === 'notepad_typing') {
            effectsContainer.classList.add('effect-notepad');
        } else if (track.effect === 'robotic_glitch_text') {
            effectsContainer.classList.add('effect-glitch');
        } else if (track.effect === 'comic_book_dots') {
            effectsContainer.classList.add('effect-comic');
        } else if (track.effect === 'screen_shake_pulse') {
            document.getElementById('main-window').classList.add('effect-pulse');
        } else if (track.effect === 'unregistered_hypercam_watermark') {
            const watermark = document.createElement('div');
            watermark.className = 'hypercam-watermark';
            watermark.textContent = 'Unregistered Hypercam 2';
            effectsContainer.appendChild(watermark);
        } else if (track.effect === 'troll_bouncing') {
            startTrollBouncing();
        }
    }


    const marqueeText = document.querySelector('.animate-marquee span');
    if (marqueeText) {
        // reuse the meme loadTrack() already rolled for this play so both
        // ticker boxes read the same line instead of two random ones
        const meme = track._currentMeme || pickTrackMeme(track);
        marqueeText.textContent = `::: NOW PLAYING: ${track.artist} - ${track.title} ::: ${meme} :::`;
        marqueeText.style.color = track.theme ? track.theme.accentColor : '#0df259';
    }
}

let matrixRAF = null;
let matrixResizeHandler = null;
function startMatrixRain(container) {
    stopMatrixRain();
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const fontSize = 16;
    let drops = [];
    const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        const cols = Math.floor(canvas.width / fontSize);
        drops = Array.from({ length: cols }, () => Math.floor(Math.random() * canvas.height / fontSize));
    };
    resize();
    matrixResizeHandler = resize;
    window.addEventListener('resize', resize);
    const chars = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ01010101';
    let last = 0;
    const draw = (t) => {
        matrixRAF = requestAnimationFrame(draw);
        if (t - last < 50) return;
        last = t;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${fontSize}px monospace`;
        for (let i = 0; i < drops.length; i++) {
            const ch = chars[Math.floor(Math.random() * chars.length)];
            ctx.fillStyle = Math.random() > 0.975 ? '#ccffcc' : '#00FF41';
            ctx.fillText(ch, i * fontSize, drops[i] * fontSize);
            if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
            drops[i]++;
        }
    };
    matrixRAF = requestAnimationFrame(draw);
}

function stopMatrixRain() {
    if (matrixRAF) {
        cancelAnimationFrame(matrixRAF);
        matrixRAF = null;
    }
    if (matrixResizeHandler) {
        window.removeEventListener('resize', matrixResizeHandler);
        matrixResizeHandler = null;
    }
}

let trollInterval;
function startTrollBouncing() {
    const container = document.getElementById('effects-container');
    const images = ['src/troll/troll1.gif', 'src/troll/troll2.gif', 'src/troll/troll3.gif'];
    const trolls = [];


    for (let i = 0; i < 10; i++) {
        const img = document.createElement('img');
        img.src = images[Math.floor(Math.random() * images.length)];
        img.style.position = 'absolute';
        img.style.width = '100px';
        img.style.userSelect = 'none';

        const troll = {
            element: img,
            x: Math.random() * (window.innerWidth - 100),
            y: Math.random() * (window.innerHeight - 100),
            dx: (Math.random() - 0.5) * 10,
            dy: (Math.random() - 0.5) * 10
        };

        container.appendChild(img);
        trolls.push(troll);
    }

    if (trollInterval) clearInterval(trollInterval);

    trollInterval = setInterval(() => {
        trolls.forEach(troll => {
            troll.x += troll.dx;
            troll.y += troll.dy;

            if (troll.x <= 0 || troll.x + 100 >= window.innerWidth) troll.dx *= -1;
            if (troll.y <= 0 || troll.y + 100 >= window.innerHeight) troll.dy *= -1;

            troll.element.style.left = `${troll.x}px`;
            troll.element.style.top = `${troll.y}px`;
        });
    }, 20);
}

function initAudioVisualizer() {
    const audio = document.getElementById('audio-player');
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 32;
        const source = audioContext.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        updateVisualizer();
    } else if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}


function initDraggable() {
    const windows = [
        { window: 'main-window', header: 'draggable-header' },
        { window: 'winamp-window', header: 'winamp-header' },
        { window: 'shoutbox-window', header: 'shoutbox-header' }
    ];
    let highestZ = 100;
    windows.forEach(({ window: winId, header: headerId }) => {
        const win = document.getElementById(winId);
        const header = document.getElementById(headerId);
        if (!win || !header) return;
        let isDragging = false;
        let offsetX, offsetY;
        header.addEventListener('mousedown', (e) => {
            // clicking title-bar buttons (✕, □) must not start a drag
            if (e.target.closest('button')) return;
            const rect = win.getBoundingClientRect();
            isDragging = true;
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            win.classList.add('dragging');
            win.style.position = 'fixed';
            win.style.left = `${rect.left}px`;
            win.style.top = `${rect.top}px`;
            highestZ++;
            win.style.zIndex = highestZ;
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            win.style.left = `${e.clientX - offsetX}px`;
            win.style.top = `${e.clientY - offsetY}px`;
        });
        const endDrag = () => {
            isDragging = false;
            win.classList.remove('dragging');
        };
        document.addEventListener('mouseup', endDrag);
        window.addEventListener('blur', endDrag);
        win.addEventListener('mousedown', () => {
            highestZ++;
            win.style.zIndex = highestZ;
        });
    });
}
const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let konamiIndex = 0;
function initKonamiCode() {
    document.addEventListener('keydown', (e) => {
        if (e.key === konamiCode[konamiIndex]) {
            konamiIndex++;
            if (konamiIndex === konamiCode.length) {
                triggerEasterEgg();
                konamiIndex = 0;
            }
        } else {
            konamiIndex = 0;
        }
    });
}
function triggerEasterEgg() {
    const egg = document.createElement('div');
    egg.style.cssText = 'position:fixed;inset:0;background:black;z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;';
    egg.innerHTML = `
        <img src="src/troll/troll1.gif" style="max-width:200px;" alt="troll">
        <h1 class="rainbow-text" style="font-family:'Comic Sans MS',cursive;font-size:3rem;margin-top:20px;">YOU FOUND THE SECRET!</h1>
        <p style="color:white;font-family:monospace;">30 lives granted. caramelldansen initiated.</p>
        <p style="color:#666;font-family:monospace;font-size:12px;margin-top:8px;">press any key to return...</p>
    `;
    document.body.appendChild(egg);
    // konami reward: blast caramelldansen + troll invasion
    if (tracks.length > 2) {
        currentTrackIndex = 2;
        loadTrack(2);
        playTrack();
    }
    startTrollBouncing();
    if (typeof unlockAchievement === 'function') unlockAchievement('konami');
    const removeEgg = () => {
        egg.remove();
        document.removeEventListener('keydown', removeEgg);
    };
    setTimeout(() => document.addEventListener('keydown', removeEgg), 500);
}

// ===== more hidden stuff =====
function triggerBSOD() {
    if (document.getElementById('bsod-screen')) return;
    if (typeof unlockAchievement === 'function') unlockAchievement('bsod');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    playSound('error');
    const bsod = document.createElement('div');
    bsod.id = 'bsod-screen';
    bsod.innerHTML = `
        <div class="bsod-inner">
            <p class="bsod-title">&nbsp;mrhakan&nbsp;</p>
            <p><br>A fatal exception 0E has occurred at 0028:C0011E36 in VXD VIBES(01) +
            00010E36. The current application will be terminated.</p>
            <p><br>*&nbsp; Press any key to terminate the current vibe.</p>
            <p>*&nbsp; Press CTRL+ALT+DEL again to restart your shithole. You will
            lose any unsaved swag in all applications.</p>
            <p><br><br><span class="bsod-center">Press any key to continue _</span></p>
        </div>
    `;
    document.body.appendChild(bsod);
    const dismiss = () => {
        bsod.remove();
        document.removeEventListener('keydown', dismiss);
        playSound('startup');
    };
    setTimeout(() => {
        bsod.addEventListener('click', dismiss);
        document.addEventListener('keydown', dismiss);
    }, 300);
}

let partyMode = false;
function togglePartyMode() {
    partyMode = !partyMode;
    document.body.classList.toggle('party-mode', partyMode);
    if (partyMode) {
        showToast('party.exe', 'PARTY MODE ACTIVATED!! type "party" again to chill');
        if (typeof unlockAchievement === 'function') unlockAchievement('party');
        if (typeof launchConfetti === 'function') launchConfetti(60);
        playSound('notify');
    } else {
        showToast('party.exe', 'party over. back to work bradar');
    }
}

// secret words: type them anywhere (outside inputs) — party / troll / bsod
const secretWords = { 'party': togglePartyMode, 'troll': () => { startTrollBouncing(); showToast('troll.exe', 'problem?'); }, 'bsod': triggerBSOD };
let typedBuffer = '';
document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;
    typedBuffer = (typedBuffer + e.key.toLowerCase()).slice(-10);
    for (const word of Object.keys(secretWords)) {
        if (typedBuffer.endsWith(word)) {
            typedBuffer = '';
            secretWords[word]();
            break;
        }
    }
});

// clicking the visitor counter 5 times = h4x0r mode
// the real count is a third-party badge image, so the egg hides it and spins
// the LED display in its place, then puts the badge back
let counterClicks = 0;
function initCounterEgg() {
    const box = document.getElementById('visitor-box');
    const badge = document.getElementById('visitor-badge');
    const led = document.getElementById('visitor-count');
    if (!box || !led) return;
    box.style.cursor = 'pointer';
    box.addEventListener('click', () => {
        counterClicks++;
        if (counterClicks < 5) return;
        counterClicks = 0;
        playSound('error');
        const badgeWasShowing = badge && !badge.classList.contains('hidden');
        const original = led.textContent;
        if (badge) badge.classList.add('hidden');
        led.classList.remove('hidden');
        let spins = 0;
        const spin = setInterval(() => {
            led.textContent = String(Math.floor(Math.random() * 999999)).padStart(6, '0');
            if (++spins > 20) {
                clearInterval(spin);
                led.textContent = '999999';
                showToast('h4x0r.exe', 'counter overclocked!! the feds are on their way');
                setTimeout(() => {
                    led.textContent = original;
                    if (badgeWasShowing) { led.classList.add('hidden'); badge.classList.remove('hidden'); }
                }, 5000);
            }
        }, 50);
    });
}

// console egg for the devtools crowd
console.log(`%c
  ███╗   ███╗██████╗ ██╗  ██╗ █████╗ ██╗  ██╗ █████╗ ███╗   ██╗
  ████╗ ████║██╔══██╗██║  ██║██╔══██╗██║ ██╔╝██╔══██╗████╗  ██║
  ██╔████╔██║██████╔╝███████║███████║█████╔╝ ███████║██╔██╗ ██║
  ██║╚██╔╝██║██╔══██╗██╔══██║██╔══██║██╔═██╗ ██╔══██║██║╚██╗██║
  ██║ ╚═╝ ██║██║  ██║██║  ██║██║  ██║██║  ██╗██║  ██║██║ ╚████║
  ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝
`, 'color:#0df259;font-family:monospace;');
console.log('%cyo bradar, poking around? try window.hax() — or type "party", "troll" or "bsod" on the page. konami code works too.', 'color:#ff00ff;font-size:14px;');
window.hax = function () {
    const container = document.getElementById('effects-container');
    if (!container) return 'no effects container, no hax';
    startMatrixRain(container);
    showToast('hax.exe', 'wake up, neo...');
    setTimeout(stopMatrixRain, 10000);
    return 'ACCESS GRANTED';
};
function createSparkle(e) {
    if (Math.random() > 0.5) return;
    const sparkle = document.createElement('div');
    sparkle.classList.add('sparkle');
    sparkle.style.left = `${e.pageX}px`;
    sparkle.style.top = `${e.pageY}px`;
    const colors = ['#fff', '#0df259', '#ff00ff', '#ffff00'];
    sparkle.style.background = colors[Math.floor(Math.random() * colors.length)];
    sparkle.style.boxShadow = `0 0 4px ${sparkle.style.background}`;
    document.body.appendChild(sparkle);
    setTimeout(() => {
        sparkle.remove();
    }, 1000);
}
function playTrack() {
    const audio = document.getElementById('audio-player');
    const text = document.getElementById('winamp-text');
    if (!audio.src || audio.src === window.location.href) {
        loadTrack(currentTrackIndex);
    }
    audio.play().then(() => {
        isPlaying = true;
        text.classList.add('animate-marquee');
    }).catch(e => {
        console.error("Playback failed (likely autoplay policy)", e);
        text.textContent = "*** click play to start ***";
    });
}
function pauseTrack() {
    const audio = document.getElementById('audio-player');
    const text = document.getElementById('winamp-text');
    audio.pause();
    isPlaying = false;
    text.classList.remove('animate-marquee');
}
function stopTrack() {
    const audio = document.getElementById('audio-player');
    const text = document.getElementById('winamp-text');
    audio.pause();
    audio.currentTime = 0;
    isPlaying = false;
    text.classList.remove('animate-marquee');
    updateProgressBar();
}
let shuffleOn = false;
let repeatOn = false;
function nextTrack() {
    if (!tracks.length) return;
    // called on 'ended' too: honor repeat-one, then shuffle, then sequential
    if (repeatOn) {
        loadTrack(currentTrackIndex);
        playTrack();
        return;
    }
    if (shuffleOn && tracks.length > 1) {
        let next;
        do { next = Math.floor(Math.random() * tracks.length); } while (next === currentTrackIndex);
        currentTrackIndex = next;
    } else {
        currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
    }
    loadTrack(currentTrackIndex);
    playTrack();
}
function toggleShuffle() {
    shuffleOn = !shuffleOn;
    const btn = document.getElementById('winamp-shuffle');
    if (btn) btn.classList.toggle('winamp-toggle-on', shuffleOn);
    showToast('winamp', shuffleOn ? 'shuffle on' : 'shuffle off');
}
function toggleRepeat() {
    repeatOn = !repeatOn;
    const btn = document.getElementById('winamp-repeat');
    if (btn) btn.classList.toggle('winamp-toggle-on', repeatOn);
    showToast('winamp', repeatOn ? 'repeat one on' : 'repeat off');
}
function prevTrack() {
    currentTrackIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;
    loadTrack(currentTrackIndex);
    playTrack();
}
function initPlaylist() {
    const list = document.getElementById('winamp-playlist');
    if (!list) return;
    list.innerHTML = '';

    tracks.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = 'cursor-pointer hover:bg-[#000080] hover:text-white px-1 whitespace-nowrap overflow-hidden text-ellipsis';
        item.textContent = `${index + 1}. ${track.artist} - ${track.title}`;

        if (index === currentTrackIndex) {
            item.classList.add('bg-[#000080]', 'text-white');
        }

        item.onclick = () => {
            currentTrackIndex = index;
            loadTrack(index);
            playTrack();
        };

        list.appendChild(item);
    });
}

// one random meme line per track, per load — not lyrics, just original
// commentary on where the song sits in internet culture. re-rolled every
// time the track is (re)loaded, and shared between the winamp ticker and
// the top marquee so both boxes agree for the length of that play.
function pickTrackMeme(track) {
    if (!track || !Array.isArray(track.memes) || !track.memes.length) return '';
    track._currentMeme = track.memes[Math.floor(Math.random() * track.memes.length)];
    return track._currentMeme;
}

function loadTrack(index) {
    const audio = document.getElementById('audio-player');
    const text = document.getElementById('winamp-text');

    const src = tracks[index].filename ? `src/music/${tracks[index].filename}` : tracks[index].url;

    audio.src = src;
    audio.load();

    const title = tracks[index].title || "Unknown Track";
    const artist = tracks[index].artist || "Unknown Artist";
    const meme = pickTrackMeme(tracks[index]);
    text.textContent = meme
        ? `*** ${artist} - ${title} *** (kbps: 128) *** ${meme} ***`
        : `*** ${artist} - ${title} *** (kbps: 128) ***`;


    const list = document.getElementById('winamp-playlist');
    Array.from(list.children).forEach((child, i) => {
        if (i === index) {
            child.classList.add('bg-[#000080]', 'text-white');
        } else {
            child.classList.remove('bg-[#000080]', 'text-white');
        }
    });

    applyTheme(tracks[index]);
    if (typeof noteTrackPlayed === 'function') noteTrackPlayed(index);
}

let cachedEqBars = null;
let cachedEffectsContainer = null;
let cachedMainWindow = null;

function updateVisualizer() {
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);

    if (!cachedEqBars) cachedEqBars = document.querySelectorAll('.eq-bar');
    const primaryColor = (getComputedStyle(document.documentElement).getPropertyValue('--primary-color') || '#0df259').trim();

    cachedEqBars.forEach((bar, i) => {
        const value = dataArray[i * 2 % dataArray.length] || 0;
        const height = Math.max(10, (value / 255) * 100);
        bar.style.height = `${height}%`;
        bar.style.backgroundColor = primaryColor;
    });

    let bass = 0;
    for (let i = 0; i < 4; i++) bass += dataArray[i];
    bass = bass / 4;

    if (!cachedEffectsContainer) cachedEffectsContainer = document.getElementById('effects-container');
    if (!cachedMainWindow) cachedMainWindow = document.getElementById('main-window');

    if (bass > 200) {

        document.body.style.filter = `brightness(1.2) contrast(1.1)`;
        if (cachedMainWindow && cachedMainWindow.classList.contains('effect-pulse')) {
            cachedMainWindow.style.transform = `scale(${1 + (bass - 200) / 500})`;
        }
    } else {
        document.body.style.filter = `brightness(1) contrast(1)`;
        if (cachedMainWindow) cachedMainWindow.style.transform = 'scale(1)';
    }

    if (cachedEffectsContainer) {
        const volume = dataArray.reduce((src, a) => src + a, 0) / dataArray.length;
        cachedEffectsContainer.style.opacity = 0.5 + (volume / 510);
    }

    requestAnimationFrame(updateVisualizer);
}
function updateProgressBar() {
    const audio = document.getElementById('audio-player');
    const progress = document.getElementById('winamp-progress');
    const timeDisplay = document.getElementById('winamp-time');
    if (audio.duration) {
        const percent = (audio.currentTime / audio.duration) * 100;
        progress.style.width = `${percent}%`;
        const minutes = Math.floor(audio.currentTime / 60);
        const seconds = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
        timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds}`;
    }
}
const win98Sounds = {
    navigate: 'src/windowsxpstartup_201910/Windows Navigation Start.mp3',
    click: 'src/windowsxpstartup_201910/Windows XP Menu Command.mp3',
    startup: 'src/windowsxpstartup_201910/Windows XP Startup.mp3',
    error: 'src/windowsxpstartup_201910/Windows XP Error.mp3',
    ding: 'src/windowsxpstartup_201910/Windows XP Ding.mp3',
    notify: 'src/windowsxpstartup_201910/Windows XP Notify.mp3',
    balloon: 'src/windowsxpstartup_201910/Windows XP Balloon.mp3'
};
let soundEnabled = localStorage.getItem('sound-enabled') !== 'false';
function playSound(type) {
    if (!soundEnabled) return;
    const audio = new Audio(win98Sounds[type] || win98Sounds.ding);
    audio.volume = 0.3;
    audio.play().catch(() => { });
}
function toggleSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem('sound-enabled', soundEnabled);
    updateSoundUI();
    if (soundEnabled) playSound('ding');
}
function updateSoundUI() {
    const btn = document.getElementById('sound-toggle');
    if (btn) btn.textContent = soundEnabled ? '[sound: on]' : '[sound: off]';
    const tray = document.getElementById('tray-sound');
    if (tray) tray.textContent = soundEnabled ? 'volume_up' : 'volume_off';
}
function showSection(sectionId) {
    if (sectionId === 'home') {
        playSound('click');
    } else {
        playSound('navigate');
    }
    document.getElementById('section-home').classList.add('hidden');
    document.getElementById('section-github').classList.add('hidden');
    const linksSection = document.getElementById('section-links');
    if (linksSection) linksSection.classList.add('hidden');
    const guestbookSection = document.getElementById('section-guestbook');
    if (guestbookSection) guestbookSection.classList.add('hidden');
    document.getElementById(`section-${sectionId}`).classList.remove('hidden');
    const title = document.getElementById('window-title');
    if (sectionId === 'home') title.textContent = "about me.html - microsoft internet explorer";
    if (sectionId === 'github') title.textContent = "my projects - github explorer";
    if (sectionId === 'links') title.textContent = "cool links - netscape navigator";
    if (sectionId === 'guestbook') {
        title.textContent = "guestbook.exe - sign my guestbook!";
        loadGuestbook();
    }
}
function hideSection(type) {
    if (type === 'all') {
        showSection('home');
    }
}
function handleTab(type) {
    switch (type) {
        case 'file':
            showRetroDialog({
                title: 'file',
                lines: ['what do you want to do bradar?'],
                okLabel: 'go home', cancelLabel: 'print (lol)',
                onOk: () => showSection('home')
            });
            break;
        case 'edit':
            openPaint();
            break;
        case 'view':
            togglePartyMode();
            break;
        case 'favorites':
            showToast('favorites', "added 'mrhakan.github.io' to your favorites! good choice");
            playSound('ding');
            break;
        case 'tools':
            openTaskManager();
            break;
        case 'help':
            showRetroDialog({
                title: 'about digital soul',
                lines: ['mrhakan 98 - digital soul v2.0', 'created by: mrhakan', 'built with: notepad + pure love', 'secrets everywhere. go find them.'],
                okLabel: 'cool'
            });
            break;
    }
}
const langColors = {
    'JavaScript': '#f1e05a', 'TypeScript': '#3178c6', 'Java': '#b07219', 'Python': '#3572A5',
    'C#': '#178600', 'HTML': '#e34c26', 'CSS': '#563d7c', 'Kotlin': '#A97BFF', 'GLSL': '#5686a5',
    'AutoHotkey': '#6594b9', 'Shell': '#89e051', 'C++': '#f34b7d', 'C': '#555555', 'Go': '#00ADD8', 'Rust': '#dea584'
};
let allRepos = [];

function relativeTime(dateStr) {
    if (!dateStr) return '';
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (days < 1) return 'updated today';
    if (days === 1) return 'updated yesterday';
    if (days < 30) return `updated ${days}d ago`;
    if (days < 365) return `updated ${Math.floor(days / 30)}mo ago`;
    return `updated ${Math.floor(days / 365)}y ago`;
}

function repoPagesUrl(repo) {
    // project sites live under the user site's domain: mrhakan.github.io/<repo>/
    if (!repo.has_pages || repo.name.toLowerCase() === 'mrhakan.github.io') return null;
    return `https://mrhakan.github.io/${repo.name}/`;
}

async function fetchGitHubRepos() {
    const container = document.getElementById('github-repos');
    if (!container) return;
    try {
        const res = await fetch('https://api.github.com/users/mrhakan/repos?sort=updated&per_page=100');
        const repos = await res.json();
        if (!Array.isArray(repos)) throw new Error((repos && repos.message) || 'unexpected response');
        allRepos = repos.filter(r => !r.fork);
        renderRepos();
    } catch (e) {
        container.innerHTML = '<div class="text-red-500 font-pixel">error loading git objects... (github api rate limit? try again later)</div>';
    }
}

function renderRepos() {
    const container = document.getElementById('github-repos');
    if (!container || !allRepos.length) return;
    const sortBy = document.getElementById('repo-sort')?.value || 'updated';
    const liveOnly = document.getElementById('repo-live-only')?.checked || false;

    let repos = [...allRepos];
    if (liveOnly) repos = repos.filter(r => repoPagesUrl(r));
    if (sortBy === 'stars') repos.sort((a, b) => b.stargazers_count - a.stargazers_count);
    else if (sortBy === 'name') repos.sort((a, b) => a.name.localeCompare(b.name));
    else repos.sort((a, b) => new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at));

    const countEl = document.getElementById('repo-count');
    if (countEl) countEl.textContent = `${repos.length} object(s)`;

    if (!repos.length) {
        container.innerHTML = '<div class="text-center w-full py-8 text-xs font-pixel text-gray-500">nothing here bradar</div>';
        return;
    }

    container.innerHTML = repos.map(repo => {
        const live = repoPagesUrl(repo);
        const langColor = langColors[repo.language] || '#8b949e';
        return `
            <div class="bg-white border-2 border-black p-2 shadow-[2px_2px_0_rgba(0,0,0,0.5)] hover:bg-[#f0f0f0] flex flex-col">
                <div class="flex items-start justify-between gap-2 mb-1">
                    <a href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener"
                       class="font-bold text-blue-800 underline font-header text-sm break-all">${escapeHtml(repo.name)}</a>
                    ${live ? '<span class="live-badge font-pixel text-[9px] flex-shrink-0"><span class="blink-live">●</span> LIVE</span>' : ''}
                </div>
                <div class="text-[10px] min-h-8 overflow-hidden text-black font-body mb-2 flex-1">${escapeHtml(repo.description || 'no description available.')}</div>
                <div class="flex flex-wrap items-center gap-2 text-[10px] font-pixel text-gray-600">
                    <span>★ ${repo.stargazers_count}</span>
                    <span>⑂ ${repo.forks_count}</span>
                    <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full" style="background:${langColor}"></span>${escapeHtml(repo.language || 'txt')}</span>
                    <span class="ml-auto text-gray-400">${relativeTime(repo.pushed_at || repo.updated_at)}</span>
                </div>
                ${live ? `
                <div class="flex gap-2 mt-2 pt-2 border-t border-dashed border-gray-300">
                    <button onclick="openIEWindow('${escapeHtml(live)}', '${escapeHtml(repo.name)}')"
                        class="bevel-out bg-retro-gray px-3 py-[2px] text-black font-header text-xs font-bold active:translate-y-[1px]">&#9654; run</button>
                    <a href="${escapeHtml(live)}" target="_blank" rel="noopener"
                        class="bevel-out bg-retro-gray px-3 py-[2px] text-black font-header text-xs font-bold active:translate-y-[1px]">open in new tab</a>
                </div>` : ''}
            </div>
        `;
    }).join('');
}

// ===== in-site retro internet explorer windows =====
let ieWindowCount = 0;
let ieHighestZ = 200;
function openIEWindow(url, title) {
    playSound('navigate');
    ieWindowCount++;
    const id = `ie-win-${ieWindowCount}`;
    const win = document.createElement('div');
    win.className = 'ie-window bevel-out';
    win.id = id;
    const isMobile = window.innerWidth < 768;
    win.style.left = isMobile ? '2vw' : `${60 + (ieWindowCount * 35) % 220}px`;
    win.style.top = isMobile ? '60px' : `${70 + (ieWindowCount * 30) % 160}px`;
    win.style.zIndex = ++ieHighestZ;

    const header = document.createElement('div');
    header.className = 'ie-window-header';
    header.innerHTML = `
        <img src="src/emoj/Cursed Pack 1-emojigg-pack/7161-joe-cool.png" class="w-4 h-4" alt="">
        <span class="ie-window-title">${escapeHtml(title)} - microsoft internet explorer</span>`;
    const btns = document.createElement('div');
    btns.className = 'flex gap-[2px] ml-auto flex-shrink-0';
    const minBtn = document.createElement('button');
    minBtn.className = 'ie-titlebar-btn bevel-out';
    minBtn.textContent = '_';
    minBtn.title = 'minimize';
    minBtn.onclick = () => toggleIEWindow(id);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ie-titlebar-btn bevel-out';
    closeBtn.textContent = '\u2715';
    closeBtn.title = 'close';
    closeBtn.onclick = () => closeIEWindow(id);
    btns.appendChild(minBtn);
    btns.appendChild(closeBtn);
    header.appendChild(btns);

    const addressBar = document.createElement('div');
    addressBar.className = 'ie-address-bar';
    addressBar.innerHTML = `<span class="font-header text-xs text-black flex-shrink-0">address:</span>
        <input class="ie-address-input bevel-in" value="${escapeHtml(url)}" readonly>
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener" title="open in real browser"
           class="bevel-out bg-retro-gray px-2 text-black font-header text-xs flex-shrink-0">go</a>`;

    const frameWrap = document.createElement('div');
    frameWrap.className = 'ie-frame-wrap bevel-in';
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.className = 'ie-frame';
    iframe.setAttribute('loading', 'lazy');
    frameWrap.appendChild(iframe);

    const statusBar = document.createElement('div');
    statusBar.className = 'ie-status-bar bevel-in';
    statusBar.textContent = `loading ${title}...`;
    iframe.addEventListener('load', () => { statusBar.textContent = 'done'; });

    win.appendChild(header);
    win.appendChild(addressBar);
    win.appendChild(frameWrap);
    win.appendChild(statusBar);
    document.body.appendChild(win);

    // drag by header
    let dragging = false, offX = 0, offY = 0;
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        dragging = true;
        const rect = win.getBoundingClientRect();
        offX = e.clientX - rect.left;
        offY = e.clientY - rect.top;
        win.style.zIndex = ++ieHighestZ;
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        win.style.left = `${e.clientX - offX}px`;
        win.style.top = `${e.clientY - offY}px`;
    });
    document.addEventListener('mouseup', () => { dragging = false; });
    win.addEventListener('mousedown', () => { win.style.zIndex = ++ieHighestZ; });

    // taskbar button
    const tbContainer = document.getElementById('taskbar-windows');
    if (tbContainer) {
        const tbBtn = document.createElement('button');
        tbBtn.className = 'taskbar-window-btn bevel-out';
        tbBtn.id = `${id}-tb`;
        tbBtn.innerHTML = `<img src="src/emoj/Cursed Pack 1-emojigg-pack/7161-joe-cool.png" class="w-3 h-3" alt=""><span class="truncate">${escapeHtml(title)}</span>`;
        tbBtn.onclick = () => toggleIEWindow(id);
        tbContainer.appendChild(tbBtn);
    }
}

function toggleIEWindow(id) {
    const win = document.getElementById(id);
    if (!win) return;
    const hidden = win.style.display === 'none';
    win.style.display = hidden ? 'flex' : 'none';
    if (hidden) win.style.zIndex = ++ieHighestZ;
    playSound('click');
}

function closeIEWindow(id) {
    document.getElementById(id)?.remove();
    document.getElementById(`${id}-tb`)?.remove();
    playSound('click');
}

// ===== github user stats (user.dat) =====
async function fetchGitHubUser() {
    const panel = document.getElementById('user-stats');
    if (!panel) return;
    try {
        const res = await fetch('https://api.github.com/users/mrhakan');
        const user = await res.json();
        if (!user || !user.login) return;
        document.getElementById('gh-avatar').src = user.avatar_url;
        document.getElementById('gh-repos').textContent = user.public_repos;
        document.getElementById('gh-followers').textContent = user.followers;
        document.getElementById('gh-since').textContent = user.created_at ? new Date(user.created_at).getFullYear() : '?';
        panel.classList.remove('hidden');
    } catch (e) { /* panel stays hidden */ }
}

async function fetchManualProjects() {
    const container = document.getElementById('manual-projects');
    if (!container) return;
    try {
        const res = await fetch('src/projects.json');
        const projects = await res.json();
        container.innerHTML = projects.map(project => `
            <div class="bg-white border-2 border-black p-2 shadow-[2px_2px_0_rgba(0,0,0,0.5)] hover:bg-[#f0f0f0]">
                <a href="${escapeHtml(project.url)}" target="_blank" rel="noopener" class="block">
                    ${project.image ? `<div class="mb-2 border border-black overflow-hidden h-32 relative group-hover:opacity-80 transition-opacity">
                        <img src="${escapeHtml(project.image)}" alt="${escapeHtml(project.name)}" class="w-full h-full object-cover" loading="lazy">
                    </div>` : ''}
                    <div class="font-bold text-blue-800 underline font-header mb-1 text-sm">${escapeHtml(project.name)}</div>
                    <div class="text-[10px] h-8 overflow-hidden text-black font-body mb-2">${escapeHtml(project.description || 'no description available.')}</div>
                    <div class="flex gap-2 text-[10px] font-pixel text-gray-600">
                        <span>★ ${escapeHtml(project.type || 'Project')}</span>
                        <span>⑂ ${escapeHtml(project.language || 'N/A')}</span>
                    </div>
                </a>
            </div>
        `).join('');
    } catch (e) {
        console.error("Failed to load manual projects", e);
        container.innerHTML = '<div class="text-red-500 font-pixel">error loading special projects...</div>';
    }
}
function copyDiscord() {
    const username = 'mrhakan';
    const notify = () => showToast('discord.exe', `username "${username}" copied to clipboard! add me bradar`);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(username).then(notify).catch(() => {
            showToast('discord.exe', `clipboard blocked - my username is "${username}"`);
        });
    } else {
        showToast('discord.exe', `my discord username is "${username}"`);
    }
}
// The hit counter is komarev's ghpvc badge — the same one on my github profile
// readme, so the number is "people who looked at my stuff" across both places.
// Loading the image is what registers the hit; there is no api call to make and
// no key to keep secret. If the badge cannot load — offline, blocked, adblock —
// fall back to a local count so the panel is never an empty box.
function initVisitorCounter() {
    const badge = document.getElementById('visitor-badge');
    const led = document.getElementById('visitor-count');
    if (!badge || !led) return;
    let done = false;
    const fallback = () => {
        if (done) return;
        done = true;
        badge.classList.add('hidden');
        led.classList.remove('hidden');
        const count = parseInt(localStorage.getItem('visitor-count') || '0', 10) + 1;
        localStorage.setItem('visitor-count', count);
        led.textContent = String(count).padStart(6, '0');
    };
    badge.addEventListener('error', fallback);
    // the browser starts loading the badge while parsing the html, so a blocked
    // request (adblock, offline) can fail before this listener exists — a
    // finished image with no intrinsic width is one that already failed
    if (badge.complete && badge.naturalWidth === 0) fallback();
}
const GH_REPO = 'MrHakan/mrhakan.github.io';
const GH_BRANCH = 'main';
const shoutboxAvatars = [
    'src/emoj/Cursed Pack 1-emojigg-pack/5771-hmmm.png',
    'src/emoj/Cursed Pack 1-emojigg-pack/2825-joe-haha-funny.png',
    'src/emoj/Cursed Pack 1-emojigg-pack/3166-joe-love.png',
    'src/emoj/Cursed Pack 1-emojigg-pack/8394-joe-woah.png',
    'src/emoj/Cursed Pack 1-emojigg-pack/9550-idk.png',
    'src/emoj/xdtroll.png',
    'src/emoj/thehehe.png',
    'src/emoj/heh.png'
];
function nameHash(s) {
    let h = 0;
    for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h;
}

// guestbook + shoutbox entries live as json files in the repo (data/guestbook, data/shouts).
// visitors add entries by opening a pre-filled issue; a workflow commits it.
async function fetchEntriesFromRepo(kind) {
    const cacheKey = `repo-${kind}-cache`;
    try {
        const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/data/${kind}?ref=${GH_BRANCH}`);
        const files = await res.json();
        if (!Array.isArray(files)) throw new Error((files && files.message) || 'unexpected response');
        const jsonFiles = files
            .filter(f => f.name.endsWith('.json'))
            .sort((a, b) => b.name.localeCompare(a.name))
            .slice(0, 30);
        const entries = await Promise.all(jsonFiles.map(f =>
            fetch(f.download_url).then(r => r.json()).catch(() => null)
        ));
        const valid = entries.filter(e => e && e.name && e.message);
        localStorage.setItem(cacheKey, JSON.stringify(valid));
        return valid;
    } catch (e) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) return JSON.parse(cached);
        throw e;
    }
}

// This used to open a pull request, which quietly asked every visitor to
// fork the repo before they could say hello. Nobody does that. An issue
// is one button for anyone with a github account, and
// .github/workflows/guestbook.yml commits the entry and closes it.
function submitViaIssue(kind, entry) {
    const value = JSON.stringify(entry, null, 4) + '\n';
    const isShout = kind === 'shouts';
    const title = `${isShout ? 'shout' : 'guestbook'}: ${entry.name}`;
    const body = [
        isShout ? 'a shout for the shoutbox:' : 'signing the guestbook:',
        '',
        '```json',
        value.trimEnd(),
        '```',
        '',
        'submit this issue as it is — the bot picks it up, adds the entry and closes it.',
        'edit the json if you like, but keep the fence.'
    ].join('\n');
    const url = `https://github.com/${GH_REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    showRetroDialog({
        title: isShout ? 'shout via github' : 'sign via github',
        lines: [
            'your entry gets added by opening an issue:',
            '1. github opens with your entry already written',
            '2. hit "create" — that is the whole job',
            '3. a robot adds it within a minute and closes the issue',
            'no forking, no pull request. no github account? discord me instead bradar.'
        ],
        okLabel: 'open github',
        cancelLabel: 'nevermind',
        onOk: () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(value).catch(() => { });
            }
            window.open(url, '_blank', 'noopener');
            showToast('github.exe', 'entry copied as backup. hit create and the robot does the rest.');
        }
    });
}

function showRetroDialog({ title, lines, okLabel, cancelLabel, onOk }) {
    document.querySelectorAll('.retro-dialog-overlay').forEach(d => d.remove());
    const overlay = document.createElement('div');
    overlay.className = 'retro-dialog-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'retro-dialog bevel-out';
    const titleBar = document.createElement('div');
    titleBar.className = 'retro-dialog-title';
    titleBar.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'retro-dialog-close bevel-out';
    closeBtn.textContent = '\u2715';
    closeBtn.onclick = () => overlay.remove();
    titleBar.appendChild(closeBtn);
    const body = document.createElement('div');
    body.className = 'retro-dialog-body';
    lines.forEach(line => {
        const p = document.createElement('p');
        p.textContent = line;
        body.appendChild(p);
    });
    const buttons = document.createElement('div');
    buttons.className = 'retro-dialog-buttons';
    const ok = document.createElement('button');
    ok.className = 'bevel-out retro-dialog-btn';
    ok.textContent = okLabel || 'ok';
    ok.onclick = () => { overlay.remove(); if (onOk) onOk(); };
    buttons.appendChild(ok);
    if (cancelLabel) {
        const cancel = document.createElement('button');
        cancel.className = 'bevel-out retro-dialog-btn';
        cancel.textContent = cancelLabel;
        cancel.onclick = () => overlay.remove();
        buttons.appendChild(cancel);
    }
    dialog.appendChild(titleBar);
    dialog.appendChild(body);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    playSound('notify');
    ok.focus();
}

async function fetchShoutbox() {
    const container = document.getElementById('shoutbox-messages');
    if (!container) return;
    container.innerHTML = '<div class="text-center text-gray-500">loading shouts...</div>';
    try {
        const messages = await fetchEntriesFromRepo('shouts');
        if (!messages.length) {
            container.innerHTML = '<div class="text-center text-gray-500">no shouts yet - be the first!</div>';
            return;
        }
        container.innerHTML = messages.map(msg => `
            <div class="border-b border-dashed border-gray-300 pb-1 flex gap-2">
                <img src="${shoutboxAvatars[nameHash(msg.name) % shoutboxAvatars.length]}" alt="" class="w-6 h-6 rounded-full bg-black flex-shrink-0">
                <div>
                    <p class="font-bold text-blue-600">${escapeHtml(msg.name)} <span
                            class="text-gray-400 font-normal text-[10px]">${formatEntryTime(msg)}</span></p>
                    <p class="text-black">${escapeHtml(msg.message)}</p>
                </div>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<div class="text-center text-gray-500">couldnt load shouts... (github api limit? try later)</div>';
    }
}
function postShout() {
    const name = document.getElementById('shout-name')?.value?.trim();
    const message = document.getElementById('shout-message')?.value?.trim();
    if (!name || !message) {
        showToast('shoutbox.exe', 'please fill in name and message!');
        return;
    }
    const now = new Date();
    submitViaIssue('shouts', {
        name: name.substring(0, 20),
        message: message.substring(0, 140),
        date: now.toISOString().slice(0, 10),
        timestamp: now.toISOString()
    });
}
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
// format an entry's timestamp for display. new entries store a full ISO
// `timestamp`; older entries only have a date-only `date` string, which we
// show as-is so nothing breaks.
function formatEntryTime(entry) {
    const raw = entry.timestamp || entry.date || '';
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return escapeHtml(raw);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function safeUrl(url) {
    try {
        const u = new URL(url, window.location.href);
        if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch (e) { /* invalid url */ }
    return '';
}
async function loadGuestbook() {
    const container = document.getElementById('guestbook-entries');
    if (!container) return;
    container.innerHTML = '<div class="text-center text-gray-500 font-pixel">loading entries...</div>';
    try {
        const entries = await fetchEntriesFromRepo('guestbook');
        if (entries.length === 0) {
            container.innerHTML = '<div class="text-center text-gray-500 font-pixel">no entries yet - be the first!</div>';
            return;
        }
        container.innerHTML = entries.map(entry => {
            const website = entry.website ? safeUrl(entry.website) : '';
            return `
            <div class="p-3 bg-[#f0f0f0] border border-gray-400">
                <div class="flex justify-between items-start mb-1">
                    <span class="font-bold text-blue-600 font-header">${escapeHtml(entry.name)}</span>
                    <span class="text-[10px] text-gray-500">${formatEntryTime(entry)}</span>
                </div>
                ${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener nofollow" class="text-xs text-purple-600 underline">${escapeHtml(website)}</a>` : ''}
                <p class="text-black font-pixel text-sm mt-1">${escapeHtml(entry.message)}</p>
            </div>
        `;
        }).join('');
    } catch (e) {
        container.innerHTML = '<div class="text-center text-gray-500 font-pixel">couldnt load entries... (github api limit? try later)</div>';
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const gbForm = document.getElementById('guestbook-form');
    if (gbForm) {
        gbForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('gb-name')?.value?.trim();
            const website = document.getElementById('gb-website')?.value?.trim();
            const message = document.getElementById('gb-message')?.value?.trim();
            if (!name || !message) return;
            const now = new Date();
            const entry = {
                name: name.substring(0, 30),
                message: message.substring(0, 500),
                date: now.toISOString().slice(0, 10),
                timestamp: now.toISOString()
            };
            const cleanSite = website ? safeUrl(website.substring(0, 100)) : '';
            if (cleanSite) entry.website = cleanSite;
            playSound('ding');
            if (typeof unlockAchievement === 'function') unlockAchievement('signer');
            submitViaIssue('guestbook', entry);
        });
    }
});

// ===== screensaver =====
// the savers themselves live in extras.js (mystify / starfield / 3d pipes /
// flying windows / bouncing logo), picked in display properties.

// ===================================================================
// generic app window manager (used by minesweeper / paint / task mgr)
// ===================================================================
let appWinCount = 0;
function createAppWindow(title, opts = {}) {
    appWinCount++;
    ieHighestZ = (typeof ieHighestZ === 'number' ? ieHighestZ : 200) + 1;
    const id = `app-win-${appWinCount}`;
    const win = document.createElement('div');
    win.className = 'app-window bevel-out';
    win.id = id;
    const isMobile = window.innerWidth < 768;
    const w = opts.width || 320;
    win.style.width = isMobile ? '94vw' : `${w}px`;
    win.style.left = isMobile ? '3vw' : `${Math.max(10, (window.innerWidth - w) / 2 + (appWinCount * 24) % 120 - 60)}px`;
    win.style.top = isMobile ? '54px' : `${70 + (appWinCount * 26) % 130}px`;
    win.style.zIndex = ieHighestZ;

    const header = document.createElement('div');
    header.className = 'app-window-header';
    header.innerHTML = `<span class="material-symbols-outlined text-white text-sm">${opts.icon || 'terminal'}</span>
        <span class="app-window-title">${escapeHtml(title)}</span>`;
    const btns = document.createElement('div');
    btns.className = 'flex gap-[2px] ml-auto flex-shrink-0';
    // minimize sends the window to its taskbar button
    const minBtn = document.createElement('button');
    minBtn.className = 'ie-titlebar-btn bevel-out';
    minBtn.textContent = '_';
    minBtn.title = 'minimize';
    minBtn.onclick = () => { win.style.display = 'none'; playSound('click'); };
    // maximize toggles a full-desktop layout, remembering the restore geometry
    const maxBtn = document.createElement('button');
    maxBtn.className = 'ie-titlebar-btn bevel-out';
    maxBtn.textContent = '□';
    maxBtn.title = 'maximize';
    maxBtn.onclick = () => {
        if (win.classList.toggle('maximized')) {
            win._restore = { left: win.style.left, top: win.style.top, width: win.style.width };
            win.style.left = '0px'; win.style.top = '40px'; win.style.width = '100vw';
        } else if (win._restore) {
            win.style.left = win._restore.left; win.style.top = win._restore.top; win.style.width = win._restore.width;
        }
        playSound('click');
    };
    // real fullscreen — hands the whole screen to the window and scales any
    // canvas inside it up to fit. esc gets you out, same as every other app.
    const fsBtn = document.createElement('button');
    fsBtn.className = 'ie-titlebar-btn bevel-out fs-btn';
    fsBtn.innerHTML = '<span class="material-symbols-outlined">fullscreen</span>';
    fsBtn.title = 'full screen';
    fsBtn.onclick = () => toggleWindowFullscreen(win);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ie-titlebar-btn bevel-out';
    closeBtn.textContent = '✕';
    closeBtn.title = 'close';
    closeBtn.onclick = () => closeAppWindow(id);
    btns.appendChild(minBtn);
    btns.appendChild(maxBtn);
    btns.appendChild(fsBtn);
    btns.appendChild(closeBtn);
    header.appendChild(btns);

    const body = document.createElement('div');
    body.className = 'app-window-body bevel-in';

    win.appendChild(header);
    win.appendChild(body);
    document.body.appendChild(win);
    playSound('navigate');

    // drag
    let dragging = false, offX = 0, offY = 0;
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true;
        const rect = win.getBoundingClientRect();
        offX = e.clientX - rect.left; offY = e.clientY - rect.top;
        win.style.zIndex = ++ieHighestZ;
    });
    const onMove = (e) => {
        if (!dragging) return;
        win.style.left = `${e.clientX - offX}px`;
        win.style.top = `${e.clientY - offY}px`;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', () => { dragging = false; });
    win.addEventListener('mousedown', () => { win.style.zIndex = ++ieHighestZ; });

    // taskbar button
    const tb = document.getElementById('taskbar-windows');
    if (tb) {
        const b = document.createElement('button');
        b.className = 'taskbar-window-btn bevel-out';
        b.id = `${id}-tb`;
        b.innerHTML = `<span class="material-symbols-outlined text-sm">${opts.icon || 'terminal'}</span><span class="truncate">${escapeHtml(title)}</span>`;
        b.onclick = () => {
            const hidden = win.style.display === 'none';
            win.style.display = hidden ? 'flex' : 'none';
            if (hidden) win.style.zIndex = ++ieHighestZ;
            playSound('click');
        };
        tb.appendChild(b);
    }
    win._cleanup = () => document.removeEventListener('mousemove', onMove);
    return { win, body, id, close: () => closeAppWindow(id) };
}
// ---------- fullscreen ----------
// the browser only grants fullscreen from a user gesture, and only one element
// at a time, so this always targets the window the button belongs to.
function toggleWindowFullscreen(win) {
    if (!win) return;
    playSound('click');
    if (document.fullscreenElement === win) { exitWindowFullscreen(); return; }
    const req = win.requestFullscreen || win.webkitRequestFullscreen || win.msRequestFullscreen;
    if (!req) { showToast('display', 'your browser will not do fullscreen here'); return; }
    Promise.resolve(req.call(win)).catch(() => showToast('display', 'fullscreen was refused'));
}
function exitWindowFullscreen() {
    const ex = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (ex && document.fullscreenElement) ex.call(document);
}

// a canvas has a fixed bitmap size, so going fullscreen has to scale it by
// hand — css alone cannot grow a replaced element past its intrinsic size
// without losing the aspect ratio.
function fitFullscreenCanvas(win) {
    if (!win) return;
    win.querySelectorAll('canvas').forEach(cv => {
        if (!cv.width || !cv.height) return;
        if (!win.classList.contains('fs-active')) { cv.style.width = ''; cv.style.height = ''; return; }
        const box = cv.closest('.app-window-body') || win;
        // shrink the canvas to nothing and measure where the surrounding chrome
        // actually sits. scrollHeight is useless here — it never reports less
        // than clientHeight, so on a tall fullscreen box it claims the chrome
        // fills the whole thing and the canvas gets scaled down to nothing.
        cv.style.width = '1px';
        cv.style.height = '1px';
        const boxRect = box.getBoundingClientRect();
        const cvRect = cv.getBoundingClientRect();
        let contentBottom = boxRect.top;
        for (const child of box.children) {
            contentBottom = Math.max(contentBottom, child.getBoundingClientRect().bottom);
        }
        const above = Math.max(0, cvRect.top - boxRect.top);
        const below = Math.max(0, contentBottom - cvRect.bottom);
        const availW = Math.max(80, box.clientWidth - 10);
        const availH = Math.max(80, box.clientHeight - above - below - 10);
        const scale = Math.min(availW / cv.width, availH / cv.height);
        if (!isFinite(scale) || scale <= 0) return;
        cv.style.width = Math.floor(cv.width * scale) + 'px';
        cv.style.height = Math.floor(cv.height * scale) + 'px';
    });
}

// escape is the browser's universal "leave fullscreen" key, and it is also the
// site's "close the top window" key. without this, leaving fullscreen also
// closed the game you were playing.
let fsLeftAt = 0;
function fullscreenSwallowsEscape() {
    return !!document.fullscreenElement || (Date.now() - fsLeftAt) < 500;
}

function onFullscreenChange() {
    const fs = document.fullscreenElement;
    if (!fs) fsLeftAt = Date.now();
    document.querySelectorAll('.app-window.fs-active').forEach(w => {
        if (w !== fs) {
            w.classList.remove('fs-active');
            const b = w.querySelector('.fs-btn .material-symbols-outlined');
            if (b) b.textContent = 'fullscreen';
            fitFullscreenCanvas(w);
        }
    });
    if (fs && fs.classList && fs.classList.contains('app-window')) {
        fs.classList.add('fs-active');
        const b = fs.querySelector('.fs-btn .material-symbols-outlined');
        if (b) b.textContent = 'fullscreen_exit';
        // let the fullscreen layout settle before measuring it
        requestAnimationFrame(() => requestAnimationFrame(() => fitFullscreenCanvas(fs)));
    }
}
['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(e =>
    document.addEventListener(e, onFullscreenChange));
window.addEventListener('resize', () => {
    const fs = document.fullscreenElement;
    if (fs && fs.classList && fs.classList.contains('fs-active')) fitFullscreenCanvas(fs);
});

function closeAppWindow(id) {
    const win = document.getElementById(id);
    if (win && document.fullscreenElement === win) exitWindowFullscreen();
    if (win && win._cleanup) win._cleanup();
    win?.remove();
    document.getElementById(`${id}-tb`)?.remove();
    playSound('click');
}

// ===================================================================
// minesweeper.exe (actually playable)
// ===================================================================
function openMinesweeper() {
    const { body, close } = createAppWindow('minesweeper', { icon: 'flag', width: 300 });
    const COLS = 9, ROWS = 9, MINES = 10;
    let grid, revealed, flagged, gameOver, won, firstClick, timer, seconds;
    const numColors = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];

    body.innerHTML = `
        <div class="ms-panel">
            <div class="ms-counter" id="ms-mines">010</div>
            <button class="ms-face bevel-out" id="ms-face">🙂</button>
            <div class="ms-counter" id="ms-timer">000</div>
        </div>
        <div class="ms-grid bevel-in" id="ms-grid"></div>
        <p class="text-[10px] font-pixel text-black mt-1 text-center">left: dig &middot; right: flag</p>`;
    const gridEl = body.querySelector('#ms-grid');
    const faceEl = body.querySelector('#ms-face');
    const minesEl = body.querySelector('#ms-mines');
    const timerEl = body.querySelector('#ms-timer');
    gridEl.style.gridTemplateColumns = `repeat(${COLS}, 22px)`;

    function reset() {
        grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
        revealed = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
        flagged = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
        gameOver = false; won = false; firstClick = true; seconds = 0;
        clearInterval(timer);
        timerEl.textContent = '000';
        minesEl.textContent = String(MINES).padStart(3, '0');
        faceEl.textContent = '🙂';
        render();
    }
    function placeMines(safeR, safeC) {
        let placed = 0;
        while (placed < MINES) {
            const r = Math.floor(Math.random() * ROWS), c = Math.floor(Math.random() * COLS);
            if (grid[r][c] === -1 || (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1)) continue;
            grid[r][c] = -1; placed++;
        }
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            if (grid[r][c] === -1) continue;
            let n = 0;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] === -1) n++;
            }
            grid[r][c] = n;
        }
    }
    function flood(r, c) {
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS || revealed[r][c] || flagged[r][c]) return;
        revealed[r][c] = true;
        if (grid[r][c] === 0) {
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++)
                if (dr || dc) flood(r + dr, c + dc);
        }
    }
    function reveal(r, c) {
        if (gameOver || revealed[r][c] || flagged[r][c]) return;
        if (firstClick) { placeMines(r, c); firstClick = false; timer = setInterval(() => { seconds++; timerEl.textContent = String(Math.min(seconds, 999)).padStart(3, '0'); }, 1000); }
        if (grid[r][c] === -1) {
            revealed[r][c] = true; gameOver = true; clearInterval(timer);
            faceEl.textContent = '💀'; playSound('error');
            render(); checkWin(); return;
        }
        flood(r, c);
        playSound('click');
        render(); checkWin();
    }
    function toggleFlag(r, c) {
        if (gameOver || revealed[r][c]) return;
        flagged[r][c] = !flagged[r][c];
        const count = flagged.flat().filter(Boolean).length;
        minesEl.textContent = String(Math.max(0, MINES - count)).padStart(3, '0');
        render();
    }
    function checkWin() {
        if (gameOver) return;
        let safe = 0;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
            if (grid[r][c] !== -1 && revealed[r][c]) safe++;
        if (safe === ROWS * COLS - MINES) {
            won = true; gameOver = true; clearInterval(timer);
            faceEl.textContent = '😎'; playSound('ding');
            showToast('minesweeper.exe', `you win! ${seconds}s. certified minesweeper legend`);
            if (typeof unlockAchievement === 'function') unlockAchievement('minesweeper');
            if (typeof launchConfetti === 'function') launchConfetti(80);
        }
    }
    function render() {
        gridEl.innerHTML = '';
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            const cell = document.createElement('button');
            cell.className = 'ms-cell';
            if (revealed[r][c]) {
                cell.classList.add('ms-open', 'bevel-in-light');
                if (grid[r][c] === -1) { cell.textContent = '💣'; if (won === false && gameOver) cell.classList.add('ms-boom'); }
                else if (grid[r][c] > 0) { cell.textContent = grid[r][c]; cell.style.color = numColors[grid[r][c]]; }
            } else {
                cell.classList.add('bevel-out');
                if (flagged[r][c]) cell.textContent = '🚩';
                if (gameOver && grid[r] && grid[r][c] === -1 && !flagged[r][c]) cell.textContent = '💣';
            }
            cell.addEventListener('click', () => reveal(r, c));
            cell.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleFlag(r, c); });
            gridEl.appendChild(cell);
        }
    }
    faceEl.addEventListener('click', reset);
    reset();
}

// ===================================================================
// paint.exe (draw + save png)
// ===================================================================
function openPaint() {
    const { body } = createAppWindow('untitled - paint', { icon: 'brush', width: 340 });
    const colors = ['#000000', '#808080', '#c0c0c0', '#ffffff', '#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#800080', '#8b4513', '#0df259'];
    body.innerHTML = `
        <div class="paint-toolbar">
            <div class="paint-colors" id="paint-colors"></div>
            <label class="paint-size">size <input id="paint-size" type="range" min="1" max="24" value="4"></label>
            <button class="bevel-out paint-btn" id="paint-clear">clear</button>
            <button class="bevel-out paint-btn" id="paint-save">save png</button>
        </div>
        <canvas id="paint-canvas" class="bevel-in" width="320" height="240"></canvas>`;
    const canvas = body.querySelector('#paint-canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineJoin = ctx.lineCap = 'round';
    let color = '#000000', size = 4, drawing = false;

    const swatches = body.querySelector('#paint-colors');
    colors.forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'paint-swatch' + (i === 0 ? ' selected' : '');
        b.style.background = c;
        b.onclick = () => {
            color = c;
            swatches.querySelectorAll('.paint-swatch').forEach(s => s.classList.remove('selected'));
            b.classList.add('selected');
        };
        swatches.appendChild(b);
    });
    body.querySelector('#paint-size').addEventListener('input', e => { size = +e.target.value; });

    function pos(e) {
        const r = canvas.getBoundingClientRect();
        const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
        return { x: cx * (canvas.width / r.width), y: cy * (canvas.height / r.height) };
    }
    function start(e) { drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
    function move(e) {
        if (!drawing) return;
        const p = pos(e);
        ctx.strokeStyle = color; ctx.lineWidth = size;
        ctx.lineTo(p.x, p.y); ctx.stroke();
        e.preventDefault();
    }
    function end() { drawing = false; }
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    body.querySelector('#paint-clear').onclick = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); playSound('click'); };
    body.querySelector('#paint-save').onclick = () => {
        const a = document.createElement('a');
        a.download = 'mrhakan-masterpiece.png';
        a.href = canvas.toDataURL('image/png');
        a.click();
        showToast('paint.exe', 'masterpiece saved. put it in a museum');
        if (typeof unlockAchievement === 'function') unlockAchievement('painter');
        playSound('ding');
    };
}

// ===================================================================
// task manager (fake processes, real interactions)
// ===================================================================
function openTaskManager() {
    const { body, close } = createAppWindow('task manager', { icon: 'monitoring', width: 340 });
    let procs = [
        { name: 'winamp.exe', cpu: 12, mem: 4200, kill: () => { stopTrack && stopTrack(); } },
        { name: 'guestbook.exe', cpu: 3, mem: 1100, kill: () => showSection('home') },
        { name: 'shoutbox.exe', cpu: 5, mem: 900 },
        { name: 'trolls.dll', cpu: 42, mem: 6666, kill: () => { if (typeof trollInterval !== 'undefined') clearInterval(trollInterval); document.getElementById('effects-container').querySelectorAll('img').forEach(i => i.remove()); } },
        { name: 'vibes.sys', cpu: 88, mem: 13337 },
        { name: 'explorer.exe', cpu: 2, mem: 2400 },
        { name: 'clippy.exe', cpu: 1, mem: 300, kill: () => hideAssistant() }
    ];
    body.innerHTML = `
        <div class="tm-tabs">applications | <b>processes</b> | performance</div>
        <div class="tm-header"><span>image name</span><span>cpu</span><span>mem</span></div>
        <div class="tm-list" id="tm-list"></div>
        <div class="tm-footer">
            <span id="tm-count"></span>
            <button class="bevel-out tm-endbtn" id="tm-end">end task</button>
        </div>`;
    const listEl = body.querySelector('#tm-list');
    const countEl = body.querySelector('#tm-count');
    let selected = null;

    function render() {
        listEl.innerHTML = '';
        procs.forEach((p, i) => {
            const row = document.createElement('div');
            row.className = 'tm-row' + (selected === i ? ' selected' : '');
            row.innerHTML = `<span>${escapeHtml(p.name)}</span><span>${p.cpu}%</span><span>${p.mem.toLocaleString()}K</span>`;
            row.onclick = () => { selected = i; render(); };
            listEl.appendChild(row);
        });
        const totalCpu = Math.min(100, procs.reduce((s, p) => s + p.cpu, 0));
        countEl.textContent = `processes: ${procs.length}  cpu: ${totalCpu}%`;
    }
    body.querySelector('#tm-end').onclick = () => {
        if (selected == null || !procs[selected]) { showToast('task manager', 'select a process first bradar'); return; }
        const p = procs[selected];
        // vibes.sys is protected... UNLESS it's the last one standing. ending the
        // final process empties the list and unleashes the windows error remix.
        if (p.name === 'vibes.sys' && procs.length > 1) {
            playSound('error');
            showRetroDialog({ title: 'access denied', lines: ['cannot end vibes.sys.', 'this process is critical to the shithole.', '(kill everything else first if you dare)'], okLabel: 'fair enough' });
            return;
        }
        if (p.kill) p.kill();
        procs.splice(selected, 1);
        selected = null;
        playSound('click');
        render();
        if (procs.length === 0) {
            startSpartaRemix();
        } else {
            showToast('task manager', `${p.name} terminated`);
        }
    };
    // live-ish cpu jitter
    const jitter = setInterval(() => {
        procs.forEach(p => { if (p.name !== 'vibes.sys') p.cpu = Math.max(0, Math.min(99, p.cpu + Math.floor(Math.random() * 7) - 3)); });
        render();
    }, 1500);
    const win = document.getElementById(`app-win-${appWinCount}`);
    if (win) { const orig = win._cleanup; win._cleanup = () => { clearInterval(jitter); orig && orig(); }; }
    render();
}

// ===================================================================
// troll assistant (clippy but cursed) — occasional tips
// ===================================================================
const assistantTips = [
    "it looks like you're trying to have fun. want me to stop that?",
    "psst... try the konami code. up up down down...",
    "click the visitor counter 5 times. trust me bradar.",
    "type 'party' anywhere. i dare you.",
    "did you sign the guestbook yet? DID YOU?",
    "press the maximize button on the window. what could go wrong?",
    "minesweeper is in the start menu. procrastinate responsibly.",
    "there's a paint app now. draw me something nice.",
    "type 'bsod' if you miss windows crashing.",
    "solitaire is in the start menu. your boss can't see you.",
    "jokerz 98 is a whole poker roguelike. it will eat your evening.",
    "there is a troll problem in the start menu. build towers, hold the gate.",
    "run defrag.exe and stare at it. that's the whole activity.",
    "press F3. it finds every single thing on this site.",
    "change your screensaver in display properties. mystify is the correct answer.",
    "i'm watching you browse. no reason."
];
let assistantTimer = null;
function initAssistant() {
    if (localStorage.getItem('assistant-off') === '1') return;
    assistantTimer = setTimeout(showAssistant, 25000);
}
function showAssistant() {
    if (document.getElementById('troll-assistant')) return;
    if (document.getElementById('boot-screen') || document.getElementById('screensaver')) {
        assistantTimer = setTimeout(showAssistant, 15000); return;
    }
    const tip = assistantTips[Math.floor(Math.random() * assistantTips.length)];
    const el = document.createElement('div');
    el.id = 'troll-assistant';
    el.innerHTML = `
        <div class="assistant-bubble">
            <p>${escapeHtml(tip)}</p>
            <div class="assistant-actions">
                <button id="assistant-ok">ok ok</button>
                <button id="assistant-off">go away forever</button>
            </div>
        </div>
        <img src="src/emoj/xdtroll.png" alt="assistant" class="assistant-troll">`;
    document.body.appendChild(el);
    playSound('balloon');
    el.querySelector('#assistant-ok').onclick = () => { hideAssistant(); assistantTimer = setTimeout(showAssistant, 45000); };
    el.querySelector('#assistant-off').onclick = () => { localStorage.setItem('assistant-off', '1'); hideAssistant(); showToast('clippy.exe', 'fine. i never liked you either'); };
    el.querySelector('.assistant-troll').onclick = () => { el.querySelector('.assistant-troll').classList.add('spin'); playSound('click'); };
}
function hideAssistant() {
    document.getElementById('troll-assistant')?.remove();
}

// ===================================================================
// WINDOWS ERROR REMIX ("this is sparta" but made of XP error sounds)
// triggered when every process is ended in task manager.
// recreates the classic youtube meme: the error sound chopped into a
// rhythmic beat while error dialogs cascade across the screen in sync.
// ===================================================================
let spartaCtx = null, spartaBuffer = null, spartaActive = false;
let spartaTimers = [], spartaSources = [], spartaGain = null, spartaZ = 9000;

async function loadSpartaBuffer() {
    if (spartaBuffer) return spartaBuffer;
    spartaCtx = spartaCtx || new (window.AudioContext || window.webkitAudioContext)();
    const res = await fetch(win98Sounds.error);
    const arr = await res.arrayBuffer();
    spartaBuffer = await spartaCtx.decodeAudioData(arr);
    return spartaBuffer;
}

async function startSpartaRemix() {
    if (spartaActive) return;
    spartaActive = true;

    let buffer = null;
    try { buffer = await loadSpartaBuffer(); } catch (e) { buffer = null; }
    if (spartaCtx && spartaCtx.state === 'suspended') { try { await spartaCtx.resume(); } catch (e) { } }
    if (spartaCtx) {
        spartaGain = spartaCtx.createGain();
        spartaGain.gain.value = 0.42;
        spartaGain.connect(spartaCtx.destination);
    }

    document.body.classList.add('sparta-mode');
    if (typeof unlockAchievement === 'function') unlockAchievement('sparta');

    // steady rhythm of the REAL windows error sound (natural pitch, no melody).
    // each beat plays the error sound and pops an error dialog on screen.
    const beat = 0.42;   // seconds between error sounds
    const count = 26;    // how many error hits total
    const audioStart = spartaCtx ? spartaCtx.currentTime + 0.12 : 0;

    for (let i = 0; i < count; i++) {
        const t = i * beat;
        // schedule the audio at natural pitch
        if (buffer && spartaCtx) {
            const src = spartaCtx.createBufferSource();
            src.buffer = buffer;
            src.connect(spartaGain);
            try { src.start(audioStart + t); } catch (e) { }
            spartaSources.push(src);
        } else {
            // fallback: plain HTMLAudio at natural pitch
            spartaTimers.push(setTimeout(() => {
                if (!spartaActive || !soundEnabled) return;
                const a = new Audio(win98Sounds.error);
                a.volume = 0.35;
                a.play().catch(() => { });
            }, t * 1000 + 120));
        }
        // spawn a cascading error dialog on each beat + a small screen kick
        spartaTimers.push(setTimeout(() => {
            if (!spartaActive) return;
            spawnSpartaError();
            document.body.classList.add('sparta-kick');
            setTimeout(() => document.body.classList.remove('sparta-kick'), 100);
        }, t * 1000 + 120));
    }

    const total = count * beat * 1000 + 700;
    spartaTimers.push(setTimeout(stopSpartaRemix, total));

    spartaEscHandler = (e) => { if (e.key === 'Escape') stopSpartaRemix(); };
    document.addEventListener('keydown', spartaEscHandler);
}

const spartaMessages = [
    'A fatal exception 0E has occurred', 'vibes.sys is not responding',
    'Illegal operation: too much swag', 'C:\\ is on fire', 'kernel panic: too lit',
    'Error 404: chill not found', 'Windows', 'not enough RAM for these vibes',
    'stack overflow of pure energy', 'CRITICAL_PROCESS_DIED', 'the trolls escaped',
    'This program has performed an illegal operation'
];
function spawnSpartaError() {
    if (document.querySelectorAll('.sparta-error').length > 55) return;
    const el = document.createElement('div');
    el.className = 'sparta-error bevel-out';
    const w = 240, h = 120;
    el.style.left = `${Math.random() * Math.max(0, window.innerWidth - w)}px`;
    el.style.top = `${Math.random() * Math.max(0, window.innerHeight - h - 40)}px`;
    el.style.transform = `rotate(${(Math.random() * 10 - 5).toFixed(1)}deg)`;
    el.style.zIndex = ++spartaZ;
    const msg = spartaMessages[Math.floor(Math.random() * spartaMessages.length)];
    el.innerHTML = `
        <div class="sparta-error-title">Error<span class="sparta-error-x">✕</span></div>
        <div class="sparta-error-body">
            <span class="sparta-error-icon">✕</span>
            <span>${escapeHtml(msg)}</span>
        </div>
        <div class="sparta-error-buttons">
            <button class="bevel-out">OK</button>
            <button class="bevel-out">Cancel</button>
        </div>`;
    // clicking any button removes this popup; if it's the last, stop the madness
    el.querySelectorAll('button, .sparta-error-x').forEach(b => b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        el.remove();
        if (spartaActive && document.querySelectorAll('.sparta-error').length === 0) stopSpartaRemix();
    }));
    document.body.appendChild(el);
}

let spartaEscHandler = null;
function stopSpartaRemix() {
    if (!spartaActive) return;
    spartaActive = false;
    spartaTimers.forEach(clearTimeout); spartaTimers = [];
    spartaSources.forEach(s => { try { s.stop(); } catch (e) { } }); spartaSources = [];
    if (spartaEscHandler) { document.removeEventListener('keydown', spartaEscHandler); spartaEscHandler = null; }
    document.body.classList.remove('sparta-mode', 'sparta-kick');
    document.querySelectorAll('.sparta-error').forEach(e => e.remove());
    showToast('system', 'vibes.sys restored. that was close bradar');
    playSound('startup');
}
