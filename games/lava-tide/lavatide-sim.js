// ===================================================================
// lava & tide 98 — the rules: tiles, bodies, pools, buttons, levers,
// platforms, boxes, gems and the two doors
//
// No DOM and no clock. The world steps at a fixed 60 a second, and the same
// inputs from the same state always give the same next state, so node can
// replay a solution and a guest can replay its own keys on top of the host's
// snapshot. The levels and their scripted solutions live here too.
//
// lava (seat 0) dies in water, tide (seat 1) dies in lava, both die in goo.
// ===================================================================
(function (root) {
    'use strict';

    const T = 16, COLS = 28, ROWS = 20, TICK = 60;
    const CW = 10, CH = 20;                 // a character's box
    const RUN = 1.5, GRAV = 0.32, JUMP = 5.4, FALL = 7, STEP = 6;
    const POOL = 5;                         // how far a pool's surface sits below the floor
    const BOX = 15;
    const DOOR_HOLD = 24;                   // frames both have to stand in their doors
    const LEFT = 1, RIGHT = 2, UP = 4;
    const RULES_REV = 1;
    const EPS = 1e-6;
    const { floor, abs, min, max } = Math;

    // ---------------------------------------------------------------
    // the levels
    //
    // map: # wall  . air  L lava pool  W water pool  G goo pool (pools sit in
    // a floor row), r red gem (lava's)  b blue gem (tide's), f lava's start
    // t tide's start, F lava's door  T tide's door. Starts and doors mark the
    // tile a character's feet stand in.
    // objs: ['btn', x, y, ch]                       a plate on the floor of tile (x, y)
    //       ['lever', x, y, ch, on]
    //       ['plat', x, y, w, h, dx, dy, ch, speed] goes (dx, dy) tiles while ch is on
    //       ['lift', x, y, w, h, dx, dy, speed, pause] always on the go
    //       ['box', x, y]
    // par: seconds for an A, with every gem. sol: the solver's script (pilot)
    // ---------------------------------------------------------------
    const LEVELS = [
        {
            name: 'the way in', par: 40,
            hint: 'lava walks through lava, tide walks through water. jump what would kill you.',
            map: [
                '############################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.........r...b............#',
                '#.....................F..T.#',
                '#....#######################',
                '###........................#',
                '###......b.....r...........#',
                '#####......................#',
                '#####......................#',
                '############GG#########....#',
                '#........................###',
                '#........................###',
                '#......................#####',
                '#.f.t...b....r.........#####',
                '#######WW###LL####GG########',
                '############################'
            ],
            objs: [],
            sol: {
                f: [['go', 6], ['jump', 9], ['go', 17], ['jump', 20], ['go', 25], ['jump', 21], ['go', 15], ['jump', 15], ['go', 14], ['jump', 11], ['go', 2], ['jump', 6], ['go', 22]],
                t: [['go', 11], ['jump', 14], ['go', 17], ['jump', 20], ['go', 25], ['jump', 21], ['go', 14], ['jump', 11], ['go', 9], ['jump', 9], ['go', 2], ['jump', 6], ['go', 25]]
            }
        },
        {
            name: 'two roads', par: 30,
            hint: 'the roads split. take the one that will not kill you.',
            map: [
                '############################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.f.t........r.............#',
                '########..##LLLLL######..###',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.............b............#',
                '############WWWWW######..###',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..F.T..b.........r........#',
                '########WW###GG###LL########',
                '############################'
            ],
            objs: [],
            sol: {
                f: [['go', 7], ['jump', 10], ['go', 24], ['go', 15], ['jump', 12], ['go', 10], ['jump', 7], ['go', 3]],
                t: [['go', 9], ['go', 24], ['go', 20], ['jump', 17], ['go', 15], ['jump', 12], ['go', 5]]
            }
        },
        {
            name: 'hold the door', par: 45,
            hint: 'a plate only holds a gate while somebody stands on it. take turns.',
            map: [
                '############################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.................r........#',
                '#..........................#',
                '#.F.T..b...................#',
                '#######################....#',
                '#........................###',
                '#..r.....................###',
                '#......................#####',
                '#.f.t.............b....#####',
                '##################WW########',
                '############################'
            ],
            objs: [['btn', 7, 17, 0], ['btn', 15, 17, 0], ['plat', 11, 14, 1, 4, 0, 4, 0, 2],
                ['btn', 14, 12, 1], ['btn', 6, 12, 1], ['plat', 10, 9, 1, 4, 0, -4, 1, 2]],
            sol: {
                f: [['go', 3], ['jump', 3], ['go', 7], ['sig', 'a'], ['await', 'b'], ['go', 17], ['jump', 20], ['go', 25], ['jump', 21],
                    ['go', 18], ['jump', 18], ['await', 'c'], ['at', 1, 1], ['go', 6], ['sig', 'd'], ['await', 'e'], ['go', 2]],
                t: [['at', 0, 1], ['go', 15], ['sig', 'b'], ['wait', 30], ['go', 25], ['jump', 21], ['go', 14], ['sig', 'c'], ['await', 'd'], ['go', 4], ['sig', 'e']]
            }
        },
        {
            name: 'two switches', par: 50,
            hint: 'a lever stays where you push it. two levers on one lift work like the light switches on a staircase.',
            map: [
                '############################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.....b....................#',
                '#..........................#',
                '#.F.T..........r...........#',
                '#########GG####LL#######..##',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.f.t.....b................#',
                '##########WW############..##',
                '############################'
            ],
            objs: [['lever', 26, 17, 0, 1], ['lever', 20, 12, 0, 0], ['plat', 24, 13, 2, 1, 0, 5, 0, 1]],
            sol: {
                f: [['go', 9], ['jump', 12], ['go', 16], ['await', 'on'], ['go', 26], ['hold', 1, 1], ['await', 'down'], ['at', 0, 1], ['go', 24.5], ['sig', 'lon'], ['at', 0, 0],
                    ['go', 17], ['go', 11], ['jump', 8], ['go', 2]],
                t: [['go', 24.5], ['sig', 'on'], ['at', 0, 0], ['go', 19], ['go', 21], ['sig', 'down'], ['await', 'lon'], ['go', 19],
                    ['go', 17], ['jump', 14], ['go', 11], ['jump', 8], ['go', 6], ['jump', 6], ['go', 4]]
            }
        },
        {
            name: 'the heavy stone', par: 45,
            hint: 'boxes push, boxes hold plates down, and boxes make fine steps.',
            map: [
                '############################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.F.T...b.....r............#',
                '#######WW#####LL#####......#',
                '#..........................#',
                '#.....................######',
                '#.....................######',
                '#.f.t....r....b.......######',
                '############################',
                '############################'
            ],
            objs: [['box', 6, 17], ['btn', 12, 17, 0], ['plat', 16, 14, 1, 4, 0, 4, 0, 2], ['box', 19, 17]],
            sol: {
                f: [['go', 11.22], ['sig', 'box'], ['at', 0, 1], ['jump', 14], ['go', 18], ['go', 22], ['sig', 'up'], ['jump', 19], ['go', 9], ['jump', 6], ['go', 2]],
                t: [['await', 'box'], ['at', 0, 1], ['go', 10], ['jump', 14], ['await', 'up'], ['go', 22], ['jump', 19], ['go', 16], ['jump', 13], ['go', 4]]
            }
        },
        {
            name: 'going up', par: 50,
            hint: 'lifts do not wait. step on when it comes to you.',
            map: [
                '############################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.F.T.....b..r.............#',
                '########LLLLLLLLL#####..####',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.f.t......r..b............#',
                '#######GGGGGGGGGGGG###..####',
                '############################'
            ],
            objs: [['lift', 7, 18, 2, 1, 10, 0, 1, 50], ['lift', 22, 18, 2, 1, 0, -5, 1, 60], ['lift', 15, 13, 2, 1, -8, 0, 1, 50]],
            sol: {
                f: [['go', 6], ['lift', 0, 0], ['go', 7.4], ['at', 0, 1], ['go', 20], ['lift', 1, 0], ['go', 22.4], ['at', 1, 1], ['go', 21], ['await', 'tl'], ['go', 2]],
                t: [['go', 6], ['lift', 0, 0], ['go', 8.2], ['at', 0, 1], ['go', 21], ['lift', 1, 0], ['go', 23], ['at', 1, 1], ['go', 17], ['lift', 2, 0], ['go', 16], ['sig', 'tl'], ['at', 2, 1], ['go', 4]]
            }
        },
        {
            name: 'bridges', par: 45,
            hint: 'stand on a plate and a bridge comes up for the other one.',
            map: [
                '############################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.F.T......r..b............#',
                '#########GGGGGG########....#',
                '#........................###',
                '#........................###',
                '#......................#####',
                '#.f.t.....b..........r.#####',
                '#######WWWWWW####LLLLLL#####',
                '############################'
            ],
            objs: [['btn', 13, 17, 0], ['btn', 16, 17, 1], ['plat', 7, 19, 6, 1, 0, -1, 0, 1], ['plat', 17, 19, 6, 1, 0, -1, 1, 1],
                ['lever', 18, 12, 2, 0], ['plat', 9, 14, 6, 1, 0, -1, 2, 1]],
            sol: {
                f: [['go', 6], ['await', 'b0'], ['at', 0, 1], ['go', 16], ['sig', 'b1'], ['await', 'tx'], ['go', 25], ['jump', 21], ['go', 19], ['jump', 16], ['await', 'lev'], ['at', 2, 1], ['go', 2]],
                t: [['go', 13], ['sig', 'b0'], ['await', 'b1'], ['at', 1, 1], ['go', 25], ['sig', 'tx'], ['jump', 21], ['go', 17], ['go', 19], ['sig', 'lev'], ['jump', 16], ['at', 2, 1], ['go', 4]]
            }
        },
        {
            name: 'dead weight', par: 55,
            hint: 'nobody can hold a plate forever. something heavy can.',
            map: [
                '############################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.F.T..b...................#',
                '#########..###WW#######....#',
                '#........................###',
                '#...............r........###',
                '#......................#####',
                '#.f.t..................#####',
                '##################GG########',
                '############################'
            ],
            objs: [['btn', 10, 17, 0], ['plat', 14, 14, 1, 4, 0, 4, 0, 2], ['box', 12, 12]],
            sol: {
                f: [['go', 9], ['await', 'p'], ['at', 0, 1], ['go', 16], ['jump', 16], ['go', 17], ['jump', 20], ['go', 25], ['jump', 21], ['go', 16], ['jump', 13], ['sig', 'up'],
                    ['await', 'off'], ['go', 10.8], ['wait', 20], ['jump', 7], ['go', 2]],
                t: [['go', 10], ['sig', 'p'], ['await', 'up'], ['go', 7], ['sig', 'off'], ['ch', 0, 1], ['at', 0, 1], ['jump', 12], ['go', 17], ['jump', 20], ['go', 25], ['jump', 21],
                    ['go', 11], ['jump', 7], ['go', 4]]
            }
        },
        {
            name: 'the shaft', par: 60,
            hint: 'two lifts, one plate and one stone. the stone stays behind so you do not have to.',
            map: [
                '############################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#...........r.b............#',
                '#..........................#',
                '#.....................F.T..#',
                '###..#####GG################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '###..#################..####',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.f.t...b...r..............#',
                '########WW##LL########..####',
                '############################'
            ],
            objs: [['lift', 22, 18, 2, 1, 0, -5, 1, 60], ['lift', 3, 13, 2, 1, 0, -5, 1, 60], ['box', 16, 12], ['btn', 10, 12, 0], ['plat', 18, 4, 1, 4, 0, -3, 0, 2]],
            sol: {
                f: [['go', 7], ['jump', 10], ['go', 21], ['lift', 0, 0], ['go', 22.4], ['at', 0, 1], ['go', 18], ['go', 10.78], ['sig', 'box'], ['jump', 7], ['go', 6], ['lift', 1, 0], ['go', 3.3], ['at', 1, 1], ['go', 9], ['jump', 12], ['go', 22]],
                t: [['go', 11], ['jump', 14], ['go', 21], ['lift', 0, 0], ['go', 23], ['at', 0, 1], ['go', 20], ['await', 'box'], ['go', 12], ['jump', 7], ['go', 6], ['lift', 1, 0], ['go', 4], ['at', 1, 1], ['go', 9], ['jump', 12], ['go', 14], ['jump', 14], ['go', 24]]
            }
        },
        {
            name: 'all hands', par: 75,
            hint: 'everything you have learned, in one go. who goes first matters.',
            map: [
                '############################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.F.T....br................#',
                '#######GGGGGG..########....#',
                '#........................###',
                '#........................###',
                '#......................#####',
                '#.f.t...b.........r....#####',
                '######WWWWWW####LLLLLL######',
                '############################'
            ],
            objs: [['plat', 6, 19, 6, 1, 0, -1, 0, 1], ['plat', 16, 19, 6, 1, 0, -1, 1, 1], ['plat', 17, 9, 1, 4, 0, -4, 2, 2], ['lift', 13, 13, 2, 1, -6, 0, 1, 60],
                ['lever', 13, 17, 0, 0], ['btn', 22, 17, 1], ['btn', 19, 12, 2], ['box', 21, 12]],
            sol: {
                f: [['await', 'lev'], ['at', 0, 1], ['go', 22], ['sig', 'b1'], ['await', 'tx'], ['go', 25], ['jump', 22], ['go', 19.78], ['sig', 'box'], ['at', 2, 1], ['jump', 16], ['go', 15], ['lift', 3, 0], ['go', 13.6], ['at', 3, 1], ['go', 2]],
                t: [['go', 15], ['sig', 'lev'], ['await', 'b1'], ['at', 1, 1], ['go', 25], ['sig', 'tx'], ['jump', 22], ['await', 'box'], ['at', 2, 1], ['go', 21], ['jump', 16], ['go', 15], ['lift', 3, 0], ['go', 14.1], ['at', 3, 1], ['go', 4]]
            }
        },
        {
            name: 'the furnace', par: 70,
            hint: 'all the way down. a lever you walk back over is a lever you switch back: hop it.',
            map: [
                '############################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.f.t....r.b...............#',
                '########LLLLL###..##########',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.......rb.................#',
                '##..##GGGGGG################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#...............b...r...F.T#',
                '################WW##LL######',
                '############################'
            ],
            objs: [['lift', 7, 8, 2, 1, 5, 0, 1, 60], ['plat', 6, 14, 6, 1, 0, -1, 0, 1], ['plat', 13, 14, 1, 4, 0, 4, 1, 2],
                ['lever', 20, 12, 0, 0], ['btn', 11, 17, 1], ['btn', 15, 17, 1]],
            sol: {
                f: [['await', 'tl'], ['wait', 40], ['go', 15], ['go', 16.5], ['await', 'lev'], ['at', 1, 1], ['go', 2.5], ['await', 'h'], ['at', 2, 1], ['go', 15], ['sig', 'lp'], ['await', 'tp'], ['jump', 18], ['go', 24]],
                t: [['go', 6], ['lift', 0, 0], ['go', 8.4], ['sig', 'tl'], ['at', 0, 1], ['go', 15], ['go', 16.5], ['go', 21], ['sig', 'lev'], ['jump', 17], ['at', 1, 1], ['go', 2.5], ['go', 11], ['sig', 'h'], ['await', 'lp'], ['go', 19], ['sig', 'tp'], ['jump', 22], ['go', 26]]
            }
        },
        {
            name: 'the last door', par: 90,
            hint: 'up, up and out. take the stone, mind the lever, ride every lift.',
            map: [
                '############################',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#......b...r...........F.T.#',
                '##..###WW##LL##GG###########',
                '#..........................#',
                '#................b.........#',
                '#..........................#',
                '#......r...................#',
                '##..#GGGGG############..####',
                '#..........................#',
                '#..........................#',
                '#..........................#',
                '#.f.t....r.b...r..b........#',
                '#######GGGGGG##LL#WW###..###',
                '############################'
            ],
            objs: [['lift', 7, 18, 2, 1, 4, 0, 1, 60], ['lift', 22, 18, 2, 1, 0, -5, 1, 60], ['plat', 14, 9, 1, 4, 0, 4, 0, 2], ['plat', 5, 14, 5, 1, 0, -1, 1, 1], ['lift', 2, 13, 2, 1, 0, -5, 1, 60],
                ['box', 20, 12], ['btn', 17, 12, 0], ['lever', 12, 12, 1, 0]],
            sol: {
                f: [['go', 6], ['lift', 0, 0], ['go', 7.4], ['at', 0, 1], ['go', 13], ['go', 17], ['jump', 20], ['go', 21], ['lift', 1, 0], ['go', 22.4], ['at', 1, 1], ['go', 21], ['go', 17.78], ['sig', 'box'], ['at', 2, 1],
                    ['jump', 15], ['await', 'lev'], ['go', 13], ['at', 3, 1], ['jump', 10], ['go', 4], ['lift', 4, 0], ['go', 2.4], ['at', 4, 1], ['go', 6], ['jump', 9], ['go', 14], ['jump', 17], ['go', 23]],
                t: [['go', 6], ['lift', 0, 0], ['go', 8.2], ['at', 0, 1], ['go', 13], ['go', 14], ['jump', 17], ['go', 21], ['lift', 1, 0], ['go', 23], ['at', 1, 1], ['go', 21], ['await', 'box'], ['at', 2, 1], ['go', 19], ['jump', 15],
                    ['go', 11], ['go', 13], ['sig', 'lev'], ['jump', 10], ['at', 3, 1], ['go', 4], ['lift', 4, 0], ['go', 3], ['at', 4, 1], ['go', 10], ['jump', 13], ['go', 14], ['jump', 17], ['go', 25]]
            }
        }
    ];

    // ---------------------------------------------------------------
    // a level, built once
    // ---------------------------------------------------------------
    const built = [];
    function build(lv) {
        if (built[lv]) return built[lv];
        const def = LEVELS[lv];
        if (!def) throw new Error('no level ' + lv);
        const grid = [], rects = [], gems = [], doors = [null, null], spawn = [null, null];
        for (let y = 0; y < ROWS; y++) {
            const row = def.map[y] || '';
            grid.push([]); rects.push([]);
            for (let x = 0; x < COLS; x++) {
                const ch = row[x] || '#';
                let k = 0;
                if (ch === '#') k = 1;
                else if (ch === 'L') k = 2;
                else if (ch === 'W') k = 3;
                else if (ch === 'G') k = 4;
                else if (ch === 'r' || ch === 'b') gems.push({ x, y, k: ch === 'r' ? 0 : 1 });
                else if (ch === 'F') doors[0] = { x, y };
                else if (ch === 'T') doors[1] = { x, y };
                else if (ch === 'f') spawn[0] = { x, y };
                else if (ch === 't') spawn[1] = { x, y };
                grid[y].push(k);
                rects[y].push(k === 1 ? { x: x * T, y: y * T, w: T, h: T, k } : k > 1 ? { x: x * T, y: y * T + POOL, w: T, h: T - POOL, k } : null);
            }
        }
        if (!doors[0] || !doors[1] || !spawn[0] || !spawn[1]) throw new Error('level ' + (lv + 1) + ' needs both doors and both starts');
        const b = { lv, def, grid, rects, gems, doors, spawn, objs: def.objs || [] };
        built[lv] = b;
        return b;
    }

    function newLevel(lv, seed) {
        const B = build(lv);
        const s = {
            rev: RULES_REV, lv, seed: (seed || 0) >>> 0, t: 0, ph: 'play', doorT: 0, endT: 0, B,
            chars: [0, 1].map(i => ({ i, x: B.spawn[i].x * T + (T - CW) / 2, y: (B.spawn[i].y + 1) * T - CH, w: CW, h: CH, vx: 0, vy: 0, g: true, onP: -1, dead: false, face: i ? -1 : 1, inDoor: false })),
            boxes: [], plats: [], btns: [], levers: [],
            gems: B.gems.map(g => ({ x: g.x, y: g.y, k: g.k, got: false })),
            events: [], inputs: [0, 0], all: []
        };
        for (const o of B.objs) {
            if (o[0] === 'btn') s.btns.push({ x: o[1], y: o[2], ch: o[3], down: false });
            else if (o[0] === 'lever') s.levers.push({ x: o[1], y: o[2], ch: o[3], on: !!o[4] });
            else if (o[0] === 'box') s.boxes.push({ x: o[1] * T + (T - BOX) / 2, y: (o[2] + 1) * T - BOX, w: BOX, h: BOX, vx: 0, vy: 0, g: true, onP: -1, box: true });
            else if (o[0] === 'plat' || o[0] === 'lift') {
                const lift = o[0] === 'lift';
                const ax = o[1] * T, ay = o[2] * T, bx = ax + o[5] * T, by = ay + o[6] * T;
                const spd = (lift ? o[7] : o[8]) || 1;
                const dist = Math.hypot(bx - ax, by - ay) || 1;
                s.plats.push({ x: ax, y: ay, w: o[3] * T, h: o[4] * T, ax, ay, bx, by, dp: spd / dist, p: 0, ch: lift ? -1 : o[7], lift, dir: 1, wait: 0, pause: lift ? (o[8] || 45) : 0 });
            }
        }
        s.all = s.chars.concat(s.boxes);
        // a lift starts by waiting at its first stop; a platform starts where its channel puts it
        for (const p of s.plats) {
            if (p.lift) p.wait = p.pause;
            else if (active(s, p.ch)) { p.p = 1; p.x = p.bx; p.y = p.by; }
        }
        return s;
    }

    // ---------------------------------------------------------------
    // collision: everything solid is a rectangle something already owns
    // ---------------------------------------------------------------
    const hits = [];
    const over = (a, r) => a.x < r.x + r.w - EPS && a.x + a.w > r.x + EPS && a.y < r.y + r.h - EPS && a.y + a.h > r.y + EPS;
    // what b overlaps right now: tiles, platforms (bar exP), boxes (bar b itself)
    function solids(s, b, exP) {
        hits.length = 0;
        const R = s.B.rects;
        const x0 = floor(b.x / T), x1 = floor((b.x + b.w - EPS) / T), y0 = floor(b.y / T), y1 = floor((b.y + b.h - EPS) / T);
        for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
            if (ty < 0 || ty >= ROWS || tx < 0 || tx >= COLS) {
                // the world's edge is a wall; one shared rect, used straight away
                hits.push({ x: tx * T, y: ty * T, w: T, h: T, k: 1 });
                continue;
            }
            const r = R[ty][tx];
            if (r && over(b, r)) hits.push(r);
        }
        for (let i = 0; i < s.plats.length; i++) if (i !== exP && over(b, s.plats[i])) hits.push(s.plats[i]);
        for (const x of s.boxes) if (x !== b && over(b, x)) hits.push(x);
        return hits;
    }
    function blockedAt(s, b, exP) { return solids(s, b, exP).length > 0; }

    // sideways. A character shoves boxes; a box shoves the next box
    function moveX(s, b, dx, exP, depth) {
        if (!dx) return false;
        b.x += dx;
        let blocked = false;
        if ((depth || 0) < 3) {
            for (const x of s.boxes) {
                if (x === b || !over(b, x)) continue;
                // only what is beside, not what is under or on top
                if (x.y + x.h <= b.y + 2 || x.y >= b.y + b.h - 2) continue;
                const push = dx > 0 ? b.x + b.w - x.x : -(x.x + x.w - b.x);
                moveX(s, x, push, -1, (depth || 0) + 1);
            }
        }
        const list = solids(s, b, exP);
        for (let i = 0; i < list.length; i++) {
            const r = list[i];
            if (!over(b, r)) continue;
            b.x = dx > 0 ? r.x - b.w : r.x + r.w;
            blocked = true;
        }
        return blocked;
    }
    // up and down. Landing remembers on which platform
    function moveY(s, b, dy, exP) {
        if (!dy) return false;
        b.y += dy;
        let blocked = false;
        const list = solids(s, b, exP);
        for (let i = 0; i < list.length; i++) {
            const r = list[i];
            if (!over(b, r)) continue;
            if (dy > 0) { b.y = r.y - b.h; b.g = true; b.onP = s.plats.indexOf(r); }
            else b.y = r.y + r.h;
            blocked = true;
        }
        if (blocked) b.vy = 0;
        return blocked;
    }

    // ---------------------------------------------------------------
    // channels and platforms
    // ---------------------------------------------------------------
    function active(s, ch) {
        // plates hold a channel on; levers on one channel work like a
        // two-way light switch: flipping either one flips it
        for (const b of s.btns) if (b.ch === ch && b.down) return true;
        let on = false;
        for (const l of s.levers) if (l.ch === ch && l.on) on = !on;
        return on;
    }
    const saved = [];
    function stepPlats(s) {
        const all = s.all;
        for (let i = 0; i < s.plats.length; i++) {
            const p = s.plats[i];
            let goal;
            if (p.lift) {
                if (p.wait > 0) { p.wait--; continue; }
                goal = p.dir > 0 ? 1 : 0;
                if (p.p === goal) { p.dir = -p.dir; p.wait = p.pause; continue; }
            } else goal = active(s, p.ch) ? 1 : 0;
            if (p.p === goal) continue;
            const np = goal > p.p ? min(goal, p.p + p.dp) : max(goal, p.p - p.dp);
            const nx = p.ax + (p.bx - p.ax) * np, ny = p.ay + (p.by - p.ay) * np;
            const dx = nx - p.x, dy = ny - p.y;
            const ox = p.x, oy = p.y, op = p.p;
            saved.length = 0;
            for (const b of all) saved.push(b.x, b.y, b.g, b.onP, b.vy);
            p.x = nx; p.y = ny; p.p = np;
            let ok = true;
            // what rides on it goes with it
            for (const r of all) {
                if ((r.dead) || !r.g || r.onP !== i) continue;
                r.ride = true;
                if (dx) moveX(s, r, dx, i, 0);
                if (dy < 0) { r.y += dy; if (blockedAt(s, r, i)) { ok = false; break; } }
                else if (dy > 0) moveY(s, r, dy, -1);
            }
            // what is in its way is lifted or shoved, or stops it
            if (ok) for (const b of all) {
                if (b.dead || b.ride || !over(b, p)) continue;
                if (dy < 0 && b.y + b.h <= oy + 2) { b.y = p.y - b.h; b.vy = max(0, b.vy); b.g = true; b.onP = i; if (blockedAt(s, b, i)) { ok = false; break; } }
                else if (dx) {
                    const push = dx > 0 ? p.x + p.w - b.x : -(b.x + b.w - p.x);
                    moveX(s, b, push, i, 0);
                    if (over(b, p)) { ok = false; break; }
                } else { ok = false; break; }
            }
            for (const b of all) b.ride = false;
            if (!ok) {
                p.x = ox; p.y = oy; p.p = op;
                for (let k = 0; k < all.length; k++) { const b = all[k]; b.x = saved[k * 5]; b.y = saved[k * 5 + 1]; b.g = saved[k * 5 + 2]; b.onP = saved[k * 5 + 3]; b.vy = saved[k * 5 + 4]; }
                if (p.lift) p.dir = -p.dir;
            } else if (p.p === goal) s.events.push({ e: 'stop', i });
        }
    }

    // ---------------------------------------------------------------
    // a character's frame
    // ---------------------------------------------------------------
    function stepChar(s, c, bits) {
        if (c.dead) return;
        const dir = (bits & RIGHT ? 1 : 0) - (bits & LEFT ? 1 : 0);
        c.vx = dir * RUN;
        if (dir) c.face = dir;
        if (bits & UP && c.g) { c.vy = -JUMP; c.g = false; c.onP = -1; s.events.push({ e: 'jump', i: c.i }); }
        c.vy = min(FALL, c.vy + GRAV);
        if (c.vx) {
            const x0 = c.x, y0 = c.y;
            if (moveX(s, c, c.vx, -1, 0) && c.g) {
                // a lip up to STEP high is walked over, like a pool's far edge
                const xb = c.x;
                c.x = x0; c.y = y0 - STEP;
                if (!blockedAt(s, c, -1)) {
                    moveX(s, c, c.vx, -1, 0);
                    if (abs(c.x - x0) <= abs(xb - x0) + EPS) { c.x = xb; c.y = y0; }
                } else { c.x = xb; c.y = y0; }
            }
        }
        const was = c.g;
        c.g = false; c.onP = -1;
        moveY(s, c, c.vy, -1);
        if (c.g && !was) s.events.push({ e: 'land', i: c.i });
    }
    function stepBox(s, b) {
        b.vy = min(FALL, b.vy + GRAV);
        b.g = false; b.onP = -1;
        moveY(s, b, b.vy, -1);
    }

    // what kills, what is picked up, what is pressed
    function feetIn(s, c) {
        const R = s.B.rects;
        const fy = floor((c.y + c.h + 1) / T);
        if (fy < 0 || fy >= ROWS) return 0;
        const x0 = floor((c.x + 2) / T), x1 = floor((c.x + c.w - 2 - EPS) / T);
        let worst = 0;
        for (let tx = x0; tx <= x1; tx++) {
            const r = R[fy][tx];
            if (!r || r.k < 2 || c.y + c.h < r.y - 1) continue;
            if (r.k === 4) return 4;
            if ((c.i === 0 && r.k === 3) || (c.i === 1 && r.k === 2)) worst = r.k;
        }
        return worst;
    }
    function doorIn(s, c) {
        const d = s.B.doors[c.i];
        return !c.dead && c.g && abs(c.x + c.w / 2 - (d.x * T + T / 2)) <= 4 && abs(c.y + c.h - (d.y + 1) * T) < 1;
    }
    function stepWorld(s) {
        for (const c of s.chars) {
            if (c.dead) continue;
            const k = feetIn(s, c);
            if (k) { c.dead = true; s.events.push({ e: 'die', i: c.i, k }); }
            for (let gi = 0; gi < s.gems.length; gi++) {
                const g = s.gems[gi];
                if (g.got || g.k !== c.i) continue;
                if (c.x < g.x * T + 13 && c.x + c.w > g.x * T + 3 && c.y < g.y * T + 13 && c.y + c.h > g.y * T + 3) { g.got = true; s.events.push({ e: 'gem', i: c.i, g: gi }); }
            }
            if (c.vx) for (const l of s.levers) {
                if (c.x < l.x * T + 12 && c.x + c.w > l.x * T + 4 && c.y < l.y * T + T && c.y + c.h > l.y * T) {
                    const on = c.vx > 0;
                    if (on !== l.on) { l.on = on; s.events.push({ e: 'lever', i: c.i }); }
                }
            }
            c.inDoor = doorIn(s, c);
        }
        for (const b of s.btns) {
            const fy = (b.y + 1) * T, bx = b.x * T;
            let down = false;
            for (const x of s.all) if (!x.dead && x.g && abs(x.y + x.h - fy) < 1 && x.x < bx + 13 && x.x + x.w > bx + 3) { down = true; break; }
            if (down !== b.down) { b.down = down; s.events.push({ e: down ? 'press' : 'release' }); }
        }
        if (s.chars[0].dead || s.chars[1].dead) { s.ph = 'dead'; s.endT = s.t; return; }
        if (s.chars[0].inDoor && s.chars[1].inDoor) {
            if (++s.doorT >= DOOR_HOLD) { s.ph = 'won'; s.endT = s.t; s.events.push({ e: 'won' }); }
        } else s.doorT = 0;
    }

    // one fixed step. a and b are lava's and tide's keys. hold (1 lava,
    // 2 tide) leaves a character where it is for the step: the host does that
    // to a guest's character until the guest's keys for the step arrive, so
    // it plays every key exactly once, in order, and goes where it went for
    // the guest
    function step(s, a, b, hold) {
        if (s.ph !== 'play') return s;
        a = a & 7; b = b & 7;
        s.inputs[0] = a; s.inputs[1] = b;
        s.t++;
        stepPlats(s);
        if (!(hold & 1)) stepChar(s, s.chars[0], a);
        if (!(hold & 2)) stepChar(s, s.chars[1], b);
        for (const x of s.boxes) stepBox(s, x);
        stepWorld(s);
        return s;
    }

    // ---------------------------------------------------------------
    // how it went
    // ---------------------------------------------------------------
    function gemCount(s) { let n = 0; for (const g of s.gems) if (g.got) n++; return n; }
    function rank(s) {
        const n = gemCount(s), all = s.gems.length, secs = (s.endT || s.t) / TICK, par = LEVELS[s.lv].par;
        const allGems = n >= all;
        if (allGems && secs <= par) return 'A';
        if ((allGems || secs <= par) && n * 2 >= all) return 'B';
        return 'C';
    }
    const RANK_ORDER = { A: 3, B: 2, C: 1 };
    const better = (a, b) => (RANK_ORDER[a] || 0) > (RANK_ORDER[b] || 0);

    // ---------------------------------------------------------------
    // the wire: the whole state, small, read back with suspicion
    // ---------------------------------------------------------------
    function snapshot(s) {
        let gm = 0, bt = 0, lv = 0;
        s.gems.forEach((g, i) => { if (g.got) gm |= 1 << i; });
        s.btns.forEach((b, i) => { if (b.down) bt |= 1 << i; });
        s.levers.forEach((l, i) => { if (l.on) lv |= 1 << i; });
        return {
            v: RULES_REV, l: s.lv, t: s.t, ph: s.ph, dT: s.doorT, eT: s.endT, gm, bt, lv, in: s.inputs.slice(),
            c: s.chars.map(c => [c.x, c.y, c.vx, c.vy, c.g ? 1 : 0, c.onP, c.dead ? 1 : 0, c.face]),
            x: s.boxes.map(b => [b.x, b.y, b.vy, b.g ? 1 : 0, b.onP]),
            p: s.plats.map(p => [p.x, p.y, p.p, p.dir, p.wait])
        };
    }
    const num = v => typeof v === 'number' && Number.isFinite(v) && abs(v) < 1e7;
    const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    const rows = (a, n, w) => Array.isArray(a) && a.length === n && a.every(r => Array.isArray(r) && r.length === w && r.every(num));
    // a state from the host, or nothing changes. True when it took
    function applySnapshot(s, d) {
        if (!d || typeof d !== 'object' || d.v !== RULES_REV || d.l !== s.lv) return false;
        if (!isInt(d.t, 0, 1e9) || !['play', 'dead', 'won'].includes(d.ph) || !isInt(d.dT, 0, 1e4) || !isInt(d.eT, 0, 1e9)) return false;
        if (!isInt(d.gm, 0, 2 ** 31) || !isInt(d.bt, 0, 2 ** 31) || !isInt(d.lv, 0, 2 ** 31)) return false;
        if (!rows(d.c, 2, 8) || !rows(d.x, s.boxes.length, 5) || !rows(d.p, s.plats.length, 5)) return false;
        s.t = d.t; s.ph = d.ph; s.doorT = d.dT; s.endT = d.eT;
        if (Array.isArray(d.in) && d.in.length === 2) { s.inputs[0] = isInt(d.in[0], 0, 7) ? d.in[0] : 0; s.inputs[1] = isInt(d.in[1], 0, 7) ? d.in[1] : 0; }
        s.gems.forEach((g, i) => { g.got = !!(d.gm & (1 << i)); });
        s.btns.forEach((b, i) => { b.down = !!(d.bt & (1 << i)); });
        s.levers.forEach((l, i) => { l.on = !!(d.lv & (1 << i)); });
        const plat = v => (isInt(v, -1, s.plats.length - 1) ? v : -1);
        s.chars.forEach((c, i) => {
            const a = d.c[i];
            c.x = a[0]; c.y = a[1]; c.vx = a[2]; c.vy = a[3]; c.g = !!a[4]; c.onP = plat(a[5]); c.dead = !!a[6]; c.face = a[7] < 0 ? -1 : 1;
            c.inDoor = doorIn(s, c);
        });
        s.boxes.forEach((b, i) => { const a = d.x[i]; b.x = a[0]; b.y = a[1]; b.vy = a[2]; b.g = !!a[3]; b.onP = plat(a[4]); });
        s.plats.forEach((p, i) => { const a = d.p[i]; p.x = a[0]; p.y = a[1]; p.p = max(0, min(1, a[2])); p.dir = a[3] < 0 ? -1 : 1; p.wait = max(0, floor(a[4])); });
        return true;
    }
    function clone(s) {
        const c = newLevel(s.lv, s.seed);
        applySnapshot(c, snapshot(s));
        return c;
    }

    // ---------------------------------------------------------------
    // the pilot: plays a level from a script. One per character, and the
    // flags are shared between the two, so they can wait for each other.
    //
    //   ['go', x]           walk to column x, hopping anything in the way
    //   ['jump', x]         jump (now, or on landing) towards column x
    //   ['wait', n]         stand still n frames
    //   ['hold', keys, n]   raw keys for n frames
    //   ['sig', name]       tell the other one
    //   ['await', name]     wait until the other one says so
    //   ['ch', c, on]       wait until channel c is on (1) or off (0)
    //   ['lift', i, end]    wait for lift i to have just stopped at end 0 or 1
    //   ['at', i, end]      wait until platform i is all the way at end 0 or 1
    // ---------------------------------------------------------------
    function pilot(steps) { return { steps: steps || [], i: 0, st: 0, n: 0, lastX: NaN, stuck: 0, air: false }; }
    function nextStep(P) { P.i++; P.st = 0; P.n = 0; P.stuck = 0; P.lastX = NaN; P.air = false; }
    function drive(s, who, P, flags) {
        const c = s.chars[who];
        for (let guard = 0; guard < 16; guard++) {
            const st = P.steps[P.i];
            if (!st || c.dead) return 0;
            const op = st[0], cx = c.x + c.w / 2;
            if (op === 'go' || (op === 'jump' && P.st === 2)) {
                const d = st[1] * T + T / 2 - cx;
                if (abs(d) <= 0.76) { if (c.g) { nextStep(P); continue; } return 0; }
                let bits = d > 0 ? RIGHT : LEFT;
                if (c.g && P.lastX === cx) P.stuck++; else P.stuck = 0;
                P.lastX = cx;
                if (P.stuck >= 2 && c.g) { bits |= UP; P.stuck = 0; }
                return bits;
            }
            if (op === 'jump') {
                const d = st[1] * T + T / 2 - cx;
                const dir = abs(d) <= 0.76 ? 0 : d > 0 ? RIGHT : LEFT;
                if (P.st === 0) { if (!c.g) return 0; P.st = 1; return UP | dir; }
                if (!c.g) { P.air = true; return dir; }
                if (!P.air) return UP | dir;
                if (!dir) { nextStep(P); continue; }
                P.st = 2; P.lastX = NaN; continue;
            }
            if (op === 'wait' || op === 'hold') {
                const n = op === 'wait' ? st[1] : st[2];
                if (P.n >= n) { nextStep(P); continue; }
                P.n++;
                return op === 'wait' ? 0 : st[1];
            }
            if (op === 'sig') { flags[st[1]] = true; nextStep(P); continue; }
            if (op === 'await') { if (flags[st[1]]) { nextStep(P); continue; } return 0; }
            if (op === 'ch') { if (active(s, st[1]) === !!st[2]) { nextStep(P); continue; } return 0; }
            if (op === 'lift') {
                // a lift that has just come to a stop at this end
                const p = s.plats[st[1]];
                if (p.p === st[2] && p.wait >= p.pause - 15) { nextStep(P); continue; }
                return 0;
            }
            if (op === 'at') { if (s.plats[st[1]].p === st[2]) { nextStep(P); continue; } return 0; }
            throw new Error('unknown pilot step ' + op);
        }
        return 0;
    }
    // a level's own solution, both characters, start to finish
    function autopilot(lv) {
        const sol = LEVELS[lv].sol || { f: [], t: [] };
        const a = pilot(sol.f), b = pilot(sol.t), flags = {};
        return { a, b, flags, keys: s => [drive(s, 0, a, flags), drive(s, 1, b, flags)] };
    }

    root.LT_SIM = {
        T, COLS, ROWS, TICK, CW, CH, RUN, GRAV, JUMP, BOX, POOL, DOOR_HOLD, LEFT, RIGHT, UP, RULES_REV, LEVELS,
        build, newLevel, step, active, rank, better, gemCount, snapshot, applySnapshot, clone, pilot, drive, autopilot, doorIn
    };
})(typeof window === 'undefined' ? globalThis : window);
