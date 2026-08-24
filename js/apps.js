// ===================================================================
// mrhakan 98 — bonus applications
// every app here builds on createAppWindow() from index.js
// ===================================================================

// ---------- notepad.exe ----------
function openNotepad(initialText) {
    const { body } = createAppWindow('untitled - notepad', { icon: 'description', width: 360 });
    body.innerHTML = `
        <div class="np-menu">
            <span data-np="save">save</span><span data-np="clear">clear</span>
            <span data-np="wrap">wrap</span><span data-np="caps">AA</span>
        </div>
        <textarea id="np-text" class="np-text bevel-in" spellcheck="false"
            placeholder="type something bradar..."></textarea>
        <div class="np-status">
            <span id="np-count">0 chars &middot; 0 words</span>
            <span>ln 1, col 1</span>
        </div>`;
    const ta = body.querySelector('#np-text');
    const count = body.querySelector('#np-count');
    if (initialText) ta.value = initialText;
    const update = () => {
        const t = ta.value;
        const words = t.trim() ? t.trim().split(/\s+/).length : 0;
        count.textContent = `${t.length} chars \u00b7 ${words} words`;
    };
    ta.addEventListener('input', update);
    ta.addEventListener('keydown', e => e.stopPropagation());
    update();
    body.querySelectorAll('.np-menu span').forEach(btn => {
        btn.onclick = () => {
            const a = btn.dataset.np;
            if (a === 'save') {
                const blob = new Blob([ta.value], { type: 'text/plain' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = 'untitled.txt';
                link.click();
                URL.revokeObjectURL(link.href);
                showToast('notepad.exe', 'saved to your downloads bradar');
                unlockAchievement('writer');
            } else if (a === 'clear') { ta.value = ''; update(); }
            else if (a === 'wrap') { ta.style.whiteSpace = ta.style.whiteSpace === 'pre' ? 'pre-wrap' : 'pre'; }
            else if (a === 'caps') { ta.value = ta.value.toUpperCase(); update(); }
            playSound('click');
        };
    });
}

// ---------- calc.exe ----------
function openCalculator() {
    const { body } = createAppWindow('calculator', { icon: 'calculate', width: 240 });
    const keys = ['C', '±', '%', '/', '7', '8', '9', '*', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '='];
    body.innerHTML = `<div class="calc-display bevel-in" id="calc-display">0</div>
        <div class="calc-grid">${keys.map(k => {
        const cls = ['/', '*', '-', '+', '='].includes(k) ? 'calc-op' : (isNaN(k) && k !== '.' ? 'calc-fn' : '');
        const wide = k === '0' ? ' calc-wide' : '';
        return `<button class="bevel-out calc-key ${cls}${wide}" data-k="${k}">${k}</button>`;
    }).join('')}</div>`;
    const disp = body.querySelector('#calc-display');
    let cur = '0', prev = null, op = null, fresh = true;

    const show = v => { disp.textContent = String(v).slice(0, 14); };
    const compute = () => {
        if (op == null || prev == null) return parseFloat(cur);
        const a = parseFloat(prev), b = parseFloat(cur);
        let r = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : b === 0 ? 'ERR' : a / b;
        if (r === 'ERR') { playSound('error'); return 'ERR'; }
        return Math.round(r * 1e10) / 1e10;
    };
    const press = (k) => {
        playSound('click');
        if (k === 'C') { cur = '0'; prev = null; op = null; fresh = true; }
        else if (k === '±') { cur = String(parseFloat(cur) * -1); }
        else if (k === '%') { cur = String(parseFloat(cur) / 100); }
        else if (['+', '-', '*', '/'].includes(k)) {
            if (op && !fresh) { const r = compute(); cur = String(r); }
            prev = cur; op = k; fresh = true;
        } else if (k === '=') {
            const r = compute();
            cur = String(r); prev = null; op = null; fresh = true;
            if (cur === '1337' || cur === '69' || cur === '420') { showToast('calc.exe', 'nice.'); unlockAchievement('nice'); }
        } else if (k === '.') {
            if (fresh) { cur = '0.'; fresh = false; } else if (!cur.includes('.')) cur += '.';
        } else {
            cur = fresh ? k : (cur === '0' ? k : cur + k);
            fresh = false;
        }
        show(cur);
    };
    body.querySelectorAll('.calc-key').forEach(b => b.onclick = () => press(b.dataset.k));
    // keyboard support while the window is focused
    body.tabIndex = 0;
    body.addEventListener('keydown', (e) => {
        e.stopPropagation();
        const map = { Enter: '=', Escape: 'C', Backspace: 'C' };
        const k = map[e.key] || e.key;
        if ('0123456789.+-*/=C%'.includes(k) && k.length === 1) { press(k); e.preventDefault(); }
    });
}

// ---------- snake.exe ----------
function openSnake() {
    const { body, win } = createAppWindow('snake', { icon: 'sports_esports', width: 290 });
    body.innerHTML = `
        <div class="game-hud"><span>score: <b id="snake-score">0</b></span>
        <span>best: <b id="snake-best">0</b></span></div>
        <canvas id="snake-canvas" class="bevel-in game-canvas" width="260" height="260"></canvas>
        <div class="snake-padhost"></div>
        <p class="game-hint">${window.TOUCH && TOUCH.coarse()
            ? 'the pad steers &middot; or swipe the board'
            : 'arrows / wasd to move &middot; click canvas first'}</p>`;
    const cv = body.querySelector('#snake-canvas'), ctx = cv.getContext('2d');
    const scoreEl = body.querySelector('#snake-score'), bestEl = body.querySelector('#snake-best');
    const CELL = 13, W = 20, H = 20;
    let snake, dir, nextDir, food, score, dead, loop;
    let best = +(localStorage.getItem('snake-best') || 0);
    bestEl.textContent = best;

    function reset() {
        snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
        dir = { x: 1, y: 0 }; nextDir = dir; score = 0; dead = false;
        placeFood(); scoreEl.textContent = 0;
    }
    function placeFood() {
        do { food = { x: (Math.random() * W) | 0, y: (Math.random() * H) | 0 }; }
        while (snake.some(s => s.x === food.x && s.y === food.y));
    }
    function step() {
        if (dead) return;
        dir = nextDir;
        const head = { x: (snake[0].x + dir.x + W) % W, y: (snake[0].y + dir.y + H) % H };
        if (snake.some(s => s.x === head.x && s.y === head.y)) {
            dead = true; playSound('error');
            if (score > best) { best = score; localStorage.setItem('snake-best', best); bestEl.textContent = best; }
            draw(); return;
        }
        snake.unshift(head);
        if (head.x === food.x && head.y === food.y) {
            score++; scoreEl.textContent = score; placeFood(); playSound('ding');
            if (score >= 10) unlockAchievement('snake10');
        } else snake.pop();
        draw();
    }
    function draw() {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#f00';
        ctx.fillRect(food.x * CELL + 1, food.y * CELL + 1, CELL - 2, CELL - 2);
        snake.forEach((s, i) => {
            ctx.fillStyle = i === 0 ? '#0df259' : '#088c34';
            ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
        });
        if (dead) {
            ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 20px "Courier New"'; ctx.textAlign = 'center';
            ctx.fillText('GAME OVER', cv.width / 2, cv.height / 2 - 6);
            ctx.font = '12px "Courier New"';
            ctx.fillText('click to restart', cv.width / 2, cv.height / 2 + 16);
        }
    }
    const keyHandler = (e) => {
        const k = e.key.toLowerCase();
        const dirs = { arrowup: { x: 0, y: -1 }, w: { x: 0, y: -1 }, arrowdown: { x: 0, y: 1 }, s: { x: 0, y: 1 }, arrowleft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, arrowright: { x: 1, y: 0 }, d: { x: 1, y: 0 } };
        if (!dirs[k] || !win.isConnected || win.style.display === 'none') return;
        const nd = dirs[k];
        if (nd.x === -dir.x && nd.y === -dir.y) return;
        nextDir = nd; e.preventDefault();
    };
    document.addEventListener('keydown', keyHandler);
    cv.addEventListener('click', () => { if (dead) { reset(); draw(); } });

    // a phone has no arrow keys. the pad turns the snake, and so does a
    // swipe across the board, which is what a thumb reaches for first
    const turn = (x, y) => {
        if (x === -dir.x && y === -dir.y) return;   // no turning back on itself
        nextDir = { x: x, y: y };
    };
    const VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const pad = window.TOUCH && TOUCH.pad(body.querySelector('.snake-padhost'), {
        onDir: (d, down) => { if (down) turn(VEC[d][0], VEC[d][1]); }
    });
    let swipeX = 0, swipeY = 0;
    cv.addEventListener('pointerdown', e => { swipeX = e.clientX; swipeY = e.clientY; });
    cv.addEventListener('pointerup', e => {
        const dx = e.clientX - swipeX, dy = e.clientY - swipeY;
        if (Math.abs(dx) < 22 && Math.abs(dy) < 22) return;      // a tap, not a swipe
        if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 1 : -1, 0);
        else turn(0, dy > 0 ? 1 : -1);
    });

    reset(); draw();
    loop = setInterval(step, 130);
    const orig = win._cleanup;
    win._cleanup = () => {
        clearInterval(loop);
        document.removeEventListener('keydown', keyHandler);
        if (pad) pad.destroy();
        orig && orig();
    };
}

// ---------- pong.exe ----------
function openPong() {
    const { body, win } = createAppWindow('pong', { icon: 'sports_esports', width: 320 });
    body.innerHTML = `
        <div class="game-hud"><span>you: <b id="pong-p">0</b></span><span>cpu: <b id="pong-c">0</b></span></div>
        <canvas id="pong-canvas" class="bevel-in game-canvas" width="300" height="200"></canvas>
        <p class="game-hint">${window.TOUCH && TOUCH.coarse()
            ? 'drag your finger up and down the court'
            : 'move your mouse over the court'}</p>`;
    const cv = body.querySelector('#pong-canvas'), ctx = cv.getContext('2d');
    const pEl = body.querySelector('#pong-p'), cEl = body.querySelector('#pong-c');
    const PH = 46, PW = 6;
    let py = 77, cy = 77, bx = 150, by = 100, bvx = 2.6, bvy = 1.8, ps = 0, cs = 0, raf;

    // pointer rather than mouse, so a dragged finger moves the paddle too.
    // touch-action on the canvas stops the drag scrolling the page instead.
    cv.style.touchAction = 'none';
    const aim = (e) => {
        const r = cv.getBoundingClientRect();
        py = Math.max(0, Math.min(cv.height - PH, (e.clientY - r.top) * (cv.height / r.height) - PH / 2));
    };
    cv.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons || e.pressure) aim(e); });
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture && cv.setPointerCapture(e.pointerId); aim(e); });
    function serve(dir) { bx = 150; by = 100; bvx = 2.6 * dir; bvy = (Math.random() * 3 - 1.5); }
    function frame() {
        raf = requestAnimationFrame(frame);
        bx += bvx; by += bvy;
        if (by < 4 || by > cv.height - 4) bvy *= -1;
        // cpu paddle tracks the ball with a bit of lag so it's beatable
        cy += Math.max(-2.9, Math.min(2.9, (by - (cy + PH / 2)) * 0.09));
        cy = Math.max(0, Math.min(cv.height - PH, cy));
        if (bx - 4 < PW + 4 && by > py && by < py + PH && bvx < 0) { bvx = Math.abs(bvx) * 1.03; bvy += (by - (py + PH / 2)) * 0.05; playSound('click'); }
        if (bx + 4 > cv.width - PW - 4 && by > cy && by < cy + PH && bvx > 0) { bvx = -Math.abs(bvx) * 1.03; playSound('click'); }
        if (bx < 0) { cs++; cEl.textContent = cs; playSound('error'); serve(1); }
        if (bx > cv.width) {
            ps++; pEl.textContent = ps; playSound('ding'); serve(-1);
            if (ps >= 5) unlockAchievement('pong');
        }
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.strokeStyle = '#333'; ctx.setLineDash([6, 6]); ctx.beginPath();
        ctx.moveTo(cv.width / 2, 0); ctx.lineTo(cv.width / 2, cv.height); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#0df259'; ctx.fillRect(4, py, PW, PH);
        ctx.fillStyle = '#ff00ff'; ctx.fillRect(cv.width - PW - 4, cy, PW, PH);
        ctx.fillStyle = '#fff'; ctx.fillRect(bx - 4, by - 4, 8, 8);
    }
    frame();
    const orig = win._cleanup;
    win._cleanup = () => { cancelAnimationFrame(raf); orig && orig(); };
}

// ---------- cmd.exe (a real little shell) ----------
function openTerminal() {
    const { body } = createAppWindow('C:\\ command prompt', { icon: 'terminal', width: 420 });
    body.classList.add('term-body');
    body.innerHTML = `<div id="term-out" class="term-out"></div>
        <div class="term-line"><span class="term-prompt">C:\\&gt;</span><input id="term-in" class="term-in" spellcheck="false" autocomplete="off"></div>`;
    const out = body.querySelector('#term-out'), input = body.querySelector('#term-in');
    const history = []; let hIdx = 0;
    const print = (text, cls) => {
        const d = document.createElement('div');
        if (cls) d.className = cls;
        d.textContent = text;
        out.appendChild(d);
        out.scrollTop = out.scrollHeight;
    };
    print('mrhakan 98 [Version 4.20.1998]');
    print('(c) shithole industries. all rights reserved.');
    print('type "help" for a list of commands.');
    print('');

    const fakeFiles = ['about_me.html', 'guestbook.dat', 'winamp.exe', 'trolls.dll', 'vibes.sys', 'passwords.txt', 'secret_plans.doc'];
    const commands = {
        help: () => print('commands: help, dir, cd, cat, echo, ver, date, whoami, color, cls, tree, matrix, sudo, snake, paint, calc, notepad, party, exit'),
        dir: () => {
            print(' Volume in drive C is SHITHOLE');
            print('');
            fakeFiles.forEach(f => print(`  ${new Date().toLocaleDateString()}   ${String((Math.random() * 9000 | 0) + 100).padStart(6)}  ${f}`));
            print(`               ${fakeFiles.length} File(s)`);
        },
        cd: (a) => print(a ? `The system cannot find the path specified: ${a}` : 'C:\\'),
        cat: (a) => {
            if (!a) return print('usage: cat <file>');
            if (a === 'passwords.txt') { print('hunter2'); unlockAchievement('hacker'); }
            else if (a === 'vibes.sys') print('[BINARY DATA — 100% PURE VIBES]');
            else if (a === 'secret_plans.doc') print('step 1: build website. step 2: ??? step 3: profit');
            else print(`cannot access '${a}': No such file or vibe`);
        },
        echo: (a) => print(a || ''),
        ver: () => print('mrhakan 98 SE [Version 4.20.1998] — built with notepad'),
        date: () => print(new Date().toString()),
        whoami: () => print('SHITHOLE\\bradar'),
        color: () => { out.classList.toggle('term-amber'); print('color scheme toggled'); },
        cls: () => { out.innerHTML = ''; },
        tree: () => { print('C:.'); print('├── src'); print('│   ├── music'); print('│   └── emoj'); print('├── data'); print('│   ├── guestbook'); print('│   └── shouts'); print('└── vibes.sys'); },
        matrix: () => { print('wake up, neo...'); window.hax && window.hax(); },
        sudo: () => { print('bradar is not in the sudoers file. this incident will be reported.'); playSound('error'); },
        snake: () => { openSnake(); print('launching snake.exe...'); },
        pong: () => { openPong(); print('launching pong.exe...'); },
        paint: () => { openPaint(); print('launching paint.exe...'); },
        calc: () => { openCalculator(); print('launching calc.exe...'); },
        notepad: () => { openNotepad(); print('launching notepad.exe...'); },
        party: () => { togglePartyMode(); print('party protocol engaged'); },
        exit: () => print('you cannot escape the shithole.')
    };

    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'ArrowUp') { if (hIdx > 0) input.value = history[--hIdx] || ''; e.preventDefault(); return; }
        if (e.key === 'ArrowDown') { if (hIdx < history.length) input.value = history[++hIdx] || ''; e.preventDefault(); return; }
        if (e.key !== 'Enter') return;
        const raw = input.value.trim();
        input.value = '';
        print(`C:\\>${raw}`, 'term-echo');
        if (!raw) return;
        history.push(raw); hIdx = history.length;
        const [cmd, ...rest] = raw.split(/\s+/);
        const fn = commands[cmd.toLowerCase()];
        if (fn) fn(rest.join(' '));
        else print(`'${cmd}' is not recognized as an internal or external command, operable program or vibe.`);
        unlockAchievement('terminal');
        out.scrollTop = out.scrollHeight;
    });
    body.addEventListener('click', () => input.focus());
    setTimeout(() => input.focus(), 50);
}

// ---------- clock.exe (analog) ----------
function openClock() {
    const { body, win } = createAppWindow('clock', { icon: 'schedule', width: 180 });
    body.innerHTML = `<canvas id="clock-canvas" width="150" height="150" class="clock-canvas"></canvas>
        <div id="clock-digital" class="clock-digital bevel-in"></div>`;
    const cv = body.querySelector('#clock-canvas'), ctx = cv.getContext('2d');
    const dig = body.querySelector('#clock-digital');
    const R = 70, cx = 75, cy = 75;
    function draw() {
        const now = new Date();
        ctx.clearRect(0, 0, 150, 150);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8));
            ctx.lineTo(cx + Math.cos(a) * (R - 2), cy + Math.sin(a) * (R - 2));
            ctx.lineWidth = i % 3 === 0 ? 3 : 1; ctx.stroke();
        }
        const h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds();
        const hand = (angle, len, w, color) => {
            ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(angle - Math.PI / 2) * len, cy + Math.sin(angle - Math.PI / 2) * len);
            ctx.stroke();
        };
        hand(((h + m / 60) / 12) * Math.PI * 2, 34, 4, '#000');
        hand((m / 60) * Math.PI * 2, 50, 3, '#000');
        hand((s / 60) * Math.PI * 2, 56, 1, '#f00');
        ctx.beginPath(); ctx.fillStyle = '#000'; ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
        dig.textContent = now.toLocaleTimeString();
    }
    draw();
    const t = setInterval(draw, 1000);
    const orig = win._cleanup;
    win._cleanup = () => { clearInterval(t); orig && orig(); };
}

// ---------- character map ----------
function openCharMap() {
    const { body } = createAppWindow('character map', { icon: 'language', width: 320 });
    const chars = ('☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼░▒▓│┤╡╢╖╕╣║╗╝┐└┴┬├─┼╞╟╚╔╩╦╠═╬┘┌█▄▌▐▀' +
        'αβγδεπστφθΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■¤©®™♀♂☠☢☣⚡★☆✦✧✿❀❁✝✚✰⁂⁑').split('');
    body.innerHTML = `<div class="charmap-grid" id="charmap-grid"></div>
        <input id="charmap-buf" class="bevel-in charmap-buf" readonly placeholder="click chars to build a string">
        <button class="bevel-out charmap-copy" id="charmap-copy">copy</button>`;
    const grid = body.querySelector('#charmap-grid'), buf = body.querySelector('#charmap-buf');
    chars.forEach(c => {
        const b = document.createElement('button');
        b.className = 'charmap-cell'; b.textContent = c;
        b.onclick = () => { buf.value += c; playSound('click'); };
        grid.appendChild(b);
    });
    body.querySelector('#charmap-copy').onclick = () => {
        if (!buf.value) return;
        if (navigator.clipboard) navigator.clipboard.writeText(buf.value).catch(() => { });
        showToast('character map', 'copied! paste it in the guestbook');
        unlockAchievement('charmap');
    };
}

// ---------- my computer ----------
function openMyComputer() {
    const { body } = createAppWindow('my computer', { icon: 'computer', width: 380 });
    const drives = [
        { icon: 'folder', name: 'C:\\ shithole (local disk)', info: '640K free of 20MB', act: () => openTerminal() },
        { icon: 'folder_open', name: 'D:\\ my_projects', info: 'github repos', act: () => showSection('github') },
        { icon: 'edit_note', name: 'E:\\ guestbook', info: 'signed by legends', act: () => showSection('guestbook') },
        { icon: 'graphic_eq', name: 'F:\\ music (audio cd)', info: 'absolute bangers', act: () => playTrack() },
        { icon: 'delete', name: 'recycle bin', info: 'do not open', act: () => openRecycleBin() },
        { icon: 'settings', name: 'control panel', info: 'change your vibes', act: () => openControlPanel() },
        { icon: 'monitoring', name: 'system properties', info: 'about this pc', act: () => openSystemProperties() }
    ];
    body.innerHTML = `<div class="mc-list">${drives.map((d, i) => `
        <button class="mc-item" data-i="${i}">
            <span class="material-symbols-outlined mc-icon">${d.icon}</span>
            <span class="mc-name">${escapeHtml(d.name)}</span>
            <span class="mc-info">${escapeHtml(d.info)}</span>
        </button>`).join('')}</div>
        <div class="mc-status bevel-in">${drives.length} object(s)</div>`;
    body.querySelectorAll('.mc-item').forEach(el => {
        el.ondblclick = () => drives[+el.dataset.i].act();
        el.onclick = () => {
            body.querySelectorAll('.mc-item').forEach(x => x.classList.remove('sel'));
            el.classList.add('sel');
        };
    });
    unlockAchievement('explorer');
}

// ---------- recycle bin ----------
const recycleItems = [
    { icon: 'description', name: 'old_website_v1.html', note: 'it was worse, trust me' },
    { icon: 'description', name: 'homework.doc', note: 'the dog ate it' },
    { icon: 'photo_camera', name: 'embarrassing_photo.jpg', note: 'NEVER' },
    { icon: 'description', name: 'new_years_resolutions.txt', note: 'empty file' },
    { icon: 'bug_report', name: 'bugs.log', note: '9,999,999 entries' },
    { icon: 'description', name: 'my_dignity.zip', note: 'corrupted' }
];
function openRecycleBin() {
    const { body } = createAppWindow('recycle bin', { icon: 'delete', width: 340 });
    let items = [...recycleItems];
    body.innerHTML = `<div class="mc-list" id="rb-list"></div>
        <div class="rb-actions">
            <button class="bevel-out rb-btn" id="rb-restore">restore</button>
            <button class="bevel-out rb-btn" id="rb-empty">empty bin</button>
        </div>`;
    const list = body.querySelector('#rb-list');
    let sel = null;
    const render = () => {
        list.innerHTML = items.length ? items.map((it, i) => `
            <button class="mc-item${sel === i ? ' sel' : ''}" data-i="${i}">
                <span class="material-symbols-outlined mc-icon">${it.icon}</span>
                <span class="mc-name">${escapeHtml(it.name)}</span>
                <span class="mc-info">${escapeHtml(it.note)}</span>
            </button>`).join('')
            : '<div class="rb-empty-msg">the bin is empty. your past is gone bradar.</div>';
        list.querySelectorAll('.mc-item').forEach(el => el.onclick = () => { sel = +el.dataset.i; render(); });
    };
    body.querySelector('#rb-restore').onclick = () => {
        if (sel == null || !items[sel]) return showToast('recycle bin', 'select something first');
        const it = items[sel];
        showToast('recycle bin', `restored ${it.name}... just kidding`);
        playSound('error');
    };
    body.querySelector('#rb-empty').onclick = () => {
        if (!items.length) return;
        showRetroDialog({
            title: 'confirm delete', lines: ['permanently delete these items?', 'this cannot be undone (it can).'],
            okLabel: 'yes', cancelLabel: 'no',
            onOk: () => { items = []; sel = null; render(); playSound('ding'); unlockAchievement('cleaner'); showToast('recycle bin', 'emptied. feels good right?'); }
        });
    };
    render();
}

// ---------- system properties ----------
function openSystemProperties() {
    const { body } = createAppWindow('system properties', { icon: 'monitoring', width: 320 });
    const ua = navigator.userAgent;
    const browser = /Firefox/.test(ua) ? 'Firefox' : /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Internet Explorer 4';
    body.innerHTML = `
        <div class="sysprop">
            <img src="src/emoj/Cursed Pack 1-emojigg-pack/7161-joe-cool.png" class="sysprop-logo" alt="">
            <div class="sysprop-info">
                <b>mrhakan 98</b>
                <div>Second Edition</div>
                <div>4.20.1998</div>
                <br>
                <b>Registered to:</b>
                <div>a certified bradar</div>
                <div>shithole industries</div>
            </div>
        </div>
        <div class="sysprop-specs bevel-in">
            <div>CPU: Intel Pentium II 400MHz</div>
            <div>RAM: 64MB (${(navigator.deviceMemory || 64)}GB detected, lying)</div>
            <div>Cores: ${navigator.hardwareConcurrency || 1}</div>
            <div>Screen: ${screen.width}x${screen.height}</div>
            <div>Browser: ${escapeHtml(browser)}</div>
            <div>Language: ${escapeHtml(navigator.language || 'en')}</div>
            <div>Vibes: MAXIMUM</div>
        </div>`;
}

// ---------- control panel / display properties ----------
const wallpapers = [
    { id: 'space', name: 'space (default)' },
    { id: 'bliss', name: 'bliss' },
    { id: 'maze', name: '3d maze' },
    { id: 'clouds', name: 'clouds' },
    { id: 'teal', name: 'win95 teal' },
    { id: 'vapor', name: 'vaporwave' },
    { id: 'matrix', name: 'matrix' }
];
function applyWallpaper(id) {
    document.body.classList.remove(...wallpapers.map(w => `wp-${w.id}`));
    if (id && id !== 'space') document.body.classList.add(`wp-${id}`);
    localStorage.setItem('wallpaper', id || 'space');
}
function openControlPanel() {
    const { body } = createAppWindow('display properties', { icon: 'wallpaper', width: 330 });
    const cur = localStorage.getItem('wallpaper') || 'space';
    body.innerHTML = `
        <p class="cp-label">wallpaper:</p>
        <div class="cp-grid">${wallpapers.map(w => `
            <button class="cp-wp${w.id === cur ? ' sel' : ''}" data-wp="${w.id}">
                <span class="cp-swatch wp-swatch-${w.id}"></span>
                <span>${escapeHtml(w.name)}</span>
            </button>`).join('')}</div>
        <p class="cp-label">screen saver:</p>
        <div class="cp-saver-row">
            <select class="bevel-in cp-select" id="cp-saver"></select>
            <button class="bevel-out cp-preview" id="cp-saver-preview">preview</button>
        </div>
        <p class="cp-hint">kicks in after 90 seconds of you doing nothing.</p>
        <p class="cp-label">effects:</p>
        <div class="cp-toggles">
            <label><input type="checkbox" id="cp-crt"> CRT scanlines</label>
            <label><input type="checkbox" id="cp-sparkle"> cursor sparkles</label>
            <label><input type="checkbox" id="cp-stars"> starfield</label>
            <label><input type="checkbox" id="cp-snow"> let it snow</label>
            <label><input type="checkbox" id="cp-motion"> window animations</label>
        </div>`;

    // the savers themselves live in extras.js
    const saverSel = body.querySelector('#cp-saver');
    if (typeof SCREENSAVERS !== 'undefined') {
        const curSaver = getScreensaverId();
        saverSel.innerHTML = Object.entries(SCREENSAVERS)
            .map(([id, s]) => `<option value="${id}"${id === curSaver ? ' selected' : ''}>${escapeHtml(s.name)}</option>`)
            .join('');
        saverSel.onchange = () => {
            localStorage.setItem('screensaver', saverSel.value);
            playSound('click');
            unlockAchievement('decorator');
        };
        body.querySelector('#cp-saver-preview').onclick = () => {
            if (saverSel.value === 'none') { playSound('error'); return; }
            startScreensaver(saverSel.value);
        };
    }
    body.querySelectorAll('.cp-wp').forEach(b => b.onclick = () => {
        body.querySelectorAll('.cp-wp').forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
        applyWallpaper(b.dataset.wp);
        playSound('click');
        unlockAchievement('decorator');
    });
    const crt = body.querySelector('#cp-crt'), sp = body.querySelector('#cp-sparkle'),
        st = body.querySelector('#cp-stars'), sn = body.querySelector('#cp-snow'),
        mo = body.querySelector('#cp-motion');
    crt.checked = localStorage.getItem('crt-off') !== '1';
    sp.checked = localStorage.getItem('sparkles-off') !== '1';
    st.checked = localStorage.getItem('stars-off') !== '1';
    sn.checked = !!document.getElementById('snow-canvas');
    mo.checked = FX.enabled();
    // if the machine itself asked for less motion, say so rather than
    // showing a tickbox that looks like it is on and does nothing
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
        mo.disabled = true;
        mo.checked = false;
        mo.parentElement.append(' (your system asked for less motion)');
    }
    mo.onchange = () => { FX.setEnabled(mo.checked); playSound('click'); };
    crt.onchange = () => { localStorage.setItem('crt-off', crt.checked ? '0' : '1'); applyDisplayPrefs(); };
    sp.onchange = () => { localStorage.setItem('sparkles-off', sp.checked ? '0' : '1'); applyDisplayPrefs(); };
    st.onchange = () => { localStorage.setItem('stars-off', st.checked ? '0' : '1'); applyDisplayPrefs(); };
    sn.onchange = () => sn.checked ? startSnow() : stopSnow();
}
function applyDisplayPrefs() {
    const crtEl = document.querySelector('.crt-overlay');
    if (crtEl) crtEl.style.display = localStorage.getItem('crt-off') === '1' ? 'none' : '';
    const starEl = document.querySelector('.star-overlay');
    if (starEl) starEl.style.display = localStorage.getItem('stars-off') === '1' ? 'none' : '';
    applyWallpaper(localStorage.getItem('wallpaper') || 'space');
}

// ---------- dial-up connection simulator ----------
function openDialUp() {
    const { body, close } = createAppWindow('connect to the internet', { icon: 'public', width: 300 });
    body.innerHTML = `
        <div class="dialup">
            <img src="src/emoj/Cursed Pack 1-emojigg-pack/7161-joe-cool.png" class="dialup-icon" alt="">
            <div class="dialup-status" id="du-status">Dialing 555-VIBE...</div>
            <div class="dialup-bar bevel-in"><div class="dialup-fill" id="du-fill"></div></div>
            <div class="dialup-log" id="du-log"></div>
        </div>`;
    const status = body.querySelector('#du-status'), fill = body.querySelector('#du-fill'), log = body.querySelector('#du-log');
    const steps = [
        'Dialing 555-VIBE...', 'Handshaking... skreeee', 'Verifying username and password...',
        'BEEP BOOP KSSSHHH', 'Negotiating 56k...', 'Connected at 28.8 kbps (sorry)'
    ];
    let i = 0;
    const t = setInterval(() => {
        if (i >= steps.length) {
            clearInterval(t);
            status.textContent = 'Connected!';
            log.textContent = 'you may now browse the world wide web. do not pick up the phone.';
            playSound('ding');
            unlockAchievement('dialup');
            setTimeout(close, 2600);
            return;
        }
        status.textContent = steps[i];
        fill.style.width = `${((i + 1) / steps.length) * 100}%`;
        playSound(i % 2 ? 'click' : 'navigate');
        i++;
    }, 900);
}
