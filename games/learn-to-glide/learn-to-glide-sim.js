// learn to glide 98 - the rules. pure, deterministic, no DOM.
// a penguin slides down a ramp on a cliff, launches, glides (lift vs drag),
// burns rockets, pops balloons, gets slowed by clouds and tries to smash the
// ice wall far out on the sea ice fast enough to break it. fixed 60 Hz step,
// seeded rng, so node can replay every run to the last bit.
(function (root) {
    'use strict';
    const HZ = 60, DT = 1 / HZ, G = 9.8;
    const CLIFF = 30;          // metres: ramp foot / launch lip height above the ice
    const WALL_X = 3200;       // metres from the lip to the ice wall
    const WALL_SPEED = 50;     // m/s needed to break it
    const MAX_DAYS = 30;       // the season
    const RUN_LIMIT = 240;     // seconds, a safety net
    const PITCH_RATE = 1.6;    // rad/s
    const PITCH_MAX = 1.45;
    const BODY = 0.0006;       // penguin body drag per v^2
    const IND = 0.06;          // induced drag factor
    const STALL = 0.3;         // rad
    const BALLOON_R = 7, BALLOON_KICK = 7;
    const RANKS = [{ days: 13, name: 'gold' }, { days: 20, name: 'silver' }, { days: MAX_DAYS, name: 'bronze' }];

    // five tiers per upgrade (0 = what you start with)
    const UPGRADES = [
        { key: 'ramp', name: 'ramp', desc: 'taller, steeper ramp',
            tiers: ['plank', 'scaffold', 'ski jump', 'mega jump', 'space elevator'],
            cost: [0, 60, 260, 800, 2000],
            height: [12, 24, 40, 62, 90], angle: [0.52, 0.6, 0.68, 0.74, 0.8], lip: [0.12, 0.2, 0.28, 0.34, 0.4] },
        { key: 'sled', name: 'sled', desc: 'less friction on ramp and ice',
            tiers: ['belly', 'cardboard', 'plastic tray', 'racing sled', 'waxed bobsled'],
            cost: [0, 50, 180, 550, 1400],
            mu: [0.16, 0.11, 0.07, 0.04, 0.02] },
        { key: 'glider', name: 'glider', desc: 'more lift, less drag',
            tiers: ['flapping', 'bin bag', 'hang glider', 'carbon wing', 'stealth wing'],
            cost: [0, 70, 320, 950, 2400],
            lift: [0.004, 0.02, 0.022, 0.024, 0.026], cd0: [0.3, 0.08, 0.05, 0.035, 0.025] },
        { key: 'rocket', name: 'rockets', desc: 'thrust and fuel (hold space)',
            tiers: ['none', 'fireworks', 'soda bottle', 'jet pack', 'shuttle booster'],
            cost: [0, 120, 420, 1100, 2800],
            thrust: [0, 12, 17, 24, 32], fuel: [0, 2.5, 4, 6, 8] },
        { key: 'payload', name: 'payload', desc: 'more money per metre',
            tiers: ['empty pockets', 'fish bag', 'mail sack', 'cargo crate', 'gold bars'],
            cost: [0, 60, 240, 650, 1600],
            mult: [1, 1.3, 1.7, 2.2, 3] }
    ];
    const BY_KEY = {};
    UPGRADES.forEach(u => { BY_KEY[u.key] = u; });
    const TOP = 4;

    function rng(seed) {
        let s = seed >>> 0 || 0x9e3779b9;
        return function () { // mulberry32
            s = (s + 0x6d2b79f5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

    function freshLevels() { return { ramp: 0, sled: 0, glider: 0, rocket: 0, payload: 0 }; }
    function stats(levels) {
        const l = k => clamp(levels && Number.isInteger(levels[k]) ? levels[k] : 0, 0, TOP);
        const r = BY_KEY.ramp, s = BY_KEY.sled, g = BY_KEY.glider, k = BY_KEY.rocket, p = BY_KEY.payload;
        return {
            rampH: r.height[l('ramp')], rampAngle: r.angle[l('ramp')], lip: r.lip[l('ramp')],
            mu: s.mu[l('sled')], lift: g.lift[l('glider')], cd0: g.cd0[l('glider')],
            thrust: k.thrust[l('rocket')], fuel: k.fuel[l('rocket')], payload: p.mult[l('payload')]
        };
    }
    function liftCurve(aoa) {
        const a = Math.abs(aoa), s = aoa < 0 ? -1 : 1;
        if (a <= STALL) return 5 * aoa;
        return s * 5 * STALL * Math.max(0.25, 1 - (a - STALL) * 1.6); // stalled wing
    }

    // the sky for one day: balloons give a kick, clouds slow you down
    function course(seed, day) {
        const r = rng((seed ^ Math.imul(day + 1, 0x85ebca6b)) >>> 0);
        const balloons = [], clouds = [];
        for (let i = 0; i < 22; i++) {
            balloons.push({ x: 120 + r() * (WALL_X - 260), y: 12 + r() * 230, hue: Math.floor(r() * 5), popped: false });
        }
        for (let i = 0; i < 9; i++) {
            clouds.push({ x: 180 + r() * (WALL_X - 500), y: 50 + r() * 260, w: 90 + r() * 170, h: 26 + r() * 30 });
        }
        balloons.sort((a, b) => a.x - b.x);
        clouds.sort((a, b) => a.x - b.x);
        return { balloons, clouds };
    }

    function newGame(seed) {
        return { v: 1, seed: (seed >>> 0) || 98, day: 0, money: 0, levels: freshLevels(), won: false, wonDay: 0,
            best: { distance: 0, altitude: 0, speed: 0 }, earnedTotal: 0, over: false };
    }
    // a save from storage is strangers' writing: rebuild it field by field
    function restore(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const g = newGame(Number.isInteger(raw.seed) ? raw.seed : 98);
        const num = (v, max) => (Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0);
        g.day = Math.floor(num(raw.day, MAX_DAYS));
        g.money = Math.floor(num(raw.money, 1e9));
        g.earnedTotal = Math.floor(num(raw.earnedTotal, 1e10));
        if (raw.levels && typeof raw.levels === 'object') {
            for (const u of UPGRADES) { const v = raw.levels[u.key]; g.levels[u.key] = Number.isInteger(v) ? clamp(v, 0, TOP) : 0; }
        }
        g.won = raw.won === true;
        g.wonDay = g.won ? clamp(Math.floor(num(raw.wonDay, MAX_DAYS)), 1, MAX_DAYS) : 0;
        if (raw.best && typeof raw.best === 'object') {
            g.best.distance = num(raw.best.distance, 1e6); g.best.altitude = num(raw.best.altitude, 1e6); g.best.speed = num(raw.best.speed, 1e4);
        }
        g.over = g.won || g.day >= MAX_DAYS;
        return g;
    }
    function price(game, key) {
        const u = BY_KEY[key];
        if (!u) return Infinity;
        const next = game.levels[key] + 1;
        return next > TOP ? Infinity : u.cost[next];
    }
    function buy(game, key) {
        const cost = price(game, key);
        if (game.over || !Number.isFinite(cost) || game.money < cost) return false;
        game.money -= cost; game.levels[key]++;
        return true;
    }

    function startRun(game, levels) {
        const st = stats(levels || game.levels), day = game.day;
        const sky = course(game.seed, day);
        const L = st.rampH / Math.sin(st.rampAngle);
        return {
            day, st, phase: 'ramp', t: 0, ticks: 0, s: 0, rampLen: L, v: 1.5,
            x: -L * Math.cos(st.rampAngle), y: CLIFF + st.rampH, vx: 0, vy: 0,
            pitch: -st.rampAngle, fuel: st.fuel, boosting: false, inCloud: false,
            maxAlt: CLIFF + st.rampH, topSpeed: 0, balloons: sky.balloons, clouds: sky.clouds, popped: 0,
            done: false, result: '', broke: false, events: []
        };
    }

    function rampStep(run) {
        const st = run.st;
        const a = G * Math.sin(st.rampAngle) - st.mu * G * Math.cos(st.rampAngle) - BODY * run.v * run.v;
        run.v = Math.max(1.5, run.v + a * DT);
        run.s += run.v * DT;
        if (run.s >= run.rampLen) {
            run.phase = 'air';
            run.x = 0; run.y = CLIFF;
            run.vx = run.v * Math.cos(st.lip); run.vy = run.v * Math.sin(st.lip);
            run.pitch = st.lip;
            run.events.push({ kind: 'launch', speed: run.v });
        } else {
            const left = run.rampLen - run.s;
            run.x = -left * Math.cos(st.rampAngle); run.y = CLIFF + left * Math.sin(st.rampAngle);
            run.vx = run.v * Math.cos(st.rampAngle); run.vy = -run.v * Math.sin(st.rampAngle);
        }
    }

    function end(run, result) { run.done = true; run.result = result; run.boosting = false; run.events.push({ kind: 'end', result }); }

    function airStep(run, pitchIn, boost) {
        const st = run.st;
        run.pitch = clamp(run.pitch + clamp(pitchIn, -1, 1) * PITCH_RATE * DT, -PITCH_MAX, PITCH_MAX);
        const v = Math.hypot(run.vx, run.vy) || 1e-6;
        const ux = run.vx / v, uy = run.vy / v;
        const aoa = wrap(run.pitch - Math.atan2(run.vy, run.vx));
        const cl = liftCurve(aoa);
        // inside a cloud: wet wings, heavy drag
        let cloud = false;
        for (let i = 0; i < run.clouds.length; i++) {
            const c = run.clouds[i];
            if (run.x > c.x && run.x < c.x + c.w && Math.abs(run.y - c.y) < c.h / 2) { cloud = true; break; }
        }
        if (cloud && !run.inCloud) run.events.push({ kind: 'cloud' });
        run.inCloud = cloud;
        const lift = st.lift * v * v * cl;
        const drag = v * v * (BODY + st.lift * (st.cd0 + IND * cl * cl)) * (cloud ? 3.2 : 1);
        let ax = -lift * uy - drag * ux, ay = lift * ux - drag * uy - G;
        run.boosting = false;
        if (boost && run.fuel > 0 && st.thrust > 0) {
            ax += st.thrust * Math.cos(run.pitch); ay += st.thrust * Math.sin(run.pitch);
            run.fuel = Math.max(0, run.fuel - DT); run.boosting = true;
        }
        run.vx += ax * DT; run.vy += ay * DT;
        run.x += run.vx * DT; run.y += run.vy * DT;
        for (let i = 0; i < run.balloons.length; i++) {
            const b = run.balloons[i];
            if (b.popped || Math.abs(b.x - run.x) > BALLOON_R) continue;
            if (Math.hypot(b.x - run.x, b.y - run.y) < BALLOON_R) {
                b.popped = true; run.popped++;
                const nv = Math.hypot(run.vx, run.vy) || 1;
                run.vx += run.vx / nv * BALLOON_KICK; run.vy += run.vy / nv * BALLOON_KICK + 2;
                run.events.push({ kind: 'balloon', x: b.x, y: b.y });
            }
        }
        if (run.x < 0 && run.y <= CLIFF) { run.y = CLIFF; end(run, 'cliff'); return; }
        if (run.y <= 0) {
            run.y = 0;
            if (run.vy < -32) { run.vx = 0; run.vy = 0; end(run, 'splat'); return; }
            run.phase = 'skid'; run.vy = 0; run.vx = Math.max(0, run.vx * 0.85);
            run.pitch = 0;
            run.events.push({ kind: 'touchdown' });
        }
    }

    function skidStep(run) {
        const k = run.st.mu * 1.5 + 0.04;
        run.vx = Math.max(0, run.vx - (k * G + BODY * run.vx * run.vx) * DT);
        run.x += run.vx * DT;
        if (run.vx <= 0.3) end(run, 'stopped');
    }

    // one fixed tick. input: { pitch: -1..1, boost: bool }
    function step(run, input) {
        if (run.done) return false;
        run.ticks++; run.t = run.ticks / HZ;
        if (run.phase === 'ramp') rampStep(run);
        else if (run.phase === 'air') airStep(run, input ? +input.pitch || 0 : 0, !!(input && input.boost));
        else skidStep(run);
        if (run.done) return true;
        const speed = Math.hypot(run.vx, run.vy);
        if (run.phase !== 'ramp') {
            if (run.y > run.maxAlt) run.maxAlt = run.y;
            if (speed > run.topSpeed) run.topSpeed = speed;
        }
        if (run.x >= WALL_X) {
            run.x = WALL_X;
            if (speed >= WALL_SPEED) { run.broke = true; end(run, 'wall'); }
            else { run.vx = 0; end(run, 'bonk'); }
            run.impact = speed;
        } else if (run.t >= RUN_LIMIT) end(run, 'timeout');
        return true;
    }

    function earnings(run) {
        const dist = Math.max(0, run.x);
        const base = dist * 0.4 + Math.max(0, run.maxAlt - CLIFF) * 0.6 + run.topSpeed * 1.2 + run.popped * 12 + (run.broke ? 1000 : 0);
        return Math.round(base * run.st.payload);
    }

    // book the run into the season. returns the day's report.
    function finishRun(game, run) {
        if (!run.done || game.over) return null;
        const earned = earnings(run);
        game.day++;
        game.money += earned; game.earnedTotal += earned;
        const dist = Math.max(0, run.x);
        const rec = { distance: dist > game.best.distance, altitude: run.maxAlt > game.best.altitude, speed: run.topSpeed > game.best.speed };
        game.best.distance = Math.max(game.best.distance, dist);
        game.best.altitude = Math.max(game.best.altitude, run.maxAlt);
        game.best.speed = Math.max(game.best.speed, run.topSpeed);
        if (run.broke && !game.won) { game.won = true; game.wonDay = game.day; }
        game.over = game.won || game.day >= MAX_DAYS;
        return { day: game.day, distance: dist, altitude: run.maxAlt, speed: run.topSpeed, popped: run.popped,
            earned, result: run.result, broke: run.broke, records: rec, won: game.won, lost: game.over && !game.won };
    }

    function rank(days) {
        for (const r of RANKS) if (days <= r.days) return r.name;
        return 'none';
    }

    // a simple pilot: climb on the rockets, hold the best glide, dive at the
    // wall. the node check and the demo both fly with it.
    function autopilot(run, opts) {
        if (run.phase !== 'air') return { pitch: 0, boost: false };
        const v = Math.hypot(run.vx, run.vy), gamma = Math.atan2(run.vy, run.vx);
        let target, boost = false;
        const left = WALL_X - run.x;
        const climb = opts && Number.isFinite(opts.climb) ? opts.climb : 0.55;
        const glide = opts && Number.isFinite(opts.glide) ? opts.glide : 0.12;
        const diveAt = opts && Number.isFinite(opts.dive) ? opts.dive : 1.6;
        if (run.fuel > 0 && run.st.thrust > 0 && v > 8) { target = climb; boost = true; }
        else if (run.y < 14 && run.vy < -9) target = gamma + 0.3; // flare before the ice
        else if (left > 0 && (run.diving || left < run.y * diveAt + 40)) {
            // dive for speed, steering the path at the foot of the wall
            run.diving = true;
            const aim = Math.atan2(-(run.y - 4), left);
            target = gamma + clamp((aim - gamma) * 2.5, -0.25, 0.25);
        }
        else if (v < 18 && run.st.lift > 0.001) target = gamma - 0.15; // nose down to keep flying
        else target = gamma + glide;
        const d = wrap(target - run.pitch);
        return { pitch: Math.abs(d) < 0.02 ? 0 : clamp(d * 8, -1, 1), boost };
    }

    // a whole run with a pilot, for tests and the demo
    function simulate(game, pilot, levels, opts) {
        const run = startRun(game, levels);
        while (!run.done) { step(run, pilot ? pilot(run, opts) : null); run.events.length = 0; }
        return run;
    }

    // buy in a sensible order whatever is affordable
    const PLAN = ['glider', 'ramp', 'rocket', 'payload', 'glider', 'rocket', 'sled', 'ramp', 'payload', 'rocket', 'glider', 'sled',
        'ramp', 'rocket', 'payload', 'glider', 'rocket', 'ramp', 'sled', 'payload', 'sled'];
    function shopper(game) {
        let bought = 0;
        for (;;) {
            // walk the plan: the first entry whose tier we have not reached yet
            let want = null;
            const seen = {};
            for (const k of PLAN) {
                seen[k] = (seen[k] || 0) + 1;
                if (game.levels[k] < seen[k]) { want = k; break; }
            }
            if (!want || !buy(game, want)) break;
            bought++;
        }
        return bought;
    }

    const API = { HZ, DT, G, CLIFF, WALL_X, WALL_SPEED, MAX_DAYS, RUN_LIMIT, UPGRADES, TOP, RANKS, PLAN,
        rng, stats, course, newGame, restore, price, buy, startRun, step, earnings, finishRun, rank,
        autopilot, simulate, shopper, liftCurve, freshLevels };
    root.LTG_SIM = API;
    if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
