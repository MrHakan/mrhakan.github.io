// blastz 98: the window, menus, input, sound and the shared Netplay transport.
// The rules are in blastz-sim.js and the host runs them; guests draw snapshots.
(function () {
    'use strict';
    const D = window.BLASTZ, S = window.BLASTZ_SIM, R = window.BLASTZ_RENDER, ROOM = window.BLASTZ_ROOM, F = window.RIFT;
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, k => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[k]);
    const PREF = 'mrhakan98-blastz-prefs', META = 'mrhakan98-blastz-meta';
    function read(k) { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (_) { return {}; } }
    function write(k, o) { try { localStorage.setItem(k, JSON.stringify(o)); } catch (_) { /* private browsing */ } }
    const pref = read(PREF);
    const fighterOk = n => Number.isInteger(n) && n >= 0 && n < D.FIGHTERS;
    // one pick and one perk per local player; P1 is also the online pick
    const picks = [0, 1, 2, 3].map(i => fighterOk(pref.picks?.[i]) ? pref.picks[i] : [0, 5, 2, 7][i]);
    const perks = [0, 1, 2, 3].map(i => D.perk(pref.perks?.[i]));
    const setup = { map: D.map(pref.map).id, lives: D.lives(pref.lives), teams: pref.teams === true, count: D.count(pref.count || 4), humans: Math.max(1, Math.min(4, pref.humans || 1)) };
    let tab = 0, muted = pref.muted !== false, musicOn = pref.music !== false;
    const save = () => write(PREF, { picks, perks, map: setup.map, lives: setup.lives, teams: setup.teams, count: setup.count, humans: setup.humans, muted, music: musicOn });

    let app, ui, canvas, renderer, winRef, frameId, timer, match = null, session = null, offs = [], screen = 'menu', overlay = null, pendingStart = 0;
    let soundContext, lobbyBusy = false, connectionToken = 0, menuState = null, musicRelease = null, musicTimer = 0, lastSong = '';
    // the online room, as in Brawlz 98: the host owns `room`, everyone draws `view`
    const finished = new Set();
    let room = null, view = null, viewAt = 0, shownRev = -1, roomDirty = false, roomSentAt = 0, roomLast = 0;
    let want = { c: picks[0], p: perks[0], r: false }, intentN = 0, intentAt = 0, intentDirty = false, intentTimer = 0, helloAt = 0;
    let welcomed = new Set(), matchOffs = [], resultTimer = 0;
    const keys = new Set(), touch = new Set();
    let locals = [S.input(), S.input(), S.input(), S.input()], padPrev = [];
    const coarse = () => matchMedia('(pointer: coarse)').matches;
    const fighterName = n => F.FIGHTERS[n]?.name || 'fighter';

    // ---- sound: small synthesized blips, off until asked for ----
    function tone(type) {
        if (muted || (typeof soundEnabled !== 'undefined' && !soundEnabled)) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            soundContext = soundContext || new AC(); soundContext.resume().catch(() => {});
            const o = soundContext.createOscillator(), g = soundContext.createGain(), t = soundContext.currentTime;
            const f = { shot: 520, hit: 210, ko: 110, boom: 70, jump: 380, pick: 760, go: 880, empty: 300, block: 990 }[type] || 400;
            o.type = type === 'boom' || type === 'ko' || type === 'hit' ? 'sawtooth' : type === 'shot' ? 'square' : 'triangle';
            o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(type === 'boom' || type === 'ko' ? 30 : f * (type === 'shot' ? 0.5 : 1.6), t + (type === 'boom' ? 0.3 : 0.1));
            const v = type === 'shot' ? 0.018 : 0.045;
            g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (type === 'boom' ? 0.35 : 0.14));
            o.connect(g); g.connect(soundContext.destination); o.start(); o.stop(t + 0.4);
        } catch (_) { /* a silent device can still play */ }
    }
    function stopMusic() { clearTimeout(musicTimer); musicTimer = 0; if (musicRelease) musicRelease(); musicRelease = null; }
    function startMusic() {
        stopMusic();
        if (!musicOn || !match || typeof holdTrack !== 'function') return;
        const owner = match;
        (function choose() {
            if (match !== owner || !musicOn) return;
            const songs = typeof tracks === 'undefined' ? [] : tracks.filter(t => typeof t.filename === 'string' && t.filename);
            if (!songs.length) { musicTimer = setTimeout(choose, 150); return; }
            const fresh = songs.filter(t => t.filename !== lastSong), pool = fresh.length ? fresh : songs;
            lastSong = pool[Math.floor(Math.random() * pool.length)].filename;
            musicRelease = holdTrack(lastSong);
        })();
    }
    const audioButtons = () => `<button type="button" class="bz-btn" data-act="music" aria-pressed="${musicOn}">music ${musicOn ? 'on' : 'off'}</button><button type="button" class="bz-btn" data-act="sound" aria-pressed="${!muted}">effects ${muted ? 'off' : 'on'}</button>`;

    // ---- the window ----
    function mount() {
        if (app && app.isConnected) return;
        if (!document.getElementById('bz-css')) {
            const l = document.createElement('link'); l.id = 'bz-css'; l.rel = 'stylesheet'; l.href = 'games/blastz/blastz.css'; document.head.appendChild(l);
        }
        winRef = createAppWindow('blastz 98', { icon: 'celebration', width: Math.min(1220, typeof viewportWidth === 'function' ? viewportWidth() - 20 : innerWidth - 20) });
        winRef.body.classList.add('bz-body'); app = document.createElement('div'); winRef.body.appendChild(app);
        winRef.win.style.top = '45px'; winRef.win._cleanup = cleanup;
        app.className = 'bz-app';
        app.innerHTML = '<canvas class="bz-canvas" aria-label="blastz 98 arena"></canvas><div class="bz-ui"></div>';
        canvas = app.querySelector('canvas'); ui = app.querySelector('.bz-ui'); renderer = R.create(canvas);
        app.addEventListener('click', onClick); app.addEventListener('change', onChange);
        window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKey, true);
        window.addEventListener('blur', clearInput); document.addEventListener('visibilitychange', visibility);
        window.addEventListener('resize', onResize);
        app.addEventListener('pointerdown', onPointer); app.addEventListener('pointerup', onPointer); app.addEventListener('pointercancel', onPointer); app.addEventListener('lostpointercapture', onPointer);
        app.addEventListener('contextmenu', e => { if (screen === 'play') { e.preventDefault(); e.stopPropagation(); } });
        timer = setInterval(tick, 1000 / 60); frameId = requestAnimationFrame(frame);
        if (typeof unlockAchievement === 'function') { try { unlockAchievement('blastz'); } catch (_) { } }
    }
    function cleanup() {
        pendingStart++; stopMusic(); connectionToken++; leave();
        clearInterval(timer); clearInterval(resultTimer); cancelAnimationFrame(frameId);
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
    const topbar = () => `<div class="bz-top"><div class="bz-brand"><b>blastz</b><span>98</span></div><div class="bz-top-right">${audioButtons()}<button type="button" class="bz-btn" data-act="help" aria-label="How to play">?</button></div></div>`;
    function dialog(html) {
        if (overlay) overlay.remove();
        overlay = document.createElement('div'); overlay.className = 'bz-overlay';
        overlay.innerHTML = '<section class="bz-dialog" role="dialog" aria-modal="true" aria-label="blastz 98">' + html + '</section>';
        ui.appendChild(overlay); overlay.querySelector('button')?.focus();
    }
    function status(text, error = false) {
        const el = ui.querySelector('.bz-status'); if (el) { el.textContent = text; el.classList.toggle('bz-error', error); }
    }
    const helpHTML = () => `<h2>push them off the map.</h2><p>Nobody has health. Every bullet shoves whoever it hits, and every shot kicks you back a little too. Fall off the map and you lose a life; the last one with lives left wins.</p>
        <div class="bz-help"><span>one player</span><span><kbd>A</kbd><kbd>D</kbd> or arrows move · <kbd>W</kbd>/<kbd>Space</kbd> jump (twice) · <kbd>S</kbd> drop · <kbd>F</kbd>/<kbd>J</kbd>/click fire · <kbd>G</kbd>/<kbd>K</kbd>/right click bomb</span>
        <span>two on one keyboard</span><span>P1 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> + <kbd>F</kbd> fire, <kbd>G</kbd> bomb · P2 arrows + <kbd>K</kbd> fire, <kbd>L</kbd> bomb (or numpad 1 / 2)</span>
        <span>gamepads</span><span>one per player: stick moves, A jumps, X or RT fires, B or RB throws a bomb</span></div>
        <p>Crates fall from the sky: <b>?</b> is a gun, <b>★</b> is a firewall, more bombs or a turbo button. Guns run out; then you are back to the pea shooter. After three minutes everything pushes harder.</p>
        <button type="button" class="bz-primary" data-act="close-help">got it</button>`;
    function showHelp() {
        clearInput();
        const was = match && match.paused;
        if (match && !session) match.paused = true;
        dialog(helpHTML()); overlay.dataset.wasPaused = was ? '1' : '0';
    }

    // ---- the main menu: fighters, perks and the match for this computer ----
    function buildMenu() {
        pendingStart++; stopMusic(); clearInterval(resultTimer); resultTimer = 0;
        mount(); clearInput(); match = null; screen = 'menu'; overlay = null; renderer.reset();
        tab = Math.min(tab, setup.humans - 1);
        menuState = preview(setup.map);
        const opt = (act, value, current, text) => `<button type="button" class="bz-opt" data-act="${act}" data-v="${value}" aria-pressed="${String(value) === String(current)}">${text}</button>`;
        ui.innerHTML = topbar() + `<div class="bz-menu">
            <section class="bz-side" aria-label="Your fighter">
                ${setup.humans > 1 ? `<div class="bz-tabs" role="tablist">${[0, 1, 2, 3].slice(0, setup.humans).map(i => `<button type="button" role="tab" data-act="tab" data-v="${i}" aria-selected="${i === tab}" style="--c:${D.COLORS[i]}">P${i + 1}</button>`).join('')}</div>` : ''}
                <div class="bz-me"><canvas width="160" height="150" aria-hidden="true"></canvas><div><span>${setup.humans > 1 ? 'player ' + (tab + 1) : 'your fighter'}</span><h2>${esc(fighterName(picks[tab]))}</h2><p>${esc(F.FIGHTERS[picks[tab]].tip)}</p></div></div>
                <h3>perk</h3><div class="bz-perks">${D.PERKS.map(p => `<button type="button" class="bz-perk" data-perk="${p.id}" aria-pressed="${perks[tab] === p.id}"><b>${p.name}</b><small>${p.blurb}</small></button>`).join('')}</div>
            </section>
            <section class="bz-roster" aria-label="Fighters"><div class="bz-grid">${F.FIGHTERS.map((f, i) => `<button type="button" class="bz-char" data-fighter="${i}" aria-pressed="${picks[tab] === i}" aria-label="${esc(f.name)}"><canvas width="96" height="84"></canvas><span>${esc(f.name)}</span><em>${[0, 1, 2, 3].slice(0, setup.humans).filter(j => picks[j] === i).map(j => `<i style="--c:${D.COLORS[j]}">P${j + 1}</i>`).join('')}</em></button>`).join('')}</div></section>
            <section class="bz-setup" aria-label="Match">
                <span class="bz-label">players here</span><div class="bz-opts">${[1, 2, 3, 4].map(n => opt('humans', n, setup.humans, n)).join('')}</div>
                <span class="bz-label">fighters in the match</span><div class="bz-opts">${[2, 3, 4].map(n => opt('count', n, setup.count, n)).join('')}</div>
                <span class="bz-label">mode</span><div class="bz-opts">${opt('teams', 0, setup.teams ? 1 : 0, 'free for all')}${opt('teams', 1, setup.teams ? 1 : 0, 'two teams')}</div>
                <span class="bz-label">lives</span><div class="bz-opts">${D.LIVES.map(n => opt('lives', n, setup.lives, n)).join('')}</div>
                <label class="bz-label" for="bz-map">map</label><select id="bz-map" class="bz-select">${D.MAPS.map(m => `<option value="${m.id}"${m.id === setup.map ? ' selected' : ''}>${esc(m.name)} · ${esc(m.blurb)}</option>`).join('')}</select>
                <button type="button" class="bz-primary" data-act="solo">blast! <small>${setup.humans > 1 ? setup.humans + ' players here' : 'you'}${setup.count > setup.humans ? ' + ' + (setup.count - setup.humans) + ' bot' + (setup.count - setup.humans > 1 ? 's' : '') : ''}</small></button>
                <button type="button" class="bz-secondary" data-act="online">play online <small>2–4 players, bots fill in</small></button>
                <p class="bz-note">${setup.humans > 2 ? 'players 3 and 4 need a gamepad each.' : setup.humans === 2 ? 'P1 on WASD + F/G, P2 on the arrows + K/L.' : 'A/D move, W jump, F fire, G bomb.'}</p>
            </section>
        </div>`;
        paintPortraits();
    }
    function preview(mapId) {
        const s = S.create({ map: mapId, count: 2, people: [{ id: 'you', character: picks[tab] }], seed: 3 });
        s.players.length = 1; s.phase = 'fight';
        const main = D.map(mapId).platforms[0]; Object.assign(s.players[0], { x: main.x + main.w / 2, y: main.y, grounded: true });
        return s;
    }
    function paintPortraits() {
        if (!window.RIFT_ART || !RIFT_ART.ready()) return;
        ui.querySelectorAll('.bz-char canvas').forEach((cv, i) => {
            const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height);
            R.sprite(c, cv.width / 2, cv.height * 0.95, i, { scale: cv.height * 0.8 / RIFT_ANIM.height(i), weapon: 0 });
        });
        const me = ui.querySelector('.bz-me canvas');
        if (me) { const c = me.getContext('2d'); c.clearRect(0, 0, me.width, me.height); R.sprite(c, me.width / 2 - 10, me.height * 0.95, picks[tab], { scale: me.height * 0.82 / RIFT_ANIM.height(picks[tab]), weapon: 6 }); }
        paintCards();
    }
    function paintCards() {
        if (!window.RIFT_ART || !RIFT_ART.ready()) return;
        ui.querySelectorAll('.bz-card canvas').forEach(cv => {
            const c = cv.getContext('2d'), n = +cv.dataset.pick; c.clearRect(0, 0, cv.width, cv.height);
            R.sprite(c, cv.width / 2 - 8, cv.height * 0.95, n, { scale: cv.height * 0.8 / RIFT_ANIM.height(n), weapon: 6 });
        });
    }

    // ---- online: a name, a connection, a room ----
    function setProfile() {
        const p = Netplay.profile();
        Netplay.setAvatar(Object.assign({}, p.avatar && typeof p.avatar === 'object' ? p.avatar : {}, { blastz: picks[0] }));
    }
    function lobby() {
        screen = 'lobby'; clearInput();
        ui.innerHTML = `${topbar()}<section class="bz-panel bz-lobby">
            <h2>bring a friend. or three.</h2>
            <label class="bz-label" for="bz-name">your name</label>
            <input id="bz-name" maxlength="16" value="${esc(Netplay.profile().name)}" autocomplete="nickname">
            <label class="bz-label" for="bz-transport">connection</label>
            <select id="bz-transport" class="bz-select">
                <option value="auto">internet · automatic</option>
                <option value="peer">internet · direct WebRTC</option>
                <option value="relay">my WebSocket relay</option>
                <option value="local">two tabs · same browser</option>
            </select>
            <input id="bz-relay" aria-label="WebSocket relay URL" placeholder="wss://your-relay.example" value="${esc(Netplay.relayUrl())}" hidden>
            <button type="button" class="bz-primary" data-act="host">create a room</button>
            <div class="bz-row"><input id="bz-code" aria-label="Room code" placeholder="room code" maxlength="5" autocomplete="off"><button type="button" class="bz-secondary" data-act="join">join</button></div>
            <p class="bz-status" role="status" aria-live="polite">everyone picks a fighter and a perk in the room. empty seats get bots.</p>
            <button type="button" class="bz-link" data-act="menu">back</button>
        </section>`;
        const q = new URLSearchParams(location.search), code = q.get('room');
        if (code) {
            ui.querySelector('#bz-code').value = code.replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase();
            if (q.get('connection') === 'local') ui.querySelector('#bz-transport').value = 'local';
        }
    }
    async function connect(host) {
        if (lobbyBusy) return;
        const code = ui.querySelector('#bz-code')?.value || '';
        if (!host && code.replace(/[^a-z0-9]/gi, '').length < 4) return status('enter the 5-character code from your friend.', true);
        lobbyBusy = true; const token = ++connectionToken;
        const buttons = () => ui.querySelectorAll('[data-act=host],[data-act=join]');
        buttons().forEach(b => b.disabled = true);
        Netplay.setName(ui.querySelector('#bz-name').value); setProfile();
        const transport = ui.querySelector('#bz-transport').value;
        if (transport === 'relay') Netplay.setRelayUrl(ui.querySelector('#bz-relay').value.trim());
        status(host ? 'opening your room…' : 'looking for your room…');
        try {
            const s = host ? await Netplay.host(transport, 'blastz', undefined, m => status(m)) : await Netplay.join(transport, code, m => status(m));
            if (token !== connectionToken || screen !== 'lobby') { s.leave(); return; }
            if (host) s.gameOptions = { map: setup.map, lives: String(setup.lives), mode: setup.teams ? 'teams' : 'ffa', count: String(setup.count) };
            enterRoom(s);
        } catch (e) { status(e.message + '. check the code or try another connection.', true); }
        finally { lobbyBusy = false; buttons().forEach(b => b.disabled = false); }
    }

    // ---- the room: lobby and character select on one screen ----
    const hostId = () => session?.players.find(p => p.host)?.id;
    const mySeat = () => (view && session ? view.seats.find(p => p.id === session.id) || null : null);
    function enterRoom(s) {
        if (session === s && ['room', 'play', 'loading'].includes(screen)) return;
        mount();
        if (session && session !== s) leave();
        unsubscribe(); pendingStart++; stopMusic(); clearInterval(resultTimer); resultTimer = 0;
        session = s; match = null; room = null; view = null; shownRev = -1;
        want = { c: picks[0], p: perks[0], r: false }; intentN = 0; intentDirty = false; helloAt = 0; roomLast = performance.now();
        const started = s.state === 'playing'; s.state = 'playing';
        offs.push(
            s.on('net:error', m => status(m, true)),
            s.on('net:down', () => {
                if (screen !== 'room' || overlay) return;
                dialog('<h2>connection lost.</h2><p>The host left or stopped answering. Leave the room and make or join a new one.</p><button type="button" class="bz-primary" data-act="menu">back to the menu</button>');
                overlay.dataset.connectionLost = '1';
            }),
            s.on('net:up', () => { if (screen === 'room' && overlay?.dataset.connectionLost) resume(); })
        );
        if (s.isHost) {
            const o = s.gameOptions || {};
            room = ROOM.create({ host: s.id, map: o.map, lives: o.lives, teams: o.mode === 'teams', count: o.count || 4, seed: Math.floor(Math.random() * 1e9) });
            welcomed = new Set(started ? s.players.map(p => p.id) : []);
            offs.push(
                s.on('roster', reconcile), s.on('player-leave', reconcile),
                s.on('bz:intent', (d, from) => {
                    if (!room || !from || !s.player(from.id)) return;
                    if (!ROOM.seat(room, from.id)) reconcile();
                    ROOM.intent(room, from.id, d); publish();
                }),
                s.on('bz:hi', (d, from) => {
                    if (!room || !from || !s.player(from.id)) return;
                    reconcile();
                    s.send('bz:room', ROOM.view(room), from.id);
                    if (match && room.phase === 'match' && ROOM.seat(room, from.id)?.playing) s.send('bz:start', match.opts, from.id);
                })
            );
            reconcile();
            ROOM.intent(room, s.id, { n: ++intentN, c: want.c, p: want.p, r: false });
            publish();
        } else {
            offs.push(s.on('bz:room', onRoomView), s.on('bz:start', onRoomStart), s.on('game-pick', () => {
                if (!s.gameId || s.gameId === 'blastz') return;
                leave(); lobby(); status('that room is playing a different game. try another code.', true);
            }));
        }
        showRoom();
        if (!s.isHost) sendIntent(true);
    }
    function reconcile() {
        if (!room || !session) return;
        const s = session;
        for (const p of s.players) {
            ROOM.join(room, p.id, p.name, fighterOk(p.avatar?.blastz) ? p.avatar.blastz : 0);
            if (p.me || welcomed.has(p.id)) continue;
            // someone who came in through the desktop lobby is still looking at it
            welcomed.add(p.id); s.send('np:start', { gameId: 'blastz' }, p.id);
        }
        for (const seat of room.seats.slice()) if (!s.player(seat.id)) ROOM.leave(room, seat.id);
        publish();
    }
    function publish() {
        if (!room || !session || room.rev === shownRev) return;
        const next = ROOM.read(ROOM.view(room));
        if (!next) return;
        shownRev = room.rev; view = next; viewAt = performance.now(); roomDirty = true;
        const me = ROOM.seat(room, session.id);
        if (me) { want.c = me.pick; want.p = me.perk; want.r = me.ready; }
        paintRoom();
    }
    function flushRoom(force) {
        if (!room || !session) return;
        const now = performance.now();
        if (!force && !(roomDirty && now - roomSentAt >= (slowWire() ? 250 : 100)) && now - roomSentAt < 2000) return;
        roomDirty = false; roomSentAt = now;
        session.send('bz:room', ROOM.view(room));
    }
    function launch() {
        const m = ROOM.begin(room, Math.floor(Math.random() * 1e9), Date.now());
        if (!m) return;
        publish(); flushRoom(true);
        session.send('bz:start', m);
        start(session, m);
    }
    function onRoomView(d, from) {
        if (room || !session || !from || from.id !== hostId()) return;
        const next = ROOM.read(d);
        if (!next || (view && next.rev <= view.rev)) return;
        view = next; viewAt = performance.now();
        const me = mySeat();
        if (me && !intentDirty && me.n >= intentN) { want.c = me.pick; want.p = me.perk; want.r = me.ready; }
        if (match && !match.saved && next.last && next.last.match === match.id) finish(next.last);
        paintRoom();
    }
    function onRoomStart(d, from) {
        if (room || !session || !from || from.id !== hostId()) return;
        const m = ROOM.readStart(d);
        if (!m || finished.has(m.match) || (match && match.id === m.match)) return;
        if (!m.people.some(p => p.id === session.id && !p.bot)) return;
        clearInterval(resultTimer); resultTimer = 0;
        start(session, m);
    }
    function sendIntent(force) {
        if (!session || room) return;
        clearTimeout(intentTimer); intentTimer = 0;
        const now = performance.now(), gap = slowWire() ? 300 : 120;
        if (!force && now - intentAt < gap) { intentDirty = true; intentTimer = setTimeout(() => sendIntent(true), gap - (now - intentAt)); return; }
        intentDirty = false; intentAt = now;
        const msg = { n: ++intentN, c: want.c, p: want.p, r: want.r };
        if (want.t === 0 || want.t === 1) msg.t = want.t;
        delete want.t;
        session.sendToHost('bz:intent', msg);
    }
    function wish(change) {
        if (!session) return;
        Object.assign(want, change);
        if (room) { ROOM.intent(room, session.id, Object.assign({ n: ++intentN }, want)); delete want.t; publish(); }
        else { sendIntent(); paintRoom(); }
    }
    function pickRoom(n) {
        if (want.r || n === want.c || !fighterOk(n)) return;
        picks[0] = n; save(); wish({ c: n });
    }
    function perkRoom(id) {
        if (want.r || id === want.p) return;
        perks[0] = D.perk(id); save(); wish({ p: perks[0] });
    }
    function setReady(value) {
        const me = mySeat();
        if (!me || !me.in || view.phase === 'match') return;
        const r = value === undefined ? !want.r : value;
        if (r === want.r) return;
        wish({ r }); tone(r ? 'go' : 'jump');
    }
    function switchSide() {
        const me = mySeat();
        if (!me || !me.in || want.r || !view.rules.teams || view.phase === 'match') return;
        wish({ t: 1 - me.team });
    }
    function hostSet(key, value) {
        if (!room || !session) return;
        if (!ROOM.setRule(room, session.id, key, value)) return;
        const r = room.rules;
        Object.assign(setup, { map: r.map, lives: r.lives, teams: r.teams, count: r.count }); save();
        session.setOption('map', r.map); session.setOption('lives', String(r.lives)); session.setOption('mode', r.teams ? 'teams' : 'ffa'); session.setOption('count', String(r.count));
        publish();
    }
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
            if (!me || missedStart) { helloAt = now; session.sendToHost('bz:hi', {}); }
            if (!me || unheard) { helloAt = now; sendIntent(true); }
        }
        if (screen === 'room') paintCount();
    }
    function showRoom() {
        clearInput(); screen = 'room'; overlay = null; renderer.reset();
        menuState = preview(view ? view.rules.map : setup.map);
        ui.innerHTML = topbar() + `<section class="bz-room" aria-label="Room">
            <div class="bz-room-bar">
                <div class="bz-room-id"><span>room code</span><b class="bz-room-code">${esc(session.code)}</b></div>
                <button type="button" class="bz-btn" data-act="copy">copy invite</button>
                <div class="bz-rules" id="bz-rules"></div>
                <button type="button" class="bz-btn" data-act="menu">leave room</button>
            </div>
            <div class="bz-cards" id="bz-cards"></div>
            <p class="bz-bench" id="bz-bench" hidden></p>
            <div class="bz-grid" role="group" aria-label="Choose your fighter">${F.FIGHTERS.map((f, i) => `<button type="button" class="bz-char" data-fighter="${i}" aria-pressed="false" aria-label="${esc(f.name)}"><canvas width="96" height="84"></canvas><span>${esc(f.name)}</span><em class="bz-tokens"></em></button>`).join('')}</div>
            <div class="bz-perks bz-perks-row" role="group" aria-label="Choose your perk">${D.PERKS.map(p => `<button type="button" class="bz-perk" data-perk="${p.id}" aria-pressed="false"><b>${p.name}</b><small>${p.blurb}</small></button>`).join('')}</div>
            <div class="bz-room-foot"><p class="bz-status" role="status" aria-live="polite"></p><button type="button" class="bz-primary bz-ready" data-act="ready" aria-pressed="false" disabled>ready</button></div>
            <div class="bz-room-count" aria-hidden="true"></div>
        </section>`;
        paintPortraits(); paintRoom();
    }
    function swap(el, html) {
        if (!el || el._bzHtml === html) return false;
        const key = el.contains(document.activeElement) ? document.activeElement.dataset.key : null;
        el.innerHTML = html; el._bzHtml = html;
        if (key) el.querySelector('[data-key="' + key + '"]')?.focus({ preventScroll: true });
        return true;
    }
    function rulesHTML(v, isHost, locked) {
        const r = v.rules, map = D.map(r.map), off = locked ? ' disabled' : '';
        if (!isHost) return `<span class="bz-rule"><b>${r.teams ? 'two teams' : 'free for all'}</b> ${r.count} fighters</span><span class="bz-rule"><b>${r.lives}</b> lives</span><span class="bz-rule"><b>${esc(map.name)}</b> host's pick</span>`;
        const sel = (key, list, cur, label) => `<select class="bz-select" data-rule="${key}" data-key="${key}" aria-label="${label}"${off}>${list.map(([v, t]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
        return sel('teams', [['0', 'free for all'], ['1', 'two teams']], r.teams ? '1' : '0', 'mode') + sel('count', [[2, '2 fighters'], [3, '3 fighters'], [4, '4 fighters']], r.count, 'fighters') +
            sel('lives', D.LIVES.map(n => [n, n + ' lives']), r.lives, 'lives') + sel('map', D.MAPS.map(m => [m.id, m.name]), r.map, 'map');
    }
    function cardsHTML(v, isHost) {
        const card = o => `<article class="bz-card${o.me ? ' bz-card-me' : ''}${o.ready ? ' bz-card-ready' : ''}${o.bot ? ' bz-card-cpu' : ''}" style="--c:${o.color}">
            <header><b>${o.tag}</b><span>${esc(o.name)}</span>${o.me ? '<em>you</em>' : ''}${o.host ? '<em>host</em>' : ''}</header>
            <canvas width="150" height="130" data-pick="${o.pick}" role="img" aria-label="${esc(fighterName(o.pick))}"></canvas>
            <div class="bz-card-name">${esc(fighterName(o.pick))}</div><div class="bz-card-perk">${esc(D.PERKS.find(p => p.id === o.perk)?.name || '')}</div>
            <div class="bz-card-foot"><span>${o.bot ? 'bot' : o.wins + (o.wins === 1 ? ' win' : ' wins')}</span><span>${o.state}</span></div>${o.button || ''}</article>`;
        const out = [];
        const color = (team, i) => v.rules.teams ? D.TEAM_COLORS[team] : D.COLORS[i % 4];
        let i = 0;
        v.seats.forEach(s => {
            if (!s.in) return;
            const me = s.id === session.id, ready = me ? want.r : s.ready;
            out.push(card({ tag: v.rules.teams ? D.TEAM_NAMES[s.team] : 'P' + (i + 1), color: color(s.team, i), name: s.name, me, host: s.id === v.host, ready, pick: me ? want.c : s.pick, perk: me ? want.p : s.perk, wins: s.wins,
                state: v.phase === 'match' && s.playing ? 'in the match' : ready ? 'ready' : 'choosing…',
                button: me && v.rules.teams ? `<button type="button" class="bz-btn" data-act="team" data-key="team"${ready || v.phase === 'match' ? ' disabled' : ''}>switch side</button>` : '' }));
            i++;
        });
        v.bots.forEach((b, j) => {
            out.push(card({ tag: v.rules.teams ? D.TEAM_NAMES[b.team] : 'cpu', color: color(b.team, i), name: b.name, bot: true, pick: b.pick, perk: b.perk, state: 'fills the seat',
                button: isHost ? `<button type="button" class="bz-btn" data-act="bot" data-v="${j}" data-key="bot${j}"${v.phase === 'select' && !want.r ? '' : ' disabled'}>another bot</button>` : '' }));
            i++;
        });
        return out.join('');
    }
    function roomStatus(me) {
        if (!view) return 'joining the room…';
        if (!me) return 'taking a seat…';
        if (view.phase === 'match') return 'a match is on. you are in the next one; pick while you wait.';
        if (!me.in) return 'the match is full. you are next in line.';
        if (view.phase === 'countdown') return 'everyone is ready. here we go.';
        if (!want.r) return 'pick a fighter and a perk, then ready up. it starts when everyone is ready.';
        const waiting = view.seats.filter(p => p.in && !p.ready && p.id !== me.id).map(p => p.name);
        return waiting.length ? 'waiting for ' + waiting.join(', ') + '.' : 'ready.';
    }
    function paintRoom() {
        if (screen !== 'room' || !session || !ui) return;
        const el = ui.querySelector('.bz-room'); if (!el) return;
        const me = mySeat();
        if (view && menuState && menuState.map !== view.rules.map) menuState = preview(view.rules.map);
        swap(el.querySelector('#bz-rules'), view ? rulesHTML(view, !!room, view.phase !== 'select' || want.r) : '');
        if (swap(el.querySelector('#bz-cards'), view ? cardsHTML(view, !!room) : '')) paintCards();
        const bench = el.querySelector('#bz-bench'), waiting = view ? view.seats.filter(s => !s.in).map(s => s.name).join(', ') : '';
        const text = waiting ? 'next in line: ' + waiting : '';
        if (bench.textContent !== text) bench.textContent = text;
        bench.hidden = !text;
        el.classList.toggle('bz-locked', want.r);
        el.querySelectorAll('.bz-char').forEach((b, i) => {
            b.setAttribute('aria-pressed', String(i === want.c)); b.setAttribute('aria-disabled', String(want.r));
            const tokens = view ? view.seats.filter(s => s.in && (s.id === session.id ? want.c : s.pick) === i).map(s => `<i class="${s.id === session.id ? 'bz-me-token' : ''}">${esc(s.name.slice(0, 6))}</i>`).join('') : '';
            swap(b.querySelector('.bz-tokens'), tokens);
        });
        el.querySelectorAll('.bz-perk').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.perk === want.p)); b.setAttribute('aria-disabled', String(want.r)); });
        const ready = el.querySelector('.bz-ready'), open = !!me && me.in && view.phase !== 'match';
        swap(ready, (want.r ? 'cancel ready' : 'ready!') + ' <small>' + esc(!open ? (me && view.phase === 'match' ? 'match in progress' : 'waiting for a seat') : want.r ? 'unlock to change' : 'lock in ' + fighterName(want.c)) + '</small>');
        ready.disabled = !open; ready.setAttribute('aria-pressed', String(want.r));
        const line = el.querySelector('.bz-room-foot .bz-status'), msg = roomStatus(me);
        if (line.textContent !== msg) { line.textContent = msg; line.classList.remove('bz-error'); }
        paintCount();
    }
    function paintCount() {
        const el = ui?.querySelector('.bz-room-count'); if (!el) return;
        const left = view && view.phase === 'countdown' ? String(Math.max(1, Math.ceil((view.count - (performance.now() - viewAt)) / 1000))) : '';
        if (el.textContent !== left) el.textContent = left;
    }
    function toRoom() {
        clearInterval(resultTimer); resultTimer = 0;
        if (!session) return buildMenu();
        endMatchHandlers(); stopMusic(); match = null;
        showRoom();
    }

    // ---- a match ----
    function startLocal() {
        leave();
        const people = [];
        for (let i = 0; i < setup.humans; i++) people.push({ id: 'local-' + i, name: setup.humans > 1 ? 'P' + (i + 1) : 'you', character: picks[i], perk: perks[i], team: i % 2 });
        start(null, { seed: Math.floor(Math.random() * 1e9), at: Date.now(), options: { map: setup.map, lives: setup.lives, teams: setup.teams, count: Math.max(setup.count, setup.humans) }, people });
    }
    function start(s, opts) {
        if (!RIFT_ART.ready()) {
            mount(); session = s; screen = 'loading';
            ui.innerHTML = topbar() + '<div class="bz-loading" role="status" aria-live="polite">loading the fighters…</div>';
            const attempt = ++pendingStart;
            RIFT_ART.whenReady().then(() => { if (app && pendingStart === attempt && (!s || s.alive)) start(s, opts); })
                .catch(e => { if (app && pendingStart === attempt) { leave(); buildMenu(); dialog('<h2>the fighters could not load.</h2><p>' + esc(e.message) + '</p><button type="button" class="bz-primary" data-act="menu">back</button>'); } });
            return;
        }
        mount(); if (s) endMatchHandlers(); else unsubscribe();
        clearInterval(resultTimer); resultTimer = 0; clearInput();
        session = s; overlay = null; screen = 'play'; renderer.reset();
        locals = [S.input(), S.input(), S.input(), S.input()];
        const o = opts.options || {};
        const state = S.create({ map: o.map, lives: o.lives, teams: o.teams, count: o.count, seed: opts.seed, people: opts.people });
        const mine = s ? [state.players.findIndex(p => p.id === s.id)] : state.players.filter(p => p.id.startsWith('local-')).map(p => p.slot);
        const labels = state.players.map(p => p.bot ? 'cpu' : s ? (p.id === s.id ? 'you' : p.name) : p.name);
        match = { s: state, id: opts.match || String(opts.at) + ':' + opts.seed, mine, labels, host: !s || s.isHost, last: performance.now(), acc: 0, sendAt: 0, inputAt: 0, hudAt: 0, rxAt: performance.now(), sound: 0, paused: false, netDown: false, saved: false, previous: null, snapAt: 0, inputSeq: 0, lastSeq: {}, opts };
        ui.innerHTML = `<div class="bz-hud" id="bz-hud"></div><div class="bz-match-tools"><button type="button" class="bz-btn" data-act="pause">${s ? 'menu' : 'pause'}</button><button type="button" class="bz-btn" data-act="help" aria-label="How to play">?</button>${audioButtons()}</div><div class="bz-net"></div>${coarse() ? touchHTML() : ''}`;
        if (s) {
            const hid = s.players.find(p => p.host)?.id;
            matchOffs.push(s.on('bz:input', (d, from) => {
                if (!match?.host || !from || !d || d.match !== match.id) return;
                if (!Number.isSafeInteger(d.seq) || d.seq <= (match.lastSeq[from.id] || 0)) return;
                const p = match.s.players.find(p => p.id === from.id && !p.bot);
                if (p) { S.setInput(match.s, p.slot, d.input); match.lastSeq[from.id] = d.seq; }
            }), s.on('bz:state', (d, from) => {
                if (!match || match.host || from?.id !== hid || d?.match !== match.id || !S.valid(d.state, match.s.players.length) || d.state.tick < match.s.tick) return;
                match.previous = match.s; match.s = d.state; match.rxAt = performance.now(); match.snapAt = match.rxAt; match.netDown = false;
                if (overlay?.dataset.connectionLost) resume();
            }), s.on('bz:sync', (d, from) => { if (match?.host && from && d?.match === match.id) sendSnapshot(from.id); }),
            s.on('player-leave', p => { if (!match?.host) return; const f = match.s.players.find(q => q.id === p.id); if (f) f.bot = true; }),
            s.on('net:down', () => { if (match && !match.host) { match.netDown = true; clearInput(); } }),
            s.on('closed', () => { if (match && !match.host) match.netDown = true; }));
            if (!match.host) s.sendToHost('bz:sync', { match: match.id }); else sendSnapshot();
        }
        startMusic(); paintHud();
    }
    function sendSnapshot(to) { if (session && match?.host) session.send('bz:state', { match: match.id, state: S.snapshot(match.s) }, to); }
    function slowWire() { return session && (session.mode === 'bus' || (session.mode === 'auto' && session.transport?.kind === 'bus')); }
    function sendInput(force = false) {
        if (!match || match.host || !session) return;
        const now = performance.now(); if (!force && now - match.inputAt < (slowWire() ? 120 : 45)) return;
        match.inputAt = now; session.sendToHost('bz:input', { match: match.id, seq: ++match.inputSeq, input: locals[0] });
    }
    function tick() {
        roomTick();
        if (!match) return;
        if (!focused() && (keys.size || touch.size)) clearInput();
        pollPads();
        const now = performance.now(), elapsed = Math.min(0.12, (now - match.last) / 1000); match.last = now;
        if (match.paused || (!session && document.hidden) || match.netDown) return;
        if (match.host) {
            match.acc += elapsed;
            while (match.acc >= 1 / 60) {
                match.mine.forEach((slot, i) => { if (slot >= 0) S.setInput(match.s, slot, locals[i]); });
                match.drawPrevious = match.s.players.map(p => ({ x: p.x, y: p.y, travel: p.travel, dead: p.dead }));
                S.step(match.s); match.acc -= 1 / 60;
            }
            if (session && now - match.sendAt > (slowWire() ? 130 : 50)) { sendSnapshot(); match.sendAt = now; }
        } else {
            sendInput();
            if (!match.saved && now - match.rxAt > 1800 && now - match.sendAt > 1000) { session.sendToHost('bz:sync', { match: match.id }); match.sendAt = now; }
        }
        sounds();
        if (match.s.phase === 'over' && !match.saved && match.s.tick - (match.s.overAt || match.s.tick) >= 50) finish();
    }
    function sounds() {
        let shots = 0;
        for (const e of match.s.events) {
            if (e.id <= match.sound) continue;
            match.sound = e.id;
            if (e.type === 'shot') { if (shots++ < 2) tone('shot'); }
            else if (['hit', 'ko', 'boom', 'pick', 'go', 'empty', 'block'].includes(e.type)) tone(e.type);
            else if (e.type === 'jump' && match.mine.includes(e.slot)) tone('jump');
        }
    }
    let fitAt = 0, portraitsReady = false;
    function onResize() { fitAt = 0; if (app) app.style.height = ''; }
    function fitStage(now) {
        if (!app || now - fitAt < 250) return;
        fitAt = now;
        if (winRef && coarse() && typeof enterFauxFullscreen === 'function') {
            const land = innerWidth > innerHeight, win = winRef.win, wide = screen === 'play' || screen === 'room';
            if (win._bzLand !== land) { win._bzLand = land; win._bzDeclined = false; }
            if (win._bzAutoFs && !win.classList.contains('fs-active')) { win._bzAutoFs = false; win._bzDeclined = true; }
            if (land && wide && !win._bzDeclined && !win.classList.contains('fs-active')) { enterFauxFullscreen(win); win._bzAutoFs = true; }
            else if ((!land || !wide) && win._bzAutoFs && typeof fauxFullscreenWin !== 'undefined' && fauxFullscreenWin === win) { win._bzAutoFs = false; exitFauxFullscreen(); }
        }
        const rect = app.getBoundingClientRect(), zoom = app.clientWidth ? rect.width / app.clientWidth : 1;
        let available = (document.documentElement.clientHeight - rect.top - 37) / (zoom || 1);
        if (winRef && Number.isFinite(parseFloat(getComputedStyle(winRef.win).maxHeight))) {
            const body = winRef.body, style = getComputedStyle(body);
            const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
            available = Math.min(available, body.getBoundingClientRect().height / (zoom || 1) - borders);
            body.scrollTop = 0;
        }
        app.style.height = Math.max(200, Math.min(760, available)) + 'px';
        if (window.RIFT_ART && RIFT_ART.ready() && !portraitsReady) { portraitsReady = true; paintPortraits(); }
    }
    function frame(now) {
        if (!app) return;
        frameId = requestAnimationFrame(frame);
        if (document.hidden || !app.getClientRects().length) return;
        fitStage(now);
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!RIFT_ART.ready()) return;
        if (match) {
            let state = match.s, lead = 0;
            if (match.host && match.drawPrevious && !match.paused) {
                const blend = Math.min(1, match.acc * 60);
                state = Object.assign({}, state, { players: state.players.map((p, i) => {
                    const old = match.drawPrevious[i];
                    if (!old || old.dead || p.dead || Math.abs(old.x - p.x) > 100 || Math.abs(old.y - p.y) > 100) return p;
                    return Object.assign({}, p, { x: old.x + (p.x - old.x) * blend, y: old.y + (p.y - old.y) * blend, travel: old.travel + (p.travel - old.travel) * blend });
                }) });
                lead = blend - 1;
            }
            if (!match.host && match.previous && !match.netDown) {
                const since = now - match.snapAt, blend = Math.min(1, since / 50);
                state = Object.assign({}, state, { players: state.players.map((p, i) => {
                    const old = match.previous.players[i];
                    if (!old || Math.abs(old.x - p.x) > 150 || old.lives !== p.lives || old.dead || p.dead) return p;
                    return Object.assign({}, p, { x: old.x + (p.x - old.x) * blend, y: old.y + (p.y - old.y) * blend, travel: old.travel + (p.travel - old.travel) * blend });
                }) });
                lead = Math.min(3, since * 0.06);
            }
            const clock = match.host ? state.tick + match.acc * 60 : state.tick + Math.min(3, Math.max(0, now - match.snapAt) * 0.06);
            renderer.draw(state, now / 1000, { reduced, clock, lead, paused: match.paused || match.netDown, labels: match.labels });
            if (now - match.hudAt > 100) { paintHud(); match.hudAt = now; }
        } else if (menuState) {
            menuState.players[0].character = screen === 'room' ? want.c : picks[tab];
            renderer.draw(menuState, now / 1000, { menu: true, reduced, clock: now / 1000 * 60 });
        }
    }
    function paintHud() {
        if (!match) return;
        const s = match.s, el = ui.querySelector('#bz-hud'); if (!el) return;
        el.innerHTML = s.players.map(p => {
            const w = D.WEAPONS[p.weapon], color = R.colorOf(s, p);
            const ammo = p.reload ? 'reloading' : p.clips < 0 ? p.mag + ' / ∞' : p.mag + ' · ' + p.clips + ' mag' + (p.clips === 1 ? '' : 's');
            return `<div class="bz-chip${p.out ? ' bz-out' : ''}${match.mine.includes(p.slot) ? ' bz-mine' : ''}" style="--c:${color}">
                <b>${esc(match.labels[p.slot])}</b><span class="bz-chip-f">${esc(fighterName(p.character))}</span>
                <span class="bz-lives" aria-label="${p.lives} lives">${p.lives <= 5 ? '♥'.repeat(p.lives) : '♥ × ' + p.lives}${p.out ? 'out' : ''}</span>
                <span class="bz-gun">${esc(w.name)} <small>${ammo}</small></span><span class="bz-bombs" aria-label="${p.bombs} bombs">${'●'.repeat(Math.min(6, p.bombs))}</span></div>`;
        }).join('') + `<div class="bz-clock">${s.overtime ? '<b>overtime</b>' : clock(s)}</div>`;
        const net = ui.querySelector('.bz-net');
        if (match.netDown) {
            net.textContent = 'host connection lost';
            if (!overlay) { dialog('<h2>connection lost.</h2><p>The host left or stopped answering.</p><button type="button" class="bz-primary" data-act="menu">back to the menu</button>'); overlay.dataset.connectionLost = '1'; }
        } else net.textContent = session ? (performance.now() - match.rxAt > 1800 && !match.host ? 'waiting for host…' : session.mode === 'local' ? 'two-tab match' : match.host ? 'online · hosting' : 'online · ' + Math.round(session.players.find(p => p.host)?.ping || 0) + ' ms') : '';
    }
    function clock(s) {
        const left = Math.max(0, Math.ceil((D.OVERTIME - Math.max(0, s.tick - D.COUNTDOWN)) / 60));
        return Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    }
    function finish(given) {
        match.saved = true; finished.add(match.id); clearInput();
        const res = given ? { rows: given.rows } : S.result(match.s);
        const rows = res.rows, mine = rows.filter(r => match.mine.includes(match.s.players.findIndex(p => p.id === r.id)));
        const won = mine.some(r => r.place === 1) && (!session || rows.some(r => r.id === session.id && r.place === 1));
        const meta = read(META);
        meta.matches = (Number(meta.matches) || 0) + 1; meta.wins = (Number(meta.wins) || 0) + Number(won);
        meta.kos = (Number(meta.kos) || 0) + mine.reduce((n, r) => n + r.kos, 0); meta.falls = (Number(meta.falls) || 0) + mine.reduce((n, r) => n + r.falls, 0);
        write(META, meta);
        if (won && typeof unlockAchievement === 'function') { try { unlockAchievement('blastz_win'); } catch (_) { } }
        const s = match.s, winners = rows.filter(r => r.place === 1);
        const head = winners.length ? (s.teams ? D.TEAM_NAMES[winners[0].team] + ' team wins' : esc(match.labels[s.players.findIndex(p => p.id === winners[0].id)] || winners[0].name) + ' wins') : 'nobody is left';
        const table = `<div class="bz-results">${rows.map(r => `<div class="bz-result" style="--c:${R.colorOf(s, s.players.find(p => p.id === r.id) || { slot: 0, team: r.team })}"><b>#${r.place}</b><span>${esc(match.labels[s.players.findIndex(p => p.id === r.id)] || r.name)} · ${esc(fighterName(r.pick))}</span><span>${r.kos} KO · ${r.falls} fall${r.falls === 1 ? '' : 's'}</span></div>`).join('')}</div>`;
        const title = `<h2>${won ? 'last one standing.' : head + '.'}</h2>`;
        if (!session) {
            dialog(`${title}<p>${head}.</p>${table}<button type="button" class="bz-primary" data-act="again">again</button><button type="button" class="bz-secondary" data-act="menu">back to the menu</button>`);
            return;
        }
        if (room) {
            ROOM.finish(room, { match: match.id, rows: rows.map(r => ({ id: r.id, name: r.name, team: r.team, pick: r.pick, kos: r.kos, falls: r.falls, place: r.place, bot: r.bot })) });
            publish(); flushRoom(true);
        }
        let left = 6;
        dialog(`${title}<p>${head}. back to the room in <b class="bz-back">${left}</b>…</p>${table}<button type="button" class="bz-primary" data-act="room">back to the room</button><button type="button" class="bz-secondary" data-act="menu">leave room</button>`);
        clearInterval(resultTimer);
        resultTimer = setInterval(() => { const el = overlay?.querySelector('.bz-back'); if (--left <= 0 || !el) toRoom(); else el.textContent = left; }, 1000);
    }

    // ---- input: up to four players on one computer ----
    function touchHTML() {
        return '<div class="bz-touch"><div><button type="button" data-control="left" aria-label="Move left">◀</button><button type="button" data-control="right" aria-label="Move right">▶</button><button type="button" data-control="down" aria-label="Drop down">▼</button></div><div><button type="button" data-control="bomb" aria-label="Throw a bomb">●</button><button type="button" data-control="fire" aria-label="Fire">fire</button><button type="button" data-control="jump" aria-label="Jump">▲</button></div></div>';
    }
    // [player, control] for a key, which depends on how many share the keyboard
    const SOLO = { KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyS: 'down', ArrowDown: 'down', KeyW: 'jump', ArrowUp: 'jump', Space: 'jump', KeyF: 'fire', KeyJ: 'fire', KeyZ: 'fire', KeyG: 'bomb', KeyK: 'bomb', KeyX: 'bomb' };
    const DUO = [
        { KeyA: 'left', KeyD: 'right', KeyS: 'down', KeyW: 'jump', KeyF: 'fire', KeyG: 'bomb' },
        { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'jump', KeyK: 'fire', KeyL: 'bomb', Numpad1: 'fire', Numpad2: 'bomb', Period: 'fire', Slash: 'bomb' }
    ];
    function binding(code) {
        if (!match || match.mine.length < 2) return SOLO[code] ? [0, SOLO[code]] : null;
        for (let i = 0; i < 2; i++) if (DUO[i][code]) return [i, DUO[i][code]];
        return null;
    }
    function focused() {
        if (!winRef) return true;
        const win = winRef.win, z = Number(win.style.zIndex) || 0;
        return win.style.display !== 'none' && ![...document.querySelectorAll('.app-window,.ie-window')].some(w => w !== win && w.style.display !== 'none' && (Number(w.style.zIndex) || 0) > z);
    }
    function held() {
        for (let i = 0; i < 4; i++) {
            const o = locals[i];
            for (const k of ['left', 'right', 'down', 'fire']) o[k] = false;
            const pad = padPrev[i];
            if (pad) for (const k of ['left', 'right', 'down', 'fire']) o[k] = o[k] || !!pad[k];
            if (i === 0) for (const k of ['left', 'right', 'down', 'fire']) o[k] = o[k] || touch.has(k);
        }
        for (const code of keys) { const b = binding(code); if (b && ['left', 'right', 'down', 'fire'].includes(b[1])) locals[b[0]][b[1]] = true; }
        if (keys.has('mouse0')) locals[0].fire = true;
        sendInput(true);
    }
    function press(i, k) { if (k === 'jump' || k === 'bomb') locals[i][k]++; }
    function clearInput() { keys.clear(); touch.clear(); padPrev = []; for (const o of locals) for (const k of ['left', 'right', 'down', 'fire']) o[k] = false; sendInput(true); }
    function onKey(e) {
        if (overlay && e.type === 'keydown' && focused()) {
            if (e.code === 'Escape' && overlay.querySelector('[data-act=close-help]')) { e.preventDefault(); e.stopImmediatePropagation(); overlay.querySelector('[data-act=close-help]').click(); return; }
        }
        if (!focused() || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
        if (screen === 'room' && e.type === 'keydown' && !overlay && e.code === 'Enter' && !e.repeat && !e.target.closest?.('button:not(.bz-char),a')) { e.preventDefault(); setReady(); return; }
        if (screen !== 'play' || !match) return;
        if (e.code === 'Escape' && e.type === 'keydown' && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); pause(); return; }
        const b = binding(e.code); if (!b || overlay) return;
        e.preventDefault(); e.stopPropagation();
        if (e.type === 'keydown') { if (!keys.has(e.code)) { keys.add(e.code); press(b[0], b[1]); } }
        else keys.delete(e.code);
        held();
    }
    function onPointer(e) {
        if (screen !== 'play' || !match || match.paused || overlay) return;
        const b = e.target.closest('[data-control]');
        if (!b) {
            if (e.pointerType !== 'mouse' || e.target.closest('button,a,input,select,.bz-match-tools,.bz-touch')) return;
            if (e.type === 'pointerdown' && e.button === 0) { keys.add('mouse0'); held(); }
            else if (e.type === 'pointerdown' && e.button === 2) { press(0, 'bomb'); held(); }
            else if (e.type !== 'pointerdown' && e.button === 0) { keys.delete('mouse0'); held(); }
            return;
        }
        if (e.type === 'pointerdown' && e.button !== 0) return;
        e.preventDefault(); const k = b.dataset.control;
        if (e.type === 'pointerdown') { try { b.setPointerCapture(e.pointerId); } catch (_) { } touch.add(k); press(0, k); }
        else touch.delete(k);
        held();
    }
    // Gamepad n plays for local player n.
    function pollPads() {
        if (overlay || !focused() || !navigator.getGamepads) return;
        const pads = [...navigator.getGamepads()].filter(Boolean);
        let changed = false;
        for (let i = 0; i < 4; i++) {
            const g = pads[i], prev = padPrev[i] || {};
            if (!g || i >= match.mine.length) { if (padPrev[i]) { padPrev[i] = null; changed = true; } continue; }
            const on = n => !!g.buttons[n]?.pressed;
            const now = { left: g.axes[0] < -0.35 || on(14), right: g.axes[0] > 0.35 || on(15), down: g.axes[1] > 0.6 || on(13), fire: on(2) || on(7) || on(6), jump: on(0) || on(12), bomb: on(1) || on(5) || on(4), pause: on(9) };
            if (now.jump && !prev.jump) press(i, 'jump');
            if (now.bomb && !prev.bomb) press(i, 'bomb');
            if (now.pause && !prev.pause) pause();
            for (const k of ['left', 'right', 'down', 'fire', 'jump', 'bomb']) if (now[k] !== !!prev[k]) changed = true;
            padPrev[i] = now;
        }
        if (changed) held();
    }
    function visibility() { clearInput(); if (!session && match && document.hidden && !overlay && match.s.phase !== 'over') pause(); }
    function pause() {
        if (!match || match.s.phase === 'over') return;
        if (overlay) { if (overlay.querySelector('[data-act=resume]')) resume(); return; }
        clearInput(); if (!session) match.paused = true;
        dialog(`<h2>${session ? 'still going.' : 'paused.'}</h2><p>${session ? 'The online match carries on while this is open.' : 'Take a breath.'}</p><button type="button" class="bz-primary" data-act="resume">keep blasting</button><button type="button" class="bz-secondary" data-act="menu">${session ? 'leave room' : 'leave match'}</button>`);
    }
    function resume() { if (overlay) overlay.remove(); overlay = null; if (match) { match.paused = false; match.last = performance.now(); } clearInput(); }
    function onChange(e) {
        if (e.target.id === 'bz-map') { setup.map = D.map(e.target.value).id; save(); menuState = preview(setup.map); }
        if (e.target.dataset.rule) hostSet(e.target.dataset.rule, e.target.dataset.rule === 'map' ? e.target.value : e.target.dataset.rule === 'teams' ? e.target.value === '1' : +e.target.value);
        if (e.target.id === 'bz-transport') ui.querySelector('#bz-relay').hidden = e.target.value !== 'relay';
    }
    async function onClick(e) {
        const fighter = e.target.closest('[data-fighter]'), perk = e.target.closest('[data-perk]');
        if (fighter && screen === 'room') { pickRoom(+fighter.dataset.fighter); return; }
        if (perk && screen === 'room') { perkRoom(perk.dataset.perk); return; }
        if (fighter) { picks[tab] = +fighter.dataset.fighter; save(); if (tab === 0) setProfile(); buildMenu(); ui.querySelector('[data-fighter="' + picks[tab] + '"]')?.focus({ preventScroll: true }); return; }
        if (perk) { perks[tab] = D.perk(perk.dataset.perk); save(); buildMenu(); ui.querySelector('[data-perk="' + perks[tab] + '"]')?.focus({ preventScroll: true }); return; }
        const b = e.target.closest('[data-act]'); if (!b) return;
        const v = b.dataset.v, refocus = () => ui.querySelector(`[data-act="${b.dataset.act}"][data-v="${v}"]`)?.focus({ preventScroll: true });
        switch (b.dataset.act) {
            case 'tab': tab = +v; buildMenu(); refocus(); break;
            case 'humans': setup.humans = +v; if (setup.count < setup.humans) setup.count = Math.max(2, setup.humans); save(); buildMenu(); refocus(); break;
            case 'count': setup.count = Math.max(+v, setup.humans > 1 ? setup.humans : 2); save(); buildMenu(); refocus(); break;
            case 'teams': setup.teams = v === '1'; save(); buildMenu(); refocus(); break;
            case 'lives': setup.lives = D.lives(+v); save(); buildMenu(); refocus(); break;
            case 'solo': case 'again': startLocal(); break;
            case 'online': lobby(); break;
            case 'host': await connect(true); break;
            case 'join': await connect(false); break;
            case 'ready': setReady(); break;
            case 'team': switchSide(); break;
            case 'bot': if (room && ROOM.rerollBot(room, session.id, +v)) publish(); break;
            case 'room': toRoom(); break;
            case 'copy': {
                const url = Netplay.inviteLink ? Netplay.inviteLink(session.code, 'blastz') : location.href;
                try { await navigator.clipboard.writeText(url); b.textContent = 'invite copied'; } catch (_) { status('share this code: ' + session.code); }
                break;
            }
            case 'menu': connectionToken++; lobbyBusy = false; leave(); buildMenu(); break;
            case 'help': showHelp(); break;
            case 'close-help': { const was = overlay?.dataset.wasPaused === '1'; resume(); if (match) match.paused = was; break; }
            case 'pause': pause(); break;
            case 'resume': resume(); break;
            case 'sound': muted = !muted; save(); b.textContent = muted ? 'effects off' : 'effects on'; b.setAttribute('aria-pressed', String(!muted)); if (!muted) tone('go'); break;
            case 'music': musicOn = !musicOn; save(); b.textContent = musicOn ? 'music on' : 'music off'; b.setAttribute('aria-pressed', String(musicOn)); if (musicOn) startMusic(); else stopMusic(); break;
        }
    }
    window.startBlastz = function () { mount(); if (!match && screen !== 'lobby' && screen !== 'room') { buildMenu(); if (new URLSearchParams(location.search).get('room')) lobby(); } };
    Netplay.registerGame({ id: 'blastz', name: 'blastz 98', start: s => enterRoom(s), startSolo: () => { mount(); startLocal(); }, soloLabel: 'play with bots',
        paintAvatar: cv => { const c = cv.getContext('2d'); c.fillStyle = '#20304f'; c.fillRect(0, 0, cv.width, cv.height); R.sprite(c, cv.width / 2, cv.height * 0.92, picks[0], { scale: cv.height * 0.8 / RIFT_ANIM.height(picks[0]), weapon: 1 }); } });
    // read-only diagnostics for the browser tests; the rules stay in BLASTZ_SIM
    window.BLASTZ_ENGINE = { state: () => match, screen: () => screen, meta: () => read(META), room: () => view, want: () => want, locals: () => locals };
})();
