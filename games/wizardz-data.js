// ===================================================================
// WIZARDZ 98 — content: 50 spells, their sigils, and the dress-up box
//
// Every spell is cast by drawing its sigil. The sigils below are stored
// as stroke templates in a 0..100 box (y grows downward, like the
// canvas) and are matched with a point-cloud recogniser, so stroke
// order and direction do not matter — only the shape does.
//
// Two rules were followed when drawing these fifty:
//   1. no two sigils may look alike to the recogniser. there is a test
//      for that in .github/scripts/check-games.mjs and it runs in CI.
//   2. a sigil has to be drawable in about a second, under pressure,
//      by somebody with a trackpad.
//
// The engine lives in wizardz.js. This file is pure data plus the
// little geometry helpers used to write it.
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
    // polyline through [x,y] vertices, evenly filled so the recogniser
    // sees the shape and not just the corners
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
    const CIRCLE = (cx, cy, r) => ARC(cx, cy, r, 0, 360, 40);
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
    function STAR(cx, cy, rOut, rIn, points, rot) {
        const v = [];
        for (let i = 0; i < points * 2; i++) {
            const a = ((rot || 0) + i * 180 / points) * Math.PI / 180;
            const r = i % 2 ? rIn : rOut;
            v.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        return CLOSED(v, 6);
    }
    // zigzag along a line, teeth alternating either side of it
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
    // sine along a line — snakes and vines
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
    // figure of eight, for the spells that mean "forever"
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
            out.push(LINE(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, 6));
        }
        return out;
    }

    // ---------------------------------------------------------------
    // elements — colour, and the flavour each one leans on
    // ---------------------------------------------------------------
    const EL = {
        fire: { name: 'fire', color: '#ff6b2b', glow: '#ffb347', about: 'damage over time, no patience' },
        ice: { name: 'ice', color: '#6fd6ff', glow: '#bff0ff', about: 'slows, freezes, ruins plans' },
        storm: { name: 'storm', color: '#ffe14d', glow: '#fff5b0', about: 'fast, cheap, drains mana' },
        arcane: { name: 'arcane', color: '#c08cff', glow: '#e6d2ff', about: 'mana, wards, tricks' },
        nature: { name: 'nature', color: '#7ee06a', glow: '#c8f5bf', about: 'healing and holding you still' },
        shadow: { name: 'shadow', color: '#a074d8', glow: '#d4bdf0', about: 'weakens, drains, hides' },
        light: { name: 'light', color: '#ffe9a8', glow: '#fffbe8', about: 'shields, heals, punishes' },
        earth: { name: 'earth', color: '#c8a06a', glow: '#e8d3b0', about: 'walls and heavy rocks' },
        blood: { name: 'blood', color: '#e4485f', glow: '#ff9aa8', about: 'pay in health, hit harder' },
        void: { name: 'void', color: '#b04dff', glow: '#e0b3ff', about: 'expensive, unfair, slow' }
    };

    // ---------------------------------------------------------------
    // THE FIFTY
    //
    // kind: bolt | beam | wall | ward | heal | buff | hex | zone |
    //       summon | special
    // cost is mana, hp is health paid up front, cd is seconds.
    // ---------------------------------------------------------------
    const SPELLS = [
        // ---------------- fire ----------------
        {
            id: 'fireball', name: 'fireball', el: 'fire', kind: 'bolt',
            cost: 14, cd: 1.2, dmg: 14,
            blurb: 'the one everybody learns first. burns for a while after.',
            p: { speed: 340, r: 9, burn: { dps: 3, dur: 3 } },
            glyph: [CLOSED([[50, 12], [86, 80], [14, 80]])]
        },
        {
            id: 'flamelance', name: 'flame lance', el: 'fire', kind: 'bolt',
            cost: 18, cd: 2.4, dmg: 17,
            blurb: 'a spear of fire. goes through walls and wizards alike.',
            p: { speed: 620, r: 6, pierce: true, burn: { dps: 2, dur: 2 } },
            glyph: [LINE(50, 95, 50, 15), PATH([[28, 38], [50, 12], [72, 38]])]
        },
        {
            id: 'inferno', name: 'inferno', el: 'fire', kind: 'zone',
            cost: 30, cd: 9, dmg: 0,
            blurb: 'sets their half of the arena on fire and leaves it there.',
            p: { dps: 7, dur: 4.5, w: 150, burn: { dps: 2, dur: 2 } },
            glyph: [ZIG(18, 92, 18, 14, 3, 16), ZIG(50, 95, 50, 8, 3, 16), ZIG(82, 92, 82, 14, 3, 16)]
        },
        {
            id: 'emberward', name: 'ember ward', el: 'fire', kind: 'ward',
            cost: 16, cd: 8, dmg: 0,
            blurb: 'a hot shield. whatever breaks on it catches fire.',
            p: { shield: 26, dur: 8, thorns: 4 },
            glyph: [ARC(50, 66, 38, 180, 360)]
        },
        {
            id: 'meteor', name: 'meteor', el: 'fire', kind: 'bolt',
            cost: 34, cd: 11, dmg: 30,
            blurb: 'lobbed, slow, and enormous. duck.',
            p: { speed: 300, r: 18, gravity: 420, aoe: 70, burn: { dps: 3, dur: 3 } },
            glyph: [LINE(14, 10, 62, 58), CIRCLE(74, 72, 20)]
        },

        // ---------------- ice ----------------
        {
            id: 'frostbolt', name: 'frostbolt', el: 'ice', kind: 'bolt',
            cost: 12, cd: 1.1, dmg: 10,
            blurb: 'cheap, cold, and it slows their mana to a crawl.',
            p: { speed: 380, r: 8, chill: { dur: 3 } },
            glyph: [CLOSED([[14, 20], [86, 20], [50, 88]])]
        },
        {
            id: 'icewall', name: 'ice wall', el: 'ice', kind: 'wall',
            cost: 18, cd: 9, dmg: 0,
            blurb: 'a slab of ice in front of you. it eats spells until it does not.',
            p: { hp: 40, dur: 9, h: 120 },
            glyph: [CLOSED([[6, 30], [94, 30], [94, 70], [6, 70]])]
        },
        {
            id: 'blizzard', name: 'blizzard', el: 'ice', kind: 'zone',
            cost: 28, cd: 12, dmg: 0,
            blurb: 'a storm parked on top of them. cold, constant, rude.',
            p: { dps: 4, dur: 5.5, w: 180, chill: { dur: 1.2 } },
            glyph: [LINE(50, 8, 50, 92), LINE(14, 29, 86, 71), LINE(14, 71, 86, 29)]
        },
        {
            id: 'deepfreeze', name: 'deep freeze', el: 'ice', kind: 'hex',
            cost: 26, cd: 14, dmg: 4,
            blurb: 'locks their hands shut. no drawing for a moment.',
            p: { status: 'freeze', dur: 1.6 },
            glyph: [ARC(50, 46, 20, 180, 360), CLOSED([[22, 46], [78, 46], [78, 92], [22, 92]])]
        },
        {
            id: 'hailstorm', name: 'hailstorm', el: 'ice', kind: 'bolt',
            cost: 20, cd: 4, dmg: 6,
            blurb: 'three lumps of ice on an arc. hard to dodge all of them.',
            p: { speed: 330, r: 7, gravity: 260, count: 3, spread: 26, chill: { dur: 1.5 } },
            glyph: [LINE(2, 29, 50, 93), LINE(20, 16, 68, 80), LINE(38, 3, 86, 67)]
        },

        // ---------------- storm ----------------
        {
            id: 'spark', name: 'spark', el: 'storm', kind: 'bolt',
            cost: 6, cd: 0.45, dmg: 6,
            blurb: 'nearly free and nearly instant. the jab.',
            p: { speed: 720, r: 5 },
            glyph: [PATH([[66, 8], [34, 44], [56, 44], [28, 92]])]
        },
        {
            id: 'chainlightning', name: 'chain lightning', el: 'storm', kind: 'beam',
            cost: 16, cd: 3.5, dmg: 12,
            blurb: 'hits instantly and rips mana out on the way through.',
            p: { manaBurn: 9, shock: { dur: 2 } },
            glyph: [ZIG(6, 50, 94, 50, 4, 26)]
        },
        {
            id: 'thunderclap', name: 'thunderclap', el: 'storm', kind: 'hex',
            cost: 24, cd: 8, dmg: 14,
            blurb: 'a bang right on top of them. stuns for half a second.',
            p: { status: 'stun', dur: 0.7 },
            glyph: [ZIG(50, 8, 50, 66, 3, 12), LINE(10, 84, 90, 84)]
        },
        {
            id: 'staticfield', name: 'static field', el: 'storm', kind: 'ward',
            cost: 20, cd: 10, dmg: 0,
            blurb: 'a crackling bubble that swats small projectiles out of the air.',
            p: { shield: 18, dur: 6, zap: true },
            glyph: [LINE(30, 8, 30, 92), LINE(70, 8, 70, 92), LINE(8, 32, 92, 32), LINE(8, 68, 92, 68)]
        },
        {
            id: 'overload', name: 'overload', el: 'storm', kind: 'buff',
            cost: 10, cd: 12, dmg: 0,
            blurb: 'double mana regen for six seconds. it also cooks you slowly.',
            p: { status: 'overload', dur: 6, selfDps: 1.2 },
            glyph: [PATH([[8, 18], [30, 82], [50, 30], [70, 82], [92, 18]])]
        },

        // ---------------- arcane ----------------
        {
            id: 'magicmissile', name: 'magic missile', el: 'arcane', kind: 'bolt',
            cost: 10, cd: 1.6, dmg: 9,
            blurb: 'it follows them. no dodging, only blocking.',
            p: { speed: 300, r: 7, homing: 2.6 },
            glyph: [LINE(6, 50, 92, 50), PATH([[56, 16], [96, 50], [56, 84]])]
        },
        {
            id: 'arcaneorb', name: 'arcane orb', el: 'arcane', kind: 'bolt',
            cost: 22, cd: 5, dmg: 20,
            blurb: 'a slow fat orb. easy to see coming, awful to be hit by.',
            p: { speed: 155, r: 17, aoe: 40 },
            glyph: [CIRCLE(50, 50, 40)]
        },
        {
            id: 'manawell', name: 'mana well', el: 'arcane', kind: 'buff',
            cost: 0, cd: 16, dmg: 0,
            blurb: 'costs nothing and gives you 35 mana back over four seconds.',
            p: { status: 'well', dur: 4, manaPerSec: 9 },
            glyph: [[].concat(LINE(16, 10, 16, 58), ARC(50, 58, 34, 180, 0), LINE(84, 58, 84, 10))]
        },
        {
            id: 'runeward', name: 'rune ward', el: 'arcane', kind: 'ward',
            cost: 18, cd: 9, dmg: 0,
            blurb: 'plain honest shielding. thirty points of "no".',
            p: { shield: 30, dur: 10 },
            glyph: [CLOSED([[8, 8], [92, 8], [92, 92], [8, 92]]), CLOSED([[34, 34], [66, 34], [66, 66], [34, 66]])]
        },
        {
            id: 'blink', name: 'blink', el: 'arcane', kind: 'special',
            cost: 12, cd: 6, dmg: 0,
            blurb: 'you are briefly somewhere else. spells pass through where you were.',
            p: { status: 'phase', dur: 0.75, jump: 90 },
            glyph: [LINE(22, 10, 22, 90), LINE(78, 10, 78, 90), LINE(22, 50, 78, 50)]
        },

        // ---------------- nature ----------------
        {
            id: 'vinewhip', name: 'vine whip', el: 'nature', kind: 'bolt',
            cost: 14, cd: 3, dmg: 8,
            blurb: 'grabs an ankle. they stop moving, you keep casting.',
            p: { speed: 300, r: 8, status: 'root', statusDur: 1.4 },
            glyph: [WAVE(50, 6, 50, 94, 2, 26)]
        },
        {
            id: 'thornburst', name: 'thorn burst', el: 'nature', kind: 'buff',
            cost: 16, cd: 10, dmg: 0,
            blurb: 'for eight seconds everything that hits you regrets it.',
            p: { status: 'thorns', dur: 8, thorns: 5 },
            glyph: [STAR(50, 50, 44, 18, 5, -90)]
        },
        {
            id: 'regrowth', name: 'regrowth', el: 'nature', kind: 'heal',
            cost: 20, cd: 10, dmg: 0,
            blurb: 'eighteen health, slowly, while you are busy with other things.',
            p: { heal: 18, over: 4 },
            glyph: [QUAD(28, 72, 26, 22, 78, 24), QUAD(28, 72, 76, 74, 78, 24), LINE(28, 72, 6, 94)]
        },
        {
            id: 'entangle', name: 'entangle', el: 'nature', kind: 'hex',
            cost: 18, cd: 9, dmg: 3,
            blurb: 'roots them where they stand for two and a half seconds.',
            p: { status: 'root', dur: 2.5 },
            glyph: [SPIRAL(50, 50, 10, 46, 2)]
        },
        {
            id: 'pollenveil', name: 'pollen veil', el: 'nature', kind: 'hex',
            cost: 18, cd: 12, dmg: 0,
            blurb: 'fills their side of the screen with spores. good luck seeing anything.',
            p: { status: 'blind', dur: 5 },
            glyph: [CIRCLE(30, 32, 16), CIRCLE(70, 38, 16), CIRCLE(48, 74, 16)]
        },

        // ---------------- shadow ----------------
        {
            id: 'shadowbolt', name: 'shadow bolt', el: 'shadow', kind: 'bolt',
            cost: 13, cd: 1.3, dmg: 12,
            blurb: 'hits, and takes the sting out of their next few spells.',
            p: { speed: 400, r: 8, status: 'weak', statusDur: 3 },
            glyph: [ARC(44, 50, 44, 45, 315), ARC(62, 50, 34, 50, 310)]
        },
        {
            id: 'curse', name: 'curse', el: 'shadow', kind: 'hex',
            cost: 20, cd: 12, dmg: 0,
            blurb: 'six seconds of everything they cast landing softer.',
            p: { status: 'weak', dur: 6 },
            glyph: [LINE(14, 14, 86, 86), LINE(86, 14, 14, 86)]
        },
        {
            id: 'drainlife', name: 'drain life', el: 'shadow', kind: 'beam',
            cost: 18, cd: 6, dmg: 11,
            blurb: 'instant, and most of what it takes ends up in you.',
            p: { lifesteal: 9 },
            glyph: [PATH([[16, 12], [84, 12], [16, 88], [84, 88], [16, 12]])]
        },
        {
            id: 'nightfall', name: 'nightfall', el: 'shadow', kind: 'special',
            cost: 16, cd: 8, dmg: 0,
            blurb: 'a decoy of yourself. it eats one spell and vanishes.',
            p: { decoy: true, dur: 8 },
            glyph: [PATH([[18, 16], [50, 44], [82, 16]]), PATH([[18, 52], [50, 80], [82, 52]])]
        },
        {
            id: 'banish', name: 'banish', el: 'shadow', kind: 'special',
            cost: 22, cd: 14, dmg: 0,
            blurb: 'wipes their walls, zones, decoys and buffs off the board.',
            p: { dispelEnemy: true },
            glyph: [PATH([[20, 18], [46, 50], [20, 82]]), PATH([[54, 18], [80, 50], [54, 82]])]
        },

        // ---------------- light ----------------
        {
            id: 'smite', name: 'smite', el: 'light', kind: 'bolt',
            cost: 16, cd: 2.2, dmg: 15,
            blurb: 'fast and clean. hits cursed and weakened wizards harder.',
            p: { speed: 560, r: 8, punish: 1.5 },
            glyph: [LINE(6, 14, 94, 14), LINE(50, 14, 50, 94)]
        },
        {
            id: 'radiance', name: 'radiance', el: 'light', kind: 'special',
            cost: 20, cd: 9, dmg: 10,
            blurb: 'a burst around you that burns off your own curses.',
            p: { selfDispel: true, aoe: 130 },
            glyph: [CIRCLE(50, 50, 26)].concat(RAYS(50, 50, 34, 48, 4, 45))
        },
        {
            id: 'blessing', name: 'blessing', el: 'light', kind: 'buff',
            cost: 22, cd: 12, dmg: 0,
            blurb: 'ten health now and a quarter more damage for six seconds.',
            p: { status: 'focus', dur: 6, heal: 10 },
            glyph: [PATH([[10, 78], [50, 22], [90, 78]])]
        },
        {
            id: 'sanctuary', name: 'sanctuary', el: 'light', kind: 'ward',
            cost: 26, cd: 14, dmg: 0,
            blurb: 'the big shield. forty points, and it holds for a while.',
            p: { shield: 40, dur: 7 },
            glyph: [[].concat(LINE(14, 94, 14, 52), ARC(50, 52, 36, 180, 360), LINE(86, 52, 86, 94))]
        },
        {
            id: 'judgment', name: 'judgment', el: 'light', kind: 'special',
            cost: 28, cd: 10, dmg: 24,
            blurb: 'a pillar of light where they are standing, a moment from now.',
            p: { telegraph: 0.85, r: 34 },
            glyph: [LINE(50, 6, 50, 88), PATH([[28, 62], [50, 92], [72, 62]])]
        },

        // ---------------- earth ----------------
        {
            id: 'stonespike', name: 'stone spike', el: 'earth', kind: 'bolt',
            cost: 14, cd: 2.5, dmg: 13,
            blurb: 'comes up off the floor. useless against anyone hovering.',
            p: { speed: 430, r: 9, lowOnly: true },
            glyph: [PATH([[10, 86], [30, 20], [50, 64], [70, 20], [90, 86]])]
        },
        {
            id: 'boulder', name: 'boulder', el: 'earth', kind: 'bolt',
            cost: 24, cd: 6, dmg: 22,
            blurb: 'slow, heavy, and it shoves them backwards.',
            p: { speed: 200, r: 19, knock: 90 },
            glyph: [CLOSED([[50, 10], [90, 50], [50, 90], [10, 50]])]
        },
        {
            id: 'quake', name: 'quake', el: 'earth', kind: 'bolt',
            cost: 20, cd: 7, dmg: 12,
            blurb: 'a wave along the ground. get in the air or take it.',
            p: { speed: 260, r: 22, ground: true, status: 'stun', statusDur: 0.4 },
            glyph: [LINE(8, 26, 92, 26), LINE(8, 50, 92, 50), LINE(8, 74, 92, 74)]
        },
        {
            id: 'stoneskin', name: 'stone skin', el: 'earth', kind: 'ward',
            cost: 20, cd: 11, dmg: 0,
            blurb: 'a smaller shield, but everything hurts a quarter less while it lasts.',
            p: { shield: 22, dur: 8, status: 'stoneskin', statusDur: 8 },
            glyph: [LINE(8, 30, 92, 30), LINE(8, 70, 92, 70), LINE(50, 8, 50, 30), LINE(28, 70, 28, 92), LINE(72, 70, 72, 92)]
        },
        {
            id: 'pillar', name: 'pillar', el: 'earth', kind: 'wall',
            cost: 22, cd: 10, dmg: 0,
            blurb: 'sixty points of rock between you and whatever is coming.',
            p: { hp: 60, dur: 12, h: 150 },
            glyph: [CLOSED([[32, 6], [68, 6], [68, 94], [32, 94]])]
        },

        // ---------------- blood ----------------
        {
            id: 'bloodlance', name: 'blood lance', el: 'blood', kind: 'bolt',
            cost: 6, hp: 8, cd: 3, dmg: 21,
            blurb: 'paid for in your own health. hits like it.',
            p: { speed: 480, r: 8 },
            glyph: [QUAD(50, 8, 18, 52, 50, 92), QUAD(50, 8, 82, 52, 50, 92)]
        },
        {
            id: 'sacrifice', name: 'sacrifice', el: 'blood', kind: 'special',
            cost: 0, hp: 15, cd: 14, dmg: 0,
            blurb: 'fifteen health straight into forty mana. no take-backs.',
            p: { mana: 40 },
            glyph: [LINE(50, 50, 50, 92), LINE(50, 50, 16, 10), LINE(50, 50, 84, 10)]
        },
        {
            id: 'leech', name: 'leech', el: 'blood', kind: 'hex',
            cost: 16, cd: 9, dmg: 0,
            blurb: 'sticks to them for five seconds and feeds you what it takes.',
            p: { status: 'leech', dur: 5, dps: 2.5, feed: true },
            glyph: [ARC(56, 50, 40, 55, 305)]
        },
        {
            id: 'hemorrhage', name: 'hemorrhage', el: 'blood', kind: 'hex',
            cost: 18, cd: 8, dmg: 0,
            blurb: 'a bleed that gets worse the more they move about.',
            p: { status: 'bleed', dur: 8, dps: 2.2, moveDps: 3 },
            glyph: [LINE(24, 8, 24, 92), LINE(50, 8, 50, 92), LINE(76, 8, 76, 92)]
        },
        {
            id: 'bloodpact', name: 'blood pact', el: 'blood', kind: 'buff',
            cost: 0, hp: 10, cd: 20, dmg: 0,
            blurb: 'eight seconds where spells cost health instead of mana, and hit harder.',
            p: { status: 'pact', dur: 8 },
            glyph: [QUAD(50, 40, 12, 2, 8, 40), QUAD(8, 40, 18, 70, 50, 94), QUAD(50, 40, 88, 2, 92, 40), QUAD(92, 40, 82, 70, 50, 94)]
        },

        // ---------------- void ----------------
        {
            id: 'voidlance', name: 'void lance', el: 'void', kind: 'beam',
            cost: 20, cd: 5, dmg: 16,
            blurb: 'a line through everything. walls do not count.',
            p: { throughWalls: true },
            glyph: [LINE(6, 50, 94, 50)]
        },
        {
            id: 'singularity', name: 'singularity', el: 'void', kind: 'zone',
            cost: 30, cd: 14, dmg: 0,
            blurb: 'a hole in the middle that swallows spells and chews on whoever is near.',
            p: { dps: 5, dur: 5, w: 120, mid: true, eats: true },
            glyph: [ARC(6, 50, 44, -60, 60), ARC(94, 50, 44, 120, 240)]
        },
        {
            id: 'rift', name: 'rift', el: 'void', kind: 'hex',
            cost: 16, cd: 10, dmg: 0,
            blurb: 'tears twenty five mana out of them and hands you half.',
            p: { manaBurn: 25, manaGain: 12 },
            glyph: [LINE(86, 10, 14, 90)]
        },
        {
            id: 'oblivion', name: 'oblivion', el: 'void', kind: 'bolt',
            cost: 52, cd: 25, dmg: 40,
            blurb: 'the big one. costs everything, travels slowly, ends arguments.',
            p: { speed: 210, r: 24, aoe: 80, pierce: true },
            glyph: [QUAD(8, 50, 50, 10, 92, 50), QUAD(8, 50, 50, 90, 92, 50), CIRCLE(50, 50, 16)]
        },
        {
            id: 'mirror', name: 'mirror', el: 'void', kind: 'buff',
            cost: 22, cd: 12, dmg: 0,
            blurb: 'the next spell that hits you goes back where it came from.',
            p: { status: 'mirror', dur: 6 },
            glyph: [PATH([[12, 16], [12, 84], [88, 16], [88, 84], [12, 16]])]
        }
    ];

    // ---------------------------------------------------------------
    // statuses — what the icons in the health bar mean
    // ---------------------------------------------------------------
    const STATUS = {
        burn: { name: 'burning', icon: 'local_fire_department', color: '#ff6b2b', bad: true },
        chill: { name: 'chilled', icon: 'ac_unit', color: '#6fd6ff', bad: true },
        freeze: { name: 'frozen', icon: 'severe_cold', color: '#bff0ff', bad: true },
        shock: { name: 'shocked', icon: 'bolt', color: '#ffe14d', bad: true },
        stun: { name: 'stunned', icon: 'flare', color: '#fff', bad: true },
        weak: { name: 'weakened', icon: 'trending_down', color: '#a074d8', bad: true },
        root: { name: 'rooted', icon: 'grass', color: '#7ee06a', bad: true },
        blind: { name: 'blinded', icon: 'visibility_off', color: '#7ee06a', bad: true },
        bleed: { name: 'bleeding', icon: 'water_drop', color: '#e4485f', bad: true },
        leech: { name: 'leeched', icon: 'bug_report', color: '#e4485f', bad: true },
        focus: { name: 'focused', icon: 'star', color: '#ffe9a8' },
        thorns: { name: 'thorns', icon: 'psychiatry', color: '#7ee06a' },
        stoneskin: { name: 'stone skin', icon: 'shield', color: '#c8a06a' },
        mirror: { name: 'mirrored', icon: 'flip', color: '#b04dff' },
        phase: { name: 'phased', icon: 'blur_on', color: '#c08cff' },
        overload: { name: 'overloaded', icon: 'battery_charging_full', color: '#ffe14d' },
        well: { name: 'mana well', icon: 'water_full', color: '#c08cff' },
        pact: { name: 'blood pact', icon: 'favorite', color: '#e4485f' }
    };

    // ---------------------------------------------------------------
    // arena + duel constants
    // ---------------------------------------------------------------
    const ARENA = {
        W: 760, H: 400,
        floor: 344, ceil: 60,
        leftX: 96, rightX: 664,
        maxHp: 100, maxMana: 100,
        manaRegen: 7,            // per second
        moveSpeed: 175,          // px per second, up and down only
        rounds: 2,               // first to two rounds takes the duel
        tickHz: 60,
        snapshotHz: 15
    };

    // ---------------------------------------------------------------
    // the dress-up box — every part is drawn in code, no image files
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

    // starting loadout — the eight sigils shown on the quick reference
    const DEFAULT_LOADOUT = ['spark', 'fireball', 'frostbolt', 'magicmissile', 'runeward', 'regrowth', 'smite', 'icewall'];

    window.WZ = {
        EL, SPELLS, STATUS, ARENA, AVATAR,
        DEFAULT_LOADOUT,
        randomAvatar,
        byId: (id) => SPELLS.find(s => s.id === id) || null,
        helpers: { LINE, PATH, CLOSED, ARC, CIRCLE, QUAD, POLY, STAR, ZIG, WAVE, SPIRAL, LEMNISCATE, RAYS }
    };
})();
