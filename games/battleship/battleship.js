// ===================================================================
// battleship 98: the window
//
// battleship-sim.js is the rules and the bot. This file is the window, the
// two seas, the placing of your fleet and the turns. Single player against
// the bot for now; the sim already carries the commit-reveal check for an
// online version.
//
// Placing: click one of your ships to pick it up, click a cell to put its
// bow there, R (or the rotate button) turns it. A move that would make two
// ships touch is refused and the status line says why.
// Battle: click a cell in enemy waters, or move with the arrows and fire
// with enter/space. Cells the shots prove empty are shaded for you.
// ===================================================================
(function () {
    'use strict';
    const S = window.BATTLESHIP_SIM;
    const N = S.SIZE;
    const COLS = 'abcdefghij';
    const STATS_KEY = 'mrhakan98-battleship-stats';
    const PREFS_KEY = 'mrhakan98-battleship-prefs';

    const readJson = k => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } };
    const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
    const prefs = () => Object.assign({ level: 'easy' }, readJson(PREFS_KEY));
    const stats = () => Object.assign({ games: 0, wins: 0, best: 0 }, readJson(STATS_KEY));
    const key = (x, y) => x + ',' + y;
    const name = (x, y) => COLS[x] + (y + 1);

    function ensureCss() {
        if (document.getElementById('battleship-css')) return;
        const l = document.createElement('link');
        l.id = 'battleship-css'; l.rel = 'stylesheet'; l.href = 'games/battleship/battleship.css';
        document.head.appendChild(l);
    }

    // small square-wave beeps, quiet, only when the desktop's sound is on
    let actx = null;
    function tone(f, d, delay) {
        if (typeof soundEnabled !== 'undefined' && !soundEnabled) return;
        try {
            actx = actx || new (window.AudioContext || window.webkitAudioContext)();
            const t = actx.currentTime + (delay || 0);
            const o = actx.createOscillator(), g = actx.createGain();
            o.type = 'square'; o.frequency.value = f;
            g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
            o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d);
        } catch (e) { }
    }
    const SFX = {
        miss: () => tone(220, 0.08),
        hit: () => { tone(440, 0.06); tone(660, 0.08, 0.06); },
        sunk: () => { tone(660, 0.07); tone(880, 0.07, 0.07); tone(1100, 0.12, 0.14); },
        win: () => { tone(523, 0.1); tone(659, 0.1, 0.1); tone(784, 0.1, 0.2); tone(1046, 0.25, 0.3); },
        lose: () => { tone(330, 0.15); tone(247, 0.3, 0.15); }
    };

    // ---------------------------------------------------------------
    // state
    // ---------------------------------------------------------------
    // phase: 'menu' | 'place' | 'battle' | 'over'
    let winRef = null, root = null, msgEl = null, infoEl = null, toolsEl = null, overEl = null;
    let boards = [null, null];      // [mine, theirs]: { el, cells[x][y] }
    let phase = 'menu', fleet = null, picked = -1, G = null, botTimer = 0, speed = 1;
    let cur = { x: 0, y: 0 };       // the keyboard cursor, on whichever board is in play
    let last = [null, null];        // the last shot each side fired

    function mount() {
        ensureCss();
        if (winRef && winRef.win.isConnected) {
            winRef.win.style.display = 'flex';
            if (typeof ieHighestZ === 'number') winRef.win.style.zIndex = ++ieHighestZ;
            root.focus({ preventScroll: true });
            return false;
        }
        const vw = typeof viewportWidth === 'function' ? viewportWidth() : innerWidth;
        winRef = createAppWindow('battleship 98', { icon: 'explore', width: Math.min(640, vw - 20) });
        winRef.body.classList.add('bs-body');
        winRef.win.classList.add('battleship-window');
        winRef.body.innerHTML = `
            <div class="bs-app" tabindex="0">
                <div class="bs-status"><span class="bs-msg">battleship 98</span><span class="bs-info"></span></div>
                <div class="bs-seas">
                    <div class="bs-sea" data-side="0"><div class="bs-cap">your fleet</div><div class="bs-grid"></div></div>
                    <div class="bs-sea" data-side="1"><div class="bs-cap">enemy waters</div><div class="bs-grid"></div></div>
                </div>
                <div class="bs-tools"></div>
                <div class="bs-over" hidden></div>
            </div>`;
        root = winRef.body.querySelector('.bs-app');
        msgEl = root.querySelector('.bs-msg');
        infoEl = root.querySelector('.bs-info');
        toolsEl = root.querySelector('.bs-tools');
        overEl = root.querySelector('.bs-over');
        root.querySelectorAll('.bs-sea').forEach((sea, side) => { boards[side] = buildGrid(sea.querySelector('.bs-grid'), side); });
        bindInput();
        const prev = winRef.win._cleanup;
        winRef.win._cleanup = () => {
            clearTimeout(botTimer); botTimer = 0;
            winRef = null; G = null; phase = 'menu'; fleet = null;
            if (prev) prev();
        };
        return true;
    }

    function buildGrid(el, side) {
        const cells = [];
        let html = '<span class="bs-lbl"></span>';
        for (let x = 0; x < N; x++) html += `<span class="bs-lbl">${COLS[x]}</span>`;
        for (let y = 0; y < N; y++) {
            html += `<span class="bs-lbl">${y + 1}</span>`;
            for (let x = 0; x < N; x++) html += `<button class="bs-cell" data-side="${side}" data-x="${x}" data-y="${y}" aria-label="${side ? 'enemy' : 'your'} ${name(x, y)}" tabindex="-1"></button>`;
        }
        el.innerHTML = html;
        for (let x = 0; x < N; x++) { cells.push([]); for (let y = 0; y < N; y++) cells[x].push(el.querySelector(`[data-x="${x}"][data-y="${y}"]`)); }
        return { el, cells };
    }

    // ---------------------------------------------------------------
    // drawing: classes on 200 buttons
    // ---------------------------------------------------------------
    function shipCells(ships) {
        const m = new Map();
        ships.forEach((s, i) => S.cellsOf(s).forEach(([x, y]) => m.set(key(x, y), i)));
        return m;
    }
    function paint() {
        if (!root) return;
        const mine = boards[0].cells, theirs = boards[1].cells;
        const myShips = G ? G.fleets[0] : fleet || [];
        const owned = shipCells(myShips);
        const shotsAtMe = G ? G.shots[1] : [];
        const hitMe = new Set(shotsAtMe.filter(s => s.result !== 'miss').map(s => key(s.x, s.y)));
        const missMe = new Set(shotsAtMe.filter(s => s.result === 'miss').map(s => key(s.x, s.y)));
        const sunkMine = new Set();
        myShips.forEach(s => { const c = S.cellsOf(s); if (c.every(([x, y]) => hitMe.has(key(x, y)))) c.forEach(([x, y]) => sunkMine.add(key(x, y))); });
        const myShots = G ? G.shots[0] : [];
        const K = S.knowledge(myShots);
        const missThem = new Set(myShots.filter(s => s.result === 'miss').map(s => key(s.x, s.y)));
        const openThem = new Set(K.open.map(([x, y]) => key(x, y)));
        const reveal = phase === 'over' && G ? shipCells(G.fleets[1]) : null;
        const aimMine = phase === 'place', aimThem = phase === 'battle';
        for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
            const k = key(x, y);
            let c = mine[x][y], cls = 'bs-cell';
            if (owned.has(k)) cls += ' bs-ship' + (owned.get(k) === picked ? ' bs-picked' : '');
            if (sunkMine.has(k)) cls += ' bs-sunk';
            else if (hitMe.has(k)) cls += ' bs-hit';
            else if (missMe.has(k)) cls += ' bs-miss';
            if (last[1] && last[1].x === x && last[1].y === y) cls += ' bs-last';
            if (aimMine && cur.x === x && cur.y === y) cls += ' bs-cur';
            c.className = cls;
            c.disabled = !aimMine;
            c = theirs[x][y]; cls = 'bs-cell';
            if (K.hit.has(k)) cls += openThem.has(k) ? ' bs-hit' : ' bs-sunk';
            else if (missThem.has(k)) cls += ' bs-miss';
            else if (K.water.has(k)) cls += ' bs-water';
            else if (reveal && reveal.has(k)) cls += ' bs-ship bs-left';
            if (last[0] && last[0].x === x && last[0].y === y) cls += ' bs-last';
            if (aimThem && cur.x === x && cur.y === y) cls += ' bs-cur';
            c.className = cls;
            c.disabled = !(aimThem && G && G.turn === 0 && !missThem.has(k) && !K.hit.has(k));
        }
        root.querySelector('.bs-sea[data-side="0"]').classList.toggle('bs-live', aimMine);
        root.querySelector('.bs-sea[data-side="1"]').classList.toggle('bs-live', aimThem);
        root.querySelector('.bs-sea[data-side="1"]').classList.toggle('bs-dim', phase === 'place');
        root.dataset.phase = phase;
        if (G) {
            const theirsLeft = K.left;
            const mineLeft = myShips.filter(s => !S.cellsOf(s).every(([x, y]) => hitMe.has(key(x, y)))).map(s => s.len).sort((a, b) => b - a);
            infoEl.textContent = `enemy ships ${theirsLeft.join(' ') || '-'} · yours ${mineLeft.join(' ') || '-'}`;
        } else infoEl.textContent = phase === 'place' ? 'fleet 5-4-3-3-2, no two ships touching' : '';
        tools();
    }
    function say(text, mine) {
        if (!msgEl) return;
        msgEl.textContent = text;
        msgEl.classList.toggle('bs-mine', !!mine);
    }

    function tools() {
        let html = '';
        if (phase === 'place') {
            html = `<button class="bs-btn" data-act="random">shuffle fleet (n)</button>
                <button class="bs-btn" data-act="rotate"${picked < 0 ? ' disabled' : ''}>rotate (r)</button>
                <span class="bs-spacer"></span>
                <button class="bs-btn" data-act="menu">menu</button>
                <button class="bs-btn bs-go" data-act="battle">start battle</button>`;
        } else if (phase === 'battle' || phase === 'over') {
            html = `<button class="bs-btn" data-act="help">how to play</button><span class="bs-spacer"></span>
                <button class="bs-btn" data-act="menu">menu</button>
                <button class="bs-btn${phase === 'over' ? ' bs-go' : ''}" data-act="again">new battle</button>`;
        }
        toolsEl.innerHTML = html;
    }

    // ---------------------------------------------------------------
    // dialogs
    // ---------------------------------------------------------------
    function dialog(title, inner) {
        overEl.innerHTML = `<div class="bs-dlg" role="dialog" aria-label="${title}"><div class="bs-dlg-bar">${title}</div><div class="bs-dlg-in">${inner}</div></div>`;
        overEl.hidden = false;
        const go = overEl.querySelector('.bs-go') || overEl.querySelector('button');
        if (go) go.focus({ preventScroll: true });
    }
    function closeDialog() { overEl.hidden = true; overEl.innerHTML = ''; root.focus({ preventScroll: true }); }

    function showMenu() {
        clearTimeout(botTimer); botTimer = 0;
        phase = 'menu'; G = null; picked = -1; last = [null, null];
        if (!fleet) fleet = S.randomFleet(Math.random);
        paint();
        say('battleship 98');
        const p = prefs(), st = stats();
        const seg = [['easy', 'easy'], ['normal', 'normal'], ['hard', 'hard']]
            .map(([v, l]) => `<button class="bs-btn" data-act="level" data-v="${v}" aria-pressed="${v === p.level}">${l}</button>`).join('');
        dialog('battleship 98', `
            <div class="bs-title">battleship <b>98</b></div>
            <p>goal: sink all five enemy ships before the bot sinks yours.</p>
            <div class="bs-row"><span class="bs-label">bot</span><span class="bs-seg">${seg}</span></div>
            <div class="bs-actions">
                <button class="bs-btn" data-act="help">how to play</button>
                <button class="bs-btn bs-go" data-act="place">place your fleet</button>
            </div>
            <p class="bs-note">${st.games ? `battles ${st.games}, won ${st.wins}${st.best ? ' · fewest shots to win ' + st.best : ''}` : 'no battles yet. the bot is already at sea, bradar'}</p>`);
    }
    let helpBack = null;
    function showHelp() {
        helpBack = phase === 'menu' ? 'menu' : null;
        dialog('how to play battleship', `
            <ul class="bs-help">
                <li>both sides hide a fleet of five ships, <b>5-4-3-3-2</b>, on a 10x10 sea. ships lie straight and never touch, not even at a corner.</li>
                <li>take turns firing at one cell. the answer is <b>miss</b>, <b>hit</b>, or <b>sunk</b> with the ship's length. turns swap after every shot.</li>
                <li>cells your shots prove empty (round a sunk ship, the corners of a hit) are shaded, so do not waste shots there.</li>
                <li>first to sink the whole enemy fleet wins.</li>
            </ul>
            <p class="bs-keys">placing: click a ship, then a cell to move it; r rotates, n shuffles the fleet.<br>
            battle: click a cell in enemy waters, or arrows to aim and enter/space to fire.</p>
            <div class="bs-actions"><button class="bs-btn bs-go" data-act="closehelp">got it</button></div>`);
    }
    function showEnd() {
        const won = S.over(G) === 'you';
        const shots = G.shots[0].length;
        const st = stats();
        st.games++;
        if (won) { st.wins++; if (!st.best || shots < st.best) st.best = shots; }
        writeJson(STATS_KEY, st);
        phase = 'over';
        paint();
        (won ? SFX.win : SFX.lose)();
        const acc = Math.round(100 * G.shots[0].filter(s => s.result !== 'miss').length / Math.max(1, shots));
        say(won ? 'enemy fleet sunk. you win!' : 'your fleet is gone. the bot wins.', won);
        dialog(won ? 'victory' : 'defeat', `
            <p><b>${won ? 'you sank the whole enemy fleet' : 'the ' + G.level + ' bot sank your fleet'}</b> in ${won ? shots : G.shots[1].length} shots.</p>
            <p>your shots ${shots}, hits ${acc}%${won && st.best === shots ? ' · a new best' : ''}.${won ? '' : ' the ships you missed are shown in enemy waters.'}</p>
            <div class="bs-actions"><button class="bs-btn" data-act="look">look at the seas</button><button class="bs-btn" data-act="menu">menu</button><button class="bs-btn bs-go" data-act="again">new battle</button></div>`);
    }

    // ---------------------------------------------------------------
    // placing the fleet
    // ---------------------------------------------------------------
    function startPlacing() {
        closeDialog();
        phase = 'place'; G = null; picked = -1; last = [null, null];
        if (!fleet) fleet = S.randomFleet(Math.random);
        cur = { x: 0, y: 0 };
        say('place your fleet: click a ship, then where its bow goes. or just start.', true);
        paint();
    }
    function tryFleet(next, okMsg) {
        const why = S.fleetProblem(next);
        if (why) { say("can't go there: " + why + '.'); tone(150, 0.08); return false; }
        fleet = next;
        if (okMsg) say(okMsg, true);
        return true;
    }
    function placeClick(x, y) {
        const owned = shipCells(fleet);
        const hit = owned.has(key(x, y)) ? owned.get(key(x, y)) : -1;
        if (picked < 0) {
            if (hit < 0) { say('click one of your ships first.'); return; }
            picked = hit;
            say(`picked up the ${fleet[picked].len}. click where its bow goes, r to rotate.`, true);
        } else if (hit === picked && !(fleet[picked].x === x && fleet[picked].y === y)) {
            picked = -1; say('put it back.');
        } else if (hit >= 0 && hit !== picked) {
            picked = hit;
            say(`picked up the ${fleet[picked].len}. click where its bow goes, r to rotate.`, true);
        } else {
            const next = fleet.map((s, i) => (i === picked ? Object.assign({}, s, { x, y }) : s));
            if (tryFleet(next, 'moved. pick another ship or start the battle.')) picked = -1;
        }
        paint();
    }
    function rotate() {
        if (picked < 0) { say('pick a ship to rotate first.'); return; }
        const s = fleet[picked];
        const next = fleet.map((t, i) => (i === picked ? Object.assign({}, t, { dir: t.dir === 'h' ? 'v' : 'h' }) : t));
        tryFleet(next, 'turned the ' + s.len + '.');
        paint();
    }

    // ---------------------------------------------------------------
    // the battle
    // ---------------------------------------------------------------
    function startBattle() {
        const p = prefs();
        G = S.newGame({ level: p.level, fleet });
        phase = 'battle'; picked = -1; last = [null, null];
        cur = { x: 4, y: 4 };
        closeDialog();
        say('your shot. pick a cell in enemy waters.', true);
        paint();
    }
    function describe(r, who) {
        if (r.result === 'miss') return who + ' missed at ' + name(r.x, r.y) + '.';
        if (r.result === 'hit') return who + ' hit at ' + name(r.x, r.y) + '!';
        return who + ' sank a ' + r.len + ' at ' + name(r.x, r.y) + '!';
    }
    function fireAt(x, y) {
        if (phase !== 'battle' || !G || G.turn !== 0) return;
        const r = S.fire(G, x, y);
        if (r.result === 'invalid') { say('you already fired at ' + name(x, y) + '.'); return; }
        last[0] = { x, y };
        SFX[r.result]();
        if (S.over(G)) { paint(); showEnd(); return; }
        say(describe(r, 'you') + ' the bot is aiming...');
        paint();
        botTimer = setTimeout(botTurn, 550 / speed);
    }
    function botTurn() {
        botTimer = 0;
        if (phase !== 'battle' || !G || G.turn !== 1) return;
        const m = S.botMove(G);
        const r = S.fire(G, m.x, m.y);
        last[1] = { x: m.x, y: m.y };
        if (r.result !== 'miss') SFX[r.result]();
        if (S.over(G)) { paint(); showEnd(); return; }
        say(describe(r, 'the bot') + ' your shot.', true);
        paint();
    }

    // ---------------------------------------------------------------
    // input
    // ---------------------------------------------------------------
    function act(a, el) {
        switch (a) {
            case 'level': {
                const p = prefs(); p.level = el.dataset.v; writeJson(PREFS_KEY, p);
                overEl.querySelectorAll('[data-act=level]').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
                break;
            }
            case 'place': startPlacing(); break;
            case 'random': fleet = S.randomFleet(Math.random); picked = -1; say('a fresh fleet. move ships or start the battle.', true); paint(); break;
            case 'rotate': rotate(); break;
            case 'battle': startBattle(); break;
            case 'help': showHelp(); break;
            case 'closehelp': if (helpBack === 'menu') showMenu(); else closeDialog(); break;
            case 'menu': showMenu(); break;
            case 'again': fleet = null; startPlacing(); break;
            case 'look': closeDialog(); break;
        }
    }
    function bindInput() {
        root.addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b || b.disabled) return;
            if (b.dataset.act) { act(b.dataset.act, b); return; }
            if (!b.classList.contains('bs-cell')) return;
            const x = +b.dataset.x, y = +b.dataset.y, side = +b.dataset.side;
            cur = { x, y };
            if (side === 0 && phase === 'place') placeClick(x, y);
            else if (side === 1 && phase === 'battle') fireAt(x, y);
        });
        root.addEventListener('keydown', e => {
            if (!overEl.hidden) { if (e.key === 'Escape' && phase !== 'menu') { e.preventDefault(); closeDialog(); } return; }
            const k = e.key.toLowerCase();
            const moves = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
            if (moves[k] && (phase === 'place' || phase === 'battle')) {
                e.preventDefault();
                cur = { x: Math.max(0, Math.min(N - 1, cur.x + moves[k][0])), y: Math.max(0, Math.min(N - 1, cur.y + moves[k][1])) };
                paint();
                return;
            }
            if ((k === ' ' || k === 'enter') && e.target.closest('.bs-tools')) return;
            if (k === ' ' || k === 'enter') {
                e.preventDefault();
                if (phase === 'place') placeClick(cur.x, cur.y);
                else if (phase === 'battle') fireAt(cur.x, cur.y);
            } else if (k === 'r' && phase === 'place') rotate();
            else if (k === 'n' && phase === 'place') act('random');
            else if (k === 'h') showHelp();
        });
    }

    // ---------------------------------------------------------------
    // the front door
    // ---------------------------------------------------------------
    window.startBattleship = function () {
        const fresh = mount();
        if (fresh) showMenu();
        return winRef && winRef.win;
    };

    // the test hook: what is going on, and a faster bot
    window.BATTLESHIP_ENGINE = {
        phase: () => phase,
        state: () => G,
        fleet: () => (fleet ? fleet.map(s => Object.assign({}, s)) : null),
        speed: k => { speed = Math.max(0.25, +k || 1); },
        cell: (side, x, y) => boards[side] && boards[side].cells[x][y]
    };
})();
