/* echoes of the tide: leviathan's wake — the rules.
 *
 * Implements games/ECHOES-GDD.md. The constants named in the document are
 * the constants below, under the same names, so the two can be diffed by
 * eye. Content lives in games/echoes-data.js and is read only; the save
 * engine and the event bus live in games/echoes-core.js.
 *
 * Everything is deterministic from a single uint32 seed: the nemesis
 * roster, the dungeon graphs and the loot rolls all come off one xorshift
 * stream whose state is saved with the profile.
 */

(function () {
    'use strict';

    const D = window.ECHOES_DATA;

    // ---------- combat constants (GDD Module 2) ----------
    const ARMOR_K = 350;                 // 350 armour = 50% mitigation
    const BASE_HIT_CHANCE = 0.85;
    const GLANCING_WINDOW = 0.10;        // a miss by this much is a glancing blow
    const GLANCING_MULTIPLIER = 0.50;
    const VARIANCE = [0.95, 1.05];
    const CRIT_BASE_MULTIPLIER = 1.50;
    const HIT_FLOOR = 0.05, HIT_CEILING = 0.99;

    const HP_BASE = 100, HP_PER_LEVEL = 30;
    const STAMINA_BASE = 90, STAMINA_PER_LEVEL = 2;
    const SANITY_MAX = 100;
    const ATTR_PER_LEVEL = 3, SKILL_PER_LEVEL = 1;
    const ATTR_START = 8;
    const MAX_LEVEL = 50;

    const SANITY_ILLUSION = 25;          // below this the interface lies to you
    const PANIC_SKIP_CHANCE = 0.30;      // at zero sanity, per turn

    // Module 5 — procedural difficulty: M = 1 + (D * 0.25) + (k * 0.08)
    const DEPTH_SCALE = 0.25, ROOM_SCALE = 0.08;

    // Module 3 — ambush
    const AMBUSH_BASE = 0.05, AMBUSH_PER_GRUDGE = 0.04, AMBUSH_CAP = 0.65;

    // Module 4 — angling
    const TENSION_GREEN = [40, 80];
    const TENSION_MAX = 100;

    const SLOTS = ['main_hand', 'off_hand', 'head', 'body', 'lantern'];
    const SLOT_NAMES = { main_hand: 'main hand', off_hand: 'off hand', head: 'head', body: 'body', lantern: 'lantern' };
    const ELEMENTS = ['physical', 'abyssal', 'burn', 'bleed', 'crush', 'rot'];
    const SAVE_KEY = 'ECHOES_OF_THE_TIDE_SAVE';

    const saves = new window.SaveEngine(SAVE_KEY);
    const bus = window.GameBus;

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
        f.seed = v => { s = (v >>> 0) || 0x9e3779b9; };
        return f;
    }
    const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
    const rf = (rng, a, b) => a + rng() * (b - a);
    const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
    const chance = (rng, p) => rng() < p;
    const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
    const byId = (list, id) => list.find(x => x.id === id) || null;

    function weighted(rng, entries, weightOf) {
        let total = 0;
        for (const e of entries) total += Math.max(0, weightOf(e));
        if (total <= 0) return entries[0];
        let roll = rng() * total;
        for (const e of entries) { roll -= Math.max(0, weightOf(e)); if (roll <= 0) return e; }
        return entries[entries.length - 1];
    }

    // ---------- content lookups ----------
    const realmById = id => byId(D.realms, id);
    const recipeById = id => byId(D.recipes, id);
    const runeById = id => byId(D.runes, id);
    const materialById = id => byId(D.materials, id);
    const catchById = id => byId(D.catches, id);
    const rarityById = id => byId(D.rarities, id);
    const bandFor = score => D.qualityBands.find(b => score >= b.min && score <= b.max) || D.qualityBands[0];
    const foeById = id => byId(D.bestiary, id) || byId(D.bosses, id);
    const spotsIn = realm => D.fishingSpots.filter(s => s.realm === realm);
    function skillNode(id) {
        for (const t of D.skillTrees) { const n = byId(t.nodes, id); if (n) return n; }
        return null;
    }
    function treeOf(nodeId) {
        for (const t of D.skillTrees) if (byId(t.nodes, nodeId)) return t;
        return null;
    }

    // ---------- experience (GDD Module 2, the published table) ----------
    // The document publishes a table rather than a formula, so the table is
    // the authority: these seven levels come out to the digit and the rest
    // are interpolated in log space, which keeps the curve monotone.
    const XP_ANCHORS = [[1, 150], [5, 2214], [10, 7532], [20, 26890], [30, 56710], [40, 96540], [50, 145980]];
    function xpToNext(level) {
        const L = clamp(Math.round(level), 1, MAX_LEVEL);
        for (let i = 0; i < XP_ANCHORS.length - 1; i++) {
            const [l0, x0] = XP_ANCHORS[i], [l1, x1] = XP_ANCHORS[i + 1];
            if (L === l0) return x0;
            if (L > l0 && L < l1) {
                const t = (Math.log(L) - Math.log(l0)) / (Math.log(l1) - Math.log(l0));
                return Math.round(Math.exp(Math.log(x0) + t * (Math.log(x1) - Math.log(x0))));
            }
        }
        return XP_ANCHORS[XP_ANCHORS.length - 1][1];
    }
    const LEVEL_UNLOCKS = {
        5: 'Tier 2 skills',
        10: 'the off-hand slot: a second weapon, a shield or a lantern',
        20: 'Nemesis hunt contracts and advanced marrow sockets',
        30: 'Tier 4 ultimates',
        40: 'the Abyssal Trench diving licence and legendary patterns',
        50: 'the Archon stat cap and Masterwork crafting'
    };

    // ---------- gear ----------
    // an item's affixes are stored the way the design document names them,
    // as prefixes and suffixes, because the item's name is assembled from
    // them — but every stat lookup wants one flat list
    function allAffixes(item) {
        if (!item || !item.affixes) return [];
        return (item.affixes.prefix || []).concat(item.affixes.suffix || []);
    }
    function itemStat(item, stat) {
        if (!item) return 0;
        let v = (item.base_stats && item.base_stats[stat]) || 0;
        for (const a of allAffixes(item)) if (a.stat === stat) v += a.value;
        for (const s of item.sockets || []) {
            if (!s.gem_id) continue;
            const r = runeById(s.gem_id);
            if (!r) continue;
            if (r.stat === stat) v += r.value;
            if (r.extra && r.extra[stat]) v += r.extra[stat];
        }
        return v;
    }
    function gearStat(p, stat) {
        let sum = 0;
        for (const slot of SLOTS) sum += itemStat(p.equipment[slot], stat);
        return sum;
    }
    function heavyPieces(p) {
        let n = 0;
        for (const slot of SLOTS) {
            const it = p.equipment[slot];
            if (it && it.heavy) n++;
        }
        return n;
    }
    function curseEffect(p, key) {
        let total = 0;
        for (const slot of SLOTS) {
            const it = p.equipment[slot];
            if (!it || !it.curse) continue;
            const c = byId(D.curses, it.curse);
            if (!c) continue;
            if (c.grants && c.grants[key]) total += c.grants[key];
            if (c.costs && c.costs[key]) total += c.costs[key];
        }
        return total;
    }

    // ---------- skills ----------
    function rankOf(p, nodeId) { return (p.skills && p.skills[nodeId]) || 0; }
    function skillValue(p, nodeId) {
        const node = skillNode(nodeId);
        const r = rankOf(p, nodeId);
        if (!node || r < 1) return 0;
        if (node.ranks) return node.ranks[Math.min(r, node.ranks.length) - 1];
        if (node.scaling) return node.scaling.baseMultiplier + node.scaling.perRank * (r - 1);
        if (node.stunChance) return node.stunChance[Math.min(r, node.stunChance.length) - 1];
        if (node.dot && node.dot.flat) return node.dot.flat[Math.min(r, node.dot.flat.length) - 1];
        if (node.heal) return node.heal.maxHpPct + (node.heal.perRank || 0) * (r - 1);
        if (node.barrier) return node.barrier.armourMultiplier + (node.barrier.perRank || 0) * (r - 1);
        return r;
    }
    function passive(p, effectId) {
        let total = 0;
        for (const tree of D.skillTrees) for (const node of tree.nodes) {
            if (node.effect !== effectId) continue;
            const r = rankOf(p, node.id);
            if (r > 0) total += node.ranks[Math.min(r, node.ranks.length) - 1];
        }
        return total;
    }
    function tierUnlocked(p, tier) { return p.level >= (D.tierLevel[tier] || 1); }

    // ---------- derived stats (GDD Module 2.1) ----------
    const per = id => (byId(D.attributes, id) || { perPoint: {} }).perPoint;
    function maxHp(p) {
        const flat = HP_BASE + p.attributes.fortitude * per('fortitude').maxHp + (p.level - 1) * HP_PER_LEVEL + gearStat(p, 'maxHp');
        return Math.max(1, Math.round(flat * (1 + curseEffect(p, 'maxHpPct'))));
    }
    function maxStamina(p) { return STAMINA_BASE + (p.level - 1) * STAMINA_PER_LEVEL + Math.round(p.attributes.fortitude * 1.5); }
    function maxMarrow(p) { return Math.round(p.attributes.attunement * per('attunement').marrowMana + gearStat(p, 'maxMarrow')); }
    function maxSanity(p) { return SANITY_MAX; }
    function carryCapacity(p) { return 40 + p.attributes.might * per('might').carryCapacity; }

    // Armour = flat gear armour, lifted by Fortitude's natural layer and by
    // whatever the smithing tree has been told to do about it.
    function armourOf(p) {
        let flat = gearStat(p, 'armour');
        let mult = 1 + p.attributes.fortitude * per('fortitude').naturalArmourPct;
        mult += passive(p, 'armourPct');
        mult += passive(p, 'armourPerHeavyPiece') * heavyPieces(p);
        if (p.faction === 'syndicate') mult += D.factions.syndicate.bonus.armourPct;
        return Math.max(0, Math.round(flat * mult));
    }
    // the whole point of the curve: stacking armour approaches 100% and
    // never arrives, so nothing in the game is unhittable
    function armourMitigation(armour) { return armour / (armour + ARMOR_K); }

    function critChance(p) {
        let c = p.attributes.finesse * per('finesse').critChancePct + gearStat(p, 'critChancePct');
        const seeker = passive(p, 'perceptionToCrit');
        if (seeker) c += p.attributes.perception * seeker / 100;
        return clamp(c, 0, 0.95);
    }
    function critMultiplier(p) {
        return CRIT_BASE_MULTIPLIER
            + p.attributes.perception * per('perception').critDamagePct
            + passive(p, 'critDamagePct')
            + curseEffect(p, 'critDamagePct');
    }
    function hitRating(p) { return p.attributes.perception * per('perception').hitChancePct + gearStat(p, 'hitChancePct'); }
    function dodgeRating(p) {
        return p.attributes.finesse * per('finesse').dodgePct
            + gearStat(p, 'dodgePct')
            + passive(p, 'dodgeFlat');
    }
    function blockValue(p) {
        return Math.round(p.attributes.might * per('might').blockValue + gearStat(p, 'blockValue'));
    }
    function sanityResist(p) {
        return p.attributes.attunement * per('attunement').sanityResist + gearStat(p, 'sanityResist');
    }
    function hazardResist(p) {
        return clamp(gearStat(p, 'hazardResistPct') + passive(p, 'hazardResist'), 0, 0.95);
    }
    function carriedWeight(p) {
        let w = 0;
        for (const it of p.inventory || []) w += (it.weight || 0) * (it.count || 1);
        for (const slot of SLOTS) if (p.equipment[slot]) w += p.equipment[slot].weight || 0;
        return Math.round(w * 10) / 10;
    }

    // ---------- the combat maths (GDD Module 2.2) ----------
    function elementMultiplier(type, target) {
        if (target.immune && target.immune.indexOf(type) >= 0) return 0;
        if (target.weak && target.weak.indexOf(type) >= 0) return 1.5;
        if (target.resist && target.resist.indexOf(type) >= 0) return 0.5;
        return 1;
    }

    // Raw = base * statMultiplier * abilityMultiplier * variance
    // Net = Raw * elementMultiplier * (1 - Armor/(Armor+350))
    function computeDamage(rng, opts) {
        const variance = rf(rng, VARIANCE[0], VARIANCE[1]);
        const raw = opts.base * (1 + (opts.statBonus || 0)) * (opts.abilityMultiplier || 1) * variance;
        let armour = Math.max(0, opts.targetArmour || 0);
        if (opts.piercing) armour *= 0.5;
        if (opts.armourBreak) armour *= (1 - opts.armourBreak);
        const mitigation = armourMitigation(armour);
        let net = raw * (1 - mitigation) * (opts.elementMultiplier === undefined ? 1 : opts.elementMultiplier);
        return { raw: raw, mitigation: mitigation, net: Math.max(0, net) };
    }

    // 85% base, shifted by the gap between the attacker's hit and the
    // target's dodge. A roll that misses by less than ten points still
    // lands, for half, and cannot crit.
    function resolveSwing(rng, attackerHit, targetDodge) {
        const threshold = clamp(BASE_HIT_CHANCE + (attackerHit - targetDodge), HIT_FLOOR, HIT_CEILING);
        const roll = rng();
        if (roll <= threshold) return { outcome: 'hit', roll: roll, threshold: threshold };
        if (roll <= threshold + GLANCING_WINDOW) return { outcome: 'glancing', roll: roll, threshold: threshold };
        return { outcome: 'miss', roll: roll, threshold: threshold };
    }

    function skillCheck(rng, attributeValue, difficulty) {
        const roll = ri(rng, 1, 20);
        const total = roll + Math.floor(attributeValue / 2);
        if (roll === 20) return { roll, total, difficulty, pass: true, critical: 'success' };
        if (roll === 1) return { roll, total, difficulty, pass: false, critical: 'failure' };
        return { roll, total, difficulty, pass: total >= difficulty, critical: null };
    }

    function sanityLoss(p, base) {
        const resist = clamp(sanityResist(p) / 100, 0, 0.75);
        let loss = base * (1 - resist) * (1 - clamp(passive(p, 'sanityWard'), 0, 0.8));
        if (p.faction === 'dredgers') loss *= (1 + D.factions.dredgers.bonus.sanityLossPct);
        return Math.max(0, Math.round(loss));
    }
    function sanityTier(p) {
        const s = p.vitals.sanity;
        if (s <= 0) return 'panic';
        if (s < SANITY_ILLUSION) return 'illusions';
        if (s < 50) return 'fraying';
        if (s < 75) return 'uneasy';
        return 'steady';
    }

    // ---------- item generation (GDD Module 4 & 5) ----------
    function rollRarity(rng, bias) {
        // bias shifts the roll up the ladder: forge quality, Trophy rank,
        // dungeon depth all push toward the coloured end
        const pool = D.rarities.filter(r => !r.cursed);
        const chosen = weighted(rng, pool, r => r.weight * (1 + (bias || 0) * (D.rarities.indexOf(r) / 2)));
        return chosen;
    }

    function rollAffix(rng, pool, slot, tier, budget) {
        const legal = pool.filter(a => a.slots.indexOf(slot) >= 0);
        if (!legal.length) return null;
        const a = pick(rng, legal);
        const roll = rf(rng, a.min, a.max);
        const tierScale = 0.45 + tier * 0.11;          // a tier-1 affix is not a tier-5 affix
        const value = a.pct
            ? Math.round(roll * budget * tierScale * 1000) / 1000
            : Math.max(1, Math.round(roll * budget * tierScale));
        return { id: a.id, name: a.name, stat: a.stat, value: value, pct: !!a.pct };
    }

    function nameItem(baseName, affixes) {
        const pre = (affixes.prefix || [])[0];
        const suf = (affixes.suffix || [])[0];
        return (pre ? pre.name + ' ' : '') + baseName + (suf ? ' ' + suf.name : '');
    }

    function makeItem(g, recipe, opts) {
        const rng = g.rng, o = opts || {};
        const band = o.qualityScore === undefined ? bandFor(60) : bandFor(o.qualityScore);
        let rarity = o.rarity || rollRarity(rng, o.rarityBias || 0);
        // a piece you forged well cannot come off the anvil Common: the
        // quality band sets a floor and the roll may still beat it
        if (o.forged && !rarity.cursed) {
            const floorId = { defective: 'common', standard: 'sturdy', masterwork: 'abyssal_rare', abyssal_forged: 'dread_epic' }[band.id];
            const floor = rarityById(floorId);
            if (floor && D.rarities.indexOf(floor) > D.rarities.indexOf(rarity)) rarity = floor;
        }
        const material = materialById(o.materialId) || D.materials.find(m => m.tier === recipe.tier) || D.materials[0];

        const statMult = band.statMultiplier * rarity.budget * (material.statScale || 1) / 1.0;
        const base_stats = {};
        for (const k in recipe.base) {
            const v = recipe.base[k];
            if (typeof v === 'boolean') { base_stats[k] = v; continue; }
            base_stats[k] = k.endsWith('Pct') ? Math.round(v * statMult * 1000) / 1000 : Math.max(1, Math.round(v * statMult));
        }

        const affixes = { prefix: [], suffix: [] };
        const nPre = rarity.prefixes + (band.extraAffixes || 0);
        for (let i = 0; i < nPre; i++) {
            const a = rollAffix(rng, D.prefixes, recipe.slot, recipe.tier, rarity.budget);
            if (a && !affixes.prefix.some(x => x.id === a.id)) affixes.prefix.push(a);
        }
        for (let i = 0; i < rarity.suffixes; i++) {
            const a = rollAffix(rng, D.suffixes, recipe.slot, recipe.tier, rarity.budget);
            if (a && !affixes.suffix.some(x => x.id === a.id)) affixes.suffix.push(a);
        }

        const socketRange = rarity.sockets;
        const materialSockets = material.sockets || 0;
        const socketCount = Math.min(3, ri(rng, socketRange[0], socketRange[1]) + (o.forged ? materialSockets : 0));
        const sockets = [];
        for (let i = 0; i < socketCount; i++) sockets.push({ slot: i + 1, gem_id: null, bonus: null });

        const durMax = Math.round((60 + recipe.tier * 30 + passive(g.p || { skills: {} }, 'durability')) * band.durabilityMultiplier);

        const item = {
            item_id: 'itm_' + (g.itemSeq++).toString(36),
            recipe_id: recipe.id,
            name: '',
            rarity: rarity.id,
            rarity_name: rarity.name,
            rarity_colour: rarity.colour,
            quality_band: band.id,
            quality_score: o.qualityScore === undefined ? null : o.qualityScore,
            tier: recipe.tier,
            slot: recipe.slot,
            heavy: !!recipe.heavy,
            base_stats: base_stats,
            damage_type: recipe.damageType || null,
            piercing: !!recipe.base.piercing,
            permanent_kill: !!recipe.permanentKill,
            counters: recipe.counters || null,
            affixes: affixes,
            sockets: sockets,
            durability: { current: durMax, max: durMax },
            weight: recipe.weight,
            value: Math.round(recipe.value * rarity.budget * band.statMultiplier),
            curse: null
        };
        if (rarity.cursed) {
            const c = pick(rng, D.curses);
            item.curse = c.id;
            item.name = c.name.replace('Cursed: ', '') + ' ' + recipe.name;
        }
        if (!item.name) item.name = nameItem(recipe.name, affixes);
        return item;
    }

    function canCraft(p, recipe) {
        if (recipe.faction && p.faction !== recipe.faction) return false;
        if ((p.life_skills.smithing.level || 1) < (recipe.skill || 1)) return false;
        for (const m in recipe.cost) if ((p.materials[m] || 0) < recipe.cost[m]) return false;
        return true;
    }
    function payFor(p, recipe) { for (const m in recipe.cost) p.materials[m] -= recipe.cost[m]; }

    function equip(g, item) {
        const p = g.p;
        if (item.slot === 'off_hand' && p.level < 10) { log(g, 'the off-hand slot opens at level 10.', 'warn'); return false; }
        const old = p.equipment[item.slot];
        p.equipment[item.slot] = item;
        const idx = p.inventory.indexOf(item);
        if (idx >= 0) p.inventory.splice(idx, 1);
        if (old) p.inventory.push(old);
        clampVitals(p);
        log(g, 'equipped ' + item.name + '.');
        bus.emit('ITEM_EQUIPPED', item);
        return true;
    }
    function clampVitals(p) {
        p.vitals.max_hp = maxHp(p);
        p.vitals.max_stamina = maxStamina(p);
        p.vitals.max_marrow_mana = maxMarrow(p);
        p.vitals.max_sanity = maxSanity(p);
        p.vitals.hp = clamp(p.vitals.hp, 0, p.vitals.max_hp);
        p.vitals.stamina = clamp(p.vitals.stamina, 0, p.vitals.max_stamina);
        p.vitals.marrow_mana = clamp(p.vitals.marrow_mana, 0, p.vitals.max_marrow_mana);
        p.vitals.sanity = clamp(p.vitals.sanity, 0, p.vitals.max_sanity);
    }

    // ---------- the Drowned Admiralty (GDD Module 3) ----------
    const RANK_BY_TIER = tier => D.nemesisRanks.find(r => r.tier === tier) || D.nemesisRanks[0];
    // roster entries are keyed by nemesis_id, not id — byId() would silently
    // find nothing, and a Lord that never gets looked up never remembers
    // anything that happened to it
    const lordById = (roster, id) => roster.find(n => n.nemesis_id === id) || null;

    // A Lord's profile is derived from its power index and its rank's
    // multipliers. Pulled out and named because it is the hardest thing in
    // the game to balance by eye — a Lord is a fight you are meant to lose
    // sometimes, and the margin either side of that is narrow.
    const NEMESIS_SCALE = { hpBase: 120, hpPerPower: 34, dmgBase: 6, dmgPerPower: 3.6, armBase: 25, armPerPower: 4 };
    // Module 3's worked example puts a Deck Captain at 1850 hp / 85 damage /
    // 180 armour against a level-12 diver with 532 hp. Those two numbers do
    // not describe a fight — that captain kills the document's own example
    // character in seven rounds and takes twenty-eight to die — so the shape
    // of the formula is the document's and the constants are measured.

    function lordDisplayName(n) { return n.title ? n.name + ', ' + n.title : n.name; }

    function makeLord(g, opts) {
        const rng = g.rng, o = opts || {};
        const tier = o.tier === undefined ? 1 : o.tier;
        const rank = RANK_BY_TIER(tier);
        const creature = o.creature ? byId(D.lordCreatures, o.creature) : pick(rng, D.lordCreatures);
        const realm = o.realm || pick(rng, D.realms).id;
        const level = o.level || Math.max(2, realmById(realm).layer * 5 + ri(rng, -1, 2));
        const faction = o.faction || pick(rng, ['syndicate_mutant', 'dredger_born', 'ash_touched', 'feral']);

        const node = {
            nemesis_id: 'nem_' + (g.lordSeq++).toString(36),
            name: pick(rng, D.lordNames.given),
            title: rank.named ? pick(rng, D.lordNames.epithet) : null,
            rank: rank.name,
            tier: tier,
            power_index: level + tier * 3,
            faction_origin: faction,
            current_zone: realm,
            status: 'active',
            base_creature: creature.id,
            level: level,
            visual_traits: { scar: null, mutation: null, weapon: creature.weapon },
            combat_profile: { max_hp: 0, current_hp: 0, base_damage: 0, armor: 0, speed: 10 },
            traits: { immunities: [], enrage_triggers: [], vulnerabilities: [], phobias: [] },
            memories: [],
            grudge: 0,
            dialogue_set: {
                intro_encounter: pick(rng, D.lordDialogue.intro),
                on_kill_player: pick(rng, D.lordDialogue.onKill),
                on_flee: pick(rng, D.lordDialogue.onFlee)
            }
        };
        // a rank's strengths are rolled at birth; its weaknesses are usually earned
        for (let i = 0; i < (rank.strengths || 0); i++) {
            const pool = i === 0 ? D.nemesisTraits.immunities.filter(t => !t.earned) : D.nemesisTraits.enrages;
            const t = pick(rng, pool);
            const bucket = i === 0 ? node.traits.immunities : node.traits.enrage_triggers;
            if (bucket.indexOf(t.id) < 0) bucket.push(t.id);
        }
        for (let i = 0; i < (rank.weaknesses || 0); i++) {
            const t = pick(rng, D.nemesisTraits.vulnerabilities.filter(x => !x.earned));
            if (t && node.traits.vulnerabilities.indexOf(t.id) < 0) node.traits.vulnerabilities.push(t.id);
        }
        refreshLordProfile(node);
        return node;
    }

    // the combat profile is derived, never stored by hand, so a mutation is
    // one field change and a recomputation rather than six numbers to keep
    // in step with each other
    function refreshLordProfile(n) {
        const c = byId(D.lordCreatures, n.base_creature) || D.lordCreatures[0];
        const rank = D.nemesisRanks.find(r => r.name === n.rank) || D.nemesisRanks[0];
        const power = n.power_index;
        const S = NEMESIS_SCALE;
        const hp = Math.round((S.hpBase + power * S.hpPerPower) * c.hp * rank.hpMultiplier);
        n.combat_profile = {
            max_hp: hp,
            current_hp: hp,
            base_damage: Math.round((S.dmgBase + power * S.dmgPerPower) * c.damage * rank.damageMultiplier),
            armor: Math.round((S.armBase + power * S.armPerPower) * c.armour),
            speed: Math.round(10 + (c.dodge * 40) - (n.traits.vulnerabilities.indexOf('brittle_shell') >= 0 ? 1 : 0))
        };
        return n;
    }

    function lordToFoe(n) {
        const c = byId(D.lordCreatures, n.base_creature) || D.lordCreatures[0];
        const immune = [], resist = [], weak = [];
        for (const id of n.traits.immunities) {
            const t = byId(D.nemesisTraits.immunities, id);
            if (t && t.immuneTo) for (const e of t.immuneTo) immune.push(e);
        }
        for (const id of n.traits.vulnerabilities) {
            const t = byId(D.nemesisTraits.vulnerabilities, id);
            if (t && t.element) weak.push(t.element);
        }
        return {
            id: n.nemesis_id, nemesis_id: n.nemesis_id, lord: true,
            name: lordDisplayName(n), level: n.level, rank: n.rank, tier: n.tier,
            hp: n.combat_profile.max_hp, max_hp: n.combat_profile.max_hp,
            damage: n.combat_profile.base_damage, damageType: c.damageType,
            armour: n.combat_profile.armor,
            hit: 0.08 + n.tier * 0.02, dodge: c.dodge,
            weak: weak, resist: resist, immune: immune,
            absorbs: n.traits.immunities.indexOf('abyssal_attuned') >= 0,
            traits: n.traits, sanity: 4 + n.tier * 3,
            xp: Math.round(400 * n.power_index * (0.6 + n.tier * 0.5)),
            coin: Math.round(60 * n.power_index * (0.5 + n.tier * 0.4)),
            drops: {}, text: c.text, intro: n.dialogue_set.intro_encounter
        };
    }

    // ---------- nemesis lifecycle ----------
    function remember(n, type, day, location, detail) {
        n.memories.push({ event_type: type, timestamp_game_day: day, location: location, detail: detail });
        if (n.memories.length > 40) n.memories.shift();
    }
    function addTrait(n, bucket, id) {
        if (n.traits[bucket].indexOf(id) < 0) n.traits[bucket].push(id);
    }
    function rosterCount(g, tier) { return g.roster.filter(n => n.tier === tier && n.status === 'active').length; }

    // A nameless thing that kills a diver is a Deck Captain by morning.
    function promoteOnKill(g, foe, deathType) {
        const p = g.p;
        let n = foe.nemesis_id ? lordById(g.roster, foe.nemesis_id) : null;

        if (!n) {
            // Tier 0 Brine Scum earns a seat, if there is one going
            const rank = RANK_BY_TIER(1);
            if (rosterCount(g, 1) >= rank.slots) {
                const weakest = g.roster.filter(x => x.tier === 1 && x.status === 'active')
                    .sort((a, b) => a.power_index - b.power_index)[0];
                if (weakest) { weakest.status = 'retired'; remember(weakest, 'lost_seat', p.world_state.current_day, weakest.current_zone, 'shouldered out by a nameless one'); }
            }
            n = makeLord(g, { tier: 1, realm: p.realm, level: Math.max(2, p.level) });
            n.title = D.earnedTitles['killed_by_' + deathType] || D.earnedTitles.killed_by_physical;
            g.roster.push(n);
            log(g, 'the thing that killed you has a name now: ' + lordDisplayName(n) + '.', 'bad');
            bus.emit('NEMESIS_BORN', n);
        } else {
            n.power_index += 1;
            if (!n.title || D.lordNames.epithet.indexOf(n.title) >= 0) {
                n.title = D.earnedTitles['killed_by_' + deathType] || n.title;
            }
            n.visual_traits.mutation = n.visual_traits.mutation || 'chitin_armored_shoulder';
            refreshLordProfile(n);
            // three kills and it starts looking at the seat above it
            const kills = n.memories.filter(m => m.event_type === 'killed_player').length;
            if (kills >= 2) tryPromote(g, n);
            log(g, lordDisplayName(n) + ' is stronger for having killed you.', 'bad');
        }
        n.grudge = Math.min(5, n.grudge + 1);
        n.current_zone = p.realm;
        remember(n, 'killed_player', p.world_state.current_day, p.realm, 'killed you by ' + deathType);
        bus.emit('PLAYER_DIED', n.nemesis_id);
        return n;
    }

    function tryPromote(g, n) {
        const nextTier = n.tier + 1;
        const rank = RANK_BY_TIER(nextTier);
        if (!rank || nextTier > 3) return false;
        const held = g.roster.filter(x => x.tier === nextTier && x.status === 'active');
        if (held.length >= rank.slots) {
            // take a seat off the weakest incumbent — who is demoted, not
            // removed, and who now has something to be angry about
            const incumbent = held.sort((a, b) => a.power_index - b.power_index)[0];
            if (incumbent.power_index >= n.power_index) return false;
            incumbent.tier = n.tier;
            incumbent.rank = RANK_BY_TIER(n.tier).name;
            incumbent.grudge = Math.min(5, incumbent.grudge + 2);
            remember(incumbent, 'demoted', g.p.world_state.current_day, incumbent.current_zone, 'lost the seat to ' + lordDisplayName(n));
            refreshLordProfile(incumbent);
        }
        n.tier = nextTier;
        n.rank = rank.name;
        n.power_index += 2;
        for (let i = n.traits.immunities.length; i < (rank.strengths || 1); i++) {
            const t = pick(g.rng, D.nemesisTraits.immunities.filter(x => !x.earned));
            addTrait(n, 'immunities', t.id);
        }
        if (rank.enrages && !n.traits.enrage_triggers.length) {
            addTrait(n, 'enrage_triggers', pick(g.rng, D.nemesisTraits.enrages).id);
        }
        refreshLordProfile(n);
        remember(n, 'promoted', g.p.world_state.current_day, n.current_zone, 'took a ' + rank.name + ' seat');
        log(g, lordDisplayName(n) + ' has been promoted to ' + rank.name + '.', 'bad');
        bus.emit('NEMESIS_PROMOTED', n);
        return true;
    }

    function lordSawYouRun(g, n) {
        addTrait(n, 'vulnerabilities', 'coward_scent');
        n.grudge = Math.min(5, n.grudge + 1);
        n.status = 'hunting';
        remember(n, 'player_fled', g.p.world_state.current_day, g.p.realm, 'you ran');
        if (!n.title || D.lordNames.epithet.indexOf(n.title) >= 0) n.title = D.earnedTitles.player_fled;
        bus.emit('PLAYER_FLED', n.nemesis_id);
    }

    // it walked away from a fight: whatever nearly finished it becomes the
    // thing it can no longer be finished by
    function lordSurvived(g, n, damageByType) {
        let total = 0, top = null, topV = 0;
        for (const k in damageByType) { total += damageByType[k]; if (damageByType[k] > topV) { topV = damageByType[k]; top = k; } }
        remember(n, 'survived_encounter', g.p.world_state.current_day, n.current_zone, 'walked away from you');
        n.grudge = Math.min(5, n.grudge + 1);
        if (!total || !top || topV / total < 0.30) return null;

        if (top === 'burn' && n.traits.immunities.indexOf('pyre_scarred') < 0) {
            addTrait(n, 'immunities', 'pyre_scarred');
            n.visual_traits.scar = 'burned_to_the_bone';
            if (!n.title || D.lordNames.epithet.indexOf(n.title) >= 0) n.title = D.earnedTitles.survived_fire;
            // burned once, and it may never stand for it again
            if (chance(g.rng, 0.40)) addTrait(n, 'phobias', 'fear_of_ash_fire');
            remember(n, 'survived_fire', g.p.world_state.current_day, n.current_zone, 'gained Pyre-Scarred');
            refreshLordProfile(n);
            return byId(D.nemesisTraits.immunities, 'pyre_scarred');
        }
        if ((top === 'physical' || top === 'crush') && n.traits.vulnerabilities.indexOf('one_eyed') < 0 && chance(g.rng, 0.45)) {
            addTrait(n, 'vulnerabilities', 'one_eyed');
            n.visual_traits.scar = 'blind_left_eye';
            if (!n.title || D.lordNames.epithet.indexOf(n.title) >= 0) n.title = D.earnedTitles.lost_an_eye;
            remember(n, 'lost_an_eye', g.p.world_state.current_day, n.current_zone, 'lost an eye to you');
            refreshLordProfile(n);
            return byId(D.nemesisTraits.vulnerabilities, 'one_eyed');
        }
        if (chance(g.rng, 0.35)) {
            const t = pick(g.rng, D.nemesisTraits.vulnerabilities.filter(x => !x.earned));
            if (t && n.traits.vulnerabilities.indexOf(t.id) < 0) {
                addTrait(n, 'vulnerabilities', t.id);
                remember(n, 'wounded', g.p.world_state.current_day, n.current_zone, 'gained ' + t.name);
                refreshLordProfile(n);
                return t;
            }
        }
        return null;
    }

    function lordDefeated(g, n, killingDamageType) {
        const weapon = g.p.equipment.main_hand;
        const permanent = (weapon && weapon.permanent_kill)
            || (g.p.faction === 'inquisitors' && killingDamageType === 'burn')
            || (g.p.faction === 'dredgers' && killingDamageType === 'abyssal');
        if (permanent) {
            n.status = 'dead';
            g.p.stats.lords_ended++;
            remember(n, 'killed_permanently', g.p.world_state.current_day, n.current_zone, 'you ended it properly');
            log(g, lordDisplayName(n) + ' is dead, and stays dead.', 'good');
            achieve('echoes-lord');
            bus.emit('NEMESIS_KILLED', n);
            return 'dead';
        }
        if (n.tier > 0) {
            n.tier -= 1;
            n.rank = RANK_BY_TIER(n.tier).name;
        }
        n.power_index = Math.max(1, n.power_index - 2);
        n.grudge = Math.min(5, n.grudge + 2);
        n.status = 'active';
        refreshLordProfile(n);
        remember(n, 'poorly_drowned', g.p.world_state.current_day, n.current_zone, 'you put it down and it did not take');
        log(g, lordDisplayName(n) + ' goes under. It does not stay under.', 'warn');
        return 'poorly_drowned';
    }

    // P(ambush) = base + grudge*step + coward-scent bonus, capped
    function ambushChance(g, n) {
        let p = AMBUSH_BASE + AMBUSH_PER_GRUDGE * (n.grudge || 0);
        if (n.traits.vulnerabilities.indexOf('coward_scent') >= 0) {
            p += byId(D.nemesisTraits.vulnerabilities, 'coward_scent').ambushBonus;
        }
        for (const slot of SLOTS) {
            const it = g.p.equipment[slot];
            if (it && it.curse) p += curseEffect(g.p, 'ambushChancePct') > 0 ? 0 : 0;
        }
        p += Math.max(0, curseEffect(g.p, 'ambushChancePct'));
        if (n.status === 'hunting') p += 0.08;
        return clamp(p, 0, AMBUSH_CAP);
    }
    function lordsIn(g, realmId) { return g.roster.filter(n => n.current_zone === realmId && n.status !== 'dead' && n.status !== 'retired'); }
    function rollAmbush(g, realmId) {
        const here = lordsIn(g, realmId);
        for (const n of here.sort((a, b) => b.grudge - a.grudge)) {
            if (chance(g.rng, ambushChance(g, n))) return n;
        }
        return null;
    }

    // the admiralty is generated at new-game and the seats stay filled
    function birthAdmiralty(g) {
        const roster = [];
        const seed = { g: g, roster: roster };
        for (const realm of D.realms) {
            for (let i = 0; i < 3; i++) roster.push(makeLord(g, { tier: 1, realm: realm.id }));
        }
        for (const realm of D.realms) roster.push(makeLord(g, { tier: 2, realm: realm.id }));
        roster.push(makeLord(g, { tier: 3, realm: 'drowned_spire', level: 30 }));
        return roster;
    }

    // ---------- logging ----------
    function log(g, text, kind) {
        g.log.unshift({ text: text, kind: kind || '' });
        if (g.log.length > 90) g.log.pop();
    }
    function fightLog(g, text, kind) {
        if (!g.fight) return;
        g.fight.log.unshift({ text: text, kind: kind || '' });
        if (g.fight.log.length > 60) g.fight.log.pop();
    }
    function achieve(id) { try { if (window.unlockAchievement) unlockAchievement(id); } catch (e) { } }
    function sound(name) { try { if (window.playSound) playSound(name); } catch (e) { } }

    // ---------- foes ----------
    function foeFromTemplate(tpl, statMultiplier) {
        const m = statMultiplier || 1;
        const hp = Math.round((tpl.total_hp || tpl.hp) * m);
        return {
            id: tpl.id, name: tpl.name, level: tpl.level,
            hp: hp, max_hp: hp,
            damage: Math.round(tpl.damage * m),
            damageType: tpl.damageType,
            armour: Math.round(tpl.armour * m),
            hit: tpl.hit || 0.08, dodge: tpl.dodge || 0.05,
            weak: (tpl.weak || []).slice(), resist: (tpl.resist || []).slice(), immune: [],
            sanity: tpl.sanity || 0,
            xp: Math.round((tpl.xp || 50) * m), coin: Math.round((tpl.coin || 10) * m),
            drops: tpl.drops || {},
            phases: tpl.phases || null, phase: 0,
            intro: tpl.intro || '', text: tpl.text || '',
            codex: tpl.codex || null,
            boss: !!tpl.phases,
            add: !!tpl.add, heals_owner_pct: tpl.heals_owner_pct || 0,
            traits: { immunities: [], enrage_triggers: [], vulnerabilities: [], phobias: [] },
            enraged: false, cower: 0, armourBreak: 0, armourBreakTurns: 0
        };
    }

    function startFight(g, foes, context) {
        const list = Array.isArray(foes) ? foes : [foes];
        g.fight = {
            foes: list, target: 0, round: 1, log: [],
            barrier: 0, playerDots: [], cooldowns: {},
            over: false, result: null, damageByType: {},
            arena: { flooded: false, radiation: false, dodgeMult: 1, enrageStacks: 0, singularity: 0, harpoonsUsed: false, telegraph: null },
            context: context || 'field'
        };
        for (const f of list) {
            if (f.intro) fightLog(g, f.intro, 'lore');
            if (f.phases) enterPhase(g, f, 0);
        }
        g.screen = 'combat';
        bus.emit('COMBAT_STARTED', { foes: list, context: context });
        sound('navigate');
        render(g);
    }

    function enterPhase(g, foe, index) {
        const ph = foe.phases[index];
        if (!ph) return;
        foe.phase = index;
        foe.passiveArmourPct = ph.passive_armor_pct ? ph.passive_armor_pct / 100 : 0;
        if (index > 0) fightLog(g, '— ' + (ph.text || 'It changes.') + ' —', 'phase');
        const mech = ph.mechanics || [];
        if (mech.indexOf('sanity_toll') >= 0 && ph.sanity_hit) {
            const bite = sanityLoss(g.p, ph.sanity_hit);
            g.p.vitals.sanity -= bite;
            fightLog(g, '−' + bite + ' sanity.', 'bad');
        }
        if (ph.on_enter === 'flood' || ph.on_phase_end_event === 'collapse_floor_fill_water') {
            g.fight.arena.flooded = true;
            g.fight.arena.dodgeMult = 0.5;
            g.fight.playerDots = g.fight.playerDots.filter(d => d.type !== 'burn');
            fightLog(g, 'the floor gives and the arena fills. Dodge is halved and every fire on you goes out.', 'phase');
        }
        if (ph.on_enter === 'radiation') {
            g.fight.arena.radiation = true;
            fightLog(g, 'the light comes up through the floor. Healing is going to be worth a lot less from here.', 'phase');
        }
        if (mech.indexOf('void_singularity') >= 0) {
            g.fight.arena.singularity = ph.singularity_turns || 6;
            fightLog(g, 'a hole opens in the middle of the floor. ' + g.fight.arena.singularity + ' turns before it has you.', 'bad');
        }
    }

    function checkPhases(g, foe) {
        if (!foe.phases) return;
        const pct = (foe.hp / foe.max_hp) * 100;
        for (let i = foe.phase + 1; i < foe.phases.length; i++) {
            if (pct <= foe.phases[i].hp_threshold_pct) enterPhase(g, foe, i);
        }
    }

    function foeArmour(foe) {
        let a = foe.armour * (1 + (foe.passiveArmourPct || 0));
        if (foe.armourBreakTurns > 0) a *= (1 - foe.armourBreak);
        if (foe.enraged) {
            const e = byId(D.nemesisTraits.enrages, 'blood_frenzy');
            if (foe.traits.enrage_triggers.indexOf('blood_frenzy') >= 0) a *= Math.max(0, 1 + e.armourPct);
        }
        return Math.max(0, a);
    }

    function applyDamageToFoe(g, foe, amount, type, label, opts) {
        const o = opts || {};
        let mult = elementMultiplier(type, foe);
        // Abyssal Attuned absorbs magic and turns it into health
        if (foe.absorbs && (type === 'abyssal')) {
            const absorbed = Math.round(amount * 0.75);
            foe.hp = Math.min(foe.max_hp, foe.hp + absorbed);
            fightLog(g, label + ' — it drinks it. +' + absorbed + ' to ' + foe.name + '.', 'bad');
            return 0;
        }
        if (foe.traits.vulnerabilities.indexOf('one_eyed') >= 0 && o.flank) mult *= 1.5;
        const dealt = Math.max(0, Math.round(amount * mult));
        foe.hp -= dealt;
        if (dealt > 0) foe._flash = 6;
        g.fight.damageByType[type] = (g.fight.damageByType[type] || 0) + dealt;
        if (mult === 0) fightLog(g, label + ' — immune. Nothing.', 'bad');
        else if (mult >= 1.4) fightLog(g, label + ' for ' + dealt + '. It is weak to that.', 'good');
        else if (mult <= 0.6) fightLog(g, label + ' for ' + dealt + '. It barely notices.', 'warn');
        else fightLog(g, label + ' for ' + dealt + '.');

        // Brittle Shell: crushing strips armour faster
        if (type === 'crush' && foe.traits.vulnerabilities.indexOf('brittle_shell') >= 0) {
            foe.armourBreak = Math.min(0.8, (foe.armourBreak || 0) + 0.25);
            foe.armourBreakTurns = 3;
            fightLog(g, 'the shell cracks further.', 'good');
        }
        // phobias
        if (type === 'burn' && foe.traits.phobias.indexOf('fear_of_ash_fire') >= 0 && foe.cower <= 0) {
            foe.cower = byId(D.nemesisTraits.phobias, 'fear_of_ash_fire').cowerTurns;
            fightLog(g, foe.name + ' has burned before. It will not stand for it again.', 'good');
        }
        // enrage triggers
        if (!foe.enraged && foe.traits.enrage_triggers.indexOf('blood_frenzy') >= 0
            && foe.hp / foe.max_hp <= byId(D.nemesisTraits.enrages, 'blood_frenzy').threshold) {
            foe.enraged = true;
            fightLog(g, foe.name + ' goes into a blood frenzy. It has stopped defending.', 'bad');
        }
        if (!foe.enraged && o.steam && foe.traits.enrage_triggers.indexOf('hate_of_steam') >= 0) {
            foe.enraged = true;
            fightLog(g, 'the steam lands, and ' + foe.name + ' loses whatever it had instead of a temper.', 'bad');
        }
        checkPhases(g, foe);
        return dealt;
    }

    function weaponOf(p) {
        const w = p.equipment.main_hand;
        if (!w) return { base: 12, type: 'physical', piercing: false, name: 'bare hands', steam: false };
        return {
            base: itemStat(w, 'damage') + itemStat(w, 'flatDamage') + itemStat(p.equipment.off_hand, 'damage'),
            type: w.damage_type || 'physical',
            piercing: !!w.piercing,
            name: w.name,
            steam: (w.recipe_id || '').indexOf('steam') >= 0 || itemStat(w, 'mightAbilityPct') > 0
        };
    }
    function statBonusFor(p, type) {
        if (type === 'abyssal') return p.attributes.attunement * per('attunement').spellDamagePct + curseEffect(p, 'abyssalDamagePct');
        if (type === 'burn') return p.attributes.might * per('might').physicalDamagePct
            + (p.faction === 'inquisitors' ? D.factions.inquisitors.bonus.burnDamagePct : 0)
            + gearStat(p, 'burnDamagePct');
        return p.attributes.might * per('might').physicalDamagePct + curseEffect(p, 'physicalDamagePct');
    }

    const STRIKE_STAMINA = 8;

    function livingFoes(g) { return g.fight.foes.filter(f => f.hp > 0); }
    function currentTarget(g) {
        const alive = livingFoes(g);
        if (!alive.length) return null;
        const t = g.fight.foes[g.fight.target];
        return (t && t.hp > 0) ? t : alive[0];
    }

    function canUseSkill(g, nodeId) {
        const p = g.p, node = skillNode(nodeId);
        if (!node || node.type !== 'active') return { ok: false, why: 'not an active skill' };
        if (rankOf(p, nodeId) < 1) return { ok: false, why: 'not learned' };
        if (!tierUnlocked(p, node.tier)) return { ok: false, why: 'tier ' + node.tier + ' unlocks at level ' + D.tierLevel[node.tier] };
        if ((g.fight.cooldowns[nodeId] || 0) > 0) return { ok: false, why: g.fight.cooldowns[nodeId] + ' turns of cooldown left' };
        const c = node.cost || {};
        if ((c.stamina || 0) > p.vitals.stamina) return { ok: false, why: 'needs ' + c.stamina + ' stamina' };
        if ((c.marrow || 0) > p.vitals.marrow_mana) return { ok: false, why: 'needs ' + c.marrow + ' marrow' };
        if ((c.sanity || 0) > p.vitals.sanity) return { ok: false, why: 'needs ' + c.sanity + ' sanity' };
        return { ok: true, node: node };
    }

    function payCost(p, node) {
        const c = node.cost || {};
        p.vitals.stamina -= (c.stamina || 0);
        p.vitals.marrow_mana -= (c.marrow || 0);
        p.vitals.sanity -= (c.sanity || 0);
    }

    function playerStrike(g, opts) {
        const o = opts || {}, p = g.p, rng = g.rng, f = g.fight;
        const foe = o.foe || currentTarget(g);
        if (!foe) return;
        const w = o.weapon || weaponOf(p);
        const type = o.damageType || w.type;

        const swing = resolveSwing(rng, hitRating(p), foe.dodge * f.arena.dodgeMult);
        if (swing.outcome === 'miss') { fightLog(g, (o.label || w.name) + ' goes through water.', 'warn'); return; }

        const r = computeDamage(rng, {
            base: w.base,
            statBonus: statBonusFor(p, type),
            abilityMultiplier: o.abilityMultiplier || 1,
            targetArmour: foeArmour(foe),
            piercing: o.piercing || w.piercing,
            elementMultiplier: 1
        });
        let dmg = r.net;
        let label = o.label || (w.name + ' hits');

        if (swing.outcome === 'glancing') {
            dmg *= GLANCING_MULTIPLIER;
            label = (o.label || w.name) + ' catches it a glancing blow';
        } else if (o.alwaysCrit || chance(rng, critChance(p))) {
            dmg *= critMultiplier(p);
            label = (o.label || w.name) + ' lands clean —';
        }
        if (o.execute && foe.hp / foe.max_hp <= o.execute.belowHpPct) {
            dmg *= o.execute.multiplier;
            label = (o.label || w.name) + ' finds the thing under the ribs —';
        }

        const dealt = applyDamageToFoe(g, foe, dmg, type, label, { steam: w.steam || o.steam, flank: o.flank });

        // marrow leech
        const leech = gearStat(p, 'marrowLeechPct');
        if (leech > 0 && dealt > 0) {
            const gain = Math.max(1, Math.round(dealt * leech));
            p.vitals.marrow_mana = Math.min(p.vitals.max_marrow_mana, p.vitals.marrow_mana + gain);
        }
        // bleed rider from a Serrated prefix or a Crimson Marrow rune
        const bleed = gearStat(p, 'bleedOnHit');
        if (bleed > 0 && dealt > 0 && elementMultiplier('bleed', foe) > 0) {
            addFoeDot(g, foe, { id: 'bleed', name: 'bleeding', type: 'bleed', perTurn: bleed, turns: 3 });
        }
        // a Sun Shard is what a phobia is waiting for
        const blind = gearStat(p, 'sunBlindChance');
        if (blind > 0 && dealt > 0 && chance(rng, blind)) triggerFlarePhobia(g, foe, 'the shard flares');
        return dealt;
    }

    function addFoeDot(g, foe, dot) {
        foe.dots = foe.dots || [];
        const existing = foe.dots.find(d => d.id === dot.id);
        if (existing) { existing.turns = Math.max(existing.turns, dot.turns); existing.perTurn = Math.max(existing.perTurn, dot.perTurn); }
        else foe.dots.push(Object.assign({}, dot));
    }
    function triggerFlarePhobia(g, foe, why) {
        if (foe.traits.phobias.indexOf('fear_of_sun_flares') < 0) return false;
        const t = byId(D.nemesisTraits.phobias, 'fear_of_sun_flares');
        foe.cower = Math.max(foe.cower, t.cowerTurns);
        fightLog(g, why + ' and ' + foe.name + ' will not look at it. ' + t.cowerTurns + ' turns cowering.', 'good');
        return true;
    }

    function playerAction(g, action, arg) {
        const f = g.fight;
        if (!f || f.over) return;
        const p = g.p, rng = g.rng;
        f.guarding = false;

        // at zero sanity the Tide is choosing some of your turns for you
        if (p.vitals.sanity <= 0 && chance(rng, PANIC_SKIP_CHANCE)) {
            fightLog(g, 'you lose the turn to something that is not in the room.', 'bad');
            return foeTurn(g);
        }

        if (action === 'flee') {
            const odds = clamp(0.35 + dodgeRating(p) * 2, 0.15, 0.85);
            if (chance(rng, odds)) {
                f.over = true; f.result = 'fled'; p.stats.fled++;
                for (const foe of f.foes) {
                    if (!foe.nemesis_id) continue;
                    const n = lordById(g.roster, foe.nemesis_id);
                    if (n) { lordSawYouRun(g, n); fightLog(g, '"' + n.dialogue_set.on_flee + '"', 'cry'); }
                }
                fightLog(g, 'you cut the line and go.', 'warn');
                return render(g);
            }
            fightLog(g, 'you turn to run and it is already in front of you.', 'bad');
            return foeTurn(g);
        }

        if (action === 'guard') {
            f.guarding = true;
            p.vitals.stamina = Math.min(p.vitals.max_stamina, p.vitals.stamina + 22);
            fightLog(g, 'you set your feet behind the guard.');
            return foeTurn(g);
        }

        if (action === 'target') { f.target = Number(arg) || 0; return render(g); }

        if (action === 'harpoon') {
            const foe = currentTarget(g);
            if (!foe || f.arena.harpoonsUsed) return;
            f.arena.harpoonsUsed = true;
            foe.armourBreak = 1.0;
            foe.armourBreakTurns = 2;
            fightLog(g, 'you haul the corner lever and the platform harpoons pin it. No armour for two turns.', 'good');
            return foeTurn(g);
        }

        if (action === 'flare') {
            if ((p.materials.flare || 0) <= 0) { fightLog(g, 'no flares left.', 'warn'); return; }
            p.materials.flare--;
            let any = false;
            for (const foe of livingFoes(g)) if (triggerFlarePhobia(g, foe, 'the flare goes up')) any = true;
            if (!any) fightLog(g, 'the flare goes up. Nothing here is afraid of the light.', 'warn');
            return foeTurn(g);
        }

        if (action === 'strike') {
            if (p.vitals.stamina < STRIKE_STAMINA) { fightLog(g, 'nothing left in your arms.', 'warn'); return foeTurn(g); }
            p.vitals.stamina -= STRIKE_STAMINA;
            playerStrike(g);
            return afterPlayer(g);
        }

        if (action === 'skill') {
            const check = canUseSkill(g, arg);
            if (!check.ok) { fightLog(g, check.why + '.', 'warn'); return; }
            const node = check.node;
            payCost(p, node);
            f.cooldowns[node.id] = node.cooldown || 0;
            runSkill(g, node);
            return afterPlayer(g);
        }
    }

    function runSkill(g, node) {
        const p = g.p, rng = g.rng, f = g.fight;
        const value = skillValue(p, node.id);
        const targets = node.target === 'all_enemies' ? livingFoes(g) : [currentTarget(g)].filter(Boolean);

        if (node.scaling) {
            for (const foe of targets) {
                playerStrike(g, {
                    foe: foe,
                    abilityMultiplier: value,
                    piercing: node.scaling.piercing,
                    damageType: node.scaling.damageType || undefined,
                    alwaysCrit: node.scaling.alwaysCrit,
                    execute: node.execute,
                    label: node.name,
                    steam: node.id === 'steam_vent_slam'
                });
                if (node.debuff && foe.hp > 0) {
                    foe.armourBreak = Math.max(foe.armourBreak || 0, node.debuff.armourReductionPct);
                    foe.armourBreakTurns = node.debuff.durationTurns;
                    fightLog(g, node.debuff.name + ' on ' + foe.name + '.', 'good');
                }
                if (node.stun && foe.hp > 0) { foe.cower = Math.max(foe.cower, node.stun); fightLog(g, foe.name + ' is stunned.', 'good'); }
                if (node.dot && foe.hp > 0) {
                    const perTurn = node.dot.statPct
                        ? Math.round(p.attributes[node.dot.stat] * node.dot.statPct * 4)
                        : value;
                    addFoeDot(g, foe, { id: node.dot.id, name: node.dot.name, type: node.dot.type, perTurn: perTurn, turns: node.dot.durationTurns });
                    fightLog(g, node.dot.name + ': ' + perTurn + ' a turn for ' + node.dot.durationTurns + '.', 'good');
                }
            }
            return;
        }

        if (node.dot) {                                  // Burn Oil and friends
            for (const foe of targets) {
                addFoeDot(g, foe, { id: node.dot.id, name: node.dot.name, type: node.dot.type, perTurn: value, turns: node.dot.durationTurns });
                fightLog(g, node.dot.name + ' across ' + foe.name + ': ' + value + ' a turn for ' + node.dot.durationTurns + '.', 'good');
            }
            return;
        }
        if (node.stunChance) {
            for (const foe of targets) {
                if (chance(rng, value)) { foe.cower = Math.max(foe.cower, 1); fightLog(g, 'the line goes taut and ' + foe.name + ' comes off its feet.', 'good'); }
                else fightLog(g, 'the barb skips off ' + foe.name + '.', 'warn');
            }
            return;
        }
        if (node.barrier) {
            const shield = Math.round(armourOf(p) * value);
            f.barrier = shield;
            f.barrierDetonates = !!node.barrier.detonates;
            fightLog(g, 'a marrow barrier worth ' + shield + ' closes over you.', 'good');
            return;
        }
        if (node.heal) {
            const healed = Math.round(p.vitals.max_hp * value * (f.arena.radiation ? 0.4 : 1));
            p.vitals.hp = Math.min(p.vitals.max_hp, p.vitals.hp + healed);
            if (node.regen) f.playerDots.push({ id: node.id, name: node.name, type: 'regen', perTurn: -node.regen.marrowPerTurn, turns: node.regen.turns, marrow: true });
            fightLog(g, node.name + ': +' + healed + ' health.', 'good');
            return;
        }
        fightLog(g, node.name + '.', 'good');
    }

    function afterPlayer(g) {
        if (!livingFoes(g).length) return winFight(g);
        return foeTurn(g);
    }

    function damagePlayer(g, amount, type, source) {
        const p = g.p, f = g.fight;
        let dmg = Math.max(0, amount);
        if (f.guarding) {
            const blocked = blockValue(p) * (1 + passive(p, 'blockPct'));
            dmg = Math.max(dmg * 0.25, dmg - blocked);
        }
        if (f.barrier > 0) {
            const absorbed = Math.min(f.barrier, dmg);
            f.barrier -= absorbed;
            dmg -= absorbed;
            if (f.barrier <= 0 && f.barrierDetonates) {
                f.barrierDetonates = false;
                for (const foe of livingFoes(g)) applyDamageToFoe(g, foe, absorbed, 'physical', 'the barrier goes and takes the room with it');
                fightLog(g, 'the barrier breaks and detonates.', 'good');
            }
        }
        dmg = Math.round(dmg);
        if (dmg > 0) {
            p.vitals.hp -= dmg;
            f.playerFlash = 6;
            f.lastDamageType = type;
            f.lastAttacker = source;
            fightLog(g, (source ? source + ' hits you' : 'you take') + ' for ' + dmg + '.', 'bad');
        } else {
            fightLog(g, 'the blow does not get through.', 'good');
        }
        return dmg;
    }

    function foeTurn(g) {
        const f = g.fight, p = g.p, rng = g.rng;

        for (const foe of livingFoes(g)) {
            if (foe.cower > 0) { foe.cower--; fightLog(g, foe.name + ' loses the turn.', 'good'); continue; }

            const phase = foe.phases ? foe.phases[foe.phase] : null;
            const mech = (phase && phase.mechanics) || [];

            // a telegraphed sweep is marked one turn ahead and lands the next
            if (f.arena.telegraph && f.arena.telegraph.foe === foe.id) {
                const dmg = f.arena.telegraph.damage;
                f.arena.telegraph = null;
                fightLog(g, 'the sweep comes down the marked line.', 'bad');
                damagePlayer(g, dmg * (1 - armourMitigation(armourOf(p))), 'crush', foe.name);
                continue;
            }
            if (mech.indexOf('telegraphed_tail_sweep') >= 0 && !f.arena.telegraph && chance(rng, 0.35)) {
                f.arena.telegraph = { foe: foe.id, damage: phase.tail_sweep_damage || Math.round(foe.damage * 1.8) };
                fightLog(g, foe.name + ' marks a line across the deck in red. Next turn, that line.', 'warn');
                continue;
            }

            let dmgMult = 1;
            if (foe.enraged) dmgMult += byId(D.nemesisTraits.enrages, 'blood_frenzy').damagePct;
            if (mech.indexOf('hard_enrage') >= 0) {
                f.arena.enrageStacks += (phase.damage_scaling_per_turn_pct || 0.15);
                dmgMult += f.arena.enrageStacks;
            }

            const swing = resolveSwing(rng, foe.hit, dodgeRating(p) * f.arena.dodgeMult);
            if (swing.outcome === 'miss') {
                fightLog(g, foe.name + ' comes at you and misses.', 'good');
            } else {
                const r = computeDamage(rng, {
                    base: foe.damage * dmgMult,
                    statBonus: foe.level * 0.01,
                    targetArmour: armourOf(p),
                    elementMultiplier: 1
                });
                let dmg = r.net;
                if (swing.outcome === 'glancing') { dmg *= GLANCING_MULTIPLIER; fightLog(g, foe.name + ' catches you a glancing blow.', 'warn'); }
                damagePlayer(g, dmg, foe.damageType, foe.name);
                if (foe.damageType === 'bleed') f.playerDots.push({ id: 'foe_bleed', name: 'a deep cut', type: 'bleed', perTurn: Math.max(4, Math.round(dmg * 0.22)), turns: 3 });
            }

            if (mech.indexOf('abyssal_bile_aoe') >= 0 && !f.playerDots.some(d => d.id === 'abyssal_bile')) {
                f.playerDots.push({ id: 'abyssal_bile', name: 'abyssal bile', type: 'rot', perTurn: phase.bile_damage_per_turn || 30, turns: phase.bile_turns || 3 });
                fightLog(g, 'it sprays the whole floor with something that is still eating the plate.', 'bad');
            }
            if (mech.indexOf('spawn_leeches') >= 0 && phase.adds_spawn_rate_turns && f.round % phase.adds_spawn_rate_turns === 0) {
                const tpl = foeById(phase.add_id);
                if (tpl && livingFoes(g).length < 4) {
                    const add = foeFromTemplate(tpl, 1);
                    add.owner = foe.id;
                    f.foes.push(add);
                    fightLog(g, 'it sheds a ' + add.name + '.', 'bad');
                }
            }
            if (mech.indexOf('sanity_toll') >= 0 || (phase && phase.sanity_drain_per_action)) {
                const bite = sanityLoss(p, phase.sanity_drain_per_action || 4);
                if (bite > 0) { p.vitals.sanity -= bite; fightLog(g, '−' + bite + ' sanity.', 'bad'); }
            }
            if (foe.heals_owner_pct && foe.owner) {
                const owner = f.foes.find(x => x.id === foe.owner && x.hp > 0);
                if (owner) {
                    const healed = Math.round(owner.max_hp * foe.heals_owner_pct);
                    owner.hp = Math.min(owner.max_hp, owner.hp + healed);
                    fightLog(g, foe.name + ' puts ' + healed + ' back into ' + owner.name + '.', 'bad');
                }
            }
            if (foe.sanity) {
                const bite = sanityLoss(p, foe.sanity);
                if (bite > 0) { p.vitals.sanity -= bite; fightLog(g, '−' + bite + ' sanity.', 'bad'); }
            }
        }
        return endRound(g);
    }

    function endRound(g) {
        const f = g.fight, p = g.p;

        for (const foe of livingFoes(g)) {
            for (const d of (foe.dots || []).slice()) {
                if (d.turns <= 0) continue;
                d.turns--;
                applyDamageToFoe(g, foe, d.perTurn, d.type, foe.name + ' is still taking ' + d.name + ' —');
            }
            if (foe.dots) foe.dots = foe.dots.filter(d => d.turns > 0);
            if (foe.armourBreakTurns > 0) { foe.armourBreakTurns--; if (foe.armourBreakTurns === 0) foe.armourBreak = 0; }
        }
        for (const d of f.playerDots.slice()) {
            d.turns--;
            if (d.marrow) {
                p.vitals.marrow_mana = Math.min(p.vitals.max_marrow_mana, p.vitals.marrow_mana - d.perTurn);
            } else {
                p.vitals.hp -= d.perTurn;
                fightLog(g, d.name + ': −' + d.perTurn + '.', 'bad');
            }
        }
        f.playerDots = f.playerDots.filter(d => d.turns > 0);

        // cursed gear takes its cut every turn regardless of what happened
        const curseSanity = curseEffect(p, 'sanityPerTurn');
        if (curseSanity) { p.vitals.sanity -= curseSanity; fightLog(g, 'the seals leak. −' + curseSanity + ' sanity.', 'bad'); }

        if (f.arena.singularity > 0) {
            f.arena.singularity--;
            if (f.arena.singularity <= 0) {
                fightLog(g, 'the hole in the floor finishes taking the room, and you with it.', 'bad');
                p.vitals.hp = 0;
            } else {
                fightLog(g, f.arena.singularity + ' turns before the singularity has you.', 'warn');
            }
        }

        for (const id in f.cooldowns) if (f.cooldowns[id] > 0) f.cooldowns[id]--;
        p.vitals.stamina = Math.min(p.vitals.max_stamina, p.vitals.stamina + 14 + Math.round(p.attributes.fortitude * 0.4));
        p.vitals.marrow_mana = Math.min(p.vitals.max_marrow_mana, p.vitals.marrow_mana + Math.round(p.attributes.attunement * 0.5));
        f.round++;

        if (!livingFoes(g).length) return winFight(g);
        if (p.vitals.hp <= 0) return loseFight(g);
        if (p.vitals.sanity <= 0 && !f.panicAnnounced) {
            f.panicAnnounced = true;
            fightLog(g, 'your sanity is gone. From here you will lose turns, and some of them will land on the wrong thing.', 'bad');
        }
        render(g);
    }

    function topDamageType(f) {
        let best = 'physical', bestV = -1;
        for (const k in f.damageByType) if (f.damageByType[k] > bestV) { bestV = f.damageByType[k]; best = k; }
        return best;
    }

    function winFight(g) {
        const f = g.fight, p = g.p;
        f.over = true; f.result = 'won';

        // the Choir takes you with it if you finish it too far gone
        for (const foe of f.foes) {
            const phase = foe.phases ? foe.phases[foe.phase] : null;
            if (phase && (phase.mechanics || []).indexOf('deadmans_chorus') >= 0 && p.vitals.sanity < phase.deadmans_below_sanity) {
                fightLog(g, 'it dies mid-note, and takes the note with it, and you were singing.', 'bad');
                p.vitals.sanity = 0;
                p.vitals.hp = 0;
                return loseFight(g);
            }
        }

        const lootMult = 1 + passive(p, 'lootPct') + p.attributes.perception * 0.004;
        let xp = 0, coin = 0;
        for (const foe of f.foes) {
            xp += foe.xp || 0;
            coin += Math.round((foe.coin || 0) * lootMult);
            for (const m in (foe.drops || {})) {
                const range = foe.drops[m];
                const n = ri(g.rng, range[0], range[1]);
                if (n > 0) { p.materials[m] = (p.materials[m] || 0) + n; fightLog(g, 'salvaged ' + n + ' × ' + ((materialById(m) || {}).name || m) + '.'); }
            }
            if (foe.codex) unlockCodex(g, foe.codex);
            if (foe.boss) {
                p.world_state.story_flags['boss_' + foe.id] = true;
                // Act II turns on this: the Choir is holding the beacon core
                if (foe.id === 'boss_reef_choir') {
                    p.quest_items.item_marrow_core_t3 = (p.quest_items.item_marrow_core_t3 || 0) + 1;
                    fightLog(g, 'in the middle of the coral throat, still lit: the Marrow Core.', 'good');
                    unlockCodex(g, 'cdx_the_heart');
                }
            }
            if (foe.nemesis_id) {
                const n = lordById(g.roster, foe.nemesis_id);
                if (n) lordDefeated(g, n, topDamageType(f));
            }
        }
        p.stats.kills += f.foes.length;
        p.coin += coin;
        gainXp(g, xp);
        fightLog(g, 'clear. +' + xp + ' xp, +' + coin + ' coin.', 'good');
        if (f.foes.some(x => x.boss)) achieve('echoes-boss');
        bus.emit('COMBAT_WON', { xp: xp, coin: coin });
        render(g);
    }

    function loseFight(g) {
        const f = g.fight, p = g.p;
        f.over = true; f.result = 'lost';
        p.stats.deaths++;
        const deathType = p.vitals.sanity <= 0 ? 'sanity' : (f.lastDamageType || 'physical');

        const killer = f.foes.find(x => x.hp > 0) || f.foes[0];
        if (killer) promoteOnKill(g, killer, deathType === 'sanity' ? 'physical' : deathType);
        if (killer && killer.nemesis_id) {
            const n = lordById(g.roster, killer.nemesis_id);
            if (n) fightLog(g, '"' + n.dialogue_set.on_kill_player + '"', 'cry');
        }

        const lost = Math.round(p.coin * 0.25);
        p.coin -= lost;
        p.vitals.hp = Math.max(1, Math.round(p.vitals.max_hp * 0.4));
        p.vitals.stamina = p.vitals.max_stamina;
        p.vitals.sanity = Math.max(10, p.vitals.sanity);
        g.dungeon = null;
        fightLog(g, 'you wake on the nearest Rest Rig, ' + lost + ' coin lighter.', 'bad');
        log(g, 'you died in ' + realmById(p.realm).name + '. It cost you ' + lost + ' coin, and the killer got a promotion out of it.', 'bad');
        advanceDay(g, 1);
        render(g);
    }

    function endFight(g) {
        const f = g.fight;
        if (!f) return;
        if (f.result !== 'lost') {
            for (const foe of f.foes) {
                if (!foe.nemesis_id || foe.hp <= 0) continue;
                const n = lordById(g.roster, foe.nemesis_id);
                if (n) {
                    const gained = lordSurvived(g, n, f.damageByType);
                    if (gained) log(g, lordDisplayName(n) + ' walked away with ' + gained.name + '.', 'warn');
                }
            }
        }
        const lost = f.result === 'lost';
        g.fight = null;
        g.screen = (!lost && g.dungeon) ? 'dungeon' : 'world';
        save(g);
        render(g);
    }

    // ---------- levelling ----------
    function gainXp(g, amount) {
        const p = g.p;
        if (p.level >= MAX_LEVEL) return;
        p.experience.current += Math.max(0, Math.round(amount));
        while (p.level < MAX_LEVEL && p.experience.current >= xpToNext(p.level)) {
            p.experience.current -= xpToNext(p.level);
            p.level++;
            p.attributes.unallocated_points += ATTR_PER_LEVEL;
            p.skill_points += SKILL_PER_LEVEL;
            clampVitals(p);
            p.vitals.hp = p.vitals.max_hp;
            p.vitals.stamina = p.vitals.max_stamina;
            p.vitals.marrow_mana = p.vitals.max_marrow_mana;
            log(g, 'level ' + p.level + '. ' + ATTR_PER_LEVEL + ' attribute points, 1 skill point.', 'good');
            if (LEVEL_UNLOCKS[p.level]) log(g, 'unlocked: ' + LEVEL_UNLOCKS[p.level] + '.', 'good');
            bus.emit('LEVEL_UP', p.level);
            if (p.level >= 10) achieve('echoes-ten');
        }
        p.experience.next_level = xpToNext(p.level);
    }

    function gainLifeSkill(g, skill, amount) {
        const s = g.p.life_skills[skill];
        if (!s) return;
        s.xp += Math.round(amount);
        while (s.xp >= s.level * 120) { s.xp -= s.level * 120; s.level++; log(g, skill + ' is now level ' + s.level + '.', 'good'); }
    }

    // ---------- the clock ----------
    function advanceDay(g, days) {
        const w = g.p.world_state;
        for (let i = 0; i < (days || 1); i++) {
            w.current_day++;
            w.time_of_day = w.time_of_day === 'calm_day' ? 'black_tide' : 'calm_day';
        }
        bus.emit('DAY_PASSED', w.current_day);
    }
    const isBlackTide = p => p.world_state.time_of_day === 'black_tide';

    // ---------- environmental hazards ----------
    function applyHazard(g, turns) {
        const p = g.p, realm = realmById(p.realm);
        if (!realm || !realm.hazard) return;
        const h = realm.hazard;
        const countered = SLOTS.some(s => p.equipment[s] && p.equipment[s].counters === h.id)
            || (h.counter === 'purified_oil' && (p.materials.purified_oil || 0) > 0);
        if (countered) {
            if (h.counter === 'purified_oil' && chance(g.rng, 0.5)) p.materials.purified_oil--;
            return;
        }
        const resist = 1 - hazardResist(p);
        const n = turns || 1;
        if (h.hpPctPerTurn) {
            const bite = Math.round(p.vitals.max_hp * h.hpPctPerTurn * n * resist);
            if (bite > 0) { p.vitals.hp -= bite; log(g, h.name + ': −' + bite + ' health. You need ' + h.counterName + '.', 'bad'); }
        }
        if (h.sanityPerInterval) {
            const bite = sanityLoss(p, h.sanityPerInterval * Math.max(1, Math.floor(n / (h.intervalTurns || 3))));
            if (bite > 0) { p.vitals.sanity -= bite; log(g, h.name + ': −' + bite + ' sanity.', 'bad'); }
        }
        if (h.burnPerTurn) {
            const bite = Math.round(h.burnPerTurn * n * resist);
            p.vitals.hp -= bite;
            log(g, h.name + ': −' + bite + ' health from the light.', 'bad');
        }
        if (h.armourDecayPerTurn) {
            for (const slot of SLOTS) {
                const it = p.equipment[slot];
                if (!it || !it.durability) continue;
                it.durability.current = Math.max(0, it.durability.current - Math.ceil(n * 1));
            }
        }
        if (p.vitals.hp <= 0) { p.vitals.hp = 1; log(g, 'you surface with blood in both ears.', 'bad'); g.dungeon = null; g.screen = 'world'; }
    }

    // ---------- the dungeon graph (GDD Module 5) ----------
    const NODE_WEIGHTS = { combat: 40, elite: 15, salvage: 15, mystery: 15, rest: 10 };

    function generateDungeon(g, realmId) {
        const rng = g.rng, realm = realmById(realmId);
        const floors = 3 + realm.layer;
        const nodes = [];
        let prevFloor = [];
        let seq = 0;
        for (let floor = 1; floor <= floors; floor++) {
            const isLast = floor === floors;
            const width = (isLast || floor === 1) ? 1 : ri(rng, 2, 3);
            const thisFloor = [];
            for (let i = 0; i < width; i++) {
                const id = 'node_' + (++seq).toString().padStart(2, '0');
                const type = isLast ? 'boss' : weighted(rng, Object.keys(NODE_WEIGHTS), t => {
                    let w = NODE_WEIGHTS[t];
                    if (t === 'elite') w += floor * 4;
                    if (t === 'rest') w -= floor * 2;
                    if (t === 'combat' && isBlackTide(g.p)) w += 12;
                    return w;
                });
                const node = {
                    node_id: id, type: type, floor: floor, connections: [],
                    cleared: false, text: pick(rng, D.nodeText[type] || D.nodeText.combat),
                    stat_multiplier: Math.round((1 + realm.layer * DEPTH_SCALE + seq * ROOM_SCALE) * 100) / 100
                };
                if (type === 'mystery') node.event_id = pick(rng, D.mysteryEvents).id;
                if (type === 'salvage') node.loot_tier = realm.layer;
                if (type === 'boss') node.boss_id = (D.bosses.find(b => b.realm === realmId && !b.add) || D.bosses[0]).id;
                nodes.push(node);
                thisFloor.push(node);
            }
            // every node on the previous floor connects forward to at least one
            for (const prev of prevFloor) {
                const links = ri(rng, 1, Math.min(2, thisFloor.length));
                const shuffled = thisFloor.slice().sort(() => rng() - 0.5);
                for (let i = 0; i < links; i++) prev.connections.push(shuffled[i].node_id);
            }
            // and every node on this floor is reachable from something
            for (const here of thisFloor) {
                if (!prevFloor.length) continue;
                if (!prevFloor.some(pv => pv.connections.indexOf(here.node_id) >= 0)) {
                    pick(rng, prevFloor).connections.push(here.node_id);
                }
            }
            prevFloor = thisFloor;
        }
        return {
            dungeon_id: 'dng_' + realmId + '_' + (g.dungeonSeq++),
            realm: realmId,
            depth_level: realm.layer,
            environmental_hazard: realm.hazard,
            floors: floors,
            current_floor: 1,
            current_node: nodes[0].node_id,
            entered: [nodes[0].node_id],
            nodes: nodes
        };
    }
    const dungeonNode = (d, id) => d.nodes.find(n => n.node_id === id);
    function availableNodes(d) {
        const here = dungeonNode(d, d.current_node);
        if (!here || !here.cleared) return [];
        return here.connections.map(id => dungeonNode(d, id)).filter(Boolean);
    }

    function pickFoeTemplate(g, realmId, floor) {
        const pool = D.bestiary.filter(b => b.realm === realmId);
        if (!pool.length) return D.bestiary[0];
        // a realm's roster spans six levels; draw near the player's own so a
        // level-2 diver does not meet the top of the table on floor one
        const target = g.p.level + floor * 0.6;
        return weighted(g.rng, pool, b => {
            const d = b.level - target;
            return d > 0 ? Math.pow(0.45, d) : Math.pow(0.78, -d);
        });
    }

    function startVoyage(g) {
        const p = g.p;
        g.dungeon = generateDungeon(g, p.realm);
        advanceDay(g, 1);
        log(g, 'you take a boat out into ' + realmById(p.realm).name + '. ' + (isBlackTide(p) ? 'Black tide.' : 'Calm water, for now.'));
        const ambusher = rollAmbush(g, p.realm);
        if (ambusher) {
            log(g, ambusher.dialogue_set.intro_encounter, 'bad');
            const guards = RANK_BY_TIER(ambusher.tier).guards;
            const party = [lordToFoe(ambusher)];
            const n = ri(g.rng, guards[0], guards[1]);
            for (let i = 0; i < Math.min(2, n); i++) party.push(foeFromTemplate(pickFoeTemplate(g, p.realm, 1), 1));
            return startFight(g, party, 'ambush');
        }
        g.screen = 'dungeon';
        render(g);
    }

    function enterNode(g, nodeId) {
        const d = g.dungeon, p = g.p;
        if (!d) return;
        const node = dungeonNode(d, nodeId);
        if (!node || node.cleared) return;
        const here = dungeonNode(d, d.current_node);
        if (here && here.cleared && here.connections.indexOf(nodeId) < 0) return;
        d.current_node = nodeId;
        d.current_floor = node.floor;
        if (d.entered.indexOf(nodeId) < 0) d.entered.push(nodeId);
        node.cleared = true;
        applyHazard(g, 1);
        if (!g.dungeon) return render(g);

        const realm = realmById(d.realm);
        const m = node.stat_multiplier;

        if (node.type === 'combat') {
            const party = [foeFromTemplate(pickFoeTemplate(g, d.realm, node.floor), m)];
            if (chance(g.rng, 0.35)) party.push(foeFromTemplate(pickFoeTemplate(g, d.realm, node.floor), m * 0.9));
            return startFight(g, party, 'dungeon');
        }
        if (node.type === 'elite') {
            const lords = lordsIn(g, d.realm);
            if (lords.length) {
                const n = lords.sort((a, b) => b.grudge - a.grudge)[0];
                n.current_zone = d.realm;
                return startFight(g, [lordToFoe(n)], 'dungeon');
            }
            return startFight(g, [foeFromTemplate(pickFoeTemplate(g, d.realm, node.floor + 3), m * 1.25)], 'dungeon');
        }
        if (node.type === 'boss') {
            const boss = foeById(node.boss_id);
            return startFight(g, [foeFromTemplate(boss, 1)], 'boss');
        }
        if (node.type === 'salvage') {
            const mats = D.materials.filter(x => x.tier <= realm.layer + 1 && !x.reagent);
            const mat = pick(g.rng, mats);
            const n = ri(g.rng, 2, 4 + realm.layer);
            p.materials[mat.id] = (p.materials[mat.id] || 0) + n;
            const coin = ri(g.rng, 30, 70) * realm.layer;
            p.coin += coin;
            log(g, node.text + ' ' + n + ' × ' + mat.name + ', ' + coin + ' coin.', 'good');
            if (chance(g.rng, 0.25 + realm.layer * 0.05)) {
                const rune = pick(g.rng, D.runes);
                p.runes.push(rune.id);
                log(g, 'and a rune, cold in the hand: ' + rune.name + '.', 'good');
            }
            if (chance(g.rng, 0.30)) {
                const recipe = pick(g.rng, D.recipes.filter(r => r.tier <= realm.layer + 1));
                const item = makeItem(g, recipe, { rarityBias: realm.layer * 0.35 });
                p.inventory.push(item);
                log(g, 'and something worth carrying: ' + item.name + ' (' + item.rarity_name + ').', 'good');
            }
            sound('ding');
        } else if (node.type === 'rest') {
            const healed = Math.round(p.vitals.max_hp * 0.35);
            p.vitals.hp = Math.min(p.vitals.max_hp, p.vitals.hp + healed);
            p.vitals.stamina = p.vitals.max_stamina;
            p.vitals.marrow_mana = p.vitals.max_marrow_mana;
            p.vitals.sanity = Math.min(p.vitals.max_sanity, p.vitals.sanity + 12);
            for (const slot of SLOTS) {
                const it = p.equipment[slot];
                if (it && it.durability) it.durability.current = Math.min(it.durability.max, it.durability.current + 15);
            }
            log(g, node.text + ' +' + healed + ' health, +12 sanity, and the gear gets a look at.', 'good');
        } else if (node.type === 'mystery') {
            g.pendingEvent = byId(D.mysteryEvents, node.event_id);
            g.screen = 'event';
            return render(g);
        }
        save(g);
        render(g);
    }

    function resolveEvent(g, optionIndex) {
        const ev = g.pendingEvent, p = g.p;
        if (!ev) return;
        const opt = ev.options[optionIndex];
        g.pendingEvent = null;
        if (opt) {
            const c = opt.cost || {}, gain = opt.gain || {}, risk = opt.risk || {};
            if (c.hpPct) { const bite = Math.round(p.vitals.max_hp * c.hpPct); p.vitals.hp -= bite; log(g, '−' + bite + ' health.', 'bad'); }
            if (c.coin) { if (p.coin < c.coin) { log(g, 'you cannot afford that.', 'warn'); } else { p.coin -= c.coin; } }
            if (c.sanity) { p.vitals.sanity += c.sanity; }
            if (c.reputation) for (const k in c.reputation) p.faction_reputation[k] = clamp(p.faction_reputation[k] + c.reputation[k], -100, 100);
            if (c.time) advanceDay(g, c.time);
            if (gain.sanity) { p.vitals.sanity = Math.min(p.vitals.max_sanity, p.vitals.sanity + gain.sanity); }
            if (gain.coin) p.coin += gain.coin;
            if (gain.xpMult) gainXp(g, Math.round(xpToNext(p.level) * gain.xpMult));
            if (gain.rune) { const r = pick(g.rng, D.runes); p.runes.push(r.id); log(g, 'you are given ' + r.name + '.', 'good'); }
            if (gain.material) { const m = pick(g.rng, D.materials.filter(x => !x.reagent && x.tier <= realmById(p.realm).layer + 1)); p.materials[m.id] = (p.materials[m.id] || 0) + ri(g.rng, 3, 7); log(g, 'materials change hands.', 'good'); }
            if (gain.codex) { const unread = D.codex.filter(c2 => p.codex.indexOf(c2.id) < 0); if (unread.length) unlockCodex(g, pick(g.rng, unread).id); }
            if (gain.reputation) for (const k in gain.reputation) p.faction_reputation[k] = clamp(p.faction_reputation[k] + gain.reputation[k], -100, 100);
            if (risk.sanity) p.vitals.sanity += risk.sanity;
            if (risk.nemesisAlert) triggerNemesisAlert(g, null, risk.nemesisAlert);
            log(g, opt.text, 'lore');
        }
        clampVitals(p);
        g.screen = g.dungeon ? 'dungeon' : 'world';
        save(g);
        render(g);
    }

    function leaveDungeon(g) {
        g.dungeon = null;
        g.screen = 'world';
        advanceDay(g, 1);
        log(g, 'you put in at the harbour with what you have got.');
        save(g);
        render(g);
    }

    function triggerNemesisAlert(g, faction, threatLevel) {
        const rng = g.rng;
        for (let i = 0; i < (threatLevel || 1); i++) {
            const n = makeLord(g, {
                tier: threatLevel >= 2 ? 2 : 1,
                realm: g.p.realm,
                level: Math.max(3, g.p.level + threatLevel),
                faction: faction ? faction + '_hunter' : undefined
            });
            n.grudge = Math.min(5, 2 + threatLevel);
            n.status = 'hunting';
            g.roster.push(n);
            log(g, lordDisplayName(n) + ' has been sent after you' + (faction ? ' by the ' + D.factions[faction].short : '') + '.', 'bad');
        }
        bus.emit('NEMESIS_ALERT', { faction: faction, threat: threatLevel });
    }

    // ---------- the deep forge (GDD Module 4.1) ----------
    // Quality is heat accuracy out of 60 plus three hammer strikes out of 40,
    // which lands on the document's 0–100 scale and its four bands.
    const HEAT_WEIGHT = 60, STRIKE_WEIGHT = 40;

    function startForge(g, recipeId) {
        const p = g.p, recipe = recipeById(recipeId);
        if (!recipe || !canCraft(p, recipe)) { log(g, 'you cannot make that yet.', 'warn'); return render(g); }
        const material = D.materials.find(m => m.tier === recipe.tier && !m.reagent) || D.materials[0];
        const window = material.heat;
        const optimal = (window[0] + window[1]) / 2;
        const tolerance = (window[1] - window[0]) / 2 + passive(p, 'forgeTolerance');
        g.forge = {
            recipe_id: recipe.id, material_id: material.id,
            phase: 'heat',
            temp: 0,
            rate: (window[1] * 1.35) / (7.5 * 60),      // reaches burn-out in about seven seconds
            optimal: optimal, tolerance: tolerance, window: window,
            heatScore: 0, strikeScore: 0, strike: 0,
            marker: 0, dir: 1, sweet: [0.4, 0.56],
            done: false
        };
        rollSweetSpot(g);
        g.screen = 'forge';
        render(g);
    }
    function rollSweetSpot(g) {
        const f = g.forge;
        const w = 0.18 - f.strike * 0.025 + Math.min(0.06, passive(g.p, 'forgeTolerance') / 600);
        const lo = 0.08 + g.rng() * (0.9 - w);
        f.sweet = [lo, lo + w];
    }
    function forgeStep(g) {
        const f = g.forge;
        if (!f || f.done) return;
        if (f.phase === 'heat') {
            f.temp += f.rate;
            if (f.temp > f.window[1] * 1.35) { f.heatScore = 0; f.phase = 'strike'; }
        } else if (f.phase === 'strike') {
            f.marker += f.dir * 0.016;
            if (f.marker >= 1) { f.marker = 1; f.dir = -1; }
            if (f.marker <= 0) { f.marker = 0; f.dir = 1; }
        }
    }
    function forgeInput(g) {
        const f = g.forge;
        if (!f || f.done) return;
        if (f.phase === 'heat') {
            const off = Math.abs(f.temp - f.optimal);
            f.heatScore = Math.round(HEAT_WEIGHT * Math.max(0, 1 - off / (f.tolerance * 2.2)));
            f.pulledAt = Math.round(f.temp);
            f.phase = 'strike';
            sound('click');
            return;
        }
        const centre = (f.sweet[0] + f.sweet[1]) / 2;
        const half = (f.sweet[1] - f.sweet[0]) / 2;
        const off = Math.abs(f.marker - centre);
        f.strikeScore += (STRIKE_WEIGHT / 3) * Math.max(0, 1 - off / (half * 2.4));
        f.strike++;
        sound(off <= half ? 'click' : 'error');
        if (f.strike >= 3) return forgeFinish(g);
        rollSweetSpot(g);
    }
    function forgeFinish(g) {
        const f = g.forge, p = g.p;
        f.done = true;
        const recipe = recipeById(f.recipe_id);
        let quality = clamp(Math.round(f.heatScore + f.strikeScore), 0, 100);
        quality += passive(p, 'qualityBonus');
        if (p.faction === 'syndicate') quality += D.factions.syndicate.bonus.forgeQuality;
        quality = clamp(quality, 0, 100);

        payFor(p, recipe);
        const item = makeItem(g, recipe, { qualityScore: quality, materialId: f.material_id, forged: true, rarityBias: quality / 100 });
        p.inventory.push(item);
        gainLifeSkill(g, 'smithing', 40 + recipe.tier * 25 + quality);
        advanceDay(g, 0);
        const band = bandFor(quality);
        log(g, 'off the anvil: ' + item.name + ' — ' + band.name + ' (' + quality + '/100). ' + band.text,
            band.id === 'abyssal_forged' ? 'good' : band.id === 'defective' ? 'warn' : '');
        if (band.id === 'abyssal_forged') achieve('echoes-masterwork');
        bus.emit('ITEM_CRAFTED', item);
        g.forge = null;
        g.lastForged = item;
        g.screen = 'forge_done';
        save(g);
        render(g);
    }

    // ---------- angling (GDD Module 4.2) ----------
    function rodStrengthOf(p) { return 10 + gearStat(p, 'rodStrength') + Math.round(p.attributes.might * 0.6); }
    function reelSpeedOf(p) { return 12 + Math.round(p.attributes.might * 0.5 + p.attributes.finesse * 0.3); }

    function startAngling(g, spotId) {
        const p = g.p, rng = g.rng;
        const spot = byId(D.fishingSpots, spotId);
        if (!spot) return;
        const c = spot.conditions;
        if (c.sanity_drain_per_cast) {
            const bite = sanityLoss(p, c.sanity_drain_per_cast);
            p.vitals.sanity -= bite;
            if (bite) log(g, 'the cast costs you ' + bite + ' sanity.', 'warn');
        }
        if (c.monster_encounter_chance_pct && chance(rng, c.monster_encounter_chance_pct / 100)) {
            log(g, 'something comes up the line that was not on the end of it.', 'bad');
            const tpl = pickFoeTemplate(g, spot.realm, 2);
            return startFight(g, [foeFromTemplate(tpl, 1.1)], 'angling');
        }
        const entry = weighted(rng, spot.loot_pool, e => e.weight * (1 + passive(p, 'dredgeLuck') * 0.12 * (catchById(e.catch_id).tier || 1)));
        const fish = catchById(entry.catch_id);
        g.angling = {
            spot_id: spot.id, catch_id: fish.id,
            stamina: fish.stamina, max_stamina: fish.stamina,
            tension: 0, holding: false,
            pull: fish.pull, rod: rodStrengthOf(p), reel: reelSpeedOf(p),
            burst: 0, nextBurst: 90 + Math.floor(rng() * 150), ticks: 0,
            over: false, result: null
        };
        g.screen = 'angling';
        log(g, 'something takes the hook at ' + spot.depth_meters + ' metres.');
        render(g);
    }

    // one integration step at 60 Hz: tension climbs while you reel against
    // the fish and falls when you give it slack; the green band is the only
    // place its stamina goes down
    function anglingStep(g) {
        const s = g.angling;
        if (!s || s.over) return;
        const dt = 1 / 60;
        s.ticks++;
        if (s.ticks >= s.nextBurst) {
            s.burst = 45;
            s.nextBurst = s.ticks + 150 + Math.floor(g.rng() * 210);
            // the surge arrives as a jerk, not a ramp — this is the whole
            // reason a heavier rod is worth carrying
            if (s.holding) s.tension += s.pull * 1.7 * 20 / (s.rod + 20);
        }
        const bursting = s.burst > 0;
        if (bursting) s.burst--;

        const force = s.pull * (bursting ? 1.7 : 1);
        const rise = force * 60 / (s.rod + 20) + s.reel * 0.22;
        s.tension += (s.holding ? rise : -42) * dt;
        s.tension = clamp(s.tension, 0, TENSION_MAX + 1);

        const inGreen = s.tension >= TENSION_GREEN[0] && s.tension <= TENSION_GREEN[1];
        if (inGreen) s.stamina -= (14 + s.reel * 0.5) * dt;
        else if (s.tension < TENSION_GREEN[0]) s.stamina = Math.min(s.max_stamina, s.stamina + 7 * dt);

        if (s.tension > TENSION_MAX) { s.over = true; s.result = 'snapped'; return anglingEnd(g); }
        if (s.stamina <= 0) { s.stamina = 0; s.over = true; s.result = 'landed'; return anglingEnd(g); }
    }

    function anglingEnd(g) {
        const s = g.angling, p = g.p, fish = catchById(s.catch_id);
        if (s.result === 'snapped') {
            log(g, 'the line goes, and the ' + fish.name + ' takes it with it.', 'bad');
            const rod = p.equipment.off_hand;
            if (rod && rod.durability) {
                rod.durability.current -= 15;
                if (rod.durability.current <= 0) { p.equipment.off_hand = null; log(g, rod.name + ' is finished.', 'bad'); }
            }
            sound('error');
            g.angling = null;
            g.screen = 'world';
            return (save(g), render(g));
        }
        p.stats.landed++;
        gainLifeSkill(g, 'fishing', 30 + fish.tier * 40);
        if (fish.encounter) {
            const tpl = foeById(fish.encounter);
            log(g, fish.text, 'bad');
            g.angling = null;
            return startFight(g, [foeFromTemplate(tpl, 1)], 'angling');
        }
        p.coin += fish.value;
        gainXp(g, Math.round(60 + fish.value * 1.4));
        log(g, 'landed: ' + fish.name + '. ' + fish.text + ' +' + fish.value + ' coin.', 'good');
        if (fish.material) for (const m in fish.material) p.materials[m] = (p.materials[m] || 0) + fish.material[m];
        if (fish.codex) unlockCodex(g, fish.codex);
        if (fish.salvage && fish.rolls) {
            const r = fish.rolls;
            if (r.coin) { const c = ri(g.rng, r.coin[0], r.coin[1]); p.coin += c; log(g, 'the box holds ' + c + ' coin.', 'good'); }
            if (r.rareMaterial) {
                const mat = pick(g.rng, D.materials.filter(m => !m.reagent && m.tier >= 3));
                p.materials[mat.id] = (p.materials[mat.id] || 0) + r.rareMaterial;
                log(g, 'and ' + r.rareMaterial + ' × ' + mat.name + '.', 'good');
            }
            if (r.runeChance && chance(g.rng, r.runeChance)) { const rn = pick(g.rng, D.runes); p.runes.push(rn.id); log(g, 'and a rune: ' + rn.name + '.', 'good'); }
            if (r.blueprintChance && chance(g.rng, r.blueprintChance)) {
                const rec = pick(g.rng, D.recipes.filter(x => p.known_recipes.indexOf(x.id) < 0));
                if (rec) { p.known_recipes.push(rec.id); log(g, 'and a blueprint: ' + rec.name + '.', 'good'); }
            }
            achieve('echoes-relic');
        }
        if (fish.onEat) p.inventory.push({ item_id: 'consumable_' + fish.id + '_' + (g.itemSeq++), name: fish.name, consumable: fish.onEat, slot: null, weight: 0.5, rarity: 'common', rarity_name: 'Common', value: fish.value });
        clampVitals(p);
        sound('ding');
        g.angling = null;
        g.screen = 'world';
        save(g);
        render(g);
    }

    // ---------- codex ----------
    function unlockCodex(g, id) {
        if (!id || g.p.codex.indexOf(id) >= 0) return;
        g.p.codex.push(id);
        const entry = byId(D.codex, id);
        log(g, 'codex: ' + (entry ? entry.title : id) + '.', 'lore');
        if (g.p.codex.length >= D.codex.length) achieve('echoes-codex');
        bus.emit('CODEX_UNLOCKED', id);
    }

    // ---------- dialogue (GDD Module 1.4) ----------
    function dialogueNode(id) { return D.dialogue[id] || null; }
    function dialogueBody(g, node) {
        if (node.sanity_threshold && g.p.vitals.sanity < node.sanity_threshold && node.sanity_altered_text) {
            return { text: node.sanity_altered_text, altered: true };
        }
        return { text: node.entry_text, altered: false };
    }
    function optionAvailable(g, opt) {
        const p = g.p, c = opt.condition;
        if (!c) return { ok: true };
        if (c.required_item && (p.quest_items[c.required_item] || 0) < 1) {
            return { ok: false, why: 'you do not have it' };
        }
        if (c.min_reputation) {
            const have = p.faction_reputation[c.min_reputation.faction] || 0;
            if (have < c.min_reputation.value) return { ok: false, why: D.factions[c.min_reputation.faction].short + ' standing ' + have + '/' + c.min_reputation.value };
        }
        return { ok: true };
    }

    function startDialogue(g, dialogueId) {
        if (!dialogueNode(dialogueId)) return;
        g.dialogue = { node_id: dialogueId, roll: null };
        g.screen = 'dialogue';
        render(g);
    }

    function chooseOption(g, index) {
        const dl = g.dialogue;
        if (!dl) return;
        const node = dialogueNode(dl.node_id);
        const opt = node.options[index];
        if (!opt) return;
        const avail = optionAvailable(g, opt);
        if (!avail.ok) { dl.roll = { text: avail.why + '.', pass: false }; return render(g); }

        if (opt.skill_check) {
            const sc = opt.skill_check;
            const res = skillCheck(g.rng, g.p.attributes[sc.attribute], sc.difficulty);
            dl.roll = {
                text: '[' + sc.attribute + '] d20 ' + res.roll + ' + ' + Math.floor(g.p.attributes[sc.attribute] / 2)
                    + ' = ' + res.total + ' vs ' + sc.difficulty + ' — ' + (res.pass ? 'pass' : 'fail')
                    + (res.critical ? ' (critical ' + res.critical + ')' : ''),
                pass: res.pass
            };
            // a critical success is worth something beyond the branch
            if (res.critical === 'success') { gainXp(g, 250); dl.roll.text += ' — and you learn something on the way past.'; }
            if (res.critical === 'failure') {
                const bite = sanityLoss(g.p, 6);
                g.p.vitals.sanity -= bite;
            }
            const target = res.pass ? sc.success_target : sc.failure_target;
            if (target && dialogueNode(target)) { dl.node_id = target; save(g); return render(g); }
            g.dialogue = null; g.screen = 'world'; save(g); return render(g);
        }

        dl.roll = null;
        runActions(g, opt.actions || []);
        save(g);
        render(g);
    }

    function runActions(g, actions) {
        const p = g.p;
        for (const a of actions) {
            switch (a.type) {
                case 'remove_item':
                    p.quest_items[a.item_id] = Math.max(0, (p.quest_items[a.item_id] || 0) - (a.count || 1));
                    break;
                case 'give_item': {
                    const recipe = recipeById(a.item_id);
                    if (recipe) {
                        const item = makeItem(g, recipe, { rarity: rarityById('abyssal_rare'), qualityScore: 80, forged: true });
                        p.inventory.push(item);
                        log(g, 'you are handed ' + item.name + '.', 'good');
                    } else {
                        p.quest_items[a.item_id] = (p.quest_items[a.item_id] || 0) + (a.count || 1);
                    }
                    break;
                }
                case 'add_reputation':
                    p.faction_reputation[a.faction] = clamp((p.faction_reputation[a.faction] || 0) + a.value, -100, 100);
                    log(g, D.factions[a.faction].short + ' standing ' + (a.value > 0 ? '+' : '') + a.value + '.', a.value > 0 ? 'good' : 'warn');
                    break;
                case 'modify_sanity':
                    p.vitals.sanity = clamp(p.vitals.sanity + a.value, 0, p.vitals.max_sanity);
                    break;
                case 'add_coin': p.coin += a.value; break;
                case 'add_xp': gainXp(g, a.value); break;
                case 'set_flag': p.world_state.story_flags[a.flag] = true; break;
                case 'unlock_codex': unlockCodex(g, a.codex_id); break;
                case 'unlock_realm':
                    if (p.realms_unlocked.indexOf(a.realm) < 0) {
                        p.realms_unlocked.push(a.realm);
                        log(g, realmById(a.realm).name + ' is on your chart now.', 'good');
                    }
                    break;
                case 'advance_act':
                    if (a.act > p.act) { p.act = a.act; log(g, 'Act ' + a.act + ' — ' + D.acts[a.act - 1].title + '.', 'lore'); }
                    break;
                case 'join_faction':
                    p.faction = a.faction;
                    log(g, 'you signed with ' + D.factions[a.faction].name + '. "' + D.factions[a.faction].creed + '"', 'good');
                    achieve('echoes-faction');
                    break;
                case 'trigger_nemesis_alert': triggerNemesisAlert(g, a.faction, a.threat_level || 1); break;
                case 'trigger_ending': return endRun(g, a.ending_id);
                case 'link_dialogue':
                    if (dialogueNode(a.target)) { g.dialogue = { node_id: a.target, roll: g.dialogue && g.dialogue.roll }; return; }
                    break;
                case 'exit_dialogue': g.dialogue = null; g.screen = 'world'; return;
            }
        }
        // an option with actions but no link and no exit closes the conversation
        g.dialogue = null;
        g.screen = 'world';
    }

    function endRun(g, endingId) {
        g.ended = endingId;
        g.dialogue = null;
        g.screen = 'ending';
        achieve('echoes-end');
        bus.emit('RUN_ENDED', endingId);
        save(g);
        render(g);
    }

    // ---------- profile (GDD Module 6.2) ----------
    function newProfile(name, seed) {
        const p = {
            profile_id: 'usr_' + seed.toString(36) + Date.now().toString(36).slice(-4),
            name: String(name).slice(0, 18),
            seed: seed >>> 0,
            level: 1,
            experience: { current: 0, next_level: xpToNext(1) },
            attributes: { might: ATTR_START, finesse: ATTR_START, attunement: ATTR_START, fortitude: ATTR_START, perception: ATTR_START, unallocated_points: 5 },
            vitals: { hp: 0, max_hp: 0, stamina: 0, max_stamina: 0, marrow_mana: 0, max_marrow_mana: 0, sanity: SANITY_MAX, max_sanity: SANITY_MAX },
            equipment: { main_hand: null, off_hand: null, head: null, body: null, lantern: null },
            inventory: [],
            materials: { scrap_iron: 12, fish_oil: 6, purified_oil: 1, flare: 2 },
            runes: [],
            quest_items: {},
            known_recipes: D.recipes.filter(r => r.tier === 1).map(r => r.id),
            skills: {},
            skill_points: 1,
            life_skills: { smithing: { level: 1, xp: 0 }, fishing: { level: 1, xp: 0 } },
            faction_reputation: { syndicate: 0, dredgers: 0, inquisitors: 0 },
            faction: null,
            coin: 120,
            realm: 'rust_shallows',
            realms_unlocked: ['rust_shallows'],
            act: 1,
            codex: ['cdx_great_submersion'],
            stats: { kills: 0, deaths: 0, fled: 0, landed: 0, lords_ended: 0 },
            world_state: { current_day: 1, time_of_day: 'calm_day', current_realm: 'rust_shallows', story_flags: {} }
        };
        clampVitals(p);
        p.vitals.hp = p.vitals.max_hp;
        p.vitals.stamina = p.vitals.max_stamina;
        p.vitals.marrow_mana = p.vitals.max_marrow_mana;
        return p;
    }

    function craftable(p) {
        return D.recipes.filter(r => p.known_recipes.indexOf(r.id) >= 0 || r.tier <= 1 + (p.realms_unlocked.length - 1));
    }

    // ---------- persistence ----------
    function save(g) {
        if (!g.p) return false;
        const p = g.p;
        p.world_state.current_realm = p.realm;
        const player = {};
        for (const k in p) if (k !== 'world_state') player[k] = p[k];
        return saves.saveGame({
            player: player,
            world_state: p.world_state,
            nemesis_roster: g.roster,
            engine: {
                rng_state: g.rng.state(), lord_seq: g.lordSeq, item_seq: g.itemSeq,
                dungeon_seq: g.dungeonSeq, dungeon: g.dungeon, ended: g.ended || null
            }
        });
    }

    function loadInto(g) {
        const doc = saves.loadGame();
        if (!doc || !doc.player) return false;
        g.p = doc.player;
        g.p.world_state = doc.world_state || { current_day: 1, time_of_day: 'calm_day', current_realm: g.p.realm, story_flags: {} };
        g.p.realm = g.p.world_state.current_realm || g.p.realm;
        g.roster = doc.nemesis_roster || [];
        const e = doc.engine || {};
        g.rng = makeRng(g.p.seed);
        if (e.rng_state) g.rng.seed(e.rng_state);
        g.lordSeq = e.lord_seq || 1;
        g.itemSeq = e.item_seq || 1;
        g.dungeonSeq = e.dungeon_seq || 1;
        g.dungeon = e.dungeon || null;
        g.ended = e.ended || null;
        clampVitals(g.p);
        return true;
    }

    // ---------- the overworld ----------
    const W = window.ECHOES_WORLD;
    const SPR = window.ECHOES_SPRITES;
    const VIEW_COLS = 15, VIEW_ROWS = 11;
    const VIEW_W = VIEW_COLS * W.TILE, VIEW_H = VIEW_ROWS * W.TILE;
    const WORLD_SCALE = 2;
    const STEP_FRAMES = 8;
    const ENCOUNTER_CHANCE = 0.11;
    const ENCOUNTER_GRACE = 3;               // steps of quiet after one fires
    const STORY_OPENING_STEPS = 14;          // let the player walk before act I

    function enterWorld(g, mapId, spawn) {
        const map = W.mapById(mapId);
        if (!map) return;
        const at = spawn || map.spawn;
        g.world = {
            map: mapId,
            x: at.x, y: at.y, dir: at.dir || 'down',
            step: null, frame: 0, walkFrame: 0,
            sinceEncounter: 99, steps: 0, say: null, held: {}
        };
        g.p.realm = map.realm;
        g.p.world_state.current_realm = map.realm;
        g.screen = 'world';
    }

    function worldMap(g) { return W.mapById(g.world.map); }

    // one frame of the overworld: finish a step, start a step, roll for
    // whatever is living in the kelp
    function worldTick(g) {
        const s = g.world;
        if (!s || g.screen !== 'world') return;
        s.frame++;
        if (s.say) return;                       // the band holds everything still

        if (s.step) {
            s.step.t++;
            if (s.step.t >= STEP_FRAMES) {
                s.x = s.step.tx; s.y = s.step.ty;
                s.step = null;
                s.walkFrame ^= 1;
                return arriveAt(g);
            }
            return;
        }
        const dir = heldDirection(s);
        if (!dir) return;
        s.dir = dir;
        const d = W.DIRS[dir];
        const tx = s.x + d[0], ty = s.y + d[1];
        if (!W.walkable(worldMap(g), tx, ty)) { s.walkFrame ^= 1; return; }
        s.step = { t: 0, tx: tx, ty: ty };
    }
    function heldDirection(s) {
        for (const dir of ['up', 'down', 'left', 'right']) if (s.held[dir]) return dir;
        return null;
    }

    function arriveAt(g) {
        const s = g.world, map = worldMap(g);
        s.steps++;
        // Act I opens itself, but not before the landing has had a chance to
        // be a place: let the player walk it first, then the line comes up
        if (g.p.act === 1 && !g.p.world_state.story_flags.act1_relic_found && s.steps >= STORY_OPENING_STEPS) {
            return startDialogue(g, 'dlg_act1_discovery');
        }
        const tile = W.tileAt(map, s.x, s.y);
        s.sinceEncounter++;
        if (!tile.encounter) return;
        if (s.sinceEncounter < ENCOUNTER_GRACE) return;
        if (!chance(g.rng, ENCOUNTER_CHANCE)) return;
        s.sinceEncounter = 0;
        const ambusher = rollAmbush(g, g.p.realm);
        if (ambusher) {
            log(g, ambusher.dialogue_set.intro_encounter, 'bad');
            return startFight(g, [lordToFoe(ambusher)], 'ambush');
        }
        const tpl = pickFoeTemplate(g, g.p.realm, 1);
        log(g, 'something comes up out of the ' + tile.name + '.', 'bad');
        return startFight(g, [foeFromTemplate(tpl, 1)], 'world');
    }

    function worldInteract(g) {
        const s = g.world;
        if (!s) return;
        if (s.say) {                              // advance or close the band
            s.say.index++;
            if (s.say.index >= s.say.lines.length) s.say = null;
            return render(g);
        }
        if (s.step) return;
        const map = worldMap(g);
        const what = W.facing(map, s);
        switch (what.kind) {
            case 'npc': return talkTo(g, what.npc);
            case 'sign': return say(g, 'a sign', [what.text]);
            case 'warp': {
                const wp = what.warp;
                enterWorld(g, wp.map, { x: wp.x, y: wp.y, dir: wp.dir });
                save(g);
                return render(g);
            }
            case 'angle': g.screen = 'angling_pick'; return render(g);
            case 'forge': g.screen = 'forge_pick'; return render(g);
            case 'voyage':
                if (g.p.act === 3 && g.p.realm === 'drowned_spire' && g.p.world_state.story_flags['boss_boss_drowned_archon']) {
                    return startDialogue(g, 'dlg_archon_final');
                }
                return startVoyage(g);
            case 'rest': return rest(g);
            case 'read': return say(g, null, ['Crates, roped down and stencilled with somebody else\'s name.']);
            default: return say(g, null, ['Nothing here but ' + (what.tile ? what.tile.name : 'the deck') + '.']);
        }
    }

    function say(g, name, lines) {
        g.world.say = { name: name, lines: lines, index: 0 };
        render(g);
    }

    function talkTo(g, npc) {
        const p = g.p;
        npc.dir = { up: 'down', down: 'up', left: 'right', right: 'left' }[g.world.dir] || 'down';
        // a guild recruiter signs you up on the spot, once
        if (npc.guild && !p.faction) {
            p.faction = npc.guild;
            p.faction_reputation[npc.guild] = clamp(p.faction_reputation[npc.guild] + 25, -100, 100);
            const f = D.factions[npc.guild];
            if (f.hates) p.faction_reputation[f.hates] = clamp(p.faction_reputation[f.hates] - 30, -100, 100);
            log(g, 'you signed with ' + f.name + '. "' + f.creed + '"', 'good');
            achieve('echoes-faction');
            save(g);
            return say(g, npc.name, [npc.lines[0], 'You are one of ours now.']);
        }
        // the act's own conversation takes precedence over small talk
        if (npc.dialogue && dialogueNode(npc.dialogue) && actWantsDialogue(g, npc.dialogue)) {
            return startDialogue(g, npc.dialogue);
        }
        return say(g, npc.name, npc.lines || ['...']);
    }

    function actWantsDialogue(g, id) {
        const p = g.p;
        if (p.act !== 2) return false;
        const act = D.acts[1];
        if (!act.choice) return false;
        const wanted = Object.keys(act.choice.dialogues).map(k => act.choice.dialogues[k]);
        return wanted.indexOf(id) >= 0 && (p.quest_items.item_marrow_core_t3 || 0) > 0;
    }

    // ---------- drawing the overworld ----------
    function drawWorld(g) {
        const cv = g.body && g.body.querySelector('#et-world');
        if (!cv || !g.world) return;
        const ctx = cv.getContext('2d');
        const s = g.world, map = worldMap(g);
        const mapW = map.rows[0].length * W.TILE, mapH = map.rows.length * W.TILE;

        // where the diver actually is, mid-step
        let px = s.x * W.TILE, py = s.y * W.TILE;
        if (s.step) {
            const t = s.step.t / STEP_FRAMES;
            px += (s.step.tx - s.x) * W.TILE * t;
            py += (s.step.ty - s.y) * W.TILE * t;
        }
        const cam = {
            x: clamp(Math.round(px + W.TILE / 2 - VIEW_W / 2), 0, Math.max(0, mapW - VIEW_W)),
            y: clamp(Math.round(py + W.TILE / 2 - VIEW_H / 2), 0, Math.max(0, mapH - VIEW_H))
        };

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.scale(WORLD_SCALE, WORLD_SCALE);
        ctx.fillStyle = '#04090d';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        W.drawMap(ctx, map, cam, { w: VIEW_W, h: VIEW_H }, SPR);

        for (const npc of map.npcs || []) {
            const sx = npc.x * W.TILE - cam.x, sy = npc.y * W.TILE - cam.y - 2;
            if (sx < -20 || sy < -24 || sx > VIEW_W + 20 || sy > VIEW_H + 24) continue;
            SPR.draw(ctx, spriteFor(npc.sprite, npc.dir), sx, sy, { flip: npc.dir === 'right' });
        }

        const walking = !!s.step;
        SPR.draw(ctx, divingSprite(s.dir, walking ? s.walkFrame : 0),
            px - cam.x, py - cam.y - 2, { flip: s.dir === 'right' });

        // the realm's own weather, laid over the lot
        const realm = realmById(g.p.realm);
        if (realm && realm.layer >= 3) {
            ctx.fillStyle = realm.layer === 4 ? 'rgba(240,217,138,0.06)' : 'rgba(10,20,30,0.35)';
            ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        }
        ctx.restore();

        drawWorldHud(g, ctx, cv);
    }
    function divingSprite(dir, frame) {
        if (dir === 'up') return 'diver_up_' + frame;
        if (dir === 'down') return 'diver_down_' + frame;
        return 'diver_side_' + frame;
    }
    function spriteFor(base, dir) { return base; }

    function drawWorldHud(g, ctx, cv) {
        const s = g.world, p = g.p;
        const w = cv.width, h = cv.height;
        // a slim band at the top: where you are, and the day
        ctx.fillStyle = 'rgba(8,12,15,0.82)';
        ctx.fillRect(0, 0, w, 20);
        ctx.fillStyle = '#c9a227';
        ctx.font = '11px monospace';
        ctx.fillText(worldMap(g).name, 8, 14);
        ctx.fillStyle = '#8fa38f';
        const right = 'day ' + p.world_state.current_day + ' · ' + (isBlackTide(p) ? 'black tide' : 'calm day');
        ctx.fillText(right, w - ctx.measureText(right).width - 8, 14);

        if (!s.say) return;
        // and the message band at the bottom, which holds the world still
        const bandH = 66;
        ctx.fillStyle = 'rgba(8,12,15,0.94)';
        ctx.fillRect(0, h - bandH, w, bandH);
        ctx.strokeStyle = '#3d5162';
        ctx.strokeRect(1.5, h - bandH + 1.5, w - 3, bandH - 3);
        ctx.font = '12px monospace';
        if (s.say.name) {
            ctx.fillStyle = '#c9a227';
            ctx.fillText(s.say.name, 12, h - bandH + 20);
        }
        ctx.fillStyle = '#e8e0cc';
        const line = s.say.lines[s.say.index] || '';
        wrapText(ctx, line, 12, h - bandH + (s.say.name ? 38 : 24), w - 24, 15);
        ctx.fillStyle = '#7f9080';
        ctx.font = '10px monospace';
        const more = s.say.index < s.say.lines.length - 1 ? '[space] more' : '[space] close';
        ctx.fillText(more, w - ctx.measureText(more).width - 12, h - 10);
    }
    function wrapText(ctx, text, x, y, maxW, lh) {
        const words = String(text).split(' ');
        let line = '', ly = y;
        for (const word of words) {
            const test = line ? line + ' ' + word : word;
            if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, ly); line = word; ly += lh; }
            else line = test;
        }
        if (line) ctx.fillText(line, x, ly);
    }

    function screenWorld(g) {
        const p = g.p;
        return '<div class="et-main"><div class="et-scroll">'
            + '<canvas class="et-canvas et-world" id="et-world" width="' + (VIEW_W * WORLD_SCALE) + '" height="' + (VIEW_H * WORLD_SCALE) + '"></canvas>'
            + '<div class="et-dim">arrow keys or wasd to walk · space to look at what you are facing</div>'
            + '<div class="et-abils">'
            + btn('screen:sheet', 'character') + btn('screen:skills', 'skills' + (p.skill_points ? ' (' + p.skill_points + ')' : ''))
            + btn('screen:gear', 'gear') + btn('screen:chart', 'chart')
            + btn('screen:codex', 'codex (' + p.codex.length + '/' + D.codex.length + ')') + btn('screen:factions', 'guilds')
            + btn('screen:nemesis', 'admiralty')
            + '</div>'
            + '<div class="et-dim">' + esc(realmById(p.realm).name) + ' · Act ' + p.act + ' — ' + esc(D.acts[p.act - 1].title) + '. ' + esc(D.acts[p.act - 1].goal) + '</div>'
            + hazardLine(p)
            + '</div></div>';
    }

    // what the realm does to you, and whether you have an answer to it
    function hazardLine(p) {
        const h = realmById(p.realm).hazard;
        const countered = SLOTS.some(s => p.equipment[s] && p.equipment[s].counters === h.id);
        return '<div class="et-dim" style="color:' + (countered ? '#8fa38f' : '#c0625a') + '">'
            + esc(h.name) + ': ' + esc(h.text) + (countered ? ' — answered by your gear.' : ' You need ' + esc(h.counterName) + '.') + '</div>';
    }

    // ---------- the battle screen ----------
    // Which silhouette a thing gets. This is presentation, so it lives with
    // the renderer rather than in the content library.
    const FOE_SPRITE = {
        mob_dock_rat: 'arch_swarm', mob_rust_ghoul: 'arch_humanoid', mob_gull_swarm: 'arch_swarm',
        mob_hull_crab: 'arch_crab', mob_salvage_thief: 'arch_humanoid', mob_brine_wight: 'arch_wraith',
        mob_reef_choirling: 'arch_choir', mob_glass_hound: 'arch_crab', mob_mist_surgeon: 'arch_humanoid',
        mob_chitin_crawler: 'arch_crab', mob_corroded_saint: 'arch_humanoid',
        mob_brine_diver_mutant: 'arch_humanoid', mob_pressure_wraith: 'arch_wraith',
        mob_rib_walker: 'arch_hulk', mob_trench_choir: 'arch_choir',
        mob_spire_sentinel: 'arch_machine', mob_ash_apostle: 'arch_humanoid', mob_hollow_tide: 'arch_wraith',
        mob_hollow_fragment: 'arch_wraith', mob_parasitic_leech: 'arch_leech',
        boss_anchor_saint: 'arch_machine', boss_reef_choir: 'arch_choir',
        boss_morvath_behemoth: 'arch_hulk', boss_drowned_archon: 'arch_wraith',
        boss_kraken_spawn: 'arch_fish'
    };
    const CREATURE_SPRITE = {
        cr_drowned_reaver: 'arch_humanoid', cr_sump_prophet: 'arch_wraith', cr_chain_baron: 'arch_hulk',
        cr_ash_widow: 'arch_humanoid', cr_reef_dowager: 'arch_choir', cr_harpoon_martyr: 'arch_humanoid',
        cr_boiler_saint: 'arch_machine', cr_lantern_eater: 'arch_fish'
    };
    // a Lord's coat is derived from its id, so the same Lord is the same
    // colour every time you meet it and no two share one by accident
    const LORD_COATS = ['#3d5162', '#5a3a4e', '#3f5540', '#5c4a2c', '#443a5e', '#4d3030', '#2f4a52', '#54452f'];
    function foeSprite(g, foe) {
        if (foe.nemesis_id) {
            const n = lordById(g.roster, foe.nemesis_id);
            if (n) return CREATURE_SPRITE[n.base_creature] || 'arch_humanoid';
        }
        return FOE_SPRITE[foe.id] || 'arch_humanoid';
    }
    function foePalette(g, foe) {
        if (!foe.nemesis_id) return null;
        let h = 0;
        for (let i = 0; i < foe.nemesis_id.length; i++) h = (h * 31 + foe.nemesis_id.charCodeAt(i)) >>> 0;
        return { c: LORD_COATS[h % LORD_COATS.length] };
    }

    const BATTLE_W = 240, BATTLE_H = 148, BATTLE_SCALE = 2;

    function drawBattle(g) {
        const cv = g.body && g.body.querySelector('#et-battle');
        if (!cv || !g.fight) return;
        const ctx = cv.getContext('2d');
        const f = g.fight, p = g.p;
        const foe = currentTarget(g) || f.foes[0];

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.scale(BATTLE_SCALE, BATTLE_SCALE);

        // the water behind everything, tinted by the realm
        const realm = realmById(p.realm);
        const deep = ['#12222b', '#101f24', '#0a141a', '#141018'][Math.max(0, realm.layer - 1)];
        const grad = ctx.createLinearGradient(0, 0, 0, BATTLE_H);
        grad.addColorStop(0, deep);
        grad.addColorStop(1, '#04090d');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, BATTLE_W, BATTLE_H);
        if (f.arena.flooded) { ctx.fillStyle = 'rgba(40,90,120,0.25)'; ctx.fillRect(0, 0, BATTLE_W, BATTLE_H); }
        if (f.arena.radiation) { ctx.fillStyle = 'rgba(240,217,138,0.10)'; ctx.fillRect(0, 0, BATTLE_W, BATTLE_H); }

        // two platforms, the far one small and the near one wide
        ctx.fillStyle = '#26313a';
        ellipse(ctx, 168, 62, 46, 11);
        ctx.fillStyle = '#1b242b';
        ellipse(ctx, 62, 116, 58, 13);

        // the foe, facing you
        if (foe && foe.hp > 0) {
            const bob = Math.sin(f.round * 0.9 + (g.world ? g.world.frame : 0) * 0.05) * 1.5;
            const pal = foePalette(g, foe);
            const flash = foe._flash > 0;
            ctx.save();
            if (flash) ctx.globalAlpha = 0.45;
            SPR.draw(ctx, foeSprite(g, foe), 168 - 28, 62 - 44 + bob, { scale: 2, palette: pal || undefined });
            ctx.restore();
            if (foe._flash > 0) foe._flash--;
        }
        // and your own back
        const pflash = f.playerFlash > 0;
        ctx.save();
        if (pflash) ctx.globalAlpha = 0.45;
        SPR.draw(ctx, 'diver_back', 62 - 24, 116 - 52, { scale: 2 });
        ctx.restore();
        if (f.playerFlash > 0) f.playerFlash--;

        // the other foes, small, waiting their turn
        const others = f.foes.filter(x => x !== foe && x.hp > 0);
        others.forEach((o, i) => {
            SPR.draw(ctx, foeSprite(g, o), BATTLE_W - 34 - i * 22, 6, { palette: foePalette(g, o) || undefined });
        });

        // health boxes, in the corners a handheld would put them
        healthBox(ctx, 6, 6, foe ? foe.name : '', foe ? Math.max(0, foe.hp) : 0, foe ? foe.max_hp : 1, foe ? foe.level : 1, false);
        healthBox(ctx, BATTLE_W - 106, BATTLE_H - 40, p.name, p.vitals.hp, p.vitals.max_hp, p.level, true);

        if (f.arena.telegraph) {
            ctx.fillStyle = 'rgba(184,81,74,0.30)';
            ctx.fillRect(0, 96, BATTLE_W, 40);
            ctx.fillStyle = '#c4604f';
            ctx.font = '9px monospace';
            ctx.fillText('a red line across the deck', 8, 92);
        }
        if (f.barrier > 0) {
            ctx.strokeStyle = 'rgba(143,122,192,0.8)';
            ctx.beginPath();
            ctx.arc(62, 100, 32, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }
    function ellipse(ctx, cx, cy, rx, ry) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    // cut a label down until it actually fits the room it has been given
    function fitText(ctx, text, room) {
        if (ctx.measureText(text).width <= room) return text;
        let out = text;
        while (out.length > 1 && ctx.measureText(out.replace(/\s+$/, '') + '…').width > room) out = out.slice(0, -1);
        return out.replace(/\s+$/, '') + '…';
    }

    function healthBox(ctx, x, y, name, hp, max, level, mine) {
        const w = 100, h = 34;
        ctx.fillStyle = 'rgba(8,12,15,0.88)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#3d5162';
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.font = '9px monospace';
        const lv = 'lv' + level;
        const lvW = ctx.measureText(lv).width;
        ctx.fillStyle = '#e8e0cc';
        // the level sits hard right, so the name gets whatever is left of it
        ctx.fillText(fitText(ctx, String(name), w - 14 - lvW), x + 5, y + 12);
        ctx.fillStyle = '#8fa38f';
        ctx.fillText(lv, x + w - 5 - lvW, y + 12);
        ctx.fillStyle = '#0b120f';
        ctx.fillRect(x + 5, y + 17, w - 10, 6);
        const pct = clamp(max > 0 ? hp / max : 0, 0, 1);
        ctx.fillStyle = pct > 0.5 ? '#6f9f6a' : pct > 0.2 ? '#c9a227' : '#b8514a';
        ctx.fillRect(x + 5, y + 17, (w - 10) * pct, 6);
        if (mine) {
            ctx.fillStyle = '#8fa38f';
            ctx.fillText(hp + '/' + max, x + 5, y + 31);
        }
    }

    // ---------- html ----------
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function bar(kind, cur, max, label) {
        const pct = clamp(max > 0 ? (cur / max) * 100 : 0, 0, 100);
        return '<div class="et-bar"><div class="et-bar-fill ' + kind + '" style="width:' + pct.toFixed(1) + '%"></div><span>' + esc(label) + '</span></div>';
    }
    function btn(action, label, o) {
        o = o || {};
        return '<button class="et-btn' + (o.wide ? ' et-wide' : '') + '" data-a="' + esc(action) + '"'
            + (o.arg !== undefined ? ' data-x="' + esc(o.arg) + '"' : '')
            + (o.disabled ? ' disabled' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '')
            + '>' + esc(label) + '</button>';
    }
    const pctText = v => (v * 100).toFixed(1) + '%';

    // below 25 sanity the interface is not a reliable narrator
    function shownHp(g, foe) {
        if (sanityTier(g.p) !== 'illusions' && sanityTier(g.p) !== 'panic') return Math.max(0, foe.hp);
        const jitter = 1 + (g.rng() - 0.5) * 0.5;
        return Math.max(0, Math.round(foe.hp * jitter));
    }

    function sideBar(g) {
        const p = g.p;
        const tier = sanityTier(p);
        const lords = g.roster.filter(n => n.status === 'active' || n.status === 'hunting')
            .sort((a, b) => (b.tier - a.tier) || (b.power_index - a.power_index)).slice(0, 5);
        return '<div class="et-side">'
            + '<div class="et-sheet">'
            + '<div class="et-name">' + esc(p.name) + ' <span>lv ' + p.level + ' · ' + (p.faction ? esc(D.factions[p.faction].short) : 'unaffiliated') + '</span></div>'
            + bar('hp', p.vitals.hp, p.vitals.max_hp, 'hp ' + p.vitals.hp + ' / ' + p.vitals.max_hp)
            + bar('stam', p.vitals.stamina, p.vitals.max_stamina, 'stamina ' + Math.round(p.vitals.stamina) + ' / ' + p.vitals.max_stamina)
            + bar('marrow', p.vitals.marrow_mana, p.vitals.max_marrow_mana, 'marrow ' + Math.round(p.vitals.marrow_mana) + ' / ' + p.vitals.max_marrow_mana)
            + bar('san', p.vitals.sanity, p.vitals.max_sanity, 'sanity ' + p.vitals.sanity + ' / ' + p.vitals.max_sanity + ' — ' + tier)
            + bar('xp', p.experience.current, xpToNext(p.level), 'xp ' + p.experience.current + ' / ' + xpToNext(p.level))
            + '<div class="et-stats">'
            + D.attributes.map(a => '<div>' + a.short + ' <b>' + p.attributes[a.id] + '</b></div>').join('')
            + '<div>ARM <b>' + armourOf(p) + '</b></div><div>MIT <b>' + pctText(armourMitigation(armourOf(p))) + '</b></div>'
            + '</div>'
            + '<div class="et-coin">' + p.coin + ' coin · day ' + p.world_state.current_day + ' · ' + (isBlackTide(p) ? 'black tide' : 'calm day') + '</div>'
            + '</div>'
            + '<div class="et-nem"><div class="et-nem-head">the drowned admiralty</div>'
            + (lords.map(n => '<div class="et-nem-row"><b>' + esc(lordDisplayName(n)) + '</b><span>' + esc(n.rank) + ' · ' + esc(realmById(n.current_zone).name) + '</span><i>pi ' + n.power_index + '</i></div>').join('')
                || '<div class="et-dim">nobody has noticed you yet.</div>')
            + btn('screen:nemesis', 'the full roster', { wide: true })
            + '</div>'
            + '<div class="et-log">' + g.log.slice(0, 14).map(l => '<div class="' + esc(l.kind) + '">' + esc(l.text) + '</div>').join('') + '</div>'
            + '</div>';
    }

    function screenCreate(g) {
        const c = g.create;
        const spent = D.attributes.reduce((s, a) => s + (c.attributes[a.id] - ATTR_START), 0);
        return '<div class="et-main"><div class="et-scroll">'
            + '<div class="et-title">echoes of the tide</div><div class="et-sub">leviathan\'s wake</div>'
            + '<div class="et-intro">Three hundred years ago the Celestial Sun broke out of the sky and fell into the deepest trench in the ocean. The seas rose to meet the hole it left and the continents went under entire.<br><br>What is left of us floats: iron rigs lashed together with chain, towns built on dead Leviathan skeletons, and a few rock towers that used to be mountains. You dredge scrap out of wrecks for a living, and this morning the harpoon line came up heavy and wrong.</div>'
            + '<div class="et-field"><label>name</label><input id="et-name" maxlength="18" value="' + esc(c.name) + '"></div>'
            + '<div class="et-field"><label>seed <span class="et-dim">— the same seed is the same admiralty</span></label><input id="et-seed" maxlength="10" value="' + esc(c.seed) + '"></div>'
            + '<div class="et-h4">attributes — ' + (5 - spent) + ' of 5 free points left</div>'
            + '<div class="et-stats">' + D.attributes.map(a => '<div>' + esc(a.name) + ' <b>' + c.attributes[a.id] + '</b> '
                + btn('cre-', '−', { arg: a.id, disabled: c.attributes[a.id] <= ATTR_START })
                + btn('cre+', '+', { arg: a.id, disabled: spent >= 5 })
                + '<i class="et-dim">' + esc(a.governs) + '</i></div>').join('') + '</div>'
            + '<div class="et-row">' + btn('create', 'take the boat out', { wide: true }) + '</div>'
            + '<div class="et-row">' + btn('import', 'import a save string') + '</div>'
            + '</div></div>';
    }

    function screenCombat(g) {
        const f = g.fight, p = g.p;
        const target = currentTarget(g);
        const skills = [];
        for (const tree of D.skillTrees) for (const node of tree.nodes) {
            if (node.type !== 'active' || rankOf(p, node.id) < 1) continue;
            const c = canUseSkill(g, node.id);
            skills.push(btn('skill', node.name, { arg: node.id, disabled: f.over || !c.ok, title: c.ok ? node.text : c.why }));
        }
        const harpoons = f.foes.some(x => x.phases && (x.phases[x.phase].mechanics || []).indexOf('interactable_harpoons') >= 0) && !f.arena.harpoonsUsed;
        return '<div class="et-main"><div class="et-scroll">'
            + '<canvas class="et-canvas et-battle" id="et-battle" width="' + (BATTLE_W * BATTLE_SCALE) + '" height="' + (BATTLE_H * BATTLE_SCALE) + '"></canvas>'
            + f.foes.map((foe, i) => foe.hp <= 0 ? '' :
                '<div class="et-foe' + (target === foe ? ' here' : '') + '" data-a="target" data-x="' + i + '">'
                + '<div class="et-foe-name">' + esc(foe.name) + ' <span class="et-dim">lv ' + foe.level + (foe.rank ? ' · ' + esc(foe.rank) : '') + '</span></div>'
                + bar('foe', shownHp(g, foe), foe.max_hp, shownHp(g, foe) + ' / ' + foe.max_hp)
                + '<div class="et-foe-text">' + esc(foe.text || '') + '</div>'
                + (foe.immune.length ? '<div class="et-dim">immune: ' + esc(foe.immune.join(', ')) + '</div>' : '')
                + '<div class="et-traits">'
                + ['immunities', 'enrage_triggers', 'vulnerabilities', 'phobias'].map(k => (foe.traits[k] || []).map(id => {
                    const pool = D.nemesisTraits[k] || [];
                    const t = byId(pool, id);
                    return '<span class="et-trait known" title="' + esc(t ? t.text : id) + '">' + esc(t ? t.name : id) + '</span>';
                }).join('')).join('')
                + (foe.enraged ? '<span class="et-trait known" style="color:#c0625a">enraged</span>' : '')
                + '</div></div>').join('')
            + (f.arena.telegraph ? '<div class="et-lore" style="color:#c9a227">a red line is marked across the deck. Next turn, that line.</div>' : '')
            + (f.barrier > 0 ? '<div class="et-dim">barrier ' + f.barrier + '</div>' : '')
            + '<div class="et-abils">'
            + btn('strike', 'strike (' + STRIKE_STAMINA + ')', { disabled: f.over })
            + btn('guard', 'guard', { disabled: f.over })
            + skills.join('')
            + (harpoons ? btn('harpoon', 'pull the harpoon levers', { disabled: f.over }) : '')
            + ((p.materials.flare || 0) > 0 ? btn('flare', 'flare (' + p.materials.flare + ')', { disabled: f.over }) : '')
            + btn('flee', 'cut and run', { disabled: f.over })
            + '</div>'
            + '<div class="et-dim">round ' + f.round + ' · armour ' + armourOf(p) + ' (' + pctText(armourMitigation(armourOf(p))) + ' mitigation) · crit ' + pctText(critChance(p)) + ' ×' + critMultiplier(p).toFixed(2)
            + ' · hit ' + pctText(clamp(BASE_HIT_CHANCE + hitRating(p) - (target ? target.dodge : 0), HIT_FLOOR, HIT_CEILING)) + '</div>'
            + '<div class="et-fightlog">' + f.log.map(l => '<div class="' + esc(l.kind) + '">' + esc(l.text) + '</div>').join('') + '</div>'
            + (f.over ? '<div class="et-row">' + btn('fight-done', f.result === 'won' ? 'take what is left' : f.result === 'fled' ? 'go' : 'wake up', { wide: true }) + '</div>' : '')
            + '</div></div>';
    }

    function screenDungeon(g) {
        const d = g.dungeon, realm = realmById(d.realm);
        const here = dungeonNode(d, d.current_node);
        const options = here.cleared ? availableNodes(d) : [here];
        const LABEL = { combat: 'something is in the way', elite: 'a drowned lord', salvage: 'sunken treasure', mystery: 'a choice', rest: 'a rest rig', boss: 'the thing at the bottom' };
        return '<div class="et-main"><div class="et-scroll">'
            + '<div class="et-station"><div class="et-station-head">' + esc(realm.name) + '<span>floor ' + d.current_floor + ' / ' + d.floors + '</span></div>'
            + '<div class="et-room"><div class="et-h4">' + (here.cleared ? 'where next' : esc(LABEL[here.type])) + '</div>'
            + '<div class="et-lore">' + esc(here.text) + '</div>'
            + options.map(n => btn('node', (here.cleared ? '' : 'take it — ') + LABEL[n.type] + ' (floor ' + n.floor + ', ×' + n.stat_multiplier + ')', { arg: n.node_id, wide: true })).join('')
            + (here.cleared && !options.length ? '<div class="et-dim">nothing connects onward from here.</div>' : '')
            + '</div></div>'
            + '<div class="et-dim">' + d.nodes.filter(n => n.cleared).length + ' of ' + d.nodes.length + ' rooms behind you</div>'
            + '<div class="et-row">' + btn('leave', 'put back in to harbour') + '</div>'
            + '<div class="et-log">' + g.log.slice(0, 10).map(l => '<div class="' + esc(l.kind) + '">' + esc(l.text) + '</div>').join('') + '</div>'
            + '</div></div>';
    }

    function itemCard(it, full) {
        if (!it) return '';
        const stats = [];
        for (const k of ['damage', 'flatDamage', 'armour', 'maxHp', 'maxMarrow', 'sanityResist', 'blockValue', 'rodStrength']) {
            const v = itemStat(it, k);
            if (v) stats.push(k + ' +' + v);
        }
        for (const k of ['critChancePct', 'dodgePct', 'hazardResistPct', 'burnDamagePct', 'marrowLeechPct']) {
            const v = itemStat(it, k);
            if (v) stats.push(k.replace('Pct', '') + ' +' + Math.round(v * 100) + '%');
        }
        const sockets = (it.sockets || []).map(s => s.gem_id ? esc((runeById(s.gem_id) || {}).name) : '(empty)').join(' · ');
        const curse = it.curse ? byId(D.curses, it.curse) : null;
        return '<div class="et-item ' + esc(it.rarity) + '">'
            + '<b style="color:' + esc(it.rarity_colour || '#e8e0cc') + '">' + esc(it.name) + '</b> <i>t' + it.tier + ' ' + esc(it.rarity_name || it.rarity) + '</i>'
            + '<div class="et-dim">' + esc(SLOT_NAMES[it.slot] || 'carried') + ' · ' + esc(stats.join(' · ') || 'nothing worth listing') + '</div>'
            + (sockets ? '<div class="et-dim">sockets: ' + sockets + '</div>' : '')
            + (curse ? '<div class="et-dim" style="color:#c0625a">' + esc(curse.text) + '</div>' : '')
            + (full && it.durability ? '<div class="et-dim">durability ' + it.durability.current + '/' + it.durability.max + ' · ' + it.weight + 'kg · ' + it.value + ' coin' + (it.quality_score !== null && it.quality_score !== undefined ? ' · forged ' + it.quality_score + '/100' : '') + '</div>' : '')
            + '</div>';
    }

    function screenAnglingPick(g) {
        const p = g.p;
        const spots = spotsIn(p.realm);
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">where to cast</div>'
            + '<div class="et-patterns">' + spots.map(s => {
                const c = s.conditions;
                const wrongTide = (c.tide_phase === 'black_tide') !== isBlackTide(p);
                return '<div class="et-pattern' + (wrongTide ? ' locked' : '') + '"' + (wrongTide ? '' : ' data-a="cast" data-x="' + esc(s.id) + '"') + '>'
                    + '<b>' + esc(s.name) + '</b><span>' + s.depth_meters + ' m · bait tier ' + s.requires_bait_tier + '</span>'
                    + '<i>' + (c.tide_phase === 'black_tide' ? 'black tide only' : 'calm day only') + (wrongTide ? ' — not now' : '') + '</i>'
                    + '<i class="et-dim">−' + c.sanity_drain_per_cast + ' sanity a cast · ' + c.monster_encounter_chance_pct + '% something comes up instead</i>'
                    + '</div>';
            }).join('') + '</div>'
            + '<div class="et-dim">rod ' + rodStrengthOf(p) + ' · reel ' + reelSpeedOf(p) + ' — a stronger rod raises tension more slowly.</div>'
            + '<div class="et-row">' + btn('screen:world', 'back') + '</div></div></div>';
    }

    function screenAngling(g) {
        const s = g.angling, fish = catchById(s.catch_id);
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">the line is out</div>'
            + '<canvas class="et-canvas" id="et-canvas" width="300" height="210"></canvas>'
            + '<div class="et-dim">hold to reel, release for slack. Keep the tension in the green band — that is the only place its stamina goes down — and do not let it reach 100.</div>'
            + '<div class="et-abils">' + btn('reel', 'hold the line', { wide: true }) + '</div>'
            + '<div class="et-row">' + btn('cut', 'cut it loose') + '</div></div></div>';
    }

    function screenForgePick(g) {
        const p = g.p;
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">the deep-forge</div>'
            + '<div class="et-dim">smithing level ' + p.life_skills.smithing.level + ' · '
            + (D.materials.filter(m => (p.materials[m.id] || 0) > 0).map(m => esc(m.name) + ' ×' + p.materials[m.id]).join(' · ') || 'no stock at all') + '</div>'
            + '<div class="et-patterns">' + craftable(p).map(r => {
                const ok = canCraft(p, r);
                const mat = D.materials.find(m => m.tier === r.tier && !m.reagent) || D.materials[0];
                return '<div class="et-pattern' + (ok ? '' : ' locked') + '"' + (ok ? ' data-a="forge" data-x="' + esc(r.id) + '"' : '') + '>'
                    + '<b>' + esc(r.name) + '</b><span>tier ' + r.tier + ' · ' + esc(SLOT_NAMES[r.slot]) + ' · ' + mat.heat[0] + '–' + mat.heat[1] + '°C</span>'
                    + '<i>' + Object.keys(r.cost).map(m => esc((materialById(m) || {}).name) + ' ×' + r.cost[m]).join(', ') + (r.skill > 1 ? ' · needs smithing ' + r.skill : '') + '</i>'
                    + '<i class="et-dim">' + esc(r.text) + '</i></div>';
            }).join('') + '</div>'
            + '<div class="et-row">' + btn('screen:world', 'back') + '</div></div></div>';
    }

    function screenForge(g) {
        const f = g.forge, recipe = recipeById(f.recipe_id);
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">' + esc(recipe.name) + '</div>'
            + '<canvas class="et-canvas" id="et-canvas" width="300" height="200"></canvas>'
            + '<div class="et-lore">' + (f.phase === 'heat'
                ? 'Pull it when the needle is in the band: ' + f.window[0] + '–' + f.window[1] + '°C.'
                : 'Strike ' + (f.strike + 1) + ' of 3 — hit the sweet spot.') + '</div>'
            + '<div class="et-abils">' + btn('forge-hit', f.phase === 'heat' ? 'pull it out' : 'strike', { wide: true }) + '</div>'
            + '</div></div>';
    }

    function screenForgeDone(g) {
        const it = g.lastForged;
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">' + esc(it.name) + '</div>'
            + itemCard(it, true)
            + '<div class="et-abils">' + btn('equip', 'put it on', { arg: it.item_id }) + btn('screen:forge_pick', 'forge again') + btn('screen:world', 'done') + '</div>'
            + '</div></div>';
    }

    function screenEvent(g) {
        const ev = g.pendingEvent;
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">' + esc(ev.name) + '</div>'
            + '<div class="et-lore">' + esc(ev.text) + '</div>'
            + '<div class="et-abils">' + ev.options.map((o, i) => btn('event', o.text, { arg: i, wide: true })).join('') + '</div>'
            + '</div></div>';
    }

    function screenDialogue(g) {
        const dl = g.dialogue, node = dialogueNode(dl.node_id), p = g.p;
        const body = dialogueBody(g, node);
        return '<div class="et-main"><div class="et-scroll">'
            + '<div class="et-h">' + esc(node.speaker_name) + '</div>'
            + (body.altered ? '<div class="et-dim" style="color:#a2617d">— you are not hearing this correctly —</div>' : '')
            + '<div class="et-lore" style="white-space:pre-wrap">' + esc(body.text) + '</div>'
            + (dl.roll ? '<div class="et-dim" style="color:' + (dl.roll.pass === false ? '#c0625a' : '#8fa38f') + '">' + esc(dl.roll.text) + '</div>' : '')
            + '<div class="et-abils">' + node.options.map((o, i) => {
                const av = optionAvailable(g, o);
                const label = o.skill_check
                    ? o.text + '  (d20+' + Math.floor(p.attributes[o.skill_check.attribute] / 2) + ' vs ' + o.skill_check.difficulty + ')'
                    : o.text;
                return btn('say', label, { arg: i, wide: true, disabled: !av.ok, title: av.ok ? '' : av.why });
            }).join('') + '</div></div></div>';
    }

    function screenSheet(g) {
        const p = g.p;
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">' + esc(p.name) + '</div>'
            + '<div class="et-dim">level ' + p.level + ' · seed ' + p.seed + ' · ' + (p.faction ? esc(D.factions[p.faction].name) : 'unaffiliated') + '</div>'
            + '<div class="et-h4">attributes' + (p.attributes.unallocated_points ? ' — ' + p.attributes.unallocated_points + ' unspent' : '') + '</div>'
            + '<div class="et-stats">' + D.attributes.map(a => '<div>' + esc(a.name) + ' <b>' + p.attributes[a.id] + '</b> '
                + (p.attributes.unallocated_points ? btn('attr', '+', { arg: a.id }) : '')
                + '<i class="et-dim">' + esc(a.governs) + '</i></div>').join('') + '</div>'
            + '<div class="et-h4">derived</div><div class="et-stats">'
            + '<div>max hp <b>' + p.vitals.max_hp + '</b></div><div>max stamina <b>' + p.vitals.max_stamina + '</b></div>'
            + '<div>max marrow <b>' + p.vitals.max_marrow_mana + '</b></div><div>carry <b>' + carriedWeight(p) + ' / ' + carryCapacity(p) + '</b></div>'
            + '<div>armour <b>' + armourOf(p) + '</b></div><div>mitigation <b>' + pctText(armourMitigation(armourOf(p))) + '</b></div>'
            + '<div>crit <b>' + pctText(critChance(p)) + '</b></div><div>crit dmg <b>×' + critMultiplier(p).toFixed(2) + '</b></div>'
            + '<div>hit <b>+' + pctText(hitRating(p)) + '</b></div><div>dodge <b>' + pctText(dodgeRating(p)) + '</b></div>'
            + '<div>block <b>' + blockValue(p) + '</b></div><div>sanity resist <b>' + Math.round(sanityResist(p)) + '</b></div>'
            + '</div>'
            + '<div class="et-h4">standing</div><div class="et-stats">'
            + Object.keys(p.faction_reputation).map(k => '<div>' + esc(D.factions[k].short) + ' <b>' + p.faction_reputation[k] + '</b></div>').join('') + '</div>'
            + '<div class="et-h4">life skills</div><div class="et-stats">'
            + '<div>smithing <b>' + p.life_skills.smithing.level + '</b></div><div>fishing <b>' + p.life_skills.fishing.level + '</b></div></div>'
            + '<div class="et-dim">' + p.stats.kills + ' kills · ' + p.stats.deaths + ' deaths · ' + p.stats.landed + ' landed · '
            + p.stats.lords_ended + ' lords ended · day ' + p.world_state.current_day + '</div>'
            + '<div class="et-row">' + btn('export', 'export save') + btn('newgame', 'abandon this run') + '</div>'
            + '<div class="et-row">' + btn('screen:world', 'back') + '</div></div></div>';
    }

    function screenSkills(g) {
        const p = g.p;
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">skills <span class="et-dim">' + p.skill_points + ' point' + (p.skill_points === 1 ? '' : 's') + '</span></div>'
            + D.skillTrees.map(tree => '<div class="et-guild"><b>' + esc(tree.name) + '</b><em>' + esc(D.factions[tree.faction].name) + ' · ' + esc(tree.role) + '</em>'
                + '<p>' + esc(tree.blurb) + '</p>'
                + tree.nodes.map(n => {
                    const r = rankOf(p, n.id);
                    const locked = !tierUnlocked(p, n.tier);
                    const v = skillValue(p, n.id) || (n.ranks ? n.ranks[0] : (n.scaling ? n.scaling.baseMultiplier : 0));
                    const shown = (n.text || '').replace('{v}', typeof v === 'number' ? (v < 1 && v > 0 ? v.toFixed(2) : Math.round(v * 100) / 100) : v)
                        .replace('{p}', Math.round((typeof v === 'number' ? v : 0) * 100));
                    return '<div class="et-rank">' + esc(n.name) + ' <span>t' + n.tier + ' · ' + r + '/' + n.maxRank + '</span>'
                        + '<i class="et-dim" style="display:block;font-style:normal">' + esc(shown) + (n.cost ? ' — ' + Object.keys(n.cost).map(k => n.cost[k] + ' ' + k).join(', ') + (n.cooldown ? ', cd ' + n.cooldown : '') : '') + '</i>'
                        + (locked ? '<i class="et-dim">unlocks at level ' + D.tierLevel[n.tier] + '</i>'
                            : (r < n.maxRank && p.skill_points > 0 ? btn('skill-up', 'take a rank', { arg: n.id }) : ''))
                        + '</div>';
                }).join('') + '</div>').join('')
            + '<div class="et-row">' + btn('screen:world', 'back') + '</div></div></div>';
    }

    function screenGear(g) {
        const p = g.p;
        const socketable = p.inventory.concat(SLOTS.map(s => p.equipment[s]).filter(Boolean)).filter(it => (it.sockets || []).some(s => !s.gem_id));
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">gear</div>'
            + '<div class="et-gears">' + SLOTS.map(slot => {
                const it = p.equipment[slot];
                const locked = slot === 'off_hand' && p.level < 10;
                return '<div class="et-gear"><span>' + esc(SLOT_NAMES[slot]) + '</span>'
                    + (it ? '<b style="color:' + esc(it.rarity_colour || '#e8e0cc') + '">' + esc(it.name) + '</b><i>' + esc(it.rarity_name) + ' · t' + it.tier + ' · dur ' + it.durability.current + '/' + it.durability.max + '</i>'
                        : '<b class="et-empty">' + (locked ? '— locked until level 10 —' : '— empty —') + '</b>') + '</div>';
            }).join('') + '</div>'
            + '<div class="et-h4">pack — ' + carriedWeight(p) + ' / ' + carryCapacity(p) + ' kg</div>'
            + '<div class="et-items">' + (p.inventory.length ? p.inventory.map(it =>
                '<div data-a="' + (it.consumable ? 'consume' : 'equip') + '" data-x="' + esc(it.item_id) + '" style="cursor:pointer">' + itemCard(it) + '</div>').join('')
                : '<div class="et-empty">nothing but a knife and a bad idea.</div>') + '</div>'
            + (p.runes.length ? '<div class="et-h4">runes</div><div class="et-items">' + p.runes.map((rid, i) => {
                const r = runeById(rid);
                return '<div class="et-item"><b>' + esc(r.name) + '</b> <i>' + esc(r.stat) + ' +' + r.value + '</i><div class="et-dim">' + esc(r.text) + '</div>'
                    + (socketable.length ? '<select data-rune="' + i + '">' + socketable.map(it => '<option value="' + esc(it.item_id) + '">' + esc(it.name) + '</option>').join('') + '</select> ' + btn('socket', 'set it', { arg: i })
                        : '<div class="et-dim">nothing with an open socket.</div>') + '</div>';
            }).join('') + '</div>' : '')
            + '<div class="et-row">' + btn('screen:world', 'back') + '</div></div></div>';
    }

    function screenChart(g) {
        const p = g.p;
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">the chart</div>'
            + '<div class="et-realms">' + D.realms.map(r => {
                const open = p.realms_unlocked.indexOf(r.id) >= 0;
                const here = p.realm === r.id;
                return '<div class="et-realm' + (here ? ' here' : '') + (open ? '' : ' locked') + '"' + (open && !here ? ' data-a="travel" data-x="' + esc(r.id) + '"' : '') + '>'
                    + '<b>' + esc(r.name) + '</b><i>' + r.depth[0] + '–' + r.depth[1] + ' m</i>'
                    + '<span>' + esc(r.long) + '</span>'
                    + '<span>' + esc(r.hazard.name) + ' — ' + esc(r.hazard.text) + '</span>'
                    + '<span>' + lordsIn(g, r.id).length + ' drowned lords here</span></div>';
            }).join('') + '</div>'
            + '<div class="et-row">' + btn('screen:world', 'back') + '</div></div></div>';
    }

    function screenNemesis(g) {
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">the drowned admiralty</div>'
            + '<div class="et-dim">' + D.nemesisRanks.slice(1).map(r => r.slots + ' × ' + r.name).join(' · ') + '. The seats are alive.</div>'
            + g.roster.slice().sort((a, b) => (b.tier - a.tier) || (b.power_index - a.power_index)).map(n =>
                '<div class="et-nem-full' + (n.status === 'dead' || n.status === 'retired' ? ' dead' : '') + '">'
                + '<b>' + esc(lordDisplayName(n)) + '</b>'
                + '<span>' + esc(n.rank) + ' · ' + esc(realmById(n.current_zone).name) + ' · lv ' + n.level + ' · power ' + n.power_index + ' · ' + esc(n.status) + '</span>'
                + '<i>"' + esc(n.dialogue_set.intro_encounter) + '"</i>'
                + '<div class="et-nem-traits">'
                + ['immunities', 'enrage_triggers', 'vulnerabilities', 'phobias'].map(k => (n.traits[k] || []).map(id => {
                    const t = byId(D.nemesisTraits[k] || [], id);
                    return '<span title="' + esc(t ? t.text : id) + '">' + esc(t ? t.name : id) + '</span>';
                }).join('')).join('')
                + (n.grudge ? '<span>grudge ' + n.grudge + '</span>' : '')
                + '</div>'
                + (n.memories.length ? '<i>' + esc(n.memories.slice(-3).map(m => 'day ' + m.timestamp_game_day + ': ' + m.detail).join(' — ')) + '</i>' : '')
                + '</div>').join('')
            + '<div class="et-row">' + btn('screen:world', 'back') + '</div></div></div>';
    }

    function screenCodex(g) {
        const p = g.p;
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">codex <span class="et-dim">' + p.codex.length + ' of ' + D.codex.length + '</span></div>'
            + D.codex.map(c => p.codex.indexOf(c.id) >= 0
                ? '<details class="et-entry"><summary>' + esc(c.title) + '</summary><pre>' + esc(c.text) + '</pre></details>'
                : '<div class="et-entry et-dim">— unread —</div>').join('')
            + '<div class="et-row">' + btn('screen:world', 'back') + '</div></div></div>';
    }

    function screenFactions(g) {
        const p = g.p;
        return '<div class="et-main"><div class="et-scroll"><div class="et-h">the guilds of the rigs</div>'
            + Object.keys(D.factions).map(k => {
                const f = D.factions[k];
                return '<div class="et-guild"><b>' + esc(f.name) + '</b><em>' + esc(f.leader) + ' · ' + esc(f.seat) + '</em>'
                    + '<p>' + esc(f.blurb) + '</p><i>"' + esc(f.creed) + '"</i>'
                    + '<u>' + esc(f.perk) + ' · standing ' + p.faction_reputation[k] + (f.hates ? ' · will not have ' + esc(D.factions[f.hates].short) : '') + '</u>'
                    + (p.faction === k ? '<div class="et-dim">you signed here.</div>' : '') + '</div>';
            }).join('')
            + '<div class="et-row">' + btn('screen:world', 'back') + '</div></div></div>';
    }

    function screenEnding(g) {
        const e = byId(D.endings, g.ended) || D.endings[0];
        const p = g.p;
        return '<div class="et-main"><div class="et-scroll et-endscreen">'
            + '<div class="et-title">' + esc(e.name) + '</div>'
            + '<div class="et-endtext">' + esc(e.text) + '</div>'
            + '<div class="et-dim">day ' + p.world_state.current_day + ' · level ' + p.level + ' · ' + p.stats.kills + ' kills · ' + p.stats.deaths + ' deaths · ' + p.stats.landed + ' landed · ' + p.codex.length + '/' + D.codex.length + ' codex · ' + p.stats.lords_ended + ' lords ended for good</div>'
            + '<div class="et-row">' + btn('newgame', 'begin again', { wide: true }) + '</div></div></div>';
    }

    // ---------- canvas ----------
    function drawAngling(g) {
        const cv = g.body && g.body.querySelector('#et-canvas');
        if (!cv || !g.angling) return;
        const c = cv.getContext('2d'), s = g.angling, W = cv.width, H = cv.height;
        const grad = c.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#12222b'); grad.addColorStop(1, '#04090d');
        c.fillStyle = grad; c.fillRect(0, 0, W, H);

        // tension gauge with the green band marked
        const bx = 24, by = 26, bw = W - 48, bh = 22;
        c.fillStyle = '#0a1319'; c.fillRect(bx, by, bw, bh);
        c.fillStyle = 'rgba(90,160,110,0.30)';
        c.fillRect(bx + bw * (TENSION_GREEN[0] / TENSION_MAX), by, bw * ((TENSION_GREEN[1] - TENSION_GREEN[0]) / TENSION_MAX), bh);
        const t = clamp(s.tension / TENSION_MAX, 0, 1);
        c.fillStyle = s.tension > TENSION_GREEN[1] ? '#b8514a' : s.tension < TENSION_GREEN[0] ? '#5a8fb8' : '#7fbf7f';
        c.fillRect(bx, by, bw * t, bh);
        c.strokeStyle = '#b8514a'; c.beginPath(); c.moveTo(bx + bw, by - 4); c.lineTo(bx + bw, by + bh + 4); c.stroke();
        c.fillStyle = '#8fa38f'; c.font = '10px monospace';
        c.fillText('line tension ' + Math.round(s.tension) + ' / 100', bx, by - 6);

        // the fish's stamina
        const sy = by + bh + 26;
        c.fillStyle = '#0a1319'; c.fillRect(bx, sy, bw, 16);
        c.fillStyle = '#a2617d';
        c.fillRect(bx, sy, bw * clamp(s.stamina / s.max_stamina, 0, 1), 16);
        c.fillStyle = '#8fa38f';
        c.fillText('its stamina ' + Math.round(s.stamina) + ' / ' + s.max_stamina, bx, sy - 5);

        c.fillStyle = s.holding ? '#c9a227' : '#55645a';
        c.fillText(s.holding ? 'reeling' : 'slack', bx, H - 40);
        c.fillStyle = '#7f9080';
        c.fillText('rod ' + s.rod + ' · reel ' + s.reel + ' · pull ' + s.pull, bx, H - 24);
        if (s.burst > 0) {
            c.fillStyle = 'rgba(184,81,74,' + (0.10 + 0.10 * Math.sin(s.ticks * 0.4)) + ')';
            c.fillRect(0, 0, W, H);
            c.fillStyle = '#e0b8c8';
            c.fillText('it is running', bx, H - 8);
        }
    }

    function drawForge(g) {
        const cv = g.body && g.body.querySelector('#et-canvas');
        if (!cv || !g.forge) return;
        const c = cv.getContext('2d'), f = g.forge, W = cv.width, H = cv.height;
        c.fillStyle = '#100b08'; c.fillRect(0, 0, W, H);
        const bx = 20, bw = W - 40, bh = 26;
        if (f.phase === 'heat') {
            const by = 78, span = f.window[1] * 1.35;
            c.fillStyle = '#1a1310'; c.fillRect(bx, by, bw, bh);
            c.fillStyle = 'rgba(201,162,39,0.30)';
            c.fillRect(bx + bw * (f.window[0] / span), by - 6, bw * ((f.window[1] - f.window[0]) / span), bh + 12);
            const hg = c.createLinearGradient(bx, 0, bx + bw, 0);
            hg.addColorStop(0, '#3a1a10'); hg.addColorStop(0.55, '#c9622a'); hg.addColorStop(1, '#fff3c4');
            c.fillStyle = hg; c.fillRect(bx, by, bw * clamp(f.temp / span, 0, 1), bh);
            c.fillStyle = '#e8e0cc'; c.font = '11px monospace';
            c.fillText(Math.round(f.temp) + '°C', bx, by - 14);
            c.fillStyle = '#8fa38f'; c.font = '10px monospace';
            c.fillText('band ' + f.window[0] + '–' + f.window[1] + '°C', bx, by + bh + 16);
            if (f.temp > f.window[1]) { c.fillStyle = '#b8514a'; c.fillText('over-worked', bx, by + bh + 30); }
        } else {
            const by = 86;
            c.fillStyle = '#1a1310'; c.fillRect(bx, by, bw, bh);
            c.fillStyle = 'rgba(90,143,184,0.35)';
            c.fillRect(bx + bw * f.sweet[0], by, bw * (f.sweet[1] - f.sweet[0]), bh);
            c.fillStyle = '#f0d98a';
            c.fillRect(bx + bw * f.marker - 2, by - 8, 4, bh + 16);
            c.fillStyle = '#e8e0cc'; c.font = '11px monospace';
            c.fillText('quench — strike ' + (f.strike + 1) + ' / 3', bx, by - 16);
            c.fillStyle = '#8fa38f'; c.font = '10px monospace';
            c.fillText('heat ' + Math.round(f.heatScore) + '/' + HEAT_WEIGHT + (f.pulledAt ? ' (pulled at ' + f.pulledAt + '°C)' : '')
                + ' · strikes ' + Math.round(f.strikeScore) + '/' + STRIKE_WEIGHT, bx, by + bh + 18);
        }
    }

    function ensureLoop(g) {
        if (g.raf) return;
        const step = () => {
            g.raf = 0;
            if (!g.open) return;
            if (g.screen === 'angling' && g.angling) { anglingStep(g); drawAngling(g); }
            else if (g.screen === 'forge' && g.forge) { forgeStep(g); drawForge(g); }
            else if (g.screen === 'world' && g.world) {
                const before = g.screen;
                worldTick(g);
                if (g.screen !== before) { render(g); return; }
                drawWorld(g);
            }
            else if (g.screen === 'combat' && g.fight) { drawBattle(g); }
            else return;
            g.raf = requestAnimationFrame(step);
        };
        g.raf = requestAnimationFrame(step);
    }

    // ---------- render ----------
    const SCREENS = {
        // the overworld replaces the hub menu: everything the buttons used
        // to do is a thing you walk up to and press a key at
        create: screenCreate, world: screenWorld,
        combat: screenCombat, dungeon: screenDungeon,
        angling: screenAngling, forge: screenForge, forge_done: screenForgeDone,
        forge_pick: screenForgePick, event: screenEvent, dialogue: screenDialogue,
        sheet: screenSheet, skills: screenSkills, gear: screenGear, chart: screenChart,
        codex: screenCodex, factions: screenFactions, nemesis: screenNemesis, ending: screenEnding
    };
    SCREENS.angling_pick = screenAnglingPick;

    function render(g) {
        if (!g.body) return;
        const fn = SCREENS[g.screen] || screenWorld;
        const withSide = g.screen !== 'create' && g.screen !== 'ending';
        g.body.innerHTML = '<div class="et-body"><div class="et-two">' + (withSide ? sideBar(g) : '') + fn(g) + '</div></div>';
        if (['angling', 'forge', 'world', 'combat'].indexOf(g.screen) >= 0) ensureLoop(g);
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

        if (a.indexOf('screen:') === 0) {
            const target = a.slice(7);
            g.screen = target === 'angling' ? 'angling_pick' : target;
            sound('click');
            return render(g);
        }
        switch (a) {
            case 'cre+': syncCreate(g); g.create.attributes[x]++; return render(g);
            case 'cre-': syncCreate(g); g.create.attributes[x]--; return render(g);
            case 'create': return startNewGame(g);
            case 'newgame': return confirmNew(g);
            case 'export': return exportSave(g);
            case 'import': return importSave(g);
            case 'story': return startDialogue(g, x);
            case 'say': return chooseOption(g, parseInt(x, 10));
            case 'event': return resolveEvent(g, parseInt(x, 10));
            case 'voyage': return startVoyage(g);
            case 'cast': return startAngling(g, x);
            case 'cut': g.angling.over = true; g.angling.result = 'snapped'; return anglingEnd(g);
            case 'node': return enterNode(g, x);
            case 'leave': return leaveDungeon(g);
            case 'rest': return rest(g);
            case 'forge': return startForge(g, x);
            case 'forge-hit': return forgeInput(g);
            case 'travel': return travel(g, x);
            case 'attr': return spendAttribute(g, x);
            case 'skill-up': return spendSkill(g, x);
            case 'strike': case 'guard': case 'flee': case 'harpoon': case 'flare': return playerAction(g, a);
            case 'target': return playerAction(g, 'target', x);
            case 'skill': return playerAction(g, 'skill', x);
            case 'fight-done': return endFight(g);
            case 'equip': {
                const it = p.inventory.find(i => i.item_id === x) || (g.lastForged && g.lastForged.item_id === x ? g.lastForged : null);
                if (it) { if (p.inventory.indexOf(it) < 0) p.inventory.push(it); equip(g, it); save(g); }
                if (g.screen === 'forge_done') g.screen = 'world';
                return render(g);
            }
            case 'consume': {
                const idx = p.inventory.findIndex(i => i.item_id === x);
                if (idx >= 0) {
                    const it = p.inventory[idx];
                    const c = it.consumable || {};
                    if (c.hp) p.vitals.hp = Math.min(p.vitals.max_hp, p.vitals.hp + c.hp);
                    if (c.stamina) p.vitals.stamina = Math.min(p.vitals.max_stamina, p.vitals.stamina + c.stamina);
                    if (c.marrow) p.vitals.marrow_mana = Math.min(p.vitals.max_marrow_mana, p.vitals.marrow_mana + c.marrow);
                    if (c.sanity) p.vitals.sanity = clamp(p.vitals.sanity + c.sanity, 0, p.vitals.max_sanity);
                    if (c.empowerRandomSkill) {
                        const learned = Object.keys(p.skills).filter(k => p.skills[k] > 0 && p.skills[k] < 5);
                        if (learned.length) { const k = pick(g.rng, learned); p.skills[k]++; log(g, 'something in it knows ' + skillNode(k).name + ' better than you do. Rank ' + p.skills[k] + '.', 'good'); }
                    }
                    p.inventory.splice(idx, 1);
                    log(g, 'you eat the ' + it.name + '.', 'good');
                    save(g);
                }
                return render(g);
            }
            case 'socket': return socketRune(g, parseInt(x, 10));
        }
    }

    function syncCreate(g) {
        if (!g.body || !g.create) return;
        const n = g.body.querySelector('#et-name'), s = g.body.querySelector('#et-seed');
        if (n) g.create.name = n.value;
        if (s) g.create.seed = s.value;
    }

    function rest(g) {
        const p = g.p;
        advanceDay(g, 1);
        p.vitals.hp = Math.min(p.vitals.max_hp, p.vitals.hp + Math.round(p.vitals.max_hp * 0.5));
        p.vitals.stamina = p.vitals.max_stamina;
        p.vitals.marrow_mana = p.vitals.max_marrow_mana;
        p.vitals.sanity = Math.min(p.vitals.max_sanity, p.vitals.sanity + 15);
        log(g, 'you sleep until the tide turns. It is ' + (isBlackTide(p) ? 'black tide' : 'daylight, of a kind') + '.', 'good');
        const ambusher = rollAmbush(g, p.realm);
        if (ambusher) {
            log(g, ambusher.dialogue_set.intro_encounter, 'bad');
            return startFight(g, [lordToFoe(ambusher)], 'ambush');
        }
        save(g);
        render(g);
    }

    function travel(g, realmId) {
        const p = g.p;
        if (p.realms_unlocked.indexOf(realmId) < 0) return;
        p.realm = realmId;
        p.world_state.current_realm = realmId;
        advanceDay(g, 1);
        log(g, 'you make the crossing to ' + realmById(realmId).name + '.');
        const ambusher = rollAmbush(g, realmId);
        if (ambusher) {
            log(g, ambusher.dialogue_set.intro_encounter, 'bad');
            return startFight(g, [lordToFoe(ambusher)], 'ambush');
        }
        enterWorld(g, W.REALM_MAP[realmId]);
        save(g);
        render(g);
    }

    function spendAttribute(g, id) {
        const p = g.p;
        if (!p.attributes.unallocated_points) return;
        p.attributes.unallocated_points--;
        p.attributes[id]++;
        clampVitals(p);
        save(g);
        render(g);
    }
    function spendSkill(g, nodeId) {
        const p = g.p, node = skillNode(nodeId);
        if (!node || !p.skill_points || rankOf(p, nodeId) >= node.maxRank || !tierUnlocked(p, node.tier)) return;
        p.skill_points--;
        p.skills[nodeId] = rankOf(p, nodeId) + 1;
        log(g, node.name + ' rank ' + p.skills[nodeId] + '.', 'good');
        save(g);
        render(g);
    }
    function socketRune(g, runeIdx) {
        const p = g.p;
        const sel = g.body.querySelector('select[data-rune="' + runeIdx + '"]');
        if (!sel) return;
        const all = p.inventory.concat(SLOTS.map(s => p.equipment[s]).filter(Boolean));
        const item = all.find(i => i.item_id === sel.value);
        const runeId = p.runes[runeIdx];
        if (!item || !runeId) return;
        const socket = (item.sockets || []).find(s => !s.gem_id);
        if (!socket) { log(g, 'no open socket on that.', 'warn'); return render(g); }
        const rune = runeById(runeId);
        socket.gem_id = runeId;
        socket.bonus = rune.stat + ' +' + rune.value;
        p.runes.splice(runeIdx, 1);
        log(g, rune.name + ' set into ' + item.name + '.', 'good');
        save(g);
        render(g);
    }

    function exportSave(g) {
        save(g);
        const s = saves.exportSaveString();
        if (!s) { log(g, 'nothing to export.', 'warn'); return render(g); }
        if (window.showRetroDialog) {
            showRetroDialog({ title: 'save string', lines: ['copy this somewhere safe. It restores the run, the admiralty and the seed.'], preview: s, okLabel: 'done' });
        } else log(g, s);
    }
    function importSave(g) {
        const s = window.prompt ? window.prompt('paste a save string') : null;
        if (!s) return;
        const doc = saves.importSaveString(s);
        if (!doc) { log(g, 'that save string did not verify: ' + (saves.lastError || 'unreadable') + '.', 'bad'); return render(g); }
        if (loadInto(g)) { g.screen = g.ended ? 'ending' : 'world'; log(g, 'save imported.', 'good'); }
        render(g);
    }
    function confirmNew(g) {
        const go = () => { saves.clear(); g.p = null; g.ended = null; g.roster = []; g.create = freshCreate(); g.screen = 'create'; render(g); };
        if (window.showRetroDialog) {
            showRetroDialog({ title: 'abandon the run?', lines: ['the admiralty is generated from the seed. The same seed is the same twelve captains.'], okLabel: 'abandon', cancelLabel: 'stay', onOk: go });
        } else go();
    }

    // ---------- new game ----------
    function freshCreate() {
        return {
            name: 'brine diver',
            seed: String(Math.floor(Math.random() * 4294967295) >>> 0),
            attributes: { might: ATTR_START, finesse: ATTR_START, attunement: ATTR_START, fortitude: ATTR_START, perception: ATTR_START }
        };
    }

    function startNewGame(g) {
        syncCreate(g);
        const name = (g.create.name || 'brine diver').trim().slice(0, 18) || 'brine diver';
        let seed = parseInt(g.create.seed, 10);
        if (!isFinite(seed) || seed <= 0) seed = Math.floor(Math.random() * 4294967295);
        seed = seed >>> 0;

        g.rng = makeRng(seed);
        g.lordSeq = 1; g.itemSeq = 1; g.dungeonSeq = 1;
        g.p = newProfile(name, seed);
        for (const k in g.create.attributes) g.p.attributes[k] = g.create.attributes[k];
        g.p.attributes.unallocated_points = 5 - D.attributes.reduce((s, a) => s + (g.create.attributes[a.id] - ATTR_START), 0);
        g.roster = birthAdmiralty(g);
        g.ended = null;
        g.log = [];
        g.dungeon = null;

        for (const id of ['rcp_rig_hook', 'rcp_plate_vest', 'rcp_welders_hood', 'rcp_hemp_rod', 'rcp_tar_lantern']) {
            const item = makeItem(g, recipeById(id), { rarity: rarityById('sturdy'), qualityScore: 55, forged: true });
            g.p.inventory.push(item);
            if (item.slot !== 'off_hand') equip(g, item);
        }
        clampVitals(g.p);
        g.p.vitals.hp = g.p.vitals.max_hp;
        g.p.vitals.stamina = g.p.vitals.max_stamina;
        g.p.vitals.marrow_mana = g.p.vitals.max_marrow_mana;

        log(g, 'the harpoon line comes up heavy and wrong.', 'lore');
        enterWorld(g, W.REALM_MAP[g.p.realm]);
        achieve('echoes');
        bus.emit('RUN_STARTED', { seed: seed });
        save(g);
        render(g);
    }

    // ---------- boot ----------
    let current = null;

    function startEchoes() {
        if (current && current.win && document.getElementById(current.win.id)) {
            current.win.style.zIndex = (parseInt(current.win.style.zIndex, 10) || 200) + 1;
            return;
        }
        const { body, win } = createAppWindow('echoes of the tide', { icon: 'explore', width: 760 });
        const g = {
            body: body, win: win, open: true,
            p: null, roster: [], log: [], screen: 'create',
            fight: null, dungeon: null, angling: null, forge: null, dialogue: null, pendingEvent: null,
            rng: makeRng(1), lordSeq: 1, itemSeq: 1, dungeonSeq: 1, ended: null, raf: 0,
            create: freshCreate(), lastForged: null
        };
        current = g;

        body.addEventListener('click', e => onClick(g, e));
        const hold = down => e => {
            if (!e.target.closest('[data-a="reel"]')) return;
            e.preventDefault();
            if (g.angling) g.angling.holding = down;
        };
        body.addEventListener('pointerdown', hold(true));
        body.addEventListener('pointerup', hold(false));
        body.addEventListener('pointercancel', hold(false));
        body.addEventListener('pointerleave', hold(false));
        const WALK = {
            ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
            KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right'
        };
        const keyDown = e => {
            if (!g.open) return;
            const inWorld = g.screen === 'world' && g.world;
            if (inWorld && WALK[e.code]) { e.preventDefault(); g.world.held[WALK[e.code]] = true; return; }
            if (e.code !== 'Space' && e.code !== 'Enter') return;
            if (g.screen === 'angling' && g.angling) { e.preventDefault(); g.angling.holding = true; }
            else if (g.screen === 'forge' && g.forge) { e.preventDefault(); forgeInput(g); render(g); }
            else if (inWorld) { e.preventDefault(); worldInteract(g); }
        };
        const keyUp = e => {
            if (!g.open) return;
            if (WALK[e.code] && g.world) g.world.held[WALK[e.code]] = false;
            if (e.code === 'Space' && g.angling) g.angling.holding = false;
        };
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

        if (loadInto(g)) {
            log(g, 'day ' + g.p.world_state.current_day + ' in ' + realmById(g.p.realm).name + '.');
            if (g.ended) g.screen = 'ending';
            else if (g.dungeon) { enterWorld(g, W.REALM_MAP[g.p.realm]); g.screen = 'dungeon'; }
            else enterWorld(g, W.REALM_MAP[g.p.realm]);
        } else {
            g.create = freshCreate();
            g.screen = 'create';
        }
        render(g);
    }

    window.startEchoes = startEchoes;

    // the headless surface the balance run drives: everything a simulation
    // needs and nothing that touches the DOM
    window.ET_ENGINE = {
        D: D, saves: saves, bus: bus, NEMESIS_SCALE: NEMESIS_SCALE, lordById: lordById,
        makeRng: makeRng, ri: ri, pick: pick, chance: chance, clamp: clamp, weighted: weighted,
        ARMOR_K: ARMOR_K, BASE_HIT_CHANCE: BASE_HIT_CHANCE, GLANCING_WINDOW: GLANCING_WINDOW,
        GLANCING_MULTIPLIER: GLANCING_MULTIPLIER, VARIANCE: VARIANCE, CRIT_BASE_MULTIPLIER: CRIT_BASE_MULTIPLIER,
        DEPTH_SCALE: DEPTH_SCALE, ROOM_SCALE: ROOM_SCALE, AMBUSH_BASE: AMBUSH_BASE,
        AMBUSH_PER_GRUDGE: AMBUSH_PER_GRUDGE, AMBUSH_CAP: AMBUSH_CAP, TENSION_GREEN: TENSION_GREEN,
        SANITY_ILLUSION: SANITY_ILLUSION, PANIC_SKIP_CHANCE: PANIC_SKIP_CHANCE, SLOTS: SLOTS,
        XP_ANCHORS: XP_ANCHORS, xpToNext: xpToNext, LEVEL_UNLOCKS: LEVEL_UNLOCKS,
        armourMitigation: armourMitigation, computeDamage: computeDamage, resolveSwing: resolveSwing,
        elementMultiplier: elementMultiplier, skillCheck: skillCheck, sanityLoss: sanityLoss, sanityTier: sanityTier,
        maxHp: maxHp, maxStamina: maxStamina, maxMarrow: maxMarrow, armourOf: armourOf, critChance: critChance,
        critMultiplier: critMultiplier, hitRating: hitRating, dodgeRating: dodgeRating, blockValue: blockValue,
        carryCapacity: carryCapacity, itemStat: itemStat, gearStat: gearStat, allAffixes: allAffixes,
        newProfile: newProfile, makeItem: makeItem, rollRarity: rollRarity, canCraft: canCraft, craftable: craftable,
        makeLord: makeLord, birthAdmiralty: birthAdmiralty, lordToFoe: lordToFoe, refreshLordProfile: refreshLordProfile,
        promoteOnKill: promoteOnKill, tryPromote: tryPromote, lordSawYouRun: lordSawYouRun,
        lordSurvived: lordSurvived, lordDefeated: lordDefeated, ambushChance: ambushChance, rollAmbush: rollAmbush,
        foeFromTemplate: foeFromTemplate, startFight: startFight, playerAction: playerAction,
        generateDungeon: generateDungeon, dungeonNode: dungeonNode, availableNodes: availableNodes,
        pickFoeTemplate: pickFoeTemplate, applyHazard: applyHazard, gainXp: gainXp, advanceDay: advanceDay,
        anglingStep: anglingStep, rodStrengthOf: rodStrengthOf, reelSpeedOf: reelSpeedOf,
        forgeStep: forgeStep, bandFor: bandFor, dialogueBody: dialogueBody, optionAvailable: optionAvailable,
        runActions: runActions, save: save, loadInto: loadInto, log: log, clampVitals: clampVitals,
        rankOf: rankOf, skillValue: skillValue, passive: passive, tierUnlocked: tierUnlocked,
        // a read-only snapshot of where the diver is standing, so a test can
        // walk the overworld without guessing at frame timings
        where: function () {
            const s = current && current.world;
            if (!s) return null;
            return {
                screen: current.screen,
                map: s.map, x: s.x, y: s.y, dir: s.dir, steps: s.steps, walking: !!s.step,
                saying: !!s.say,
                say: s.say ? { name: s.say.name, line: s.say.lines[s.say.index] || '' } : null
            };
        }
    };
})();
