// Menus, input, sound and the shared Netplay transport. The host owns all match rules.
(function () {
    'use strict';
    const D = window.RIFT, S = window.RIFT_SIM, R = window.RIFT_RENDER;
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, k => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[k]);
    const PREF = 'mrhakan98-rift-prefs', RECORD = 'mrhakan98-rift-record';
    function read(k) { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (_) { return {}; } }
    function write(k, o) { try { localStorage.setItem(k, JSON.stringify(o)); } catch (_) { /* private browsing */ } }
    const pref = read(PREF);
    let selected = S.character(pref.character), mode = pref.mode === 2 ? 2 : 1;
    const arenas = {
        1: D.arenaFor(1, pref.arenas?.[1] ?? pref.arena).id,
        2: D.arenaFor(2, pref.arenas?.[2] ?? pref.arena).id
    };
    let muted = pref.muted !== false;
    let app, ui, canvas, renderer, winRef, frameId, timer, match = null, session = null, offs = [], screen = 'menu', overlay = null, pendingStart = 0;
    let menuState, soundContext, lobbyBusy = false, connectionToken = 0, gamepadPrevious = {};
    // The online room. `room` is the host's own copy and the only one that
    // changes; `view` is what every client, the host included, draws from.
    // `want` is this player's own choice, sent to the host as a whole.
    const ROOM = window.RIFT_ROOM, finished = new Set();
    let room = null, view = null, viewAt = 0, shownRev = -1, roomDirty = false, roomSentAt = 0, roomLast = 0;
    let want = { c: 0, r: false }, intentN = 0, intentAt = 0, intentDirty = false, intentTimer = 0, helloAt = 0;
    let welcomed = new Set(), matchOffs = [], resultTimer = 0, roomPad = null;
    let lastPadAt = 0, musicOn = pref.music !== false, musicRelease = null, musicTimer = 0, lastSong = '';
    const keys = new Set(), pad = new Set();
    let local = S.input();
    const coarse = () => matchMedia('(pointer: coarse)').matches;
    const save = () => write(PREF, { character: selected, mode, arenas, muted, music: musicOn });
    function stopMatchMusic() {
        clearTimeout(musicTimer); musicTimer = 0;
        if (musicRelease) musicRelease(); musicRelease = null;
    }
    function startMatchMusic() {
        stopMatchMusic();
        if (!musicOn || !match || typeof holdTrack !== 'function') return;
        const owner = match;
        function choose() {
            if (match !== owner || !musicOn) return;
            const songs = typeof tracks === 'undefined' ? [] : tracks.filter(t => typeof t.filename === 'string' && t.filename);
            if (!songs.length) { musicTimer = setTimeout(choose, 150); return; }
            const fresh = songs.filter(t => t.filename !== lastSong), pool = fresh.length ? fresh : songs;
            lastSong = pool[Math.floor(Math.random() * pool.length)].filename;
            musicRelease = holdTrack(lastSong);
        }
        choose();
    }
    function audioButtons() {
        return `<button type="button" class="rr-icon-btn" data-act="music" aria-pressed="${musicOn}">Music ${musicOn ? 'on' : 'off'}</button><button type="button" class="rr-icon-btn" data-act="sound" aria-pressed="${!muted}">Effects ${muted ? 'off' : 'on'}</button>`;
    }
    function tone(type) {
        if (muted || (typeof soundEnabled !== 'undefined' && !soundEnabled)) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            soundContext = soundContext || new AC(); soundContext.resume().catch(() => {});
            const o = soundContext.createOscillator(), g = soundContext.createGain(), t = soundContext.currentTime;
            const f = { jump: 380, hit: 180, ko: 100, go: 880, win: 660, swing: 260, dodge: 520, recover: 600 }[type] || 400;
            o.type = type === 'hit' || type === 'ko' ? 'sawtooth' : 'triangle';
            o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(type === 'ko' ? 35 : f * 1.6, t + 0.12);
            g.gain.setValueAtTime(0.045, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
            o.connect(g); g.connect(soundContext.destination); o.start(); o.stop(t + 0.2);
        } catch (_) { /* silent devices can still play */ }
    }
    function mount() {
        if (app && app.isConnected) return;
        if (!document.getElementById('rr-css')) {
            const l = document.createElement('link'); l.id = 'rr-css'; l.rel = 'stylesheet'; l.href = 'games/rift-rumble/rift-ui.css'; document.head.appendChild(l);
        }
        {
            winRef = createAppWindow('Brawlz 98', { icon: 'sports_esports', width: Math.min(1220, typeof viewportWidth === 'function' ? viewportWidth() - 20 : innerWidth - 20) });
            winRef.body.classList.add('rr-body'); app = document.createElement('div'); winRef.body.appendChild(app);
            winRef.win.style.top = '45px';
            winRef.win._cleanup = cleanup;
        }
        app.classList.add('rr-app');
        app.innerHTML = '<canvas class="rr-canvas" aria-label="Brawlz 98 arena: floating islands and pixel fighters"></canvas><div class="rr-ui"></div>';
        canvas = app.querySelector('canvas'); ui = app.querySelector('.rr-ui'); renderer = R.create(canvas);
        app.addEventListener('click', onClick);
        app.addEventListener('change', onChange);
        window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKey, true);
        window.addEventListener('blur', clearInput); document.addEventListener('visibilitychange', visibility);
        window.addEventListener('resize', onResize);
        app.addEventListener('pointerdown', onPointer); app.addEventListener('pointerup', onPointer); app.addEventListener('pointercancel', onPointer); app.addEventListener('lostpointercapture', onPointer);
        app.addEventListener('contextmenu', onContextMenu);
        timer = setInterval(tick, 1000 / 60); frameId = requestAnimationFrame(frame);
    }
    function cleanup() {
        pendingStart++;
        stopMatchMusic();
        connectionToken++; leave(); clearInterval(timer); clearInterval(resultTimer); cancelAnimationFrame(frameId);
        window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true);
        window.removeEventListener('blur', clearInput); document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('resize', onResize);
        if (soundContext) { soundContext.close().catch(() => {}); soundContext = null; }
        match = null; app = null; winRef = null; screen = 'menu';
    }
    function endMatchHandlers() { matchOffs.forEach(off => off()); matchOffs = []; }
    function unsubscribe() { endMatchHandlers(); offs.forEach(off => off()); offs = []; }
    function leave() {
        unsubscribe(); clearTimeout(intentTimer); intentTimer = 0;
        if (session && session.alive) session.leave();
        session = null; room = null; view = null;
    }
    function topbar() {
        return `<div class="rr-top"><div class="rr-brand"><span class="rr-mark">98</span> brawlz.exe</div><div class="rr-top-right"><span><i class="rr-online-dot"></i> 12 local problems. One desktop.</span>${audioButtons()}<button type="button" class="rr-icon-btn" data-act="help" aria-label="How to play">?</button></div></div>`;
    }
    function bottom() {
        return '<div class="rr-bottom"><div class="rr-keys"><span><kbd>A</kbd> <kbd>D</kbd> move</span><span><kbd>Space</kbd> jump ×2</span><span><kbd>E</kbd>/<kbd>LMB</kbd> light</span><span><kbd>F</kbd>/<kbd>RMB</kbd> heavy</span><span><kbd>R</kbd> special</span><span><kbd>Shift</kbd> dodge</span></div><button type="button" class="rr-link" data-act="help">How to play</button></div>';
    }
    function buildMenu() {
        pendingStart++;
        stopMatchMusic();
        clearInterval(resultTimer); resultTimer = 0;
        mount(); clearInput(); match = null; screen = 'menu'; overlay = null; renderer.reset();
        menuState = S.create({ arena: arenas[mode], mode }); menuState.events = [];
        menuState.players[0].character = selected; menuState.players[0].invuln = 0;
        menuState.players[0].grounded = true;
        menuState.players.length = 1;
        placePreview();
        ui.innerHTML = topbar() + RIFT_MENU(selected, mode, arenas[mode]) + bottom();
        paintPortraits();
    }
    function placePreview() {
        const stage = D.arenaFor(mode, arenas[mode]);
        menuState.arena = stage.id;
        menuState.players[0].x = (stage.width || D.W) / 2 + 30;
        menuState.players[0].y = stage.platforms[0].y;
    }
    function paintPortraits() {
        ui.querySelectorAll('.rr-char canvas').forEach((cv, i) => { const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); R.sprite(c, 54, 94, i, { scale: 82 / RIFT_ANIM.height(i) }); });
        const head = ui.querySelector('.rr-selected-name canvas'); if (head) RIFT_ART.portrait(head.getContext('2d'), selected);
        paintCards();
    }
    // The big fighter on each player card. The two sides face each other.
    function paintCards() {
        ui.querySelectorAll('.rr-card canvas').forEach(cv => {
            const c = cv.getContext('2d'), n = +cv.dataset.pick, coral = cv.closest('.rr-card').dataset.team === '1';
            c.clearRect(0, 0, cv.width, cv.height);
            R.sprite(c, cv.width / 2, cv.height * 0.96, n, { scale: cv.height * 0.86 / RIFT_ANIM.height(n), facing: coral ? -1 : 1 });
        });
    }
    function showHelp() {
        clearInput();
        const wasPaused = match && match.paused;
        if (match && !session) match.paused = true;
        dialog(`<h2>Stay on the island.</h2><p>Deal damage to launch rivals farther. Knock them out of the arena three times to win. In 2v2, the last surviving team wins. Teammates cannot hurt each other.</p><div class="rr-help"><span>Move</span><span><kbd>A</kbd> <kbd>D</kbd> or arrow keys</span><span>Double jump</span><span><kbd>Space</kbd> / <kbd>W</kbd> / <kbd>↑</kbd></span><span>Light / heavy</span><span><kbd>E</kbd> / <kbd>F</kbd> or left / right click</span><span>Special</span><span><kbd>R</kbd> · hold <kbd>W</kbd> for recovery</span><span>Dodge / drop</span><span><kbd>Shift</kbd> / <kbd>S</kbd></span><span>Gamepad</span><span>Stick · A jump · X light · Y heavy · B special · RB dodge</span></div><p>Hold up or down to aim attacks. Two jumps and an upward special can save a fall. Land to regain them. Lower total damage wins a stock tie at 3:00.</p><button type="button" class="rr-primary" data-act="close-help">Got it. Let's rumble.</button>`);
        overlay.dataset.wasPaused = wasPaused ? '1' : '0';
    }
    function dialog(html) {
        if (overlay) overlay.remove();
        overlay = document.createElement('div'); overlay.className = 'rr-overlay';
        overlay.innerHTML = '<section class="rr-dialog" role="dialog" aria-modal="true" aria-label="Brawlz 98">' + html + '</section>';
        ui.appendChild(overlay); overlay.querySelector('button')?.focus();
    }
    function status(text, error = false) {
        const el = ui.querySelector('.rr-status'); if (el) { el.textContent = text; el.classList.toggle('rr-error', error); }
    }
    function setProfile() {
        const p = Netplay.profile();
        Netplay.setAvatar(Object.assign({}, p.avatar && typeof p.avatar === 'object' ? p.avatar : {}, { rift: selected }));
    }
    // The way in: a name, a connection and either a new room or a friend's code.
    function lobby() {
        screen = 'lobby'; clearInput();
        ui.innerHTML = `${topbar()}<section class="rr-panel rr-lobby">
            <h2>A good rivalry starts here.</h2>
            <label class="rr-label" for="rr-name">Your name</label>
            <input id="rr-name" maxlength="16" value="${esc(Netplay.profile().name)}" autocomplete="nickname">
            <label class="rr-label" for="rr-transport" style="margin-top:14px">Connection</label>
            <select id="rr-transport" class="rr-select">
                <option value="auto">Internet · automatic</option>
                <option value="peer">Internet · direct WebRTC</option>
                <option value="relay">My WebSocket relay</option>
                <option value="local">Two tabs · same browser</option>
            </select>
            <input id="rr-relay" aria-label="WebSocket relay URL" placeholder="wss://your-relay.example" value="${esc(Netplay.relayUrl())}" hidden>
            <button type="button" class="rr-primary" data-act="host">Create a room</button>
            <div class="rr-lobby-row" style="margin-top:17px">
                <input id="rr-code" aria-label="Room code" placeholder="Room code" maxlength="5" autocomplete="off" style="text-transform:uppercase">
                <button type="button" class="rr-secondary" data-act="join" style="width:100px;margin:0">Join</button>
            </div>
            <p class="rr-status" role="status" aria-live="polite">Everyone picks a fighter together in the room. Empty seats get bots.</p>
            <button type="button" class="rr-link" data-act="menu">Back to fighters</button>
        </section>${bottom()}`;
        const q = new URLSearchParams(location.search), code = q.get('room');
        if (code) {
            ui.querySelector('#rr-code').value = code.replace(/[^a-z0-9]/gi, '').slice(0, 5);
            if (q.get('connection') === 'local') ui.querySelector('#rr-transport').value = 'local';
        }
    }
    async function connect(host) {
        if (lobbyBusy) return;
        const code = ui.querySelector('#rr-code')?.value || '';
        if (!host && code.replace(/[^a-z0-9]/gi, '').length < 4) return status('Enter the 5-character code from your friend.', true);
        lobbyBusy = true; const token = ++connectionToken;
        const buttons = () => ui.querySelectorAll('[data-act=host],[data-act=join]');
        buttons().forEach(b => b.disabled = true);
        Netplay.setName(ui.querySelector('#rr-name').value); setProfile();
        const transport = ui.querySelector('#rr-transport').value;
        if (transport === 'relay') Netplay.setRelayUrl(ui.querySelector('#rr-relay').value.trim());
        status(host ? 'Opening your room…' : 'Looking for your room…');
        try {
            const s = host ? await Netplay.host(transport, 'riftrumble', undefined, m => status(m)) : await Netplay.join(transport, code, m => status(m));
            if (token !== connectionToken || screen !== 'lobby') { s.leave(); return; }
            if (host) s.gameOptions = { mode: String(mode), arena: arenas[mode] };
            enterRoom(s);
        } catch (e) { status(e.message + '. Check the code or try another connection.', true); }
        finally { lobbyBusy = false; buttons().forEach(b => b.disabled = false); }
    }

    // ---- the room: lobby and character select are one screen ----
    // Everyone lands here, whichever door they came through: this game's own
    // "Play with friends", the desktop's multiplayer lobby, an invite link.
    // They stay here between matches, with the same room code.
    const hostId = () => session?.players.find(p => p.host)?.id;
    const mySeat = () => (view && session ? view.seats.find(p => p.id === session.id) || null : null);
    function enterRoom(s) {
        if (session === s && ['room', 'play', 'loading'].includes(screen)) return;
        mount();
        if (session && session !== s) leave();
        unsubscribe(); pendingStart++; stopMatchMusic(); clearInterval(resultTimer); resultTimer = 0;
        session = s; match = null; room = null; view = null; shownRev = -1;
        want = { c: selected, r: false }; intentN = 0; intentDirty = false; helloAt = 0; roomLast = performance.now();
        // a desktop lobby window closing must not take this room with it
        const started = s.state === 'playing'; s.state = 'playing';
        offs.push(
            s.on('net:error', m => status(m, true)),
            s.on('net:down', () => {
                if (screen !== 'room' || overlay) return;
                dialog('<h2>Connection lost.</h2><p>The host left or stopped responding. Leave the room and create or join a new one.</p><button type="button" class="rr-primary" data-act="menu">Back to fighters</button>');
                overlay.dataset.connectionLost = '1';
            }),
            s.on('net:up', () => { if (screen === 'room' && overlay?.dataset.connectionLost) resume(); })
        );
        if (s.isHost) {
            const o = s.gameOptions || {};
            room = ROOM.create({ host: s.id, mode: o.mode, arena: o.arena, seed: Math.floor(Math.random() * 1e9) });
            // players the desktop lobby already sent here need no second invitation
            welcomed = new Set(started ? s.players.map(p => p.id) : []);
            offs.push(
                s.on('roster', reconcile), s.on('player-leave', reconcile),
                s.on('rr:intent', (d, from) => {
                    if (!room || !from || !s.player(from.id)) return;
                    if (!ROOM.seat(room, from.id)) reconcile();
                    ROOM.intent(room, from.id, d); publish();
                }),
                s.on('rr:hi', (d, from) => {
                    if (!room || !from || !s.player(from.id)) return;
                    reconcile();
                    s.send('rr:room', ROOM.view(room), from.id);
                    // somebody who missed the start of the match they are in
                    if (match && room.phase === 'match' && ROOM.seat(room, from.id)?.playing) s.send('rr:start', match.opts, from.id);
                })
            );
            reconcile();
            ROOM.intent(room, s.id, { n: ++intentN, c: selected, r: false });
            publish();
        } else {
            offs.push(s.on('rr:room', onRoomView), s.on('rr:start', onRoomStart), s.on('game-pick', () => {
                if (!s.gameId || s.gameId === 'riftrumble') return;
                leave(); lobby(); status('That room is playing a different game. Try another code.', true);
            }));
        }
        showRoom();
        if (!s.isHost) sendIntent(true);
    }
    // Host: seats follow the session's roster, in both directions.
    function reconcile() {
        if (!room || !session) return;
        const s = session;
        for (const p of s.players) {
            ROOM.join(room, p.id, p.name, S.character(p.avatar?.rift), s.teamOf(p));
            if (p.me || welcomed.has(p.id)) continue;
            // Someone who joined through the desktop lobby is still looking at
            // it. Its own start message is what brings them to this screen.
            welcomed.add(p.id); s.send('np:start', { gameId: 'riftrumble' }, p.id);
        }
        for (const seat of room.seats.slice()) if (!s.player(seat.id)) ROOM.leave(room, seat.id);
        publish();
    }
    // Host: redraw from the room and mark it for sending. Sending is paced.
    function publish() {
        if (!room || !session || room.rev === shownRev) return;
        const next = ROOM.read(ROOM.view(room));
        if (!next) return;
        shownRev = room.rev; view = next; viewAt = performance.now(); roomDirty = true;
        const me = ROOM.seat(room, session.id);
        if (me) { want.c = me.pick; want.r = me.ready; }
        paintRoom();
    }
    function flushRoom(force) {
        if (!room || !session) return;
        const now = performance.now();
        if (!force && !(roomDirty && now - roomSentAt >= (slowWire() ? 250 : 100)) && now - roomSentAt < 2000) return;
        roomDirty = false; roomSentAt = now;
        session.send('rr:room', ROOM.view(room));
    }
    function launch() {
        const m = ROOM.begin(room, Math.floor(Math.random() * 1e9), Date.now());
        if (!m) return;
        publish(); flushRoom(true);
        session.send('rr:start', m);
        local = S.input(); start(session, m);
    }
    // Guest: the host's room, and the host's word that a match begins.
    function onRoomView(d, from) {
        if (room || !session || !from || from.id !== hostId()) return;
        const next = ROOM.read(d);
        if (!next || (view && next.rev <= view.rev)) return;
        view = next; viewAt = performance.now();
        const me = mySeat();
        // the host has answered our latest wish, so its answer is the truth
        if (me && !intentDirty && me.n >= intentN) { want.c = me.pick; want.r = me.ready; }
        if (match && !match.saved && next.last && next.last.match === match.id) finish(next.last);
        paintRoom();
    }
    function onRoomStart(d, from) {
        if (room || !session || !from || from.id !== hostId()) return;
        const m = ROOM.readStart(d);
        if (!m || finished.has(m.match) || (match && match.id === m.match)) return;
        if (!m.people.some(p => p.id === session.id && !p.bot)) return;
        clearInterval(resultTimer); resultTimer = 0;
        local = S.input(); start(session, m);
    }
    // Guest: send the whole wish, at most a few times a second.
    function sendIntent(force) {
        if (!session || room) return;
        clearTimeout(intentTimer); intentTimer = 0;
        const now = performance.now(), gap = slowWire() ? 300 : 120;
        if (!force && now - intentAt < gap) {
            intentDirty = true; intentTimer = setTimeout(() => sendIntent(true), gap - (now - intentAt));
            return;
        }
        intentDirty = false; intentAt = now;
        const msg = { n: ++intentN, c: want.c, r: want.r };
        if (want.t === 0 || want.t === 1) msg.t = want.t;
        delete want.t;
        session.sendToHost('rr:intent', msg);
    }
    function wish(change) {
        if (!session) return;
        Object.assign(want, change);
        if (room) {
            ROOM.intent(room, session.id, Object.assign({ n: ++intentN }, want));
            delete want.t; publish();
        } else { sendIntent(); paintRoom(); }
    }
    function pick(n) {
        if (want.r || n === want.c || S.character(n) !== n) return;
        selected = n; save(); wish({ c: n });
    }
    function setReady(value) {
        const me = mySeat();
        if (!me || me.team === -1 || view.phase === 'match') return;
        const r = value === undefined ? !want.r : value;
        if (r === want.r) return;
        wish({ r }); tone(r ? 'go' : 'dodge');
    }
    function switchSide() {
        const me = mySeat();
        if (!me || me.team === -1 || want.r || view.phase === 'match') return;
        const t = 1 - me.team;
        if (view.seats.filter(p => p.team === t).length < view.mode) wish({ t });
    }
    function hostSet(kind, value) {
        if (!room || !session) return;
        const id = session.id;
        const done = kind === 'mode' ? ROOM.setMode(room, id, value) : kind === 'arena' ? ROOM.setArena(room, id, value) : ROOM.rerollBot(room, id, value);
        if (!done) return;
        if (kind === 'mode') ROOM.setArena(room, id, arenas[room.mode]);
        if (kind !== 'bot') {
            mode = room.mode; arenas[mode] = room.arena; save();
            // the desktop lobby and the open lobby list read these
            session.setOption('mode', String(room.mode)); session.setOption('arena', room.arena);
        }
        publish();
    }
    // Runs every tick while in a room, during a match as well: the host keeps
    // late arrivals informed, a guest notices what the network dropped.
    function roomTick() {
        if (!session) return;
        const now = performance.now(), elapsed = now - roomLast; roomLast = now;
        if (room) {
            if (ROOM.tick(room, elapsed)) { launch(); return; }
            flushRoom();
        } else if (now - helloAt > 1500) {
            const me = mySeat();
            const unheard = !!me && me.n < intentN && !intentDirty && now - intentAt > 1500;
            const missedStart = !!me && me.playing && view.phase === 'match' && !match && screen === 'room';
            if (!me || missedStart) { helloAt = now; session.sendToHost('rr:hi', {}); }
            if (!me || unheard) { helloAt = now; sendIntent(true); }
        }
        if (screen === 'room') { paintCount(); pollRoomPad(); }
    }
    function showRoom() {
        clearInput(); screen = 'room'; overlay = null; roomPad = null; renderer.reset();
        menuState = S.create({ arena: view ? view.arena : arenas[mode], mode: view ? view.mode : mode });
        menuState.events = []; menuState.players.length = 0;
        ui.innerHTML = topbar() + RIFT_MENU.room(session.code);
        paintPortraits(); paintRoom();
        ui.querySelector('.rr-char[data-fighter="' + want.c + '"]')?.focus({ preventScroll: true });
    }
    // Replace a piece of the screen only when it changed, and keep the keyboard where it was.
    function swap(el, html) {
        if (!el || el._rrHtml === html) return false;
        const key = el.contains(document.activeElement) ? document.activeElement.dataset.key : null;
        el.innerHTML = html; el._rrHtml = html;
        if (key) el.querySelector('[data-key="' + key + '"]')?.focus({ preventScroll: true });
        return true;
    }
    function roomStatus(me) {
        if (!view) return 'Joining the room…';
        if (!me) return 'Taking a seat…';
        if (view.phase === 'match') return 'A match is being played. You are in for the next one; pick a fighter while you wait.';
        if (me.team === -1) return 'Both seats of this 1v1 are taken. You are next in line.';
        if (view.phase === 'countdown') return 'Everyone is ready. The match is starting.';
        if (!want.r) return 'Pick a fighter, then ready up. The match starts when everyone is ready.';
        const waiting = view.seats.filter(p => p.team !== -1 && !p.ready && p.id !== me.id).map(p => p.name);
        return waiting.length ? 'Waiting for ' + waiting.join(', ') + ' to ready up.' : 'Ready.';
    }
    function paintRoom() {
        if (screen !== 'room' || !session || !ui) return;
        const el = ui.querySelector('.rr-room'); if (!el) return;
        const me = mySeat(), mine = { id: session.id, pick: want.c, ready: want.r };
        if (view && menuState && menuState.arena !== view.arena) menuState.arena = view.arena;
        swap(el.querySelector('#rr-room-rules'), view ? RIFT_MENU.rules(view, !!room, view.phase !== 'select' || want.r) : '');
        if (swap(el.querySelector('#rr-cards'), view ? RIFT_MENU.cards(view, mine, !!room) : '')) paintCards();
        const bench = el.querySelector('#rr-bench'), waiting = view ? RIFT_MENU.bench(view) : '';
        if (bench.textContent !== waiting) bench.textContent = waiting;
        bench.hidden = !waiting;
        el.classList.toggle('rr-room-locked', want.r);
        el.querySelectorAll('.rr-char').forEach((b, i) => {
            b.setAttribute('aria-pressed', String(i === want.c));
            b.setAttribute('aria-disabled', String(want.r));
            swap(b.querySelector('.rr-tokens'), view ? RIFT_MENU.tokens(view, mine, i) : '');
        });
        const ready = el.querySelector('.rr-ready'), open = !!me && me.team !== -1 && view.phase !== 'match';
        const label = want.r ? 'Cancel ready' : 'Ready!';
        const hint = !open ? (me && view.phase === 'match' ? 'Match in progress' : 'Waiting for a seat') : want.r ? 'Unlock to change fighter' : 'Lock in ' + D.FIGHTERS[want.c].name;
        swap(ready, label + ' <small>' + esc(hint) + '</small>');
        ready.disabled = !open; ready.setAttribute('aria-pressed', String(want.r));
        const text = roomStatus(me), line = el.querySelector('.rr-room-foot .rr-status');
        if (line.textContent !== text) { line.textContent = text; line.classList.remove('rr-error'); }
        paintCount();
    }
    // The last three seconds, counted locally from what the host said was left.
    function paintCount() {
        const el = ui?.querySelector('.rr-room-count'); if (!el) return;
        const left = view && view.phase === 'countdown' ? String(Math.max(1, Math.ceil((view.count - (performance.now() - viewAt)) / 1000))) : '';
        if (el.textContent !== left) el.textContent = left;
    }
    // Arrow keys and the d-pad walk the fighter grid, whatever shape it wrapped into.
    function movePick(dx, dy) {
        const chars = [...ui.querySelectorAll('.rr-room .rr-char')];
        if (want.r || !chars.length) return false;
        const columns = chars.filter(b => b.offsetTop === chars[0].offsetTop).length;
        let next = want.c;
        if (dx) next = (want.c + dx + chars.length) % chars.length;
        else {
            if (columns >= chars.length) return false;
            next = want.c + dy * columns;
            if (next < 0 || next >= chars.length) return true;
        }
        pick(next); chars[next].focus({ preventScroll: true });
        return true;
    }
    function roomKey(e) {
        const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.code];
        if (move) return movePick(move[0], move[1]);
        // Enter on a fighter (or on nothing) readies up; on any other button it presses that button
        if (e.code === 'Enter' && !e.repeat && !e.target.closest?.('button:not(.rr-char),a')) { setReady(); return true; }
        return false;
    }
    // Gamepad: stick or d-pad picks, A is ready, B takes it back, Y switches side.
    function pollRoomPad() {
        if (overlay || !focused() || !navigator.getGamepads) return;
        const gamepad = [...navigator.getGamepads()].find(Boolean);
        if (!gamepad) { roomPad = null; return; }
        const pressed = i => !!gamepad.buttons[i]?.pressed;
        const now = {
            left: gamepad.axes[0] < -0.5 || pressed(14), right: gamepad.axes[0] > 0.5 || pressed(15),
            up: gamepad.axes[1] < -0.5 || pressed(12), down: gamepad.axes[1] > 0.5 || pressed(13),
            ready: pressed(0), back: pressed(1), side: pressed(3)
        };
        // a button still held from the match that just ended must be let go first
        const before = roomPad || now, hit = k => now[k] && !before[k];
        roomPad = now;
        if (hit('left')) movePick(-1, 0);
        if (hit('right')) movePick(1, 0);
        if (hit('up')) movePick(0, -1);
        if (hit('down')) movePick(0, 1);
        if (hit('ready')) setReady(true);
        if (hit('back')) setReady(false);
        if (hit('side')) switchSide();
    }
    // Back from a match to the same room, with the same code and the same people.
    function toRoom() {
        clearInterval(resultTimer); resultTimer = 0;
        if (!session) return buildMenu();
        endMatchHandlers(); stopMatchMusic(); match = null;
        showRoom();
    }
    function startSolo() {
        leave();
        start(null, { seed: Math.floor(Math.random() * 1e9), at: Date.now(), options: { mode: String(mode), arena: arenas[mode] }, people: [{ id: 'you', name: 'You', character: selected, team: 0 }] });
    }
    function start(s, opts = {}) {
        if (!RIFT_ART.ready()) {
            mount(); session = s; screen = 'loading';
            ui.innerHTML = topbar() + '<div class="rr-loading" role="status" aria-live="polite">Getting your fighters ready…</div>';
            const attempt = ++pendingStart;
            RIFT_ART.whenReady().then(() => {
                if (app && pendingStart === attempt && (!s || s.alive)) start(s, opts);
            }).catch(e => { if (app && pendingStart === attempt) { leave(); buildMenu(); dialog('<h2>Fighters could not load.</h2><p>' + esc(e.message) + '</p><button type="button" class="rr-primary" data-act="menu">Back to fighters</button>'); } });
            return;
        }
        // a room's own handlers outlive the match; only practice drops everything
        mount(); if (s) endMatchHandlers(); else unsubscribe();
        clearInterval(resultTimer); resultTimer = 0; clearInput();
        session = s; overlay = null; screen = 'play'; renderer.reset();
        const options = opts.options || {}, teamSize = options.mode === '2' || options.mode === 2 ? 2 : 1;
        const people = opts.people || (opts.slots || s?.players.map(p => p.id) || []).map((id, i) => {
            const p = s.player(id) || {};
            return { id, name: p.name, character: S.character(p.avatar?.rift), team: opts.teams?.[id] === 1 ? 1 : opts.teams?.[id] === 0 ? 0 : i % 2 };
        });
        const state = S.create({ mode: teamSize, arena: options.arena, seed: opts.seed, people });
        match = { s: state, id: opts.match || String(opts.at) + ':' + opts.seed, me: s ? s.id : 'you', host: !s || s.isHost, last: performance.now(), acc: 0, sendAt: 0, inputAt: 0, hudAt: 0, rxAt: performance.now(), soundId: 0, paused: false, netDown: false, saved: false, previous: null, snapAt: 0, inputSeq: 0, lastSeq: {}, opts };
        ui.innerHTML = `<div class="rr-match-hud"><div class="rr-hud-team" id="rr-hud-0"></div><div class="rr-clock" aria-label="Match time">3:00</div><div class="rr-hud-team" id="rr-hud-1"></div></div><div class="rr-count" aria-live="polite"></div><div class="rr-match-tools"><button type="button" class="rr-icon-btn" data-act="pause">${s ? 'Menu' : 'Pause'}</button><button type="button" class="rr-icon-btn" data-act="help" aria-label="How to play">?</button>${audioButtons()}</div><div class="rr-net-status"></div>${coarse() ? touchHTML() : ''}`;
        if (s) {
            const hostId = s.players.find(p => p.host)?.id;
            matchOffs.push(s.on('rr:input', (d, from) => {
                if (!match?.host || !from || !d || d.match !== match.id) return;
                if (!Number.isSafeInteger(d.seq) || d.seq <= (match.lastSeq[from.id] || 0)) return;
                const p = match.s.players.find(p => p.id === from.id && !p.bot);
                if (p) { S.setInput(match.s, p.slot, d.input); match.lastSeq[from.id] = d.seq; }
            }), s.on('rr:state', (d, from) => {
                if (!match || match.host || from?.id !== hostId || d?.match !== match.id || !validSnapshot(d.state) || d.state.tick < match.s.tick) return;
                match.previous = match.s; match.s = d.state; match.rxAt = performance.now(); match.snapAt = match.rxAt; match.netDown = false;
                if (overlay?.dataset.connectionLost) resume();
            }), s.on('rr:sync', (d, from) => { if (match?.host && from && d?.match === match.id) sendSnapshot(from.id); }), s.on('player-leave', p => {
                if (!match?.host) return; const fighter = match.s.players.find(q => q.id === p.id); if (fighter) fighter.bot = true;
            }), s.on('net:down', () => { if (match && !match.host) { match.netDown = true; clearInput(); } }), s.on('closed', () => {
                if (match && !match.host) match.netDown = true;
            }));
            if (!match.host) s.sendToHost('rr:sync', { match: match.id });
            else sendSnapshot();
        }
        startMatchMusic(); paintHud();
    }
    function validSnapshot(v) {
        return !!v && v.version === 1 && Number.isSafeInteger(v.tick) && ['countdown', 'fight', 'over'].includes(v.phase) && Array.isArray(v.players) && v.players.length === match.s.players.length && v.arena === match.s.arena && v.mode === match.s.mode && Array.isArray(v.shots) && v.shots.length <= 32 && Array.isArray(v.events) && v.events.length <= 20 && v.players.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.vx) && Number.isFinite(p.vy) && Number.isFinite(p.damage) && Number.isInteger(p.character) && p.character >= 0 && p.character < D.FIGHTERS.length && (p.team === 0 || p.team === 1) && Number.isInteger(p.stocks) && p.stocks >= 0 && p.stocks <= 3);
    }
    function sendSnapshot(to) { if (session && match?.host) session.send('rr:state', { match: match.id, state: S.snapshot(match.s) }, to); }
    function slowWire() { return session && (session.mode === 'bus' || (session.mode === 'auto' && session.transport?.kind === 'bus')); }
    function sendInput(force = false) {
        if (!match || match.host || !session) return;
        const now = performance.now(); if (!force && now - match.inputAt < (slowWire() ? 120 : 45)) return;
        match.inputAt = now; session.sendToHost('rr:input', { match: match.id, seq: ++match.inputSeq, input: local });
    }
    function tick() {
        roomTick();
        if (!match) return;
        if (!focused() && (keys.size || pad.size || local.left || local.right || local.up || local.down)) clearInput();
        pollGamepad();
        const now = performance.now(), elapsed = Math.min(0.12, (now - match.last) / 1000); match.last = now;
        if (match.paused || (!session && document.hidden) || match.netDown) return;
        if (match.host) {
            match.acc += elapsed;
            while (match.acc >= 1 / 60) {
                const p = match.s.players.find(p => p.id === match.me); if (p) S.setInput(match.s, p.slot, local);
                // Retain one physics sample for render interpolation. Drawing
                // only the latest 60 Hz position judders on faster displays.
                match.drawPrevious = match.s.players.map(p => ({ x: p.x, y: p.y, travel: p.travel, stocks: p.stocks, respawn: p.respawn }));
                S.step(match.s); match.acc -= 1 / 60;
            }
            if (session && now - match.sendAt > (slowWire() ? 130 : 50)) { sendSnapshot(); match.sendAt = now; }
        } else {
            sendInput();
            if (!match.saved && now - match.rxAt > 1800 && now - match.sendAt > 1000) { session.sendToHost('rr:sync', { match: match.id }); match.sendAt = now; }
        }
        for (const e of match.s.events) if (e.id > match.soundId) { tone(e.type); match.soundId = e.id; }
        if (match.s.phase === 'over' && !match.saved) finish();
    }
    let fitAt = 0, portraitsReady = false;
    function onResize() { fitAt = 0; if (app) app.style.height = ''; }
    function fitStage(now) {
        if (!app || now - fitAt < 250) return;
        fitAt = now;
        if (winRef && coarse() && typeof enterFauxFullscreen === 'function') {
            // a landscape phone has no room for a window frame, in a match or in the room before it
            const land = innerWidth > innerHeight, win = winRef.win, wide = screen === 'play' || screen === 'room';
            if (win._rrLand !== land) { win._rrLand = land; win._rrDeclined = false; }
            if (win._rrAutoFs && !win.classList.contains('fs-active')) { win._rrAutoFs = false; win._rrDeclined = true; }
            if (land && wide && !win._rrDeclined && !win.classList.contains('fs-active')) { enterFauxFullscreen(win); win._rrAutoFs = true; }
            else if ((!land || !wide) && win._rrAutoFs && typeof fauxFullscreenWin !== 'undefined' && fauxFullscreenWin === win) { win._rrAutoFs = false; exitFauxFullscreen(); }
        }
        const rect = app.getBoundingClientRect(), zoom = app.clientWidth ? rect.width / app.clientWidth : 1;
        let available = (document.documentElement.clientHeight - rect.top - 37) / (zoom || 1);
        if (winRef && Number.isFinite(parseFloat(getComputedStyle(winRef.win).maxHeight))) {
            const body = winRef.body, style = getComputedStyle(body);
            const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
            available = Math.min(available, body.getBoundingClientRect().height / (zoom || 1) - borders);
            body.scrollTop = 0;
        }
        app.style.height = Math.max(180, Math.min(760, available)) + 'px';
        if (window.RIFT_ART && RIFT_ART.ready() && !portraitsReady) {
            portraitsReady = true;
            paintPortraits();
        }
    }
    function frame(now) {
        if (!app) return;
        frameId = requestAnimationFrame(frame);
        if (document.hidden || !app.getClientRects().length) return;
        fitStage(now);
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (match) {
            // Draw between host physics samples; remote local movement is
            // extrapolated for at most 80 ms. Never interpolate a respawn.
            let state = match.s;
            if (match.host && match.drawPrevious && !match.paused) {
                const blend = Math.min(1, match.acc * 60);
                state = Object.assign({}, state, { players: state.players.map((p, i) => {
                    const old = match.drawPrevious[i];
                    if (!old || old.stocks !== p.stocks || old.respawn || p.respawn || Math.abs(old.x - p.x) > 100 || Math.abs(old.y - p.y) > 100) return p;
                    return Object.assign({}, p, { x: old.x + (p.x - old.x) * blend, y: old.y + (p.y - old.y) * blend, travel: old.travel + (p.travel - old.travel) * blend });
                }) });
            }
            if (!match.host && match.previous && !match.netDown) {
                state = Object.assign({}, state, { players: state.players.map((p, i) => {
                    const old = match.previous.players[i], blend = Math.min(1, (now - match.snapAt) / 50);
                    if (!old || Math.abs(old.x - p.x) > 150 || old.stocks !== p.stocks) return p;
                    const me = p.id === match.me, lead = me ? Math.min(0.08, (now - match.snapAt) / 1000) * 60 : 0;
                    const attack = p.attack ? Object.assign({}, p.attack, { age: Math.min(D.attackFor(p.character, p.attack.kind, p.attack.dir).duration, p.attack.age + Math.min(3, (now - match.snapAt) * 0.06)) }) : null;
                    const travel = me ? p.travel + Math.abs(Number(local.right) - Number(local.left)) * D.FIGHTERS[p.character].speed * lead : old.travel + (p.travel - old.travel) * blend;
                    return Object.assign({}, p, { x: me ? p.x + (Number(local.right) - Number(local.left)) * D.FIGHTERS[p.character].speed * lead : old.x + (p.x - old.x) * blend, y: old.y + (p.y - old.y) * blend, travel, attack });
                }) });
            }
            const clock = match.host ? state.tick + match.acc * 60 : state.tick + Math.min(3, Math.max(0, now - match.snapAt) * 0.06);
            renderer.draw(state, now / 1000, { me: match.me, reduced, clock, paused: match.paused || match.netDown });
            if (now - match.hudAt > 100) { paintHud(); match.hudAt = now; }
        } else if (menuState) renderer.draw(menuState, now / 1000, { menu: true, reduced });
    }
    function paintHud() {
        if (!match) return;
        const s = match.s;
        for (const team of [0, 1]) {
            const el = ui.querySelector('#rr-hud-' + team);
            if (!el) continue;
            el.innerHTML = s.players.filter(p => p.team === team).map(p => `<div class="rr-seat ${p.stocks ? '' : 'rr-eliminated'}" data-team="${team}"><div class="rr-seat-name">${esc(p.id === match.me ? 'You · ' + D.FIGHTERS[p.character].name : p.name + (p.bot ? ' CPU' : ''))}</div><strong style="color:${p.damage > 120 ? '#ffae95' : p.damage > 70 ? '#ffe0a0' : '#fff4df'}">${Math.floor(p.damage)}<span>%</span></strong><div class="rr-stocks" aria-label="${p.stocks} stocks">${'◆'.repeat(p.stocks)}${'◇'.repeat(3 - p.stocks)}</div></div>`).join('');
        }
        const seconds = Math.max(0, Math.ceil(s.remaining / 60));
        ui.querySelector('.rr-clock').textContent = s.sudden ? 'Sudden' : Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        const count = ui.querySelector('.rr-count'), text = s.phase === 'countdown' ? String(Math.max(1, Math.ceil(s.count / 60))) : s.tick < 225 ? 'RUMBLE!' : '';
        if (count.textContent !== text) count.textContent = text;
        const el = ui.querySelector('.rr-net-status');
        if (match.netDown) {
            el.textContent = 'Host connection lost';
            if (!overlay) {
                dialog('<h2>Connection lost.</h2><p>The host left or stopped responding. Leave the match and create or join a new room.</p><button type="button" class="rr-primary" data-act="menu">Back to fighters</button>');
                overlay.dataset.connectionLost = '1';
            }
        } else el.textContent = session ? (performance.now() - match.rxAt > 1800 && !match.host ? 'Waiting for host…' : session.mode === 'local' ? 'Two-tab match' : match.host ? 'Online · hosting' : 'Online · ' + Math.round(session.players.find(p => p.host)?.ping || 0) + ' ms') : 'Practice · bots fill the arena';
    }
    function resultOf(m) {
        return {
            match: m.id, winner: m.s.winner === 1 ? 1 : 0,
            rows: m.s.players.map(p => ({ id: p.id, name: p.name, team: p.team, pick: p.character, kos: p.kos, dealt: p.dealt, bot: p.bot }))
        };
    }
    // `result` is the host's own summary when it reaches a guest before the last snapshot does.
    function finish(result) {
        match.saved = true; finished.add(match.id); clearInput();
        const res = result || resultOf(match), mine = res.rows.find(p => p.id === match.me), won = !!mine && mine.team === res.winner;
        const record = read(RECORD); record.matches = (Number(record.matches) || 0) + 1; record.wins = (Number(record.wins) || 0) + Number(won); write(RECORD, record);
        const title = `<h2>${won ? 'The rift is yours.' : 'One more round?'}</h2>`, team = RIFT_MENU.TEAMS[res.winner];
        const rows = `<div class="rr-results">${res.rows.map(p => `<div class="rr-result" data-team="${p.team}">
            <span>${esc(p.name)}${p.id === match.me ? ' (you)' : ''}${p.bot ? ' · CPU' : ''}</span>
            <span>${p.kos} KO · ${Math.round(p.dealt)} damage</span>
        </div>`).join('')}</div>`;
        if (!session) {
            dialog(`${title}<p>${team} team wins. A fresh arena. A fresh chance.</p>${rows}
                <button type="button" class="rr-primary" data-act="rematch">Run it back</button>
                <button type="button" class="rr-secondary" data-act="menu">Back to fighters</button>`);
            return;
        }
        if (room) { ROOM.finish(room, res); publish(); flushRoom(true); }
        // a short look at the result, then everybody is back at character select
        let left = 6;
        dialog(`${title}<p>${team} team wins. Back to character select in <b class="rr-back">${left}</b>…</p>${rows}
            <button type="button" class="rr-primary" data-act="room">Back to character select</button>
            <button type="button" class="rr-secondary" data-act="menu">Leave room</button>`);
        clearInterval(resultTimer);
        resultTimer = setInterval(() => {
            const el = overlay?.querySelector('.rr-back');
            if (--left <= 0 || !el) toRoom(); else el.textContent = left;
        }, 1000);
    }
    function touchHTML() {
        return '<div class="rr-touch"><div class="rr-touch-group"><button type="button" data-control="left" aria-label="Move left">◀</button><button type="button" data-control="right" aria-label="Move right">▶</button><button type="button" data-control="down" aria-label="Drop down">↓</button></div><div class="rr-touch-group"><button type="button" data-control="up" aria-label="Aim up">↑</button><button type="button" data-control="dodge" aria-label="Dodge">⤳</button><button type="button" data-control="light" aria-label="Light attack">E</button><button type="button" data-control="heavy" aria-label="Heavy attack">F</button><button type="button" data-control="special" aria-label="Special attack">R</button><button type="button" data-control="jump" aria-label="Jump">↑↑</button></div></div>';
    }
    const keyControls = { KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyS: 'down', ArrowDown: 'down', KeyW: 'up', ArrowUp: 'up', Space: 'jump', KeyE: 'light', KeyF: 'heavy', KeyR: 'special', ShiftLeft: 'dodge', ShiftRight: 'dodge' };
    function focused() {
        if (!winRef) return true;
        const win = winRef.win, z = Number(win.style.zIndex) || 0;
        return win.style.display !== 'none' && ![...document.querySelectorAll('.app-window,.ie-window')].some(w => w !== win && w.style.display !== 'none' && (Number(w.style.zIndex) || 0) > z);
    }
    function controls() {
        for (const k of ['left', 'right', 'up', 'down']) local[k] = pad.has(k) || [...keys].some(code => keyControls[code] === k);
        sendInput(true);
    }
    function action(k) { if (S.ACTIONS.includes(k)) local[k]++; }
    function clearInput() { keys.clear(); pad.clear(); for (const k of ['left', 'right', 'up', 'down']) local[k] = false; sendInput(true); }
    function onKey(e) {
        if (overlay && e.type === 'keydown' && focused()) {
            if (e.code === 'Tab') {
                const buttons = [...overlay.querySelectorAll('button,a,input,select')];
                const first = buttons[0], last = buttons[buttons.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
                return;
            }
            if (e.code === 'Escape' && overlay.querySelector('[data-act=close-help]')) { e.preventDefault(); e.stopImmediatePropagation(); overlay.querySelector('[data-act=close-help]').click(); return; }
        }
        if (!focused() || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
        if (screen === 'room' && e.type === 'keydown' && !overlay && roomKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
        if (screen !== 'play' || !match) return;
        if (e.code === 'Escape' && e.type === 'keydown' && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); pause(); return; }
        const k = keyControls[e.code]; if (!k || overlay) return;
        e.preventDefault(); e.stopPropagation();
        if (e.type === 'keydown') {
            if (!keys.has(e.code)) { keys.add(e.code); action(k); if (k === 'up') action('jump'); }
        } else keys.delete(e.code);
        controls();
    }
    function arenaInput(e) {
        return screen === 'play' && match && !match.paused && !overlay &&
            !e.target.closest('button,a,input,textarea,select,[data-control],.rr-match-tools,.rr-touch');
    }
    function onContextMenu(e) {
        if (screen !== 'play' || !match) return;
        e.preventDefault();
        e.stopPropagation();
    }
    function onPointer(e) {
        if (screen !== 'play' || !match || match.paused || overlay) return;
        const b = e.target.closest('[data-control]');
        if (!b) {
            if (e.type === 'pointerdown' && e.pointerType === 'mouse' && arenaInput(e) && (e.button === 0 || e.button === 2)) {
                // Let the desktop's mousedown handler bring this window forward.
                action(e.button === 0 ? 'light' : 'heavy'); controls();
            }
            return;
        }
        if (e.type === 'pointerdown' && e.button !== 0) return;
        e.preventDefault(); const k = b.dataset.control;
        if (e.type === 'pointerdown') { b.setPointerCapture(e.pointerId); pad.add(k); action(k); }
        else pad.delete(k);
        controls();
    }
    function pollGamepad() {
        if (overlay || !focused() || !navigator.getGamepads) return;
        const gamepad = [...navigator.getGamepads()].find(Boolean);
        if (!gamepad) { if (lastPadAt && performance.now() - lastPadAt < 100) { pad.clear(); controls(); } return; }
        lastPadAt = performance.now();
        const pressed = i => !!gamepad.buttons[i]?.pressed;
        const values = { left: gamepad.axes[0] < -0.3 || pressed(14), right: gamepad.axes[0] > 0.3 || pressed(15), up: gamepad.axes[1] < -0.5 || pressed(12), down: gamepad.axes[1] > 0.5 || pressed(13), jump: pressed(0), light: pressed(2), heavy: pressed(3), special: pressed(1), dodge: pressed(5) || pressed(4) };
        let changed = false;
        for (const [k, value] of Object.entries(values)) {
            if (value !== !!gamepadPrevious[k]) { changed = true; if (value) { pad.add(k); action(k); } else pad.delete(k); }
        }
        if (pressed(9) && !gamepadPrevious.pause) pause();
        gamepadPrevious = Object.assign(values, { pause: pressed(9) }); if (changed) controls();
    }
    function visibility() { clearInput(); if (!session && match && document.hidden && !overlay && match.s.phase !== 'over') pause(); }
    function pause() {
        if (!match || match.s.phase === 'over') return;
        if (overlay) { if (overlay.querySelector('[data-act=resume]')) resume(); return; }
        clearInput(); if (!session) match.paused = true;
        dialog(`<h2>${session ? 'Still in the fight.' : 'Take a breather.'}</h2><p>${session ? 'The online match continues while this menu is open.' : 'Your match is paused. The clouds can wait.'}</p><button type="button" class="rr-primary" data-act="resume">Keep fighting</button><button type="button" class="rr-secondary" data-act="menu">${session ? 'Leave room' : 'Leave match'}</button>`);
    }
    function resume() { if (overlay) overlay.remove(); overlay = null; if (match) { match.paused = false; match.last = performance.now(); } clearInput(); }
    function onChange(e) {
        if (e.target.id === 'rr-arena') { arenas[mode] = D.arenaFor(mode, e.target.value).id; save(); placePreview(); }
        if (e.target.id === 'rr-room-arena') hostSet('arena', e.target.value);
        if (e.target.id === 'rr-transport') ui.querySelector('#rr-relay').hidden = e.target.value !== 'relay';
    }
    async function onClick(e) {
        const fighter = e.target.closest('[data-fighter]'), modeBtn = e.target.closest('[data-mode]');
        const roomMode = e.target.closest('[data-room-mode]');
        if (roomMode) { hostSet('mode', +roomMode.dataset.roomMode); return; }
        if (fighter && screen === 'room') { pick(+fighter.dataset.fighter); return; }
        if (fighter) { selected = +fighter.dataset.fighter; save(); setProfile(); buildMenu(); ui.querySelector('[data-fighter="' + selected + '"]').focus({ preventScroll: true }); return; }
        if (modeBtn) { mode = +modeBtn.dataset.mode; save(); buildMenu(); ui.querySelector('[data-mode="' + mode + '"]').focus({ preventScroll: true }); return; }
        const b = e.target.closest('[data-act]'); if (!b) return;
        switch (b.dataset.act) {
            case 'solo': local = S.input(); startSolo(); break;
            case 'online': lobby(); break;
            case 'host': await connect(true); break;
            case 'join': await connect(false); break;
            case 'ready': setReady(); break;
            case 'team': switchSide(); break;
            case 'bot': hostSet('bot', +b.dataset.bot); break;
            case 'room': toRoom(); break;
            case 'copy': {
                const url = new URL(location.pathname, location.origin); url.searchParams.set('app', 'brawlz'); url.searchParams.set('room', session.code);
                if (session.mode === 'local') url.searchParams.set('connection', 'local');
                try { await navigator.clipboard.writeText(url.href); b.textContent = 'Invite copied'; } catch (_) { status('Share this code: ' + session.code); }
                break;
            }
            case 'menu': connectionToken++; lobbyBusy = false; leave(); buildMenu(); break;
            case 'help': showHelp(); break;
            case 'close-help': { const paused = overlay?.dataset.wasPaused === '1'; resume(); if (match) match.paused = paused; break; }
            case 'pause': pause(); break;
            case 'resume': resume(); break;
            case 'rematch': local = S.input(); if (!session) startSolo(); break;
            case 'sound': muted = !muted; save(); b.textContent = muted ? 'Effects off' : 'Effects on'; b.setAttribute('aria-pressed', String(!muted)); if (!muted) tone('go'); break;
            case 'music': musicOn = !musicOn; save(); b.textContent = musicOn ? 'Music on' : 'Music off'; b.setAttribute('aria-pressed', String(musicOn)); if (musicOn) startMatchMusic(); else stopMatchMusic(); break;
        }
    }
    window.startRiftRumble = function () { mount(); if (!match && screen !== 'lobby' && screen !== 'room') { buildMenu(); if (new URLSearchParams(location.search).get('room')) lobby(); } };
    Netplay.registerGame({ id: 'riftrumble', name: 'Brawlz 98', start: s => enterRoom(s), startSolo, soloLabel: 'Practice with bots', paintAvatar: cv => { const c = cv.getContext('2d'); c.fillStyle = '#243760'; c.fillRect(0, 0, cv.width, cv.height); R.sprite(c, cv.width / 2, cv.height * 0.92, selected, { scale: cv.height * .84 / RIFT_ANIM.height(selected) }); } });
    // Read-only diagnostics used by the browser suite; rules remain in RIFT_SIM.
    window.RIFT_ENGINE = { state: () => match, screen: () => screen, record: () => read(RECORD), room: () => view, want: () => want };
})();
