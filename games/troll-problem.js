// ===================================================================
// SIR, WE HAVE A TROLL PROBLEM — engine
//
// A real-time horde-defense mini-game. You move Sir mrhakan around an
// arena, your equipped weapons auto-fire at the nearest troll, and the
// trolls do not stop coming. Content (weapons/enemies/waves/perks)
// lives in troll-problem-data.js; this file is the game loop, combat,
// rendering, shop and save system.
// ===================================================================

let TGRun = null;        // the active run's mutable state
let tgWinBody = null;    // the app window body we render into
let tgRAF = null;        // requestAnimationFrame handle
let tgLastT = 0;
let tgKeys = Object.create(null);
let tgTouch = { x: 0, y: 0, active: false };

// ===================================================================
// sound — same synthesis approach as jokerz 98's sound bank, kept as
// its own small copy so this game has no load-order dependency on
// balatro.js (both are independent lazy bundles).
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
function tgTone(freq, dur, opts) {
    if (!tgSoundOn()) return;
    const ctx = tgAudioCtx();
    if (!ctx) return;
    opts = opts || {};
    try {
        const t0 = ctx.currentTime + (opts.delay || 0);
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = opts.type || 'square';
        osc.frequency.setValueAtTime(Math.max(1, freq), t0);
        if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + dur);
        const peak = opts.gain !== undefined ? opts.gain : 0.08;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur / 3));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
    } catch (e) { }
}
function tgNoise(dur, opts) {
    if (!tgSoundOn()) return;
    const ctx = tgAudioCtx();
    if (!ctx) return;
    opts = opts || {};
    try {
        const t0 = ctx.currentTime + (opts.delay || 0);
        const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buf = ctx.createBuffer(1, n, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(opts.filterStart || 3500, t0);
        if (opts.filterEnd) filter.frequency.exponentialRampToValueAtTime(opts.filterEnd, t0 + dur);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(opts.gain || 0.1, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
        src.start(t0);
    } catch (e) { }
}
function tgSfx(name, opts) {
    opts = opts || {};
    switch (name) {
        case 'swing': tgNoise(0.09, { filterStart: 2600, filterEnd: 900, gain: 0.09 }); break;
        case 'shoot': tgTone(520, 0.05, { type: 'triangle', gain: 0.06, slideTo: 700 }); break;
        case 'hit': tgTone(180 + Math.random() * 60, 0.05, { type: 'square', gain: 0.05 }); break;
        case 'crit': tgTone(300, 0.08, { type: 'sawtooth', gain: 0.08, slideTo: 120 }); break;
        case 'death': tgTone(220, 0.12, { type: 'sawtooth', gain: 0.07, slideTo: 60 }); break;
        case 'boss_death': tgTone(160, 0.4, { type: 'sawtooth', gain: 0.1, slideTo: 40 }); tgTone(100, 0.5, { type: 'sawtooth', gain: 0.08, delay: 0.12, slideTo: 30 }); break;
        case 'gold': tgTone(1046, 0.05, { type: 'square', gain: 0.06 }); tgTone(1568, 0.07, { type: 'square', gain: 0.06, delay: 0.04 }); break;
        case 'hurt': tgTone(140, 0.13, { type: 'sawtooth', gain: 0.09 }); break;
        case 'levelup': tgTone(523, 0.08, { type: 'square', gain: 0.08 }); tgTone(659, 0.08, { type: 'square', gain: 0.08, delay: 0.07 }); tgTone(784, 0.12, { type: 'square', gain: 0.08, delay: 0.14 }); break;
        case 'wave_clear': tgTone(392, 0.1, { type: 'triangle', gain: 0.08 }); tgTone(523, 0.1, { type: 'triangle', gain: 0.08, delay: 0.09 }); tgTone(659, 0.16, { type: 'triangle', gain: 0.08, delay: 0.18 }); break;
        case 'boss_warn': tgTone(110, 0.3, { type: 'sawtooth', gain: 0.1 }); tgTone(110, 0.3, { type: 'sawtooth', gain: 0.1, delay: 0.4 }); break;
        case 'buy': tgTone(660, 0.05, { type: 'square', gain: 0.07 }); tgTone(990, 0.07, { type: 'square', gain: 0.07, delay: 0.05 }); break;
        case 'error': tgTone(180, 0.1, { type: 'sawtooth', gain: 0.07 }); break;
        case 'gameover': tgTone(392, 0.18, { type: 'sawtooth', gain: 0.09, slideTo: 200 }); tgTone(200, 0.35, { type: 'sawtooth', gain: 0.08, delay: 0.16, slideTo: 90 }); break;
        case 'victory': tgTone(523, 0.13, { type: 'square', gain: 0.1 }); tgTone(659, 0.13, { type: 'square', gain: 0.1, delay: 0.12 }); tgTone(784, 0.13, { type: 'square', gain: 0.1, delay: 0.24 }); tgTone(1046, 0.4, { type: 'square', gain: 0.11, delay: 0.36 }); break;
        case 'revive': tgTone(300, 0.1, { type: 'sine', gain: 0.08 }); tgTone(500, 0.1, { type: 'sine', gain: 0.08, delay: 0.08 }); tgTone(800, 0.2, { type: 'sine', gain: 0.08, delay: 0.16 }); break;
    }
}

// ===================================================================
// sprite loading
// ===================================================================
const tgImgCache = Object.create(null);
function tgImg(src) {
    if (!tgImgCache[src]) {
        const img = new Image();
        img.src = src;
        tgImgCache[src] = img;
    }
    return tgImgCache[src];
}
function tgPreload() {
    tgImg('src/emoj/dusung.png');
    Object.values(TP.ENEMIES).forEach(e => tgImg(e.sprite));
}

// ===================================================================
// save / load
// ===================================================================
const TG_META_KEY = 'trollproblem-meta';
const TG_RUN_KEY = 'trollproblem-run';

function tgDefaultMeta() {
    return {
        unlockedWeapons: ['shortsword'],
        unlockedSlots: TP.BASE_SLOTS,
        bestWave: 0,
        totalKills: 0,
        totalGold: 0,
        runsPlayed: 0,
        bossesSlain: 0,
        clearedGame: false
    };
}
function tgLoadMeta() {
    try {
        const raw = localStorage.getItem(TG_META_KEY);
        if (!raw) return tgDefaultMeta();
        return Object.assign(tgDefaultMeta(), JSON.parse(raw));
    } catch (e) { return tgDefaultMeta(); }
}
function tgSaveMeta(meta) {
    try { localStorage.setItem(TG_META_KEY, JSON.stringify(meta)); } catch (e) { }
}
function tgSaveRun() {
    const g = TGRun;
    if (!g || g.screen === 'over' || g.screen === 'won' || g.screen === 'menu') { tgClearRunSave(); return; }
    try {
        localStorage.setItem(TG_RUN_KEY, JSON.stringify({
            wave: g.wave, hp: g.player.hp, maxHp: g.player.maxHp, gold: g.gold,
            weapons: g.weapons, perks: g.perks, screen: g.screen === 'playing' ? 'shop' : g.screen,
            secondWindUsed: g.secondWindUsed, kills: g.kills
        }));
    } catch (e) { }
}
function tgClearRunSave() { try { localStorage.removeItem(TG_RUN_KEY); } catch (e) { } }
function tgHasRunSave() { try { return !!localStorage.getItem(TG_RUN_KEY); } catch (e) { return false; } }

// ===================================================================
// run setup
// ===================================================================
const TG_ARENA_W = 660, TG_ARENA_H = 420;

function tgNewRun() {
    const meta = tgLoadMeta();
    const g = {
        meta,
        wave: 1, gold: 0, kills: 0,
        weapons: [{ id: 'shortsword', level: 1, cd: 0 }],
        perks: {},
        secondWindUsed: false,
        player: { x: TG_ARENA_W / 2, y: TG_ARENA_H / 2, hp: 100, maxHp: 100, speed: 130, radius: 14, facing: 0, hitFlash: 0 },
        enemies: [], projectiles: [], effects: [], floaters: [], particles: [],
        spawnQueue: [], spawnTimer: 0,
        waveActive: false, waveClearedAt: 0,
        screen: 'menu', prevScreen: null,
        shop: null,
        milestoneToastQueue: [],
        elapsed: 0
    };
    TGRun = g;
    return g;
}
function tgResumeRun() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(TG_RUN_KEY)); } catch (e) { return false; }
    if (!saved) return false;
    const g = tgNewRun();
    g.wave = saved.wave; g.gold = saved.gold;
    g.player.hp = saved.hp; g.player.maxHp = saved.maxHp;
    g.weapons = saved.weapons; g.perks = saved.perks || {};
    g.secondWindUsed = !!saved.secondWindUsed;
    g.kills = saved.kills || 0;
    g.screen = 'shop';
    tgBuildShop(g);
    return true;
}

function tgMaxSlots(g) { return g.meta.unlockedSlots; }
function tgWeaponDef(id) { return TP.WEAPONS_BY_ID[id]; }
function tgPerkDef(id) { return TP.PERKS_BY_ID[id]; }
function tgPerkStacks(g, id) { return g.perks[id] || 0; }

function tgPerkTotal(g, id) {
    const def = tgPerkDef(id);
    const n = tgPerkStacks(g, id);
    if (!def || !n) return 0;
    switch (id) {
        case 'vitality': return n * 20;
        case 'swiftness': return n * 0.08;
        case 'armor': return Math.min(0.6, n * 0.05);
        case 'greed': return n * 0.15;
        case 'haste': return Math.min(0.5, n * 0.06);
        case 'vampirism': return n * 0.02;
        case 'thorns': return n * 0.15;
        case 'regen': return n;
        case 'fortune': return n * 0.03;
        case 'second_wind': return n;
    }
    return 0;
}

// weapon level -> multiplier, +22% per level above 1
function tgLevelMult(level) { return Math.pow(1.22, (level || 1) - 1); }

function tgWeaponStat(g, w, key) {
    const def = tgWeaponDef(w.id);
    const base = def[key] || 0;
    if (key === 'cd') {
        const haste = tgPerkTotal(g, 'haste');
        return Math.max(120, base * (1 - haste) / (1 + (w.level - 1) * 0.06));
    }
    if (key === 'dmg') return base * tgLevelMult(w.level);
    if (key === 'range') return base * (1 + (w.level - 1) * 0.04);
    return base;
}

// ===================================================================
// wave director
// ===================================================================
function tgWaveEnemyList(g, wave) {
    const chapter = TP.chapterForWave(wave);
    const idxInChapter = (wave - 1) % TP.WAVES_PER_CHAPTER;
    const comp = chapter.waves[idxInChapter].slice();
    const list = [];
    comp.forEach(([id, count]) => { for (let i = 0; i < count; i++) list.push(id); });
    if (TP.isBossWave(wave)) list.push(chapter.boss);
    // shuffle spawn order a little so it's not always grouped by type
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

function tgScaledStat(base, wave, rate) { return base * (1 + (wave - 1) * rate); }

function tgSpawnEnemy(g, enemyId) {
    const def = TP.ENEMIES[enemyId];
    if (!def) return;
    // spawn just outside the arena on a random edge
    const side = Math.floor(Math.random() * 4);
    let x, y;
    if (side === 0) { x = Math.random() * TG_ARENA_W; y = -30; }
    else if (side === 1) { x = TG_ARENA_W + 30; y = Math.random() * TG_ARENA_H; }
    else if (side === 2) { x = Math.random() * TG_ARENA_W; y = TG_ARENA_H + 30; }
    else { x = -30; y = Math.random() * TG_ARENA_H; }

    const hp = def.boss ? tgScaledStat(def.hp, g.wave, 0.10) : tgScaledStat(def.hp, g.wave, 0.13);
    const dmg = tgScaledStat(def.dmg, g.wave, 0.06);
    g.enemies.push({
        id: enemyId, def, x, y, hp, maxHp: hp, dmg, speed: def.speed,
        radius: def.size / 2, attackCd: 0, rangedCd: def.ranged ? Math.random() * def.ranged.cd : 0,
        pulseCd: def.pulse ? def.pulse.cd * 0.5 : 0, jitterPhase: Math.random() * Math.PI * 2,
        hitFlash: 0, slowUntil: 0, slowMult: 1, burnUntil: 0, burnTick: 0,
        knockX: 0, knockY: 0
    });
}

function tgStartWave(g) {
    g.spawnQueue = tgWaveEnemyList(g, g.wave);
    g.spawnTimer = 0;
    g.waveActive = true;
    g.enemies = [];
    g.projectiles = [];
    g.screen = 'playing';
    if (TP.isBossWave(g.wave)) {
        tgSfx('boss_warn');
        showToast('troll problem', `Boss wave: ${TP.ENEMIES[TP.chapterForWave(g.wave).boss].name}`);
    }
    tgRender();
    tgLoopStart();
}

function tgCheckWaveClear(g) {
    if (!g.waveActive) return;
    if (g.spawnQueue.length === 0 && g.enemies.length === 0) {
        g.waveActive = false;
        tgOnWaveClear(g);
    }
}

function tgOnWaveClear(g) {
    tgSfx('wave_clear');
    const bonus = 10 + g.wave * 2;
    tgGainGold(g, bonus);
    g.floaters.push({ x: g.player.x, y: g.player.y - 30, text: `wave clear +$${bonus}`, life: 1400, vy: -22, color: '#ffd400' });

    // permanent meta unlocks
    const milestone = TP.MILESTONES.find(m => m.wave === g.wave);
    if (milestone) {
        let changed = false;
        (milestone.weapons || []).forEach(id => {
            if (!g.meta.unlockedWeapons.includes(id)) { g.meta.unlockedWeapons.push(id); changed = true; g.milestoneToastQueue.push(`unlocked: ${tgWeaponDef(id).name}`); }
        });
        if (milestone.slot && g.meta.unlockedSlots < milestone.slot) { g.meta.unlockedSlots = milestone.slot; changed = true; g.milestoneToastQueue.push(`unlocked: weapon slot ${milestone.slot}`); }
        if (changed) tgSaveMeta(g.meta);
    }
    if (g.wave > g.meta.bestWave) { g.meta.bestWave = g.wave; tgSaveMeta(g.meta); }
    TP.ACHIEVEMENT_WAVES.forEach(w => {
        if (g.wave === w && typeof unlockAchievement === 'function') unlockAchievement('troll_wave_' + w);
    });

    if (g.wave >= TP.FINAL_WAVE) {
        g.screen = 'won';
        g.meta.clearedGame = true;
        tgSaveMeta(g.meta);
        tgClearRunSave();
        tgSfx('victory');
        if (typeof unlockAchievement === 'function') unlockAchievement('troll_king_slain');
        tgLoopStop();
        tgRender();
        return;
    }

    g.wave++;
    g.screen = 'shop';
    tgBuildShop(g);
    tgSaveRun();
    tgLoopStop();
    tgRender();
}

// ===================================================================
// gold / damage helpers
// ===================================================================
function tgGainGold(g, amount) {
    const bonus = 1 + tgPerkTotal(g, 'greed');
    const total = Math.round(amount * bonus);
    g.gold += total;
    g.meta.totalGold += total;
}

function tgDamagePlayer(g, amount, source) {
    if (g.player.invuln > 0) return;
    const reduce = tgPerkTotal(g, 'armor');
    const dealt = Math.max(1, Math.round(amount * (1 - reduce)));
    g.player.hp -= dealt;
    g.player.hitFlash = 220;
    g.player.invuln = 260;
    tgSfx('hurt');
    g.floaters.push({ x: g.player.x, y: g.player.y - 18, text: `-${dealt}`, life: 700, vy: -30, color: '#ff5a5a' });
    const thorns = tgPerkTotal(g, 'thorns');
    if (thorns && source) {
        const back = Math.max(1, Math.round(dealt * thorns));
        source.hp -= back;
        source.hitFlash = 150;
    }
    if (g.player.hp <= 0) tgOnPlayerDeath(g);
}

function tgOnPlayerDeath(g) {
    if (!g.secondWindUsed && tgPerkStacks(g, 'second_wind') > 0) {
        g.secondWindUsed = true;
        g.player.hp = Math.round(g.player.maxHp * 0.3);
        g.player.invuln = 1200;
        tgSfx('revive');
        showToast('troll problem', 'second wind! back up.');
        return;
    }
    g.player.hp = 0;
    g.screen = 'over';
    g.meta.runsPlayed++;
    if (g.wave > g.meta.bestWave) g.meta.bestWave = g.wave;
    tgSaveMeta(g.meta);
    tgClearRunSave();
    tgSfx('gameover');
    tgLoopStop();
    tgRender();
}

function tgDamageEnemy(g, en, amount, opts) {
    opts = opts || {};
    let dmg = amount;
    if (en.def.boss && opts.bossBonus) dmg *= opts.bossBonus;
    const crit = Math.random() < 0.08;
    if (crit) dmg *= 1.8;
    dmg = Math.round(dmg);
    en.hp -= dmg;
    en.hitFlash = 120;
    tgSfx(crit ? 'crit' : 'hit');
    g.floaters.push({ x: en.x, y: en.y - en.radius - 4, text: String(dmg), life: 500, vy: -26, color: crit ? '#ffd400' : '#fff' });

    if (opts.knockback) {
        const dx = en.x - g.player.x, dy = en.y - g.player.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        en.knockX = (dx / d) * opts.knockback;
        en.knockY = (dy / d) * opts.knockback;
    }
    if (opts.slow) { en.slowUntil = performance.now() + opts.slow.dur; en.slowMult = opts.slow.mult; }
    if (opts.burn) { en.burnUntil = performance.now() + opts.burn.dur; en.burnDmg = opts.burn.dmg; }

    const fortune = tgPerkTotal(g, 'fortune');
    if (!en.def.boss && fortune && Math.random() < fortune) en.hp = 0;

    const vamp = tgPerkTotal(g, 'vampirism');
    if (vamp) g.player.hp = Math.min(g.player.maxHp, g.player.hp + amount * vamp);

    if (en.hp <= 0) tgKillEnemy(g, en);
}

function tgKillEnemy(g, en) {
    en.dead = true;
    g.kills++;
    g.meta.totalKills++;
    tgGainGold(g, en.def.gold);
    tgSfx(en.def.boss ? 'boss_death' : 'death');
    g.floaters.push({ x: en.x, y: en.y - en.radius, text: `+$${en.def.gold}`, life: 700, vy: -24, color: '#ffd400' });
    for (let i = 0; i < (en.def.boss ? 18 : 6); i++) {
        const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 80;
        g.particles.push({ x: en.x, y: en.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 400 + Math.random() * 300, color: en.def.boss ? '#ffd400' : '#8fbf6a' });
    }
    if (en.def.boss) { g.meta.bossesSlain++; tgSaveMeta(g.meta); }
}

// ===================================================================
// combat — weapons firing, projectiles, enemy AI, contact damage
// ===================================================================
function tgNearestEnemy(g, x, y, range) {
    let best = null, bestD = range;
    g.enemies.forEach(en => {
        if (en.dead) return;
        const d = Math.hypot(en.x - x, en.y - y);
        if (d <= bestD) { bestD = d; best = en; }
    });
    return best;
}

function tgFireWeapon(g, w, dt) {
    const def = tgWeaponDef(w.id);
    w.cd -= dt;
    if (w.cd > 0) return;
    const range = tgWeaponStat(g, w, 'range');
    const target = tgNearestEnemy(g, g.player.x, g.player.y, range);
    if (!target) return;
    w.cd = tgWeaponStat(g, w, 'cd');
    const dmg = tgWeaponStat(g, w, 'dmg');

    if (def.type === 'melee') {
        tgSfx('swing');
        const angle = Math.atan2(target.y - g.player.y, target.x - g.player.x);
        g.effects.push({ type: 'swing', x: g.player.x, y: g.player.y, angle, arc: def.arc, range, life: 180, maxLife: 180 });
        const hits = def.pierceLine ? 3 : 99;
        let hitCount = 0;
        g.enemies.forEach(en => {
            if (en.dead || hitCount >= hits) return;
            const d = Math.hypot(en.x - g.player.x, en.y - g.player.y);
            if (d > range + en.radius) return;
            const a = Math.atan2(en.y - g.player.y, en.x - g.player.x);
            let diff = Math.abs(a - angle);
            if (diff > Math.PI) diff = Math.PI * 2 - diff;
            if (diff > (def.arc * Math.PI / 180) / 2) return;
            hitCount++;
            const times = def.hits || 1;
            for (let i = 0; i < times; i++) tgDamageEnemy(g, en, dmg, { bossBonus: def.bossBonus, knockback: def.knockback });
            if (def.heal) g.player.hp = Math.min(g.player.maxHp, g.player.hp + def.heal);
        });
    } else if (def.type === 'ranged') {
        tgSfx('shoot');
        g.projectiles.push({
            x: g.player.x, y: g.player.y, targetId: target.uid || (target.uid = Math.random()),
            target, vx: 0, vy: 0, speed: def.projSpeed, dmg, pierce: def.pierce || 0,
            splash: def.splash, chain: def.chain, chained: 0, slow: def.slow, weaponId: w.id, hitSet: new Set()
        });
    } else if (def.type === 'aoe') {
        tgSfx('swing');
        g.effects.push({ type: 'pulse', x: g.player.x, y: g.player.y, range, life: 260, maxLife: 260 });
        g.enemies.forEach(en => {
            if (en.dead) return;
            const d = Math.hypot(en.x - g.player.x, en.y - g.player.y);
            if (d > range + en.radius) return;
            tgDamageEnemy(g, en, dmg, { burn: def.burn });
            if (def.stagger) { en.knockX = 0; en.knockY = 0; en.staggerUntil = performance.now() + 350; }
        });
    }
}

function tgUpdateProjectiles(g, dt) {
    g.projectiles.forEach(p => {
        if (p.dead) return;
        const t = p.target;
        if (!t || t.dead) { p.dead = true; return; }
        const dx = t.x - p.x, dy = t.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        p.vx = (dx / d) * p.speed;
        p.vy = (dy / d) * p.speed;
        p.x += p.vx * dt / 1000;
        p.y += p.vy * dt / 1000;
        if (d < t.radius + 6 && !p.hitSet.has(t)) {
            p.hitSet.add(t);
            tgDamageEnemy(g, t, p.dmg, { slow: p.slow });
            if (p.splash) {
                g.enemies.forEach(en => {
                    if (en === t || en.dead || p.hitSet.has(en)) return;
                    if (Math.hypot(en.x - t.x, en.y - t.y) <= p.splash) { p.hitSet.add(en); tgDamageEnemy(g, en, p.dmg * 0.6, {}); }
                });
            }
            if (p.pierce > 0) {
                p.pierce--;
                const next = tgNearestEnemy(g, p.x, p.y, 200);
                if (next && !p.hitSet.has(next)) p.target = next; else p.dead = true;
            } else if (p.chain && p.chained < p.chain) {
                p.chained++;
                const next = g.enemies.find(en => !en.dead && !p.hitSet.has(en) && Math.hypot(en.x - p.x, en.y - p.y) < 140);
                if (next) p.target = next; else p.dead = true;
            } else {
                p.dead = true;
            }
        }
        if (p.x < -60 || p.x > TG_ARENA_W + 60 || p.y < -60 || p.y > TG_ARENA_H + 60) p.dead = true;
    });
    g.projectiles = g.projectiles.filter(p => !p.dead);
}

function tgUpdateEnemies(g, dt) {
    const now = performance.now();
    g.enemies.forEach(en => {
        if (en.dead) return;
        if (en.hp <= 0) { tgKillEnemy(g, en); return; }

        let speed = en.speed;
        if (en.def.enrageSpeed && en.hp < en.maxHp * 0.5) speed = en.def.enrageSpeed;
        if (now < en.slowUntil) speed *= en.slowMult;
        const staggered = en.staggerUntil && now < en.staggerUntil;

        // burn dot
        if (en.burnUntil && now < en.burnUntil) {
            en.burnTick -= dt;
            if (en.burnTick <= 0) { en.hp -= en.burnDmg; en.burnTick = 500; g.floaters.push({ x: en.x, y: en.y - en.radius, text: String(en.burnDmg), life: 400, vy: -20, color: '#ff8a3a' }); }
        }

        // knockback decay
        if (Math.abs(en.knockX) > 1 || Math.abs(en.knockY) > 1) {
            en.x += en.knockX * dt / 1000; en.y += en.knockY * dt / 1000;
            en.knockX *= 0.86; en.knockY *= 0.86;
        }

        const ranged = en.def.ranged;
        const dx = g.player.x - en.x, dy = g.player.y - en.y;
        const dist = Math.hypot(dx, dy) || 1;

        if (!staggered) {
            if (ranged) {
                en.rangedCd -= dt;
                if (dist > ranged.range * 0.7) {
                    en.x += (dx / dist) * speed * dt / 1000;
                    en.y += (dy / dist) * speed * dt / 1000;
                } else if (dist < ranged.range * 0.45) {
                    en.x -= (dx / dist) * speed * 0.6 * dt / 1000;
                    en.y -= (dy / dist) * speed * 0.6 * dt / 1000;
                }
                if (en.rangedCd <= 0 && dist <= ranged.range) {
                    en.rangedCd = ranged.cd;
                    g.projectiles.push({
                        x: en.x, y: en.y, target: g.player, vx: 0, vy: 0, speed: ranged.projSpeed,
                        dmg: en.dmg, pierce: 0, enemyShot: true, hitSet: new Set()
                    });
                }
            } else {
                let mx = dx / dist, my = dy / dist;
                if (en.def.jitter) {
                    en.jitterPhase += dt / 1000 * 4;
                    const jog = Math.sin(en.jitterPhase) * 0.5;
                    const px = -my, py = mx;
                    mx += px * jog; my += py * jog;
                    const norm = Math.hypot(mx, my) || 1; mx /= norm; my /= norm;
                }
                en.x += mx * speed * dt / 1000;
                en.y += my * speed * dt / 1000;
            }

            // boss pulse attack
            if (en.def.pulse) {
                en.pulseCd -= dt;
                if (en.pulseCd <= 0 && dist <= en.def.pulse.radius + 20) {
                    en.pulseCd = en.def.pulse.cd;
                    g.effects.push({ type: 'pulse', x: en.x, y: en.y, range: en.def.pulse.radius, life: 300, maxLife: 300, boss: true });
                    if (dist <= en.def.pulse.radius) tgDamagePlayer(g, en.def.pulse.dmg, en);
                }
            }
            // boss summon
            if (en.def.summon && !en.summonedAt) en.summonedAt = now + 6000 + Math.random() * 4000;
            if (en.def.summon && now > en.summonedAt) {
                en.summonedAt = now + 8000 + Math.random() * 5000;
                tgSpawnEnemy(g, en.def.summon);
            }
        }

        // contact damage
        if (dist < en.radius + g.player.radius) {
            en.attackCd -= dt;
            if (en.attackCd <= 0) {
                en.attackCd = 600;
                tgDamagePlayer(g, en.dmg, en);
                if (en.def.knockback) {
                    const kx = (g.player.x - en.x) / dist, ky = (g.player.y - en.y) / dist;
                    g.player.x += kx * 18; g.player.y += ky * 18;
                }
            }
        }
        if (en.hitFlash > 0) en.hitFlash -= dt;
        en.x = Math.max(-40, Math.min(TG_ARENA_W + 40, en.x));
        en.y = Math.max(-40, Math.min(TG_ARENA_H + 40, en.y));
    });
    g.enemies = g.enemies.filter(en => !en.dead);
}

function tgUpdateSpawns(g, dt) {
    if (!g.waveActive || g.spawnQueue.length === 0) return;
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) {
        const id = g.spawnQueue.shift();
        tgSpawnEnemy(g, id);
        const dense = g.enemies.length > 14;
        g.spawnTimer = dense ? 550 : 320;
    }
}

function tgUpdatePlayer(g, dt) {
    const p = g.player;
    let mx = 0, my = 0;
    if (tgKeys['arrowleft'] || tgKeys['a']) mx -= 1;
    if (tgKeys['arrowright'] || tgKeys['d']) mx += 1;
    if (tgKeys['arrowup'] || tgKeys['w']) my -= 1;
    if (tgKeys['arrowdown'] || tgKeys['s']) my += 1;
    if (tgTouch.active) { mx = tgTouch.x; my = tgTouch.y; }
    const len = Math.hypot(mx, my);
    if (len > 0.01) {
        mx /= len; my /= len;
        p.facing = Math.atan2(my, mx);
        const speed = p.speed * (1 + tgPerkTotal(g, 'swiftness'));
        p.x += mx * speed * dt / 1000;
        p.y += my * speed * dt / 1000;
        p.moving = true;
    } else p.moving = false;
    p.x = Math.max(p.radius, Math.min(TG_ARENA_W - p.radius, p.x));
    p.y = Math.max(p.radius, Math.min(TG_ARENA_H - p.radius, p.y));

    if (p.invuln > 0) p.invuln -= dt;
    if (p.hitFlash > 0) p.hitFlash -= dt;

    const regen = tgPerkTotal(g, 'regen');
    if (regen) {
        p.regenAcc = (p.regenAcc || 0) + regen * dt / 1000;
        if (p.regenAcc >= 1) { p.hp = Math.min(p.maxHp, p.hp + Math.floor(p.regenAcc)); p.regenAcc %= 1; }
    }

    g.weapons.forEach(w => tgFireWeapon(g, w, dt));
}

function tgUpdateFx(g, dt) {
    g.effects.forEach(e => e.life -= dt);
    g.effects = g.effects.filter(e => e.life > 0);
    g.floaters.forEach(f => { f.life -= dt; f.y += f.vy * dt / 1000; });
    g.floaters = g.floaters.filter(f => f.life > 0);
    g.particles.forEach(p => { p.life -= dt; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vx *= 0.94; p.vy *= 0.94; });
    g.particles = g.particles.filter(p => p.life > 0);
}

// ===================================================================
// main loop
// ===================================================================
function tgTick(t) {
    const g = TGRun;
    if (!g || g.screen !== 'playing') { tgRAF = null; return; }
    const dt = Math.min(50, tgLastT ? t - tgLastT : 16);
    tgLastT = t;
    g.elapsed += dt;

    tgUpdatePlayer(g, dt);
    tgUpdateEnemies(g, dt);
    tgUpdateProjectiles(g, dt);
    tgUpdateSpawns(g, dt);
    tgUpdateFx(g, dt);
    tgCheckWaveClear(g);

    if (g.screen === 'playing') {
        tgDrawArena(g);
        tgUpdateHud(g);
        tgRAF = requestAnimationFrame(tgTick);
    } else {
        tgRAF = null;
        tgRender();
    }
}
function tgLoopStart() { tgLastT = 0; if (!tgRAF) tgRAF = requestAnimationFrame(tgTick); }
function tgLoopStop() { if (tgRAF) { cancelAnimationFrame(tgRAF); tgRAF = null; } }

// ===================================================================
// canvas rendering
// ===================================================================
function tgDrawArena(g) {
    const cv = tgWinBody && tgWinBody.querySelector('#tg-canvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const chapter = TP.chapterForWave(g.wave);
    const w = TG_ARENA_W, h = TG_ARENA_H;

    ctx.fillStyle = chapter.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = chapter.accent;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);

    // particles (behind entities)
    g.particles.forEach(p => {
        ctx.globalAlpha = Math.max(0, p.life / 500);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // enemies
    g.enemies.forEach(en => {
        const img = tgImg(en.def.sprite);
        const s = en.radius * 2;
        ctx.save();
        if (en.hitFlash > 0) { ctx.filter = 'brightness(1.8) saturate(2)'; }
        if (en.def.boss) {
            ctx.shadowColor = TP.CHAPTERS.find(c => c.boss === en.id) ? '#ff5a5a' : '#ffd400';
            ctx.shadowBlur = 14;
        }
        if (img.complete && img.naturalWidth) ctx.drawImage(img, en.x - s / 2, en.y - s / 2, s, s);
        else { ctx.fillStyle = '#6a8f4a'; ctx.beginPath(); ctx.arc(en.x, en.y, en.radius, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
        // hp bar
        if (en.hp < en.maxHp) {
            const bw = s;
            ctx.fillStyle = '#000'; ctx.fillRect(en.x - bw / 2, en.y - s / 2 - 8, bw, 4);
            ctx.fillStyle = en.def.boss ? '#ff5a5a' : '#0df259';
            ctx.fillRect(en.x - bw / 2, en.y - s / 2 - 8, bw * Math.max(0, en.hp / en.maxHp), 4);
        }
    });

    // projectiles
    g.projectiles.forEach(p => {
        ctx.fillStyle = p.enemyShot ? '#ff5a5a' : '#ffe066';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.enemyShot ? 5 : 4, 0, Math.PI * 2); ctx.fill();
    });

    // effects: swings & pulses
    g.effects.forEach(e => {
        const t = e.life / e.maxLife;
        if (e.type === 'swing') {
            ctx.strokeStyle = `rgba(255,255,255,${t * 0.9})`;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.range * (1 - t * 0.2), e.angle - (e.arc * Math.PI / 180) / 2, e.angle + (e.arc * Math.PI / 180) / 2);
            ctx.stroke();
        } else if (e.type === 'pulse') {
            ctx.strokeStyle = e.boss ? `rgba(255,90,90,${t * 0.8})` : `rgba(255,212,0,${t * 0.8})`;
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(e.x, e.y, e.range * (1.2 - t * 0.2), 0, Math.PI * 2); ctx.stroke();
        }
    });

    // player — a blue ring under the avatar so "which one is me" is never a
    // question, since the troll sprites are also round cartoon faces
    const p = g.player;
    ctx.save();
    if (p.invuln > 0 && Math.floor(performance.now() / 90) % 2 === 0) ctx.globalAlpha = 0.4;
    const ps = p.radius * 2.6;
    ctx.fillStyle = 'rgba(74,144,217,0.35)';
    ctx.beginPath(); ctx.arc(p.x, p.y, ps / 2 + 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6ab6ff';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, ps / 2 + 4, 0, Math.PI * 2); ctx.stroke();
    if (p.hitFlash > 0) ctx.filter = 'brightness(1.6) saturate(0.4) hue-rotate(-20deg)';
    const pimg = tgImg('src/emoj/dusung.png');
    if (pimg.complete && pimg.naturalWidth) {
        ctx.save();
        ctx.beginPath(); ctx.arc(p.x, p.y, ps / 2, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(pimg, p.x - ps / 2, p.y - ps / 2, ps, ps);
        ctx.restore();
    } else { ctx.fillStyle = '#4a90d9'; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();

    // floating damage/gold text
    g.floaters.forEach(f => {
        ctx.globalAlpha = Math.max(0, f.life / 700);
        ctx.fillStyle = f.color;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y);
    });
    ctx.globalAlpha = 1;
}

function tgUpdateHud(g) {
    const b = tgWinBody;
    if (!b) return;
    const hpFill = b.querySelector('#tg-hpfill');
    const hpText = b.querySelector('#tg-hptext');
    if (hpFill) hpFill.style.width = `${Math.max(0, g.player.hp / g.player.maxHp) * 100}%`;
    if (hpText) hpText.textContent = `${Math.max(0, Math.ceil(g.player.hp))}/${g.player.maxHp}`;
    const goldEl = b.querySelector('#tg-gold');
    if (goldEl) goldEl.textContent = `$${g.gold}`;
    const waveEl = b.querySelector('#tg-wave');
    if (waveEl) waveEl.textContent = `wave ${g.wave}/${TP.FINAL_WAVE}`;
    const remainEl = b.querySelector('#tg-remain');
    if (remainEl) remainEl.textContent = `${g.enemies.length + g.spawnQueue.length} trolls left`;
}

// ===================================================================
// input
// ===================================================================
function tgBindInput() {
    window.addEventListener('keydown', tgKeyDown);
    window.addEventListener('keyup', tgKeyUp);
}
function tgUnbindInput() {
    window.removeEventListener('keydown', tgKeyDown);
    window.removeEventListener('keyup', tgKeyUp);
}
function tgKeyDown(e) {
    if (!TGRun || TGRun.screen !== 'playing') return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
        tgKeys[k] = true;
        e.preventDefault();
    }
}
function tgKeyUp(e) { tgKeys[e.key.toLowerCase()] = false; }

function tgBindTouch(cv) {
    const stick = tgWinBody.querySelector('#tg-stick');
    if (!stick) return;
    const base = stick;
    let activePointer = null;
    const handle = (clientX, clientY) => {
        const rect = base.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        let dx = clientX - cx, dy = clientY - cy;
        const max = rect.width / 2;
        const d = Math.hypot(dx, dy);
        if (d > max) { dx = dx / d * max; dy = dy / d * max; }
        tgTouch.x = dx / max; tgTouch.y = dy / max; tgTouch.active = true;
        const knob = base.querySelector('.tg-stick-knob');
        if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const end = () => {
        tgTouch.active = false; tgTouch.x = 0; tgTouch.y = 0; activePointer = null;
        const knob = base.querySelector('.tg-stick-knob');
        if (knob) knob.style.transform = 'translate(0,0)';
    };
    base.addEventListener('pointerdown', e => { activePointer = e.pointerId; base.setPointerCapture(e.pointerId); handle(e.clientX, e.clientY); });
    base.addEventListener('pointermove', e => { if (activePointer === e.pointerId) handle(e.clientX, e.clientY); });
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
}

// ===================================================================
// shop — offered between waves, same reroll/buy rhythm as jokerz 98
// ===================================================================
function tgBuildShop(g) {
    g.shop = { weaponOffers: [], perkOffers: [], rerolls: 0 };
    tgRollShop(g);
}

function tgRollShop(g) {
    const owned = new Set(g.weapons.map(w => w.id));
    const pool = g.meta.unlockedWeapons.filter(id => {
        const w = g.weapons.find(x => x.id === id);
        if (w) return w.level < tgWeaponDef(id).maxLevel;
        return g.weapons.length < tgMaxSlots(g);
    });
    const weaponPicks = [];
    const poolCopy = pool.slice();
    for (let i = 0; i < 2 && poolCopy.length; i++) {
        const idx = Math.floor(Math.random() * poolCopy.length);
        weaponPicks.push(poolCopy.splice(idx, 1)[0]);
    }
    g.shop.weaponOffers = weaponPicks.map(id => {
        const def = tgWeaponDef(id);
        const owned = g.weapons.find(w => w.id === id);
        const level = owned ? owned.level + 1 : 1;
        const cost = owned ? Math.round(def.cost * 0.6 * level) : def.cost;
        return { id, level, cost, isUpgrade: !!owned };
    });

    const perkPool = TP.PERKS.filter(p => tgPerkStacks(g, p.id) < p.maxStack);
    const perkPicks = [];
    const perkCopy = perkPool.slice();
    for (let i = 0; i < 2 && perkCopy.length; i++) {
        const idx = Math.floor(Math.random() * perkCopy.length);
        perkPicks.push(perkCopy.splice(idx, 1)[0]);
    }
    g.shop.perkOffers = perkPicks.map(p => {
        const n = tgPerkStacks(g, p.id);
        return { id: p.id, cost: p.cost + p.priceStep * n };
    });
}

function tgRerollCost(g) { return 8 + g.shop.rerolls * 4; }

function tgShopReroll() {
    const g = TGRun;
    const cost = tgRerollCost(g);
    if (g.gold < cost) { tgSfx('error'); showToast('shop', 'not enough gold'); return; }
    g.gold -= cost;
    g.shop.rerolls++;
    tgRollShop(g);
    tgSfx('buy');
    tgRender();
}

function tgBuyWeapon(index) {
    const g = TGRun;
    const offer = g.shop.weaponOffers[index];
    if (!offer) return;
    if (g.gold < offer.cost) { tgSfx('error'); showToast('shop', 'not enough gold'); return; }
    g.gold -= offer.cost;
    const existing = g.weapons.find(w => w.id === offer.id);
    if (existing) { existing.level++; tgSfx('levelup'); }
    else { g.weapons.push({ id: offer.id, level: 1, cd: 0 }); tgSfx('buy'); }
    g.shop.weaponOffers.splice(index, 1);
    tgSaveRun();
    tgRender();
}

function tgBuyPerk(index) {
    const g = TGRun;
    const offer = g.shop.perkOffers[index];
    if (!offer) return;
    if (g.gold < offer.cost) { tgSfx('error'); showToast('shop', 'not enough gold'); return; }
    g.gold -= offer.cost;
    g.perks[offer.id] = (g.perks[offer.id] || 0) + 1;
    if (offer.id === 'vitality') g.player.maxHp += 20;
    tgSfx('buy');
    g.shop.perkOffers.splice(index, 1);
    tgSaveRun();
    tgRender();
}

function tgLeaveShop() {
    const g = TGRun;
    // recompute max hp from vitality stacks so it's always consistent
    g.player.maxHp = 100 + tgPerkTotal(g, 'vitality');
    if (g.player.hp > g.player.maxHp) g.player.hp = g.player.maxHp;
    g.shop = null;
    while (g.milestoneToastQueue.length) showToast('troll problem', g.milestoneToastQueue.shift());
    tgSaveRun();
    tgStartWave(g);
}

// ===================================================================
// screens
// ===================================================================
function tgRender() {
    if (!tgWinBody || !TGRun) return;
    const g = TGRun;
    const screens = { menu: tgRenderMenu, playing: tgRenderPlaying, shop: tgRenderShop, over: tgRenderOver, won: tgRenderWon };
    tgWinBody.innerHTML = (screens[g.screen] || tgRenderMenu)(g);
    tgBind(g);
    if (g.screen === 'playing') {
        const cv = tgWinBody.querySelector('#tg-canvas');
        if (cv) { tgDrawArena(g); tgBindTouch(cv); }
    }
}

function tgWeaponRowHtml(w, opts) {
    opts = opts || {};
    const def = tgWeaponDef(w.id);
    return `<div class="tg-wslot${opts.empty ? ' empty' : ''}" ${opts.attr || ''}>
        <span class="tg-wicon">${def ? def.icon : '➕'}</span>
        ${def ? `<span class="tg-wlvl">lvl ${w.level}</span>` : ''}
    </div>`;
}

function tgRenderMenu(g) {
    const meta = g.meta;
    const hasSave = tgHasRunSave();
    let resumeWave = '?';
    if (hasSave) {
        try { resumeWave = JSON.parse(localStorage.getItem(TG_RUN_KEY) || '{}').wave || '?'; } catch (e) { }
    }
    return `<div class="tg-menu">
        <h2 class="tg-title">SIR, WE HAVE A<br>TROLL PROBLEM</h2>
        <p class="tg-sub">defend the keep. the trolls will not stop coming. they never do.</p>
        ${hasSave ? `<button class="tg-btn tg-wide tg-go" data-act="resume">continue run — wave ${resumeWave}</button>` : ''}
        <button class="tg-btn tg-wide ${hasSave ? '' : 'tg-go'}" data-act="newrun">${hasSave ? 'start a new run' : 'start run'}</button>
        <div class="tg-statsgrid">
            <div><b>${meta.bestWave}</b><span>best wave</span></div>
            <div><b>${meta.totalKills}</b><span>trolls slain</span></div>
            <div><b>${meta.bossesSlain}</b><span>bosses slain</span></div>
            <div><b>${meta.runsPlayed}</b><span>runs played</span></div>
        </div>
        ${meta.clearedGame ? '<p class="tg-cleared">👑 you have defeated the troll king</p>' : ''}
        <p class="tg-label">armory (unlocked weapons)</p>
        <div class="tg-armory">${TP.WEAPONS.map(w => `
            <span class="tg-armory-item${meta.unlockedWeapons.includes(w.id) ? ' got' : ''}" title="${escapeHtml(w.name)}">${meta.unlockedWeapons.includes(w.id) ? w.icon : '🔒'}</span>`).join('')}</div>
        <p class="tg-hint">WASD or arrow keys to move. weapons fire on their own — just don't get surrounded.</p>
    </div>`;
}

function tgRenderPlaying(g) {
    const chapter = TP.chapterForWave(g.wave);
    return `<div class="tg-hud">
        <div class="tg-hudrow">
            <span class="tg-chapter" style="color:${chapter.accent}">${escapeHtml(chapter.name)}</span>
            <span id="tg-wave">wave ${g.wave}/${TP.FINAL_WAVE}</span>
            <span id="tg-gold" class="tg-goldstat">$${g.gold}</span>
        </div>
        <div class="tg-hpbar bevel-in"><div id="tg-hpfill" class="tg-hpfill" style="width:${(g.player.hp / g.player.maxHp) * 100}%"></div>
            <span id="tg-hptext" class="tg-hptext">${Math.ceil(g.player.hp)}/${g.player.maxHp}</span></div>
        <span id="tg-remain" class="tg-remain">${g.enemies.length + g.spawnQueue.length} trolls left</span>
    </div>
    <canvas id="tg-canvas" class="tg-canvas bevel-in" width="${TG_ARENA_W}" height="${TG_ARENA_H}"></canvas>
    <div class="tg-weaponbar">${g.weapons.map(w => tgWeaponRowHtml(w)).join('')}</div>
    <div id="tg-stick" class="tg-stick"><div class="tg-stick-knob"></div></div>
    <p class="tg-hint">wasd / arrows to move &middot; weapons auto-fire</p>`;
}

function tgRenderShop(g) {
    const s = g.shop;
    return `<div class="tg-shop">
        <div class="tg-shophead">
            <h3>camp — wave ${g.wave} of ${TP.FINAL_WAVE}</h3>
            <span class="tg-goldstat">$${g.gold}</span>
        </div>
        <div class="tg-loadout">${Array.from({ length: tgMaxSlots(g) }, (_, i) => g.weapons[i]
            ? tgWeaponRowHtml(g.weapons[i])
            : `<div class="tg-wslot empty"><span class="tg-wicon">➕</span></div>`).join('')}
        </div>
        <p class="tg-label">weapons</p>
        <div class="tg-offers">${s.weaponOffers.map((o, i) => {
            const def = tgWeaponDef(o.id);
            return `<div class="tg-offer" data-buyweapon="${i}">
                <span class="tg-offer-icon">${def.icon}</span>
                <div class="tg-offer-info"><b>${escapeHtml(def.name)}</b>
                    <span>${o.isUpgrade ? `upgrade to lvl ${o.level}` : escapeHtml(def.text)}</span></div>
                <button class="tg-btn tg-buy">$${o.cost}</button>
            </div>`;
        }).join('') || '<div class="tg-offer-empty">nothing new — go get stronger elsewhere</div>'}</div>
        <p class="tg-label">perks</p>
        <div class="tg-offers">${s.perkOffers.map((o, i) => {
            const def = tgPerkDef(o.id);
            const n = tgPerkStacks(g, o.id);
            return `<div class="tg-offer" data-buyperk="${i}">
                <span class="tg-offer-icon">${def.icon}</span>
                <div class="tg-offer-info"><b>${escapeHtml(def.name)}${n ? ` (${n})` : ''}</b>
                    <span>${escapeHtml(def.text)}</span></div>
                <button class="tg-btn tg-buy">$${o.cost}</button>
            </div>`;
        }).join('') || '<div class="tg-offer-empty">nothing new here either</div>'}</div>
        <div class="tg-shopfoot">
            <button class="tg-btn" data-act="reroll">reroll $${tgRerollCost(g)}</button>
            <button class="tg-btn tg-wide tg-go" data-act="nextwave">next wave</button>
        </div>
    </div>`;
}

function tgRenderOver(g) {
    return `<div class="tg-end">
        <h2 class="tg-title tg-lose">the trolls win this time</h2>
        <p>you fell on wave ${g.wave}, chapter "${escapeHtml(TP.chapterForWave(g.wave).name)}".</p>
        <p class="tg-sub">${g.kills} trolls slain &middot; $${g.gold} gold on hand &middot; ${Math.floor(g.elapsed / 1000)}s survived this wave</p>
        <p class="tg-sub">best wave ever: ${g.meta.bestWave}</p>
        <button class="tg-btn tg-wide tg-go" data-act="newrun">try again</button>
        <button class="tg-btn tg-wide" data-act="menu">main menu</button>
    </div>`;
}

function tgRenderWon(g) {
    return `<div class="tg-end">
        <h2 class="tg-title tg-win">the troll problem is solved</h2>
        <p>the Troll King has fallen. the keep is safe. probably.</p>
        <p class="tg-sub">${g.kills} trolls slain across ${TP.FINAL_WAVE} waves &middot; ${g.meta.bossesSlain} bosses total, ever</p>
        <button class="tg-btn tg-wide tg-go" data-act="newrun">go again</button>
        <button class="tg-btn tg-wide" data-act="menu">main menu</button>
    </div>`;
}

// ===================================================================
// input binding & actions
// ===================================================================
function tgBind(g) {
    const b = tgWinBody;
    const on = (sel, fn) => b.querySelectorAll(sel).forEach(el => el.onclick = e => { e.stopPropagation(); fn(el, e); });
    on('[data-act]', el => tgAction(el.dataset.act));
    on('[data-buyweapon]', el => tgBuyWeapon(+el.dataset.buyweapon));
    on('[data-buyperk]', el => tgBuyPerk(+el.dataset.buyperk));
}

function tgAction(act) {
    const g = TGRun;
    switch (act) {
        case 'newrun': tgNewRun(); tgClearRunSave(); TGRun.screen = 'shop'; TGRun.wave = 1; tgBuildShop(TGRun); tgRender(); break;
        case 'resume': if (!tgResumeRun()) { tgNewRun(); TGRun.screen = 'shop'; tgBuildShop(TGRun); } tgRender(); break;
        case 'reroll': tgShopReroll(); break;
        case 'nextwave': tgLeaveShop(); break;
        case 'menu': tgLoopStop(); tgUnbindInput(); TGRun = tgNewRun(); TGRun.screen = 'menu'; tgRender(); break;
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
    tgBindInput();
    win._cleanup = () => { tgLoopStop(); tgUnbindInput(); tgSaveRun(); tgWinBody = null; };
    if (!TGRun || TGRun.screen === 'menu') TGRun = tgNewRun();
    tgRender();
    if (typeof unlockAchievement === 'function') unlockAchievement('troll_problem');
}
