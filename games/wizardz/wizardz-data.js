// ===================================================================
// WIZARDZ 98 — content: 50 spells, their sigils, the arena, the bots
//
// This is a third person shooter now, and a sigil is how you load your
// staff. Everything with a number in it lives here, so the balance can
// be tuned without reading the rules. check-wizardz.mjs plays a few
// thousand bot matches against these numbers and fails if a spell turns
// out to win everything or to win nothing.
//
// The sigils are stroke templates in a 0..100 box. The recogniser ignores
// stroke order, direction, size and angle, which is a promise that costs
// something here: two symbols may not be rotations of each other. There is
// no up arrow next to a right arrow. check-sigils.mjs draws each one badly a
// few hundred times and holds the confusion matrix to its targets.
//
// Rules for a new symbol: three strokes or fewer unless it really earns it,
// drawable with a thumb, and it has to look like what it does.
//
// Units are metres and seconds. Rules are in wizardz-sim.js.
// ===================================================================
(function () {
    'use strict';

    // ---------------------------------------------------------------
    // geometry helpers — sigils are written with these, not by hand
    // ---------------------------------------------------------------
    const P = (x, y) => ({ x, y });

    function LINE(x1, y1, x2, y2, n) {
        n = n || 14;
        const s = [];
        for (let i = 0; i <= n; i++) { const t = i / n; s.push(P(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)); }
        return s;
    }
    function PATH(v, per) {
        per = per || 9;
        const s = [];
        for (let i = 0; i < v.length - 1; i++) {
            for (let j = 0; j < per; j++) {
                const t = j / per;
                s.push(P(v[i][0] + (v[i + 1][0] - v[i][0]) * t, v[i][1] + (v[i + 1][1] - v[i][1]) * t));
            }
        }
        s.push(P(v[v.length - 1][0], v[v.length - 1][1]));
        return s;
    }
    const CLOSED = (v, per) => PATH(v.concat([v[0]]), per);
    function ARC(cx, cy, r, a0, a1, steps) {
        steps = steps || 30;
        const s = [];
        for (let i = 0; i <= steps; i++) {
            const a = (a0 + (a1 - a0) * i / steps) * Math.PI / 180;
            s.push(P(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
        }
        return s;
    }
    const CIRCLE = (cx, cy, r) => ARC(cx, cy, r, -90, 270, 40);
    function QUAD(x0, y0, cx, cy, x1, y1, steps) {
        steps = steps || 18;
        const s = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps, u = 1 - t;
            s.push(P(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1));
        }
        return s;
    }
    function POLY(cx, cy, r, sides, rot) {
        const v = [];
        for (let i = 0; i < sides; i++) {
            const a = ((rot || 0) + i * 360 / sides) * Math.PI / 180;
            v.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        return CLOSED(v);
    }
    // the star you draw without lifting: every second point of a pentagon
    function PENTAGRAM(cx, cy, r, rot) {
        const v = [];
        for (let i = 0; i < 5; i++) {
            const a = ((rot || 0) + i * 144) * Math.PI / 180;
            v.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        return CLOSED(v, 8);
    }
    function ZIG(x1, y1, x2, y2, teeth, amp) {
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
        const px = -dy / len, py = dx / len;
        const n = teeth * 2;
        const v = [];
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            const off = i === 0 || i === n ? 0 : (i % 2 ? amp : -amp);
            v.push([x1 + dx * t + px * off, y1 + dy * t + py * off]);
        }
        return PATH(v, 7);
    }
    function WAVE(x1, y1, x2, y2, humps, amp, steps) {
        steps = steps || 48;
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
        const px = -dy / len, py = dx / len;
        const s = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps, off = Math.sin(t * Math.PI * 2 * humps) * amp;
            s.push(P(x1 + dx * t + px * off, y1 + dy * t + py * off));
        }
        return s;
    }
    function SPIRAL(cx, cy, r0, r1, turns, steps) {
        steps = steps || 60;
        const s = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps, a = t * turns * 2 * Math.PI, r = r0 + (r1 - r0) * t;
            s.push(P(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
        }
        return s;
    }
    function LEMNISCATE(cx, cy, a, steps) {
        steps = steps || 64;
        const s = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps * Math.PI * 2, d = 1 + Math.sin(t) * Math.sin(t);
            s.push(P(cx + a * Math.cos(t) / d, cy + a * Math.sin(t) * Math.cos(t) / d));
        }
        return s;
    }
    function RAYS(cx, cy, r0, r1, n, rot) {
        const out = [];
        for (let i = 0; i < n; i++) {
            const a = ((rot || 0) + i * 360 / n) * Math.PI / 180;
            out.push(LINE(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, 8));
        }
        return out;
    }

    // ---------------------------------------------------------------
    // elements — colour, and the flavour each one leans on
    // ---------------------------------------------------------------
    const EL = {
        fire: { name: 'fire', color: '#ff6b2b', glow: '#ffb347', about: 'splash and burns. it keeps hurting after you stop looking' },
        ice: { name: 'ice', color: '#6fd6ff', glow: '#bff0ff', about: 'slows you down and ruins your plans' },
        storm: { name: 'storm', color: '#ffe14d', glow: '#fff5b0', about: 'fast, cheap, and it eats their ink' },
        arcane: { name: 'arcane', color: '#c08cff', glow: '#e6d2ff', about: 'homing, wards and tricks' },
        nature: { name: 'nature', color: '#7ee06a', glow: '#c8f5bf', about: 'holds you still and heals itself' },
        shadow: { name: 'shadow', color: '#a074d8', glow: '#d4bdf0', about: 'weakens, drains and lies to you' },
        light: { name: 'light', color: '#ffe9a8', glow: '#fffbe8', about: 'shields, heals and pillars from above' },
        earth: { name: 'earth', color: '#c8a06a', glow: '#e8d3b0', about: 'moves the arena about. mind your feet' },
        blood: { name: 'blood', color: '#e4485f', glow: '#ff9aa8', about: 'pay in health, hit harder' },
        void: { name: 'void', color: '#b04dff', glow: '#e0b3ff', about: 'expensive, unfair and goes through walls' }
    };

    // ---------------------------------------------------------------
    // THE FIFTY
    //
    // kind says what the spell does when the ink dries:
    //   shot    goes in the staff. fire it at the crosshair
    //   beam    goes in the staff. hits instantly along the crosshair
    //   strike  goes in the staff. falls from above where you point, late
    //   wall    goes in the staff. stands where you point, across your aim
    //   zone    goes in the staff. a patch of ground where you point
    //   trap    goes in the staff. waits on the ground where you point
    //   summon  goes in the staff. something that fights for you
    //   nova    goes off at once, around you
    //   self    goes off at once, on you
    //   move    goes off at once, moves you
    //
    // cost is ink, hp is health paid up front, cd is seconds before you can
    // inscribe it again, charges is how many shots a clean drawing loads.
    // ---------------------------------------------------------------
    const SPELLS = [
        // ---------------- fire: triangles, the shape of a flame ----------------
        {
            id: 'fireball', name: 'fireball', el: 'fire', kind: 'shot',
            cost: 15, cd: 3, dmg: 14, charges: 2,
            blurb: 'the one everybody learns first. it splashes, so aim at their feet bradar.',
            p: { speed: 30, r: 0.45, aoe: 2.6, splash: 0.55, burn: { dps: 3, dur: 2.5 } },
            glyph: [CLOSED([[50, 8], [94, 86], [6, 86]])]
        },
        {
            id: 'flamelance', name: 'flame lance', el: 'fire', kind: 'shot',
            cost: 13, cd: 3.5, dmg: 27, charges: 1,
            blurb: 'a very fast spear. goes through walls and through whoever is behind them.',
            p: { speed: 70, r: 0.35, pierce: true, burn: { dps: 2, dur: 2 } },
            glyph: [LINE(50, 98, 50, 6), PATH([[24, 36], [50, 6], [76, 36]])]
        },
        {
            id: 'inferno', name: 'inferno', el: 'fire', kind: 'zone',
            cost: 28, cd: 11, dmg: 0, charges: 1,
            blurb: 'sets a patch of floor on fire and leaves it there. good on an altar.',
            p: { r: 4.5, dur: 5, dps: 8, range: 26, burn: { dps: 2, dur: 1.5 } },
            glyph: [CLOSED([[50, 4], [96, 90], [4, 90]]), CLOSED([[50, 42], [70, 78], [30, 78]])]
        },
        {
            id: 'emberward', name: 'ember ward', el: 'fire', kind: 'self',
            cost: 17, cd: 11, dmg: 0,
            blurb: 'a hot shield. whoever breaks it gets burned for the privilege.',
            p: { shield: 22, dur: 9, thorns: 7 },
            glyph: [CLOSED([[50, 3], [93, 40], [93, 97], [7, 97], [7, 40]], 8), LINE(7, 40, 93, 40)]
        },
        {
            id: 'meteor', name: 'meteor', el: 'fire', kind: 'strike',
            cost: 30, cd: 12, dmg: 38, charges: 1,
            blurb: 'a rock out of the sky, a second and a half late. lead them or herd them.',
            p: { delay: 1.5, r: 4.2, range: 42, burn: { dps: 3, dur: 3 } },
            glyph: [CIRCLE(34, 66, 28), LINE(54, 46, 96, 4)]
        },

        // ---------------- ice: straight lines and crystals ----------------
        {
            id: 'frostbolt', name: 'frostbolt', el: 'ice', kind: 'shot',
            cost: 9, cd: 2.5, dmg: 13, charges: 3,
            blurb: 'cheap, cold, and it takes the spring out of their step.',
            p: { speed: 50, r: 0.35, status: { k: 'chill', dur: 3 } },
            glyph: [LINE(50, 4, 50, 96), LINE(10, 27, 90, 73), LINE(10, 73, 90, 27)]
        },
        {
            id: 'icewall', name: 'ice wall', el: 'ice', kind: 'wall',
            cost: 13, cd: 9, dmg: 0, charges: 1,
            blurb: 'a slab of ice where you point. instant cover, and your own shots go through.',
            p: { w: 8, d: 0.8, h: 3.4, hp: 70, dur: 10, range: 22 },
            glyph: [CLOSED([[3, 32], [97, 32], [97, 68], [3, 68]])]
        },
        {
            id: 'blizzard', name: 'blizzard', el: 'ice', kind: 'zone',
            cost: 24, cd: 12, dmg: 0, charges: 1,
            blurb: 'a parked storm. cold, slow and hard to see through. rude.',
            p: { r: 7, dur: 5.5, dps: 3, range: 30, obscure: true, status: { k: 'chill', dur: 1 } },
            glyph: [PATH([[44, 54], [62, 54], [62, 32], [24, 32], [24, 76], [86, 76], [86, 8], [4, 8]], 7)]
        },
        {
            id: 'deepfreeze', name: 'deep freeze', el: 'ice', kind: 'shot',
            cost: 18, cd: 13, dmg: 6, charges: 1,
            blurb: 'a slow crystal. if it lands they cannot move, shoot or draw for a moment.',
            p: { speed: 24, r: 0.65, status: { k: 'freeze', dur: 1.7 } },
            glyph: [CLOSED([[50, 2], [76, 50], [50, 98], [24, 50]])]
        },
        {
            id: 'hailstorm', name: 'hailstorm', el: 'ice', kind: 'shot',
            cost: 15, cd: 4, dmg: 8, charges: 2,
            blurb: 'a shotgun of ice lumps. close up it is unkind, far away it is weather.',
            p: { speed: 34, r: 0.28, count: 6, spread: 9, gravity: 4, status: { k: 'chill', dur: 1.2 } },
            glyph: [LINE(6, 18, 94, 18), LINE(6, 50, 94, 50), LINE(6, 82, 94, 82)]
        },

        // ---------------- storm: zigzags ----------------
        {
            id: 'spark', name: 'spark', el: 'storm', kind: 'shot',
            cost: 6, cd: 1.2, dmg: 7, charges: 4,
            blurb: 'nearly free and nearly instant. the jab, and the first thing you should learn.',
            p: { speed: 62, r: 0.25, rof: 0.22 },
            glyph: [PATH([[72, 4], [28, 44], [72, 56], [28, 96]])]
        },
        {
            id: 'chainlightning', name: 'chain lightning', el: 'storm', kind: 'beam',
            cost: 15, cd: 6, dmg: 12, charges: 1,
            blurb: 'hits instantly if you are roughly pointing at them, and rips ink out on the way.',
            p: { range: 26, width: 1.6, inkBurn: 10, status: { k: 'shock', dur: 2.5 } },
            glyph: [ZIG(4, 50, 96, 50, 4, 30)]
        },
        {
            id: 'thunderclap', name: 'thunderclap', el: 'storm', kind: 'nova',
            cost: 17, cd: 9, dmg: 16,
            blurb: 'a bang around you. shoves them off, stuns them, and buys you a second.',
            p: { r: 7, knock: 11, status: { k: 'stun', dur: 0.8 } },
            glyph: [ARC(4, 50, 22, -70, 70, 12), ARC(4, 50, 52, -60, 60), ARC(4, 50, 88, -38, 38)]
        },
        {
            id: 'staticfield', name: 'static field', el: 'storm', kind: 'self',
            cost: 15, cd: 12, dmg: 0,
            blurb: 'a crackling bubble that swats small projectiles out of the air.',
            p: { shield: 16, dur: 7, zap: true },
            glyph: [LINE(32, 4, 32, 96), LINE(68, 4, 68, 96), LINE(4, 32, 96, 32), LINE(4, 68, 96, 68)]
        },
        {
            id: 'overload', name: 'overload', el: 'storm', kind: 'self',
            cost: 4, cd: 15, dmg: 0,
            blurb: 'press the power button. triple ink for six seconds, and it cooks you slowly.',
            p: { status: { k: 'overload', dur: 6, dps: 1.6 } },
            glyph: [ARC(50, 54, 42, -38, 218), LINE(50, 0, 50, 58)]
        },

        // ---------------- arcane: circles and tricks ----------------
        {
            id: 'magicmissile', name: 'magic missile', el: 'arcane', kind: 'shot',
            cost: 12, cd: 3.5, dmg: 7, charges: 3,
            blurb: 'it follows them round corners. no aiming, not much damage, no excuses.',
            p: { speed: 19, r: 0.32, homing: 3.2, life: 4 },
            glyph: [PATH([[14, 8], [50, 50], [14, 92]]), PATH([[52, 8], [88, 50], [52, 92]])]
        },
        {
            id: 'arcaneorb', name: 'arcane orb', el: 'arcane', kind: 'shot',
            cost: 21, cd: 7, dmg: 30, charges: 1,
            blurb: 'a slow fat orb. easy to see coming, awful to be near when it goes off.',
            p: { speed: 15, r: 1, aoe: 4.6, splash: 0.65, life: 6 },
            glyph: [CIRCLE(50, 50, 47)]
        },
        {
            id: 'manawell', name: 'mana well', el: 'arcane', kind: 'zone',
            cost: 1, cd: 18, dmg: 0, charges: 1,
            blurb: 'a puddle of free ink for whoever drew it. you do have to stand in it.',
            p: { r: 3, dur: 8, inkPerSec: 16, range: 10, ownerOnly: true },
            glyph: [PATH([[2, 12], [28, 86], [72, 86], [98, 12]], 10)]
        },
        {
            id: 'runeward', name: 'rune ward', el: 'arcane', kind: 'self',
            cost: 19, cd: 14, dmg: 0,
            blurb: 'plain honest shielding, in the shape of a window. it says no.',
            p: { shield: 23, dur: 10 },
            glyph: [CLOSED([[6, 6], [94, 6], [94, 94], [6, 94]]), LINE(50, 6, 50, 94), LINE(6, 50, 94, 50)]
        },
        {
            id: 'blink', name: 'blink', el: 'arcane', kind: 'move',
            cost: 9, cd: 6, dmg: 0,
            blurb: 'the mouse pointer. you are suddenly over there, and spells go through you on the way.',
            p: { dist: 13, phase: 0.45 },
            glyph: [CLOSED([[18, 3], [18, 84], [40, 64], [56, 97], [72, 90], [56, 58], [84, 58]], 6)]
        },

        // ---------------- nature: curves that grow ----------------
        {
            id: 'vinewhip', name: 'vine whip', el: 'nature', kind: 'beam',
            cost: 11, cd: 6, dmg: 12, charges: 1,
            blurb: 'grabs an ankle and drags them to you. short reach, very rude.',
            p: { range: 17, width: 1.1, pull: 10, status: { k: 'root', dur: 0.8 } },
            glyph: [WAVE(4, 50, 96, 50, 1.5, 28)]
        },
        {
            id: 'thornburst', name: 'thorn burst', el: 'nature', kind: 'trap',
            cost: 11, cd: 7, dmg: 22, charges: 2,
            blurb: 'plant a star of thorns. nearly invisible, and it holds whoever walks on it.',
            p: { r: 1.8, aoe: 2.6, dur: 28, range: 24, status: { k: 'root', dur: 1.6 } },
            glyph: [PENTAGRAM(50, 54, 50, -90)]
        },
        {
            id: 'regrowth', name: 'regrowth', el: 'nature', kind: 'self',
            cost: 18, cd: 12, dmg: 0,
            blurb: 'twenty two health, slowly, while you get on with things. a leaf, with a stalk.',
            p: { heal: 22, over: 6 },
            glyph: [QUAD(14, 86, 8, 22, 88, 12), QUAD(14, 86, 78, 92, 88, 12), LINE(2, 98, 62, 38)]
        },
        {
            id: 'entangle', name: 'entangle', el: 'nature', kind: 'shot',
            cost: 13, cd: 9, dmg: 10, charges: 1,
            blurb: 'a seed that roots them where they stand. then you take your time.',
            p: { speed: 34, r: 0.7, status: { k: 'root', dur: 2.6 } },
            glyph: [SPIRAL(50, 50, 4, 47, 2.25)]
        },
        {
            id: 'pollenveil', name: 'pollen veil', el: 'nature', kind: 'zone',
            cost: 8, cd: 11, dmg: 0, charges: 1,
            blurb: 'a cloud of spores. you cannot see in, and whoever is inside cannot see at all.',
            p: { r: 5.5, dur: 8, range: 28, obscure: true, status: { k: 'blind', dur: 1.5 } },
            glyph: [CIRCLE(28, 28, 22), CIRCLE(76, 36, 22), CIRCLE(44, 78, 22)]
        },

        // ---------------- shadow: moons and eyes ----------------
        {
            id: 'shadowbolt', name: 'shadow bolt', el: 'shadow', kind: 'shot',
            cost: 10, cd: 3.5, dmg: 16, charges: 2,
            blurb: 'hits, and takes the sting out of whatever they do next.',
            p: { speed: 42, r: 0.4, status: { k: 'weak', dur: 4 } },
            glyph: [ARC(46, 50, 46, 60, 300), ARC(66, 50, 32, 110, 250)]
        },
        {
            id: 'curse', name: 'curse', el: 'shadow', kind: 'shot',
            cost: 11, cd: 8, dmg: 8, charges: 1,
            blurb: 'marks them. they take a third more from everything and the fog stops hiding them.',
            p: { speed: 24, r: 0.55, homing: 2.6, status: { k: 'mark', dur: 7 } },
            glyph: [LINE(8, 8, 92, 92), LINE(92, 8, 8, 92)]
        },
        {
            id: 'drainlife', name: 'drain life', el: 'shadow', kind: 'beam',
            cost: 15, cd: 6, dmg: 17, charges: 1,
            blurb: 'instant, and most of what it takes ends up in you.',
            p: { range: 24, width: 0.9, lifesteal: 0.8 },
            glyph: [PATH([[14, 8], [86, 8], [14, 92], [86, 92], [14, 8]])]
        },
        {
            id: 'nightfall', name: 'nightfall', el: 'shadow', kind: 'summon',
            cost: 13, cd: 11, dmg: 0, charges: 1,
            blurb: 'a decoy of you walks off that way, and you go dark for a few seconds. it eats one spell.',
            p: { type: 'decoy', dur: 8, hp: 1, range: 16, stealth: 3 },
            glyph: [QUAD(2, 50, 50, -6, 98, 50), QUAD(2, 50, 50, 106, 98, 50), CIRCLE(50, 50, 11)]
        },
        {
            id: 'banish', name: 'banish', el: 'shadow', kind: 'shot',
            cost: 9, cd: 11, dmg: 14, charges: 1,
            blurb: 'wipes a ward and every buff off whoever it hits, and clears walls and traps it lands on.',
            p: { speed: 40, r: 0.5, aoe: 3.5, splash: 0, dispel: true },
            glyph: [CIRCLE(50, 50, 42), LINE(8, 92, 92, 8)]
        },

        // ---------------- light: things from above ----------------
        {
            id: 'smite', name: 'smite', el: 'light', kind: 'strike',
            cost: 13, cd: 4, dmg: 25, charges: 1,
            blurb: 'a thin pillar of light, half a second after you ask. hits harder if they are hurting already.',
            p: { delay: 0.55, r: 1.9, range: 40, punish: 1.5 },
            glyph: [LINE(4, 12, 96, 12), LINE(50, 12, 50, 98)]
        },
        {
            id: 'radiance', name: 'radiance', el: 'light', kind: 'nova',
            cost: 15, cd: 10, dmg: 14,
            blurb: 'a flash round you. burns off your own curses and blinds whoever was looking.',
            p: { r: 6.5, selfDispel: true, status: { k: 'blind', dur: 1.8 } },
            glyph: [CLOSED([[50, 2], [92, 74], [8, 74]]), CLOSED([[50, 98], [8, 26], [92, 26]])]
        },
        {
            id: 'blessing', name: 'blessing', el: 'light', kind: 'self',
            cost: 19, cd: 12, dmg: 0,
            blurb: 'ten health now, and a quarter more damage for seven seconds.',
            p: { heal: 10, status: { k: 'focus', dur: 7 } },
            glyph: [CIRCLE(50, 26, 22), LINE(50, 48, 50, 98), LINE(20, 68, 80, 68)]
        },
        {
            id: 'sanctuary', name: 'sanctuary', el: 'light', kind: 'zone',
            cost: 14, cd: 14, dmg: 0, charges: 1,
            blurb: 'a dome. nothing of theirs gets through it, in either direction. they can still walk in.',
            p: { r: 5, dur: 7.5, range: 16, blocks: true },
            glyph: [CIRCLE(50, 50, 47), LINE(50, 3, 50, 97), LINE(3, 50, 97, 50)]
        },
        {
            id: 'judgment', name: 'judgment', el: 'light', kind: 'beam',
            cost: 21, cd: 10, dmg: 13, charges: 1,
            blurb: 'a verdict. weak on the healthy, and worth nearly half their missing health on anyone who is not.',
            p: { range: 34, width: 0.7, execute: 0.42 },
            glyph: [QUAD(12, 6, 16, 58, 50, 58), QUAD(88, 6, 84, 58, 50, 58), LINE(50, 2, 50, 98)]
        },

        // ---------------- earth: squares, and the floor ----------------
        {
            id: 'stonespike', name: 'stone spike', el: 'earth', kind: 'shot',
            cost: 13, cd: 4, dmg: 24, charges: 1,
            blurb: 'runs along the floor and comes up under them. jump and it goes straight past.',
            p: { speed: 28, r: 0.8, ground: true, life: 1.6, knockUp: 6 },
            glyph: [CLOSED([[6, 92], [6, 18], [28, 58], [50, 8], [72, 58], [94, 18], [94, 92]], 6)]
        },
        {
            id: 'boulder', name: 'boulder', el: 'earth', kind: 'shot',
            cost: 18, cd: 7, dmg: 30, charges: 1,
            blurb: 'heavy, rolls, bounces off walls, and shoves whatever it meets. walks round corners by accident.',
            p: { speed: 15, r: 1.1, roll: true, bounce: 3, knock: 12, life: 5, gravity: 18 },
            glyph: [CLOSED([[8, 8], [92, 8], [92, 92], [8, 92]])]
        },
        {
            id: 'quake', name: 'quake', el: 'earth', kind: 'nova',
            cost: 20, cd: 11, dmg: 15,
            blurb: 'hits everything standing on the floor nearby, breaks their traps. jump and it misses.',
            p: { r: 11, ground: true, breaks: true, status: { k: 'stun', dur: 0.5 } },
            glyph: [PATH([[2, 70], [26, 70], [26, 30], [50, 30], [50, 70], [74, 70], [74, 30], [98, 30]], 6)]
        },
        {
            id: 'stoneskin', name: 'stone skin', el: 'earth', kind: 'self',
            cost: 14, cd: 13, dmg: 0,
            blurb: 'everything hurts a third less for eight seconds. you do walk like a statue though.',
            p: { status: { k: 'stoneskin', dur: 8 } },
            glyph: [CLOSED([[4, 4], [96, 4], [96, 96], [4, 96]]), CLOSED([[32, 32], [68, 32], [68, 68], [32, 68]])]
        },
        {
            id: 'pillar', name: 'pillar', el: 'earth', kind: 'wall',
            cost: 8, cd: 8, dmg: 0, charges: 1,
            blurb: 'a column comes up out of the floor. cover if you point away, a lift if you point down.',
            p: { w: 2.6, d: 2.6, h: 5, hp: 110, dur: 14, range: 24 },
            glyph: [LINE(14, 6, 86, 6), LINE(14, 94, 86, 94), LINE(50, 6, 50, 94)]
        },

        // ---------------- blood: drops and hearts ----------------
        {
            id: 'bloodlance', name: 'blood lance', el: 'blood', kind: 'shot',
            cost: 2, hp: 6, cd: 3, dmg: 36, charges: 1,
            blurb: 'paid for in your own health. hits like it.',
            p: { speed: 64, r: 0.3 },
            glyph: [[].concat(QUAD(50, 2, 4, 62, 26, 84), QUAD(26, 84, 50, 104, 74, 84).slice(1), QUAD(74, 84, 96, 62, 50, 2).slice(1))]
        },
        {
            id: 'sacrifice', name: 'sacrifice', el: 'blood', kind: 'self',
            cost: 0, hp: 12, cd: 15, dmg: 0,
            blurb: 'twelve health straight into seventy five ink. no take-backs.',
            p: { ink: 75 },
            glyph: RAYS(50, 54, 0, 50, 3, -90)
        },
        {
            id: 'leech', name: 'leech', el: 'blood', kind: 'shot',
            cost: 12, cd: 9, dmg: 3, charges: 1,
            blurb: 'sticks to them for six seconds and feeds you everything it takes.',
            p: { speed: 28, r: 0.45, status: { k: 'leech', dur: 6, dps: 4, feed: true } },
            glyph: [ARC(52, 50, 46, 50, 310)]
        },
        {
            id: 'hemorrhage', name: 'hemorrhage', el: 'blood', kind: 'shot',
            cost: 14, cd: 8, dmg: 5, charges: 1,
            blurb: 'a bleed that gets worse the more they run. stand still and it nearly stops. good luck with that.',
            p: { speed: 42, r: 0.35, status: { k: 'bleed', dur: 7, dps: 1, moveDps: 6.5 } },
            glyph: [LINE(10, 32, 90, 32), LINE(10, 68, 90, 68)]
        },
        {
            id: 'bloodpact', name: 'blood pact', el: 'blood', kind: 'self',
            cost: 0, hp: 5, cd: 16, dmg: 0,
            blurb: 'eight seconds where spells cost health instead of ink, and hit a third harder.',
            p: { status: { k: 'pact', dur: 8 } },
            glyph: [[].concat(QUAD(50, 34, 26, -6, 6, 26), QUAD(6, 26, 4, 58, 50, 98).slice(1), QUAD(50, 98, 96, 58, 94, 26).slice(1), QUAD(94, 26, 74, -6, 50, 34).slice(1))]
        },

        // ---------------- void: holes in things ----------------
        {
            id: 'voidlance', name: 'void lance', el: 'void', kind: 'beam',
            cost: 17, cd: 7, dmg: 24, charges: 1,
            blurb: 'a line through everything, half a second after you fire. walls do not count.',
            p: { range: 44, width: 0.9, through: true, delay: 0.45 },
            glyph: [LINE(2, 50, 98, 50, 24)]
        },
        {
            id: 'singularity', name: 'singularity', el: 'void', kind: 'zone',
            cost: 30, cd: 16, dmg: 0, charges: 1,
            blurb: 'a hole that drags them in, chews on them and swallows spells.',
            p: { r: 6.5, dur: 4, dps: 4, pull: 4.5, eats: true, range: 28 },
            glyph: [CIRCLE(50, 50, 47), CIRCLE(50, 50, 20)]
        },
        {
            id: 'rift', name: 'rift', el: 'void', kind: 'shot',
            cost: 7, cd: 9, dmg: 10, charges: 1,
            blurb: 'tears forty ink out of them and hands you over half. a very quick V.',
            p: { speed: 56, r: 0.45, inkBurn: 40, inkGain: 24 },
            glyph: [PATH([[88, 6], [14, 50], [88, 94]], 14)]
        },
        {
            id: 'oblivion', name: 'oblivion', el: 'void', kind: 'shot',
            cost: 46, cd: 24, dmg: 46, charges: 1,
            blurb: 'the big one. crawls along, ignores walls and floors, ends arguments. run.',
            p: { speed: 8.5, r: 1.5, aoe: 5, splash: 0.7, ghost: true, homing: 0.4, life: 9 },
            glyph: [LEMNISCATE(50, 50, 50)]
        },
        {
            id: 'mirror', name: 'mirror', el: 'void', kind: 'self',
            cost: 13, cd: 12, dmg: 0,
            blurb: 'the next shot that hits you in the next six seconds goes back where it came from.',
            p: { status: { k: 'mirror', dur: 6 } },
            glyph: [[].concat(ARC(30, 50, 48, -90, 90), LINE(30, 98, 30, 2).slice(1))]
        }
    ];

    // ---------------------------------------------------------------
    // statuses — what the icons on the hud mean, and what they do
    // ---------------------------------------------------------------
    const STATUS = {
        burn: { name: 'burning', short: 'burn', color: '#ff6b2b', bad: true },
        chill: { name: 'chilled', short: 'chill', color: '#6fd6ff', bad: true },
        freeze: { name: 'frozen', short: 'ice', color: '#bff0ff', bad: true },
        shock: { name: 'shocked', short: 'shock', color: '#ffe14d', bad: true },
        stun: { name: 'stunned', short: 'stun', color: '#ffffff', bad: true },
        weak: { name: 'weakened', short: 'weak', color: '#a074d8', bad: true },
        root: { name: 'rooted', short: 'root', color: '#7ee06a', bad: true },
        blind: { name: 'blinded', short: 'blind', color: '#7ee06a', bad: true },
        bleed: { name: 'bleeding', short: 'bleed', color: '#e4485f', bad: true },
        leech: { name: 'leeched', short: 'leech', color: '#e4485f', bad: true },
        mark: { name: 'marked', short: 'mark', color: '#b04dff', bad: true },
        focus: { name: 'focused', short: 'focus', color: '#ffe9a8' },
        stoneskin: { name: 'stone skin', short: 'stone', color: '#c8a06a' },
        mirror: { name: 'mirrored', short: 'mirror', color: '#b04dff' },
        phase: { name: 'phased', short: 'phase', color: '#c08cff' },
        overload: { name: 'overloaded', short: 'over', color: '#ffe14d' },
        pact: { name: 'blood pact', short: 'pact', color: '#e4485f' },
        regen: { name: 'regrowing', short: 'heal', color: '#7ee06a' },
        stealth: { name: 'gone dark', short: 'dark', color: '#a074d8' },
        turbo: { name: 'turbo', short: 'turbo', color: '#0df259' },
        clock: { name: 'overclocked', short: 'clock', color: '#ff67d3' }
    };

    // ---------------------------------------------------------------
    // the arena and the match
    // ---------------------------------------------------------------
    const ARENA = {
        size: 64,                // metres, square, centred on the origin
        tickHz: 30,
        snapshotHz: 20,          // straight across
        relayHz: 5,              // over the public relays
        maxHp: 100, maxInk: 100,
        inkRegen: 4.5,           // per second
        inkOnHit: 5,             // the staff zap pays for your drawing
        startInk: 70,

        walk: 7, aimWalk: 4.4, stanceWalk: 2.6,
        jump: 7.4, gravity: 20, step: 0.55,
        dash: { speed: 19, time: 0.2, cd: 2.6 },
        radius: 0.45, height: 1.8,

        // the ink stance: a sigil is a reload, and you stand out in the open for it
        stance: { hurt: 1.2, slowR: 6.5, slowBy: 0.35 },

        zap: { dmg: 5, rof: 0.34, speed: 52, r: 0.22, range: 44 },
        rof: 0.5,                // between shots of whatever is in the chamber
        qualityPower: [0.8, 1.2],// how much a scrappy and a clean sigil are worth
        cleanCharge: 0.75,       // quality that loads a bonus charge

        // how a match ends. Team size decides how far you have to go
        modes: [1, 2, 3, 4],
        knockouts: { 1: 3, 2: 6, 3: 9, 4: 12 },
        ritual: 42,              // seconds with your side alone on the altar
        ritualKo: 0.25,          // share of a team's progress a knockout takes, in 1v1
        respawn: 3, spawnSafe: 1.5,
        countdown: 3,
        fogAt: 150,              // seconds before the fog starts closing in
        fogTime: 75,             // and how long it takes to reach the altar
        fogDps: 7, fogMaxDps: 22,
        fogStart: 62, fogEnd: 9, // the safe radius
        hardCap: 300,

        pickups: {
            ink: { respawn: 16, ink: 35, label: 'ink pot' },
            hp: { respawn: 22, hp: 30, label: 'flask' },
            turbo: { respawn: 40, status: 'turbo', dur: 10, label: 'turbo button' },
            clock: { respawn: 45, status: 'clock', dur: 10, label: 'overclock' }
        },
        maxOwned: { trap: 3, wall: 2, zone: 2, summon: 2 }
    };

    // ---------------------------------------------------------------
    // the maps
    //
    // Every solid thing is a box standing on the ground, with nothing overhanging, so
    // a whole map is a height map and asking "is that a wall" costs one array lookup.
    // ground(x, z) is the terrain under the boxes. Half of each map is written here, and
    // makeLayout() turns it round by 180 degrees for the other half, so neither side
    // is the good one. Only spawn points for the first team are listed, in seat order.
    //   box: [x, z, half width, half depth, height, look]
    // A box's height is measured from zero, so one standing on a terrace has to be
    // taller than the terrace.
    //
    // They have to play differently, or they are one map in four coats of paint:
    //   the temple       open middle, altar on a plinth, big cover round the edge
    //   the recycle bin  a bowl. holding the altar means everyone is above you
    //   defrag           a grid of tall blocks. no long shots, corners everywhere
    //   the long wire    a causeway down the middle with the altar on it, lanes either side
    // ---------------------------------------------------------------
    function octagon(x, z) { return Math.max(Math.abs(x), Math.abs(z), (Math.abs(x) + Math.abs(z)) * 0.7071); }
    const MAPS = [
        {
            id: 'temple', name: 'the temple',
            blurb: 'open in the middle, big cover round the edge, the altar up a short ramp. the fair one.',
            altar: { r: 6.4, h: 1.5 },
            ground(x, z) {
                if (octagon(x, z) <= 6.4) return 1.5;
                const along = Math.max(Math.abs(x), Math.abs(z)), across = Math.min(Math.abs(x), Math.abs(z));
                if (across <= 2 && along <= 12.5) return 1.5 * (12.5 - along) / (12.5 - 6.4);
                return 0;
            },
            theme: { fog: [0.2, 0.4, 0.46], skyMid: [0.5, 0.74, 0.82], skyTop: [0.82, 0.95, 1.02], skyHigh: [0.72, 0.9, 1], floor: ['floor', 'floor2'], light: [1, 1, 1.04], raised: 'floor2', cliff: 'brick', wall: 'brick', moon: true },
            boxes: [
                [15, 15, 1.4, 1.4, 6, 'pillar'],
                [-15, 15, 1.4, 1.4, 6, 'pillar'],
                // error dialogs the size of a bus. the good cover
                [0, 22, 5, 0.6, 3.6, 'window'],
                [24, 2, 0.6, 4.5, 3.6, 'window'],
                // waist high: you can shoot over, and duck, and jump on
                [9, 25, 3, 0.7, 1.25, 'low'],
                [-9, 25, 3, 0.7, 1.25, 'low'],
                [25, 13, 0.7, 2.6, 1.25, 'low'],
                [-25, 9, 0.7, 3, 1.25, 'low'],
                [17, 25, 1, 1, 2.1, 'crate'],
                [-18, 22, 1.2, 1.2, 2.5, 'crate'],
                [-22, 19.5, 1, 1, 1.4, 'crate'],
                [20, -6, 1.1, 1.1, 2.4, 'crate'],
                [27, 26, 1, 1, 3, 'pillar'],
                [-27, 25, 1, 1, 2.2, 'pillar'],
                [16, 6, 2.2, 0.6, 2, 'low']
            ],
            spawns: [[-26, 28.5], [-20.5, 28.5], [-29, 21], [-13, 28.5]],
            pickups: [
                { kind: 'ink', x: 0, z: 27 }, { kind: 'ink', x: 27.5, z: 7 },
                { kind: 'hp', x: -28, z: 3 },
                { kind: 'turbo', x: 12, z: 20 }, { kind: 'clock', x: -9, z: 15 }
            ]
        },
        {
            id: 'bin', name: 'the recycle bin',
            blurb: 'a bowl, three terraces deep, with the altar at the bottom. whoever holds it has everyone above them.',
            altar: { r: 6.4, h: 0 },
            ground(x, z) {
                const ax = Math.abs(x), az = Math.abs(z), c = Math.max(ax, az);
                // up from the bottom on the middle of each side
                const across = Math.min(ax, az);
                if (c > 13 && c <= 18 && across <= 2.5) return 1.5 * (c - 13) / 5;
                // up to the rim further round, so you cannot run straight up and over
                if (c > 22 && c <= 27 && across >= 9.5 && across <= 13.5) return 1.5 + 1.5 * (c - 22) / 5;
                if (c <= 13) return 0;
                if (c <= 22) return 1.5;
                return 3;
            },
            theme: { fog: [0.34, 0.27, 0.3], skyMid: [0.66, 0.5, 0.5], skyTop: [0.86, 0.72, 0.66], skyHigh: [0.6, 0.55, 0.72], floor: ['floor', 'floor2'], light: [1.08, 0.98, 0.92], raised: 'brick', cliff: 'low', wall: 'brick', moon: true },
            boxes: [
                // four stubs at the bottom: not much, and that is the point
                [9.5, 9.5, 0.9, 0.9, 1.3, 'crate'],
                [-9.5, 9.5, 0.9, 0.9, 1.3, 'crate'],
                // the middle terrace
                [17.5, 15, 1.3, 1.3, 3.1, 'crate'],
                [-17.5, 15, 1.3, 1.3, 3.1, 'crate'],
                [8, 19, 2.6, 0.6, 2.75, 'low'],
                [-8, 19, 2.6, 0.6, 2.75, 'low'],
                // the rim: real cover, looking down
                [0, 27, 4.5, 0.6, 5.4, 'window'],
                [27, 0, 0.6, 4.5, 5.4, 'window'],
                [17, 27, 2.6, 0.7, 4.25, 'low'],
                [-22, 24, 0.7, 2, 4.25, 'low'],
                [27, 20, 1.3, 1.3, 6.5, 'pillar']
            ],
            spawns: [[-27.5, 27.5], [-23, 28.5], [-28.5, 20], [-15, 29]],
            pickups: [
                { kind: 'ink', x: -17, z: 9 }, { kind: 'ink', x: 28, z: 8 },
                { kind: 'hp', x: 10, z: -2 },
                { kind: 'turbo', x: 19, z: 19 }, { kind: 'clock', x: 0, z: 10 }
            ]
        },
        {
            id: 'defrag', name: 'defrag',
            blurb: 'a grid of tall disk clusters. no long shots, a corner every few metres, and whatever is homing is happy.',
            altar: { r: 5, h: 0.7 },
            ground(x, z) {
                if (octagon(x, z) <= 5) return 0.7;
                const along = Math.max(Math.abs(x), Math.abs(z)), across = Math.min(Math.abs(x), Math.abs(z));
                if (across <= 1.6 && along <= 7.5) return 0.7 * (7.5 - along) / 2.5;
                return 0;
            },
            theme: { fog: [0.04, 0.05, 0.16], skyMid: [0.06, 0.08, 0.26], skyTop: [0.1, 0.12, 0.34], skyHigh: [0.04, 0.05, 0.2], floor: ['chip', 'chip'], light: [0.86, 0.92, 1.12], raised: 'floor2', cliff: 'low', wall: 'chip', moon: false, near: 8, far: 26 },
            boxes: (function () {
                const out = [];
                for (let z = 0; z <= 24; z += 8) {
                    for (let x = -24; x <= 24; x += 8) {
                        if (z === 0 && x <= 0) continue;           // the turn does the other half
                        if (Math.max(Math.abs(x), Math.abs(z)) <= 8) continue;   // the room in the middle
                        // some clusters are half height: you can see over those, and be seen
                        const short = (Math.abs(x) + z * 3) % 40 === 0;
                        out.push([x, z, 2.6, 2.6, short ? 1.3 : 4.2, 'disk']);
                    }
                }
                return out;
            })(),
            spawns: [[-28, 28.5], [-20, 28.5], [-28.5, 20], [-12, 28.5]],
            pickups: [
                { kind: 'ink', x: 4, z: 20 }, { kind: 'ink', x: 20, z: 4 },
                { kind: 'hp', x: -28, z: 4 },
                { kind: 'turbo', x: 12, z: 12 }, { kind: 'clock', x: -4, z: 12 }
            ]
        },
        {
            id: 'wire', name: 'the long wire',
            blurb: 'a long raised causeway with the altar on it, and lanes either side. the long shots are up there, and so is everybody\'s aim.',
            altar: { r: 3.8, h: 2.5 },
            ground(x, z) {
                const ax = Math.abs(x), az = Math.abs(z);
                if (ax <= 4 && az <= 24) return 2.5;
                if (ax <= 4 && az <= 29) return 2.5 * (29 - az) / 5;
                // up from the side, a third of the way along
                if (ax <= 9.5 && az >= 9 && az <= 13) return 2.5 * (9.5 - ax) / 5.5;
                return 0;
            },
            theme: { fog: [0.27, 0.4, 0.3], skyMid: [0.5, 0.72, 0.56], skyTop: [0.8, 0.94, 0.78], skyHigh: [0.62, 0.86, 0.72], floor: ['moss', 'floor2'], light: [0.96, 1.04, 0.92], raised: 'low', cliff: 'brick', wall: 'brick', moon: true, far: 38 },
            boxes: [
                // the walls between the lanes, with gaps in the middle and at the ends
                [17.5, 14, 0.5, 8, 4, 'pillar'],
                [-17.5, 14, 0.5, 8, 4, 'pillar'],
                // on the causeway: two columns to duck behind
                [-2.4, 17, 0.8, 0.8, 4.2, 'pillar'],
                [2.4, 17, 0.8, 0.8, 4.2, 'pillar'],
                // inner lanes
                [11, 18, 2, 0.7, 1.25, 'low'],
                [-11, 18, 2, 0.7, 1.25, 'low'],
                [8, 4, 0.7, 2, 1.25, 'low'],
                [-8, 4, 0.7, 2, 1.25, 'low'],
                // outer lanes
                [25, 15, 1.2, 1.2, 3, 'crate'],
                [-25, 15, 1.2, 1.2, 3, 'crate'],
                [24, 2, 2.5, 0.7, 1.25, 'low'],
                [-24, 2, 2.5, 0.7, 1.25, 'low'],
                [24, 26, 0.6, 2.6, 3.6, 'window'],
                [-24, 26, 0.6, 2.6, 3.6, 'window']
            ],
            spawns: [[-11, 29], [11, 29], [-20, 29], [20, 29]],
            pickups: [
                { kind: 'ink', x: -28, z: 10 }, { kind: 'ink', x: 12, z: 26 },
                { kind: 'hp', x: 28, z: 6 },
                { kind: 'turbo', x: -12, z: 8 }, { kind: 'clock', x: 0, z: 21 }
            ]
        }
    ];
    const mapById = id => MAPS.find(m => m.id === id) || MAPS[0];
    function makeLayout(id) {
        const m = mapById(id);
        const boxes = [];
        m.boxes.forEach(b => {
            boxes.push(b.slice());
            boxes.push([-b[0], -b[1], b[2], b[3], b[4], b[5]]);
        });
        const pickups = [];
        m.pickups.forEach(p => {
            pickups.push({ kind: p.kind, x: p.x, z: p.z });
            pickups.push({ kind: p.kind, x: -p.x, z: -p.z });
        });
        return {
            id: m.id, boxes, pickups,
            // spawns[team][seat in that team]
            spawns: [m.spawns.map(p => p.slice()), m.spawns.map(p => [-p[0], -p[1]])],
            ground: m.ground, altar: m.altar, theme: m.theme
        };
    }

    // ---------------------------------------------------------------
    // the dress-up box — low poly now, but the same fourteen short strings,
    // so a wizard from before the rebuild still walks in looking like itself
    // ---------------------------------------------------------------
    const AVATAR = {
        skin: ['#f0c9a0', '#d9a066', '#a86b3c', '#7a4a24', '#cfe5c0', '#b9b6d6'],
        hat: ['pointy', 'wide', 'hood', 'crown', 'horned', 'bald'],
        hair: ['none', 'short', 'long', 'mohawk'],
        beard: ['none', 'stubble', 'goatee', 'long', 'braided', 'huge'],
        robe: ['plain', 'trim', 'patched', 'cloak', 'layered', 'ragged'],
        staff: ['none', 'gnarled', 'crystal', 'skull', 'orb', 'broom'],
        familiar: ['none', 'cat', 'owl', 'bat', 'frog', 'imp'],
        aura: ['none', 'sparks', 'flames', 'frost', 'shadow', 'holy'],
        eyes: ['normal', 'angry', 'tired', 'glowing', 'cyclops'],
        palette: ['#7b2ff7', '#e4485f', '#2b8cff', '#0fa958', '#ffb400', '#ff6b2b',
            '#6fd6ff', '#b04dff', '#c8a06a', '#e8e8e8', '#3a3a4a', '#ff67d3'],
        titles: ['apprentice', 'hedge wizard', 'archmage', 'necromancer', 'court sorcerer',
            'goblin whisperer', 'unlicensed alchemist', 'wizard of the third circle',
            'guy who read one book', 'the flammable']
    };

    function randomAvatar() {
        const pick = a => a[Math.floor(Math.random() * a.length)];
        return {
            skin: pick(AVATAR.skin),
            hat: pick(AVATAR.hat),
            hatColor: pick(AVATAR.palette),
            hair: pick(AVATAR.hair),
            hairColor: pick(AVATAR.palette),
            beard: pick(AVATAR.beard),
            robe: pick(AVATAR.robe),
            robeColor: pick(AVATAR.palette),
            trimColor: pick(AVATAR.palette),
            staff: pick(AVATAR.staff),
            familiar: pick(AVATAR.familiar),
            aura: pick(AVATAR.aura),
            eyes: pick(AVATAR.eyes),
            title: pick(AVATAR.titles)
        };
    }

    // ---------------------------------------------------------------
    // THE BOTS
    //
    // They play the same game through the same doors you do: the same stance,
    // the same ink, the same chamber, a crosshair that has to get to you. What
    // differs is their hands. draw is how long a sigil takes them, aim is how
    // far off the crosshair sits and turn how fast it gets there, sight is how
    // late they notice you moved, dodge is how often they get out of the way,
    // quality is how tidy their drawing is.
    //
    // The difficulty dropdown scales those, so "old gary on hard" is still
    // old gary: slow, patient, and behind a wall.
    // ---------------------------------------------------------------
    const BOTS = [
        {
            id: 'bogwart', name: 'bogwart', title: 'first year',
            tier: 'easy',
            blurb: 'has read one book and remembers about half of it. shoots at where you were.',
            skill: { react: 3.0, dodge: 0.15, quality: 0.3, aim: 7.5, turn: 2.2, sight: 0.55 },
            style: {
                els: ['fire', 'nature'], aggression: 0.9, defence: 0.7, hexes: 0.4, range: 16,
                pool: ['spark', 'fireball', 'frostbolt', 'magicmissile', 'runeward', 'regrowth', 'vinewhip', 'stonespike']
            },
            avatar: {
                skin: '#f0c9a0', hat: 'pointy', hatColor: '#0fa958', hair: 'short', hairColor: '#c8a06a',
                beard: 'none', robe: 'plain', robeColor: '#0fa958', trimColor: '#ffb400',
                staff: 'gnarled', familiar: 'frog', aura: 'none', eyes: 'tired', title: 'first year'
            },
            lines: {
                start: ['right. i have definitely revised for this bradar.', 'my mum says i am very talented.'],
                win: ['i did that on purpose!', 'wait, that worked?'],
                lose: ['that was not in the book.', 'best of nine?']
            }
        },
        {
            id: 'mildred', name: 'mildred', title: 'the unwise',
            tier: 'easy',
            blurb: 'builds a wall, hides behind it, and complains about the draught.',
            skill: { react: 2.5, dodge: 0.3, quality: 0.45, aim: 6, turn: 2.6, sight: 0.45 },
            style: {
                els: ['ice', 'arcane'], aggression: 0.8, defence: 1.5, hexes: 0.8, range: 20,
                pool: ['frostbolt', 'icewall', 'hailstorm', 'deepfreeze', 'runeward', 'manawell', 'arcaneorb', 'blink']
            },
            avatar: {
                skin: '#d9a066', hat: 'wide', hatColor: '#2b8cff', hair: 'long', hairColor: '#e8e8e8',
                beard: 'none', robe: 'layered', robeColor: '#6fd6ff', trimColor: '#e8e8e8',
                staff: 'crystal', familiar: 'owl', aura: 'frost', eyes: 'normal', title: 'the unwise'
            },
            lines: {
                start: ['do not scuff the ice, i only just laid it.', 'i have all afternoon, dear.'],
                win: ['patience. you should try it.', 'the wall did most of it, honestly.'],
                lose: ['you went straight through that?', 'well. rude.']
            }
        },
        {
            id: 'cinder', name: 'cinder', title: 'who is on fire',
            tier: 'normal',
            blurb: 'sets everything alight, including herself, and calls it a strategy.',
            skill: { react: 1.9, dodge: 0.5, quality: 0.65, aim: 4.4, turn: 3.4, sight: 0.32 },
            style: {
                els: ['fire', 'storm'], aggression: 1.5, defence: 0.5, hexes: 0.9, range: 13,
                pool: ['fireball', 'flamelance', 'inferno', 'meteor', 'spark', 'chainlightning', 'thunderclap', 'emberward']
            },
            avatar: {
                skin: '#a86b3c', hat: 'horned', hatColor: '#ff6b2b', hair: 'mohawk', hairColor: '#ff6b2b',
                beard: 'none', robe: 'ragged', robeColor: '#e4485f', trimColor: '#ffb400',
                staff: 'orb', familiar: 'imp', aura: 'flames', eyes: 'angry', title: 'who is on fire'
            },
            lines: {
                start: ['stand still bradar. it is quicker for both of us.', 'i am going to enjoy this bit.'],
                win: ['see? warmth.', 'ash. lovely.'],
                lose: ['put me out. put me out!', 'fine. fine!']
            }
        },
        {
            id: 'gary', name: 'old gary', title: 'the caretaker',
            tier: 'normal',
            blurb: 'a wall, a ward, a heal, and one rock every eight seconds until you give up.',
            skill: { react: 1.9, dodge: 0.45, quality: 0.6, aim: 4.2, turn: 3, sight: 0.34 },
            style: {
                els: ['earth', 'light'], aggression: 0.9, defence: 1.6, hexes: 0.6, range: 19,
                pool: ['boulder', 'stonespike', 'pillar', 'stoneskin', 'quake', 'smite', 'blessing', 'sanctuary']
            },
            avatar: {
                skin: '#d9a066', hat: 'bald', hatColor: '#c8a06a', hair: 'none', hairColor: '#e8e8e8',
                beard: 'huge', robe: 'patched', robeColor: '#3a3a4a', trimColor: '#c8a06a',
                staff: 'broom', familiar: 'cat', aura: 'none', eyes: 'tired', title: 'the caretaker'
            },
            lines: {
                start: ['i have been doing this since before you were a rumour.', 'go on then.'],
                win: ['told you.', 'mind the floor on your way out.'],
                lose: ['hm. i will be back tomorrow.', 'you got lucky, son.']
            }
        },
        {
            id: 'nyx', name: 'nyx', title: 'the quiet',
            tier: 'hard',
            blurb: 'never in the same place twice, and everything she casts sticks to you.',
            skill: { react: 1.3, dodge: 0.8, quality: 0.9, aim: 2.6, turn: 4.8, sight: 0.2 },
            style: {
                els: ['shadow', 'blood'], aggression: 1.3, defence: 0.8, hexes: 1.4, range: 15,
                pool: ['shadowbolt', 'curse', 'drainlife', 'nightfall', 'hemorrhage', 'runeward', 'bloodlance', 'blink']
            },
            avatar: {
                skin: '#b9b6d6', hat: 'hood', hatColor: '#3a3a4a', hair: 'long', hairColor: '#b04dff',
                beard: 'none', robe: 'cloak', robeColor: '#3a3a4a', trimColor: '#b04dff',
                staff: 'skull', familiar: 'bat', aura: 'shadow', eyes: 'glowing', title: 'the quiet'
            },
            lines: {
                start: ['you are already bleeding. you just have not noticed.', '...'],
                win: ['quiet, wasn\'t it.', 'take your time getting up.'],
                lose: ['interesting.', 'i will remember the shape of that.']
            }
        },
        {
            id: 'collector', name: 'the tax collector', title: 'void auditor',
            tier: 'hard',
            blurb: 'takes your ink first, your health second, and files the paperwork after.',
            skill: { react: 1.4, dodge: 0.75, quality: 0.9, aim: 2.8, turn: 4.6, sight: 0.2 },
            style: {
                els: ['void', 'arcane', 'storm'], aggression: 1.4, defence: 0.9, hexes: 1.2, range: 21,
                pool: ['voidlance', 'rift', 'singularity', 'oblivion', 'mirror', 'arcaneorb', 'chainlightning', 'blink']
            },
            avatar: {
                skin: '#7a4a24', hat: 'crown', hatColor: '#ffb400', hair: 'none', hairColor: '#3a3a4a',
                beard: 'goatee', robe: 'trim', robeColor: '#3a3a4a', trimColor: '#b04dff',
                staff: 'skull', familiar: 'none', aura: 'shadow', eyes: 'cyclops', title: 'void auditor'
            },
            lines: {
                start: ['this will be quick, and it will be itemised.', 'your ink is due.'],
                win: ['settled.', 'receipt attached.'],
                lose: ['i shall be appealing this.', 'an accounting error.']
            }
        }
    ];

    // how the difficulty dropdown bends whichever bot you picked
    const BOT_DIFFICULTY = {
        easy: { react: 1.45, dodge: 0.6, quality: 0.7, aim: 1.5, turn: 0.75, sight: 1.4 },
        normal: { react: 1, dodge: 1, quality: 1, aim: 1, turn: 1, sight: 1 },
        hard: { react: 0.78, dodge: 1.18, quality: 1.18, aim: 0.72, turn: 1.25, sight: 0.75 }
    };

    // what you walk in with: eight sigils that do not look anything alike
    const DEFAULT_LOADOUT = ['spark', 'fireball', 'frostbolt', 'magicmissile', 'runeward', 'regrowth', 'smite', 'icewall'];
    const LOADOUT_SIZE = 8;

    // ===============================================================
    // loadout ids
    // ===============================================================
    // There is no server to look an id up on, so the id is the loadout. Twelve characters
    // you can read down a phone: XXXX-XXXX-XXXX.
    //
    // A sigil's number is its place in this list, and that is a promise. An id somebody
    // posted a year ago has to mean the same eight sigils. So: new sigils only ever go on
    // the end, nothing moves, and a sigil that gets removed stays here so its number is
    // never reused. check-wizardz.mjs holds a copy of this list and of some real ids.
    const SIGIL_NUMBERS = [
        'fireball', 'flamelance', 'inferno', 'emberward', 'meteor',
        'frostbolt', 'icewall', 'blizzard', 'deepfreeze', 'hailstorm',
        'spark', 'chainlightning', 'thunderclap', 'staticfield', 'overload',
        'magicmissile', 'arcaneorb', 'manawell', 'runeward', 'blink',
        'vinewhip', 'thornburst', 'regrowth', 'entangle', 'pollenveil',
        'shadowbolt', 'curse', 'drainlife', 'nightfall', 'banish',
        'smite', 'radiance', 'blessing', 'sanctuary', 'judgment',
        'stonespike', 'boulder', 'quake', 'stoneskin', 'pillar',
        'bloodlance', 'sacrifice', 'leech', 'hemorrhage', 'bloodpact',
        'voidlance', 'singularity', 'rift', 'oblivion', 'mirror'
    ];
    // No I, L, O or U, so nobody has to work out which one that was. Those get read as the
    // thing they look like, and it does not care about case or dashes.
    const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const ID_LENGTH = 12;
    // Version 1 is two bits of version and six bits a sigil, which is ten characters, and two
    // more of check. Past 64 sigils, version 2 gets wider numbers and version 1 still reads.
    const ID_VERSION = 1, ID_SIGIL_BITS = 6;
    const LOADOUT_WHY = {
        junk: 'that is not a loadout id, bradar. they look like 8044-1NS8-WKEY',
        short: 'too short. a loadout id is twelve letters and numbers',
        long: 'too long. a loadout id is twelve letters and numbers',
        chars: 'there is a letter in there no loadout id uses',
        check: 'that id does not add up. something got typed wrong',
        version: 'that id is from a newer wizardz than this one. reload the page',
        unknown: 'that id has a sigil in it this wizardz does not have',
        twice: 'that id has the same sigil in it twice',
        size: 'a loadout is exactly eight sigils'
    };
    // Any single wrong character, and any two neighbours swapped, always changes this: 1021
    // is prime, and neither 33 nor any difference between two characters divides it.
    function idCheck(symbols) {
        let h = 7;
        for (const v of symbols) h = (h * 33 + v + 1) % 1021;
        return [Math.floor(h / 32), h % 32];
    }
    // whether this is a legal eight. The one place that decides it, for the menu, the saved
    // list and the host. null means fine. Nothing is locked in this game: every sigil is
    // open from the start, and if that changes this is where it gets checked.
    function loadoutProblem(list) {
        if (!Array.isArray(list) || list.length !== LOADOUT_SIZE) return 'size';
        const seen = {};
        for (const id of list) {
            if (typeof id !== 'string' || !SIGIL_NUMBERS.includes(id) || !SPELLS.some(s => s.id === id)) return 'unknown';
            if (seen[id]) return 'twice';
            seen[id] = 1;
        }
        return null;
    }
    function loadoutToId(list) {
        if (loadoutProblem(list)) return null;
        const bits = [(ID_VERSION >> 1) & 1, ID_VERSION & 1];
        for (const id of list) {
            const n = SIGIL_NUMBERS.indexOf(id);
            for (let b = ID_SIGIL_BITS - 1; b >= 0; b--) bits.push((n >> b) & 1);
        }
        const symbols = [];
        for (let i = 0; i < bits.length; i += 5) symbols.push(bits.slice(i, i + 5).reduce((a, b) => a * 2 + b, 0));
        const text = symbols.concat(idCheck(symbols)).map(v => ID_ALPHABET[v]).join('');
        return text.slice(0, 4) + '-' + text.slice(4, 8) + '-' + text.slice(8);
    }
    // what somebody typed, tidied. Keeps the junk in, so that it can be complained about
    const cleanLoadoutId = text => String(text).toUpperCase().replace(/[\s\-_.]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    // Takes anything at all, because a host is handed this by strangers, and never throws.
    function loadoutFromId(text) {
        const no = why => ({ ok: false, why, text: LOADOUT_WHY[why] });
        if (typeof text !== 'string' || text.length > 40) return no('junk');
        const clean = cleanLoadoutId(text);
        if (!clean) return no('junk');
        for (const c of clean) if (!ID_ALPHABET.includes(c)) return no('chars');
        if (clean.length < ID_LENGTH) return no('short');
        if (clean.length > ID_LENGTH) return no('long');
        const symbols = Array.from(clean, c => ID_ALPHABET.indexOf(c));
        const check = idCheck(symbols.slice(0, 10));
        if (check[0] !== symbols[10] || check[1] !== symbols[11]) return no('check');
        const bits = [];
        for (const v of symbols.slice(0, 10)) for (let b = 4; b >= 0; b--) bits.push((v >> b) & 1);
        if (bits[0] * 2 + bits[1] !== ID_VERSION) return no('version');
        const list = [];
        for (let i = 0; i < LOADOUT_SIZE; i++) {
            let n = 0;
            for (let b = 0; b < ID_SIGIL_BITS; b++) n = n * 2 + bits[2 + i * ID_SIGIL_BITS + b];
            if (n >= SIGIL_NUMBERS.length) return no('unknown');
            list.push(SIGIL_NUMBERS[n]);
        }
        const problem = loadoutProblem(list);
        if (problem) return no(problem);
        return { ok: true, list, id: loadoutToId(list) };
    }

    // Ten ready made. There are 80 slots and 50 sigils so they cannot all be different from
    // each other, but every sigil is in at least one, and no two share more than a few.
    const PRESETS = [
        { id: 'arsonist', name: 'the arsonist', style: 'set it on fire, then walk through the fire', sigils: ['fireball', 'flamelance', 'inferno', 'emberward', 'curse', 'spark', 'overload', 'blink'] },
        { id: 'coldstorage', name: 'cold storage', style: 'slow them, stop them, then hit them at your leisure', sigils: ['frostbolt', 'hailstorm', 'deepfreeze', 'blizzard', 'icewall', 'magicmissile', 'manawell', 'mirror'] },
        { id: 'surge', name: 'power surge', style: 'cheap, quick and a lot of it, all at once', sigils: ['spark', 'chainlightning', 'thunderclap', 'staticfield', 'magicmissile', 'arcaneorb', 'frostbolt', 'smite'] },
        { id: 'gardener', name: 'the gardener', style: 'traps and roots. they come to you, and regret it', sigils: ['vinewhip', 'thornburst', 'entangle', 'pollenveil', 'regrowth', 'sanctuary', 'drainlife', 'stonespike'] },
        { id: 'nightshift', name: 'night shift', style: 'hexes on hexes. nothing big, all of it horrible', sigils: ['shadowbolt', 'curse', 'drainlife', 'nightfall', 'banish', 'hemorrhage', 'runeward', 'fireball'] },
        { id: 'sermon', name: 'the sermon', style: 'hold the altar, heal through it and smite whoever objects', sigils: ['smite', 'radiance', 'blessing', 'sanctuary', 'judgment', 'runeward', 'frostbolt', 'stonespike'] },
        { id: 'quarry', name: 'the quarry', style: 'slow heavy rocks from behind your own walls', sigils: ['stonespike', 'boulder', 'quake', 'stoneskin', 'pillar', 'arcaneorb', 'smite', 'regrowth'] },
        { id: 'bloodmoney', name: 'blood money', style: 'pay in health for damage you could not otherwise afford', sigils: ['bloodlance', 'sacrifice', 'bloodpact', 'leech', 'hemorrhage', 'drainlife', 'regrowth', 'blink'] },
        { id: 'abyss', name: 'the abyss', style: 'one enormous thing, then a long wait, then another one', sigils: ['voidlance', 'singularity', 'oblivion', 'rift', 'nightfall', 'manawell', 'curse', 'blink'] },
        { id: 'longway', name: 'the long way off', style: 'sight lines and big hits from where they cannot reach you', sigils: ['flamelance', 'stonespike', 'voidlance', 'meteor', 'smite', 'icewall', 'shadowbolt', 'blink'] }
    ];
    PRESETS.forEach(p => { p.code = loadoutToId(p.sigils); });

    window.WZ = {
        EL, SPELLS, STATUS, ARENA, AVATAR,
        BOTS, BOT_DIFFICULTY,
        DEFAULT_LOADOUT, LOADOUT_SIZE,
        SIGIL_NUMBERS, PRESETS, LOADOUT_WHY, ID_LENGTH,
        loadoutProblem, loadoutToId, loadoutFromId, cleanLoadoutId,
        randomAvatar, makeLayout, MAPS, mapById, octagon,
        byId: (id) => SPELLS.find(s => s.id === id) || null,
        botById: (id) => BOTS.find(b => b.id === id) || null,
        helpers: { LINE, PATH, CLOSED, ARC, CIRCLE, QUAD, POLY, PENTAGRAM, ZIG, WAVE, SPIRAL, LEMNISCATE, RAYS }
    };
})();
