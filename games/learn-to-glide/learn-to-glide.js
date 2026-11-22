// learn to glide 98 - the page: drawing, input, the hangar, saves and sound.
// the rules live in learn-to-glide-sim.js (window.LTG_SIM).
(function () {
    'use strict';
    const S = window.LTG_SIM;
    const $ = id => document.getElementById(id);
    const canvas = $('view'), ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const SAVE_KEY = 'mrhakan98-learntoglide-save';
    const REC_KEY = 'mrhakan98-learntoglide-records';
    const HOWTO_KEY = 'mrhakan98-learntoglide-howto';
    const ICONS = { ramp: '📐', sled: '🛷', glider: '🪂', rocket: '🚀', payload: '💰' };
    const BALLOON_COLORS = ['#e8413c', '#f7c21b', '#3fb34f', '#3a7be0', '#d55fd0'];
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');

    // ---------------------------------------------------------------- storage
    function load(key) {
        try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
    }
    function store(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage blocked: play on */ }
    }
    function readRecords() {
        const r = load(REC_KEY), num = v => (Number.isFinite(v) && v >= 0 ? v : 0);
        return { bestDays: r && Number.isInteger(r.bestDays) && r.bestDays > 0 ? r.bestDays : 0,
            bestDistance: num(r && r.bestDistance), seasons: Math.floor(num(r && r.seasons)), wins: Math.floor(num(r && r.wins)) };
    }
    let records = readRecords();

    // ---------------------------------------------------------------- sound
    let audio = null;
    function soundOn() { try { return localStorage.getItem('sound-enabled') !== 'false'; } catch (_) { return true; } }
    function beep(freq, dur, type, vol, slide) {
        if (!soundOn()) return;
        try {
            if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
            if (audio.state === 'suspended') audio.resume();
            const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
            o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
            if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
            g.gain.setValueAtTime(vol || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
        } catch (_) { /* no audio, no problem */ }
    }

    // ---------------------------------------------------------------- state
    let game = S.restore(load(SAVE_KEY)) || S.newGame(newSeed());
    let run = null;            // the run in the sky, or a preview on the ramp
    let phase = 'hangar';      // hangar | run | report | end
    let paused = false, raf = 0, last = 0, acc = 0, endTimer = 0, timeScale = 1;
    let lastReport = null;
    const input = { pitch: 0, boost: false };
    const held = { up: false, down: false, boost: false, kUp: false, kDown: false, kBoost: false };
    const cam = { x: 0, y: 0, ppm: 4 };
    let shake = 0, flash = 0, autopilot = false;

    function newSeed() { return ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 98; }
    function save() { store(SAVE_KEY, game); }
    function say(text) { $('status').textContent = text; }

    // ---------------------------------------------------------------- particles (fixed pool)
    const POOL = 90, parts = [];
    for (let i = 0; i < POOL; i++) parts.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, c: '#fff', r: 2, world: true });
    let partNext = 0;
    function spark(x, y, vx, vy, life, c, r) {
        const p = parts[partNext]; partNext = (partNext + 1) % POOL;
        p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life; p.c = c; p.r = r;
    }
    function burst(x, y, n, c, speed) {
        if (reduced.matches) n = Math.min(n, 4);
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
            spark(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.5 + Math.random() * 0.6, c, 2 + Math.random() * 2);
        }
    }
    function stepParts(dt) {
        for (let i = 0; i < POOL; i++) {
            const p = parts[i];
            if (!p.on) continue;
            p.life -= dt; if (p.life <= 0) { p.on = false; continue; }
            p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 9.8 * dt * 0.6;
        }
    }

    // ---------------------------------------------------------------- scenery (built once)
    const peaks = [];
    { const r = S.rng(1998); for (let i = 0; i < 24; i++) peaks.push({ x: i * 110 + r() * 50, h: 60 + r() * 110, w: 90 + r() * 90 }); }
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2a6fd6'); sky.addColorStop(0.65, '#8fc6f2'); sky.addColorStop(1, '#d9efff');

    function sx(x) { return W * 0.38 + (x - cam.x) * cam.ppm; }
    function sy(y) { return H * 0.5 - (y - cam.y) * cam.ppm; }

    function updateCamera(dt, snap) {
        const r = run;
        let tx, ty, tp;
        if (!r) {
            const st = S.stats(game.levels), L = st.rampH / Math.sin(st.rampAngle);
            tx = -L * Math.cos(st.rampAngle) * 0.35; ty = S.CLIFF + st.rampH * 0.5;
            tp = Math.max(1.3, Math.min(4, 230 / (st.rampH + 25)));
        } else {
            const speed = Math.hypot(r.vx, r.vy);
            tp = Math.max(0.32, Math.min(4.2, 300 / (r.y + 40 + speed * 1.5)));
            tx = r.x + Math.min(60, speed * 0.5);
            ty = r.y;
        }
        const k = snap ? 1 : Math.min(1, dt * 3);
        cam.ppm += (tp - cam.ppm) * k;
        cam.x += (tx - cam.x) * (snap ? 1 : Math.min(1, dt * 8));
        // keep the ice near the bottom while low
        const minY = (H * 0.5 - 34) / cam.ppm;
        const want = Math.max(ty, minY);
        cam.y += (want - cam.y) * (snap ? 1 : Math.min(1, dt * 6));
        if (cam.y < minY) cam.y = minY;
    }

    // ---------------------------------------------------------------- drawing
    function drawBackground() {
        ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
        const alt = run ? run.y : 0;
        if (alt > 150) { ctx.fillStyle = 'rgba(8,16,60,' + Math.min(0.55, (alt - 150) / 1400) + ')'; ctx.fillRect(0, 0, W, H); }
        // sun
        ctx.fillStyle = '#fff6b0'; ctx.beginPath(); ctx.arc(W - 90, 70, 26, 0, Math.PI * 2); ctx.fill();
        // far mountains, slow parallax
        const base = Math.min(H, sy(0) + 10);
        const off = (cam.x * 0.08) % 2640;
        ctx.fillStyle = '#a9c7e4';
        ctx.beginPath(); ctx.moveTo(0, base);
        for (let rep = 0; rep < 2; rep++) {
            for (let i = 0; i < peaks.length; i++) {
                const p = peaks[i], px = p.x + rep * 2640 - off;
                if (px < -200 || px > W + 200) continue;
                ctx.lineTo(px - p.w / 2, base); ctx.lineTo(px, base - p.h); ctx.lineTo(px + p.w / 2, base);
            }
        }
        ctx.lineTo(W, base); ctx.closePath(); ctx.fill();
    }

    function drawCloud(c) {
        const x0 = sx(c.x), x1 = sx(c.x + c.w);
        if (x1 < -40 || x0 > W + 40) return;
        const yc = sy(c.y), hh = c.h / 2 * cam.ppm, ww = x1 - x0;
        ctx.fillStyle = 'rgba(120,128,140,0.78)';
        ctx.beginPath();
        ctx.ellipse(x0 + ww * 0.5, yc, ww * 0.5, hh, 0, 0, Math.PI * 2);
        ctx.ellipse(x0 + ww * 0.3, yc - hh * 0.4, ww * 0.25, hh * 0.9, 0, 0, Math.PI * 2);
        ctx.ellipse(x0 + ww * 0.68, yc - hh * 0.3, ww * 0.22, hh * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
        if (ww > 60) { ctx.fillStyle = '#e6eef7'; ctx.font = '10px Tahoma'; ctx.fillText('soggy', x0 + ww * 0.42, yc + 3); }
    }

    function drawBalloon(b) {
        if (b.popped) return;
        const x = sx(b.x), y = sy(b.y);
        if (x < -20 || x > W + 20 || y < -30 || y > H + 30) return;
        const r = Math.max(6, 6 * cam.ppm * 0.45);
        ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y + r); ctx.lineTo(x + 2, y + r * 2.6); ctx.stroke();
        ctx.fillStyle = BALLOON_COLORS[b.hue];
        ctx.beginPath(); ctx.ellipse(x, y, r * 0.85, r, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.22, 0, Math.PI * 2); ctx.fill();
    }

    function drawGround() {
        const y0 = sy(0), yc = sy(S.CLIFF), xl = sx(0);
        // sea ice
        ctx.fillStyle = '#e9f4fb'; ctx.fillRect(Math.max(0, xl), y0, W, H - y0);
        ctx.fillStyle = '#b9d6ea'; ctx.fillRect(Math.max(0, xl), y0, W, 3);
        // the cliff
        if (xl > 0) {
            ctx.fillStyle = '#7b8792'; ctx.fillRect(0, yc, xl, H - yc);
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, yc - 4, xl, 6);
            ctx.fillStyle = '#5f6a74'; ctx.fillRect(xl - 6, yc, 6, H - yc);
        }
        // distance flags
        const step = cam.ppm > 1.5 ? 50 : cam.ppm > 0.6 ? 100 : 250;
        const from = Math.max(step, Math.ceil((cam.x - W * 0.38 / cam.ppm) / step) * step);
        const to = Math.min(S.WALL_X - 1, cam.x + W / cam.ppm);
        ctx.font = '10px Tahoma'; ctx.textAlign = 'center';
        for (let d = from; d <= to; d += step) {
            const x = sx(d);
            ctx.strokeStyle = '#5c6670'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 - 14); ctx.stroke();
            ctx.fillStyle = d % 500 ? '#d33' : '#004cff'; ctx.fillRect(x, y0 - 14, 8, 5);
            ctx.fillStyle = '#334'; ctx.fillText(d + 'm', x, y0 + 13);
        }
        ctx.textAlign = 'left';
        // best mark
        const best = game.best.distance;
        if (best > 10) {
            const x = sx(best);
            if (x > 0 && x < W) { ctx.fillStyle = '#008000'; ctx.fillRect(x - 1, y0 - 26, 2, 26); ctx.fillText('best', x + 3, y0 - 18); }
        }
    }

    function drawRamp() {
        const st = run ? run.st : S.stats(game.levels);
        const L = st.rampH / Math.sin(st.rampAngle);
        const tx = -L * Math.cos(st.rampAngle), ty = S.CLIFF + st.rampH;
        const x0 = sx(tx), y0 = sy(ty), x1 = sx(0), y1 = sy(S.CLIFF);
        if (x1 < -10) return;
        ctx.strokeStyle = '#6b4423'; ctx.lineWidth = Math.max(1, cam.ppm * 0.5);
        for (let i = 1; i < 5; i++) {
            const f = i / 5, px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, yc()); ctx.stroke();
        }
        ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = Math.max(3, cam.ppm * 1.2);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        ctx.lineTo(x1 + Math.cos(st.lip) * 3 * cam.ppm, y1 - Math.sin(st.lip) * 3 * cam.ppm); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, y0 - 2); ctx.lineTo(x1, y1 - 2); ctx.stroke();
        function yc() { return sy(S.CLIFF); }
    }

    function drawWall() {
        const x = sx(S.WALL_X);
        if (x > W + 10) {
            return;
        }
        const y0 = sy(0), w = Math.max(14, 30 * cam.ppm);
        const broke = run && run.broke;
        ctx.fillStyle = broke ? 'rgba(150,210,250,0.45)' : '#9fd3f5';
        ctx.fillRect(x, 0, w, y0);
        ctx.strokeStyle = '#4a90c8'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const yy = y0 - (i * 47 % 300) * Math.max(0.6, cam.ppm * 0.4);
            ctx.moveTo(x + 3, yy); ctx.lineTo(x + w * 0.6, yy - 12); ctx.lineTo(x + w - 3, yy - 4);
        }
        ctx.stroke();
        ctx.fillStyle = '#063a66'; ctx.font = 'bold 11px Tahoma';
        ctx.save(); ctx.translate(x + w / 2 + 4, Math.max(60, y0 - 70)); ctx.rotate(-Math.PI / 2);
        ctx.fillText(broke ? 'smashed!' : 'ice wall · ' + S.WALL_SPEED + ' m/s', 0, 0); ctx.restore();
    }

    function drawPenguin() {
        const r = run, st = r ? r.st : S.stats(game.levels);
        let px, py, ang;
        if (r) { px = r.x; py = r.y; ang = r.phase === 'ramp' ? -st.rampAngle : r.phase === 'skid' ? 0 : r.pitch; }
        else {
            const L = st.rampH / Math.sin(st.rampAngle);
            px = -L * Math.cos(st.rampAngle); py = S.CLIFF + st.rampH; ang = -st.rampAngle;
        }
        const x = sx(px), y = sy(py);
        const k = 1.15;
        ctx.save(); ctx.translate(x, y); ctx.rotate(-ang); ctx.scale(k, k);
        ctx.translate(0, -9);
        // glider wing behind
        const gl = game.levels.glider;
        if (gl > 0 && (!r || r.phase !== 'skid')) {
            ctx.fillStyle = ['#000', '#333', '#e85d2a', '#2b2b2b', '#1b1b3a'][gl];
            ctx.beginPath(); ctx.moveTo(-14 - gl * 2, -10); ctx.lineTo(14 + gl * 3, -14); ctx.lineTo(4, -6); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#999'; ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, -1); ctx.stroke();
        }
        // rocket on the back
        const rl = game.levels.rocket;
        if (rl > 0) {
            ctx.fillStyle = ['#000', '#d33', '#3a3', '#888', '#eee'][rl];
            ctx.fillRect(-15, -4, 12, 6);
            ctx.fillStyle = '#d33'; ctx.beginPath(); ctx.moveTo(-3, -4); ctx.lineTo(1, -1); ctx.lineTo(-3, 2); ctx.fill();
            if (r && r.boosting) {
                const f = 8 + Math.random() * 8;
                ctx.fillStyle = '#ffb300'; ctx.beginPath(); ctx.moveTo(-15, -4); ctx.lineTo(-15 - f, -1); ctx.lineTo(-15, 2); ctx.fill();
                ctx.fillStyle = '#fff3a0'; ctx.beginPath(); ctx.moveTo(-15, -3); ctx.lineTo(-15 - f * 0.5, -1); ctx.lineTo(-15, 1); ctx.fill();
            }
        }
        // body (lying on its belly, head first)
        ctx.fillStyle = '#16181f';
        ctx.beginPath(); ctx.ellipse(0, 0, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f4f4f4';
        ctx.beginPath(); ctx.ellipse(1, 2.5, 10, 4.2, 0, 0, Math.PI * 2); ctx.fill();
        // head
        ctx.fillStyle = '#16181f'; ctx.beginPath(); ctx.arc(12, -2, 5.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(13.5, -3.5, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(14.2, -3.5, 1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff9a1f'; ctx.beginPath(); ctx.moveTo(16.5, -2); ctx.lineTo(22, -0.5); ctx.lineTo(16.5, 1); ctx.fill();
        // scarf
        ctx.fillStyle = '#d42a2a'; ctx.fillRect(6, -4, 3, 7);
        ctx.fillRect(1, -5 + Math.sin(Date.now() / 90) * 1.5, 6, 2);
        // feet
        ctx.fillStyle = '#ff9a1f'; ctx.fillRect(-14, 1, 4, 2);
        // sled under the belly
        const sl = game.levels.sled;
        if (sl > 0) {
            ctx.fillStyle = ['#000', '#c8a165', '#2a8cd1', '#d8332a', '#e8c100'][sl];
            ctx.fillRect(-12, 6.5, 24, 2.5);
            ctx.fillStyle = '#555'; ctx.fillRect(-10, 9, 22, 1.2);
            ctx.beginPath(); ctx.arc(12, 7.5, 2, -Math.PI / 2, Math.PI / 2); ctx.fill();
        }
        ctx.restore();
    }

    function drawParts() {
        for (let i = 0; i < POOL; i++) {
            const p = parts[i];
            if (!p.on) continue;
            ctx.globalAlpha = Math.max(0, p.life / p.max);
            ctx.fillStyle = p.c;
            ctx.fillRect(sx(p.x) - p.r / 2, sy(p.y) - p.r / 2, p.r, p.r);
        }
        ctx.globalAlpha = 1;
    }

    function hudText(t, x, y) { ctx.fillStyle = '#000'; ctx.fillText(t, x + 1, y + 1); ctx.fillStyle = '#fff'; ctx.fillText(t, x, y); }
    function drawHud() {
        const r = run;
        const st = r ? r.st : S.stats(game.levels);
        // the win98 panel
        ctx.fillStyle = '#c0c0c0'; ctx.fillRect(8, 8, 176, 82);
        ctx.fillStyle = '#fff'; ctx.fillRect(8, 8, 176, 2); ctx.fillRect(8, 8, 2, 82);
        ctx.fillStyle = '#808080'; ctx.fillRect(8, 88, 176, 2); ctx.fillRect(182, 8, 2, 82);
        ctx.fillStyle = '#000080'; ctx.fillRect(10, 10, 172, 14);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Tahoma'; ctx.fillText('flight data · day ' + Math.min(S.MAX_DAYS, game.day + 1), 14, 21);
        ctx.fillStyle = '#000'; ctx.font = '11px "Courier New", monospace';
        const speed = r ? Math.hypot(r.vx, r.vy) : 0;
        ctx.fillText('dist  ' + (r ? Math.max(0, r.x) : 0).toFixed(0).padStart(5) + ' m', 14, 38);
        ctx.fillText('alt   ' + (r ? r.y : S.CLIFF + st.rampH).toFixed(0).padStart(5) + ' m', 14, 51);
        ctx.fillText('speed ' + speed.toFixed(1).padStart(5) + ' m/s', 14, 64);
        // fuel
        ctx.fillText('fuel', 14, 80);
        ctx.fillStyle = '#fff'; ctx.fillRect(48, 71, 128, 11);
        if (st.fuel > 0) {
            const f = r ? r.fuel / st.fuel : 1;
            ctx.fillStyle = f > 0.3 ? '#008000' : '#c00000'; ctx.fillRect(49, 72, 126 * f, 9);
        } else { ctx.fillStyle = '#808080'; ctx.font = '9px Tahoma'; ctx.fillText('no rockets', 82, 80); }
        // progress to the wall
        const bx = 196, bw = W - bx - 12;
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(bx, 10, bw, 8);
        ctx.fillStyle = '#9fd3f5'; ctx.fillRect(bx + bw - 4, 6, 4, 16);
        if (game.best.distance > 0) { ctx.fillStyle = '#7f7'; ctx.fillRect(bx + bw * Math.min(1, game.best.distance / S.WALL_X) - 1, 8, 2, 12); }
        const pr = r ? Math.max(0, Math.min(1, r.x / S.WALL_X)) : 0;
        ctx.fillStyle = '#ffd400'; ctx.fillRect(bx, 10, bw * pr, 8);
        ctx.font = '10px Tahoma';
        hudText('ice wall ' + S.WALL_X + ' m', bx + bw - 76, 32);
        if (r && r.phase === 'air') {
            // speed vs the wall's demand
            const ok = speed >= S.WALL_SPEED;
            ctx.fillStyle = ok ? '#7f7' : '#fff';
            hudText((ok ? 'fast enough to smash it' : 'need ' + S.WALL_SPEED + ' m/s at the wall'), bx, 32);
            if (r.inCloud) hudText('in a cloud: soggy wings!', bx, 46);
            const aoa = r.pitch - Math.atan2(r.vy, r.vx);
            if (Math.abs(aoa) > 0.3 && speed > 5) { ctx.fillStyle = '#ff0'; ctx.font = 'bold 14px Tahoma'; hudText('STALL', W / 2 - 22, 70); }
        }
        if (paused && phase === 'run') {
            ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, W, H);
        }
    }

    function draw() {
        if (shake > 0 && !reduced.matches) { ctx.save(); ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); }
        drawBackground();
        const r = run;
        const clouds = r ? r.clouds : null, balloons = r ? r.balloons : null;
        if (clouds) for (let i = 0; i < clouds.length; i++) drawCloud(clouds[i]);
        drawGround();
        drawRamp();
        drawWall();
        if (balloons) for (let i = 0; i < balloons.length; i++) drawBalloon(balloons[i]);
        drawParts();
        drawPenguin();
        if (shake > 0 && !reduced.matches) ctx.restore();
        if (flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.8, flash) + ')'; ctx.fillRect(0, 0, W, H); }
        drawHud();
    }

    // ---------------------------------------------------------------- ui
    function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
    function syncBar() {
        $('day').textContent = Math.min(S.MAX_DAYS, game.day + (game.over ? 0 : 1)) + '/' + S.MAX_DAYS;
        $('money').textContent = fmt(game.money);
        $('best').textContent = fmt(game.best.distance) + ' m';
        $('pause').disabled = phase !== 'run';
        $('pause').textContent = paused ? 'resume' : 'pause';
    }
    const dialogs = ['howto', 'shop', 'report', 'end', 'pause'];
    let howtoOpen = false;
    function showDialog(name) {
        for (const d of dialogs) $('dlg-' + d).hidden = d !== name;
        $('stage').classList.toggle('has-dlg', !!name);
        const first = name && $('dlg-' + name).querySelector('button:not(:disabled)');
        const focusBtn = name === 'shop' ? $('launch') : first;
        if (focusBtn) focusBtn.focus({ preventScroll: true });
        else canvas.focus({ preventScroll: true });
    }
    function currentDialog() { for (const d of dialogs) if (!$('dlg-' + d).hidden) return d; return null; }

    function pips(level) {
        let s = '<span class="pips" aria-hidden="true">';
        for (let i = 1; i <= S.TOP; i++) s += '<span' + (i <= level ? ' class="on"' : '') + '></span>';
        return s + '</span>';
    }
    function buildShop() {
        const box = $('shop');
        box.textContent = '';
        for (const u of S.UPGRADES) {
            const lv = game.levels[u.key], cost = S.price(game, u.key);
            const row = document.createElement('div'); row.className = 'item';
            const ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = ICONS[u.key]; ico.setAttribute('aria-hidden', 'true');
            const txt = document.createElement('div');
            txt.innerHTML = '<b>' + u.name + pips(lv) + '</b><small>' + u.tiers[lv] + (lv < S.TOP ? ' → ' + u.tiers[lv + 1] : ' · maxed') + ' · ' + u.desc + '</small>';
            const b = document.createElement('button'); b.type = 'button'; b.dataset.buy = u.key;
            if (lv >= S.TOP) { b.textContent = 'maxed'; b.disabled = true; }
            else { b.textContent = 'buy $' + fmt(cost); b.disabled = game.money < cost; b.setAttribute('aria-label', 'buy ' + u.name + ' $' + cost); }
            b.addEventListener('click', () => purchase(u.key));
            row.append(ico, txt, b); box.appendChild(row);
        }
        const st = S.stats(game.levels);
        $('shop-note').textContent = 'day ' + (game.day + 1) + ' of ' + S.MAX_DAYS + ' · $' + fmt(game.money) + ' to spend · ramp ' + st.rampH + ' m high' +
            (st.fuel ? ' · ' + st.fuel + ' s of fuel' : '') + (st.payload > 1 ? ' · x' + st.payload + ' pay' : '');
        $('launch').innerHTML = '<b>launch day ' + (game.day + 1) + '!</b>';
    }
    function purchase(key) {
        if (phase !== 'hangar' || !S.buy(game, key)) return;
        const u = S.UPGRADES.find(x => x.key === key);
        beep(660, 0.08, 'square', 0.05, 990);
        say('bought: ' + u.tiers[game.levels[key]] + '. looking sharp.');
        save(); buildShop(); syncBar(); draw();
        const b = $('shop').querySelector('[data-buy="' + key + '"]');
        if (b && !b.disabled) b.focus({ preventScroll: true }); else $('launch').focus({ preventScroll: true });
    }

    function toHangar() {
        clearTimeout(endTimer); endTimer = 0;
        if (game.over) { toEnd(); return; }
        phase = 'hangar'; paused = false; run = null;
        updateCamera(0, true);
        buildShop(); syncBar(); showDialog(howtoOpen ? 'howto' : 'shop'); draw();
        say('the hangar. buy something, then launch. enter launches.');
        loop();
    }
    function launch() {
        if (phase !== 'hangar' || game.over) return;
        run = S.startRun(game);
        phase = 'run'; paused = false; acc = 0; last = 0;
        showDialog(null); syncBar();
        canvas.focus({ preventScroll: true });
        beep(220, 0.25, 'sawtooth', 0.04, 440);
        say('day ' + (game.day + 1) + ': wheee. ↑/↓ to tilt, space for rockets.');
        loop();
    }
    // achievements live on the desktop around this frame; alone, there are none
    function achieve(id) { try { const u = window.parent !== window && window.parent.unlockAchievement; if (typeof u === 'function') u(id); } catch (_) { /* no desktop */ } }
    function finish() {
        if (!run || !run.done || phase !== 'run') return;
        const rep = S.finishRun(game, run);
        if (!rep) return;
        lastReport = rep;
        records.bestDistance = Math.max(records.bestDistance, rep.distance);
        if (game.won) {
            achieve('learntoglide_win');
            records.wins++; records.seasons++;
            if (!records.bestDays || game.wonDay < records.bestDays) records.bestDays = game.wonDay;
        } else if (game.over) records.seasons++;
        store(REC_KEY, records); save();
        phase = 'report';
        const words = { stopped: 'slid to a stop', splat: 'belly-flopped hard', cliff: 'bonked the cliff', bonk: 'bonked off the ice wall', wall: 'SMASHED THROUGH THE ICE WALL', timeout: 'ran out of daylight' };
        $('report-line').textContent = 'day ' + rep.day + ': ' + words[rep.result] + (rep.result === 'bonk' ? ' at ' + (run.impact || 0).toFixed(1) + ' m/s (need ' + S.WALL_SPEED + ')' : '') + '. +$' + fmt(rep.earned);
        const f = $('report-facts'); f.textContent = '';
        const fact = (label, val, rec) => { const d = document.createElement('div'); d.innerHTML = label + '<br><b>' + val + '</b>' + (rec ? ' <span class="rec">record!</span>' : ''); f.appendChild(d); };
        fact('distance', fmt(rep.distance) + ' m', rep.records.distance);
        fact('max altitude', fmt(rep.altitude) + ' m', rep.records.altitude);
        fact('top speed', rep.speed.toFixed(1) + ' m/s', rep.records.speed);
        fact('balloons', String(rep.popped));
        fact('earned', '$' + fmt(rep.earned));
        $('to-shop').textContent = game.over ? 'see the season' : 'to the hangar';
        showDialog('report'); syncBar();
        say(rep.broke ? 'the wall is rubble. what a penguin.' : 'day ' + rep.day + ' done: ' + fmt(rep.distance) + ' m, +$' + fmt(rep.earned) + '.');
    }
    function toEnd() {
        phase = 'end'; paused = false;
        const won = game.won, medal = won ? S.rank(game.wonDay) : 'none';
        $('end-t').textContent = won ? 'you broke the wall!' : 'season over';
        $('end-line').textContent = won
            ? 'smashed through on day ' + game.wonDay + '. that is a ' + medal + ' medal' + (medal === 'gold' ? '. legendary penguin.' : '. fewer days next time for a better one.')
            : 'thirty days and the wall still stands. the penguin wants a rematch.';
        const f = $('end-facts'); f.textContent = '';
        const fact = (label, val) => { const d = document.createElement('div'); d.innerHTML = label + '<br><b>' + val + '</b>'; f.appendChild(d); };
        fact('days used', String(won ? game.wonDay : game.day));
        fact('best distance', fmt(game.best.distance) + ' m');
        fact('best speed', game.best.speed.toFixed(1) + ' m/s');
        fact('cash earned', '$' + fmt(game.earnedTotal));
        fact('record (days)', records.bestDays ? String(records.bestDays) : '-');
        showDialog('end'); syncBar(); draw();
        say(won ? 'season won in ' + game.wonDay + ' days. new season for a better medal.' : 'season lost. new season?');
    }
    function newSeason(seed) {
        clearTimeout(endTimer); endTimer = 0;
        game = S.newGame(Number.isInteger(seed) ? seed : newSeed());
        save(); run = null; lastReport = null;
        phase = 'end'; // let toHangar take over
        toHangar();
        say('new season. the wall is ' + S.WALL_X + ' m out. good luck.');
    }
    function setPause(on) {
        if (phase !== 'run' || paused === on || (on && run && run.done)) return;
        paused = on; last = 0;
        if (on) { held.up = held.down = held.boost = held.kUp = held.kDown = held.kBoost = false; showDialog('pause'); say('paused.'); }
        else { showDialog(null); canvas.focus({ preventScroll: true }); say('back in the air.'); }
        syncBar(); draw(); loop();
    }

    // ---------------------------------------------------------------- the loop
    function handleEvents() {
        const ev = run.events;
        for (let i = 0; i < ev.length; i++) {
            const e = ev[i];
            if (e.kind === 'launch') beep(520, 0.12, 'triangle', 0.05, 880);
            else if (e.kind === 'balloon') { beep(900, 0.07, 'square', 0.05, 300); burst(e.x, e.y, 10, BALLOON_COLORS[i % 5], 18); say('pop! balloon boost.'); }
            else if (e.kind === 'cloud') { beep(140, 0.15, 'sine', 0.05); say('soggy cloud. drag x3.'); }
            else if (e.kind === 'touchdown') { beep(110, 0.12, 'square', 0.05); shake = 6; burst(run.x, 0.5, 8, '#ffffff', 10); }
            else if (e.kind === 'end') {
                if (e.result === 'wall') { beep(300, 0.6, 'sawtooth', 0.07, 60); flash = 1; shake = 14; burst(run.x, run.y, 40, '#bfe6ff', 40); }
                else if (e.result === 'bonk' || e.result === 'splat' || e.result === 'cliff') { beep(90, 0.3, 'square', 0.06, 50); shake = 10; burst(run.x, run.y, 12, '#ffffff', 14); }
                else beep(330, 0.2, 'triangle', 0.04, 220);
            }
        }
        ev.length = 0;
    }
    function tick(dt) {
        input.pitch = (held.up || held.kUp ? 1 : 0) - (held.down || held.kDown ? 1 : 0);
        input.boost = held.boost || held.kBoost;
        acc += dt;
        while (acc >= S.DT && run && !run.done) {
            acc -= S.DT;
            if (autopilot) { const a = S.autopilot(run); input.pitch = a.pitch; input.boost = a.boost; }
            S.step(run, input);
            if (run.boosting && !reduced.matches && run.ticks % 2 === 0) {
                spark(run.x - Math.cos(run.pitch) * 2, run.y - Math.sin(run.pitch) * 2, -run.vx * 0.2 + (Math.random() - 0.5) * 6, -run.vy * 0.2 + (Math.random() - 0.5) * 6, 0.4, Math.random() < 0.5 ? '#ffb300' : '#ff5a1f', 3);
            } else if (run.phase === 'skid' && run.vx > 3 && run.ticks % 3 === 0) {
                spark(run.x, 0.3, -2 + Math.random() * 2, 2 + Math.random() * 3, 0.5, '#ffffff', 2);
            }
            handleEvents();
        }
        if (run && run.done && !endTimer) {
            acc = 0;
            endTimer = setTimeout(() => { endTimer = 0; finish(); }, run.broke ? 1400 : 900);
        }
    }
    function frame(now) {
        raf = 0;
        if (document.hidden) { last = 0; return; }
        const real = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;
        const dt = real * timeScale;
        if (phase === 'run' && !paused) tick(dt);
        if (!paused) {
            stepParts(real);
            updateCamera(real, false);
            shake = Math.max(0, shake - real * 30); flash = Math.max(0, flash - real * 1.5);
        }
        draw();
        if (!paused || phase !== 'run') loop();
    }
    function loop() { if (!raf && !document.hidden) { raf = requestAnimationFrame(frame); } }

    // ---------------------------------------------------------------- input
    const KEYS_UP = ['ArrowUp', 'w', 'W'], KEYS_DOWN = ['ArrowDown', 's', 'S'];
    window.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key, dlg = currentDialog();
        if (KEYS_UP.includes(k) && phase === 'run') { held.kUp = true; e.preventDefault(); return; }
        if (KEYS_DOWN.includes(k) && phase === 'run') { held.kDown = true; e.preventDefault(); return; }
        if ((k === ' ' || k === 'Shift') && phase === 'run' && !paused) { held.kBoost = true; e.preventDefault(); return; }
        if ((k === 'p' || k === 'P' || k === 'Escape') && phase === 'run') { setPause(!paused); e.preventDefault(); return; }
        if (k === 'Enter' && !e.repeat) {
            const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
            if (dlg === 'howto') { closeHowto(); e.preventDefault(); }
            else if (phase === 'hangar' && !onButton) { launch(); e.preventDefault(); }
            else if (phase === 'report' && !onButton) { toHangar(); e.preventDefault(); }
            else if (phase === 'end' && !onButton) { newSeason(); e.preventDefault(); }
        }
    });
    window.addEventListener('keyup', e => {
        if (KEYS_UP.includes(e.key)) held.kUp = false;
        if (KEYS_DOWN.includes(e.key)) held.kDown = false;
        if (e.key === ' ' || e.key === 'Shift') held.kBoost = false;
    });
    window.addEventListener('blur', () => { held.kUp = held.kDown = held.kBoost = false; });
    function holdButton(id, flag) {
        const b = $(id);
        const on = e => { e.preventDefault(); held[flag] = true; b.classList.add('held'); try { b.setPointerCapture(e.pointerId); } catch (_) { /* ok */ } };
        const off = () => { held[flag] = false; b.classList.remove('held'); };
        b.addEventListener('pointerdown', on);
        b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
        b.addEventListener('contextmenu', e => e.preventDefault());
        // keyboard users on the button itself
        b.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.repeat) { held[flag] = true; e.preventDefault(); e.stopPropagation(); } });
        b.addEventListener('keyup', e => { if (e.key === 'Enter') off(); });
    }
    holdButton('pad-up', 'up'); holdButton('pad-down', 'down'); holdButton('pad-boost', 'boost');
    // on the sky itself: hold the top half to nose up, the bottom half to nose down
    let skyPointer = null;
    canvas.addEventListener('pointerdown', e => {
        if (phase !== 'run' || paused) return;
        const box = canvas.getBoundingClientRect(), up = e.clientY - box.top < box.height / 2;
        skyPointer = e.pointerId; held.up = up; held.down = !up;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
        e.preventDefault();
    });
    const skyOff = e => { if (e.pointerId === skyPointer) { skyPointer = null; held.up = held.down = false; } };
    canvas.addEventListener('pointerup', skyOff); canvas.addEventListener('pointercancel', skyOff);

    function closeHowto() {
        howtoOpen = false; store(HOWTO_KEY, 1);
        if (phase === 'hangar') { showDialog('shop'); say('the hangar. buy something, then launch.'); }
        else if (phase === 'report') showDialog('report');
        else if (phase === 'end') showDialog('end');
        else if (phase === 'run') { if (paused) showDialog('pause'); else showDialog(null); }
    }
    $('howto-ok').addEventListener('click', closeHowto);
    $('help').addEventListener('click', () => { if (phase === 'run' && !paused) setPause(true); howtoOpen = true; showDialog('howto'); });
    $('launch').addEventListener('click', launch);
    $('to-shop').addEventListener('click', toHangar);
    $('again').addEventListener('click', () => newSeason());
    $('restart').addEventListener('click', () => {
        if (game.day > 0 && !game.over && !confirmRestart()) return;
        newSeason();
    });
    let restartArmed = 0;
    function confirmRestart() {
        // a second click within 3 seconds confirms; no blocking confirm() inside an iframe
        if (Date.now() - restartArmed < 3000) return true;
        restartArmed = Date.now(); say('click new season again to throw away this season.');
        return false;
    }
    $('pause').addEventListener('click', () => setPause(!paused));
    $('resume').addEventListener('click', () => setPause(false));

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { if (phase === 'run' && !paused) setPause(true); }
        else { last = 0; loop(); }
    });
    window.addEventListener('message', e => {
        if (e.origin !== location.origin || !e.data) return;
        if (e.data.type === 'game-pause' && phase === 'run' && !paused) setPause(true);
    });
    window.addEventListener('pagehide', () => { if (raf) cancelAnimationFrame(raf); raf = 0; });
    reduced.addEventListener('change', draw);

    // ---------------------------------------------------------------- test hook
    window.LTG_ENGINE = {
        sim: S,
        game: () => game,
        run: () => run,
        phase: () => phase,
        paused: () => paused,
        records: () => records,
        held: () => held,
        // where the penguin lands on the canvas, to keep the camera honest
        onScreen: () => (run ? { x: sx(run.x), y: sy(run.y), ppm: cam.ppm } : null),
        newSeason: seed => newSeason(seed),
        setMoney: n => { game.money = n; save(); if (phase === 'hangar') buildShop(); syncBar(); },
        setLevels: lv => { Object.assign(game.levels, lv); save(); if (phase === 'hangar') buildShop(); },
        setSpeed: k => { timeScale = Math.max(0.25, Math.min(16, +k || 1)); },
        autopilot: on => { autopilot = !!on; },
        // run the current flight forward synchronously (with the held keys, or the autopilot)
        fastForward: (seconds, pilot) => {
            if (phase !== 'run' || !run) return false;
            const n = Math.round(seconds * S.HZ);
            for (let i = 0; i < n && !run.done; i++) {
                if (pilot) { const a = S.autopilot(run); input.pitch = a.pitch; input.boost = a.boost; }
                S.step(run, input); handleEvents();
            }
            return run.done;
        }
    };

    // ---------------------------------------------------------------- boot
    howtoOpen = !load(HOWTO_KEY);
    if (game.over) { run = null; updateCamera(0, true); toEnd(); loop(); }
    else toHangar();
    if (howtoOpen) say('welcome, penguin. read the manual, then hit the hangar.');
})();
