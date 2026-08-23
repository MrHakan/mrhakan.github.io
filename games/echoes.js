/* echoes of the tide: leviathan's wake — the rules.
 *
 * Implements games/ECHOES-GDD.md. The constants named in the GDD are the
 * constants below, under the same names, so the document and the source
 * can be diffed by eye. Content lives in games/echoes-data.js and is read
 * only — this file never writes to it.
 *
 * Everything is deterministic from a single uint32 seed: the nemesis
 * roster, the dungeon decks, the loot rolls and the forge bands all come
 * off one xorshift stream whose state is saved with the profile, so a
 * reloaded run continues the same sequence and a fresh run on the same
 * seed replays identically.
 */

(function () {
    'use strict';

    const D = window.ECHOES_DATA;

    // ---------- GDD §2 constants ----------
    const MITIGATION_FACTOR = 0.55;
    const DAMAGE_FLOOR = 0.10;          // armour reduces, never deletes
    const SWING_LOW = 0.85, SWING_HIGH = 1.15;
    const CRIT_CAP = 0.60, CRIT_K = 120;
    const CRIT_MULT_BASE = 1.5, CRIT_MULT_PER = 0.005, CRIT_MULT_CAP = 2.5;
    const DODGE_CAP = 0.35, DODGE_K = 60;
    const HIT_MIN = 0.30, HIT_MAX = 0.98;
    const ATTR_START = 8, ATTR_FREE = 3, ATTR_SOFT_CAP = 60;
    const ATTR_PER_LEVEL = 3, ATTR_BONUS_EVERY = 5, ATTR_BONUS = 2;
    const SANITY_CAP = 120;
    const MAX_LEVEL = 50;
    const TICKS_PER_DAY = 8;

    // GDD §4.5 — line tension. REEL_FORCE is the base; the line and the arm
    // holding it scale it (calibration pass, recorded in the GDD).
    const REEL_FORCE = 1.15;
    const HAUL_GAIN = 0.06;
    const TENSION_DECAY = 0.94;
    const DRAG_DEPTH_K = 400;

    // Drowned Lord scaling. Pulled out and named because it is the hardest
    // thing in the game to balance by eye: a Lord is a fight the player is
    // supposed to lose sometimes, and the margin between "memorable" and
    // "pointless" is about fifteen percent of hit points.
    const NEMESIS_SCALE = {
        hpBase: 20, hpPerLevel: 8,
        dmgBase: 14, dmgPerLevel: 2.0,
        armBase: 3, armPerLevel: 0.6, armPerTier: 4,
        rankHp: { captain: 1, warlord: 1.1, overlord: 1.6 },
        rankDmg: { captain: 1, warlord: 0.9, overlord: 1.2 }
    };

    const SLOTS = ['mainHand', 'offHand', 'head', 'body', 'line', 'trinket'];
    const SLOT_NAMES = { mainHand: 'main hand', offHand: 'off hand', head: 'head', body: 'body', line: 'line', trinket: 'trinket' };
    const TIME_OF_DAY = ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night', 'deep night', 'witching'];
    const TIDE_PHASE = ['low', 'rising', 'high', 'falling'];
    const ELEMENTS = ['physical', 'abyssal', 'burn', 'bleed'];
    const RANKS = { captain: 1, warlord: 2, overlord: 3 };
    const SAVE_KEY = 'mrhakan98-echoes';
    const SAVE_SCHEMA = 'echoes/save/1';

    // ---------- seeded rng (xorshift32) ----------
    function makeRng(seed) {
        let s = (seed >>> 0) || 0x9e3779b9;
        const f = function () {
            s ^= s << 13; s >>>= 0;
            s ^= s >>> 17;
            s ^= s << 5; s >>>= 0;
            return s / 4294967296;
        };
        f.state = () => s >>> 0;
        f.seed = (v) => { s = (v >>> 0) || 0x9e3779b9; };
        return f;
    }
    const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
    const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
    const chance = (rng, p) => rng() < p;
    const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

    // ---------- content lookups ----------
    const byId = (list, id) => list.find(x => x.id === id) || null;
    const realmById = id => byId(D.realms, id);
    const recipeById = id => byId(D.recipes, id);
    const runeById = id => byId(D.runes, id);
    const fishById = id => byId(D.fish, id);
    const foeById = id => byId(D.bestiary, id) || byId(D.bosses, id);
    const skillNode = id => {
        for (const t of D.skillTrees) { const n = byId(t.nodes, id); if (n) return n; }
        return null;
    };

    // ---------- gear ----------
    // an item's contribution to one stat: base + affixes + runes, where a
    // rune is worth 15% more per other filled socket on the same item
    // (GDD §4.3 — the Syndicate calls it resonance and charges for it).
    function itemStat(item, stat) {
        if (!item) return 0;
        let v = (item.baseStats && item.baseStats[stat]) || 0;
        for (const a of item.affixes || []) if (a.stat === stat) v += a.value;
        const filled = (item.sockets || []).filter(s => s.runeId).length;
        for (const s of item.sockets || []) {
            if (!s.runeId) continue;
            const r = runeById(s.runeId);
            if (r && r.stat === stat) v += Math.round(r.base * (1 + 0.15 * filled));
        }
        return v;
    }
    function gearStat(p, stat) {
        let sum = 0;
        for (const slot of SLOTS) sum += itemStat(p.equipment[slot], stat);
        return sum;
    }
    function itemPower(item) {
        return itemStat(item, 'damage') * 2 + itemStat(item, 'armour') * 2 +
            itemStat(item, 'critRating') + itemStat(item, 'pressureRating') * 4 +
            itemStat(item, 'lineStrength') * 4;
    }

    // ---------- skills ----------
    function skillEffect(p, effectId) {
        let total = 0;
        for (const tree of D.skillTrees) for (const node of tree.nodes) {
            if (node.effect !== effectId) continue;
            const r = p.skills[node.id] || 0;
            if (r > 0) total += node.ranks[r - 1];
        }
        return total;
    }
    function abilityValue(p, abilityId) {
        for (const tree of D.skillTrees) for (const node of tree.nodes) {
            if (node.ability !== abilityId) continue;
            const r = p.skills[node.id] || 0;
            return r > 0 ? node.ranks[r - 1] : 0;
        }
        return 0;
    }
    function rankOf(p, nodeId) { return p.skills[nodeId] || 0; }

    // ---------- derived values (GDD §2.2) ----------
    function maxHp(p) { return 40 + p.attributes.fortitude * 6 + p.level * 8; }
    function maxStamina(p) {
        return 8 + Math.floor(p.attributes.finesse / 4) + Math.floor(p.attributes.fortitude / 6) +
            skillEffect(p, 'staminaMax') + gearStat(p, 'staminaMax');
    }
    function maxSanity(p) {
        let base = Math.min(SANITY_CAP, 50 + p.attributes.attunement * 2 + gearStat(p, 'sanityMax'));
        let pct = 0;
        for (const slot of SLOTS) {
            const it = p.equipment[slot];
            if (!it) continue;
            for (const a of it.affixes || []) if (a.stat === 'sanityMaxPct') pct += a.value;
        }
        return Math.max(10, Math.round(base * (1 + pct)));
    }
    function carryWeight(p) { return 20 + p.attributes.might * 2; }
    function armourOf(p) {
        const raw = gearStat(p, 'armour') * (1 + p.attributes.fortitude / 120);
        let mult = 1 + skillEffect(p, 'armourPct');
        if (p.faction === 'ironclad') mult += D.factions.ironclad.bonus.armourPct;
        return Math.round(raw * mult);
    }
    function pressureRating(p) {
        return gearStat(p, 'pressureRating') + skillEffect(p, 'pressure');
    }
    function lineTier(p) {
        const line = p.equipment.line;
        return line ? line.tier + itemStat(line, 'lineStrength') - (line.baseStats.lineStrength || 0) : 0;
    }
    function lineStrength(p) { return itemStat(p.equipment.line, 'lineStrength'); }
    function carried(p) {
        let w = 0;
        for (const it of p.inventory) w += it.weight || 0;
        for (const slot of SLOTS) if (p.equipment[slot]) w += p.equipment[slot].weight || 0;
        return Math.round(w * 10) / 10;
    }
    function coinOf(p) { return p.coin; }

    // ---------- levelling (GDD §2.7) ----------
    function xpToNext(level) { return Math.round(50 * Math.pow(level, 1.9)); }

    function gainXp(g, amount) {
        const p = g.p;
        if (p.level >= MAX_LEVEL) return;
        p.xp += Math.max(0, Math.round(amount));
        while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
            p.xp -= xpToNext(p.level);
            p.level++;
            p.unspentAttributePoints += ATTR_PER_LEVEL + (p.level % ATTR_BONUS_EVERY === 0 ? ATTR_BONUS : 0);
            p.skillPoints += 1;
            p.vitals.hp = maxHp(p);
            p.vitals.stamina = maxStamina(p);
            p.vitals.sanity = Math.min(maxSanity(p), p.vitals.sanity + 5);
            log(g, `you are level ${p.level}. ${ATTR_PER_LEVEL + (p.level % ATTR_BONUS_EVERY === 0 ? ATTR_BONUS : 0)} attribute points, 1 skill point.`, 'good');
            if (p.level >= 10) achieve('echoes-ten');
        }
    }

    // ---------- combat maths (GDD §2.3 – §2.5) ----------
    // Damage = RawDamage * (1 + Stat/100) - (Armour * MitigationFactor)
    function rollDamage(rng, weaponBase, stat, armour, penetration) {
        const swing = SWING_LOW + rng() * (SWING_HIGH - SWING_LOW);
        const raw = weaponBase * swing;
        const mf = penetration ? MITIGATION_FACTOR * (1 - penetration) : MITIGATION_FACTOR;
        let dmg = raw * (1 + stat / 100) - armour * mf;
        const floor = raw * DAMAGE_FLOOR;
        if (dmg < floor) dmg = floor;
        return { raw, dmg };
    }
    // hyperbola: the first points of Finesse are worth a great deal, the
    // fiftieth almost nothing
    function critChance(finesse, critRating) {
        const F = finesse + (critRating || 0);
        return CRIT_CAP * (F / (F + CRIT_K));
    }
    function critMultiplier(finesse, bonusPct) {
        const base = Math.min(CRIT_MULT_CAP, CRIT_MULT_BASE + CRIT_MULT_PER * finesse);
        return base * (1 + (bonusPct || 0));
    }
    function dodgeChance(attackerFinesse, targetFinesse) {
        return DODGE_CAP * (targetFinesse / (targetFinesse + attackerFinesse + DODGE_K));
    }
    function hitChance(attackerFinesse, targetFinesse, extraDodge) {
        return clamp(1 - (dodgeChance(attackerFinesse, targetFinesse) + (extraDodge || 0)), HIT_MIN, HIT_MAX);
    }
    // elemental multiplier, applied after mitigation
    function elementMult(type, foe) {
        if (foe.immune && foe.immune.indexOf(type) >= 0) return 0;
        if (foe.weak && foe.weak.indexOf(type) >= 0) return 1.5;
        if (foe.resist && foe.resist.indexOf(type) >= 0) return 0.5;
        return 1;
    }
    // d20 + mod >= dc; nat 20 always passes, nat 1 always fails
    function d20check(rng, mod, dc) {
        const roll = ri(rng, 1, 20);
        if (roll === 20) return { roll, mod, dc, pass: true, nat: true };
        if (roll === 1) return { roll, mod, dc, pass: false, nat: true };
        return { roll, mod, dc, pass: roll + mod >= dc, nat: false };
    }

    // ---------- dialogue skills (GDD §1.4) ----------
    function skillMod(p, skill) {
        const a = p.attributes;
        switch (skill) {
            case 'abyssal_lore': return Math.floor(a.attunement / 4) + Math.floor(p.codex.length / 6);
            case 'strength': return Math.floor(a.might / 4);
            case 'bribe': return Math.floor(a.perception / 6) + (p.coin > 0 ? Math.floor(Math.log10(p.coin)) : 0);
            case 'intimidate': return Math.floor(Math.max(a.might, a.attunement) / 5) + p.notoriety;
            default: return 0;
        }
    }

    // ---------- sanity (GDD §2.6) ----------
    function sanityLoss(p, base) {
        let loss = base * (1 - p.attributes.attunement / 150);
        loss *= (1 - Math.min(0.8, skillEffect(p, 'sanityWard')));
        if (p.faction === 'dredgers') loss *= (1 - D.factions.dredgers.bonus.sanityPct);
        return Math.max(0, Math.round(loss));
    }
    function sanityPct(p) { return p.vitals.sanity / maxSanity(p); }
    function sanityTier(p) {
        const pct = sanityPct(p);
        if (p.vitals.sanity <= 0) return 4;
        if (pct < 0.15) return 3;
        if (pct < 0.40) return 2;
        if (pct < 0.70) return 1;
        return 0;
    }
    const SANITY_LABEL = ['steady', 'whispers', 'seeing things', 'the Tide is talking', 'recruited'];

    // ---------- the clock (GDD §4.4) ----------
    function timeOfDay(p) { return TIME_OF_DAY[p.clock.tick % TICKS_PER_DAY]; }
    function tidePhase(p) { return TIDE_PHASE[Math.floor(p.clock.tick / 2) % 4]; }
    function isNight(p) { const t = timeOfDay(p); return t === 'night' || t === 'deep night' || t === 'witching'; }
    function tidePull(p) {
        const t = tidePhase(p);
        return t === 'high' ? 1.25 : t === 'low' ? 0.95 : 1.1;
    }
    function leviathanTurns(p) { return timeOfDay(p) === 'witching' && tidePhase(p) === 'high'; }

    // ---------- items (GDD §4.2, §6.3) ----------
    function makeItem(g, recipe, quality) {
        const rng = g.rng, p = g.p;
        quality = clamp(Math.round(quality), 0, 6);
        const rarity = quality <= 1 ? 'cursed' : quality <= 4 ? 'standard' : 'masterwork';
        let affixCount = rarity === 'cursed' ? 1 : rarity === 'masterwork' ? 3 : Math.max(0, quality - 1);
        let socketCount = rarity === 'cursed' ? 0 : rarity === 'masterwork' ? 2 : (quality >= 3 ? 1 : 0);
        if (socketCount > 0) socketCount = Math.min(3, socketCount + skillEffect(p, 'sockets'));

        const scale = 0.85 + quality * 0.06;
        const baseStats = {};
        for (const k in recipe.base) {
            baseStats[k] = k === 'penetration' ? recipe.base[k] : Math.max(1, Math.round(recipe.base[k] * scale));
        }
        for (const k in (recipe.grants || {})) baseStats[k] = (baseStats[k] || 0) + recipe.grants[k];

        const pool = D.affixes.filter(a => a.slots.indexOf(recipe.slot) >= 0);
        const affixes = [];
        for (let i = 0; i < affixCount && pool.length; i++) {
            const a = pool[Math.floor(rng() * pool.length)];
            if (affixes.some(x => x.id === a.id)) { i--; if (affixes.length >= pool.length) break; continue; }
            // a Cursed piece rolls its one affix at Masterwork strength
            const roll = rarity === 'cursed' ? a.max : ri(rng, a.min, a.max);
            // affixes are a fraction of the item, not a second item: a tier-1
            // vest must not out-armour its own base plate
            const tierScale = a.stat === 'durability' ? 1 : (0.20 + recipe.tier * 0.16);
            affixes.push({ id: a.id, name: a.name, stat: a.stat, value: Math.max(1, Math.round(roll * tierScale)), curse: false });
        }
        if (rarity === 'cursed') {
            const c = pick(rng, D.curses);
            affixes.push({ id: c.id, name: c.name, stat: c.stat, value: c.value, curse: true, text: c.text });
        }

        const sockets = [];
        for (let i = 0; i < socketCount; i++) sockets.push({ runeId: null });
        const durMax = 60 + recipe.tier * 22 + skillEffect(p, 'durability');
        const prefix = rarity === 'masterwork' ? 'Masterwork ' : rarity === 'cursed' ? 'Cursed ' : '';

        return {
            $schema: 'echoes/item/1',
            id: 'it_' + (g.itemSeq++).toString(36),
            recipeId: recipe.id,
            name: prefix + recipe.name,
            slot: recipe.slot,
            tier: recipe.tier,
            rarity: rarity,
            baseStats: baseStats,
            damageType: recipe.damageType || null,
            permanentKill: !!recipe.permanent,
            sockets: sockets,
            affixes: affixes,
            durability: { current: durMax, max: durMax },
            weight: recipe.weight,
            value: Math.round(recipe.value * (0.7 + quality * 0.12))
        };
    }

    function canForge(p, recipe) {
        for (const m in recipe.cost) if ((p.materials[m] || 0) < recipe.cost[m]) return false;
        if (recipe.faction && p.faction !== recipe.faction) return false;
        return true;
    }
    function payFor(p, recipe) { for (const m in recipe.cost) p.materials[m] -= recipe.cost[m]; }

    function equip(g, item) {
        const p = g.p;
        const old = p.equipment[item.slot];
        p.equipment[item.slot] = item;
        const idx = p.inventory.indexOf(item);
        if (idx >= 0) p.inventory.splice(idx, 1);
        if (old) p.inventory.push(old);
        p.vitals.hp = Math.min(p.vitals.hp, maxHp(p));
        p.vitals.stamina = Math.min(p.vitals.stamina, maxStamina(p));
        p.vitals.sanity = Math.min(p.vitals.sanity, maxSanity(p));
        log(g, `equipped ${item.name}.`);
    }

    // ---------- the Drowned Lords (GDD §3) ----------
    function makeLord(g, realm, rank) {
        const rng = g.rng;
        const c = pick(rng, D.lordCreatures);
        const level = rank === 'overlord' ? 26
            : rank === 'warlord' ? realm.tier * 4 + 1
                : realm.tier * 4 - 1 + ri(rng, 0, 2);
        return {
            $schema: 'echoes/nemesis/1',
            id: 'lord_' + (g.lordSeq++).toString(36),
            name: pick(rng, D.lordNames.given),
            epithet: pick(rng, D.lordNames.epithet),
            title: null,
            rank: rank,
            rankProgress: 0,
            realm: realm.id,
            baseCreature: c.id,
            level: level,
            vitals: { maxHp: 0, hpMultiplier: 1, armourTier: rank === 'overlord' ? 3 : rank === 'warlord' ? 2 : 1 },
            memories: [],
            strengths: [c.damageType],
            weaknesses: [],
            scars: [],
            traits: rank === 'overlord' ? ['ascendant'] : [],
            warCry: pick(rng, D.warCry.opener) + ' ' + pick(rng, D.warCry.claim) + ' ' + pick(rng, D.warCry.threat),
            taunts: [],
            status: 'alive',
            lastSeenDay: 0
        };
    }

    // 12 captains (3 per realm), 4 warlords (1 per realm), 1 Abyssal Overlord
    function birthRoster(g) {
        const roster = [];
        for (const realm of D.realms) {
            for (let i = 0; i < 3; i++) roster.push(makeLord(g, realm, 'captain'));
            roster.push(makeLord(g, realm, 'warlord'));
        }
        roster.push(makeLord(g, D.realms[D.realms.length - 1], 'overlord'));
        return roster;
    }

    function lordName(n) {
        return n.title ? `${n.name} ${n.epithet}, ${n.title}` : `${n.name} ${n.epithet}`;
    }

    function nemesisStats(n) {
        const c = byId(D.lordCreatures, n.baseCreature) || D.lordCreatures[0];
        const rk = RANKS[n.rank];
        const S = NEMESIS_SCALE;
        const hp = Math.round((S.hpBase + n.level * S.hpPerLevel) * c.hp * n.vitals.hpMultiplier * S.rankHp[n.rank]);
        const damage = Math.round((S.dmgBase + n.level * S.dmgPerLevel) * c.damage * S.rankDmg[n.rank]);
        const armour = Math.round((S.armBase + n.level * S.armPerLevel) * c.armour + n.vitals.armourTier * S.armPerTier);
        let finesse = c.finesse + Math.floor(n.level / 3) + (rk - 1) * 2;
        if (n.traits.indexOf('bloated') >= 0) finesse -= 3;
        const immune = [];
        let physicalReduction = 0;
        for (const s of n.scars) {
            const sc = byId(D.scars, s.id);
            if (!sc) continue;
            if (sc.immuneTo) immune.push(sc.immuneTo);
            if (sc.physicalReduction) physicalReduction += sc.physicalReduction;
        }
        // every scar costs 20% resistance to the other three elements
        const backlash = n.scars.length * 0.20;
        return {
            id: n.id, nemesisId: n.id, name: lordName(n), level: n.level,
            hp: hp, maxHp: hp, damage: damage, damageType: c.damageType,
            armour: armour, finesse: Math.max(3, finesse),
            weak: [], resist: n.scars.length ? [] : [c.damageType],
            immune: immune, physicalReduction: physicalReduction, backlash: backlash,
            traits: n.traits.slice(), rank: n.rank, lord: true,
            penetrationVuln: n.traits.indexOf('plated') >= 0 ? 0.25 : 0,
            grudge: n.traits.indexOf('grudge') >= 0 ? 0.15 : 0,
            text: (byId(D.lordCreatures, n.baseCreature) || {}).text || ''
        };
    }

    function remember(n, type, day, realm, detail) {
        n.memories.push({ type: type, day: day, realm: realm, detail: detail });
        if (n.memories.length > 30) n.memories.shift();
    }
    function addTrait(n, id) {
        if (n.traits.indexOf(id) >= 0) return;
        n.traits.push(id);
        const t = byId(D.traits, id);
        if (t && t.weakness && n.weaknesses.indexOf(t.weakness) < 0) n.weaknesses.push(t.weakness);
    }

    // it killed you: a title, +20% max HP, an armour upgrade, and a new
    // line for the next time
    function lordKilledPlayer(g, n, deathType) {
        if (!n.title) n.title = D.titles[deathType] || D.titles.physical;
        n.vitals.hpMultiplier = Math.round(n.vitals.hpMultiplier * 1.2 * 100) / 100;
        n.vitals.armourTier = Math.min(5, n.vitals.armourTier + 1);
        const pool = D.taunts[deathType] || D.taunts.physical;
        const line = pick(g.rng, pool);
        if (n.taunts.indexOf(line) < 0) n.taunts.push(line);
        if (n.vitals.hpMultiplier >= 1.4) addTrait(n, 'bloated');
        if (n.vitals.armourTier >= 2) addTrait(n, 'plated');
        addTrait(n, 'grudge');
        n.rankProgress = Math.min(3, n.rankProgress + 1);
        n.status = 'alive';
        remember(n, 'killed_player', g.p.clock.day, n.realm, 'killed you by ' + deathType);
        checkPromotion(g, n);
    }

    function lordSawYouRun(g, n) {
        addTrait(n, 'tracker');
        n.status = 'hunting';
        remember(n, 'player_fled', g.p.clock.day, n.realm, 'you ran');
        if (!n.title) n.title = D.titles.fled;
    }

    // survived a fight: if ≥30% of what it took was one element it may
    // grow a scar against it — and lose ground against everything else
    function lordSurvived(g, n, damageByType) {
        let total = 0;
        for (const k in damageByType) total += damageByType[k];
        remember(n, 'survived', g.p.clock.day, n.realm, 'walked away from you');
        if (total <= 0) return null;
        for (const el of ELEMENTS) {
            const share = (damageByType[el] || 0) / total;
            if (share < 0.30) continue;
            if (n.scars.some(s => s.immuneTo === el)) continue;
            const odds = Math.min(0.65, 0.25 + 0.1 * RANKS[n.rank]);
            if (!chance(g.rng, odds)) continue;
            const scar = D.scars.find(s => s.immuneTo === el) || byId(D.scars, 'barnacled');
            if (!scar) continue;
            // the flesh runs out: a third scar overwrites the first
            if (n.scars.length >= 2) n.scars.shift();
            n.scars.push({ id: scar.id, immuneTo: scar.immuneTo });
            n.weaknesses.push('scarred: −20% resistance to everything but ' + el);
            remember(n, 'wounded', g.p.clock.day, n.realm, 'grew ' + scar.name);
            return scar;
        }
        return null;
    }

    // a kill only sticks if it was permanent: an Inquisitor pyre, a
    // Dredger unmaking, or a Leviathan-bone edge through the neck
    function killMethodIsPermanent(g, damageType) {
        const p = g.p;
        const weapon = p.equipment.mainHand;
        if (weapon && weapon.permanentKill) return true;
        if (p.faction === 'inquisitors' && damageType === 'burn') return true;
        if (p.faction === 'dredgers' && damageType === 'abyssal') return true;
        return false;
    }

    function lordDefeated(g, n, damageType) {
        if (killMethodIsPermanent(g, damageType)) {
            n.status = 'dead';
            g.p.notoriety++;
            remember(n, 'killed_player', g.p.clock.day, n.realm, 'you ended it properly');
            log(g, `${lordName(n)} is dead, and stays dead.`, 'good');
            achieve('echoes-lord');
            return 'dead';
        }
        const order = ['captain', 'warlord', 'overlord'];
        const idx = order.indexOf(n.rank);
        if (idx > 0) { n.rank = order[idx - 1]; remember(n, 'demoted', g.p.clock.day, n.realm, 'you put it down a rank'); }
        addTrait(n, 'poorly_drowned');
        n.vitals.hpMultiplier = Math.max(0.7, n.vitals.hpMultiplier * 0.85);
        n.rankProgress = 0;
        n.status = 'alive';
        log(g, `${lordName(n)} goes under. It does not stay under.`, 'warn');
        return 'poorly_drowned';
    }

    function checkPromotion(g, n) {
        if (n.rank !== 'captain' || n.rankProgress < 3) return;
        const seat = g.roster.find(x => x.rank === 'warlord' && x.realm === n.realm && x.status !== 'dead');
        n.rank = 'warlord';
        n.rankProgress = 0;
        addTrait(n, 'ascendant');
        remember(n, 'promoted', g.p.clock.day, n.realm, 'took a Warlord seat');
        log(g, `${lordName(n)} has taken a Warlord seat in ${realmById(n.realm).name}.`, 'bad');
        if (seat) {
            seat.rank = 'captain';
            addTrait(seat, 'grudge');
            remember(seat, 'demoted', g.p.clock.day, seat.realm, 'lost the seat to ' + lordName(n));
        }
    }

    // five quiet days is progress toward a seat
    function rosterDayPasses(g) {
        for (const n of g.roster) {
            if (n.status === 'dead') continue;
            if (g.p.clock.day - n.lastSeenDay >= 5) {
                n.lastSeenDay = g.p.clock.day;
                n.rankProgress = Math.min(3, n.rankProgress + 1);
                if (n.rank === 'captain' && n.rankProgress >= 3) checkPromotion(g, n);
            }
        }
    }

    function lordsIn(g, realmId) {
        return g.roster.filter(n => n.realm === realmId && n.status !== 'dead');
    }
    function trackersIn(g, realmId) {
        return lordsIn(g, realmId).filter(n => n.traits.indexOf('tracker') >= 0);
    }

    // ---------- logging ----------
    function log(g, text, kind) {
        g.log.unshift({ text: text, kind: kind || '' });
        if (g.log.length > 90) g.log.pop();
    }
    function fightLog(g, text, kind) {
        if (!g.fight) return;
        g.fight.log.unshift({ text: text, kind: kind || '' });
        if (g.fight.log.length > 40) g.fight.log.pop();
    }
    function achieve(id) { try { if (window.unlockAchievement) unlockAchievement(id); } catch (e) { } }
    function sound(name) { try { if (window.playSound) playSound(name); } catch (e) { } }

    // ---------- the clock ----------
    function advanceClock(g, ticks) {
        const p = g.p;
        for (let i = 0; i < (ticks || 1); i++) {
            p.clock.tick++;
            if (p.clock.tick >= TICKS_PER_DAY) {
                p.clock.tick = 0;
                p.clock.day++;
                rosterDayPasses(g);
            }
        }
        const realm = realmById(p.realm);
        if (realm && realm.sanityDrain && pressureRating(p) < realm.pressure) {
            const bite = sanityLoss(p, realm.sanityDrain * 2);
            p.vitals.sanity -= bite;
            log(g, `the pressure gets in. −${bite} sanity.`, 'bad');
        }
        checkSanityFloor(g);
    }

    function checkSanityFloor(g) {
        const p = g.p;
        if (p.vitals.sanity > 0) return false;
        p.vitals.sanity = 0;
        endRun(g, 'recruited');
        return true;
    }

    // ---------- weapons ----------
    function weaponOf(p) {
        const w = p.equipment.mainHand;
        if (!w) return { base: 5, type: 'physical', crit: 0, pen: 0, name: 'bare hands' };
        return {
            base: itemStat(w, 'damage') + itemStat(p.equipment.offHand, 'damage'),
            type: w.damageType || 'physical',
            crit: gearStat(p, 'critRating'),
            pen: (w.baseStats && w.baseStats.penetration) || 0,
            name: w.name
        };
    }
    function statFor(p, type) {
        if (type === 'abyssal') return p.attributes.attunement;
        if (type === 'bleed') return p.attributes.finesse;
        return p.attributes.might;
    }
    function factionDamageMult(p, type) {
        let m = 1;
        if (p.faction === 'dredgers' && type === 'abyssal') m += D.factions.dredgers.bonus.abyssalPct;
        if (p.faction === 'inquisitors' && type === 'burn') m += D.factions.inquisitors.bonus.burnPct;
        return m;
    }

    // ---------- fights ----------
    function foeFromTemplate(tpl, bump) {
        const b = bump || 0;
        const hp = Math.round(tpl.hp * (1 + 0.26 * b));
        return {
            id: tpl.id, name: tpl.name, level: tpl.level + b * 2,
            hp: hp, maxHp: hp,
            damage: Math.round(tpl.damage * (1 + 0.20 * b)),
            damageType: tpl.damageType,
            armour: Math.round(tpl.armour * (1 + 0.14 * b)),
            finesse: tpl.finesse,
            weak: (tpl.weak || []).slice(), resist: (tpl.resist || []).slice(), immune: [],
            physicalReduction: 0, backlash: 0, traits: [], sanity: tpl.sanity || 0,
            xp: tpl.xp, coin: tpl.coin, drops: tpl.drops || {},
            phases: tpl.phases || null, boss: !!tpl.phases, intro: tpl.intro || '',
            codex: tpl.codex || null, text: tpl.text || ''
        };
    }

    function startFight(g, foe, context) {
        g.fight = {
            foe: foe,
            round: 1,
            log: [],
            dots: { bleed: 0, burn: 0, bleedLeft: 0, burnLeft: 0 },
            foeDots: { bleed: 0, burn: 0, bleedLeft: 0, burnLeft: 0 },
            foeStun: 0,
            guard: false,
            over: false,
            result: null,
            damageByType: {},
            phaseIdx: 0,
            effects: { dodgeMult: 1, damageMult: 1, staminaMult: 1, burnPerRound: 0, deadmans: 0, noAttack: false, drownAt: 0 },
            context: context || 'field'
        };
        if (foe.intro) fightLog(g, foe.intro, 'lore');
        if (foe.lord) {
            const n = byId(g.roster, foe.nemesisId);
            if (n) {
                n.lastSeenDay = g.p.clock.day;
                fightLog(g, '"' + n.warCry + '"', 'cry');
                if (n.taunts.length) fightLog(g, '"' + pick(g.rng, n.taunts) + '"', 'cry');
            }
        }
        g.screen = 'fight';
        sound('navigate');
        // every caller reaches a fight from a different screen, and more than
        // one of them used to return without drawing it — which left the
        // dungeon showing a resolved node that no longer answered clicks
        render(g);
    }

    function foeElementMult(foe, type) {
        let mult = elementMult(type, foe);
        if (mult > 0 && foe.backlash && (foe.immune || []).indexOf(type) < 0) mult *= (1 + foe.backlash);
        if (type === 'physical' && foe.physicalReduction) mult *= (1 - foe.physicalReduction);
        return mult;
    }

    function dealToFoe(g, amount, type, label, pierced) {
        const f = g.fight, foe = f.foe;
        let mult = foeElementMult(foe, type);
        if (pierced && foe.penetrationVuln) mult *= (1 + foe.penetrationVuln);
        const dealt = Math.max(0, Math.round(amount * mult));
        foe.hp -= dealt;
        f.damageByType[type] = (f.damageByType[type] || 0) + dealt;
        if (mult === 0) fightLog(g, `${label} — it is immune. nothing.`, 'bad');
        else if (mult >= 1.4) fightLog(g, `${label} for ${dealt}. it is weak to that.`, 'good');
        else if (mult <= 0.6) fightLog(g, `${label} for ${dealt}. it barely notices.`, 'warn');
        else fightLog(g, `${label} for ${dealt}.`);
        const leech = skillEffect(g.p, 'leechPct');
        if (type === 'abyssal' && leech > 0 && dealt > 0) {
            const heal = Math.max(1, Math.round(dealt * leech));
            g.p.vitals.hp = Math.min(maxHp(g.p), g.p.vitals.hp + heal);
            fightLog(g, `the tide gives ${heal} of it back to you.`, 'good');
        }
        checkPhase(g);
        return dealt;
    }

    function checkPhase(g) {
        const f = g.fight, foe = f.foe;
        if (!foe.phases) return;
        const pct = Math.max(0, foe.hp / foe.maxHp);
        while (f.phaseIdx + 1 < foe.phases.length && pct <= foe.phases[f.phaseIdx + 1].at) {
            f.phaseIdx++;
            const ph = foe.phases[f.phaseIdx];
            fightLog(g, `— ${ph.name} — ${ph.text}`, 'phase');
            const e = ph.effect || {};
            if (e.dodgeMult) f.effects.dodgeMult *= e.dodgeMult;
            if (e.damageMult) f.effects.damageMult *= e.damageMult;
            if (e.staminaMult) f.effects.staminaMult *= e.staminaMult;
            if (e.burnPerRound) f.effects.burnPerRound += e.burnPerRound;
            if (e.deadmans) f.effects.deadmans = e.deadmans;
            if (e.extinguish) { f.dots.burn = 0; f.dots.burnLeft = 0; f.foeDots.burn = 0; f.foeDots.burnLeft = 0; }
            if (e.sanityHit) {
                const bite = sanityLoss(g.p, e.sanityHit);
                g.p.vitals.sanity -= bite;
                fightLog(g, `−${bite} sanity.`, 'bad');
            }
            if (e.unequip) {
                for (const slot of e.unequip) {
                    const it = g.p.equipment[slot];
                    if (!it) continue;
                    g.p.equipment[slot] = null;
                    g.p.inventory.push(it);
                    fightLog(g, `${it.name} tears free and is in your pack, not your hands.`, 'bad');
                }
            }
            if (e.setHp) { g.p.vitals.hp = e.setHp; fightLog(g, 'the water reaches your mouth.', 'bad'); }
            // "fought at 1 HP by design" only works if the thing stops
            // swinging: the last phase is a race against the water, and the
            // water is the one with the clock
            if (e.noAttack) { f.effects.noAttack = true; f.effects.burnPerRound = 0; }
            if (e.drownIn) {
                f.effects.drownAt = f.round + e.drownIn;
                fightLog(g, `${e.drownIn} rounds of air left.`, 'bad');
            }
        }
    }

    function staminaCost(g, base) { return Math.max(1, Math.round(base * g.fight.effects.staminaMult)) + (sanityTier(g.p) >= 3 ? 1 : 0); }

    function playerAction(g, kind) {
        const f = g.fight;
        if (!f || f.over) return;
        const p = g.p, rng = g.rng;
        f.guard = false;

        if (kind === 'flee') {
            const odds = clamp(0.35 + p.attributes.finesse / 200, 0.2, 0.85);
            if (chance(rng, odds)) {
                f.over = true; f.result = 'fled'; p.stats.fled++;
                if (f.foe.lord) { const n = byId(g.roster, f.foe.nemesisId); if (n) lordSawYouRun(g, n); }
                fightLog(g, 'you cut the line and go.', 'warn');
                render(g);
                return;
            }
            fightLog(g, 'you turn to run and it is already in front of you.', 'bad');
            return foeTurn(g);
        }

        if (kind === 'guard') {
            f.guard = true;
            p.vitals.stamina = Math.min(maxStamina(p), p.vitals.stamina + 2);
            fightLog(g, 'you set your feet behind the shield.');
            return foeTurn(g);
        }

        if (kind === 'strike') {
            if (p.vitals.stamina < 1) { fightLog(g, 'nothing left in your arms.', 'warn'); return foeTurn(g); }
            p.vitals.stamina -= 1;
            swing(g);
            const sl = skillEffect(p, 'secondLine');
            if (sl > 0 && p.vitals.hp / maxHp(p) < 0.35 && chance(rng, sl)) {
                fightLog(g, 'second line — you get another one in.', 'good');
                swing(g);
            }
            return afterPlayer(g);
        }

        // skill abilities
        const cost = { abyssal_bolt: 2, whisper: 3, harpoon: 2, burn_oil: 2, reel_in: 3 }[kind];
        if (cost === undefined) return;
        const value = abilityValue(p, kind);
        if (!value) return;
        const need = staminaCost(g, cost);
        if (p.vitals.stamina < need) { fightLog(g, `you need ${need} stamina for that.`, 'warn'); return; }
        p.vitals.stamina -= need;

        if (kind === 'abyssal_bolt') {
            const amt = value * factionDamageMult(p, 'abyssal') * (1 + p.attributes.attunement / 100);
            dealToFoe(g, amt, 'abyssal', 'a bolt out of the deep hits it');
        } else if (kind === 'harpoon') {
            const amt = value * (1 + p.attributes.might / 100);
            const armourBite = f.foe.armour * MITIGATION_FACTOR * 0.5;
            dealToFoe(g, Math.max(amt * DAMAGE_FLOOR, amt - armourBite), 'physical', 'the harpoon goes through the plate', true);
        } else if (kind === 'burn_oil') {
            f.foeDots.burn = Math.round(value / 3);
            f.foeDots.burnLeft = 3;
            fightLog(g, `burning oil across it — ${Math.round(value / 3)} burn for 3 rounds.`, 'good');
        } else if (kind === 'whisper') {
            if (chance(rng, value)) { f.foeStun += 1; fightLog(g, 'you say the word and it stops to listen.', 'good'); }
            else fightLog(g, 'you say the word. it says one back.', 'warn');
        } else if (kind === 'reel_in') {
            if (chance(rng, value)) { f.foeStun += 1; fightLog(g, 'the line goes taut and it comes off its feet.', 'good'); }
            else fightLog(g, 'the barb skips off it.', 'warn');
        }
        return afterPlayer(g);
    }

    function swing(g) {
        const f = g.fight, p = g.p, rng = g.rng, foe = f.foe;
        const w = weaponOf(p);
        let dodge = dodgeChance(p.attributes.finesse, foe.finesse);
        let acc = clamp(1 - dodge, HIT_MIN, HIT_MAX);
        if (sanityTier(p) >= 2) acc -= 0.15;      // hallucinating: −15% hit chance
        if (!chance(rng, clamp(acc, 0.1, 0.98))) { fightLog(g, 'you swing through water.', 'warn'); return; }

        const r = rollDamage(rng, w.base, statFor(p, w.type), foe.armour, w.pen);
        let dmg = r.dmg * factionDamageMult(p, w.type);
        const cc = critChance(p.attributes.finesse, w.crit);
        let label = `${w.name} hits`;
        if (chance(rng, cc)) {
            dmg *= critMultiplier(p.attributes.finesse, skillEffect(p, 'critDmg'));
            label = `${w.name} lands clean —`;
        }
        dealToFoe(g, dmg, w.type, label, w.pen > 0);
        const bleed = skillEffect(p, 'bleed');
        if (bleed > 0) {
            f.foeDots.bleed = Math.round(bleed / 3);
            f.foeDots.bleedLeft = 3;
        }
    }

    function afterPlayer(g) {
        const f = g.fight;
        if (f.foe.hp <= 0) return winFight(g);
        return foeTurn(g);
    }

    function foeTurn(g) {
        const f = g.fight, p = g.p, rng = g.rng, foe = f.foe;
        if (f.effects.noAttack) {
            fightLog(g, `${foe.name} does not strike back. It has stopped, and it is watching you.`, 'phase');
        } else if (f.foeStun > 0) {
            f.foeStun--;
            fightLog(g, `${foe.name} loses the round.`, 'good');
        } else {
            let dodge = (dodgeChance(foe.finesse, p.attributes.finesse) + skillEffect(p, 'dodgeFlat')) * f.effects.dodgeMult;
            const acc = clamp(1 - dodge, HIT_MIN, HIT_MAX);
            if (!chance(rng, acc)) {
                fightLog(g, `${foe.name} comes at you and misses.`, 'good');
            } else {
                const r = rollDamage(rng, foe.damage * f.effects.damageMult, foe.level, armourOf(p), 0);
                let dmg = r.dmg * (1 + (foe.grudge || 0));
                if (f.guard) dmg *= (1 - 0.40 - skillEffect(p, 'blockPct'));
                if (foe.damageType === 'burn') dmg *= (1 + gearStat(p, 'burnTaken'));
                dmg = Math.max(1, Math.round(dmg));
                p.vitals.hp -= dmg;
                f.lastFoeDamage = foe.damageType;
                fightLog(g, `${foe.name} hits you for ${dmg}.`, 'bad');
                if (foe.damageType === 'bleed') { f.dots.bleed = Math.max(3, Math.round(dmg * 0.25)); f.dots.bleedLeft = 3; }
            }
            if (foe.sanity) {
                const bite = sanityLoss(p, foe.sanity);
                if (bite > 0) { p.vitals.sanity -= bite; fightLog(g, `−${bite} sanity.`, 'bad'); }
            }
        }
        return endRound(g);
    }

    function endRound(g) {
        const f = g.fight, p = g.p;
        // damage over time, both ways
        if (f.foeDots.bleedLeft > 0) { f.foeDots.bleedLeft--; dealToFoe(g, f.foeDots.bleed, 'bleed', 'it is still bleeding —'); }
        if (f.foeDots.burnLeft > 0) { f.foeDots.burnLeft--; dealToFoe(g, f.foeDots.burn, 'burn', 'the oil is still burning —'); }
        if (f.dots.bleedLeft > 0) { f.dots.bleedLeft--; p.vitals.hp -= f.dots.bleed; fightLog(g, `you are bleeding: −${f.dots.bleed}.`, 'bad'); }
        if (f.effects.burnPerRound) { p.vitals.hp -= f.effects.burnPerRound; fightLog(g, `the corona burns you for ${f.effects.burnPerRound}.`, 'bad'); }

        p.vitals.stamina = Math.min(maxStamina(p), p.vitals.stamina + Math.max(0, 2 + gearStat(p, 'staminaRegen')));
        f.round++;

        if (f.foe.hp <= 0) return winFight(g);
        if (f.effects.drownAt && f.round > f.effects.drownAt) {
            fightLog(g, 'the water closes over the last of it.', 'bad');
            p.vitals.hp = 0;
            return loseFight(g);
        }
        if (f.effects.drownAt) fightLog(g, `${f.effects.drownAt - f.round + 1} rounds of air.`, 'warn');
        if (p.vitals.hp <= 0) return loseFight(g);
        if (p.vitals.sanity <= 0) { render(g); return checkSanityFloor(g); }
        render(g);
    }

    function winFight(g) {
        const f = g.fight, p = g.p, foe = f.foe;
        f.over = true; f.result = 'won';
        p.stats.kills++;
        // Choir of the Reef: killing it below 20 sanity kills you too
        if (f.effects.deadmans && p.vitals.sanity < f.effects.deadmans) {
            fightLog(g, 'it dies mid-note, and takes the note with it, and you were singing.', 'bad');
            p.vitals.sanity = 0;
            render(g);
            return checkSanityFloor(g);
        }
        const lootMult = 1 + skillEffect(p, 'lootPct');
        const xp = Math.round((foe.xp || 20) * (1 + 0.1 * (foe.rank ? RANKS[foe.rank] : 0)));
        const coin = Math.round((foe.coin || 5) * lootMult);
        p.coin += coin;
        gainXp(g, xp);
        fightLog(g, `${foe.name} is down. +${xp} xp, +${coin} coin.`, 'good');
        for (const m in (foe.drops || {})) {
            const range = foe.drops[m];
            const n = ri(g.rng, range[0], range[1]);
            if (n > 0) { p.materials[m] = (p.materials[m] || 0) + n; fightLog(g, `salvaged ${n} × ${(byId(D.materials, m) || {}).name || m}.`); }
        }
        if (foe.codex) unlockCodex(g, foe.codex);
        if (foe.lord) {
            const n = byId(g.roster, foe.nemesisId);
            if (n) lordDefeated(g, n, f.damageByTypeTop || topDamageType(f));
        }
        if (foe.boss) { g.p.storyFlags['boss_' + foe.id] = true; achieve('echoes-boss'); }
        render(g);
    }

    function topDamageType(f) {
        let best = 'physical', bestV = -1;
        for (const k in f.damageByType) if (f.damageByType[k] > bestV) { bestV = f.damageByType[k]; best = k; }
        return best;
    }

    function loseFight(g) {
        const f = g.fight, p = g.p;
        f.over = true; f.result = 'lost';
        p.stats.deaths++;
        const deathType = f.lastFoeDamage || 'physical';
        if (f.foe.lord) {
            const n = byId(g.roster, f.foe.nemesisId);
            if (n) lordKilledPlayer(g, n, deathType);
        }
        const lost = Math.round(p.coin * 0.25);
        p.coin -= lost;
        p.vitals.hp = Math.max(1, Math.round(maxHp(p) * 0.4));
        p.vitals.stamina = maxStamina(p);
        p.vitals.sanity = Math.max(1, p.vitals.sanity - sanityLoss(p, 8));
        g.dungeon = null;
        fightLog(g, `you wake on the nearest Rest Rig, ${lost} coin lighter.`, 'bad');
        log(g, `you died in ${realmById(p.realm).name}. it cost you ${lost} coin and the killer got a promotion out of it.`, 'bad');
        advanceClock(g, 2);
        render(g);
    }

    function endFight(g) {
        const f = g.fight;
        if (f && f.result === 'lost') { g.screen = 'hub'; g.fight = null; save(g); return render(g); }
        if (f && f.foe.lord && f.result === 'fled') { /* memory already written */ }
        if (f && f.result !== 'lost' && f.foe.lord && f.foe.hp > 0) {
            const n = byId(g.roster, f.foe.nemesisId);
            if (n) { const scar = lordSurvived(g, n, f.damageByType); if (scar) log(g, `${lordName(n)} grew a scar: ${scar.name}.`, 'warn'); }
        }
        g.fight = null;
        g.screen = g.dungeon ? 'dungeon' : 'hub';
        save(g);
        render(g);
    }

    // ---------- dungeons (GDD §5) ----------
    function canWalk(g, realm) {
        const p = g.p;
        if (p.realmsUnlocked.indexOf(realm.id) < 0) return false;
        return true;
    }
    function pressureShort(g, realm) { return Math.max(0, realm.pressure - pressureRating(g.p)); }

    function startVoyage(g) {
        const realm = realmById(g.p.realm);
        g.dungeon = {
            realm: realm.id, depth: 0, maxDepth: 4 + realm.tier * 2,
            node: null, cleared: false, taken: { coin: 0, xp: 0 }
        };
        advanceClock(g, 1);
        if (g.ended) return;
        log(g, `you take a boat out into ${realm.name}. ${timeOfDay(g.p)}, ${tidePhase(g.p)} tide.`);
        // Trackers know your knot
        const trackers = trackersIn(g, realm.id);
        if (trackers.length && chance(g.rng, 0.30)) {
            const n = pick(g.rng, trackers);
            log(g, `${lordName(n)} was waiting where you always put in.`, 'bad');
            g.screen = 'fight';
            return startFight(g, nemesisStats(n), 'ambush');
        }
        dealNode(g);
        g.screen = 'dungeon';
        render(g);
    }

    function dealNode(g) {
        const d = g.dungeon, realm = realmById(d.realm), rng = g.rng;
        if (d.depth >= d.maxDepth) { d.node = { type: 'boss' }; return; }
        const t = d.depth / d.maxDepth;
        const weights = {
            combat: 30 + 14 * t,
            elite: 3 + 22 * t,
            treasure: 15 - 4 * t,
            rest: 13 - 8 * t,
            hazard: 9 + 9 * t,
            lore: 10 - 3 * t,
            descent: 18
        };
        if (leviathanTurns(g.p)) { weights.elite += 25; weights.rest = 2; }
        if (isNight(g.p)) weights.combat += 14;           // +40% nightmare encounters
        let total = 0; for (const k in weights) total += Math.max(0, weights[k]);
        let roll = rng() * total, type = 'combat';
        for (const k in weights) { roll -= Math.max(0, weights[k]); if (roll <= 0) { type = k; break; } }
        d.node = { type: type, text: pick(rng, D.nodeText[type] || D.nodeText.combat), resolved: false };
    }

    function realmFoes(realmId) { return D.bestiary.filter(b => b.realm === realmId); }

    // a realm's roster spans several levels, and picking from it uniformly
    // means a level-1 dredger meets a brine wight on their first walk out.
    // Weight the draw toward things near the player's own level; depth
    // pushes the window up so the bottom of a dungeon is still the bottom.
    function pickFoe(g, realmId, depth) {
        const pool = realmFoes(realmId);
        if (!pool.length) return null;
        // decay away from the player's level, and steeply upward: meeting a
        // brine wight at level 1 is not a difficulty spike, it is the end of
        // the run before the run has started
        const target = g.p.level + 1 + depth * 0.5;
        let total = 0;
        const weights = pool.map(b => {
            const d = b.level - target;
            const w = d > 0 ? Math.pow(0.42, d) : Math.pow(0.75, -d);
            total += w;
            return w;
        });
        let roll = g.rng() * total;
        for (let i = 0; i < pool.length; i++) { roll -= weights[i]; if (roll <= 0) return pool[i]; }
        return pool[pool.length - 1];
    }

    function enterNode(g) {
        const d = g.dungeon, realm = realmById(d.realm), p = g.p, rng = g.rng;
        const node = d.node;
        if (!node || node.resolved) return;
        node.resolved = true;
        advanceClock(g, 1);
        if (g.ended) return;

        const short = pressureShort(g, realm);
        if (short > 0) {
            const bite = Math.round(maxHp(p) * 0.06 * short);
            p.vitals.hp -= bite;
            log(g, `no pressure rating for this depth. the water takes ${bite}.`, 'bad');
            if (p.vitals.hp <= 0) { p.vitals.hp = 1; g.dungeon = null; g.screen = 'hub'; log(g, 'you surface, bleeding from both ears.', 'bad'); return render(g); }
        }
        if (realm.sanityDrain) {
            const bite = sanityLoss(p, realm.sanityDrain);
            if (bite > 0) { p.vitals.sanity -= bite; if (checkSanityFloor(g)) return; }
        }

        const bump = Math.floor(d.depth / 3);
        if (node.type === 'combat') {
            let tpl = pickFoe(g, realm.id, d.depth);
            if (sanityTier(p) >= 2 && chance(rng, 0.25)) {
                tpl = pick(rng, D.bestiary);
                log(g, 'something is here that should not be in this realm. probably.', 'warn');
            }
            return startFight(g, foeFromTemplate(tpl, bump), 'dungeon');
        }
        if (node.type === 'elite') {
            const lords = lordsIn(g, realm.id);
            if (!lords.length) return startFight(g, foeFromTemplate(pickFoe(g, realm.id, d.depth + 3), bump + 1), 'dungeon');
            const hunting = lords.filter(n => n.status === 'hunting');
            const n = pick(rng, hunting.length ? hunting : lords);
            return startFight(g, nemesisStats(n), 'dungeon');
        }
        if (node.type === 'treasure') {
            const mats = D.materials.filter(m => m.tier <= realm.tier + 1 && !m.reagent);
            const m = pick(rng, mats);
            const n = ri(rng, 2, 4 + realm.tier);
            p.materials[m.id] = (p.materials[m.id] || 0) + n;
            const coin = ri(rng, 20, 40) * realm.tier;
            p.coin += coin;
            log(g, `${node.text} ${n} × ${m.name}, ${coin} coin.`, 'good');
            if (chance(rng, 0.22 + realm.tier * 0.05)) {
                const rune = pick(rng, D.runes);
                p.runes.push(rune.id);
                log(g, `and a rune, cold in the hand: ${rune.name}. ${rune.text}`, 'good');
            }
            sound('ding');
        } else if (node.type === 'rest') {
            const heal = Math.round(maxHp(p) * 0.35);
            p.vitals.hp = Math.min(maxHp(p), p.vitals.hp + heal);
            p.vitals.stamina = maxStamina(p);
            p.vitals.sanity = Math.min(maxSanity(p), p.vitals.sanity + 10);
            log(g, `${node.text} +${heal} hp, +10 sanity.`, 'good');
        } else if (node.type === 'hazard') {
            const chk = d20check(rng, skillMod(p, 'strength') + Math.floor(p.attributes.perception / 4), 10 + realm.tier * 2);
            if (chk.pass) log(g, `${node.text} you see it in time (d20 ${chk.roll}+${chk.mod} vs ${chk.dc}).`, 'good');
            else {
                const bite = Math.round(maxHp(p) * (0.08 + realm.tier * 0.02));
                p.vitals.hp -= bite;
                log(g, `${node.text} it gets you for ${bite} (d20 ${chk.roll}+${chk.mod} vs ${chk.dc}).`, 'bad');
                if (p.vitals.hp <= 0) { p.vitals.hp = 1; g.dungeon = null; g.screen = 'hub'; log(g, 'you come up on the winch, unconscious.', 'bad'); return render(g); }
            }
        } else if (node.type === 'lore') {
            const unread = D.codex.filter(c => p.codex.indexOf(c.id) < 0);
            if (unread.length) { unlockCodex(g, pick(rng, unread).id); log(g, node.text, 'lore'); }
            else { p.coin += 30; log(g, `${node.text} nothing you have not already read. 30 coin for the paper.`); }
        } else if (node.type === 'descent') {
            d.depth++;
            log(g, `${node.text} depth ${d.depth} of ${d.maxDepth}.`);
        } else if (node.type === 'boss') {
            const boss = D.bosses.find(b => b.realm === realm.id);
            if (!boss) { d.depth = 0; return dealNode(g), render(g); }
            return startFight(g, foeFromTemplate(boss, 0), 'boss');
        }
        dealNode(g);
        render(g);
    }

    function leaveDungeon(g) {
        g.dungeon = null;
        g.screen = 'hub';
        advanceClock(g, 1);
        log(g, 'you put in at the harbour with what you have got.');
        save(g);
        render(g);
    }

    // ---------- dredging (GDD §4.5) ----------
    function bandWeights(g) {
        const p = g.p;
        const w = { common: 46, uncommon: 28, rare: 15, relic: 7, eldritch: 4 };
        const luck = Math.floor(p.attributes.perception / 6) + skillEffect(p, 'dredgeLuck');
        w.rare += luck * 2.2; w.relic += luck * 1.1; w.uncommon += luck;
        if (isNight(g.p)) { w.rare *= 1.25; w.relic *= 1.25; w.eldritch *= 1.4; }
        if (p.faction === 'dredgers') { w.rare *= 1.3; w.relic *= 1.3; }
        if (tidePhase(p) === 'high') w.eldritch *= 1.3;
        return w;
    }

    function pickFish(g) {
        const p = g.p, rng = g.rng;
        const tide = tidePhase(p), time = timeOfDay(p);
        let pool = D.fish.filter(f => f.realm === p.realm &&
            (!f.tide || f.tide.indexOf(tide) >= 0) &&
            (!f.time || f.time.indexOf(time) >= 0));
        if (!pool.length) pool = D.fish.filter(f => f.realm === p.realm && f.band === 'common');
        if (!pool.length) return null;
        const w = bandWeights(g);
        let total = 0;
        for (const f of pool) total += w[f.band] || 1;
        let roll = rng() * total;
        for (const f of pool) { roll -= (w[f.band] || 1); if (roll <= 0) return f; }
        return pool[0];
    }

    // the whole tackle model in one place, so the balance run and the game
    // cannot drift apart on what a line is worth
    function newDredgeState(p, fish, pull, rng) {
        const line = p.equipment.line;
        const tier = line ? line.tier : 0;
        return {
            fishId: fish.id,
            depth: fish.depth, startDepth: fish.depth,
            tension: 0,
            threshold: 1.0 + tier * 0.25 + itemStat(line, 'lineStrength') * 0.10,
            reelFactor: 1 + 0.28 * tier + p.attributes.might / 150,
            pull: pull,
            held: false, thrash: 0, nextThrash: 90 + Math.floor((rng ? rng() : 0.5) * 150),
            over: false, result: null, ticks: 0
        };
    }

    function startDredge(g) {
        const p = g.p;
        advanceClock(g, 1);
        if (g.ended) return;
        const fish = pickFish(g);
        if (!fish) { log(g, 'nothing is biting here.', 'warn'); return render(g); }
        g.dredge = newDredgeState(p, fish, tidePull(p), g.rng);
        g.screen = 'dredge';
        log(g, `something takes the hook at ${fish.depth} fathoms.`);
        render(g);
    }

    // one integration step, 1/60 s. Formulas are GDD §4.5 verbatim; the
    // line and the arm holding it scale REEL_FORCE.
    function dredgeStep(g) {
        const s = g.dredge;
        if (!s || s.over) return;
        const fish = fishById(s.fishId);
        const dt = 1 / 60;
        s.ticks++;
        if (s.ticks >= s.nextThrash) {
            s.thrash = 40;
            s.nextThrash = s.ticks + 120 + Math.floor(g.rng() * 180);
        }
        const thrashing = s.thrash > 0;
        if (thrashing) s.thrash--;

        const drag = fish.strength * (1 + s.depth / DRAG_DEPTH_K) * s.pull * (thrashing ? 1.6 : 1);
        const reel = s.held ? REEL_FORCE * s.reelFactor : 0;
        const slackPenalty = thrashing ? 0.25 : 0;

        if (s.held) s.tension += ((drag - reel) * 0.9 + slackPenalty) * dt;
        else s.tension *= TENSION_DECAY;
        if (s.tension < 0) s.tension = 0;

        s.depth -= (reel - drag * 0.5) * HAUL_GAIN;

        if (s.tension > s.threshold) { s.over = true; s.result = 'snapped'; return dredgeEnd(g); }
        if (s.depth >= s.startDepth * 1.4) { s.over = true; s.result = 'escaped'; return dredgeEnd(g); }
        if (s.depth <= 0) { s.depth = 0; s.over = true; s.result = 'landed'; return dredgeEnd(g); }
    }

    function dredgeEnd(g) {
        const s = g.dredge, p = g.p, fish = fishById(s.fishId);
        if (s.result === 'snapped') {
            log(g, `the line goes and the ${fish.name} takes it with it.`, 'bad');
            const line = p.equipment.line;
            if (line) {
                line.durability.current -= 20;
                if (line.durability.current <= 0) { p.equipment.line = null; log(g, `${line.name} is finished.`, 'bad'); }
            }
            sound('error');
        } else if (s.result === 'escaped') {
            log(g, `it goes back down and takes the hook with it. ${fish.name}, gone.`, 'warn');
        } else {
            p.stats.landed++;
            if (fish.enemy) {
                const tpl = foeById(fish.enemy);
                log(g, `${fish.text}`, 'bad');
                g.dredge = null;
                return startFight(g, foeFromTemplate(tpl, 0), 'dredge');
            }
            p.coin += fish.value;
            gainXp(g, Math.round(8 + fish.value * 0.7));
            log(g, `landed: ${fish.name}. ${fish.text} +${fish.value} coin.`, 'good');
            if (fish.sanity) {
                const before = p.vitals.sanity;
                p.vitals.sanity = clamp(p.vitals.sanity + fish.sanity, 0, maxSanity(p));
                if (fish.sanity < 0) log(g, `it looks at you on the way into the box. ${p.vitals.sanity - before} sanity.`, 'bad');
            }
            for (const m in (fish.drop || {})) { p.materials[m] = (p.materials[m] || 0) + fish.drop[m]; }
            if (fish.codex) unlockCodex(g, fish.codex);
            if (fish.rune && chance(g.rng, fish.rune)) {
                const rune = pick(g.rng, D.runes);
                p.runes.push(rune.id);
                log(g, `there was a rune in it: ${rune.name}.`, 'good');
            }
            if (fish.band === 'relic') achieve('echoes-relic');
            sound('ding');
        }
        g.dredge = null;
        g.screen = 'hub';
        if (checkSanityFloor(g)) return;
        save(g);
        render(g);
    }

    // ---------- the forge (GDD §4.2) ----------
    function startForge(g, recipe) {
        const p = g.p;
        if (!canForge(p, recipe)) { log(g, 'not enough material for that.', 'warn'); return render(g); }
        const rank = rankOf(p, 'marrow_furnace');
        const bw = clamp(0.16 - 0.018 * recipe.tier + 0.012 * rank, 0.05, 0.22);
        g.forge = {
            recipeId: recipe.id,
            phase: 'heat',
            heat: 0,
            rate: (1.4 - 0.02 * recipe.tier) / 60,
            bandLo: 0.70 - bw / 2, bandHi: 0.70 + bw / 2,
            heatScore: 0, strikeScore: 0,
            strike: 0, marker: 0, dir: 1,
            sweetLo: 0, sweetHi: 0,
            done: false
        };
        rollSweet(g);
        g.screen = 'forge';
        render(g);
    }
    function rollSweet(g) {
        const f = g.forge;
        const w = 0.16 - f.strike * 0.02;
        const lo = 0.10 + g.rng() * (0.80 - w);
        f.sweetLo = lo; f.sweetHi = lo + w;
    }
    function forgeStep(g) {
        const f = g.forge;
        if (!f || f.done) return;
        if (f.phase === 'heat') {
            f.heat += f.rate;
            if (f.heat >= 1.15) { f.heatScore = 0; f.phase = 'quench'; }
        } else if (f.phase === 'quench') {
            f.marker += f.dir * 0.014;
            if (f.marker >= 1) { f.marker = 1; f.dir = -1; }
            if (f.marker <= 0) { f.marker = 0; f.dir = 1; }
        }
    }
    function forgeInput(g) {
        const f = g.forge;
        if (!f || f.done) return;
        if (f.phase === 'heat') {
            const centre = (f.bandLo + f.bandHi) / 2;
            const half = (f.bandHi - f.bandLo) / 2;
            const off = Math.abs(f.heat - centre);
            f.heatScore = off <= half ? 3 : off <= half * 2 ? 2 : off <= half * 3.5 ? 1 : 0;
            f.phase = 'quench';
            sound('click');
            return;
        }
        const hit = f.marker >= f.sweetLo && f.marker <= f.sweetHi;
        if (hit) f.strikeScore++;
        f.strike++;
        sound(hit ? 'click' : 'error');
        if (f.strike >= 3) return forgeFinish(g);
        rollSweet(g);
    }
    function forgeFinish(g) {
        const f = g.forge, p = g.p;
        f.done = true;
        const recipe = recipeById(f.recipeId);
        let quality = clamp(f.heatScore + f.strikeScore, 0, 6);
        if (p.faction === 'ironclad') quality = Math.min(6, quality + 1);
        if (chance(g.rng, skillEffect(p, 'rarityBias'))) quality = Math.min(6, quality + 1);
        payFor(p, recipe);
        const item = makeItem(g, recipe, quality);
        p.inventory.push(item);
        if (p.knownRecipes.indexOf(recipe.id) < 0) p.knownRecipes.push(recipe.id);
        advanceClock(g, 1);
        log(g, `off the anvil: ${item.name} (${item.rarity}, quality ${quality}/6).`, item.rarity === 'masterwork' ? 'good' : item.rarity === 'cursed' ? 'warn' : '');
        if (item.rarity === 'masterwork') achieve('echoes-masterwork');
        g.forge = null;
        g.screen = 'forge-done';
        g.lastForged = item;
        save(g);
        render(g);
    }

    // ---------- codex & dialogue ----------
    function unlockCodex(g, id) {
        if (!id || g.p.codex.indexOf(id) >= 0) return;
        g.p.codex.push(id);
        const entry = byId(D.codex, id);
        log(g, `codex: ${entry ? entry.title : id}.`, 'lore');
        if (g.p.codex.length >= D.codex.length) achieve('echoes-codex');
    }

    function startDialogue(g, treeId) {
        const tree = D.dialogue[treeId];
        if (!tree) return;
        g.dialogue = { tree: treeId, node: tree.start, roll: null };
        g.screen = 'dialogue';
        render(g);
    }

    function dialogueChoose(g, idx) {
        const dl = g.dialogue;
        if (!dl) return;
        const tree = D.dialogue[dl.tree];
        const node = tree.nodes[dl.node];
        const choice = node.choices[idx];
        if (!choice) return;
        const p = g.p;

        if (choice.require) {
            const r = choice.require;
            if (r.attunement && p.attributes.attunement < r.attunement) { dl.roll = { text: 'you do not understand enough of it to ask.' }; return render(g); }
            if (r.codexComplete && p.codex.length < D.codex.length) { dl.roll = { text: 'there is too much you have not read to know what to ask.' }; return render(g); }
        }
        if (choice.cost && choice.cost.coin && p.coin < choice.cost.coin) {
            dl.roll = { text: `you do not have ${choice.cost.coin} coin.` };
            return render(g);
        }

        let next = choice.goto;
        if (choice.check) {
            const mod = skillMod(p, choice.check.skill);
            const res = d20check(g.rng, mod, choice.check.dc);
            dl.roll = {
                text: `[${choice.check.skill.replace('_', ' ')}] d20 ${res.roll} + ${mod} vs ${res.dc} — ${res.pass ? 'pass' : 'fail'}${res.nat ? (res.roll === 20 ? ' (natural 20)' : ' (natural 1)') : ''}`,
                pass: res.pass
            };
            next = res.pass ? choice.pass : choice.fail;
            if (res.pass && choice.cost && choice.cost.coin) p.coin -= choice.cost.coin;
        } else {
            dl.roll = null;
            if (choice.cost && choice.cost.coin) p.coin -= choice.cost.coin;
        }

        applyEffect(g, choice.effect);
        if (g.ended) return;
        if (!next || !tree.nodes[next] || !tree.nodes[next].choices.length && !tree.nodes[next].text) {
            g.dialogue = null;
            g.screen = 'hub';
            save(g);
            return render(g);
        }
        dl.node = next;
        const arrived = tree.nodes[next];
        applyEffect(g, arrived.effect);
        if (g.ended) return;
        if (!arrived.choices.length) {
            g.dialogue = { tree: dl.tree, node: next, roll: dl.roll, terminal: true };
        }
        save(g);
        render(g);
    }

    function applyEffect(g, e) {
        if (!e) return;
        const p = g.p;
        if (e.flag) p.storyFlags[e.flag] = true;
        if (e.flag2) p.storyFlags[e.flag2] = true;
        if (e.codex) unlockCodex(g, e.codex);
        if (e.codex2) unlockCodex(g, e.codex2);
        if (e.coin) p.coin = Math.max(0, p.coin + e.coin);
        if (e.rep) for (const k in e.rep) p.factionReputation[k] = clamp((p.factionReputation[k] || 0) + e.rep[k], -100, 100);
        if (e.join) {
            p.faction = e.join;
            log(g, `you signed with ${D.factions[e.join].name}. "${D.factions[e.join].creed}"`, 'good');
            achieve('echoes-faction');
        }
        if (e.sanity) { p.vitals.sanity = clamp(p.vitals.sanity + e.sanity, 0, maxSanity(p)); if (checkSanityFloor(g)) return; }
        if (e.notorietyLine) p.notoriety++;
        if (e.unlock && p.realmsUnlocked.indexOf(e.unlock) < 0) {
            p.realmsUnlocked.push(e.unlock);
            log(g, `${realmById(e.unlock).name} is on your chart now.`, 'good');
        }
        if (e.act && e.act > p.act) { p.act = e.act; log(g, `Act ${e.act}: ${D.acts[e.act - 1].title}.`, 'lore'); }
        if (e.end) endRun(g, e.end);
    }

    // ---------- profile (GDD §6.1) ----------
    function newProfile(name, seed) {
        return {
            $schema: 'echoes/player/1',
            id: 'p_' + seed.toString(36) + Date.now().toString(36).slice(-4),
            name: name.slice(0, 18),
            seed: seed >>> 0,
            level: 1, xp: 0,
            attributes: { might: ATTR_START, finesse: ATTR_START, attunement: ATTR_START, fortitude: ATTR_START, perception: ATTR_START },
            unspentAttributePoints: ATTR_FREE,
            skillPoints: 1,
            skills: {},
            vitals: { hp: 0, stamina: 0, sanity: 0 },
            equipment: { mainHand: null, offHand: null, head: null, body: null, line: null, trinket: null },
            inventory: [],
            materials: { scrap_iron: 10, brine_salt: 4 },
            runes: [],
            knownRecipes: [],
            factionReputation: { ironclad: 0, dredgers: 0, inquisitors: 0 },
            faction: null,
            coin: 60,
            clock: { day: 1, tick: 1 },
            realm: 'rust_shallows',
            realmsUnlocked: ['rust_shallows'],
            act: 1,
            storyFlags: {},
            codex: ['the_tide'],
            notoriety: 0,
            stats: { kills: 0, deaths: 0, fled: 0, landed: 0 }
        };
    }

    function forgeable(p) {
        let maxTier = 1;
        if (p.realmsUnlocked.indexOf('whispering_reefs') >= 0) maxTier = 2;
        if (p.realmsUnlocked.indexOf('leviathan_trench') >= 0) maxTier = 3;
        if (p.realmsUnlocked.indexOf('drowned_spire') >= 0) maxTier = 4;
        if ((p.materials.celestial_core || 0) > 0) maxTier = 5;
        return D.recipes.filter(r => r.tier <= maxTier && (!r.faction || r.faction === p.faction));
    }

    // ---------- persistence (GDD §6.4) ----------
    const KEYMAP = {
        attributes: 'A', unspentAttributePoints: 'U', skillPoints: 'K', skills: 'S', vitals: 'V',
        equipment: 'E', inventory: 'I', materials: 'M', knownRecipes: 'R', factionReputation: 'F',
        storyFlags: 'G', realmsUnlocked: 'L', codex: 'C', notoriety: 'N', stats: 'T', clock: 'O',
        baseStats: 'b', affixes: 'x', sockets: 'k', durability: 'd', damageType: 'y', rarity: 'r',
        recipeId: 'c', memories: 'm', weaknesses: 'w', strengths: 'g', scars: 's', traits: 't',
        warCry: 'W', taunts: 'u', rankProgress: 'P', baseCreature: 'B', hpMultiplier: 'H',
        armourTier: 'a', permanentKill: 'p', lastSeenDay: 'D', mainHand: '1', offHand: '2',
        head: '3', body: '4', line: '5', trinket: '6', might: 'q', finesse: 'e', attunement: 'z',
        fortitude: 'f', perception: 'v', critRating: 'j', pressureRating: 'o', lineStrength: 'n',
        armour: 'h', damage: 'i', penetration: 'l', immuneTo: 'J', stamina: 'Y', sanity: 'Z'
    };
    const UNMAP = (function () { const o = {}; for (const k in KEYMAP) o[KEYMAP[k]] = k; return o; })();

    function remap(v, table) {
        if (Array.isArray(v)) return v.map(x => remap(x, table));
        if (v && typeof v === 'object') {
            const o = {};
            for (const k in v) o[table[k] || k] = remap(v[k], table);
            return o;
        }
        return v;
    }

    function save(g) {
        if (!g.p) return;
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify({
                $schema: SAVE_SCHEMA,
                s: g.rng.state(), q: g.lordSeq, w: g.itemSeq, e: g.ended || null,
                p: remap(g.p, KEYMAP), n: remap(g.roster, KEYMAP)
            }));
        } catch (err) { /* a full quota is not worth an exception mid-fight */ }
    }

    function load() {
        let raw = null;
        try { raw = localStorage.getItem(SAVE_KEY); } catch (err) { return null; }
        if (!raw) return null;
        let doc;
        try { doc = JSON.parse(raw); } catch (err) { return null; }
        // a loader that meets an unknown version keeps the raw JSON and
        // starts a new run rather than half-reading it
        if (!doc || doc.$schema !== SAVE_SCHEMA) {
            try { localStorage.setItem(SAVE_KEY + '-unreadable', raw); localStorage.removeItem(SAVE_KEY); } catch (err) { }
            return null;
        }
        return {
            p: remap(doc.p, UNMAP), roster: remap(doc.n, UNMAP),
            state: doc.s, lordSeq: doc.q || 0, itemSeq: doc.w || 0, ended: doc.e || null
        };
    }

    // characters lost to the deep come back in the next run from the same seed
    const DROWNED_KEY = SAVE_KEY + '-drowned';
    function recordDrowned(g) {
        try {
            const all = JSON.parse(localStorage.getItem(DROWNED_KEY) || '[]');
            all.push({
                seed: g.p.seed, name: g.p.name, level: g.p.level,
                gear: SLOTS.map(s => g.p.equipment[s]).filter(Boolean).map(i => i.name),
                realm: g.p.realm, day: g.p.clock.day
            });
            localStorage.setItem(DROWNED_KEY, JSON.stringify(all.slice(-20)));
        } catch (err) { }
    }
    function drownedFor(seed) {
        try { return JSON.parse(localStorage.getItem(DROWNED_KEY) || '[]').filter(d => d.seed === seed); }
        catch (err) { return []; }
    }

    // ---------- endings ----------
    function endRun(g, id) {
        if (g.ended) return;
        g.ended = id;
        g.screen = 'end';
        if (id === 'recruited') {
            recordDrowned(g);
            log(g, 'the singing stops being outside you.', 'bad');
        }
        achieve('echoes-end');
        save(g);
        render(g);
    }

    // ---------- html helpers ----------
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function bar(kind, cur, max, label) {
        const pct = clamp(max > 0 ? (cur / max) * 100 : 0, 0, 100);
        return `<div class="et-bar"><div class="et-bar-fill ${kind}" style="width:${pct.toFixed(1)}%"></div><span>${esc(label)}</span></div>`;
    }
    function btn(action, label, opts) {
        const o = opts || {};
        return `<button class="et-btn${o.wide ? ' et-wide' : ''}" data-a="${esc(action)}"${o.arg !== undefined ? ` data-x="${esc(o.arg)}"` : ''}${o.disabled ? ' disabled' : ''}${o.title ? ` title="${esc(o.title)}"` : ''}>${esc(label)}</button>`;
    }
    function pct(v) { return (v * 100).toFixed(1) + '%'; }

    // ---------- screens ----------
    function sideBar(g) {
        const p = g.p;
        const realm = realmById(p.realm);
        const tier = sanityTier(p);
        const lords = g.roster.filter(n => n.status !== 'dead').sort((a, b) => RANKS[b.rank] - RANKS[a.rank]).slice(0, 5);
        return `<div class="et-side">
            <div class="et-sheet">
                <div class="et-name">${esc(p.name)} <span>lv ${p.level} · ${p.faction ? esc(D.factions[p.faction].short) : 'unaffiliated'}</span></div>
                ${bar('hp', p.vitals.hp, maxHp(p), `hp ${p.vitals.hp} / ${maxHp(p)}`)}
                ${bar('stam', p.vitals.stamina, maxStamina(p), `stamina ${p.vitals.stamina} / ${maxStamina(p)}`)}
                ${bar('san', p.vitals.sanity, maxSanity(p), `sanity ${p.vitals.sanity} / ${maxSanity(p)} — ${SANITY_LABEL[tier]}`)}
                ${bar('xp', p.xp, xpToNext(p.level), `xp ${p.xp} / ${xpToNext(p.level)}`)}
                <div class="et-stats">
                    ${D.attributes.map(a => `<div>${a.short} <b>${p.attributes[a.id]}</b></div>`).join('')}
                    <div>ARM <b>${armourOf(p)}</b></div><div>PRS <b>${pressureRating(p)}</b></div>
                </div>
                <div class="et-coin">${p.coin} coin · day ${p.clock.day} · ${esc(timeOfDay(p))} · ${esc(tidePhase(p))} tide</div>
            </div>
            <div class="et-nem">
                <div class="et-nem-head">the drowned lords</div>
                ${lords.map(n => `<div class="et-nem-row"><b>${esc(lordName(n))}</b><span>${esc(n.rank)} · ${esc(realmById(n.realm).name)}</span><i>${n.traits.length ? esc(n.traits[n.traits.length - 1]) : ''}</i></div>`).join('') || '<div class="et-dim">nobody has noticed you yet.</div>'}
                ${btn('screen:nemesis', 'the full roster', { wide: true })}
            </div>
            <div class="et-log">${g.log.slice(0, 14).map(l => `<div class="${esc(l.kind)}">${esc(l.text)}</div>`).join('')}</div>
        </div>`;
    }

    function screenCreate(g) {
        const c = g.create;
        const total = ATTR_FREE;
        const spent = D.attributes.reduce((s, a) => s + (c.attributes[a.id] - ATTR_START), 0);
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-title">echoes of the tide</div>
            <div class="et-sub">leviathan's wake</div>
            <div class="et-intro">Three hundred years ago the Celestial Sun came out of the sky and went into the trench, and the sea rose to meet the hole it left. It has never gone back down.<br><br>Roughly forty thousand people are still here. You are one of them, and this morning a line came up with a piece of worked brass on it, and the brass was warm.</div>
            <div class="et-field"><label>name</label><input id="et-name" maxlength="18" value="${esc(c.name)}"></div>
            <div class="et-field"><label>seed <span class="et-dim">— the same seed is the same world</span></label><input id="et-seed" maxlength="10" value="${esc(c.seed)}"></div>
            <div class="et-h4">attributes — ${total - spent} of ${total} free points left</div>
            <div class="et-stats">${D.attributes.map(a => `<div>${esc(a.name)} <b>${c.attributes[a.id]}</b>
                ${btn('cre-', '−', { arg: a.id, disabled: c.attributes[a.id] <= ATTR_START })}
                ${btn('cre+', '+', { arg: a.id, disabled: spent >= total })}
                <i class="et-dim">${esc(a.governs)}</i></div>`).join('')}</div>
            <div class="et-row">${btn('create', 'take the boat out', { wide: true })}</div>
            <div class="et-dim">a faction picks you up in the Shallows. the Dredgers and the Inquisitors will not have each other.</div>
        </div></div>`;
    }

    function screenHub(g) {
        const p = g.p, realm = realmById(p.realm);
        const act = D.acts[p.act - 1];
        const tree = D.dialogue[act.dialogue];
        const storyDone = p.act > act.n || (act.n === 4 && g.ended);
        const canStory = act.realm === p.realm && !storyDone;
        const short = pressureShort(g, realm);
        const weather = D.realms.indexOf(realm) >= 0 ? realm.weather[(p.clock.day + p.clock.tick) % realm.weather.length] : '';
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-place">
                <div class="et-place-name">${esc(realm.name)}</div>
                <div class="et-place-weather">${esc(weather)} · ${esc(realm.harbour)} · ${esc(timeOfDay(p))}, ${esc(tidePhase(p))} tide${leviathanTurns(p) ? ' — <b>the Leviathan is turning over</b>' : ''}</div>
                <div class="et-place-blurb">${esc(realm.blurb)}</div>
                ${short > 0 ? `<div class="et-place-blurb" style="color:#c0625a">pressure rating ${pressureRating(p)} against a requirement of ${realm.pressure}. every node down here costs you blood.</div>` : ''}
            </div>
            <div class="et-acts">
                <div class="et-h4">Act ${act.n} — ${esc(act.title)}</div>
                <div class="et-lore">${esc(act.goal)}</div>
                ${canStory ? btn('story', tree ? 'go and see about it' : 'continue', { wide: true }) : `<div class="et-dim">${storyDone ? 'this act is behind you.' : 'this act is waiting for you in ' + esc(realmById(act.realm).name) + '.'}</div>`}
            </div>
            <div class="et-abils">
                ${btn('voyage', 'take a voyage', { wide: true })}
                ${btn('dredge', 'put a line in', { wide: true, disabled: !p.equipment.line, title: p.equipment.line ? '' : 'you need a line' })}
                ${btn('screen:forgepick', 'the deep-forge', { wide: true })}
                ${btn('rest', 'rest (4 hours)', { wide: true })}
            </div>
            <div class="et-abils">
                ${btn('screen:sheet', 'character')}
                ${btn('screen:skills', `skills${p.skillPoints ? ' (' + p.skillPoints + ')' : ''}`)}
                ${btn('screen:gear', 'gear')}
                ${btn('screen:realms', 'chart')}
                ${btn('screen:codex', `codex (${p.codex.length}/${D.codex.length})`)}
                ${btn('screen:factions', 'factions')}
            </div>
            <div class="et-dim">${p.stats.kills} kills · ${p.stats.deaths} deaths · ${p.stats.landed} landed · notoriety ${p.notoriety}</div>
            <div class="et-row">${btn('newgame', 'abandon this run')}</div>
        </div></div>`;
    }

    function screenFight(g) {
        const f = g.fight, p = g.p, foe = f.foe;
        const abilities = [];
        for (const key of ['abyssal_bolt', 'harpoon', 'burn_oil', 'whisper', 'reel_in']) {
            const v = abilityValue(p, key);
            if (!v) continue;
            const node = D.skillTrees.reduce((acc, t) => acc || t.nodes.find(n => n.ability === key), null);
            abilities.push(btn(`act:${key}`, node.name, { disabled: f.over }));
        }
        const traits = (foe.traits || []).map(t => {
            const td = byId(D.traits, t);
            return `<span class="et-trait known" title="${esc(td ? td.text : t)}">${esc(td ? td.name : t)}</span>`;
        }).join('');
        const known = foe.lord ? byId(g.roster, foe.nemesisId) : null;
        const reveal = skillEffect(p, 'revealTraits');
        const weakLine = (reveal > 0 || (known && known.weaknesses.length)) && known
            ? `<div class="et-dim">weaknesses: ${esc((known.weaknesses.slice(0, Math.max(1, reveal)).join(' · ')) || 'none you can see')}</div>` : '';
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-foe">
                <div class="et-foe-name">${esc(foe.name)} <span class="et-dim">lv ${foe.level}${foe.rank ? ' · ' + esc(foe.rank) : ''}</span></div>
                ${bar('foe', Math.max(0, foe.hp), foe.maxHp, `${Math.max(0, foe.hp)} / ${foe.maxHp}`)}
                <div class="et-foe-text">${esc(foe.text || '')}</div>
                ${foe.immune && foe.immune.length ? `<div class="et-dim">immune: ${esc(foe.immune.join(', '))}</div>` : ''}
                <div class="et-traits">${traits}</div>
                ${weakLine}
            </div>
            <div class="et-abils">
                ${btn('act:strike', 'strike', { disabled: f.over })}
                ${btn('act:guard', 'guard', { disabled: f.over })}
                ${abilities.join('')}
                ${btn('act:flee', 'cut the line', { disabled: f.over })}
            </div>
            <div class="et-dim">round ${f.round} · your armour ${armourOf(p)} · crit ${pct(critChance(p.attributes.finesse, gearStat(p, 'critRating')))} · hit ${pct(clamp(1 - dodgeChance(p.attributes.finesse, foe.finesse), HIT_MIN, HIT_MAX))}</div>
            <div class="et-fightlog">${f.log.map(l => `<div class="${esc(l.kind)}">${esc(l.text)}</div>`).join('')}</div>
            ${f.over ? `<div class="et-row">${btn('fight-done', f.result === 'won' ? 'take what is left' : f.result === 'fled' ? 'go' : 'wake up', { wide: true })}</div>` : ''}
        </div></div>`;
    }

    function screenDungeon(g) {
        const d = g.dungeon, realm = realmById(d.realm);
        const node = d.node || {};
        const label = {
            combat: 'something is in the way', elite: 'a drowned lord', treasure: 'sunken treasure',
            rest: 'a rest rig', hazard: 'hazard', lore: 'somebody wrote this down',
            descent: 'descent', boss: realm.name + ' — the thing at the bottom'
        }[node.type] || node.type;
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-station">
                <div class="et-station-head">${esc(realm.name)}<span>depth ${d.depth} / ${d.maxDepth}</span></div>
                <div class="et-room">
                    <div class="et-h4">${esc(label)}</div>
                    <div class="et-lore">${esc(node.text || D.nodeText.boss[0])}</div>
                    ${btn('node', node.type === 'descent' ? 'go down' : node.type === 'boss' ? 'open the door' : 'take it', { wide: true })}
                </div>
            </div>
            <div class="et-row">${btn('leave', 'put back in to harbour')}</div>
            <div class="et-log">${g.log.slice(0, 10).map(l => `<div class="${esc(l.kind)}">${esc(l.text)}</div>`).join('')}</div>
        </div></div>`;
    }

    function screenDredge(g) {
        const s = g.dredge, fish = fishById(s.fishId);
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-h">the line is out</div>
            <canvas class="et-canvas" id="et-canvas" width="300" height="220"></canvas>
            <div class="et-dim">hold to reel — release to give slack. the line snaps above ${s.threshold.toFixed(2)}.</div>
            <div class="et-abils">${btn('reel', 'hold the line', { wide: true })}</div>
            <div class="et-dim">tide ${esc(tidePhase(g.p))} (pull ×${s.pull.toFixed(2)}) · line ${g.p.equipment.line ? esc(g.p.equipment.line.name) : 'none'}</div>
            <div class="et-row">${btn('cut', 'cut it loose')}</div>
        </div></div>`;
    }

    function screenForge(g) {
        const f = g.forge, recipe = recipeById(f.recipeId);
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-h">${esc(recipe.name)}</div>
            <canvas class="et-canvas" id="et-canvas" width="300" height="190"></canvas>
            <div class="et-lore">${f.phase === 'heat' ? 'pull it out when the heat is in the band. tier ' + recipe.tier + ' wants a narrow band.' : `strike ${f.strike + 1} of 3 — hit the sweet spot.`}</div>
            <div class="et-abils">${btn('forge-hit', f.phase === 'heat' ? 'pull it out' : 'strike', { wide: true })}</div>
        </div></div>`;
    }

    function screenForgeDone(g) {
        const it = g.lastForged;
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-h">${esc(it.name)}</div>
            ${itemCard(it, true)}
            <div class="et-abils">${btn('equip', 'put it on', { arg: it.id })}${btn('screen:forgepick', 'forge again')}${btn('screen:hub', 'done')}</div>
        </div></div>`;
    }

    function itemCard(it, full) {
        const stats = [];
        for (const k of ['damage', 'armour', 'critRating', 'pressureRating', 'lineStrength', 'sanityMax', 'staminaMax']) {
            const v = itemStat(it, k);
            if (v) stats.push(`${k} ${v > 0 ? '+' : ''}${v}`);
        }
        if (it.baseStats && it.baseStats.penetration) stats.push('pierces ' + Math.round(it.baseStats.penetration * 100) + '%');
        const socketText = (it.sockets || []).map(s => s.runeId ? esc((runeById(s.runeId) || {}).name || s.runeId) : '(empty socket)').join(' · ');
        const curses = (it.affixes || []).filter(a => a.curse);
        return `<div class="et-item ${esc(it.rarity)}">
            <b>${esc(it.name)}</b> <i>t${it.tier} ${esc(it.rarity)}</i>
            <div class="et-dim">${esc(SLOT_NAMES[it.slot])} · ${esc(stats.join(' · ') || 'nothing worth listing')}</div>
            ${socketText ? `<div class="et-dim">${socketText}</div>` : ''}
            ${curses.length ? `<div class="et-dim" style="color:#c0625a">${esc(curses.map(c => c.text || c.name).join(' · '))}</div>` : ''}
            ${full ? `<div class="et-dim">durability ${it.durability.current}/${it.durability.max} · ${it.weight}kg · ${it.value} coin</div>` : ''}
        </div>`;
    }

    function screenForgePick(g) {
        const p = g.p;
        const list = forgeable(p);
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-h">the deep-forge</div>
            <div class="et-dim">${D.materials.filter(m => (p.materials[m.id] || 0) > 0).map(m => `${esc(m.name)} ×${p.materials[m.id]}`).join(' · ') || 'no material at all'}</div>
            <div class="et-patterns">
            ${list.map(r => {
            const ok = canForge(p, r);
            return `<div class="et-pattern${ok ? '' : ' locked'}" ${ok ? `data-a="forge" data-x="${esc(r.id)}"` : ''}>
                    <b>${esc(r.name)}</b>
                    <span>tier ${r.tier} · ${esc(SLOT_NAMES[r.slot])}</span>
                    <i>${Object.keys(r.cost).map(m => `${(byId(D.materials, m) || {}).name} ×${r.cost[m]}`).join(', ')}</i>
                    <i class="et-dim">${esc(r.text)}</i>
                </div>`;
        }).join('')}
            </div>
            <div class="et-row">${btn('screen:hub', 'back')}</div>
        </div></div>`;
    }

    function screenSheet(g) {
        const p = g.p;
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-h">${esc(p.name)}</div>
            <div class="et-dim">level ${p.level} · seed ${p.seed} · ${p.faction ? esc(D.factions[p.faction].name) : 'unaffiliated'}</div>
            <div class="et-h4">attributes${p.unspentAttributePoints ? ` — ${p.unspentAttributePoints} unspent` : ''}</div>
            <div class="et-stats">${D.attributes.map(a => `<div>${esc(a.name)} <b>${p.attributes[a.id]}</b>
                ${p.unspentAttributePoints && p.attributes[a.id] < ATTR_SOFT_CAP ? btn('attr', '+', { arg: a.id }) : ''}
                <i class="et-dim">${esc(a.governs)}</i></div>`).join('')}</div>
            <div class="et-h4">derived</div>
            <div class="et-stats">
                <div>max hp <b>${maxHp(p)}</b></div><div>max stamina <b>${maxStamina(p)}</b></div>
                <div>max sanity <b>${maxSanity(p)}</b></div><div>carry <b>${carried(p)} / ${carryWeight(p)}</b></div>
                <div>armour <b>${armourOf(p)}</b></div><div>pressure <b>${pressureRating(p)}</b></div>
                <div>crit <b>${pct(critChance(p.attributes.finesse, gearStat(p, 'critRating')))}</b></div>
                <div>crit mult <b>×${critMultiplier(p.attributes.finesse, skillEffect(p, 'critDmg')).toFixed(2)}</b></div>
            </div>
            <div class="et-h4">dialogue skills</div>
            <div class="et-stats">${['abyssal_lore', 'strength', 'bribe', 'intimidate'].map(s => `<div>${esc(s.replace('_', ' '))} <b>+${skillMod(p, s)}</b></div>`).join('')}</div>
            <div class="et-h4">standing</div>
            <div class="et-stats">${Object.keys(p.factionReputation).map(k => `<div>${esc(D.factions[k].short)} <b>${p.factionReputation[k]}</b></div>`).join('')}</div>
            <div class="et-row">${btn('screen:hub', 'back')}</div>
        </div></div>`;
    }

    function screenSkills(g) {
        const p = g.p;
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-h">skills <span class="et-dim">${p.skillPoints} point${p.skillPoints === 1 ? '' : 's'}</span></div>
            ${D.skillTrees.map(tree => `
                <div class="et-guild">
                    <b>${esc(tree.name)}</b>
                    <em>${esc(D.factions[tree.faction].name)}</em>
                    <p>${esc(tree.blurb)}</p>
                    ${tree.nodes.map(n => {
            const r = rankOf(p, n.id);
            const nextVal = r < 5 ? n.ranks[r] : n.ranks[4];
            const shown = n.text.replace('{v}', typeof nextVal === 'number' && nextVal < 1 && nextVal > 0 ? Math.round(nextVal * 100) : nextVal).replace('{r}', r + 1);
            return `<div class="et-rank">${esc(n.name)} <span>${r}/5</span>
                            <i class="et-dim" style="display:block;font-style:normal">${esc(shown)}</i>
                            ${r < 5 && p.skillPoints > 0 ? btn('skill', 'take a rank', { arg: n.id }) : ''}</div>`;
        }).join('')}
                </div>`).join('')}
            <div class="et-row">${btn('screen:hub', 'back')}</div>
        </div></div>`;
    }

    function screenGear(g) {
        const p = g.p;
        const socketable = p.inventory.concat(SLOTS.map(s => p.equipment[s]).filter(Boolean))
            .filter(it => (it.sockets || []).some(s => !s.runeId));
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-h">gear</div>
            <div class="et-gears">${SLOTS.map(slot => {
            const it = p.equipment[slot];
            return `<div class="et-gear"><span>${esc(SLOT_NAMES[slot])}</span>${it ? `<b>${esc(it.name)}</b><i>${esc(it.rarity)} · t${it.tier} · dur ${it.durability.current}/${it.durability.max}</i>` : '<b class="et-empty">— empty —</b>'}</div>`;
        }).join('')}</div>
            <div class="et-h4">pack — ${carried(p)} / ${carryWeight(p)} kg</div>
            <div class="et-items">${p.inventory.length ? p.inventory.map(it => `<div data-a="equip" data-x="${esc(it.id)}" style="cursor:pointer">${itemCard(it)}</div>`).join('') : '<div class="et-empty">nothing but a knife and a bad idea.</div>'}</div>
            ${p.runes.length ? `<div class="et-h4">runes</div><div class="et-items">${p.runes.map((rid, i) => {
            const r = runeById(rid);
            return `<div class="et-item"><b>${esc(r.name)}</b> <i>${esc(r.stat)} +${r.base}</i><div class="et-dim">${esc(r.text)}</div>
                    ${socketable.length ? `<select data-rune="${i}">${socketable.map(it => `<option value="${esc(it.id)}">${esc(it.name)}</option>`).join('')}</select> ${btn('socket', 'set it', { arg: i })}` : '<div class="et-dim">nothing with an open socket.</div>'}</div>`;
        }).join('')}</div>` : ''}
            <div class="et-row">${btn('screen:hub', 'back')}</div>
        </div></div>`;
    }

    function screenRealms(g) {
        const p = g.p;
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-h">the chart</div>
            <div class="et-realms">${D.realms.map(r => {
            const open = p.realmsUnlocked.indexOf(r.id) >= 0;
            const here = p.realm === r.id;
            const short = Math.max(0, r.pressure - pressureRating(p));
            return `<div class="et-realm${here ? ' here' : ''}${open ? '' : ' locked'}" ${open && !here ? `data-a="travel" data-x="${esc(r.id)}"` : ''}>
                    <b>${esc(r.name)}</b><i>tier ${r.tier}</i>
                    <span>${esc(r.long)}</span>
                    <span>${open ? (short > 0 ? `pressure ${r.pressure} required — you have ${pressureRating(p)}` : 'pressure cleared') : 'not on your chart yet'}</span>
                    <span>${lordsIn(g, r.id).length} drowned lords · ${trackersIn(g, r.id).length} hunting you</span>
                </div>`;
        }).join('')}</div>
            <div class="et-row">${btn('screen:hub', 'back')}</div>
        </div></div>`;
    }

    function screenNemesis(g) {
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-h">the drowned lords</div>
            <div class="et-dim">17 of them: twelve captains, four warlords and whatever is at the bottom of the Spire. They remember.</div>
            ${g.roster.slice().sort((a, b) => RANKS[b.rank] - RANKS[a.rank]).map(n => `
                <div class="et-nem-full${n.status === 'dead' ? ' dead' : ''}">
                    <b>${esc(lordName(n))}</b>
                    <span>${esc(n.rank)} · ${esc(realmById(n.realm).name)} · lv ${n.level} · ${esc(n.status)}</span>
                    <i>"${esc(n.warCry)}"</i>
                    <div class="et-nem-traits">
                        ${n.traits.map(t => `<span>${esc((byId(D.traits, t) || {}).name || t)}</span>`).join('')}
                        ${n.scars.map(s => `<span>${esc((byId(D.scars, s.id) || {}).name || s.id)}</span>`).join('')}
                    </div>
                    ${n.weaknesses.length ? `<i>weak: ${esc(n.weaknesses.join(' · '))}</i>` : ''}
                    ${n.memories.length ? `<i>${esc(n.memories.slice(-3).map(m => `day ${m.day}: ${m.detail}`).join(' — '))}</i>` : ''}
                    ${n.taunts.length ? `<i>"${esc(n.taunts[n.taunts.length - 1])}"</i>` : ''}
                </div>`).join('')}
            <div class="et-row">${btn('screen:hub', 'back')}</div>
        </div></div>`;
    }

    function screenCodex(g) {
        const p = g.p;
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-h">codex <span class="et-dim">${p.codex.length} of ${D.codex.length}</span></div>
            <div class="et-dim">every entry read is +1/6 to [Abyssal Lore]. All of them, and Attunement 40, is the fourth ending.</div>
            ${D.codex.map(c => p.codex.indexOf(c.id) >= 0
            ? `<details class="et-entry"><summary>${esc(c.title)}</summary><pre>${esc(c.text)}</pre></details>`
            : `<div class="et-entry et-dim">— unread —</div>`).join('')}
            <div class="et-row">${btn('screen:hub', 'back')}</div>
        </div></div>`;
    }

    function screenFactions(g) {
        const p = g.p;
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-h">the three tables</div>
            ${Object.keys(D.factions).map(k => {
            const f = D.factions[k];
            return `<div class="et-guild${p.faction === k ? '' : ''}">
                    <b>${esc(f.name)}</b><em>${esc(f.creed)}</em>
                    <p>${esc(f.blurb)}</p>
                    <i>${esc(f.perk)}</i>
                    <u>standing ${p.factionReputation[k]}${f.hates ? ' · will not have ' + esc(D.factions[f.hates].short) : ''}</u>
                    ${p.faction === k ? '<div class="et-dim">you signed here.</div>' : ''}
                </div>`;
        }).join('')}
            ${!p.faction ? `<div class="et-row">${btn('hiring', 'go to the hiring floor', { wide: true })}</div>` : ''}
            <div class="et-row">${btn('screen:hub', 'back')}</div>
        </div></div>`;
    }

    function screenDialogue(g) {
        const dl = g.dialogue, tree = D.dialogue[dl.tree], node = tree.nodes[dl.node];
        const p = g.p;
        return `<div class="et-main"><div class="et-scroll">
            <div class="et-h">${esc(tree.title)}</div>
            ${node.speaker ? `<div class="et-foe-name">${esc(node.speaker)}</div>` : ''}
            <div class="et-lore" style="white-space:pre-wrap">${esc(node.text)}</div>
            ${dl.roll ? `<div class="et-dim" style="color:${dl.roll.pass === false ? '#c0625a' : '#8fa38f'}">${esc(dl.roll.text)}</div>` : ''}
            <div class="et-abils">${node.choices.length
            ? node.choices.map((c, i) => {
                const mod = c.check ? skillMod(p, c.check.skill) : null;
                const label = c.check ? `${c.text}  (d20+${mod} vs ${c.check.dc})` : c.text;
                return btn('say', label, { arg: i, wide: true });
            }).join('')
            : btn('screen:hub', 'that is all of it', { wide: true })}</div>
        </div></div>`;
    }

    function screenEnd(g) {
        const p = g.p;
        if (g.ended === 'recruited') {
            return `<div class="et-main"><div class="et-scroll et-endscreen">
                <div class="et-title">recruited</div>
                <div class="et-endtext">Sanity does not run out. It runs somewhere.

You are not lost and you were never drowned. You were recruited, and the singing that has been getting louder for eleven days is not outside you any more, and it has a part for you, and you know it already.

${esc(p.name)} is on the roster now. Start a run on seed ${p.seed} and they will be waiting in ${esc(realmById(p.realm).name)}, wearing what you were wearing.</div>
                <div class="et-row">${btn('newgame', 'begin again', { wide: true })}</div>
            </div></div>`;
        }
        const ending = byId(D.endings, g.ended) || D.endings[0];
        return `<div class="et-main"><div class="et-scroll et-endscreen">
            <div class="et-title">${esc(ending.name)}</div>
            <div class="et-endtext">${esc(ending.text)}</div>
            <div class="et-dim">day ${p.clock.day} · level ${p.level} · ${p.stats.kills} kills · ${p.stats.deaths} deaths · ${p.stats.landed} landed · ${p.codex.length}/${D.codex.length} codex · ${p.notoriety} lords ended for good</div>
            <div class="et-row">${btn('newgame', 'begin again', { wide: true })}</div>
        </div></div>`;
    }

    // ---------- canvas ----------
    function drawDredge(g) {
        const cv = g.body && g.body.querySelector('#et-canvas');
        if (!cv) return;
        const c = cv.getContext('2d'), s = g.dredge;
        if (!s) return;
        const W = cv.width, H = cv.height;
        const grad = c.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#12222b'); grad.addColorStop(1, '#04090d');
        c.fillStyle = grad; c.fillRect(0, 0, W, H);

        // depth column
        const colX = 46, colW = 16, top = 18, bot = H - 26;
        c.fillStyle = '#0a1319'; c.fillRect(colX, top, colW, bot - top);
        const dpct = clamp(s.depth / (s.startDepth * 1.4), 0, 1);
        const y = top + dpct * (bot - top);
        c.fillStyle = '#1d3a45'; c.fillRect(colX, top, colW, y - top);
        c.fillStyle = s.held ? '#c9a227' : '#6f8f9c';
        c.fillRect(colX - 5, y - 3, colW + 10, 6);
        c.fillStyle = '#7f9080'; c.font = '10px monospace';
        c.fillText('surface', 4, top + 4);
        c.fillText('deep', 12, bot);
        c.fillStyle = '#e8e0cc';
        c.fillText(Math.round(s.depth) + ' fathoms', colX + colW + 8, y + 3);

        // tension bar
        const bx = 100, by = 30, bw = W - 120, bh = 14;
        c.fillStyle = '#0a1319'; c.fillRect(bx, by, bw, bh);
        const tp = clamp(s.tension / s.threshold, 0, 1);
        c.fillStyle = tp > 0.85 ? '#b8514a' : tp > 0.6 ? '#c9a227' : '#5a8fb8';
        c.fillRect(bx, by, bw * tp, bh);
        c.strokeStyle = '#b8514a'; c.beginPath(); c.moveTo(bx + bw, by - 3); c.lineTo(bx + bw, by + bh + 3); c.stroke();
        c.fillStyle = '#8fa38f'; c.font = '10px monospace';
        c.fillText('line tension', bx, by - 5);
        c.fillText(s.tension.toFixed(2) + ' / ' + s.threshold.toFixed(2), bx, by + bh + 12);

        if (s.thrash > 0) {
            c.fillStyle = 'rgba(184,81,74,' + (0.10 + 0.12 * Math.sin(s.ticks * 0.4)) + ')';
            c.fillRect(0, 0, W, H);
            c.fillStyle = '#e0b8c8';
            c.fillText('it is running', bx, by + bh + 30);
        }
        c.fillStyle = s.held ? '#c9a227' : '#55645a';
        c.fillText(s.held ? 'reeling' : 'slack', bx, H - 12);
    }

    function drawForge(g) {
        const cv = g.body && g.body.querySelector('#et-canvas');
        if (!cv) return;
        const c = cv.getContext('2d'), f = g.forge;
        if (!f) return;
        const W = cv.width, H = cv.height;
        c.fillStyle = '#100b08'; c.fillRect(0, 0, W, H);
        const bx = 20, bw = W - 40, bh = 26;

        if (f.phase === 'heat') {
            const by = 70;
            c.fillStyle = '#1a1310'; c.fillRect(bx, by, bw, bh);
            c.fillStyle = 'rgba(201,162,39,0.30)';
            c.fillRect(bx + bw * f.bandLo, by - 6, bw * (f.bandHi - f.bandLo), bh + 12);
            const heat = clamp(f.heat, 0, 1);
            const hg = c.createLinearGradient(bx, 0, bx + bw, 0);
            hg.addColorStop(0, '#5a2c1a'); hg.addColorStop(0.6, '#c9622a'); hg.addColorStop(1, '#f0d98a');
            c.fillStyle = hg; c.fillRect(bx, by, bw * heat, bh);
            c.fillStyle = '#e8e0cc'; c.font = '11px monospace';
            c.fillText('heat', bx, by - 12);
            c.fillText(Math.round(f.heat * 100) + '%', bx + bw - 34, by - 12);
            c.fillStyle = '#8fa38f'; c.font = '10px monospace';
            c.fillText('band ' + Math.round(f.bandLo * 100) + '–' + Math.round(f.bandHi * 100) + '%', bx, by + bh + 16);
            if (f.heat > 1) { c.fillStyle = '#b8514a'; c.fillText('over-worked', bx, by + bh + 30); }
        } else {
            const by = 80;
            c.fillStyle = '#1a1310'; c.fillRect(bx, by, bw, bh);
            c.fillStyle = 'rgba(90,143,184,0.35)';
            c.fillRect(bx + bw * f.sweetLo, by, bw * (f.sweetHi - f.sweetLo), bh);
            c.fillStyle = '#f0d98a';
            c.fillRect(bx + bw * f.marker - 2, by - 8, 4, bh + 16);
            c.fillStyle = '#e8e0cc'; c.font = '11px monospace';
            c.fillText('quench — strike ' + (f.strike + 1) + ' / 3', bx, by - 16);
            c.fillStyle = '#8fa38f'; c.font = '10px monospace';
            c.fillText('heat ' + f.heatScore + '/3 · strikes ' + f.strikeScore + '/3', bx, by + bh + 18);
        }
    }

    function ensureLoop(g) {
        if (g.raf) return;
        const step = () => {
            g.raf = 0;
            if (!g.open) return;
            if (g.screen === 'dredge' && g.dredge) { dredgeStep(g); drawDredge(g); }
            else if (g.screen === 'forge' && g.forge) { forgeStep(g); drawForge(g); }
            else return;
            g.raf = requestAnimationFrame(step);
        };
        g.raf = requestAnimationFrame(step);
    }

    // ---------- render ----------
    function render(g) {
        if (!g.body) return;
        let main;
        switch (g.screen) {
            case 'create': main = screenCreate(g); break;
            case 'fight': main = screenFight(g); break;
            case 'dungeon': main = screenDungeon(g); break;
            case 'dredge': main = screenDredge(g); break;
            case 'forge': main = screenForge(g); break;
            case 'forge-done': main = screenForgeDone(g); break;
            case 'forgepick': main = screenForgePick(g); break;
            case 'sheet': main = screenSheet(g); break;
            case 'skills': main = screenSkills(g); break;
            case 'gear': main = screenGear(g); break;
            case 'realms': main = screenRealms(g); break;
            case 'nemesis': main = screenNemesis(g); break;
            case 'codex': main = screenCodex(g); break;
            case 'factions': main = screenFactions(g); break;
            case 'dialogue': main = screenDialogue(g); break;
            case 'end': main = screenEnd(g); break;
            default: main = screenHub(g);
        }
        const withSide = g.screen !== 'create' && g.screen !== 'end';
        g.body.innerHTML = `<div class="et-body"><div class="et-two">${withSide ? sideBar(g) : ''}${main}</div></div>`;
        if (g.screen === 'dredge' || g.screen === 'forge') ensureLoop(g);
        if (window.FX && FX.on() && withSide) {
            const els = g.body.querySelectorAll('.et-main .et-btn');
            if (els.length) FX.reveal(els, { each: 0.02, duration: 140 });
        }
    }

    // ---------- input ----------
    function onClick(g, e) {
        const holder = e.target.closest('[data-a]');
        if (!holder) return;
        const a = holder.getAttribute('data-a');
        const x = holder.getAttribute('data-x');
        const p = g.p;

        if (a.indexOf('screen:') === 0) { g.screen = a.slice(7); sound('click'); return render(g); }
        if (a.indexOf('act:') === 0) { playerAction(g, a.slice(4)); if (!g.fight || !g.fight.over) render(g); else render(g); return; }

        switch (a) {
            // the character sheet re-renders on every point spent, which
            // rebuilds the two inputs — so whatever has been typed into them
            // has to be carried across or the name goes back to the default
            case 'cre+': syncCreate(g); g.create.attributes[x]++; return render(g);
            case 'cre-': syncCreate(g); g.create.attributes[x]--; return render(g);
            case 'create': return startNewGame(g);
            case 'newgame': return confirmNew(g);
            case 'story': return startDialogue(g, D.acts[p.act - 1].dialogue);
            case 'hiring': return startDialogue(g, 'recruit');
            case 'say': return dialogueChoose(g, parseInt(x, 10));
            case 'voyage': return startVoyage(g);
            case 'dredge': return startDredge(g);
            case 'node': return enterNode(g);
            case 'leave': return leaveDungeon(g);
            case 'fight-done': return endFight(g);
            case 'rest': return rest(g);
            case 'forge': return startForge(g, recipeById(x));
            case 'forge-hit': return forgeInput(g);
            case 'cut': g.dredge.over = true; g.dredge.result = 'escaped'; return dredgeEnd(g);
            case 'travel': return travel(g, x);
            case 'attr': return spendAttribute(g, x);
            case 'skill': return spendSkill(g, x);
            case 'equip': {
                const it = p.inventory.find(i => i.id === x) || (g.lastForged && g.lastForged.id === x ? g.lastForged : null);
                if (it) { if (p.inventory.indexOf(it) < 0) p.inventory.push(it); equip(g, it); save(g); }
                // putting on the thing you just forged is the end of the forge
                if (g.screen === 'forge-done') g.screen = 'hub';
                return render(g);
            }
            case 'socket': return socketRune(g, parseInt(x, 10));
        }
    }

    function syncCreate(g) {
        if (!g.body || !g.create) return;
        const name = g.body.querySelector('#et-name');
        const seed = g.body.querySelector('#et-seed');
        if (name) g.create.name = name.value;
        if (seed) g.create.seed = seed.value;
    }

    function confirmNew(g) {
        const go = () => { g.p = null; g.ended = null; g.create = freshCreate(); g.screen = 'create'; try { localStorage.removeItem(SAVE_KEY); } catch (e) { } render(g); };
        if (window.showRetroDialog) {
            showRetroDialog({
                title: 'abandon the run?',
                lines: ['the roster remembers you either way.', 'the seed is what carries over, not the character.'],
                okLabel: 'abandon', cancelLabel: 'stay', onOk: go
            });
        } else go();
    }

    function rest(g) {
        const p = g.p;
        advanceClock(g, 2);
        if (g.ended) return;
        const heal = Math.round(maxHp(p) * 0.5);
        p.vitals.hp = Math.min(maxHp(p), p.vitals.hp + heal);
        p.vitals.stamina = maxStamina(p);
        p.vitals.sanity = Math.min(maxSanity(p), p.vitals.sanity + 12);
        log(g, `four hours on a dry cleat. +${heal} hp, +12 sanity.`, 'good');
        // resting is not free: the roster moves while you sleep
        const lords = lordsIn(g, p.realm);
        if (lords.length && chance(g.rng, 0.18)) {
            const n = pick(g.rng, lords);
            log(g, `${lordName(n)} came looking while you slept.`, 'bad');
            return startFight(g, nemesisStats(n), 'ambush');
        }
        save(g);
        render(g);
    }

    function travel(g, realmId) {
        const realm = realmById(realmId);
        if (!realm || g.p.realmsUnlocked.indexOf(realmId) < 0) return;
        g.p.realm = realmId;
        advanceClock(g, 2);
        if (g.ended) return;
        log(g, `you make the crossing to ${realm.name}.`);
        const trackers = trackersIn(g, realmId);
        if (trackers.length && chance(g.rng, 0.22)) {
            const n = pick(g.rng, trackers);
            log(g, `${lordName(n)} met the boat.`, 'bad');
            return startFight(g, nemesisStats(n), 'ambush');
        }
        g.screen = 'hub';
        save(g);
        render(g);
    }

    function spendAttribute(g, id) {
        const p = g.p;
        if (!p.unspentAttributePoints || p.attributes[id] >= ATTR_SOFT_CAP) return;
        p.unspentAttributePoints--;
        p.attributes[id]++;
        p.vitals.hp = Math.min(maxHp(p), p.vitals.hp + (id === 'fortitude' ? 6 : 0));
        save(g);
        render(g);
    }

    function spendSkill(g, nodeId) {
        const p = g.p, node = skillNode(nodeId);
        if (!node || !p.skillPoints || rankOf(p, nodeId) >= 5) return;
        p.skillPoints--;
        p.skills[nodeId] = rankOf(p, nodeId) + 1;
        log(g, `${node.name} rank ${p.skills[nodeId]}.`, 'good');
        save(g);
        render(g);
    }

    function socketRune(g, runeIdx) {
        const p = g.p;
        const sel = g.body.querySelector(`select[data-rune="${runeIdx}"]`);
        if (!sel) return;
        const all = p.inventory.concat(SLOTS.map(s => p.equipment[s]).filter(Boolean));
        const item = all.find(i => i.id === sel.value);
        const runeId = p.runes[runeIdx];
        if (!item || !runeId) return;
        const socket = (item.sockets || []).find(s => !s.runeId);
        if (!socket) { log(g, 'no open socket on that.', 'warn'); return render(g); }
        socket.runeId = runeId;
        p.runes.splice(runeIdx, 1);
        log(g, `${(runeById(runeId) || {}).name} set into ${item.name}. resonance holds.`, 'good');
        save(g);
        render(g);
    }

    // ---------- new game ----------
    function freshCreate() {
        return {
            name: 'dredger',
            seed: String(Math.floor(Math.random() * 4294967295) >>> 0),
            attributes: { might: ATTR_START, finesse: ATTR_START, attunement: ATTR_START, fortitude: ATTR_START, perception: ATTR_START }
        };
    }

    function startNewGame(g) {
        const nameEl = g.body.querySelector('#et-name');
        const seedEl = g.body.querySelector('#et-seed');
        const name = ((nameEl && nameEl.value) || 'dredger').trim().slice(0, 18) || 'dredger';
        let seed = parseInt((seedEl && seedEl.value) || '', 10);
        if (!isFinite(seed) || seed <= 0) seed = Math.floor(Math.random() * 4294967295);
        seed = seed >>> 0;

        g.rng = makeRng(seed);
        g.lordSeq = 1; g.itemSeq = 1;
        g.p = newProfile(name, seed);
        for (const k in g.create.attributes) g.p.attributes[k] = g.create.attributes[k];
        g.p.unspentAttributePoints = ATTR_FREE - D.attributes.reduce((s, a) => s + (g.create.attributes[a.id] - ATTR_START), 0);
        g.p.vitals.hp = maxHp(g.p);
        g.p.vitals.stamina = maxStamina(g.p);
        g.p.vitals.sanity = maxSanity(g.p);
        g.roster = birthRoster(g);
        g.ended = null;
        g.log = [];

        // a character the deep recruited on this seed is on the roster now
        for (const d of drownedFor(seed)) {
            const realm = realmById(d.realm) || D.realms[0];
            const lord = makeLord(g, realm, 'warlord');
            lord.name = d.name;
            lord.epithet = 'the Twice-Drowned';
            lord.title = D.titles.sanity;
            lord.level = Math.max(6, d.level);
            lord.traits.push('tracker');
            lord.weaknesses.push('it was you, and it fights the way you do.');
            remember(lord, 'promoted', 0, realm.id, 'was ' + d.name + ', until the singing');
            g.roster.push(lord);
            log(g, `${d.name} is on the roster. They went under on this seed on day ${d.day}.`, 'bad');
        }

        // starting kit
        const hook = makeItem(g, recipeById('rig_hook'), 3);
        const line = makeItem(g, recipeById('tarred_line'), 3);
        const vest = makeItem(g, recipeById('plate_vest'), 3);
        const hood = makeItem(g, recipeById('welders_hood'), 2);
        g.p.inventory.push(hook, line, vest, hood);
        equip(g, hook); equip(g, line); equip(g, vest); equip(g, hood);

        log(g, 'a line came up with a piece of worked brass on it, and the brass was warm.', 'lore');
        g.screen = 'hub';
        achieve('echoes');
        save(g);
        render(g);
    }

    // ---------- boot ----------
    function boot(g) {
        const saved = load();
        if (saved && saved.p) {
            g.p = saved.p;
            g.roster = saved.roster || [];
            g.rng = makeRng(saved.p.seed);
            g.rng.seed(saved.state);
            g.lordSeq = saved.lordSeq;
            g.itemSeq = saved.itemSeq;
            g.ended = saved.ended;
            g.screen = g.ended ? 'end' : 'hub';
            // vitals can arrive stale if gear changed the maxima
            g.p.vitals.hp = clamp(g.p.vitals.hp, 1, maxHp(g.p));
            g.p.vitals.stamina = clamp(g.p.vitals.stamina, 0, maxStamina(g.p));
            g.p.vitals.sanity = clamp(g.p.vitals.sanity, 0, maxSanity(g.p));
            log(g, `day ${g.p.clock.day}, ${timeOfDay(g.p)}. ${realmById(g.p.realm).name}.`);
        } else {
            g.create = freshCreate();
            g.screen = 'create';
        }
        render(g);
    }

    let current = null;

    function startEchoes() {
        if (current && current.win && document.getElementById(current.win.id)) {
            current.win.style.zIndex = (parseInt(current.win.style.zIndex, 10) || 200) + 1;
            return;
        }
        const { body, win } = createAppWindow('echoes of the tide', { icon: 'explore', width: 720 });
        const g = {
            body: body, win: win, open: true,
            p: null, roster: [], log: [], screen: 'create',
            fight: null, dungeon: null, dredge: null, forge: null, dialogue: null,
            rng: makeRng(1), lordSeq: 1, itemSeq: 1, ended: null, raf: 0,
            create: freshCreate(), lastForged: null
        };
        current = g;

        body.addEventListener('click', e => onClick(g, e));
        // the reel is a hold, not a click
        const hold = down => e => {
            const t = e.target.closest('[data-a="reel"]');
            if (!t) return;
            e.preventDefault();
            if (g.dredge) g.dredge.held = down;
        };
        body.addEventListener('pointerdown', hold(true));
        body.addEventListener('pointerup', hold(false));
        body.addEventListener('pointercancel', hold(false));
        body.addEventListener('pointerleave', hold(false));
        const keyDown = e => {
            if (!g.open) return;
            if (e.code !== 'Space') return;
            if (g.screen === 'dredge' && g.dredge) { e.preventDefault(); g.dredge.held = true; }
            else if (g.screen === 'forge' && g.forge) { e.preventDefault(); forgeInput(g); render(g); }
        };
        const keyUp = e => { if (g.open && e.code === 'Space' && g.dredge) g.dredge.held = false; };
        document.addEventListener('keydown', keyDown);
        document.addEventListener('keyup', keyUp);

        win._cleanup = () => {
            g.open = false;
            if (g.raf) cancelAnimationFrame(g.raf);
            document.removeEventListener('keydown', keyDown);
            document.removeEventListener('keyup', keyUp);
            if (g.p) save(g);
            if (current === g) current = null;
        };

        boot(g);
    }

    window.startEchoes = startEchoes;

    // the headless surface the tests drive: everything a balance pass needs,
    // and nothing that touches the DOM
    window.ET_ENGINE = {
        D: D, makeRng: makeRng, ri: ri, pick: pick, chance: chance, clamp: clamp,
        MITIGATION_FACTOR: MITIGATION_FACTOR, CRIT_CAP: CRIT_CAP, CRIT_K: CRIT_K,
        DODGE_CAP: DODGE_CAP, DODGE_K: DODGE_K, REEL_FORCE: REEL_FORCE,
        xpToNext: xpToNext, maxHp: maxHp, maxStamina: maxStamina, maxSanity: maxSanity,
        carryWeight: carryWeight, armourOf: armourOf, pressureRating: pressureRating,
        rollDamage: rollDamage, critChance: critChance, critMultiplier: critMultiplier,
        dodgeChance: dodgeChance, hitChance: hitChance, elementMult: elementMult,
        d20check: d20check, skillMod: skillMod, sanityLoss: sanityLoss, sanityTier: sanityTier,
        timeOfDay: timeOfDay, tidePhase: tidePhase, isNight: isNight, tidePull: tidePull,
        newProfile: newProfile, makeItem: makeItem, itemStat: itemStat, gearStat: gearStat,
        birthRoster: birthRoster, makeLord: makeLord, nemesisStats: nemesisStats,
        lordKilledPlayer: lordKilledPlayer, lordSawYouRun: lordSawYouRun,
        lordSurvived: lordSurvived, lordDefeated: lordDefeated, checkPromotion: checkPromotion,
        rosterDayPasses: rosterDayPasses, foeFromTemplate: foeFromTemplate,
        startFight: startFight, playerAction: playerAction, dealToFoe: dealToFoe,
        pickFish: pickFish, pickFoe: pickFoe, dredgeStep: dredgeStep, newDredgeState: newDredgeState, advanceClock: advanceClock,
        forgeable: forgeable, canForge: canForge, skillEffect: skillEffect,
        remap: remap, KEYMAP: KEYMAP, UNMAP: UNMAP, gainXp: gainXp, log: log,
        NEMESIS_SCALE: NEMESIS_SCALE, RANKS: RANKS, SLOTS: SLOTS, TIME_OF_DAY: TIME_OF_DAY, TIDE_PHASE: TIDE_PHASE
    };
})();
