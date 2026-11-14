// blastz 98 rules. Host-authoritative, deterministic, no DOM and no clocks:
// the same seed and the same inputs give the same match, under node too.
(function (root) {
    'use strict';
    const D = root.BLASTZ;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const ACTIONS = ['jump', 'bomb'];
    const HALF = D.BOX_W / 2;
    const character = n => Number.isInteger(n) && n >= 0 && n < D.FIGHTERS ? n : 0;
    const weaponIndex = id => Math.max(0, D.WEAPONS.findIndex(w => w.id === id));

    // What a player is pressing. Held keys are booleans; presses are counters
    // that only go up, so a repeated or late packet can never jump twice.
    function input(raw) {
        raw = raw && typeof raw === 'object' ? raw : {};
        const o = {};
        for (const k of ['left', 'right', 'down', 'fire']) o[k] = raw[k] === true;
        for (const k of ACTIONS) o[k] = Number.isSafeInteger(raw[k]) && raw[k] >= 0 && raw[k] <= 1e9 ? raw[k] : 0;
        return o;
    }
    function random(s) { s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0; return s.seed / 4294967296; }
    function event(s, type, x, y, extra) {
        s.events.push(Object.assign({ id: ++s.eventId, tick: s.tick, type, x: Math.round(x), y: Math.round(y) }, extra));
        if (s.events.length > 24) s.events.shift();
    }
    const magFor = (p, w) => Math.round(w.mag * (p.perk === 'bigmag' ? 1.5 : 1));
    function arm(p, index) {
        const w = D.WEAPONS[index];
        p.weapon = index; p.mag = magFor(p, w); p.clips = w.clips; p.reload = 0; p.cd = 0; p.burst = 0; p.spin = 0;
    }

    function create(opts = {}) {
        const map = D.map(opts.map), teams = !!opts.teams;
        const people = Array.isArray(opts.people) ? opts.people.slice(0, 4) : [];
        const count = D.count(opts.count || Math.max(2, people.length));
        const s = {
            version: 1, tick: 0, seed: opts.seed >>> 0 || 98, map: map.id, teams, lives: D.lives(opts.lives),
            phase: 'countdown', count: D.COUNTDOWN, winner: null, overAt: 0, players: [], shots: [], bombs: [], crates: [],
            events: [], eventId: 0, crateAt: D.CRATE_EVERY[0], nextId: 1, overtime: false
        };
        const counts = [0, 0], cap = Math.ceil(count / 2);
        for (let i = 0; i < count; i++) {
            const person = people[i] || {};
            let team = i;
            if (teams) {
                const wish = person.team === 0 || person.team === 1 ? person.team : counts[0] <= counts[1] ? 0 : 1;
                team = counts[wish] < cap ? wish : 1 - wish; counts[team]++;
            }
            const p = {
                slot: i, id: String(person.id || 'bot-' + i), name: String(person.name || D.BOT_NAMES[i % 4]).slice(0, 16),
                bot: !person.id || !!person.bot, team, character: character(person.character === undefined ? (s.seed + i * 5) % D.FIGHTERS : person.character),
                perk: D.perk(person.perk), lives: s.lives, kos: 0, falls: 0, place: 0,
                x: 0, y: 0, vx: 0, vy: 0, facing: 1, grounded: false, jumps: 0, drop: 0, travel: 0,
                dead: 0, out: false, invuln: 0, shield: 0, turbo: 0, stun: 0, kick: 0, slide: 0, hitBy: -1, hitAt: -1e9,
                weapon: 0, mag: 0, clips: -1, reload: 0, cd: 0, burst: 0, spin: 0, bombs: 0,
                input: input(), seen: input(), queued: {}, ai: { jumpAt: 0, aimAt: 0, next: 0, offset: 0, hop: false, theirs: null, crate: 0, crateAt: 0, skip: 0, across: null, acrossAt: -1e9 }
            };
            s.players.push(p);
        }
        s.players.forEach(p => spawn(s, p, true));
        return s;
    }

    // Respawns drop in from the spawn point farthest from anyone dangerous.
    function spawn(s, p, first) {
        const map = D.map(s.map);
        let point = map.spawns[p.slot % map.spawns.length];
        if (first) {
            const main = map.platforms[0], n = s.players.length;
            point = [main.x + main.w * (n === 1 ? 0.5 : 0.12 + 0.76 * p.slot / (n - 1)), main.y];
        } else {
            let best = -1;
            for (const sp of map.spawns) {
                const near = Math.min(1e9, ...s.players.filter(q => q !== p && !q.out && !q.dead && q.team !== p.team).map(q => Math.hypot(q.x - sp[0], q.y - sp[1])));
                if (near > best) { best = near; point = sp; }
            }
        }
        Object.assign(p, { x: point[0], y: point[1], vx: 0, vy: 0, grounded: !!first, jumps: 0, drop: 0, dead: 0, stun: 0, kick: 0,
            invuln: first ? 0 : D.SHIELD_AFTER_SPAWN, shield: 0, turbo: 0, hitBy: -1, hitAt: -1e9,
            bombs: D.GRENADES + (p.perk === 'bomber' ? 2 : 0), facing: point[0] < D.W / 2 ? 1 : -1 });
        arm(p, 0);
    }

    function setInput(s, slot, raw) {
        const p = s.players[slot];
        if (!p || p.out) return;
        const next = input(raw);
        for (const k of ACTIONS) if (next[k] > p.seen[k]) { p.queued[k] = true; p.seen[k] = next[k]; }
        p.input = next;
    }
    const knockMul = s => s.overtime ? 1 + (s.tick - D.OVERTIME) / 3600 : 1;
    const enemies = (s, p) => s.players.filter(q => q !== p && !q.out && !q.dead && (!s.teams || q.team !== p.team));

    // ---- a push, from a bullet or a blast ----
    function push(s, target, fx, fy, owner) {
        if (target.dead || target.out) return false;
        if (target.invuln > 0 || target.shield > 0) { event(s, 'block', target.x, target.y - 30); return false; }
        const mul = knockMul(s) * (target.perk === 'anchor' ? 0.7 : 1);
        target.vx = clamp(target.vx + fx * mul, -28, 28);
        target.vy = clamp(target.vy + fy * mul, -20, 20);
        if (target.grounded && fy * mul < -2) target.grounded = false;
        target.stun = Math.max(target.stun, 14);
        if (owner >= 0 && owner !== target.slot) { target.hitBy = owner; target.hitAt = s.tick; }
        return true;
    }
    function explode(s, x, y, blast, owner, team) {
        const radius = blast.radius * (s.players[owner]?.perk === 'bomber' ? 1.25 : 1);
        event(s, 'boom', x, y, { r: Math.round(radius) });
        for (const q of s.players) {
            if (q.dead || q.out || (s.teams && q.team === team && q.slot !== owner)) continue;
            const dx = q.x - x, dy = q.y - 28 - y, d = Math.hypot(dx, dy);
            if (d > radius) continue;
            const f = blast.knock * (1 - 0.55 * d / radius), nx = d < 1 ? 0 : dx / d, ny = d < 1 ? -1 : dy / d;
            push(s, q, nx * f, ny * f - 3.5, owner);
        }
    }

    // ---- guns ----
    function fire(s, p, w) {
        const pellets = w.pellets || 1, spread = w.spread * (p.perk === 'steady' ? 0.5 : 1);
        for (let i = 0; i < pellets; i++) {
            const a = (random(s) - 0.5) * 2 * spread, speed = w.speed * (pellets > 1 ? 0.85 + random(s) * 0.3 : 1);
            const shot = { id: s.nextId++, o: p.slot, team: p.team, w: p.weapon, x: p.x + p.facing * 8, y: p.y - 31, vx: p.facing * speed * Math.cos(a), vy: speed * Math.sin(a), life: w.life };
            if (w.lob) { shot.vx += p.vx * 0.4; shot.vy = -5.4 + a * 8; }
            s.shots.push(shot);
        }
        if (s.shots.length > 90) s.shots.splice(0, s.shots.length - 90);
        p.mag--; p.kick = 6; p.invuln = 0;
        if (p.perk !== 'steady') { p.vx = clamp(p.vx - p.facing * w.recoil * (p.grounded ? 0.75 : 1), -28, 28); p.slide = 8; }
        event(s, 'shot', p.x, p.y, { w: p.weapon, slot: p.slot });
    }
    function guns(s, p) {
        const w = D.WEAPONS[p.weapon];
        if (p.cd > 0) p.cd--;
        if (p.reload > 0) {
            if (--p.reload === 0) { p.mag = magFor(p, w); event(s, 'reloaded', p.x, p.y, { slot: p.slot }); }
            return;
        }
        if (p.mag <= 0) {
            if (p.clips === 0) { arm(p, 0); event(s, 'empty', p.x, p.y - 60, { slot: p.slot }); return; }
            if (p.clips > 0) p.clips--;
            p.reload = Math.round(w.reload * (p.perk === 'bigmag' ? 0.7 : 1)); p.burst = 0;
            event(s, 'dry', p.x, p.y, { slot: p.slot });
            return;
        }
        const held = p.input.fire;
        if (w.spin) p.spin = held ? Math.min(w.spin, p.spin + 1) : Math.max(0, p.spin - 2);
        if (p.cd > 0) return;
        if (p.burst > 0) { fire(s, p, w); p.burst--; p.cd = p.burst > 0 ? w.gap : w.rate; return; }
        if (!held || (w.spin && p.spin < w.spin)) return;
        fire(s, p, w);
        if (w.burst) { p.burst = w.burst - 1; p.cd = w.gap; } else p.cd = w.rate;
    }

    // ---- moving about on thin platforms ----
    function under(map, x, y, pad = 0) {
        let best = null;
        for (const pl of map.platforms) if (x >= pl.x - pad && x <= pl.x + pl.w + pad && pl.y >= y - 1 && (!best || pl.y < best.y)) best = pl;
        return best;
    }
    function move(s, p, map) {
        const w = D.WEAPONS[p.weapon], i = p.input;
        let speed = D.RUN * (p.perk === 'turbo' ? 1.15 : 1) * (p.perk === 'anchor' ? 0.93 : 1) * (p.turbo > 0 ? 1.25 : 1);
        if (w.slow && i.fire) speed *= w.slow;
        const dir = (i.right ? 1 : 0) - (i.left ? 1 : 0);
        if (dir) p.facing = dir;
        let acc = p.grounded ? D.ACCEL : D.AIR_ACCEL;
        // shoved: the push wears off by friction, and walking only leans on it
        if (p.stun > 0 || p.slide > 0 || Math.abs(p.vx) > speed + 0.5) {
            p.vx *= p.grounded ? 0.95 : 0.985;
            if (dir && Math.sign(p.vx) !== dir) p.vx += dir * acc * 0.4;
            else if (dir && Math.abs(p.vx) < speed) p.vx += dir * acc * 0.3;
        } else p.vx += clamp(dir * speed - p.vx, -acc, acc);
        if (p.queued.jump) {
            const most = p.perk === 'spring' ? 3 : 2, lift = p.turbo > 0 ? 1.12 : 1;
            if (p.grounded) { p.vy = D.JUMP * lift; p.grounded = false; p.jumps = 1; event(s, 'jump', p.x, p.y, { slot: p.slot }); }
            else if (p.jumps < most) { p.vy = D.AIR_JUMP * lift; p.jumps++; event(s, 'jump', p.x, p.y, { slot: p.slot, air: 1 }); }
        }
        if (i.down && p.grounded) { p.drop = 14; p.grounded = false; p.jumps = Math.max(p.jumps, 1); p.y += 2; }
        p.vy = Math.min(D.MAX_FALL + (i.down ? 3 : 0), p.vy + D.GRAVITY + (i.down && !p.grounded && p.vy > 0 ? 0.35 : 0));
        if (p.drop > 0) p.drop--;
        const oldY = p.y;
        p.x += p.vx; p.y += p.vy;
        if (p.grounded) {
            const pl = under(map, p.x, oldY, 4);
            if (!pl || pl.y > oldY + 1) { p.grounded = false; p.jumps = Math.max(p.jumps, 1); }
            else { p.y = pl.y; p.vy = 0; }
        }
        if (!p.grounded && p.vy >= 0 && p.drop <= 0) {
            for (const pl of map.platforms) {
                if (oldY <= pl.y + 0.5 && p.y >= pl.y && p.x >= pl.x - 4 && p.x <= pl.x + pl.w + 4) {
                    p.y = pl.y; p.vy = 0; p.grounded = true; p.jumps = 0;
                    event(s, 'land', p.x, p.y, { slot: p.slot });
                    break;
                }
            }
        }
        if (p.grounded) p.travel += Math.abs(p.vx);
    }

    function die(s, p) {
        p.lives--; p.falls++;
        const killer = p.hitBy >= 0 && s.tick - p.hitAt < D.CREDIT ? s.players[p.hitBy] : null;
        if (killer && killer !== p && (!s.teams || killer.team !== p.team)) killer.kos++;
        event(s, 'ko', clamp(p.x, 20, D.W - 20), clamp(p.y, 20, D.H - 20), { slot: p.slot, by: killer ? killer.slot : -1 });
        p.vx = p.vy = 0; p.shield = p.turbo = 0;
        if (p.lives <= 0) {
            p.out = true; p.lives = 0;
            p.place = s.players.filter(q => !q.out).length + 1;
        } else p.dead = D.RESPAWN;
    }

    // ---- bots: stay on the map first, shoot second ----
    function bot(s, p, map) {
        const o = Object.assign({}, p.input), ai = p.ai;
        o.left = o.right = o.down = o.fire = false;
        const press = k => { o[k] = (o[k] || 0) + 1; };
        const w = D.WEAPONS[p.weapon];
        const ground = under(map, p.x, p.y, -10);
        const go = x => { if (x < p.x - 6) o.left = true; else if (x > p.x + 6) o.right = true; };
        const most = p.perk === 'spring' ? 3 : 2;
        // nothing under the feet: head for the nearest platform and jump back
        if (!ground) {
            let best = ai.across && s.tick - ai.acrossAt < 100 ? ai.across : null, bestD = best ? -1 : 1e9;
            if (!best) for (const pl of map.platforms) {
                const ex = clamp(p.x, pl.x + 30, pl.x + pl.w - 30), d = Math.abs(ex - p.x) + Math.max(0, p.y - pl.y) * 0.4 + Math.max(0, pl.y - p.y - 260);
                if (d < bestD) { bestD = d; best = pl; }
            }
            if (best) {
                go(clamp(p.x, best.x + 40, best.x + best.w - 40));
                if (p.vy > 0.5 && p.y > best.y - 30 && p.jumps < most && s.tick - ai.jumpAt > 10) { press('jump'); ai.jumpAt = s.tick; }
            }
            return o;
        }
        const foes = enemies(s, p);
        let t = null, td = 1e9;
        for (const q of foes) { const d = Math.abs(q.x - p.x) + Math.abs(q.y - p.y) * 1.5; if (d < td) { td = d; t = q; } }
        if (s.tick >= ai.next) { ai.next = s.tick + 90 + Math.floor(random(s) * 150); ai.offset = (random(s) - 0.5) * 220; ai.hop = random(s) < 0.3; }
        const lo = ground.x + 26, hi = ground.x + ground.w - 26;
        let want = p.x;
        // up to a higher platform: jump from under it, jump again near the top of the arc
        const climb = (pl, x) => {
            // too high for two jumps: go by a platform in between
            if (pl.y < p.y - 215) {
                const mid = map.platforms.filter(m => m.y < p.y - 20 && m.y >= p.y - 215 && m.y > pl.y + 40)
                    .sort((a, b) => Math.abs(a.x + a.w / 2 - x) - Math.abs(b.x + b.w / 2 - x))[0];
                if (mid) { pl = mid; x = clamp(x, mid.x + 30, mid.x + mid.w - 30); }
            }
            want = clamp(x, pl.x + 20, pl.x + pl.w - 20);
            const near = p.x > pl.x - 50 && p.x < pl.x + pl.w + 50;
            if (!near || pl.y > p.y - 20) return;
            if (p.grounded && pl.y >= p.y - 220 && s.tick - ai.jumpAt > 12) { press('jump'); ai.jumpAt = s.tick; }
            else if (!p.grounded && p.y > pl.y - 6 && p.vy > -1.5 && p.jumps < most && s.tick - ai.jumpAt > 8) { press('jump'); ai.jumpAt = s.tick; }
        };
        // Shooting and moving are decided apart: whatever a bot is walking to,
        // it turns and holds the trigger whenever somebody is in its line.
        let line = false, aligned = false, dx = 0, dy = 0;
        if (t) {
            dx = t.x - p.x; dy = t.y - p.y;
            const reach = Math.min(900, w.speed * w.life);
            line = Math.abs(dy - (w.lob ? -30 : 0)) < (w.lob ? 60 : 46) && Math.abs(dx) < reach;
            // the bullet leaves at chest height: only fire when it will meet the body
            aligned = line && (w.lob || Math.abs(dy) < 24);
        }
        // a crate is worth a detour while the bot has only the pea shooter, for
        // a few seconds at most: one it cannot reach is given up on
        let crate = null;
        if (p.weapon === 0 || s.crates.some(c => c.landed && Math.abs(c.x - p.x) < 120 && Math.abs(c.y - p.y) < 40)) {
            crate = s.crates.filter(c => c.landed && c.id !== ai.skip && Math.abs(c.y - p.y) < 260 && Math.abs(c.x - p.x) < 560)
                .sort((a, b) => Math.abs(a.x - p.x) + Math.abs(a.y - p.y) - Math.abs(b.x - p.x) - Math.abs(b.y - p.y))[0] || null;
            if (crate && crate.id !== ai.crate) { ai.crate = crate.id; ai.crateAt = s.tick; }
            if (crate && s.tick - ai.crateAt > 300) { ai.skip = crate.id; crate = null; }
        }
        const close = crate && Math.abs(crate.x - p.x) < 90 && Math.abs(crate.y - p.y) < 40;
        if (crate && (!line || close)) {
            const floor = under(map, crate.x, crate.y, 2);
            if (floor && crate.y < p.y - 30) climb(floor, crate.x);
            else {
                want = crate.x;
                if (crate.y > p.y + 30 && p.grounded && random(s) < 0.1 && under(map, p.x, p.y + 10, -20)) o.down = true;
            }
        } else if (t && line) {
            // keep a little distance with most guns, close in with the spread sheet
            if (w.id === 'sheet' && Math.abs(dx) > 170) want = t.x;
            else if (Math.abs(dx) < 90) want = p.x - Math.sign(dx || 1) * 60;
            if (ai.hop && p.grounded && s.tick - ai.jumpAt > 70 && random(s) < 0.03) { press('jump'); ai.jumpAt = s.tick; }
        } else if (t) {
            want = t.x + ai.offset;
            if (ai.hop && p.grounded && s.tick - ai.jumpAt > 50) { press('jump'); ai.jumpAt = s.tick; ai.hop = random(s) < 0.4; }
            // a different floor: climb up to it or drop down to it, once they stand somewhere
            const theirs = t.grounded ? under(map, t.x, t.y, 4) : ai.theirs;
            ai.theirs = theirs;
            if (theirs && theirs !== ground && (p.grounded || theirs.y < p.y)) {
                if (theirs.y < p.y - 20) climb(theirs, t.x);
                else if (theirs.y > p.y + 20 && under(map, p.x, p.y + 10, -20) && random(s) < 0.08) o.down = true;
            }
        }
        if (t && line) {
            const facing = Math.sign(dx) || p.facing;
            if (facing !== p.facing) { o.left = facing < 0; o.right = facing > 0; ai.aimAt = s.tick; }
            else if (aligned && s.tick - ai.aimAt > 8 + (p.slot * 3) % 6 && t.invuln < 20) o.fire = true;
            if (p.bombs > 0 && Math.abs(dx) < 240 && random(s) < 0.006) press('bomb');
        } else ai.aimAt = Math.min(ai.aimAt, s.tick - 4);
        // the way to `want` leaves this platform sideways: jump the gap to the next one
        if (p.grounded && (want > hi + 30 || want < lo - 30)) {
            const dir = want > hi ? 1 : -1, edge = dir > 0 ? ground.x + ground.w : ground.x;
            const next = map.platforms.filter(m => m !== ground && m.y >= p.y - 200 && m.y <= p.y + 200 && (dir > 0 ? m.x - edge : edge - (m.x + m.w)) > -10 && (dir > 0 ? m.x - edge : edge - (m.x + m.w)) < 260)
                .sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y))[0];
            if (next) {
                if ((dir > 0 ? hi - p.x : p.x - lo) < 30 && s.tick - ai.jumpAt > 20) { press('jump'); ai.jumpAt = s.tick; ai.across = next; ai.acrossAt = s.tick; }
                o.left = dir < 0; o.right = dir > 0;
                return o;
            }
        }
        want = clamp(want, lo, hi);
        // standing to shoot: no walking that would turn the gun away
        if (!o.left && !o.right && !(line && Math.abs(want - p.x) > 6 && Math.sign(want - p.x) !== (Math.sign(dx) || p.facing))) go(want);
        // getting shoved toward an edge: lean against it
        if (Math.abs(p.vx) > 4 && (p.x < lo + 40 || p.x > hi - 40)) { o.left = p.vx > 0; o.right = p.vx < 0; o.fire = o.fire && Math.sign(p.vx) === p.facing; }
        return o;
    }

    function step(s) {
        s.tick++;
        if (s.phase === 'countdown') {
            if (--s.count <= 0) { s.phase = 'fight'; s.count = 0; event(s, 'go', D.W / 2, 200); }
            for (const p of s.players) p.queued = {};
            return s;
        }
        const map = D.map(s.map);
        if (!s.overtime && s.tick > D.OVERTIME && s.phase === 'fight') { s.overtime = true; event(s, 'overtime', D.W / 2, 200); }
        for (const p of s.players) {
            if (p.bot && s.phase === 'fight' && !p.out && !p.dead) {
                const next = bot(s, p, map);
                for (const k of ACTIONS) if (next[k] > p.seen[k]) { p.queued[k] = true; p.seen[k] = next[k]; }
                p.input = next;
            }
        }
        for (const p of s.players) {
            if (p.out) { p.queued = {}; continue; }
            if (p.dead > 0) { if (--p.dead === 0) spawn(s, p, false); p.queued = {}; continue; }
            if (s.phase === 'over') { p.input = input(); p.queued = {}; }
            move(s, p, map);
            if (s.phase === 'fight') {
                guns(s, p);
                if (p.queued.bomb && p.bombs > 0) {
                    p.bombs--;
                    s.bombs.push({ id: s.nextId++, o: p.slot, team: p.team, x: p.x + p.facing * 14, y: p.y - 36, vx: p.facing * D.BOMB.throwX + p.vx * 0.6, vy: D.BOMB.throwY + Math.min(0, p.vy * 0.3), fuse: D.BOMB.fuse });
                    event(s, 'throw', p.x, p.y, { slot: p.slot });
                }
            }
            p.queued = {};
            if (p.invuln > 0) p.invuln--;
            if (p.shield > 0) p.shield--;
            if (p.turbo > 0) p.turbo--;
            if (p.stun > 0) p.stun--;
            if (p.kick > 0) p.kick--;
            if (p.slide > 0) p.slide--;
            const b = D.BLAST;
            if (p.x < b.left || p.x > b.right || p.y > b.bottom || p.y < b.top) die(s, p);
        }
        shots(s, map);
        bombs(s, map);
        crates(s, map);
        if (s.phase === 'fight') {
            const sides = new Set(s.players.filter(p => !p.out).map(p => p.team));
            if (sides.size <= 1) {
                s.phase = 'over'; s.overAt = s.tick;
                s.winner = sides.size ? [...sides][0] : -1;
                for (const p of s.players) if (!p.out) p.place = 1;
                event(s, 'over', D.W / 2, 200, { winner: s.winner });
            }
        }
        return s;
    }

    function hitTest(q, x0, y0, x1, y1) {
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 9));
        for (let k = 1; k <= n; k++) {
            const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n;
            if (x > q.x - HALF && x < q.x + HALF && y > q.y - D.BOX_H && y < q.y) return { x, y };
        }
        return null;
    }
    function shots(s, map) {
        const keep = [];
        for (const b of s.shots) {
            const w = D.WEAPONS[b.w];
            if (w.lob) b.vy += 0.27;
            const x0 = b.x, y0 = b.y;
            b.x += b.vx; b.y += b.vy; b.life--;
            let gone = false;
            for (const q of s.players) {
                if (q.slot === b.o || q.dead || q.out || (s.teams && q.team === b.team)) continue;
                const hit = hitTest(q, x0, y0, b.x, b.y);
                if (!hit) continue;
                if (w.blast) explode(s, hit.x, hit.y, w.blast, b.o, b.team);
                else if (push(s, q, Math.sign(b.vx) * w.knock, -w.knock * 0.16, b.o)) event(s, 'hit', hit.x, hit.y, { w: b.w, slot: q.slot });
                gone = true; break;
            }
            if (!gone && w.lob && b.vy > 0) {
                for (const pl of map.platforms) if (y0 <= pl.y && b.y >= pl.y && b.x >= pl.x && b.x <= pl.x + pl.w) { explode(s, b.x, pl.y - 4, w.blast, b.o, b.team); gone = true; break; }
            }
            if (!gone && b.life <= 0) { if (w.rocket) explode(s, b.x, b.y, w.blast, b.o, b.team); gone = true; }
            if (!gone && (b.x < -300 || b.x > D.W + 300 || b.y > D.H + 300)) gone = true;
            if (!gone) keep.push(b);
        }
        s.shots = keep;
    }
    function bombs(s, map) {
        const keep = [];
        for (const g of s.bombs) {
            const y0 = g.y;
            g.vy = Math.min(12, g.vy + 0.36); g.x += g.vx; g.y += g.vy;
            if (g.rest) g.vx *= 0.8;
            if (g.vy > 0) {
                for (const pl of map.platforms) {
                    if (y0 <= pl.y && g.y >= pl.y && g.x >= pl.x && g.x <= pl.x + pl.w) {
                        g.y = pl.y; g.vx *= 0.55;
                        g.vy = g.vy > 2.2 ? -g.vy * 0.42 : 0; g.rest = g.vy === 0;
                        break;
                    }
                }
            }
            if (--g.fuse <= 0) { explode(s, g.x, g.y - 6, D.BOMB, g.o, g.team); continue; }
            if (g.y < D.BLAST.bottom) keep.push(g);
        }
        s.bombs = keep;
    }
    function crates(s, map) {
        if (s.phase === 'fight' && --s.crateAt <= 0) {
            const [a, b] = D.CRATE_EVERY;
            s.crateAt = Math.round((a + random(s) * (b - a)) * (s.overtime ? 0.5 : 1));
            if (s.crates.length < D.CRATE_MAX) {
                const pl = map.platforms[Math.floor(random(s) * map.platforms.length)];
                const item = random(s) < 0.18;
                let kind;
                if (item) kind = Math.floor(random(s) * D.ITEMS.length);
                else {
                    const total = D.WEAPONS.reduce((n, w) => n + w.weight, 0);
                    let r = random(s) * total; kind = 1;
                    for (let i = 1; i < D.WEAPONS.length; i++) { r -= D.WEAPONS[i].weight; if (r <= 0) { kind = i; break; } }
                }
                s.crates.push({ id: s.nextId++, x: Math.round(pl.x + 24 + random(s) * (pl.w - 48)), y: -30, vy: 0, item, kind, life: D.CRATE_LIFE, landed: false });
            }
        }
        const keep = [];
        for (const c of s.crates) {
            if (!c.landed) {
                const y0 = c.y; c.vy = Math.min(9, c.vy + 0.3); c.y += c.vy;
                for (const pl of map.platforms) if (y0 <= pl.y && c.y >= pl.y && c.x >= pl.x && c.x <= pl.x + pl.w) { c.y = pl.y; c.vy = 0; c.landed = true; break; }
            }
            if (--c.life <= 0 || c.y > D.H + 100) continue;
            const taker = s.players.find(p => !p.dead && !p.out && Math.abs(p.x - c.x) < 28 && c.y > p.y - D.BOX_H - 14 && c.y < p.y + 20);
            if (taker && s.phase === 'fight') {
                if (c.item) {
                    const it = D.ITEMS[c.kind];
                    if (it.id === 'firewall') taker.shield = it.time;
                    else if (it.id === 'bombs') taker.bombs = Math.min(9, taker.bombs + 3);
                    else taker.turbo = it.time;
                    event(s, 'pick', c.x, c.y - 40, { slot: taker.slot, name: it.name, item: 1 });
                } else {
                    arm(taker, c.kind);
                    event(s, 'pick', c.x, c.y - 40, { slot: taker.slot, name: D.WEAPONS[c.kind].name });
                }
                continue;
            }
            keep.push(c);
        }
        s.crates = keep;
    }

    // What goes over the wire: everything but the inputs and bot memory.
    const r1 = v => Math.round(v * 10) / 10;
    function snapshot(s) {
        return {
            version: 1, tick: s.tick, map: s.map, teams: s.teams, lives: s.lives, phase: s.phase, count: s.count, winner: s.winner, overtime: s.overtime,
            players: s.players.map(p => ({
                slot: p.slot, id: p.id, name: p.name, bot: p.bot, team: p.team, character: p.character, perk: p.perk, lives: p.lives, kos: p.kos, falls: p.falls, place: p.place,
                x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy), facing: p.facing, grounded: p.grounded, jumps: p.jumps, travel: Math.round(p.travel),
                dead: p.dead, out: p.out, invuln: p.invuln, shield: p.shield, turbo: p.turbo, stun: p.stun, kick: p.kick,
                weapon: p.weapon, mag: p.mag, clips: p.clips, reload: p.reload, spin: p.spin, bombs: p.bombs, firing: p.input.fire
            })),
            shots: s.shots.map(b => ({ id: b.id, o: b.o, w: b.w, x: Math.round(b.x), y: Math.round(b.y), vx: r1(b.vx), vy: r1(b.vy) })),
            bombs: s.bombs.map(g => ({ id: g.id, x: Math.round(g.x), y: Math.round(g.y), vx: r1(g.vx), vy: r1(g.vy), fuse: g.fuse })),
            crates: s.crates.map(c => ({ id: c.id, x: c.x, y: Math.round(c.y), item: c.item, kind: c.kind, landed: c.landed, life: c.life })),
            events: s.events.slice(-24)
        };
    }
    // A guest checks the host's snapshot before drawing it.
    function valid(v, players) {
        const num = Number.isFinite, int = (x, a, b) => Number.isInteger(x) && x >= a && x <= b;
        if (!v || v.version !== 1 || !Number.isSafeInteger(v.tick) || !['countdown', 'fight', 'over'].includes(v.phase)) return false;
        if (!D.MAPS.some(m => m.id === v.map) || !Array.isArray(v.players) || v.players.length !== players) return false;
        if (!Array.isArray(v.shots) || v.shots.length > 90 || !Array.isArray(v.bombs) || v.bombs.length > 40 || !Array.isArray(v.crates) || v.crates.length > 6 || !Array.isArray(v.events) || v.events.length > 24) return false;
        const pOk = v.players.every((p, i) => p && p.slot === i && typeof p.id === 'string' && typeof p.name === 'string' && p.name.length <= 16 && int(p.character, 0, D.FIGHTERS - 1) &&
            num(p.x) && num(p.y) && num(p.vx) && num(p.vy) && int(p.lives, 0, 10) && int(p.weapon, 0, D.WEAPONS.length - 1) && int(p.team, 0, 3) && (p.facing === 1 || p.facing === -1));
        return pOk && v.shots.every(b => b && int(b.w, 0, D.WEAPONS.length - 1) && num(b.x) && num(b.y) && num(b.vx) && num(b.vy)) &&
            v.bombs.every(g => g && num(g.x) && num(g.y)) && v.crates.every(c => c && num(c.x) && num(c.y) && int(c.kind, 0, D.WEAPONS.length - 1));
    }
    function result(s) {
        return {
            winner: s.winner, teams: s.teams,
            rows: s.players.map(p => ({ id: p.id, name: p.name, team: p.team, pick: p.character, kos: p.kos, falls: p.falls, place: p.place || 1, bot: p.bot }))
                .sort((a, b) => a.place - b.place || b.kos - a.kos)
        };
    }

    root.BLASTZ_SIM = { ACTIONS, input, create, step, setInput, snapshot, valid, result, character, weaponIndex, under, random };
})(typeof window === 'undefined' ? globalThis : window);
