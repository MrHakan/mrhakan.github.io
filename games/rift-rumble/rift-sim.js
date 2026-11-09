// Host-authoritative platform fighter. No DOM, clocks, or random global state.
(function (root) {
    'use strict';
    const D = root.RIFT, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const ACTIONS = ['jump', 'light', 'heavy', 'special', 'dodge'];
    const character = n => Number.isInteger(n) && n >= 0 && n < D.FIGHTERS.length ? n : 0;
    function input(raw) {
        raw = raw && typeof raw === 'object' ? raw : {};
        const o = {};
        for (const k of ['left', 'right', 'up', 'down']) o[k] = raw[k] === true;
        for (const k of ACTIONS) o[k] = Number.isSafeInteger(raw[k]) && raw[k] >= 0 && raw[k] <= 1e9 ? raw[k] : 0;
        return o;
    }
    function spawn(s, p) {
        p.x = 435 + p.team * 410 + (p.slot > 1 ? (p.team ? 90 : -90) : 0);
        p.y = 420; p.vx = p.vy = 0; p.facing = p.team ? -1 : 1;
        p.damage = 0; p.jumps = 0; p.recovered = false; p.grounded = false;
        p.invuln = 110; p.stun = p.dodge = p.dodgeCd = p.cooldown = p.drop = 0;
        p.attack = null; p.respawn = 0;
    }
    function create(opts = {}) {
        const size = opts.mode === 2 || opts.mode === '2' ? 2 : 1;
        const s = { version: 1, tick: 0, seed: opts.seed >>> 0 || 711, mode: size, arena: D.ARENAS.some(a => a.id === opts.arena) ? opts.arena : 'sky', phase: 'countdown', count: 180, remaining: D.LIMIT, winner: null, sudden: false, players: [], shots: [], events: [], eventId: 0 };
        const people = Array.isArray(opts.people) ? opts.people.slice(0, size * 2) : [];
        const counts = [0, 0];
        for (let i = 0; i < size * 2; i++) {
            const person = people[i] || {}, wish = person.team === 0 || person.team === 1 ? person.team : i % 2;
            const team = counts[wish] < size ? wish : 1 - wish; counts[team]++;
            const p = { slot: i, id: String(person.id || 'bot-' + i), name: String(person.name || ['clippy', 'dialup', 'bonzi', 'winamp'][i]).slice(0, 16), bot: !person.id || !!person.bot, team, character: character(person.character === undefined ? ((opts.seed >>> 0) + i * 5) % D.FIGHTERS.length : person.character), stocks: D.STOCKS, kos: 0, dealt: 0, input: input(), seen: input(), queued: {} };
            spawn(s, p); s.players.push(p);
        }
        return s;
    }
    function event(s, type, p, extra = {}) {
        s.events.push(Object.assign({ id: ++s.eventId, tick: s.tick, type, x: p.x, y: p.y, team: p.team }, extra));
        if (s.events.length > 20) s.events.shift();
    }
    function setInput(s, slot, raw) {
        const p = s.players[slot];
        if (!p || !p.stocks) return;
        const next = input(raw);
        for (const k of ACTIONS) if (next[k] > p.seen[k]) { p.queued[k] = true; p.seen[k] = next[k]; }
        p.input = next; p.inputAt = s.tick;
    }
    function random(s) { s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0; return s.seed / 4294967296; }
    function bot(s, p) {
        const enemies = s.players.filter(q => q.team !== p.team && q.stocks && !q.respawn);
        const t = enemies.sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
        const o = Object.assign({}, p.input);
        o.left = o.right = o.up = o.down = false;
        if (!t) return o;
        const main = D.ARENAS.find(a => a.id === s.arena).platforms[0];
        let target = clamp(t.x, main.x + 55, main.x + main.w - 55);
        const off = p.x < main.x + 8 || p.x > main.x + main.w - 8;
        if (off) target = 640;
        const dx = target - p.x, dy = t.y - p.y;
        o.left = dx < -36; o.right = dx > 36;
        if (s.tick % 17 === p.slot * 3) {
            if ((off && p.y > 350) || (dy < -65 && Math.abs(dx) < 220) || (Math.abs(dx) > 130 && p.grounded && random(s) < 0.16)) o.jump++;
            if (off && p.y > 500 && !p.recovered) { o.up = true; o.special++; }
            else if (Math.abs(t.x - p.x) < 88 && Math.abs(dy) < 65) {
                if (random(s) < 0.3) o.heavy++; else o.light++;
                o.up = dy < -35;
            } else if (Math.abs(t.x - p.x) < 420 && Math.abs(dy) < 75 && random(s) < 0.6) o.special++;
            if (t.attack && Math.abs(t.x - p.x) < 110 && random(s) < 0.28) o.dodge++;
        }
        if (p.grounded && dy > 85 && !off) o.down = true;
        return o;
    }
    function hit(s, a, b, spec, dx, dy) {
        if (!b.stocks || b.respawn || b.invuln || b.dodge || a.team === b.team) return false;
        const fighter = D.FIGHTERS[a.character], weight = D.FIGHTERS[b.character].weight;
        const damage = spec.damage * fighter.power;
        b.damage = Math.min(999, b.damage + damage); a.dealt += damage;
        const force = (spec.force + b.damage * (spec.force > 7 ? 0.092 : 0.063)) / weight;
        b.vx = dx * force; b.vy = dy * force - 2.3; b.stun = Math.min(48, spec.stun + Math.floor(b.damage / 16));
        b.grounded = false; b.attack = null; b.lastHit = a.slot; b.lastHitAt = s.tick;
        event(s, 'hit', b, { heavy: spec.force > 7, damage: Math.round(damage) });
        return true;
    }
    function attack(s, p, kind, o) {
        if (p.cooldown || p.dodge || p.stun) return;
        const fighter = D.FIGHTERS[p.character], spec = kind === 'special' && fighter.specialMelee ? fighter.specialMelee : D.ATTACKS[kind];
        const dir = o.up ? 'up' : o.down && !p.grounded ? 'down' : 'side';
        if (kind === 'special' && dir === 'up') {
            if (p.recovered) return;
            p.invuln = 0;
            p.recovered = true; p.vy = -15; p.stun = 0;
            p.attack = { kind, age: 0, dir, facing: p.facing, hits: [] };
            p.cooldown = spec.duration; event(s, 'recover', p); return;
        }
        p.invuln = 0;
        p.attack = { kind, age: 0, dir, facing: p.facing, hits: [] };
        if (kind === 'special' && fighter.dash) p.vx = p.facing * 15;
        p.cooldown = spec.duration;
        event(s, 'swing', p, { kind });
    }
    function knockout(s, p) {
        event(s, 'ko', p, { x: clamp(p.x, 50, 1230), y: clamp(p.y, 65, 650) });
        p.stocks--; p.attack = null; p.vx = p.vy = 0;
        const killer = s.players[p.lastHit];
        if (killer && s.tick - p.lastHitAt < 600) killer.kos++;
        p.respawn = p.stocks ? 100 : 0;
        if (!p.stocks) { p.x = -300; p.y = 1000; }
    }
    function step(s) {
        if (s.phase === 'over') return;
        s.tick++;
        if (s.phase === 'countdown') {
            s.players.forEach(p => { p.queued = {}; });
            if (--s.count <= 0) { s.phase = 'fight'; event(s, 'go', { x: 640, y: 300 }); }
            return;
        }
        s.remaining--;
        const platforms = D.ARENAS.find(a => a.id === s.arena).platforms;
        for (const p of s.players) {
            if (!p.stocks) continue;
            if (p.bot) setInput(s, p.slot, bot(s, p));
            if (p.respawn) { p.queued = {}; if (--p.respawn === 0) spawn(s, p); continue; }
            const o = p.input, q = p.queued; p.queued = {};
            if (!p.bot && s.tick - (p.inputAt || 0) > 45) o.left = o.right = o.down = o.up = false;
            for (const k of ['invuln', 'stun', 'cooldown', 'dodge', 'dodgeCd', 'drop']) if (p[k] > 0) p[k]--;
            if (!p.stun) {
                const move = Number(o.right) - Number(o.left);
                if (move) p.facing = move;
                if (!p.dodge) {
                    const speed = D.FIGHTERS[p.character].speed * (p.attack ? 0.5 : 1);
                    p.vx += clamp(move * speed - p.vx, -0.8, 0.8);
                }
                if (q.jump && p.jumps < 2) { p.vy = D.JUMP; p.jumps++; p.grounded = false; event(s, 'jump', p); }
                if (q.dodge && !p.dodgeCd && !p.attack) { p.dodge = 12; p.dodgeCd = 65; p.vx = (move || p.facing) * 10; p.invuln = Math.max(p.invuln, 12); event(s, 'dodge', p); }
                if (q.special) attack(s, p, 'special', o);
                else if (q.heavy) attack(s, p, 'heavy', o);
                else if (q.light) attack(s, p, 'light', o);
            } else p.vx *= 0.985;
            const oldY = p.y;
            if (o.down && p.grounded && p.platform > 0) { p.drop = 15; p.y += 5; }
            p.vy = Math.min(17, p.vy + D.GRAVITY * (o.down && !p.grounded ? 1.65 : 1));
            p.x += p.vx; p.y += p.vy; p.grounded = false;
            for (let i = 0; i < platforms.length; i++) {
                const f = platforms[i];
                if (p.vy >= 0 && !(p.drop && i > 0) && oldY <= f.y + 1 && p.y >= f.y && p.x + 12 > f.x && p.x - 12 < f.x + f.w) {
                    p.y = f.y; p.vy = 0; p.grounded = true; p.platform = i; p.jumps = 0; p.recovered = false; break;
                }
            }
            if (p.attack) {
                const a = p.attack, f = D.FIGHTERS[p.character], spec = a.kind === 'special' && f.specialMelee ? f.specialMelee : D.ATTACKS[a.kind]; a.age++;
                if (a.kind === 'special' && a.dir !== 'up' && !f.dash && a.age === spec.startup) {
                    const shot = f.projectile || {}, total = shot.spread || 1;
                    for (let i = 0; i < total; i++) s.shots.push({ owner: p.slot, character: p.character, x: p.x + a.facing * 27, y: p.y - 24, vx: a.facing * (shot.speed || 9), vy: total > 1 ? (i - 1) * 1.8 : shot.gravity ? -3 : 0, life: shot.life || 65, maxLife: shot.life || 65, color: f.color, hits: [] });
                } else if (a.age >= spec.startup && a.age <= spec.startup + spec.active) {
                    const reach = D.FIGHTERS[p.character].reach * (a.kind === 'heavy' ? 1.3 : 1);
                    for (const b of s.players) {
                        if (a.hits.includes(b.slot)) continue;
                        const dx = b.x - p.x, dy = b.y - p.y;
                        const overlap = a.dir === 'up' ? Math.abs(dx) < 47 && dy < 15 && dy > -105 : a.dir === 'down' ? Math.abs(dx) < 48 && dy > -10 && dy < 100 : dx * a.facing > -8 && dx * a.facing < reach && Math.abs(dy) < 54;
                        if (overlap && hit(s, p, b, spec, a.dir === 'up' ? (dx >= 0 ? 0.3 : -0.3) : a.facing, a.dir === 'up' ? -1.1 : a.dir === 'down' ? 0.8 : -0.57)) a.hits.push(b.slot);
                    }
                }
                if (a.age >= spec.duration) p.attack = null;
            }
            if (p.x < -170 || p.x > D.W + 170 || p.y > 915 || p.y < -240) knockout(s, p);
        }
        for (const shot of s.shots) {
            const behavior = D.FIGHTERS[shot.character].projectile || {};
            if (behavior.homing) {
                const target = s.players.filter(p => p.team !== s.players[shot.owner].team && p.stocks && !p.respawn).sort((a, b) => Math.abs(a.x - shot.x) - Math.abs(b.x - shot.x))[0];
                if (target) shot.vy += clamp((target.y - 24 - shot.y) * 0.006 - shot.vy, -0.09, 0.09);
            }
            if (behavior.returning && shot.life < shot.maxLife / 2) shot.vx += clamp((s.players[shot.owner].x - shot.x) * 0.05 - shot.vx, -0.7, 0.7);
            shot.vy += behavior.gravity || 0;
            shot.x += shot.vx; shot.y += shot.vy; shot.life--;
            const a = s.players[shot.owner];
            const spec = Object.assign({}, D.ATTACKS.special, { damage: behavior.damage || 12, force: behavior.force || 6, stun: behavior.stun || 17 });
            for (const b of s.players) if (!shot.hits.includes(b.slot) && Math.abs(b.x - shot.x) < (behavior.size || 12) + 15 && Math.abs(b.y - 23 - shot.y) < 30 && hit(s, a, b, spec, Math.sign(shot.vx) || 1, -0.5)) {
                shot.hits.push(b.slot); if (!behavior.pierce) { shot.life = 0; break; }
            }
        }
        s.shots = s.shots.filter(q => q.life > 0 && q.x > -200 && q.x < 1480).slice(-32);
        const stocks = [0, 0], damage = [0, 0];
        s.players.forEach(p => { stocks[p.team] += p.stocks; if (p.stocks) damage[p.team] += p.damage; });
        if (!stocks[0] || !stocks[1]) {
            if (!stocks[0] && !stocks[1]) suddenDeath(s);
            else finish(s, stocks[0] ? 0 : 1);
        } else if (s.remaining <= 0 && !s.sudden) {
            if (stocks[0] !== stocks[1]) finish(s, stocks[0] > stocks[1] ? 0 : 1);
            else if (Math.abs(damage[0] - damage[1]) >= 1) finish(s, damage[0] < damage[1] ? 0 : 1);
            else suddenDeath(s);
        }
    }
    function finish(s, team) { s.phase = 'over'; s.winner = team; event(s, 'win', { x: 640, y: 300, team }); }
    function suddenDeath(s) {
        s.sudden = true; s.remaining = 60 * 60;
        s.players.forEach(p => { p.stocks = 1; spawn(s, p); p.damage = 200; });
        event(s, 'sudden', { x: 640, y: 300 });
    }
    function snapshot(s) {
        const copy = JSON.parse(JSON.stringify(s));
        copy.players.forEach(p => { delete p.input; delete p.seen; delete p.queued; });
        return copy;
    }
    root.RIFT_SIM = { create, step, setInput, input, snapshot, character, ACTIONS };
})(typeof window === 'undefined' ? globalThis : window);
