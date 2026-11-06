// ===================================================================
// DUNGEONZ 98 — every number
//
// A four seat co-op raid on the wizardz 98 engine. Three dungeons, each three
// sections of rooms with a checkpoint shrine at the end of each, then a boss.
// Kills give everyone xp, levels give picks, picks are spent at shrines on skills
// and passives. Tune here and run `node .github/scripts/check-dungeonz.mjs`, which
// plays a few hundred runs of bots and says what moved.
//
// The skills are wizardz sigils: the same twelve symbols cast them, by key or by
// drawing (wizardz-sigil.js reads the drawing, and wizardz-data.js has the glyphs).
// ===================================================================
(function () {
    'use strict';

    // ---------------------------------------------------------------
    // the run
    // ---------------------------------------------------------------
    const RUN = {
        tickHz: 20,
        snapshotHz: 20,          // straight across
        relayHz: 5,              // over the public relays
        seats: 4,                // always four. bots sit in the empty ones
        continues: 2,            // wipes the party can take before the run is over
        wipeDelay: 3,            // seconds of everybody on the floor before it counts
        countdown: 2,

        hero: {
            hp: 100, hpPerLevel: 14,
            walk: 6.2, stanceWalk: 2.4,
            radius: 0.45, height: 1.8,
            jump: 7.2, gravity: 20, step: 0.45,
            dash: { speed: 17, time: 0.2, cd: 2.4 },
            // the staff: free, and it never runs out
            bolt: { dmg: 6, perLevel: 0.6, rof: 0.33, speed: 32, range: 24, r: 0.3 },
            dmgPerLevel: 0.04   // everything you do, a bit more each level
        },
        // the ink stance: draw a skill's sigil instead of pressing its key. A clean
        // drawing is worth more, and you are slow and soft while you draw
        stance: { hurt: 1.25, power: [1.0, 1.5], floor: 0.5, top: 0.85 },
        down: { bleed: 25, revive: 2.5, reviveHp: 0.4, reach: 2.4 },
        xp: { base: 70, grow: 28 },   // xp to go from level n to n + 1: base + grow * (n - 1)
        shrine: { wait: 40, straggle: 15 },
        aggroRange: 15,
        maxAwake: 48
    };
    const xpFor = n => RUN.xp.base + RUN.xp.grow * (n - 1);

    // ---------------------------------------------------------------
    // skills: twelve wizardz sigils, rebuilt for fighting a crowd
    //
    // r: the numbers at rank 1, 2 and 3. kind decides how the sim casts it:
    //   shot     a projectile along your aim
    //   chain    hits what you aim at and jumps on
    //   strike   lands where the crosshair meets the floor, after a moment
    //   zone     a patch of floor where the crosshair is
    //   wall     a wall where the crosshair is, across your aim
    //   decoy    something for them to hit that is not you
    //   nova     round you, at once
    //   ward     a shield on you and everybody near
    //   heal     health back over a few seconds, you and everybody near
    //   blink    forward, through them
    //   missiles a few homing bolts at whatever is nearest
    // ---------------------------------------------------------------
    const SKILLS = [
        {
            id: 'fireball', name: 'fireball', kind: 'shot', el: 'fire', cd: 4,
            r: [{ dmg: 30, aoe: 2.6 }, { dmg: 40, aoe: 3 }, { dmg: 52, aoe: 3.4 }],
            speed: 26, size: 0.45,
            blurb: 'it splashes. aim at the middle of them'
        },
        {
            id: 'frostbolt', name: 'frostbolt', kind: 'shot', el: 'ice', cd: 3,
            r: [{ dmg: 22, pierce: 2, slow: 0.45, dur: 2.5 }, { dmg: 29, pierce: 3, slow: 0.5, dur: 3 }, { dmg: 37, pierce: 5, slow: 0.55, dur: 3.5 }],
            speed: 30, size: 0.35,
            blurb: 'goes through a few, and everything it touches slows down'
        },
        {
            id: 'chainlightning', name: 'chain lightning', kind: 'chain', el: 'storm', cd: 5,
            r: [{ dmg: 28, jumps: 3 }, { dmg: 35, jumps: 4 }, { dmg: 43, jumps: 6 }],
            range: 18, hop: 6.5, fall: 0.85,
            blurb: 'hits what you aim at, then whoever is standing next to it'
        },
        {
            id: 'meteor', name: 'meteor', kind: 'strike', el: 'fire', cd: 9,
            r: [{ dmg: 70, aoe: 3.4 }, { dmg: 96, aoe: 3.8 }, { dmg: 126, aoe: 4.2 }],
            range: 20, delay: 0.9,
            blurb: 'a rock, where the crosshair meets the floor, a moment later'
        },
        {
            id: 'thunderclap', name: 'thunderclap', kind: 'nova', el: 'storm', cd: 7,
            r: [{ dmg: 30, aoe: 4.5, stun: 0.8 }, { dmg: 40, aoe: 5, stun: 1 }, { dmg: 52, aoe: 5.5, stun: 1.2 }],
            push: 9,
            blurb: 'everything round you gets hit, shoved and stunned'
        },
        {
            id: 'runeward', name: 'rune ward', kind: 'ward', el: 'arcane', cd: 13,
            r: [{ shield: 34, aoe: 9, dur: 6 }, { shield: 48, aoe: 10, dur: 7 }, { shield: 64, aoe: 11, dur: 8 }],
            blurb: 'a shield on you and everybody near you'
        },
        {
            id: 'regrowth', name: 'regrowth', kind: 'heal', el: 'nature', cd: 13,
            r: [{ heal: 40, aoe: 9, dur: 5 }, { heal: 56, aoe: 10, dur: 5 }, { heal: 76, aoe: 11, dur: 5 }],
            blurb: 'health back over five seconds, for you and everybody near'
        },
        {
            id: 'blink', name: 'blink', kind: 'blink', el: 'arcane', cd: 6,
            r: [{ dist: 8, dmg: 20, aoe: 2.6, cdr: 0 }, { dist: 9, dmg: 32, aoe: 3, cdr: 1 }, { dist: 10, dmg: 46, aoe: 3.4, cdr: 2 }],
            safe: 0.45,
            blurb: 'eight metres that way, and a bang where you land'
        },
        {
            id: 'icewall', name: 'ice wall', kind: 'wall', el: 'ice', cd: 11,
            r: [{ w: 6, hp: 160, life: 7, chill: 0.3 }, { w: 7, hp: 240, life: 8, chill: 0.4 }, { w: 8, hp: 340, life: 9, chill: 0.5 }],
            range: 14,
            blurb: 'they have to go round it or through it. what touches it slows down'
        },
        {
            id: 'magicmissile', name: 'magic missile', kind: 'missiles', el: 'arcane', cd: 3.5,
            r: [{ dmg: 13, n: 3 }, { dmg: 16, n: 4 }, { dmg: 19, n: 5 }],
            range: 20, speed: 22, turn: 7,
            blurb: 'a few bolts that find somebody on their own'
        },
        {
            id: 'nightfall', name: 'nightfall', kind: 'decoy', el: 'shadow', cd: 14,
            r: [{ hp: 90, life: 5, taunt: 10, boom: 34 }, { hp: 140, life: 6, taunt: 11, boom: 50 }, { hp: 200, life: 7, taunt: 12, boom: 68 }],
            range: 12, aoe: 3.4,
            blurb: 'a shadow of you that they want to hit more. it goes off when it goes'
        },
        {
            id: 'blizzard', name: 'blizzard', kind: 'zone', el: 'ice', cd: 11,
            r: [{ dps: 15, aoe: 4, life: 4, slow: 0.3 }, { dps: 20, aoe: 4.5, life: 5, slow: 0.35 }, { dps: 26, aoe: 5, life: 6, slow: 0.4 }],
            range: 18,
            blurb: 'a patch of weather that hurts and slows whatever stands in it'
        }
    ];
    // passives: up to three of each
    const PASSIVES = [
        { id: 'ram', name: 'more ram', blurb: '+20% health', max: 3 },
        { id: 'overclock', name: 'overclock', blurb: '+12% damage, everything', max: 3 },
        { id: 'turbo', name: 'turbo button', blurb: '+10% walking speed, dash comes back sooner', max: 3 },
        { id: 'defrag', name: 'defragged', blurb: 'skills come back 12% sooner', max: 3 },
        { id: 'leech', name: 'leech staff', blurb: 'every staff bolt that lands gives you 1.5 health', max: 3 },
        { id: 'fatstaff', name: 'fat staff', blurb: '+30% staff bolt damage', max: 3 },
        { id: 'firstaid', name: 'first aid', blurb: 'you get people up 40% faster, and with more health', max: 2 }
    ];
    const MAX_SKILLS = 4;

    // ---------------------------------------------------------------
    // minions
    //
    //   hp, speed, xp, r (how wide), h (how tall)
    //   melee: reach, windup, dmg, cd        ranged: range, keep, dmg, cd, speed
    //   slam: the brute's telegraphed hit    fuse: the bomber's
    //   guard: how much a shield takes off from the front
    //   heal: the healer's mend
    // ---------------------------------------------------------------
    const MINIONS = {
        gremlin: {
            name: 'gremlin', hp: 100, speed: 5.2, xp: 6, r: 0.42, h: 1.0,
            melee: { reach: 1.4, windup: 0.35, dmg: 19, cd: 1.0 },
            blurb: 'small, fast, bites'
        },
        swarm: {
            name: 'bitrot', hp: 35, speed: 6.4, xp: 2, r: 0.3, h: 0.6,
            melee: { reach: 1.1, windup: 0.25, dmg: 9, cd: 0.8 },
            blurb: 'they come in sixes'
        },
        popup: {
            name: 'pop-up', hp: 80, speed: 3.2, xp: 8, r: 0.5, h: 1.5,
            ranged: { range: 16, keep: 9, dmg: 24, cd: 2.2, speed: 11, windup: 0.5 },
            blurb: 'keeps its distance and shoots. click it to close it'
        },
        brute: {
            name: 'brute.exe', hp: 495, speed: 2.7, xp: 24, r: 0.95, h: 2.4,
            slam: { reach: 2.2, aoe: 2.8, windup: 1.0, dmg: 61, cd: 2.6 },
            blurb: 'slow. the floor goes red before it hits'
        },
        bomber: {
            name: 'zip bomb', hp: 60, speed: 6.0, xp: 7, r: 0.4, h: 0.9,
            fuse: { reach: 2.2, aoe: 2.9, windup: 0.9, dmg: 50 },
            blurb: 'runs at you and goes off. run the other way'
        },
        shield: {
            name: 'firewall', hp: 275, speed: 3.4, xp: 14, r: 0.6, h: 1.9,
            melee: { reach: 1.6, windup: 0.45, dmg: 26, cd: 1.2 },
            guard: 0.8, arc: 1.05,
            blurb: 'shots from the front bounce off. get round the side'
        },
        healer: {
            name: 'scandisk', hp: 150, speed: 3.0, xp: 12, r: 0.5, h: 1.3,
            heal: { range: 10, amount: 40, cd: 2.0 }, keep: 11,
            blurb: 'fixes the others. kill it first'
        }
    };
    const MINION_KINDS = Object.keys(MINIONS);

    // ---------------------------------------------------------------
    // bosses, and the attacks they have
    //
    // Every attack says where it is going to hurt before it does: a red circle that
    // fills, a lane on the floor, a ring you can jump, or bolts you can see coming.
    //   slam     a circle round the boss                  r, windup, dmg
    //   rain     circles under each of you                r, windup, dmg, n
    //   lane     a line from the boss at one of you       w, len, windup, dmg
    //   ring     a ring going out along the floor. jump   speed, dmg, max
    //   volley   a fan of bolts                           n, spread, dmg, speed
    //   spiral   bolts going round, for a while           n, dur, dmg, speed, spin
    //   summon   some of the dungeon's minions            kinds, n
    // ---------------------------------------------------------------
    const ATTACKS = {
        slam: { kind: 'slam', r: 5.2, windup: 1.2, dmg: 45 },
        bigslam: { kind: 'slam', r: 7.5, windup: 1.6, dmg: 60 },
        rain: { kind: 'rain', r: 2.6, windup: 1.4, dmg: 39, n: 1 },
        rain2: { kind: 'rain', r: 2.4, windup: 1.2, dmg: 36, n: 2 },
        lane: { kind: 'lane', w: 1.6, len: 26, windup: 1.1, dmg: 51 },
        lane3: { kind: 'lane', w: 1.4, len: 26, windup: 1.2, dmg: 45, n: 3, spread: 0.5 },
        ring: { kind: 'ring', speed: 9, dmg: 33, max: 22 },
        ring2: { kind: 'ring', speed: 11, dmg: 36, max: 24, n: 2, gap: 0.8 },
        volley: { kind: 'volley', n: 5, spread: 0.7, dmg: 17, speed: 13 },
        volley9: { kind: 'volley', n: 9, spread: 1.3, dmg: 17, speed: 14 },
        spiral: { kind: 'spiral', n: 3, dur: 3, dmg: 14, speed: 10, spin: 1.9, rate: 0.16 },
        spiral5: { kind: 'spiral', n: 5, dur: 3.5, dmg: 14, speed: 11, spin: 2.2, rate: 0.16 }
    };
    const BOSSES = {
        clippy: {
            name: 'clippy the unhelpful', hp: 11000, r: 1.6, h: 4.2, speed: 2.6, xp: 0,
            look: 'clippy',
            gap: 1.6,   // seconds between attacks
            phases: [
                { at: 1, attacks: ['volley', 'slam', 'rain'], line: 'it looks like you are trying to raid a dungeon' },
                { at: 0.66, attacks: ['volley', 'slam', 'rain', 'summon'], summon: { kinds: ['gremlin', 'swarm'], n: 6 }, line: 'would you like help with that' },
                { at: 0.33, attacks: ['spiral', 'slam', 'rain2', 'ring'], line: 'i see you are trying to close me' }
            ]
        },
        trollking: {
            name: 'the troll king', hp: 20000, r: 1.9, h: 4.8, speed: 2.8, xp: 0,
            look: 'troll',
            gap: 1.4,
            phases: [
                { at: 1, attacks: ['slam', 'lane', 'volley'], line: 'problem?' },
                { at: 0.66, attacks: ['ring', 'lane', 'summon', 'rain'], summon: { kinds: ['brute', 'gremlin', 'gremlin', 'healer'], n: 4 }, line: 'u mad bradar' },
                { at: 0.33, attacks: ['ring2', 'rain2', 'spiral', 'lane3', 'bigslam'], line: 'trolololo' }
            ]
        },
        bsod: {
            name: 'the blue screen', hp: 30000, r: 2.2, h: 5.6, speed: 2.4, xp: 0,
            look: 'bsod',
            gap: 1.25,
            phases: [
                { at: 1, attacks: ['lane', 'spiral', 'volley9'], line: 'a fatal exception has occurred' },
                { at: 0.66, attacks: ['rain2', 'ring', 'summon', 'lane3'], summon: { kinds: ['bomber', 'bomber', 'healer', 'shield'], n: 5 }, line: 'press any key to continue' },
                { at: 0.33, attacks: ['lane3', 'spiral5', 'rain2', 'ring2', 'bigslam'], enrage: 0.8, line: 'your computer will restart' }
            ]
        }
    };

    // ---------------------------------------------------------------
    // the dungeons
    //
    // A dungeon is built from the run's seed: rooms in a line, gates between them, three
    // sections with a shrine after each, and the boss's room at the end. These are the
    // dials: which minions, how many, how tough, and what it looks like.
    // ---------------------------------------------------------------
    const DUNGEONS = [
        {
            id: 'bin', name: 'the recycle bin', tier: 'easy',
            blurb: 'where deleted files go to sulk. gremlins, pop-ups, and something that wants to help',
            rooms: [3, 3, 3], packs: [2, 3], pack: [4, 6],
            kinds: { gremlin: 5, swarm: 3, popup: 3, bomber: 2 },
            late: { brute: 1 },
            hpMul: 1, dmgMul: 1, grow: 0.6, elite: 0, bossDmg: 1,
            boss: 'clippy',
            theme: {
                floor: ['floor', 'floor2'], wall: 'brick', cliff: 'brick', gate: 'low',
                fog: [0.08, 0.1, 0.09], near: 8, far: 30,
                light: [0.95, 1.05, 0.95], skyMid: [0.1, 0.13, 0.11], skyTop: [0.05, 0.07, 0.06], skyHigh: [0.02, 0.03, 0.03]
            }
        },
        {
            id: 'registry', name: 'the registry', tier: 'normal',
            blurb: 'endless corridors of keys nobody understands. the troll king lives at HKEY_LOCAL_MACHINE',
            rooms: [3, 4, 4], packs: [2, 3], pack: [5, 7],
            kinds: { gremlin: 4, popup: 3, shield: 2, brute: 1, healer: 1, bomber: 2, swarm: 2 },
            late: { brute: 1, healer: 1 },
            hpMul: 1, dmgMul: 1.1, grow: 0.72, elite: 0.08, bossDmg: 1.25,
            boss: 'trollking',
            theme: {
                floor: ['chip', 'floor2'], wall: 'slab', cliff: 'slab', gate: 'low',
                fog: [0.06, 0.05, 0.12], near: 7, far: 27,
                light: [0.9, 0.9, 1.15], skyMid: [0.08, 0.06, 0.16], skyTop: [0.04, 0.03, 0.1], skyHigh: [0.02, 0.01, 0.05]
            }
        },
        {
            id: 'bsod', name: 'the blue screen', tier: 'hard',
            blurb: 'the last thing a computer sees. everything in here has been elevated to administrator',
            rooms: [4, 4, 4], packs: [3, 3], pack: [5, 8],
            kinds: { gremlin: 3, popup: 3, shield: 2, brute: 2, healer: 2, bomber: 3, swarm: 2 },
            late: { brute: 1, healer: 1, shield: 1 },
            hpMul: 1.05, dmgMul: 1.2, grow: 0.9, elite: 0.18, bossDmg: 1.5,
            boss: 'bsod',
            theme: {
                floor: ['disk', 'floor'], wall: 'low', cliff: 'low', gate: 'slab',
                fog: [0.0, 0.08, 0.32], near: 7, far: 25,
                light: [0.85, 0.95, 1.25], skyMid: [0.0, 0.1, 0.4], skyTop: [0.0, 0.06, 0.3], skyHigh: [0.0, 0.03, 0.2]
            }
        }
    ];
    const ELITE = { hp: 2.3, dmg: 1.3, xp: 2.5, size: 1.25 };
    const dungeonById = id => DUNGEONS.find(d => d.id === id) || DUNGEONS[0];

    // ---------------------------------------------------------------
    // the bots in your party. They are not the instrument here: they take the seats
    // nobody is in, and a few names make them people
    // ---------------------------------------------------------------
    const PARTY_BOTS = [
        { id: 'bogwart', name: 'bogwart', avatar: { skin: '#cfe5c0', hat: 'pointy', hatColor: '#0fa958', hair: 'none', hairColor: '#e8e8e8', beard: 'stubble', robe: 'patched', robeColor: '#0fa958', trimColor: '#c8a06a', staff: 'gnarled', familiar: 'frog', aura: 'none', eyes: 'tired' } },
        { id: 'cinder', name: 'cinder', avatar: { skin: '#f0c9a0', hat: 'wide', hatColor: '#e4485f', hair: 'long', hairColor: '#ff6b2b', beard: 'none', robe: 'trim', robeColor: '#e4485f', trimColor: '#ffb400', staff: 'orb', familiar: 'imp', aura: 'flames', eyes: 'angry' } },
        { id: 'oldgary', name: 'old gary', avatar: { skin: '#d9a066', hat: 'hood', hatColor: '#3a3a4a', hair: 'none', hairColor: '#e8e8e8', beard: 'huge', robe: 'cloak', robeColor: '#3a3a4a', trimColor: '#e8e8e8', staff: 'skull', familiar: 'owl', aura: 'shadow', eyes: 'normal' } },
        { id: 'pixel', name: 'pixel', avatar: { skin: '#b9b6d6', hat: 'crown', hatColor: '#ff67d3', hair: 'mohawk', hairColor: '#6fd6ff', beard: 'none', robe: 'layered', robeColor: '#2b8cff', trimColor: '#ff67d3', staff: 'crystal', familiar: 'bat', aura: 'sparks', eyes: 'glowing' } },
        { id: 'moss', name: 'moss', avatar: { skin: '#a86b3c', hat: 'horned', hatColor: '#c8a06a', hair: 'short', hairColor: '#3a3a4a', beard: 'braided', robe: 'ragged', robeColor: '#c8a06a', trimColor: '#0fa958', staff: 'broom', familiar: 'cat', aura: 'none', eyes: 'normal' } }
    ];
    const BOT_LINES = {
        start: ['lets go bradar', 'i will carry', 'who brought snacks', 'remember to revive me'],
        down: ['i am down bradar', 'help', 'tell my familiar i loved it', 'bradar pls'],
        up: ['thanks bradar', 'back in it', 'i was resting'],
        level: ['ding', 'level up', 'i can feel the ram'],
        boss: ['that is a big one', 'i am not scared, you are scared', 'ok this is it']
    };

    window.DZ = {
        RUN, SKILLS, PASSIVES, MAX_SKILLS, MINIONS, MINION_KINDS, ATTACKS, BOSSES, DUNGEONS, ELITE,
        PARTY_BOTS, BOT_LINES,
        xpFor, dungeonById,
        skillById: id => SKILLS.find(s => s.id === id) || null,
        passiveById: id => PASSIVES.find(p => p.id === id) || null
    };
})();
