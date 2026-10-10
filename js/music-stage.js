// A concert behind the desktop, using the player's existing audio graph.
// No second MediaElementSource, downloads, or timers per particle.
(function () {
    'use strict';

    const presets = {
        notepad_typing: ['space', 'BROADBAND DREAMS', '#4285ff', '#7deaff', '#dcecff'],
        falling_rain_dark: ['rain', 'MIDNIGHT CATHEDRAL', '#5963e8', '#b2baff', '#dbe5ff'],
        flashing_rainbow_strobe: ['candy', 'KAWAII MAIN STAGE', '#ff55c8', '#67edff', '#fff09a'],
        matrix_digital_rain: ['matrix', 'THE CONSTRUCT', '#00cd72', '#a2ffb2', '#00e7c5'],
        rotating_vinyl_neon: ['disco', 'FRENCH TOUCH / VINYL CLUB', '#00c8e8', '#ff60b7', '#e8ffff'],
        robotic_glitch_text: ['circuit', 'ROBOT ASSEMBLY LINE', '#ff593c', '#4de2ff', '#ffdf7b'],
        comic_book_dots: ['comic', 'FOURTH WALL TOUR', '#ee334a', '#ffce51', '#fff2dc'],
        bouncing_smiley_faces: ['smiley', 'SMILEY WAREHOUSE', '#ffb12a', '#8b7dff', '#fff08a'],
        evolution_morphing: ['evolution', 'EVOLUTION AFTER HOURS', '#46dbaa', '#b8ffc4', '#fcce67'],
        walking_line_man: ['line', 'LA LINEA DISCO', '#93b8ff', '#ffffff', '#ffb86b'],
        dust_particles_wind: ['dust', 'HYBRID DESERT', '#d3a86a', '#dbe3ed', '#77b4ce'],
        troll_bouncing: ['memory', 'FORGOTTEN BALLROOM', '#b39266', '#ead8b4', '#ccaa88'],
        screen_shake_pulse: ['metal', 'MOSH PIT SIGNAL', '#ef3828', '#ff993b', '#ffe0a5'],
        lens_flare_explosions: ['flare', 'HIGHWAY FINALE', '#ffac63', '#58cbe8', '#ffe9c5'],
        unregistered_hypercam_watermark: ['hypercam', 'UNREGISTERED MAIN STAGE', '#6571ff', '#e0ff64', '#7de5ff'],
        phantom_thief: ['phantom', 'PHANTOM FREQUENCY', '#f32647', '#ffffff', '#ff817d'],
        aperture_radio: ['portal', 'APERTURE FM / TEST CHAMBER 00', '#3baeff', '#ff9b3b', '#e0f4ff'],
        winter_wonderland: ['winter', 'PARADISE / NUCLEAR WINTER', '#6ccad6', '#e5efcf', '#f4c66b'],
        red_sun_rays: ['sun', 'RED SUN TRANSMISSION', '#f44532', '#ffce63', '#ffe8aa'],
        eastern_mist: ['eastern', 'ENTER THE EAST / VILLAGE 01', '#58c6ae', '#ffb6c5', '#ead7a0'],
        retro_tv_stage: ['retro', 'LIVE FROM STUDIO 1976', '#ffb85c', '#81d6c7', '#fff0bd']
    };
    const modes = new Set(Object.values(presets).map(p => p[0]));
    let canvas, ctx, container, track, profile, raf = 0;
    let width = 0, height = 0, lastTime = 0, phase = 0;
    let low = 0, high = 0, targetLow = 0, targetHigh = 0, hasSamples = false;
    let bands = [], playing = false, concert = false;
    let audio, hud, status, button, exitButton, previousFocus;
    let reveals = [];

    function profileFor(song) {
        const p = presets[song.effect] || presets.notepad_typing;
        const custom = song.stage || {};
        return {
            mode: modes.has(custom.mode) ? custom.mode : p[0],
            label: custom.label || p[1],
            description: custom.description || '',
            colors: p.slice(2).map((color, i) => {
                const candidate = custom.colors && custom.colors[i];
                return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : color;
            }),
            speed: Math.max(0.2, Math.min(2, Number(custom.speed) || 1)),
            font: custom.font || '"Courier New", monospace'
        };
    }
    function motionOn() {
        return !(window.FX && !FX.on()) && !document.documentElement.classList.contains('no-motion');
    }
    function animateOn() {
        return canvas && ctx && playing && motionOn() && !document.hidden &&
            !(window.FX && FX.slow() && !concert);
    }
    function cancel() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
    }
    function cancelReveal() {
        reveals.forEach(control => control.cancel());
        reveals = [];
        // Cancelling during the first frames can retain Motion's starting
        // transforms. Always settle to the readable CSS state, including the
        // curtain, rather than leaving a paused set behind an opaque wipe.
        if (hud) {
            hud.querySelectorAll('.music-stage-word, .music-stage-label, .music-stage-artist, .music-stage-description, .music-stage-curtain').forEach(el => {
                el.style.removeProperty('opacity'); el.style.removeProperty('transform');
            });
        }
        if (canvas) { canvas.style.removeProperty('opacity'); canvas.style.removeProperty('transform'); }
    }
    function reveal() {
        cancelReveal();
        if (!concert || !playing || !motionOn() || document.hidden || !window.Motion) return;
        const { animate, stagger } = window.Motion;
        const words = hud.querySelectorAll('.music-stage-word');
        const punchy = ['phantom', 'comic', 'metal', 'hypercam', 'circuit'].includes(profile.mode);
        // A finite, overlapping timeline: curtain → label → artist → words.
        // Motion controls are cancelled on replacement, pause and reduced motion.
        reveals.push(animate([
            [hud.querySelector('.music-stage-curtain'), { transform: ['scaleX(1)', 'scaleX(0)'] }, { duration: 0.65, ease: [0.76, 0, 0.24, 1], at: 0 }],
            [hud.querySelector('.music-stage-label'), { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0px)'] }, { duration: 0.45, at: 0.15 }],
            [hud.querySelector('.music-stage-artist'), { opacity: [0, 1], transform: ['translateX(-16px)', 'translateX(0px)'] }, { duration: 0.45, at: 0.22 }],
            [words, { opacity: [0, 1], transform: [`translateY(${punchy ? 65 : 30}px) rotate(${punchy ? -6 : 0}deg)`, 'translateY(0px) rotate(0deg)'] },
                { delay: stagger(0.045), type: 'spring', duration: punchy ? 0.6 : 0.9, bounce: punchy ? 0.25 : 0.08, at: 0.26 }],
            [hud.querySelector('.music-stage-description'), { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0px)'] }, { duration: 0.6, at: 0.55 }]
        ]));
        if (canvas) reveals.push(animate(canvas, { opacity: [0.3, 1], transform: ['scale(1.035)', 'scale(1)'] },
            { duration: 1.1, ease: 'easeOut' }));
    }
    function updateStatus() {
        if (!status) return;
        status.textContent = playing
            ? (hasSamples ? 'LIVE / AUDIO REACTIVE' : 'LIVE / AMBIENT LIGHTS')
            : (audio && audio.currentTime > 0 ? 'PAUSED / LIGHTS ON HOLD' : 'READY / PRESS PLAY');
        hud.classList.toggle('music-is-playing', playing);
    }
    function sync() {
        cancel();
        playing = !!(audio && !audio.paused && !audio.ended);
        if (!playing || !motionOn() || document.hidden) cancelReveal();
        if (track) document.title = `${playing ? '▶' : '♪'} ${track.artist} - ${track.title} | mrhakan's shithole`;
        if (!playing) low = high = targetLow = targetHigh = 0;
        updateStatus();
        if (ctx) draw();
        lastTime = 0;
        if (animateOn()) raf = requestAnimationFrame(tick);
    }
    function resize() {
        if (!canvas || !ctx) return;
        width = document.documentElement.clientWidth || window.innerWidth;
        height = window.innerHeight;
        const slow = window.FX && FX.slow();
        const ratio = Math.min(window.devicePixelRatio || 1, slow ? 1 : 1.5,
            Math.sqrt(1600000 / Math.max(1, width * height)));
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        draw();
    }
    function draw() {
        if (!ctx || !profile || !width) return;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#080b14'; ctx.fillRect(0, 0, width, height);
        // Cover the canvas with an artboard, then frame its focal point. The
        // portrait crop keeps the set above the mobile player, without stretching.
        const portrait = width <= 700;
        const scale = portrait ? Math.max(width / 1100, height / 1400)
            : Math.max(width / 1440, height / 1000);
        const x = portrait ? width * 0.60 - 1000 * scale : (width - 1440 * scale) / 2;
        const y = portrait ? height * 0.23 - 330 * scale : (height - 900 * scale) / 2;
        ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
        if (window.MusicScenes) window.MusicScenes.render(ctx, {
            mode: profile.mode, time: phase * profile.speed,
            low, high, colors: profile.colors
        });
        ctx.restore();
        if (portrait) {
            const bottom = y + 900 * scale;
            const fade = ctx.createLinearGradient(0, bottom - 120, 0, bottom);
            fade.addColorStop(0, 'rgba(8,11,20,0)'); fade.addColorStop(1, '#080b14');
            ctx.fillStyle = fade; ctx.fillRect(0, bottom - 120, width, height);
        }
        // A quiet read area for the concert typography. The art keeps its own
        // lighting, floor, particles and choreography rather than a shared rig.
        const shade = ctx.createLinearGradient(0, 0, width, 0);
        shade.addColorStop(0, 'rgba(5,7,14,0.78)');
        shade.addColorStop(portrait ? 0.7 : 0.48, 'rgba(5,7,14,0.22)');
        shade.addColorStop(1, 'rgba(5,7,14,0)');
        ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height);
        const vignette = ctx.createLinearGradient(0, height * 0.68, 0, height);
        vignette.addColorStop(0, 'rgba(5,7,14,0)'); vignette.addColorStop(1, 'rgba(5,7,14,0.62)');
        ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
        container.style.setProperty('--stage-energy', String(low));
    }
    function tick(now) {
        raf = 0;
        if (!animateOn()) return;
        const fps = window.FX && FX.slow() ? 20 : 30;
        if (!lastTime || now - lastTime >= 1000 / fps) {
            const dt = lastTime ? Math.min(0.08, (now - lastTime) / 1000) : 1 / 30;
            phase += dt;
            low += (targetLow - low) * 0.18;
            high += (targetHigh - high) * 0.12;
            lastTime = now;
            draw();
        }
        raf = requestAnimationFrame(tick);
    }
    function audioFrame(samples) {
        if (!track || !playing || !samples || !samples.length) return;
        let bass = 0, treble = 0;
        const split = Math.max(1, Math.floor(samples.length * 0.025));
        bands = Array.from(samples, value => value / 255);
        for (let i = 0; i < split; i++) bass += bands[i];
        for (let i = split; i < bands.length; i++) treble += bands[i];
        targetLow = bass / split;
        targetHigh = treble / Math.max(1, bands.length - split);
        if (!hasSamples) { hasSamples = true; updateStatus(); }
    }
    function mount(target, song) {
        cancel(); cancelReveal();
        if (concert) toggleSetlist(false);
        container = target; track = song; profile = profileFor(song);
        if (!container || !hud) return;
        container.classList.add('music-stage');
        container.style.removeProperty('opacity');
        canvas = document.createElement('canvas');
        canvas.className = 'music-stage-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        container.replaceChildren(canvas);
        ctx = canvas.getContext('2d');
        hasSamples = false; bands = []; low = high = targetLow = targetHigh = 0; phase = 0;
        const root = document.documentElement;
        root.style.setProperty('--stage-primary', profile.colors[0]);
        root.style.setProperty('--stage-accent', profile.colors[1]);
        root.style.setProperty('--stage-highlight', profile.colors[2]);
        root.style.setProperty('--music-font', profile.font);
        hud.querySelector('.music-stage-artist').textContent = song.artist;
        const title = hud.querySelector('.music-stage-title');
        title.textContent = song.title;
        const words = song.title.split(/\s+/).map(word => {
            const span = document.createElement('span');
            span.className = 'music-stage-word'; span.textContent = word + ' ';
            return span;
        });
        title.replaceChildren(...words);
        hud.querySelector('.music-stage-label').textContent = profile.label;
        hud.querySelector('.music-stage-description').textContent = profile.description;
        hud.querySelector('.music-stage-number').textContent = `SET ${String(song.id).padStart(2, '0')} / 21`;
        hud.dataset.scene = profile.mode;
        container.dataset.scene = profile.mode;
        resize(); sync(); reveal();
    }
    function toggleConcert(force) {
        const next = typeof force === 'boolean' ? force : !concert;
        if (next && !track) {
            if (typeof tracks === 'undefined' || !tracks.length || typeof loadTrack !== 'function') return;
            loadTrack(currentTrackIndex);
        }
        if (!hud || next === concert) return;
        concert = next;
        document.body.classList.toggle('concert-mode', concert);
        hud.hidden = !concert;
        if (button) {
            button.setAttribute('aria-pressed', String(concert));
            button.textContent = concert ? '✦ return to desktop' : '✦ enter concert mode';
        }
        if (concert) {
            previousFocus = document.activeElement;
            exitButton.focus();
        } else if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        resize(); sync();
        if (concert) reveal(); else cancelReveal();
    }
    function toggleSetlist(force) {
        const next = typeof force === 'boolean' ? force : !document.body.classList.contains('concert-setlist');
        document.body.classList.toggle('concert-setlist', next);
        const control = document.getElementById('winamp-setlist');
        if (control) {
            control.setAttribute('aria-expanded', String(next));
            control.textContent = next ? 'close setlist ↓' : 'setlist / 21 tracks ↑';
        }
    }
    function init() {
        audio = document.getElementById('audio-player');
        button = document.getElementById('winamp-concert');
        if (!audio || !button) return;
        hud = document.createElement('section');
        hud.className = 'music-stage-hud'; hud.hidden = true;
        hud.setAttribute('aria-label', 'concert stage');
        hud.innerHTML = '<div class="music-stage-curtain" aria-hidden="true"></div><div class="music-stage-top"><span class="music-stage-brand">MRHAKAN <b>LIVE</b><small class="music-stage-number"></small></span><button class="music-stage-exit" type="button">back to desktop <span>ESC ↗</span></button></div>' +
            '<div class="music-stage-copy"><p class="music-stage-label"></p><p class="music-stage-artist"></p><h1 class="music-stage-title"></h1><p class="music-stage-description"></p><p class="music-stage-status"></p></div>' +
            '<div class="music-stage-bottom"><span>NO TICKETS. JUST GOOD FREQUENCIES.</span><span>STEREO / 98 FM</span></div>';
        document.body.appendChild(hud);
        status = hud.querySelector('.music-stage-status');
        exitButton = hud.querySelector('.music-stage-exit');
        exitButton.addEventListener('click', () => toggleConcert(false));
        ['play', 'pause', 'ended', 'emptied'].forEach(event => audio.addEventListener(event, sync));
        document.addEventListener('visibilitychange', sync);
        window.addEventListener('resize', resize);
        document.addEventListener('keydown', event => {
            if (concert && event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation(); toggleConcert(false);
            }
        }, true);
        // Covers both the OS preference and Display Properties while playing.
        new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    window.MusicStage = { mount, audioFrame, toggleConcert, toggleSetlist, profileFor };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
