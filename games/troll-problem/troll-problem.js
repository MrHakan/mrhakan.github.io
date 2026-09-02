// ===================================================================
// SIR, WE HAVE A TROLL PROBLEM — engine
//
// A tower defense. Trolls walk a fixed path from the spawn to your gate;
// you build towers on the ground beside it. Anything that reaches the
// gate costs lives. Crystals earned per run buy permanent upgrades.
//
// Content (maps, towers, enemies, waves, meta tree) lives in
// troll-problem-data.js. This file is the simulation and the UI.
// ===================================================================

let TG = null;              // active run state
let tgWinBody = null;       // app window body we render into
let tgRAF = null;
let tgLastT = 0;

// ===================================================================
// sound — synthesized, no audio files, respects the site's mute toggle
// ===================================================================
let tgActx = null;
function tgAudioCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!tgActx) tgActx = new AC();
    if (tgActx.state === 'suspended') tgActx.resume().catch(() => { });
    return tgActx;
}
function tgSoundOn() { return typeof soundEnabled === 'undefined' ? true : soundEnabled; }
function tgTone(freq, dur, o) {
    if (!tgSoundOn()) return;
    const ctx = tgAudioCtx();
    if (!ctx) return;
    o = o || {};
    try {
        const t0 = ctx.currentTime + (o.delay || 0);
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = o.type || 'square';
        osc.frequency.setValueAtTime(Math.max(1, freq), t0);
        if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t0 + dur);
        const peak = o.gain !== undefined ? o.gain : 0.06;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur / 3));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
    } catch (e) { }
}
function tgNoise(dur, o) {
    if (!tgSoundOn()) return;
    const ctx = tgAudioCtx();
    if (!ctx) return;
    o = o || {};
    try {
        const t0 = ctx.currentTime + (o.delay || 0);
        const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buf = ctx.createBuffer(1, n, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(o.filterStart || 3000, t0);
        if (o.filterEnd) f.frequency.exponentialRampToValueAtTime(o.filterEnd, t0 + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(o.gain || 0.08, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(f); f.connect(g); g.connect(ctx.destination);
        src.start(t0);
    } catch (e) { }
}
let tgSfxBudget = 0;
function tgSfx(name) {
    // hundreds of trolls can die in one second; throttle so it stays audible
    const now = performance.now();
    if (name === 'hit' || name === 'die') {
        if (now < tgSfxBudget) return;
        tgSfxBudget = now + 45;
    }
    switch (name) {
        case 'shoot': tgTone(560 + Math.random() * 80, 0.04, { type: 'triangle', gain: 0.04 }); break;
        case 'hit': tgTone(190 + Math.random() * 50, 0.04, { type: 'square', gain: 0.035 }); break;
        case 'die': tgTone(150, 0.09, { type: 'sawtooth', gain: 0.05, slideTo: 60 }); break;
        case 'boom': tgNoise(0.16, { filterStart: 1400, filterEnd: 200, gain: 0.09 }); break;
        case 'zap': tgTone(880, 0.06, { type: 'sawtooth', gain: 0.05, slideTo: 1600 }); break;
        case 'build': tgTone(440, 0.05, { type: 'square', gain: 0.06 }); tgTone(660, 0.07, { type: 'square', gain: 0.06, delay: 0.05 }); break;
        case 'sell': tgTone(660, 0.05, { type: 'triangle', gain: 0.05 }); tgTone(440, 0.07, { type: 'triangle', gain: 0.05, delay: 0.05 }); break;
        case 'upgrade': tgTone(523, 0.06, { type: 'square', gain: 0.06 }); tgTone(784, 0.09, { type: 'square', gain: 0.06, delay: 0.06 }); break;
        case 'leak': tgTone(220, 0.18, { type: 'sawtooth', gain: 0.09, slideTo: 90 }); break;
        case 'wave': tgTone(392, 0.09, { type: 'triangle', gain: 0.07 }); tgTone(523, 0.12, { type: 'triangle', gain: 0.07, delay: 0.08 }); break;
        case 'boss': tgTone(110, 0.3, { type: 'sawtooth', gain: 0.09 }); tgTone(98, 0.35, { type: 'sawtooth', gain: 0.09, delay: 0.32 }); break;
        case 'clear': tgTone(523, 0.1, { type: 'square', gain: 0.07 }); tgTone(659, 0.1, { type: 'square', gain: 0.07, delay: 0.09 }); tgTone(784, 0.16, { type: 'square', gain: 0.07, delay: 0.18 }); break;
        case 'win': [523, 659, 784, 1046].forEach((f, i) => tgTone(f, i === 3 ? 0.4 : 0.13, { type: 'square', gain: 0.09, delay: i * 0.12 })); break;
        case 'lose': tgTone(392, 0.2, { type: 'sawtooth', gain: 0.09, slideTo: 190 }); tgTone(190, 0.4, { type: 'sawtooth', gain: 0.08, delay: 0.18, slideTo: 80 }); break;
        case 'error': tgTone(170, 0.1, { type: 'sawtooth', gain: 0.06 }); break;
        case 'crystal': tgTone(1200, 0.07, { type: 'sine', gain: 0.06 }); tgTone(1600, 0.12, { type: 'sine', gain: 0.05, delay: 0.06 }); break;
    }
}

// ===================================================================
// sprites
// ===================================================================
const tgImgCache = Object.create(null);
function tgImg(src) {
    if (!tgImgCache[src]) { const i = new Image(); i.src = src; tgImgCache[src] = i; }
    return tgImgCache[src];
}
function tgPreload() { Object.values(TP.ENEMIES).forEach(e => tgImg(e.sprite)); }

// ===================================================================
// save
// ===================================================================
const TG_META_KEY = 'trollproblem-meta-v2';
const TG_RUN_KEY = 'trollproblem-run-v2';

function tgDefaultMeta() {
    return {
        crystals: 0, spent: {},
        unlockedTowers: ['archer'],
        unlockedMaps: ['outskirts'],
        bestWave: {}, runs: 0, totalKills: 0, totalLeaks: 0, cleared: false
    };
}
function tgLoadMeta() {
    try {
        const raw = localStorage.getItem(TG_META_KEY);
        if (!raw) return tgDefaultMeta();
        return Object.assign(tgDefaultMeta(), JSON.parse(raw));
    } catch (e) { return tgDefaultMeta(); }
}
function tgSaveMeta(m) { try { localStorage.setItem(TG_META_KEY, JSON.stringify(m)); } catch (e) { } }
function tgHasRunSave() { try { return !!localStorage.getItem(TG_RUN_KEY); } catch (e) { return false; } }
function tgClearRunSave() { try { localStorage.removeItem(TG_RUN_KEY); } catch (e) { } }
function tgSaveRun() {
    const g = TG;
    if (!g || g.screen !== 'play') return;
    try {
        localStorage.setItem(TG_RUN_KEY, JSON.stringify({
            mapId: g.map.id, wave: g.wave, gold: g.gold, lives: g.lives, kills: g.kills,
            towers: g.towers.map(t => ({ id: t.id, cx: t.cx, cy: t.cy, level: t.level, spent: t.spent, mode: t.mode }))
        }));
    } catch (e) { }
}
function tgResumeRun() {
    let s;
    try { s = JSON.parse(localStorage.getItem(TG_RUN_KEY)); } catch (e) { return false; }
    if (!s) return false;
    const map = TP.MAPS.find(m => m.id === s.mapId);
    if (!map) return false;
    tgNewRun(map);
    const g = TG;
    g.wave = s.wave; g.gold = s.gold; g.lives = s.lives; g.kills = s.kills || 0;
    g.towers = (s.towers || []).map(t => {
        const def = TP.TOWERS_BY_ID[t.id];
        if (!def) return null;
        return tgMakeTower(def, t.cx, t.cy, t.level, t.spent, t.mode);
    }).filter(Boolean);
    g.towers.forEach(t => { g.occupied[t.cy * TP.COLS + t.cx] = true; });
    g.screen = 'play';
    g.phase = 'prep';
    g.prepLeft = TP.PREP_TIME;
    return true;
}

// ===================================================================
// meta helpers
// ===================================================================
function tgMetaLevel(meta, id) { return meta.spent[id] || 0; }
function tgMetaCost(meta, id) {
    const def = TP.META_BY_ID[id];
    return def.cost + def.step * tgMetaLevel(meta, id);
}
function tgMetaBonus(meta, id) {
    const n = tgMetaLevel(meta, id);
    switch (id) {
        case 'dmg': return n * 0.06;
        case 'rate': return n * 0.04;
        case 'range': return n * 0.04;
        case 'gold': return n * 0.08;
        case 'start': return n * 25;
        case 'lives': return n * 3;
        case 'discount': return n * 0.04;
        case 'crystal': return n * 0.15;
    }
    return 0;
}

// ===================================================================
// path building
// ===================================================================
function tgBuildPath(map) {
    // expand the right-angle waypoints into a per-cell centre-line the trolls follow
    const pts = [];
    const cells = new Set();
    const wp = map.waypoints;
    // the first and last waypoints sit one cell off the board (trolls walk in from
    // offscreen and leave through the gate), so only in-bounds cells get recorded —
    // an out-of-range x would otherwise wrap into a bogus cell on the row next door
    const mark = (x, y) => {
        if (x >= 0 && x < TP.COLS && y >= 0 && y < TP.ROWS) cells.add(y * TP.COLS + x);
    };
    for (let i = 0; i < wp.length - 1; i++) {
        const [x0, y0] = wp[i], [x1, y1] = wp[i + 1];
        const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
        let x = x0, y = y0;
        while (x !== x1 || y !== y1) {
            pts.push({ x: x * TP.CELL + TP.CELL / 2, y: y * TP.CELL + TP.CELL / 2 });
            mark(x, y);
            x += dx; y += dy;
        }
    }
    const last = wp[wp.length - 1];
    pts.push({ x: last[0] * TP.CELL + TP.CELL / 2, y: last[1] * TP.CELL + TP.CELL / 2 });
    mark(last[0], last[1]);

    // cumulative length so "how far along" is comparable between trolls
    let total = 0;
    const dist = [0];
    for (let i = 1; i < pts.length; i++) {
        total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        dist.push(total);
    }
    return { pts, cells, dist, total };
}

// ===================================================================
// run setup
// ===================================================================
function tgNewRun(map) {
    const meta = tgLoadMeta();
    const path = tgBuildPath(map);
    const g = {
        meta, map, path,
        wave: 1, gold: TP.START_GOLD + tgMetaBonus(meta, 'start'),
        lives: TP.START_LIVES + tgMetaBonus(meta, 'lives'),
        kills: 0, leaked: 0, crystalsEarned: 0,
        towers: [], enemies: [], shots: [], patches: [], fx: [], floaters: [],
        occupied: {},
        spawnQueue: [], spawnTimer: 0,
        phase: 'prep', prepLeft: TP.PREP_TIME,
        speed: 1, paused: false,
        selectedTower: null,   // tower def id chosen in the build bar
        selected: null,        // placed tower currently inspected
        hover: null,
        screen: 'play',
        toastQueue: []
    };
    TG = g;
    return g;
}

function tgMakeTower(def, cx, cy, level, spent, mode) {
    return {
        id: def.id, def, cx, cy,
        x: cx * TP.CELL + TP.CELL / 2, y: cy * TP.CELL + TP.CELL / 2,
        level: level || 0, spent: spent || def.cost, mode: mode || 'first',
        cd: 0, angle: 0, kills: 0, damageDealt: 0
    };
}

// resolved stat for a tower at its current level, including meta + banner buffs
function tgStat(g, t, key) {
    const def = t.def;
    let v = def[key];
    for (let i = 0; i < t.level; i++) {
        const up = def.levels[i];
        if (up && up[key] !== undefined) v = up[key];
    }
    if (v === undefined) return undefined;
    if (typeof v !== 'number') return v;   // slow/burn/patch/buff objects pass through

    if (key === 'dmg') v *= 1 + tgMetaBonus(g.meta, 'dmg') + tgBannerBuff(g, t, 'dmg');
    if (key === 'range') v *= 1 + tgMetaBonus(g.meta, 'range');
    if (key === 'cd') v /= 1 + tgMetaBonus(g.meta, 'rate') + tgBannerBuff(g, t, 'rate');
    return v;
}
function tgBannerBuff(g, t, key) {
    if (t.def.kind === 'support') return 0;
    let best = 0;
    g.towers.forEach(b => {
        if (b.def.kind !== 'support' || b === t) return;
        const r = tgStat(g, b, 'range');
        if (Math.hypot(b.x - t.x, b.y - t.y) > r) return;
        const buff = tgStat(g, b, 'buff');
        if (buff && buff[key] > best) best = buff[key];
    });
    return best;
}
function tgTowerCost(g, def) {
    return Math.max(1, Math.round(def.cost * (1 - tgMetaBonus(g.meta, 'discount'))));
}
function tgUpgradeCost(g, t) {
    const up = t.def.levels[t.level];
    if (!up) return null;
    return Math.max(1, Math.round(up.cost * (1 - tgMetaBonus(g.meta, 'discount'))));
}

// ===================================================================
// building
// ===================================================================
function tgCellFree(g, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= TP.COLS || cy >= TP.ROWS) return false;
    if (g.path.cells.has(cy * TP.COLS + cx)) return false;
    if (g.occupied[cy * TP.COLS + cx]) return false;
    return true;
}
function tgPlaceTower(g, cx, cy) {
    const defId = g.selectedTower;
    if (!defId) return;
    const def = TP.TOWERS_BY_ID[defId];
    if (!def) return;
    if (!tgCellFree(g, cx, cy)) { tgSfx('error'); return; }
    const cost = tgTowerCost(g, def);
    if (g.gold < cost) { tgSfx('error'); tgToast('not enough gold'); return; }
    g.gold -= cost;
    const t = tgMakeTower(def, cx, cy);
    t.spent = cost;
    g.towers.push(t);
    g.occupied[cy * TP.COLS + cx] = true;
    g.selected = t;
    tgSfx('build');
}
function tgUpgradeTower(g, t) {
    const cost = tgUpgradeCost(g, t);
    if (cost === null) { tgSfx('error'); return; }
    if (g.gold < cost) { tgSfx('error'); tgToast('not enough gold'); return; }
    g.gold -= cost;
    t.spent += cost;
    t.level++;
    tgSfx('upgrade');
}
function tgSellTower(g, t) {
    const refund = Math.floor(t.spent * TP.SELL_REFUND);
    g.gold += refund;
    delete g.occupied[t.cy * TP.COLS + t.cx];
    g.towers.splice(g.towers.indexOf(t), 1);
    if (g.selected === t) g.selected = null;
    tgSfx('sell');
    tgToast(`sold for $${refund}`);
}
function tgToast(msg) {
    const g = TG;
    if (g) g.floaters.push({ x: TP.W / 2, y: 30, text: msg, life: 1200, vy: -14, color: '#ffd400', big: true });
}

// ===================================================================
// waves
// ===================================================================
function tgWaveComposition(g, wave) {
    const spec = TP.WAVES[Math.min(wave, TP.WAVES.length) - 1];
    const out = [];
    spec.forEach(([id, count, gap]) => {
        for (let i = 0; i < count; i++) out.push({ id, delay: gap });
    });
    return out;
}
function tgStartWave(g) {
    g.spawnQueue = tgWaveComposition(g, g.wave);
    g.spawnTimer = 0;
    g.phase = 'combat';
    if (TP.isBossWave(g.wave)) { tgSfx('boss'); tgToast(`WAVE ${g.wave} — BOSS`); }
    else { tgSfx('wave'); }
}
function tgCallWaveEarly(g) {
    if (g.phase !== 'prep') return;
    const bonus = Math.floor((g.prepLeft / 1000) * TP.EARLY_BONUS_PER_SEC);
    if (bonus > 0) { g.gold += bonus; tgToast(`called early +$${bonus}`); }
    g.prepLeft = 0;
    tgStartWave(g);
}

function tgSpawn(g, id) {
    const def = TP.ENEMIES[id];
    if (!def) return;
    const hp = Math.round(def.hp * TP.waveHpMult(g.wave, g.map.difficulty));
    const speed = def.speed * TP.waveSpeedMult(g.wave);
    const start = g.path.pts[0];
    g.enemies.push({
        id, def, hp, maxHp: hp, speed, armor: def.armor,
        seg: 0, segT: 0, dist: 0,
        x: start.x, y: start.y,
        slowUntil: 0, slowMult: 1, burnUntil: 0, burnDps: 0, burnTick: 0,
        healCd: def.heal ? def.heal.cd : 0, summonCd: def.summon ? def.summon.cd : 0,
        hitFlash: 0, dead: false, leaked: false
    });
}

function tgUpdateSpawns(g, dt) {
    if (g.phase !== 'combat' || !g.spawnQueue.length) return;
    g.spawnTimer -= dt;
    while (g.spawnTimer <= 0 && g.spawnQueue.length) {
        const next = g.spawnQueue.shift();
        tgSpawn(g, next.id);
        g.spawnTimer += next.delay;
        if (next.delay <= 0) break;
    }
}

function tgCheckWaveEnd(g) {
    if (g.phase !== 'combat') return;
    if (g.spawnQueue.length || g.enemies.length) return;
    tgOnWaveCleared(g);
}

function tgOnWaveCleared(g) {
    tgSfx('clear');
    const reward = 24 + g.wave * 6;
    g.gold += reward;
    g.floaters.push({ x: TP.W / 2, y: 60, text: `wave ${g.wave} cleared  +$${reward}`, life: 1600, vy: -16, color: '#8fd66a', big: true });

    // permanent unlocks
    const best = g.meta.bestWave[g.map.id] || 0;
    if (g.wave > best) { g.meta.bestWave[g.map.id] = g.wave; }
    TP.TOWER_UNLOCKS.forEach(u => {
        if (g.wave >= u.wave && !g.meta.unlockedTowers.includes(u.tower)) {
            g.meta.unlockedTowers.push(u.tower);
            g.toastQueue.push(`new tower: ${TP.TOWERS_BY_ID[u.tower].name}`);
        }
    });
    if (g.wave >= TP.MAP_UNLOCK_WAVE) {
        const i = TP.MAPS.findIndex(m => m.id === g.map.id);
        const next = TP.MAPS[i + 1];
        if (next && !g.meta.unlockedMaps.includes(next.id)) {
            g.meta.unlockedMaps.push(next.id);
            g.toastQueue.push(`new map: ${next.name}`);
        }
    }
    TP.ACHIEVEMENT_WAVES.forEach(w => {
        if (g.wave === w && typeof unlockAchievement === 'function') unlockAchievement('troll_wave_' + w);
    });
    tgSaveMeta(g.meta);

    if (g.wave >= TP.TOTAL_WAVES) { tgEndRun(g, true); return; }

    g.wave++;
    g.phase = 'prep';
    g.prepLeft = TP.PREP_TIME;
    tgSaveRun();
    while (g.toastQueue.length) showToast('troll problem', g.toastQueue.shift());
    tgRender();
}

function tgEndRun(g, won) {
    const mult = 1 + tgMetaBonus(g.meta, 'crystal');
    const base = Math.floor(g.wave * 1.5) + (won ? 30 : 0) + Math.floor(g.kills / 40);
    g.crystalsEarned = Math.max(1, Math.round(base * mult));
    g.meta.crystals += g.crystalsEarned;
    g.meta.runs++;
    g.meta.totalKills += g.kills;
    g.meta.totalLeaks += g.leaked;
    if (won) {
        g.meta.cleared = true;
        if (typeof unlockAchievement === 'function') unlockAchievement('troll_king_slain');
    }
    tgSaveMeta(g.meta);
    tgClearRunSave();
    g.screen = won ? 'won' : 'over';
    tgSfx(won ? 'win' : 'lose');
    tgLoopStop();
    tgRender();
}

// ===================================================================
// enemies
// ===================================================================
function tgEnemyPos(g, e) {
    const pts = g.path.pts;
    if (e.def.flying) {
        // fliers cut straight from the spawn to the gate, ignoring the road
        const a = pts[0], b = pts[pts.length - 1];
        const total = Math.hypot(b.x - a.x, b.y - a.y);
        const t = Math.min(1, e.dist / total);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, done: t >= 1 };
    }
    let i = 0;
    while (i < g.path.dist.length - 1 && g.path.dist[i + 1] < e.dist) i++;
    if (i >= pts.length - 1) return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, done: true };
    const segLen = g.path.dist[i + 1] - g.path.dist[i] || 1;
    const t = (e.dist - g.path.dist[i]) / segLen;
    return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t, done: false };
}

function tgProgress(g, e) {
    if (e.def.flying) {
        const a = g.path.pts[0], b = g.path.pts[g.path.pts.length - 1];
        return e.dist / Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    }
    return e.dist / Math.max(1, g.path.total);
}

function tgUpdateEnemies(g, dt) {
    const now = performance.now();
    g.enemies.forEach(e => {
        if (e.dead) return;

        // burn / poison ticks
        if (e.burnUntil > now) {
            e.burnTick -= dt;
            if (e.burnTick <= 0) {
                e.burnTick = 250;
                tgHurt(g, e, e.burnDps * 0.25, { trueDamage: true, silent: true });
                if (e.dead) return;
            }
        }
        // standing in a gas patch
        let patchSlow = 1;
        g.patches.forEach(p => {
            if (Math.hypot(p.x - e.x, p.y - e.y) > p.radius) return;
            patchSlow = Math.min(patchSlow, p.slow);
            p.tick -= dt;
            if (p.tick <= 0) { /* tick handled globally below */ }
        });

        let speed = e.speed;
        if (now < e.slowUntil) speed *= e.slowMult;
        speed *= patchSlow;
        e.dist += speed * dt / 1000;

        const pos = tgEnemyPos(g, e);
        e.x = pos.x; e.y = pos.y;
        if (pos.done) { tgLeak(g, e); return; }

        // shaman heals nearby trolls
        if (e.def.heal) {
            e.healCd -= dt;
            if (e.healCd <= 0) {
                e.healCd = e.def.heal.cd;
                let healed = false;
                g.enemies.forEach(o => {
                    if (o === e || o.dead || o.hp >= o.maxHp) return;
                    if (Math.hypot(o.x - e.x, o.y - e.y) > e.def.heal.radius) return;
                    o.hp = Math.min(o.maxHp, o.hp + e.def.heal.amount);
                    healed = true;
                });
                if (healed) g.fx.push({ type: 'ring', x: e.x, y: e.y, r: e.def.heal.radius, life: 300, maxLife: 300, color: '#6aff9a' });
            }
        }
        // the king calls in reinforcements
        if (e.def.summon) {
            e.summonCd -= dt;
            if (e.summonCd <= 0) {
                e.summonCd = e.def.summon.cd;
                for (let i = 0; i < e.def.summon.count; i++) {
                    tgSpawn(g, e.def.summon.id);
                    const spawned = g.enemies[g.enemies.length - 1];
                    spawned.dist = Math.max(0, e.dist - 20 - i * 14);
                }
            }
        }
        if (e.hitFlash > 0) e.hitFlash -= dt;
    });

    // gas patch damage, applied on the patch's own tick so it can't scale with framerate
    g.patches.forEach(p => {
        p.life -= dt;
        p.dmgTick -= dt;
        if (p.dmgTick <= 0) {
            p.dmgTick = 400;
            g.enemies.forEach(e => {
                if (e.dead || e.def.flying) return;
                if (Math.hypot(p.x - e.x, p.y - e.y) > p.radius) return;
                tgHurt(g, e, p.dps * 0.4, { trueDamage: true, silent: true });
            });
        }
    });
    g.patches = g.patches.filter(p => p.life > 0);
    g.enemies = g.enemies.filter(e => !e.dead && !e.leaked);
}

function tgLeak(g, e) {
    e.leaked = true;
    g.lives -= e.def.leak;
    g.leaked++;
    tgSfx('leak');
    g.fx.push({ type: 'leak', x: e.x, y: e.y, life: 400, maxLife: 400 });
    if (g.lives <= 0) { g.lives = 0; tgEndRun(g, false); }
}

function tgHurt(g, e, amount, opts) {
    if (!e || e.dead || !e.def) return;
    opts = opts || {};
    let dmg = amount;
    if (!opts.trueDamage) {
        const armor = Math.max(0, e.armor - (opts.armorPierce || 0));
        dmg = Math.max(1, dmg - armor);
        if (e.def.shield) dmg *= (1 - e.def.shield);
    }
    dmg = Math.max(0, dmg);
    e.hp -= dmg;
    e.hitFlash = 90;
    if (opts.source) { opts.source.damageDealt += dmg; }
    if (!opts.silent) tgSfx('hit');
    if (e.hp <= 0) tgKill(g, e, opts.source);
}

function tgKill(g, e, source) {
    if (e.dead) return;
    e.dead = true;
    g.kills++;
    if (source) source.kills++;
    const bounty = Math.round(e.def.bounty * (1 + tgMetaBonus(g.meta, 'gold')));
    g.gold += bounty;
    tgSfx('die');
    g.floaters.push({ x: e.x, y: e.y - 10, text: `+${bounty}`, life: 550, vy: -24, color: '#ffd400' });
    for (let i = 0; i < (e.def.boss ? 16 : 4); i++) {
        const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 70;
        g.fx.push({ type: 'bit', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 350, maxLife: 350, color: e.def.boss ? '#ffd400' : '#8fbf6a' });
    }
}

// ===================================================================
// towers firing
// ===================================================================
function tgPickTarget(g, t) {
    const range = tgStat(g, t, 'range');
    const minRange = t.def.minRange || 0;
    let best = null, bestKey = null;
    g.enemies.forEach(e => {
        if (e.dead) return;
        if (e.def.flying && !t.def.air) return;
        const d = Math.hypot(e.x - t.x, e.y - t.y);
        if (d > range || d < minRange) return;
        // lowest key wins, so each mode just picks the right sort value
        let key;
        switch (t.mode) {
            case 'last': key = tgProgress(g, e); break;    // least far along
            case 'strong': key = -e.hp; break;
            case 'weak': key = e.hp; break;
            case 'close': key = d; break;
            case 'first':
            default: key = -tgProgress(g, e); break;       // furthest along
        }
        if (bestKey === null || key < bestKey) { bestKey = key; best = e; }
    });
    return best;
}

function tgUpdateTowers(g, dt) {
    g.towers.forEach(t => {
        if (t.def.kind === 'support') return;
        t.cd -= dt;
        if (t.cd > 0) return;
        const target = tgPickTarget(g, t);
        if (!target) return;
        t.cd = tgStat(g, t, 'cd');
        t.angle = Math.atan2(target.y - t.y, target.x - t.x);
        tgFire(g, t, target);
    });
}

function tgFire(g, t, target) {
    const def = t.def;
    const dmg = tgStat(g, t, 'dmg') || 0;
    tgSfx(def.kind === 'chain' ? 'zap' : 'shoot');

    if (def.kind === 'ground') {
        g.shots.push({ kind: 'patch', x: t.x, y: t.y, tx: target.x, ty: target.y, speed: def.projSpeed, patch: tgStat(g, t, 'patch'), src: t });
        return;
    }
    if (def.kind === 'chain') {
        // instant arc — hits the target then jumps to the nearest unhit trolls
        let cur = target, hit = new Set(), d = dmg;
        const chain = tgStat(g, t, 'chain');
        const pts = [{ x: t.x, y: t.y }];
        for (let i = 0; i < chain && cur; i++) {
            hit.add(cur);
            pts.push({ x: cur.x, y: cur.y });
            tgHurt(g, cur, d, { source: t, silent: i > 0 });
            d *= def.chainFalloff;
            let next = null, nd = 90;
            g.enemies.forEach(e => {
                if (e.dead || hit.has(e)) return;
                if (e.def.flying && !def.air) return;
                const dist = Math.hypot(e.x - cur.x, e.y - cur.y);
                if (dist < nd) { nd = dist; next = e; }
            });
            cur = next;
        }
        g.fx.push({ type: 'chain', pts, life: 160, maxLife: 160 });
        return;
    }
    if (def.kind === 'single' && def.projSpeed >= 999) {
        // flame sconce: instant, short range, mostly a burn applicator
        tgHurt(g, target, dmg, { source: t, armorPierce: def.armorPierce, trueDamage: def.trueDamage, silent: true });
        const burn = tgStat(g, t, 'burn');
        if (burn) { target.burnUntil = performance.now() + burn.dur; target.burnDps = burn.dps; }
        g.fx.push({ type: 'beam', x1: t.x, y1: t.y, x2: target.x, y2: target.y, life: 90, maxLife: 90, color: '#ff9a3a' });
        return;
    }
    g.shots.push({
        kind: def.kind, x: t.x, y: t.y, target, speed: def.projSpeed, dmg,
        splash: tgStat(g, t, 'splash'), pierce: tgStat(g, t, 'pierce') || 0,
        slow: tgStat(g, t, 'slow'), burn: tgStat(g, t, 'burn'),
        armorPierce: def.armorPierce, trueDamage: def.trueDamage,
        air: def.air, src: t, hit: new Set()
    });
}

function tgUpdateShots(g, dt) {
    g.shots.forEach(s => {
        if (s.dead) return;
        let tx, ty;
        if (s.kind === 'patch') { tx = s.tx; ty = s.ty; }
        else {
            if (!s.target || s.target.dead) {
                // keep flying to where it was aimed rather than vanishing
                s.target = null;
                tx = s.lastX !== undefined ? s.lastX : s.x;
                ty = s.lastY !== undefined ? s.lastY : s.y;
            } else { tx = s.target.x; ty = s.target.y; s.lastX = tx; s.lastY = ty; }
        }
        const dx = tx - s.x, dy = ty - s.y;
        const d = Math.hypot(dx, dy) || 1;
        const step = s.speed * dt / 1000;
        if (d <= step + 4) {
            s.x = tx; s.y = ty;
            tgShotImpact(g, s);
            if (!s.pierce || s.kind !== 'pierce') s.dead = true;
        } else {
            s.x += dx / d * step;
            s.y += dy / d * step;
            if (s.kind === 'pierce') tgPierceCheck(g, s);
        }
        if (s.x < -40 || s.x > TP.W + 40 || s.y < -40 || s.y > TP.H + 40) s.dead = true;
    });
    g.shots = g.shots.filter(s => !s.dead);
}

function tgPierceCheck(g, s) {
    g.enemies.forEach(e => {
        if (e.dead || s.hit.has(e)) return;
        if (e.def.flying && !s.air) return;
        if (Math.hypot(e.x - s.x, e.y - s.y) > e.def.size / 2 + 5) return;
        s.hit.add(e);
        tgHurt(g, e, s.dmg, { source: s.src, armorPierce: s.armorPierce, trueDamage: s.trueDamage });
        if (s.hit.size >= s.pierce) s.dead = true;
    });
}

function tgShotImpact(g, s) {
    if (s.kind === 'patch') {
        const p = s.patch;
        g.patches.push({ x: s.x, y: s.y, radius: p.radius, dps: p.dps, slow: p.slow, life: p.dur, dmgTick: 0, tick: 0 });
        g.fx.push({ type: 'ring', x: s.x, y: s.y, r: p.radius, life: 300, maxLife: 300, color: '#9ad14a' });
        return;
    }
    if (s.kind === 'splash') {
        tgSfx('boom');
        g.fx.push({ type: 'ring', x: s.x, y: s.y, r: s.splash, life: 240, maxLife: 240, color: '#ffb03a' });
        g.enemies.forEach(e => {
            if (e.dead) return;
            if (e.def.flying && !s.air) return;
            if (Math.hypot(e.x - s.x, e.y - s.y) > s.splash) return;
            tgHurt(g, e, s.dmg, { source: s.src, armorPierce: s.armorPierce, trueDamage: s.trueDamage, silent: true });
        });
        return;
    }
    if (s.kind === 'pierce') { tgPierceCheck(g, s); return; }
    // plain single target
    if (s.target && !s.target.dead) {
        tgHurt(g, s.target, s.dmg, { source: s.src, armorPierce: s.armorPierce, trueDamage: s.trueDamage });
        if (s.slow) { s.target.slowUntil = performance.now() + s.slow.dur; s.target.slowMult = s.slow.mult; }
        if (s.burn) { s.target.burnUntil = performance.now() + s.burn.dur; s.target.burnDps = s.burn.dps; }
    }
}

function tgUpdateFx(g, dt) {
    g.fx.forEach(f => {
        f.life -= dt;
        if (f.type === 'bit') { f.x += f.vx * dt / 1000; f.y += f.vy * dt / 1000; f.vx *= 0.93; f.vy *= 0.93; }
    });
    g.fx = g.fx.filter(f => f.life > 0);
    g.floaters.forEach(f => { f.life -= dt; f.y += f.vy * dt / 1000; });
    g.floaters = g.floaters.filter(f => f.life > 0);
}

// ===================================================================
// main loop
// ===================================================================
function tgStep(g, dt) {
    if (g.phase === 'prep') {
        g.prepLeft -= dt;
        if (g.prepLeft <= 0) tgStartWave(g);
    }
    tgUpdateSpawns(g, dt);
    tgUpdateEnemies(g, dt);
    tgUpdateTowers(g, dt);
    tgUpdateShots(g, dt);
    tgUpdateFx(g, dt);
    tgCheckWaveEnd(g);
}

function tgTick(t) {
    const g = TG;
    if (!g || g.screen !== 'play') { tgRAF = null; return; }
    const raw = Math.min(50, tgLastT ? t - tgLastT : 16);
    tgLastT = t;
    if (!g.paused) {
        // run the sim in fixed slices so 3x speed can't tunnel through collisions
        let budget = raw * g.speed;
        while (budget > 0) {
            const slice = Math.min(20, budget);
            tgStep(g, slice);
            budget -= slice;
            if (g.screen !== 'play') break;
        }
    }
    if (g.screen === 'play') {
        tgDraw(g);
        tgUpdateHud(g);
        tgRAF = requestAnimationFrame(tgTick);
    } else { tgRAF = null; tgRender(); }
}
function tgLoopStart() { tgLastT = 0; if (!tgRAF) tgRAF = requestAnimationFrame(tgTick); }
function tgLoopStop() { if (tgRAF) { cancelAnimationFrame(tgRAF); tgRAF = null; } }

// ===================================================================
// rendering
// ===================================================================
function tgDraw(g) {
    const cv = tgWinBody && tgWinBody.querySelector('#tg-canvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const map = g.map;

    ctx.fillStyle = map.ground;
    ctx.fillRect(0, 0, TP.W, TP.H);

    // buildable grid
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= TP.COLS; x++) { ctx.beginPath(); ctx.moveTo(x * TP.CELL, 0); ctx.lineTo(x * TP.CELL, TP.H); ctx.stroke(); }
    for (let y = 0; y <= TP.ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * TP.CELL); ctx.lineTo(TP.W, y * TP.CELL); ctx.stroke(); }

    // the road
    ctx.fillStyle = map.road;
    g.path.cells.forEach(idx => {
        const cx = idx % TP.COLS, cy = Math.floor(idx / TP.COLS);
        ctx.fillRect(cx * TP.CELL, cy * TP.CELL, TP.CELL, TP.CELL);
    });
    // spawn and gate both sit one cell off the board, so clamp their markers back
    // onto the canvas edge or they get drawn where nobody can see them
    const clampX = x => Math.min(TP.W - 6, Math.max(6, x));
    const clampY = y => Math.min(TP.H - 6, Math.max(6, y));
    const start = g.path.pts[0];
    ctx.fillStyle = 'rgba(160,120,220,0.75)';
    ctx.fillRect(clampX(start.x) - 4, clampY(start.y) - TP.CELL / 2, 8, TP.CELL);
    ctx.fillStyle = '#e0d0ff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SPAWN', clampX(start.x) + 14, clampY(start.y) - TP.CELL / 2 - 4);

    const end = g.path.pts[g.path.pts.length - 1];
    const gx = clampX(end.x), gy = clampY(end.y);
    ctx.fillStyle = '#c94a3a';
    ctx.fillRect(gx - 5, gy - TP.CELL / 2, 10, TP.CELL);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('GATE', gx - 14, gy - TP.CELL / 2 - 4);

    // gas patches under everything
    g.patches.forEach(p => {
        ctx.fillStyle = `rgba(120,200,60,${0.16 * Math.min(1, p.life / 800)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
    });

    // build preview
    if (g.selectedTower && g.hover) {
        const def = TP.TOWERS_BY_ID[g.selectedTower];
        const free = tgCellFree(g, g.hover.cx, g.hover.cy);
        const px = g.hover.cx * TP.CELL, py = g.hover.cy * TP.CELL;
        ctx.fillStyle = free ? 'rgba(120,220,120,0.28)' : 'rgba(220,80,80,0.3)';
        ctx.fillRect(px, py, TP.CELL, TP.CELL);
        if (free && def.range) {
            const r = def.range * (1 + tgMetaBonus(g.meta, 'range'));
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.beginPath(); ctx.arc(px + TP.CELL / 2, py + TP.CELL / 2, r, 0, Math.PI * 2); ctx.stroke();
            if (def.minRange) { ctx.strokeStyle = 'rgba(255,120,120,0.4)'; ctx.beginPath(); ctx.arc(px + TP.CELL / 2, py + TP.CELL / 2, def.minRange, 0, Math.PI * 2); ctx.stroke(); }
        }
    }
    // selected tower's range
    if (g.selected) {
        const r = tgStat(g, g.selected, 'range');
        ctx.strokeStyle = 'rgba(255,212,0,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(g.selected.x, g.selected.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffd400';
        ctx.strokeRect(g.selected.cx * TP.CELL + 1, g.selected.cy * TP.CELL + 1, TP.CELL - 2, TP.CELL - 2);
    }

    // towers
    g.towers.forEach(t => {
        const px = t.cx * TP.CELL, py = t.cy * TP.CELL;
        ctx.fillStyle = t.def.kind === 'support' ? '#3f5a2a' : '#2c3a44';
        ctx.fillRect(px + 2, py + 2, TP.CELL - 4, TP.CELL - 4);
        ctx.strokeStyle = map.accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px + 2, py + 2, TP.CELL - 4, TP.CELL - 4);
        ctx.font = '16px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.def.icon, t.x, t.y + 1);
        if (t.level > 0) {
            ctx.fillStyle = '#ffd400';
            ctx.font = 'bold 9px monospace';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText('★'.repeat(t.level), t.x, py + TP.CELL - 2);
        }
        ctx.textBaseline = 'alphabetic';
    });

    // enemies — every troll is drawn as a round unit token: an opaque disc in the
    // type's colour with the sprite multiplied on top. three of the site's gifs have
    // an opaque white background, and multiply turns that white into the disc colour
    // while leaving the dark linework alone — so they read as units instead of white
    // boxes, and they keep animating (a pre-processed static canvas would not).
    g.enemies.forEach(e => {
        const img = tgImg(e.def.sprite);
        const s = e.def.size;
        const r = s / 2;
        ctx.save();
        if (e.def.flying) { ctx.shadowColor = '#7fd0ff'; ctx.shadowBlur = 8; }
        else if (e.def.boss) { ctx.shadowColor = '#ff5a5a'; ctx.shadowBlur = 10; }
        ctx.fillStyle = e.def.token || '#8a6';
        ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        if (img.complete && img.naturalWidth) {
            ctx.save();
            ctx.beginPath(); ctx.arc(e.x, e.y, r - 1, 0, Math.PI * 2); ctx.clip();
            ctx.globalCompositeOperation = 'multiply';
            if (e.hitFlash > 0) ctx.filter = 'brightness(1.6)';
            ctx.drawImage(img, e.x - r, e.y - r, s, s);
            ctx.restore();
        }

        // rim: white flash on hit, red for bosses, cyan for fliers, dark otherwise
        ctx.save();
        ctx.lineWidth = e.def.boss ? 2 : 1.5;
        ctx.strokeStyle = e.hitFlash > 0 ? '#fff'
            : e.def.boss ? '#ff5a5a'
                : e.def.flying ? '#7fd0ff'
                    : e.def.armor >= 6 ? '#8fa4b4' : 'rgba(0,0,0,0.55)';
        ctx.beginPath(); ctx.arc(e.x, e.y, r - 0.5, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        if (performance.now() < e.burnUntil) {
            ctx.fillStyle = 'rgba(255,140,40,0.5)';
            ctx.beginPath(); ctx.arc(e.x, e.y, s / 2 + 2, 0, Math.PI * 2); ctx.fill();
        }
        if (performance.now() < e.slowUntil) {
            ctx.strokeStyle = 'rgba(120,200,255,0.8)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(e.x, e.y, s / 2 + 2, 0, Math.PI * 2); ctx.stroke();
        }
        if (e.hp < e.maxHp) {
            const bw = Math.max(16, s);
            ctx.fillStyle = '#000'; ctx.fillRect(e.x - bw / 2, e.y - s / 2 - 6, bw, 3);
            ctx.fillStyle = e.def.boss ? '#ff5a5a' : '#7ee06a';
            ctx.fillRect(e.x - bw / 2, e.y - s / 2 - 6, bw * Math.max(0, e.hp / e.maxHp), 3);
        }
    });

    // shots
    g.shots.forEach(s => {
        ctx.fillStyle = s.kind === 'patch' ? '#9ad14a' : s.kind === 'splash' ? '#ffb03a' : '#ffe9a0';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.kind === 'splash' ? 4 : 3, 0, Math.PI * 2); ctx.fill();
    });

    // fx
    g.fx.forEach(f => {
        const a = f.life / f.maxLife;
        if (f.type === 'ring') {
            ctx.strokeStyle = f.color.replace(')', `,${a})`).replace('rgb', 'rgba');
            ctx.globalAlpha = a; ctx.strokeStyle = f.color; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.1 - a * 0.1), 0, Math.PI * 2); ctx.stroke();
            ctx.globalAlpha = 1;
        } else if (f.type === 'chain') {
            ctx.globalAlpha = a; ctx.strokeStyle = '#9ad8ff'; ctx.lineWidth = 2;
            ctx.beginPath();
            f.pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
            ctx.stroke(); ctx.globalAlpha = 1;
        } else if (f.type === 'beam') {
            ctx.globalAlpha = a; ctx.strokeStyle = f.color; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke(); ctx.globalAlpha = 1;
        } else if (f.type === 'bit') {
            ctx.globalAlpha = a; ctx.fillStyle = f.color;
            ctx.beginPath(); ctx.arc(f.x, f.y, 2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        } else if (f.type === 'leak') {
            ctx.globalAlpha = a; ctx.strokeStyle = '#ff4a4a'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(f.x, f.y, 20 * (1.4 - a), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
        }
    });

    // floating text
    g.floaters.forEach(f => {
        ctx.globalAlpha = Math.min(1, f.life / 500);
        ctx.fillStyle = f.color;
        ctx.font = f.big ? 'bold 14px monospace' : 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y);
        ctx.globalAlpha = 1;
    });

    if (g.paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, TP.W, TP.H);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED', TP.W / 2, TP.H / 2);
    }
}

function tgUpdateHud(g) {
    const b = tgWinBody;
    if (!b) return;
    const set = (sel, txt) => { const el = b.querySelector(sel); if (el && el.textContent !== txt) el.textContent = txt; };
    set('#tg-lives', String(g.lives));
    set('#tg-gold', `$${g.gold}`);
    set('#tg-wave', `${g.wave}/${TP.TOTAL_WAVES}`);
    const phase = b.querySelector('#tg-phase');
    if (phase) {
        if (g.phase === 'prep') phase.textContent = `build — ${Math.ceil(g.prepLeft / 1000)}s`;
        else phase.textContent = `${g.enemies.length + g.spawnQueue.length} trolls`;
    }
    const early = b.querySelector('#tg-early');
    if (early) early.style.visibility = g.phase === 'prep' ? 'visible' : 'hidden';
}

// ===================================================================
// screens
// ===================================================================
function tgRender() {
    if (!tgWinBody || !TG) return;
    const g = TG;
    const screens = { menu: tgRenderMenu, meta: tgRenderMeta, maps: tgRenderMaps, play: tgRenderPlay, over: tgRenderEnd, won: tgRenderEnd };
    tgWinBody.innerHTML = (screens[g.screen] || tgRenderMenu)(g);
    tgBind(g);
    if (g.screen === 'play') { tgDraw(g); tgUpdateHud(g); tgLoopStart(); }
}

function tgRenderMenu(g) {
    const m = g.meta;
    const totalBest = Math.max(0, ...Object.values(m.bestWave || {}), 0);
    return `<div class="tg-menu">
        <h2 class="tg-title">SIR, WE HAVE A<br>TROLL PROBLEM</h2>
        <p class="tg-sub">they come down the road in their thousands. build the wall.</p>
        ${tgHasRunSave() ? `<button class="tg-btn tg-wide tg-go" data-act="resume">continue run</button>` : ''}
        <button class="tg-btn tg-wide ${tgHasRunSave() ? '' : 'tg-go'}" data-act="maps">choose a map</button>
        <button class="tg-btn tg-wide" data-act="meta">💎 upgrades &nbsp;<b>${m.crystals}</b> crystals</button>
        <div class="tg-statsgrid">
            <div><b>${totalBest}</b><span>best wave</span></div>
            <div><b>${m.totalKills}</b><span>trolls slain</span></div>
            <div><b>${m.runs}</b><span>runs</span></div>
            <div><b>${m.unlockedTowers.length}/${TP.TOWERS.length}</b><span>towers</span></div>
        </div>
        ${m.cleared ? '<p class="tg-cleared">👑 you have held the gate to the very end</p>' : ''}
        <p class="tg-label">armory</p>
        <div class="tg-armory">${TP.TOWERS.map(t => `<span class="tg-armory-item${m.unlockedTowers.includes(t.id) ? ' got' : ''}" title="${escapeHtml(t.name)}">${m.unlockedTowers.includes(t.id) ? t.icon : '🔒'}</span>`).join('')}</div>
        <p class="tg-hint">click a tower, click the ground to build. towers only go beside the road, never on it.</p>
    </div>`;
}

function tgRenderMaps(g) {
    const m = g.meta;
    return `<div class="tg-menu">
        <div class="tg-shophead"><h3>choose your ground</h3>
            <button class="tg-btn tg-small" data-act="menu">back</button></div>
        <div class="tg-maplist">${TP.MAPS.map(map => {
        const locked = !m.unlockedMaps.includes(map.id);
        const best = m.bestWave[map.id] || 0;
        return `<button class="tg-mapcard${locked ? ' locked' : ''}" ${locked ? '' : `data-map="${map.id}"`}>
                <span class="tg-mapname" style="color:${map.accent}">${locked ? '🔒 ' : ''}${escapeHtml(map.name)}</span>
                <span class="tg-mapblurb">${locked ? `clear wave ${TP.MAP_UNLOCK_WAVE} on the previous map` : escapeHtml(map.blurb)}</span>
                <span class="tg-mapmeta">difficulty x${map.difficulty} &middot; best wave ${best}</span>
            </button>`;
    }).join('')}</div>
    </div>`;
}

function tgRenderMeta(g) {
    const m = g.meta;
    return `<div class="tg-menu">
        <div class="tg-shophead"><h3>💎 permanent upgrades</h3>
            <span class="tg-goldstat">${m.crystals} crystals</span>
            <button class="tg-btn tg-small" data-act="menu">back</button></div>
        <p class="tg-hint" style="text-align:left">crystals are earned every run, win or lose. these never reset.</p>
        <div class="tg-offers">${TP.META.map(node => {
        const lvl = tgMetaLevel(m, node.id);
        const maxed = lvl >= node.max;
        const cost = tgMetaCost(m, node.id);
        return `<div class="tg-offer">
                <span class="tg-offer-icon">${node.icon}</span>
                <div class="tg-offer-info"><b>${escapeHtml(node.name)} <span class="tg-lvl">${lvl}/${node.max}</span></b>
                    <span>${escapeHtml(node.text)}</span></div>
                ${maxed ? '<span class="tg-maxed">MAX</span>'
                : `<button class="tg-btn tg-buy${m.crystals < cost ? ' tg-poor' : ''}" data-meta="${node.id}">💎${cost}</button>`}
            </div>`;
    }).join('')}</div>
    </div>`;
}

function tgRenderPlay(g) {
    const m = g.meta;
    const next = TP.WAVES[Math.min(g.wave, TP.WAVES.length) - 1];
    const preview = next.map(([id, count]) => `${count}× ${TP.ENEMIES[id].name.replace(' Troll', '')}`).join(', ');
    return `<div class="tg-topbar">
        <span class="tg-stat tg-lives">❤️ <b id="tg-lives">${g.lives}</b></span>
        <span class="tg-stat tg-goldstat">💰 <b id="tg-gold">$${g.gold}</b></span>
        <span class="tg-stat">🌊 <b id="tg-wave">${g.wave}/${TP.TOTAL_WAVES}</b></span>
        <span class="tg-stat" id="tg-phase"></span>
        <span class="tg-speeds">
            <button class="tg-sbtn${g.paused ? ' on' : ''}" data-speed="pause">⏸</button>
            ${TP.SPEEDS.map(s => `<button class="tg-sbtn${!g.paused && g.speed === s ? ' on' : ''}" data-speed="${s}">${s}×</button>`).join('')}
        </span>
        <button class="tg-btn tg-small" data-act="quit">quit</button>
    </div>
    <div class="tg-waveinfo">next: ${escapeHtml(preview)}${TP.isBossWave(g.wave) ? ' <b class="tg-bosstag">BOSS</b>' : ''}
        <button class="tg-btn tg-small tg-go" id="tg-early" data-act="early">send them in +$${Math.floor((g.prepLeft / 1000) * TP.EARLY_BONUS_PER_SEC)}</button></div>
    <canvas id="tg-canvas" class="tg-canvas bevel-in" width="${TP.W}" height="${TP.H}"></canvas>
    <div class="tg-buildbar">${TP.TOWERS.filter(t => m.unlockedTowers.includes(t.id)).map(t => {
        const cost = tgTowerCost(g, t);
        return `<button class="tg-tbtn${g.selectedTower === t.id ? ' sel' : ''}${g.gold < cost ? ' tg-poor' : ''}" data-tower="${t.id}" title="${escapeHtml(t.name)} — ${escapeHtml(t.text)}">
            <span class="tg-ticon">${t.icon}</span><span class="tg-tcost">$${cost}</span></button>`;
    }).join('')}</div>
    ${g.selected ? tgInspectorHtml(g, g.selected)
        : tgAiming(g) ? tgAimHtml(g)
        : `<div class="tg-inspect tg-inspect-empty">${tgTouch()
            ? 'tap a tower to inspect it · tap a build button, then the arena, then build'
            : 'click a tower to inspect it · click a build button then the ground to place'}</div>`}`;
}

// Is the thing pointing at this screen a fingertip? Asked fresh each render,
// because a tablet with a keyboard folded round the back changes its mind.
function tgTouch() { return !!(window.TOUCH && TOUCH.coarse()); }

// aiming is the touch half of building: a tower is chosen, a cell is under
// the ghost, and nothing is committed until the build button is pressed
function tgAiming(g) { return tgTouch() && !!g.selectedTower && !!g.hover; }

// A mouse shows you where a tower is going by hovering: the cell lights up
// green or red and the range circle is drawn before you commit. A finger
// has no hover, so the tap that used to build blind now aims instead, and
// this is what it aims with.
//
// It is not merely a confirmation step. At the width a 640px arena renders
// on a phone a cell is about eighteen pixels across, so the fingertip that
// placed the tower covered three of them and you could not see which one
// you were going to get until you had already paid for it.
function tgAimHtml(g) {
    const def = TP.TOWERS_BY_ID[g.selectedTower];
    if (!def) return '';
    const cost = tgTowerCost(g, def);
    const free = tgCellFree(g, g.hover.cx, g.hover.cy);
    const poor = g.gold < cost;
    const why = !free ? 'towers only go beside the road, never on it'
        : poor ? `you have $${g.gold}` : 'or tap somewhere else to move it';
    return `<div class="tg-inspect tg-aim">
        <span class="tg-offer-icon">${def.icon}</span>
        <div class="tg-offer-info"><b>${escapeHtml(def.name)}</b><span>${escapeHtml(why)}</span></div>
        <button class="tg-btn tg-buy${free && !poor ? ' tg-go' : ' tg-poor'}" data-act="place">build $${cost}</button>
        <button class="tg-btn tg-buy" data-act="aimoff">cancel</button>
    </div>`;
}

function tgInspectorHtml(g, t) {
    const upCost = tgUpgradeCost(g, t);
    const dmg = tgStat(g, t, 'dmg');
    const rate = tgStat(g, t, 'cd');
    return `<div class="tg-inspect">
        <span class="tg-offer-icon">${t.def.icon}</span>
        <div class="tg-offer-info">
            <b>${escapeHtml(t.def.name)} ${t.level ? '★'.repeat(t.level) : ''}</b>
            <span>${dmg ? `dmg ${Math.round(dmg)} · ` : ''}${rate ? `${(1000 / rate).toFixed(1)}/s · ` : ''}range ${Math.round(tgStat(g, t, 'range'))} · ${t.kills} kills</span>
        </div>
        <select class="tg-select" data-mode>${TP.TARGET_MODES.map(m => `<option value="${m.id}"${t.mode === m.id ? ' selected' : ''}>${m.name}</option>`).join('')}</select>
        ${upCost !== null ? `<button class="tg-btn tg-buy${g.gold < upCost ? ' tg-poor' : ''}" data-act="upgrade">up $${upCost}</button>` : '<span class="tg-maxed">MAX</span>'}
        <button class="tg-btn tg-buy" data-act="sell">sell $${Math.floor(t.spent * TP.SELL_REFUND)}</button>
    </div>`;
}

function tgRenderEnd(g) {
    const won = g.screen === 'won';
    return `<div class="tg-end">
        <h2 class="tg-title ${won ? 'tg-win' : 'tg-lose'}">${won ? 'the gate held' : 'the gate has fallen'}</h2>
        <p>${won ? `all ${TP.TOTAL_WAVES} waves turned back on ${escapeHtml(g.map.name)}.` : `they got through on wave ${g.wave} of ${escapeHtml(g.map.name)}.`}</p>
        <p class="tg-sub">${g.kills} trolls slain · ${g.leaked} got past you</p>
        <p class="tg-crystals">💎 +${g.crystalsEarned} crystals</p>
        <button class="tg-btn tg-wide tg-go" data-act="meta">spend crystals</button>
        <button class="tg-btn tg-wide" data-act="maps">another run</button>
        <button class="tg-btn tg-wide" data-act="menu">main menu</button>
    </div>`;
}

// ===================================================================
// input
// ===================================================================
function tgBind(g) {
    const b = tgWinBody;
    const on = (sel, fn) => b.querySelectorAll(sel).forEach(el => el.onclick = e => { e.stopPropagation(); fn(el, e); });

    on('[data-act]', el => tgAction(el.dataset.act));
    on('[data-map]', el => {
        const map = TP.MAPS.find(m => m.id === el.dataset.map);
        if (!map) return;
        tgClearRunSave();
        tgNewRun(map);
        TG.screen = 'play';
        tgSfx('build');
        tgRender();
    });
    on('[data-meta]', el => {
        const id = el.dataset.meta;
        const cost = tgMetaCost(g.meta, id);
        if (g.meta.crystals < cost) { tgSfx('error'); return; }
        if (tgMetaLevel(g.meta, id) >= TP.META_BY_ID[id].max) return;
        g.meta.crystals -= cost;
        g.meta.spent[id] = tgMetaLevel(g.meta, id) + 1;
        tgSaveMeta(g.meta);
        tgSfx('crystal');
        tgRender();
    });
    on('[data-tower]', el => {
        g.selectedTower = g.selectedTower === el.dataset.tower ? null : el.dataset.tower;
        g.selected = null;
        g.hover = null;
        tgSfx('shoot');
        tgRender();
    });
    on('[data-speed]', el => {
        const v = el.dataset.speed;
        if (v === 'pause') g.paused = !g.paused;
        else { g.paused = false; g.speed = +v; }
        tgRender();
    });
    const modeSel = b.querySelector('[data-mode]');
    if (modeSel) modeSel.onchange = () => { if (g.selected) g.selected.mode = modeSel.value; };

    const cv = b.querySelector('#tg-canvas');
    if (cv) {
        const cellFrom = e => {
            const r = cv.getBoundingClientRect();
            const scale = TP.W / r.width;
            return {
                cx: Math.floor((e.clientX - r.left) * scale / TP.CELL),
                cy: Math.floor((e.clientY - r.top) * scale / TP.CELL)
            };
        };
        // a touchscreen synthesises one mousemove just before the click, at
        // the point of the tap, which would set the ghost and immediately
        // build on it — the whole thing this is trying to avoid
        cv.onmousemove = e => { if (!tgTouch()) g.hover = cellFrom(e); };
        cv.onmouseleave = () => { if (!tgTouch()) g.hover = null; };
        cv.onclick = e => {
            const { cx, cy } = cellFrom(e);
            const existing = g.towers.find(t => t.cx === cx && t.cy === cy);
            if (existing) { g.selected = existing; g.selectedTower = null; g.hover = null; tgRender(); return; }
            if (g.selectedTower) {
                // the tower you just built is still in the inspector, and the
                // inspector is the row the aiming prompt has to appear in
                if (tgTouch()) { g.selected = null; g.hover = { cx: cx, cy: cy }; tgSfx('shoot'); tgRender(); return; }
                tgPlaceTower(g, cx, cy); tgRender(); return;
            }
            g.selected = null;
            g.hover = null;
            tgRender();
        };
    }
}

function tgAction(act) {
    const g = TG;
    switch (act) {
        case 'maps': tgLoopStop(); g.screen = 'maps'; tgRender(); break;
        case 'meta': tgLoopStop(); g.screen = 'meta'; tgRender(); break;
        case 'menu': tgLoopStop(); g.meta = tgLoadMeta(); g.screen = 'menu'; tgRender(); break;
        case 'resume': if (tgResumeRun()) tgRender(); break;
        case 'early': tgCallWaveEarly(g); tgRender(); break;
        case 'upgrade': if (g.selected) { tgUpgradeTower(g, g.selected); tgRender(); } break;
        case 'sell': if (g.selected) { tgSellTower(g, g.selected); tgRender(); } break;
        case 'place': if (g.hover && g.selectedTower) { tgPlaceTower(g, g.hover.cx, g.hover.cy); g.hover = null; tgRender(); } break;
        case 'aimoff': g.hover = null; g.selectedTower = null; tgRender(); break;
        case 'quit': tgLoopStop(); tgSaveRun(); g.screen = 'menu'; tgRender(); break;
    }
}

// ===================================================================
// entry point
// ===================================================================
function startTrollProblem() {
    const { body, win } = createAppWindow('sir, we have a troll problem', { icon: 'castle', width: 700 });
    body.classList.add('tg-body');
    tgWinBody = body;
    tgPreload();
    win._cleanup = () => { tgLoopStop(); tgSaveRun(); tgWinBody = null; };
    if (!TG) { tgNewRun(TP.MAPS[0]); TG.screen = 'menu'; }
    else if (TG.screen === 'play') { /* keep the run going */ }
    else { TG.meta = tgLoadMeta(); TG.screen = 'menu'; }
    tgRender();
    if (typeof unlockAchievement === 'function') unlockAchievement('troll_problem');
}
