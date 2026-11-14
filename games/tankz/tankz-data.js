// ===================================================================
// tankz 98 — every number the game has, and nothing else
//
// Tanks in a maze, seen from above. A shell bounces off walls until it
// runs out of time, and it does not care whose it is: yours can get you.
// The last tank standing takes the round; the first to the match's points
// takes the match. Files dropped on the floor are weapons, one use each.
//
// Units are maze units (a cell is 64 of them), seconds and ticks. The sim
// runs at a fixed 60 ticks a second on every screen.
//
// Tune here, then run:  node .github/scripts/check-tankz.mjs --report
// ===================================================================
(function (root) {
    'use strict';

    const TK = {
        TICK: 60,
        CELL: 64,
        WALL: 6,                  // wall thickness, centred on the grid line
        // the tank: a circle against walls, a box against shells
        TANK_R: 15,
        BODY_L: 26, BODY_W: 20,
        BARREL: 17,               // from the centre to the muzzle
        SPEED: 118,               // forward, units a second
        BACK: 82,
        TURN: 3.5,                // radians a second

        // the plain shell
        SHELL_SPEED: 190,
        SHELL_R: 3,
        SHELL_LIFE: 9,            // seconds before it fizzles
        SHELLS: 5,                // at most this many of yours in the air
        FIRE_GAP: 0.09,           // seconds between two shots

        // a round
        READY: 1.1,               // frozen at the start, the maze on the screen
        AFTER: 2.6,               // after the last-but-one tank goes, before the point is given
        DRAW_AT: 150,             // seconds: a round this long is called a draw
        POINTS: [5, 3, 10],       // first to this many takes the match

        // the maze: columns and rows for a tank count, then a size choice on top
        SIZES: [
            { id: 'medium', name: 'medium', add: 0 },
            { id: 'small', name: 'small', add: -1 },
            { id: 'large', name: 'large', add: 2 }
        ],
        LOOPS: 0.2,               // of the inner walls a spanning maze keeps, this many come down again

        // files on the floor
        DROP_FIRST: 3,            // seconds into a round before the first
        DROP_EVERY: [5, 9],       // then one every this many seconds
        DROP_MAX: 3,              // on the floor at once (one more with five or more tanks)
        PICK_R: 18,
        WEAPONS: [
            // a straight line of light: bounces, and the first tank it touches is gone
            { id: 'beam', name: 'beam.exe', glyph: '⚡', col: '#ff2020', range: 1100, bounces: 7, aim: 0.38 },
            // a fat shell; fire again and it bursts into shrapnel
            { id: 'frag', name: 'shrapnel.zip', glyph: '✱', col: '#c08000', speed: 150, life: 4.5, r: 5, bits: 22, bitSpeed: 290, bitLife: 0.42 },
            // flies straight for a second, then goes for the nearest tank, whoever's
            { id: 'seeker', name: 'seeker.dll', glyph: '➤', col: '#8000c0', speed: 150, life: 9, wait: 1.0, steer: 3.4, r: 4 },
            // left behind you, armed after a moment, seen by nobody but you
            { id: 'mine', name: 'landmine.sys', glyph: '✚', col: '#404040', arm: 1.2, r: 11, bits: 18 },
            // hold fire: a stream of small shells
            { id: 'burst', name: 'burst.bat', glyph: '≡', col: '#0060c0', count: 24, every: 0.05, speed: 235, life: 2.4, spread: 0.13, r: 2 },
            // one shot, a cone of pellets
            { id: 'scatter', name: 'scatter.ini', glyph: '⁂', col: '#008000', count: 9, cone: 0.36, speed: 220, life: 1.5, r: 2 }
        ],

        // one colour per seat; the first is yours in a solo game
        COLORS: [
            { id: 'red', css: '#d82020', dark: '#7a0c0c' },
            { id: 'yellow', css: '#f2d01a', dark: '#806a00' },
            { id: 'navy', css: '#2030b8', dark: '#0c1258' },
            { id: 'white', css: '#f0f0f0', dark: '#808080' },
            { id: 'magenta', css: '#c020c0', dark: '#5c0a5c' },
            { id: 'orange', css: '#ff8010', dark: '#803c00' },
            { id: 'black', css: '#303030', dark: '#000000' },
            { id: 'lime', css: '#70e040', dark: '#2e6a10' }
        ],
        MAX_TANKS: 8,
        MAX_LOCAL: 3,             // people at one keyboard

        // `every`: ticks between looks. `aim`: radians of error. `bounces`: how many
        // walls a shot it plans may come off. `fans`: angles it tries per look.
        // `dodge`: how well it sees a shell coming. `wait`: seconds of doubt
        // before it pulls the trigger on a shot it found
        BOTS: {
            easy: { name: 'easy', every: 14, aim: 0.09, bounces: 1, fans: 10, dodge: 0.25, wait: 0.45, range: 520 },
            normal: { name: 'normal', every: 7, aim: 0.035, bounces: 2, fans: 18, dodge: 0.6, wait: 0.18, range: 800 },
            hard: { name: 'hard', every: 4, aim: 0.012, bounces: 3, fans: 28, dodge: 0.95, wait: 0.05, range: 1100 }
        },
        BOT_NAMES: ['clippy', 'dialup', 'bonzi', 'winamp', 'qbasic', 'modem', 'zipdisk', 'netzero', 'dosbox', 'floppy']
    };
    TK.WEAPON_BY_ID = {};
    for (const w of TK.WEAPONS) TK.WEAPON_BY_ID[w.id] = w;
    TK.SIZE_BY_ID = {};
    for (const z of TK.SIZES) TK.SIZE_BY_ID[z.id] = z;

    root.TK = TK;
})(typeof window !== 'undefined' ? window : globalThis);
