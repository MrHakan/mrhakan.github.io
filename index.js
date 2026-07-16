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
    fetchVisitorCount();
    fetchShoutbox();
    fetchGitHubRepos();
    fetchManualProjects();


    fetch('src/music/music.json')
        .then(response => response.json())
        .then(data => {
            tracks = data;
            initPlaylist();
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
    if (typeof Typed === 'undefined' || !document.getElementById('typed-tagline')) return;
    new Typed('#typed-tagline', {
        strings: [
            'just a simple man trying to make his way in the universe...',
            'dont forget to sign the guestbook!',
            'now playing: absolute bangers only',
            'best viewed at 800x600 with ie4',
            'try the konami code ;)',
            'made with notepad and pure love'
        ],
        typeSpeed: 40,
        backSpeed: 20,
        backDelay: 2200,
        loop: true,
        smartBackspace: false
    });
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

function startMenuAction(action) {
    startMenuOpen = false;
    const menu = document.getElementById('start-menu');
    if (menu) menu.classList.add('hidden');
    if (action === 'discord') {
        copyDiscord();
    } else if (action === 'shutdown') {
        shutDown();
    } else {
        showSection(action);
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
        marqueeText.textContent = `::: NOW PLAYING: ${track.artist} - ${track.title} ::: ${track.bg} :::`;
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
    const removeEgg = () => {
        egg.remove();
        document.removeEventListener('keydown', removeEgg);
    };
    setTimeout(() => document.addEventListener('keydown', removeEgg), 500);
}

// ===== more hidden stuff =====
function triggerBSOD() {
    if (document.getElementById('bsod-screen')) return;
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
let counterClicks = 0;
function initCounterEgg() {
    const counter = document.getElementById('visitor-count');
    if (!counter) return;
    counter.parentElement.style.cursor = 'pointer';
    counter.parentElement.addEventListener('click', () => {
        counterClicks++;
        if (counterClicks < 5) return;
        counterClicks = 0;
        playSound('error');
        const original = counter.textContent;
        let spins = 0;
        const spin = setInterval(() => {
            counter.textContent = String(Math.floor(Math.random() * 999999)).padStart(6, '0');
            if (++spins > 20) {
                clearInterval(spin);
                counter.textContent = '999999';
                showToast('h4x0r.exe', 'counter overclocked!! the feds are on their way');
                setTimeout(() => { counter.textContent = original; }, 5000);
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
function nextTrack() {
    currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
    loadTrack(currentTrackIndex);
    playTrack();
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

function loadTrack(index) {
    const audio = document.getElementById('audio-player');
    const text = document.getElementById('winamp-text');

    const src = tracks[index].filename ? `src/music/${tracks[index].filename}` : tracks[index].url;

    audio.src = src;
    audio.load();

    const title = tracks[index].title || "Unknown Track";
    const artist = tracks[index].artist || "Unknown Artist";
    text.textContent = `*** ${artist} - ${title} *** (kbps: 128) ***`;


    const list = document.getElementById('winamp-playlist');
    Array.from(list.children).forEach((child, i) => {
        if (i === index) {
            child.classList.add('bg-[#000080]', 'text-white');
        } else {
            child.classList.remove('bg-[#000080]', 'text-white');
        }
    });

    applyTheme(tracks[index]);
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
            if (confirm("Exit application? (Go to Home)")) window.location.href = 'index.html';
            break;
        case 'edit':
            alert("Clipboard access denied by OS (Windows 98).");
            break;
        case 'view':
            alert("Switching to 800x600 resolution (simulated).");
            break;
        case 'favorites':
            alert("Added 'mrhakan.github.io' to Favorites!");
            break;
        case 'tools':
            alert("Opening Internet Options...");
            break;
        case 'help':
            alert("Digital Soul v1.0\nCreated by: mrhakan\nBuilt with: Notepad");
            break;
    }
}
async function fetchGitHubRepos() {
    const container = document.getElementById('github-repos');
    if (!container) return;
    try {
        const res = await fetch('https://api.github.com/users/mrhakan/repos?sort=updated&per_page=30');
        const repos = await res.json();
        if (!Array.isArray(repos)) throw new Error(repos && repos.message ? repos.message : 'unexpected response');
        container.innerHTML = repos.map(repo => `
            <div class="bg-white border-2 border-black p-2 shadow-[2px_2px_0_rgba(0,0,0,0.5)] hover:bg-[#f0f0f0]">
                <a href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener" class="block">
                    <div class="font-bold text-blue-800 underline font-header mb-1 text-sm">${escapeHtml(repo.name)}</div>
                    <div class="text-[10px] h-8 overflow-hidden text-black font-body mb-2">${escapeHtml(repo.description || 'no description available.')}</div>
                    <div class="flex gap-2 text-[10px] font-pixel text-gray-600">
                        <span>★ ${repo.stargazers_count}</span>
                        <span>⑂ ${repo.forks_count}</span>
                        <span>${escapeHtml(repo.language || 'txt')}</span>
                    </div>
                </a>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<div class="text-red-500 font-pixel">error loading git objects... (github api rate limit? try again later)</div>';
    }
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
const COUNTER_API = 'https://api.counterapi.dev/v2/mrhakans-team-2418/global-visitor-counter';
const COUNTER_TOKEN = '__COUNTER_API_KEY__';
async function fetchVisitorCount() {
    const counterEl = document.getElementById('visitor-count');
    if (!counterEl) return;
    try {
        await fetch(`${COUNTER_API}/up`, {
            headers: { 'Authorization': `Bearer ${COUNTER_TOKEN}` }
        });
        const res = await fetch(COUNTER_API, {
            headers: { 'Authorization': `Bearer ${COUNTER_TOKEN}` }
        });
        const data = await res.json();
        counterEl.textContent = data.value.toString().padStart(6, '0');
    } catch (e) {
        let count = parseInt(localStorage.getItem('visitor-count') || '0');
        count++;
        localStorage.setItem('visitor-count', count);
        counterEl.textContent = count.toString().padStart(6, '0');
    }
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
// visitors add entries by opening a pull request from their own github account.
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

function submitViaPullRequest(kind, entry) {
    const slug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'anon';
    const filename = `data/${kind}/${Date.now()}-${slug}.json`;
    const value = JSON.stringify(entry, null, 4) + '\n';
    const url = `https://github.com/${GH_REPO}/new/${GH_BRANCH}?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(value)}`;
    showRetroDialog({
        title: kind === 'shouts' ? 'shout via github' : 'sign via github',
        lines: [
            'your entry gets added through a github pull request:',
            '1. github opens with your entry pre-filled',
            '2. click "propose changes" then "create pull request"',
            '3. once mrhakan approves it, you are on the wall!',
            'no github account? discord me instead bradar.'
        ],
        okLabel: 'open github',
        cancelLabel: 'nevermind',
        onOk: () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(value).catch(() => { });
            }
            window.open(url, '_blank', 'noopener');
            showToast('github.exe', 'entry copied to clipboard as backup. waiting for your PR!');
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
                            class="text-gray-400 font-normal text-[10px]">${escapeHtml(msg.date || '')}</span></p>
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
    submitViaPullRequest('shouts', {
        name: name.substring(0, 20),
        message: message.substring(0, 140),
        date: new Date().toISOString().slice(0, 10)
    });
}
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
                    <span class="text-[10px] text-gray-500">${escapeHtml(entry.date || '')}</span>
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
            const entry = {
                name: name.substring(0, 30),
                message: message.substring(0, 500),
                date: new Date().toISOString().slice(0, 10)
            };
            const cleanSite = website ? safeUrl(website.substring(0, 100)) : '';
            if (cleanSite) entry.website = cleanSite;
            playSound('ding');
            submitViaPullRequest('guestbook', entry);
        });
    }
});
