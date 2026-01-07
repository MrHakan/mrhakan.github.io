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

    // Fetch Music Data
    fetch('src/music/music.json')
        .then(response => response.json())
        .then(data => {
            tracks = data;
            initPlaylist();
        })
        .catch(err => console.error('Error loading music:', err));

    audio.addEventListener('timeupdate', updateProgressBar);
    audio.addEventListener('ended', nextTrack);
    audio.addEventListener('play', () => {
        initAudioVisualizer();
        applyTheme(tracks[currentTrackIndex]);
    });

    document.addEventListener('mousemove', createSparkle);
    initDraggable();
    initKonamiCode();

    if (window.innerWidth < 768) {
        const mainWindow = document.getElementById('main-window');
        if (mainWindow) mainWindow.style.position = 'relative';
        console.log('PDA mode detected - drag disabled');
    }
});

function applyTheme(track) {
    if (!track) return;

    const root = document.documentElement;
    const body = document.body;
    const effectsContainer = document.getElementById('effects-container');

    // Apply Colors & Fonts
    if (track.theme) {
        root.style.setProperty('--primary-color', track.theme.primaryColor);
        root.style.setProperty('--accent-color', track.theme.accentColor);
        if (track.theme.fontStyle) {
            // Map simple font names to actual font families if needed, or use directly
            // For now assuming the JSON has valid font-family strings or we fallback
            root.style.setProperty('--font-main', track.theme.fontStyle);
        }

        // Update specific text elements
        document.querySelectorAll('.font-header').forEach(el => {
            el.style.color = track.theme.primaryColor;
            el.style.fontFamily = track.theme.fontStyle || 'var(--font-main)';
        });
    }

    // Apply Background & Effects
    body.className = "font-body overflow-hidden h-screen w-full relative transition-colors duration-1000";
    body.style.backgroundColor = track.theme ? track.theme.primaryColor : '#1a0b2e';

    // Reset effects
    effectsContainer.className = "absolute inset-0 z-1 pointer-events-none h-full w-full fixed overflow-hidden";
    effectsContainer.innerHTML = ''; // Clear DOM based effects
    document.getElementById('main-window').classList.remove('effect-pulse');
    if (typeof trollInterval !== 'undefined') clearInterval(trollInterval);

    if (track.effect) {
        if (track.effect === 'matrix_digital_rain') {
            effectsContainer.classList.add('effect-matrix');
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

    // Update Marquee Text
    const marqueeText = document.querySelector('.animate-marquee span');
    if (marqueeText) {
        marqueeText.textContent = `::: NOW PLAYING: ${track.artist} - ${track.title} ::: ${track.bg} :::`;
        marqueeText.style.color = track.theme ? track.theme.accentColor : '#0df259';
    }
}

let trollInterval;
function startTrollBouncing() {
    const container = document.getElementById('effects-container');
    const images = ['src/troll/troll1.gif', 'src/troll/troll2.gif', 'src/troll/troll3.gif'];
    const trolls = [];

    // Create Trolls
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
    audio.addEventListener('play', () => {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 32;
            const source = audioContext.createMediaElementSource(audio);
            source.connect(analyser);
            analyser.connect(audioContext.destination);
            dataArray = new Uint8Array(analyser.frequencyBinCount);
            updateVisualizer();
        }
    });
}
function updateVisualizer() {
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);
    const bars = document.querySelectorAll('.eq-bar');
    bars.forEach((bar, i) => {
        const value = dataArray[i % dataArray.length] || 0;
        const height = Math.max(10, (value / 255) * 100);
        bar.style.height = `${height}%`;
        bar.style.animation = 'none';
    });
    requestAnimationFrame(updateVisualizer);
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
            isDragging = true;
            offsetX = e.clientX - win.getBoundingClientRect().left;
            offsetY = e.clientY - win.getBoundingClientRect().top;
            win.classList.add('dragging');
            win.style.position = 'fixed';
            highestZ++;
            win.style.zIndex = highestZ;
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            win.style.left = `${e.clientX - offsetX}px`;
            win.style.top = `${e.clientY - offsetY}px`;
        });
        document.addEventListener('mouseup', () => {
            isDragging = false;
            win.classList.remove('dragging');
        });
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
        <img src="https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif" style="max-width:300px;">
        <h1 style="color:#0df259;font-family:'Comic Sans MS';font-size:3rem;margin-top:20px;">YOU FOUND THE SECRET!</h1>
        <p style="color:white;font-family:monospace;">press any key to return...</p>
    `;
    document.body.appendChild(egg);
    const removeEgg = () => {
        egg.remove();
        document.removeEventListener('keydown', removeEgg);
    };
    setTimeout(() => document.addEventListener('keydown', removeEgg), 500);
}
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

    // Handle new JSON structure vs legacy support if needed
    // JSON uses "filename", legacy might have used "url"
    const src = tracks[index].filename ? `src/music/${tracks[index].filename}` : tracks[index].url;

    audio.src = src;
    audio.load();

    const title = tracks[index].title || "Unknown Track";
    const artist = tracks[index].artist || "Unknown Artist";
    text.textContent = `*** ${artist} - ${title} *** (kbps: 128) ***`;

    // Update active item in playlist
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

function updateVisualizer() {
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);

    // Standard EQ Bars
    const bars = document.querySelectorAll('.eq-bar');
    bars.forEach((bar, i) => {
        const value = dataArray[i * 2 % dataArray.length] || 0;
        const height = Math.max(10, (value / 255) * 100);
        bar.style.height = `${height}%`;
        bar.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color');
    });

    // Audio Reactivity for Background
    // Calculate average bass (low frequencies)
    let bass = 0;
    for (let i = 0; i < 4; i++) bass += dataArray[i];
    bass = bass / 4;

    const effectsContainer = document.getElementById('effects-container');
    const mainWindow = document.getElementById('main-window');

    // Beat detection / Intensity modulation
    if (bass > 200) {
        // High intensity
        document.body.style.filter = `brightness(1.2) contrast(1.1)`;
        if (mainWindow.classList.contains('effect-pulse')) {
            mainWindow.style.transform = `scale(${1 + (bass - 200) / 500})`;
        }
    } else {
        document.body.style.filter = `brightness(1) contrast(1)`;
        mainWindow.style.transform = 'scale(1)';
    }

    // Modulate effects opacity based on volume
    if (effectsContainer) {
        const volume = dataArray.reduce((src, a) => src + a, 0) / dataArray.length;
        effectsContainer.style.opacity = 0.5 + (volume / 510); // 0.5 to 1.0
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
    const btn = document.getElementById('sound-toggle');
    if (btn) btn.textContent = soundEnabled ? '[sound: on]' : '[sound: off]';
    if (soundEnabled) playSound('ding');
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
    try {
        const res = await fetch('https://api.github.com/users/mrhakan/repos?sort=updated');
        const repos = await res.json();
        container.innerHTML = repos.map(repo => `
            <div class="bg-white border-2 border-black p-2 shadow-[2px_2px_0_rgba(0,0,0,0.5)] hover:bg-[#f0f0f0]">
                <a href="${repo.html_url}" target="_blank" class="block">
                    <div class="font-bold text-blue-800 underline font-header mb-1 text-sm">${repo.name}</div>
                    <div class="text-[10px] h-8 overflow-hidden text-black font-body mb-2">${repo.description || 'no description available.'}</div>
                    <div class="flex gap-2 text-[10px] font-pixel text-gray-600">
                        <span>★ ${repo.stargazers_count}</span>
                        <span>⑂ ${repo.forks_count}</span>
                        <span>${repo.language || 'txt'}</span>
                    </div>
                </a>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<div class="text-red-500 font-pixel">error loading properties...</div>';
    }
}
function copyDiscord() {
    navigator.clipboard.writeText('mrhakan');
    alert('discord username "mrhakan" has been copied to your clipboard!');
}
const COUNTER_API = 'https://api.counterapi.dev/v2/mrhakans-team-2418/first-counter-2418';
const COUNTER_TOKEN = '__COUNTER_API_KEY__';
async function fetchVisitorCount() {
    try {
        await fetch(`${COUNTER_API}/up`, {
            headers: { 'Authorization': `Bearer ${COUNTER_TOKEN}` }
        });
        const res = await fetch(COUNTER_API, {
            headers: { 'Authorization': `Bearer ${COUNTER_TOKEN}` }
        });
        const data = await res.json();
        document.getElementById('visitor-count').textContent = data.value.toString().padStart(6, '0');
    } catch (e) {
        let count = parseInt(localStorage.getItem('visitor-count') || '1337');
        count++;
        localStorage.setItem('visitor-count', count);
        document.getElementById('visitor-count').textContent = count.toString().padStart(6, '0');
    }
}
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
const staticShoutboxMessages = [];
function fetchShoutbox() {
    const container = document.getElementById('shoutbox-messages');
    if (!container) return;
    const saved = localStorage.getItem('shoutbox-messages');
    const messages = saved ? JSON.parse(saved) : staticShoutboxMessages;
    container.innerHTML = messages.map((msg, i) => `
        <div class="border-b border-dashed border-gray-300 pb-1 flex gap-2">
            <img src="${shoutboxAvatars[msg.avatar !== undefined ? msg.avatar : i % shoutboxAvatars.length]}" alt="" class="w-6 h-6 rounded-full bg-black flex-shrink-0">
            <div>
                <p class="font-bold ${msg.color || 'text-black'}">${escapeHtml(msg.name)} <span
                        class="text-gray-400 font-normal text-[10px]">${msg.time}</span></p>
                <p class="text-black">${escapeHtml(msg.message)}</p>
            </div>
        </div>
        </div>
    `).join('');
}
function postShout() {
    const name = document.getElementById('shout-name')?.value?.trim();
    const message = document.getElementById('shout-message')?.value?.trim();
    if (!name || !message) {
        alert("please fill in all fields!");
        return;
    }
    const saved = localStorage.getItem('shoutbox-messages');
    const messages = saved ? JSON.parse(saved) : [...staticShoutboxMessages];
    const randomAvatar = Math.floor(Math.random() * shoutboxAvatars.length);
    messages.unshift({
        name: name.substring(0, 20),
        message: message.substring(0, 140),
        time: "just now",
        color: "text-blue-600",
        avatar: randomAvatar
    });
    if (messages.length > 20) messages.length = 20;
    localStorage.setItem('shoutbox-messages', JSON.stringify(messages));
    document.getElementById('shout-name').value = '';
    document.getElementById('shout-message').value = '';
    fetchShoutbox();
    alert("message saved locally! (github pages = no server)");
}
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
function loadGuestbook() {
    const container = document.getElementById('guestbook-entries');
    if (!container) return;
    const saved = localStorage.getItem('guestbook-entries');
    const entries = saved ? JSON.parse(saved) : [];
    if (entries.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 font-pixel">no entries yet - be the first!</div>';
        return;
    }
    container.innerHTML = entries.map(entry => `
        <div class="p-3 bg-[#f0f0f0] border border-gray-400">
            <div class="flex justify-between items-start mb-1">
                <span class="font-bold text-blue-600 font-header">${escapeHtml(entry.name)}</span>
                <span class="text-[10px] text-gray-500">${entry.time}</span>
            </div>
            ${entry.website ? `<a href="${escapeHtml(entry.website)}" target="_blank" class="text-xs text-purple-600 underline">${escapeHtml(entry.website)}</a>` : ''}
            <p class="text-black font-pixel text-sm mt-1">${escapeHtml(entry.message)}</p>
        </div>
    `).join('');
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
            const saved = localStorage.getItem('guestbook-entries');
            const entries = saved ? JSON.parse(saved) : [];
            entries.unshift({
                name: name.substring(0, 30),
                website: website.substring(0, 100),
                message: message.substring(0, 500),
                time: new Date().toLocaleDateString()
            });
            if (entries.length > 50) entries.length = 50;
            localStorage.setItem('guestbook-entries', JSON.stringify(entries));
            document.getElementById('gb-name').value = '';
            document.getElementById('gb-website').value = '';
            document.getElementById('gb-message').value = '';
            loadGuestbook();
            playSound('ding');
            alert('thanks for signing!');
        });
    }
});
