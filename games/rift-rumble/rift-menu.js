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
                <div class="rr-special-name"><span>Special move</span><b>${f.special}</b></div>
            </section>
            <div class="rr-spotlight" aria-hidden="true"><div class="rr-player-badge">P1 <span>Ready to cause problems</span></div></div>
            <section class="rr-panel" aria-label="Match setup">
                <h2>Settle it in the arena.</h2><span class="rr-label">Game mode</span>
                <div class="rr-modes">${[1, 2].map(n => `<button type="button" class="rr-mode" data-mode="${n}" aria-pressed="${mode === n}"><b>${n}v${n}</b><small>${n === 1 ? 'Duel' : 'Team battle'}</small></button>`).join('')}</div>
                <label class="rr-label" for="rr-arena">Battleground</label><select id="rr-arena" class="rr-select">${D.ARENAS.map(a => `<option value="${a.id}" ${a.id === arena ? 'selected' : ''}>${a.name}</option>`).join('')}</select>
                <div class="rr-match-rules"><span>◆ ◆ ◆ <b>3 stocks</b></span><span>◷ <b>3 minutes</b></span></div>
                <button type="button" class="rr-primary" data-act="solo">BRAWL! <small>Play against bots</small></button>
                <button type="button" class="rr-secondary" data-act="online">Play with friends <span>1–4 players</span></button>
                <p class="rr-panel-note">Share a code. Pick a side. No accounts.</p>
            </section>
            <section class="rr-roster-panel" aria-label="Fighter roster"><div class="rr-roster-title"><h2>Choose your trouble.</h2><span>12 fighters · all unlocked</span></div><div class="rr-characters">${D.FIGHTERS.map((f, i) => `<button type="button" class="rr-char" data-fighter="${i}" aria-pressed="${selected === i}" aria-label="Select ${f.name}"><canvas width="110" height="100" aria-label="${f.name} portrait"></canvas><span>${f.name}</span>${selected === i ? '<i>P1</i>' : ''}</button>`).join('')}</div></section>
        </div>`;
    };
})(window);
