// Four actions, one approaching wave. The rules have no DOM or audio dependency.
(function (root) {
    'use strict';
    const WIDTH = 960, PLAYER = 140, HIT_WINDOW = 28;
    const config = Object.freeze({ lives: 4, speed: 235, ramp: 5, cap: 620, floor: 140, penalty: 0.6, heal: 20 });
    const actions = [
        { id: 'square-up', label: 'Square up', shape: 'square', direction: -1, key: 'W' },
        { id: 'square-down', label: 'Square down', shape: 'square', direction: 1, key: 'S' },
        { id: 'triangle-up', label: 'Triangle up', shape: 'triangle', direction: -1, key: '↑' },
        { id: 'triangle-down', label: 'Triangle down', shape: 'triangle', direction: 1, key: '↓' }
    ];
    function random(seed) {
        let value = seed >>> 0;
        return () => {
            value += 0x6D2B79F5;
            let t = Math.imul(value ^ value >>> 15, 1 | value);
            t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    function create(seed = Date.now()) {
        const game = {
            random: random(seed), lives: config.lives,
            score: 0, streak: 0, longest: 0, mistakes: 0, elapsed: 0,
            speed: config.speed, obstacles: [], over: false, cooldown: 0, sequence: 0
        };
        fill(game, 540);
        return game;
    }
    function fill(game, first) {
        let position = game.obstacles.length ? game.obstacles[game.obstacles.length - 1].x : first;
        while (position < WIDTH + 650) {
            if (game.obstacles.length) position += 260 + game.random() * 100;
            game.obstacles.push({ id: ++game.sequence, action: Math.floor(game.random() * 4), x: position });
        }
    }
    function damage(game, type, obstacle) {
        game.mistakes++;
        game.streak = 0;
        game.lives--;
        game.speed = Math.max(config.floor, game.speed * config.penalty);
        game.cooldown = 0.2;
        game.over = game.lives <= 0;
        return { type, obstacle, over: game.over };
    }
    function act(game, action) {
        if (game.over || game.cooldown > 0 || !Number.isInteger(action) || action < 0 || action > 3) return null;
        const next = game.obstacles[0];
        // Matching the shape ahead of the receiver is still an early mistake.
        if (!next || Math.abs(next.x - PLAYER) > HIT_WINDOW) return damage(game, 'early', next);
        if (next.action !== action) {
            game.obstacles.shift();
            const result = damage(game, 'wrong', next);
            fill(game, WIDTH + 180);
            return result;
        }
        game.obstacles.shift();
        game.score++;
        game.streak++;
        game.longest = Math.max(game.longest, game.streak);
        const healed = !!(game.streak % config.heal === 0 && game.lives < config.lives);
        if (healed) game.lives++;
        game.speed = Math.min(config.cap, game.speed + config.ramp);
        fill(game, WIDTH + 180);
        return { type: 'hit', obstacle: next, healed };
    }
    function step(game, seconds) {
        if (game.over || !Number.isFinite(seconds) || seconds <= 0) return [];
        // Bound a stalled frame; returning to a backgrounded tab cannot kill a run.
        const dt = Math.min(seconds, 0.05), events = [];
        game.elapsed += dt;
        game.cooldown = Math.max(0, game.cooldown - dt);
        game.obstacles.forEach(obstacle => { obstacle.x -= game.speed * dt; });
        while (!game.over && game.obstacles.length && game.obstacles[0].x < PLAYER - HIT_WINDOW) {
            events.push(damage(game, 'miss', game.obstacles.shift()));
        }
        fill(game, WIDTH + 180);
        return events;
    }
    // Standard Gamepad layout: the two left shoulders are square, right are triangle.
    // Face buttons mirror the same four actions: Y/A = square up/down, X/B = triangle up/down.
    function padActions(pad) {
        const down = i => !!(pad && pad.buttons && pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.55));
        return [down(4) || down(3), down(6) || down(0), down(5) || down(2), down(7) || down(1)];
    }
    root.WaveShaper = { WIDTH, PLAYER, HIT_WINDOW, actions, config, create, act, step, padActions };
})(typeof window !== 'undefined' ? window : globalThis);
