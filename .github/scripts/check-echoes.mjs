// ===================================================================
// check-echoes.mjs — the test suite for "echoes of the tide"
//
// The game is two files: content (games/echoes-data.js) and rules
// (games/echoes.js), and a design document (games/ECHOES-GDD.md) that
// both are supposed to obey. This script is the referee.
//
//   · does every id in the content resolve? a dialogue node that points
//     at a node that does not exist is a dead end you only find by
//     walking into it mid-conversation.
//   · are the GDD's constants actually the constants in the source?
//     the document is worthless if the code quietly disagrees with it.
//   · does the nemesis system remember, mutate, scar and promote — and
//     does it stay inside its own limits (two scars, seventeen lords)?
//   · are the balance targets in GDD §7 met? this is the one that
//     matters: a 100% win rate is not a game, and neither is 5%.
//   · can a line actually land a fish, and does the wrong line snap?
//   · does a save survive the round trip through key-shortening?
//
// Run it locally with:  node .github/scripts/check-echoes.mjs
// ===================================================================
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0, checks = 0;
function ok(what) { checks++; console.log('  ok    ' + what); }
function bad(what, detail) {
    checks++; failures++;
    console.log('  FAIL  ' + what + (detail ? '\n        ' + detail : ''));
}
function expect(cond, what, detail) { cond ? ok(what) : bad(what, detail); }
function section(name) { console.log('\n== ' + name + ' =='); }

// ===================================================================
section('the game loads without a dom');
// ===================================================================
function makeWindow() {
    const store = new Map();
    const win = {
        addEventListener() { }, removeEventListener() { },
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k)
        },
        matchMedia: () => ({ matches: false, addEventListener() { } }),
        requestAnimationFrame: () => 0,
        cancelAnimationFrame: () => { }
    };
    win.window = win;
    return win;
}
const win = makeWindow();
function loadInto(w, file) {
    // eslint-disable-next-line no-new-func
    new Function('window', 'localStorage', 'document', read(file))(w, w.localStorage, undefined);
}
try { loadInto(win, 'games/echoes-data.js'); ok('games/echoes-data.js runs'); }
catch (e) { bad('games/echoes-data.js runs', e.message); }
try { loadInto(win, 'games/echoes.js'); ok('games/echoes.js runs'); }
catch (e) { bad('games/echoes.js runs', e.message); }

const D = win.ECHOES_DATA;
const E = win.ET_ENGINE;
if (!D || !E) { console.log('\nthe game did not load at all — nothing else can be checked'); process.exit(1); }
expect(typeof win.startEchoes === 'function', 'the game exposes its entry point');

// ===================================================================
section('content integrity');
// ===================================================================
const realmIds = new Set(D.realms.map(r => r.id));
const materialIds = new Set(D.materials.map(m => m.id));
const codexIds = new Set(D.codex.map(c => c.id));
const foeIds = new Set(D.bestiary.map(b => b.id).concat(D.bosses.map(b => b.id)));
const factionIds = new Set(Object.keys(D.factions));
const endingIds = new Set(D.endings.map(e => e.id));

expect(D.realms.length === 4, 'four realms', 'found ' + D.realms.length);
expect(D.realms.map(r => r.tier).join() === '1,2,3,4', 'realm tiers run 1..4');
expect(D.realms.find(r => r.id === 'leviathan_trench').pressure === 3, 'the Trench needs pressure 3');
expect(D.realms.find(r => r.id === 'drowned_spire').pressure === 5, 'the Spire needs pressure 5');
expect(factionIds.size === 3, 'three factions');
expect(D.factions.dredgers.hates === 'inquisitors' && D.factions.inquisitors.hates === 'dredgers',
    'the Dredgers and the Inquisitors will not have each other');
expect(D.attributes.length === 5 && D.attributes.map(a => a.id).join() === 'might,finesse,attunement,fortitude,perception',
    'five attributes, in the order the GDD names them');

expect(D.skillTrees.length === 3, 'three skill trees');
let treeShape = [];
for (const t of D.skillTrees) {
    if (t.nodes.length !== 8) treeShape.push(t.id + ' has ' + t.nodes.length + ' nodes');
    for (const n of t.nodes) {
        if (!Array.isArray(n.ranks) || n.ranks.length !== 5) treeShape.push(t.id + '/' + n.id + ' is not 5 ranks');
        if (!n.effect) treeShape.push(t.id + '/' + n.id + ' has no effect id');
    }
    if (!factionIds.has(t.faction)) treeShape.push(t.id + ' names an unknown faction');
}
expect(treeShape.length === 0, 'three trees of eight nodes, five ranks each', treeShape.join('\n        '));

const tiers = [1, 2, 3, 4, 5].map(t => D.materials.filter(m => m.tier === t && !m.reagent).length);
expect(tiers.every(n => n >= 1), 'a primary material at every one of the five tiers', tiers.join(','));

let refs = [];
for (const r of D.recipes) {
    for (const m in r.cost) if (!materialIds.has(m)) refs.push('recipe ' + r.id + ' costs unknown material ' + m);
    if (!['mainHand', 'offHand', 'head', 'body', 'line', 'trinket'].includes(r.slot)) refs.push('recipe ' + r.id + ' has slot ' + r.slot);
    if (r.tier < 1 || r.tier > 5) refs.push('recipe ' + r.id + ' is tier ' + r.tier);
    if (r.faction && !factionIds.has(r.faction)) refs.push('recipe ' + r.id + ' names an unknown faction');
}
for (const b of D.bestiary) if (!realmIds.has(b.realm)) refs.push('bestiary ' + b.id + ' is in unknown realm ' + b.realm);
for (const b of D.bestiary) for (const m in (b.drops || {})) if (!materialIds.has(m)) refs.push(b.id + ' drops unknown ' + m);
for (const f of D.fish) {
    if (!realmIds.has(f.realm)) refs.push('fish ' + f.id + ' is in unknown realm ' + f.realm);
    if (!D.bands.includes(f.band)) refs.push('fish ' + f.id + ' is in unknown band ' + f.band);
    if (f.enemy && !foeIds.has(f.enemy)) refs.push('fish ' + f.id + ' hooks unknown creature ' + f.enemy);
    if (f.codex && !codexIds.has(f.codex)) refs.push('fish ' + f.id + ' unlocks unknown codex ' + f.codex);
    for (const m in (f.drop || {})) if (!materialIds.has(m)) refs.push('fish ' + f.id + ' drops unknown ' + m);
    if (f.tide) for (const t of f.tide) if (!E.TIDE_PHASE.includes(t)) refs.push('fish ' + f.id + ' wants tide ' + t);
    if (f.time) for (const t of f.time) if (!E.TIME_OF_DAY.includes(t)) refs.push('fish ' + f.id + ' wants time ' + t);
}
for (const b of D.bosses) {
    if (!realmIds.has(b.realm)) refs.push('boss ' + b.id + ' is in unknown realm ' + b.realm);
    if (b.codex && !codexIds.has(b.codex)) refs.push('boss ' + b.id + ' unlocks unknown codex ' + b.codex);
    if (!b.phases || b.phases.length < 2) refs.push('boss ' + b.id + ' is not multi-phase');
}
for (const s of D.scars) if (s.immuneTo && !['burn', 'bleed', 'abyssal', 'physical'].includes(s.immuneTo)) refs.push('scar ' + s.id + ' is immune to ' + s.immuneTo);
expect(refs.length === 0, 'every id in the content resolves', refs.join('\n        '));

expect(D.bosses.length === 4, 'one multi-phase boss per realm', 'found ' + D.bosses.length);
expect(new Set(D.bosses.map(b => b.realm)).size === 4, 'the four bosses are in four different realms');
expect(D.endings.length === 4, 'four endings');
expect(D.acts.length === 4, 'four acts');

// ===================================================================
section('every conversation has a way out');
// ===================================================================
let dialogue = [];
let checkedSkills = new Set();
for (const key in D.dialogue) {
    const tree = D.dialogue[key];
    if (!tree.nodes[tree.start]) { dialogue.push(key + ' starts at a node that does not exist'); continue; }
    const seen = new Set();
    const walk = id => {
        if (seen.has(id)) return;
        seen.add(id);
        const node = tree.nodes[id];
        if (!node) { dialogue.push(key + ' points at missing node ' + id); return; }
        for (const c of node.choices || []) {
            for (const target of [c.goto, c.pass, c.fail]) if (target) walk(target);
            if (c.check) {
                checkedSkills.add(c.check.skill);
                if (typeof c.check.dc !== 'number') dialogue.push(key + '/' + id + ' has a check with no dc');
            }
            const e = c.effect || {};
            if (e.unlock && !realmIds.has(e.unlock)) dialogue.push(key + '/' + id + ' unlocks unknown realm ' + e.unlock);
            if (e.join && !factionIds.has(e.join)) dialogue.push(key + '/' + id + ' joins unknown faction ' + e.join);
            if (e.end && !endingIds.has(e.end)) dialogue.push(key + '/' + id + ' ends with unknown ending ' + e.end);
            for (const c2 of [e.codex, e.codex2]) if (c2 && !codexIds.has(c2)) dialogue.push(key + '/' + id + ' unlocks unknown codex ' + c2);
            if (e.act && (e.act < 1 || e.act > 4)) dialogue.push(key + '/' + id + ' sets act ' + e.act);
        }
    };
    walk(tree.start);
    for (const id in tree.nodes) if (!seen.has(id)) dialogue.push(key + '/' + id + ' is unreachable');
    const terminal = Object.keys(tree.nodes).some(id => !(tree.nodes[id].choices || []).length);
    if (!terminal) dialogue.push(key + ' has no terminal node');
}
expect(dialogue.length === 0, 'every dialogue node resolves and every tree terminates', dialogue.join('\n        '));
expect(['abyssal_lore', 'strength', 'bribe', 'intimidate'].every(s => checkedSkills.has(s)),
    'all four dialogue skills are actually used', [...checkedSkills].join(','));
expect(endingIds.size === 4 && [...endingIds].every(id => JSON.stringify(D.dialogue.heart).includes('"' + id + '"')),
    'all four endings are reachable from the Heart');

// ===================================================================
section('the GDD constants are the source constants');
// ===================================================================
expect(E.MITIGATION_FACTOR === 0.55, 'MitigationFactor is 0.55', String(E.MITIGATION_FACTOR));
expect(E.CRIT_CAP === 0.60 && E.CRIT_K === 120, 'crit curve is 0.60 / 120');
expect(E.DODGE_CAP === 0.35 && E.DODGE_K === 60, 'dodge curve is 0.35 / 60');
expect(E.REEL_FORCE === 1.15, 'REEL_FORCE is 1.15');

// the crit table printed in GDD §2.4
const critTable = [[8, 3.8], [20, 8.6], [40, 15.0], [60, 20.0], [120, 30.0], [240, 40.0]];
let critMiss = critTable.filter(([f, want]) => Math.abs(E.critChance(f, 0) * 100 - want) > 0.15);
expect(critMiss.length === 0, 'the crit table in the GDD is the crit curve in the code',
    critMiss.map(([f, w]) => `Finesse ${f}: doc ${w}%, code ${(E.critChance(f, 0) * 100).toFixed(1)}%`).join('\n        '));
expect(E.critMultiplier(400, 0) === 2.5, 'crit multiplier caps at 2.5');
expect(Math.abs(E.dodgeChance(20, 20) - 0.07) < 0.005, 'equal Finesse of 20 dodges 7%', String(E.dodgeChance(20, 20)));
expect(E.hitChance(1, 10000, 0.9) === 0.30 && E.hitChance(10000, 1, 0) === 0.98, 'hit chance is clamped to [30%, 98%]');
expect(E.dodgeChance(1, 1e9) < E.DODGE_CAP, 'dodge is capped below 35% however lopsided the Finesse');

// XPToNext(L) = round(50 * L^1.9), and the table in GDD §2.7
expect(E.xpToNext(1) === 50, 'XPToNext(1) is 50', String(E.xpToNext(1)));
expect(E.xpToNext(5) === 1064, 'XPToNext(5) is 1064', String(E.xpToNext(5)));
expect(E.xpToNext(10) === 3972, 'XPToNext(10) is 3972', String(E.xpToNext(10)));
let cumulative = 0;
for (let l = 1; l < 50; l++) cumulative += E.xpToNext(l);
expect(cumulative === 1415426, 'a full 1→50 run is 1,415,426 xp, as the GDD table says', String(cumulative));

// armour reduces, never deletes
const floored = E.rollDamage(() => 0.5, 20, 10, 100000, 0);
expect(floored.dmg >= floored.raw * 0.0999, 'armour can never delete more than 90% of a hit', JSON.stringify(floored));
const pierced = E.rollDamage(() => 0.5, 40, 20, 60, 0.5);
const solid = E.rollDamage(() => 0.5, 40, 20, 60, 0);
expect(pierced.dmg > solid.dmg, 'penetration halves the mitigation factor');
expect(E.elementMult('burn', { weak: ['burn'] }) === 1.5 && E.elementMult('burn', { resist: ['burn'] }) === 0.5
    && E.elementMult('burn', { immune: ['burn'] }) === 0, 'elemental multipliers are 1.5 / 0.5 / 0');

// d20: nat 20 always passes, nat 1 always fails
expect(E.d20check(() => 0.999, -100, 50).pass === true, 'a natural 20 always passes');
expect(E.d20check(() => 0, 100, 1).pass === false, 'a natural 1 always fails');

// derived values
const probe = E.newProfile('probe', 7);
probe.attributes.fortitude = 20; probe.level = 5;
expect(E.maxHp(probe) === 40 + 20 * 6 + 5 * 8, 'MaxHP = 40 + Fortitude*6 + Level*8', String(E.maxHp(probe)));
probe.attributes.attunement = 60;
expect(E.maxSanity(probe) === 120, 'MaxSanity caps at 120', String(E.maxSanity(probe)));
expect(E.carryWeight(probe) === 20 + probe.attributes.might * 2, 'CarryWeight = 20 + Might*2');
const lowAtt = E.newProfile('a', 1), highAtt = E.newProfile('b', 1);
highAtt.attributes.attunement = 60;
expect(E.sanityLoss(highAtt, 30) < E.sanityLoss(lowAtt, 30), 'Attunement resists sanity loss');

// dialogue skill derivation
const dm = E.newProfile('dm', 1);
dm.attributes.attunement = 40; dm.codex = new Array(12).fill('x');
expect(E.skillMod(dm, 'abyssal_lore') === 10 + 2, 'abyssal_lore = Attunement/4 + codex/6', String(E.skillMod(dm, 'abyssal_lore')));
dm.notoriety = 3; dm.attributes.might = 25;
expect(E.skillMod(dm, 'intimidate') === Math.floor(40 / 5) + 3, 'intimidate = max(Might,Attunement)/5 + notoriety');

// ===================================================================
section('the drowned lords remember');
// ===================================================================
function makeGame(seed) {
    return {
        p: null, roster: [], log: [], screen: 'hub',
        fight: null, dungeon: null, dredge: null, forge: null, dialogue: null,
        rng: E.makeRng(seed), lordSeq: 1, itemSeq: 1, ended: null, body: null, open: true
    };
}
const ng = makeGame(1234);
ng.p = E.newProfile('roster probe', 1234);
ng.roster = E.birthRoster(ng);
expect(ng.roster.length === 17, 'the roster is 17 lords', String(ng.roster.length));
expect(ng.roster.filter(n => n.rank === 'captain').length === 12, 'twelve captains');
expect(ng.roster.filter(n => n.rank === 'warlord').length === 4, 'four warlords');
expect(ng.roster.filter(n => n.rank === 'overlord').length === 1, 'one abyssal overlord');
expect(D.realms.every(r => ng.roster.filter(n => n.realm === r.id && n.rank === 'captain').length === 3),
    'three captains per realm');
expect(ng.roster.find(n => n.rank === 'overlord').realm === 'drowned_spire', 'the overlord is in the Spire');
expect(ng.roster.every(n => n.warCry && n.warCry.split(' ').length > 5), 'every lord has a procedural war-cry');
expect(new Set(ng.roster.map(n => n.warCry)).size > 10, 'the war-cries are not all the same line',
    String(new Set(ng.roster.map(n => n.warCry)).size) + ' distinct');
expect(ng.roster.every(n => n.$schema === 'echoes/nemesis/1'), 'every lord carries its schema version');

// the same seed births the same roster
const twin = makeGame(1234);
twin.p = E.newProfile('roster probe', 1234);
twin.roster = E.birthRoster(twin);
expect(JSON.stringify(twin.roster) === JSON.stringify(ng.roster), 'the same seed births the same roster');
const other = makeGame(999);
other.p = ng.p;
expect(JSON.stringify(E.birthRoster(other)) !== JSON.stringify(ng.roster), 'a different seed births a different roster');

// killing the player: a title, +20% hp, an armour tier, a taunt
const victim = ng.roster.find(n => n.rank === 'captain');
const hpBefore = victim.vitals.hpMultiplier, armourBefore = victim.vitals.armourTier;
E.lordKilledPlayer(ng, victim, 'burn');
expect(victim.title === D.titles.burn, 'a lord that burns you to death is titled The Kindled', String(victim.title));
expect(Math.abs(victim.vitals.hpMultiplier - hpBefore * 1.2) < 0.001, 'killing you is worth +20% max HP');
expect(victim.vitals.armourTier === armourBefore + 1, 'and one armour tier');
expect(victim.taunts.length === 1, 'and a taunt keyed to how you died');
expect(victim.memories.some(m => m.type === 'killed_player'), 'and it writes the memory down');
E.lordKilledPlayer(ng, victim, 'bleed');
expect(victim.title === D.titles.burn, 'a lord keeps the title it earned first');

// fleeing hands it a Tracker, and a Tracker is a weakness too
const runner = ng.roster.filter(n => n.rank === 'captain')[1];
E.lordSawYouRun(ng, runner);
expect(runner.traits.includes('tracker'), 'running away makes it a Tracker');
expect(runner.weaknesses.length > 0, 'and the Tracker trait writes a matching weakness');
expect(runner.status === 'hunting', 'and it goes hunting');

// scars: at most two, and every scar costs resistance elsewhere
const scarred = ng.roster.filter(n => n.rank === 'captain')[2];
let scarRolls = 0;
for (let i = 0; i < 400; i++) {
    const el = ['burn', 'bleed', 'abyssal', 'physical'][i % 4];
    if (E.lordSurvived(ng, scarred, { [el]: 100 })) scarRolls++;
}
expect(scarred.scars.length <= 2, 'a lord holds at most two scars', String(scarred.scars.length));
expect(scarRolls > 0, 'surviving one element long enough grows a scar');
const scarredStats = E.nemesisStats(scarred);
expect(scarredStats.immune.length > 0, 'a scar is a real immunity in the fight');
expect(scarredStats.backlash > 0, 'and it costs resistance to everything else');

// promotion: three wins over you takes a Warlord seat, and the incumbent remembers
const climber = ng.roster.find(n => n.rank === 'captain' && n.realm === 'rust_shallows');
const incumbent = ng.roster.find(n => n.rank === 'warlord' && n.realm === 'rust_shallows');
climber.rankProgress = 3;
E.checkPromotion(ng, climber);
expect(climber.rank === 'warlord', 'a captain with three wins over you takes the seat');
expect(incumbent.rank === 'captain', 'and the incumbent is demoted, not removed');
expect(incumbent.traits.includes('grudge'), 'and the demoted one holds a grudge');
expect(ng.roster.filter(n => n.rank === 'warlord' && n.realm === 'rust_shallows').length === 1,
    'a realm never ends up with two warlords');
expect(ng.roster.length === 17, 'the roster never grows past 17', String(ng.roster.length));

// a permanent kill is permanent; anything else comes back a rank down
const bonehero = E.newProfile('bone', 1);
bonehero.equipment.mainHand = { permanentKill: true, baseStats: {}, affixes: [], sockets: [], tier: 4 };
const g2 = makeGame(5); g2.p = bonehero; g2.roster = ng.roster;
const doomed = ng.roster.filter(n => n.rank === 'captain')[3];
expect(E.lordDefeated(g2, doomed, 'physical') === 'dead', 'a Leviathan-bone edge kills a lord for good');
expect(g2.p.notoriety === 1, 'and it counts toward notoriety');
const survivor = ng.roster.filter(n => n.rank === 'warlord')[0];
const g3 = makeGame(6); g3.p = E.newProfile('plain', 1); g3.roster = ng.roster;
E.lordDefeated(g3, survivor, 'physical');
expect(survivor.rank === 'captain' && survivor.traits.includes('poorly_drowned'),
    'anything else comes back a rank down, Poorly Drowned');

// five quiet days is progress toward a seat
const quiet = makeGame(77); quiet.p = E.newProfile('q', 77); quiet.roster = E.birthRoster(quiet);
quiet.p.clock.day = 20;
const before = quiet.roster.reduce((s, n) => s + n.rankProgress, 0);
E.rosterDayPasses(quiet);
expect(quiet.roster.reduce((s, n) => s + n.rankProgress, 0) > before, 'a lord left alone for five days gains ground');

// ===================================================================
section('balance targets (GDD §7)');
// ===================================================================
const HERO_LEVEL = { 1: 5, 2: 9, 3: 14, 4: 20 };
function buildHero(g, level, tier) {
    const p = E.newProfile('hero', 4242);
    p.level = level;
    const pts = 3 + 3 * (level - 1) + 2 * Math.floor(level / 5);
    const spread = { might: 0.34, finesse: 0.24, fortitude: 0.22, attunement: 0.12, perception: 0.08 };
    for (const k in spread) p.attributes[k] += Math.floor(pts * spread[k]);
    g.p = p;
    for (const slot of ['mainHand', 'body', 'head', 'line']) {
        const pool = D.recipes.filter(r => r.slot === slot && r.tier <= tier && !r.faction);
        if (!pool.length) continue;
        pool.sort((a, b) => b.tier - a.tier);
        p.equipment[slot] = E.makeItem(g, pool[0], 4);
    }
    // one skill point a level, spent down the Harpooner tree then Marrow-Smith
    const order = ['harpoon_throw', 'barbed', 'sure_footing', 'killing_tide', 'trophy',
        'tempering', 'anvil_stance', 'steam_vent', 'second_line', 'burn_oil'];
    let points = level;
    for (let round = 0; round < 5 && points > 0; round++) {
        for (const id of order) {
            if (points <= 0) break;
            p.skills[id] = (p.skills[id] || 0) + 1;
            points--;
        }
    }
    p.vitals.hp = E.maxHp(p); p.vitals.stamina = E.maxStamina(p); p.vitals.sanity = E.maxSanity(p);
    return p;
}
function winRate(seed, level, tier, foeFactory, n) {
    let wins = 0;
    const g = makeGame(seed);
    for (let i = 0; i < n; i++) {
        buildHero(g, level, tier);
        g.roster = [];
        g.ended = null;
        const foe = foeFactory(g, i);
        if (foe.lord) g.roster = [foe._node];
        E.startFight(g, foe, 'sim');
        let guard = 0;
        while (!g.fight.over && guard++ < 400) {
            E.playerAction(g, g.p.vitals.stamina >= 1 ? 'strike' : 'guard');
        }
        if (g.fight.result === 'won') wins++;
        g.fight = null;
    }
    return wins / n;
}
function realmFoe(realmId) {
    const pool = D.bestiary.filter(b => b.realm === realmId);
    return (g, i) => E.foeFromTemplate(pool[i % pool.length], 0);
}
function lordFoe(realmId, rank, level) {
    return (g, i) => {
        const node = E.makeLord(g, D.realms.find(r => r.id === realmId), rank);
        if (level) node.level = level;
        const foe = E.nemesisStats(node);
        foe._node = node;
        return foe;
    };
}

const N = 240;
const results = {};
for (const realm of D.realms) {
    const lvl = HERO_LEVEL[realm.tier];
    results['tier' + realm.tier] = winRate(realm.tier * 31 + 7, lvl, realm.tier, realmFoe(realm.id), N);
}
for (const k in results) console.log('       ' + k + ' level-appropriate: ' + (results[k] * 100).toFixed(1) + '%');
const appropriate = Object.values(results);
expect(appropriate.every(r => r >= 0.78 && r <= 0.94),
    'a level-appropriate encounter is 80–90% player win (tolerance 78–94)',
    Object.keys(results).map(k => k + ' ' + (results[k] * 100).toFixed(1) + '%').join(', '));

// the very first fight of a run, on the starting kit — a new player must
// not be killed by a brine wight on their first walk out of the harbour
function starterGame(seed) {
    const g = makeGame(seed);
    const p = E.newProfile('new', seed);
    p.attributes.might += 3;
    g.p = p;
    const mk = (id, q) => E.makeItem(g, D.recipes.find(r => r.id === id), q);
    p.equipment.mainHand = mk('rig_hook', 3);
    p.equipment.line = mk('tarred_line', 3);
    p.equipment.body = mk('plate_vest', 3);
    p.equipment.head = mk('welders_hood', 2);
    p.vitals.hp = E.maxHp(p); p.vitals.stamina = E.maxStamina(p); p.vitals.sanity = E.maxSanity(p);
    return g;
}
let firstWins = 0, drawn = {};
const FIRST = 400;
for (let i = 0; i < FIRST; i++) {
    const g = starterGame(1000 + i);
    const tpl = E.pickFoe(g, 'rust_shallows', 0);
    drawn[tpl.id] = (drawn[tpl.id] || 0) + 1;
    E.startFight(g, E.foeFromTemplate(tpl, 0), 'sim');
    let guard = 0;
    while (!g.fight.over && guard++ < 200) E.playerAction(g, g.p.vitals.stamina >= 1 ? 'strike' : 'guard');
    if (g.fight.result === 'won') firstWins++;
}
const firstRate = firstWins / FIRST;
console.log('       the first fight of a run: ' + (firstRate * 100).toFixed(1) + '% — ' +
    Object.keys(drawn).map(k => k + ' ' + drawn[k]).join(', '));
expect(firstRate >= 0.82, 'a level-1 dredger wins their first fight at least 82% of the time',
    (firstRate * 100).toFixed(1) + '%');
expect(firstRate < 0.99, 'but it is still a fight', (firstRate * 100).toFixed(1) + '%');
expect((drawn.brine_wight || 0) / FIRST < 0.08,
    'and the realm\'s hardest creature is rare at level 1', String(drawn.brine_wight || 0) + '/' + FIRST);

const ahead = [];
for (let t = 1; t <= 3; t++) {
    const next = D.realms.find(r => r.tier === t + 1);
    ahead.push(winRate(t * 17 + 3, HERO_LEVEL[t], t, realmFoe(next.id), N));
}
console.log('       one realm ahead: ' + ahead.map(r => (r * 100).toFixed(1) + '%').join(', '));
// the Reefs -> Trench step sits at ~22% on purpose; see GDD §7
expect(ahead.every(r => r >= 0.14 && r <= 0.62),
    'one realm ahead is a real fight, not a formality (14–62%)',
    ahead.map(r => (r * 100).toFixed(1) + '%').join(', '));

const warlord = winRate(4321, 9, 2, lordFoe('whispering_reefs', 'warlord'), N);
console.log('       a warlord at level: ' + (warlord * 100).toFixed(1) + '%');
expect(warlord >= 0.34 && warlord <= 0.64, 'a Warlord at level is 45–60% (tolerance 34–64)', (warlord * 100).toFixed(1) + '%');

const overlord = winRate(8765, 26, 5, lordFoe('drowned_spire', 'overlord', 26), N);
console.log('       the overlord, geared: ' + (overlord * 100).toFixed(1) + '%');
expect(overlord >= 0.24 && overlord <= 0.48, 'the Overlord geared is 30–40% (tolerance 24–48)', (overlord * 100).toFixed(1) + '%');

// the four bosses, each fought two levels over its realm's entry level
const bossRates = D.bosses.map(b => {
    const tier = D.realms.find(r => r.id === b.realm).tier;
    return [b.id, winRate(99 + tier, HERO_LEVEL[tier] + 2, tier, () => E.foeFromTemplate(b, 0), 120)];
});
console.log('       bosses: ' + bossRates.map(([id, r]) => id + ' ' + (r * 100).toFixed(0) + '%').join(', '));
expect(bossRates.every(([, r]) => r >= 0.38 && r <= 0.72), 'every realm boss is a coin-flip-ish fight (38–72%)',
    bossRates.map(([id, r]) => id + ' ' + (r * 100).toFixed(1) + '%').join(', '));
// the Heart's last phase must be survivable: 1 HP, four rounds of air
const heart = D.bosses.find(b => b.id === 'beacons_heart');
const lastPhase = heart.phases[heart.phases.length - 1].effect;
expect(lastPhase.setHp === 1 && lastPhase.noAttack === true && lastPhase.drownIn > 0,
    'the Heart is fought at 1 HP against a drown clock, not against its fists');

// nothing is a guaranteed win and nothing is unwinnable
expect(appropriate.concat(ahead, [warlord, overlord]).every(r => r < 1 && r > 0),
    'no encounter in the game is a certainty either way');

// ===================================================================
section('the line and the fish');
// ===================================================================
// two policies: a player who pulses the line, and a player who just holds on.
// The tackle model comes from the engine, so this cannot drift from the game.
function simDredge(g, fish, tier, might, tide, naive) {
    g.p.attributes.might = might;
    g.p.equipment.line = {
        baseStats: { lineStrength: 1 }, affixes: [], sockets: [], tier: tier,
        durability: { current: 100, max: 100 }, name: 'tier-' + tier + ' line'
    };
    const s = E.newDredgeState(g.p, fish, tide, g.rng);
    s.threshold = 1.0 + tier * 0.25;   // ignore the affix on the probe line
    g.dredge = s;
    let holding = true, t = 0;
    while (!s.over && t++ < 60 * 240) {
        if (!naive) {
            if (holding && s.tension > s.threshold * 0.75) holding = false;
            if (!holding && s.tension < s.threshold * 0.25) holding = true;
        }
        s.held = holding;
        E.dredgeStep(g);
    }
    return s.result || 'timeout';
}
const dg = makeGame(24);
dg.p = E.newProfile('angler', 24);

const cod = D.fish.find(f => f.id === 'rig_cod');
const codResults = [];
for (let i = 0; i < 25; i++) codResults.push(simDredge(dg, cod, 1, 8, 1.0));
expect(codResults.every(r => r === 'landed'), 'a rig cod on a tier-1 line is always landable',
    [...new Set(codResults)].join(','));

const angler = D.fish.find(f => f.id === 'marrow_angler');
// hold on to a trench fish with a tier-1 line and the line goes. that is the lesson.
const naiveLine = [];
for (let i = 0; i < 25; i++) naiveLine.push(simDredge(dg, angler, 1, 10, 1.25, true));
expect(naiveLine.every(r => r === 'snapped'),
    'a trench fish at high tide on a tier-1 line, held, is a snapped line',
    naiveLine.filter(r => r === 'snapped').length + '/25 snapped');
// pulse it perfectly and you still do not land it — you just do not lose the line
const badLine = [];
for (let i = 0; i < 25; i++) badLine.push(simDredge(dg, angler, 1, 10, 1.25));
expect(badLine.filter(r => r === 'landed').length === 0,
    'and no amount of feathering the line lands it on tier-1 tackle',
    JSON.stringify(badLine.reduce((a, r) => (a[r] = (a[r] || 0) + 1, a), {})));

const goodLine = [];
for (let i = 0; i < 25; i++) goodLine.push(simDredge(dg, angler, 4, 26, 1.25));
expect(goodLine.filter(r => r === 'landed').length >= 15,
    'the same fish on a tier-4 line comes up',
    goodLine.filter(r => r === 'landed').length + '/25 landed');

// the deepest thing in the game is a fight, not a catch — and it is only
// reachable on endgame tackle
const worst = D.fish.find(f => f.id === 'fishing_back');
const worstEnd = [], worstMid = [];
for (let i = 0; i < 15; i++) worstEnd.push(simDredge(dg, worst, 4, 30, 1.25));
for (let i = 0; i < 15; i++) worstMid.push(simDredge(dg, worst, 2, 18, 1.25));
expect(worstEnd.every(r => r === 'landed'), 'the eldritch band comes up on endgame tackle, played well',
    JSON.stringify(worstEnd.reduce((a, r) => (a[r] = (a[r] || 0) + 1, a), {})));
expect(worstMid.every(r => r !== 'landed'), 'and never on a tier-2 line, however well it is played',
    JSON.stringify(worstMid.reduce((a, r) => (a[r] = (a[r] || 0) + 1, a), {})));
expect(D.fish.filter(f => f.band === 'eldritch').every(f => !!f.enemy),
    'every eldritch entry is an encounter, not a catch');

// tide and time actually gate the tables
const tg = makeGame(3); tg.p = E.newProfile('tider', 3);
tg.p.realm = 'rust_shallows';
const seenByTime = new Set();
for (let tick = 0; tick < 8; tick++) {
    tg.p.clock.tick = tick;
    for (let i = 0; i < 60; i++) seenByTime.add(E.tidePhase(tg.p) + '/' + E.timeOfDay(tg.p) + '/' + E.pickFish(tg).id);
}
const lampreyWindows = [...seenByTime].filter(s => s.endsWith('marrow_lamprey'));
expect(lampreyWindows.length > 0 && lampreyWindows.every(s => s.startsWith('high/')),
    'the marrow lamprey only comes up at high tide, at night',
    lampreyWindows.join(' '));
expect(E.TIME_OF_DAY.length === 8 && E.TIDE_PHASE.length === 4, 'eight ticks a day, four tide phases');

// ===================================================================
section('a save survives the round trip');
// ===================================================================
const sg = makeGame(555);
sg.p = E.newProfile('saver', 555);
sg.roster = E.birthRoster(sg);
sg.p.equipment.mainHand = E.makeItem(sg, D.recipes.find(r => r.id === 'chitin_spear'), 5);
sg.p.equipment.mainHand.sockets[0].runeId = 'rune_marrow';
sg.p.inventory.push(E.makeItem(sg, D.recipes.find(r => r.id === 'rig_hook'), 0));
sg.p.skills.tempering = 3;
sg.p.materials.leviathan_bone = 7;
E.lordKilledPlayer(sg, sg.roster[0], 'abyssal');

// save() shortens the profile and the roster separately — the wrapper
// keys stay long, because a single-letter wrapper key would collide
// with the short codes on the way back
const shortP = E.remap(sg.p, E.KEYMAP), shortN = E.remap(sg.roster, E.KEYMAP);
expect(JSON.stringify(E.remap(shortP, E.UNMAP)) === JSON.stringify(sg.p), 'the profile comes back byte-identical');
expect(JSON.stringify(E.remap(shortN, E.UNMAP)) === JSON.stringify(sg.roster), 'so does the roster');
const longJson = JSON.stringify({ p: sg.p, n: sg.roster }).length;
const shortJson = JSON.stringify({ p: shortP, n: shortN }).length;
expect(shortJson < longJson, 'key-shortening actually shortens it',
    longJson + ' -> ' + shortJson + ' bytes (' + Math.round((1 - shortJson / longJson) * 100) + '% off)');
expect(shortJson < 5 * 1024 * 1024, 'a full save is nowhere near the LocalStorage budget', shortJson + ' bytes');
expect(sg.p.$schema === 'echoes/player/1' && sg.p.equipment.mainHand.$schema === 'echoes/item/1',
    'the profile and its items carry their schema versions');
expect(read('games/echoes.js').includes("SAVE_SCHEMA = 'echoes/save/1'") &&
    read('games/echoes.js').includes("SAVE_KEY + '-unreadable'"), 'an unknown save version is kept, not half-read');

// ===================================================================
section('forge quality maps to rarity');
// ===================================================================
const fg = makeGame(11); fg.p = E.newProfile('smith', 11);
const spear = D.recipes.find(r => r.id === 'chitin_spear');
const rarityByQuality = {};
for (let q = 0; q <= 6; q++) rarityByQuality[q] = E.makeItem(fg, spear, q).rarity;
expect(rarityByQuality[0] === 'cursed' && rarityByQuality[1] === 'cursed', 'quality 0–1 is Cursed');
expect([2, 3, 4].every(q => rarityByQuality[q] === 'standard'), 'quality 2–4 is Standard');
expect([5, 6].every(q => rarityByQuality[q] === 'masterwork'), 'quality 5–6 is Masterwork');
const mw = E.makeItem(fg, spear, 6), cu = E.makeItem(fg, spear, 0);
expect(mw.affixes.length === 3 && mw.sockets.length === 2, 'a Masterwork has three affixes and two sockets');
expect(cu.sockets.length === 0 && cu.affixes.filter(a => a.curse).length === 1,
    'a Cursed piece has no sockets and exactly one curse');
expect(cu.affixes.filter(a => !a.curse).length === 1, 'and exactly one good affix — at Masterwork strength');
expect(E.makeItem(fg, spear, 6).baseStats.damage > E.makeItem(fg, spear, 0).baseStats.damage,
    'a better quench is a better weapon');

// resonance: two runes in one item beat one rune each in two
const twoIn = E.makeItem(fg, spear, 6);
twoIn.sockets[0].runeId = 'rune_marrow'; twoIn.sockets[1].runeId = 'rune_marrow';
const oneIn = E.makeItem(fg, spear, 6);
oneIn.sockets[0].runeId = 'rune_marrow';
const runeBase = D.runes.find(r => r.id === 'rune_marrow').base;
expect(E.itemStat(twoIn, 'damage') - twoIn.baseStats.damage > 2 * runeBase,
    'two runes in one item are worth more than two runes apart (resonance)');

// ===================================================================
section('wired into the desktop');
// ===================================================================
const sw = read('sw.js');
expect(sw.includes("'/games/echoes-data.js'") && sw.includes("'/games/echoes.js'"), 'the service worker precaches both game files');
expect(/CACHE = 'mrhakan98-v(\d+)'/.test(sw), 'the cache name is versioned');
const extras = read('extras.js');
expect(extras.includes('function openEchoes') && extras.includes("load('games/echoes-data.js')"),
    'extras.js lazy-loads the game');
expect(extras.includes("'echoes of the tide'"), 'the game is in find:files');
const indexJs = read('index.js');
expect(/echoes:\s*\(\)\s*=>\s*openEchoes\(\)/.test(indexJs), 'the desktop icon opens it');
expect(['echoes', 'tide', 'rpg', 'leviathan'].every(a => indexJs.includes("'" + a + "'")),
    'the run box knows its aliases');
expect(read('index.html').includes("startMenuAction('echoes')"), 'it is in the start menu');
const fun = read('fun.js');
const achievementIds = ['echoes', 'echoes-ten', 'echoes-lord', 'echoes-boss', 'echoes-masterwork',
    'echoes-relic', 'echoes-faction', 'echoes-codex', 'echoes-end'];
const missing = achievementIds.filter(id => !new RegExp("'?" + id.replace(/-/g, '\\-') + "'?\\s*:").test(fun));
expect(missing.length === 0, 'every achievement the game unlocks exists in fun.js', missing.join(', '));
expect(read('games/ECHOES-GDD.md').length > 10000, 'the design document is in the repo');

// ===================================================================
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.log(`${failures} failing`); process.exit(1); }
