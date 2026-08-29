// ===================================================================
// arcade.js — the games that came on the disk
//
// Eight of them, in the shape a 1998 shareware compilation had them:
// one window each, no menus, and the whole thing playable in under a
// minute. They keep their own best scores in localStorage next to the
// ones snake and minesweeper already keep.
//
// The two with an opponent do not cheat and do not roll over. Tic-tac-
// toe plays minimax, so it is genuinely unbeatable and the honest
// result is a draw. Rock paper scissors reads your last two throws and
// plays the counter to what you usually do next, which is how every
// human loses at it — people are terrible random number generators.
// ===================================================================

// small shared helpers ------------------------------------------------
function arcBest(key, value) {
    const k = 'arcade-' + key;
    const had = +(localStorage.getItem(k) || 0);
    if (value === undefined) return had;
    if (value > had) { try { localStorage.setItem(k, String(value)); } catch (e) { } return value; }
    return had;
}
function arcHint(text) {
    return `<p class="game-hint">${text}</p>`;
}

// ===================================================================
// tic tac toe — minimax, so it cannot be beaten
// ===================================================================
function openTicTacToe() {
    const { body } = createAppWindow('tic tac toe', { icon: 'casino', width: 260 });
    body.classList.add('arc-body');
    body.innerHTML = `
        <div class="game-hud"><span>you: <b data-w>0</b></span><span>draws: <b data-d>0</b></span>
            <span>me: <b data-l>0</b></span></div>
        <div class="ttt-grid" data-grid></div>
        <div class="arc-msg" data-msg>you are X. you go first.</div>
        <button class="bevel-out arc-btn" data-new>new game</button>
        ${arcHint('it plays perfectly. a draw is a win.')}`;

    const grid = body.querySelector('[data-grid]');
    const msg = body.querySelector('[data-msg]');
    let board, over;
    const score = { w: 0, d: 0, l: 0 };

    const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    const winner = (b) => {
        for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
        return b.every(Boolean) ? 'draw' : null;
    };

    // minimax with the depth in the score, so it takes the fastest win
    // and the slowest loss — which is what makes it feel like it is
    // actually trying rather than just not losing
    function best(b, me) {
        const w = winner(b);
        if (w === 'O') return { s: 10 };
        if (w === 'X') return { s: -10 };
        if (w === 'draw') return { s: 0 };
        let pick = null;
        for (let i = 0; i < 9; i++) {
            if (b[i]) continue;
            b[i] = me ? 'O' : 'X';
            const s = best(b, !me).s + (me ? -1 : 1);
            b[i] = '';
            if (!pick || (me ? s > pick.s : s < pick.s)) pick = { s, i };
        }
        return pick;
    }

    function draw() {
        grid.innerHTML = board.map((c, i) =>
            `<button class="ttt-cell bevel-out${c ? ' filled' : ''}" data-i="${i}"${c || over ? ' disabled' : ''}>${c}</button>`
        ).join('');
        grid.querySelectorAll('[data-i]').forEach(b => b.onclick = () => play(+b.dataset.i));
    }

    function finish(w) {
        over = true;
        if (w === 'X') { score.w++; msg.textContent = 'you won. that should not have happened.'; }
        else if (w === 'O') { score.l++; msg.textContent = 'i won. as expected.'; }
        else { score.d++; msg.textContent = 'a draw. that is the best there is.'; unlockAchievement('ttt'); }
        body.querySelector('[data-w]').textContent = score.w;
        body.querySelector('[data-d]').textContent = score.d;
        body.querySelector('[data-l]').textContent = score.l;
        draw();
    }

    function play(i) {
        if (over || board[i]) return;
        board[i] = 'X';
        playSound('click');
        let w = winner(board);
        if (w) { finish(w); return; }
        const move = best(board.slice(), true);
        board[move.i] = 'O';
        w = winner(board);
        draw();
        if (w) finish(w);
    }

    function reset() {
        board = Array(9).fill('');
        over = false;
        msg.textContent = 'you are X. you go first.';
        draw();
    }
    body.querySelector('[data-new]').onclick = () => { playSound('click'); reset(); };
    reset();
}

// ===================================================================
// rock paper scissors — it reads you
// ===================================================================
function openRPS() {
    const { body } = createAppWindow('rock paper scissors', { icon: 'casino', width: 280 });
    body.classList.add('arc-body');
    const NAMES = { r: 'rock', p: 'paper', s: 'scissors' };
    const ICON = { r: '✊', p: '✋', s: '✌️' };
    const BEATS = { r: 's', p: 'r', s: 'p' };      // key beats value
    const COUNTER = { r: 'p', p: 's', s: 'r' };    // what beats key

    body.innerHTML = `
        <div class="game-hud"><span>you: <b data-w>0</b></span><span>draws: <b data-d>0</b></span>
            <span>me: <b data-l>0</b></span></div>
        <div class="rps-throws"><div class="rps-face" data-you>?</div><span class="rps-v">vs</span>
            <div class="rps-face" data-me>?</div></div>
        <div class="arc-msg" data-msg>throw something.</div>
        <div class="rps-buttons">
            ${['r', 'p', 's'].map(k => `<button class="bevel-out rps-btn" data-t="${k}">${ICON[k]}<span>${NAMES[k]}</span></button>`).join('')}
        </div>
        ${arcHint('it remembers your last two throws. good luck being random.')}`;

    const score = { w: 0, d: 0, l: 0 };
    const seen = {};              // "rp" -> {r:0,p:0,s:0}
    let history = '';

    function guess() {
        // what usually follows the two throws you just made
        const key = history.slice(-2);
        const table = seen[key];
        if (!table) return ['r', 'p', 's'][(Math.random() * 3) | 0];
        let top = null;
        for (const k in table) if (!top || table[k] > table[top]) top = k;
        // it is only worth trusting once it has actually seen the pattern
        if (!top || table[top] < 2) return ['r', 'p', 's'][(Math.random() * 3) | 0];
        return COUNTER[top];
    }

    function throwIt(you) {
        const me = guess();
        body.querySelector('[data-you]').textContent = ICON[you];
        body.querySelector('[data-me]').textContent = ICON[me];
        const msg = body.querySelector('[data-msg]');
        if (you === me) { score.d++; msg.textContent = 'a draw.'; }
        else if (BEATS[you] === me) {
            score.w++; msg.textContent = NAMES[you] + ' beats ' + NAMES[me] + '. fine.';
            playSound('ding');
            if (score.w >= 5) unlockAchievement('rps');
        } else { score.l++; msg.textContent = NAMES[me] + ' beats ' + NAMES[you] + '. told you.'; }

        // learn: what followed the two before this one
        const key = history.slice(-2);
        if (key.length === 2) {
            seen[key] = seen[key] || { r: 0, p: 0, s: 0 };
            seen[key][you]++;
        }
        history += you;
        body.querySelector('[data-w]').textContent = score.w;
        body.querySelector('[data-d]').textContent = score.d;
        body.querySelector('[data-l]').textContent = score.l;
    }
    body.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { playSound('click'); throwIt(b.dataset.t); });
}

// ===================================================================
// hangman
// ===================================================================
const HANGMAN_WORDS = [
    ['notepad', 'the only editor this site was built in'],
    ['guestbook', 'sign it'],
    ['defragment', 'what the blocks are doing'],
    ['winamp', 'it really whips something'],
    ['dialup', 'the sound of the internet arriving'],
    ['geocities', 'where everyone lived'],
    ['webring', 'a circle of sites'],
    ['bluescreen', 'a fatal exception has occurred'],
    ['minesweeper', 'the other thing on the disk'],
    ['solitaire', 'the most played program in windows history'],
    ['clippy', 'it looks like you are writing a letter'],
    ['floppy', 'one point four four megabytes'],
    ['modem', 'fifty six kilobits, on a good day'],
    ['screensaver', 'it only exists while nobody is looking'],
    ['bradar', 'you, apparently'],
    ['shithole', 'this website, affectionately'],
    ['marquee', 'text that will not sit still'],
    ['recyclebin', 'where things go, briefly'],
    ['scandisk', 'checking the surface, one cluster at a time'],
    ['tamagotchi', 'it needed you every four hours']
];

function openHangman() {
    const { body } = createAppWindow('hangman', { icon: 'psychology', width: 300 });
    body.classList.add('arc-body');
    body.innerHTML = `
        <canvas class="bevel-in hang-canvas" width="180" height="150"></canvas>
        <div class="hang-word" data-word></div>
        <div class="arc-msg" data-msg></div>
        <div class="hang-keys" data-keys></div>
        <button class="bevel-out arc-btn" data-new>new word</button>`;

    const cv = body.querySelector('canvas'), ctx = cv.getContext('2d');
    const wordEl = body.querySelector('[data-word]');
    const msg = body.querySelector('[data-msg]');
    const keys = body.querySelector('[data-keys]');
    let word, clue, got, wrong, done;

    const PARTS = [
        (c) => { c.beginPath(); c.moveTo(20, 140); c.lineTo(100, 140); c.stroke(); },      // ground
        (c) => { c.beginPath(); c.moveTo(45, 140); c.lineTo(45, 20); c.lineTo(120, 20); c.stroke(); },
        (c) => { c.beginPath(); c.moveTo(120, 20); c.lineTo(120, 38); c.stroke(); },
        (c) => { c.beginPath(); c.arc(120, 50, 12, 0, 7); c.stroke(); },                    // head
        (c) => { c.beginPath(); c.moveTo(120, 62); c.lineTo(120, 100); c.stroke(); },       // body
        (c) => { c.beginPath(); c.moveTo(120, 72); c.lineTo(104, 88); c.stroke(); },
        (c) => { c.beginPath(); c.moveTo(120, 72); c.lineTo(136, 88); c.stroke(); },
        (c) => { c.beginPath(); c.moveTo(120, 100); c.lineTo(106, 126); c.stroke(); },
        (c) => { c.beginPath(); c.moveTo(120, 100); c.lineTo(134, 126); c.stroke(); }
    ];

    function paint() {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        for (let i = 0; i < Math.min(wrong + 1, PARTS.length); i++) PARTS[i](ctx);
    }

    function show() {
        wordEl.textContent = word.split('').map(c => got.includes(c) ? c : '_').join(' ');
        keys.innerHTML = 'abcdefghijklmnopqrstuvwxyz'.split('').map(c =>
            `<button class="bevel-out hang-key" data-k="${c}"${got.includes(c) || done ? ' disabled' : ''}>${c}</button>`).join('');
        keys.querySelectorAll('[data-k]').forEach(b => b.onclick = () => pick(b.dataset.k));
        paint();
    }

    function pick(c) {
        if (done || got.includes(c)) return;
        got.push(c);
        if (word.includes(c)) {
            playSound('ding');
            if (word.split('').every(ch => got.includes(ch))) {
                done = true;
                msg.textContent = 'got it. "' + word + '" — ' + clue;
                unlockAchievement('hangman');
            }
        } else {
            wrong++;
            playSound('click');
            if (wrong >= PARTS.length - 1) {
                done = true;
                msg.textContent = 'it was "' + word + '" — ' + clue;
            }
        }
        show();
    }

    function reset() {
        const pickWord = HANGMAN_WORDS[(Math.random() * HANGMAN_WORDS.length) | 0];
        word = pickWord[0]; clue = pickWord[1];
        got = []; wrong = -1; done = false;
        msg.textContent = word.length + ' letters.';
        show();
    }
    body.querySelector('[data-new]').onclick = () => { playSound('click'); reset(); };
    reset();
}

// ===================================================================
// simon — the memory game with the four coloured lungs
// ===================================================================
function openSimon() {
    const { body } = createAppWindow('simon', { icon: 'graphic_eq', width: 260 });
    body.classList.add('arc-body');
    body.innerHTML = `
        <div class="game-hud"><span>round: <b data-r>0</b></span><span>best: <b data-b>0</b></span></div>
        <div class="simon-pad">
            ${[0, 1, 2, 3].map(i => `<button class="simon-btn s${i}" data-s="${i}"></button>`).join('')}
        </div>
        <div class="arc-msg" data-msg>press start.</div>
        <button class="bevel-out arc-btn" data-new>start</button>
        ${arcHint('it adds one every round. four is easy. nine is not.')}`;

    const TONES = [329.6, 261.6, 220.0, 164.8];
    const msg = body.querySelector('[data-msg]');
    let seq = [], at = 0, showing = false;
    body.querySelector('[data-b]').textContent = arcBest('simon');

    function flash(i, ms) {
        const b = body.querySelector('[data-s="' + i + '"]');
        if (!b) return;
        b.classList.add('lit');
        beep(TONES[i], ms);
        setTimeout(() => b.classList.remove('lit'), ms);
    }
    // A square wave, because that is what the toy had. It borrows the
    // desktop's own AudioContext rather than opening a second one — a
    // page is allowed a handful and this site already has games in it.
    // If nothing has played yet there is no context, and the game is
    // perfectly playable silent.
    function beep(freq, ms) {
        const ac = typeof audioContext !== 'undefined' ? audioContext : null;
        if (!ac || window.soundEnabled === false) return;
        try {
            const o = ac.createOscillator(), g = ac.createGain();
            o.type = 'square'; o.frequency.value = freq;
            // a square wave at full gain is a fire alarm
            g.gain.value = 0.035;
            o.connect(g); g.connect(ac.destination);
            o.start(); o.stop(ac.currentTime + ms / 1000);
        } catch (e) { }
    }

    async function playBack() {
        showing = true;
        msg.textContent = 'watch.';
        await new Promise(r => setTimeout(r, 400));
        for (const i of seq) {
            flash(i, 380);
            await new Promise(r => setTimeout(r, 520));
        }
        showing = false;
        at = 0;
        msg.textContent = 'your turn.';
    }

    function next() {
        seq.push((Math.random() * 4) | 0);
        body.querySelector('[data-r]').textContent = seq.length;
        playBack();
    }

    function press(i) {
        if (showing || !seq.length) return;
        flash(i, 180);
        if (seq[at] !== i) {
            msg.textContent = 'wrong. it was ' + seq.length + ' long.';
            body.querySelector('[data-b]').textContent = arcBest('simon', seq.length - 1);
            if (seq.length - 1 >= 8) unlockAchievement('simon');
            seq = [];
            return;
        }
        at++;
        if (at >= seq.length) { msg.textContent = 'right.'; setTimeout(next, 700); }
    }

    body.querySelectorAll('[data-s]').forEach(b => b.onclick = () => press(+b.dataset.s));
    body.querySelector('[data-new]').onclick = () => { seq = []; next(); };
}

// ===================================================================
// 2048
// ===================================================================
function open2048() {
    const { body, win } = createAppWindow('2048', { icon: 'casino', width: 300 });
    body.classList.add('arc-body');
    body.innerHTML = `
        <div class="game-hud"><span>score: <b data-s>0</b></span><span>best: <b data-b>0</b></span></div>
        <div class="g2048" data-grid></div>
        <div class="arc-msg" data-msg></div>
        <div class="arc-pad-host"></div>
        <button class="bevel-out arc-btn" data-new>new game</button>
        ${arcHint(window.TOUCH && TOUCH.coarse() ? 'swipe the board, or use the pad' : 'arrow keys or wasd')}`;

    const grid = body.querySelector('[data-grid]');
    const msg = body.querySelector('[data-msg]');
    let cells, score, over;
    body.querySelector('[data-b]').textContent = arcBest('2048');

    const idx = (r, c) => r * 4 + c;
    function spawn() {
        const free = [];
        cells.forEach((v, i) => { if (!v) free.push(i); });
        if (!free.length) return;
        cells[free[(Math.random() * free.length) | 0]] = Math.random() < 0.9 ? 2 : 4;
    }
    function draw() {
        grid.innerHTML = cells.map(v =>
            `<div class="g2048-cell v${v}">${v || ''}</div>`).join('');
        body.querySelector('[data-s]').textContent = score;
    }
    // one row, slid left and merged — every direction is this with the
    // indices read differently, which is the whole trick to 2048
    function slide(row) {
        const kept = row.filter(Boolean);
        const out = [];
        for (let i = 0; i < kept.length; i++) {
            if (kept[i] === kept[i + 1]) { out.push(kept[i] * 2); score += kept[i] * 2; i++; }
            else out.push(kept[i]);
        }
        while (out.length < 4) out.push(0);
        return out;
    }
    function move(dir) {
        if (over) return;
        const before = cells.join(',');
        for (let i = 0; i < 4; i++) {
            let line = [];
            for (let j = 0; j < 4; j++) {
                line.push(dir === 'left' || dir === 'right' ? cells[idx(i, j)] : cells[idx(j, i)]);
            }
            if (dir === 'right' || dir === 'down') line.reverse();
            line = slide(line);
            if (dir === 'right' || dir === 'down') line.reverse();
            for (let j = 0; j < 4; j++) {
                if (dir === 'left' || dir === 'right') cells[idx(i, j)] = line[j];
                else cells[idx(j, i)] = line[j];
            }
        }
        if (cells.join(',') === before) return;       // nothing moved, no spawn
        playSound('click');
        spawn();
        draw();
        if (cells.includes(2048)) { msg.textContent = '2048. that is the whole game.'; unlockAchievement('g2048'); }
        if (!canMove()) {
            over = true;
            msg.textContent = 'no moves left. ' + score + '.';
            body.querySelector('[data-b]').textContent = arcBest('2048', score);
        }
    }
    function canMove() {
        if (cells.includes(0)) return true;
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
            if (c < 3 && cells[idx(r, c)] === cells[idx(r, c + 1)]) return true;
            if (r < 3 && cells[idx(r, c)] === cells[idx(r + 1, c)]) return true;
        }
        return false;
    }
    function reset() {
        cells = Array(16).fill(0); score = 0; over = false;
        msg.textContent = '';
        spawn(); spawn(); draw();
    }

    const KEYS = {
        ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
        a: 'left', d: 'right', w: 'up', s: 'down'
    };
    const onKey = (e) => {
        if (!win.isConnected) return;
        const d = KEYS[e.key];
        if (!d) return;
        e.preventDefault();
        move(d);
    };
    document.addEventListener('keydown', onKey);
    win._cleanup = () => document.removeEventListener('keydown', onKey);

    // a finger swipes; the pad is there for anyone who would rather press
    let sx = 0, sy = 0;
    grid.addEventListener('touchstart', (e) => {
        sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    grid.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
        move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }, { passive: true });
    if (window.TOUCH && TOUCH.coarse()) {
        TOUCH.pad(body.querySelector('.arc-pad-host'), {
            onDir: (d, down) => { if (down) move(d); }
        });
    }

    body.querySelector('[data-new]').onclick = () => { playSound('click'); reset(); };
    reset();
}

// ===================================================================
// tetris
// ===================================================================
function openTetris() {
    const { body, win } = createAppWindow('tetris', { icon: 'sports_esports', width: 300 });
    body.classList.add('arc-body');
    body.innerHTML = `
        <div class="game-hud"><span>lines: <b data-l>0</b></span><span>best: <b data-b>0</b></span></div>
        <canvas class="bevel-in game-canvas" width="200" height="360"></canvas>
        <div class="arc-msg" data-msg></div>
        <div class="arc-pad-host"></div>
        <button class="bevel-out arc-btn" data-new>new game</button>
        ${arcHint(window.TOUCH && TOUCH.coarse() ? 'pad moves, A rotates, down drops' : 'arrows move &middot; up rotates &middot; space drops')}`;

    const cv = body.querySelector('canvas'), ctx = cv.getContext('2d');
    const msg = body.querySelector('[data-msg]');
    const W = 10, H = 18, S = 20;
    const SHAPES = [
        [[1, 1, 1, 1]],
        [[1, 1], [1, 1]],
        [[0, 1, 0], [1, 1, 1]],
        [[1, 0, 0], [1, 1, 1]],
        [[0, 0, 1], [1, 1, 1]],
        [[1, 1, 0], [0, 1, 1]],
        [[0, 1, 1], [1, 1, 0]]
    ];
    const COLOURS = ['#00c4c4', '#c4c400', '#a000c4', '#0000c4', '#c46a00', '#00a800', '#c40000'];
    let field, piece, px, py, colour, lines, dead, timer, dropMs;
    body.querySelector('[data-b]').textContent = arcBest('tetris');

    const rotate = (m) => m[0].map((_, i) => m.map(r => r[i]).reverse());
    function hits(shape, x, y) {
        for (let r = 0; r < shape.length; r++) for (let c = 0; c < shape[r].length; c++) {
            if (!shape[r][c]) continue;
            const nx = x + c, ny = y + r;
            if (nx < 0 || nx >= W || ny >= H) return true;
            if (ny >= 0 && field[ny][nx]) return true;
        }
        return false;
    }
    function newPiece() {
        const i = (Math.random() * SHAPES.length) | 0;
        piece = SHAPES[i]; colour = COLOURS[i];
        px = ((W - piece[0].length) / 2) | 0; py = -piece.length;
        if (hits(piece, px, 0)) {
            dead = true;
            clearInterval(timer);
            msg.textContent = 'blocked. ' + lines + ' lines.';
            body.querySelector('[data-b]').textContent = arcBest('tetris', lines);
            if (lines >= 10) unlockAchievement('tetris');
        }
    }
    function settle() {
        piece.forEach((row, r) => row.forEach((v, c) => {
            if (v && py + r >= 0) field[py + r][px + c] = colour;
        }));
        let cleared = 0;
        for (let r = H - 1; r >= 0; r--) {
            if (field[r].every(Boolean)) {
                field.splice(r, 1); field.unshift(Array(W).fill(null));
                cleared++; r++;
            }
        }
        if (cleared) {
            lines += cleared;
            body.querySelector('[data-l]').textContent = lines;
            playSound('ding');
            // it gets faster, but never so fast it stops being a game
            dropMs = Math.max(120, 520 - lines * 18);
            clearInterval(timer);
            timer = setInterval(tick, dropMs);
        }
        newPiece();
    }
    function tick() {
        if (dead) return;
        if (hits(piece, px, py + 1)) settle(); else py++;
        draw();
    }
    function draw() {
        ctx.fillStyle = '#101018'; ctx.fillRect(0, 0, cv.width, cv.height);
        for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
            if (!field[r][c]) continue;
            cell(c, r, field[r][c]);
        }
        if (!dead) piece.forEach((row, r) => row.forEach((v, c) => {
            if (v && py + r >= 0) cell(px + c, py + r, colour);
        }));
    }
    function cell(x, y, col) {
        ctx.fillStyle = col;
        ctx.fillRect(x * S + 1, y * S + 1, S - 2, S - 2);
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.fillRect(x * S + 1, y * S + 1, S - 2, 3);
    }
    function move(dx) { if (!dead && !hits(piece, px + dx, py)) { px += dx; draw(); } }
    function spin() {
        if (dead) return;
        const r = rotate(piece);
        if (!hits(r, px, py)) { piece = r; draw(); }
    }
    function drop() { if (dead) return; while (!hits(piece, px, py + 1)) py++; settle(); draw(); }

    const onKey = (e) => {
        if (!win.isConnected) return;
        const k = e.key;
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
        if (k === 'ArrowLeft' || k === 'a') move(-1);
        else if (k === 'ArrowRight' || k === 'd') move(1);
        else if (k === 'ArrowUp' || k === 'w') spin();
        else if (k === 'ArrowDown' || k === 's') tick();
        else if (k === ' ') drop();
    };
    document.addEventListener('keydown', onKey);
    win._cleanup = () => { document.removeEventListener('keydown', onKey); clearInterval(timer); };

    if (window.TOUCH && TOUCH.coarse()) {
        TOUCH.pad(body.querySelector('.arc-pad-host'), {
            onDir: (d, down) => {
                if (!down) return;
                if (d === 'left') move(-1);
                else if (d === 'right') move(1);
                else if (d === 'up') spin();
                else if (d === 'down') tick();
            },
            buttons: [
                { label: 'rotate', title: 'rotate the piece', onPress: () => spin() },
                { label: 'drop', title: 'drop it', onPress: () => drop() }
            ]
        });
    }

    function reset() {
        clearInterval(timer);
        field = Array.from({ length: H }, () => Array(W).fill(null));
        lines = 0; dead = false; dropMs = 520;
        msg.textContent = '';
        body.querySelector('[data-l]').textContent = 0;
        newPiece(); draw();
        timer = setInterval(tick, dropMs);
    }
    body.querySelector('[data-new]').onclick = () => { playSound('click'); reset(); };
    reset();
}

// ===================================================================
// breakout
// ===================================================================
function openBreakout() {
    const { body, win } = createAppWindow('breakout', { icon: 'sports_esports', width: 300 });
    body.classList.add('arc-body');
    body.innerHTML = `
        <div class="game-hud"><span>score: <b data-s>0</b></span><span>lives: <b data-v>3</b></span>
            <span>best: <b data-b>0</b></span></div>
        <canvas class="bevel-in game-canvas" width="260" height="260"></canvas>
        <div class="arc-msg" data-msg>click the board to serve.</div>
        ${arcHint('the paddle follows the mouse, or your finger.')}`;

    const cv = body.querySelector('canvas'), ctx = cv.getContext('2d');
    const msg = body.querySelector('[data-msg]');
    const W = cv.width, H = cv.height;
    const COLS = 8, ROWS = 5, BW = W / COLS, BH = 14;
    let bricks, paddle, ball, score, lives, running, raf;
    body.querySelector('[data-b]').textContent = arcBest('breakout');

    function reset(full) {
        if (full) {
            bricks = [];
            for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) bricks.push({ r, c, alive: true });
            score = 0; lives = 3;
            body.querySelector('[data-s]').textContent = 0;
            body.querySelector('[data-v]').textContent = 3;
        }
        paddle = W / 2;
        ball = { x: W / 2, y: H - 40, vx: 2.4, vy: -2.8, r: 4 };
        running = false;
        draw();
    }
    function draw() {
        ctx.fillStyle = '#101018'; ctx.fillRect(0, 0, W, H);
        const hues = ['#c40000', '#c46a00', '#c4c400', '#00a800', '#0080c4'];
        bricks.forEach(b => {
            if (!b.alive) return;
            ctx.fillStyle = hues[b.r % hues.length];
            ctx.fillRect(b.c * BW + 1, 20 + b.r * BH + 1, BW - 2, BH - 2);
        });
        ctx.fillStyle = '#c0c0c0';
        ctx.fillRect(paddle - 26, H - 16, 52, 8);
        ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, 7); ctx.fill();
    }
    function step() {
        if (!running) return;
        ball.x += ball.vx; ball.y += ball.vy;
        if (ball.x < ball.r || ball.x > W - ball.r) ball.vx *= -1;
        if (ball.y < ball.r) ball.vy *= -1;
        // the paddle
        if (ball.y > H - 20 && ball.y < H - 8 && Math.abs(ball.x - paddle) < 30) {
            ball.vy = -Math.abs(ball.vy);
            // where it hits the paddle decides the angle, which is the
            // only thing that makes breakout a game of skill
            ball.vx += (ball.x - paddle) / 16;
            ball.vx = Math.max(-5, Math.min(5, ball.vx));
            playSound('click');
        }
        for (const b of bricks) {
            if (!b.alive) continue;
            const bx = b.c * BW, by = 20 + b.r * BH;
            if (ball.x > bx && ball.x < bx + BW && ball.y > by && ball.y < by + BH) {
                b.alive = false; ball.vy *= -1; score += 10;
                body.querySelector('[data-s]').textContent = score;
                playSound('ding');
                if (bricks.every(x => !x.alive)) {
                    running = false;
                    msg.textContent = 'cleared. ' + score + '.';
                    body.querySelector('[data-b]').textContent = arcBest('breakout', score);
                    unlockAchievement('breakout');
                }
                break;
            }
        }
        if (ball.y > H) {
            lives--;
            body.querySelector('[data-v]').textContent = lives;
            if (lives <= 0) {
                running = false;
                msg.textContent = 'out of balls. ' + score + '.';
                body.querySelector('[data-b]').textContent = arcBest('breakout', score);
                setTimeout(() => reset(true), 1200);
            } else { reset(false); msg.textContent = 'click to serve.'; }
        }
        draw();
        raf = requestAnimationFrame(step);
    }
    const aim = (clientX) => {
        const r = cv.getBoundingClientRect();
        paddle = Math.max(26, Math.min(W - 26, (clientX - r.left) * (W / r.width)));
        if (!running) draw();
    };
    cv.addEventListener('mousemove', e => aim(e.clientX));
    cv.addEventListener('touchmove', e => { aim(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
    const serve = () => {
        if (running) return;
        running = true; msg.textContent = '';
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(step);
    };
    cv.addEventListener('click', serve);
    cv.addEventListener('touchstart', serve, { passive: true });
    win._cleanup = () => cancelAnimationFrame(raf);
    reset(true);
}

// ===================================================================
// whack-a-mole
// ===================================================================
function openWhack() {
    const { body, win } = createAppWindow('whack a troll', { icon: 'castle', width: 280 });
    body.classList.add('arc-body');
    body.innerHTML = `
        <div class="game-hud"><span>hit: <b data-s>0</b></span><span>missed: <b data-m>0</b></span>
            <span>best: <b data-b>0</b></span></div>
        <div class="whack-grid" data-grid>
            ${Array.from({ length: 9 }, (_, i) => `<button class="whack-hole bevel-in" data-h="${i}"></button>`).join('')}
        </div>
        <div class="arc-msg" data-msg>thirty seconds.</div>
        <button class="bevel-out arc-btn" data-new>start</button>`;

    const msg = body.querySelector('[data-msg]');
    let up = -1, hits, missed, timer, ticker, left;
    body.querySelector('[data-b]').textContent = arcBest('whack');

    function pop() {
        const holes = body.querySelectorAll('[data-h]');
        if (up >= 0) { holes[up].classList.remove('up'); missed++; body.querySelector('[data-m]').textContent = missed; }
        up = (Math.random() * 9) | 0;
        holes[up].classList.add('up');
    }
    function stop() {
        clearInterval(timer); clearInterval(ticker);
        body.querySelectorAll('[data-h]').forEach(h => h.classList.remove('up'));
        up = -1;
        msg.textContent = 'time. ' + hits + ' hit, ' + missed + ' missed.';
        body.querySelector('[data-b]').textContent = arcBest('whack', hits);
        if (hits >= 20) unlockAchievement('whack');
    }
    function start() {
        hits = 0; missed = 0; left = 30;
        body.querySelector('[data-s]').textContent = 0;
        body.querySelector('[data-m]').textContent = 0;
        clearInterval(timer); clearInterval(ticker);
        // it speeds up, or thirty seconds is a long time to be bored
        let gap = 900;
        timer = setInterval(() => {
            pop();
            gap = Math.max(380, gap - 14);
            clearInterval(timer);
            timer = setInterval(pop, gap);
        }, gap);
        ticker = setInterval(() => {
            left--;
            msg.textContent = left + ' seconds.';
            if (left <= 0) stop();
        }, 1000);
        pop();
    }
    body.querySelectorAll('[data-h]').forEach(h => h.onclick = () => {
        const i = +h.dataset.h;
        if (i !== up) return;
        h.classList.remove('up');
        up = -1;
        hits++;
        body.querySelector('[data-s]').textContent = hits;
        playSound('ding');
    });
    body.querySelector('[data-new]').onclick = () => { playSound('click'); start(); };
    win._cleanup = () => { clearInterval(timer); clearInterval(ticker); };
}
