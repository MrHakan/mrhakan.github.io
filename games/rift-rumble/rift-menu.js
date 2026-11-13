(function (root) {
    'use strict';
    const D = root.RIFT;
    root.RIFT_MENU = function (selected, mode, arena) {
        const f = D.FIGHTERS[selected];
        const stat = (name, value) => `<div class="rr-stat"><span>${name}</span><i><b style="width:${value}%"></b></i></div>`;
        return `<div class="rr-menu">
            <section class="rr-intro" aria-label="Selected fighter">
                <div class="rr-game-logo">BRAWLZ<span>98</span></div>
                <p class="rr-tagline">The desktop has a troll problem.</p>
                <div class="rr-selected-name"><canvas width="80" height="80" aria-label="${f.name} face"></canvas><div><span>Your fighter</span><h1>${f.name}</h1></div></div>
                <p class="rr-fighter-kind">${f.kind}</p><p class="rr-fighter-tip">${f.tip}</p>
                <div class="rr-stats">${stat('Speed', Math.round(f.speed / 6 * 100))}${stat('Weight', Math.round(f.weight / 1.4 * 100))}${stat('Reach', Math.round(f.reach / 85 * 100))}</div>
                <div class="rr-special-name">
                    <div><span>Light</span><b>${f.moves.light.name}</b></div>
                    <div><span>Heavy</span><b>${f.moves.heavy.name}</b></div>
                    <div><span>Special</span><b>${f.special}</b></div>
                </div>
            </section>
            <div class="rr-spotlight" aria-hidden="true"><div class="rr-player-badge">P1 <span>Ready to cause problems</span></div></div>
            <section class="rr-panel" aria-label="Match setup">
                <h2>Settle it in the arena.</h2><span class="rr-label">Game mode</span>
                <div class="rr-modes">${[1, 2].map(n => `<button type="button" class="rr-mode" data-mode="${n}" aria-pressed="${mode === n}"><b>${n}v${n}</b><small>${n === 1 ? 'Duel' : 'Team battle'}</small></button>`).join('')}</div>
                <label class="rr-label" for="rr-arena">Battleground</label><select id="rr-arena" class="rr-select">${D.arenasFor(mode).map(a => `<option value="${a.id}" ${a.id === arena ? 'selected' : ''}>${a.name}</option>`).join('')}</select>
                <div class="rr-match-rules"><span>◆ ◆ ◆ <b>3 stocks</b></span><span>◷ <b>3 minutes</b></span></div>
                <button type="button" class="rr-primary" data-act="solo">BRAWL! <small>Play against bots</small></button>
                <button type="button" class="rr-secondary" data-act="online">Play with friends <span>1–4 players</span></button>
                <p class="rr-panel-note">Share a code. Pick a side. No accounts.</p>
            </section>
            <section class="rr-roster-panel" aria-label="Fighter roster"><div class="rr-roster-title"><h2>Choose your trouble.</h2><span>12 fighters · all unlocked</span></div><div class="rr-characters">${D.FIGHTERS.map((f, i) => `<button type="button" class="rr-char" data-fighter="${i}" aria-pressed="${selected === i}" aria-label="Select ${f.name}"><canvas width="110" height="100" aria-label="${f.name} portrait"></canvas><span>${f.name}</span>${selected === i ? '<i>P1</i>' : ''}</button>`).join('')}</div></section>
        </div>`;
    };

    // ---- the online room: lobby and character select on one screen ----
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, k => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[k]);
    const TEAMS = ['Mint', 'Coral'];
    root.RIFT_MENU.TEAMS = TEAMS;

    // Drawn once. Everything that changes lives in the pieces below.
    root.RIFT_MENU.room = function (code) {
        const fighters = D.FIGHTERS.map((f, i) => `<button type="button" class="rr-char" data-fighter="${i}" aria-pressed="false" aria-label="Select ${f.name}">
                <canvas width="110" height="100"></canvas><span>${f.name}</span><em class="rr-tokens"></em>
            </button>`).join('');
        return `<section class="rr-room" aria-label="Room and character select">
            <div class="rr-room-bar">
                <div class="rr-room-id"><span>Room code</span><b class="rr-room-code">${esc(code)}</b></div>
                <button type="button" class="rr-icon-btn" data-act="copy">Copy invite</button>
                <div class="rr-room-rules" id="rr-room-rules"></div>
                <button type="button" class="rr-icon-btn rr-room-leave" data-act="menu">Leave room</button>
            </div>
            <div class="rr-cards" id="rr-cards"></div>
            <p class="rr-bench" id="rr-bench" hidden></p>
            <div class="rr-characters" role="group" aria-label="Choose your fighter">${fighters}</div>
            <div class="rr-room-foot">
                <p class="rr-status" role="status" aria-live="polite"></p>
                <button type="button" class="rr-primary rr-ready" data-act="ready" aria-pressed="false" disabled>Ready</button>
            </div>
            <div class="rr-room-count" aria-hidden="true"></div>
        </section>`;
    };

    // Mode and arena: controls for the host, plain text for everybody else.
    root.RIFT_MENU.rules = function (view, isHost, locked) {
        const stage = D.arenaFor(view.mode, view.arena);
        if (!isHost) {
            return `<span class="rr-rule"><b>${view.mode}v${view.mode}</b> ${view.mode === 1 ? 'Duel' : 'Team battle'}</span>
                <span class="rr-rule"><b>${esc(stage.name)}</b> Host's pick</span>`;
        }
        const off = locked ? ' disabled' : '';
        const modes = [1, 2].map(n => `<button type="button" class="rr-mode" data-room-mode="${n}" data-key="mode${n}" aria-pressed="${view.mode === n}"${off}><b>${n}v${n}</b></button>`).join('');
        const arenas = D.arenasFor(view.mode).map(a => `<option value="${a.id}"${a.id === stage.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
        return `<div class="rr-modes" role="group" aria-label="Game mode">${modes}</div>
            <select id="rr-room-arena" class="rr-select" data-key="arena" aria-label="Battleground"${off}>${arenas}</select>`;
    };

    // One card per fighter in the next match: the humans, then the bots
    // filling in. `mine` is this player's own choice, shown before the host
    // confirms it so the screen never feels a round trip behind.
    root.RIFT_MENU.cards = function (view, mine, isHost) {
        const full = team => view.seats.filter(s => s.team === team).length >= view.mode;
        const card = o => `<article class="rr-card${o.me ? ' rr-card-me' : ''}${o.ready ? ' rr-card-ready' : ''}${o.bot ? ' rr-card-cpu' : ''}" data-team="${o.team}" data-seat="${esc(o.id)}">
                <header><b class="rr-card-tag">${o.tag}</b><span class="rr-card-name">${esc(o.name)}</span>${o.me ? '<em>You</em>' : ''}${o.host ? '<em>Host</em>' : ''}</header>
                <canvas width="220" height="200" data-pick="${o.pick}" role="img" aria-label="${esc(D.FIGHTERS[o.pick].name)}"></canvas>
                <div class="rr-card-fighter">${esc(D.FIGHTERS[o.pick].name)}</div>
                <div class="rr-card-foot"><span class="rr-card-wins">${o.bot ? 'Bot' : o.wins + (o.wins === 1 ? ' win' : ' wins')}</span><span class="rr-card-state">${o.state}</span></div>
                ${o.button || ''}
            </article>`;
        const side = team => {
            const cards = [];
            view.seats.forEach((s, i) => {
                if (s.team !== team) return;
                const me = s.id === mine.id, ready = me ? mine.ready : s.ready;
                const canSwitch = me && !ready && view.phase !== 'match' && !full(1 - team);
                cards.push(card({
                    id: s.id, team, tag: 'P' + (i + 1), name: s.name, me, host: s.id === view.host, ready,
                    pick: me ? mine.pick : s.pick, wins: s.wins,
                    state: view.phase === 'match' && s.playing ? 'In the match' : ready ? 'Ready' : 'Choosing…',
                    button: me && view.mode === 2 ? `<button type="button" class="rr-team-btn" data-act="team" data-key="team"${canSwitch ? '' : ' disabled'}>Switch side</button>` : ''
                }));
            });
            view.bots.forEach((b, i) => {
                if (b.team !== team) return;
                const canRoll = view.phase === 'select' && !mine.ready;
                cards.push(card({
                    id: 'bot-' + i, team, tag: 'CPU', name: b.name, bot: true, pick: b.pick, state: 'Fills the seat',
                    button: isHost ? `<button type="button" class="rr-team-btn" data-act="bot" data-bot="${i}" data-key="bot${i}"${canRoll ? '' : ' disabled'}>Another bot</button>` : ''
                }));
            });
            return `<div class="rr-side" data-team="${team}"><h3>${TEAMS[team]}</h3><div class="rr-side-cards">${cards.join('')}</div></div>`;
        };
        return side(0) + `<div class="rr-versus"><b>VS</b><span>Match ${view.played + 1}</span></div>` + side(1);
    };

    // Who is standing on a fighter in the grid, as small P1/P2/CPU tags.
    root.RIFT_MENU.tokens = function (view, mine, fighter) {
        const out = [];
        view.seats.forEach((s, i) => {
            const me = s.id === mine.id;
            if ((me ? mine.pick : s.pick) !== fighter) return;
            out.push(`<i class="rr-token${me ? ' rr-token-me' : ''}${(me ? mine.ready : s.ready) ? ' rr-token-ready' : ''}" data-team="${s.team}">P${i + 1}</i>`);
        });
        view.bots.forEach(b => { if (b.pick === fighter) out.push(`<i class="rr-token rr-token-cpu" data-team="${b.team}">CPU</i>`); });
        return out.join('');
    };

    // In 1v1 a third player has no seat; they are named here until one opens.
    root.RIFT_MENU.bench = function (view) {
        const waiting = view.seats.map((s, i) => s.team === -1 ? `P${i + 1} ${esc(s.name)} (${esc(D.FIGHTERS[s.pick].name)})` : '').filter(Boolean);
        return waiting.length ? 'Next in line: ' + waiting.join(', ') : '';
    };
})(window);
