(function () {
    'use strict';
    const W = window.WaveShaper, $ = id => document.getElementById(id);
    const canvas = $('wave'), ctx = canvas.getContext('2d');
    const buttons = [...document.querySelectorAll('[data-action]')];
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    // Untimed prototype scores are not comparable with these timed hits.
    const KEY = 'mrhakan98-waveshaper-v2';
    let saved = {};
    try {
        const value = JSON.parse(localStorage.getItem(KEY));
        if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
    } catch (_) { /* Storage is optional. */ }
    const record = () => Number.isSafeInteger(saved.best) && saved.best >= 0 ? saved.best : 0;
    let game = W.create(), phase = 'ready', muted = saved.muted === true;
    let particles = [], pulse = 0, flash = 0, pose = null, poseTime = 0, highlight = -1;
    let raf = 0, last = 0, audio, master, beat = 0, beatTime = 0, activePad = null;
    let previousPad = [false, false, false, false], previousStart = false, usedPad = false;
    function persist() {
        saved.best = Math.max(record(), game.score);
        saved.muted = muted;
        try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (_) { /* Private mode can refuse writes. */ }
    }
    function soundReady() {
        if (muted) return;
        try {
            if (!audio) {
                audio = new (window.AudioContext || window.webkitAudioContext)();
                master = audio.createGain(); master.gain.value = 0.18; master.connect(audio.destination);
            }
            if (audio.state === 'suspended') audio.resume().catch(() => {});
        } catch (_) { /* A silent game is still playable. */ }
    }
    function note(frequency, duration = 0.1, type = 'sine', gain = 0.15) {
        if (muted || !audio || audio.state !== 'running') return;
        const oscillator = audio.createOscillator(), envelope = audio.createGain();
        oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
        envelope.gain.setValueAtTime(gain, audio.currentTime);
        envelope.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
        oscillator.connect(envelope); envelope.connect(master);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
        oscillator.start(); oscillator.stop(audio.currentTime + duration);
    }
    function setMuted(value) {
        muted = value;
        if (master) master.gain.value = muted ? 0 : 0.18;
        $('sound').textContent = 'Sound: ' + (muted ? 'off' : 'on');
        $('sound').setAttribute('aria-pressed', String(!muted));
        if (!muted) soundReady();
        persist();
    }
    function hud() {
        $('score').textContent = game.score;
        $('streak').textContent = game.streak;
        $('lives').textContent = game.lives + ' / ' + W.config.lives;
        $('best').textContent = Math.max(record(), game.score);
        $('pause').disabled = phase === 'ready' || phase === 'over';
        $('pause').textContent = phase === 'paused' ? 'Resume [P]' : 'Pause [P]';
    }
    function overlay(kind) {
        $('overlay').hidden = kind === 'playing';
        if (kind === 'playing') return;
        const paused = kind === 'paused', over = kind === 'over';
        $('eyebrow').textContent = paused ? 'TAKE A BREATH' : over ? 'END OF TRANSMISSION' : 'A LITTLE VECTOR MENACE';
        $('heading').innerHTML = paused ? 'WAVE ON HOLD.' : over ? 'SIGNAL LOST.' : 'FOUR BUTTONS.<br>ONE WAVE.';
        $('instructions').textContent = paused ? 'Your run is safe. Resume when you are ready.' : over ? 'One more run. You know you want to.' : 'Wait for the bend to reach the target, then match its shape and direction. Early, wrong or missed inputs cost a life and cut your speed by 40%.';
        $('results').hidden = !over;
        $('results').textContent = 'SCORE ' + game.score + '  /  LONGEST STREAK ' + game.longest;
        $('start').textContent = paused ? 'RESUME RUN' : over ? 'TRY AGAIN' : 'START RUN';
        $('menu-hint').textContent = paused ? 'ENTER / P TO RESUME · R FOR A NEW RUN' : 'ENTER TO START · GAMEPAD START / MENU';
        if (paused || over) $('start').focus({ preventScroll: true });
    }
    function start() {
        persist();
        game = W.create();
        particles = []; pulse = flash = poseTime = beatTime = beat = 0;
        phase = 'playing'; last = 0; pose = null;
        $('status').textContent = 'Wait for the target. Correct hits speed up the wave; mistakes cut current speed by 40%.';
        soundReady(); hud(); overlay(phase); canvas.focus({ preventScroll: true });
    }
    function pause(message) {
        if (phase !== 'playing') return;
        phase = 'paused'; last = 0; poseTime = 0; persist(); hud(); overlay(phase);
        $('status').textContent = message || 'Paused. Press P, Enter or Start to resume.';
    }
    function resume() {
        if (phase !== 'paused') return;
        phase = 'playing'; last = 0;
        soundReady(); hud(); overlay(phase); canvas.focus({ preventScroll: true });
        $('status').textContent = 'Signal restored. Keep going.';
    }
    function togglePause() { if (phase === 'playing') pause(); else if (phase === 'paused') resume(); }
    function color() {
        return ['#ff4e62', '#ff4e62', '#ffac52', '#e7f761', '#58ff96'][game.lives];
    }
    function burst(obstacle, success) {
        if (motion.matches || !obstacle) return;
        const c = success ? color() : '#ff4e62';
        for (let i = 0; i < 22; i++) {
            const angle = Math.random() * Math.PI * 2, speed = 45 + Math.random() * 170;
            particles.push({ x: obstacle.x, y: 252 + W.actions[obstacle.action].direction * 26,
                vx: Math.cos(angle) * speed - 60, vy: Math.sin(angle) * speed, life: 0.45 + Math.random() * 0.45, color: c });
        }
        if (particles.length > 160) particles.splice(0, particles.length - 160);
    }
    function event(result) {
        if (!result) return;
        if (result.type === 'hit') {
            pulse = 1; burst(result.obstacle, true);
            note([440, 330, 660, 495][result.obstacle.action], 0.12, 'triangle');
            if (result.healed) note(880, 0.2);
            $('status').textContent = (result.healed ? 'Life restored. ' : '') + game.streak + ' streak · ' + (result.speedBonus > 0 ? '+' + result.speedBonus.toFixed(1) + ' speed.' : 'Maximum speed.');
        } else {
            flash = 0.5; burst(result.obstacle, false); note(75, 0.18, 'sawtooth', 0.12);
            $('status').textContent = (result.type === 'early' ? 'Too early. Wait until the bend reaches the target.' : result.type === 'wrong' ? 'Wrong shape at the target.' : 'Missed the target.') + ' Speed −40% (minimum ' + W.config.floor + ').';
        }
        if (game.over) {
            phase = 'over'; persist(); overlay(phase);
            $('status').textContent = 'Run over. Score ' + game.score + ', longest streak ' + game.longest + '. Try again with Enter or Start.';
        }
        hud();
    }
    function action(index, fromPad = false) {
        if (phase !== 'playing') return;
        soundReady(); usedPad = fromPad;
        pose = index; poseTime = 0.16; highlight = index;
        event(W.act(game, index));
    }
    // Click includes keyboard activation and is one action per tap, including on touch screens.
    buttons.forEach(button => button.addEventListener('click', () => action(Number(button.dataset.action))));
    $('start').onclick = () => phase === 'paused' ? resume() : start();
    $('restart').onclick = start;
    $('pause').onclick = togglePause;
    $('sound').onclick = () => setMuted(!muted);
    async function fullscreen() {
        try {
            if (window.frameElement && window.parent.toggleWindowFullscreen) {
                window.parent.toggleWindowFullscreen(window.frameElement.closest('.app-window'));
                return;
            }
            if (document.fullscreenElement) await document.exitFullscreen();
            else if ($('stage').parentElement.requestFullscreen) await $('stage').parentElement.requestFullscreen();
            else $('status').textContent = 'Fullscreen is unavailable in this browser.';
        } catch (_) { $('status').textContent = 'Fullscreen is unavailable in this browser.'; }
    }
    $('fullscreen').onclick = fullscreen;
    document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'; });
    document.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
        const index = { KeyW: 0, KeyS: 1, ArrowUp: 2, ArrowDown: 3 }[e.code];
        if (index !== undefined) {
            e.preventDefault(); if (!e.repeat) action(index); return;
        }
        if (e.repeat) return;
        if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); togglePause(); }
        else if (e.code === 'Enter' && phase !== 'playing') {
            e.preventDefault(); phase === 'paused' ? resume() : start();
        } else if (e.code === 'KeyR') { e.preventDefault(); start(); }
        else if (e.code === 'KeyM') setMuted(!muted);
        else if (e.code === 'KeyF') fullscreen();
    });
    function pollPad() {
        if (document.hasFocus && !document.hasFocus()) return;
        let pads = [];
        try { pads = [...navigator.getGamepads()].filter(p => p && p.connected); } catch (_) { /* Browser may block the API. */ }
        let pad = pads.find(p => p.index === activePad && p.mapping === 'standard') || pads.find(p => p.mapping === 'standard');
        if (!pad) {
            if (activePad !== null && usedPad) pause('Controller disconnected. Reconnect it or resume with the keyboard.');
            activePad = null; previousPad.fill(false); previousStart = false;
            $('pad').textContent = pads.length ? 'Controller mapping unsupported · use keyboard / touch' : 'Keyboard / touch';
            return;
        }
        // Reset edge detection on replacement, so a held trigger cannot leak across controllers.
        const next = W.padActions(pad), startDown = !!(pad.buttons[9] && pad.buttons[9].pressed);
        if (activePad !== pad.index) { activePad = pad.index; previousPad = next; previousStart = startDown; }
        $('pad').textContent = 'GAMEPAD CONNECTED · LB / LT + RB / RT';
        if (startDown && !previousStart) {
            usedPad = true;
            if (phase === 'ready' || phase === 'over') start(); else togglePause();
        } else {
            // Simultaneous inputs count as a single action, never four attempts in one frame.
            const pressed = next.findIndex((down, i) => down && !previousPad[i]);
            if (pressed >= 0) action(pressed, true);
        }
        previousPad = next; previousStart = startDown;
    }
    function bend(x, actionIndex, amplitude = 65, half = 30) {
        const spec = W.actions[actionIndex], tip = 252 + spec.direction * amplitude;
        ctx.lineTo(x - half, 252);
        if (spec.shape === 'square') { ctx.lineTo(x - half, tip); ctx.lineTo(x + half, tip); }
        else ctx.lineTo(x, tip);
        ctx.lineTo(x + half, 252);
    }
    function draw() {
        if (!ctx) return;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 960, 480);
        const accent = color();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.font = 'bold 58px "Courier New", monospace'; ctx.fillText(String(game.score).padStart(3, '0'), 480, 89);
        ctx.font = '10px monospace'; ctx.fillStyle = '#85938d'; ctx.fillText('MATCH THE NEXT BEND', 480, 115);
        const inTarget = game.obstacles[0] && Math.abs(game.obstacles[0].x - W.PLAYER) <= W.HIT_WINDOW;
        ctx.fillStyle = inTarget ? '#164a2c' : '#101c14';
        ctx.fillRect(W.PLAYER - W.HIT_WINDOW, 160, W.HIT_WINDOW * 2, 184);
        ctx.strokeStyle = inTarget ? '#92ffc0' : '#52725d'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(W.PLAYER, 160); ctx.lineTo(W.PLAYER, 344); ctx.stroke();
        ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 252);
        game.obstacles.forEach(obstacle => { if (obstacle.x < 1000) bend(obstacle.x, obstacle.action); });
        ctx.lineTo(960, 252); ctx.stroke();
        if (!motion.matches) {
            particles.forEach(p => { ctx.globalAlpha = Math.min(1, p.life * 2); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 2, 3); });
            ctx.globalAlpha = 1;
            if (pulse > 0) { ctx.strokeStyle = accent; ctx.globalAlpha = pulse * 0.35; ctx.beginPath(); ctx.arc(W.PLAYER, 252, 18 + (1 - pulse) * 58, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
        }
        ctx.strokeStyle = flash > 0 ? '#ff6475' : '#fff'; ctx.lineWidth = 2.5;
        ctx.beginPath();
        if (pose !== null && poseTime > 0) { ctx.moveTo(W.PLAYER - 18, 252); bend(W.PLAYER, pose, 30, 18); }
        else { ctx.moveTo(W.PLAYER, 238); ctx.lineTo(W.PLAYER + 14, 252); ctx.lineTo(W.PLAYER, 266); ctx.lineTo(W.PLAYER - 14, 252); ctx.closePath(); }
        ctx.stroke();
        if (phase === 'playing') {
            ctx.font = '11px monospace'; ctx.fillStyle = '#84978b'; ctx.textAlign = 'left'; ctx.fillText(inTarget ? 'HIT NOW' : 'WAIT FOR THE TARGET', 22, 452);
            ctx.textAlign = 'right'; ctx.fillText((game.speed / W.config.speed).toFixed(2) + '× SPEED', 938, 452);
        }
        buttons.forEach((button, i) => button.classList.toggle('active', poseTime > 0 && highlight === i));
    }
    function frame(now) {
        raf = 0;
        const dt = last ? Math.max(0, Math.min(0.05, (now - last) / 1000)) : 0; last = now;
        pollPad();
        if (phase === 'playing') {
            W.step(game, dt).forEach(event);
            pulse = Math.max(0, pulse - dt * 3); flash = Math.max(0, flash - dt);
            poseTime = Math.max(0, poseTime - dt);
            particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
            particles = particles.filter(p => p.life > 0);
            if (!muted) {
                beatTime += dt;
                if (beatTime >= 0.3) {
                    beatTime %= 0.3; const bassline = [110, 110, 164.81, 146.83, 110, 130.81, 98, 146.83];
                    note(bassline[beat++ % bassline.length], 0.14, 'triangle', 0.12);
                    if (beat % 4 === 0) note(880, 0.035, 'sine', 0.035);
                }
            }
        }
        draw();
        if (!document.hidden) raf = requestAnimationFrame(frame);
    }
    window.addEventListener('blur', () => pause('Paused while you were away. Resume when you are ready.'));
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { pause('Paused while you were away.'); cancelAnimationFrame(raf); raf = 0; }
        else { last = 0; if (!raf) raf = requestAnimationFrame(frame); }
    });
    window.addEventListener('pagehide', persist);
    window.addEventListener('message', e => {
        if (e.source === window.parent && e.origin === location.origin && e.data?.type === 'waveshaper-pause') pause('Paused while minimized. Resume when you are ready.');
    });
    motion.addEventListener('change', () => { particles = []; pulse = 0; });
    setMuted(muted); hud(); draw(); raf = requestAnimationFrame(frame);
})();
