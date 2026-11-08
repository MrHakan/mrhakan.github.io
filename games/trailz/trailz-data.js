// ===================================================================
// trailz 98 — every number the game has, and nothing else
//
// A light cycle game: cycles go forward on a grid, turn at right angles, and
// leave a wall behind them. Touch any wall, yours included, and you are out.
// The last one going takes the round.
//
// Units are arena units (a grid square is 5 of them), seconds and ticks. The
// sim runs at a fixed 60 ticks a second on every screen, so a number here
// means the same thing in node, on the host and on a guest.
//
// Tune here, then run:  node .github/scripts/check-trailz.mjs --report
// ===================================================================
(function (root) {
    'use strict';

    const TZ = {
        TICK: 60,                 // sim steps a second
        BASE_SPEED: 18,           // units a second on open floor
        MAX_SPEED: 42,            // what grinding can get you to
        GRIND_RANGE: 4.5,         // a wall closer than this, to your side, pulls you along
        GRIND_ACCEL: 22,          // units a second per second, right up against it
        DECAY: 5,                 // back down to base speed once you leave the wall
        RECOVER: 14,              // and back up to it after the brake
        BRAKE_SPEED: 0.5,         // the brake holds you at half of base speed
        BRAKE_DECEL: 34,
        BRAKE_DRAIN: 0.55,        // a full brake lasts about two seconds
        BRAKE_FILL: 0.2,          // and takes five to fill again
        TURN_GAP: 6,              // ticks between two turns: no instant u-turn onto your own wall
        WALL_LINGER: 1.4,         // seconds a dead cycle's wall stays up
        WALL_FADE: 1.1,           // and how long it takes to go
        COUNTDOWN: 3,             // seconds frozen at the start of a round
        ROUND_END: 3,             // seconds between rounds
        RAMP_AFTER: 35,           // after this long a round gets faster, so none goes on forever
        RAMP: 0.035,              // of base speed, every second after that
        // a guest's turn reaches the host late. The host moves the cycle back to where
        // the guest pressed, as long as it is no further back than this many seconds of driving
        REWIND: 0.5,
        // a guest a little ahead of the host gets its turn at the place it pressed it
        AHEAD: 0.4,
        MAX_SEATS: 8,
        MIN_SEATS: 2,

        // the size with eight cycles on it; two get 62% of that, and it grows in between
        ARENAS: [
            { id: 'small', name: 'small', size: 150 },
            { id: 'medium', name: 'medium', size: 200 },
            { id: 'large', name: 'large', size: 260 }
        ],

        // outliving somebody is a point; the last one going gets the bonus on top
        POINT_OUTLIVE: 1,
        POINT_WIN: 2,
        ROUNDS: [3, 5, 9],

        // one colour per seat. The first is yours in a solo game
        COLORS: [
            { id: 'cyan', rgb: [0.15, 0.95, 1.0], css: '#26f2ff' },
            { id: 'orange', rgb: [1.0, 0.55, 0.1], css: '#ff8c1a' },
            { id: 'magenta', rgb: [1.0, 0.2, 0.85], css: '#ff33d9' },
            { id: 'lime', rgb: [0.5, 1.0, 0.2], css: '#80ff33' },
            { id: 'yellow', rgb: [1.0, 0.92, 0.2], css: '#ffeb33' },
            { id: 'red', rgb: [1.0, 0.18, 0.2], css: '#ff2e33' },
            { id: 'violet', rgb: [0.6, 0.4, 1.0], css: '#9966ff' },
            { id: 'white', rgb: [0.92, 0.95, 1.0], css: '#ebf2ff' }
        ],

        // the bots. `every` is ticks between looks, `look` how far ahead they see,
        // `space` whether they count the room a turn leaves them, `slip` how often
        // they get a look wrong, `hunt` how much they like cutting somebody off, and
        // `early` whether they turn off a way that is running into a pocket before they
        // have to, and `voronoi` whether, when they do have to turn, they also count the
        // floor they would get to before anybody else (2: then; 1: all the time, which
        // measured worse: it turns too often)
        BOTS: {
            easy: { name: 'easy', every: 12, look: 12, space: 0, slip: 0.1, hunt: 0, grind: 0, panic: 1.5 },
            normal: { name: 'normal', every: 5, look: 26, space: 500, early: 1, slip: 0.012, hunt: 0.2, grind: 0.3, panic: 3 },
            hard: { name: 'hard', every: 2, look: 40, space: 2200, early: 1, slip: 0, hunt: 0.3, grind: 1, panic: 2.2, voronoi: 2 }
        },
        BOT_NAMES: ['bitrot', 'modem', 'clippy', 'pixel', 'dosbox', 'turbo', 'winamp', 'netzero', 'floppy', 'qbasic', 'zipdisk', 'bonzi'],

        // the grid the bots count room on: one cell is this many units
        CELL: 2
    };
    TZ.ARENA_BY_ID = {};
    for (const a of TZ.ARENAS) TZ.ARENA_BY_ID[a.id] = a;

    root.TZ = TZ;
})(typeof window !== 'undefined' ? window : globalThis);
