// ===================================================================
// battleship 98: the window
//
// battleship-sim.js is the rules and the bot. This file is the window, the
// two seas, the placing of your fleet and the turns: against the bot, or one
// on one through the netplay lobby.
//
// Online nobody holds the other's fleet. Each side places its own, keeps it,
// and sends only a commitment (battleship:ready). Shots and answers go side
// to side (battleship:shot / battleship:answer, with a running number); the
// host is the switchboard and the lobby's seed picks who opens, after that
// the turn swaps every shot. At the end both reveal ships + salt
// (battleship:reveal) and each side checks the other's against every answer
// it was given, then says what it found (battleship:verdict). Leaving before
// the reveal is a forfeit: a hidden fleet can't be handed to a bot.
//
// Placing: click one of your ships to pick it up, click a cell to put its
// bow there, R (or the rotate button) turns it. A move that would make two
// ships touch is refused and the status line says why.
// Battle: click a cell in enemy waters, or move with the arrows and fire
// with enter/space. Cells the shots prove empty are shaded for you.
// ===================================================================
(function () {
    'use strict';
    // loaded twice (the desktop's loader, then the lobby's): keep the first, just register it
    if (window.BATTLESHIP_ENGINE) { if (BATTLESHIP_ENGINE.register) BATTLESHIP_ENGINE.register(); return; }
    const S = window.BATTLESHIP_SIM;
    const N = S.SIZE;
    const COLS = 'abcdefghij';
    const STATS_KEY = 'mrhakan98-battleship-stats';
    const PREFS_KEY = 'mrhakan98-battleship-prefs';
    const SAVE_KEY = 'mrhakan98-battleship-save';     // the battle in progress, after every shot

    const readJson = k => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } };
    const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
    const prefs = () => Object.assign({ level: 'easy' }, readJson(PREFS_KEY));
    const stats = () => Object.assign({ games: 0, wins: 0, best: 0, onlineGames: 0, onlineWins: 0, onlineLosses: 0 }, readJson(STATS_KEY));
    const key = (x, y) => x + ',' + y;
    const name = (x, y) => COLS[x] + (y + 1);
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const unlock = id => { try { if (typeof unlockAchievement === 'function') unlockAchievement(id); } catch (e) { } };

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
    // phase: 'menu' | 'place' | 'ready' (online, fleet locked) | 'battle' | 'over'
    let winRef = null, root = null, msgEl = null, infoEl = null, toolsEl = null, overEl = null;
    let boards = [null, null];      // [mine, theirs]: { el, cells[x][y] }
    let phase = 'menu', fleet = null, picked = -1, G = null, botTimer = 0, speed = 1;
    let cur = { x: 0, y: 0 };       // the keyboard cursor, on whichever board is in play
    let last = [null, null];        // the last shot each side fired
    let O = null;                   // the online match, or null against the bot

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
            leaveOnline(null, true);
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
    // the match as paint() reads it: the bot's, or the online duel dressed the same way
    function view() {
        if (O && O.d) return { fleets: [O.ships, O.theirShips], shots: [O.d.mine, O.d.theirs], turn: O.d.turn === 'me' && !O.d.pending && !O.d.over ? 0 : 1 };
        return G;
    }
    function paint() {
        if (!root) return;
        const V = view();
        const mine = boards[0].cells, theirs = boards[1].cells;
        const myShips = V ? V.fleets[0] : fleet || [];
        const owned = shipCells(myShips);
        const shotsAtMe = V ? V.shots[1] : [];
        const hitMe = new Set(shotsAtMe.filter(s => s.result !== 'miss').map(s => key(s.x, s.y)));
        const missMe = new Set(shotsAtMe.filter(s => s.result === 'miss').map(s => key(s.x, s.y)));
        const sunkMine = new Set();
        myShips.forEach(s => { const c = S.cellsOf(s); if (c.every(([x, y]) => hitMe.has(key(x, y)))) c.forEach(([x, y]) => sunkMine.add(key(x, y))); });
        const myShots = V ? V.shots[0] : [];
        const K = S.knowledge(myShots);
        const missThem = new Set(myShots.filter(s => s.result === 'miss').map(s => key(s.x, s.y)));
        const openThem = new Set(K.open.map(([x, y]) => key(x, y)));
        const reveal = phase === 'over' && V && V.fleets[1] ? shipCells(V.fleets[1]) : null;
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
            c.disabled = !(aimThem && V && V.turn === 0 && !missThem.has(k) && !K.hit.has(k));
        }
        root.querySelector('.bs-sea[data-side="0"]').classList.toggle('bs-live', aimMine);
        root.querySelector('.bs-sea[data-side="1"]').classList.toggle('bs-live', aimThem);
        root.querySelector('.bs-sea[data-side="1"]').classList.toggle('bs-dim', phase === 'place' || phase === 'ready');
        root.querySelector('.bs-sea[data-side="1"] .bs-cap').textContent = O ? O.oppName + "'s waters" : 'enemy waters';
        root.dataset.phase = phase;
        root.dataset.online = O ? '1' : '';
        if (V) {
            const theirsLeft = K.left;
            const mineLeft = myShips.filter(s => !S.cellsOf(s).every(([x, y]) => hitMe.has(key(x, y)))).map(s => s.len).sort((a, b) => b - a);
            infoEl.textContent = `${O ? O.oppName : 'enemy'} ships ${theirsLeft.join(' ') || '-'} · yours ${mineLeft.join(' ') || '-'}`;
        } else infoEl.textContent = phase === 'place' || phase === 'ready' ? 'fleet 5-4-3-3-2, no two ships touching' : '';
        tools();
    }
    function say(text, mine) {
        if (!msgEl) return;
        msgEl.textContent = text;
        msgEl.classList.toggle('bs-mine', !!mine);
    }

    function tools() {
        let html = '';
        if (O && (phase === 'place' || phase === 'ready')) {
            const them = O.theirCommit ? `<span class="bs-opp" data-ready="1">${esc(O.oppName)} is ready</span>` : `<span class="bs-opp" data-ready="0">${esc(O.oppName)} is placing...</span>`;
            html = phase === 'place'
                ? `<button class="bs-btn" data-act="random">shuffle fleet (n)</button>
                <button class="bs-btn" data-act="rotate"${picked < 0 ? ' disabled' : ''}>rotate (r)</button>
                ${them}<span class="bs-spacer"></span>
                <button class="bs-btn" data-act="leave">leave</button>
                <button class="bs-btn bs-go" data-act="ready">ready</button>`
                : `${them}<span class="bs-spacer"></span><button class="bs-btn" data-act="leave">leave</button>`;
        } else if (O && (phase === 'battle' || phase === 'over')) {
            html = `<button class="bs-btn" data-act="help">how to play</button><span class="bs-spacer"></span>
                <button class="bs-btn" data-act="leave">${phase === 'over' ? 'menu' : 'leave'}</button>
                ${phase === 'over' ? `<button class="bs-btn bs-go" data-act="rematch"${canRematch() ? '' : ' disabled'}>rematch</button>` : ''}`;
        } else if (phase === 'place') {
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
        leaveOnline(null, true);
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
                <button class="bs-btn" data-act="online">play online</button>
                ${savedBattle() ? '<button class="bs-btn" data-act="place">new fleet</button><button class="bs-btn bs-go" data-act="continue">continue battle</button>' : '<button class="bs-btn bs-go" data-act="place">place your fleet</button>'}
            </div>
            <p class="bs-note">${st.games ? `battles ${st.games}, won ${st.wins}${st.best ? ' · fewest shots to win ' + st.best : ''}` : 'no battles yet. the bot is already at sea, bradar'}${st.onlineGames ? `<br>online ${st.onlineGames}, won ${st.onlineWins}, lost ${st.onlineLosses}` : ''}</p>`);
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
                <li>online, each side keeps its own fleet and sends only a sealed fingerprint of it. at the end both fleets are shown and every answer is checked: <b>verified</b>, or <b>void</b> if somebody lied. leaving before that loses by forfeit.</li>
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
        if (won) { unlock('battleship_win'); if (G.level === 'hard') unlock('battleship_hard'); }
        phase = 'over';
        save();
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
        save();
    }
    // a closed window or a reload keeps the battle: the match is plain JSON
    function save() {
        if (phase === 'battle' && G && !S.over(G)) writeJson(SAVE_KEY, { g: G, last });
        else { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } }
    }
    function savedBattle() {
        const sv = readJson(SAVE_KEY);
        return sv && sv.g && sv.g.fleets && sv.g.shots && sv.g.winner === null && !S.fleetProblem(sv.g.fleets[0]) ? sv : null;
    }
    function resume() {
        const sv = savedBattle();
        if (!sv) { startPlacing(); return; }
        G = sv.g; fleet = G.fleets[0]; last = sv.last || [null, null];
        phase = 'battle'; picked = -1; cur = { x: 4, y: 4 };
        closeDialog();
        paint();
        if (G.turn === 1) { say('back at sea. the bot is aiming...'); botTimer = setTimeout(botTurn, 550 / speed); }
        else say('back at sea. your shot.', true);
    }
    function describe(r, who) {
        if (r.result === 'miss') return who + ' missed at ' + name(r.x, r.y) + '.';
        if (r.result === 'hit') return who + ' hit at ' + name(r.x, r.y) + '!';
        return who + ' sank a ' + r.len + ' at ' + name(r.x, r.y) + '!';
    }
    function fireAt(x, y) {
        if (O) { onlineFire(x, y); return; }
        if (phase !== 'battle' || !G || G.turn !== 0) return;
        const r = S.fire(G, x, y);
        if (r.result === 'invalid') { say('you already fired at ' + name(x, y) + '.'); return; }
        last[0] = { x, y };
        SFX[r.result]();
        if (S.over(G)) { paint(); showEnd(); return; }
        say(describe(r, 'you') + ' the bot is aiming...');
        paint();
        save();
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
        save();
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
            case 'place': try { localStorage.removeItem(SAVE_KEY); } catch (e) { } startPlacing(); break;     // a new fleet gives up the saved battle
            case 'continue': resume(); break;
            case 'random': fleet = S.randomFleet(Math.random); picked = -1; say('a fresh fleet. move ships or start the battle.', true); paint(); break;
            case 'rotate': rotate(); break;
            case 'battle': startBattle(); break;
            case 'help': showHelp(); break;
            case 'closehelp': if (helpBack === 'menu') showMenu(); else closeDialog(); break;
            case 'menu': showMenu(); break;
            case 'again': fleet = null; startPlacing(); break;
            case 'look': closeDialog(); break;
            case 'online': if (typeof openNetplay === 'function') openNetplay({ gameId: 'battleship' }); else if (window.Netplay) Netplay.openLobby({ gameId: 'battleship' }); break;
            case 'ready': onlineReady(); break;
            case 'leave': quitOnline(); break;
            case 'rematch': rematch(); break;
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
    // online: one on one through the lobby
    // ---------------------------------------------------------------
    const T = t => 'battleship:' + t;
    function startOnline(session, d) {
        mount();
        clearTimeout(botTimer); botTimer = 0;
        leaveOnline(session, false);
        G = null; last = [null, null];
        const slots = Array.isArray(d.slots) ? d.slots.slice(0, 2) : [];
        const me = slots.indexOf(session.id), oppId = slots[1 - me];
        const p = oppId && session.player(oppId);
        O = {
            session, me, oppId, oppName: String((p && p.name) || 'someone').slice(0, 16),
            seed: (d.seed >>> 0) || 1, mid: 0, unsubs: [], heard: false, hiTimer: 0
        };
        if (me < 0 || !oppId) { session.leave(); O = null; showMenu(); say('that lobby had nobody to play against.'); return; }
        const o = O;
        const on = (t, f) => o.unsubs.push(session.on(t, (m, from) => { if (O === o && from && from.id === o.oppId) f(m || {}); }));
        on(T('hi'), () => { o.heard = true; send('hello', {}); if (o.commit) send('ready', { c: o.commit }); });
        on(T('hello'), () => { o.heard = true; });
        on(T('ready'), gotReady);
        on(T('shot'), gotShot);
        on(T('answer'), gotAnswer);
        on(T('reveal'), gotReveal);
        on(T('verdict'), m => { if (m.m === o.mid && !o.theirVerdict && (m.v === 'verified' || m.v === 'void')) { o.theirVerdict = m.v; maybeAchieve(); refreshEnd(); } });
        on(T('rematch'), m => { if (m.m === o.mid + 1) { o.theirRematch = true; refreshEnd(); } });
        o.unsubs.push(session.on('player-leave', pl => { if (O === o && pl && pl.id === o.oppId) opponentLeft(); }));
        o.unsubs.push(session.on('closed', () => { if (O === o) opponentLeft(); }));
        // say hello until the other side answers: its window may still be loading
        const hi = () => { if (O !== o || o.heard || !o.session) { clearInterval(o.hiTimer); return; } send('hi', {}); };
        o.hiTimer = setInterval(hi, 1500);
        hi();
        newOnlineMatch(0);
        say((session.isHost ? 'you host. ' : 'connected. ') + 'place your fleet against ' + O.oppName + ', then ready.', true);
    }
    function send(t, data) {
        if (!O || !O.session || !O.session.alive) return;
        O.session.send(T(t), Object.assign({ m: O.mid }, data));
    }
    function newOnlineMatch(mid) {
        const o = O;
        const early = o.nextCommit && o.nextCommit.m === mid ? o.nextCommit.c : null;
        Object.assign(o, {
            mid, ships: null, salt: null, commit: null, theirCommit: early, nextCommit: null, d: null,
            theirReveal: null, theirShips: null, check: null, outcome: null, theirVerdict: null,
            theirRematch: false, recorded: false, achieved: false, lie: o.lie || 0
        });
        phase = 'place'; picked = -1; last = [null, null]; cur = { x: 0, y: 0 };
        fleet = S.randomFleet(Math.random);
        closeDialog();
        paint();
    }
    async function onlineReady() {
        const o = O;
        if (!o || phase !== 'place' || S.fleetProblem(fleet)) return;
        o.ships = fleet.map(s => ({ x: s.x, y: s.y, len: s.len, dir: s.dir }));
        o.salt = S.newSalt();
        phase = 'ready'; picked = -1;
        paint();
        say(o.theirCommit ? 'both ready.' : 'ready. waiting for ' + o.oppName + ' to place their fleet...', true);
        const mid = o.mid, c = await S.commitFleet(o.ships, o.salt);
        if (O !== o || o.mid !== mid) return;
        o.commit = c;
        send('ready', { c });
        maybeBegin();
    }
    function gotReady(m) {
        const o = O;
        if (typeof m.c !== 'string' || !/^[0-9a-f]{64}$/.test(m.c)) return;
        if (m.m === o.mid + 1) { o.nextCommit = { m: m.m, c: m.c }; return; }     // their rematch fleet, before mine
        if (m.m !== o.mid || o.theirCommit) return;     // a commitment is for keeps
        o.theirCommit = m.c;
        if (phase === 'ready' && !o.commit) say('both ready.', true);
        paint();
        maybeBegin();
    }
    function maybeBegin() {
        const o = O;
        if (!o || phase !== 'ready' || !o.commit || !o.theirCommit || o.d) return;
        const first = (o.seed + o.mid) % 2 === o.me;
        o.d = S.newDuel({ first });
        phase = 'battle'; cur = { x: 4, y: 4 };
        say(first ? 'battle! your shot first. pick a cell in ' + o.oppName + "'s waters." : 'battle! ' + o.oppName + ' fires first...', first);
        paint();
    }
    function onlineFire(x, y) {
        const o = O;
        if (phase !== 'battle' || !o.d) return;
        const r = S.aimShot(o.d, x, y);
        if (r.error) { if (r.error === 'already fired there') say('you already fired at ' + name(x, y) + '.'); return; }
        last[0] = { x, y };
        send('shot', r.msg);
        say('fired at ' + name(x, y) + '. waiting for the answer...');
        paint();
    }
    function gotShot(m) {
        const o = O;
        if (m.m !== o.mid || phase !== 'battle' || !o.d) return;
        const tamper = o.lie > 0 ? a => (a.result !== 'miss' ? (o.lie--, { result: 'miss' }) : a) : null;
        const r = S.takeShot(o.d, o.ships, { n: m.n, x: m.x, y: m.y }, tamper);
        if (r.error) return;
        send('answer', r.answer);
        last[1] = { x: m.x, y: m.y };
        if (r.answer.result !== 'miss') SFX[r.answer.result]();
        if (o.d.over) { finishOnline(); return; }
        say(describe(r.answer, o.oppName) + ' your shot.', true);
        paint();
    }
    function gotAnswer(m) {
        const o = O;
        if (m.m !== o.mid || phase !== 'battle' || !o.d) return;
        const r = S.takeAnswer(o.d, { n: m.n, x: m.x, y: m.y, result: m.result, len: m.len });
        if (r.error) return;
        SFX[r.answer.result]();
        if (o.d.over) { finishOnline(); return; }
        say(describe(r.answer, 'you') + ' ' + o.oppName + ' is aiming...');
        paint();
    }
    // the end of the shooting: show my fleet, wait for theirs
    function finishOnline() {
        const o = O;
        phase = 'over';
        send('reveal', { ships: o.ships, salt: o.salt });
        paint();
        say(o.d.over === 'me' ? 'their fleet is sunk. checking it...' : o.d.over === 'them' ? 'your fleet is gone. checking theirs...' : 'every cell fired at. checking...');
        showOnlineEnd();
        if (o.theirReveal) checkTheirs();
    }
    function gotReveal(m) {
        const o = O;
        if (m.m !== o.mid || o.theirReveal) return;
        o.theirReveal = { ships: m.ships, salt: m.salt };
        if (phase === 'over' && o.d && o.d.over) checkTheirs();
    }
    async function checkTheirs() {
        const o = O, mid = o.mid;
        const check = await S.checkReveal(o.d, o.theirCommit, o.theirReveal);
        if (O !== o || o.mid !== mid || o.outcome) return;
        o.check = check;
        if (check.ok) o.theirShips = o.theirReveal.ships.map(s => ({ x: s.x, y: s.y, len: s.len, dir: s.dir }));
        settleOnline(S.duelOutcome(o.d, { revealed: true, check }));
        send('verdict', { v: o.outcome.verdict });
    }
    function settleOnline(outcome) {
        const o = O;
        o.outcome = outcome;
        if (!o.recorded) {
            o.recorded = true;
            const st = stats();
            st.onlineGames++;
            if (outcome.winner === 'me') st.onlineWins++;
            else if (outcome.winner === 'them') st.onlineLosses++;
            writeJson(STATS_KEY, st);
            if (outcome.winner === 'me') SFX.win();
            else if (outcome.winner === 'them') SFX.lose();
        }
        maybeAchieve();
        phase = 'over';
        paint();
        const v = outcome.verdict;
        say(v === 'forfeit' ? o.oppName + ' left. you win by forfeit.' : v === 'void' ? 'the fleets do not add up. the match is void.' : outcome.winner === 'me' ? 'verified. you win!' : 'verified. ' + o.oppName + ' wins.', outcome.winner === 'me');
        showOnlineEnd();
    }
    // a verified win is one both sides checked: mine of their fleet, theirs of mine
    function maybeAchieve() {
        const o = O;
        if (o && !o.achieved && o.outcome && o.outcome.verdict === 'verified' && o.outcome.winner === 'me' && o.theirVerdict === 'verified') { o.achieved = true; unlock('battleship_online'); }
    }
    const canRematch = () => !!(O && O.session && O.session.alive && !O.gone && O.outcome);
    function showOnlineEnd() {
        const o = O;
        if (!o || !o.d && !o.outcome) return;
        const out = o.outcome, v = out ? out.verdict : 'checking';
        const who = esc(o.oppName);
        const d = o.d;
        const title = !out ? 'checking the fleets' : v === 'void' ? 'void' : v === 'forfeit' ? 'victory by forfeit' : out.winner === 'me' ? 'victory' : out.winner === 'them' ? 'defeat' : 'no winner';
        const sank = d && d.over === 'me' ? `you sank ${who}'s fleet in ${d.mine.length} shots.` : d && d.over === 'them' ? `${who} sank your fleet in ${d.theirs.length} shots.` : '';
        const line = v === 'checking' ? `waiting for ${who} to show their fleet, then every answer they gave is checked against it.`
            : v === 'verified' ? `${who}'s fleet is the one they sealed at the start, and every answer they gave was true.`
            : v === 'void' ? `${who}'s answers do not match their fleet: ${esc(o.check ? o.check.reason : 'nothing to check')}. the match does not count.`
            : `${who} left before showing their fleet. a hidden fleet can't be handed to a bot, so the match ends here and you win.`;
        const theirs = o.theirVerdict ? `<p class="bs-note">${who} checked yours: <b>${o.theirVerdict}</b>.</p>` : '';
        const again = o.gone ? `<p class="bs-note">${who} left the lobby.</p>` : o.theirRematch ? `<p class="bs-note">${who} wants a rematch.</p>` : '';
        dialog(title, `
            <div class="bs-online-end" data-verdict="${v}" data-winner="${out ? out.winner || '' : ''}">
            ${sank ? `<p><b>${sank}</b></p>` : ''}
            <p>fair-play check: <b class="bs-verdict">${v}</b>. ${line}</p>
            ${theirs}${again}
            </div>
            <div class="bs-actions"><button class="bs-btn" data-act="look">look at the seas</button><button class="bs-btn" data-act="menu">menu</button>${canRematch() ? '<button class="bs-btn bs-go" data-act="rematch">rematch</button>' : ''}</div>`);
    }
    // a late verdict or rematch request: redraw the end dialog if it is up
    function refreshEnd() {
        if (overEl && !overEl.hidden && overEl.querySelector('.bs-online-end')) showOnlineEnd();
        else if (phase === 'over') paint();
    }
    function rematch() {
        if (!canRematch()) return;
        newOnlineMatch(O.mid + 1);
        send('rematch', {});
        say('a new battle against ' + O.oppName + '. place your fleet, then ready.', true);
    }
    function opponentLeft() {
        const o = O;
        if (!o || o.gone) return;
        o.gone = true;
        dropSession(o, null);
        if (phase === 'place' || phase === 'ready') {
            phase = 'over';
            paint();
            say(o.oppName + ' left before the battle.');
            dialog('opponent left', `<p>${esc(o.oppName)} left before the battle started. nothing counts.</p>
                <div class="bs-actions"><button class="bs-btn bs-go" data-act="menu">menu</button></div>`);
        } else if (!o.theirReveal && !o.outcome) settleOnline(S.duelOutcome(o.d, { left: true }));
        else refreshEnd();
    }
    // the leave button, a closed window, the menu: walking out of a battle loses it
    function quitOnline() { showMenu(); }
    function dropSession(o, keep) {
        o.unsubs.forEach(f => { try { f(); } catch (e) { } });
        o.unsubs = [];
        clearInterval(o.hiTimer);
        if (o.session && o.session !== keep) { try { if (o.session.alive) o.session.leave(); } catch (e) { } }
        o.session = null;
    }
    function leaveOnline(keep, quitting) {
        const o = O;
        if (!o) return;
        if (quitting && !o.recorded && !o.gone && (phase === 'battle' || (phase === 'over' && !o.outcome))) {
            const st = stats(); st.onlineGames++; st.onlineLosses++; writeJson(STATS_KEY, st);
        }
        dropSession(o, keep);
        O = null;
    }

    // ---------------------------------------------------------------
    // the front door
    // ---------------------------------------------------------------
    window.startBattleship = function () {
        const fresh = mount();
        if (fresh) showMenu();
        return winRef && winRef.win;
    };
    function paintAvatar(canvas) {
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        c.fillStyle = '#1a3f8a'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#2f62c8'; c.lineWidth = Math.max(1, w / 40);
        for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(w * i / 4, 0); c.lineTo(w * i / 4, h); c.moveTo(0, h * i / 4); c.lineTo(w, h * i / 4); c.stroke(); }
        c.fillStyle = '#9a9a9a'; c.fillRect(w * 0.08, h * 0.3, w * 0.66, h * 0.18);
        c.fillStyle = '#c01818'; c.fillRect(w * 0.5, h * 0.3, w * 0.24, h * 0.18);
        c.fillStyle = '#e8eefc'; c.beginPath(); c.arc(w * 0.62, h * 0.75, w * 0.07, 0, Math.PI * 2); c.fill();
    }
    function register() {
        if (!window.Netplay || !Netplay.registerGame) return;
        Netplay.registerGame({
            id: 'battleship', name: 'battleship 98',
            start: (session, d) => startOnline(session, d || {}),
            startSolo: () => { mount(); showMenu(); },
            soloLabel: 'play the bot',
            paintAvatar
        });
    }
    register();

    // the test hook: what is going on, a faster bot, and online a hint and a liar
    window.BATTLESHIP_ENGINE = {
        phase: () => phase,
        state: () => G,
        fleet: () => (fleet ? fleet.map(s => Object.assign({}, s)) : null),
        speed: k => { speed = Math.max(0.25, +k || 1); },
        cell: (side, x, y) => boards[side] && boards[side].cells[x][y],
        register,
        online: () => (O ? JSON.parse(JSON.stringify({
            me: O.me, mid: O.mid, host: !!(O.session && O.session.isHost), oppName: O.oppName, ready: !!O.commit, theirReady: !!O.theirCommit,
            duel: O.d, outcome: O.outcome, theirVerdict: O.theirVerdict, gone: !!O.gone
        })) : null),
        // where the hard bot would fire next from this side's own shots
        hint: () => {
            if (!O || !O.d) return null;
            return S.botMove({ level: 'hard', turn: 0, shots: [O.d.mine, []], rs: (Math.random() * 4294967296) >>> 0 || 1 });
        },
        // answer the next k hits at this side's fleet with a miss (the cheating test)
        lie: k => { if (O) O.lie = +k || 0; }
    };
})();
